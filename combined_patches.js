/* ═══════════════════════════════════════════════════════════════════════════
   combined_patches.js   v1.0
   ─────────────────────────────────────────────────────────────────────────
   Combines the following files into one, with duplicate code removed and
   a single authoritative implementation kept for each feature:

     • pool_ground_limit_and_admin_fix.js   (unchanged — fully unique)
     • pool_member_price_fix.js             (unchanged — fully unique)
     • SLOT_BOOKED_DISPLAY_FIX.js           (authoritative markSlotAsConfirmed)
     • FINAL_SLOT_EARNINGS_FIX.js           (slot pre-creation + robust slot mark
                                             + startPayment wrap; earnings re-install
                                             section removed — GROUND_EARNINGS_PAYOUT_FIX
                                             handles that more aggressively)
     • EARNINGS_UPCOMING_BOOKED_FIX.js     (loadUpcomingBookingBanner + page-shown
                                             hooks only; duplicate markSlotAsConfirmed
                                             and _bmgLoadOwnerEarningsFull removed)
     • PAYOUT_EARNINGS_FIX.js              (computeRealBalance + UI renderers removed
                                             — superseded by GROUND_EARNINGS_PAYOUT_FIX;
                                             _bmgOpenPayoutModalWithCorrectBalance kept
                                             as a global convenience)
     • EARNINGS_RECEIVED_FIX.js            (computeCorrectBalance + renderers removed
                                             — superseded by GROUND_EARNINGS_PAYOUT_FIX;
                                             auto-refresh event listeners kept)
     • GROUND_EARNINGS_PAYOUT_FIX.js       (authoritative earnings + payouts renderers,
                                             computeRealBalance, payout modal — LAST to
                                             install so it always wins the race)

   LOAD ORDER in index.html (replace all individual <script> tags with one):
     <script src="combined_patches.js"></script>

   NOTE: Do NOT include app.js, bmg_fixes_combined.js, all_patches_combined.js,
         paymentService.js, sportobook_patches_merged.js, or index.js here —
         those files are untouched and loaded separately.
═══════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 1 — POOL & GROUND LIMIT ENFORCEMENT + ADMIN POOL PANEL
   Source: pool_ground_limit_and_admin_fix.js v1.0
   Unique to this file: owner limit enforcement (1 pool / 1 ground per
   plot_owner), admin/CEO dashboard "Pools" tab injection and approval UI.
═══════════════════════════════════════════════════════════════════════════ */
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
     • plot_owner  → max 1 ground, max 1 pool
     • venue_owner → unlimited grounds, max 1 pool
  ═══════════════════════════════════════════════════════════════════ */

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

      /* 1-pool limit */
      var existingPools = await db().collection(POOL_COLL)
        .where('ownerId', '==', window.currentUser.uid)
        .get();

      if (!existingPools.empty) {
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

  var _originalCanAddGround = window.canAddGround;
  window.canAddGround = async function canAddGroundPatched() {
    var base = _originalCanAddGround ? await _originalCanAddGround() : true;
    if (!base) return false;

    if (!window.currentUser || window.currentUser.role !== 'owner') return false;

    try {
      var ownerDoc = await db().collection(OWNERS_COLL).doc(window.currentUser.uid).get();
      if (!ownerDoc.exists) return false;
      var owner = ownerDoc.data();
      var ownerType = owner.ownerType || 'plot_owner';

      if (ownerType === 'plot_owner') {
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
      return true;
    } catch (e) {
      log('canAddGround patch error: ' + e.message);
      return false;
    }
  };

  window._bmgCanAddPoolPatched = canAddPoolPatched;

  function patchPoolButtons() {
    var ids = ['bmgp-add-pool-btn', 'bmgp-add-pool-btn-empty'];
    ids.forEach(function (id) {
      var btn = gid(id);
      if (!btn || btn._limitPatched) return;
      btn._limitPatched = true;
      btn.addEventListener('click', async function (e) {
        e.stopImmediatePropagation();
        var ok = await canAddPoolPatched();
        if (ok && window.showAddPoolModal) window.showAddPoolModal();
      }, true);
    });
  }

  var _poolBtnObserver = new MutationObserver(function () {
    patchPoolButtons();
  });
  var ownerContent = gid('owner-dashboard-content') ||
                     document.querySelector('.owner-dashboard-content');
  if (ownerContent) {
    _poolBtnObserver.observe(ownerContent, { childList: true, subtree: true });
  } else {
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

  function injectAdminPoolsTab() {
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
      var delTab = gid('admin-delete-tab');
      if (delTab) adminTabs.insertBefore(btn, delTab);
      else adminTabs.appendChild(btn);
      log('Admin Pools tab injected');
    }

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

  async function loadAdminPoolsPanel(container) {
    if (!container) return;
    container.innerHTML = '<div class="loading-spinner"><div class="loader-spinner"></div></div>';
    spinStart('Loading pool submissions…');

    try {
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

      html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px;">' +
        _statCard('⏳', 'Pending', pending.length, '#fef3c7', '#92400e') +
        _statCard('✅', 'Active', active.length, '#dcfce7', '#15803d') +
        _statCard('❌', 'Rejected', rejected.length, '#fee2e2', '#b91c1c') +
        '</div>';

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

      html += '</div>';
      container.innerHTML = html;
      spinStop();

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
            card.style.display = (filter === 'all' || card.dataset.status === filter) ? '' : 'none';
          });
        });
      });

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
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:10px;">' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="font-size:15px;font-weight:800;color:#0f1f5c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(pool.name || 'Unnamed Pool') + '</div>' +
            '<div style="font-size:12px;color:#6b7280;margin-top:2px;">' + esc(pool.ownerName || 'Unknown Owner') + ' · ' + esc(pool.ownerPhone || '') + '</div>' +
          '</div>' +
          '<span style="background:' + statusColor.bg + ';color:' + statusColor.color + ';font-size:10px;font-weight:800;padding:4px 10px;border-radius:20px;white-space:nowrap;flex-shrink:0;">' + statusColor.label + '</span>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;color:#374151;margin-bottom:10px;">' +
          '<div><i class="fas fa-map-marker-alt" style="color:#0ea5e9;width:14px;"></i> ' + esc(pool.city || pool.address || '—') + '</div>' +
          '<div><i class="fas fa-rupee-sign" style="color:#0ea5e9;width:14px;"></i> ₹' + esc(pool.pricePerSession || 0) + '/session</div>' +
          '<div><i class="fas fa-users" style="color:#0ea5e9;width:14px;"></i> Capacity: ' + esc(pool.capacityPerSession || '—') + '</div>' +
          '<div><i class="fas fa-ruler" style="color:#0ea5e9;width:14px;"></i> ' + (pool.poolLength ? pool.poolLength + 'm pool' : '—') + '</div>' +
          '<div><i class="fas fa-clock" style="color:#0ea5e9;width:14px;"></i> ' + esc(pool.openTime || '—') + ' – ' + esc(pool.closeTime || '—') + '</div>' +
          '<div><i class="fas fa-calendar" style="color:#0ea5e9;width:14px;"></i> ' + dateStr + '</div>' +
        '</div>' +
        (pool.description ? '<div style="font-size:12px;color:#6b7280;margin-bottom:10px;padding:8px;background:#f8faff;border-radius:8px;line-height:1.5;">' + esc(pool.description.substring(0, 200)) + (pool.description.length > 200 ? '…' : '') + '</div>' : '') +
        (pool.amenities && pool.amenities.length > 0
          ? '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px;">' +
              pool.amenities.map(function (a) {
                return '<span style="background:#e0f2fe;color:#0369a1;font-size:10px;font-weight:700;padding:3px 8px;border-radius:20px;">' + esc(a.replace(/_/g,' ')) + '</span>';
              }).join('') +
            '</div>'
          : '') +
        (pool.images && pool.images.length > 1
          ? '<div style="display:flex;gap:4px;margin-bottom:10px;overflow-x:auto;">' +
              pool.images.slice(0,5).map(function (url) {
                return '<img src="' + esc(url) + '" style="width:60px;height:60px;border-radius:8px;object-fit:cover;flex-shrink:0;" ' +
                  'onclick="window.open(\'' + esc(url) + '\',\'_blank\')">';
              }).join('') +
            '</div>'
          : '') +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">' + actions + '</div>' +
      '</div>' +
    '</div>';
  }

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

  async function rejectPool(poolId, container) {
    if (!poolId) return;
    var reason = window.prompt(
      'Reason for rejection (will be stored for records):\n\nLeave blank to reject without a reason.',
      ''
    );
    if (reason === null) return;

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

  function patchAdminOverviewPoolCount() {
    var _origOverview = window.loadAdminOverview;
    if (!_origOverview || _origOverview._poolCountPatched) return;
    window.loadAdminOverview = async function (container) {
      await _origOverview.apply(this, arguments);
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

  function init() {
    log('Initialising pool_ground_limit_and_admin_fix v1.0');
    injectAdminPoolsTab();
    patchDashboardFunctions();
    patchAdminOverviewPoolCount();
    patchPoolButtons();
    log('Init complete');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(init, 800);
    });
  } else {
    setTimeout(init, 800);
  }

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

  console.log('[combined_patches] Section 1: pool_ground_limit_and_admin_fix loaded ✅');
})();


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 2 — POOL MEMBER PRICE FIX
   Source: pool_member_price_fix.js v1.0
   Unique to this file: ensures multi-member pool bookings charge the correct
   total amount (pricePerMember × memberCount) in booking details, sessionStorage,
   Cashfree pay button, and DOM summary.
═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Utility: wait for a global function to exist ── */
  function waitFor(name, cb, attempt) {
    attempt = attempt || 0;
    if (typeof window[name] === 'function') { cb(); return; }
    if (attempt > 120) { console.warn('[pool-price-fix] Timeout waiting for', name); return; }
    setTimeout(function () { waitFor(name, cb, attempt + 1); }, 100);
  }

  /* ── Core price calculator ── */
  function getCorrectAmount() {
    var count  = window._poolMemberCount || 1;
    var slot   = window.selectedPoolSlot;
    var perPer = slot ? (slot.price || 0) : 0;
    return { count: count, perPer: perPer, total: perPer * count };
  }

  /* ── PATCH 1: Wrap window.handlePoolBookNow ── */
  function applyHandlerPatch() {
    var orig = window.handlePoolBookNow;
    if (!orig || orig._pricePatchedV1) return;

    window.handlePoolBookNow = async function () {
      var p    = getCorrectAmount();
      var slot = window.selectedPoolSlot;
      if (slot) {
        slot._memberCount  = p.count;
        slot._totalAmount  = p.total;
        slot.pricePerMember = p.perPer;
        window.selectedPoolSlot = slot;
      }
      window._poolMemberCount = p.count;
      return orig.apply(this, arguments);
    };
    window.handlePoolBookNow._pricePatchedV1 = true;
    console.log('[pool-price-fix] handlePoolBookNow wrapped');
  }

  /* ── PATCH 2: Intercept sessionStorage.setItem ── */
  (function patchSessionStorage() {
    if (sessionStorage._pricePatchedV1) return;

    var _orig = sessionStorage.setItem.bind(sessionStorage);
    sessionStorage.setItem = function (key, value) {
      if ((key === 'pendingBooking' || key === 'pendingCashfreeBooking') && value) {
        try {
          var obj = JSON.parse(value);
          if (obj && obj.isPoolBooking) {
            var count  = window._poolMemberCount || 1;
            var perPer = (window.selectedPoolSlot && window.selectedPoolSlot.price)
                          || obj.pricePerMember
                          || obj.amount
                          || 0;
            var total  = perPer * count;

            obj.pricePerMember = perPer;
            obj.memberCount    = count;
            obj.amount         = total;
            obj.originalAmount = total;
            obj.ownerAmount    = Math.round(total * 0.9);
            obj.platformAmount = Math.round(total * 0.1);
            obj.commission     = Math.round(total * 0.1);

            value = JSON.stringify(obj);
            console.log('[pool-price-fix] sessionStorage patched →',
              count, 'members × ₹' + perPer + ' = ₹' + total);
          }
        } catch (e) { /* safe */ }
      }
      return _orig(key, value);
    };
    sessionStorage._pricePatchedV1 = true;
    console.log('[pool-price-fix] sessionStorage.setItem interceptor installed');
  })();

  /* ── PATCH 3: booking-page DOM refresh + setupPayButton re-call ── */
  window.addEventListener('bmg:pageShown', function (e) {
    if (!e.detail || e.detail.pageId !== 'booking-page') return;

    setTimeout(function () {
      var raw = null;
      try {
        raw = JSON.parse(
          sessionStorage.getItem('pendingBooking') ||
          sessionStorage.getItem('pendingCashfreeBooking') ||
          'null'
        );
      } catch (_) {}
      if (!raw || !raw.isPoolBooking) return;

      var count    = raw.memberCount    || 1;
      var perPer   = raw.pricePerMember || 0;
      var total    = raw.amount         || (perPer * count);
      var platform = raw.platformAmount || 0;

      function _s(id, val) {
        var el = document.getElementById(id);
        if (el) el.textContent = val;
      }

      _s('booking-amount', '₹' + total);
      _s('payment-amount', '₹' + total);
      _s('platform-fee',   '₹' + platform);
      _s('final-amount',   '₹' + total);

      if (typeof window.setupPayButton === 'function') {
        try { window.setupPayButton(raw); } catch (_) {}
      }

      var summaryCard = document.querySelector('#booking-page .booking-summary-card');
      if (!summaryCard) return;

      summaryCard.querySelectorAll('.bmg-pool-summary-members-row').forEach(function (el) {
        el.remove();
      });

      if (count < 1) return;

      var chips = '';
      for (var m = 1; m <= count; m++) {
        chips +=
          '<span class="bmg-pool-summary-chip">' +
            '<span class="bmg-pool-summary-chip-num">' + m + '</span>' +
            'Member ' + m +
          '</span>';
      }

      var memberBlock = document.createElement('div');
      memberBlock.className = 'bmg-pool-summary-members-row';
      memberBlock.innerHTML =
        '<div class="bmg-pool-summary-sep"></div>' +
        '<div class="bmg-pool-summary-badge-row">' +
          '<span class="bmg-pool-summary-type-badge">🏊 Pool Booking</span>' +
          '<span class="bmg-pool-summary-member-badge">' +
            '<i class="fas fa-users" style="font-size:10px;margin-right:3px"></i>' +
            count + ' Member' + (count > 1 ? 's' : '') +
          '</span>' +
        '</div>' +
        (count > 1
          ? '<div class="bmg-pool-summary-breakdown">' +
              '<div class="bmg-pool-summary-breakdown-row">' +
                '<span>Price per person</span>' +
                '<span>₹' + perPer + '</span>' +
              '</div>' +
              '<div class="bmg-pool-summary-breakdown-row">' +
                '<span>Members</span>' +
                '<span>× ' + count + '</span>' +
              '</div>' +
              '<div class="bmg-pool-summary-breakdown-row bmg-pool-summary-breakdown-total">' +
                '<span>Total</span>' +
                '<span style="font-weight:800;color:#0f1f5c">₹' + total + '</span>' +
              '</div>' +
            '</div>'
          : '') +
        '<div class="bmg-pool-summary-chips">' + chips + '</div>';

      var hr = summaryCard.querySelector('hr');
      if (hr) {
        summaryCard.insertBefore(memberBlock, hr);
      } else {
        summaryCard.appendChild(memberBlock);
      }

      console.log('[pool-price-fix] booking-page DOM refreshed →',
        count, '× ₹' + perPer + ' = ₹' + total);

    }, 80);
  });

  /* ── PATCH 4: Wire pool-book-now-btn directly after pool-page shown ── */
  window.addEventListener('bmg:pageShown', function (e) {
    if (!e.detail || e.detail.pageId !== 'pool-page') return;
    setTimeout(function () {
      var btn = document.getElementById('pool-book-now-btn');
      if (!btn || btn._pricePatchedV1) return;
      var fresh = btn.cloneNode(true);
      btn.parentNode.replaceChild(fresh, btn);
      fresh._pricePatchedV1 = true;
      fresh.addEventListener('click', function () {
        var p    = getCorrectAmount();
        var slot = window.selectedPoolSlot;
        if (slot) {
          slot._memberCount   = p.count;
          slot._totalAmount   = p.total;
          slot.pricePerMember = p.perPer;
          window.selectedPoolSlot = slot;
        }
        window._poolMemberCount = p.count;
        if (typeof window.handlePoolBookNow === 'function') {
          window.handlePoolBookNow();
        }
      });
      console.log('[pool-price-fix] pool-book-now-btn re-wired');
    }, 150);
  });

  waitFor('handlePoolBookNow', applyHandlerPatch);

  console.log('[combined_patches] Section 2: pool_member_price_fix v1.0 loaded ✅');
})();


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 3 — ROBUST SLOT BOOKING DISPLAY FIX
   Source: SLOT_BOOKED_DISPLAY_FIX.js v1.0
   Authoritative markSlotAsConfirmed — uses set({merge:true}) so it works
   whether the doc exists or not. Also removes the premature setupPayButton
   slot-mark from EARNINGS_UPCOMING_BOOKED_FIX and adds a real-time retry.
═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  console.log('[slot-fix] SLOT_BOOKED_DISPLAY_FIX v1.0 loading…');

  function _db() { return window.db || null; }

  function _normaliseSlotTime(raw) {
    if (!raw) return '';
    return String(raw).replace(/\s/g, '');
  }

  function _startTime(slotTime) {
    var s = _normaliseSlotTime(slotTime);
    return s.includes('-') ? s.split('-')[0] : s;
  }

  function _endTime(slotTime) {
    var s = _normaliseSlotTime(slotTime);
    return s.includes('-') ? s.split('-')[1] : '';
  }

  function _resolveSlotTime(data) {
    return data.slotTime || data.time || data.slot_time || data.slottime || '';
  }

  /* ── Authoritative markSlotAsConfirmed ── */
  window.markSlotAsConfirmed = async function (bookingData) {
    var db = _db();
    if (!db) {
      console.warn('[slot-fix] markSlotAsConfirmed: Firebase db not ready');
      return false;
    }

    var groundId  = bookingData.groundId  || bookingData.ground_id  || '';
    var date      = bookingData.date      || bookingData.bookingDate || '';
    var rawSlot   = _resolveSlotTime(bookingData);
    var bookingId = bookingData.bookingId || bookingData.orderId || bookingData.id || '';
    var userId    = bookingData.userId    || bookingData.bookedBy
                    || (window.currentUser && window.currentUser.uid) || '';

    if (!groundId || !date || !rawSlot) {
      console.warn('[slot-fix] markSlotAsConfirmed: missing fields', {
        groundId: groundId, date: date, rawSlot: rawSlot
      });
      try {
        var stored = JSON.parse(
          sessionStorage.getItem('pendingBooking') ||
          sessionStorage.getItem('pendingCashfreeBooking') ||
          sessionStorage.getItem('currentBookingDetails') ||
          'null'
        );
        if (stored) {
          groundId  = groundId  || stored.groundId  || '';
          date      = date      || stored.date      || '';
          rawSlot   = rawSlot   || _resolveSlotTime(stored) || '';
          bookingId = bookingId || stored.bookingId || stored.orderId || '';
          userId    = userId    || stored.userId    || '';
        }
      } catch (_) {}

      if (!groundId || !date || !rawSlot) {
        console.warn('[slot-fix] markSlotAsConfirmed: still missing fields after session fallback — giving up');
        return false;
      }
    }

    var start = _startTime(rawSlot);
    var end   = _endTime(rawSlot);

    console.log('[slot-fix] markSlotAsConfirmed →', groundId, date, start, end, bookingId);

    var slotPayload = {
      groundId  : groundId,
      date      : date,
      startTime : start,
      endTime   : end,
      slotTime  : _normaliseSlotTime(rawSlot),
      status    : 'confirmed',
      bookingId : bookingId,
      bookedBy  : userId,
      bookedAt  : firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt : firebase.firestore.FieldValue.serverTimestamp(),
    };

    try {
      var query = db.collection('slots')
        .where('groundId', '==', groundId)
        .where('date',     '==', date)
        .where('startTime','==', start);

      var snap = await query.limit(1).get();

      if (!snap.empty) {
        await snap.docs[0].ref.update({
          status    : 'confirmed',
          bookingId : bookingId,
          bookedBy  : userId,
          bookedAt  : firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt : firebase.firestore.FieldValue.serverTimestamp(),
        });
        console.log('✅ [slot-fix] Slot UPDATED to confirmed:', start, '(doc:', snap.docs[0].id, ')');
        return true;
      }

      await db.collection('slots').add({
        ...slotPayload,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      console.log('✅ [slot-fix] Slot CREATED as confirmed:', rawSlot);
      return true;

    } catch (err) {
      console.error('[slot-fix] markSlotAsConfirmed error:', err);
      return false;
    }
  };

  /* ── Remove premature slot-marking from the setupPayButton wrap ── */
  (function fixPrematureSetupPayButtonWrap() {
    var currentSetup = window.setupPayButton;
    if (!currentSetup || currentSetup._slotFixCleaned) return;

    window.setupPayButton = function (bookingDetails) {
      return currentSetup.apply(this, arguments);
    };
    window.setupPayButton._slotFixCleaned = true;
    console.log('[slot-fix] setupPayButton premature slot-mark removed');
  })();

  /* ── Listen on bmg:paymentConfirmed ── */
  window.addEventListener('bmg:paymentConfirmed', async function (e) {
    if (!e.detail) return;
    var paymentType = e.detail.paymentType;
    if (paymentType !== 'booking') return;

    var data = e.detail.result || {};
    console.log('[slot-fix] bmg:paymentConfirmed received, marking slot…', data);

    var ok = await window.markSlotAsConfirmed(data);

    if (!ok) {
      var orderId = e.detail.orderId;
      if (orderId && _db()) {
        try {
          var snap = await _db().collection('bookings').doc(orderId).get();
          if (snap.exists) {
            await window.markSlotAsConfirmed(snap.data());
          } else {
            var qSnap = await _db().collection('bookings')
              .where('orderId', '==', orderId)
              .limit(1).get();
            if (!qSnap.empty) {
              await window.markSlotAsConfirmed(qSnap.docs[0].data());
            }
          }
        } catch (fetchErr) {
          console.warn('[slot-fix] Could not fetch booking doc for slot update:', fetchErr);
        }
      }
    }
  });

  /* ── Retry on confirmation-page shown (handles slow webhook) ── */
  window.addEventListener('bmg:pageShown', function (e) {
    if (!e.detail || e.detail.pageId !== 'confirmation-page') return;

    [3000, 6000, 12000].forEach(function (delay) {
      setTimeout(async function () {
        var stored = null;
        try {
          stored = JSON.parse(
            sessionStorage.getItem('pendingBooking') ||
            sessionStorage.getItem('pendingCashfreeBooking') ||
            sessionStorage.getItem('currentBookingDetails') ||
            'null'
          );
        } catch (_) {}

        if (!stored) return;

        var groundId = stored.groundId || '';
        var date     = stored.date     || '';
        var rawSlot  = _resolveSlotTime(stored);
        if (!groundId || !date || !rawSlot) return;

        var start = _startTime(rawSlot);

        try {
          var checkSnap = await _db().collection('slots')
            .where('groundId', '==', groundId)
            .where('date',     '==', date)
            .where('startTime','==', start)
            .limit(1).get();

          if (!checkSnap.empty && checkSnap.docs[0].data().status === 'confirmed') {
            return;
          }
        } catch (_) {}

        console.log('[slot-fix] Retry slot confirmation at ' + delay + 'ms…');
        await window.markSlotAsConfirmed(stored);
      }, delay);
    });
  });

  /* ── Manual confirm button on confirmation-page ── */
  (function patchConfirmBookingButton() {
    document.addEventListener('click', async function (e) {
      var btn = e.target.closest('#confirm-payment-yes, [data-action="confirm-booking"]');
      if (!btn) return;

      setTimeout(async function () {
        var stored = null;
        try {
          stored = JSON.parse(
            sessionStorage.getItem('pendingBooking') ||
            sessionStorage.getItem('pendingCashfreeBooking') ||
            sessionStorage.getItem('currentBookingDetails') ||
            'null'
          );
        } catch (_) {}
        if (stored) {
          console.log('[slot-fix] confirm-payment-yes clicked — marking slot…');
          await window.markSlotAsConfirmed(stored);
        }
      }, 800);
    });
  })();

  console.log('[combined_patches] Section 3: SLOT_BOOKED_DISPLAY_FIX v1.0 ready ✅');
})();


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 4 — SLOT PRE-CREATION & ROBUST SLOT MARK + OWNER AMOUNT REPAIR
   Source: FINAL_SLOT_EARNINGS_FIX.js v1.0
   Keeps: ensureSlotDocExists (pre-creates slot doc before payment so the Cloud
   Function can lock it), robustMarkSlot (belt-and-suspenders post-payment slot
   marking with retry at 2s/5s/10s), repairBookingOwnerAmount (fixes ownerAmount=0
   on confirmed booking docs), startPayment wrapper.
   Removed: reinstallEarningsFunctions / reinstallPayoutsFunction — superseded by
   GROUND_EARNINGS_PAYOUT_FIX which installs more aggressively (Section 6).
═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  console.log('[final-fix] FINAL_SLOT_EARNINGS_FIX v1.0 loading…');

  const _db  = () => window.db  || null;
  const _cu  = () => window.currentUser || null;
  const _FS  = () => window.firebase && window.firebase.firestore
                       ? window.firebase.firestore
                       : null;

  function _svTs() {
    const FS = _FS();
    return FS ? FS.FieldValue.serverTimestamp() : new Date();
  }

  function _resolveSlotTime(data) {
    return (data.slotTime || data.time || data.slot_time || data.slottime || '').replace(/\s/g, '');
  }

  function _startTime(raw) {
    const s = raw.replace(/\s/g, '');
    return s.includes('-') ? s.split('-')[0] : s;
  }

  function _endTime(raw) {
    const s = raw.replace(/\s/g, '');
    return s.includes('-') ? s.split('-')[1] : '';
  }

  /* ── PART 1: Ensure slot doc exists before payment initiates ── */
  async function ensureSlotDocExists(bookingData) {
    const db = _db();
    if (!db) return;
    if (!bookingData || !bookingData.groundId || !bookingData.date || !bookingData.slotTime) return;

    const rawSlot = _resolveSlotTime(bookingData);
    if (!rawSlot) return;

    const start = _startTime(rawSlot);
    const end   = _endTime(rawSlot);

    try {
      const snap = await db.collection('slots')
        .where('groundId',  '==', bookingData.groundId)
        .where('date',      '==', bookingData.date)
        .where('startTime', '==', start)
        .limit(1)
        .get();

      if (!snap.empty) {
        const existing = snap.docs[0].data();
        if (existing.status === 'booked' || existing.status === 'confirmed') {
          console.warn('[final-fix] Slot already booked, cannot proceed:', start);
          return;
        }
        console.log('[final-fix] Slot doc already exists:', snap.docs[0].id, existing.status);
        return;
      }

      await db.collection('slots').add({
        groundId  : bookingData.groundId,
        date      : bookingData.date,
        startTime : start,
        endTime   : end,
        slotTime  : rawSlot,
        status    : 'available',
        ownerId   : bookingData.ownerId || '',
        price     : Number(bookingData.amount) || 0,
        createdAt : _svTs(),
        updatedAt : _svTs(),
        _autoCreated: true,
      });
      console.log('[final-fix] ✅ Slot doc pre-created for lock step:', rawSlot);

    } catch (err) {
      console.warn('[final-fix] ensureSlotDocExists error (non-critical):', err);
    }
  }

  function wrapStartPayment() {
    const orig = window.startPayment;
    if (!orig || orig._finalFixWrapped) return;

    window.startPayment = async function (paymentType, paymentData, ...rest) {
      if (paymentType === 'booking' && paymentData) {
        await ensureSlotDocExists(paymentData);
      }
      return orig.call(this, paymentType, paymentData, ...rest);
    };
    window.startPayment._finalFixWrapped = true;
    console.log('[final-fix] startPayment wrapped — slot pre-creation enabled');
  }

  /* ── PART 2: Robust slot marking after payment (belt-and-suspenders) ── */
  async function robustMarkSlot(bookingData) {
    const db = _db();
    if (!db || !bookingData) return false;

    const groundId  = bookingData.groundId  || bookingData.ground_id || '';
    const date      = bookingData.date      || bookingData.bookingDate || '';
    const rawSlot   = _resolveSlotTime(bookingData);
    const bookingId = bookingData.bookingId || bookingData.orderId || bookingData.id || '';
    const userId    = bookingData.userId    || bookingData.bookedBy
                      || (_cu() && _cu().uid) || '';

    if (!groundId || !date || !rawSlot) {
      console.warn('[final-fix] robustMarkSlot: missing fields', { groundId, date, rawSlot });
      return false;
    }

    const start = _startTime(rawSlot);
    const end   = _endTime(rawSlot);

    const payload = {
      status    : 'booked',
      bookingId : bookingId,
      bookedBy  : userId,
      bookedAt  : _svTs(),
      updatedAt : _svTs(),
      lockOrderId    : null,
      lockBookingId  : null,
      lockExpiresAt  : null,
      lockExpiresAtMs: null,
    };

    try {
      const snap = await db.collection('slots')
        .where('groundId',  '==', groundId)
        .where('date',      '==', date)
        .where('startTime', '==', start)
        .limit(1)
        .get();

      if (!snap.empty) {
        await snap.docs[0].ref.update(payload);
        console.log('[final-fix] ✅ Slot updated to booked:', start, snap.docs[0].id);
        return true;
      }

      await db.collection('slots').add({
        groundId  : groundId,
        date      : date,
        startTime : start,
        endTime   : end,
        slotTime  : rawSlot,
        ownerId   : bookingData.ownerId || '',
        ...payload,
        createdAt : _svTs(),
        _autoCreated: true,
      });
      console.log('[final-fix] ✅ Slot doc CREATED as booked:', rawSlot);
      return true;

    } catch (err) {
      console.error('[final-fix] robustMarkSlot error:', err);
      return false;
    }
  }

  async function markSlotFromAllSources(orderId, initialData) {
    if (initialData && initialData.groundId && _resolveSlotTime(initialData)) {
      const ok = await robustMarkSlot(initialData);
      if (ok) return;
    }

    const db = _db();
    if (db && orderId) {
      try {
        let bData = null;
        const directSnap = await db.collection('bookings').doc(orderId).get();
        if (directSnap.exists) {
          bData = directSnap.data();
        } else {
          const qSnap = await db.collection('bookings')
            .where('orderId', '==', orderId).limit(1).get();
          if (!qSnap.empty) bData = qSnap.docs[0].data();
        }
        if (bData && bData.groundId && _resolveSlotTime(bData)) {
          const ok = await robustMarkSlot(bData);
          if (ok) return;
        }
      } catch (e) {
        console.warn('[final-fix] Firestore booking fetch error:', e);
      }
    }

    try {
      const stored = JSON.parse(
        sessionStorage.getItem('pendingBooking') ||
        sessionStorage.getItem('pendingCashfreeBooking') ||
        sessionStorage.getItem('currentBookingDetails') ||
        'null'
      );
      if (stored && stored.groundId && _resolveSlotTime(stored)) {
        await robustMarkSlot(stored);
      }
    } catch (_) {}
  }

  window.addEventListener('bmg:paymentConfirmed', async function (e) {
    if (!e.detail || e.detail.paymentType !== 'booking') return;
    console.log('[final-fix] bmg:paymentConfirmed received, running robust slot mark…');
    const orderId = e.detail.orderId;
    const data    = e.detail.result || {};
    await markSlotFromAllSources(orderId, data);
  });

  /* Retry on confirmation-page shown (handles slow webhook) */
  window.addEventListener('bmg:pageShown', async function (e) {
    if (!e.detail || e.detail.pageId !== 'confirmation-page') return;
    [2000, 5000, 10000].forEach(delay => {
      setTimeout(async () => {
        try {
          const stored = JSON.parse(
            sessionStorage.getItem('pendingBooking') ||
            sessionStorage.getItem('pendingCashfreeBooking') ||
            'null'
          );
          if (!stored || !stored.groundId) return;

          const db = _db();
          if (!db) return;
          const start = _startTime(_resolveSlotTime(stored));
          if (!start) return;
          const snap = await db.collection('slots')
            .where('groundId',  '==', stored.groundId)
            .where('date',      '==', stored.date)
            .where('startTime', '==', start)
            .limit(1).get();

          if (!snap.empty) {
            const st = snap.docs[0].data().status;
            if (st === 'booked' || st === 'confirmed') return;
          }

          console.log(`[final-fix] Retry slot mark at ${delay}ms…`);
          await robustMarkSlot(stored);
        } catch (_) {}
      }, delay);
    });
  });

  /* ── PART 3: Repair ownerAmount on confirmed booking docs after payment ── */
  async function repairBookingOwnerAmount(orderId, amount) {
    const db = _db();
    if (!db || !orderId || !amount) return;

    try {
      const ref  = db.collection('bookings').doc(orderId);
      const snap = await ref.get();
      if (!snap.exists) return;

      const data = snap.data();
      const storedOwner = Number(data.ownerAmount);
      if (storedOwner > 0) {
        console.log('[final-fix] ownerAmount already correct:', storedOwner);
        return;
      }

      const correctOwner    = Math.floor(Number(amount) * 0.9);
      const correctPlatform = Number(amount) - correctOwner;

      await ref.update({
        ownerAmount  : correctOwner,
        platformFee  : correctPlatform,
        commission   : correctPlatform,
        updatedAt    : _svTs(),
      });
      console.log('[final-fix] ✅ Repaired ownerAmount on booking:', orderId, '→ ₹' + correctOwner);

      const opRef  = db.collection('owner_payments').doc(`${orderId}_owner`);
      const opSnap = await opRef.get();
      if (opSnap.exists) {
        const opData = opSnap.data();
        if (!Number(opData.ownerAmount)) {
          await opRef.update({ ownerAmount: correctOwner, updatedAt: _svTs() });
        }
      }
    } catch (err) {
      console.warn('[final-fix] repairBookingOwnerAmount error (non-critical):', err);
    }
  }

  window.addEventListener('bmg:paymentConfirmed', async function (e) {
    if (!e.detail || e.detail.paymentType !== 'booking') return;

    const orderId = e.detail.orderId;
    const data    = e.detail.result || {};

    let amount = Number(data.amount || data.totalAmount || 0);
    if (!amount) {
      try {
        const stored = JSON.parse(
          sessionStorage.getItem('pendingBooking') ||
          sessionStorage.getItem('pendingCashfreeBooking') || 'null'
        );
        if (stored) amount = Number(stored.amount || stored.originalAmount || 0);
      } catch (_) {}
    }

    if (orderId && amount > 0) {
      await repairBookingOwnerAmount(orderId, amount);
    }

    window.dispatchEvent(new CustomEvent('bmg:earningsNeedRefresh'));
  });

  /* ── Wire earnings tab click to always reload with the latest function ── */
  document.addEventListener('click', function (e) {
    const tab = e.target.closest('[data-tab="earnings"], #owner-earnings-tab, [data-section="earnings"]');
    if (!tab) return;

    setTimeout(function () {
      const container = document.getElementById('owner-dashboard-content')
                     || document.getElementById('owner-earnings-content');
      if (!container) return;
      const fn = window.loadOwnerEarnings;
      if (typeof fn === 'function') {
        fn(container).catch(err => console.warn('[final-fix] earnings reload error:', err));
      }
    }, 100);
  });

  /* ── Auto-refresh earnings panel after payment ── */
  window.addEventListener('bmg:earningsNeedRefresh', function () {
    setTimeout(function () {
      const container = document.getElementById('owner-dashboard-content')
                     || document.getElementById('owner-earnings-content');
      if (!container) return;
      const earningsPanel = container.closest
        ? container.closest('#owner-dashboard-page')
        : null;
      if (earningsPanel && earningsPanel.style.display === 'none') return;
      const fn = window.loadOwnerEarnings;
      if (typeof fn === 'function') {
        console.log('[final-fix] Auto-refreshing earnings panel after payment…');
        fn(container).catch(() => {});
      }
    }, 1500);
  });

  function waitAndWrapStartPayment(attempt) {
    if (typeof window.startPayment === 'function') {
      wrapStartPayment();
      return;
    }
    if ((attempt || 0) > 100) {
      console.warn('[final-fix] Timeout waiting for startPayment');
      return;
    }
    setTimeout(() => waitAndWrapStartPayment((attempt || 0) + 1), 100);
  }
  waitAndWrapStartPayment();

  console.log('[combined_patches] Section 4: FINAL_SLOT_EARNINGS_FIX v1.0 slot parts active ✅');
})();


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 5 — UPCOMING BOOKING BANNER
   Source: EARNINGS_UPCOMING_BOOKED_FIX.js v1.0
   Keeps: loadUpcomingBookingBanner, markSlotAsConfirmed via bmg:bookingConfirmed,
   handlePaymentReturn wrap, loadUserBookings wrap, page-shown hooks.
   Removed: duplicate markSlotAsConfirmed definition (Section 3 is authoritative),
   duplicate _bmgLoadOwnerEarningsFull definition (Section 6 is authoritative).
═══════════════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';
  console.log('[FIX] Initializing Upcoming Banner Fix (Section 5)');

  /* ── loadUpcomingBookingBanner ── */
  /* ── Helper: check if a booking's time slot has already passed ── */
  function _isSlotExpired(booking, isPool) {
    try {
      const now = new Date();
      const bookingDate = booking.date;
      if (!bookingDate) return false;
      const todayStr = now.toISOString().split('T')[0];
      // If booking is on a future date, not expired
      if (bookingDate > todayStr) return false;
      // If booking is on a past date, always expired
      if (bookingDate < todayStr) return true;
      // Same day — check the time slot end time
      const slotTimeRaw = isPool
        ? (booking.time || booking.slotTime || '')
        : (booking.slotTime || booking.time || '');
      if (!slotTimeRaw) return false;
      // slotTime may be "09:00-10:00" or "09:00 AM - 10:00 AM" or "09:00 AM"
      const parts = slotTimeRaw.split('-');
      // Use end time if available, otherwise start time
      const endPart = (parts.length >= 2 ? parts[parts.length - 1] : parts[0]).trim();
      // Parse time — handle "HH:MM" and "HH:MM AM/PM"
      let endHour = 0, endMin = 0;
      const ampmMatch = endPart.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
      if (ampmMatch) {
        endHour = parseInt(ampmMatch[1], 10);
        endMin  = parseInt(ampmMatch[2], 10);
        if (ampmMatch[3]) {
          const isPM = ampmMatch[3].toUpperCase() === 'PM';
          if (isPM && endHour !== 12) endHour += 12;
          if (!isPM && endHour === 12) endHour = 0;
        }
      } else {
        return false;
      }
      const slotEnd = new Date(bookingDate + 'T00:00:00');
      slotEnd.setHours(endHour, endMin, 0, 0);
      return now > slotEnd;
    } catch(e) {
      return false;
    }
  }

  window.loadUpcomingBookingBanner = async function() {
    if (!window.db || !window.currentUser) return;

    try {
      const db     = window.db;
      const userId = window.currentUser.uid;
      const bannerEl = document.getElementById('spb-upcoming-banner');

      if (!bannerEl) {
        console.log('[loadUpcomingBookingBanner] Banner element not found');
        return;
      }

      const today = new Date().toISOString().split('T')[0];

      // Fetch more than 1 so we can skip time-expired slots on today's date
      const groundSnap = await db.collection('bookings')
        .where('userId', '==', userId)
        .where('bookingStatus', 'in', ['confirmed', 'completed'])
        .where('date', '>=', today)
        .orderBy('date', 'asc')
        .orderBy('slotTime', 'asc')
        .limit(10)
        .get();

      const poolSnap = await db.collection('pool_bookings')
        .where('userId', '==', userId)
        .where('bookingStatus', 'in', ['confirmed', 'completed'])
        .where('date', '>=', today)
        .orderBy('date', 'asc')
        .orderBy('time', 'asc')
        .limit(10)
        .get();

      let upcomingBooking = null;
      let isPool = false;

      // Find first ground booking whose time slot hasn't ended yet
      for (const doc of groundSnap.docs) {
        const d = doc.data();
        if (!_isSlotExpired(d, false)) {
          upcomingBooking = { ...d, id: doc.id, isPoolBooking: false };
          isPool = false;
          break;
        }
      }

      // Find first pool booking whose time slot hasn't ended yet
      let upcomingPool = null;
      for (const doc of poolSnap.docs) {
        const d = doc.data();
        if (!_isSlotExpired(d, true)) {
          upcomingPool = { ...d, id: doc.id, isPoolBooking: true };
          break;
        }
      }

      // Pick whichever is sooner
      if (upcomingPool) {
        const groundDate = upcomingBooking ? upcomingBooking.date : '9999-12-31';
        const poolDate   = upcomingPool.date;
        if (!upcomingBooking || poolDate < groundDate) {
          upcomingBooking = upcomingPool;
          isPool = true;
        }
      }

      if (!upcomingBooking) {
        bannerEl.style.display = 'none';
        return;
      }

      // Schedule auto-hide when this slot expires (real-time behaviour)
      try {
        const slotTimeRaw = isPool
          ? (upcomingBooking.time || upcomingBooking.slotTime || '')
          : (upcomingBooking.slotTime || upcomingBooking.time || '');
        const parts = slotTimeRaw.split('-');
        const endPart = (parts.length >= 2 ? parts[parts.length - 1] : parts[0]).trim();
        const ampmMatch = endPart.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
        if (ampmMatch && upcomingBooking.date) {
          let endH = parseInt(ampmMatch[1], 10);
          const endM = parseInt(ampmMatch[2], 10);
          if (ampmMatch[3]) {
            if (ampmMatch[3].toUpperCase() === 'PM' && endH !== 12) endH += 12;
            if (ampmMatch[3].toUpperCase() === 'AM' && endH === 12) endH = 0;
          }
          const slotEnd = new Date(upcomingBooking.date + 'T00:00:00');
          slotEnd.setHours(endH, endM, 0, 0);
          const msUntilEnd = slotEnd - new Date();
          if (msUntilEnd > 0 && msUntilEnd < 86400000) {
            setTimeout(() => {
              if (typeof window.loadUpcomingBookingBanner === 'function') {
                window.loadUpcomingBookingBanner().catch(() => {});
              }
            }, msUntilEnd + 1000);
          }
        }
      } catch(e) { /* non-critical */ }

      const bookingDate = new Date(upcomingBooking.date + 'T00:00:00');
      const dateStr = bookingDate.toLocaleDateString('en-IN', {
        weekday: 'short', month: 'short', day: 'numeric'
      });

      const timeSlot = isPool
        ? (upcomingBooking.time || upcomingBooking.slotTime || 'TBD')
        : (upcomingBooking.slotTime || upcomingBooking.time || 'TBD');

      const name = isPool
        ? (upcomingBooking.poolName || upcomingBooking.groundName || 'Swimming Pool')
        : (upcomingBooking.groundName || upcomingBooking.venueName || 'Sports Ground');

      const address = isPool
        ? (upcomingBooking.poolAddress || upcomingBooking.address || '')
        : (upcomingBooking.groundAddress || upcomingBooking.venueAddress || '');

      document.getElementById('spb-upcoming-name').textContent = name;
      document.getElementById('spb-upcoming-addr').textContent = address || 'Location details not available';
      document.getElementById('spb-upcoming-time').innerHTML = `
        <span style="font-size: 12px; font-weight: 700;">📅 ${dateStr}</span>
        <span style="font-size: 11px; opacity: 0.85; margin-left: 6px;">🕐 ${timeSlot}</span>
      `;

      bannerEl.classList.remove('empty');
      bannerEl.classList.add('active');
      bannerEl.style.display = 'flex';

      bannerEl.style.cursor = 'pointer';
      bannerEl.onclick = () => {
        if (typeof showPage === 'function') {
          showPage('my-bookings-page');
          console.log('✅ Navigated to bookings page');
        }
      };

      console.log(`✅ [loadUpcomingBookingBanner] Displayed: ${name} on ${dateStr}`);

    } catch (error) {
      console.error('[loadUpcomingBookingBanner] Error:', error);
    }
  };

  /* ── Wrap handlePaymentReturn to reload banner and fire refresh event ── */
  if (typeof window.handlePaymentReturn === 'function') {
    const originalHandlePaymentReturn = window.handlePaymentReturn;
    window.handlePaymentReturn = async function() {
      const result = await originalHandlePaymentReturn.apply(this, arguments);

      setTimeout(() => {
        if (typeof window.loadUpcomingBookingBanner === 'function') {
          window.loadUpcomingBookingBanner().catch(e => console.log('Banner update:', e));
        }
        window.dispatchEvent(new CustomEvent('bmg:bookingConfirmed', {
          detail: { refresh: true }
        }));
      }, 800);

      return result;
    };
  }

  /* ── Wrap loadUserBookings to update banner after bookings load ── */
  if (typeof window.loadUserBookings === 'function') {
    const originalLoadUserBookings = window.loadUserBookings;
    window.loadUserBookings = async function(...args) {
      const result = await originalLoadUserBookings.apply(this, arguments);

      setTimeout(() => {
        if (typeof window.loadUpcomingBookingBanner === 'function') {
          window.loadUpcomingBookingBanner().catch(e => console.log('Banner update:', e));
        }
      }, 300);

      return result;
    };
  }

  /* ── Load upcoming banner when home page is shown ── */
  window.addEventListener('bmg:pageShown', (e) => {
    if (e.detail?.pageId === 'home-page' || e.detail?.pageId === 'homepage') {
      setTimeout(() => {
        if (typeof window.loadUpcomingBookingBanner === 'function') {
          window.loadUpcomingBookingBanner();
        }
      }, 200);
    }
  });

  /* ── Reload banner on booking confirmation ── */
  window.addEventListener('bmg:bookingConfirmed', (e) => {
    if (typeof window.loadUpcomingBookingBanner === 'function') {
      window.loadUpcomingBookingBanner();
    }
  });

  console.log('[combined_patches] Section 5: Upcoming Banner Fix loaded ✅');
})();


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 6 — AUTHORITATIVE EARNINGS + PAYOUTS FUNCTIONS
   Source: GROUND_EARNINGS_PAYOUT_FIX.js v1.0  (primary)
           PAYOUT_EARNINGS_FIX.js v1.0           (convenience global only)
           EARNINGS_RECEIVED_FIX.js v1.0          (event listeners only)
   This section installs at 0ms, 300ms, 800ms, 1500ms and via MutationObserver
   to guarantee it always wins against all other patches.
   computeRealBalance uses owner_payments + payout_requests (deduped).
   computeCorrectBalance from EARNINGS_RECEIVED_FIX (payout_requests only) is
   NOT kept separately — GROUND_EARNINGS_PAYOUT_FIX's approach covers it.
═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  console.log('[ground-earnings-fix] Loading v1.0…');

  /* ─── Helpers ── */
  const _db  = () => window.db || null;
  const _cu  = () => window.currentUser || null;
  const _fmt = (v) => {
    if (typeof window.formatCurrency === 'function') return window.formatCurrency(v || 0);
    return '₹' + Number(v || 0).toLocaleString('en-IN');
  };
  const _esc = (s) => String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const _toast = (m, t) => {
    if (typeof window.showToast === 'function') window.showToast(m, t);
    else console.log('[ground-earnings-fix]', t, m);
  };
  const _loading = (m) => { if (typeof window.showLoading === 'function') window.showLoading(m); };
  const _done    = ()   => { if (typeof window.hideLoading === 'function') window.hideLoading(); };

  function _isoDate(offsetDays) {
    const d = new Date(Date.now() - offsetDays * 86400000);
    return d.toISOString().split('T')[0];
  }
  function _fmtDate(ts) {
    if (!ts) return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     CORE — computeRealBalance(ownerId)
     Single source of truth for all balance figures.
     Uses owner_payments + paid payout_requests (deduped) for received amount.
  ═══════════════════════════════════════════════════════════════════════ */
  async function computeRealBalance(ownerId) {
    const db = _db();
    if (!db || !ownerId) return { earned: 0, groundEarned: 0, poolEarned: 0, tournamentEarned: 0, received: 0, locked: 0, available: 0, pendingRequests: [] };

    /* ── Ground bookings ── */
    const gSnap = await db.collection('bookings')
      .where('ownerId', '==', ownerId)
      .where('bookingStatus', '==', 'confirmed')
      .get().catch(() => ({ docs: [] }));

    let groundEarned = 0;
    gSnap.docs.forEach(d => {
      const data = d.data();
      const amt = Number(data.ownerAmount);
      groundEarned += amt > 0 ? amt : Math.floor(Number(data.amount || data.totalAmount || 0) * 0.9);
    });

    /* ── Pool bookings — query both status fields, deduplicate ── */
    const [pByStatus, pByBookingStatus] = await Promise.all([
      db.collection('pool_bookings').where('ownerId', '==', ownerId).where('status', '==', 'confirmed').get().catch(() => ({ docs: [] })),
      db.collection('pool_bookings').where('ownerId', '==', ownerId).where('bookingStatus', '==', 'confirmed').get().catch(() => ({ docs: [] })),
    ]);

    let poolEarned = 0;
    const seenPool = new Set();
    [...pByStatus.docs, ...pByBookingStatus.docs].forEach(d => {
      if (seenPool.has(d.id)) return;
      seenPool.add(d.id);
      const data = d.data();
      const amt = Number(data.ownerAmount);
      poolEarned += amt > 0 ? amt : Math.floor(Number(data.amount || 0) * 0.9);
    });

    /* ── Tournament earnings ── */
    let tournamentEarned = 0;
    try {
      const tSnap = await db.collection('tournaments').where('ownerId', '==', ownerId).get().catch(() => ({ docs: [] }));
      if (!tSnap.empty) {
        const ids = tSnap.docs.map(d => d.id);
        for (let i = 0; i < ids.length; i += 30) {
          const chunk = ids.slice(i, i + 30);
          const eSnap = await db.collection('tournament_entries').where('tournamentId', 'in', chunk).get().catch(() => ({ docs: [] }));
          eSnap.docs.forEach(d => {
            const e = d.data();
            if (e.status !== 'confirmed' && e.paymentStatus !== 'paid') return;
            tournamentEarned += Number(e.ownerAmount) || Math.round(Number(e.amount || 0) * 0.8);
          });
        }
      }
    } catch (_) {}

    const totalEarned = groundEarned + poolEarned + tournamentEarned;

    /* ── Already received: only paid payout_requests ── */
    /* NOTE: owner_payments records are written by the Cloud Function as internal
       payment receipts — they are NOT transfers to the owner. Counting them as
       "received" incorrectly zeroes out the available balance. Only payout_requests
       with status='paid' represent confirmed disbursements to the owner. */
    const ppSnap = await db.collection('payout_requests')
      .where('ownerId', '==', ownerId).where('status', '==', 'paid')
      .get().catch(() => ({ docs: [] }));

    let totalReceived = 0;
    const seenReceived = new Set();
    ppSnap.docs.forEach(d => {
      if (seenReceived.has(d.id)) return;
      seenReceived.add(d.id);
      totalReceived += Number(d.data().amount || 0);
    });

    /* ── Locked in pending/approved requests ── */
    const pendSnap = await db.collection('payout_requests')
      .where('ownerId', '==', ownerId)
      .where('status', 'in', ['pending', 'approved'])
      .get().catch(() => ({ docs: [] }));

    let totalLocked = 0;
    const pendingRequests = [];
    pendSnap.docs.forEach(d => {
      const p = d.data();
      totalLocked += Number(p.amount || 0);
      pendingRequests.push({ id: d.id, ...p });
    });

    const available = Math.max(0, totalEarned - totalReceived - totalLocked);

    return { earned: totalEarned, groundEarned, poolEarned, tournamentEarned, received: totalReceived, locked: totalLocked, available, pendingRequests };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     EARNINGS TAB RENDERER
  ═══════════════════════════════════════════════════════════════════════ */
  async function renderEarningsTab(container) {
    const cu = _cu(), db = _db();
    if (!cu || !db) {
      container.innerHTML = '<p style="text-align:center;padding:32px;color:#9ca3af;">Please log in to view earnings.</p>';
      return;
    }

    _loading('Calculating earnings…');

    try {
      const bal = await computeRealBalance(cu.uid);

      const bSnap = await db.collection('bookings')
        .where('ownerId', '==', cu.uid)
        .where('bookingStatus', '==', 'confirmed')
        .get().catch(() => ({ docs: [] }));

      const today = _isoDate(0), week = _isoDate(6), month = _isoDate(29);
      let todayE = 0, weekE = 0, monthE = 0;
      bSnap.docs.forEach(d => {
        const b = d.data();
        const amt = Number(b.ownerAmount) || Math.floor(Number(b.amount || 0) * 0.9);
        if (b.date === today)   todayE  += amt;
        if (b.date >= week)     weekE   += amt;
        if (b.date >= month)    monthE  += amt;
      });

      _done();

      const pendingNotice = bal.pendingRequests.length > 0
        ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:12px 14px;margin-bottom:16px;display:flex;align-items:center;gap:10px;">
            <i class="fas fa-clock" style="color:#f59e0b;font-size:16px;flex-shrink:0;"></i>
            <div>
              <div style="font-weight:700;color:#92400e;font-size:13px;">Payout Under Review</div>
              <div style="font-size:12px;color:#b45309;margin-top:2px;">${_fmt(bal.locked)} is in a pending payout request and cannot be withdrawn again.</div>
            </div>
          </div>`
        : '';

      container.innerHTML = `
        <!-- Period stats -->
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;">
          ${[['Today', todayE], ['This Week', weekE], ['This Month', monthE]].map(([label, val]) => `
            <div style="background:#f0f4ff;border-radius:12px;padding:12px;text-align:center;">
              <div style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px;">${label}</div>
              <div style="font-size:18px;font-weight:800;color:#2563eb;">${_fmt(val)}</div>
            </div>`).join('')}
        </div>

        <!-- Balance hero -->
        <div style="background:linear-gradient(135deg,#1b2e6c,#2563eb);border-radius:16px;padding:20px;margin-bottom:16px;color:#fff;">
          <div style="font-size:12px;opacity:.8;margin-bottom:6px;"><i class="fas fa-wallet"></i> Available to Withdraw</div>
          <div style="font-size:34px;font-weight:800;letter-spacing:-0.6px;margin-bottom:4px;">${_fmt(bal.available)}</div>
          <div style="font-size:11px;opacity:.7;">Real balance after deductions</div>
          <div style="margin-top:12px;background:rgba(255,255,255,.12);border-radius:10px;padding:10px 12px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
              <span style="font-size:12px;opacity:.85;">Total Earned</span>
              <span style="font-size:13px;font-weight:700;">${_fmt(bal.earned)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;margin-bottom:${bal.locked > 0 ? '6px' : '0'};">
              <span style="font-size:12px;opacity:.85;">Already Received</span>
              <span style="font-size:13px;font-weight:700;color:#86efac;">− ${_fmt(bal.received)}</span>
            </div>
            ${bal.locked > 0 ? `
            <div style="display:flex;justify-content:space-between;margin-bottom:0;">
              <span style="font-size:12px;opacity:.85;">In Review (pending)</span>
              <span style="font-size:13px;font-weight:700;color:#fde047;">− ${_fmt(bal.locked)}</span>
            </div>` : ''}
            <div style="border-top:1px solid rgba(255,255,255,.2);margin-top:8px;padding-top:8px;display:flex;justify-content:space-between;">
              <span style="font-size:12px;font-weight:700;">Available Now</span>
              <span style="font-size:14px;font-weight:800;color:#86efac;">${_fmt(bal.available)}</span>
            </div>
          </div>
        </div>

        <!-- Earnings breakdown -->
        <div style="background:#fff;border:1.5px solid #e8edf8;border-radius:14px;padding:14px;margin-bottom:16px;">
          <div style="font-size:13px;font-weight:800;color:#0f1f5c;margin-bottom:10px;"><i class="fas fa-chart-bar" style="color:#2563eb;margin-right:6px;"></i>Earnings Breakdown</div>
          <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0f4ff;">
            <span style="font-size:13px;color:#374151;"><i class="fas fa-futbol" style="color:#22c55e;margin-right:6px;width:14px;"></i>Ground Bookings</span>
            <span style="font-size:13px;font-weight:700;color:#15803d;">${_fmt(bal.groundEarned)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:8px 0;${bal.tournamentEarned > 0 ? 'border-bottom:1px solid #f0f4ff;' : ''}">
            <span style="font-size:13px;color:#374151;"><i class="fas fa-swimming-pool" style="color:#0ea5e9;margin-right:6px;width:14px;"></i>Pool Bookings</span>
            <span style="font-size:13px;font-weight:700;color:#0369a1;">${_fmt(bal.poolEarned)}</span>
          </div>
          ${bal.tournamentEarned > 0 ? `
          <div style="display:flex;justify-content:space-between;padding:8px 0;">
            <span style="font-size:13px;color:#374151;"><i class="fas fa-trophy" style="color:#7c3aed;margin-right:6px;width:14px;"></i>Tournaments</span>
            <span style="font-size:13px;font-weight:700;color:#7c3aed;">${_fmt(bal.tournamentEarned)}</span>
          </div>` : ''}
          <div style="display:flex;justify-content:space-between;padding:8px 0;border-top:2px solid #e8edf8;margin-top:4px;">
            <span style="font-size:13px;font-weight:700;color:#0f1f5c;">Total Earned</span>
            <span style="font-size:14px;font-weight:800;color:#0f1f5c;">${_fmt(bal.earned)}</span>
          </div>
        </div>

        ${pendingNotice}

        <!-- CTA -->
        ${bal.available > 0
          ? `<div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:14px;padding:14px;">
              <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
                <i class="fas fa-check-circle" style="color:#22c55e;font-size:18px;"></i>
                <div>
                  <div style="font-weight:700;color:#15803d;font-size:13px;">${_fmt(bal.available)} Ready to Withdraw</div>
                  <div style="font-size:12px;color:#166534;">Processed within 2–3 business days</div>
                </div>
              </div>
              <button onclick="window._bmgOpenPayoutModal()"
                style="width:100%;padding:13px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;border-radius:12px;font-weight:700;font-size:14px;cursor:pointer;font-family:inherit;">
                <i class="fas fa-paper-plane" style="margin-right:6px;"></i> Request Payout
              </button>
            </div>`
          : `<div style="background:#fffbeb;border:1.5px solid #fde68a;border-radius:14px;padding:14px;display:flex;align-items:center;gap:10px;">
              <i class="fas fa-info-circle" style="color:#f59e0b;font-size:16px;"></i>
              <div>
                <div style="font-weight:700;color:#92400e;font-size:13px;">${bal.earned > 0 ? 'No Balance Available' : 'No Earnings Yet'}</div>
                <div style="font-size:12px;color:#b45309;">
                  ${bal.locked > 0
                    ? `${_fmt(bal.locked)} is already under a pending payout request.`
                    : 'Earnings appear here after your first confirmed booking.'}
                </div>
              </div>
            </div>`}
      `;

      window._bmgCurrentBalance = bal;

    } catch (err) {
      _done();
      console.error('[ground-earnings-fix] renderEarningsTab error:', err);
      container.innerHTML = `
        <div style="background:#fee2e2;border-left:4px solid #ef4444;border-radius:12px;padding:14px;">
          <div style="font-weight:700;color:#991b1b;">Error Loading Earnings</div>
          <div style="font-size:12px;color:#b91c1c;margin-top:4px;">${_esc(err.message)}</div>
          <button onclick="window._bmgReloadEarnings()" style="margin-top:10px;padding:8px 16px;background:#ef4444;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-family:inherit;">Retry</button>
        </div>`;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     PAYOUTS TAB RENDERER
  ═══════════════════════════════════════════════════════════════════════ */
  async function renderPayoutsTab(container) {
    const cu = _cu(), db = _db();
    if (!cu || !db) {
      container.innerHTML = '<p style="text-align:center;padding:32px;color:#9ca3af;">Please log in.</p>';
      return;
    }

    _loading('Loading payouts…');

    try {
      const bal = await computeRealBalance(cu.uid);

      const prSnap = await db.collection('payout_requests')
        .where('ownerId', '==', cu.uid)
        .orderBy('createdAt', 'desc')
        .get().catch(async () => {
          return db.collection('payout_requests').where('ownerId', '==', cu.uid).get().catch(() => ({ docs: [] }));
        });

      const stats = { total: prSnap.docs.length, pending: 0, approved: 0, paid: 0, rejected: 0 };
      prSnap.docs.forEach(d => { const st = d.data().status; if (stats[st] !== undefined) stats[st]++; });
      const hasPending = bal.pendingRequests.length > 0;

      const opSnap = await db.collection('owner_payments')
        .where('ownerId', '==', cu.uid)
        .get().catch(() => ({ docs: [] }));

      const receivedItems = [];
      const seenIds = new Set();
      opSnap.docs.forEach(d => { seenIds.add(d.id); receivedItems.push({ id: d.id, ...d.data() }); });
      prSnap.docs.forEach(d => {
        if (d.data().status === 'paid' && !seenIds.has(d.id))
          receivedItems.push({ id: d.id, ...d.data(), _fromPayout: true });
      });
      receivedItems.sort((a, b) => {
        const ta = a.paidAt?.toDate ? a.paidAt.toDate().getTime() : 0;
        const tb = b.paidAt?.toDate ? b.paidAt.toDate().getTime() : 0;
        return tb - ta;
      });

      function _statusCard(docId, p) {
        const st     = p.status || 'pending';
        const icons  = { pending: 'fa-clock', approved: 'fa-check-circle', paid: 'fa-money-bill-wave', rejected: 'fa-times-circle' };
        const labels = { pending: 'Under Review', approved: 'Approved', paid: 'Paid ✓', rejected: 'Rejected' };
        const colors = { pending: '#f59e0b', approved: '#3b82f6', paid: '#22c55e', rejected: '#ef4444' };
        return `
          <div class="psp-card" data-status="${st}" style="background:#fff;border-radius:14px;padding:14px;margin-bottom:10px;border:1.5px solid #e8edf8;box-shadow:0 2px 8px rgba(15,31,92,.06);">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
              <div>
                <div style="font-size:13px;font-weight:800;color:#0f1f5c;">Payout Request</div>
                <div style="font-size:11px;color:#9ca3af;margin-top:2px;">${_fmtDate(p.createdAt)}</div>
              </div>
              <div style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:20px;background:${colors[st]}18;color:${colors[st]};font-size:11px;font-weight:700;">
                <i class="fas ${icons[st] || 'fa-circle'}"></i> ${labels[st] || st}
              </div>
            </div>
            <div style="font-size:24px;font-weight:800;color:#0f1f5c;margin-bottom:6px;">${_fmt(p.amount)}</div>
            ${p.upiId ? `<div style="font-size:12px;color:#6b7280;"><i class="fas fa-qrcode" style="margin-right:5px;"></i>${_esc(p.upiId)}</div>` : ''}
            ${p.status === 'rejected' && p.rejectionReason ? `
            <div style="margin-top:8px;background:#fee2e2;border-radius:8px;padding:8px 10px;font-size:12px;color:#b91c1c;">
              <i class="fas fa-times-circle"></i> ${_esc(p.rejectionReason)}
            </div>` : ''}
          </div>`;
      }

      _done();

      container.innerHTML = `
        <!-- Balance hero -->
        <div style="background:linear-gradient(135deg,#1b2e6c,#2563eb);border-radius:16px;padding:20px;margin-bottom:16px;color:#fff;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;">
            <div>
              <div style="font-size:11px;opacity:.75;margin-bottom:4px;"><i class="fas fa-wallet"></i> Available to Withdraw</div>
              <div style="font-size:34px;font-weight:800;letter-spacing:-0.6px;">${_fmt(bal.available)}</div>
              <div style="font-size:11px;opacity:.65;margin-top:4px;">
                Earned ${_fmt(bal.earned)}${bal.received > 0 ? ` · Received ${_fmt(bal.received)}` : ''}${bal.locked > 0 ? ` · In review ${_fmt(bal.locked)}` : ''}
              </div>
            </div>
            <button id="psp-apply-trigger"
              ${hasPending || bal.available < 1 ? 'disabled' : ''}
              style="background:rgba(255,255,255,.18);border:1.5px solid rgba(255,255,255,.35);color:#fff;font-size:12px;font-weight:700;padding:10px 14px;border-radius:22px;cursor:${hasPending || bal.available < 1 ? 'not-allowed' : 'pointer'};white-space:nowrap;font-family:inherit;opacity:${hasPending || bal.available < 1 ? '.6' : '1'};">
              <i class="fas fa-paper-plane" style="margin-right:5px;"></i>
              ${hasPending ? 'Request Pending' : 'Apply for Payout'}
            </button>
          </div>
          ${bal.locked > 0 ? `
          <div style="margin-top:12px;background:rgba(255,255,255,.1);border-radius:8px;padding:8px 10px;font-size:11px;opacity:.85;display:flex;align-items:center;gap:6px;">
            <i class="fas fa-clock" style="color:#fde047;"></i>
            <span>${_fmt(bal.locked)} is already under a pending payout request.</span>
          </div>` : ''}
        </div>

        <!-- Stats row -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px;">
          ${[['Total', stats.total, '#0f1f5c', '#f8faff', '#e8edf8'], ['In Progress', stats.pending + stats.approved, '#92400e', '#fffbeb', '#fde68a'], ['Paid', stats.paid, '#15803d', '#f0fdf4', '#86efac'], ['Rejected', stats.rejected, '#b91c1c', '#fef2f2', '#fca5a5']].map(([label, val, textColor, bg, border]) => `
          <div style="background:${bg};border-radius:12px;padding:10px;text-align:center;border:1px solid ${border};">
            <div style="font-size:18px;font-weight:800;color:${textColor};">${val}</div>
            <div style="font-size:10px;color:${textColor};font-weight:600;opacity:.75;margin-top:2px;">${label}</div>
          </div>`).join('')}
        </div>

        <!-- Filter bar -->
        <div id="gef-filter-bar" style="display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;margin-bottom:14px;scrollbar-width:none;">
          ${['all', 'pending', 'approved', 'paid', 'rejected'].map((f, i) => `
          <button class="psp-filter-btn${i === 0 ? ' active' : ''}" data-filter="${f}"
            style="flex-shrink:0;padding:7px 14px;border-radius:20px;border:1.5px solid ${i === 0 ? '#2563eb' : '#e8edf8'};background:${i === 0 ? '#eff6ff' : '#fff'};color:${i === 0 ? '#1d4ed8' : '#6b7280'};font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap;">
            ${f.charAt(0).toUpperCase() + f.slice(1)}
          </button>`).join('')}
        </div>

        <!-- Requests list -->
        <div id="gef-payouts-list">
          ${prSnap.docs.length === 0
            ? `<div style="text-align:center;padding:36px 16px;">
                <div style="font-size:40px;opacity:.3;margin-bottom:10px;">💸</div>
                <div style="font-size:14px;font-weight:600;color:#9ca3af;">No payout requests yet.</div>
                <div style="font-size:12px;color:#d1d5db;margin-top:4px;">Apply for your first payout above.</div>
              </div>`
            : prSnap.docs.map(d => _statusCard(d.id, d.data())).join('')}
        </div>

        <!-- Received payments -->
        ${receivedItems.length > 0 ? `
        <div style="margin-top:16px;">
          <div style="font-size:13px;font-weight:800;color:#0f1f5c;margin-bottom:10px;">
            <i class="fas fa-check-circle" style="color:#16a34a;margin-right:6px;"></i>Received Payments (${receivedItems.length})
          </div>
          ${receivedItems.map(p => `
          <div style="display:flex;justify-content:space-between;align-items:center;background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:12px;padding:12px 14px;margin-bottom:8px;">
            <div>
              <div style="font-size:13px;font-weight:700;color:#15803d;">${_fmt(p.ownerAmount || p.amount || 0)}</div>
              <div style="font-size:11px;color:#6b7280;margin-top:2px;">${_fmtDate(p.paidAt || p.createdAt)} · via ${_esc(p.method || 'Bank Transfer')}</div>
            </div>
            <div style="display:inline-flex;align-items:center;gap:4px;background:#dcfce7;color:#15803d;font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;">
              <i class="fas fa-check"></i> Received
            </div>
          </div>`).join('')}
        </div>` : ''}
      `;

      document.getElementById('gef-filter-bar')?.addEventListener('click', e => {
        const btn = e.target.closest('.psp-filter-btn');
        if (!btn) return;
        document.querySelectorAll('#gef-filter-bar .psp-filter-btn').forEach(b => {
          b.style.borderColor = '#e8edf8'; b.style.background = '#fff'; b.style.color = '#6b7280';
          b.classList.remove('active');
        });
        btn.style.borderColor = '#2563eb'; btn.style.background = '#eff6ff'; btn.style.color = '#1d4ed8';
        btn.classList.add('active');
        const f = btn.dataset.filter;
        document.querySelectorAll('#gef-payouts-list .psp-card').forEach(c => {
          c.style.display = (f === 'all' || c.dataset.status === f) ? '' : 'none';
        });
      });

      document.getElementById('psp-apply-trigger')?.addEventListener('click', function () {
        if (this.disabled) return;
        _openApplyModal(bal.available, cu);
      });

    } catch (err) {
      _done();
      console.error('[ground-earnings-fix] renderPayoutsTab error:', err);
      container.innerHTML = `<p style="text-align:center;color:#ef4444;padding:32px;">${_esc(err.message)}</p>`;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     PAYOUT APPLY MODAL
  ═══════════════════════════════════════════════════════════════════════ */
  function _openApplyModal(available, cu) {
    document.getElementById('gef-payout-modal')?.remove();

    const ov = document.createElement('div');
    ov.id = 'gef-payout-modal';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(10,20,60,.6);backdrop-filter:blur(6px);z-index:9999;display:flex;align-items:flex-end;';
    ov.innerHTML = `
      <div style="background:#fff;border-radius:24px 24px 0 0;width:100%;max-height:92vh;overflow-y:auto;padding-bottom:env(safe-area-inset-bottom,0px);">
        <div style="width:40px;height:4px;border-radius:2px;background:#e2e8f0;margin:10px auto;"></div>
        <div style="padding:16px 18px 24px;">
          <div style="font-size:18px;font-weight:800;color:#0f1f5c;margin-bottom:4px;"><i class="fas fa-paper-plane" style="color:#2563eb;margin-right:8px;"></i>Apply for Payout</div>
          <div style="font-size:13px;color:#6b7280;margin-bottom:18px;">Reviewed by admin within 2–3 business days.</div>

          <div style="background:#f0f4ff;border:1.5px solid #bfdbfe;border-radius:12px;padding:12px 14px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:13px;font-weight:600;color:#374151;"><i class="fas fa-wallet" style="color:#2563eb;margin-right:6px;"></i>Available Balance</span>
            <span style="font-size:18px;font-weight:800;color:#1d4ed8;">${_fmt(available)}</span>
          </div>

          <label style="font-size:13px;font-weight:700;color:#374151;display:block;margin-bottom:6px;">Payout Amount (₹)</label>
          <input id="gef-amt" type="number" min="1" max="${available}" value="${available}"
            style="width:100%;padding:12px 14px;border:2px solid #e8edf8;border-radius:12px;font-size:16px;font-weight:700;color:#0f1f5c;background:#f8faff;outline:none;box-sizing:border-box;font-family:inherit;margin-bottom:6px;">
          <div id="gef-amt-err" style="color:#ef4444;font-size:12px;margin-bottom:8px;display:none;"></div>

          <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">
            ${[25, 50, 75, 100].map(p => `
            <button onclick="document.getElementById('gef-amt').value=Math.floor(${available}*${p}/100);document.getElementById('gef-amt-err').style.display='none';"
              style="flex:1;padding:7px 4px;background:#f0f4ff;border:1px solid #c7d2fe;border-radius:10px;color:#2563eb;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">${p}%</button>`).join('')}
          </div>

          <label style="font-size:13px;font-weight:700;color:#374151;display:block;margin-bottom:6px;"><i class="fas fa-qrcode" style="color:#2563eb;margin-right:5px;"></i>UPI ID</label>
          <input id="gef-upi" type="text" value="${_esc(cu.upiId || '')}" placeholder="yourname@upi"
            style="width:100%;padding:12px 14px;border:2px solid #e8edf8;border-radius:12px;font-size:14px;color:#0f1f5c;background:#f8faff;outline:none;box-sizing:border-box;font-family:inherit;margin-bottom:6px;">
          <div id="gef-upi-err" style="color:#ef4444;font-size:12px;margin-bottom:8px;display:none;"></div>

          <label style="font-size:13px;font-weight:700;color:#374151;display:block;margin-bottom:6px;">Note (optional)</label>
          <input id="gef-note" type="text" placeholder="e.g. Monthly withdrawal"
            style="width:100%;padding:12px 14px;border:2px solid #e8edf8;border-radius:12px;font-size:14px;color:#0f1f5c;background:#f8faff;outline:none;box-sizing:border-box;font-family:inherit;margin-bottom:16px;">

          <div style="background:#fffbeb;border-radius:10px;padding:10px 12px;margin-bottom:18px;display:flex;align-items:flex-start;gap:8px;font-size:12px;color:#92400e;">
            <i class="fas fa-info-circle" style="margin-top:1px;flex-shrink:0;"></i>
            <span>Ensure your UPI ID is correct. Payments cannot be reversed once sent.</span>
          </div>

          <div id="gef-submit-err" style="color:#ef4444;font-size:12px;text-align:center;margin-bottom:10px;display:none;"></div>
          <div style="display:flex;gap:10px;">
            <button id="gef-cancel" style="flex:1;padding:13px;border:2px solid #e8edf8;border-radius:12px;background:#fff;color:#374151;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;">Cancel</button>
            <button id="gef-submit" style="flex:2;padding:13px;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;">
              <i class="fas fa-paper-plane" style="margin-right:6px;"></i> Submit Request
            </button>
          </div>
        </div>
      </div>`;

    document.body.appendChild(ov);
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
    document.getElementById('gef-cancel').addEventListener('click', () => ov.remove());

    document.getElementById('gef-submit').addEventListener('click', async function () {
      const amtEl  = document.getElementById('gef-amt');
      const upiEl  = document.getElementById('gef-upi');
      const noteEl = document.getElementById('gef-note');
      const amtErr = document.getElementById('gef-amt-err');
      const upiErr = document.getElementById('gef-upi-err');
      const subErr = document.getElementById('gef-submit-err');
      const btn    = this;

      const amt  = parseFloat(amtEl.value);
      const upi  = upiEl.value.trim();
      const note = noteEl.value.trim();

      amtErr.style.display = 'none'; upiErr.style.display = 'none'; subErr.style.display = 'none';

      if (!amt || amt < 1) { amtErr.textContent = 'Please enter a valid amount.'; amtErr.style.display = 'block'; return; }
      if (amt > available + 0.5) { amtErr.textContent = `Exceeds available balance of ${_fmt(available)}.`; amtErr.style.display = 'block'; return; }
      if (!upi) { upiErr.textContent = 'Please enter your UPI ID.'; upiErr.style.display = 'block'; return; }

      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:6px;"></i> Submitting…';

      try {
        const latestPending = await _db().collection('payout_requests')
          .where('ownerId', '==', cu.uid)
          .where('status', 'in', ['pending', 'approved'])
          .get().catch(() => ({ empty: true }));

        if (!latestPending.empty) {
          subErr.textContent = 'You already have a pending request. Please wait for it to be processed.';
          subErr.style.display = 'block';
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-paper-plane" style="margin-right:6px;"></i> Submit Request';
          return;
        }

        const now = firebase.firestore.FieldValue.serverTimestamp();
        await _db().collection('payout_requests').add({
          requestId      : 'POUT-' + Date.now(),
          ownerId        : cu.uid,
          ownerName      : cu.ownerName || cu.name || '',
          ownerEmail     : cu.email || '',
          ownerPhone     : cu.phone || '',
          upiId          : upi,
          amount         : Math.round(amt),
          requestedAmount: Math.round(amt),
          note,
          status         : 'pending',
          bookingIds     : [],
          createdAt      : now,
          updatedAt      : now,
        });

        ov.remove();
        _toast('✅ Payout request submitted! Admin will review within 2–3 business days.', 'success');

        const cont = document.getElementById('owner-dashboard-content');
        if (cont) renderPayoutsTab(cont);

      } catch (err) {
        subErr.textContent = 'Error: ' + err.message;
        subErr.style.display = 'block';
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane" style="margin-right:6px;"></i> Submit Request';
      }
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     BOOKING REPAIR — ensures ownerAmount is set on confirmed booking docs
  ═══════════════════════════════════════════════════════════════════════ */
  window.addEventListener('bmg:paymentConfirmed', async function (e) {
    const { orderId, paymentType } = e.detail || {};
    if (paymentType !== 'booking' || !orderId) return;

    const db = _db();
    if (!db) return;

    try {
      const bookDoc = await db.collection('bookings').doc(orderId).get();
      if (!bookDoc.exists) {
        await new Promise(r => setTimeout(r, 3000));
        const retry = await db.collection('bookings').doc(orderId).get();
        if (!retry.exists) return;
        const data = retry.data();
        if (!data.ownerAmount || data.ownerAmount <= 0) {
          const corrected = Math.floor(Number(data.amount || data.totalAmount || 0) * 0.9);
          if (corrected > 0) {
            await retry.ref.update({ ownerAmount: corrected, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
            console.log('[ground-earnings-fix] Repaired ownerAmount on booking (retry):', corrected);
          }
        }
        return;
      }

      const data = bookDoc.data();
      if (!data.ownerAmount || data.ownerAmount <= 0) {
        const corrected = Math.floor(Number(data.amount || data.totalAmount || 0) * 0.9);
        if (corrected > 0) {
          await bookDoc.ref.update({ ownerAmount: corrected, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
          console.log('[ground-earnings-fix] Repaired ownerAmount on booking:', corrected);
        }
      }
    } catch (err) {
      console.warn('[ground-earnings-fix] Booking repair error (non-critical):', err.message);
    }
  });

  /* ═══════════════════════════════════════════════════════════════════════
     PUBLIC GLOBALS
  ═══════════════════════════════════════════════════════════════════════ */
  window._bmgOpenPayoutModal = async function () {
    const cu = _cu(), db = _db();
    if (!cu || !db) { _toast('Please log in first.', 'warning'); return; }
    _loading('Checking balance…');
    const bal = await computeRealBalance(cu.uid).catch(() => null);
    _done();
    if (!bal) { _toast('Could not load balance. Please try again.', 'error'); return; }
    if (bal.pendingRequests.length > 0) { _toast('You already have a pending payout request. Please wait.', 'warning'); return; }
    if (bal.available < 1) { _toast('No balance available to withdraw.', 'warning'); return; }
    _openApplyModal(bal.available, cu);
  };

  /* Alias used by PAYOUT_EARNINGS_FIX's earnings tab CTA button */
  window._bmgOpenPayoutModalWithCorrectBalance = window._bmgOpenPayoutModal;

  window._bmgReloadEarnings = function (cont) {
    const container = cont || document.getElementById('owner-dashboard-content');
    if (container) renderEarningsTab(container);
  };

  /* For external retry button (EARNINGS_RECEIVED_FIX compatibility) */
  window._bmgFixReloadEarnings = function (container) {
    const c = container
      || document.getElementById('owner-dashboard-content')
      || document.getElementById('owner-earnings-content');
    if (c) renderEarningsTab(c).catch(console.error);
  };

  /* ═══════════════════════════════════════════════════════════════════════
     INSTALL — Replace loadOwnerEarnings, loadOwnerPayouts, showPayoutRequestModal
     Runs immediately + at 300ms / 800ms / 1500ms to beat all other patches.
  ═══════════════════════════════════════════════════════════════════════ */
  function install() {
    window.loadOwnerEarnings         = renderEarningsTab;
    window.loadOwnerPayouts          = renderPayoutsTab;
    window._bmgLoadOwnerEarningsFull = renderEarningsTab;
    window._pspEarningsPatched       = true;
    window._gefInstalled             = true;
    console.log('[ground-earnings-fix] ✅ Earnings + Payouts functions installed');
  }

  install();
  setTimeout(install, 300);
  setTimeout(install, 800);
  setTimeout(install, 1500);

  /* Also re-install via MutationObserver whenever owner-dashboard-page changes */
  const _dashEl = () => document.getElementById('owner-dashboard-page');
  const _obs = new MutationObserver(() => {
    if (!window._gefInstalled) install();
    if (window.loadOwnerEarnings !== renderEarningsTab) install();
  });

  function _attachObserver() {
    const el = _dashEl();
    if (el) {
      _obs.observe(el, { childList: true, subtree: true });
      console.log('[ground-earnings-fix] MutationObserver attached to owner-dashboard-page');
    } else {
      setTimeout(_attachObserver, 500);
    }
  }
  setTimeout(_attachObserver, 200);

  /* Wire bmg:pageShown to guarantee our tab renders on navigation */
  window.addEventListener('bmg:pageShown', function (e) {
    if (!e.detail) return;
    const pageId = e.detail.pageId || '';
    if (pageId === 'owner-dashboard-page' || pageId === 'owner-earnings' || pageId === 'owner-payouts') {
      install();
    }
  });

  /* Auto-refresh event listeners (from EARNINGS_RECEIVED_FIX) */
  window.addEventListener('bmg:paymentConfirmed', function (e) {
    if (!e.detail || e.detail.paymentType !== 'booking') return;
    setTimeout(function () {
      const container = document.getElementById('owner-dashboard-content')
                     || document.getElementById('owner-earnings-content');
      if (container) renderEarningsTab(container).catch(() => {});
    }, 3000);
  });

  window.addEventListener('bmg:earningsNeedRefresh', function () {
    setTimeout(function () {
      const container = document.getElementById('owner-dashboard-content')
                     || document.getElementById('owner-earnings-content');
      if (container) renderEarningsTab(container).catch(() => {});
    }, 1000);
  });

  console.log('[combined_patches] Section 6: GROUND_EARNINGS_PAYOUT_FIX v1.0 ready ✅');
})();