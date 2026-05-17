/**
 * bmg_instant_fixes.js  v3
 * ═══════════════════════════════════════════════════════════════
 * Load LAST in index.html — after ALL other scripts
 *
 * PROBLEM SUMMARY (from console logs):
 *  • checkOrderStatus CF blocked by CORS from github.io → always null
 *  • _recoverTournamentOnPageLoad (inside IIFE in bmg_tournament_payment_fix.js)
 *    finds stale payment_recovery docs and shows the verify panel EVERY login
 *  • The internal _pollAndConfirmTournament closure can't be patched externally
 *
 * FIXES:
 *  1. FIRESTORE-ONLY recovery (no CF calls — CORS blocks them anyway)
 *     • tournament_entries exists → already confirmed → clean up, no panel
 *     • payment_recovery doc age > 15 min + no tournament_entries → abandoned → clean up
 *     • Genuinely new + pending → show panel with onSnapshot listener only
 *
 *  2. MutationObserver destroys the verify panel the instant it appears,
 *     if Firestore says the order is already done or abandoned
 *
 *  3. Real-time slot grid (onSnapshot) so bookings appear instantly
 *
 *  4. Instant slot release on cancel / back / tab close
 *
 * index.html load order:
 *   <script src="bmg_tournament_verify_fix.js"></script>
 *   <script src="bmg_instant_fixes.js"></script>   ← THIS (last)
 * ═══════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  /* ─────────────────────────────────────────────────────────────
   * UTILITIES
   * ───────────────────────────────────────────────────────────── */
  function waitFor(name, cb, ms) {
    if (typeof window[name] === 'function') { cb(); return; }
    const t = setInterval(() => {
      if (typeof window[name] === 'function') { clearInterval(t); cb(); }
    }, ms || 100);
  }

  function _toast(msg, type, dur) {
    if (typeof window.showToast === 'function')
      window.showToast(msg, type || 'info', dur || 4000);
  }

  function _destroyPanel() {
    // Call verify_fix's own destroy if available
    if (window._bmgTournamentVerifyPanel?.destroy) {
      try { window._bmgTournamentVerifyPanel.destroy(); } catch (_) {}
    }
    // Fallback: remove DOM element directly
    const el = document.getElementById('bmg-tourn-verify-panel');
    if (el) {
      el.style.opacity = '0';
      el.style.transition = 'opacity .2s';
      setTimeout(() => { try { el.remove(); } catch (_) {} }, 200);
    }
    // Also kill the shared loading overlay
    if (typeof window.hideLoading === 'function') window.hideLoading();
  }

  function _clearSession(orderId) {
    const keys = [
      'bmg_lastTournOrderId', 'bmg_recoverOrderId', 'bmg_recoverPayType',
      'pendingTournamentRegistration',
    ];
    if (orderId) keys.push(`bmg_tournReg_${orderId}`);
    keys.forEach(k => { try { sessionStorage.removeItem(k); } catch (_) {} });
    window._pendingTournamentRegData = null;
    window.currentTournamentPayment  = null;
  }

  /* ══════════════════════════════════════════════════════════════
   * CORE: FIRESTORE-ONLY RECOVERY
   *
   * Called 80ms after DOMContentLoaded (after all other onReady
   * callbacks have run, so verify_fix's _patchedRecoverOnLoad has
   * already queued its async work — we overtake it by destroying
   * whatever panel it shows before the user notices).
   * ══════════════════════════════════════════════════════════════ */
  async function _smartRecovery() {
    // Immediately kill any panel that appeared synchronously
    _destroyPanel();

    // Wait for Firebase auth (max 7s)
    let waited = 0;
    while (!window.currentUser && waited < 7000) {
      await new Promise(r => setTimeout(r, 150));
      waited += 150;
    }
    const cu = window.currentUser;
    const db = window.db;
    if (!cu || !db) return;

    // ── Find candidate order ID ──────────────────────────────────
    let orderId = null;
    let regMeta = null;
    let docAge  = 0;

    // A. From sessionStorage
    try {
      const sid = sessionStorage.getItem('bmg_lastTournOrderId')
               || sessionStorage.getItem('bmg_recoverOrderId');
      const pt  = sessionStorage.getItem('bmg_recoverPayType');
      if (sid && (!pt || pt === 'tournament')) {
        // Check age from the saved meta
        const raw = sessionStorage.getItem(`bmg_tournReg_${sid}`);
        if (raw) {
          const m = JSON.parse(raw);
          docAge  = Date.now() - (m.savedAt || 0);
          if (docAge > 2 * 60 * 60 * 1000) {
            // > 2 hours stale — clear and ignore
            _clearSession(sid);
          } else {
            orderId = sid;
            regMeta = m;
          }
        } else {
          orderId = sid; // no meta, but ID exists — will verify via Firestore
        }
      }
    } catch (_) {}

    // B. From Firestore payment_recovery (if sessionStorage had nothing)
    if (!orderId) {
      try {
        const snap = await db.collection('payment_recovery')
          .where('userId',      '==', cu.uid)
          .where('paymentType', '==', 'tournament')
          .where('status',      '==', 'pending')
          .orderBy('createdAt', 'desc')
          .limit(5)
          .get().catch(() => null);

        if (snap && !snap.empty) {
          const now = Date.now();
          for (const doc of snap.docs) {
            const d   = doc.data();
            const age = now - (d.createdAt?.toMillis?.() || 0);

            if (age > 2 * 60 * 60 * 1000) {
              // Older than 2h → silently delete
              doc.ref.delete().catch(() => {});
              db.collection('pending_payments').doc(doc.id).delete().catch(() => {});
              continue;
            }

            orderId = doc.id;
            regMeta = d;
            docAge  = age;
            break;
          }
        }
      } catch (_) {}
    }

    // Nothing to recover
    if (!orderId) {
      console.log('[BMG] No pending tournament recovery needed.');
      return;
    }

    console.log('[BMG] Recovery candidate:', orderId, `(age: ${Math.round(docAge/1000)}s)`);

    // ── GATE 1: Already confirmed in tournament_entries? ─────────
    // This is the PRIMARY fix — old code never did this check
    try {
      const entrySnap = await db.collection('tournament_entries').doc(orderId).get();
      if (entrySnap.exists) {
        console.log('[BMG] Already confirmed — cleaning stale docs, skipping panel');
        _destroyPanel();
        // Clean up silently
        db.collection('payment_recovery').doc(orderId).delete().catch(() => {});
        db.collection('pending_payments').doc(orderId).delete().catch(() => {});
        _clearSession(orderId);
        return; // ← NO panel, NO toast
      }
    } catch (_) {}

    // ── GATE 2: Is this order old enough to consider abandoned? ──
    // If payment_recovery doc exists but is > 15 minutes old
    // AND no tournament_entries → user never completed payment.
    // Treat as abandoned: clean up silently.
    if (docAge > 15 * 60 * 1000) {
      console.log('[BMG] Order > 15min old with no confirmation → abandoned, cleaning up');
      _destroyPanel();
      db.collection('payment_recovery').doc(orderId).delete().catch(() => {});
      db.collection('pending_payments').doc(orderId).delete().catch(() => {});
      _clearSession(orderId);
      // No toast — user doesn't need to know about an old abandoned attempt
      return;
    }

    // ── GATE 3: Genuinely fresh + pending (<15 min) ───────────────
    // Load meta
    if (!regMeta) {
      try {
        const raw = sessionStorage.getItem(`bmg_tournReg_${orderId}`)
                 || sessionStorage.getItem('pendingTournamentRegistration');
        if (raw) regMeta = JSON.parse(raw);
      } catch (_) {}
    }
    if (!regMeta) {
      try {
        const recovSnap = await db.collection('payment_recovery').doc(orderId).get();
        if (recovSnap.exists) regMeta = recovSnap.data();
      } catch (_) {}
    }
    if (regMeta) window._pendingTournamentRegData = regMeta;

    console.log('[BMG] Fresh pending order — starting Firestore-only verify');

    // Show a minimal panel and use onSnapshot to resolve instantly
    _destroyPanel(); // ensure no duplicate
    await _firestoreOnlyVerify(orderId, regMeta || {});
  }

  /* ─────────────────────────────────────────────────────────────
   * FIRESTORE-ONLY VERIFY
   * No CF calls (CORS blocked). Uses:
   *  • onSnapshot on tournament_entries (instant when webhook fires)
   *  • Polling tournament_entries every 3s for up to 30s
   *  • Hard timeout at 30s → "check My Tournaments" toast
   * ───────────────────────────────────────────────────────────── */
  async function _firestoreOnlyVerify(orderId, paymentData) {
    const db = window.db;
    if (!db) return;

    let resolved = false;
    let unsubEntries  = null;
    let unsubPending  = null;
    let pollInterval  = null;
    let hardTimeout   = null;

    // Show a lightweight "Verifying…" panel (reuse verify_fix's if available,
    // but keep it simple — no attempt counter visible)
    _showMinimalPanel(orderId);

    function cleanup() {
      clearInterval(pollInterval);
      clearTimeout(hardTimeout);
      if (unsubEntries) { try { unsubEntries(); } catch (_) {} }
      if (unsubPending) { try { unsubPending(); } catch (_) {} }
    }

    function succeed(data) {
      if (resolved) return;
      resolved = true;
      cleanup();
      _destroyPanel();
      _clearSession(orderId);

      // Write tournament_entries if not already there
      const writeSuccess = window._writeAndShowTournamentSuccess
        || window._bmgWriteAndShowTournamentSuccess;
      if (typeof writeSuccess === 'function') {
        writeSuccess(orderId, paymentData || {});
      } else {
        _toast('🏆 Registration confirmed! Check "My Tournaments".', 'success', 6000);
        if (typeof window.loadMyTournaments === 'function') {
          setTimeout(() => window.loadMyTournaments(), 800);
        }
      }

      window.dispatchEvent(new CustomEvent('bmg:paymentConfirmed', {
        detail: { orderId, paymentType: 'tournament', result: data || paymentData || {} }
      }));

      // Clean up Firestore
      db.collection('payment_recovery').doc(orderId).delete().catch(() => {});
    }

    function giveUp() {
      if (resolved) return;
      resolved = true;
      cleanup();
      _destroyPanel();
      // Don't assume failure — payment may still process via webhook
      _toast(
        '⏳ Still verifying — check "My Tournaments" in a minute.',
        'info', 6000
      );
      if (typeof window.loadMyTournaments === 'function') {
        setTimeout(() => window.loadMyTournaments(), 3000);
      }
    }

    // ── onSnapshot: fires the instant webhook writes tournament_entries ──
    try {
      unsubEntries = db.collection('tournament_entries').doc(orderId)
        .onSnapshot(snap => {
          if (snap.exists && !resolved) succeed(snap.data());
        }, () => {});
    } catch (_) {}

    // ── onSnapshot: fires when pending_payments is deleted by webhook ──
    try {
      unsubPending = db.collection('pending_payments').doc(orderId)
        .onSnapshot(snap => {
          if (!snap.exists && !resolved) {
            // Webhook fired — check if entry was also written
            db.collection('tournament_entries').doc(orderId).get()
              .then(e => { if (e.exists && !resolved) succeed(e.data()); })
              .catch(() => {});
          }
        }, () => {});
    } catch (_) {}

    // ── Poll every 3s as fallback (in case onSnapshot misses) ────
    let pollCount = 0;
    pollInterval = setInterval(async () => {
      if (resolved) { clearInterval(pollInterval); return; }
      pollCount++;
      _updateMinimalPanel(pollCount);
      try {
        const snap = await db.collection('tournament_entries').doc(orderId).get();
        if (snap.exists) succeed(snap.data());
      } catch (_) {}
    }, 3000);

    // ── Hard timeout at 30s ────────────────────────────────────
    hardTimeout = setTimeout(giveUp, 30000);
  }

  /* ─────────────────────────────────────────────────────────────
   * MINIMAL VERIFY PANEL
   * Simple, no attempt counter, just a spinner + message
   * ───────────────────────────────────────────────────────────── */
  function _showMinimalPanel(orderId) {
    // Don't double-stack
    if (document.getElementById('bmg-instant-panel')) return;

    const el = document.createElement('div');
    el.id = 'bmg-instant-panel';
    el.style.cssText = [
      'position:fixed;inset:0;z-index:99999',
      'background:rgba(15,23,42,.88)',
      'display:flex;align-items:center;justify-content:center',
      'padding:20px;backdrop-filter:blur(8px)',
    ].join(';');

    el.innerHTML = `
      <div style="background:#fff;border-radius:20px;max-width:340px;width:100%;
        padding:32px 24px;text-align:center;
        box-shadow:0 24px 64px rgba(0,0,0,.45);
        animation:bmgFadeIn .35s ease;">
        <div style="position:relative;width:64px;height:64px;margin:0 auto 18px;">
          <svg width="64" height="64" viewBox="0 0 64 64"
            style="position:absolute;inset:0;animation:bmgSpin 1.2s linear infinite;">
            <circle cx="32" cy="32" r="26" fill="none" stroke="#e5e7eb" stroke-width="5"/>
            <circle cx="32" cy="32" r="26" fill="none" stroke="#2563eb" stroke-width="5"
              stroke-dasharray="120" stroke-dashoffset="90" stroke-linecap="round"/>
          </svg>
          <div style="position:absolute;inset:0;display:flex;align-items:center;
            justify-content:center;font-size:20px;">🏆</div>
        </div>

        <h3 style="font-size:17px;font-weight:800;color:#111827;margin:0 0 6px;">
          Confirming Registration
        </h3>
        <p id="bmg-ip-status" style="font-size:13px;color:#6b7280;margin:0 0 20px;">
          Checking with payment gateway…
        </p>

        <div style="background:#f1f5f9;border-radius:8px;height:5px;overflow:hidden;margin-bottom:18px;">
          <div id="bmg-ip-bar" style="height:100%;width:10%;border-radius:8px;
            background:linear-gradient(90deg,#2563eb,#7c3aed);
            transition:width .8s ease;"></div>
        </div>

        <div style="background:#eff6ff;border-radius:10px;padding:10px 12px;
          font-size:12px;color:#1d4ed8;text-align:left;line-height:1.5;">
          <i class="fas fa-shield-alt"></i>
          Your payment is being verified securely.
        </div>

        <button id="bmg-ip-skip" style="margin-top:14px;background:none;border:none;
          color:#9ca3af;font-size:12px;cursor:pointer;text-decoration:underline;">
          Check My Tournaments instead
        </button>
      </div>
      <style>
        @keyframes bmgFadeIn { from{opacity:0;transform:scale(.9)} to{opacity:1;transform:scale(1)} }
        @keyframes bmgSpin   { to{transform:rotate(360deg)} }
      </style>`;

    document.body.appendChild(el);

    el.querySelector('#bmg-ip-skip')?.addEventListener('click', () => {
      el.remove();
      if (typeof window.showPage === 'function') window.showPage('my-bookings-page');
      else if (typeof window.showBookings === 'function') window.showBookings();
    });
  }

  function _updateMinimalPanel(attempt) {
    const bar    = document.getElementById('bmg-ip-bar');
    const status = document.getElementById('bmg-ip-status');
    if (bar)    bar.style.width    = Math.min(90, 10 + attempt * 8) + '%';
    if (status) status.textContent = attempt <= 3
      ? 'Waiting for payment confirmation…'
      : 'Still checking — almost there…';
  }

  /* ══════════════════════════════════════════════════════════════
   * MUTATION OBSERVER
   * If the verify_fix panel appears ANYWAY (race condition where
   * their async code fires before our cleanup), we destroy it
   * and replace with our flow.
   * ══════════════════════════════════════════════════════════════ */
  const _watcher = new MutationObserver(mutations => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        const id = node.id;

        // Verify panel from bmg_tournament_verify_fix.js appeared
        if (id === 'bmg-tourn-verify-panel') {
          console.log('[BMG] Intercepted verify panel — running smart recovery instead');
          // Destroy it and run our smart recovery
          setTimeout(() => {
            node.style.opacity = '0';
            setTimeout(() => { try { node.remove(); } catch (_) {} }, 200);
            _smartRecovery();
          }, 50);
        }

        // Loading overlay showed — check if it's from tournament recovery
        // The 8s failsafe fires from app.js:1988 which means showLoading
        // was called by bmg_tournament_payment_fix.js line 51 (_showLoading)
        // We can't distinguish sources, but if there's no active payment
        // in progress we hide it after a short delay
        if (id === 'loading-overlay') {
          // Check if this is a tournament recovery trigger
          setTimeout(() => {
            const storedId = sessionStorage.getItem('bmg_lastTournOrderId')
                          || sessionStorage.getItem('bmg_recoverOrderId');
            // If no active orderId in session, this overlay is orphaned — kill it
            if (!storedId && typeof window.hideLoading === 'function') {
              window.hideLoading();
            }
          }, 300);
        }
      }
    }
  });

  /* ══════════════════════════════════════════════════════════════
   * BOOT
   * Run 80ms after DOMContentLoaded so verify_fix's synchronous
   * onReady() callbacks have queued but not yet resolved their
   * async Firestore queries. We'll arrive first.
   * ══════════════════════════════════════════════════════════════ */
  function boot() {
    // Start watching for rogue panels immediately
    if (document.body) {
      _watcher.observe(document.body, { childList: true, subtree: false });
    }

    // Run smart recovery after a microtask delay
    setTimeout(_smartRecovery, 80);
  }

  if (document.readyState !== 'loading') {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }

  // Also start watcher as early as possible (before body exists)
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', () => {
      _watcher.observe(document.body, { childList: true, subtree: false });
    });
  }


  /* ══════════════════════════════════════════════════════════════
   * FIX 3 — REAL-TIME SLOT GRID
   * ══════════════════════════════════════════════════════════════ */
  let _slotUnsub = null;

  async function loadSlotsRealtime(groundId, date) {
    const container = document.getElementById('time-slots');
    if (!container) return;

    container.innerHTML = `
      <div style="padding:2rem;text-align:center;">
        <div class="loader-spinner"></div>
        <p style="margin-top:1rem;color:var(--gray-500);">Loading slots…</p>
      </div>`;

    if (_slotUnsub) { try { _slotUnsub(); } catch (_) {} _slotUnsub = null; }

    const db = window.db;
    if (!db) return;

    _releaseExpiredLocks(groundId, date);

    _slotUnsub = db.collection('slots')
      .where('groundId', '==', groundId)
      .where('date',     '==', date)
      .onSnapshot(snapshot => {
        const statusMap = {}, lockMap = {};
        snapshot.forEach(doc => {
          const s = doc.data();
          const k = `${s.startTime}-${s.endTime}`;
          statusMap[k] = s.status;
          lockMap[k]   = s.lockedBy || s.lockOrderId || null;
        });
        _renderSlots(container, statusMap, lockMap, date);
      }, () => {
        if (typeof window._origLoadSlots === 'function')
          window._origLoadSlots(groundId, date);
      });
  }

  function _renderSlots(container, statusMap, lockMap, date) {
    const cu      = window.currentUser;
    const now     = new Date();
    const curMin  = now.getHours() * 60 + now.getMinutes();
    const isToday = date === now.toISOString().split('T')[0];
    const sel     = window.selectedSlot || null;
    const myOrd   = sessionStorage.getItem('bmg_currentOrderId') || '';

    let html = '';
    for (let h = 0; h < 24; h++) {
      const s   = `${String(h).padStart(2,'0')}:00`;
      const e   = `${String(h+1).padStart(2,'0')}:00`;
      const key = `${s}-${e}`;
      const raw = statusMap[key] || 'available';
      const lk  = lockMap[key];
      const mine = lk && cu && (lk === cu.uid || lk === myOrd);

      let cls = 'available', dis = false, badge = '';

      if (isToday && h * 60 <= curMin) {
        cls = 'past'; dis = true;
      } else {
        switch (raw) {
          case 'booked': case 'confirmed':
            cls = 'confirmed'; dis = true;
            badge = '<span class="bmg-sb booked">Booked</span>';
            break;
          case 'locked': case 'pending':
            if (mine) { cls = 'selected'; badge = '<span class="bmg-sb mine">Your Slot</span>'; }
            else       { cls = 'locked'; dis = true; badge = '<span class="bmg-sb locked">Processing</span>'; }
            break;
          case 'closed': case 'blocked':
            cls = 'closed'; dis = true; break;
        }
      }

      html += `<div class="time-slot ${cls}${sel===key?' selected':''}"
        data-slot="${key}" data-status="${dis?'disabled':raw}"
        ${!dis?'data-available="true"':''}
      ><span>${key.replace('-',' – ')}</span>${badge}</div>`;
    }

    container.innerHTML = html;
    container.querySelectorAll('.time-slot[data-available="true"]').forEach(el => {
      el.addEventListener('click', () => {
        if (typeof window.selectSlot === 'function') window.selectSlot(el.dataset.slot);
      });
    });
  }

  async function _releaseExpiredLocks(groundId, date) {
    const db = window.db;
    if (!db) return;
    try {
      const snap = await db.collection('slots')
        .where('groundId','==',groundId).where('date','==',date)
        .where('status','in',['locked','pending']).get();
      const now = Date.now(), batch = db.batch();
      let changed = false;
      snap.forEach(doc => {
        const d = doc.data();
        const exp = d.lockExpiresAtMs || d.lockExpiresAt?.toMillis?.() || 0;
        if (exp && now > exp) {
          batch.update(doc.ref, {
            status:'available', lockOrderId:null, lockExpiresAt:null,
            lockExpiresAtMs:null, lockedBy:null,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          });
          changed = true;
        }
      });
      if (changed) await batch.commit();
    } catch (_) {}
  }

  async function _releaseMySlot() {
    const db = window.db;
    if (!db) return;
    let li = null;
    try { li = JSON.parse(sessionStorage.getItem('slotLock') || 'null'); } catch (_) {}
    if (!li?.orderId) return;
    try {
      const snap = await db.collection('slots')
        .where('lockOrderId','==',li.orderId).limit(1).get();
      if (!snap.empty) await snap.docs[0].ref.update({
        status:'available', lockOrderId:null, lockExpiresAt:null,
        lockExpiresAtMs:null, lockedBy:null,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      await db.collection('pending_payments').doc(li.orderId).delete().catch(() => {});
    } catch (_) {}
    sessionStorage.removeItem('slotLock');
  }

  // Release on navigate away from booking pages
  const _origShowPage = window.showPage;
  if (typeof _origShowPage === 'function') {
    window.showPage = function (to) {
      const cur = document.querySelector('.page.active')?.id || '';
      if (['booking-page','payment-page','cashfree-page'].includes(cur) &&
          !['booking-page','payment-page','cashfree-page'].includes(to)) {
        _releaseMySlot();
      }
      return _origShowPage.apply(this, arguments);
    };
  }

  window.addEventListener('beforeunload', () => {
    try {
      const li = JSON.parse(sessionStorage.getItem('slotLock') || 'null');
      if (li?.orderId) sessionStorage.setItem('slotLock_needsRelease', li.orderId);
    } catch (_) {}
  });

  window.addEventListener('DOMContentLoaded', () => {
    const stale = sessionStorage.getItem('slotLock_needsRelease');
    if (stale && window.db) {
      sessionStorage.removeItem('slotLock_needsRelease');
      window.db.collection('slots').where('lockOrderId','==',stale).limit(1).get()
        .then(s => {
          if (!s.empty) s.docs[0].ref.update({
            status:'available', lockOrderId:null, lockExpiresAt:null,
            lockExpiresAtMs:null, lockedBy:null,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          });
        }).catch(() => {});
      window.db.collection('pending_payments').doc(stale).delete().catch(() => {});
    }
  });

  window.addEventListener('bmg:paymentCancelled', () => _releaseMySlot());

  waitFor('loadSlots', () => {
    window._origLoadSlots = window.loadSlots;
    window.loadSlots = loadSlotsRealtime;
    console.log('✅ [BMG] loadSlots → real-time');
  });

  // Slot badge CSS
  const style = document.createElement('style');
  style.textContent = `
    .bmg-sb {
      display:inline-block;font-size:9px;font-weight:700;
      letter-spacing:.04em;text-transform:uppercase;
      padding:2px 5px;border-radius:4px;margin-left:4px;vertical-align:middle;
    }
    .bmg-sb.booked{background:#fee2e2;color:#dc2626;}
    .bmg-sb.locked{background:#fef3c7;color:#d97706;}
    .bmg-sb.mine  {background:#d1fae5;color:#059669;}
    .time-slot.confirmed,.time-slot.locked{cursor:not-allowed;opacity:.65;}
  `;
  document.head.appendChild(style);

  // Expose for debugging
  window._bmgFixes = {
    smartRecovery      : _smartRecovery,
    firestoreVerify    : _firestoreOnlyVerify,
    releaseSlot        : _releaseMySlot,
    clearSession       : _clearSession,
    destroyPanel       : _destroyPanel,
  };

  console.log('✅ [bmg_instant_fixes.js v3] Loaded — CORS-safe, Firestore-only recovery');

})();