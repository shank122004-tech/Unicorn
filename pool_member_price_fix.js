/* ═══════════════════════════════════════════════════════════════
   pool_member_price_fix.js   v1.0
   ─────────────────────────────────────────────────────────────
   Add in index.html AFTER bmg_fixes_combined.js:
     <script src="pool_member_price_fix.js"></script>

   WHAT THIS FIXES:
   The payment screen shows only the single-person price even when
   the user has added multiple members in the pool sticky bar.

   ROOT CAUSES (3):
   1. The fully-replaced _safeHandlePoolBookNow (in bmg_fixes_combined.js)
      always sets  amount = slot.price  (per-person price only).
      It completely ignores  window._poolMemberCount  and  slot._totalAmount.

   2. The sessionStorage interceptor in bmg_fixes_combined.js (Step A)
      correctly reads  window._poolMemberCount  but only kicks in when
      sessionStorage.setItem is called.  However because the v6 "full
      replacement" handler builds  bookingDetails  with  amount = slot.price
      BEFORE calling sessionStorage.setItem, the interceptor receives the
      wrong per-person amount and multiplies it correctly — but then
      setupPayButton() was already called with the old (wrong) safeDetails
      object a few lines earlier, so Cashfree receives the wrong amount.

   3. The Step B listener (bmg:pageShown → booking-page) fires after a
      50 ms delay and correctly re-populates the DOM fields.  But if the
      user's device is slow, setupPayButton may also be re-called by other
      listeners with the stale safeDetails from sessionStorage (already
      corrected by the interceptor at that point — so this part is actually
      OK, but only if Step A ran before setupPayButton).  On fast devices
      the ordering is unreliable.

   THE FIX:
   • Re-wrap window.handlePoolBookNow (the global exposed by the v6 patch)
     so the  amount  passed to bookingDetails, sessionStorage, Firestore,
     setupPayButton and the DOM summary all use  pricePerMember × memberCount.
   • Also directly patch the inner _safeHandlePoolBookNow path by wrapping
     the pool-book-now-btn click at the right moment.
   • Guarantee setupPayButton is always called with the corrected object.
═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── Utility: wait for a global function to exist ── */
  function waitFor(name, cb, attempt) {
    attempt = attempt || 0;
    if (typeof window[name] === 'function') { cb(); return; }
    if (attempt > 120) { console.warn('[pool-price-fix] Timeout waiting for', name); return; }
    setTimeout(function () { waitFor(name, cb, attempt + 1); }, 100);
  }

  /* ── Core price calculator (same logic as app.js calcPoolPrice) ── */
  function getCorrectAmount() {
    var count  = window._poolMemberCount || 1;
    var slot   = window.selectedPoolSlot;
    var perPer = slot ? (slot.price || 0) : 0;
    return { count: count, perPer: perPer, total: perPer * count };
  }

  /* ══════════════════════════════════════════════════════════════
     PATCH 1 — Wrap window.handlePoolBookNow
     This wraps whatever function is currently assigned (the v6
     full-replacement) so the slot object always carries the correct
     _memberCount and _totalAmount before the inner logic runs.
  ══════════════════════════════════════════════════════════════ */
  function applyHandlerPatch() {
    var orig = window.handlePoolBookNow;
    if (!orig || orig._pricePatchedV1) return;

    window.handlePoolBookNow = async function () {
      /* Bake member count into selectedPoolSlot before original runs */
      var p    = getCorrectAmount();
      var slot = window.selectedPoolSlot;
      if (slot) {
        slot._memberCount  = p.count;
        slot._totalAmount  = p.total;
        slot.pricePerMember = p.perPer;
        window.selectedPoolSlot = slot;
      }
      window._poolMemberCount = p.count; // ensure global is current
      return orig.apply(this, arguments);
    };
    window.handlePoolBookNow._pricePatchedV1 = true;
    console.log('[pool-price-fix] handlePoolBookNow wrapped');
  }

  /* ══════════════════════════════════════════════════════════════
     PATCH 2 — Intercept sessionStorage.setItem
     Ensures pricePerMember is saved correctly so the Step B
     DOM refresh reads the right value.
     (Replaces the v6 interceptor to avoid double-patching.)
  ══════════════════════════════════════════════════════════════ */
  (function patchSessionStorage() {
    /* Only install once — check for our marker */
    if (sessionStorage._pricePatchedV1) return;

    var _orig = sessionStorage.setItem.bind(sessionStorage);
    sessionStorage.setItem = function (key, value) {
      if ((key === 'pendingBooking' || key === 'pendingCashfreeBooking') && value) {
        try {
          var obj = JSON.parse(value);
          if (obj && obj.isPoolBooking) {
            var count  = window._poolMemberCount || 1;
            /* pricePerMember: use slot.price (per-person), or stored value,
               or fall back to amount (which equals slot.price at this point) */
            var perPer = (window.selectedPoolSlot && window.selectedPoolSlot.price)
                          || obj.pricePerMember
                          || obj.amount
                          || 0;
            var total  = perPer * count;

            obj.pricePerMember = perPer;
            obj.memberCount    = count;
            obj.amount         = total;
            obj.originalAmount = total;
            obj.ownerAmount    = Math.round(total * 0.9);
            obj.platformAmount = Math.round(total * 0.1);
            obj.commission     = Math.round(total * 0.1);

            value = JSON.stringify(obj);
            console.log('[pool-price-fix] sessionStorage patched →',
              count, 'members × ₹' + perPer + ' = ₹' + total);
          }
        } catch (e) { /* safe */ }
      }
      return _orig(key, value);
    };
    sessionStorage._pricePatchedV1 = true;
    console.log('[pool-price-fix] sessionStorage.setItem interceptor installed');
  })();

  /* ══════════════════════════════════════════════════════════════
     PATCH 3 — booking-page DOM refresh + setupPayButton re-call
     Runs when booking-page is shown, ensures all visible price
     fields AND the Cashfree pay button reflect the correct total.
  ══════════════════════════════════════════════════════════════ */
  window.addEventListener('bmg:pageShown', function (e) {
    if (!e.detail || e.detail.pageId !== 'booking-page') return;

    /* Small delay so original safe() calls run first, then we overwrite */
    setTimeout(function () {
      var raw = null;
      try {
        raw = JSON.parse(
          sessionStorage.getItem('pendingBooking') ||
          sessionStorage.getItem('pendingCashfreeBooking') ||
          'null'
        );
      } catch (_) {}
      if (!raw || !raw.isPoolBooking) return;

      var count    = raw.memberCount    || 1;
      var perPer   = raw.pricePerMember || 0;
      var total    = raw.amount         || (perPer * count);
      var platform = raw.platformAmount || 0;

      function _s(id, val) {
        var el = document.getElementById(id);
        if (el) el.textContent = val;
      }

      /* ── Update every price field in the booking summary ── */
      _s('booking-amount', '₹' + total);
      _s('payment-amount', '₹' + total);
      _s('platform-fee',   '₹' + platform);
      _s('final-amount',   '₹' + total);

      /* ── Update Cashfree pay button with corrected amount ── */
      if (typeof window.setupPayButton === 'function') {
        try { window.setupPayButton(raw); } catch (_) {}
      }

      /* ── Inject / refresh the members breakdown block ── */
      var summaryCard = document.querySelector('#booking-page .booking-summary-card');
      if (!summaryCard) return;

      summaryCard.querySelectorAll('.bmg-pool-summary-members-row').forEach(function (el) {
        el.remove();
      });

      /* Only show breakdown if multiple members */
      if (count < 1) return;

      var chips = '';
      for (var m = 1; m <= count; m++) {
        chips +=
          '<span class="bmg-pool-summary-chip">' +
            '<span class="bmg-pool-summary-chip-num">' + m + '</span>' +
            'Member ' + m +
          '</span>';
      }

      var memberBlock = document.createElement('div');
      memberBlock.className = 'bmg-pool-summary-members-row';
      memberBlock.innerHTML =
        '<div class="bmg-pool-summary-sep"></div>' +

        '<div class="bmg-pool-summary-badge-row">' +
          '<span class="bmg-pool-summary-type-badge">🏊 Pool Booking</span>' +
          '<span class="bmg-pool-summary-member-badge">' +
            '<i class="fas fa-users" style="font-size:10px;margin-right:3px"></i>' +
            count + ' Member' + (count > 1 ? 's' : '') +
          '</span>' +
        '</div>' +

        (count > 1
          ? '<div class="bmg-pool-summary-breakdown">' +
              '<div class="bmg-pool-summary-breakdown-row">' +
                '<span>Price per person</span>' +
                '<span>₹' + perPer + '</span>' +
              '</div>' +
              '<div class="bmg-pool-summary-breakdown-row">' +
                '<span>Members</span>' +
                '<span>× ' + count + '</span>' +
              '</div>' +
              '<div class="bmg-pool-summary-breakdown-row bmg-pool-summary-breakdown-total">' +
                '<span>Total</span>' +
                '<span style="font-weight:800;color:#0f1f5c">₹' + total + '</span>' +
              '</div>' +
            '</div>'
          : '') +

        '<div class="bmg-pool-summary-chips">' + chips + '</div>';

      var hr = summaryCard.querySelector('hr');
      if (hr) {
        summaryCard.insertBefore(memberBlock, hr);
      } else {
        summaryCard.appendChild(memberBlock);
      }

      console.log('[pool-price-fix] booking-page DOM refreshed →',
        count, '× ₹' + perPer + ' = ₹' + total);

    }, 80); /* 80 ms — after original handler's safe() calls at 50 ms */
  });

  /* ══════════════════════════════════════════════════════════════
     PATCH 4 — Wire pool-book-now-btn directly after pool-page shown
     Belt-and-suspenders: ensures _poolMemberCount is baked into
     selectedPoolSlot even if the handlePoolBookNow wrapper somehow
     isn't the one that fires (e.g. button was cloned before patch).
  ══════════════════════════════════════════════════════════════ */
  window.addEventListener('bmg:pageShown', function (e) {
    if (!e.detail || e.detail.pageId !== 'pool-page') return;
    setTimeout(function () {
      var btn = document.getElementById('pool-book-now-btn');
      if (!btn || btn._pricePatchedV1) return;
      var fresh = btn.cloneNode(true);
      btn.parentNode.replaceChild(fresh, btn);
      fresh._pricePatchedV1 = true;
      fresh.addEventListener('click', function () {
        var p    = getCorrectAmount();
        var slot = window.selectedPoolSlot;
        if (slot) {
          slot._memberCount   = p.count;
          slot._totalAmount   = p.total;
          slot.pricePerMember = p.perPer;
          window.selectedPoolSlot = slot;
        }
        window._poolMemberCount = p.count;
        if (typeof window.handlePoolBookNow === 'function') {
          window.handlePoolBookNow();
        }
      });
      console.log('[pool-price-fix] pool-book-now-btn re-wired');
    }, 150);
  });

  /* ── Apply handler patch as soon as handlePoolBookNow is available ── */
  waitFor('handlePoolBookNow', applyHandlerPatch);

  console.log('[pool-price-fix v1.0] Loaded');
})();