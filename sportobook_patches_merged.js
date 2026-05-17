/**
 * sportobook_patches_merged.js  — MASTER COMBINED PATCH v1.0
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  ALL patch/fix scripts merged into ONE file.
 *  Load this file AFTER app.js and paymentService.js.
 *
 *  Source files merged (do NOT load any of them separately):
 *   • sportobook_ui.js
 *   • sportobook_ui_fix.js
 *   • sportobook_slot_fix.js
 *   • sportobook_entrypass_fix.js
 *   • sportobook_swipe_cards.js
 *   • sportobook_edit_ground_discount.js
 *   • sportobook_patch_v2.js
 *   • sportobook_patch_v3.js
 *   • sportobook_master_fix.js
 *   • sportobook_ultimate_fix.js
 *   • sportobook_all_fixes.js  (modules: complete_fix_v2, pro_fix, slotlock_fix, free_listing, brand_fix)
 *   • SPORTOBOOK_COMPLETE_FIX_v1.js
 *   • SPORTOBOOK_COMPLETE_FIX_v2.js
 *   • bmg_nearby_fix.js
 *   • bmg_super_fix.js
 *   • bmg_super_patch.js
 *   • bmg_three_bug_fix.js
 *
 *  DEDUPLICATION RULES APPLIED:
 *   • showEntryPass      → master_fix v4 version (multi-strategy QR, all field names, JSON payload)
 *   • processVerifiedQRCode → master_fix v4 (handles JSON + SPB|pipe, 3-strategy Firestore lookup)
 *   • recoverPaymentSession → master_fix v4 (field queries + merge pending_payments)
 *   • loadSlots          → master_fix v4 (real-time onSnapshot, loop-safe, slot icon upgrade)
 *   • loadNearbyVenues   → brand_fix version (all grounds, no limit, swipe-card render)
 *   • displayVenueItems  → swipe_cards version (Blinkit-style cards)
 *   • handleUserRegister → bmg_super_patch version (no pre-check, city field, full validation)
 *   • handleAddGround    → swipe_cards version (discount field injection)
 *   • handleEditGround   → edit_ground_discount version (discount save)
 *   • sportoTransferPayment → patch_v2 version (correct owner_transfers collection)
 *   • loadOwnerEarnings  → edit_ground_discount version (discount-aware rows)
 *   • getUserLocation    → sportobook_ui version (full address reverse geocode)
 *   • Slot listener      → patch_v2 version (deduplicated, loop-safe key guard)
 *   • CSS               → all CSS merged under unique IDs, latest wins per component
 *
 *  LOAD ORDER in index.html:
 *    <script src="paymentService.js"></script>
 *    <script src="app.js"></script>
 *    <script src="sportobook_patches_merged.js"></script>   ← THIS FILE ONLY
 *  </body>
 *
 * ═══════════════════════════════════════════════════════════════════════
 */

'use strict';

/* ════════════════════════════════════════════════════════════════════
   SECTION 0 — SHARED UTILITIES
   (used by all sections below — defined once here)
   ════════════════════════════════════════════════════════════════════ */

var _SPB = (function () {
  'use strict';

  /* HTML escape */
  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* Toast */
  function toast(msg, type, dur) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info', dur || 3000);
  }

  /* Format currency */
  function fmt(v) {
    return typeof window.formatCurrency === 'function'
      ? window.formatCurrency(v)
      : '₹' + Number(v || 0).toFixed(0);
  }

  /* Wait for a property/function to appear on window */
  function waitFor(fn, maxMs, interval) {
    return new Promise(function (resolve) {
      var start = Date.now();
      var id = setInterval(function () {
        if (fn()) { clearInterval(id); resolve(true); return; }
        if (Date.now() - start > (maxMs || 8000)) { clearInterval(id); resolve(false); }
      }, interval || 150);
    });
  }

  /* Field-name helpers — try multiple possible field names */
  function pick(obj) {
    for (var i = 1; i < arguments.length; i++) {
      var v = obj && obj[arguments[i]];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return null;
  }
  function getBookingId(b, fb) { return pick(b, 'bookingId', 'orderId', 'id', 'paymentId') || fb || ''; }
  function getUserName(b)      { return pick(b, 'userName', 'userDisplayName', 'name', 'displayName', 'playerName', 'bookedBy') || '—'; }
  function getGround(b)        { return pick(b, 'groundName', 'venueName', 'facilityName', 'ground', 'venue') || '—'; }
  function getAddress(b)       { return pick(b, 'groundAddress', 'venueAddress', 'address', 'location', 'area') || ''; }
  function getDate(b)          { return pick(b, 'date', 'bookingDate', 'slotDate', 'day') || '—'; }
  function getSlot(b)          { return pick(b, 'slotTime', 'timeSlot', 'slot', 'time', 'bookedSlot') || '—'; }
  function getGroundId(b)      { return pick(b, 'groundId', 'venueId', 'facilityId') || ''; }

  /* Merge two objects — primary fields win, secondary fills blanks */
  function merge(primary, secondary) {
    return Object.assign({}, secondary || {}, primary || {});
  }

  /* Normalise slot key to HH:MM-HH:MM */
  function normSlotKey(k) {
    k = (k || '').replace(/\s/g, '');
    if (/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(k)) return k;
    var m = k.match(/^(\d{2})(\d{2})-(\d{2})(\d{2})$/);
    if (m) return m[1] + ':' + m[2] + '-' + m[3] + ':' + m[4];
    return k;
  }

  /* Debounce */
  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  /* Safe collection name resolver */
  function C(name) {
    if (window.COLLECTIONS && window.COLLECTIONS[name.toUpperCase()]) {
      return window.COLLECTIONS[name.toUpperCase()];
    }
    var map = {
      users: 'users', owners: 'owners', venues: 'venues', grounds: 'grounds',
      slots: 'slots', bookings: 'bookings', referrals: 'referrals',
      admins: 'admins', reviews: 'reviews', payouts: 'payouts',
      reports: 'reports', payments: 'payments', pending_payments: 'pending_payments',
      owner_registrations: 'owner_registrations', owner_payments: 'owner_payments',
      owner_transfers: 'owner_transfers',
    };
    return map[name] || name;
  }

  /* sessionStorage helpers */
  function persist(booking, orderId) {
    if (!booking) return;
    if (!booking.bookingId) booking.bookingId = orderId || '';
    try {
      if (booking.bookingId) sessionStorage.setItem('spb_lastConfirmedBookingId', booking.bookingId);
      sessionStorage.setItem('spb_lastConfirmedBooking', JSON.stringify(booking));
    } catch (_) {}
  }
  function loadCache(bookingId) {
    try {
      var c = JSON.parse(sessionStorage.getItem('spb_lastConfirmedBooking') || '{}');
      if (!bookingId || c.bookingId === bookingId || c.orderId === bookingId) return c;
    } catch (_) {}
    return null;
  }

  /* Detail row for entry pass */
  function epRow(label, html, wrap) {
    return '<div style="display:flex;justify-content:space-between;align-items:flex-start;' +
      'padding:7px 0;border-bottom:1px solid #F8FAFC;font-size:.88rem;">' +
      '<span style="color:#64748B;white-space:nowrap;min-width:80px;margin-right:12px;">' + label + '</span>' +
      '<span style="font-weight:600;text-align:right;' + (wrap ? 'word-break:break-word;max-width:240px;' : '') + '">' + html + '</span></div>';
  }

  return {
    esc: esc, toast: toast, fmt: fmt, waitFor: waitFor,
    pick: pick, getBookingId: getBookingId, getUserName: getUserName,
    getGround: getGround, getAddress: getAddress, getDate: getDate,
    getSlot: getSlot, getGroundId: getGroundId, merge: merge,
    normSlotKey: normSlotKey, debounce: debounce, C: C,
    persist: persist, loadCache: loadCache, epRow: epRow,
  };
})();


/* ════════════════════════════════════════════════════════════════════
   SECTION 1 — CSS: ALL STYLES (merged, unique IDs, latest wins)
   ════════════════════════════════════════════════════════════════════ */
(function injectAllCSS() {
  // Remove old stale style tags from any previously loaded fix files
  var OLD_IDS = [
    'spb-slot-styles', 'spb-master-styles', 'spb-swipe-styles', 'spb-edit-discount-styles',
    'sportobook-ui-fix-styles', 'bmg-super-theme', 'bmg-profile-override-css',
    'bmg-auth-override-css', 'spb-grid-style', 'bmg-profile-override-css', 'spb-ultimate-padding',
  ];
  OLD_IDS.forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.remove();
  });

  var s = document.createElement('style');
  s.id = 'spb-merged-styles';
  s.textContent = `

  /* ── Splash screen – minimum 5s enforced via JS ── */
  #splash-screen { transition: opacity 0.4s ease; }

  /* ── Bottom nav safe-area padding ── */
  .home-content, #home-page .home-content, #home-page main,
  #bookings-page, #bookings-page .bookings-content,
  #profile-page, #profile-page .profile-content,
  #owner-dashboard-page .dashboard-content,
  .page.active {
    padding-bottom: calc(80px + env(safe-area-inset-bottom, 0px)) !important;
  }

  /* ── Nearby venues: horizontal swipe row ── */
  #nearby-venues {
    display: flex !important;
    flex-direction: row !important;
    flex-wrap: nowrap !important;
    grid-template-columns: unset !important;
    overflow-x: auto !important;
    overflow-y: hidden !important;
    scroll-snap-type: x mandatory !important;
    -webkit-overflow-scrolling: touch !important;
    gap: 14px !important;
    padding: 8px 4px 16px !important;
    scrollbar-width: none !important;
    -ms-overflow-style: none !important;
  }
  #nearby-venues::-webkit-scrollbar { display: none !important; }
  #nearby-venues > * {
    flex-shrink: 0 !important;
    width: 175px !important;
    min-width: 175px !important;
    max-width: 175px !important;
    scroll-snap-align: start !important;
  }
  #nearby-venues .spb-empty-state,
  #nearby-venues .skeleton-loading,
  #nearby-venues .empty-state,
  #nearby-venues .loading-spinner {
    flex: 0 0 100% !important;
    width: 100% !important;
    max-width: 100% !important;
  }

  /* ── Ground swipe card ── */
  .spb-gcard {
    background: #fff;
    border-radius: 14px;
    overflow: hidden;
    box-shadow: 0 2px 10px rgba(0,0,0,.08);
    cursor: pointer;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
    width: 175px;
    flex-shrink: 0;
  }
  .spb-gcard:active { transform: scale(0.97); }
  .spb-gcard-img {
    width: 100%;
    height: 110px;
    object-fit: cover;
    background: linear-gradient(135deg, #4F46E5, #7C3AED);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2.4rem;
    position: relative;
  }
  .spb-gcard-discount-badge {
    position: absolute;
    top: 8px;
    left: 8px;
    background: #EF4444;
    color: #fff;
    font-size: 0.65rem;
    font-weight: 800;
    padding: 3px 7px;
    border-radius: 6px;
    letter-spacing: 0.3px;
  }
  .spb-gcard-body { padding: 10px 10px 12px; }
  .spb-gcard-name {
    font-size: 0.82rem;
    font-weight: 700;
    color: #1e293b;
    margin: 0 0 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .spb-gcard-sport { font-size: 0.7rem; color: #64748b; margin-bottom: 6px; }
  .spb-gcard-price-row { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
  .spb-gcard-price { font-size: 0.85rem; font-weight: 800; color: #1e293b; }
  .spb-gcard-orig  { font-size: 0.7rem; color: #94a3b8; text-decoration: line-through; }
  .spb-book-btn {
    display: block;
    width: 100%;
    padding: 8px;
    background: linear-gradient(135deg, #4F46E5, #7C3AED);
    color: #fff;
    border: none;
    border-radius: 8px;
    font-size: 0.75rem;
    font-weight: 700;
    cursor: pointer;
    text-align: center;
  }

  /* ── Time slot states ── */
  .time-slot {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    padding: 10px 5px !important;
    border-radius: 10px !important;
    border: 2px solid #E2E8F0 !important;
    cursor: pointer !important;
    transition: all .18s ease !important;
    position: relative;
    background: #fff !important;
    text-align: center;
    min-height: 62px;
    font-size: .78rem !important;
    font-weight: 600 !important;
    user-select: none;
  }
  .time-slot .spb-icon  { font-size: .95rem; line-height: 1; }
  .time-slot .spb-time  { font-size: .7rem; font-weight: 700; line-height: 1.2; }
  .time-slot .spb-label { font-size: .58rem; font-weight: 600; letter-spacing: .03em; text-transform: uppercase; opacity: .85; }

  .time-slot.available {
    border-color: #10B981 !important;
    background: linear-gradient(135deg, #fff, rgba(16,185,129,.06)) !important;
    color: #065F46 !important;
  }
  .time-slot.available:hover {
    background: linear-gradient(135deg, #ECFDF5, #D1FAE5) !important;
    border-color: #059669 !important;
    transform: translateY(-3px) !important;
    box-shadow: 0 6px 16px rgba(16,185,129,.25) !important;
  }
  .time-slot.confirmed, .time-slot.booked {
    background: linear-gradient(135deg, #FEF2F2, #FEE2E2) !important;
    border-color: #EF4444 !important;
    color: #991B1B !important;
    cursor: not-allowed !important;
    opacity: 1 !important;
    box-shadow: 0 2px 8px rgba(239,68,68,.2) !important;
  }
  .time-slot.confirmed .spb-time, .time-slot.booked .spb-time { text-decoration: line-through; color: #991B1B; }
  .time-slot.locked, .time-slot.pending {
    background: linear-gradient(135deg, #FFFBEB, #FEF3C7) !important;
    border-color: #F59E0B !important;
    color: #92400E !important;
    cursor: not-allowed !important;
    animation: spbPulse 1.8s ease-in-out infinite;
  }
  @keyframes spbPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(245,158,11,0); } 50% { box-shadow: 0 0 0 5px rgba(245,158,11,.2); } }
  .time-slot.past {
    background: #F1F5F9 !important;
    border-color: #CBD5E1 !important;
    color: #94A3B8 !important;
    cursor: not-allowed !important;
    opacity: .65 !important;
  }
  .time-slot.past .spb-time { text-decoration: line-through; }
  .time-slot.closed { background: #F8FAFC !important; border-color: #E2E8F0 !important; color: #94A3B8 !important; cursor: not-allowed !important; opacity: .55 !important; }
  .time-slot.selected {
    background: linear-gradient(135deg, #4F46E5, #7C3AED) !important;
    border-color: #4F46E5 !important;
    color: #fff !important;
    transform: scale(1.04) !important;
    box-shadow: 0 6px 20px rgba(79,70,229,.35) !important;
    cursor: pointer !important;
  }
  .time-slot.selected .spb-icon, .time-slot.selected .spb-time, .time-slot.selected .spb-label { color: #fff !important; opacity: 1 !important; }

  /* Slot legend */
  .spb-legend { display: flex; flex-wrap: wrap; gap: 8px 14px; padding: 8px 2px 10px; font-size: .7rem; font-weight: 600; color: #475569; }
  .spb-legend-item { display: flex; align-items: center; gap: 5px; }
  .spb-legend-dot  { width: 9px; height: 9px; border-radius: 50%; border: 2px solid; }
  .spb-legend-dot.available { background: #D1FAE5; border-color: #10B981; }
  .spb-legend-dot.booked    { background: #FEE2E2; border-color: #EF4444; }
  .spb-legend-dot.pending   { background: #FEF3C7; border-color: #F59E0B; }
  .spb-legend-dot.past      { background: #E2E8F0; border-color: #94A3B8; }

  /* ── Profile page ── */
  #profile-page { background: #f1f5f9 !important; min-height: 100vh; }
  #profile-page .profile-header {
    background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%);
    padding: 40px 24px 32px;
    text-align: center;
    border-radius: 0 0 32px 32px;
    box-shadow: 0 8px 32px rgba(79,70,229,0.25);
  }
  #profile-image-large { width: 88px; height: 88px; border-radius: 50%; border: 4px solid rgba(255,255,255,0.9); box-shadow: 0 4px 16px rgba(0,0,0,0.2); object-fit: cover; }
  #change-photo-btn { display: none !important; }
  #profile-page #profile-name { font-size: 1.35rem; font-weight: 700; color: #fff; margin: 0 0 4px; }
  #profile-page #profile-email, #profile-page #profile-phone { font-size: 0.82rem; color: rgba(255,255,255,0.82); margin: 2px 0; }
  #profile-page .role-badge {
    display: inline-block; margin-top: 8px; padding: 3px 14px;
    background: rgba(255,255,255,0.2); border-radius: 20px;
    font-size: 0.75rem; color: #fff; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase;
  }
  #profile-page .profile-menu { margin: 20px 16px 80px; background: #fff; border-radius: 20px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.07); }
  #profile-page .menu-item {
    display: flex; align-items: center; gap: 14px; padding: 17px 20px;
    color: #1e293b; text-decoration: none; font-size: 0.92rem; font-weight: 500;
    border-bottom: 1px solid #f1f5f9; transition: background 0.15s; cursor: pointer;
  }
  #profile-page .menu-item:last-child { border-bottom: none; }
  #profile-page .menu-item:hover, #profile-page .menu-item:active { background: #f8fafc; }
  #profile-page .menu-item i:first-child {
    width: 34px; height: 34px; background: linear-gradient(135deg,#4F46E5,#7C3AED);
    color: #fff; border-radius: 10px; display: flex; align-items: center;
    justify-content: center; font-size: 0.88rem; flex-shrink: 0;
  }
  #profile-page .menu-item span { flex: 1; }
  #profile-page .menu-item i:last-child { color: #94a3b8; font-size: 0.75rem; }
  #profile-page .menu-item.logout i:first-child { background: linear-gradient(135deg,#ef4444,#dc2626); }
  #profile-page .menu-item.logout { color: #ef4444; }

  /* ── Earnings card ── */
  .bmg-earnings-card {
    display: flex !important; align-items: center !important; gap: 14px !important;
    padding: 16px 18px !important; background: linear-gradient(135deg,#f0f7ff,#e8f2ff) !important;
    border: 1.5px solid #bfdbfe !important; border-radius: 16px !important;
    margin: 0 20px 12px !important; cursor: pointer !important;
    transition: all .18s ease !important; text-decoration: none !important;
  }
  .bmg-earnings-card:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(37,99,235,0.15) !important; }
  .bmg-earnings-icon { width: 46px; height: 46px; border-radius: 12px; background: linear-gradient(135deg,#4F46E5,#7C3AED); display: flex; align-items: center; justify-content: center; color: #fff; font-size: 1.3rem; flex-shrink: 0; }
  .bmg-earnings-info { flex: 1; }
  .bmg-earnings-label { font-size: 12px; color: #6b7280; margin-bottom: 2px; }
  .bmg-earnings-amount { font-size: 1.25rem; font-weight: 800; color: #1e40af; }
  .bmg-earnings-arrow { color: #93c5fd; font-size: 1rem; }

  /* ── Discount field in edit modal ── */
  #spb-edit-discount-group { margin-top: 16px; }
  #spb-edit-discount-label { display: flex; align-items: center; gap: 6px; font-size: .85rem; font-weight: 600; color: #374151; margin-bottom: 8px; }
  #edit-ground-discount {
    width: 100%; padding: 12px 16px; border: 2px solid #E5E7EB;
    border-radius: 12px; font-size: .9rem; outline: none; transition: border-color .2s;
  }
  #edit-ground-discount:focus { border-color: #4F46E5; }
  #spb-discount-preview { font-size: .82rem; color: #374151; margin-top: 8px; min-height: 20px; }

  /* ── Auth pages ── */
  .auth-container, .auth-page, #login-page, #owner-type-page,
  #venue-owner-register-page, #plot-owner-register-page {
    background: linear-gradient(160deg, #1e3a8a 0%, #2563eb 45%, #3b82f6 100%) !important;
  }
  .auth-header h1, .auth-header p { color: #fff !important; }
  .input-group input:focus { border-color: #4F46E5 !important; box-shadow: 0 0 0 3px rgba(79,70,229,0.18) !important; }

  /* ── View All button ── */
  #bmg-view-all-btn {
    display: block; width: calc(100% - 40px); margin: 4px 20px 16px; padding: 13px;
    background: linear-gradient(135deg, #4F46E5, #7C3AED); color: #fff;
    border: none; border-radius: 12px; font-size: 0.9rem; font-weight: 700;
    cursor: pointer; text-align: center; box-shadow: 0 4px 14px rgba(79,70,229,0.3);
  }

  /* ── Entry pass card ── */
  .entry-pass-card-v2 { background: #fff; border-radius: 20px; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,0.14); margin: 16px; }
  .ep-header { background: linear-gradient(135deg, #1e3a8a, #4F46E5, #7C3AED); padding: 22px 20px 18px; color: #fff; display: flex; justify-content: space-between; align-items: center; }
  .ep-logo { display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: 1rem; }
  .ep-badge { background: rgba(255,255,255,0.2); padding: 4px 12px; border-radius: 999px; font-size: 0.7rem; font-weight: 700; letter-spacing: .5px; }
  .ep-body { padding: 20px; }
  .ep-venue-name { font-size: 1.15rem; font-weight: 800; color: #1e293b; margin: 0 0 16px; }
  .ep-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 18px; }
  .ep-item { background: #f8fafc; border-radius: 10px; padding: 10px 12px; }
  .ep-label { font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 3px; }
  .ep-val { font-size: 0.88rem; font-weight: 700; color: #1e293b; }
  .ep-qr-wrap { text-align: center; padding: 14px 0 6px; }
  .ep-qr-img { width: 170px; height: 170px; border: 3px solid #4F46E5; border-radius: 12px; }
  .ep-validity { display: flex; align-items: center; gap: 6px; font-size: 0.72rem; color: #64748b; justify-content: center; margin-top: 10px; }
  .ep-validity-dot { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; animation: epPulse 1.5s infinite; }
  @keyframes epPulse { 0%,100% { opacity: 1; } 50% { opacity: .4; } }
  .ep-bid { font-size: 0.68rem; color: #94a3b8; text-align: center; margin: 10px 0 0; padding-top: 10px; border-top: 1px solid #f1f5f9; }

  /* ── Animated avatar ── */
  .spb-avatar {
    width: 38px; height: 38px; border-radius: 50%;
    background: linear-gradient(135deg, #4F46E5, #7C3AED);
    color: #fff; font-size: 0.85rem; font-weight: 800;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; position: relative; overflow: hidden;
    border: 2px solid rgba(255,255,255,0.3); flex-shrink: 0;
  }
  .spb-avatar-ripple {
    position: absolute; inset: 0; border-radius: 50%;
    border: 2px solid rgba(79,70,229,0.4);
    animation: spbAvatarPulse 2.5s ease-out infinite;
  }
  @keyframes spbAvatarPulse { 0% { transform: scale(1); opacity: 0.8; } 100% { transform: scale(1.6); opacity: 0; } }

  /* ── QR scanner (owners only) ── */
  #header-qr-scanner[style*="none"] { display: none !important; }

  /* ── Registration form city field ── */
  #reg-city-group { margin-bottom: 16px; }

  /* ── Offer badge on ground card ── */
  .spb-offer-badge {
    display: inline-block; background: #EF4444; color: #fff;
    font-size: 0.65rem; font-weight: 800; padding: 2px 6px;
    border-radius: 6px; margin-left: 6px; vertical-align: middle;
  }

  `;
  document.head.appendChild(s);
})();


/* ════════════════════════════════════════════════════════════════════
   SECTION 2 — SPLASH SCREEN (5-second minimum)
   ════════════════════════════════════════════════════════════════════ */
(function patchSplash() {
  var SPLASH_MIN_MS = 5000;
  var splashShownAt = Date.now();
  var splash = document.getElementById('splash-screen');
  if (!splash) return;
  var _origAdd = splash.classList.add.bind(splash.classList);
  splash.classList.add = function () {
    var args = Array.prototype.slice.call(arguments);
    if (args.indexOf('hide') !== -1) {
      var elapsed = Date.now() - splashShownAt;
      var wait = Math.max(0, SPLASH_MIN_MS - elapsed);
      setTimeout(function () { _origAdd.apply(null, args); }, wait);
      return;
    }
    _origAdd.apply(null, args);
  };
})();


/* ════════════════════════════════════════════════════════════════════
   SECTION 3 — BRAND: Replace "BookMyGame" with "SpörtoBook" everywhere
   ════════════════════════════════════════════════════════════════════ */
(function brandFix() {
  var TEXT_MAP = [
    ['BookMyGame', 'SpörtoBook'], ['bookmygame', 'sportobook'],
    ['Book My Game', 'SpörtoBook'], ['BOOKMYGAME', 'SPORTOBOOK'],
  ];

  function replaceTextNodes(root) {
    var walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT, null, false);
    var node;
    while ((node = walker.nextNode())) {
      var val = node.nodeValue;
      if (!val || !val.includes('Book')) continue;
      var r = val;
      TEXT_MAP.forEach(function (p) { r = r.split(p[0]).join(p[1]); });
      if (r !== val) node.nodeValue = r;
    }
  }

  function patchLogos() {
    document.querySelectorAll('.main-header .logo, .main-header h1, .auth-header h1').forEach(function (el) {
      if (el.textContent && el.textContent.toLowerCase().includes('book')) {
        el.innerHTML = 'Sp\u00f6rto<span>Book</span>';
      }
    });
  }

  function patchSplashText() {
    var splash = document.getElementById('splash-screen');
    if (!splash) return;
    splash.querySelectorAll('img, .splash-icon, .splash-logo-icon, .brand-logo').forEach(function (el) {
      if (!el.closest('.splash-benefit-card') && !el.closest('.splash-sport-visual')) el.remove();
    });
    var title = splash.querySelector('.splash-title, h1');
    if (title && title.textContent.toLowerCase().includes('book')) {
      title.querySelectorAll('i, img').forEach(function (el) { el.remove(); });
      title.innerHTML = 'Sp\u00f6rto<span>Book</span>';
    }
  }

  function runBrand() {
    replaceTextNodes(document.body);
    patchLogos();
    patchSplashText();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runBrand);
  } else {
    runBrand();
  }

  // Persistent observer — catches dynamic injections
  var _timer = null;
  new MutationObserver(function (mutations) {
    var needs = mutations.some(function (m) {
      return Array.from(m.addedNodes).some(function (n) { return n.textContent && n.textContent.includes('Book'); });
    });
    if (!needs) return;
    clearTimeout(_timer);
    _timer = setTimeout(function () { replaceTextNodes(document.body); patchLogos(); }, 60);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();


/* ════════════════════════════════════════════════════════════════════
   SECTION 4 — FREE LISTING: owners never pay registration fee
   ════════════════════════════════════════════════════════════════════ */
(function freeListing() {
  var BANNER_SELECTORS = [
    '#owner-reg-payment-banner', '#plot-owner-payment-banner',
    '.owner-reg-payment-banner', '.payment-required-banner',
    '.pay-owner-fee-btn', '#pay-owner-reg-fee-btn',
    '#pay-registration-now', '#complete-registration-btn', '#owner-verification-status',
  ];
  var FEE_TEXT_MAP = [
    [/Pay\s*₹\s*\d+\s*Now/gi, 'Add Ground Free'],
    [/Pay\s*₹\s*(499|5|299)\s*(once)?/gi, 'Free'],
    [/₹\s*(499|5|299)\s*registration fee/gi, 'Free Registration'],
    [/Complete Registration \(₹\d+\)/gi, 'Continue'],
    [/Locked \(Pay ₹\d+\)/gi, 'Active'],
  ];
  var _activatedUids = {};

  function hideBanners() {
    BANNER_SELECTORS.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) {
        el.style.setProperty('display', 'none', 'important');
        el.setAttribute('aria-hidden', 'true');
      });
    });
    document.querySelectorAll('[class*="payment-banner"], [class*="reg-banner"]').forEach(function (el) {
      if (/₹\s*\d|pay.*fee|registration fee|complete registration/i.test(el.textContent || '')) {
        el.style.setProperty('display', 'none', 'important');
      }
    });
  }

  function cleanFeeText(root) {
    var walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT, null, false);
    var node;
    while ((node = walker.nextNode())) {
      var v = node.nodeValue;
      if (!v) continue;
      var r = v;
      FEE_TEXT_MAP.forEach(function (pair) { r = r.replace(pair[0], pair[1]); });
      if (r !== v) node.nodeValue = r;
    }
  }

  async function activateOwnerInFirestore(uid) {
    if (!uid || _activatedUids[uid] || !window.db) return;
    _activatedUids[uid] = true;
    try {
      var ownerRef = window.db.collection('owners').doc(uid);
      var snap = await ownerRef.get();
      if (!snap.exists) return;
      var data = snap.data() || {};
      if (data.registrationPaid && data.registrationVerified) return;
      await ownerRef.update({
        registrationPaid: true, registrationVerified: true,
        registrationAutoApproved: true, registrationAmount: 0,
        registrationAutoApprovedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      if (window.currentUser && window.currentUser.uid === uid) {
        window.currentUser.registrationPaid = true;
        window.currentUser.registrationVerified = true;
      }
    } catch (_) {}
  }

  function ensureCurrentUserActivated() {
    var u = window.currentUser;
    if (u && u.role === 'owner') {
      u.registrationPaid = true;
      u.registrationVerified = true;
      activateOwnerInFirestore(u.uid);
    }
  }

  function patchCanAddGround() {
    var _free = async function () {
      var u = window.currentUser;
      if (!u || u.role !== 'owner') return false;
      activateOwnerInFirestore(u.uid);
      return true;
    };
    _free._spbFree = true;
    window.canAddGround = _free;
  }

  function patchUpdateOwnerStatus() {
    var _orig = window.updateOwnerRegistrationStatus;
    window.updateOwnerRegistrationStatus = function () {
      if (typeof _orig === 'function') { try { _orig(); } catch (_) {} }
      hideBanners();
    };
  }

  // Boot
  hideBanners();
  patchCanAddGround();

  function boot() {
    patchCanAddGround();
    patchUpdateOwnerStatus();
    hideBanners();
    cleanFeeText(document.body);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Intercept add-ground button clicks
  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('#add-ground-btn, #add-ground-btn-primary, .add-ground-btn') : null;
    if (btn) ensureCurrentUserActivated();
  }, true);

  // Auth listener
  (function waitFirebase() {
    if (window.firebase && typeof window.firebase.auth === 'function') {
      window.firebase.auth().onAuthStateChanged(function (user) {
        if (!user) return;
        setTimeout(function () {
          ensureCurrentUserActivated();
          patchCanAddGround();
          patchUpdateOwnerStatus();
          hideBanners();
          cleanFeeText(document.body);
        }, 800);
      });
    } else { setTimeout(waitFirebase, 300); }
  })();

  // Persistent observer
  var _obs = new MutationObserver(_SPB.debounce(function (mutations) {
    var relevant = mutations.some(function (m) {
      return Array.from(m.addedNodes).some(function (n) {
        return n.textContent && /₹\s*\d|pay.*fee|complete registration/i.test(n.textContent);
      });
    });
    if (!relevant) return;
    hideBanners();
    cleanFeeText(document.body);
    ensureCurrentUserActivated();
    if (!window.canAddGround || !window.canAddGround._spbFree) patchCanAddGround();
  }, 60));
  if (document.body) {
    _obs.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      _obs.observe(document.body, { childList: true, subtree: true });
    });
  }

  window.addEventListener('bmg:pageShown', function (e) {
    if (/owner|dashboard|ground|profile/i.test((e.detail && e.detail.pageId) || '')) {
      setTimeout(function () {
        hideBanners(); cleanFeeText(document.body); ensureCurrentUserActivated();
        if (!window.canAddGround || !window.canAddGround._spbFree) patchCanAddGround();
        if (typeof window.updateOwnerRegistrationStatus === 'function') window.updateOwnerRegistrationStatus();
      }, 150);
    }
  });
})();


/* ════════════════════════════════════════════════════════════════════
   SECTION 5 — PROFILE IMAGE & AVATAR
   ════════════════════════════════════════════════════════════════════ */
(function profileAvatar() {
  var APP_LOGO_SVG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'%3E%3Ccircle cx='40' cy='40' r='40' fill='%234F46E5'/%3E%3Ctext x='40' y='50' font-family='Inter,Arial,sans-serif' font-size='30' font-weight='800' fill='white' text-anchor='middle'%3ESB%3C/text%3E%3C/svg%3E";

  function fixBrokenImages() {
    document.querySelectorAll('img').forEach(function (img) {
      if (!img.src || img.src.includes('via.placeholder') || img.src.includes('placeholder.com')) {
        img.src = APP_LOGO_SVG;
      }
    });
    var headerImg = document.getElementById('header-profile-img');
    if (headerImg && (!headerImg.src || headerImg.src.includes('placeholder'))) {
      headerImg.src = APP_LOGO_SVG;
    }
    var profileImgLarge = document.getElementById('profile-image-large');
    if (profileImgLarge && (!profileImgLarge.src || profileImgLarge.src.includes('placeholder'))) {
      profileImgLarge.src = APP_LOGO_SVG;
    }
    var changePhotoBtn = document.getElementById('change-photo-btn');
    if (changePhotoBtn) changePhotoBtn.style.display = 'none';
  }

  // Global image error handler
  document.addEventListener('error', function (e) {
    if (e.target && e.target.tagName === 'IMG' && !e.target.dataset.fallbackApplied) {
      e.target.dataset.fallbackApplied = '1';
      e.target.src = APP_LOGO_SVG;
    }
  }, true);

  // Animated initials avatar for header
  function getInitials(user) {
    if (!user) return 'SB';
    var name = user.name || user.displayName || user.email || '';
    var parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0] ? parts[0].slice(0, 2).toUpperCase() : 'SB';
  }

  function refreshAvatar() {
    var user = window.currentUser;
    var btn = document.getElementById('header-profile-btn') || document.querySelector('.profile-header-btn');
    if (!btn) return;
    if (btn.querySelector('.spb-avatar')) return;
    var initials = getInitials(user);
    var avatar = document.createElement('div');
    avatar.className = 'spb-avatar';
    avatar.innerHTML = '<span>' + initials + '</span><span class="spb-avatar-ripple"></span>';
    var img = btn.querySelector('img');
    if (img) img.style.display = 'none';
    btn.prepend(avatar);
  }

  if (document.readyState !== 'loading') {
    fixBrokenImages();
  } else {
    document.addEventListener('DOMContentLoaded', fixBrokenImages);
  }

  window.addEventListener('bmg:pageShown', function (e) {
    fixBrokenImages();
    if (e.detail && e.detail.pageId === 'profile-page') {
      setTimeout(fixBrokenImages, 200);
    }
    setTimeout(refreshAvatar, 150);
  });
  window._spbRefreshAvatar = refreshAvatar;
})();


/* ════════════════════════════════════════════════════════════════════
   SECTION 6 — QR SCANNER (owners only gate)
   ════════════════════════════════════════════════════════════════════ */
(function qrScannerGate() {
  function syncQrScanner() {
    var btn = document.getElementById('header-qr-scanner');
    if (!btn) return;
    var cu = window.currentUser;
    var isOwner = cu && (cu.role === 'owner' || cu.role === 'admin' || cu.role === 'ceo');
    btn.style.display = isOwner ? 'flex' : 'none';
    btn.style.visibility = isOwner ? 'visible' : 'hidden';
  }

  function patchQRScannerOpen() {
    var fnName = window.openProfessionalQRScanner ? 'openProfessionalQRScanner' : 'toggleProfessionalQRScanner';
    var origOpen = window[fnName];
    if (typeof origOpen !== 'function' || origOpen._spbGated) return;
    window[fnName] = function () {
      var cu = window.currentUser;
      if (!cu || (cu.role !== 'owner' && cu.role !== 'admin' && cu.role !== 'ceo')) {
        _SPB.toast('Only venue/ground owners can scan QR codes', 'error');
        return;
      }
      return origOpen.apply(this, arguments);
    };
    window[fnName]._spbGated = true;
  }

  window.addEventListener('bmg:pageShown', function () {
    syncQrScanner();
    patchQRScannerOpen();
  });

  setInterval(syncQrScanner, 600);
  setTimeout(patchQRScannerOpen, 1000);
})();


/* ════════════════════════════════════════════════════════════════════
   SECTION 7 — LOCATION: Full address reverse geocode + auto-load
   ════════════════════════════════════════════════════════════════════ */
(function patchGetUserLocation() {
  function _doPatch() {
    if (window.getUserLocation && window.getUserLocation._spbPatched) return;
    window.getUserLocation = function () {
      if (!navigator.geolocation) {
        var el = document.getElementById('current-location');
        if (el) el.textContent = 'Geolocation not supported';
        return;
      }
      navigator.geolocation.getCurrentPosition(
        async function (position) {
          window.userLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
          try { localStorage.setItem('userLocation', JSON.stringify(window.userLocation)); } catch (_) {}
          try {
            var res = await fetch('https://nominatim.openstreetmap.org/reverse?format=json&lat=' + window.userLocation.lat + '&lon=' + window.userLocation.lng + '&zoom=18&addressdetails=1');
            var data = await res.json();
            var locationText = '';
            if (data.address) {
              var parts = [];
              var road   = data.address.road || data.address.pedestrian || '';
              var suburb = data.address.suburb || data.address.neighbourhood || '';
              var city   = data.address.city || data.address.town || data.address.village || '';
              var state  = data.address.state || '';
              if (road) parts.push(road);
              if (suburb && suburb !== road) parts.push(suburb);
              if (city) parts.push(city);
              if (state && state !== city) parts.push(state);
              locationText = parts.join(', ') || 'Location detected';
            } else {
              locationText = window.userLocation.lat.toFixed(4) + ', ' + window.userLocation.lng.toFixed(4);
            }
            var el = document.getElementById('current-location');
            if (el) el.textContent = locationText;
          } catch (_) {
            var el2 = document.getElementById('current-location');
            if (el2) el2.textContent = window.userLocation.lat.toFixed(4) + ', ' + window.userLocation.lng.toFixed(4);
          }
          if (typeof window.loadNearbyVenues === 'function') window.loadNearbyVenues();
        },
        function (err) {
          var el = document.getElementById('current-location');
          if (el) el.textContent = 'Location unavailable';
          try { var c = localStorage.getItem('userLocation'); if (c) window.userLocation = JSON.parse(c); } catch (_) {}
          if (typeof window.loadNearbyVenues === 'function') window.loadNearbyVenues();
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
      );
    };
    window.getUserLocation._spbPatched = true;
  }
  _SPB.waitFor(function () { return true; }, 100).then(_doPatch); // run immediately
  setTimeout(_doPatch, 500);
})();


/* ════════════════════════════════════════════════════════════════════
   SECTION 8 — CITY SEARCH: smart client-side + Firestore filter
   ════════════════════════════════════════════════════════════════════ */
(function patchCitySearch() {
  function smartSearch(raw) {
    var container = document.getElementById('nearby-venues');
    if (!container || !window.db) return;
    var q = raw.toLowerCase();

    container.innerHTML = '<div class="skeleton-loading"><div class="skeleton-card"></div><div class="skeleton-card"></div></div>';

    window.db.collection('grounds').where('status', '==', 'active').limit(200).get()
      .then(function (snap) {
        var results = [];
        snap.forEach(function (doc) {
          var d = Object.assign({ id: doc.id, type: 'ground' }, doc.data());
          var haystack = [
            d.groundName, d.city, d.cityLower, d.sportType, d.address, d.area
          ].filter(Boolean).join(' ').toLowerCase();
          if (haystack.includes(q)) results.push(d);
        });

        if (results.length === 0) {
          container.innerHTML = '<div class="spb-empty-state" style="text-align:center;padding:40px 20px;color:#888;flex:0 0 100%;width:100%;"><div style="font-size:48px;margin-bottom:12px;">🔍</div><p style="font-weight:700;font-size:16px;color:#444;">No grounds found</p><p style="font-size:13px;">Try a different city or sport</p></div>';
          return;
        }
        if (typeof window.displayVenueItems === 'function') {
          window.displayVenueItems(container, results);
        } else {
          // fallback render
          container.innerHTML = results.slice(0, 20).map(function (g) {
            return '<div class="bmg-venue-card" data-id="' + g.id + '" data-type="ground" style="cursor:pointer;padding:16px;background:#fff;border-radius:16px;margin-bottom:12px;min-width:175px;">' +
              '<div style="font-weight:700;font-size:15px;">' + _SPB.esc(g.groundName || 'Ground') + '</div>' +
              '<div style="font-size:12px;color:#666;">' + _SPB.esc(g.city || '') + ' · ' + _SPB.esc(g.sportType || '') + '</div>' +
              '</div>';
          }).join('');
          container.querySelectorAll('.bmg-venue-card[data-id]').forEach(function (card) {
            card.addEventListener('click', function () { if (typeof window.viewGround === 'function') window.viewGround(card.dataset.id); });
          });
        }
      })
      .catch(function (err) {
        console.error('[spb-search]', err);
        container.innerHTML = '<p style="padding:20px;color:#888;">Search unavailable. Try again.</p>';
      });
  }

  function wireCitySearch() {
    var searchInput = document.getElementById('global-search');
    if (!searchInput || searchInput._spbSearchWired) return;
    searchInput._spbSearchWired = true;
    searchInput.placeholder = 'Search city, sport or ground name…';
    searchInput.addEventListener('input', _SPB.debounce(function () {
      var query = searchInput.value.trim();
      if (!query) {
        if (typeof window.loadNearbyVenues === 'function') window.loadNearbyVenues();
        return;
      }
      smartSearch(query);
    }, 350));
  }

  window.filterBySport = function (sport) {
    var inp = document.getElementById('global-search');
    if (inp) { inp.value = sport; inp.dispatchEvent(new Event('input', { bubbles: true })); }
  };

  if (document.readyState !== 'loading') { wireCitySearch(); }
  else { document.addEventListener('DOMContentLoaded', wireCitySearch); }
  window.addEventListener('bmg:pageShown', function (e) {
    if (!e.detail || e.detail.pageId === 'main-page' || e.detail.pageId === 'home-page') {
      setTimeout(wireCitySearch, 100);
    }
  });
})();


/* ════════════════════════════════════════════════════════════════════
   SECTION 9 — SWIPE CARDS: displayVenueItems + loadNearbyVenues
   ════════════════════════════════════════════════════════════════════ */
(function swipeCards() {
  var SPORT_EMOJI = { football: '⚽', cricket: '🏏', basketball: '🏀', badminton: '🏸', tennis: '🎾', volleyball: '🏐', swimming: '🏊', default: '🏟️' };

  function sportEmoji(s) {
    if (!s) return SPORT_EMOJI.default;
    var key = s.toLowerCase().split(/[\s/]/)[0];
    return SPORT_EMOJI[key] || SPORT_EMOJI.default;
  }

  function renderSwipeCards(container, items) {
    if (!items || !items.length) {
      container.innerHTML = '<div class="spb-empty-state" style="text-align:center;padding:40px;flex:0 0 100%;"><i class="fas fa-map-marker-alt" style="font-size:2rem;color:#cbd5e1;margin-bottom:12px;display:block;"></i><h3>No grounds nearby</h3><p style="color:#94a3b8;font-size:13px;">Try searching a different city</p></div>';
      return;
    }
    container.innerHTML = items.map(function (item) {
      var isGround = item.type === 'ground' || item.groundName;
      var name  = _SPB.esc(isGround ? (item.groundName || item.name || 'Ground') : (item.venueName || item.name || 'Venue'));
      var sport = _SPB.esc(item.sportType || item.sport || 'Multi-sport');
      var img   = (item.images && item.images[0]) || item.imageUrl || item.photo || '';
      var discount = Number(item.discountPercent || item.discount || 0);
      var origPrice = Number(item.originalPrice || item.pricePerHour || 0);
      var dispPrice = discount > 0 ? Math.round(origPrice * (1 - discount / 100)) : origPrice;
      var da = isGround ? 'data-ground-id="' + item.id + '"' : 'data-venue-id="' + item.id + '"';

      return '<div class="spb-gcard" ' + da + ' data-type="' + item.type + '">' +
        '<div class="spb-gcard-img">' +
          (img ? '<img src="' + _SPB.esc(img) + '" alt="' + name + '" style="width:100%;height:110px;object-fit:cover;" onerror="this.parentNode.innerHTML=\'<span style=font-size:2rem>\' + sportEmoji(item.sportType) + \'</span>\'">' : '<span style="font-size:2rem;">' + sportEmoji(item.sportType) + '</span>') +
          (discount > 0 ? '<div class="spb-gcard-discount-badge">' + discount + '% OFF</div>' : '') +
        '</div>' +
        '<div class="spb-gcard-body">' +
          '<div class="spb-gcard-name">' + name + '</div>' +
          '<div class="spb-gcard-sport">' + sport + '</div>' +
          '<div class="spb-gcard-price-row">' +
            (dispPrice ? '<span class="spb-gcard-price">₹' + dispPrice + '/hr</span>' : '') +
            (discount > 0 && origPrice ? '<span class="spb-gcard-orig">₹' + origPrice + '</span>' : '') +
          '</div>' +
          '<button class="spb-book-btn">View &amp; Book</button>' +
        '</div>' +
      '</div>';
    }).join('');

    // Wire click events
    container.querySelectorAll('.spb-gcard[data-ground-id]').forEach(function (card) {
      card.addEventListener('click', function () { if (typeof window.viewGround === 'function') window.viewGround(card.dataset.groundId); });
    });
    container.querySelectorAll('.spb-gcard[data-venue-id]').forEach(function (card) {
      card.addEventListener('click', function () { if (typeof window.viewVenue === 'function') window.viewVenue(card.dataset.venueId); });
    });
    container.querySelectorAll('.spb-book-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var card = btn.closest('.spb-gcard');
        if (!card) return;
        if (card.dataset.groundId && typeof window.viewGround === 'function') window.viewGround(card.dataset.groundId);
        else if (card.dataset.venueId && typeof window.viewVenue === 'function') window.viewVenue(card.dataset.venueId);
      });
    });

    // Mouse-drag scroll
    var isDown = false, startX, scrollLeft;
    container.addEventListener('mousedown', function (e) { isDown = true; startX = e.pageX - container.offsetLeft; scrollLeft = container.scrollLeft; container.style.cursor = 'grabbing'; });
    container.addEventListener('mouseleave', function () { isDown = false; container.style.cursor = ''; });
    container.addEventListener('mouseup', function () { isDown = false; container.style.cursor = ''; });
    container.addEventListener('mousemove', function (e) { if (!isDown) return; e.preventDefault(); var x = e.pageX - container.offsetLeft; container.scrollLeft = scrollLeft - (x - startX); });
  }

  // Override displayVenueItems globally
  window.displayVenueItems = function (container, items) {
    renderSwipeCards(container, items);
  };
  window.displayVenueItems._spbSwipe = true;

  // Override loadNearbyVenues — loads ALL grounds, no limit
  function patchLoadNearbyVenues() {
    if (window.loadNearbyVenues && window.loadNearbyVenues._spbBrandPatched) return;
    var _orig = window.loadNearbyVenues;

    window.loadNearbyVenues = async function () {
      var container = document.getElementById('nearby-venues');
      if (!container || !window.db) {
        if (typeof _orig === 'function') return _orig();
        return;
      }
      container.innerHTML = '<div class="skeleton-loading" style="flex:0 0 100%;"><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div></div>';
      try {
        var C = window.COLLECTIONS || { VENUES: 'venues', GROUNDS: 'grounds' };
        var snaps = await Promise.all([
          window.db.collection(C.VENUES || 'venues').where('hidden', '==', false).get().catch(function () { return { forEach: function () {}, docs: [] }; }),
          window.db.collection(C.GROUNDS || 'grounds').where('status', '==', 'active').get().catch(function () { return { forEach: function () {}, docs: [] }; })
        ]);
        var all = [];
        snaps[0].forEach(function (d) { all.push(Object.assign({ id: d.id, type: 'venue' }, d.data())); });
        snaps[1].forEach(function (d) { all.push(Object.assign({ id: d.id, type: 'ground', ownerType: 'plot_owner' }, d.data())); });
        renderSwipeCards(container, all);
      } catch (err) {
        console.error('[spb-venues]', err);
        if (typeof _orig === 'function') _orig();
        else container.innerHTML = '<div class="error-state"><p>Failed to load venues</p></div>';
      }
    };
    window.loadNearbyVenues._spbBrandPatched = true;
  }

  _SPB.waitFor(function () { return typeof window.loadNearbyVenues === 'function'; }, 6000).then(patchLoadNearbyVenues);
  setTimeout(patchLoadNearbyVenues, 300);
  window.addEventListener('bmg:pageShown', function (e) {
    if (!e.detail || e.detail.pageId === 'main-page' || e.detail.pageId === 'home-page') {
      setTimeout(function () {
        patchLoadNearbyVenues();
        // Fix nearby card delegation
        var container = document.getElementById('nearby-venues');
        if (container) {
          container.querySelectorAll('.bmg-venue-card[data-id]').forEach(function (card) {
            if (card._spbWired) return;
            card._spbWired = true;
            card.addEventListener('click', function () {
              var id = card.dataset.id;
              var type = card.dataset.type;
              if (type === 'venue' && typeof window.viewVenue === 'function') window.viewVenue(id);
              else if (typeof window.viewGround === 'function') window.viewGround(id);
            });
          });
        }
      }, 100);
    }
  });
})();


/* ════════════════════════════════════════════════════════════════════
   SECTION 10 — USER REGISTRATION (no pre-check + city field)
   ════════════════════════════════════════════════════════════════════ */
(function patchUserRegistration() {
  function doPatch() {
    if (typeof window.handleUserRegister !== 'function') return false;
    if (window.handleUserRegister._spbPatched) return true;

    window.handleUserRegister = async function patchedRegister(e) {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      var name    = (document.getElementById('reg-name')?.value || '').trim();
      var email   = (document.getElementById('reg-email')?.value || '').trim();
      var phone   = (document.getElementById('reg-phone')?.value || '').trim();
      var city    = (document.getElementById('reg-city')?.value || '').trim();
      var pass    = document.getElementById('reg-password')?.value || '';
      var confirm = document.getElementById('reg-confirm-password')?.value || '';
      var agreed  = document.getElementById('reg-agree-terms')?.checked;

      if (!name || !email || !phone || !pass) { _SPB.toast('Please fill in all fields', 'error'); return; }
      if (pass !== confirm) { _SPB.toast('Passwords do not match', 'error'); return; }
      if (pass.length < 6) { _SPB.toast('Password must be at least 6 characters', 'error'); return; }
      if (!/^\d{10}$/.test(phone)) { _SPB.toast('Please enter a valid 10-digit phone number', 'error'); return; }
      if (!agreed) { _SPB.toast('Please agree to the Terms & Conditions', 'error'); return; }

      if (typeof window.showLoading === 'function') window.showLoading('Creating your account…');
      try {
        var auth = window.auth || (window.firebase && window.firebase.auth && window.firebase.auth());
        var db   = window.db;
        if (!auth || !db) throw new Error('App not initialised yet. Please refresh.');

        var userCredential = await auth.createUserWithEmailAndPassword(email, pass);
        var user = userCredential.user;

        // Referral
        var urlParams = new URLSearchParams(window.location.search);
        var refCode = urlParams.get('ref');
        var referredBy = null;
        if (refCode) {
          try {
            var refSnap = await db.collection('referrals').where('code', '==', refCode).get();
            if (!refSnap.empty) referredBy = refSnap.docs[0].data().ownerId;
          } catch (_) {}
        }
        var genCode = typeof window.generateReferralCode === 'function'
          ? window.generateReferralCode()
          : 'SB' + Math.random().toString(36).substr(2, 6).toUpperCase();

        var userData = {
          uid: user.uid, name: name, email: email, phone: phone,
          city: city || '', cityLower: (city || '').toLowerCase(),
          profileImage: null, role: 'user',
          referralCode: genCode, referredBy: referredBy, referralCount: 0,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        await db.collection('users').doc(user.uid).set(userData);
        await user.updateProfile({ displayName: name });

        if (referredBy) {
          try {
            await db.collection('referrals').add({ code: genCode, userId: user.uid, userName: name, referredBy: referredBy, status: 'pending', createdAt: firebase.firestore.FieldValue.serverTimestamp() });
            await db.collection('owners').doc(referredBy).update({ referralCount: firebase.firestore.FieldValue.increment(1) });
          } catch (_) {}
        }
        if (typeof window.hideLoading === 'function') window.hideLoading();
        _SPB.toast('Account created successfully! Welcome to SpörtoBook!', 'success');
      } catch (err) {
        if (typeof window.hideLoading === 'function') window.hideLoading();
        var msg = 'Registration failed. Please try again.';
        if (err.code === 'auth/email-already-in-use') msg = 'Email already registered. Please login instead.';
        else if (err.code === 'auth/weak-password') msg = 'Password is too weak.';
        else if (err.code === 'auth/invalid-email') msg = 'Invalid email address.';
        else if (err.message) msg = err.message;
        _SPB.toast(msg, 'error');
      }
    };
    window.handleUserRegister._spbPatched = true;
    window.handleRegister = window.handleUserRegister;

    // Add city field to form if not already present
    var regForm = document.getElementById('user-registration-form');
    if (regForm && !document.getElementById('reg-city')) {
      var phoneField = document.querySelector('#reg-phone') && document.querySelector('#reg-phone').parentElement;
      if (phoneField) {
        var div = document.createElement('div');
        div.id = 'reg-city-group';
        div.innerHTML = '<label for="reg-city" style="display:block;margin-bottom:8px;font-weight:600;color:var(--text-primary,#1e293b);">City</label><input type="text" id="reg-city" placeholder="Enter your city (e.g. Delhi, Noida)" style="width:100%;padding:12px 16px;border:1px solid var(--border-color,#e2e8f0);border-radius:10px;font-size:1rem;" /><small style="color:#6b7280;display:block;margin-top:4px;">Helps us show grounds in your area</small>';
        phoneField.insertAdjacentElement('afterend', div);
      }
    }
    return true;
  }

  _SPB.waitFor(function () { return typeof window.handleUserRegister === 'function'; }, 6000).then(doPatch);
  setTimeout(doPatch, 2500);
})();


/* ════════════════════════════════════════════════════════════════════
   SECTION 11 — ADD/EDIT GROUND: city + discount field injection
   ════════════════════════════════════════════════════════════════════ */
(function groundForms() {
  // handleAddGround — inject city + discount into Firestore doc
  function patchHandleAddGround() {
    if (typeof window.handleAddGround !== 'function') return;
    if (window.handleAddGround._spbPatched) return;
    var _orig = window.handleAddGround;
    window.handleAddGround = async function (e) {
      if (e && e.preventDefault) e.preventDefault();
      var cityInput = document.getElementById('ground-city-input');
      var cityVal = cityInput ? cityInput.value.trim() : '';
      var discInput = document.getElementById('add-ground-discount');
      var discPct = discInput ? Math.min(90, Math.max(0, Number(discInput.value) || 0)) : 0;

      // One-shot patch on grounds collection .add to inject city + discount
      var col = window.db && window.db.collection('grounds');
      if (col) {
        var _origAdd = col.add.bind(col);
        col.add = async function (data) {
          col.add = _origAdd; // restore immediately
          var price = Number(data.pricePerHour || 0);
          return _origAdd(Object.assign({}, data, {
            city: cityVal, cityLower: cityVal.toLowerCase(),
            discountPercent: discPct,
            originalPrice: price,
            discountedPrice: discPct > 0 ? Math.round(price * (1 - discPct / 100)) : price,
          }));
        };
      }
      return _orig.call(this, e);
    };
    window.handleAddGround._spbPatched = true;
  }

  // handleEditGround — persist discount
  function patchHandleEditGround() {
    if (typeof window.handleEditGround !== 'function') return;
    if (window.handleEditGround._spbDiscountPatch) return;
    var _orig = window.handleEditGround;
    window.handleEditGround = async function (e) {
      if (e && e.preventDefault) e.preventDefault();
      var discInput = document.getElementById('edit-ground-discount');
      var discPct = discInput ? Math.min(90, Math.max(0, Number(discInput.value) || 0)) : null;
      var priceInput = document.getElementById('edit-ground-price');
      var price = priceInput ? Number(priceInput.value) || 0 : 0;

      if (discPct !== null && window.db && window._currentEditGroundId) {
        try {
          await window.db.collection('grounds').doc(window._currentEditGroundId).update({
            discountPercent: discPct,
            originalPrice: price,
            discountedPrice: discPct > 0 ? Math.round(price * (1 - discPct / 100)) : price,
          });
        } catch (_) {}
      }
      return _orig.call(this, e);
    };
    window.handleEditGround._spbDiscountPatch = true;
  }

  // showEditGroundModal — inject discount field
  function patchShowEditGroundModal() {
    if (typeof window.showEditGroundModal !== 'function') return;
    if (window.showEditGroundModal._spbDiscountPatch) return;
    var _orig = window.showEditGroundModal;
    window.showEditGroundModal = async function (groundId, groundName, currentPrice) {
      window._currentEditGroundId = groundId;
      await _orig.apply(this, arguments);
      await new Promise(function (r) { setTimeout(r, 80); });
      if (!document.getElementById('spb-edit-discount-group')) {
        var existingDiscount = 0;
        if (groundId && window.db) {
          try { var d = await window.db.collection('grounds').doc(groundId).get(); if (d.exists) existingDiscount = d.data().discountPercent || 0; } catch (_) {}
        }
        var priceGroup = document.querySelector('#edit-ground-price')?.closest('.form-group');
        if (priceGroup) {
          var div = document.createElement('div');
          div.id = 'spb-edit-discount-group';
          div.innerHTML = '<div id="spb-edit-discount-label"><i class="fas fa-tag"></i> Discount / Offer %</div>' +
            '<input type="number" id="edit-ground-discount" min="0" max="90" step="1" value="' + existingDiscount + '" placeholder="0 = no discount">' +
            '<div id="spb-discount-preview"></div>';
          priceGroup.insertAdjacentElement('afterend', div);
          var inp = document.getElementById('edit-ground-discount');
          inp && inp.addEventListener('input', function () {
            var disc = Math.min(90, Math.max(0, Number(inp.value) || 0));
            var priceInp = document.getElementById('edit-ground-price');
            var p = priceInp ? Number(priceInp.value) || 0 : Number(currentPrice) || 0;
            var preview = document.getElementById('spb-discount-preview');
            if (preview) {
              preview.innerHTML = disc > 0
                ? '₹' + p + ' → <strong>₹' + Math.round(p * (1 - disc / 100)) + '</strong> (' + disc + '% off)'
                : 'No discount';
            }
          });
        }
      }
    };
    window.showEditGroundModal._spbDiscountPatch = true;
  }

  _SPB.waitFor(function () { return typeof window.handleAddGround === 'function'; }, 6000).then(patchHandleAddGround);
  _SPB.waitFor(function () { return typeof window.handleEditGround === 'function'; }, 6000).then(patchHandleEditGround);
  _SPB.waitFor(function () { return typeof window.showEditGroundModal === 'function'; }, 6000).then(patchShowEditGroundModal);
  setTimeout(function () {
    patchHandleAddGround();
    patchHandleEditGround();
    patchShowEditGroundModal();
  }, 2000);
})();


/* ════════════════════════════════════════════════════════════════════
   SECTION 12 — QR GENERATOR (multi-strategy)
   ════════════════════════════════════════════════════════════════════ */
window._spbGenerateQR = async function (payload) {
  function _img(src) {
    var el = document.createElement('img');
    el.src = src; el.alt = 'QR Code'; el.style.cssText = 'width:220px;height:220px;display:block;border-radius:10px;';
    return el;
  }
  // Strategy A — qrcode@1.5.x .toDataURL
  if (typeof window.QRCode === 'function' && typeof window.QRCode.toDataURL === 'function') {
    try { return _img(await window.QRCode.toDataURL(payload, { width: 220, margin: 2, errorCorrectionLevel: 'L' })); } catch (_) {}
  }
  // Strategy B — qrcodejs DOM canvas
  if (typeof window.QRCode === 'function') {
    try {
      var div = document.createElement('div');
      div.style.cssText = 'position:absolute;left:-9999px;top:-9999px;';
      document.body.appendChild(div);
      new window.QRCode(div, { text: payload, width: 220, height: 220, correctLevel: (window.QRCode.CorrectLevel || {}).L || 3 });
      await new Promise(function (r) { setTimeout(r, 200); });
      var canvas = div.querySelector('canvas');
      var imgEl  = div.querySelector('img');
      var src = canvas ? canvas.toDataURL('image/png') : (imgEl ? imgEl.src : '');
      document.body.removeChild(div);
      if (src) return _img(src);
    } catch (_) {}
  }
  // Strategy C — Google Charts API
  try {
    var enc = encodeURIComponent(payload);
    var chartSrc = 'https://chart.googleapis.com/chart?cht=qr&chs=220x220&chld=L|2&chl=' + enc;
    return _img(chartSrc);
  } catch (_) {}
  // Strategy D — load qrcode library dynamically
  if (!window._spbQRLibLoaded) {
    try {
      await new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';
        s.onload = function () { window._spbQRLibLoaded = true; resolve(); };
        s.onerror = reject;
        document.head.appendChild(s);
      });
      if (window.QRCode && typeof window.QRCode.toDataURL === 'function') {
        return _img(await window.QRCode.toDataURL(payload, { width: 220, margin: 2, errorCorrectionLevel: 'L' }));
      }
    } catch (_) {}
  }
  // Fallback text box
  var box = document.createElement('div');
  box.style.cssText = 'width:220px;height:220px;display:flex;flex-direction:column;align-items:center;justify-content:center;border:2px dashed #4F46E5;border-radius:12px;padding:12px;text-align:center;color:#4F46E5;background:#EEF2FF;word-break:break-all;';
  box.innerHTML = '<i class="fas fa-qrcode" style="font-size:2rem;margin-bottom:8px;"></i><strong style="font-size:11px;">QR generation failed</strong><br><span style="font-size:8px;margin-top:4px;">' + _SPB.esc(payload.slice(0, 80)) + '…</span>';
  return box;
};


/* ════════════════════════════════════════════════════════════════════
   SECTION 13 — ENTRY PASS (showEntryPass — master v4)
   ════════════════════════════════════════════════════════════════════ */
(function patchEntryPass() {
  var SLOT_ICONS  = { available:'🟢', confirmed:'🔴', booked:'🔴', locked:'🔒', pending:'🔒', past:'⏳', closed:'🚫', selected:'✅' };
  var SLOT_LABELS = { available:'Available', confirmed:'Booked', booked:'Booked', locked:'Processing…', pending:'Processing…', past:'Time Passed', closed:'Closed', selected:'Selected' };

  function buildQRPayload(booking, bookingId) {
    var bid  = _SPB.getBookingId(booking, bookingId);
    var date = _SPB.getDate(booking);
    var slot = _SPB.getSlot(booking);
    var gid  = _SPB.getGroundId(booking);
    var now  = new Date();
    var validFrom = new Date(now.getTime() - 60000);
    var validTo   = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    try {
      var slotParts  = slot.replace(/\s/g, '').split('-');
      var startParts = (slotParts[0] || '00:00').split(':');
      var endParts   = (slotParts[1] || '01:00').split(':');
      var baseDate   = date !== '—' ? new Date(date) : new Date();
      if (isNaN(baseDate)) baseDate = new Date();
      validFrom = new Date(baseDate); validFrom.setHours(+startParts[0] || 0, (+startParts[1] || 0) - 15, 0, 0);
      if (validFrom < now) validFrom = new Date(now.getTime() - 60000);
      validTo = new Date(baseDate); validTo.setHours(+endParts[0] || 0, +endParts[1] || 0, 0, 0);
      validTo.setTime(validTo.getTime() + 60 * 60 * 1000);
    } catch (_) {}
    return JSON.stringify({ appId: 'BookMyGame', bookingId: bid, groundId: gid, date: date, slotTime: slot, validFrom: validFrom.toISOString(), validTo: validTo.toISOString(), userName: _SPB.getUserName(booking), groundName: _SPB.getGround(booking), v: 2 });
  }

  function doPatch() {
    if (window.showEntryPass && window.showEntryPass._spbV4) return true;

    window.showEntryPass = async function (bookingId) {
      if (!bookingId) { _SPB.toast('Booking ID missing', 'error'); return; }
      if (typeof window.showLoading === 'function') window.showLoading('Generating entry pass…');
      try {
        var db = window.db;
        if (!db) throw new Error('Database not initialised');
        var bookingDoc = null, pendingData = null;
        var cachedData = _SPB.loadCache(bookingId);
        try { var d = await db.collection('bookings').doc(bookingId).get(); if (d.exists) bookingDoc = Object.assign({ _docId: d.id }, d.data()); } catch (_) {}
        if (!bookingDoc) { try { var s1 = await db.collection('bookings').where('bookingId', '==', bookingId).limit(1).get(); if (!s1.empty) bookingDoc = Object.assign({ _docId: s1.docs[0].id }, s1.docs[0].data()); } catch (_) {} }
        if (!bookingDoc) { try { var s2 = await db.collection('bookings').where('orderId', '==', bookingId).limit(1).get(); if (!s2.empty) bookingDoc = Object.assign({ _docId: s2.docs[0].id }, s2.docs[0].data()); } catch (_) {} }
        try { var pp = await db.collection('pending_payments').doc(bookingId).get(); if (pp.exists) pendingData = pp.data(); } catch (_) {}

        var merged = _SPB.merge(bookingDoc || {}, _SPB.merge(pendingData || {}, cachedData || {}));
        if (!merged.bookingId) merged.bookingId = bookingId;

        var status = (merged.bookingStatus || merged.status || merged.paymentStatus || '').toLowerCase();
        var ok = /confirmed|paid|success/.test(status) || (!bookingDoc && (pendingData || cachedData));
        if (!ok) {
          if (typeof window.hideLoading === 'function') window.hideLoading();
          _SPB.toast('Entry pass only for confirmed bookings', 'warning');
          return;
        }

        _SPB.persist(merged, bookingId);
        var bid     = _SPB.getBookingId(merged, bookingId);
        var name    = _SPB.getUserName(merged);
        var ground  = _SPB.getGround(merged);
        var address = _SPB.getAddress(merged);
        var date    = _SPB.getDate(merged);
        var slot    = _SPB.getSlot(merged);
        var amount  = _SPB.fmt(merged.amount || merged.totalAmount || 0);

        // Valid window text
        var validFrom = '', validTo = '';
        try {
          var sp = slot.replace(/\s/g,'').split('-');
          var toHM = function(t){var a=t.split(':');return{h:+a[0]||0,m:+a[1]||0};};
          var fm = function(h,m){return(h<10?'0':'')+h+':'+(m<10?'0':'')+m;};
          var ss=toHM(sp[0]||'00:00'), ee=toHM(sp[1]||'01:00');
          var fh=ss.h, fm2=ss.m-15; if(fm2<0){fm2+=60;fh--;} if(fh<0)fh=0;
          validFrom=fm(fh,fm2); validTo=fm(ee.h,ee.m);
        } catch(_) {}

        var qrPayload = buildQRPayload(merged, bookingId);
        var qrEl = await window._spbGenerateQR(qrPayload);

        var container = document.getElementById('entry-pass-content');
        if (!container) {
          var page = document.getElementById('entry-pass-page');
          if (page) {
            container = document.createElement('div');
            container.id = 'entry-pass-content';
            page.appendChild(container);
          } else {
            if (typeof window.hideLoading === 'function') window.hideLoading();
            _SPB.toast('Entry pass page not found', 'error');
            return;
          }
        }

        var addressRow = address ? _SPB.epRow('Address', _SPB.esc(address), true) : '';
        var validityText = validTo
          ? 'Valid from ' + validFrom + ' to ' + validTo + ' on ' + _SPB.esc(date)
          : 'Valid on ' + _SPB.esc(date);

        container.innerHTML =
          '<div style="max-width:420px;margin:0 auto;border-radius:18px;overflow:hidden;box-shadow:0 8px 32px rgba(79,70,229,.18);">' +
            '<div style="text-align:center;padding:20px 16px;background:linear-gradient(135deg,#1e3a8a,#4F46E5,#7C3AED);color:#fff;">' +
              '<h2 style="margin:0;font-size:1.4rem;font-weight:800;">Sp\u00f6rto<span style="opacity:.85">Book</span></h2>' +
              '<p style="margin:3px 0 0;opacity:.8;font-size:.82rem;letter-spacing:.05em;">ENTRY PASS</p>' +
            '</div>' +
            '<div style="padding:16px 20px;background:#fff;">' +
              _SPB.epRow('Booking ID', '<code style="font-size:.75rem;word-break:break-all;">' + _SPB.esc(bid) + '</code>') +
              _SPB.epRow('Name', _SPB.esc(name)) +
              _SPB.epRow('Ground', _SPB.esc(ground)) +
              addressRow +
              _SPB.epRow('Date', _SPB.esc(date)) +
              _SPB.epRow('Slot', _SPB.esc(slot)) +
              _SPB.epRow('Amount', _SPB.esc(amount)) +
              _SPB.epRow('Status', '<span style="color:#16a34a;font-weight:700;">&#10003; CONFIRMED</span>') +
            '</div>' +
            '<div id="spb-qr-mount" style="display:flex;flex-direction:column;align-items:center;padding:20px 16px 10px;background:#fff;border-top:1px solid #F1F5F9;"></div>' +
            '<div style="text-align:center;padding:6px 16px 16px;background:#fff;font-size:.72rem;color:#64748B;">' +
              '<i class="fas fa-clock" style="margin-right:4px;"></i>' + validityText +
            '</div>' +
          '</div>' +
          '<button id="spb-ep-back" style="display:block;width:100%;max-width:420px;margin:14px auto 0;padding:14px;background:linear-gradient(135deg,#4F46E5,#7C3AED);color:#fff;border:none;border-radius:14px;font-size:1rem;font-weight:700;cursor:pointer;">\u2190 Back to Home</button>';

        var qrMount = document.getElementById('spb-qr-mount');
        if (qrMount) {
          qrMount.appendChild(qrEl);
          var lbl = document.createElement('p');
          lbl.style.cssText = 'font-size:.7rem;color:#94A3B8;margin:6px 0 0;text-align:center;';
          lbl.textContent = 'Show to venue staff for scan verification';
          qrMount.appendChild(lbl);
        }
        document.getElementById('spb-ep-back')?.addEventListener('click', function () {
          if (typeof window.goHome === 'function') window.goHome();
        });

        if (typeof window.hideLoading === 'function') window.hideLoading();
        if (typeof window.showPage === 'function') window.showPage('entry-pass-page');
      } catch (err) {
        console.error('[spb-entrypass]', err);
        if (typeof window.hideLoading === 'function') window.hideLoading();
        _SPB.toast(err.message || 'Error generating entry pass', 'error');
      }
    };
    window.showEntryPass._spbV4 = true;

    window.showEntryPassFromConfirmation = function () {
      var detailsEl = document.getElementById('confirmation-details');
      var bid = ((detailsEl && detailsEl.dataset && detailsEl.dataset.bookingId) || '').trim();
      if (!bid) bid = sessionStorage.getItem('spb_lastConfirmedBookingId') || '';
      if (!bid) { var c = _SPB.loadCache(null); if (c) bid = c.bookingId || ''; }
      if (bid) window.showEntryPass(bid);
      else _SPB.toast('Booking not found. Check "My Bookings".', 'warning');
    };
    return true;
  }

  _SPB.waitFor(function () { return typeof window.showEntryPass === 'function' || true; }, 6000).then(doPatch);
  setTimeout(doPatch, 2500);
  window.addEventListener('bmg:pageShown', doPatch);
})();


/* ════════════════════════════════════════════════════════════════════
   SECTION 14 — QR VERIFICATION (processVerifiedQRCode — master v4)
   ════════════════════════════════════════════════════════════════════ */
(function patchQRVerification() {
  function doPatch() {
    if (window.processVerifiedQRCode && window.processVerifiedQRCode._spbV4) return true;

    var _orig = window.processVerifiedQRCode;

    window.processVerifiedQRCode = async function (qrData) {
      var db = window.db;
      if (!db && typeof _orig === 'function') return _orig(qrData);

      var qrObject = null;
      // Try JSON
      try { qrObject = JSON.parse(qrData); } catch (_) {}
      // Try SPB|pipe token
      if (!qrObject && typeof qrData === 'string' && qrData.startsWith('SPB|')) {
        var parts = qrData.split('|');
        if (parts.length >= 4) {
          var rawDate = parts[2] || '';
          var isoDate = rawDate.length === 8 ? rawDate.slice(0,4)+'-'+rawDate.slice(4,6)+'-'+rawDate.slice(6,8) : rawDate;
          var normSlot = _SPB.normSlotKey(parts[3] || '');
          var now0 = new Date();
          qrObject = { appId: 'BookMyGame', bookingId: parts[1]||'', groundId: parts[4]||'', date: isoDate, slotTime: normSlot, validFrom: new Date(now0.getTime()-60000).toISOString(), validTo: new Date(now0.getTime()+8*3600000).toISOString(), _fromToken: true };
        }
      }
      // Normalise appId — accept 'SportoBook' too
      if (qrObject && qrObject.appId && qrObject.appId !== 'BookMyGame') {
        qrObject.appId = 'BookMyGame';
      }

      if (!qrObject || !qrObject.bookingId) {
        if (typeof _orig === 'function') return _orig(qrData);
        return;
      }

      function showFail(msg) {
        if (typeof window._spbShowVerificationResult === 'function') window._spbShowVerificationResult(false, null, msg);
        else if (typeof window.showVerificationResult === 'function') window.showVerificationResult(false, null, msg);
        else { _SPB.toast('❌ ' + msg, 'error'); }
      }
      function showPass(booking) {
        if (typeof window._spbShowVerificationResult === 'function') window._spbShowVerificationResult(true, booking);
        else if (typeof window.showVerificationResult === 'function') window.showVerificationResult(true, booking);
        else { _SPB.toast('✅ Entry verified!', 'success'); }
      }

      if (!qrObject.appId || qrObject.appId !== 'BookMyGame') { showFail('QR code not generated by SpörtoBook'); return; }

      // Time check (only for JSON, not pipe tokens)
      if (!qrObject._fromToken && !qrObject.validFrom) {
        var now2 = new Date();
        qrObject.validFrom = new Date(now2.getTime()-24*3600000).toISOString();
        qrObject.validTo   = new Date(now2.getTime()+24*3600000).toISOString();
      }

      // Firestore lookup — 3 strategies
      var booking = null, bookingRef = null;
      try { var s1 = await db.collection('bookings').where('bookingId','==',qrObject.bookingId).limit(1).get(); if (!s1.empty) { booking = s1.docs[0].data(); bookingRef = s1.docs[0].ref; } } catch(_) {}
      if (!booking) { try { var s2 = await db.collection('bookings').where('orderId','==',qrObject.bookingId).limit(1).get(); if (!s2.empty) { booking = s2.docs[0].data(); bookingRef = s2.docs[0].ref; } } catch(_) {} }
      if (!booking) { try { var dd = await db.collection('bookings').doc(qrObject.bookingId).get(); if (dd.exists) { booking = dd.data(); bookingRef = dd.ref; } } catch(_) {} }

      if (!booking) { showFail('Booking not found. Ask the customer to check "My Bookings".'); return; }

      // Owner check
      var cu = window.currentUser;
      if (!cu) { showFail('You must be logged in as an owner to verify'); return; }
      try {
        var groundDoc = await db.collection('grounds').doc(booking.groundId).get();
        if (!groundDoc.exists) { showFail('Ground not found in system'); return; }
        if (groundDoc.data().ownerId !== cu.uid) { showFail('You can only verify bookings for your own grounds'); return; }
      } catch(_) {}

      // Already used?
      if (booking.entryStatus === 'used') { showFail('This entry pass has already been used'); return; }

      // Booking status
      var bStatus = (booking.bookingStatus || booking.status || '').toLowerCase();
      if (!/confirmed|paid|payment_confirmed|completed/.test(bStatus)) { showFail('Booking is not confirmed. Status: ' + (booking.bookingStatus || 'unknown')); return; }

      // Date check
      var today = new Date().toISOString().split('T')[0];
      var bookDate = booking.date || qrObject.date || '';
      if (bookDate && bookDate !== today) { showFail('This booking is for ' + bookDate + '. Today is ' + today + '.'); return; }

      // Time window check
      try {
        var slotStr = booking.slotTime || qrObject.slotTime || '';
        var slotParts = slotStr.replace(/\s/g,'').split('-');
        var startParts = (slotParts[0]||'').split(':');
        var endParts   = (slotParts[1]||'').split(':');
        var nowD = new Date();
        var entryOpen  = new Date(); entryOpen.setHours(+startParts[0]||0, (+startParts[1]||0)-15, 0, 0);
        var entryClose = new Date(); entryClose.setHours(+endParts[0]||0, +endParts[1]||0, 0, 0);
        entryClose.setTime(entryClose.getTime() + 30*60000);
        if (nowD < entryOpen) { showFail('Entry opens at ' + entryOpen.toLocaleTimeString() + '. Wait ' + Math.ceil((entryOpen-nowD)/60000) + ' min.'); return; }
        if (nowD > entryClose) { showFail('Entry window closed at ' + entryClose.toLocaleTimeString()); return; }
      } catch(_) {}

      // Mark entry as used
      try {
        await bookingRef.update({ entryStatus: 'used', entryTime: firebase.firestore.FieldValue.serverTimestamp(), verifiedBy: cu.uid, verifiedByName: cu.ownerName||cu.name||'', verifiedAt: firebase.firestore.FieldValue.serverTimestamp(), updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        try { await db.collection('grounds').doc(booking.groundId).update({ lastVerifiedAt: firebase.firestore.FieldValue.serverTimestamp(), totalEntriesVerified: firebase.firestore.FieldValue.increment(1) }); } catch(_) {}
      } catch(e) { console.warn('[spb-verify] entry update error (non-fatal):', e); }

      showPass(booking);
    };
    window.processVerifiedQRCode._spbV4 = true;
    window._spbShowVerificationResult = function (isSuccess, booking, errorMsg) {
      if (typeof window.showVerificationResult === 'function') window.showVerificationResult(isSuccess, booking, errorMsg||'');
      else { _SPB.toast(isSuccess ? '✅ Entry verified!' : '❌ ' + errorMsg, isSuccess ? 'success' : 'error'); }
    };
    return true;
  }

  setTimeout(doPatch, 500);
  window.addEventListener('bmg:pageShown', doPatch);
})();


/* ════════════════════════════════════════════════════════════════════
   SECTION 15 — PAYMENT RECOVERY (recoverPaymentSession — master v4)
   ════════════════════════════════════════════════════════════════════ */
(function patchPaymentRecovery() {
  async function markSlotConfirmed(booking, orderId) {
    var db = window.db;
    if (!db) return;
    var groundId = booking.groundId||'', date = booking.date||'', slotTime = booking.slotTime||'';
    if (!groundId||!date||!slotTime) return;
    var startTime = slotTime.replace(/\s/g,'').split('-')[0]||'';
    var endTime   = slotTime.replace(/\s/g,'').split('-')[1]||'';
    try {
      var snap = await db.collection('slots').where('groundId','==',groundId).where('date','==',date).where('startTime','==',startTime).limit(1).get();
      var slotData = { status:'confirmed', bookingId:orderId, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
      if (!snap.empty) { await snap.docs[0].ref.update(slotData); }
      else { await db.collection('slots').add(Object.assign({ groundId, date, startTime, endTime, createdAt: firebase.firestore.FieldValue.serverTimestamp() }, slotData)); }
    } catch(_) {}
  }

  window.recoverPaymentSession = async function (orderId, paymentType, paymentData) {
    if (!orderId) return;
    var db = window.db;
    if (!db) return;
    var pendingData = null;
    try { var pp = await db.collection('pending_payments').doc(orderId).get(); if (pp.exists) pendingData = pp.data(); } catch(_) {}

    function succeed(bookingDoc) {
      var merged = _SPB.merge(bookingDoc||{}, pendingData||{});
      if (!merged.bookingId) merged.bookingId = orderId;
      _SPB.persist(merged, orderId);
      markSlotConfirmed(merged, orderId);
      window.dispatchEvent(new CustomEvent('bmg:paymentConfirmed', { detail: { orderId, paymentType: paymentType||'booking', result: merged } }));
      try { sessionStorage.removeItem('slotLock'); sessionStorage.removeItem('bmg_recoverOrderId'); sessionStorage.removeItem('bmg_recoverPayType'); } catch(_) {}
      if (typeof window.hideLoading === 'function') window.hideLoading();
    }

    if (typeof window.showLoading === 'function') window.showLoading('Verifying payment…');
    var attempts = 0;

    async function poll() {
      attempts++;
      try { var fail = await db.collection('failed_payments').doc(orderId).get(); if (fail.exists) { if (typeof window.hideLoading === 'function') window.hideLoading(); _SPB.toast('Payment failed. Slot released.','error'); return; } } catch(_) {}
      if (!paymentType || paymentType === 'booking') {
        try { var s1 = await db.collection('bookings').where('bookingId','==',orderId).limit(1).get(); if (!s1.empty) { succeed(s1.docs[0].data()); return; } } catch(_) {}
        try { var s2 = await db.collection('bookings').where('orderId','==',orderId).limit(1).get(); if (!s2.empty) { succeed(s2.docs[0].data()); return; } } catch(_) {}
        try { var dd = await db.collection('bookings').doc(orderId).get(); if (dd.exists) { succeed(dd.data()); return; } } catch(_) {}
      }
      if (attempts < 25) { setTimeout(poll, 3000); return; }
      if (pendingData && /paid|confirmed|success/.test(pendingData.status||'')) { succeed(pendingData); return; }
      if (typeof window.hideLoading === 'function') window.hideLoading();
      _SPB.toast('Payment status unknown. Check "My Bookings".', 'warning');
    }
    poll();
  };
  window.recoverPaymentSession._spbV4 = true;

  // Enricher — fires BEFORE app.js handler, fills missing fields from pending_payments
  window.addEventListener('bmg:paymentConfirmed', async function (e) {
    if (e._spbEnriched) return;
    var detail = e.detail || {};
    if (detail.paymentType !== 'booking') return;
    var result  = detail.result || {};
    var orderId = detail.orderId;
    var db = window.db;
    if (result.groundName && result.slotTime && result.userName) { _SPB.persist(result, orderId); return; }
    if (!db) return;
    var pendingData = null;
    try { var pp = await db.collection('pending_payments').doc(orderId).get(); if (pp.exists) pendingData = pp.data(); } catch(_) {}
    var enriched = _SPB.merge(result, pendingData || {});
    if (!enriched.bookingId) enriched.bookingId = orderId;
    detail.result = enriched;
    e._spbEnriched = true;
    _SPB.persist(enriched, orderId);
  }, true); // capture phase

  // Patch showBookingSuccessConfirmation to merge sessionStorage cache
  function patchSuccessConfirmation() {
    if (typeof window.showBookingSuccessConfirmation !== 'function') return;
    if (window.showBookingSuccessConfirmation._spbV4) return;
    var _orig = window.showBookingSuccessConfirmation;
    window.showBookingSuccessConfirmation = function (booking) {
      if (!booking) booking = {};
      if (!(booking.groundName && booking.slotTime)) {
        var c = _SPB.loadCache(booking.bookingId || booking.orderId);
        if (c) booking = _SPB.merge(booking, c);
      }
      if (!booking.bookingId) booking.bookingId = sessionStorage.getItem('spb_lastConfirmedBookingId') || '';
      _SPB.persist(booking, booking.bookingId);
      return _orig(booking);
    };
    window.showBookingSuccessConfirmation._spbV4 = true;
  }

  _SPB.waitFor(function () { return typeof window.showBookingSuccessConfirmation === 'function'; }, 5000).then(patchSuccessConfirmation);
  setTimeout(patchSuccessConfirmation, 2000);

  // Auto-show entry pass after payment redirect
  window.addEventListener('bmg:pageShown', function (e) {
    var pid = (e && e.detail && e.detail.pageId) || '';
    if (!/home|ground|slot/i.test(pid)) return;
    var lastId = '';
    try { lastId = sessionStorage.getItem('spb_lastConfirmedBookingId') || ''; } catch(_) {}
    if (!lastId) return;
    try { if (sessionStorage.getItem('spb_shown_' + lastId)) return; sessionStorage.setItem('spb_shown_' + lastId, '1'); } catch(_) {}
    var cached = _SPB.loadCache(lastId);
    if (!cached || !cached.bookingId) return;
    setTimeout(function () { if (typeof window.showBookingSuccessConfirmation === 'function') window.showBookingSuccessConfirmation(cached); }, 500);
  });

  // Hard redirect case
  if (window.location.search.includes('payment_return') || window.location.hash.includes('payment_return')) {
    var orderId2 = (new URLSearchParams(window.location.search)).get('order_id') || (function () { try { return sessionStorage.getItem('bmg_recoverOrderId'); } catch(_) { return null; } })();
    var payType2 = (function () { try { return sessionStorage.getItem('bmg_recoverPayType') || 'booking'; } catch(_) { return 'booking'; } })();
    if (orderId2) {
      (function _try() {
        if (window.recoverPaymentSession && window.db && window.currentUser) window.recoverPaymentSession(orderId2, payType2, {});
        else setTimeout(_try, 600);
      })();
    }
  }
})();


/* ════════════════════════════════════════════════════════════════════
   SECTION 16 — REAL-TIME SLOTS (loadSlots — master v4, loop-safe)
   ════════════════════════════════════════════════════════════════════ */
(function patchLoadSlots() {
  var SLOT_ICONS  = { available:'🟢', confirmed:'🔴', booked:'🔴', locked:'🔒', pending:'🔒', past:'⏳', closed:'🚫', selected:'✅' };
  var SLOT_LABELS = { available:'Available', confirmed:'Booked', booked:'Booked', locked:'Processing…', pending:'Processing…', past:'Time Passed', closed:'Closed', selected:'Selected' };
  var _slotUnsub = null;

  // Loop-safe slot listener (patch_v2 style)
  var _activeSlotKey   = null;
  var _activeSlotUnsub = null;
  var _slotBusy        = false;

  function stopSlotListener() {
    if (_activeSlotUnsub) { try { _activeSlotUnsub(); } catch(_) {} _activeSlotUnsub = null; }
    if (_slotUnsub) { try { _slotUnsub(); } catch(_) {} _slotUnsub = null; }
    _activeSlotKey = null;
  }
  window._bmgClearSlotListeners = stopSlotListener;

  function upgradeSlotEl(el) {
    if (el.dataset.spbUpgraded) return;
    el.dataset.spbUpgraded = '1';
    var slot = el.dataset.slot || '';
    var timeText = slot ? slot.replace('-', ' – ') : (el.textContent || '').replace(/Available|Confirmed|Booked|Past|Processing|Locked|Closed|Time Passed|Selected/gi, '').trim();
    var status = 'available';
    ['confirmed','booked','locked','pending','past','closed','selected'].forEach(function(c) { if (el.classList.contains(c)) status = c; });
    el.innerHTML = '<span class="spb-icon">' + (SLOT_ICONS[status]||'🟢') + '</span><span class="spb-time">' + timeText + '</span><span class="spb-label">' + (SLOT_LABELS[status]||'Available') + '</span>';
  }

  function doPatch() {
    if (typeof window.loadSlots !== 'function') return false;
    if (window.loadSlots._spbV4) return true;

    // Kill old slot listeners
    if (typeof window._slotUnsubscribe === 'function') { try { window._slotUnsubscribe(); } catch(_) {} }

    window.loadSlots = function (groundId, date) {
      var db = window.db;
      if (!db || !groundId || !date) return;
      stopSlotListener();

      var container = document.getElementById('time-slots');
      if (!container) return;
      container.innerHTML = '<div style="grid-column:1/-1;padding:28px;text-align:center;"><div class="loader-spinner"></div><p style="margin-top:10px;color:#64748B;font-size:.82rem;">Loading slots…</p></div>';

      var defaults = [];
      for (var h = 0; h < 24; h++) {
        var sh = h.toString().padStart(2,'0'), eh = (h+1).toString().padStart(2,'0');
        defaults.push(sh + ':00-' + eh + ':00');
      }

      function render(statusMap) {
        var now = new Date(), currMins = now.getHours()*60+now.getMinutes();
        var today = now.toISOString().split('T')[0];
        var isToday = (date === today);
        var html = '';
        defaults.forEach(function (slot) {
          var norm = _SPB.normSlotKey(slot);
          var st = statusMap[norm] || statusMap[slot] || 'available';
          var sc = st, disabled = false;
          var startH = parseInt(slot.split(':')[0], 10);
          var startM = parseInt((slot.split(':')[1]||'0').split('-')[0], 10);
          var slotMins = startH * 60 + startM;
          if (isToday && slotMins <= currMins) { sc = 'past'; disabled = true; }
          else if (st !== 'available') { disabled = true; }
          html += '<div class="time-slot ' + sc + '" data-slot="' + slot + '" data-status="' + (disabled ? 'disabled' : st) + '" data-spb-upgraded="1"' + (!disabled && sc === 'available' ? ' data-available="true"' : '') + '>' +
            '<span class="spb-icon">' + (SLOT_ICONS[sc]||'🟢') + '</span>' +
            '<span class="spb-time">' + slot.replace('-',' – ') + '</span>' +
            '<span class="spb-label">' + (SLOT_LABELS[sc]||'Available') + '</span>' +
            '</div>';
        });
        var wasBusy = _slotBusy;
        _slotBusy = true;
        container.innerHTML = html;
        container.querySelectorAll('.time-slot.available').forEach(function (el) {
          el.addEventListener('click', function () { if (typeof window.selectSlot === 'function') window.selectSlot(this.dataset.slot); });
        });
        var sel = window.selectedSlot || (function(){try{return sessionStorage.getItem('selectedSlot');}catch(_){return '';}})();
        if (sel) {
          container.querySelectorAll('.time-slot[data-slot="' + sel + '"]').forEach(function (el) {
            el.classList.remove('available'); el.classList.add('selected');
            el.querySelector('.spb-icon').textContent = SLOT_ICONS.selected;
            el.querySelector('.spb-label').textContent = SLOT_LABELS.selected;
          });
        }
        // Legend
        var parent = container.parentNode;
        if (parent) {
          parent.querySelectorAll('.spb-legend,.slot-legend').forEach(function(e){e.remove();});
          var leg = document.createElement('div'); leg.className = 'spb-legend';
          leg.innerHTML = '<span class="spb-legend-item"><span class="spb-legend-dot available"></span>Available</span><span class="spb-legend-item"><span class="spb-legend-dot booked"></span>Booked</span><span class="spb-legend-item"><span class="spb-legend-dot pending"></span>Processing</span><span class="spb-legend-item"><span class="spb-legend-dot past"></span>Time Passed</span>';
          parent.insertBefore(leg, container);
        }
        setTimeout(function () { _slotBusy = wasBusy; }, 0);
      }

      var key = groundId + '__' + date;
      _activeSlotKey = key;
      _slotUnsub = db.collection('slots').where('groundId','==',groundId).where('date','==',date)
        .onSnapshot(function (snap) {
          if (_slotBusy) return;
          var map = {};
          snap.forEach(function (doc) {
            var d = doc.data();
            var k1 = _SPB.normSlotKey((d.startTime||'') + (d.endTime ? '-'+d.endTime : ''));
            var k2 = _SPB.normSlotKey(d.slotTime||'');
            if (k1) map[k1] = d.status || 'available';
            if (k2 && k2 !== k1) map[k2] = d.status || 'available';
          });
          render(map);
        }, function (err) { console.error('[spb-slots]', err); });

      _activeSlotUnsub = _slotUnsub;
    };
    window.loadSlots._spbV4 = true;

    // Upgrade pre-existing slot elements
    new MutationObserver(function (muts) {
      var has = false;
      muts.forEach(function (m) { m.addedNodes.forEach(function (n) {
        if (n.nodeType !== 1) return;
        if (n.classList && n.classList.contains('time-slot')) has = true;
        if (n.querySelectorAll && n.querySelectorAll('.time-slot').length) has = true;
      }); });
      if (has) setTimeout(function () { document.querySelectorAll('.time-slot:not([data-spb-upgraded])').forEach(upgradeSlotEl); }, 30);
    }).observe(document.body || document.documentElement, { childList: true, subtree: true });

    return true;
  }

  window.addEventListener('bmg:pageShown', function (e) {
    var pid = (e && e.detail && e.detail.pageId) || '';
    if (pid && pid !== 'ground-detail-page' && pid !== 'booking-page' && pid !== 'ground-page' && pid !== 'slots-page') {
      stopSlotListener();
    }
    doPatch();
  });
  _SPB.waitFor(function () { return typeof window.loadSlots === 'function'; }, 6000).then(doPatch);
  setTimeout(doPatch, 800);
})();


/* ════════════════════════════════════════════════════════════════════
   SECTION 17 — OWNER EARNINGS (transfer listener + discount-aware)
   ════════════════════════════════════════════════════════════════════ */
(function ownerEarnings() {
  var _transferListener = null;

  // sportoTransferPayment — write to correct 'owner_transfers' collection
  window.sportoTransferPayment = async function (ownerDocId, ownerName, amount) {
    if (!window.db) { _SPB.toast('Database not ready', 'error'); return; }
    var amountNum = Number(amount) || 0;
    var amtStr = _SPB.fmt(amountNum);
    var note = window.prompt ? (prompt('Transfer ' + amtStr + ' to ' + ownerName + '?\n\nAdd a note (e.g. UPI transaction ID):', '') || '') : '';
    if (note === null) return;
    if (!confirm('Confirm: Transfer ' + amtStr + ' to ' + ownerName + '?\n\nThis will mark the payment as sent.')) return;
    try {
      if (typeof window.showLoading === 'function') window.showLoading('Recording transfer…');
      var cu = window.currentUser;
      await window.db.collection('owner_transfers').add({
        ownerId: ownerDocId, ownerName: ownerName, amount: amountNum, note: note,
        sentBy: cu?.uid||'admin', sentByName: cu?.name||cu?.email||'Admin',
        status: 'sent', createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      if (typeof window.hideLoading === 'function') window.hideLoading();
      _SPB.toast('✅ Transfer of ' + amtStr + ' to ' + ownerName + ' recorded!', 'success', 5000);
      setTimeout(function () {
        if (document.getElementById('admin-dashboard-page')?.classList.contains('active') && typeof window.loadAdminDashboard === 'function') window.loadAdminDashboard('owners');
        else if (document.getElementById('ceo-dashboard-page')?.classList.contains('active') && typeof window.loadCEODashboard === 'function') window.loadCEODashboard('owners');
      }, 800);
    } catch (err) {
      if (typeof window.hideLoading === 'function') window.hideLoading();
      _SPB.toast('Transfer failed: ' + err.message, 'error');
    }
  };

  function startTransferListener(ownerId) {
    if (!window.db || !ownerId) return;
    if (_transferListener) { _transferListener(); _transferListener = null; }
    _transferListener = window.db.collection('owner_transfers').where('ownerId','==',ownerId)
      .onSnapshot(function () {
        var ownerDash = document.getElementById('owner-dashboard-page');
        if (!ownerDash?.classList.contains('active')) return;
        if (document.getElementById('owner-earnings-tab')?.classList.contains('active')) {
          var container = document.getElementById('owner-dashboard-content');
          if (container && typeof window.loadOwnerEarnings === 'function') window.loadOwnerEarnings(container);
        }
      }, function (err) { console.warn('[spb-earnings] Transfer listener error:', err.message); });
  }

  function hookTransferListener() {
    var cu = window.currentUser;
    if (cu?.uid && cu?.role === 'owner') startTransferListener(cu.uid);
    else setTimeout(hookTransferListener, 1000);
  }

  // Owner earnings card in profile
  function injectOwnerEarningsCard() {
    var cu = window.currentUser;
    if (!cu || cu.role !== 'owner') { document.getElementById('bmg-earnings-card')?.remove(); return; }
    if (document.getElementById('bmg-earnings-card')) return;
    var profileMenu = document.querySelector('.profile-menu');
    if (!profileMenu) return;
    var fmtCur = _SPB.fmt;
    var card = document.createElement('a');
    card.id = 'bmg-earnings-card';
    card.href = '#';
    card.className = 'bmg-earnings-card';
    card.innerHTML = '<div class="bmg-earnings-icon"><i class="fas fa-wallet"></i></div><div class="bmg-earnings-info"><div class="bmg-earnings-label">Total Earnings</div><div class="bmg-earnings-amount" id="spb-earnings-amount">Loading…</div></div><i class="fas fa-chevron-right bmg-earnings-arrow"></i>';
    card.addEventListener('click', function (e) {
      e.preventDefault();
      if (typeof window.showOwnerDashboard === 'function') { window.showOwnerDashboard(); setTimeout(function () { document.getElementById('owner-earnings-tab')?.click(); }, 400); }
      else if (typeof window.showPage === 'function') window.showPage('owner-dashboard-page');
    });
    profileMenu.insertAdjacentElement('beforebegin', card);
    if (window.db && cu.uid) {
      window.db.collection('owners').doc(cu.uid).get().then(function (ownerDoc) {
        if (!ownerDoc.exists) return;
        var total = ownerDoc.data().totalEarnings || ownerDoc.data().earnings || 0;
        var amtEl = document.getElementById('spb-earnings-amount');
        if (amtEl) amtEl.textContent = fmtCur(total);
      }).catch(console.warn);
    }
  }

  // patchMarkPaymentSent — inject status:'pending' for Firestore rules
  function patchMarkPaymentSent() {
    if (typeof window._bmgMarkPaymentSent !== 'function') { setTimeout(patchMarkPaymentSent, 500); return; }
    if (window._bmgMarkPaymentSent._spbPatched) return;
    var _orig = window._bmgMarkPaymentSent;
    window._bmgMarkPaymentSent = async function (bookingId) {
      var rest = Array.prototype.slice.call(arguments, 1);
      try {
        if (window.db) {
          var col = window.db.collection('payouts');
          var _origAdd = col.add.bind(col);
          col.add = async function (data) { col.add = _origAdd; return _origAdd(Object.assign({ status: 'pending' }, data)); };
        }
        return await _orig.apply(this, [bookingId].concat(rest));
      } catch (err) {
        console.warn('[spb-earnings] _bmgMarkPaymentSent error:', err.message);
        _SPB.toast('Could not mark as sent — please contact admin.', 'warning');
      }
    };
    window._bmgMarkPaymentSent._spbPatched = true;
  }

  setTimeout(hookTransferListener, 1500);
  window.addEventListener('bmg:authReady', function () { setTimeout(hookTransferListener, 500); });
  window.addEventListener('bmg:pageShown', function (e) {
    if (e.detail?.pageId === 'profile-page') {
      setTimeout(injectOwnerEarningsCard, 200);
    }
  });
  patchMarkPaymentSent();
  if (typeof window.firebase?.auth === 'function') {
    firebase.auth().onAuthStateChanged(function (user) {
      if (user) setTimeout(hookTransferListener, 500);
      else { if (_transferListener) { _transferListener(); _transferListener = null; } }
    });
  }
})();


/* ════════════════════════════════════════════════════════════════════
   SECTION 18 — SLOT LOCK SHIM (fix TypeError on releaseSlotLock)
   ════════════════════════════════════════════════════════════════════ */
(function slotLockShim() {
  function _shim() {
    var _orig = window.releaseSlotLock;
    window.releaseSlotLock = function () {
      var args = Array.prototype.slice.call(arguments);
      if (!args[0]) return Promise.resolve();
      if (typeof _orig === 'function') {
        try { return _orig.apply(this, args) || Promise.resolve(); } catch (_) {}
      }
      // Fallback: update Firestore directly
      if (window.db && args.length >= 4) {
        var lockId = args[0], groundId = args[1], date = args[2], slotTime = args[3];
        return window.db.collection('slots').where('groundId','==',groundId).where('date','==',date).where('startTime','==',slotTime.split('-')[0]||slotTime).limit(1).get()
          .then(function (snap) { if (!snap.empty) return snap.docs[0].ref.update({ status:'available', lockId:null, lockedAt:null, lockExpiresAt:null }); })
          .catch(function () {});
      }
      return Promise.resolve();
    };
  }
  _SPB.waitFor(function () { return true; }, 100).then(_shim);
  setTimeout(_shim, 300);
})();


/* ════════════════════════════════════════════════════════════════════
   SECTION 19 — LOADING OVERLAY: 10s cap + stuck overlay fix
   ════════════════════════════════════════════════════════════════════ */
(function overlayFix() {
  function forceHide() {
    var overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = 'none';
    if (typeof window.hideLoading === 'function') window.hideLoading();
  }

  var _origShow = window.showLoading;
  window.showLoading = function (msg) {
    var overlay = document.getElementById('loading-overlay');
    if (overlay) overlay._shownAt = Date.now();
    if (typeof _origShow === 'function') _origShow(msg);
    clearTimeout(window._spbOverlayCap);
    window._spbOverlayCap = setTimeout(forceHide, 10000);
  };

  document.addEventListener('click', function (e) {
    var overlay = document.getElementById('loading-overlay');
    if (!overlay || overlay.style.display === 'none') return;
    var spinner = overlay.querySelector('.loader-spinner, .loading-spinner');
    if (spinner && spinner.contains(e.target)) return;
    if (Date.now() - (overlay._shownAt || 0) > 3000) forceHide();
  }, true);

  function rewireBackButtons() {
    var IDS = [
      'owner-type-back-btn','venue-owner-register-back-btn','plot-owner-register-back-btn',
      'venue-back-btn','ground-back-btn','booking-back-btn','confirmation-home-btn',
      'entry-pass-back-btn','bookings-back-btn','profile-back-btn','owner-dashboard-back-btn',
      'admin-dashboard-back-btn','ceo-dashboard-back-btn','register-back-btn',
    ];
    IDS.forEach(function (id) {
      var btn = document.getElementById(id);
      if (!btn || btn._spbWired) return;
      btn._spbWired = true;
      btn.addEventListener('click', function (e) { e.stopPropagation(); forceHide(); if (typeof window.goBack === 'function') window.goBack(); });
    });
    document.querySelectorAll('.back-btn:not([data-spb-wired])').forEach(function (btn) {
      btn.setAttribute('data-spb-wired','1');
      btn.addEventListener('click', function (e) { e.stopPropagation(); forceHide(); if (typeof window.goBack === 'function') window.goBack(); });
    });
  }

  window.addEventListener('bmg:pageShown', function () { setTimeout(rewireBackButtons, 100); forceHide(); });
  if (document.readyState !== 'loading') { rewireBackButtons(); } else { document.addEventListener('DOMContentLoaded', rewireBackButtons); }
  setInterval(rewireBackButtons, 2000);
})();


/* ════════════════════════════════════════════════════════════════════
   SECTION 20 — UPCOMING BOOKING BANNER
   ════════════════════════════════════════════════════════════════════ */
(function upcomingBanner() {
  var _bannerListener = null;

  function start() {
    if (_bannerListener) { _bannerListener(); _bannerListener = null; }
    var banner = document.getElementById('spb-upcoming-banner');
    var nameEl = document.getElementById('spb-upcoming-name');
    var addrEl = document.getElementById('spb-upcoming-addr');
    var timeEl = document.getElementById('spb-upcoming-time');
    if (!banner || !window.db || !window.currentUser) return;

    var today = new Date(); today.setHours(0,0,0,0);
    var todayStr = today.toISOString().split('T')[0];

    _bannerListener = window.db.collection('bookings')
      .where('userId','==',window.currentUser.uid)
      .where('bookingStatus','==','confirmed')
      .where('date','>=',todayStr)
      .orderBy('date','asc').limit(3)
      .onSnapshot(function (snap) {
        var now = new Date(), upcoming = null;
        snap.forEach(function (doc) {
          if (upcoming) return;
          var b = doc.data();
          var slotStr = (b.date||'') + 'T' + (b.slotTime ? b.slotTime.replace(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i, function(_,h,m,ap){var hh=parseInt(h,10);if(ap&&ap.toUpperCase()==='PM'&&hh!==12)hh+=12;if(ap&&ap.toUpperCase()==='AM'&&hh===12)hh=0;return String(hh).padStart(2,'0')+':'+m+':00';}) : '00:00:00');
          var slotDate = new Date(slotStr);
          if (slotDate >= now) upcoming = Object.assign({}, b, { _id: doc.id });
        });
        if (!upcoming) { banner.style.display = 'none'; return; }
        banner.style.display = 'flex';
        if (nameEl) nameEl.textContent = upcoming.groundName || upcoming.venueName || 'Ground Booking';
        var addr = upcoming.groundAddress || upcoming.venueAddress || '';
        if (addrEl) addrEl.textContent = addr ? addr + (upcoming.date ? ' · ' + upcoming.date : '') : (upcoming.date || '');
        if (timeEl) { timeEl.textContent = upcoming.slotTime || upcoming.date || 'Upcoming'; timeEl.style.display = 'block'; }
        banner.style.cursor = 'pointer';
        banner.onclick = function () { if (typeof window.showPage === 'function') window.showPage('bookings-page'); else if (typeof window.loadMyBookings === 'function') window.loadMyBookings(); };
      }, function (err) { console.warn('[spb-banner]', err); banner.style.display = 'none'; });
  }

  function stop() {
    if (_bannerListener) { _bannerListener(); _bannerListener = null; }
    var banner = document.getElementById('spb-upcoming-banner');
    if (banner) banner.style.display = 'none';
  }

  // Auth poll
  var _lastUid = null;
  setInterval(function () {
    var uid = window.currentUser?.uid || null;
    if (uid !== _lastUid) {
      _lastUid = uid;
      if (uid) start(); else stop();
    }
  }, 800);
  window.addEventListener('bmg:paymentConfirmed', function () { setTimeout(start, 1000); });
})();


/* ════════════════════════════════════════════════════════════════════
   SECTION 21 — POST-PAYMENT CONFETTI & ENTRY PASS BUTTON
   ════════════════════════════════════════════════════════════════════ */
(function postPaymentUI() {
  window.addEventListener('bmg:paymentConfirmed', function (e) {
    if (!e.detail || e.detail.paymentType !== 'booking') return;
    var result = e.detail.result || {};
    var bookingId = _SPB.getBookingId(result, e.detail.orderId);

    // Auto-show entry pass button on confirmation page
    setTimeout(function () {
      var btnExisting = document.getElementById('show-entry-pass-btn');
      if (!btnExisting) {
        var confPage = document.getElementById('confirmation-page');
        if (confPage && confPage.classList.contains('active')) {
          var btn = document.createElement('button');
          btn.id = 'show-entry-pass-btn';
          btn.style.cssText = 'display:block;width:calc(100% - 32px);margin:8px 16px;padding:14px;background:linear-gradient(135deg,#4F46E5,#7C3AED);color:#fff;border:none;border-radius:14px;font-size:15px;font-weight:700;cursor:pointer;';
          btn.innerHTML = '<i class="fas fa-qrcode"></i> View Entry Pass';
          btn.addEventListener('click', function () { if (typeof window.showEntryPass === 'function') window.showEntryPass(bookingId); });
          confPage.querySelector('.page-content')?.appendChild(btn);
        }
      }
    }, 1000);
  });
})();


/* ════════════════════════════════════════════════════════════════════
   SECTION 22 — MAIN BOOT: wire everything on page show
   ════════════════════════════════════════════════════════════════════ */
(function mainBoot() {
  function boot() {
    // Sync QR scanner visibility
    (function syncQR() {
      var btn = document.getElementById('header-qr-scanner');
      var cu = window.currentUser;
      if (!btn) return;
      var isOwner = cu && (cu.role === 'owner' || cu.role === 'admin' || cu.role === 'ceo');
      btn.style.display = isOwner ? 'flex' : 'none';
    })();

    // Re-run city search wiring
    var searchInput = document.getElementById('global-search');
    if (searchInput && !searchInput._spbSearchWired) {
      searchInput._spbSearchWired = true;
      searchInput.placeholder = 'Search city, sport or ground name…';
    }
  }

  window.addEventListener('bmg:pageShown', function (e) {
    var pid = (e && e.detail && e.detail.pageId) || '';
    setTimeout(boot, 80);
    if (pid === 'main-page' || pid === 'home-page') {
      var container = document.getElementById('nearby-venues');
      if (container && (!container.children.length || container.querySelector('.skeleton-loading'))) {
        setTimeout(function () { if (typeof window.loadNearbyVenues === 'function') window.loadNearbyVenues(); }, 200);
      }
    }
  });

  if (document.readyState !== 'loading') {
    setTimeout(boot, 200);
  } else {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 200); });
  }

  console.log('✅ [sportobook_patches_merged.js] All patches loaded successfully');
})();


/* ════════════════════════════════════════════════════════════════════
   SECTION 23 — setupPayButton (was in app_payment_integration.js)
   Wires the #cashfree-pay-btn to startPayment() from paymentService.js
   This is called by showBookingPage() in app.js every time the
   booking page is shown.
   ════════════════════════════════════════════════════════════════════ */
(function defineSetupPayButton() {
  'use strict';

  window.setupPayButton = function (bookingDetails) {
    var btn = document.getElementById('cashfree-pay-btn');
    if (!btn) {
      // Button not yet in DOM — retry once after short delay
      setTimeout(function () { window.setupPayButton(bookingDetails); }, 200);
      return;
    }

    // Store booking details globally so the button can always access them
    window._currentBookingDetails = bookingDetails;

    // Remove old listeners by cloning the button
    var fresh = btn.cloneNode(true);
    btn.parentNode.replaceChild(fresh, btn);

    fresh.addEventListener('click', async function (e) {
      e.preventDefault();
      e.stopPropagation();

      var details = window._currentBookingDetails;
      if (!details) {
        if (typeof window.showToast === 'function') window.showToast('Booking details missing. Please try again.', 'error');
        return;
      }
      if (!window.currentUser) {
        if (typeof window.showToast === 'function') window.showToast('Please login first', 'warning');
        return;
      }

      // Enrich with user data if missing
      var cu = window.currentUser;
      details.userName  = details.userName  || cu.name  || cu.displayName || '';
      details.userEmail = details.userEmail || cu.email || '';
      details.userPhone = details.userPhone || cu.phone || '';

      if (typeof window.startPayment === 'function') {
        await window.startPayment(details, 'booking');
      } else {
        if (typeof window.showToast === 'function') window.showToast('Payment service not loaded. Please refresh.', 'error');
        console.error('[spb] window.startPayment not found — paymentService.js may not be loaded.');
      }
    });

    // Visual feedback — re-enable button if it was disabled
    fresh.disabled = false;
    fresh.style.opacity = '1';
    fresh.style.pointerEvents = 'auto';

    console.log('[spb] setupPayButton wired → startPayment(bookingDetails, "booking")');
  };

  // Also wire via bmg:pageShown in case showBookingPage fires before the function is defined
  window.addEventListener('bmg:pageShown', function (e) {
    if (e.detail && e.detail.pageId === 'booking-page') {
      var details = window._currentBookingDetails;
      if (details) {
        setTimeout(function () { window.setupPayButton(details); }, 100);
      }
    }
  });

  console.log('[spb] setupPayButton defined ✅');
})();