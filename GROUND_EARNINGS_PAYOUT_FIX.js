/* ═══════════════════════════════════════════════════════════════════════════
   GROUND_EARNINGS_PAYOUT_FIX.js  v1.0
   ─────────────────────────────────────────────────────────────────────────
   PROBLEM: After a user books and pays for a ground slot, the money does
   NOT appear in:
     • Owner Dashboard → Earnings tab
     • Owner Dashboard → Payouts tab ("Available to Withdraw" shows ₹0 or
       a stale/wrong number)

   ROOT CAUSE ANALYSIS (4 bugs found):
   ─────────────────────────────────────

   BUG 1 — Cloud Function writes ownerAmount to "owner_payments" collection,
   NOT to the owners/{uid} totalEarnings field.
   The Cloud Function (index.js) writes a confirmed booking to:
     • bookings/{orderId}  → { bookingStatus:'confirmed', ownerAmount:N, … }
     • owner_payments/{orderId}_owner  → { ownerAmount:N, … }
   It does NOT call owners/{ownerId}.update({ totalEarnings: increment(N) }).
   But app.js's loadOwnerEarnings reads from COLLECTIONS.BOOKINGS with
   .where('bookingStatus','==','confirmed') and sums ownerAmount — so this
   path IS correct for the earnings tab, IF the booking document exists and
   has ownerAmount > 0.

   BUG 2 — ownerAmount is often ZERO or MISSING in the bookings collection.
   When the Cloud Function writes the booking, it spreads the pending_bookings
   document: { ...pending, bookingStatus:'confirmed', … }. If the pending
   document was created by paymentService.js's createPendingBookingWithSlotLock
   and ownerAmount was not correctly set (e.g. finalAmount computed wrong),
   the confirmed booking doc has ownerAmount:0 or undefined. The fallback
   Math.floor(amount * 0.9) is also missing in this path.

   BUG 3 — loadOwnerEarnings queries COLLECTIONS.BOOKINGS (which resolves
   to the constant from app.js, usually 'bookings') but loadOwnerPayouts
   (pspOwnerPayouts in all_patches_combined.js) queries differently and
   the two are not synced. Specifically, PAYOUT_EARNINGS_FIX.js (which is
   supposed to fix this) is often loaded BEFORE the window.loadOwnerPayouts
   is defined — its setTimeout(install, 700) fires but
   window.loadOwnerPayouts is still the original function that hasn't
   been patched by all_patches_combined yet (which installs at 1000ms).

   BUG 4 — Script load order conflict. In index.html, PAYOUT_EARNINGS_FIX.js
   installs at 700 ms. all_patches_combined.js installs its own
   window.loadOwnerPayouts at ~1000 ms and OVERWRITES the fix.
   The _pspEarningsPatched guard in PAYOUT_EARNINGS_FIX is supposed to
   prevent this, but all_patches_combined does NOT check for that guard —
   it unconditionally sets window.loadOwnerPayouts.

   THE FIX (this file):
   ─────────────────────
   1. Aggressively re-installs correct earnings + payout functions using
      both setTimeout AND a MutationObserver-based approach that fires
      every time owner-dashboard-content changes, guaranteeing our version
      always wins regardless of install order.

   2. Provides a self-contained computeRealBalance() that:
      • Reads bookings collection (ground bookings, ownerId + bookingStatus)
      • Reads owner_payments collection as the authoritative "received" source
        (since Cloud Function writes there in same transaction as booking)
      • Deduplicates between owner_payments and paid payout_requests
      • Subtracts pending/approved payout requests (locked funds)

   3. After every bmg:paymentConfirmed event for a ground booking,
      actively ensures the booking document in Firestore has the correct
      ownerAmount (repairs BUG 2 if it happened).

   4. Exposes window._bmgReloadEarnings() for manual refresh.

   ADD IN index.html as the VERY LAST <script> before </body>:
     <script src="GROUND_EARNINGS_PAYOUT_FIX.js"></script>
   (After app.js, paymentService.js, bmg_fixes_combined.js,
    all_patches_combined.js, EARNINGS_UPCOMING_BOOKED_FIX.js,
    PAYOUT_EARNINGS_FIX.js — this must be LAST)
═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  console.log('[ground-earnings-fix] Loading v1.0…');

  /* ─── Helpers ──────────────────────────────────────────────────────────── */
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
     CORE — computeRealBalance(ownerId)
     Single source of truth for all balance figures.
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
      // Use ownerAmount; if missing, derive from amount with 10% platform cut
      const amt = Number(data.ownerAmount);
      if (amt > 0) {
        groundEarned += amt;
      } else {
        const fallback = Math.floor(Number(data.amount || data.totalAmount || 0) * 0.9);
        groundEarned += fallback;
      }
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

    /* ── Already received: owner_payments (authoritative) + paid payout_requests ── */
    const [opSnap, ppSnap] = await Promise.all([
      db.collection('owner_payments').where('ownerId', '==', ownerId).get().catch(() => ({ docs: [] })),
      db.collection('payout_requests').where('ownerId', '==', ownerId).where('status', '==', 'paid').get().catch(() => ({ docs: [] })),
    ]);

    let totalReceived = 0;
    const seenReceived = new Set();
    opSnap.docs.forEach(d => {
      seenReceived.add(d.id);
      const data = d.data();
      // owner_payments may store either 'ownerAmount' or 'amount'
      totalReceived += Number(data.ownerAmount || data.amount || 0);
    });
    ppSnap.docs.forEach(d => {
      if (seenReceived.has(d.id)) return;
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
     EARNINGS TAB — renders the full Earnings section
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

      /* Period breakdown (ground bookings only — fastest query) */
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
     PAYOUTS TAB — renders the full Payouts section
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

      /* Payout request history */
      const prSnap = await db.collection('payout_requests')
        .where('ownerId', '==', cu.uid)
        .orderBy('createdAt', 'desc')
        .get().catch(async () => {
          // Index may not exist — fallback without orderBy
          return db.collection('payout_requests').where('ownerId', '==', cu.uid).get().catch(() => ({ docs: [] }));
        });

      const stats = { total: prSnap.docs.length, pending: 0, approved: 0, paid: 0, rejected: 0 };
      prSnap.docs.forEach(d => { const st = d.data().status; if (stats[st] !== undefined) stats[st]++; });
      const hasPending = bal.pendingRequests.length > 0;

      /* Received payments for display */
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
        const st = p.status || 'pending';
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

      /* Wire filter bar */
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

      /* Wire Apply button */
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
        /* Guard: re-check for existing pending requests */
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

        /* Reload payouts tab */
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
     Runs after every bmg:paymentConfirmed event for ground bookings.
     Fixes BUG 2: if the Cloud Function spread a pending doc that had
     ownerAmount:0 or undefined, this corrects it.
  ═══════════════════════════════════════════════════════════════════════ */
  window.addEventListener('bmg:paymentConfirmed', async function (e) {
    const { orderId, paymentType } = e.detail || {};
    if (paymentType !== 'booking' || !orderId) return;

    const db = _db();
    if (!db) return;

    try {
      const bookDoc = await db.collection('bookings').doc(orderId).get();
      if (!bookDoc.exists) {
        // Booking may not exist yet (Cloud Function hasn't written yet); wait and retry once
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

  window._bmgReloadEarnings = function () {
    const cont = document.getElementById('owner-dashboard-content');
    if (cont) renderEarningsTab(cont);
  };

  /* ═══════════════════════════════════════════════════════════════════════
     INSTALL — Replace window.loadOwnerEarnings & window.loadOwnerPayouts
     Uses aggressive re-install to win the race against all other patches.
  ═══════════════════════════════════════════════════════════════════════ */
  function install() {
    window.loadOwnerEarnings         = renderEarningsTab;
    window.loadOwnerPayouts          = renderPayoutsTab;
    window._bmgLoadOwnerEarningsFull = renderEarningsTab;
    window._pspEarningsPatched       = true;
    window._gefInstalled             = true;
    console.log('[ground-earnings-fix] ✅ Earnings + Payouts functions installed');
  }

  /* Install immediately + after delays to beat all other patches */
  install();
  setTimeout(install, 300);
  setTimeout(install, 800);
  setTimeout(install, 1500);

  /* Also re-install whenever owner-dashboard-content is touched
     (catches cases where another script re-runs loadOwnerDashboard
     and switches the tab, which re-sets window.loadOwnerEarnings) */
  const _dashEl = () => document.getElementById('owner-dashboard-page');
  const _obs = new MutationObserver(() => {
    if (!window._gefInstalled) install();
    // Also check if another patch undid our assignment
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
    // Reload earnings when owner dashboard earnings tab is shown
    const pageId = e.detail.pageId || '';
    if (pageId === 'owner-dashboard-page' || pageId === 'owner-earnings' || pageId === 'owner-payouts') {
      install(); // re-assert functions in case another script wiped them
    }
  });

  console.log('[ground-earnings-fix] v1.0 ready ✅');
})();