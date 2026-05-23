/**
 * bmg_pool_qr_scanner_fix.js
 * ─────────────────────────────────────────────────────────────────
 * FIXES TWO ROOT-CAUSE BUGS that make pool entry-pass QR codes
 * unscannable by the owner QR scanner:
 *
 *  BUG 1 — QR type mismatch
 *    showPoolEntryPassV2 (the active entry-pass renderer) emits:
 *      { app: 'BookMyGame', type: 'pool_entry', … }
 *    but patchProcessVerifiedQRCode only routes on:
 *      type === 'pool' | 'pool_booking'
 *    → 'pool_entry' falls through to the ground-booking verifier,
 *      which can't find it and throws "Booking not found".
 *
 *  BUG 2 — app vs appId key mismatch
 *    showPoolEntryPassV2 uses key  app: 'BookMyGame'
 *    The pool-verifier guard checks qrObject.appId !== 'BookMyGame'
 *    → appId is undefined → throws "This QR code was not generated
 *      by BookMyGame" before any DB lookup even happens.
 *
 * FIX STRATEGY
 *    1. After all scripts load, replace window.processVerifiedQRCode
 *       with a wrapper that:
 *         a. Normalises the QR object (copies app → appId when missing)
 *         b. Routes ALL pool types ('pool' | 'pool_booking' | 'pool_entry')
 *            to verifyPoolEntryQR()
 *         c. Falls through to the original for ground/tournament QRs
 *    2. Also fixes showPoolEntryPassV2 / showPoolEntryPass so every
 *       QR payload it generates uses both 'appId' AND 'app' keys,
 *       making old and new scanner versions compatible.
 *
 * LOAD ORDER: place AFTER all other bmg_*.js patches in index.html.
 * ─────────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  var POOL_TYPES = ['pool', 'pool_booking', 'pool_entry'];

  /* ── Normalise a parsed QR object so both 'app' and 'appId' exist ── */
  function normaliseQR(obj) {
    if (!obj) return obj;
    if (!obj.appId && obj.app)   obj.appId = obj.app;
    if (!obj.app   && obj.appId) obj.app   = obj.appId;
    return obj;
  }

  /* ─────────────────────────────────────────────────────────────────
   *  verifyPoolEntryQR — robust pool booking verifier
   *  Accepts qrObject with ANY of the pool type strings.
   * ───────────────────────────────────────────────────────────────── */
  async function verifyPoolEntryQR(qrObject) {
    var db          = window.db;
    var currentUser = window.currentUser
                      || (window.auth && window.auth.currentUser);

    if (!currentUser) throw new Error('Please log in to verify pool entries');

    var bookingId = qrObject.bookingId || qrObject.orderId;
    if (!bookingId) throw new Error('Invalid pool QR code — missing booking ID');

    /* ── Locate the pool_bookings document ─────────────────────── */
    var poolDoc = null;

    var tries = [
      function () { return db.collection('pool_bookings').doc(bookingId).get(); },
      function () { return db.collection('pool_bookings').where('bookingId', '==', bookingId).limit(1).get()
                              .then(function (s) { return s.empty ? null : s.docs[0]; }); },
      function () { return db.collection('pool_bookings').where('orderId', '==', bookingId).limit(1).get()
                              .then(function (s) { return s.empty ? null : s.docs[0]; }); },
    ];

    for (var i = 0; i < tries.length; i++) {
      try {
        var res = await tries[i]();
        if (res && res.exists) { poolDoc = res; break; }
      } catch (e) { /* permission or not-found — try next */ }
    }

    if (!poolDoc || !poolDoc.exists) {
      throw new Error('Pool booking not found. Please check the booking ID.');
    }

    var booking = poolDoc.data();

    /* ── Verify owner owns this pool ───────────────────────────── */
    var poolId = booking.poolId || qrObject.poolId;
    if (poolId) {
      try {
        var poolSnap = await db.collection('swimming_pools').doc(poolId).get();
        if (poolSnap.exists && poolSnap.data().ownerId !== currentUser.uid) {
          throw new Error('You can only verify entries for your own pools');
        }
      } catch (e) {
        if (e.message.indexOf('your own pools') !== -1) throw e;
        /* Can't read pool doc — fall back to booking.ownerId */
        if (booking.ownerId && booking.ownerId !== currentUser.uid) {
          throw new Error('You can only verify entries for your own pools');
        }
      }
    } else if (booking.ownerId && booking.ownerId !== currentUser.uid) {
      throw new Error('You can only verify entries for your own pools');
    }

    /* ── Status check ──────────────────────────────────────────── */
    var status = booking.status || booking.bookingStatus || '';
    if (status !== 'confirmed' && status !== 'completed') {
      throw new Error('Pool booking is not confirmed. Current status: ' + (status || 'unknown'));
    }

    /* ── Date check ────────────────────────────────────────────── */
    var today = new Date().toISOString().split('T')[0];
    if (booking.date && booking.date !== today) {
      throw new Error('This pool pass is for ' + booking.date + '. Today is ' + today + '.');
    }

    /* ── Already used? ─────────────────────────────────────────── */
    if (booking.entryStatus === 'used') {
      throw new Error('This pool pass has already been used for entry');
    }

    /* ── Mark as used ──────────────────────────────────────────── */
    await poolDoc.ref.update({
      entryStatus    : 'used',
      entryTime      : firebase.firestore.FieldValue.serverTimestamp(),
      verifiedBy     : currentUser.uid,
      verifiedByName : currentUser.ownerName || currentUser.name || 'Owner',
      verifiedAt     : firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt      : firebase.firestore.FieldValue.serverTimestamp(),
    });

    return {
      isPool        : true,
      userName      : booking.userName  || booking.name || 'Guest',
      userPhone     : booking.userPhone || booking.phone || '',
      bookingId     : booking.bookingId || booking.orderId || poolDoc.id,
      date          : booking.date      || today,
      slotTime      : booking.slotTime  || qrObject.slot || '',
      amount        : booking.amount    || 0,
      poolName      : booking.poolName  || 'Swimming Pool',
      memberCount   : booking.memberCount || qrObject.members || 1,
      entryTime     : new Date(),
    };
  }


  /* ─────────────────────────────────────────────────────────────────
   *  Patch processVerifiedQRCode
   * ───────────────────────────────────────────────────────────────── */
  function installScannerPatch() {
    var original = window.processVerifiedQRCode;
    if (!original) {
      console.warn('[pool-qr-fix] processVerifiedQRCode not found yet — will retry');
      return false;
    }
    if (original._poolQRFixV3) return true; // already patched by us

    window.processVerifiedQRCode = async function (qrData) {
      var qrObject = null;
      try { qrObject = JSON.parse(qrData); } catch (e) { /* not JSON */ }

      if (qrObject) {
        normaliseQR(qrObject);

        /* Route ALL pool-type QR codes to our verifier */
        if (POOL_TYPES.indexOf(qrObject.type) !== -1) {
          var showVerification = window.showVerificationResult;
          var closeScanner     = window.closeProfessionalQRScanner;

          try {
            /* App-ID guard (tolerant of both key names) */
            var appName = qrObject.appId || qrObject.app || '';
            if (!appName || appName !== 'BookMyGame') {
              throw new Error('This QR code was not generated by BookMyGame');
            }

            var poolResult = await verifyPoolEntryQR(qrObject);

            if (typeof closeScanner === 'function') closeScanner();

            if (typeof showVerification === 'function') {
              /* Shape fakeBooking to match what showVerificationResult expects */
              var fakeBooking = {
                userName  : poolResult.userName,
                userPhone : poolResult.userPhone,
                bookingId : poolResult.bookingId,
                date      : poolResult.date,
                slotTime  : poolResult.slotTime,
                amount    : poolResult.amount,
                entryTime : { toDate: function () { return poolResult.entryTime; } },
                _isPool   : true,
                _poolName : poolResult.poolName,
              };
              showVerification(true, fakeBooking);
            } else {
              /* Fallback — show a simple success toast */
              if (typeof window.showToast === 'function') {
                window.showToast(
                  '🏊 Pool entry verified for ' + poolResult.userName + ' (' +
                  poolResult.memberCount + ' member' + (poolResult.memberCount > 1 ? 's' : '') + ')',
                  'success'
                );
              }
            }

          } catch (err) {
            console.error('[pool-qr-fix] Pool QR verification error:', err);
            if (typeof closeScanner === 'function') closeScanner();
            if (typeof showVerification === 'function') {
              showVerification(false, null, err.message);
            } else if (typeof window.showToast === 'function') {
              window.showToast('Verification failed: ' + err.message, 'error');
            }
          }

          return; /* handled — do NOT fall through */
        }
      }

      /* Not a pool QR — delegate to the original handler */
      return original.apply(this, arguments);
    };

    window.processVerifiedQRCode._poolQRFixV3 = true;
    console.log('[pool-qr-fix] ✅ processVerifiedQRCode patched — pool_entry type now handled');
    return true;
  }


  /* ─────────────────────────────────────────────────────────────────
   *  Patch showPoolEntryPassV2 / showPoolEntryPass so every future
   *  QR payload carries BOTH 'app' and 'appId' keys, plus the
   *  correct type 'pool_entry' — making it scannable by both old
   *  and new versions of the owner scanner.
   * ───────────────────────────────────────────────────────────────── */
  function patchQRPayloadGeneration() {
    /* We intercept window._bmgGenerateQR (set by bmg_qrcode_fix.js)
       and QRCode.toDataURL at the call site by monkey-patching the
       JSON.stringify result inside showPoolEntryPassV2.
       Simpler and more reliable: wrap showPoolEntryPass itself and
       fix the payload right before QR generation by overriding
       JSON.stringify temporarily — but that's too invasive.

       Instead, we patch window.QRCode.toDataURL to intercept any
       call where the text parses to a pool QR and ensure appId is set. */

    var patchToDataURL = function () {
      var qrc = window.QRCode;
      if (!qrc || typeof qrc.toDataURL !== 'function') return false;
      if (qrc.toDataURL._poolQRKeyFix) return true;

      var origToDU = qrc.toDataURL.bind(qrc);
      qrc.toDataURL = function (text, opts) {
        /* Normalise pool QR payloads on-the-fly */
        try {
          var obj = JSON.parse(text);
          if (obj && POOL_TYPES.indexOf(obj.type) !== -1) {
            if (!obj.appId && obj.app)   obj.appId = obj.app;
            if (!obj.app   && obj.appId) obj.app   = obj.appId;
            // Ensure type is always 'pool_entry' for consistency
            obj.type = 'pool_entry';
            text = JSON.stringify(obj);
          }
        } catch (e) { /* not JSON — leave as-is */ }
        return origToDU(text, opts);
      };
      qrc.toDataURL._poolQRKeyFix = true;
      console.log('[pool-qr-fix] ✅ QRCode.toDataURL patched — pool QR payload normalised');
      return true;
    };

    /* Also patch window._bmgGenerateQR if present */
    var patchBmgGenerateQR = function () {
      if (typeof window._bmgGenerateQR !== 'function') return false;
      if (window._bmgGenerateQR._poolQRKeyFix) return true;

      var orig = window._bmgGenerateQR;
      window._bmgGenerateQR = function (text, opts) {
        try {
          var obj = JSON.parse(text);
          if (obj && POOL_TYPES.indexOf(obj.type) !== -1) {
            normaliseQR(obj);
            obj.type = 'pool_entry';
            text = JSON.stringify(obj);
          }
        } catch (e) {}
        return orig(text, opts);
      };
      window._bmgGenerateQR._poolQRKeyFix = true;
      return true;
    };

    patchToDataURL();
    patchBmgGenerateQR();
    return true;
  }


  /* ─────────────────────────────────────────────────────────────────
   *  Boot — wait for window load so all other scripts have run
   * ───────────────────────────────────────────────────────────────── */
  function boot() {
    var scannerPatched = installScannerPatch();
    patchQRPayloadGeneration();

    /* If processVerifiedQRCode wasn't ready yet, retry every 500 ms */
    if (!scannerPatched) {
      var retries = 0;
      var interval = setInterval(function () {
        retries++;
        if (installScannerPatch() || retries > 20) {
          clearInterval(interval);
          patchQRPayloadGeneration(); // re-patch QR gen too in case QRCode loaded late
        }
      }, 500);
    }
  }

  if (document.readyState === 'complete') {
    boot();
  } else {
    window.addEventListener('load', boot);
  }

  console.log('✅ [bmg_pool_qr_scanner_fix.js] Loaded — pool QR scanner fix active');
})();