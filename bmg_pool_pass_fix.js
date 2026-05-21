/**
 * bmg_pool_pass_fix.js  — v1
 * ═══════════════════════════════════════════════════════════════════
 *
 *  WHAT THIS FILE FIXES
 *  ────────────────────
 *  1. SLOT FILL COUNT NOT UPDATING IN UI
 *     After a booking, the slot card in the pool grid still shows
 *     the old "X/20 members" count instead of the incremented value.
 *     FIX: After bmg:paymentConfirmed fires for a pool booking, we
 *     immediately re-fetch the slot doc and rerender the pool slots
 *     grid so the live occupancy is correct.
 *
 *  2. ENTRY PASS — WATER PARK THEME + FULL USER DETAILS
 *     The existing pass is functional but generic.
 *     FIX: Completely replaces showPoolEntryPass with a beautiful
 *     water-park-themed design that shows every booking detail:
 *       • User name, phone, email
 *       • Pool name + address
 *       • Date (formatted), time slot
 *       • Member count + per-person price + total paid
 *       • Booking ID + payment status badge
 *       • Animated wave header, bubbles, full QR code
 *       • "Share / Download" UI hint
 *
 *  LOAD ORDER — LAST <script> in index.html, after all other scripts:
 *    <script src="bmg_pool_pass_fix.js"></script>
 * ═══════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  /* ─────────────────────────────────────────────────────────────────
   *  Utilities
   * ─────────────────────────────────────────────────────────────────*/
  function _esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function _waitFor(name, cb, n) {
    n = n || 0;
    if (typeof window[name] === 'function') return cb();
    if (n > 120) return;
    setTimeout(function () { _waitFor(name, cb, n + 1); }, 150);
  }

  /* ═══════════════════════════════════════════════════════════════
   *  FIX 1 — Refresh slot grid after pool booking is confirmed
   *  so the "X/20 members" count reflects the new booking instantly.
   * ═══════════════════════════════════════════════════════════════*/
  window.addEventListener('bmg:paymentConfirmed', function (e) {
    var pending = null;
    try {
      pending = JSON.parse(
        sessionStorage.getItem('pendingBooking') ||
        sessionStorage.getItem('pendingCashfreeBooking') || 'null'
      );
    } catch (_) {}
    if (!pending || !pending.isPoolBooking) return;

    var poolId  = pending.poolId  || (window.currentPool && window.currentPool.id);
    var date    = pending.date    || window.selectedPoolDate;
    var slotId  = pending.slotId;

    if (!poolId || !date) return;

    /* Re-run slot loader 1.5 s after confirmation (give Firestore time to settle) */
    setTimeout(function () {
      var pool = window.currentPool;
      /* Try the safe pool slot loader first (from bmg_swimming_pool_fix.js) */
      if (typeof window._safeLoadPoolSlotsPublic === 'function') {
        window._safeLoadPoolSlotsPublic(poolId, date, pool);
        return;
      }
      /* Fallback: directly re-query pool_slots and rerender */
      var db = window.db;
      if (!db) return;
      db.collection('pool_slots')
        .where('poolId', '==', poolId)
        .where('date',   '==', date)
        .orderBy('startTime')
        .get()
        .then(function (snap) {
          var slots = [];
          snap.forEach(function (doc) {
            var d = doc.data(); d.id = doc.id; slots.push(d);
          });
          /* Call whatever render function is available */
          if (typeof window._safeRenderPoolSlots === 'function') {
            window._safeRenderPoolSlots(slots, pool);
          }
          console.log('[pool-pass-fix] FIX 1: Slot grid refreshed after booking confirmed');
        })
        .catch(function (err) {
          console.warn('[pool-pass-fix] FIX 1: slot refresh error:', err.message);
        });
    }, 1500);
  });


  /* ═══════════════════════════════════════════════════════════════
   *  FIX 2 — Water-park themed entry pass with full user details
   *
   *  Injects all CSS into <head> and replaces window.showPoolEntryPass
   *  with a fully reimplemented version that renders:
   *    • Animated wave hero (cyan → blue gradient)
   *    • Animated bubbles background
   *    • User details card (name, phone, email)
   *    • Booking details grid (pool, date, time, status)
   *    • Members section with per-person price + total
   *    • Large QR code centred on a white card
   *    • Booking ID + validity footer
   * ═══════════════════════════════════════════════════════════════*/

  /* ── Inject CSS once ──────────────────────────────────────────── */
  function _injectPassCSS() {
    if (document.getElementById('bmg-pool-pass-v2-styles')) return;
    var style = document.createElement('style');
    style.id  = 'bmg-pool-pass-v2-styles';
    style.textContent = `
/* ── Water-park entry pass v2 ─────────────────────────────────── */
@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Exo+2:wght@700;800;900&display=swap');

.bmg-wpp {
  font-family: 'Nunito', sans-serif;
  max-width: 420px;
  margin: 0 auto 24px;
  border-radius: 28px;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(3,105,161,0.28), 0 4px 16px rgba(0,0,0,0.12);
  background: #fff;
  position: relative;
}

/* ── Hero wave header ─────────────────────────────── */
.bmg-wpp-hero {
  position: relative;
  height: 200px;
  overflow: hidden;
  background: linear-gradient(135deg, #0c4a6e 0%, #0369a1 40%, #0ea5e9 70%, #22d3ee 100%);
}
.bmg-wpp-bubbles {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.bmg-wpp-bubble {
  position: absolute;
  border-radius: 50%;
  background: rgba(255,255,255,0.12);
  animation: bmgBubbleRise linear infinite;
}
.bmg-wpp-bubble:nth-child(1)  { width:18px; height:18px; left:8%;   animation-duration:4.2s; animation-delay:0s;   bottom:-20px; }
.bmg-wpp-bubble:nth-child(2)  { width:10px; height:10px; left:20%;  animation-duration:5.8s; animation-delay:1s;   bottom:-20px; }
.bmg-wpp-bubble:nth-child(3)  { width:24px; height:24px; left:33%;  animation-duration:3.9s; animation-delay:.5s;  bottom:-20px; }
.bmg-wpp-bubble:nth-child(4)  { width:14px; height:14px; left:50%;  animation-duration:6.1s; animation-delay:2s;   bottom:-20px; }
.bmg-wpp-bubble:nth-child(5)  { width:20px; height:20px; left:65%;  animation-duration:4.7s; animation-delay:.8s;  bottom:-20px; }
.bmg-wpp-bubble:nth-child(6)  { width:8px;  height:8px;  left:78%;  animation-duration:5.2s; animation-delay:1.5s; bottom:-20px; }
.bmg-wpp-bubble:nth-child(7)  { width:16px; height:16px; left:88%;  animation-duration:4.0s; animation-delay:3s;   bottom:-20px; }
.bmg-wpp-bubble:nth-child(8)  { width:12px; height:12px; left:56%;  animation-duration:7.0s; animation-delay:0.3s; bottom:-20px; }
@keyframes bmgBubbleRise {
  0%   { transform: translateY(0) scale(1);   opacity: .7; }
  80%  { opacity: .5; }
  100% { transform: translateY(-220px) scale(1.15); opacity: 0; }
}
.bmg-wpp-hero-wave {
  position: absolute;
  bottom: -2px; left: 0; right: 0;
  height: 56px;
}
.bmg-wpp-hero-content {
  position: relative;
  z-index: 2;
  text-align: center;
  padding: 28px 16px 0;
}
.bmg-wpp-app-logo {
  font-family: 'Exo 2', sans-serif;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 3px;
  color: rgba(255,255,255,0.75);
  text-transform: uppercase;
  margin-bottom: 4px;
}
.bmg-wpp-hero-icon {
  font-size: 42px;
  line-height: 1;
  margin: 4px 0;
  filter: drop-shadow(0 4px 8px rgba(0,0,0,0.2));
  animation: bmgIconBob 2.4s ease-in-out infinite;
}
@keyframes bmgIconBob {
  0%,100% { transform: translateY(0); }
  50%     { transform: translateY(-5px); }
}
.bmg-wpp-hero-title {
  font-family: 'Exo 2', sans-serif;
  font-size: 22px;
  font-weight: 900;
  color: #fff;
  letter-spacing: -0.5px;
  text-shadow: 0 2px 8px rgba(0,0,0,0.25);
  margin-bottom: 4px;
}
.bmg-wpp-hero-sub {
  font-size: 12px;
  font-weight: 700;
  color: rgba(255,255,255,0.8);
  letter-spacing: 0.3px;
}

/* ── Status badge ─────────────────────────────────── */
.bmg-wpp-status-wrap {
  display: flex;
  justify-content: center;
  margin: -14px auto 0;
  position: relative;
  z-index: 4;
}
.bmg-wpp-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 800;
  padding: 6px 18px;
  border-radius: 20px;
  letter-spacing: 0.4px;
  border: 2.5px solid;
  background: #fff;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
}
.bmg-wpp-status-badge.confirmed {
  color: #15803d;
  border-color: #86efac;
}
.bmg-wpp-status-badge.confirmed::before { content: '✓ '; }

/* ── Pool venue card ──────────────────────────────── */
.bmg-wpp-venue {
  margin: 16px 16px 0;
  background: linear-gradient(135deg, #f0f9ff, #e0f2fe);
  border: 1.5px solid #bae6fd;
  border-radius: 16px;
  padding: 14px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.bmg-wpp-venue-icon {
  width: 48px; height: 48px;
  border-radius: 14px;
  background: linear-gradient(135deg, #0369a1, #0ea5e9);
  display: flex; align-items: center; justify-content: center;
  font-size: 22px;
  flex-shrink: 0;
  box-shadow: 0 4px 10px rgba(3,105,161,0.3);
}
.bmg-wpp-venue-name {
  font-family: 'Exo 2', sans-serif;
  font-size: 15px;
  font-weight: 800;
  color: #0c4a6e;
  letter-spacing: -0.3px;
  line-height: 1.2;
}
.bmg-wpp-venue-addr {
  font-size: 11px;
  color: #0369a1;
  font-weight: 600;
  margin-top: 3px;
  display: flex;
  align-items: center;
  gap: 4px;
}

/* ── Section labels ──────────────────────────────── */
.bmg-wpp-section-label {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: #94a3b8;
  margin: 18px 16px 8px;
}

/* ── User details card ───────────────────────────── */
.bmg-wpp-user-card {
  margin: 0 16px;
  background: #fafafa;
  border: 1.5px solid #f1f5f9;
  border-radius: 16px;
  overflow: hidden;
}
.bmg-wpp-user-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 14px;
  border-bottom: 1px solid #f1f5f9;
}
.bmg-wpp-user-row:last-child { border-bottom: none; }
.bmg-wpp-user-row-icon {
  width: 32px; height: 32px;
  border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px;
  flex-shrink: 0;
}
.bmg-wpp-user-row-icon.blue   { background: #eff6ff; }
.bmg-wpp-user-row-icon.cyan   { background: #ecfeff; }
.bmg-wpp-user-row-icon.green  { background: #f0fdf4; }
.bmg-wpp-user-row-label {
  font-size: 10px;
  color: #94a3b8;
  font-weight: 700;
  letter-spacing: 0.3px;
  text-transform: uppercase;
}
.bmg-wpp-user-row-value {
  font-size: 14px;
  font-weight: 700;
  color: #0f172a;
  margin-top: 1px;
}

/* ── Booking details grid ────────────────────────── */
.bmg-wpp-details-grid {
  margin: 0 16px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.bmg-wpp-detail-cell {
  background: #f8fafc;
  border: 1.5px solid #e2e8f0;
  border-radius: 14px;
  padding: 12px 13px;
}
.bmg-wpp-detail-cell.full-width {
  grid-column: 1 / -1;
}
.bmg-wpp-detail-cell-label {
  font-size: 10px;
  color: #94a3b8;
  font-weight: 700;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 5px;
}
.bmg-wpp-detail-cell-value {
  font-size: 13px;
  font-weight: 800;
  color: #0f172a;
  line-height: 1.25;
}
.bmg-wpp-detail-cell-value.amount {
  font-family: 'Exo 2', sans-serif;
  font-size: 18px;
  color: #0369a1;
}

/* ── Members section ─────────────────────────────── */
.bmg-wpp-members {
  margin: 0 16px;
  background: linear-gradient(135deg, #ecfeff, #e0f2fe);
  border: 1.5px solid #a5f3fc;
  border-radius: 16px;
  padding: 14px;
}
.bmg-wpp-members-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.bmg-wpp-members-title {
  font-size: 13px;
  font-weight: 800;
  color: #0c4a6e;
  display: flex;
  align-items: center;
  gap: 7px;
}
.bmg-wpp-members-count-badge {
  background: #0ea5e9;
  color: #fff;
  font-size: 11px;
  font-weight: 900;
  padding: 2px 10px;
  border-radius: 10px;
  font-family: 'Exo 2', sans-serif;
}
.bmg-wpp-members-per-person {
  font-size: 11px;
  font-weight: 700;
  color: #0369a1;
  background: rgba(255,255,255,0.7);
  padding: 3px 10px;
  border-radius: 8px;
}
.bmg-wpp-member-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}
.bmg-wpp-member-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(255,255,255,0.8);
  border: 1.5px solid #bae6fd;
  border-radius: 10px;
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 700;
  color: #0369a1;
}
.bmg-wpp-member-chip-num {
  width: 20px; height: 20px;
  border-radius: 50%;
  background: #0ea5e9;
  color: #fff;
  font-size: 10px;
  font-weight: 900;
  display: flex; align-items: center; justify-content: center;
  font-family: 'Exo 2', sans-serif;
}
.bmg-wpp-price-breakdown {
  background: rgba(255,255,255,0.6);
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid rgba(186,230,253,0.8);
}
.bmg-wpp-price-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 7px 12px;
  font-size: 12px;
  font-weight: 600;
  color: #0369a1;
  border-bottom: 1px solid rgba(186,230,253,0.5);
}
.bmg-wpp-price-row:last-child { border-bottom: none; }
.bmg-wpp-price-row.total {
  font-weight: 800;
  color: #0c4a6e;
  font-size: 13px;
  background: rgba(14,165,233,0.08);
}

/* ── QR code section ─────────────────────────────── */
.bmg-wpp-qr-wrap {
  margin: 0 16px;
  text-align: center;
}
.bmg-wpp-qr-card {
  background: #fff;
  border: 2px solid #bae6fd;
  border-radius: 20px;
  padding: 20px;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: 100%;
  box-sizing: border-box;
  box-shadow: 0 4px 20px rgba(14,165,233,0.12);
}
.bmg-wpp-qr-label {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: #0369a1;
}
.bmg-wpp-qr-img {
  width: 180px;
  height: 180px;
  border-radius: 12px;
  display: block;
}
.bmg-wpp-qr-hint {
  font-size: 11px;
  color: #94a3b8;
  font-weight: 600;
}

/* ── Footer ──────────────────────────────────────── */
.bmg-wpp-footer {
  margin: 16px 16px 0;
  padding: 14px;
  background: #f8fafc;
  border-radius: 14px;
  border: 1.5px solid #e2e8f0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.bmg-wpp-booking-id {
  font-family: 'Exo 2', sans-serif;
  font-size: 11px;
  font-weight: 800;
  color: #475569;
  letter-spacing: 0.5px;
  word-break: break-all;
}
.bmg-wpp-validity {
  font-size: 10px;
  font-weight: 700;
  color: #94a3b8;
  display: flex;
  align-items: center;
  gap: 4px;
}

/* ── Bottom wave decoration ──────────────────────── */
.bmg-wpp-bottom-wave {
  height: 48px;
  margin-top: 16px;
  overflow: hidden;
  line-height: 0;
}
.bmg-wpp-bottom-wave svg {
  width: 100%;
  height: 100%;
  display: block;
}

/* ── Action buttons ──────────────────────────────── */
.bmg-wpp-actions {
  max-width: 420px;
  margin: 0 auto 32px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  padding: 0 0;
}
.bmg-wpp-btn {
  padding: 13px;
  border-radius: 14px;
  font-size: 13px;
  font-weight: 800;
  font-family: 'Nunito', sans-serif;
  cursor: pointer;
  border: none;
  transition: all .2s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  letter-spacing: 0.2px;
}
.bmg-wpp-btn-home {
  background: linear-gradient(135deg, #0369a1, #0ea5e9);
  color: #fff;
  box-shadow: 0 6px 18px rgba(3,105,161,0.3);
  grid-column: 1 / -1;
}
.bmg-wpp-btn-home:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(3,105,161,0.4);
}
.bmg-wpp-btn-bookings {
  background: #f0f9ff;
  color: #0369a1;
  border: 2px solid #bae6fd;
}
.bmg-wpp-btn-share {
  background: #f0fdf4;
  color: #15803d;
  border: 2px solid #86efac;
}

/* ── Entry pass page wrapper ─────────────────────── */
#entry-pass-page .bmg-wpp-scroll-wrap {
  padding: 16px;
  padding-bottom: 40px;
  min-height: 100vh;
  background: linear-gradient(180deg, #e0f2fe 0%, #f8fafc 100%);
}
    `;
    document.head.appendChild(style);
  }


  /* ── The new showPoolEntryPass ────────────────────────────────── */
  async function showPoolEntryPassV2(bookingId) {
    _injectPassCSS();

    if (typeof window.showLoading === 'function') window.showLoading('Generating your pool pass…');

    try {
      var db = window.db;
      var booking = null;

      /* Lookup strategies — same as original */
      var d1 = await db.collection('pool_bookings').doc(bookingId).get().catch(function () { return { exists: false }; });
      if (d1.exists) booking = Object.assign({ _docId: d1.id }, d1.data());

      if (!booking) {
        var s1 = await db.collection('pool_bookings').where('bookingId', '==', bookingId).limit(1).get().catch(function () { return { empty: true }; });
        if (!s1.empty) booking = Object.assign({ _docId: s1.docs[0].id }, s1.docs[0].data());
      }
      if (!booking) {
        var s2 = await db.collection('pool_bookings').where('orderId', '==', bookingId).limit(1).get().catch(function () { return { empty: true }; });
        if (!s2.empty) booking = Object.assign({ _docId: s2.docs[0].id }, s2.docs[0].data());
      }
      if (!booking) {
        var s3 = await db.collection('bookings').where('bookingId', '==', bookingId).limit(1).get().catch(function () { return { empty: true }; });
        if (!s3.empty) booking = Object.assign({ _docId: s3.docs[0].id }, s3.docs[0].data());
      }

      if (!booking) {
        if (typeof window.hideLoading === 'function') window.hideLoading();
        if (typeof window.showToast   === 'function') window.showToast('Booking not found', 'error');
        return;
      }

      /* Status check */
      var bStat = booking.bookingStatus || booking.status || '';
      var isOk  = bStat === 'confirmed' || bStat === 'completed' || booking.paymentStatus === 'paid';
      if (!isOk) {
        if (typeof window.hideLoading === 'function') window.hideLoading();
        if (typeof window.showToast   === 'function') window.showToast('Preparing your pass…', 'info');
        setTimeout(function () { showPoolEntryPassV2(bookingId); }, 2500);
        return;
      }

      /* ── Derive all display values ── */
      var memberCount = booking.memberCount || 1;
      var perPer      = booking.pricePerMember || 0;
      if (!perPer && memberCount > 0) perPer = Math.round((booking.amount || 0) / memberCount);
      var totalPaid   = booking.amount || perPer * memberCount;

      var dateLabel = booking.date || '';
      try {
        dateLabel = new Date(booking.date).toLocaleDateString('en-IN', {
          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
        });
      } catch (e) {}

      var userName  = booking.userName  || booking.userDisplayName || 'Guest';
      var userPhone = booking.userPhone || booking.phone || '—';
      var userEmail = booking.userEmail || booking.email || '—';
      var poolName  = booking.poolName  || 'Swimming Pool';
      var poolAddr  = booking.poolAddress || booking.venueAddress || '';
      var slotTime  = booking.slotTime  || '—';
      var bookId    = booking.bookingId || booking._docId || bookingId;

      /* ── Generate QR ── */
      var qrDataUrl = '';
      try {
        var qrPayload = JSON.stringify({
          app       : 'BookMyGame',
          type      : 'pool_entry',
          bookingId : bookId,
          poolId    : booking.poolId,
          date      : booking.date,
          slot      : slotTime,
          members   : memberCount,
          phone     : userPhone,
        });
        if (window.QRCode && typeof window.QRCode.toDataURL === 'function') {
          qrDataUrl = await window.QRCode.toDataURL(qrPayload, {
            width: 220, margin: 2,
            color: { dark: '#0c4a6e', light: '#f0f9ff' }
          });
        }
      } catch (e) { /* QR optional */ }

      /* ── Build member chips HTML ── */
      var memberChipsHtml = '';
      for (var m = 1; m <= memberCount; m++) {
        memberChipsHtml +=
          '<div class="bmg-wpp-member-chip">' +
            '<span class="bmg-wpp-member-chip-num">' + m + '</span>' +
            'Member ' + m +
          '</div>';
      }

      /* ── Price breakdown HTML ── */
      var priceBreakdownHtml = '';
      if (memberCount > 1) {
        priceBreakdownHtml =
          '<div class="bmg-wpp-price-breakdown">' +
            '<div class="bmg-wpp-price-row">' +
              '<span>Price per person</span><span>₹' + perPer + '</span>' +
            '</div>' +
            '<div class="bmg-wpp-price-row">' +
              '<span>Members</span><span>× ' + memberCount + '</span>' +
            '</div>' +
            '<div class="bmg-wpp-price-row total">' +
              '<span>💰 Total Paid</span><span>₹' + totalPaid + '</span>' +
            '</div>' +
          '</div>';
      }

      /* ── Full pass HTML ── */
      var passHtml =
        '<div class="bmg-wpp-scroll-wrap">' +

          '<div class="bmg-wpp">' +

            /* ── Hero ── */
            '<div class="bmg-wpp-hero">' +
              '<div class="bmg-wpp-bubbles">' +
                '<div class="bmg-wpp-bubble"></div>' +
                '<div class="bmg-wpp-bubble"></div>' +
                '<div class="bmg-wpp-bubble"></div>' +
                '<div class="bmg-wpp-bubble"></div>' +
                '<div class="bmg-wpp-bubble"></div>' +
                '<div class="bmg-wpp-bubble"></div>' +
                '<div class="bmg-wpp-bubble"></div>' +
                '<div class="bmg-wpp-bubble"></div>' +
              '</div>' +
              '<div class="bmg-wpp-hero-content">' +
                '<div class="bmg-wpp-app-logo">BookMyGame</div>' +
                '<div class="bmg-wpp-hero-icon">🏊</div>' +
                '<div class="bmg-wpp-hero-title">Pool Entry Pass</div>' +
                '<div class="bmg-wpp-hero-sub">🎟️ Present this pass at the pool entrance</div>' +
              '</div>' +
              '<svg class="bmg-wpp-hero-wave" viewBox="0 0 400 56" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">' +
                '<path d="M0,20 C80,50 160,0 240,30 C320,56 380,10 400,24 L400,56 L0,56 Z" fill="#fff"/>' +
              '</svg>' +
            '</div>' +

            /* ── Status ── */
            '<div class="bmg-wpp-status-wrap">' +
              '<div class="bmg-wpp-status-badge confirmed">Booking Confirmed</div>' +
            '</div>' +

            /* ── Pool / Venue ── */
            '<div class="bmg-wpp-venue">' +
              '<div class="bmg-wpp-venue-icon">🏖️</div>' +
              '<div>' +
                '<div class="bmg-wpp-venue-name">' + _esc(poolName) + '</div>' +
                (poolAddr ? '<div class="bmg-wpp-venue-addr">📍 ' + _esc(poolAddr) + '</div>' : '') +
              '</div>' +
            '</div>' +

            /* ── Guest details ── */
            '<div class="bmg-wpp-section-label">Guest Details</div>' +
            '<div class="bmg-wpp-user-card">' +
              '<div class="bmg-wpp-user-row">' +
                '<div class="bmg-wpp-user-row-icon blue">👤</div>' +
                '<div>' +
                  '<div class="bmg-wpp-user-row-label">Full Name</div>' +
                  '<div class="bmg-wpp-user-row-value">' + _esc(userName) + '</div>' +
                '</div>' +
              '</div>' +
              '<div class="bmg-wpp-user-row">' +
                '<div class="bmg-wpp-user-row-icon cyan">📱</div>' +
                '<div>' +
                  '<div class="bmg-wpp-user-row-label">Phone</div>' +
                  '<div class="bmg-wpp-user-row-value">' + _esc(userPhone) + '</div>' +
                '</div>' +
              '</div>' +
              (userEmail && userEmail !== '—'
                ? '<div class="bmg-wpp-user-row">' +
                    '<div class="bmg-wpp-user-row-icon green">✉️</div>' +
                    '<div>' +
                      '<div class="bmg-wpp-user-row-label">Email</div>' +
                      '<div class="bmg-wpp-user-row-value">' + _esc(userEmail) + '</div>' +
                    '</div>' +
                  '</div>'
                : '') +
            '</div>' +

            /* ── Booking info grid ── */
            '<div class="bmg-wpp-section-label">Booking Details</div>' +
            '<div class="bmg-wpp-details-grid">' +
              '<div class="bmg-wpp-detail-cell full-width">' +
                '<div class="bmg-wpp-detail-cell-label">📅 Date</div>' +
                '<div class="bmg-wpp-detail-cell-value">' + _esc(dateLabel) + '</div>' +
              '</div>' +
              '<div class="bmg-wpp-detail-cell">' +
                '<div class="bmg-wpp-detail-cell-label">⏰ Time Slot</div>' +
                '<div class="bmg-wpp-detail-cell-value">' + _esc(slotTime) + '</div>' +
              '</div>' +
              '<div class="bmg-wpp-detail-cell">' +
                '<div class="bmg-wpp-detail-cell-label">💸 Total Paid</div>' +
                '<div class="bmg-wpp-detail-cell-value amount">₹' + totalPaid + '</div>' +
              '</div>' +
            '</div>' +

            /* ── Members ── */
            '<div class="bmg-wpp-section-label">Members Allowed</div>' +
            '<div class="bmg-wpp-members">' +
              '<div class="bmg-wpp-members-header">' +
                '<div class="bmg-wpp-members-title">' +
                  '🏊 Swimmers' +
                  '<span class="bmg-wpp-members-count-badge">' + memberCount + '</span>' +
                '</div>' +
                (perPer > 0 && memberCount > 1
                  ? '<div class="bmg-wpp-members-per-person">₹' + perPer + '/person</div>'
                  : '') +
              '</div>' +
              '<div class="bmg-wpp-member-chips">' + memberChipsHtml + '</div>' +
              priceBreakdownHtml +
            '</div>' +

            /* ── QR code ── */
            (qrDataUrl
              ? '<div class="bmg-wpp-section-label">Scan at Entry</div>' +
                '<div class="bmg-wpp-qr-wrap">' +
                  '<div class="bmg-wpp-qr-card">' +
                    '<div class="bmg-wpp-qr-label">🔍 Scan QR Code</div>' +
                    '<img src="' + qrDataUrl + '" alt="Entry QR" class="bmg-wpp-qr-img">' +
                    '<div class="bmg-wpp-qr-hint">Show this to the pool staff at the gate</div>' +
                  '</div>' +
                '</div>'
              : '') +

            /* ── Footer ── */
            '<div class="bmg-wpp-footer">' +
              '<div class="bmg-wpp-booking-id"># ' + _esc(bookId) + '</div>' +
              '<div class="bmg-wpp-validity">🛡️ Valid for selected slot only</div>' +
            '</div>' +

            /* ── Bottom wave ── */
            '<div class="bmg-wpp-bottom-wave">' +
              '<svg viewBox="0 0 400 48" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">' +
                '<path d="M0,16 C100,40 200,0 300,24 C350,38 380,10 400,18 L400,48 L0,48 Z" fill="rgba(14,165,233,0.09)"/>' +
                '<path d="M0,28 C80,8 200,40 320,16 C370,6 390,30 400,24 L400,48 L0,48 Z" fill="rgba(14,165,233,0.06)"/>' +
              '</svg>' +
            '</div>' +

          '</div>' + /* end .bmg-wpp */

          /* ── Action buttons ── */
          '<div class="bmg-wpp-actions">' +
            '<button class="bmg-wpp-btn bmg-wpp-btn-bookings" id="wpp-my-bookings-btn">' +
              '📋 My Bookings' +
            '</button>' +
            '<button class="bmg-wpp-btn bmg-wpp-btn-share" id="wpp-share-btn">' +
              '📤 Share Pass' +
            '</button>' +
            '<button class="bmg-wpp-btn bmg-wpp-btn-home" id="wpp-home-btn">' +
              '🏠 Back to Home' +
            '</button>' +
          '</div>' +

        '</div>'; /* end scroll-wrap */

      /* ── Render into entry-pass-page ── */
      var container = document.getElementById('entry-pass-content');
      if (container) {
        container.innerHTML = passHtml;

        /* Wire buttons */
        var homeBtn = document.getElementById('wpp-home-btn');
        if (homeBtn) {
          homeBtn.addEventListener('click', function () {
            if (typeof window.goHome === 'function') window.goHome();
            else if (typeof window.showPage === 'function') window.showPage('home-page');
          });
        }
        var bkBtn = document.getElementById('wpp-my-bookings-btn');
        if (bkBtn) {
          bkBtn.addEventListener('click', function () {
            if (typeof window.showPage === 'function') {
              window.showPage('bookings-page');
              if (typeof window.loadUserBookings === 'function') window.loadUserBookings('upcoming');
            }
          });
        }
        var shareBtn = document.getElementById('wpp-share-btn');
        if (shareBtn) {
          shareBtn.addEventListener('click', function () {
            if (navigator.share) {
              navigator.share({
                title : 'Pool Entry Pass — BookMyGame',
                text  : 'Pool: ' + poolName + ' | Date: ' + booking.date + ' | Slot: ' + slotTime + ' | Booking: ' + bookId,
              }).catch(function () {});
            } else if (typeof window.showToast === 'function') {
              window.showToast('Copy your booking ID: ' + bookId, 'info');
            }
          });
        }
      }

      if (typeof window.hideLoading === 'function') window.hideLoading();
      if (typeof window.showPage    === 'function') window.showPage('entry-pass-page');

    } catch (err) {
      if (typeof window.hideLoading === 'function') window.hideLoading();
      if (typeof window.showToast   === 'function') window.showToast('Could not load entry pass', 'error');
      console.error('[pool-pass-fix] showPoolEntryPassV2 error:', err);
    }
  }

  /* ── Install — override the existing function ── */
  window.showPoolEntryPass = showPoolEntryPassV2;
  /* Also guard against bmg_bookings_fix wrapping it again */
  window.showPoolEntryPass._fixPatched = true;
  window.showPoolEntryPass._v2 = true;

  console.log('✅ [bmg_pool_pass_fix.js] Loaded — water-park entry pass + slot fill fix active');

})();
