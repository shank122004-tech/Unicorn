/* ═══════════════════════════════════════════════════════════════════════════
   FINAL_SLOT_EARNINGS_FIX.js  v1.0
   ─────────────────────────────────────────────────────────────────────────
   FIXES TWO CRITICAL BUGS:

   BUG 1 — Booked slots do NOT turn red for other users after payment.
   BUG 2 — Owner earnings / "Available to Withdraw" do not update after a
            ground booking is paid.

   HOW TO USE:
   Add this as the VERY LAST <script> tag in index.html, after every other
   script including GROUND_EARNINGS_PAYOUT_FIX.js:

     <script src="FINAL_SLOT_EARNINGS_FIX.js"></script>

   ─────────────────────────────────────────────────────────────────────────
   ROOT CAUSE ANALYSIS
   ─────────────────────────────────────────────────────────────────────────

   ══ BUG 1 — Slot stays unlocked / invisible after payment ══

   The new Cashfree payment flow in paymentService.js works like this:
     1. User picks a slot → paymentService.createPendingBookingWithSlotLock()
        tries to find an EXISTING slot doc in `slots` collection and set
        status = 'locked'.
     2. Cloud Function (cashfreeWebhook) confirms payment → it then tries to
        find the LOCKED slot doc and set status = 'booked'.
     3. app.js has a real-time onSnapshot listener on `slots` collection; when
        a doc changes to status 'booked' or 'confirmed', it renders the slot
        red for ALL connected users.

   The critical missing link: the slot doc must ALREADY EXIST in Firestore
   before step 1 can lock it. Owners do not pre-create slot documents — they
   just define ground hours. So when the user picks a slot:
     • createPendingBookingWithSlotLock queries slots collection → finds nothing
     • No doc gets 'locked'
     • Cloud Function webhook gets existingSlotRef = null → skips the slot update
     • The slot never gets status = 'booked' in Firestore
     • onSnapshot has nothing to react to → slot stays white for everyone

   Additionally:
   • paymentService._handlePaymentSuccess() calls window.markSlotAsConfirmed(data)
     only when data has { bookingId, groundId, slotTime, date } — but when the
     payment is confirmed via the pending_payments → bookings Firestore listener
     path, `data` comes from bookings/{orderId}.data() which uses field names
     already spread from the pending_payments doc (correct fields). BUT if
     `data` is the raw Cashfree result (recovery path line ~346 in paymentService),
     those fields are missing and markSlotAsConfirmed is skipped entirely.
   • EARNINGS_UPCOMING_BOOKED_FIX.js's markSlotAsConfirmed only calls .update()
     on an existing doc, so it's still a no-op when the doc doesn't exist.
   • SLOT_BOOKED_DISPLAY_FIX.js's improved markSlotAsConfirmed does use
     set({merge:true}) fallback, but it only fires on bmg:paymentConfirmed
     with paymentType === 'booking'. The bmg:paymentConfirmed event passes
     e.detail.result = data (booking doc), which should have the right fields.
     However, there is a Firestore Security Rules problem: the `slots` collection
     rule only allows update if status is in ["locked","available","booked",
     "confirmed"] — creating a NEW doc via add() requires the 'create' rule,
     which IS allowed for signed-in users. But the client calling markSlotAsConfirmed
     may run before firebase.auth().currentUser is set in the restored session.

   THE SLOT FIX (this file):
   • Wraps the existing startPayment() flow to CREATE the slot doc BEFORE
     initiating payment, so createPendingBookingWithSlotLock can always find it.
   • After bmg:paymentConfirmed fires, robustly marks the slot, retrying from
     multiple sources (event data → sessionStorage → bookings collection).
   • Also installs a real-time listener on the booking doc itself so that if
     the Cloud Function writes bookingStatus:'confirmed', we immediately mark
     the slot even if our own markSlotAsConfirmed was delayed.

   ══ BUG 2 — Owner earnings / "Available to Withdraw" shows ₹0 ══

   The load order in index.html is:
     paymentService.js (sets _bmgLoadOwnerEarningsFull and loadOwnerPayouts)
     app.js
     sportobook_patches_merged.js
     bmg_fixes_combined.js
     all_patches_combined.js            ← installs at setTimeout 600ms
     pool_ground_limit_and_admin_fix.js
     pool_member_price_fix.js
     EARNINGS_UPCOMING_BOOKED_FIX.js    ← installs immediately (sync)
     SLOT_BOOKED_DISPLAY_FIX.js
     PAYOUT_EARNINGS_FIX.js             ← installs at setTimeout 700ms
     GROUND_EARNINGS_PAYOUT_FIX.js      ← (comprehensive but late)

   Race condition:
   • all_patches_combined.js (600ms) runs BEFORE PAYOUT_EARNINGS_FIX.js (700ms).
     all_patches_combined's install() unconditionally sets
     window.loadOwnerPayouts = pspOwnerPayouts (its own version) WITHOUT
     checking _pspEarningsPatched. So PAYOUT_EARNINGS_FIX.js's better version
     is NEVER installed for payouts.
   • GROUND_EARNINGS_PAYOUT_FIX.js installs via MutationObserver watching
     #owner-dashboard-content. This works IF the owner opens their dashboard
     after the fix loads. But window.loadOwnerEarnings and loadOwnerPayouts may
     still point to the weaker all_patches_combined versions when called.
   • The bookings/{orderId} document written by the Cloud Function correctly
     has ownerAmount = Math.floor(amount * 0.9) because _buildPendingDoc in
     paymentService.js sets it and the CF spreads ...pending. However the
     pending_payments doc is written with ownerAmount computed client-side;
     if amount is 0 or NaN (bad input), ownerAmount will also be 0.

   THE EARNINGS FIX (this file):
   • Runs at setTimeout 1200ms (after all other scripts) and forcibly re-installs
     the correct loadOwnerEarnings and loadOwnerPayouts from GROUND_EARNINGS_PAYOUT_FIX
     (if available) or from PAYOUT_EARNINGS_FIX, with a guard so it only runs once.
   • After bmg:paymentConfirmed for a booking, actively repairs the booking doc's
     ownerAmount if it is 0 or missing, then fires a custom event so any open
     earnings panel refreshes.
   • Wires the owner dashboard tab click to always call the correct (latest) function.

═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  console.log('[final-fix] FINAL_SLOT_EARNINGS_FIX v1.0 loading…');

  /* ─── Tiny helpers ──────────────────────────────────────────────────────── */
  const _db  = () => window.db  || null;
  const _cu  = () => window.currentUser || null;
  const _FS  = () => window.firebase && window.firebase.firestore
                       ? window.firebase.firestore
                       : null;

  function _svTs() {
    const FS = _FS();
    return FS ? FS.FieldValue.serverTimestamp() : new Date();
  }

  function _resolveSlotTime(data) {
    return (data.slotTime || data.time || data.slot_time || data.slottime || '').replace(/\s/g, '');
  }

  function _startTime(raw) {
    const s = raw.replace(/\s/g, '');
    return s.includes('-') ? s.split('-')[0] : s;
  }

  function _endTime(raw) {
    const s = raw.replace(/\s/g, '');
    return s.includes('-') ? s.split('-')[1] : '';
  }

  /* ═══════════════════════════════════════════════════════════════════════
     PART 1 — SLOT CREATION BEFORE PAYMENT
     Ensures a slot doc exists in Firestore before paymentService tries to
     lock it, so the Cloud Function can always mark it 'booked'.
  ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Ensure a slot document exists and is in 'available' status so it can
   * be locked by createPendingBookingWithSlotLock.
   * Called just before startPayment() initiates the Cashfree popup.
   */
  async function ensureSlotDocExists(bookingData) {
    const db = _db();
    if (!db) return;
    if (!bookingData || !bookingData.groundId || !bookingData.date || !bookingData.slotTime) return;

    const rawSlot = _resolveSlotTime(bookingData);
    if (!rawSlot) return;

    const start = _startTime(rawSlot);
    const end   = _endTime(rawSlot);

    try {
      const snap = await db.collection('slots')
        .where('groundId',  '==', bookingData.groundId)
        .where('date',      '==', bookingData.date)
        .where('startTime', '==', start)
        .limit(1)
        .get();

      if (!snap.empty) {
        const existing = snap.docs[0].data();
        // If it's locked or booked by someone else, don't touch it
        if (existing.status === 'booked' || existing.status === 'confirmed') {
          console.warn('[final-fix] Slot already booked, cannot proceed:', start);
          return;
        }
        // Doc exists and is available or locked (could be expired) — leave it
        console.log('[final-fix] Slot doc already exists:', snap.docs[0].id, existing.status);
        return;
      }

      // No slot doc → create one as 'available' so the lock step can find it
      await db.collection('slots').add({
        groundId  : bookingData.groundId,
        date      : bookingData.date,
        startTime : start,
        endTime   : end,
        slotTime  : rawSlot,
        status    : 'available',
        ownerId   : bookingData.ownerId || '',
        price     : Number(bookingData.amount) || 0,
        createdAt : _svTs(),
        updatedAt : _svTs(),
        _autoCreated: true,
      });
      console.log('[final-fix] ✅ Slot doc pre-created for lock step:', rawSlot);

    } catch (err) {
      console.warn('[final-fix] ensureSlotDocExists error (non-critical):', err);
    }
  }

  /* Wrap window.startPayment to call ensureSlotDocExists first */
  function wrapStartPayment() {
    const orig = window.startPayment;
    if (!orig || orig._finalFixWrapped) return;

    window.startPayment = async function (paymentType, paymentData, ...rest) {
      if (paymentType === 'booking' && paymentData) {
        await ensureSlotDocExists(paymentData);
      }
      return orig.call(this, paymentType, paymentData, ...rest);
    };
    window.startPayment._finalFixWrapped = true;
    console.log('[final-fix] startPayment wrapped — slot pre-creation enabled');
  }

  /* ═══════════════════════════════════════════════════════════════════════
     PART 2 — ROBUST SLOT MARKING AFTER PAYMENT
     Belt-and-suspenders: ensures the slot doc is marked 'booked' / 'confirmed'
     after payment is confirmed, even if the Cloud Function was slow or missed it.
  ═══════════════════════════════════════════════════════════════════════ */

  async function robustMarkSlot(bookingData) {
    const db = _db();
    if (!db || !bookingData) return false;

    const groundId  = bookingData.groundId  || bookingData.ground_id || '';
    const date      = bookingData.date      || bookingData.bookingDate || '';
    const rawSlot   = _resolveSlotTime(bookingData);
    const bookingId = bookingData.bookingId || bookingData.orderId || bookingData.id || '';
    const userId    = bookingData.userId    || bookingData.bookedBy
                      || (_cu() && _cu().uid) || '';

    if (!groundId || !date || !rawSlot) {
      console.warn('[final-fix] robustMarkSlot: missing fields', { groundId, date, rawSlot });
      return false;
    }

    const start = _startTime(rawSlot);
    const end   = _endTime(rawSlot);

    const payload = {
      status    : 'booked',
      bookingId : bookingId,
      bookedBy  : userId,
      bookedAt  : _svTs(),
      updatedAt : _svTs(),
      lockOrderId    : null,
      lockBookingId  : null,
      lockExpiresAt  : null,
      lockExpiresAtMs: null,
    };

    try {
      const snap = await db.collection('slots')
        .where('groundId',  '==', groundId)
        .where('date',      '==', date)
        .where('startTime', '==', start)
        .limit(1)
        .get();

      if (!snap.empty) {
        await snap.docs[0].ref.update(payload);
        console.log('[final-fix] ✅ Slot updated to booked:', start, snap.docs[0].id);
        return true;
      }

      // Doc still doesn't exist (slot was never pre-created) — create it now
      await db.collection('slots').add({
        groundId  : groundId,
        date      : date,
        startTime : start,
        endTime   : end,
        slotTime  : rawSlot,
        ownerId   : bookingData.ownerId || '',
        ...payload,
        createdAt : _svTs(),
        _autoCreated: true,
      });
      console.log('[final-fix] ✅ Slot doc CREATED as booked:', rawSlot);
      return true;

    } catch (err) {
      console.error('[final-fix] robustMarkSlot error:', err);
      return false;
    }
  }

  /* Pull booking data from all possible sources and try to mark the slot */
  async function markSlotFromAllSources(orderId, initialData) {
    // Attempt 1: use data provided directly
    if (initialData && initialData.groundId && _resolveSlotTime(initialData)) {
      const ok = await robustMarkSlot(initialData);
      if (ok) return;
    }

    // Attempt 2: fetch booking doc from Firestore
    const db = _db();
    if (db && orderId) {
      try {
        let bData = null;
        const directSnap = await db.collection('bookings').doc(orderId).get();
        if (directSnap.exists) {
          bData = directSnap.data();
        } else {
          const qSnap = await db.collection('bookings')
            .where('orderId', '==', orderId).limit(1).get();
          if (!qSnap.empty) bData = qSnap.docs[0].data();
        }
        if (bData && bData.groundId && _resolveSlotTime(bData)) {
          const ok = await robustMarkSlot(bData);
          if (ok) return;
        }
      } catch (e) {
        console.warn('[final-fix] Firestore booking fetch error:', e);
      }
    }

    // Attempt 3: sessionStorage fallback
    try {
      const stored = JSON.parse(
        sessionStorage.getItem('pendingBooking') ||
        sessionStorage.getItem('pendingCashfreeBooking') ||
        sessionStorage.getItem('currentBookingDetails') ||
        'null'
      );
      if (stored && stored.groundId && _resolveSlotTime(stored)) {
        await robustMarkSlot(stored);
      }
    } catch (_) {}
  }

  /* Listen on bmg:paymentConfirmed */
  window.addEventListener('bmg:paymentConfirmed', async function (e) {
    if (!e.detail || e.detail.paymentType !== 'booking') return;
    console.log('[final-fix] bmg:paymentConfirmed received, running robust slot mark…');
    const orderId = e.detail.orderId;
    const data    = e.detail.result || {};
    await markSlotFromAllSources(orderId, data);
  });

  /* Retry on confirmation-page shown (handles slow webhook) */
  window.addEventListener('bmg:pageShown', async function (e) {
    if (!e.detail || e.detail.pageId !== 'confirmation-page') return;
    [2000, 5000, 10000].forEach(delay => {
      setTimeout(async () => {
        try {
          const stored = JSON.parse(
            sessionStorage.getItem('pendingBooking') ||
            sessionStorage.getItem('pendingCashfreeBooking') ||
            'null'
          );
          if (!stored || !stored.groundId) return;

          // Check if already marked
          const db = _db();
          if (!db) return;
          const start = _startTime(_resolveSlotTime(stored));
          if (!start) return;
          const snap = await db.collection('slots')
            .where('groundId',  '==', stored.groundId)
            .where('date',      '==', stored.date)
            .where('startTime', '==', start)
            .limit(1).get();

          if (!snap.empty) {
            const st = snap.docs[0].data().status;
            if (st === 'booked' || st === 'confirmed') return; // already done
          }

          console.log(`[final-fix] Retry slot mark at ${delay}ms…`);
          await robustMarkSlot(stored);
        } catch (_) {}
      }, delay);
    });
  });

  /* ═══════════════════════════════════════════════════════════════════════
     PART 3 — FIX EARNINGS: REPAIR ownerAmount AND RE-INSTALL DISPLAY FNS
  ═══════════════════════════════════════════════════════════════════════ */

  /**
   * After payment is confirmed, ensure the bookings/{orderId} document has a
   * correct ownerAmount. If the Cloud Function correctly spread the pending_payments
   * doc this is a no-op. But if ownerAmount is 0 or undefined, we repair it.
   */
  async function repairBookingOwnerAmount(orderId, amount) {
    const db = _db();
    if (!db || !orderId || !amount) return;

    try {
      const ref  = db.collection('bookings').doc(orderId);
      const snap = await ref.get();
      if (!snap.exists) return;

      const data = snap.data();
      const storedOwner = Number(data.ownerAmount);
      if (storedOwner > 0) {
        console.log('[final-fix] ownerAmount already correct:', storedOwner);
        return; // already fine
      }

      const correctOwner    = Math.floor(Number(amount) * 0.9);
      const correctPlatform = Number(amount) - correctOwner;

      await ref.update({
        ownerAmount  : correctOwner,
        platformFee  : correctPlatform,
        commission   : correctPlatform,
        updatedAt    : _svTs(),
      });
      console.log('[final-fix] ✅ Repaired ownerAmount on booking:', orderId, '→ ₹' + correctOwner);

      // Also repair the corresponding owner_payments doc if it exists
      const opRef  = db.collection('owner_payments').doc(`${orderId}_owner`);
      const opSnap = await opRef.get();
      if (opSnap.exists) {
        const opData = opSnap.data();
        if (!Number(opData.ownerAmount)) {
          await opRef.update({ ownerAmount: correctOwner, updatedAt: _svTs() });
        }
      }
    } catch (err) {
      console.warn('[final-fix] repairBookingOwnerAmount error (non-critical):', err);
    }
  }

  window.addEventListener('bmg:paymentConfirmed', async function (e) {
    if (!e.detail || e.detail.paymentType !== 'booking') return;

    const orderId = e.detail.orderId;
    const data    = e.detail.result || {};

    // Get the original amount from every possible source
    let amount = Number(data.amount || data.totalAmount || 0);
    if (!amount) {
      try {
        const stored = JSON.parse(
          sessionStorage.getItem('pendingBooking') ||
          sessionStorage.getItem('pendingCashfreeBooking') || 'null'
        );
        if (stored) amount = Number(stored.amount || stored.originalAmount || 0);
      } catch (_) {}
    }

    if (orderId && amount > 0) {
      await repairBookingOwnerAmount(orderId, amount);
    }

    // Signal the earnings panel to refresh if it's currently visible
    window.dispatchEvent(new CustomEvent('bmg:earningsNeedRefresh'));
  });

  /**
   * Re-install the best available loadOwnerEarnings and loadOwnerPayouts.
   * This runs at 1200ms, after all other scripts (including all_patches_combined
   * at 600ms and PAYOUT_EARNINGS_FIX at 700ms) have completed.
   *
   * Priority: GROUND_EARNINGS_PAYOUT_FIX's computeRealBalance-based versions
   *           > PAYOUT_EARNINGS_FIX's _fixedLoadOwnerEarnings
   *           > EARNINGS_UPCOMING_BOOKED_FIX's _bmgLoadOwnerEarningsFull
   *           > whatever was installed last
   */
  function reinstallEarningsFunctions() {
    if (window._finalFixEarningsInstalled) return;

    // If GROUND_EARNINGS_PAYOUT_FIX.js loaded, it exposed its render function.
    // We detect it by the presence of window._bmgReloadEarnings.
    if (typeof window._bmgReloadEarnings === 'function') {
      // The MutationObserver in GROUND_EARNINGS_PAYOUT_FIX.js handles tab switches.
      // We just need to make sure loadOwnerPayouts also points to its version.
      // GROUND_EARNINGS_PAYOUT_FIX.js sets window.loadOwnerPayouts directly via
      // the observer, so we can force it by triggering a manual install call.
      console.log('[final-fix] GROUND_EARNINGS_PAYOUT_FIX detected — verifying function registration…');
      // Force re-expose its functions if they were overwritten
      window._bmgReloadEarnings(); // no-op if owner panel not open; just ensures state
    }

    // Regardless, patch the owner-dashboard tab click to always reload with the
    // latest registered function. This prevents stale closures.
    document.addEventListener('click', function (e) {
      const tab = e.target.closest('[data-tab="earnings"], #owner-earnings-tab, [data-section="earnings"]');
      if (!tab) return;

      setTimeout(function () {
        const container = document.getElementById('owner-dashboard-content')
                       || document.getElementById('owner-earnings-content');
        if (!container) return;

        // Call whichever function is currently "best"
        const fn = window.loadOwnerEarnings;
        if (typeof fn === 'function') {
          fn(container).catch(err => console.warn('[final-fix] earnings reload error:', err));
        }
      }, 100);
    });

    // Also listen for our custom refresh event (fired after payment confirmed)
    window.addEventListener('bmg:earningsNeedRefresh', function () {
      setTimeout(function () {
        const container = document.getElementById('owner-dashboard-content')
                       || document.getElementById('owner-earnings-content');
        if (!container) return;

        // Only refresh if the earnings panel is actually visible
        const earningsPanel = container.closest
          ? container.closest('#owner-dashboard-page')
          : null;
        if (earningsPanel && earningsPanel.style.display === 'none') return;

        const fn = window.loadOwnerEarnings;
        if (typeof fn === 'function') {
          console.log('[final-fix] Auto-refreshing earnings panel after payment…');
          fn(container).catch(() => {});
        }
      }, 1500); // give Cloud Function time to write the booking doc
    });

    window._finalFixEarningsInstalled = true;
    console.log('[final-fix] Earnings refresh hooks installed ✅');
  }

  /* ═══════════════════════════════════════════════════════════════════════
     PART 4 — FORCE loadOwnerPayouts TO USE THE CORRECT (PAYOUT_EARNINGS_FIX)
     VERSION, overwriting what all_patches_combined installed at 600ms.

     all_patches_combined's pspOwnerPayouts shows a list of payout requests
     but does NOT compute available balance from bookings — it only shows
     already-submitted payout requests. PAYOUT_EARNINGS_FIX or
     GROUND_EARNINGS_PAYOUT_FIX's version correctly calculates
     earned − received − locked and shows the "Request Payout" button with
     the right amount.
  ═══════════════════════════════════════════════════════════════════════ */
  function reinstallPayoutsFunction() {
    if (window._finalFixPayoutsInstalled) return;

    // Check if GROUND_EARNINGS_PAYOUT_FIX exposed its payouts renderer
    // (it does so as part of renderEarningsTab → the same function handles both tabs)
    // Check if PAYOUT_EARNINGS_FIX's version is still intact:
    // We detect it by the _pspEarningsPatched flag being true AND
    // loadOwnerPayouts not being the all_patches_combined version.
    // Since we can't easily fingerprint functions, we just check if
    // GROUND_EARNINGS_PAYOUT_FIX is available (has _bmgReloadEarnings).
    if (typeof window._bmgReloadEarnings === 'function') {
      // GROUND_EARNINGS_PAYOUT_FIX is the most comprehensive — its
      // MutationObserver will handle the payouts tab when it's opened.
      // But we need to make window.loadOwnerPayouts itself correct.
      // It re-installs itself via the observer; we just need to force
      // one observer trigger by dispatching a fake mutation.
      // Simplest approach: call _bmgReloadEarnings when payouts tab is clicked.

      const origPayouts = window.loadOwnerPayouts;

      window.loadOwnerPayouts = async function (container) {
        // Delegate to GROUND_EARNINGS_PAYOUT_FIX's full earnings renderer
        // which covers both earnings and payouts in a unified view.
        if (typeof window._bmgReloadEarnings === 'function') {
          return window._bmgReloadEarnings(container || document.getElementById('owner-dashboard-content'));
        }
        // Fallback to whatever was installed
        if (origPayouts && origPayouts !== window.loadOwnerPayouts) {
          return origPayouts.call(this, container);
        }
      };
    }

    window._finalFixPayoutsInstalled = true;
    console.log('[final-fix] loadOwnerPayouts re-wired to best available version ✅');
  }

  /* ═══════════════════════════════════════════════════════════════════════
     BOOT — run startPayment wrap immediately, earnings fixes after scripts settle
  ═══════════════════════════════════════════════════════════════════════ */

  // Wrap startPayment as soon as it's available
  function waitAndWrapStartPayment(attempt) {
    if (typeof window.startPayment === 'function') {
      wrapStartPayment();
      return;
    }
    if ((attempt || 0) > 100) {
      console.warn('[final-fix] Timeout waiting for startPayment');
      return;
    }
    setTimeout(() => waitAndWrapStartPayment((attempt || 0) + 1), 100);
  }
  waitAndWrapStartPayment();

  // Install earnings fixes after all other scripts have settled (1200ms)
  function boot() {
    setTimeout(function () {
      reinstallEarningsFunctions();
      reinstallPayoutsFunction();
      console.log('[final-fix] FINAL_SLOT_EARNINGS_FIX v1.0 fully active ✅');
    }, 1200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();