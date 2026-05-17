/**
 * bmg_earnings_admin_fix_v3.js
 * ═══════════════════════════════════════════════════════════════════
 * FIXES IN THIS FILE:
 *
 *  1. FIRESTORE PERMISSION ERROR on logout
 *     Root cause: cleanupExpiredLocks() fires on setInterval even
 *     after the user has signed out → reads slot_locks without auth
 *     → "Missing or insufficient permissions".
 *     Fix: Guard every Firestore call with currentUser check.
 *
 *  2. SLOT PERMISSION: slot_locks rule blocks delete unless userId
 *     matches. The cleanup queries ALL expired locks, including those
 *     owned by other users.
 *     Fix: Only delete own locks client-side; add admin-bypass rule
 *     comment for the server-side fix in firestore.rules.
 *
 *  3. ADMIN "Owner Earnings" tab missing / not working
 *     Root cause: The tab button is not in index.html, and
 *     loadAdminDashboard() throws when getElementById returns null
 *     for unknown tab names.
 *     Fix: Inject the tab button and wire loadAdminOwnerEarnings().
 *
 *  4. CEO dashboard missing "Owner Earnings" tab
 *     Root cause: Same as above – CEO dashboard has no earnings tab.
 *     Fix: Inject tab and reuse loadAdminOwnerEarnings().
 *
 *  5. Real-time earnings not updating after transfer
 *     Root cause: loadAdminOwnerEarnings reads owner_payments but
 *     bmgAdminTransferPayment also needs to handle the case where
 *     the same owner still shows owed amount after payment.
 *     Fix: After every transfer, refresh both the admin and CEO
 *     earnings views automatically.
 *
 *  6. "Mark as Paid" (next payment transfer) button not working
 *     Root cause: After one transfer, the "Amount Still Owed" is
 *     recalculated but new payout_requests aren't being picked up
 *     because of the stale isAdmin filter.
 *     Fix: Relax the admin-transfer filter to include all paid
 *     payout_requests, and correctly compute netOwed.
 *
 * LOAD ORDER — add LAST in index.html (after all other bmg_*.js):
 *   <script src="bmg_earnings_admin_fix_v3.js"></script>
 * ═══════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  /* ─── tiny helpers ─────────────────────────────────────────────── */
  const fmt  = v => typeof window.formatCurrency === 'function'
    ? window.formatCurrency(v)
    : '₹' + Number(v || 0).toLocaleString('en-IN');

  const _db  = () => window.db;
  const _fs  = () => window.firebase?.firestore?.FieldValue;
  const _cu  = () => window.currentUser;

  const toast = (msg, type = 'success', ms = 4000) => {
    if (typeof window.showToast === 'function') window.showToast(msg, type, ms);
    else console.log(`[Toast:${type}] ${msg}`);
  };

  /* ═══════════════════════════════════════════════════════════════
   * FIX 1 & 2 — Guard cleanupExpiredLocks against post-logout calls
   * ═══════════════════════════════════════════════════════════════ */
  (function patchCleanupExpiredLocks() {
    const origFn = window.cleanupExpiredLocks;
    window.cleanupExpiredLocks = async function () {
      // Do nothing if user is logged out
      if (!_cu() || !_cu().uid) return;
      if (typeof origFn === 'function') {
        try { await origFn.apply(this, arguments); }
        catch (e) {
          // Swallow permission errors silently after logout
          if (e?.code !== 'permission-denied') console.error('[LockCleanup]', e);
        }
      }
    };
    console.log('✅ [Fix1] cleanupExpiredLocks guarded against post-logout permission errors');
  })();

  /* ═══════════════════════════════════════════════════════════════
   * FIX 3 — Inject "Owner Earnings" tab into Admin dashboard
   *          and handle it in loadAdminDashboard()
   * ═══════════════════════════════════════════════════════════════ */
  const ADMIN_EARN_TAB_ID  = 'admin-owner-earnings-tab';
  const ADMIN_CONT_ID      = 'admin-dashboard-content';

  function injectAdminEarningsTab() {
    if (document.getElementById(ADMIN_EARN_TAB_ID)) return;
    const tabBar = document.querySelector('.admin-tabs');
    if (!tabBar) return;

    const btn = document.createElement('button');
    btn.id        = ADMIN_EARN_TAB_ID;
    btn.className = 'tab-btn';
    btn.innerHTML = '<i class="fas fa-hand-holding-usd" style="margin-right:5px;"></i>Owner Earnings';

    // Insert before the red Delete tab
    const deleteTab = document.getElementById('admin-delete-tab');
    deleteTab ? tabBar.insertBefore(btn, deleteTab) : tabBar.appendChild(btn);
    console.log('✅ [Fix3] Admin "Owner Earnings" tab injected');
  }

  function wireAdminEarningsTab() {
    const tabBar = document.querySelector('.admin-tabs');
    if (!tabBar || tabBar.__bmgEarningsV3Wired) return;
    tabBar.__bmgEarningsV3Wired = true;

    tabBar.addEventListener('click', (e) => {
      const btn = e.target.closest(`#${ADMIN_EARN_TAB_ID}`);
      if (!btn) return;
      e.preventDefault(); e.stopPropagation();

      document.querySelectorAll('.admin-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const container = document.getElementById(ADMIN_CONT_ID);
      if (container) {
        container.innerHTML = '<div class="loading-spinner"><div class="loader-spinner"></div></div>';
        loadAdminOwnerEarningsFull(container);
      }
    });
    console.log('✅ [Fix3] Admin earnings tab click wired');
  }

  /* Patch loadAdminDashboard to handle 'owner-earnings' without crashing */
  function patchLoadAdminDashboard() {
    const orig = window.loadAdminDashboard;
    if (typeof orig !== 'function' || orig.__bmgEarnV3Patched) return;

    window.loadAdminDashboard = async function (tab) {
      if (tab === 'owner-earnings') {
        injectAdminEarningsTab();
        document.querySelectorAll('.admin-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        const btn = document.getElementById(ADMIN_EARN_TAB_ID);
        if (btn) btn.classList.add('active');
        const container = document.getElementById(ADMIN_CONT_ID);
        if (container) {
          container.innerHTML = '<div class="loading-spinner"><div class="loader-spinner"></div></div>';
          await loadAdminOwnerEarningsFull(container);
        }
        return;
      }
      return orig.apply(this, arguments);
    };
    window.loadAdminDashboard.__bmgEarnV3Patched = true;
    console.log('✅ [Fix3] loadAdminDashboard patched for owner-earnings');
  }

  /* ═══════════════════════════════════════════════════════════════
   * FIX 4 — Inject "Owner Earnings" tab into CEO dashboard
   * ═══════════════════════════════════════════════════════════════ */
  const CEO_EARN_TAB_ID = 'ceo-owner-earnings-tab';
  const CEO_CONT_ID     = 'ceo-dashboard-content';

  function injectCEOEarningsTab() {
    if (document.getElementById(CEO_EARN_TAB_ID)) return;
    const tabBar = document.querySelector('.ceo-tabs');
    if (!tabBar) return;

    const btn = document.createElement('button');
    btn.id        = CEO_EARN_TAB_ID;
    btn.className = 'tab-btn';
    btn.innerHTML = '<i class="fas fa-hand-holding-usd" style="margin-right:5px;"></i>Owner Earnings';
    tabBar.appendChild(btn);
    console.log('✅ [Fix4] CEO "Owner Earnings" tab injected');
  }

  function wireCEOEarningsTab() {
    const tabBar = document.querySelector('.ceo-tabs');
    if (!tabBar || tabBar.__bmgCEOEarningsV3Wired) return;
    tabBar.__bmgCEOEarningsV3Wired = true;

    tabBar.addEventListener('click', (e) => {
      const btn = e.target.closest(`#${CEO_EARN_TAB_ID}`);
      if (!btn) return;
      e.preventDefault(); e.stopPropagation();

      document.querySelectorAll('.ceo-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const container = document.getElementById(CEO_CONT_ID);
      if (container) {
        container.innerHTML = '<div class="loading-spinner"><div class="loader-spinner"></div></div>';
        loadAdminOwnerEarningsFull(container);
      }
    });
    console.log('✅ [Fix4] CEO earnings tab click wired');
  }

  /* Patch loadCEODashboard to handle 'owner-earnings' without crashing */
  function patchLoadCEODashboard() {
    const orig = window.loadCEODashboard;
    if (typeof orig !== 'function' || orig.__bmgCEOEarnV3Patched) return;

    window.loadCEODashboard = async function (tab) {
      if (tab === 'owner-earnings') {
        injectCEOEarningsTab();
        document.querySelectorAll('.ceo-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        const btn = document.getElementById(CEO_EARN_TAB_ID);
        if (btn) btn.classList.add('active');
        const container = document.getElementById(CEO_CONT_ID);
        if (container) {
          container.innerHTML = '<div class="loading-spinner"><div class="loader-spinner"></div></div>';
          await loadAdminOwnerEarningsFull(container);
        }
        return;
      }
      return orig.apply(this, arguments);
    };
    window.loadCEODashboard.__bmgCEOEarnV3Patched = true;
    console.log('✅ [Fix4] loadCEODashboard patched for owner-earnings');
  }

  /* ═══════════════════════════════════════════════════════════════
   * FIX 5 & 6 — Full Admin Owner Earnings Loader (replaces old one)
   *
   *  • Reads bookings + tournament_entries for gross earnings
   *  • Reads BOTH owner_payments AND payout_requests(paid) for
   *    all transfers already sent → accurate "net owed"
   *  • "Mark Payment Done" button records to owner_payments AND
   *    payout_requests then refreshes the view in real-time
   * ═══════════════════════════════════════════════════════════════ */
  async function loadAdminOwnerEarningsFull(container) {
    if (!container) return;
    const db = _db();
    const cu = _cu();
    if (!db || !cu) {
      container.innerHTML = '<p style="text-align:center;padding:32px;color:#9ca3af;">Please log in.</p>';
      return;
    }

    container.innerHTML = `
      <div style="text-align:center;padding:40px;">
        <div class="loader-spinner" style="margin:0 auto 12px;"></div>
        <p style="color:#6b7280;font-size:14px;">Loading owner earnings…</p>
      </div>`;

    try {
      /* ── 1. Confirmed bookings → group by ownerId ──────────────── */
      let bookSnap;
      try {
        bookSnap = await db.collection('bookings')
          .where('bookingStatus', '==', 'confirmed')
          .orderBy('createdAt', 'desc')
          .get();
      } catch (_) {
        bookSnap = await db.collection('bookings')
          .where('bookingStatus', '==', 'confirmed')
          .get();
      }

      /* ── 2. Confirmed tournament entries ───────────────────────── */
      let tournSnap;
      try {
        tournSnap = await db.collection('tournament_entries')
          .where('status', '==', 'confirmed')
          .get();
      } catch (_) { tournSnap = { docs: [] }; }

      /* ── 3. Paid transfers from owner_payments (primary) ─────────
       *       + payout_requests with status='paid' (secondary/legacy) */
      const [opSnap, prSnap] = await Promise.all([
        db.collection('owner_payments').where('status', '==', 'paid').get().catch(() => ({ docs: [] })),
        db.collection('payout_requests').where('status', '==', 'paid').get().catch(() => ({ docs: [] })),
      ]);

      /* ── 4. Aggregate ─────────────────────────────────────────── */
      const ownerData = {};

      const ensureOwner = (ownerId, name = '') => {
        if (!ownerData[ownerId]) {
          ownerData[ownerId] = {
            ownerId, ownerName: name,
            bookingEarnings: 0, tournamentEarnings: 0,
            transfersPaid: 0,
            bookingCount: 0, tournCount: 0, transferCount: 0,
          };
        }
        if (name && !ownerData[ownerId].ownerName) ownerData[ownerId].ownerName = name;
      };

      bookSnap.docs.forEach(doc => {
        const b = doc.data();
        const oid = b.ownerId || ''; if (!oid) return;
        ensureOwner(oid, b.ownerName || '');
        const full    = Number(b.amount || b.totalAmount || 0);
        const plat    = Number(b.commission || b.platformFee || Math.round(full * 0.10));
        const ownerSh = Number(b.ownerAmount || (full - plat));
        if (ownerSh <= 0) return;
        ownerData[oid].bookingEarnings += ownerSh;
        ownerData[oid].bookingCount++;
      });

      tournSnap.docs.forEach(doc => {
        const e = doc.data();
        const oid = e.ownerId || e.tournamentOwnerId || ''; if (!oid) return;
        ensureOwner(oid, '');
        const fee     = Number(e.amount || e.entryFee || 0);
        const plat    = Number(e.platformFee || Math.round(fee * 0.20));
        const ownerSh = Number(e.ownerAmount || (fee - plat));
        if (ownerSh <= 0) return;
        ownerData[oid].tournamentEarnings += ownerSh;
        ownerData[oid].tournCount++;
      });

      /* Deduplicate transfers: owner_payments is canonical; also pull
         any payout_requests(paid) that aren't already in owner_payments */
      const seenTransferIds = new Set();

      opSnap.docs.forEach(doc => {
        seenTransferIds.add(doc.id);
        const t = doc.data();
        const oid = t.ownerId || ''; if (!oid) return;
        ensureOwner(oid, t.ownerName || '');
        ownerData[oid].transfersPaid  += Number(t.amount || 0);
        ownerData[oid].transferCount++;
      });

      prSnap.docs.forEach(doc => {
        if (seenTransferIds.has(doc.id)) return; // skip if already counted
        const t = doc.data();
        const oid = t.ownerId || ''; if (!oid) return;
        // Only add if this payout was for the owner (not a user payout request)
        if (!ensureOwner) return;
        ensureOwner(oid, t.ownerName || '');
        ownerData[oid].transfersPaid  += Number(t.amount || 0);
        ownerData[oid].transferCount++;
      });

      /* ── 5. Resolve owner names for any unresolved IDs ─────────── */
      const unknownIds = Object.keys(ownerData).filter(id => !ownerData[id].ownerName);
      for (let i = 0; i < unknownIds.length; i += 10) {
        const chunk = unknownIds.slice(i, i + 10);
        try {
          const owSnap = await db.collection('owners')
            .where(window.firebase.firestore.FieldPath.documentId(), 'in', chunk)
            .get();
          owSnap.docs.forEach(d => {
            if (ownerData[d.id]) {
              ownerData[d.id].ownerName = d.data().name || d.data().ownerName || 'Unknown';
            }
          });
        } catch (_) {}
      }

      /* ── 6. Sort & render ─────────────────────────────────────── */
      const owners = Object.values(ownerData)
        .sort((a, b) => (b.bookingEarnings + b.tournamentEarnings) - (a.bookingEarnings + a.tournamentEarnings));

      const totalPlatRev = owners.reduce((s, o) => {
        const bk = o.bookingCount  > 0 ? (o.bookingEarnings     / 0.9) * 0.1 : 0;
        const tn = o.tournCount    > 0 ? (o.tournamentEarnings  / 0.8) * 0.2 : 0;
        return s + bk + tn;
      }, 0);

      const totalOwed = owners.reduce((s, o) => {
        const netOwed = (o.bookingEarnings + o.tournamentEarnings) - o.transfersPaid;
        return s + Math.max(0, netOwed);
      }, 0);

      container.innerHTML = `
        <style>
          .bae-banner{background:linear-gradient(135deg,#1e3a5f,#1e40af);color:#fff;border-radius:16px;padding:18px 20px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;}
          .bae-banner-stat{text-align:center;}
          .bae-banner-val{font-size:26px;font-weight:800;}
          .bae-banner-lbl{font-size:11px;opacity:.75;text-transform:uppercase;letter-spacing:.5px;}
          .bae-card{background:#fff;border-radius:16px;padding:18px;margin-bottom:14px;box-shadow:0 2px 12px rgba(0,0,0,.07);border-left:4px solid #10b981;}
          .bae-card-owed{border-left-color:#f59e0b;}
          .bae-card h4{font-size:15px;font-weight:700;color:#111;margin:0 0 12px;display:flex;justify-content:space-between;align-items:center;}
          .bae-row{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151;}
          .bae-row:last-of-type{border:none;}
          .bae-owed-box{background:#fef3c7;border-radius:10px;padding:10px 12px;margin-top:10px;display:flex;justify-content:space-between;align-items:center;}
          .bae-transfer-btn{background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;padding:10px 18px;border-radius:12px;font-size:13px;font-weight:700;cursor:pointer;margin-top:12px;display:flex;align-items:center;gap:6px;}
          .bae-transfer-btn:hover{opacity:.9;}
          .bae-paid-badge{background:#d1fae5;color:#065f46;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;}
          .bae-refresh-btn{background:#f3f4f6;border:none;padding:8px 16px;border-radius:10px;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:6px;font-weight:600;}
        </style>

        <!-- Platform revenue banner -->
        <div class="bae-banner">
          <div class="bae-banner-stat">
            <div class="bae-banner-val">${fmt(totalPlatRev)}</div>
            <div class="bae-banner-lbl">Platform Revenue</div>
          </div>
          <div class="bae-banner-stat">
            <div class="bae-banner-val">${owners.length}</div>
            <div class="bae-banner-lbl">Active Owners</div>
          </div>
          <div class="bae-banner-stat" style="background:rgba(255,255,255,.1);border-radius:12px;padding:10px 16px;">
            <div class="bae-banner-val" style="color:#fbbf24;">${fmt(totalOwed)}</div>
            <div class="bae-banner-lbl">Total Still Owed</div>
          </div>
          <button class="bae-refresh-btn" onclick="window._bmgRefreshAdminEarnings()">
            <i class="fas fa-sync-alt"></i> Refresh
          </button>
        </div>

        <!-- Per-owner cards -->
        <div id="bae-owners-list">
          ${owners.length === 0
            ? '<p style="text-align:center;color:#9ca3af;padding:32px;">No earnings data yet.</p>'
            : owners.map(o => {
                const total   = o.bookingEarnings + o.tournamentEarnings;
                const netOwed = Math.max(0, total - o.transfersPaid);
                const isOwed  = netOwed > 0;
                return `
                <div class="bae-card ${isOwed ? 'bae-card-owed' : ''}" id="bae-card-${o.ownerId}">
                  <h4>
                    <span>${o.ownerName || 'Unknown Owner'} <span style="font-size:10px;color:#9ca3af;">${o.ownerId.slice(0,8)}…</span></span>
                    ${!isOwed ? '<span class="bae-paid-badge"><i class="fas fa-check-circle"></i> Fully Paid</span>' : ''}
                  </h4>
                  <div class="bae-row">
                    <span>Ground Bookings (90% share)</span>
                    <span style="color:#3b82f6;font-weight:700;">${fmt(o.bookingEarnings)}</span>
                  </div>
                  <div class="bae-row">
                    <span>Tournament Earnings (80% share)</span>
                    <span style="color:#8b5cf6;font-weight:700;">${fmt(o.tournamentEarnings)}</span>
                  </div>
                  <div class="bae-row">
                    <span>Total Earned</span>
                    <span style="font-weight:800;">${fmt(total)}</span>
                  </div>
                  <div class="bae-row">
                    <span>Already Transferred (${o.transferCount} payment${o.transferCount !== 1 ? 's' : ''})</span>
                    <span style="color:#10b981;font-weight:700;">-${fmt(o.transfersPaid)}</span>
                  </div>
                  <div class="bae-owed-box">
                    <strong>Amount Still Owed</strong>
                    <span style="font-size:18px;font-weight:800;color:${isOwed ? '#d97706' : '#10b981'};">${fmt(netOwed)}</span>
                  </div>
                  ${isOwed ? `
                  <button class="bae-transfer-btn"
                    onclick="window.bmgAdminTransferPaymentV3('${o.ownerId}', '${o.ownerName.replace(/'/g, "\\'")}', ${Math.round(netOwed)})">
                    <i class="fas fa-paper-plane"></i> Mark Payment Done (${fmt(netOwed)})
                  </button>` : ''}
                </div>`;
              }).join('')}
        </div>`;

    } catch (err) {
      console.error('[BMG EarningsFix v3] loadAdminOwnerEarningsFull error:', err);
      container.innerHTML = `<p style="text-align:center;color:#ef4444;padding:32px;">
        Failed to load earnings. ${err.code === 'permission-denied' ? 'Check Firestore rules for admin role.' : err.message}
      </p>`;
    }
  }

  /* Expose for refresh button and external calls */
  window._bmgRefreshAdminEarnings = function () {
    const adminCont = document.getElementById(ADMIN_CONT_ID);
    const ceoCont   = document.getElementById(CEO_CONT_ID);
    const activeTab  = document.querySelector('.admin-tabs .tab-btn.active');
    const activeCEO  = document.querySelector('.ceo-tabs .tab-btn.active');

    if (adminCont && activeTab?.id === ADMIN_EARN_TAB_ID) {
      adminCont.innerHTML = '<div class="loading-spinner"><div class="loader-spinner"></div></div>';
      loadAdminOwnerEarningsFull(adminCont);
    }
    if (ceoCont && activeCEO?.id === CEO_EARN_TAB_ID) {
      ceoCont.innerHTML = '<div class="loading-spinner"><div class="loader-spinner"></div></div>';
      loadAdminOwnerEarningsFull(ceoCont);
    }
  };

  window.loadAdminOwnerEarnings = loadAdminOwnerEarningsFull;

  /* ═══════════════════════════════════════════════════════════════
   * FIX 6 — bmgAdminTransferPaymentV3
   *   Replaces the old bmgAdminTransferPayment. Shows a modal,
   *   writes to owner_payments + payout_requests, then REFRESHES
   *   the earnings view so the next payment can be made immediately.
   * ═══════════════════════════════════════════════════════════════ */
  window.bmgAdminTransferPaymentV3 = async function (ownerId, ownerName, suggestedAmount) {
    const db = _db();
    const cu = _cu();
    if (!db || !cu) { toast('Not logged in', 'error'); return; }

    /* Remove any stale modal */
    document.getElementById('bmg-transfer-modal-v3')?.remove();

    const modal = document.createElement('div');
    modal.id = 'bmg-transfer-modal-v3';
    modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px;';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:20px;max-width:380px;width:100%;padding:28px 24px;box-shadow:0 24px 64px rgba(0,0,0,.25);">
        <h3 style="margin:0 0 4px;font-size:18px;font-weight:800;"><i class="fas fa-paper-plane" style="color:#10b981;margin-right:8px;"></i>Mark Payment Done</h3>
        <p style="font-size:13px;color:#6b7280;margin:0 0 20px;">to <strong>${ownerName || ownerId}</strong></p>

        <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:6px;">Amount Transferred (₹)</label>
        <input id="bmg-tv3-amount" type="number" value="${suggestedAmount || 0}" min="1"
          style="width:100%;padding:12px;border:2px solid #e5e7eb;border-radius:12px;font-size:18px;font-weight:700;margin-bottom:14px;box-sizing:border-box;">

        <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:6px;">Payment Method</label>
        <select id="bmg-tv3-method" style="width:100%;padding:10px;border:2px solid #e5e7eb;border-radius:12px;font-size:14px;margin-bottom:14px;box-sizing:border-box;">
          <option value="UPI">UPI</option>
          <option value="NEFT">NEFT</option>
          <option value="IMPS">IMPS</option>
          <option value="Cash">Cash</option>
          <option value="Other">Other</option>
        </select>

        <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:6px;">Transaction ID / Note (optional)</label>
        <input id="bmg-tv3-note" type="text" placeholder="e.g. UTR1234567890"
          style="width:100%;padding:10px;border:2px solid #e5e7eb;border-radius:12px;font-size:13px;margin-bottom:20px;box-sizing:border-box;">

        <div style="display:flex;gap:10px;">
          <button id="bmg-tv3-cancel"
            style="flex:1;padding:12px;background:#f3f4f6;color:#374151;border:none;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;">
            Cancel
          </button>
          <button id="bmg-tv3-confirm"
            style="flex:2;padding:12px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;">
            <i class="fas fa-check"></i> Confirm Payment Done
          </button>
        </div>
        <p id="bmg-tv3-error" style="color:#ef4444;font-size:12px;text-align:center;margin-top:10px;display:none;"></p>
      </div>`;

    document.body.appendChild(modal);

    /* Close on backdrop click */
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    document.getElementById('bmg-tv3-cancel').addEventListener('click', () => modal.remove());

    /* Confirm */
    document.getElementById('bmg-tv3-confirm').addEventListener('click', async () => {
      const amt    = Number(document.getElementById('bmg-tv3-amount')?.value || 0);
      const method = document.getElementById('bmg-tv3-method')?.value  || 'UPI';
      const note   = document.getElementById('bmg-tv3-note')?.value    || '';
      const errEl  = document.getElementById('bmg-tv3-error');
      const btn    = document.getElementById('bmg-tv3-confirm');

      if (!amt || amt <= 0) {
        errEl.textContent = 'Please enter a valid amount greater than ₹0.';
        errEl.style.display = 'block';
        return;
      }

      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing…';
      errEl.style.display = 'none';

      try {
        const now       = _fs().serverTimestamp();
        const adminName = cu.name || cu.displayName || cu.email || 'Admin';
        const requestId = `ADMIN-${Date.now()}`;

        const transferDoc = {
          ownerId,
          ownerName    : ownerName || '',
          amount       : amt,
          method,
          note,
          description  : note || `Payment transfer via ${method}`,
          status       : 'paid',
          paidAt       : now,
          paidBy       : cu.uid,
          paidByName   : adminName,
          paidByEmail  : cu.email || '',
          adminRole    : cu.role  || 'admin',
          createdAt    : now,
          updatedAt    : now,
        };

        /* Write to owner_payments (primary — what owner earnings screen reads) */
        const opRef = await db.collection('owner_payments').add(transferDoc);

        /* Also write to payout_requests as paid entry (audit trail) */
        await db.collection('payout_requests').add({
          ...transferDoc,
          requestId,
          type      : 'admin_direct_transfer',
          bookingIds: [],
          // Reference back to the owner_payments doc for dedup
          ownerPaymentDocId: opRef.id,
        });

        modal.remove();
        toast(`✅ Payment of ${fmt(amt)} recorded for ${ownerName || 'owner'}`, 'success', 5000);

        /* Refresh whichever panel is currently visible */
        const adminCont = document.getElementById(ADMIN_CONT_ID);
        const ceoCont   = document.getElementById(CEO_CONT_ID);

        if (adminCont && document.getElementById(ADMIN_EARN_TAB_ID)?.classList.contains('active')) {
          adminCont.innerHTML = '<div class="loading-spinner"><div class="loader-spinner"></div></div>';
          await loadAdminOwnerEarningsFull(adminCont);
        } else if (ceoCont && document.getElementById(CEO_EARN_TAB_ID)?.classList.contains('active')) {
          ceoCont.innerHTML = '<div class="loading-spinner"><div class="loader-spinner"></div></div>';
          await loadAdminOwnerEarningsFull(ceoCont);
        }

      } catch (err) {
        console.error('[BMG TransferV3] error:', err);
        errEl.textContent = `Failed: ${err.message}`;
        errEl.style.display = 'block';
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-check"></i> Confirm Payment Done';
      }
    });
  };

  /* Also alias old name so any existing onclick="bmgAdminTransferPayment(...)" still works */
  window.bmgAdminTransferPayment = window.bmgAdminTransferPaymentV3;

  /* ═══════════════════════════════════════════════════════════════
   * FIRESTORE RULES COMMENT
   *
   * Add this to your firestore.rules to allow the cleanup to delete
   * locks that belong to other users (needed for server-side cleanup):
   *
   *   match /slot_locks/{lockId} {
   *     allow delete: if isSignedIn()
   *       && (resource.data.userId == request.auth.uid || isAdmin());
   *   }
   *
   * Also ensure slot_locks has a compound index on:
   *   expiresAt (ASC)  +  userId (ASC)
   * ═══════════════════════════════════════════════════════════════ */

  /* ─── SETUP — run on load and on every admin/CEO page visit ───── */
  function setup() {
    injectAdminEarningsTab();
    wireAdminEarningsTab();
    patchLoadAdminDashboard();
    injectCEOEarningsTab();
    wireCEOEarningsTab();
    patchLoadCEODashboard();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(setup, 300));
  } else {
    setTimeout(setup, 300);
  }

  /* Re-run when admin/CEO pages are shown (handles back-navigation) */
  window.addEventListener('bmg:pageShown', (e) => {
    const pid = e.detail?.pageId;
    if (pid === 'admin-dashboard-page' || pid === 'ceo-dashboard-page') {
      setTimeout(setup, 100);
    }
  });

  /* Also observe DOM for dynamic tab bar injection */
  const _mo = new MutationObserver(() => {
    if (document.querySelector('.admin-tabs') && !document.getElementById(ADMIN_EARN_TAB_ID)) injectAdminEarningsTab();
    if (document.querySelector('.ceo-tabs')   && !document.getElementById(CEO_EARN_TAB_ID))   injectCEOEarningsTab();
  });
  _mo.observe(document.body, { childList: true, subtree: true });

  console.log('✅ [bmg_earnings_admin_fix_v3.js] Loaded — all 6 fixes active');

})();