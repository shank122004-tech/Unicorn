/**
 * bmg_pool_pass_fix.js
 * ═══════════════════════════════════════════════════════════════════
 *
 *  ROOT CAUSE
 *  ──────────
 *  When a user clicks "Pool Pass" on their My Bookings card, it calls:
 *    showEntryPass(poolBookingId)
 *
 *  BUT the version of showEntryPass currently active is the one patched
 *  by sportobook_patches_merged.js (§6), which ONLY queries the
 *  `bookings` collection:
 *
 *    const dd = await db.collection('bookings').doc(bookingId).get()
 *
 *  Pool bookings are stored in `pool_bookings` — not `bookings`.
 *  So the lookup always fails → "Booking not found" toast.
 *
 *  The original app.js showEntryPass DID check pool_bookings first,
 *  but sportobook_patches_merged.js overwrote it with a version
 *  that forgot about pool bookings entirely.
 *
 *  THE FIX
 *  ───────
 *  Re-patch showEntryPass (loaded LAST) so it:
 *    1. Checks pool_bookings first  → renders the beautiful Pool Pass
 *    2. Falls back to bookings      → renders the Ground Entry Pass
 *
 *  LOAD ORDER — add LAST in index.html, after all other scripts:
 *    <script src="bmg_pool_pass_fix.js"></script>
 *
 * ═══════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  /* ─── wait for showEntryPass to exist, then overwrite it ─── */
  function applyFix() {
    var _origShowEntryPass = window.showEntryPass; // keep reference (ground booking path)

    window.showEntryPass = async function (bookingId) {
      if (!bookingId) {
        var t = window.showToast || window._bmgToast || function (m) { alert(m); };
        t('Booking ID missing', 'error'); return;
      }

      var showLoad = window.showLoading  || window._bmgShowLoading || function () {};
      var hideLoad = window.hideLoading  || window._bmgHideLoading || function () {};
      var toast    = window.showToast    || window._bmgToast       || function (m) { alert(m); };
      var db = window.db;

      showLoad('Generating pass…');

      try {
        /* ══════════════════════════════════════════════════════
         *  STEP 1 — Check pool_bookings (3 lookup strategies)
         * ══════════════════════════════════════════════════════*/
        var poolBooking = null;

        // 1a. By document ID (orderId is used as doc ID when booking is created)
        try {
          var byId = await db.collection('pool_bookings').doc(bookingId).get();
          if (byId.exists) { poolBooking = byId.data(); poolBooking._docId = byId.id; }
        } catch (_) {}

        // 1b. By bookingId field
        if (!poolBooking) {
          try {
            var snap1 = await db.collection('pool_bookings')
              .where('bookingId', '==', bookingId).limit(1).get();
            if (!snap1.empty) { poolBooking = snap1.docs[0].data(); poolBooking._docId = snap1.docs[0].id; }
          } catch (_) {}
        }

        // 1c. By orderId field
        if (!poolBooking) {
          try {
            var snap2 = await db.collection('pool_bookings')
              .where('orderId', '==', bookingId).limit(1).get();
            if (!snap2.empty) { poolBooking = snap2.docs[0].data(); poolBooking._docId = snap2.docs[0].id; }
          } catch (_) {}
        }

        /* ══════════════════════════════════════════════════════
         *  STEP 2 — It's a pool booking → render Pool Pass
         * ══════════════════════════════════════════════════════*/
        if (poolBooking) {
          var bStat = poolBooking.status || poolBooking.bookingStatus || '';
          var isOk  = bStat === 'confirmed' || bStat === 'completed' ||
                      (poolBooking.paymentStatus || '').toLowerCase() === 'paid';

          if (!isOk) {
            hideLoad();
            toast('Pool pass is available only for confirmed bookings', 'warning');
            return;
          }

          /* Use showPoolEntryPass from bmg_swimming_pool_fix.js if available */
          if (typeof window.showPoolEntryPass === 'function') {
            hideLoad(); // showPoolEntryPass calls showLoading itself
            window.showPoolEntryPass(bookingId);
            return;
          }

          /* ── Inline pool pass renderer (fallback if showPoolEntryPass missing) ── */
          var memberCount = poolBooking.currentMembers != null ? poolBooking.currentMembers : '—';
          var maxMembers  = poolBooking.maxMembers     != null ? poolBooking.maxMembers     : '—';

          // Fetch live member count from pool_slots if slotId exists
          if (poolBooking.slotId) {
            try {
              var slotDoc = await db.collection('pool_slots').doc(poolBooking.slotId).get();
              if (slotDoc.exists) {
                memberCount = slotDoc.data().currentMembers != null ? slotDoc.data().currentMembers : memberCount;
                maxMembers  = slotDoc.data().maxMembers     != null ? slotDoc.data().maxMembers     : maxMembers;
              }
            } catch (_) {}
          }

          var memberPct = (memberCount !== '—' && maxMembers !== '—' && parseInt(maxMembers) > 0)
            ? Math.min(Math.round((parseInt(memberCount) / parseInt(maxMembers)) * 100), 100) : 0;

          var esc = window._esc || function (s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };

          // QR code
          var qrDataUrl = '';
          try {
            var qrPayload = JSON.stringify({
              appId: 'BookMyGame', type: 'pool',
              bookingId: poolBooking.bookingId || poolBooking.orderId || bookingId,
              poolId: poolBooking.poolId, date: poolBooking.date, slot: poolBooking.slotTime,
            });
            if (typeof QRCode !== 'undefined' && typeof QRCode.toDataURL === 'function') {
              qrDataUrl = await QRCode.toDataURL(qrPayload, { width: 200, margin: 2 });
            }
          } catch (_) {}

          var container = document.getElementById('entry-pass-content');
          if (container) {
            container.innerHTML =
              '<style>' +
              '@import url("https://fonts.googleapis.com/css2?family=Nunito:wght@400;700;800;900&family=Pacifico&display=swap");' +
              '#entry-pass-content{background:linear-gradient(180deg,#0369a1 0%,#0284c7 35%,#e0f2fe 100%);min-height:100vh;padding:0 0 32px;font-family:"Nunito",sans-serif;}' +
              '.pp-banner{width:100%;background:linear-gradient(135deg,#0c4a6e,#0369a1,#0ea5e9);padding:28px 20px 52px;text-align:center;position:relative;overflow:hidden;}' +
              '.pp-banner::after{content:"";position:absolute;bottom:-1px;left:0;right:0;height:42px;background:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 1440 42\'%3E%3Cpath fill=\'%23bae6fd\' d=\'M0,20 C360,42 720,0 1080,20 C1260,32 1380,26 1440,20 L1440,42 L0,42Z\'/%3E%3C/svg%3E") no-repeat bottom/cover;}' +
              '.pp-swim-icon{font-size:54px;margin-bottom:8px;display:block;}' +
              '.pp-title{font-family:"Pacifico",cursive;font-size:22px;color:#fff;margin:0 0 4px;text-shadow:0 2px 8px rgba(0,0,0,.3);}' +
              '.pp-sub{font-size:11px;color:#bae6fd;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0;}' +
              '.pp-card{background:#fff;border-radius:28px;margin:-6px 16px 0;box-shadow:0 20px 60px rgba(3,105,161,.28);overflow:hidden;position:relative;max-width:420px;left:50%;transform:translateX(-50%);}' +
              '.pp-card-head{background:linear-gradient(135deg,#0369a1,#0ea5e9);padding:14px 20px;display:flex;align-items:center;justify-content:space-between;}' +
              '.pp-pool-name{color:#fff;font-size:14px;font-weight:800;max-width:58%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
              '.pp-status-chip{background:rgba(255,255,255,.18);border:1.5px solid rgba(255,255,255,.5);color:#fff;font-size:10px;font-weight:800;padding:4px 11px;border-radius:20px;display:flex;align-items:center;gap:5px;}' +
              '.pp-tear{border:none;border-top:2.5px dashed #bae6fd;margin:0;}' +
              '.pp-details{padding:18px 20px 12px;display:grid;grid-template-columns:1fr 1fr;gap:14px 12px;}' +
              '.pp-di{display:flex;flex-direction:column;gap:2px;}.pp-di.full{grid-column:1/-1;}' +
              '.pp-dl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#0ea5e9;}' +
              '.pp-dv{font-size:14px;font-weight:800;color:#0c4a6e;}.pp-dv.small{font-size:10px;font-weight:700;color:#64748b;word-break:break-all;}' +
              '.pp-members{margin:0 20px 14px;background:#f0f9ff;border-radius:12px;padding:10px 14px;border:1.5px solid #bae6fd;}' +
              '.pp-members-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;}' +
              '.pp-members-lbl{font-size:10px;font-weight:700;color:#0284c7;text-transform:uppercase;letter-spacing:.5px;}' +
              '.pp-members-val{font-size:13px;font-weight:800;color:#0c4a6e;}' +
              '.pp-bar{height:8px;background:#e0f2fe;border-radius:4px;overflow:hidden;}' +
              '.pp-bar-fill{height:100%;background:linear-gradient(90deg,#0ea5e9,#06b6d4);border-radius:4px;}' +
              '.pp-qr-sec{padding:4px 20px 18px;display:flex;flex-direction:column;align-items:center;gap:10px;}' +
              '.pp-qr-wrap{background:#fff;border:3px solid #0ea5e9;border-radius:16px;padding:10px;box-shadow:0 8px 24px rgba(14,165,233,.22);}' +
              '.pp-qr-wrap img{display:block;width:160px;height:160px;border-radius:8px;}' +
              '.pp-valid{background:linear-gradient(135deg,#0c4a6e,#0369a1);margin:0 20px 20px;border-radius:14px;padding:10px 16px;display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:#bae6fd;}' +
              '.pp-back{display:block;margin:18px auto 0;background:rgba(255,255,255,.15);border:2px solid rgba(255,255,255,.5);color:#fff;font-family:"Nunito",sans-serif;font-size:14px;font-weight:800;padding:12px 36px;border-radius:50px;cursor:pointer;}' +
              '</style>' +
              '<div class="pp-banner">' +
                '<span class="pp-swim-icon">🏊</span>' +
                '<div class="pp-title">Pool Entry Pass</div>' +
                '<p class="pp-sub">BookMyGame · AquaSport</p>' +
              '</div>' +
              '<div class="pp-card">' +
                '<div class="pp-card-head">' +
                  '<span class="pp-pool-name">' + esc(poolBooking.poolName || 'Swimming Pool') + '</span>' +
                  '<div class="pp-status-chip">✅ CONFIRMED</div>' +
                '</div>' +
                '<hr class="pp-tear">' +
                '<div class="pp-details">' +
                  '<div class="pp-di"><span class="pp-dl">👤 Name</span><span class="pp-dv">' + esc(poolBooking.userName || 'Guest') + '</span></div>' +
                  '<div class="pp-di"><span class="pp-dl">📅 Date</span><span class="pp-dv">' + esc(poolBooking.date || '—') + '</span></div>' +
                  '<div class="pp-di"><span class="pp-dl">⏰ Slot</span><span class="pp-dv">' + esc(poolBooking.slotTime || '—') + '</span></div>' +
                  '<div class="pp-di"><span class="pp-dl">💰 Amount</span><span class="pp-dv">₹' + esc(poolBooking.amount || '—') + '</span></div>' +
                  (poolBooking.poolAddress ? '<div class="pp-di full"><span class="pp-dl">📍 Location</span><span class="pp-dv" style="font-size:12px">' + esc(poolBooking.poolAddress) + '</span></div>' : '') +
                  '<div class="pp-di full"><span class="pp-dl">🎫 Booking ID</span><span class="pp-dv small">' + esc(poolBooking.bookingId || poolBooking.orderId || bookingId) + '</span></div>' +
                '</div>' +
                '<div class="pp-members">' +
                  '<div class="pp-members-row"><span class="pp-members-lbl">🫧 Session Members</span><span class="pp-members-val">' + memberCount + ' / ' + maxMembers + '</span></div>' +
                  '<div class="pp-bar"><div class="pp-bar-fill" style="width:' + memberPct + '%"></div></div>' +
                '</div>' +
                '<hr class="pp-tear">' +
                (qrDataUrl
                  ? '<div class="pp-qr-sec"><div class="pp-qr-wrap"><img src="' + qrDataUrl + '" alt="QR Code"></div><div style="font-size:11px;font-weight:700;color:#64748b;">🔍 Scan at pool entrance</div></div>'
                  : '') +
                '<div class="pp-valid">⏱️ Valid: 15 min before to 1 hr after your slot</div>' +
              '</div>' +
              '<button class="pp-back" id="pool-pass-back-btn">← Back to Home</button>';

            document.getElementById('pool-pass-back-btn').addEventListener('click', function () {
              if (typeof window.goHome === 'function') window.goHome();
              else if (typeof window.showPage === 'function') window.showPage('home-page');
            });
          }

          hideLoad();
          if (typeof window.showPage === 'function') window.showPage('entry-pass-page');
          return;
        }

        /* ══════════════════════════════════════════════════════
         *  STEP 3 — Not a pool booking → delegate to original
         *           showEntryPass (handles ground bookings)
         * ══════════════════════════════════════════════════════*/
        hideLoad(); // original will showLoading again
        if (typeof _origShowEntryPass === 'function') {
          _origShowEntryPass(bookingId);
        } else {
          // Absolute fallback: query bookings directly
          var snap3 = await db.collection('bookings').where('bookingId', '==', bookingId).limit(1).get();
          if (snap3.empty) { toast('Booking not found', 'error'); return; }
          toast('Ground entry pass not available — please update the app', 'warning');
        }

      } catch (err) {
        hideLoad();
        console.error('[bmg-pool-pass-fix] showEntryPass error:', err);
        toast(err.message || 'Error generating pass', 'error');
      }
    };

    console.log('✅ [bmg_pool_pass_fix] showEntryPass patched — pool_bookings checked first');
  }

  /* Wait for showEntryPass to be defined (app.js + patches load async) */
  (function waitAndPatch(n) {
    if (typeof window.showEntryPass === 'function') {
      applyFix();
    } else if (n < 60) {
      setTimeout(function () { waitAndPatch(n + 1); }, 200);
    } else {
      // showEntryPass never appeared — define from scratch
      window.showEntryPass = function (id) { applyFix(); window.showEntryPass(id); };
      applyFix();
    }
  })(0);

  console.log('✅ [bmg_pool_pass_fix.js] Loaded');
})();