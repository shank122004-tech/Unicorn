/**
 * bmg_auth_fix.js
 * ─────────────────────────────────────────────────────────────
 * Fixes two bugs:
 *
 * BUG 1 — Sign-in button stops working after logout
 *   CAUSE: initPremiumAuth() only runs once on DOMContentLoaded.
 *   After logout, showPage('login-page') shows the form but the
 *   submit handler is gone (the cloned node has no listeners).
 *   FIX: Re-wire login form every time login-page is shown via
 *   the bmg:pageShown event that showPage() already dispatches.
 *
 * BUG 2 — Owner registration redirects to login without creating account
 *   CAUSE: The second initPremiumAuth() (duplicate definition) wires
 *   #register-form to a function called handleRegister — which does
 *   not exist. Only handleUserRegister exists.
 *   FIX: Alias handleRegister → handleUserRegister, and also re-wire
 *   the owner registration forms (venue + plot) every time those pages
 *   are shown, since they suffer the same lost-listener problem.
 *
 * LOAD ORDER: Add LAST in index.html, after all other scripts:
 *   <script src="bmg_auth_fix.js"></script>
 * ─────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  /* ── 1. Alias missing handleRegister ───────────────────────
   * The duplicate initPremiumAuth references window.handleRegister
   * which was never defined. Map it to the real function.          */
  function ensureHandleRegisterAlias() {
    if (typeof window.handleRegister !== 'function') {
      if (typeof window.handleUserRegister === 'function') {
        window.handleRegister = window.handleUserRegister;
        console.log('[BMG Auth Fix] handleRegister aliased → handleUserRegister');
      } else {
        // handleUserRegister not yet defined — retry shortly
        setTimeout(ensureHandleRegisterAlias, 200);
      }
    }
  }
  ensureHandleRegisterAlias();


  /* ── 2. Wire (or re-wire) a form safely ────────────────────
   * Clones the element to strip stale listeners, then attaches
   * the given handler. Returns the new element.                    */
  function wireForm(id, handler) {
    const el = document.getElementById(id);
    if (!el || typeof handler !== 'function') return null;
    const fresh = el.cloneNode(true);
    el.parentNode.replaceChild(fresh, el);
    fresh.addEventListener('submit', handler);
    return fresh;
  }

  function wireButton(selector, handler) {
    const el = document.querySelector(selector);
    if (!el || typeof handler !== 'function') return null;
    const fresh = el.cloneNode(true);
    el.parentNode.replaceChild(fresh, el);
    fresh.addEventListener('click', function (e) {
      e.preventDefault();
      handler(e);
    });
    return fresh;
  }


  /* ── 3. Re-wire login page every time it is shown ──────────*/
  function rewireLoginPage() {
    // Login form
    const loginForm = wireForm('login-form', function (e) {
      e.preventDefault();
      if (typeof window.handleLogin === 'function') window.handleLogin(e);
      else console.error('[BMG Auth Fix] handleLogin not found');
    });
    if (loginForm) {
      // Also wire the submit button directly as a fallback
      const btn = loginForm.querySelector('.auth-btn-premium');
      if (btn) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          loginForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });
      }
      console.log('[BMG Auth Fix] Login form re-wired');
    }

    // Register form (user registration)
    const registerForm = wireForm('register-form', function (e) {
      e.preventDefault();
      const fn = window.handleUserRegister || window.handleRegister;
      if (typeof fn === 'function') fn(e);
      else console.error('[BMG Auth Fix] handleUserRegister not found');
    });
    if (registerForm) {
      const btn = registerForm.querySelector('.auth-btn-premium');
      if (btn) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          registerForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });
      }
      console.log('[BMG Auth Fix] Register form re-wired');
    }

    // Google sign-in buttons
    document.querySelectorAll('#google-signin-btn, #google-signin-btn-register').forEach(btn => {
      const fresh = btn.cloneNode(true);
      btn.parentNode.replaceChild(fresh, btn);
      fresh.addEventListener('click', function (e) {
        e.preventDefault();
        if (typeof window.handleGoogleSignIn === 'function') window.handleGoogleSignIn(e);
      });
    });

    // Forgot password
    const forgotLink = document.getElementById('forgot-password-link');
    if (forgotLink) {
      const fresh = forgotLink.cloneNode(true);
      forgotLink.parentNode.replaceChild(fresh, forgotLink);
      fresh.addEventListener('click', function (e) {
        e.preventDefault();
        if (typeof window.handleForgotPassword === 'function') window.handleForgotPassword(e);
      });
    }

    // Owner registration link
    const ownerLink = document.getElementById('show-owner-register-link');
    if (ownerLink) {
      const fresh = ownerLink.cloneNode(true);
      ownerLink.parentNode.replaceChild(fresh, ownerLink);
      fresh.addEventListener('click', function (e) {
        e.preventDefault();
        if (typeof window.showOwnerTypeSelection === 'function') window.showOwnerTypeSelection();
      });
    }
  }


  /* ── 4. Re-wire owner registration forms when shown ────────
   * These forms also lose their handlers after navigation.         */
  function rewireVenueOwnerPage() {
    const form = wireForm('venue-owner-register-form', function (e) {
      e.preventDefault();
      if (typeof window.handleVenueOwnerRegister === 'function') window.handleVenueOwnerRegister(e);
      else console.error('[BMG Auth Fix] handleVenueOwnerRegister not found');
    });
    if (form) {
      // Wire the submit button too
      const btn = form.querySelector('[type="submit"], .auth-btn-premium, .register-btn');
      if (btn) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });
      }
      console.log('[BMG Auth Fix] Venue owner form re-wired');
    }
  }

  function rewirePlotOwnerPage() {
    const form = wireForm('plot-owner-register-form', function (e) {
      e.preventDefault();
      if (typeof window.handlePlotOwnerRegister === 'function') window.handlePlotOwnerRegister(e);
      else console.error('[BMG Auth Fix] handlePlotOwnerRegister not found');
    });
    if (form) {
      const btn = form.querySelector('[type="submit"], .auth-btn-premium, .register-btn');
      if (btn) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });
      }
      console.log('[BMG Auth Fix] Plot owner form re-wired');
    }
  }


  /* ── 5. Listen to bmg:pageShown and re-wire on every visit ─
   * showPage() already dispatches this event — we just react.      */
  window.addEventListener('bmg:pageShown', function (e) {
    const pageId = e.detail?.pageId;
    switch (pageId) {
      case 'login-page':
        // Small delay so any other initPremiumAuth call finishes first,
        // then we overwrite with correct handlers
        setTimeout(rewireLoginPage, 80);
        break;
      case 'venue-owner-register-page':
        setTimeout(rewireVenueOwnerPage, 80);
        break;
      case 'plot-owner-register-page':
        setTimeout(rewirePlotOwnerPage, 80);
        break;
    }
  });


  /* ── 6. Also run immediately on DOMContentLoaded ───────────
   * Covers the very first page load.                              */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(rewireLoginPage, 150);
      setTimeout(rewireVenueOwnerPage, 150);
      setTimeout(rewirePlotOwnerPage, 150);
    });
  } else {
    setTimeout(rewireLoginPage, 150);
    setTimeout(rewireVenueOwnerPage, 150);
    setTimeout(rewirePlotOwnerPage, 150);
  }


  console.log('✅ [bmg_auth_fix.js] Loaded — login + owner registration forms will re-wire on every page visit');

})();