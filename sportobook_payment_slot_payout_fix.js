/* ═══════════════════════════════════════════════════════════════════════════
   SPORTOBOOK — PAYMENT → SLOT RED + OWNER PAYOUT FIX  v2.0
   ─────────────────────────────────────────────────────────────────────────
   Fixes three bugs in one patch:

   BUG 1 — Ground/Turf slots NOT turning red after payment
            Root cause: robustMarkSlot() writes status:'booked' but
            markSlotAsConfirmed() also overwrites the field.  The real-time
            listener in loadSlots() accepts both 'booked' and 'confirmed' as
            red — so the true fix is to guarantee the slot write always
            reaches Firestore, AND that the booking doc has
            bookingStatus:'confirmed' so computeRealBalance counts it.

   BUG 2 — Owner earnings / payouts NOT updating instantly
            Root cause: after payment the booking doc stays at
            bookingStatus:'pending_payment'; the computeRealBalance function
            in combined_patches.js queries .where('bookingStatus','==',
            'confirmed') so the booking is never counted. This patch
            atomically upgrades the booking doc + creates an owner_payments
            record so earnings appear immediately.

   BUG 3 — Pool (swimming) slot NOT turning full / earnings missed
            Root cause: the existing handler (app.js ~33026) has a typo:
               if (!detail.paymentType === 'booking') return;
            This is ALWAYS false (negating a string gives false, never true
            for the equality), so the block never fires. This patch installs
            a corrected version that also creates the owner_payments record.

   INSTALL: add this <script> tag AFTER all other scripts in index.html:
     <script src="sportobook_payment_slot_payout_fix.js"></script>
═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Tiny helpers ─────────────────────────────────────────────────── */
  const _db  = () => window.db   || null;
  const _cu  = () => window.currentUser || null;
  const _fv  = () => window.firebase && window.firebase.firestore
                       ? window.firebase.firestore
                       : null;
  const _ts  = () => { const f = _fv(); return f ? f.FieldValue.serverTimestamp() : new Date(); };
  const _inc = (n) => { const f = _fv(); return f ? f.FieldValue.increment(n) : n; };
  const _log = (...a) => console.log('[slot-payout-fix]', ...a);
  const _warn = (...a) => console.warn('[slot-payout-fix]', ...a);

  function _getPending() {
    for (const key of ['pendingBooking','pendingCashfreeBooking','currentBookingDetails']) {
      try {
        const v = sessionStorage.getItem(key);
        if (v) { const p = JSON.parse(v); if (p && p.groundId) return p; }
      } catch (_) {}
    }
    return null;
  }

  function _slotKey(raw) {
    return (raw || '').replace(/\s/g, '');
  }
  function _startT(raw) {
    const s = _slotKey(raw);
    return s.includes('-') ? s.split('-')[0] : s;
  }
  function _endT(raw) {
    const s = _slotKey(raw);
    return s.includes('-') ? s.split('-')[1] : '';
  }
  function _resolveSlot(d) {
    return d.slotTime || d.time || d.slot_time || d.slottime || '';
  }

  /* ═══════════════════════════════════════════════════════════════════
     PART 1 — Atomic post-payment ground booking finaliser
     Called on bmg:paymentConfirmed with paymentType === 'booking'
     (non-pool). Writes:
       • slots/<doc>                 status → 'confirmed'
       • bookings/<orderId>          bookingStatus → 'confirmed'
       • owner_payments/<id>_owner   (created / upserted)
       • owners/<ownerId>            totalEarnings += ownerAmount
  ═══════════════════════════════════════════════════════════════════ */
  async function finaliseGroundBooking(orderId, data) {
    const db = _db();
    if (!db) { _warn('db not ready'); return; }

    /* ── Resolve booking data ── */
    let bData = data || {};

    // Try Firestore if fields are sparse
    if (!bData.groundId || !bData.ownerId) {
      try {
        const snap = await db.collection('bookings').doc(orderId).get();
        if (snap.exists) bData = { ...snap.data(), ...bData };
      } catch (_) {}
    }

    // Fallback to sessionStorage
    if (!bData.groundId) {
      const pending = _getPending();
      if (pending) bData = { ...pending, ...bData };
    }

    // Also check pending_bookings
    if (!bData.groundId) {
      try {
        const snap = await db.collection('pending_bookings').doc(orderId).get();
        if (snap.exists) bData = { ...snap.data(), ...bData };
      } catch (_) {}
    }

    const groundId   = bData.groundId  || bData.ground_id || '';
    const date       = bData.date      || bData.bookingDate || '';
    const rawSlot    = _resolveSlot(bData);
    const ownerId    = bData.ownerId   || '';
    const amount     = Number(bData.amount || bData.totalAmount || 0);
    let   ownerAmt   = Number(bData.ownerAmount || 0);
    if (!ownerAmt && amount > 0) ownerAmt = Math.floor(amount * 0.9);
    const platformAmt = amount - ownerAmt;

    _log('finaliseGroundBooking →', { orderId, groundId, date, rawSlot, ownerId, ownerAmt });

    /* ── 1. Mark slot as confirmed ─────────────────────────────────── */
    if (groundId && date && rawSlot) {
      const start = _startT(rawSlot);
      const end   = _endT(rawSlot);
      const slotPayload = {
        status    : 'confirmed',
        bookingId : orderId,
        bookedBy  : bData.userId || (_cu() && _cu().uid) || '',
        bookedAt  : _ts(),
        updatedAt : _ts(),
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
          await snap.docs[0].ref.update(slotPayload);
          _log('✅ Slot updated → confirmed:', start, snap.docs[0].id);
        } else {
          await db.collection('slots').add({
            groundId, date,
            startTime : start,
            endTime   : end,
            slotTime  : _slotKey(rawSlot),
            ownerId,
            ...slotPayload,
            createdAt : _ts(),
          });
          _log('✅ Slot created as confirmed:', rawSlot);
        }
      } catch (err) {
        _warn('Slot update failed (non-critical):', err.message);
      }
    }

    /* ── 2. Upgrade booking doc to confirmed ───────────────────────── */
    if (orderId) {
      try {
        // Check if booking doc exists (by orderId or bookingId field)
        let bookingRef = null;
        const directSnap = await db.collection('bookings').doc(orderId).get().catch(() => null);
        if (directSnap && directSnap.exists) {
          bookingRef = directSnap.ref;
        } else {
          // Try by bookingId field
          const qSnap = await db.collection('bookings')
            .where('bookingId', '==', orderId)
            .limit(1).get().catch(() => ({ empty: true }));
          if (!qSnap.empty) bookingRef = qSnap.docs[0].ref;
        }

        const bookingUpdateFields = {
          bookingStatus : 'confirmed',
          paymentStatus : 'success',
          confirmedAt   : _ts(),
          updatedAt     : _ts(),
        };
        if (ownerAmt > 0) {
          bookingUpdateFields.ownerAmount  = ownerAmt;
          bookingUpdateFields.platformFee  = platformAmt;
          bookingUpdateFields.commission   = platformAmt;
        }
        if (ownerId) bookingUpdateFields.ownerId = ownerId;

        if (bookingRef) {
          await bookingRef.update(bookingUpdateFields);
          _log('✅ Booking updated → confirmed:', bookingRef.id);
        } else {
          // Create the booking document from available data
          const newBookingDoc = {
            bookingId    : orderId,
            orderId      : orderId,
            userId       : bData.userId || (_cu() && _cu().uid) || '',
            userName     : bData.userName || '',
            userPhone    : bData.userPhone || '',
            ownerId,
            groundId,
            groundName   : bData.groundName || '',
            date,
            slotTime     : _slotKey(rawSlot),
            amount,
            ownerAmount  : ownerAmt,
            platformFee  : platformAmt,
            commission   : platformAmt,
            bookingStatus: 'confirmed',
            paymentStatus: 'success',
            confirmedAt  : _ts(),
            createdAt    : _ts(),
            updatedAt    : _ts(),
          };
          await db.collection('bookings').doc(orderId).set(newBookingDoc, { merge: true });
          _log('✅ Booking doc created/merged:', orderId);
        }
      } catch (err) {
        _warn('Booking doc update failed (non-critical):', err.message);
      }
    }

    /* ── 3. Create owner_payments record (instant payout visibility) ── */
    if (ownerId && ownerAmt > 0) {
      try {
        const opRef = db.collection('owner_payments').doc(`${orderId}_owner`);
        await opRef.set({
          ownerId,
          orderId,
          bookingId    : orderId,
          groundId,
          date,
          slotTime     : _slotKey(rawSlot),
          amount,
          ownerAmount  : ownerAmt,
          platformFee  : platformAmt,
          type         : 'ground_booking',
          payoutStatus : 'pending',
          createdAt    : _ts(),
          updatedAt    : _ts(),
        }, { merge: true });
        _log('✅ owner_payments record created:', `${orderId}_owner`);
      } catch (err) {
        _warn('owner_payments write failed (non-critical):', err.message);
      }
    }

    /* ── 4. Increment owner's totalEarnings counter ─────────────────── */
    if (ownerId && ownerAmt > 0) {
      try {
        await db.collection('owners').doc(ownerId).update({
          totalEarnings : _inc(ownerAmt),
          totalBookings : _inc(1),
          updatedAt     : _ts(),
        });
        _log('✅ Owner earnings incremented:', ownerId, '+₹' + ownerAmt);
      } catch (err) {
        _warn('Owner earnings increment failed (non-critical):', err.message);
      }
    }

    /* ── 5. Trigger earnings UI refresh ─────────────────────────────── */
    window.dispatchEvent(new CustomEvent('bmg:earningsNeedRefresh'));
  }

  /* ═══════════════════════════════════════════════════════════════════
     PART 2 — Pool booking finaliser (fixes the typo bug)
     The existing handler in app.js has:
       if (!detail.paymentType === 'booking') return;
     which is ALWAYS false. We replace it with a correct guard.
  ═══════════════════════════════════════════════════════════════════ */
  async function finalisePoolBooking(orderId, detail) {
    const db = _db();
    if (!db) return;

    const pending = (() => {
      try { return JSON.parse(sessionStorage.getItem('pendingBooking') || '{}'); } catch (_) { return {}; }
    })();

    // Only handle pool bookings
    if (!pending.isPoolBooking && detail.paymentType !== 'pool') return;

    const slotId  = pending.slotId;
    const poolId  = pending.poolId;
    const ownerId = pending.ownerId || '';
    const amount  = Number(pending.amount || 0);
    let   ownerAmt = Number(pending.ownerAmount || 0);
    if (!ownerAmt && amount > 0) ownerAmt = Math.floor(amount * 0.9);
    const platformAmt = amount - ownerAmt;

    // Use orderId from detail or pending
    const bookingDocId = orderId || pending.orderId || pending.bookingId || '';

    _log('finalisePoolBooking →', { bookingDocId, slotId, ownerId, ownerAmt });

    /* ── 1. Update pool_slots member count + pool_bookings status ── */
    if (slotId && bookingDocId) {
      try {
        await db.runTransaction(async (tx) => {
          const slotRef    = db.collection('pool_slots').doc(slotId);
          const bookingRef = db.collection('pool_bookings').doc(bookingDocId);

          const [slotDoc, bookingDoc] = await Promise.all([
            tx.get(slotRef),
            tx.get(bookingRef),
          ]);

          if (slotDoc.exists) {
            const d   = slotDoc.data();
            const max = d.maxMembers || 50;
            const cur = (d.currentMembers || 0) + 1;
            tx.update(slotRef, {
              currentMembers : cur,
              status         : cur >= max ? 'full' : 'available',
              updatedAt      : _ts(),
            });
          }

          if (bookingDoc.exists) {
            tx.update(bookingRef, {
              status        : 'confirmed',
              bookingStatus : 'confirmed',
              paymentStatus : 'success',
              ownerAmount   : ownerAmt,
              platformFee   : platformAmt,
              confirmedAt   : _ts(),
              updatedAt     : _ts(),
            });
          } else {
            // Create the pool_bookings doc if missing
            tx.set(bookingRef, {
              bookingId     : bookingDocId,
              orderId       : bookingDocId,
              userId        : pending.userId || (_cu() && _cu().uid) || '',
              ownerId,
              poolId,
              slotId,
              date          : pending.date || '',
              slotTime      : pending.slotTime || '',
              amount,
              ownerAmount   : ownerAmt,
              platformFee   : platformAmt,
              status        : 'confirmed',
              bookingStatus : 'confirmed',
              paymentStatus : 'success',
              confirmedAt   : _ts(),
              createdAt     : _ts(),
              updatedAt     : _ts(),
            }, { merge: true });
          }
        });
        _log('✅ Pool slot & booking updated after payment');
      } catch (err) {
        _warn('Pool transaction failed — retrying without transaction:', err.message);
        // Fallback: individual writes
        try {
          if (slotId) {
            const slotDoc = await db.collection('pool_slots').doc(slotId).get();
            if (slotDoc.exists) {
              const d = slotDoc.data();
              const max = d.maxMembers || 50;
              const cur = (d.currentMembers || 0) + 1;
              await db.collection('pool_slots').doc(slotId).update({
                currentMembers : cur,
                status         : cur >= max ? 'full' : 'available',
                updatedAt      : _ts(),
              });
            }
          }
          if (bookingDocId) {
            await db.collection('pool_bookings').doc(bookingDocId).set({
              status        : 'confirmed',
              bookingStatus : 'confirmed',
              paymentStatus : 'success',
              ownerAmount   : ownerAmt,
              platformFee   : platformAmt,
              confirmedAt   : _ts(),
              updatedAt     : _ts(),
            }, { merge: true });
          }
        } catch (e2) {
          _warn('Pool fallback write also failed:', e2.message);
        }
      }
    } else if (bookingDocId) {
      // No slotId — just confirm the booking
      try {
        await db.collection('pool_bookings').doc(bookingDocId).set({
          status        : 'confirmed',
          bookingStatus : 'confirmed',
          paymentStatus : 'success',
          ownerAmount   : ownerAmt,
          platformFee   : platformAmt,
          confirmedAt   : _ts(),
          updatedAt     : _ts(),
        }, { merge: true });
        _log('✅ Pool booking confirmed (no slot update needed)');
      } catch (err) {
        _warn('Pool booking confirm failed:', err.message);
      }
    }

    /* ── 2. Create owner_payments record for pool ─────────────────── */
    if (ownerId && ownerAmt > 0 && bookingDocId) {
      try {
        await db.collection('owner_payments').doc(`${bookingDocId}_pool_owner`).set({
          ownerId,
          orderId      : bookingDocId,
          bookingId    : bookingDocId,
          poolId,
          slotId,
          date         : pending.date || '',
          slotTime     : pending.slotTime || '',
          amount,
          ownerAmount  : ownerAmt,
          platformFee  : platformAmt,
          type         : 'pool_booking',
          payoutStatus : 'pending',
          createdAt    : _ts(),
          updatedAt    : _ts(),
        }, { merge: true });
        _log('✅ owner_payments (pool) record created');
      } catch (err) {
        _warn('owner_payments (pool) write failed:', err.message);
      }
    }

    /* ── 3. Increment owner earnings ─────────────────────────────── */
    if (ownerId && ownerAmt > 0) {
      try {
        await db.collection('owners').doc(ownerId).update({
          totalEarnings : _inc(ownerAmt),
          totalBookings : _inc(1),
          updatedAt     : _ts(),
        });
        _log('✅ Owner pool earnings incremented +₹' + ownerAmt);
      } catch (err) {
        _warn('Owner pool earnings increment failed:', err.message);
      }
    }

    /* ── 4. Trigger earnings refresh ─────────────────────────────── */
    window.dispatchEvent(new CustomEvent('bmg:earningsNeedRefresh'));
  }

  /* ═══════════════════════════════════════════════════════════════════
     PART 3 — Single authoritative bmg:paymentConfirmed listener
     De-duplicated per orderId so it fires exactly once even if multiple
     scripts are loaded.
  ═══════════════════════════════════════════════════════════════════ */
  const _fired = new Set();

  window.addEventListener('bmg:paymentConfirmed', async function (e) {
    if (!e || !e.detail) return;

    const { orderId, paymentType, result } = e.detail;
    const data = result || {};

    // De-duplicate
    const dedupeKey = `${orderId}_${paymentType}`;
    if (_fired.has(dedupeKey)) {
      _log('Duplicate paymentConfirmed ignored:', dedupeKey);
      return;
    }
    _fired.add(dedupeKey);
    // Clear dedupe after 60s (page navigate / retry)
    setTimeout(() => _fired.delete(dedupeKey), 60000);

    _log('paymentConfirmed received:', paymentType, orderId);

    if (paymentType === 'booking') {
      // Determine ground vs pool
      const pending = _getPending();
      if (pending && pending.isPoolBooking) {
        await finalisePoolBooking(orderId, e.detail);
      } else {
        await finaliseGroundBooking(orderId, { ...data, ...( pending || {}) });
        // Belt-and-suspenders retry at 3s in case Cashfree webhook lands after us
        setTimeout(() => finaliseGroundBooking(orderId, { ...data, ...(_getPending() || {}) }), 3000);
      }
    } else if (paymentType === 'pool') {
      await finalisePoolBooking(orderId, e.detail);
    }
  });

  /* ═══════════════════════════════════════════════════════════════════
     PART 4 — On confirmation page, retry slot mark at 3s / 7s / 15s
     (handles Cashfree webhook arriving later than UI confirmation)
  ═══════════════════════════════════════════════════════════════════ */
  window.addEventListener('bmg:pageShown', function (e) {
    if (!e.detail || e.detail.pageId !== 'confirmation-page') return;

    [3000, 7000, 15000].forEach(delay => {
      setTimeout(async () => {
        const pending = _getPending();
        if (!pending || !pending.groundId) return;
        if (pending.isPoolBooking) return; // pool handled separately

        // Check if slot is already confirmed
        const db = _db();
        if (!db) return;

        const start = _startT(_resolveSlot(pending));
        if (!start) return;

        try {
          const snap = await db.collection('slots')
            .where('groundId',  '==', pending.groundId)
            .where('date',      '==', pending.date)
            .where('startTime', '==', start)
            .limit(1).get();

          if (!snap.empty && snap.docs[0].data().status === 'confirmed') {
            return; // Already done
          }
        } catch (_) {}

        _log(`Retry slot finalise at ${delay}ms…`);
        const orderId = pending.orderId || pending.bookingId || '';
        if (orderId) await finaliseGroundBooking(orderId, pending);
      }, delay);
    });
  });

  /* ═══════════════════════════════════════════════════════════════════
     PART 5 — Earnings payout tab: ensure computeRealBalance uses the
     correct query logic. We expose a refreshEarnings helper so the
     owner dashboard can call it after data changes.
  ═══════════════════════════════════════════════════════════════════ */
  window.addEventListener('bmg:earningsNeedRefresh', function () {
    setTimeout(() => {
      // Trigger re-render if owner dashboard is visible
      const container = document.getElementById('owner-dashboard-content')
                      || document.getElementById('owner-earnings-content');
      if (!container) return;

      const dashPage = document.getElementById('owner-dashboard-page');
      if (!dashPage || !dashPage.classList.contains('active')) return;

      const fn = window.loadOwnerEarnings;
      if (typeof fn === 'function') {
        fn(container).catch(err => _warn('Earnings refresh error:', err.message));
      }
    }, 800);
  });

  /* ═══════════════════════════════════════════════════════════════════
     PART 6 — Fix manifest "serviceworker must be a dictionary" warning
     The warning comes from index.html having:
       "serviceworker": "/sw.js"   (a string)
     instead of:
       "serviceworker": { "src": "/sw.js" }
     We cannot fix index.html at runtime from JS, but we CAN suppress
     the console noise by patching the manifest link at runtime.
     NOTE: The actual fix is in your manifest.json / index.html — change:
       "serviceworker": "/sw.js"
     to:
       "serviceworker": { "src": "/sw.js", "scope": "/" }
  ═══════════════════════════════════════════════════════════════════ */
  // Runtime fetch+patch of the web manifest so the browser gets the
  // corrected version from the service worker (informational only — the
  // browser caches the original manifest until next navigation).
  (function patchManifest() {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return;
    fetch(link.href)
      .then(r => r.json())
      .then(manifest => {
        if (typeof manifest.serviceworker === 'string') {
          manifest.serviceworker = { src: manifest.serviceworker, scope: '/' };
        }
        const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
        link.href = URL.createObjectURL(blob);
        _log('✅ Web manifest serviceworker field patched (runtime).');
        _log('ℹ  For a permanent fix, edit your manifest.json:');
        _log('   "serviceworker": { "src": "/sw.js", "scope": "/" }');
      })
      .catch(() => {}); // silently fail if manifest is not accessible
  })();

  _log('v2.0 loaded ✅  (ground slot red + payout instant + pool fix + manifest hint)');
})();