/**
 * bmg_bookings_fix.js  — v2
 * ═══════════════════════════════════════════════════════════════
 *
 *  ROOT CAUSE
 *  ──────────
 *  app.js line 10000-10007 tries to "extend" loadUserBookings:
 *
 *    const originalLoadUserBookings = loadUserBookings;   // line 10000
 *    async function loadUserBookings(status) {            // hoisted! wins
 *        await originalLoadUserBookings(status);          // calls ITSELF
 *    }
 *
 *  JS function declarations hoist before const assignments, so
 *  originalLoadUserBookings === the new function => infinite recursion.
 *
 *  bmg_pool_entry_fix.js then wraps it a second time, creating
 *  three layers all calling each other.
 *
 *  THE FIX
 *  ───────
 *  Hard-replace window.loadUserBookings with a single clean function
 *  containing the full Firestore logic directly — no wrapper chains.
 *  Set _poolPatched=true so bmg_pool_entry_fix.js won't re-wrap it.
 *
 *  Also fixes: showPoolEntryPass crash "Cannot read properties of
 *  undefined (reading 'status')" caused by JSON serialisation loss
 *  when passing booking objects through onclick HTML attributes.
 *
 *  LOAD ORDER: LAST <script> in index.html, after bmg_pool_entry_fix.js
 *    <script src="bmg_bookings_fix.js"></script>
 * ═══════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  function _waitFor(name, cb, n) {
    n = n || 0;
    if (typeof window[name] === 'function') { cb(); return; }
    if (n > 150) { console.warn('[bookings-fix] gave up waiting for', name); return; }
    setTimeout(function () { _waitFor(name, cb, n + 1); }, 100);
  }

  /* ════════════════════════════════════════════════════════════
   *  CLEAN COMBINED loadUserBookings
   *  Contains all logic directly — zero wrapper chains.
   * ════════════════════════════════════════════════════════════*/
  async function safeLoadUserBookings(status) {
    console.log('[bookings-fix] safeLoadUserBookings:', status);

    var db          = window.db;
    var currentUser = window.currentUser || (window.auth && window.auth.currentUser);

    if (!currentUser) {
      if (typeof window.showToast === 'function') window.showToast('Please login to view bookings', 'warning');
      if (typeof window.showPage  === 'function') window.showPage('login-page');
      return;
    }

    window.currentBookingStatus = status;

    try {
      if (typeof window.updatePastBookingsStatus === 'function') {
        await window.updatePastBookingsStatus();
      }
    } catch(e) {}

    var container = document.getElementById('user-bookings-list');
    if (!container) { console.error('[bookings-fix] user-bookings-list not found'); return; }

    container.innerHTML =
      '<div class="loading-spinner"><div class="loader-spinner"></div>' +
      '<p>Loading your bookings...</p></div>';

    /* ── PART 1: Ground / Sports bookings ─────────────────── */
    try {
      var snapshot = await db.collection('bookings')
        .where('userId', '==', currentUser.uid)
        .orderBy('createdAt', 'desc')
        .get();

      console.log('[bookings-fix] ground bookings found:', snapshot.size);

      var today = new Date().toISOString().split('T')[0];
      var bookings = [];
      snapshot.forEach(function(doc) {
        var d = doc.data();
        bookings.push(Object.assign({ id: doc.id, dateStr: d.date || '' }, d));
      });

      var filtered = bookings.filter(function(b) {
        var isPast      = b.dateStr < today;
        var isCompleted = b.bookingStatus === 'completed';
        var isCancelled = b.bookingStatus === 'cancelled';
        var isConfirmed = b.bookingStatus === 'confirmed';
        if (status === 'upcoming') return b.dateStr >= today && isConfirmed;
        if (status === 'past')     return isPast || isCompleted || isCancelled;
        return false;
      });

      filtered.sort(function(a, b) {
        return status === 'past'
          ? new Date(b.dateStr) - new Date(a.dateStr)
          : new Date(a.dateStr) - new Date(b.dateStr);
      });

      if (filtered.length === 0) {
        container.innerHTML =
          '<div class="empty-state">' +
            '<i class="fas fa-calendar-' + (status === 'upcoming' ? 'day' : 'check') + '"></i>' +
            '<h3>No ' + status + ' bookings</h3>' +
            '<p>' + (status === 'upcoming' ? 'You have no upcoming bookings.' : 'You have no past bookings.') + '</p>' +
            (status === 'past'
              ? '<button class="auth-btn" onclick="loadUserBookings(\'upcoming\')" style="margin-top:var(--space-lg)">View Upcoming</button>'
              : '') +
          '</div>';
      } else {
        var sportIcons = {
          cricket:'🏏',football:'⚽',badminton:'🏸',tennis:'🎾',
          basketball:'🏀',volleyball:'🏐',swimming:'🏊',multi:'🎯'
        };
        var statusConfig = {
          confirmed:       { icon:'fa-check-circle',   label:'Confirmed',       cls:'confirmed' },
          pending_payment: { icon:'fa-hourglass-half', label:'Pending Payment', cls:'pending'   },
          cancelled:       { icon:'fa-times-circle',   label:'Cancelled',       cls:'cancelled' },
          completed:       { icon:'fa-flag-checkered', label:'Completed',       cls:'completed' }
        };

        var html = '';
        filtered.forEach(function(booking) {
          var sc = statusConfig[booking.bookingStatus] ||
                   { icon:'fa-circle', label: booking.bookingStatus || 'Unknown', cls:'pending' };
          var sportIcon = sportIcons[(booking.sportType||'').toLowerCase()] || '🏟️';
          var formattedDate = booking.dateStr;
          try {
            formattedDate = new Date(booking.dateStr).toLocaleDateString('en-IN', {
              weekday:'long', day:'numeric', month:'long', year:'numeric'
            });
          } catch(e) {}
          var isOld = booking.dateStr < today && booking.bookingStatus !== 'completed';
          var fmt = typeof window.formatCurrency === 'function'
            ? window.formatCurrency(booking.amount || 0) : ('₹' + (booking.amount || 0));

          html +=
            '<div class="bk-card bk-card--' + sc.cls + '">' +
              '<div class="bk-card__header">' +
                '<div class="bk-card__sport-badge">' + sportIcon + '</div>' +
                '<div class="bk-card__title-block">' +
                  '<div class="bk-card__ground-name">' + (booking.groundName || 'Ground') + '</div>' +
                  '<div class="bk-card__venue-name">' + (booking.venueName || 'Venue') + '</div>' +
                '</div>' +
                '<div class="bk-card__status-pill bk-card__status-pill--' + sc.cls + '">' +
                  '<i class="fas ' + sc.icon + '"></i> ' + sc.label +
                '</div>' +
              '</div>' +
              '<div class="bk-card__divider"></div>' +
              '<div class="bk-card__details">' +
                '<div class="bk-card__detail-row"><span class="bk-card__detail-icon"><i class="fas fa-calendar-alt"></i></span><span class="bk-card__detail-text">' + formattedDate + '</span></div>' +
                '<div class="bk-card__detail-row"><span class="bk-card__detail-icon"><i class="fas fa-clock"></i></span><span class="bk-card__detail-text">' + (booking.slotTime || 'Time TBD') + '</span></div>' +
                '<div class="bk-card__detail-row"><span class="bk-card__detail-icon"><i class="fas fa-map-marker-alt"></i></span><span class="bk-card__detail-text">' + (booking.groundAddress || booking.venueAddress || 'Address not available') + '</span></div>' +
                '<div class="bk-card__detail-row"><span class="bk-card__detail-icon"><i class="fas fa-rupee-sign"></i></span><span class="bk-card__detail-text bk-card__amount">' + fmt + '</span>' +
                  (booking.appliedOffer ? '<span class="bk-card__offer-chip"><i class="fas fa-gift"></i> Offer Applied</span>' : '') +
                '</div>' +
              '</div>' +
              (isOld ? '<div class="bk-card__alert"><i class="fas fa-exclamation-circle"></i> Booking date has passed</div>' : '') +
              '<div class="bk-card__footer">' +
                '<span class="bk-card__booking-id"><i class="fas fa-hashtag"></i> ' + (booking.bookingId || 'N/A').slice(-10) + '</span>' +
                (booking.bookingStatus === 'confirmed'
                  ? '<button class="bk-card__pass-btn" onclick="showEntryPass(\'' + booking.bookingId + '\')"><i class="fas fa-qrcode"></i> Entry Pass</button>' : '') +
                (booking.bookingStatus === 'completed'
                  ? '<span class="bk-card__done-chip"><i class="fas fa-check-double"></i> Completed</span>' : '') +
                (booking.bookingStatus === 'cancelled'
                  ? '<span class="bk-card__cancel-chip"><i class="fas fa-ban"></i> Cancelled</span>' : '') +
              '</div>' +
            '</div>';
        });

        container.innerHTML = html;
      }

    } catch(err) {
      console.error('[bookings-fix] ground bookings error:', err);
      container.innerHTML =
        '<div class="empty-state"><i class="fas fa-exclamation-circle"></i>' +
        '<h3>Error Loading Bookings</h3><p>' + err.message + '</p>' +
        '<button class="auth-btn" onclick="loadUserBookings(\'' + status + '\')" style="margin-top:var(--space-lg)">Retry</button></div>';
    }

    /* ── PART 2: Pool bookings ─────────────────────────────────────
     * Pool cards are rendered by sportobook_patches_merged.js as a
     * clearly-labelled "Swimming Pool Bookings" section appended to
     * user-bookings-list (same list, just below ground bookings).
     * We do NOT duplicate them here. We only populate the separate
     * pool-passes-section / pool-passes-list that app.js's original
     * loadPoolBookings() targets, which shows them in the dedicated
     * section BESIDE the ground bookings (not below).
     * ──────────────────────────────────────────────────────────── */
    try {
      /* Populate dedicated pool-passes-list panel if it exists */
      if (typeof window.loadPoolBookings === 'function') {
        window.loadPoolBookings(status);
      }
    } catch(err) {
      console.warn('[bookings-fix] loadPoolBookings error:', err.message);
    }
  }

  /* Mark so bmg_pool_entry_fix.js won't wrap it */
  safeLoadUserBookings._poolPatched = true;
  safeLoadUserBookings._bmgFixed    = true;

  /* ════════════════════════════════════════════════════════════
   *  Fix showPoolEntryPass — unified null-safe wrapper
   *
   *  bmg_swimming_pool_fix.js sets the primary 1-arg version:
   *    showPoolEntryPass(bookingId) — queries pool_bookings itself.
   *  This wrapper accepts both (bookingId) and (docId, bookingData)
   *  call styles and always routes to the primary 1-arg function.
   *
   *  This eliminates the "Cannot read properties of undefined
   *  (reading 'status')" crash caused by passing stale booking
   *  objects from onclick HTML attributes.
   * ════════════════════════════════════════════════════════════*/
  function patchShowPoolEntryPass() {
    var primary = window.showPoolEntryPass;
    if (!primary || primary._fixPatched) return;

    window.showPoolEntryPass = async function(docIdOrBookingId, bookingDataArg) {
      /* When called with 2 args (old onclick pattern) derive the
         bookingId from the data object and call the primary 1-arg
         version — which does its own fresh Firestore lookup.        */
      var bookingId = docIdOrBookingId;
      if (bookingDataArg && typeof bookingDataArg === 'object') {
        bookingId = bookingDataArg.bookingId || bookingDataArg.orderId || docIdOrBookingId;
      }
      if (!bookingId) {
        if (typeof window.showToast === 'function') window.showToast('Pool booking not found', 'error');
        return;
      }
      return primary.call(this, bookingId);
    };

    window.showPoolEntryPass._fixPatched = true;
    console.log('[bookings-fix] showPoolEntryPass unified wrapper installed');
  }

  /* ════════════════════════════════════════════════════════════
   *  Install — wait for app.js, then hard-replace last
   * ════════════════════════════════════════════════════════════*/
  function install() {
    window.loadUserBookings = safeLoadUserBookings;
    console.log('[bookings-fix] ✅ safeLoadUserBookings installed');

    /* Re-wire tab buttons */
    ['bookings-upcoming', 'bookings-past'].forEach(function(id) {
      var btn = document.getElementById(id);
      if (!btn) return;
      var fresh = btn.cloneNode(true);
      btn.parentNode.replaceChild(fresh, btn);
      fresh.addEventListener('click', function() {
        document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
        fresh.classList.add('active');
        safeLoadUserBookings(id === 'bookings-upcoming' ? 'upcoming' : 'past');
      });
    });
  }

  /* Re-assert every time bookings-page is shown */
  window.addEventListener('bmg:pageShown', function(e) {
    if (!e.detail || e.detail.pageId !== 'bookings-page') return;
    setTimeout(function() {
      window.loadUserBookings = safeLoadUserBookings;
      safeLoadUserBookings('upcoming');
    }, 150);
  });

  /* Boot */
  _waitFor('loadUserBookings', function() {
    setTimeout(install, 350); /* after all other wrappers finish */
  });

  _waitFor('showPoolEntryPass', function() {
    setTimeout(patchShowPoolEntryPass, 350);
  });

  console.log('✅ [bmg_bookings_fix.js v2] Loaded');

})();