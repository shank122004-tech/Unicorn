/**
 * bmg_earnings_fix_v2.js
 * ─────────────────────────────────────────────────────────────────────────────
 * FIXES:
 *  1. loadAdminOwnerEarnings — was NEVER defined anywhere. Defined here.
 *     Shows every owner's real booking data, 10% platform commission per
 *     booking, total earned, total transferred, and amount still owed.
 *
 *  2. loadPayoutsList (CEO) — re-patches to read real booking data and
 *     correctly compute platform revenue (10% of each booking amount).
 *
 *  3. _bmgMarkPaymentSent — records transfer AND marks linked bookings
 *     payoutStatus = 'payout_done' so "still owed" drops to 0 correctly.
 *
 *  4. patchLoadAdminDashboard — ensures 'owner-earnings' tab routes here.
 *
 * LOAD ORDER — add LAST in index.html, after all other bmg_* scripts:
 *   <script src="bmg_earnings_fix_v2.js"></script>
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  /* ── tiny helpers ─────────────────────────────────────────────────────── */
  const _fmt = v =>
    typeof window.formatCurrency === 'function'
      ? window.formatCurrency(v)
      : '₹' + Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const _esc = s =>
    String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const _loading = msg =>
    typeof window.showLoading === 'function' ? window.showLoading(msg) : null;

  const _hideLoading = () =>
    typeof window.hideLoading === 'function' ? window.hideLoading() : null;

  const _toast = (msg, type) =>
    typeof window.showToast === 'function' ? window.showToast(msg, type) : console.log(type, msg);

  const db   = () => window.db;
  const COLS = () => window.COLLECTIONS || {};
  const BS   = () => window.BOOKING_STATUS || {};

  /* ═══════════════════════════════════════════════════════════════════════
   * 1.  loadAdminOwnerEarnings
   *     Called by admin "Owner Earnings" tab.
   *     Shows real booking data grouped by owner with 10% commission.
   * ═══════════════════════════════════════════════════════════════════════*/
  window.loadAdminOwnerEarnings = async function (container) {
    if (!container) {
      container = document.getElementById('admin-dashboard-content');
    }
    if (!container) return;

    container.innerHTML = '<div class="loading-spinner"><div class="loader-spinner"></div></div>';
    _loading('Loading owner earnings…');

    try {
      /* ── 1a. Fetch ALL confirmed bookings ──────────────────────────── */
      const bookingsSnap = await db()
        .collection(COLS().BOOKINGS || 'bookings')
        .where('bookingStatus', '==', BS().CONFIRMED || 'confirmed')
        .orderBy('createdAt', 'desc')
        .get();

      /* ── 1b. Fetch all owners (for names / UPI IDs) ───────────────── */
      const ownersSnap = await db()
        .collection(COLS().OWNERS || 'owners')
        .get();

      const ownerInfo = {};
      ownersSnap.forEach(doc => {
        const o = doc.data();
        ownerInfo[doc.id] = {
          name : o.ownerName || o.name  || doc.id,
          phone: o.phone     || '',
          email: o.email     || '',
          upi  : o.upiId     || o.upi   || '',
        };
      });

      /* ── 1c. Group bookings by owner ─────────────────────────────── */
      const ownerMap = {};   // ownerId → { info, bookings[], totalAmount, totalOwnerEarning, platformCommission }

      let grandTotalAmount     = 0;
      let grandTotalCommission = 0;   // 10% platform share
      let grandTotalOwner      = 0;   // 90% owner share

      bookingsSnap.forEach(doc => {
        const b   = doc.data();
        const oid = b.ownerId;
        if (!oid) return;

        // Derive ownerAmount / commission defensively
        const amount     = Number(b.amount     || 0);
        const commission = Number(b.commission || (amount * 0.10) || 0);
        const ownerAmt   = Number(b.ownerAmount || (amount - commission) || 0);

        grandTotalAmount     += amount;
        grandTotalCommission += commission;
        grandTotalOwner      += ownerAmt;

        if (!ownerMap[oid]) {
          ownerMap[oid] = {
            info            : ownerInfo[oid] || { name: b.ownerName || oid, phone: '', email: '', upi: '' },
            bookings        : [],
            totalAmount     : 0,
            totalOwnerAmt   : 0,
            totalCommission : 0,
          };
        }

        ownerMap[oid].totalAmount     += amount;
        ownerMap[oid].totalOwnerAmt   += ownerAmt;
        ownerMap[oid].totalCommission += commission;
        ownerMap[oid].bookings.push({ ...b, _docId: doc.id, amount, commission, ownerAmt });
      });

      /* ── 1d. Fetch already-sent amounts per owner ─────────────────── */
      const sentMap = {};
      await Promise.all(
        Object.keys(ownerMap).map(async oid => {
          try {
            const ts = await db().collection('owner_transfers')
              .where('ownerId', '==', oid)
              .get();
            sentMap[oid] = ts.docs.reduce((s, d) => s + (d.data().amount || 0), 0);
          } catch (_) {
            sentMap[oid] = 0;
          }
        })
      );

      /* ── 1e. Render ───────────────────────────────────────────────── */
      const ownerCount = Object.keys(ownerMap).length;

      let html = `
        <!-- PLATFORM SUMMARY -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px;">
          <div class="stat-card">
            <div class="stat-value">${_fmt(grandTotalAmount)}</div>
            <div class="stat-label">Total Booking Revenue</div>
          </div>
          <div class="stat-card" style="border-top:3px solid #6366f1;">
            <div class="stat-value" style="color:#6366f1;">${_fmt(grandTotalCommission)}</div>
            <div class="stat-label">Your 10% Commission</div>
          </div>
          <div class="stat-card" style="border-top:3px solid #10b981;">
            <div class="stat-value" style="color:#10b981;">${_fmt(grandTotalOwner)}</div>
            <div class="stat-label">Total Owner Payable</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${bookingsSnap.size}</div>
            <div class="stat-label">Confirmed Bookings</div>
          </div>
        </div>

        <div style="font-weight:700;font-size:16px;margin-bottom:16px;">
          <i class="fas fa-users" style="color:#6366f1;"></i>
          Owner Earnings &amp; Transfers
          <span style="font-weight:400;font-size:12px;color:#6b7280;margin-left:8px;">${ownerCount} owner(s)</span>
        </div>`;

      if (ownerCount === 0) {
        html += '<div style="text-align:center;padding:40px;color:#9ca3af;">No confirmed bookings yet</div>';
      } else {
        Object.entries(ownerMap).forEach(([oid, data]) => {
          const sent    = sentMap[oid] || 0;
          const pending = Math.max(0, data.totalOwnerAmt - sent);

          html += `
            <div style="background:#f9fafb;border-radius:14px;padding:16px;margin-bottom:14px;border:1px solid #e5e7eb;">
              <!-- Header row -->
              <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
                <div>
                  <div style="font-weight:700;font-size:15px;">${_esc(data.info.name)}</div>
                  <div style="font-size:12px;color:#6b7280;">${_esc(data.info.phone)}${data.info.upi ? ' • UPI: ' + _esc(data.info.upi) : ''}</div>
                  <div style="font-size:12px;color:#6b7280;">${data.bookings.length} booking(s)</div>
                </div>
                <div style="text-align:right;">
                  <div style="font-size:11px;color:#6b7280;">Booking Total</div>
                  <div style="font-weight:700;font-size:20px;color:#111;">${_fmt(data.totalAmount)}</div>
                </div>
              </div>

              <!-- Breakdown grid -->
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:12px;">
                <div style="background:#fff;border-radius:8px;padding:10px;text-align:center;border:1px solid #f3f4f6;">
                  <div style="font-size:10px;color:#6b7280;margin-bottom:3px;">Booking Total</div>
                  <div style="font-weight:600;font-size:14px;">${_fmt(data.totalAmount)}</div>
                </div>
                <div style="background:#eff6ff;border-radius:8px;padding:10px;text-align:center;border:1px solid #dbeafe;">
                  <div style="font-size:10px;color:#3b82f6;margin-bottom:3px;">Platform 10%</div>
                  <div style="font-weight:600;font-size:14px;color:#2563eb;">${_fmt(data.totalCommission)}</div>
                </div>
                <div style="background:#f0fdf4;border-radius:8px;padding:10px;text-align:center;border:1px solid #bbf7d0;">
                  <div style="font-size:10px;color:#16a34a;margin-bottom:3px;">Owner Share 90%</div>
                  <div style="font-weight:600;font-size:14px;color:#15803d;">${_fmt(data.totalOwnerAmt)}</div>
                </div>
                <div style="background:${pending > 0 ? '#fffbeb' : '#f0fdf4'};border-radius:8px;padding:10px;text-align:center;border:1px solid ${pending > 0 ? '#fde68a' : '#bbf7d0'};">
                  <div style="font-size:10px;color:${pending > 0 ? '#d97706' : '#16a34a'};margin-bottom:3px;">Still Owed</div>
                  <div style="font-weight:700;font-size:14px;color:${pending > 0 ? '#b45309' : '#15803d'};">${_fmt(pending)}</div>
                </div>
              </div>

              <!-- Booking detail rows (collapsed, last 5) -->
              <details style="margin-bottom:10px;">
                <summary style="cursor:pointer;font-size:13px;color:#6366f1;font-weight:600;user-select:none;">
                  <i class="fas fa-list" style="margin-right:4px;"></i>View bookings (${data.bookings.length})
                </summary>
                <div style="margin-top:8px;max-height:260px;overflow-y:auto;">
                  ${data.bookings.map(b => `
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:13px;">
                      <div>
                        <div style="font-weight:600;">${_esc(b.groundName || 'Ground Booking')}</div>
                        <div style="color:#6b7280;font-size:11px;">${b.date || ''} • ${b.slotTime || ''} • ${b.sportType || ''}</div>
                        <div style="color:#9ca3af;font-size:10px;">ID: ${b.bookingId || b._docId || ''}</div>
                      </div>
                      <div style="text-align:right;">
                        <div style="color:#111;">${_fmt(b.amount)}</div>
                        <div style="color:#2563eb;font-size:11px;">Comm: ${_fmt(b.commission)}</div>
                        <div style="color:#15803d;font-size:11px;">Owner: ${_fmt(b.ownerAmt)}</div>
                      </div>
                    </div>`).join('')}
                </div>
              </details>

              <!-- Transfer action -->
              ${pending > 0
                ? `<button
                    onclick="window._bmgMarkPaymentSent('${oid}',${pending},'${_esc(data.info.name).replace(/'/g,"\\'")}','${_esc(data.info.upi)}')"
                    style="width:100%;padding:11px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;border:none;border-radius:10px;font-weight:600;cursor:pointer;font-size:14px;">
                    <i class="fas fa-paper-plane"></i> Mark ₹${Math.round(pending).toLocaleString('en-IN')} as Transferred to Owner
                  </button>`
                : `<div style="padding:8px;text-align:center;background:#d1fae5;border-radius:8px;font-size:12px;color:#065f46;">
                    <i class="fas fa-check-circle"></i> All earnings transferred
                  </div>`}
            </div>`;
        });
      }

      container.innerHTML = html;
      _hideLoading();

    } catch (err) {
      _hideLoading();
      console.error('[bmg_earnings_fix_v2] loadAdminOwnerEarnings error:', err);
      container.innerHTML = `<p style="text-align:center;color:#ef4444;padding:32px;">Failed to load: ${_esc(err.message)}</p>`;
    }
  };

  /* ═══════════════════════════════════════════════════════════════════════
   * 2.  loadPayoutsList (CEO Dashboard → Payouts tab)
   *     Re-patched to show real data with correct 10% commission display.
   * ═══════════════════════════════════════════════════════════════════════*/
  window.loadPayoutsList = async function (container) {
    if (!container) {
      container = document.getElementById('ceo-dashboard-content');
    }
    if (!container) return;

    container.innerHTML = '<div class="loading-spinner"><div class="loader-spinner"></div></div>';
    _loading('Loading owner transfers…');

    try {
      /* ── Fetch all confirmed bookings + all owners ─────────────────── */
      const [bookingsSnap, ownersSnap] = await Promise.all([
        db().collection(COLS().BOOKINGS || 'bookings')
          .where('bookingStatus', '==', BS().CONFIRMED || 'confirmed')
          .orderBy('createdAt', 'desc')
          .get(),
        db().collection(COLS().OWNERS || 'owners').get(),
      ]);

      /* ── Owner info map ───────────────────────────────────────────── */
      const ownerInfo = {};
      ownersSnap.forEach(doc => {
        const o = doc.data();
        ownerInfo[doc.id] = {
          name : o.ownerName || o.name  || doc.id,
          phone: o.phone     || '',
          email: o.email     || '',
          upi  : o.upiId     || o.upi   || '',
        };
      });

      /* ── Aggregate bookings per owner ────────────────────────────── */
      let platformRevenue = 0;
      const ownerMap = {};

      bookingsSnap.forEach(doc => {
        const b   = doc.data();
        const oid = b.ownerId;
        if (!oid) return;

        const amount     = Number(b.amount     || 0);
        const commission = Number(b.commission || (amount * 0.10));
        const ownerAmt   = Number(b.ownerAmount || (amount - commission));

        platformRevenue += commission;

        if (!ownerMap[oid]) {
          ownerMap[oid] = {
            info    : ownerInfo[oid] || { name: b.ownerName || oid, phone: '', email: '', upi: '' },
            total   : 0,
            bookings: [],
          };
        }
        ownerMap[oid].total += ownerAmt;
        ownerMap[oid].bookings.push(b);
      });

      /* ── Already-sent per owner ───────────────────────────────────── */
      const sentMap = {};
      await Promise.all(
        Object.keys(ownerMap).map(async oid => {
          try {
            const ts = await db().collection('owner_transfers')
              .where('ownerId', '==', oid)
              .get();
            sentMap[oid] = ts.docs.reduce((s, d) => s + (d.data().amount || 0), 0);
          } catch (_) {
            sentMap[oid] = 0;
          }
        })
      );

      /* ── Render ──────────────────────────────────────────────────── */
      const ownerRows = Object.entries(ownerMap).map(([oid, data]) => {
        const sent    = sentMap[oid] || 0;
        const pending = Math.max(0, data.total - sent);

        return `
          <div style="background:#f9fafb;border-radius:14px;padding:16px;margin-bottom:14px;border:1px solid #e5e7eb;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
              <div>
                <div style="font-weight:700;font-size:15px;">${_esc(data.info.name)}</div>
                <div style="font-size:12px;color:#6b7280;">${_esc(data.info.phone)}${data.info.upi ? ' • UPI: ' + _esc(data.info.upi) : ''}</div>
                <div style="font-size:12px;color:#6b7280;">${data.bookings.length} booking(s)</div>
              </div>
              <div style="text-align:right;">
                <div style="font-size:11px;color:#6b7280;">Owner Earnings (90%)</div>
                <div style="font-weight:700;font-size:20px;color:#10b981;">${_fmt(data.total)}</div>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px;">
              <div style="background:#fff;border-radius:8px;padding:10px;text-align:center;">
                <div style="font-size:11px;color:#6b7280;">Already Sent</div>
                <div style="font-weight:600;color:#6366f1;">${_fmt(sent)}</div>
              </div>
              <div style="background:${pending > 0 ? '#fffbeb' : '#f0fdf4'};border-radius:8px;padding:10px;text-align:center;">
                <div style="font-size:11px;color:${pending > 0 ? '#d97706' : '#16a34a'};">Still Owed</div>
                <div style="font-weight:700;color:${pending > 0 ? '#b45309' : '#15803d'};">${_fmt(pending)}</div>
              </div>
            </div>
            ${pending > 0
              ? `<button
                  onclick="window._bmgMarkPaymentSent('${oid}',${pending},'${_esc(data.info.name).replace(/'/g,"\\'")}','${_esc(data.info.upi)}')"
                  style="width:100%;margin-top:12px;padding:11px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;border:none;border-radius:10px;font-weight:600;cursor:pointer;font-size:14px;">
                  <i class="fas fa-paper-plane"></i> Mark ₹${Math.round(pending).toLocaleString('en-IN')} Payment as Sent
                </button>`
              : `<div style="margin-top:10px;padding:8px;text-align:center;background:#d1fae5;border-radius:8px;font-size:12px;color:#065f46;">
                  <i class="fas fa-check-circle"></i> All payments sent
                </div>`}
          </div>`;
      }).join('');

      container.innerHTML = `
        <!-- Platform revenue card -->
        <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:16px;padding:20px;margin-bottom:20px;color:#fff;">
          <div style="font-size:13px;opacity:.85;margin-bottom:4px;"><i class="fas fa-chart-line"></i> Platform Revenue — 10% Commission on Bookings</div>
          <div style="font-size:32px;font-weight:700;">${_fmt(platformRevenue)}</div>
          <div style="font-size:12px;opacity:.75;margin-top:4px;">From ${bookingsSnap.size} confirmed booking(s)</div>
        </div>

        <div style="font-weight:700;font-size:16px;margin-bottom:16px;">
          <i class="fas fa-users" style="color:#6366f1;"></i> Owner Earnings &amp; Transfers
          <span style="font-weight:400;font-size:12px;color:#6b7280;margin-left:8px;">${Object.keys(ownerMap).length} owner(s)</span>
        </div>

        ${Object.keys(ownerMap).length === 0
          ? '<div style="text-align:center;padding:32px;color:#9ca3af;">No confirmed bookings yet</div>'
          : ownerRows}`;

      _hideLoading();

    } catch (err) {
      _hideLoading();
      console.error('[bmg_earnings_fix_v2] loadPayoutsList error:', err);
      container.innerHTML = `<p style="color:#ef4444;text-align:center;padding:32px;">${_esc(err.message)}</p>`;
    }
  };

  /* ═══════════════════════════════════════════════════════════════════════
   * 3.  _bmgMarkPaymentSent
   *     Records transfer in owner_transfers AND marks all unpaid confirmed
   *     bookings for that owner as payout_done so "still owed" → 0.
   * ═══════════════════════════════════════════════════════════════════════*/
  window._bmgMarkPaymentSent = async function (ownerId, amount, ownerName, ownerUpi) {
    if (!confirm(
      `Mark ₹${Math.round(amount).toLocaleString('en-IN')} as transferred to ${ownerName}?\n\nThis records that you have manually sent this amount to the owner.`
    )) return;

    const note = prompt('Add a note (optional — e.g. UPI transaction ID):', '') || '';
    const cu   = window.currentUser;

    try {
      _loading('Recording transfer…');

      // ── A. Write owner_transfers record ──────────────────────────────
      await db().collection('owner_transfers').add({
        ownerId,
        ownerName,
        ownerUpi  : ownerUpi || '',
        amount    : Number(amount),
        note,
        sentBy    : cu ? cu.uid   : 'admin',
        sentByName: cu ? (cu.name || cu.email || 'Admin') : 'Admin',
        createdAt : firebase.firestore.FieldValue.serverTimestamp(),
        status    : 'sent',
      });

      // ── B. Mark all unresolved confirmed bookings for this owner
      //       as payout_done (batch write, up to 490 at a time) ─────────
      try {
        const unpaidSnap = await db()
          .collection(COLS().BOOKINGS || 'bookings')
          .where('ownerId',       '==', ownerId)
          .where('bookingStatus', '==', BS().CONFIRMED || 'confirmed')
          .get();

        const BATCH_LIMIT = 490;
        let batch       = db().batch();
        let batchCount  = 0;

        for (const doc of unpaidSnap.docs) {
          const d = doc.data();
          // Only mark if not already paid out
          if (d.payoutStatus === 'payout_done') continue;

          batch.update(doc.ref, {
            payoutStatus: 'payout_done',
            payoutPaidAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt   : firebase.firestore.FieldValue.serverTimestamp(),
          });
          batchCount++;

          if (batchCount >= BATCH_LIMIT) {
            await batch.commit();
            batch      = db().batch();
            batchCount = 0;
          }
        }

        if (batchCount > 0) await batch.commit();
      } catch (batchErr) {
        // Non-fatal: transfer was recorded, just couldn't update booking statuses
        console.warn('[bmg_earnings_fix_v2] Batch payout_done update failed:', batchErr);
      }

      _hideLoading();
      _toast(`✅ ₹${Math.round(amount).toLocaleString('en-IN')} marked as sent to ${ownerName}`, 'success');

      // ── C. Refresh whichever dashboard is active ────────────────────
      const adminPage = document.getElementById('admin-dashboard-page');
      const ceoPage   = document.getElementById('ceo-dashboard-page');

      if (adminPage && adminPage.classList.contains('active')) {
        const ctn = document.getElementById('admin-dashboard-content');
        if (ctn) await window.loadAdminOwnerEarnings(ctn);
      } else if (ceoPage && ceoPage.classList.contains('active')) {
        const ctn = document.getElementById('ceo-dashboard-content');
        if (ctn) await window.loadPayoutsList(ctn);
      }

    } catch (err) {
      _hideLoading();
      _toast('Error: ' + err.message, 'error');
      console.error('[bmg_earnings_fix_v2] _bmgMarkPaymentSent error:', err);
    }
  };

  /* ═══════════════════════════════════════════════════════════════════════
   * 4.  Patch loadAdminDashboard to route 'owner-earnings' tab correctly
   * ═══════════════════════════════════════════════════════════════════════*/
  function patchLoadAdminDashboard() {
    const orig = window.loadAdminDashboard;
    if (typeof orig !== 'function') return;
    if (orig.__bmgEarningsV2Patched) return;

    window.loadAdminDashboard = async function (tab) {
      if (tab === 'owner-earnings') {
        // Style active tab
        document.querySelectorAll('.admin-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        const btn = document.getElementById('admin-owner-earnings-tab');
        if (btn) btn.classList.add('active');

        const ctn = document.getElementById('admin-dashboard-content');
        if (ctn) {
          ctn.innerHTML = '<div class="loading-spinner"><div class="loader-spinner"></div></div>';
          await window.loadAdminOwnerEarnings(ctn);
        }
        return;
      }
      return orig.apply(this, arguments);
    };
    window.loadAdminDashboard.__bmgEarningsV2Patched = true;
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 5.  Inject the Owner Earnings tab button into admin dashboard if missing
   * ═══════════════════════════════════════════════════════════════════════*/
  function ensureAdminEarningsTab() {
    if (document.getElementById('admin-owner-earnings-tab')) return;

    const tabBar = document.querySelector('.admin-tabs');
    if (!tabBar) return;

    const btn       = document.createElement('button');
    btn.id          = 'admin-owner-earnings-tab';
    btn.className   = 'tab-btn';
    btn.innerHTML   = '<i class="fas fa-chart-bar" style="margin-right:5px;"></i>Owner Earnings';
    btn.style.whiteSpace = 'nowrap';

    // Insert before the Delete tab (keep destructive actions last)
    const deleteTab = document.getElementById('admin-delete-tab');
    if (deleteTab) {
      tabBar.insertBefore(btn, deleteTab);
    } else {
      tabBar.appendChild(btn);
    }

    btn.addEventListener('click', () => window.loadAdminDashboard('owner-earnings'));
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * 6.  Boot — run setup, re-run on admin page shown
   * ═══════════════════════════════════════════════════════════════════════*/
  function setup() {
    ensureAdminEarningsTab();
    patchLoadAdminDashboard();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(setup, 250));
  } else {
    setTimeout(setup, 250);
  }

  // Re-run whenever admin page becomes visible (handles SPA navigation)
  window.addEventListener('bmg:pageShown', e => {
    if (e.detail?.pageId === 'admin-dashboard-page') setTimeout(setup, 100);
  });

  // Also watch for admin tab bar being added dynamically
  const _obs = new MutationObserver(() => {
    if (document.querySelector('.admin-tabs') && !document.getElementById('admin-owner-earnings-tab')) {
      setup();
    }
  });
  _obs.observe(document.body, { childList: true, subtree: true });

  console.log('✅ [bmg_earnings_fix_v2.js] Loaded — Owner Earnings & Transfer fix active');

})();