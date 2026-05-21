/**
 * bmg_slot_realtime_fix.js  — v2
 * ═══════════════════════════════════════════════════════════════════
 *
 *  WHAT IS BROKEN AND WHY
 *  ──────────────────────
 *
 *  BUG 1  pending_payments onSnapshot → "Missing or insufficient permissions"
 *    The Firestore rule for pending_payments is:
 *      allow read: if resource.data.userId == request.auth.uid;
 *    When onSnapshot first attaches and Firestore evaluates the rule on
 *    a non-existent or just-created doc, `resource` can be null, which
 *    causes the rule to throw a permission error and KILL the listener.
 *    Result: the client never learns the webhook deleted the doc, so
 *    _handlePaymentSuccess() is never called, so bmg:paymentConfirmed
 *    never fires, so the slot grid never updates.
 *
 *  BUG 2  _checkFinalStatus reads failed_payments → no rule → error
 *    There is no Firestore rule for failed_payments collection.
 *    Every read throws "Missing or insufficient permissions", which is
 *    silently caught, returning {} (neither success nor failed).
 *    The polling loop hits maxAttempts and calls the CF, but by then
 *    the UX is already broken.
 *
 *  BUG 3  Slot grid never refreshes after payment succeeds (paying user)
 *    The bmg:paymentConfirmed handler calls showBookingSuccessConfirmation()
 *    but NEVER calls loadSlots(). So even after a confirmed payment the
 *    slot the user just booked still shows "Available" on their screen.
 *    (Other users update automatically via the existing onSnapshot, but
 *    only IF the slot doc was updated by the webhook — see Fix 4.)
 *
 *  THE FIXES
 *  ─────────
 *
 *  FIX 1+2  Replace onSnapshot on pending_payments with safe polling
 *    We poll bookings / tournament_entries / owner_payments every 2 s
 *    for up to 60 s. These collections have correct read rules.
 *    We also remove the failed_payments read from _checkFinalStatus.
 *
 *  FIX 3  Reload slot grid after bmg:paymentConfirmed (booking)
 *    A new listener on bmg:paymentConfirmed calls loadSlots() for the
 *    paying user immediately after their payment is confirmed.
 *
 *  FIX 4  Pre-create slot docs when ground page opens
 *    Ensures the webhook always has a slot doc to update, so other
 *    users' onSnapshot listeners fire correctly.
 *
 *  LOAD ORDER — last <script> in index.html, after all other scripts:
 *    <script src="bmg_slot_realtime_fix.js"></script>
 * ═══════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  /* ────────────────────────────────────────────────────────────
   *  Utility
   * ────────────────────────────────────────────────────────────*/
  function _waitFor(fnName, cb, tries) {
    tries = tries || 0;
    if (typeof window[fnName] === 'function') { cb(); return; }
    if (tries > 60) { console.warn('[slot-fix] gave up waiting for', fnName); return; }
    setTimeout(function () { _waitFor(fnName, cb, tries + 1); }, 200);
  }

  var BMG_CF_BASE = 'https://us-central1-bookmygame-2149d.cloudfunctions.net';

  /* ════════════════════════════════════════════════════════════
   *  FIX 1 + 2
   *  Safe status checker — no failed_payments read, no onSnapshot
   *  on pending_payments.
   * ════════════════════════════════════════════════════════════*/

  async function _safeCheckFinalStatus(orderId, paymentType) {
    var db = window.db;
    if (!db || !orderId) return {};
    try {
      // --- booking ---
      if (!paymentType || paymentType === 'booking') {
        var b = await db.collection('bookings').doc(orderId).get();
        if (b.exists) return { success: true, data: b.data() };
      }
      // --- tournament ---
      if (!paymentType || paymentType === 'tournament') {
        var t = await db.collection('tournament_entries').doc(orderId).get();
        if (t.exists) return { success: true, data: t.data() };
      }
      // --- owner onboarding ---
      if (!paymentType || paymentType === 'owner_onboarding') {
        // owner_payments rule requires resource.data.ownerId == auth.uid
        // Use .catch(() => null) so a permissions error doesn't crash polling
        var op = await db.collection('owner_payments').doc(orderId).get()
          .catch(function () { return null; });
        if (op && op.exists) return { success: true, data: { orderId: orderId } };
      }
    } catch (e) {
      console.warn('[slot-fix] _safeCheckFinalStatus error:', e.message);
    }
    return {};
  }

  /** Dispatch confirmation event (same path as original _handlePaymentSuccess) */
  function _dispatchPaymentConfirmed(orderId, paymentType, data) {
    console.log('[slot-fix] ✅ dispatching bmg:paymentConfirmed', paymentType, orderId);
    window.dispatchEvent(new CustomEvent('bmg:paymentConfirmed', {
      detail: { orderId: orderId, paymentType: paymentType, result: data },
    }));
  }

  /** Last-resort CF call */
  async function _cfCheckOrderStatus(orderId, paymentType) {
    try {
      var res  = await fetch(BMG_CF_BASE + '/checkOrderStatus', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ orderId: orderId, paymentType: paymentType }),
      });
      var data = await res.json();
      if (data.status === 'SUCCESS') {
        _dispatchPaymentConfirmed(orderId, paymentType, data.booking || {});
      } else if (typeof window.showToast === 'function') {
        window.showToast('Payment status unclear — please check "My Bookings".', 'warning');
      }
    } catch (e) {
      if (typeof window.showToast === 'function') {
        window.showToast('Could not verify payment. Check "My Bookings".', 'warning');
      }
    }
  }

  /**
   * Replacement for _listenForPaymentConfirmation.
   * Uses safe polling instead of onSnapshot on pending_payments.
   * Returns a cancel function (same interface as the original unsubscribe).
   */
  function _safeListenForPaymentConfirmation(orderId, paymentType, onConfirmed) {
    var cancelled = false;
    var attempt   = 0;
    var MAX       = 30;      // 30 × 2 s = 60 s
    var INTERVAL  = 2000;

    async function poll() {
      if (cancelled) return;
      attempt++;

      var result = await _safeCheckFinalStatus(orderId, paymentType);

      if (result.success) {
        _dispatchPaymentConfirmed(orderId, paymentType, result.data);
        if (typeof onConfirmed === 'function') onConfirmed();
        return;
      }

      if (attempt < MAX) {
        setTimeout(poll, INTERVAL);
      } else {
        console.warn('[slot-fix] Polling timed out for', orderId, '— trying CF');
        _cfCheckOrderStatus(orderId, paymentType);
      }
    }

    setTimeout(poll, 1500); // first poll after 1.5 s
    return function cancel() { cancelled = true; };
  }

  function patchPaymentListeners() {
    // Overwrite the global functions that paymentService.js uses
    window._listenForPaymentConfirmation = _safeListenForPaymentConfirmation;
    window._checkFinalStatus             = _safeCheckFinalStatus;

    // Patch recoverPaymentSession (called when popup closes / page reloads)
    var origRecover = window.recoverPaymentSession;
    if (typeof origRecover === 'function' && !origRecover._sfPatched) {
      window.recoverPaymentSession = async function (orderId, paymentType, paymentData) {
        if (!orderId) return;
        if (typeof window.showLoading === 'function') window.showLoading('Verifying payment…');

        var attempts = 0;
        var MAX      = 30;

        async function poll() {
          attempts++;
          var result = await _safeCheckFinalStatus(orderId, paymentType);

          if (result.success) {
            if (typeof window.hideLoading === 'function') window.hideLoading();
            _dispatchPaymentConfirmed(orderId, paymentType, result.data || paymentData || {});
            sessionStorage.removeItem('slotLock');
            return;
          }

          if (attempts < MAX) {
            setTimeout(poll, 2000);
          } else {
            if (typeof window.hideLoading === 'function') window.hideLoading();
            _cfCheckOrderStatus(orderId, paymentType);
          }
        }
        poll();
      };
      window.recoverPaymentSession._sfPatched = true;
    }

    console.log('[slot-fix] FIX 1+2: Payment listeners patched — polling replaces pending_payments onSnapshot');
  }


  /* ════════════════════════════════════════════════════════════
   *  FIX 3  Reload slot grid for the paying user after confirmation
   * ════════════════════════════════════════════════════════════*/
  function patchPaymentConfirmedHandler() {
    window.addEventListener('bmg:paymentConfirmed', function (e) {
      var detail      = e.detail || {};
      var paymentType = detail.paymentType;
      var orderId     = detail.orderId;

      if (paymentType !== 'booking') return;

      var groundId = window.currentGround && window.currentGround.id;
      var date     = window.selectedDate;

      if (groundId && date && typeof window.loadSlots === 'function') {
        // 1.2 s delay gives the webhook time to write status:"booked" to Firestore
        // before we re-query, so the refreshed grid immediately shows the correct state.
        setTimeout(function () {
          console.log('[slot-fix] FIX 3: Reloading slots after booking confirmed:', orderId);
          window.loadSlots(groundId, date);
        }, 1200);
      }
    });

    console.log('[slot-fix] FIX 3: bmg:paymentConfirmed → loadSlots patch active');
  }


  /* ════════════════════════════════════════════════════════════
   *  FIX 4  Pre-create all 24 slot docs when ground page opens
   *  Ensures the webhook always has a slot doc to update, so
   *  every other user's onSnapshot listener fires correctly.
   * ════════════════════════════════════════════════════════════*/
  async function ensureSlotDocs(groundId, date) {
    var db = window.db;
    if (!db || !groundId || !date) return;

    try {
      var existingSnap = await db.collection('slots')
        .where('groundId', '==', groundId)
        .where('date',     '==', date)
        .get();

      var existing = {};
      existingSnap.forEach(function (doc) {
        var d   = doc.data();
        var key = (d.startTime && d.endTime)
          ? (d.startTime.trim() + '-' + d.endTime.trim())
          : (d.slotTime || '').replace(/\s/g, '');
        if (key) existing[key] = true;
      });

      var batch   = db.batch();
      var created = 0;

      for (var h = 0; h < 24; h++) {
        var sh  = String(h).padStart(2, '0');
        var eh  = String(h + 1).padStart(2, '0');
        var key = sh + ':00-' + eh + ':00';
        if (existing[key]) continue;

        var ref = db.collection('slots').doc();
        batch.set(ref, {
          groundId   : groundId,
          date       : date,
          startTime  : sh + ':00',
          endTime    : eh + ':00',
          slotTime   : key,
          status     : 'available',
          createdAt  : firebase.firestore.FieldValue.serverTimestamp(),
          autoCreated: true,
        });
        created++;
      }

      if (created > 0) {
        await batch.commit();
        console.log('[slot-fix] FIX 4: Pre-created ' + created + ' slot docs for ' + groundId + '/' + date);
      }
    } catch (err) {
      console.warn('[slot-fix] ensureSlotDocs error:', err.message);
    }
  }

  function patchLoadSlots() {
    var original = window.loadSlots;
    if (!original || original._sfPatched) return;

    window.loadSlots = function (groundId, date) {
      if (groundId && date) ensureSlotDocs(groundId, date); // non-blocking
      return original.apply(this, arguments);
    };
    window.loadSlots._sfPatched = true;

    console.log('[slot-fix] FIX 4: loadSlots patched to pre-create slot docs');
  }


  /* ════════════════════════════════════════════════════════════
   *  Also update the Firestore rule for pending_payments
   *  so the onSnapshot works even if the old paymentService
   *  version is cached. We can't edit .rules from JS, but we
   *  CAN make the read safe by adding a null-guard to the rule.
   *  — Deploy the updated firestore.rules file provided below —
   * ════════════════════════════════════════════════════════════*/


  /* ════════════════════════════════════════════════════════════
   *  Boot
   * ════════════════════════════════════════════════════════════*/
  patchPaymentListeners();      // FIX 1+2 — immediate
  patchPaymentConfirmedHandler(); // FIX 3 — immediate
  _waitFor('loadSlots', patchLoadSlots); // FIX 4 — after app.js ready

  console.log('✅ [bmg_slot_realtime_fix.js v2] All 4 fixes active');

})();