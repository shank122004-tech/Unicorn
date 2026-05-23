/* ═══════════════════════════════════════════════════════════════════
   sportobook_access_fix.js  v1.0
   ─────────────────────────────────────────────────────────────────
   Add ONE line in index.html AFTER all other <script> tags:
     <script src="sportobook_access_fix.js"></script>

   Fixes three issues:
   ① Owner Dashboard visible to regular users
       — showPage('owner-dashboard-page') had no role-guard on the
         page itself; any deep link or back-navigation could expose it.
         Fix: intercept showPage + guard showOwnerDashboard.

   ② No verification gate before adding grounds / pools
       — canAddGround() and canAddPool() already have checks but
         some entry-points (inline onclick / patch wires) bypassed
         them or the check for isVerified + documentVerified was
         incomplete. Fix: ensure BOTH isVerified (ID) AND
         documentVerified (address/electricity bill) are confirmed
         before allowing "Add Ground" or "Add Pool" actions.

   ③ ₹499 payment banner shown to owners
       — The banner shows whenever registrationPaid !== true, but
         your payment system is admin-approved; showing the pay
         banner confuses owners who don't need to pay.
         Fix: permanently hide the banner and remove the payment
         gate from canAddGround so only verification is required.
═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ─────────────────────────────────────────────────────────────
     HELPERS
  ───────────────────────────────────────────────────────────── */
  function _role()  { return (window.currentUser && window.currentUser.role) || ''; }
  function _isOwner() { return _role() === 'owner'; }

  function _toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'error');
  }
  function _goHome() {
    if (typeof window.showPage === 'function') window.__origShowPage('main-page');
  }
  function _gid(id) { return document.getElementById(id); }

  /* ─────────────────────────────────────────────────────────────
     FIX ①  — Guard showPage so owner-dashboard-page is ONLY
               accessible to owners, and guard showOwnerDashboard.
  ───────────────────────────────────────────────────────────── */
  function guardOwnerDashboardPage() {
    // Wrap showPage once
    if (window.__origShowPage) return;
    const orig = window.showPage;
    if (typeof orig !== 'function') { setTimeout(guardOwnerDashboardPage, 200); return; }

    window.__origShowPage = orig;

    window.showPage = function guardedShowPage(pageId) {
      if (pageId === 'owner-dashboard-page') {
        if (!_isOwner()) {
          console.warn('[access_fix] Blocked non-owner from owner-dashboard-page (role:', _role(), ')');
          _toast('This area is for venue owners only.', 'warning');
          // Redirect to main page without adding owner-dashboard to history
          orig.call(this, 'main-page');
          return;
        }
      }
      return orig.apply(this, arguments);
    };

    // Also harden showOwnerDashboard itself
    const origSOD = window.showOwnerDashboard;
    if (typeof origSOD === 'function') {
      window.showOwnerDashboard = function guardedShowOwnerDashboard() {
        if (!_isOwner()) {
          _toast('This area is for venue owners only.', 'warning');
          return;
        }
        return origSOD.apply(this, arguments);
      };
    }

    console.log('[fix①] showPage guarded — owner-dashboard-page restricted to owners.');
  }

  /* ─────────────────────────────────────────────────────────────
     FIX ③  — Permanently hide the ₹499 payment banner.
               Done early so it never flickers visible.
  ───────────────────────────────────────────────────────────── */
  function hideBannerForever() {
    // Inject CSS kill-switch immediately (no flicker even before DOM ready)
    const style = document.createElement('style');
    style.id = 'bmg-hide-payment-banner';
    style.textContent = `
      #owner-reg-payment-banner,
      .owner-reg-payment-banner,
      .pay-owner-fee-btn,
      #pay-owner-reg-fee-btn {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);

    // Also zero out JS references whenever the banner element is touched
    function killBanner() {
      const b = _gid('owner-reg-payment-banner');
      if (b) b.style.cssText = 'display:none!important;visibility:hidden!important;';
    }
    killBanner();

    // Observe DOM for late injections
    const obs = new MutationObserver(killBanner);
    obs.observe(document.body || document.documentElement, { childList: true, subtree: true });

    console.log('[fix③] ₹499 payment banner permanently hidden.');
  }

  /* ─────────────────────────────────────────────────────────────
     FIX ②  — Verification gate for "Add Ground" and "Add Pool".
               Replace canAddGround and canAddPool with versions
               that check ONLY verification (not payment).
  ───────────────────────────────────────────────────────────── */
  function installVerificationGates() {

    /* Shared verification checker */
    async function checkOwnerVerified(actionLabel) {
      if (!window.currentUser || !_isOwner()) {
        _toast('Please log in as an owner.', 'error');
        return false;
      }

      const db = window.db;
      const COLLECTIONS = window.COLLECTIONS || {};
      if (!db) { _toast('Database not ready. Please refresh.', 'error'); return false; }

      try {
        const ownerDoc = await db.collection(COLLECTIONS.OWNERS || 'owners')
          .doc(window.currentUser.uid).get();

        if (!ownerDoc.exists) {
          _toast('Owner account not found. Contact support.', 'error');
          return false;
        }

        const owner = ownerDoc.data();

        // ── Check 1: Account active ──────────────────────────────
        if (owner.status !== 'active') {
          _toast('Your account is blocked. Contact support.', 'error');
          return false;
        }

        // ── Check 2: Identity verification (ID docs uploaded + approved) ──
        if (!owner.isVerified) {
          _toast(
            'Please complete your identity verification first. Go to Verification tab.',
            'warning'
          );
          const page = _gid('owner-dashboard-page');
          if (page && page.classList.contains('active') &&
              typeof window.loadOwnerDashboard === 'function') {
            window.loadOwnerDashboard('verification');
          }
          return false;
        }

        // ── Check 3: Address / document verification (electricity bill) ──
        if (!owner.documentVerified) {
          _toast(
            'Please complete your address verification (electricity bill). Go to Verification tab.',
            'warning'
          );
          const page = _gid('owner-dashboard-page');
          if (page && page.classList.contains('active') &&
              typeof window.loadOwnerDashboard === 'function') {
            window.loadOwnerDashboard('verification');
          }
          return false;
        }

        // ── All checks passed ────────────────────────────────────
        console.log('[fix②] ' + actionLabel + ': verification checks passed ✅');
        return true;

      } catch (err) {
        console.error('[fix②] Verification check error:', err);
        _toast('Error checking verification status. Please try again.', 'error');
        return false;
      }
    }

    /* ── Replace window.canAddGround ── */
    window.canAddGround = async function () {
      const ok = await checkOwnerVerified('canAddGround');
      if (!ok) return false;

      // Owner-type check (keep original logic)
      const OWNER_TYPES = window.OWNER_TYPES || {};
      const ownerType = window.currentUser.ownerType;
      if (ownerType === OWNER_TYPES.VENUE_OWNER || ownerType === OWNER_TYPES.PLOT_OWNER ||
          ownerType === 'venue_owner' || ownerType === 'plot_owner' || !ownerType) {
        return true;
      }
      _toast('Your account type does not allow adding grounds.', 'error');
      return false;
    };

    console.log('[fix②] window.canAddGround replaced with verification-only gate.');

    /* ── Replace canAddPool (defined inside a closure in all_patches_combined.js,
          but the "Add Pool" buttons call it via the closure — we intercept the
          click handler on the buttons instead, which is the real entry point) ── */
    function interceptAddPoolButtons() {
      ['bmgp-add-pool-btn', 'bmgp-add-pool-btn-empty'].forEach(function (id) {
        const btn = _gid(id);
        if (!btn || btn._bmgVerifGuarded) return;
        btn._bmgVerifGuarded = true;

        // Clone to strip all existing listeners, then re-add our guarded one
        const clone = btn.cloneNode(true);
        btn.parentNode.replaceChild(clone, btn);

        clone.addEventListener('click', async function (e) {
          e.stopImmediatePropagation();
          const ok = await checkOwnerVerified('canAddPool');
          if (ok && typeof window._bmgShowAddPoolModal === 'function') {
            window._bmgShowAddPoolModal();
          } else if (ok) {
            // Fallback: look for showAddPoolModal in any scope
            if (typeof window.showAddPoolModal === 'function') window.showAddPoolModal();
          }
        });
      });
    }

    // Re-run whenever the pool tab renders new buttons
    document.addEventListener('click', function (e) {
      // Delay slightly so the DOM updates first
      if (e.target && (e.target.id === 'owner-pools-tab' || e.target.closest?.('#owner-pools-tab'))) {
        setTimeout(interceptAddPoolButtons, 400);
      }
    }, true);

    // Also run on page show events
    window.addEventListener('bmg:pageShown', function (ev) {
      if (ev.detail && ev.detail.pageId === 'owner-dashboard-page') {
        setTimeout(interceptAddPoolButtons, 600);
      }
    });

    // Expose so the pool patch IIFE can call it after rendering
    window._bmgCanAddPoolVerified = checkOwnerVerified;
    console.log('[fix②] canAddPool intercepted via button-click guard.');
  }

  /* ─────────────────────────────────────────────────────────────
     FIX ① extra — hide owner-dashboard nav link for non-owners
     (belt-and-suspenders on top of the role check in app.js)
  ───────────────────────────────────────────────────────────── */
  function enforceNavVisibility() {
    function refresh() {
      const isOwner = _isOwner();
      const link = _gid('owner-dashboard-link');
      const qr   = _gid('header-qr-scanner');
      if (link) link.style.display = isOwner ? 'flex' : 'none';
      if (qr)   qr.style.display   = isOwner ? 'flex' : 'none';
    }

    // Run immediately and whenever currentUser might change
    refresh();
    const CHECK_INTERVAL = 1500;
    let prev = _role();
    setInterval(function () {
      const cur = _role();
      if (cur !== prev) { prev = cur; refresh(); }
    }, CHECK_INTERVAL);

    console.log('[fix①] Nav visibility enforced for non-owners.');
  }

  /* ─────────────────────────────────────────────────────────────
     AUTO-ACTIVATE OWNERS (skip payment gate — set flags so
     canAddGround's original payment checks never block owners
     who are fully verified but haven't "paid" ₹499)
  ───────────────────────────────────────────────────────────── */
  async function autoActivateVerifiedOwner() {
    if (!_isOwner()) return;
    const db = window.db;
    const cu = window.currentUser;
    if (!db || !cu) return;

    try {
      const ownerDoc = await db.collection('owners').doc(cu.uid).get();
      if (!ownerDoc.exists) return;
      const owner = ownerDoc.data();

      // If verified but payment flags not set, auto-set them so the old
      // payment-check code doesn't block an already-verified owner
      if (owner.isVerified && owner.documentVerified &&
          (!owner.registrationPaid || !owner.registrationVerified)) {
        await db.collection('owners').doc(cu.uid).update({
          registrationPaid      : true,
          registrationVerified  : true,
          registrationAutoApproved : true,
          updatedAt             : firebase.firestore.FieldValue.serverTimestamp(),
        });
        cu.registrationPaid     = true;
        cu.registrationVerified = true;
        console.log('[fix③] Auto-activated verified owner — payment flags set to true.');
      }
    } catch (e) {
      // Non-critical — silently ignore
      console.warn('[access_fix] autoActivateVerifiedOwner:', e.message);
    }
  }

  /* ─────────────────────────────────────────────────────────────
     BOOT
  ───────────────────────────────────────────────────────────── */
  function boot() {
    hideBannerForever();          // Fix ③ — CSS kill-switch applied immediately
    guardOwnerDashboardPage();    // Fix ① — showPage guard
    enforceNavVisibility();       // Fix ① extra — nav link visibility
    installVerificationGates();   // Fix ② — verification gate on add ground/pool

    // After auth loads, auto-activate owners who are verified
    window.addEventListener('bmg:pageShown', function handler(ev) {
      if (ev.detail && ev.detail.pageId === 'owner-dashboard-page') {
        window.removeEventListener('bmg:pageShown', handler);
        autoActivateVerifiedOwner();
      }
    });

    // Also try immediately in case already on owner dashboard
    if (_isOwner()) autoActivateVerifiedOwner();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  console.log('[sportobook_access_fix] loaded — owner-guard + verification-gate + banner-removed.');

})();