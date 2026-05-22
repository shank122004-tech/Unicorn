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