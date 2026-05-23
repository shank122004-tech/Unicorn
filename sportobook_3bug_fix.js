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
        let totalEarned = 0;
        bookSnap.docs.forEach(d => {
          const b = d.data();
          // ownerAmount = what owner gets after platform fee
          totalEarned += b.ownerAmount || 0;
        });
        poolSnap.docs.forEach(d => {
          const p = d.data();
          totalEarned += p.ownerAmount || 0;
        });

        // ── Total received (all sources, deduplicated) ────────────
        let totalReceived = 0;
        const receivedItems = [];
        const seenIds = new Set();

        // Source 1: owner_transfers (CEO paid directly)
        transferSnap.docs.forEach(d => {
          if (seenIds.has(d.id)) return;
          seenIds.add(d.id);
          const t = d.data();
          totalReceived += t.amount || 0;
          receivedItems.push({ id: d.id, ...t, _source: 'transfer' });
        });

        // Source 2: owner_payments (legacy)
        ownerPaySnap.docs.forEach(d => {
          if (seenIds.has(d.id)) return;
          seenIds.add(d.id);
          const p = d.data();
          totalReceived += p.amount || 0;
          receivedItems.push({ id: d.id, ...p, _source: 'payment' });
        });

        // Source 3: paid payout_requests
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
        Total earned ${_fmt(totalEarned)} &middot; Received ${_fmt(totalReceived)}
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