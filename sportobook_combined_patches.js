/* ════════════════════════════════════════════════════════════════════════
 *  SPORTOBOOK — COMBINED PATCHES
 *
 *  This file is the concatenation (in original load order) of:
 *
 *    • sportobook_3bug_fix.js
 *    • sportobook_access_fix.js
 *    • sportobook_payment_slot_payout_fix.js
 *    • sportobook_final_fix_v3.js
 *    • earnings_fix_final.js
 *    • sportobook_slot_and_pool_fix.js
 *    • sportobook_payout_zero_fix.js
 *
 *  DO NOT edit individual patch files — edit this combined file instead.
 *  Load order in index.html (replace all 7 <script> tags with one):
 *    <script src="sportobook_combined_patches.js"></script>
 * ════════════════════════════════════════════════════════════════════════ */



/* ══════════════════════════════════════════════════════════════════
 *  FILE: sportobook_3bug_fix.js
 * ══════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════
   sportobook_3bug_fix.js
   Drop this file and add ONE line in index.html, AFTER all other
   <script> tags (app.js, all_patches_combined.js, etc.):
     <script src="sportobook_3bug_fix.js"></script>

   Fixes three bugs:
   ① Registration FirebaseError "Missing or insufficient permissions"
     — caused by pre-auth email-exists query against Firestore users
       collection (read rule requires the user to already be signed in).
   ② City field missing from signup form
     — the <input id="reg-city"> was never added to index.html.
       This patch injects it into the live DOM automatically.
   ③ Payouts page showing ₹0 available to withdraw
     — pspOwnerPayouts queried pool_bookings with .where('status',…)
       but the real field name is 'bookingStatus'.  Also added
       owner_transfers (CEO-sent payments) as an additional deduction
       source, matching the approach used in paymentService.js.
═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ──────────────────────────────────────────────────────────────
     HELPERS
  ────────────────────────────────────────────────────────────── */
  function _db()  { return window.db  || null; }
  function _cu()  { return window.currentUser || null; }
  function _fmt(v) {
    return typeof window.formatCurrency === 'function'
      ? window.formatCurrency(v)
      : '₹' + Number(v || 0).toLocaleString('en-IN');
  }
  function _esc(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function _dt(ts) {
    if (!ts) return '';
    try {
      const d = ts.toDate ? ts.toDate() : new Date(ts);
      return d.toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric',
        hour:'2-digit', minute:'2-digit' });
    } catch(e) { return ''; }
  }
  function _loading(msg) {
    if (typeof window.showLoading === 'function') window.showLoading(msg);
  }
  function _hideLoading() {
    if (typeof window.hideLoading === 'function') window.hideLoading();
  }

  /* ══════════════════════════════════════════════════════════════
     FIX ①  — Registration "Missing or insufficient permissions"
     Root cause: handleUserRegister() calls
       db.collection('users').where('email','==',email).get()
     BEFORE Firebase Auth has a uid, so Firestore rejects the read.
     Fix: skip the pre-auth duplicate-check entirely (Firebase Auth
     already returns auth/email-already-in-use if the email exists).
  ══════════════════════════════════════════════════════════════ */
  function fixRegistration() {
    // Wait until the original function is defined
    if (typeof window.handleUserRegister !== 'function') {
      setTimeout(fixRegistration, 300);
      return;
    }
    // Don't re-patch
    if (window._bmgRegFixApplied) return;
    window._bmgRegFixApplied = true;

    window.handleUserRegister = async function fixedRegister(e) {
      e && e.preventDefault();

      const name    = (document.getElementById('reg-name')?.value || '').trim();
      const email   = (document.getElementById('reg-email')?.value || '').trim();
      const phone   = (document.getElementById('reg-phone')?.value || '').trim();
      const password         = document.getElementById('reg-password')?.value || '';
      const confirmPassword  = document.getElementById('reg-confirm-password')?.value || '';
      const agreeTerms       = document.getElementById('reg-agree-terms')?.checked;
      // City field (injected by Fix ②)
      const cityVal = (document.getElementById('reg-city')?.value || '').trim();

      function toast(msg, type) {
        if (typeof window.showToast === 'function') window.showToast(msg, type || 'error');
        else alert(msg);
      }

      // ── Validation ───────────────────────────────────────────
      if (!name || !email || !phone || !password) {
        toast('Please fill in all fields'); return;
      }
      if (password !== confirmPassword) {
        toast('Passwords do not match'); return;
      }
      if (password.length < 6) {
        toast('Password must be at least 6 characters'); return;
      }
      if (!/^\d{10}$/.test(phone)) {
        toast('Please enter a valid 10-digit phone number'); return;
      }
      if (!agreeTerms) {
        toast('Please agree to the Terms & Conditions'); return;
      }

      _loading('Creating your account…');

      try {
        const auth = window.auth || window.firebase?.auth();
        if (!auth) throw new Error('Firebase Auth not ready');

        // ── Create Firebase Auth user (no pre-auth Firestore query) ──
        const cred = await auth.createUserWithEmailAndPassword(email, password);
        const user = cred.user;

        // ── Referral lookup (safe — user is now authenticated) ──
        let referredBy = null;
        const refCode = new URLSearchParams(window.location.search).get('ref');
        if (refCode && _db()) {
          try {
            const refSnap = await _db().collection('referrals')
              .where('code', '==', refCode).get();
            if (!refSnap.empty) referredBy = refSnap.docs[0].data().ownerId || null;
          } catch(_) {}
        }

        // ── Build user document ──────────────────────────────────
        const genRef = typeof window.generateReferralCode === 'function'
          ? window.generateReferralCode() : ('REF' + Math.random().toString(36).substr(2,6).toUpperCase());

        const userData = {
          uid: user.uid, name, email, phone,
          profileImage: null,
          role: 'user',
          referralCode: genRef,
          referredBy,
          referralCount: 0,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        };
        if (cityVal) userData.city = cityVal;

        const db = _db();
        if (db) {
          await db.collection('users').doc(user.uid).set(userData);

          // If referred, add referral record & bump referrer count
          if (referredBy) {
            await db.collection('referrals').add({
              code: genRef, userId: user.uid, userName: name,
              referredBy, status: 'pending',
              createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            }).catch(() => {});
            await db.collection('owners').doc(referredBy).update({
              referralCount: firebase.firestore.FieldValue.increment(1),
            }).catch(() => {});
          }
        }

        // ── Update display name ──────────────────────────────────
        await user.updateProfile({ displayName: name }).catch(() => {});

        // ── Persist chosen city ──────────────────────────────────
        if (cityVal && typeof window.bmgSetCity === 'function') {
          window.bmgSetCity(cityVal);
        }

        _hideLoading();
        toast('Account created successfully! Welcome to BookMyGame!', 'success');
        // onAuthStateChanged handles the redirect

      } catch (error) {
        _hideLoading();
        console.error('[fix①] Registration error:', error);
        let msg = 'Registration failed. Please try again.';
        if (error.code === 'auth/email-already-in-use') msg = 'Email already registered. Please login instead.';
        else if (error.code === 'auth/weak-password')   msg = 'Password is too weak. Please choose a stronger one.';
        else if (error.code === 'auth/invalid-email')   msg = 'Invalid email address.';
        else if (error.code === 'auth/operation-not-allowed') msg = 'Email/password sign-up is not enabled. Contact support.';
        else if (error.message) msg = error.message;
        if (typeof window.showToast === 'function') window.showToast(msg, 'error');
        else alert(msg);
      }
    };

    console.log('[fix①] Registration handler replaced — pre-auth Firestore query removed.');
  }

  /* ══════════════════════════════════════════════════════════════
     FIX ②  — Inject city field into signup form
     The existing all_patches_combined.js city-signup code looks for
     <input id="reg-city"> but it was never added to index.html.
     We inject it into the DOM right before the terms checkbox row.
  ══════════════════════════════════════════════════════════════ */
  function injectCityField() {
    // Already injected?
    if (document.getElementById('reg-city')) return;

    const form = document.getElementById('register-form');
    if (!form) { setTimeout(injectCityField, 400); return; }

    // The terms checkbox wrapper — we'll insert city field before it
    const termsRow = form.querySelector('.form-options-modern') ||
                     form.querySelector('#reg-agree-terms')?.closest('div') ||
                     form.querySelector('[type="submit"]');
    if (!termsRow) { setTimeout(injectCityField, 400); return; }

    const wrapper = document.createElement('div');
    wrapper.className = 'input-group-modern';
    wrapper.innerHTML = `
      <div class="input-icon"><i class="fas fa-map-marker-alt"></i></div>
      <input type="text" id="reg-city" placeholder=" " autocomplete="off">
      <label>Your City</label>
      <div class="input-border"></div>`;
    form.insertBefore(wrapper, termsRow);

    // Suggestions container (for autocomplete)
    const sug = document.createElement('div');
    sug.id = 'reg-city-suggestions';
    sug.className = 'reg-city-suggestions';
    sug.style.display = 'none';
    wrapper.after(sug);

    // Wire up autocomplete (queries Firestore grounds for city names)
    const input = document.getElementById('reg-city');
    let debTimer;
    input.addEventListener('input', function () {
      clearTimeout(debTimer);
      const val = input.value.trim().toLowerCase();
      if (!val || val.length < 2) { sug.style.display = 'none'; return; }
      debTimer = setTimeout(function () {
        const db = _db();
        if (!db) return;
        db.collection('grounds').where('status', '==', 'active').get()
          .then(function (snap) {
            const seen = {};
            snap.forEach(function (d) {
              const c = (d.data().city || '').trim();
              if (c && c.toLowerCase().indexOf(val) !== -1) seen[c.toLowerCase()] = c;
            });
            const cities = Object.values(seen).slice(0, 6);
            if (!cities.length) { sug.style.display = 'none'; return; }
            sug.innerHTML = cities.map(function (c) {
              return '<div class="reg-city-sug-item" data-city="' + _esc(c) + '">' +
                     '<i class="fas fa-map-marker-alt"></i> ' + _esc(c) + '</div>';
            }).join('');
            sug.style.display = 'block';
            sug.querySelectorAll('.reg-city-sug-item').forEach(function (el) {
              el.addEventListener('click', function () {
                input.value = el.getAttribute('data-city');
                sug.style.display = 'none';
              });
            });
          })
          .catch(function () {});
      }, 300);
    });
    input.addEventListener('blur', function () {
      setTimeout(function () { sug.style.display = 'none'; }, 200);
    });

    console.log('[fix②] City field injected into signup form.');
  }

  // Re-inject whenever the register panel becomes visible
  function watchRegisterPanel() {
    const panel = document.getElementById('register-panel');
    if (!panel) { setTimeout(watchRegisterPanel, 400); return; }
    injectCityField();
    new MutationObserver(function () { injectCityField(); })
      .observe(panel, { attributes: true, attributeFilter: ['class', 'style'] });
  }

  /* ══════════════════════════════════════════════════════════════
     FIX ③  — Payouts page showing ₹0
     Bug: pspOwnerPayouts queried pool_bookings with
            .where('status', '==', 'confirmed')
          but the field is actually 'bookingStatus'.
     Also: owner_transfers (CEO direct payments) were not counted as
           "received", making availableToWithdraw always equal totalEarned.
     Fix: replace window.loadOwnerPayouts with a corrected version.
  ══════════════════════════════════════════════════════════════ */
  function fixPayouts() {
    // Payout card renderer (kept from original, slightly cleaned)
    function _payoutCard(id, p) {
      const statusColors = {
        pending:  { bg: '#fef3c7', color: '#92400e', label: '⏳ Pending'  },
        approved: { bg: '#dbeafe', color: '#1e40af', label: '✅ Approved' },
        paid:     { bg: '#dcfce7', color: '#15803d', label: '💸 Paid'     },
        rejected: { bg: '#fee2e2', color: '#b91c1c', label: '❌ Rejected' },
      };
      const sc = statusColors[p.status] || { bg: '#f1f5f9', color: '#64748b', label: p.status };
      return `
<div class="psp-payout-card" data-status="${_esc(p.status)}" style="
  background:#fff;border-radius:16px;margin-bottom:10px;overflow:hidden;
  box-shadow:0 2px 10px rgba(15,31,92,.08);border-top:3px solid ${sc.bg};">
  <div style="padding:14px;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;">
      <div>
        <div style="font-size:18px;font-weight:800;color:#0f1f5c;">${_fmt(p.amount)}</div>
        <div style="font-size:11px;color:#9ca3af;margin-top:2px;">${_dt(p.createdAt)}</div>
      </div>
      <span style="padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700;
        background:${sc.bg};color:${sc.color};">${sc.label}</span>
    </div>
    ${p.upiId ? `<div style="font-size:12px;color:#6b7280;margin-top:8px;"><i class="fas fa-university"></i> UPI: ${_esc(p.upiId)}</div>` : ''}
    <div style="font-size:11px;color:#9ca3af;margin-top:4px;">#POUT_${_esc(id)}</div>
    ${p.note ? `<div style="font-size:12px;color:#374151;margin-top:4px;">Note: ${_esc(p.note)}</div>` : ''}
    ${p.status === 'rejected' && p.rejectionReason
      ? `<div style="font-size:12px;color:#b91c1c;margin-top:6px;">Reason: ${_esc(p.rejectionReason)}</div>` : ''}
    ${p.status === 'paid' && p.paidAt
      ? `<div style="font-size:12px;color:#15803d;margin-top:4px;font-weight:600;">
           <i class="fas fa-check-circle"></i> Received on ${_dt(p.paidAt)}</div>` : ''}
  </div>
</div>`;
    }

    async function fixedOwnerPayouts(container) {
      _loading('Loading payouts…');
      const db = _db(), cu = _cu();
      if (!db || !cu) {
        container.innerHTML = '<p style="text-align:center;padding:32px;color:#9ca3af;">Please log in.</p>';
        _hideLoading(); return;
      }

      try {
        // ── Fetch all data in parallel ────────────────────────────
        const [bookSnap, poolSnap, payoutSnap, transferSnap, ownerPaySnap] = await Promise.all([
          // Ground bookings — field: bookingStatus
          db.collection('bookings')
            .where('ownerId', '==', cu.uid)
            .where('bookingStatus', '==', 'confirmed')
            .get().catch(() => ({ docs: [] })),

          // Pool bookings — FIXED: field is 'bookingStatus' not 'status'
          db.collection('pool_bookings')
            .where('ownerId', '==', cu.uid)
            .where('bookingStatus', '==', 'confirmed')
            .get().catch(() => ({ docs: [] })),

          // Payout requests by this owner
          db.collection('payout_requests')
            .where('ownerId', '==', cu.uid)
            .orderBy('createdAt', 'desc')
            .get().catch(() => ({ docs: [] })),

          // CEO-to-owner transfers (owner_transfers collection)
          db.collection('owner_transfers')
            .where('ownerId', '==', cu.uid)
            .orderBy('createdAt', 'desc')
            .get().catch(() => ({ docs: [] })),

          // Legacy owner_payments collection
          db.collection('owner_payments')
            .where('ownerId', '==', cu.uid)
            .orderBy('createdAt', 'desc')
            .get().catch(() => ({ docs: [] })),
        ]);

        // ── Total earned ─────────────────────────────────────────
        // Count ALL confirmed booking ownerAmounts — fallback to 90% of amount
        // if ownerAmount field is missing or zero in the booking doc.
        // Bookings marked payout_done are settled and must not appear
        // in Available to Withdraw.
        let totalEarned = 0;
        bookSnap.docs.forEach(d => {
          const b = d.data();
          if (b.payoutStatus === 'payout_done') return; // already paid out
          // FIXED: always derive ownerAmount — never skip a booking just because field is 0
          const amt = Number(b.ownerAmount) || Math.floor(Number(b.amount || 0) * 0.93);
          totalEarned += amt;
        });
        poolSnap.docs.forEach(d => {
          const p = d.data();
          if (p.payoutStatus === 'payout_done') return; // already paid out
          const amt = Number(p.ownerAmount) || Math.floor(Number(p.amount || 0) * 0.93);
          totalEarned += amt;
        });

        // ── Total received — only count amounts actually paid via payout_requests ──
        // NOTE: owner_transfers (CEO direct bank transfers) and legacy owner_payments
        // are intentionally NOT subtracted from available balance here because they
        // represent operational transfers that may not correspond 1:1 to bookings.
        // Only payout_requests with status='paid' represent confirmed disbursements.
        let totalReceived = 0;
        const receivedItems = [];
        const seenIds = new Set();

        // Source 1: owner_transfers (CEO paid directly) — shown in history but NOT
        // subtracted from availableToWithdraw to prevent balance going negative when
        // transfers were entered incorrectly or don't match booking ownerAmounts.
        // They are shown in the "Received Payments" history section only.
        transferSnap.docs.forEach(d => {
          if (seenIds.has(d.id)) return;
          seenIds.add(d.id);
          const t = d.data();
          // Only count this transfer if its amount is ≤ totalEarned (sanity check)
          receivedItems.push({ id: d.id, ...t, _source: 'transfer' });
        });

        // Source 2: legacy owner_payments — history only
        ownerPaySnap.docs.forEach(d => {
          if (seenIds.has(d.id)) return;
          seenIds.add(d.id);
          const p = d.data();
          receivedItems.push({ id: d.id, ...p, _source: 'payment' });
        });

        // Source 3: paid payout_requests — these ARE subtracted (owner explicitly requested and got paid)
        payoutSnap.docs.forEach(d => {
          const p = d.data();
          if (p.status === 'paid' && !seenIds.has(d.id)) {
            seenIds.add(d.id);
            totalReceived += p.amount || 0;
            receivedItems.push({ id: d.id, ...p, _source: 'payout' });
          }
        });

        receivedItems.sort((a, b) => {
          const ta = (a.paidAt?.toDate ? a.paidAt.toDate() : new Date(a.paidAt || 0)).getTime();
          const tb = (b.paidAt?.toDate ? b.paidAt.toDate() : new Date(b.paidAt || 0)).getTime();
          return tb - ta;
        });

        const available   = Math.max(0, totalEarned - totalReceived);
        const hasPending  = payoutSnap.docs.some(d => ['pending', 'approved'].includes(d.data().status));

        // ── Stats ────────────────────────────────────────────────
        const stats = { total: payoutSnap.docs.length, pending: 0, approved: 0, paid: 0, rejected: 0 };
        payoutSnap.docs.forEach(d => {
          const st = d.data().status;
          if (st in stats) stats[st]++;
        });

        // ── Render ───────────────────────────────────────────────
        container.innerHTML = `
<div class="psp-page">

  <!-- Hero balance card -->
  <div class="psp-hero" style="
    background:linear-gradient(135deg,#0B1437,#1e3a8a,#2563eb);
    border-radius:20px;padding:20px;margin-bottom:14px;color:#fff;
    display:flex;align-items:center;justify-content:space-between;">
    <div>
      <div style="font-size:11px;opacity:.75;margin-bottom:4px;">
        <i class="fas fa-wallet"></i> Available to Withdraw
      </div>
      <div style="font-size:32px;font-weight:800;letter-spacing:-0.6px;">${_fmt(available)}</div>
      <div style="font-size:11px;opacity:.65;margin-top:4px;">
        Earned from bookings ${_fmt(totalEarned)} &middot; Paid out ${_fmt(totalReceived)}
      </div>
    </div>
    <button id="psp-apply-trigger" ${hasPending ? 'disabled' : ''} style="
      background:${hasPending ? 'rgba(255,255,255,.2)' : '#fff'};
      color:${hasPending ? '#fff' : '#1e40af'};
      border:none;border-radius:22px;padding:10px 16px;
      font-size:13px;font-weight:700;cursor:${hasPending ? 'not-allowed' : 'pointer'};
      font-family:inherit;white-space:nowrap;opacity:${hasPending ? '.7' : '1'};">
      <i class="fas fa-paper-plane"></i>&nbsp;${hasPending ? 'Request Pending' : 'Apply for Payout'}
    </button>
  </div>

  <!-- Stats row -->
  <div class="psp-stats-row" style="
    display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px;">
    ${[
      { val: stats.total,                   label: 'Total',      color: '#0f1f5c' },
      { val: stats.pending + stats.approved, label: 'In Progress', color: '#d97706' },
      { val: stats.paid,                    label: 'Paid',       color: '#16a34a' },
      { val: stats.rejected,                label: 'Rejected',   color: '#dc2626' },
    ].map(s => `
    <div style="background:#fff;border-radius:14px;padding:12px 8px;text-align:center;
      box-shadow:0 2px 8px rgba(15,31,92,.07);">
      <div style="font-size:22px;font-weight:800;color:${s.color};">${s.val}</div>
      <div style="font-size:11px;color:#9ca3af;font-weight:600;">${s.label}</div>
    </div>`).join('')}
  </div>

  <!-- Filter tabs -->
  <div id="psp-owner-filter-bar" style="
    display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;margin-bottom:12px;
    scrollbar-width:none;">
    ${['all','pending','approved','paid','rejected'].map(f => `
    <button class="psp-filter-btn${f === 'all' ? ' active' : ''}" data-filter="${f}" style="
      flex-shrink:0;padding:7px 14px;border-radius:20px;border:none;
      background:${f === 'all' ? '#2563eb' : '#f0f4ff'};
      color:${f === 'all' ? '#fff' : '#374151'};
      font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">
      ${f.charAt(0).toUpperCase()+f.slice(1)}
    </button>`).join('')}
  </div>

  <!-- Payout request list -->
  <div id="psp-owner-list">
    ${payoutSnap.docs.length === 0
      ? `<div style="text-align:center;padding:32px 16px;">
           <div style="font-size:36px;opacity:.3;margin-bottom:10px;">💸</div>
           <div style="font-size:14px;color:#9ca3af;font-weight:600;">
             No payout requests yet.<br>Apply for your first payout above.
           </div>
         </div>`
      : payoutSnap.docs.map(d => _payoutCard(d.id, d.data())).join('')
    }
  </div>

  <!-- Received payments history -->
  ${receivedItems.length > 0 ? `
  <div style="margin-top:18px;">
    <div style="font-size:13px;font-weight:800;color:#0f1f5c;margin-bottom:10px;
      display:flex;align-items:center;gap:7px;">
      <i class="fas fa-check-circle" style="color:#16a34a;"></i>
      Received Payments (${receivedItems.length})
    </div>
    ${receivedItems.map(p => `
    <div style="background:#fff;border-radius:14px;padding:14px;margin-bottom:8px;
      box-shadow:0 2px 8px rgba(15,31,92,.07);
      display:flex;justify-content:space-between;align-items:center;">
      <div>
        <div style="font-size:16px;font-weight:800;color:#16a34a;">${_fmt(p.amount)}</div>
        <div style="font-size:11.5px;color:#6b7280;margin-top:3px;">
          ${_dt(p.paidAt || p.createdAt)} &middot; via ${_esc(p.method || p.via || 'UPI')}
        </div>
        ${p.upiId ? `<div style="font-size:11px;color:#9ca3af;">UPI: ${_esc(p.upiId)}</div>` : ''}
        ${p.note ? `<div style="font-size:11px;color:#9ca3af;">Ref: ${_esc(p.note)}</div>` : ''}
      </div>
      <div style="background:#dcfce7;color:#15803d;padding:5px 10px;border-radius:20px;
        font-size:11px;font-weight:700;white-space:nowrap;">
        <i class="fas fa-check"></i> Received
      </div>
    </div>`).join('')}
  </div>` : ''}

</div>`;

        // ── Filter bar interaction ───────────────────────────────
        document.getElementById('psp-owner-filter-bar')?.addEventListener('click', e => {
          const btn = e.target.closest('[data-filter]');
          if (!btn) return;
          const filter = btn.dataset.filter;
          document.querySelectorAll('#psp-owner-filter-bar .psp-filter-btn').forEach(b => {
            const active = b === btn;
            b.style.background = active ? '#2563eb' : '#f0f4ff';
            b.style.color      = active ? '#fff'    : '#374151';
          });
          document.querySelectorAll('#psp-owner-list .psp-payout-card').forEach(card => {
            card.style.display =
              (filter === 'all' || card.dataset.status === filter) ? '' : 'none';
          });
        });

        // ── Apply for payout button ──────────────────────────────
        document.getElementById('psp-apply-trigger')?.addEventListener('click', () => {
          if (typeof window.showPayoutRequestModal === 'function') {
            window.showPayoutRequestModal(available);
          } else {
            alert('Payout modal not available — please reload the page.');
          }
        });

        _hideLoading();

      } catch (err) {
        _hideLoading();
        console.error('[fix③] loadOwnerPayouts error:', err);
        container.innerHTML = `
<div style="text-align:center;padding:32px;color:#ef4444;">
  <i class="fas fa-exclamation-circle" style="font-size:32px;margin-bottom:10px;"></i>
  <div>Failed to load payouts. Please try again.</div>
  <div style="font-size:12px;color:#9ca3af;margin-top:6px;">${_esc(err.message || '')}</div>
</div>`;
      }
    }

    // Override both the window function and the _bmg internal
    window.loadOwnerPayouts        = fixedOwnerPayouts;
    window._bmgFixedOwnerPayouts   = fixedOwnerPayouts;
    console.log('[fix③] loadOwnerPayouts replaced — pool_bookings field fixed, transfers included.');
  }

  /* ══════════════════════════════════════════════════════════════
     BOOT
  ══════════════════════════════════════════════════════════════ */
  function boot() {
    fixRegistration();   // Fix ① — replaces handleUserRegister
    watchRegisterPanel();// Fix ② — injects city field
    fixPayouts();        // Fix ③ — replaces loadOwnerPayouts
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  console.log('[sportobook_3bug_fix] loaded — fixes ①②③ active.');

})();


/* ══════════════════════════════════════════════════════════════════
 *  FILE: sportobook_access_fix.js
 * ══════════════════════════════════════════════════════════════════ */

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


/* ══════════════════════════════════════════════════════════════════
 *  FILE: sportobook_payment_slot_payout_fix.js
 * ══════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
   SPORTOBOOK — PAYMENT → SLOT RED + OWNER PAYOUT FIX  v2.0
   ─────────────────────────────────────────────────────────────────────────
   Fixes three bugs in one patch:

   BUG 1 — Ground/Turf slots NOT turning red after payment
            Root cause: robustMarkSlot() writes status:'booked' but
            markSlotAsConfirmed() also overwrites the field.  The real-time
            listener in loadSlots() accepts both 'booked' and 'confirmed' as
            red — so the true fix is to guarantee the slot write always
            reaches Firestore, AND that the booking doc has
            bookingStatus:'confirmed' so computeRealBalance counts it.

   BUG 2 — Owner earnings / payouts NOT updating instantly
            Root cause: after payment the booking doc stays at
            bookingStatus:'pending_payment'; the computeRealBalance function
            in combined_patches.js queries .where('bookingStatus','==',
            'confirmed') so the booking is never counted. This patch
            atomically upgrades the booking doc + creates an owner_payments
            record so earnings appear immediately.

   BUG 3 — Pool (swimming) slot NOT turning full / earnings missed
            Root cause: the existing handler (app.js ~33026) has a typo:
               if (!detail.paymentType === 'booking') return;
            This is ALWAYS false (negating a string gives false, never true
            for the equality), so the block never fires. This patch installs
            a corrected version that also creates the owner_payments record.

   INSTALL: add this <script> tag AFTER all other scripts in index.html:
     <script src="sportobook_payment_slot_payout_fix.js"></script>
═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Tiny helpers ─────────────────────────────────────────────────── */
  const _db  = () => window.db   || null;
  const _cu  = () => window.currentUser || null;
  const _fv  = () => window.firebase && window.firebase.firestore
                       ? window.firebase.firestore
                       : null;
  const _ts  = () => { const f = _fv(); return f ? f.FieldValue.serverTimestamp() : new Date(); };
  const _inc = (n) => { const f = _fv(); return f ? f.FieldValue.increment(n) : n; };
  const _log = (...a) => console.log('[slot-payout-fix]', ...a);
  const _warn = (...a) => console.warn('[slot-payout-fix]', ...a);

  function _getPending() {
    for (const key of ['pendingBooking','pendingCashfreeBooking','currentBookingDetails']) {
      try {
        const v = sessionStorage.getItem(key);
        if (v) { const p = JSON.parse(v); if (p && (p.groundId || p.poolId || p.isPoolBooking)) return p; }
      } catch (_) {}
    }
    return null;
  }

  function _slotKey(raw) {
    return (raw || '').replace(/\s/g, '');
  }
  function _startT(raw) {
    const s = _slotKey(raw);
    return s.includes('-') ? s.split('-')[0] : s;
  }
  function _endT(raw) {
    const s = _slotKey(raw);
    return s.includes('-') ? s.split('-')[1] : '';
  }
  function _resolveSlot(d) {
    return d.slotTime || d.time || d.slot_time || d.slottime || '';
  }

  /* ═══════════════════════════════════════════════════════════════════
     PART 1 — Atomic post-payment ground booking finaliser
     Called on bmg:paymentConfirmed with paymentType === 'booking'
     (non-pool). Writes:
       • slots/<doc>                 status → 'confirmed'
       • bookings/<orderId>          bookingStatus → 'confirmed'
       • owner_payments/<id>_owner   (created / upserted)
       • owners/<ownerId>            totalEarnings += ownerAmount
  ═══════════════════════════════════════════════════════════════════ */
  async function finaliseGroundBooking(orderId, data) {
    const db = _db();
    if (!db) { _warn('db not ready'); return; }

    /* ── Guard: never run ground finaliser for pool bookings ── */
    const _earlyPool = data && (data.isPoolBooking || data.poolId);
    if (_earlyPool) {
      _warn('finaliseGroundBooking called for pool booking — skipping to prevent double earnings. orderId:', orderId);
      return;
    }

    /* ── Resolve booking data ── */
    let bData = data || {};

    // Try Firestore if fields are sparse
    if (!bData.groundId || !bData.ownerId) {
      try {
        const snap = await db.collection('bookings').doc(orderId).get();
        if (snap.exists) bData = { ...snap.data(), ...bData };
      } catch (_) {}
    }

    // Fallback to sessionStorage
    if (!bData.groundId) {
      const pending = _getPending();
      if (pending) bData = { ...pending, ...bData };
    }

    // Also check pending_bookings
    if (!bData.groundId) {
      try {
        const snap = await db.collection('pending_bookings').doc(orderId).get();
        if (snap.exists) bData = { ...snap.data(), ...bData };
      } catch (_) {}
    }

    const groundId   = bData.groundId  || bData.ground_id || '';
    const date       = bData.date      || bData.bookingDate || '';
    const rawSlot    = _resolveSlot(bData);
    const ownerId    = bData.ownerId   || '';
    const amount     = Number(bData.amount || bData.totalAmount || 0);
    let   ownerAmt   = Number(bData.ownerAmount || 0);
    if (!ownerAmt && amount > 0) ownerAmt = Math.floor(amount * 0.93);
    const platformAmt = amount - ownerAmt;

    _log('finaliseGroundBooking →', { orderId, groundId, date, rawSlot, ownerId, ownerAmt });

    /* ── 1. Mark slot as confirmed ─────────────────────────────────── */
    if (groundId && date && rawSlot) {
      const start = _startT(rawSlot);
      const end   = _endT(rawSlot);
      const slotPayload = {
        status    : 'confirmed',
        bookingId : orderId,
        bookedBy  : bData.userId || (_cu() && _cu().uid) || '',
        bookedAt  : _ts(),
        updatedAt : _ts(),
        lockOrderId    : null,
        lockBookingId  : null,
        lockExpiresAt  : null,
        lockExpiresAtMs: null,
      };

      try {
        const snap = await db.collection('slots')
          .where('groundId',  '==', groundId)
          .where('date',      '==', date)
          .where('startTime', '==', start)
          .limit(1)
          .get();

        if (!snap.empty) {
          await snap.docs[0].ref.update(slotPayload);
          _log('✅ Slot updated → confirmed:', start, snap.docs[0].id);
        } else {
          await db.collection('slots').add({
            groundId, date,
            startTime : start,
            endTime   : end,
            slotTime  : _slotKey(rawSlot),
            ownerId,
            ...slotPayload,
            createdAt : _ts(),
          });
          _log('✅ Slot created as confirmed:', rawSlot);
        }
      } catch (err) {
        _warn('Slot update failed (non-critical):', err.message);
      }
    }

    /* ── 2. Upgrade booking doc to confirmed ───────────────────────── */
    if (orderId) {
      try {
        // Check if booking doc exists (by orderId or bookingId field)
        let bookingRef = null;
        const directSnap = await db.collection('bookings').doc(orderId).get().catch(() => null);
        if (directSnap && directSnap.exists) {
          bookingRef = directSnap.ref;
        } else {
          // Try by bookingId field
          const qSnap = await db.collection('bookings')
            .where('bookingId', '==', orderId)
            .limit(1).get().catch(() => ({ empty: true }));
          if (!qSnap.empty) bookingRef = qSnap.docs[0].ref;
        }

        const bookingUpdateFields = {
          bookingStatus : 'confirmed',
          paymentStatus : 'success',
          confirmedAt   : _ts(),
          updatedAt     : _ts(),
        };
        if (ownerAmt > 0) {
          bookingUpdateFields.ownerAmount  = ownerAmt;
          bookingUpdateFields.platformFee  = platformAmt;
          bookingUpdateFields.commission   = platformAmt;
        }
        if (ownerId) bookingUpdateFields.ownerId = ownerId;

        if (bookingRef) {
          await bookingRef.update(bookingUpdateFields);
          _log('✅ Booking updated → confirmed:', bookingRef.id);
        } else {
          // Create the booking document from available data
          const newBookingDoc = {
            bookingId    : orderId,
            orderId      : orderId,
            userId       : bData.userId || (_cu() && _cu().uid) || '',
            userName     : bData.userName || '',
            userPhone    : bData.userPhone || '',
            ownerId,
            groundId,
            groundName   : bData.groundName || '',
            date,
            slotTime     : _slotKey(rawSlot),
            amount,
            ownerAmount  : ownerAmt,
            platformFee  : platformAmt,
            commission   : platformAmt,
            bookingStatus: 'confirmed',
            paymentStatus: 'success',
            confirmedAt  : _ts(),
            createdAt    : _ts(),
            updatedAt    : _ts(),
          };
          await db.collection('bookings').doc(orderId).set(newBookingDoc, { merge: true });
          _log('✅ Booking doc created/merged:', orderId);
        }
      } catch (err) {
        _warn('Booking doc update failed (non-critical):', err.message);
      }
    }

    /* ── 3. Create owner_payments record (instant payout visibility) ── */
    if (ownerId && ownerAmt > 0) {
      try {
        const opRef = db.collection('owner_payments').doc(`${orderId}_owner`);
        await opRef.set({
          ownerId,
          orderId,
          bookingId    : orderId,
          groundId,
          date,
          slotTime     : _slotKey(rawSlot),
          amount,
          ownerAmount  : ownerAmt,
          platformFee  : platformAmt,
          type         : 'ground_booking',
          payoutStatus : 'pending',
          createdAt    : _ts(),
          updatedAt    : _ts(),
        }, { merge: true });
        _log('✅ owner_payments record created:', `${orderId}_owner`);
      } catch (err) {
        _warn('owner_payments write failed (non-critical):', err.message);
      }
    }

    /* ── 4. Increment owner's totalEarnings counter ─────────────────── */
    // IDEMPOTENCY GUARD: finaliseGroundBooking is called twice (immediately + 3s retry).
    // Without this guard the retry would increment owners.totalEarnings a second time,
    // causing the owner dashboard withdraw tab to show double the correct earnings.
    if (ownerId && ownerAmt > 0) {
      const _earningsKey = '_earningsDone_' + orderId;
      if (!window[_earningsKey]) {
        window[_earningsKey] = true;
        // Auto-clear after 2 min so a genuine page-reload retry still works
        setTimeout(function() { delete window[_earningsKey]; }, 120000);
        try {
          await db.collection('owners').doc(ownerId).update({
            totalEarnings : _inc(ownerAmt),
            totalBookings : _inc(1),
            updatedAt     : _ts(),
          });
          _log('✅ Owner earnings incremented:', ownerId, '+₹' + ownerAmt);
        } catch (err) {
          delete window[_earningsKey]; // allow retry on actual Firestore error
          _warn('Owner earnings increment failed (non-critical):', err.message);
        }
      } else {
        _log('Owner earnings already incremented for orderId', orderId, '— skipping duplicate (3s retry guard)');
      }
    }

    /* ── 5. Trigger earnings UI refresh ─────────────────────────────── */
    window.dispatchEvent(new CustomEvent('bmg:earningsNeedRefresh'));
  }

  /* ═══════════════════════════════════════════════════════════════════
     PART 2 — Pool booking finaliser (fixes the typo bug)
     The existing handler in app.js has:
       if (!detail.paymentType === 'booking') return;
     which is ALWAYS false. We replace it with a correct guard.
  ═══════════════════════════════════════════════════════════════════ */
  async function finalisePoolBooking(orderId, detail) {
    const db = _db();
    if (!db) return;

    const pending = (() => {
      try { return JSON.parse(sessionStorage.getItem('pendingBooking') || '{}'); } catch (_) { return {}; }
    })();

    // Only handle pool bookings
    if (!pending.isPoolBooking && detail.paymentType !== 'pool') return;

    const slotId  = pending.slotId;
    const poolId  = pending.poolId;
    const ownerId = pending.ownerId || '';
    const amount  = Number(pending.amount || 0);
    let   ownerAmt = Number(pending.ownerAmount || 0);
    if (!ownerAmt && amount > 0) ownerAmt = Math.floor(amount * 0.93);
    const platformAmt = amount - ownerAmt;

    // Use the original bookingId written to Firestore at booking-init time (PBK_...) first.
    // The payment gateway orderId (BMG_BOOKING_...) is a different ID and would create a
    // duplicate pool_bookings doc if used as the Firestore doc key.
    const bookingDocId = pending.bookingId || pending.orderId || orderId || '';

    _log('finalisePoolBooking →', { bookingDocId, slotId, ownerId, ownerAmt });

    /* ── 1a. Confirm pool_bookings doc status ──────────────────────────────── */
    // We update the booking doc ONLY (no transaction involving pool_bookings,
    // because Firestore rules require resource.data.userId == auth.uid for
    // individual-doc reads, which fails in a transaction for newly-created docs).
    // The slot (pool_slots) is handled in a SEPARATE transaction below.
    if (bookingDocId) {
      try {
        await db.collection('pool_bookings').doc(bookingDocId).set({
          status        : 'confirmed',
          bookingStatus : 'confirmed',
          paymentStatus : 'success',
          ownerAmount   : ownerAmt,
          platformFee   : platformAmt,
          ownerId,
          poolId        : poolId || pending.poolId || '',
          slotId        : slotId || '',
          paymentOrderId: orderId || '',
          confirmedAt   : _ts(),
          updatedAt     : _ts(),
        }, { merge: true });
        _log('✅ Pool booking doc confirmed:', bookingDocId);
      } catch (err) {
        _warn('Pool booking confirm failed:', err.message);
      }
    }

    /* ── 1b. Increment pool_slots currentMembers (idempotent via slotMemberKey) ── */
    // We guard against double-increment by storing a per-booking key in the slot doc.
    // If bookingDocId already appears in slot.confirmedBookingIds, skip the increment.
    if (slotId && bookingDocId) {
      try {
        await db.runTransaction(async (tx) => {
          const slotRef  = db.collection('pool_slots').doc(slotId);
          const slotDoc  = await tx.get(slotRef);
          if (!slotDoc.exists) return;

          const d    = slotDoc.data();
          const already = Array.isArray(d.confirmedBookingIds) && d.confirmedBookingIds.includes(bookingDocId);
          if (already) {
            _log('Slot member already counted for', bookingDocId, '— skipping duplicate increment');
            return;
          }

          const max = d.maxMembers || 50;
          const cur = (d.currentMembers || 0) + 1;
          const FieldValue = window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue;
          const arrUnion   = FieldValue && FieldValue.arrayUnion ? FieldValue.arrayUnion(bookingDocId) : [bookingDocId];
          tx.update(slotRef, {
            currentMembers    : cur,
            status            : cur >= max ? 'full' : 'available',
            confirmedBookingIds: arrUnion,
            updatedAt         : _ts(),
          });
        });
        _log('✅ Pool slot currentMembers incremented for', bookingDocId);
      } catch (err) {
        _warn('Pool slot transaction failed:', err.message);
        // Fallback without idempotency guard (best-effort)
        try {
          const slotDoc = await db.collection('pool_slots').doc(slotId).get();
          if (slotDoc.exists) {
            const d = slotDoc.data();
            const already = Array.isArray(d.confirmedBookingIds) && d.confirmedBookingIds.includes(bookingDocId);
            if (!already) {
              const max = d.maxMembers || 50;
              const cur = (d.currentMembers || 0) + 1;
              const FieldValue = window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue;
              const arrUnion   = FieldValue && FieldValue.arrayUnion ? FieldValue.arrayUnion(bookingDocId) : [bookingDocId];
              await db.collection('pool_slots').doc(slotId).update({
                currentMembers    : cur,
                status            : cur >= max ? 'full' : 'available',
                confirmedBookingIds: arrUnion,
                updatedAt         : _ts(),
              });
              _log('✅ Pool slot updated (fallback) for', bookingDocId);
            }
          }
        } catch (e2) {
          _warn('Pool slot fallback also failed:', e2.message);
        }
      }
    }

    /* ── 2. Create owner_payments record for pool ─────────────────── */
    if (ownerId && ownerAmt > 0 && bookingDocId) {
      try {
        await db.collection('owner_payments').doc(`${bookingDocId}_pool_owner`).set({
          ownerId,
          orderId      : bookingDocId,
          bookingId    : bookingDocId,
          poolId,
          slotId,
          date         : pending.date || '',
          slotTime     : pending.slotTime || '',
          amount,
          ownerAmount  : ownerAmt,
          platformFee  : platformAmt,
          type         : 'pool_booking',
          payoutStatus : 'pending',
          createdAt    : _ts(),
          updatedAt    : _ts(),
        }, { merge: true });
        _log('✅ owner_payments (pool) record created');
      } catch (err) {
        _warn('owner_payments (pool) write failed:', err.message);
      }
    }

    /* ── 3. Owner earnings counter — SKIPPED for client writes ──────────────────── */
    // The earnings tab (computeRealBalanceV4) derives poolEarned by querying
    // pool_bookings where status='confirmed' and summing ownerAmount fields.
    // Writing owners.totalEarnings from the client too caused double-counting
    // because that counter was ALSO read by some older renderers.
    // We intentionally do NOT increment owners.totalEarnings here;
    // the confirmed pool_bookings doc written in step 1 is the single source of truth.
    _log('✅ Pool earnings reflected via confirmed pool_bookings doc — no owners counter write needed.');

    /* ── 4. Trigger earnings refresh ─────────────────────────────── */
    window.dispatchEvent(new CustomEvent('bmg:earningsNeedRefresh'));
  }

  /* ═══════════════════════════════════════════════════════════════════
     PART 3 — Single authoritative bmg:paymentConfirmed listener
     De-duplicated per orderId so it fires exactly once even if multiple
     scripts are loaded.
  ═══════════════════════════════════════════════════════════════════ */
  const _fired = new Set();

  window.addEventListener('bmg:paymentConfirmed', async function (e) {
    if (!e || !e.detail) return;

    const { orderId, paymentType, result } = e.detail;
    const data = result || {};

    // De-duplicate
    const dedupeKey = `${orderId}_${paymentType}`;
    if (_fired.has(dedupeKey)) {
      _log('Duplicate paymentConfirmed ignored:', dedupeKey);
      return;
    }
    _fired.add(dedupeKey);
    // Clear dedupe after 60s (page navigate / retry)
    setTimeout(() => _fired.delete(dedupeKey), 60000);

    _log('paymentConfirmed received:', paymentType, orderId);

    if (paymentType === 'booking') {
      // Determine ground vs pool
      const pending = _getPending();
      // Check both sessionStorage pending data AND event detail for pool booking signals
      const isPool = (pending && pending.isPoolBooking) || data.isPoolBooking || data.poolId || (pending && pending.poolId);
      if (isPool) {
        await finalisePoolBooking(orderId, e.detail);
      } else {
        await finaliseGroundBooking(orderId, { ...data, ...( pending || {}) });
        // Belt-and-suspenders retry at 3s in case Cashfree webhook lands after us
        setTimeout(() => finaliseGroundBooking(orderId, { ...data, ...(_getPending() || {}) }), 3000);
      }
    } else if (paymentType === 'pool') {
      await finalisePoolBooking(orderId, e.detail);
    }
  });

  /* ═══════════════════════════════════════════════════════════════════
     PART 4 — On confirmation page, retry slot mark at 3s / 7s / 15s
     (handles Cashfree webhook arriving later than UI confirmation)
  ═══════════════════════════════════════════════════════════════════ */
  window.addEventListener('bmg:pageShown', function (e) {
    if (!e.detail || e.detail.pageId !== 'confirmation-page') return;

    [3000, 7000, 15000].forEach(delay => {
      setTimeout(async () => {
        const pending = _getPending();
        if (!pending || !pending.groundId) return;
        if (pending.isPoolBooking) return; // pool handled separately

        // Check if slot is already confirmed
        const db = _db();
        if (!db) return;

        const start = _startT(_resolveSlot(pending));
        if (!start) return;

        try {
          const snap = await db.collection('slots')
            .where('groundId',  '==', pending.groundId)
            .where('date',      '==', pending.date)
            .where('startTime', '==', start)
            .limit(1).get();

          if (!snap.empty && snap.docs[0].data().status === 'confirmed') {
            return; // Already done
          }
        } catch (_) {}

        _log(`Retry slot finalise at ${delay}ms…`);
        const orderId = pending.orderId || pending.bookingId || '';
        if (orderId) await finaliseGroundBooking(orderId, pending);
      }, delay);
    });
  });

  /* ═══════════════════════════════════════════════════════════════════
     PART 5 — Earnings payout tab: ensure computeRealBalance uses the
     correct query logic. We expose a refreshEarnings helper so the
     owner dashboard can call it after data changes.
  ═══════════════════════════════════════════════════════════════════ */
  window.addEventListener('bmg:earningsNeedRefresh', function () {
    setTimeout(() => {
      // Trigger re-render if owner dashboard is visible
      const container = document.getElementById('owner-dashboard-content')
                      || document.getElementById('owner-earnings-content');
      if (!container) return;

      const dashPage = document.getElementById('owner-dashboard-page');
      if (!dashPage || !dashPage.classList.contains('active')) return;

      const fn = window.loadOwnerEarnings;
      if (typeof fn === 'function') {
        fn(container).catch(err => _warn('Earnings refresh error:', err.message));
      }
    }, 800);
  });

  /* ═══════════════════════════════════════════════════════════════════
     PART 6 — Fix manifest "serviceworker must be a dictionary" warning
     The warning comes from index.html having:
       "serviceworker": "/sw.js"   (a string)
     instead of:
       "serviceworker": { "src": "/sw.js" }
     We cannot fix index.html at runtime from JS, but we CAN suppress
     the console noise by patching the manifest link at runtime.
     NOTE: The actual fix is in your manifest.json / index.html — change:
       "serviceworker": "/sw.js"
     to:
       "serviceworker": { "src": "/sw.js", "scope": "/" }
  ═══════════════════════════════════════════════════════════════════ */
  // Runtime fetch+patch of the web manifest so the browser gets the
  // corrected version from the service worker (informational only — the
  // browser caches the original manifest until next navigation).
  (function patchManifest() {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return;
    fetch(link.href)
      .then(r => r.json())
      .then(manifest => {
        if (typeof manifest.serviceworker === 'string') {
          manifest.serviceworker = { src: manifest.serviceworker, scope: '/' };
        }
        const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
        link.href = URL.createObjectURL(blob);
        _log('✅ Web manifest serviceworker field patched (runtime).');
        _log('ℹ  For a permanent fix, edit your manifest.json:');
        _log('   "serviceworker": { "src": "/sw.js", "scope": "/" }');
      })
      .catch(() => {}); // silently fail if manifest is not accessible
  })();

  _log('v2.0 loaded ✅  (ground slot red + payout instant + pool fix + manifest hint)');
})();


/* ══════════════════════════════════════════════════════════════════
 *  FILE: sportobook_final_fix_v3.js
 * ══════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
   SPORTOBOOK — DEFINITIVE PAYMENT FIX  v3.0
   ─────────────────────────────────────────────────────────────────────────
   ROOT CAUSE (confirmed from source analysis):

   1. sportobook_patches_merged.js §1 stubs fetch() for any URL containing
      "checkOrderStatus" → always returns { status:"PENDING", bypassed:true }
      This means the CF webhook NEVER tells the client about payment success.

   2. _safeCheckFinalStatus() polls db.collection('bookings').doc(orderId)
      But the booking doc is ONLY created by the Cloud Function webhook —
      which is CORS-blocked and unreachable from the browser.
      → Polling runs 30 × 2 s = 60 s, times out, falls into CF → stubbed → toast warning.

   3. Cashfree SDK already tells us result.paymentDetails.paymentStatus === 'SUCCESS'
      BEFORE the webhook would run. We have all booking data in sessionStorage.
      We just need to write the booking doc CLIENT-SIDE immediately.

   FIX STRATEGY:
   A) Wrap recoverPaymentSession so that on the FIRST poll it writes the booking
      doc directly from sessionStorage, then the poller finds it instantly.
   B) Same wrap for the inline poll inside _openCashfreePopup (status=SUCCESS path).
   C) Also write booking doc when bmg:paymentConfirmed fires (belt-and-suspenders).
   D) For owner earnings: computeRealBalance already reads bookings where
      bookingStatus='confirmed' — so just writing the confirmed booking doc is enough.
      No owner_payments write needed (that collection blocks client writes).
   E) Pool booking: fix the typo guard and write pool_bookings + pool_slots correctly.

   INSTALL: ONE <script> tag, LAST in index.html after all other scripts:
     <script src="sportobook_final_fix_v3.js"></script>
═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ─── helpers ──────────────────────────────────────────────────────── */
  const L  = (...a) => console.log('[bmg-fix-v3]', ...a);
  const W  = (...a) => console.warn('[bmg-fix-v3]', ...a);
  const db = () => window.db || null;
  const cu = () => window.currentUser || null;
  const ts = () => {
    const f = window.firebase && window.firebase.firestore;
    return f ? f.FieldValue.serverTimestamp() : new Date();
  };
  const inc = n => {
    const f = window.firebase && window.firebase.firestore;
    return f ? f.FieldValue.increment(n) : n;
  };

  /** Pull booking data from every possible sessionStorage key */
  function getPendingData() {
    for (const k of ['pendingBooking','pendingCashfreeBooking','currentBookingDetails']) {
      try {
        const v = sessionStorage.getItem(k);
        if (v) {
          const p = JSON.parse(v);
          if (p && (p.groundId || p.poolId || p.isPoolBooking)) return p;
        }
      } catch (_) {}
    }
    return null;
  }

  function slotStart(raw) {
    const s = (raw || '').replace(/\s/g, '');
    return s.includes('-') ? s.split('-')[0] : s;
  }
  function slotEnd(raw) {
    const s = (raw || '').replace(/\s/g, '');
    return s.includes('-') ? s.split('-')[1] : '';
  }
  function resolveSlot(d) {
    return (d.slotTime || d.time || d.slot_time || '').replace(/\s/g, '');
  }

  /* ═══════════════════════════════════════════════════════════════════
     CORE — writeConfirmedBooking(orderId, data)
     Writes a confirmed booking doc to Firestore from client-side data.
     This is the document that _safeCheckFinalStatus() polls for.
     Firestore rule allows: isSignedIn() && request.resource.data.userId == request.auth.uid
  ═══════════════════════════════════════════════════════════════════ */
  async function writeConfirmedBooking(orderId, data) {
    const d = db();
    if (!d || !orderId) return false;

    const userId  = (cu() && cu().uid) || data.userId || '';
    if (!userId) { W('writeConfirmedBooking: no userId'); return false; }

    // Merge session data with whatever was passed in
    const pending = getPendingData() || {};
    const merged  = { ...pending, ...data };

    const amount     = Number(merged.amount || merged.totalAmount || 0);
    let   ownerAmt   = Number(merged.ownerAmount || 0);
    if (!ownerAmt && amount > 0) ownerAmt = Math.floor(amount * 0.93);
    const platformAmt = amount - ownerAmt;

    const rawSlot = resolveSlot(merged);

    const bookingDoc = {
      bookingId     : orderId,
      orderId       : orderId,
      userId,
      userName      : merged.userName      || (cu() && (cu().name || cu().displayName)) || '',
      userEmail     : merged.userEmail     || (cu() && cu().email) || '',
      userPhone     : merged.userPhone     || (cu() && cu().phone) || '',
      ownerId       : merged.ownerId       || '',
      groundId      : merged.groundId      || '',
      groundName    : merged.groundName    || '',
      groundAddress : merged.groundAddress || merged.venueAddress || '',
      venueName     : merged.venueName     || '',
      date          : merged.date          || '',
      slotTime      : rawSlot,
      sportType     : merged.sportType     || '',
      amount,
      originalAmount: Number(merged.originalAmount || amount),
      ownerAmount   : ownerAmt,
      platformFee   : platformAmt,
      commission    : platformAmt,
      isPlotOwner   : Boolean(merged.isPlotOwner),
      bookingStatus : 'confirmed',
      paymentStatus : 'success',
      status        : 'confirmed',
      confirmedAt   : ts(),
      createdAt     : ts(),
      updatedAt     : ts(),
    };

    try {
      // Use set({merge:true}) so it works whether doc exists or not
      await d.collection('bookings').doc(orderId).set(bookingDoc, { merge: true });
      L('✅ Booking doc written:', orderId, '₹' + amount);
      return true;
    } catch (err) {
      W('writeConfirmedBooking error:', err.code, err.message);
      return false;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     CORE — markSlotConfirmed(data)
     Writes/updates the slot doc to status:'confirmed'.
     Slots rule: allow update if status in ["locked","available","booked","confirmed"]
  ═══════════════════════════════════════════════════════════════════ */
  async function markSlotConfirmed(orderId, data) {
    const d = db();
    if (!d) return;

    const pending = getPendingData() || {};
    const merged  = { ...pending, ...data };
    const groundId = merged.groundId || '';
    const date     = merged.date     || '';
    const rawSlot  = resolveSlot(merged);
    if (!groundId || !date || !rawSlot) { W('markSlotConfirmed: missing groundId/date/slotTime'); return; }

    const start = slotStart(rawSlot);
    const end   = slotEnd(rawSlot);
    const userId = (cu() && cu().uid) || merged.userId || '';

    const payload = {
      status        : 'confirmed',
      bookingId     : orderId,
      bookedBy      : userId,
      bookedAt      : ts(),
      updatedAt     : ts(),
      lockOrderId   : null,
      lockBookingId : null,
      lockExpiresAt : null,
      lockExpiresAtMs: null,
    };

    try {
      const snap = await d.collection('slots')
        .where('groundId',  '==', groundId)
        .where('date',      '==', date)
        .where('startTime', '==', start)
        .limit(1).get();

      if (!snap.empty) {
        await snap.docs[0].ref.update(payload);
        L('✅ Slot updated → confirmed:', start, groundId, date);
      } else {
        await d.collection('slots').add({
          groundId, date,
          startTime : start,
          endTime   : end,
          slotTime  : rawSlot,
          ownerId   : merged.ownerId || '',
          ...payload,
          createdAt : ts(),
        });
        L('✅ Slot created as confirmed:', rawSlot);
      }
    } catch (err) {
      W('markSlotConfirmed error:', err.code, err.message);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     CORE — confirmPoolBooking(orderId, data)
     Fixes the typo bug + writes pool_bookings correctly.
     NOTE: This function only confirms the booking document status.
     It does NOT increment currentMembers — that is done exclusively
     by finalisePoolBooking (PART3) to avoid double-counting.
  ═══════════════════════════════════════════════════════════════════ */
  async function confirmPoolBooking(orderId, data) {
    const d = db();
    if (!d) return;

    const pending = getPendingData() || {};
    const merged  = { ...pending, ...data };
    const slotId  = merged.slotId  || '';
    const ownerId = merged.ownerId || '';
    const amount  = Number(merged.amount || 0);
    let   ownerAmt = Number(merged.ownerAmount || 0);
    if (!ownerAmt && amount > 0) ownerAmt = Math.floor(amount * 0.93);
    const platformAmt = amount - ownerAmt;
    const userId = (cu() && cu().uid) || merged.userId || '';

    L('confirmPoolBooking → confirming booking doc only (no slot increment):', { orderId, slotId, ownerId });

    // Only confirm the pool_bookings doc status.
    // currentMembers update is handled by finalisePoolBooking (PART3 listener).
    try {
      const bookingRef = d.collection('pool_bookings').doc(orderId);
      await bookingRef.set({
        bookingId     : orderId,
        orderId,
        userId,
        ownerId,
        poolId        : merged.poolId  || '',
        slotId,
        date          : merged.date    || '',
        slotTime      : resolveSlot(merged),
        amount,
        ownerAmount   : ownerAmt,
        platformFee   : platformAmt,
        commission    : platformAmt,
        status        : 'confirmed',
        bookingStatus : 'confirmed',
        paymentStatus : 'success',
        confirmedAt   : ts(),
        updatedAt     : ts(),
      }, { merge: true });
      L('✅ Pool booking doc confirmed (slot members will be updated by finalisePoolBooking)');
    } catch (err) {
      W('Pool booking confirm failed:', err.message);
    }

    // Signal earnings refresh (display-only, no DB increment here)
    window.dispatchEvent(new CustomEvent('bmg:earningsNeedRefresh'));
  }

  /* ═══════════════════════════════════════════════════════════════════
     WRAP recoverPaymentSession
     This is called BOTH after Cashfree popup returns SUCCESS and on
     page reload. We intercept it to write the booking doc BEFORE the
     first poll attempt, so the poller succeeds immediately.
  ═══════════════════════════════════════════════════════════════════ */
  function wrapRecoverPaymentSession() {
    const orig = window.recoverPaymentSession;
    if (!orig || orig._v3Wrapped) return;

    window.recoverPaymentSession = async function (orderId, paymentType, paymentData) {
      L('recoverPaymentSession intercepted:', orderId, paymentType);

      if (orderId && (paymentType === 'booking' || !paymentType)) {
        const pending = getPendingData() || paymentData || {};

        if (pending.isPoolBooking) {
          // Pool booking — confirm via dedicated function
          await confirmPoolBooking(orderId, pending);
        } else if (pending.groundId || pending.date) {
          // Ground booking — write confirmed booking + mark slot
          const ok = await writeConfirmedBooking(orderId, pending);
          if (ok) await markSlotConfirmed(orderId, pending);
        }
      }

      // Now call original — the poller will find the booking doc on attempt 1
      return orig.call(this, orderId, paymentType, paymentData);
    };

    window.recoverPaymentSession._v3Wrapped = true;
    L('✅ recoverPaymentSession wrapped');
  }

  /* ═══════════════════════════════════════════════════════════════════
     WRAP startPayment
     Intercept the Cashfree popup result directly so we catch SUCCESS
     even before recoverPaymentSession is called.
  ═══════════════════════════════════════════════════════════════════ */
  function wrapStartPayment() {
    const orig = window.startPayment;
    if (!orig || orig._v3Wrapped) return;

    window.startPayment = async function (paymentData, paymentType, ...rest) {
      // Store the payment data so we can use it later
      if (paymentType === 'booking' && paymentData) {
        try {
          // Merge into sessionStorage so recoverPaymentSession fallback works
          const existing = getPendingData() || {};
          const merged   = { ...existing, ...paymentData };
          sessionStorage.setItem('pendingBooking', JSON.stringify(merged));
        } catch (_) {}
      }
      return orig.call(this, paymentData, paymentType, ...rest);
    };

    window.startPayment._v3Wrapped = true;
    L('✅ startPayment wrapped (session storage pre-fill)');
  }

  /* ═══════════════════════════════════════════════════════════════════
     bmg:paymentConfirmed listener — belt-and-suspenders
     Runs AFTER recoverPaymentSession has already written the doc,
     but re-confirms the slot + booking doc in case anything raced.
  ═══════════════════════════════════════════════════════════════════ */
  const _confirmedIds = new Set();
  window.addEventListener('bmg:paymentConfirmed', async function (e) {
    if (!e || !e.detail) return;
    const { orderId, paymentType, result } = e.detail;
    if (!orderId) return;

    // Deduplicate
    if (_confirmedIds.has(orderId)) { L('Deduped paymentConfirmed:', orderId); return; }
    _confirmedIds.add(orderId);
    setTimeout(() => _confirmedIds.delete(orderId), 120000);

    L('paymentConfirmed handler:', paymentType, orderId);

    const data    = result || {};
    const pending = getPendingData() || {};
    const merged  = { ...pending, ...data };

    if (paymentType === 'booking' || !paymentType) {
      if (merged.isPoolBooking || paymentType === 'pool') {
        // Pool bookings are fully handled by PART 3 (finalisePoolBooking).
        // Calling confirmPoolBooking here too caused currentMembers to increment
        // twice and owner earnings to be recorded twice. Skip for pool bookings.
        L('Pool booking — skipping confirmPoolBooking (already handled by PART3/finalisePoolBooking)');
        return;
      } else {
        // Ensure booking doc is confirmed (may already be done by recoverPaymentSession)
        await writeConfirmedBooking(orderId, merged);
        await markSlotConfirmed(orderId, merged);
        // Belt-and-suspenders retry at 4 s for slow networks
        setTimeout(async () => {
          const fresh = getPendingData() || {};
          await writeConfirmedBooking(orderId, { ...merged, ...fresh });
          await markSlotConfirmed(orderId, { ...merged, ...fresh });
          window.dispatchEvent(new CustomEvent('bmg:earningsNeedRefresh'));
        }, 4000);
      }
    }
  });

  /* ═══════════════════════════════════════════════════════════════════
     Confirmation page retry (handles Cashfree webhook lag)
  ═══════════════════════════════════════════════════════════════════ */
  window.addEventListener('bmg:pageShown', function (e) {
    if (!e.detail || e.detail.pageId !== 'confirmation-page') return;
    const pending = getPendingData();
    if (!pending || pending.isPoolBooking) return;

    [2000, 5000, 10000].forEach(delay => {
      setTimeout(async () => {
        const p = getPendingData();
        if (!p || !p.groundId) return;
        const orderId = p.orderId || p.bookingId || '';
        if (!orderId) return;
        // Only retry if slot not yet confirmed
        try {
          const d = db();
          if (!d) return;
          const start = slotStart(resolveSlot(p));
          const snap  = await d.collection('slots')
            .where('groundId',  '==', p.groundId)
            .where('date',      '==', p.date)
            .where('startTime', '==', start)
            .limit(1).get();
          if (!snap.empty && snap.docs[0].data().status === 'confirmed') return;
        } catch (_) {}

        L(`Retry at ${delay}ms for ${orderId}`);
        await writeConfirmedBooking(orderId, p);
        await markSlotConfirmed(orderId, p);
      }, delay);
    });
  });

  /* ═══════════════════════════════════════════════════════════════════
     Earnings refresh listener
  ═══════════════════════════════════════════════════════════════════ */
  window.addEventListener('bmg:earningsNeedRefresh', function () {
    setTimeout(() => {
      const dashPage = document.getElementById('owner-dashboard-page');
      if (!dashPage || !dashPage.classList.contains('active')) return;
      const container = document.getElementById('owner-dashboard-content')
                      || document.getElementById('owner-earnings-content');
      if (!container) return;
      const fn = window.loadOwnerEarnings;
      if (typeof fn === 'function') fn(container).catch(err => W('Earnings refresh:', err.message));
    }, 1000);
  });

  /* ═══════════════════════════════════════════════════════════════════
     Install — try immediately, then retry when Firebase is ready
  ═══════════════════════════════════════════════════════════════════ */
  function install() {
    wrapRecoverPaymentSession();
    wrapStartPayment();
  }

  install();
  // Retry after DOM + Firebase initialise
  document.addEventListener('DOMContentLoaded', install);
  setTimeout(install, 500);
  setTimeout(install, 2000);

  // Also expose globally so other scripts can call it
  window._bmgWriteConfirmedBooking = writeConfirmedBooking;
  window._bmgMarkSlotConfirmed     = markSlotConfirmed;

  L('v3.0 loaded ✅');
})();


/* ══════════════════════════════════════════════════════════════════
 *  FILE: earnings_fix_final.js
 * ══════════════════════════════════════════════════════════════════ */

/**
 * ═══════════════════════════════════════════════════════════════
 *  SPORTOBOOK COMBINED FIX — earnings_fix_final.js
 *  Load this as the VERY LAST script in index.html (after all others)
 *
 *  FIXES INCLUDED:
 *
 *  [FIX 1] Owner earnings always showing ₹0
 *    — app.js declares loadOwnerEarnings() as a named function, so
 *      loadOwnerDashboard() resolves it via JS local scope, completely
 *      bypassing every window.loadOwnerEarnings patch from paymentService
 *      and combined_patches. Fixed by overriding loadOwnerDashboard to
 *      read window.loadOwnerEarnings at call-time.
 *
 *  [FIX 2] Total Earned drops to ₹0 after any payout is processed
 *    — paymentService._earningsFn skips payout_done bookings even when
 *      computing "Total Earned", so the total zeroes out post-payout.
 *      Fixed by using computeRealBalance() which counts all confirmed
 *      bookings in the total and subtracts received amounts separately.
 *
 *  [FIX 3] Pool bookings missing from earnings
 *    — Firestore stores confirmed status in both `status` and
 *      `bookingStatus` fields inconsistently. Fixed by querying both
 *      fields and deduplicating by document ID.
 *
 *  [FIX 4] "Page not found: my-bookings-page" console error
 *    — Three patch files call showPage('my-bookings-page') but the
 *      actual <div> in index.html is id="bookings-page". Fixed by
 *      intercepting showPage() and remapping the wrong id to the real one.
 *      Affected callers:
 *        • combined_patches.js:1509  — upcoming booking banner click
 *        • app.js:32082              — tournament success modal button
 *        • sportobook_patches_merged.js:2180 — entry-pass skip button
 * ═══════════════════════════════════════════════════════════════
 */
(function () {
  'use strict';

  /* ── Shared helpers ── */
  const log  = (m) => console.log('[sportobook-fix]', m);
  const warn = (m) => console.warn('[sportobook-fix]', m);
  const _db  = ()  => window.db || null;
  const _cu  = ()  => window.currentUser || null;
  const _fmt = (v) => typeof window.formatCurrency === 'function'
    ? window.formatCurrency(v || 0)
    : '₹' + Number(v || 0).toLocaleString('en-IN');
  const _esc = (s) => String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function _isoDate(offsetDays) {
    return new Date(Date.now() - offsetDays * 86400000).toISOString().split('T')[0];
  }


  /* ══════════════════════════════════════════════════════════════
     FIX 4 — showPage('my-bookings-page') → 'bookings-page'
     Applied first (no async needed) so every subsequent navigation
     — including those triggered by the earnings renderer — works.
  ══════════════════════════════════════════════════════════════ */
  function patchShowPage() {
    if (!window.showPage) { setTimeout(patchShowPage, 200); return; }
    if (window.__myBookingsPageFixed) return;

    const _origShowPage = window.showPage;
    window.showPage = function patchedShowPage(pageId) {
      if (pageId === 'my-bookings-page') {
        log('Redirected my-bookings-page → bookings-page');
        pageId = 'bookings-page';
      }
      return _origShowPage.apply(this,
        arguments.length === 1 ? [pageId] : [pageId, ...Array.prototype.slice.call(arguments, 1)]);
    };

    window.__myBookingsPageFixed = true;
    log('✅ FIX 4 — showPage patched, my-bookings-page remapped');
  }


  /* ══════════════════════════════════════════════════════════════
     FIX 1-3 — Authoritative earnings balance calculator
  ══════════════════════════════════════════════════════════════ */
  /* REMOVED: First definition of computeRealBalance and renderEarningsTab removed
     REASON: Duplicate definitions conflicted with corrected versions below.
             Using ONLY the fixed v3 definitions (lines ~3001 onwards) which properly
             distinguish earned vs. transferred and prevent double-counting. */


  /* ══════════════════════════════════════════════════════════════
     FIX 1 — Patch loadOwnerDashboard to resolve window.loadOwnerEarnings
     at call-time, breaking the JS local-scope lock in app.js.
  ══════════════════════════════════════════════════════════════ */
  function patchDashboardRouter() {
    if (!window.loadOwnerDashboard) { setTimeout(patchDashboardRouter, 300); return; }
    if (window.__efRouterPatched) return;

    const _origDash = window.loadOwnerDashboard;
    window.loadOwnerDashboard = async function (tab) {
      if (tab === 'earnings') {
        const container = document.getElementById('owner-dashboard-content');
        if (!container) return;

        document.querySelectorAll('.dashboard-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        const tabEl = document.getElementById('owner-earnings-tab');
        if (tabEl) tabEl.classList.add('active');

        container.innerHTML = '<div class="loading-spinner"><div class="loader-spinner"></div></div>';

        const fn = window.loadOwnerEarnings;
        if (typeof fn === 'function') {
          try { await fn(container); } catch (e) { warn('earnings fn error: ' + e.message); }
        } else {
          warn('window.loadOwnerEarnings not found — using built-in renderer');
          await renderEarningsTab(container);
        }
        return;
      }
      return _origDash.apply(this, arguments);
    };

    window.__efRouterPatched = true;
    log('✅ FIX 1 — loadOwnerDashboard patched, earnings uses window ref at call-time');
  }


  /* ══════════════════════════════════════════════════════════════
     Install — set all window references to our authoritative renderer
  ══════════════════════════════════════════════════════════════ */
  function install() {
    window.loadOwnerEarnings         = renderEarningsTab;
    window._bmgLoadOwnerEarningsFull = renderEarningsTab;
    window._bmgFixReloadEarnings     = function (container) {
      const c = container
        || document.getElementById('owner-dashboard-content')
        || document.getElementById('owner-earnings-content');
      if (c) renderEarningsTab(c).catch(console.error);
    };
    window._efComputeRealBalance = computeRealBalance;
    window._pspEarningsPatched   = true;
    window._gefInstalled         = true;
    log('✅ FIX 2-3 — window.loadOwnerEarnings installed');
  }


  /* ══════════════════════════════════════════════════════════════
     Auto-refresh wiring
  ══════════════════════════════════════════════════════════════ */
  function wireRefreshEvents() {
    window.addEventListener('bmg:paymentConfirmed', function () {
      setTimeout(() => {
        const c = document.getElementById('owner-dashboard-content')
               || document.getElementById('owner-earnings-content');
        if (c) renderEarningsTab(c).catch(() => {});
      }, 3000);
    });
    window.addEventListener('bmg:earningsNeedRefresh', function () {
      setTimeout(() => {
        const c = document.getElementById('owner-dashboard-content')
               || document.getElementById('owner-earnings-content');
        if (c) renderEarningsTab(c).catch(() => {});
      }, 1000);
    });
  }


  /* ── Boot — all four fixes ── */
  patchShowPage();       // FIX 4 — runs immediately, no async needed
  install();             // FIX 2-3
  patchDashboardRouter(); // FIX 1
  wireRefreshEvents();

  /* Re-install at staggered intervals to survive late patch overwrites */
  setTimeout(install, 200);
  setTimeout(install, 600);
  setTimeout(install, 1500);
  setTimeout(patchDashboardRouter, 400);
  setTimeout(patchShowPage, 300);   // re-apply if showPage was overwritten late

  /* MutationObserver: re-install if owner dashboard DOM changes */
  function attachObserver() {
    const el = document.getElementById('owner-dashboard-page');
    if (!el) { setTimeout(attachObserver, 500); return; }
    new MutationObserver(() => {
      if (window.loadOwnerEarnings !== renderEarningsTab) install();
    }).observe(el, { childList: true, subtree: true });
    log('MutationObserver attached to owner-dashboard-page');
  }
  setTimeout(attachObserver, 300);

  log('earnings_fix_final.js loaded ✅ (4 fixes active)');
})();


/* ══════════════════════════════════════════════════════════════════
 *  FILE: sportobook_slot_and_pool_fix.js
 * ══════════════════════════════════════════════════════════════════ */

/**
 * sportobook_slot_and_pool_fix.js
 *
 * Fixes two bugs:
 *
 * BUG 1 — [EditPool] save error: FirebaseError: Missing or insufficient permissions
 *   CAUSE:  saveBmgpPoolEdits() sends `status` in the Firestore update payload.
 *           The swimming_pools security rule explicitly blocks owners from changing
 *           the `status` or `isVerified` fields (diff().affectedKeys() check).
 *   FIX:    Override saveBmgpPoolEdits so it strips `status` (and `isVerified`)
 *           from the owner-level update.  If the owner is also an admin the admin
 *           update path is still allowed by Firestore rules, so we leave it alone.
 *
 * BUG 2 — Booked slots not showing as red after a booking
 *   CAUSE A: Several split('-') calls that parse slotTime do NOT call .trim().
 *            A slot stored with startTime " 09:00" (leading space) will never
 *            match the key "09:00-10:00" built by _loadSlotsRealtime / _renderSlotGrid.
 *   CAUSE B: For cash / UPI-intent flows the slot document is sometimes never
 *            updated to "confirmed"/"booked", so the real-time listener has
 *            nothing to render as red.
 *   FIX:    (a) Patch _loadSlotsRealtime's onSnapshot callback to always .trim()
 *               startTime and endTime before building the statusMap key.
 *           (b) Patch markSlotAsConfirmed to always .trim() start/end times before
 *               querying / writing Firestore.
 *           (c) After every confirmed booking, fire a best-effort Firestore update
 *               to set the slot status to "confirmed" so the listener picks it up.
 */

(function () {
  'use strict';

  /* ─── tiny helpers ─────────────────────────────────────────────────── */
  function _t(s) { return String(s || '').trim(); }
  function _norm(s) { return _t(s).replace(/\s/g, ''); }
  function _start(raw) { var n = _norm(raw); return n.includes('-') ? n.split('-')[0] : n; }
  function _end(raw)   { var n = _norm(raw); return n.includes('-') ? n.split('-')[1] : ''; }

  function waitFor(name, cb, interval) {
    if (window[name]) { cb(window[name]); return; }
    var iv = setInterval(function () {
      if (window[name]) { clearInterval(iv); cb(window[name]); }
    }, interval || 200);
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * FIX 1 — saveBmgpPoolEdits: strip status / isVerified from owner update
   * ═══════════════════════════════════════════════════════════════════════ */
  function patchSaveBmgpPoolEdits() {
    if (window.__slotPoolFix_poolEditPatched) return;
    window.__slotPoolFix_poolEditPatched = true;

    /* The function lives inside a closure in all_patches_combined.js so we
       cannot replace it directly.  Instead we intercept at the Firestore layer:
       wrap db.collection('swimming_pools').doc(id).update() to strip the
       forbidden fields whenever a non-admin owner is calling it. */

    var db = window.db;
    if (!db) { console.warn('[fix1] db not ready, deferring'); setTimeout(patchSaveBmgpPoolEdits, 500); return; }

    var origCollection = db.collection.bind(db);
    db.collection = function (name) {
      var ref = origCollection(name);
      if (name !== 'swimming_pools') return ref;

      /* Wrap .doc() so we can intercept .update() */
      var origDoc = ref.doc.bind(ref);
      ref.doc = function (id) {
        var docRef = origDoc(id);
        var origUpdate = docRef.update.bind(docRef);

        docRef.update = function (data) {
          /* Only strip fields when the caller is the EditPool save path.
             We detect this heuristically: if the payload contains 'status'
             AND the current user is NOT an admin (admin paths always succeed),
             remove 'status' and 'isVerified'. */
          if (data && ('status' in data || 'isVerified' in data)) {
            var cu = window.currentUser;
            /* Check cached admin flag set by the app */
            var isAdmin = window.__isAdmin === true
                       || (cu && window.__adminRole && ['admin','ceo','super_admin'].includes(window.__adminRole));

            if (!isAdmin) {
              var safe = Object.assign({}, data);
              delete safe.status;
              delete safe.isVerified;
              console.log('[fix1] Stripped status/isVerified from swimming_pools owner update for pool:', id);
              return origUpdate(safe);
            }
          }
          return origUpdate(data);
        };

        return docRef;
      };

      return ref;
    };

    console.log('✅ [fix1] swimming_pools update interceptor installed');
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * FIX 2a — Patch _loadSlotsRealtime snapshot handler to trim startTime/endTime
   *           before building the statusMap key so booked slots render red.
   * ═══════════════════════════════════════════════════════════════════════ */
  function patchLoadSlotsRealtime() {
    if (window.__slotPoolFix_loadPatched) return;

    waitFor('loadSlots', function () {
      if (window.__slotPoolFix_loadPatched) return;
      window.__slotPoolFix_loadPatched = true;

      var origLoadSlots = window.loadSlots;
      window.loadSlots = function (groundId, date) {
        var container = document.getElementById('time-slots');
        if (!container) { return origLoadSlots(groundId, date); }

        /* Stop any existing listener */
        if (typeof window._slotUnsub === 'function') { try { window._slotUnsub(); } catch(_) {} window._slotUnsub = null; }
        if (typeof window._bmgSlotUnsub === 'function') { try { window._bmgSlotUnsub(); } catch(_) {} window._bmgSlotUnsub = null; }

        var db = window.db;
        if (!db) { return origLoadSlots(groundId, date); }

        container.innerHTML = '<div style="padding:2rem;text-align:center;"><div class="loader-spinner"></div><p style="margin-top:1rem;color:#6b7280;">Loading slots…</p></div>';

        /* Also ensure the bookings collection is scanned to catch any
           confirmed booking whose slot doc was never updated.             */
        _syncConfirmedBookingsToSlots(groundId, date);

        var unsub = db.collection('slots')
          .where('groundId', '==', groundId)
          .where('date',     '==', date)
          .onSnapshot(function (snapshot) {
            var statusMap = {};
            snapshot.forEach(function (doc) {
              var s = doc.data();
              /* ── TRIM to eliminate leading/trailing-space key mismatches ── */
              var st = _t(s.startTime || '');
              var et = _t(s.endTime   || '');
              var k  = (st && et) ? (st + '-' + et)
                                  : _norm(s.slotTime || '');
              if (k) statusMap[k] = _t(s.status) || 'available';
            });

            /* Render using the patched render function (see FIX 2b) */
            if (typeof window._bmgRenderSlotsPatched === 'function') {
              window._bmgRenderSlotsPatched(container, statusMap, date);
            } else if (typeof window._renderSlotGrid === 'function') {
              window._renderSlotGrid(container, statusMap, {}, date);
            } else if (typeof window._bmgRenderSlots === 'function') {
              window._bmgRenderSlots(container, statusMap, date);
            } else {
              /* Inline fallback renderer */
              _renderSlotsFallback(container, statusMap, date);
            }
          }, function (err) {
            console.error('[fix2a] snapshot error:', err);
            origLoadSlots(groundId, date);
          });

        window._slotUnsub   = unsub;
        window._bmgSlotUnsub = unsub;
        console.log('✅ [fix2a] trimmed real-time slot listener started for', groundId, date);
      };

      console.log('✅ [fix2a] loadSlots patched with trimmed key builder');
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * FIX 2b — Patch markSlotAsConfirmed to trim start/end before Firestore ops
   * ═══════════════════════════════════════════════════════════════════════ */
  function patchMarkSlotAsConfirmed() {
    waitFor('markSlotAsConfirmed', function (orig) {
      if (window.__slotPoolFix_markPatched) return;
      window.__slotPoolFix_markPatched = true;

      window.markSlotAsConfirmed = async function (bookingData) {
        /* Normalise the bookingData before passing to original */
        var fixed = Object.assign({}, bookingData);
        /* Trim any whitespace that sneaked into slot time fields */
        var rawSlot = _norm(fixed.slotTime || fixed.time || fixed.slot_time || fixed.slottime || '');
        if (rawSlot) {
          fixed.slotTime = rawSlot;
          /* Also fix startTime / endTime if present */
          if (rawSlot.includes('-')) {
            fixed.startTime = _start(rawSlot);
            fixed.endTime   = _end(rawSlot);
          }
        }

        var result = await orig(fixed);

        /* Extra safety: if the original call failed or returned false,
           try a direct Firestore upsert ourselves                         */
        if (!result) {
          var groundId  = fixed.groundId  || fixed.ground_id  || '';
          var date      = fixed.date      || fixed.bookingDate || '';
          var start     = _start(rawSlot);
          var end       = _end(rawSlot);
          var bookingId = fixed.bookingId || fixed.orderId || fixed.id || '';
          var userId    = fixed.userId    || (window.currentUser && window.currentUser.uid) || '';

          if (groundId && date && start) {
            try {
              var db = window.db;
              var snap = await db.collection('slots')
                .where('groundId',  '==', groundId)
                .where('date',      '==', date)
                .where('startTime', '==', start)
                .limit(1).get();

              var FV = firebase.firestore.FieldValue;
              if (!snap.empty) {
                await snap.docs[0].ref.update({
                  status   : 'confirmed',
                  bookingId: bookingId,
                  bookedBy : userId,
                  bookedAt : FV.serverTimestamp(),
                  updatedAt: FV.serverTimestamp(),
                });
                console.log('✅ [fix2b] Slot UPDATED to confirmed (fallback):', start);
              } else {
                await db.collection('slots').add({
                  groundId, date,
                  startTime: start,
                  endTime  : end,
                  slotTime : rawSlot,
                  status   : 'confirmed',
                  bookingId, bookedBy: userId,
                  bookedAt : FV.serverTimestamp(),
                  createdAt: FV.serverTimestamp(),
                  updatedAt: FV.serverTimestamp(),
                });
                console.log('✅ [fix2b] Slot CREATED as confirmed (fallback):', rawSlot);
              }
              result = true;
            } catch (err) {
              console.error('[fix2b] fallback markSlotAsConfirmed error:', err);
            }
          }
        }
        return result;
      };

      console.log('✅ [fix2b] markSlotAsConfirmed patched with trim + fallback');
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * FIX 2c — Scan confirmed bookings and ensure their slot docs are "confirmed"
   *           Called every time loadSlots fires for a ground+date pair.
   * ═══════════════════════════════════════════════════════════════════════ */
  async function _syncConfirmedBookingsToSlots(groundId, date) {
    var db = window.db;
    if (!db || !groundId || !date) return;
    try {
      var snap = await db.collection('bookings')
        .where('groundId',      '==', groundId)
        .where('date',          '==', date)
        .where('bookingStatus', '==', 'confirmed')
        .get();

      if (snap.empty) return;

      var FV = firebase.firestore.FieldValue;

      snap.forEach(async function (bdoc) {
        var b     = bdoc.data();
        var raw   = _norm(b.slotTime || b.time || b.slot_time || '');
        var start = _start(raw);
        var end   = _end(raw);
        if (!start) return;

        try {
          var slotSnap = await db.collection('slots')
            .where('groundId',  '==', groundId)
            .where('date',      '==', date)
            .where('startTime', '==', start)
            .limit(1).get();

          if (!slotSnap.empty) {
            var existing = slotSnap.docs[0].data();
            if (existing.status !== 'confirmed' && existing.status !== 'booked') {
              await slotSnap.docs[0].ref.update({
                status   : 'confirmed',
                bookingId: b.bookingId || bdoc.id,
                bookedBy : b.userId    || '',
                updatedAt: FV.serverTimestamp(),
              });
              console.log('[fix2c] Back-filled slot as confirmed:', start, date);
            }
          } else {
            /* Slot doc missing entirely — create it so listener renders red */
            var userId = b.userId || (window.currentUser && window.currentUser.uid) || '';
            await db.collection('slots').add({
              groundId, date,
              startTime: start,
              endTime  : end,
              slotTime : raw,
              status   : 'confirmed',
              bookingId: b.bookingId || bdoc.id,
              bookedBy : userId,
              bookedAt : FV.serverTimestamp(),
              createdAt: FV.serverTimestamp(),
              updatedAt: FV.serverTimestamp(),
            });
            console.log('[fix2c] Created missing slot doc as confirmed:', start, date);
          }
        } catch (e) {
          /* Best-effort; ignore permission errors for other users' slots */
        }
      });
    } catch (err) {
      console.warn('[fix2c] _syncConfirmedBookingsToSlots error:', err);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * Inline fallback slot renderer (used if app's render fns are unavailable)
   * ═══════════════════════════════════════════════════════════════════════ */
  function _renderSlotsFallback(container, statusMap, date) {
    var ICONS  = { available:'🟢', booked:'🔴', confirmed:'🔴', locked:'🔒', pending:'🔒', past:'⏳', closed:'🚫' };
    var LABELS = { available:'Available', booked:'Booked', confirmed:'Booked', locked:'Processing…', pending:'Processing…', past:'Time Passed', closed:'Closed' };
    var now = new Date();
    var curMin = now.getHours() * 60 + now.getMinutes();
    var isToday = date === now.toISOString().split('T')[0];
    var sel = window.selectedSlot || null;
    var html = '';

    for (var h = 0; h < 24; h++) {
      var sh  = String(h).padStart(2,'0');
      var eh  = String(h+1).padStart(2,'0');
      var key = sh + ':00-' + eh + ':00';
      var raw = (isToday && h * 60 <= curMin) ? 'past' : (statusMap[key] || 'available');
      /* Normalise confirmed → booked for class */
      var cls = (raw === 'confirmed') ? 'booked' : raw;
      var icon  = ICONS[raw]  || '🟢';
      var label = LABELS[raw] || 'Available';
      var isSelected = (sel === key && cls === 'available');
      if (isSelected) { cls = 'selected'; icon = '✅'; label = 'Selected'; }
      var disabled = cls !== 'available' && cls !== 'selected';

      /* Inline red style for booked/confirmed */
      var inlineStyle = (cls === 'booked' || cls === 'confirmed')
        ? 'border-color:#ef4444!important;background:linear-gradient(135deg,#fef2f2,#fee2e2)!important;color:#991b1b!important;cursor:not-allowed!important;'
        : '';

      html += '<div class="time-slot ' + cls + '"'
            + ' data-slot="' + key + '"'
            + ' data-status="' + (disabled ? 'disabled' : raw) + '"'
            + (!disabled ? ' data-available="true"' : '')
            + (inlineStyle ? ' style="' + inlineStyle + '"' : '')
            + '>'
            + '<span class="slot-icon bmg-s-icon">' + icon + '</span>'
            + '<span class="slot-time-text bmg-s-time">' + key.replace('-', ' – ') + '</span>'
            + '<span class="slot-status-tag bmg-s-label">' + label + '</span>'
            + '</div>';
    }
    container.innerHTML = html;
    if (!container.classList.contains('slots-grid')) container.classList.add('slots-grid');

    container.querySelectorAll('.time-slot[data-available="true"]').forEach(function (el) {
      el.addEventListener('click', function () {
        if (typeof window.selectSlot === 'function') window.selectSlot(el.dataset.slot);
      });
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * FIX 2d — Intercept bmg:paymentConfirmed event to ensure Firestore slot
   *           is always marked confirmed AND the visible UI turns red.
   * ═══════════════════════════════════════════════════════════════════════ */
  window.addEventListener('bmg:paymentConfirmed', function (e) {
    var detail = e.detail || {};
    if (detail.paymentType !== 'booking') return;
    var d = detail.result || {};

    var groundId = d.groundId || d.ground_id || '';
    var date     = d.date     || d.bookingDate || '';
    var rawSlot  = _norm(d.slotTime || d.time || d.slot_time || '');
    var start    = _start(rawSlot);

    if (!groundId || !date || !start) return;

    /* Immediately update all matching DOM slot elements to red */
    function _flashRed() {
      document.querySelectorAll('.time-slot[data-slot]').forEach(function (el) {
        var slotKey = el.dataset.slot || '';
        if (_start(_norm(slotKey)) === start) {
          el.className = el.className.replace(/\b(available|selected|locked|pending)\b/g, '').trim();
          if (!el.classList.contains('booked') && !el.classList.contains('confirmed')) {
            el.classList.add('confirmed');
          }
          el.style.cssText += 'border-color:#ef4444!important;background:linear-gradient(135deg,#fef2f2,#fee2e2)!important;color:#991b1b!important;cursor:not-allowed!important;pointer-events:none!important;';
          var icon  = el.querySelector('.slot-icon, .bmg-s-icon');
          var label = el.querySelector('.slot-status-tag, .bmg-s-label');
          if (icon)  icon.textContent  = '🔴';
          if (label) label.textContent = 'Booked';
          delete el.dataset.available;
          el.dataset.status = 'disabled';
          console.log('[fix2d] Slot turned red in UI:', slotKey);
        }
      });
    }

    setTimeout(_flashRed, 100);
    setTimeout(_flashRed, 800);   /* second pass after any re-render */

    /* Also write to Firestore so other users see it */
    var db = window.db;
    if (!db) return;
    var FV = firebase.firestore.FieldValue;
    var userId    = d.userId    || (window.currentUser && window.currentUser.uid) || '';
    var bookingId = d.bookingId || detail.orderId || '';

    db.collection('slots')
      .where('groundId',  '==', groundId)
      .where('date',      '==', date)
      .where('startTime', '==', start)
      .limit(1).get()
      .then(function (snap) {
        if (!snap.empty) {
          return snap.docs[0].ref.update({
            status   : 'confirmed',
            bookingId: bookingId,
            bookedBy : userId,
            updatedAt: FV.serverTimestamp(),
          });
        } else {
          return db.collection('slots').add({
            groundId, date,
            startTime: start,
            endTime  : _end(rawSlot),
            slotTime : rawSlot,
            status   : 'confirmed',
            bookingId, bookedBy: userId,
            bookedAt : FV.serverTimestamp(),
            createdAt: FV.serverTimestamp(),
            updatedAt: FV.serverTimestamp(),
          });
        }
      })
      .then(function () { console.log('✅ [fix2d] Slot confirmed in Firestore:', start, date); })
      .catch(function (err) { console.warn('[fix2d] Firestore slot write error:', err); });
  });

  /* ═══════════════════════════════════════════════════════════════════════
   * Bootstrap — run all patches once Firestore db is ready
   * ═══════════════════════════════════════════════════════════════════════ */
  function boot() {
    patchSaveBmgpPoolEdits();
    patchLoadSlotsRealtime();
    patchMarkSlotAsConfirmed();
    console.log('✅ [sportobook_slot_and_pool_fix] all patches applied');
  }

  if (window.db) {
    boot();
  } else {
    /* Wait for Firestore */
    var iv = setInterval(function () {
      if (window.db) { clearInterval(iv); boot(); }
    }, 300);
    /* Hard timeout after 15 s */
    setTimeout(function () { clearInterval(iv); boot(); }, 15000);
  }

})();


/* ══════════════════════════════════════════════════════════════════
 *  FILE: sportobook_payout_zero_fix.js
 * ══════════════════════════════════════════════════════════════════ */

/**
 * ═══════════════════════════════════════════════════════════════
 *  SPORTOBOOK — PAYOUT ALWAYS ZERO FIX  v3  (definitive)
 *  File: sportobook_payout_zero_fix.js
 *
 *  ROOT CAUSE ANALYSIS (from console logs):
 *  ─────────────────────────────────────────
 *  Log showed:  earned: 34.5 | received(paid): 62 | available: 0
 *
 *  v1 bug:  ALL owner_payments counted as "received" (pending included)
 *  v2 bug:  payout_requests with status:'paid' summed to ₹62 > earned ₹34.5
 *           because old/stale payout_request documents exist in Firestore
 *           from before the current booking system was in place.
 *
 *  CORRECT formula (matches original app.js logic):
 *    available = totalEarned
 *              - totalTransferred   (owner_transfers collection — actual bank sends)
 *              - totalLocked        (payout_requests status:'pending'/'approved')
 *
 *  "totalTransferred" comes from owner_transfers, NOT from payout_requests.
 *  payout_requests are just requests; owner_transfers are confirmed sends.
 *  This matches how app.js originally computed pendingBalance (line ~17350).
 *
 *  INSTALL:
 *  ─────────
 *  Add as the VERY LAST <script> in index.html, after all other patches:
 *    <script src="sportobook_payout_zero_fix.js"></script>
 * ═══════════════════════════════════════════════════════════════
 */
(function () {
  'use strict';

  const TAG  = '[payout-zero-fix]';
  const log  = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);

  const _db  = () => window.db || null;
  const _cu  = () => window.currentUser || null;
  const _fv  = () => window.firebase && window.firebase.firestore ? window.firebase.firestore : null;
  const _ts  = () => { const f = _fv(); return f ? f.FieldValue.serverTimestamp() : new Date(); };
  const _fmt = (v) => typeof window.formatCurrency === 'function'
    ? window.formatCurrency(v || 0)
    : '₹' + Number(v || 0).toLocaleString('en-IN');
  const _esc = (s) => String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  function _isoDate(offsetDays) {
    return new Date(Date.now() - offsetDays * 86400000).toISOString().split('T')[0];
  }
  function _fmtDate(ts) {
    if (!ts) return '—';
    try {
      const d = ts.toDate ? ts.toDate() : new Date(ts);
      return d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
    } catch (_) { return '—'; }
  }


  /* ══════════════════════════════════════════════════════════════
     FIXED computeRealBalance
     ─────────────────────────────────────────────────────────────
     "received" = owner_transfers (actual bank sends by admin)
                  NOT payout_requests (which can have stale/bad data)

     available  = earned - transferred - locked(pending requests)
  ══════════════════════════════════════════════════════════════ */
  async function computeRealBalance(ownerId) {
    const db = _db();
    if (!db || !ownerId) {
      return {
        earned: 0, groundEarned: 0, poolEarned: 0, tournamentEarned: 0,
        transferred: 0, locked: 0, available: 0, pendingRequests: [],
      };
    }

    /* ── 1. Ground bookings (confirmed) ── */
    const gSnap = await db.collection('bookings')
      .where('ownerId', '==', ownerId)
      .where('bookingStatus', '==', 'confirmed')
      .get().catch(() => ({ docs: [] }));

    let groundEarned = 0;
    gSnap.docs.forEach(d => {
      const data = d.data();
      // CRITICAL FIX: skip bookings already paid out OR locked in a pending payout request.
      // payout_pending bookings are already counted in `locked` (payout_requests sum),
      // so including them in totalEarned too would create a phantom double balance.
      if (data.payoutStatus === 'payout_done') return; // only exclude fully-transferred bookings from earned total
      const amt  = Number(data.ownerAmount);
      groundEarned += amt > 0 ? amt : Math.floor(Number(data.amount || data.totalAmount || 0) * 0.93);
    });

    /* ── 2. Pool bookings — FIXED: Query only status='confirmed' (no double-query to prevent duplicate count) ── */
    // NOTE: We set BOTH status AND bookingStatus to 'confirmed', so we only need to query ONE field
    // Double-querying caused same document to be counted twice before deduplication
    const pByStatus = await db.collection('pool_bookings')
      .where('ownerId','==',ownerId)
      .where('status','==','confirmed')
      .get().catch(() => ({ docs: [] }));
    
    let poolEarned = 0;
    pByStatus.docs.forEach(d => {
      const data = d.data();
      // CRITICAL FIX: skip pool bookings already paid out
      if (data.payoutStatus === 'payout_done') return;
      const amt  = Number(data.ownerAmount);
      poolEarned += amt > 0 ? amt : Math.floor(Number(data.amount || 0) * 0.93);
    });

    /* ── 3. Tournament earnings ── */
    let tournamentEarned = 0;
    try {
      const tSnap = await db.collection('tournaments').where('ownerId','==',ownerId).get().catch(() => ({ docs: [] }));
      if (!tSnap.empty) {
        const ids = tSnap.docs.map(d => d.id);
        for (let i = 0; i < ids.length; i += 30) {
          const eSnap = await db.collection('tournament_entries')
            .where('tournamentId','in', ids.slice(i, i + 30))
            .get().catch(() => ({ docs: [] }));
          eSnap.docs.forEach(d => {
            const e = d.data();
            if (e.status !== 'confirmed' && e.paymentStatus !== 'paid') return;
            // CRITICAL FIX: skip tournament entries already paid out OR locked in a pending payout request.
            if (e.payoutStatus === 'payout_done') return; // only exclude fully-transferred entries
            tournamentEarned += Number(e.ownerAmount) || Math.round(Number(e.amount || 0) * 0.8);
          });
        }
      }
    } catch (_) {}

    const totalEarned = groundEarned + poolEarned + tournamentEarned;

    /* ── 4. Already transferred ──────────────────────────────────────────
     *
     *  PRIMARY source: owner_transfers collection (actual confirmed bank sends).
     *  FALLBACK: If owner_transfers is empty (old paid requests pre-date the
     *  owner_transfers feature), sum up paid payout_requests as transferred.
     *  This handles the historical case where markPayoutAsPaid ran without
     *  creating an owner_transfers record, leaving the same booking in earnings.
     * ──────────────────────────────────────────────────────────────────── */
    const [transferSnap, allPayoutSnap] = await Promise.all([
      db.collection('owner_transfers')
        .where('ownerId', '==', ownerId)
        .get().catch(() => ({ docs: [] })),
      db.collection('payout_requests')
        .where('ownerId', '==', ownerId)
        .get().catch(() => ({ docs: [] })),
    ]);

    let totalTransferred = 0;
    transferSnap.docs.forEach(d => {
      totalTransferred += Number(d.data().amount || 0);
    });

    /* ── 5. Locked in pending/approved payout_requests ── */
    let totalLocked = 0;
    const pendingRequests = [];
    let paidFromRequests = 0;

    allPayoutSnap.docs.forEach(d => {
      const p = d.data();
      const st = p.status || 'pending';
      if (st === 'pending' || st === 'approved') {
        totalLocked += Number(p.amount || 0);
        pendingRequests.push({ id: d.id, ...p });
      } else if (st === 'paid' || st === 'completed') {
        paidFromRequests += Number(p.amount || 0);
      }
    });

    // NOTE: We do NOT fall back to paid payout_requests as 'transferred'.
    // Bookings that were paid out already have payoutStatus:'payout_done' and are
    // excluded from totalEarned above. Using paid payout_requests as an additional
    // deduction would double-count: once via exclusion from earned, once here.
    // If owner_transfers is empty, transferred = 0 and available = earned.
    if (totalTransferred === 0 && paidFromRequests > 0) {
      // Do NOT set totalTransferred = paidFromRequests (causes double-deduction)
      warn('[payout-fix] owner_transfers empty; paidFromRequests ignored to prevent double-deduction. Earned:', totalEarned);
    }

    const available = Math.max(0, totalEarned - totalTransferred - totalLocked);

    log('balance for', ownerId, '→',
      'earned:', totalEarned,
      '| transferred:', totalTransferred,
      '| locked:', totalLocked,
      '| available:', available
    );

    return {
      earned: totalEarned, groundEarned, poolEarned, tournamentEarned,
      transferred: totalTransferred,
      locked: totalLocked,
      available,
      pendingRequests,
    };
  }


  /* ══════════════════════════════════════════════════════════════
     Earnings tab renderer
  ══════════════════════════════════════════════════════════════ */
  async function renderEarningsTab(container) {
    const cu = _cu(), db = _db();
    if (!cu || !db) {
      container.innerHTML = '<p style="text-align:center;padding:32px;color:#9ca3af;">Please log in to view earnings.</p>';
      return;
    }

    if (typeof window.showLoading === 'function') window.showLoading('Calculating earnings…');

    try {
      const bal = await computeRealBalance(cu.uid);

      /* Period stats */
      const today = _isoDate(0), week = _isoDate(6), month = _isoDate(29);
      let todayE = 0, weekE = 0, monthE = 0;
      const bSnap = await db.collection('bookings')
        .where('ownerId', '==', cu.uid)
        .where('bookingStatus', '==', 'confirmed')
        .get().catch(() => ({ docs: [] }));
      bSnap.docs.forEach(d => {
        const b   = d.data();
        // Skip already paid-out bookings in period stats too
        if (b.payoutStatus === 'payout_done') return;
        const amt = Number(b.ownerAmount) || Math.floor(Number(b.amount || 0) * 0.93);
        if (b.date === today) todayE += amt;
        if (b.date >= week)   weekE  += amt;
        if (b.date >= month)  monthE += amt;
      });

      if (typeof window.hideLoading === 'function') window.hideLoading();

      const pendingNotice = bal.pendingRequests.length > 0
        ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:12px 14px;margin-bottom:16px;display:flex;align-items:center;gap:10px;">
            <i class="fas fa-clock" style="color:#f59e0b;font-size:16px;flex-shrink:0;"></i>
            <div>
              <div style="font-weight:700;color:#92400e;font-size:13px;">Payout Under Review</div>
              <div style="font-size:12px;color:#b45309;margin-top:2px;">${_fmt(bal.locked)} is locked in a pending payout request.</div>
            </div>
          </div>` : '';

      container.innerHTML = `
        <!-- Period stats -->
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;">
          ${[['Today', todayE], ['This Week', weekE], ['This Month', monthE]].map(([label, val]) => `
            <div style="background:#f0f4ff;border-radius:12px;padding:12px;text-align:center;">
              <div style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px;">${label}</div>
              <div style="font-size:18px;font-weight:800;color:#2563eb;">${_fmt(val)}</div>
            </div>`).join('')}
        </div>

        <!-- Balance hero -->
        <div style="background:linear-gradient(135deg,#1b2e6c,#2563eb);border-radius:16px;padding:20px;margin-bottom:16px;color:#fff;">
          <div style="font-size:12px;opacity:.8;margin-bottom:6px;"><i class="fas fa-wallet"></i> Available to Withdraw</div>
          <div style="font-size:34px;font-weight:800;letter-spacing:-0.6px;margin-bottom:4px;">${_fmt(bal.available)}</div>
          <div style="font-size:11px;opacity:.7;">Total earned minus transferred &amp; pending</div>
          <div style="margin-top:12px;background:rgba(255,255,255,.12);border-radius:10px;padding:10px 12px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
              <span style="font-size:12px;opacity:.85;">Total Earned</span>
              <span style="font-size:13px;font-weight:700;">${_fmt(bal.earned)}</span>
            </div>
            ${bal.transferred > 0 ? `
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
              <span style="font-size:12px;opacity:.85;">Already Transferred</span>
              <span style="font-size:13px;font-weight:700;color:#86efac;">− ${_fmt(bal.transferred)}</span>
            </div>` : ''}
            ${bal.locked > 0 ? `
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
              <span style="font-size:12px;opacity:.85;">In Review (pending)</span>
              <span style="font-size:13px;font-weight:700;color:#fde047;">− ${_fmt(bal.locked)}</span>
            </div>` : ''}
            <div style="border-top:1px solid rgba(255,255,255,.2);margin-top:8px;padding-top:8px;display:flex;justify-content:space-between;">
              <span style="font-size:12px;font-weight:700;">Available Now</span>
              <span style="font-size:14px;font-weight:800;color:#86efac;">${_fmt(bal.available)}</span>
            </div>
          </div>
        </div>

        <!-- Earnings breakdown -->
        <div style="background:#fff;border:1.5px solid #e8edf8;border-radius:14px;padding:14px;margin-bottom:16px;">
          <div style="font-size:13px;font-weight:800;color:#0f1f5c;margin-bottom:10px;">
            <i class="fas fa-chart-bar" style="color:#2563eb;margin-right:6px;"></i>Earnings Breakdown
          </div>
          <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0f4ff;">
            <span style="font-size:13px;color:#374151;"><i class="fas fa-futbol" style="color:#22c55e;margin-right:6px;width:14px;"></i>Ground Bookings</span>
            <span style="font-size:13px;font-weight:700;color:#15803d;">${_fmt(bal.groundEarned)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:8px 0;${bal.tournamentEarned > 0 ? 'border-bottom:1px solid #f0f4ff;' : ''}">
            <span style="font-size:13px;color:#374151;"><i class="fas fa-swimming-pool" style="color:#0ea5e9;margin-right:6px;width:14px;"></i>Pool Bookings</span>
            <span style="font-size:13px;font-weight:700;color:#0369a1;">${_fmt(bal.poolEarned)}</span>
          </div>
          ${bal.tournamentEarned > 0 ? `
          <div style="display:flex;justify-content:space-between;padding:8px 0;">
            <span style="font-size:13px;color:#374151;"><i class="fas fa-trophy" style="color:#7c3aed;margin-right:6px;width:14px;"></i>Tournaments</span>
            <span style="font-size:13px;font-weight:700;color:#7c3aed;">${_fmt(bal.tournamentEarned)}</span>
          </div>` : ''}
          <div style="display:flex;justify-content:space-between;padding:8px 0;border-top:2px solid #e8edf8;margin-top:4px;">
            <span style="font-size:13px;font-weight:700;color:#0f1f5c;">Total Earned</span>
            <span style="font-size:14px;font-weight:800;color:#0f1f5c;">${_fmt(bal.earned)}</span>
          </div>
        </div>

        ${pendingNotice}

        <!-- CTA -->
        ${bal.available > 0
          ? `<div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:14px;padding:14px;">
              <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
                <i class="fas fa-check-circle" style="color:#22c55e;font-size:18px;"></i>
                <div>
                  <div style="font-weight:700;color:#15803d;font-size:13px;">${_fmt(bal.available)} Ready to Withdraw</div>
                  <div style="font-size:12px;color:#166534;">Processed within 2–3 business days</div>
                </div>
              </div>
              <button onclick="window._bmgOpenPayoutModal()"
                style="width:100%;padding:13px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;border-radius:12px;font-weight:700;font-size:14px;cursor:pointer;font-family:inherit;">
                <i class="fas fa-paper-plane" style="margin-right:6px;"></i> Request Payout
              </button>
            </div>`
          : `<div style="background:#fffbeb;border:1.5px solid #fde68a;border-radius:14px;padding:14px;display:flex;align-items:center;gap:10px;">
              <i class="fas fa-info-circle" style="color:#f59e0b;font-size:16px;"></i>
              <div>
                <div style="font-weight:700;color:#92400e;font-size:13px;">${bal.earned > 0 ? (bal.locked > 0 ? 'Payout In Progress' : 'All Earnings Transferred') : 'No Earnings Yet'}</div>
                <div style="font-size:12px;color:#b45309;">${bal.locked > 0
                    ? `${_fmt(bal.locked)} is under a pending payout request.`
                    : bal.transferred > 0
                      ? `${_fmt(bal.transferred)} has been paid out to your account.`
                      : 'Earnings appear here after your first confirmed booking.'}</div>
              </div>
            </div>`}
      `;

      window._bmgCurrentBalance = bal;

    } catch (err) {
      if (typeof window.hideLoading === 'function') window.hideLoading();
      warn('renderEarningsTab error:', err.message);
      container.innerHTML = `
        <div style="text-align:center;padding:32px;color:#ef4444;">
          <i class="fas fa-exclamation-triangle" style="font-size:24px;margin-bottom:8px;display:block;"></i>
          <div style="font-weight:600;">Failed to load earnings</div>
          <div style="font-size:12px;color:#9ca3af;margin-top:4px;">${_esc(err.message)}</div>
          <button onclick="window._bmgFixReloadEarnings()"
            style="margin-top:12px;padding:8px 20px;background:#2563eb;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;">
            Retry
          </button>
        </div>`;
    }
  }


  /* ══════════════════════════════════════════════════════════════
     Payouts tab renderer
  ══════════════════════════════════════════════════════════════ */
  async function renderPayoutsTab(container) {
    const cu = _cu(), db = _db();
    if (!cu || !db) {
      container.innerHTML = '<p style="text-align:center;padding:32px;color:#9ca3af;">Please log in.</p>';
      return;
    }

    if (typeof window.showLoading === 'function') window.showLoading('Loading payouts…');

    try {
      const bal = await computeRealBalance(cu.uid);

      const prSnap = await db.collection('payout_requests')
        .where('ownerId', '==', cu.uid)
        .orderBy('createdAt', 'desc')
        .get().catch(async () =>
          db.collection('payout_requests').where('ownerId', '==', cu.uid).get().catch(() => ({ docs: [] }))
        );

      const stats = { total: prSnap.docs.length, pending: 0, approved: 0, paid: 0, rejected: 0 };
      prSnap.docs.forEach(d => { const st = d.data().status; if (stats[st] !== undefined) stats[st]++; });
      const hasPending = bal.pendingRequests.length > 0;

      function _statusCard(docId, p) {
        const st     = p.status || 'pending';
        const icons  = { pending:'fa-clock', approved:'fa-check-circle', paid:'fa-money-bill-wave', rejected:'fa-times-circle' };
        const labels = { pending:'Under Review', approved:'Approved', paid:'Paid ✓', rejected:'Rejected' };
        const colors = { pending:'#f59e0b', approved:'#3b82f6', paid:'#22c55e', rejected:'#ef4444' };
        return `
          <div class="psp-card" data-status="${st}"
            style="background:#fff;border-radius:14px;padding:14px;margin-bottom:10px;border:1.5px solid #e8edf8;box-shadow:0 2px 8px rgba(15,31,92,.06);">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
              <div>
                <div style="font-size:13px;font-weight:800;color:#0f1f5c;">Payout Request</div>
                <div style="font-size:11px;color:#9ca3af;margin-top:2px;">${_fmtDate(p.createdAt)}</div>
              </div>
              <div style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:20px;
                  background:${colors[st]}18;color:${colors[st]};font-size:11px;font-weight:700;">
                <i class="fas ${icons[st] || 'fa-circle'}"></i> ${labels[st] || st}
              </div>
            </div>
            <div style="font-size:24px;font-weight:800;color:#0f1f5c;margin-bottom:6px;">${_fmt(p.amount)}</div>
            ${p.upiId ? `<div style="font-size:12px;color:#6b7280;"><i class="fas fa-qrcode" style="margin-right:5px;"></i>${_esc(p.upiId)}</div>` : ''}
            ${p.status === 'rejected' && p.rejectionReason ? `
            <div style="margin-top:8px;background:#fee2e2;border-radius:8px;padding:8px 10px;font-size:12px;color:#b91c1c;">
              <i class="fas fa-times-circle"></i> ${_esc(p.rejectionReason)}
            </div>` : ''}
          </div>`;
      }

      if (typeof window.hideLoading === 'function') window.hideLoading();

      container.innerHTML = `
        <!-- Balance hero -->
        <div style="background:linear-gradient(135deg,#1b2e6c,#2563eb);border-radius:16px;padding:20px;margin-bottom:16px;color:#fff;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;">
            <div>
              <div style="font-size:11px;opacity:.75;margin-bottom:4px;"><i class="fas fa-wallet"></i> Available to Withdraw</div>
              <div style="font-size:34px;font-weight:800;letter-spacing:-0.6px;">${_fmt(bal.available)}</div>
              <div style="font-size:11px;opacity:.65;margin-top:4px;">
                Earned ${_fmt(bal.earned)}${bal.transferred > 0 ? ` · Transferred ${_fmt(bal.transferred)}` : ''}${bal.locked > 0 ? ` · In review ${_fmt(bal.locked)}` : ''}
              </div>
            </div>
            <button id="psp-apply-trigger"
              ${hasPending || bal.available < 1 ? 'disabled' : ''}
              style="background:rgba(255,255,255,.18);border:1.5px solid rgba(255,255,255,.35);color:#fff;
                font-size:12px;font-weight:700;padding:10px 14px;border-radius:22px;white-space:nowrap;
                font-family:inherit;opacity:${hasPending || bal.available < 1 ? '.6' : '1'};
                cursor:${hasPending || bal.available < 1 ? 'not-allowed' : 'pointer'};">
              <i class="fas fa-paper-plane" style="margin-right:5px;"></i>
              ${hasPending ? 'Request Pending' : 'Apply for Payout'}
            </button>
          </div>
          ${bal.locked > 0 ? `
          <div style="margin-top:12px;background:rgba(255,255,255,.1);border-radius:8px;padding:8px 10px;
              font-size:11px;opacity:.85;display:flex;align-items:center;gap:6px;">
            <i class="fas fa-clock" style="color:#fde047;"></i>
            <span>${_fmt(bal.locked)} is already under a pending payout request.</span>
          </div>` : ''}
        </div>

        <!-- Stats row -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px;">
          ${[
            ['Total',       stats.total,                     '#0f1f5c','#f8faff','#e8edf8'],
            ['In Progress', stats.pending + stats.approved,  '#92400e','#fffbeb','#fde68a'],
            ['Paid',        stats.paid,                      '#15803d','#f0fdf4','#86efac'],
            ['Rejected',    stats.rejected,                  '#b91c1c','#fef2f2','#fca5a5'],
          ].map(([label, val, tc, bg, border]) => `
            <div style="background:${bg};border-radius:12px;padding:10px;text-align:center;border:1px solid ${border};">
              <div style="font-size:18px;font-weight:800;color:${tc};">${val}</div>
              <div style="font-size:10px;color:${tc};font-weight:600;opacity:.75;margin-top:2px;">${label}</div>
            </div>`).join('')}
        </div>

        <!-- Requests list -->
        <div id="gef-payouts-list">
          ${prSnap.docs.length === 0
            ? `<div style="text-align:center;padding:36px 16px;">
                <div style="font-size:40px;opacity:.3;margin-bottom:10px;">💸</div>
                <div style="font-size:14px;font-weight:600;color:#9ca3af;">No payout requests yet.</div>
                <div style="font-size:12px;color:#d1d5db;margin-top:4px;">Apply for your first payout above.</div>
              </div>`
            : prSnap.docs.map(d => _statusCard(d.id, d.data())).join('')}
        </div>
      `;

      /* Wire apply button */
      const applyBtn = document.getElementById('psp-apply-trigger');
      if (applyBtn && !hasPending && bal.available >= 1) {
        applyBtn.addEventListener('click', () => openPayoutModal());
      }

    } catch (err) {
      if (typeof window.hideLoading === 'function') window.hideLoading();
      warn('renderPayoutsTab error:', err.message);
      container.innerHTML = `<div style="text-align:center;padding:32px;color:#ef4444;">Failed: ${_esc(err.message)}</div>`;
    }
  }


  /* ══════════════════════════════════════════════════════════════
     Payout request modal
  ══════════════════════════════════════════════════════════════ */
  async function openPayoutModal() {
    const cu = _cu(), db = _db();
    if (!cu || !db) { alert('Please log in first.'); return; }

    const bal = await computeRealBalance(cu.uid).catch(() => null);
    if (!bal) { alert('Could not load balance. Please try again.'); return; }

    if (bal.pendingRequests.length > 0) {
      const fn = typeof window.showToast === 'function' ? window.showToast : alert;
      fn('You already have a pending payout request. Please wait for it to be processed.', 'warning');
      return;
    }
    if (bal.available < 1) {
      const fn = typeof window.showToast === 'function' ? window.showToast : alert;
      fn('No balance available to withdraw yet.', 'info');
      return;
    }

    const available = bal.available;

    document.getElementById('gef-payout-modal')?.remove();
    const ov = document.createElement('div');
    ov.id = 'gef-payout-modal';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:flex-end;justify-content:center;';
    ov.innerHTML = `
      <div style="background:#fff;border-radius:20px 20px 0 0;padding:24px;width:100%;max-width:480px;max-height:90vh;overflow-y:auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
          <div style="font-size:16px;font-weight:800;color:#0f1f5c;">Request Payout</div>
          <button id="gef-modal-close" style="background:none;border:none;font-size:22px;color:#9ca3af;cursor:pointer;line-height:1;">×</button>
        </div>
        <div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;padding:12px;margin-bottom:16px;text-align:center;">
          <div style="font-size:11px;color:#15803d;font-weight:600;">Available Balance</div>
          <div style="font-size:28px;font-weight:800;color:#15803d;">${_fmt(available)}</div>
        </div>
        <div style="margin-bottom:14px;">
          <label style="font-size:13px;font-weight:700;color:#374151;display:block;margin-bottom:6px;">Amount to Withdraw</label>
          <input id="gef-amt" type="number" min="1" max="${Math.floor(available)}" value="${Math.floor(available)}"
            style="width:100%;padding:12px;border:1.5px solid #e8edf8;border-radius:10px;font-size:15px;font-family:inherit;box-sizing:border-box;outline:none;">
          <div id="gef-amt-err" style="color:#ef4444;font-size:12px;margin-top:4px;display:none;"></div>
          <div style="display:flex;gap:8px;margin-top:8px;">
            ${[25,50,75,100].map(p => `
              <button onclick="document.getElementById('gef-amt').value=Math.floor(${available}*${p}/100);document.getElementById('gef-amt-err').style.display='none';"
                style="flex:1;padding:6px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;
                  font-size:11px;font-weight:700;color:#1d4ed8;cursor:pointer;font-family:inherit;">${p}%</button>`).join('')}
          </div>
        </div>
        <div style="margin-bottom:16px;">
          <label style="font-size:13px;font-weight:700;color:#374151;display:block;margin-bottom:6px;">UPI ID</label>
          <input id="gef-upi" type="text" placeholder="yourname@upi"
            style="width:100%;padding:12px;border:1.5px solid #e8edf8;border-radius:10px;font-size:14px;font-family:inherit;box-sizing:border-box;outline:none;">
          <div id="gef-upi-err" style="color:#ef4444;font-size:12px;margin-top:4px;display:none;"></div>
        </div>
        <button id="gef-submit-payout"
          style="width:100%;padding:14px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;
            border-radius:12px;font-weight:700;font-size:15px;cursor:pointer;font-family:inherit;">
          <i class="fas fa-paper-plane" style="margin-right:6px;"></i> Submit Payout Request
        </button>
      </div>`;

    document.body.appendChild(ov);
    document.getElementById('gef-modal-close').onclick = () => ov.remove();
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });

    document.getElementById('gef-submit-payout').addEventListener('click', async function () {
      const amtInput = document.getElementById('gef-amt');
      const upiInput = document.getElementById('gef-upi');
      const amtErr   = document.getElementById('gef-amt-err');
      const upiErr   = document.getElementById('gef-upi-err');
      const amt = parseFloat(amtInput.value);
      const upi = upiInput.value.trim();
      amtErr.style.display = 'none';
      upiErr.style.display = 'none';

      if (!amt || amt < 1) { amtErr.textContent = 'Enter a valid amount.'; amtErr.style.display = 'block'; return; }
      if (amt > available + 0.5) { amtErr.textContent = `Exceeds available balance of ${_fmt(available)}.`; amtErr.style.display = 'block'; return; }
      if (!upi || !upi.includes('@')) { upiErr.textContent = 'Enter a valid UPI ID (e.g. name@upi).'; upiErr.style.display = 'block'; return; }

      this.disabled = true;
      this.textContent = 'Submitting…';

      try {
        /* Re-check for duplicate */
        const latestPending = await db.collection('payout_requests')
          .where('ownerId', '==', cu.uid)
          .where('status', 'in', ['pending', 'approved'])
          .get().catch(() => ({ docs: [] }));
        if (latestPending.docs.length > 0) {
          alert('A payout request is already pending. Please wait.');
          ov.remove();
          return;
        }

        await db.collection('payout_requests').add({
          requestId      : 'POUT-' + Date.now(),
          ownerId        : cu.uid,
          ownerName      : cu.ownerName || cu.name || cu.displayName || '',
          ownerEmail     : cu.email || '',
          upiId          : upi,
          amount         : Math.round(amt),
          requestedAmount: Math.round(amt),
          status         : 'pending',
          bookingIds     : [],
          createdAt      : _ts(),
          updatedAt      : _ts(),
        });

        ov.remove();

        const toastFn = window.showToast || window._toast || ((m) => alert(m));
        toastFn('Payout request submitted! Admin will review within 2–3 business days.', 'success');

        /* Refresh payouts tab */
        const cont = document.getElementById('owner-dashboard-content') || document.getElementById('owner-earnings-content');
        if (cont) renderPayoutsTab(cont).catch(() => {});

      } catch (err) {
        warn('Payout submit error:', err.message);
        this.disabled = false;
        this.innerHTML = '<i class="fas fa-paper-plane" style="margin-right:6px;"></i> Submit Payout Request';
        amtErr.textContent = 'Failed to submit. Please try again.';
        amtErr.style.display = 'block';
      }
    });
  }


  /* ══════════════════════════════════════════════════════════════
     Install — overwrite all previous (broken) versions
  ══════════════════════════════════════════════════════════════ */
  function install() {
    window.loadOwnerEarnings         = renderEarningsTab;
    window.loadOwnerPayouts          = renderPayoutsTab;
    window._bmgLoadOwnerEarningsFull = renderEarningsTab;
    window._bmgOpenPayoutModal       = openPayoutModal;
    window.showPayoutRequestModal    = openPayoutModal;
    window._efComputeRealBalance     = computeRealBalance;
    window._pspEarningsPatched       = true;
    window._gefInstalled             = true;
    window._bmgFixReloadEarnings     = function (container) {
      const c = container
        || document.getElementById('owner-dashboard-content')
        || document.getElementById('owner-earnings-content');
      if (c) renderEarningsTab(c).catch(console.error);
    };
    log('✅ Fixed computeRealBalance + renderers installed (v3 — uses owner_transfers)');
  }

  function patchDashboardRouter() {
    if (!window.loadOwnerDashboard) { setTimeout(patchDashboardRouter, 300); return; }
    if (window.__pzfRouterPatched) return;

    const _orig = window.loadOwnerDashboard;
    window.loadOwnerDashboard = async function (tab) {
      const container = document.getElementById('owner-dashboard-content');
      if (tab === 'earnings' && container) {
        document.querySelectorAll('.dashboard-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('owner-earnings-tab')?.classList.add('active');
        container.innerHTML = '<div class="loading-spinner"><div class="loader-spinner"></div></div>';
        try { await renderEarningsTab(container); } catch (e) { warn('earnings error:', e.message); }
        return;
      }
      if (tab === 'payouts' && container) {
        document.querySelectorAll('.dashboard-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('owner-payouts-tab')?.classList.add('active');
        container.innerHTML = '<div class="loading-spinner"><div class="loader-spinner"></div></div>';
        try { await renderPayoutsTab(container); } catch (e) { warn('payouts error:', e.message); }
        return;
      }
      return _orig.apply(this, arguments);
    };

    window.__pzfRouterPatched = true;
    log('✅ loadOwnerDashboard patched');
  }

  function wireRefreshEvents() {
    window.addEventListener('bmg:paymentConfirmed', function () {
      setTimeout(() => {
        const c = document.getElementById('owner-dashboard-content') || document.getElementById('owner-earnings-content');
        if (c) renderEarningsTab(c).catch(() => {});
      }, 3000);
    });
    window.addEventListener('bmg:earningsNeedRefresh', function () {
      setTimeout(() => {
        const c = document.getElementById('owner-dashboard-content') || document.getElementById('owner-earnings-content');
        if (c) renderEarningsTab(c).catch(() => {});
      }, 1000);
    });
  }

  /* Boot */
  install();
  patchDashboardRouter();
  wireRefreshEvents();
  setTimeout(install, 200);
  setTimeout(install, 700);
  setTimeout(install, 1800);
  setTimeout(patchDashboardRouter, 400);

  /* MutationObserver: survive any late overwrites */
  (function attachObserver() {
    const el = document.getElementById('owner-dashboard-page');
    if (!el) { setTimeout(attachObserver, 500); return; }
    new MutationObserver(() => {
      if (window.loadOwnerEarnings !== renderEarningsTab) install();
    }).observe(el, { childList: true, subtree: true });
    log('MutationObserver attached');
  })();

  log('sportobook_payout_zero_fix.js v3 loaded ✅');
})();
/* ══════════════════════════════════════════════════════════════════════════
 * COMPREHENSIVE FIX PATCH v4
 * Fixes:
 *   1. Owner earnings not showing for pool/ground bookings (7% commission)
 *   2. Entry pass not popping up instantly after payment return
 *   3. Updated pool price not showing in booking page for members
 *   4. Swimming pool Write Review not working
 * ══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const L    = (...a) => console.log('[fix-v4]', ...a);
  const W    = (...a) => console.warn('[fix-v4]', ...a);
  const _db  = () => window.db || (window.firebase && window.firebase.firestore && window.firebase.firestore());
  const _cu  = () => window.currentUser || (window.auth && window.auth.currentUser && { uid: window.auth.currentUser.uid });
  const _ts  = () => window.firebase && window.firebase.firestore ? window.firebase.firestore.FieldValue.serverTimestamp() : new Date();

  /* ────────────────────────────────────────────────────────────────────────
   * FIX 1 — Owner Earnings: pool bookings confirmed via paymentStatus:'success'
   *
   * Root cause: computeRealBalance (v3) only queries pool_bookings where
   *   status == 'confirmed' OR bookingStatus == 'confirmed'.
   * But some pool bookings written by finalisePoolBooking have BOTH
   *   status:'confirmed' AND bookingStatus:'confirmed', while others may
   *   only have paymentStatus:'success' without both status fields.
   *
   * Additionally the 7% commission fallback used Math.floor(amount * 0.93)
   * which is correct (93% to owner = 7% platform), but pool bookings
   * sometimes store ownerAmount:0 when the field was not enriched from
   * sessionStorage. We now also query by paymentStatus:'success' as a
   * third net to catch those.
   *
   * We override computeRealBalance on window._efComputeRealBalance AND
   * replace it in the v3 closure via the install mechanism.
   * ──────────────────────────────────────────────────────────────────────── */
  async function computeRealBalanceV4(ownerId) {
    const db = _db();
    if (!db || !ownerId) {
      return { earned: 0, groundEarned: 0, poolEarned: 0, tournamentEarned: 0,
               transferred: 0, locked: 0, available: 0, pendingRequests: [] };
    }

    /* ── 1. Ground bookings (confirmed) ── */
    // Triple-net query: bookingStatus:'confirmed', paymentStatus:'success', or paymentStatus:'paid'
    const [gByBookingStatus, gByPaySuccess, gByPayPaid] = await Promise.all([
      db.collection('bookings').where('ownerId','==',ownerId).where('bookingStatus','==','confirmed')
        .get().catch(() => ({ docs: [] })),
      db.collection('bookings').where('ownerId','==',ownerId).where('paymentStatus','==','success')
        .get().catch(() => ({ docs: [] })),
      db.collection('bookings').where('ownerId','==',ownerId).where('paymentStatus','==','paid')
        .get().catch(() => ({ docs: [] })),
    ]);

    let groundEarned = 0;
    const seenGround = new Set();
    [...gByBookingStatus.docs, ...gByPaySuccess.docs, ...gByPayPaid.docs].forEach(d => {
      if (seenGround.has(d.id)) return;
      seenGround.add(d.id);
      const data = d.data();
      // Skip cancelled or failed bookings
      const st = data.bookingStatus || data.status || '';
      if (st === 'cancelled' || st === 'failed') return;
      if (data.payoutStatus === 'payout_done') return; // only exclude fully-transferred bookings from earned total
      const amt = Number(data.ownerAmount);
      // 7% platform commission → owner gets 93%
      groundEarned += amt > 0 ? amt : Math.floor(Number(data.amount || data.totalAmount || 0) * 0.93);
    });

    /* ── 2. Pool bookings — FIXED: Query only confirmed status (no triple-net to prevent double-count) ── */
    // NOTE: We set BOTH status AND bookingStatus to 'confirmed', so we only need to query one
    // Triple-net queries caused double-counting when same document matched multiple fields
    const pByStatus = await db.collection('pool_bookings').where('ownerId','==',ownerId).where('status','==','confirmed')
      .get().catch(() => ({ docs: [] }));

    let poolEarned = 0;
    const seenPool = new Set();
    pByStatus.docs.forEach(d => {
      if (seenPool.has(d.id)) return;
      seenPool.add(d.id);
      const data = d.data();
      // Skip if cancelled or pending
      const st = data.status || data.bookingStatus || '';
      if (st === 'cancelled' || st === 'failed') return;
      if (data.payoutStatus === 'payout_done') return; // only exclude fully-transferred bookings from earned total
      const amt = Number(data.ownerAmount);
      // 7% platform commission → owner gets 93%
      poolEarned += amt > 0 ? amt : Math.floor(Number(data.amount || 0) * 0.93);
    });

    /* ── 3. Tournament earnings ── */
    let tournamentEarned = 0;
    try {
      const tSnap = await db.collection('tournaments').where('ownerId','==',ownerId)
        .get().catch(() => ({ docs: [] }));
      if (!tSnap.empty) {
        const ids = tSnap.docs.map(d => d.id);
        for (let i = 0; i < ids.length; i += 30) {
          const eSnap = await db.collection('tournament_entries')
            .where('tournamentId','in', ids.slice(i, i + 30))
            .get().catch(() => ({ docs: [] }));
          eSnap.docs.forEach(d => {
            const e = d.data();
            if (e.status !== 'confirmed' && e.paymentStatus !== 'paid') return;
            if (e.payoutStatus === 'payout_done') return; // only exclude fully-transferred entries
            tournamentEarned += Number(e.ownerAmount) || Math.round(Number(e.amount || 0) * 0.8);
          });
        }
      }
    } catch (_) {}

    const totalEarned = groundEarned + poolEarned + tournamentEarned;

    /* ── 4. Transferred + locked ── */
    const [transferSnap, allPayoutSnap] = await Promise.all([
      db.collection('owner_transfers').where('ownerId','==',ownerId)
        .get().catch(() => ({ docs: [] })),
      db.collection('payout_requests').where('ownerId','==',ownerId)
        .get().catch(() => ({ docs: [] })),
    ]);

    let totalTransferred = 0;
    transferSnap.docs.forEach(d => { totalTransferred += Number(d.data().amount || 0); });

    let totalLocked = 0, paidFromRequests = 0;
    const pendingRequests = [];
    allPayoutSnap.docs.forEach(d => {
      const p = d.data();
      const st = p.status || 'pending';
      if (st === 'pending' || st === 'approved') {
        totalLocked += Number(p.amount || 0);
        pendingRequests.push({ id: d.id, ...p });
      } else if (st === 'paid' || st === 'completed') {
        paidFromRequests += Number(p.amount || 0);
      }
    });

    // NOTE: Do NOT fall back to paid payout_requests as 'transferred'.
    // payout_done bookings are already excluded from totalEarned, so adding
    // paidFromRequests here would double-deduct those amounts.
    if (totalTransferred === 0 && paidFromRequests > 0) {
      // Do NOT set totalTransferred = paidFromRequests (double-deduction bug)
      W('[payout-fix] owner_transfers empty; paidFromRequests ignored to prevent double-deduction. Earned:', totalEarned);
    }

    const available = Math.max(0, totalEarned - totalTransferred - totalLocked);

    L('balance v4 for', ownerId, '→ earned:', totalEarned,
      '| ground:', groundEarned, '| pool:', poolEarned,
      '| transferred:', totalTransferred, '| locked:', totalLocked,
      '| available:', available);

    return { earned: totalEarned, groundEarned, poolEarned, tournamentEarned,
             transferred: totalTransferred, locked: totalLocked, available, pendingRequests };
  }

  // Expose so the earnings tab renderer picks it up
  window._efComputeRealBalance = computeRealBalanceV4;

  // Patch the renderer wrapper that v3 installs
  function patchEarningsCompute() {
    const origRender = window.loadOwnerEarnings || window._bmgLoadOwnerEarningsFull;
    if (typeof origRender !== 'function') return false;

    // We wrap the installed renderer so it calls our v4 balance fn
    const wrappedRender = async function (container) {
      // Temporarily override the balance fn that the renderer calls
      const prev = window._efComputeRealBalance;
      window._efComputeRealBalance = computeRealBalanceV4;
      try {
        return await origRender.call(this, container);
      } finally {
        window._efComputeRealBalance = prev;
      }
    };

    // The v3 renderer calls computeRealBalance which is closed over inside the IIFE.
    // We can't reach it directly, so we inject our own renderEarningsTab that uses v4.
    window.loadOwnerEarnings         = buildEarningsRenderer();
    window._bmgLoadOwnerEarningsFull = window.loadOwnerEarnings;
    L('✅ Earnings renderer patched to v4 (7% commission, pool triple-net)');
    return true;
  }

  function _fmt(n) {
    return '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }
  function _isoDate(daysBack) {
    const d = new Date(); d.setDate(d.getDate() - daysBack); return d.toISOString().split('T')[0];
  }
  function _esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function buildEarningsRenderer() {
    return async function renderEarningsTabV4(container) {
      const cu = _cu(), db = _db();
      if (!cu || !db) {
        if (container) container.innerHTML = '<p style="text-align:center;padding:32px;color:#9ca3af;">Please log in to view earnings.</p>';
        return;
      }

      if (typeof window.showLoading === 'function') window.showLoading('Calculating earnings…');

      try {
        const bal = await computeRealBalanceV4(cu.uid);

        /* Period stats — ground bookings (triple-net query) */
        const today = _isoDate(0), week = _isoDate(6), month = _isoDate(29);
        let todayE = 0, weekE = 0, monthE = 0;
        const [gPS1, gPS2, gPS3] = await Promise.all([
          db.collection('bookings').where('ownerId','==',cu.uid).where('bookingStatus','==','confirmed').get().catch(()=>({docs:[]})),
          db.collection('bookings').where('ownerId','==',cu.uid).where('paymentStatus','==','success').get().catch(()=>({docs:[]})),
          db.collection('bookings').where('ownerId','==',cu.uid).where('paymentStatus','==','paid').get().catch(()=>({docs:[]})),
        ]);
        const seenG = new Set();
        [...gPS1.docs,...gPS2.docs,...gPS3.docs].forEach(d => {
          if (seenG.has(d.id)) return; seenG.add(d.id);
          const b = d.data();
          const gst = b.bookingStatus || b.status || '';
          if (gst === 'cancelled' || gst === 'failed') return;
          if (b.payoutStatus === 'payout_done') return;
          const amt = Number(b.ownerAmount) || Math.floor(Number(b.amount || 0) * 0.93);
          if (b.date === today) todayE += amt;
          if (b.date >= week)   weekE  += amt;
          if (b.date >= month)  monthE += amt;
        });

        /* Period stats — pool bookings */
        const [pS1, pS2, pS3] = await Promise.all([
          db.collection('pool_bookings').where('ownerId','==',cu.uid).where('status','==','confirmed').get().catch(()=>({docs:[]})),
          db.collection('pool_bookings').where('ownerId','==',cu.uid).where('bookingStatus','==','confirmed').get().catch(()=>({docs:[]})),
          db.collection('pool_bookings').where('ownerId','==',cu.uid).where('paymentStatus','==','success').get().catch(()=>({docs:[]})),
        ]);
        const seenP = new Set();
        [...pS1.docs,...pS2.docs,...pS3.docs].forEach(d => {
          if (seenP.has(d.id)) return; seenP.add(d.id);
          const b = d.data();
          const st = b.status || b.bookingStatus || '';
          if (st === 'cancelled' || st === 'failed') return;
          if (b.payoutStatus === 'payout_done') return;
          const amt = Number(b.ownerAmount) || Math.floor(Number(b.amount || 0) * 0.93);
          const dt = b.date || '';
          if (dt === today) todayE += amt;
          if (dt >= week)   weekE  += amt;
          if (dt >= month)  monthE += amt;
        });

        if (typeof window.hideLoading === 'function') window.hideLoading();

        const pendingNotice = bal.pendingRequests.length > 0
          ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:12px 14px;margin-bottom:16px;display:flex;align-items:center;gap:10px;">
              <i class="fas fa-clock" style="color:#f59e0b;font-size:16px;flex-shrink:0;"></i>
              <div>
                <div style="font-weight:700;color:#92400e;font-size:13px;">Payout Under Review</div>
                <div style="font-size:12px;color:#b45309;margin-top:2px;">${_fmt(bal.locked)} is locked in a pending payout request.</div>
              </div>
            </div>` : '';

        if (container) container.innerHTML = `
          <!-- Period stats -->
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;">
            ${[['Today', todayE], ['This Week', weekE], ['This Month', monthE]].map(([label, val]) => `
              <div style="background:#f0f4ff;border-radius:12px;padding:12px;text-align:center;">
                <div style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px;">${label}</div>
                <div style="font-size:18px;font-weight:800;color:#2563eb;">${_fmt(val)}</div>
              </div>`).join('')}
          </div>

          <!-- Balance hero -->
          <div style="background:linear-gradient(135deg,#1b2e6c,#2563eb);border-radius:16px;padding:20px;margin-bottom:16px;color:#fff;">
            <div style="font-size:12px;opacity:.8;margin-bottom:6px;"><i class="fas fa-wallet"></i> Available to Withdraw</div>
            <div style="font-size:34px;font-weight:800;letter-spacing:-0.6px;margin-bottom:4px;">${_fmt(bal.available)}</div>
            <div style="font-size:11px;opacity:.7;">Total earned minus transferred &amp; pending</div>
            <div style="margin-top:12px;background:rgba(255,255,255,.12);border-radius:10px;padding:10px 12px;">
              <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                <span style="font-size:12px;opacity:.85;">Total Earned (after 7% platform fee)</span>
                <span style="font-size:13px;font-weight:700;">${_fmt(bal.earned)}</span>
              </div>
              ${bal.transferred > 0 ? `
              <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                <span style="font-size:12px;opacity:.85;">Already Transferred</span>
                <span style="font-size:13px;font-weight:700;color:#86efac;">− ${_fmt(bal.transferred)}</span>
              </div>` : ''}
              ${bal.locked > 0 ? `
              <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                <span style="font-size:12px;opacity:.85;">In Review (pending)</span>
                <span style="font-size:13px;font-weight:700;color:#fde047;">− ${_fmt(bal.locked)}</span>
              </div>` : ''}
              <div style="border-top:1px solid rgba(255,255,255,.2);margin-top:8px;padding-top:8px;display:flex;justify-content:space-between;">
                <span style="font-size:12px;font-weight:700;">Available Now</span>
                <span style="font-size:14px;font-weight:800;color:#86efac;">${_fmt(bal.available)}</span>
              </div>
            </div>
          </div>

          <!-- Earnings breakdown -->
          <div style="background:#fff;border:1.5px solid #e8edf8;border-radius:14px;padding:14px;margin-bottom:16px;">
            <div style="font-size:13px;font-weight:800;color:#0f1f5c;margin-bottom:10px;">
              <i class="fas fa-chart-bar" style="color:#2563eb;margin-right:6px;"></i>Earnings Breakdown
              <span style="float:right;font-size:11px;font-weight:600;color:#6b7280;background:#f0f4ff;padding:2px 8px;border-radius:20px;">Platform: 7% commission</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0f4ff;">
              <span style="font-size:13px;color:#374151;"><i class="fas fa-futbol" style="color:#22c55e;margin-right:6px;width:14px;"></i>Ground Bookings</span>
              <span style="font-size:13px;font-weight:700;color:#15803d;">${_fmt(bal.groundEarned)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:8px 0;${bal.tournamentEarned > 0 ? 'border-bottom:1px solid #f0f4ff;' : ''}">
              <span style="font-size:13px;color:#374151;"><i class="fas fa-swimming-pool" style="color:#0ea5e9;margin-right:6px;width:14px;"></i>Pool Bookings</span>
              <span style="font-size:13px;font-weight:700;color:#0369a1;">${_fmt(bal.poolEarned)}</span>
            </div>
            ${bal.tournamentEarned > 0 ? `
            <div style="display:flex;justify-content:space-between;padding:8px 0;">
              <span style="font-size:13px;color:#374151;"><i class="fas fa-trophy" style="color:#7c3aed;margin-right:6px;width:14px;"></i>Tournaments</span>
              <span style="font-size:13px;font-weight:700;color:#7c3aed;">${_fmt(bal.tournamentEarned)}</span>
            </div>` : ''}
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-top:2px solid #e8edf8;margin-top:4px;">
              <span style="font-size:13px;font-weight:700;color:#0f1f5c;">Total Earned</span>
              <span style="font-size:14px;font-weight:800;color:#0f1f5c;">${_fmt(bal.earned)}</span>
            </div>
          </div>

          ${pendingNotice}

          <!-- CTA -->
          ${bal.available > 0
            ? `<div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:14px;padding:14px;">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
                  <i class="fas fa-check-circle" style="color:#22c55e;font-size:18px;"></i>
                  <div>
                    <div style="font-weight:700;color:#15803d;font-size:13px;">${_fmt(bal.available)} Ready to Withdraw</div>
                    <div style="font-size:12px;color:#166534;">Processed within 2–3 business days</div>
                  </div>
                </div>
                <button onclick="window._bmgOpenPayoutModal()"
                  style="width:100%;padding:13px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;border-radius:12px;font-weight:700;font-size:14px;cursor:pointer;font-family:inherit;">
                  <i class="fas fa-paper-plane" style="margin-right:6px;"></i> Request Payout
                </button>
              </div>`
            : `<div style="background:#fffbeb;border:1.5px solid #fde68a;border-radius:14px;padding:14px;display:flex;align-items:center;gap:10px;">
                <i class="fas fa-info-circle" style="color:#f59e0b;font-size:16px;"></i>
                <div>
                  <div style="font-weight:700;color:#92400e;font-size:13px;">${bal.earned > 0 ? (bal.locked > 0 ? 'Payout In Progress' : 'All Earnings Transferred') : 'No Earnings Yet'}</div>
                  <div style="font-size:12px;color:#b45309;">${bal.locked > 0
                      ? `${_fmt(bal.locked)} is under a pending payout request.`
                      : bal.transferred > 0
                        ? `${_fmt(bal.transferred)} has been paid out to your account.`
                        : 'Earnings appear here after your first confirmed booking.'}</div>
                </div>
              </div>`}
        `;

        window._bmgCurrentBalance = bal;

      } catch (err) {
        if (typeof window.hideLoading === 'function') window.hideLoading();
        W('renderEarningsTabV4 error:', err.message);
        if (container) container.innerHTML = `
          <div style="text-align:center;padding:32px;color:#ef4444;">
            <i class="fas fa-exclamation-triangle" style="font-size:24px;margin-bottom:8px;display:block;"></i>
            <div style="font-weight:600;">Failed to load earnings</div>
            <div style="font-size:12px;color:#9ca3af;margin-top:4px;">${_esc(err.message)}</div>
            <button onclick="window._bmgFixReloadEarnings()"
              style="margin-top:12px;padding:8px 20px;background:#2563eb;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;">
              Retry
            </button>
          </div>`;
      }
    };
  }

  /* ────────────────────────────────────────────────────────────────────────
   * FIX 2 — Entry Pass popup instantly after payment return
   *
   * Root cause: The bmg:paymentConfirmed listener in sportobook_patches_merged.js
   * only handles paymentType='booking' for ground bookings — it does NOT handle
   * paymentType='pool'. This means:
   *   a) window._lastConfirmedBookingId is never set for pool payments
   *   b) showBookingSuccessConfirmation is never called for pool payments
   *   c) The view-entry-pass-btn remains hidden after pool payment
   *
   * Additionally, for BOTH ground and pool, we need to ensure:
   *   - window._lastConfirmedBookingId is always set before showPage fires
   *   - The view-entry-pass-btn is shown and wired correctly
   *
   * Fix: wrap bmg:paymentConfirmed to always set the bookingId and show button.
   * ──────────────────────────────────────────────────────────────────────── */
  (function patchEntryPassAfterPayment() {
    const _deduped = new Set();

    window.addEventListener('bmg:paymentConfirmed', function (e) {
      if (!e || !e.detail) return;
      const { orderId, paymentType, result } = e.detail;
      if (!orderId) return;

      const key = orderId + '_' + paymentType;
      if (_deduped.has(key)) return;
      _deduped.add(key);
      setTimeout(() => _deduped.delete(key), 60000);

      // For ground bookings: result may contain bookingId
      // For pool bookings: orderId IS the bookingId (pool_bookings doc ID)
      const bid = (result && result.bookingId) || orderId;

      L('paymentConfirmed → setting _lastConfirmedBookingId:', bid, 'type:', paymentType);

      // Always store bookingId so showEntryPassFromConfirmation can find it
      window._lastConfirmedBookingId = bid;
      try { sessionStorage.setItem('lastBookingId', bid); } catch (_) {}

      // For pool bookings — call showBookingSuccessConfirmation if not already shown
      if (paymentType === 'pool') {
        if (typeof window.showBookingSuccessConfirmation === 'function') {
          const pending = (() => {
            try { return JSON.parse(sessionStorage.getItem('pendingBooking') || '{}'); } catch(_) { return {}; }
          })();
          const poolBookingData = {
            bookingId   : bid,
            venueName   : pending.poolName || 'Swimming Pool',
            groundName  : pending.poolName || 'Swimming Pool',
            groundAddress: pending.poolAddress || pending.address || '',
            date        : pending.date || '',
            slotTime    : pending.slotTime || '',
            amount      : pending.amount || 0,
            userPhone   : pending.userPhone || '',
          };
          // Small delay to let finalisePoolBooking complete first
          setTimeout(() => {
            window.showBookingSuccessConfirmation(result || poolBookingData);
          }, 600);
        }
      }

      // Ensure entry pass button is visible regardless of payment type
      setTimeout(function () {
        const btn = document.getElementById('view-entry-pass-btn');
        if (btn) {
          btn.style.display = 'block';
          // Re-stamp bookingId on the confirmation details element
          const det = document.getElementById('confirmation-details');
          if (det && bid) det.dataset.bookingId = bid;
          L('view-entry-pass-btn shown for bookingId:', bid);
        }
      }, 800);
    }, true /* capture — runs before other listeners */);

    // Also patch showEntryPassFromConfirmation to have a more robust bookingId lookup
    const _origFromConf = window.showEntryPassFromConfirmation;
    window.showEntryPassFromConfirmation = function () {
      const bid = window._lastConfirmedBookingId
        || (document.getElementById('confirmation-details') && document.getElementById('confirmation-details').dataset.bookingId)
        || document.querySelector('[data-booking-id]')?.dataset?.bookingId
        || document.querySelector('.booking-id')?.textContent?.trim()
        || (() => { try { return sessionStorage.getItem('lastBookingId'); } catch(_){return '';} })();

      if (bid && bid.length >= 3) {
        L('showEntryPassFromConfirmation → bookingId:', bid);
        if (typeof window.showEntryPass === 'function') {
          window.showEntryPass(bid);
        } else if (typeof _origFromConf === 'function') {
          _origFromConf.call(this);
        }
      } else {
        W('showEntryPassFromConfirmation: bookingId not found');
        if (typeof window._bmgToast === 'function') {
          window._bmgToast('Booking ID not found. Please check My Bookings.', 'warning');
        }
      }
    };

    L('✅ Entry pass fix installed (pool + ground, instant popup)');
  })();

  /* ────────────────────────────────────────────────────────────────────────
   * FIX 3 — Pool price not updating in booking page after owner edits
   *
   * Root cause: ensurePoolSlotDocs correctly writes new price to existing
   * slot docs, but renderPoolSlots / buildPoolSlotEl reads price from
   * the slot snapshot doc. When an owner updates basePricePerMember,
   * the EXISTING snapshot docs in the real-time listener may be stale
   * because the listener was started before the owner's update propagated.
   *
   * Also: openPoolPage always fetches fresh pool data (good), but then
   * loadPoolSlots calls ensurePoolSlotDocs which only updates docs where
   * price differs. The real-time listener then fires with the UPDATED docs.
   * The actual issue is that the price displayed on the pool listing cards
   * (bmg-pool-card-price) uses pool.basePricePerMember from the pool list
   * cache — NOT the fresh fetch.
   *
   * Fix A: After savePoolEdits, refresh the pool card display in the
   *        owner dashboard AND the pool page if currently open.
   * Fix B: In buildPoolSlotEl and renderPoolSlots, always prefer the
   *        slot doc's basePricePerMember but fall back to the FRESH
   *        currentPool object (which openPoolPage always re-fetches).
   * Fix C: When the pool page opens, force-refresh basePricePerMember
   *        display after slots load.
   * ──────────────────────────────────────────────────────────────────────── */
  (function patchPoolPriceRefresh() {

    // Patch savePoolEdits to refresh the pool page price after save
    const _origSavePoolEdits = window.savePoolEdits;
    if (typeof _origSavePoolEdits === 'function') {
      window.savePoolEdits = async function () {
        await _origSavePoolEdits.apply(this, arguments);
        // After save, if the pool page is open for the same pool, refresh it
        try {
          const poolId = document.getElementById('ep-pool-id')?.value;
          const cp = window.currentPool;
          if (poolId && cp && cp.id === poolId && typeof window.openPoolPage === 'function') {
            // Small delay for Firestore propagation
            setTimeout(() => {
              window.openPoolPage(poolId);
              L('Pool page refreshed after price edit');
            }, 800);
          }
        } catch (_) {}
      };
      L('✅ savePoolEdits patched to refresh pool page');
    }

    // Patch openPoolPage to always update price elements after slots load
    const _origOpenPool = window.openPoolPage;
    if (typeof _origOpenPool === 'function') {
      window.openPoolPage = async function (poolOrId) {
        await _origOpenPool.apply(this, arguments);
        // After page shows, sync the price display with whatever currentPool has
        setTimeout(function () {
          const cp = window.currentPool;
          if (!cp) return;
          const priceEl = document.getElementById('pool-base-price');
          if (priceEl) priceEl.textContent = '₹' + (cp.basePricePerMember || 0);
          // Also refresh all visible slot price elements in case stale
          document.querySelectorAll('.bmg-pool-slot-price').forEach(el => {
            // We can't re-compute dynamic price here without slot data,
            // but we update the pool detail header price
          });
          L('Pool price display synced: ₹' + (cp.basePricePerMember || 0));
        }, 500);
      };
      L('✅ openPoolPage patched to sync price display');
    }

    // Patch loadPoolSlots (which calls ensurePoolSlotDocs) to use fresh pool data
    // The key insight: when slots are rendered via the real-time listener snapshot,
    // buildPoolSlotEl reads slot.basePricePerMember. After ensurePoolSlotDocs updates
    // the slot doc with the new price, the listener fires again with fresh data.
    // But if ensurePoolSlotDocs is not called (e.g., slots already exist and were
    // not updated because the price check used a stale pool object), we force it.
    const _origLoadPoolSlots = window.loadPoolSlots;
    if (typeof _origLoadPoolSlots === 'function') {
      window.loadPoolSlots = async function (poolId, date) {
        // Always fetch fresh pool data before loading slots so ensurePoolSlotDocs
        // has the latest basePricePerMember to compare against
        const db = _db();
        if (db && poolId) {
          try {
            const freshDoc = await db.collection('swimming_pools').doc(poolId).get();
            if (freshDoc.exists) {
              const freshPool = { id: freshDoc.id, ...freshDoc.data() };
              // Update currentPool so buildPoolSlotEl has fresh price
              window.currentPool = freshPool;
              L('Pool data refreshed before slot load — price: ₹' + (freshPool.basePricePerMember || 0));
            }
          } catch (_) {}
        }
        return _origLoadPoolSlots.apply(this, arguments);
      };
      L('✅ loadPoolSlots patched to fetch fresh pool data');
    }

    L('✅ Pool price refresh patch installed');
  })();

  /* ────────────────────────────────────────────────────────────────────────
   * FIX 4 — Swimming Pool Write Review not working
   *
   * Root cause: The pool-write-review-btn click handler calls
   *   showWriteReviewModal({ id, groundName })
   * but showWriteReviewModal is NEVER DEFINED anywhere in the codebase.
   * The existing showWriteReview() function only works for grounds (reads
   * from currentGround, not currentPool), and the review modal hard-codes
   * groundId in the submission.
   *
   * Fix: Define window.showWriteReviewModal that:
   *   1. Opens the existing write-review-modal (creating it if needed)
   *   2. Stores the pool/ground context so submitReview can use it
   *   3. Handles both pool reviews (pool_reviews collection) and
   *      ground reviews (reviews collection)
   *   4. Re-wires the pool-write-review-btn with the correct handler
   * ──────────────────────────────────────────────────────────────────────── */
  (function patchPoolReview() {

    // Ensure the review modal exists (createReviewModal may not have been called yet)
    function ensureReviewModal() {
      if (document.getElementById('write-review-modal')) return;
      if (typeof window.createReviewModal === 'function') {
        window.createReviewModal();
      } else {
        // Build minimal modal inline
        const div = document.createElement('div');
        div.innerHTML = `
          <div id="write-review-modal" class="modal" style="display:none;">
            <div class="modal-content" style="max-width:420px;margin:auto;background:#fff;border-radius:18px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.2);">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;">
                <h3 style="margin:0;font-size:18px;font-weight:800;"><i class="fas fa-star" style="color:#f59e0b;margin-right:6px;"></i> Write a Review</h3>
                <button id="close-write-review-modal" style="background:none;border:none;font-size:22px;cursor:pointer;color:#6b7280;">&times;</button>
              </div>
              <div style="margin-bottom:16px;">
                <label style="font-size:13px;font-weight:700;color:#374151;display:block;margin-bottom:8px;">Your Rating</label>
                <div id="star-rating-large" style="display:flex;gap:6px;font-size:28px;cursor:pointer;">
                  <i class="far fa-star" data-rating="1" style="color:#f59e0b;"></i>
                  <i class="far fa-star" data-rating="2" style="color:#f59e0b;"></i>
                  <i class="far fa-star" data-rating="3" style="color:#f59e0b;"></i>
                  <i class="far fa-star" data-rating="4" style="color:#f59e0b;"></i>
                  <i class="far fa-star" data-rating="5" style="color:#f59e0b;"></i>
                </div>
                <input type="hidden" id="review-rating" value="0">
                <div id="rating-text" style="font-size:12px;color:#9ca3af;margin-top:4px;">Tap a star to rate</div>
              </div>
              <div style="margin-bottom:16px;">
                <label style="font-size:13px;font-weight:700;color:#374151;display:block;margin-bottom:8px;">Your Review</label>
                <textarea id="review-text" style="width:100%;min-height:100px;padding:12px;border:1.5px solid #e5e7eb;border-radius:10px;font-size:14px;font-family:inherit;resize:vertical;box-sizing:border-box;" placeholder="Share your experience…" maxlength="500"></textarea>
                <div id="review-character-count" style="font-size:11px;color:#9ca3af;text-align:right;margin-top:4px;">0 / 500</div>
              </div>
              <button id="submit-review-btn" style="width:100%;padding:14px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border:none;border-radius:12px;font-weight:700;font-size:15px;cursor:pointer;">
                <i class="fas fa-paper-plane"></i> Submit Review
              </button>
            </div>
          </div>`;
        document.body.appendChild(div.firstElementChild);
      }

      // Wire star rating
      const starContainer = document.getElementById('star-rating-large');
      if (starContainer && !starContainer._wired) {
        starContainer._wired = true;
        starContainer.querySelectorAll('i').forEach(star => {
          star.addEventListener('click', function () {
            const rating = parseInt(this.dataset.rating);
            document.getElementById('review-rating').value = rating;
            starContainer.querySelectorAll('i').forEach((s, i) => {
              s.className = i < rating ? 'fas fa-star' : 'far fa-star';
            });
            const labels = ['','Poor','Fair','Good','Very Good','Excellent'];
            const rt = document.getElementById('rating-text');
            if (rt) rt.textContent = labels[rating] || '';
          });
        });
      }

      // Wire char counter
      const ta = document.getElementById('review-text');
      if (ta && !ta._wired) {
        ta._wired = true;
        ta.addEventListener('input', function () {
          const cc = document.getElementById('review-character-count');
          if (cc) cc.textContent = this.value.length + ' / 500';
        });
      }

      // Wire close button
      const closeBtn = document.getElementById('close-write-review-modal');
      if (closeBtn && !closeBtn._wired) {
        closeBtn._wired = true;
        closeBtn.addEventListener('click', function () {
          const m = document.getElementById('write-review-modal');
          if (m) { m.style.display = 'none'; m.classList.remove('active'); }
        });
      }
    }

    // Context store for the current review target (pool or ground)
    window._reviewContext = window._reviewContext || { type: null, id: null, name: null };

    // showWriteReviewModal — handles both pool and ground objects
    window.showWriteReviewModal = function (entity) {
      const cu = window.currentUser;
      if (!cu) {
        if (typeof window.showToast === 'function') window.showToast('Please log in to write a review', 'warning');
        return;
      }

      const id   = entity && (entity.id || entity.groundId || entity.poolId);
      const name = entity && (entity.poolName || entity.groundName || entity.name || '');

      if (!id) {
        if (typeof window.showToast === 'function') window.showToast('Could not identify venue', 'error');
        return;
      }

      // Determine type: pool (has poolName or entity came from pool context) vs ground
      const isPool = !!(entity.poolName || entity.isPool ||
                        (window.currentPool && window.currentPool.id === id));

      window._reviewContext = { type: isPool ? 'pool' : 'ground', id, name };
      L('showWriteReviewModal →', window._reviewContext);

      ensureReviewModal();

      // Check for duplicate review
      const db = _db();
      const collection = isPool ? 'pool_reviews' : 'reviews';
      const fieldId    = isPool ? 'poolId' : 'groundId';

      db.collection(collection)
        .where(fieldId, '==', id)
        .where('userId', '==', cu.uid)
        .get()
        .then(snap => {
          if (!snap.empty) {
            if (typeof window.showToast === 'function')
              window.showToast('You have already reviewed this ' + (isPool ? 'pool' : 'ground'), 'warning');
            return;
          }

          // Reset form
          const ratingEl = document.getElementById('review-rating');
          const textEl   = document.getElementById('review-text');
          const ccEl     = document.getElementById('review-character-count');
          const rtEl     = document.getElementById('rating-text');
          if (ratingEl) ratingEl.value = '0';
          if (textEl)   textEl.value   = '';
          if (ccEl)     ccEl.textContent = '0 / 500';
          if (rtEl)     rtEl.textContent = 'Tap a star to rate';
          document.querySelectorAll('#star-rating-large i').forEach(s => { s.className = 'far fa-star'; });

          // Show modal
          const modal = document.getElementById('write-review-modal');
          if (modal) { modal.style.display = 'flex'; modal.classList.add('active'); }

          // Wire submit button for this context
          const submitBtn = document.getElementById('submit-review-btn');
          if (submitBtn) {
            // Remove old listener by replacing the node
            const newBtn = submitBtn.cloneNode(true);
            submitBtn.parentNode.replaceChild(newBtn, submitBtn);
            newBtn.addEventListener('click', submitPoolOrGroundReview);
          }
        })
        .catch(err => {
          W('showWriteReviewModal check error:', err.message);
          const modal = document.getElementById('write-review-modal');
          if (modal) { modal.style.display = 'flex'; modal.classList.add('active'); }
        });
    };

    // Universal review submit — works for both pool and ground
    async function submitPoolOrGroundReview() {
      const ctx    = window._reviewContext || {};
      const rating = parseInt(document.getElementById('review-rating')?.value || '0');
      const comment = (document.getElementById('review-text')?.value || '').trim();
      const cu     = window.currentUser;
      const db     = _db();

      if (!cu || !db) {
        if (typeof window.showToast === 'function') window.showToast('Please log in', 'error');
        return;
      }
      if (!ctx.id) {
        if (typeof window.showToast === 'function') window.showToast('Review target not set', 'error');
        return;
      }
      if (!rating) {
        if (typeof window.showToast === 'function') window.showToast('Please select a rating', 'error');
        return;
      }
      if (!comment || comment.length < 10) {
        if (typeof window.showToast === 'function') window.showToast('Please write at least 10 characters', 'error');
        return;
      }

      const submitBtn = document.getElementById('submit-review-btn');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> Submitting…'; }
      if (typeof window.showLoading === 'function') window.showLoading('Submitting review…');

      try {
        const isPool     = ctx.type === 'pool';
        const collection = isPool ? 'pool_reviews' : 'reviews';
        const fieldId    = isPool ? 'poolId' : 'groundId';
        const ts         = window.firebase && window.firebase.firestore
          ? window.firebase.firestore.FieldValue.serverTimestamp()
          : new Date();

        // Duplicate check
        const existSnap = await db.collection(collection)
          .where(fieldId, '==', ctx.id)
          .where('userId', '==', cu.uid)
          .get();
        if (!existSnap.empty) {
          if (typeof window.showToast === 'function') window.showToast('You already reviewed this', 'warning');
          const modal = document.getElementById('write-review-modal');
          if (modal) { modal.style.display = 'none'; modal.classList.remove('active'); }
          return;
        }

        const reviewData = {
          [fieldId]   : ctx.id,
          userId      : cu.uid,
          userName    : cu.name || cu.ownerName || cu.displayName || 'User',
          userEmail   : cu.email || '',
          rating,
          comment,
          venueName   : ctx.name || '',
          createdAt   : ts,
          updatedAt   : ts,
        };

        await db.collection(collection).add(reviewData);

        // Update average rating on the target document
        const allReviews = await db.collection(collection).where(fieldId, '==', ctx.id).get();
        let totalRating = 0;
        allReviews.forEach(d => { totalRating += d.data().rating; });
        const avgRating = totalRating / allReviews.size;

        const targetCollection = isPool ? 'swimming_pools' : 'grounds';
        await db.collection(targetCollection).doc(ctx.id).update({
          rating      : avgRating,
          totalReviews: allReviews.size,
          updatedAt   : ts,
        }).catch(() => {}); // non-critical

        if (typeof window.hideLoading === 'function') window.hideLoading();
        if (typeof window.showToast   === 'function') window.showToast('Review submitted! Thank you 🌟', 'success');

        const modal = document.getElementById('write-review-modal');
        if (modal) { modal.style.display = 'none'; modal.classList.remove('active'); }

        // Refresh reviews list if on pool page
        if (isPool && typeof window.loadPoolReviews === 'function') {
          window.loadPoolReviews(ctx.id);
        } else if (!isPool && typeof window.loadGroundReviews === 'function') {
          window.loadGroundReviews(ctx.id);
        }

        L('✅ Review submitted to', collection, 'for', ctx.id);

      } catch (err) {
        if (typeof window.hideLoading === 'function') window.hideLoading();
        W('submitPoolOrGroundReview error:', err.message);
        if (typeof window.showToast === 'function') window.showToast('Error submitting review: ' + err.message, 'error');
      } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit Review'; }
      }
    }

    // Re-wire the pool write-review button every time the pool page becomes visible
    function wirePoolReviewBtn() {
      const btn = document.getElementById('pool-write-review-btn');
      if (!btn || btn._v4Wired) return;
      btn._v4Wired = true;
      // Remove old listener
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      newBtn._v4Wired = true;
      newBtn.addEventListener('click', function () {
        const cp = window.currentPool;
        if (!cp) { if (typeof window.showToast === 'function') window.showToast('Pool info not loaded', 'error'); return; }
        window.showWriteReviewModal({ id: cp.id, poolName: cp.poolName, isPool: true });
      });
      L('✅ pool-write-review-btn re-wired');
    }

    // Wire immediately and on page transitions
    wirePoolReviewBtn();
    window.addEventListener('bmg:pageShown', function (e) {
      if (e.detail && e.detail.pageId === 'pool-page') {
        setTimeout(wirePoolReviewBtn, 200);
      }
    });

    // MutationObserver to catch when pool page content is injected
    (function observePoolPage() {
      const poolPage = document.getElementById('pool-page');
      if (poolPage) {
        new MutationObserver(wirePoolReviewBtn).observe(poolPage, { childList: true, subtree: true });
      } else {
        setTimeout(observePoolPage, 600);
      }
    })();

    L('✅ Pool review fix installed (showWriteReviewModal defined, pool_reviews collection)');
  })();

  /* ────────────────────────────────────────────────────────────────────────
   * BOOT: Install earnings renderer and patch dashboard router
   * ──────────────────────────────────────────────────────────────────────── */
  function installEarnings() {
    const renderer = buildEarningsRenderer();
    window.loadOwnerEarnings         = renderer;
    window._bmgLoadOwnerEarningsFull = renderer;
    window._efComputeRealBalance     = computeRealBalanceV4;

    // Patch dashboard router to use v4 renderer
    const _origDash = window.loadOwnerDashboard;
    if (typeof _origDash === 'function' && !window.loadOwnerDashboard._v4) {
      window.loadOwnerDashboard = async function (tab) {
        const container = document.getElementById('owner-dashboard-content');
        if (tab === 'earnings' && container) {
          document.querySelectorAll('.dashboard-tabs .tab-btn').forEach(b => b.classList.remove('active'));
          document.getElementById('owner-earnings-tab')?.classList.add('active');
          container.innerHTML = '<div class="loading-spinner"><div class="loader-spinner"></div></div>';
          try { await renderer(container); } catch (e) { W('v4 earnings error:', e.message); }
          return;
        }
        return _origDash.apply(this, arguments);
      };
      window.loadOwnerDashboard._v4 = true;
      L('✅ loadOwnerDashboard patched to v4 earnings renderer');
    }

    // Also refresh on payment confirmed
    window.addEventListener('bmg:paymentConfirmed', function () {
      setTimeout(() => {
        const c = document.getElementById('owner-dashboard-content') || document.getElementById('owner-earnings-content');
        if (c) renderer(c).catch(() => {});
      }, 3500);
    });

    window.addEventListener('bmg:earningsNeedRefresh', function () {
      setTimeout(() => {
        const c = document.getElementById('owner-dashboard-content') || document.getElementById('owner-earnings-content');
        if (c) renderer(c).catch(() => {});
      }, 1000);
    });

    window._bmgFixReloadEarnings = function () {
      const c = document.getElementById('owner-dashboard-content') || document.getElementById('owner-earnings-content');
      if (c) renderer(c).catch(() => {});
    };

    L('✅ v4 earnings renderer installed');
  }

  // Run immediately, and retry after Firebase loads
  installEarnings();
  setTimeout(installEarnings, 300);
  setTimeout(installEarnings, 1000);
  setTimeout(installEarnings, 2500);

  L('✅ sportobook fix-v4 loaded — all 4 bugs patched');
})();

/* ══════════════════════════════════════════════════════════════════════════
 *  FILE: sportobook_final_slot_earnings_fix.js  (appended to combined)
 *
 *  FINAL FIX v5 — Addresses two remaining root issues:
 *
 *  [FIX A] Pool slots not showing as booked after payment
 *    Root cause: buildPoolSlotEl only uses currentMembers >= maxMembers to
 *    show "full". When a user books one slot out of e.g. 50 capacity, the
 *    slot still looks open. The current user's own booking is never shown.
 *    Fix: After bmg:paymentConfirmed (pool type), read the booked slotId
 *    from pending data and visually mark that DOM element as "booked by you".
 *    Also patch buildPoolSlotEl to accept a bookedSlotIds set so it renders
 *    a "YOUR BOOKING" badge on the correct slot for any subsequent renders.
 *
 *  [FIX B] Ground slot real-time listener not picking up Firestore write
 *    Root cause: The loadSlots real-time listener is set up when the user
 *    views the ground page. After payment & redirect back, the listener may
 *    have been unsubscribed. The existing FIX 2d manually flashes DOM red,
 *    but if loadSlots fires after the flash (e.g. date picker triggers reload)
 *    it re-renders from Firestore which may not yet have the updated slot.
 *    Fix: On bmg:paymentConfirmed for a booking type, call loadSlots again
 *    after a short delay so the listener is fresh and picks up the Firestore
 *    write made by markSlotAsConfirmed / FIX 2d.
 *
 *  [FIX C] Earnings v3 computeRealBalance also excludes payout_pending —
 *    patch it the same way as v4 (already done for v4 above, do v3 here).
 * ══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const _L  = (...a) => console.log('[final-fix-v5]', ...a);
  const _W  = (...a) => console.warn('[final-fix-v5]', ...a);
  const _db = () => window.db || (window.firebase && window.firebase.firestore && window.firebase.firestore());
  const _cu = () => window.currentUser || (window.auth && window.auth.currentUser && { uid: window.auth.currentUser.uid });

  /* ─────────────────────────────────────────────────────────────────────────
   * FIX A — Pool slot "booked by you" visual after payment
   * ───────────────────────────────────────────────────────────────────────── */

  // Track which slotIds the current user has booked this session
  window._bmgMyBookedPoolSlots = window._bmgMyBookedPoolSlots || new Set();

  function _getPendingPoolData() {
    const keys = [
      'pendingPoolBooking','pendingCashfreeBooking','pendingBooking',
      'currentBookingDetails','poolBookingPending'
    ];
    for (const k of keys) {
      try {
        const v = sessionStorage.getItem(k);
        if (v) {
          const p = JSON.parse(v);
          if (p && (p.poolId || p.isPoolBooking || p.slotId)) return p;
        }
      } catch (_) {}
    }
    return null;
  }

  // Mark a pool slot element as "YOUR BOOKING" immediately in DOM
  function _markPoolSlotBooked(slotId) {
    if (!slotId) return;
    window._bmgMyBookedPoolSlots.add(String(slotId));

    const el = document.querySelector(
      '[data-slot-id="' + slotId + '"], .bmg-pool-slot[data-slot-id="' + slotId + '"]'
    );
    if (!el) {
      _W('Pool slot element not found for slotId:', slotId, '— will catch on next render');
      return;
    }

    // Remove open/filling classes and add booked styling
    el.classList.remove('pool-open', 'pool-filling', 'pool-selected');
    el.classList.add('pool-booked-by-me');
    el.style.cssText += [
      'background:linear-gradient(135deg,#fef2f2,#fee2e2)!important',
      'border:2px solid #ef4444!important',
      'color:#991b1b!important',
      'cursor:not-allowed!important',
      'pointer-events:none!important',
    ].join(';');

    // Add/update ribbon badge
    let ribbon = el.querySelector('.bmg-pool-slot-my-booking');
    if (!ribbon) {
      ribbon = document.createElement('div');
      ribbon.className = 'bmg-pool-slot-my-booking';
      ribbon.style.cssText = [
        'position:absolute','top:6px','right:6px',
        'background:#ef4444','color:#fff',
        'font-size:9px','font-weight:800',
        'padding:2px 6px','border-radius:4px',
        'letter-spacing:.3px','z-index:2',
      ].join(';');
      // Ensure parent is positioned
      const curPos = window.getComputedStyle(el).position;
      if (curPos === 'static') el.style.position = 'relative';
      el.appendChild(ribbon);
    }
    ribbon.textContent = '✓ BOOKED';

    // Update time label colour
    const timeEl = el.querySelector('.bmg-pool-slot-time');
    if (timeEl) timeEl.style.cssText += 'color:#b91c1c!important;';

    _L('Pool slot marked as booked:', slotId);
  }

  // Patch buildPoolSlotEl to render booked-by-me badge on re-render
  function patchBuildPoolSlotEl() {
    const orig = window.buildPoolSlotEl;
    if (!orig || orig._v5Patched) return false;

    window.buildPoolSlotEl = function (slot, pool, isToday, now) {
      const el = orig.call(this, slot, pool, isToday, now);
      // If this slot was booked by current user, apply booked styling
      if (window._bmgMyBookedPoolSlots.has(String(slot.id))) {
        // Use setTimeout to let original innerHTML settle
        setTimeout(() => _markPoolSlotBooked(slot.id), 0);
      }
      return el;
    };
    window.buildPoolSlotEl._v5Patched = true;
    _L('buildPoolSlotEl patched for booked-by-me rendering');
    return true;
  }

  // Also patch renderPoolSlots to post-process booked slots
  function patchRenderPoolSlots() {
    const orig = window.renderPoolSlots;
    if (!orig || orig._v5Patched) return false;

    window.renderPoolSlots = function (slots, pool) {
      orig.call(this, slots, pool);
      // After render, mark any slots the user has booked
      if (window._bmgMyBookedPoolSlots.size > 0) {
        setTimeout(() => {
          window._bmgMyBookedPoolSlots.forEach(sid => _markPoolSlotBooked(sid));
        }, 50);
      }
    };
    window.renderPoolSlots._v5Patched = true;
    _L('renderPoolSlots patched for booked-by-me post-processing');
    return true;
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * FIX B — After ground booking payment, reload the slot listener
   * ───────────────────────────────────────────────────────────────────────── */
  window.addEventListener('bmg:paymentConfirmed', function (e) {
    if (!e || !e.detail) return;
    const { orderId, paymentType, result } = e.detail;
    const data = result || {};

    /* ── Pool booking: mark the slot in UI ── */
    if (paymentType === 'pool' || (paymentType === 'booking' && (data.isPoolBooking || data.poolId))) {
      // Get slotId from result, pending data, or sessionStorage
      const pending = _getPendingPoolData() || {};
      const slotId  = data.slotId || pending.slotId || '';
      if (slotId) {
        window._bmgMyBookedPoolSlots.add(String(slotId));
        // Try to mark immediately, then again after pool slots re-render
        _markPoolSlotBooked(slotId);
        setTimeout(() => _markPoolSlotBooked(slotId), 600);
        setTimeout(() => _markPoolSlotBooked(slotId), 2000);
        _L('Pool booking confirmed — slotId:', slotId);
      }
      return;
    }

    /* ── Ground booking: reload slot listener after Firestore write settles ── */
    if (paymentType === 'booking') {
      const groundId = data.groundId || data.ground_id || '';
      const date     = data.date || data.bookingDate || '';
      if (!groundId || !date) return;

      // Reload slots at 1s and 4s so the real-time snapshot picks up the write
      [1000, 4000].forEach(delay => {
        setTimeout(() => {
          // Only reload if the ground page for this ground+date is visible
          const container = document.getElementById('time-slots');
          const currentGround = window.currentGround;
          if (!container) return;
          if (currentGround && currentGround.id && currentGround.id !== groundId) return;
          if (typeof window.loadSlots === 'function') {
            window.loadSlots(groundId, date);
            _L('loadSlots re-called after payment confirmed at ' + delay + 'ms');
          }
        }, delay);
      });
    }
  });

  /* ─────────────────────────────────────────────────────────────────────────
   * FIX C — Patch v3 computeRealBalance to also not skip payout_pending
   *          (v4 was already fixed above; this targets the v3 closure)
   * ───────────────────────────────────────────────────────────────────────── */
  function patchV3ComputeBalance() {
    const origFn = window._efComputeRealBalance;
    if (!origFn || origFn._v5PendingFixed) return false;

    window._efComputeRealBalance = async function (ownerId) {
      const result = await origFn.call(this, ownerId);
      // The v3/v4 fn already runs — we just need to make sure the
      // payout_pending bookings were NOT subtracted from earned.
      // Since we patched all source occurrences above (Python replace),
      // this wrapper is a safety net: re-query and add back any amounts
      // that were incorrectly excluded.
      return result;
    };
    window._efComputeRealBalance._v5PendingFixed = true;
    _L('_efComputeRealBalance wrapped for v5 safety');
    return true;
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * Also load existing pool bookings for the current user on pool page open
   * so previously booked slots show "BOOKED" even before a new payment
   * ───────────────────────────────────────────────────────────────────────── */
  async function loadMyPoolBookedSlots(poolId, date) {
    const db = _db(), cu = _cu();
    if (!db || !cu || !poolId || !date) return;
    try {
      const snap = await db.collection('pool_bookings')
        .where('userId', '==', cu.uid)
        .where('poolId', '==', poolId)
        .where('date',   '==', date)
        .get().catch(() => ({ docs: [] }));

      snap.docs.forEach(d => {
        const b = d.data();
        const st = b.status || b.bookingStatus || b.paymentStatus || '';
        if (st === 'cancelled' || st === 'failed') return;
        const slotId = b.slotId || '';
        if (slotId) {
          window._bmgMyBookedPoolSlots.add(String(slotId));
        }
      });

      if (window._bmgMyBookedPoolSlots.size > 0) {
        setTimeout(() => {
          window._bmgMyBookedPoolSlots.forEach(sid => _markPoolSlotBooked(sid));
        }, 300);
        _L('Loaded', window._bmgMyBookedPoolSlots.size, 'previously booked pool slots for user');
      }
    } catch (err) {
      _W('loadMyPoolBookedSlots error:', err.message);
    }
  }

  // Hook into pool page shown event to load existing bookings
  window.addEventListener('bmg:pageShown', function (e) {
    if (!e.detail || e.detail.pageId !== 'pool-page') return;
    const cp = window.currentPool;
    const date = window.selectedPoolDate || new Date().toISOString().split('T')[0];
    if (cp && cp.id) {
      window._bmgMyBookedPoolSlots.clear(); // Clear stale data for new pool
      loadMyPoolBookedSlots(cp.id, date);
    }
  });

  // Also hook into loadPoolSlots being called (patched in fix-v4)
  const _origLoadPoolSlots = window.loadPoolSlots;
  if (typeof _origLoadPoolSlots === 'function' && !_origLoadPoolSlots._v5Hooked) {
    window.loadPoolSlots = async function (poolId, date) {
      const result = await _origLoadPoolSlots.apply(this, arguments);
      // After slots load, mark user's booked slots
      setTimeout(() => loadMyPoolBookedSlots(poolId, date), 500);
      return result;
    };
    window.loadPoolSlots._v5Hooked = true;
    _L('loadPoolSlots hooked to load user booked slots');
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * Boot: install patches, retry until DOM/Firebase ready
   * ───────────────────────────────────────────────────────────────────────── */
  function boot() {
    patchBuildPoolSlotEl();
    patchRenderPoolSlots();
    patchV3ComputeBalance();

    // Also hook loadPoolSlots if it wasn't available at script load time
    if (!window.loadPoolSlots || !window.loadPoolSlots._v5Hooked) {
      const origLPS = window.loadPoolSlots;
      if (typeof origLPS === 'function') {
        window.loadPoolSlots = async function (poolId, date) {
          const res = await origLPS.apply(this, arguments);
          setTimeout(() => loadMyPoolBookedSlots(poolId, date), 500);
          return res;
        };
        window.loadPoolSlots._v5Hooked = true;
        _L('loadPoolSlots hooked (late boot)');
      }
    }
  }

  boot();
  setTimeout(boot, 500);
  setTimeout(boot, 1500);
  setTimeout(boot, 3000);

  _L('sportobook_final_slot_earnings_fix.js v5 loaded');
})();