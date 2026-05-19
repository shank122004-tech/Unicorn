/**
 * bmg_slot_realtime_fix.js
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  WHY SLOTS DON'T SHOW AS BOOKED INSTANTLY
 *  ─────────────────────────────────────────
 *  Your loadSlots() already uses Firestore onSnapshot (real-time).
 *  The real problem is a chain of smaller bugs:
 *
 *  BUG A — Slot documents are only created when someone locks them.
 *    createPendingBookingWithSlotLock() does:
 *      .where('status','==','available').limit(1).get()
 *    If no slot doc exists yet for this ground+date (e.g. first booking
 *    of the day), it finds nothing and silently skips the lock.
 *    The webhook then has existingSlotRef = null → never writes
 *    status:"booked" to the slots collection → onSnapshot never fires
 *    → every other user's screen stays "Available" forever.
 *
 *  BUG B — No fallback: bookings collection is confirmed but slots
 *    collection is never updated, so the real-time listener on slots
 *    sees zero changes.
 *
 *  BUG C — The onSnapshot listener has no reconnection / error-recovery.
 *    If the user's Firebase auth token silently expires mid-session, the
 *    listener dies with no retry, no toast, and no indication.
 *
 *  THE FIX (three parts)
 *  ─────────────────────
 *  FIX 1 — ensureSlotDocs()
 *    Pre-create all 24 slot documents (00:00–23:00) for a ground+date
 *    the first time the ground page is opened. This guarantees the slot
 *    doc always exists before any payment attempt, so the webhook can
 *    always find and update it. Uses a batch write so it is fast and
 *    atomic. Existing docs are never overwritten (merge:false is guarded
 *    by a status check).
 *
 *  FIX 2 — bookings → slots bridge (onSnapshot on bookings)
 *    A secondary real-time listener watches the bookings collection for
 *    the current ground+date. When a confirmed booking appears, it
 *    immediately writes status:"booked" to the matching slot doc — even
 *    if the webhook already did it (idempotent). This is the fallback
 *    that covers BUG A and BUG B.
 *
 *  FIX 3 — Listener health-check + auto-reconnect
 *    A periodic heartbeat detects if the slots onSnapshot has gone
 *    silent (no update for > 90 seconds while on the ground page) and
 *    automatically calls loadSlots() again to restart it.
 *
 *  LOAD ORDER — Add LAST in index.html, after all other scripts:
 *    <script src="bmg_slot_realtime_fix.js"></script>
 * ─────────────────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════
   *  Internal state
   * ═══════════════════════════════════════════════════════════*/
  let _bookingListenerUnsub = null;   // onSnapshot handle for bookings bridge
  let _lastSlotUpdate       = 0;      // epoch ms of last slot snapshot
  let _healthInterval       = null;   // setInterval handle for heartbeat
  let _currentGroundId      = null;   // ground being watched
  let _currentDate          = null;   // date being watched


  /* ═══════════════════════════════════════════════════════════
   *  Utility: wait for a global function to be defined
   * ═══════════════════════════════════════════════════════════*/
  function _waitFor(fnName, cb, tries) {
    tries = tries || 0;
    if (typeof window[fnName] === 'function') { cb(); return; }
    if (tries > 40) { console.warn('[slot-fix] timed out waiting for', fnName); return; }
    setTimeout(() => _waitFor(fnName, cb, tries + 1), 250);
  }


  /* ═══════════════════════════════════════════════════════════
   *  FIX 1 — Pre-create slot documents for a ground+date
   * ═══════════════════════════════════════════════════════════*/
  async function ensureSlotDocs(groundId, date) {
    const db = window.db;
    if (!db || !groundId || !date) return;

    try {
      // Check how many slot docs already exist for this ground+date
      const existingSnap = await db.collection('slots')
        .where('groundId', '==', groundId)
        .where('date',     '==', date)
        .get();

      // Build a map of already-existing slot keys
      const existing = {};
      existingSnap.forEach(doc => {
        const d = doc.data();
        const key = (d.startTime && d.endTime)
          ? `${d.startTime.trim()}-${d.endTime.trim()}`
          : (d.slotTime || '').replace(/\s/g, '');
        if (key) existing[key] = doc.id;
      });

      // Determine which hours are missing
      const missing = [];
      for (let h = 0; h < 24; h++) {
        const sh  = String(h).padStart(2, '0');
        const eh  = String(h + 1).padStart(2, '0');
        const key = `${sh}:00-${eh}:00`;
        if (!existing[key]) missing.push({ sh, eh, key });
      }

      if (missing.length === 0) {
        console.log(`[slot-fix] All slot docs exist for ${groundId}/${date}`);
        return;
      }

      // Batch-create the missing docs
      // Firestore batch limit = 500; 24 slots is well under that.
      const batch = db.batch();
      missing.forEach(({ sh, eh, key }) => {
        const ref = db.collection('slots').doc();
        batch.set(ref, {
          groundId  : groundId,
          date      : date,
          startTime : `${sh}:00`,
          endTime   : `${eh}:00`,
          slotTime  : key,
          status    : 'available',
          createdAt : firebase.firestore.FieldValue.serverTimestamp(),
          autoCreated: true,
        });
      });

      await batch.commit();
      console.log(`[slot-fix] ✅ Pre-created ${missing.length} slot docs for ${groundId}/${date}`);

    } catch (err) {
      // Non-fatal — the app still works, just without instant updates
      console.warn('[slot-fix] ensureSlotDocs error:', err.message);
    }
  }


  /* ═══════════════════════════════════════════════════════════
   *  FIX 2 — Bookings → Slots bridge listener
   *  Watches bookings collection. When a confirmed booking
   *  appears for this ground+date, immediately syncs the slot
   *  status so the slots onSnapshot fires for all users.
   * ═══════════════════════════════════════════════════════════*/
  function startBookingBridgeListener(groundId, date) {
    stopBookingBridgeListener();

    const db = window.db;
    if (!db || !groundId || !date) return;

    _bookingListenerUnsub = db.collection('bookings')
      .where('groundId', '==', groundId)
      .where('date',     '==', date)
      .onSnapshot(async (snapshot) => {
        for (const change of snapshot.docChanges()) {
          // Only care about newly added or modified docs
          if (change.type !== 'added' && change.type !== 'modified') continue;

          const booking = change.doc.data();
          const status  = booking.bookingStatus || booking.status || '';
          if (status !== 'confirmed') continue;

          // Derive slot time key from the booking
          const slotTime = (booking.slotTime || '').replace(/\s/g, '');
          if (!slotTime) continue;

          // Find the matching slot doc
          try {
            const startTime = slotTime.split('-')[0];
            const slotSnap  = await db.collection('slots')
              .where('groundId',  '==', groundId)
              .where('date',      '==', date)
              .where('startTime', '==', startTime)
              .limit(1)
              .get();

            if (!slotSnap.empty) {
              const slotDoc  = slotSnap.docs[0];
              const curStatus = slotDoc.data().status;

              // Only update if not already booked (idempotent)
              if (curStatus !== 'booked' && curStatus !== 'confirmed') {
                await slotDoc.ref.update({
                  status    : 'booked',
                  bookingId : change.doc.id,
                  updatedAt : firebase.firestore.FieldValue.serverTimestamp(),
                });
                console.log(`[slot-fix] 🔄 Bridge: marked ${slotTime} as booked via bookings listener`);
              }
            } else {
              // Slot doc doesn't exist yet — create it as booked
              await db.collection('slots').add({
                groundId  : groundId,
                date      : date,
                startTime : startTime,
                endTime   : slotTime.split('-')[1] || '',
                slotTime  : slotTime,
                status    : 'booked',
                bookingId : change.doc.id,
                createdAt : firebase.firestore.FieldValue.serverTimestamp(),
                autoCreated: true,
              });
              console.log(`[slot-fix] 🔄 Bridge: created booked slot doc for ${slotTime}`);
            }
          } catch (e) {
            console.warn('[slot-fix] bridge update error:', e.message);
          }
        }
      }, err => {
        console.warn('[slot-fix] booking bridge listener error:', err.message);
      });

    console.log(`[slot-fix] ✅ Booking bridge listener started for ${groundId}/${date}`);
  }

  function stopBookingBridgeListener() {
    if (typeof _bookingListenerUnsub === 'function') {
      _bookingListenerUnsub();
      _bookingListenerUnsub = null;
      console.log('[slot-fix] 🔕 Booking bridge listener stopped');
    }
  }


  /* ═══════════════════════════════════════════════════════════
   *  FIX 3 — Slots listener health-check / auto-reconnect
   * ═══════════════════════════════════════════════════════════*/
  function startHealthCheck() {
    stopHealthCheck();
    _lastSlotUpdate = Date.now();

    _healthInterval = setInterval(() => {
      // Only check if we're on the ground page
      const groundPage = document.getElementById('ground-page');
      if (!groundPage || !groundPage.classList.contains('active')) return;

      const elapsed = Date.now() - _lastSlotUpdate;
      const STALE_MS = 90 * 1000; // 90 seconds

      if (elapsed > STALE_MS && _currentGroundId && _currentDate) {
        console.warn('[slot-fix] 🔁 Slot listener appears stale — reconnecting…');
        if (typeof window.loadSlots === 'function') {
          window.loadSlots(_currentGroundId, _currentDate);
        }
        _lastSlotUpdate = Date.now(); // reset so we don't spam
      }
    }, 30 * 1000); // check every 30 s
  }

  function stopHealthCheck() {
    if (_healthInterval) {
      clearInterval(_healthInterval);
      _healthInterval = null;
    }
  }

  /* Patch loadSlots to record the last update time */
  function patchLoadSlots() {
    const original = window.loadSlots;
    if (!original || original._slotFixPatched) return;

    window.loadSlots = function (groundId, date) {
      _currentGroundId = groundId;
      _currentDate     = date;
      _lastSlotUpdate  = Date.now();

      // Run the original
      const result = original.apply(this, arguments);

      // Every time loadSlots is called, (re)start the bridge + health check
      // Small delay so the original listener is registered first
      setTimeout(() => {
        ensureSlotDocs(groundId, date);
        startBookingBridgeListener(groundId, date);
        startHealthCheck();
      }, 500);

      return result;
    };
    window.loadSlots._slotFixPatched = true;

    // Also intercept the internal _bmgRenderSlots to track update times
    const origRender = window._bmgRenderSlots;
    if (typeof origRender === 'function' && !origRender._slotFixPatched) {
      window._bmgRenderSlots = function () {
        _lastSlotUpdate = Date.now();
        return origRender.apply(this, arguments);
      };
      window._bmgRenderSlots._slotFixPatched = true;
    }

    console.log('[slot-fix] loadSlots patched');
  }


  /* ═══════════════════════════════════════════════════════════
   *  Stop everything when navigating away from ground page
   * ═══════════════════════════════════════════════════════════*/
  window.addEventListener('bmg:pageShown', function (e) {
    const pageId = e.detail?.pageId;
    const GROUND_FLOW = new Set(['ground-page', 'booking-page', 'confirmation-page', 'payment-page']);

    if (!GROUND_FLOW.has(pageId)) {
      stopBookingBridgeListener();
      stopHealthCheck();
    }
  });


  /* ═══════════════════════════════════════════════════════════
   *  Boot: wait for loadSlots to be defined, then patch it
   * ═══════════════════════════════════════════════════════════*/
  _waitFor('loadSlots', patchLoadSlots);

  console.log('✅ [bmg_slot_realtime_fix.js] Loaded — instant slot updates for all users enabled');

})();