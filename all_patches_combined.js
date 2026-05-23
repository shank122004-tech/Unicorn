/* ═══════════════════════════════════════════════════════════════════
   all_patches_combined.js
   ─────────────────────────────────────────────────────────────────
   COMBINED from (in load order):
     1. city_filter_patch.js         — city state, bar UI, loader patching, signup patch
     2. swimming_pool_city_fix.js    — hardened pool loader (supersedes city_filter pool loader)
     3. city_reload_fix.js           — loadMainPage override so window.* patched loaders are called
     4. sportobook_ui_fixes.js       — disable GPS, featured city filter, remove pool cancel buttons
     5. bmg_pool_qr_scanner_fix.js   — QR scanner fix for pool_entry type
     6. bmg_premium_features.js      — premium plans, badges, CEO revenue tab
     7. bookings_layout_patch.js     — bookings UI with tabs (Upcoming / Past / Pool Passes)
     8. owner_listing_verification_patch.js — property images verification, add pool owner flow
     9. payout_system_patch.js       — full payout request & admin approval system

   FILES NOT TOUCHED (kept standalone):
     • app.js
     • paymentService.js
     • sportobook_patches_merged.js
     • bmg_fixes_combined.js

   CONFLICT RESOLUTIONS:
     • loadBmgFeaturedGrounds: city_filter_patch.js and sportobook_ui_fixes.js both
       patched this. sportobook's version is more complete (address-text fallback).
       Only sportobook's version is kept; city_filter's featured patch is removed.
     • loadBmgPoolSection: city_filter_patch.js patched it first; swimming_pool_city_fix.js
       supersedes it with a hardened dual-query loader. The intermediate city_filter version
       is dropped; only the hardened v2 loader runs.
     • bmgSetCity wrappers: city_reload_fix.js and sportobook_ui_fixes.js both wrap
       bmgSetCity. Merged into a single wrapper that does both cache-busting and
       featured-grounds reload.
     • _bmgCityPoolPatched flag: swimming_pool_city_fix waits for this flag. In the
       combined file the flag is set immediately after the city_filter loaders section
       so the hardened loader installs without delay.

   INSTALL: Replace all individual <script> tags with ONE tag:
     <script src="all_patches_combined.js"></script>
   Place it AFTER app.js, paymentService.js, sportobook_patches_merged.js,
   bmg_fixes_combined.js — at the very end of <body>.
═══════════════════════════════════════════════════════════════════ */

'use strict';

/* ╔══════════════════════════════════════════════════════════════════╗
   ║  SECTION 1 — CITY FILTER PATCH                                  ║
   ║  (from city_filter_patch.js)                                    ║
   ╚══════════════════════════════════════════════════════════════════╝ */
(function () {
    'use strict';

    /* ══════════════════════════════════════════════════════════
       CITY STATE
    ══════════════════════════════════════════════════════════ */
    var LS_KEY        = 'bmg_active_city';
    var LS_DISP_KEY   = 'bmg_active_city_display';
    var activeCity    = '';
    var activeCityDisplay = '';

    function getActiveCity()    { return activeCity; }
    function getActiveCityDisp(){ return activeCityDisplay; }

    function setActiveCity(cityRaw) {
        if (!cityRaw) return;
        activeCity        = cityRaw.trim().toLowerCase();
        activeCityDisplay = toTitleCase(cityRaw.trim());
        localStorage.setItem(LS_KEY,      activeCity);
        localStorage.setItem(LS_DISP_KEY, activeCityDisplay);
        updateCityBar();
        /* Ensure loaders are patched before reloading, then trigger refresh */
        patchLoaders();
        reloadHome();
        /* Also reload the pool section directly in case loadMainPage doesn't cover it */
        if (typeof window.loadBmgPoolSection === 'function') {
            setTimeout(function () {
                window.loadBmgPoolSection().catch(function (e) {
                    console.warn('[city-filter] pool reload error:', e);
                });
            }, 120);
        }
    }

    function loadCityFromStorage() {
        var c = localStorage.getItem(LS_KEY);
        var d = localStorage.getItem(LS_DISP_KEY);
        if (c) { activeCity = c; activeCityDisplay = d || toTitleCase(c); }
    }

    function toTitleCase(str) {
        return str.replace(/\w\S*/g, function(txt) {
            return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
        });
    }

    /* ══════════════════════════════════════════════════════════
       LOAD CITY FROM FIRESTORE (on login)
    ══════════════════════════════════════════════════════════ */
    function watchForUser() {
        var check = setInterval(function () {
            var user = window.currentUser;
            if (!user || !user.uid) return;
            clearInterval(check);
            if (activeCity) { updateCityBar(); return; }
            var db = window.db;
            if (!db) return;
            db.collection('users').doc(user.uid).get()
              .then(function (doc) {
                if (doc.exists) {
                    var data = doc.data();
                    var city = data.city || data.userCity || '';
                    if (city) setActiveCity(city);
                }
              })
              .catch(function (e) { console.warn('[city filter] Could not load user city', e); });
        }, 400);
    }

    /* ══════════════════════════════════════════════════════════
       CITY BAR UI
    ══════════════════════════════════════════════════════════ */
    function buildCityBar() {
        if (document.getElementById('bmg-city-bar')) return;
        var locBar = document.querySelector('#main-page .location-bar, .location-bar');
        if (!locBar) return;

        var bar = document.createElement('div');
        bar.id = 'bmg-city-bar';
        bar.className = 'bmg-city-bar';
        bar.innerHTML =
            '<div class="bmg-city-bar-left">' +
              '<i class="fas fa-city bmg-city-icon"></i>' +
              '<span class="bmg-city-label">Showing results in</span>' +
              '<span class="bmg-city-name" id="bmg-city-name">—</span>' +
            '</div>' +
            '<button class="bmg-city-change-btn" id="bmg-city-change-btn">' +
              '<i class="fas fa-exchange-alt"></i> Change City' +
            '</button>';

        locBar.parentNode.insertBefore(bar, locBar.nextSibling);
        document.getElementById('bmg-city-change-btn')
          .addEventListener('click', openCityModal);
        updateCityBar();
    }

    function updateCityBar() {
        var el = document.getElementById('bmg-city-name');
        if (el) el.textContent = activeCityDisplay || 'All Cities';
        var bar = document.getElementById('bmg-city-bar');
        if (bar) {
            bar.classList.remove('bmg-city-bar--pulse');
            void bar.offsetWidth;
            bar.classList.add('bmg-city-bar--pulse');
        }
    }

    /* ══════════════════════════════════════════════════════════
       CITY SEARCH MODAL
    ══════════════════════════════════════════════════════════ */
    function buildCityModal() {
        if (document.getElementById('bmg-city-modal')) return;

        var modal = document.createElement('div');
        modal.id = 'bmg-city-modal';
        modal.className = 'bmg-city-modal-overlay';
        modal.innerHTML =
            '<div class="bmg-city-modal">' +
              '<div class="bmg-city-modal-header">' +
                '<div class="bmg-city-modal-title">' +
                  '<i class="fas fa-map-marker-alt"></i> Choose Your City' +
                '</div>' +
                '<button class="bmg-city-modal-close" id="bmg-city-modal-close">' +
                  '<i class="fas fa-times"></i>' +
                '</button>' +
              '</div>' +
              '<div class="bmg-city-search-wrap">' +
                '<i class="fas fa-search bmg-city-search-icon"></i>' +
                '<input type="text" id="bmg-city-search-input" class="bmg-city-search-input"' +
                  ' placeholder="Search city name..." autocomplete="off">' +
              '</div>' +
              '<div class="bmg-city-results" id="bmg-city-results">' +
                '<div class="bmg-city-loading"><div class="loader-spinner"></div></div>' +
              '</div>' +
              '<div class="bmg-city-modal-footer">' +
                '<button class="bmg-city-all-btn" id="bmg-city-all-btn">' +
                  '🌍 Show All Cities' +
                '</button>' +
              '</div>' +
            '</div>';

        document.body.appendChild(modal);

        document.getElementById('bmg-city-modal-close').addEventListener('click', closeCityModal);
        modal.addEventListener('click', function (e) {
            if (e.target === modal) closeCityModal();
        });
        document.getElementById('bmg-city-all-btn').addEventListener('click', function () {
            activeCity = '';
            activeCityDisplay = 'All Cities';
            localStorage.removeItem(LS_KEY);
            localStorage.removeItem(LS_DISP_KEY);
            closeCityModal();
            updateCityBar();
            patchLoaders();
            reloadHome();
            if (typeof window.loadBmgPoolSection === 'function') {
                setTimeout(function () {
                    window.loadBmgPoolSection().catch(function (e) {
                        console.warn('[city-filter] pool reload error:', e);
                    });
                }, 120);
            }
        });

        var searchInput = document.getElementById('bmg-city-search-input');
        var debounceTimer;
        searchInput.addEventListener('input', function () {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(function () {
                filterCityList(searchInput.value.trim().toLowerCase());
            }, 200);
        });
    }

    var allCities = [];

    function openCityModal() {
        buildCityModal();
        var modal = document.getElementById('bmg-city-modal');
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        fetchAvailableCities();
        setTimeout(function () {
            var inp = document.getElementById('bmg-city-search-input');
            if (inp) inp.focus();
        }, 300);
    }

    function closeCityModal() {
        var modal = document.getElementById('bmg-city-modal');
        if (modal) modal.classList.remove('active');
        document.body.style.overflow = '';
    }

    async function fetchAvailableCities() {
        if (allCities.length) { renderCityList(allCities); return; }
        var db = window.db;
        if (!db) return;
        try {
            var results = await Promise.all([
                db.collection('grounds').where('status', '==', 'active').get()
                  .catch(function () { return { docs: [] }; }),
                db.collection('swimming_pools').where('status', '==', 'active').get()
                  .catch(function () { return { docs: [] }; })
            ]);
            var groundSnap = results[0];
            var poolSnap   = results[1];
            var cityMap = {};
            groundSnap.docs.forEach(function (d) {
                var c = (d.data().city || '').trim().toLowerCase();
                if (c) cityMap[c] = (cityMap[c] || 0) + 1;
            });
            poolSnap.docs.forEach(function (d) {
                var c = (d.data().city || '').trim().toLowerCase();
                if (c) cityMap[c] = (cityMap[c] || 0) + 1;
            });
            allCities = Object.keys(cityMap)
                .sort(function (a, b) { return cityMap[b] - cityMap[a]; })
                .map(function (c) { return { city: c, count: cityMap[c] }; });
            renderCityList(allCities);
        } catch (e) {
            var res = document.getElementById('bmg-city-results');
            if (res) res.innerHTML = '<div class="bmg-city-error">Could not load cities</div>';
        }
    }

    function renderCityList(list) {
        var res = document.getElementById('bmg-city-results');
        if (!res) return;
        if (!list.length) {
            res.innerHTML = '<div class="bmg-city-empty">No cities found</div>';
            return;
        }
        res.innerHTML = list.map(function (item) {
            var isActive = item.city === activeCity;
            return (
                '<div class="bmg-city-item' + (isActive ? ' bmg-city-item--active' : '') + '"' +
                  ' data-city="' + item.city + '">' +
                  '<i class="fas fa-map-marker-alt bmg-city-item-icon"></i>' +
                  '<span class="bmg-city-item-name">' + toTitleCase(item.city) + '</span>' +
                  '<span class="bmg-city-item-count">' + item.count + ' venues</span>' +
                  (isActive ? '<i class="fas fa-check bmg-city-item-check"></i>' : '') +
                '</div>'
            );
        }).join('');
        res.querySelectorAll('.bmg-city-item').forEach(function (el) {
            el.addEventListener('click', function () {
                setActiveCity(el.getAttribute('data-city'));
                closeCityModal();
            });
        });
    }

    function filterCityList(query) {
        var filtered = query
            ? allCities.filter(function (i) { return i.city.indexOf(query) !== -1; })
            : allCities;
        renderCityList(filtered);
    }

    /* ══════════════════════════════════════════════════════════
       CITY FILTERING HELPER
    ══════════════════════════════════════════════════════════ */
    function matchesCity(doc) {
        if (!activeCity) return true;
        var c = (doc.city || '').trim().toLowerCase();
        return c === activeCity;
    }

    /* ══════════════════════════════════════════════════════════
       PATCH HOME PAGE LOADERS
       NOTE: loadBmgPoolSection is NOT patched here — the hardened
       dual-query version in Section 2 supersedes it entirely.
       NOTE: loadBmgFeaturedGrounds is NOT patched here — Section 4
       (sportobook_ui_fixes) provides a more complete version.
    ══════════════════════════════════════════════════════════ */
    function patchLoaders() {

        /* ── 1. loadBmgGroundsGrid ── */
        if (typeof window.loadBmgGroundsGrid === 'function' && !window._bmgCityGridPatched) {
            var origGrid = window.loadBmgGroundsGrid;
            window.loadBmgGroundsGrid = async function () {
                if (!activeCity) return origGrid.apply(this, arguments);
                var grid = document.getElementById('bmg-grounds-grid');
                if (!grid) return origGrid.apply(this, arguments);
                try {
                    var db   = window.db;
                    var COLL = window.COLLECTIONS || {};
                    var results = await Promise.all([
                        db.collection(COLL.VENUES || 'venues').where('hidden', '==', false).get(),
                        db.collection(COLL.GROUNDS || 'grounds').where('status', '==', 'active').get()
                    ]);
                    var vSnap = results[0];
                    var gSnap = results[1];
                    var items = [];
                    vSnap.forEach(function (d) {
                        var data = d.data();
                        if (matchesCity(data)) items.push(Object.assign({ id: d.id, type: 'venue' }, data));
                    });
                    gSnap.forEach(function (d) {
                        var data = d.data();
                        if (matchesCity(data)) items.push(Object.assign({ id: d.id, type: 'ground' }, data));
                    });
                    if (!items.length) {
                        grid.innerHTML = '<div class="bmg-city-no-results">' +
                          '<div class="bmg-city-no-results-icon">🏟️</div>' +
                          '<div class="bmg-city-no-results-text">No grounds found in <strong>' + activeCityDisplay + '</strong></div>' +
                          '<button class="bmg-city-try-change-btn" onclick="document.getElementById(\'bmg-city-change-btn\').click()">' +
                          '<i class="fas fa-exchange-alt"></i> Change City</button>' +
                          '</div>';
                        return;
                    }
                    var escFn = window.escapeHtml || function(s){ return s; };
                    grid.innerHTML = items.map(function (item) {
                        var isGround = item.type === 'ground';
                        var name  = isGround ? (item.groundName || 'Ground') : (item.venueName || 'Venue');
                        var img   = (item.images && item.images[0]) ? item.images[0] : 'https://placehold.co/150x150/e5e7eb/9ca3af?text=Ground';
                        var sport = item.sportType || 'Multi-sport';
                        var loc   = item.groundAddress || item.address || item.city || 'Location';
                        var price = item.pricePerHour ? '₹' + item.pricePerHour : (isGround ? '₹--' : null);
                        var dataAttr = isGround ? 'data-ground-id="' + item.id + '"' : 'data-venue-id="' + item.id + '"';
                        return (
                            '<div class="bmg-grid-ground-card" ' + dataAttr + ' data-type="' + item.type + '">' +
                              '<div class="bmg-grid-img-wrap">' +
                                '<img src="' + img + '" alt="' + escFn(name) + '" loading="lazy" onerror="this.src=\'https://placehold.co/150x150/e5e7eb/9ca3af?text=Ground\'">' +
                                '<span class="bmg-grid-sport-tag">' + escFn(sport) + '</span>' +
                              '</div>' +
                              '<div class="bmg-grid-info">' +
                                (price ? '<div class="bmg-grid-price-block"><span class="bmg-grid-price">' + price + '</span><span class="bmg-grid-per-hr">/hr</span></div>' : '') +
                                '<div class="bmg-grid-name">' + escFn(name) + '</div>' +
                                '<div class="bmg-grid-loc">📍 ' + escFn(loc) + '</div>' +
                              '</div>' +
                              '<button class="bmg-grid-book-btn" data-id="' + item.id + '" data-type="' + item.type + '">Book Now</button>' +
                            '</div>'
                        );
                    }).join('');
                    grid.querySelectorAll('.bmg-grid-ground-card').forEach(function (card) {
                        card.addEventListener('click', function (e) {
                            if (e.target.classList.contains('bmg-grid-book-btn')) return;
                            if (card.dataset.groundId && window.viewGround) window.viewGround(card.dataset.groundId);
                            else if (card.dataset.venueId && window.viewVenue) window.viewVenue(card.dataset.venueId);
                        });
                    });
                    grid.querySelectorAll('.bmg-grid-book-btn').forEach(function (btn) {
                        btn.addEventListener('click', function (e) {
                            e.stopPropagation();
                            if (btn.dataset.type === 'ground' && window.viewGround) window.viewGround(btn.dataset.id);
                            else if (window.viewVenue) window.viewVenue(btn.dataset.id);
                        });
                    });
                } catch (err) {
                    console.error('[city filter] grid error', err);
                    origGrid.apply(this, arguments);
                }
            };
            window._bmgCityGridPatched = true;
        }

        /* ── 2. loadBmgDealsSection ── */
        if (typeof window.loadBmgDealsSection === 'function' && !window._bmgCityDealsPatched) {
            var origDeals = window.loadBmgDealsSection;
            window.loadBmgDealsSection = async function () {
                if (!activeCity) return origDeals.apply(this, arguments);
                await origDeals.apply(this, arguments);
                ['bmg-deals-row-99', 'bmg-deals-row-299'].forEach(function (rowId) {
                    var row = document.getElementById(rowId);
                    if (!row) return;
                    row.querySelectorAll('[data-city]').forEach(function (card) {
                        var c = (card.getAttribute('data-city') || '').toLowerCase();
                        if (c && c !== activeCity) card.remove();
                    });
                });
            };
            window._bmgCityDealsPatched = true;
        }

        /* ── 3. loadNearbyVenues ── */
        if (typeof window.loadNearbyVenues === 'function' && !window._bmgCityNearbyPatched) {
            var origNearby = window.loadNearbyVenues;
            window.loadNearbyVenues = async function () {
                if (!activeCity) return origNearby.apply(this, arguments);
                var container = document.getElementById('nearby-venues');
                if (!container) return origNearby.apply(this, arguments);
                try {
                    var db   = window.db;
                    var COLL = window.COLLECTIONS || {};
                    var results = await Promise.all([
                        db.collection(COLL.VENUES || 'venues').where('hidden', '==', false).get(),
                        db.collection(COLL.GROUNDS || 'grounds').where('status', '==', 'active').get()
                    ]);
                    var vSnap = results[0];
                    var gSnap = results[1];
                    var items = [];
                    vSnap.forEach(function (d) {
                        var data = d.data();
                        if (matchesCity(data)) items.push(Object.assign({ id: d.id, type: 'venue' }, data));
                    });
                    gSnap.forEach(function (d) {
                        var data = d.data();
                        if (matchesCity(data)) items.push(Object.assign({ id: d.id, type: 'ground', ownerType: 'plot_owner' }, data));
                    });
                    if (typeof window.displayVenueItems === 'function') {
                        window.displayVenueItems(container, items.slice(0, 6));
                    }
                } catch (err) {
                    origNearby.apply(this, arguments);
                }
            };
            window._bmgCityNearbyPatched = true;
        }

        /* ── Pool section is intentionally NOT patched here.
              Section 2 (swimming_pool_city_fix) installs the final hardened
              loader and sets _bmgCityPoolPatched = true itself. ── */
    }

    function reloadHome() {
        var mainPage = document.getElementById('main-page');
        if (!mainPage || !mainPage.classList.contains('active')) return;
        if (typeof window.loadMainPage === 'function') window.loadMainPage();
    }

    /* ══════════════════════════════════════════════════════════
       PATCH SIGNUP — save city to Firestore
    ══════════════════════════════════════════════════════════ */
    function patchSignup() {
        if (window._bmgCitySignupPatched) return;
        if (typeof window.handleUserRegister !== 'function') {
            setTimeout(patchSignup, 400); return;
        }
        var origReg = window.handleUserRegister;
        window.handleUserRegister = async function (e) {
            var cityInput = document.getElementById('reg-city');
            var cityVal   = cityInput ? cityInput.value.trim() : '';
            await origReg.apply(this, arguments);
            if (cityVal) {
                var user = window.currentUser || (window.auth && window.auth().currentUser);
                var uid  = user && user.uid;
                if (uid && window.db) {
                    window.db.collection('users').doc(uid).update({ city: cityVal }).catch(function(){});
                    setActiveCity(cityVal);
                }
            }
        };
        window._bmgCitySignupPatched = true;
    }

    /* Public: update user profile city in Firestore */
    window.bmgUpdateUserCity = function (newCity) {
        var user = window.currentUser;
        if (!user || !user.uid || !window.db) return;
        window.db.collection('users').doc(user.uid)
          .update({ city: newCity, updatedAt: firebase.firestore.FieldValue.serverTimestamp() })
          .then(function () { setActiveCity(newCity); })
          .catch(function (e) { console.error('[city filter] update city error', e); });
    };

    /* ══════════════════════════════════════════════════════════
       INITIALISE
    ══════════════════════════════════════════════════════════ */
    function init() {
        loadCityFromStorage();
        function tryBuildBar() {
            var mainPage = document.getElementById('main-page');
            if (mainPage && (mainPage.classList.contains('active') || document.readyState === 'complete')) {
                buildCityBar();
            }
        }
        var mainPage = document.getElementById('main-page');
        if (mainPage) {
            new MutationObserver(function (muts) {
                muts.forEach(function (m) {
                    if (m.attributeName === 'class' && mainPage.classList.contains('active')) {
                        buildCityBar();
                    }
                });
            }).observe(mainPage, { attributes: true });
        }
        tryBuildBar();
        function doPatch() {
            patchLoaders();
            if (!window._bmgCityGridPatched) setTimeout(doPatch, 400);
        }
        doPatch();
        patchSignup();
        watchForUser();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    /* Public API — used by other sections below */
    window.bmgSetCity = setActiveCity;
    window.bmgGetCity = getActiveCity;

    console.log('[city filter] loaded');

})();

/* ══════════════════════════════════════════════════════════
   SIGNUP CITY AUTOCOMPLETE
   (from city_filter_patch.js — second IIFE)
══════════════════════════════════════════════════════════ */
(function () {
    function buildCityAutocomplete() {
        var input = document.getElementById('reg-city');
        var sug   = document.getElementById('reg-city-suggestions');
        if (!input || !sug) return;
        var debounce;
        input.addEventListener('input', function () {
            clearTimeout(debounce);
            var val = input.value.trim().toLowerCase();
            if (!val || val.length < 2) { sug.style.display = 'none'; return; }
            debounce = setTimeout(function () {
                if (!window.db) return;
                window.db.collection('grounds').where('status', '==', 'active').get()
                  .then(function (snap) {
                    var seen = {};
                    snap.forEach(function (d) {
                        var c = (d.data().city || '').trim();
                        if (c && c.toLowerCase().indexOf(val) !== -1) seen[c.toLowerCase()] = c;
                    });
                    var cities = Object.values(seen).slice(0, 6);
                    if (!cities.length) { sug.style.display = 'none'; return; }
                    sug.innerHTML = cities.map(function (c) {
                        return '<div class="reg-city-sug-item" data-city="' + c + '">' +
                               '<i class="fas fa-map-marker-alt"></i> ' + c + '</div>';
                    }).join('');
                    sug.style.display = 'block';
                    sug.querySelectorAll('.reg-city-sug-item').forEach(function (el) {
                        el.addEventListener('click', function () {
                            input.value = el.getAttribute('data-city');
                            sug.style.display = 'none';
                        });
                    });
                  });
            }, 300);
        });
        input.addEventListener('blur', function () {
            setTimeout(function () { sug.style.display = 'none'; }, 200);
        });
    }

    function watchRegPanel() {
        var panel = document.getElementById('register-panel');
        if (!panel) return;
        new MutationObserver(function () { buildCityAutocomplete(); })
          .observe(panel, { attributes: true, attributeFilter: ['class', 'style'] });
        buildCityAutocomplete();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', watchRegPanel);
    } else {
        watchRegPanel();
    }
})();


/* ╔══════════════════════════════════════════════════════════════════╗
   ║  SECTION 2 — SWIMMING POOL CITY FIX (HARDENED POOL LOADER)     ║
   ║  (from swimming_pool_city_fix.js)                               ║
   ║  Supersedes city_filter_patch's loadBmgPoolSection wrapper.     ║
   ╚══════════════════════════════════════════════════════════════════╝ */
(function () {
    'use strict';

    var _capturedCity = '';

    function log(m)  { console.log('[pool-city-fix] ' + m); }
    function warn(m) { console.warn('[pool-city-fix] ' + m); }

    function normalise(str) { return (str || '').trim().toLowerCase(); }

    function cityMatch(doc, activeCity) {
        if (!activeCity) return true;
        var ac = normalise(activeCity);
        var c1 = normalise(doc.city);
        var c2 = normalise(doc.cityLower);
        var c3 = normalise(doc.address);
        var c4 = normalise(doc.groundAddress);
        return c1 === ac || c2 === ac ||
               c3.indexOf(ac) !== -1 || c4.indexOf(ac) !== -1;
    }

    /* ── FIX 1: Capture city at form-submit BEFORE form is reset ── */
    function installCityCapture() {
        var form = document.getElementById('add-ground-form');
        if (!form) { setTimeout(installCityCapture, 300); return; }
        form.addEventListener('submit', function () {
            var cityEl = document.getElementById('ground-city-input');
            _capturedCity = cityEl ? cityEl.value.trim() : '';
            log('FIX 1 — Captured city "' + _capturedCity + '" before form submit');
        }, true);
        log('FIX 1 — City capture listener installed on add-ground-form');
    }

    /* ── FIX 2: Re-patch handleAddGround to use captured city ── */
    function repatchHandleAddGround() {
        var fn = window.handleAddGround;
        if (!fn) { setTimeout(repatchHandleAddGround, 300); return; }
        if (fn._v2CityFixed) return;

        var prev = window.handleAddGround;
        window.handleAddGround = async function (e) {
            await prev.apply(this, arguments);
            if (!_capturedCity) return;
            var cityRaw   = _capturedCity;
            var cityLower = cityRaw.toLowerCase();
            try {
                var db   = window.db;
                var user = window.currentUser;
                if (!db || !user) return;
                var snap = await db.collection('grounds')
                  .where('ownerId',   '==', user.uid)
                  .where('sportType', '==', 'swimming')
                  .orderBy('createdAt', 'desc')
                  .limit(1)
                  .get();
                if (snap.empty) return;
                var groundDoc  = snap.docs[0];
                var groundId   = groundDoc.id;
                var groundData = groundDoc.data();
                if (!groundData.city || groundData.city === '') {
                    await db.collection('grounds').doc(groundId).update({ city: cityRaw, cityLower: cityLower });
                    log('FIX 2 — Backfilled city "' + cityRaw + '" on grounds/' + groundId);
                }
                var poolSnap = await db.collection('swimming_pools')
                  .where('groundRef', '==', groundId).limit(1).get();
                if (!poolSnap.empty) {
                    var poolDoc  = poolSnap.docs[0];
                    var poolData = poolDoc.data();
                    if (!poolData.city || poolData.city === '') {
                        await db.collection('swimming_pools').doc(poolDoc.id).update({ city: cityRaw, cityLower: cityLower });
                        log('FIX 2 — Backfilled city "' + cityRaw + '" on swimming_pools/' + poolDoc.id);
                    }
                } else {
                    var newPoolDoc = {
                        groundRef          : groundId,
                        poolName           : groundData.groundName   || 'Swimming Pool',
                        basePricePerMember : groundData.pricePerHour || 0,
                        maxMembersPerSlot  : 20,
                        address            : groundData.groundAddress || '',
                        city               : cityRaw,
                        cityLower          : cityLower,
                        images             : groundData.images || [],
                        ownerId            : user.uid,
                        ownerName          : user.displayName || user.name || '',
                        status             : 'active',
                        createdAt          : firebase.firestore.FieldValue.serverTimestamp(),
                        updatedAt          : firebase.firestore.FieldValue.serverTimestamp(),
                        amenities          : groundData.amenities || []
                    };
                    await db.collection('swimming_pools').add(newPoolDoc);
                    log('FIX 2 — Created swimming_pools doc for grounds/' + groundId + ' with city "' + cityRaw + '"');
                }
                if (typeof window.loadBmgPoolSection === 'function') {
                    setTimeout(function () { window.loadBmgPoolSection().catch(function () {}); }, 600);
                }
                _capturedCity = '';
            } catch (err) {
                warn('FIX 2 — Could not fix pool city: ' + err.message);
            }
        };
        window.handleAddGround._v2CityFixed = true;
        window.handleAddGround._poolPatched  = true;
        log('FIX 2 — handleAddGround re-patched (city-aware)');
    }

    function trackLastSport() {
        var sel = document.getElementById('ground-sport-input');
        if (!sel) { setTimeout(trackLastSport, 400); return; }
        sel.addEventListener('change', function () { sel.dataset.lastSport = sel.value; });
    }

    /* ── FIX 3: Hardened pool loader (dual-query + city-fallback) ── */
    function installHardenedPoolLoader() {
        if (window._bmgPoolLoaderV2) return;

        function _esc(s) {
            return String(s || '')
              .replace(/&/g,'&amp;').replace(/</g,'&lt;')
              .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        }

        function _fallbackCard(pool) {
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
              '</div>';
            return card;
        }

        window.loadBmgPoolSection = async function () {
            var activeCity = normalise(localStorage.getItem('bmg_active_city') || '');
            var activeCityDisplay = localStorage.getItem('bmg_active_city_display') || activeCity;

            var row      = document.getElementById('bmg-pool-scroll-row');
            var emptyMsg = document.getElementById('bmg-pool-empty');
            if (!row) return;

            if (!activeCity) {
                /* No filter — run whatever was on window before (original app.js loader).
                   Since we're the final installer, just query all active pools. */
                try {
                    var db    = window.db;
                    var PCOLL = window.POOL_COLLECTIONS || { POOLS: 'swimming_pools' };
                    var snap  = await db.collection(PCOLL.POOLS).where('status', '==', 'active').get();
                    row.innerHTML = '';
                    if (emptyMsg) emptyMsg.style.display = snap.empty ? 'block' : 'none';
                    var today = new Date().toISOString().split('T')[0];
                    for (var i = 0; i < snap.docs.length; i++) {
                        var data = snap.docs[i].data();
                        data.id  = snap.docs[i].id;
                        var card = typeof window.buildPoolHomeCard === 'function'
                            ? await window.buildPoolHomeCard(data, today)
                            : _fallbackCard(data);
                        row.appendChild(card);
                    }
                } catch (e) {
                    warn('No-filter pool load error: ' + e.message);
                }
                return;
            }

            /* Show skeleton */
            row.innerHTML =
                '<div class="bmg-pool-card-skeleton"></div>' +
                '<div class="bmg-pool-card-skeleton"></div>' +
                '<div class="bmg-pool-card-skeleton"></div>';

            try {
                var db    = window.db;
                var PCOLL = window.POOL_COLLECTIONS || { POOLS: 'swimming_pools' };
                var seen  = {};
                var pools = [];

                /* Source 1: swimming_pools collection */
                try {
                    var snap1 = await db.collection(PCOLL.POOLS).where('status', '==', 'active').get();
                    snap1.forEach(function (d) {
                        var data = d.data();
                        if (cityMatch(data, activeCity)) {
                            seen[data.groundRef || d.id] = true;
                            pools.push(Object.assign({ id: d.id }, data));
                        }
                    });
                } catch (e) { warn('FIX 3 — swimming_pools query error: ' + e.message); }

                /* Source 2: grounds collection (sport=swimming) */
                try {
                    var snap2 = await db.collection('grounds')
                        .where('sportType', '==', 'swimming')
                        .where('status',    '==', 'active')
                        .get();
                    snap2.forEach(function (d) {
                        if (seen[d.id]) return;
                        var g = d.data();
                        if (!cityMatch(g, activeCity)) return;
                        pools.push({
                            id                 : d.id,
                            _fromGrounds       : true,
                            groundRef          : d.id,
                            poolName           : g.groundName   || 'Swimming Pool',
                            basePricePerMember : g.pricePerHour || 0,
                            maxMembersPerSlot  : 20,
                            address            : g.groundAddress || g.address || '',
                            city               : g.city || g.cityLower || '',
                            cityLower          : normalise(g.city || g.cityLower || ''),
                            images             : g.images || [],
                            ownerId            : g.ownerId || '',
                            ownerName          : g.ownerName || '',
                            status             : 'active',
                            amenities          : g.amenities || []
                        });
                    });
                } catch (e) { warn('FIX 3 — grounds/swimming query error: ' + e.message); }

                row.innerHTML = '';

                if (!pools.length) {
                    if (emptyMsg) {
                        emptyMsg.style.display = 'block';
                        emptyMsg.innerHTML =
                          '<span>🏊</span>' +
                          '<p>No swimming pools in <strong>' + activeCityDisplay + '</strong></p>' +
                          '<small onclick="document.getElementById(\'bmg-city-change-btn\').click()" ' +
                            'style="cursor:pointer;color:#0ea5e9;font-weight:700;">Change City →</small>';
                    }
                    log('FIX 3 — No pools found for city "' + activeCity + '"');
                    return;
                }

                if (emptyMsg) emptyMsg.style.display = 'none';
                var today = new Date().toISOString().split('T')[0];
                for (var i = 0; i < pools.length; i++) {
                    try {
                        var card = typeof window.buildPoolHomeCard === 'function'
                            ? await window.buildPoolHomeCard(pools[i], today)
                            : _fallbackCard(pools[i]);
                        row.appendChild(card);
                    } catch (ce) { warn('FIX 3 — card build error: ' + ce.message); }
                }
                log('FIX 3 — Rendered ' + pools.length + ' pool(s) for city "' + activeCity + '"');

            } catch (err) {
                warn('FIX 3 — Pool section error: ' + err.message);
                row.innerHTML = '';
                if (emptyMsg) emptyMsg.style.display = 'block';
            }
        };

        window._bmgPoolLoaderV2    = true;
        window._bmgCityPoolPatched = true;   /* Signal that city_reload_fix can proceed */
        log('FIX 3 — Hardened pool loader installed (dual-query + city fallback)');
    }

    /* ── FIX 4: Backfill utility for existing docs missing city ── */
    window.bmgBackfillPoolCities = async function () {
        var db = window.db;
        if (!db) { console.error('[pool-city-fix] db not available'); return 0; }
        log('BACKFILL — scanning swimming_pools for missing city…');
        var poolSnap = await db.collection('swimming_pools').get();
        var fixed = 0;
        for (var i = 0; i < poolSnap.docs.length; i++) {
            var pDoc  = poolSnap.docs[i];
            var pData = pDoc.data();
            if (pData.city && pData.city !== '') continue;
            var gRef = pData.groundRef;
            if (!gRef) { warn('BACKFILL — pool ' + pDoc.id + ' has no groundRef'); continue; }
            var gDoc = await db.collection('grounds').doc(gRef).get();
            if (!gDoc.exists) { warn('BACKFILL — grounds/' + gRef + ' not found'); continue; }
            var gCity = (gDoc.data().city || gDoc.data().cityLower || '').trim();
            if (!gCity) { warn('BACKFILL — grounds/' + gRef + ' also has no city'); continue; }
            await db.collection('swimming_pools').doc(pDoc.id).update({ city: gCity, cityLower: gCity.toLowerCase() });
            if (!gDoc.data().cityLower) {
                await db.collection('grounds').doc(gRef).update({ cityLower: gCity.toLowerCase() });
            }
            log('BACKFILL — Fixed swimming_pools/' + pDoc.id + ' city = "' + gCity + '"');
            fixed++;
        }
        var gSnap = await db.collection('grounds').where('sportType', '==', 'swimming').get();
        for (var j = 0; j < gSnap.docs.length; j++) {
            var gd = gSnap.docs[j];
            var existing = await db.collection('swimming_pools').where('groundRef', '==', gd.id).limit(1).get();
            if (!existing.empty) continue;
            var g    = gd.data();
            var city = (g.city || g.cityLower || '').trim();
            if (!city) { warn('BACKFILL — grounds/' + gd.id + ' has no city, skipping mirror'); continue; }
            await db.collection('swimming_pools').add({
                groundRef          : gd.id,
                poolName           : g.groundName    || 'Swimming Pool',
                basePricePerMember : g.pricePerHour  || 0,
                maxMembersPerSlot  : 20,
                address            : g.groundAddress || '',
                city               : city,
                cityLower          : city.toLowerCase(),
                images             : g.images    || [],
                ownerId            : g.ownerId   || '',
                ownerName          : g.ownerName || '',
                status             : 'active',
                amenities          : g.amenities || [],
                createdAt          : firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt          : firebase.firestore.FieldValue.serverTimestamp()
            });
            log('BACKFILL — Mirrored grounds/' + gd.id + ' to swimming_pools with city "' + city + '"');
            fixed++;
        }
        log('BACKFILL — Done. Fixed/created ' + fixed + ' document(s).');
        return fixed;
    };

    /* ── BOOT ── */
    function boot() {
        installCityCapture();
        trackLastSport();

        /* FIX 2 — wait until handleAddGround has been patched by bmg_fixes_combined */
        var t2 = setInterval(function () {
            var fn = window.handleAddGround;
            if (!fn) return;
            if (fn._v2CityFixed) { clearInterval(t2); return; }
            if (fn._poolPatched || fn._cityFixed) {
                clearInterval(t2);
                repatchHandleAddGround();
            }
        }, 200);

        /* FIX 3 — install hardened pool loader immediately (no wait needed
           since we're in combined file and city_filter section above did NOT
           patch loadBmgPoolSection) */
        installHardenedPoolLoader();

        log('Boot complete. For existing pools: run  await window.bmgBackfillPoolCities()  in console.');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

})();


/* ╔══════════════════════════════════════════════════════════════════╗
   ║  SECTION 3 — CITY RELOAD FIX                                   ║
   ║  (from city_reload_fix.js)                                     ║
   ║  Replaces window.loadMainPage so all city-sensitive sections   ║
   ║  are called via window.* patched loaders (not local closures). ║
   ╚══════════════════════════════════════════════════════════════════╝ */
(function () {
    'use strict';

    function log(m)  { console.log('[city-reload-fix] ' + m); }
    function warn(m) { console.warn('[city-reload-fix] ' + m); }

    /* ── Step 1: Hook bmgSetCity for cache busting ── */
    function hookCityChange() {
        /* NOTE: bmgSetCity is also wrapped in Section 4 for featured-grounds reload.
           Both wrappers are chained safely because each stores _origSet separately. */
        var _origSet = window.bmgSetCity;
        window.bmgSetCity = function (cityRaw) {
            bustCaches();
            if (typeof _origSet === 'function') _origSet.apply(this, arguments);
        };

        var _lastCity = localStorage.getItem('bmg_active_city') || '';
        window.addEventListener('storage', function (e) {
            if (e.key === 'bmg_active_city' && e.newValue !== _lastCity) {
                _lastCity = e.newValue || '';
                bustCaches();
                log('Cache busted via storage event (city → "' + _lastCity + '")');
            }
        });
    }

    function bustCaches() {
        if (!window._bmgCacheClear) return;
        ['bmgGroundsGrid', 'bmgDeals', 'bmgNearby', 'bmgFeatured',
         'bmgGrounds', 'bmgPools', 'nearbyVenues'].forEach(function (k) {
            window._bmgCacheClear(k);
        });
        log('HTML caches cleared for city change');
    }

    /* ── Step 2: Replace window.loadMainPage ── */
    function waitAndInstall(tries) {
        tries = tries || 0;
        var ready =
            typeof window.loadMainPage       === 'function' &&
            typeof window.loadBmgPoolSection === 'function' &&
            typeof window.loadBmgGroundsGrid === 'function' &&
            typeof window.loadNearbyVenues   === 'function' &&
            window._bmgCityPoolPatched === true;

        if (!ready) {
            if (tries > 60) { warn('Timed out waiting for patches — city reload may not work'); return; }
            setTimeout(function () { waitAndInstall(tries + 1); }, 200);
            return;
        }
        installLoadMainPagePatch();
    }

    function installLoadMainPagePatch() {
        if (window._cityReloadFixed) return;

        var _prevLoadMainPage = window.loadMainPage;

        window.loadMainPage = async function () {
            log('loadMainPage → routing city-sensitive sections through window.* patched loaders');
            try {
                var cityJobs = [
                    run('loadBmgGroundsGrid'),
                    run('loadNearbyVenues'),
                    run('loadBmgDealsSection'),
                    run('loadBmgFeaturedGrounds'),
                ];
                await Promise.all(cityJobs);

                if (typeof window.loadBmgPoolSection === 'function') {
                    window.loadBmgPoolSection().catch(function (e) {
                        warn('loadBmgPoolSection error: ' + e.message);
                    });
                }

                if (typeof _prevLoadMainPage === 'function') {
                    var stubbed = stubWindowLoaders([
                        'loadBmgGroundsGrid', 'loadNearbyVenues',
                        'loadBmgDealsSection', 'loadBmgFeaturedGrounds',
                        'loadBmgPoolSection'
                    ]);
                    try {
                        await _prevLoadMainPage.apply(this, arguments);
                    } finally {
                        restoreWindowLoaders(stubbed);
                    }
                }
            } catch (err) {
                console.error('[city-reload-fix] loadMainPage error:', err);
            }
        };

        window._cityReloadFixed = true;
        log('✅ loadMainPage patched — city changes now update all sections instantly');
    }

    function run(fnName) {
        if (typeof window[fnName] !== 'function') return Promise.resolve();
        return window[fnName]().catch(function (e) {
            warn(fnName + ' error: ' + e.message);
        });
    }

    function stubWindowLoaders(names) {
        var saved = {};
        names.forEach(function (n) {
            if (typeof window[n] === 'function') {
                saved[n] = window[n];
                window[n] = function () { return Promise.resolve(); };
            }
        });
        return saved;
    }

    function restoreWindowLoaders(saved) {
        Object.keys(saved).forEach(function (n) { window[n] = saved[n]; });
    }

    function boot() {
        hookCityChange();
        waitAndInstall();
        log('Boot — waiting for all patches to settle…');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

})();


/* ╔══════════════════════════════════════════════════════════════════╗
   ║  SECTION 4 — SPORTOBOOK UI FIXES                                ║
   ║  (from sportobook_ui_fixes.js)                                  ║
   ║  1. Disable auto GPS location detection                         ║
   ║  2. Featured grounds city filter (complete version w/ address   ║
   ║     fallback — replaces city_filter_patch featured patch)       ║
   ║  3. Remove Cancel button from pool pass cards                   ║
   ╚══════════════════════════════════════════════════════════════════╝ */
(function () {
    'use strict';

    var LOG = '[sportobook-ui-fixes]';
    function log(m)  { console.log(LOG + ' ' + m); }
    function warn(m) { console.warn(LOG + ' ' + m); }

    /* ── FIX 1: Disable auto GPS location detection ── */
    function disableGeoLocation() {
        window.getUserLocation = function () {
            log('getUserLocation() suppressed — using city-selector only');
        };

        function hideLocationBar() {
            var bar = document.querySelector('.location-bar');
            if (bar) { bar.style.display = 'none'; log('location-bar hidden'); }
            var refreshBtn = document.getElementById('refresh-location');
            if (refreshBtn) refreshBtn.style.display = 'none';
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', hideLocationBar);
        } else {
            hideLocationBar();
        }
        setTimeout(hideLocationBar, 800);
        setTimeout(hideLocationBar, 2000);
        log('Auto location detection disabled');
    }

    /* ── FIX 2: Featured grounds city filter (complete version) ── */
    function patchFeaturedGrounds() {
        var installed = false;

        function doInstall() {
            if (installed) return;
            if (typeof window.loadBmgFeaturedGrounds !== 'function') return;

            var _orig = window.loadBmgFeaturedGrounds;

            window.loadBmgFeaturedGrounds = async function () {
                var activeCity = '';
                if (typeof window.bmgGetCity === 'function') {
                    activeCity = (window.bmgGetCity() || '').trim().toLowerCase();
                }
                if (!activeCity) {
                    activeCity = (localStorage.getItem('bmg_active_city') || '').trim().toLowerCase();
                }

                await _orig.apply(this, arguments);

                if (!activeCity) {
                    log('[featured] No active city set — showing all featured grounds');
                    return;
                }

                var scroll  = document.getElementById('bmg-featured-scroll');
                var section = document.getElementById('bmg-featured-section');
                if (!scroll) return;

                var cards   = scroll.querySelectorAll('.bmg-feat-card');
                var visible = 0;

                cards.forEach(function (card) {
                    var addrEl  = card.querySelector('.bmg-feat-addr');
                    var addrTxt = addrEl ? addrEl.textContent.toLowerCase() : '';
                    var datCity = (card.getAttribute('data-city') || '').toLowerCase();

                    var match = datCity
                        ? datCity === activeCity
                        : addrTxt.indexOf(activeCity) !== -1;

                    if (match) { card.style.display = ''; visible++; }
                    else        card.style.display = 'none';
                });

                if (section) section.style.display = visible === 0 ? 'none' : '';
                log('[featured] City filter applied: "' + activeCity + '" — ' + visible + '/' + cards.length + ' cards visible');
            };

            installed = true;
            log('loadBmgFeaturedGrounds patched for city filtering');
        }

        doInstall();
        if (!installed) {
            var tries = 0;
            var iv = setInterval(function () {
                doInstall();
                if (installed || ++tries > 60) clearInterval(iv);
            }, 300);
        }
    }

    /* Re-run loadBmgFeaturedGrounds on city change.
       NOTE: city_reload_fix (Section 3) already calls loadBmgFeaturedGrounds
       as part of loadMainPage. This hook fires for direct bmgSetCity calls
       that happen outside of loadMainPage (e.g., city modal selections). */
    function hookFeaturedOnCityChange() {
        function wrapBmgSetCity() {
            if (window.__featuredCityHooked) return;
            if (typeof window.bmgSetCity !== 'function') return;

            var _orig = window.bmgSetCity;
            window.bmgSetCity = function (cityRaw) {
                _orig.apply(this, arguments);
                setTimeout(function () {
                    if (typeof window.loadBmgFeaturedGrounds === 'function') {
                        window.loadBmgFeaturedGrounds().catch(function(){});
                    }
                }, 300);
            };
            window.__featuredCityHooked = true;
            log('bmgSetCity hooked for featured-grounds reload');
        }

        wrapBmgSetCity();
        if (!window.__featuredCityHooked) {
            var tries = 0;
            var iv = setInterval(function () {
                wrapBmgSetCity();
                if (window.__featuredCityHooked || ++tries > 60) clearInterval(iv);
            }, 300);
        }
    }

    /* ── FIX 3: Remove Cancel button from pool pass cards ── */
    function removePoolCancelButtons() {
        var style = document.createElement('style');
        style.id  = 'fix-pool-no-cancel';
        style.textContent = [
            '/* sportobook_ui_fixes: hide Cancel btn on pool pass cards */',
            '.bmg-pool-card .bmg-cancel-btn {',
            '  display: none !important;',
            '}',
        ].join('\n');
        document.head.appendChild(style);
        log('Pool cancel-button CSS injected');

        function purgePoolCancelBtns(root) {
            var poolCards = (root || document).querySelectorAll('.bmg-pool-card');
            poolCards.forEach(function (card) {
                var cancelBtns = card.querySelectorAll('.bmg-cancel-btn');
                cancelBtns.forEach(function (btn) { btn.remove(); });
            });
        }

        var bookingsPanel = document.getElementById('bmg-panel-pools') ||
                            document.getElementById('bookings-page');
        if (bookingsPanel) {
            var obs = new MutationObserver(function () { purgePoolCancelBtns(bookingsPanel); });
            obs.observe(bookingsPanel, { childList: true, subtree: true });
            log('MutationObserver watching pool panel for cancel buttons');
        } else {
            var obs2 = new MutationObserver(function () { purgePoolCancelBtns(); });
            obs2.observe(document.body, { childList: true, subtree: true });
        }
        purgePoolCancelBtns();
    }

    /* ── BOOT ── */
    function boot() {
        disableGeoLocation();
        patchFeaturedGrounds();
        hookFeaturedOnCityChange();
        removePoolCancelButtons();
        log('All fixes applied');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

})();


/* ╔══════════════════════════════════════════════════════════════════╗
   ║  SECTION 5 — POOL QR SCANNER FIX                               ║
   ║  (from bmg_pool_qr_scanner_fix.js)                             ║
   ╚══════════════════════════════════════════════════════════════════╝ */
(function () {
    'use strict';

    var POOL_TYPES = ['pool', 'pool_booking', 'pool_entry'];

    function normaliseQR(obj) {
        if (!obj) return obj;
        if (!obj.appId && obj.app)   obj.appId = obj.app;
        if (!obj.app   && obj.appId) obj.app   = obj.appId;
        return obj;
    }

    async function verifyPoolEntryQR(qrObject) {
        var db          = window.db;
        var currentUser = window.currentUser || (window.auth && window.auth.currentUser);
        if (!currentUser) throw new Error('Please log in to verify pool entries');

        var bookingId = qrObject.bookingId || qrObject.orderId;
        if (!bookingId) throw new Error('Invalid pool QR code — missing booking ID');

        var poolDoc = null;
        var tries = [
            function () { return db.collection('pool_bookings').doc(bookingId).get(); },
            function () { return db.collection('pool_bookings').where('bookingId', '==', bookingId).limit(1).get()
                            .then(function (s) { return s.empty ? null : s.docs[0]; }); },
            function () { return db.collection('pool_bookings').where('orderId', '==', bookingId).limit(1).get()
                            .then(function (s) { return s.empty ? null : s.docs[0]; }); },
        ];

        for (var i = 0; i < tries.length; i++) {
            try {
                var res = await tries[i]();
                if (res && res.exists) { poolDoc = res; break; }
            } catch (e) { /* permission or not-found — try next */ }
        }

        if (!poolDoc || !poolDoc.exists) throw new Error('Pool booking not found. Please check the booking ID.');

        var booking = poolDoc.data();
        var poolId  = booking.poolId || qrObject.poolId;
        if (poolId) {
            try {
                var poolSnap = await db.collection('swimming_pools').doc(poolId).get();
                if (poolSnap.exists && poolSnap.data().ownerId !== currentUser.uid) {
                    throw new Error('You can only verify entries for your own pools');
                }
            } catch (e) {
                if (e.message.indexOf('your own pools') !== -1) throw e;
                if (booking.ownerId && booking.ownerId !== currentUser.uid) {
                    throw new Error('You can only verify entries for your own pools');
                }
            }
        } else if (booking.ownerId && booking.ownerId !== currentUser.uid) {
            throw new Error('You can only verify entries for your own pools');
        }

        var status = booking.status || booking.bookingStatus || '';
        if (status !== 'confirmed' && status !== 'completed') {
            throw new Error('Pool booking is not confirmed. Current status: ' + (status || 'unknown'));
        }

        var today = new Date().toISOString().split('T')[0];
        if (booking.date && booking.date !== today) {
            throw new Error('This pool pass is for ' + booking.date + '. Today is ' + today + '.');
        }

        if (booking.entryStatus === 'used') throw new Error('This pool pass has already been used for entry');

        await poolDoc.ref.update({
            entryStatus    : 'used',
            entryTime      : firebase.firestore.FieldValue.serverTimestamp(),
            verifiedBy     : currentUser.uid,
            verifiedByName : currentUser.ownerName || currentUser.name || 'Owner',
            verifiedAt     : firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt      : firebase.firestore.FieldValue.serverTimestamp(),
        });

        return {
            isPool      : true,
            userName    : booking.userName  || booking.name || 'Guest',
            userPhone   : booking.userPhone || booking.phone || '',
            bookingId   : booking.bookingId || booking.orderId || poolDoc.id,
            date        : booking.date      || today,
            slotTime    : booking.slotTime  || qrObject.slot || '',
            amount      : booking.amount    || 0,
            poolName    : booking.poolName  || 'Swimming Pool',
            memberCount : booking.memberCount || qrObject.members || 1,
            entryTime   : new Date(),
        };
    }

    function installScannerPatch() {
        var original = window.processVerifiedQRCode;
        if (!original) {
            console.warn('[pool-qr-fix] processVerifiedQRCode not found yet — will retry');
            return false;
        }
        if (original._poolQRFixV3) return true;

        window.processVerifiedQRCode = async function (qrData) {
            var qrObject = null;
            try { qrObject = JSON.parse(qrData); } catch (e) { /* not JSON */ }

            if (qrObject) {
                normaliseQR(qrObject);
                if (POOL_TYPES.indexOf(qrObject.type) !== -1) {
                    var showVerification = window.showVerificationResult;
                    var closeScanner     = window.closeProfessionalQRScanner;
                    try {
                        var appName = qrObject.appId || qrObject.app || '';
                        if (!appName || appName !== 'BookMyGame') {
                            throw new Error('This QR code was not generated by BookMyGame');
                        }
                        var poolResult = await verifyPoolEntryQR(qrObject);
                        if (typeof closeScanner === 'function') closeScanner();
                        if (typeof showVerification === 'function') {
                            var fakeBooking = {
                                userName  : poolResult.userName,
                                userPhone : poolResult.userPhone,
                                bookingId : poolResult.bookingId,
                                date      : poolResult.date,
                                slotTime  : poolResult.slotTime,
                                amount    : poolResult.amount,
                                entryTime : { toDate: function () { return poolResult.entryTime; } },
                                _isPool   : true,
                                _poolName : poolResult.poolName,
                            };
                            showVerification(true, fakeBooking);
                        } else if (typeof window.showToast === 'function') {
                            window.showToast(
                                '🏊 Pool entry verified for ' + poolResult.userName + ' (' +
                                poolResult.memberCount + ' member' + (poolResult.memberCount > 1 ? 's' : '') + ')',
                                'success'
                            );
                        }
                    } catch (err) {
                        console.error('[pool-qr-fix] Pool QR verification error:', err);
                        if (typeof closeScanner === 'function') closeScanner();
                        if (typeof showVerification === 'function') {
                            showVerification(false, null, err.message);
                        } else if (typeof window.showToast === 'function') {
                            window.showToast('Verification failed: ' + err.message, 'error');
                        }
                    }
                    return;
                }
            }
            return original.apply(this, arguments);
        };

        window.processVerifiedQRCode._poolQRFixV3 = true;
        console.log('[pool-qr-fix] ✅ processVerifiedQRCode patched — pool_entry type now handled');
        return true;
    }

    function patchQRPayloadGeneration() {
        var patchToDataURL = function () {
            var qrc = window.QRCode;
            if (!qrc || typeof qrc.toDataURL !== 'function') return false;
            if (qrc.toDataURL._poolQRKeyFix) return true;
            var origToDU = qrc.toDataURL.bind(qrc);
            qrc.toDataURL = function (text, opts) {
                try {
                    var obj = JSON.parse(text);
                    if (obj && POOL_TYPES.indexOf(obj.type) !== -1) {
                        if (!obj.appId && obj.app)   obj.appId = obj.app;
                        if (!obj.app   && obj.appId) obj.app   = obj.appId;
                        obj.type = 'pool_entry';
                        text = JSON.stringify(obj);
                    }
                } catch (e) { /* not JSON */ }
                return origToDU(text, opts);
            };
            qrc.toDataURL._poolQRKeyFix = true;
            console.log('[pool-qr-fix] ✅ QRCode.toDataURL patched — pool QR payload normalised');
            return true;
        };

        var patchBmgGenerateQR = function () {
            if (typeof window._bmgGenerateQR !== 'function') return false;
            if (window._bmgGenerateQR._poolQRKeyFix) return true;
            var orig = window._bmgGenerateQR;
            window._bmgGenerateQR = function (text, opts) {
                try {
                    var obj = JSON.parse(text);
                    if (obj && POOL_TYPES.indexOf(obj.type) !== -1) {
                        normaliseQR(obj);
                        obj.type = 'pool_entry';
                        text = JSON.stringify(obj);
                    }
                } catch (e) {}
                return orig(text, opts);
            };
            window._bmgGenerateQR._poolQRKeyFix = true;
            return true;
        };

        patchToDataURL();
        patchBmgGenerateQR();
        return true;
    }

    function boot() {
        var scannerPatched = installScannerPatch();
        patchQRPayloadGeneration();
        if (!scannerPatched) {
            var retries  = 0;
            var interval = setInterval(function () {
                retries++;
                if (installScannerPatch() || retries > 20) {
                    clearInterval(interval);
                    patchQRPayloadGeneration();
                }
            }, 500);
        }
    }

    if (document.readyState === 'complete') {
        boot();
    } else {
        window.addEventListener('load', boot);
    }

    console.log('✅ [pool-qr-fix] Loaded — pool QR scanner fix active');
})();



/* ╔══════════════════════════════════════════════════════════════════╗
   ║  SECTION 6 — BMG PREMIUM FEATURES                               ║
   ║  (from bmg_premium_features.js — full, unmodified IIFE)         ║
   ╚══════════════════════════════════════════════════════════════════╝ */
/**
 * ═══════════════════════════════════════════════════════════════════
 *  bmg_premium_features.js  —  BookMyGame Premium System v1
 * ═══════════════════════════════════════════════════════════════════
 *
 *  FEATURES:
 *  [1]  PREMIUM PLANS — expanded plans with realistic pricing
 *       weekly ₹299 | monthly ₹999 | city_top ₹2999 | homepage_hero ₹5000
 *  [2]  TRUSTED VENUE / VERIFIED OWNER / PREMIUM PARTNER badges
 *  [3]  OWNER PROMOTE PAGE — fully upgraded with all new plans
 *       (only shows purchased features, never empty locked screens)
 *  [4]  HOME PAGE — Featured, Trending, Most Booked, Recommended labels
 *  [5]  CEO DASHBOARD — "Premium Revenue" tab showing all promo purchases
 *       Admin/CEO never visible to user/owner roles
 *  [6]  REAL-TIME updates — everything from Firestore, no fake data
 *  [7]  CASHFREE PAYMENT — reuses existing startPromotionPaymentFlow
 *  [8]  ADMIN PREMIUM TAB — injected into CEO dashboard
 *
 *  LOAD ORDER (end of <body>, after existing scripts):
 *    <script src="bmg_premium_features.js"></script>
 * ═══════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  /* ─────────────────────────────────────────────────────────────────
   * §0  HELPERS
   * ─────────────────────────────────────────────────────────────────*/
  function _esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function _toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type);
    else console.log('[BMG Premium]', type, msg);
  }
  function _loading(msg) {
    if (typeof window.showLoading === 'function') window.showLoading(msg);
  }
  function _hideLoading() {
    if (typeof window.hideLoading === 'function') window.hideLoading();
  }
  function _fmt(v) {
    return typeof window.formatCurrency === 'function'
      ? window.formatCurrency(v)
      : '₹' + Number(v || 0).toLocaleString('en-IN');
  }

  /* ─────────────────────────────────────────────────────────────────
   * §1  EXPANDED PREMIUM PLANS
   * ─────────────────────────────────────────────────────────────────*/
  window.BMG_PROMO_PLANS = {
    weekly: {
      id: 'weekly', name: 'Weekly Boost', price: 299, durationDays: 7,
      label: '7-Day Plan', badge: 'silver', badgeLabel: '⚡ Quick Boost',
      placement: 'home_featured',
      features: [
        { text: 'Featured on home page for 7 days', yes: true },
        { text: 'Appear above regular listings', yes: true },
        { text: 'Gold-border highlight card', yes: true },
        { text: 'Verified badge', yes: false },
        { text: 'City top placement', yes: false },
        { text: 'Homepage hero banner', yes: false },
      ],
    },
    monthly: {
      id: 'monthly', name: 'Monthly Feature', price: 999, durationDays: 30,
      label: '30-Day Plan', badge: 'gold', badgeLabel: '👑 Most Popular',
      placement: 'home_featured',
      features: [
        { text: 'Featured on home page for 30 days', yes: true },
        { text: 'Appear above regular listings', yes: true },
        { text: 'Gold-border highlight card', yes: true },
        { text: '"Most Booked" label', yes: true },
        { text: 'City top placement', yes: false },
        { text: 'Homepage hero banner', yes: false },
      ],
    },
    city_top: {
      id: 'city_top', name: 'City Top Placement', price: 2999, durationDays: 30,
      label: '30-Day City #1', badge: 'platinum', badgeLabel: '🏆 City Top',
      placement: 'city_top',
      features: [
        { text: 'City #1 position in search & browse', yes: true },
        { text: 'Featured on home page', yes: true },
        { text: '"Trending Turf" label', yes: true },
        { text: '"Recommended" badge', yes: true },
        { text: 'Priority support', yes: true },
        { text: 'Analytics access', yes: true },
        { text: 'Homepage hero banner', yes: false },
      ],
    },
    homepage_hero: {
      id: 'homepage_hero', name: 'Homepage Hero Banner', price: 1, durationDays: 30,
      label: '30-Day Hero Spot', badge: 'diamond', badgeLabel: '💎 Hero Banner',
      placement: 'hero',
      features: [
        { text: 'Full-width hero banner on homepage', yes: true },
        { text: 'City #1 + home page featured', yes: true },
        { text: '"Trending Turf" + "Recommended"', yes: true },
        { text: 'Premium Partner badge', yes: true },
        { text: 'Priority & dedicated support', yes: true },
        { text: 'Full analytics dashboard', yes: true },
      ],
    },
    verified: {
      id: 'verified', name: 'Verified Badge', price: 499, durationDays: 30,
      label: '30-Day Verification', badge: 'verified', badgeLabel: '✅ Verified',
      placement: 'home_featured',
      features: [
        { text: 'Official "Verified" badge on listing', yes: true },
        { text: 'Featured on home page for 30 days', yes: true },
        { text: 'Appear above regular listings', yes: true },
        { text: 'Priority in search results', yes: true },
        { text: '"Trusted Venue" label for users', yes: true },
        { text: 'City top placement', yes: false },
      ],
    },
    trusted_venue: {
      id: 'trusted_venue', name: 'Trusted Venue', price: 1499, durationDays: 90,
      label: '90-Day Trust', badge: 'trust', badgeLabel: '🛡️ Trusted',
      placement: 'home_featured',
      features: [
        { text: '"Trusted Venue" badge on all listings', yes: true },
        { text: 'Featured on home page for 90 days', yes: true },
        { text: '"Verified Owner" label', yes: true },
        { text: 'Faster support response', yes: true },
        { text: 'More visibility in search', yes: true },
        { text: 'City top placement', yes: false },
      ],
    },
    premium_partner: {
      id: 'premium_partner', name: 'Premium Partner', price: 9999, durationDays: 365,
      label: '1-Year Partner', badge: 'partner', badgeLabel: '⭐ Premium Partner',
      placement: 'hero',
      features: [
        { text: '"Premium Partner" badge — permanent year', yes: true },
        { text: 'Hero banner + city top all year', yes: true },
        { text: 'Full analytics access', yes: true },
        { text: 'Dedicated account manager', yes: true },
        { text: 'Priority listing in all searches', yes: true },
        { text: '3× more booking conversions', yes: true },
      ],
    },
  };

  /* ─────────────────────────────────────────────────────────────────
   * §2  CSS — inject all premium styles
   * ─────────────────────────────────────────────────────────────────*/
  function injectPremiumStyles() {
    if (document.getElementById('bmg-premium-styles')) return;
    const s = document.createElement('style');
    s.id = 'bmg-premium-styles';
    s.textContent = `
/* ═══════════════════════ PLAN BADGES ══════════════════════════ */
.bmg-plan-badge.silver    { background:#f1f5f9; color:#475569; border:1.5px solid #cbd5e1; }
.bmg-plan-badge.gold      { background:linear-gradient(135deg,#fef3c7,#fde68a); color:#92400e; border:1.5px solid #fbbf24; }
.bmg-plan-badge.platinum  { background:linear-gradient(135deg,#e0e7ff,#c7d2fe); color:#3730a3; border:1.5px solid #a5b4fc; }
.bmg-plan-badge.diamond   { background:linear-gradient(135deg,#ecfdf5,#d1fae5); color:#065f46; border:1.5px solid #6ee7b7; }
.bmg-plan-badge.verified  { background:linear-gradient(135deg,#eff6ff,#dbeafe); color:#1e40af; border:1.5px solid #93c5fd; }
.bmg-plan-badge.trust     { background:linear-gradient(135deg,#fff7ed,#fed7aa); color:#9a3412; border:1.5px solid #fb923c; }
.bmg-plan-badge.partner   { background:linear-gradient(135deg,#fdf4ff,#f3e8ff); color:#6b21a8; border:1.5px solid #c084fc; }

/* ═══════════════════════ GROUND LISTING BADGES ══════════════════ */
.bmg-listing-badge {
  display:inline-flex; align-items:center; gap:4px;
  font-size:10px; font-weight:700; padding:3px 8px;
  border-radius:20px; letter-spacing:.3px; flex-shrink:0;
}
.bmg-badge-featured    { background:#fef3c7; color:#92400e; border:1px solid #fbbf24; }
.bmg-badge-trending    { background:#fef2f2; color:#991b1b; border:1px solid #fca5a5; }
.bmg-badge-recommended { background:#f0fdf4; color:#166534; border:1px solid #86efac; }
.bmg-badge-mostbooked  { background:#eff6ff; color:#1e40af; border:1px solid #93c5fd; }
.bmg-badge-verified    { background:#dbeafe; color:#1e40af; border:1px solid #60a5fa; }
.bmg-badge-trusted     { background:#fff7ed; color:#9a3412; border:1px solid #fb923c; }
.bmg-badge-partner     { background:linear-gradient(135deg,#fdf4ff,#ede9fe); color:#6b21a8; border:1px solid #c084fc; }
.bmg-badge-citytop     { background:linear-gradient(135deg,#e0e7ff,#dbeafe); color:#1e40af; border:1px solid #818cf8; }

/* ═══════════════════════ HERO BANNER ════════════════════════════ */
#bmg-hero-banner-section {
  margin:0 0 16px; border-radius:18px; overflow:hidden;
  position:relative; min-height:160px;
  background:linear-gradient(135deg,#0b1437,#1a237e);
  display:none;
}
.bmg-hero-banner-card {
  position:relative; width:100%; height:160px; overflow:hidden; cursor:pointer;
  border-radius:18px;
}
.bmg-hero-banner-card img {
  width:100%; height:100%; object-fit:cover; opacity:.7;
}
.bmg-hero-banner-overlay {
  position:absolute; inset:0;
  background:linear-gradient(to right, rgba(11,20,55,.85) 40%, transparent);
  display:flex; flex-direction:column; justify-content:center; padding:16px 20px;
}
.bmg-hero-banner-label {
  font-size:10px; font-weight:800; color:#fbbf24;
  letter-spacing:1.5px; text-transform:uppercase; margin-bottom:4px;
}
.bmg-hero-banner-name {
  font-size:18px; font-weight:800; color:#fff;
  letter-spacing:-.3px; margin-bottom:4px;
}
.bmg-hero-banner-meta { font-size:12px; color:rgba(255,255,255,.7); margin-bottom:10px; }
.bmg-hero-banner-btn {
  display:inline-flex; align-items:center; gap:6px;
  background:linear-gradient(135deg,#2563eb,#1d4ed8);
  color:#fff; border:none; border-radius:10px; padding:8px 16px;
  font-size:13px; font-weight:700; cursor:pointer; width:fit-content;
}
.bmg-hero-partner-badge {
  position:absolute; top:12px; right:12px;
  background:linear-gradient(135deg,#7c3aed,#6d28d9);
  color:#fff; font-size:10px; font-weight:800;
  padding:4px 10px; border-radius:20px; letter-spacing:.4px;
}

/* ═══════════════════════ FEATURED SECTION ═══════════════════════ */
#bmg-featured-section { margin-bottom:4px; }
#bmg-featured-section .section-header-row {
  display:flex; align-items:center; justify-content:space-between;
  padding:0 0 10px;
}
#bmg-featured-section .section-title {
  font-size:16px; font-weight:800; color:#0f1f5c; letter-spacing:-.3px;
}
#bmg-featured-scroll { display:flex; gap:10px; overflow-x:auto;
  padding-bottom:4px; scrollbar-width:none; -webkit-overflow-scrolling:touch; }
#bmg-featured-scroll::-webkit-scrollbar { display:none; }

.bmg-feat-card {
  min-width:200px; max-width:200px; border-radius:16px; overflow:hidden;
  position:relative; background:#fff; flex-shrink:0; cursor:pointer;
  box-shadow:0 4px 18px rgba(15,31,92,.12);
  border:2px solid #e8edf8; transition:transform .2s,box-shadow .2s;
}
.bmg-feat-card:hover { transform:translateY(-3px); box-shadow:0 8px 28px rgba(15,31,92,.18); }
.bmg-feat-card.gold-border { border-color:#fbbf24; box-shadow:0 4px 18px rgba(251,191,36,.25); }
.bmg-feat-card.hero-border { border-color:#c084fc; box-shadow:0 6px 24px rgba(192,132,252,.3); }

.bmg-feat-ribbon {
  position:absolute; top:10px; left:-1px; z-index:2;
  background:linear-gradient(135deg,#f59e0b,#d97706);
  color:#fff; font-size:9px; font-weight:800;
  padding:3px 8px 3px 10px; letter-spacing:.8px;
  clip-path:polygon(0 0,100% 0,92% 100%,0 100%);
}
.bmg-feat-ribbon.trending { background:linear-gradient(135deg,#ef4444,#dc2626); }
.bmg-feat-ribbon.citytop  { background:linear-gradient(135deg,#6366f1,#4f46e5); }
.bmg-feat-ribbon.partner  { background:linear-gradient(135deg,#7c3aed,#6d28d9); }

.bmg-feat-card-img { width:100%; height:120px; object-fit:cover; display:block; }
.bmg-feat-img-overlay {
  position:absolute; left:0; right:0; bottom:0; height:80px;
  background:linear-gradient(to top,rgba(11,20,55,.85),transparent);
  pointer-events:none;
}
.bmg-feat-verified-badge {
  position:absolute; top:10px; right:8px; z-index:3;
  background:rgba(37,99,235,.9); color:#fff;
  font-size:9px; font-weight:800; padding:3px 7px;
  border-radius:20px; display:flex; align-items:center; gap:3px;
  backdrop-filter:blur(4px);
}
.bmg-feat-labels {
  position:absolute; bottom:54px; left:8px; right:8px; z-index:3;
  display:flex; flex-wrap:wrap; gap:4px;
}
.bmg-feat-body { padding:8px 10px 10px; }
.bmg-feat-name { font-size:13px; font-weight:800; color:#0f1f5c; margin-bottom:4px;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.bmg-feat-meta { display:flex; flex-direction:column; gap:2px; margin-bottom:8px; }
.bmg-feat-sport { font-size:10px; font-weight:700; color:#2563eb;
  background:#eff6ff; padding:2px 7px; border-radius:20px; width:fit-content; }
.bmg-feat-addr { font-size:10px; color:#6b7280; }
.bmg-feat-footer { display:flex; align-items:center; justify-content:space-between; }
.bmg-feat-price { font-size:15px; font-weight:800; color:#2563eb; }
.bmg-feat-price span { font-size:10px; font-weight:500; color:#9ca3af; }
.bmg-feat-book-btn {
  padding:5px 10px; background:linear-gradient(135deg,#2563eb,#1d4ed8);
  color:#fff; border:none; border-radius:8px; font-size:11px;
  font-weight:700; cursor:pointer; transition:transform .15s;
}
.bmg-feat-book-btn:hover { transform:scale(1.05); }

/* ═══════════════════════ PROMOTE PAGE ═══════════════════════════ */
.bmg-promote-page { padding:0; }
.bmg-promote-hero {
  background:linear-gradient(135deg,#0b1437,#1a237e,#2563eb);
  border-radius:20px; padding:24px 20px; text-align:center;
  margin-bottom:18px; position:relative; overflow:hidden;
}
.bmg-promote-hero::before {
  content:''; position:absolute; top:-40px; right:-40px;
  width:120px; height:120px; border-radius:50%;
  background:rgba(255,255,255,.06);
}
.bmg-promote-hero-crown { font-size:2.2rem; display:block; margin-bottom:8px; }
.bmg-promote-hero h2 { font-size:22px; font-weight:800; color:#fff; margin-bottom:6px; letter-spacing:-.4px; }
.bmg-promote-hero p { font-size:13px; color:rgba(255,255,255,.65); margin-bottom:16px; }
.bmg-promote-stat-row { display:flex; gap:8px; justify-content:center; flex-wrap:wrap; }
.bmg-promote-stat-chip {
  background:rgba(255,255,255,.12); color:#fff; font-size:11px;
  font-weight:700; padding:5px 12px; border-radius:20px;
  backdrop-filter:blur(8px); border:1px solid rgba(255,255,255,.15);
}

/* Active promo card */
.bmg-promote-active-card {
  background:linear-gradient(135deg,#f0fdf4,#dcfce7);
  border:2px solid #86efac; border-radius:16px; padding:16px;
  margin-bottom:18px;
}
.bmg-promote-active-hdr { display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; }
.bmg-promote-active-badge {
  display:flex; align-items:center; gap:6px;
  font-size:11px; font-weight:800; color:#15803d; letter-spacing:.5px;
}
.bmg-promote-active-badge span {
  width:8px; height:8px; border-radius:50%; background:#22c55e;
  animation:bmgPulse 1.5s ease infinite;
}
@keyframes bmgPulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(1.4)} }
.bmg-promote-active-days { font-size:12px; font-weight:700; color:#15803d; }
.bmg-promote-active-plan-name { font-size:14px; font-weight:700; color:#166534; }
.bmg-promote-active-expiry { font-size:12px; color:#4ade80; margin-top:2px; }
.bmg-promote-active-progress-bar { height:6px; background:#bbf7d0; border-radius:3px; margin:10px 0 4px; overflow:hidden; }
.bmg-promote-active-progress-fill { height:100%; background:#22c55e; border-radius:3px; transition:width .5s ease; }
.bmg-promote-renew-btn {
  width:100%; padding:11px; margin-top:10px;
  background:linear-gradient(135deg,#16a34a,#15803d);
  color:#fff; border:none; border-radius:12px; font-weight:700;
  font-size:14px; cursor:pointer; display:flex; align-items:center;
  justify-content:center; gap:8px;
}

/* Plans grid */
.bmg-promote-plans-title { font-size:15px; font-weight:800; color:#0f1f5c;
  letter-spacing:-.3px; margin:0 0 14px; padding:0 2px; }
.bmg-promote-plans-grid { display:flex; flex-direction:column; gap:14px; margin-bottom:18px; }
.bmg-plan-card {
  background:#fff; border-radius:18px; padding:0;
  border:2px solid #e8edf8; overflow:hidden;
  transition:border-color .2s, box-shadow .2s;
  position:relative;
}
.bmg-plan-card.recommended { border-color:#2563eb; box-shadow:0 8px 28px rgba(37,99,235,.2); }
.bmg-plan-card.premium-top { border-color:#c084fc; box-shadow:0 8px 28px rgba(192,132,252,.25); }
.bmg-plan-ribbon {
  background:linear-gradient(135deg,#f59e0b,#d97706);
  color:#fff; font-size:10px; font-weight:800;
  padding:5px 16px; text-align:center; letter-spacing:.8px;
}
.bmg-plan-ribbon.hero { background:linear-gradient(135deg,#7c3aed,#6d28d9); }
.bmg-plan-ribbon.city { background:linear-gradient(135deg,#2563eb,#1d4ed8); }
.bmg-plan-header { padding:16px 16px 12px; }
.bmg-plan-top { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:10px; }
.bmg-plan-name { font-size:17px; font-weight:800; color:#0f1f5c; letter-spacing:-.3px; }
.bmg-plan-period { font-size:11px; color:#6b7280; font-weight:600; margin-top:2px; }
.bmg-plan-price-block { text-align:right; }
.bmg-plan-price { font-size:26px; font-weight:800; color:#2563eb; letter-spacing:-.5px; }
.bmg-plan-per { font-size:10px; color:#9ca3af; margin-top:-2px; }
.bmg-plan-badge {
  display:inline-flex; align-items:center; gap:4px;
  font-size:10px; font-weight:800; padding:4px 10px;
  border-radius:20px; letter-spacing:.3px;
}
.bmg-plan-features { list-style:none; padding:0 16px 14px; margin:0; }
.bmg-plan-features li {
  display:flex; align-items:center; gap:8px;
  font-size:13px; color:#374151; padding:6px 0;
  border-bottom:1px solid #f9fafb;
}
.bmg-plan-features li:last-child { border-bottom:none; }
.bmg-plan-features .fa-check.yes { color:#22c55e; font-size:11px; flex-shrink:0; }
.bmg-plan-features .fa-times.no  { color:#e2e8f0; font-size:11px; flex-shrink:0; }
.bmg-plan-cta {
  width:100%; padding:14px; border:none;
  font-size:14px; font-weight:700; cursor:pointer;
  display:flex; align-items:center; justify-content:center; gap:8px;
  transition:filter .2s, transform .15s; letter-spacing:-.1px;
}
.bmg-plan-cta.weekly   { background:#f8fafc; color:#0f1f5c; border-top:2px solid #e8edf8; }
.bmg-plan-cta.monthly  { background:linear-gradient(135deg,#2563eb,#1d4ed8); color:#fff; }
.bmg-plan-cta.city_top { background:linear-gradient(135deg,#4f46e5,#4338ca); color:#fff; }
.bmg-plan-cta.homepage_hero { background:linear-gradient(135deg,#7c3aed,#6d28d9); color:#fff; }
.bmg-plan-cta.verified { background:linear-gradient(135deg,#2563eb,#0ea5e9); color:#fff; }
.bmg-plan-cta.trusted_venue { background:linear-gradient(135deg,#ea580c,#dc2626); color:#fff; }
.bmg-plan-cta.premium_partner { background:linear-gradient(135deg,#7c3aed,#db2777); color:#fff; }
.bmg-plan-cta:hover { filter:brightness(1.08); transform:translateY(-1px); }

/* Guarantee strip */
.bmg-promote-guarantee {
  display:flex; align-items:center; gap:12px;
  background:#f8fafc; border-radius:14px; padding:14px;
  border:1px solid #e8edf8;
}
.bmg-promote-guarantee i { font-size:22px; color:#22c55e; flex-shrink:0; }
.bmg-promote-guarantee h4 { font-size:13px; font-weight:700; color:#0f1f5c; margin:0 0 2px; }
.bmg-promote-guarantee p { font-size:11px; color:#9ca3af; margin:0; }

/* ═══════════════════════ CEO PREMIUM TAB ════════════════════════ */
.bmg-ceo-premium-stat-grid {
  display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:18px;
}
.bmg-ceo-stat-card {
  background:#fff; border-radius:14px; padding:14px;
  border:1.5px solid #f0f4ff;
}
.bmg-ceo-stat-card .label { font-size:10px; font-weight:700; color:#9ca3af;
  text-transform:uppercase; letter-spacing:.5px; margin-bottom:4px; }
.bmg-ceo-stat-card .val { font-size:22px; font-weight:800; color:#0f1f5c; }
.bmg-ceo-stat-card .sub { font-size:11px; color:#9ca3af; margin-top:2px; }
.bmg-ceo-promo-row {
  background:#fff; border-radius:14px; padding:14px;
  border:1.5px solid #f0f4ff; margin-bottom:10px;
  display:flex; align-items:center; gap:12px;
}
.bmg-ceo-promo-row .promo-icon {
  width:40px; height:40px; border-radius:12px; flex-shrink:0;
  display:flex; align-items:center; justify-content:center; font-size:18px;
}
.bmg-ceo-promo-row .promo-info { flex:1; min-width:0; }
.bmg-ceo-promo-row .promo-name {
  font-size:14px; font-weight:700; color:#0f1f5c;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
.bmg-ceo-promo-row .promo-plan { font-size:11px; color:#6b7280; }
.bmg-ceo-promo-row .promo-amount {
  font-size:15px; font-weight:800; color:#22c55e; flex-shrink:0;
}
.bmg-ceo-promo-row .promo-status {
  font-size:10px; font-weight:700; padding:3px 8px; border-radius:20px;
  flex-shrink:0;
}
.bmg-ceo-promo-row .promo-status.active { background:#dcfce7; color:#15803d; }
.bmg-ceo-promo-row .promo-status.expired { background:#f1f5f9; color:#6b7280; }

/* Ground card premium label strip */
.bmg-ground-labels {
  display:flex; flex-wrap:wrap; gap:4px; margin-top:6px;
}

/* ═══════════════════════ VERIFIED OWNER BANNER (on ground page) ═══ */
.bmg-owner-trust-strip {
  display:flex; align-items:center; gap:8px;
  background:linear-gradient(135deg,#eff6ff,#dbeafe);
  border-radius:12px; padding:10px 12px; margin-top:10px;
  border:1.5px solid #bfdbfe;
}
.bmg-owner-trust-strip i { color:#2563eb; font-size:14px; flex-shrink:0; }
.bmg-owner-trust-strip .trust-text { font-size:12px; font-weight:700; color:#1e40af; }
.bmg-owner-trust-strip .trust-sub { font-size:10px; color:#3b82f6; }
`;
    document.head.appendChild(s);
  }

  /* ─────────────────────────────────────────────────────────────────
   * §3  PATCH loadBmgFeaturedGrounds — add labels, hero banner, badges
   * ─────────────────────────────────────────────────────────────────*/
  function patchFeaturedGrounds() {
    window.loadBmgFeaturedGrounds = async function () {
      const section = document.getElementById('bmg-featured-section');
      const scroll  = document.getElementById('bmg-featured-scroll');

      // Also handle hero banner
      _loadHeroBanner();

      if (!section || !scroll) return;

      try {
        const now = firebase.firestore.Timestamp.now();
        const snap = await window.db.collection('ground_promotions')
          .where('status', '==', 'active')
          .where('expiresAt', '>', now)
          .limit(30)
          .get();

        if (snap.empty) { section.style.display = 'none'; return; }

        const featuredGrounds = [];
        for (const doc of snap.docs) {
          const promo = doc.data();
          if (promo.placement === 'hero') continue; // hero handled separately
          try {
            const gDoc = await window.db.collection('grounds').doc(promo.groundId).get();
            if (gDoc.exists && gDoc.data().status === 'active') {
              featuredGrounds.push({
                id: gDoc.id, promoId: doc.id,
                planId: promo.planId, ...gDoc.data()
              });
            }
          } catch (e) { /* skip */ }
        }

        if (!featuredGrounds.length) { section.style.display = 'none'; return; }

        scroll.innerHTML = featuredGrounds.map(g => {
          const img  = (g.images || [])[0] || 'https://placehold.co/220x130/1e3a8a/fff?text=Ground';
          const name = _esc(g.groundName || 'Ground');
          const sport= _esc(g.sportType || 'Multi-sport');
          const addr = _esc(g.groundAddress || g.city || 'Location');
          const price= g.pricePerHour ? `₹${g.pricePerHour}` : '₹--';

          // Pick ribbon label based on plan
          const ribbonMap = {
            city_top:       { text:'CITY TOP',  cls:'citytop' },
            homepage_hero:  { text:'HERO',      cls:'partner'  },
            premium_partner:{ text:'PARTNER',   cls:'partner'  },
            monthly:        { text:'FEATURED',  cls:''         },
            weekly:         { text:'FEATURED',  cls:''         },
            trusted_venue:  { text:'TRUSTED',   cls:''         },
            verified:       { text:'VERIFIED',  cls:''         },
          };
          const ribbon = ribbonMap[g.planId] || { text:'FEATURED', cls:'' };

          // Extra label chips
          const labelChips = [];
          if (g.planId === 'city_top' || g.planId === 'homepage_hero' || g.planId === 'premium_partner') {
            labelChips.push('<span class="bmg-listing-badge bmg-badge-trending">🔥 Trending</span>');
            labelChips.push('<span class="bmg-listing-badge bmg-badge-recommended">⭐ Recommended</span>');
          }
          if (g.planId === 'monthly' || g.planId === 'trusted_venue') {
            labelChips.push('<span class="bmg-listing-badge bmg-badge-mostbooked">📈 Most Booked</span>');
          }

          const verBdg = (g.isVerified || g.planId === 'verified' || g.planId === 'trusted_venue')
            ? `<div class="bmg-feat-verified-badge"><i class="fas fa-check-circle"></i> Verified</div>` : '';

          const borderCls = (g.planId === 'premium_partner' || g.planId === 'homepage_hero')
            ? 'hero-border' : 'gold-border';

          return `
            <div class="bmg-feat-card ${borderCls}" data-ground-id="${g.id}">
              <div class="bmg-feat-ribbon ${ribbon.cls}">${ribbon.text}</div>
              <img class="bmg-feat-card-img" src="${img}" alt="${name}"
                   onerror="this.src='https://placehold.co/220x130/1e3a8a/fff?text=Ground'">
              ${verBdg}
              <div class="bmg-feat-img-overlay"></div>
              ${labelChips.length ? `<div class="bmg-feat-labels">${labelChips.join('')}</div>` : ''}
              <div class="bmg-feat-body">
                <div class="bmg-feat-name">${name}</div>
                <div class="bmg-feat-meta">
                  <span class="bmg-feat-sport">${sport}</span>
                  <span class="bmg-feat-addr">📍 ${addr}</span>
                </div>
                <div class="bmg-feat-footer">
                  <div class="bmg-feat-price">${price}<span>/hr</span></div>
                  <button class="bmg-feat-book-btn" data-ground-id="${g.id}">Book Now</button>
                </div>
              </div>
            </div>`;
        }).join('');

        // Wire clicks
        scroll.querySelectorAll('.bmg-feat-card').forEach(card => {
          card.addEventListener('click', (e) => {
            if (e.target.classList.contains('bmg-feat-book-btn')) return;
            if (typeof window.viewGround === 'function') window.viewGround(card.dataset.groundId);
          });
        });
        scroll.querySelectorAll('.bmg-feat-book-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof window.viewGround === 'function') window.viewGround(btn.dataset.groundId);
          });
        });

        section.style.display = '';
      } catch (err) {
        console.warn('[BMG Featured] Error:', err.message);
        if (section) section.style.display = 'none';
      }
    };
  }

  /* ─────────────────────────────────────────────────────────────────
   * §4  HERO BANNER — only for homepage_hero / premium_partner plans
   * ─────────────────────────────────────────────────────────────────*/
  async function _loadHeroBanner() {
    // Ensure hero section container exists
    let heroSection = document.getElementById('bmg-hero-banner-section');
    if (!heroSection) {
      // Try to inject before #bmg-featured-section
      const featSection = document.getElementById('bmg-featured-section');
      if (!featSection) return;
      heroSection = document.createElement('div');
      heroSection.id = 'bmg-hero-banner-section';
      featSection.parentNode.insertBefore(heroSection, featSection);
    }

    try {
      const now = firebase.firestore.Timestamp.now();
      const snap = await window.db.collection('ground_promotions')
        .where('status', '==', 'active')
        .where('expiresAt', '>', now)
        .limit(5)
        .get();

      const heroPromos = snap.docs
        .map(d => d.data())
        .filter(p => p.planId === 'homepage_hero' || p.planId === 'premium_partner');

      if (!heroPromos.length) { heroSection.style.display = 'none'; return; }

      const promo = heroPromos[0];
      const gDoc  = await window.db.collection('grounds').doc(promo.groundId).get().catch(() => null);
      if (!gDoc || !gDoc.exists) { heroSection.style.display = 'none'; return; }
      const g = gDoc.data();
      const img  = (g.images || [])[0] || 'https://placehold.co/400x160/1e3a8a/fff?text=Featured';
      const name = _esc(g.groundName || 'Premium Ground');
      const addr = _esc(g.groundAddress || g.city || '');
      const price= g.pricePerHour ? `₹${g.pricePerHour}/hr` : '';

      heroSection.innerHTML = `
        <div class="bmg-hero-banner-card" data-ground-id="${gDoc.id}">
          <img src="${img}" alt="${name}" onerror="this.src='https://placehold.co/400x160/1e3a8a/fff?text=Featured'">
          <div class="bmg-hero-banner-overlay">
            <div class="bmg-hero-banner-label">🏆 Top Sponsored</div>
            <div class="bmg-hero-banner-name">${name}</div>
            <div class="bmg-hero-banner-meta">📍 ${addr}${price ? ' · ' + price : ''}</div>
            <button class="bmg-hero-banner-btn"><i class="fas fa-bolt"></i> Book Now</button>
          </div>
          ${promo.planId === 'premium_partner' ? '<div class="bmg-hero-partner-badge">⭐ Premium Partner</div>' : ''}
        </div>`;

      heroSection.style.display = '';
      heroSection.querySelector('.bmg-hero-banner-card').addEventListener('click', () => {
        if (typeof window.viewGround === 'function') window.viewGround(gDoc.id);
      });
      heroSection.querySelector('.bmg-hero-banner-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof window.viewGround === 'function') window.viewGround(gDoc.id);
      });
    } catch (err) {
      console.warn('[BMG Hero Banner]', err.message);
      heroSection.style.display = 'none';
    }
  }

  /* ─────────────────────────────────────────────────────────────────
   * §5  UPGRADED OWNER PROMOTE PAGE
   * ─────────────────────────────────────────────────────────────────*/
  function patchOwnerPromotePage() {
    window.loadOwnerPromotePage = async function (container) {
      const cu = window.currentUser;
      if (!cu || cu.role !== 'owner') {
        container.innerHTML = '<p style="text-align:center;padding:40px;color:#9ca3af;">Only owners can access this page.</p>';
        return;
      }
      _loading('Loading promotion options…');
      try {
        const now = firebase.firestore.Timestamp.now();

        // Fetch active promos for this owner
        const promoSnap = await window.db.collection('ground_promotions')
          .where('ownerId', '==', cu.uid)
          .where('status', '==', 'active')
          .get();

        const activePromos = promoSnap.docs
          .filter(d => d.data().expiresAt && d.data().expiresAt.toDate() > new Date())
          .map(d => ({ id: d.id, ...d.data() }));

        // Fetch owner's grounds
        const groundsSnap = await window.db.collection('grounds')
          .where('ownerId', '==', cu.uid).get();
        const grounds = groundsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        _hideLoading();

        // Active promo cards
        const activePromoHtml = activePromos.length
          ? activePromos.map(promo => {
              const plan = window.BMG_PROMO_PLANS[promo.planId] || { name: promo.planName || 'Promotion', durationDays: 30 };
              const expiresAt  = promo.expiresAt.toDate();
              const daysLeft   = Math.max(0, Math.ceil((expiresAt - new Date()) / 86400000));
              const totalDays  = plan.durationDays;
              const pct        = Math.max(5, Math.round((daysLeft / totalDays) * 100));
              const expiryStr  = expiresAt.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
              return `
                <div class="bmg-promote-active-card">
                  <div class="bmg-promote-active-hdr">
                    <div class="bmg-promote-active-badge"><span></span> ACTIVE — ${_esc(plan.name)}</div>
                    <div class="bmg-promote-active-days">${daysLeft} days left</div>
                  </div>
                  <div class="bmg-promote-active-plan-name">📍 ${_esc(promo.groundName || 'Your Ground')}</div>
                  <div class="bmg-promote-active-expiry">Expires: ${expiryStr}</div>
                  <div class="bmg-promote-active-progress-bar">
                    <div class="bmg-promote-active-progress-fill" style="width:${pct}%"></div>
                  </div>
                  ${daysLeft <= 5 ? `<button class="bmg-promote-renew-btn" data-renew-plan="${promo.planId}" data-renew-ground="${promo.groundId}"><i class="fas fa-redo"></i> Renew Now</button>` : ''}
                </div>`;
            }).join('')
          : '';

        // Ground selector
        const groundSelectHtml = grounds.length > 1
          ? `<div style="padding:0 0 14px">
               <label style="font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:6px;">Select Ground to Promote</label>
               <select id="bmg-promo-ground-select" style="width:100%;padding:12px 14px;border:2px solid #e8edf8;border-radius:12px;font-size:14px;font-weight:600;color:#0f1f5c;background:#fff;outline:none;">
                 ${grounds.map(g => `<option value="${g.id}">${_esc(g.groundName || 'Ground')}</option>`).join('')}
               </select>
             </div>`
          : (grounds.length === 1 ? `<input type="hidden" id="bmg-promo-ground-select" value="${grounds[0].id}">` : '');

        // Plan cards — ALL PLANS
        const PLANS = window.BMG_PROMO_PLANS;
        const plansHtml = Object.values(PLANS).map(plan => {
          const isRec = plan.id === 'monthly';
          const isBig = plan.id === 'homepage_hero' || plan.id === 'premium_partner';
          const ribbonText = plan.id === 'monthly' ? '⭐ BEST VALUE'
            : plan.id === 'city_top' ? '🏆 CITY TOP'
            : plan.id === 'homepage_hero' ? '💎 HERO SPOT'
            : plan.id === 'premium_partner' ? '👑 ULTIMATE'
            : plan.id === 'trusted_venue' ? '🛡️ TRUST BUILDER'
            : '';
          const ribbonCls = plan.id === 'homepage_hero' || plan.id === 'premium_partner' ? 'hero'
            : plan.id === 'city_top' ? 'city' : '';
          const alreadyActive = activePromos.some(p => p.planId === plan.id);

          return `
            <div class="bmg-plan-card ${isRec ? 'recommended' : ''} ${isBig ? 'premium-top' : ''}">
              ${ribbonText ? `<div class="bmg-plan-ribbon ${ribbonCls}">${ribbonText}</div>` : ''}
              <div class="bmg-plan-header">
                <div class="bmg-plan-top">
                  <div>
                    <div class="bmg-plan-name">${plan.name}</div>
                    <div class="bmg-plan-period">${plan.label}</div>
                  </div>
                  <div class="bmg-plan-price-block">
                    <div class="bmg-plan-price">₹${plan.price.toLocaleString('en-IN')}</div>
                    <div class="bmg-plan-per">one time</div>
                  </div>
                </div>
                <span class="bmg-plan-badge ${plan.badge}">${plan.badgeLabel}</span>
              </div>
              <ul class="bmg-plan-features">
                ${plan.features.map(f => `
                  <li>
                    <i class="fas ${f.yes ? 'fa-check yes' : 'fa-times no'}"></i>
                    ${f.text}
                  </li>`).join('')}
              </ul>
              <button class="bmg-plan-cta ${plan.id}" data-plan-id="${plan.id}" ${alreadyActive ? 'disabled style="opacity:.5;cursor:not-allowed"' : ''}>
                ${alreadyActive ? '<i class="fas fa-check-circle"></i> Currently Active' : `<i class="fas fa-bolt"></i> Get ${plan.name} — ₹${plan.price.toLocaleString('en-IN')}`}
              </button>
            </div>`;
        }).join('');

        container.innerHTML = `
          <div class="bmg-promote-page">
            <div class="bmg-promote-hero">
              <span class="bmg-promote-hero-crown">👑</span>
              <h2>Promote Your Ground</h2>
              <p>Get featured on the home page and reach thousands of players looking to book today.</p>
              <div class="bmg-promote-stat-row">
                <div class="bmg-promote-stat-chip">📈 3× More Bookings</div>
                <div class="bmg-promote-stat-chip">👁 Top Visibility</div>
                <div class="bmg-promote-stat-chip">⚡ Instant Live</div>
              </div>
            </div>
            ${activePromoHtml}
            ${groundSelectHtml}
            ${grounds.length === 0
              ? `<div style="text-align:center;padding:40px 20px;">
                   <div style="font-size:3rem;margin-bottom:12px;">🏟️</div>
                   <h3 style="color:#0f1f5c;font-weight:800;margin-bottom:8px;">No Grounds Yet</h3>
                   <p style="color:#9ca3af;font-size:14px;">Add at least one ground before promoting.</p>
                   <button onclick="window.loadOwnerDashboard&&window.loadOwnerDashboard('grounds')"
                     style="margin-top:16px;padding:12px 24px;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;border:none;border-radius:14px;font-weight:700;font-size:14px;cursor:pointer;">
                     Add a Ground First
                   </button>
                 </div>`
              : `<div class="bmg-promote-plans-title">Choose Your Plan</div>
                 <div class="bmg-promote-plans-grid">${plansHtml}</div>
                 <div class="bmg-promote-guarantee">
                   <i class="fas fa-shield-alt"></i>
                   <div>
                     <h4>Secure Payment Guaranteed</h4>
                     <p>Powered by Cashfree · PCI DSS Compliant · Instant activation after payment</p>
                   </div>
                 </div>`}
          </div>`;

        // Wire plan buttons
        container.querySelectorAll('.bmg-plan-cta:not([disabled])').forEach(btn => {
          btn.addEventListener('click', () => {
            const planId   = btn.dataset.planId;
            const gEl      = document.getElementById('bmg-promo-ground-select');
            const groundId = gEl ? gEl.value : (grounds[0]?.id || '');
            if (!groundId) { _toast('Please add a ground first', 'warning'); return; }
            window.initiatePromotionPayment && window.initiatePromotionPayment(planId, groundId);
          });
        });

        // Wire renew buttons
        container.querySelectorAll('.bmg-promote-renew-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const gEl = document.getElementById('bmg-promo-ground-select');
            const groundId = gEl ? gEl.value : (grounds[0]?.id || '');
            window.initiatePromotionPayment && window.initiatePromotionPayment(btn.dataset.renewPlan, groundId);
          });
        });

      } catch (err) {
        _hideLoading();
        console.error('[BMG Promote]', err);
        container.innerHTML = '<p style="text-align:center;padding:40px;color:#ef4444;">Failed to load promotion page.</p>';
      }
    };
  }

  /* ─────────────────────────────────────────────────────────────────
   * §6  CEO DASHBOARD — inject "Premium Revenue" tab
   * ─────────────────────────────────────────────────────────────────*/
  function patchCEODashboard() {
    // Patch loadCEODashboard to handle 'premium' tab
    const origCEO = window.loadCEODashboard;
    window.loadCEODashboard = async function (tab) {
      if (tab === 'premium') {
        const container = document.getElementById('ceo-dashboard-content');
        if (!container) return;
        // Update active tab styling
        document.querySelectorAll('.ceo-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        const tabEl = document.getElementById('ceo-premium-tab');
        if (tabEl) tabEl.classList.add('active');
        container.innerHTML = '<div class="loading-spinner"><div class="loader-spinner"></div></div>';
        await _loadCEOPremiumRevenue(container);
      } else {
        if (typeof origCEO === 'function') return origCEO.apply(this, arguments);
      }
    };

    // Inject "Premium Revenue" tab button into CEO tabs bar (DOM ready or onload)
    function _injectCEOTab() {
      const tabsBar = document.querySelector('.ceo-tabs');
      if (!tabsBar || document.getElementById('ceo-premium-tab')) return;
      const btn = document.createElement('button');
      btn.className = 'tab-btn';
      btn.id = 'ceo-premium-tab';
      btn.setAttribute('onclick', "window.loadCEODashboard('premium')");
      btn.innerHTML = '<i class="fas fa-crown"></i> Premium';
      tabsBar.appendChild(btn);
    }

    if (document.readyState !== 'loading') {
      setTimeout(_injectCEOTab, 500);
    } else {
      document.addEventListener('DOMContentLoaded', () => setTimeout(_injectCEOTab, 500));
    }

    // Re-inject whenever CEO dashboard page becomes active
    new MutationObserver((muts) => {
      for (const m of muts) {
        const node = m.target;
        if (node.id === 'ceo-dashboard-page' && node.classList.contains('active')) {
          setTimeout(_injectCEOTab, 200);
        }
      }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  async function _loadCEOPremiumRevenue(container) {
    _loading('Loading premium revenue…');
    try {
      // Fetch all promotions (active + expired)
      const promoSnap = await window.db.collection('ground_promotions')
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get();

      let totalRevenue  = 0;
      let activeRevenue = 0;
      let activeCount   = 0;
      const now = new Date();

      const promos = promoSnap.docs.map(d => {
        const p = { id: d.id, ...d.data() };
        const isActive = p.status === 'active' && p.expiresAt && p.expiresAt.toDate() > now;
        if (isActive) { activeRevenue += p.amount || 0; activeCount++; }
        totalRevenue += p.amount || 0;
        return { ...p, isActive };
      });

      // Plan breakdown
      const planBreakdown = {};
      promos.forEach(p => {
        const pid = p.planId || 'unknown';
        if (!planBreakdown[pid]) planBreakdown[pid] = { count: 0, revenue: 0 };
        planBreakdown[pid].count++;
        planBreakdown[pid].revenue += p.amount || 0;
      });

      const planBreakHtml = Object.entries(planBreakdown).map(([pid, info]) => {
        const plan = (window.BMG_PROMO_PLANS || {})[pid] || { name: pid, price: 0 };
        return `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f0f4ff;">
            <div>
              <div style="font-size:13px;font-weight:700;color:#0f1f5c;">${_esc(plan.name || pid)}</div>
              <div style="font-size:11px;color:#9ca3af;">${info.count} purchase${info.count !== 1 ? 's' : ''}</div>
            </div>
            <div style="font-size:16px;font-weight:800;color:#22c55e;">${_fmt(info.revenue)}</div>
          </div>`;
      }).join('');

      // Promo rows
      const promoRowsHtml = promos.slice(0, 50).map(p => {
        const plan = (window.BMG_PROMO_PLANS || {})[p.planId] || { name: p.planName || 'Plan' };
        const createdStr = p.createdAt?.toDate
          ? p.createdAt.toDate().toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })
          : 'N/A';
        const iconMap = {
          weekly:'⚡', monthly:'👑', city_top:'🏆', homepage_hero:'💎',
          verified:'✅', trusted_venue:'🛡️', premium_partner:'⭐'
        };
        const icon = iconMap[p.planId] || '🚀';
        const bgMap = {
          weekly:'#f8fafc', monthly:'#fffbeb', city_top:'#eff6ff',
          homepage_hero:'#fdf4ff', verified:'#f0fdf4', trusted_venue:'#fff7ed', premium_partner:'#fdf4ff'
        };
        return `
          <div class="bmg-ceo-promo-row">
            <div class="bmg-ceo-promo-row__icon" style="width:40px;height:40px;border-radius:12px;background:${bgMap[p.planId]||'#f8fafc'};display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">${icon}</div>
            <div class="bmg-ceo-promo-row__info" style="flex:1;min-width:0;">
              <div style="font-size:14px;font-weight:700;color:#0f1f5c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_esc(p.groundName || 'Ground')}</div>
              <div style="font-size:11px;color:#6b7280;">${_esc(plan.name)} · ${createdStr}</div>
            </div>
            <div style="text-align:right;flex-shrink:0;">
              <div style="font-size:15px;font-weight:800;color:#22c55e;">${_fmt(p.amount || 0)}</div>
              <span style="font-size:10px;font-weight:700;padding:3px 8px;border-radius:20px;${p.isActive ? 'background:#dcfce7;color:#15803d;' : 'background:#f1f5f9;color:#6b7280;'}">${p.isActive ? 'Active' : 'Expired'}</span>
            </div>
          </div>`;
      }).join('');

      container.innerHTML = `
        <!-- Revenue Hero Card -->
        <div style="background:linear-gradient(135deg,#0b1437,#1a237e,#7c3aed);border-radius:20px;padding:22px 18px;margin-bottom:18px;position:relative;overflow:hidden;color:#fff;">
          <div style="position:absolute;top:-20px;right:-20px;width:80px;height:80px;border-radius:50%;background:rgba(255,255,255,.08)"></div>
          <div style="font-size:12px;opacity:.65;letter-spacing:.5px;margin-bottom:4px;"><i class="fas fa-crown"></i> PREMIUM REVENUE</div>
          <div style="font-size:34px;font-weight:800;letter-spacing:-.5px;">${_fmt(totalRevenue)}</div>
          <div style="font-size:12px;opacity:.6;margin-top:4px;">Total from all promotion purchases</div>
          <div style="display:flex;gap:12px;margin-top:14px;">
            <div style="background:rgba(255,255,255,.1);border-radius:10px;padding:10px 14px;backdrop-filter:blur(6px);">
              <div style="font-size:11px;opacity:.7;">Active Now</div>
              <div style="font-size:20px;font-weight:800;">${_fmt(activeRevenue)}</div>
              <div style="font-size:10px;opacity:.6;">${activeCount} promotion${activeCount !== 1 ? 's' : ''}</div>
            </div>
            <div style="background:rgba(255,255,255,.1);border-radius:10px;padding:10px 14px;backdrop-filter:blur(6px);">
              <div style="font-size:11px;opacity:.7;">Total Sold</div>
              <div style="font-size:20px;font-weight:800;">${promos.length}</div>
              <div style="font-size:10px;opacity:.6;">all time</div>
            </div>
          </div>
        </div>

        <!-- Plan Breakdown -->
        <div style="background:#fff;border-radius:16px;padding:16px;margin-bottom:18px;border:1.5px solid #f0f4ff;">
          <div style="font-size:14px;font-weight:800;color:#0f1f5c;margin-bottom:12px;"><i class="fas fa-chart-pie" style="color:#7c3aed;"></i> Revenue by Plan</div>
          ${planBreakHtml || '<p style="color:#9ca3af;text-align:center;padding:12px;">No promotions sold yet.</p>'}
        </div>

        <!-- All Promo Purchases -->
        <div style="font-size:15px;font-weight:800;color:#0f1f5c;margin-bottom:12px;">
          <i class="fas fa-list" style="color:#2563eb;"></i> All Purchases
          <span style="font-weight:400;font-size:12px;color:#9ca3af;margin-left:8px;">${promos.length} total</span>
        </div>
        ${promos.length === 0
          ? '<div style="text-align:center;padding:32px;color:#9ca3af;"><i class="fas fa-crown" style="font-size:2rem;opacity:.3;display:block;margin-bottom:8px;"></i>No promotions sold yet</div>'
          : promoRowsHtml}
      `;

      _hideLoading();
    } catch (err) {
      _hideLoading();
      container.innerHTML = `<p style="color:red;text-align:center;">${err.message}</p>`;
    }
  }

  /* ─────────────────────────────────────────────────────────────────
   * §7  SECURITY — Block admin/CEO pages from user/owner roles
   * ─────────────────────────────────────────────────────────────────*/
  function patchDashboardSecurity() {
    // Patch showPage to block admin/CEO pages for non-admin roles
    const origShowPage = window.showPage;
    if (typeof origShowPage === 'function') {
      window.showPage = function (pageId) {
        const cu = window.currentUser;
        const restricted = ['admin-dashboard-page', 'ceo-dashboard-page'];
        if (restricted.includes(pageId)) {
          if (!cu || (cu.role !== 'admin' && cu.role !== 'ceo')) {
            console.warn('[BMG Security] Blocked access to', pageId, 'for role', cu?.role);
            _toast('Access denied', 'error');
            return;
          }
        }
        return origShowPage.apply(this, arguments);
      };
    }
  }

  /* ─────────────────────────────────────────────────────────────────
   * §8  VERIFIED / TRUST BADGES on ground listings
   *     Patches renderGroundCard to append premium badges
   * ─────────────────────────────────────────────────────────────────*/
  async function _enrichGroundCardWithBadges(groundId, cardEl) {
    if (!groundId || !cardEl) return;
    try {
      const snap = await window.db.collection('ground_promotions')
        .where('groundId', '==', groundId)
        .where('status', '==', 'active')
        .limit(1)
        .get();
      if (snap.empty) return;
      const promo = snap.docs[0].data();
      if (promo.expiresAt && promo.expiresAt.toDate() < new Date()) return;

      const labelsDiv = cardEl.querySelector('.bmg-ground-labels') || (() => {
        const d = document.createElement('div');
        d.className = 'bmg-ground-labels';
        // Try to append inside venue-type-badge or at end of card body
        const body = cardEl.querySelector('.ground-info, .venue-content, .ground-card-body, .card-body');
        if (body) body.appendChild(d);
        else cardEl.appendChild(d);
        return d;
      })();

      const badgeMap = {
        city_top:        '<span class="bmg-listing-badge bmg-badge-citytop">🏆 City Top</span><span class="bmg-listing-badge bmg-badge-trending">🔥 Trending</span>',
        homepage_hero:   '<span class="bmg-listing-badge bmg-badge-partner">💎 Hero Sponsor</span><span class="bmg-listing-badge bmg-badge-recommended">⭐ Recommended</span>',
        premium_partner: '<span class="bmg-listing-badge bmg-badge-partner">⭐ Premium Partner</span>',
        monthly:         '<span class="bmg-listing-badge bmg-badge-mostbooked">📈 Most Booked</span>',
        trusted_venue:   '<span class="bmg-listing-badge bmg-badge-trusted">🛡️ Trusted Venue</span>',
        verified:        '<span class="bmg-listing-badge bmg-badge-verified">✅ Verified</span>',
      };

      const html = badgeMap[promo.planId] || '<span class="bmg-listing-badge bmg-badge-featured">⭐ Featured</span>';
      labelsDiv.insertAdjacentHTML('beforeend', html);
    } catch (e) { /* silent */ }
  }

  // Observe DOM for new ground cards and enrich them
  function watchGroundCards() {
    function processCard(el) {
      const groundId = el.dataset.groundId || el.dataset.id;
      if (!groundId || el.dataset.premiumEnriched) return;
      el.dataset.premiumEnriched = '1';
      _enrichGroundCardWithBadges(groundId, el);
    }

    document.querySelectorAll('[data-ground-id],[data-id]').forEach(el => {
      if (el.classList.contains('ground-card') || el.classList.contains('bmg-feat-card')
        || el.classList.contains('venue-card')) {
        processCard(el);
      }
    });

    new MutationObserver(muts => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.classList && (n.classList.contains('ground-card') || n.classList.contains('venue-card'))) {
            processCard(n);
          }
          n.querySelectorAll && n.querySelectorAll('.ground-card,.venue-card').forEach(processCard);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  /* ─────────────────────────────────────────────────────────────────
   * §9  BOOT
   * ─────────────────────────────────────────────────────────────────*/
  function onReady(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  onReady(function () {
    injectPremiumStyles();
    patchFeaturedGrounds();
    patchOwnerPromotePage();
    patchCEODashboard();
    patchDashboardSecurity();

    // Wait a tick for app.js to define db + currentUser
    setTimeout(() => {
      watchGroundCards();
    }, 800);

    // Re-run featured loader when main page opens
    window.addEventListener('bmg:pageShown', function (e) {
      if (e.detail?.pageId === 'main-page') {
        window.loadBmgFeaturedGrounds && window.loadBmgFeaturedGrounds();
      }
    });

    console.log('✅ [BMG Premium Features v1] Loaded — Featured Ads, Verified Badges, CEO Revenue Tab');
  });

})(); // end IIFE

/* ╔══════════════════════════════════════════════════════════════════╗
   ║  SECTION 7 — BOOKINGS LAYOUT PATCH v3                           ║
   ║  (from bookings_layout_patch.js — full, unmodified IIFE)        ║
   ╚══════════════════════════════════════════════════════════════════╝ */
/**
 * bookings_layout_patch.js  v3 — COMPLETE REWRITE
 * ─────────────────────────────────────────────────────────────────────
 * Fixes:
 *  1. Directly queries Firestore — no dependency on hidden DOM containers
 *     (#pool-passes-section was display:none so loadPoolBookings bailed early)
 *  2. Single professional card column per tab (no cramped 2-col grid)
 *  3. Correct status field: checks both `status` and `bookingStatus`
 *  4. Pool Pass "Show Pass" always calls showPoolEntryPass()
 * ─────────────────────────────────────────────────────────────────────
 */
(function () {
    'use strict';

    /* ── helpers ──────────────────────────────────────────────── */
    function $(id) { return document.getElementById(id); }
    function waitFor(name, cb, delay) {
        if (window[name]) { cb(); return; }
        setTimeout(function () { waitFor(name, cb, delay || 300); }, delay || 300);
    }
    function formatDate(str) {
        try {
            return new Date(str).toLocaleDateString('en-IN', {
                weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
            });
        } catch (e) { return str || '—'; }
    }
    function sportIcon(sport) {
        var map = { cricket:'🏏', football:'⚽', badminton:'🏸', tennis:'🎾',
                    basketball:'🏀', volleyball:'🏐', swimming:'🏊', multi:'🎯' };
        return map[(sport || '').toLowerCase()] || '🏟️';
    }

    /* ── State ────────────────────────────────────────────────── */
    var currentTab = 'upcoming';

    /* ══════════════════════════════════════════════════════════
       BUILD UI (once)
    ══════════════════════════════════════════════════════════ */
    function buildUI() {
        var page = $('bookings-page');
        if (!page || $('bmg-tab-bar')) return;

        /* Tab bar */
        var tabBar = document.createElement('div');
        tabBar.id = 'bmg-tab-bar';
        tabBar.className = 'bmg-tab-bar';
        tabBar.innerHTML =
            '<button class="bmg-tab-btn active" data-tab="upcoming">' +
              '<span class="bmg-tab-icon">📅</span><span>Upcoming</span>' +
            '</button>' +
            '<button class="bmg-tab-btn" data-tab="past">' +
              '<span class="bmg-tab-icon">🗂️</span><span>Past</span>' +
            '</button>' +
            '<button class="bmg-tab-btn" data-tab="pools">' +
              '<span class="bmg-tab-icon">🏊</span><span>Pool Passes</span>' +
              '<span class="bmg-tab-pill" id="bmg-pool-pill"></span>' +
            '</button>';

        /* Panels */
        var panelUp   = makePanelEl('upcoming');
        var panelPast = makePanelEl('past');
        var panelPool = makePanelEl('pools');

        var header = page.querySelector('.page-header');
        var ref = header ? header.nextSibling : page.firstChild;
        [tabBar, panelUp, panelPast, panelPool].forEach(function (el) {
            page.insertBefore(el, ref);
        });

        tabBar.querySelectorAll('.bmg-tab-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                switchTab(btn.getAttribute('data-tab'));
            });
        });

        console.log('[bmg v3] UI built');
    }

    function makePanelEl(tab) {
        var el = document.createElement('div');
        el.id = 'bmg-panel-' + tab;
        el.className = 'bmg-tab-panel' + (tab === 'upcoming' ? ' active' : '');
        el.innerHTML = '<div class="bmg-loading"><div class="loader-spinner"></div></div>';
        return el;
    }

    /* ══════════════════════════════════════════════════════════
       SWITCH TABS
    ══════════════════════════════════════════════════════════ */
    function switchTab(tab) {
        currentTab = tab;
        var tabBar = $('bmg-tab-bar');
        if (tabBar) {
            tabBar.querySelectorAll('.bmg-tab-btn').forEach(function (b) {
                b.classList.toggle('active', b.getAttribute('data-tab') === tab);
            });
        }
        ['upcoming','past','pools'].forEach(function (t) {
            var p = $('bmg-panel-' + t);
            if (p) p.classList.toggle('active', t === tab);
        });
        loadTab(tab);
    }

    /* ══════════════════════════════════════════════════════════
       LOAD TAB DATA — direct Firestore queries
    ══════════════════════════════════════════════════════════ */
    function loadTab(tab) {
        var user = window.currentUser ||
            (window.firebase && window.firebase.auth && window.firebase.auth().currentUser);
        if (!user) {
            setPanel(tab, errorHTML('🔒', 'Please log in to view bookings'));
            return;
        }
        if (tab === 'pools') {
            loadPoolPanel(user);
        } else {
            loadGroundAndPoolColumns(tab, user);
        }
    }

    /* ── Upcoming / Past: two sections stacked ──────────────── */
    function loadGroundAndPoolColumns(status, user) {
        var panel = $('bmg-panel-' + status);
        if (!panel) return;
        panel.innerHTML =
            '<div id="bmg-sec-grounds-' + status + '" class="bmg-section">' +
              '<div class="bmg-sec-head bmg-sec-head--grounds">' +
                '<span>🏟️</span><span>Ground Bookings</span>' +
                '<span class="bmg-sec-count" id="bmg-gc-' + status + '"></span>' +
              '</div>' +
              '<div id="bmg-grounds-body-' + status + '" class="bmg-cards-wrap">' +
                '<div class="bmg-loading"><div class="loader-spinner"></div></div>' +
              '</div>' +
            '</div>' +
            '<div id="bmg-sec-pools-' + status + '" class="bmg-section">' +
              '<div class="bmg-sec-head bmg-sec-head--pools">' +
                '<span>🏊</span><span>Pool Passes</span>' +
                '<span class="bmg-sec-count" id="bmg-pc-' + status + '"></span>' +
              '</div>' +
              '<div id="bmg-pools-body-' + status + '" class="bmg-cards-wrap">' +
                '<div class="bmg-loading"><div class="loader-spinner"></div></div>' +
              '</div>' +
            '</div>';

        fetchGrounds(status, user);
        fetchPools(status, user);
    }

    /* ── Ground bookings ─────────────────────────────────────── */
    async function fetchGrounds(status, user) {
        var dest = $('bmg-grounds-body-' + status);
        var countEl = $('bmg-gc-' + status);
        if (!dest) return;

        var today = new Date().toISOString().split('T')[0];
        try {
            var db = window.db;
            var snap = await db.collection('bookings')
                .where('userId', '==', user.uid)
                .orderBy('createdAt', 'desc')
                .get()
                .catch(function () {
                    return db.collection('bookings').where('userId', '==', user.uid).get();
                });

            var list = [];
            snap.forEach(function (doc) {
                var d = doc.data();
                d._id = doc.id;
                var bSt = d.bookingStatus || d.status || '';
                var dt  = d.date || d.dateStr || '';
                var isPast = dt < today;
                var isCancelled = bSt === 'cancelled';
                var isCompleted = bSt === 'completed';
                var isConfirmed = bSt === 'confirmed';

                if (status === 'upcoming' && dt >= today && isConfirmed) list.push(d);
                if (status === 'past' && (isPast || isCompleted || isCancelled)) list.push(d);
            });

            if (status === 'past') list.sort(function (a,b) { return (b.date||'') > (a.date||'') ? 1 : -1; });
            else list.sort(function (a,b) { return (a.date||'') > (b.date||'') ? 1 : -1; });

            if (countEl) countEl.textContent = list.length;

            if (!list.length) {
                dest.innerHTML = emptyHTML('🏟️', 'No ' + status + ' ground bookings');
                return;
            }

            dest.innerHTML = list.map(function (b) {
                var bSt  = b.bookingStatus || b.status || '';
                var sc   = statusCfg(bSt);
                var icon = sportIcon(b.sportType);
                var passed = (b.date || '') < today && bSt !== 'completed';
                return (
                    '<div class="bmg-card bmg-card--' + sc.cls + '">' +
                      '<div class="bmg-card-header">' +
                        '<div class="bmg-card-badge">' + icon + '</div>' +
                        '<div class="bmg-card-title">' +
                          '<div class="bmg-card-name">' + (b.groundName || 'Ground') + '</div>' +
                          '<div class="bmg-card-sub">' + (b.venueName || '') + '</div>' +
                        '</div>' +
                        '<div class="bmg-status-pill bmg-status-pill--' + sc.cls + '">' +
                          '<i class="fas ' + sc.icon + '"></i> ' + sc.label +
                        '</div>' +
                      '</div>' +
                      '<div class="bmg-card-body">' +
                        '<div class="bmg-info-row"><i class="fas fa-calendar-alt"></i>' + formatDate(b.date) + '</div>' +
                        '<div class="bmg-info-row"><i class="fas fa-clock"></i>' + (b.slotTime || 'Time TBD') + '</div>' +
                        '<div class="bmg-info-row"><i class="fas fa-map-marker-alt"></i>' + (b.groundAddress || b.venueAddress || 'Address N/A') + '</div>' +
                        '<div class="bmg-info-row"><i class="fas fa-rupee-sign"></i><strong>' + (b.amount ? '₹' + b.amount : '—') + '</strong></div>' +
                      '</div>' +
                      (passed ? '<div class="bmg-alert"><i class="fas fa-exclamation-circle"></i> Booking date has passed</div>' : '') +
                      '<div class="bmg-card-footer">' +
                        '<span class="bmg-booking-id"><i class="fas fa-hashtag"></i> ' + ((b.bookingId || b._id || '').slice(-8)) + '</span>' +
                        (bSt === 'confirmed' ? '<button class="bmg-pass-btn" onclick="showEntryPass(\'' + (b.bookingId || b._id) + '\')"><i class="fas fa-qrcode"></i> Entry Pass</button>' : '') +
                        (bSt === 'completed' ? '<span class="bmg-done-chip"><i class="fas fa-check-double"></i> Completed</span>' : '') +
                        (bSt === 'cancelled' ? '<span class="bmg-cancel-chip"><i class="fas fa-ban"></i> Cancelled</span>' : '') +
                      '</div>' +
                    '</div>'
                );
            }).join('');
        } catch (err) {
            console.error('[bmg v3] ground fetch error:', err);
            dest.innerHTML = errorHTML('⚠️', 'Could not load ground bookings');
        }
    }

    /* ── Pool bookings (column inside Upcoming/Past) ──────────── */
    async function fetchPools(status, user) {
        var dest    = $('bmg-pools-body-' + status);
        var countEl = $('bmg-pc-' + status);
        if (!dest) return;

        var today = new Date().toISOString().split('T')[0];
        try {
            var db   = window.db;
            var snap = await db.collection('pool_bookings')
                .where('userId', '==', user.uid)
                .orderBy('createdAt', 'desc')
                .get()
                .catch(function () {
                    return db.collection('pool_bookings').where('userId', '==', user.uid).get();
                });

            var list = [];
            snap.forEach(function (doc) {
                var d  = doc.data(); d._id = doc.id;
                var bSt = d.status || d.bookingStatus || '';
                var dt  = d.date || '';
                var isPast = dt < today;
                var isCancelled = bSt === 'cancelled';
                var isConfirmed = bSt === 'confirmed';

                if (status === 'upcoming' && dt >= today && isConfirmed && !isCancelled) list.push(d);
                if (status === 'past' && (isPast || isCancelled)) list.push(d);
            });

            if (status === 'past') list.sort(function (a,b) { return (b.date||'') > (a.date||'') ? 1 : -1; });
            else list.sort(function (a,b) { return (a.date||'') > (b.date||'') ? 1 : -1; });

            if (countEl) countEl.textContent = list.length;

            if (!list.length) {
                dest.innerHTML = emptyHTML('🏊', 'No ' + status + ' pool passes');
                return;
            }

            dest.innerHTML = list.map(function (b) { return poolCardHTML(b, status, today); }).join('');
        } catch (err) {
            console.error('[bmg v3] pool column fetch error:', err);
            dest.innerHTML = errorHTML('⚠️', 'Could not load pool passes');
        }
    }

    /* ── Full Pool Passes tab ──────────────────────────────────── */
    async function loadPoolPanel(user) {
        var panel = $('bmg-panel-pools');
        if (!panel) return;
        panel.innerHTML = '<div class="bmg-loading"><div class="loader-spinner"></div></div>';

        var today = new Date().toISOString().split('T')[0];
        try {
            var db   = window.db;
            var snap = await db.collection('pool_bookings')
                .where('userId', '==', user.uid)
                .orderBy('createdAt', 'desc')
                .get()
                .catch(function () {
                    return db.collection('pool_bookings').where('userId', '==', user.uid).get();
                });

            var pill = $('bmg-pool-pill');
            if (snap.empty) {
                panel.innerHTML = emptyHTML('🏊', 'No pool passes yet');
                if (pill) pill.textContent = '';
                return;
            }

            var list = [];
            snap.forEach(function (doc) {
                var d = doc.data(); d._id = doc.id;
                list.push(d);
            });

            if (pill) pill.textContent = list.length;

            panel.innerHTML =
                '<div class="bmg-section">' +
                  '<div class="bmg-sec-head bmg-sec-head--pools">' +
                    '<span>🏊</span><span>All Pool Passes</span>' +
                    '<span class="bmg-sec-count">' + list.length + '</span>' +
                  '</div>' +
                  '<div class="bmg-cards-wrap">' +
                    list.map(function (b) { return poolCardHTML(b, null, today); }).join('') +
                  '</div>' +
                '</div>';
        } catch (err) {
            console.error('[bmg v3] pool panel error:', err);
            panel.innerHTML = errorHTML('⚠️', 'Could not load pool passes');
        }
    }

    /* ── Pool card HTML ─────────────────────────────────────────── */
    function poolCardHTML(b, status, today) {
        var bSt      = b.status || b.bookingStatus || '';
        var dt       = b.date || '';
        var isPast   = dt < today;
        var stLabel  = isPast ? 'Past' : (bSt === 'confirmed' ? 'Upcoming' : bSt.toUpperCase() || 'Unknown');
        var stCls    = isPast ? 'past' : (bSt === 'confirmed' ? 'confirmed' : 'pending');
        var stIcon   = isPast ? 'fa-flag-checkered' : (bSt === 'confirmed' ? 'fa-check-circle' : 'fa-hourglass-half');
        var id       = b.bookingId || b.orderId || b._id || '';
        var docId    = b._id || id;
        var members  = b.memberCount || b.currentMembers || 1;
        var amount   = b.amount ? '₹' + b.amount : '—';
        var isUpcoming = !isPast && bSt === 'confirmed';

        return (
            '<div class="bmg-card bmg-pool-card bmg-card--' + stCls + '">' +
              '<div class="bmg-card-header bmg-pool-header">' +
                '<div class="bmg-card-badge bmg-pool-badge">🏊</div>' +
                '<div class="bmg-card-title">' +
                  '<div class="bmg-card-name">' + (b.poolName || b.poolTitle || 'Swimming Pool') + '</div>' +
                  '<div class="bmg-card-sub">' + (b.poolAddress || '') + '</div>' +
                '</div>' +
                '<div class="bmg-status-pill bmg-status-pill--' + stCls + '">' +
                  '<i class="fas ' + stIcon + '"></i> ' + stLabel +
                '</div>' +
              '</div>' +
              '<div class="bmg-card-body">' +
                '<div class="bmg-info-row"><i class="fas fa-calendar-alt"></i>' + formatDate(dt) + '</div>' +
                '<div class="bmg-info-row"><i class="fas fa-clock"></i>' + (b.slotTime || '—') + '</div>' +
                '<div class="bmg-info-row"><i class="fas fa-users"></i>' + members + ' Member' + (members > 1 ? 's' : '') + '</div>' +
                '<div class="bmg-info-row"><i class="fas fa-rupee-sign"></i><strong>' + amount + '</strong></div>' +
              '</div>' +
              '<div class="bmg-card-footer">' +
                '<span class="bmg-booking-id"><i class="fas fa-hashtag"></i> ' + id.slice(-8) + '</span>' +
                '<div class="bmg-card-actions">' +
                  '<button class="bmg-pass-btn bmg-pool-btn" onclick="showPoolEntryPass(\'' + id + '\')">' +
                    '<i class="fas fa-qrcode"></i> Show Pass' +
                  '</button>' +
                  (isUpcoming ? '<button class="bmg-cancel-btn" onclick="cancelPoolBooking(\'' + docId + '\')"><i class="fas fa-times"></i> Cancel</button>' : '') +
                '</div>' +
              '</div>' +
            '</div>'
        );
    }

    /* ── Status config ───────────────────────────────────────── */
    function statusCfg(bSt) {
        var map = {
            confirmed:       { icon:'fa-check-circle',    label:'Confirmed',       cls:'confirmed' },
            pending_payment: { icon:'fa-hourglass-half',  label:'Pending Payment', cls:'pending' },
            cancelled:       { icon:'fa-times-circle',    label:'Cancelled',       cls:'cancelled' },
            completed:       { icon:'fa-flag-checkered',  label:'Completed',       cls:'completed' },
        };
        return map[bSt] || { icon:'fa-circle', label: bSt || 'Unknown', cls:'pending' };
    }

    /* ── Small HTML helpers ──────────────────────────────────── */
    function emptyHTML(icon, msg) {
        return '<div class="bmg-empty"><div class="bmg-empty-icon">' + icon + '</div><div class="bmg-empty-msg">' + msg + '</div></div>';
    }
    function errorHTML(icon, msg) {
        return '<div class="bmg-empty bmg-empty--error"><div class="bmg-empty-icon">' + icon + '</div><div class="bmg-empty-msg">' + msg + '</div></div>';
    }
    function setPanel(tab, html) {
        var p = $('bmg-panel-' + tab);
        if (p) p.innerHTML = html;
    }

    /* ══════════════════════════════════════════════════════════
       INIT
    ══════════════════════════════════════════════════════════ */
    function init() {
        buildUI();
    }

    function watchPage() {
        var page = $('bookings-page');
        if (!page) return;
        var first = true;
        new MutationObserver(function (muts) {
            muts.forEach(function (m) {
                if (m.attributeName === 'class' && page.classList.contains('active')) {
                    if (first) {
                        first = false;
                        init();
                        setTimeout(function () { switchTab('upcoming'); }, 150);
                    } else {
                        setTimeout(function () { switchTab(currentTab); }, 150);
                    }
                }
            });
        }).observe(page, { attributes: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { init(); watchPage(); });
    } else {
        init();
        watchPage();
    }

    window.addEventListener('load', function () {
        /* If page is already active (e.g. deep-link), trigger load */
        var page = $('bookings-page');
        if (page && page.classList.contains('active')) {
            if (!$('bmg-tab-bar')) init();
            setTimeout(function () { switchTab(currentTab); }, 200);
        }
    });

    window.bmgSwitchBookingTab = switchTab;
    console.log('[bmg v3] bookings_layout_patch.js loaded');
})();

/* ╔══════════════════════════════════════════════════════════════════╗
   ║  SECTION 8 — OWNER LISTING & VERIFICATION PATCH                 ║
   ║  (from owner_listing_verification_patch.js — full, unmodified)  ║
   ╚══════════════════════════════════════════════════════════════════╝ */
/* ═══════════════════════════════════════════════════════════════════════
   owner_listing_verification_patch.js  v1.0
   ───────────────────────────────────────────────────────────────────────
   WHAT THIS PATCH ADDS
   ════════════════════
   1. OWNER VERIFICATION — PROPERTY IMAGES
      • Adds a new Step 3 "Property Images" to the existing verification
        flow (after ID + address).
      • Grounds owners upload Ground Photos (min 2, max 6).
      • Pool owners upload Swimming Pool Photos (min 2, max 6).
      • Images are uploaded to Cloudinary into the owner's own folder.
      • The owner doc gets groundImagesUploaded / poolImagesUploaded flags
        and a propertyImagesVerified flag.
      • The progress stepper updates to show 4 steps.

   2. ADD SWIMMING POOL (owner dashboard → new "Pools" tab)
      • New "Pools" tab added next to "Grounds" tab in the owner dashboard.
      • Full multi-step modal form to create a swimming pool:
          – Step 1: Basic info (name, city, address, price/session)
          – Step 2: Facilities (timings, capacity, amenities)
          – Step 3: Upload pool photos (via Cloudinary, 2-6 images)
      • Pool is saved to `swimming_pools` collection.
      • canAddPool() mirrors canAddGround() permission gate.

   3. ADD GROUND — improvement
      • "Grounds" tab now also shown even if owner already has grounds,
        with a visible "+ Add Ground" button that respects the existing
        canAddGround() gate.

   INSTALL
   ═══════
   Add LAST in index.html (after all other patch scripts):
     <script src="owner_listing_verification_patch.js"></script>

   DEPENDENCIES
   ════════════
   • app.js (db, currentUser, COLLECTIONS, showToast, showLoading,
             hideLoading, generateId, uploadVerificationDocument,
             loadOwnerDashboard, canAddGround, escapeHtml)
   • Cloudinary widget / uploadVerificationDocument from app.js
   • Firebase Firestore + Storage (already initialised in app.js)
═══════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var LOG = '[owner-listing-patch]';
  function log(m)  { console.log(LOG + ' ' + m); }

  /* ─────────────────────────────────────────────────────────────────
     HELPERS
  ───────────────────────────────────────────────────────────────── */
  function esc(s) {
    if (typeof escapeHtml === 'function') return escapeHtml(String(s || ''));
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function toast(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type || 'info');
    else alert(msg);
  }

  function spinStart(msg) { if (typeof showLoading === 'function') showLoading(msg || 'Loading…'); }
  function spinStop()     { if (typeof hideLoading === 'function') hideLoading(); }

  function gid(id) { return document.getElementById(id); }

  /* Upload image file to Cloudinary, returns secure_url Promise */
  function uploadImageToCloudinary(file, folder, onProgress) {
    return new Promise(function (resolve, reject) {
      var cfg = window.CLOUDINARY_CONFIG;
      if (!cfg || !cfg.cloudName || !cfg.uploadPreset) {
        return reject(new Error('Cloudinary not configured'));
      }
      if (file.size > 8 * 1024 * 1024) return reject(new Error('File must be < 8 MB'));
      var ok = ['image/jpeg','image/png','image/jpg','image/webp'];
      if (!ok.includes(file.type)) return reject(new Error('Only JPEG / PNG / WebP images'));

      var fd = new FormData();
      fd.append('file', file);
      fd.append('upload_preset', cfg.uploadPreset);
      fd.append('folder', folder);

      var xhr = new XMLHttpRequest();
      xhr.upload.addEventListener('progress', function (e) {
        if (e.lengthComputable && onProgress) onProgress(Math.round(e.loaded / e.total * 100));
      });
      xhr.onload = function () {
        if (xhr.status === 200) {
          try {
            var r = JSON.parse(xhr.responseText);
            resolve(r.secure_url || r.url);
          } catch(ex) { reject(new Error('Bad server response')); }
        } else { reject(new Error('Upload failed (' + xhr.status + ')')); }
      };
      xhr.onerror = function () { reject(new Error('Network error')); };
      xhr.open('POST', 'https://api.cloudinary.com/v1_1/' + cfg.cloudName + '/image/upload');
      xhr.send(fd);
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     PART 1 — PROPERTY IMAGE UPLOAD IN VERIFICATION
  ═══════════════════════════════════════════════════════════════ */

  /**
   * Checks if property image upload step should be shown.
   * Shown when owner is fully ID-verified + address-verified but
   * has NOT yet uploaded property images.
   */
  async function getPropertyImageStatus(owner) {
    return {
      needed: owner.documentVerified === true && owner.isVerified === true && !owner.propertyImagesVerified,
      uploaded: owner.propertyImagesVerified === true,
      pending: owner.propertyImagesPending === true,
      rejected: owner.propertyImagesRejected === true,
      rejectionReason: owner.propertyImagesRejectionReason || ''
    };
  }

  /**
   * Injects the property images section into the verification container.
   * Called by patchLoadOwnerVerification().
   */
  async function appendPropertyImagesSection(container, owner) {
    var status = await getPropertyImageStatus(owner);
    if (!status.needed && !status.uploaded && !status.pending && !status.rejected) return;

    /* ── Determine owner type ── */
    var isPool = false;
    try {
      var poolSnap = await db.collection('swimming_pools')
        .where('ownerId', '==', currentUser.uid).limit(1).get();
      isPool = !poolSnap.empty;
    } catch(e) {}
    var hasGround = false;
    try {
      var gSnap = await db.collection(COLLECTIONS.GROUNDS)
        .where('ownerId', '==', currentUser.uid).limit(1).get();
      hasGround = !gSnap.empty;
    } catch(e) {}

    /* ── Build HTML ── */
    var label   = isPool ? 'Swimming Pool' : 'Ground';
    var icon    = isPool ? 'fa-swimming-pool' : 'fa-futbol';
    var tip1    = isPool ? 'Show the pool area and facilities clearly' : 'Show the ground surface and surroundings clearly';

    var sectionHtml = '';

    if (status.uploaded) {
      sectionHtml = `
        <div class="verification-request-card" style="border-left:4px solid #22c55e;margin-top:14px;">
          <div class="verification-request-header">
            <div class="request-id"><i class="fas ${icon}" style="color:#0ea5e9;margin-right:6px;"></i>
              <span>${label} Photos — Verified</span></div>
          </div>
          <div class="request-status-badge pending" style="background:#dcfce7;color:#15803d;margin-top:10px;">
            <i class="fas fa-check-circle"></i> Property images approved
          </div>
        </div>`;
    } else if (status.pending) {
      sectionHtml = `
        <div class="verification-request-card" style="border-left:4px solid #f59e0b;margin-top:14px;">
          <div class="verification-request-header">
            <div class="request-id"><i class="fas ${icon}" style="color:#0ea5e9;margin-right:6px;"></i>
              <span>${label} Photos — Under Review</span></div>
          </div>
          <div class="request-status-badge pending" style="margin-top:10px;">
            <i class="fas fa-clock"></i> Your property photos are being reviewed (1-2 business days)
          </div>
        </div>`;
    } else if (status.rejected) {
      sectionHtml = `
        <div class="verification-request-card" style="border-left:4px solid #ef4444;margin-top:14px;">
          <div class="verification-request-header">
            <div class="request-id"><i class="fas ${icon}" style="color:#ef4444;margin-right:6px;"></i>
              <span>${label} Photos — Rejected</span></div>
          </div>
          <div class="rejection-reason" style="margin:10px 0;background:rgba(239,68,68,0.1);padding:10px;border-radius:8px;">
            <i class="fas fa-exclamation-triangle"></i>
            <strong>Reason:</strong> ${esc(status.rejectionReason || 'Photos did not meet requirements')}
          </div>
        </div>`;
      /* Fall-through to show upload form again after rejection */
    }

    if (status.needed || status.rejected) {
      sectionHtml += `
        <div class="verification-form-card" id="bmgp-prop-images-card" style="margin-top:14px;">
          <div class="verification-form-title">
            <i class="fas ${icon}"></i>
            <span>Upload ${label} Photos</span>
          </div>
          <div class="verification-form-subtitle">
            <i class="fas fa-info-circle"></i>
            Upload clear photos of your ${label.toLowerCase()} (min 2, max 6 images). 
            This is the final step to activate your listing.
          </div>
          <div class="info-banner" style="background:linear-gradient(135deg,#f0f9ff,#e0f2fe);margin-bottom:16px;">
            <i class="fas fa-lightbulb" style="color:#0ea5e9;"></i>
            <div>
              <strong>Photo Tips:</strong>
              <ul style="margin:6px 0 0 18px;">
                <li>${tip1}</li>
                <li>Use natural daylight for best results</li>
                <li>Min 2, max 6 photos — JPEG/PNG, max 5 MB each</li>
              </ul>
            </div>
          </div>

          <!-- Drop zone -->
          <div id="bmgp-prop-dropzone" style="
              border:2px dashed #bfdbfe;border-radius:14px;
              background:#f8faff;padding:24px;text-align:center;
              cursor:pointer;transition:all .2s;margin-bottom:12px;">
            <i class="fas fa-cloud-upload-alt" style="font-size:28px;color:#2563eb;margin-bottom:8px;"></i>
            <div style="font-size:14px;font-weight:700;color:#0f1f5c;margin-bottom:4px;">
              Click or drag photos here
            </div>
            <div style="font-size:12px;color:#9ca3af;">JPEG / PNG / WebP • max 5 MB each</div>
            <input type="file" id="bmgp-prop-file-input" accept="image/jpeg,image/png,image/jpg,image/webp"
              multiple style="display:none;">
          </div>

          <!-- Preview grid -->
          <div id="bmgp-prop-preview-grid" style="
              display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px;"></div>

          <!-- Upload progress -->
          <div id="bmgp-prop-progress" style="display:none;margin-bottom:12px;">
            <div style="background:#e8edf8;border-radius:8px;height:8px;overflow:hidden;">
              <div id="bmgp-prop-progress-fill"
                style="height:100%;background:linear-gradient(135deg,#2563eb,#0ea5e9);width:0%;transition:width .3s;border-radius:8px;"></div>
            </div>
            <div id="bmgp-prop-progress-text"
              style="font-size:11px;color:#6b7280;font-weight:600;margin-top:5px;text-align:center;">
              Uploading…
            </div>
          </div>

          <button id="bmgp-prop-submit-btn" class="verification-submit-btn" disabled
            style="opacity:.5;cursor:not-allowed;">
            <i class="fas fa-paper-plane"></i> Submit ${label} Photos
          </button>
        </div>`;
    }

    if (!sectionHtml) return;

    var wrapper = document.createElement('div');
    wrapper.id = 'bmgp-property-images-section';
    wrapper.innerHTML = sectionHtml;
    container.appendChild(wrapper);

    if (status.needed || status.rejected) {
      initPropertyImageUploadUI(label, icon);
    }

    /* Update progress stepper to show step 3 */
    var steps = container.querySelectorAll('.progress-step');
    if (steps.length === 3) {
      var lastStep = steps[2];
      if (status.uploaded) lastStep.classList.add('completed');
      else if (status.pending) lastStep.classList.add('active');

      /* Insert a 4th step */
      var step4 = document.createElement('div');
      step4.className = 'progress-step' + (status.uploaded ? ' completed' : (status.needed || status.rejected ? ' active' : ''));
      step4.innerHTML = '<div class="step-circle">3</div><div class="step-label">Property Photos</div>';
      lastStep.parentNode.insertBefore(step4, lastStep.nextSibling);
    }
  }

  var _propFiles = [];

  function initPropertyImageUploadUI(label) {
    var dropzone  = gid('bmgp-prop-dropzone');
    var fileInput = gid('bmgp-prop-file-input');
    var preview   = gid('bmgp-prop-preview-grid');
    var submitBtn = gid('bmgp-prop-submit-btn');

    if (!dropzone || !fileInput) return;

    _propFiles = [];

    dropzone.addEventListener('click', function () { fileInput.click(); });
    dropzone.addEventListener('dragover', function (e) {
      e.preventDefault(); dropzone.style.borderColor = '#2563eb'; dropzone.style.background = '#eff6ff';
    });
    dropzone.addEventListener('dragleave', function () {
      dropzone.style.borderColor = '#bfdbfe'; dropzone.style.background = '#f8faff';
    });
    dropzone.addEventListener('drop', function (e) {
      e.preventDefault(); dropzone.style.borderColor = '#bfdbfe'; dropzone.style.background = '#f8faff';
      handlePropFiles(Array.from(e.dataTransfer.files));
    });
    fileInput.addEventListener('change', function () {
      handlePropFiles(Array.from(fileInput.files));
      fileInput.value = '';
    });

    function handlePropFiles(files) {
      files.forEach(function (f) {
        if (_propFiles.length >= 6) { toast('Maximum 6 photos allowed', 'warning'); return; }
        if (!['image/jpeg','image/png','image/jpg','image/webp'].includes(f.type)) return;
        if (f.size > 5 * 1024 * 1024) { toast(f.name + ' is too large (max 5 MB)', 'warning'); return; }
        _propFiles.push(f);
      });
      renderPropPreviews();
    }

    function renderPropPreviews() {
      if (!preview) return;
      preview.innerHTML = '';
      _propFiles.forEach(function (f, i) {
        var url = URL.createObjectURL(f);
        var div = document.createElement('div');
        div.style.cssText = 'position:relative;border-radius:10px;overflow:hidden;aspect-ratio:1;';
        div.innerHTML = `
          <img src="${url}" style="width:100%;height:100%;object-fit:cover;">
          <button data-idx="${i}" style="
              position:absolute;top:4px;right:4px;
              background:rgba(0,0,0,0.5);border:none;color:#fff;
              border-radius:50%;width:22px;height:22px;cursor:pointer;
              font-size:10px;display:flex;align-items:center;justify-content:center;">
            <i class="fas fa-times"></i>
          </button>`;
        div.querySelector('button').addEventListener('click', function () {
          _propFiles.splice(parseInt(this.dataset.idx), 1);
          renderPropPreviews();
        });
        preview.appendChild(div);
      });
      if (submitBtn) {
        var ok = _propFiles.length >= 2;
        submitBtn.disabled = !ok;
        submitBtn.style.opacity = ok ? '1' : '.5';
        submitBtn.style.cursor  = ok ? 'pointer' : 'not-allowed';
      }
    }

    if (submitBtn) {
      submitBtn.addEventListener('click', async function () {
        if (_propFiles.length < 2) { toast('Upload at least 2 photos', 'warning'); return; }

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading…';

        var progressBar = gid('bmgp-prop-progress');
        var fill = gid('bmgp-prop-progress-fill');
        var text = gid('bmgp-prop-progress-text');
        if (progressBar) progressBar.style.display = 'block';

        try {
          var urls = [];
          for (var idx = 0; idx < _propFiles.length; idx++) {
            var file = _propFiles[idx];
            if (text) text.textContent = 'Uploading photo ' + (idx+1) + ' of ' + _propFiles.length + '…';
            var url = await uploadImageToCloudinary(
              file,
              'property_images/' + currentUser.uid,
              function (pct) {
                if (fill) fill.style.width = pct + '%';
              }
            );
            urls.push(url);
          }

          /* Save to Firestore */
          var isPool = label === 'Swimming Pool';
          var updateData = {
            propertyImagesPending: true,
            propertyImagesVerified: false,
            propertyImagesRejected: false,
            propertyImagesRejectionReason: null,
            propertyImagesUrls: urls,
            propertyImagesSubmittedAt: firebase.firestore.FieldValue.serverTimestamp()
          };
          if (isPool) updateData.poolImagesUploaded = true;
          else        updateData.groundImagesUploaded = true;

          await db.collection(COLLECTIONS.OWNERS).doc(currentUser.uid).update(updateData);

          /* Also save to a dedicated collection for admin review */
          await db.collection('property_image_verifications').add({
            ownerId: currentUser.uid,
            ownerName: currentUser.name || currentUser.ownerName || '',
            propertyType: isPool ? 'pool' : 'ground',
            imageUrls: urls,
            status: 'pending',
            submittedAt: firebase.firestore.FieldValue.serverTimestamp()
          });

          toast('Property photos submitted for review!', 'success');
          if (progressBar) progressBar.style.display = 'none';
          loadOwnerDashboard('verification');

        } catch (err) {
          console.error(err);
          toast('Upload failed: ' + err.message, 'error');
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit ' + label + ' Photos';
        }
      });
    }
  }

  /* Patch loadOwnerVerification to append the property-images section */
  function patchLoadOwnerVerification() {
    if (!window.loadOwnerVerification) {
      setTimeout(patchLoadOwnerVerification, 400);
      return;
    }
    if (window.__bmgpVerifPatched) return;
    window.__bmgpVerifPatched = true;

    var _orig = window.loadOwnerVerification;
    window.loadOwnerVerification = async function (container) {
      await _orig.apply(this, arguments);

      /* After original renders, append property-images section */
      try {
        var ownerDoc = await db.collection(COLLECTIONS.OWNERS).doc(currentUser.uid).get();
        if (ownerDoc.exists) {
          await appendPropertyImagesSection(container, ownerDoc.data());
        }
      } catch(e) {
        console.error('[prop-images]', e);
      }
    };
    log('loadOwnerVerification patched for property images');
  }


  /* ═══════════════════════════════════════════════════════════════
     PART 2 — ADD SWIMMING POOL (owner dashboard Pools tab)
  ═══════════════════════════════════════════════════════════════ */

  /* ── Permission gate ── */
  async function canAddPool() {
    if (!currentUser || currentUser.role !== 'owner') {
      toast('Please login as owner', 'error'); return false;
    }
    try {
      var ownerDoc = await db.collection(COLLECTIONS.OWNERS).doc(currentUser.uid).get();
      if (!ownerDoc.exists) { toast('Owner data not found', 'error'); return false; }
      var owner = ownerDoc.data();

      if (owner.status !== 'active') {
        toast('Your account is blocked. Contact support.', 'error'); return false;
      }
      if (!owner.isVerified) {
        toast('Complete identity verification first (Verification tab).', 'warning');
        if (gid('owner-dashboard-page')?.classList.contains('active'))
          loadOwnerDashboard('verification');
        return false;
      }
      if (!owner.documentVerified) {
        toast('Complete address verification (electricity bill) first.', 'warning');
        if (gid('owner-dashboard-page')?.classList.contains('active'))
          loadOwnerDashboard('verification');
        return false;
      }
      return true;
    } catch(e) {
      toast('Permission check failed. Try again.', 'error'); return false;
    }
  }

  /* ── Pool tab content ── */
  async function loadOwnerPools(container) {
    spinStart('Loading pools…');
    try {
      var snap = await db.collection('swimming_pools')
        .where('ownerId', '==', currentUser.uid)
        .orderBy('createdAt', 'desc')
        .get();

      var pools = [];
      snap.forEach(function (d) { pools.push(Object.assign({ id: d.id }, d.data())); });

      var html = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
          <div style="font-size:16px;font-weight:800;color:#0f1f5c;">Your Swimming Pools</div>
          <button id="bmgp-add-pool-btn"
            style="display:inline-flex;align-items:center;gap:6px;
                   padding:9px 16px;background:linear-gradient(135deg,#0369a1,#0ea5e9);
                   color:#fff;border:none;border-radius:22px;font-size:13px;font-weight:700;
                   cursor:pointer;">
            <i class="fas fa-plus"></i> Add Pool
          </button>
        </div>`;

      if (pools.length === 0) {
        html += `
          <div style="text-align:center;padding:36px 16px;">
            <div style="font-size:40px;opacity:.3;margin-bottom:12px;">🏊</div>
            <div style="font-size:14px;font-weight:700;color:#6b7280;margin-bottom:16px;">
              No swimming pools listed yet
            </div>
            <button id="bmgp-add-pool-btn-empty"
              style="display:inline-flex;align-items:center;gap:6px;
                     padding:12px 22px;background:linear-gradient(135deg,#0369a1,#0ea5e9);
                     color:#fff;border:none;border-radius:22px;font-size:14px;font-weight:700;
                     cursor:pointer;">
              <i class="fas fa-plus"></i> Add Your First Pool
            </button>
          </div>`;
      } else {
        pools.forEach(function (pool) {
          var img   = (pool.images && pool.images[0]) ? pool.images[0] : '';
          var badge = pool.status === 'active'
            ? '<span style="background:#dcfce7;color:#15803d;font-size:10px;font-weight:800;padding:3px 9px;border-radius:20px;"><i class="fas fa-check-circle"></i> Active</span>'
            : '<span style="background:#fef3c7;color:#92400e;font-size:10px;font-weight:800;padding:3px 9px;border-radius:20px;"><i class="fas fa-clock"></i> Pending</span>';

          html += `
            <div style="background:#fff;border-radius:16px;overflow:hidden;
                        box-shadow:0 2px 10px rgba(15,31,92,0.08);margin-bottom:12px;
                        border-top:3px solid #0ea5e9;">
              ${img ? `<img src="${esc(img)}" style="width:100%;height:130px;object-fit:cover;">` : `<div style="width:100%;height:80px;background:linear-gradient(135deg,#0369a1,#0ea5e9);display:flex;align-items:center;justify-content:center;font-size:28px;">🏊</div>`}
              <div style="padding:12px 14px;">
                <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:6px;">
                  <div style="font-size:15px;font-weight:800;color:#0f1f5c;">${esc(pool.name)}</div>
                  ${badge}
                </div>
                <div style="font-size:12px;color:#6b7280;margin-bottom:4px;">
                  <i class="fas fa-map-marker-alt" style="color:#0ea5e9;width:14px;"></i> ${esc(pool.city || pool.address || '—')}
                </div>
                <div style="font-size:12px;color:#6b7280;">
                  <i class="fas fa-rupee-sign" style="color:#0ea5e9;width:14px;"></i> ₹${esc(pool.pricePerSession || 0)}/session
                </div>
                <div style="font-size:12px;color:#6b7280;margin-top:2px;">
                  <i class="fas fa-clock" style="color:#0ea5e9;width:14px;"></i>
                  ${esc(pool.openTime || '06:00')} – ${esc(pool.closeTime || '21:00')}
                  &nbsp;·&nbsp;<i class="fas fa-users" style="color:#0ea5e9;"></i> ${esc(pool.capacityPerSession || pool.capacity || '—')} per session
                </div>
              </div>
              <div style="padding:0 14px 14px;display:flex;gap:8px;">
                <button class="bmgp-owner-edit-pool-btn"
                  data-pool-id="${esc(pool.id)}"
                  style="flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;
                         padding:9px 14px;background:linear-gradient(135deg,#0369a1,#0ea5e9);
                         color:#fff;border:none;border-radius:22px;font-size:13px;font-weight:700;cursor:pointer;">
                  <i class="fas fa-edit"></i> Manage Pool
                </button>
              </div>
            </div>`;
        });
      }

      container.innerHTML = html;
      spinStop();

      /* Bind edit buttons */
      container.querySelectorAll('.bmgp-owner-edit-pool-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var poolId = btn.getAttribute('data-pool-id');
          var pool   = pools.find(function (p) { return p.id === poolId; });
          if (pool) showEditPoolModal(pool);
        });
      });

      /* Bind add buttons */
      ['bmgp-add-pool-btn','bmgp-add-pool-btn-empty'].forEach(function (id) {
        var btn = gid(id);
        if (btn) btn.addEventListener('click', async function () {
          if (await canAddPool()) showAddPoolModal();
        });
      });

    } catch(e) {
      spinStop();
      console.error(e);
      container.innerHTML = '<p style="text-align:center;color:#ef4444;">Failed to load pools</p>';
    }
  }

  /* ── EDIT POOL MODAL ── */
  function showEditPoolModal(pool) {
    var existing = document.getElementById('bmgp-edit-pool-modal');
    if (existing) existing.remove();

    var modal = document.createElement('div');
    modal.id = 'bmgp-edit-pool-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(10,20,60,0.6);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:flex;align-items:flex-end;z-index:9999;opacity:0;pointer-events:none;transition:opacity .25s;';
    modal.innerHTML = `
      <div id="bmgp-edit-pool-sheet"
        style="background:#fff;border-radius:24px 24px 0 0;width:100%;max-height:90vh;overflow-y:auto;
               transform:translateY(100%);transition:transform .35s cubic-bezier(.4,0,.2,1);-webkit-overflow-scrolling:touch;">
        <div style="width:40px;height:4px;border-radius:2px;background:#e2e8f0;margin:10px auto 0;"></div>

        <!-- Header -->
        <div style="display:flex;align-items:center;justify-content:space-between;
                    padding:16px 18px 12px;border-bottom:1px solid #f0f4ff;
                    position:sticky;top:0;background:#fff;z-index:10;">
          <div style="font-size:16px;font-weight:800;color:#0f1f5c;display:flex;align-items:center;gap:8px;">
            <i class="fas fa-swimming-pool" style="color:#0ea5e9;"></i> Manage Pool
          </div>
          <button id="bmgp-edit-pool-close"
            style="width:34px;height:34px;border-radius:50%;background:#f0f4ff;border:none;
                   color:#374151;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;">
            <i class="fas fa-times"></i>
          </button>
        </div>

        <div style="padding:18px;">

          <!-- Pool Name -->
          <div style="margin-bottom:14px;">
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:#374151;margin-bottom:7px;">
              <i class="fas fa-tag" style="color:#0ea5e9;"></i> Pool Name
            </label>
            <input type="text" id="bmgp-edit-pool-name"
              value="${esc(pool.name || '')}"
              placeholder="Pool name"
              style="width:100%;padding:11px 14px;border-radius:12px;border:2px solid #e8edf8;
                     font-size:14px;font-family:inherit;color:#0f1f5c;background:#f8faff;
                     outline:none;box-sizing:border-box;">
          </div>

          <!-- Price / Contact row -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
            <div>
              <label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:#374151;margin-bottom:7px;">
                <i class="fas fa-rupee-sign" style="color:#0ea5e9;"></i> Price/Session (₹)
              </label>
              <input type="number" id="bmgp-edit-pool-price"
                value="${esc(pool.pricePerSession || 0)}"
                min="1" max="9999" placeholder="200"
                style="width:100%;padding:11px 14px;border-radius:12px;border:2px solid #e8edf8;
                       font-size:14px;font-family:inherit;color:#0f1f5c;background:#f8faff;
                       outline:none;box-sizing:border-box;">
            </div>
            <div>
              <label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:#374151;margin-bottom:7px;">
                <i class="fas fa-users" style="color:#0ea5e9;"></i> Capacity/Session
              </label>
              <input type="number" id="bmgp-edit-pool-capacity"
                value="${esc(pool.capacityPerSession || pool.capacity || 30)}"
                min="1" max="500" placeholder="30"
                style="width:100%;padding:11px 14px;border-radius:12px;border:2px solid #e8edf8;
                       font-size:14px;font-family:inherit;color:#0f1f5c;background:#f8faff;
                       outline:none;box-sizing:border-box;">
            </div>
          </div>

          <!-- Timings -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
            <div>
              <label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:#374151;margin-bottom:7px;">
                <i class="fas fa-clock" style="color:#0ea5e9;"></i> Opens At
              </label>
              <input type="time" id="bmgp-edit-pool-open"
                value="${esc(pool.openTime || '06:00')}"
                style="width:100%;padding:11px 14px;border-radius:12px;border:2px solid #e8edf8;
                       font-size:14px;font-family:inherit;color:#0f1f5c;background:#f8faff;
                       outline:none;box-sizing:border-box;">
            </div>
            <div>
              <label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:#374151;margin-bottom:7px;">
                <i class="fas fa-clock" style="color:#0ea5e9;"></i> Closes At
              </label>
              <input type="time" id="bmgp-edit-pool-close"
                value="${esc(pool.closeTime || '21:00')}"
                style="width:100%;padding:11px 14px;border-radius:12px;border:2px solid #e8edf8;
                       font-size:14px;font-family:inherit;color:#0f1f5c;background:#f8faff;
                       outline:none;box-sizing:border-box;">
            </div>
          </div>

          <!-- Pool Length -->
          <div style="margin-bottom:14px;">
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:#374151;margin-bottom:7px;">
              <i class="fas fa-ruler" style="color:#0ea5e9;"></i> Pool Length (metres)
            </label>
            <input type="number" id="bmgp-edit-pool-length"
              value="${esc(pool.poolLength || '')}"
              min="1" max="200" placeholder="25"
              style="width:100%;padding:11px 14px;border-radius:12px;border:2px solid #e8edf8;
                     font-size:14px;font-family:inherit;color:#0f1f5c;background:#f8faff;
                     outline:none;box-sizing:border-box;">
          </div>

          <!-- Contact Phone -->
          <div style="margin-bottom:14px;">
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:#374151;margin-bottom:7px;">
              <i class="fas fa-phone" style="color:#0ea5e9;"></i> Contact Number
            </label>
            <input type="tel" id="bmgp-edit-pool-phone"
              value="${esc(pool.contactPhone || pool.ownerPhone || '')}"
              maxlength="10" pattern="[6-9][0-9]{9}" placeholder="10-digit number"
              style="width:100%;padding:11px 14px;border-radius:12px;border:2px solid #e8edf8;
                     font-size:14px;font-family:inherit;color:#0f1f5c;background:#f8faff;
                     outline:none;box-sizing:border-box;">
          </div>

          <!-- Description -->
          <div style="margin-bottom:14px;">
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:#374151;margin-bottom:7px;">
              <i class="fas fa-align-left" style="color:#0ea5e9;"></i> Description
            </label>
            <textarea id="bmgp-edit-pool-description" rows="3"
              placeholder="Brief description…"
              style="width:100%;padding:11px 14px;border-radius:12px;border:2px solid #e8edf8;
                     font-size:14px;font-family:inherit;color:#0f1f5c;background:#f8faff;
                     outline:none;box-sizing:border-box;resize:none;">${esc(pool.description || '')}</textarea>
          </div>

          <!-- Amenities -->
          <div style="margin-bottom:18px;">
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:#374151;margin-bottom:10px;">
              <i class="fas fa-star" style="color:#0ea5e9;"></i> Amenities
            </label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              ${['Changing Rooms','Lockers','Coach Available','Parking','Cafe / Canteen','Lifeguard','Kids Pool','Heated Pool'].map(function(a) {
                var key = a.toLowerCase().replace(/[^a-z]/g,'_');
                var checked = pool.amenities && pool.amenities.indexOf(a) !== -1 ? 'checked' : '';
                return `<label style="display:flex;align-items:center;gap:7px;font-size:13px;color:#374151;cursor:pointer;">
                  <input type="checkbox" id="bmgp-edit-am-${key}" value="${a}" ${checked}
                    style="width:15px;height:15px;accent-color:#0ea5e9;cursor:pointer;">
                  ${a}
                </label>`;
              }).join('')}
            </div>
          </div>

          <!-- Save button -->
          <button id="bmgp-edit-pool-save"
            style="width:100%;padding:14px;background:linear-gradient(135deg,#0369a1,#0ea5e9);
                   color:#fff;border:none;border-radius:14px;font-size:15px;font-weight:700;
                   cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;
                   font-family:inherit;">
            <i class="fas fa-save"></i> Save Changes
          </button>

        </div>
      </div>`;

    document.body.appendChild(modal);

    /* Animate in */
    requestAnimationFrame(function () {
      modal.style.opacity = '1';
      modal.style.pointerEvents = 'all';
      document.getElementById('bmgp-edit-pool-sheet').style.transform = 'translateY(0)';
    });

    function closeEditModal() {
      modal.style.opacity = '0';
      document.getElementById('bmgp-edit-pool-sheet').style.transform = 'translateY(100%)';
      setTimeout(function () { if (modal.parentNode) modal.parentNode.removeChild(modal); }, 300);
    }

    document.getElementById('bmgp-edit-pool-close').addEventListener('click', closeEditModal);
    modal.addEventListener('click', function (e) { if (e.target === modal) closeEditModal(); });

    /* Focus styling */
    modal.querySelectorAll('input, textarea').forEach(function (inp) {
      inp.addEventListener('focus', function () { this.style.borderColor = '#0ea5e9'; this.style.background = '#fff'; });
      inp.addEventListener('blur',  function () { this.style.borderColor = '#e8edf8'; this.style.background = '#f8faff'; });
    });

    /* Save */
    document.getElementById('bmgp-edit-pool-save').addEventListener('click', async function () {
      var saveBtn = this;
      var name     = (document.getElementById('bmgp-edit-pool-name')?.value || '').trim();
      var price    = parseInt(document.getElementById('bmgp-edit-pool-price')?.value || '0');
      var capacity = parseInt(document.getElementById('bmgp-edit-pool-capacity')?.value || '0');
      var openTime = document.getElementById('bmgp-edit-pool-open')?.value || '06:00';
      var closeTime= document.getElementById('bmgp-edit-pool-close')?.value || '21:00';
      var length   = parseInt(document.getElementById('bmgp-edit-pool-length')?.value || '0');
      var phone    = (document.getElementById('bmgp-edit-pool-phone')?.value || '').trim();
      var desc     = (document.getElementById('bmgp-edit-pool-description')?.value || '').trim();

      if (!name)                { if (typeof toast === 'function') toast('Pool name is required', 'warning'); return; }
      if (!price || price < 1)  { if (typeof toast === 'function') toast('Enter a valid price', 'warning');  return; }
      if (!capacity || capacity < 1) { if (typeof toast === 'function') toast('Enter session capacity', 'warning'); return; }
      if (phone && !/^[6-9][0-9]{9}$/.test(phone)) { if (typeof toast === 'function') toast('Enter a valid 10-digit phone number', 'warning'); return; }

      var amenities = [];
      ['changing_rooms','lockers','coach_available','parking','cafe___canteen',
       'lifeguard','kids_pool','heated_pool'].forEach(function (k) {
        var el = document.getElementById('bmgp-edit-am-' + k);
        if (el && el.checked) amenities.push(el.value);
      });

      var updates = {
        name:               name,
        pricePerSession:    price,
        capacityPerSession: capacity,
        openTime:           openTime,
        closeTime:          closeTime,
        amenities:          amenities,
        description:        desc,
        updatedAt:          firebase.firestore.FieldValue.serverTimestamp()
      };
      if (length > 0)  updates.poolLength    = length;
      if (phone)       updates.contactPhone   = phone;

      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';

      try {
        await db.collection('swimming_pools').doc(pool.id).update(updates);
        if (typeof toast === 'function') toast('Pool details updated! ✅', 'success');
        closeEditModal();
        /* Refresh owner pool list */
        var container = document.getElementById('owner-dashboard-content');
        if (container) loadOwnerPools(container);
      } catch (err) {
        console.error('[edit-pool]', err);
        if (typeof toast === 'function') toast('Failed to save: ' + err.message, 'error');
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Changes';
      }
    });
  }

  /* ── ADD POOL MODAL HTML ── */
  function createAddPoolModalIfNeeded() {
    if (gid('bmgp-add-pool-modal')) return;

    var modal = document.createElement('div');
    modal.id = 'bmgp-add-pool-modal';
    modal.className = 'modal';
    modal.style.cssText = 'z-index:9998;';
    modal.innerHTML = `
      <div class="modal-content" style="max-width:520px;max-height:92vh;overflow-y:auto;border-radius:20px;padding:0;">

        <!-- Header -->
        <div style="display:flex;align-items:center;justify-content:space-between;
                    padding:18px 18px 14px;border-bottom:1px solid #f0f4ff;
                    position:sticky;top:0;background:#fff;z-index:10;border-radius:20px 20px 0 0;">
          <div style="font-size:17px;font-weight:800;color:#0f1f5c;
                      display:flex;align-items:center;gap:8px;">
            <i class="fas fa-swimming-pool" style="color:#0ea5e9;"></i> Add Swimming Pool
          </div>
          <button id="bmgp-close-pool-modal"
            style="width:34px;height:34px;border-radius:50%;background:#f0f4ff;
                   border:none;color:#374151;font-size:14px;cursor:pointer;
                   display:flex;align-items:center;justify-content:center;">
            <i class="fas fa-times"></i>
          </button>
        </div>

        <!-- Progress bar -->
        <div style="display:flex;align-items:center;gap:0;padding:14px 18px 10px;background:#f8faff;">
          ${[1,2,3].map(function(s){
            return `<div class="bmgp-pool-step-indicator" data-step="${s}"
              style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;">
              <div class="bmgp-pool-step-circle"
                style="width:28px;height:28px;border-radius:50%;
                       background:${s===1?'#0ea5e9':'#e2e8f0'};
                       color:${s===1?'#fff':'#9ca3af'};
                       display:flex;align-items:center;justify-content:center;
                       font-size:12px;font-weight:800;transition:all .3s;">
                ${s}
              </div>
              <div style="font-size:10px;font-weight:700;color:#9ca3af;text-align:center;">
                ${s===1?'Basic Info':s===2?'Facilities':'Photos'}
              </div>
            </div>
            ${s<3?`<div style="flex:0.5;height:2px;background:#e2e8f0;margin-bottom:20px;border-radius:1px;"></div>`:''}`;
          }).join('')}
        </div>

        <form id="bmgp-add-pool-form" style="padding:16px 18px 20px;">

          <!-- STEP 1: Basic Info -->
          <div class="bmgp-pool-form-step" data-step="1">
            <div class="bmgp-pool-field-group">
              <label class="field-label"><i class="fas fa-tag"></i> Pool Name *</label>
              <input type="text" id="bmgp-pool-name" class="field-input"
                placeholder="e.g. Aqua Sports Swimming Pool" required maxlength="100">
            </div>
            <div class="bmgp-pool-field-group">
              <label class="field-label"><i class="fas fa-city"></i> City *</label>
              <input type="text" id="bmgp-pool-city" class="field-input"
                placeholder="e.g. Delhi" required>
            </div>
            <div class="bmgp-pool-field-group">
              <label class="field-label"><i class="fas fa-map-marker-alt"></i> Full Address *</label>
              <textarea id="bmgp-pool-address" class="field-input" rows="2"
                placeholder="Street, Area, City, PIN" required
                style="resize:none;min-height:64px;"></textarea>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
              <div class="bmgp-pool-field-group">
                <label class="field-label"><i class="fas fa-rupee-sign"></i> Price/Session (₹) *</label>
                <input type="number" id="bmgp-pool-price" class="field-input"
                  placeholder="200" required min="1" max="9999">
              </div>
              <div class="bmgp-pool-field-group">
                <label class="field-label"><i class="fas fa-phone"></i> Contact Number *</label>
                <input type="tel" id="bmgp-pool-phone" class="field-input"
                  placeholder="10-digit number" required maxlength="10" pattern="[6-9][0-9]{9}">
              </div>
            </div>
            <div class="bmgp-pool-field-group">
              <label class="field-label"><i class="fas fa-align-left"></i> Description</label>
              <textarea id="bmgp-pool-description" class="field-input" rows="2"
                placeholder="Brief description of your pool…"
                style="resize:none;min-height:64px;"></textarea>
            </div>
          </div>

          <!-- STEP 2: Facilities & Timings -->
          <div class="bmgp-pool-form-step" data-step="2" style="display:none;">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
              <div class="bmgp-pool-field-group">
                <label class="field-label"><i class="fas fa-clock"></i> Opens At *</label>
                <input type="time" id="bmgp-pool-open" class="field-input" value="06:00" required>
              </div>
              <div class="bmgp-pool-field-group">
                <label class="field-label"><i class="fas fa-clock"></i> Closes At *</label>
                <input type="time" id="bmgp-pool-close" class="field-input" value="21:00" required>
              </div>
            </div>
            <div class="bmgp-pool-field-group">
              <label class="field-label"><i class="fas fa-users"></i> Capacity per Session *</label>
              <input type="number" id="bmgp-pool-capacity" class="field-input"
                placeholder="30" required min="1" max="500">
            </div>
            <div class="bmgp-pool-field-group">
              <label class="field-label"><i class="fas fa-ruler"></i> Pool Length (metres)</label>
              <input type="number" id="bmgp-pool-length" class="field-input"
                placeholder="25" min="1" max="200">
            </div>
            <div class="bmgp-pool-field-group" style="margin-top:4px;">
              <label class="field-label" style="margin-bottom:8px;">
                <i class="fas fa-star"></i> Amenities
              </label>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                ${['Changing Rooms','Lockers','Coach Available','Parking','Cafe / Canteen',
                   'Lifeguard','Kids Pool','Heated Pool'].map(function(a){
                  var key = a.toLowerCase().replace(/[^a-z]/g,'_');
                  return `<label style="display:flex;align-items:center;gap:7px;font-size:13px;
                              color:#374151;cursor:pointer;">
                    <input type="checkbox" id="bmgp-pool-am-${key}" value="${a}"
                      style="width:15px;height:15px;accent-color:#0ea5e9;cursor:pointer;">
                    ${a}
                  </label>`;
                }).join('')}
              </div>
            </div>
          </div>

          <!-- STEP 3: Upload Pool Photos -->
          <div class="bmgp-pool-form-step" data-step="3" style="display:none;">
            <div style="font-size:13px;color:#6b7280;margin-bottom:14px;line-height:1.5;">
              <i class="fas fa-info-circle" style="color:#0ea5e9;margin-right:4px;"></i>
              Upload clear photos of your swimming pool (min 2, max 6).
              Good photos improve bookings significantly!
            </div>

            <div id="bmgp-pool-photo-dropzone"
              style="border:2px dashed #bae6fd;border-radius:14px;background:#f0f9ff;
                     padding:22px;text-align:center;cursor:pointer;margin-bottom:12px;
                     transition:all .2s;">
              <i class="fas fa-images" style="font-size:26px;color:#0ea5e9;margin-bottom:8px;"></i>
              <div style="font-size:14px;font-weight:700;color:#0369a1;margin-bottom:4px;">
                Click or drag pool photos here
              </div>
              <div style="font-size:12px;color:#9ca3af;">JPEG / PNG / WebP • max 5 MB each</div>
              <input type="file" id="bmgp-pool-photo-input" accept="image/jpeg,image/png,image/webp"
                multiple style="display:none;">
            </div>

            <div id="bmgp-pool-photo-grid"
              style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;"></div>

            <div id="bmgp-pool-photo-progress" style="display:none;margin-bottom:12px;">
              <div style="background:#e0f2fe;border-radius:8px;height:8px;overflow:hidden;">
                <div id="bmgp-pool-photo-fill"
                  style="height:100%;background:linear-gradient(135deg,#0369a1,#0ea5e9);
                         width:0%;transition:width .3s;border-radius:8px;"></div>
              </div>
              <div id="bmgp-pool-photo-text"
                style="font-size:11px;color:#6b7280;font-weight:600;margin-top:5px;text-align:center;">
                Uploading…
              </div>
            </div>
          </div>

          <!-- Nav Buttons -->
          <div style="display:flex;gap:10px;margin-top:18px;">
            <button type="button" id="bmgp-pool-back-btn"
              style="display:none;flex:1;padding:13px;border:2px solid #e8edf8;
                     border-radius:14px;background:#f8faff;color:#374151;
                     font-size:14px;font-weight:700;cursor:pointer;">
              <i class="fas fa-arrow-left"></i> Back
            </button>
            <button type="button" id="bmgp-pool-next-btn"
              style="flex:1;padding:13px;background:linear-gradient(135deg,#0369a1,#0ea5e9);
                     color:#fff;border:none;border-radius:14px;
                     font-size:14px;font-weight:700;cursor:pointer;">
              Next <i class="fas fa-arrow-right"></i>
            </button>
            <button type="submit" id="bmgp-pool-submit-btn"
              style="display:none;flex:1;padding:13px;
                     background:linear-gradient(135deg,#0369a1,#0ea5e9);
                     color:#fff;border:none;border-radius:14px;
                     font-size:14px;font-weight:700;cursor:pointer;">
              <i class="fas fa-check"></i> Submit Pool
            </button>
          </div>

        </form>
      </div>`;

    document.body.appendChild(modal);
  }

  var _poolPhotos = [];
  var _poolStep   = 1;

  function showAddPoolModal() {
    createAddPoolModalIfNeeded();
    var modal = gid('bmgp-add-pool-modal');
    if (!modal) return;

    /* Reset */
    var form = gid('bmgp-add-pool-form');
    if (form) form.reset();
    _poolPhotos = [];
    _poolStep   = 1;
    renderPoolPhotoGrid();
    updatePoolStepUI(1);
    modal.classList.add('active');

    /* Close */
    var closeBtn = gid('bmgp-close-pool-modal');
    if (closeBtn) {
      var newClose = closeBtn.cloneNode(true);
      closeBtn.parentNode.replaceChild(newClose, closeBtn);
      gid('bmgp-close-pool-modal').addEventListener('click', function () {
        modal.classList.remove('active');
      });
    }
    modal.addEventListener('click', function (e) {
      if (e.target === modal) modal.classList.remove('active');
    });

    /* Photo drop zone */
    var dz = gid('bmgp-pool-photo-dropzone');
    var fi = gid('bmgp-pool-photo-input');
    if (dz && fi) {
      var newDz = dz.cloneNode(true);
      dz.parentNode.replaceChild(newDz, dz);
      var dz2 = gid('bmgp-pool-photo-dropzone');
      var fi2 = dz2.querySelector('input[type=file]');
      dz2.addEventListener('click', function () { fi2.click(); });
      dz2.addEventListener('dragover', function (e) {
        e.preventDefault(); dz2.style.borderColor = '#0ea5e9';
      });
      dz2.addEventListener('dragleave', function () { dz2.style.borderColor = '#bae6fd'; });
      dz2.addEventListener('drop', function (e) {
        e.preventDefault(); dz2.style.borderColor = '#bae6fd';
        addPoolPhotos(Array.from(e.dataTransfer.files));
      });
      fi2.addEventListener('change', function () {
        addPoolPhotos(Array.from(fi2.files)); fi2.value = '';
      });
    }

    /* Next / Back / Submit */
    var nextBtn   = gid('bmgp-pool-next-btn');
    var backBtn   = gid('bmgp-pool-back-btn');
    var submitBtn = gid('bmgp-pool-submit-btn');
    var poolForm  = gid('bmgp-add-pool-form');

    if (nextBtn) {
      var newNext = nextBtn.cloneNode(true);
      nextBtn.parentNode.replaceChild(newNext, nextBtn);
      gid('bmgp-pool-next-btn').addEventListener('click', function () {
        if (!validatePoolStep(_poolStep)) return;
        if (_poolStep < 3) { _poolStep++; updatePoolStepUI(_poolStep); }
      });
    }
    if (backBtn) {
      var newBack = backBtn.cloneNode(true);
      backBtn.parentNode.replaceChild(newBack, backBtn);
      gid('bmgp-pool-back-btn').addEventListener('click', function () {
        if (_poolStep > 1) { _poolStep--; updatePoolStepUI(_poolStep); }
      });
    }
    if (poolForm) {
      var newForm = poolForm.cloneNode(false);
      /* Move children */
      while (poolForm.firstChild) newForm.appendChild(poolForm.firstChild);
      poolForm.parentNode.replaceChild(newForm, poolForm);
      gid('bmgp-add-pool-form').addEventListener('submit', handleAddPool);
    }
  }

  function addPoolPhotos(files) {
    files.forEach(function (f) {
      if (_poolPhotos.length >= 6) { toast('Max 6 photos allowed', 'warning'); return; }
      if (!['image/jpeg','image/png','image/jpg','image/webp'].includes(f.type)) return;
      if (f.size > 5*1024*1024) { toast(f.name + ' too large', 'warning'); return; }
      _poolPhotos.push(f);
    });
    renderPoolPhotoGrid();
  }

  function renderPoolPhotoGrid() {
    var grid = gid('bmgp-pool-photo-grid');
    if (!grid) return;
    grid.innerHTML = '';
    _poolPhotos.forEach(function (f, i) {
      var url = URL.createObjectURL(f);
      var div = document.createElement('div');
      div.style.cssText = 'position:relative;border-radius:10px;overflow:hidden;aspect-ratio:1;background:#e0f2fe;';
      div.innerHTML = `
        <img src="${url}" style="width:100%;height:100%;object-fit:cover;">
        <button data-pi="${i}" style="
            position:absolute;top:4px;right:4px;
            background:rgba(0,0,0,0.55);border:none;color:#fff;
            border-radius:50%;width:22px;height:22px;cursor:pointer;
            font-size:10px;display:flex;align-items:center;justify-content:center;">
          <i class="fas fa-times"></i>
        </button>`;
      div.querySelector('button').addEventListener('click', function () {
        _poolPhotos.splice(parseInt(this.dataset.pi), 1);
        renderPoolPhotoGrid();
      });
      grid.appendChild(div);
    });
  }

  function validatePoolStep(step) {
    if (step === 1) {
      var name    = (gid('bmgp-pool-name')?.value || '').trim();
      var city    = (gid('bmgp-pool-city')?.value || '').trim();
      var address = (gid('bmgp-pool-address')?.value || '').trim();
      var price   = parseInt(gid('bmgp-pool-price')?.value || '0');
      var phone   = (gid('bmgp-pool-phone')?.value || '').trim();
      if (!name)    { toast('Enter pool name', 'warning');    return false; }
      if (!city)    { toast('Enter city',      'warning');    return false; }
      if (!address) { toast('Enter address',   'warning');    return false; }
      if (!price || price < 1) { toast('Enter valid price', 'warning'); return false; }
      if (!/^[6-9][0-9]{9}$/.test(phone)) { toast('Enter valid 10-digit phone', 'warning'); return false; }
    }
    if (step === 2) {
      var cap = parseInt(gid('bmgp-pool-capacity')?.value || '0');
      if (!cap || cap < 1) { toast('Enter session capacity', 'warning'); return false; }
    }
    if (step === 3) {
      if (_poolPhotos.length < 2) { toast('Upload at least 2 photos', 'warning'); return false; }
    }
    return true;
  }

  function updatePoolStepUI(step) {
    /* Steps */
    document.querySelectorAll('.bmgp-pool-form-step').forEach(function (el) {
      el.style.display = (parseInt(el.dataset.step) === step) ? '' : 'none';
    });
    /* Indicators */
    document.querySelectorAll('.bmgp-pool-step-indicator').forEach(function (el) {
      var s   = parseInt(el.dataset.step);
      var cir = el.querySelector('.bmgp-pool-step-circle');
      if (!cir) return;
      if (s < step) {
        cir.style.background = '#dcfce7'; cir.style.color = '#15803d';
        cir.innerHTML = '<i class="fas fa-check" style="font-size:11px;"></i>';
      } else if (s === step) {
        cir.style.background = '#0ea5e9'; cir.style.color = '#fff';
        cir.textContent = s;
      } else {
        cir.style.background = '#e2e8f0'; cir.style.color = '#9ca3af';
        cir.textContent = s;
      }
    });
    /* Buttons */
    var nb = gid('bmgp-pool-next-btn');
    var bb = gid('bmgp-pool-back-btn');
    var sb = gid('bmgp-pool-submit-btn');
    if (nb) nb.style.display = step < 3 ? '' : 'none';
    if (sb) sb.style.display = step === 3 ? '' : 'none';
    if (bb) bb.style.display = step > 1  ? '' : 'none';
  }

  async function handleAddPool(e) {
    e.preventDefault();
    if (!validatePoolStep(3)) return;

    var submitBtn = gid('bmgp-pool-submit-btn');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…'; }

    var fill = gid('bmgp-pool-photo-fill');
    var progressWrap = gid('bmgp-pool-photo-progress');
    var progressText = gid('bmgp-pool-photo-text');
    if (progressWrap) progressWrap.style.display = 'block';

    try {
      /* 1. Upload photos */
      var imageUrls = [];
      for (var i = 0; i < _poolPhotos.length; i++) {
        if (progressText) progressText.textContent = 'Uploading photo ' + (i+1) + ' of ' + _poolPhotos.length + '…';
        var url = await uploadImageToCloudinary(
          _poolPhotos[i],
          'swimming_pools/' + currentUser.uid,
          function (pct) { if (fill) fill.style.width = pct + '%'; }
        );
        imageUrls.push(url);
      }

      /* 2. Collect amenities */
      var amenities = [];
      ['changing_rooms','lockers','coach_available','parking','cafe___canteen',
       'lifeguard','kids_pool','heated_pool'].forEach(function (k) {
        var el = document.getElementById('bmgp-pool-am-' + k);
        if (el && el.checked) amenities.push(el.value);
      });

      /* 3. Build pool data */
      var poolData = {
        ownerId:         currentUser.uid,
        ownerName:       currentUser.name || currentUser.ownerName || '',
        ownerPhone:      currentUser.phone || '',
        name:            gid('bmgp-pool-name').value.trim(),
        city:            gid('bmgp-pool-city').value.trim(),
        cityLower:       gid('bmgp-pool-city').value.trim().toLowerCase(),
        address:         gid('bmgp-pool-address').value.trim(),
        pricePerSession: parseInt(gid('bmgp-pool-price').value) || 0,
        contactPhone:    gid('bmgp-pool-phone').value.trim(),
        description:     (gid('bmgp-pool-description')?.value || '').trim(),
        openTime:        gid('bmgp-pool-open')?.value || '06:00',
        closeTime:       gid('bmgp-pool-close')?.value || '21:00',
        capacityPerSession: parseInt(gid('bmgp-pool-capacity')?.value) || 30,
        poolLength:      parseInt(gid('bmgp-pool-length')?.value) || 0,
        amenities:       amenities,
        images:          imageUrls,
        status:          'pending',   /* Admin approves */
        isVerified:      false,
        rating:          0,
        reviewCount:     0,
        createdAt:       firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt:       firebase.firestore.FieldValue.serverTimestamp()
      };

      /* 4. Save */
      var docRef = await db.collection('swimming_pools').add(poolData);
      log('Pool saved: ' + docRef.id);

      /* 5. Close modal & reload */
      var modal = gid('bmgp-add-pool-modal');
      if (modal) modal.classList.remove('active');
      if (progressWrap) progressWrap.style.display = 'none';

      toast('Swimming pool submitted for review! 🏊 It will be live within 24 hours.', 'success');
      loadOwnerDashboard('pools');

    } catch(err) {
      console.error(err);
      if (progressWrap) progressWrap.style.display = 'none';
      toast('Failed to add pool: ' + err.message, 'error');
      if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fas fa-check"></i> Submit Pool'; }
    }
  }

  /* ── Patch loadOwnerDashboard to handle 'pools' tab ── */
  function patchLoadOwnerDashboard() {
    if (!window.loadOwnerDashboard) {
      setTimeout(patchLoadOwnerDashboard, 400); return;
    }
    if (window.__bmgpDashPatched) return;
    window.__bmgpDashPatched = true;

    var _orig = window.loadOwnerDashboard;
    window.loadOwnerDashboard = async function (tab) {
      if (tab === 'pools') {
        var container = gid('owner-dashboard-content');
        if (!container) return;
        /* Highlight correct tab */
        document.querySelectorAll('.dashboard-tabs .tab-btn').forEach(function (b) {
          b.classList.remove('active');
        });
        var poolTab = gid('owner-pools-tab');
        if (poolTab) poolTab.classList.add('active');
        container.innerHTML = '<div class="loading-spinner"><div class="loader-spinner"></div></div>';
        await loadOwnerPools(container);
        return;
      }
      return _orig.apply(this, arguments);
    };
    log('loadOwnerDashboard patched for pools tab');
  }

  /* ── Inject "Pools" tab button into owner dashboard ── */
  function injectPoolsTab() {
    var groundsTab = gid('owner-grounds-tab');
    if (!groundsTab) { setTimeout(injectPoolsTab, 500); return; }
    if (gid('owner-pools-tab')) return;

    var poolsTab = document.createElement('button');
    poolsTab.className = 'tab-btn';
    poolsTab.id = 'owner-pools-tab';
    poolsTab.textContent = 'Pools';
    groundsTab.parentNode.insertBefore(poolsTab, groundsTab.nextSibling);

    poolsTab.addEventListener('click', function () { loadOwnerDashboard('pools'); });
    log('Pools tab injected into owner dashboard');
  }


  /* ═══════════════════════════════════════════════════════════════
     PART 3 — FIRESTORE INDEXES NOTE (runtime only)
     The new collections used:
       • property_image_verifications (ownerId, status, submittedAt)
       No index changes needed for the adds — simple collection-level
       writes. If queries are added later update firestore.indexes.json.
  ═══════════════════════════════════════════════════════════════ */


  /* ═══════════════════════════════════════════════════════════════
     BOOT
  ═══════════════════════════════════════════════════════════════ */
  function boot() {
    patchLoadOwnerVerification();  // Add property image step to verification
    patchLoadOwnerDashboard();     // Handle pools tab routing
    injectPoolsTab();              // Add Pools tab to owner dashboard nav
    log('All patches applied');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();

/* ╔══════════════════════════════════════════════════════════════════╗
   ║  SECTION 9 — PAYOUT SYSTEM PATCH                                ║
   ║  (from payout_system_patch.js — full, unmodified IIFE)          ║
   ╚══════════════════════════════════════════════════════════════════╝ */
/* ═══════════════════════════════════════════════════════════════════
   payout_system_patch.js  v1.0
   ─────────────────────────────────────────────────────────────────
   WHAT THIS DOES:

   OWNER SIDE
   ──────────
   • Replaces loadOwnerPayouts() with a full "Apply for Payout" flow:
       – Shows real available balance (total earnings − already paid)
       – Apply Payout button with a modal to enter amount + notes
       – Request goes to Firestore → payout_requests (status: pending)
       – Timeline tab shows every request with live status chips
       – "Received Payments" section shows every paid payout with
         transaction ID, date, and method (appears in earnings section too)

   ADMIN / CEO SIDE
   ────────────────
   • Replaces loadAdminPayouts() and loadPayoutsList() with a rich UI:
       – Summary stats: Pending / Approved / Paid / Total
       – Each pending request: owner name, UPI, bank, amount, note,
         real earnings breakdown; Approve + Reject buttons
       – Each approved request: "Confirm Payment Done" button that
         opens a modal to record method + transaction ID → marks paid
         + writes to owner_payments so owner sees it immediately
       – Paid cards show full receipt (method, txn ID, who paid, when)
       – Filter tabs: All | Pending | Approved | Paid | Rejected

   EARNINGS SECTION (owner)
   ────────────────────────
   • Patches the existing earnings render to append a "Received
     Payments" block at the bottom — real data from owner_payments
     + paid payout_requests — so owners always see what was received.

   INSTALL: Add LAST in index.html (after all other patch scripts):
     <script src="payout_system_patch.js"></script>
═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── helpers ──────────────────────────────────────────────────── */
  const _db  = () => window.db;
  const _cu  = () => window.currentUser;
  const _fmt = v  => '₹' + Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  const _esc = s  => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const _dt  = ts => {
    if (!ts) return '—';
    try { return ts.toDate ? ts.toDate().toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : new Date(ts).toLocaleString('en-IN'); }
    catch { return '—'; }
  };
  const _toast = (msg, type='success') => {
    if (typeof window.showToast === 'function') window.showToast(msg, type);
    else alert(msg);
  };
  const _loading = (m) => { if (typeof window.showLoading === 'function') window.showLoading(m); };
  const _hideLoading = () => { if (typeof window.hideLoading === 'function') window.hideLoading(); };

  /* ══════════════════════════════════════════════════════════════
     CSS  — injected once
  ══════════════════════════════════════════════════════════════ */
  function injectCSS() {
    if (document.getElementById('psp-css')) return;
    const s = document.createElement('style');
    s.id = 'psp-css';
    s.textContent = `
/* ── PSP shared ─────────────────────────────────────────────── */
.psp-page { padding: 0 0 100px; }
.psp-hero {
  background: linear-gradient(135deg, #0f1f5c 0%, #2563eb 100%);
  border-radius: 20px; padding: 22px 20px 18px;
  margin-bottom: 18px; color: #fff;
  display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;
  flex-wrap: wrap;
}
.psp-hero-stat { text-align: center; }
.psp-hero-val  { font-size: 24px; font-weight: 800; letter-spacing: -0.5px; }
.psp-hero-lbl  { font-size: 10px; opacity: .72; text-transform: uppercase; letter-spacing: .5px; margin-top: 2px; }

.psp-apply-btn {
  display: inline-flex; align-items: center; gap: 7px;
  background: #fff; color: #1d4ed8;
  border: none; border-radius: 14px;
  padding: 11px 20px; font-size: 14px; font-weight: 800;
  cursor: pointer; transition: all .18s; white-space: nowrap;
  font-family: inherit; align-self: flex-start;
}
.psp-apply-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(0,0,0,.2); }
.psp-apply-btn:disabled { opacity: .5; cursor: not-allowed; }

.psp-stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 18px; }
.psp-stat { background: #fff; border-radius: 14px; padding: 13px 10px; text-align: center; box-shadow: 0 2px 8px rgba(15,31,92,.07); }
.psp-stat-val { font-size: 20px; font-weight: 800; color: #0f1f5c; }
.psp-stat-lbl { font-size: 10px; color: #6b7280; font-weight: 600; margin-top: 2px; }
.psp-stat.green .psp-stat-val { color: #16a34a; }
.psp-stat.amber .psp-stat-val { color: #d97706; }
.psp-stat.blue  .psp-stat-val { color: #2563eb; }
.psp-stat.purple .psp-stat-val { color: #7c3aed; }

/* filter tabs */
.psp-filter-bar { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 6px; margin-bottom: 14px; scrollbar-width: none; }
.psp-filter-btn { flex-shrink: 0; padding: 7px 14px; border-radius: 20px; border: 2px solid #e8edf8; background: #fff; font-size: 12px; font-weight: 700; color: #6b7280; cursor: pointer; transition: all .15s; font-family: inherit; }
.psp-filter-btn.active { background: #2563eb; color: #fff; border-color: #2563eb; }

/* request cards */
.psp-card {
  background: #fff; border-radius: 18px; overflow: hidden;
  box-shadow: 0 2px 12px rgba(15,31,92,.08);
  margin-bottom: 12px; border-left: 4px solid transparent;
  transition: box-shadow .18s;
}
.psp-card:hover { box-shadow: 0 6px 20px rgba(15,31,92,.13); }
.psp-card.pending  { border-left-color: #f59e0b; }
.psp-card.approved { border-left-color: #6366f1; }
.psp-card.paid     { border-left-color: #22c55e; }
.psp-card.rejected { border-left-color: #ef4444; }

.psp-card-head { display: flex; justify-content: space-between; align-items: flex-start; padding: 15px 16px 10px; gap: 10px; }
.psp-card-amount { font-size: 22px; font-weight: 800; color: #0f1f5c; letter-spacing: -0.4px; }
.psp-card-sub { font-size: 12px; color: #6b7280; margin-top: 2px; }
.psp-card-id { font-size: 10px; color: #9ca3af; margin-top: 3px; }

.psp-chip { display: inline-flex; align-items: center; gap: 4px; padding: 5px 11px; border-radius: 20px; font-size: 11px; font-weight: 700; white-space: nowrap; }
.psp-chip.pending  { background: #fef3c7; color: #92400e; }
.psp-chip.approved { background: #ede9fe; color: #5b21b6; }
.psp-chip.paid     { background: #dcfce7; color: #15803d; }
.psp-chip.rejected { background: #fee2e2; color: #b91c1c; }

.psp-card-body { padding: 4px 16px 12px; display: flex; flex-direction: column; gap: 5px; border-top: 1px solid #f0f4ff; border-bottom: 1px solid #f0f4ff; }
.psp-row { display: flex; align-items: center; gap: 9px; font-size: 13px; color: #374151; }
.psp-row i { width: 15px; text-align: center; color: #6b7280; font-size: 12px; flex-shrink: 0; }
.psp-row b { color: #0f1f5c; }

.psp-card-foot { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 11px 16px; flex-wrap: wrap; }
.psp-btn { display: inline-flex; align-items: center; gap: 5px; padding: 9px 16px; border-radius: 22px; font-size: 12px; font-weight: 700; cursor: pointer; border: none; font-family: inherit; transition: all .18s; white-space: nowrap; }
.psp-btn-approve { background: linear-gradient(135deg, #6366f1, #4f46e5); color: #fff; }
.psp-btn-approve:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(99,102,241,.4); }
.psp-btn-paid { background: linear-gradient(135deg, #10b981, #059669); color: #fff; }
.psp-btn-paid:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(16,185,129,.4); }
.psp-btn-reject { background: transparent; color: #ef4444; border: 1.5px solid #fca5a5; border-radius: 22px; }
.psp-btn-reject:hover { background: #fee2e2; }

/* owner payout request timeline */
.psp-timeline-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; margin-top: 4px; }
.psp-timeline-dot.pending  { background: #f59e0b; }
.psp-timeline-dot.approved { background: #6366f1; }
.psp-timeline-dot.paid     { background: #22c55e; }
.psp-timeline-dot.rejected { background: #ef4444; }

/* received payments section (owner earnings) */
.psp-received-section { margin-top: 24px; }
.psp-received-head { font-weight: 700; font-size: 15px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; color: #0f1f5c; }
.psp-received-card { background: #f0fdf4; border: 1.5px solid #bbf7d0; border-radius: 14px; padding: 13px 16px; display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; gap: 10px; }
.psp-received-amount { font-size: 20px; font-weight: 800; color: #16a34a; letter-spacing: -0.3px; }
.psp-received-sub { font-size: 11px; color: #6b7280; margin-top: 2px; }
.psp-received-badge { background: #dcfce7; color: #15803d; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 20px; display: inline-flex; align-items: center; gap: 4px; }

/* apply modal */
.psp-modal-overlay { position: fixed; inset: 0; z-index: 9999; background: rgba(10,20,60,.65); backdrop-filter: blur(6px); display: flex; align-items: flex-end; }
.psp-modal { background: #fff; border-radius: 28px 28px 0 0; width: 100%; max-height: 90vh; overflow-y: auto; padding: 24px 20px calc(24px + env(safe-area-inset-bottom,0px)); animation: pspSlideUp .3s cubic-bezier(.4,0,.2,1); }
@keyframes pspSlideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
.psp-modal-handle { width: 40px; height: 4px; border-radius: 2px; background: #e2e8f0; margin: 0 auto 18px; }
.psp-modal-title { font-size: 18px; font-weight: 800; color: #0f1f5c; margin-bottom: 4px; }
.psp-modal-sub { font-size: 13px; color: #6b7280; margin-bottom: 20px; }
.psp-field-label { font-size: 12px; font-weight: 700; color: #374151; margin-bottom: 6px; display: block; }
.psp-field-input { width: 100%; padding: 13px 14px; border: 2px solid #e8edf8; border-radius: 14px; font-size: 16px; font-family: inherit; color: #0f1f5c; background: #f8faff; outline: none; box-sizing: border-box; transition: border-color .18s; margin-bottom: 14px; }
.psp-field-input:focus { border-color: #2563eb; background: #fff; }
.psp-modal-actions { display: flex; gap: 10px; margin-top: 6px; }
.psp-modal-cancel { flex: 1; padding: 13px; background: #f1f5f9; color: #374151; border: none; border-radius: 14px; font-size: 14px; font-weight: 700; cursor: pointer; font-family: inherit; }
.psp-modal-confirm { flex: 2; padding: 13px; background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #fff; border: none; border-radius: 14px; font-size: 14px; font-weight: 700; cursor: pointer; font-family: inherit; display: flex; align-items: center; justify-content: center; gap: 7px; transition: all .18s; }
.psp-modal-confirm:hover { box-shadow: 0 6px 18px rgba(37,99,235,.4); }
.psp-modal-confirm:disabled { opacity: .6; cursor: not-allowed; }
.psp-balance-pill { background: #eff6ff; border: 1.5px solid #bfdbfe; border-radius: 14px; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
.psp-balance-pill-label { font-size: 12px; color: #1d4ed8; font-weight: 600; }
.psp-balance-pill-val { font-size: 20px; font-weight: 800; color: #1d4ed8; }

/* admin confirm-pay modal */
.psp-confirm-modal { background: #fff; border-radius: 20px; max-width: 400px; width: 100%; padding: 26px 22px; box-shadow: 0 24px 60px rgba(0,0,0,.25); margin: auto; }

.psp-empty { text-align: center; padding: 36px 20px; }
.psp-empty-icon { font-size: 36px; opacity: .3; margin-bottom: 10px; }
.psp-empty-text { font-size: 14px; color: #9ca3af; font-weight: 600; }

/* note box */
.psp-note-box { background: #fffbeb; border: 1.5px solid #fde68a; border-radius: 12px; padding: 10px 14px; font-size: 12px; color: #92400e; margin-bottom: 14px; display: flex; align-items: flex-start; gap: 7px; }
.psp-note-box i { flex-shrink: 0; margin-top: 1px; }

/* received badge in owner timeline */
.psp-received-tag { display: inline-flex; align-items: center; gap: 4px; background: #dcfce7; color: #15803d; font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 10px; margin-top: 4px; }
`;
    document.head.appendChild(s);
  }


  /* ══════════════════════════════════════════════════════════════
     OWNER — loadOwnerPayouts replacement
  ══════════════════════════════════════════════════════════════ */
  async function pspOwnerPayouts(container) {
    _loading('Loading payouts…');
    const db = _db(), cu = _cu();
    if (!db || !cu) { container.innerHTML = '<p style="text-align:center;padding:32px;color:#9ca3af;">Please log in.</p>'; _hideLoading(); return; }

    try {
      /* ── fetch all bookings earnings ── */
      const [bookSnap, poolSnap, payoutSnap, paymentSnap] = await Promise.all([
        db.collection('bookings').where('ownerId','==',cu.uid).where('bookingStatus','==','confirmed').get().catch(()=>({docs:[]})),
        db.collection('pool_bookings').where('ownerId','==',cu.uid).where('status','==','confirmed').get().catch(()=>({docs:[]})),
        db.collection('payout_requests').where('ownerId','==',cu.uid).orderBy('createdAt','desc').get().catch(()=>({docs:[]})),
        db.collection('owner_payments').where('ownerId','==',cu.uid).orderBy('createdAt','desc').get().catch(()=>({docs:[]})),
      ]);

      let totalEarned = 0;
      bookSnap.docs.forEach(d => { totalEarned += d.data().ownerAmount || 0; });
      poolSnap.docs.forEach(d => { totalEarned += d.data().ownerAmount || d.data().amount || 0; });

      /* paid out = sum of all paid payout_requests + owner_payments */
      let totalReceived = 0;
      const receivedItems = [];
      const seenIds = new Set();

      paymentSnap.docs.forEach(d => {
        seenIds.add(d.id);
        const p = d.data();
        totalReceived += p.amount || 0;
        receivedItems.push({ id: d.id, ...p });
      });
      payoutSnap.docs.forEach(d => {
        const p = d.data();
        if (p.status === 'paid' && !seenIds.has(d.id)) {
          totalReceived += p.amount || 0;
          receivedItems.push({ id: d.id, ...p, _fromPayout: true });
        }
      });
      receivedItems.sort((a,b) => {
        const ta = a.paidAt?.toDate ? a.paidAt.toDate().getTime() : 0;
        const tb = b.paidAt?.toDate ? b.paidAt.toDate().getTime() : 0;
        return tb - ta;
      });

      const available = Math.max(0, totalEarned - totalReceived);

      /* pending request check */
      const hasPending = payoutSnap.docs.some(d => ['pending','approved'].includes(d.data().status));

      /* stats */
      const stats = { total: payoutSnap.docs.length, pending: 0, approved: 0, paid: 0, rejected: 0 };
      payoutSnap.docs.forEach(d => { const st = d.data().status; if (stats[st] !== undefined) stats[st]++; });

      /* ── render ── */
      container.innerHTML = `
<div class="psp-page">

  <!-- hero balance card -->
  <div class="psp-hero">
    <div>
      <div style="font-size:11px;opacity:.75;margin-bottom:4px;"><i class="fas fa-wallet"></i> Available to Withdraw</div>
      <div style="font-size:32px;font-weight:800;letter-spacing:-0.6px;">${_fmt(available)}</div>
      <div style="font-size:11px;opacity:.65;margin-top:4px;">Total earned ${_fmt(totalEarned)} · Received ${_fmt(totalReceived)}</div>
    </div>
    <button class="psp-apply-btn" id="psp-apply-trigger" ${hasPending ? 'disabled title="You have a pending request"' : ''}>
      <i class="fas fa-paper-plane"></i> ${hasPending ? 'Request Pending' : 'Apply for Payout'}
    </button>
  </div>

  <!-- stats row -->
  <div class="psp-stats-row">
    <div class="psp-stat"><div class="psp-stat-val">${stats.total}</div><div class="psp-stat-lbl">Total</div></div>
    <div class="psp-stat amber"><div class="psp-stat-val">${stats.pending + stats.approved}</div><div class="psp-stat-lbl">In Progress</div></div>
    <div class="psp-stat green"><div class="psp-stat-val">${stats.paid}</div><div class="psp-stat-lbl">Paid</div></div>
    <div class="psp-stat purple"><div class="psp-stat-val">${stats.rejected}</div><div class="psp-stat-lbl">Rejected</div></div>
  </div>

  <!-- filter tabs -->
  <div class="psp-filter-bar" id="psp-owner-filter-bar">
    <button class="psp-filter-btn active" data-filter="all">All</button>
    <button class="psp-filter-btn" data-filter="pending">Pending</button>
    <button class="psp-filter-btn" data-filter="approved">Approved</button>
    <button class="psp-filter-btn" data-filter="paid">Paid</button>
    <button class="psp-filter-btn" data-filter="rejected">Rejected</button>
  </div>

  <!-- requests list -->
  <div id="psp-owner-list">
    ${payoutSnap.docs.length === 0 ? `
      <div class="psp-empty">
        <div class="psp-empty-icon">💸</div>
        <div class="psp-empty-text">No payout requests yet.<br>Apply for your first payout above.</div>
      </div>` :
      payoutSnap.docs.map(d => pspOwnerCard(d.id, d.data())).join('')
    }
  </div>

  <!-- received payments -->
  ${receivedItems.length > 0 ? `
  <div class="psp-received-section">
    <div class="psp-received-head"><i class="fas fa-check-circle" style="color:#16a34a;"></i> Received Payments (${receivedItems.length})</div>
    ${receivedItems.map(p => `
      <div class="psp-received-card">
        <div>
          <div class="psp-received-amount">${_fmt(p.amount)}</div>
          <div class="psp-received-sub">${_dt(p.paidAt)} · via ${_esc(p.method || 'UPI')}</div>
          ${p.note ? `<div class="psp-received-sub">Ref: ${_esc(p.note)}</div>` : ''}
        </div>
        <div class="psp-received-badge"><i class="fas fa-check"></i> Received</div>
      </div>`).join('')}
  </div>` : ''}

</div>`;

      /* filter logic */
      document.getElementById('psp-owner-filter-bar')?.addEventListener('click', e => {
        const btn = e.target.closest('.psp-filter-btn');
        if (!btn) return;
        document.querySelectorAll('#psp-owner-filter-bar .psp-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const f = btn.dataset.filter;
        document.querySelectorAll('#psp-owner-list .psp-card').forEach(c => {
          c.style.display = (f === 'all' || c.dataset.status === f) ? '' : 'none';
        });
      });

      /* apply button */
      document.getElementById('psp-apply-trigger')?.addEventListener('click', () => {
        if (!hasPending) pspShowApplyModal(available, cu);
      });

      _hideLoading();
    } catch (err) {
      _hideLoading();
      console.error('[PSP] loadOwnerPayouts error:', err);
      container.innerHTML = `<p style="text-align:center;color:#ef4444;padding:32px;">${_esc(err.message)}</p>`;
    }
  }

  function pspOwnerCard(docId, p) {
    const st = p.status || 'pending';
    const icons = { pending:'fa-clock', approved:'fa-check-circle', paid:'fa-money-bill-wave', rejected:'fa-times-circle' };
    const labels = { pending:'Under Review', approved:'Approved', paid:'Paid ✓', rejected:'Rejected' };
    return `
<div class="psp-card ${st}" data-status="${st}">
  <div class="psp-card-head">
    <div>
      <div class="psp-card-amount">${_fmt(p.amount)}</div>
      <div class="psp-card-sub"><i class="fas fa-calendar-alt" style="font-size:10px;margin-right:3px;"></i>${_dt(p.createdAt)}</div>
      <div class="psp-card-id"><i class="fas fa-hashtag" style="font-size:9px;"></i> ${_esc(p.requestId || docId.slice(-8))}</div>
    </div>
    <div class="psp-chip ${st}"><i class="fas ${icons[st] || 'fa-circle'}"></i> ${labels[st] || st}</div>
  </div>
  <div class="psp-card-body">
    <div class="psp-row"><i class="fas fa-university"></i> <span>UPI: <b>${_esc(p.upiId || 'Not set')}</b></span></div>
    ${p.note ? `<div class="psp-row"><i class="fas fa-comment-alt"></i> <span>${_esc(p.note)}</span></div>` : ''}
    ${p.status === 'paid' && p.method ? `<div class="psp-row"><i class="fas fa-credit-card"></i> <span>Paid via <b>${_esc(p.method)}</b>${p.transactionId ? ' · Txn: '+_esc(p.transactionId) : ''}</span></div>` : ''}
    ${p.status === 'paid' && p.paidAt ? `<div class="psp-row"><i class="fas fa-check-circle" style="color:#16a34a;"></i> <span>Received on <b>${_dt(p.paidAt)}</b></span></div>` : ''}
    ${p.status === 'rejected' && p.rejectionReason ? `<div class="psp-row"><i class="fas fa-info-circle" style="color:#ef4444;"></i> <span>Reason: ${_esc(p.rejectionReason)}</span></div>` : ''}
    ${p.status === 'approved' ? `<div class="psp-row"><i class="fas fa-hourglass-half" style="color:#6366f1;"></i> <span>Approved — payment being processed</span></div>` : ''}
  </div>
</div>`;
  }

  /* ── Owner: Apply for Payout modal ─────────────────────────────── */
  function pspShowApplyModal(available, cu) {
    const existing = document.getElementById('psp-apply-modal');
    if (existing) existing.remove();

    const ov = document.createElement('div');
    ov.id = 'psp-apply-modal';
    ov.className = 'psp-modal-overlay';
    ov.innerHTML = `
<div class="psp-modal">
  <div class="psp-modal-handle"></div>
  <div class="psp-modal-title"><i class="fas fa-paper-plane" style="color:#2563eb;margin-right:8px;"></i>Apply for Payout</div>
  <div class="psp-modal-sub">Your request will be reviewed by admin / CEO within 2–3 business days.</div>

  <div class="psp-balance-pill">
    <span class="psp-balance-pill-label"><i class="fas fa-wallet"></i> Available Balance</span>
    <span class="psp-balance-pill-val">${_fmt(available)}</span>
  </div>

  <label class="psp-field-label">Payout Amount (₹)</label>
  <input id="psp-apply-amount" class="psp-field-input" type="number" min="1" max="${available}" value="${available}" placeholder="Enter amount">

  <!-- quick amount buttons -->
  <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
    ${[25,50,75,100].map(p => `<button class="psp-filter-btn psp-quick-pct" data-pct="${p}" style="font-size:11px;padding:5px 12px;">${p}%</button>`).join('')}
  </div>

  <label class="psp-field-label">UPI ID (payment destination)</label>
  <input id="psp-apply-upi" class="psp-field-input" type="text" value="${_esc(cu.upiId || '')}" placeholder="yourname@upi">

  <label class="psp-field-label">Note / Remarks (optional)</label>
  <input id="psp-apply-note" class="psp-field-input" type="text" placeholder="e.g. Monthly withdrawal">

  <div class="psp-note-box">
    <i class="fas fa-info-circle"></i>
    <span>Make sure your UPI ID is correct. Payments cannot be reversed once sent.</span>
  </div>

  <div id="psp-apply-err" style="color:#ef4444;font-size:12px;text-align:center;margin-bottom:10px;display:none;"></div>

  <div class="psp-modal-actions">
    <button class="psp-modal-cancel" id="psp-apply-cancel">Cancel</button>
    <button class="psp-modal-confirm" id="psp-apply-confirm"><i class="fas fa-paper-plane"></i> Submit Request</button>
  </div>
</div>`;

    document.body.appendChild(ov);

    /* quick % buttons */
    ov.querySelectorAll('.psp-quick-pct').forEach(btn => {
      btn.addEventListener('click', () => {
        const pct = parseInt(btn.dataset.pct);
        document.getElementById('psp-apply-amount').value = Math.floor(available * pct / 100);
      });
    });

    document.getElementById('psp-apply-cancel').addEventListener('click', () => ov.remove());
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });

    document.getElementById('psp-apply-confirm').addEventListener('click', async () => {
      const errEl = document.getElementById('psp-apply-err');
      const amtVal = parseFloat(document.getElementById('psp-apply-amount').value);
      const upi    = document.getElementById('psp-apply-upi').value.trim();
      const note   = document.getElementById('psp-apply-note').value.trim();
      const btn    = document.getElementById('psp-apply-confirm');

      errEl.style.display = 'none';
      if (!amtVal || amtVal < 1) { errEl.textContent = 'Please enter a valid amount.'; errEl.style.display = 'block'; return; }
      if (amtVal > available + 0.5) { errEl.textContent = 'Amount exceeds available balance.'; errEl.style.display = 'block'; return; }
      if (!upi) { errEl.textContent = 'Please enter your UPI ID.'; errEl.style.display = 'block'; return; }

      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting…';

      try {
        const db = _db(), cu = _cu();
        const now = firebase.firestore.FieldValue.serverTimestamp();
        const reqId = 'POUT-' + Date.now();
        await db.collection('payout_requests').add({
          requestId: reqId,
          ownerId: cu.uid,
          ownerName: cu.ownerName || cu.name || '',
          ownerEmail: cu.email || '',
          ownerPhone: cu.phone || '',
          upiId: upi,
          amount: Math.round(amtVal),
          requestedAmount: Math.round(amtVal),
          note: note,
          status: 'pending',
          bookingIds: [],
          createdAt: now,
          updatedAt: now,
        });
        ov.remove();
        _toast('✅ Payout request submitted! Admin will review within 2–3 business days.', 'success');
        /* reload payout tab */
        const cont = document.getElementById('owner-dashboard-content');
        if (cont) pspOwnerPayouts(cont);
      } catch (err) {
        errEl.textContent = 'Error: ' + err.message;
        errEl.style.display = 'block';
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit Request';
      }
    });
  }


  /* ══════════════════════════════════════════════════════════════
     ADMIN / CEO — loadAdminPayouts & loadPayoutsList replacement
  ══════════════════════════════════════════════════════════════ */
  async function pspAdminPayouts(container) {
    _loading('Loading payout requests…');
    const db = _db(), cu = _cu();
    if (!db || !cu) { container.innerHTML = '<p style="text-align:center;padding:32px;color:#9ca3af;">Please log in.</p>'; _hideLoading(); return; }

    try {
      const snap = await db.collection('payout_requests').orderBy('createdAt','desc').get();
      const docs = snap.docs.map(d => ({ _id: d.id, ...d.data() }));

      /* stats */
      const stats = { total: docs.length, pending: 0, approved: 0, paid: 0, rejected: 0 };
      let pendingAmount = 0, paidAmount = 0;
      docs.forEach(p => {
        if (stats[p.status] !== undefined) stats[p.status]++;
        if (p.status === 'pending' || p.status === 'approved') pendingAmount += p.amount || 0;
        if (p.status === 'paid') paidAmount += p.amount || 0;
      });

      container.innerHTML = `
<div class="psp-page">

  <!-- summary hero -->
  <div class="psp-hero">
    <div class="psp-hero-stat"><div class="psp-hero-val">${_fmt(pendingAmount)}</div><div class="psp-hero-lbl">Awaiting Payout</div></div>
    <div class="psp-hero-stat"><div class="psp-hero-val">${stats.pending + stats.approved}</div><div class="psp-hero-lbl">Open Requests</div></div>
    <div class="psp-hero-stat"><div class="psp-hero-val">${_fmt(paidAmount)}</div><div class="psp-hero-lbl">Total Paid Out</div></div>
    <div class="psp-hero-stat"><div class="psp-hero-val">${stats.total}</div><div class="psp-hero-lbl">All Requests</div></div>
  </div>

  <!-- stats row -->
  <div class="psp-stats-row">
    <div class="psp-stat amber"><div class="psp-stat-val">${stats.pending}</div><div class="psp-stat-lbl">Pending</div></div>
    <div class="psp-stat blue"><div class="psp-stat-val">${stats.approved}</div><div class="psp-stat-lbl">Approved</div></div>
    <div class="psp-stat green"><div class="psp-stat-val">${stats.paid}</div><div class="psp-stat-lbl">Paid</div></div>
    <div class="psp-stat purple"><div class="psp-stat-val">${stats.rejected}</div><div class="psp-stat-lbl">Rejected</div></div>
  </div>

  <!-- filter tabs -->
  <div class="psp-filter-bar" id="psp-admin-filter-bar">
    <button class="psp-filter-btn active" data-filter="all">All (${stats.total})</button>
    <button class="psp-filter-btn" data-filter="pending">Pending (${stats.pending})</button>
    <button class="psp-filter-btn" data-filter="approved">Approved (${stats.approved})</button>
    <button class="psp-filter-btn" data-filter="paid">Paid (${stats.paid})</button>
    <button class="psp-filter-btn" data-filter="rejected">Rejected (${stats.rejected})</button>
  </div>

  <!-- requests -->
  <div id="psp-admin-list">
    ${docs.length === 0
      ? `<div class="psp-empty"><div class="psp-empty-icon">📭</div><div class="psp-empty-text">No payout requests yet.</div></div>`
      : docs.map(p => pspAdminCard(p)).join('')}
  </div>

</div>`;

      /* filter logic */
      document.getElementById('psp-admin-filter-bar')?.addEventListener('click', e => {
        const btn = e.target.closest('.psp-filter-btn');
        if (!btn) return;
        document.querySelectorAll('#psp-admin-filter-bar .psp-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const f = btn.dataset.filter;
        document.querySelectorAll('#psp-admin-list .psp-card').forEach(c => {
          c.style.display = (f === 'all' || c.dataset.status === f) ? '' : 'none';
        });
      });

      /* wire action buttons */
      container.querySelectorAll('[data-psp-approve]').forEach(btn => {
        btn.addEventListener('click', () => pspApprove(btn.dataset.pspApprove, container));
      });
      container.querySelectorAll('[data-psp-reject]').forEach(btn => {
        btn.addEventListener('click', () => pspReject(btn.dataset.pspReject, btn.dataset.pspOwner, container));
      });
      container.querySelectorAll('[data-psp-confirm-pay]').forEach(btn => {
        btn.addEventListener('click', () => pspConfirmPayModal(btn.dataset.pspConfirmPay, btn.dataset.pspOwner, btn.dataset.pspOwnerName, parseFloat(btn.dataset.pspAmount), container));
      });

      _hideLoading();
    } catch (err) {
      _hideLoading();
      console.error('[PSP] loadAdminPayouts error:', err);
      container.innerHTML = `<p style="text-align:center;color:#ef4444;padding:32px;">${_esc(err.message)}</p>`;
    }
  }

  function pspAdminCard(p) {
    const st = p.status || 'pending';
    const icons = { pending:'fa-clock', approved:'fa-check-circle', paid:'fa-money-bill-wave', rejected:'fa-times-circle' };
    const labels = { pending:'Pending Review', approved:'Approved', paid:'Paid', rejected:'Rejected' };
    return `
<div class="psp-card ${st}" data-status="${st}">
  <div class="psp-card-head">
    <div>
      <div class="psp-card-amount">${_fmt(p.amount)}</div>
      <div class="psp-card-sub"><i class="fas fa-user" style="font-size:10px;margin-right:3px;"></i>${_esc(p.ownerName || 'Unknown Owner')}</div>
      <div class="psp-card-id">Req ID: ${_esc(p.requestId || p._id.slice(-10))}</div>
    </div>
    <div class="psp-chip ${st}"><i class="fas ${icons[st] || 'fa-circle'}"></i> ${labels[st] || st}</div>
  </div>
  <div class="psp-card-body">
    <div class="psp-row"><i class="fas fa-university"></i> <span>UPI: <b>${_esc(p.upiId || 'Not set')}</b></span></div>
    <div class="psp-row"><i class="fas fa-phone"></i> <span>${_esc(p.ownerPhone || '—')}</span></div>
    <div class="psp-row"><i class="fas fa-envelope"></i> <span>${_esc(p.ownerEmail || '—')}</span></div>
    <div class="psp-row"><i class="fas fa-calendar-alt"></i> <span>Applied: ${_dt(p.createdAt)}</span></div>
    ${p.note ? `<div class="psp-row"><i class="fas fa-comment-alt"></i> <span>Note: <b>${_esc(p.note)}</b></span></div>` : ''}
    ${p.status === 'approved' ? `<div class="psp-row"><i class="fas fa-check-circle" style="color:#6366f1;"></i> <span>Approved: ${_dt(p.approvedAt)}</span></div>` : ''}
    ${p.status === 'paid' ? `
      <div class="psp-row"><i class="fas fa-credit-card" style="color:#16a34a;"></i> <span>Method: <b>${_esc(p.method || '—')}</b>${p.transactionId ? ' · Txn ID: '+_esc(p.transactionId) : ''}</span></div>
      <div class="psp-row"><i class="fas fa-check-circle" style="color:#16a34a;"></i> <span>Paid on: ${_dt(p.paidAt)}</span></div>
      <div class="psp-row"><i class="fas fa-user-shield"></i> <span>Confirmed by: ${_esc(p.paidByName || p.paidBy || '—')}</span></div>` : ''}
    ${p.status === 'rejected' ? `
      <div class="psp-row"><i class="fas fa-times-circle" style="color:#ef4444;"></i> <span>Rejected: ${_dt(p.rejectedAt)}</span></div>
      ${p.rejectionReason ? `<div class="psp-row"><i class="fas fa-info-circle"></i> <span>Reason: ${_esc(p.rejectionReason)}</span></div>` : ''}` : ''}
  </div>
  ${(st === 'pending' || st === 'approved') ? `
  <div class="psp-card-foot">
    ${st === 'pending' ? `
      <button class="psp-btn psp-btn-reject" data-psp-reject="${_esc(p._id)}" data-psp-owner="${_esc(p.ownerId)}">
        <i class="fas fa-times"></i> Reject
      </button>
      <button class="psp-btn psp-btn-approve" data-psp-approve="${_esc(p._id)}">
        <i class="fas fa-check"></i> Approve
      </button>` : ''}
    ${st === 'approved' ? `
      <button class="psp-btn psp-btn-paid" data-psp-confirm-pay="${_esc(p._id)}" data-psp-owner="${_esc(p.ownerId)}" data-psp-owner-name="${_esc(p.ownerName || '')}" data-psp-amount="${p.amount || 0}">
        <i class="fas fa-money-bill-wave"></i> Confirm Payment Done
      </button>` : ''}
  </div>` : ''}
</div>`;
  }

  /* ── Admin: Approve request ───────────────────────────────────── */
  async function pspApprove(docId, container) {
    if (!confirm('Approve this payout request? The owner will be notified.')) return;
    _loading('Approving…');
    try {
      await _db().collection('payout_requests').doc(docId).update({
        status: 'approved',
        approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
        approvedBy: _cu().uid,
        approvedByName: _cu().name || _cu().email || '',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      _hideLoading();
      _toast('Payout approved — owner notified.', 'success');
      pspAdminPayouts(container);
    } catch (err) {
      _hideLoading();
      _toast('Error: ' + err.message, 'error');
    }
  }

  /* ── Admin: Reject request with reason ──────────────────────────── */
  async function pspReject(docId, ownerId, container) {
    const reason = prompt('Reason for rejection (optional):') ?? null;
    if (reason === null) return; // cancelled
    _loading('Rejecting…');
    try {
      await _db().collection('payout_requests').doc(docId).update({
        status: 'rejected',
        rejectedAt: firebase.firestore.FieldValue.serverTimestamp(),
        rejectedBy: _cu().uid,
        rejectionReason: reason || '',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      _hideLoading();
      _toast('Request rejected.', 'info');
      pspAdminPayouts(container);
    } catch (err) {
      _hideLoading();
      _toast('Error: ' + err.message, 'error');
    }
  }

  /* ── Admin: Confirm Payment Done modal ─────────────────────────── */
  function pspConfirmPayModal(docId, ownerId, ownerName, amount, container) {
    const existing = document.getElementById('psp-confirm-pay-modal');
    if (existing) existing.remove();

    const ov = document.createElement('div');
    ov.id = 'psp-confirm-pay-modal';
    ov.className = 'psp-modal-overlay';
    ov.innerHTML = `
<div class="psp-confirm-modal">
  <div class="psp-modal-handle"></div>
  <div class="psp-modal-title"><i class="fas fa-money-bill-wave" style="color:#10b981;margin-right:8px;"></i>Confirm Payment Done</div>
  <div class="psp-modal-sub">To <strong>${_esc(ownerName || ownerId)}</strong> · <strong>${_fmt(amount)}</strong></div>

  <label class="psp-field-label">Payment Method</label>
  <select id="psp-pay-method" class="psp-field-input" style="padding:11px 14px;">
    <option value="UPI">UPI</option>
    <option value="NEFT">NEFT</option>
    <option value="IMPS">IMPS</option>
    <option value="RTGS">RTGS</option>
    <option value="Cash">Cash</option>
    <option value="Other">Other</option>
  </select>

  <label class="psp-field-label">Transaction ID / UTR (optional)</label>
  <input id="psp-pay-txn" class="psp-field-input" type="text" placeholder="e.g. UTR1234567890">

  <label class="psp-field-label">Actual Amount Paid (₹)</label>
  <input id="psp-pay-amount" class="psp-field-input" type="number" min="1" value="${amount}">

  <label class="psp-field-label">Note (optional)</label>
  <input id="psp-pay-note" class="psp-field-input" type="text" placeholder="Additional info">

  <div id="psp-pay-err" style="color:#ef4444;font-size:12px;text-align:center;margin-bottom:10px;display:none;"></div>

  <div class="psp-modal-actions">
    <button class="psp-modal-cancel" id="psp-pay-cancel">Cancel</button>
    <button class="psp-modal-confirm" id="psp-pay-confirm"><i class="fas fa-check"></i> Confirm Paid</button>
  </div>
</div>`;
    document.body.appendChild(ov);

    document.getElementById('psp-pay-cancel').addEventListener('click', () => ov.remove());
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });

    document.getElementById('psp-pay-confirm').addEventListener('click', async () => {
      const errEl = document.getElementById('psp-pay-err');
      const method = document.getElementById('psp-pay-method').value;
      const txnId  = document.getElementById('psp-pay-txn').value.trim();
      const amt    = parseFloat(document.getElementById('psp-pay-amount').value);
      const note   = document.getElementById('psp-pay-note').value.trim();
      const btn    = document.getElementById('psp-pay-confirm');

      errEl.style.display = 'none';
      if (!amt || amt < 1) { errEl.textContent = 'Enter a valid amount.'; errEl.style.display = 'block'; return; }

      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing…';

      try {
        const db = _db(), cu = _cu();
        const now = firebase.firestore.FieldValue.serverTimestamp();

        /* 1. Update payout request to paid */
        await db.collection('payout_requests').doc(docId).update({
          status: 'paid',
          method, transactionId: txnId, note: note,
          amount: Math.round(amt),
          paidAt: now, paidBy: cu.uid,
          paidByName: cu.name || cu.ownerName || cu.email || '',
          paidByEmail: cu.email || '',
          updatedAt: now,
        });

        /* 2. Write to owner_payments so owner's earnings section shows it */
        await db.collection('owner_payments').add({
          ownerId, ownerName, amount: Math.round(amt), method, transactionId: txnId,
          note: note || `Payout confirmed · ${method}`,
          status: 'paid', type: 'payout_confirmation',
          payoutRequestDocId: docId,
          paidAt: now, paidBy: cu.uid,
          paidByName: cu.name || cu.ownerName || cu.email || '',
          createdAt: now, updatedAt: now,
        });

        ov.remove();
        _toast(`✅ Payment of ${_fmt(amt)} confirmed — owner can now see it in their earnings.`, 'success');
        pspAdminPayouts(container);
      } catch (err) {
        errEl.textContent = 'Error: ' + err.message;
        errEl.style.display = 'block';
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-check"></i> Confirm Paid';
      }
    });
  }


  /* ══════════════════════════════════════════════════════════════
     EARNINGS SECTION — append received payments block
     Wraps window._bmgLoadOwnerEarningsFull to append the received
     payments list after the original content renders.
  ══════════════════════════════════════════════════════════════ */
  function patchEarningsSection() {
    function doWrap() {
      if (window._pspEarningsPatched) return;
      const orig = window._bmgLoadOwnerEarningsFull || window.loadOwnerEarnings;
      if (!orig) return;

      const wrapped = async function (container) {
        await orig.call(this, container);
        /* append received payments block */
        const cu = _cu(), db = _db();
        if (!cu || !db) return;
        try {
          const [paySnap, opSnap] = await Promise.all([
            db.collection('payout_requests').where('ownerId','==',cu.uid).where('status','==','paid').orderBy('paidAt','desc').get().catch(()=>({docs:[]})),
            db.collection('owner_payments').where('ownerId','==',cu.uid).orderBy('createdAt','desc').get().catch(()=>({docs:[]})),
          ]);
          const items = [];
          const seen = new Set();
          opSnap.docs.forEach(d => { seen.add(d.id); items.push({ _id:d.id, ...d.data() }); });
          paySnap.docs.forEach(d => { if (!seen.has(d.id)) items.push({ _id:d.id, ...d.data() }); });
          items.sort((a,b) => {
            const ta = (a.paidAt||a.createdAt)?.toDate ? (a.paidAt||a.createdAt).toDate().getTime() : 0;
            const tb = (b.paidAt||b.createdAt)?.toDate ? (b.paidAt||b.createdAt).toDate().getTime() : 0;
            return tb - ta;
          });
          if (!items.length) return;
          const block = document.createElement('div');
          block.className = 'psp-received-section';
          block.innerHTML = `
            <div class="psp-received-head"><i class="fas fa-check-circle" style="color:#16a34a;"></i> Received Payments (${items.length})</div>
            ${items.map(p => `
              <div class="psp-received-card">
                <div>
                  <div class="psp-received-amount">${_fmt(p.amount)}</div>
                  <div class="psp-received-sub">${_dt(p.paidAt || p.createdAt)} · via ${_esc(p.method || 'UPI')}</div>
                  ${p.transactionId ? `<div class="psp-received-sub">Txn: ${_esc(p.transactionId)}</div>` : ''}
                  ${p.note ? `<div class="psp-received-sub">${_esc(p.note)}</div>` : ''}
                </div>
                <div class="psp-received-badge"><i class="fas fa-check"></i> Received</div>
              </div>`).join('')}`;
          container.appendChild(block);
        } catch (_) {}
      };

      window._bmgLoadOwnerEarningsFull = wrapped;
      window.loadOwnerEarnings = wrapped;
      window._pspEarningsPatched = true;
    }

    doWrap();
    if (!window._pspEarningsPatched) {
      let t = 0; const iv = setInterval(() => { doWrap(); if (window._pspEarningsPatched || ++t > 60) clearInterval(iv); }, 400);
    }
  }


  /* ══════════════════════════════════════════════════════════════
     INSTALL — replace window functions after app.js settles
  ══════════════════════════════════════════════════════════════ */
  function install() {
    injectCSS();
    patchEarningsSection();

    /* Replace owner payout loader */
    window.loadOwnerPayouts = pspOwnerPayouts;

    /* Replace admin payout loader */
    window.loadAdminPayouts = pspAdminPayouts;

    /* Replace CEO payout loader (was loadPayoutsList) */
    window.loadPayoutsList = pspAdminPayouts;

    /* Expose action functions globally so inline onclick still works if any remain */
    window.pspApproveRequest    = (id, container) => pspApprove(id, container || document.getElementById('admin-dashboard-content') || document.getElementById('ceo-dashboard-content'));
    window.pspRejectRequest     = (id, oid, container) => pspReject(id, oid, container || document.getElementById('admin-dashboard-content') || document.getElementById('ceo-dashboard-content'));
    window.pspConfirmPayRequest = (id, oid, oname, amt, container) => pspConfirmPayModal(id, oid, oname, amt, container || document.getElementById('admin-dashboard-content') || document.getElementById('ceo-dashboard-content'));

    console.log('[PSP] Payout System Patch installed ✅');
  }

  /* boot after DOM + other scripts settle */
  function boot() {
    setTimeout(install, 600);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();s
