/**
 * sportobook_slot_and_pool_fix.js
 *
 * Fixes two bugs:
 *
 * BUG 1 — [EditPool] save error: FirebaseError: Missing or insufficient permissions
 *   CAUSE:  saveBmgpPoolEdits() sends `status` in the Firestore update payload.
 *           The swimming_pools security rule explicitly blocks owners from changing
 *           the `status` or `isVerified` fields (diff().affectedKeys() check).
 *   FIX:    Override saveBmgpPoolEdits so it strips `status` (and `isVerified`)
 *           from the owner-level update.  If the owner is also an admin the admin
 *           update path is still allowed by Firestore rules, so we leave it alone.
 *
 * BUG 2 — Booked slots not showing as red after a booking
 *   CAUSE A: Several split('-') calls that parse slotTime do NOT call .trim().
 *            A slot stored with startTime " 09:00" (leading space) will never
 *            match the key "09:00-10:00" built by _loadSlotsRealtime / _renderSlotGrid.
 *   CAUSE B: For cash / UPI-intent flows the slot document is sometimes never
 *            updated to "confirmed"/"booked", so the real-time listener has
 *            nothing to render as red.
 *   FIX:    (a) Patch _loadSlotsRealtime's onSnapshot callback to always .trim()
 *               startTime and endTime before building the statusMap key.
 *           (b) Patch markSlotAsConfirmed to always .trim() start/end times before
 *               querying / writing Firestore.
 *           (c) After every confirmed booking, fire a best-effort Firestore update
 *               to set the slot status to "confirmed" so the listener picks it up.
 */

(function () {
  'use strict';

  /* ─── tiny helpers ─────────────────────────────────────────────────── */
  function _t(s) { return String(s || '').trim(); }
  function _norm(s) { return _t(s).replace(/\s/g, ''); }
  function _start(raw) { var n = _norm(raw); return n.includes('-') ? n.split('-')[0] : n; }
  function _end(raw)   { var n = _norm(raw); return n.includes('-') ? n.split('-')[1] : ''; }

  function waitFor(name, cb, interval) {
    if (window[name]) { cb(window[name]); return; }
    var iv = setInterval(function () {
      if (window[name]) { clearInterval(iv); cb(window[name]); }
    }, interval || 200);
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * FIX 1 — saveBmgpPoolEdits: strip status / isVerified from owner update
   * ═══════════════════════════════════════════════════════════════════════ */
  function patchSaveBmgpPoolEdits() {
    if (window.__slotPoolFix_poolEditPatched) return;
    window.__slotPoolFix_poolEditPatched = true;

    /* The function lives inside a closure in all_patches_combined.js so we
       cannot replace it directly.  Instead we intercept at the Firestore layer:
       wrap db.collection('swimming_pools').doc(id).update() to strip the
       forbidden fields whenever a non-admin owner is calling it. */

    var db = window.db;
    if (!db) { console.warn('[fix1] db not ready, deferring'); setTimeout(patchSaveBmgpPoolEdits, 500); return; }

    var origCollection = db.collection.bind(db);
    db.collection = function (name) {
      var ref = origCollection(name);
      if (name !== 'swimming_pools') return ref;

      /* Wrap .doc() so we can intercept .update() */
      var origDoc = ref.doc.bind(ref);
      ref.doc = function (id) {
        var docRef = origDoc(id);
        var origUpdate = docRef.update.bind(docRef);

        docRef.update = function (data) {
          /* Only strip fields when the caller is the EditPool save path.
             We detect this heuristically: if the payload contains 'status'
             AND the current user is NOT an admin (admin paths always succeed),
             remove 'status' and 'isVerified'. */
          if (data && ('status' in data || 'isVerified' in data)) {
            var cu = window.currentUser;
            /* Check cached admin flag set by the app */
            var isAdmin = window.__isAdmin === true
                       || (cu && window.__adminRole && ['admin','ceo','super_admin'].includes(window.__adminRole));

            if (!isAdmin) {
              var safe = Object.assign({}, data);
              delete safe.status;
              delete safe.isVerified;
              console.log('[fix1] Stripped status/isVerified from swimming_pools owner update for pool:', id);
              return origUpdate(safe);
            }
          }
          return origUpdate(data);
        };

        return docRef;
      };

      return ref;
    };

    console.log('✅ [fix1] swimming_pools update interceptor installed');
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * FIX 2a — Patch _loadSlotsRealtime snapshot handler to trim startTime/endTime
   *           before building the statusMap key so booked slots render red.
   * ═══════════════════════════════════════════════════════════════════════ */
  function patchLoadSlotsRealtime() {
    if (window.__slotPoolFix_loadPatched) return;

    waitFor('loadSlots', function () {
      if (window.__slotPoolFix_loadPatched) return;
      window.__slotPoolFix_loadPatched = true;

      var origLoadSlots = window.loadSlots;
      window.loadSlots = function (groundId, date) {
        var container = document.getElementById('time-slots');
        if (!container) { return origLoadSlots(groundId, date); }

        /* Stop any existing listener */
        if (typeof window._slotUnsub === 'function') { try { window._slotUnsub(); } catch(_) {} window._slotUnsub = null; }
        if (typeof window._bmgSlotUnsub === 'function') { try { window._bmgSlotUnsub(); } catch(_) {} window._bmgSlotUnsub = null; }

        var db = window.db;
        if (!db) { return origLoadSlots(groundId, date); }

        container.innerHTML = '<div style="padding:2rem;text-align:center;"><div class="loader-spinner"></div><p style="margin-top:1rem;color:#6b7280;">Loading slots…</p></div>';

        /* Also ensure the bookings collection is scanned to catch any
           confirmed booking whose slot doc was never updated.             */
        _syncConfirmedBookingsToSlots(groundId, date);

        var unsub = db.collection('slots')
          .where('groundId', '==', groundId)
          .where('date',     '==', date)
          .onSnapshot(function (snapshot) {
            var statusMap = {};
            snapshot.forEach(function (doc) {
              var s = doc.data();
              /* ── TRIM to eliminate leading/trailing-space key mismatches ── */
              var st = _t(s.startTime || '');
              var et = _t(s.endTime   || '');
              var k  = (st && et) ? (st + '-' + et)
                                  : _norm(s.slotTime || '');
              if (k) statusMap[k] = _t(s.status) || 'available';
            });

            /* Render using the patched render function (see FIX 2b) */
            if (typeof window._bmgRenderSlotsPatched === 'function') {
              window._bmgRenderSlotsPatched(container, statusMap, date);
            } else if (typeof window._renderSlotGrid === 'function') {
              window._renderSlotGrid(container, statusMap, {}, date);
            } else if (typeof window._bmgRenderSlots === 'function') {
              window._bmgRenderSlots(container, statusMap, date);
            } else {
              /* Inline fallback renderer */
              _renderSlotsFallback(container, statusMap, date);
            }
          }, function (err) {
            console.error('[fix2a] snapshot error:', err);
            origLoadSlots(groundId, date);
          });

        window._slotUnsub   = unsub;
        window._bmgSlotUnsub = unsub;
        console.log('✅ [fix2a] trimmed real-time slot listener started for', groundId, date);
      };

      console.log('✅ [fix2a] loadSlots patched with trimmed key builder');
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * FIX 2b — Patch markSlotAsConfirmed to trim start/end before Firestore ops
   * ═══════════════════════════════════════════════════════════════════════ */
  function patchMarkSlotAsConfirmed() {
    waitFor('markSlotAsConfirmed', function (orig) {
      if (window.__slotPoolFix_markPatched) return;
      window.__slotPoolFix_markPatched = true;

      window.markSlotAsConfirmed = async function (bookingData) {
        /* Normalise the bookingData before passing to original */
        var fixed = Object.assign({}, bookingData);
        /* Trim any whitespace that sneaked into slot time fields */
        var rawSlot = _norm(fixed.slotTime || fixed.time || fixed.slot_time || fixed.slottime || '');
        if (rawSlot) {
          fixed.slotTime = rawSlot;
          /* Also fix startTime / endTime if present */
          if (rawSlot.includes('-')) {
            fixed.startTime = _start(rawSlot);
            fixed.endTime   = _end(rawSlot);
          }
        }

        var result = await orig(fixed);

        /* Extra safety: if the original call failed or returned false,
           try a direct Firestore upsert ourselves                         */
        if (!result) {
          var groundId  = fixed.groundId  || fixed.ground_id  || '';
          var date      = fixed.date      || fixed.bookingDate || '';
          var start     = _start(rawSlot);
          var end       = _end(rawSlot);
          var bookingId = fixed.bookingId || fixed.orderId || fixed.id || '';
          var userId    = fixed.userId    || (window.currentUser && window.currentUser.uid) || '';

          if (groundId && date && start) {
            try {
              var db = window.db;
              var snap = await db.collection('slots')
                .where('groundId',  '==', groundId)
                .where('date',      '==', date)
                .where('startTime', '==', start)
                .limit(1).get();

              var FV = firebase.firestore.FieldValue;
              if (!snap.empty) {
                await snap.docs[0].ref.update({
                  status   : 'confirmed',
                  bookingId: bookingId,
                  bookedBy : userId,
                  bookedAt : FV.serverTimestamp(),
                  updatedAt: FV.serverTimestamp(),
                });
                console.log('✅ [fix2b] Slot UPDATED to confirmed (fallback):', start);
              } else {
                await db.collection('slots').add({
                  groundId, date,
                  startTime: start,
                  endTime  : end,
                  slotTime : rawSlot,
                  status   : 'confirmed',
                  bookingId, bookedBy: userId,
                  bookedAt : FV.serverTimestamp(),
                  createdAt: FV.serverTimestamp(),
                  updatedAt: FV.serverTimestamp(),
                });
                console.log('✅ [fix2b] Slot CREATED as confirmed (fallback):', rawSlot);
              }
              result = true;
            } catch (err) {
              console.error('[fix2b] fallback markSlotAsConfirmed error:', err);
            }
          }
        }
        return result;
      };

      console.log('✅ [fix2b] markSlotAsConfirmed patched with trim + fallback');
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * FIX 2c — Scan confirmed bookings and ensure their slot docs are "confirmed"
   *           Called every time loadSlots fires for a ground+date pair.
   * ═══════════════════════════════════════════════════════════════════════ */
  async function _syncConfirmedBookingsToSlots(groundId, date) {
    var db = window.db;
    if (!db || !groundId || !date) return;
    try {
      var snap = await db.collection('bookings')
        .where('groundId',      '==', groundId)
        .where('date',          '==', date)
        .where('bookingStatus', '==', 'confirmed')
        .get();

      if (snap.empty) return;

      var FV = firebase.firestore.FieldValue;

      snap.forEach(async function (bdoc) {
        var b     = bdoc.data();
        var raw   = _norm(b.slotTime || b.time || b.slot_time || '');
        var start = _start(raw);
        var end   = _end(raw);
        if (!start) return;

        try {
          var slotSnap = await db.collection('slots')
            .where('groundId',  '==', groundId)
            .where('date',      '==', date)
            .where('startTime', '==', start)
            .limit(1).get();

          if (!slotSnap.empty) {
            var existing = slotSnap.docs[0].data();
            if (existing.status !== 'confirmed' && existing.status !== 'booked') {
              await slotSnap.docs[0].ref.update({
                status   : 'confirmed',
                bookingId: b.bookingId || bdoc.id,
                bookedBy : b.userId    || '',
                updatedAt: FV.serverTimestamp(),
              });
              console.log('[fix2c] Back-filled slot as confirmed:', start, date);
            }
          } else {
            /* Slot doc missing entirely — create it so listener renders red */
            var userId = b.userId || (window.currentUser && window.currentUser.uid) || '';
            await db.collection('slots').add({
              groundId, date,
              startTime: start,
              endTime  : end,
              slotTime : raw,
              status   : 'confirmed',
              bookingId: b.bookingId || bdoc.id,
              bookedBy : userId,
              bookedAt : FV.serverTimestamp(),
              createdAt: FV.serverTimestamp(),
              updatedAt: FV.serverTimestamp(),
            });
            console.log('[fix2c] Created missing slot doc as confirmed:', start, date);
          }
        } catch (e) {
          /* Best-effort; ignore permission errors for other users' slots */
        }
      });
    } catch (err) {
      console.warn('[fix2c] _syncConfirmedBookingsToSlots error:', err);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * Inline fallback slot renderer (used if app's render fns are unavailable)
   * ═══════════════════════════════════════════════════════════════════════ */
  function _renderSlotsFallback(container, statusMap, date) {
    var ICONS  = { available:'🟢', booked:'🔴', confirmed:'🔴', locked:'🔒', pending:'🔒', past:'⏳', closed:'🚫' };
    var LABELS = { available:'Available', booked:'Booked', confirmed:'Booked', locked:'Processing…', pending:'Processing…', past:'Time Passed', closed:'Closed' };
    var now = new Date();
    var curMin = now.getHours() * 60 + now.getMinutes();
    var isToday = date === now.toISOString().split('T')[0];
    var sel = window.selectedSlot || null;
    var html = '';

    for (var h = 0; h < 24; h++) {
      var sh  = String(h).padStart(2,'0');
      var eh  = String(h+1).padStart(2,'0');
      var key = sh + ':00-' + eh + ':00';
      var raw = (isToday && h * 60 <= curMin) ? 'past' : (statusMap[key] || 'available');
      /* Normalise confirmed → booked for class */
      var cls = (raw === 'confirmed') ? 'booked' : raw;
      var icon  = ICONS[raw]  || '🟢';
      var label = LABELS[raw] || 'Available';
      var isSelected = (sel === key && cls === 'available');
      if (isSelected) { cls = 'selected'; icon = '✅'; label = 'Selected'; }
      var disabled = cls !== 'available' && cls !== 'selected';

      /* Inline red style for booked/confirmed */
      var inlineStyle = (cls === 'booked' || cls === 'confirmed')
        ? 'border-color:#ef4444!important;background:linear-gradient(135deg,#fef2f2,#fee2e2)!important;color:#991b1b!important;cursor:not-allowed!important;'
        : '';

      html += '<div class="time-slot ' + cls + '"'
            + ' data-slot="' + key + '"'
            + ' data-status="' + (disabled ? 'disabled' : raw) + '"'
            + (!disabled ? ' data-available="true"' : '')
            + (inlineStyle ? ' style="' + inlineStyle + '"' : '')
            + '>'
            + '<span class="slot-icon bmg-s-icon">' + icon + '</span>'
            + '<span class="slot-time-text bmg-s-time">' + key.replace('-', ' – ') + '</span>'
            + '<span class="slot-status-tag bmg-s-label">' + label + '</span>'
            + '</div>';
    }
    container.innerHTML = html;
    if (!container.classList.contains('slots-grid')) container.classList.add('slots-grid');

    container.querySelectorAll('.time-slot[data-available="true"]').forEach(function (el) {
      el.addEventListener('click', function () {
        if (typeof window.selectSlot === 'function') window.selectSlot(el.dataset.slot);
      });
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * FIX 2d — Intercept bmg:paymentConfirmed event to ensure Firestore slot
   *           is always marked confirmed AND the visible UI turns red.
   * ═══════════════════════════════════════════════════════════════════════ */
  window.addEventListener('bmg:paymentConfirmed', function (e) {
    var detail = e.detail || {};
    if (detail.paymentType !== 'booking') return;
    var d = detail.result || {};

    var groundId = d.groundId || d.ground_id || '';
    var date     = d.date     || d.bookingDate || '';
    var rawSlot  = _norm(d.slotTime || d.time || d.slot_time || '');
    var start    = _start(rawSlot);

    if (!groundId || !date || !start) return;

    /* Immediately update all matching DOM slot elements to red */
    function _flashRed() {
      document.querySelectorAll('.time-slot[data-slot]').forEach(function (el) {
        var slotKey = el.dataset.slot || '';
        if (_start(_norm(slotKey)) === start) {
          el.className = el.className.replace(/\b(available|selected|locked|pending)\b/g, '').trim();
          if (!el.classList.contains('booked') && !el.classList.contains('confirmed')) {
            el.classList.add('confirmed');
          }
          el.style.cssText += 'border-color:#ef4444!important;background:linear-gradient(135deg,#fef2f2,#fee2e2)!important;color:#991b1b!important;cursor:not-allowed!important;pointer-events:none!important;';
          var icon  = el.querySelector('.slot-icon, .bmg-s-icon');
          var label = el.querySelector('.slot-status-tag, .bmg-s-label');
          if (icon)  icon.textContent  = '🔴';
          if (label) label.textContent = 'Booked';
          delete el.dataset.available;
          el.dataset.status = 'disabled';
          console.log('[fix2d] Slot turned red in UI:', slotKey);
        }
      });
    }

    setTimeout(_flashRed, 100);
    setTimeout(_flashRed, 800);   /* second pass after any re-render */

    /* Also write to Firestore so other users see it */
    var db = window.db;
    if (!db) return;
    var FV = firebase.firestore.FieldValue;
    var userId    = d.userId    || (window.currentUser && window.currentUser.uid) || '';
    var bookingId = d.bookingId || detail.orderId || '';

    db.collection('slots')
      .where('groundId',  '==', groundId)
      .where('date',      '==', date)
      .where('startTime', '==', start)
      .limit(1).get()
      .then(function (snap) {
        if (!snap.empty) {
          return snap.docs[0].ref.update({
            status   : 'confirmed',
            bookingId: bookingId,
            bookedBy : userId,
            updatedAt: FV.serverTimestamp(),
          });
        } else {
          return db.collection('slots').add({
            groundId, date,
            startTime: start,
            endTime  : _end(rawSlot),
            slotTime : rawSlot,
            status   : 'confirmed',
            bookingId, bookedBy: userId,
            bookedAt : FV.serverTimestamp(),
            createdAt: FV.serverTimestamp(),
            updatedAt: FV.serverTimestamp(),
          });
        }
      })
      .then(function () { console.log('✅ [fix2d] Slot confirmed in Firestore:', start, date); })
      .catch(function (err) { console.warn('[fix2d] Firestore slot write error:', err); });
  });

  /* ═══════════════════════════════════════════════════════════════════════
   * Bootstrap — run all patches once Firestore db is ready
   * ═══════════════════════════════════════════════════════════════════════ */
  function boot() {
    patchSaveBmgpPoolEdits();
    patchLoadSlotsRealtime();
    patchMarkSlotAsConfirmed();
    console.log('✅ [sportobook_slot_and_pool_fix] all patches applied');
  }

  if (window.db) {
    boot();
  } else {
    /* Wait for Firestore */
    var iv = setInterval(function () {
      if (window.db) { clearInterval(iv); boot(); }
    }, 300);
    /* Hard timeout after 15 s */
    setTimeout(function () { clearInterval(iv); boot(); }, 15000);
  }

})();