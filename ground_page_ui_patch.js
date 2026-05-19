/**
 * ground_page_ui_patch.js
 * ─────────────────────────────────────────────────────────────────────
 * Enhances the ground details page slot grid:
 *  1. Groups slots into Morning / Afternoon / Evening periods
 *  2. Shows a legend (Available / Booked / Processing / Passed)
 *  3. Renders each slot as a modern 2-column card with icon + label
 *  4. Adds a "🟢 Live" indicator that blinks in the slots header
 *  5. Updates the sticky Book-Now bar to show selected slot + price
 *
 * LOAD ORDER — add AFTER all other scripts and after bmg_slot_realtime_fix.js:
 *   <script src="ground_page_ui_patch.js"></script>
 * ─────────────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  /* ── wait for a global to exist ──────────────────────────────── */
  function _waitFor(name, cb, n) {
    n = n || 0;
    if (typeof window[name] === 'function') return cb();
    if (n > 80) return;
    setTimeout(function () { _waitFor(name, cb, n + 1); }, 150);
  }

  /* ── slot status meta ────────────────────────────────────────── */
  var STATUS_META = {
    available : { label: 'Available',   icon: '🟢', cls: 'available' },
    booked    : { label: 'Booked',      icon: '🔴', cls: 'booked'    },
    confirmed : { label: 'Booked',      icon: '🔴', cls: 'booked'    },
    pending   : { label: 'Processing…', icon: '🔒', cls: 'pending'   },
    locked    : { label: 'Processing…', icon: '🔒', cls: 'locked'    },
    past      : { label: 'Passed',      icon: '⏳', cls: 'past'      },
    closed    : { label: 'Closed',      icon: '⛔', cls: 'past'      },
    selected  : { label: 'Selected',    icon: '✅', cls: 'selected'  },
  };

  /* ── parse "HH:MM – HH:MM" or "HH:MM-HH:MM" to start hour ──── */
  function startHour(timeStr) {
    var m = (timeStr || '').match(/(\d{1,2})/);
    return m ? parseInt(m[1], 10) : 0;
  }

  /* ── group slots by period ───────────────────────────────────── */
  function groupByPeriod(slots) {
    var groups = { Morning: [], Afternoon: [], Evening: [], Night: [] };
    slots.forEach(function (s) {
      var h = startHour(s.time || s.slotTime || s.startTime || '');
      if (h < 12)      groups.Morning.push(s);
      else if (h < 17) groups.Afternoon.push(s);
      else if (h < 21) groups.Evening.push(s);
      else             groups.Night.push(s);
    });
    return groups;
  }

  /* ── build one slot element ──────────────────────────────────── */
  function makeSlotEl(slotData, onSelect) {
    var rawStatus = (slotData.status || 'available').toLowerCase();
    var meta      = STATUS_META[rawStatus] || STATUS_META.available;
    var timeLabel = slotData.time || slotData.slotTime ||
                    ((slotData.startTime || '') + ' – ' + (slotData.endTime || ''));

    var el = document.createElement('div');
    el.className = 'time-slot ' + meta.cls;
    el.setAttribute('data-slot-time', timeLabel);
    el.setAttribute('data-status', rawStatus);

    el.innerHTML =
      '<div style="flex:1;min-width:0">' +
        '<span class="bmg-s-time">' + timeLabel + '</span>' +
        '<span class="bmg-s-label">' + meta.label + '</span>' +
      '</div>' +
      '<span class="bmg-s-icon" aria-hidden="true">' + meta.icon + '</span>';

    if (rawStatus === 'available') {
      el.style.cursor = 'pointer';
      el.addEventListener('click', function () {
        onSelect(el, slotData, timeLabel);
      });
    }

    return el;
  }

  /* ── build the period label row ──────────────────────────────── */
  function makePeriodLabel(name) {
    var icons = { Morning: '🌅', Afternoon: '☀️', Evening: '🌆', Night: '🌙' };
    var div = document.createElement('div');
    div.className = 'bmg-period-label';
    div.style.cssText =
      'font-size:11px;font-weight:700;color:#9ca3af;letter-spacing:.8px;' +
      'text-transform:uppercase;margin:14px 0 8px;display:flex;align-items:center;gap:6px;';
    div.innerHTML =
      '<span style="flex:1;height:1px;background:#f0f4ff;display:block"></span>' +
      '<span>' + (icons[name] || '') + ' ' + name + '</span>' +
      '<span style="flex:1;height:1px;background:#f0f4ff;display:block"></span>';
    return div;
  }

  /* ── build the legend bar ────────────────────────────────────── */
  function makeLegend() {
    var items = [
      { cls: 'available', label: 'Available' },
      { cls: 'booked',    label: 'Booked'    },
      { cls: 'locked',    label: 'Processing'},
      { cls: 'past',      label: 'Passed'    },
    ];
    var wrap = document.createElement('div');
    wrap.className = 'bmg-slots-legend';
    items.forEach(function (it) {
      var item = document.createElement('div');
      item.className = 'bmg-slots-legend-item';
      item.innerHTML =
        '<div class="bmg-slots-legend-dot ' + it.cls + '"></div>' +
        '<span>' + it.label + '</span>';
      wrap.appendChild(item);
    });
    return wrap;
  }

  /* ── build "🟢 Live" badge ───────────────────────────────────── */
  function makeLiveBadge() {
    var badge = document.createElement('span');
    badge.id  = 'bmg-live-badge';
    badge.style.cssText =
      'font-size:11px;font-weight:700;color:#15803d;background:#f0fdf4;' +
      'border:1px solid #86efac;padding:3px 9px;border-radius:20px;' +
      'display:inline-flex;align-items:center;gap:4px;transition:opacity .3s;';
    badge.innerHTML = '🟢 Live';
    var blink = true;
    setInterval(function () {
      badge.style.opacity = (blink = !blink) ? '1' : '0.35';
    }, 900);
    return badge;
  }

  /* ── update sticky Book-Now bar ──────────────────────────────── */
  function updateStickyBar(timeLabel, price) {
    var btn = document.getElementById('sticky-book-now');
    if (!btn) return;

    /* inject price + slot info above the button if not already done */
    var bar = document.getElementById('sticky-book-btn');
    if (!bar) return;

    var infoEl = bar.querySelector('.bmg-sticky-info');
    if (!infoEl) {
      infoEl = document.createElement('div');
      infoEl.className = 'bmg-sticky-info';
      infoEl.style.cssText =
        'display:flex;justify-content:space-between;align-items:center;' +
        'margin-bottom:8px;padding:0 2px;';
      bar.insertBefore(infoEl, btn);
    }

    infoEl.innerHTML =
      '<div>' +
        '<div style="font-size:10px;color:#9ca3af;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Selected Slot</div>' +
        '<div style="font-size:16px;font-weight:800;color:#0f1f5c;letter-spacing:-.3px">' + (timeLabel || '—') + '</div>' +
      '</div>' +
      '<div style="text-align:right">' +
        '<div style="font-size:10px;color:#9ca3af;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Amount</div>' +
        '<div style="font-size:18px;font-weight:800;color:#2563eb;letter-spacing:-.3px">' + (price ? '₹' + price : '—') + '</div>' +
      '</div>';
  }

  /* ── main renderer: replaces the raw slots grid ─────────────── */
  function enhanceSlotSection(slots, price) {
    var section   = document.querySelector('#ground-page .slots-section');
    var container = document.getElementById('time-slots');
    if (!section || !container) return;

    /* ── header row with live badge ── */
    var h3 = section.querySelector('h3');
    if (h3 && !h3.querySelector('#bmg-live-badge')) {
      h3.style.cssText =
        'display:flex;align-items:center;justify-content:space-between;' +
        'font-size:15px;font-weight:800;color:#0f1f5c;letter-spacing:-.3px;margin-bottom:10px;';
      h3.appendChild(makeLiveBadge());
    }

    /* ── inject legend before the grid ── */
    var existingLegend = section.querySelector('.bmg-slots-legend');
    if (!existingLegend) {
      section.insertBefore(makeLegend(), container);
    }

    /* ── clear and rebuild grid ── */
    container.innerHTML  = '';
    container.style.display = 'block'; /* override grid, we build sub-grids */

    var groups = groupByPeriod(slots);
    var ORDER  = ['Morning', 'Afternoon', 'Evening', 'Night'];

    /* track the currently selected element */
    var selectedEl = null;

    function onSelect(el, slotData, timeLabel) {
      /* deselect previous */
      if (selectedEl) {
        var prev = STATUS_META[selectedEl.dataset.status] || STATUS_META.available;
        selectedEl.className = 'time-slot ' + prev.cls;
        var prevLabel = selectedEl.querySelector('.bmg-s-label');
        var prevIcon  = selectedEl.querySelector('.bmg-s-icon');
        if (prevLabel) prevLabel.textContent = prev.label;
        if (prevIcon)  prevIcon.textContent  = prev.icon;
      }

      /* select new */
      el.className = 'time-slot selected';
      var lbl = el.querySelector('.bmg-s-label');
      var ico = el.querySelector('.bmg-s-icon');
      if (lbl) lbl.textContent = 'Selected';
      if (ico) ico.textContent = '✅';
      selectedEl = el;

      updateStickyBar(timeLabel, price);

      /* expose to app.js via the same globals it already uses */
      window.selectedSlot     = slotData;
      window.selectedSlotTime = timeLabel;

      /* show sticky bar */
      var stickyBar = document.getElementById('sticky-book-btn');
      if (stickyBar) stickyBar.style.display = 'block';

      /* call original selectSlot if it exists */
      if (typeof window.selectSlot === 'function') window.selectSlot(slotData);
    }

    ORDER.forEach(function (period) {
      var group = groups[period];
      if (!group || group.length === 0) return;

      container.appendChild(makePeriodLabel(period));

      var grid = document.createElement('div');
      grid.style.cssText =
        'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:4px;';

      group.forEach(function (s) {
        grid.appendChild(makeSlotEl(s, onSelect));
      });

      container.appendChild(grid);
    });
  }

  /* ════════════════════════════════════════════════════════════
   *  Patch _bmgRenderSlots (the function app.js calls after
   *  every Firestore onSnapshot)
   * ════════════════════════════════════════════════════════════*/
  function patchRenderSlots() {
    var original = window._bmgRenderSlots;

    window._bmgRenderSlots = function (slots, price) {
      /* Call original first so it populates window.bmgSlots etc. */
      if (typeof original === 'function') original.apply(this, arguments);

      /* Then enhance the DOM output */
      var resolvedPrice = price
        || (window.currentGround && window.currentGround.pricePerHour)
        || (window.currentGround && window.currentGround.price)
        || '';

      enhanceSlotSection(slots || window.bmgSlots || [], resolvedPrice);
    };

    if (typeof original === 'function') {
      window._bmgRenderSlots._uiPatched = true;
      console.log('[ground-ui] _bmgRenderSlots patched');
    }
  }

  /* ════════════════════════════════════════════════════════════
   *  Also patch loadSlots so we enhance immediately after it
   *  re-renders (covers the date-change path)
   * ════════════════════════════════════════════════════════════*/
  function patchLoadSlots() {
    var original = window.loadSlots;
    if (!original || original._uiPatched) return;

    window.loadSlots = function () {
      var result = original.apply(this, arguments);
      /* Give Firestore snapshot a moment, then enhance */
      setTimeout(function () {
        var slots = window.bmgSlots || [];
        var price = (window.currentGround && window.currentGround.pricePerHour)
                  || (window.currentGround && window.currentGround.price) || '';
        if (slots.length > 0) enhanceSlotSection(slots, price);
      }, 600);
      return result;
    };
    window.loadSlots._uiPatched = true;
    console.log('[ground-ui] loadSlots patched');
  }

  /* ════════════════════════════════════════════════════════════
   *  Re-enhance whenever the ground page is shown
   * ════════════════════════════════════════════════════════════*/
  window.addEventListener('bmg:pageShown', function (e) {
    if ((e.detail && e.detail.pageId) !== 'ground-page') return;
    setTimeout(function () {
      var slots = window.bmgSlots || [];
      var price = (window.currentGround && window.currentGround.pricePerHour)
                || (window.currentGround && window.currentGround.price) || '';
      if (slots.length > 0) enhanceSlotSection(slots, price);
    }, 400);
  });

  /* ════════════════════════════════════════════════════════════
   *  Boot
   * ════════════════════════════════════════════════════════════*/
  _waitFor('_bmgRenderSlots', patchRenderSlots);
  _waitFor('loadSlots',       patchLoadSlots);

  console.log('✅ [ground_page_ui_patch.js] Loaded — enhanced slot UI active');

})();