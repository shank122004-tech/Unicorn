/**
 * bmg_fix_canaddground.js
 * ─────────────────────────────────────────────────────────────────
 * FIX: canAddGround blocks owners whose `registrationVerified` field
 * is undefined/missing in Firestore, even when `registrationPaid`
 * is true and payment was confirmed by Cashfree webhook.
 *
 * ROOT CAUSE: The webhook / payment confirmation handler writes
 * `registrationPaid: true` but never writes `registrationVerified`.
 * The check `!owner.registrationPaid || !owner.registrationVerified`
 * evaluates to `false || !undefined` → `false || true` → TRUE, so
 * the owner is blocked despite having paid.
 *
 * FIX STRATEGY:
 *  1. If `registrationPaid === true`, treat `registrationVerified`
 *     as also true (payment IS the verification in this system).
 *  2. Auto-write `registrationVerified: true` to Firestore so it
 *     won't be undefined next time.
 *  3. Patch `canAddGround` to use `isActive || paymentDone` as an
 *     additional fallback (webhook may write these instead).
 *
 * LOAD ORDER: after app.js (and after bmg_fixes_v4.js if present)
 * ─────────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  function waitForFn(name, cb, ms) {
    if (typeof window[name] === 'function') { cb(); return; }
    const t = setInterval(() => {
      if (typeof window[name] === 'function') { clearInterval(t); cb(); }
    }, ms || 120);
  }

  waitForFn('canAddGround', function () {

    // ── Patch canAddGround ───────────────────────────────────────
    window.canAddGround = async function () {
      const cu = window.currentUser;
      if (!cu || cu.role !== 'owner') {
        if (typeof window.showToast === 'function') window.showToast('Please login as owner', 'error');
        return false;
      }

      try {
        const db = window.db;

        // Always read fresh Firestore data
        const ownerDoc = await db.collection('owners').doc(cu.uid).get();
        if (!ownerDoc.exists) {
          if (typeof window.showToast === 'function')
            window.showToast('Owner data not found. Please contact support.', 'error');
          return false;
        }

        const owner = ownerDoc.data();

        console.log('📊 [canAddGround v2] Owner data:', {
          ownerType           : owner.ownerType,
          registrationPaid    : owner.registrationPaid,
          registrationVerified: owner.registrationVerified,
          isActive            : owner.isActive,
          paymentDone         : owner.paymentDone,
          status              : owner.status,
          isVerified          : owner.isVerified,
        });

        // ── Check 1: account blocked? ──────────────────────────
        if (owner.status && owner.status !== 'active') {
          if (typeof window.showToast === 'function')
            window.showToast('Your account is blocked. Please contact support.', 'error');
          return false;
        }

        // ── Check 2: document verification (electricity bill) ──
        // Only block if explicitly false — undefined = not yet required
        if (owner.documentVerified === false) {
          if (typeof window.showToast === 'function')
            window.showToast('Address verification pending. Please upload your electricity bill.', 'warning');
          if (document.getElementById('owner-dashboard-page')?.classList.contains('active')) {
            if (typeof window.loadOwnerDashboard === 'function') window.loadOwnerDashboard('verification');
          }
          return false;
        }

        // ── Check 3: payment / registration ────────────────────
        // Consider owner "paid" if ANY of these is truthy:
        //   registrationPaid, isActive, paymentDone
        // This handles all the different fields the webhook may write.
        const isPaid = owner.registrationPaid === true
          || owner.isActive   === true
          || owner.paymentDone === true;

        if (!isPaid) {
          // Check live config for payment requirement
          let isPaymentRequired = true;
          let paymentAmount = 5;
          try {
            const cfgDoc = await db.collection('system_config').doc('owner_registration').get();
            if (cfgDoc.exists) {
              const cfg = cfgDoc.data();
              isPaymentRequired = cfg.paymentRequired === true;
              paymentAmount = cfg.paymentAmount || 5;
            }
          } catch (_) {}

          if (isPaymentRequired) {
            console.log('❌ [canAddGround v2] Owner has NOT paid — blocking');
            if (typeof window.showToast === 'function')
              window.showToast(`Please complete registration (₹${paymentAmount}) to add grounds.`, 'warning');

            const banner = document.getElementById('owner-reg-payment-banner');
            if (banner) {
              banner.style.display = 'block';
              const txt = banner.querySelector('.banner-text p');
              if (txt) txt.textContent = `Pay ₹${paymentAmount} once and start listing your grounds!`;
              const btn = banner.querySelector('.pay-owner-fee-btn');
              if (btn) btn.innerHTML = `<i class="fas fa-credit-card"></i> Pay ₹${paymentAmount} Now`;
            }
            return false;
          } else {
            // Payment not required — auto-activate
            await db.collection('owners').doc(cu.uid).update({
              registrationPaid    : true,
              registrationVerified: true,
              isActive            : true,
              paymentDone         : true,
              registrationAutoApproved: true,
              registrationAutoApprovedAt: firebase.firestore.FieldValue.serverTimestamp(),
              updatedAt           : firebase.firestore.FieldValue.serverTimestamp(),
            });
            cu.registrationPaid     = true;
            cu.registrationVerified = true;
            cu.isActive             = true;
            cu.paymentDone          = true;
          }
        } else {
          // Owner IS paid — if registrationVerified is missing, write it now
          // so this doesn't happen again
          if (!owner.registrationVerified) {
            console.log('🔧 [canAddGround v2] registrationVerified missing — auto-writing');
            try {
              await db.collection('owners').doc(cu.uid).update({
                registrationVerified: true,
                isActive            : true,
                paymentDone         : true,
                updatedAt           : firebase.firestore.FieldValue.serverTimestamp(),
              });
            } catch (_) {}
            // Also fix in-memory
            cu.registrationVerified = true;
            cu.isActive             = true;
            cu.paymentDone          = true;
          }
          console.log('✅ [canAddGround v2] Owner has paid — allowing');
        }

        // ── Check 4: valid owner type ──────────────────────────
        const validTypes = ['venue_owner', 'plot_owner', 'VENUE_OWNER', 'PLOT_OWNER'];
        if (!validTypes.includes(owner.ownerType)) {
          console.log('❌ [canAddGround v2] Invalid owner type:', owner.ownerType);
          if (typeof window.showToast === 'function')
            window.showToast('Your account type does not allow adding grounds.', 'error');
          return false;
        }

        console.log('✅ [canAddGround v2] ALL CHECKS PASSED');
        return true;

      } catch (err) {
        console.error('❌ [canAddGround v2] Error:', err);
        if (typeof window.showToast === 'function')
          window.showToast('Error checking permissions. Please try again.', 'error');
        return false;
      }
    };

    console.log('✅ canAddGround patched (v2) — registrationVerified auto-fix active');
  });

})();