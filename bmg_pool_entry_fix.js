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
