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