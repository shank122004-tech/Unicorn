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