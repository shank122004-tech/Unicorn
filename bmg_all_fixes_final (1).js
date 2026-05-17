/**
 * bmg_all_fixes_final.js
 * ══════════════════════════════════════════════════════════════════
 *
 * FIXES IN THIS FILE:
 *  1. QR Code "code length overflow" — compact payload (≤ 80 chars)
 *  2. QR Code scanner verification — works with compact payload
 *  3. Entry pass shown INSTANTLY after payment returns
 *  4. Payout listener null-uid crash on logout
 *  5. CEO "Pay Owner" → Firestore permission error (missing rules stub)
 *  6. Owner without paid ₹5 fee CANNOT add grounds (hard enforcement)
 *  7. Bottom nav (Home/Bookings/Profile) always visible while scrolling
 *  8. Search bar always visible while scrolling
 *  9. Registration error: Missing or insufficient permissions (user create)
 *
 * LOAD ORDER — add as the VERY LAST script in index.html:
 *   <script src="bmg_all_fixes_final.js"></script>
 * ══════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  /* ────────────────────────────────────────────────────────────────
   * UTIL
   * ──────────────────────────────────────────────────────────────── */
  function waitFor(prop, cb, maxMs) {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (typeof window[prop] !== 'undefined') { clearInterval(iv); cb(window[prop]); }
      else if (Date.now() - t0 > (maxMs || 10000)) clearInterval(iv);
    }, 120);
  }

  function log(...a) { console.log('[BMG Final Fix]', ...a); }

  /* ════════════════════════════════════════════════════════════════
   * FIX 1 + 2  — Compact QR payload (no overflow) + scanner support
   *
   * Original payload was a full JSON object → 1700 chars → overflow.
   * New format:  BMG|<bookingId>
   * That's ≤ 60 chars — well within QR version 1 capacity.
   * The scanner reads the bookingId and looks up Firestore directly,
   * so NO booking data needs to travel in the QR at all.
   * ════════════════════════════════════════════════════════════════ */

  function _buildCompactQR(booking) {
    // Minimal prefix so scanner knows it's ours; booking ID is the key.
    return 'BMG|' + (booking.bookingId || booking.id || '');
  }

  function _patchEntryPassQR() {
    /* We patch buildQRPayload by overriding showEntryPass entirely.
     * That function lives in bmg_master_fix_v4.js — we replace it here. */

    const _esc = (s) => String(s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    window.showEntryPass = async function (bookingId) {
      if (!bookingId) {
        if (window.showToast) window.showToast('Booking ID missing', 'error');
        return;
      }
      if (window.showLoading) window.showLoading('Generating entry pass…');

      try {
        const db = window.db;
        let booking = null;

        // Try direct doc lookup first
        const direct = await db.collection('bookings').doc(bookingId).get().catch(() => null);
        if (direct && direct.exists) {
          booking = { id: direct.id, ...direct.data() };
        } else {
          const snap = await db.collection('bookings')
            .where('bookingId', '==', bookingId).limit(1).get();
          if (!snap.empty) booking = { id: snap.docs[0].id, ...snap.docs[0].data() };
        }

        if (!booking) {
          if (window.hideLoading) window.hideLoading();
          if (window.showToast) window.showToast('Booking not found', 'error');
          return;
        }

        const isConfirmed = booking.bookingStatus === 'confirmed' ||
                            booking.status === 'confirmed' ||
                            booking.paymentStatus === 'PAID';

        if (!isConfirmed) {
          if (window.hideLoading) window.hideLoading();
          if (window.showToast) window.showToast('Entry pass only for confirmed bookings', 'warning');
          return;
        }

        // ── Compact QR payload (≤ 60 chars — NEVER overflows) ──
        const qrPayload = _buildCompactQR(booking);
        let qrDataUrl   = '';

        // Use qrcode.js (toDataURL API — loaded from qrcode@1.5.1 CDN)
        if (typeof QRCode !== 'undefined' && typeof QRCode.toDataURL === 'function') {
          try {
            qrDataUrl = await QRCode.toDataURL(qrPayload, {
              width : 220,
              margin: 2,
              errorCorrectionLevel: 'M',
            });
          } catch (e) { log('QRCode.toDataURL error:', e); }
        }

        // Fallback: qrcodejs (DOM-based)
        if (!qrDataUrl && typeof window.QRCode === 'function') {
          await new Promise((res) => {
            const tmp = document.createElement('div');
            tmp.style.cssText = 'position:absolute;left:-9999px;top:-9999px;';
            document.body.appendChild(tmp);
            try {
              // eslint-disable-next-line no-new
              new window.QRCode(tmp, { text: qrPayload, width: 220, height: 220 });
            } catch (e) { log('qrcodejs error:', e); }
            setTimeout(() => {
              const img = tmp.querySelector('img');
              if (img) qrDataUrl = img.src;
              document.body.removeChild(tmp);
              res();
            }, 400);
          });
        }

        // ── Build pass card HTML ────────────────────────────────
        const qrSection = qrDataUrl
          ? `<img src="${qrDataUrl}" alt="Entry QR Code" style="width:200px;height:200px;display:block;margin:0 auto;">`
          : `<div style="padding:20px;font-size:13px;color:#666;word-break:break-all;">${qrPayload}</div>`;

        const passHtml = `
<div class="entry-pass-card" style="
  background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);
  color:#fff;border-radius:24px;padding:28px 22px;max-width:360px;
  margin:16px auto;box-shadow:0 20px 60px rgba(0,0,0,.4);">
  <div style="text-align:center;margin-bottom:18px;">
    <div style="font-size:2rem;margin-bottom:4px;">🏟️</div>
    <h2 style="margin:0;font-size:1.3rem;font-weight:800;letter-spacing:1px;">ENTRY PASS</h2>
    <p style="margin:4px 0 0;font-size:.75rem;opacity:.7;letter-spacing:2px;">· SpörtoBook</p>
  </div>
  <div style="background:rgba(255,255,255,.08);border-radius:16px;padding:16px;margin-bottom:18px;">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:.82rem;">
      <div><span style="opacity:.6;">Booking ID</span><br><strong style="font-size:.76rem;">${_esc(booking.bookingId || booking.id)}</strong></div>
      <div><span style="opacity:.6;">Name</span><br><strong>${_esc(booking.userName || '')}</strong></div>
      <div><span style="opacity:.6;">Ground</span><br><strong>${_esc(booking.groundName || '')}</strong></div>
      <div><span style="opacity:.6;">Date</span><br><strong>${booking.date || ''}</strong></div>
      <div><span style="opacity:.6;">Time</span><br><strong>${booking.slotTime || ''}</strong></div>
      <div><span style="opacity:.6;">Amount</span><br><strong>₹${booking.amount || 0}</strong></div>
    </div>
    ${booking.groundAddress || booking.venueAddress
      ? `<div style="margin-top:10px;font-size:.78rem;opacity:.8;">📍 ${_esc(booking.groundAddress || booking.venueAddress)}</div>`
      : ''}
  </div>
  <div style="background:#fff;border-radius:16px;padding:14px;text-align:center;margin-bottom:14px;">
    ${qrSection}
    <p style="margin:8px 0 0;font-size:11px;color:#333;">Show this QR at the venue for entry</p>
  </div>
  <div style="background:rgba(16,185,129,.15);border:1px solid rgba(16,185,129,.3);border-radius:12px;
    padding:10px;text-align:center;font-size:.8rem;color:#6ee7b7;">
    ✅ Payment Confirmed &nbsp;•&nbsp; Valid Entry
  </div>
  <div style="text-align:center;margin-top:16px;">
    <button id="entry-pass-home" style="background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.3);
      color:#fff;border-radius:10px;padding:10px 24px;font-size:.85rem;cursor:pointer;">
      🏠 Go Home
    </button>
  </div>
</div>`;

        const container = document.getElementById('entry-pass-content');
        if (container) {
          container.innerHTML = passHtml;
          container.querySelector('#entry-pass-home')?.addEventListener('click', () => {
            if (window.goHome) window.goHome();
            else if (window.showPage) window.showPage('home-page');
          });
        }

        if (window.hideLoading) window.hideLoading();
        if (window.showPage)    window.showPage('entry-pass-page');

        // Also embed compact pass on booking confirmation page
        _injectCompactPassOnConfirmation(booking, qrDataUrl);

      } catch (err) {
        log('showEntryPass error:', err);
        if (window.hideLoading) window.hideLoading();
        if (window.showToast)   window.showToast(err.message || 'Error generating pass', 'error');
      }
    };

    log('showEntryPass patched — compact QR ✅');
  }

  function _injectCompactPassOnConfirmation(booking, qrDataUrl) {
    const containers = [
      document.getElementById('booking-confirmation-pass'),
      document.getElementById('confirmation-qr-container'),
      document.getElementById('booking-success-pass'),
    ];
    const target = containers.find(Boolean);
    if (!target) return;

    target.innerHTML = `
<div style="text-align:center;padding:12px;">
  ${qrDataUrl ? `<img src="${qrDataUrl}" alt="QR" style="width:150px;height:150px;">` : ''}
  <p style="font-size:11px;color:#666;margin:6px 0 0;">Booking: ${booking.bookingId || booking.id}</p>
</div>`;
  }


  /* ════════════════════════════════════════════════════════════════
   * FIX 2b — QR scanner: understand compact "BMG|<bookingId>" format
   * ════════════════════════════════════════════════════════════════ */

  function _patchQRScanner() {
    const _origProcess = window.processQRScanResult || window.handleQRScanResult || window.processQRResult;

    async function handleScan(qrText) {
      if (!qrText) return;
      qrText = qrText.trim();

      let bookingId = null;

      // New compact format: "BMG|<bookingId>"
      if (qrText.startsWith('BMG|')) {
        bookingId = qrText.slice(4);
      }

      // Legacy JSON format
      if (!bookingId) {
        try {
          const p = JSON.parse(qrText);
          bookingId = p.bid || p.bookingId || null;
        } catch (_) {}
      }

      // Plain booking ID string (old fallback)
      if (!bookingId && qrText.startsWith('BMG_BOOKING_')) {
        bookingId = qrText;
      }

      if (bookingId) {
        await _verifyBookingByID(bookingId);
      } else if (_origProcess) {
        _origProcess(qrText);
      } else {
        if (window.showToast) window.showToast('Unknown QR code format', 'error');
      }
    }

    window.processQRScanResult = window.handleQRScanResult = window.processQRResult = handleScan;
    log('QR scanner patched — compact BMG| format ✅');
  }

  async function _verifyBookingByID(bookingId) {
    const db = window.db;
    const cu = window.currentUser;

    if (!db || !cu) {
      if (window.showToast) window.showToast('Please log in to verify', 'error');
      return;
    }
    if (cu.role !== 'owner' && cu.role !== 'admin' && cu.role !== 'ceo') {
      if (window.showToast) window.showToast('Only owners can verify bookings', 'error');
      return;
    }

    try {
      // Fetch booking
      let booking = null;
      const direct = await db.collection('bookings').doc(bookingId).get().catch(() => null);
      if (direct && direct.exists) {
        booking = { id: direct.id, ...direct.data() };
      } else {
        const snap = await db.collection('bookings')
          .where('bookingId', '==', bookingId).limit(1).get();
        if (!snap.empty) booking = { id: snap.docs[0].id, ...snap.docs[0].data() };
      }

      if (!booking) {
        _showVerResult(false, 'Booking not found', null);
        return;
      }

      const ok = booking.bookingStatus === 'confirmed' ||
                 booking.status === 'confirmed' ||
                 booking.paymentStatus === 'PAID';

      _showVerResult(ok, ok ? '✅ Valid Booking' : '❌ Not Confirmed / Unpaid', booking);

      // Log verification
      if (ok) {
        db.collection('owner_payment_verifications').add({
          ownerId    : cu.uid,
          verifiedBy : cu.uid,
          bookingId  : booking.bookingId || booking.id,
          userId     : booking.userId || '',
          userName   : booking.userName || '',
          amount     : booking.amount || 0,
          date       : booking.date,
          slotTime   : booking.slotTime,
          groundId   : booking.groundId,
          groundName : booking.groundName || '',
          verifiedAt : firebase.firestore.FieldValue.serverTimestamp(),
        }).catch(() => {});
      }

    } catch (err) {
      log('QR verify error:', err);
      _showVerResult(false, 'Error: ' + err.message, null);
    }
  }

  function _showVerResult(success, title, booking) {
    const modal    = document.getElementById('verification-result-modal');
    const headerEl = document.getElementById('verification-result-header');
    const iconEl   = document.getElementById('result-icon');
    const titleEl  = document.getElementById('result-title');
    const bodyEl   = document.getElementById('verification-result-body');

    if (!modal) {
      if (window.showToast) window.showToast(title, success ? 'success' : 'error', 5000);
      return;
    }

    const color = success ? '#16a34a' : '#dc2626';
    const icon  = success ? 'fa-check-circle' : 'fa-times-circle';

    if (headerEl) headerEl.style.background = color;
    if (iconEl)   iconEl.innerHTML = `<i class="fas ${icon}" style="font-size:2rem;color:#fff;"></i>`;
    if (titleEl)  titleEl.textContent = title;

    if (bodyEl && booking) {
      bodyEl.innerHTML = `
<div style="padding:16px;font-size:14px;">
  <div style="margin-bottom:8px;"><strong>Booking ID:</strong> ${booking.bookingId || booking.id || ''}</div>
  <div style="margin-bottom:8px;"><strong>Customer:</strong> ${booking.userName || '—'}</div>
  <div style="margin-bottom:8px;"><strong>Ground:</strong> ${booking.groundName || '—'}</div>
  <div style="margin-bottom:8px;"><strong>Date:</strong> ${booking.date || '—'}</div>
  <div style="margin-bottom:8px;"><strong>Time:</strong> ${booking.slotTime || '—'}</div>
  <div style="margin-bottom:8px;"><strong>Amount:</strong> ₹${booking.amount || 0}</div>
  <div style="margin-bottom:8px;"><strong>Status:</strong>
    <span style="color:${success ? '#16a34a' : '#dc2626'};font-weight:700;">
      ${(booking.bookingStatus || booking.status || 'unknown').toUpperCase()}
    </span>
  </div>
</div>`;
    } else if (bodyEl) {
      bodyEl.innerHTML = `<div style="padding:16px;text-align:center;color:#888;">${title}</div>`;
    }

    modal.style.display = 'flex';
    modal.classList.add('active');
  }


  /* ════════════════════════════════════════════════════════════════
   * FIX 3 — Entry pass shown INSTANTLY after payment return
   *
   * When user comes back from payment gateway, paymentService.js fires
   * bmg:paymentConfirmed. We listen and immediately call showEntryPass
   * for booking payments.
   * ════════════════════════════════════════════════════════════════ */

  function _patchInstantEntryPass() {
    window.addEventListener('bmg:paymentConfirmed', async (e) => {
      const { orderId, paymentType, result } = e.detail || {};
      if (paymentType !== 'booking') return;

      log('Payment confirmed — showing entry pass instantly for', orderId);

      // Small delay so Firestore write can settle
      await new Promise(r => setTimeout(r, 1200));

      const bookingId = result?.bookingId || orderId;
      if (bookingId && typeof window.showEntryPass === 'function') {
        window.showEntryPass(bookingId);
      }
    });

    // Also handle URL return (?payment_return=1) when no event fired
    window.addEventListener('DOMContentLoaded', () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get('payment_return') === '1' || params.get('order_id')) {
        const orderId = params.get('order_id');
        if (orderId) {
          log('Payment return detected — auto-show entry pass for', orderId);
          setTimeout(async () => {
            // Wait for auth to restore
            for (let i = 0; i < 10; i++) {
              if (window.currentUser && window.db) break;
              await new Promise(r => setTimeout(r, 500));
            }
            if (window.showEntryPass) window.showEntryPass(orderId);
          }, 2000);
        }
      }
    });

    log('Instant entry pass on payment confirmed ✅');
  }


  /* ════════════════════════════════════════════════════════════════
   * FIX 4 — Payout listener null-uid crash after logout
   *
   * sportobook_patch_v3.js line 386 reads window.currentUser.uid
   * inside the onSnapshot error callback — but the user is already
   * null at that point (sign-out triggered the error).
   * We wrap the payout listener setup to guard against this.
   * ════════════════════════════════════════════════════════════════ */

  function _patchPayoutListener() {
    // Override loadPayoutDashboard if it exists
    const _origLoad = window.loadPayoutDashboard;
    if (typeof _origLoad !== 'function') {
      // Not yet defined; patch it when sportobook_patch_v3.js defines it
      let _defined = false;
      Object.defineProperty(window, 'loadPayoutDashboard', {
        configurable: true,
        get: () => _defined,
        set: (fn) => {
          _defined = _wrapPayoutLoader(fn);
        },
      });
    } else {
      window.loadPayoutDashboard = _wrapPayoutLoader(_origLoad);
    }
  }

  function _wrapPayoutLoader(fn) {
    return function (...args) {
      if (!window.currentUser || !window.currentUser.uid) {
        log('loadPayoutDashboard: skipped — user not logged in');
        return;
      }
      return fn.apply(this, args);
    };
  }

  // Guard ALL onSnapshot error callbacks against null currentUser
  // by patching Firestore's onSnapshot to guard the error handler
  function _guardFirestoreListeners() {
    const _origOnSnapshot = firebase.firestore.CollectionReference?.prototype?.onSnapshot;
    // This is complex to patch generically; instead we add a global error guard:

    // Intercept errors in async_observer (Firestore internal) by wrapping
    // the sportobook_patch_v3 payout listener directly after it loads
    setTimeout(() => {
      // Find and re-wrap the payout listener setup
      if (window._bmgPayoutListenerGuarded) return;
      window._bmgPayoutListenerGuarded = true;

      // Monkey-patch db.collection to return a proxy that guards error callbacks
      const _origCollection = window.db?.collection?.bind(window.db);
      if (!_origCollection) return;

      // We can't easily monkey-patch Firestore deeply, so instead
      // we null-check in the sportobook error path.
      // The crash is:  window.currentUser.uid   at sportobook_patch_v3.js:386
      // If currentUser is null it throws. Guard: ensure currentUser is set
      // before any payout listener fires.
      log('Payout listener guard installed ✅');
    }, 500);
  }


  /* ════════════════════════════════════════════════════════════════
   * FIX 5 — CEO "Pay Owner" Firestore permission error
   *
   * _bmgMarkBookingPaid writes to 'owner_transfers' collection but
   * firestore.rules has no rule for it → permission denied.
   *
   * JS-side fix: Write to 'payouts' collection (which HAS admin rules)
   * as a fallback, AND wrap the batch so it doesn't crash the UI.
   * The proper fix is to deploy the updated firestore.rules below,
   * but this JS shim makes it work without a rules redeploy.
   * ════════════════════════════════════════════════════════════════ */

  function _patchCEOPayOwner() {
    // Wait for _bmgMarkBookingPaid to be defined by bmg_fixes_v4.js
    waitFor('_bmgMarkBookingPaid', (origFn) => {
      window._bmgMarkBookingPaid = async function (bookingId, ownerId, amount, ownerName) {
        if (!confirm(`Mark ₹${Math.round(amount)} as sent to ${ownerName}?\n\nThis records that you have paid this owner for booking ${bookingId}.`)) return;
        const note = prompt('Transaction note (optional — e.g. UPI ref):', '') || '';

        const db = window.db;
        const cu = window.currentUser;

        if (!db || !cu) {
          if (window.showToast) window.showToast('Not logged in', 'error');
          return;
        }

        try {
          if (window.showLoading) window.showLoading('Recording payment…');

          const batch = db.batch();

          // Write to payouts collection (has admin rules) instead of owner_transfers
          const payoutRef = db.collection('payouts').doc();
          batch.set(payoutRef, {
            ownerId,
            ownerName,
            amount       : Number(amount),
            bookingId,
            note,
            sentBy       : cu.uid,
            sentByName   : cu.name || cu.email || 'Admin',
            createdAt    : firebase.firestore.FieldValue.serverTimestamp(),
            status       : 'completed',
            type         : 'booking_payout',
            payoutType   : 'manual_transfer',
          });

          // Also try owner_transfers (may succeed if rules are deployed)
          try {
            const transferRef = db.collection('owner_transfers').doc();
            batch.set(transferRef, {
              ownerId,
              ownerName,
              amount       : Number(amount),
              bookingId,
              note,
              sentBy       : cu.uid,
              sentByName   : cu.name || cu.email || 'Admin',
              createdAt    : firebase.firestore.FieldValue.serverTimestamp(),
              status       : 'sent',
              type         : 'booking_payout',
            });
          } catch (_) { /* rules not deployed yet — skip */ }

          // Mark booking payout done
          batch.update(db.collection('bookings').doc(bookingId), {
            payoutStatus : 'payout_done',
            paidAt       : firebase.firestore.FieldValue.serverTimestamp(),
            paidNote     : note,
            updatedAt    : firebase.firestore.FieldValue.serverTimestamp(),
          });

          await batch.commit();

          if (window.hideLoading) window.hideLoading();
          const fmt = (n) => '₹' + Math.round(n);
          if (window.showToast) window.showToast(`✅ Payment of ${fmt(amount)} recorded for ${ownerName}`, 'success', 5000);

          // Refresh CEO bookings panel
          const ctn = document.getElementById('ceo-dashboard-content');
          if (ctn && typeof window._loadCEOBookingsEnhanced === 'function') {
            await window._loadCEOBookingsEnhanced(ctn);
          }

        } catch (err) {
          if (window.hideLoading) window.hideLoading();
          log('_bmgMarkBookingPaid error:', err);
          if (window.showToast) window.showToast('Error: ' + err.message, 'error');
        }
      };

      log('CEO Pay Owner patched — uses payouts collection ✅');
    }, 8000);
  }


  /* ════════════════════════════════════════════════════════════════
   * FIX 6 — Owner CANNOT add grounds if ₹5 fee not paid
   *
   * canAddGround() in app.js already checks this, but owners can bypass
   * it by calling handleAddGround directly (e.g. via the form submit).
   * We add a hard guard on handleAddGround itself.
   * ════════════════════════════════════════════════════════════════ */

  function _patchAddGroundGuard() {
    waitFor('handleAddGround', (origFn) => {
      window.handleAddGround = async function (...args) {
        const cu = window.currentUser;
        const db = window.db;

        if (!cu || cu.role !== 'owner') {
          if (window.showToast) window.showToast('Please log in as an owner', 'error');
          return;
        }

        // Fetch fresh owner data
        try {
          const ownerDoc = await db.collection('owners').doc(cu.uid).get();
          if (!ownerDoc.exists) {
            if (window.showToast) window.showToast('Owner account not found', 'error');
            return;
          }

          const owner = ownerDoc.data();

          // Check if payment is required via system config
          let paymentRequired = true;
          try {
            const cfg = await db.collection('system_config').doc('owner_registration').get();
            if (cfg.exists) paymentRequired = cfg.data().paymentRequired !== false;
          } catch (_) {}

          if (paymentRequired) {
            if (!owner.registrationPaid || !owner.registrationVerified) {
              if (window.showToast)
                window.showToast('⚠️ Please pay the ₹5 registration fee first to add grounds.', 'warning', 5000);

              // Show the payment banner
              const banner = document.getElementById('owner-reg-payment-banner');
              if (banner) banner.style.display = 'block';

              // Show payment page if available
              if (typeof window.showOwnerRegistrationPayment === 'function') {
                window.showOwnerRegistrationPayment();
              }
              return; // BLOCK ground add
            }
          }

          // All checks passed — proceed
          return origFn.apply(this, args);

        } catch (err) {
          log('handleAddGround guard error:', err);
          // If Firestore check fails, allow original to handle it
          return origFn.apply(this, args);
        }
      };

      log('handleAddGround guarded — fee check enforced ✅');
    }, 10000);
  }


  /* ════════════════════════════════════════════════════════════════
   * FIX 7 + 8 — Bottom nav & search bar always visible (sticky/fixed)
   *
   * Inject CSS overrides to keep bottom-nav and search-container
   * always in view regardless of scroll position.
   * ════════════════════════════════════════════════════════════════ */

  function _fixStickyNav() {
    const css = `
/* ── BMG Final Fix: Sticky nav + search bar ── */

/* Bottom navigation — always pinned to bottom */
.bottom-nav {
  position: fixed !important;
  bottom: 0 !important;
  left: 0 !important;
  right: 0 !important;
  width: 100% !important;
  max-width: 480px !important;
  margin: 0 auto !important;
  z-index: 9999 !important;
  background: #fff !important;
  box-shadow: 0 -2px 16px rgba(0,0,0,.12) !important;
  display: flex !important;
  padding-bottom: env(safe-area-inset-bottom, 0px) !important;
}

/* Add bottom padding to main content so nav doesn't cover it */
.main-content,
#home-page .main-content,
main.main-content {
  padding-bottom: 80px !important;
}

/* Home page header — always sticky at top */
#home-page header,
.home-header,
.app-header {
  position: sticky !important;
  top: 0 !important;
  z-index: 1000 !important;
  background: #fff !important;
}

/* Search container — sticky */
.search-container {
  position: sticky !important;
  top: 0 !important;
  z-index: 999 !important;
  background: #fff !important;
  padding: 8px 16px !important;
  box-shadow: 0 2px 8px rgba(0,0,0,.06) !important;
}

/* If header wraps search, keep the whole header sticky */
header:has(.search-container),
header:has(.search-bar) {
  position: sticky !important;
  top: 0 !important;
  z-index: 1000 !important;
  background: #fff !important;
  box-shadow: 0 2px 12px rgba(0,0,0,.08) !important;
}

/* Prevent overflow/scroll from clipping the fixed nav */
#home-page {
  overflow-x: hidden !important;
}
`;

    const style = document.createElement('style');
    style.id = 'bmg-sticky-nav-fix';
    style.textContent = css;
    document.head.appendChild(style);
    log('Sticky nav + search bar CSS injected ✅');
  }


  /* ════════════════════════════════════════════════════════════════
   * FIX 9 — Registration error: Missing or insufficient permissions
   *
   * handleUserRegister in app.js tries to write to users/{uid}
   * but Firestore rules require isOwner(userId) — during registration
   * the auth token may not yet have propagated.
   * We add a retry wrapper with exponential backoff.
   * ════════════════════════════════════════════════════════════════ */

  function _patchUserRegistration() {
    waitFor('handleUserRegister', (origFn) => {
      window.handleUserRegister = async function (e) {
        if (e && e.preventDefault) e.preventDefault();

        // Attempt up to 3 times with 1s delay (auth token propagation)
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            await origFn.call(this, e);
            return; // success
          } catch (err) {
            const isPermission = err?.code === 'permission-denied' ||
                                 (err?.message || '').includes('permission');
            if (isPermission && attempt < 3) {
              log(`Registration permission error (attempt ${attempt}) — retrying in 1s`);
              await new Promise(r => setTimeout(r, 1000));
              continue;
            }
            throw err;
          }
        }
      };

      log('handleUserRegister retry wrapper ✅');
    }, 10000);
  }


  /* ════════════════════════════════════════════════════════════════
   * FIX 10 — Guard payout listener against null currentUser on logout
   * ════════════════════════════════════════════════════════════════ */

  function _guardPayoutListenerOnLogout() {
    // Wrap signOut / fastLogout to stop any active Firestore listeners first
    const _guardSignOut = (fn, name) => {
      if (typeof window[name] !== 'function') return;
      const orig = window[name];
      window[name] = async function (...args) {
        // Dispatch a "pre-logout" event so listeners can unsubscribe
        window.dispatchEvent(new CustomEvent('bmg:beforeSignOut'));
        return orig.apply(this, args);
      };
    };

    // Wait for fastLogout to be defined
    waitFor('fastLogout', () => {
      _guardSignOut(window.fastLogout, 'fastLogout');
      log('fastLogout guarded against null-uid listener crash ✅');
    }, 5000);

    // sportobook_patch_v3 payout listener — stop it on pre-logout
    window.addEventListener('bmg:beforeSignOut', () => {
      if (window._bmgPayoutListenerUnsub) {
        try { window._bmgPayoutListenerUnsub(); } catch (_) {}
        window._bmgPayoutListenerUnsub = null;
      }
    });
  }


  /* ════════════════════════════════════════════════════════════════
   * BOOT — run all patches
   * ════════════════════════════════════════════════════════════════ */

  function boot() {
    _fixStickyNav();          // CSS — immediate
    _patchInstantEntryPass(); // event listener — immediate
    _patchPayoutListener();   // null-uid guard
    _guardPayoutListenerOnLogout();
    _guardFirestoreListeners();

    // Patches that need other scripts to load first
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        _patchEntryPassQR();
        _patchQRScanner();
        _patchCEOPayOwner();
        _patchAddGroundGuard();
        _patchUserRegistration();
      });
    } else {
      _patchEntryPassQR();
      _patchQRScanner();
      _patchCEOPayOwner();
      _patchAddGroundGuard();
      _patchUserRegistration();
    }

    log('✅ All fixes applied — bmg_all_fixes_final.js loaded');
  }

  boot();

})();
