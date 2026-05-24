/**
 * ═══════════════════════════════════════════════════════════════
 *  SPORTOBOOK COMBINED FIX — earnings_fix_final.js
 *  Load this as the VERY LAST script in index.html (after all others)
 *
 *  FIXES INCLUDED:
 *
 *  [FIX 1] Owner earnings always showing ₹0
 *    — app.js declares loadOwnerEarnings() as a named function, so
 *      loadOwnerDashboard() resolves it via JS local scope, completely
 *      bypassing every window.loadOwnerEarnings patch from paymentService
 *      and combined_patches. Fixed by overriding loadOwnerDashboard to
 *      read window.loadOwnerEarnings at call-time.
 *
 *  [FIX 2] Total Earned drops to ₹0 after any payout is processed
 *    — paymentService._earningsFn skips payout_done bookings even when
 *      computing "Total Earned", so the total zeroes out post-payout.
 *      Fixed by using computeRealBalance() which counts all confirmed
 *      bookings in the total and subtracts received amounts separately.
 *
 *  [FIX 3] Pool bookings missing from earnings
 *    — Firestore stores confirmed status in both `status` and
 *      `bookingStatus` fields inconsistently. Fixed by querying both
 *      fields and deduplicating by document ID.
 *
 *  [FIX 4] "Page not found: my-bookings-page" console error
 *    — Three patch files call showPage('my-bookings-page') but the
 *      actual <div> in index.html is id="bookings-page". Fixed by
 *      intercepting showPage() and remapping the wrong id to the real one.
 *      Affected callers:
 *        • combined_patches.js:1509  — upcoming booking banner click
 *        • app.js:32082              — tournament success modal button
 *        • sportobook_patches_merged.js:2180 — entry-pass skip button
 * ═══════════════════════════════════════════════════════════════
 */
(function () {
  'use strict';

  /* ── Shared helpers ── */
  const log  = (m) => console.log('[sportobook-fix]', m);
  const warn = (m) => console.warn('[sportobook-fix]', m);
  const _db  = ()  => window.db || null;
  const _cu  = ()  => window.currentUser || null;
  const _fmt = (v) => typeof window.formatCurrency === 'function'
    ? window.formatCurrency(v || 0)
    : '₹' + Number(v || 0).toLocaleString('en-IN');
  const _esc = (s) => String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function _isoDate(offsetDays) {
    return new Date(Date.now() - offsetDays * 86400000).toISOString().split('T')[0];
  }


  /* ══════════════════════════════════════════════════════════════
     FIX 4 — showPage('my-bookings-page') → 'bookings-page'
     Applied first (no async needed) so every subsequent navigation
     — including those triggered by the earnings renderer — works.
  ══════════════════════════════════════════════════════════════ */
  function patchShowPage() {
    if (!window.showPage) { setTimeout(patchShowPage, 200); return; }
    if (window.__myBookingsPageFixed) return;

    const _origShowPage = window.showPage;
    window.showPage = function patchedShowPage(pageId) {
      if (pageId === 'my-bookings-page') {
        log('Redirected my-bookings-page → bookings-page');
        pageId = 'bookings-page';
      }
      return _origShowPage.apply(this,
        arguments.length === 1 ? [pageId] : [pageId, ...Array.prototype.slice.call(arguments, 1)]);
    };

    window.__myBookingsPageFixed = true;
    log('✅ FIX 4 — showPage patched, my-bookings-page remapped');
  }


  /* ══════════════════════════════════════════════════════════════
     FIX 1-3 — Authoritative earnings balance calculator
  ══════════════════════════════════════════════════════════════ */
  async function computeRealBalance(ownerId) {
    const db = _db();
    if (!db || !ownerId) {
      return { earned: 0, groundEarned: 0, poolEarned: 0, tournamentEarned: 0,
               received: 0, locked: 0, available: 0, pendingRequests: [] };
    }

    /* ── Ground bookings (ALL confirmed; fallback ownerAmount = 90%) ── */
    const gSnap = await db.collection('bookings')
      .where('ownerId', '==', ownerId)
      .where('bookingStatus', '==', 'confirmed')
      .get().catch(() => ({ docs: [] }));

    let groundEarned = 0;
    gSnap.docs.forEach(d => {
      const data = d.data();
      const amt  = Number(data.ownerAmount);
      groundEarned += amt > 0 ? amt : Math.floor(Number(data.amount || data.totalAmount || 0) * 0.9);
    });

    /* ── Pool bookings — query BOTH status fields, deduplicate ── */
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
      const amt  = Number(data.ownerAmount);
      poolEarned += amt > 0 ? amt : Math.floor(Number(data.amount || 0) * 0.9);
    });

    /* ── Tournament earnings ── */
    let tournamentEarned = 0;
    try {
      const tSnap = await db.collection('tournaments').where('ownerId', '==', ownerId).get().catch(() => ({ docs: [] }));
      if (!tSnap.empty) {
        const ids = tSnap.docs.map(d => d.id);
        for (let i = 0; i < ids.length; i += 30) {
          const eSnap = await db.collection('tournament_entries')
            .where('tournamentId', 'in', ids.slice(i, i + 30))
            .get().catch(() => ({ docs: [] }));
          eSnap.docs.forEach(d => {
            const e = d.data();
            if (e.status !== 'confirmed' && e.paymentStatus !== 'paid') return;
            tournamentEarned += Number(e.ownerAmount) || Math.round(Number(e.amount || 0) * 0.8);
          });
        }
      }
    } catch (_) {}

    const totalEarned = groundEarned + poolEarned + tournamentEarned;

    /* ── Already received: owner_payments + paid payout_requests (deduped) ── */
    const [opSnap, ppSnap] = await Promise.all([
      db.collection('owner_payments').where('ownerId', '==', ownerId).get().catch(() => ({ docs: [] })),
      db.collection('payout_requests').where('ownerId', '==', ownerId).where('status', '==', 'paid').get().catch(() => ({ docs: [] })),
    ]);
    let totalReceived = 0;
    const seenReceived = new Set();
    opSnap.docs.forEach(d => {
      seenReceived.add(d.id);
      totalReceived += Number(d.data().ownerAmount || d.data().amount || 0);
    });
    ppSnap.docs.forEach(d => {
      if (seenReceived.has(d.id)) return;
      totalReceived += Number(d.data().amount || 0);
    });

    /* ── Locked in pending/approved payout requests ── */
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
    return { earned: totalEarned, groundEarned, poolEarned, tournamentEarned,
             received: totalReceived, locked: totalLocked, available, pendingRequests };
  }

  /* ── Earnings tab renderer ── */
  async function renderEarningsTab(container) {
    const cu = _cu(), db = _db();
    if (!cu || !db) {
      container.innerHTML = '<p style="text-align:center;padding:32px;color:#9ca3af;">Please log in to view earnings.</p>';
      return;
    }

    if (typeof window.showLoading === 'function') window.showLoading('Calculating earnings…');

    try {
      const bal = await computeRealBalance(cu.uid);

      /* Period stats (ground bookings only — fast) */
      const today = _isoDate(0), week = _isoDate(6), month = _isoDate(29);
      let todayE = 0, weekE = 0, monthE = 0;
      const bSnap = await db.collection('bookings')
        .where('ownerId', '==', cu.uid)
        .where('bookingStatus', '==', 'confirmed')
        .get().catch(() => ({ docs: [] }));
      bSnap.docs.forEach(d => {
        const b   = d.data();
        const amt = Number(b.ownerAmount) || Math.floor(Number(b.amount || 0) * 0.9);
        if (b.date === today) todayE += amt;
        if (b.date >= week)   weekE  += amt;
        if (b.date >= month)  monthE += amt;
      });

      if (typeof window.hideLoading === 'function') window.hideLoading();

      const pendingNotice = bal.pendingRequests.length > 0
        ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:12px 14px;margin-bottom:16px;display:flex;align-items:center;gap:10px;">
            <i class="fas fa-clock" style="color:#f59e0b;font-size:16px;flex-shrink:0;"></i>
            <div>
              <div style="font-weight:700;color:#92400e;font-size:13px;">Payout Under Review</div>
              <div style="font-size:12px;color:#b45309;margin-top:2px;">${_fmt(bal.locked)} is locked in a pending payout request.</div>
            </div>
          </div>` : '';

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
          <div style="font-size:11px;opacity:.7;">Total earned minus received &amp; pending</div>
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
            <div style="display:flex;justify-content:space-between;">
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
              <button onclick="(window._bmgOpenPayoutModal||window.showPayoutRequestModal||function(){alert('Payout modal not available')})()"
                style="width:100%;padding:13px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;border-radius:12px;font-weight:700;font-size:14px;cursor:pointer;font-family:inherit;">
                <i class="fas fa-paper-plane" style="margin-right:6px;"></i> Request Payout
              </button>
            </div>`
          : `<div style="background:#fffbeb;border:1.5px solid #fde68a;border-radius:14px;padding:14px;display:flex;align-items:center;gap:10px;">
              <i class="fas fa-info-circle" style="color:#f59e0b;font-size:16px;"></i>
              <div>
                <div style="font-weight:700;color:#92400e;font-size:13px;">${bal.earned > 0 ? 'No Balance Available' : 'No Earnings Yet'}</div>
                <div style="font-size:12px;color:#b45309;">${bal.locked > 0
                    ? `${_fmt(bal.locked)} is under a pending payout request.`
                    : 'Earnings appear here after your first confirmed booking.'}</div>
              </div>
            </div>`}
      `;

      window._bmgCurrentBalance = bal;

    } catch (err) {
      if (typeof window.hideLoading === 'function') window.hideLoading();
      warn('renderEarningsTab error: ' + err.message);
      console.error(err);
      container.innerHTML = `
        <div style="text-align:center;padding:32px;color:#ef4444;">
          <i class="fas fa-exclamation-triangle" style="font-size:24px;margin-bottom:8px;display:block;"></i>
          <div style="font-weight:600;">Failed to load earnings</div>
          <div style="font-size:12px;color:#9ca3af;margin-top:4px;">${_esc(err.message)}</div>
          <button onclick="window._bmgFixReloadEarnings(this.closest('#owner-dashboard-content,#owner-earnings-content,[id*=earnings]'))"
            style="margin-top:12px;padding:8px 20px;background:#2563eb;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;">
            Retry
          </button>
        </div>`;
    }
  }


  /* ══════════════════════════════════════════════════════════════
     FIX 1 — Patch loadOwnerDashboard to resolve window.loadOwnerEarnings
     at call-time, breaking the JS local-scope lock in app.js.
  ══════════════════════════════════════════════════════════════ */
  function patchDashboardRouter() {
    if (!window.loadOwnerDashboard) { setTimeout(patchDashboardRouter, 300); return; }
    if (window.__efRouterPatched) return;

    const _origDash = window.loadOwnerDashboard;
    window.loadOwnerDashboard = async function (tab) {
      if (tab === 'earnings') {
        const container = document.getElementById('owner-dashboard-content');
        if (!container) return;

        document.querySelectorAll('.dashboard-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        const tabEl = document.getElementById('owner-earnings-tab');
        if (tabEl) tabEl.classList.add('active');

        container.innerHTML = '<div class="loading-spinner"><div class="loader-spinner"></div></div>';

        const fn = window.loadOwnerEarnings;
        if (typeof fn === 'function') {
          try { await fn(container); } catch (e) { warn('earnings fn error: ' + e.message); }
        } else {
          warn('window.loadOwnerEarnings not found — using built-in renderer');
          await renderEarningsTab(container);
        }
        return;
      }
      return _origDash.apply(this, arguments);
    };

    window.__efRouterPatched = true;
    log('✅ FIX 1 — loadOwnerDashboard patched, earnings uses window ref at call-time');
  }


  /* ══════════════════════════════════════════════════════════════
     Install — set all window references to our authoritative renderer
  ══════════════════════════════════════════════════════════════ */
  function install() {
    window.loadOwnerEarnings         = renderEarningsTab;
    window._bmgLoadOwnerEarningsFull = renderEarningsTab;
    window._bmgFixReloadEarnings     = function (container) {
      const c = container
        || document.getElementById('owner-dashboard-content')
        || document.getElementById('owner-earnings-content');
      if (c) renderEarningsTab(c).catch(console.error);
    };
    window._efComputeRealBalance = computeRealBalance;
    window._pspEarningsPatched   = true;
    window._gefInstalled         = true;
    log('✅ FIX 2-3 — window.loadOwnerEarnings installed');
  }


  /* ══════════════════════════════════════════════════════════════
     Auto-refresh wiring
  ══════════════════════════════════════════════════════════════ */
  function wireRefreshEvents() {
    window.addEventListener('bmg:paymentConfirmed', function () {
      setTimeout(() => {
        const c = document.getElementById('owner-dashboard-content')
               || document.getElementById('owner-earnings-content');
        if (c) renderEarningsTab(c).catch(() => {});
      }, 3000);
    });
    window.addEventListener('bmg:earningsNeedRefresh', function () {
      setTimeout(() => {
        const c = document.getElementById('owner-dashboard-content')
               || document.getElementById('owner-earnings-content');
        if (c) renderEarningsTab(c).catch(() => {});
      }, 1000);
    });
  }


  /* ── Boot — all four fixes ── */
  patchShowPage();       // FIX 4 — runs immediately, no async needed
  install();             // FIX 2-3
  patchDashboardRouter(); // FIX 1
  wireRefreshEvents();

  /* Re-install at staggered intervals to survive late patch overwrites */
  setTimeout(install, 200);
  setTimeout(install, 600);
  setTimeout(install, 1500);
  setTimeout(patchDashboardRouter, 400);
  setTimeout(patchShowPage, 300);   // re-apply if showPage was overwritten late

  /* MutationObserver: re-install if owner dashboard DOM changes */
  function attachObserver() {
    const el = document.getElementById('owner-dashboard-page');
    if (!el) { setTimeout(attachObserver, 500); return; }
    new MutationObserver(() => {
      if (window.loadOwnerEarnings !== renderEarningsTab) install();
    }).observe(el, { childList: true, subtree: true });
    log('MutationObserver attached to owner-dashboard-page');
  }
  setTimeout(attachObserver, 300);

  log('earnings_fix_final.js loaded ✅ (4 fixes active)');
})();
