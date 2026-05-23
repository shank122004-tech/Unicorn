/* ═══════════════════════════════════════════════════════════════════════════
   EARNINGS_RECEIVED_FIX.js  v1.0
   ─────────────────────────────────────────────────────────────────────────
   PROBLEM: "Available to Withdraw" shows ₹0 even though the owner has real
   confirmed bookings. The "Already Received" figure is wildly inflated
   (e.g. −₹166 when only ₹26 was ever earned).

   ROOT CAUSE — Double-counting in every earnings script:
   ─────────────────────────────────────────────────────
   The `owner_payments` Firestore collection contains THREE different types
   of documents written by different parts of the code:

     TYPE A  {orderId}_owner   Written by Cloud Function when a booking is
                                confirmed. Fields: { ownerAmount, platformFee }.
                                NO `amount` field. These are "earnings records",
                                NOT money the owner has received yet.

     TYPE B  {orderId}          Written by Cloud Function for owner onboarding
                                fee. Fields: { amount: 5 }. This is money the
                                owner PAID to the platform, not received.

     TYPE C  auto-id            Written by all_patches_combined when admin
                                confirms a payout. Fields: { amount, type:
                                'payout_confirmation' }. THIS is real received
                                money. But it ALSO gets created for the same
                                event that updates payout_requests.status='paid'.

   Every existing earnings script does:
     totalReceived = sum(owner_payments) + sum(payout_requests where paid)

   But TYPE C docs AND the corresponding payout_requests doc both represent
   the SAME payout event. The deduplication logic fails because the two
   collections use different document IDs, so they are BOTH counted:
     • payout_request paid    → +₹83
     • owner_payments TYPE C  → +₹83
     • totalReceived          = ₹166  ← double-counted!

   TYPE A docs (ownerAmount) are also summed as "received" even though no
   money was actually transferred yet — the owner just earned it.

   THE FIX:
   ─────────────────────────────────────────────────────────────────────────
   • totalReceived  = ONLY payout_requests where status='paid'
                      (the canonical, admin-controlled record of actual payouts)
   • Do NOT read owner_payments for the received calculation at all.
   • totalEarned    = sum of confirmed bookings' ownerAmount (unchanged)
   • available      = max(0, totalEarned − totalReceived − totalLocked)

   This is the single source of truth: an owner has "received" money only
   when an admin explicitly marks a payout_request as 'paid'.

   ADD IN index.html as the VERY LAST <script> before </body>:
     <script src="EARNINGS_RECEIVED_FIX.js"></script>
   (After GROUND_EARNINGS_PAYOUT_FIX.js and FINAL_SLOT_EARNINGS_FIX.js)
═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  console.log('[earnings-received-fix] Loading v1.0…');

  /* ─── Helpers ──────────────────────────────────────────────────────────── */
  const _db  = () => window.db || null;
  const _cu  = () => window.currentUser || null;
  const _fmt = (v) => typeof window.formatCurrency === 'function'
    ? window.formatCurrency(v || 0)
    : '₹' + Number(v || 0).toLocaleString('en-IN');
  const _esc = (s) => String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const _loading = (m) => { if (typeof window.showLoading  === 'function') window.showLoading(m);  };
  const _done    = ()   => { if (typeof window.hideLoading === 'function') window.hideLoading();   };
  const _toast   = (m, t) => { if (typeof window.showToast === 'function') window.showToast(m, t); };

  /* ─── Date helpers ────────────────────────────────────────────────────── */
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
     CORE — computeCorrectBalance(ownerId)
     Single source of truth. Uses ONLY payout_requests for received amount.
  ═══════════════════════════════════════════════════════════════════════ */
  async function computeCorrectBalance(ownerId) {
    const db = _db();
    if (!db || !ownerId) {
      return { earned: 0, groundEarned: 0, poolEarned: 0, tournamentEarned: 0,
               received: 0, locked: 0, available: 0, pendingRequests: [] };
    }

    /* ── Ground bookings earned ── */
    const gSnap = await db.collection('bookings')
      .where('ownerId', '==', ownerId)
      .where('bookingStatus', '==', 'confirmed')
      .get().catch(() => ({ docs: [] }));

    let groundEarned = 0;
    gSnap.docs.forEach(d => {
      const b = d.data();
      const amt = Number(b.ownerAmount);
      groundEarned += amt > 0
        ? amt
        : Math.floor(Number(b.amount || b.totalAmount || 0) * 0.9);
    });

    /* ── Pool bookings earned (deduplicate status vs bookingStatus) ── */
    const [pByStatus, pByBookingStatus] = await Promise.all([
      db.collection('pool_bookings')
        .where('ownerId', '==', ownerId)
        .where('status', '==', 'confirmed')
        .get().catch(() => ({ docs: [] })),
      db.collection('pool_bookings')
        .where('ownerId', '==', ownerId)
        .where('bookingStatus', '==', 'confirmed')
        .get().catch(() => ({ docs: [] })),
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
      const tSnap = await db.collection('tournaments')
        .where('ownerId', '==', ownerId)
        .get().catch(() => ({ docs: [] }));
      if (!tSnap.empty) {
        const ids = tSnap.docs.map(d => d.id);
        for (let i = 0; i < ids.length; i += 30) {
          const chunk = ids.slice(i, i + 30);
          const eSnap = await db.collection('tournament_entries')
            .where('tournamentId', 'in', chunk)
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

    /* ── RECEIVED: ONLY payout_requests where status='paid' ─────────────
       This is the ONLY correct source. owner_payments contains booking
       records (ownerAmount earned, not yet paid) AND onboarding fees
       (paid BY owner) AND payout confirmation duplicates.
       Using payout_requests alone eliminates all double-counting.
    ──────────────────────────────────────────────────────────────────── */
    const paidPayoutsSnap = await db.collection('payout_requests')
      .where('ownerId', '==', ownerId)
      .where('status', '==', 'paid')
      .get().catch(() => ({ docs: [] }));

    let totalReceived = 0;
    paidPayoutsSnap.docs.forEach(d => {
      totalReceived += Number(d.data().amount || d.data().requestedAmount || 0);
    });

    /* ── LOCKED: payout_requests in pending/approved (admin hasn't paid yet) ── */
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

    return {
      earned: totalEarned,
      groundEarned,
      poolEarned,
      tournamentEarned,
      received: totalReceived,
      locked: totalLocked,
      available,
      pendingRequests,
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     EARNINGS TAB RENDERER
  ═══════════════════════════════════════════════════════════════════════ */
  async function renderEarnings(container) {
    const cu = _cu(), db = _db();
    if (!cu || !db) {
      container.innerHTML = '<p style="text-align:center;padding:32px;color:#9ca3af;">Please log in to view earnings.</p>';
      return;
    }

    _loading('Calculating earnings…');

    try {
      const bal = await computeCorrectBalance(cu.uid);

      /* Period breakdown for ground bookings */
      const bSnap = await db.collection('bookings')
        .where('ownerId', '==', cu.uid)
        .where('bookingStatus', '==', 'confirmed')
        .get().catch(() => ({ docs: [] }));

      const today = _isoDate(0), week = _isoDate(6), month = _isoDate(29);
      let todayE = 0, weekE = 0, monthE = 0;
      bSnap.docs.forEach(d => {
        const b = d.data();
        const amt = Number(b.ownerAmount) || Math.floor(Number(b.amount || 0) * 0.9);
        if (b.date === today) todayE += amt;
        if (b.date >= week)   weekE  += amt;
        if (b.date >= month)  monthE += amt;
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

      const lockedRow = bal.locked > 0
        ? `<div style="display:flex;justify-content:space-between;margin-bottom:0;">
             <span style="font-size:12px;opacity:.85;">In Review (pending)</span>
             <span style="font-size:13px;font-weight:700;color:#fde047;">− ${_fmt(bal.locked)}</span>
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
            ${lockedRow}
            <div style="border-top:1px solid rgba(255,255,255,.2);margin-top:8px;padding-top:8px;display:flex;justify-content:space-between;">
              <span style="font-size:12px;font-weight:700;">Available Now</span>
              <span style="font-size:14px;font-weight:800;color:#86efac;">${_fmt(bal.available)}</span>
            </div>
          </div>
        </div>

        ${pendingNotice}

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
            <span style="font-size:13px;color:#374151;"><i class="fas fa-trophy" style="color:#f59e0b;margin-right:6px;width:14px;"></i>Tournaments</span>
            <span style="font-size:13px;font-weight:700;color:#92400e;">${_fmt(bal.tournamentEarned)}</span>
          </div>` : ''}
          <div style="display:flex;justify-content:space-between;padding:8px 0;border-top:2px solid #f0f4ff;margin-top:4px;">
            <span style="font-size:13px;font-weight:800;color:#0f1f5c;">Total Earned</span>
            <span style="font-size:14px;font-weight:800;color:#0f1f5c;">${_fmt(bal.earned)}</span>
          </div>
        </div>

        <!-- Withdraw button or no-balance notice -->
        ${bal.available > 0
          ? `<div style="background:#fff;border:1.5px solid #bbf7d0;border-radius:14px;padding:14px;margin-bottom:16px;">
               <div style="font-size:13px;font-weight:700;color:#15803d;margin-bottom:12px;"><i class="fas fa-money-bill-wave" style="margin-right:6px;"></i>${_fmt(bal.available)} Ready to Withdraw</div>
               <button onclick="showPayoutRequestModal(${bal.available})"
                 style="width:100%;padding:13px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;border-radius:12px;font-weight:700;font-size:14px;cursor:pointer;font-family:inherit;letter-spacing:-0.2px;">
                 <i class="fas fa-paper-plane" style="margin-right:6px;"></i>Request Payout
               </button>
             </div>`
          : `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:14px;margin-bottom:16px;display:flex;align-items:flex-start;gap:10px;">
               <i class="fas fa-info-circle" style="color:#f59e0b;font-size:16px;margin-top:2px;flex-shrink:0;"></i>
               <div>
                 <div style="font-weight:700;color:#92400e;font-size:13px;">${bal.earned > 0 ? 'No Balance to Withdraw' : 'No Earnings Yet'}</div>
                 <div style="font-size:12px;color:#b45309;margin-top:4px;line-height:1.5;">
                   ${bal.earned > 0
                     ? `You've earned ${_fmt(bal.earned)} total. ${bal.received > 0 ? `${_fmt(bal.received)} has already been paid out to you.` : ''} ${bal.locked > 0 ? `${_fmt(bal.locked)} is pending admin review.` : ''}`
                     : 'Earnings appear here after your first confirmed booking.'}
                 </div>
               </div>
             </div>`}
      `;

    } catch (err) {
      _done();
      console.error('[earnings-received-fix] renderEarnings error:', err);
      container.innerHTML = `
        <div style="background:#fee2e2;border-radius:12px;padding:16px;text-align:center;">
          <i class="fas fa-exclamation-circle" style="color:#ef4444;font-size:24px;margin-bottom:8px;display:block;"></i>
          <div style="font-weight:700;color:#991b1b;">Error Loading Earnings</div>
          <div style="font-size:12px;color:#b91c1c;margin-top:4px;">${_esc(err.message)}</div>
          <button onclick="window._bmgFixReloadEarnings()" style="margin-top:12px;padding:8px 16px;background:#ef4444;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-family:inherit;">Retry</button>
        </div>`;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     PAYOUTS TAB RENDERER — shows request payout button with correct amount
  ═══════════════════════════════════════════════════════════════════════ */
  async function renderPayouts(container) {
    const cu = _cu(), db = _db();
    if (!cu || !db) {
      container.innerHTML = '<p style="text-align:center;padding:32px;color:#9ca3af;">Please log in.</p>';
      return;
    }

    _loading('Loading payouts…');

    try {
      const bal = await computeCorrectBalance(cu.uid);

      /* All payout requests for history */
      const allPayoutsSnap = await db.collection('payout_requests')
        .where('ownerId', '==', cu.uid)
        .orderBy('createdAt', 'desc')
        .get().catch(() => ({ docs: [] }));

      _done();

      const statusColor = { pending:'#f59e0b', approved:'#3b82f6', paid:'#22c55e', rejected:'#ef4444' };
      const statusBg    = { pending:'#fffbeb', approved:'#eff6ff', paid:'#f0fdf4', rejected:'#fee2e2' };

      const historyHtml = allPayoutsSnap.docs.length > 0
        ? allPayoutsSnap.docs.map(d => {
            const p = d.data();
            const st = p.status || 'pending';
            return `<div style="background:#fff;border:1.5px solid #e8edf8;border-radius:14px;padding:14px;margin-bottom:10px;">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px;">
                <div>
                  <div style="font-size:18px;font-weight:800;color:#0f1f5c;">${_fmt(p.amount)}</div>
                  <div style="font-size:11px;color:#9ca3af;margin-top:2px;">${_fmtDate(p.createdAt)}</div>
                </div>
                <span style="background:${statusBg[st]};color:${statusColor[st]};font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;white-space:nowrap;">
                  ${st.charAt(0).toUpperCase() + st.slice(1)}
                </span>
              </div>
              ${p.upiId ? `<div style="font-size:12px;color:#6b7280;"><i class="fas fa-university" style="margin-right:5px;"></i>UPI: ${_esc(p.upiId)}</div>` : ''}
              ${p.transactionId ? `<div style="font-size:12px;color:#6b7280;margin-top:3px;"><i class="fas fa-hashtag" style="margin-right:5px;"></i>Txn: ${_esc(p.transactionId)}</div>` : ''}
              ${p.note ? `<div style="font-size:12px;color:#6b7280;margin-top:3px;">${_esc(p.note)}</div>` : ''}
            </div>`;
          }).join('')
        : `<div style="text-align:center;padding:32px;color:#9ca3af;">
             <i class="fas fa-file-invoice" style="font-size:32px;opacity:.3;display:block;margin-bottom:12px;"></i>
             <div style="font-weight:600;">No payout requests yet</div>
           </div>`;

      container.innerHTML = `
        <!-- Balance summary -->
        <div style="background:linear-gradient(135deg,#1b2e6c,#2563eb);border-radius:16px;padding:20px;margin-bottom:16px;color:#fff;">
          <div style="font-size:12px;opacity:.8;margin-bottom:4px;"><i class="fas fa-wallet"></i> Your Balance</div>
          <div style="font-size:34px;font-weight:800;letter-spacing:-0.6px;">${_fmt(bal.available)}</div>
          <div style="font-size:11px;opacity:.7;margin-top:2px;">Total earned ${_fmt(bal.earned)} · Received ${_fmt(bal.received)}</div>
        </div>

        <!-- Request payout button -->
        ${bal.available > 0
          ? `<button onclick="showPayoutRequestModal(${bal.available})"
               style="width:100%;padding:14px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;border-radius:14px;font-weight:700;font-size:15px;cursor:pointer;font-family:inherit;margin-bottom:20px;letter-spacing:-0.2px;">
               <i class="fas fa-paper-plane" style="margin-right:8px;"></i>Request Payout · ${_fmt(bal.available)}
             </button>`
          : `<div style="background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:12px;padding:12px 14px;margin-bottom:20px;text-align:center;color:#15803d;font-size:13px;font-weight:600;">
               ${bal.earned === 0
                 ? '<i class="fas fa-info-circle" style="margin-right:6px;"></i>No earnings yet — confirm your first booking to earn.'
                 : `<i class="fas fa-check-circle" style="margin-right:6px;"></i>All earnings of ${_fmt(bal.earned)} have been paid out.`}
             </div>`}

        <!-- Payout history -->
        <div style="font-size:13px;font-weight:800;color:#0f1f5c;margin-bottom:12px;">
          <i class="fas fa-history" style="color:#6b7280;margin-right:6px;"></i>Payout History
        </div>
        ${historyHtml}
      `;

    } catch (err) {
      _done();
      console.error('[earnings-received-fix] renderPayouts error:', err);
      container.innerHTML = `<p style="text-align:center;padding:32px;color:#ef4444;">Error loading payouts: ${_esc(err.message)}</p>`;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     EXPOSE for external use (retry button, post-payment refresh)
  ═══════════════════════════════════════════════════════════════════════ */
  window._bmgFixReloadEarnings = function (container) {
    const c = container
      || document.getElementById('owner-dashboard-content')
      || document.getElementById('owner-earnings-content');
    if (c) renderEarnings(c).catch(console.error);
  };

  /* ═══════════════════════════════════════════════════════════════════════
     INSTALL — forcibly overwrite all prior earnings/payouts functions.
     Runs at 1500ms to guarantee it wins over all_patches_combined (600ms),
     PAYOUT_EARNINGS_FIX (700ms), GROUND_EARNINGS_PAYOUT_FIX (observer).
  ═══════════════════════════════════════════════════════════════════════ */
  function install() {
    window.loadOwnerEarnings         = renderEarnings;
    window._bmgLoadOwnerEarningsFull = renderEarnings;
    window.loadOwnerPayouts          = renderPayouts;

    /* Prevent all_patches_combined's patchEarningsSection from re-wrapping */
    window._pspEarningsPatched = true;

    console.log('[earnings-received-fix] ✅ loadOwnerEarnings + loadOwnerPayouts replaced');
  }

  /* ═══════════════════════════════════════════════════════════════════════
     AUTO-REFRESH after payment confirmed (so owner sees earnings immediately)
  ═══════════════════════════════════════════════════════════════════════ */
  window.addEventListener('bmg:paymentConfirmed', function (e) {
    if (!e.detail || e.detail.paymentType !== 'booking') return;
    /* Delay so Cloud Function has time to write the booking doc */
    setTimeout(function () {
      const container = document.getElementById('owner-dashboard-content')
                     || document.getElementById('owner-earnings-content');
      if (container) renderEarnings(container).catch(() => {});
    }, 3000);
  });

  window.addEventListener('bmg:earningsNeedRefresh', function () {
    setTimeout(function () {
      const container = document.getElementById('owner-dashboard-content')
                     || document.getElementById('owner-earnings-content');
      if (container) renderEarnings(container).catch(() => {});
    }, 1000);
  });

  /* Boot */
  function boot() {
    setTimeout(install, 1500);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  console.log('[earnings-received-fix] EARNINGS_RECEIVED_FIX v1.0 ready ✅');

})();