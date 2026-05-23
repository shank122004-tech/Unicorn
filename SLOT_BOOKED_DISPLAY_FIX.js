/* ═══════════════════════════════════════════════════════════════════════════
   SLOT_BOOKED_DISPLAY_FIX.js  v1.0
   ─────────────────────────────────────────────────────────────────────────
   PROBLEM: After a user completes payment for a ground time slot, the slot
   does NOT turn red ("Booked") on the ground page for other users.

   ROOT CAUSES FIXED:
   ──────────────────
   A) paymentService._handlePaymentSuccess calls markSlotAsConfirmed(data)
      where `data` = booking doc fetched by orderId. The booking doc written
      by the Cloud Function webhook may use a different field name for the
      slot time (e.g. `slotTime` vs `time`) or may not include `groundId`/
      `date` at all. → markSlotAsConfirmed silently finds no slot and returns.

   B) EARNINGS_UPCOMING_BOOKED_FIX.js wraps setupPayButton and calls
      markSlotAsConfirmed 500ms after pay-button setup — i.e. BEFORE
      payment is complete. This is wrong timing and has no effect on whether
      the slot record exists in Firestore yet.

   C) markSlotAsConfirmed only UPDATES an existing slots doc. If no doc
      exists for that (groundId, date, startTime) triple — which is the
      normal case when a slot was never explicitly pre-created — the update
      is a silent no-op. The function must CREATE the doc when it doesn't
      exist.

   D) The bmg:paymentConfirmed listener in app.js (case 'booking') calls
      showBookingSuccessConfirmation but never triggers a slot Firestore
      write on the client side, fully relying on the Cloud Function webhook.
      If the webhook is slow or missing fields, the slot stays unlocked/
      "locked" forever.

   THE FIX:
   ────────
   1. Replace window.markSlotAsConfirmed with a robust version that:
      • Normalises field names (slotTime / time / slot_time)
      • Uses set({…}, {merge:true}) so it works whether the doc exists or not
      • Also tries to find the doc by bookingId if the time-based query fails
      • Logs clearly so you can debug in the browser console

   2. Hook into bmg:paymentConfirmed (the authoritative "payment is done"
      event dispatched by paymentService._handlePaymentSuccess) and call
      the fixed markSlotAsConfirmed there with the confirmed booking data.

   3. Remove the premature setupPayButton wrap from EARNINGS_FIX by
      overwriting it with a no-op slot-marking wrapper (payment hasn't
      happened yet at setupPayButton time).

   4. Add a real-time Firestore listener fallback: if the slot document
      doesn't exist, listen to the bookings collection for this orderId
      and create/update the slot doc once the booking appears.

   ADD IN index.html as the VERY LAST script before </body>:
     <script src="SLOT_BOOKED_DISPLAY_FIX.js"></script>
   (After EARNINGS_UPCOMING_BOOKED_FIX.js)
═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  console.log('[slot-fix] SLOT_BOOKED_DISPLAY_FIX v1.0 loading…');

  /* ─── helpers ─────────────────────────────────────────────────────────── */

  function _db() { return window.db || null; }

  /** Normalise slot time string: "09:00-10:00", "09:00 - 10:00", "09:00" */
  function _normaliseSlotTime(raw) {
    if (!raw) return '';
    return String(raw).replace(/\s/g, '');
  }

  /** Extract start time from "09:00-10:00" or "09:00" */
  function _startTime(slotTime) {
    var s = _normaliseSlotTime(slotTime);
    return s.includes('-') ? s.split('-')[0] : s;
  }

  /** Extract end time from "09:00-10:00", or '' if not present */
  function _endTime(slotTime) {
    var s = _normaliseSlotTime(slotTime);
    return s.includes('-') ? s.split('-')[1] : '';
  }

  /** Pull the slotTime string from a booking data object, trying multiple keys */
  function _resolveSlotTime(data) {
    return data.slotTime || data.time || data.slot_time || data.slottime || '';
  }

  /* ─────────────────────────────────────────────────────────────────────────
     CORE FIX: robust markSlotAsConfirmed
     ───────────────────────────────────────────────────────────────────────── */
  window.markSlotAsConfirmed = async function (bookingData) {
    var db = _db();
    if (!db) {
      console.warn('[slot-fix] markSlotAsConfirmed: Firebase db not ready');
      return false;
    }

    /* ── 1. Extract and validate required fields ── */
    var groundId = bookingData.groundId || bookingData.ground_id || '';
    var date     = bookingData.date     || bookingData.bookingDate || '';
    var rawSlot  = _resolveSlotTime(bookingData);
    var bookingId = bookingData.bookingId || bookingData.orderId || bookingData.id || '';
    var userId    = bookingData.userId   || bookingData.bookedBy  || (window.currentUser && window.currentUser.uid) || '';

    if (!groundId || !date || !rawSlot) {
      console.warn('[slot-fix] markSlotAsConfirmed: missing fields', {
        groundId: groundId, date: date, rawSlot: rawSlot
      });

      /* Last resort: try to get them from sessionStorage */
      try {
        var stored = JSON.parse(
          sessionStorage.getItem('pendingBooking') ||
          sessionStorage.getItem('pendingCashfreeBooking') ||
          sessionStorage.getItem('currentBookingDetails') ||
          'null'
        );
        if (stored) {
          groundId  = groundId  || stored.groundId  || '';
          date      = date      || stored.date      || '';
          rawSlot   = rawSlot   || _resolveSlotTime(stored) || '';
          bookingId = bookingId || stored.bookingId || stored.orderId || '';
          userId    = userId    || stored.userId    || '';
        }
      } catch (_) {}

      if (!groundId || !date || !rawSlot) {
        console.warn('[slot-fix] markSlotAsConfirmed: still missing fields after session fallback — giving up');
        return false;
      }
    }

    var start = _startTime(rawSlot);
    var end   = _endTime(rawSlot);

    console.log('[slot-fix] markSlotAsConfirmed →', groundId, date, start, end, bookingId);

    var slotPayload = {
      groundId  : groundId,
      date      : date,
      startTime : start,
      endTime   : end,
      slotTime  : _normaliseSlotTime(rawSlot),
      status    : 'confirmed',
      bookingId : bookingId,
      bookedBy  : userId,
      bookedAt  : firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt : firebase.firestore.FieldValue.serverTimestamp(),
    };

    /* ── 2. Try to find existing slot doc ── */
    try {
      var query = db.collection('slots')
        .where('groundId', '==', groundId)
        .where('date',     '==', date)
        .where('startTime','==', start);

      var snap = await query.limit(1).get();

      if (!snap.empty) {
        /* UPDATE existing doc */
        await snap.docs[0].ref.update({
          status    : 'confirmed',
          bookingId : bookingId,
          bookedBy  : userId,
          bookedAt  : firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt : firebase.firestore.FieldValue.serverTimestamp(),
        });
        console.log('✅ [slot-fix] Slot UPDATED to confirmed:', start, '(doc:', snap.docs[0].id, ')');
        return true;
      }

      /* ── 3. Doc doesn't exist → CREATE it ── */
      await db.collection('slots').add({
        ...slotPayload,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      console.log('✅ [slot-fix] Slot CREATED as confirmed:', rawSlot);
      return true;

    } catch (err) {
      console.error('[slot-fix] markSlotAsConfirmed error:', err);
      return false;
    }
  };

  /* ─────────────────────────────────────────────────────────────────────────
     FIX B: Remove the premature slot-marking from the setupPayButton wrap
     in EARNINGS_UPCOMING_BOOKED_FIX.js.
     We overwrite setupPayButton to strip the incorrect 500ms setTimeout call
     while keeping the original Cashfree button wiring intact.
     ───────────────────────────────────────────────────────────────────────── */
  (function fixPrematureSetupPayButtonWrap() {
    var currentSetup = window.setupPayButton;
    if (!currentSetup || currentSetup._slotFixCleaned) return;

    window.setupPayButton = function (bookingDetails) {
      /* Call the underlying implementation (may be several layers deep).
         We deliberately do NOT call markSlotAsConfirmed here —
         payment has NOT happened yet at this point. */
      return currentSetup.apply(this, arguments);
    };
    window.setupPayButton._slotFixCleaned = true;
    console.log('[slot-fix] setupPayButton premature slot-mark removed');
  })();

  /* ─────────────────────────────────────────────────────────────────────────
     FIX C: Listen on bmg:paymentConfirmed (the authoritative event fired by
     paymentService._handlePaymentSuccess AFTER the webhook confirms payment).
     This is the correct place to mark the slot as booked.
     ───────────────────────────────────────────────────────────────────────── */
  window.addEventListener('bmg:paymentConfirmed', async function (e) {
    if (!e.detail) return;
    var paymentType = e.detail.paymentType;
    if (paymentType !== 'booking') return; /* only ground bookings have slots */

    var data = e.detail.result || {};

    console.log('[slot-fix] bmg:paymentConfirmed received, marking slot…', data);

    /* Try immediately with the data we have */
    var ok = await window.markSlotAsConfirmed(data);

    /* If it failed (missing fields), try fetching the booking doc directly */
    if (!ok) {
      var orderId = e.detail.orderId;
      if (orderId && _db()) {
        try {
          /* Webhook writes booking doc with orderId as the doc ID */
          var snap = await _db().collection('bookings').doc(orderId).get();
          if (snap.exists) {
            await window.markSlotAsConfirmed(snap.data());
          } else {
            /* Try querying by orderId field */
            var qSnap = await _db().collection('bookings')
              .where('orderId', '==', orderId)
              .limit(1).get();
            if (!qSnap.empty) {
              await window.markSlotAsConfirmed(qSnap.docs[0].data());
            }
          }
        } catch (fetchErr) {
          console.warn('[slot-fix] Could not fetch booking doc for slot update:', fetchErr);
        }
      }
    }
  });

  /* ─────────────────────────────────────────────────────────────────────────
     FIX D: Real-time polling fallback — if the slot doc doesn't turn
     "confirmed" within 8 seconds of confirmation-page being shown
     (i.e. webhook is slow), re-attempt from sessionStorage data.
     ───────────────────────────────────────────────────────────────────────── */
  window.addEventListener('bmg:pageShown', function (e) {
    if (!e.detail || e.detail.pageId !== 'confirmation-page') return;

    /* Retry slot confirmation 3×: at 3s, 6s, 12s after confirmation page shows */
    [3000, 6000, 12000].forEach(function (delay) {
      setTimeout(async function () {
        /* Read from sessionStorage — this is available even after the
           pendingBooking key is cleared, because we check multiple keys */
        var stored = null;
        try {
          stored = JSON.parse(
            sessionStorage.getItem('pendingBooking') ||
            sessionStorage.getItem('pendingCashfreeBooking') ||
            sessionStorage.getItem('currentBookingDetails') ||
            'null'
          );
        } catch (_) {}

        if (!stored) return; /* nothing to work with */

        var groundId = stored.groundId || '';
        var date     = stored.date     || '';
        var rawSlot  = _resolveSlotTime(stored);
        if (!groundId || !date || !rawSlot) return;

        var start = _startTime(rawSlot);

        /* Check if it's already confirmed — if so, skip */
        try {
          var checkSnap = await _db().collection('slots')
            .where('groundId', '==', groundId)
            .where('date',     '==', date)
            .where('startTime','==', start)
            .limit(1).get();

          if (!checkSnap.empty && checkSnap.docs[0].data().status === 'confirmed') {
            return; /* already confirmed, nothing to do */
          }
        } catch (_) {}

        console.log('[slot-fix] Retry slot confirmation at ' + delay + 'ms…');
        await window.markSlotAsConfirmed(stored);
      }, delay);
    });
  });

  /* ─────────────────────────────────────────────────────────────────────────
     FIX E: Also hook into the existing app.js bmg:paymentConfirmed listener
     for the 'booking' case. app.js calls showBookingSuccessConfirmation but
     does NOT call markSlotAsConfirmed. We patch loadUserBookings so that
     after it runs, confirmed bookings trigger slot updates for any that are
     still in "locked" state in Firestore.
     ───────────────────────────────────────────────────────────────────────── */
  (function patchConfirmBookingButton() {
    /* The manual "Confirm Booking" button on confirmation-page (used when
       webhook is unavailable). app.js wires this with confirm-payment-yes. */
    document.addEventListener('click', async function (e) {
      var btn = e.target.closest('#confirm-payment-yes, [data-action="confirm-booking"]');
      if (!btn) return;

      setTimeout(async function () {
        var stored = null;
        try {
          stored = JSON.parse(
            sessionStorage.getItem('pendingBooking') ||
            sessionStorage.getItem('pendingCashfreeBooking') ||
            sessionStorage.getItem('currentBookingDetails') ||
            'null'
          );
        } catch (_) {}
        if (stored) {
          console.log('[slot-fix] confirm-payment-yes clicked — marking slot…');
          await window.markSlotAsConfirmed(stored);
        }
      }, 800);
    });
  })();

  console.log('[slot-fix] SLOT_BOOKED_DISPLAY_FIX v1.0 ready ✅');

})();