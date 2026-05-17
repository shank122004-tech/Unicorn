/**
 * bmg_master_patch_v3.js
 * ══════════════════════════════════════════════════════════════════
 *
 * FIXES IN THIS FILE:
 *  1. Firestore rules fix  → slot_locks delete permission error
 *  2. Admin → Owner Earnings real-time sync (onSnapshot)
 *     When admin marks payout as PAID → owner earnings section
 *     instantly shows COMPLETED (not pending)
 *  3. Admin Owners section → owners with PENDING payments float TOP
 *  4. Admin Approved Verifications section (always-visible panel)
 *  5. Home page Nearby Grounds → smooth, professional card UI
 *     with skeleton shimmer + real geolocation distance sorting
 *  6. Slot → Booking Page speed fix (parallel fetch, no mobile prompt delay)
 *  7. 404 fix → bmg_earnings_fix_v2.js removed from index.html load
 *
 * LOAD ORDER in index.html (add LAST, after all existing scripts):
 *   <script src="bmg_master_patch_v3.js"></script>
 * ══════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════
   * UTILITIES
   * ══════════════════════════════════════════════════════════════ */
  const _db  = () => window.db;
  const _cu  = () => window.currentUser;
  const _fmt = (n) => typeof window.formatCurrency === 'function' ? window.formatCurrency(n) : '₹' + Number(n || 0).toLocaleString('en-IN');
  const _toast = (m, t, d) => typeof window.showToast === 'function' && window.showToast(m, t || 'info', d || 3000);
  const _ts  = () => firebase.firestore.FieldValue.serverTimestamp();

  /* ══════════════════════════════════════════════════════════════
   * 1. FIX: slot_locks delete — "Missing or insufficient permissions"
   *
   * Root cause: Firestore rules allow delete only when
   *   resource.data.userId == request.auth.uid OR isAdmin()
   *   OR resource.data.expiresAt < request.time
   * But cleanupExpiredLocks() does a collection-group query and tries
   * to delete docs it doesn't own. The rules require the userId match.
   *
   * Fix: patch cleanupExpiredLocks to only delete locks owned by the
   * current user, or skip deleting others' locks (they'll expire anyway).
   * ══════════════════════════════════════════════════════════════ */
  function _patchCleanupExpiredLocks() {
    window.cleanupExpiredLocks = async function () {
      const cu = _cu();
      if (!cu) return;
      try {
        const now = new Date();
        const snap = await _db().collection('slot_locks')
          .where('userId', '==', cu.uid)         // ← only OUR locks
          .where('expiresAt', '<', now)
          .limit(20)
          .get();

        if (snap.empty) return;
        const batch = _db().batch();
        snap.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        console.log('[Patch] Cleaned up', snap.size, 'expired slot_locks');
      } catch (e) {
        // Silently swallow — this is background housekeeping
        console.warn('[Patch] cleanupExpiredLocks non-fatal:', e.message);
      }
    };
    console.log('[Patch v3] cleanupExpiredLocks patched ✅');
  }


  /* ══════════════════════════════════════════════════════════════
   * 2. REAL-TIME OWNER EARNINGS ↔ ADMIN PAYOUT SYNC
   *
   * Problem: Admin marks payout as "paid" → payout_requests doc
   * status becomes "paid" but owner earnings section shows "pending"
   * because loadOwnerEarnings does a one-time .get() and doesn't
   * react to changes.
   *
   * Fix A: Patch markPayoutAsPaid to also write to owner_payments
   *        collection (which owner earnings section reads from) with
   *        status:"completed" and ownerAmount with 10% deducted.
   *
   * Fix B: Install an onSnapshot listener on owner_payments so the
   *        owner earnings UI refreshes automatically in real time.
   * ══════════════════════════════════════════════════════════════ */
  function _patchMarkPayoutAsPaid() {
    const _origMarkPaid = window.markPayoutAsPaid;

    window.markPayoutAsPaid = async function (requestId) {
      // Run original first
      if (typeof _origMarkPaid === 'function') {
        await _origMarkPaid(requestId);
      } else {
        // Fallback implementation if original is missing
        const payoutRef = _db().collection('payout_requests').doc(requestId);
        const doc = await payoutRef.get();
        if (!doc.exists) { _toast('Payout request not found', 'error'); return; }
        await payoutRef.update({ status: 'paid', paidAt: _ts(), paidBy: _cu()?.uid, updatedAt: _ts() });
      }

      // Now sync to owner_payments so owner dashboard shows it
      try {
        const payoutDoc = await _db().collection('payout_requests').doc(requestId).get();
        if (!payoutDoc.exists) return;
        const payout = payoutDoc.data();

        const grossAmount  = Number(payout.amount || 0);
        const commission   = Math.round(grossAmount * 0.10);
        const ownerAmount  = grossAmount - commission;

        // Write / merge into owner_payments collection
        await _db().collection('owner_payments').doc(requestId).set({
          ownerId       : payout.ownerId       || '',
          ownerName     : payout.ownerName     || '',
          amount        : grossAmount,
          ownerAmount   : ownerAmount,
          commission    : commission,
          platformFee   : commission,
          status        : 'completed',           // ← KEY: not "pending"
          paymentType   : 'payout',
          requestId     : requestId,
          bookingIds    : payout.bookingIds     || [],
          paidBy        : _cu()?.uid            || '',
          paidByName    : _cu()?.name           || _cu()?.email || '',
          paidAt        : _ts(),
          createdAt     : payout.createdAt      || _ts(),
          updatedAt     : _ts(),
          notes         : payout.notes          || '',
          upiId         : payout.upiId          || '',
        }, { merge: true });

        // Also bump owner doc totals
        const ownerRef = _db().collection('owners').doc(payout.ownerId);
        await ownerRef.update({
          totalPaidOut  : firebase.firestore.FieldValue.increment(ownerAmount),
          lastPayoutAt  : _ts(),
          updatedAt     : _ts(),
        });

        console.log('[Patch v3] markPayoutAsPaid synced to owner_payments ✅');
        _toast('✅ Payment synced to owner earnings in real time', 'success');
      } catch (err) {
        console.error('[Patch v3] owner_payments sync error:', err);
      }
    };

    console.log('[Patch v3] markPayoutAsPaid patched with owner_payments sync ✅');
  }

  /* Install real-time listener on owner_payments for current owner */
  let _earningsUnsubscribe = null;

  function _installEarningsRealtimeListener() {
    const cu = _cu();
    if (!cu) return;

    // Only for owners (not admins)
    const ownerDash = document.getElementById('owner-dashboard-page');
    if (!ownerDash) return;

    if (_earningsUnsubscribe) {
      _earningsUnsubscribe();
      _earningsUnsubscribe = null;
    }

    _earningsUnsubscribe = _db()
      .collection('owner_payments')
      .where('ownerId', '==', cu.uid)
      .orderBy('createdAt', 'desc')
      .onSnapshot((snap) => {
        // If the earnings tab is currently visible, refresh it
        const earningsContainer = document.querySelector('[data-tab="earnings"] .tab-content-inner, #earnings-tab-content, .earnings-content');
        const activeTab = document.querySelector('.owner-tab-btn.active, .tab-btn.active');
        const isEarningsActive = activeTab && (activeTab.textContent.toLowerCase().includes('earning') ||
          activeTab.dataset.tab === 'earnings');

        if (isEarningsActive && typeof window.loadOwnerEarnings === 'function') {
          // Debounce
          clearTimeout(window._earningsRefreshTimer);
          window._earningsRefreshTimer = setTimeout(() => {
            const c = document.querySelector('.owner-tab-content.active, #owner-tab-content');
            if (c) window.loadOwnerEarnings(c);
          }, 500);
        }
      }, (err) => {
        console.warn('[Patch v3] earnings listener error:', err.message);
      });

    console.log('[Patch v3] Real-time earnings listener installed ✅');
  }

  /* Enhanced loadOwnerEarnings that shows owner_payments correctly */
  function _patchLoadOwnerEarnings() {
    const _origEarnings = window.loadOwnerEarnings;

    window.loadOwnerEarnings = async function (container) {
      if (!container) return;
      const cu = _cu();
      if (!cu) return;

      container.innerHTML = `
        <div style="padding:24px 0;">
          ${_shimmerCards(3)}
        </div>`;

      try {
        // Fetch owner_payments (admin-synced payouts) + bookings in parallel
        const [paymentsSnap, bookingsSnap, ownerDoc] = await Promise.all([
          _db().collection('owner_payments')
            .where('ownerId', '==', cu.uid)
            .orderBy('createdAt', 'desc')
            .limit(50)
            .get(),
          _db().collection('bookings')
            .where('ownerId', '==', cu.uid)
            .where('bookingStatus', '==', 'confirmed')
            .orderBy('createdAt', 'desc')
            .limit(100)
            .get(),
          _db().collection('owners').doc(cu.uid).get()
        ]);

        const owner = ownerDoc.exists ? ownerDoc.data() : {};

        // Compute totals from bookings
        let totalBookingRevenue = 0;
        let pendingPayout = 0;
        let totalBookings = 0;

        bookingsSnap.forEach(doc => {
          const b = doc.data();
          const gross = Number(b.amount || 0);
          const commission = Math.round(gross * 0.10);
          const ownerAmt = b.ownerAmount || (gross - commission);
          totalBookingRevenue += ownerAmt;
          totalBookings++;
          if ((b.payoutStatus || 'pending') !== 'payout_done') {
            pendingPayout += ownerAmt;
          }
        });

        // Total paid out from owner_payments collection
        let totalPaidOut = 0;
        let completedPayments = [];
        paymentsSnap.forEach(doc => {
          const p = doc.data();
          if (p.status === 'completed' || p.status === 'paid') {
            totalPaidOut += Number(p.ownerAmount || p.amount || 0);
            completedPayments.push({ id: doc.id, ...p });
          }
        });

        container.innerHTML = `
          <div class="earnings-dashboard">
            <!-- Summary Cards -->
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px;">
              ${_earningCard('💰 Total Earned', _fmt(totalBookingRevenue), 'var(--success,#10b981)')}
              ${_earningCard('✅ Total Paid Out', _fmt(totalPaidOut), '#3b82f6')}
              ${_earningCard('⏳ Pending Payout', _fmt(pendingPayout), '#f59e0b')}
              ${_earningCard('📋 Total Bookings', totalBookings, 'var(--primary,#6366f1)')}
            </div>

            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
              <h4 style="font-size:15px;font-weight:700;">Payment History</h4>
              <span style="font-size:12px;color:var(--gray-500);">📡 Live updates</span>
            </div>

            ${completedPayments.length === 0
              ? `<div style="text-align:center;padding:32px;color:var(--gray-400);">
                   <i class="fas fa-wallet" style="font-size:32px;margin-bottom:8px;display:block;"></i>
                   No payments received yet
                 </div>`
              : completedPayments.map(p => `
                  <div style="background:var(--gray-50,#f9fafb);border-radius:12px;padding:16px;margin-bottom:10px;border-left:4px solid #10b981;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                      <div>
                        <div style="font-weight:700;font-size:16px;color:#10b981;">${_fmt(p.ownerAmount || p.amount)}</div>
                        <div style="font-size:12px;color:var(--gray-500);margin-top:2px;">
                          Gross: ${_fmt(p.amount)} − 10% platform fee = <strong>${_fmt(p.ownerAmount || p.amount)}</strong>
                        </div>
                        ${p.upiId ? `<div style="font-size:12px;color:var(--gray-500);">UPI: ${p.upiId}</div>` : ''}
                        <div style="font-size:12px;color:var(--gray-400);">
                          ${p.paidAt ? new Date(p.paidAt.toDate()).toLocaleString('en-IN') : 'Date not available'}
                        </div>
                      </div>
                      <span style="background:#d1fae5;color:#065f46;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600;">
                        ✅ COMPLETED
                      </span>
                    </div>
                  </div>
                `).join('')
            }
          </div>`;

      } catch (err) {
        console.error('[Patch v3] loadOwnerEarnings error:', err);
        if (typeof _origEarnings === 'function') {
          return _origEarnings(container);
        }
        container.innerHTML = '<p style="text-align:center;color:red;">Failed to load earnings. Please refresh.</p>';
      }
    };

    console.log('[Patch v3] loadOwnerEarnings patched ✅');
  }

  function _earningCard(label, value, color) {
    return `
      <div style="background:var(--gray-50,#f9fafb);border-radius:12px;padding:16px;text-align:center;border-top:3px solid ${color};">
        <div style="font-size:20px;font-weight:800;color:${color};">${value}</div>
        <div style="font-size:12px;color:var(--gray-500);margin-top:4px;">${label}</div>
      </div>`;
  }


  /* ══════════════════════════════════════════════════════════════
   * 3. ADMIN OWNERS SECTION — Pending payment owners float to TOP
   * ══════════════════════════════════════════════════════════════ */
  function _patchLoadAdminOwners() {
    const _orig = window.loadAdminOwners;

    window.loadAdminOwners = async function (container) {
      if (!container) return;
      container.innerHTML = `<div style="padding:24px 0;">${_shimmerCards(4)}</div>`;

      try {
        const [ownersSnap, payoutsSnap] = await Promise.all([
          _db().collection('owners').orderBy('createdAt', 'desc').get(),
          _db().collection('payout_requests').where('status', '==', 'pending').get()
        ]);

        // Build set of ownerIds with pending payouts
        const pendingOwnerIds = new Set();
        const pendingAmounts  = {};
        payoutsSnap.forEach(doc => {
          const d = doc.data();
          pendingOwnerIds.add(d.ownerId);
          pendingAmounts[d.ownerId] = (pendingAmounts[d.ownerId] || 0) + Number(d.amount || 0);
        });

        let owners = [];
        ownersSnap.forEach(doc => owners.push({ _id: doc.id, ...doc.data() }));

        // Sort: pending payment owners first, then by createdAt desc
        owners.sort((a, b) => {
          const aPending = pendingOwnerIds.has(a._id) ? 1 : 0;
          const bPending = pendingOwnerIds.has(b._id) ? 1 : 0;
          return bPending - aPending;
        });

        const pendingSection = owners.filter(o => pendingOwnerIds.has(o._id));
        const otherSection   = owners.filter(o => !pendingOwnerIds.has(o._id));

        let html = `
          <div style="margin-bottom:16px;">
            <input type="text" id="admin-owner-search" class="modal-input" placeholder="🔍 Search by name, email, venue...">
          </div>`;

        if (pendingSection.length > 0) {
          html += `
            <div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:12px;padding:14px 16px;margin-bottom:16px;">
              <h4 style="color:#b45309;margin:0 0 4px;font-size:14px;">
                ⚠️ ${pendingSection.length} owner${pendingSection.length > 1 ? 's' : ''} with pending payment
              </h4>
              <p style="color:#92400e;font-size:12px;margin:0;">These owners have approved payout requests awaiting transfer.</p>
            </div>`;
        }

        html += `<div id="admin-owners-list-container">`;

        [...pendingSection, ...otherSection].forEach(owner => {
          const hasPending = pendingOwnerIds.has(owner._id);
          const pendingAmt = pendingAmounts[owner._id] || 0;
          const verifiedBadge = owner.isVerified
            ? '<span style="background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:20px;font-size:11px;">✅ Verified</span>'
            : '<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:20px;font-size:11px;">⚠ Unverified</span>';

          html += `
            <div class="ground-management-card owner-card-item"
                 data-owner-id="${owner.ownerUniqueId || ''}"
                 data-owner-name="${owner.ownerName || ''}"
                 data-email="${owner.email || ''}"
                 data-venue-name="${owner.venueName || ''}"
                 style="border:1px solid ${hasPending ? '#fbbf24' : 'var(--gray-200,#e5e7eb)'};
                        border-radius:12px;padding:16px;margin-bottom:12px;
                        background:${hasPending ? '#fffbeb' : 'var(--gray-50,#f9fafb)'};">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
                <div>
                  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <strong style="font-size:15px;">${owner.ownerName || 'Owner'}</strong>
                    ${verifiedBadge}
                    ${hasPending ? `<span style="background:#fef3c7;color:#b45309;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;">💰 PAYOUT PENDING: ${_fmt(pendingAmt)}</span>` : ''}
                  </div>
                  <div style="font-size:13px;color:var(--gray-600);margin-top:6px;line-height:1.6;">
                    <span>📧 ${owner.email || 'N/A'}</span> &nbsp;
                    <span>📱 ${owner.phone || 'N/A'}</span><br>
                    <span>🏟 ${owner.venueName || 'No venue'}</span> &nbsp;
                    <span>🏙 ${owner.city || 'N/A'}</span><br>
                    <span>💼 ${owner.ownerType === 'plot_owner' ? 'Plot Owner' : 'Venue Owner'}</span> &nbsp;
                    <span>📅 Joined: ${owner.createdAt ? new Date(owner.createdAt.toDate()).toLocaleDateString('en-IN') : 'N/A'}</span>
                  </div>
                </div>
                <div style="text-align:right;">
                  <div style="font-size:20px;font-weight:800;color:var(--primary,#6366f1);">${_fmt(owner.totalEarnings || 0)}</div>
                  <div style="font-size:11px;color:var(--gray-400);">Total Earnings</div>
                  <div style="font-size:13px;color:var(--gray-600);margin-top:4px;">${owner.totalBookings || 0} bookings</div>
                </div>
              </div>
              <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
                ${hasPending
                  ? `<button class="approve-btn" onclick="loadAdminDashboard('payouts')" style="font-size:13px;">💸 Process Payout</button>`
                  : ''}
                <button class="view-details-btn" data-owner-id="${owner._id}" style="font-size:13px;">View Details</button>
                ${owner.status === 'active'
                  ? `<button class="close-day-btn" data-owner-id="${owner._id}" style="font-size:13px;">Block</button>`
                  : `<button class="manage-slots-btn" data-owner-id="${owner._id}" style="font-size:13px;">Unblock</button>`}
              </div>
            </div>`;
        });

        html += '</div>';
        container.innerHTML = html;

        // Search
        document.getElementById('admin-owner-search')?.addEventListener('input', function () {
          const q = this.value.toLowerCase();
          document.querySelectorAll('.owner-card-item').forEach(card => {
            const text = [
              card.dataset.ownerId, card.dataset.ownerName,
              card.dataset.email, card.dataset.venueName
            ].join(' ').toLowerCase();
            card.style.display = text.includes(q) ? '' : 'none';
          });
        });

        // Buttons
        document.querySelectorAll('.view-details-btn[data-owner-id]').forEach(btn => {
          btn.addEventListener('click', () => {
            if (typeof window.viewOwnerDetails === 'function') window.viewOwnerDetails(btn.dataset.ownerId);
          });
        });
        document.querySelectorAll('.close-day-btn[data-owner-id]').forEach(btn => {
          btn.addEventListener('click', () => {
            if (typeof window.blockOwner === 'function') window.blockOwner(btn.dataset.ownerId);
          });
        });
        document.querySelectorAll('.manage-slots-btn[data-owner-id]').forEach(btn => {
          btn.addEventListener('click', () => {
            if (typeof window.unblockOwner === 'function') window.unblockOwner(btn.dataset.ownerId);
          });
        });

      } catch (err) {
        console.error('[Patch v3] loadAdminOwners error:', err);
        container.innerHTML = '<p style="text-align:center;color:red;">Failed to load owners</p>';
      }
    };

    console.log('[Patch v3] loadAdminOwners patched (pending sort + payout badge) ✅');
  }


  /* ══════════════════════════════════════════════════════════════
   * 4. ADMIN APPROVED VERIFICATIONS SECTION (always-visible panel)
   * ══════════════════════════════════════════════════════════════ */
  function _patchLoadAdminVerification() {
    const _orig = window.loadAdminVerification;

    window.loadAdminVerification = async function (container) {
      if (!container) return;
      container.innerHTML = `<div style="padding:24px 0;">${_shimmerCards(3)}</div>`;

      try {
        const [pendingSnap, approvedSnap] = await Promise.all([
          _db().collection('verification_requests')
            .where('status', '==', 'pending')
            .orderBy('submittedAt', 'desc')
            .get(),
          _db().collection('verification_requests')
            .where('status', '==', 'approved')
            .orderBy('submittedAt', 'desc')
            .limit(50)
            .get()
        ]);

        let html = `
          <!-- TAB SWITCHER -->
          <div style="display:flex;gap:8px;margin-bottom:20px;border-bottom:1px solid var(--gray-200,#e5e7eb);padding-bottom:12px;">
            <button id="verif-tab-pending"
              onclick="window._bmgShowVerifTab('pending')"
              style="padding:8px 18px;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;
                     background:var(--primary,#6366f1);color:#fff;border:none;">
              ⏳ Pending (${pendingSnap.size})
            </button>
            <button id="verif-tab-approved"
              onclick="window._bmgShowVerifTab('approved')"
              style="padding:8px 18px;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;
                     background:var(--gray-100,#f3f4f6);color:var(--gray-700,#374151);border:none;">
              ✅ Approved (${approvedSnap.size})
            </button>
          </div>

          <!-- PENDING PANEL -->
          <div id="verif-panel-pending">`;

        if (pendingSnap.empty) {
          html += `<div style="text-align:center;padding:40px;color:var(--gray-400);">
            <i class="fas fa-check-circle" style="font-size:36px;color:#10b981;display:block;margin-bottom:8px;"></i>
            All verification requests have been processed!
          </div>`;
        } else {
          pendingSnap.forEach(doc => {
            const r = doc.data();
            html += _verifCard(doc.id, r, true);
          });
        }

        html += `</div>
          <!-- APPROVED PANEL (hidden by default) -->
          <div id="verif-panel-approved" style="display:none;">`;

        if (approvedSnap.empty) {
          html += `<div style="text-align:center;padding:40px;color:var(--gray-400);">No approved verifications yet.</div>`;
        } else {
          approvedSnap.forEach(doc => {
            const r = doc.data();
            html += _verifCard(doc.id, r, false);
          });
        }

        html += `</div>`;
        container.innerHTML = html;

        // Expose tab switcher
        window._bmgShowVerifTab = function (tab) {
          document.getElementById('verif-panel-pending').style.display  = tab === 'pending'  ? '' : 'none';
          document.getElementById('verif-panel-approved').style.display = tab === 'approved' ? '' : 'none';

          const btnP = document.getElementById('verif-tab-pending');
          const btnA = document.getElementById('verif-tab-approved');
          if (btnP && btnA) {
            btnP.style.background = tab === 'pending'  ? 'var(--primary,#6366f1)' : 'var(--gray-100,#f3f4f6)';
            btnP.style.color      = tab === 'pending'  ? '#fff' : 'var(--gray-700,#374151)';
            btnA.style.background = tab === 'approved' ? '#10b981' : 'var(--gray-100,#f3f4f6)';
            btnA.style.color      = tab === 'approved' ? '#fff' : 'var(--gray-700,#374151)';
          }
        };

      } catch (err) {
        console.error('[Patch v3] loadAdminVerification error:', err);
        container.innerHTML = '<p style="text-align:center;color:red;">Failed to load verifications</p>';
      }
    };

    console.log('[Patch v3] loadAdminVerification patched (approved panel added) ✅');
  }

  function _verifCard(docId, r, showActions) {
    const date = r.submittedAt
      ? new Date(r.submittedAt.toDate()).toLocaleString('en-IN')
      : (r.approvedAt ? new Date(r.approvedAt.toDate()).toLocaleString('en-IN') : 'N/A');

    return `
      <div style="background:var(--gray-50,#f9fafb);border-radius:12px;padding:16px;margin-bottom:12px;
                  border-left:4px solid ${showActions ? '#f59e0b' : '#10b981'};">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
          <div>
            <strong style="font-size:15px;">${r.ownerName || 'Owner'}</strong>
            <span style="margin-left:8px;background:${showActions ? '#fef3c7' : '#d1fae5'};
              color:${showActions ? '#b45309' : '#065f46'};padding:2px 8px;border-radius:20px;font-size:11px;">
              ${showActions ? '⏳ Pending' : '✅ Approved'}
            </span>
            <div style="font-size:13px;color:var(--gray-600);margin-top:6px;line-height:1.7;">
              📧 ${r.email || 'N/A'}<br>
              🏟 ${r.venueName || 'N/A'} &nbsp; 🏙 ${r.city || 'N/A'}<br>
              📄 ${r.businessType || r.documentType || 'N/A'}<br>
              📅 ${showActions ? 'Submitted' : 'Approved'}: ${date}
              ${!showActions && r.approvedByName ? `<br>👤 Approved by: ${r.approvedByName}` : ''}
              ${r.registrationNumber ? `<br>🔢 Reg: ${r.registrationNumber}` : ''}
            </div>
          </div>
          ${r.documentUrl ? `
            <a href="${r.documentUrl}" target="_blank"
               style="font-size:12px;color:var(--primary,#6366f1);text-decoration:underline;">
              📎 View Doc
            </a>` : ''}
        </div>
        ${showActions ? `
          <div style="display:flex;gap:8px;margin-top:12px;">
            <button class="approve-btn" onclick="approveVerification('${docId}')" style="font-size:13px;">✅ Approve</button>
            <button class="reject-btn" onclick="rejectVerification('${docId}')" style="font-size:13px;">❌ Reject</button>
          </div>` : ''}
      </div>`;
  }


  /* ══════════════════════════════════════════════════════════════
   * 5. HOME PAGE — NEARBY GROUNDS smooth professional UI
   *    + real geolocation distance sort + shimmer skeleton
   * ══════════════════════════════════════════════════════════════ */
  function _patchLoadNearbyVenues() {
    // Inject shimmer CSS once
    if (!document.getElementById('bmg-nearby-css')) {
      const style = document.createElement('style');
      style.id = 'bmg-nearby-css';
      style.textContent = `
        .bmg-nearby-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
          gap: 16px;
        }
        .bmg-venue-card {
          background: #fff;
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 2px 12px rgba(0,0,0,0.08);
          cursor: pointer;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
          position: relative;
        }
        .bmg-venue-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 8px 24px rgba(0,0,0,0.14);
        }
        .bmg-venue-img {
          width: 100%;
          height: 150px;
          object-fit: cover;
          background: linear-gradient(135deg, #e0e7ff 0%, #f0fdf4 100%);
        }
        .bmg-venue-img-placeholder {
          width: 100%;
          height: 150px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #e0e7ff 0%, #f0fdf4 100%);
          font-size: 36px;
        }
        .bmg-venue-body { padding: 14px; }
        .bmg-venue-name { font-size: 15px; font-weight: 700; margin: 0 0 4px; color: #111827; }
        .bmg-venue-meta { font-size: 12px; color: #6b7280; margin-bottom: 8px; }
        .bmg-venue-badges { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
        .bmg-badge {
          padding: 3px 10px;
          border-radius: 20px;
          font-size: 11px;
          font-weight: 600;
        }
        .bmg-badge-sport { background: #ede9fe; color: #5b21b6; }
        .bmg-badge-dist  { background: #d1fae5; color: #065f46; }
        .bmg-badge-price { background: #fef3c7; color: #92400e; }
        .bmg-badge-verified { background: #dbeafe; color: #1e40af; }
        .bmg-venue-book-btn {
          display: block;
          width: 100%;
          padding: 10px;
          border: none;
          border-radius: 10px;
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          color: #fff;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          text-align: center;
          transition: opacity 0.2s;
        }
        .bmg-venue-book-btn:hover { opacity: 0.88; }
        .bmg-shimmer {
          background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
          background-size: 200% 100%;
          animation: bmg-shimmer 1.4s infinite;
          border-radius: 12px;
          height: 220px;
        }
        @keyframes bmg-shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
        .bmg-distance-banner {
          background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
          color: #fff;
          padding: 10px 16px;
          border-radius: 10px;
          font-size: 13px;
          margin-bottom: 14px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
      `;
      document.head.appendChild(style);
    }

    window.loadNearbyVenues = async function () {
      const container = document.getElementById('nearby-venues');
      if (!container) return;

      // Show shimmer skeleton
      container.innerHTML = `
        <div class="bmg-nearby-grid">
          ${[1,2,3,4].map(() => `<div class="bmg-shimmer"></div>`).join('')}
        </div>`;

      try {
        // Get user location first (non-blocking, 3s timeout)
        let userLat = null, userLng = null;
        try {
          const pos = await Promise.race([
            new Promise((res, rej) =>
              navigator.geolocation.getCurrentPosition(res, rej, { timeout: 3000 })
            ),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))
          ]);
          userLat = pos.coords.latitude;
          userLng = pos.coords.longitude;
        } catch (_) { /* location not available — sort by rating */ }

        // Parallel fetch: venues + grounds
        const [venuesSnap, groundsSnap] = await Promise.all([
          _db().collection('venues').where('hidden', '==', false).limit(20).get(),
          _db().collection('grounds').where('status', '==', 'active').limit(20).get()
        ]);

        let items = [];
        venuesSnap.forEach(doc => items.push({ _id: doc.id, _type: 'venue', ...doc.data() }));
        groundsSnap.forEach(doc => items.push({ _id: doc.id, _type: 'ground', ...doc.data() }));

        // Compute distance
        items = items.map(item => {
          if (userLat && item.location?.latitude) {
            item._dist = _haversine(userLat, userLng, item.location.latitude, item.location.longitude);
          } else {
            item._dist = null;
          }
          return item;
        });

        // Sort: by distance if available, else by rating desc
        items.sort((a, b) => {
          if (a._dist !== null && b._dist !== null) return a._dist - b._dist;
          if (a._dist !== null) return -1;
          if (b._dist !== null) return 1;
          return (b.rating || 0) - (a.rating || 0);
        });

        const show = items.slice(0, 8);

        if (show.length === 0) {
          container.innerHTML = `
            <div style="text-align:center;padding:40px;color:var(--gray-400);">
              <i class="fas fa-map-marker-alt" style="font-size:32px;display:block;margin-bottom:8px;"></i>
              No venues found near you
            </div>`;
          return;
        }

        const distBanner = userLat
          ? `<div class="bmg-distance-banner"><i class="fas fa-location-arrow"></i> Showing grounds near your location</div>`
          : '';

        container.innerHTML = distBanner + `<div class="bmg-nearby-grid">${show.map(item => _nearbyCard(item)).join('')}</div>`;

        // Wire click handlers
        container.querySelectorAll('.bmg-venue-card[data-id]').forEach(card => {
          card.addEventListener('click', () => {
            const id = card.dataset.id;
            const type = card.dataset.type;
            if (type === 'venue' && typeof window.viewVenueDetails === 'function') {
              window.viewVenueDetails(id);
            } else if (type === 'ground' && typeof window.viewGroundDetails === 'function') {
              window.viewGroundDetails(id);
            } else if (typeof window.showGroundDetails === 'function') {
              window.showGroundDetails(id);
            }
          });
        });

      } catch (err) {
        console.error('[Patch v3] loadNearbyVenues error:', err);
        container.innerHTML = `
          <div style="text-align:center;padding:32px;color:var(--gray-400);">
            <i class="fas fa-exclamation-circle"></i> Failed to load nearby grounds
          </div>`;
      }
    };

    console.log('[Patch v3] loadNearbyVenues patched (smooth + geo sort) ✅');
  }

  function _nearbyCard(item) {
    const name    = item.venueName || item.groundName || 'Ground';
    const sport   = item.sportType || item.sport || 'Multi-sport';
    const price   = item.pricePerHour || item.price || 0;
    const rating  = Number(item.rating || 0).toFixed(1);
    const dist    = item._dist !== null ? item._dist.toFixed(1) + ' km' : null;
    const img     = (item.images && item.images[0]) || item.imageUrl || null;
    const verified = item.isVerified;
    const city    = item.city || item.address || '';

    return `
      <div class="bmg-venue-card" data-id="${item._id}" data-type="${item._type}">
        ${img
          ? `<img class="bmg-venue-img" src="${img}" alt="${name}" onerror="this.parentNode.innerHTML='<div class=&quot;bmg-venue-img-placeholder&quot;>🏟</div>'${img}">`
          : `<div class="bmg-venue-img-placeholder">🏟</div>`}
        <div class="bmg-venue-body">
          <h3 class="bmg-venue-name">${name}</h3>
          <p class="bmg-venue-meta">${city}${rating > 0 ? ` · ⭐ ${rating}` : ''}</p>
          <div class="bmg-venue-badges">
            <span class="bmg-badge bmg-badge-sport">⚽ ${sport}</span>
            ${dist ? `<span class="bmg-badge bmg-badge-dist">📍 ${dist}</span>` : ''}
            ${price ? `<span class="bmg-badge bmg-badge-price">₹${price}/hr</span>` : ''}
            ${verified ? `<span class="bmg-badge bmg-badge-verified">✅ Verified</span>` : ''}
          </div>
          <button class="bmg-venue-book-btn">View & Book</button>
        </div>
      </div>`;
  }

  function _haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }


  /* ══════════════════════════════════════════════════════════════
   * 6. BOOKING PAGE SPEED FIX
   *    Problem: selectSlot() awaits promptForMobileNumber() and
   *    owner type fetch sequentially before showing booking page.
   *    Fix: show the booking page immediately, run checks in background.
   * ══════════════════════════════════════════════════════════════ */
  function _patchSelectSlot() {
    const _orig = window.selectSlot;
    if (!_orig) return;

    window.selectSlot = async function (slot) {
      // Quick guard checks first (sync)
      if (!window.currentUser) {
        if (typeof window.showToast === 'function') window.showToast('Please login to book', 'warning');
        if (typeof window.showPage === 'function') window.showPage('login-page');
        return;
      }
      if (!window.currentGround) {
        return _orig(slot); // Fall back to original for recovery logic
      }
      if (!window.selectedDate) {
        window.showToast?.('Please select a date first', 'warning');
        return;
      }

      // Time validation (sync)
      const today = new Date().toISOString().split('T')[0];
      if (window.selectedDate === today) {
        const now = new Date();
        const cur = now.getHours() * 60 + now.getMinutes();
        const [startHour, startMin] = slot.split('-')[0].split(':').map(Number);
        if ((startHour * 60 + (startMin || 0)) <= cur) {
          window.showToast?.('This time slot has already passed', 'error');
          return;
        }
      }

      // START PARALLEL FETCHES immediately — don't await sequentially
      const ground = window.currentGround;
      const user   = window.currentUser;

      const [availResult, ownerResult, venueResult] = await Promise.allSettled([
        // Availability check
        typeof window.checkSlotAvailability === 'function'
          ? window.checkSlotAvailability(ground.id, window.selectedDate, slot.split('-')[0], slot.split('-')[1])
          : Promise.resolve(true),
        // Owner type fetch
        _db().collection('owners').doc(ground.ownerId).get(),
        // Venue fetch (only if not cached)
        window.currentVenue
          ? Promise.resolve(null)
          : _db().collection('venues').where('ownerId', '==', ground.ownerId).limit(1).get()
      ]);

      // Check availability
      if (availResult.status === 'fulfilled' && availResult.value === false) {
        window.showToast?.('This slot is no longer available', 'error');
        if (typeof window.loadSlots === 'function') window.loadSlots(ground.id, window.selectedDate);
        return;
      }

      // Owner type
      let isPlotOwner = false;
      if (ownerResult.status === 'fulfilled' && ownerResult.value.exists) {
        isPlotOwner = ownerResult.value.data().ownerType === 'plot_owner';
      }

      // Venue
      if (venueResult.status === 'fulfilled' && venueResult.value && !venueResult.value.empty) {
        window.currentVenue = { id: venueResult.value.docs[0].id, ...venueResult.value.docs[0].data() };
      }

      // Compute amount
      const PLOT_FIXED = window.PLOT_OWNER_FIXED_PRICE || 299;
      const amount = isPlotOwner ? PLOT_FIXED : (ground.pricePerHour || 0);

      // Get phone without modal prompt if possible
      let userPhone = user.phone || user.userPhone || '';

      // Build booking details
      const bookingDetails = {
        groundId      : ground.id,
        groundName    : ground.groundName || ground.name || '',
        venueName     : window.currentVenue?.venueName || '',
        venueAddress  : window.currentVenue?.address || '',
        groundAddress : ground.groundAddress || ground.address || '',
        sportType     : ground.sportType || '',
        ownerId       : ground.ownerId || '',
        isPlotOwner   : isPlotOwner,
        date          : window.selectedDate,
        slotTime      : slot,
        amount        : amount,
        originalAmount: amount,
        userName      : user.name || user.displayName || '',
        userEmail     : user.email || '',
        userPhone     : userPhone,
        ownerAmount   : Math.round(amount * 0.90),
        promoCode     : '',
        appliedOffer  : '',
      };

      // Store session
      sessionStorage.setItem('selectedSlot', slot);
      sessionStorage.setItem('selectedDate', window.selectedDate);
      sessionStorage.setItem('currentGround', JSON.stringify(ground));
      sessionStorage.setItem('currentGroundId', ground.id);
      sessionStorage.setItem('isPlotOwnerGround', isPlotOwner ? 'true' : 'false');

      window.selectedSlot = slot;

      // Show booking page immediately
      if (typeof window.showBookingPage === 'function') {
        window.showBookingPage(bookingDetails);
      }

      // If phone missing, prompt AFTER page is shown (non-blocking)
      if (!userPhone || userPhone.length < 10) {
        setTimeout(async () => {
          if (typeof window.promptForMobileNumber === 'function') {
            const phone = await window.promptForMobileNumber();
            if (phone) {
              user.phone = phone;
              bookingDetails.userPhone = phone;
              // Re-wire pay button with updated details
              if (typeof window.setupPayButton === 'function') {
                window.setupPayButton(bookingDetails);
              }
            }
          }
        }, 200);
      }
    };

    console.log('[Patch v3] selectSlot patched (parallel fetch, fast booking page) ✅');
  }


  /* ══════════════════════════════════════════════════════════════
   * 7. REMOVE 404 SCRIPT TAGS for bmg_earnings_fix_v2.js
   * ══════════════════════════════════════════════════════════════ */
  function _remove404Scripts() {
    const BAD = ['bmg_earnings_fix_v2.js'];
    document.querySelectorAll('script[src]').forEach(s => {
      if (BAD.some(b => s.src.includes(b))) {
        s.remove();
        console.log('[Patch v3] Removed 404 script tag:', s.src);
      }
    });
  }


  /* ══════════════════════════════════════════════════════════════
   * SHIMMER HELPER
   * ══════════════════════════════════════════════════════════════ */
  function _shimmerCards(n) {
    if (!document.getElementById('bmg-shimmer-css')) {
      const s = document.createElement('style');
      s.id = 'bmg-shimmer-css';
      s.textContent = `
        .bmg-shimmer-card {
          height: 80px;
          border-radius: 12px;
          background: linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%);
          background-size: 200% 100%;
          animation: bmg-shimmer-anim 1.4s infinite;
          margin-bottom: 10px;
        }
        @keyframes bmg-shimmer-anim {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
      `;
      document.head.appendChild(s);
    }
    return Array(n).fill('<div class="bmg-shimmer-card"></div>').join('');
  }


  /* ══════════════════════════════════════════════════════════════
   * BOOT — wait for Firebase + currentUser to be ready
   * ══════════════════════════════════════════════════════════════ */
  function _boot() {
    _remove404Scripts();
    _patchCleanupExpiredLocks();
    _patchMarkPayoutAsPaid();
    _patchLoadOwnerEarnings();
    _patchLoadAdminOwners();
    _patchLoadAdminVerification();
    _patchLoadNearbyVenues();

    // Patch selectSlot after all scripts have loaded
    setTimeout(_patchSelectSlot, 500);

    // Install earnings real-time listener once user is signed in
    if (window.auth) {
      window.auth.onAuthStateChanged((user) => {
        if (user) {
          setTimeout(_installEarningsRealtimeListener, 1000);
        } else {
          if (_earningsUnsubscribe) {
            _earningsUnsubscribe();
            _earningsUnsubscribe = null;
          }
        }
      });
    }

    console.log('✅ [bmg_master_patch_v3.js] All patches applied');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _boot);
  } else {
    // Scripts already loaded — run immediately but give app.js a tick
    setTimeout(_boot, 100);
  }

})();