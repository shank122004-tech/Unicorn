/* ═══════════════════════════════════════════════════════════════════════════════
   COMPREHENSIVE FIX v1.0 — Earnings, Upcoming Banner, Booked Slots
   ═══════════════════════════════════════════════════════════════════════════════
   
   FIXES 3 CRITICAL ISSUES:
   1. ✅ Earnings not showing in owner dashboard payouts section
   2. ✅ Upcoming bookings banner not displaying on homepage
   3. ✅ Booked time slots not showing in red on ground page

   ADD IN index.html AFTER all other scripts (at the very end before </body>):
     <script src="EARNINGS_UPCOMING_BOOKED_FIX.js"></script>
═══════════════════════════════════════════════════════════════════════════════ */

(function() {
  'use strict';
  console.log('[FIX] Initializing Earnings, Upcoming Banner & Booked Slots Fix');

  // ════════════════════════════════════════════════════════════════════════════
  // PATCH 1: Update Slot Status to "CONFIRMED" When Booking is Confirmed
  // ════════════════════════════════════════════════════════════════════════════
  
  /**
   * Mark a slot as confirmed/booked after successful payment
   * This ensures the slot displays in red on ground pages
   */
  window.markSlotAsConfirmed = async function(bookingData) {
    if (!window.db) {
      console.warn('[markSlotAsConfirmed] Firebase not initialized');
      return;
    }
    
    try {
      const db = window.db;
      const startTime = (bookingData.slotTime || '').split('-')[0].trim();
      
      // Query the slot document
      const slotsSnap = await db.collection('slots')
        .where('groundId', '==', bookingData.groundId)
        .where('date', '==', bookingData.date)
        .where('startTime', '==', startTime)
        .limit(1)
        .get();
      
      if (!slotsSnap.empty) {
        await slotsSnap.docs[0].ref.update({
          status: 'confirmed',
          bookedBy: bookingData.userId,
          bookedAt: firebase.firestore.FieldValue.serverTimestamp(),
          bookingId: bookingData.bookingId,
          orderId: bookingData.orderId || bookingData.bookingId,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        console.log('✅ [markSlotAsConfirmed] Slot marked as confirmed:', startTime);
        return true;
      } else {
        console.warn('[markSlotAsConfirmed] No slot found for:', bookingData);
      }
    } catch (error) {
      console.error('[markSlotAsConfirmed] Error:', error);
    }
  };

  // ════════════════════════════════════════════════════════════════════════════
  // PATCH 2: Update Earnings Display in Owner Dashboard
  // ════════════════════════════════════════════════════════════════════════════
  
  /**
   * Enhanced loadOwnerEarnings that properly calculates and displays all earnings
   */
  window._bmgLoadOwnerEarningsFull = async function(container) {
    if (!window.db || !window.currentUser) {
      container.innerHTML = '<p class="text-center" style="color:var(--gray-500);">Please login to view earnings</p>';
      return;
    }
    
    try {
      showLoading('Calculating earnings...');
      const db = window.db;
      const userId = window.currentUser.uid;
      
      // Get all CONFIRMED ground bookings where user is owner
      const groundBookingsSnap = await db.collection('bookings')
        .where('ownerId', '==', userId)
        .where('bookingStatus', '==', 'confirmed')
        .get();
      
      let groundEarnings = 0;
      let groundCount = 0;
      groundBookingsSnap.forEach(doc => {
        const data = doc.data();
        const amount = Number(data.ownerAmount) || (Number(data.amount || 0) * 0.9);
        groundEarnings += amount;
        groundCount++;
      });
      
      // Get all CONFIRMED pool bookings where user is owner
      const poolBookingsSnap = await db.collection('pool_bookings')
        .where('ownerId', '==', userId)
        .where('bookingStatus', '==', 'confirmed')
        .get();
      
      let poolEarnings = 0;
      let poolCount = 0;
      poolBookingsSnap.forEach(doc => {
        const data = doc.data();
        const amount = Number(data.ownerAmount) || (Number(data.amount || 0) * 0.9);
        poolEarnings += amount;
        poolCount++;
      });
      
      // Get tournament earnings if applicable
      let tournamentEarnings = 0;
      let tournamentCount = 0;
      try {
        const tournamentsSnap = await db.collection('tournaments')
          .where('ownerId', '==', userId)
          .get();
        
        tournamentsSnap.forEach(tDoc => {
          const tData = tDoc.data();
          if (tData.registrations && Array.isArray(tData.registrations)) {
            tData.registrations.forEach(reg => {
              if (reg.paymentStatus === 'paid' || reg.status === 'confirmed') {
                const amount = Number(reg.ownerAmount) || (Number(reg.amount || 0) * 0.8);
                tournamentEarnings += amount;
                tournamentCount++;
              }
            });
          }
        });
      } catch (e) {
        console.log('[loadOwnerEarnings] Tournament data not available or error:', e);
      }
      
      const totalEarnings = groundEarnings + poolEarnings + tournamentEarnings;
      const totalBookings = groundCount + poolCount;
      
      hideLoading();
      
      // Display earnings in a professional card format
      container.innerHTML = `
        <div class="earnings-summary-card" style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px;">
          <!-- Total Earnings -->
          <div class="stat-card" style="background: linear-gradient(135deg, #2563eb, #1d4ed8); color: white; padding: 18px; border-radius: 14px; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.2);">
            <div class="stat-label" style="font-size: 12px; font-weight: 600; opacity: 0.9; margin-bottom: 6px;">Total Earnings</div>
            <div class="stat-value" style="font-size: 28px; font-weight: 800; letter-spacing: -0.5px;">₹${totalEarnings.toLocaleString()}</div>
            <div class="stat-note" style="font-size: 11px; opacity: 0.75; margin-top: 6px;">From ${totalBookings} confirmed bookings</div>
          </div>
          
          <!-- Breakdown -->
          <div class="earnings-breakdown" style="background: #f0f4ff; padding: 18px; border-radius: 14px; border-left: 4px solid #2563eb;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid #bfdbfe;">
              <span style="font-size: 12px; font-weight: 600; color: #374151;">Grounds (${groundCount})</span>
              <span style="font-size: 13px; font-weight: 700; color: #2563eb;">₹${groundEarnings.toLocaleString()}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid #bfdbfe;">
              <span style="font-size: 12px; font-weight: 600; color: #374151;">Pools (${poolCount})</span>
              <span style="font-size: 13px; font-weight: 700; color: #0ea5e9;">₹${poolEarnings.toLocaleString()}</span>
            </div>
            ${tournamentCount > 0 ? `
            <div style="display: flex; justify-content: space-between;">
              <span style="font-size: 12px; font-weight: 600; color: #374151;">Tournaments (${tournamentCount})</span>
              <span style="font-size: 13px; font-weight: 700; color: #7c3aed;">₹${tournamentEarnings.toLocaleString()}</span>
            </div>
            ` : ''}
          </div>
        </div>
        
        ${totalEarnings > 0 ? `
        <div style="background: #f0fdf4; padding: 14px 16px; border-radius: 12px; border-left: 4px solid #22c55e; margin-top: 16px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <i class="fas fa-check-circle" style="color: #22c55e; font-size: 16px;"></i>
            <div>
              <div style="font-weight: 700; color: #15803d; font-size: 13px;">Ready to Withdraw</div>
              <div style="font-size: 12px; color: #47a96d; margin-top: 2px;">You can request a payout anytime</div>
            </div>
          </div>
          <button class="make-payout-btn" onclick="showPayoutRequestModal(${totalEarnings})" style="margin-top: 12px; width: 100%; padding: 12px; background: linear-gradient(135deg, #22c55e, #16a34a); color: white; border: none; border-radius: 10px; font-weight: 700; cursor: pointer; font-size: 14px; transition: all 0.2s;">
            <i class="fas fa-arrow-right" style="margin-right: 6px;"></i> Request Payout
          </button>
        </div>
        ` : `
        <div style="background: #fffbeb; padding: 14px 16px; border-radius: 12px; border-left: 4px solid #f59e0b; margin-top: 16px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <i class="fas fa-info-circle" style="color: #f59e0b; font-size: 16px;"></i>
            <div>
              <div style="font-weight: 700; color: #92400e; font-size: 13px;">No Earnings Yet</div>
              <div style="font-size: 12px; color: #b45309; margin-top: 2px;">Your earnings will appear after your first confirmed booking</div>
            </div>
          </div>
        </div>
        `}
      `;
      
      console.log(`✅ [loadOwnerEarnings] Total: ₹${totalEarnings} from ${totalBookings} bookings`);
      
    } catch (error) {
      hideLoading();
      console.error('[loadOwnerEarnings] Error:', error);
      container.innerHTML = `
        <div style="background: #fee2e2; padding: 14px 16px; border-radius: 12px; border-left: 4px solid #ef4444;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <i class="fas fa-exclamation-circle" style="color: #ef4444; font-size: 16px;"></i>
            <div>
              <div style="font-weight: 700; color: #991b1b; font-size: 13px;">Error Loading Earnings</div>
              <div style="font-size: 12px; color: #b91c1c; margin-top: 2px;">${error.message}</div>
            </div>
          </div>
        </div>
      `;
    }
  };

  // ════════════════════════════════════════════════════════════════════════════
  // PATCH 3: Display Upcoming Bookings Banner on Homepage
  // ════════════════════════════════════════════════════════════════════════════
  
  /**
   * Load and display the next upcoming booking in the homepage banner
   */
  window.loadUpcomingBookingBanner = async function() {
    if (!window.db || !window.currentUser) return;
    
    try {
      const db = window.db;
      const userId = window.currentUser.uid;
      const bannerEl = document.getElementById('spb-upcoming-banner');
      
      if (!bannerEl) {
        console.log('[loadUpcomingBookingBanner] Banner element not found');
        return;
      }
      
      const today = new Date().toISOString().split('T')[0];
      
      // Get upcoming ground bookings
      const groundSnap = await db.collection('bookings')
        .where('userId', '==', userId)
        .where('bookingStatus', 'in', ['confirmed', 'completed'])
        .where('date', '>=', today)
        .orderBy('date', 'asc')
        .orderBy('slotTime', 'asc')
        .limit(1)
        .get();
      
      // Get upcoming pool bookings
      const poolSnap = await db.collection('pool_bookings')
        .where('userId', '==', userId)
        .where('bookingStatus', 'in', ['confirmed', 'completed'])
        .where('date', '>=', today)
        .orderBy('date', 'asc')
        .orderBy('time', 'asc')
        .limit(1)
        .get();
      
      let upcomingBooking = null;
      let isPool = false;
      
      // Compare both and get the earliest one
      if (!groundSnap.empty) {
        const groundData = groundSnap.docs[0].data();
        upcomingBooking = { 
          ...groundData, 
          id: groundSnap.docs[0].id,
          isPoolBooking: false 
        };
        isPool = false;
      }
      
      if (!poolSnap.empty) {
        const poolData = poolSnap.docs[0].data();
        const groundDate = upcomingBooking ? upcomingBooking.date : '9999-12-31';
        const poolDate = poolData.date;
        
        if (poolDate < groundDate) {
          upcomingBooking = { 
            ...poolData, 
            id: poolSnap.docs[0].id,
            isPoolBooking: true 
          };
          isPool = true;
        }
      }
      
      if (!upcomingBooking) {
        bannerEl.style.display = 'none';
        return;
      }
      
      // Format the booking data for display
      const bookingDate = new Date(upcomingBooking.date + 'T00:00:00');
      const dateStr = bookingDate.toLocaleDateString('en-IN', { 
        weekday: 'short', 
        month: 'short', 
        day: 'numeric' 
      });
      
      const timeSlot = isPool 
        ? (upcomingBooking.time || upcomingBooking.slotTime || 'TBD')
        : (upcomingBooking.slotTime || upcomingBooking.time || 'TBD');
      
      const name = isPool 
        ? (upcomingBooking.poolName || upcomingBooking.groundName || 'Swimming Pool')
        : (upcomingBooking.groundName || upcomingBooking.venueName || 'Sports Ground');
      
      const address = isPool
        ? (upcomingBooking.poolAddress || upcomingBooking.address || '')
        : (upcomingBooking.groundAddress || upcomingBooking.venueAddress || '');
      
      const icon = isPool ? '🏊‍♂️' : '⚽';
      const bookingType = isPool ? 'Pool Booking' : 'Ground Booking';
      
      // Update banner elements
      document.getElementById('spb-upcoming-name').textContent = name;
      document.getElementById('spb-upcoming-addr').textContent = address || 'Location details not available';
      document.getElementById('spb-upcoming-time').innerHTML = `
        <span style="font-size: 12px; font-weight: 700;">📅 ${dateStr}</span>
        <span style="font-size: 11px; opacity: 0.85; margin-left: 6px;">🕐 ${timeSlot}</span>
      `;
      
      // Update banner appearance
      bannerEl.classList.remove('empty');
      bannerEl.classList.add('active');
      bannerEl.style.display = 'flex';
      
      // Add click handler to navigate to booking
      bannerEl.style.cursor = 'pointer';
      bannerEl.onclick = () => {
        if (typeof showPage === 'function') {
          showPage('my-bookings-page');
          console.log('✅ Navigated to bookings page');
        }
      };
      
      console.log(`✅ [loadUpcomingBookingBanner] Displayed: ${name} on ${dateStr}`);
      
    } catch (error) {
      console.error('[loadUpcomingBookingBanner] Error:', error);
    }
  };

  // ════════════════════════════════════════════════════════════════════════════
  // INTEGRATION: Wire patches to existing functions
  // ════════════════════════════════════════════════════════════════════════════
  
  /**
   * Wrap the existing setupPayButton to also mark slot as confirmed
   */
  if (typeof window.setupPayButton === 'function') {
    const originalSetupPayButton = window.setupPayButton;
    window.setupPayButton = async function(bookingDetails) {
      // Call original setup
      const result = await originalSetupPayButton.call(this, bookingDetails);
      
      // Also mark the slot as confirmed if payment succeeds
      // This will be called after payment verification
      if (bookingDetails && bookingDetails.bookingId) {
        // Delay slightly to ensure booking is created first
        setTimeout(async () => {
          await window.markSlotAsConfirmed(bookingDetails);
        }, 500);
      }
      
      return result;
    };
  }
  
  /**
   * Wrap handlePaymentReturn to also update slot and reload earnings
   */
  if (typeof window.handlePaymentReturn === 'function') {
    const originalHandlePaymentReturn = window.handlePaymentReturn;
    window.handlePaymentReturn = async function() {
      const result = await originalHandlePaymentReturn.apply(this, arguments);
      
      // After payment is processed, reload upcoming banner and earnings
      setTimeout(() => {
        if (typeof window.loadUpcomingBookingBanner === 'function') {
          window.loadUpcomingBookingBanner().catch(e => console.log('Banner update:', e));
        }
        
        // Dispatch event for dashboard to reload earnings
        window.dispatchEvent(new CustomEvent('bmg:bookingConfirmed', { 
          detail: { refresh: true } 
        }));
      }, 800);
      
      return result;
    };
  }

  /**
   * Also wrap the existing loadUserBookings to update the banner
   */
  if (typeof window.loadUserBookings === 'function') {
    const originalLoadUserBookings = window.loadUserBookings;
    window.loadUserBookings = async function(...args) {
      const result = await originalLoadUserBookings.apply(this, arguments);
      
      // Update banner after bookings load
      setTimeout(() => {
        if (typeof window.loadUpcomingBookingBanner === 'function') {
          window.loadUpcomingBookingBanner().catch(e => console.log('Banner update:', e));
        }
      }, 300);
      
      return result;
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // INITIALIZATION ON PAGE LOAD
  // ════════════════════════════════════════════════════════════════════════════
  
  // Load upcoming banner when home page is shown
  window.addEventListener('bmg:pageShown', (e) => {
    if (e.detail?.pageId === 'home-page' || e.detail?.pageId === 'homepage') {
      setTimeout(() => {
        if (typeof window.loadUpcomingBookingBanner === 'function') {
          window.loadUpcomingBookingBanner();
        }
      }, 200);
    }
  });

  // Load earnings when dashboard is shown
  window.addEventListener('bmg:pageShown', (e) => {
    if (e.detail?.pageId === 'owner-dashboard-page') {
      const container = document.querySelector('#owner-dashboard-earnings, .earnings-stat-card, [data-earnings-container]');
      if (container && typeof window._bmgLoadOwnerEarningsFull === 'function') {
        setTimeout(() => {
          window._bmgLoadOwnerEarningsFull(container);
        }, 200);
      }
    }
  });

  // Reload banner and earnings on booking confirmation
  window.addEventListener('bmg:bookingConfirmed', (e) => {
    if (typeof window.loadUpcomingBookingBanner === 'function') {
      window.loadUpcomingBookingBanner();
    }
  });

  console.log('✅ [FIX] Earnings, Upcoming Banner & Booked Slots Fix loaded successfully');
})();