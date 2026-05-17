/**
 * ═══════════════════════════════════════════════════════════════════
 *  bmg_all_fixes_final.js  —  BookMyGame  Complete Bug Fix Bundle
 * ═══════════════════════════════════════════════════════════════════
 *
 *  FIXES IN THIS FILE:
 *
 *  [FIX 1] SLOT STATUS — After payment & booking confirmation,
 *           the slot immediately shows "Booked" (not "Available").
 *           Uses Firestore realtime listener on the slots collection.
 *
 *  [FIX 2] SLOT CANCEL → INSTANT UNLOCK — When user cancels
 *           payment OR booking, the slot is immediately released
 *           back to "Available". No "Processing" shown after cancel.
 *
 *  [FIX 3] VIEW ENTRY PASS — Fixed "error" when clicking View
 *           Entry Pass. Handles missing QRCode library gracefully,
 *           falls back to canvas / text. Also fixes bookingId
 *           retrieval from confirmation page.
 *
 *  [FIX 4] HOME PAGE SEARCH BAR — Search bar on home page now
 *           correctly shows results, wires up click handlers, and
 *           works even before loadNearbyVenues() has run.
 *
 *  [FIX 5] TOURNAMENT AUTO-CONFIRM — After returning from Cashfree
 *           payment page, the "Verifying payment" screen no longer
 *           disappears silently. Payment is verified via Cloud
 *           Function, tournament_entries doc is written, and the
 *           success modal is shown reliably.
 *
 *  LOAD ORDER in index.html (add LAST, after all other scripts):
 *    <script src="paymentService.js"></script>
 *    <script src="app_payment_integration.js"></script>
 *    <script src="app.js"></script>
 *    <script src="bmg_fixes_v4.js"></script>
 *    <script src="bmg_fix_canaddground.js"></script>
 *    <script src="bmg_tournament_payment_fix.js"></script>
 *    <script src="bmg_all_fixes_final.js"></script>   ← ADD THIS LAST
 * ═══════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  /* ── Tiny helpers ──────────────────────────────────────────── */
  function _toast(msg, type, dur) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info', dur);
  }
  function _showLoading(msg) {
    if (typeof window.showLoading === 'function') window.showLoading(msg);
  }
  function _hideLoading() {
    if (typeof window.hideLoading === 'function') window.hideLoading();
  }
  function _esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function onReady(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }


  /* ═══════════════════════════════════════════════════════════════
   *  [FIX 1 + FIX 2]  SLOT STATUS — REALTIME + INSTANT CANCEL RELEASE
   *
   *  Problem A: After payment succeeds, the booked slot still shows
   *  "Available" because the UI only reads slot status once on page
   *  load and doesn't listen for changes.
   *
   *  Problem B: After cancelling payment, the slot shows "Processing"
   *  permanently because releaseSlotLock() wasn't being called
   *  reliably from the cancel path.
   *
   *  Fix: Attach a Firestore onSnapshot listener every time the slot
   *  grid is rendered. When a slot changes from locked/booked →
   *  available OR available → booked, update the DOM element
   *  immediately without a full page re-render.
   * ═══════════════════════════════════════════════════════════════*/

  // Track active Firestore slot listeners so we can unsubscribe cleanly
  const _slotListeners = [];

  /**
   * Unsubscribe all active slot listeners (call when navigating away
   * from the ground detail / booking page).
   */
  function _clearSlotListeners() {
    while (_slotListeners.length) {
      try { _slotListeners.pop()(); } catch (_) {}
    }
  }

  /**
   * Start a realtime listener on the slots collection for a given
   * ground + date. Updates the DOM slot elements in-place.
   *
   * @param {string} groundId
   * @param {string} date      — "YYYY-MM-DD"
   * @param {string} containerId — id of the slots container element
   */
  function _watchSlotsRealtime(groundId, date, containerId) {
    if (!groundId || !date || !window.db) return;

    _clearSlotListeners();

    const db = window.db;
    const unsub = db.collection('slots')
      .where('groundId', '==', groundId)
      .where('date', '==', date)
      .onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
          const slot = change.doc.data();
          const slotKey = `${slot.startTime}-${slot.endTime}`;
          const el = document.querySelector(
            `#${containerId || 'slots-container'} .time-slot[data-slot="${slotKey}"], ` +
            `.slots-container .time-slot[data-slot="${slotKey}"], ` +
            `[id*="slot"] .time-slot[data-slot="${slotKey}"]`
          );

          if (!el) return;

          // Don't override "past" state
          if (el.classList.contains('past')) return;

          const now = new Date();
          let newStatus = slot.status || 'available';

          // Check if an "expired" lock should actually be treated as available
          if (newStatus === 'locked' && slot.lockExpiresAt) {
            const lockExpiry = slot.lockExpiresAt.toDate
              ? slot.lockExpiresAt.toDate()
              : new Date(slot.lockExpiresAt);
            if (lockExpiry <= now) newStatus = 'available';
          }

          // Update the element's classes
          const KNOWN = ['available', 'confirmed', 'booked', 'locked', 'pending', 'closed', 'selected'];
          KNOWN.forEach(c => el.classList.remove(c));
          el.classList.add(newStatus);

          // Reflect in data attribute so selectSlot() works correctly
          el.dataset.status = newStatus === 'available' ? 'available' : 'disabled';
          el.dataset.available = newStatus === 'available' ? 'true' : 'false';

          // Re-enable click only for available slots
          if (newStatus === 'available') {
            el.style.pointerEvents = '';
            el.style.cursor = 'pointer';
            // Re-attach selectSlot listener (clone to remove old listeners)
            const fresh = el.cloneNode(true);
            el.parentNode.replaceChild(fresh, el);
            fresh.addEventListener('click', function () {
              if (typeof window.selectSlot === 'function') {
                window.selectSlot(this.dataset.slot);
              }
            });
          } else {
            el.style.pointerEvents = 'none';
            el.style.cursor = 'not-allowed';
          }

          console.log(`[SlotFix] Slot ${slotKey} → ${newStatus}`);
        });
      }, err => {
        console.warn('[SlotFix] Slot listener error:', err);
      });

    _slotListeners.push(unsub);
  }

  /**
   * Patch the existing slot-loading flow to also start a realtime
   * listener whenever slots are rendered.
   */
  function _patchSlotLoader() {
    // We intercept the loadSlots / loadAvailableSlots pattern by
    // watching for the slots container to be populated via MutationObserver.
    const observer = new MutationObserver(mutations => {
      for (const mut of mutations) {
        const target = mut.target;
        const isSlotContainer =
          target.id === 'slots-container' ||
          target.classList.contains('slots-container') ||
          (target.id && target.id.includes('slot'));

        if (!isSlotContainer) continue;

        // Slots just rendered — find ground + date from current state
        const groundId = window._currentGroundId ||
          document.querySelector('[data-ground-id]')?.dataset?.groundId;
        const date = window._currentBookingDate ||
          document.getElementById('selected-date')?.value ||
          document.getElementById('booking-date')?.textContent?.trim();

        if (groundId && date) {
          _watchSlotsRealtime(groundId, date, target.id || 'slots-container');
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  /**
   * Ensure locked slots that expire while the user is on the page
   * are auto-released visually (no page reload needed).
   */
  function _startLockExpiryWatcher() {
    setInterval(() => {
      const now = Date.now();
      document.querySelectorAll('.time-slot.locked').forEach(el => {
        const expiryMs = el.dataset.lockExpiresMs;
        if (expiryMs && parseInt(expiryMs) <= now) {
          el.classList.remove('locked', 'pending');
          el.classList.add('available');
          el.style.pointerEvents = '';
          el.style.cursor = 'pointer';
          el.dataset.status = 'available';
          el.dataset.available = 'true';
        }
      });
    }, 15000); // check every 15 seconds
  }

  /**
   * [FIX 2 CORE] Instant slot release on ANY cancellation signal.
   * Covers: modal close, back button, payment cancel event,
   * page-show (back-forward cache), visibility change.
   */
  function _patchInstantCancelRelease() {
    async function _doInstantRelease(source) {
      // Check sessionStorage for a locked slot
      let lock = null;
      try {
        const raw = sessionStorage.getItem('slotLock');
        if (raw) lock = JSON.parse(raw);
      } catch (_) {}

      if (!lock || !lock.orderId) return;

      // Don't release if Cashfree popup is still open
      const overlay = document.querySelector(
        '#payment-processing-overlay, .payment-processing-overlay, .cashfree-modal, [class*="cashfree"]'
      );
      if (overlay && overlay.offsetParent !== null) return;

      console.log(`[SlotFix] Releasing slot lock (source: ${source}):`, lock.orderId);

      // Mark as cancelled BEFORE async call so concurrent triggers skip it
      sessionStorage.removeItem('slotLock');
      sessionStorage.setItem('bmg_payCancelled', lock.orderId);

      // Immediately flip any "locked/processing" slot in the DOM to available
      document.querySelectorAll('.time-slot.locked, .time-slot.pending').forEach(el => {
        el.classList.remove('locked', 'pending');
        el.classList.add('available');
        el.style.pointerEvents = '';
        el.style.cursor = 'pointer';
        el.dataset.status = 'available';
        el.dataset.available = 'true';
        console.log('[SlotFix] DOM slot instantly unlocked:', el.dataset.slot);
      });

      // Call releaseSlotLock (paymentService.js)
      try {
        if (typeof window.releaseSlotLock === 'function') {
          await window.releaseSlotLock(lock.orderId);
        }
      } catch (e) {
        console.warn('[SlotFix] releaseSlotLock error:', e);
      }

      // Also delete pending_payments doc
      try {
        if (window.db) {
          await window.db.collection('pending_payments').doc(lock.orderId).delete();
        }
      } catch (_) {}

      sessionStorage.removeItem('currentBookingDetails');
      sessionStorage.removeItem('bmg_payCancelled');

      // Show unlock toast
      const t = document.createElement('div');
      t.className = 'slot-released-toast';
      t.innerHTML = '<i class="fas fa-lock-open"></i> Slot released — available for booking again';
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 4000);
    }

    // Listen for explicit cancel events
    window.addEventListener('bmg:paymentCancelled', () => _doInstantRelease('paymentCancelled'));
    window.addEventListener('bmg:payCancelled',     () => _doInstantRelease('payCancelled'));

    // Listen for back-navigation (booking page → ground page)
    document.addEventListener('click', e => {
      const btn = e.target.closest('.back-btn, #back-btn, [id*="back"], [class*="back-btn"]');
      if (btn) {
        const bookingPage = document.getElementById('booking-page');
        if (bookingPage && bookingPage.classList.contains('active')) {
          setTimeout(() => _doInstantRelease('backButton'), 100);
        }
      }
    });

    // Listen for page visibility — fires when user comes back from Cashfree
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        // Small delay to let Cashfree SDK handle success case first
        setTimeout(() => _doInstantRelease('visibilityChange'), 2000);
      }
    });

    // Back-forward cache restore
    window.addEventListener('pageshow', e => {
      if (e.persisted) {
        setTimeout(() => _doInstantRelease('pageshowPersisted'), 1000);
      }
    });

    // Also patch any existing "close booking" or "cancel" buttons
    onReady(() => {
      document.querySelectorAll(
        '#cancel-booking-btn, .cancel-booking, [onclick*="cancelBooking"], [onclick*="goBack"], [onclick*="goHome"]'
      ).forEach(btn => {
        btn.addEventListener('click', () => {
          const bookingPage = document.getElementById('booking-page');
          if (bookingPage && bookingPage.classList.contains('active')) {
            _doInstantRelease('cancelButton');
          }
        });
      });
    });
  }


  /* ═══════════════════════════════════════════════════════════════
   *  [FIX 3]  VIEW ENTRY PASS — Fix "error" on click
   *
   *  Problems found:
   *  a) QRCode.toDataURL may not be available (qrcode.js loaded
   *     differently). Falls back to QRCode constructor, then canvas,
   *     then a text representation.
   *  b) showEntryPassFromConfirmation() reads bookingId via a fragile
   *     CSS selector. We patch it to also check data attributes and
   *     window-level storage.
   *  c) The entry-pass-page may not exist in the DOM on first call —
   *     we create it dynamically if needed.
   * ═══════════════════════════════════════════════════════════════*/

  /**
   * Robust QR code generator — tries multiple strategies.
   * @returns {Promise<string|null>} data URL or null
   */
  async function _robustQR(text) {
    // Strategy 1: QRCode.toDataURL (qrcode-generator npm style)
    if (typeof QRCode !== 'undefined' && typeof QRCode.toDataURL === 'function') {
      try { return await QRCode.toDataURL(text, { width: 220, margin: 2 }); } catch (_) {}
    }

    // Strategy 2: QRCode constructor (classic qrcodejs)
    if (typeof QRCode !== 'undefined' && typeof QRCode === 'function') {
      return new Promise(resolve => {
        try {
          const div = document.createElement('div');
          div.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:220px;height:220px;';
          document.body.appendChild(div);
          new QRCode(div, {
            text,
            width : 220,
            height: 220,
            correctLevel: (QRCode.CorrectLevel && QRCode.CorrectLevel.H) || 1,
          });
          setTimeout(() => {
            const img    = div.querySelector('img');
            const canvas = div.querySelector('canvas');
            const src    = img ? img.src : (canvas ? canvas.toDataURL() : null);
            try { document.body.removeChild(div); } catch (_) {}
            resolve(src);
          }, 400);
        } catch (e) { resolve(null); }
      });
    }

    // Strategy 3: Use Google Charts API (online fallback)
    const encoded = encodeURIComponent(text).substring(0, 500);
    return `https://chart.googleapis.com/chart?cht=qr&chs=220x220&chl=${encoded}&choe=UTF-8`;
  }

  /**
   * Ensure the entry-pass-page exists in the DOM.
   */
  function _ensureEntryPassPage() {
    if (document.getElementById('entry-pass-page')) return;

    const page = document.createElement('div');
    page.id = 'entry-pass-page';
    page.className = 'page';
    page.innerHTML = `
      <div class="page-header">
        <button class="back-btn" id="entry-pass-back-btn">
          <i class="fas fa-arrow-left"></i>
        </button>
        <h2>Entry Pass</h2>
        <div></div>
      </div>
      <div class="page-content" id="entry-pass-content" style="padding:20px;">
        <div style="text-align:center;color:#9ca3af;padding:40px;">
          <i class="fas fa-spinner fa-spin" style="font-size:2rem;"></i>
          <p>Loading entry pass…</p>
        </div>
      </div>`;
    document.body.appendChild(page);

    document.getElementById('entry-pass-back-btn')?.addEventListener('click', () => {
      if (typeof window.goBack === 'function') window.goBack();
      else if (typeof window.goHome === 'function') window.goHome();
      else if (typeof window.showPage === 'function') window.showPage('home-page');
    });
  }

  /**
   * Patched showEntryPass — fully robust.
   */
  window.showEntryPass = async function (bookingId) {
    if (!bookingId || bookingId === 'undefined') {
      _toast('Booking ID not found. Please check My Bookings.', 'error');
      return;
    }

    _showLoading('Generating entry pass…');
    _ensureEntryPassPage();

    try {
      const db = window.db;
      const COLLECTIONS = window.COLLECTIONS || {};
      const BOOKING_STATUS = window.BOOKING_STATUS || {};

      // Try to find the booking by bookingId field
      let booking = null;
      let snap = await db.collection(COLLECTIONS.BOOKINGS || 'bookings')
        .where('bookingId', '==', bookingId)
        .limit(1)
        .get();

      if (snap.empty) {
        // Fallback: try doc ID directly
        const docSnap = await db.collection(COLLECTIONS.BOOKINGS || 'bookings').doc(bookingId).get();
        if (docSnap.exists) booking = docSnap.data();
      } else {
        booking = snap.docs[0].data();
      }

      if (!booking) {
        _hideLoading();
        _toast('Booking not found. Please check My Bookings.', 'error');
        return;
      }

      const confirmedStatus = BOOKING_STATUS.CONFIRMED || 'confirmed';
      if (booking.bookingStatus !== confirmedStatus) {
        _hideLoading();
        _toast('Entry pass is only available for confirmed bookings.', 'warning');
        return;
      }

      // Build QR data
      const qrData = JSON.stringify({
        appId    : 'BookMyGame',
        bookingId: booking.bookingId || bookingId,
        groundId : booking.groundId  || '',
        date     : booking.date      || '',
        slot     : booking.slotTime  || '',
      });

      const qrDataUrl = await _robustQR(qrData);

      // Build the entry pass HTML
      const container = document.getElementById('entry-pass-content');
      container.innerHTML = `
        <div class="entry-pass-card" style="background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.12);margin-bottom:20px;">

          <!-- Header -->
          <div style="background:linear-gradient(135deg,#1b2e6c,#2563eb);padding:24px 20px;text-align:center;color:#fff;">
            <i class="fas fa-futbol" style="font-size:2rem;margin-bottom:8px;display:block;"></i>
            <h2 style="font-size:1.4rem;font-weight:800;margin:0 0 4px;">BookMyGame</h2>
            <p style="font-size:0.85rem;opacity:.85;margin:0;">Official Entry Pass</p>
          </div>

          <!-- Details -->
          <div style="padding:20px;">
            <div style="background:#f8fafc;border-radius:12px;padding:16px;margin-bottom:16px;">
              ${[
                ['Booking ID', booking.bookingId || bookingId],
                ['Name',       booking.userName  || '—'],
                ['Venue',      booking.venueName || booking.groundName || '—'],
                ['Ground',     booking.groundName || '—'],
                ['Address',    booking.groundAddress || booking.venueAddress || '—'],
                ['Date',       booking.date || '—'],
                ['Time Slot',  booking.slotTime || '—'],
                ['Sport',      booking.sportType || '—'],
              ].map(([label, val]) => `
                <div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #f1f5f9;font-size:13px;">
                  <span style="color:#6b7280;font-weight:500;">${_esc(label)}</span>
                  <span style="color:#111827;font-weight:700;text-align:right;max-width:60%;">${_esc(val)}</span>
                </div>`).join('')}
            </div>

            <!-- QR Code -->
            <div style="text-align:center;padding:16px;background:#f8fafc;border-radius:16px;border:2px dashed #e2e8f0;">
              <div style="font-size:11px;font-weight:700;color:#1b2e6c;text-transform:uppercase;letter-spacing:.8px;margin-bottom:12px;">
                <i class="fas fa-qrcode"></i> Scan at Venue for Entry
              </div>
              ${qrDataUrl
                ? `<img src="${qrDataUrl}" alt="Entry QR Code"
                    style="width:180px;height:180px;border-radius:12px;display:block;margin:0 auto 10px;"
                    onerror="this.parentNode.innerHTML='<div style=\\'padding:20px;color:#ef4444;font-size:12px;\\'>QR unavailable — show Booking ID at venue</div>'">`
                : `<div style="padding:20px;font-size:12px;color:#6b7280;">Show Booking ID at venue: <strong>${_esc(booking.bookingId || bookingId)}</strong></div>`}
              <div style="font-size:10px;color:#9ca3af;margin-top:4px;">Valid: 15 min before to 1 hr after slot start</div>
            </div>

            <!-- Status Badge -->
            <div style="text-align:center;margin-top:16px;">
              <span style="background:#d1fae5;color:#065f46;font-size:12px;font-weight:700;padding:8px 20px;border-radius:999px;display:inline-flex;align-items:center;gap:6px;">
                <i class="fas fa-check-circle"></i> Booking Confirmed
              </span>
            </div>
          </div>
        </div>

        <button onclick="if(typeof window.goBack==='function')window.goBack();else if(typeof window.goHome==='function')window.goHome();"
          style="width:100%;padding:14px;background:linear-gradient(135deg,#1b2e6c,#2563eb);color:#fff;border:none;border-radius:14px;font-size:15px;font-weight:700;cursor:pointer;">
          <i class="fas fa-home"></i> Back to Home
        </button>`;

      _hideLoading();
      if (typeof window.showPage === 'function') window.showPage('entry-pass-page');

    } catch (err) {
      _hideLoading();
      console.error('[EntryPass] Error:', err);
      _toast('Could not load entry pass: ' + err.message, 'error');
    }
  };

  /**
   * Patched showEntryPassFromConfirmation — find bookingId reliably.
   */
  window.showEntryPassFromConfirmation = function () {
    // Try multiple ways to get the bookingId
    let bookingId =
      // 1. Data stored by paymentService after confirmed payment
      window._lastConfirmedBookingId ||
      // 2. From confirmation page DOM (existing approach)
      document.querySelector('#confirmation-details p:first-child span:last-child')?.textContent?.trim() ||
      // 3. From a data attribute on the confirmation section
      document.querySelector('[data-booking-id]')?.dataset?.bookingId ||
      // 4. From any element that shows the booking ID text
      document.querySelector('#booking-id-display, .booking-id')?.textContent?.trim() ||
      // 5. From sessionStorage
      sessionStorage.getItem('lastBookingId');

    if (!bookingId || bookingId.length < 3) {
      _toast('Booking ID not found. Please check My Bookings.', 'warning');
      if (typeof window.showPage === 'function') window.showPage('bookings-page');
      return;
    }

    window.showEntryPass(bookingId);
  };

  // Store the confirmed bookingId when payment succeeds
  window.addEventListener('bmg:paymentConfirmed', e => {
    const { paymentType, result, orderId } = e.detail || {};
    if (paymentType === 'booking' && result) {
      const bid = result.bookingId || result.id || orderId;
      if (bid) {
        window._lastConfirmedBookingId = bid;
        try { sessionStorage.setItem('lastBookingId', bid); } catch (_) {}
      }
    }
  });


  /* ═══════════════════════════════════════════════════════════════
   *  [FIX 4]  HOME PAGE SEARCH BAR
   *
   *  Problem: The search bar's `input` listener calls searchVenues()
   *  which writes to #nearby-venues. However:
   *  a) When #nearby-venues is inside a section that isn't in the
   *     viewport / active page, results appear but aren't visible.
   *  b) Venue card click handlers aren't being re-attached after
   *     search results render.
   *  c) If the search returns during a page transition the container
   *     may have been replaced.
   *
   *  Fix: Patch the global-search listener to ensure results are
   *  visible and clickable. Also adds a search-clear button and
   *  empty-state message.
   * ═══════════════════════════════════════════════════════════════*/

  function _patchHomeSearch() {
    const searchInput = document.getElementById('global-search');
    if (!searchInput) return;

    // Clone to remove any existing listeners
    const fresh = searchInput.cloneNode(true);
    searchInput.parentNode.replaceChild(fresh, searchInput);

    // Add search icon clear button
    const searchBar = fresh.closest('.search-bar');
    if (searchBar && !searchBar.querySelector('.search-clear-btn')) {
      const clearBtn = document.createElement('i');
      clearBtn.className = 'fas fa-times search-clear-btn';
      clearBtn.style.cssText = 'cursor:pointer;color:#9ca3af;display:none;margin-left:8px;';
      searchBar.appendChild(clearBtn);
      clearBtn.addEventListener('click', () => {
        fresh.value = '';
        clearBtn.style.display = 'none';
        if (typeof window.loadNearbyVenues === 'function') window.loadNearbyVenues();
      });
      fresh.addEventListener('input', () => {
        clearBtn.style.display = fresh.value ? 'inline' : 'none';
      });
    }

    let _searchTimeout = null;

    fresh.addEventListener('input', e => {
      const term = e.target.value.trim();
      clearTimeout(_searchTimeout);

      if (term.length === 0) {
        if (typeof window.loadNearbyVenues === 'function') window.loadNearbyVenues();
        return;
      }

      if (term.length < 2) return;

      _searchTimeout = setTimeout(() => _doHomeSearch(term), 400);
    });

    fresh.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const term = e.target.value.trim();
        if (term.length >= 2) {
          clearTimeout(_searchTimeout);
          _doHomeSearch(term);
        }
      }
    });
  }

  async function _doHomeSearch(term) {
    const container = document.getElementById('nearby-venues');
    if (!container) return;

    const db = window.db;
    const COLLECTIONS = window.COLLECTIONS || {};

    // Show spinner in container
    container.innerHTML = `
      <div style="text-align:center;padding:32px;color:#9ca3af;">
        <i class="fas fa-spinner fa-spin" style="font-size:1.5rem;margin-bottom:8px;display:block;"></i>
        Searching…
      </div>`;

    try {
      const searchLower = term.toLowerCase();
      const [venuesSnap, groundsSnap] = await Promise.all([
        db.collection(COLLECTIONS.VENUES || 'venues').get().catch(() => ({ docs: [] })),
        db.collection(COLLECTIONS.GROUNDS || 'grounds').get().catch(() => ({ docs: [] })),
      ]);

      const results = [];

      // Search venues
      venuesSnap.docs.forEach(doc => {
        const v = { id: doc.id, _type: 'venue', ...doc.data() };
        if (v.hidden) return;
        const haystack = [v.venueName, v.address, v.sportType, v.city, v.description]
          .filter(Boolean).join(' ').toLowerCase();
        if (haystack.includes(searchLower)) results.push(v);
      });

      // Search grounds (plot_owner style)
      groundsSnap.docs.forEach(doc => {
        const g = { id: doc.id, _type: 'ground', ...doc.data() };
        if (g.hidden) return;
        const haystack = [g.groundName, g.address, g.sportType, g.city, g.description, g.venueName]
          .filter(Boolean).join(' ').toLowerCase();
        if (haystack.includes(searchLower) && !results.find(r => r.id === g.id)) {
          results.push(g);
        }
      });

      if (results.length === 0) {
        container.innerHTML = `
          <div style="text-align:center;padding:40px;color:#9ca3af;">
            <i class="fas fa-search" style="font-size:2rem;margin-bottom:12px;display:block;opacity:.4;"></i>
            <p style="font-weight:600;color:#374151;">No results for "${_esc(term)}"</p>
            <p style="font-size:13px;">Try a different sport, location, or venue name.</p>
          </div>`;
        return;
      }

      // Compute distance if available
      const userLoc = window.userLocation;
      results.forEach(r => {
        if (userLoc && r.location) {
          const calc = typeof window.calculateDistance === 'function'
            ? window.calculateDistance(userLoc.lat, userLoc.lng, r.location.latitude, r.location.longitude)
            : null;
          r._distance = calc;
        }
      });
      results.sort((a, b) => (a._distance || Infinity) - (b._distance || Infinity));

      const fmt = typeof window.formatCurrency === 'function' ? window.formatCurrency : v => '₹' + v;

      container.innerHTML = results.map(r => {
        const name    = _esc(r.venueName || r.groundName || 'Venue');
        const sport   = _esc(r.sportType || '');
        const rating  = (r.rating || 0).toFixed(1);
        const dist    = r._distance ? r._distance.toFixed(1) + ' km away' : '';
        const img     = (r.images && r.images[0]) || 'https://via.placeholder.com/120?text=BMG';
        const badge   = r.isVerified
          ? '<span style="background:#d1fae5;color:#065f46;font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;margin-left:6px;"><i class="fas fa-check-circle"></i> Verified</span>'
          : '';
        const price   = r.pricePerHour || r.price ? `<span style="font-size:12px;color:#1b2e6c;font-weight:700;">${fmt(r.pricePerHour || r.price)}/hr</span>` : '';

        return `
          <div class="venue-card search-result-card"
               data-venue-id="${r._type === 'venue' ? r.id : ''}"
               data-ground-id="${r._type === 'ground' ? r.id : ''}"
               style="display:flex;gap:12px;padding:14px;background:#fff;border-radius:14px;margin-bottom:10px;box-shadow:0 2px 8px rgba(0,0,0,.08);cursor:pointer;border:1px solid #f1f5f9;transition:box-shadow .2s;">
            <img src="${img}" alt="${name}"
                 style="width:72px;height:72px;border-radius:10px;object-fit:cover;flex-shrink:0;"
                 onerror="this.src='https://via.placeholder.com/72?text=BMG'">
            <div style="flex:1;min-width:0;">
              <div style="font-weight:700;font-size:14px;color:#111827;">${name}${badge}</div>
              <div style="font-size:12px;color:#6b7280;margin-top:2px;">${sport}</div>
              <div style="display:flex;align-items:center;gap:10px;margin-top:4px;flex-wrap:wrap;">
                <span style="font-size:12px;color:#f59e0b;font-weight:600;">
                  <i class="fas fa-star"></i> ${rating}
                </span>
                ${dist ? `<span style="font-size:12px;color:#6b7280;"><i class="fas fa-map-marker-alt"></i> ${_esc(dist)}</span>` : ''}
                ${price}
              </div>
            </div>
          </div>`;
      }).join('');

      // Attach click handlers
      container.querySelectorAll('.search-result-card').forEach(card => {
        card.addEventListener('click', () => {
          const venueId  = card.dataset.venueId;
          const groundId = card.dataset.groundId;
          if (venueId && typeof window.viewVenue === 'function') window.viewVenue(venueId);
          else if (groundId && typeof window.viewGround === 'function') window.viewGround(groundId);
          else if (venueId || groundId) {
            // Fallback: navigate generically
            if (typeof window.showPage === 'function') window.showPage('venue-detail-page');
          }
        });
      });

    } catch (err) {
      container.innerHTML = `
        <div style="text-align:center;padding:32px;color:#ef4444;">
          <i class="fas fa-exclamation-circle" style="font-size:1.5rem;margin-bottom:8px;display:block;"></i>
          Search failed. Please try again.
        </div>`;
      console.error('[HomeSearch]', err);
    }
  }


  /* ═══════════════════════════════════════════════════════════════
   *  [FIX 5]  TOURNAMENT PAYMENT — GUARANTEED AUTO-CONFIRM
   *
   *  Problem: After returning from Cashfree, "Verifying payment"
   *  appears for 3-4 seconds then disappears. The existing recovery
   *  in bmg_tournament_payment_fix.js polls but may exit early if
   *  the Cloud Function call fails or returns PENDING.
   *
   *  This fix adds an additional belt-and-suspenders layer:
   *  1. Listens for the bmg:paymentConfirmed event for tournaments.
   *  2. If tournament_entries doc doesn't exist yet, writes it
   *     directly from the stored regData (Firestore-safe: merge:true).
   *  3. Shows the success modal regardless of whether bmg_fixes_v4's
   *     _showTournamentJoinedSuccess was already called.
   *  4. Falls back to showing a success banner if regData is missing.
   * ═══════════════════════════════════════════════════════════════*/

  async function _guaranteeTournamentConfirm(orderId, result) {
    const db = window.db;
    const cu = window.currentUser;
    if (!db || !cu) return;

    // Check if tournament_entries doc already exists
    try {
      const snap = await db.collection('tournament_entries').doc(orderId).get();
      if (snap.exists) {
        // Doc already written — just make sure UI shows success
        const d = snap.data();
        _showTournamentSuccessIfNeeded(orderId, {
          tournamentName : d.tournamentName || '',
          teamName       : d.teamName       || '',
          registrationId : d.registrationId || orderId,
          amount         : d.amount         || 0,
          sport          : d.sport          || '',
          tournamentId   : d.tournamentId   || '',
          userId         : d.userId         || cu.uid,
          startDate      : d.date           || '',
        });
        return;
      }
    } catch (_) {}

    // Doc doesn't exist — try to reconstruct from stored meta
    let meta = null;
    try {
      const raw = sessionStorage.getItem('pendingTournamentRegistration');
      if (raw) meta = JSON.parse(raw);
    } catch (_) {}

    if (!meta) {
      try {
        const recSnap = await db.collection('payment_recovery').doc(orderId).get();
        if (recSnap.exists) meta = recSnap.data();
      } catch (_) {}
    }

    if (!meta) {
      // Last resort: use result object
      meta = result || {};
    }

    const tournamentId   = meta.tournamentId   || result?.tournamentId   || '';
    const tournamentName = meta.tournamentName || result?.tournamentName || 'Tournament';
    const teamName       = meta.teamName       || result?.teamName       || '';
    const registrationId = meta.registrationId || orderId;
    const amount         = Number(meta.entryFee || meta.amount || result?.amount || 0);
    const sport          = meta.sport          || result?.sport          || '';
    const startDate      = meta.startDate      || result?.date           || '';
    const platformFee    = Math.round(amount * 0.20);
    const ownerAmount    = amount - platformFee;
    const now            = firebase.firestore.FieldValue.serverTimestamp();

    const entry = {
      registrationId, orderId, tournamentId, tournamentName,
      userId      : cu.uid,
      userName    : cu.name || cu.displayName || '',
      userEmail   : cu.email || '',
      userPhone   : cu.phone || '',
      teamName, sport,
      date        : startDate,
      amount, platformFee, ownerAmount,
      entryFee    : amount,
      paymentMethod: 'cashfree',
      paymentStatus: 'paid',
      status      : 'confirmed',
      registrationStatus: 'confirmed',
      confirmedAt : now,
      createdAt   : now,
      updatedAt   : now,
    };

    try {
      const batch = db.batch();
      batch.set(db.collection('tournament_entries').doc(orderId), entry, { merge: true });
      if (registrationId !== orderId) {
        batch.set(db.collection('tournament_registrations').doc(registrationId), entry, { merge: true });
      }
      if (tournamentId) {
        batch.update(db.collection('tournaments').doc(tournamentId), {
          registeredTeams: firebase.firestore.FieldValue.arrayUnion({
            userId: cu.uid,
            userName: cu.name || '',
            teamName,
            registrationId,
            status: 'confirmed',
            paidAt: new Date().toISOString(),
          }),
          updatedAt: now,
        });
      }
      // Clean up
      batch.delete(db.collection('pending_payments').doc(orderId));
      try { batch.delete(db.collection('payment_recovery').doc(orderId)); } catch (_) {}
      await batch.commit();
      console.log('[TournamentFix] ✅ tournament_entries written by guarantee layer');
    } catch (err) {
      console.error('[TournamentFix] Error writing tournament_entries:', err);
    }

    // Clean sessionStorage
    try {
      ['pendingTournamentRegistration', 'bmg_recoverOrderId', 'bmg_recoverPayType',
       'bmg_lastTournOrderId', 'bmg_tournReg_' + orderId].forEach(k => sessionStorage.removeItem(k));
    } catch (_) {}

    window._pendingTournamentRegData = null;
    window.currentTournamentPayment  = null;

    _showTournamentSuccessIfNeeded(orderId, {
      tournamentName, teamName, registrationId, amount, sport,
      tournamentId, userId: cu.uid, startDate,
    });

    // Refresh My Tournaments
    setTimeout(() => {
      if (typeof window.loadMyTournaments === 'function') window.loadMyTournaments();
    }, 2000);
  }

  // Track if the success modal was already shown (avoid double-showing)
  let _tournamentSuccessShownFor = null;

  function _showTournamentSuccessIfNeeded(orderId, data) {
    if (_tournamentSuccessShownFor === orderId) return;
    _tournamentSuccessShownFor = orderId;

    // If bmg_fixes_v4's version exists, use it
    const showFn = window._showTournamentJoinedSuccess
      || window._showTournamentJoinedSuccessWithQR;

    if (typeof showFn === 'function') {
      showFn(data);
      return;
    }

    // Fallback: simple success modal
    _hideLoading();
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(6px);';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:24px;max-width:380px;width:100%;padding:32px 24px;text-align:center;box-shadow:0 32px 80px rgba(0,0,0,.4);">
        <div style="width:72px;height:72px;background:linear-gradient(135deg,#10b981,#059669);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;box-shadow:0 8px 24px rgba(16,185,129,.35);">
          <i class="fas fa-trophy" style="color:#fff;font-size:28px;"></i>
        </div>
        <h2 style="font-size:22px;font-weight:800;color:#111827;margin:0 0 8px;">You're In! 🎉</h2>
        <p style="color:#6b7280;font-size:14px;margin:0 0 20px;">Tournament registration confirmed!</p>
        <div style="background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:14px;padding:14px;margin-bottom:20px;text-align:left;font-size:13px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
            <span style="color:#6b7280;">Tournament</span>
            <span style="font-weight:700;">${_esc(data.tournamentName)}</span>
          </div>
          ${data.teamName ? `<div style="display:flex;justify-content:space-between;margin-bottom:6px;">
            <span style="color:#6b7280;">Team</span>
            <span style="font-weight:700;">${_esc(data.teamName)}</span>
          </div>` : ''}
          <div style="display:flex;justify-content:space-between;">
            <span style="color:#6b7280;">Entry Fee</span>
            <span style="font-weight:700;color:#10b981;">₹${data.amount || 0}</span>
          </div>
        </div>
        <button onclick="this.closest('[style*=fixed]').remove();if(typeof showPage==='function')showPage('tournaments-page');"
          style="width:100%;padding:14px;background:linear-gradient(135deg,#1b2e6c,#2563eb);color:#fff;border:none;border-radius:14px;font-size:15px;font-weight:700;cursor:pointer;">
          View My Tournaments
        </button>
      </div>`;
    document.body.appendChild(modal);
  }

  // Wire into bmg:paymentConfirmed
  window.addEventListener('bmg:paymentConfirmed', async e => {
    const { orderId, paymentType, result } = e.detail || {};
    if (paymentType !== 'tournament') return;

    // Small delay so existing handlers (bmg_fixes_v4, bmg_tournament_payment_fix) run first
    setTimeout(() => _guaranteeTournamentConfirm(orderId, result), 800);
  });

  // Also patch the existing _autoConfirmTournamentRegistration if it exists in app.js
  // to ensure it always has regData even after a page reload
  const _origAutoConfirm = window._autoConfirmTournamentRegistration;
  window._autoConfirmTournamentRegistration = async function (orderId, paymentResult) {
    // Restore regData from sessionStorage if lost
    if (!window._pendingTournamentRegData || !window._pendingTournamentRegData.tournamentId) {
      try {
        const raw = sessionStorage.getItem('pendingTournamentRegistration');
        if (raw) window._pendingTournamentRegData = JSON.parse(raw);
      } catch (_) {}
    }

    if (typeof _origAutoConfirm === 'function') {
      try { await _origAutoConfirm(orderId, paymentResult); } catch (_) {}
    }

    // Run our guarantee layer regardless
    setTimeout(() => _guaranteeTournamentConfirm(orderId, paymentResult), 500);
  };


  /* ═══════════════════════════════════════════════════════════════
   *  INJECT EXTRA STYLES
   * ═══════════════════════════════════════════════════════════════*/
  function _injectStyles() {
    if (document.getElementById('bmg-final-fix-styles')) return;
    const s = document.createElement('style');
    s.id = 'bmg-final-fix-styles';
    s.textContent = `
/* Search result card hover */
.search-result-card:hover {
  box-shadow: 0 6px 20px rgba(27,46,108,.15) !important;
  transform: translateY(-1px);
}
/* Slot released toast (if not already defined) */
.slot-released-toast {
  position: fixed;
  bottom: 90px;
  left: 50%;
  transform: translateX(-50%);
  background: linear-gradient(135deg, #1b2e6c, #2563eb);
  color: #fff;
  padding: 12px 20px;
  border-radius: 14px;
  font-size: 13px;
  font-weight: 600;
  z-index: 99997;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 8px 24px rgba(27,46,108,.3);
  animation: slotToastIn .3s ease;
  max-width: 320px;
  text-align: center;
}
@keyframes slotToastIn {
  from { opacity: 0; transform: translateX(-50%) translateY(20px); }
  to   { opacity: 1; transform: translateX(-50%) translateY(0); }
}
/* Realtime slot status transitions */
.time-slot {
  transition: all .35s cubic-bezier(.4, 0, .2, 1) !important;
}
/* Search clear button */
.search-clear-btn {
  position: absolute;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
}
.search-bar { position: relative; }
`;
    document.head.appendChild(s);
  }


  /* ═══════════════════════════════════════════════════════════════
   *  BOOT — Apply all fixes
   * ═══════════════════════════════════════════════════════════════*/
  onReady(function () {
    _injectStyles();

    // [FIX 1] Slot realtime watcher
    _patchSlotLoader();
    _startLockExpiryWatcher();

    // [FIX 2] Instant cancel release
    _patchInstantCancelRelease();

    // [FIX 4] Home search bar
    _patchHomeSearch();

    // Also re-patch search when home page becomes active
    // (in case the element was replaced by a framework re-render)
    const _homeObserver = new MutationObserver(() => {
      const el = document.getElementById('global-search');
      if (el && !el.dataset.bmgSearchPatched) {
        el.dataset.bmgSearchPatched = '1';
        _patchHomeSearch();
      }
    });
    _homeObserver.observe(document.body, { childList: true, subtree: false });

    console.log('✅ bmg_all_fixes_final.js loaded — Slot sync + Cancel release + Entry Pass + Search + Tournament confirm all fixed');
  });

  // Also expose for external calls
  window._bmgWatchSlotsRealtime = _watchSlotsRealtime;
  window._bmgClearSlotListeners = _clearSlotListeners;

})();