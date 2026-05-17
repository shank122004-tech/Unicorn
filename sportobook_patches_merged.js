/**
 * sportobook_patches_merged.js  — MASTER PATCH v2.0
 * ═══════════════════════════════════════════════════════════════════════
 *  Load AFTER app.js and paymentService.js — nothing else needed.
 *
 *  §1  Shared utilities (_SPB)
 *  §2  All CSS
 *  §3  Splash 5-second minimum
 *  §4  Brand BookMyGame → SpörtoBook
 *  §5  Free listing (no ₹499 banner)
 *  §6  Auth: re-wire login/register forms after navigation
 *  §7  canAddGround: full permission check
 *  §8  Profile image fallback
 *  §9  QR scanner gate (owners only)
 *  §10 getUserLocation: full address reverse-geocode
 *  §11 City search
 *  §12 Swipe cards + loadNearbyVenues
 *  §13 User registration (city field, no pre-check)
 *  §14 Add/Edit ground: city + discount field
 *  §15 setupPayButton → startPayment()
 *  §16 CF bypass: stub checkOrderStatus, deduplicate events
 *  §17 cleanupExpiredLocks guard
 *  §18 SLOT SYSTEM: real-time BOOKED (red), loop-safe, 24h grid
 *  §19 QR generator (multi-strategy)
 *  §20 ENTRY PASS: showEntryPass (JSON QR, all fields)
 *  §21 QR VERIFICATION: processVerifiedQRCode (owner scan)
 *  §22 Payment recovery: recoverPaymentSession
 *  §23 Owner earnings dashboard (real data, 90%/80%)
 *  §24 Admin/CEO earnings tab + Mark Payment Done modal
 *  §25 Tournament: confirm entry, QR, My Tournaments
 *  §26 Loading overlay cap + back-button rewire
 *  §27 Upcoming booking banner
 *  §28 Post-payment entry pass button
 *  §29 Main boot
 * ═══════════════════════════════════════════════════════════════════════
 */
'use strict';

/* ═══════════════════════════════════════════════════════════════════
   §1 — SHARED UTILITIES
   ═══════════════════════════════════════════════════════════════════ */
var _SPB = (function () {
  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function toast(msg,type,dur) { if(typeof window.showToast==='function') window.showToast(msg,type||'info',dur||3000); }
  function fmt(v) { return typeof window.formatCurrency==='function' ? window.formatCurrency(v) : '₹'+Number(v||0).toFixed(0); }
  function waitFor(fn,maxMs,iv) { return new Promise(function(res){ var s=Date.now(),id=setInterval(function(){ if(fn()){clearInterval(id);res(true);return;} if(Date.now()-s>(maxMs||8000)){clearInterval(id);res(false);} },iv||150); }); }
  function pick(obj){ for(var i=1;i<arguments.length;i++){var v=obj&&obj[arguments[i]];if(v!==undefined&&v!==null&&v!=='')return v;} return null; }
  function getBookingId(b,fb){return pick(b,'bookingId','orderId','id','paymentId')||fb||'';}
  function getUserName(b){return pick(b,'userName','userDisplayName','name','displayName','playerName','bookedBy')||'—';}
  function getGround(b){return pick(b,'groundName','venueName','facilityName','ground','venue')||'—';}
  function getAddress(b){return pick(b,'groundAddress','venueAddress','address','location','area')||'';}
  function getDate(b){return pick(b,'date','bookingDate','slotDate','day')||'—';}
  function getSlot(b){return pick(b,'slotTime','timeSlot','slot','time','bookedSlot')||'—';}
  function getGroundId(b){return pick(b,'groundId','venueId','facilityId')||'';}
  function merge(p,s){return Object.assign({},s||{},p||{});}
  function normSlotKey(k){k=(k||'').replace(/\s/g,'');if(/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(k))return k;var m=k.match(/^(\d{2})(\d{2})-(\d{2})(\d{2})$/);if(m)return m[1]+':'+m[2]+'-'+m[3]+':'+m[4];return k;}
  function debounce(fn,ms){var t;return function(){var a=arguments,c=this;clearTimeout(t);t=setTimeout(function(){fn.apply(c,a);},ms);};}
  function FS(){return window.firebase&&window.firebase.firestore&&window.firebase.firestore.FieldValue;}
  function persist(booking,orderId){if(!booking)return;if(!booking.bookingId)booking.bookingId=orderId||'';try{if(booking.bookingId)sessionStorage.setItem('spb_lastConfirmedBookingId',booking.bookingId);sessionStorage.setItem('spb_lastConfirmedBooking',JSON.stringify(booking));}catch(_){}}
  function loadCache(id){try{var c=JSON.parse(sessionStorage.getItem('spb_lastConfirmedBooking')||'{}');if(!id||c.bookingId===id||c.orderId===id)return c;}catch(_){}return null;}
  function epRow(label,html,wrap){return '<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:7px 0;border-bottom:1px solid #F8FAFC;font-size:.88rem;"><span style="color:#64748B;white-space:nowrap;min-width:80px;margin-right:12px;">'+label+'</span><span style="font-weight:600;text-align:right;'+(wrap?'word-break:break-word;max-width:240px;':'')+'">'+html+'</span></div>';}
  return {esc,toast,fmt,waitFor,pick,getBookingId,getUserName,getGround,getAddress,getDate,getSlot,getGroundId,merge,normSlotKey,debounce,FS,persist,loadCache,epRow};
})();

/* ═══════════════════════════════════════════════════════════════════
   §2 — ALL CSS
   ═══════════════════════════════════════════════════════════════════ */
(function(){
  ['spb-merged-styles','spb-slot-styles','spb-master-styles','spb-swipe-styles','spb-edit-discount-styles','sportobook-ui-fix-styles','bmg-super-theme','bmg-profile-override-css','bmg-auth-override-css','spb-grid-style'].forEach(function(id){var el=document.getElementById(id);if(el)el.remove();});
  var s=document.createElement('style');s.id='spb-merged-styles';
  s.textContent=`
  .home-content,#home-page .home-content,#home-page main,#bookings-page,#bookings-page .bookings-content,#profile-page,#profile-page .profile-content,#owner-dashboard-page .dashboard-content,.page.active{padding-bottom:calc(80px + env(safe-area-inset-bottom,0px)) !important;}
  #nearby-venues{display:flex !important;flex-direction:row !important;flex-wrap:nowrap !important;grid-template-columns:unset !important;overflow-x:auto !important;overflow-y:hidden !important;scroll-snap-type:x mandatory !important;-webkit-overflow-scrolling:touch !important;gap:14px !important;padding:8px 4px 16px !important;scrollbar-width:none !important;-ms-overflow-style:none !important;}
  #nearby-venues::-webkit-scrollbar{display:none !important;}
  #nearby-venues>*{flex-shrink:0 !important;width:175px !important;min-width:175px !important;max-width:175px !important;scroll-snap-align:start !important;}
  #nearby-venues .spb-empty-state,#nearby-venues .skeleton-loading,#nearby-venues .empty-state,#nearby-venues .loading-spinner{flex:0 0 100% !important;width:100% !important;max-width:100% !important;}
  .spb-gcard{background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.08);cursor:pointer;transition:transform .15s ease,box-shadow .15s ease;width:175px;flex-shrink:0;}
  .spb-gcard:active{transform:scale(.97);}
  .spb-gcard-img{width:100%;height:110px;object-fit:cover;background:linear-gradient(135deg,#4F46E5,#7C3AED);display:flex;align-items:center;justify-content:center;font-size:2.4rem;position:relative;}
  .spb-gcard-discount-badge{position:absolute;top:8px;left:8px;background:#EF4444;color:#fff;font-size:.65rem;font-weight:800;padding:3px 7px;border-radius:6px;}
  .spb-gcard-body{padding:10px 10px 12px;}
  .spb-gcard-name{font-size:.82rem;font-weight:700;color:#1e293b;margin:0 0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .spb-gcard-sport{font-size:.7rem;color:#64748b;margin-bottom:6px;}
  .spb-gcard-price-row{display:flex;align-items:center;gap:6px;margin-bottom:8px;}
  .spb-gcard-price{font-size:.85rem;font-weight:800;color:#1e293b;}
  .spb-gcard-orig{font-size:.7rem;color:#94a3b8;text-decoration:line-through;}
  .spb-book-btn{display:block;width:100%;padding:8px;background:linear-gradient(135deg,#4F46E5,#7C3AED);color:#fff;border:none;border-radius:8px;font-size:.75rem;font-weight:700;cursor:pointer;text-align:center;}
  .time-slot{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:10px 5px !important;border-radius:10px !important;border:2px solid #E2E8F0 !important;cursor:pointer !important;transition:all .18s ease !important;position:relative;background:#fff !important;text-align:center;min-height:62px;font-size:.78rem !important;font-weight:600 !important;user-select:none;}
  .time-slot .spb-icon{font-size:.95rem;line-height:1;}
  .time-slot .spb-time{font-size:.7rem;font-weight:700;line-height:1.2;}
  .time-slot .spb-label{font-size:.58rem;font-weight:600;letter-spacing:.03em;text-transform:uppercase;opacity:.85;}
  .time-slot.available{border-color:#10B981 !important;background:linear-gradient(135deg,#fff,rgba(16,185,129,.06)) !important;color:#065F46 !important;}
  .time-slot.available:hover{background:linear-gradient(135deg,#ECFDF5,#D1FAE5) !important;border-color:#059669 !important;transform:translateY(-3px) !important;box-shadow:0 6px 16px rgba(16,185,129,.25) !important;}
  .time-slot.confirmed,.time-slot.booked{background:linear-gradient(135deg,#FEF2F2,#FEE2E2) !important;border-color:#EF4444 !important;color:#991B1B !important;cursor:not-allowed !important;opacity:1 !important;box-shadow:0 2px 8px rgba(239,68,68,.2) !important;}
  .time-slot.confirmed .spb-time,.time-slot.booked .spb-time{text-decoration:line-through;color:#991B1B;}
  .time-slot.confirmed .spb-icon,.time-slot.booked .spb-icon{color:#EF4444;}
  .time-slot.confirmed .spb-label,.time-slot.booked .spb-label{color:#EF4444;}
  .time-slot.locked,.time-slot.pending{background:linear-gradient(135deg,#FFFBEB,#FEF3C7) !important;border-color:#F59E0B !important;color:#92400E !important;cursor:not-allowed !important;animation:spbPulse 1.8s ease-in-out infinite;}
  @keyframes spbPulse{0%,100%{box-shadow:0 0 0 0 rgba(245,158,11,0);}50%{box-shadow:0 0 0 5px rgba(245,158,11,.2);}}
  .time-slot.past{background:#F1F5F9 !important;border-color:#CBD5E1 !important;color:#94A3B8 !important;cursor:not-allowed !important;opacity:.65 !important;}
  .time-slot.past .spb-time{text-decoration:line-through;}
  .time-slot.closed{background:#F8FAFC !important;border-color:#E2E8F0 !important;color:#94A3B8 !important;cursor:not-allowed !important;opacity:.55 !important;}
  .time-slot.selected{background:linear-gradient(135deg,#4F46E5,#7C3AED) !important;border-color:#4F46E5 !important;color:#fff !important;transform:scale(1.04) !important;box-shadow:0 6px 20px rgba(79,70,229,.35) !important;cursor:pointer !important;}
  .time-slot.selected .spb-icon,.time-slot.selected .spb-time,.time-slot.selected .spb-label{color:#fff !important;opacity:1 !important;}
  .spb-legend{display:flex;flex-wrap:wrap;gap:8px 14px;padding:8px 2px 10px;font-size:.7rem;font-weight:600;color:#475569;}
  .spb-legend-item{display:flex;align-items:center;gap:5px;}
  .spb-legend-dot{width:9px;height:9px;border-radius:50%;border:2px solid;}
  .spb-legend-dot.available{background:#D1FAE5;border-color:#10B981;}
  .spb-legend-dot.booked{background:#FEE2E2;border-color:#EF4444;}
  .spb-legend-dot.pending{background:#FEF3C7;border-color:#F59E0B;}
  .spb-legend-dot.past{background:#E2E8F0;border-color:#94A3B8;}
  #profile-page{background:#f1f5f9 !important;min-height:100vh;}
  #profile-page .profile-header{background:linear-gradient(135deg,#4F46E5 0%,#7C3AED 100%);padding:40px 24px 32px;text-align:center;border-radius:0 0 32px 32px;box-shadow:0 8px 32px rgba(79,70,229,0.25);}
  #profile-image-large{width:88px;height:88px;border-radius:50%;border:4px solid rgba(255,255,255,0.9);box-shadow:0 4px 16px rgba(0,0,0,0.2);object-fit:cover;}
  #change-photo-btn{display:none !important;}
  #profile-page #profile-name{font-size:1.35rem;font-weight:700;color:#fff;margin:0 0 4px;}
  #profile-page #profile-email,#profile-page #profile-phone{font-size:.82rem;color:rgba(255,255,255,.82);margin:2px 0;}
  #profile-page .profile-menu{margin:20px 16px 80px;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.07);}
  #profile-page .menu-item{display:flex;align-items:center;gap:14px;padding:17px 20px;color:#1e293b;text-decoration:none;font-size:.92rem;font-weight:500;border-bottom:1px solid #f1f5f9;transition:background .15s;cursor:pointer;}
  #profile-page .menu-item:last-child{border-bottom:none;}
  #profile-page .menu-item:hover,#profile-page .menu-item:active{background:#f8fafc;}
  #profile-page .menu-item i:first-child{width:34px;height:34px;background:linear-gradient(135deg,#4F46E5,#7C3AED);color:#fff;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:.88rem;flex-shrink:0;}
  #profile-page .menu-item span{flex:1;}
  #profile-page .menu-item i:last-child{color:#94a3b8;font-size:.75rem;}
  #profile-page .menu-item.logout i:first-child{background:linear-gradient(135deg,#ef4444,#dc2626);}
  #profile-page .menu-item.logout{color:#ef4444;}
  .bmg-earnings-card{display:flex !important;align-items:center !important;gap:14px !important;padding:16px 18px !important;background:linear-gradient(135deg,#f0f7ff,#e8f2ff) !important;border:1.5px solid #bfdbfe !important;border-radius:16px !important;margin:0 20px 12px !important;cursor:pointer !important;transition:all .18s ease !important;text-decoration:none !important;}
  .bmg-earnings-icon{width:46px;height:46px;border-radius:12px;background:linear-gradient(135deg,#4F46E5,#7C3AED);display:flex;align-items:center;justify-content:center;color:#fff;font-size:1.3rem;flex-shrink:0;}
  .bmg-earnings-info{flex:1;}
  .bmg-earnings-label{font-size:12px;color:#6b7280;margin-bottom:2px;}
  .bmg-earnings-amount{font-size:1.25rem;font-weight:800;color:#1e40af;}
  .bmg-earn-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px;}
  .bmg-earn-card{background:#fff;border-radius:14px;padding:16px;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.07);}
  .bmg-earn-val{font-size:22px;font-weight:800;color:#10b981;}
  .bmg-earn-lbl{font-size:11px;color:#9ca3af;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-top:4px;}
  .bmg-earn-sub{font-size:11px;color:#6b7280;margin-top:2px;}
  .bmg-earn-table{width:100%;border-collapse:collapse;font-size:12px;background:#fff;border-radius:12px;overflow:hidden;}
  .bmg-earn-table th{background:#f9fafb;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.3px;padding:10px 12px;text-align:left;border-bottom:1px solid #e5e7eb;}
  .bmg-earn-table td{padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#374151;}
  .bmg-earn-table tr:last-child td{border:none;}
  .bmg-earn-section{background:#fff;border-radius:16px;padding:18px;margin-bottom:16px;box-shadow:0 2px 12px rgba(0,0,0,.07);}
  .bmg-earn-section h3{font-size:15px;font-weight:700;color:#111;margin:0 0 14px;display:flex;align-items:center;gap:8px;}
  .bmg-badge-paid{background:#d1fae5;color:#065f46;font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;}
  .bmg-badge-pending{background:#fef3c7;color:#92400e;font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;}
  .bae-banner{background:linear-gradient(135deg,#1e3a5f,#1e40af);color:#fff;border-radius:16px;padding:18px 20px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;}
  .bae-banner-stat{text-align:center;}
  .bae-banner-val{font-size:26px;font-weight:800;}
  .bae-banner-lbl{font-size:11px;opacity:.75;text-transform:uppercase;letter-spacing:.5px;}
  .bae-card{background:#fff;border-radius:16px;padding:18px;margin-bottom:14px;box-shadow:0 2px 12px rgba(0,0,0,.07);border-left:4px solid #10b981;}
  .bae-card-owed{border-left-color:#f59e0b;}
  .bae-card h4{font-size:15px;font-weight:700;color:#111;margin:0 0 12px;display:flex;justify-content:space-between;align-items:center;}
  .bae-row{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151;}
  .bae-row:last-of-type{border:none;}
  .bae-owed-box{background:#fef3c7;border-radius:10px;padding:10px 12px;margin-top:10px;display:flex;justify-content:space-between;align-items:center;}
  .bae-transfer-btn{background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;padding:10px 18px;border-radius:12px;font-size:13px;font-weight:700;cursor:pointer;margin-top:12px;display:flex;align-items:center;gap:6px;}
  .bae-paid-badge{background:#d1fae5;color:#065f46;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;}
  .bae-refresh-btn{background:#f3f4f6;border:none;padding:8px 16px;border-radius:10px;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:6px;font-weight:600;}
  .ep-header{background:linear-gradient(135deg,#1e3a8a,#4F46E5,#7C3AED);padding:22px 20px 18px;color:#fff;display:flex;justify-content:space-between;align-items:center;}
  .ep-logo{display:flex;align-items:center;gap:8px;font-weight:800;font-size:1rem;}
  .ep-badge{background:rgba(255,255,255,.2);padding:4px 12px;border-radius:999px;font-size:.7rem;font-weight:700;letter-spacing:.5px;}
  .ep-validity{display:flex;align-items:center;gap:6px;font-size:.72rem;color:#64748b;justify-content:center;margin-top:10px;}
  .ep-validity-dot{width:7px;height:7px;border-radius:50%;background:#22c55e;animation:epPulse 1.5s infinite;}
  @keyframes epPulse{0%,100%{opacity:1;}50%{opacity:.4;}}
  .auth-container,.auth-page,#login-page,#owner-type-page,#venue-owner-register-page,#plot-owner-register-page{background:linear-gradient(160deg,#1e3a8a 0%,#2563eb 45%,#3b82f6 100%) !important;}
  .auth-header h1,.auth-header p{color:#fff !important;}
  .input-group input:focus{border-color:#4F46E5 !important;box-shadow:0 0 0 3px rgba(79,70,229,.18) !important;}
  #bmg-view-all-btn{display:block;width:calc(100% - 40px);margin:4px 20px 16px;padding:13px;background:linear-gradient(135deg,#4F46E5,#7C3AED);color:#fff;border:none;border-radius:12px;font-size:.9rem;font-weight:700;cursor:pointer;text-align:center;box-shadow:0 4px 14px rgba(79,70,229,.3);}
  #edit-ground-discount{width:100%;padding:12px 16px;border:2px solid #E5E7EB;border-radius:12px;font-size:.9rem;outline:none;transition:border-color .2s;}
  #edit-ground-discount:focus{border-color:#4F46E5;}
  #spb-discount-preview{font-size:.82rem;color:#374151;margin-top:8px;min-height:20px;}
  .spb-avatar{width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#4F46E5,#7C3AED);color:#fff;font-size:.85rem;font-weight:800;display:flex;align-items:center;justify-content:center;cursor:pointer;position:relative;overflow:hidden;border:2px solid rgba(255,255,255,.3);flex-shrink:0;}
  `;
  document.head.appendChild(s);
})();

/* §3 — SPLASH */
(function(){var SPLASH_MIN=5000,at=Date.now(),splash=document.getElementById('splash-screen');if(!splash)return;var _a=splash.classList.add.bind(splash.classList);splash.classList.add=function(){var args=Array.prototype.slice.call(arguments);if(args.indexOf('hide')!==-1){setTimeout(function(){_a.apply(null,args);},Math.max(0,SPLASH_MIN-(Date.now()-at)));return;}_a.apply(null,args);};})();

/* §4 — BRAND */
(function(){var MAP=[['BookMyGame','SpörtoBook'],['bookmygame','sportobook'],['Book My Game','SpörtoBook'],['BOOKMYGAME','SPORTOBOOK']];
function rep(root){var w=document.createTreeWalker(root||document.body,NodeFilter.SHOW_TEXT,null,false);var n;while((n=w.nextNode())){if(!n.nodeValue||!n.nodeValue.includes('Book'))continue;var r=n.nodeValue;MAP.forEach(function(p){r=r.split(p[0]).join(p[1]);});if(r!==n.nodeValue)n.nodeValue=r;}}
function logos(){document.querySelectorAll('.main-header .logo,.main-header h1,.auth-header h1').forEach(function(el){if(el.textContent&&el.textContent.toLowerCase().includes('book'))el.innerHTML='Sp\u00f6rto<span>Book</span>';});}
function run(){rep(document.body);logos();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();
var _t=null;new MutationObserver(function(m){var needs=m.some(function(x){return Array.from(x.addedNodes).some(function(n){return n.textContent&&n.textContent.includes('Book');});});if(!needs)return;clearTimeout(_t);_t=setTimeout(function(){rep(document.body);logos();},60);}).observe(document.documentElement,{childList:true,subtree:true});})();

/* §5 — FREE LISTING */
(function(){var BANNERS=['#owner-reg-payment-banner','#plot-owner-payment-banner','.owner-reg-payment-banner','.payment-required-banner','.pay-owner-fee-btn','#pay-owner-reg-fee-btn','#pay-registration-now','#complete-registration-btn','#owner-verification-status'];var FEE_RE=[/Pay\s*₹\s*\d+\s*Now/gi,/Pay\s*₹\s*(499|5|299)\s*(once)?/gi,/₹\s*(499|5|299)\s*registration fee/gi,/Complete Registration \(₹\d+\)/gi,/Locked \(Pay ₹\d+\)/gi];var _act={};
function hide(){BANNERS.forEach(function(sel){document.querySelectorAll(sel).forEach(function(el){el.style.setProperty('display','none','important');el.setAttribute('aria-hidden','true');});});}
function clean(root){var w=document.createTreeWalker(root||document.body,NodeFilter.SHOW_TEXT,null,false);var n;while((n=w.nextNode())){var v=n.nodeValue;if(!v)continue;var r=v;FEE_RE.forEach(function(re){r=r.replace(re,'Free');});if(r!==v)n.nodeValue=r;}}
async function activate(uid){if(!uid||_act[uid]||!window.db)return;_act[uid]=true;try{var ref=window.db.collection('owners').doc(uid);var snap=await ref.get();if(!snap.exists)return;var d=snap.data()||{};if(d.registrationPaid&&d.registrationVerified)return;await ref.update({registrationPaid:true,registrationVerified:true,registrationAutoApproved:true,registrationAmount:0,updatedAt:_SPB.FS().serverTimestamp()});if(window.currentUser&&window.currentUser.uid===uid){window.currentUser.registrationPaid=true;window.currentUser.registrationVerified=true;}}catch(_){}}
function ensure(){var u=window.currentUser;if(u&&u.role==='owner'){u.registrationPaid=true;u.registrationVerified=true;activate(u.uid);}}
function patchCan(){window.canAddGround=async function(){var u=window.currentUser;if(!u||u.role!=='owner')return false;activate(u.uid);return true;};window.canAddGround._spbFree=true;}
patchCan();
function patchSts(){var _o=window.updateOwnerRegistrationStatus;window.updateOwnerRegistrationStatus=function(){if(typeof _o==='function'){try{_o();}catch(_){}}hide();};}
function boot(){patchCan();patchSts();hide();clean(document.body);}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
document.addEventListener('click',function(e){var btn=e.target&&e.target.closest?e.target.closest('#add-ground-btn,#add-ground-btn-primary,.add-ground-btn'):null;if(btn)ensure();},true);
(function wfb(){if(window.firebase&&typeof window.firebase.auth==='function'){window.firebase.auth().onAuthStateChanged(function(user){if(!user)return;setTimeout(function(){ensure();patchCan();patchSts();hide();clean(document.body);},800);});}else setTimeout(wfb,300);})();
var _obs=new MutationObserver(_SPB.debounce(function(muts){var rel=muts.some(function(m){return Array.from(m.addedNodes).some(function(n){return n.textContent&&/₹\s*\d|pay.*fee|complete registration/i.test(n.textContent);});});if(!rel)return;hide();clean(document.body);ensure();if(!window.canAddGround||!window.canAddGround._spbFree)patchCan();},60));
if(document.body)_obs.observe(document.body,{childList:true,subtree:true});else document.addEventListener('DOMContentLoaded',function(){_obs.observe(document.body,{childList:true,subtree:true});});
window.addEventListener('bmg:pageShown',function(e){if(/owner|dashboard|ground|profile/i.test((e.detail&&e.detail.pageId)||'')){setTimeout(function(){hide();clean(document.body);ensure();if(!window.canAddGround||!window.canAddGround._spbFree)patchCan();},150);}});})();

/* §6 — AUTH RE-WIRE */
(function(){
function ensureAlias(){if(typeof window.handleRegister!=='function'){if(typeof window.handleUserRegister==='function')window.handleRegister=window.handleUserRegister;else setTimeout(ensureAlias,200);}}
ensureAlias();
if(typeof window.initCashfree==='undefined')window.initCashfree=function(){};
function wireForm(id,handler){var el=document.getElementById(id);if(!el||typeof handler!=='function')return null;var f=el.cloneNode(true);el.parentNode.replaceChild(f,el);f.addEventListener('submit',handler);var btn=f.querySelector('[type="submit"],.auth-btn-premium,.register-btn');if(btn)btn.addEventListener('click',function(e){e.preventDefault();f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});return f;}
function rewireLogin(){
  wireForm('login-form',function(e){e.preventDefault();if(typeof window.handleLogin==='function')window.handleLogin(e);});
  wireForm('register-form',function(e){e.preventDefault();var fn=window.handleUserRegister||window.handleRegister;if(typeof fn==='function')fn(e);});
  document.querySelectorAll('#google-signin-btn,#google-signin-btn-register').forEach(function(btn){var f=btn.cloneNode(true);btn.parentNode.replaceChild(f,btn);f.addEventListener('click',function(e){e.preventDefault();if(typeof window.handleGoogleSignIn==='function')window.handleGoogleSignIn(e);});});
  var fp=document.getElementById('forgot-password-link');if(fp){var ff=fp.cloneNode(true);fp.parentNode.replaceChild(ff,fp);ff.addEventListener('click',function(e){e.preventDefault();if(typeof window.handleForgotPassword==='function')window.handleForgotPassword(e);});}
  var ol=document.getElementById('show-owner-register-link');if(ol){var fo=ol.cloneNode(true);ol.parentNode.replaceChild(fo,ol);fo.addEventListener('click',function(e){e.preventDefault();if(typeof window.showOwnerTypeSelection==='function')window.showOwnerTypeSelection();});}
}
function rewireVenue(){wireForm('venue-owner-register-form',function(e){e.preventDefault();if(typeof window.handleVenueOwnerRegister==='function')window.handleVenueOwnerRegister(e);});}
function rewirePlot(){wireForm('plot-owner-register-form',function(e){e.preventDefault();if(typeof window.handlePlotOwnerRegister==='function')window.handlePlotOwnerRegister(e);});}
window.addEventListener('bmg:pageShown',function(e){var pid=e.detail&&e.detail.pageId;if(pid==='login-page')setTimeout(rewireLogin,80);if(pid==='venue-owner-register-page')setTimeout(rewireVenue,80);if(pid==='plot-owner-register-page')setTimeout(rewirePlot,80);});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){setTimeout(rewireLogin,150);setTimeout(rewireVenue,150);setTimeout(rewirePlot,150);});
else{setTimeout(rewireLogin,150);setTimeout(rewireVenue,150);setTimeout(rewirePlot,150);}})();

/* §7 — canAddGround FULL */
(function(){
function patch(){
  if(window.canAddGround&&window.canAddGround._spbFullPatch)return;
  window.canAddGround=async function(){
    var cu=window.currentUser;if(!cu||cu.role!=='owner'){if(typeof window.showToast==='function')window.showToast('Please login as owner','error');return false;}
    try{
      var db=window.db;var doc=await db.collection('owners').doc(cu.uid).get();if(!doc.exists){if(typeof window.showToast==='function')window.showToast('Owner data not found.','error');return false;}
      var owner=doc.data();if(owner.status&&owner.status!=='active'){if(typeof window.showToast==='function')window.showToast('Your account is blocked.','error');return false;}
      var isPaid=owner.registrationPaid===true||owner.isActive===true||owner.paymentDone===true;
      if(!isPaid){var req=true;try{var cfg=await db.collection('system_config').doc('owner_registration').get();if(cfg.exists)req=cfg.data().paymentRequired!==false;}catch(_){}if(req){if(typeof window.showToast==='function')window.showToast('Please complete registration to add grounds.','warning');return false;}else{await db.collection('owners').doc(cu.uid).update({registrationPaid:true,registrationVerified:true,isActive:true,updatedAt:_SPB.FS().serverTimestamp()});cu.registrationPaid=true;cu.registrationVerified=true;}}
      else if(!owner.registrationVerified){try{await db.collection('owners').doc(cu.uid).update({registrationVerified:true,isActive:true,updatedAt:_SPB.FS().serverTimestamp()});}catch(_){}cu.registrationVerified=true;}
      var valid=['venue_owner','plot_owner','VENUE_OWNER','PLOT_OWNER'];if(!valid.includes(owner.ownerType)){if(typeof window.showToast==='function')window.showToast('Your account type does not allow adding grounds.','error');return false;}
      return true;
    }catch(err){console.error('[canAddGround]',err);return false;}
  };window.canAddGround._spbFree=true;window.canAddGround._spbFullPatch=true;
}
_SPB.waitFor(function(){return typeof window.canAddGround==='function';},6000).then(patch);setTimeout(patch,1000);})();

/* §8 — PROFILE IMAGE */
(function(){var LOGO="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'%3E%3Ccircle cx='40' cy='40' r='40' fill='%234F46E5'/%3E%3Ctext x='40' y='50' font-family='Inter,Arial,sans-serif' font-size='30' font-weight='800' fill='white' text-anchor='middle'%3ESB%3C/text%3E%3C/svg%3E";
function fix(){document.querySelectorAll('img').forEach(function(img){if(!img.src||img.src.includes('via.placeholder')||img.src.includes('placeholder.com'))img.src=LOGO;});var h=document.getElementById('header-profile-img');if(h&&(!h.src||h.src.includes('placeholder')))h.src=LOGO;var p=document.getElementById('profile-image-large');if(p&&(!p.src||p.src.includes('placeholder')))p.src=LOGO;var c=document.getElementById('change-photo-btn');if(c)c.style.display='none';}
document.addEventListener('error',function(e){if(e.target&&e.target.tagName==='IMG'&&!e.target.dataset.fbApplied){e.target.dataset.fbApplied='1';e.target.src=LOGO;}},true);
if(document.readyState!=='loading')fix();else document.addEventListener('DOMContentLoaded',fix);
window.addEventListener('bmg:pageShown',fix);})();

/* §9 — QR SCANNER GATE */
(function(){
function sync(){var btn=document.getElementById('header-qr-scanner');if(!btn)return;var cu=window.currentUser;var ok=cu&&(cu.role==='owner'||cu.role==='admin'||cu.role==='ceo');btn.style.display=ok?'flex':'none';btn.style.visibility=ok?'visible':'hidden';}
function patchOpen(){['openProfessionalQRScanner','toggleProfessionalQRScanner'].forEach(function(fn){var o=window[fn];if(typeof o!=='function'||o._spbGated)return;window[fn]=function(){var cu=window.currentUser;if(!cu||(cu.role!=='owner'&&cu.role!=='admin'&&cu.role!=='ceo')){_SPB.toast('Only venue/ground owners can scan QR codes','error');return;}return o.apply(this,arguments);};window[fn]._spbGated=true;});}
window.addEventListener('bmg:pageShown',function(){sync();patchOpen();});setInterval(sync,600);setTimeout(patchOpen,1000);})();

/* §10 — LOCATION */
(function(){
function patch(){if(window.getUserLocation&&window.getUserLocation._spbP)return;
window.getUserLocation=function(){if(!navigator.geolocation){var el=document.getElementById('current-location');if(el)el.textContent='Geolocation not supported';return;}
navigator.geolocation.getCurrentPosition(async function(pos){window.userLocation={lat:pos.coords.latitude,lng:pos.coords.longitude};try{localStorage.setItem('userLocation',JSON.stringify(window.userLocation));}catch(_){}try{var res=await fetch('https://nominatim.openstreetmap.org/reverse?format=json&lat='+window.userLocation.lat+'&lon='+window.userLocation.lng+'&zoom=18&addressdetails=1');var data=await res.json();var parts=[];var a=data.address||{};if(a.road)parts.push(a.road);if(a.suburb&&a.suburb!==a.road)parts.push(a.suburb);var city=a.city||a.town||a.village||'';if(city)parts.push(city);if(a.state&&a.state!==city)parts.push(a.state);var el=document.getElementById('current-location');if(el)el.textContent=parts.join(', ')||'Location detected';}catch(_){var el2=document.getElementById('current-location');if(el2)el2.textContent=window.userLocation.lat.toFixed(4)+', '+window.userLocation.lng.toFixed(4);}if(typeof window.loadNearbyVenues==='function')window.loadNearbyVenues();},function(){var el=document.getElementById('current-location');if(el)el.textContent='Location unavailable';try{var c=localStorage.getItem('userLocation');if(c)window.userLocation=JSON.parse(c);}catch(_){}if(typeof window.loadNearbyVenues==='function')window.loadNearbyVenues();},{enableHighAccuracy:true,timeout:10000,maximumAge:30000});};window.getUserLocation._spbP=true;}
setTimeout(patch,100);})();

/* §11 — CITY SEARCH */
(function(){
function smartSearch(raw){var container=document.getElementById('nearby-venues');if(!container||!window.db)return;var q=raw.toLowerCase();container.innerHTML='<div class="skeleton-loading" style="flex:0 0 100%;"><div class="skeleton-card"></div><div class="skeleton-card"></div></div>';window.db.collection('grounds').where('status','==','active').limit(200).get().then(function(snap){var results=[];snap.forEach(function(doc){var d=Object.assign({id:doc.id,type:'ground'},doc.data());var hay=[d.groundName,d.city,d.cityLower,d.sportType,d.address,d.area].filter(Boolean).join(' ').toLowerCase();if(hay.includes(q))results.push(d);});if(!results.length){container.innerHTML='<div class="spb-empty-state" style="text-align:center;padding:40px;flex:0 0 100%;"><div style="font-size:48px;margin-bottom:12px;">🔍</div><p style="font-weight:700;font-size:16px;color:#444;">No grounds found</p><p style="font-size:13px;color:#888;">Try a different city or sport</p></div>';return;}if(typeof window.displayVenueItems==='function')window.displayVenueItems(container,results);}).catch(function(err){console.error('[spb-search]',err);container.innerHTML='<p style="padding:20px;color:#888;">Search unavailable.</p>';});}
function wire(){var inp=document.getElementById('global-search');if(!inp||inp._spbWired)return;inp._spbWired=true;inp.placeholder='Search city, sport or ground name…';inp.addEventListener('input',_SPB.debounce(function(){var q=inp.value.trim();if(!q){if(typeof window.loadNearbyVenues==='function')window.loadNearbyVenues();return;}smartSearch(q);},350));}
window.filterBySport=function(sport){var inp=document.getElementById('global-search');if(inp){inp.value=sport;inp.dispatchEvent(new Event('input',{bubbles:true}));}};
if(document.readyState!=='loading')wire();else document.addEventListener('DOMContentLoaded',wire);
window.addEventListener('bmg:pageShown',function(e){var pid=(e.detail&&e.detail.pageId)||'';if(!pid||pid==='main-page'||pid==='home-page')setTimeout(wire,100);});})();

/* §12 — SWIPE CARDS + loadNearbyVenues */
(function(){
var EMOJI={football:'⚽',cricket:'🏏',basketball:'🏀',badminton:'🏸',tennis:'🎾',volleyball:'🏐',swimming:'🏊',default:'🏟️'};
function se(s){if(!s)return EMOJI.default;var k=s.toLowerCase().split(/[\s/]/)[0];return EMOJI[k]||EMOJI.default;}
function renderCards(container,items){
  if(!items||!items.length){container.innerHTML='<div class="spb-empty-state" style="text-align:center;padding:40px;flex:0 0 100%;"><i class="fas fa-map-marker-alt" style="font-size:2rem;color:#cbd5e1;margin-bottom:12px;display:block;"></i><h3>No grounds nearby</h3><p style="color:#94a3b8;font-size:13px;">Try searching a different city</p></div>';return;}
  container.innerHTML=items.map(function(item){
    var isG=item.type==='ground'||item.groundName;var name=_SPB.esc(isG?(item.groundName||item.name||'Ground'):(item.venueName||item.name||'Venue'));var sport=_SPB.esc(item.sportType||item.sport||'Multi-sport');var img=(item.images&&item.images[0])||item.imageUrl||item.photo||'';var disc=Number(item.discountPercent||item.discount||0);var orig=Number(item.originalPrice||item.pricePerHour||0);var disp=disc>0?Math.round(orig*(1-disc/100)):orig;var da=isG?'data-ground-id="'+item.id+'"':'data-venue-id="'+item.id+'"';
    return '<div class="spb-gcard" '+da+' data-type="'+item.type+'"><div class="spb-gcard-img">'+(img?'<img src="'+_SPB.esc(img)+'" alt="'+name+'" style="width:100%;height:110px;object-fit:cover;">':'<span style="font-size:2rem;">'+se(item.sportType)+'</span>')+(disc>0?'<div class="spb-gcard-discount-badge">'+disc+'% OFF</div>':'')+'</div><div class="spb-gcard-body"><div class="spb-gcard-name">'+name+'</div><div class="spb-gcard-sport">'+sport+'</div><div class="spb-gcard-price-row">'+(disp?'<span class="spb-gcard-price">₹'+disp+'/hr</span>':'')+(disc>0&&orig?'<span class="spb-gcard-orig">₹'+orig+'</span>':'')+'</div><button class="spb-book-btn">View &amp; Book</button></div></div>';
  }).join('');
  container.querySelectorAll('.spb-gcard[data-ground-id]').forEach(function(c){c.addEventListener('click',function(){if(typeof window.viewGround==='function')window.viewGround(c.dataset.groundId);});});
  container.querySelectorAll('.spb-gcard[data-venue-id]').forEach(function(c){c.addEventListener('click',function(){if(typeof window.viewVenue==='function')window.viewVenue(c.dataset.venueId);});});
  container.querySelectorAll('.spb-book-btn').forEach(function(btn){btn.addEventListener('click',function(e){e.stopPropagation();var c=btn.closest('.spb-gcard');if(!c)return;if(c.dataset.groundId&&typeof window.viewGround==='function')window.viewGround(c.dataset.groundId);else if(c.dataset.venueId&&typeof window.viewVenue==='function')window.viewVenue(c.dataset.venueId);});});
  var isDown=false,startX,sl;container.addEventListener('mousedown',function(e){isDown=true;startX=e.pageX-container.offsetLeft;sl=container.scrollLeft;container.style.cursor='grabbing';});container.addEventListener('mouseleave',function(){isDown=false;container.style.cursor='';});container.addEventListener('mouseup',function(){isDown=false;container.style.cursor='';});container.addEventListener('mousemove',function(e){if(!isDown)return;e.preventDefault();container.scrollLeft=sl-(e.pageX-container.offsetLeft-startX);});
}
window.displayVenueItems=function(container,items){renderCards(container,items);};window.displayVenueItems._spbSwipe=true;
function patchLoad(){
  if(window.loadNearbyVenues&&window.loadNearbyVenues._spbBrand)return;var _orig=window.loadNearbyVenues;
  window.loadNearbyVenues=async function(){
    var container=document.getElementById('nearby-venues');if(!container||!window.db){if(typeof _orig==='function')return _orig();return;}
    container.innerHTML='<div class="skeleton-loading" style="flex:0 0 100%;"><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div></div>';
    try{var C=window.COLLECTIONS||{VENUES:'venues',GROUNDS:'grounds'};var snaps=await Promise.all([window.db.collection(C.VENUES||'venues').where('hidden','==',false).get().catch(function(){return{forEach:function(){},docs:[]};}),window.db.collection(C.GROUNDS||'grounds').where('status','==','active').get().catch(function(){return{forEach:function(){},docs:[]};})]);var all=[];snaps[0].forEach(function(d){all.push(Object.assign({id:d.id,type:'venue'},d.data()));});snaps[1].forEach(function(d){all.push(Object.assign({id:d.id,type:'ground',ownerType:'plot_owner'},d.data()));});renderCards(container,all);}catch(err){console.error('[spb-venues]',err);if(typeof _orig==='function')_orig();else container.innerHTML='<div class="error-state"><p>Failed to load venues</p></div>';}
  };window.loadNearbyVenues._spbBrand=true;
}
_SPB.waitFor(function(){return typeof window.loadNearbyVenues==='function';},6000).then(patchLoad);setTimeout(patchLoad,300);
window.addEventListener('bmg:pageShown',function(e){var pid=(e.detail&&e.detail.pageId)||'';if(!pid||pid==='main-page'||pid==='home-page')setTimeout(patchLoad,100);});})();

/* §13 — USER REGISTRATION */
(function(){
function patch(){
  if(typeof window.handleUserRegister!=='function')return false;if(window.handleUserRegister._spbP)return true;
  window.handleUserRegister=async function pR(e){if(e&&typeof e.preventDefault==='function')e.preventDefault();var name=(document.getElementById('reg-name')?.value||'').trim();var email=(document.getElementById('reg-email')?.value||'').trim();var phone=(document.getElementById('reg-phone')?.value||'').trim();var city=(document.getElementById('reg-city')?.value||'').trim();var pass=document.getElementById('reg-password')?.value||'';var confirm=document.getElementById('reg-confirm-password')?.value||'';var agreed=document.getElementById('reg-agree-terms')?.checked;
    if(!name||!email||!phone||!pass){_SPB.toast('Please fill in all fields','error');return;}if(pass!==confirm){_SPB.toast('Passwords do not match','error');return;}if(pass.length<6){_SPB.toast('Password must be at least 6 characters','error');return;}if(!/^\d{10}$/.test(phone)){_SPB.toast('Please enter a valid 10-digit phone number','error');return;}if(!agreed){_SPB.toast('Please agree to the Terms & Conditions','error');return;}
    if(typeof window.showLoading==='function')window.showLoading('Creating your account…');
    try{var auth=window.auth||(window.firebase&&window.firebase.auth&&window.firebase.auth());var db=window.db;if(!auth||!db)throw new Error('App not initialised yet. Please refresh.');var cred=await auth.createUserWithEmailAndPassword(email,pass);var user=cred.user;var params=new URLSearchParams(window.location.search);var refCode=params.get('ref');var referredBy=null;if(refCode){try{var rs=await db.collection('referrals').where('code','==',refCode).get();if(!rs.empty)referredBy=rs.docs[0].data().ownerId;}catch(_){}}var genCode=typeof window.generateReferralCode==='function'?window.generateReferralCode():'SB'+Math.random().toString(36).substr(2,6).toUpperCase();await db.collection('users').doc(user.uid).set({uid:user.uid,name:name,email:email,phone:phone,city:city||'',cityLower:(city||'').toLowerCase(),profileImage:null,role:'user',referralCode:genCode,referredBy:referredBy,referralCount:0,createdAt:_SPB.FS().serverTimestamp(),updatedAt:_SPB.FS().serverTimestamp()});await user.updateProfile({displayName:name});if(typeof window.hideLoading==='function')window.hideLoading();_SPB.toast('Account created successfully! Welcome to SpörtoBook!','success');}
    catch(err){if(typeof window.hideLoading==='function')window.hideLoading();var msg='Registration failed.';if(err.code==='auth/email-already-in-use')msg='Email already registered. Please login instead.';else if(err.code==='auth/weak-password')msg='Password is too weak.';else if(err.code==='auth/invalid-email')msg='Invalid email address.';else if(err.message)msg=err.message;_SPB.toast(msg,'error');}
  };window.handleUserRegister._spbP=true;window.handleRegister=window.handleUserRegister;
  if(!document.getElementById('reg-city')){var pf=document.querySelector('#reg-phone')&&document.querySelector('#reg-phone').parentElement;if(pf){var div=document.createElement('div');div.id='reg-city-group';div.innerHTML='<label for="reg-city" style="display:block;margin-bottom:8px;font-weight:600;color:var(--text-primary,#1e293b);">City</label><input type="text" id="reg-city" placeholder="Enter your city (e.g. Delhi, Noida)" style="width:100%;padding:12px 16px;border:1px solid var(--border-color,#e2e8f0);border-radius:10px;font-size:1rem;" /><small style="color:#6b7280;display:block;margin-top:4px;">Helps us show grounds in your area</small>';pf.insertAdjacentElement('afterend',div);}}
  return true;
}
_SPB.waitFor(function(){return typeof window.handleUserRegister==='function';},6000).then(patch);setTimeout(patch,2500);})();

/* §14 — ADD/EDIT GROUND */
(function(){
function patchAdd(){if(typeof window.handleAddGround!=='function'||window.handleAddGround._spbP)return;var _o=window.handleAddGround;window.handleAddGround=async function(e){if(e&&e.preventDefault)e.preventDefault();var city=(document.getElementById('ground-city-input')?.value||'').trim();var disc=Math.min(90,Math.max(0,Number(document.getElementById('add-ground-discount')?.value)||0));var col=window.db&&window.db.collection('grounds');if(col){var _oa=col.add.bind(col);col.add=async function(data){col.add=_oa;var p=Number(data.pricePerHour||0);return _oa(Object.assign({},data,{city:city,cityLower:city.toLowerCase(),discountPercent:disc,originalPrice:p,discountedPrice:disc>0?Math.round(p*(1-disc/100)):p}));};}return _o.call(this,e);};window.handleAddGround._spbP=true;}
function patchEdit(){if(typeof window.handleEditGround!=='function'||window.handleEditGround._spbDP)return;var _o=window.handleEditGround;window.handleEditGround=async function(e){if(e&&e.preventDefault)e.preventDefault();var disc=document.getElementById('edit-ground-discount')?Math.min(90,Math.max(0,Number(document.getElementById('edit-ground-discount').value)||0)):null;var price=Number(document.getElementById('edit-ground-price')?.value)||0;if(disc!==null&&window.db&&window._currentEditGroundId){try{await window.db.collection('grounds').doc(window._currentEditGroundId).update({discountPercent:disc,originalPrice:price,discountedPrice:disc>0?Math.round(price*(1-disc/100)):price});}catch(_){}}return _o.call(this,e);};window.handleEditGround._spbDP=true;}
function patchModal(){if(typeof window.showEditGroundModal!=='function'||window.showEditGroundModal._spbDP)return;var _o=window.showEditGroundModal;window.showEditGroundModal=async function(groundId,groundName,currentPrice){window._currentEditGroundId=groundId;await _o.apply(this,arguments);await new Promise(function(r){setTimeout(r,80);});if(document.getElementById('spb-edit-discount-group'))return;var ed=0;if(groundId&&window.db){try{var d=await window.db.collection('grounds').doc(groundId).get();if(d.exists)ed=d.data().discountPercent||0;}catch(_){}}var pf=document.querySelector('#edit-ground-price')?.closest('.form-group');if(pf){var div=document.createElement('div');div.id='spb-edit-discount-group';div.innerHTML='<label style="display:flex;align-items:center;gap:6px;font-size:.85rem;font-weight:600;color:#374151;margin-bottom:8px;"><i class="fas fa-tag"></i> Discount / Offer %</label><input type="number" id="edit-ground-discount" min="0" max="90" step="1" value="'+ed+'" placeholder="0 = no discount"><div id="spb-discount-preview"></div>';pf.insertAdjacentElement('afterend',div);var inp=document.getElementById('edit-ground-discount');if(inp)inp.addEventListener('input',function(){var disc=Math.min(90,Math.max(0,Number(inp.value)||0));var pi=document.getElementById('edit-ground-price');var p=pi?Number(pi.value)||0:Number(currentPrice)||0;var prev=document.getElementById('spb-discount-preview');if(prev)prev.innerHTML=disc>0?'₹'+p+' → <strong>₹'+Math.round(p*(1-disc/100))+'</strong> ('+disc+'% off)':'No discount';});}};window.showEditGroundModal._spbDP=true;}
_SPB.waitFor(function(){return typeof window.handleAddGround==='function';},6000).then(patchAdd);_SPB.waitFor(function(){return typeof window.handleEditGround==='function';},6000).then(patchEdit);_SPB.waitFor(function(){return typeof window.showEditGroundModal==='function';},6000).then(patchModal);setTimeout(function(){patchAdd();patchEdit();patchModal();},2000);})();

/* §15 — setupPayButton */
(function(){
window.setupPayButton=function(bookingDetails){
  var btn=document.getElementById('cashfree-pay-btn');if(!btn){setTimeout(function(){window.setupPayButton(bookingDetails);},200);return;}
  window._currentBookingDetails=bookingDetails;var fresh=btn.cloneNode(true);btn.parentNode.replaceChild(fresh,btn);
  fresh.addEventListener('click',async function(e){e.preventDefault();e.stopPropagation();var details=window._currentBookingDetails;if(!details){_SPB.toast('Booking details missing. Please try again.','error');return;}if(!window.currentUser){_SPB.toast('Please login first','warning');return;}var cu=window.currentUser;details.userName=details.userName||cu.name||cu.displayName||'';details.userEmail=details.userEmail||cu.email||'';details.userPhone=details.userPhone||cu.phone||'';if(typeof window.startPayment==='function')await window.startPayment(details,'booking');else _SPB.toast('Payment service not loaded. Please refresh.','error');});
  fresh.disabled=false;fresh.style.opacity='1';fresh.style.pointerEvents='auto';
};
window.addEventListener('bmg:pageShown',function(e){if(e.detail&&e.detail.pageId==='booking-page'){var d=window._currentBookingDetails;if(d)setTimeout(function(){window.setupPayButton(d);},100);}});})();

/* §16 — CF BYPASS */
(function(){
var CF_BLOCK=['checkOrderStatus'];var _oFetch=window.fetch.bind(window);
window.fetch=function(input,init){var url=typeof input==='string'?input:(input&&input.url||'');if(CF_BLOCK.some(function(p){return url.includes(p);}))return Promise.resolve(new Response(JSON.stringify({status:'PENDING',bypassed:true}),{status:200,headers:{'Content-Type':'application/json'}}));return _oFetch(input,init);};
var _fired=new Set();var _oDispatch=window.dispatchEvent.bind(window);
window.dispatchEvent=function(event){if(event&&event.type==='bmg:paymentConfirmed'){var oid=event.detail&&event.detail.orderId;if(oid){if(_fired.has(oid))return true;_fired.add(oid);setTimeout(function(){_fired.delete(oid);},5*60*1000);}}return _oDispatch(event);};
_SPB.waitFor(function(){return typeof window.showPage==='function';},5000).then(function(){var _o=window.showPage;window.showPage=function(pid){return _o({'my-bookings-page':'bookings-page'}[pid]||pid);};});
if(typeof window.initCashfree==='undefined')window.initCashfree=function(){};})();

/* §17 — cleanupExpiredLocks guard */
(function(){function patch(){var _o=window.cleanupExpiredLocks;window.cleanupExpiredLocks=async function(){var cu=window.currentUser;if(!cu||!cu.uid)return;if(typeof _o==='function'){try{await _o.apply(this,arguments);}catch(e){if(e&&e.code!=='permission-denied')console.error('[LockCleanup]',e);}}};}
if(typeof window.cleanupExpiredLocks==='function')patch();else _SPB.waitFor(function(){return typeof window.cleanupExpiredLocks==='function';},5000).then(patch);})();

/* §18 — SLOT SYSTEM: real-time BOOKED, loop-safe, 24h grid */
(function(){
var ICONS={available:'🟢',confirmed:'🔴',booked:'🔴',locked:'🔒',pending:'🔒',past:'⏳',closed:'🚫',selected:'✅'};
var LABELS={available:'Available',confirmed:'Booked',booked:'Booked',locked:'Processing…',pending:'Processing…',past:'Time Passed',closed:'Closed',selected:'Selected'};
var _slotUnsub=null,_slotBusy=false;
function stopSlot(){if(_slotUnsub){try{_slotUnsub();}catch(_){}_slotUnsub=null;}}
window._bmgClearSlotListeners=stopSlot;

async function lockBooked(groundId,date,slotTime,bookingId,userId){
  if(!groundId||!date||!slotTime||!window.db)return;
  var parts=String(slotTime).split('-').map(function(s){return s.trim();});var startTime=parts[0]||'';var endTime=parts[1]||'';
  try{var slotSnap=await window.db.collection('slots').where('groundId','==',groundId).where('date','==',date).where('startTime','==',startTime).get();var batch=window.db.batch();var FS=_SPB.FS();var sd={status:'booked',bookingId:bookingId||'',bookedBy:userId||'',bookedAt:FS.serverTimestamp(),lockedBy:null,lockExpiresAt:null,lockId:null,updatedAt:FS.serverTimestamp()};
    if(!slotSnap.empty)slotSnap.docs.forEach(function(d){batch.update(d.ref,sd);});else{var ref=window.db.collection('slots').doc();batch.set(ref,Object.assign({groundId:groundId,date:date,startTime:startTime,endTime:endTime,createdAt:FS.serverTimestamp()},sd));}
    var lockSnap=await window.db.collection('slot_locks').where('groundId','==',groundId).where('date','==',date).where('startTime','==',startTime).get().catch(function(){return{docs:[]};});lockSnap.docs.forEach(function(d){batch.delete(d.ref);});await batch.commit();console.log('[spb-slots] ✅ Slot BOOKED:',slotTime,date);}catch(err){console.error('[spb-slots] lockBooked error:',err);}
}
async function releaseSlot(groundId,date,slotTime,lockId){
  if(!groundId||!date||!slotTime||!window.db)return;var startTime=String(slotTime).split('-')[0].trim();
  try{var batch=window.db.batch();var FS=_SPB.FS();var slotSnap=await window.db.collection('slots').where('groundId','==',groundId).where('date','==',date).where('startTime','==',startTime).get();slotSnap.docs.forEach(function(d){var s=d.data();if(s.status==='locked'||s.status==='pending')batch.update(d.ref,{status:'available',lockedBy:null,lockExpiresAt:null,lockId:null,bookingId:null,bookedBy:null,updatedAt:FS.serverTimestamp()});});if(lockId)batch.delete(window.db.collection('slot_locks').doc(lockId));var lockSnap=await window.db.collection('slot_locks').where('groundId','==',groundId).where('date','==',date).where('startTime','==',startTime).get().catch(function(){return{docs:[]};});lockSnap.docs.forEach(function(d){batch.delete(d.ref);});await batch.commit();console.log('[spb-slots] ✅ Slot released:',slotTime,date);}catch(err){console.error('[spb-slots] release error:',err);}
}

window.addEventListener('bmg:paymentConfirmed',async function(e){var det=e.detail||{};if(det.paymentType!=='booking')return;var d=det.result||{};await lockBooked(d.groundId,d.date,d.slotTime,d.bookingId||det.orderId,d.userId||(window.currentUser&&window.currentUser.uid));if(typeof window.loadGroundSlots==='function')setTimeout(function(){window.loadGroundSlots(d.groundId,d.date);},500);});
window.addEventListener('bmg:paymentFailed',async function(e){var d=e.detail||{};var ss=sessionStorage.getItem('slotLock');var info=d;if(ss){try{info=Object.assign({},JSON.parse(ss),info);}catch(_){}}await releaseSlot(info.groundId,info.date,info.slotTime,info.lockId||info.orderId);sessionStorage.removeItem('slotLock');sessionStorage.removeItem('currentBookingDetails');_SPB.toast('Slot has been released. You can try again.','info');});
_SPB.waitFor(function(){return typeof window.releaseSlotLock==='function';},6000).then(function(){var _o=window.releaseSlotLock;if(_o&&_o._spbP)return;window.releaseSlotLock=async function(orderId){if(!orderId)return;try{if(typeof _o==='function')await _o(orderId);}catch(_){}var ss=sessionStorage.getItem('slotLock');if(ss){try{var lock=JSON.parse(ss);await releaseSlot(lock.groundId,lock.date,lock.slotTime,orderId);}catch(_){}}};window.releaseSlotLock._spbP=true;});

function patchLoadSlots(){
  if(typeof window.loadSlots!=='function'||window.loadSlots._spbV4)return;
  if(typeof window._slotUnsubscribe==='function'){try{window._slotUnsubscribe();}catch(_){}}
  window.loadSlots=function(groundId,date){
    var db=window.db;if(!db||!groundId||!date)return;stopSlot();
    var container=document.getElementById('time-slots');if(!container)return;
    container.innerHTML='<div style="grid-column:1/-1;padding:28px;text-align:center;"><div class="loader-spinner"></div><p style="margin-top:10px;color:#64748B;font-size:.82rem;">Loading slots…</p></div>';
    var defaults=[];for(var h=0;h<24;h++){var sh=h.toString().padStart(2,'0');defaults.push(sh+':00-'+(h+1).toString().padStart(2,'0')+':00');}
    function render(statusMap){
      var now=new Date(),currMins=now.getHours()*60+now.getMinutes();var today=now.toISOString().split('T')[0];var isToday=(date===today);var html='';
      defaults.forEach(function(slot){var norm=_SPB.normSlotKey(slot);var st=statusMap[norm]||statusMap[slot]||'available';var sc=st,disabled=false;var startH=parseInt(slot.split(':')[0],10),startM=parseInt((slot.split(':')[1]||'0').split('-')[0],10);if(isToday&&startH*60+startM<=currMins){sc='past';disabled=true;}else if(st!=='available'){disabled=true;}
        html+='<div class="time-slot '+sc+'" data-slot="'+slot+'" data-status="'+(disabled?'disabled':st)+'" data-spb-upgraded="1"'+(!disabled&&sc==='available'?' data-available="true"':'')+'>'+'<span class="spb-icon">'+(ICONS[sc]||'🟢')+'</span>'+'<span class="spb-time">'+slot.replace('-',' – ')+'</span>'+'<span class="spb-label">'+(LABELS[sc]||'Available')+'</span></div>';});
      var wb=_slotBusy;_slotBusy=true;container.innerHTML=html;
      container.querySelectorAll('.time-slot.available').forEach(function(el){el.addEventListener('click',function(){if(typeof window.selectSlot==='function')window.selectSlot(this.dataset.slot);});});
      var sel=window.selectedSlot||(function(){try{return sessionStorage.getItem('selectedSlot');}catch(_){return '';}}());
      if(sel)container.querySelectorAll('.time-slot[data-slot="'+sel+'"]').forEach(function(el){el.classList.remove('available');el.classList.add('selected');el.querySelector('.spb-icon').textContent=ICONS.selected;el.querySelector('.spb-label').textContent=LABELS.selected;});
      var parent=container.parentNode;if(parent){parent.querySelectorAll('.spb-legend,.slot-legend').forEach(function(e){e.remove();});var leg=document.createElement('div');leg.className='spb-legend';leg.innerHTML='<span class="spb-legend-item"><span class="spb-legend-dot available"></span>Available</span><span class="spb-legend-item"><span class="spb-legend-dot booked"></span>Booked</span><span class="spb-legend-item"><span class="spb-legend-dot pending"></span>Processing</span><span class="spb-legend-item"><span class="spb-legend-dot past"></span>Time Passed</span>';parent.insertBefore(leg,container);}
      setTimeout(function(){_slotBusy=wb;},0);
    }
    _slotUnsub=db.collection('slots').where('groundId','==',groundId).where('date','==',date).onSnapshot(function(snap){if(_slotBusy)return;var map={};snap.forEach(function(doc){var d=doc.data();var k1=_SPB.normSlotKey((d.startTime||'')+(d.endTime?'-'+d.endTime:''));var k2=_SPB.normSlotKey(d.slotTime||'');if(k1)map[k1]=d.status||'available';if(k2&&k2!==k1)map[k2]=d.status||'available';});render(map);},function(err){console.error('[spb-slots] snapshot error:',err);});
  };window.loadSlots._spbV4=true;console.log('[spb-slots] ✅ Real-time slot grid active');
}
window.addEventListener('bmg:pageShown',function(e){var pid=(e.detail&&e.detail.pageId)||'';if(pid&&pid!=='ground-detail-page'&&pid!=='booking-page'&&pid!=='ground-page'&&pid!=='slots-page')stopSlot();patchLoadSlots();});
_SPB.waitFor(function(){return typeof window.loadSlots==='function';},6000).then(patchLoadSlots);setTimeout(patchLoadSlots,800);})();

/* §19 — QR GENERATOR */
window._spbGenerateQR=async function(payload){
  function _img(src){var el=document.createElement('img');el.src=src;el.alt='QR Code';el.style.cssText='width:220px;height:220px;display:block;border-radius:10px;';return el;}
  if(typeof window.QRCode==='function'&&typeof window.QRCode.toDataURL==='function'){try{return _img(await window.QRCode.toDataURL(payload,{width:220,margin:2,errorCorrectionLevel:'L'}));}catch(_){}}
  if(typeof window.QRCode==='function'){try{var div=document.createElement('div');div.style.cssText='position:absolute;left:-9999px;top:-9999px;';document.body.appendChild(div);new window.QRCode(div,{text:payload,width:220,height:220,correctLevel:(window.QRCode.CorrectLevel||{}).L||3});await new Promise(function(r){setTimeout(r,200);});var canvas=div.querySelector('canvas'),imgEl=div.querySelector('img');var src=canvas?canvas.toDataURL('image/png'):(imgEl?imgEl.src:'');document.body.removeChild(div);if(src)return _img(src);}catch(_){}}
  try{return _img('https://chart.googleapis.com/chart?cht=qr&chs=220x220&chld=L|2&chl='+encodeURIComponent(payload));}catch(_){}
  if(!window._spbQRLib){try{await new Promise(function(resolve,reject){var s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';s.onload=function(){window._spbQRLib=true;resolve();};s.onerror=reject;document.head.appendChild(s);});if(window.QRCode&&typeof window.QRCode.toDataURL==='function')return _img(await window.QRCode.toDataURL(payload,{width:220,margin:2,errorCorrectionLevel:'L'}));}catch(_){}}
  var box=document.createElement('div');box.style.cssText='width:220px;height:220px;display:flex;flex-direction:column;align-items:center;justify-content:center;border:2px dashed #4F46E5;border-radius:12px;padding:12px;text-align:center;color:#4F46E5;background:#EEF2FF;word-break:break-all;';box.innerHTML='<i class="fas fa-qrcode" style="font-size:2rem;margin-bottom:8px;"></i><strong style="font-size:11px;">QR generation failed</strong><br><span style="font-size:8px;margin-top:4px;">'+_SPB.esc(payload.slice(0,80))+'…</span>';return box;
};

/* §20 — ENTRY PASS */
(function(){
function buildQR(booking,bookingId){var bid=_SPB.getBookingId(booking,bookingId),date=_SPB.getDate(booking),slot=_SPB.getSlot(booking),gid=_SPB.getGroundId(booking);var now=new Date(),vf=new Date(now.getTime()-60000),vt=new Date(now.getTime()+8*3600000);try{var sp=slot.replace(/\s/g,'').split('-');var sP=(sp[0]||'00:00').split(':');var eP=(sp[1]||'01:00').split(':');var base=date!=='—'?new Date(date):new Date();if(isNaN(base))base=new Date();vf=new Date(base);vf.setHours(+sP[0]||0,(+sP[1]||0)-15,0,0);if(vf<now)vf=new Date(now.getTime()-60000);vt=new Date(base);vt.setHours(+eP[0]||0,+eP[1]||0,0,0);vt.setTime(vt.getTime()+3600000);}catch(_){}return JSON.stringify({appId:'BookMyGame',bookingId:bid,groundId:gid,date:date,slotTime:slot,validFrom:vf.toISOString(),validTo:vt.toISOString(),userName:_SPB.getUserName(booking),groundName:_SPB.getGround(booking),v:2});}
function doPatch(){
  if(window.showEntryPass&&window.showEntryPass._spbV4)return true;
  window.showEntryPass=async function(bookingId){
    if(!bookingId){_SPB.toast('Booking ID missing','error');return;}
    if(typeof window.showLoading==='function')window.showLoading('Generating entry pass…');
    try{var db=window.db;if(!db)throw new Error('Database not initialised');var bookingDoc=null,pendingData=null,cached=_SPB.loadCache(bookingId);
      try{var d=await db.collection('bookings').doc(bookingId).get();if(d.exists)bookingDoc=Object.assign({_docId:d.id},d.data());}catch(_){}
      if(!bookingDoc){try{var s1=await db.collection('bookings').where('bookingId','==',bookingId).limit(1).get();if(!s1.empty)bookingDoc=Object.assign({_docId:s1.docs[0].id},s1.docs[0].data());}catch(_){}}
      if(!bookingDoc){try{var s2=await db.collection('bookings').where('orderId','==',bookingId).limit(1).get();if(!s2.empty)bookingDoc=Object.assign({_docId:s2.docs[0].id},s2.docs[0].data());}catch(_){}}
      try{var pp=await db.collection('pending_payments').doc(bookingId).get();if(pp.exists)pendingData=pp.data();}catch(_){}
      var merged=_SPB.merge(bookingDoc||{},_SPB.merge(pendingData||{},cached||{}));if(!merged.bookingId)merged.bookingId=bookingId;
      var status=(merged.bookingStatus||merged.status||merged.paymentStatus||'').toLowerCase();var ok=/confirmed|paid|success/.test(status)||(!bookingDoc&&(pendingData||cached));
      if(!ok){if(typeof window.hideLoading==='function')window.hideLoading();_SPB.toast('Entry pass only for confirmed bookings','warning');return;}
      _SPB.persist(merged,bookingId);
      var bid=_SPB.getBookingId(merged,bookingId),name=_SPB.getUserName(merged),ground=_SPB.getGround(merged),address=_SPB.getAddress(merged),date=_SPB.getDate(merged),slot=_SPB.getSlot(merged),amount=_SPB.fmt(merged.amount||merged.totalAmount||0);
      var vFrom='',vTo='';try{var sp=slot.replace(/\s/g,'').split('-');var toHM=function(t){var a=t.split(':');return{h:+a[0]||0,m:+a[1]||0};};var fmHM=function(h,m){return(h<10?'0':'')+h+':'+(m<10?'0':'')+m;};var ss=toHM(sp[0]||'00:00'),ee=toHM(sp[1]||'01:00');var fh=ss.h,fm=ss.m-15;if(fm<0){fm+=60;fh--;}if(fh<0)fh=0;vFrom=fmHM(fh,fm);vTo=fmHM(ee.h,ee.m);}catch(_){}
      var qrEl=await window._spbGenerateQR(buildQR(merged,bookingId));
      var container=document.getElementById('entry-pass-content');if(!container){var page=document.getElementById('entry-pass-page');if(page){container=document.createElement('div');container.id='entry-pass-content';page.appendChild(container);}else{if(typeof window.hideLoading==='function')window.hideLoading();_SPB.toast('Entry pass page not found','error');return;}}
      var addrRow=address?_SPB.epRow('Address',_SPB.esc(address),true):'';var validityText=vTo?'Valid from '+vFrom+' to '+vTo+' on '+_SPB.esc(date):'Valid on '+_SPB.esc(date);
      container.innerHTML='<div style="max-width:420px;margin:0 auto;border-radius:18px;overflow:hidden;box-shadow:0 8px 32px rgba(79,70,229,.18);"><div class="ep-header"><div class="ep-logo"><i class="fas fa-futbol" style="color:#fff;"></i> Sp\u00f6rtoBook</div><div class="ep-badge">ENTRY PASS</div></div><div style="padding:16px 20px;background:#fff;">'+_SPB.epRow('Booking ID','<code style="font-size:.75rem;word-break:break-all;">'+_SPB.esc(bid)+'</code>')+_SPB.epRow('Name',_SPB.esc(name))+_SPB.epRow('Ground',_SPB.esc(ground))+addrRow+_SPB.epRow('Date',_SPB.esc(date))+_SPB.epRow('Slot',_SPB.esc(slot))+_SPB.epRow('Amount',_SPB.esc(amount))+_SPB.epRow('Status','<span style="color:#16a34a;font-weight:700;">&#10003; CONFIRMED</span>')+'</div><div id="spb-qr-mount" style="display:flex;flex-direction:column;align-items:center;padding:20px 16px 10px;background:#fff;border-top:1px solid #F1F5F9;"></div><div style="text-align:center;padding:6px 16px 16px;background:#fff;font-size:.72rem;color:#64748B;"><i class="fas fa-clock" style="margin-right:4px;"></i>'+validityText+'</div></div><button id="spb-ep-back" style="display:block;width:100%;max-width:420px;margin:14px auto 0;padding:14px;background:linear-gradient(135deg,#4F46E5,#7C3AED);color:#fff;border:none;border-radius:14px;font-size:1rem;font-weight:700;cursor:pointer;">\u2190 Back to Home</button>';
      var mount=document.getElementById('spb-qr-mount');if(mount){mount.appendChild(qrEl);var lbl=document.createElement('p');lbl.style.cssText='font-size:.7rem;color:#94A3B8;margin:6px 0 0;text-align:center;';lbl.textContent='Show to venue staff for scan verification';mount.appendChild(lbl);}
      document.getElementById('spb-ep-back')&&document.getElementById('spb-ep-back').addEventListener('click',function(){if(typeof window.goHome==='function')window.goHome();});
      if(typeof window.hideLoading==='function')window.hideLoading();if(typeof window.showPage==='function')window.showPage('entry-pass-page');
    }catch(err){console.error('[spb-entrypass]',err);if(typeof window.hideLoading==='function')window.hideLoading();_SPB.toast(err.message||'Error generating entry pass','error');}
  };window.showEntryPass._spbV4=true;
  window.showEntryPassFromConfirmation=function(){var el=document.getElementById('confirmation-details');var bid=((el&&el.dataset&&el.dataset.bookingId)||'').trim();if(!bid)bid=sessionStorage.getItem('spb_lastConfirmedBookingId')||'';if(!bid){var c=_SPB.loadCache(null);if(c)bid=c.bookingId||'';}if(bid)window.showEntryPass(bid);else _SPB.toast('Booking not found. Check "My Bookings".','warning');};
  return true;
}
setTimeout(doPatch,500);window.addEventListener('bmg:pageShown',doPatch);})();

/* §21 — QR VERIFICATION (owner scanner) */
(function(){
function doPatch(){
  if(window.processVerifiedQRCode&&window.processVerifiedQRCode._spbV4)return true;var _orig=window.processVerifiedQRCode;
  window._spbShowVerificationResult=function(isSuccess,booking,errorMsg){if(typeof window.showVerificationResult==='function')window.showVerificationResult(isSuccess,booking,errorMsg||'');else _SPB.toast(isSuccess?'✅ Entry verified!':'❌ '+(errorMsg||'Verification failed'),isSuccess?'success':'error');};
  window.processVerifiedQRCode=async function(qrData){
    var db=window.db;if(!db&&typeof _orig==='function')return _orig(qrData);var qrObj=null;
    try{qrObj=JSON.parse(qrData);}catch(_){}
    if(!qrObj&&typeof qrData==='string'&&qrData.startsWith('SPB|')){var parts=qrData.split('|');if(parts.length>=4){var raw=parts[2]||'';var iso=raw.length===8?raw.slice(0,4)+'-'+raw.slice(4,6)+'-'+raw.slice(6,8):raw;var n0=new Date();qrObj={appId:'BookMyGame',bookingId:parts[1]||'',groundId:parts[4]||'',date:iso,slotTime:_SPB.normSlotKey(parts[3]||''),validFrom:new Date(n0.getTime()-60000).toISOString(),validTo:new Date(n0.getTime()+8*3600000).toISOString(),_fromToken:true};}}
    if(!qrObj&&typeof qrData==='string'&&qrData.startsWith('BMG|')){var bparts=qrData.split('|');if(bparts.length>=2){var n1=new Date();qrObj={appId:'BookMyGame',bookingId:bparts[1]||'',_fromToken:true,validFrom:new Date(n1.getTime()-60000).toISOString(),validTo:new Date(n1.getTime()+8*3600000).toISOString()};}}
    if(qrObj&&qrObj.appId&&qrObj.appId!=='BookMyGame')qrObj.appId='BookMyGame';
    if(!qrObj||!qrObj.bookingId){if(typeof _orig==='function')return _orig(qrData);return;}
    // Tournament QR
    if(qrObj.type==='tournament'){var regId=qrObj.registrationId||qrObj.bookingId;try{var eDoc=await db.collection('tournament_entries').doc(regId).get();if(!eDoc.exists){window._spbShowVerificationResult(false,null,'Tournament entry not found.');return;}var entry=eDoc.data();if(entry.status!=='confirmed'){window._spbShowVerificationResult(false,null,'Entry not confirmed. Status: '+entry.status);return;}if(entry.entryUsed){window._spbShowVerificationResult(false,null,'Entry already used at '+(entry.entryUsedAt&&entry.entryUsedAt.toDate?entry.entryUsedAt.toDate().toLocaleString('en-IN'):'earlier'));return;}await db.collection('tournament_entries').doc(regId).update({entryUsed:true,entryUsedAt:_SPB.FS().serverTimestamp(),verifiedBy:(window.currentUser&&window.currentUser.uid)||''});window._spbShowVerificationResult(true,entry);}catch(err){window._spbShowVerificationResult(false,null,'Error: '+err.message);}return;}
    // Ground booking QR
    var booking=null,bookingRef=null;
    try{var r1=await db.collection('bookings').where('bookingId','==',qrObj.bookingId).limit(1).get();if(!r1.empty){booking=r1.docs[0].data();bookingRef=r1.docs[0].ref;}}catch(_){}
    if(!booking){try{var r2=await db.collection('bookings').where('orderId','==',qrObj.bookingId).limit(1).get();if(!r2.empty){booking=r2.docs[0].data();bookingRef=r2.docs[0].ref;}}catch(_){}}
    if(!booking){try{var dd=await db.collection('bookings').doc(qrObj.bookingId).get();if(dd.exists){booking=dd.data();bookingRef=dd.ref;}}catch(_){}}
    if(!booking){window._spbShowVerificationResult(false,null,'Booking not found. Ask customer to check "My Bookings".');return;}
    var cu=window.currentUser;if(!cu){window._spbShowVerificationResult(false,null,'You must be logged in as an owner to verify');return;}
    try{var gDoc=await db.collection('grounds').doc(booking.groundId).get();if(!gDoc.exists){window._spbShowVerificationResult(false,null,'Ground not found in system');return;}if(gDoc.data().ownerId!==cu.uid){window._spbShowVerificationResult(false,null,'You can only verify bookings for your own grounds');return;}}catch(_){}
    if(booking.entryStatus==='used'){window._spbShowVerificationResult(false,null,'This entry pass has already been used');return;}
    var bStatus=(booking.bookingStatus||booking.status||'').toLowerCase();if(!/confirmed|paid|payment_confirmed|completed/.test(bStatus)){window._spbShowVerificationResult(false,null,'Booking is not confirmed. Status: '+(booking.bookingStatus||'unknown'));return;}
    var today=new Date().toISOString().split('T')[0];var bookDate=booking.date||qrObj.date||'';if(bookDate&&bookDate!==today){window._spbShowVerificationResult(false,null,'This booking is for '+bookDate+'. Today is '+today+'.');return;}
    try{var slotStr=booking.slotTime||qrObj.slotTime||'';var sp=slotStr.replace(/\s/g,'').split('-');var startP=(sp[0]||'').split(':');var endP=(sp[1]||'').split(':');var nowD=new Date();var eOpen=new Date();eOpen.setHours(+startP[0]||0,(+startP[1]||0)-15,0,0);var eClose=new Date();eClose.setHours(+endP[0]||0,+endP[1]||0,0,0);eClose.setTime(eClose.getTime()+30*60000);if(nowD<eOpen){window._spbShowVerificationResult(false,null,'Entry opens at '+eOpen.toLocaleTimeString()+'. Wait '+Math.ceil((eOpen-nowD)/60000)+' min.');return;}if(nowD>eClose){window._spbShowVerificationResult(false,null,'Entry window closed at '+eClose.toLocaleTimeString());return;}}catch(_){}
    try{await bookingRef.update({entryStatus:'used',entryTime:_SPB.FS().serverTimestamp(),verifiedBy:cu.uid,verifiedByName:cu.ownerName||cu.name||'',verifiedAt:_SPB.FS().serverTimestamp(),updatedAt:_SPB.FS().serverTimestamp()});try{await db.collection('grounds').doc(booking.groundId).update({lastVerifiedAt:_SPB.FS().serverTimestamp(),totalEntriesVerified:_SPB.FS().increment(1)});}catch(_){}}catch(e){console.warn('[spb-verify] update error (non-fatal):',e);}
    window._spbShowVerificationResult(true,booking);
  };window.processVerifiedQRCode._spbV4=true;return true;
}
setTimeout(doPatch,500);window.addEventListener('bmg:pageShown',doPatch);})();

/* §22 — PAYMENT RECOVERY */
(function(){
async function markSlotConfirmed(booking,orderId){var db=window.db;if(!db)return;var gid=booking.groundId||'',date=booking.date||'',slotTime=booking.slotTime||'';if(!gid||!date||!slotTime)return;var startTime=slotTime.replace(/\s/g,'').split('-')[0]||'';var endTime=slotTime.replace(/\s/g,'').split('-')[1]||'';try{var snap=await db.collection('slots').where('groundId','==',gid).where('date','==',date).where('startTime','==',startTime).limit(1).get();var sd={status:'booked',bookingId:orderId,updatedAt:_SPB.FS().serverTimestamp()};if(!snap.empty)await snap.docs[0].ref.update(sd);else await db.collection('slots').add(Object.assign({groundId:gid,date:date,startTime:startTime,endTime:endTime,createdAt:_SPB.FS().serverTimestamp()},sd));}catch(_){}}
window.recoverPaymentSession=async function(orderId,paymentType,paymentData){
  if(!orderId)return;var db=window.db;if(!db)return;var pendingData=null;try{var pp=await db.collection('pending_payments').doc(orderId).get();if(pp.exists)pendingData=pp.data();}catch(_){}
  function succeed(bookingDoc){var merged=_SPB.merge(bookingDoc||{},pendingData||{});if(!merged.bookingId)merged.bookingId=orderId;_SPB.persist(merged,orderId);markSlotConfirmed(merged,orderId);window.dispatchEvent(new CustomEvent('bmg:paymentConfirmed',{detail:{orderId:orderId,paymentType:paymentType||'booking',result:merged}}));try{sessionStorage.removeItem('slotLock');sessionStorage.removeItem('bmg_recoverOrderId');sessionStorage.removeItem('bmg_recoverPayType');}catch(_){}if(typeof window.hideLoading==='function')window.hideLoading();}
  if(typeof window.showLoading==='function')window.showLoading('Verifying payment…');var attempts=0;
  async function poll(){attempts++;try{var fail=await db.collection('failed_payments').doc(orderId).get();if(fail.exists){if(typeof window.hideLoading==='function')window.hideLoading();_SPB.toast('Payment failed. Slot released.','error');return;}}catch(_){}
    if(!paymentType||paymentType==='booking'){try{var s1=await db.collection('bookings').where('bookingId','==',orderId).limit(1).get();if(!s1.empty){succeed(s1.docs[0].data());return;}}catch(_){}try{var s2=await db.collection('bookings').where('orderId','==',orderId).limit(1).get();if(!s2.empty){succeed(s2.docs[0].data());return;}}catch(_){}try{var dd=await db.collection('bookings').doc(orderId).get();if(dd.exists){succeed(dd.data());return;}}catch(_){}}
    if(attempts<25){setTimeout(poll,3000);return;}if(pendingData&&/paid|confirmed|success/.test(pendingData.status||'')){succeed(pendingData);return;}if(typeof window.hideLoading==='function')window.hideLoading();_SPB.toast('Payment status unknown. Check "My Bookings".','warning');}
  poll();
};window.recoverPaymentSession._spbV4=true;
window.addEventListener('bmg:paymentConfirmed',async function(e){if(e._spbEnriched)return;var detail=e.detail||{};if(detail.paymentType!=='booking')return;var result=detail.result||{},orderId=detail.orderId,db=window.db;if(result.groundName&&result.slotTime&&result.userName){_SPB.persist(result,orderId);return;}if(!db)return;var pd=null;try{var pp=await db.collection('pending_payments').doc(orderId).get();if(pp.exists)pd=pp.data();}catch(_){}var enriched=_SPB.merge(result,pd||{});if(!enriched.bookingId)enriched.bookingId=orderId;detail.result=enriched;e._spbEnriched=true;_SPB.persist(enriched,orderId);},true);
function patchSuccess(){if(typeof window.showBookingSuccessConfirmation!=='function'||window.showBookingSuccessConfirmation._spbV4)return;var _o=window.showBookingSuccessConfirmation;window.showBookingSuccessConfirmation=function(booking){if(!booking)booking={};if(!(booking.groundName&&booking.slotTime)){var c=_SPB.loadCache(booking.bookingId||booking.orderId);if(c)booking=_SPB.merge(booking,c);}if(!booking.bookingId)booking.bookingId=sessionStorage.getItem('spb_lastConfirmedBookingId')||'';_SPB.persist(booking,booking.bookingId);return _o(booking);};window.showBookingSuccessConfirmation._spbV4=true;}
_SPB.waitFor(function(){return typeof window.showBookingSuccessConfirmation==='function';},5000).then(patchSuccess);setTimeout(patchSuccess,2000);
window.addEventListener('bmg:pageShown',function(e){var pid=(e&&e.detail&&e.detail.pageId)||'';if(!/home|ground|slot/i.test(pid))return;var lastId='';try{lastId=sessionStorage.getItem('spb_lastConfirmedBookingId')||'';}catch(_){}if(!lastId)return;try{if(sessionStorage.getItem('spb_shown_'+lastId))return;sessionStorage.setItem('spb_shown_'+lastId,'1');}catch(_){}var cached=_SPB.loadCache(lastId);if(!cached||!cached.bookingId)return;setTimeout(function(){if(typeof window.showBookingSuccessConfirmation==='function')window.showBookingSuccessConfirmation(cached);},500);});
if(window.location.search.includes('payment_return')){var oid=(new URLSearchParams(window.location.search)).get('order_id')||(function(){try{return sessionStorage.getItem('bmg_recoverOrderId');}catch(_){return null;}})();var pt=(function(){try{return sessionStorage.getItem('bmg_recoverPayType')||'booking';}catch(_){return'booking';}})();if(oid)(function _try(){if(window.recoverPaymentSession&&window.db&&window.currentUser)window.recoverPaymentSession(oid,pt,{});else setTimeout(_try,600);})();}})();

/* §23 — OWNER EARNINGS DASHBOARD */
(function(){
window._bmgLoadOwnerEarningsFull=async function(container){
  if(!container)container=document.getElementById('earnings-container')||document.querySelector('.earnings-content');
  if(!container)return;var db=window.db,cu=window.currentUser;
  if(!db||!cu){container.innerHTML='<p style="text-align:center;color:#9ca3af;padding:32px;">Please log in</p>';return;}
  container.innerHTML='<div style="text-align:center;padding:32px;"><div class="loader-spinner"></div><p style="color:#6b7280;margin-top:12px;font-size:14px;">Loading earnings…</p></div>';
  try{
    var bookSnap=await db.collection('bookings').where('ownerId','==',cu.uid).where('bookingStatus','==','confirmed').orderBy('createdAt','desc').get().catch(function(){return db.collection('bookings').where('ownerId','==',cu.uid).get();});
    var totalBook=0,bookCount=0,bookRows=[];
    bookSnap.forEach(function(doc){var b=doc.data();var full=Number(b.amount||b.totalAmount||0);var plat=Number(b.commission||b.platformFee||Math.round(full*0.10));var ownerAmt=full-plat;if(ownerAmt<=0)return;totalBook+=ownerAmt;bookCount++;bookRows.push({date:b.date||'',ground:b.groundName||b.venueName||'—',slot:b.slotTime||'',fullAmt:full,platFee:plat,ownerAmt:ownerAmt,status:b.payoutStatus||'pending'});});
    var ownTournSnap=await db.collection('tournaments').where('ownerId','==',cu.uid).get().catch(function(){return{docs:[]};});
    var tournIds=ownTournSnap.docs.map(function(d){return d.id;}).filter(Boolean);
    var totalTourn=0,tournCount=0,tournRows=[];
    if(tournIds.length>0){for(var i=0;i<tournIds.length;i+=10){var chunk=tournIds.slice(i,i+10);var tSnap=await db.collection('tournament_entries').where('tournamentId','in',chunk).where('status','==','confirmed').get().catch(function(){return{docs:[]};});tSnap.docs.forEach(function(doc){var e=doc.data();var fee=Number(e.amount||e.entryFee||0);var plat=Number(e.platformFee||Math.round(fee*0.20));var ownerAmt=fee-plat;if(ownerAmt<=0)return;totalTourn+=ownerAmt;tournCount++;tournRows.push({date:e.date||'',tournament:e.tournamentName||'—',team:e.teamName||'—',entryFee:fee,platFee:plat,ownerAmt:ownerAmt});});}}
    var opSnap=await db.collection('owner_payments').where('ownerId','==',cu.uid).where('status','==','paid').orderBy('paidAt','desc').get().catch(function(){return{docs:[]};});
    var prSnap=await db.collection('payout_requests').where('ownerId','==',cu.uid).where('status','==','paid').get().catch(function(){return{docs:[]};});
    var totalTransfers=0,transferRows=[],seenT=new Set();
    opSnap.docs.forEach(function(doc){seenT.add(doc.id);var t=doc.data();totalTransfers+=Number(t.amount||0);transferRows.push({amount:Number(t.amount||0),note:t.note||t.description||'Admin Transfer',paidAt:t.paidAt&&t.paidAt.toDate?t.paidAt.toDate().toLocaleDateString('en-IN'):'',paidBy:t.paidByName||t.adminName||'Admin'});});
    prSnap.docs.forEach(function(doc){if(seenT.has(doc.id))return;var t=doc.data();totalTransfers+=Number(t.amount||0);transferRows.push({amount:Number(t.amount||0),note:t.note||t.description||'Admin Transfer',paidAt:t.paidAt&&t.paidAt.toDate?t.paidAt.toDate().toLocaleDateString('en-IN'):'',paidBy:t.paidByName||t.adminName||'Admin'});});
    var grandTotal=totalBook+totalTourn+totalTransfers;var fmt=_SPB.fmt;
    container.innerHTML='<div class="bmg-earn-grid">'
      +'<div class="bmg-earn-card" style="border-top:3px solid #10b981;"><div class="bmg-earn-val">'+fmt(grandTotal)+'</div><div class="bmg-earn-lbl">Total Earnings</div><div class="bmg-earn-sub">All sources</div></div>'
      +'<div class="bmg-earn-card" style="border-top:3px solid #3b82f6;"><div class="bmg-earn-val" style="color:#3b82f6;">'+fmt(totalBook)+'</div><div class="bmg-earn-lbl">Ground Bookings</div><div class="bmg-earn-sub">'+bookCount+' booking'+(bookCount!==1?'s':'')+' · 90%</div></div>'
      +'<div class="bmg-earn-card" style="border-top:3px solid #8b5cf6;"><div class="bmg-earn-val" style="color:#8b5cf6;">'+fmt(totalTourn)+'</div><div class="bmg-earn-lbl">Tournaments</div><div class="bmg-earn-sub">'+tournCount+' entr'+(tournCount!==1?'ies':'y')+' · 80%</div></div>'
      +'<div class="bmg-earn-card" style="border-top:3px solid #f59e0b;"><div class="bmg-earn-val" style="color:#f59e0b;">'+fmt(totalTransfers)+'</div><div class="bmg-earn-lbl">Received Transfers</div><div class="bmg-earn-sub">'+transferRows.length+' payment'+(transferRows.length!==1?'s':'')+'</div></div>'
      +'</div>'
      +'<div style="background:linear-gradient(135deg,#eff6ff,#dbeafe);border-radius:12px;padding:12px 16px;margin-bottom:16px;font-size:12px;color:#1e40af;display:flex;align-items:center;gap:10px;"><i class="fas fa-info-circle"></i><span><strong>Commission:</strong> Ground bookings — you earn <strong>90%</strong> (10% platform fee) · Tournaments — you earn <strong>80%</strong> (20% platform fee)</span></div>'
      +'<div class="bmg-earn-section"><h3><i class="fas fa-football-ball" style="color:#3b82f6;"></i> Ground Booking Earnings</h3>'
      +(bookRows.length===0?'<p style="text-align:center;color:#9ca3af;padding:20px 0;">No confirmed bookings yet</p>':'<div style="overflow-x:auto;"><table class="bmg-earn-table"><thead><tr><th>Date</th><th>Ground</th><th>Slot</th><th>Total</th><th>Platform</th><th>Your Share</th><th>Status</th></tr></thead><tbody>'
        +bookRows.map(function(r){return'<tr><td>'+r.date+'</td><td>'+r.ground+'</td><td>'+r.slot+'</td><td>'+fmt(r.fullAmt)+'</td><td style="color:#ef4444;">-'+fmt(r.platFee)+'</td><td style="color:#10b981;font-weight:700;">'+fmt(r.ownerAmt)+'</td><td><span class="'+(r.status==='payout_done'?'bmg-badge-paid':'bmg-badge-pending')+'">'+(r.status==='payout_done'?'Paid':'Pending')+'</span></td></tr>';}).join('')
        +'</tbody></table></div>')
      +'</div>'
      +'<div class="bmg-earn-section"><h3><i class="fas fa-trophy" style="color:#8b5cf6;"></i> Tournament Earnings</h3>'
      +(tournRows.length===0?'<p style="text-align:center;color:#9ca3af;padding:20px 0;">No tournament earnings yet</p>':'<div style="overflow-x:auto;"><table class="bmg-earn-table"><thead><tr><th>Tournament</th><th>Team</th><th>Date</th><th>Entry Fee</th><th>Platform</th><th>Your Share</th></tr></thead><tbody>'
        +tournRows.map(function(r){return'<tr><td>'+r.tournament+'</td><td>'+r.team+'</td><td>'+r.date+'</td><td>'+fmt(r.entryFee)+'</td><td style="color:#ef4444;">-'+fmt(r.platFee)+'</td><td style="color:#10b981;font-weight:700;">'+fmt(r.ownerAmt)+'</td></tr>';}).join('')
        +'</tbody></table></div>')
      +'</div>'
      +'<div class="bmg-earn-section"><h3><i class="fas fa-exchange-alt" style="color:#f59e0b;"></i> Received from Admin / CEO</h3>'
      +(transferRows.length===0?'<p style="text-align:center;color:#9ca3af;padding:20px 0;">No transfers received yet</p>':'<div style="overflow-x:auto;"><table class="bmg-earn-table"><thead><tr><th>Date</th><th>From</th><th>Note</th><th>Amount</th></tr></thead><tbody>'
        +transferRows.map(function(r){return'<tr><td>'+r.paidAt+'</td><td>'+r.paidBy+'</td><td>'+r.note+'</td><td style="color:#10b981;font-weight:700;">'+fmt(r.amount)+' <span class="bmg-badge-paid">PAID</span></td></tr>';}).join('')
        +'</tbody></table></div>')
      +'</div>';
  }catch(err){console.error('[spb-owner-earnings]',err);container.innerHTML='<p style="text-align:center;color:#ef4444;padding:32px;">Failed to load earnings. Please try again.</p>';}
};
window.loadOwnerEarnings=window._bmgLoadOwnerEarningsFull;

function injectEarningsCard(){
  var cu=window.currentUser;if(!cu||cu.role!=='owner'){var ec=document.getElementById('bmg-earnings-card');if(ec)ec.remove();return;}
  if(document.getElementById('bmg-earnings-card'))return;
  var pm=document.querySelector('.profile-menu');if(!pm)return;
  var card=document.createElement('a');card.id='bmg-earnings-card';card.href='#';card.className='bmg-earnings-card';
  card.innerHTML='<div class="bmg-earnings-icon"><i class="fas fa-wallet"></i></div><div class="bmg-earnings-info"><div class="bmg-earnings-label">Total Earnings</div><div class="bmg-earnings-amount" id="spb-earn-amt">Loading…</div></div><i class="fas fa-chevron-right" style="color:#93c5fd;font-size:1rem;"></i>';
  card.addEventListener('click',function(e){e.preventDefault();if(typeof window.showOwnerDashboard==='function'){window.showOwnerDashboard();setTimeout(function(){var t=document.getElementById('owner-earnings-tab');if(t)t.click();},400);}else if(typeof window.showPage==='function')window.showPage('owner-dashboard-page');});
  pm.insertAdjacentElement('beforebegin',card);
  if(window.db&&cu.uid)window.db.collection('owners').doc(cu.uid).get().then(function(d){if(!d.exists)return;var t=d.data().totalEarnings||d.data().earnings||0;var el=document.getElementById('spb-earn-amt');if(el)el.textContent=_SPB.fmt(t);}).catch(console.warn);
}
window.addEventListener('bmg:pageShown',function(e){if(e.detail&&e.detail.pageId==='profile-page')setTimeout(injectEarningsCard,200);});
})();

/* §24 — ADMIN / CEO EARNINGS TAB */
(function(){
var ATAB='admin-owner-earnings-tab',ACONT='admin-dashboard-content';
var CTAB='ceo-owner-earnings-tab',CCONT='ceo-dashboard-content';

async function loadAdminEarnings(container){
  if(!container)return;var db=window.db,cu=window.currentUser;
  if(!db||!cu){container.innerHTML='<p style="text-align:center;padding:32px;color:#9ca3af;">Please log in.</p>';return;}
  container.innerHTML='<div style="text-align:center;padding:40px;"><div class="loader-spinner" style="margin:0 auto 12px;"></div><p style="color:#6b7280;font-size:14px;">Loading owner earnings…</p></div>';
  try{
    var bookSnap=await db.collection('bookings').where('bookingStatus','==','confirmed').orderBy('createdAt','desc').get().catch(function(){return db.collection('bookings').where('bookingStatus','==','confirmed').get();});
    var tournSnap=await db.collection('tournament_entries').where('status','==','confirmed').get().catch(function(){return{docs:[]};});
    var opSnap=await db.collection('owner_payments').where('status','==','paid').get().catch(function(){return{docs:[]};});
    var prSnap=await db.collection('payout_requests').where('status','==','paid').get().catch(function(){return{docs:[]};});
    var ownerData={};
    function ensureOwner(oid,name){if(!ownerData[oid])ownerData[oid]={ownerId:oid,ownerName:name||'',bookingEarnings:0,tournamentEarnings:0,transfersPaid:0,bookingCount:0,tournCount:0,transferCount:0};if(name&&!ownerData[oid].ownerName)ownerData[oid].ownerName=name;}
    bookSnap.docs.forEach(function(doc){var b=doc.data();var oid=b.ownerId||'';if(!oid)return;ensureOwner(oid,b.ownerName||'');var full=Number(b.amount||b.totalAmount||0);var plat=Number(b.commission||b.platformFee||Math.round(full*0.10));var os=full-plat;if(os<=0)return;ownerData[oid].bookingEarnings+=os;ownerData[oid].bookingCount++;});
    tournSnap.docs.forEach(function(doc){var e=doc.data();var oid=e.ownerId||e.tournamentOwnerId||'';if(!oid)return;ensureOwner(oid,'');var fee=Number(e.amount||e.entryFee||0);var plat=Number(e.platformFee||Math.round(fee*0.20));var os=fee-plat;if(os<=0)return;ownerData[oid].tournamentEarnings+=os;ownerData[oid].tournCount++;});
    var seenT=new Set();
    opSnap.docs.forEach(function(doc){seenT.add(doc.id);var t=doc.data();var oid=t.ownerId||'';if(!oid)return;ensureOwner(oid,t.ownerName||'');ownerData[oid].transfersPaid+=Number(t.amount||0);ownerData[oid].transferCount++;});
    prSnap.docs.forEach(function(doc){if(seenT.has(doc.id))return;var t=doc.data();var oid=t.ownerId||'';if(!oid)return;ensureOwner(oid,t.ownerName||'');ownerData[oid].transfersPaid+=Number(t.amount||0);ownerData[oid].transferCount++;});
    var unknownIds=Object.keys(ownerData).filter(function(id){return!ownerData[id].ownerName;});
    for(var i=0;i<unknownIds.length;i+=10){var chunk=unknownIds.slice(i,i+10);try{var owSnap=await db.collection('owners').where(firebase.firestore.FieldPath.documentId(),'in',chunk).get();owSnap.docs.forEach(function(d){if(ownerData[d.id])ownerData[d.id].ownerName=d.data().name||d.data().ownerName||'Unknown';});}catch(_){}}
    var owners=Object.values(ownerData).sort(function(a,b){return(b.bookingEarnings+b.tournamentEarnings)-(a.bookingEarnings+a.tournamentEarnings);});
    var totalPlat=owners.reduce(function(s,o){var bk=o.bookingCount>0?(o.bookingEarnings/0.9*0.1):0;var tn=o.tournCount>0?(o.tournamentEarnings/0.8*0.2):0;return s+bk+tn;},0);
    var totalOwed=owners.reduce(function(s,o){return s+Math.max(0,(o.bookingEarnings+o.tournamentEarnings)-o.transfersPaid);},0);
    var fmt=_SPB.fmt;
    container.innerHTML='<div class="bae-banner">'
      +'<div class="bae-banner-stat"><div class="bae-banner-val">'+fmt(totalPlat)+'</div><div class="bae-banner-lbl">Platform Revenue</div></div>'
      +'<div class="bae-banner-stat"><div class="bae-banner-val">'+owners.length+'</div><div class="bae-banner-lbl">Active Owners</div></div>'
      +'<div class="bae-banner-stat" style="background:rgba(255,255,255,.1);border-radius:12px;padding:10px 16px;"><div class="bae-banner-val" style="color:#fbbf24;">'+fmt(totalOwed)+'</div><div class="bae-banner-lbl">Total Still Owed</div></div>'
      +'<button class="bae-refresh-btn" onclick="window._bmgRefreshAdminEarnings()"><i class="fas fa-sync-alt"></i> Refresh</button>'
      +'</div>'
      +(owners.length===0?'<p style="text-align:center;color:#9ca3af;padding:32px;">No earnings data yet.</p>'
        :owners.map(function(o){var total=o.bookingEarnings+o.tournamentEarnings;var netOwed=Math.max(0,total-o.transfersPaid);var isOwed=netOwed>0;
          return'<div class="bae-card '+(isOwed?'bae-card-owed':'')+'">'
            +'<h4><span>'+_SPB.esc(o.ownerName||'Unknown Owner')+' <span style="font-size:10px;color:#9ca3af;">'+o.ownerId.slice(0,8)+'…</span></span>'+(isOwed?'':'<span class="bae-paid-badge"><i class="fas fa-check-circle"></i> Fully Paid</span>')+'</h4>'
            +'<div class="bae-row"><span>Ground Bookings (90% share)</span><span style="color:#3b82f6;font-weight:700;">'+fmt(o.bookingEarnings)+'</span></div>'
            +'<div class="bae-row"><span>Tournament Earnings (80% share)</span><span style="color:#8b5cf6;font-weight:700;">'+fmt(o.tournamentEarnings)+'</span></div>'
            +'<div class="bae-row"><span>Total Earned</span><span style="font-weight:800;">'+fmt(total)+'</span></div>'
            +'<div class="bae-row"><span>Already Transferred ('+o.transferCount+' payment'+(o.transferCount!==1?'s':'')+')</span><span style="color:#10b981;font-weight:700;">-'+fmt(o.transfersPaid)+'</span></div>'
            +'<div class="bae-owed-box"><strong>Amount Still Owed</strong><span style="font-size:18px;font-weight:800;color:'+(isOwed?'#d97706':'#10b981')+';">'+fmt(netOwed)+'</span></div>'
            +(isOwed?'<button class="bae-transfer-btn" onclick="window.bmgAdminTransferPaymentV3(\''+o.ownerId+'\',\''+o.ownerName.replace(/'/g,"\\'")+'\','+Math.round(netOwed)+')"><i class="fas fa-paper-plane"></i> Mark Payment Done ('+fmt(netOwed)+')</button>':'')
            +'</div>';}).join(''));
  }catch(err){console.error('[spb-admin-earnings]',err);container.innerHTML='<p style="text-align:center;color:#ef4444;padding:32px;">Failed to load. '+(err.code==='permission-denied'?'Check Firestore rules for admin role.':err.message)+'</p>';}
}
window.loadAdminOwnerEarnings=loadAdminEarnings;
window._bmgRefreshAdminEarnings=function(){var ac=document.getElementById(ACONT),cc=document.getElementById(CCONT);if(ac&&document.getElementById(ATAB)&&document.getElementById(ATAB).classList.contains('active')){ac.innerHTML='<div class="loading-spinner"><div class="loader-spinner"></div></div>';loadAdminEarnings(ac);}if(cc&&document.getElementById(CTAB)&&document.getElementById(CTAB).classList.contains('active')){cc.innerHTML='<div class="loading-spinner"><div class="loader-spinner"></div></div>';loadAdminEarnings(cc);}};

window.bmgAdminTransferPaymentV3=async function(ownerId,ownerName,suggestedAmount){
  var db=window.db,cu=window.currentUser;if(!db||!cu){_SPB.toast('Not logged in','error');return;}
  var old=document.getElementById('bmg-transfer-modal-v3');if(old)old.remove();
  var modal=document.createElement('div');modal.id='bmg-transfer-modal-v3';modal.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px;';
  modal.innerHTML='<div style="background:#fff;border-radius:20px;max-width:380px;width:100%;padding:28px 24px;box-shadow:0 24px 64px rgba(0,0,0,.25);">'
    +'<h3 style="margin:0 0 4px;font-size:18px;font-weight:800;"><i class="fas fa-paper-plane" style="color:#10b981;margin-right:8px;"></i>Mark Payment Done</h3>'
    +'<p style="font-size:13px;color:#6b7280;margin:0 0 20px;">to <strong>'+_SPB.esc(ownerName||ownerId)+'</strong></p>'
    +'<label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:6px;">Amount Transferred (₹)</label>'
    +'<input id="bmg-tv3-amount" type="number" value="'+(suggestedAmount||0)+'" min="1" style="width:100%;padding:12px;border:2px solid #e5e7eb;border-radius:12px;font-size:18px;font-weight:700;margin-bottom:14px;box-sizing:border-box;">'
    +'<label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:6px;">Payment Method</label>'
    +'<select id="bmg-tv3-method" style="width:100%;padding:10px;border:2px solid #e5e7eb;border-radius:12px;font-size:14px;margin-bottom:14px;box-sizing:border-box;"><option value="UPI">UPI</option><option value="NEFT">NEFT</option><option value="IMPS">IMPS</option><option value="Cash">Cash</option><option value="Other">Other</option></select>'
    +'<label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:6px;">Transaction ID / Note (optional)</label>'
    +'<input id="bmg-tv3-note" type="text" placeholder="e.g. UTR1234567890" style="width:100%;padding:10px;border:2px solid #e5e7eb;border-radius:12px;font-size:13px;margin-bottom:20px;box-sizing:border-box;">'
    +'<div style="display:flex;gap:10px;">'
    +'<button id="bmg-tv3-cancel" style="flex:1;padding:12px;background:#f3f4f6;color:#374151;border:none;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;">Cancel</button>'
    +'<button id="bmg-tv3-confirm" style="flex:2;padding:12px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;"><i class="fas fa-check"></i> Confirm Payment Done</button>'
    +'</div>'
    +'<p id="bmg-tv3-error" style="color:#ef4444;font-size:12px;text-align:center;margin-top:10px;display:none;"></p>'
    +'</div>';
  document.body.appendChild(modal);
  modal.addEventListener('click',function(e){if(e.target===modal)modal.remove();});
  document.getElementById('bmg-tv3-cancel').addEventListener('click',function(){modal.remove();});
  document.getElementById('bmg-tv3-confirm').addEventListener('click',async function(){
    var amt=Number(document.getElementById('bmg-tv3-amount')&&document.getElementById('bmg-tv3-amount').value||0);var method=document.getElementById('bmg-tv3-method')&&document.getElementById('bmg-tv3-method').value||'UPI';var note=document.getElementById('bmg-tv3-note')&&document.getElementById('bmg-tv3-note').value||'';var errEl=document.getElementById('bmg-tv3-error');var btn=document.getElementById('bmg-tv3-confirm');
    if(!amt||amt<=0){errEl.textContent='Please enter a valid amount greater than ₹0.';errEl.style.display='block';return;}
    btn.disabled=true;btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Processing…';errEl.style.display='none';
    try{var now=_SPB.FS().serverTimestamp();var adminName=cu.name||cu.displayName||cu.email||'Admin';var transferDoc={ownerId:ownerId,ownerName:ownerName||'',amount:amt,method:method,note:note,description:note||'Payment transfer via '+method,status:'paid',paidAt:now,paidBy:cu.uid,paidByName:adminName,paidByEmail:cu.email||'',adminRole:cu.role||'admin',createdAt:now,updatedAt:now};var opRef=await db.collection('owner_payments').add(transferDoc);await db.collection('payout_requests').add(Object.assign({},transferDoc,{requestId:'ADMIN-'+Date.now(),type:'admin_direct_transfer',bookingIds:[],ownerPaymentDocId:opRef.id}));modal.remove();_SPB.toast('✅ Payment of '+_SPB.fmt(amt)+' recorded for '+(ownerName||'owner'),'success',5000);var ac=document.getElementById(ACONT),cc=document.getElementById(CCONT);if(ac&&document.getElementById(ATAB)&&document.getElementById(ATAB).classList.contains('active')){ac.innerHTML='<div class="loading-spinner"><div class="loader-spinner"></div></div>';await loadAdminEarnings(ac);}if(cc&&document.getElementById(CTAB)&&document.getElementById(CTAB).classList.contains('active')){cc.innerHTML='<div class="loading-spinner"><div class="loader-spinner"></div></div>';await loadAdminEarnings(cc);}}catch(err){console.error('[spb-transfer]',err);errEl.textContent='Failed: '+err.message;errEl.style.display='block';btn.disabled=false;btn.innerHTML='<i class="fas fa-check"></i> Confirm Payment Done';}
  });
};
window.bmgAdminTransferPayment=window.bmgAdminTransferPaymentV3;

function injectAdminTab(){if(document.getElementById(ATAB))return;var tabBar=document.querySelector('.admin-tabs');if(!tabBar)return;var btn=document.createElement('button');btn.id=ATAB;btn.className='tab-btn';btn.innerHTML='<i class="fas fa-hand-holding-usd" style="margin-right:5px;"></i>Owner Earnings';var delTab=document.getElementById('admin-delete-tab');if(delTab)tabBar.insertBefore(btn,delTab);else tabBar.appendChild(btn);if(!tabBar.__bmgEarnWired){tabBar.__bmgEarnWired=true;tabBar.addEventListener('click',function(e){var b=e.target.closest('#'+ATAB);if(!b)return;e.preventDefault();e.stopPropagation();document.querySelectorAll('.admin-tabs .tab-btn').forEach(function(x){x.classList.remove('active');});b.classList.add('active');var c=document.getElementById(ACONT);if(c){c.innerHTML='<div class="loading-spinner"><div class="loader-spinner"></div></div>';loadAdminEarnings(c);}});}}
function injectCEOTab(){if(document.getElementById(CTAB))return;var tabBar=document.querySelector('.ceo-tabs');if(!tabBar)return;var btn=document.createElement('button');btn.id=CTAB;btn.className='tab-btn';btn.innerHTML='<i class="fas fa-hand-holding-usd" style="margin-right:5px;"></i>Owner Earnings';tabBar.appendChild(btn);if(!tabBar.__bmgCEOWired){tabBar.__bmgCEOWired=true;tabBar.addEventListener('click',function(e){var b=e.target.closest('#'+CTAB);if(!b)return;e.preventDefault();e.stopPropagation();document.querySelectorAll('.ceo-tabs .tab-btn').forEach(function(x){x.classList.remove('active');});b.classList.add('active');var c=document.getElementById(CCONT);if(c){c.innerHTML='<div class="loading-spinner"><div class="loader-spinner"></div></div>';loadAdminEarnings(c);}});}}
function patchDash(){var oAD=window.loadAdminDashboard;if(typeof oAD==='function'&&!oAD.__bmgV3P){window.loadAdminDashboard=async function(tab){if(tab==='owner-earnings'){injectAdminTab();document.querySelectorAll('.admin-tabs .tab-btn').forEach(function(b){b.classList.remove('active');});var b=document.getElementById(ATAB);if(b)b.classList.add('active');var c=document.getElementById(ACONT);if(c){c.innerHTML='<div class="loading-spinner"><div class="loader-spinner"></div></div>';await loadAdminEarnings(c);}return;}return oAD.apply(this,arguments);};window.loadAdminDashboard.__bmgV3P=true;}var oCD=window.loadCEODashboard;if(typeof oCD==='function'&&!oCD.__bmgV3P){window.loadCEODashboard=async function(tab){if(tab==='owner-earnings'){injectCEOTab();document.querySelectorAll('.ceo-tabs .tab-btn').forEach(function(b){b.classList.remove('active');});var b=document.getElementById(CTAB);if(b)b.classList.add('active');var c=document.getElementById(CCONT);if(c){c.innerHTML='<div class="loading-spinner"><div class="loader-spinner"></div></div>';await loadAdminEarnings(c);}return;}return oCD.apply(this,arguments);};window.loadCEODashboard.__bmgV3P=true;}}
function setup(){injectAdminTab();injectCEOTab();patchDash();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){setTimeout(setup,300);});else setTimeout(setup,300);
window.addEventListener('bmg:pageShown',function(e){var pid=e.detail&&e.detail.pageId;if(pid==='admin-dashboard-page'||pid==='ceo-dashboard-page')setTimeout(setup,100);});
new MutationObserver(function(){if(document.querySelector('.admin-tabs')&&!document.getElementById(ATAB))injectAdminTab();if(document.querySelector('.ceo-tabs')&&!document.getElementById(CTAB))injectCEOTab();}).observe(document.body,{childList:true,subtree:true});
})();

/* §25 — TOURNAMENT: confirm, QR, My Tournaments */
(function(){
function qrPayload(entry){return JSON.stringify({appId:'BookMyGame',type:'tournament',registrationId:entry.orderId||entry.registrationId||'',tournamentId:entry.tournamentId||'',tournamentName:entry.tournamentName||'',userId:entry.userId||'',userName:entry.userName||'',teamName:entry.teamName||'',sport:entry.sport||'',date:entry.date||'',venue:entry.venue||'',amount:entry.amount||0,issuedAt:new Date().toISOString()});}
function qrUrl(data,sz){return'https://api.qrserver.com/v1/create-qr-code/?size='+(sz||220)+'x'+(sz||220)+'&data='+encodeURIComponent(data);}

async function confirmEntry(orderId,paymentData){
  var db=window.db,cu=window.currentUser;if(!db||!cu||!orderId)return;
  var now=_SPB.FS().serverTimestamp();var meta=paymentData||{};var tournamentId=meta.tournamentId||'';var tournamentName=meta.tournamentName||meta.name||'';var entryFee=Number(meta.amount||meta.entryFee||0);var platformFee=Math.round(entryFee*0.20);var ownerAmount=entryFee-platformFee;
  var entry={orderId:orderId,registrationId:orderId,tournamentId:tournamentId,tournamentName:tournamentName,userId:cu.uid,userName:cu.name||cu.displayName||'',userEmail:cu.email||'',userPhone:cu.phone||'',teamName:meta.teamName||'',sport:meta.sport||'',venue:meta.venue||'',date:meta.date||'',amount:entryFee,entryFee:entryFee,platformFee:platformFee,ownerAmount:ownerAmount,paymentMethod:'cashfree',paymentStatus:'paid',status:'confirmed',registrationStatus:'confirmed',confirmedAt:now,createdAt:now,updatedAt:now};
  try{
    var batch=db.batch();batch.set(db.collection('tournament_entries').doc(orderId),entry,{merge:true});batch.set(db.collection('tournament_registrations').doc(orderId),entry,{merge:true});
    if(tournamentId){var tRef=db.collection('tournaments').doc(tournamentId);batch.update(tRef,{availableSpots:_SPB.FS().increment(-1),registeredCount:_SPB.FS().increment(1),spotsLeft:_SPB.FS().increment(-1),updatedAt:now,registeredTeams:_SPB.FS().arrayUnion({userId:cu.uid,userName:cu.name||'',teamName:meta.teamName||'',registrationId:orderId,status:'confirmed',paidAt:new Date().toISOString()})});}
    try{var pendSnap=await db.collection('pending_tournament_registrations').where('tournamentId','==',tournamentId).where('userId','==',cu.uid).get();pendSnap.forEach(function(d){batch.delete(d.ref);});}catch(_){}
    await batch.commit();
    try{var qrd=qrPayload(Object.assign({},entry,{orderId:orderId}));await db.collection('tournament_entries').doc(orderId).update({qrData:qrd,qrUrl:qrUrl(qrd),qrGeneratedAt:_SPB.FS().serverTimestamp(),updatedAt:_SPB.FS().serverTimestamp()});}catch(_){}
    sessionStorage.removeItem('pendingTournamentRegistration');window._pendingTournamentRegData=null;window.currentTournamentPayment=null;
    showTournSuccess(Object.assign({},entry,{orderId:orderId}));
    if(typeof window.loadMyTournaments==='function')setTimeout(function(){window.loadMyTournaments();},1000);
  }catch(err){console.error('[spb-tournament]',err);_SPB.toast('🏆 Payment received! Registration being confirmed. Check "My Tournaments".','success',8000);}
}

function showTournSuccess(entry){
  var old=document.getElementById('bmg-tourn-success-modal');if(old)old.remove();
  var qrd=qrPayload(entry);var qrSrc=qrUrl(qrd,200);
  var modal=document.createElement('div');modal.id='bmg-tourn-success-modal';modal.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:16px;';
  modal.innerHTML='<div style="background:#fff;border-radius:24px;max-width:400px;width:100%;padding:28px 20px;text-align:center;box-shadow:0 32px 80px rgba(0,0,0,.25);">'
    +'<div style="width:72px;height:72px;background:linear-gradient(135deg,#10b981,#059669);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;box-shadow:0 12px 28px rgba(16,185,129,.35);"><i class="fas fa-trophy" style="color:#fff;font-size:30px;"></i></div>'
    +'<h2 style="font-size:22px;font-weight:800;color:#111;margin:0 0 6px;">You\'re In! 🎉</h2>'
    +'<p style="font-size:14px;color:#6b7280;margin:0 0 16px;">Successfully registered for</p>'
    +'<div style="background:#f0fdf4;border-radius:14px;padding:14px;margin-bottom:16px;">'
    +'<p style="font-weight:700;color:#065f46;font-size:16px;margin:0 0 4px;">'+_SPB.esc(entry.tournamentName||'Tournament')+'</p>'
    +(entry.teamName?'<p style="font-size:13px;color:#059669;margin:0;">Team: <strong>'+_SPB.esc(entry.teamName)+'</strong></p>':'')
    +(entry.sport?'<p style="font-size:12px;color:#6b7280;margin:4px 0 0;">'+_SPB.esc(entry.sport)+(entry.date?' · '+_SPB.esc(entry.date):'')+(entry.venue?' · '+_SPB.esc(entry.venue):'')+'</p>':'')
    +'</div>'
    +'<p style="font-size:13px;color:#374151;font-weight:600;margin:0 0 10px;">Your Entry QR Code</p>'
    +'<img src="'+qrSrc+'" alt="Entry QR" style="width:160px;height:160px;border-radius:12px;border:3px solid #d1fae5;margin-bottom:14px;">'
    +'<p style="font-size:11px;color:#9ca3af;margin:0 0 18px;">Show this QR to the organiser at the venue</p>'
    +'<div style="display:flex;gap:10px;">'
    +'<button onclick="document.getElementById(\'bmg-tourn-success-modal\').remove();if(typeof showPage===\'function\')showPage(\'main-page\');" style="flex:1;padding:12px;background:#f3f4f6;color:#374151;border:none;border-radius:14px;font-size:14px;font-weight:600;cursor:pointer;">Home</button>'
    +'<button onclick="document.getElementById(\'bmg-tourn-success-modal\').remove();if(typeof window.bmgShowMyTournaments===\'function\')window.bmgShowMyTournaments();" style="flex:1;padding:12px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:14px;font-size:14px;font-weight:700;cursor:pointer;">My Tournaments</button>'
    +'</div></div>';
  document.body.appendChild(modal);modal.addEventListener('click',function(e){if(e.target===modal)modal.remove();});
}

window.addEventListener('bmg:paymentConfirmed',async function(e){var det=e.detail||{};if(det.paymentType!=='tournament')return;await confirmEntry(det.orderId,det.result||window._lastTournamentPaymentData||{});});
window.bmgShowMyTournaments=function(){if(typeof window.showPage==='function'){window.showPage('bookings-page');setTimeout(function(){document.querySelectorAll('.booking-tab-btn,[data-tab]').forEach(function(b){if(/tournament/i.test(b.textContent))b.click();});},300);}};

function patchMyBookings(){
  var origLoad=window.loadUserBookings;if(typeof origLoad!=='function'||origLoad._spbTP)return;
  window.loadUserBookings=async function(status){
    await origLoad.call(this,status);if(status&&status!=='upcoming')return;
    var db=window.db,cu=window.currentUser;if(!db||!cu)return;
    try{var tSnap=await db.collection('tournament_entries').where('userId','==',cu.uid).where('status','==','confirmed').orderBy('createdAt','desc').get();if(tSnap.empty)return;var container=document.getElementById('user-bookings-list');if(!container)return;var emptyEl=container.querySelector('.empty-state');if(emptyEl&&tSnap.size>0)emptyEl.remove();
      tSnap.docs.forEach(function(doc){var e=doc.data();var qrd=e.qrData||qrPayload({orderId:doc.id,tournamentId:e.tournamentId||'',tournamentName:e.tournamentName||'',userId:e.userId||cu.uid,userName:e.userName||cu.name||'',teamName:e.teamName||'',sport:e.sport||'',date:e.date||'',venue:e.venue||'',amount:e.amount||0,registrationId:doc.id});var qrSrc=e.qrUrl||qrUrl(qrd,160);
        var card=document.createElement('div');card.className='booking-card';card.style.cssText='background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.08);margin-bottom:16px;border:1px solid #d1fae5;';
        card.innerHTML='<div style="background:linear-gradient(135deg,#10b981,#059669);padding:12px 16px;display:flex;align-items:center;gap:10px;"><i class="fas fa-trophy" style="color:#fff;font-size:18px;"></i><div><span style="color:#fff;font-weight:700;font-size:14px;">Tournament Entry</span> <span style="background:rgba(255,255,255,.2);color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;">CONFIRMED</span></div></div>'
          +'<div style="padding:14px 16px;"><h4 style="font-size:15px;font-weight:700;color:#065f46;margin:0 0 8px;">'+_SPB.esc(e.tournamentName||'Tournament')+'</h4>'
          +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;color:#374151;margin-bottom:12px;">'
          +(e.teamName?'<div><span style="color:#9ca3af;">Team</span><br><strong>'+_SPB.esc(e.teamName)+'</strong></div>':'')
          +(e.sport?'<div><span style="color:#9ca3af;">Sport</span><br><strong>'+_SPB.esc(e.sport)+'</strong></div>':'')
          +(e.date?'<div><span style="color:#9ca3af;">Date</span><br><strong>'+_SPB.esc(e.date)+'</strong></div>':'')
          +(e.venue?'<div><span style="color:#9ca3af;">Venue</span><br><strong>'+_SPB.esc(e.venue)+'</strong></div>':'')
          +'<div><span style="color:#9ca3af;">Entry Fee</span><br><strong style="color:#059669;">'+_SPB.fmt(e.amount)+'</strong></div>'
          +'<div><span style="color:#9ca3af;">Reg. ID</span><br><strong style="font-size:10px;">'+(e.registrationId||doc.id).slice(0,12)+'…</strong></div></div>'
          +'<div style="text-align:center;border-top:1px solid #d1fae5;padding-top:12px;"><p style="font-size:11px;color:#6b7280;margin:0 0 8px;font-weight:600;">ENTRY QR CODE — Show at venue</p>'
          +'<img src="'+_SPB.esc(qrSrc)+'" alt="Entry QR" style="width:130px;height:130px;border-radius:10px;border:2px solid #d1fae5;"></div></div>';
        container.insertBefore(card,container.firstChild);});
    }catch(err){console.error('[spb-tourn-bookings]',err);}
  };window.loadUserBookings._spbTP=true;
}
_SPB.waitFor(function(){return typeof window.loadUserBookings==='function';},6000).then(patchMyBookings);setTimeout(patchMyBookings,2000);
})();

/* §26 — LOADING OVERLAY + BACK BUTTONS */
(function(){
function forceHide(){var ov=document.getElementById('loading-overlay');if(ov)ov.style.display='none';if(typeof window.hideLoading==='function')window.hideLoading();}
var _oShow=window.showLoading;window.showLoading=function(msg){var ov=document.getElementById('loading-overlay');if(ov)ov._shownAt=Date.now();if(typeof _oShow==='function')_oShow(msg);clearTimeout(window._spbOverlayCap);window._spbOverlayCap=setTimeout(forceHide,10000);};
document.addEventListener('click',function(e){var ov=document.getElementById('loading-overlay');if(!ov||ov.style.display==='none')return;var sp=ov.querySelector('.loader-spinner,.loading-spinner');if(sp&&sp.contains(e.target))return;if(Date.now()-(ov._shownAt||0)>3000)forceHide();},true);
function rewireBtns(){['owner-type-back-btn','venue-owner-register-back-btn','plot-owner-register-back-btn','venue-back-btn','ground-back-btn','booking-back-btn','confirmation-home-btn','entry-pass-back-btn','bookings-back-btn','profile-back-btn','owner-dashboard-back-btn','admin-dashboard-back-btn','ceo-dashboard-back-btn','register-back-btn'].forEach(function(id){var btn=document.getElementById(id);if(!btn||btn._spbWired)return;btn._spbWired=true;btn.addEventListener('click',function(e){e.stopPropagation();forceHide();if(typeof window.goBack==='function')window.goBack();});});document.querySelectorAll('.back-btn:not([data-spb-wired])').forEach(function(btn){btn.setAttribute('data-spb-wired','1');btn.addEventListener('click',function(e){e.stopPropagation();forceHide();if(typeof window.goBack==='function')window.goBack();});});}
window.addEventListener('bmg:pageShown',function(){setTimeout(rewireBtns,100);forceHide();});if(document.readyState!=='loading')rewireBtns();else document.addEventListener('DOMContentLoaded',rewireBtns);setInterval(rewireBtns,2000);})();

/* §27 — UPCOMING BOOKING BANNER */
(function(){
var _listener=null;
function start(){if(_listener){_listener();_listener=null;}var banner=document.getElementById('spb-upcoming-banner');if(!banner||!window.db||!window.currentUser)return;var today=new Date();today.setHours(0,0,0,0);var todayStr=today.toISOString().split('T')[0];_listener=window.db.collection('bookings').where('userId','==',window.currentUser.uid).where('bookingStatus','==','confirmed').where('date','>=',todayStr).orderBy('date','asc').limit(3).onSnapshot(function(snap){var now=new Date(),upcoming=null;snap.forEach(function(doc){if(upcoming)return;var b=doc.data();var sd=new Date((b.date||'')+'T'+(b.slotTime?b.slotTime.replace(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i,function(_,h,m,ap){var hh=parseInt(h,10);if(ap&&ap.toUpperCase()==='PM'&&hh!==12)hh+=12;if(ap&&ap.toUpperCase()==='AM'&&hh===12)hh=0;return String(hh).padStart(2,'0')+':'+m+':00';}):'00:00:00'));if(sd>=now)upcoming=Object.assign({},b,{_id:doc.id});});if(!upcoming){banner.style.display='none';return;}banner.style.display='flex';var ne=document.getElementById('spb-upcoming-name');if(ne)ne.textContent=upcoming.groundName||upcoming.venueName||'Ground Booking';var ae=document.getElementById('spb-upcoming-addr');if(ae)ae.textContent=(upcoming.groundAddress||upcoming.venueAddress||'')+(upcoming.date?' · '+upcoming.date:'');var te=document.getElementById('spb-upcoming-time');if(te){te.textContent=upcoming.slotTime||upcoming.date||'Upcoming';te.style.display='block';}banner.style.cursor='pointer';banner.onclick=function(){if(typeof window.showPage==='function')window.showPage('bookings-page');};},function(err){console.warn('[spb-banner]',err);banner.style.display='none';});}
function stop(){if(_listener){_listener();_listener=null;}var b=document.getElementById('spb-upcoming-banner');if(b)b.style.display='none';}
var _lastUid=null;setInterval(function(){var uid=window.currentUser&&window.currentUser.uid||null;if(uid!==_lastUid){_lastUid=uid;if(uid)start();else stop();}},800);
window.addEventListener('bmg:paymentConfirmed',function(){setTimeout(start,1000);});})();

/* §28 — POST-PAYMENT ENTRY PASS BUTTON */
(function(){
window.addEventListener('bmg:paymentConfirmed',function(e){if(!e.detail||e.detail.paymentType!=='booking')return;var result=e.detail.result||{};var bookingId=_SPB.getBookingId(result,e.detail.orderId);setTimeout(function(){var confPage=document.getElementById('confirmation-page');if(!confPage||!confPage.classList.contains('active'))return;if(document.getElementById('show-entry-pass-btn'))return;var btn=document.createElement('button');btn.id='show-entry-pass-btn';btn.style.cssText='display:block;width:calc(100% - 32px);margin:8px 16px;padding:14px;background:linear-gradient(135deg,#4F46E5,#7C3AED);color:#fff;border:none;border-radius:14px;font-size:15px;font-weight:700;cursor:pointer;';btn.innerHTML='<i class="fas fa-qrcode"></i> View Entry Pass';btn.addEventListener('click',function(){if(typeof window.showEntryPass==='function')window.showEntryPass(bookingId);});var pc=confPage.querySelector('.page-content');if(pc)pc.appendChild(btn);},1000);});})();

/* §29 — MAIN BOOT */
(function(){
window.addEventListener('bmg:pageShown',function(e){var pid=(e&&e.detail&&e.detail.pageId)||'';var btn=document.getElementById('header-qr-scanner');var cu=window.currentUser;if(btn){var ok=cu&&(cu.role==='owner'||cu.role==='admin'||cu.role==='ceo');btn.style.display=ok?'flex':'none';}if(!pid||pid==='main-page'||pid==='home-page'){var container=document.getElementById('nearby-venues');if(container&&(!container.children.length||container.querySelector('.skeleton-loading'))){setTimeout(function(){if(typeof window.loadNearbyVenues==='function')window.loadNearbyVenues();},200);}}});
console.log('✅ [sportobook_patches_merged.js v2.0] Loaded — Slots | Earnings | Entry Pass | QR Verification | Tournament');})();
