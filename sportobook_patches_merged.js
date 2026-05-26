/* sportobook_patches_merged.js — extracted from sportobook_master.js
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  bmg_patches_combined.js  —  BookMyGame / SpörtoBook  (MASTER COMBINED)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  REPLACES ALL of the following files (do NOT load them separately):
 *    bmg_master_fix.js, bmg_master_fix_v2.js, bmg_master_fix_v4.js,
 *    bmg_master_patch_v3.js, bmg_all_fixes_final.js,
 *    bmg_all_fixes_final__1_.js, bmg_comprehensive_fix.js,
 *    bmg_final_fix.js, bmg_fixes_v4.js, bmg_instant_fixes.js,
 *    bmg_earnings_admin_fix_v3.js, bmg_earnings_collection_fix.js,
 *    bmg_earnings_fix_v2.js, bmg_cf_bypass.js, bmg_fix_canaddground.js,
 *    app_payment_integration.js
 *
 *  LOAD ORDER in index.html (end of <body>):
 *    <script src="https://sdk.cashfree.com/js/v3/cashfree.js"></script>
 *    <script src="paymentService.js"></script>
 *    <script src="app.js"></script>
 *    <script src="bmg_patches_combined.js"></script>   ← this file, LAST
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  FEATURES INCLUDED:
 *
 *  [P]  Payment integration helpers (handleBookingPayment, handleTournamentPayment,
 *       showOwnerRegistrationPayment, setupPayButton, stripEmptyFields)
 *  [S]  Slot renderer: booked slots show RED "Booked" badge professionally;
 *       real-time Firestore listener; expired lock cleanup
 *  [T]  Tournament: QR entry pass, auto-confirm, spots counter, My Bookings tab,
 *       owner QR verification, _showTournamentJoinedSuccess with QR
 *  [O]  Owner: canAddGround with registrationVerified auto-fix; congratulations
 *       screen; registration login fix
 *  [E]  Earnings: owner earnings with per-booking history + tournament;
 *       Admin/CEO earnings tab; bmgAdminTransferPaymentV3
 *  [A]  Admin/CEO dashboard: owner list, bookings tab, payout list,
 *       Owner Earnings tab injection
 *  [I]  Instant fixes: Firestore-only tournament payment recovery (no CF calls);
 *       deduplication of bmg:paymentConfirmed; CF bypass stubs
 *  [H]  Home page: nearby venues with geolocation, shimmer skeleton, city filter
 *  [Q]  QR scanner: booking + tournament verification, compact QR format
 *  [U]  UI patches: image viewer, profile photo sheet, QR scanner animation,
 *       ground step navigation, tournament form fields
 *  [G]  Guards: cleanupExpiredLocks auth guard; handleRegister alias;
 *       initCashfree stub; 404 script suppression
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

/* ══════════════════════════════════════════════════════════════════════════
 * §0  GLOBAL VARIABLE GUARDS (synchronous — before anything else)
 * ══════════════════════════════════════════════════════════════════════════*/
if (typeof window.tournamentCurrentStep === 'undefined') window.tournamentCurrentStep = 1;
if (typeof window.tournamentTotalSteps  === 'undefined') window.tournamentTotalSteps  = 4;
if (typeof window.currentGroundStep     === 'undefined') window.currentGroundStep     = 1;
if (typeof window.totalGroundSteps      === 'undefined') window.totalGroundSteps      = 3;
if (typeof window._ivTranslateX        === 'undefined') { window._ivTranslateX = 0; window._ivTranslateY = 0; }

/* ══════════════════════════════════════════════════════════════════════════
 * §1  CF BYPASS — stub checkOrderStatus Cloud Function (CORS blocked)
 * ══════════════════════════════════════════════════════════════════════════*/
(function _installCFBypass() {
  const CF_BLOCK = ['checkOrderStatus'];
  const _origFetch = window.fetch.bind(window);

  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input?.url || '');
    if (CF_BLOCK.some(p => url.includes(p))) {
      console.log('[BMG] CF bypass: stubbing', url);
      return Promise.resolve(
        new Response(JSON.stringify({ status: 'PENDING', bypassed: true }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })
      );
    }
    return _origFetch(input, init);
  };

  // Deduplicate bmg:paymentConfirmed events
  const _fired = new Set();
  const _origDispatch = window.dispatchEvent.bind(window);
  window.dispatchEvent = function (event) {
    if (event?.type === 'bmg:paymentConfirmed') {
      const oid = event.detail?.orderId;
      if (oid) {
        if (_fired.has(oid)) { console.log('[BMG] Deduplicated paymentConfirmed', oid); return true; }
        _fired.add(oid);
        setTimeout(() => _fired.delete(oid), 5 * 60 * 1000);
      }
    }
    return _origDispatch(event);
  };

  console.log('[BMG] CF bypass + event deduplication active');
})();

/* ══════════════════════════════════════════════════════════════════════════
 * §2  UTILITY HELPERS
 * ══════════════════════════════════════════════════════════════════════════*/
(function () {
  'use strict';

  function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  window._esc = _esc;

  function _fmt(v) {
    return typeof window.formatCurrency === 'function'
      ? window.formatCurrency(v)
      : '₹' + Number(v || 0).toLocaleString('en-IN');
  }

  function _toast(msg, type, dur) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info', dur || 4000);
  }

  function _showLoading(msg) { if (typeof window.showLoading === 'function') window.showLoading(msg); }
  function _hideLoading() { if (typeof window.hideLoading === 'function') window.hideLoading(); }

  function waitFor(name, cb, ms, maxMs) {
    if (typeof window[name] !== 'undefined') { cb(window[name]); return; }
    const start = Date.now();
    const t = setInterval(() => {
      if (typeof window[name] !== 'undefined') { clearInterval(t); cb(window[name]); return; }
      if (Date.now() - start > (maxMs || 12000)) { clearInterval(t); }
    }, ms || 120);
  }

  function onReady(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  // Expose helpers on window for use across IIFEs
  window._bmgFmt = _fmt;
  window._bmgToast = _toast;
  window._bmgShowLoading = _showLoading;
  window._bmgHideLoading = _hideLoading;
  window._bmgWaitFor = waitFor;
  window._bmgOnReady = onReady;

  /* ── Stubs for missing globals ─────────────────────────────────── */
  if (typeof window.handleRegister === 'undefined') {
    window.handleRegister = function (e) {
      if (typeof window.handleUserRegister === 'function') return window.handleUserRegister(e);
    };
  }
  if (typeof window.initCashfree === 'undefined') {
    window.initCashfree = function () {
      console.log('[BMG] initCashfree() stub — managed by paymentService.js');
    };
  }
})();

/* ══════════════════════════════════════════════════════════════════════════
 * §3  PAYMENT INTEGRATION HELPERS
 *     (replaces app_payment_integration.js + related helpers)
 * ══════════════════════════════════════════════════════════════════════════*/
(function () {
  'use strict';

  // ── [P1] Ground booking payment ──────────────────────────────────────
  async function handleBookingPayment(bookingDetails) {
    const safe = JSON.parse(JSON.stringify(bookingDetails));
    const paymentData = {
      groundId      : String(safe.groundId      || ''),
      groundName    : String(safe.groundName    || ''),
      venueName     : String(safe.venueName     || ''),
      venueAddress  : String(safe.venueAddress  || ''),
      groundAddress : String(safe.groundAddress || ''),
      sportType     : String(safe.sportType     || ''),
      ownerId       : String(safe.ownerId       || ''),
      isPlotOwner   : Boolean(safe.isPlotOwner  || false),
      date          : String(safe.date          || ''),
      slotTime      : String(safe.slotTime      || ''),
      amount        : Number(safe.amount),
      originalAmount: Number(safe.originalAmount || safe.amount),
      userName      : String(safe.userName  || window.currentUser?.name  || ''),
      userEmail     : String(safe.userEmail || window.currentUser?.email || ''),
      userPhone     : String(safe.userPhone || window.currentUser?.phone || ''),
      ownerAmount   : Number(safe.ownerAmount || 0),
      promoCode     : String(safe.promoCode   || ''),
      appliedOffer  : String(safe.appliedOffer || ''),
    };
    await window.startPayment(paymentData, 'booking');
  }

  function setupPayButton(bookingDetails) {
    const btn = document.getElementById('cashfree-pay-btn');
    if (!btn) return;
    const fresh = btn.cloneNode(true);
    btn.parentNode.replaceChild(fresh, btn);
    fresh.addEventListener('click', async (e) => {
      e.preventDefault();
      await handleBookingPayment(bookingDetails);
    });
  }

  function showBookingPage(bookingDetails) {
    const safe = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val ?? ''; };
    safe('booking-ground-name', bookingDetails.groundName);
    safe('booking-date',        bookingDetails.date);
    safe('booking-time',        bookingDetails.slotTime);
    safe('booking-amount',      window._bmgFmt(bookingDetails.amount));
    safe('payment-amount',      window._bmgFmt(bookingDetails.amount));
    safe('platform-fee',        window._bmgFmt(bookingDetails.amount * 0.10));
    safe('final-amount',        window._bmgFmt(bookingDetails.amount));
    try { sessionStorage.setItem('currentBookingDetails', JSON.stringify(bookingDetails)); } catch (_) {}
    setupPayButton(bookingDetails);
    if (typeof window.showPage === 'function') window.showPage('booking-page');
  }

  // ── [P2] Owner onboarding ─────────────────────────────────────────────
  async function showOwnerRegistrationPayment() {
    const cu = window.currentUser;
    if (!cu) { window._bmgToast('Please log in first', 'warning'); return; }
    const db = window.db;
    try {
      const snap = await db.collection('owners').doc(cu.uid).get();
      if (snap.exists) {
        const o = snap.data();
        if (o.isActive && o.paymentDone) { window._bmgToast('Your account is already active!', 'success'); return; }
      }
      const owner = snap.exists ? snap.data() : {};
      await window.startPayment({
        ownerId  : String(cu.uid),
        userName : String(cu.name  || owner.name  || ''),
        userEmail: String(cu.email || owner.email || ''),
        userPhone: String(cu.phone || owner.phone || ''),
        amount   : 5,
      }, 'owner_onboarding');
    } catch (err) { window._bmgToast('Error: ' + err.message, 'error'); }
  }

  // ── [P3] Tournament payment ───────────────────────────────────────────
  window.handleTournamentPayment = async function (tournament, teamName = '') {
    const cu = window.currentUser;
    if (!cu) { window._bmgToast('Please log in to register', 'warning'); return; }
    if (!tournament?.entryFee || tournament.entryFee <= 0) { window._bmgToast('Invalid entry fee', 'error'); return; }

    const db = window.db;
    const existing = await db.collection('tournament_entries')
      .where('tournamentId', '==', tournament.id).where('userId', '==', cu.uid).limit(1).get();
    if (!existing.empty) { window._bmgToast('You are already registered for this tournament.', 'warning'); return; }

    const safe = JSON.parse(JSON.stringify(tournament));
    const paymentData = {
      tournamentId  : String(safe.id            || ''),
      tournamentName: String(safe.name || safe.tournamentName || ''),
      amount        : Number(safe.entryFee),
      userId        : String(cu.uid),
      userName      : String(cu.name   || ''),
      userEmail     : String(cu.email  || ''),
      userPhone     : String(cu.phone  || ''),
      teamName      : String(teamName  || ''),
      sport         : String(safe.sport  || ''),
      date          : String(safe.date   || ''),
      venue         : String(safe.venue  || ''),
    };

    // Save reg data before startPayment (for page-reload recovery)
    try {
      sessionStorage.setItem(`bmg_tournReg_${paymentData.tournamentId}`, JSON.stringify({
        ...paymentData, savedAt: Date.now()
      }));
    } catch (_) {}

    await window.startPayment(paymentData, 'tournament');
  };

  // ── [P4] Strip empty fields helper ───────────────────────────────────
  window.stripEmptyFields = function (obj) {
    return Object.fromEntries(
      Object.entries(obj).filter(([, v]) => {
        if (v === null || v === undefined) return false;
        if (typeof v === 'string' && v === '') return false;
        if (typeof v === 'number' && Number.isNaN(v)) return false;
        return true;
      })
    );
  };

  // ── [P5] Payment confirmed event router ───────────────────────────────
  window.addEventListener('bmg:paymentConfirmed', (e) => {
    const { orderId, paymentType, result } = e.detail;
    console.log('✅ Payment confirmed:', paymentType, orderId);

    switch (paymentType) {
      case 'booking':
        if (typeof window.showBookingSuccessConfirmation === 'function') {
          window.showBookingSuccessConfirmation(result || { bookingId: orderId });
        }
        // Store bookingId for entry pass
        const bid = result?.bookingId || orderId;
        if (bid) {
          window._lastConfirmedBookingId = bid;
          try { sessionStorage.setItem('lastBookingId', bid); } catch (_) {}
        }
        break;
      case 'owner_onboarding':
        window._bmgToast('🎉 Account activated! You can now list your ground.', 'success', 6000);
        setTimeout(() => _showOwnerCongratulationsScreen(), 400);
        break;
      case 'tournament':
        window._bmgToast('🏆 Tournament registration confirmed! Check "My Tournaments".', 'success', 6000);
        if (typeof window.loadMyTournaments === 'function') window.loadMyTournaments();
        break;
    }
  });

  // ── Expose globals ────────────────────────────────────────────────────
  window.handleBookingPayment           = handleBookingPayment;
  window.showOwnerRegistrationPayment   = showOwnerRegistrationPayment;
  window.processRegistrationPayment     = showOwnerRegistrationPayment;
  window.initiateOwnerOnboardingPayment = showOwnerRegistrationPayment;
  window.showBookingPage                = showBookingPage;
  window.setupPayButton                 = setupPayButton;

  /* ── Owner congratulations screen ────────────────────────────────── */
  function _showOwnerCongratulationsScreen() {
    const existing = document.getElementById('bmg-owner-congrats');
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.id = 'bmg-owner-congrats';
    el.style.cssText = 'position:fixed;inset:0;z-index:99999;background:linear-gradient(135deg,#1b2e6c,#2563eb);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px;animation:bmgFadeIn .4s ease;';
    el.innerHTML = `
      <div style="text-align:center;color:#fff;max-width:380px;">
        <div style="font-size:72px;margin-bottom:16px;">🎉</div>
        <h1 style="font-size:26px;font-weight:800;margin:0 0 8px;">Congratulations!</h1>
        <p style="font-size:16px;opacity:.85;margin:0 0 8px;">You're now a Real Businessman</p>
        <p style="font-size:14px;opacity:.7;margin:0 0 32px;">Your owner account is active. Start listing your grounds and earning!</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:28px;">
          <div style="background:rgba(255,255,255,.15);border-radius:14px;padding:16px;">
            <div style="font-size:24px;">🏟️</div>
            <div style="font-size:13px;margin-top:6px;font-weight:600;">List Grounds</div>
          </div>
          <div style="background:rgba(255,255,255,.15);border-radius:14px;padding:16px;">
            <div style="font-size:24px;">💰</div>
            <div style="font-size:13px;margin-top:6px;font-weight:600;">Earn Money</div>
          </div>
        </div>
        <button id="bmg-congrats-cta" style="width:100%;padding:16px;background:#fff;color:#1b2e6c;border:none;border-radius:16px;font-size:16px;font-weight:800;cursor:pointer;">
          Go to Owner Dashboard 🚀
        </button>
      </div>`;
    document.body.appendChild(el);
    el.querySelector('#bmg-congrats-cta').addEventListener('click', () => {
      el.remove();
      if (typeof window.loadOwnerDashboard === 'function') window.loadOwnerDashboard();
      if (typeof window.showPage === 'function') window.showPage('owner-dashboard');
    });
  }
  window._showOwnerCongratulationsScreen = _showOwnerCongratulationsScreen;
})();

/* ══════════════════════════════════════════════════════════════════════════
 * §4  SLOT RENDERER & REAL-TIME LISTENER
 *     Professional slot UI: booked=RED, available=GREEN, past=GRAY
 * ══════════════════════════════════════════════════════════════════════════*/
(function () {
  'use strict';

  /* ── CSS ─────────────────────────────────────────────────────────────── */
  function _injectSlotCSS() {
    if (document.getElementById('bmg-slot-css')) return;
    const s = document.createElement('style');
    s.id = 'bmg-slot-css';
    s.textContent = `
/* ── SLOT GRID ──────────────────────────────────────────────── */
.slots-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; padding:4px 0; }
.time-slot {
  position:relative; display:flex; flex-direction:column;
  align-items:center; justify-content:center; gap:4px;
  padding:10px 6px; border-radius:12px; border:2px solid #e5e7eb;
  background:#fff; font-size:12px; font-weight:600; cursor:pointer;
  transition:all .2s cubic-bezier(.4,0,.2,1); overflow:hidden;
  min-height:64px; user-select:none;
}
.time-slot .slot-time-text { font-size:11.5px; font-weight:700; letter-spacing:-.2px; line-height:1.2; text-align:center; }
.time-slot .slot-status-tag {
  font-size:9.5px; font-weight:700; letter-spacing:.3px;
  text-transform:uppercase; padding:2px 7px; border-radius:20px;
}
.time-slot .slot-icon { font-size:13px; margin-bottom:1px; }

/* AVAILABLE */
.time-slot.available {
  border-color:#22c55e;
  background:linear-gradient(135deg,#f0fdf4,#dcfce7);
  color:#166534; box-shadow:0 2px 8px rgba(34,197,94,.12);
}
.time-slot.available .slot-status-tag { background:rgba(34,197,94,.15); color:#15803d; }
.time-slot.available:hover { transform:translateY(-3px) scale(1.03); box-shadow:0 6px 20px rgba(34,197,94,.25); border-color:#16a34a; }

/* SELECTED */
.time-slot.available.selected, .time-slot.selected {
  background:linear-gradient(135deg,#1b2e6c,#2563eb);
  border-color:#1b2e6c; color:#fff;
  transform:scale(1.04); box-shadow:0 6px 20px rgba(27,46,108,.35);
}

/* CONFIRMED / BOOKED  ← RED — the most important fix */
.time-slot.confirmed, .time-slot.booked {
  border-color:#ef4444 !important;
  background:linear-gradient(135deg,#fef2f2,#fee2e2) !important;
  color:#991b1b !important;
  cursor:not-allowed !important;
  pointer-events:none !important;
}
.time-slot.confirmed .slot-status-tag,
.time-slot.booked .slot-status-tag {
  background:rgba(239,68,68,.18) !important;
  color:#dc2626 !important;
  font-weight:800 !important;
}
.time-slot.confirmed .slot-icon,
.time-slot.booked .slot-icon { filter:drop-shadow(0 0 4px rgba(239,68,68,.4)); }

/* PAST */
.time-slot.past {
  border-color:#d1d5db; background:linear-gradient(135deg,#f9fafb,#f3f4f6);
  color:#9ca3af; cursor:not-allowed; opacity:.75;
}
.time-slot.past .slot-time-text { text-decoration:line-through; text-decoration-color:#d1d5db; }
.time-slot.past .slot-status-tag { background:rgba(156,163,175,.15); color:#9ca3af; }

/* LOCKED / PROCESSING */
.time-slot.locked {
  border-color:#f59e0b; background:linear-gradient(135deg,#fffbeb,#fef3c7);
  color:#92400e; cursor:not-allowed;
}
.time-slot.locked .slot-status-tag { background:rgba(245,158,11,.15); color:#d97706; }

/* CLOSED */
.time-slot.closed {
  border-color:#9ca3af; background:#f9fafb; color:#9ca3af; cursor:not-allowed; opacity:.6;
}

/* LEGEND */
.slot-legend { display:flex; gap:14px; flex-wrap:wrap; padding:10px 0 14px; font-size:11px; font-weight:600; color:#6b7280; }
.slot-legend-item { display:flex; align-items:center; gap:5px; }
.slot-legend-dot { width:10px; height:10px; border-radius:50%; flex-shrink:0; }
.slot-legend-dot.available { background:#22c55e; }
.slot-legend-dot.booked    { background:#ef4444; }
.slot-legend-dot.past      { background:#d1d5db; }
.slot-legend-dot.locked    { background:#f59e0b; }

/* SLOT BADGES */
.bmg-sb { display:inline-block; font-size:9px; font-weight:700; letter-spacing:.04em;
  text-transform:uppercase; padding:2px 5px; border-radius:4px; margin-left:4px; vertical-align:middle; }
.bmg-sb.booked  { background:#fee2e2; color:#dc2626; }
.bmg-sb.locked  { background:#fef3c7; color:#d97706; }
.bmg-sb.mine    { background:#d1fae5; color:#059669; }

/* SLOT RELEASED TOAST */
.slot-released-toast {
  position:fixed; bottom:90px; left:50%; transform:translateX(-50%);
  background:linear-gradient(135deg,#1b2e6c,#2563eb); color:#fff;
  padding:12px 20px; border-radius:14px; font-size:13px; font-weight:600;
  z-index:99997; display:flex; align-items:center; gap:8px;
  box-shadow:0 8px 24px rgba(27,46,108,.3); animation:toastIn .3s ease;
  max-width:320px; text-align:center;
}
@keyframes toastIn { from{opacity:0;transform:translateX(-50%) translateY(20px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
@keyframes bmgFadeIn { from{opacity:0;transform:scale(.92)} to{opacity:1;transform:scale(1)} }
`;
    document.head.appendChild(s);
  }

  /* ── Slot element upgrader ───────────────────────────────────────────── */
  const SLOT_LABELS = {
    available : { label:'Available',   icon:'🟢' },
    confirmed : { label:'Booked',      icon:'🔴' },
    booked    : { label:'Booked',      icon:'🔴' },
    past      : { label:'Time Passed', icon:'⏳' },
    locked    : { label:'Processing…', icon:'🔒' },
    pending   : { label:'Processing…', icon:'🔒' },
    closed    : { label:'Closed',      icon:'🚫' },
    selected  : { label:'Selected',    icon:'✅' },
  };

  function _upgradeSlotEl(el) {
    if (el.dataset.bmgUpgraded) return;
    el.dataset.bmgUpgraded = '1';

    const slotAttr = el.dataset.slot || '';
    const raw = (el.textContent || '').trim();
    const timeDisplay = slotAttr
      ? slotAttr.replace('-', ' – ')
      : raw.replace(/Available|Booked|Confirmed|Past|Locked|Processing|Closed|Selected|Time Passed/gi, '').trim();

    let status = 'available';
    for (const c of ['confirmed','booked','past','locked','pending','closed','selected']) {
      if (el.classList.contains(c)) { status = c; break; }
    }

    const info = SLOT_LABELS[status] || SLOT_LABELS.available;
    el.innerHTML = `
      <span class="slot-icon">${info.icon}</span>
      <span class="slot-time-text">${timeDisplay || '—'}</span>
      <span class="slot-status-tag">${info.label}</span>`;
  }

  function _upgradeContainer(c) {
    if (!c) return;
    if (!c.classList.contains('slots-grid')) c.classList.add('slots-grid');
    c.querySelectorAll('.time-slot').forEach(_upgradeSlotEl);

    // Legend
    let leg = c.previousElementSibling;
    if (!leg || !leg.classList.contains('slot-legend')) {
      leg = document.createElement('div');
      leg.className = 'slot-legend';
      leg.innerHTML = `
        <div class="slot-legend-item"><div class="slot-legend-dot available"></div>Available</div>
        <div class="slot-legend-item"><div class="slot-legend-dot booked"></div>Booked</div>
        <div class="slot-legend-item"><div class="slot-legend-dot past"></div>Time Passed</div>
        <div class="slot-legend-item"><div class="slot-legend-dot locked"></div>Processing</div>`;
      c.parentNode.insertBefore(leg, c);
    }
  }

  /* ── Real-time slot loading (replaces loadSlots) ─────────────────────── */
  let _slotUnsub = null;

  async function _loadSlotsRealtime(groundId, date) {
    const container = document.getElementById('time-slots');
    if (!container) return;

    container.innerHTML = `
      <div style="padding:2rem;text-align:center;">
        <div class="loader-spinner"></div>
        <p style="margin-top:1rem;color:var(--gray-500);">Loading slots…</p>
      </div>`;

    if (_slotUnsub) { try { _slotUnsub(); } catch (_) {} _slotUnsub = null; }

    const db = window.db;
    if (!db) return;

    // Release expired locks first
    _releaseExpiredLocks(groundId, date);

    _slotUnsub = db.collection('slots')
      .where('groundId', '==', groundId)
      .where('date', '==', date)
      .onSnapshot(snapshot => {
        const statusMap = {}, lockMap = {};
        snapshot.forEach(doc => {
          const s = doc.data();
          const k = `${s.startTime}-${s.endTime}`;
          statusMap[k] = s.status;
          lockMap[k] = s.lockedBy || s.lockOrderId || null;
        });
        _renderSlotGrid(container, statusMap, lockMap, date);
      }, () => {
        if (typeof window._origLoadSlots === 'function') window._origLoadSlots(groundId, date);
      });
  }

  function _renderSlotGrid(container, statusMap, lockMap, date) {
    const cu = window.currentUser;
    const now = new Date();
    const curMin = now.getHours() * 60 + now.getMinutes();
    const isToday = date === now.toISOString().split('T')[0];
    const sel = window.selectedSlot || null;
    const myOrd = sessionStorage.getItem('bmg_currentOrderId') || '';

    let html = '';
    for (let h = 0; h < 24; h++) {
      const s = `${String(h).padStart(2,'0')}:00`;
      const e = `${String(h+1).padStart(2,'0')}:00`;
      const key = `${s}-${e}`;
      const raw = statusMap[key] || 'available';
      const lk = lockMap[key];
      const mine = lk && cu && (lk === cu.uid || lk === myOrd);

      let cls = 'available', dis = false, icon = '🟢', label = 'Available';

      if (isToday && h * 60 <= curMin) {
        cls = 'past'; dis = true; icon = '⏳'; label = 'Time Passed';
      } else {
        switch (raw) {
          case 'booked': case 'confirmed':
            cls = 'confirmed'; dis = true; icon = '🔴'; label = 'Booked';
            break;
          case 'locked': case 'pending':
            if (mine) { cls = 'selected'; icon = '✅'; label = 'Your Slot'; }
            else { cls = 'locked'; dis = true; icon = '🔒'; label = 'Processing…'; }
            break;
          case 'closed': case 'blocked':
            cls = 'closed'; dis = true; icon = '🚫'; label = 'Closed';
            break;
        }
      }

      html += `
        <div class="time-slot ${cls}${sel === key ? ' selected' : ''}"
          data-slot="${key}" data-status="${dis ? 'disabled' : raw}"
          ${!dis ? 'data-available="true"' : ''}
          style="${cls === 'confirmed' || cls === 'booked' ? 'border-color:#ef4444!important;background:linear-gradient(135deg,#fef2f2,#fee2e2)!important;color:#991b1b!important;' : ''}">
          <span class="slot-icon">${icon}</span>
          <span class="slot-time-text">${key.replace('-', ' – ')}</span>
          <span class="slot-status-tag">${label}</span>
        </div>`;
    }

    container.innerHTML = html;
    if (!container.classList.contains('slots-grid')) container.classList.add('slots-grid');

    // Wire click handlers
    container.querySelectorAll('.time-slot[data-available="true"]').forEach(el => {
      el.addEventListener('click', () => {
        if (typeof window.selectSlot === 'function') window.selectSlot(el.dataset.slot);
      });
    });

    // Add legend
    let leg = container.previousElementSibling;
    if (!leg || !leg.classList.contains('slot-legend')) {
      leg = document.createElement('div');
      leg.className = 'slot-legend';
      leg.innerHTML = `
        <div class="slot-legend-item"><div class="slot-legend-dot available"></div>Available</div>
        <div class="slot-legend-item"><div class="slot-legend-dot booked"></div>Booked</div>
        <div class="slot-legend-item"><div class="slot-legend-dot past"></div>Time Passed</div>
        <div class="slot-legend-item"><div class="slot-legend-dot locked"></div>Processing</div>`;
      container.parentNode.insertBefore(leg, container);
    }
  }

  async function _releaseExpiredLocks(groundId, date) {
    const db = window.db;
    if (!db) return;
    try {
      const snap = await db.collection('slots')
        .where('groundId','==',groundId).where('date','==',date)
        .where('status','in',['locked','pending']).get();
      const now = Date.now(), batch = db.batch();
      let changed = false;
      snap.forEach(doc => {
        const d = doc.data();
        const exp = d.lockExpiresAtMs || d.lockExpiresAt?.toMillis?.() || 0;
        if (exp && now > exp) {
          batch.update(doc.ref, {
            status:'available', lockOrderId:null, lockExpiresAt:null,
            lockExpiresAtMs:null, lockedBy:null,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          });
          changed = true;
        }
      });
      if (changed) await batch.commit();
    } catch (_) {}
  }

  // ── Mark slot BOOKED immediately after payment ────────────────────────
  function _markSlotBookedInUI(groundId, date, slotTime) {
    document.querySelectorAll('.slot-item, .time-slot, [data-slot-time]').forEach(el => {
      const elSlot   = el.dataset.slotTime || el.dataset.slot || '';
      const elGround = el.dataset.groundId || el.closest('[data-ground-id]')?.dataset?.groundId || '';
      const elDate   = el.dataset.date || el.closest('[data-date]')?.dataset?.date || '';

      const slotMatch  = elSlot && slotTime && slotTime.includes(elSlot.split('-')[0]);
      const groundMatch= !elGround || elGround === groundId;
      const dateMatch  = !elDate   || elDate   === date;

      if (slotMatch && groundMatch && dateMatch) {
        el.classList.remove('available','selected','locked','pending');
        el.classList.add('booked','confirmed');
        el.style.cssText += 'background:linear-gradient(135deg,#fef2f2,#fee2e2)!important;border-color:#ef4444!important;color:#991b1b!important;pointer-events:none!important;cursor:not-allowed!important;';

        const icon  = el.querySelector('.slot-icon');
        const badge = el.querySelector('.slot-status-tag');
        if (icon)  icon.textContent  = '🔴';
        if (badge) { badge.textContent = 'Booked'; badge.style.cssText = 'background:rgba(239,68,68,.18)!important;color:#dc2626!important;font-weight:800!important;'; }

        delete el.dataset.available;
        el.dataset.status = 'disabled';
        el.dataset.bmgUpgraded = ''; // allow re-upgrade
        console.log('[BMG] Slot marked BOOKED instantly:', elSlot);
      }
    });

    // Also update Firestore (fire-and-forget)
    const db = window.db;
    if (!db || !groundId || !date || !slotTime) return;
    const startTime = slotTime.split('-')[0].trim();
    db.collection('slots')
      .where('groundId','==',groundId).where('date','==',date).where('startTime','==',startTime).limit(1)
      .get().then(snap => {
        if (!snap.empty) snap.docs[0].ref.update({
          status:'booked', updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }).catch(() => {});

    // Also lock it as booked (creates doc if missing)
    const [start, end] = slotTime.split('-').map(t => t.trim());
    db.collection('slots')
      .where('groundId','==',groundId).where('date','==',date).where('startTime','==',start).limit(1)
      .get().then(snap => {
        const FV = firebase.firestore.FieldValue;
        const payload = {
          groundId, date, startTime:start, endTime:end||'',
          status:'booked', lockedBy:null, lockExpiresAt:null, lockOrderId:null, lockExpiresAtMs:null,
          bookedAt:FV.serverTimestamp(), updatedAt:FV.serverTimestamp(),
        };
        if (snap.empty) {
          db.collection('slots').add(payload);
        } else {
          snap.docs[0].ref.update(payload);
        }
      }).catch(() => {});
  }

  // ── Instant slot release ─────────────────────────────────────────────
  async function _releaseMySlot() {
    const db = window.db; if (!db) return;
    let li = null;
    try { li = JSON.parse(sessionStorage.getItem('slotLock') || 'null'); } catch (_) {}
    if (!li?.orderId) return;
    try {
      const snap = await db.collection('slots').where('lockOrderId','==',li.orderId).limit(1).get();
      if (!snap.empty) await snap.docs[0].ref.update({
        status:'available', lockOrderId:null, lockExpiresAt:null, lockExpiresAtMs:null, lockedBy:null,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      await db.collection('pending_payments').doc(li.orderId).delete().catch(() => {});
    } catch (_) {}
    sessionStorage.removeItem('slotLock');
  }

  // ── Payment events → slot updates ────────────────────────────────────
  window.addEventListener('bmg:paymentConfirmed', async (e) => {
    const { paymentType, result, orderId } = e.detail || {};
    if (paymentType !== 'booking') return;
    const d = result || {};
    if (d.groundId && d.date && d.slotTime) {
      setTimeout(() => _markSlotBookedInUI(d.groundId, d.date, d.slotTime), 200);
      setTimeout(() => _markSlotBookedInUI(d.groundId, d.date, d.slotTime), 1000);
    }
    sessionStorage.removeItem('slotLock');
  });

  window.addEventListener('bmg:paymentCancelled', () => _releaseMySlot());
  window.addEventListener('bmg:paymentFailed',    () => _releaseMySlot());

  document.addEventListener('visibilitychange', () => { if (!document.hidden) _checkStaleSlotLock(); });
  window.addEventListener('pageshow', e => { if (e.persisted) _checkStaleSlotLock(); });

  async function _checkStaleSlotLock() {
    const lock = (() => { try { return JSON.parse(sessionStorage.getItem('slotLock') || 'null'); } catch { return null; } })();
    if (!lock) return;
    const overlay = document.querySelector('#payment-processing-overlay,.payment-processing-overlay');
    if (overlay && overlay.offsetParent !== null) return;
    if (Date.now() - (lock.lockedAt || 0) > 10 * 60 * 1000) await _releaseMySlot();
  }

  // Release on page navigation away from booking
  window.addEventListener('DOMContentLoaded', () => {
    const stale = sessionStorage.getItem('slotLock_needsRelease');
    if (stale && window.db) {
      sessionStorage.removeItem('slotLock_needsRelease');
      window.db.collection('slots').where('lockOrderId','==',stale).limit(1).get()
        .then(s => { if (!s.empty) s.docs[0].ref.update({ status:'available', lockOrderId:null, lockExpiresAt:null, lockExpiresAtMs:null, lockedBy:null, updatedAt:firebase.firestore.FieldValue.serverTimestamp() }); }).catch(() => {});
      window.db.collection('pending_payments').doc(stale).delete().catch(() => {});
    }
  });

  window.addEventListener('beforeunload', () => {
    try { const li = JSON.parse(sessionStorage.getItem('slotLock') || 'null'); if (li?.orderId) sessionStorage.setItem('slotLock_needsRelease', li.orderId); } catch (_) {}
  });

  // ── Boot ─────────────────────────────────────────────────────────────
  window._bmgOnReady(function () {
    _injectSlotCSS();

    // Replace loadSlots with realtime version
    window._bmgWaitFor('loadSlots', () => {
      window._origLoadSlots = window.loadSlots;
      window.loadSlots = _loadSlotsRealtime;
      console.log('✅ [BMG] loadSlots → real-time Firestore');
    });

    // Upgrade any existing slot elements
    document.querySelectorAll('#slots-container,.slots-container,[id*="slot"]').forEach(el => {
      if (el.querySelector('.time-slot')) _upgradeContainer(el);
    });

    // Watch for dynamically added slots
    new MutationObserver(muts => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.classList?.contains('time-slot')) _upgradeSlotEl(n);
        const inner = n.querySelectorAll?.('.time-slot');
        if (inner?.length) {
          inner.forEach(_upgradeSlotEl);
          const c = n.classList?.contains('slots-container') ? n : n.querySelector('#slots-container,.slots-container');
          if (c) _upgradeContainer(c);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });

  window._bmgWatchSlotsRealtime = _loadSlotsRealtime;
})();

/* ══════════════════════════════════════════════════════════════════════════
 * §5  TOURNAMENT FEATURES
 *     QR entry pass, spots counter, My Bookings tab, owner verification
 * ══════════════════════════════════════════════════════════════════════════*/
(function () {
  'use strict';

  /* ── Generate QR data URL ────────────────────────────────────────────── */
  async function _genQR(payload, size) {
    const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
    if (typeof QRCode !== 'undefined' && typeof QRCode.toDataURL === 'function') {
      try { return await QRCode.toDataURL(str, { width: size || 200, margin: 2, errorCorrectionLevel: 'M' }); } catch (_) {}
    }
    if (typeof window.QRCode === 'function') {
      return new Promise(resolve => {
        const tmp = document.createElement('div');
        tmp.style.cssText = 'position:absolute;left:-9999px;top:-9999px;';
        document.body.appendChild(tmp);
        try { new window.QRCode(tmp, { text: str, width: size||200, height: size||200 }); } catch (_) {}
        setTimeout(() => {
          const img = tmp.querySelector('img');
          const url = img?.src || '';
          try { document.body.removeChild(tmp); } catch (_) {}
          resolve(url);
        }, 400);
      });
    }
    return '';
  }

  /* ── Tournament entry pass modal ─────────────────────────────────────── */
  async function showTournamentEntryPass(entryId) {
    const db = window.db; if (!db) return;
    window._bmgShowLoading('Generating tournament pass...');
    try {
      let entryDoc = await db.collection('tournament_entries').doc(entryId).get();
      if (!entryDoc.exists) {
        const snap = await db.collection('tournament_entries').where('orderId','==',entryId).limit(1).get();
        if (!snap.empty) entryDoc = snap.docs[0];
      }
      if (!entryDoc || !entryDoc.exists) { window._bmgToast('Entry not found','error'); return; }
      const entry = entryDoc.data ? entryDoc.data() : entryDoc;
      const id    = entryDoc.id || entryId;

      const qrPayload = {
        appId:'BookMyGame', type:'tournament',
        entryId:id, tournamentId:entry.tournamentId||'',
        tournamentName:entry.tournamentName||'', userId:entry.userId||'',
        userName:entry.userName||'', teamName:entry.teamName||'',
        sport:entry.sport||'', date:entry.date||'', venue:entry.venue||'',
        amount:entry.amount||entry.entryFee||0,
        validFrom:new Date(Date.now()-24*60*60*1000).toISOString(),
        validTo  :new Date(Date.now()+30*24*60*60*1000).toISOString(),
      };
      const qrDataUrl = await _genQR(qrPayload, 180);
      document.getElementById('bmg-tourn-pass-modal')?.remove();

      const modal = document.createElement('div');
      modal.id = 'bmg-tourn-pass-modal';
      modal.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;padding:20px;';
      modal.innerHTML=`
        <div style="background:#fff;border-radius:20px;max-width:400px;width:100%;padding:28px 24px;position:relative;box-shadow:0 20px 60px rgba(0,0,0,.4);max-height:90vh;overflow-y:auto;">
          <button onclick="document.getElementById('bmg-tourn-pass-modal').remove();"
            style="position:absolute;top:14px;right:14px;border:none;background:none;font-size:22px;cursor:pointer;color:#666;">✕</button>
          <div style="text-align:center;margin-bottom:20px;">
            <div style="width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#10b981,#059669);display:inline-flex;align-items:center;justify-content:center;margin-bottom:10px;">
              <i class="fas fa-trophy" style="color:#fff;font-size:22px;"></i>
            </div>
            <h3 style="margin:0;font-size:20px;font-weight:700;color:#111;">Tournament Entry Pass</h3>
          </div>
          <div style="background:#f9fafb;border-radius:14px;padding:16px;margin-bottom:16px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:8px;"><span style="color:#6b7280;font-size:13px;">Tournament</span><span style="font-weight:600;font-size:13px;">${window._esc(entry.tournamentName||'N/A')}</span></div>
            <div style="display:flex;justify-content:space-between;margin-bottom:8px;"><span style="color:#6b7280;font-size:13px;">Player</span><span style="font-weight:600;font-size:13px;">${window._esc(entry.userName||'N/A')}</span></div>
            ${entry.teamName?`<div style="display:flex;justify-content:space-between;margin-bottom:8px;"><span style="color:#6b7280;font-size:13px;">Team</span><span style="font-weight:600;font-size:13px;">${window._esc(entry.teamName)}</span></div>`:''}
            ${entry.sport?`<div style="display:flex;justify-content:space-between;margin-bottom:8px;"><span style="color:#6b7280;font-size:13px;">Sport</span><span style="font-weight:600;font-size:13px;">${window._esc(entry.sport)}</span></div>`:''}
            ${entry.date?`<div style="display:flex;justify-content:space-between;margin-bottom:8px;"><span style="color:#6b7280;font-size:13px;">Date</span><span style="font-weight:600;font-size:13px;">${entry.date}</span></div>`:''}
            ${entry.venue?`<div style="display:flex;justify-content:space-between;margin-bottom:8px;"><span style="color:#6b7280;font-size:13px;">Venue</span><span style="font-weight:600;font-size:13px;">${window._esc(entry.venue)}</span></div>`:''}
            <div style="display:flex;justify-content:space-between;"><span style="color:#6b7280;font-size:13px;">Entry ID</span><span style="font-family:monospace;font-size:11px;">${id.slice(0,16)}…</span></div>
          </div>
          <div style="text-align:center;padding:20px;background:#fff;border:2px dashed #e5e7eb;border-radius:14px;margin-bottom:16px;">
            ${qrDataUrl?`<img src="${qrDataUrl}" alt="QR" style="width:180px;height:180px;">`:`<div style="width:180px;height:180px;display:inline-flex;align-items:center;justify-content:center;background:#f3f4f6;border-radius:8px;color:#9ca3af;font-size:13px;">QR unavailable</div>`}
            <p style="margin:10px 0 0;font-size:12px;color:#6b7280;">Show this QR to the organiser for entry</p>
          </div>
          <div style="text-align:center;padding:10px;background:#ecfdf5;border-radius:10px;">
            <span style="color:#059669;font-weight:700;font-size:14px;"><i class="fas fa-check-circle"></i> Registration Confirmed</span>
          </div>
        </div>`;
      document.body.appendChild(modal);
      modal.addEventListener('click', e => { if (e.target===modal) modal.remove(); });
    } catch (err) {
      console.error('[BMG] showTournamentEntryPass error:', err);
      window._bmgToast('Error loading entry pass','error');
    } finally { window._bmgHideLoading(); }
  }
  window.showTournamentEntryPass = showTournamentEntryPass;

  /* ══════════════════════════════════════════════════════════════════
   *  BMG PROFESSIONAL VERIFICATION RESULT MODAL
   *  Shows a full-screen modal with all booking/tournament details
   *  after owner scans a QR code. Replaces the tiny inline resultDiv.
   * ══════════════════════════════════════════════════════════════════*/

  /* ── Inject verification modal styles once ──────────────────────── */
  (function _injectVerifStyles() {
    if (document.getElementById('bmg-verif-styles')) return;
    const s = document.createElement('style');
    s.id = 'bmg-verif-styles';
    s.textContent = `
/* ── Scanner modal: centred on screen ── */
#professional-qr-modal {
  align-items: center !important;
  justify-content: center !important;
}
.qr-scanner-container {
  border-radius: 24px !important;
  max-width: 440px !important;
  width: calc(100% - 32px) !important;
  margin: 0 auto !important;
}
/* ── Verification result overlay ── */
#bmg-verif-overlay {
  position: fixed;
  inset: 0;
  z-index: 99999;
  background: rgba(0,0,0,0.72);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  animation: bmgVerifFadeIn .25s ease;
}
@keyframes bmgVerifFadeIn { from{opacity:0} to{opacity:1} }
#bmg-verif-card {
  background: #fff;
  border-radius: 24px;
  overflow: hidden;
  max-width: 400px;
  width: 100%;
  box-shadow: 0 32px 80px rgba(0,0,0,0.45);
  max-height: 90vh;
  overflow-y: auto;
  animation: bmgVerifSlideUp .32s cubic-bezier(.34,1.56,.64,1);
}
@keyframes bmgVerifSlideUp { from{transform:translateY(32px) scale(.96);opacity:0} to{transform:translateY(0) scale(1);opacity:1} }
.bmg-vr-header {
  padding: 28px 24px 20px;
  text-align: center;
  position: relative;
}
.bmg-vr-header.success { background: linear-gradient(135deg, #065f46, #10b981); }
.bmg-vr-header.error   { background: linear-gradient(135deg, #7f1d1d, #ef4444); }
.bmg-vr-header.warning { background: linear-gradient(135deg, #78350f, #f59e0b); }
.bmg-vr-status-ring {
  width: 80px; height: 80px;
  border-radius: 50%;
  background: rgba(255,255,255,0.18);
  border: 3px solid rgba(255,255,255,0.35);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 14px;
  font-size: 36px;
}
.bmg-vr-header h2 {
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 800;
  color: #fff;
  letter-spacing: -0.3px;
}
.bmg-vr-header p {
  margin: 0;
  font-size: 13px;
  color: rgba(255,255,255,0.78);
}
.bmg-vr-timestamp {
  position: absolute;
  top: 14px; right: 14px;
  font-size: 10px;
  color: rgba(255,255,255,0.6);
  font-weight: 600;
  background: rgba(255,255,255,0.12);
  padding: 3px 8px;
  border-radius: 20px;
}
.bmg-vr-body {
  padding: 20px;
  background: #f8fafc;
}
.bmg-vr-section {
  background: #fff;
  border-radius: 16px;
  overflow: hidden;
  margin-bottom: 12px;
  border: 1.5px solid #e8edf8;
}
.bmg-vr-section-title {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: #6b7280;
  padding: 10px 16px 6px;
  border-bottom: 1px solid #f0f4ff;
  background: #fafbff;
}
.bmg-vr-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 11px 16px;
  border-bottom: 1px solid #f0f4ff;
}
.bmg-vr-row:last-child { border-bottom: none; }
.bmg-vr-row-icon {
  width: 32px; height: 32px;
  border-radius: 10px;
  background: #eff6ff;
  display: flex; align-items: center; justify-content: center;
  color: #2563eb;
  font-size: 14px;
  flex-shrink: 0;
}
.bmg-vr-row-label {
  font-size: 10px;
  font-weight: 700;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  display: block;
  margin-bottom: 2px;
}
.bmg-vr-row-value {
  font-size: 14px;
  font-weight: 700;
  color: #111827;
  display: block;
  word-break: break-all;
}
.bmg-vr-row-value.mono {
  font-family: 'Courier New', monospace;
  font-size: 12px;
  color: #374151;
}
.bmg-vr-status-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 700;
}
.bmg-vr-status-chip.confirmed { background:#dcfce7; color:#15803d; }
.bmg-vr-status-chip.cancelled { background:#fee2e2; color:#dc2626; }
.bmg-vr-status-chip.pending   { background:#fef3c7; color:#92400e; }
.bmg-vr-amount-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: linear-gradient(135deg,#eff6ff,#dbeafe);
  color: #1d4ed8;
  padding: 5px 14px;
  border-radius: 20px;
  font-size: 16px;
  font-weight: 800;
  border: 1px solid #bfdbfe;
}
.bmg-vr-footer {
  padding: 16px 20px calc(16px + env(safe-area-inset-bottom, 0px));
  background: #fff;
  display: flex;
  gap: 10px;
  border-top: 1px solid #f0f4ff;
}
.bmg-vr-btn {
  flex: 1;
  padding: 13px;
  border: none;
  border-radius: 14px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: all .2s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.bmg-vr-btn.primary {
  background: linear-gradient(135deg, #1b2e6c, #2563eb);
  color: #fff;
  box-shadow: 0 4px 14px rgba(37,99,235,0.3);
}
.bmg-vr-btn.secondary {
  background: #f3f4f6;
  color: #374151;
}
.bmg-vr-btn:hover { filter: brightness(1.05); transform: translateY(-1px); }
/* Hide old inline result div */
#professional-qr-result { display: none !important; }
    `;
    document.head.appendChild(s);
  })();

  /* ── Show the full verification result modal ─────────────────────── */
  function _bmgShowVerifModal(opts) {
    /* opts: { success, title, subtitle, sections[], scannerType } */
    const existing = document.getElementById('bmg-verif-overlay');
    if (existing) existing.remove();

    const now = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    const headerCls = opts.success ? 'success' : (opts.warning ? 'warning' : 'error');
    const emoji     = opts.success ? '✅' : (opts.warning ? '⚠️' : '❌');

    let sectionsHTML = '';
    (opts.sections || []).forEach(sec => {
      const rowsHTML = (sec.rows || []).map(row => {
        const iconBg = row.iconBg || '#eff6ff';
        const iconColor = row.iconColor || '#2563eb';
        let valueHTML = '';
        if (row.chip) {
          valueHTML = `<span class="bmg-vr-status-chip ${row.chipCls||''}">${row.chipIcon||''} ${window._esc(row.value)}</span>`;
        } else if (row.amount) {
          valueHTML = `<span class="bmg-vr-amount-badge"><i class="fas fa-rupee-sign" style="font-size:12px;"></i>${window._esc(row.value)}</span>`;
        } else {
          valueHTML = `<span class="bmg-vr-row-value ${row.mono?'mono':''}">${window._esc(String(row.value||'—'))}</span>`;
        }
        return `<div class="bmg-vr-row">
          <div class="bmg-vr-row-icon" style="background:${iconBg};color:${iconColor}"><i class="fas ${row.icon||'fa-info'}"></i></div>
          <div style="flex:1;min-width:0;">
            <span class="bmg-vr-row-label">${window._esc(row.label)}</span>
            ${valueHTML}
          </div>
        </div>`;
      }).join('');
      sectionsHTML += `<div class="bmg-vr-section">
        ${sec.title ? `<div class="bmg-vr-section-title">${window._esc(sec.title)}</div>` : ''}
        ${rowsHTML}
      </div>`;
    });

    const overlay = document.createElement('div');
    overlay.id = 'bmg-verif-overlay';
    overlay.innerHTML = `
      <div id="bmg-verif-card">
        <div class="bmg-vr-header ${headerCls}">
          <div class="bmg-vr-timestamp">🕐 ${now}</div>
          <div class="bmg-vr-status-ring">${emoji}</div>
          <h2>${window._esc(opts.title)}</h2>
          <p>${window._esc(opts.subtitle||'')}</p>
        </div>
        <div class="bmg-vr-body">${sectionsHTML}</div>
        <div class="bmg-vr-footer">
          <button class="bmg-vr-btn secondary" id="bmg-vr-close">
            <i class="fas fa-times"></i> Close
          </button>
          <button class="bmg-vr-btn primary" id="bmg-vr-scan-again">
            <i class="fas fa-qrcode"></i> Scan Next
          </button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.getElementById('bmg-vr-close').addEventListener('click', () => overlay.remove());
    document.getElementById('bmg-vr-scan-again').addEventListener('click', () => {
      overlay.remove();
      /* Resume scanner */
      const scannerModal = document.getElementById('professional-qr-modal');
      if (scannerModal && scannerModal.style.display !== 'none') return; /* already open */
      if (typeof window.showProfessionalQRScanner === 'function') window.showProfessionalQRScanner();
    });
  }

  /* Install as global for paymentService.js to call too */
  window.showVerificationResult = function(success, booking, errorMsg) {
    if (success && booking) {
      const statusChipCls = (booking.bookingStatus||'confirmed').toLowerCase() === 'confirmed' ? 'confirmed' : 'pending';
      _bmgShowVerifModal({
        success: true,
        title: '✅ Booking Verified!',
        subtitle: 'Entry granted — booking is confirmed & valid',
        sections: [
          {
            title: 'Booking Status',
            rows: [
              {
                label: 'Status',
                icon: 'fa-check-circle',
                iconBg: '#dcfce7', iconColor: '#15803d',
                chip: true, chipCls: 'confirmed',
                chipIcon: '✅',
                value: 'Confirmed & Paid',
              },
              {
                label: 'Booking ID',
                icon: 'fa-hashtag',
                iconBg: '#eff6ff', iconColor: '#2563eb',
                mono: true,
                value: (booking.bookingId || booking.id || 'N/A').slice(-12),
              },
            ],
          },
          {
            title: 'Player Details',
            rows: [
              { label:'Player Name', icon:'fa-user', value: booking.userName || booking.userPhone || 'N/A' },
              { label:'Phone', icon:'fa-phone', value: booking.userPhone || booking.phone || '—' },
              { label:'Email', icon:'fa-envelope', value: booking.userEmail || booking.email || '—' },
            ],
          },
          {
            title: 'Booking Details',
            rows: [
              { label:'Ground', icon:'fa-map-marker-alt', iconBg:'#fff7ed', iconColor:'#c2410c', value: booking.groundName || '—' },
              { label:'Venue', icon:'fa-building', value: booking.venueName || '—' },
              { label:'Date', icon:'fa-calendar-alt', iconBg:'#f0fdf4', iconColor:'#15803d', value: booking.date || '—' },
              { label:'Time Slot', icon:'fa-clock', iconBg:'#f0fdf4', iconColor:'#15803d', value: booking.slotTime || '—' },
              { label:'Sport', icon:'fa-running', value: booking.sportType || booking.sport || '—' },
              { label:'Amount Paid', icon:'fa-rupee-sign', iconBg:'#eff6ff', iconColor:'#1d4ed8', amount:true, value: String(booking.amount || 0) },
            ],
          },
        ],
      });
    } else {
      _bmgShowVerifModal({
        success: false,
        title: 'Verification Failed',
        subtitle: errorMsg || 'This QR code could not be verified',
        sections: [
          {
            title: 'Error Details',
            rows: [
              {
                label: 'Reason',
                icon: 'fa-exclamation-circle',
                iconBg: '#fee2e2', iconColor: '#dc2626',
                value: errorMsg || 'Unknown error',
              },
            ],
          },
        ],
      });
    }
  };

  /* ── Tournament QR verification (owner scanner) ──────────────────────── */
  async function verifyTournamentQR(qrObject) {
    const db = window.db, cu = window.currentUser;
    try {
      if (qrObject.appId !== 'BookMyGame') throw new Error('Not a BookMyGame QR code');
      const now = new Date();
      if (new Date(qrObject.validTo) < now) throw new Error('QR code has expired');
      const entryDoc = await db.collection('tournament_entries').doc(qrObject.entryId).get();
      if (!entryDoc.exists) throw new Error('Tournament entry not found');
      const entry = entryDoc.data();
      if (entry.status === 'cancelled') throw new Error('Registration was cancelled');
      if (entry.tournamentEntryStatus === 'used') throw new Error('Entry already scanned');
      await entryDoc.ref.update({
        tournamentEntryStatus:'used', scannedAt:firebase.firestore.FieldValue.serverTimestamp(),
        scannedBy:cu?.uid||'unknown', scannedByName:cu?.name||cu?.ownerName||'Owner',
      });
      _bmgShowVerifModal({
        success: true,
        title: 'Tournament Entry Verified!',
        subtitle: window._esc(entry.tournamentName || 'Tournament'),
        sections: [
          {
            title: 'Entry Status',
            rows: [
              { label:'Status', icon:'fa-check-circle', iconBg:'#dcfce7', iconColor:'#15803d', chip:true, chipCls:'confirmed', chipIcon:'✅', value:'Entry Granted' },
            ],
          },
          {
            title: 'Participant Details',
            rows: [
              { label:'Player Name', icon:'fa-user', value: entry.userName || '—' },
              ...(entry.teamName ? [{ label:'Team', icon:'fa-users', value: entry.teamName }] : []),
              { label:'Sport', icon:'fa-running', value: entry.sport || '—' },
              { label:'Tournament', icon:'fa-trophy', iconBg:'#fef3c7', iconColor:'#92400e', value: entry.tournamentName || '—' },
              ...(entry.date ? [{ label:'Event Date', icon:'fa-calendar-alt', value: entry.date }] : []),
              ...(entry.venue ? [{ label:'Venue', icon:'fa-map-marker-alt', value: entry.venue }] : []),
              { label:'Entry ID', icon:'fa-hashtag', mono:true, value: (qrObject.entryId||'').slice(-12) },
            ],
          },
        ],
      });
      window._bmgToast('✅ Tournament entry verified!','success');
    } catch (err) {
      _bmgShowVerifModal({
        success: false,
        title: 'Verification Failed',
        subtitle: 'Tournament entry could not be verified',
        sections: [{
          title: 'Error Details',
          rows: [{ label:'Reason', icon:'fa-exclamation-circle', iconBg:'#fee2e2', iconColor:'#dc2626', value: err.message }],
        }],
      });
      window._bmgToast('❌ ' + err.message, 'error');
    }
  }
  window.verifyTournamentQR = verifyTournamentQR;

  /* ── Patch processVerifiedQRCode to handle tournament + compact format ── */
  window._bmgWaitFor('processVerifiedQRCode', () => {
    const _orig = window.processVerifiedQRCode;
    window.processVerifiedQRCode = async function (qrData) {
      if (!qrData) return;
      qrData = qrData.trim();
      if (qrData.startsWith('BMG|')) { await _verifyBookingQRCompact(qrData.slice(4)); return; }
      let parsed = null;
      try { parsed = JSON.parse(qrData); } catch (_) { return _orig(qrData); }
      if (parsed?.type === 'tournament') { return verifyTournamentQR(parsed); }
      if (parsed?.bid || parsed?.bookingId) { await _verifyBookingQRCompact(parsed.bid || parsed.bookingId); return; }
      return _orig(qrData);
    };
  });

  async function _verifyBookingQRCompact(bookingId) {
    const db = window.db, cu = window.currentUser;
    if (!db || !cu) { window._bmgToast('Please log in to verify','error'); return; }
    try {
      const directDoc = await db.collection('bookings').doc(bookingId).get().catch(() => null);
      let booking = null;
      if (directDoc?.exists) { booking = { id:directDoc.id, ...directDoc.data() }; }
      else {
        const snap = await db.collection('bookings').where('bookingId','==',bookingId).limit(1).get();
        if (!snap.empty) booking = { id:snap.docs[0].id, ...snap.docs[0].data() };
      }
      if (!booking) {
        _bmgShowVerifModal({
          success: false,
          title: 'Booking Not Found',
          subtitle: 'No booking matched this QR code',
          sections: [{ title:'Error Details', rows:[{ label:'Booking ID Scanned', icon:'fa-hashtag', mono:true, value: bookingId.slice(-16) }] }],
        });
        window._bmgToast('Booking not found','error');
        return;
      }
      const confirmed = booking.bookingStatus==='confirmed'||booking.status==='confirmed'||booking.paymentStatus==='PAID';
      if (confirmed) {
        window.showVerificationResult(true, booking);
        window._bmgToast('✅ Valid booking confirmed','success');
      } else {
        const statusLabel = booking.bookingStatus || booking.status || 'unknown';
        const chipCls = statusLabel === 'cancelled' ? 'cancelled' : 'pending';
        _bmgShowVerifModal({
          success: false,
          title: 'Booking Not Confirmed',
          subtitle: 'This booking has not been paid or confirmed',
          sections: [
            {
              title: 'Booking Status',
              rows: [
                { label:'Current Status', icon:'fa-exclamation-circle', iconBg:'#fee2e2', iconColor:'#dc2626', chip:true, chipCls, chipIcon:'⚠️', value: statusLabel },
                { label:'Booking ID', icon:'fa-hashtag', mono:true, value: (booking.bookingId||booking.id||'').slice(-12) },
                { label:'Player', icon:'fa-user', value: booking.userName || '—' },
                { label:'Ground', icon:'fa-map-marker-alt', value: booking.groundName || '—' },
                { label:'Date', icon:'fa-calendar-alt', value: booking.date || '—' },
                { label:'Slot', icon:'fa-clock', value: booking.slotTime || '—' },
              ],
            },
          ],
        });
        window._bmgToast('❌ Booking not confirmed','error');
      }
    } catch (err) {
      _bmgShowVerifModal({
        success: false,
        title: 'Verification Error',
        subtitle: 'An error occurred while verifying',
        sections: [{ title:'Error Details', rows:[{ label:'Details', icon:'fa-exclamation-triangle', iconBg:'#fee2e2', iconColor:'#dc2626', value: err.message }] }],
      });
      window._bmgToast('Verify error: '+err.message,'error');
    }
  }

  /* ── _showTournamentJoinedSuccess with QR ────────────────────────────── */
  window._showTournamentJoinedSuccess = function (data) {
    // Generate QR and show success modal
    _genQR({
      appId:'BookMyGame', type:'tournament_entry',
      tournamentId:data.tournamentId||'', registrationId:data.registrationId||data.orderId||'',
      userId:data.userId||window.currentUser?.uid||'', teamName:data.teamName||'',
      tournamentName:data.tournamentName||'', sport:data.sport||'',
    }, 200).then(qrDataUrl => {
      const modal = document.createElement('div');
      modal.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;padding:20px;';
      modal.innerHTML=`
        <div style="background:#fff;border-radius:20px;max-width:380px;width:100%;padding:28px;text-align:center;box-shadow:0 24px 64px rgba(0,0,0,.35);max-height:90vh;overflow-y:auto;">
          <div style="width:72px;height:72px;background:linear-gradient(135deg,#10b981,#059669);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;">
            <i class="fas fa-trophy" style="color:#fff;font-size:30px;"></i>
          </div>
          <h2 style="margin:0 0 6px;font-size:22px;font-weight:800;color:#111;">Registration Confirmed! 🎉</h2>
          <p style="color:#6b7280;font-size:14px;margin:0 0 20px;">${window._esc(data.tournamentName||'Tournament')}</p>
          ${qrDataUrl?`<div style="background:#f9fafb;border-radius:16px;padding:16px;margin-bottom:16px;"><img src="${qrDataUrl}" style="width:180px;height:180px;"><p style="font-size:12px;color:#6b7280;margin:8px 0 0;">Show to organiser at the event</p></div>`:''}
          <button onclick="this.closest('[style*=fixed]').remove();if(typeof window.loadMyTournaments==='function')window.loadMyTournaments();"
            style="width:100%;padding:14px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:14px;font-size:15px;font-weight:700;cursor:pointer;">
            View My Tournaments
          </button>
        </div>`;
      document.body.appendChild(modal);
      modal.addEventListener('click', e => { if (e.target===modal) modal.remove(); });
    });
  };

  /* ── loadUserBookings: add pool bookings section + tournament entries ──── */
  window._bmgWaitFor('loadUserBookings', () => {
    const _orig = window.loadUserBookings;
    window.loadUserBookings = async function (status) {
      // Run original (ground bookings only — pool section removed from app.js)
      await _orig(status);
      const cu = window.currentUser;
      const db = window.db;
      if (!cu || !db) return;
      const container = document.getElementById('user-bookings-list');
      if (!container) return;
      const today = new Date().toISOString().split('T')[0];

      // ── SECTION 1: Swimming Pool Bookings ────────────────────────────────
      // Only add if bmg_swimming_pool_fix.js hasn't already added them
      // (it sets _poolPatched on loadUserBookings — but since we're the last
      //  patcher, we handle pool cards here and skip in swimming pool fix)
      try {
        let poolSnap = await db.collection('pool_bookings')
          .where('userId','==',cu.uid)
          .orderBy('createdAt','desc')
          .get()
          .catch(() => db.collection('pool_bookings').where('userId','==',cu.uid).get());

        if (!poolSnap.empty) {
          let poolDocs = poolSnap.docs.map(d => ({ _docId: d.id, ...d.data() }));

          // Filter by tab
          poolDocs = poolDocs.filter(b => {
            const bDate = b.date || '';
            const bStat = b.bookingStatus || b.status || '';
            if (status === 'upcoming') return bDate >= today && bStat === 'confirmed';
            if (status === 'past')     return bDate < today || bStat === 'completed' || bStat === 'cancelled';
            return false;
          });

          if (poolDocs.length > 0) {
            const empty = container.querySelector('.empty-state');
            if (empty) empty.remove();

            // Section header
            const poolSection = document.createElement('div');
            poolSection.id = 'bmg-pool-bookings-section';
            poolSection.style.cssText = 'margin-top:20px;';
            poolSection.innerHTML =
              '<div style="display:flex;align-items:center;gap:10px;padding:10px 0 12px;border-top:2px solid #e0f2fe;">' +
                '<div style="width:34px;height:34px;background:linear-gradient(135deg,#0369a1,#0ea5e9);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;">🏊</div>' +
                '<h4 style="margin:0;font-size:15px;font-weight:800;color:#0c4a6e;letter-spacing:-.2px;">Swimming Pool Bookings</h4>' +
                '<span style="margin-left:auto;background:#e0f2fe;color:#0369a1;font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px;">' + poolDocs.length + '</span>' +
              '</div>';

            poolDocs.forEach(b => {
              const bStatus     = b.bookingStatus || b.status || 'pending';
              const isConfirmed = bStatus === 'confirmed';
              const isCancelled = bStatus === 'cancelled';
              const isCompleted = bStatus === 'completed';
              const memberCount = b.memberCount || b.currentMembers || 1;
              const perPer      = b.pricePerMember || (b.amount && memberCount > 1 ? Math.round(b.amount / memberCount) : b.amount) || 0;
              const total       = b.amount || (perPer * memberCount);
              const bookingId   = b.bookingId || b.orderId || b._docId;
              const isPassed    = b.date < today && !isCompleted;

              let dateLabel = b.date || 'Date TBD';
              try { dateLabel = new Date(b.date).toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'}); } catch(_){}

              const scMap = {
                confirmed: { icon:'fa-check-circle', label:'Confirmed', cls:'confirmed' },
                cancelled:  { icon:'fa-times-circle', label:'Cancelled', cls:'cancelled' },
                completed:  { icon:'fa-flag-checkered', label:'Completed', cls:'completed' },
              };
              const sc = scMap[bStatus] || { icon:'fa-hourglass-half', label:'Pending', cls:'pending' };

              const card = document.createElement('div');
              card.className = 'bk-card bk-card--' + sc.cls;
              card.style.cssText = 'border-top:3px solid #0ea5e9;margin-bottom:12px;';
              card.innerHTML =
                '<div class="bk-card__header">' +
                  '<div class="bk-card__sport-badge">🏊</div>' +
                  '<div class="bk-card__title-block">' +
                    '<div class="bk-card__ground-name">' + window._esc(b.poolName || 'Swimming Pool') + '</div>' +
                    '<div class="bk-card__venue-name" style="color:#0ea5e9;font-weight:700;">' +
                      '<i class="fas fa-users" style="font-size:9px"></i> ' + memberCount + ' member' + (memberCount > 1 ? 's' : '') +
                    '</div>' +
                  '</div>' +
                  '<div class="bk-card__status-pill bk-card__status-pill--' + sc.cls + '">' +
                    '<i class="fas ' + sc.icon + '"></i> ' + sc.label +
                  '</div>' +
                '</div>' +
                '<div class="bk-card__divider"></div>' +
                '<div class="bk-card__details">' +
                  '<div class="bk-card__detail-row"><span class="bk-card__detail-icon"><i class="fas fa-calendar-alt"></i></span><span class="bk-card__detail-text">' + window._esc(dateLabel) + '</span></div>' +
                  '<div class="bk-card__detail-row"><span class="bk-card__detail-icon"><i class="fas fa-clock"></i></span><span class="bk-card__detail-text">' + window._esc(b.slotTime || 'Time TBD') + '</span></div>' +
                  '<div class="bk-card__detail-row"><span class="bk-card__detail-icon"><i class="fas fa-map-marker-alt"></i></span><span class="bk-card__detail-text">' + window._esc(b.poolAddress || 'Address not available') + '</span></div>' +
                  '<div class="bk-card__detail-row"><span class="bk-card__detail-icon"><i class="fas fa-rupee-sign"></i></span><span class="bk-card__detail-text bk-card__amount">₹' + total + (memberCount > 1 ? ' <span style="font-size:11px;color:#64748b">(₹' + perPer + '/person)</span>' : '') + '</span></div>' +
                '</div>' +
                (isPassed ? '<div class="bk-card__alert"><i class="fas fa-exclamation-circle"></i> Booking date has passed</div>' : '') +
                '<div class="bk-card__footer">' +
                  '<span class="bk-card__booking-id"><i class="fas fa-hashtag"></i> ' + window._esc(bookingId.slice(-10)) + '</span>' +
                  (isConfirmed
                    ? '<button class="bk-card__pass-btn bmg-pool-btn" data-bid="' + window._esc(bookingId) + '" style="background:linear-gradient(135deg,#0369a1,#0ea5e9);border:none;"><i class="fas fa-swimmer"></i> Pool Pass</button>'
                    : '') +
                  (isCompleted ? '<span class="bk-card__done-chip"><i class="fas fa-check-double"></i> Completed</span>' : '') +
                  (isCancelled ? '<span class="bk-card__cancel-chip"><i class="fas fa-ban"></i> Cancelled</span>' : '') +
                '</div>';

              poolSection.appendChild(card);
            });

            container.appendChild(poolSection);

            // Wire pool pass buttons
            // bmg_pool_entry_fix.js (loads last) defines showPoolEntryPass(docId, bookingData)
            // bmg_swimming_pool_fix.js defines showPoolEntryPass(bookingId) — 1 arg
            // We fetch the doc first so both signatures are satisfied.
            container.querySelectorAll('.bmg-pool-btn').forEach(btn => {
              btn.addEventListener('click', async () => {
                const bid = btn.getAttribute('data-bid');
                if (typeof window.showPoolEntryPass !== 'function') {
                  window.showEntryPass(bid); return;
                }
                // Fetch the pool booking doc so we can pass data to the 2-arg version
                try {
                  const db = window.db;
                  let docId = bid, bookingData = null;
                  // Try by doc ID first
                  const byId = await db.collection('pool_bookings').doc(bid).get().catch(() => null);
                  if (byId && byId.exists) {
                    docId = byId.id; bookingData = byId.data();
                  } else {
                    // Try by bookingId field
                    const snap = await db.collection('pool_bookings').where('bookingId','==',bid).limit(1).get().catch(() => null);
                    if (snap && !snap.empty) { docId = snap.docs[0].id; bookingData = snap.docs[0].data(); }
                  }
                  if (bookingData) {
                    window.showPoolEntryPass(docId, bookingData);
                  } else {
                    // No data found — try single-arg call (bmg_swimming_pool_fix version)
                    window.showPoolEntryPass(bid);
                  }
                } catch(e) {
                  window.showPoolEntryPass(bid); // fallback to 1-arg
                }
              });
            });
          }
        }
      } catch (_) {}

      // ── SECTION 2: Tournament Registrations ─────────────────────────────
      try {
        const snap = await db.collection('tournament_entries').where('userId','==',cu.uid).orderBy('createdAt','desc').get();
        if (snap.empty) return;
        let entries = snap.docs.map(d => ({ id:d.id, ...d.data() }));
        if (status === 'upcoming') entries = entries.filter(e => (!e.date||e.date>=today) && e.status!=='cancelled');
        else if (status === 'past') entries = entries.filter(e => (e.date&&e.date<today) || e.status==='cancelled');
        if (!entries.length) return;

        const empty = container.querySelector('.empty-state');
        if (empty) empty.remove();

        const tournSection = document.createElement('div');
        tournSection.style.cssText = 'margin-top:20px;';
        tournSection.innerHTML =
          '<div style="display:flex;align-items:center;gap:10px;padding:10px 0 12px;border-top:2px solid #d1fae5;">' +
            '<div style="width:34px;height:34px;background:linear-gradient(135deg,#059669,#10b981);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;">🏆</div>' +
            '<h4 style="margin:0;font-size:15px;font-weight:800;color:#064e3b;letter-spacing:-.2px;">Tournament Registrations</h4>' +
            '<span style="margin-left:auto;background:#d1fae5;color:#059669;font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px;">' + entries.length + '</span>' +
          '</div>';

        const html = entries.map(e => `
          <div class="booking-card status-${e.status||'confirmed'}" style="border-left:4px solid #10b981;margin-bottom:14px;">
            <div class="booking-status">🏆 Tournament — ${e.status==='confirmed'?'Confirmed':e.status==='cancelled'?'Cancelled':'Registered'}</div>
            <h4 style="margin:10px 0 6px;font-weight:700;">${window._esc(e.tournamentName||'Tournament')}</h4>
            ${e.sport?`<p><i class="fas fa-futbol"></i> ${window._esc(e.sport)}</p>`:''}
            ${e.teamName?`<p><i class="fas fa-users"></i> Team: ${window._esc(e.teamName)}</p>`:''}
            ${e.date?`<p><i class="fas fa-calendar"></i> ${e.date}</p>`:''}
            ${e.venue?`<p><i class="fas fa-map-pin"></i> ${window._esc(e.venue)}</p>`:''}
            <p><i class="fas fa-rupee-sign"></i> Entry Fee: ₹${e.amount||e.entryFee||0}</p>
            ${e.status!=='cancelled'?`<button class="auth-btn" onclick="showTournamentEntryPass('${e.id}')" style="margin-top:10px;background:linear-gradient(135deg,#10b981,#059669);"><i class="fas fa-qrcode"></i> View Tournament Pass</button>`:''}
          </div>`).join('');

        tournSection.innerHTML += html;
        container.appendChild(tournSection);
      } catch (_) {}
    };
  });

  /* ── Tournament spots real-time counter ──────────────────────────────── */
  let _tournamentListener = null;
  function _startTournamentListener(tournamentId) {
    if (_tournamentListener) { _tournamentListener(); _tournamentListener = null; }
    const db = window.db;
    if (!db || !tournamentId) return;
    _tournamentListener = db.collection('tournaments').doc(tournamentId).onSnapshot(doc => {
      if (!doc.exists) return;
      const t = doc.data();
      const spots = Math.max(0, (t.maxTeams||0) - (t.registeredTeams||t.currentTeams||0));
      document.querySelectorAll('[data-tournament-spots],.tournament-spots-value,.spots-left-value').forEach(el => { el.textContent = spots; });
      document.querySelectorAll('.info-value').forEach(el => {
        if (/\d+\s*\/\s*\d+/.test(el.textContent.trim())) el.textContent = `${spots}/${t.maxTeams||0}`;
      });
      const btn = document.getElementById('tournament-register-btn') || document.querySelector('.tournament-register-btn');
      if (btn && spots <= 0) { btn.disabled=true; btn.textContent='Tournament Full'; }
    });
  }

  ['showTournamentDetail','loadTournamentDetail','openTournamentDetail'].forEach(fn => {
    window._bmgWaitFor(fn, () => {
      const _orig = window[fn];
      window[fn] = function (tournament, ...args) {
        const id = typeof tournament==='string' ? tournament : (tournament?.id||tournament?.tournamentId);
        if (id) {
          window._currentTournamentId = id;
          const page = document.getElementById('tournament-detail-page');
          if (page) page.dataset.tournamentId = id;
          _startTournamentListener(id);
        }
        return _orig(tournament, ...args);
      };
    });
  });

  window.addEventListener('bmg:paymentConfirmed', e => {
    const { paymentType } = e.detail||{};
    if (paymentType==='tournament') {
      const id = window._currentTournamentId;
      if (id) _startTournamentListener(id);
    }
  });
})();

/* ══════════════════════════════════════════════════════════════════════════
 * §6  ENTRY PASS (booking QR)
 * ══════════════════════════════════════════════════════════════════════════*/
(function () {
  'use strict';

  function _buildQRPayload(booking) {
    return 'BMG|' + (booking.bookingId || booking.id || '');
  }

  window._bmgWaitFor('showEntryPass', () => {
    const _orig = window.showEntryPass;

    window.showEntryPass = async function (bookingId) {
      if (!bookingId) { window._bmgToast('Booking ID missing','error'); return; }
      window._bmgShowLoading('Generating pass…');
      try {
        const db = window.db;

        // ── STEP 1: Check pool_bookings first (3 strategies) ──────────────
        let poolBooking = null;
        // 1a. By document ID
        try { const d = await db.collection('pool_bookings').doc(bookingId).get(); if (d.exists) poolBooking = { _docId: d.id, ...d.data() }; } catch(_){}
        // 1b. By bookingId field
        if (!poolBooking) { try { const s = await db.collection('pool_bookings').where('bookingId','==',bookingId).limit(1).get(); if (!s.empty) poolBooking = { _docId: s.docs[0].id, ...s.docs[0].data() }; } catch(_){} }
        // 1c. By orderId field
        if (!poolBooking) { try { const s = await db.collection('pool_bookings').where('orderId','==',bookingId).limit(1).get(); if (!s.empty) poolBooking = { _docId: s.docs[0].id, ...s.docs[0].data() }; } catch(_){} }

        // ── STEP 2: If pool booking found → delegate to showPoolEntryPass ──
        if (poolBooking) {
          window._bmgHideLoading();
          if (typeof window.showPoolEntryPass === 'function') {
            // bmg_pool_entry_fix.js (loads last) needs (docId, bookingData) — 2 args
            // bmg_swimming_pool_fix.js needs (bookingId) — 1 arg
            // Pass both: if 2-arg version, it uses docId+data; if 1-arg, extra arg is ignored
            window.showPoolEntryPass(poolBooking._docId || bookingId, poolBooking);
          } else {
            window._bmgToast('Pool pass generator not loaded yet — please try again','warning');
          }
          return;
        }

        // ── STEP 3: Ground booking lookup ─────────────────────────────────
        let booking = null;
        const dd = await db.collection('bookings').doc(bookingId).get().catch(() => null);
        if (dd?.exists) { booking = { id:dd.id, ...dd.data() }; }
        else {
          const snap = await db.collection('bookings').where('bookingId','==',bookingId).limit(1).get();
          if (!snap.empty) booking = { id:snap.docs[0].id, ...snap.docs[0].data() };
        }
        if (!booking) { window._bmgToast('Booking not found','error'); window._bmgHideLoading(); return; }

        const isConfirmed = booking.bookingStatus==='confirmed'||booking.status==='confirmed'||booking.paymentStatus==='PAID';
        if (!isConfirmed) { window._bmgToast('Entry pass available only for confirmed bookings','warning'); window._bmgHideLoading(); return; }

        const qrPayload = _buildQRPayload(booking);
        let qrDataUrl = '';
        if (typeof QRCode !== 'undefined' && typeof QRCode.toDataURL === 'function') {
          try { qrDataUrl = await QRCode.toDataURL(qrPayload, { width:220, margin:2, errorCorrectionLevel:'M' }); } catch (_) {}
        }
        if (!qrDataUrl && typeof window.QRCode === 'function') {
          qrDataUrl = await new Promise(resolve => {
            const tmp = document.createElement('div'); tmp.style.cssText='position:absolute;left:-9999px;';
            document.body.appendChild(tmp);
            try { new window.QRCode(tmp, { text:qrPayload, width:220, height:220 }); } catch (_) {}
            setTimeout(() => { const img=tmp.querySelector('img'); const url=img?.src||''; try{document.body.removeChild(tmp);}catch(_){} resolve(url); }, 400);
          });
        }

        const passHtml = `
          <div style="background:linear-gradient(135deg,#1a1a2e,#16213e,#0f3460);color:#fff;border-radius:24px;padding:28px 22px;max-width:360px;margin:16px auto;box-shadow:0 20px 60px rgba(0,0,0,.4);">
            <div style="text-align:center;margin-bottom:18px;">
              <div style="font-size:2rem;margin-bottom:4px;">🏟️</div>
              <h2 style="margin:0;font-size:1.3rem;font-weight:800;letter-spacing:1px;">ENTRY PASS</h2>
              <p style="margin:4px 0 0;font-size:.75rem;opacity:.7;letter-spacing:2px;">BookMyGame · SpörtoBook</p>
            </div>
            <div style="background:rgba(255,255,255,.08);border-radius:16px;padding:16px;margin-bottom:18px;">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:.82rem;">
                <div><span style="opacity:.6;">Booking ID</span><br><strong style="font-size:.78rem;">${window._esc(booking.bookingId||booking.id)}</strong></div>
                <div><span style="opacity:.6;">Name</span><br><strong>${window._esc(booking.userName||'')}</strong></div>
                <div><span style="opacity:.6;">Ground</span><br><strong>${window._esc(booking.groundName||'')}</strong></div>
                <div><span style="opacity:.6;">Date</span><br><strong>${booking.date||''}</strong></div>
                <div><span style="opacity:.6;">Time</span><br><strong>${booking.slotTime||''}</strong></div>
                <div><span style="opacity:.6;">Amount</span><br><strong>₹${booking.amount||0}</strong></div>
              </div>
              ${booking.groundAddress||booking.venueAddress?`<div style="margin-top:10px;font-size:.78rem;opacity:.8;">📍 ${window._esc(booking.groundAddress||booking.venueAddress)}</div>`:''}
            </div>
            <div style="background:#fff;border-radius:16px;padding:14px;text-align:center;margin-bottom:14px;">
              ${qrDataUrl?`<img src="${qrDataUrl}" alt="QR" style="width:200px;height:200px;">`:`<p style="color:#999;font-size:12px;">QR: ${window._esc(booking.bookingId||booking.id)}</p>`}
              <p style="color:#374151;font-size:.7rem;margin:8px 0 0;">Scan to verify at venue</p>
            </div>
            <div style="background:rgba(34,197,94,.15);border:1px solid rgba(34,197,94,.3);border-radius:10px;padding:10px 14px;font-size:.75rem;text-align:center;color:#86efac;">
              <i class="fas fa-check-circle"></i> CONFIRMED &nbsp;|&nbsp; <i class="fas fa-clock"></i> Valid: 15 min before to 1 hr after slot
            </div>
          </div>
          <button id="entry-pass-home" style="display:block;width:calc(100% - 32px);margin:12px auto 24px;padding:14px;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;border:none;border-radius:14px;font-size:1rem;font-weight:700;cursor:pointer;">
            <i class="fas fa-home"></i> Back to Home
          </button>`;

        const container = document.getElementById('entry-pass-content');
        if (container) {
          container.innerHTML = passHtml;
          container.querySelector('#entry-pass-home')?.addEventListener('click', () => {
            if (typeof window.goHome==='function') window.goHome();
            else if (typeof window.showPage==='function') window.showPage('home-page');
          });
        }

        window._bmgHideLoading();
        if (typeof window.showPage==='function') window.showPage('entry-pass-page');

      } catch (err) {
        console.error('[BMG] showEntryPass error:', err);
        window._bmgHideLoading();
        window._bmgToast(err.message||'Error generating pass','error');
      }
    };
  });

  window.showEntryPassFromConfirmation = function () {
    const bid = window._lastConfirmedBookingId
      || document.querySelector('[data-booking-id]')?.dataset?.bookingId
      || document.querySelector('#booking-id-display,.booking-id')?.textContent?.trim()
      || sessionStorage.getItem('lastBookingId');
    if (!bid || bid.length < 3) { window._bmgToast('Booking ID not found. Please check My Bookings.','warning'); return; }
    window.showEntryPass(bid);
  };
})();

/* ══════════════════════════════════════════════════════════════════════════
 * §7  OWNER — canAddGround fix + registrationVerified auto-write
 * ══════════════════════════════════════════════════════════════════════════*/
(function () {
  'use strict';

  function _patchCanAddGround() {
    window.canAddGround = async function () {
      const cu = window.currentUser;
      if (!cu || cu.role !== 'owner') { window._bmgToast('Please login as owner','error'); return false; }
      try {
        const db = window.db;
        const snap = await db.collection('owners').doc(cu.uid).get();
        if (!snap.exists) { window._bmgToast('Owner data not found. Please contact support.','error'); return false; }
        const owner = snap.data();

        if (owner.status && owner.status !== 'active') { window._bmgToast('Your account is blocked. Please contact support.','error'); return false; }
        if (owner.documentVerified === false) { window._bmgToast('Address verification pending. Please upload your electricity bill.','warning'); return false; }

        const isPaid = owner.registrationPaid===true || owner.isActive===true || owner.paymentDone===true;

        if (!isPaid) {
          let isRequired = true, payAmt = 5;
          try {
            const cfg = await db.collection('system_config').doc('owner_registration').get();
            if (cfg.exists) { isRequired=cfg.data().paymentRequired===true; payAmt=cfg.data().paymentAmount||5; }
          } catch (_) {}
          if (isRequired) {
            window._bmgToast(`Please complete registration (₹${payAmt}) to add grounds.`, 'warning');
            return false;
          } else {
            await db.collection('owners').doc(cu.uid).update({
              registrationPaid:true, registrationVerified:true, isActive:true, paymentDone:true,
              updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
            });
          }
        } else {
          if (!owner.registrationVerified) {
            try {
              await db.collection('owners').doc(cu.uid).update({
                registrationVerified:true, isActive:true, paymentDone:true,
                updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
              });
            } catch (_) {}
            cu.registrationVerified = true; cu.isActive = true; cu.paymentDone = true;
          }
        }

        const validTypes = ['venue_owner','plot_owner','VENUE_OWNER','PLOT_OWNER'];
        if (!validTypes.includes(owner.ownerType)) { window._bmgToast('Your account type does not allow adding grounds.','error'); return false; }

        console.log('✅ [BMG] canAddGround: all checks passed');
        return true;
      } catch (err) {
        console.error('[BMG] canAddGround error:', err);
        window._bmgToast('Error checking permissions. Please try again.','error');
        return false;
      }
    };
    console.log('✅ [BMG] canAddGround patched — registrationVerified auto-fix active');
  }

  // Patch after app.js defines it
  window._bmgWaitFor('canAddGround', _patchCanAddGround);
})();

/* ══════════════════════════════════════════════════════════════════════════
 * §8  OWNER & CEO EARNINGS
 * ══════════════════════════════════════════════════════════════════════════*/
(function () {
  'use strict';

  const _db = () => window.db;
  const _cu = () => window.currentUser;
  const _fmt = v => window._bmgFmt(v);

  /* ── Full admin/CEO owner earnings loader ────────────────────────────── */
  async function loadAdminOwnerEarningsFull(container) {
    if (!container) return;
    const db = _db(), cu = _cu();
    if (!db || !cu) { container.innerHTML='<p style="text-align:center;padding:32px;color:#9ca3af;">Please log in.</p>'; return; }

    container.innerHTML=`<div style="text-align:center;padding:40px;"><div class="loader-spinner" style="margin:0 auto 12px;"></div><p style="color:#6b7280;font-size:14px;">Loading owner earnings…</p></div>`;

    try {
      let bookSnap, tournSnap;
      try { bookSnap=await db.collection('bookings').where('bookingStatus','==','confirmed').orderBy('createdAt','desc').get(); }
      catch (_) { bookSnap=await db.collection('bookings').where('bookingStatus','==','confirmed').get(); }
      try { tournSnap=await db.collection('tournament_entries').where('status','==','confirmed').get(); }
      catch (_) { tournSnap={docs:[]}; }
      const [opSnap,prSnap]=await Promise.all([
        db.collection('owner_payments').where('status','==','paid').get().catch(()=>({docs:[]})),
        db.collection('payout_requests').where('status','==','paid').get().catch(()=>({docs:[]})),
      ]);

      const ownerData={};
      const ensure=(oid,name='')=>{ if(!ownerData[oid]) ownerData[oid]={ownerId:oid,ownerName:name,bookingEarnings:0,tournamentEarnings:0,transfersPaid:0,bookingCount:0,tournCount:0,transferCount:0}; if(name&&!ownerData[oid].ownerName) ownerData[oid].ownerName=name; };

      bookSnap.docs.forEach(doc=>{ const b=doc.data(); const oid=b.ownerId||''; if(!oid)return; ensure(oid,b.ownerName||''); const full=Number(b.amount||b.totalAmount||0); const plat=Number(b.commission||b.platformFee||Math.round(full*0.10)); const share=Number(b.ownerAmount||(full-plat)); if(share<=0)return; ownerData[oid].bookingEarnings+=share; ownerData[oid].bookingCount++; });
      tournSnap.docs.forEach(doc=>{ const e=doc.data(); const oid=e.ownerId||e.tournamentOwnerId||''; if(!oid)return; ensure(oid,''); const fee=Number(e.amount||e.entryFee||0); const share=Number(e.ownerAmount||(fee-Math.round(fee*0.20))); if(share<=0)return; ownerData[oid].tournamentEarnings+=share; ownerData[oid].tournCount++; });

      const seen=new Set();
      opSnap.docs.forEach(doc=>{ seen.add(doc.id); const t=doc.data(); const oid=t.ownerId||''; if(!oid)return; ensure(oid,t.ownerName||''); ownerData[oid].transfersPaid+=Number(t.amount||0); ownerData[oid].transferCount++; });
      prSnap.docs.forEach(doc=>{ if(seen.has(doc.id))return; const t=doc.data(); const oid=t.ownerId||''; if(!oid)return; ensure(oid,t.ownerName||''); ownerData[oid].transfersPaid+=Number(t.amount||0); ownerData[oid].transferCount++; });

      const unknownIds=Object.keys(ownerData).filter(id=>!ownerData[id].ownerName);
      for(let i=0;i<unknownIds.length;i+=10){
        try{
          const snap=await db.collection('owners').where(firebase.firestore.FieldPath.documentId(),'in',unknownIds.slice(i,i+10)).get();
          snap.docs.forEach(d=>{ if(ownerData[d.id]) ownerData[d.id].ownerName=d.data().name||d.data().ownerName||'Unknown'; });
        }catch(_){}
      }

      const owners=Object.values(ownerData).sort((a,b)=>(b.bookingEarnings+b.tournamentEarnings)-(a.bookingEarnings+a.tournamentEarnings));
      const totalPlat=owners.reduce((s,o)=>s+(o.bookingCount>0?(o.bookingEarnings/0.9)*0.1:0)+(o.tournCount>0?(o.tournamentEarnings/0.8)*0.2:0),0);
      const totalOwed=owners.reduce((s,o)=>s+Math.max(0,(o.bookingEarnings+o.tournamentEarnings)-o.transfersPaid),0);

      container.innerHTML=`
        <style>.bae-banner{background:linear-gradient(135deg,#1e3a5f,#1e40af);color:#fff;border-radius:16px;padding:18px 20px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;}.bae-banner-stat{text-align:center;}.bae-banner-val{font-size:26px;font-weight:800;}.bae-banner-lbl{font-size:11px;opacity:.75;text-transform:uppercase;letter-spacing:.5px;}.bae-card{background:#fff;border-radius:16px;padding:18px;margin-bottom:14px;box-shadow:0 2px 12px rgba(0,0,0,.07);border-left:4px solid #10b981;}.bae-card-owed{border-left-color:#f59e0b;}.bae-row{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151;}.bae-owed-box{background:#fef3c7;border-radius:10px;padding:10px 12px;margin-top:10px;display:flex;justify-content:space-between;align-items:center;}.bae-transfer-btn{background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;padding:10px 18px;border-radius:12px;font-size:13px;font-weight:700;cursor:pointer;margin-top:12px;display:flex;align-items:center;gap:6px;}.bae-paid-badge{background:#d1fae5;color:#065f46;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;}</style>
        <div class="bae-banner">
          <div class="bae-banner-stat"><div class="bae-banner-val">${_fmt(totalPlat)}</div><div class="bae-banner-lbl">Platform Revenue</div></div>
          <div class="bae-banner-stat"><div class="bae-banner-val">${owners.length}</div><div class="bae-banner-lbl">Active Owners</div></div>
          <div class="bae-banner-stat" style="background:rgba(255,255,255,.1);border-radius:12px;padding:10px 16px;"><div class="bae-banner-val" style="color:#fbbf24;">${_fmt(totalOwed)}</div><div class="bae-banner-lbl">Total Still Owed</div></div>
          <button class="bae-refresh-btn" onclick="window._bmgRefreshAdminEarnings()" style="background:#f3f4f6;border:none;padding:8px 16px;border-radius:10px;font-size:13px;cursor:pointer;font-weight:600;"><i class="fas fa-sync-alt"></i> Refresh</button>
        </div>
        <div id="bae-owners-list">
          ${owners.length===0?'<p style="text-align:center;color:#9ca3af;padding:32px;">No earnings data yet.</p>':owners.map(o=>{
            const total=o.bookingEarnings+o.tournamentEarnings,netOwed=Math.max(0,total-o.transfersPaid),isOwed=netOwed>0;
            return `<div class="bae-card ${isOwed?'bae-card-owed':''}" id="bae-card-${o.ownerId}">
              <h4 style="font-size:15px;font-weight:700;color:#111;margin:0 0 12px;display:flex;justify-content:space-between;align-items:center;">
                <span>${window._esc(o.ownerName||'Unknown')} <span style="font-size:10px;color:#9ca3af;">${o.ownerId.slice(0,8)}…</span></span>
                ${!isOwed?'<span class="bae-paid-badge"><i class="fas fa-check-circle"></i> Fully Paid</span>':''}
              </h4>
              <div class="bae-row"><span>Ground Bookings (90% share)</span><span style="color:#3b82f6;font-weight:700;">${_fmt(o.bookingEarnings)}</span></div>
              <div class="bae-row"><span>Tournament Earnings (80% share)</span><span style="color:#8b5cf6;font-weight:700;">${_fmt(o.tournamentEarnings)}</span></div>
              <div class="bae-row"><span>Total Earned</span><span style="font-weight:800;">${_fmt(total)}</span></div>
              <div class="bae-row"><span>Already Transferred (${o.transferCount})</span><span style="color:#10b981;font-weight:700;">-${_fmt(o.transfersPaid)}</span></div>
              <div class="bae-owed-box"><strong>Amount Still Owed</strong><span style="font-size:18px;font-weight:800;color:${isOwed?'#d97706':'#10b981'};">${_fmt(netOwed)}</span></div>
              ${isOwed?`<button class="bae-transfer-btn" onclick="window.bmgAdminTransferPaymentV3('${o.ownerId}','${window._esc(o.ownerName||'').replace(/'/g,"\\'")}',${Math.round(netOwed)})"><i class="fas fa-paper-plane"></i> Mark Payment Done (${_fmt(netOwed)})</button>`:''}
            </div>`;
          }).join('')}
        </div>`;
    } catch (err) {
      console.error('[BMG] loadAdminOwnerEarningsFull error:', err);
      container.innerHTML=`<p style="text-align:center;color:#ef4444;padding:32px;">${err.code==='permission-denied'?'Check Firestore rules for admin role.':window._esc(err.message)}</p>`;
    }
  }

  window.loadAdminOwnerEarnings = loadAdminOwnerEarningsFull;
  window._bmgRefreshAdminEarnings = function () {
    ['admin-dashboard-content','ceo-dashboard-content'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.innerHTML='<div class="loading-spinner"><div class="loader-spinner"></div></div>'; loadAdminOwnerEarningsFull(el); }
    });
  };

  /* ── bmgAdminTransferPaymentV3 ───────────────────────────────────────── */
  window.bmgAdminTransferPaymentV3 = async function (ownerId, ownerName, suggestedAmount) {
    const db = _db(), cu = _cu();
    if (!db || !cu) { window._bmgToast('Not logged in','error'); return; }
    document.getElementById('bmg-transfer-modal-v3')?.remove();
    const modal = document.createElement('div');
    modal.id = 'bmg-transfer-modal-v3';
    modal.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px;';
    modal.innerHTML=`
      <div style="background:#fff;border-radius:20px;max-width:380px;width:100%;padding:28px 24px;box-shadow:0 24px 64px rgba(0,0,0,.25);">
        <h3 style="margin:0 0 4px;font-size:18px;font-weight:800;"><i class="fas fa-paper-plane" style="color:#10b981;margin-right:8px;"></i>Mark Payment Done</h3>
        <p style="font-size:13px;color:#6b7280;margin:0 0 20px;">to <strong>${window._esc(ownerName||ownerId)}</strong></p>
        <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:6px;">Amount Transferred (₹)</label>
        <input id="bmg-tv3-amount" type="number" value="${suggestedAmount||0}" min="1" style="width:100%;padding:12px;border:2px solid #e5e7eb;border-radius:12px;font-size:18px;font-weight:700;margin-bottom:14px;box-sizing:border-box;">
        <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:6px;">Payment Method</label>
        <select id="bmg-tv3-method" style="width:100%;padding:10px;border:2px solid #e5e7eb;border-radius:12px;font-size:14px;margin-bottom:14px;box-sizing:border-box;">
          <option>UPI</option><option>NEFT</option><option>IMPS</option><option>Cash</option><option>Other</option>
        </select>
        <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:6px;">Transaction ID / Note (optional)</label>
        <input id="bmg-tv3-note" type="text" placeholder="e.g. UTR1234567890" style="width:100%;padding:10px;border:2px solid #e5e7eb;border-radius:12px;font-size:13px;margin-bottom:20px;box-sizing:border-box;">
        <div style="display:flex;gap:10px;">
          <button id="bmg-tv3-cancel" style="flex:1;padding:12px;background:#f3f4f6;color:#374151;border:none;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;">Cancel</button>
          <button id="bmg-tv3-confirm" style="flex:2;padding:12px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;"><i class="fas fa-check"></i> Confirm Payment Done</button>
        </div>
        <p id="bmg-tv3-error" style="color:#ef4444;font-size:12px;text-align:center;margin-top:10px;display:none;"></p>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target===modal) modal.remove(); });
    document.getElementById('bmg-tv3-cancel').addEventListener('click', () => modal.remove());
    document.getElementById('bmg-tv3-confirm').addEventListener('click', async () => {
      const amt=Number(document.getElementById('bmg-tv3-amount')?.value||0);
      const method=document.getElementById('bmg-tv3-method')?.value||'UPI';
      const note=document.getElementById('bmg-tv3-note')?.value||'';
      const errEl=document.getElementById('bmg-tv3-error');
      const btn=document.getElementById('bmg-tv3-confirm');
      if (!amt||amt<=0) { errEl.textContent='Please enter a valid amount.'; errEl.style.display='block'; return; }
      btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Processing…'; errEl.style.display='none';
      try {
        const now=firebase.firestore.FieldValue.serverTimestamp();
        const transferDoc={ ownerId, ownerName:ownerName||'', amount:amt, method, note, description:note||`Payment via ${method}`, status:'paid', paidAt:now, paidBy:cu.uid, paidByName:cu.name||cu.email||'Admin', paidByEmail:cu.email||'', createdAt:now, updatedAt:now };
        const opRef=await db.collection('owner_payments').add(transferDoc);
        await db.collection('payout_requests').add({ ...transferDoc, requestId:`ADMIN-${Date.now()}`, type:'admin_direct_transfer', bookingIds:[], ownerPaymentDocId:opRef.id });
        modal.remove();
        window._bmgToast(`✅ Payment of ${_fmt(amt)} recorded for ${ownerName||'owner'}`, 'success', 5000);
        window._bmgRefreshAdminEarnings();
      } catch (err) {
        errEl.textContent='Failed: '+err.message; errEl.style.display='block';
        btn.disabled=false; btn.innerHTML='<i class="fas fa-check"></i> Confirm Payment Done';
      }
    });
  };
  window.bmgAdminTransferPayment = window.bmgAdminTransferPaymentV3;

  /* ── Inject Owner Earnings tabs into Admin + CEO dashboards ─────────── */
  function _injectEarningsTabs() {
    // Admin
    if (!document.getElementById('admin-owner-earnings-tab')) {
      const tabBar=document.querySelector('.admin-tabs'); if(!tabBar) return;
      const btn=document.createElement('button'); btn.id='admin-owner-earnings-tab'; btn.className='tab-btn';
      btn.innerHTML='<i class="fas fa-hand-holding-usd" style="margin-right:5px;"></i>Owner Earnings';
      const delTab=document.getElementById('admin-delete-tab');
      delTab?tabBar.insertBefore(btn,delTab):tabBar.appendChild(btn);
    }
    const adminBar=document.querySelector('.admin-tabs');
    if (adminBar && !adminBar.__bmgEarnWired) {
      adminBar.__bmgEarnWired=true;
      adminBar.addEventListener('click', e => {
        const btn=e.target.closest('#admin-owner-earnings-tab'); if(!btn) return;
        e.preventDefault(); e.stopPropagation();
        document.querySelectorAll('.admin-tabs .tab-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active');
        const ctn=document.getElementById('admin-dashboard-content'); if(!ctn) return;
        ctn.innerHTML='<div class="loading-spinner"><div class="loader-spinner"></div></div>';
        loadAdminOwnerEarningsFull(ctn);
      });
    }

    // CEO
    if (!document.getElementById('ceo-owner-earnings-tab')) {
      const tabBar=document.querySelector('.ceo-tabs'); if(!tabBar) return;
      const btn=document.createElement('button'); btn.id='ceo-owner-earnings-tab'; btn.className='tab-btn';
      btn.innerHTML='<i class="fas fa-hand-holding-usd" style="margin-right:5px;"></i>Owner Earnings';
      tabBar.appendChild(btn);
    }
    const ceoBar=document.querySelector('.ceo-tabs');
    if (ceoBar && !ceoBar.__bmgCEOEarnWired) {
      ceoBar.__bmgCEOEarnWired=true;
      ceoBar.addEventListener('click', e => {
        const btn=e.target.closest('#ceo-owner-earnings-tab'); if(!btn) return;
        e.preventDefault(); e.stopPropagation();
        document.querySelectorAll('.ceo-tabs .tab-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active');
        const ctn=document.getElementById('ceo-dashboard-content'); if(!ctn) return;
        ctn.innerHTML='<div class="loading-spinner"><div class="loader-spinner"></div></div>';
        loadAdminOwnerEarningsFull(ctn);
      });
    }
  }

  window._bmgOnReady(() => {
    setTimeout(_injectEarningsTabs, 400);
    new MutationObserver(() => _injectEarningsTabs()).observe(document.body, { childList:true, subtree:true });
  });

  window.addEventListener('bmg:pageShown', e => {
    const pid=e.detail?.pageId;
    if (pid==='admin-dashboard-page'||pid==='ceo-dashboard-page') setTimeout(_injectEarningsTabs, 100);
  });

  /* ── Guard cleanupExpiredLocks ────────────────────────────────────────── */
  window._bmgWaitFor('cleanupExpiredLocks', () => {
    window.cleanupExpiredLocks = async function () {
      const cu = _cu(); if (!cu?.uid) return;
      try {
        const snap = await _db().collection('slot_locks').where('userId','==',cu.uid).where('expiresAt','<',new Date()).limit(20).get();
        if (snap.empty) return;
        const batch=_db().batch(); snap.forEach(d=>batch.delete(d.ref)); await batch.commit();
      } catch (e) { if (e?.code!=='permission-denied') console.warn('[BMG] cleanupExpiredLocks:', e.message); }
    };
  });
})();

/* ══════════════════════════════════════════════════════════════════════════
 * §9  INSTANT TOURNAMENT RECOVERY (Firestore-only, no CF calls)
 * ══════════════════════════════════════════════════════════════════════════*/
(function () {
  'use strict';

  function _destroyPanel() {
    if (window._bmgTournamentVerifyPanel?.destroy) { try { window._bmgTournamentVerifyPanel.destroy(); } catch (_) {} }
    const el = document.getElementById('bmg-tourn-verify-panel');
    if (el) { el.style.opacity='0'; setTimeout(() => { try { el.remove(); } catch (_) {} }, 200); }
    if (typeof window.hideLoading === 'function') window.hideLoading();
  }

  function _clearSession(orderId) {
    ['bmg_lastTournOrderId','bmg_recoverOrderId','bmg_recoverPayType','pendingTournamentRegistration']
      .forEach(k => { try { sessionStorage.removeItem(k); } catch (_) {} });
    if (orderId) { try { sessionStorage.removeItem(`bmg_tournReg_${orderId}`); } catch (_) {} }
    window._pendingTournamentRegData = null; window.currentTournamentPayment = null;
  }

  async function _smartRecovery() {
    _destroyPanel();
    let waited = 0;
    while (!window.currentUser && waited < 7000) { await new Promise(r=>setTimeout(r,150)); waited+=150; }
    const cu = window.currentUser, db = window.db;
    if (!cu || !db) return;

    let orderId = null, regMeta = null, docAge = 0;

    try {
      const sid = sessionStorage.getItem('bmg_lastTournOrderId') || sessionStorage.getItem('bmg_recoverOrderId');
      const pt  = sessionStorage.getItem('bmg_recoverPayType');
      if (sid && (!pt || pt==='tournament')) {
        const raw = sessionStorage.getItem(`bmg_tournReg_${sid}`);
        if (raw) { const m=JSON.parse(raw); docAge=Date.now()-(m.savedAt||0); if(docAge>2*60*60*1000){_clearSession(sid);}else{orderId=sid;regMeta=m;} }
        else { orderId = sid; }
      }
    } catch (_) {}

    if (!orderId) {
      try {
        const snap = await db.collection('payment_recovery').where('userId','==',cu.uid).where('paymentType','==','tournament').where('status','==','pending').orderBy('createdAt','desc').limit(5).get().catch(()=>null);
        if (snap && !snap.empty) {
          const now=Date.now();
          for (const doc of snap.docs) {
            const age=now-(doc.data().createdAt?.toMillis?.())||0;
            if (age>2*60*60*1000) { doc.ref.delete().catch(()=>{}); continue; }
            orderId=doc.id; regMeta=doc.data(); docAge=age; break;
          }
        }
      } catch (_) {}
    }

    if (!orderId) return;

    // Already confirmed?
    try {
      const e = await db.collection('tournament_entries').doc(orderId).get();
      if (e.exists) { _destroyPanel(); db.collection('payment_recovery').doc(orderId).delete().catch(()=>{}); db.collection('pending_payments').doc(orderId).delete().catch(()=>{}); _clearSession(orderId); return; }
    } catch (_) {}

    // Old + no confirmation = abandoned
    if (docAge > 15*60*1000) { _destroyPanel(); db.collection('payment_recovery').doc(orderId).delete().catch(()=>{}); db.collection('pending_payments').doc(orderId).delete().catch(()=>{}); _clearSession(orderId); return; }

    // Fresh + pending → Firestore-only verify
    if (!regMeta) { try { const raw=sessionStorage.getItem(`bmg_tournReg_${orderId}`)||sessionStorage.getItem('pendingTournamentRegistration'); if(raw)regMeta=JSON.parse(raw); } catch (_) {} }
    if (!regMeta) { try { const s=await db.collection('payment_recovery').doc(orderId).get(); if(s.exists)regMeta=s.data(); } catch (_) {} }
    if (regMeta) window._pendingTournamentRegData = regMeta;

    _destroyPanel();
    await _firestoreVerify(orderId, regMeta||{});
  }

  async function _firestoreVerify(orderId, paymentData) {
    const db = window.db; if (!db) return;
    let resolved=false, unsubE=null, unsubP=null, pollIv=null, hardTm=null;

    _showMinimalPanel(orderId);

    function cleanup() { clearInterval(pollIv); clearTimeout(hardTm); try{unsubE&&unsubE();}catch(_){} try{unsubP&&unsubP();}catch(_){} }

    function succeed(data) {
      if (resolved) return; resolved=true; cleanup(); _destroyPanel(); _clearSession(orderId);
      const fn = window._writeAndShowTournamentSuccess || window._bmgWriteAndShowTournamentSuccess;
      if (typeof fn==='function') fn(orderId,paymentData||{});
      else { window._bmgToast('🏆 Registration confirmed! Check "My Tournaments".','success',6000); if(typeof window.loadMyTournaments==='function') setTimeout(()=>window.loadMyTournaments(),800); }
      window.dispatchEvent(new CustomEvent('bmg:paymentConfirmed',{detail:{orderId,paymentType:'tournament',result:data||paymentData||{}}}));
      db.collection('payment_recovery').doc(orderId).delete().catch(()=>{});
    }

    function giveUp() {
      if (resolved) return; resolved=true; cleanup(); _destroyPanel();
      window._bmgToast('⏳ Still verifying — check "My Tournaments" in a minute.','info',6000);
      if (typeof window.loadMyTournaments==='function') setTimeout(()=>window.loadMyTournaments(),3000);
    }

    try { unsubE=db.collection('tournament_entries').doc(orderId).onSnapshot(s=>{ if(s.exists&&!resolved)succeed(s.data()); },()=>{}); } catch (_) {}
    try { unsubP=db.collection('pending_payments').doc(orderId).onSnapshot(s=>{ if(!s.exists&&!resolved) db.collection('tournament_entries').doc(orderId).get().then(e=>{if(e.exists&&!resolved)succeed(e.data());}).catch(()=>{}); },()=>{}); } catch (_) {}

    let pollCount=0;
    pollIv=setInterval(async()=>{ if(resolved){clearInterval(pollIv);return;} pollCount++; _updateMinimalPanel(pollCount); try{const s=await db.collection('tournament_entries').doc(orderId).get();if(s.exists)succeed(s.data());}catch(_){} },3000);
    hardTm=setTimeout(giveUp,30000);
  }

  function _showMinimalPanel(orderId) {
    if (document.getElementById('bmg-instant-panel')) return;
    const el=document.createElement('div'); el.id='bmg-instant-panel';
    el.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,.88);display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(8px);';
    el.innerHTML=`
      <div style="background:#fff;border-radius:20px;max-width:340px;width:100%;padding:32px 24px;text-align:center;box-shadow:0 24px 64px rgba(0,0,0,.45);animation:bmgFadeIn .35s ease;">
        <div style="position:relative;width:64px;height:64px;margin:0 auto 18px;">
          <svg width="64" height="64" viewBox="0 0 64 64" style="position:absolute;inset:0;animation:bmgSpin 1.2s linear infinite;">
            <circle cx="32" cy="32" r="26" fill="none" stroke="#e5e7eb" stroke-width="5"/>
            <circle cx="32" cy="32" r="26" fill="none" stroke="#2563eb" stroke-width="5" stroke-dasharray="120" stroke-dashoffset="90" stroke-linecap="round"/>
          </svg>
          <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:20px;">🏆</div>
        </div>
        <h3 style="font-size:17px;font-weight:800;color:#111827;margin:0 0 6px;">Confirming Registration</h3>
        <p id="bmg-ip-status" style="font-size:13px;color:#6b7280;margin:0 0 20px;">Checking with payment gateway…</p>
        <div style="background:#f1f5f9;border-radius:8px;height:5px;overflow:hidden;margin-bottom:18px;">
          <div id="bmg-ip-bar" style="height:100%;width:10%;border-radius:8px;background:linear-gradient(90deg,#2563eb,#7c3aed);transition:width .8s ease;"></div>
        </div>
        <button id="bmg-ip-skip" style="margin-top:14px;background:none;border:none;color:#9ca3af;font-size:12px;cursor:pointer;text-decoration:underline;">Check My Tournaments instead</button>
      </div>
      <style>@keyframes bmgSpin{to{transform:rotate(360deg)}}</style>`;
    document.body.appendChild(el);
    el.querySelector('#bmg-ip-skip')?.addEventListener('click',()=>{ el.remove(); if(typeof window.showPage==='function') window.showPage('my-bookings-page'); });
  }

  function _updateMinimalPanel(attempt) {
    const bar=document.getElementById('bmg-ip-bar'), st=document.getElementById('bmg-ip-status');
    if (bar) bar.style.width=Math.min(90,10+attempt*8)+'%';
    if (st) st.textContent=attempt<=3?'Waiting for payment confirmation…':'Still checking — almost there…';
  }

  // Intercept rogue verify panels
  const _watcher=new MutationObserver(mutations=>{
    for(const m of mutations) for(const node of m.addedNodes){
      if(node.nodeType!==1) continue;
      if(node.id==='bmg-tourn-verify-panel'){ setTimeout(()=>{ node.style.opacity='0'; setTimeout(()=>{try{node.remove();}catch(_){}},200); _smartRecovery(); },50); }
    }
  });

  function boot() {
    if (document.body) _watcher.observe(document.body,{childList:true,subtree:false});
    setTimeout(_smartRecovery, 80);
  }

  if (document.readyState!=='loading') boot();
  else document.addEventListener('DOMContentLoaded',boot);
  if (!document.body) document.addEventListener('DOMContentLoaded',()=>{ _watcher.observe(document.body,{childList:true,subtree:false}); });

  window._bmgFixes = {
    smartRecovery    : _smartRecovery,
    firestoreVerify  : _firestoreVerify,
    clearSession     : _clearSession,
    destroyPanel     : _destroyPanel,
  };

  // Fallback _bmgWriteAndShowTournamentSuccess if bmg_tournament_payment_fix.js not loaded
  if (!window._writeAndShowTournamentSuccess && !window._bmgWriteAndShowTournamentSuccess) {
    window._bmgWriteAndShowTournamentSuccess = async function (orderId, paymentData) {
      const db=window.db, cu=window.currentUser;
      if (db && cu && orderId) {
        try {
          const ex=await db.collection('tournament_entries').doc(orderId).get();
          if (!ex.exists) {
            const now=firebase.firestore.FieldValue.serverTimestamp();
            await db.collection('tournament_entries').doc(orderId).set({
              orderId, userId:cu.uid, userName:cu.name||cu.displayName||'', userEmail:cu.email||'', userPhone:cu.phone||'',
              tournamentId:paymentData.tournamentId||'', tournamentName:paymentData.tournamentName||'',
              teamName:paymentData.teamName||'', sport:paymentData.sport||'', date:paymentData.date||'',
              venue:paymentData.venue||'', amount:Number(paymentData.entryFee||paymentData.amount||0),
              status:'confirmed', paymentStatus:'paid', registrationStatus:'confirmed',
              confirmedAt:now, createdAt:now, updatedAt:now,
            },{merge:true});
            if (paymentData.tournamentId) {
              await db.collection('tournaments').doc(paymentData.tournamentId).update({ registeredTeams:firebase.firestore.FieldValue.increment(1), updatedAt:now }).catch(()=>{});
            }
          }
        } catch (err) { console.warn('[BMG] tournament_entries fallback write error:', err); }
      }
      window._bmgToast('🏆 Tournament registration confirmed! Check "My Tournaments".','success',6000);
      setTimeout(()=>{ if(typeof window.loadMyTournaments==='function') window.loadMyTournaments(); },1500);
    };
  }
})();

/* ══════════════════════════════════════════════════════════════════════════
 * §10  HOME PAGE — NEARBY VENUES (geolocation + shimmer)
 * ══════════════════════════════════════════════════════════════════════════*/
(function () {
  'use strict';

  function _injectNearbyCss() {
    if (document.getElementById('bmg-nearby-css')) return;
    const s=document.createElement('style'); s.id='bmg-nearby-css';
    s.textContent=`.bmg-nearby-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;}.bmg-venue-card{background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);cursor:pointer;transition:transform .2s ease,box-shadow .2s ease;}.bmg-venue-card:hover{transform:translateY(-4px);box-shadow:0 8px 24px rgba(0,0,0,.14);}.bmg-venue-img{width:100%;height:150px;object-fit:cover;background:linear-gradient(135deg,#e0e7ff,#f0fdf4);}.bmg-venue-img-placeholder{width:100%;height:150px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#e0e7ff,#f0fdf4);font-size:36px;}.bmg-venue-body{padding:14px;}.bmg-venue-name{font-size:15px;font-weight:700;margin:0 0 4px;color:#111827;}.bmg-venue-meta{font-size:12px;color:#6b7280;margin-bottom:8px;}.bmg-venue-badges{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;}.bmg-badge{padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;}.bmg-badge-sport{background:#ede9fe;color:#5b21b6;}.bmg-badge-dist{background:#d1fae5;color:#065f46;}.bmg-badge-price{background:#fef3c7;color:#92400e;}.bmg-badge-verified{background:#dbeafe;color:#1e40af;}.bmg-venue-book-btn{display:block;width:100%;padding:10px;border:none;border-radius:10px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;font-size:13px;font-weight:700;cursor:pointer;text-align:center;transition:opacity .2s;}.bmg-venue-book-btn:hover{opacity:.88;}.bmg-shimmer{background:linear-gradient(90deg,#f0f0f0 25%,#e0e0e0 50%,#f0f0f0 75%);background-size:200% 100%;animation:bmg-shimmer 1.4s infinite;border-radius:12px;height:220px;}@keyframes bmg-shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}.bmg-distance-banner{background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;margin-bottom:14px;display:flex;align-items:center;gap:8px;}`;
    document.head.appendChild(s);
  }

  function _haversine(lat1,lon1,lat2,lon2){const R=6371,dLat=(lat2-lat1)*Math.PI/180,dLon=(lon2-lon1)*Math.PI/180,a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));}

  window._bmgWaitFor('loadNearbyVenues', () => {
    _injectNearbyCss();
    const _orig = window.loadNearbyVenues;

    window.loadNearbyVenues = async function (forceCity) {
      const container=document.getElementById('nearby-venues'); if(!container) return;
      container.innerHTML=`<div class="bmg-nearby-grid">${[1,2,3,4].map(()=>'<div class="bmg-shimmer"></div>').join('')}</div>`;

      // City filter
      const cu=window.currentUser;
      const userCity=forceCity||cu?.city||cu?.cityLower||localStorage.getItem('bmg_user_city')||'';

      try {
        let userLat=null,userLng=null;
        try { const pos=await Promise.race([new Promise((res,rej)=>navigator.geolocation.getCurrentPosition(res,rej,{timeout:3000})),new Promise((_,rej)=>setTimeout(()=>rej(),3000))]); userLat=pos.coords.latitude; userLng=pos.coords.longitude; } catch (_) {}

        const db=window.db;
        let vQ=db.collection('venues').where('hidden','==',false).limit(20);
        let gQ=db.collection('grounds').where('status','==','active').limit(20);
        if (userCity) { const cl=userCity.toLowerCase(); vQ=vQ.where('cityLower','==',cl); gQ=gQ.where('cityLower','==',cl); }

        const [vSnap,gSnap]=await Promise.all([vQ.get().catch(()=>db.collection('venues').where('hidden','==',false).limit(20).get()), gQ.get().catch(()=>db.collection('grounds').where('status','==','active').limit(20).get())]);
        let items=[];
        vSnap.forEach(d=>items.push({_id:d.id,_type:'venue',...d.data()}));
        gSnap.forEach(d=>items.push({_id:d.id,_type:'ground',...d.data()}));

        items=items.map(it=>{ it._dist=(userLat&&it.location?.latitude)?_haversine(userLat,userLng,it.location.latitude,it.location.longitude):null; return it; });
        items.sort((a,b)=>{ if(a._dist!==null&&b._dist!==null)return a._dist-b._dist; if(a._dist!==null)return -1; if(b._dist!==null)return 1; return(b.rating||0)-(a.rating||0); });

        const show=items.slice(0,8);
        if (!show.length) { container.innerHTML='<div style="text-align:center;padding:40px;color:var(--gray-400);"><i class="fas fa-map-marker-alt" style="font-size:32px;display:block;margin-bottom:8px;"></i>No venues found nearby</div>'; return; }

        const distBanner=userLat?'<div class="bmg-distance-banner"><i class="fas fa-location-arrow"></i> Showing grounds near your location</div>':'';
        container.innerHTML=distBanner+`<div class="bmg-nearby-grid">${show.map(it=>{
          const name=it.venueName||it.groundName||'Ground',sport=it.sportType||it.sport||'Multi-sport',price=it.pricePerHour||it.price||0,rating=Number(it.rating||0).toFixed(1),dist=it._dist!==null?it._dist.toFixed(1)+' km':null,img=(it.images&&it.images[0])||it.imageUrl||null,city=it.city||it.address||'';
          return `<div class="bmg-venue-card" data-id="${it._id}" data-type="${it._type}">
            ${img?`<img class="bmg-venue-img" src="${img}" alt="${window._esc(name)}" onerror="this.parentNode.innerHTML='<div class=\\"bmg-venue-img-placeholder\\">🏟</div>'">`:'<div class="bmg-venue-img-placeholder">🏟</div>'}
            <div class="bmg-venue-body">
              <h3 class="bmg-venue-name">${window._esc(name)}</h3>
              <p class="bmg-venue-meta">${window._esc(city)}${Number(rating)>0?` · ⭐ ${rating}`:''}</p>
              <div class="bmg-venue-badges">
                <span class="bmg-badge bmg-badge-sport">⚽ ${window._esc(sport)}</span>
                ${dist?`<span class="bmg-badge bmg-badge-dist">📍 ${dist}</span>`:''}
                ${price?`<span class="bmg-badge bmg-badge-price">₹${price}/hr</span>`:''}
                ${it.isVerified?'<span class="bmg-badge bmg-badge-verified">✅ Verified</span>':''}
              </div>
              <button class="bmg-venue-book-btn">View & Book</button>
            </div>
          </div>`;
        }).join('')}</div>`;

        container.querySelectorAll('.bmg-venue-card[data-id]').forEach(card=>{
          card.addEventListener('click',()=>{
            const id=card.dataset.id,type=card.dataset.type;
            if(type==='venue'&&typeof window.viewVenueDetails==='function') window.viewVenueDetails(id);
            else if(type==='ground'&&typeof window.viewGroundDetails==='function') window.viewGroundDetails(id);
            else if(typeof window.showGroundDetails==='function') window.showGroundDetails(id);
          });
        });

      } catch (err) {
        console.error('[BMG] loadNearbyVenues error:', err);
        try { if (_orig) await _orig(); } catch (_) {}
      }
    };
  });

  window._bmgClearCityFilter = function () {
    if (window.currentUser) { window.currentUser.city=''; window.currentUser.cityLower=''; }
    localStorage.removeItem('bmg_user_city');
    document.querySelector('.bmg-city-filter-label')?.remove();
    if (typeof window.loadNearbyVenues==='function') window.loadNearbyVenues();
  };
})();

/* ══════════════════════════════════════════════════════════════════════════
 * §11  MISC UI PATCHES
 *      Remove obsolete verify tab; guard showLoading; selectSlot speedup
 * ══════════════════════════════════════════════════════════════════════════*/
(function () {
  'use strict';

  // Remove "Verify ₹499 Payment" tab
  function _removeVerifyTab() {
    document.querySelectorAll('.owner-nav-item,[data-tab],.dashboard-tab').forEach(el => {
      const dt=el.getAttribute('data-tab')||'', oc=el.getAttribute('onclick')||'', tx=el.textContent||'';
      if (dt.includes('payment-verify')||oc.includes('payment-verify')||oc.includes('loadOwnerPaymentVerify')||(tx.includes('Verify')&&tx.includes('Payment'))) el.style.display='none';
    });
  }

  // Guard showLoading — auto-dismiss after 8s to prevent stuck spinners
  window._bmgWaitFor('showLoading', () => {
    const _orig = window.showLoading;
    window.showLoading = function (msg) {
      _orig(msg);
      clearTimeout(window._bmgLoadingTimer);
      window._bmgLoadingTimer = setTimeout(() => { if (typeof window.hideLoading==='function') window.hideLoading(); }, 8000);
    };
  });

  // Speed up selectSlot — parallel fetches
  window._bmgWaitFor('selectSlot', () => {
    const _orig = window.selectSlot;
    window.selectSlot = async function (slot) {
      const cu=window.currentUser, ground=window.currentGround;
      if (!cu) { window._bmgToast('Please login to book','warning'); if(typeof window.showPage==='function') window.showPage('login-page'); return; }
      if (!ground) return _orig(slot);
      if (!window.selectedDate) { window._bmgToast('Please select a date first','warning'); return; }

      const today=new Date().toISOString().split('T')[0];
      if (window.selectedDate===today) {
        const now=new Date(),cur=now.getHours()*60+now.getMinutes();
        const [h,m]=slot.split('-')[0].split(':').map(Number);
        if ((h*60+(m||0))<=cur) { window._bmgToast('This time slot has already passed','error'); return; }
      }

      const db = window.db;
      const [ownerRes,venueRes] = await Promise.allSettled([
        db.collection('owners').doc(ground.ownerId).get(),
        window.currentVenue ? Promise.resolve(null) : db.collection('venues').where('ownerId','==',ground.ownerId).limit(1).get()
      ]);

      let isPlotOwner=false;
      if (ownerRes.status==='fulfilled'&&ownerRes.value.exists) isPlotOwner=ownerRes.value.data().ownerType==='plot_owner';
      if (venueRes.status==='fulfilled'&&venueRes.value&&!venueRes.value.empty) window.currentVenue={id:venueRes.value.docs[0].id,...venueRes.value.docs[0].data()};

      const PLOT_FIXED=window.PLOT_OWNER_FIXED_PRICE||299;
      const amount=isPlotOwner?PLOT_FIXED:(ground.pricePerHour||0);

      const bookingDetails={
        groundId:ground.id, groundName:ground.groundName||ground.name||'',
        venueName:window.currentVenue?.venueName||'', venueAddress:window.currentVenue?.address||'',
        groundAddress:ground.groundAddress||ground.address||'', sportType:ground.sportType||'',
        ownerId:ground.ownerId||'', isPlotOwner, date:window.selectedDate, slotTime:slot,
        amount, originalAmount:amount, userName:cu.name||cu.displayName||'',
        userEmail:cu.email||'', userPhone:cu.phone||cu.userPhone||'',
        ownerAmount:Math.round(amount*0.90), promoCode:'', appliedOffer:'',
      };

      try { sessionStorage.setItem('selectedSlot',slot); sessionStorage.setItem('selectedDate',window.selectedDate); sessionStorage.setItem('currentGround',JSON.stringify(ground)); } catch (_) {}
      window.selectedSlot = slot;

      if (typeof window.showBookingPage==='function') window.showBookingPage(bookingDetails);
      else return _orig(slot);

      if (!bookingDetails.userPhone||bookingDetails.userPhone.length<10) {
        setTimeout(async()=>{
          if (typeof window.promptForMobileNumber==='function') {
            const phone=await window.promptForMobileNumber();
            if (phone) { bookingDetails.userPhone=phone; cu.phone=phone; if(typeof window.setupPayButton==='function') window.setupPayButton(bookingDetails); }
          }
        }, 200);
      }
    };
  });

  window._bmgOnReady(function () {
    _removeVerifyTab();
    new MutationObserver(_removeVerifyTab).observe(document.body, { childList:true, subtree:false });

    // Inject inline owner earnings tab CSS
    if (!document.getElementById('bmg-hide-verify-css')) {
      const s=document.createElement('style'); s.id='bmg-hide-verify-css';
      s.textContent='[data-tab="payment-verify"],.owner-nav-item[onclick*="payment-verify"],.owner-nav-item[onclick*="loadOwnerPaymentVerify"]{display:none!important;}';
      document.head.appendChild(s);
    }
  });
})();

console.log('✅ [bmg_patches_combined.js] All patches loaded — slots show BOOKED in RED, Firestore-only recovery, CF bypass active');