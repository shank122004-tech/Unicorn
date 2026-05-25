/**
 * ═══════════════════════════════════════════════════════════════════
 *  paymentService.js  —  BookMyGame  (COMPLETE v3)
 * ═══════════════════════════════════════════════════════════════════
 *
 *  CONTAINS (all-in-one, nothing split across files):
 *
 *  ── PAYMENT ENGINE ─────────────────────────────────────────────
 *  [P1]  startPayment()           — unified entry point (booking /
 *                                   owner_onboarding / tournament)
 *  [P2]  createPendingBookingWithSlotLock()
 *  [P3]  releaseSlotLock()
 *  [P4]  listenForPaymentConfirmation()  — Firestore realtime
 *  [P5]  recoverPaymentSession()         — page-load recovery
 *
 *  ── BUG FIXES (previously in fixes.js / bmg_fixes.js) ──────────
 *  [F1]  tournamentCurrentStep / currentGroundStep  — before init
 *  [F2]  translateX  — before init  +  Premium image viewer
 *  [F3]  Professional slot renderer (Confirmed / Available / Past)
 *  [F4]  Instant slot release on payment cancel / page return
 *  [F5]  WhatsApp-style profile picture upload + crop preview
 *  [F6]  Professional QR scanner open animation
 *  [F7]  Remove obsolete "Verify ₹499 Payment" owner tab
 *  [F8]  Patch showCreateTournamentModal / showAddGroundModal
 *
 *  ── NEW FIXES (previously in bmg_fixes.js) ──────────────────────
 *  [N1]  initiateOwnerOnboardingPayment undefined → replaced
 *  [N2]  Add Ground "Next" button not working → full nav patch
 *  [N3]  QR verification only allowed on booking day (+ 15 min)
 *  [N4]  Tournament form fields — ensure all details shown
 *  [N5]  Owner earnings — real amounts, no payout system,
 *         7-working-day note, per-booking history
 *  [N6]  CEO Transfer Flow — per-owner pending balance,
 *         "Mark Payment Sent" → owner_transfers Firestore
 *
 *  LOAD ORDER in index.html (end of <body>):
 *    <script src="paymentService.js"></script>   ← this file
 *    <script src="app_payment_integration.js"></script>
 *    <script src="app.js"></script>
 * ═══════════════════════════════════════════════════════════════════
 */

/* ═══════════════════════════════════════════════════════════════════
 *  §0  GLOBAL VARIABLE GUARDS
 *  Must run synchronously before ANY other code executes so that
 *  event listeners wired before the `let` declarations don't crash.
 * ═══════════════════════════════════════════════════════════════════*/
if (typeof window.tournamentCurrentStep === 'undefined') window.tournamentCurrentStep = 1;
if (typeof window.tournamentTotalSteps  === 'undefined') window.tournamentTotalSteps  = 4;
if (typeof window.currentGroundStep     === 'undefined') window.currentGroundStep     = 1;
if (typeof window.totalGroundSteps      === 'undefined') window.totalGroundSteps      = 3;
if (typeof window._ivTranslateX         === 'undefined') { window._ivTranslateX = 0; window._ivTranslateY = 0; }


/* ═══════════════════════════════════════════════════════════════════
 *  §1  PAYMENT ENGINE
 * ═══════════════════════════════════════════════════════════════════*/

// Cloud Functions base URL
const BMG_CF_BASE = 'https://us-central1-bookmygame-2149d.cloudfunctions.net';

/**
 * [P1] startPayment — unified entry point
 * @param {object} paymentData  — plain-JS object (no Firestore types)
 * @param {string} paymentType  — 'booking' | 'owner_onboarding' | 'tournament'
 */
async function startPayment(paymentData, paymentType) {
  const cu = window.currentUser;
  if (!cu) {
    _bmgToast('Please login first', 'warning');
    return;
  }

  _bmgShowLoading('Preparing payment…');

  try {
    // Generate a unique order ID
    const orderId = `BMG_${paymentType.toUpperCase()}_${Date.now()}_${Math.random().toString(36).slice(2,8).toUpperCase()}`;

    // ── Step 1: Write pending_payments document in Firestore ──────────
    const pendingData = _buildPendingDoc(orderId, paymentType, paymentData, cu);
    await window.db.collection('pending_payments').doc(orderId).set(pendingData);

    // ── Step 2: Lock slot if booking ──────────────────────────────────
    if (paymentType === 'booking') {
      await createPendingBookingWithSlotLock(orderId, paymentData);
    }

    // ── Step 3: Call createOrder Cloud Function ───────────────────────
    const cfRes = await fetch(`${BMG_CF_BASE}/createOrder`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        orderId,
        paymentType,
        customer: {
          id   : cu.uid,
          name : paymentData.userName  || cu.name  || '',
          email: paymentData.userEmail || cu.email || '',
          phone: paymentData.userPhone || cu.phone || '',
        },
      }),
    });

    if (!cfRes.ok) {
      const err = await cfRes.json().catch(() => ({}));
      throw new Error(err.error || `Server error ${cfRes.status}`);
    }

    const { payment_session_id } = await cfRes.json();
    if (!payment_session_id) throw new Error('No payment session returned');

    _bmgHideLoading();

    // ── Step 4: Open Cashfree popup ───────────────────────────────────
    await _openCashfreePopup(payment_session_id, orderId, paymentType, paymentData);

  } catch (err) {
    _bmgHideLoading();
    console.error('[paymentService] startPayment error:', err);
    _bmgToast('Payment error: ' + err.message, 'error');
  }
}

/** Build the pending_payments document */
function _buildPendingDoc(orderId, paymentType, data, cu) {
  const base = {
    orderId,
    paymentType,
    userId    : cu.uid,
    userName  : data.userName  || cu.name  || '',
    userEmail : data.userEmail || cu.email || '',
    userPhone : data.userPhone || cu.phone || '',
    amount    : Number(data.amount) || 0,
    createdAt : firebase.firestore.FieldValue.serverTimestamp(),
    status    : 'pending',
  };
  if (paymentType === 'booking') {
    return {
      ...base,
      bookingId     : orderId,
      groundId      : data.groundId      || '',
      groundName    : data.groundName    || '',
      venueName     : data.venueName     || '',
      venueAddress  : data.venueAddress  || '',
      groundAddress : data.groundAddress || '',
      sportType     : data.sportType     || '',
      ownerId       : data.ownerId       || '',
      isPlotOwner   : Boolean(data.isPlotOwner),
      date          : data.date          || '',
      slotTime      : data.slotTime      || '',
      originalAmount: Number(data.originalAmount || data.amount) || 0,
      ownerAmount   : Number(data.ownerAmount)   || Math.floor(Number(data.amount) * 0.93),
      platformFee   : Number(data.amount) - Math.floor(Number(data.amount) * 0.93),
      commission    : Number(data.amount) - Math.floor(Number(data.amount) * 0.93),
      promoCode     : data.promoCode    || '',
      appliedOffer  : data.appliedOffer  || '',
    };
  }
  if (paymentType === 'owner_onboarding') {
    return { ...base, ownerId: data.ownerId || cu.uid, amount: 5 };
  }
  if (paymentType === 'tournament') {
    return {
      ...base,
      tournamentId  : data.tournamentId   || '',
      tournamentName: data.tournamentName  || '',
      teamName      : data.teamName        || '',
      sport         : data.sport           || '',
      date          : data.date            || '',
      venue         : data.venue           || '',
    };
  }
  // POOL BOOKING PAYMENT TYPE
  if (paymentType === 'pool' || paymentType === 'pool_booking') {
    return {
      ...base,
      bookingId      : orderId,
      isPoolBooking  : true,
      poolId         : data.poolId        || '',
      poolName       : data.poolName      || '',
      poolAddress    : data.poolAddress   || data.address || '',
      address        : data.address       || data.poolAddress || '',
      slotId         : data.slotId        || '',
      ownerId        : data.ownerId       || '',
      date           : data.date          || '',
      slotTime       : data.slotTime      || '',
      memberCount    : Number(data.memberCount) || 1,
      originalAmount : Number(data.originalAmount || data.amount) || 0,
      ownerAmount    : Number(data.ownerAmount)   || Math.floor(Number(data.amount) * 0.93),
      platformFee    : Number(data.amount) - Math.floor(Number(data.amount) * 0.93),
      commission     : Number(data.amount) - Math.floor(Number(data.amount) * 0.93),
    };
  }
  return base;
}

/** [P2] Lock slot while payment is in progress */
async function createPendingBookingWithSlotLock(orderId, bookingData) {
  if (!bookingData.groundId || !bookingData.date || !bookingData.slotTime) return;

  const db = window.db;
  const startTime = (bookingData.slotTime || '').split('-')[0].trim();

  const slotsSnap = await db.collection('slots')
    .where('groundId',  '==', bookingData.groundId)
    .where('date',      '==', bookingData.date)
    .where('startTime', '==', startTime)
    .where('status',    '==', 'available')
    .limit(1)
    .get();

  if (!slotsSnap.empty) {
    const lockExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 min
    await slotsSnap.docs[0].ref.update({
      status        : 'locked',
      lockOrderId   : orderId,
      lockExpiresAt : firebase.firestore.Timestamp.fromDate(lockExpiry),
      lockExpiresAtMs: lockExpiry.getTime(),
      updatedAt     : firebase.firestore.FieldValue.serverTimestamp(),
    });
  }

  // Store in sessionStorage for slot release on cancel
  try {
    sessionStorage.setItem('slotLock', JSON.stringify({
      orderId,
      groundId : bookingData.groundId,
      date     : bookingData.date,
      slotTime : bookingData.slotTime,
      lockedAt : Date.now(),
    }));
  } catch (e) {}
}

/** [P3] Release a locked slot */
async function releaseSlotLock(orderId) {
  if (!orderId) return;
  const db = window.db;
  try {
    const snap = await db.collection('slots')
      .where('lockOrderId', '==', orderId)
      .limit(1)
      .get();
    if (!snap.empty) {
      await snap.docs[0].ref.update({
        status        : 'available',
        lockOrderId   : null,
        lockExpiresAt : null,
        lockExpiresAtMs: null,
        updatedAt     : firebase.firestore.FieldValue.serverTimestamp(),
      });
    }
    // Also delete pending_payments doc
    const pendingRef = db.collection('pending_payments').doc(orderId);
    const pSnap = await pendingRef.get();
    if (pSnap.exists) await pendingRef.delete();
  } catch (e) {
    console.warn('[paymentService] releaseSlotLock error:', e);
  }
}

/** Open Cashfree SDK popup */
async function _openCashfreePopup(sessionId, orderId, paymentType, paymentData) {
  if (typeof window.Cashfree === 'undefined') {
    throw new Error('Cashfree SDK not loaded. Check your internet connection.');
  }

  const cashfree = await window.Cashfree({ mode: 'production' });

  const checkoutOptions = {
    paymentSessionId : sessionId,
    redirectTarget   : '_modal',
  };

  // Listen for Firestore confirmation while popup is open
  const unsubscribe = _listenForPaymentConfirmation(orderId, paymentType, () => {
    cashfree.close && cashfree.close();
  });

  try {
    const result = await cashfree.checkout(checkoutOptions);

    if (unsubscribe) unsubscribe();

    if (result && result.paymentDetails) {
      const status = result.paymentDetails.paymentStatus;
      if (status === 'SUCCESS') {
        // Webhook will write to Firestore — poll for confirmation
        await recoverPaymentSession(orderId, paymentType, paymentData);
      } else if (status === 'FAILED' || status === 'USER_DROPPED') {
        await releaseSlotLock(orderId);
        sessionStorage.removeItem('slotLock');
        window.dispatchEvent(new CustomEvent('bmg:paymentCancelled', { detail: { orderId } }));
        _bmgToast('Payment was not completed. Your slot has been released.', 'warning');
      }
    }
  } catch (popupErr) {
    if (unsubscribe) unsubscribe();
    // Popup closed or failed — check status via Cloud Function
    await recoverPaymentSession(orderId, paymentType, paymentData);
  }
}

/** [P4] Listen for Firestore payment confirmation (realtime) */
function _listenForPaymentConfirmation(orderId, paymentType, onConfirmed) {
  const db = window.db;

  // Watch pending_payments — when it disappears, webhook has processed it
  const unsubPending = db.collection('pending_payments').doc(orderId)
    .onSnapshot(snap => {
      if (!snap.exists) {
        // Doc deleted — webhook fired. Check what happened.
        _checkFinalStatus(orderId, paymentType).then(result => {
          if (result.success) {
            _handlePaymentSuccess(orderId, paymentType, result.data);
            if (onConfirmed) onConfirmed();
          }
        });
      }
    }, err => {
      console.warn('[paymentService] pending listener error:', err);
    });

  return unsubPending;
}

/** [P5] Recover payment session (called on page load or popup close) */
async function recoverPaymentSession(orderId, paymentType, paymentData) {
  if (!orderId) return;

  _bmgShowLoading('Verifying payment…');
  let attempts = 0;
  const maxAttempts = 20;

  const poll = async () => {
    attempts++;
    const result = await _checkFinalStatus(orderId, paymentType);

    if (result.success) {
      _bmgHideLoading();
      _handlePaymentSuccess(orderId, paymentType, result.data || paymentData);
      sessionStorage.removeItem('slotLock');
      return;
    }

    if (result.failed) {
      _bmgHideLoading();
      await releaseSlotLock(orderId);
      sessionStorage.removeItem('slotLock');
      _bmgToast('Payment failed. Please try again.', 'error');
      return;
    }

    if (attempts < maxAttempts) {
      setTimeout(poll, 3000);
    } else {
      // Final fallback: call checkOrderStatus Cloud Function
      _bmgHideLoading();
      try {
        const cfRes = await fetch(`${BMG_CF_BASE}/checkOrderStatus`, {
          method : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body   : JSON.stringify({ orderId, paymentType }),
        });
        const data = await cfRes.json();
        if (data.status === 'SUCCESS') {
          _handlePaymentSuccess(orderId, paymentType, data.booking || paymentData);
          sessionStorage.removeItem('slotLock');
        } else if (data.status === 'FAILED') {
          await releaseSlotLock(orderId);
          sessionStorage.removeItem('slotLock');
          _bmgToast('Payment failed. Your slot has been released.', 'error');
        } else {
          _bmgToast('Payment status unknown. Please check "My Bookings".', 'warning');
        }
      } catch (e) {
        _bmgToast('Could not verify payment. Please check "My Bookings".', 'warning');
      }
    }
  };

  poll();
}

/** Check Firestore final collections for this orderId */
async function _checkFinalStatus(orderId, paymentType) {
  const db = window.db;
  try {
    // Check failed first (fast negative)
    const failSnap = await db.collection('failed_payments').doc(orderId).get();
    if (failSnap.exists) return { failed: true };

    // Check success collections
    if (!paymentType || paymentType === 'booking') {
      const s = await db.collection('bookings').doc(orderId).get();
      if (s.exists) return { success: true, data: s.data() };
    }
    if (!paymentType || paymentType === 'tournament') {
      const s = await db.collection('tournament_entries').doc(orderId).get();
      if (s.exists) return { success: true, data: s.data() };
    }
    if (!paymentType || paymentType === 'owner_onboarding') {
      const s = await db.collection('owner_payments').doc(orderId).get();
      if (s.exists) return { success: true, data: { orderId } };
    }
  } catch (e) {
    console.warn('[paymentService] _checkFinalStatus error:', e);
  }
  return {};
}

/** Dispatch confirmed event so app.js / bmg_confirmed listener handles UI */
async function _handlePaymentSuccess(orderId, paymentType, data) {
  console.log('[paymentService] ✅ Payment confirmed:', paymentType, orderId);

  // ── Enrich data from pending_payments so ownerId/ownerAmount are always present ──
  // The webhook-written booking doc may be missing these fields. pending_payments
  // always has them because _buildPendingDoc() stores them at payment start.
  if (paymentType === 'booking') {
    let enriched = Object.assign({}, data || {});
    const needsEnrich = !enriched.ownerId || !enriched.ownerAmount;
    if (needsEnrich && window.db) {
      try {
        const ppSnap = await window.db.collection('pending_payments').doc(orderId).get();
        if (ppSnap.exists) {
          const pp = ppSnap.data();
          enriched.ownerId      = enriched.ownerId      || pp.ownerId      || '';
          enriched.ownerAmount  = enriched.ownerAmount  || pp.ownerAmount  || Math.floor(Number(pp.amount || 0) * 0.93);
          enriched.amount       = enriched.amount       || pp.amount       || 0;
          enriched.groundId     = enriched.groundId     || pp.groundId     || '';
          enriched.groundName   = enriched.groundName   || pp.groundName   || pp.venueName || '';
          enriched.date         = enriched.date         || pp.date         || '';
          enriched.slotTime     = enriched.slotTime     || pp.slotTime     || '';
          enriched.userId       = enriched.userId       || pp.userId       || '';
          enriched.userName     = enriched.userName     || pp.userName     || '';
          enriched.userPhone    = enriched.userPhone    || pp.userPhone    || '';
          enriched.sportType    = enriched.sportType    || pp.sportType    || '';
          console.log('[paymentService] ✅ Enriched booking data from pending_payments — ownerId:', enriched.ownerId, 'ownerAmount:', enriched.ownerAmount);
        }
      } catch (ppErr) {
        console.warn('[paymentService] pending_payments enrichment error (non-critical):', ppErr.message);
      }
    }
    data = enriched;
  }

  // ── FIX: Mark slot BEFORE firing bmg:paymentConfirmed so the Firestore doc
  //    exists when the event listener calls loadSlots / renders the slot grid.
  //    Also handles the case where data fields are missing by falling back to
  //    sessionStorage (pendingBooking / currentBookingDetails).
  if (paymentType === 'booking') {
    // Merge data with sessionStorage fallback for robustness
    let bookingData = Object.assign({}, data || {});
    if (!bookingData.groundId || !bookingData.slotTime || !bookingData.date) {
      try {
        const stored = JSON.parse(
          sessionStorage.getItem('pendingBooking') ||
          sessionStorage.getItem('pendingCashfreeBooking') ||
          sessionStorage.getItem('currentBookingDetails') ||
          'null'
        );
        if (stored) {
          bookingData.groundId  = bookingData.groundId  || stored.groundId  || '';
          bookingData.date      = bookingData.date      || stored.date      || '';
          bookingData.slotTime  = bookingData.slotTime  || stored.slotTime  || stored.time || '';
          bookingData.ownerId   = bookingData.ownerId   || stored.ownerId   || '';
          bookingData.bookingId = bookingData.bookingId || stored.bookingId || orderId;
          bookingData.userId    = bookingData.userId    || stored.userId    || '';
        }
      } catch (_) {}
    }
    // Ensure bookingId is always set
    if (!bookingData.bookingId) bookingData.bookingId = orderId;

    if (bookingData.groundId && bookingData.slotTime && bookingData.date) {
      if (typeof window.markSlotAsConfirmed === 'function') {
        try {
          await window.markSlotAsConfirmed(bookingData);
          console.log('[paymentService] ✅ Slot marked confirmed before event dispatch');
        } catch (err) {
          console.warn('[paymentService] Slot confirmation error (non-critical):', err);
        }
      } else {
        // markSlotAsConfirmed not yet loaded — try direct Firestore write
        _markSlotBookedDirect(bookingData, orderId);
      }
    } else {
      console.warn('[paymentService] Missing slot fields for markSlotAsConfirmed', bookingData);
    }
  }

  window.dispatchEvent(new CustomEvent('bmg:paymentConfirmed', {
    detail: { orderId, paymentType, result: data },
  }));
}

/** Fallback: directly write slot to Firestore if markSlotAsConfirmed not loaded yet */
function _markSlotBookedDirect(bookingData, orderId) {
  const db = window.db;
  if (!db) return;
  const rawSlot = (bookingData.slotTime || '').replace(/\s/g, '');
  const parts   = rawSlot.split('-');
  const start   = (parts[0] || '').trim();
  const end     = (parts[1] || '').trim();
  if (!start) return;
  const FV = firebase.firestore.FieldValue;
  const userId = bookingData.userId || (window.currentUser && window.currentUser.uid) || '';
  db.collection('slots')
    .where('groundId',  '==', bookingData.groundId)
    .where('date',      '==', bookingData.date)
    .where('startTime', '==', start)
    .limit(1).get()
    .then(snap => {
      if (!snap.empty) {
        return snap.docs[0].ref.update({
          status: 'booked', bookingId: orderId, bookedBy: userId,
          updatedAt: FV.serverTimestamp(),
        });
      }
      return db.collection('slots').add({
        groundId: bookingData.groundId, date: bookingData.date,
        startTime: start, endTime: end, slotTime: rawSlot,
        status: 'booked', bookingId: orderId, bookedBy: userId,
        bookedAt: FV.serverTimestamp(), createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp(),
      });
    })
    .then(() => console.log('[paymentService] ✅ Slot booked via direct Firestore write:', start))
    .catch(err => console.warn('[paymentService] Direct slot write error:', err));
}

/** Helpers */
function _bmgToast(msg, type) {
  if (typeof window.showToast === 'function') window.showToast(msg, type);
  else console.log('[bmg-toast]', type, msg);
}
function _bmgShowLoading(msg) {
  if (typeof window.showLoading === 'function') window.showLoading(msg);
}
function _bmgHideLoading() {
  if (typeof window.hideLoading === 'function') window.hideLoading();
}

// Expose payment engine globally
window.startPayment                       = startPayment;
window.createPendingBookingWithSlotLock   = createPendingBookingWithSlotLock;
window.releaseSlotLock                    = releaseSlotLock;
window.recoverPaymentSession              = recoverPaymentSession;


/* ═══════════════════════════════════════════════════════════════════
 *  §2  ALL PATCHES (IIFE — runs after DOM ready)
 * ═══════════════════════════════════════════════════════════════════*/
(function () {
  'use strict';

  function onReady(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  /* ─────────────────────────────────────────────────────────────────
   *  [N1]  FIX: initiateOwnerOnboardingPayment not defined
   *  app.js showOwnerRegistrationPayment() calls a function that
   *  was never defined. Replace with correct version that calls
   *  startPayment() defined above.
   * ─────────────────────────────────────────────────────────────────*/
  function patchOwnerRegistrationPayment() {
    window.showOwnerRegistrationPayment = async function () {
      const cu = window.currentUser;
      if (!cu) {
        _bmgToast('Please login first', 'warning');
        if (typeof window.showPage === 'function') window.showPage('login-page');
        return;
      }
      const db = window.db;
      try {
        const ownerSnap = await db.collection('owners').doc(cu.uid).get();
        if (ownerSnap.exists) {
          const o = ownerSnap.data();
          if (o.isActive && o.paymentDone) {
            _bmgToast('Your account is already active!', 'success');
            return;
          }
        }
        const ownerData = ownerSnap.exists ? ownerSnap.data() : {};
        const pd = {
          ownerId  : String(cu.uid),
          userName : String(cu.ownerName || cu.name || ownerData.ownerName || ownerData.name || ''),
          userEmail: String(cu.email  || ownerData.email  || ''),
          userPhone: String(cu.phone  || ownerData.phone  || ''),
          amount   : 5, // registration fee
        };
        await startPayment(pd, 'owner_onboarding');
      } catch (err) {
        console.error('[paymentService] showOwnerRegistrationPayment:', err);
        _bmgToast('Error: ' + err.message, 'error');
      }
    };
    window.processRegistrationPayment          = window.showOwnerRegistrationPayment;
    window.initiateOwnerOnboardingPayment      = window.showOwnerRegistrationPayment;
    window.initiateOwnerRegistrationPayment    = window.showOwnerRegistrationPayment;
  }

  /* ─────────────────────────────────────────────────────────────────
   *  [F8 + N2]  Patch showCreateTournamentModal + showAddGroundModal
   * ─────────────────────────────────────────────────────────────────*/
  function patchModalStepVariables() {
    // ── Tournament modal ─────────────────────────────────────────────
    const origTournament = window.showCreateTournamentModal;
    window.showCreateTournamentModal = function () {
      window.tournamentCurrentStep = 1;
      try {
        if (typeof origTournament === 'function') origTournament.apply(this, arguments);
      } catch (e) {
        window.tournamentCurrentStep = 1;
        const modal = document.getElementById('create-tournament-modal');
        if (modal) { modal.classList.add('active'); document.body.style.overflow = 'hidden'; }
        if (typeof window.initializeTournamentStepNavigation === 'function') {
          window.initializeTournamentStepNavigation();
        }
        if (typeof window.updateTournamentStep === 'function') window.updateTournamentStep(1);
        console.warn('[paymentService] showCreateTournamentModal fallback:', e.message);
      }
      // Ensure form fields exist
      setTimeout(_ensureTournamentFormFields, 120);
    };

    // ── Add Ground modal ─────────────────────────────────────────────
    const origGround = window.showAddGroundModal;
    window.showAddGroundModal = function () {
      window.currentGroundStep = 1;
      try {
        if (typeof origGround === 'function') origGround.apply(this, arguments);
      } catch (e) {
        window.currentGroundStep = 1;
        const modal = document.getElementById('add-ground-modal');
        if (modal) { modal.classList.add('active'); document.body.style.overflow = 'hidden'; }
        console.warn('[paymentService] showAddGroundModal fallback:', e.message);
      }
      // Re-wire navigation buttons after modal opens
      setTimeout(() => {
        _groundUpdateStep(1);
        _wireGroundNavButtons();
        // Re-initialise image upload so the file input has a fresh change listener.
        // initializeImageUpload is defined in app.js and exposed to window; calling it
        // here covers the case where the patched wrapper is what actually opens the modal.
        if (typeof window.initializeImageUpload === 'function') {
          window.initializeImageUpload();
        }
      }, 60);
    };
  }

  /* ─────────────────────────────────────────────────────────────────
   *  [N2]  Add Ground Step Navigation
   * ─────────────────────────────────────────────────────────────────*/
  function _groundUpdateStep(step) {
    const total = window.totalGroundSteps || 3;
    window.currentGroundStep = step;

    document.querySelectorAll('#add-ground-modal .form-step')
      .forEach(s => s.classList.remove('active'));
    document.querySelectorAll('#add-ground-modal .progress-step')
      .forEach(s => s.classList.remove('active', 'completed'));

    const cur  = document.querySelector(`#add-ground-modal .form-step[data-step="${step}"]`);
    const curP = document.querySelector(`#add-ground-modal .progress-step[data-step="${step}"]`);
    if (cur)  cur.classList.add('active');
    if (curP) curP.classList.add('active');

    for (let i = 1; i < step; i++) {
      const done = document.querySelector(`#add-ground-modal .progress-step[data-step="${i}"]`);
      if (done) done.classList.add('completed');
    }

    const prevBtn   = document.getElementById('prev-step-btn');
    const nextBtn   = document.getElementById('next-step-btn');
    const submitBtn = document.getElementById('submit-ground-btn');

    if (prevBtn)   prevBtn.disabled       = (step === 1);
    if (nextBtn)   nextBtn.style.display  = (step === total) ? 'none' : 'flex';
    if (submitBtn) submitBtn.style.display = (step === total) ? 'flex' : 'none';
  }

  function _groundValidateStep(step) {
    if (step === 1) {
      const name  = document.getElementById('ground-name-input')?.value.trim();
      const sport = document.getElementById('ground-sport-input')?.value;
      if (!name || name.length < 2) { _bmgToast('Please enter a valid ground name', 'error'); return false; }
      if (!sport)                    { _bmgToast('Please select sport type', 'error');          return false; }
    }
    if (step === 2) {
      const price = parseFloat(document.getElementById('ground-price-input')?.value || '');
      if (isNaN(price) || price <= 0) { _bmgToast('Please select a valid price', 'error'); return false; }
    }
    return true;
  }

  function _wireGroundNavButtons() {
    const prevBtn   = document.getElementById('prev-step-btn');
    const nextBtn   = document.getElementById('next-step-btn');
    const submitBtn = document.getElementById('submit-ground-btn');
    if (!prevBtn || !nextBtn) return;

    const np = prevBtn.cloneNode(true);
    const nn = nextBtn.cloneNode(true);
    prevBtn.parentNode.replaceChild(np, prevBtn);
    nextBtn.parentNode.replaceChild(nn, nextBtn);

    np.addEventListener('click', () => {
      if (window.currentGroundStep > 1) _groundUpdateStep(window.currentGroundStep - 1);
    });
    nn.addEventListener('click', () => {
      if (_groundValidateStep(window.currentGroundStep)) {
        const total = window.totalGroundSteps || 3;
        if (window.currentGroundStep < total) _groundUpdateStep(window.currentGroundStep + 1);
      }
    });

    if (submitBtn) {
      const ns = submitBtn.cloneNode(true);
      submitBtn.parentNode.replaceChild(ns, submitBtn);
      ns.addEventListener('click', e => {
        e.preventDefault();
        const form = document.getElementById('add-ground-form');
        if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
    }
  }

  /* ─────────────────────────────────────────────────────────────────
   *  [N3]  QR verification — only on booking day (+ 15 min before)
   * ─────────────────────────────────────────────────────────────────*/
  function patchQRVerification() {
    window.processVerifiedQRCode = async function (qrData) {
      const db = window.db;
      const COLLECTIONS  = window.COLLECTIONS  || {};
      const BOOKING_STATUS = window.BOOKING_STATUS || {};
      const resultDiv = document.getElementById('professional-qr-result');

      try {
        let qrObj;
        try { qrObj = JSON.parse(qrData); } catch (e) { throw new Error('Invalid QR Code Format'); }
        if (!qrObj.appId || qrObj.appId !== 'BookMyGame') throw new Error('QR not from BookMyGame');

        const cu = window.currentUser;
        if (!cu) throw new Error('Please login first');

        const bookSnap = await db.collection(COLLECTIONS.BOOKINGS || 'bookings')
          .where('bookingId', '==', qrObj.bookingId).get();
        if (bookSnap.empty) throw new Error('Booking not found');

        const bookDoc = bookSnap.docs[0];
        const booking = bookDoc.data();

        // DATE: must be today
        const today = new Date().toISOString().split('T')[0];
        if (booking.date !== today) {
          throw new Error(`Verification is only allowed on the booking day (${booking.date}). Today is ${today}.`);
        }

        // OWNERSHIP
        const groundDoc = await db.collection(COLLECTIONS.GROUNDS || 'grounds').doc(booking.groundId).get();
        if (!groundDoc.exists) throw new Error('Ground not found');
        if (groundDoc.data().ownerId !== cu.uid) throw new Error('You can only verify bookings for your own grounds');
        if (booking.groundId !== qrObj.groundId) throw new Error('QR is for a different ground');

        // ALREADY USED
        if (booking.entryStatus === 'used') throw new Error('This entry has already been used');

        // STATUS
        if (booking.bookingStatus !== (BOOKING_STATUS.CONFIRMED || 'confirmed')) {
          throw new Error(`Booking not confirmed. Status: ${booking.bookingStatus}`);
        }

        // TIME WINDOW: 15 min before → 60 min after slot start
        const now = new Date();
        const parts = (booking.slotTime || '').split('-')[0].split(':').map(Number);
        const slotStart = new Date(booking.date);
        slotStart.setHours(parts[0] || 0, parts[1] || 0, 0, 0);
        const entryOpen  = new Date(slotStart.getTime() - 15 * 60 * 1000);
        const entryClose = new Date(slotStart.getTime() + 60 * 60 * 1000);

        if (now < entryOpen) {
          const wait = Math.ceil((entryOpen - now) / 60000);
          throw new Error(`Entry opens at ${entryOpen.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}. Wait ${wait} min.`);
        }
        if (now > entryClose) {
          throw new Error(`Entry window closed at ${entryClose.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}`);
        }

        // ALL CHECKS PASSED
        await bookDoc.ref.update({
          entryStatus   : 'used',
          entryTime     : firebase.firestore.FieldValue.serverTimestamp(),
          verifiedBy    : cu.uid,
          verifiedByName: cu.ownerName || cu.name || '',
          verifiedAt    : firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt     : firebase.firestore.FieldValue.serverTimestamp(),
        });
        await db.collection(COLLECTIONS.GROUNDS || 'grounds').doc(booking.groundId).update({
          lastVerifiedAt      : firebase.firestore.FieldValue.serverTimestamp(),
          totalEntriesVerified: firebase.firestore.FieldValue.increment(1),
        });

        if (typeof window.showVerificationResult === 'function') window.showVerificationResult(true, booking);

      } catch (err) {
        console.error('[paymentService] QR verification error:', err);
        if (typeof window.showVerificationResult === 'function') {
          window.showVerificationResult(false, null, err.message);
        } else if (resultDiv) {
          resultDiv.innerHTML = `<div style="color:red;padding:16px;">${err.message}</div>`;
        }
      }
    };
  }

  /* ─────────────────────────────────────────────────────────────────
   *  [N4]  Tournament form — ensure all fields exist
   * ─────────────────────────────────────────────────────────────────*/
  function _ensureTournamentFormFields() {
    const form = document.getElementById('create-tournament-form');
    if (!form) return;

    const step1 = form.querySelector('.form-step[data-step="1"]');
    if (step1) {
      _injectTField(step1, 'tournament-name',        'text',     'Tournament Name *',   'e.g. Summer Cricket Cup');
      _injectTField(step1, 'tournament-sport',       'select',   'Sport Type *',        '', ['Cricket','Football','Basketball','Badminton','Tennis','Volleyball','Kabaddi','Other']);
      _injectTField(step1, 'tournament-type',        'select',   'Tournament Format *', '', ['Single Elimination','Double Elimination','Round Robin','League','Knockout']);
      _injectTField(step1, 'tournament-description', 'textarea', 'Description',         'Describe your tournament…');
    }
    const step2 = form.querySelector('.form-step[data-step="2"]');
    if (step2) {
      _injectTField(step2, 'tournament-start-date', 'date',   'Start Date *');
      _injectTField(step2, 'tournament-end-date',   'date',   'End Date *');
      _injectTField(step2, 'tournament-venue',      'text',   'Venue / Location *', 'Ground name or address');
      _injectTField(step2, 'tournament-max-teams',  'number', 'Max Teams *',         'e.g. 16');
    }
    const step3 = form.querySelector('.form-step[data-step="3"]');
    if (step3) {
      _injectTField(step3, 'tournament-entry-fee', 'number',   'Entry Fee (₹) *',       'e.g. 500');
      _injectTField(step3, 'tournament-prize',     'text',     'Prize Pool / Trophy',   'e.g. ₹10,000 + Trophy');
      _injectTField(step3, 'tournament-rules',     'textarea', 'Rules & Regulations',   'Any specific rules…');
    }
    // Step 4 is the Contact Info step — its fields are already in the HTML, do not replace them.
    // Wire preview updater
    const nextBtn = document.getElementById('tournament-next-btn');
    if (nextBtn && !nextBtn.dataset.previewWired) {
      nextBtn.dataset.previewWired = '1';
      nextBtn.addEventListener('click', () => {
        if (window.tournamentCurrentStep === 3) _refreshTournamentPreview();
      });
    }
  }

  function _injectTField(container, id, type, label, placeholder, options) {
    if (container.querySelector('#' + id)) return;
    const wrap = document.createElement('div');
    wrap.className = 'form-group';
    let inner = '';
    if (type === 'select') {
      inner = `<select id="${id}" name="${id}" style="width:100%;padding:10px;border:1px solid var(--gray-200,#e5e7eb);border-radius:8px;font-size:14px;">
        <option value="">Select ${label.replace(' *','')}</option>
        ${(options||[]).map(o => `<option value="${o.toLowerCase().replace(/ /g,'_')}">${o}</option>`).join('')}
      </select>`;
    } else if (type === 'textarea') {
      inner = `<textarea id="${id}" name="${id}" placeholder="${placeholder||''}" rows="3"
        style="width:100%;padding:10px;border:1px solid var(--gray-200,#e5e7eb);border-radius:8px;font-size:14px;resize:vertical;"></textarea>`;
    } else {
      inner = `<input type="${type}" id="${id}" name="${id}" placeholder="${placeholder||''}"
        style="width:100%;padding:10px;border:1px solid var(--gray-200,#e5e7eb);border-radius:8px;font-size:14px;" />`;
    }
    wrap.innerHTML = `<label style="font-size:13px;font-weight:600;color:var(--gray-700,#374151);display:block;margin-bottom:4px;">${label}</label>${inner}`;
    container.appendChild(wrap);
  }

  function _refreshTournamentPreview() {
    const g = id => document.getElementById(id)?.value || '';
    const el = document.getElementById('tournament-preview-details');
    if (!el) return;
    el.innerHTML = `
      <div style="display:grid;gap:8px;">
        <div><strong>Name:</strong> ${_esc(g('tournament-name'))}</div>
        <div><strong>Sport:</strong> ${_esc(g('tournament-sport'))}</div>
        <div><strong>Format:</strong> ${_esc(g('tournament-type'))}</div>
        <div><strong>Dates:</strong> ${_esc(g('tournament-start-date'))} → ${_esc(g('tournament-end-date'))}</div>
        <div><strong>Venue:</strong> ${_esc(g('tournament-venue'))}</div>
        <div><strong>Max Teams:</strong> ${_esc(g('tournament-max-teams'))}</div>
        <div><strong>Entry Fee:</strong> ₹${_esc(g('tournament-entry-fee'))}</div>
        <div><strong>Prize:</strong> ${_esc(g('tournament-prize')) || 'N/A'}</div>
      </div>`;
  }

  /* ─────────────────────────────────────────────────────────────────
   *  [N5]  Owner Earnings — real data, no payout system
   *  Bridge: call app.js loadOwnerEarnings (the source of truth).
   *  The window._appLoadOwnerEarnings alias is registered immediately
   *  when app.js is parsed, so no polling is needed.
   * ─────────────────────────────────────────────────────────────────*/
  function patchOwnerEarnings() {
    async function _earningsBridge(container) {
      // Prefer direct alias (set by app.js at parse time)
      if (typeof window._appLoadOwnerEarnings === 'function') {
        return window._appLoadOwnerEarnings(container);
      }
      // Fallback: poll for up to 3 s (covers edge case where app.js is still parsing)
      let attempts = 0;
      while (typeof window._appLoadOwnerEarnings !== 'function' && attempts < 30) {
        await new Promise(r => setTimeout(r, 100));
        attempts++;
      }
      if (typeof window._appLoadOwnerEarnings === 'function') {
        return window._appLoadOwnerEarnings(container);
      }
      // Last resort fallback — direct Firestore query
      _bmgShowLoading('Loading earnings…');
      const db = window.db;
      const cu = window.currentUser;
      if (!db || !cu) { _bmgHideLoading(); container.innerHTML = '<p style="text-align:center;color:red;">Not ready</p>'; return; }
      try {
        const snap = await db.collection('bookings')
          .where('ownerId', '==', cu.uid)
          .where('bookingStatus', '==', 'confirmed')
          .get();
        let total = 0;
        snap.forEach(d => { total += d.data().ownerAmount || 0; });
        container.innerHTML = `<div class="stat-card"><div class="stat-value">₹${total.toFixed(2)}</div><div class="stat-label">Total Earned</div></div>`;
        _bmgHideLoading();
      } catch (err) {
        _bmgHideLoading();
        container.innerHTML = `<p style="text-align:center;color:red;">Failed: ${err.message}</p>`;
      }
    }
    window.loadOwnerEarnings        = _earningsBridge;
    window._bmgLoadOwnerEarningsFull = _earningsBridge;
  }

  /* ─────────────────────────────────────────────────────────────────
   *  [N6]  CEO Transfer Flow — per-owner pending balance + Mark Sent
   * ─────────────────────────────────────────────────────────────────*/
  function patchCEOPayouts() {
    window.loadPayoutsList = async function (container) {
      _bmgShowLoading('Loading owner transfers…');
      const db = window.db;
      const fmt = typeof window.formatCurrency === 'function'
        ? window.formatCurrency
        : v => '₹' + (v||0).toFixed(2);
      const COLLECTIONS   = window.COLLECTIONS   || {};
      const BOOKING_STATUS = window.BOOKING_STATUS || {};

      try {
        const ownersSnap  = await db.collection(COLLECTIONS.OWNERS || 'owners').get();
        const bookingsSnap = await db.collection(COLLECTIONS.BOOKINGS || 'bookings')
          .where('bookingStatus', '==', BOOKING_STATUS.CONFIRMED || 'confirmed')
          .orderBy('date', 'desc').get();

        // Aggregate per owner
        const ownerMap = {};
        bookingsSnap.forEach(doc => {
          const b = doc.data(); const oid = b.ownerId; if (!oid) return;
          if (!ownerMap[oid]) ownerMap[oid] = { name: b.ownerName || oid, phone:'', email:'', upi:'', total:0, bookings:[] };
          ownerMap[oid].total += b.ownerAmount || 0;
          ownerMap[oid].bookings.push(b);
        });
        ownersSnap.forEach(doc => {
          const o = doc.data(); const oid = doc.id;
          if (!ownerMap[oid]) ownerMap[oid] = { name: o.ownerName||o.name||oid, phone:'', email:'', upi:'', total:0, bookings:[] };
          Object.assign(ownerMap[oid], {
            name : o.ownerName  || o.name  || oid,
            phone: o.phone      || '',
            email: o.email      || '',
            upi  : o.upiId      || '',
          });
        });

        // Get already-sent amounts per owner
        const sentMap = {};
        await Promise.all(Object.keys(ownerMap).map(async oid => {
          const ts = await db.collection('owner_transfers').where('ownerId','==',oid).get().catch(()=>({docs:[]}));
          sentMap[oid] = ts.docs.reduce((s,d) => s + (d.data().amount||0), 0);
        }));

        // Platform revenue: booking commissions + tournament platform fees
        let platformRev = 0;
        bookingsSnap.forEach(doc => {
          platformRev += doc.data().commission || (doc.data().amount * 0.07) || 0;
        });
        // Also add tournament platform fees (20% of each entry fee)
        // Fetch all tournament_entries for owner's tournaments
        const ownerTourneyIds = ownersSnap.docs.map(d => d.id);
        if (ownerTourneyIds.length > 0) {
          const tChunks = [];
          for (let i = 0; i < ownerTourneyIds.length; i += 30) tChunks.push(ownerTourneyIds.slice(i, i+30));
          for (const chunk of tChunks) {
            const tE = await db.collection('tournament_entries').where('tournamentId', 'in', chunk).get().catch(()=>({docs:[]}));
            tE.docs.forEach(d => { const e = d.data(); platformRev += (e.platformFee || Math.round((e.amount||0)*0.20)); });
          }
        }

        const ownerRows = Object.entries(ownerMap).map(([oid, info]) => {
          const sent    = sentMap[oid] || 0;
          const pending = Math.max(0, info.total - sent);
          return `
            <div style="background:var(--bg-secondary,#f9fafb);border-radius:14px;padding:16px;margin-bottom:14px;border:1px solid var(--gray-100,#f3f4f6);">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
                <div>
                  <div style="font-weight:700;font-size:15px;">${_esc(info.name)}</div>
                  <div style="font-size:12px;color:var(--gray-500);">${_esc(info.phone)}${info.upi ? ' • UPI: '+_esc(info.upi) : ''}</div>
                  <div style="font-size:12px;color:var(--gray-500);">${info.bookings.length} ground booking(s)</div>
                </div>
                <div style="text-align:right;">
                  <div style="font-size:11px;color:var(--gray-500);">Total Earned</div>
                  <div style="font-weight:700;font-size:20px;color:var(--success,#10b981);">${fmt(info.total)}</div>
                </div>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px;">
                <div style="background:#fff;border-radius:8px;padding:10px;text-align:center;">
                  <div style="font-size:11px;color:var(--gray-500);">Sent</div>
                  <div style="font-weight:600;color:var(--primary,#6366f1);">${fmt(sent)}</div>
                </div>
                <div style="background:#fff;border-radius:8px;padding:10px;text-align:center;">
                  <div style="font-size:11px;color:var(--gray-500);">Pending</div>
                  <div style="font-weight:600;color:${pending > 0 ? '#f59e0b' : '#10b981'};">${fmt(pending)}</div>
                </div>
              </div>
              ${pending > 0 ? `
              <button onclick="window._bmgMarkPaymentSent('${oid}',${pending},'${_esc(info.name).replace(/'/g,"\\'")}','${_esc(info.upi)}')"
                style="width:100%;margin-top:12px;padding:11px;background:var(--gradient-primary,linear-gradient(135deg,#6366f1,#8b5cf6));color:#fff;border:none;border-radius:10px;font-weight:600;cursor:pointer;font-size:14px;">
                <i class="fas fa-paper-plane"></i> Mark ₹${Math.round(pending)} Payment as Sent
              </button>` : `
              <div style="margin-top:10px;padding:8px;text-align:center;background:#d1fae5;border-radius:8px;font-size:12px;color:#065f46;">
                <i class="fas fa-check-circle"></i> All payments sent
              </div>`}
            </div>`;
        }).join('');

        container.innerHTML = `
          <div style="background:var(--gradient-primary,linear-gradient(135deg,#6366f1,#8b5cf6));border-radius:16px;padding:20px;margin-bottom:20px;color:#fff;">
            <div style="font-size:13px;opacity:.85;margin-bottom:4px;"><i class="fas fa-chart-line"></i> Platform Revenue (Bookings 7% + Tournaments 20%)</div>
            <div style="font-size:32px;font-weight:700;">${fmt(platformRev)}</div>
            <div style="font-size:12px;opacity:.75;margin-top:4px;">From all confirmed bookings &amp; tournament registrations</div>
          </div>
          <div style="font-weight:700;font-size:16px;margin-bottom:16px;">
            <i class="fas fa-users" style="color:var(--primary,#6366f1);"></i> Owner Earnings &amp; Transfers
            <span style="font-weight:400;font-size:12px;color:var(--gray-500);margin-left:8px;">${Object.keys(ownerMap).length} owners</span>
          </div>
          ${Object.keys(ownerMap).length === 0
            ? '<div style="text-align:center;padding:32px;color:var(--gray-400);">No bookings yet</div>'
            : ownerRows}`;

        _bmgHideLoading();
      } catch (err) {
        _bmgHideLoading();
        container.innerHTML = `<p style="color:red;text-align:center;">${err.message}</p>`;
      }
    };

    window._bmgMarkPaymentSent = async function (ownerId, amount, ownerName, ownerUpi) {
      if (!confirm(`Mark ₹${Math.round(amount)} as sent to ${ownerName}?\n\nThis records that you have transferred this amount to the owner.`)) return;
      const note = prompt('Add note (optional — e.g. UPI transaction ID):', '') || '';
      const db = window.db;
      const cu = window.currentUser;
      try {
        _bmgShowLoading('Recording transfer…');
        await db.collection('owner_transfers').add({
          ownerId,
          ownerName,
          ownerUpi : ownerUpi || '',
          amount   : Number(amount),
          note,
          sentBy   : cu ? cu.uid  : 'admin',
          sentByName: cu ? (cu.name || cu.email || 'Admin') : 'Admin',
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          status   : 'sent',
        });
        _bmgHideLoading();
        _bmgToast(`Payment of ₹${Math.round(amount)} marked as sent to ${ownerName}`, 'success');
        // Refresh payouts panel
        const ctn = document.getElementById('ceo-dashboard-content');
        if (ctn && typeof window.loadPayoutsList === 'function') await window.loadPayoutsList(ctn);
      } catch (err) {
        _bmgHideLoading();
        _bmgToast('Error: ' + err.message, 'error');
      }
    };
  }

  /* ─────────────────────────────────────────────────────────────────
   *  [F3]  Professional Slot Renderer
   * ─────────────────────────────────────────────────────────────────*/
  function patchSlotRenderer() {
    const LABELS = {
      available:{ label:'Available',   icon:'🟢'},
      confirmed :{ label:'Confirmed',   icon:'🔴'},
      booked    :{ label:'Confirmed',   icon:'🔴'},
      past      :{ label:'Time Passed', icon:'⏳'},
      locked    :{ label:'Processing…', icon:'🔒'},
      pending   :{ label:'Processing…', icon:'🔒'},
      closed    :{ label:'Closed',      icon:'🚫'},
      selected  :{ label:'Selected',    icon:'✅'},
    };

    function upgrade(el) {
      if (el.dataset.upgraded) return; el.dataset.upgraded = '1';
      const slotAttr = el.dataset.slot || '';
      const raw = (el.textContent||'').trim();
      const timeDisplay = slotAttr
        ? slotAttr.replace('-',' – ')
        : raw.replace(/Available|Confirmed|Booked|Past|Locked|Processing|Closed|Selected|Time Passed/gi,'').trim();
      let status = 'available';
      for (const c of ['confirmed','booked','past','locked','pending','closed','selected']) {
        if (el.classList.contains(c)) { status = c; break; }
      }
      const info = LABELS[status] || LABELS.available;
      el.innerHTML = `
        <span class="slot-icon">${info.icon}</span>
        <span class="slot-time-text">${timeDisplay||'—'}</span>
        <span class="slot-status-tag">${info.label}</span>`;
    }

    function upgradeContainer(c) {
      if (!c) return;
      if (!c.classList.contains('slots-grid')) c.classList.add('slots-grid');
      c.querySelectorAll('.time-slot').forEach(upgrade);
      // Legend
      let leg = c.previousElementSibling;
      if (!leg || !leg.classList.contains('slot-legend')) {
        leg = document.createElement('div'); leg.className = 'slot-legend';
        leg.innerHTML = `
          <div class="slot-legend-item"><div class="slot-legend-dot available"></div>Available</div>
          <div class="slot-legend-item"><div class="slot-legend-dot booked"></div>Confirmed</div>
          <div class="slot-legend-item"><div class="slot-legend-dot past"></div>Time Passed</div>
          <div class="slot-legend-item"><div class="slot-legend-dot locked"></div>Processing</div>`;
        c.parentNode.insertBefore(leg, c);
      }
    }

    document.querySelectorAll('#slots-container,.slots-container,[id*="slot"]').forEach(el => {
      if (el.querySelector('.time-slot')) upgradeContainer(el);
    });

    new MutationObserver(muts => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.classList && n.classList.contains('time-slot')) upgrade(n);
        const inner = n.querySelectorAll && n.querySelectorAll('.time-slot');
        if (inner && inner.length) {
          inner.forEach(upgrade);
          const c = n.classList.contains('slots-container') ? n : n.querySelector('#slots-container,.slots-container');
          if (c) upgradeContainer(c);
        }
      }
    }).observe(document.body, { childList:true, subtree:true });
  }

  /* ─────────────────────────────────────────────────────────────────
   *  [F4]  Instant slot release on payment cancel / page return
   * ─────────────────────────────────────────────────────────────────*/
  function patchInstantSlotRelease() {
    window.addEventListener('bmg:paymentCancelled', handleRelease);
    window.addEventListener('bmg:payCancelled',    handleRelease);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) checkStale(); });
    window.addEventListener('pageshow', e => { if (e.persisted) checkStale(); });
    window.addEventListener('focus', checkStale);

    async function checkStale() {
      const lock = _readSlotLock();
      if (!lock) return;
      const overlay = document.querySelector('#payment-processing-overlay, .payment-processing-overlay');
      if (overlay && overlay.offsetParent !== null) return;
      const cancelledId = sessionStorage.getItem('bmg_payCancelled');
      if (cancelledId === lock.orderId) { await doRelease(lock, true); return; }
      if (Date.now() - (lock.lockedAt||0) > 10*60*1000) await doRelease(lock, false);
    }

    async function handleRelease() {
      const lock = _readSlotLock();
      if (lock) await doRelease(lock, true);
    }

    async function doRelease(lock, toast) {
      try {
        if (typeof window.releaseSlotLock === 'function') await window.releaseSlotLock(lock.orderId);
        sessionStorage.removeItem('slotLock');
        sessionStorage.removeItem('bmg_payCancelled');
        sessionStorage.removeItem('currentBookingDetails');
        if (toast) {
          const t = document.createElement('div');
          t.className = 'slot-released-toast';
          t.innerHTML = '<i class="fas fa-lock-open"></i> Slot released — you can rebook now';
          document.body.appendChild(t);
          setTimeout(() => t.remove(), 4000);
        }
      } catch (e) { console.warn('[paymentService] slot release error:', e); }
    }

    function _readSlotLock() {
      try { const r = sessionStorage.getItem('slotLock'); return r ? JSON.parse(r) : null; } catch { return null; }
    }
  }

  /* ─────────────────────────────────────────────────────────────────
   *  [F2]  Premium Image Viewer (replaces broken openImageViewer)
   * ─────────────────────────────────────────────────────────────────*/
  function patchImageViewer() {
    buildViewerDOM();
    window.openImageViewer = function (images, start) {
      if (!images || !images.length) return;
      IVS.images = Array.isArray(images) ? images : [images];
      IVS.index  = Math.max(0, Math.min(start||0, IVS.images.length-1));
      IVS.zoom = 1; IVS.tx = 0; IVS.ty = 0;
      openIV();
    };
    window.closeImageViewer = closeIV;
    const oldClose = document.getElementById('image-viewer-close');
    if (oldClose) oldClose.addEventListener('click', closeIV);
  }

  const IVS = { images:[], index:0, zoom:1, tx:0, ty:0, dragging:false, pinching:false, startX:0, startY:0, startTx:0, startTy:0, pinchDist:0, startZoom:1 };

  function buildViewerDOM() {
    if (document.getElementById('bmg-image-viewer')) return;
    const d = document.createElement('div'); d.id = 'bmg-image-viewer';
    d.innerHTML = `
      <div class="iv-header">
        <div class="iv-counter"><span id="bmg-iv-cur">1</span> / <span id="bmg-iv-tot">1</span></div>
        <button class="iv-close-btn" id="bmg-iv-close"><i class="fas fa-times"></i></button>
      </div>
      <div class="iv-stage" id="bmg-iv-stage"><img id="bmg-iv-img" src="" alt="Image"/></div>
      <div class="iv-footer">
        <button class="iv-nav-btn" id="bmg-iv-prev"><i class="fas fa-chevron-left"></i></button>
        <div class="iv-thumbs" id="bmg-iv-thumbs"></div>
        <div class="iv-zoom-group">
          <button class="iv-zoom-btn" id="bmg-iv-zout"><i class="fas fa-search-minus"></i></button>
          <button class="iv-zoom-btn" id="bmg-iv-zreset"><i class="fas fa-compress-arrows-alt"></i></button>
          <button class="iv-zoom-btn" id="bmg-iv-zin"><i class="fas fa-search-plus"></i></button>
        </div>
        <button class="iv-nav-btn" id="bmg-iv-next"><i class="fas fa-chevron-right"></i></button>
      </div>`;
    document.body.appendChild(d);
    d.querySelector('#bmg-iv-close').addEventListener('click', closeIV);
    d.querySelector('#bmg-iv-prev').addEventListener('click', () => ivNav(-1));
    d.querySelector('#bmg-iv-next').addEventListener('click', () => ivNav(1));
    d.querySelector('#bmg-iv-zin').addEventListener('click', () => ivZoom(0.3));
    d.querySelector('#bmg-iv-zout').addEventListener('click', () => ivZoom(-0.3));
    d.querySelector('#bmg-iv-zreset').addEventListener('click', () => ivReset());
    d.addEventListener('click', e => { if (e.target === d) closeIV(); });
    window.addEventListener('keydown', e => {
      if (!d.classList.contains('open')) return;
      if (e.key==='Escape') closeIV();
      if (e.key==='ArrowLeft')  ivNav(-1);
      if (e.key==='ArrowRight') ivNav(1);
      if (e.key==='+') ivZoom(0.25); if (e.key==='-') ivZoom(-0.25);
    });
    const stage = d.querySelector('#bmg-iv-stage');
    stage.addEventListener('mousedown', e => {
      if (IVS.zoom<=1) return; IVS.dragging=true; IVS.startX=e.clientX; IVS.startY=e.clientY;
      IVS.startTx=IVS.tx; IVS.startTy=IVS.ty; stage.classList.add('grabbing'); e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (!IVS.dragging) return; IVS.tx=IVS.startTx+(e.clientX-IVS.startX); IVS.ty=IVS.startTy+(e.clientY-IVS.startY); ivApply();
    });
    window.addEventListener('mouseup', () => { IVS.dragging=false; stage.classList.remove('grabbing'); });
    stage.addEventListener('dblclick', () => { IVS.zoom>1 ? ivReset() : (IVS.zoom=2,ivApply(),stage.classList.add('zoomed')); });
    let tx0=0,ty0=0,lastTap=0;
    stage.addEventListener('touchstart', e => {
      if (e.touches.length===1) {
        tx0=e.touches[0].clientX; ty0=e.touches[0].clientY; IVS.startTx=IVS.tx; IVS.startTy=IVS.ty;
        const now=Date.now(); if(now-lastTap<300){IVS.zoom>1?ivReset():(IVS.zoom=2,ivApply(),stage.classList.add('zoomed'));} lastTap=now;
      } else if(e.touches.length===2){IVS.pinching=true;IVS.pinchDist=pinchD(e.touches);IVS.startZoom=IVS.zoom;e.preventDefault();}
    },{passive:false});
    stage.addEventListener('touchmove', e => {
      if(e.touches.length===2&&IVS.pinching){IVS.zoom=Math.max(1,Math.min(4,IVS.startZoom*(pinchD(e.touches)/IVS.pinchDist)));stage.classList.toggle('zoomed',IVS.zoom>1);ivApply();e.preventDefault();}
      else if(e.touches.length===1&&IVS.zoom>1){IVS.tx=IVS.startTx+(e.touches[0].clientX-tx0);IVS.ty=IVS.startTy+(e.touches[0].clientY-ty0);ivApply();e.preventDefault();}
    },{passive:false});
    stage.addEventListener('touchend', e => {
      if(e.touches.length<2)IVS.pinching=false;
      if(IVS.zoom<=1&&e.touches.length===0){const dx=e.changedTouches[0].clientX-tx0,dy=e.changedTouches[0].clientY-ty0;if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)*1.5)ivNav(dx<0?1:-1);}
    });
  }

  function pinchD(t){const dx=t[0].clientX-t[1].clientX,dy=t[0].clientY-t[1].clientY;return Math.sqrt(dx*dx+dy*dy);}
  function ivApply(){const img=document.getElementById('bmg-iv-img');if(!img)return;img.style.transform=`scale(${IVS.zoom}) translate(${IVS.tx/IVS.zoom}px,${IVS.ty/IVS.zoom}px)`;const s=document.getElementById('bmg-iv-stage');if(s)s.classList.toggle('zoomed',IVS.zoom>1);}
  function ivNav(d){const ni=IVS.index+d;if(ni<0||ni>=IVS.images.length)return;IVS.index=ni;ivReset(false);ivRender();}
  function ivZoom(delta){IVS.zoom=Math.max(1,Math.min(4,IVS.zoom+delta));if(IVS.zoom===1){IVS.tx=0;IVS.ty=0;}ivApply();const s=document.getElementById('bmg-iv-stage');if(s)s.classList.toggle('zoomed',IVS.zoom>1);}
  function ivReset(render=true){IVS.zoom=1;IVS.tx=0;IVS.ty=0;ivApply();const s=document.getElementById('bmg-iv-stage');if(s)s.classList.remove('zoomed','grabbing');if(render)ivRender();}
  function ivRender(){
    const img=document.getElementById('bmg-iv-img'),cur=document.getElementById('bmg-iv-cur'),tot=document.getElementById('bmg-iv-tot'),prev=document.getElementById('bmg-iv-prev'),next=document.getElementById('bmg-iv-next');
    if(!img)return;img.classList.add('loading');img.onload=()=>img.classList.remove('loading');img.src=IVS.images[IVS.index]||'';
    if(cur)cur.textContent=IVS.index+1;if(tot)tot.textContent=IVS.images.length;if(prev)prev.disabled=IVS.index===0;if(next)next.disabled=IVS.index===IVS.images.length-1;
    const th=document.getElementById('bmg-iv-thumbs');if(!th)return;
    if(IVS.images.length<=1){th.innerHTML='';return;}
    th.innerHTML=IVS.images.map((s,i)=>`<img class="iv-thumb ${i===IVS.index?'active':''}" src="${s}" data-idx="${i}"/>`).join('');
    th.querySelectorAll('.iv-thumb').forEach(t=>t.addEventListener('click',()=>{IVS.index=+t.dataset.idx;ivReset();}));
    const ac=th.querySelector('.iv-thumb.active');if(ac)ac.scrollIntoView({inline:'nearest',behavior:'smooth'});
  }
  function openIV(){buildViewerDOM();const el=document.getElementById('bmg-image-viewer');if(!el)return;ivRender();requestAnimationFrame(()=>el.classList.add('open'));document.body.style.overflow='hidden';}
  function closeIV(){const el=document.getElementById('bmg-image-viewer');if(el)el.classList.remove('open');document.body.style.overflow='';ivReset(false);}

  /* ─────────────────────────────────────────────────────────────────
   *  [F5]  WhatsApp-style Profile Picture Upload
   * ─────────────────────────────────────────────────────────────────*/
  function patchProfilePicture() {
    buildProfileSheet();
    window.changeProfilePhoto = () => showProfSheet();
    document.addEventListener('click', e => {
      const btn = e.target.closest('#change-photo-btn,.change-photo-btn,[onclick*="changeProfilePhoto"]');
      if (btn) { e.preventDefault(); e.stopImmediatePropagation(); showProfSheet(); }
    });
  }

  function buildProfileSheet() {
    if (document.getElementById('bmg-profile-sheet')) return;
    const el = document.createElement('div'); el.id = 'bmg-profile-sheet';
    el.innerHTML = `
      <div class="profile-sheet-inner">
        <div class="profile-sheet-handle"></div>
        <div class="profile-sheet-title">Profile Photo</div>
        <img class="profile-avatar-preview" id="bmg-profile-preview" src="" alt="Profile"/>
        <div class="profile-sheet-actions">
          <button class="profile-sheet-action-btn" id="bmg-prof-camera"><i class="fas fa-camera"></i><span>Camera</span></button>
          <button class="profile-sheet-action-btn" id="bmg-prof-gallery"><i class="fas fa-images"></i><span>Gallery</span></button>
        </div>
        <button class="profile-sheet-remove" id="bmg-prof-remove"><i class="fas fa-trash-alt"></i> Remove Photo</button>
        <button class="profile-sheet-cancel" id="bmg-prof-cancel">Cancel</button>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', e => { if(e.target===el) hideProfSheet(); });
    el.querySelector('#bmg-prof-cancel').addEventListener('click', hideProfSheet);
    el.querySelector('#bmg-prof-camera').addEventListener('click', () => { hideProfSheet(); openFilePick({capture:'environment'}); });
    el.querySelector('#bmg-prof-gallery').addEventListener('click', () => { hideProfSheet(); openFilePick({}); });
    el.querySelector('#bmg-prof-remove').addEventListener('click', async () => {
      hideProfSheet();
      if (typeof window.updateProfileImageInFirestore === 'function') {
        try { await window.updateProfileImageInFirestore(''); _bmgToast('Profile photo removed','success'); }
        catch (e) { _bmgToast('Could not remove photo','error'); }
      }
    });
  }

  function showProfSheet() {
    const el = document.getElementById('bmg-profile-sheet'); if(!el) return;
    const prev = document.getElementById('bmg-profile-preview');
    const cur  = document.getElementById('profile-image-large');
    if (prev && cur && cur.src && !cur.src.includes('undefined')) prev.src = cur.src;
    el.classList.add('open'); document.body.style.overflow='hidden';
  }
  function hideProfSheet() {
    const el = document.getElementById('bmg-profile-sheet'); if(el) el.classList.remove('open'); document.body.style.overflow='';
  }
  function openFilePick(opts) {
    const input = document.createElement('input'); input.type='file'; input.accept='image/jpeg,image/png,image/webp';
    if (opts.capture) input.capture = opts.capture;
    input.onchange = async e => {
      const file = e.target.files[0]; if(!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        document.querySelectorAll('#profile-image-large,#header-profile-img,.profile-btn img').forEach(i => { i.src=ev.target.result; i.style.display=''; });
      };
      reader.readAsDataURL(file);
      _bmgShowLoading('Uploading photo…');
      try {
        if (typeof window.uploadProfileImage==='function' && typeof window.updateProfileImageInFirestore==='function') {
          const url = await window.uploadProfileImage(file);
          await window.updateProfileImageInFirestore(url);
        }
        _bmgHideLoading(); _bmgToast('Profile photo updated! 🎉','success');
      } catch (err) { _bmgHideLoading(); _bmgToast(err.message||'Upload failed','error'); }
    };
    input.click();
  }

  /* ─────────────────────────────────────────────────────────────────
   *  [F6]  QR Scanner — professional open/close animation
   * ─────────────────────────────────────────────────────────────────*/
  function patchQRScannerUI() {
    const origShow = window.showProfessionalQRScanner;
    if (typeof origShow === 'function') {
      window.showProfessionalQRScanner = async function () {
        const modal = document.getElementById('professional-qr-modal');
        if (modal) {
          modal.style.cssText = 'display:flex!important;position:fixed;inset:0;z-index:9999;align-items:center!important;justify-content:center!important;background:rgba(0,0,0,.85);backdrop-filter:blur(12px);padding:20px;';
          const container = modal.querySelector('.qr-scanner-container');
          if (container) {
            container.style.transform='scale(.88) translateY(30px)'; container.style.opacity='0';
            container.style.transition='all .35s cubic-bezier(.34,1.56,.64,1)';
            requestAnimationFrame(()=>requestAnimationFrame(()=>{ container.style.transform='scale(1) translateY(0)'; container.style.opacity='1'; }));
          }
        }
        return origShow.apply(this, arguments);
      };
    }
    ['close-professional-qr','close-scanner-btn'].forEach(id => {
      const btn = document.getElementById(id); if(!btn) return;
      btn.addEventListener('click', () => {
        const modal = document.getElementById('professional-qr-modal');
        const container = modal && modal.querySelector('.qr-scanner-container');
        if (container) {
          container.style.transform='scale(.88) translateY(30px)'; container.style.opacity='0';
          setTimeout(()=>{ if(modal) modal.style.display='none'; container.style.transform=''; container.style.opacity=''; },300);
        } else if (modal) modal.style.display='none';
      });
    });
  }

  /* ─────────────────────────────────────────────────────────────────
   *  [F7]  Remove obsolete "Verify ₹499 Payment" tab
   * ─────────────────────────────────────────────────────────────────*/
  function patchOwnerDashboardTabs() {
    function removeTab() {
      document.querySelectorAll('.owner-nav-item,[data-tab],.dashboard-tab').forEach(el => {
        const text = el.textContent||''; const oc = el.getAttribute('onclick')||''; const dt = el.getAttribute('data-tab')||'';
        if (dt.includes('payment-verify')||oc.includes('payment-verify')||oc.includes('loadOwnerPaymentVerify')||(text.includes('Verify')&&text.includes('Payment'))) {
          el.style.display='none';
        }
      });
    }
    removeTab();
    new MutationObserver(removeTab).observe(document.body, {childList:true, subtree:false});
  }

  /* ─────────────────────────────────────────────────────────────────
   *  INJECT ALL STYLES
   * ─────────────────────────────────────────────────────────────────*/
  function injectStyles() {
    if (document.getElementById('bmg-ps-styles')) return;
    const s = document.createElement('style'); s.id = 'bmg-ps-styles';
    s.textContent = `
/* SLOT GRID */
.slots-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:4px 0;}
.time-slot{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:10px 6px;border-radius:12px;border:2px solid #e5e7eb;background:#fff;font-size:12px;font-weight:600;cursor:pointer;transition:all .2s cubic-bezier(.4,0,.2,1);overflow:hidden;min-height:62px;user-select:none;}
.time-slot .slot-time-text{font-size:11.5px;font-weight:700;letter-spacing:-.2px;line-height:1.2;text-align:center;}
.time-slot .slot-status-tag{font-size:9.5px;font-weight:700;letter-spacing:.3px;text-transform:uppercase;padding:2px 7px;border-radius:20px;}
.time-slot .slot-icon{font-size:13px;margin-bottom:1px;}
.time-slot.available{border-color:#22c55e;background:linear-gradient(135deg,#f0fdf4,#dcfce7);color:#166534;box-shadow:0 2px 8px rgba(34,197,94,.12);}
.time-slot.available .slot-status-tag{background:rgba(34,197,94,.15);color:#15803d;}
.time-slot.available:hover{transform:translateY(-3px) scale(1.03);box-shadow:0 6px 20px rgba(34,197,94,.25);border-color:#16a34a;}
.time-slot.available.selected,.time-slot.selected{background:linear-gradient(135deg,#1b2e6c,#2563eb);border-color:#1b2e6c;color:#fff;transform:scale(1.04);box-shadow:0 6px 20px rgba(27,46,108,.35);}
.time-slot.confirmed,.time-slot.booked{border-color:#ef4444;background:linear-gradient(135deg,#fef2f2,#fee2e2);color:#991b1b;cursor:not-allowed;}
.time-slot.confirmed .slot-status-tag,.time-slot.booked .slot-status-tag{background:rgba(239,68,68,.15);color:#dc2626;}
.time-slot.past{border-color:#d1d5db;background:linear-gradient(135deg,#f9fafb,#f3f4f6);color:#9ca3af;cursor:not-allowed;opacity:.75;}
.time-slot.past .slot-time-text{text-decoration:line-through;text-decoration-color:#d1d5db;}
.time-slot.past .slot-status-tag{background:rgba(156,163,175,.15);color:#9ca3af;}
.time-slot.locked{border-color:#f59e0b;background:linear-gradient(135deg,#fffbeb,#fef3c7);color:#92400e;cursor:not-allowed;}
.time-slot.locked .slot-status-tag{background:rgba(245,158,11,.15);color:#d97706;}
.slot-legend{display:flex;gap:14px;flex-wrap:wrap;padding:10px 0 14px;font-size:11px;font-weight:600;color:#6b7280;}
.slot-legend-item{display:flex;align-items:center;gap:5px;}
.slot-legend-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;}
.slot-legend-dot.available{background:#22c55e;}.slot-legend-dot.booked{background:#ef4444;}.slot-legend-dot.past{background:#d1d5db;}.slot-legend-dot.locked{background:#f59e0b;}
/* IMAGE VIEWER */
#bmg-image-viewer{display:none;position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0);transition:background .3s ease;flex-direction:column;}
#bmg-image-viewer.open{display:flex;background:rgba(0,0,0,.96);}
#bmg-image-viewer .iv-header{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;justify-content:space-between;padding:16px 20px;background:linear-gradient(to bottom,rgba(0,0,0,.7),transparent);z-index:2;pointer-events:none;}
#bmg-image-viewer .iv-header button{pointer-events:all;}
.iv-counter{color:rgba(255,255,255,.9);font-size:13px;font-weight:700;background:rgba(255,255,255,.1);backdrop-filter:blur(8px);padding:4px 12px;border-radius:20px;border:1px solid rgba(255,255,255,.15);}
.iv-close-btn{width:38px;height:38px;border-radius:50%;border:none;background:rgba(255,255,255,.15);backdrop-filter:blur(8px);color:#fff;font-size:16px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background .2s;}
.iv-close-btn:hover{background:rgba(255,255,255,.25);}
#bmg-image-viewer .iv-stage{flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:zoom-in;touch-action:none;}
#bmg-image-viewer .iv-stage.zoomed{cursor:grab;}#bmg-image-viewer .iv-stage.grabbing{cursor:grabbing;}
#bmg-iv-img{max-width:100%;max-height:100%;object-fit:contain;transform-origin:center center;transition:transform .25s cubic-bezier(.4,0,.2,1),opacity .2s;user-select:none;-webkit-user-drag:none;pointer-events:none;border-radius:4px;}
#bmg-iv-img.loading{opacity:.4;}
#bmg-image-viewer .iv-footer{position:absolute;bottom:0;left:0;right:0;display:flex;align-items:center;justify-content:space-between;padding:16px 20px calc(env(safe-area-inset-bottom,0px) + 16px);background:linear-gradient(to top,rgba(0,0,0,.7),transparent);z-index:2;gap:12px;}
.iv-nav-btn{width:44px;height:44px;border-radius:50%;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.15);backdrop-filter:blur(8px);color:#fff;font-size:18px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background .2s,transform .15s;}
.iv-nav-btn:hover{background:rgba(255,255,255,.25);transform:scale(1.08);}
.iv-nav-btn:disabled{opacity:.25;pointer-events:none;}
.iv-zoom-group{display:flex;gap:8px;}
.iv-zoom-btn{width:38px;height:38px;border-radius:10px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.12);backdrop-filter:blur(8px);color:#fff;font-size:14px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background .2s;}
.iv-zoom-btn:hover{background:rgba(255,255,255,.22);}
.iv-thumbs{display:flex;gap:6px;justify-content:center;align-items:center;flex:1;overflow-x:auto;padding:0 4px;scrollbar-width:none;}
.iv-thumbs::-webkit-scrollbar{display:none;}
.iv-thumb{width:36px;height:36px;border-radius:6px;object-fit:cover;border:2px solid transparent;opacity:.55;cursor:pointer;transition:all .2s;flex-shrink:0;}
.iv-thumb.active{opacity:1;border-color:#fff;transform:scale(1.1);}
/* PROFILE SHEET */
#bmg-profile-sheet{display:none;position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.5);align-items:flex-end;justify-content:center;}
#bmg-profile-sheet.open{display:flex;}
.profile-sheet-inner{width:100%;max-width:480px;background:#fff;border-radius:24px 24px 0 0;padding:24px 20px calc(env(safe-area-inset-bottom,0px) + 24px);animation:slideUpSheet .3s cubic-bezier(.4,0,.2,1);}
@keyframes slideUpSheet{from{transform:translateY(100%)}to{transform:translateY(0)}}
.profile-sheet-handle{width:40px;height:4px;background:#e5e7eb;border-radius:2px;margin:0 auto 20px;}
.profile-sheet-title{font-size:16px;font-weight:700;color:#111827;text-align:center;margin-bottom:20px;}
.profile-avatar-preview{width:100px;height:100px;border-radius:50%;object-fit:cover;border:3px solid #e5e7eb;display:block;margin:0 auto 20px;background:#f3f4f6;}
.profile-sheet-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;}
.profile-sheet-action-btn{display:flex;flex-direction:column;align-items:center;gap:8px;padding:16px 12px;border:2px solid #e5e7eb;border-radius:14px;background:#f9fafb;cursor:pointer;transition:all .2s;font-size:12px;font-weight:600;color:#374151;}
.profile-sheet-action-btn:hover{border-color:#1b2e6c;background:#eff6ff;color:#1b2e6c;}
.profile-sheet-action-btn i{font-size:22px;color:#1b2e6c;}
.profile-sheet-remove{width:100%;padding:13px;border:none;border-radius:12px;background:#fee2e2;color:#dc2626;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;}
.profile-sheet-cancel{width:100%;padding:13px;border:2px solid #e5e7eb;border-radius:12px;background:transparent;color:#6b7280;font-size:13px;font-weight:600;cursor:pointer;margin-top:8px;}
/* QR SCANNER */
#professional-qr-modal{background:rgba(0,0,0,.85)!important;backdrop-filter:blur(12px);}
.qr-scanner-container{background:linear-gradient(160deg,#0f172a,#1e1b4b)!important;border-radius:24px!important;overflow:hidden;max-height:90vh;max-width:440px!important;width:calc(100% - 0px)!important;border:1px solid rgba(255,255,255,.08)!important;box-shadow:0 32px 80px rgba(0,0,0,.6)!important;}
.qr-scanner-header{background:linear-gradient(135deg,rgba(27,46,108,.9),rgba(37,99,235,.7))!important;padding:20px!important;border-bottom:1px solid rgba(255,255,255,.08)!important;}
.qr-scanner-header h3{color:#fff!important;font-size:17px!important;font-weight:700!important;}
.qr-scanner-header p{color:rgba(255,255,255,.6)!important;font-size:12px!important;}
.scan-corner{border-color:#2563eb!important;width:28px!important;height:28px!important;border-width:3px!important;border-radius:4px!important;}
.scan-line{background:linear-gradient(to bottom,transparent,#2563eb,transparent)!important;height:3px!important;border-radius:2px!important;}
/* SLOT TOAST */
.slot-released-toast{position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:linear-gradient(135deg,#1b2e6c,#2563eb);color:#fff;padding:12px 20px;border-radius:14px;font-size:13px;font-weight:600;z-index:99997;display:flex;align-items:center;gap:8px;box-shadow:0 8px 24px rgba(27,46,108,.3);animation:toastIn .3s ease;max-width:320px;text-align:center;}
@keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
/* HIDE OLD VERIFY TAB */
[data-tab="payment-verify"],.owner-nav-item[onclick*="payment-verify"],.owner-nav-item[onclick*="loadOwnerPaymentVerify"]{display:none!important;}
`;
    document.head.appendChild(s);
  }

  /* ─────────────────────────────────────────────────────────────────
   *  HELPER: HTML escape
   * ─────────────────────────────────────────────────────────────────*/
  function _esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  window._esc = _esc;

  /* ─────────────────────────────────────────────────────────────────
   *  [N7]  Page-load payment recovery
   *  Checks Firestore for any recently-confirmed tournament or
   *  owner_onboarding payment for the current user and fires the
   *  bmg:paymentConfirmed event so the UI shows the success screen.
   *  This handles the case where Cashfree redirects the browser and
   *  session-storage / in-memory state is lost.
   * ─────────────────────────────────────────────────────────────────*/
  async function _recoverPendingPaymentsOnLoad() {
    // Wait for auth to settle (currentUser set by app.js)
    let waited = 0;
    while (!window.currentUser && waited < 5000) {
      await new Promise(r => setTimeout(r, 300));
      waited += 300;
    }
    const cu = window.currentUser;
    if (!cu || !window.db) return;
    const db = window.db;

    try {
      // ── Check sessionStorage for a pending orderId ──────────────────
      let orderId    = sessionStorage.getItem('bmg_recoverOrderId');
      let payType    = sessionStorage.getItem('bmg_recoverPayType');

      // If not in sessionStorage, scan pending_payments for this user
      if (!orderId) {
        const snap = await db.collection('pending_payments')
          .where('userId', '==', cu.uid)
          .orderBy('createdAt', 'desc')
          .limit(5)
          .get().catch(() => null);
        if (snap && !snap.empty) {
          const recent = snap.docs[0];
          const age = Date.now() - (recent.data().createdAt?.toMillis?.() || 0);
          // Only recover if less than 30 minutes old
          if (age < 30 * 60 * 1000) {
            orderId = recent.id;
            payType = recent.data().paymentType;
          }
        }
      }

      if (!orderId) return;

      // ── Check if already confirmed ──────────────────────────────────
      const result = await _checkFinalStatus(orderId, payType);
      if (result.success) {
        console.log('[paymentService] [N7] Recovered confirmed payment on load:', payType, orderId);
        sessionStorage.removeItem('bmg_recoverOrderId');
        sessionStorage.removeItem('bmg_recoverPayType');
        _handlePaymentSuccess(orderId, payType, result.data);
        return;
      }

      // Not yet confirmed — start polling silently
      if (!result.failed) {
        await recoverPaymentSession(orderId, payType, {});
      }
    } catch (e) {
      console.warn('[paymentService] [N7] Recovery error:', e);
    }
  }

  /* ─────────────────────────────────────────────────────────────────
   *  BOOT — Apply all patches in correct order
   * ─────────────────────────────────────────────────────────────────*/

  // Immediate patches (no DOM needed)
  patchOwnerRegistrationPayment();  // [N1]
  patchOwnerEarnings();             // [N5]
  patchCEOPayouts();                // [N6]
  patchQRVerification();            // [N3]

  onReady(function () {
    injectStyles();                 // CSS
    patchImageViewer();             // [F2]
    patchSlotRenderer();            // [F3]
    patchInstantSlotRelease();      // [F4]
    patchProfilePicture();          // [F5]
    patchQRScannerUI();             // [F6]
    patchOwnerDashboardTabs();      // [F7]
    patchModalStepVariables();      // [F8 + N2 + N4] — MUST BE LAST (wraps original fns)

    // [N7] Page-load payment recovery — catches post-redirect scenarios
    _recoverPendingPaymentsOnLoad();

    console.log('✅ paymentService.js v3 — all features + fixes loaded');
  });

})(); // end IIFE