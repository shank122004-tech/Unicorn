/**
 * bmg_swimming_pool_fix.js  — v6
 * ═══════════════════════════════════════════════════════════════════
 *
 *  ROOT CAUSE (confirmed)
 *  ─────────────────────
 *  app.js declares pool state with `let` at script top-level (lines 31784-31787):
 *    let currentPool, selectedPoolDate, selectedPoolSlot, poolSlotsUnsubscribe
 *
 *  Every function in app.js that reads these bare names throws
 *  "Cannot access '...' before initialization" if called before
 *  line 31784 is reached during app.js execution (TDZ).
 *
 *  THE FIX (v6)  — final approach
 *  ───────────────────────────────
 *  NEVER call the original openPoolPage() or handlePoolBookNow().
 *  All previous probing strategies to detect TDZ clearance fail:
 *    v4: defineProperty on window.currentPool — fired by our own patch.
 *    v5: probe fn(null,null) — typeof on TDZ var doesn't throw; function
 *        returns early at `if (!pool) return` before any TDZ read occurs.
 *
 *  The only correct solution is a complete replacement of both functions
 *  using only window.* state, which is always initialised and safe.
 *  openPoolPage and handlePoolBookNow are both fully reimplemented here.
 *
 *  LOAD ORDER — last <script> in index.html, after all other scripts:
 *    <script src="bmg_swimming_pool_fix.js"></script>
 * ═══════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  /* ── helpers ─────────────────────────────────────────────────── */
  function _waitFor(name, cb, n) {
    n = n || 0;
    if (typeof window[name] === 'function') return cb();
    if (n > 100) { console.warn('[pool-fix] gave up waiting for', name); return; }
    setTimeout(function () { _waitFor(name, cb, n + 1); }, 150);
  }

  function _esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function groundToPool(groundData, groundId) {
    return {
      groundRef          : groundId || '',
      poolName           : groundData.groundName    || groundData.poolName || 'Swimming Pool',
      basePricePerMember : groundData.pricePerHour  || groundData.basePricePerMember || 0,
      maxMembersPerSlot  : groundData.maxMembersPerSlot || 20,
      address            : groundData.groundAddress || groundData.address || '',
      city               : groundData.city          || groundData.cityLower || '',
      cityLower          : (groundData.city || groundData.cityLower || '').toLowerCase(),
      images             : groundData.images  || [],
      ownerId            : groundData.ownerId  || '',
      ownerName          : groundData.ownerName || '',
      ownerPhone         : groundData.ownerPhone || '',
      status             : 'active',
      createdAt          : groundData.createdAt || null,
      updatedAt          : groundData.updatedAt  || null,
      amenities          : groundData.amenities  || [],
    };
  }

  /* ════════════════════════════════════════════════════════════════
   *  TDZ — WHY WE NEVER CALL original() (v6 rationale)
   *
   *  Every approach to detecting TDZ clearance from outside app.js
   *  fails:
   *  A) defineProperty on window.currentPool: our own patch fires it.
   *  B) typeof on poolSlotsUnsubscribe: typeof never throws on TDZ.
   *  C) Probe via fn(null,null): function returns early before TDZ var.
   *
   *  Solution: NEVER call original(). Fully reimplement using window.*
   * ════════════════════════════════════════════════════════════════*/
  function _isTDZGone() {
    // Always returns false — we never rely on TDZ detection (see rationale above)
    return false;
  }

  function _installTDZSentinel() { /* no-op in v6 */ }


  /* ════════════════════════════════════════════════════════════════
   *  SAFE SLOT LOADER
   *  Reimplements loadPoolSlots without reading any bare `let`.
   *  Stores its unsubscribe on window._poolSlotsUnsub (always safe).
   * ════════════════════════════════════════════════════════════════*/

  function _safeCalcPrice(base, current, max) {
    var ratio = current / (max || 1);
    var mult  = 1.0;
    if (ratio >= 0.75) mult = 1.50;
    else if (ratio >= 0.50) mult = 1.30;
    else if (ratio >= 0.25) mult = 1.15;
    return Math.ceil(base * mult);
  }

  function _safeTierLabel(current, max) {
    var ratio = current / (max || 1);
    if (ratio >= 0.75) return 'Almost Full 🚨';
    if (ratio >= 0.50) return 'High Demand ⚡';
    if (ratio >= 0.25) return 'Filling up 🔥';
    return 'Early Bird 🎉';
  }

  function _safeRenderPoolSlots(slots, pool) {
    var grid = document.getElementById('pool-slots-grid');
    if (!grid) return;

    if (!slots || slots.length === 0) {
      grid.innerHTML =
        '<div style="grid-column:1/-1;text-align:center;padding:24px;color:#94a3b8;font-size:13px">' +
        'No sessions available for this date.</div>';
      return;
    }

    var now      = new Date();
    var todayStr = now.toISOString().split('T')[0];
    var selDate  = window.selectedPoolDate || todayStr;
    var isToday  = (selDate === todayStr);

    var periods = { Morning: [], Afternoon: [], Evening: [], Night: [] };
    var icons   = { Morning: '🌅', Afternoon: '☀️', Evening: '🌆', Night: '🌙' };
    var ORDER   = ['Morning', 'Afternoon', 'Evening', 'Night'];

    slots.forEach(function (slot) {
      var h = parseInt((slot.startTime || '00').split(':')[0], 10);
      if (h < 12)       periods.Morning.push(slot);
      else if (h < 17)  periods.Afternoon.push(slot);
      else if (h < 21)  periods.Evening.push(slot);
      else              periods.Night.push(slot);
    });

    grid.innerHTML = '';

    ORDER.forEach(function (period) {
      var group = periods[period];
      if (!group || !group.length) return;

      var label = document.createElement('div');
      label.className   = 'bmg-pool-period-label';
      label.textContent = icons[period] + ' ' + period;
      grid.appendChild(label);

      group.forEach(function (slot) {
        var max     = slot.maxMembers     || (pool && pool.maxMembersPerSlot) || 50;
        var current = slot.currentMembers || 0;
        var base    = slot.basePricePerMember || (pool && pool.basePricePerMember) || 0;
        var price   = _safeCalcPrice(base, current, max);
        var pct     = Math.min(Math.round((current / max) * 100), 100);

        var isPast = false;
        if (isToday) {
          var parts = (slot.startTime || '00:00').split(':').map(Number);
          var slotStart = new Date(now);
          slotStart.setHours(parts[0], parts[1] || 0, 0, 0);
          if (slotStart <= now) isPast = true;
        }

        var isFull     = current >= max || slot.status === 'full';
        var isFilling  = !isPast && !isFull && pct >= 60;
        var isOpen     = !isPast && !isFull && !isFilling;
        var curSel     = window.selectedPoolSlot;
        var isSelected = curSel && curSel.slotId === slot.id;

        var cls = 'bmg-pool-slot ';
        if (isSelected)      cls += 'pool-selected';
        else if (isPast)     cls += 'pool-past';
        else if (isFull)     cls += 'pool-full';
        else if (isFilling)  cls += 'pool-filling';
        else                 cls += 'pool-open';

        var el = document.createElement('div');
        el.className = cls;
        el.setAttribute('data-slot-id', slot.id);

        var slotLabel = slot.slotTime || ((slot.startTime || '') + '-' + (slot.endTime || ''));
        var tierLabel = _safeTierLabel(current, max);

        el.innerHTML =
          '<span class="bmg-pool-slot-time">' + _esc(slotLabel) + '</span>' +
          '<div class="bmg-pool-slot-members">' +
            '<i class="fas fa-users" style="font-size:9px"></i> ' +
            current + '/' + max + ' members' +
          '</div>' +
          '<span class="bmg-pool-slot-price">₹' + price + '/member</span>' +
          '<div class="bmg-pool-slot-progress-wrap">' +
            '<div class="bmg-pool-slot-progress-fill" style="width:' + pct + '%"></div>' +
          '</div>' +
          (isFull ? '<div class="bmg-pool-slot-full-ribbon">FULL</div>' : '') +
          ((isOpen || isFilling || isSelected)
            ? '<span style="font-size:9px;color:inherit;opacity:0.75">' + tierLabel + '</span>'
            : '');

        if (isOpen || isFilling || isSelected) {
          el.style.cursor = 'pointer';
          el.addEventListener('click', (function (s, p, pr) {
            return function () { _safeOnPoolSlotSelect(s, p, pr, this); };
          })(slot, pool, price));
        }

        grid.appendChild(el);
      });
    });
  }

  function _safeOnPoolSlotSelect(slot, pool, price, el) {
    // Deselect all
    document.querySelectorAll('#pool-slots-grid .bmg-pool-slot').forEach(function (s) {
      s.classList.remove('pool-selected');
    });

    var slotTime = slot.slotTime || ((slot.startTime || '') + '-' + (slot.endTime || ''));
    var sel = {
      slotId        : slot.id,
      slotTime      : slotTime,
      price         : price,
      currentMembers: slot.currentMembers || 0,
      maxMembers    : slot.maxMembers || (pool && pool.maxMembersPerSlot) || 50,
      startTime     : slot.startTime,
      endTime       : slot.endTime,
      poolId        : slot.poolId,
      poolName      : pool && pool.poolName,
    };
    window.selectedPoolSlot = sel;

    el.classList.add('pool-selected');
    el.classList.remove('pool-open', 'pool-filling');

    var stickyBar  = document.getElementById('pool-sticky-bar');
    var stickyTime = document.getElementById('pool-sticky-time');
    var stickyAmt  = document.getElementById('pool-sticky-amount');
    if (stickyTime) stickyTime.textContent = slotTime;
    if (stickyAmt)  stickyAmt.textContent  = '₹' + price;
    if (stickyBar)  stickyBar.style.display = 'block';
  }

  /**
   * Safe slot loader — no bare `let` reads. Uses window.db directly.
   * Returns a cancel function (stores unsubscribe on window._poolSlotsUnsub).
   */
  async function _safeLoadPoolSlots(poolId, date, pool) {
    // Cancel any previous listener
    if (typeof window._poolSlotsUnsub === 'function') {
      try { window._poolSlotsUnsub(); } catch (e) { /* ignore */ }
    }
    window._poolSlotsUnsub = null;

    var grid = document.getElementById('pool-slots-grid');
    if (!grid) return;

    grid.innerHTML =
      '<div style="grid-column:1/-1;text-align:center;padding:24px;color:#94a3b8;font-size:13px">' +
      '<div class="bmg-pool-ripple" style="margin:0 auto 12px"></div>Loading sessions…</div>';

    var db = window.db;
    if (!db || !poolId || !date) return;

    // Ensure slot docs exist first
    try { await _safeEnsurePoolSlotDocs(poolId, date, pool); } catch (e) { /* non-fatal */ }

    try {
      var unsub = db.collection('pool_slots')
        .where('poolId', '==', poolId)
        .where('date',   '==', date)
        .orderBy('startTime')
        .onSnapshot(function (snap) {
          var slots = [];
          snap.forEach(function (doc) {
            var d = doc.data();
            d.id = doc.id;
            slots.push(d);
          });
          _safeRenderPoolSlots(slots, pool || window.currentPool);
        }, function (err) {
          console.warn('[pool-fix] pool_slots onSnapshot error:', err.message);
          // Fallback: one-time get
          db.collection('pool_slots')
            .where('poolId', '==', poolId)
            .where('date',   '==', date)
            .orderBy('startTime')
            .get()
            .then(function (snap) {
              var slots = [];
              snap.forEach(function (doc) {
                var d = doc.data(); d.id = doc.id; slots.push(d);
              });
              _safeRenderPoolSlots(slots, pool || window.currentPool);
            })
            .catch(function () {
              if (grid) grid.innerHTML =
                '<div style="grid-column:1/-1;text-align:center;padding:24px;color:#ef4444;font-size:13px">' +
                'Could not load sessions. Please try again.</div>';
            });
        });

      window._poolSlotsUnsub = unsub;
    } catch (err) {
      console.warn('[pool-fix] _safeLoadPoolSlots error:', err.message);
      if (grid) grid.innerHTML =
        '<div style="grid-column:1/-1;text-align:center;padding:24px;color:#ef4444;font-size:13px">' +
        'Could not load sessions. Please try again.</div>';
    }
  }

  async function _safeEnsurePoolSlotDocs(poolId, date, pool) {
    var db = window.db;
    if (!db) return;

    var startH = (pool && pool.openHour)  || 5;
    var endH   = (pool && pool.closeHour) || 21;

    // Build default slots if pool has no custom schedule
    var slotDefs = (pool && pool.slots) || [];
    if (!slotDefs.length) {
      for (var h = startH; h < endH; h++) {
        slotDefs.push({
          start: String(h).padStart(2, '0') + ':00',
          end  : String(h + 1).padStart(2, '0') + ':00',
        });
      }
    }

    var existing = await db.collection('pool_slots')
      .where('poolId', '==', poolId)
      .where('date',   '==', date)
      .get();

    var existingTimes = {};
    existing.forEach(function (d) { existingTimes[d.data().startTime] = true; });

    var batch   = db.batch();
    var created = 0;

    slotDefs.forEach(function (s) {
      if (existingTimes[s.start]) return;
      var ref = db.collection('pool_slots').doc();
      batch.set(ref, {
        poolId             : poolId,
        poolName           : (pool && pool.poolName) || 'Pool',
        ownerId            : (pool && pool.ownerId)  || '',
        date               : date,
        startTime          : s.start,
        endTime            : s.end,
        slotTime           : s.start + '-' + s.end,
        maxMembers         : (pool && pool.maxMembersPerSlot) || 50,
        currentMembers     : 0,
        basePricePerMember : (pool && pool.basePricePerMember) || 0,
        status             : 'available',
        autoCreated        : true,
        createdAt          : firebase.firestore.FieldValue.serverTimestamp(),
      });
      created++;
    });

    if (created > 0) await batch.commit();
  }


  /* ════════════════════════════════════════════════════════════════
   *  SAFE PAGE POPULATION
   *  Mirrors openPoolPage (app.js lines 31931-31986) using only
   *  window.* — never reads a bare `let` variable.
   * ════════════════════════════════════════════════════════════════*/
  function _safePopulatePoolPage(pool) {
    var today = new Date().toISOString().split('T')[0];

    window.currentPool      = pool;
    window.selectedPoolDate = today;
    window.selectedPoolSlot = null;

    var safe = function (id, val) {
      var el = document.getElementById(id);
      if (el) el.textContent = val || '';
    };
    safe('pool-name',           pool.poolName || 'Swimming Pool');
    safe('pool-base-price',     '₹' + (pool.basePricePerMember || 0));
    safe('pool-capacity-badge', (pool.maxMembersPerSlot || 50) + ' members max');

    var addrEl = document.getElementById('pool-address');
    if (addrEl) addrEl.innerHTML =
      '<i class="fas fa-map-marker-alt" style="color:#0ea5e9"></i>' +
      '<span>' + _esc(pool.address || pool.city || 'Address not set') + '</span>';

    var ownerEl = document.getElementById('pool-owner-info');
    if (ownerEl) ownerEl.innerHTML =
      '<i class="fas fa-user-circle" style="color:#0ea5e9"></i>' +
      '<span>' + _esc(pool.ownerName || 'Pool Owner') + '</span>';

    var amenitiesEl = document.getElementById('pool-amenities-row');
    if (amenitiesEl) {
      var amenities = pool.amenities || ['Changing Room', 'Showers', 'Life Guard'];
      amenitiesEl.innerHTML = amenities
        .map(function (a) { return '<span class="bmg-pool-amenity-chip">✓ ' + _esc(a) + '</span>'; })
        .join('');
    }

    var galleryEl = document.getElementById('pool-gallery');
    if (galleryEl) {
      if (pool.images && pool.images.length > 0) {
        galleryEl.innerHTML =
          '<img src="' + _esc(pool.images[0]) + '" ' +
          'style="width:100%;height:100%;object-fit:cover;display:block" alt="Pool" ' +
          'onerror="this.style.background=\'linear-gradient(135deg,#0369a1,#0ea5e9,#06b6d4)\'">';
      } else {
        galleryEl.innerHTML =
          '<div style="width:100%;height:100%;display:flex;align-items:center;' +
          'justify-content:center;font-size:64px;' +
          'background:linear-gradient(135deg,#0369a1,#0ea5e9,#06b6d4)">🏊</div>';
      }
    }

    var stickyBar = document.getElementById('pool-sticky-bar');
    if (stickyBar) stickyBar.style.display = 'none';

    _safeBuildPoolDateChips(today, pool);

    if (typeof window.showPage === 'function') window.showPage('pool-page');

    // Load slots via our safe loader (no TDZ risk)
    _safeLoadPoolSlots(pool.id, today, pool);

    console.log('[pool-fix] _safePopulatePoolPage complete');
  }

  function _safeBuildPoolDateChips(activeDate, pool) {
    var container = document.getElementById('pool-date-selector');
    if (!container) return;

    var days  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    var today = new Date();
    container.innerHTML = '';

    for (var i = 0; i < 7; i++) {
      (function (i) {
        var d   = new Date(today);
        d.setDate(today.getDate() + i);
        var iso = d.toISOString().split('T')[0];

        var chip = document.createElement('div');
        chip.className = 'bmg-pool-date-chip' + (iso === activeDate ? ' active' : '');
        chip.innerHTML =
          '<span class="pool-day">'  + days[d.getDay()] + '</span>' +
          '<span class="pool-date">' + d.getDate()      + '</span>';

        chip.addEventListener('click', function () {
          container.querySelectorAll('.bmg-pool-date-chip')
            .forEach(function (c) { c.classList.remove('active'); });
          chip.classList.add('active');

          window.selectedPoolDate = iso;
          window.selectedPoolSlot = null;

          var sb = document.getElementById('pool-sticky-bar');
          if (sb) sb.style.display = 'none';

          // Use window.currentPool — NEVER the bare let
          var p = window.currentPool || pool;
          if (p) _safeLoadPoolSlots(p.id, iso, p);
        });

        container.appendChild(chip);
      })(i);
    }
  }


  /* ════════════════════════════════════════════════════════════════
   *  FIX 2 (v6) — Fully replace openPoolPage + handlePoolBookNow
   *
   *  Strategy: NEVER call original(). Both functions read bare `let`
   *  variables (currentPool, selectedPoolSlot, selectedPoolDate,
   *  poolSlotsUnsubscribe) which are in TDZ when the card is clicked
   *  from the home page carousel.  We replace both functions entirely
   *  using only window.* state, which is always safe.
   * ════════════════════════════════════════════════════════════════*/
  function patchOpenPoolPage() {
    /* Guard: only patch once */
    if (window.openPoolPage && window.openPoolPage._poolFixPatched) return;

    /* ── Back button: safe re-wire on every pool-page visit ──────── */
    function _wirePoolBackBtn() {
      var btn = document.getElementById('pool-back-btn');
      if (!btn) return;
      var fresh = btn.cloneNode(true);
      btn.parentNode.replaceChild(fresh, btn);
      fresh.addEventListener('click', function () {
        /* Cancel our safe slot listener */
        if (typeof window._poolSlotsUnsub === 'function') {
          try { window._poolSlotsUnsub(); } catch (e) { /* ignore */ }
          window._poolSlotsUnsub = null;
        }
        if (typeof window.goBack === 'function') window.goBack();
      });
    }

    /* ── Book-Now: full reimplementation (no bare `let` reads) ────── */
    async function _safeHandlePoolBookNow() {
      var user = window.currentUser;
      if (!user) {
        if (typeof window.showToast === 'function') window.showToast('Please login to book', 'warning');
        if (typeof window.showPage  === 'function') window.showPage('login-page');
        return;
      }

      var slot = window.selectedPoolSlot;
      if (!slot) {
        if (typeof window.showToast === 'function') window.showToast('Please select a session first', 'warning');
        return;
      }

      var pool = window.currentPool;
      if (!pool) {
        if (typeof window.showToast === 'function') window.showToast('Pool info missing. Go back and try again.', 'error');
        return;
      }

      /* Re-check availability */
      try {
        var db = window.db;
        var slotDoc = await db.collection('pool_slots').doc(slot.slotId).get();
        if (!slotDoc.exists) {
          if (typeof window.showToast === 'function') window.showToast('Session no longer available.', 'error');
          return;
        }
        var latest  = slotDoc.data();
        var max     = latest.maxMembers || pool.maxMembersPerSlot || 50;
        var current = latest.currentMembers || 0;
        if (current >= max) {
          if (typeof window.showToast === 'function') window.showToast('This session is now full. Choose another.', 'error');
          _safeLoadPoolSlots(pool.id, window.selectedPoolDate, pool);
          return;
        }
        /* Recalculate price from latest occupancy */
        slot.price          = _safeCalcPrice(
          latest.basePricePerMember || pool.basePricePerMember || 0,
          current, max
        );
        slot.currentMembers = current;
        slot.maxMembers     = max;
        window.selectedPoolSlot = slot;
      } catch (err) {
        console.warn('[pool-fix] pre-book check error:', err.message);
      }

      /* Get mobile */
      var userMobile = user.phone || user.userPhone || '';
      if (!userMobile || userMobile.length !== 10) {
        try {
          if (typeof window.promptForMobileNumber === 'function') {
            userMobile = await window.promptForMobileNumber();
          }
        } catch (_) {}
        if (!userMobile) {
          if (typeof window.showToast === 'function') window.showToast('Mobile number required for booking', 'error');
          return;
        }
      }

      /* Build booking details (mirrors handlePoolBookNow in app.js) */
      var bookingId = typeof window.generateId === 'function'
        ? window.generateId('PBK')
        : ('PBK' + Date.now());
      var orderId = bookingId;
      var amount  = slot.price;

      var poolDate = window.selectedPoolDate || new Date().toISOString().split('T')[0];

      var bookingDetails = {
        bookingId       : bookingId,
        orderId         : orderId,
        type            : 'pool_booking',
        paymentType     : 'booking',
        userId          : user.uid,
        userName        : user.name || user.displayName || 'User',
        userEmail       : user.email || '',
        userPhone       : userMobile,
        ownerId         : pool.ownerId  || '',
        ownerName       : pool.ownerName || '',
        poolId          : pool.id,
        poolName        : pool.poolName || 'Swimming Pool',
        poolAddress     : pool.address  || '',
        slotId          : slot.slotId,
        slotTime        : slot.slotTime,
        startTime       : slot.startTime,
        endTime         : slot.endTime,
        date            : poolDate,
        currentMembers  : slot.currentMembers,
        maxMembers      : slot.maxMembers,
        amount          : amount,
        originalAmount  : amount,
        ownerAmount     : Math.round(amount * 0.9),
        platformAmount  : Math.round(amount * 0.1),
        commission      : Math.round(amount * 0.1),
        sportType       : 'Swimming',
        isPoolBooking   : true,
        paymentStatus   : 'pending',
        bookingStatus   : 'pending_payment',
        initiatedAt     : new Date().toISOString(),
        createdAt       : new Date().toISOString(),
      };

      /* Fill booking-page summary fields */
      var fmt = typeof window.formatCurrency === 'function'
        ? window.formatCurrency : function (n) { return '₹' + n; };
      function _safe(id, val) {
        var el = document.getElementById(id);
        if (el) el.textContent = val || '';
      }
      _safe('booking-ground-name', bookingDetails.poolName);
      _safe('booking-date',        bookingDetails.date);
      _safe('booking-time',        bookingDetails.slotTime);
      _safe('booking-amount',      fmt(amount));
      _safe('payment-amount',      fmt(amount));
      _safe('platform-fee',        fmt(bookingDetails.platformAmount));
      _safe('final-amount',        fmt(amount));

      /* Persist to sessionStorage */
      var safeDetails = JSON.parse(JSON.stringify(bookingDetails));
      sessionStorage.setItem('pendingBooking',         JSON.stringify(safeDetails));
      sessionStorage.setItem('pendingCashfreeBooking', JSON.stringify(safeDetails));

      /* Write pending pool booking to Firestore */
      try {
        await window.db.collection('pool_bookings').doc(orderId).set(
          Object.assign({}, safeDetails, {
            status    : 'pending_payment',
            createdAt : firebase.firestore.FieldValue.serverTimestamp(),
          })
        );
      } catch (err) {
        console.warn('[pool-fix] pending pool booking write error:', err.message);
      }

      /* Wire payment button */
      if (typeof window.setupPayButton === 'function') {
        window.setupPayButton(safeDetails);
      }

      if (typeof window.showPage === 'function') window.showPage('booking-page');
    }

    /* ── Book-Now button wiring (re-wire on every pool-page visit) ── */
    function _wireBookNowBtn() {
      var btn = document.getElementById('pool-book-now-btn');
      if (!btn) return;
      var fresh = btn.cloneNode(true);
      btn.parentNode.replaceChild(fresh, btn);
      fresh.addEventListener('click', function () {
        _safeHandlePoolBookNow().catch(function (e) {
          console.error('[pool-fix] handlePoolBookNow error:', e);
        });
      });
    }

    /* ── Wire review button (safe — uses window.currentPool) ──────── */
    function _wireReviewBtn() {
      var btn = document.getElementById('pool-write-review-btn');
      if (!btn) return;
      var fresh = btn.cloneNode(true);
      btn.parentNode.replaceChild(fresh, btn);
      fresh.addEventListener('click', function () {
        var pool = window.currentPool;
        if (typeof window.showWriteReviewModal === 'function') {
          window.showWriteReviewModal({ id: pool && pool.id, groundName: pool && pool.poolName });
        } else {
          if (typeof window.showToast === 'function') window.showToast('Review feature coming soon!', 'info');
        }
      });
    }

    /* ── Listen: re-wire all buttons whenever pool-page is shown ─── */
    window.addEventListener('bmg:pageShown', function (e) {
      if ((e.detail && e.detail.pageId) === 'pool-page') {
        setTimeout(function () {
          _wirePoolBackBtn();
          _wireBookNowBtn();
          _wireReviewBtn();
        }, 50);
      }
    });

    /* ── The replacement openPoolPage ────────────────────────────── */
    window.openPoolPage = function (pool) {
      /* Store state on window — always safe */
      window.currentPool      = pool;
      window.selectedPoolDate = new Date().toISOString().split('T')[0];
      window.selectedPoolSlot = null;

      _safePopulatePoolPage(pool);
      /* _safePopulatePoolPage calls showPage('pool-page'), which fires
         bmg:pageShown → _wireBookNowBtn / _wirePoolBackBtn / _wireReviewBtn */
    };

    /* Also expose _safeHandlePoolBookNow globally so any direct calls work */
    window.handlePoolBookNow = function () {
      _safeHandlePoolBookNow().catch(function (e) {
        console.error('[pool-fix] handlePoolBookNow error:', e);
      });
    };

    window.openPoolPage._poolFixPatched = true;
    console.log('[pool-fix] FIX 2 (v6): openPoolPage + handlePoolBookNow fully replaced — no original() calls');
  }


  /* ════════════════════════════════════════════════════════════════
   *  FIX A — Mirror NEW swimming grounds into swimming_pools
   * ════════════════════════════════════════════════════════════════*/
  function patchHandleAddGround() {
    var original = window.handleAddGround;
    if (!original || original._poolPatched) return;

    window.handleAddGround = async function (e) {
      await original.apply(this, arguments);

      var sportSelect = document.getElementById('ground-sport-input');
      if (!sportSelect || sportSelect.value !== 'swimming') return;

      try {
        var db   = window.db;
        var user = window.currentUser;
        if (!db || !user) return;

        var groundName    = (document.getElementById('ground-name-input')?.value    || '').trim();
        var pricePerHour  = parseFloat(document.getElementById('ground-price-input')?.value || '0');
        var groundAddress = (document.getElementById('ground-address-input')?.value || '').trim();
        var city          = (document.getElementById('ground-city-input')?.value    || '').trim();

        var snap = await db.collection('grounds')
          .where('ownerId',   '==', user.uid)
          .where('sportType', '==', 'swimming')
          .orderBy('createdAt', 'desc')
          .limit(1)
          .get();

        var groundId   = snap.empty ? '' : snap.docs[0].id;
        var groundData = snap.empty ? {} : snap.docs[0].data();

        if (groundId) {
          var existing = await db.collection('swimming_pools')
            .where('groundRef', '==', groundId)
            .limit(1)
            .get();
          if (!existing.empty) return;
        }

        var poolDoc = groundToPool(
          Object.assign({}, groundData, {
            groundName   : groundName,
            pricePerHour : pricePerHour,
            groundAddress: groundAddress,
            city         : city,
            ownerId      : user.uid,
            ownerName    : user.ownerName || user.name || '',
          }),
          groundId
        );
        poolDoc.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        poolDoc.updatedAt = firebase.firestore.FieldValue.serverTimestamp();

        await db.collection('swimming_pools').add(poolDoc);
        console.log('[pool-fix] FIX A: Mirrored swimming ground to swimming_pools');

        if (typeof window.loadBmgPoolSection === 'function') {
          setTimeout(function () { window.loadBmgPoolSection().catch(function () {}); }, 500);
        }
      } catch (err) {
        console.warn('[pool-fix] FIX A: Could not mirror to swimming_pools:', err.message);
      }
    };

    window.handleAddGround._poolPatched = true;
    console.log('[pool-fix] FIX A: handleAddGround patched');
  }


  /* ════════════════════════════════════════════════════════════════
   *  FIX B — Patch loadBmgPoolSection to ALSO query `grounds`
   * ════════════════════════════════════════════════════════════════*/
  function patchLoadBmgPoolSection() {
    var original = window.loadBmgPoolSection;
    if (!original || original._poolPatched) return;

    window.loadBmgPoolSection = async function () {
      var db       = window.db;
      var row      = document.getElementById('bmg-pool-scroll-row');
      var emptyMsg = document.getElementById('bmg-pool-empty');
      if (!row) return;

      row.innerHTML =
        '<div class="bmg-pool-card-skeleton"></div>' +
        '<div class="bmg-pool-card-skeleton"></div>' +
        '<div class="bmg-pool-card-skeleton"></div>';

      try {
        var seen  = {};
        var pools = [];
        var today = new Date().toISOString().split('T')[0];

        try {
          var snap1 = await db.collection('swimming_pools')
            .where('status', '==', 'active').limit(20).get();
          snap1.forEach(function (doc) {
            var p = Object.assign({ id: doc.id }, doc.data());
            seen[p.groundRef || doc.id] = true;
            pools.push(p);
          });
        } catch (e) {
          console.warn('[pool-fix] FIX B: swimming_pools query error:', e.message);
        }

        try {
          var snap2 = await db.collection('grounds')
            .where('sportType', '==', 'swimming')
            .where('status',    '==', 'active').limit(20).get();
          snap2.forEach(function (doc) {
            if (seen[doc.id]) return;
            var g = Object.assign({ id: doc.id }, doc.data());
            var p = groundToPool(g, doc.id);
            p.id = doc.id; p._fromGrounds = true;
            pools.push(p);
          });
        } catch (e) {
          console.warn('[pool-fix] FIX B: grounds/swimming query error:', e.message);
        }

        row.innerHTML = '';

        if (pools.length === 0) {
          if (emptyMsg) emptyMsg.style.display = 'block';
          return;
        }
        if (emptyMsg) emptyMsg.style.display = 'none';

        var buildCard = window.buildPoolHomeCard;
        for (var i = 0; i < pools.length; i++) {
          var pool = pools[i];
          try {
            var card = typeof buildCard === 'function'
              ? await buildCard(pool, today)
              : _simpleFallbackCard(pool);
            row.appendChild(card);
          } catch (cardErr) {
            console.warn('[pool-fix] FIX B: card build error:', cardErr.message);
          }
        }
      } catch (err) {
        console.warn('[pool-fix] FIX B: loadBmgPoolSection error:', err.message);
        row.innerHTML = '';
        if (emptyMsg) emptyMsg.style.display = 'block';
      }
    };

    window.loadBmgPoolSection._poolPatched = true;
    console.log('[pool-fix] FIX B: loadBmgPoolSection patched');
  }

  function _simpleFallbackCard(pool) {
    var card = document.createElement('div');
    card.className = 'bmg-pool-card';
    card.setAttribute('data-pool-id', pool.id || '');
    card.innerHTML =
      '<div class="bmg-pool-card-img-placeholder">🏊</div>' +
      '<div class="bmg-pool-card-body">' +
        '<div class="bmg-pool-card-name">' + _esc(pool.poolName || 'Swimming Pool') + '</div>' +
        '<div class="bmg-pool-card-addr"><i class="fas fa-map-marker-alt"></i> ' +
          _esc(pool.address || pool.city || 'Location not set') + '</div>' +
        '<div class="bmg-pool-card-price-row">' +
          '<span class="bmg-pool-card-price">₹' + (pool.basePricePerMember || 0) + '</span>' +
          '<span class="bmg-pool-card-price-sub">/member/slot</span>' +
        '</div>' +
        '<button class="bmg-pool-card-view-btn">' +
          '<i class="fas fa-swimming-pool"></i> View &amp; Book</button>' +
      '</div>';

    card.addEventListener('click', function () {
      if (typeof window.openPoolPage === 'function') window.openPoolPage(pool);
      else _waitFor('openPoolPage', function () { window.openPoolPage(pool); });
    });
    return card;
  }


  /* ════════════════════════════════════════════════════════════════
   *  Boot
   * ════════════════════════════════════════════════════════════════*/
  _installTDZSentinel(); // no-op in v6 — kept for call-site compatibility

  if (typeof window.openPoolPage === 'function') {
    patchOpenPoolPage();
  } else {
    _waitFor('openPoolPage', patchOpenPoolPage);
  }

  _waitFor('handleAddGround',    patchHandleAddGround);
  _waitFor('loadBmgPoolSection', patchLoadBmgPoolSection);

  window.addEventListener('bmg:pageShown', function (e) {
    var pageId = e.detail && e.detail.pageId;
    if (pageId === 'home-page') {
      if (window.loadBmgPoolSection && !window.loadBmgPoolSection._poolPatched) patchLoadBmgPoolSection();
      if (window.openPoolPage       && !window.openPoolPage._poolFixPatched)    patchOpenPoolPage();
    }
  });

  console.log('✅ [bmg_swimming_pool_fix.js v6] Loaded — openPoolPage + handlePoolBookNow fully replaced, no TDZ risk');

})();

/* ════════════════════════════════════════════════════════════════════
 *  bmg_swimming_pool_fix.js  — v6 EXTENSION
 *  1. Add "More Members" selector to pool sticky bar
 *  2. Dynamic total price = pricePerMember × memberCount
 *  3. Pool entry pass (beautiful, swimmer-themed, QR code)
 *  4. Pool bookings appear in "My Bookings" alongside grounds
 * ════════════════════════════════════════════════════════════════════*/
(function () {
  'use strict';

  /* ─── helpers ──────────────────────────────────────────────── */
  function _esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function _waitFor(name, cb, n) {
    n = n || 0;
    if (typeof window[name] === 'function') return cb();
    if (n > 100) return;
    setTimeout(function () { _waitFor(name, cb, n + 1); }, 150);
  }

  /* ════════════════════════════════════════════════════════════
   *  PART 1 — Inject member-selector into pool sticky bar
   *  Runs every time pool-page is shown (bmg:pageShown)
   * ════════════════════════════════════════════════════════════*/
  function injectMemberSelector() {
    var bar = document.getElementById('pool-sticky-bar');
    if (!bar || bar.querySelector('#pool-member-row')) return;

    /* ── member count row ─────────────────────────────────── */
    var memberRow = document.createElement('div');
    memberRow.id = 'pool-member-row';
    memberRow.innerHTML =
      '<div class="bmg-pool-member-row">' +
        '<div class="bmg-pool-member-label-col">' +
          '<span class="bmg-pool-member-label">👥 Members</span>' +
          '<span class="bmg-pool-member-hint" id="pool-member-hint">Price updates per person</span>' +
        '</div>' +
        '<div class="bmg-pool-member-stepper">' +
          '<button class="bmg-pool-stepper-btn" id="pool-member-minus" aria-label="Remove member">−</button>' +
          '<span class="bmg-pool-member-count" id="pool-member-count">1</span>' +
          '<button class="bmg-pool-stepper-btn bmg-pool-stepper-btn--plus" id="pool-member-plus" aria-label="Add member">+</button>' +
        '</div>' +
      '</div>';

    /* Insert between sticky-info and book button */
    var bookBtn = document.getElementById('pool-book-now-btn');
    if (bookBtn) {
      bar.insertBefore(memberRow, bookBtn);
    } else {
      bar.appendChild(memberRow);
    }

    /* wire stepper */
    document.getElementById('pool-member-minus').addEventListener('click', function () {
      var cur = window._poolMemberCount || 1;
      if (cur <= 1) return;
      window._poolMemberCount = cur - 1;
      _refreshMemberUI();
    });
    document.getElementById('pool-member-plus').addEventListener('click', function () {
      var cur   = window._poolMemberCount || 1;
      var slot  = window.selectedPoolSlot;
      var avail = slot ? (slot.maxMembers - slot.currentMembers) : 10;
      if (cur >= Math.min(avail, 10)) {
        if (typeof window.showToast === 'function')
          window.showToast('Maximum ' + Math.min(avail, 10) + ' members per booking', 'warning');
        return;
      }
      window._poolMemberCount = cur + 1;
      _refreshMemberUI();
    });

    console.log('[pool-fix v6+] Member selector injected');
  }

  function _refreshMemberUI() {
    var count   = window._poolMemberCount || 1;
    var slot    = window.selectedPoolSlot;
    var perPer  = slot ? slot.price : 0;
    var total   = perPer * count;

    var countEl  = document.getElementById('pool-member-count');
    var amtEl    = document.getElementById('pool-sticky-amount');
    var hintEl   = document.getElementById('pool-member-hint');

    if (countEl) countEl.textContent = count;
    if (amtEl)   amtEl.textContent   = '₹' + total;
    if (hintEl)  hintEl.textContent  = count > 1
      ? '₹' + perPer + '/person × ' + count + ' = ₹' + total
      : '₹' + perPer + '/person';

    /* store total on selectedPoolSlot for booking */
    if (slot) {
      slot._memberCount = count;
      slot._totalAmount = total;
      window.selectedPoolSlot = slot;
    }
  }

  /* Reset count to 1 when a new slot is selected */
  var _origOnPoolSlotSelect = window._safeOnPoolSlotSelect;
  window.addEventListener('bmg:poolSlotSelected', function () {
    window._poolMemberCount = 1;
    _refreshMemberUI();
  });

  /* Patch _safeOnPoolSlotSelect to reset member count and dispatch event */
  function patchSlotSelectForMembers() {
    /* We intercept the click path by observing pool-sticky-bar visibility changes */
    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        if (m.type === 'attributes' && m.attributeName === 'style') {
          var bar = document.getElementById('pool-sticky-bar');
          if (bar && bar.style.display !== 'none') {
            window._poolMemberCount = 1;
            setTimeout(_refreshMemberUI, 50);
          }
        }
      });
    });
    var bar = document.getElementById('pool-sticky-bar');
    if (bar) observer.observe(bar, { attributes: true });
  }

  /* ════════════════════════════════════════════════════════════
   *  PART 2 — Patch handlePoolBookNow to use member count
   *  Overrides the booking amount with memberCount × pricePerMember
   * ════════════════════════════════════════════════════════════*/
  function patchBookNowForMembers() {
    var origHandlePoolBookNow = window.handlePoolBookNow;
    if (!origHandlePoolBookNow || origHandlePoolBookNow._memberPatched) return;

    window.handlePoolBookNow = async function () {
      /* Ensure member count is embedded before booking proceeds */
      var count  = window._poolMemberCount || 1;
      var slot   = window.selectedPoolSlot;
      if (slot) {
        slot._memberCount = count;
        slot._totalAmount = (slot.price || 0) * count;
        window.selectedPoolSlot = slot;
      }

      /* call the existing (v6-patched) handler */
      return origHandlePoolBookNow.apply(this, arguments);
    };
    window.handlePoolBookNow._memberPatched = true;

    /* Also patch the internal _safeHandlePoolBookNow by wrapping
       the pool-book-now-btn's click handler after page shown     */
    window.addEventListener('bmg:pageShown', function (e) {
      if ((e.detail && e.detail.pageId) !== 'pool-page') return;
      setTimeout(function () {
        var btn = document.getElementById('pool-book-now-btn');
        if (!btn || btn._memberPatched) return;
        var fresh = btn.cloneNode(true);
        btn.parentNode.replaceChild(fresh, btn);
        fresh._memberPatched = true;
        fresh.addEventListener('click', function () {
          var count = window._poolMemberCount || 1;
          var slot  = window.selectedPoolSlot;
          if (slot) {
            slot._memberCount  = count;
            slot._totalAmount  = (slot.price || 0) * count;
            window.selectedPoolSlot = slot;
          }
          /* call the existing global */
          if (typeof window.handlePoolBookNow === 'function') {
            window.handlePoolBookNow();
          }
        });
      }, 120);
    });

    console.log('[pool-fix v6+] handlePoolBookNow patched for member count');
  }

  /* Patch _safeHandlePoolBookNow (defined inside bmg_swimming_pool_fix.js v6)
     by wrapping the booking details construction with member count            */
  /* ── Step A: intercept sessionStorage to bake member count into stored data ── */
  (function patchInternalBooking() {
    var _origSetItem = sessionStorage.setItem.bind(sessionStorage);
    sessionStorage.setItem = function (key, value) {
      if ((key === 'pendingBooking' || key === 'pendingCashfreeBooking') && value) {
        try {
          var obj = JSON.parse(value);
          if (obj && obj.isPoolBooking) {
            var count  = window._poolMemberCount || 1;
            var perPer = obj.pricePerMember || obj.amount || 0;
            /* Store per-person price before we overwrite amount */
            obj.pricePerMember = perPer;
            obj.memberCount    = count;
            obj.amount         = perPer * count;
            obj.originalAmount = perPer * count;
            obj.ownerAmount    = Math.round(perPer * count * 0.9);
            obj.platformAmount = Math.round(perPer * count * 0.1);
            obj.commission     = Math.round(perPer * count * 0.1);
            value = JSON.stringify(obj);
          }
        } catch (e) { /* safe */ }
      }
      return _origSetItem(key, value);
    };
  })();

  /* ── Step B: when booking-page appears, re-populate summary from sessionStorage ── */
  /* This runs AFTER the original safe() calls, so it correctly overwrites them.     */
  window.addEventListener('bmg:pageShown', function (e) {
    if ((e.detail && e.detail.pageId) !== 'booking-page') return;

    setTimeout(function () {
      var raw = null;
      try { raw = JSON.parse(sessionStorage.getItem('pendingBooking') || sessionStorage.getItem('pendingCashfreeBooking') || 'null'); } catch (_) {}
      if (!raw || !raw.isPoolBooking) return;

      var count    = raw.memberCount    || 1;
      var perPer   = raw.pricePerMember || 0;
      var total    = raw.amount         || perPer * count;
      var platform = raw.platformAmount || 0;

      function _s(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; }

      /* Update ground label to "Pool" */
      var groundLabel = document.querySelector('#booking-page .summary-item span:first-child');
      if (groundLabel && groundLabel.textContent === 'Ground:') groundLabel.textContent = 'Pool:';

      _s('booking-ground-name', raw.poolName    || 'Swimming Pool');
      _s('booking-date',        raw.date        || '');
      _s('booking-time',        raw.slotTime    || '');
      _s('booking-amount',      '₹' + total);
      _s('payment-amount',      '₹' + total);
      _s('platform-fee',        '₹' + platform);
      _s('final-amount',        '₹' + total);

      /* Also update Cashfree pay button amount if setupPayButton is available */
      if (typeof window.setupPayButton === 'function') {
        try { window.setupPayButton(raw); } catch (_) {}
      }

      /* ── inject / update the Members row in the booking summary ── */
      var summaryCard = document.querySelector('#booking-page .booking-summary-card');
      if (!summaryCard) return;

      /* Remove any previously injected member rows */
      summaryCard.querySelectorAll('.bmg-pool-summary-members-row').forEach(function (el) { el.remove(); });

      /* Build the members info block */
      var memberBlock = document.createElement('div');
      memberBlock.className = 'bmg-pool-summary-members-row';
      memberBlock.innerHTML =
        /* separator */
        '<div class="bmg-pool-summary-sep"></div>' +

        /* header: 🏊 Pool Booking · X members */
        '<div class="bmg-pool-summary-badge-row">' +
          '<span class="bmg-pool-summary-type-badge">🏊 Pool Booking</span>' +
          '<span class="bmg-pool-summary-member-badge">' +
            '<i class="fas fa-users" style="font-size:10px;margin-right:3px"></i>' +
            count + ' Member' + (count > 1 ? 's' : '') +
          '</span>' +
        '</div>' +

        /* price breakdown */
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
                '<span>Subtotal</span>' +
                '<span>₹' + total + '</span>' +
              '</div>' +
            '</div>'
          : '') +

        /* member chips */
        '<div class="bmg-pool-summary-chips">' +
          (function () {
            var chips = '';
            for (var m = 1; m <= count; m++) {
              chips += '<span class="bmg-pool-summary-chip">' +
                '<span class="bmg-pool-summary-chip-num">' + m + '</span>' +
                'Member ' + m +
              '</span>';
            }
            return chips;
          })() +
        '</div>';

      /* Insert right before the <hr> / Total Amount row */
      var hr = summaryCard.querySelector('hr');
      if (hr) {
        summaryCard.insertBefore(memberBlock, hr);
      } else {
        summaryCard.appendChild(memberBlock);
      }

    }, 50); /* 50 ms — after original safe() calls finish */
  });


  /* ════════════════════════════════════════════════════════════
   *  PART 3 — Pool Entry Pass (beautiful, swimmer-themed)
   *  showPoolEntryPass(bookingId) — callable from anywhere
   * ════════════════════════════════════════════════════════════*/

  async function showPoolEntryPass(bookingId) {
    if (typeof window.showLoading === 'function') window.showLoading('Generating pool pass…');

    try {
      var db = window.db;
      /* Try pool_bookings first, then bookings collection */
      var booking = null;

      /* Strategy 1: direct doc ID lookup in pool_bookings */
      var directDoc = await db.collection('pool_bookings').doc(bookingId).get()
        .catch(function () { return { exists: false }; });
      if (directDoc.exists) {
        booking = Object.assign({ _docId: directDoc.id }, directDoc.data());
      }

      /* Strategy 2: query by bookingId field */
      if (!booking) {
        var snap1 = await db.collection('pool_bookings')
          .where('bookingId', '==', bookingId).limit(1).get()
          .catch(function () { return { empty: true }; });
        if (!snap1.empty) {
          booking = Object.assign({ _docId: snap1.docs[0].id }, snap1.docs[0].data());
        }
      }

      /* Strategy 3: query by orderId field */
      if (!booking) {
        var snapOrd = await db.collection('pool_bookings')
          .where('orderId', '==', bookingId).limit(1).get()
          .catch(function () { return { empty: true }; });
        if (!snapOrd.empty) {
          booking = Object.assign({ _docId: snapOrd.docs[0].id }, snapOrd.docs[0].data());
        }
      }

      /* Strategy 4: fallback to bookings collection */
      if (!booking) {
        var snap2 = await db.collection('bookings')
          .where('bookingId', '==', bookingId).limit(1).get()
          .catch(function () { return { empty: true }; });
        if (!snap2.empty) booking = Object.assign({ _docId: snap2.docs[0].id }, snap2.docs[0].data());
      }

      if (!booking) {
        if (typeof window.hideLoading === 'function') window.hideLoading();
        if (typeof window.showToast   === 'function') window.showToast('Booking not found', 'error');
        return;
      }

      /* Accept confirmed, completed, or paid — PART 5 writes confirmed directly */
      var bStatCheck = booking.bookingStatus || booking.status || '';
      var isConfirmed = bStatCheck === 'confirmed' || bStatCheck === 'completed' ||
                        booking.paymentStatus === 'paid';
      if (!isConfirmed) {
        if (typeof window.hideLoading === 'function') window.hideLoading();
        if (typeof window.showToast   === 'function')
          window.showToast('Preparing your entry pass…', 'info');
        /* Retry once — direct write may still be in-flight */
        setTimeout(function () { showPoolEntryPass(bookingId); }, 2500);
        return;
      }

      /* QR data */
      var qrData = JSON.stringify({
        app       : 'BookMyGame',
        type      : 'pool_entry',
        bookingId : booking.bookingId,
        poolId    : booking.poolId,
        date      : booking.date,
        slot      : booking.slotTime,
        members   : booking.memberCount || 1,
      });

      var qrDataUrl = '';
      if (typeof QRCode !== 'undefined') {
        try { qrDataUrl = await QRCode.toDataURL(qrData, { width: 220, margin: 2, color: { dark: '#0c4a6e', light: '#f0f9ff' } }); }
        catch (e) { /* QR optional */ }
      }

      var memberCount = booking.memberCount || 1;
      var perPer      = booking.pricePerMember || booking.amount || 0;
      var total       = booking.amount || (perPer * memberCount);

      /* Format date */
      var dateLabel = booking.date || '';
      try {
        dateLabel = new Date(booking.date).toLocaleDateString('en-IN', {
          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
        });
      } catch (e) {}

      var membersHtml = '';
      for (var m = 1; m <= memberCount; m++) {
        membersHtml +=
          '<div class="bmg-pool-pass-member-chip">' +
            '<span class="bmg-pool-pass-member-num">' + m + '</span>' +
            '<span>Member ' + m + '</span>' +
          '</div>';
      }

      var passHtml =
        '<div class="bmg-pool-entry-pass">' +

          /* ── wave header ── */
          '<div class="bmg-pool-pass-header">' +
            '<div class="bmg-pool-pass-wave"></div>' +
            '<div class="bmg-pool-pass-header-content">' +
              '<div class="bmg-pool-pass-app-name">🏊 BOOKMYGAME</div>' +
              '<div class="bmg-pool-pass-title">Pool Entry Pass</div>' +
              '<div class="bmg-pool-pass-subtitle">🎟️ Show this at the pool entrance</div>' +
            '</div>' +
          '</div>' +

          /* ── pool name banner ── */
          '<div class="bmg-pool-pass-venue">' +
            '<div class="bmg-pool-pass-venue-icon">🏖️</div>' +
            '<div>' +
              '<div class="bmg-pool-pass-venue-name">' + _esc(booking.poolName || 'Swimming Pool') + '</div>' +
              '<div class="bmg-pool-pass-venue-addr">' + _esc(booking.poolAddress || '') + '</div>' +
            '</div>' +
          '</div>' +

          /* ── booking details grid ── */
          '<div class="bmg-pool-pass-grid">' +
            '<div class="bmg-pool-pass-cell">' +
              '<div class="bmg-pool-pass-cell-label">📅 Date</div>' +
              '<div class="bmg-pool-pass-cell-value">' + _esc(dateLabel) + '</div>' +
            '</div>' +
            '<div class="bmg-pool-pass-cell">' +
              '<div class="bmg-pool-pass-cell-label">⏰ Time Slot</div>' +
              '<div class="bmg-pool-pass-cell-value">' + _esc(booking.slotTime || '—') + '</div>' +
            '</div>' +
            '<div class="bmg-pool-pass-cell">' +
              '<div class="bmg-pool-pass-cell-label">👤 Booked By</div>' +
              '<div class="bmg-pool-pass-cell-value">' + _esc(booking.userName || 'Guest') + '</div>' +
            '</div>' +
            '<div class="bmg-pool-pass-cell">' +
              '<div class="bmg-pool-pass-cell-label">💰 Total Paid</div>' +
              '<div class="bmg-pool-pass-cell-value bmg-pool-pass-amount">₹' + total + '</div>' +
            '</div>' +
          '</div>' +

          /* ── members allowed section ── */
          '<div class="bmg-pool-pass-members-section">' +
            '<div class="bmg-pool-pass-members-title">' +
              '<span class="bmg-pool-pass-members-badge">' + memberCount + '</span>' +
              ' Member' + (memberCount > 1 ? 's' : '') + ' Allowed' +
            '</div>' +
            '<div class="bmg-pool-pass-member-chips">' + membersHtml + '</div>' +
            (memberCount > 1
              ? '<div class="bmg-pool-pass-per-person">₹' + perPer + '/person</div>'
              : '') +
          '</div>' +

          /* ── QR code ── */
          (qrDataUrl
            ? '<div class="bmg-pool-pass-qr-wrap">' +
                '<div class="bmg-pool-pass-qr-label">Scan at Entry</div>' +
                '<div class="bmg-pool-pass-qr-box">' +
                  '<img src="' + qrDataUrl + '" alt="Entry QR" class="bmg-pool-pass-qr-img">' +
                '</div>' +
              '</div>'
            : '') +

          /* ── booking ID footer ── */
          '<div class="bmg-pool-pass-footer">' +
            '<div class="bmg-pool-pass-id">' +
              '<i class="fas fa-hashtag"></i> ' + _esc(booking.bookingId || '') +
            '</div>' +
            '<div class="bmg-pool-pass-validity">' +
              '<i class="fas fa-shield-alt"></i> Valid for selected slot only' +
            '</div>' +
          '</div>' +

          /* ── pool waves decoration ── */
          '<div class="bmg-pool-pass-bottom-wave">' +
            '<svg viewBox="0 0 400 60" preserveAspectRatio="none">' +
              '<path d="M0,30 C100,60 300,0 400,30 L400,60 L0,60 Z" fill="rgba(14,165,233,0.08)"/>' +
              '<path d="M0,40 C150,10 250,50 400,20 L400,60 L0,60 Z" fill="rgba(14,165,233,0.05)"/>' +
            '</svg>' +
          '</div>' +

        '</div>' + /* end bmg-pool-entry-pass */

        '<button class="bmg-pool-pass-home-btn" id="pool-pass-home-btn">' +
          '<i class="fas fa-home"></i> Back to Home' +
        '</button>';

      var container = document.getElementById('entry-pass-content');
      if (container) {
        container.innerHTML = passHtml;
        var homeBtn = document.getElementById('pool-pass-home-btn');
        if (homeBtn) {
          homeBtn.addEventListener('click', function () {
            if (typeof window.goHome === 'function') window.goHome();
          });
        }
      }

      if (typeof window.hideLoading === 'function') window.hideLoading();
      if (typeof window.showPage === 'function') window.showPage('entry-pass-page');

    } catch (err) {
      if (typeof window.hideLoading === 'function') window.hideLoading();
      if (typeof window.showToast   === 'function') window.showToast('Could not load entry pass', 'error');
      console.error('[pool-fix v6+] showPoolEntryPass error:', err);
    }
  }

  /* Install as the definitive pool entry pass function.
     bmg_pool_entry_fix.js (loads after us) checks if it's already set
     and will NOT overwrite it (we patched that file). */
  window.showPoolEntryPass = showPoolEntryPass;


  /* ════════════════════════════════════════════════════════════
   *  PART 4 — Pool bookings in "My Bookings"
   *  Patches loadUserBookings to ALSO fetch pool_bookings
   * ════════════════════════════════════════════════════════════*/
  function patchLoadUserBookings() {
    var original = window.loadUserBookings;
    if (!original || original._poolPatched) return;
    // sportobook_patches_merged.js now handles pool bookings as a separate section
    // and correctly uses showPoolEntryPass. Mark as patched so we don't double-render.
    window.loadUserBookings._poolPatched = true;
    console.log('[pool-fix v6+] loadUserBookings pool card rendering delegated to sportobook_patches_merged.js');
  }


  /* ════════════════════════════════════════════════════════════
   *  PART 5 — Show Pool Entry Pass immediately after payment
   *  Hooks into bmg:paymentConfirmed for pool bookings
   *  Also writes confirmed status directly so entry pass shows instantly.
   * ════════════════════════════════════════════════════════════*/
  window.addEventListener('bmg:paymentConfirmed', function (e) {
    var detail = e.detail || {};
    var booking = null;

    /* Check if it's a pool booking from sessionStorage */
    try {
      var raw = sessionStorage.getItem('pendingBooking') || sessionStorage.getItem('pendingCashfreeBooking');
      if (raw) booking = JSON.parse(raw);
    } catch (_e) { /* safe */ }

    if (!booking || !booking.isPoolBooking) return;
    if (!booking.bookingId) return;

    var bookingId   = booking.bookingId;
    var slotId      = booking.slotId;
    var memberCount = booking.memberCount || window._poolMemberCount || 1;

    /* FIX: Write confirmed status DIRECTLY to pool_bookings so
       showPoolEntryPass can find it without waiting for the webhook.
       Also update slot currentMembers and status immediately.        */
    (async function () {
      var db = window.db;
      if (!db) return;

      try {
        /* 1. Confirm the booking right now */
        var bookingRef = db.collection('pool_bookings').doc(bookingId);
        var snap       = await bookingRef.get().catch(function () { return null; });

        /* Build confirmed booking data — merge with whatever the webhook will write */
        var confirmedData = Object.assign({}, booking, {
          bookingStatus : 'confirmed',
          status        : 'confirmed',
          paymentStatus : 'paid',
          confirmedAt   : firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt     : firebase.firestore.FieldValue.serverTimestamp(),
        });
        delete confirmedData.pricePerMember; // keep clean

        if (snap && snap.exists) {
          await bookingRef.update({
            bookingStatus : 'confirmed',
            status        : 'confirmed',
            paymentStatus : 'paid',
            confirmedAt   : firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt     : firebase.firestore.FieldValue.serverTimestamp(),
          });
        } else {
          await bookingRef.set(confirmedData, { merge: true });
        }

        console.log('[pool-fix PART5] ✅ Booking confirmed directly:', bookingId);

        /* 2. Update slot members count immediately */
        if (slotId) {
          try {
            var slotRef = db.collection('pool_slots').doc(slotId);
            var slotDoc = await slotRef.get();
            if (slotDoc.exists) {
              var slotData   = slotDoc.data();
              var maxM       = slotData.maxMembers || 50;
              var currentM   = (slotData.currentMembers || 0) + memberCount;
              if (currentM > maxM) currentM = maxM;
              await slotRef.update({
                currentMembers : currentM,
                status         : currentM >= maxM ? 'full' : 'available',
                updatedAt      : firebase.firestore.FieldValue.serverTimestamp(),
              });
              console.log('[pool-fix PART5] Slot updated:', currentM + '/' + maxM);
            }
          } catch (slotErr) {
            console.warn('[pool-fix PART5] slot update error:', slotErr.message);
          }
        }

        /* 3. Show entry pass immediately — no webhook wait needed */
        showPoolEntryPass(bookingId);

      } catch (err) {
        console.warn('[pool-fix PART5] direct confirm error:', err.message);
        /* Fallback: show entry pass after short delay anyway */
        setTimeout(function () { showPoolEntryPass(bookingId); }, 3000);
      }
    })();
  });


  /* ════════════════════════════════════════════════════════════
   *  Boot EXTENSION
   * ════════════════════════════════════════════════════════════*/

  /* Inject member selector whenever pool-page is shown */
  window.addEventListener('bmg:pageShown', function (e) {
    if ((e.detail && e.detail.pageId) !== 'pool-page') return;
    setTimeout(function () {
      window._poolMemberCount = 1;
      injectMemberSelector();
      patchSlotSelectForMembers();
    }, 120);
  });

  /* Patch loadUserBookings once it exists */
  _waitFor('loadUserBookings', patchLoadUserBookings);

  /* Patch book now for member count */
  _waitFor('handlePoolBookNow', patchBookNowForMembers);

  /* ════════════════════════════════════════════════════════════
   *  PATCH loadPoolBookings — remove Cancel button from pool pass
   *  cards rendered by app.js into #pool-passes-list.
   *
   *  app.js renders a "Cancel" button on upcoming pool pass cards
   *  (pool-pass-btn-cancel). We wrap loadPoolBookings so that after
   *  it renders, we strip every cancel button from the list.
   *
   *  Also fixes pool-passes-section visibility: app.js's version
   *  only queries by bookingId field. We make the section show
   *  itself whenever any pool bookings exist for the user.
   * ════════════════════════════════════════════════════════════*/
  function patchLoadPoolBookings() {
    var orig = window.loadPoolBookings;
    if (!orig || orig._bmgPatched) return;

    window.loadPoolBookings = async function (status) {
      // Run original (renders into pool-passes-list)
      try { await orig.apply(this, arguments); } catch (e) { /* ignore */ }

      // Strip all cancel buttons from the rendered pool pass cards
      var poolList = document.getElementById('pool-passes-list');
      if (poolList) {
        poolList.querySelectorAll('.pool-pass-btn-cancel').forEach(function (btn) {
          btn.remove();
        });
      }

      // Ensure the pool-passes-section is visible if there are cards
      var poolSection = document.getElementById('pool-passes-section');
      if (poolSection && poolList && poolList.children.length > 0) {
        // Only show if at least one non-spinner, non-empty-state child exists
        var hasCards = poolList.querySelector('.pool-pass-card, .bk-card, [class*="pool-pass"]');
        if (hasCards) poolSection.style.display = 'block';
      }
    };

    window.loadPoolBookings._bmgPatched = true;
    console.log('[pool-fix v6+] loadPoolBookings patched — cancel button removed');
  }

  _waitFor('loadPoolBookings', patchLoadPoolBookings);

  console.log('✅ [bmg_swimming_pool_fix.js v6+] Extension loaded — members, entry pass, my-bookings integration active');

})();

/* ════════════════════════════════════════════════════════════════════
 *  PART 6 — Secondary reconciliation for pool slot members/status
 *  PART 5 writes slot counts immediately on payment confirmation.
 *  PART 6 runs 5 s later to reconcile from ALL confirmed bookings,
 *  ensuring accuracy even if app.js also did a +1 transaction.
 * ════════════════════════════════════════════════════════════════════*/
(function () {
  'use strict';

  window.addEventListener('bmg:paymentConfirmed', function (e) {
    var pending = null;
    try {
      pending = JSON.parse(
        sessionStorage.getItem('pendingBooking') ||
        sessionStorage.getItem('pendingCashfreeBooking') || 'null'
      );
    } catch (_) {}
    if (!pending || !pending.isPoolBooking) return;

    var slotId = pending.slotId;
    if (!slotId) return;

    var db = window.db;
    if (!db) return;

    /* Run 5 s after payment — by then app.js +1 and PART 5 writes have settled.
       Re-sum from confirmed bookings to get the authoritative count.            */
    setTimeout(async function () {
      try {
        var bookingsSnap = await db.collection('pool_bookings')
          .where('slotId',        '==', slotId)
          .where('bookingStatus', '==', 'confirmed')
          .get()
          .catch(function () { return { empty: true, forEach: function(){} }; });

        var totalMembers = 0;
        bookingsSnap.forEach(function (doc) {
          totalMembers += (doc.data().memberCount || 1);
        });

        if (totalMembers === 0) return; /* nothing confirmed yet — leave as-is */

        var slotRef = db.collection('pool_slots').doc(slotId);
        var slotDoc = await slotRef.get();
        if (!slotDoc.exists) return;

        var max    = slotDoc.data().maxMembers || 50;
        var isFull = totalMembers >= max;

        /* Only update if different from current value to avoid unnecessary writes */
        if (slotDoc.data().currentMembers !== totalMembers ||
            (isFull && slotDoc.data().status !== 'full') ||
            (!isFull && slotDoc.data().status === 'full')) {
          await slotRef.update({
            currentMembers : totalMembers,
            status         : isFull ? 'full' : 'available',
            updatedAt      : firebase.firestore.FieldValue.serverTimestamp(),
          });
          console.log('[pool-fix PART6] Reconciled slot:', totalMembers + '/' + max + (isFull ? ' → FULL' : ' → available'));
        }
      } catch (err) {
        console.warn('[pool-fix PART6] reconcile error:', err.message);
      }
    }, 5000);
  });

  console.log('✅ [bmg_swimming_pool_fix.js PART6] Slot reconciliation loaded');
})();