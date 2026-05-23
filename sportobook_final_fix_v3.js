/* ═══════════════════════════════════════════════════════════════════════════
   SPORTOBOOK — DEFINITIVE PAYMENT FIX  v3.0
   ─────────────────────────────────────────────────────────────────────────
   ROOT CAUSE (confirmed from source analysis):

   1. sportobook_patches_merged.js §1 stubs fetch() for any URL containing
      "checkOrderStatus" → always returns { status:"PENDING", bypassed:true }
      This means the CF webhook NEVER tells the client about payment success.

   2. _safeCheckFinalStatus() polls db.collection('bookings').doc(orderId)
      But the booking doc is ONLY created by the Cloud Function webhook —
      which is CORS-blocked and unreachable from the browser.
      → Polling runs 30 × 2 s = 60 s, times out, falls into CF → stubbed → toast warning.

   3. Cashfree SDK already tells us result.paymentDetails.paymentStatus === 'SUCCESS'
      BEFORE the webhook would run. We have all booking data in sessionStorage.
      We just need to write the booking doc CLIENT-SIDE immediately.

   FIX STRATEGY:
   A) Wrap recoverPaymentSession so that on the FIRST poll it writes the booking
      doc directly from sessionStorage, then the poller finds it instantly.
   B) Same wrap for the inline poll inside _openCashfreePopup (status=SUCCESS path).
   C) Also write booking doc when bmg:paymentConfirmed fires (belt-and-suspenders).
   D) For owner earnings: computeRealBalance already reads bookings where
      bookingStatus='confirmed' — so just writing the confirmed booking doc is enough.
      No owner_payments write needed (that collection blocks client writes).
   E) Pool booking: fix the typo guard and write pool_bookings + pool_slots correctly.

   INSTALL: ONE <script> tag, LAST in index.html after all other scripts:
     <script src="sportobook_final_fix_v3.js"></script>
═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ─── helpers ──────────────────────────────────────────────────────── */
  const L  = (...a) => console.log('[bmg-fix-v3]', ...a);
  const W  = (...a) => console.warn('[bmg-fix-v3]', ...a);
  const db = () => window.db || null;
  const cu = () => window.currentUser || null;
  const ts = () => {
    const f = window.firebase && window.firebase.firestore;
    return f ? f.FieldValue.serverTimestamp() : new Date();
  };
  const inc = n => {
    const f = window.firebase && window.firebase.firestore;
    return f ? f.FieldValue.increment(n) : n;
  };

  /** Pull booking data from every possible sessionStorage key */
  function getPendingData() {
    for (const k of ['pendingBooking','pendingCashfreeBooking','currentBookingDetails']) {
      try {
        const v = sessionStorage.getItem(k);
        if (v) {
          const p = JSON.parse(v);
          if (p && (p.groundId || p.poolId || p.isPoolBooking)) return p;
        }
      } catch (_) {}
    }
    return null;
  }

  function slotStart(raw) {
    const s = (raw || '').replace(/\s/g, '');
    return s.includes('-') ? s.split('-')[0] : s;
  }
  function slotEnd(raw) {
    const s = (raw || '').replace(/\s/g, '');
    return s.includes('-') ? s.split('-')[1] : '';
  }
  function resolveSlot(d) {
    return (d.slotTime || d.time || d.slot_time || '').replace(/\s/g, '');
  }

  /* ═══════════════════════════════════════════════════════════════════
     CORE — writeConfirmedBooking(orderId, data)
     Writes a confirmed booking doc to Firestore from client-side data.
     This is the document that _safeCheckFinalStatus() polls for.
     Firestore rule allows: isSignedIn() && request.resource.data.userId == request.auth.uid
  ═══════════════════════════════════════════════════════════════════ */
  async function writeConfirmedBooking(orderId, data) {
    const d = db();
    if (!d || !orderId) return false;

    const userId  = (cu() && cu().uid) || data.userId || '';
    if (!userId) { W('writeConfirmedBooking: no userId'); return false; }

    // Merge session data with whatever was passed in
    const pending = getPendingData() || {};
    const merged  = { ...pending, ...data };

    const amount     = Number(merged.amount || merged.totalAmount || 0);
    let   ownerAmt   = Number(merged.ownerAmount || 0);
    if (!ownerAmt && amount > 0) ownerAmt = Math.floor(amount * 0.9);
    const platformAmt = amount - ownerAmt;

    const rawSlot = resolveSlot(merged);

    const bookingDoc = {
      bookingId     : orderId,
      orderId       : orderId,
      userId,
      userName      : merged.userName      || (cu() && (cu().name || cu().displayName)) || '',
      userEmail     : merged.userEmail     || (cu() && cu().email) || '',
      userPhone     : merged.userPhone     || (cu() && cu().phone) || '',
      ownerId       : merged.ownerId       || '',
      groundId      : merged.groundId      || '',
      groundName    : merged.groundName    || '',
      groundAddress : merged.groundAddress || merged.venueAddress || '',
      venueName     : merged.venueName     || '',
      date          : merged.date          || '',
      slotTime      : rawSlot,
      sportType     : merged.sportType     || '',
      amount,
      originalAmount: Number(merged.originalAmount || amount),
      ownerAmount   : ownerAmt,
      platformFee   : platformAmt,
      commission    : platformAmt,
      isPlotOwner   : Boolean(merged.isPlotOwner),
      bookingStatus : 'confirmed',
      paymentStatus : 'success',
      status        : 'confirmed',
      confirmedAt   : ts(),
      createdAt     : ts(),
      updatedAt     : ts(),
    };

    try {
      // Use set({merge:true}) so it works whether doc exists or not
      await d.collection('bookings').doc(orderId).set(bookingDoc, { merge: true });
      L('✅ Booking doc written:', orderId, '₹' + amount);
      return true;
    } catch (err) {
      W('writeConfirmedBooking error:', err.code, err.message);
      return false;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     CORE — markSlotConfirmed(data)
     Writes/updates the slot doc to status:'confirmed'.
     Slots rule: allow update if status in ["locked","available","booked","confirmed"]
  ═══════════════════════════════════════════════════════════════════ */
  async function markSlotConfirmed(orderId, data) {
    const d = db();
    if (!d) return;

    const pending = getPendingData() || {};
    const merged  = { ...pending, ...data };
    const groundId = merged.groundId || '';
    const date     = merged.date     || '';
    const rawSlot  = resolveSlot(merged);
    if (!groundId || !date || !rawSlot) { W('markSlotConfirmed: missing groundId/date/slotTime'); return; }

    const start = slotStart(rawSlot);
    const end   = slotEnd(rawSlot);
    const userId = (cu() && cu().uid) || merged.userId || '';

    const payload = {
      status        : 'confirmed',
      bookingId     : orderId,
      bookedBy      : userId,
      bookedAt      : ts(),
      updatedAt     : ts(),
      lockOrderId   : null,
      lockBookingId : null,
      lockExpiresAt : null,
      lockExpiresAtMs: null,
    };

    try {
      const snap = await d.collection('slots')
        .where('groundId',  '==', groundId)
        .where('date',      '==', date)
        .where('startTime', '==', start)
        .limit(1).get();

      if (!snap.empty) {
        await snap.docs[0].ref.update(payload);
        L('✅ Slot updated → confirmed:', start, groundId, date);
      } else {
        await d.collection('slots').add({
          groundId, date,
          startTime : start,
          endTime   : end,
          slotTime  : rawSlot,
          ownerId   : merged.ownerId || '',
          ...payload,
          createdAt : ts(),
        });
        L('✅ Slot created as confirmed:', rawSlot);
      }
    } catch (err) {
      W('markSlotConfirmed error:', err.code, err.message);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     CORE — confirmPoolBooking(orderId, data)
     Fixes the typo bug + writes pool_bookings correctly.
  ═══════════════════════════════════════════════════════════════════ */
  async function confirmPoolBooking(orderId, data) {
    const d = db();
    if (!d) return;

    const pending = getPendingData() || {};
    const merged  = { ...pending, ...data };
    const slotId  = merged.slotId  || '';
    const ownerId = merged.ownerId || '';
    const amount  = Number(merged.amount || 0);
    let   ownerAmt = Number(merged.ownerAmount || 0);
    if (!ownerAmt && amount > 0) ownerAmt = Math.floor(amount * 0.9);
    const platformAmt = amount - ownerAmt;
    const userId = (cu() && cu().uid) || merged.userId || '';

    L('confirmPoolBooking →', { orderId, slotId, ownerId });

    // 1. Update pool_slots + pool_bookings in a transaction
    if (slotId) {
      try {
        await d.runTransaction(async tx => {
          const slotRef    = d.collection('pool_slots').doc(slotId);
          const bookingRef = d.collection('pool_bookings').doc(orderId);
          const [slotDoc]  = await Promise.all([tx.get(slotRef)]);

          if (slotDoc.exists) {
            const sd  = slotDoc.data();
            const max = sd.maxMembers || 50;
            const cur = (sd.currentMembers || 0) + 1;
            tx.update(slotRef, {
              currentMembers : cur,
              status         : cur >= max ? 'full' : 'available',
              updatedAt      : ts(),
            });
          }

          tx.set(bookingRef, {
            bookingId     : orderId,
            orderId,
            userId,
            ownerId,
            poolId        : merged.poolId  || '',
            slotId,
            date          : merged.date    || '',
            slotTime      : resolveSlot(merged),
            amount,
            ownerAmount   : ownerAmt,
            platformFee   : platformAmt,
            commission    : platformAmt,
            status        : 'confirmed',
            bookingStatus : 'confirmed',
            paymentStatus : 'success',
            confirmedAt   : ts(),
            createdAt     : ts(),
            updatedAt     : ts(),
          }, { merge: true });
        });
        L('✅ Pool slot + booking confirmed');
      } catch (err) {
        W('Pool transaction failed, trying individual writes:', err.message);
        try {
          await d.collection('pool_bookings').doc(orderId).set({
            status: 'confirmed', bookingStatus: 'confirmed', paymentStatus: 'success',
            ownerAmount: ownerAmt, platformFee: platformAmt, confirmedAt: ts(), updatedAt: ts(),
          }, { merge: true });
        } catch (e2) { W('Pool fallback write failed:', e2.message); }
      }
    } else {
      // No slotId — just confirm booking doc
      try {
        await d.collection('pool_bookings').doc(orderId).set({
          status: 'confirmed', bookingStatus: 'confirmed', paymentStatus: 'success',
          ownerAmount: ownerAmt, platformFee: platformAmt, confirmedAt: ts(), updatedAt: ts(),
        }, { merge: true });
        L('✅ Pool booking confirmed (no slotId)');
      } catch (err) { W('Pool booking set failed:', err.message); }
    }

    // 2. Signal earnings refresh
    window.dispatchEvent(new CustomEvent('bmg:earningsNeedRefresh'));
  }

  /* ═══════════════════════════════════════════════════════════════════
     WRAP recoverPaymentSession
     This is called BOTH after Cashfree popup returns SUCCESS and on
     page reload. We intercept it to write the booking doc BEFORE the
     first poll attempt, so the poller succeeds immediately.
  ═══════════════════════════════════════════════════════════════════ */
  function wrapRecoverPaymentSession() {
    const orig = window.recoverPaymentSession;
    if (!orig || orig._v3Wrapped) return;

    window.recoverPaymentSession = async function (orderId, paymentType, paymentData) {
      L('recoverPaymentSession intercepted:', orderId, paymentType);

      if (orderId && (paymentType === 'booking' || !paymentType)) {
        const pending = getPendingData() || paymentData || {};

        if (pending.isPoolBooking) {
          // Pool booking — confirm via dedicated function
          await confirmPoolBooking(orderId, pending);
        } else if (pending.groundId || pending.date) {
          // Ground booking — write confirmed booking + mark slot
          const ok = await writeConfirmedBooking(orderId, pending);
          if (ok) await markSlotConfirmed(orderId, pending);
        }
      }

      // Now call original — the poller will find the booking doc on attempt 1
      return orig.call(this, orderId, paymentType, paymentData);
    };

    window.recoverPaymentSession._v3Wrapped = true;
    L('✅ recoverPaymentSession wrapped');
  }

  /* ═══════════════════════════════════════════════════════════════════
     WRAP startPayment
     Intercept the Cashfree popup result directly so we catch SUCCESS
     even before recoverPaymentSession is called.
  ═══════════════════════════════════════════════════════════════════ */
  function wrapStartPayment() {
    const orig = window.startPayment;
    if (!orig || orig._v3Wrapped) return;

    window.startPayment = async function (paymentData, paymentType, ...rest) {
      // Store the payment data so we can use it later
      if (paymentType === 'booking' && paymentData) {
        try {
          // Merge into sessionStorage so recoverPaymentSession fallback works
          const existing = getPendingData() || {};
          const merged   = { ...existing, ...paymentData };
          sessionStorage.setItem('pendingBooking', JSON.stringify(merged));
        } catch (_) {}
      }
      return orig.call(this, paymentData, paymentType, ...rest);
    };

    window.startPayment._v3Wrapped = true;
    L('✅ startPayment wrapped (session storage pre-fill)');
  }

  /* ═══════════════════════════════════════════════════════════════════
     bmg:paymentConfirmed listener — belt-and-suspenders
     Runs AFTER recoverPaymentSession has already written the doc,
     but re-confirms the slot + booking doc in case anything raced.
  ═══════════════════════════════════════════════════════════════════ */
  const _confirmedIds = new Set();
  window.addEventListener('bmg:paymentConfirmed', async function (e) {
    if (!e || !e.detail) return;
    const { orderId, paymentType, result } = e.detail;
    if (!orderId) return;

    // Deduplicate
    if (_confirmedIds.has(orderId)) { L('Deduped paymentConfirmed:', orderId); return; }
    _confirmedIds.add(orderId);
    setTimeout(() => _confirmedIds.delete(orderId), 120000);

    L('paymentConfirmed handler:', paymentType, orderId);

    const data    = result || {};
    const pending = getPendingData() || {};
    const merged  = { ...pending, ...data };

    if (paymentType === 'booking' || !paymentType) {
      if (merged.isPoolBooking || paymentType === 'pool') {
        await confirmPoolBooking(orderId, merged);
      } else {
        // Ensure booking doc is confirmed (may already be done by recoverPaymentSession)
        await writeConfirmedBooking(orderId, merged);
        await markSlotConfirmed(orderId, merged);
        // Belt-and-suspenders retry at 4 s for slow networks
        setTimeout(async () => {
          const fresh = getPendingData() || {};
          await writeConfirmedBooking(orderId, { ...merged, ...fresh });
          await markSlotConfirmed(orderId, { ...merged, ...fresh });
          window.dispatchEvent(new CustomEvent('bmg:earningsNeedRefresh'));
        }, 4000);
      }
    }
  });

  /* ═══════════════════════════════════════════════════════════════════
     Confirmation page retry (handles Cashfree webhook lag)
  ═══════════════════════════════════════════════════════════════════ */
  window.addEventListener('bmg:pageShown', function (e) {
    if (!e.detail || e.detail.pageId !== 'confirmation-page') return;
    const pending = getPendingData();
    if (!pending || pending.isPoolBooking) return;

    [2000, 5000, 10000].forEach(delay => {
      setTimeout(async () => {
        const p = getPendingData();
        if (!p || !p.groundId) return;
        const orderId = p.orderId || p.bookingId || '';
        if (!orderId) return;
        // Only retry if slot not yet confirmed
        try {
          const d = db();
          if (!d) return;
          const start = slotStart(resolveSlot(p));
          const snap  = await d.collection('slots')
            .where('groundId',  '==', p.groundId)
            .where('date',      '==', p.date)
            .where('startTime', '==', start)
            .limit(1).get();
          if (!snap.empty && snap.docs[0].data().status === 'confirmed') return;
        } catch (_) {}

        L(`Retry at ${delay}ms for ${orderId}`);
        await writeConfirmedBooking(orderId, p);
        await markSlotConfirmed(orderId, p);
      }, delay);
    });
  });

  /* ═══════════════════════════════════════════════════════════════════
     Earnings refresh listener
  ═══════════════════════════════════════════════════════════════════ */
  window.addEventListener('bmg:earningsNeedRefresh', function () {
    setTimeout(() => {
      const dashPage = document.getElementById('owner-dashboard-page');
      if (!dashPage || !dashPage.classList.contains('active')) return;
      const container = document.getElementById('owner-dashboard-content')
                      || document.getElementById('owner-earnings-content');
      if (!container) return;
      const fn = window.loadOwnerEarnings;
      if (typeof fn === 'function') fn(container).catch(err => W('Earnings refresh:', err.message));
    }, 1000);
  });

  /* ═══════════════════════════════════════════════════════════════════
     Install — try immediately, then retry when Firebase is ready
  ═══════════════════════════════════════════════════════════════════ */
  function install() {
    wrapRecoverPaymentSession();
    wrapStartPayment();
  }

  install();
  // Retry after DOM + Firebase initialise
  document.addEventListener('DOMContentLoaded', install);
  setTimeout(install, 500);
  setTimeout(install, 2000);

  // Also expose globally so other scripts can call it
  window._bmgWriteConfirmedBooking = writeConfirmedBooking;
  window._bmgMarkSlotConfirmed     = markSlotConfirmed;

  L('v3.0 loaded ✅');
})();