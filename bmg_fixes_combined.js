/* bmg_fixes_combined.js — extracted from sportobook_master.js
 */

/**
 * ═══════════════════════════════════════════════════════════════════
 *  bmg_fixes_combined.js  —  BookMyGame All Patches Bundle
 * ═══════════════════════════════════════════════════════════════════
 *
 *  Replaces these files (do NOT load them separately):
 *    bmg_auth_fix.js
 *    bmg_bookings_fix.js
 *    bmg_qrcode_fix.js
 *    bmg_slot_realtime_fix.js
 *    bmg_swimming_pool_fix.js
 *    bmg_pool_entry_fix.js
 *    bmg_pool_pass_fix.js
 *    bmg_firestore_cache.js
 *    comprehensive_fixes.js
 *    grounds_carousel_patch.js
 *    ground_page_ui_patch.js
 *
 *  LOAD ORDER in index.html (end of <body>):
 *    <script src="paymentService.js"></script>
 *    <script src="app.js"></script>
 *    <script src="sportobook_patches_merged.js"></script>
 *    <script src="bmg_fixes_combined.js"></script>   ← this file, LAST
 *
 * ═══════════════════════════════════════════════════════════════════
 */



/* ═══════════════════════════════════════════════════════════════════
 * ██ bmg_auth_fix.js
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * bmg_auth_fix.js
 * ─────────────────────────────────────────────────────────────
 * Fixes two bugs:
 *
 * BUG 1 — Sign-in button stops working after logout
 *   CAUSE: initPremiumAuth() only runs once on DOMContentLoaded.
 *   After logout, showPage('login-page') shows the form but the
 *   submit handler is gone (the cloned node has no listeners).
 *   FIX: Re-wire login form every time login-page is shown via
 *   the bmg:pageShown event that showPage() already dispatches.
 *
 * BUG 2 — Owner registration redirects to login without creating account
 *   CAUSE: The second initPremiumAuth() (duplicate definition) wires
 *   #register-form to a function called handleRegister — which does
 *   not exist. Only handleUserRegister exists.
 *   FIX: Alias handleRegister → handleUserRegister, and also re-wire
 *   the owner registration forms (venue + plot) every time those pages
 *   are shown, since they suffer the same lost-listener problem.
 *
 * LOAD ORDER: Add LAST in index.html, after all other scripts:
 *   <script src="bmg_auth_fix.js"></script>
 * ─────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  /* ── 1. Alias missing handleRegister ───────────────────────
   * The duplicate initPremiumAuth references window.handleRegister
   * which was never defined. Map it to the real function.          */
  function ensureHandleRegisterAlias() {
    if (typeof window.handleRegister !== 'function') {
      if (typeof window.handleUserRegister === 'function') {
        window.handleRegister = window.handleUserRegister;
        console.log('[BMG Auth Fix] handleRegister aliased → handleUserRegister');
      } else {
        // handleUserRegister not yet defined — retry shortly
        setTimeout(ensureHandleRegisterAlias, 200);
      }
    }
  }
  ensureHandleRegisterAlias();


  /* ── 2. Wire (or re-wire) a form safely ────────────────────
   * Clones the element to strip stale listeners, then attaches
   * the given handler. Returns the new element.                    */
  function wireForm(id, handler) {
    const el = document.getElementById(id);
    if (!el || typeof handler !== 'function') return null;
    const fresh = el.cloneNode(true);
    el.parentNode.replaceChild(fresh, el);
    fresh.addEventListener('submit', handler);
    return fresh;
  }

  function wireButton(selector, handler) {
    const el = document.querySelector(selector);
    if (!el || typeof handler !== 'function') return null;
    const fresh = el.cloneNode(true);
    el.parentNode.replaceChild(fresh, el);
    fresh.addEventListener('click', function (e) {
      e.preventDefault();
      handler(e);
    });
    return fresh;
  }


  /* ── 3. Re-wire login page every time it is shown ──────────*/
  function rewireLoginPage() {
    // Login form
    const loginForm = wireForm('login-form', function (e) {
      e.preventDefault();
      if (typeof window.handleLogin === 'function') window.handleLogin(e);
      else console.error('[BMG Auth Fix] handleLogin not found');
    });
    if (loginForm) {
      // Also wire the submit button directly as a fallback
      const btn = loginForm.querySelector('.auth-btn-premium');
      if (btn) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          loginForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });
      }
      console.log('[BMG Auth Fix] Login form re-wired');
    }

    // Register form (user registration)
    const registerForm = wireForm('register-form', function (e) {
      e.preventDefault();
      const fn = window.handleUserRegister || window.handleRegister;
      if (typeof fn === 'function') fn(e);
      else console.error('[BMG Auth Fix] handleUserRegister not found');
    });
    if (registerForm) {
      const btn = registerForm.querySelector('.auth-btn-premium');
      if (btn) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          registerForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });
      }
      console.log('[BMG Auth Fix] Register form re-wired');
    }

    // Google sign-in buttons
    document.querySelectorAll('#google-signin-btn, #google-signin-btn-register').forEach(btn => {
      const fresh = btn.cloneNode(true);
      btn.parentNode.replaceChild(fresh, btn);
      fresh.addEventListener('click', function (e) {
        e.preventDefault();
        if (typeof window.handleGoogleSignIn === 'function') window.handleGoogleSignIn(e);
      });
    });

    // Forgot password
    const forgotLink = document.getElementById('forgot-password-link');
    if (forgotLink) {
      const fresh = forgotLink.cloneNode(true);
      forgotLink.parentNode.replaceChild(fresh, forgotLink);
      fresh.addEventListener('click', function (e) {
        e.preventDefault();
        if (typeof window.handleForgotPassword === 'function') window.handleForgotPassword(e);
      });
    }

    // Owner registration link
    const ownerLink = document.getElementById('show-owner-register-link');
    if (ownerLink) {
      const fresh = ownerLink.cloneNode(true);
      ownerLink.parentNode.replaceChild(fresh, ownerLink);
      fresh.addEventListener('click', function (e) {
        e.preventDefault();
        if (typeof window.showOwnerTypeSelection === 'function') window.showOwnerTypeSelection();
      });
    }
  }


  /* ── 4. Re-wire owner registration forms when shown ────────
   * These forms also lose their handlers after navigation.         */
  function rewireVenueOwnerPage() {
    const form = wireForm('venue-owner-register-form', function (e) {
      e.preventDefault();
      if (typeof window.handleVenueOwnerRegister === 'function') window.handleVenueOwnerRegister(e);
      else console.error('[BMG Auth Fix] handleVenueOwnerRegister not found');
    });
    if (form) {
      // Wire the submit button too
      const btn = form.querySelector('[type="submit"], .auth-btn-premium, .register-btn');
      if (btn) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });
      }
      console.log('[BMG Auth Fix] Venue owner form re-wired');
    }
  }

  function rewirePlotOwnerPage() {
    const form = wireForm('plot-owner-register-form', function (e) {
      e.preventDefault();
      if (typeof window.handlePlotOwnerRegister === 'function') window.handlePlotOwnerRegister(e);
      else console.error('[BMG Auth Fix] handlePlotOwnerRegister not found');
    });
    if (form) {
      const btn = form.querySelector('[type="submit"], .auth-btn-premium, .register-btn');
      if (btn) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });
      }
      console.log('[BMG Auth Fix] Plot owner form re-wired');
    }
  }


  /* ── 5. Listen to bmg:pageShown and re-wire on every visit ─
   * showPage() already dispatches this event — we just react.      */
  window.addEventListener('bmg:pageShown', function (e) {
    const pageId = e.detail?.pageId;
    switch (pageId) {
      case 'login-page':
        // Small delay so any other initPremiumAuth call finishes first,
        // then we overwrite with correct handlers
        setTimeout(rewireLoginPage, 80);
        break;
      case 'venue-owner-register-page':
        setTimeout(rewireVenueOwnerPage, 80);
        break;
      case 'plot-owner-register-page':
        setTimeout(rewirePlotOwnerPage, 80);
        break;
    }
  });


  /* ── 6. Also run immediately on DOMContentLoaded ───────────
   * Covers the very first page load.                              */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(rewireLoginPage, 150);
      setTimeout(rewireVenueOwnerPage, 150);
      setTimeout(rewirePlotOwnerPage, 150);
    });
  } else {
    setTimeout(rewireLoginPage, 150);
    setTimeout(rewireVenueOwnerPage, 150);
    setTimeout(rewirePlotOwnerPage, 150);
  }


  console.log('✅ [bmg_auth_fix.js] Loaded — login + owner registration forms will re-wire on every page visit');

})();


/* ═══════════════════════════════════════════════════════════════════
 * ██ bmg_bookings_fix.js
 * ═══════════════════════════════════════════════════════════════════ */

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


/* ═══════════════════════════════════════════════════════════════════
 * ██ bmg_qrcode_fix.js
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * bmg_qrcode_fix.js
 * ═══════════════════════════════════════════════════════════════
 *
 *  PROBLEM
 *  ───────
 *  index.html loads THREE conflicting QR libraries:
 *
 *    1. qrcode@1.5.1      (jsdelivr)  → QRCode.toDataURL()  ✅ has toDataURL
 *    2. html5-qrcode@2.3.4            → scanner only, different object
 *    3. qrcodejs@1.0.0    (jsdelivr)  → new QRCode(el,opts)  ❌ NO toDataURL
 *
 *  qrcodejs loads LAST and overwrites window.QRCode with its own
 *  constructor. That constructor has no .toDataURL() method, so every
 *  call to QRCode.toDataURL(...) throws:
 *    "TypeError: QRCode.toDataURL is not a function"
 *
 *  app.js line 10078, 10211 and bmg_pool_entry_fix.js line 557 all
 *  call QRCode.toDataURL() and all crash with this error.
 *
 *  THE FIX
 *  ───────
 *  After all scripts load, if window.QRCode.toDataURL is missing we
 *  add it. The polyfill uses whichever working strategy is available:
 *
 *    Strategy A — qrcode@1.5.1 is still reachable as window._QRCodeLib
 *                 (we save it before qrcodejs overwrites it, see below)
 *    Strategy B — use the DOM-based qrcodejs: render into a hidden <div>,
 *                 grab the <img> src or <canvas> toDataURL(), return it.
 *    Strategy C — fetch the qrcode@1.5.1 bundle dynamically and use it.
 *
 *  We also save the real qrcode@1.5.1 reference in a <script> tag
 *  inserted between the two cdn tags, so Strategy A is always available.
 *
 *  LOAD ORDER — LAST <script> in index.html (after bmg_bookings_fix.js):
 *    <script src="bmg_qrcode_fix.js"></script>
 *
 * ═══════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  /* ── Save reference to qrcode@1.5.1 if it is currently window.QRCode
     (i.e. we are running before qrcodejs loads, which won't happen if
     we are the last script — but the MutationObserver trick below
     handles that case).
     In practice, since we load LAST, qrcodejs has already won.        */
  var _qrLib = window._QRCodeLib || null;   // may be pre-saved by inline script

  /* ════════════════════════════════════════════════════════════
   *  Core helper: generate a QR data URL from a string.
   *  Returns a Promise<string>.
   * ════════════════════════════════════════════════════════════*/
  function generateQRDataURL(text, opts) {
    opts = opts || {};
    var size = opts.width || opts.size || 200;

    /* ── Strategy A: qrcode@1.5.1 toDataURL (Promise-based) ── */
    if (_qrLib && typeof _qrLib.toDataURL === 'function') {
      return _qrLib.toDataURL(text, { width: size, margin: opts.margin || 2 });
    }

    /* ── Strategy B: qrcode@1.5.1 toDataURL on window.QRCode ─ */
    if (window.QRCode && typeof window.QRCode.toDataURL === 'function') {
      return window.QRCode.toDataURL(text, { width: size, margin: opts.margin || 2 });
    }

    /* ── Strategy C: qrcodejs DOM-based → extract canvas dataURL ─
       qrcodejs renders into a DOM element. We create a hidden div,
       let it render, then pull the canvas/img data URL out.         */
    if (window.QRCode && typeof window.QRCode === 'function') {
      return new Promise(function (resolve, reject) {
        var host = document.createElement('div');
        host.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:' + size + 'px;height:' + size + 'px;';
        document.body.appendChild(host);

        try {
          new window.QRCode(host, {
            text          : text,
            width         : size,
            height        : size,
            colorDark     : '#000000',
            colorLight    : '#ffffff',
            correctLevel  : (window.QRCode.CorrectLevel && window.QRCode.CorrectLevel.H) || 1
          });
        } catch (e) {
          document.body.removeChild(host);
          reject(new Error('qrcodejs render failed: ' + e.message));
          return;
        }

        /* qrcodejs renders synchronously into a <canvas> or <img>.
           Give it one tick to finish, then extract the data URL.   */
        setTimeout(function () {
          try {
            var canvas = host.querySelector('canvas');
            var img    = host.querySelector('img');
            var url;

            if (canvas) {
              url = canvas.toDataURL('image/png');
            } else if (img && img.src && img.src.indexOf('data:') === 0) {
              url = img.src;
            } else if (img && img.src) {
              /* Image is loading — wait for it */
              img.onload = function () {
                var c2 = document.createElement('canvas');
                c2.width  = size;
                c2.height = size;
                c2.getContext('2d').drawImage(img, 0, 0, size, size);
                document.body.removeChild(host);
                resolve(c2.toDataURL('image/png'));
              };
              img.onerror = function () {
                document.body.removeChild(host);
                reject(new Error('qrcodejs img load failed'));
              };
              return;
            } else {
              throw new Error('qrcodejs produced no canvas or img');
            }

            document.body.removeChild(host);
            resolve(url);
          } catch (e2) {
            try { document.body.removeChild(host); } catch(_) {}
            reject(e2);
          }
        }, 50);
      });
    }

    /* ── Strategy D: dynamic load of qrcode@1.5.1 ─────────── */
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';
      s.onload = function () {
        /* After load, QRCode may have been overwritten again — use the
           module's own exported object if available via require-style  */
        var lib = window.QRCode;
        if (lib && typeof lib.toDataURL === 'function') {
          lib.toDataURL(text, { width: size, margin: opts.margin || 2 })
             .then(resolve).catch(reject);
        } else {
          reject(new Error('Dynamic QRCode load: toDataURL still missing'));
        }
      };
      s.onerror = function () { reject(new Error('Failed to load qrcode dynamically')); };
      document.head.appendChild(s);
    });
  }

  /* ════════════════════════════════════════════════════════════
   *  Polyfill: add toDataURL to whatever window.QRCode is now
   *  (i.e. qrcodejs which lacks it).
   * ════════════════════════════════════════════════════════════*/
  function installPolyfill() {
    if (!window.QRCode) return;

    if (typeof window.QRCode.toDataURL !== 'function') {
      window.QRCode.toDataURL = function (text, opts) {
        return generateQRDataURL(text, opts);
      };
      console.log('[qrcode-fix] QRCode.toDataURL polyfill installed');
    }

    /* Also expose the helper globally for any custom code */
    window._bmgGenerateQR = generateQRDataURL;
  }

  /* ════════════════════════════════════════════════════════════
   *  Save qrcode@1.5.1 reference BEFORE it potentially gets
   *  overwritten. We do this by checking now; if the current
   *  QRCode already has toDataURL it IS the 1.5.1 version —
   *  save it before qrcodejs loads.
   *  (When this file loads last, qrcodejs has already won, so
   *   we rely on Strategy B/C above instead.)
   * ════════════════════════════════════════════════════════════*/
  if (window.QRCode && typeof window.QRCode.toDataURL === 'function') {
    _qrLib = window.QRCode;
    window._QRCodeLib = _qrLib;
    console.log('[qrcode-fix] qrcode@1.5.1 saved as window._QRCodeLib');
  }

  /* Install immediately if DOM is ready, else after load */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installPolyfill);
  } else {
    installPolyfill();
  }
  /* Also re-run after window load in case qrcodejs loads late */
  window.addEventListener('load', installPolyfill);

  console.log('✅ [bmg_qrcode_fix.js] Loaded — QRCode.toDataURL will be available');

})();


/* ═══════════════════════════════════════════════════════════════════
 * ██ bmg_slot_realtime_fix.js
 * ═══════════════════════════════════════════════════════════════════ */

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


/* ═══════════════════════════════════════════════════════════════════
 * ██ bmg_swimming_pool_fix.js
 * ═══════════════════════════════════════════════════════════════════ */

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

    /* Book-Now button wiring (re-wire on every pool-page visit) */
    function _wireBookNowBtn() {
      var btn = document.getElementById('pool-book-now-btn');
      if (!btn) return;
      // Use shared rewire fn from app.js so all patches cooperate via window.handlePoolBookNow
      if (typeof window._bmgRewirePoolBookBtn === 'function') {
        window._bmgRewirePoolBookBtn();
        return;
      }
      // Fallback if app.js not yet loaded
      var fresh = btn.cloneNode(true);
      btn.parentNode.replaceChild(fresh, btn);
      fresh.addEventListener('click', function () {
        if (typeof window.handlePoolBookNow === 'function') {
          window.handlePoolBookNow();
        }
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

    /* Ensure member count is baked into slot before book now fires.
       We no longer clone/rewire the button here to avoid conflicting with
       other patch files. Instead we patch window.handlePoolBookNow once. */

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


  /* ════════════════════════════
   *  PART 5 — Show Pool Entry Pass immediately after payment
   *  Hooks into bmg:paymentConfirmed for pool bookings.
   *
   *  FIXED: The Firestore pool_bookings write was REMOVED from this handler.
   *  It caused a double-confirmation per payment because:
   *    1. sportobook_combined_patches.js PART3 (finalisePoolBooking) already
   *       writes and confirms the pool_bookings doc authoritatively.
   *    2. This PART5 handler was ALSO writing the same doc again.
   *  The double-write caused ownerAmount to be counted twice in the earnings
   *  dashboard and showed double the correct amount in the owner withdraw tab.
   *
   *  PART5 now ONLY triggers showPoolEntryPass (delayed 1.5s so PART3 can
   *  finish writing the confirmed doc before the pass page reads it).
   * ════════════════════════════*/
  window.addEventListener('bmg:paymentConfirmed', function (e) {
    var booking = null;
    try {
      var raw = sessionStorage.getItem('pendingBooking') || sessionStorage.getItem('pendingCashfreeBooking');
      if (raw) booking = JSON.parse(raw);
    } catch (_e) {}
    if (!booking || !booking.isPoolBooking || !booking.bookingId) return;
    var bookingId = booking.bookingId;
    /* Delay 1.5s so PART3/finalisePoolBooking finishes the confirmed doc first */
    setTimeout(function () {
      console.log('[pool-fix PART5] Showing entry pass for:', bookingId);
      if (typeof showPoolEntryPass === 'function') showPoolEntryPass(bookingId);
    }, 1500);
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


/* ═══════════════════════════════════════════════════════════════════
 * ██ bmg_pool_entry_fix.js
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * bmg_pool_entry_fix.js
 * ═══════════════════════════════════════════════════════════════════
 *
 *  FIXES:
 *
 *  FIX 1 — Pool Entry Pass "Booking not found"
 *    CAUSE: showEntryPass() only queries the 'bookings' collection.
 *    Pool bookings are in 'pool_bookings'. So pool entry passes always
 *    return "Booking not found".
 *    FIX: Patch showEntryPass() to also check pool_bookings if the
 *    ground bookings query returns empty.
 *
 *  FIX 2 — Water Park themed entry pass for pool bookings
 *    Pool entry passes now render with a water park / aqua theme:
 *    animated wave background, blue gradient, swim icons, member count.
 *
 *  FIX 3 — Pool slots show real member counts + "Fully Booked" state
 *    The slot cards already show currentMembers/maxMembers from Firestore.
 *    This patch ensures the "Fully Booked" label renders distinctly and
 *    the my-bookings view shows pool bookings with an aqua "Pool Pass" button.
 *
 *  FIX 4 — My Bookings: Pool bookings appear with "Pool Pass" button
 *    loadUserBookings() only reads 'bookings'. We patch it to also merge
 *    pool_bookings for the current user so they show in My Bookings.
 *
 *  LOAD ORDER — last <script> in index.html, after all other scripts:
 *    <script src="bmg_pool_entry_fix.js"></script>
 * ═══════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  /* ── wait helper ─────────────────────────────────────────────────*/
  function _waitFor(name, cb, n) {
    n = n || 0;
    if (typeof window[name] === 'function') return cb();
    if (n > 80) { console.warn('[pool-fix] gave up waiting for', name); return; }
    setTimeout(function () { _waitFor(name, cb, n + 1); }, 150);
  }

  /* ════════════════════════════════════════════════════════════════
   *  FIX 2 — Water Park Entry Pass HTML builder
   * ════════════════════════════════════════════════════════════════*/
  function buildPoolEntryPassHTML(booking, qrDataUrl) {
    var slotTime   = booking.slotTime || booking.slot || '—';
    var poolName   = booking.poolName || booking.groundName || 'Swimming Pool';
    var userName   = booking.userName || 'Guest';
    var date       = booking.date || '—';
    var bookingId  = booking.bookingId || booking.orderId || booking.id || '—';
    var address    = booking.address || booking.poolAddress || booking.groundAddress || '';
    var members    = booking.currentMembers != null ? booking.currentMembers : '—';
    var maxMembers = booking.maxMembers || '—';
    var amount     = booking.amount ? '₹' + booking.amount : '—';

    return `
<style>
  /* ── Pool Entry Pass – Water Park Theme ─────────────────────── */
  @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;700;800;900&family=Pacifico&display=swap');

  .pool-pass-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0 0 32px;
    background: linear-gradient(180deg,#0369a1 0%,#0284c7 40%,#e0f2fe 100%);
    min-height: 100%;
    font-family: 'Nunito', sans-serif;
  }

  /* wave top banner */
  .pool-pass-banner {
    width: 100%;
    background: linear-gradient(135deg,#0c4a6e,#0369a1,#0284c7,#0ea5e9);
    padding: 28px 20px 48px;
    text-align: center;
    position: relative;
    overflow: hidden;
  }
  .pool-pass-banner::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 0;
    right: 0;
    height: 40px;
    background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1440 40'%3E%3Cpath fill='%23bae6fd' d='M0,20 C360,40 720,0 1080,20 C1260,30 1380,26 1440,20 L1440,40 L0,40Z'/%3E%3C/svg%3E") no-repeat bottom/cover;
  }
  /* Bubble decorations */
  .pool-pass-banner::before {
    content: '🫧  🫧    🫧';
    position: absolute;
    top: 12px;
    left: 0;
    right: 0;
    text-align: center;
    font-size: 20px;
    opacity: 0.35;
    letter-spacing: 16px;
    animation: bubbleRise 3s ease-in-out infinite alternate;
  }
  @keyframes bubbleRise {
    from { transform: translateY(0); opacity: 0.35; }
    to   { transform: translateY(-6px); opacity: 0.55; }
  }

  .pool-pass-icon {
    font-size: 52px;
    margin-bottom: 8px;
    filter: drop-shadow(0 4px 8px rgba(0,0,0,0.3));
    animation: swimBob 2s ease-in-out infinite alternate;
  }
  @keyframes swimBob {
    from { transform: translateY(0) rotate(-3deg); }
    to   { transform: translateY(-6px) rotate(3deg); }
  }
  .pool-pass-title {
    font-family: 'Pacifico', cursive;
    font-size: 22px;
    color: #fff;
    letter-spacing: 1px;
    margin: 0 0 4px;
    text-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }
  .pool-pass-subtitle {
    font-size: 12px;
    color: #bae6fd;
    font-weight: 700;
    letter-spacing: 2px;
    text-transform: uppercase;
    margin: 0;
  }

  /* card body */
  .pool-pass-card {
    background: #fff;
    border-radius: 28px;
    margin: -8px 16px 0;
    box-shadow: 0 20px 60px rgba(3,105,161,0.25);
    overflow: hidden;
    width: calc(100% - 32px);
    max-width: 400px;
    position: relative;
  }
  /* side perforations */
  .pool-pass-card::before,
  .pool-pass-card::after {
    content: '';
    position: absolute;
    top: 50%;
    width: 24px;
    height: 24px;
    background: linear-gradient(180deg,#0284c7,#e0f2fe);
    border-radius: 50%;
    transform: translateY(-50%);
  }
  .pool-pass-card::before { left: -12px; }
  .pool-pass-card::after  { right: -12px; }

  /* header strip inside card */
  .pool-pass-card-head {
    background: linear-gradient(135deg,#0369a1,#0ea5e9);
    padding: 14px 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .pool-pass-status-chip {
    background: rgba(255,255,255,0.2);
    border: 1.5px solid rgba(255,255,255,0.5);
    color: #fff;
    font-size: 11px;
    font-weight: 800;
    padding: 4px 12px;
    border-radius: 20px;
    letter-spacing: 0.5px;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .pool-pass-status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #4ade80;
    animation: statusPulse 1.5s ease-in-out infinite;
  }
  @keyframes statusPulse {
    0%,100% { box-shadow: 0 0 0 0 rgba(74,222,128,0.5); }
    50%      { box-shadow: 0 0 0 5px rgba(74,222,128,0); }
  }
  .pool-pass-card-pool-name {
    color: #fff;
    font-size: 14px;
    font-weight: 800;
    max-width: 55%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* dashed divider (ticket tear line) */
  .pool-pass-tear {
    border: none;
    border-top: 2.5px dashed #bae6fd;
    margin: 0;
  }

  /* details grid */
  .pool-pass-details {
    padding: 18px 20px 12px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px 12px;
  }
  .pool-pass-detail-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .pool-pass-detail-item.full-width {
    grid-column: 1 / -1;
  }
  .pool-pass-detail-label {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #0ea5e9;
  }
  .pool-pass-detail-value {
    font-size: 14px;
    font-weight: 800;
    color: #0c4a6e;
  }
  .pool-pass-detail-value.booking-id {
    font-size: 10px;
    font-weight: 700;
    color: #64748b;
    word-break: break-all;
  }

  /* members bar */
  .pool-members-bar-wrap {
    margin: 0 20px 14px;
    background: #f0f9ff;
    border-radius: 12px;
    padding: 10px 14px;
    border: 1.5px solid #bae6fd;
  }
  .pool-members-bar-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }
  .pool-members-label {
    font-size: 10px;
    font-weight: 700;
    color: #0284c7;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .pool-members-count {
    font-size: 13px;
    font-weight: 800;
    color: #0c4a6e;
  }
  .pool-members-bar {
    height: 8px;
    background: #e0f2fe;
    border-radius: 4px;
    overflow: hidden;
  }
  .pool-members-bar-fill {
    height: 100%;
    background: linear-gradient(90deg,#0ea5e9,#06b6d4);
    border-radius: 4px;
    transition: width 1s ease;
  }

  /* QR section */
  .pool-pass-qr-section {
    padding: 0 20px 18px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  .pool-pass-qr-wrap {
    background: #fff;
    border: 3px solid #0ea5e9;
    border-radius: 16px;
    padding: 10px;
    box-shadow: 0 8px 24px rgba(14,165,233,0.2);
  }
  .pool-pass-qr-wrap img {
    display: block;
    width: 160px;
    height: 160px;
    border-radius: 8px;
  }
  .pool-pass-scan-hint {
    font-size: 11px;
    font-weight: 700;
    color: #64748b;
    letter-spacing: 0.5px;
    display: flex;
    align-items: center;
    gap: 5px;
  }

  /* validity strip */
  .pool-pass-validity {
    background: linear-gradient(135deg,#0c4a6e,#0369a1);
    margin: 0 20px 20px;
    border-radius: 14px;
    padding: 10px 16px;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    font-weight: 700;
    color: #bae6fd;
  }
  .pool-pass-validity-icon { font-size: 16px; }

  /* wave footer decoration */
  .pool-pass-footer-waves {
    width: 100%;
    text-align: center;
    font-size: 28px;
    letter-spacing: 8px;
    opacity: 0.6;
    margin-top: 16px;
    animation: waveAnim 2.5s ease-in-out infinite alternate;
  }
  @keyframes waveAnim {
    from { letter-spacing: 6px; }
    to   { letter-spacing: 12px; }
  }

  /* back button */
  .pool-pass-back-btn {
    margin: 16px auto 0;
    display: block;
    background: rgba(255,255,255,0.15);
    border: 2px solid rgba(255,255,255,0.5);
    color: #fff;
    font-family: 'Nunito', sans-serif;
    font-size: 14px;
    font-weight: 800;
    padding: 12px 32px;
    border-radius: 50px;
    cursor: pointer;
    letter-spacing: 0.3px;
    transition: all .2s;
    backdrop-filter: blur(8px);
  }
  .pool-pass-back-btn:hover {
    background: rgba(255,255,255,0.25);
  }
</style>

<div class="pool-pass-wrap">
  <!-- Banner -->
  <div class="pool-pass-banner">
    <div class="pool-pass-icon">🏊</div>
    <div class="pool-pass-title">Pool Entry Pass</div>
    <p class="pool-pass-subtitle">BookMyGame · AquaSport</p>
  </div>

  <!-- Card -->
  <div class="pool-pass-card">

    <!-- Card header strip -->
    <div class="pool-pass-card-head">
      <span class="pool-pass-card-pool-name">${poolName}</span>
      <div class="pool-pass-status-chip">
        <div class="pool-pass-status-dot"></div>
        CONFIRMED
      </div>
    </div>

    <!-- Tear line -->
    <hr class="pool-pass-tear">

    <!-- Details -->
    <div class="pool-pass-details">
      <div class="pool-pass-detail-item">
        <span class="pool-pass-detail-label">👤 Name</span>
        <span class="pool-pass-detail-value">${userName}</span>
      </div>
      <div class="pool-pass-detail-item">
        <span class="pool-pass-detail-label">📅 Date</span>
        <span class="pool-pass-detail-value">${date}</span>
      </div>
      <div class="pool-pass-detail-item">
        <span class="pool-pass-detail-label">⏰ Time Slot</span>
        <span class="pool-pass-detail-value">${slotTime}</span>
      </div>
      <div class="pool-pass-detail-item">
        <span class="pool-pass-detail-label">💰 Amount</span>
        <span class="pool-pass-detail-value">${amount}</span>
      </div>
      ${address ? `
      <div class="pool-pass-detail-item full-width">
        <span class="pool-pass-detail-label">📍 Location</span>
        <span class="pool-pass-detail-value" style="font-size:12px">${address}</span>
      </div>` : ''}
      <div class="pool-pass-detail-item full-width">
        <span class="pool-pass-detail-label">🎫 Booking ID</span>
        <span class="pool-pass-detail-value booking-id">${bookingId}</span>
      </div>
    </div>

    <!-- Member count bar -->
    <div class="pool-members-bar-wrap">
      <div class="pool-members-bar-row">
        <span class="pool-members-label">🫧 Session Members</span>
        <span class="pool-members-count">${members} / ${maxMembers}</span>
      </div>
      <div class="pool-members-bar">
        <div class="pool-members-bar-fill" id="pool-pass-members-fill" style="width:${members !== '—' && maxMembers !== '—' ? Math.min(Math.round((parseInt(members)/parseInt(maxMembers))*100), 100) : 0}%"></div>
      </div>
    </div>

    <!-- Tear line -->
    <hr class="pool-pass-tear">

    <!-- QR Code -->
    <div class="pool-pass-qr-section">
      <div class="pool-pass-qr-wrap">
        <img src="${qrDataUrl}" alt="Entry QR Code">
      </div>
      <div class="pool-pass-scan-hint">🔍 Scan to verify at pool entrance</div>
    </div>

    <!-- Validity -->
    <div class="pool-pass-validity">
      <span class="pool-pass-validity-icon">⏱️</span>
      Valid: 15 min before to 1 hr after your slot
    </div>
  </div>

  <!-- Footer decoration -->
  <div class="pool-pass-footer-waves">🌊🌊🌊</div>
</div>
`;
  }


  /* ════════════════════════════════════════════════════════════════
   *  FIX 1 — Patch showEntryPass to also check pool_bookings
   * ════════════════════════════════════════════════════════════════*/
  function patchShowEntryPass() {
    var original = window.showEntryPass;
    if (!original) {
      console.warn('[pool-fix] showEntryPass not found, retrying...');
      setTimeout(patchShowEntryPass, 300);
      return;
    }

    window.showEntryPass = async function (bookingId) {
      var db = window.db;
      if (!db || !bookingId) { return original.apply(this, arguments); }

      // First check if it's a pool booking
      try {
        // Try by document ID directly (orderId is used as doc ID for pool bookings)
        var poolDoc = await db.collection('pool_bookings').doc(bookingId).get().catch(function() { return null; });

        // If not found by doc ID, try by bookingId field
        if (!poolDoc || !poolDoc.exists) {
          var poolSnap = await db.collection('pool_bookings')
            .where('bookingId', '==', bookingId)
            .get()
            .catch(function() { return null; });
          if (poolSnap && !poolSnap.empty) {
            poolDoc = poolSnap.docs[0];
          }
        }

        // Also try orderId field
        if (!poolDoc || !poolDoc.exists) {
          var poolSnap2 = await db.collection('pool_bookings')
            .where('orderId', '==', bookingId)
            .get()
            .catch(function() { return null; });
          if (poolSnap2 && !poolSnap2.empty) {
            poolDoc = poolSnap2.docs[0];
          }
        }

        if (poolDoc && poolDoc.exists) {
          // It's a pool booking — render water park pass
          await showPoolEntryPass(poolDoc.id, poolDoc.data());
          return;
        }
      } catch (err) {
        console.warn('[pool-fix] pool booking check error:', err.message);
      }

      // Not a pool booking — fall through to original (ground bookings)
      return original.apply(this, arguments);
    };

    window.showEntryPass._poolPatched = true;
    console.log('[pool-fix] FIX 1: showEntryPass patched to check pool_bookings');
  }

  async function showPoolEntryPass(docId, booking) {
    if (typeof window.showLoading === 'function') window.showLoading('Generating pool pass...');

    try {
      var db = window.db;

      // Validate status
      var status = booking.status || booking.bookingStatus || '';
      if (status !== 'confirmed') {
        if (typeof window.hideLoading === 'function') window.hideLoading();
        if (typeof window.showToast === 'function') window.showToast('Pool pass available only for confirmed bookings', 'warning');
        return;
      }

      // Fetch real-time member count from pool_slots
      var memberCount   = booking.currentMembers;
      var maxMembers    = booking.maxMembers;
      if (booking.slotId) {
        try {
          var slotDoc = await db.collection('pool_slots').doc(booking.slotId).get();
          if (slotDoc.exists) {
            memberCount = slotDoc.data().currentMembers || memberCount;
            maxMembers  = slotDoc.data().maxMembers     || maxMembers;
          }
        } catch(e) { /* ignore */ }
      }

      var enrichedBooking = Object.assign({}, booking, {
        currentMembers: memberCount,
        maxMembers:     maxMembers
      });

      // Build QR data
      var qrData = JSON.stringify({
        appId:     'BookMyGame',
        type:      'pool',
        bookingId: booking.bookingId || booking.orderId || docId,
        poolId:    booking.poolId,
        date:      booking.date,
        slot:      booking.slotTime
      });

      // Use Promise form of QRCode.toDataURL (bmg_qrcode_fix.js polyfill is Promise-based)
      var qrDataUrl = await (function() {
        try {
          var result = QRCode.toDataURL(qrData, { width: 200, margin: 2 });
          // If it returned a Promise, use it; if it returned a string (sync), wrap it
          if (result && typeof result.then === 'function') return result;
          return Promise.resolve(result);
        } catch(e) {
          return Promise.reject(new Error('QRCode generation failed: ' + e.message));
        }
      })();

      // Render into entry-pass-content container (reuse existing page)
      var container = document.getElementById('entry-pass-content');
      if (container) {
        container.innerHTML = buildPoolEntryPassHTML(enrichedBooking, qrDataUrl);
        // Wire back button
        var backBtn = container.querySelector('.pool-pass-back-btn');
        if (backBtn) {
          backBtn.addEventListener('click', function () {
            if (typeof window.goHome === 'function') window.goHome();
          });
        }
      }

      if (typeof window.hideLoading === 'function') window.hideLoading();
      if (typeof window.showPage   === 'function') window.showPage('entry-pass-page');

    } catch (err) {
      if (typeof window.hideLoading === 'function') window.hideLoading();
      if (typeof window.showToast   === 'function') window.showToast('Could not generate pool pass: ' + err.message, 'error');
      console.error('[pool-fix] showPoolEntryPass error:', err);
    }
  }


  /* ════════════════════════════════════════════════════════════════
   *  FIX 4 — Pool bookings in My Bookings
   *  DISABLED: sportobook_patches_merged.js renders the swimming pool
   *  section and bmg_bookings_fix.js calls loadPoolBookings for the
   *  dedicated pool-passes panel. Enabling this would create duplicate
   *  pool cards in user-bookings-list. Skip entirely.
   * ════════════════════════════════════════════════════════════════*/
  function patchLoadUserBookings() {
    // Pool card rendering is handled by sportobook_patches_merged.js.
    // Mark as patched immediately so no further wrappers re-enable it.
    if (window.loadUserBookings && !window.loadUserBookings._poolPatched) {
      window.loadUserBookings._poolPatched = true;
    }
    console.log('[pool-fix] FIX 4: Skipped — pool cards handled by sportobook_patches_merged.js');
    return;
    // ── DISABLED CODE BELOW (kept for reference) ──
    var original = window.loadUserBookings;
    if (!original) {
      console.warn('[pool-fix] loadUserBookings not found, retrying...');
      setTimeout(patchLoadUserBookings, 300);
      return;
    }
    if (original._poolPatched) return;

    window.loadUserBookings = async function (status) {
      // Run original first
      await original.apply(this, arguments);

      // Then append pool bookings into the same container
      var db   = window.db;
      var user = window.currentUser || (window.auth && window.auth.currentUser);
      if (!db || !user) return;

      try {
        var snap = await db.collection('pool_bookings')
          .where('userId', '==', user.uid)
          .orderBy('createdAt', 'desc')
          .get()
          .catch(function(e) {
            // Index may not exist yet — fallback without orderBy
            return db.collection('pool_bookings').where('userId', '==', user.uid).get();
          });

        if (snap.empty) return;

        var container = document.getElementById('user-bookings-list');
        if (!container) return;

        // Remove "no bookings" empty state if we have pool bookings
        var emptyState = container.querySelector('.empty-state');

        var today = new Date().toISOString().split('T')[0];

        snap.forEach(function (doc) {
          var b = doc.data();
          b.id  = doc.id;

          var bookingDate = b.date || '';
          var bStatus     = b.status || b.bookingStatus || '';
          var isPast      = bookingDate < today;
          var isCancelled = bStatus === 'cancelled';
          var isConfirmed = bStatus === 'confirmed';

          // Filter same way as original
          if (status === 'upcoming' && !(bookingDate >= today && isConfirmed)) return;
          if (status === 'past'     && !(isPast || bStatus === 'completed' || isCancelled)) return;
          if (status === 'cancelled' && !isCancelled) return;

          // Remove empty-state if we have at least one pool booking to show
          if (emptyState) { emptyState.remove(); emptyState = null; }

          var bookingId = b.bookingId || b.orderId || doc.id;
          var card = document.createElement('div');
          card.className = 'bk-card bk-card--' + (isConfirmed ? 'confirmed' : 'pending');
          card.style.cssText = 'border-top: 3px solid #0ea5e9; margin-bottom: 12px;';

          card.innerHTML = [
            '<div class="bk-card__header">',
              '<div class="bk-card__sport-badge">🏊</div>',
              '<div class="bk-card__title-block">',
                '<div class="bk-card__ground-name">' + (b.poolName || 'Swimming Pool') + '</div>',
                '<div class="bk-card__venue-name" style="color:#0ea5e9">Swimming Pool Booking</div>',
              '</div>',
              '<div class="bk-card__status-pill bk-card__status-pill--' + (isConfirmed ? 'confirmed' : 'pending') + '">',
                '<i class="fas ' + (isConfirmed ? 'fa-check-circle' : 'fa-hourglass-half') + '"></i>',
                ' ' + (isConfirmed ? 'Confirmed' : (bStatus || 'Pending')),
              '</div>',
            '</div>',
            '<div class="bk-card__divider"></div>',
            '<div class="bk-card__details">',
              '<div class="bk-card__detail-row">',
                '<span class="bk-card__detail-icon"><i class="fas fa-calendar-alt"></i></span>',
                '<span class="bk-card__detail-text">' + (bookingDate || 'Date TBD') + '</span>',
              '</div>',
              '<div class="bk-card__detail-row">',
                '<span class="bk-card__detail-icon"><i class="fas fa-clock"></i></span>',
                '<span class="bk-card__detail-text">' + (b.slotTime || 'Time TBD') + '</span>',
              '</div>',
              (b.address ? '<div class="bk-card__detail-row"><span class="bk-card__detail-icon"><i class="fas fa-map-marker-alt"></i></span><span class="bk-card__detail-text">' + b.address + '</span></div>' : ''),
              '<div class="bk-card__detail-row">',
                '<span class="bk-card__detail-icon"><i class="fas fa-rupee-sign"></i></span>',
                '<span class="bk-card__detail-text bk-card__amount">₹' + (b.amount || 0) + '</span>',
              '</div>',
            '</div>',
            '<div class="bk-card__footer">',
              '<span class="bk-card__booking-id"><i class="fas fa-hashtag"></i> ' + bookingId.slice(-10) + '</span>',
              isConfirmed
                ? '<button class="bk-card__pass-btn" onclick="showEntryPass(\'' + bookingId + '\')" style="background:linear-gradient(135deg,#0369a1,#0ea5e9);"><i class="fas fa-swimmer"></i> Pool Pass</button>'
                : '',
            '</div>'
          ].join('');

          container.appendChild(card);
        });

      } catch (err) {
        console.warn('[pool-fix] loadUserBookings pool append error:', err.message);
      }
    };

    window.loadUserBookings._poolPatched = true;
    console.log('[pool-fix] FIX 4: loadUserBookings patched to include pool_bookings');
  }


  /* ════════════════════════════════════════════════════════════════
   *  FIX 3 — Enhance "Fully Booked" slot visual
   *  The renderPoolSlots function already uses pool-full class.
   *  We inject CSS to make it visually distinct.
   * ════════════════════════════════════════════════════════════════*/
  function injectPoolSlotCSS() {
    if (document.getElementById('bmg-pool-fix-css')) return;
    var style = document.createElement('style');
    style.id = 'bmg-pool-fix-css';
    style.textContent = [
      /* Fully booked slot: red/gray strikethrough style */
      '.bmg-pool-slot.pool-full {',
        'background: linear-gradient(135deg,#fef2f2,#fff1f2) !important;',
        'border: 2px solid #fca5a5 !important;',
        'cursor: not-allowed !important;',
        'opacity: 0.85;',
        'position: relative;',
        'overflow: hidden;',
      '}',
      '.bmg-pool-slot.pool-full .bmg-pool-slot-time {',
        'text-decoration: line-through;',
        'color: #ef4444 !important;',
      '}',
      '.bmg-pool-slot.pool-full .bmg-pool-slot-full-ribbon {',
        'position: absolute;',
        'top: 0; right: 0;',
        'background: #ef4444;',
        'color: #fff;',
        'font-size: 9px;',
        'font-weight: 900;',
        'padding: 3px 10px;',
        'border-bottom-left-radius: 10px;',
        'letter-spacing: 1px;',
      '}',
      /* member count styling */
      '.bmg-pool-slot-members {',
        'font-size: 11px !important;',
        'font-weight: 700 !important;',
        'display: flex !important;',
        'align-items: center !important;',
        'gap: 4px !important;',
        'margin: 3px 0 !important;',
      '}',
      /* progress bar enhancement */
      '.bmg-pool-slot-progress-wrap {',
        'height: 6px !important;',
        'border-radius: 3px !important;',
        'overflow: hidden !important;',
        'background: rgba(0,0,0,0.08) !important;',
        'margin-top: 6px !important;',
      '}',
      '.bmg-pool-slot-progress-fill {',
        'height: 100% !important;',
        'border-radius: 3px !important;',
        'transition: width 0.5s ease !important;',
      '}',
      '.bmg-pool-slot.pool-open .bmg-pool-slot-progress-fill { background: linear-gradient(90deg,#22c55e,#4ade80) !important; }',
      '.bmg-pool-slot.pool-filling .bmg-pool-slot-progress-fill { background: linear-gradient(90deg,#f59e0b,#fbbf24) !important; }',
      '.bmg-pool-slot.pool-full .bmg-pool-slot-progress-fill { background: linear-gradient(90deg,#ef4444,#f87171) !important; }',
      /* Pool Pass button in my-bookings */
      '.bk-card__pass-btn { transition: all .2s !important; }',
      '.bk-card__pass-btn:hover { transform: translateY(-1px) !important; filter: brightness(1.1) !important; }',
    ].join('\n');
    document.head.appendChild(style);
    console.log('[pool-fix] FIX 3: Pool slot CSS injected');
  }


  /* ════════════════════════════════════════════════════════════════
   *  FIX 5 — Owner QR scanner: verify swimming pool entry passes
   *
   *  ROOT CAUSE: processVerifiedQRCode() only queries COLLECTIONS.BOOKINGS
   *  (ground bookings). Pool QR codes have { type:'pool' } and no
   *  validFrom/validTo timestamps, so they fail at SECURITY CHECK 2
   *  ("QR Code is not valid yet") before ever reaching the DB query.
   *
   *  FIX: Patch processVerifiedQRCode to detect type:'pool' first and
   *  route to a dedicated pool verifier that:
   *    1. Skips timestamp checks (pool passes have no validFrom/validTo)
   *    2. Queries pool_bookings by bookingId
   *    3. Verifies the owner owns the pool (swimming_pools.ownerId)
   *    4. Confirms booking status and marks entryStatus:'used'
   *    5. Shows the same professional verification result modal
   * ════════════════════════════════════════════════════════════════*/

  async function verifyPoolEntryQR(qrObject) {
    var db = window.db;
    var currentUser = window.currentUser || (window.auth && window.auth.currentUser);

    if (!currentUser) {
      throw new Error('Please log in to verify pool entries');
    }

    var bookingId = qrObject.bookingId || qrObject.orderId;
    if (!bookingId) {
      throw new Error('Invalid pool QR code — missing booking ID');
    }

    // ── Find the pool booking ─────────────────────────────────
    var poolBookingDoc = null;

    // Try by doc ID first (orderId is used as doc ID)
    try {
      var byId = await db.collection('pool_bookings').doc(bookingId).get();
      if (byId.exists) poolBookingDoc = byId;
    } catch(e) { /* permission or not found */ }

    // Try by bookingId field
    if (!poolBookingDoc) {
      try {
        var byField = await db.collection('pool_bookings')
          .where('bookingId', '==', bookingId)
          .get();
        if (!byField.empty) poolBookingDoc = byField.docs[0];
      } catch(e) { /* ignore */ }
    }

    // Try by orderId field
    if (!poolBookingDoc) {
      try {
        var byOrder = await db.collection('pool_bookings')
          .where('orderId', '==', bookingId)
          .get();
        if (!byOrder.empty) poolBookingDoc = byOrder.docs[0];
      } catch(e) { /* ignore */ }
    }

    if (!poolBookingDoc || !poolBookingDoc.exists) {
      throw new Error('Pool booking not found. Please check the booking ID.');
    }

    var booking = poolBookingDoc.data();

    // ── Verify owner owns this pool ───────────────────────────
    var poolId = booking.poolId || qrObject.poolId;
    if (poolId) {
      try {
        var poolDoc = await db.collection('swimming_pools').doc(poolId).get();
        if (poolDoc.exists && poolDoc.data().ownerId !== currentUser.uid) {
          throw new Error('You can only verify entries for your own pools');
        }
      } catch(e) {
        if (e.message.indexOf('your own pools') !== -1) throw e;
        // If we can't read the pool doc (permissions), allow owner identified by booking.ownerId
        if (booking.ownerId && booking.ownerId !== currentUser.uid) {
          throw new Error('You can only verify entries for your own pools');
        }
      }
    } else if (booking.ownerId && booking.ownerId !== currentUser.uid) {
      throw new Error('You can only verify entries for your own pools');
    }

    // ── Check booking status ──────────────────────────────────
    var status = booking.status || booking.bookingStatus || '';
    if (status !== 'confirmed') {
      throw new Error('Pool booking is not confirmed. Current status: ' + (status || 'unknown'));
    }

    // ── Check date ────────────────────────────────────────────
    var today = new Date().toISOString().split('T')[0];
    if (booking.date && booking.date !== today) {
      throw new Error('This pool pass is for ' + booking.date + '. Today is ' + today + '.');
    }

    // ── Check if already used ─────────────────────────────────
    if (booking.entryStatus === 'used') {
      throw new Error('This pool pass has already been used for entry');
    }

    // ── Mark as used ──────────────────────────────────────────
    var updateData = {
      entryStatus  : 'used',
      entryTime    : firebase.firestore.FieldValue.serverTimestamp(),
      verifiedBy   : currentUser.uid,
      verifiedByName: currentUser.ownerName || currentUser.name || 'Owner',
      verifiedAt   : firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt    : firebase.firestore.FieldValue.serverTimestamp()
    };

    await poolBookingDoc.ref.update(updateData);

    // ── Build result object compatible with showVerificationResult ──
    return {
      isPool       : true,
      userName     : booking.userName || booking.name || 'Guest',
      userPhone    : booking.userPhone || booking.phone || '',
      bookingId    : booking.bookingId || booking.orderId || poolBookingDoc.id,
      date         : booking.date || today,
      slotTime     : booking.slotTime || booking.slot || '',
      amount       : booking.amount || 0,
      poolName     : booking.poolName || 'Swimming Pool',
      currentMembers: booking.currentMembers,
      maxMembers   : booking.maxMembers,
      entryTime    : new Date()
    };
  }


  /* ── Patch processVerifiedQRCode to handle pool type ─────────── */
  function patchProcessVerifiedQRCode() {
    var original = window.processVerifiedQRCode;
    if (!original || original._poolPatched) return;

    window.processVerifiedQRCode = async function(qrData) {
      // Try to parse and detect pool type
      var qrObject;
      try { qrObject = JSON.parse(qrData); } catch(e) { qrObject = null; }

      // Route pool QR codes to our pool verifier
      if (qrObject && (qrObject.type === 'pool' || qrObject.type === 'pool_booking')) {
        var showVerification = window.showVerificationResult;
        var closeScannerFn  = window.closeProfessionalQRScanner;

        try {
          // Validate app ID
          if (!qrObject.appId || qrObject.appId !== 'BookMyGame') {
            throw new Error('This QR code was not generated by BookMyGame');
          }

          var poolBooking = await verifyPoolEntryQR(qrObject);

          // Close scanner
          if (typeof closeScannerFn === 'function') closeScannerFn();

          // Show success using the existing showVerificationResult, but with pool data
          if (typeof showVerification === 'function') {
            // Adapt to the ground booking shape expected by showVerificationResult
            var fakeBooking = {
              userName   : poolBooking.userName,
              userPhone  : poolBooking.userPhone,
              bookingId  : poolBooking.bookingId,
              date       : poolBooking.date,
              slotTime   : poolBooking.slotTime,
              amount     : poolBooking.amount,
              entryTime  : { toDate: function() { return poolBooking.entryTime; } },
              _isPool    : true,
              _poolName  : poolBooking.poolName
            };
            showVerification(true, fakeBooking);
          } else {
            _showPoolVerificationSuccess(poolBooking);
          }

        } catch(err) {
          console.error('[pool-fix] Pool QR verification error:', err);
          if (typeof closeScannerFn === 'function') closeScannerFn();
          if (typeof showVerification === 'function') {
            showVerification(false, null, err.message);
          } else {
            if (typeof window.showToast === 'function') window.showToast('Verification failed: ' + err.message, 'error');
          }
        }

        return; // handled
      }

      // Not a pool QR — fall through to original ground verification
      return original.apply(this, arguments);
    };

    window.processVerifiedQRCode._poolPatched = true;
    console.log('[pool-fix] FIX 5: processVerifiedQRCode patched for pool QR verification');
  }

  // Fallback success UI if showVerificationResult not available
  function _showPoolVerificationSuccess(booking) {
    var modal = document.getElementById('verification-result-modal');
    var body  = document.getElementById('verification-result-body');
    var title = document.getElementById('result-title');
    var sub   = document.getElementById('bmg-verify-subtitle');
    var hdr   = document.getElementById('verification-result-header');

    if (hdr)   hdr.className = 'bmg-verify-header';
    if (title) title.textContent = '🏊 Pool Entry Verified!';
    if (sub)   sub.textContent  = 'Access Authorized ✓';

    if (body) {
      var time = booking.entryTime ? booking.entryTime.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' }) : '';
      body.innerHTML =
        '<div class="booking-detail-card success-card">' +
          '<div class="success-animation"><i class="fas fa-check-circle"></i></div>' +
          '<h4>Pool Entry Allowed</h4>' +
          '<p>Verified at ' + time + '</p>' +
        '</div>' +
        '<div class="booking-detail-card">' +
          '<div class="detail-row"><i class="fas fa-user"></i><div>' +
            '<span class="detail-label">Customer</span>' +
            '<span class="detail-value">' + (booking.userName || 'N/A') + '</span>' +
          '</div></div>' +
          '<div class="detail-row"><i class="fas fa-swimmer"></i><div>' +
            '<span class="detail-label">Pool</span>' +
            '<span class="detail-value">' + (booking.poolName || 'Swimming Pool') + '</span>' +
          '</div></div>' +
          '<div class="detail-row"><i class="fas fa-clock"></i><div>' +
            '<span class="detail-label">Time Slot</span>' +
            '<span class="detail-value">' + (booking.slotTime || 'N/A') + '</span>' +
          '</div></div>' +
        '</div>';
    }

    if (modal) {
      modal.classList.add('active');
      document.body.style.overflow = 'hidden';
    }
  }


  /* ════════════════════════════════════════════════════════════════
   *  FIX 6 — Professional, compact QR scanner UI
   *
   *  The scanner modal opens full-screen on mobile because:
   *    - .modal fills 100vw/100vh
   *    - .qr-scanner-container has no max-height
   *    - #professional-qr-reader has min-height:400px
   *
   *  We inject CSS overrides to make the scanner a compact bottom-sheet
   *  style card: max 480px wide, max 90vh tall, centered, with a proper
   *  camera window that's square and sized to fit the screen neatly.
   * ════════════════════════════════════════════════════════════════*/
  function injectScannerUI() {
    if (document.getElementById('bmg-scanner-pro-css')) return;
    var style = document.createElement('style');
    style.id = 'bmg-scanner-pro-css';
    style.textContent = [
      /* ── Modal backdrop ── */
      '#professional-qr-modal {',
        'display: none;',
        'position: fixed !important;',
        'inset: 0 !important;',
        'background: rgba(0,0,0,0.75) !important;',
        'backdrop-filter: blur(4px) !important;',
        '-webkit-backdrop-filter: blur(4px) !important;',
        'z-index: 10000 !important;',
        'align-items: flex-end !important;',
        'justify-content: center !important;',
        'padding: 0 !important;',
      '}',
      '#professional-qr-modal[style*="flex"] {',
        'display: flex !important;',
      '}',

      /* ── Scanner card (bottom-sheet) ── */
      '#professional-qr-modal .qr-scanner-container {',
        'width: 100% !important;',
        'max-width: 480px !important;',
        'max-height: 92vh !important;',
        'background: #0a0a0f !important;',
        'border-radius: 28px 28px 0 0 !important;',
        'overflow: hidden !important;',
        'display: flex !important;',
        'flex-direction: column !important;',
        'animation: bmgSheetUp 0.32s cubic-bezier(0.32,0.72,0,1) both !important;',
        'position: relative !important;',
      '}',
      '@keyframes bmgSheetUp {',
        'from { transform: translateY(60px); opacity: 0; }',
        'to   { transform: translateY(0);    opacity: 1; }',
      '}',

      /* Pull handle */
      '#professional-qr-modal .qr-scanner-container::before {',
        'content: "" !important;',
        'display: block !important;',
        'width: 40px !important;',
        'height: 4px !important;',
        'background: rgba(255,255,255,0.2) !important;',
        'border-radius: 2px !important;',
        'margin: 10px auto 0 !important;',
        'flex-shrink: 0 !important;',
      '}',

      /* ── Header ── */
      '#professional-qr-modal .qr-scanner-header {',
        'padding: 14px 18px 14px !important;',
        'background: transparent !important;',
        'border-bottom: 1px solid rgba(255,255,255,0.08) !important;',
        'flex-shrink: 0 !important;',
      '}',
      '#professional-qr-modal .scanner-icon {',
        'width: 38px !important;',
        'height: 38px !important;',
        'border-radius: 10px !important;',
        'background: rgba(99,102,241,0.25) !important;',
        'border: 1px solid rgba(99,102,241,0.4) !important;',
      '}',
      '#professional-qr-modal .scanner-icon i {',
        'font-size: 1.1rem !important;',
        'color: #818cf8 !important;',
      '}',
      '#professional-qr-modal .scanner-header-content h3 {',
        'font-size: 15px !important;',
        'font-weight: 700 !important;',
        'color: #f8fafc !important;',
        'margin: 0 !important;',
      '}',
      '#professional-qr-modal .scanner-header-content p {',
        'font-size: 11px !important;',
        'color: rgba(255,255,255,0.45) !important;',
        'margin: 2px 0 0 !important;',
      '}',
      '#professional-qr-modal .close-scanner-btn {',
        'width: 36px !important;',
        'height: 36px !important;',
        'border-radius: 50% !important;',
        'background: rgba(255,255,255,0.08) !important;',
        'border: 1px solid rgba(255,255,255,0.12) !important;',
        'color: #94a3b8 !important;',
        'font-size: 14px !important;',
      '}',

      /* ── Camera viewport ── */
      '#professional-qr-modal .scanner-viewport {',
        'position: relative !important;',
        'width: 100% !important;',
        'height: 260px !important;',
        'min-height: unset !important;',
        'max-height: 260px !important;',
        'background: #000 !important;',
        'overflow: hidden !important;',
        'flex-shrink: 0 !important;',
      '}',
      '#professional-qr-modal #professional-qr-reader {',
        'width: 100% !important;',
        'height: 260px !important;',
        'min-height: unset !important;',
        'max-height: 260px !important;',
        'overflow: hidden !important;',
      '}',

      /* Force html5-qrcode video to fill neatly */
      '#professional-qr-reader video {',
        'width: 100% !important;',
        'height: 260px !important;',
        'object-fit: cover !important;',
      '}',
      '#professional-qr-reader img { display: none !important; }',

      /* ── Scan frame overlay ── */
      '#professional-qr-modal .scanner-overlay {',
        'z-index: 2 !important;',
      '}',
      '#professional-qr-modal .scan-frame {',
        'width: 180px !important;',
        'height: 180px !important;',
        'position: relative !important;',
      '}',

      /* Dim outside the frame */
      '#professional-qr-modal .scanner-overlay::before {',
        'content: "" !important;',
        'position: absolute !important;',
        'inset: 0 !important;',
        'background: rgba(0,0,0,0.45) !important;',
        'mask: url(\'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><defs><mask id="m"><rect width="100%" height="100%" fill="white"/><rect x="50%" y="50%" width="180" height="180" transform="translate(-90,-90)" rx="16" fill="black"/></mask></defs><rect width="100%" height="100%" fill="white" mask="url(%23m)"/></svg>\') !important;',
        'pointer-events: none !important;',
      '}',

      '#professional-qr-modal .scan-corner {',
        'width: 22px !important;',
        'height: 22px !important;',
        'border-width: 3px !important;',
        'border-color: #6366f1 !important;',
      '}',
      '#professional-qr-modal .scan-line {',
        'background: linear-gradient(90deg, transparent, #6366f1, transparent) !important;',
        'height: 2px !important;',
        'box-shadow: 0 0 8px rgba(99,102,241,0.8) !important;',
      '}',

      /* ── Status bar below camera ── */
      '#professional-qr-modal .scanner-status-bar {',
        'text-align: center !important;',
        'padding: 10px 16px 6px !important;',
        'font-size: 12px !important;',
        'font-weight: 600 !important;',
        'color: rgba(255,255,255,0.5) !important;',
        'letter-spacing: 0.4px !important;',
        'flex-shrink: 0 !important;',
      '}',

      /* ── Controls ── */
      '#professional-qr-modal .scanner-controls {',
        'display: flex !important;',
        'gap: 10px !important;',
        'padding: 10px 16px 14px !important;',
        'background: transparent !important;',
        'flex-shrink: 0 !important;',
      '}',
      '#professional-qr-modal .scanner-btn {',
        'flex: 1 !important;',
        'padding: 10px 8px !important;',
        'border-radius: 12px !important;',
        'font-size: 11px !important;',
        'font-weight: 700 !important;',
        'letter-spacing: 0.3px !important;',
        'border: 1px solid rgba(255,255,255,0.1) !important;',
        'transition: all .2s !important;',
      '}',
      '#professional-qr-modal .scanner-btn.torch-btn {',
        'background: rgba(251,191,36,0.12) !important;',
        'color: #fbbf24 !important;',
        'border-color: rgba(251,191,36,0.25) !important;',
      '}',
      '#professional-qr-modal .scanner-btn.torch-btn.active {',
        'background: rgba(251,191,36,0.25) !important;',
        'box-shadow: 0 0 16px rgba(251,191,36,0.3) !important;',
      '}',
      '#professional-qr-modal .scanner-btn.gallery-btn {',
        'background: rgba(99,102,241,0.12) !important;',
        'color: #818cf8 !important;',
        'border-color: rgba(99,102,241,0.25) !important;',
      '}',
      '#professional-qr-modal .scanner-btn.close-btn {',
        'background: rgba(239,68,68,0.1) !important;',
        'color: #f87171 !important;',
        'border-color: rgba(239,68,68,0.2) !important;',
      '}',
      '#professional-qr-modal .scanner-btn:hover {',
        'filter: brightness(1.15) !important;',
        'transform: translateY(-1px) !important;',
      '}',

      /* ── Result area ── */
      '#professional-qr-result {',
        'flex-shrink: 0 !important;',
      '}',
      '#professional-qr-result:not(:empty) {',
        'padding: 12px 16px !important;',
        'border-top: 1px solid rgba(255,255,255,0.08) !important;',
      '}',

      /* ── Pool type badge in scanner header ── */
      '.bmg-scanner-pool-badge {',
        'font-size: 10px;',
        'font-weight: 700;',
        'padding: 3px 9px;',
        'border-radius: 20px;',
        'background: rgba(14,165,233,0.15);',
        'border: 1px solid rgba(14,165,233,0.3);',
        'color: #38bdf8;',
        'margin-left: 6px;',
        'vertical-align: middle;',
      '}',
    ].join('\n');
    document.head.appendChild(style);

    /* ── Inject status hint bar into scanner DOM ── */
    var viewport = document.querySelector('#professional-qr-modal .scanner-viewport');
    if (viewport && !document.querySelector('.scanner-status-bar')) {
      var bar = document.createElement('div');
      bar.className = 'scanner-status-bar';
      bar.textContent = 'Hold QR code steady within the frame';
      viewport.parentNode.insertBefore(bar, viewport.nextSibling);
    }

    console.log('[pool-fix] FIX 6: Professional compact scanner UI injected');
  }


  /* ════════════════════════════════════════════════════════════════
   *  Boot
   * ════════════════════════════════════════════════════════════════*/
  injectPoolSlotCSS();
  injectScannerUI();

  // Patch after app.js is ready
  _waitFor('showEntryPass',            patchShowEntryPass);
  _waitFor('loadUserBookings',         patchLoadUserBookings);
  _waitFor('processVerifiedQRCode',    patchProcessVerifiedQRCode);

  // Re-inject scanner UI whenever the scanner modal opens (in case DOM was reset)
  window.addEventListener('bmg:pageShown', function() { injectScannerUI(); });
  document.addEventListener('click', function(e) {
    if (e.target && (e.target.id === 'header-qr-scanner' || e.target.closest('#header-qr-scanner'))) {
      setTimeout(injectScannerUI, 80);
    }
  });

  // Do NOT overwrite showPoolEntryPass — bmg_swimming_pool_fix.js (loaded before us)
  // sets the definitive 1-arg version. Only expose ours as a 2-arg fallback.
  if (typeof window.showPoolEntryPass !== 'function') {
    window.showPoolEntryPass = showPoolEntryPass;
  } else {
    window._showPoolEntryPass2arg = showPoolEntryPass; // keep 2-arg version accessible
  }

  console.log('✅ [bmg_pool_entry_fix.js] Loaded — pool QR verification + compact scanner UI active');

})();


/* ═══════════════════════════════════════════════════════════════════
 * ██ bmg_pool_pass_fix.js
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * bmg_pool_pass_fix.js  — v1
 * ═══════════════════════════════════════════════════════════════════
 *
 *  WHAT THIS FILE FIXES
 *  ────────────────────
 *  1. SLOT FILL COUNT NOT UPDATING IN UI
 *     After a booking, the slot card in the pool grid still shows
 *     the old "X/20 members" count instead of the incremented value.
 *     FIX: After bmg:paymentConfirmed fires for a pool booking, we
 *     immediately re-fetch the slot doc and rerender the pool slots
 *     grid so the live occupancy is correct.
 *
 *  2. ENTRY PASS — WATER PARK THEME + FULL USER DETAILS
 *     The existing pass is functional but generic.
 *     FIX: Completely replaces showPoolEntryPass with a beautiful
 *     water-park-themed design that shows every booking detail:
 *       • User name, phone, email
 *       • Pool name + address
 *       • Date (formatted), time slot
 *       • Member count + per-person price + total paid
 *       • Booking ID + payment status badge
 *       • Animated wave header, bubbles, full QR code
 *       • "Share / Download" UI hint
 *
 *  LOAD ORDER — LAST <script> in index.html, after all other scripts:
 *    <script src="bmg_pool_pass_fix.js"></script>
 * ═══════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  /* ─────────────────────────────────────────────────────────────────
   *  Utilities
   * ─────────────────────────────────────────────────────────────────*/
  function _esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function _waitFor(name, cb, n) {
    n = n || 0;
    if (typeof window[name] === 'function') return cb();
    if (n > 120) return;
    setTimeout(function () { _waitFor(name, cb, n + 1); }, 150);
  }

  /* ═══════════════════════════════════════════════════════════════
   *  FIX 1 — Refresh slot grid after pool booking is confirmed
   *  so the "X/20 members" count reflects the new booking instantly.
   * ═══════════════════════════════════════════════════════════════*/
  window.addEventListener('bmg:paymentConfirmed', function (e) {
    var pending = null;
    try {
      pending = JSON.parse(
        sessionStorage.getItem('pendingBooking') ||
        sessionStorage.getItem('pendingCashfreeBooking') || 'null'
      );
    } catch (_) {}
    if (!pending || !pending.isPoolBooking) return;

    var poolId  = pending.poolId  || (window.currentPool && window.currentPool.id);
    var date    = pending.date    || window.selectedPoolDate;
    var slotId  = pending.slotId;

    if (!poolId || !date) return;

    /* Re-run slot loader 1.5 s after confirmation (give Firestore time to settle) */
    setTimeout(function () {
      var pool = window.currentPool;
      /* Try the safe pool slot loader first (from bmg_swimming_pool_fix.js) */
      if (typeof window._safeLoadPoolSlotsPublic === 'function') {
        window._safeLoadPoolSlotsPublic(poolId, date, pool);
        return;
      }
      /* Fallback: directly re-query pool_slots and rerender */
      var db = window.db;
      if (!db) return;
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
          /* Call whatever render function is available */
          if (typeof window._safeRenderPoolSlots === 'function') {
            window._safeRenderPoolSlots(slots, pool);
          }
          console.log('[pool-pass-fix] FIX 1: Slot grid refreshed after booking confirmed');
        })
        .catch(function (err) {
          console.warn('[pool-pass-fix] FIX 1: slot refresh error:', err.message);
        });
    }, 1500);
  });


  /* ═══════════════════════════════════════════════════════════════
   *  FIX 2 — Water-park themed entry pass with full user details
   *
   *  Injects all CSS into <head> and replaces window.showPoolEntryPass
   *  with a fully reimplemented version that renders:
   *    • Animated wave hero (cyan → blue gradient)
   *    • Animated bubbles background
   *    • User details card (name, phone, email)
   *    • Booking details grid (pool, date, time, status)
   *    • Members section with per-person price + total
   *    • Large QR code centred on a white card
   *    • Booking ID + validity footer
   * ═══════════════════════════════════════════════════════════════*/

  /* ── Inject CSS once ──────────────────────────────────────────── */
  function _injectPassCSS() {
    if (document.getElementById('bmg-pool-pass-v2-styles')) return;
    var style = document.createElement('style');
    style.id  = 'bmg-pool-pass-v2-styles';
    style.textContent = `
/* ── Water-park entry pass v2 ─────────────────────────────────── */
@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Exo+2:wght@700;800;900&display=swap');

.bmg-wpp {
  font-family: 'Nunito', sans-serif;
  max-width: 420px;
  margin: 0 auto 24px;
  border-radius: 28px;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(3,105,161,0.28), 0 4px 16px rgba(0,0,0,0.12);
  background: #fff;
  position: relative;
}

/* ── Hero wave header ─────────────────────────────── */
.bmg-wpp-hero {
  position: relative;
  height: 200px;
  overflow: hidden;
  background: linear-gradient(135deg, #0c4a6e 0%, #0369a1 40%, #0ea5e9 70%, #22d3ee 100%);
}
.bmg-wpp-bubbles {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.bmg-wpp-bubble {
  position: absolute;
  border-radius: 50%;
  background: rgba(255,255,255,0.12);
  animation: bmgBubbleRise linear infinite;
}
.bmg-wpp-bubble:nth-child(1)  { width:18px; height:18px; left:8%;   animation-duration:4.2s; animation-delay:0s;   bottom:-20px; }
.bmg-wpp-bubble:nth-child(2)  { width:10px; height:10px; left:20%;  animation-duration:5.8s; animation-delay:1s;   bottom:-20px; }
.bmg-wpp-bubble:nth-child(3)  { width:24px; height:24px; left:33%;  animation-duration:3.9s; animation-delay:.5s;  bottom:-20px; }
.bmg-wpp-bubble:nth-child(4)  { width:14px; height:14px; left:50%;  animation-duration:6.1s; animation-delay:2s;   bottom:-20px; }
.bmg-wpp-bubble:nth-child(5)  { width:20px; height:20px; left:65%;  animation-duration:4.7s; animation-delay:.8s;  bottom:-20px; }
.bmg-wpp-bubble:nth-child(6)  { width:8px;  height:8px;  left:78%;  animation-duration:5.2s; animation-delay:1.5s; bottom:-20px; }
.bmg-wpp-bubble:nth-child(7)  { width:16px; height:16px; left:88%;  animation-duration:4.0s; animation-delay:3s;   bottom:-20px; }
.bmg-wpp-bubble:nth-child(8)  { width:12px; height:12px; left:56%;  animation-duration:7.0s; animation-delay:0.3s; bottom:-20px; }
@keyframes bmgBubbleRise {
  0%   { transform: translateY(0) scale(1);   opacity: .7; }
  80%  { opacity: .5; }
  100% { transform: translateY(-220px) scale(1.15); opacity: 0; }
}
.bmg-wpp-hero-wave {
  position: absolute;
  bottom: -2px; left: 0; right: 0;
  height: 56px;
}
.bmg-wpp-hero-content {
  position: relative;
  z-index: 2;
  text-align: center;
  padding: 28px 16px 0;
}
.bmg-wpp-app-logo {
  font-family: 'Exo 2', sans-serif;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 3px;
  color: rgba(255,255,255,0.75);
  text-transform: uppercase;
  margin-bottom: 4px;
}
.bmg-wpp-hero-icon {
  font-size: 42px;
  line-height: 1;
  margin: 4px 0;
  filter: drop-shadow(0 4px 8px rgba(0,0,0,0.2));
  animation: bmgIconBob 2.4s ease-in-out infinite;
}
@keyframes bmgIconBob {
  0%,100% { transform: translateY(0); }
  50%     { transform: translateY(-5px); }
}
.bmg-wpp-hero-title {
  font-family: 'Exo 2', sans-serif;
  font-size: 22px;
  font-weight: 900;
  color: #fff;
  letter-spacing: -0.5px;
  text-shadow: 0 2px 8px rgba(0,0,0,0.25);
  margin-bottom: 4px;
}
.bmg-wpp-hero-sub {
  font-size: 12px;
  font-weight: 700;
  color: rgba(255,255,255,0.8);
  letter-spacing: 0.3px;
}

/* ── Status badge ─────────────────────────────────── */
.bmg-wpp-status-wrap {
  display: flex;
  justify-content: center;
  margin: -14px auto 0;
  position: relative;
  z-index: 4;
}
.bmg-wpp-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 800;
  padding: 6px 18px;
  border-radius: 20px;
  letter-spacing: 0.4px;
  border: 2.5px solid;
  background: #fff;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
}
.bmg-wpp-status-badge.confirmed {
  color: #15803d;
  border-color: #86efac;
}
.bmg-wpp-status-badge.confirmed::before { content: '✓ '; }

/* ── Pool venue card ──────────────────────────────── */
.bmg-wpp-venue {
  margin: 16px 16px 0;
  background: linear-gradient(135deg, #f0f9ff, #e0f2fe);
  border: 1.5px solid #bae6fd;
  border-radius: 16px;
  padding: 14px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.bmg-wpp-venue-icon {
  width: 48px; height: 48px;
  border-radius: 14px;
  background: linear-gradient(135deg, #0369a1, #0ea5e9);
  display: flex; align-items: center; justify-content: center;
  font-size: 22px;
  flex-shrink: 0;
  box-shadow: 0 4px 10px rgba(3,105,161,0.3);
}
.bmg-wpp-venue-name {
  font-family: 'Exo 2', sans-serif;
  font-size: 15px;
  font-weight: 800;
  color: #0c4a6e;
  letter-spacing: -0.3px;
  line-height: 1.2;
}
.bmg-wpp-venue-addr {
  font-size: 11px;
  color: #0369a1;
  font-weight: 600;
  margin-top: 3px;
  display: flex;
  align-items: center;
  gap: 4px;
}

/* ── Section labels ──────────────────────────────── */
.bmg-wpp-section-label {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: #94a3b8;
  margin: 18px 16px 8px;
}

/* ── User details card ───────────────────────────── */
.bmg-wpp-user-card {
  margin: 0 16px;
  background: #fafafa;
  border: 1.5px solid #f1f5f9;
  border-radius: 16px;
  overflow: hidden;
}
.bmg-wpp-user-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 14px;
  border-bottom: 1px solid #f1f5f9;
}
.bmg-wpp-user-row:last-child { border-bottom: none; }
.bmg-wpp-user-row-icon {
  width: 32px; height: 32px;
  border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px;
  flex-shrink: 0;
}
.bmg-wpp-user-row-icon.blue   { background: #eff6ff; }
.bmg-wpp-user-row-icon.cyan   { background: #ecfeff; }
.bmg-wpp-user-row-icon.green  { background: #f0fdf4; }
.bmg-wpp-user-row-label {
  font-size: 10px;
  color: #94a3b8;
  font-weight: 700;
  letter-spacing: 0.3px;
  text-transform: uppercase;
}
.bmg-wpp-user-row-value {
  font-size: 14px;
  font-weight: 700;
  color: #0f172a;
  margin-top: 1px;
}

/* ── Booking details grid ────────────────────────── */
.bmg-wpp-details-grid {
  margin: 0 16px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.bmg-wpp-detail-cell {
  background: #f8fafc;
  border: 1.5px solid #e2e8f0;
  border-radius: 14px;
  padding: 12px 13px;
}
.bmg-wpp-detail-cell.full-width {
  grid-column: 1 / -1;
}
.bmg-wpp-detail-cell-label {
  font-size: 10px;
  color: #94a3b8;
  font-weight: 700;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 5px;
}
.bmg-wpp-detail-cell-value {
  font-size: 13px;
  font-weight: 800;
  color: #0f172a;
  line-height: 1.25;
}
.bmg-wpp-detail-cell-value.amount {
  font-family: 'Exo 2', sans-serif;
  font-size: 18px;
  color: #0369a1;
}

/* ── Members section ─────────────────────────────── */
.bmg-wpp-members {
  margin: 0 16px;
  background: linear-gradient(135deg, #ecfeff, #e0f2fe);
  border: 1.5px solid #a5f3fc;
  border-radius: 16px;
  padding: 14px;
}
.bmg-wpp-members-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.bmg-wpp-members-title {
  font-size: 13px;
  font-weight: 800;
  color: #0c4a6e;
  display: flex;
  align-items: center;
  gap: 7px;
}
.bmg-wpp-members-count-badge {
  background: #0ea5e9;
  color: #fff;
  font-size: 11px;
  font-weight: 900;
  padding: 2px 10px;
  border-radius: 10px;
  font-family: 'Exo 2', sans-serif;
}
.bmg-wpp-members-per-person {
  font-size: 11px;
  font-weight: 700;
  color: #0369a1;
  background: rgba(255,255,255,0.7);
  padding: 3px 10px;
  border-radius: 8px;
}
.bmg-wpp-member-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}
.bmg-wpp-member-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(255,255,255,0.8);
  border: 1.5px solid #bae6fd;
  border-radius: 10px;
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 700;
  color: #0369a1;
}
.bmg-wpp-member-chip-num {
  width: 20px; height: 20px;
  border-radius: 50%;
  background: #0ea5e9;
  color: #fff;
  font-size: 10px;
  font-weight: 900;
  display: flex; align-items: center; justify-content: center;
  font-family: 'Exo 2', sans-serif;
}
.bmg-wpp-price-breakdown {
  background: rgba(255,255,255,0.6);
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid rgba(186,230,253,0.8);
}
.bmg-wpp-price-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 7px 12px;
  font-size: 12px;
  font-weight: 600;
  color: #0369a1;
  border-bottom: 1px solid rgba(186,230,253,0.5);
}
.bmg-wpp-price-row:last-child { border-bottom: none; }
.bmg-wpp-price-row.total {
  font-weight: 800;
  color: #0c4a6e;
  font-size: 13px;
  background: rgba(14,165,233,0.08);
}

/* ── QR code section ─────────────────────────────── */
.bmg-wpp-qr-wrap {
  margin: 0 16px;
  text-align: center;
}
.bmg-wpp-qr-card {
  background: #fff;
  border: 2px solid #bae6fd;
  border-radius: 20px;
  padding: 20px;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: 100%;
  box-sizing: border-box;
  box-shadow: 0 4px 20px rgba(14,165,233,0.12);
}
.bmg-wpp-qr-label {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: #0369a1;
}
.bmg-wpp-qr-img {
  width: 180px;
  height: 180px;
  border-radius: 12px;
  display: block;
}
.bmg-wpp-qr-hint {
  font-size: 11px;
  color: #94a3b8;
  font-weight: 600;
}

/* ── Footer ──────────────────────────────────────── */
.bmg-wpp-footer {
  margin: 16px 16px 0;
  padding: 14px;
  background: #f8fafc;
  border-radius: 14px;
  border: 1.5px solid #e2e8f0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.bmg-wpp-booking-id {
  font-family: 'Exo 2', sans-serif;
  font-size: 11px;
  font-weight: 800;
  color: #475569;
  letter-spacing: 0.5px;
  word-break: break-all;
}
.bmg-wpp-validity {
  font-size: 10px;
  font-weight: 700;
  color: #94a3b8;
  display: flex;
  align-items: center;
  gap: 4px;
}

/* ── Bottom wave decoration ──────────────────────── */
.bmg-wpp-bottom-wave {
  height: 48px;
  margin-top: 16px;
  overflow: hidden;
  line-height: 0;
}
.bmg-wpp-bottom-wave svg {
  width: 100%;
  height: 100%;
  display: block;
}

/* ── Action buttons ──────────────────────────────── */
.bmg-wpp-actions {
  max-width: 420px;
  margin: 0 auto 32px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  padding: 0 0;
}
.bmg-wpp-btn {
  padding: 13px;
  border-radius: 14px;
  font-size: 13px;
  font-weight: 800;
  font-family: 'Nunito', sans-serif;
  cursor: pointer;
  border: none;
  transition: all .2s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  letter-spacing: 0.2px;
}
.bmg-wpp-btn-home {
  background: linear-gradient(135deg, #0369a1, #0ea5e9);
  color: #fff;
  box-shadow: 0 6px 18px rgba(3,105,161,0.3);
  grid-column: 1 / -1;
}
.bmg-wpp-btn-home:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(3,105,161,0.4);
}
.bmg-wpp-btn-bookings {
  background: #f0f9ff;
  color: #0369a1;
  border: 2px solid #bae6fd;
}
.bmg-wpp-btn-share {
  background: #f0fdf4;
  color: #15803d;
  border: 2px solid #86efac;
}

/* ── Entry pass page wrapper ─────────────────────── */
#entry-pass-page .bmg-wpp-scroll-wrap {
  padding: 16px;
  padding-bottom: 40px;
  min-height: 100vh;
  background: linear-gradient(180deg, #e0f2fe 0%, #f8fafc 100%);
}
    `;
    document.head.appendChild(style);
  }


  /* ── The new showPoolEntryPass ────────────────────────────────── */
  async function showPoolEntryPassV2(bookingId) {
    _injectPassCSS();

    if (typeof window.showLoading === 'function') window.showLoading('Generating your pool pass…');

    try {
      var db = window.db;
      var booking = null;

      /* Lookup strategies — same as original */
      var d1 = await db.collection('pool_bookings').doc(bookingId).get().catch(function () { return { exists: false }; });
      if (d1.exists) booking = Object.assign({ _docId: d1.id }, d1.data());

      if (!booking) {
        var s1 = await db.collection('pool_bookings').where('bookingId', '==', bookingId).limit(1).get().catch(function () { return { empty: true }; });
        if (!s1.empty) booking = Object.assign({ _docId: s1.docs[0].id }, s1.docs[0].data());
      }
      if (!booking) {
        var s2 = await db.collection('pool_bookings').where('orderId', '==', bookingId).limit(1).get().catch(function () { return { empty: true }; });
        if (!s2.empty) booking = Object.assign({ _docId: s2.docs[0].id }, s2.docs[0].data());
      }
      if (!booking) {
        var s3 = await db.collection('bookings').where('bookingId', '==', bookingId).limit(1).get().catch(function () { return { empty: true }; });
        if (!s3.empty) booking = Object.assign({ _docId: s3.docs[0].id }, s3.docs[0].data());
      }

      if (!booking) {
        if (typeof window.hideLoading === 'function') window.hideLoading();
        if (typeof window.showToast   === 'function') window.showToast('Booking not found', 'error');
        return;
      }

      /* Status check */
      var bStat = booking.bookingStatus || booking.status || '';
      var isOk  = bStat === 'confirmed' || bStat === 'completed' || booking.paymentStatus === 'paid';
      if (!isOk) {
        if (typeof window.hideLoading === 'function') window.hideLoading();
        if (typeof window.showToast   === 'function') window.showToast('Preparing your pass…', 'info');
        setTimeout(function () { showPoolEntryPassV2(bookingId); }, 2500);
        return;
      }

      /* ── Derive all display values ── */
      var memberCount = booking.memberCount || 1;
      var perPer      = booking.pricePerMember || 0;
      if (!perPer && memberCount > 0) perPer = Math.round((booking.amount || 0) / memberCount);
      var totalPaid   = booking.amount || perPer * memberCount;

      var dateLabel = booking.date || '';
      try {
        dateLabel = new Date(booking.date).toLocaleDateString('en-IN', {
          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
        });
      } catch (e) {}

      var userName  = booking.userName  || booking.userDisplayName || 'Guest';
      var userPhone = booking.userPhone || booking.phone || '—';
      var userEmail = booking.userEmail || booking.email || '—';
      var poolName  = booking.poolName  || 'Swimming Pool';
      var poolAddr  = booking.poolAddress || booking.venueAddress || '';
      var slotTime  = booking.slotTime  || '—';
      var bookId    = booking.bookingId || booking._docId || bookingId;

      /* ── Generate QR ── */
      var qrDataUrl = '';
      try {
        var qrPayload = JSON.stringify({
          app       : 'BookMyGame',
          type      : 'pool_entry',
          bookingId : bookId,
          poolId    : booking.poolId,
          date      : booking.date,
          slot      : slotTime,
          members   : memberCount,
          phone     : userPhone,
        });
        if (window.QRCode && typeof window.QRCode.toDataURL === 'function') {
          qrDataUrl = await window.QRCode.toDataURL(qrPayload, {
            width: 220, margin: 2,
            color: { dark: '#0c4a6e', light: '#f0f9ff' }
          });
        }
      } catch (e) { /* QR optional */ }

      /* ── Build member chips HTML ── */
      var memberChipsHtml = '';
      for (var m = 1; m <= memberCount; m++) {
        memberChipsHtml +=
          '<div class="bmg-wpp-member-chip">' +
            '<span class="bmg-wpp-member-chip-num">' + m + '</span>' +
            'Member ' + m +
          '</div>';
      }

      /* ── Price breakdown HTML ── */
      var priceBreakdownHtml = '';
      if (memberCount > 1) {
        priceBreakdownHtml =
          '<div class="bmg-wpp-price-breakdown">' +
            '<div class="bmg-wpp-price-row">' +
              '<span>Price per person</span><span>₹' + perPer + '</span>' +
            '</div>' +
            '<div class="bmg-wpp-price-row">' +
              '<span>Members</span><span>× ' + memberCount + '</span>' +
            '</div>' +
            '<div class="bmg-wpp-price-row total">' +
              '<span>💰 Total Paid</span><span>₹' + totalPaid + '</span>' +
            '</div>' +
          '</div>';
      }

      /* ── Full pass HTML ── */
      var passHtml =
        '<div class="bmg-wpp-scroll-wrap">' +

          '<div class="bmg-wpp">' +

            /* ── Hero ── */
            '<div class="bmg-wpp-hero">' +
              '<div class="bmg-wpp-bubbles">' +
                '<div class="bmg-wpp-bubble"></div>' +
                '<div class="bmg-wpp-bubble"></div>' +
                '<div class="bmg-wpp-bubble"></div>' +
                '<div class="bmg-wpp-bubble"></div>' +
                '<div class="bmg-wpp-bubble"></div>' +
                '<div class="bmg-wpp-bubble"></div>' +
                '<div class="bmg-wpp-bubble"></div>' +
                '<div class="bmg-wpp-bubble"></div>' +
              '</div>' +
              '<div class="bmg-wpp-hero-content">' +
                '<div class="bmg-wpp-app-logo">BookMyGame</div>' +
                '<div class="bmg-wpp-hero-icon">🏊</div>' +
                '<div class="bmg-wpp-hero-title">Pool Entry Pass</div>' +
                '<div class="bmg-wpp-hero-sub">🎟️ Present this pass at the pool entrance</div>' +
              '</div>' +
              '<svg class="bmg-wpp-hero-wave" viewBox="0 0 400 56" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">' +
                '<path d="M0,20 C80,50 160,0 240,30 C320,56 380,10 400,24 L400,56 L0,56 Z" fill="#fff"/>' +
              '</svg>' +
            '</div>' +

            /* ── Status ── */
            '<div class="bmg-wpp-status-wrap">' +
              '<div class="bmg-wpp-status-badge confirmed">Booking Confirmed</div>' +
            '</div>' +

            /* ── Pool / Venue ── */
            '<div class="bmg-wpp-venue">' +
              '<div class="bmg-wpp-venue-icon">🏖️</div>' +
              '<div>' +
                '<div class="bmg-wpp-venue-name">' + _esc(poolName) + '</div>' +
                (poolAddr ? '<div class="bmg-wpp-venue-addr">📍 ' + _esc(poolAddr) + '</div>' : '') +
              '</div>' +
            '</div>' +

            /* ── Guest details ── */
            '<div class="bmg-wpp-section-label">Guest Details</div>' +
            '<div class="bmg-wpp-user-card">' +
              '<div class="bmg-wpp-user-row">' +
                '<div class="bmg-wpp-user-row-icon blue">👤</div>' +
                '<div>' +
                  '<div class="bmg-wpp-user-row-label">Full Name</div>' +
                  '<div class="bmg-wpp-user-row-value">' + _esc(userName) + '</div>' +
                '</div>' +
              '</div>' +
              '<div class="bmg-wpp-user-row">' +
                '<div class="bmg-wpp-user-row-icon cyan">📱</div>' +
                '<div>' +
                  '<div class="bmg-wpp-user-row-label">Phone</div>' +
                  '<div class="bmg-wpp-user-row-value">' + _esc(userPhone) + '</div>' +
                '</div>' +
              '</div>' +
              (userEmail && userEmail !== '—'
                ? '<div class="bmg-wpp-user-row">' +
                    '<div class="bmg-wpp-user-row-icon green">✉️</div>' +
                    '<div>' +
                      '<div class="bmg-wpp-user-row-label">Email</div>' +
                      '<div class="bmg-wpp-user-row-value">' + _esc(userEmail) + '</div>' +
                    '</div>' +
                  '</div>'
                : '') +
            '</div>' +

            /* ── Booking info grid ── */
            '<div class="bmg-wpp-section-label">Booking Details</div>' +
            '<div class="bmg-wpp-details-grid">' +
              '<div class="bmg-wpp-detail-cell full-width">' +
                '<div class="bmg-wpp-detail-cell-label">📅 Date</div>' +
                '<div class="bmg-wpp-detail-cell-value">' + _esc(dateLabel) + '</div>' +
              '</div>' +
              '<div class="bmg-wpp-detail-cell">' +
                '<div class="bmg-wpp-detail-cell-label">⏰ Time Slot</div>' +
                '<div class="bmg-wpp-detail-cell-value">' + _esc(slotTime) + '</div>' +
              '</div>' +
              '<div class="bmg-wpp-detail-cell">' +
                '<div class="bmg-wpp-detail-cell-label">💸 Total Paid</div>' +
                '<div class="bmg-wpp-detail-cell-value amount">₹' + totalPaid + '</div>' +
              '</div>' +
            '</div>' +

            /* ── Members ── */
            '<div class="bmg-wpp-section-label">Members Allowed</div>' +
            '<div class="bmg-wpp-members">' +
              '<div class="bmg-wpp-members-header">' +
                '<div class="bmg-wpp-members-title">' +
                  '🏊 Swimmers' +
                  '<span class="bmg-wpp-members-count-badge">' + memberCount + '</span>' +
                '</div>' +
                (perPer > 0 && memberCount > 1
                  ? '<div class="bmg-wpp-members-per-person">₹' + perPer + '/person</div>'
                  : '') +
              '</div>' +
              '<div class="bmg-wpp-member-chips">' + memberChipsHtml + '</div>' +
              priceBreakdownHtml +
            '</div>' +

            /* ── QR code ── */
            (qrDataUrl
              ? '<div class="bmg-wpp-section-label">Scan at Entry</div>' +
                '<div class="bmg-wpp-qr-wrap">' +
                  '<div class="bmg-wpp-qr-card">' +
                    '<div class="bmg-wpp-qr-label">🔍 Scan QR Code</div>' +
                    '<img src="' + qrDataUrl + '" alt="Entry QR" class="bmg-wpp-qr-img">' +
                    '<div class="bmg-wpp-qr-hint">Show this to the pool staff at the gate</div>' +
                  '</div>' +
                '</div>'
              : '') +

            /* ── Footer ── */
            '<div class="bmg-wpp-footer">' +
              '<div class="bmg-wpp-booking-id"># ' + _esc(bookId) + '</div>' +
              '<div class="bmg-wpp-validity">🛡️ Valid for selected slot only</div>' +
            '</div>' +

            /* ── Bottom wave ── */
            '<div class="bmg-wpp-bottom-wave">' +
              '<svg viewBox="0 0 400 48" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">' +
                '<path d="M0,16 C100,40 200,0 300,24 C350,38 380,10 400,18 L400,48 L0,48 Z" fill="rgba(14,165,233,0.09)"/>' +
                '<path d="M0,28 C80,8 200,40 320,16 C370,6 390,30 400,24 L400,48 L0,48 Z" fill="rgba(14,165,233,0.06)"/>' +
              '</svg>' +
            '</div>' +

          '</div>' + /* end .bmg-wpp */

          /* ── Action buttons ── */
          '<div class="bmg-wpp-actions">' +
            '<button class="bmg-wpp-btn bmg-wpp-btn-bookings" id="wpp-my-bookings-btn">' +
              '📋 My Bookings' +
            '</button>' +
            '<button class="bmg-wpp-btn bmg-wpp-btn-share" id="wpp-share-btn">' +
              '📤 Share Pass' +
            '</button>' +
            '<button class="bmg-wpp-btn bmg-wpp-btn-home" id="wpp-home-btn">' +
              '🏠 Back to Home' +
            '</button>' +
          '</div>' +

        '</div>'; /* end scroll-wrap */

      /* ── Render into entry-pass-page ── */
      var container = document.getElementById('entry-pass-content');
      if (container) {
        container.innerHTML = passHtml;

        /* Wire buttons */
        var homeBtn = document.getElementById('wpp-home-btn');
        if (homeBtn) {
          homeBtn.addEventListener('click', function () {
            if (typeof window.goHome === 'function') window.goHome();
            else if (typeof window.showPage === 'function') window.showPage('home-page');
          });
        }
        var bkBtn = document.getElementById('wpp-my-bookings-btn');
        if (bkBtn) {
          bkBtn.addEventListener('click', function () {
            if (typeof window.showPage === 'function') {
              window.showPage('bookings-page');
              if (typeof window.loadUserBookings === 'function') window.loadUserBookings('upcoming');
            }
          });
        }
        var shareBtn = document.getElementById('wpp-share-btn');
        if (shareBtn) {
          shareBtn.addEventListener('click', function () {
            if (navigator.share) {
              navigator.share({
                title : 'Pool Entry Pass — BookMyGame',
                text  : 'Pool: ' + poolName + ' | Date: ' + booking.date + ' | Slot: ' + slotTime + ' | Booking: ' + bookId,
              }).catch(function () {});
            } else if (typeof window.showToast === 'function') {
              window.showToast('Copy your booking ID: ' + bookId, 'info');
            }
          });
        }
      }

      if (typeof window.hideLoading === 'function') window.hideLoading();
      if (typeof window.showPage    === 'function') window.showPage('entry-pass-page');

    } catch (err) {
      if (typeof window.hideLoading === 'function') window.hideLoading();
      if (typeof window.showToast   === 'function') window.showToast('Could not load entry pass', 'error');
      console.error('[pool-pass-fix] showPoolEntryPassV2 error:', err);
    }
  }

  /* ── Install — override the existing function ── */
  window.showPoolEntryPass = showPoolEntryPassV2;
  /* Also guard against bmg_bookings_fix wrapping it again */
  window.showPoolEntryPass._fixPatched = true;
  window.showPoolEntryPass._v2 = true;

  console.log('✅ [bmg_pool_pass_fix.js] Loaded — water-park entry pass + slot fill fix active');

})();


/* ═══════════════════════════════════════════════════════════════════
 * ██ bmg_firestore_cache.js
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * bmg_firestore_cache.js  — v1
 * ═══════════════════════════════════════════════════════════════════
 *
 *  GOAL: Reduce Firestore read bills by 50–80 % without touching
 *  any server-side rules, indexes, or Cloud Functions.
 *
 *  ┌─────────────────────────────────────────────────────────────┐
 *  │  REALTIME (onSnapshot) KEPT — only where it truly matters   │
 *  │  ✅  Slot booking grid     (app.js loadSlots)               │
 *  │  ✅  Pool slot grid        (bmg_swimming_pool_fix.js)        │
 *  │  ✅  Payment confirmation  (bmg_slot_realtime_fix.js)        │
 *  │  ✅  Tournament live spots (sportobook_patches_merged.js)    │
 *  └─────────────────────────────────────────────────────────────┘
 *
 *  ┌─────────────────────────────────────────────────────────────┐
 *  │  CONVERTED TO CACHED get() — static / slow-changing data    │
 *  │  ❌  Homepage: venues, grounds, deals, featured, pools      │
 *  │  ❌  Reviews (per ground)                                   │
 *  │  ❌  Profile stats (bookings count, matches count)          │
 *  │  ❌  Nearby venues list                                     │
 *  │  ❌  Sport filter results                                   │
 *  │  ❌  Featured grounds (promotions)                          │
 *  │  ❌  Tournament list (all / upcoming filter)                │
 *  │  ❌  Featured tournament (homepage banner)                  │
 *  │  ❌  Owner info fetched per ground in loadNearbyVenues loop │
 *  └─────────────────────────────────────────────────────────────┘
 *
 *  HOW THE CACHE WORKS
 *  ───────────────────
 *  window._bmgCache  — a simple Map keyed by cache key string.
 *  Each entry: { data, ts }  where ts is Date.now() at write time.
 *  TTL is set per collection based on how often the data changes:
 *
 *    Collection                    TTL
 *    ──────────────────────────    ─────
 *    venues / grounds (listings)   5 min   (prices/status rarely change)
 *    ground_promotions             10 min  (promotions are set days ahead)
 *    tournaments (list)            3 min   (spots fill during reg window)
 *    reviews                       10 min  (slow write rate)
 *    profile stats                 5 min   (aggregates, not real-time)
 *    swimming pools (listing)      5 min
 *    owners (type lookup)          15 min  (almost never changes)
 *
 *  A manual cache-bust is exposed via window._bmgCacheClear() for
 *  use after writes (new review, booking confirmed, etc.).
 *
 *  LOAD ORDER — LAST script in index.html, after all other patches:
 *    <script src="bmg_firestore_cache.js"></script>
 * ═══════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  /* ════════════════════════════════════════════════════════════
   *  1.  CACHE ENGINE
   * ════════════════════════════════════════════════════════════*/

  var _cache = new Map();

  /** TTL constants (milliseconds) */
  var TTL = {
    VENUES          : 5  * 60 * 1000,   // 5 min
    GROUNDS         : 5  * 60 * 1000,   // 5 min
    PROMOTIONS      : 10 * 60 * 1000,   // 10 min
    TOURNAMENTS     : 3  * 60 * 1000,   // 3 min
    REVIEWS         : 10 * 60 * 1000,   // 10 min
    PROFILE_STATS   : 5  * 60 * 1000,   // 5 min
    POOLS           : 5  * 60 * 1000,   // 5 min
    OWNERS          : 15 * 60 * 1000,   // 15 min
  };

  /**
   * Read from cache if fresh, otherwise run queryFn and store result.
   * @param {string}   key      — unique string for this query
   * @param {number}   ttl      — milliseconds to consider fresh
   * @param {Function} queryFn  — async () => <array of plain objects>
   * @returns {Promise<Array>}
   */
  async function _cached(key, ttl, queryFn) {
    var entry = _cache.get(key);
    if (entry && (Date.now() - entry.ts) < ttl) {
      console.log('[bmg-cache] HIT', key, '(' + Math.round((Date.now() - entry.ts) / 1000) + 's old)');
      return entry.data;
    }
    var data = await queryFn();
    _cache.set(key, { data: data, ts: Date.now() });
    console.log('[bmg-cache] MISS → fetched', key, '(' + data.length + ' docs)');
    return data;
  }

  /** Clear all or a prefix of cache keys (call after a write) */
  function _cacheClear(prefix) {
    if (!prefix) { _cache.clear(); console.log('[bmg-cache] full clear'); return; }
    _cache.forEach(function (_, k) {
      if (k.indexOf(prefix) === 0) { _cache.delete(k); }
    });
    console.log('[bmg-cache] cleared prefix:', prefix);
  }

  // Expose for manual use (e.g. after booking confirmed)
  window._bmgCache      = _cache;
  window._bmgCacheClear = _cacheClear;


  /* ════════════════════════════════════════════════════════════
   *  2.  HELPER — snap to plain-object array
   * ════════════════════════════════════════════════════════════*/
  function _snapToArr(snapshot) {
    var out = [];
    snapshot.forEach(function (doc) {
      out.push(Object.assign({ id: doc.id }, doc.data()));
    });
    return out;
  }


  /* ════════════════════════════════════════════════════════════
   *  3.  WAIT FOR APP.JS GLOBALS
   * ════════════════════════════════════════════════════════════*/
  function _waitFor(name, cb, n) {
    n = n || 0;
    if (typeof window[name] !== 'undefined') return cb();
    if (n > 80) { console.warn('[bmg-cache] gave up waiting for', name); return; }
    setTimeout(function () { _waitFor(name, cb, n + 1); }, 150);
  }


  /* ════════════════════════════════════════════════════════════
   *  4.  PATCH loadNearbyVenues
   *      Original: 2 collection reads + N owner reads per ground
   *      Patched : same 2 reads cached (5 min) + owner lookups cached (15 min)
   * ════════════════════════════════════════════════════════════*/
  function patchLoadNearbyVenues() {
    var original = window.loadNearbyVenues;
    if (!original || original._cachePatched) return;

    window.loadNearbyVenues = async function () {
      var container = document.getElementById('nearby-venues');
      if (!container) return;

      container.innerHTML =
        '<div class="skeleton-loading">' +
          '<div class="skeleton-card"></div>' +
          '<div class="skeleton-card"></div>' +
          '<div class="skeleton-card"></div>' +
        '</div>';

      try {
        var db = window.db;
        var COLS = window.COLLECTIONS || {};

        /* Cached parallel reads */
        var venueArr = await _cached('venues:hidden=false:10', TTL.VENUES, async function () {
          var s = await db.collection(COLS.VENUES || 'venues')
            .where('hidden', '==', false).limit(10).get();
          return _snapToArr(s).map(function (d) { return Object.assign({ type: 'venue' }, d); });
        });

        var groundArr = await _cached('grounds:active:10', TTL.GROUNDS, async function () {
          var s = await db.collection(COLS.GROUNDS || 'grounds')
            .where('status', '==', 'active').limit(10).get();
          return _snapToArr(s).map(function (d) { return Object.assign({ type: 'ground', ownerType: 'plot_owner' }, d); });
        });

        /* Cached owner-type lookups (individual doc reads) */
        for (var i = 0; i < groundArr.length; i++) {
          var g = groundArr[i];
          if (!g.ownerId) continue;
          var ownerKey = 'owner:' + g.ownerId;
          /* Capture ownerId in a closure so the loop variable doesn't shift */
          var ownerData = await (function (oid, colName) {
            return _cached(ownerKey, TTL.OWNERS, async function () {
              var d = await db.collection(colName).doc(oid).get().catch(function () { return null; });
              return d && d.exists ? [d.data()] : [{ ownerType: 'venue_owner' }];
            });
          }(g.ownerId, COLS.OWNERS || 'owners'));
          g.ownerType = (ownerData[0] && ownerData[0].ownerType) || 'venue_owner';
        }

        var allItems = venueArr.concat(groundArr).slice(0, 4);

        if (typeof window.displayVenueItems === 'function') {
          window.displayVenueItems(container, allItems);
        }
      } catch (err) {
        console.error('[bmg-cache] loadNearbyVenues error:', err);
        /* Fall back to original if it exists */
        if (typeof original === 'function') original.apply(this, arguments);
      }
    };

    window.loadNearbyVenues._cachePatched = true;
    console.log('[bmg-cache] ✅ loadNearbyVenues patched');
  }


  /* ════════════════════════════════════════════════════════════
   *  5.  PATCH loadBmgGroundsGrid
   *      Original: 2 reads every time homepage loads
   *      Patched : cached 5 min
   * ════════════════════════════════════════════════════════════*/
  function patchLoadBmgGroundsGrid() {
    var original = window.loadBmgGroundsGrid;
    if (!original || original._cachePatched) return;

    window.loadBmgGroundsGrid = async function () {
      var grid = document.getElementById('bmg-grounds-grid');
      if (!grid) return;

      /* If cache is fresh, we still call original — it reads from Firestore
         but our _cached wrapper below intercepts those specific .get() calls
         by monkey-patching the collection references. Instead, we use a
         simpler approach: clone original's result from cache when available. */

      var cacheKey = 'bmgGroundsGrid';
      var cached = _cache.get(cacheKey);
      if (cached && (Date.now() - cached.ts) < TTL.GROUNDS) {
        grid.innerHTML = cached.data;
        /* Re-attach click handlers (innerHTML replacement strips them) */
        _rewireGroundsGridClicks(grid);
        console.log('[bmg-cache] HIT bmgGroundsGrid (HTML cache)');
        return;
      }

      /* Run original, then capture and store the rendered HTML */
      await original.apply(this, arguments);
      _cache.set(cacheKey, { data: grid.innerHTML, ts: Date.now() });
      console.log('[bmg-cache] MISS bmgGroundsGrid — rendered and cached');
    };

    window.loadBmgGroundsGrid._cachePatched = true;
    console.log('[bmg-cache] ✅ loadBmgGroundsGrid patched (HTML cache)');
  }

  function _rewireGroundsGridClicks(grid) {
    grid.querySelectorAll('.bmg-grid-ground-card').forEach(function (card) {
      card.addEventListener('click', function (e) {
        if (e.target.classList.contains('bmg-grid-book-btn')) return;
        if (card.dataset.groundId && typeof window.viewGround === 'function') window.viewGround(card.dataset.groundId);
        else if (card.dataset.venueId && typeof window.viewVenue === 'function') window.viewVenue(card.dataset.venueId);
      });
    });
    grid.querySelectorAll('.bmg-grid-book-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (btn.dataset.type === 'ground' && typeof window.viewGround === 'function') window.viewGround(btn.dataset.id);
        else if (typeof window.viewVenue === 'function') window.viewVenue(btn.dataset.id);
      });
    });
  }


  /* ════════════════════════════════════════════════════════════
   *  6.  PATCH loadBmgDealsSection
   *      Original: 1 read (30 grounds) on every homepage load
   *      Patched : HTML-cached 5 min
   * ════════════════════════════════════════════════════════════*/
  function patchLoadBmgDealsSection() {
    var original = window.loadBmgDealsSection;
    if (!original || original._cachePatched) return;

    window.loadBmgDealsSection = async function () {
      var cacheKey = 'bmgDeals';
      var cached = _cache.get(cacheKey);
      if (cached && (Date.now() - cached.ts) < TTL.GROUNDS) {
        var c99  = document.getElementById('bmg-deals-row-99');
        var c299 = document.getElementById('bmg-deals-row-299');
        if (c99  && cached.data.row99)  { c99.innerHTML  = cached.data.row99;  _rewireDealsClicks(c99);  }
        if (c299 && cached.data.row299) { c299.innerHTML = cached.data.row299; _rewireDealsClicks(c299); }
        console.log('[bmg-cache] HIT bmgDeals');
        return;
      }

      await original.apply(this, arguments);

      var r99  = document.getElementById('bmg-deals-row-99');
      var r299 = document.getElementById('bmg-deals-row-299');
      _cache.set(cacheKey, {
        data: { row99: r99 ? r99.innerHTML : '', row299: r299 ? r299.innerHTML : '' },
        ts: Date.now(),
      });
      console.log('[bmg-cache] MISS bmgDeals — rendered and cached');
    };

    window.loadBmgDealsSection._cachePatched = true;
    console.log('[bmg-cache] ✅ loadBmgDealsSection patched');
  }

  function _rewireDealsClicks(container) {
    container.querySelectorAll('.bmg-deal-ground-card').forEach(function (card) {
      card.addEventListener('click', function (e) {
        if (!e.target.classList.contains('bmg-deal-book-btn') && typeof window.viewGround === 'function') {
          window.viewGround(card.dataset.groundId);
        }
      });
    });
    container.querySelectorAll('.bmg-deal-book-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (typeof window.viewGround === 'function') window.viewGround(btn.dataset.groundId);
      });
    });
  }


  /* ════════════════════════════════════════════════════════════
   *  7.  PATCH loadBmgFeaturedGrounds
   *      Original: 1 read (promotions) + N reads (each ground doc)
   *      Patched : HTML-cached 10 min
   * ════════════════════════════════════════════════════════════*/
  function patchLoadBmgFeaturedGrounds() {
    var original = window.loadBmgFeaturedGrounds;
    if (!original || original._cachePatched) return;

    window.loadBmgFeaturedGrounds = async function () {
      var cacheKey = 'bmgFeatured';
      var cached = _cache.get(cacheKey);
      if (cached && (Date.now() - cached.ts) < TTL.PROMOTIONS) {
        var scroll = document.getElementById('bmg-featured-scroll');
        var section = document.getElementById('bmg-featured-section');
        if (scroll && cached.data !== '__empty__') {
          scroll.innerHTML = cached.data;
          if (section) section.style.display = '';
          _rewireFeaturedClicks(scroll);
          console.log('[bmg-cache] HIT bmgFeatured');
          return;
        }
        if (cached.data === '__empty__' && section) {
          section.style.display = 'none';
          return;
        }
      }

      await original.apply(this, arguments);

      var scroll2 = document.getElementById('bmg-featured-scroll');
      var section2 = document.getElementById('bmg-featured-section');
      var isEmpty = !section2 || section2.style.display === 'none';
      _cache.set(cacheKey, {
        data: isEmpty ? '__empty__' : (scroll2 ? scroll2.innerHTML : ''),
        ts: Date.now(),
      });
      console.log('[bmg-cache] MISS bmgFeatured — rendered and cached');
    };

    window.loadBmgFeaturedGrounds._cachePatched = true;
    console.log('[bmg-cache] ✅ loadBmgFeaturedGrounds patched');
  }

  function _rewireFeaturedClicks(scroll) {
    scroll.querySelectorAll('[data-ground-id]').forEach(function (el) {
      el.addEventListener('click', function () {
        if (typeof window.viewGround === 'function') window.viewGround(el.dataset.groundId);
      });
    });
  }


  /* ════════════════════════════════════════════════════════════
   *  8.  PATCH loadFeaturedTournament (homepage banner)
   *      Original: 1 read every homepage load + checkAndUpdateTournamentStatus
   *      Patched : HTML-cached 3 min  (spots change fast during reg)
   * ════════════════════════════════════════════════════════════*/
  function patchLoadFeaturedTournament() {
    var original = window.loadFeaturedTournament;
    if (!original || original._cachePatched) return;

    window.loadFeaturedTournament = async function () {
      var container = document.getElementById('featured-tournament');
      if (!container) return;

      var cacheKey = 'featuredTournament';
      var cached = _cache.get(cacheKey);
      if (cached && (Date.now() - cached.ts) < TTL.TOURNAMENTS) {
        container.innerHTML = cached.data;
        console.log('[bmg-cache] HIT featuredTournament');
        return;
      }

      await original.apply(this, arguments);
      _cache.set(cacheKey, { data: container.innerHTML, ts: Date.now() });
      console.log('[bmg-cache] MISS featuredTournament — fetched and cached');
    };

    window.loadFeaturedTournament._cachePatched = true;
    console.log('[bmg-cache] ✅ loadFeaturedTournament patched');
  }


  /* ════════════════════════════════════════════════════════════
   *  9.  PATCH loadAllTournaments (tournament page list)
   *      Original: 1 read every time the tournaments tab opens
   *      Patched : HTML-cached per filterStatus, 3 min TTL
   *      (3 min is short enough to catch spot changes during active reg)
   * ════════════════════════════════════════════════════════════*/
  function patchLoadAllTournaments() {
    var original = window.loadAllTournaments;
    if (!original || original._cachePatched) return;

    window.loadAllTournaments = async function (filterStatus) {
      filterStatus = filterStatus || 'upcoming';
      var container = document.getElementById('tournaments-list');
      if (!container) return original.apply(this, arguments);

      var cacheKey = 'tournaments:' + filterStatus;
      var cached = _cache.get(cacheKey);
      if (cached && (Date.now() - cached.ts) < TTL.TOURNAMENTS) {
        container.innerHTML = cached.data;
        console.log('[bmg-cache] HIT tournaments:' + filterStatus);
        return;
      }

      await original.apply(this, arguments);
      _cache.set(cacheKey, { data: container.innerHTML, ts: Date.now() });
      console.log('[bmg-cache] MISS tournaments:' + filterStatus + ' — fetched and cached');
    };

    window.loadAllTournaments._cachePatched = true;
    console.log('[bmg-cache] ✅ loadAllTournaments patched');
  }


  /* ════════════════════════════════════════════════════════════
   *  10. PATCH loadGroundReviews
   *      Original: 1 read per ground detail view
   *      Patched : cached 10 min per groundId
   *      (bust on submitReview so fresh reviews appear immediately)
   * ════════════════════════════════════════════════════════════*/
  function patchLoadGroundReviews() {
    var original = window.loadGroundReviews;
    if (!original || original._cachePatched) return;

    window.loadGroundReviews = async function (groundId) {
      var container = document.getElementById('ground-reviews');
      if (!container || !groundId) return original.apply(this, arguments);

      var cacheKey = 'reviews:' + groundId;
      var cached = _cache.get(cacheKey);
      if (cached && (Date.now() - cached.ts) < TTL.REVIEWS) {
        container.innerHTML = cached.data;
        console.log('[bmg-cache] HIT reviews:' + groundId);
        return;
      }

      await original.apply(this, arguments);
      _cache.set(cacheKey, { data: container.innerHTML, ts: Date.now() });
      console.log('[bmg-cache] MISS reviews:' + groundId + ' — fetched and cached');
    };

    window.loadGroundReviews._cachePatched = true;
    console.log('[bmg-cache] ✅ loadGroundReviews patched');
  }

  /** Bust review cache when a new review is submitted */
  function patchSubmitReview() {
    var original = window.submitReview;
    if (!original || original._cachePatched) return;

    window.submitReview = async function () {
      var result = await original.apply(this, arguments);
      /* Bust review cache for current ground */
      var gid = window.currentGround && window.currentGround.id;
      if (gid) _cacheClear('reviews:' + gid);
      return result;
    };

    window.submitReview._cachePatched = true;
  }


  /* ════════════════════════════════════════════════════════════
   *  11. PATCH loadProfilePage (stats reads)
   *      Original: 2–3 reads every profile tab open
   *      Patched : stats section reads cached 5 min
   *      (profile text fields come from window.currentUser — no read needed)
   * ════════════════════════════════════════════════════════════*/
  function patchLoadProfilePage() {
    var original = window.loadProfilePage;
    if (!original || original._cachePatched) return;

    window.loadProfilePage = async function () {
      var cu = window.currentUser;
      if (!cu) return original.apply(this, arguments);

      var statsKey = 'profileStats:' + cu.uid;
      var cachedStats = _cache.get(statsKey);

      if (cachedStats && (Date.now() - cachedStats.ts) < TTL.PROFILE_STATS) {
        /* Intercept db.collection() for the three stat collections only,
           returning instant fake snapshots so no Firestore read fires. */
        var db = window.db;
        var _origCollection = db.collection.bind(db);
        var _intercepted = 0;
        var STAT_COLS = { bookings: true, matches: true, grounds: true };

        db.collection = function (name) {
          if (STAT_COLS[name] && _intercepted < 3) {
            _intercepted++;
            var fakeSize = name === 'bookings' ? cachedStats.data.bookings
                         : name === 'matches'  ? cachedStats.data.matches
                         : (cachedStats.data.grounds || 0);
            var fakeSnap = { size: fakeSize, forEach: function () {}, docs: [] };
            var fakeQ = {
              where   : function () { return fakeQ; },
              orderBy : function () { return fakeQ; },
              limit   : function () { return fakeQ; },
              get     : function () { return Promise.resolve(fakeSnap); },
            };
            return fakeQ;
          }
          return _origCollection(name);
        };

        try {
          await original.apply(this, arguments);
        } finally {
          db.collection = _origCollection;
        }

        console.log('[bmg-cache] HIT profileStats:' + cu.uid);
        return;
      }

      /* No cache — run original, then read rendered DOM values */
      await original.apply(this, arguments);

      var bEl = document.getElementById('profile-stat-bookings');
      var mEl = document.getElementById('profile-stat-matches');
      var gEl = document.getElementById('profile-stat-grounds');
      if (bEl !== null || mEl !== null) {
        _cache.set(statsKey, {
          data: {
            bookings: bEl ? parseInt(bEl.textContent || '0', 10) : 0,
            matches  : mEl ? parseInt(mEl.textContent || '0', 10) : 0,
            grounds  : gEl ? parseInt(gEl.textContent || '0', 10) : 0,
          },
          ts: Date.now(),
        });
        console.log('[bmg-cache] MISS profileStats:' + cu.uid + ' — fetched and cached');
      }
    };

    window.loadProfilePage._cachePatched = true;
    console.log('[bmg-cache] ✅ loadProfilePage patched (stats cache)');
  }


  /* ════════════════════════════════════════════════════════════
   *  12. PATCH filterBySport
   *      Original: 2 full collection reads (no limit!) + N owner reads
   *      Patched : reuse cached grounds/venues, owner lookups cached
   * ════════════════════════════════════════════════════════════*/
  function patchFilterBySport() {
    var original = window.filterBySport;
    if (!original || original._cachePatched) return;

    window.filterBySport = async function (sport) {
      if (typeof window.showLoading === 'function') window.showLoading('Loading ' + sport + ' venues and grounds…');
      var container = document.getElementById('nearby-venues');
      if (!container) return original.apply(this, arguments);

      try {
        var db = window.db;
        var COLS = window.COLLECTIONS || {};

        /* Use a larger cached set for filtering */
        var venueArr = await _cached('venues:hidden=false:50', TTL.VENUES, async function () {
          var s = await db.collection(COLS.VENUES || 'venues')
            .where('hidden', '==', false).limit(50).get();
          return _snapToArr(s).map(function (d) { return Object.assign({ type: 'venue' }, d); });
        });

        var groundArr = await _cached('grounds:active:50', TTL.GROUNDS, async function () {
          var s = await db.collection(COLS.GROUNDS || 'grounds')
            .where('status', '==', 'active').limit(50).get();
          return _snapToArr(s).map(function (d) { return Object.assign({ type: 'ground', ownerType: 'venue_owner' }, d); });
        });

        var lc = sport.toLowerCase();

        var filteredVenues = venueArr.filter(function (v) {
          return v.sportType && v.sportType.toLowerCase() === lc;
        });

        var filteredGrounds = [];
        for (var i = 0; i < groundArr.length; i++) {
          var g = groundArr[i];
          if (!(g.sportType && g.sportType.toLowerCase() === lc)) continue;
          if (g.ownerId) {
            var ownerKey = 'owner:' + g.ownerId;
            var ownerArr = await (function (oid, colName) {
              return _cached(ownerKey, TTL.OWNERS, async function () {
                var d = await db.collection(colName).doc(oid).get().catch(function () { return null; });
                return d && d.exists ? [d.data()] : [{ ownerType: 'venue_owner' }];
              });
            }(g.ownerId, COLS.OWNERS || 'owners'));
            g = Object.assign({}, g, { ownerType: (ownerArr[0] && ownerArr[0].ownerType) || 'venue_owner' });
          }
          filteredGrounds.push(g);
        }

        var allItems = filteredVenues.concat(filteredGrounds);

        if (typeof window.hideLoading === 'function') window.hideLoading();

        if (!allItems.length) {
          container.innerHTML =
            '<div class="empty-state">' +
              '<i class="fas fa-search"></i>' +
              '<h3>No ' + sport + ' venues or grounds found</h3>' +
              '<p>Try another sport or check back later</p>' +
            '</div>';
          return;
        }

        if (typeof window.displayVenueItems === 'function') {
          window.displayVenueItems(container, allItems);
        }
      } catch (err) {
        console.error('[bmg-cache] filterBySport error:', err);
        if (typeof window.hideLoading === 'function') window.hideLoading();
        /* Fall back to original on error */
        original.apply(this, [sport]);
      }
    };

    window.filterBySport._cachePatched = true;
    console.log('[bmg-cache] ✅ filterBySport patched');
  }


  /* ════════════════════════════════════════════════════════════
   *  13. PATCH loadBmgPoolSection (homepage pool listing)
   *      Original: reads swimming_pools on every homepage load
   *      Patched : HTML-cached 5 min
   * ════════════════════════════════════════════════════════════*/
  function patchLoadBmgPoolSection() {
    var original = window.loadBmgPoolSection;
    if (!original || original._cachePatched) return;

    window.loadBmgPoolSection = async function () {
      var cacheKey = 'bmgPoolSection';
      var cached = _cache.get(cacheKey);
      var container = document.getElementById('bmg-pools-grid') || document.querySelector('.bmg-pool-section');

      if (cached && (Date.now() - cached.ts) < TTL.POOLS && container) {
        container.innerHTML = cached.data;
        console.log('[bmg-cache] HIT bmgPoolSection');
        return;
      }

      await original.apply(this, arguments);

      if (container) {
        _cache.set(cacheKey, { data: container.innerHTML, ts: Date.now() });
        console.log('[bmg-cache] MISS bmgPoolSection — fetched and cached');
      }
    };

    window.loadBmgPoolSection._cachePatched = true;
    console.log('[bmg-cache] ✅ loadBmgPoolSection patched');
  }


  /* ════════════════════════════════════════════════════════════
   *  14. CACHE-BUST ON KEY WRITES
   *      After a booking is confirmed, clear homepage + profile caches.
   *      After a new review is submitted, clear the review cache.
   *      After tournament registration, clear tournament caches.
   * ════════════════════════════════════════════════════════════*/
  function installCacheBusters() {

    /* On payment confirmed (booking) → bust profile stats + homepage */
    window.addEventListener('bmg:paymentConfirmed', function (e) {
      var type = e.detail && e.detail.paymentType;
      if (type === 'booking') {
        _cacheClear('profileStats:');
        /* Don't bust venue/ground lists — they don't change when a slot is booked */
      }
      if (type === 'tournament') {
        _cacheClear('tournaments:');
        _cacheClear('featuredTournament');
        _cacheClear('profileStats:');
      }
    });

    /* On auth state change (logout/login) → bust user-specific caches */
    window.addEventListener('bmg:pageShown', function (e) {
      var page = e.detail && e.detail.pageId;
      /* When bookings page shown after a write, clear profile stats */
      if (page === 'bookings-page') {
        var cu = window.currentUser;
        if (cu) _cacheClear('profileStats:' + cu.uid);
      }
    });

    console.log('[bmg-cache] Cache busters installed');
  }


  /* ════════════════════════════════════════════════════════════
   *  15. BOOT — install all patches once globals are ready
   * ════════════════════════════════════════════════════════════*/
  function installAll() {
    patchLoadNearbyVenues();
    patchLoadBmgGroundsGrid();
    patchLoadBmgDealsSection();
    patchLoadBmgFeaturedGrounds();
    patchLoadFeaturedTournament();
    patchLoadAllTournaments();
    patchLoadGroundReviews();
    patchSubmitReview();
    patchLoadProfilePage();
    patchFilterBySport();
    patchLoadBmgPoolSection();
    installCacheBusters();

    console.log('✅ [bmg_firestore_cache.js] All caching patches active — estimated 50–80 % read reduction');
  }

  /* Wait for the main app globals before patching */
  _waitFor('loadNearbyVenues', function () {
    /* Small delay so all duplicate-function shadowing in app.js finishes */
    setTimeout(installAll, 300);
  });

  console.log('✅ [bmg_firestore_cache.js] Loaded');

})();


/* ═══════════════════════════════════════════════════════════════════
 * ██ comprehensive_fixes.js
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * comprehensive_fixes.js
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * FIXES THREE CRITICAL ISSUES:
 * 
 * BUG 1 — Swimming pools section shows nothing / mixed with grounds
 *    CAUSE: loadBmgPoolSection() queries swimming_pools collection but doesn't 
 *           display them properly, or filters aren't applied. Pools might have 
 *           wrong status or the display logic is broken.
 *    FIX: Complete rewrite of loadBmgPoolSection with proper filtering, location
 *         awareness, and distance-based sorting. Use cached location if geolocation fails.
 *
 * BUG 2 — Location detection only works after manual refresh
 *    CAUSE: getUserLocation() runs once on DOMContentLoaded with a 50ms delay.
 *           If geolocation.getCurrentPosition() times out or user denies permission,
 *           no automatic retry happens. Location from localStorage might be stale.
 *    FIX: Add exponential backoff retry logic, use browser cache as fallback,
 *         auto-refresh location periodically, show proper status to user.
 *
 * BUG 3 — Search bar doesn't work / no results for grounds by city or name
 *    CAUSE: searchVenues() may not be properly bound to input listeners, or 
 *           search logic doesn't include all necessary fields (city, description).
 *           Search might not trigger on real-time input.
 *    FIX: Patch the search event listeners, ensure proper debouncing, include
 *         location-aware search results, add "search not found" fallback.
 *
 * LOAD ORDER — Add LAST in index.html after all other scripts:
 *   <script src="comprehensive_fixes.js"></script>
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  // ════════════════════════════════════════════════════════════
  // FIX 1: Improve getUserLocation with retry & caching
  // ════════════════════════════════════════════════════════════
  
  let locationRetryCount = 0;
  const MAX_LOCATION_RETRIES = 5;
  const LOCATION_CACHE_KEY = 'bmg_user_location_cache';
  const LOCATION_CACHE_EXPIRY = 3600000; // 1 hour in milliseconds

  function getCachedLocation() {
    try {
      const cached = localStorage.getItem(LOCATION_CACHE_KEY);
      if (!cached) return null;
      
      const { location, timestamp } = JSON.parse(cached);
      // Check if cache is still valid
      if (Date.now() - timestamp < LOCATION_CACHE_EXPIRY) {
        console.log('[BMG] Using cached location');
        return location;
      }
      // Cache expired
      localStorage.removeItem(LOCATION_CACHE_KEY);
    } catch (e) {
      console.warn('[BMG] Cache parse error:', e);
    }
    return null;
  }

  function saveCachedLocation(location) {
    try {
      localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify({
        location: location,
        timestamp: Date.now()
      }));
    } catch (e) {
      console.warn('[BMG] Could not save location cache');
    }
  }

  function improvedGetUserLocation() {
    locationRetryCount = 0;
    
    if (!navigator.geolocation) {
      console.warn('[BMG] Geolocation not available');
      const locationEl = document.getElementById('current-location');
      if (locationEl) locationEl.textContent = 'Location unavailable';
      
      // Try cached location
      const cached = getCachedLocation();
      if (cached && window.userLocation !== undefined) {
        window.userLocation = cached;
        attemptLoadMainPage();
      }
      return;
    }

    // Update UI to show we're detecting
    const locationEl = document.getElementById('current-location');
    if (locationEl) locationEl.textContent = '📍 Detecting...';

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const newLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy
          };
          
          // Save globally
          if (window.userLocation === undefined) window.userLocation = {};
          window.userLocation.lat = newLocation.lat;
          window.userLocation.lng = newLocation.lng;
          
          // Save to cache
          saveCachedLocation(newLocation);
          
          // Fetch location name from reverse geocoding
          try {
            const response = await fetch(
              `https://nominatim.openstreetmap.org/reverse?format=json&lat=${newLocation.lat}&lon=${newLocation.lng}&zoom=18&addressdetails=1&accept-language=en`
            );
            const data = await response.json();
            
            let locationText = '';
            if (data.address) {
              const area = data.address.suburb || data.address.neighbourhood || data.address.road || '';
              const city = data.address.city || data.address.town || data.address.village || '';
              locationText = area ? `${area}, ${city}` : city || 'Location detected';
            } else {
              locationText = `${newLocation.lat.toFixed(4)}, ${newLocation.lng.toFixed(4)}`;
            }
            
            if (locationEl) {
              locationEl.textContent = '📍 ' + locationText;
              locationEl.style.color = '#10b981';
            }
            
            console.log('[BMG] Location detected:', locationText);
            locationRetryCount = 0; // Reset retry counter on success
            
            // Reload content with new location
            attemptLoadMainPage();
            
          } catch (geoError) {
            // Geocoding failed, but we have coordinates
            if (locationEl) {
              locationEl.textContent = `📍 ${newLocation.lat.toFixed(4)}, ${newLocation.lng.toFixed(4)}`;
            }
            console.warn('[BMG] Geocoding failed, using coordinates');
            attemptLoadMainPage();
          }
        } catch (e) {
          console.error('[BMG] Error processing location:', e);
          attemptLoadMainPage();
        }
      },
      (error) => {
        console.warn('[BMG] Geolocation error:', error.message);
        
        // Try cached location first
        const cached = getCachedLocation();
        if (cached) {
          console.log('[BMG] Using cached location after geolocation failure');
          window.userLocation = cached;
          if (locationEl) {
            locationEl.textContent = '📍 Cached location (refresh for live)';
            locationEl.style.color = '#f59e0b';
          }
          attemptLoadMainPage();
          return;
        }
        
        // Retry with exponential backoff
        if (locationRetryCount < MAX_LOCATION_RETRIES) {
          locationRetryCount++;
          const delay = Math.min(1000 * Math.pow(2, locationRetryCount - 1), 10000);
          console.log(`[BMG] Retrying location (attempt ${locationRetryCount}/${MAX_LOCATION_RETRIES}) in ${delay}ms`);
          setTimeout(improvedGetUserLocation, delay);
          return;
        }
        
        // All retries exhausted
        if (locationEl) {
          locationEl.textContent = '📍 Location unavailable (tap to retry)';
          locationEl.style.cursor = 'pointer';
          locationEl.style.color = '#ef4444';
          locationEl.addEventListener('click', improvedGetUserLocation, { once: true });
        }
        
        attemptLoadMainPage();
      },
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 300000 // Allow 5-minute-old location if geolocation is slow
      }
    );
  }

  function attemptLoadMainPage() {
    if (document.getElementById('main-page')?.classList.contains('active')) {
      if (typeof window.loadNearbyVenues === 'function') {
        window.loadNearbyVenues();
      }
      if (typeof window.loadBmgPoolSection === 'function') {
        window.loadBmgPoolSection();
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  // FIX 1B: Patch the global getUserLocation to use improved version
  // ════════════════════════════════════════════════════════════
  
  if (typeof window.getUserLocation === 'function') {
    window._originalGetUserLocation = window.getUserLocation;
  }
  window.getUserLocation = improvedGetUserLocation;
  
  console.log('[BMG] Location detection improved with retry + caching');

  // ════════════════════════════════════════════════════════════
  // FIX 2: Rewrite loadBmgPoolSection with proper filtering & display
  // ════════════════════════════════════════════════════════════

  async function improvedLoadBmgPoolSection() {
    const row = document.getElementById('bmg-pool-scroll-row');
    const emptyMsg = document.getElementById('bmg-pool-empty');
    
    if (!row) {
      console.warn('[BMG Pools] bmg-pool-scroll-row not found');
      return;
    }

    try {
      // Show loading state
      row.innerHTML = `
        <div style="grid-column: 1/-1; padding: 20px; text-align: center; color: #999;">
          <div class="loader-spinner" style="margin: 0 auto 12px;"></div>
          <p>Loading swimming pools...</p>
        </div>
      `;

      // Get Firestore instance (should be available globally as 'db')
      if (typeof window.db === 'undefined') {
        throw new Error('Firestore not initialized');
      }

      // Query all active swimming pools
      const snap = await window.db.collection('swimming_pools')
        .where('status', '==', 'active')
        .limit(20)
        .get();

      console.log(`[BMG Pools] Found ${snap.size} active swimming pools`);

      // Clear loading
      row.innerHTML = '';

      if (snap.empty) {
        console.log('[BMG Pools] No swimming pools found');
        if (emptyMsg) {
          emptyMsg.style.display = 'block';
          emptyMsg.innerHTML = `
            <span style="font-size: 32px; margin-bottom: 12px; display: block;">🏊</span>
            <p style="margin: 0; font-weight: 600; color: #374151;">No swimming pools yet</p>
            <small style="color: #9ca3af; margin-top: 4px; display: block;">Check back soon or add your own!</small>
          `;
        }
        return;
      }

      if (emptyMsg) emptyMsg.style.display = 'none';

      // Get today's date for availability check
      const today = new Date().toISOString().split('T')[0];
      
      // Build pool cards with proper sorting (by distance if location available)
      const poolCards = [];
      
      for (const doc of snap.docs) {
        const pool = { id: doc.id, ...doc.data() };
        
        // Calculate distance if location available
        if (window.userLocation && pool.location && pool.location.latitude && pool.location.longitude) {
          pool.distance = calculateDistance(
            window.userLocation.lat,
            window.userLocation.lng,
            pool.location.latitude,
            pool.location.longitude
          );
        } else {
          pool.distance = Infinity;
        }
        
        poolCards.push(pool);
      }

      // Sort by distance
      poolCards.sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity));

      // Render cards
      for (const pool of poolCards) {
        try {
          const card = await buildPoolHomeCard(pool, today);
          row.appendChild(card);
        } catch (cardError) {
          console.warn('[BMG Pools] Error building card for', pool.poolName, ':', cardError.message);
          // Continue with next card instead of failing completely
        }
      }

      console.log('[BMG Pools] Rendered', poolCards.length, 'pools');

    } catch (err) {
      console.error('[BMG Pools] Error in loadBmgPoolSection:', err.message);
      row.innerHTML = '';
      if (emptyMsg) {
        emptyMsg.style.display = 'block';
        emptyMsg.innerHTML = `
          <span style="font-size: 32px; margin-bottom: 12px; display: block;">⚠️</span>
          <p style="margin: 0; font-weight: 600; color: #ef4444;">Error loading pools</p>
          <small style="color: #9ca3af; margin-top: 4px; display: block;">Please refresh the page</small>
        `;
      }
    }
  }

  // Patch loadBmgPoolSection
  if (typeof window.loadBmgPoolSection === 'function') {
    window._originalLoadBmgPoolSection = window.loadBmgPoolSection;
  }
  window.loadBmgPoolSection = improvedLoadBmgPoolSection;
  
  console.log('[BMG] Swimming pool section improved with location filtering');

  // ════════════════════════════════════════════════════════════
  // FIX 3: Patch search input to work properly
  // ════════════════════════════════════════════════════════════

  function setupSearchListeners() {
    const searchInput = document.getElementById('global-search');
    const clearBtn = document.getElementById('search-clear-btn');
    
    if (!searchInput) {
      console.warn('[BMG Search] global-search input not found');
      return;
    }

    // Create debounced search function if not exists
    if (typeof window.searchVenues !== 'function') {
      window.searchVenues = debounce(async (searchTerm) => {
        console.log('[BMG Search] Searching for:', searchTerm);
        
        if (!searchTerm || searchTerm.length < 2) {
          if (searchTerm === '') {
            if (clearBtn) clearBtn.style.display = 'none';
            if (searchInput) searchInput.classList.remove('search-active');
            if (typeof window.loadNearbyVenues === 'function') {
              window.loadNearbyVenues();
            }
          }
          return;
        }

        // Show active state
        if (searchInput) searchInput.classList.add('search-active');
        if (clearBtn) clearBtn.style.display = 'flex';

        const grid = document.getElementById('bmg-grounds-grid');
        if (grid) {
          grid.innerHTML = `
            <div style="grid-column: 1/-1; padding: 40px 20px; text-align: center;">
              <div class="loader-spinner" style="margin: 0 auto 12px;"></div>
              <p style="color: #6b7280;">Searching...</p>
            </div>
          `;
        }

        try {
          const searchLower = searchTerm.toLowerCase().trim();
          const items = [];

          // Fetch venues and grounds in parallel
          const [venueSnap, groundSnap] = await Promise.all([
            window.db.collection('venues').get(),
            window.db.collection('grounds').where('status', '==', 'active').get()
          ]);

          // Search venues
          venueSnap.forEach(doc => {
            const v = doc.data();
            if (v.hidden) return;
            
            const haystack = [
              v.venueName,
              v.address,
              v.sportType,
              v.city,
              v.description,
              v.ownerCity
            ].filter(Boolean).join(' ').toLowerCase();
            
            if (haystack.includes(searchLower)) {
              items.push({
                id: doc.id,
                type: 'venue',
                ...v
              });
            }
          });

          // Search grounds
          groundSnap.forEach(doc => {
            const g = doc.data();
            
            const haystack = [
              g.groundName,
              g.groundAddress,
              g.sportType,
              g.city,
              g.description,
              g.ownerCity
            ].filter(Boolean).join(' ').toLowerCase();
            
            if (haystack.includes(searchLower)) {
              items.push({
                id: doc.id,
                type: 'ground',
                ...g
              });
            }
          });

          // Add distance if user location available
          if (window.userLocation && typeof calculateDistance === 'function') {
            items.forEach(item => {
              if (item.location && item.location.latitude && item.location.longitude) {
                item.distance = calculateDistance(
                  window.userLocation.lat,
                  window.userLocation.lng,
                  item.location.latitude,
                  item.location.longitude
                );
              }
            });
            items.sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity));
          }

          console.log('[BMG Search] Found', items.length, 'results');

          // Display results
          if (grid) {
            grid.innerHTML = '';
            if (items.length === 0) {
              grid.innerHTML = `
                <div style="grid-column: 1/-1; padding: 40px 20px; text-align: center;">
                  <p style="color: #999; font-size: 18px;">No venues or grounds found</p>
                  <small style="color: #bbb;">Try different keywords or location</small>
                </div>
              `;
            } else {
              items.forEach((item, idx) => {
                const card = createSearchResultCard(item);
                if (card) grid.appendChild(card);
              });
            }
          }

          // Update result count
          const countEl = document.getElementById('search-result-count');
          if (countEl) {
            countEl.style.display = items.length > 0 ? 'block' : 'none';
            countEl.textContent = `${items.length} result${items.length !== 1 ? 's' : ''} found`;
          }

        } catch (error) {
          console.error('[BMG Search] Error:', error);
          if (grid) {
            grid.innerHTML = `
              <div style="grid-column: 1/-1; padding: 40px 20px; text-align: center;">
                <p style="color: #ef4444;">Error searching</p>
              </div>
            `;
          }
        }
      }, 500); // 500ms debounce
    }

    // Attach input listener
    searchInput.removeEventListener('input', onSearchInput);
    searchInput.addEventListener('input', onSearchInput);

    // Attach clear button listener
    if (clearBtn) {
      clearBtn.removeEventListener('click', onSearchClear);
      clearBtn.addEventListener('click', onSearchClear);
    }

    console.log('[BMG] Search listeners attached');
  }

  function onSearchInput(e) {
    const value = (e.target.value || '').trim();
    if (typeof window.searchVenues === 'function') {
      window.searchVenues(value);
    }
  }

  function onSearchClear(e) {
    e.preventDefault();
    const searchInput = document.getElementById('global-search');
    if (searchInput) {
      searchInput.value = '';
      searchInput.focus();
      if (typeof window.searchVenues === 'function') {
        window.searchVenues('');
      }
    }
  }

  function createSearchResultCard(item) {
    if (!item) return null;

    const card = document.createElement('div');
    card.className = 'bmg-search-result-card';
    
    const image = (item.images && item.images[0]) || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"%3E%3Crect fill="%23f0f4ff" width="400" height="200"/%3E%3Ctext x="200" y="100" text-anchor="middle" dy=".3em" fill="%232563eb" font-size="48"%3E' + (item.type === 'venue' ? '🏟️' : '⚽') + '%3C/text%3E%3C/svg%3E';
    
    const distance = item.distance ? `${item.distance.toFixed(1)} km away` : '';
    const distanceHtml = distance ? `<div style="font-size: 12px; color: #9ca3af;">📍 ${distance}</div>` : '';

    card.innerHTML = `
      <img src="${escapeHtml(image)}" alt="${escapeHtml(item.groundName || item.venueName)}" 
           style="width: 100%; height: 120px; object-fit: cover; border-radius: 8px 8px 0 0;">
      <div style="padding: 12px;">
        <div style="font-weight: 600; color: #0f1f5c; font-size: 14px; margin-bottom: 4px;">
          ${escapeHtml(item.groundName || item.venueName || 'Unknown')}
        </div>
        <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">
          ${escapeHtml(item.sportType || 'Multi-sport')} • ${escapeHtml(item.city || item.address || 'Location')}
        </div>
        ${distanceHtml}
      </div>
    `;

    card.style.cursor = 'pointer';
    card.addEventListener('click', () => {
      if (item.type === 'venue') {
        if (typeof window.openVenuePage === 'function') {
          window.openVenuePage({ id: item.id, ...item });
        }
      } else if (item.type === 'ground') {
        if (typeof window.showGroundDetails === 'function') {
          window.showGroundDetails(item.id);
        }
      }
    });

    return card;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  // Debounce utility if not exists
  if (typeof window.debounce !== 'function') {
    window.debounce = function(fn, delay) {
      let timeoutId;
      return function(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn.apply(this, args), delay);
      };
    };
  }

  // Calculate distance utility if not exists
  if (typeof window.calculateDistance !== 'function') {
    window.calculateDistance = function(lat1, lon1, lat2, lon2) {
      const R = 6371; // Earth's radius in km
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      return R * c;
    };
  }

  // ════════════════════════════════════════════════════════════
  // Boot up
  // ════════════════════════════════════════════════════════════

  // Wait for DOM to be ready
  function initializeSearchAndLocation() {
    setupSearchListeners();
    console.log('[BMG] Search functionality initialized');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeSearchAndLocation);
  } else {
    initializeSearchAndLocation();
  }

  // Also try to get cached location immediately while waiting for geolocation
  const cached = getCachedLocation();
  if (cached) {
    window.userLocation = cached;
    console.log('[BMG] Using cached location on startup');
  }

  console.log('✅ [comprehensive_fixes.js] ALL FIXES ACTIVE:');
  console.log('   ✓ Location detection improved (retry + caching)');
  console.log('   ✓ Swimming pools section rewritten (location-aware)');
  console.log('   ✓ Search functionality enhanced');

})();


/* ═══════════════════════════════════════════════════════════════════
 * ██ grounds_carousel_patch.js
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * grounds_carousel_patch.js  v2
 * ─────────────────────────────────────────────────────────────
 * THREE fixes in one file:
 *
 * FIX 1 — cleanupExpiredLocks "Missing permissions" error
 *   Guards the interval so it only fires when a user is signed in.
 *
 * FIX 2 — Home page grounds look unprofessional (big vertical cards)
 *   Overrides sportobook_patches_merged.js loadNearbyVenues with a
 *   professional horizontal swipe carousel with sport-gradient cards.
 *
 * LOAD ORDER — must come LAST in index.html:
 *   <script src="app.js"></script>
 *   <script src="sportobook_patches_merged.js"></script>
 *   <script src="bmg_auth_fix.js"></script>
 *   <script src="grounds_carousel_patch.js"></script>   ← add this
 * ─────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════
   * FIX 1 — Guard cleanupExpiredLocks for unauthenticated users
   * ══════════════════════════════════════════════════════════ */
  const _origCleanup = window.cleanupExpiredLocks;
  window.cleanupExpiredLocks = function () {
    if (!window.auth || !window.auth.currentUser) return;
    if (typeof _origCleanup === 'function') _origCleanup();
  };
  setInterval(window.cleanupExpiredLocks, 60000);

  /* ══════════════════════════════════════════════════════════
   * Sport colours & icons
   * ══════════════════════════════════════════════════════════ */
  var SPORT_CFG = {
    'Cricket':    { grad: '#16a34a,#15803d', icon: '🏏' },
    'Football':   { grad: '#1d4ed8,#1e40af', icon: '⚽' },
    'Badminton':  { grad: '#ea580c,#c2410c', icon: '🏸' },
    'Tennis':     { grad: '#166534,#14532d', icon: '🎾' },
    'Basketball': { grad: '#c2410c,#9a3412', icon: '🏀' },
    'Volleyball': { grad: '#0369a1,#075985', icon: '🏐' },
    'Swimming':   { grad: '#0891b2,#0e7490', icon: '🏊' },
    'default':    { grad: '#374151,#1f2937', icon: '🏟️' }
  };
  function sportCfg(s) { return SPORT_CFG[s] || SPORT_CFG['default']; }

  /* ══════════════════════════════════════════════════════════
   * Inject CSS once
   * ══════════════════════════════════════════════════════════ */
  function injectCSS() {
    if (document.getElementById('gcp-v2-style')) return;
    var el = document.createElement('style');
    el.id = 'gcp-v2-style';
    el.textContent = [
      '#nearby-venues{display:block!important;flex-direction:unset!important;gap:unset!important;overflow:visible!important;}',
      '.bmg-nearby-grid{display:none!important;}',
      '.bmg-distance-banner{margin:0 0 10px!important;border-radius:10px!important;font-size:12px!important;}',
      '.gcp-shell{margin:0 -16px;padding:0 0 4px;}',
      '.gcp-scroll{display:flex;gap:12px;overflow-x:auto;overflow-y:visible;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding:6px 16px 14px;cursor:grab;user-select:none;}',
      '.gcp-scroll:active{cursor:grabbing;}',
      '.gcp-scroll::-webkit-scrollbar{display:none;}',
      '.gcp-card{flex:0 0 200px;scroll-snap-align:start;border-radius:16px;overflow:hidden;background:#fff;box-shadow:0 2px 14px rgba(0,0,0,.11),0 1px 3px rgba(0,0,0,.07);cursor:pointer;transition:transform .18s ease,box-shadow .18s ease;position:relative;-webkit-tap-highlight-color:transparent;}',
      '.gcp-card:active{transform:scale(.96);box-shadow:0 1px 6px rgba(0,0,0,.12);}',
      '.gcp-hero{height:118px;position:relative;display:flex;align-items:flex-start;justify-content:flex-end;padding:8px;}',
      '.gcp-hero-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;}',
      '.gcp-hero-scrim{position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.65) 0%,rgba(0,0,0,0) 50%);}',
      '.gcp-hero-emoji{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:46px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.3));}',
      '.gcp-price-chip{position:relative;z-index:3;background:rgba(255,255,255,.92);border-radius:20px;padding:3px 9px;font-size:11px;font-weight:700;color:#15803d;letter-spacing:.2px;white-space:nowrap;}',
      '.gcp-verified-chip{position:absolute;top:8px;left:8px;z-index:3;background:#1d4ed8;color:#fff;border-radius:20px;padding:2px 7px;font-size:9px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;}',
      '.gcp-body{padding:10px 12px 12px;}',
      '.gcp-name{font-size:13px;font-weight:700;color:#111827;line-height:1.3;margin:0 0 5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.gcp-row{display:flex;align-items:center;gap:5px;margin-bottom:7px;}',
      '.gcp-sport-tag{font-size:10px;font-weight:700;color:#fff;border-radius:20px;padding:2px 8px;letter-spacing:.2px;white-space:nowrap;}',
      '.gcp-city{font-size:10px;color:#6b7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;}',
      '.gcp-bottom{display:flex;align-items:center;justify-content:space-between;}',
      '.gcp-rating{display:flex;align-items:center;gap:3px;font-size:11px;font-weight:700;color:#374151;}',
      '.gcp-star{color:#f59e0b;font-size:12px;}',
      '.gcp-book-btn{background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;border:none;border-radius:20px;padding:4px 12px;font-size:10px;font-weight:700;cursor:pointer;letter-spacing:.2px;white-space:nowrap;}',
      '.gcp-dots{display:flex;justify-content:center;gap:4px;padding:0 16px 2px;}',
      '.gcp-dot{height:4px;width:4px;border-radius:2px;background:#d1d5db;transition:width .25s ease,background .25s ease;cursor:pointer;}',
      '.gcp-dot.active{background:#2563eb;width:16px;}',
      '.gcp-skel{flex:0 0 200px;height:210px;border-radius:16px;background:linear-gradient(90deg,#f3f4f6 25%,#e5e7eb 50%,#f3f4f6 75%);background-size:400% 100%;animation:gcp-shim 1.3s ease-in-out infinite;}',
      '@keyframes gcp-shim{0%{background-position:100% 0}100%{background-position:-100% 0}}'
    ].join('');
    document.head.appendChild(el);
  }

  /* ══════════════════════════════════════════════════════════
   * HTML helpers
   * ══════════════════════════════════════════════════════════ */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function buildCard(item) {
    var isGround = (item._type || item.type) === 'ground';
    var name     = item.groundName || item.venueName || 'Ground';
    var sport    = item.sportType || item.sport || 'Multi-sport';
    var sc       = sportCfg(sport);
    var image    = (item.images && item.images[0]) || item.imageUrl || '';
    var price    = item.pricePerHour || item.price;
    var rating   = Number(item.rating || 0);
    var verified = item.isVerified;
    var city     = item.city || item.address || '';
    var dist     = item._dist != null ? item._dist.toFixed(1) + ' km away' : '';
    var id       = item._id || item.id;
    var type     = item._type || item.type;

    var heroStyle = 'background:linear-gradient(135deg,' + sc.grad + ')';
    var imgHtml   = image
      ? '<img class="gcp-hero-img" src="' + esc(image) + '" alt="' + esc(name) + '" loading="lazy" onerror="this.style.display=\'none\'">'
      : '';
    var emojiHtml = image ? '' : '<div class="gcp-hero-emoji">' + sc.icon + '</div>';
    var priceHtml = price
      ? '<span class="gcp-price-chip">₹' + Number(price).toLocaleString('en-IN') + '/hr</span>'
      : '';
    var verifiedHtml = verified ? '<span class="gcp-verified-chip">✓ Verified</span>' : '';
    var ratingHtml   = rating > 0
      ? '<span class="gcp-star">★</span><span>' + rating.toFixed(1) + '</span>'
      : '<span style="font-size:10px;color:#9ca3af;">No reviews</span>';
    var cityOrDist = dist || city;

    return '<div class="gcp-card" data-id="' + esc(id) + '" data-type="' + esc(type) + '">' +
      '<div class="gcp-hero" style="' + heroStyle + '">' +
        imgHtml + emojiHtml +
        '<div class="gcp-hero-scrim"></div>' +
        verifiedHtml + priceHtml +
      '</div>' +
      '<div class="gcp-body">' +
        '<div class="gcp-name" title="' + esc(name) + '">' + esc(name) + '</div>' +
        '<div class="gcp-row">' +
          '<span class="gcp-sport-tag" style="background:linear-gradient(135deg,' + sc.grad + ')">' + esc(sport) + '</span>' +
          (cityOrDist ? '<span class="gcp-city">' + esc(cityOrDist) + '</span>' : '') +
        '</div>' +
        '<div class="gcp-bottom">' +
          '<div class="gcp-rating">' + ratingHtml + '</div>' +
          '<button class="gcp-book-btn">View &amp; Book</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function buildCarousel(items, banner) {
    var cards = items.map(buildCard).join('');
    var dots  = items.map(function(_, i) {
      return '<div class="gcp-dot' + (i === 0 ? ' active' : '') + '" data-idx="' + i + '"></div>';
    }).join('');
    return (banner || '') +
      '<div class="gcp-shell">' +
        '<div class="gcp-scroll" id="gcp-scroll">' + cards + '</div>' +
        '<div class="gcp-dots" id="gcp-dots">' + dots + '</div>' +
      '</div>';
  }

  function buildSkeletons() {
    return '<div class="gcp-shell"><div class="gcp-scroll">' +
      '<div class="gcp-skel"></div>'.repeat(4) +
      '</div></div>';
  }

  /* ══════════════════════════════════════════════════════════
   * Wire touch / mouse / dots interactions
   * ══════════════════════════════════════════════════════════ */
  function wireCarousel(container) {
    var scroll = container.querySelector('#gcp-scroll');
    var dotEls = container.querySelectorAll('.gcp-dot');
    if (!scroll) return;

    var dragging = false, startX = 0, scrollLeft = 0;
    scroll.addEventListener('mousedown', function(e) {
      dragging = true;
      startX = e.pageX - scroll.offsetLeft;
      scrollLeft = scroll.scrollLeft;
      scroll.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', function(e) {
      if (!dragging) return;
      e.preventDefault();
      scroll.scrollLeft = scrollLeft - (e.pageX - scroll.offsetLeft - startX) * 1.4;
    });
    window.addEventListener('mouseup', function() {
      dragging = false;
      scroll.style.cursor = 'grab';
    });

    var dotTimer;
    scroll.addEventListener('scroll', function() {
      clearTimeout(dotTimer);
      dotTimer = setTimeout(function() {
        var cards = scroll.querySelectorAll('.gcp-card');
        if (!cards.length) return;
        var w = cards[0].offsetWidth + 12;
        var idx = Math.min(Math.round(scroll.scrollLeft / w), dotEls.length - 1);
        dotEls.forEach(function(d, i) { d.classList.toggle('active', i === idx); });
      }, 60);
    }, { passive: true });

    dotEls.forEach(function(dot) {
      dot.addEventListener('click', function() {
        var cards = scroll.querySelectorAll('.gcp-card');
        var w = ((cards[0] && cards[0].offsetWidth) || 200) + 12;
        scroll.scrollTo({ left: +dot.dataset.idx * w, behavior: 'smooth' });
      });
    });

    scroll.querySelectorAll('.gcp-card').forEach(function(card) {
      card.addEventListener('click', function() {
        if (dragging) return;
        var id   = card.dataset.id;
        var type = card.dataset.type;
        if (type === 'venue') {
          (window.viewVenueDetails || window.viewVenue || function(){})(id);
        } else {
          (window.viewGroundDetails || window.viewGround || window.showGroundDetails || function(){})(id);
        }
      });
    });

    scroll.querySelectorAll('.gcp-book-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var card = btn.closest('.gcp-card');
        if (card) card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    });
  }

  /* ══════════════════════════════════════════════════════════
   * Haversine
   * ══════════════════════════════════════════════════════════ */
  function haversine(lat1, lon1, lat2, lon2) {
    var R = 6371, dLat = (lat2 - lat1) * Math.PI / 180,
      dLon = (lon2 - lon1) * Math.PI / 180,
      a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
          Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /* ══════════════════════════════════════════════════════════
   * Main loader
   * ══════════════════════════════════════════════════════════ */
  async function gcpLoadNearbyVenues(forceCity) {
    var container = document.getElementById('nearby-venues');
    if (!container) return;
    injectCSS();
    container.innerHTML = buildSkeletons();

    try {
      var userLat = null, userLng = null;
      try {
        var pos = await Promise.race([
          new Promise(function(res, rej) { navigator.geolocation.getCurrentPosition(res, rej, { timeout: 3000 }); }),
          new Promise(function(_, rej) { setTimeout(function() { rej(new Error('timeout')); }, 3000); })
        ]);
        userLat = pos.coords.latitude;
        userLng = pos.coords.longitude;
      } catch (_) {}

      var cu = window.currentUser;
      var userCity = forceCity || (cu && (cu.city || cu.cityLower)) || localStorage.getItem('bmg_user_city') || '';
      var db = window.db;

      var vQ = db.collection('venues').where('hidden', '==', false).limit(20);
      var gQ = db.collection('grounds').where('status', '==', 'active').limit(20);
      if (userCity) {
        var cl = userCity.toLowerCase();
        vQ = vQ.where('cityLower', '==', cl);
        gQ = gQ.where('cityLower', '==', cl);
      }

      var snapshots = await Promise.all([
        vQ.get().catch(function() { return db.collection('venues').where('hidden', '==', false).limit(20).get(); }),
        gQ.get().catch(function() { return db.collection('grounds').where('status', '==', 'active').limit(20).get(); })
      ]);
      var vSnap = snapshots[0], gSnap = snapshots[1];

      var items = [];
      vSnap.forEach(function(d) { items.push(Object.assign({ _id: d.id, _type: 'venue' }, d.data())); });
      gSnap.forEach(function(d) { items.push(Object.assign({ _id: d.id, _type: 'ground' }, d.data())); });

      items = items.map(function(it) {
        it._dist = (userLat && it.location && it.location.latitude)
          ? haversine(userLat, userLng, it.location.latitude, it.location.longitude)
          : null;
        return it;
      }).sort(function(a, b) {
        if (a._dist !== null && b._dist !== null) return a._dist - b._dist;
        if (a._dist !== null) return -1;
        if (b._dist !== null) return 1;
        return (b.rating || 0) - (a.rating || 0);
      });

      var show = items.slice(0, 10);

      if (!show.length) {
        container.innerHTML = '<div style="text-align:center;padding:36px 16px;color:#9ca3af;">' +
          '<div style="font-size:36px;margin-bottom:8px;">🏟️</div>' +
          '<p style="font-weight:700;color:#374151;margin:0 0 4px;">No venues found nearby</p>' +
          '<p style="font-size:12px;margin:0;">Check back later for new listings</p></div>';
        return;
      }

      var banner = userLat
        ? '<div class="bmg-distance-banner"><i class="fas fa-location-arrow"></i> Showing grounds near your location</div>'
        : '';

      container.innerHTML = buildCarousel(show, banner);
      wireCarousel(container);

    } catch (err) {
      console.error('[GCP] loadNearbyVenues error:', err);
      container.innerHTML = '<div style="text-align:center;padding:32px 16px;color:#9ca3af;">' +
        '<i class="fas fa-exclamation-circle" style="font-size:28px;display:block;margin-bottom:8px;color:#ef4444;"></i>' +
        '<p style="font-weight:600;color:#374151;margin:0;">Couldn\'t load venues</p></div>';
    }
  }

  /* ══════════════════════════════════════════════════════════
   * Install — runs after all prior scripts settle
   * ══════════════════════════════════════════════════════════ */
  function install() {
    window.loadNearbyVenues = gcpLoadNearbyVenues;

    window.displayVenueItems = function(container, items) {
      if (!container) return;
      injectCSS();
      if (!items || !items.length) {
        container.innerHTML = '<div style="text-align:center;padding:36px 16px;color:#9ca3af;">' +
          '<div style="font-size:36px;margin-bottom:8px;">🏟️</div>' +
          '<p style="font-weight:700;color:#374151;margin:0;">No venues found nearby</p></div>';
        return;
      }
      var normalised = items.map(function(it) {
        return Object.assign({}, it, { _id: it.id || it._id, _type: it.type || it._type || 'ground' });
      });
      container.innerHTML = buildCarousel(normalised, '');
      wireCarousel(container);
    };

    console.log('[GCP v2] loadNearbyVenues + displayVenueItems overridden -> carousel');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(install, 0); });
  } else {
    setTimeout(install, 0);
  }

  window.addEventListener('bmg:pageShown', function(e) {
    if (e.detail && e.detail.pageId === 'main-page') {
      setTimeout(function() {
        if (typeof window.loadNearbyVenues === 'function') window.loadNearbyVenues();
      }, 50);
    }
  });

  console.log('[grounds_carousel_patch.js v2] Loaded');
})();


/* ═══════════════════════════════════════════════════════════════════
 * ██ ground_page_ui_patch.js
 * ═══════════════════════════════════════════════════════════════════ */

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

})()  /* ════════════════════════════
   *  PART 5 — Show Pool Entry Pass immediately after payment
   *  Hooks into bmg:paymentConfirmed for pool bookings.
   *
   *  FIXED: The Firestore pool_bookings write was removed from this handler.
   *  It caused the booking to be confirmed TWICE per payment:
   *    1. sportobook_combined_patches.js PART3 (finalisePoolBooking) writes it
   *    2. This PART5 handler ALSO wrote it
   *  The double-write caused ownerAmount to be counted twice in the earnings
   *  dashboard, showing double the correct amount in the owner withdraw tab.
   *
   *  PART5 now ONLY triggers the entry pass UI (showPoolEntryPass), delayed
   *  by 1.5s so PART3/finalisePoolBooking finishes writing the confirmed doc
   *  first, ensuring showPoolEntryPass always finds the booking in Firestore.
   * ════════════════════════════*/
  window.addEventListener('bmg:paymentConfirmed', function (e) {
    var booking = null;
    try {
      var raw = sessionStorage.getItem('pendingBooking') || sessionStorage.getItem('pendingCashfreeBooking');
      if (raw) booking = JSON.parse(raw);
    } catch (_e) {}
    if (!booking || !booking.isPoolBooking || !booking.bookingId) return;
    var bookingId = booking.bookingId;
    /* Delay 1.5s so PART3/finalisePoolBooking writes the confirmed doc first */
    setTimeout(function () {
      console.log('[pool-fix PART5] Showing entry pass for:', bookingId);
      if (typeof showPoolEntryPass === 'function') showPoolEntryPass(bookingId);
    }, 1500);
  });


;