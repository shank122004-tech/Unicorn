/**
 * ═══════════════════════════════════════════════════════════════
 *  SPORTOBOOK — PAYOUT ALWAYS ZERO FIX  v3  (definitive)
 *  File: sportobook_payout_zero_fix.js
 *
 *  ROOT CAUSE ANALYSIS (from console logs):
 *  ─────────────────────────────────────────
 *  Log showed:  earned: 34.5 | received(paid): 62 | available: 0
 *
 *  v1 bug:  ALL owner_payments counted as "received" (pending included)
 *  v2 bug:  payout_requests with status:'paid' summed to ₹62 > earned ₹34.5
 *           because old/stale payout_request documents exist in Firestore
 *           from before the current booking system was in place.
 *
 *  CORRECT formula (matches original app.js logic):
 *    available = totalEarned
 *              - totalTransferred   (owner_transfers collection — actual bank sends)
 *              - totalLocked        (payout_requests status:'pending'/'approved')
 *
 *  "totalTransferred" comes from owner_transfers, NOT from payout_requests.
 *  payout_requests are just requests; owner_transfers are confirmed sends.
 *  This matches how app.js originally computed pendingBalance (line ~17350).
 *
 *  INSTALL:
 *  ─────────
 *  Add as the VERY LAST <script> in index.html, after all other patches:
 *    <script src="sportobook_payout_zero_fix.js"></script>
 * ═══════════════════════════════════════════════════════════════
 */
(function () {
  'use strict';

  const TAG  = '[payout-zero-fix]';
  const log  = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);

  const _db  = () => window.db || null;
  const _cu  = () => window.currentUser || null;
  const _fv  = () => window.firebase && window.firebase.firestore ? window.firebase.firestore : null;
  const _ts  = () => { const f = _fv(); return f ? f.FieldValue.serverTimestamp() : new Date(); };
  const _fmt = (v) => typeof window.formatCurrency === 'function'
    ? window.formatCurrency(v || 0)
    : '₹' + Number(v || 0).toLocaleString('en-IN');
  const _esc = (s) => String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  function _isoDate(offsetDays) {
    return new Date(Date.now() - offsetDays * 86400000).toISOString().split('T')[0];
  }
  function _fmtDate(ts) {
    if (!ts) return '—';
    try {
      const d = ts.toDate ? ts.toDate() : new Date(ts);
      return d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
    } catch (_) { return '—'; }
  }


  /* ══════════════════════════════════════════════════════════════
     FIXED computeRealBalance
     ─────────────────────────────────────────────────────────────
     "received" = owner_transfers (actual bank sends by admin)
                  NOT payout_requests (which can have stale/bad data)

     available  = earned - transferred - locked(pending requests)
  ══════════════════════════════════════════════════════════════ */
  async function computeRealBalance(ownerId) {
    const db = _db();
    if (!db || !ownerId) {
      return {
        earned: 0, groundEarned: 0, poolEarned: 0, tournamentEarned: 0,
        transferred: 0, locked: 0, available: 0, pendingRequests: [],
      };
    }

    /* ── 1. Ground bookings (confirmed) ── */
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

    /* ── 2. Pool bookings (deduplicated across status fields) ── */
    const [pByStatus, pByBookingStatus] = await Promise.all([
      db.collection('pool_bookings').where('ownerId','==',ownerId).where('status','==','confirmed').get().catch(() => ({ docs: [] })),
      db.collection('pool_bookings').where('ownerId','==',ownerId).where('bookingStatus','==','confirmed').get().catch(() => ({ docs: [] })),
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

    /* ── 3. Tournament earnings ── */
    let tournamentEarned = 0;
    try {
      const tSnap = await db.collection('tournaments').where('ownerId','==',ownerId).get().catch(() => ({ docs: [] }));
      if (!tSnap.empty) {
        const ids = tSnap.docs.map(d => d.id);
        for (let i = 0; i < ids.length; i += 30) {
          const eSnap = await db.collection('tournament_entries')
            .where('tournamentId','in', ids.slice(i, i + 30))
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

    /* ── 4. Already transferred — use owner_transfers (actual sends) ──────
     *
     *  WHY owner_transfers instead of payout_requests?
     *  • app.js (line ~17219-17350) uses owner_transfers for "totalSent"
     *  • payout_requests can have old/test/stale docs with inflated amounts
     *    (this owner had ₹62 in paid requests vs ₹34.5 earned — impossible)
     *  • owner_transfers are only created by admin when money is actually sent
     * ──────────────────────────────────────────────────────────────────── */
    const transferSnap = await db.collection('owner_transfers')
      .where('ownerId', '==', ownerId)
      .get().catch(() => ({ docs: [] }));

    let totalTransferred = 0;
    transferSnap.docs.forEach(d => {
      totalTransferred += Number(d.data().amount || 0);
    });

    /* ── 5. Locked in pending/approved payout_requests ── */
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

    const available = Math.max(0, totalEarned - totalTransferred - totalLocked);

    log('balance for', ownerId, '→',
      'earned:', totalEarned,
      '| transferred:', totalTransferred,
      '| locked:', totalLocked,
      '| available:', available
    );

    return {
      earned: totalEarned, groundEarned, poolEarned, tournamentEarned,
      transferred: totalTransferred,
      locked: totalLocked,
      available,
      pendingRequests,
    };
  }


  /* ══════════════════════════════════════════════════════════════
     Earnings tab renderer
  ══════════════════════════════════════════════════════════════ */
  async function renderEarningsTab(container) {
    const cu = _cu(), db = _db();
    if (!cu || !db) {
      container.innerHTML = '<p style="text-align:center;padding:32px;color:#9ca3af;">Please log in to view earnings.</p>';
      return;
    }

    if (typeof window.showLoading === 'function') window.showLoading('Calculating earnings…');

    try {
      const bal = await computeRealBalance(cu.uid);

      /* Period stats */
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
          <div style="font-size:11px;opacity:.7;">Total earned minus transferred &amp; pending</div>
          <div style="margin-top:12px;background:rgba(255,255,255,.12);border-radius:10px;padding:10px 12px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
              <span style="font-size:12px;opacity:.85;">Total Earned</span>
              <span style="font-size:13px;font-weight:700;">${_fmt(bal.earned)}</span>
            </div>
            ${bal.transferred > 0 ? `
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
              <span style="font-size:12px;opacity:.85;">Already Transferred</span>
              <span style="font-size:13px;font-weight:700;color:#86efac;">− ${_fmt(bal.transferred)}</span>
            </div>` : ''}
            ${bal.locked > 0 ? `
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
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
          <div style="font-size:13px;font-weight:800;color:#0f1f5c;margin-bottom:10px;">
            <i class="fas fa-chart-bar" style="color:#2563eb;margin-right:6px;"></i>Earnings Breakdown
          </div>
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
                <div style="font-size:12px;color:#b45309;">${bal.locked > 0
                    ? `${_fmt(bal.locked)} is under a pending payout request.`
                    : 'Earnings appear here after your first confirmed booking.'}</div>
              </div>
            </div>`}
      `;

      window._bmgCurrentBalance = bal;

    } catch (err) {
      if (typeof window.hideLoading === 'function') window.hideLoading();
      warn('renderEarningsTab error:', err.message);
      container.innerHTML = `
        <div style="text-align:center;padding:32px;color:#ef4444;">
          <i class="fas fa-exclamation-triangle" style="font-size:24px;margin-bottom:8px;display:block;"></i>
          <div style="font-weight:600;">Failed to load earnings</div>
          <div style="font-size:12px;color:#9ca3af;margin-top:4px;">${_esc(err.message)}</div>
          <button onclick="window._bmgFixReloadEarnings()"
            style="margin-top:12px;padding:8px 20px;background:#2563eb;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;">
            Retry
          </button>
        </div>`;
    }
  }


  /* ══════════════════════════════════════════════════════════════
     Payouts tab renderer
  ══════════════════════════════════════════════════════════════ */
  async function renderPayoutsTab(container) {
    const cu = _cu(), db = _db();
    if (!cu || !db) {
      container.innerHTML = '<p style="text-align:center;padding:32px;color:#9ca3af;">Please log in.</p>';
      return;
    }

    if (typeof window.showLoading === 'function') window.showLoading('Loading payouts…');

    try {
      const bal = await computeRealBalance(cu.uid);

      const prSnap = await db.collection('payout_requests')
        .where('ownerId', '==', cu.uid)
        .orderBy('createdAt', 'desc')
        .get().catch(async () =>
          db.collection('payout_requests').where('ownerId', '==', cu.uid).get().catch(() => ({ docs: [] }))
        );

      const stats = { total: prSnap.docs.length, pending: 0, approved: 0, paid: 0, rejected: 0 };
      prSnap.docs.forEach(d => { const st = d.data().status; if (stats[st] !== undefined) stats[st]++; });
      const hasPending = bal.pendingRequests.length > 0;

      function _statusCard(docId, p) {
        const st     = p.status || 'pending';
        const icons  = { pending:'fa-clock', approved:'fa-check-circle', paid:'fa-money-bill-wave', rejected:'fa-times-circle' };
        const labels = { pending:'Under Review', approved:'Approved', paid:'Paid ✓', rejected:'Rejected' };
        const colors = { pending:'#f59e0b', approved:'#3b82f6', paid:'#22c55e', rejected:'#ef4444' };
        return `
          <div class="psp-card" data-status="${st}"
            style="background:#fff;border-radius:14px;padding:14px;margin-bottom:10px;border:1.5px solid #e8edf8;box-shadow:0 2px 8px rgba(15,31,92,.06);">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
              <div>
                <div style="font-size:13px;font-weight:800;color:#0f1f5c;">Payout Request</div>
                <div style="font-size:11px;color:#9ca3af;margin-top:2px;">${_fmtDate(p.createdAt)}</div>
              </div>
              <div style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:20px;
                  background:${colors[st]}18;color:${colors[st]};font-size:11px;font-weight:700;">
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

      if (typeof window.hideLoading === 'function') window.hideLoading();

      container.innerHTML = `
        <!-- Balance hero -->
        <div style="background:linear-gradient(135deg,#1b2e6c,#2563eb);border-radius:16px;padding:20px;margin-bottom:16px;color:#fff;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;">
            <div>
              <div style="font-size:11px;opacity:.75;margin-bottom:4px;"><i class="fas fa-wallet"></i> Available to Withdraw</div>
              <div style="font-size:34px;font-weight:800;letter-spacing:-0.6px;">${_fmt(bal.available)}</div>
              <div style="font-size:11px;opacity:.65;margin-top:4px;">
                Earned ${_fmt(bal.earned)}${bal.transferred > 0 ? ` · Transferred ${_fmt(bal.transferred)}` : ''}${bal.locked > 0 ? ` · In review ${_fmt(bal.locked)}` : ''}
              </div>
            </div>
            <button id="psp-apply-trigger"
              ${hasPending || bal.available < 1 ? 'disabled' : ''}
              style="background:rgba(255,255,255,.18);border:1.5px solid rgba(255,255,255,.35);color:#fff;
                font-size:12px;font-weight:700;padding:10px 14px;border-radius:22px;white-space:nowrap;
                font-family:inherit;opacity:${hasPending || bal.available < 1 ? '.6' : '1'};
                cursor:${hasPending || bal.available < 1 ? 'not-allowed' : 'pointer'};">
              <i class="fas fa-paper-plane" style="margin-right:5px;"></i>
              ${hasPending ? 'Request Pending' : 'Apply for Payout'}
            </button>
          </div>
          ${bal.locked > 0 ? `
          <div style="margin-top:12px;background:rgba(255,255,255,.1);border-radius:8px;padding:8px 10px;
              font-size:11px;opacity:.85;display:flex;align-items:center;gap:6px;">
            <i class="fas fa-clock" style="color:#fde047;"></i>
            <span>${_fmt(bal.locked)} is already under a pending payout request.</span>
          </div>` : ''}
        </div>

        <!-- Stats row -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px;">
          ${[
            ['Total',       stats.total,                     '#0f1f5c','#f8faff','#e8edf8'],
            ['In Progress', stats.pending + stats.approved,  '#92400e','#fffbeb','#fde68a'],
            ['Paid',        stats.paid,                      '#15803d','#f0fdf4','#86efac'],
            ['Rejected',    stats.rejected,                  '#b91c1c','#fef2f2','#fca5a5'],
          ].map(([label, val, tc, bg, border]) => `
            <div style="background:${bg};border-radius:12px;padding:10px;text-align:center;border:1px solid ${border};">
              <div style="font-size:18px;font-weight:800;color:${tc};">${val}</div>
              <div style="font-size:10px;color:${tc};font-weight:600;opacity:.75;margin-top:2px;">${label}</div>
            </div>`).join('')}
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
      `;

      /* Wire apply button */
      const applyBtn = document.getElementById('psp-apply-trigger');
      if (applyBtn && !hasPending && bal.available >= 1) {
        applyBtn.addEventListener('click', () => openPayoutModal());
      }

    } catch (err) {
      if (typeof window.hideLoading === 'function') window.hideLoading();
      warn('renderPayoutsTab error:', err.message);
      container.innerHTML = `<div style="text-align:center;padding:32px;color:#ef4444;">Failed: ${_esc(err.message)}</div>`;
    }
  }


  /* ══════════════════════════════════════════════════════════════
     Payout request modal
  ══════════════════════════════════════════════════════════════ */
  async function openPayoutModal() {
    const cu = _cu(), db = _db();
    if (!cu || !db) { alert('Please log in first.'); return; }

    const bal = await computeRealBalance(cu.uid).catch(() => null);
    if (!bal) { alert('Could not load balance. Please try again.'); return; }

    if (bal.pendingRequests.length > 0) {
      const fn = typeof window.showToast === 'function' ? window.showToast : alert;
      fn('You already have a pending payout request. Please wait for it to be processed.', 'warning');
      return;
    }
    if (bal.available < 1) {
      const fn = typeof window.showToast === 'function' ? window.showToast : alert;
      fn('No balance available to withdraw yet.', 'info');
      return;
    }

    const available = bal.available;

    document.getElementById('gef-payout-modal')?.remove();
    const ov = document.createElement('div');
    ov.id = 'gef-payout-modal';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:flex-end;justify-content:center;';
    ov.innerHTML = `
      <div style="background:#fff;border-radius:20px 20px 0 0;padding:24px;width:100%;max-width:480px;max-height:90vh;overflow-y:auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
          <div style="font-size:16px;font-weight:800;color:#0f1f5c;">Request Payout</div>
          <button id="gef-modal-close" style="background:none;border:none;font-size:22px;color:#9ca3af;cursor:pointer;line-height:1;">×</button>
        </div>
        <div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;padding:12px;margin-bottom:16px;text-align:center;">
          <div style="font-size:11px;color:#15803d;font-weight:600;">Available Balance</div>
          <div style="font-size:28px;font-weight:800;color:#15803d;">${_fmt(available)}</div>
        </div>
        <div style="margin-bottom:14px;">
          <label style="font-size:13px;font-weight:700;color:#374151;display:block;margin-bottom:6px;">Amount to Withdraw</label>
          <input id="gef-amt" type="number" min="1" max="${Math.floor(available)}" value="${Math.floor(available)}"
            style="width:100%;padding:12px;border:1.5px solid #e8edf8;border-radius:10px;font-size:15px;font-family:inherit;box-sizing:border-box;outline:none;">
          <div id="gef-amt-err" style="color:#ef4444;font-size:12px;margin-top:4px;display:none;"></div>
          <div style="display:flex;gap:8px;margin-top:8px;">
            ${[25,50,75,100].map(p => `
              <button onclick="document.getElementById('gef-amt').value=Math.floor(${available}*${p}/100);document.getElementById('gef-amt-err').style.display='none';"
                style="flex:1;padding:6px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;
                  font-size:11px;font-weight:700;color:#1d4ed8;cursor:pointer;font-family:inherit;">${p}%</button>`).join('')}
          </div>
        </div>
        <div style="margin-bottom:16px;">
          <label style="font-size:13px;font-weight:700;color:#374151;display:block;margin-bottom:6px;">UPI ID</label>
          <input id="gef-upi" type="text" placeholder="yourname@upi"
            style="width:100%;padding:12px;border:1.5px solid #e8edf8;border-radius:10px;font-size:14px;font-family:inherit;box-sizing:border-box;outline:none;">
          <div id="gef-upi-err" style="color:#ef4444;font-size:12px;margin-top:4px;display:none;"></div>
        </div>
        <button id="gef-submit-payout"
          style="width:100%;padding:14px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;
            border-radius:12px;font-weight:700;font-size:15px;cursor:pointer;font-family:inherit;">
          <i class="fas fa-paper-plane" style="margin-right:6px;"></i> Submit Payout Request
        </button>
      </div>`;

    document.body.appendChild(ov);
    document.getElementById('gef-modal-close').onclick = () => ov.remove();
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });

    document.getElementById('gef-submit-payout').addEventListener('click', async function () {
      const amtInput = document.getElementById('gef-amt');
      const upiInput = document.getElementById('gef-upi');
      const amtErr   = document.getElementById('gef-amt-err');
      const upiErr   = document.getElementById('gef-upi-err');
      const amt = parseFloat(amtInput.value);
      const upi = upiInput.value.trim();
      amtErr.style.display = 'none';
      upiErr.style.display = 'none';

      if (!amt || amt < 1) { amtErr.textContent = 'Enter a valid amount.'; amtErr.style.display = 'block'; return; }
      if (amt > available + 0.5) { amtErr.textContent = `Exceeds available balance of ${_fmt(available)}.`; amtErr.style.display = 'block'; return; }
      if (!upi || !upi.includes('@')) { upiErr.textContent = 'Enter a valid UPI ID (e.g. name@upi).'; upiErr.style.display = 'block'; return; }

      this.disabled = true;
      this.textContent = 'Submitting…';

      try {
        /* Re-check for duplicate */
        const latestPending = await db.collection('payout_requests')
          .where('ownerId', '==', cu.uid)
          .where('status', 'in', ['pending', 'approved'])
          .get().catch(() => ({ docs: [] }));
        if (latestPending.docs.length > 0) {
          alert('A payout request is already pending. Please wait.');
          ov.remove();
          return;
        }

        await db.collection('payout_requests').add({
          requestId      : 'POUT-' + Date.now(),
          ownerId        : cu.uid,
          ownerName      : cu.ownerName || cu.name || cu.displayName || '',
          ownerEmail     : cu.email || '',
          upiId          : upi,
          amount         : Math.round(amt),
          requestedAmount: Math.round(amt),
          status         : 'pending',
          bookingIds     : [],
          createdAt      : _ts(),
          updatedAt      : _ts(),
        });

        ov.remove();

        const toastFn = window.showToast || window._toast || ((m) => alert(m));
        toastFn('Payout request submitted! Admin will review within 2–3 business days.', 'success');

        /* Refresh payouts tab */
        const cont = document.getElementById('owner-dashboard-content') || document.getElementById('owner-earnings-content');
        if (cont) renderPayoutsTab(cont).catch(() => {});

      } catch (err) {
        warn('Payout submit error:', err.message);
        this.disabled = false;
        this.innerHTML = '<i class="fas fa-paper-plane" style="margin-right:6px;"></i> Submit Payout Request';
        amtErr.textContent = 'Failed to submit. Please try again.';
        amtErr.style.display = 'block';
      }
    });
  }


  /* ══════════════════════════════════════════════════════════════
     Install — overwrite all previous (broken) versions
  ══════════════════════════════════════════════════════════════ */
  function install() {
    window.loadOwnerEarnings         = renderEarningsTab;
    window.loadOwnerPayouts          = renderPayoutsTab;
    window._bmgLoadOwnerEarningsFull = renderEarningsTab;
    window._bmgOpenPayoutModal       = openPayoutModal;
    window.showPayoutRequestModal    = openPayoutModal;
    window._efComputeRealBalance     = computeRealBalance;
    window._pspEarningsPatched       = true;
    window._gefInstalled             = true;
    window._bmgFixReloadEarnings     = function (container) {
      const c = container
        || document.getElementById('owner-dashboard-content')
        || document.getElementById('owner-earnings-content');
      if (c) renderEarningsTab(c).catch(console.error);
    };
    log('✅ Fixed computeRealBalance + renderers installed (v3 — uses owner_transfers)');
  }

  function patchDashboardRouter() {
    if (!window.loadOwnerDashboard) { setTimeout(patchDashboardRouter, 300); return; }
    if (window.__pzfRouterPatched) return;

    const _orig = window.loadOwnerDashboard;
    window.loadOwnerDashboard = async function (tab) {
      const container = document.getElementById('owner-dashboard-content');
      if (tab === 'earnings' && container) {
        document.querySelectorAll('.dashboard-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('owner-earnings-tab')?.classList.add('active');
        container.innerHTML = '<div class="loading-spinner"><div class="loader-spinner"></div></div>';
        try { await renderEarningsTab(container); } catch (e) { warn('earnings error:', e.message); }
        return;
      }
      if (tab === 'payouts' && container) {
        document.querySelectorAll('.dashboard-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('owner-payouts-tab')?.classList.add('active');
        container.innerHTML = '<div class="loading-spinner"><div class="loader-spinner"></div></div>';
        try { await renderPayoutsTab(container); } catch (e) { warn('payouts error:', e.message); }
        return;
      }
      return _orig.apply(this, arguments);
    };

    window.__pzfRouterPatched = true;
    log('✅ loadOwnerDashboard patched');
  }

  function wireRefreshEvents() {
    window.addEventListener('bmg:paymentConfirmed', function () {
      setTimeout(() => {
        const c = document.getElementById('owner-dashboard-content') || document.getElementById('owner-earnings-content');
        if (c) renderEarningsTab(c).catch(() => {});
      }, 3000);
    });
    window.addEventListener('bmg:earningsNeedRefresh', function () {
      setTimeout(() => {
        const c = document.getElementById('owner-dashboard-content') || document.getElementById('owner-earnings-content');
        if (c) renderEarningsTab(c).catch(() => {});
      }, 1000);
    });
  }

  /* Boot */
  install();
  patchDashboardRouter();
  wireRefreshEvents();
  setTimeout(install, 200);
  setTimeout(install, 700);
  setTimeout(install, 1800);
  setTimeout(patchDashboardRouter, 400);

  /* MutationObserver: survive any late overwrites */
  (function attachObserver() {
    const el = document.getElementById('owner-dashboard-page');
    if (!el) { setTimeout(attachObserver, 500); return; }
    new MutationObserver(() => {
      if (window.loadOwnerEarnings !== renderEarningsTab) install();
    }).observe(el, { childList: true, subtree: true });
    log('MutationObserver attached');
  })();

  log('sportobook_payout_zero_fix.js v3 loaded ✅');
})();