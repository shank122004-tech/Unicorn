/* ═══════════════════════════════════════════════════════════════════════════
   pool_ground_limit_and_admin_fix.js   v1.0
   ─────────────────────────────────────────────────────────────────────────
   FIXES:
   1. Admin & CEO dashboards — new "Pools" tab showing pending swimming pool
      submissions with Approve / Reject actions.
   2. Owner "Add Pool" — enforces ONE pool per owner (plot_owner type) unless
      they are a venue_owner who has a multi-ground venue, in which case
      multiple grounds are allowed but still only ONE pool.
   3. Owner "Add Ground" — enforces ONE ground per plot_owner; venue_owners
      may add multiple grounds (one per sport type in their venue, no hard cap).

   HOW TO LOAD:
     Add in index.html AFTER app.js and all other patch scripts:
       <script src="pool_ground_limit_and_admin_fix.js"></script>
   ═══════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── helpers ───────────────────────────────────────────────────── */
  var gid = function (id) { return document.getElementById(id); };
  var log = function (msg) { console.log('[PoolGroundFix] ' + msg); };
  var esc = function (s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  };
  var db = function () { return window.db || (window.firebase && window.firebase.firestore()); };
  var toast = function (msg, type) {
    if (window.showToast) { window.showToast(msg, type); }
    else if (window.toast)  { window.toast(msg, type); }
    else { alert(msg); }
  };
  var spinStart = function (msg) { if (window.showLoading) window.showLoading(msg); };
  var spinStop  = function ()    { if (window.hideLoading) window.hideLoading(); };

  var POOL_COLL   = 'swimming_pools';
  var OWNERS_COLL = 'owners';
  var GROUNDS_COLL = 'grounds';

  /* ═══════════════════════════════════════════════════════════════════
     PART 1 — OWNER LIMIT ENFORCEMENT
     ─────────────────────────────────────────────────────────────────
     • plot_owner  → max 1 ground, max 1 pool
     • venue_owner → unlimited grounds, max 1 pool
  ═══════════════════════════════════════════════════════════════════ */

  /* ── 1a. canAddPool — patch to enforce 1-pool limit ─────────────── */
  async function canAddPoolPatched() {
    if (!window.currentUser || window.currentUser.role !== 'owner') {
      toast('Please login as owner', 'error'); return false;
    }
    try {
      var ownerDoc = await db().collection(OWNERS_COLL).doc(window.currentUser.uid).get();
      if (!ownerDoc.exists) { toast('Owner data not found', 'error'); return false; }
      var owner = ownerDoc.data();

      if (owner.status !== 'active') {
        toast('Your account is blocked. Contact support.', 'error'); return false;
      }
      if (!owner.isVerified) {
        toast('Complete identity verification first (Verification tab).', 'warning');
        if (gid('owner-dashboard-page')?.classList.contains('active'))
          window.loadOwnerDashboard && window.loadOwnerDashboard('verification');
        return false;
      }
      if (!owner.documentVerified) {
        toast('Complete address verification (electricity bill) first.', 'warning');
        if (gid('owner-dashboard-page')?.classList.contains('active'))
          window.loadOwnerDashboard && window.loadOwnerDashboard('verification');
        return false;
      }

      /* ── NEW: 1-pool limit ── */
      var existingPools = await db().collection(POOL_COLL)
        .where('ownerId', '==', window.currentUser.uid)
        .get();

      if (!existingPools.empty) {
        /* Check if any pool is not rejected */
        var activePool = existingPools.docs.find(function (d) {
          return d.data().status !== 'rejected';
        });
        if (activePool) {
          var poolData = activePool.data();
          var statusMsg = poolData.status === 'pending'
            ? 'Your pool submission is under review.'
            : 'You already have an active swimming pool.';
          toast(statusMsg + ' Only 1 pool per owner is allowed.', 'warning');
          return false;
        }
      }

      return true;
    } catch(e) {
      log('canAddPool error: ' + e.message);
      toast('Permission check failed. Try again.', 'error'); return false;
    }
  }

  /* ── 1b. canAddGround — patch to enforce limit by owner type ────── */
  var _originalCanAddGround = window.canAddGround;
  window.canAddGround = async function canAddGroundPatched() {
    /* First run the original checks (payment, verification, etc.) */
    var base = _originalCanAddGround ? await _originalCanAddGround() : true;
    if (!base) return false;

    if (!window.currentUser || window.currentUser.role !== 'owner') return false;

    try {
      var ownerDoc = await db().collection(OWNERS_COLL).doc(window.currentUser.uid).get();
      if (!ownerDoc.exists) return false;
      var owner = ownerDoc.data();
      var ownerType = owner.ownerType || 'plot_owner';

      if (ownerType === 'plot_owner') {
        /* plot_owner: strictly 1 ground */
        var existingGrounds = await db().collection(GROUNDS_COLL)
          .where('ownerId', '==', window.currentUser.uid)
          .get();

        var activeGround = existingGrounds.docs.find(function (d) {
          return d.data().status !== 'rejected' && d.data().status !== 'deleted';
        });

        if (activeGround) {
          toast(
            'You already have a ground listed. Plot owners can only add 1 ground. ' +
            'If you own a full venue/complex, please contact support to upgrade your account.',
            'warning'
          );
          return false;
        }
      }
      /* venue_owner: no hard ground cap — they can have multiple sports grounds */
      return true;
    } catch (e) {
      log('canAddGround patch error: ' + e.message);
      return false;
    }
  };

  /* ── Expose the patched canAddPool so the pool modal code uses it ─ */
  window._bmgCanAddPoolPatched = canAddPoolPatched;

  /* ─── Wait for the IIFE that defines canAddPool then replace it ─── */
  /* The pool patches run inside an IIFE, so we intercept via the
     showAddPoolModal call that is triggered by canAddPool() result.
     We patch the buttons' click handlers once the DOM is ready.       */
  function patchPoolButtons() {
    var ids = ['bmgp-add-pool-btn', 'bmgp-add-pool-btn-empty'];
    ids.forEach(function (id) {
      var btn = gid(id);
      if (!btn || btn._limitPatched) return;
      btn._limitPatched = true;

      /* Replace click: use our patched canAddPool */
      btn.addEventListener('click', async function (e) {
        e.stopImmediatePropagation();
        var ok = await canAddPoolPatched();
        if (ok && window.showAddPoolModal) window.showAddPoolModal();
      }, true); /* capture phase so it fires before existing handlers */
    });
  }

  /* Re-run patching whenever the pools tab re-renders */
  var _poolBtnObserver = new MutationObserver(function () {
    patchPoolButtons();
  });
  var ownerContent = gid('owner-dashboard-content') ||
                     document.querySelector('.owner-dashboard-content');
  if (ownerContent) {
    _poolBtnObserver.observe(ownerContent, { childList: true, subtree: true });
  } else {
    /* Fallback: observe body until content area appears */
    var bodyObs = new MutationObserver(function () {
      var el = gid('owner-dashboard-content') ||
               document.querySelector('.owner-dashboard-content');
      if (el) {
        bodyObs.disconnect();
        _poolBtnObserver.observe(el, { childList: true, subtree: true });
        patchPoolButtons();
      }
    });
    bodyObs.observe(document.body, { childList: true, subtree: true });
  }

  /* ═══════════════════════════════════════════════════════════════════
     PART 2 — ADMIN POOL APPROVAL PANEL
  ═══════════════════════════════════════════════════════════════════ */

  /* ── 2a. Inject "Pools" tab into admin & CEO tab bars ───────────── */
  function injectAdminPoolsTab() {
    /* Admin tab bar */
    var adminTabs = document.querySelector('.admin-tabs');
    if (adminTabs && !gid('admin-pools-tab')) {
      var btn = document.createElement('button');
      btn.className = 'tab-btn';
      btn.id = 'admin-pools-tab';
      btn.textContent = '🏊 Pools';
      btn.addEventListener('click', function () {
        loadAdminPoolsPanel(gid('admin-dashboard-content'));
        document.querySelectorAll('.admin-tabs .tab-btn').forEach(function (b) {
          b.classList.remove('active');
        });
        btn.classList.add('active');
      });
      /* Insert before the delete tab (always last) */
      var delTab = gid('admin-delete-tab');
      if (delTab) adminTabs.insertBefore(btn, delTab);
      else adminTabs.appendChild(btn);
      log('Admin Pools tab injected');
    }

    /* CEO tab bar */
    var ceoTabs = document.querySelector('.ceo-tabs');
    if (ceoTabs && !gid('ceo-pools-tab')) {
      var ceoBtn = document.createElement('button');
      ceoBtn.className = 'tab-btn';
      ceoBtn.id = 'ceo-pools-tab';
      ceoBtn.textContent = '🏊 Pools';
      ceoBtn.addEventListener('click', function () {
        var ceoContent = gid('ceo-dashboard-content');
        if (!ceoContent) return;
        loadAdminPoolsPanel(ceoContent);
        document.querySelectorAll('.ceo-tabs .tab-btn').forEach(function (b) {
          b.classList.remove('active');
        });
        ceoBtn.classList.add('active');
      });
      ceoTabs.appendChild(ceoBtn);
      log('CEO Pools tab injected');
    }
  }

  /* ── 2b. The pools approval panel renderer ──────────────────────── */
  async function loadAdminPoolsPanel(container) {
    if (!container) return;
    container.innerHTML = '<div class="loading-spinner"><div class="loader-spinner"></div></div>';
    spinStart('Loading pool submissions…');

    try {
      /* Fetch ALL pools so admin can see pending + active + rejected */
      var snap = await db().collection(POOL_COLL)
        .orderBy('createdAt', 'desc')
        .get();

      var all = [];
      snap.forEach(function (d) { all.push(Object.assign({ _id: d.id }, d.data())); });

      var pending  = all.filter(function (p) { return p.status === 'pending'; });
      var active   = all.filter(function (p) { return p.status === 'active'; });
      var rejected = all.filter(function (p) { return p.status === 'rejected'; });

      var html = '<div style="margin-bottom:20px;">' +
        '<h3 style="font-size:18px;font-weight:800;color:#0f1f5c;margin-bottom:4px;">' +
        '<i class="fas fa-swimming-pool" style="color:#0ea5e9;margin-right:8px;"></i>' +
        'Swimming Pool Submissions</h3>' +
        '<p style="font-size:13px;color:#6b7280;">Review and approve pool listings from owners.</p>' +
        '</div>';

      /* ── Stats row ── */
      html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px;">' +
        _statCard('⏳', 'Pending', pending.length, '#fef3c7', '#92400e') +
        _statCard('✅', 'Active', active.length, '#dcfce7', '#15803d') +
        _statCard('❌', 'Rejected', rejected.length, '#fee2e2', '#b91c1c') +
        '</div>';

      /* ── Filter tabs ── */
      html += '<div id="admin-pool-filter-bar" style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">' +
        '<button class="apf-btn apf-active" data-filter="pending" style="' + _filterBtnStyle(true) + '">⏳ Pending (' + pending.length + ')</button>' +
        '<button class="apf-btn" data-filter="active"  style="' + _filterBtnStyle(false) + '">✅ Active (' + active.length + ')</button>' +
        '<button class="apf-btn" data-filter="rejected" style="' + _filterBtnStyle(false) + '">❌ Rejected (' + rejected.length + ')</button>' +
        '<button class="apf-btn" data-filter="all"     style="' + _filterBtnStyle(false) + '">📋 All (' + all.length + ')</button>' +
        '</div>';

      html += '<div id="admin-pool-list">';

      if (all.length === 0) {
        html += '<div style="text-align:center;padding:48px 16px;">' +
          '<div style="font-size:48px;opacity:.3;">🏊</div>' +
          '<div style="font-size:14px;font-weight:700;color:#6b7280;margin-top:12px;">No pool submissions yet.</div></div>';
      } else {
        all.forEach(function (pool) {
          html += _poolAdminCard(pool);
        });
      }

      html += '</div>'; /* #admin-pool-list */

      container.innerHTML = html;
      spinStop();

      /* ── Wire filter tabs ── */
      container.querySelectorAll('.apf-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          container.querySelectorAll('.apf-btn').forEach(function (b) {
            b.style.cssText = _filterBtnStyle(false);
            b.classList.remove('apf-active');
          });
          btn.style.cssText = _filterBtnStyle(true);
          btn.classList.add('apf-active');
          var filter = btn.dataset.filter;
          container.querySelectorAll('.admin-pool-card').forEach(function (card) {
            if (filter === 'all' || card.dataset.status === filter) {
              card.style.display = '';
            } else {
              card.style.display = 'none';
            }
          });
        });
      });

      /* ── Wire action buttons ── */
      container.querySelectorAll('.apc-approve-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          approvePool(btn.dataset.poolId, btn.dataset.ownerId, container);
        });
      });
      container.querySelectorAll('.apc-reject-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          rejectPool(btn.dataset.poolId, container);
        });
      });
      container.querySelectorAll('.apc-restore-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          approvePool(btn.dataset.poolId, btn.dataset.ownerId, container);
        });
      });

    } catch (err) {
      spinStop();
      log('loadAdminPoolsPanel error: ' + err.message);
      container.innerHTML = '<p style="text-align:center;color:#ef4444;padding:32px;">Failed to load pool submissions: ' + esc(err.message) + '</p>';
    }
  }

  function _statCard(icon, label, count, bg, color) {
    return '<div style="background:' + bg + ';border-radius:14px;padding:16px;text-align:center;">' +
      '<div style="font-size:22px;">' + icon + '</div>' +
      '<div style="font-size:22px;font-weight:800;color:' + color + ';">' + count + '</div>' +
      '<div style="font-size:12px;font-weight:600;color:' + color + ';opacity:.8;">' + label + '</div>' +
      '</div>';
  }

  function _filterBtnStyle(active) {
    if (active) {
      return 'padding:8px 16px;border-radius:22px;border:none;font-size:13px;font-weight:700;cursor:pointer;' +
        'background:#0f1f5c;color:#fff;font-family:inherit;';
    }
    return 'padding:8px 16px;border-radius:22px;border:1.5px solid #e2e8f0;font-size:13px;font-weight:600;cursor:pointer;' +
      'background:#fff;color:#374151;font-family:inherit;';
  }

  function _poolAdminCard(pool) {
    var statusColor = {
      pending:  { bg: '#fef3c7', color: '#92400e', label: '⏳ Pending Review' },
      active:   { bg: '#dcfce7', color: '#15803d', label: '✅ Active' },
      rejected: { bg: '#fee2e2', color: '#b91c1c', label: '❌ Rejected' }
    }[pool.status] || { bg: '#f1f5f9', color: '#64748b', label: pool.status };

    var img = (pool.images && pool.images[0])
      ? '<img src="' + esc(pool.images[0]) + '" style="width:100%;height:160px;object-fit:cover;">'
      : '<div style="width:100%;height:80px;background:linear-gradient(135deg,#0369a1,#0ea5e9);display:flex;align-items:center;justify-content:center;font-size:32px;">🏊</div>';

    var date = pool.createdAt
      ? (pool.createdAt.toDate ? pool.createdAt.toDate() : new Date(pool.createdAt))
      : new Date();
    var dateStr = date.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });

    var actions = '';
    if (pool.status === 'pending') {
      actions =
        '<button class="apc-approve-btn" data-pool-id="' + esc(pool._id) + '" data-owner-id="' + esc(pool.ownerId) + '" ' +
        'style="flex:1;padding:10px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;border-radius:12px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">' +
        '<i class="fas fa-check"></i> Approve & Activate</button>' +
        '<button class="apc-reject-btn" data-pool-id="' + esc(pool._id) + '" ' +
        'style="flex:1;padding:10px;background:transparent;color:#ef4444;border:1.5px solid #fca5a5;border-radius:12px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">' +
        '<i class="fas fa-times"></i> Reject</button>';
    } else if (pool.status === 'rejected') {
      actions =
        '<button class="apc-restore-btn" data-pool-id="' + esc(pool._id) + '" data-owner-id="' + esc(pool.ownerId) + '" ' +
        'style="flex:1;padding:10px;background:linear-gradient(135deg,#0369a1,#0ea5e9);color:#fff;border:none;border-radius:12px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">' +
        '<i class="fas fa-undo"></i> Restore & Approve</button>';
    } else {
      actions =
        '<button class="apc-reject-btn" data-pool-id="' + esc(pool._id) + '" ' +
        'style="flex:1;padding:10px;background:transparent;color:#ef4444;border:1.5px solid #fca5a5;border-radius:12px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">' +
        '<i class="fas fa-ban"></i> Deactivate</button>';
    }

    return '<div class="admin-pool-card" data-status="' + esc(pool.status) + '" ' +
      'style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 10px rgba(15,31,92,0.08);' +
      'margin-bottom:14px;border-top:3px solid #0ea5e9;">' +
      img +
      '<div style="padding:14px;">' +

        /* Header row */
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:10px;">' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="font-size:15px;font-weight:800;color:#0f1f5c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(pool.name || 'Unnamed Pool') + '</div>' +
            '<div style="font-size:12px;color:#6b7280;margin-top:2px;">' + esc(pool.ownerName || 'Unknown Owner') + ' · ' + esc(pool.ownerPhone || '') + '</div>' +
          '</div>' +
          '<span style="background:' + statusColor.bg + ';color:' + statusColor.color + ';font-size:10px;font-weight:800;padding:4px 10px;border-radius:20px;white-space:nowrap;flex-shrink:0;">' + statusColor.label + '</span>' +
        '</div>' +

        /* Info grid */
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;color:#374151;margin-bottom:10px;">' +
          '<div><i class="fas fa-map-marker-alt" style="color:#0ea5e9;width:14px;"></i> ' + esc(pool.city || pool.address || '—') + '</div>' +
          '<div><i class="fas fa-rupee-sign" style="color:#0ea5e9;width:14px;"></i> ₹' + esc(pool.pricePerSession || 0) + '/session</div>' +
          '<div><i class="fas fa-users" style="color:#0ea5e9;width:14px;"></i> Capacity: ' + esc(pool.capacityPerSession || '—') + '</div>' +
          '<div><i class="fas fa-ruler" style="color:#0ea5e9;width:14px;"></i> ' + (pool.poolLength ? pool.poolLength + 'm pool' : '—') + '</div>' +
          '<div><i class="fas fa-clock" style="color:#0ea5e9;width:14px;"></i> ' + esc(pool.openTime || '—') + ' – ' + esc(pool.closeTime || '—') + '</div>' +
          '<div><i class="fas fa-calendar" style="color:#0ea5e9;width:14px;"></i> ' + dateStr + '</div>' +
        '</div>' +

        /* Description */
        (pool.description ? '<div style="font-size:12px;color:#6b7280;margin-bottom:10px;padding:8px;background:#f8faff;border-radius:8px;line-height:1.5;">' + esc(pool.description.substring(0, 200)) + (pool.description.length > 200 ? '…' : '') + '</div>' : '') +

        /* Amenities */
        (pool.amenities && pool.amenities.length > 0
          ? '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px;">' +
              pool.amenities.map(function (a) {
                return '<span style="background:#e0f2fe;color:#0369a1;font-size:10px;font-weight:700;padding:3px 8px;border-radius:20px;">' + esc(a.replace(/_/g,' ')) + '</span>';
              }).join('') +
            '</div>'
          : '') +

        /* Photo thumbnails */
        (pool.images && pool.images.length > 1
          ? '<div style="display:flex;gap:4px;margin-bottom:10px;overflow-x:auto;">' +
              pool.images.slice(0,5).map(function (url) {
                return '<img src="' + esc(url) + '" style="width:60px;height:60px;border-radius:8px;object-fit:cover;flex-shrink:0;" ' +
                  'onclick="window.open(\'' + esc(url) + '\',\'_blank\')" style="cursor:pointer;">';
              }).join('') +
            '</div>'
          : '') +

        /* Action buttons */
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">' + actions + '</div>' +

      '</div>' + /* padding */
    '</div>'; /* card */
  }

  /* ── Approve pool ─────────────────────────────────────────────── */
  async function approvePool(poolId, ownerId, container) {
    if (!poolId) return;
    var confirmed = window.confirm('Approve this swimming pool and make it live for users?');
    if (!confirmed) return;

    try {
      spinStart('Approving pool…');
      await db().collection(POOL_COLL).doc(poolId).update({
        status: 'active',
        isVerified: true,
        approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
        approvedBy: (window.currentUser && window.currentUser.uid) || 'admin',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      spinStop();
      toast('Pool approved and is now live! 🏊', 'success');
      loadAdminPoolsPanel(container);
    } catch (err) {
      spinStop();
      log('approvePool error: ' + err.message);
      toast('Failed to approve pool: ' + err.message, 'error');
    }
  }

  /* ── Reject pool ──────────────────────────────────────────────── */
  async function rejectPool(poolId, container) {
    if (!poolId) return;
    var reason = window.prompt(
      'Reason for rejection (will be stored for records):\n\nLeave blank to reject without a reason.',
      ''
    );
    if (reason === null) return; /* user cancelled */

    try {
      spinStart('Rejecting pool…');
      await db().collection(POOL_COLL).doc(poolId).update({
        status: 'rejected',
        rejectionReason: reason.trim() || 'Rejected by admin',
        rejectedAt: firebase.firestore.FieldValue.serverTimestamp(),
        rejectedBy: (window.currentUser && window.currentUser.uid) || 'admin',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      spinStop();
      toast('Pool rejected.', 'info');
      loadAdminPoolsPanel(container);
    } catch (err) {
      spinStop();
      log('rejectPool error: ' + err.message);
      toast('Failed to reject pool: ' + err.message, 'error');
    }
  }

  /* ── 2c. Patch loadAdminDashboard & loadCEODashboard to handle 'pools' ── */
  function patchDashboardFunctions() {
    var _origAdmin = window.loadAdminDashboard;
    if (_origAdmin && !_origAdmin._poolPatched) {
      window.loadAdminDashboard = async function (tab) {
        if (tab === 'pools') {
          var container = gid('admin-dashboard-content');
          if (!container) return;
          document.querySelectorAll('.admin-tabs .tab-btn').forEach(function (b) {
            b.classList.remove('active');
          });
          var poolTab = gid('admin-pools-tab');
          if (poolTab) poolTab.classList.add('active');
          container.innerHTML = '<div class="loading-spinner"><div class="loader-spinner"></div></div>';
          await loadAdminPoolsPanel(container);
          return;
        }
        return _origAdmin.apply(this, arguments);
      };
      window.loadAdminDashboard._poolPatched = true;
      log('loadAdminDashboard patched for pools tab');
    }

    var _origCEO = window.loadCEODashboard;
    if (_origCEO && !_origCEO._poolPatched) {
      window.loadCEODashboard = async function (tab) {
        if (tab === 'pools') {
          var container = gid('ceo-dashboard-content');
          if (!container) return;
          document.querySelectorAll('.ceo-tabs .tab-btn').forEach(function (b) {
            b.classList.remove('active');
          });
          var poolTab = gid('ceo-pools-tab');
          if (poolTab) poolTab.classList.add('active');
          container.innerHTML = '<div class="loading-spinner"><div class="loader-spinner"></div></div>';
          await loadAdminPoolsPanel(container);
          return;
        }
        return _origCEO.apply(this, arguments);
      };
      window.loadCEODashboard._poolPatched = true;
      log('loadCEODashboard patched for pools tab');
    }
  }

  /* ── 2d. Show pool count badge on admin overview pending section ── */
  function patchAdminOverviewPoolCount() {
    var _origOverview = window.loadAdminOverview;
    if (!_origOverview || _origOverview._poolCountPatched) return;
    window.loadAdminOverview = async function (container) {
      await _origOverview.apply(this, arguments);
      /* After overview renders, append pending pool badge */
      try {
        var poolSnap = await db().collection(POOL_COLL)
          .where('status', '==', 'pending').get();
        if (poolSnap.size > 0) {
          var notice = document.createElement('div');
          notice.style.cssText = 'background:#fff7ed;border:1.5px solid #fed7aa;border-radius:14px;' +
            'padding:14px 16px;margin-bottom:12px;display:flex;align-items:center;gap:12px;cursor:pointer;';
          notice.innerHTML = '<span style="font-size:22px;">🏊</span>' +
            '<div style="flex:1;">' +
            '<div style="font-size:14px;font-weight:800;color:#92400e;">' + poolSnap.size + ' Pool Submission' + (poolSnap.size > 1 ? 's' : '') + ' Pending</div>' +
            '<div style="font-size:12px;color:#b45309;">Review and approve swimming pool listings</div>' +
            '</div>' +
            '<i class="fas fa-chevron-right" style="color:#f59e0b;"></i>';
          notice.addEventListener('click', function () {
            window.loadAdminDashboard && window.loadAdminDashboard('pools');
          });
          if (container && container.firstChild) {
            container.insertBefore(notice, container.firstChild);
          }
        }
      } catch(e) { /* non-critical */ }
    };
    window.loadAdminOverview._poolCountPatched = true;
  }

  /* ═══════════════════════════════════════════════════════════════════
     PART 3 — INITIALISE
  ═══════════════════════════════════════════════════════════════════ */
  function init() {
    log('Initialising pool_ground_limit_and_admin_fix v1.0');
    injectAdminPoolsTab();
    patchDashboardFunctions();
    patchAdminOverviewPoolCount();
    patchPoolButtons();
    log('Init complete');
  }

  /* Run after DOM and other scripts are ready */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      /* Small delay to ensure app.js and patch scripts have executed */
      setTimeout(init, 800);
    });
  } else {
    setTimeout(init, 800);
  }

  /* Also re-inject tabs whenever page navigation happens (SPA) */
  var _pageObserver = new MutationObserver(function (mutations) {
    mutations.forEach(function (m) {
      m.addedNodes.forEach(function (node) {
        if (node.nodeType === 1) {
          if (node.classList && (node.classList.contains('admin-tabs') || node.classList.contains('ceo-tabs'))) {
            injectAdminPoolsTab();
            patchDashboardFunctions();
          }
        }
      });
    });
  });
  _pageObserver.observe(document.body, { childList: true, subtree: true });

})();