/* ═══════════════════════════════════════════════════════════════════════════
   PAYOUT_EARNINGS_FIX.js  v1.0
   ─────────────────────────────────────────────────────────────────────────
   PROBLEM: The "Available to Withdraw" balance in the owner payout modal
   shows the GROSS total earnings — it does NOT subtract:
     • Amounts already paid out (paid payout_requests)
     • Amounts under a pending/approved payout request
     • Pool bookings (uses wrong status field in the query)
     • Tournament earnings

   The payout modal therefore shows an INFLATED number, letting owners
   request money they've already received or that is already in a pending
   request.

   ROOT CAUSES (5 bugs, all interacting):
   ────────────────────────────────────────
   A) EARNINGS_UPCOMING_BOOKED_FIX._bmgLoadOwnerEarningsFull
      (used by the Earnings tab → "Request Payout" button) passes
      `totalEarnings` — the raw gross sum — directly to
      showPayoutRequestModal().  It never subtracts already-paid amounts
      or pending requests.  So the modal shows ₹X (gross) instead of
      ₹X – already-received – pending.

   B) pspOwnerPayouts (all_patches_combined.js) fetches pool_bookings
      with .where('status','==','confirmed'), but pool_bookings documents
      are written with BOTH `status:'confirmed'` AND
      `bookingStatus:'confirmed'`.  The query is correct for the `status`
      field — but if a pool booking was written by the Cloud Function
      webhook (which may only write `bookingStatus`), the `status` field
      is absent and those bookings are silently excluded from the
      `totalEarned` calculation.

   C) pspOwnerPayouts correctly computes
        available = totalEarned – totalReceived
      where totalReceived = sum of `owner_payments` + paid `payout_requests`.
      BUT it does NOT subtract amounts that are in a PENDING or APPROVED
      payout request.  So if an owner already has ₹500 under review, they
      can request another ₹500 against the same earnings.

   D) The earnings tab (_bmgLoadOwnerEarningsFull) does not show a
      "Pending payout" line anywhere, so the owner has no indication that
      part of their balance is already locked in a request.

   E) The "Request Payout" button in pspOwnerPayouts passes `available`
      (gross minus received) to pspShowApplyModal, which correctly caps
      the input at `available`.  But because of Bug C, `available` is
      already wrong — it's too high.

   THE FIX:
   ────────
   1. Replace window._bmgLoadOwnerEarningsFull with a version that:
      • Fetches earned, received (paid), and locked (pending/approved)
      • Computes: availableNow = earned – received – locked
      • Shows a clear 4-line breakdown: Earned / Received / Locked / Available
      • Passes `availableNow` (not gross) to showPayoutRequestModal /
        pspShowApplyModal

   2. Replace pspOwnerPayouts (window.loadOwnerPayouts) with a version that:
      • Queries pool_bookings with BOTH status fields (status OR bookingStatus)
        using two parallel queries + deduplication
      • Subtracts locked (pending+approved) payout requests from available
      • Shows "In review: ₹X" line when there's a pending request
      • Passes correct available amount to pspShowApplyModal

   3. Keep all existing UI chrome from pspOwnerPayouts — only the balance
      calculation logic is replaced.

   ADD IN index.html as the VERY LAST script before </body>:
     <script src="PAYOUT_EARNINGS_FIX.js"></script>
   (After all other scripts, including EARNINGS_UPCOMING_BOOKED_FIX.js
    and SLOT_BOOKED_DISPLAY_FIX.js if you use that too)
═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  console.log('[payout-fix] PAYOUT_EARNINGS_FIX v1.0 loading…');

  /* ─── micro helpers ──────────────────────────────────────────────────── */
  function _db()  { return window.db || null; }
  function _cu()  { return window.currentUser || null; }
  function _fmt(v) {
    if (typeof window.formatCurrency === 'function') return window.formatCurrency(v || 0);
    return '₹' + Number(v || 0).toLocaleString('en-IN');
  }
  function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function _toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type);
    else console.log('[payout-fix]', type, msg);
  }
  function _loading(msg) {
    if (typeof window.showLoading === 'function') window.showLoading(msg);
  }
  function _hideLoading() {
    if (typeof window.hideLoading === 'function') window.hideLoading();
  }

  /* ═══════════════════════════════════════════════════════════════════════
     CORE: computeRealBalance(ownerId)
     Returns { earned, received, locked, available, pendingRequests }
     where:
       earned   = sum of ownerAmount from all confirmed bookings + pool + tournaments
       received = sum of paid payout_requests + owner_payments
       locked   = sum of pending/approved payout_requests (in review)
       available = Math.max(0, earned – received – locked)
  ═══════════════════════════════════════════════════════════════════════ */
  async function computeRealBalance(ownerId) {
    const db = _db();
    if (!db || !ownerId) return { earned: 0, received: 0, locked: 0, available: 0, pendingRequests: [] };

    /* ── 1. Ground bookings ── */
    const groundSnap = await db.collection('bookings')
      .where('ownerId', '==', ownerId)
      .where('bookingStatus', '==', 'confirmed')
      .get().catch(() => ({ docs: [] }));

    let groundEarned = 0;
    groundSnap.docs.forEach(d => {
      groundEarned += Number(d.data().ownerAmount) || 0;
    });

    /* ── 2. Pool bookings — query BOTH status fields, deduplicate ── */
    const [poolByStatus, poolByBookingStatus] = await Promise.all([
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
    const seenPoolIds = new Set();
    [...poolByStatus.docs, ...poolByBookingStatus.docs].forEach(d => {
      if (seenPoolIds.has(d.id)) return;
      seenPoolIds.add(d.id);
      const data = d.data();
      poolEarned += Number(data.ownerAmount) || Number(data.amount || 0) * 0.9;
    });

    /* ── 3. Tournament earnings ── */
    let tournamentEarned = 0;
    try {
      const tourSnap = await db.collection('tournaments')
        .where('ownerId', '==', ownerId)
        .get().catch(() => ({ docs: [] }));

      if (!tourSnap.empty) {
        const ids = tourSnap.docs.map(d => d.id);
        // Firestore 'in' supports up to 30 items; chunk if needed
        for (let i = 0; i < ids.length; i += 30) {
          const chunk = ids.slice(i, i + 30);
          const entrySnap = await db.collection('tournament_entries')
            .where('tournamentId', 'in', chunk)
            .get().catch(() => ({ docs: [] }));
          entrySnap.docs.forEach(d => {
            const e = d.data();
            if (e.status !== 'confirmed' && e.paymentStatus !== 'paid') return;
            tournamentEarned += Number(e.ownerAmount) || Math.round(Number(e.amount || 0) * 0.8);
          });
        }
      }
    } catch (_) { /* tournaments optional */ }

    const totalEarned = groundEarned + poolEarned + tournamentEarned;

    /* ── 4. Amounts already received ── */
    const [paidPayoutsSnap, ownerPaymentsSnap] = await Promise.all([
      db.collection('payout_requests')
        .where('ownerId', '==', ownerId)
        .where('status', '==', 'paid')
        .get().catch(() => ({ docs: [] })),
      db.collection('owner_payments')
        .where('ownerId', '==', ownerId)
        .get().catch(() => ({ docs: [] })),
    ]);

    let totalReceived = 0;
    const seenReceivedIds = new Set();

    ownerPaymentsSnap.docs.forEach(d => {
      seenReceivedIds.add(d.id);
      totalReceived += Number(d.data().amount) || 0;
    });
    paidPayoutsSnap.docs.forEach(d => {
      if (seenReceivedIds.has(d.id)) return;
      totalReceived += Number(d.data().amount) || 0;
    });

    /* ── 5. Amounts locked in pending/approved requests ── */
    const pendingPayoutsSnap = await db.collection('payout_requests')
      .where('ownerId', '==', ownerId)
      .where('status', 'in', ['pending', 'approved'])
      .get().catch(() => ({ docs: [] }));

    let totalLocked = 0;
    const pendingRequests = [];
    pendingPayoutsSnap.docs.forEach(d => {
      const p = d.data();
      totalLocked += Number(p.amount) || 0;
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
     FIX 1 — Replace _bmgLoadOwnerEarningsFull (Earnings tab)
     Shows correct 4-line balance and passes real available to payout modal
  ═══════════════════════════════════════════════════════════════════════ */
  async function _fixedLoadOwnerEarnings(container) {
    const db = _db(), cu = _cu();
    if (!db || !cu) {
      container.innerHTML = '<p style="text-align:center;padding:32px;color:#9ca3af;">Please log in to view earnings.</p>';
      return;
    }

    _loading('Calculating real earnings…');

    try {
      const bal = await computeRealBalance(cu.uid);
      _hideLoading();

      /* Period breakdowns (today / week / month) for ground bookings only
         — reuse the data already fetched via the balance calc */
      const today      = new Date().toISOString().split('T')[0];
      const weekStart  = new Date(Date.now() - 6 * 86400000).toISOString().split('T')[0];
      const monthStart = new Date(Date.now() - 29 * 86400000).toISOString().split('T')[0];

      /* Fetch bookings again for period breakdown (lightweight) */
      const bSnap = await db.collection('bookings')
        .where('ownerId', '==', cu.uid)
        .where('bookingStatus', '==', 'confirmed')
        .get().catch(() => ({ docs: [] }));

      let todayE = 0, weekE = 0, monthE = 0;
      bSnap.docs.forEach(d => {
        const b = d.data();
        const amt = Number(b.ownerAmount) || 0;
        if (b.date === today)     todayE  += amt;
        if (b.date >= weekStart)  weekE   += amt;
        if (b.date >= monthStart) monthE  += amt;
      });

      /* ── Pending request notice ── */
      const hasPending = bal.pendingRequests.length > 0;
      const pendingNotice = hasPending ? `
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:12px 14px;margin-bottom:16px;display:flex;align-items:center;gap:10px;">
          <i class="fas fa-clock" style="color:#f59e0b;font-size:16px;flex-shrink:0;"></i>
          <div>
            <div style="font-weight:700;color:#92400e;font-size:13px;">Payout Under Review</div>
            <div style="font-size:12px;color:#b45309;margin-top:2px;">
              ${_fmt(bal.locked)} is currently in a pending payout request and cannot be withdrawn again.
            </div>
          </div>
        </div>` : '';

      /* ── Render ── */
      container.innerHTML = `
        <!-- Period stats -->
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;">
          <div style="background:#f0f4ff;border-radius:12px;padding:12px;text-align:center;">
            <div style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px;">Today</div>
            <div style="font-size:18px;font-weight:800;color:#2563eb;">${_fmt(todayE)}</div>
          </div>
          <div style="background:#f0f4ff;border-radius:12px;padding:12px;text-align:center;">
            <div style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px;">This Week</div>
            <div style="font-size:18px;font-weight:800;color:#2563eb;">${_fmt(weekE)}</div>
          </div>
          <div style="background:#f0f4ff;border-radius:12px;padding:12px;text-align:center;">
            <div style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px;">This Month</div>
            <div style="font-size:18px;font-weight:800;color:#2563eb;">${_fmt(monthE)}</div>
          </div>
        </div>

        <!-- Balance hero card -->
        <div style="background:linear-gradient(135deg,#1b2e6c,#2563eb);border-radius:16px;padding:20px;margin-bottom:16px;color:#fff;">
          <div style="font-size:12px;opacity:.8;margin-bottom:6px;"><i class="fas fa-wallet"></i> Available to Withdraw</div>
          <div style="font-size:34px;font-weight:800;letter-spacing:-0.6px;margin-bottom:4px;">${_fmt(bal.available)}</div>
          <div style="font-size:11px;opacity:.7;">Real available balance after deductions</div>
          <div style="margin-top:12px;background:rgba(255,255,255,.12);border-radius:10px;padding:10px 12px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
              <span style="font-size:12px;opacity:.85;">Total Earned</span>
              <span style="font-size:13px;font-weight:700;">${_fmt(bal.earned)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
              <span style="font-size:12px;opacity:.85;">Already Received</span>
              <span style="font-size:13px;font-weight:700;color:#86efac;">− ${_fmt(bal.received)}</span>
            </div>
            ${bal.locked > 0 ? `
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
              <span style="font-size:12px;opacity:.85;">In Review (pending)</span>
              <span style="font-size:13px;font-weight:700;color:#fde047;">− ${_fmt(bal.locked)}</span>
            </div>` : ''}
            <div style="border-top:1px solid rgba(255,255,255,.2);margin-top:4px;padding-top:8px;display:flex;justify-content:space-between;">
              <span style="font-size:12px;font-weight:700;">Available Now</span>
              <span style="font-size:14px;font-weight:800;color:#86efac;">${_fmt(bal.available)}</span>
            </div>
          </div>
        </div>

        <!-- Earnings source breakdown -->
        <div style="background:#fff;border:1.5px solid #e8edf8;border-radius:14px;padding:14px;margin-bottom:16px;">
          <div style="font-size:13px;font-weight:800;color:#0f1f5c;margin-bottom:10px;"><i class="fas fa-chart-bar" style="color:#2563eb;margin-right:6px;"></i>Earnings Breakdown</div>
          <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0f4ff;">
            <span style="font-size:13px;color:#374151;"><i class="fas fa-futbol" style="color:#22c55e;margin-right:6px;width:14px;"></i>Ground Bookings</span>
            <span style="font-size:13px;font-weight:700;color:#15803d;">${_fmt(bal.groundEarned)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0f4ff;">
            <span style="font-size:13px;color:#374151;"><i class="fas fa-swimming-pool" style="color:#0ea5e9;margin-right:6px;width:14px;"></i>Pool Bookings</span>
            <span style="font-size:13px;font-weight:700;color:#0369a1;">${_fmt(bal.poolEarned)}</span>
          </div>
          ${bal.tournamentEarned > 0 ? `
          <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0f4ff;">
            <span style="font-size:13px;color:#374151;"><i class="fas fa-trophy" style="color:#7c3aed;margin-right:6px;width:14px;"></i>Tournaments</span>
            <span style="font-size:13px;font-weight:700;color:#7c3aed;">${_fmt(bal.tournamentEarned)}</span>
          </div>` : ''}
          <div style="display:flex;justify-content:space-between;padding:8px 0;">
            <span style="font-size:13px;font-weight:700;color:#0f1f5c;">Total Earned</span>
            <span style="font-size:14px;font-weight:800;color:#0f1f5c;">${_fmt(bal.earned)}</span>
          </div>
        </div>

        ${pendingNotice}

        <!-- CTA -->
        ${bal.available > 0 ? `
        <div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:14px;padding:14px;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
            <i class="fas fa-check-circle" style="color:#22c55e;font-size:18px;"></i>
            <div>
              <div style="font-weight:700;color:#15803d;font-size:13px;">${_fmt(bal.available)} Ready to Withdraw</div>
              <div style="font-size:12px;color:#166534;">Processed within 2–3 business days</div>
            </div>
          </div>
          <button
            onclick="window._bmgOpenPayoutModalWithCorrectBalance()"
            style="width:100%;padding:13px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;border-radius:12px;font-weight:700;font-size:14px;cursor:pointer;font-family:inherit;letter-spacing:-0.2px;">
            <i class="fas fa-paper-plane" style="margin-right:6px;"></i> Request Payout
          </button>
        </div>` : `
        <div style="background:#fffbeb;border:1.5px solid #fde68a;border-radius:14px;padding:14px;display:flex;align-items:center;gap:10px;">
          <i class="fas fa-info-circle" style="color:#f59e0b;font-size:16px;"></i>
          <div>
            <div style="font-weight:700;color:#92400e;font-size:13px;">${bal.earned > 0 ? 'No Balance to Withdraw' : 'No Earnings Yet'}</div>
            <div style="font-size:12px;color:#b45309;">
              ${bal.locked > 0
                ? `${_fmt(bal.locked)} is already under a pending payout request.`
                : 'Your earnings will appear here after your first confirmed booking.'}
            </div>
          </div>
        </div>`}
      `;

      /* ── Store balance globally so the button can use it ── */
      window._bmgCurrentOwnerBalance = bal;

      console.log('[payout-fix] Earnings loaded — earned:', bal.earned,
        '| received:', bal.received, '| locked:', bal.locked,
        '| available:', bal.available);

    } catch (err) {
      _hideLoading();
      console.error('[payout-fix] _fixedLoadOwnerEarnings error:', err);
      container.innerHTML = `
        <div style="background:#fee2e2;border-left:4px solid #ef4444;border-radius:12px;padding:14px;">
          <div style="font-weight:700;color:#991b1b;">Error Loading Earnings</div>
          <div style="font-size:12px;color:#b91c1c;margin-top:4px;">${_esc(err.message)}</div>
        </div>`;
    }
  }

  /* ── Global opener called by the "Request Payout" button above ── */
  window._bmgOpenPayoutModalWithCorrectBalance = async function () {
    const cu = _cu(), db = _db();
    if (!cu || !db) { _toast('Please log in first.', 'warning'); return; }

    _loading('Checking balance…');
    const bal = await computeRealBalance(cu.uid).catch(() => null);
    _hideLoading();

    if (!bal) { _toast('Could not load balance. Please try again.', 'error'); return; }

    if (bal.pendingRequests.length > 0) {
      _toast('You already have a pending payout request. Please wait for it to be processed.', 'warning');
      return;
    }

    if (bal.available < 1) {
      _toast('No balance available to withdraw.', 'warning');
      return;
    }

    /* Use pspShowApplyModal if available (the nicest UI), else fall back */
    if (typeof window.pspShowApplyModal === 'function') {
      /* pspShowApplyModal is a closure inside all_patches_combined — not directly
         accessible from outside.  We re-trigger the payout tab which calls it. */
      const cont = document.getElementById('owner-dashboard-content');
      if (cont && typeof window.loadOwnerPayouts === 'function') {
        await window.loadOwnerPayouts(cont);
        /* After loadOwnerPayouts renders, auto-click the "Apply for Payout" button */
        setTimeout(() => {
          const btn = document.getElementById('psp-apply-trigger');
          if (btn && !btn.disabled) btn.click();
        }, 200);
      }
    } else if (typeof window.showPayoutRequestModal === 'function') {
      window.showPayoutRequestModal(bal.available);
    } else {
      _toast('Payout modal not available. Go to the Payouts tab.', 'warning');
    }
  };

  /* ═══════════════════════════════════════════════════════════════════════
     FIX 2 — Replace window.loadOwnerPayouts (Payouts tab)
     Fixes: pool query, locked-amount deduction, correct available display
  ═══════════════════════════════════════════════════════════════════════ */
  async function _fixedOwnerPayouts(container) {
    _loading('Loading payouts…');
    const db = _db(), cu = _cu();
    if (!db || !cu) {
      container.innerHTML = '<p style="text-align:center;padding:32px;color:#9ca3af;">Please log in.</p>';
      _hideLoading();
      return;
    }

    try {
      /* ── Compute real balance (single source of truth) ── */
      const bal = await computeRealBalance(cu.uid);

      /* ── Fetch payout request history for display ── */
      const payoutSnap = await db.collection('payout_requests')
        .where('ownerId', '==', cu.uid)
        .orderBy('createdAt', 'desc')
        .get().catch(() => ({ docs: [] }));

      const hasPending = bal.pendingRequests.length > 0;
      const stats = { total: payoutSnap.docs.length, pending: 0, approved: 0, paid: 0, rejected: 0 };
      payoutSnap.docs.forEach(d => {
        const st = d.data().status;
        if (stats[st] !== undefined) stats[st]++;
      });

      /* ── Received payments for display ── */
      const [ownerPaySnap] = await Promise.all([
        db.collection('owner_payments')
          .where('ownerId', '==', cu.uid)
          .orderBy('createdAt', 'desc')
          .get().catch(() => ({ docs: [] })),
      ]);
      const receivedItems = [];
      const seenIds = new Set();
      ownerPaySnap.docs.forEach(d => {
        seenIds.add(d.id);
        receivedItems.push({ id: d.id, ...d.data() });
      });
      payoutSnap.docs.forEach(d => {
        if (d.data().status === 'paid' && !seenIds.has(d.id)) {
          receivedItems.push({ id: d.id, ...d.data(), _fromPayout: true });
        }
      });
      receivedItems.sort((a, b) => {
        const ta = a.paidAt?.toDate ? a.paidAt.toDate().getTime() : 0;
        const tb = b.paidAt?.toDate ? b.paidAt.toDate().getTime() : 0;
        return tb - ta;
      });

      function _dt(ts) {
        if (!ts) return '—';
        const d = ts.toDate ? ts.toDate() : new Date(ts);
        return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      }

      function ownerCard(docId, p) {
        const st = p.status || 'pending';
        const iconMap = { pending: 'fa-clock', approved: 'fa-check-circle', paid: 'fa-money-bill-wave', rejected: 'fa-times-circle' };
        const labelMap = { pending: 'Under Review', approved: 'Approved', paid: 'Paid ✓', rejected: 'Rejected' };
        const colorMap = { pending: '#f59e0b', approved: '#3b82f6', paid: '#22c55e', rejected: '#ef4444' };
        return `
<div class="psp-card ${st}" data-status="${st}" style="background:#fff;border-radius:14px;padding:14px;margin-bottom:10px;border:1.5px solid #e8edf8;box-shadow:0 2px 8px rgba(15,31,92,.06);">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
    <div>
      <div style="font-size:13px;font-weight:800;color:#0f1f5c;">Payout Request</div>
      <div style="font-size:11px;color:#9ca3af;margin-top:2px;">${_dt(p.createdAt)}</div>
    </div>
    <div style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:20px;background:${colorMap[st]}18;color:${colorMap[st]};font-size:11px;font-weight:700;">
      <i class="fas ${iconMap[st] || 'fa-circle'}"></i> ${labelMap[st] || st}
    </div>
  </div>
  <div style="font-size:24px;font-weight:800;color:#0f1f5c;margin-bottom:6px;">${_fmt(p.amount)}</div>
  ${p.upiId ? `<div style="font-size:12px;color:#6b7280;"><i class="fas fa-qrcode" style="margin-right:5px;"></i>${_esc(p.upiId)}</div>` : ''}
  ${p.note ? `<div style="font-size:12px;color:#6b7280;margin-top:4px;"><i class="fas fa-comment" style="margin-right:5px;"></i>${_esc(p.note)}</div>` : ''}
  ${p.status === 'rejected' && p.rejectionReason ? `
  <div style="margin-top:8px;background:#fee2e2;border-radius:8px;padding:8px 10px;font-size:12px;color:#b91c1c;">
    <i class="fas fa-times-circle"></i> Rejected: ${_esc(p.rejectionReason)}
  </div>` : ''}
</div>`;
      }

      /* ── Render ── */
      container.innerHTML = `
<div class="psp-page">

  <!-- HERO: Real Available Balance -->
  <div style="background:linear-gradient(135deg,#1b2e6c,#2563eb);border-radius:16px;padding:20px;margin-bottom:16px;color:#fff;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;">
      <div>
        <div style="font-size:11px;opacity:.75;margin-bottom:4px;"><i class="fas fa-wallet"></i> Available to Withdraw</div>
        <div style="font-size:34px;font-weight:800;letter-spacing:-0.6px;">${_fmt(bal.available)}</div>
        <div style="font-size:11px;opacity:.65;margin-top:4px;">
          Earned ${_fmt(bal.earned)}
          ${bal.received > 0 ? ` · Received ${_fmt(bal.received)}` : ''}
          ${bal.locked > 0 ? ` · In review ${_fmt(bal.locked)}` : ''}
        </div>
      </div>
      <button
        id="psp-apply-trigger"
        ${hasPending || bal.available < 1 ? 'disabled title="' + (hasPending ? 'You have a pending request' : 'No balance available') + '"' : ''}
        style="background:rgba(255,255,255,.18);border:1.5px solid rgba(255,255,255,.35);color:#fff;font-size:12px;font-weight:700;padding:10px 14px;border-radius:22px;cursor:pointer;white-space:nowrap;font-family:inherit;transition:all .18s;"
        onmouseover="if(!this.disabled)this.style.background='rgba(255,255,255,.28)'"
        onmouseout="this.style.background='rgba(255,255,255,.18)'">
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
    <div style="background:#f8faff;border-radius:12px;padding:10px;text-align:center;border:1px solid #e8edf8;">
      <div style="font-size:18px;font-weight:800;color:#0f1f5c;">${stats.total}</div>
      <div style="font-size:10px;color:#9ca3af;font-weight:600;margin-top:2px;">Total</div>
    </div>
    <div style="background:#fffbeb;border-radius:12px;padding:10px;text-align:center;border:1px solid #fde68a;">
      <div style="font-size:18px;font-weight:800;color:#92400e;">${stats.pending + stats.approved}</div>
      <div style="font-size:10px;color:#b45309;font-weight:600;margin-top:2px;">In Progress</div>
    </div>
    <div style="background:#f0fdf4;border-radius:12px;padding:10px;text-align:center;border:1px solid #86efac;">
      <div style="font-size:18px;font-weight:800;color:#15803d;">${stats.paid}</div>
      <div style="font-size:10px;color:#16a34a;font-weight:600;margin-top:2px;">Paid</div>
    </div>
    <div style="background:#fef2f2;border-radius:12px;padding:10px;text-align:center;border:1px solid #fca5a5;">
      <div style="font-size:18px;font-weight:800;color:#b91c1c;">${stats.rejected}</div>
      <div style="font-size:10px;color:#ef4444;font-weight:600;margin-top:2px;">Rejected</div>
    </div>
  </div>

  <!-- Filter bar -->
  <div class="psp-filter-bar" id="psp-owner-filter-bar" style="display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;margin-bottom:14px;">
    <button class="psp-filter-btn active" data-filter="all" style="flex-shrink:0;">All</button>
    <button class="psp-filter-btn" data-filter="pending" style="flex-shrink:0;">Pending</button>
    <button class="psp-filter-btn" data-filter="approved" style="flex-shrink:0;">Approved</button>
    <button class="psp-filter-btn" data-filter="paid" style="flex-shrink:0;">Paid</button>
    <button class="psp-filter-btn" data-filter="rejected" style="flex-shrink:0;">Rejected</button>
  </div>

  <!-- Requests list -->
  <div id="psp-owner-list">
    ${payoutSnap.docs.length === 0
      ? `<div style="text-align:center;padding:36px 16px;">
           <div style="font-size:40px;opacity:.3;margin-bottom:10px;">💸</div>
           <div style="font-size:14px;font-weight:600;color:#9ca3af;">No payout requests yet.</div>
           <div style="font-size:12px;color:#d1d5db;margin-top:4px;">Apply for your first payout above.</div>
         </div>`
      : payoutSnap.docs.map(d => ownerCard(d.id, d.data())).join('')}
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
          <div style="font-size:13px;font-weight:700;color:#15803d;">${_fmt(p.amount)}</div>
          <div style="font-size:11px;color:#6b7280;margin-top:2px;">${_dt(p.paidAt || p.createdAt)} · via ${_esc(p.method || 'UPI')}</div>
          ${p.note ? `<div style="font-size:11px;color:#9ca3af;">${_esc(p.note)}</div>` : ''}
        </div>
        <div style="display:inline-flex;align-items:center;gap:4px;background:#dcfce7;color:#15803d;font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;">
          <i class="fas fa-check"></i> Received
        </div>
      </div>`).join('')}
  </div>` : ''}

</div>`;

      /* ── Wire filter bar ── */
      document.getElementById('psp-owner-filter-bar')?.addEventListener('click', e => {
        const btn = e.target.closest('.psp-filter-btn');
        if (!btn) return;
        document.querySelectorAll('#psp-owner-filter-bar .psp-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const f = btn.dataset.filter;
        document.querySelectorAll('#psp-owner-list .psp-card').forEach(c => {
          c.style.display = (f === 'all' || c.dataset.status === f) ? '' : 'none';
        });
      });

      /* ── Wire "Apply for Payout" button ── */
      document.getElementById('psp-apply-trigger')?.addEventListener('click', function () {
        if (this.disabled) return;
        _openApplyModal(bal.available, cu);
      });

      _hideLoading();

    } catch (err) {
      _hideLoading();
      console.error('[payout-fix] loadOwnerPayouts error:', err);
      container.innerHTML = `<p style="text-align:center;color:#ef4444;padding:32px;">${_esc(err.message)}</p>`;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     FIX 3 — Payout apply modal using real available balance
  ═══════════════════════════════════════════════════════════════════════ */
  function _openApplyModal(available, cu) {
    const existing = document.getElementById('payout-fix-modal');
    if (existing) existing.remove();

    const ov = document.createElement('div');
    ov.id = 'payout-fix-modal';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(10,20,60,.6);backdrop-filter:blur(6px);z-index:9999;display:flex;align-items:flex-end;';
    ov.innerHTML = `
<div style="background:#fff;border-radius:24px 24px 0 0;width:100%;max-height:90vh;overflow-y:auto;padding:0 0 env(safe-area-inset-bottom,0px);">
  <div style="width:40px;height:4px;border-radius:2px;background:#e2e8f0;margin:10px auto;"></div>
  <div style="padding:16px 18px 20px;">
    <div style="font-size:18px;font-weight:800;color:#0f1f5c;margin-bottom:4px;"><i class="fas fa-paper-plane" style="color:#2563eb;margin-right:8px;"></i>Apply for Payout</div>
    <div style="font-size:13px;color:#6b7280;margin-bottom:18px;">Reviewed by admin within 2–3 business days.</div>

    <!-- Balance pill -->
    <div style="background:#f0f4ff;border:1.5px solid #bfdbfe;border-radius:12px;padding:12px 14px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:13px;font-weight:600;color:#374151;"><i class="fas fa-wallet" style="color:#2563eb;margin-right:6px;"></i>Available Balance</span>
      <span style="font-size:18px;font-weight:800;color:#1d4ed8;">${_fmt(available)}</span>
    </div>

    <!-- Amount input -->
    <label style="font-size:13px;font-weight:700;color:#374151;display:block;margin-bottom:6px;">Payout Amount (₹)</label>
    <input id="pf-amount" type="number" min="1" max="${available}" value="${available}"
      style="width:100%;padding:12px 14px;border:2px solid #e8edf8;border-radius:12px;font-size:16px;font-weight:700;color:#0f1f5c;background:#f8faff;outline:none;box-sizing:border-box;font-family:inherit;margin-bottom:8px;"
      oninput="document.getElementById('pf-amount-err').style.display='none'">
    <div id="pf-amount-err" style="color:#ef4444;font-size:12px;margin-bottom:8px;display:none;"></div>

    <!-- Quick % buttons -->
    <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">
      ${[25, 50, 75, 100].map(p => `
      <button onclick="document.getElementById('pf-amount').value=Math.floor(${available}*${p}/100);document.getElementById('pf-amount-err').style.display='none';"
        style="flex:1;padding:7px 4px;background:#f0f4ff;border:1px solid #c7d2fe;border-radius:10px;color:#2563eb;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">${p}%</button>`).join('')}
    </div>

    <!-- UPI -->
    <label style="font-size:13px;font-weight:700;color:#374151;display:block;margin-bottom:6px;"><i class="fas fa-qrcode" style="color:#2563eb;margin-right:5px;"></i>UPI ID</label>
    <input id="pf-upi" type="text" value="${_esc(cu.upiId || '')}" placeholder="yourname@upi"
      style="width:100%;padding:12px 14px;border:2px solid #e8edf8;border-radius:12px;font-size:14px;color:#0f1f5c;background:#f8faff;outline:none;box-sizing:border-box;font-family:inherit;margin-bottom:16px;"
      oninput="document.getElementById('pf-upi-err').style.display='none'">
    <div id="pf-upi-err" style="color:#ef4444;font-size:12px;margin-bottom:8px;display:none;"></div>

    <!-- Note -->
    <label style="font-size:13px;font-weight:700;color:#374151;display:block;margin-bottom:6px;">Note (optional)</label>
    <input id="pf-note" type="text" placeholder="e.g. Monthly withdrawal"
      style="width:100%;padding:12px 14px;border:2px solid #e8edf8;border-radius:12px;font-size:14px;color:#0f1f5c;background:#f8faff;outline:none;box-sizing:border-box;font-family:inherit;margin-bottom:16px;">

    <div style="background:#fffbeb;border-radius:10px;padding:10px 12px;margin-bottom:18px;display:flex;align-items:flex-start;gap:8px;font-size:12px;color:#92400e;">
      <i class="fas fa-info-circle" style="margin-top:1px;flex-shrink:0;"></i>
      <span>Ensure your UPI ID is correct. Payments cannot be reversed once sent.</span>
    </div>

    <div id="pf-submit-err" style="color:#ef4444;font-size:12px;text-align:center;margin-bottom:10px;display:none;"></div>

    <div style="display:flex;gap:10px;">
      <button id="pf-cancel"
        style="flex:1;padding:13px;border:2px solid #e8edf8;border-radius:12px;background:#fff;color:#374151;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;">
        Cancel
      </button>
      <button id="pf-submit"
        style="flex:2;padding:13px;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;letter-spacing:-0.1px;">
        <i class="fas fa-paper-plane" style="margin-right:6px;"></i> Submit Request
      </button>
    </div>
  </div>
</div>`;

    document.body.appendChild(ov);
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
    document.getElementById('pf-cancel').addEventListener('click', () => ov.remove());

    document.getElementById('pf-submit').addEventListener('click', async function () {
      const amtInput  = document.getElementById('pf-amount');
      const upiInput  = document.getElementById('pf-upi');
      const noteInput = document.getElementById('pf-note');
      const amtErr    = document.getElementById('pf-amount-err');
      const upiErr    = document.getElementById('pf-upi-err');
      const submitErr = document.getElementById('pf-submit-err');
      const btn       = this;

      const amt = parseFloat(amtInput.value);
      const upi = upiInput.value.trim();
      const note = noteInput.value.trim();

      if (!amt || amt < 1) {
        amtErr.textContent = 'Please enter a valid amount.'; amtErr.style.display = 'block'; return;
      }
      if (amt > available + 0.5) {
        amtErr.textContent = `Amount exceeds available balance of ${_fmt(available)}.`; amtErr.style.display = 'block'; return;
      }
      if (!upi) {
        upiErr.textContent = 'Please enter your UPI ID.'; upiErr.style.display = 'block'; return;
      }

      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:6px;"></i> Submitting…';

      try {
        /* Final guard: re-check pending requests before writing */
        const latestPending = await _db().collection('payout_requests')
          .where('ownerId', '==', cu.uid)
          .where('status', 'in', ['pending', 'approved'])
          .get().catch(() => ({ empty: true }));

        if (!latestPending.empty) {
          submitErr.textContent = 'You already have a pending request. Please wait for it to be processed.';
          submitErr.style.display = 'block';
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-paper-plane" style="margin-right:6px;"></i> Submit Request';
          return;
        }

        const now = firebase.firestore.FieldValue.serverTimestamp();
        await _db().collection('payout_requests').add({
          requestId       : 'POUT-' + Date.now(),
          ownerId         : cu.uid,
          ownerName       : cu.ownerName || cu.name || '',
          ownerEmail      : cu.email     || '',
          ownerPhone      : cu.phone     || '',
          upiId           : upi,
          amount          : Math.round(amt),
          requestedAmount : Math.round(amt),
          note            : note,
          status          : 'pending',
          bookingIds      : [],
          createdAt       : now,
          updatedAt       : now,
        });

        ov.remove();
        _toast('✅ Payout request submitted! Admin will review within 2–3 business days.', 'success');

        /* Reload payouts tab */
        const cont = document.getElementById('owner-dashboard-content');
        if (cont) _fixedOwnerPayouts(cont);

      } catch (err) {
        submitErr.textContent = 'Error: ' + err.message;
        submitErr.style.display = 'block';
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane" style="margin-right:6px;"></i> Submit Request';
      }
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     INSTALL — replace window functions after all other scripts load
  ═══════════════════════════════════════════════════════════════════════ */
  function install() {
    window._bmgLoadOwnerEarningsFull = _fixedLoadOwnerEarnings;
    window.loadOwnerEarnings         = _fixedLoadOwnerEarnings;
    window.loadOwnerPayouts          = _fixedOwnerPayouts;
    window._pspEarningsPatched       = true; /* prevent all_patches_combined re-wrap */
    console.log('[payout-fix] Functions installed ✅ — earnings + payouts replaced');
  }

  /* Boot after all other scripts have had time to set their globals */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(install, 700));
  } else {
    setTimeout(install, 700);
  }

  console.log('[payout-fix] PAYOUT_EARNINGS_FIX v1.0 ready ✅');

})();