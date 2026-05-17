/**
 * bmg_earnings_collection_fix.js
 * ─────────────────────────────────────────────────────────────────────
 * FIX: "Received Transfers" shows ₹0 in Owner Earnings even though
 * the admin payment appears correctly in Payouts tab.
 *
 * ROOT CAUSE:
 *   The earnings function reads from 'owner_payments' collection.
 *   But admin transfers (from markPayoutAsPaid + bmgAdminTransferPayment)
 *   are actually written to 'payout_requests' with status:'paid' and
 *   requestId starting with 'ADMIN-'.
 *   owner_payments is empty → Received Transfers shows ₹0.
 *
 * FIX:
 *   Override _bmgLoadOwnerEarningsFull to read admin transfers from
 *   BOTH collections (payout_requests with paid status + owner_payments)
 *   so all payment sources are captured regardless of which path wrote them.
 *
 * LOAD ORDER — add last in index.html:
 *   <script src="bmg_earnings_collection_fix.js"></script>
 * ─────────────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  const fmt   = v => typeof window.formatCurrency === 'function' ? window.formatCurrency(v) : '₹' + Number(v || 0).toFixed(0);
  const getDb = () => window.db;
  const getFs = () => window.firebase?.firestore?.FieldValue;

  /* ──────────────────────────────────────────────────────────────────
   * Full owner earnings loader — reads from all correct collections
   * ────────────────────────────────────────────────────────────────── */
  async function loadOwnerEarningsFull(container) {
    if (!container) {
      container = document.getElementById('earnings-container')
        || document.querySelector('[id*="earnings"]')
        || document.getElementById('admin-dashboard-content');
    }
    if (!container) return;

    const _db = getDb();
    const cu  = window.currentUser;
    if (!_db || !cu) {
      container.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:32px;">Please log in to view earnings.</p>';
      return;
    }

    container.innerHTML = `
      <div style="text-align:center;padding:40px;">
        <div class="loader-spinner" style="margin:0 auto 12px;"></div>
        <p style="color:#6b7280;font-size:14px;">Loading earnings…</p>
      </div>`;

    try {
      /* ── 1. Ground Booking Earnings ──────────────────────────── */
      let bookingSnap;
      try {
        bookingSnap = await _db.collection('bookings')
          .where('ownerId', '==', cu.uid)
          .where('bookingStatus', '==', 'confirmed')
          .orderBy('createdAt', 'desc')
          .get();
      } catch (_) {
        // Fallback without orderBy if index missing
        bookingSnap = await _db.collection('bookings')
          .where('ownerId', '==', cu.uid)
          .where('bookingStatus', '==', 'confirmed')
          .get();
      }

      let totalBookingEarnings = 0;
      let bookingCount = 0;
      const bookingRows = [];

      bookingSnap.forEach(doc => {
        const b = doc.data();
        const fullAmt  = Number(b.amount || b.totalAmount || 0);
        const platFee  = Number(b.commission || b.platformFee || Math.round(fullAmt * 0.10));
        const ownerAmt = Number(b.ownerAmount || (fullAmt - platFee));
        if (ownerAmt <= 0) return;
        totalBookingEarnings += ownerAmt;
        bookingCount++;
        bookingRows.push({
          date    : b.date || '—',
          ground  : b.groundName || b.venueName || '—',
          slot    : b.slotTime   || '—',
          fullAmt, platFee, ownerAmt,
          status  : b.payoutStatus || 'pending',
        });
      });

      /* ── 2. Tournament Earnings (owner's tournaments) ─────────── */
      let ownTournIds = [];
      try {
        const ownTournSnap = await _db.collection('tournaments')
          .where('ownerId', '==', cu.uid)
          .get();
        ownTournIds = ownTournSnap.docs.map(d => d.id).filter(Boolean);
      } catch (_) {}

      let totalTournEarnings = 0;
      let tournCount = 0;
      const tournRows = [];

      if (ownTournIds.length > 0) {
        for (let i = 0; i < ownTournIds.length; i += 10) {
          const chunk = ownTournIds.slice(i, i + 10);
          try {
            const tSnap = await _db.collection('tournament_entries')
              .where('tournamentId', 'in', chunk)
              .where('status', '==', 'confirmed')
              .get();

            tSnap.docs.forEach(doc => {
              const e = doc.data();
              const entryFee = Number(e.amount || e.entryFee || 0);
              const platFee  = Number(e.platformFee || Math.round(entryFee * 0.20));
              const ownerAmt = Number(e.ownerAmount  || (entryFee - platFee));
              if (ownerAmt <= 0) return;
              totalTournEarnings += ownerAmt;
              tournCount++;
              tournRows.push({
                tournament: e.tournamentName || '—',
                team      : e.teamName       || '—',
                date      : e.date           || '—',
                entryFee, platFee, ownerAmt,
              });
            });
          } catch (_) {}
        }
      }

      /* ── 3. Admin / CEO Transfers — read from BOTH collections ── *
       *                                                               *
       *  Source A: payout_requests where status='paid' AND           *
       *            (requestId starts with 'ADMIN' OR                 *
       *             type = 'admin_direct_transfer')                  *
       *            This is what markPayoutAsPaid() writes to.        *
       *                                                              *
       *  Source B: owner_payments where status='paid'                *
       *            This is what bmgAdminTransferPayment() also       *
       *            writes to as a secondary record.                  *
       * ─────────────────────────────────────────────────────────── */
      const transferRows = [];
      const seenIds = new Set(); // deduplicate across both collections

      // Source A — payout_requests (status:paid, admin-originated)
      try {
        const prSnap = await _db.collection('payout_requests')
          .where('ownerId', '==', cu.uid)
          .where('status',  '==', 'paid')
          .get();

        prSnap.docs.forEach(doc => {
          const t = doc.data();
          // Include only admin-initiated payments (not owner payout requests)
          const reqId  = t.requestId || t.requestid || '';
          const isAdmin = reqId.startsWith('ADMIN')
            || t.type === 'admin_direct_transfer'
            || t.paidBy === 'admin'
            || (!t.bookingIds?.length && !t.upiId && t.status === 'paid' && t.paidBy);

          if (!isAdmin) return;
          if (seenIds.has(doc.id)) return;
          seenIds.add(doc.id);

          const amt    = Number(t.amount || 0);
          const paidAt = t.paidAt?.toDate?.()?.toLocaleDateString('en-IN')
            || (t.paidAt ? new Date(t.paidAt).toLocaleDateString('en-IN') : '—');
          const paidBy = t.paidByName || t.adminName || t.ownerName || 'Admin';

          transferRows.push({
            amount : amt,
            note   : t.note || t.description || reqId || 'Admin Transfer',
            paidAt,
            paidBy,
            method : t.method || t.paymentMethod || 'UPI',
          });
        });
      } catch (err) {
        console.warn('[EarningsFix] payout_requests read error:', err);
      }

      // Source B — owner_payments collection (secondary write)
      try {
        const opSnap = await _db.collection('owner_payments')
          .where('ownerId', '==', cu.uid)
          .where('status',  '==', 'paid')
          .get();

        opSnap.docs.forEach(doc => {
          if (seenIds.has(doc.id)) return;
          seenIds.add(doc.id);
          const t = doc.data();
          const amt    = Number(t.amount || 0);
          const paidAt = t.paidAt?.toDate?.()?.toLocaleDateString('en-IN') || '—';
          transferRows.push({
            amount : amt,
            note   : t.note || t.description || 'Admin Transfer',
            paidAt,
            paidBy : t.paidByName || t.adminName || 'Admin',
            method : t.method     || 'UPI',
          });
        });
      } catch (_) {
        // Collection may not exist yet — safe to ignore
      }

      // Sort transfers newest first
      transferRows.sort((a, b) => {
        if (a.paidAt === '—') return 1;
        if (b.paidAt === '—') return -1;
        return new Date(b.paidAt) - new Date(a.paidAt);
      });

      const totalTransfers = transferRows.reduce((s, r) => s + r.amount, 0);
      const grandTotal     = totalBookingEarnings + totalTournEarnings + totalTransfers;

      /* ── 4. Render ────────────────────────────────────────────── */
      container.innerHTML = `
        <style>
          .bef-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:20px;}
          .bef-card{background:#fff;border-radius:16px;padding:16px 14px;text-align:center;box-shadow:0 2px 14px rgba(0,0,0,.07);}
          .bef-val{font-size:24px;font-weight:800;}
          .bef-lbl{font-size:10px;color:#9ca3af;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-top:4px;}
          .bef-sub{font-size:11px;color:#6b7280;margin-top:2px;}
          .bef-section{background:#fff;border-radius:16px;padding:18px;margin-bottom:16px;box-shadow:0 2px 12px rgba(0,0,0,.07);}
          .bef-section h3{font-size:15px;font-weight:700;color:#111;margin:0 0 14px;display:flex;align-items:center;gap:8px;}
          .bef-table{width:100%;border-collapse:collapse;font-size:12px;}
          .bef-table th{background:#f9fafb;color:#6b7280;font-weight:700;text-transform:uppercase;font-size:10px;letter-spacing:.3px;padding:9px 10px;text-align:left;border-bottom:1px solid #e5e7eb;}
          .bef-table td{padding:9px 10px;border-bottom:1px solid #f3f4f6;color:#374151;vertical-align:top;}
          .bef-table tr:last-child td{border:none;}
          .bef-badge-paid{background:#d1fae5;color:#065f46;font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;white-space:nowrap;}
          .bef-badge-pending{background:#fef3c7;color:#92400e;font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;}
          .bef-badge-transfer{background:#dbeafe;color:#1e40af;font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;}
          .bef-empty{text-align:center;padding:24px 0;color:#9ca3af;font-size:13px;}
        </style>

        <!-- Summary cards -->
        <div class="bef-grid">
          <div class="bef-card" style="grid-column:1/-1;border-top:3px solid #10b981;">
            <div class="bef-val" style="color:#10b981;">${fmt(grandTotal)}</div>
            <div class="bef-lbl">Total Earnings</div>
            <div class="bef-sub">All sources combined</div>
          </div>
          <div class="bef-card" style="border-top:3px solid #3b82f6;">
            <div class="bef-val" style="color:#3b82f6;">${fmt(totalBookingEarnings)}</div>
            <div class="bef-lbl">Ground Bookings</div>
            <div class="bef-sub">${bookingCount} booking${bookingCount !== 1 ? 's' : ''} · 90%</div>
          </div>
          <div class="bef-card" style="border-top:3px solid #8b5cf6;">
            <div class="bef-val" style="color:#8b5cf6;">${fmt(totalTournEarnings)}</div>
            <div class="bef-lbl">Tournaments</div>
            <div class="bef-sub">${tournCount} entr${tournCount !== 1 ? 'ies' : 'y'} · 80%</div>
          </div>
          <div class="bef-card" style="border-top:3px solid #f59e0b;">
            <div class="bef-val" style="color:#f59e0b;">${fmt(totalTransfers)}</div>
            <div class="bef-lbl">Received Transfers</div>
            <div class="bef-sub">${transferRows.length} payment${transferRows.length !== 1 ? 's' : ''}</div>
          </div>
          <div class="bef-card" style="border-top:3px solid #6b7280;">
            <div class="bef-val" style="color:#6b7280;">${fmt(grandTotal - totalTransfers)}</div>
            <div class="bef-lbl">Pending Payout</div>
            <div class="bef-sub">Not yet transferred</div>
          </div>
        </div>

        <!-- Commission info -->
        <div style="background:linear-gradient(135deg,#eff6ff,#dbeafe);border-radius:12px;padding:12px 16px;margin-bottom:16px;font-size:12px;color:#1e40af;display:flex;align-items:flex-start;gap:10px;">
          <i class="fas fa-info-circle" style="margin-top:2px;flex-shrink:0;"></i>
          <span><strong>Commission:</strong> Ground bookings — you earn <strong>90%</strong> (10% platform fee) &nbsp;·&nbsp; Tournaments — you earn <strong>80%</strong> (20% platform fee)</span>
        </div>

        <!-- Ground Booking Earnings -->
        <div class="bef-section">
          <h3><i class="fas fa-football-ball" style="color:#3b82f6;font-size:14px;"></i> Ground Booking Earnings</h3>
          ${bookingRows.length === 0
            ? '<p class="bef-empty">No confirmed bookings yet</p>'
            : `<div style="overflow-x:auto;"><table class="bef-table">
                <thead><tr><th>Date</th><th>Ground</th><th>Slot</th><th>Total</th><th>Platform</th><th>Your Share</th><th>Status</th></tr></thead>
                <tbody>${bookingRows.map(r => `<tr>
                  <td>${r.date}</td><td>${r.ground}</td><td>${r.slot}</td>
                  <td>${fmt(r.fullAmt)}</td>
                  <td style="color:#ef4444;">-${fmt(r.platFee)}</td>
                  <td style="color:#10b981;font-weight:700;">${fmt(r.ownerAmt)}</td>
                  <td><span class="${r.status === 'payout_done' ? 'bef-badge-paid' : 'bef-badge-pending'}">${r.status === 'payout_done' ? '✓ Paid' : 'Pending'}</span></td>
                </tr>`).join('')}</tbody>
              </table></div>`}
        </div>

        <!-- Tournament Earnings -->
        <div class="bef-section">
          <h3><i class="fas fa-trophy" style="color:#8b5cf6;font-size:14px;"></i> Tournament Earnings</h3>
          ${tournRows.length === 0
            ? '<p class="bef-empty">No tournament earnings yet</p>'
            : `<div style="overflow-x:auto;"><table class="bef-table">
                <thead><tr><th>Tournament</th><th>Team</th><th>Date</th><th>Entry Fee</th><th>Platform</th><th>Your Share</th></tr></thead>
                <tbody>${tournRows.map(r => `<tr>
                  <td>${r.tournament}</td><td>${r.team}</td><td>${r.date}</td>
                  <td>${fmt(r.entryFee)}</td>
                  <td style="color:#ef4444;">-${fmt(r.platFee)}</td>
                  <td style="color:#10b981;font-weight:700;">${fmt(r.ownerAmt)}</td>
                </tr>`).join('')}</tbody>
              </table></div>`}
        </div>

        <!-- Received Transfers from Admin / CEO -->
        <div class="bef-section">
          <h3><i class="fas fa-exchange-alt" style="color:#f59e0b;font-size:14px;"></i> Received from Admin / CEO</h3>
          ${transferRows.length === 0
            ? '<p class="bef-empty">No transfers received yet</p>'
            : `<div style="overflow-x:auto;"><table class="bef-table">
                <thead><tr><th>Date</th><th>Paid By</th><th>Method</th><th>Note / Ref</th><th>Amount</th></tr></thead>
                <tbody>${transferRows.map(r => `<tr>
                  <td>${r.paidAt}</td>
                  <td>${r.paidBy}</td>
                  <td>${r.method}</td>
                  <td style="max-width:120px;word-break:break-all;">${r.note}</td>
                  <td style="color:#10b981;font-weight:700;white-space:nowrap;">${fmt(r.amount)} <span class="bef-badge-transfer">PAID</span></td>
                </tr>`).join('')}</tbody>
              </table></div>`}
        </div>
      `;

    } catch (err) {
      console.error('[EarningsFix] loadOwnerEarnings error:', err);
      container.innerHTML = `
        <div style="text-align:center;padding:40px;">
          <i class="fas fa-exclamation-triangle" style="font-size:32px;color:#ef4444;margin-bottom:12px;"></i>
          <p style="color:#ef4444;font-weight:600;">Failed to load earnings</p>
          <button onclick="window._bmgLoadOwnerEarningsFull(this.closest('[id]'))" 
            style="margin-top:12px;padding:10px 20px;background:#3b82f6;color:#fff;border:none;border-radius:10px;cursor:pointer;">
            Retry
          </button>
        </div>`;
    }
  }

  /* ── Install as the canonical earnings function ──────────────── */
  window._bmgLoadOwnerEarningsFull = loadOwnerEarningsFull;
  window.loadOwnerEarnings         = loadOwnerEarningsFull;

  /* ── Also patch markPayoutAsPaid to cross-write to owner_payments ─
   * This ensures BOTH collections stay in sync for future payments.  */
  function patchMarkPayoutAsPaid() {
    const orig = window.markPayoutAsPaid;
    if (typeof orig !== 'function' || orig.__befPatched) return;

    window.markPayoutAsPaid = async function (requestId) {
      // Run the original function first (updates payout_requests)
      await orig.call(this, requestId);

      // Then cross-write to owner_payments so the earnings tab also sees it
      try {
        const _db = getDb();
        const cu  = window.currentUser;
        if (!_db || !cu) return;

        const payoutDoc = await _db.collection('payout_requests').doc(requestId).get();
        if (!payoutDoc.exists) return;

        const payout = payoutDoc.data();
        if (!payout.ownerId) return;

        // Check if already cross-written (idempotent)
        const existing = await _db.collection('owner_payments')
          .where('sourceId', '==', requestId)
          .limit(1)
          .get()
          .catch(() => ({ empty: true }));

        if (!existing.empty) return; // already written

        await _db.collection('owner_payments').add({
          sourceId     : requestId,
          ownerId      : payout.ownerId,
          ownerName    : payout.ownerName    || '',
          amount       : Number(payout.amount || 0),
          method       : payout.method       || 'UPI',
          note         : payout.requestId    || payout.note || 'Admin Transfer',
          description  : `Payout approved — ${payout.requestId || requestId}`,
          status       : 'paid',
          paidAt       : getFs()?.serverTimestamp() || new Date(),
          paidBy       : cu.uid,
          paidByName   : cu.name || cu.displayName || cu.email || 'Admin',
          paidByEmail  : cu.email || '',
          createdAt    : getFs()?.serverTimestamp() || new Date(),
          updatedAt    : getFs()?.serverTimestamp() || new Date(),
        });

        console.log('[EarningsFix] ✅ Cross-written to owner_payments for', requestId);
      } catch (err) {
        // Non-fatal — payout_requests is the source of truth
        console.warn('[EarningsFix] owner_payments cross-write failed (non-fatal):', err);
      }
    };

    window.markPayoutAsPaid.__befPatched = true;
    console.log('[EarningsFix] markPayoutAsPaid patched for cross-write');
  }

  /* ── Init ────────────────────────────────────────────────────── */
  function init() {
    patchMarkPayoutAsPaid();
    console.log('✅ [bmg_earnings_collection_fix.js] Loaded — Received Transfers reads from payout_requests');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 250));
  } else {
    setTimeout(init, 250);
  }

  // Retry patch after app.js finishes loading its functions
  setTimeout(patchMarkPayoutAsPaid, 1500);

})();