/**
 * bmg_master_fix_v2.js
 * ══════════════════════════════════════════════════════════════════════
 * COMPREHENSIVE FIX — All 6 features working professionally
 *
 *  [F1] Slot locking: confirmed booking shows "BOOKED" — no re-booking
 *  [F2] Cancelled/failed payment releases slot instantly
 *  [F3] Tournament join: instant confirmation + spots update + UI
 *  [F4] Tournament QR code — shown after join, visible in My Bookings
 *  [F5] Owner earnings: real data, 10% ground / 20% tournament commission
 *  [F6] Admin/CEO direct payment transfer → visible in owner dashboard
 *
 * LOAD ORDER — add LAST in index.html, after all other scripts:
 *   <script src="bmg_master_fix_v2.js"></script>
 * ══════════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  /* ────────────────────────────────────────────────────────────────────
   * UTILITY — wait for a global function/object to exist
   * ──────────────────────────────────────────────────────────────────── */
  function waitFor(name, cb, interval = 150, maxMs = 15000) {
    if (window[name] !== undefined) { cb(window[name]); return; }
    const start = Date.now();
    const t = setInterval(() => {
      if (window[name] !== undefined) { clearInterval(t); cb(window[name]); return; }
      if (Date.now() - start > maxMs) { clearInterval(t); console.warn('[BMG Fix] timeout waiting for', name); }
    }, interval);
  }

  function waitForAll(names, cb) {
    let remaining = names.length;
    const check = () => { if (--remaining === 0) cb(); };
    names.forEach(n => waitFor(n, check));
  }

  const fmt = v => typeof window.formatCurrency === 'function' ? window.formatCurrency(v) : '₹' + Number(v || 0).toFixed(0);
  const toast = (msg, type = 'success', ms = 4000) => typeof window.showToast === 'function' && window.showToast(msg, type, ms);
  const db = () => window.db;
  const FS = () => window.firebase?.firestore?.FieldValue;

  /* ════════════════════════════════════════════════════════════════════
   * [F1 + F2]  SLOT STATUS — BOOKED after payment / RELEASED on cancel
   * ════════════════════════════════════════════════════════════════════
   * Problem: after payment succeeds the slot was not always updated to
   * "booked" in the slots collection, so other users could still select it.
   * On payment cancel/failure the lock was sometimes left dangling.
   *
   * Fix: listen to bmg:paymentConfirmed (success) and bmg:paymentFailed
   * (cancel/failure) and ensure Firestore slots doc is updated correctly.
   * Also patch releaseSlotLock so it works even without a lock doc.
   * ──────────────────────────────────────────────────────────────────── */

  /** Permanently mark a slot as BOOKED in every relevant Firestore location */
  async function _lockSlotAsBooked(groundId, date, slotTime, bookingId, userId) {
    if (!groundId || !date || !slotTime) return;
    const [startTime, endTime] = String(slotTime).split('-').map(s => s.trim());
    const _db = db();
    if (!_db) return;

    try {
      // 1. Update slots collection
      const slotSnap = await _db.collection('slots')
        .where('groundId', '==', groundId)
        .where('date',     '==', date)
        .where('startTime','==', startTime)
        .get();

      const batch = _db.batch();

      if (!slotSnap.empty) {
        slotSnap.docs.forEach(d => {
          batch.update(d.ref, {
            status    : 'booked',
            bookingId : bookingId || '',
            bookedBy  : userId    || '',
            bookedAt  : FS().serverTimestamp(),
            lockedBy  : null,
            lockExpiresAt: null,
            lockId    : null,
            updatedAt : FS().serverTimestamp(),
          });
        });
      } else {
        // Create it so availability checks see it
        const newRef = _db.collection('slots').doc();
        batch.set(newRef, {
          groundId, date, startTime, endTime: endTime || '',
          status   : 'booked',
          bookingId: bookingId || '',
          bookedBy : userId    || '',
          bookedAt : FS().serverTimestamp(),
          createdAt: FS().serverTimestamp(),
          updatedAt: FS().serverTimestamp(),
        });
      }

      // 2. Clean up any leftover slot_locks for this slot
      const lockSnap = await _db.collection('slot_locks')
        .where('groundId', '==', groundId)
        .where('date',     '==', date)
        .where('startTime','==', startTime)
        .get();
      lockSnap.docs.forEach(d => batch.delete(d.ref));

      await batch.commit();
      console.log('[BMG F1] ✅ Slot marked BOOKED:', groundId, date, slotTime);
    } catch (err) {
      console.error('[BMG F1] slot booked error:', err);
    }
  }

  /** Release a slot back to available — called on payment cancel/failure */
  async function _releaseSlotToAvailable(groundId, date, slotTime, lockId) {
    if (!groundId || !date || !slotTime) return;
    const [startTime] = String(slotTime).split('-').map(s => s.trim());
    const _db = db();
    if (!_db) return;

    try {
      const batch = _db.batch();

      // Update slots
      const slotSnap = await _db.collection('slots')
        .where('groundId', '==', groundId)
        .where('date',     '==', date)
        .where('startTime','==', startTime)
        .get();

      slotSnap.docs.forEach(d => {
        const s = d.data();
        // Only release if it was locked (not if already confirmed by someone else)
        if (s.status === 'locked' || s.status === 'pending') {
          batch.update(d.ref, {
            status      : 'available',
            lockedBy    : null,
            lockExpiresAt: null,
            lockId      : null,
            bookingId   : null,
            bookedBy    : null,
            updatedAt   : FS().serverTimestamp(),
          });
        }
      });

      // Delete the lock doc
      if (lockId) {
        batch.delete(_db.collection('slot_locks').doc(lockId));
      }

      // Also delete any orphaned locks for this slot
      const lockSnap = await _db.collection('slot_locks')
        .where('groundId', '==', groundId)
        .where('date',     '==', date)
        .where('startTime','==', startTime)
        .get();
      lockSnap.docs.forEach(d => batch.delete(d.ref));

      await batch.commit();
      console.log('[BMG F2] ✅ Slot released to AVAILABLE:', groundId, date, slotTime);
    } catch (err) {
      console.error('[BMG F2] slot release error:', err);
    }
  }

  // Listen: payment CONFIRMED → lock slot as booked
  window.addEventListener('bmg:paymentConfirmed', async (e) => {
    const { paymentType, result, orderId } = e.detail || {};
    if (paymentType !== 'booking') return;

    const d = result || {};
    await _lockSlotAsBooked(
      d.groundId, d.date, d.slotTime,
      d.bookingId || orderId,
      d.userId || window.currentUser?.uid
    );

    // Also refresh visible slot grid if ground detail page is open
    if (typeof window.loadGroundSlots === 'function') {
      setTimeout(() => window.loadGroundSlots(d.groundId, d.date), 500);
    }
  });

  // Listen: payment FAILED/CANCELLED → release slot instantly
  window.addEventListener('bmg:paymentFailed', async (e) => {
    const d = e.detail || {};
    const ss = sessionStorage.getItem('slotLock');
    let slotInfo = d;
    if (ss) { try { slotInfo = { ...JSON.parse(ss), ...slotInfo }; } catch (_) {} }

    await _releaseSlotToAvailable(
      slotInfo.groundId, slotInfo.date, slotInfo.slotTime,
      slotInfo.lockId || slotInfo.orderId
    );
    sessionStorage.removeItem('slotLock');
    sessionStorage.removeItem('currentBookingDetails');

    toast('Slot has been released. You can try again.', 'info');
  });

  // Patch releaseSlotLock to also update slots collection (belt-and-suspenders)
  waitFor('releaseSlotLock', (orig) => {
    window.releaseSlotLock = async function (orderId) {
      try { await orig(orderId); } catch (_) {}
      // Also fire the release for the session-stored slot
      const ss = sessionStorage.getItem('slotLock');
      if (ss) {
        try {
          const lock = JSON.parse(ss);
          await _releaseSlotToAvailable(lock.groundId, lock.date, lock.slotTime, orderId);
        } catch (_) {}
      }
    };
    console.log('[BMG F2] releaseSlotLock patched');
  });

  /* ════════════════════════════════════════════════════════════════════
   * [F3]  TOURNAMENT — INSTANT CONFIRMATION + SPOTS UPDATE
   * ════════════════════════════════════════════════════════════════════
   * After a successful tournament payment:
   *  • Write confirmed entry to tournament_entries
   *  • Decrement availableSpots / increment registeredCount on tournament
   *  • Update tournament_registrations doc
   *  • Show success modal with all details
   * ──────────────────────────────────────────────────────────────────── */

  async function _confirmTournamentEntry(orderId, paymentData) {
    const _db  = db();
    const cu   = window.currentUser;
    if (!_db || !cu || !orderId) return;

    const now  = FS().serverTimestamp();
    const meta = paymentData || {};

    const tournamentId   = meta.tournamentId   || '';
    const tournamentName = meta.tournamentName || meta.name || '';
    const entryFee       = Number(meta.amount  || meta.entryFee || 0);
    const platformFee    = Math.round(entryFee * 0.20);      // 20% platform cut
    const ownerAmount    = entryFee - platformFee;

    const confirmedEntry = {
      orderId,
      registrationId   : orderId,
      tournamentId,
      tournamentName,
      userId           : cu.uid,
      userName         : cu.name  || cu.displayName || '',
      userEmail        : cu.email || '',
      userPhone        : cu.phone || '',
      teamName         : meta.teamName  || '',
      sport            : meta.sport     || '',
      venue            : meta.venue     || '',
      date             : meta.date      || '',
      amount           : entryFee,
      entryFee,
      platformFee,
      ownerAmount,
      paymentMethod    : 'cashfree',
      paymentStatus    : 'paid',
      status           : 'confirmed',
      registrationStatus: 'confirmed',
      confirmedAt      : now,
      createdAt        : now,
      updatedAt        : now,
    };

    try {
      const batch = _db.batch();

      // tournament_entries
      batch.set(_db.collection('tournament_entries').doc(orderId), confirmedEntry, { merge: true });

      // tournament_registrations
      const regColl = window.COLLECTIONS?.TOURNAMENT_REGISTRATIONS || 'tournament_registrations';
      batch.set(_db.collection(regColl).doc(orderId), confirmedEntry, { merge: true });

      if (tournamentId) {
        // Spots: decrement availableSpots, increment registeredCount
        const tRef = _db.collection(window.COLLECTIONS?.TOURNAMENTS || 'tournaments').doc(tournamentId);
        batch.update(tRef, {
          availableSpots  : FS().increment(-1),
          registeredCount : FS().increment(1),
          spotsLeft       : FS().increment(-1),
          updatedAt       : now,
          // Also push to registeredTeams array
          registeredTeams : FS().arrayUnion({
            userId         : cu.uid,
            userName       : cu.name || '',
            teamName       : meta.teamName || '',
            registrationId : orderId,
            status         : 'confirmed',
            paidAt         : new Date().toISOString(),
          }),
        });
      }

      // Clean up pending docs
      try {
        const pendSnap = await _db.collection(window.COLLECTIONS?.PENDING_TOURNAMENT_REGISTRATIONS || 'pending_tournament_registrations')
          .where('tournamentId', '==', tournamentId)
          .where('userId', '==', cu.uid)
          .get();
        pendSnap.forEach(d => batch.delete(d.ref));
      } catch (_) {}

      await batch.commit();

      // Clear session state
      sessionStorage.removeItem('pendingTournamentRegistration');
      window._pendingTournamentRegData = null;
      window.currentTournamentPayment  = null;

      console.log('[BMG F3] ✅ Tournament entry confirmed:', orderId, tournamentId);

      // Show the success modal
      _showTournamentSuccessModal({ ...confirmedEntry, orderId });

      // Generate and store QR for this entry
      await _ensureTournamentQR(orderId, confirmedEntry);

      // Refresh My Tournaments list if function exists
      if (typeof window.loadMyTournaments === 'function') {
        setTimeout(() => window.loadMyTournaments(), 1000);
      }

    } catch (err) {
      console.error('[BMG F3] tournament confirmation error:', err);
      toast('🏆 Payment received! Registration being confirmed. Check "My Tournaments".', 'success', 8000);
    }
  }

  // Listen to payment confirmed for tournament type
  window.addEventListener('bmg:paymentConfirmed', async (e) => {
    const { paymentType, orderId, result } = e.detail || {};
    if (paymentType !== 'tournament') return;
    await _confirmTournamentEntry(orderId, result || window._lastTournamentPaymentData || {});
  });

  /* ════════════════════════════════════════════════════════════════════
   * [F4]  TOURNAMENT QR CODE — entry QR visible in My Bookings
   * ════════════════════════════════════════════════════════════════════ */

  /** Generate QR data string for tournament entry */
  function _tournamentQRData(entry) {
    return JSON.stringify({
      appId          : 'BookMyGame',
      type           : 'tournament',
      registrationId : entry.orderId     || entry.registrationId || '',
      tournamentId   : entry.tournamentId || '',
      tournamentName : entry.tournamentName || '',
      userId         : entry.userId || '',
      userName       : entry.userName || '',
      teamName       : entry.teamName || '',
      sport          : entry.sport   || '',
      date           : entry.date    || '',
      venue          : entry.venue   || '',
      amount         : entry.amount  || 0,
      issuedAt       : new Date().toISOString(),
    });
  }

  /** Generate a QR code URL using public API */
  function _qrUrl(data, size = 220) {
    return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(data)}`;
  }

  /** Store QR data in Firestore so it can be retrieved in My Bookings */
  async function _ensureTournamentQR(orderId, entry) {
    const _db = db();
    if (!_db || !orderId) return;
    try {
      const qrData = _tournamentQRData(entry);
      await _db.collection('tournament_entries').doc(orderId).update({
        qrData       : qrData,
        qrUrl        : _qrUrl(qrData),
        qrGeneratedAt: FS().serverTimestamp(),
        updatedAt    : FS().serverTimestamp(),
      });
      console.log('[BMG F4] ✅ Tournament QR saved to Firestore for', orderId);
    } catch (err) {
      console.error('[BMG F4] QR save error:', err);
    }
  }

  /** Show tournament success modal with QR */
  function _showTournamentSuccessModal(entry) {
    // Remove any existing modal
    document.getElementById('bmg-tournament-success-modal')?.remove();

    const qrData = _tournamentQRData(entry);
    const qrSrc  = _qrUrl(qrData, 200);

    const modal = document.createElement('div');
    modal.id = 'bmg-tournament-success-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:16px;';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:24px;max-width:400px;width:100%;padding:28px 20px;text-align:center;box-shadow:0 32px 80px rgba(0,0,0,.25);animation:bmgSlideUp .35s cubic-bezier(.16,1,.3,1);">
        <style>@keyframes bmgSlideUp{from{opacity:0;transform:translateY(40px)}to{opacity:1;transform:translateY(0)}}</style>
        <div style="width:72px;height:72px;background:linear-gradient(135deg,#10b981,#059669);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;box-shadow:0 12px 28px rgba(16,185,129,.35);">
          <i class="fas fa-trophy" style="color:#fff;font-size:30px;"></i>
        </div>
        <h2 style="font-size:22px;font-weight:800;color:#111;margin:0 0 6px;">You're In! 🎉</h2>
        <p style="font-size:14px;color:#6b7280;margin:0 0 16px;">Successfully registered for</p>
        <div style="background:#f0fdf4;border-radius:14px;padding:14px;margin-bottom:16px;">
          <p style="font-weight:700;color:#065f46;font-size:16px;margin:0 0 4px;">${entry.tournamentName || 'Tournament'}</p>
          ${entry.teamName ? `<p style="font-size:13px;color:#059669;margin:0;">Team: <strong>${entry.teamName}</strong></p>` : ''}
          ${entry.sport ? `<p style="font-size:12px;color:#6b7280;margin:4px 0 0;">${entry.sport}${entry.date ? ' · ' + entry.date : ''}${entry.venue ? ' · ' + entry.venue : ''}</p>` : ''}
        </div>
        <p style="font-size:13px;color:#374151;font-weight:600;margin:0 0 10px;">Your Entry QR Code</p>
        <img src="${qrSrc}" alt="Entry QR" style="width:160px;height:160px;border-radius:12px;border:3px solid #d1fae5;margin-bottom:14px;" onerror="this.alt='QR Code'">
        <p style="font-size:11px;color:#9ca3af;margin:0 0 18px;">Show this QR to the organiser at the venue</p>
        <div style="display:flex;gap:10px;">
          <button onclick="document.getElementById('bmg-tournament-success-modal').remove();if(typeof showPage==='function')showPage('main-page');" style="flex:1;padding:12px;background:#f3f4f6;color:#374151;border:none;border-radius:14px;font-size:14px;font-weight:600;cursor:pointer;">Home</button>
          <button onclick="document.getElementById('bmg-tournament-success-modal').remove();if(typeof window.bmgShowMyTournaments==='function')window.bmgShowMyTournaments();" style="flex:1;padding:12px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:14px;font-size:14px;font-weight:700;cursor:pointer;">My Tournaments</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  }

  /** Patch loadUserBookings to ALSO show tournament entries with QR */
  function _patchMyBookingsPage() {
    const origLoad = window.loadUserBookings;
    if (typeof origLoad !== 'function') return;

    window.loadUserBookings = async function (status) {
      // Run original first
      await origLoad.call(this, status);

      // Then append tournament entries if status is 'upcoming' or undefined
      if (status && status !== 'upcoming') return;

      const _db = db();
      const cu  = window.currentUser;
      if (!_db || !cu) return;

      try {
        const tSnap = await _db.collection('tournament_entries')
          .where('userId', '==', cu.uid)
          .where('status', '==', 'confirmed')
          .orderBy('createdAt', 'desc')
          .get();

        if (tSnap.empty) return;

        const container = document.getElementById('user-bookings-list');
        if (!container) return;

        // Remove any empty-state if bookings already shown
        const emptyEl = container.querySelector('.empty-state');
        if (emptyEl && tSnap.size > 0) emptyEl.remove();

        tSnap.docs.forEach(doc => {
          const e = doc.data();
          const qrSrc = e.qrUrl || _qrUrl(_tournamentQRData({ ...e, orderId: doc.id }), 160);

          const card = document.createElement('div');
          card.className = 'booking-card tournament-booking-card';
          card.style.cssText = 'background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.08);margin-bottom:16px;border:1px solid #d1fae5;';
          card.innerHTML = `
            <div style="background:linear-gradient(135deg,#10b981,#059669);padding:12px 16px;display:flex;align-items:center;gap:10px;">
              <i class="fas fa-trophy" style="color:#fff;font-size:18px;"></i>
              <div>
                <span style="color:#fff;font-weight:700;font-size:14px;">Tournament Entry</span>
                <span style="background:rgba(255,255,255,.2);color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;margin-left:8px;">CONFIRMED</span>
              </div>
            </div>
            <div style="padding:14px 16px;">
              <h4 style="font-size:15px;font-weight:700;color:#065f46;margin:0 0 8px;">${e.tournamentName || 'Tournament'}</h4>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;color:#374151;margin-bottom:12px;">
                ${e.teamName ? `<div><span style="color:#9ca3af;">Team</span><br><strong>${e.teamName}</strong></div>` : ''}
                ${e.sport    ? `<div><span style="color:#9ca3af;">Sport</span><br><strong>${e.sport}</strong></div>` : ''}
                ${e.date     ? `<div><span style="color:#9ca3af;">Date</span><br><strong>${e.date}</strong></div>` : ''}
                ${e.venue    ? `<div><span style="color:#9ca3af;">Venue</span><br><strong>${e.venue}</strong></div>` : ''}
                <div><span style="color:#9ca3af;">Entry Fee</span><br><strong style="color:#059669;">${fmt(e.amount)}</strong></div>
                <div><span style="color:#9ca3af;">Reg. ID</span><br><strong style="font-size:10px;">${(e.registrationId || doc.id).slice(0,12)}…</strong></div>
              </div>
              <div style="text-align:center;border-top:1px solid #d1fae5;padding-top:12px;">
                <p style="font-size:11px;color:#6b7280;margin:0 0 8px;font-weight:600;">ENTRY QR CODE — Show at venue</p>
                <img src="${qrSrc}" alt="Entry QR" style="width:130px;height:130px;border-radius:10px;border:2px solid #d1fae5;" 
                     onerror="this.src='${_qrUrl(_tournamentQRData({ ...e, orderId: doc.id }))}'">
              </div>
            </div>`;
          container.insertBefore(card, container.firstChild);
        });
      } catch (err) {
        console.error('[BMG F4] tournament entries in bookings error:', err);
      }
    };

    console.log('[BMG F4] ✅ loadUserBookings patched to show tournament QR cards');
  }

  /** Expose My Tournaments page navigation */
  window.bmgShowMyTournaments = function () {
    if (typeof window.showPage === 'function') {
      window.showPage('bookings-page');
      setTimeout(() => {
        const tabBtns = document.querySelectorAll('.booking-tab-btn, [data-tab]');
        tabBtns.forEach(b => { if (/tournament/i.test(b.textContent)) b.click(); });
      }, 300);
    }
  };

  /* ════════════════════════════════════════════════════════════════════
   * [F5]  OWNER EARNINGS — real data with correct commission
   * ════════════════════════════════════════════════════════════════════
   * Ground bookings: owner gets 90% (10% platform fee)
   * Tournament entries: owner gets 80% (20% platform fee)
   * Also includes admin/CEO transfers received
   * ──────────────────────────────────────────────────────────────────── */

  window._bmgLoadOwnerEarningsFull = async function (container) {
    if (!container) container = document.getElementById('earnings-container') || document.querySelector('.earnings-content');
    if (!container) return;

    const _db = db();
    const cu  = window.currentUser;
    if (!_db || !cu) { container.innerHTML = '<p style="text-align:center;color:#9ca3af;">Please log in</p>'; return; }

    container.innerHTML = '<div style="text-align:center;padding:32px;"><div class="loader-spinner"></div><p>Loading earnings…</p></div>';

    try {
      // ── 1. Ground Booking Earnings ──────────────────────────────────
      const bookSnap = await _db.collection('bookings')
        .where('ownerId', '==', cu.uid)
        .where('bookingStatus', '==', 'confirmed')
        .orderBy('createdAt', 'desc')
        .get()
        .catch(() => _db.collection('bookings').where('ownerId', '==', cu.uid).get());

      let totalBookingEarnings = 0;
      let bookingCount = 0;
      const bookingRows = [];

      bookSnap.forEach(doc => {
        const b = doc.data();
        const fullAmt  = Number(b.amount || b.totalAmount || 0);
        const platFee  = Number(b.commission || b.platformFee || Math.round(fullAmt * 0.10));
        const ownerAmt = Number(b.ownerAmount || (fullAmt - platFee));
        if (ownerAmt <= 0) return;
        totalBookingEarnings += ownerAmt;
        bookingCount++;
        bookingRows.push({ date: b.date || '', ground: b.groundName || b.venueName || '—', slot: b.slotTime || '', fullAmt, platFee, ownerAmt, status: b.payoutStatus || 'pending' });
      });

      // ── 2. Tournament Earnings ──────────────────────────────────────
      // Get owner's tournaments first
      const ownTournSnap = await _db.collection('tournaments')
        .where('ownerId', '==', cu.uid)
        .get()
        .catch(() => ({ docs: [] }));

      const ownTournIds = ownTournSnap.docs.map(d => d.id).filter(Boolean);

      let totalTournEarnings = 0;
      let tournCount = 0;
      const tournRows = [];

      if (ownTournIds.length > 0) {
        // Chunk into groups of 10 (Firestore 'in' limit)
        for (let i = 0; i < ownTournIds.length; i += 10) {
          const chunk = ownTournIds.slice(i, i + 10);
          const tSnap = await _db.collection('tournament_entries')
            .where('tournamentId', 'in', chunk)
            .where('status', '==', 'confirmed')
            .get()
            .catch(() => ({ docs: [] }));

          tSnap.docs.forEach(doc => {
            const e = doc.data();
            const entryFee  = Number(e.amount  || e.entryFee  || 0);
            const platFee   = Number(e.platformFee || Math.round(entryFee * 0.20));
            const ownerAmt  = Number(e.ownerAmount || (entryFee - platFee));
            if (ownerAmt <= 0) return;
            totalTournEarnings += ownerAmt;
            tournCount++;
            tournRows.push({ date: e.date || '', tournament: e.tournamentName || '—', team: e.teamName || '—', entryFee, platFee, ownerAmt });
          });
        }
      }

      // ── 3. Admin/CEO Transfers Received ────────────────────────────
      const transferSnap = await _db.collection('owner_payments')
        .where('ownerId', '==', cu.uid)
        .where('status', '==', 'paid')
        .orderBy('paidAt', 'desc')
        .get()
        .catch(() => ({ docs: [] }));

      let totalTransfers = 0;
      const transferRows = [];
      transferSnap.docs.forEach(doc => {
        const t = doc.data();
        const amt = Number(t.amount || 0);
        totalTransfers += amt;
        transferRows.push({
          amount: amt,
          note  : t.note || t.description || 'Admin Transfer',
          paidAt: t.paidAt?.toDate?.()?.toLocaleDateString('en-IN') || '',
          paidBy: t.paidByName || t.adminName || 'Admin',
          docId : doc.id,
        });
      });

      const grandTotal = totalBookingEarnings + totalTournEarnings + totalTransfers;

      // ── 4. Render ───────────────────────────────────────────────────
      container.innerHTML = `
        <style>
          .bmg-earn-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px;}
          .bmg-earn-card{background:#fff;border-radius:14px;padding:16px;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.07);}
          .bmg-earn-val{font-size:22px;font-weight:800;color:#10b981;}
          .bmg-earn-lbl{font-size:11px;color:#9ca3af;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-top:4px;}
          .bmg-earn-sub{font-size:11px;color:#6b7280;margin-top:2px;}
          .bmg-earn-table{width:100%;border-collapse:collapse;font-size:12px;background:#fff;border-radius:12px;overflow:hidden;}
          .bmg-earn-table th{background:#f9fafb;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.3px;padding:10px 12px;text-align:left;border-bottom:1px solid #e5e7eb;}
          .bmg-earn-table td{padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#374151;}
          .bmg-earn-table tr:last-child td{border:none;}
          .bmg-earn-section{background:#fff;border-radius:16px;padding:18px;margin-bottom:16px;box-shadow:0 2px 12px rgba(0,0,0,.07);}
          .bmg-earn-section h3{font-size:15px;font-weight:700;color:#111;margin:0 0 14px;display:flex;align-items:center;gap:8px;}
          .bmg-badge-paid{background:#d1fae5;color:#065f46;font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;}
          .bmg-badge-pending{background:#fef3c7;color:#92400e;font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;}
          .bmg-badge-transfer{background:#dbeafe;color:#1e40af;font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;}
        </style>

        <!-- Summary Cards -->
        <div class="bmg-earn-grid">
          <div class="bmg-earn-card" style="border-top:3px solid #10b981;">
            <div class="bmg-earn-val">${fmt(grandTotal)}</div>
            <div class="bmg-earn-lbl">Total Earnings</div>
            <div class="bmg-earn-sub">All sources</div>
          </div>
          <div class="bmg-earn-card" style="border-top:3px solid #3b82f6;">
            <div class="bmg-earn-val" style="color:#3b82f6;">${fmt(totalBookingEarnings)}</div>
            <div class="bmg-earn-lbl">Ground Bookings</div>
            <div class="bmg-earn-sub">${bookingCount} booking${bookingCount !== 1 ? 's' : ''} · 90%</div>
          </div>
          <div class="bmg-earn-card" style="border-top:3px solid #8b5cf6;">
            <div class="bmg-earn-val" style="color:#8b5cf6;">${fmt(totalTournEarnings)}</div>
            <div class="bmg-earn-lbl">Tournaments</div>
            <div class="bmg-earn-sub">${tournCount} entr${tournCount !== 1 ? 'ies' : 'y'} · 80%</div>
          </div>
          <div class="bmg-earn-card" style="border-top:3px solid #f59e0b;">
            <div class="bmg-earn-val" style="color:#f59e0b;">${fmt(totalTransfers)}</div>
            <div class="bmg-earn-lbl">Received Transfers</div>
            <div class="bmg-earn-sub">${transferRows.length} payment${transferRows.length !== 1 ? 's' : ''}</div>
          </div>
        </div>

        <!-- Commission Info Banner -->
        <div style="background:linear-gradient(135deg,#eff6ff,#dbeafe);border-radius:12px;padding:12px 16px;margin-bottom:16px;font-size:12px;color:#1e40af;display:flex;align-items:center;gap:10px;">
          <i class="fas fa-info-circle"></i>
          <span><strong>Commission:</strong> Ground bookings — you earn <strong>90%</strong> (10% platform fee) · Tournaments — you earn <strong>80%</strong> (20% platform fee)</span>
        </div>

        <!-- Ground Booking Earnings -->
        <div class="bmg-earn-section">
          <h3><i class="fas fa-football-ball" style="color:#3b82f6;"></i> Ground Booking Earnings</h3>
          ${bookingRows.length === 0
            ? '<p style="text-align:center;color:#9ca3af;padding:20px 0;">No confirmed bookings yet</p>'
            : `<div style="overflow-x:auto;"><table class="bmg-earn-table">
              <thead><tr><th>Date</th><th>Ground</th><th>Slot</th><th>Total</th><th>Platform</th><th>Your Share</th><th>Status</th></tr></thead>
              <tbody>${bookingRows.map(r => `<tr>
                <td>${r.date}</td><td>${r.ground}</td><td>${r.slot}</td>
                <td>${fmt(r.fullAmt)}</td><td style="color:#ef4444;">-${fmt(r.platFee)}</td>
                <td style="color:#10b981;font-weight:700;">${fmt(r.ownerAmt)}</td>
                <td><span class="${r.status === 'payout_done' ? 'bmg-badge-paid' : 'bmg-badge-pending'}">${r.status === 'payout_done' ? 'Paid' : 'Pending'}</span></td>
              </tr>`).join('')}</tbody>
            </table></div>`}
        </div>

        <!-- Tournament Earnings -->
        <div class="bmg-earn-section">
          <h3><i class="fas fa-trophy" style="color:#8b5cf6;"></i> Tournament Earnings</h3>
          ${tournRows.length === 0
            ? '<p style="text-align:center;color:#9ca3af;padding:20px 0;">No tournament earnings yet</p>'
            : `<div style="overflow-x:auto;"><table class="bmg-earn-table">
              <thead><tr><th>Tournament</th><th>Team</th><th>Date</th><th>Entry Fee</th><th>Platform</th><th>Your Share</th></tr></thead>
              <tbody>${tournRows.map(r => `<tr>
                <td>${r.tournament}</td><td>${r.team}</td><td>${r.date}</td>
                <td>${fmt(r.entryFee)}</td><td style="color:#ef4444;">-${fmt(r.platFee)}</td>
                <td style="color:#10b981;font-weight:700;">${fmt(r.ownerAmt)}</td>
              </tr>`).join('')}</tbody>
            </table></div>`}
        </div>

        <!-- Admin/CEO Transfers Received -->
        <div class="bmg-earn-section">
          <h3><i class="fas fa-exchange-alt" style="color:#f59e0b;"></i> Received from Admin / CEO</h3>
          ${transferRows.length === 0
            ? '<p style="text-align:center;color:#9ca3af;padding:20px 0;">No transfers received yet</p>'
            : `<div style="overflow-x:auto;"><table class="bmg-earn-table">
              <thead><tr><th>Date</th><th>From</th><th>Note</th><th>Amount</th></tr></thead>
              <tbody>${transferRows.map(r => `<tr>
                <td>${r.paidAt}</td><td>${r.paidBy}</td><td>${r.note}</td>
                <td style="color:#10b981;font-weight:700;">${fmt(r.amount)} <span class="bmg-badge-transfer">PAID</span></td>
              </tr>`).join('')}</tbody>
            </table></div>`}
        </div>
      `;

    } catch (err) {
      console.error('[BMG F5] loadOwnerEarnings error:', err);
      container.innerHTML = `<p style="text-align:center;color:#ef4444;padding:32px;">Failed to load earnings. Please try again.</p>`;
    }
  };

  // Also expose as loadOwnerEarnings (the standard name called by dashboard)
  window.loadOwnerEarnings = window._bmgLoadOwnerEarningsFull;

  console.log('[BMG F5] ✅ Owner earnings function installed');

  /* ════════════════════════════════════════════════════════════════════
   * [F6]  ADMIN / CEO — VIEW OWNER EARNINGS + TRANSFER PAYMENT
   * ════════════════════════════════════════════════════════════════════
   * Adds:
   *  • loadAdminOwnerEarnings(container) — shows all owners with earnings
   *  • bmgAdminTransferPayment(ownerId, amount, note) — marks transfer done
   * The transfer is written to owner_payments collection and is
   * immediately visible in the owner's F5 earnings dashboard.
   * ──────────────────────────────────────────────────────────────────── */

  window.loadAdminOwnerEarnings = async function (container) {
    if (!container) container = document.getElementById('admin-owner-earnings-container');
    if (!container) return;

    const _db = db();
    const cu  = window.currentUser;
    if (!_db || !cu) return;

    container.innerHTML = '<div style="text-align:center;padding:32px;"><div class="loader-spinner"></div><p>Loading owner earnings…</p></div>';

    try {
      // Get all confirmed bookings
      const bookSnap = await _db.collection('bookings')
        .where('bookingStatus', '==', 'confirmed')
        .orderBy('createdAt', 'desc')
        .get()
        .catch(() => ({ docs: [] }));

      // Get all confirmed tournament entries
      const tournSnap = await _db.collection('tournament_entries')
        .where('status', '==', 'confirmed')
        .get()
        .catch(() => ({ docs: [] }));

      // Get all paid transfers
      const transferSnap = await _db.collection('owner_payments')
        .where('status', '==', 'paid')
        .get()
        .catch(() => ({ docs: [] }));

      // Aggregate by ownerId
      const ownerData = {};

      const ensureOwner = (ownerId, ownerName = '') => {
        if (!ownerData[ownerId]) {
          ownerData[ownerId] = { ownerId, ownerName, bookingEarnings: 0, tournamentEarnings: 0, transfersPaid: 0, bookingCount: 0, tournCount: 0, transferCount: 0, bookings: [] };
        }
        if (ownerName && !ownerData[ownerId].ownerName) ownerData[ownerId].ownerName = ownerName;
      };

      bookSnap.docs.forEach(doc => {
        const b = doc.data();
        const ownerId = b.ownerId || '';
        if (!ownerId) return;
        ensureOwner(ownerId, b.ownerName || '');
        const fullAmt  = Number(b.amount || 0);
        const platFee  = Number(b.commission || Math.round(fullAmt * 0.10));
        const ownerAmt = Number(b.ownerAmount || (fullAmt - platFee));
        ownerData[ownerId].bookingEarnings += ownerAmt;
        ownerData[ownerId].bookingCount++;
        ownerData[ownerId].bookings.push({ type: 'booking', date: b.date, ground: b.groundName || '', slot: b.slotTime || '', ownerAmt, platFee, fullAmt, status: b.payoutStatus || 'pending' });
      });

      tournSnap.docs.forEach(doc => {
        const e = doc.data();
        // Match to owner via tournament ownerId
        const ownerId = e.ownerId || e.tournamentOwnerId || '';
        if (!ownerId) return;
        ensureOwner(ownerId, '');
        const entryFee  = Number(e.amount || e.entryFee || 0);
        const platFee   = Number(e.platformFee || Math.round(entryFee * 0.20));
        const ownerAmt  = Number(e.ownerAmount || (entryFee - platFee));
        ownerData[ownerId].tournamentEarnings += ownerAmt;
        ownerData[ownerId].tournCount++;
      });

      transferSnap.docs.forEach(doc => {
        const t = doc.data();
        const ownerId = t.ownerId || '';
        if (!ownerId) return;
        ensureOwner(ownerId, t.ownerName || '');
        ownerData[ownerId].transfersPaid += Number(t.amount || 0);
        ownerData[ownerId].transferCount++;
      });

      // Fetch owner names if missing
      const ownerIds = Object.keys(ownerData).filter(id => !ownerData[id].ownerName);
      if (ownerIds.length > 0) {
        for (let i = 0; i < ownerIds.length; i += 10) {
          const chunk = ownerIds.slice(i, i + 10);
          const owSnap = await _db.collection('owners').where(firebase.firestore.FieldPath.documentId(), 'in', chunk).get().catch(() => ({ docs: [] }));
          owSnap.docs.forEach(d => {
            if (ownerData[d.id]) ownerData[d.id].ownerName = d.data().name || d.data().ownerName || 'Unknown';
          });
        }
      }

      const owners = Object.values(ownerData).sort((a, b) => (b.bookingEarnings + b.tournamentEarnings) - (a.bookingEarnings + a.tournamentEarnings));

      if (owners.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:32px;">No owner earnings data yet.</p>';
        return;
      }

      const totalPlatRev = owners.reduce((s, o) => {
        const bk = o.bookingCount > 0 ? o.bookingEarnings / 0.9 * 0.1 : 0;  // approx
        const tn = o.tournCount   > 0 ? o.tournamentEarnings / 0.8 * 0.2 : 0;
        return s + bk + tn;
      }, 0);

      container.innerHTML = `
        <style>
          .bmg-admin-earn-card{background:#fff;border-radius:16px;padding:18px;margin-bottom:16px;box-shadow:0 2px 12px rgba(0,0,0,.07);border-left:4px solid #10b981;}
          .bmg-admin-earn-card h4{font-size:15px;font-weight:700;color:#111;margin:0 0 10px;}
          .bmg-admin-earn-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151;}
          .bmg-admin-earn-row:last-child{border:none;}
          .bmg-transfer-btn{background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;border:none;padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;margin-top:12px;}
          .bmg-transfer-btn:hover{opacity:.9;}
          .bmg-platform-banner{background:linear-gradient(135deg,#1e3a5f,#1e40af);color:#fff;border-radius:16px;padding:18px;margin-bottom:20px;text-align:center;}
        </style>

        <div class="bmg-platform-banner">
          <div style="font-size:11px;opacity:.8;text-transform:uppercase;letter-spacing:.5px;">Platform Revenue (Approx.)</div>
          <div style="font-size:30px;font-weight:800;margin:4px 0;">${fmt(totalPlatRev)}</div>
          <div style="font-size:12px;opacity:.75;">10% from bookings + 20% from tournaments</div>
        </div>

        ${owners.map(o => {
          const totalEarned    = o.bookingEarnings + o.tournamentEarnings;
          const netOwed        = totalEarned - o.transfersPaid;
          return `
          <div class="bmg-admin-earn-card" id="owner-earn-card-${o.ownerId}">
            <h4>${o.ownerName || 'Unknown Owner'} <span style="font-size:11px;color:#9ca3af;font-weight:400;">${o.ownerId.slice(0,8)}…</span></h4>
            <div class="bmg-admin-earn-row"><span>Ground Bookings (90% share)</span><span style="color:#3b82f6;font-weight:700;">${fmt(o.bookingEarnings)}</span></div>
            <div class="bmg-admin-earn-row"><span>Tournament Earnings (80% share)</span><span style="color:#8b5cf6;font-weight:700;">${fmt(o.tournamentEarnings)}</span></div>
            <div class="bmg-admin-earn-row"><span>Total Earned</span><span style="color:#111;font-weight:800;">${fmt(totalEarned)}</span></div>
            <div class="bmg-admin-earn-row"><span>Already Transferred</span><span style="color:#10b981;font-weight:700;">${fmt(o.transfersPaid)} (${o.transferCount} payment${o.transferCount !== 1 ? 's' : ''})</span></div>
            <div class="bmg-admin-earn-row" style="background:#fef3c7;padding:8px;border-radius:8px;margin-top:4px;"><span><strong>Amount Still Owed</strong></span><span style="color:${netOwed > 0 ? '#d97706' : '#10b981'};font-weight:800;font-size:15px;">${fmt(Math.max(0, netOwed))}</span></div>
            ${netOwed > 0 ? `
              <button class="bmg-transfer-btn" onclick="window.bmgAdminTransferPayment('${o.ownerId}', '${o.ownerName}', ${Math.round(netOwed)})">
                <i class="fas fa-paper-plane"></i> Mark Payment Done (${fmt(netOwed)})
              </button>` : '<div style="color:#10b981;font-size:13px;margin-top:8px;font-weight:600;"><i class="fas fa-check-circle"></i> Fully Paid</div>'}
          </div>`;
        }).join('')}
      `;

    } catch (err) {
      console.error('[BMG F6] loadAdminOwnerEarnings error:', err);
      container.innerHTML = '<p style="text-align:center;color:#ef4444;">Failed to load. Please retry.</p>';
    }
  };

  /** Admin clicks "Mark Payment Done" — records transfer in Firestore */
  window.bmgAdminTransferPayment = async function (ownerId, ownerName, suggestedAmount) {
    const _db = db();
    const cu  = window.currentUser;
    if (!_db || !cu) return;

    // Show inline input modal
    const existing = document.getElementById('bmg-transfer-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'bmg-transfer-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px;';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:20px;max-width:360px;width:100%;padding:28px 24px;box-shadow:0 24px 64px rgba(0,0,0,.25);">
        <h3 style="margin:0 0 4px;font-size:18px;font-weight:800;">Mark Payment Done</h3>
        <p style="font-size:13px;color:#6b7280;margin:0 0 20px;">to <strong>${ownerName || ownerId}</strong></p>
        <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:6px;">Amount Transferred (₹)</label>
        <input id="bmg-transfer-amount" type="number" value="${suggestedAmount || 0}" min="1"
          style="width:100%;padding:12px;border:2px solid #e5e7eb;border-radius:12px;font-size:16px;font-weight:700;margin-bottom:14px;box-sizing:border-box;">
        <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:6px;">Payment Method</label>
        <select id="bmg-transfer-method" style="width:100%;padding:10px;border:2px solid #e5e7eb;border-radius:12px;font-size:14px;margin-bottom:14px;box-sizing:border-box;">
          <option value="UPI">UPI</option><option value="NEFT">NEFT</option><option value="IMPS">IMPS</option><option value="Cash">Cash</option><option value="Other">Other</option>
        </select>
        <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:6px;">Note / Transaction ID (optional)</label>
        <input id="bmg-transfer-note" type="text" placeholder="e.g. UTR1234567890"
          style="width:100%;padding:10px;border:2px solid #e5e7eb;border-radius:12px;font-size:13px;margin-bottom:20px;box-sizing:border-box;">
        <div style="display:flex;gap:10px;">
          <button onclick="document.getElementById('bmg-transfer-modal').remove();" 
            style="flex:1;padding:12px;background:#f3f4f6;color:#374151;border:none;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;">Cancel</button>
          <button id="bmg-transfer-confirm-btn"
            style="flex:2;padding:12px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;">
            Confirm Payment Done ✓
          </button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    document.getElementById('bmg-transfer-confirm-btn').addEventListener('click', async () => {
      const amt    = Number(document.getElementById('bmg-transfer-amount')?.value || 0);
      const method = document.getElementById('bmg-transfer-method')?.value || 'UPI';
      const note   = document.getElementById('bmg-transfer-note')?.value || '';

      if (!amt || amt <= 0) { toast('Please enter a valid amount', 'error'); return; }

      const btn = document.getElementById('bmg-transfer-confirm-btn');
      btn.textContent = 'Processing…'; btn.disabled = true;

      try {
        const now = FS().serverTimestamp();
        const transferDoc = {
          ownerId,
          ownerName    : ownerName || '',
          amount       : amt,
          method,
          note,
          description  : note || `Payment transfer via ${method}`,
          status       : 'paid',
          paidAt       : now,
          paidBy       : cu.uid,
          paidByName   : cu.name || cu.displayName || cu.email || 'Admin',
          paidByEmail  : cu.email || '',
          adminRole    : cu.role || 'admin',
          createdAt    : now,
          updatedAt    : now,
        };

        // Write to owner_payments collection (F5 reads from this)
        await _db.collection('owner_payments').add(transferDoc);

        // Also write to payout_requests as paid entry for audit trail
        await _db.collection('payout_requests').add({
          ...transferDoc,
          requestId  : `ADMIN-${Date.now()}`,
          type       : 'admin_direct_transfer',
          bookingIds : [],
        });

        modal.remove();
        toast(`✅ Payment of ${fmt(amt)} recorded for ${ownerName || 'owner'}`, 'success', 5000);

        // Refresh the admin earnings table
        const adminContainer = document.getElementById('admin-owner-earnings-container');
        if (adminContainer) await window.loadAdminOwnerEarnings(adminContainer);

      } catch (err) {
        console.error('[BMG F6] transfer error:', err);
        toast('Failed to record payment. Please try again.', 'error');
        btn.textContent = 'Confirm Payment Done ✓'; btn.disabled = false;
      }
    });

    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  };

  /* ════════════════════════════════════════════════════════════════════
   * INJECT ADMIN EARNINGS TAB into admin dashboard
   * ════════════════════════════════════════════════════════════════════ */

  function _injectAdminEarningsTab() {
    // Try to inject a tab into the admin dashboard tabs list
    const adminTabList = document.querySelector('.admin-tabs, .admin-nav-tabs, [id*="admin-tabs"]');
    if (!adminTabList) return;
    if (document.getElementById('admin-owner-earnings-tab')) return; // already added

    const tab = document.createElement('button');
    tab.id = 'admin-owner-earnings-tab';
    tab.className = 'admin-tab-btn';
    tab.style.cssText = 'padding:10px 16px;background:none;border:none;cursor:pointer;font-size:13px;font-weight:600;color:#6b7280;border-bottom:2px solid transparent;';
    tab.innerHTML = '<i class="fas fa-chart-bar"></i> Owner Earnings';
    tab.addEventListener('click', async () => {
      // Create or find container
      let earningsContainer = document.getElementById('admin-owner-earnings-container');
      if (!earningsContainer) {
        const mainContent = document.querySelector('.admin-main-content, .admin-content, [id*="admin-content"]');
        if (!mainContent) return;
        // Hide other panels
        mainContent.querySelectorAll('[id*="-panel"], [id*="-container"]').forEach(el => el.style.display = 'none');
        earningsContainer = document.createElement('div');
        earningsContainer.id = 'admin-owner-earnings-container';
        mainContent.appendChild(earningsContainer);
      } else {
        earningsContainer.style.display = 'block';
      }
      await window.loadAdminOwnerEarnings(earningsContainer);
    });
    adminTabList.appendChild(tab);
    console.log('[BMG F6] ✅ Admin earnings tab injected');
  }

  /* ════════════════════════════════════════════════════════════════════
   * TOURNAMENT QR SCANNER VERIFICATION for owner
   * ════════════════════════════════════════════════════════════════════
   * Owner scans the tournament QR; we verify the entry is valid
   * ──────────────────────────────────────────────────────────────────── */

  waitFor('processVerifiedQRCode', (origFn) => {
    window.processVerifiedQRCode = async function (qrData) {
      let qrObj;
      try { qrObj = JSON.parse(qrData); } catch (_) { return origFn(qrData); }

      // If it's a tournament QR, handle it ourselves
      if (qrObj.type !== 'tournament') return origFn(qrData);

      const { registrationId, tournamentId, userName, teamName, tournamentName, sport, date, venue, amount } = qrObj;
      const _db = db();

      if (!_db) { toast('Database not ready', 'error'); return; }

      try {
        const entryDoc = await _db.collection('tournament_entries').doc(registrationId).get();

        if (!entryDoc.exists) {
          toast('❌ Entry not found. QR may be invalid.', 'error', 5000);
          return;
        }

        const entry = entryDoc.data();

        if (entry.status !== 'confirmed') {
          toast(`❌ Entry status: ${entry.status}. Not confirmed.`, 'error', 5000);
          return;
        }

        if (entry.entryUsed) {
          const usedAt = entry.entryUsedAt?.toDate?.()?.toLocaleString('en-IN') || 'earlier';
          toast(`⚠️ Entry already used at ${usedAt}`, 'warning', 6000);
          return;
        }

        // Mark as used
        await _db.collection('tournament_entries').doc(registrationId).update({
          entryUsed  : true,
          entryUsedAt: FS().serverTimestamp(),
          verifiedBy : window.currentUser?.uid || '',
        });

        // Show success verification panel
        const panel = document.createElement('div');
        panel.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;padding:16px;';
        panel.innerHTML = `
          <div style="background:#fff;border-radius:20px;max-width:360px;width:100%;padding:28px 20px;text-align:center;box-shadow:0 32px 80px rgba(0,0,0,.3);">
            <div style="width:72px;height:72px;background:linear-gradient(135deg,#10b981,#059669);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
              <i class="fas fa-check-circle" style="color:#fff;font-size:32px;"></i>
            </div>
            <h2 style="font-size:20px;font-weight:800;color:#065f46;margin:0 0 4px;">Entry Verified ✓</h2>
            <p style="color:#6b7280;font-size:13px;margin:0 0 18px;">Tournament QR code is valid</p>
            <div style="background:#f0fdf4;border-radius:12px;padding:14px;text-align:left;margin-bottom:18px;font-size:13px;color:#374151;">
              <p style="margin:4px 0;"><strong>Tournament:</strong> ${tournamentName || ''}</p>
              <p style="margin:4px 0;"><strong>Player:</strong> ${userName || entry.userName || ''}</p>
              ${teamName ? `<p style="margin:4px 0;"><strong>Team:</strong> ${teamName}</p>` : ''}
              ${sport  ? `<p style="margin:4px 0;"><strong>Sport:</strong> ${sport}</p>` : ''}
              ${date   ? `<p style="margin:4px 0;"><strong>Date:</strong> ${date}</p>` : ''}
              ${venue  ? `<p style="margin:4px 0;"><strong>Venue:</strong> ${venue}</p>` : ''}
              <p style="margin:4px 0;"><strong>Entry Fee Paid:</strong> ${fmt(amount || entry.amount)}</p>
            </div>
            <button onclick="this.closest('[style*=fixed]').remove();"
              style="width:100%;padding:14px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:14px;font-size:15px;font-weight:700;cursor:pointer;">
              Done
            </button>
          </div>`;
        document.body.appendChild(panel);
        panel.addEventListener('click', e => { if (e.target === panel) panel.remove(); });

      } catch (err) {
        console.error('[BMG QR] Tournament verification error:', err);
        toast('Error verifying QR. Please try again.', 'error');
      }
    };

    console.log('[BMG QR] ✅ processVerifiedQRCode patched for tournament entries');
  });

  /* ════════════════════════════════════════════════════════════════════
   * INIT — Run patches when DOM + Firebase are ready
   * ════════════════════════════════════════════════════════════════════ */

  function _init() {
    _patchMyBookingsPage();
    _injectAdminEarningsTab();
    console.log('✅ [bmg_master_fix_v2] All patches active');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(_init, 300));
  } else {
    setTimeout(_init, 300);
  }

  // Re-run admin tab injection when admin dashboard is shown
  window.addEventListener('bmg:pageShown', (e) => {
    if (e.detail?.pageId?.includes('admin')) {
      setTimeout(_injectAdminEarningsTab, 200);
    }
  });

  /* ════════════════════════════════════════════════════════════════════
   * LOAD ORDER REMINDER (in index.html):
   *
   *   <script src="paymentService.js"></script>
   *   <script src="app.js"></script>
   *   <script src="bmg_auth_fix.js"></script>
   *   <script src="bmg_fix_canaddground.js"></script>
   *   <script src="bmg_cf_bypass.js"></script>
   *   <script src="bmg_master_fix_v2.js"></script>   ← LAST
   *
   * ════════════════════════════════════════════════════════════════════ */

  console.log('✅ [bmg_master_fix_v2.js] Loaded — 6-feature comprehensive fix active');

})();