/**
 * app_payment_integration.js
 * ─────────────────────────────────────────────────────────────
 * Drop these snippets into the relevant sections of app.js.
 * paymentService.js must be loaded BEFORE app.js in index.html.
 *
 * <script src="paymentService.js"></script>   ← first
 * <script src="app.js"></script>              ← second
 *
 * Also add Cashfree SDK to index.html <head>:
 * <script src="https://sdk.cashfree.com/js/v3/cashfree.js"></script>
 * ─────────────────────────────────────────────────────────────
 */


// ═══════════════════════════════════════════════════════════════
// ① GROUND BOOKING  (replaces old initiateBookingPayment calls)
// ═══════════════════════════════════════════════════════════════

/**
 * Call this when user confirms a slot selection.
 * Replace the old: redirectToCashfree() / setupCashfreePaymentButton() calls
 */
async function handleBookingPayment(bookingDetails) {
  // FIX: bookingDetails originates from selectSlot() which already runs a
  // JSON round-trip, but callers outside that flow (e.g. sessionStorage
  // recovery, direct calls) may pass raw Firestore doc data containing
  // Timestamp objects or FieldValues. A second round-trip here is cheap and
  // guarantees startPayment() always receives a plain-JS object.
  const safe = JSON.parse(JSON.stringify(bookingDetails));

  // Build an explicit, whitelisted payload — no spreads, every field is a
  // primitive. This is the final line of defence before startPayment().
  const paymentData = {
    groundId      : String(safe.groundId      || ''),
    groundName    : String(safe.groundName    || ''),
    venueName     : String(safe.venueName     || ''),
    venueAddress  : String(safe.venueAddress  || ''),
    groundAddress : String(safe.groundAddress || ''),
    sportType     : String(safe.sportType     || ''),
    ownerId       : String(safe.ownerId       || ''),
    isPlotOwner   : Boolean(safe.isPlotOwner  || false),
    date          : String(safe.date          || ''),
    slotTime      : String(safe.slotTime      || ''),
    amount        : Number(safe.amount),
    originalAmount: Number(safe.originalAmount || safe.amount),
    userName      : String(safe.userName  || currentUser?.name  || ''),
    userEmail     : String(safe.userEmail || currentUser?.email || ''),
    userPhone     : String(safe.userPhone || currentUser?.phone || ''),
    ownerAmount   : Number(safe.ownerAmount || 0),
    promoCode     : String(safe.promoCode   || ''),
    appliedOffer  : String(safe.appliedOffer || ''),
  };

  await startPayment(paymentData, 'booking');
}

// Wire it to your Pay button — replaces setupCashfreePaymentButton():
function setupPayButton(bookingDetails) {
  const btn = document.getElementById("cashfree-pay-btn");
  if (!btn) return;

  // Clone to remove stale listeners
  const fresh = btn.cloneNode(true);
  btn.parentNode.replaceChild(fresh, btn);

  fresh.addEventListener("click", async (e) => {
    e.preventDefault();
    await handleBookingPayment(bookingDetails);
  });
}

// Updated showBookingPage — remove all old Cashfree redirect logic:
function showBookingPage(bookingDetails) {
  // Populate UI elements
  const safe = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val ?? "";
  };

  safe("booking-ground-name", bookingDetails.groundName);
  safe("booking-date",        bookingDetails.date);
  safe("booking-time",        bookingDetails.slotTime);
  safe("booking-amount",      formatCurrency(bookingDetails.amount));
  safe("payment-amount",      formatCurrency(bookingDetails.amount));
  safe("platform-fee",        formatCurrency(bookingDetails.amount * 0.10));
  safe("final-amount",        formatCurrency(bookingDetails.amount));

  // Save locally only as UI state (NOT for payment session recovery)
  sessionStorage.setItem("currentBookingDetails", JSON.stringify(bookingDetails));

  // Wire the button
  setupPayButton(bookingDetails);

  showPage("booking-page");
}


// ═══════════════════════════════════════════════════════════════
// ② OWNER ONBOARDING  ₹499 fee
// ═══════════════════════════════════════════════════════════════

/**
 * Call this when owner clicks "Complete Registration" / "List Ground"
 * Replaces old: processRegistrationPayment() / showOwnerRegistrationPayment()
 */
async function showOwnerRegistrationPayment() {
  if (!currentUser) {
    showToast("Please log in first", "warning");
    showPage("login-page");
    return;
  }

  // Make sure owner doc exists in Firestore before payment
  const ownerRef = db.collection("owners").doc(currentUser.uid);
  const ownerSnap = await ownerRef.get();

  if (!ownerSnap.exists) {
    showToast("Owner profile not found. Please complete registration first.", "error");
    return;
  }

  const owner = ownerSnap.data();

  if (owner.isActive && owner.paymentDone) {
    showToast("Your account is already active!", "success");
    return;
  }

  // FIX: Cast every field to a plain primitive before passing to startPayment().
  // currentUser properties are plain strings in most cases, but explicit casts
  // prevent accidental proxy objects or undefined values causing Firestore errors.
  const ownerPaymentData = {
    ownerId  : String(currentUser.uid),
    userName : String(currentUser.name  || owner.name  || ''),
    userEmail: String(currentUser.email || owner.email || ''),
    userPhone: String(currentUser.phone || owner.phone || ''),
    amount   : 5, // registration fee (₹5)
  };
  console.log('FINAL PAYMENT DATA:', ownerPaymentData); // debug log

  await startPayment(ownerPaymentData, "owner_onboarding");
}

// Alias for backward compat with any existing onclick handlers:
window.processRegistrationPayment = showOwnerRegistrationPayment;


// ═══════════════════════════════════════════════════════════════
// ③ TOURNAMENT ENTRY FEE
// ═══════════════════════════════════════════════════════════════

/**
 * Call this when user clicks "Register" on a tournament.
 * Replaces any old tournament payment redirect logic.
 *
 * @param {object} tournament  — tournament document from Firestore
 * @param {string} teamName    — optional team name
 */
async function handleTournamentPayment(tournament, teamName = "") {
  if (!currentUser) {
    showToast("Please log in to register", "warning");
    showPage("login-page");
    return;
  }

  if (!tournament?.entryFee || tournament.entryFee <= 0) {
    showToast("Invalid entry fee for this tournament.", "error");
    return;
  }

  // Check if already registered
  const existingEntry = await db.collection("tournament_entries")
    .where("tournamentId", "==", tournament.id)
    .where("userId",       "==", currentUser.uid)
    .limit(1)
    .get();

  if (!existingEntry.empty) {
    showToast("You are already registered for this tournament.", "warning");
    return;
  }

  // FIX: `tournament` is likely a raw Firestore doc payload and may contain
  // Timestamp fields (startDate, createdAt, etc.). JSON round-trip strips all
  // non-serialisable values so only plain JS primitives reach startPayment().
  const safeTournament = JSON.parse(JSON.stringify(tournament));

  // Explicit whitelist — no spreads, every field is a typed primitive.
  const paymentData = {
    tournamentId  : String(safeTournament.id            || ''),
    tournamentName: String(safeTournament.name || safeTournament.tournamentName || ''),
    amount        : Number(safeTournament.entryFee),
    userId        : String(currentUser.uid),
    userName      : String(currentUser.name   || ''),
    userEmail     : String(currentUser.email  || ''),
    userPhone     : String(currentUser.phone  || ''),
    teamName      : String(teamName || ''),
    sport         : String(safeTournament.sport  || ''),
    date          : String(safeTournament.date   || ''),
    venue         : String(safeTournament.venue  || ''),
  };

  console.log('FINAL PAYMENT DATA:', paymentData); // debug log

  await startPayment(paymentData, "tournament");
}


// ═══════════════════════════════════════════════════════════════
// ④ REACT TO CONFIRMED PAYMENTS  (replaces showBookingSuccessConfirmation)
// ═══════════════════════════════════════════════════════════════

/**
 * paymentService.js fires "bmg:paymentConfirmed" on success.
 * React to it here to update the UI.
 */
window.addEventListener("bmg:paymentConfirmed", (e) => {
  const { orderId, paymentType, result } = e.detail;

  console.log("✅ Payment confirmed:", paymentType, orderId);

  switch (paymentType) {

    case "booking":
      // Navigate to booking success / my bookings
      showBookingSuccessConfirmation(result || { bookingId: orderId });
      break;

    case "owner_onboarding":
      showToast("🎉 Account activated! You can now list your ground.", "success", 6000);
      // Refresh owner dashboard
      if (typeof loadOwnerDashboard === "function") loadOwnerDashboard();
      showPage("owner-dashboard");
      break;

    case "tournament":
      showToast("🏆 Tournament registration confirmed! Check 'My Tournaments'.", "success", 6000);
      if (typeof loadMyTournaments === "function") loadMyTournaments();
      break;

    default:
      showToast("Payment confirmed!", "success");
  }
});


// ═══════════════════════════════════════════════════════════════
// ⑤ CLEANUP — REMOVE FROM app.js
// ═══════════════════════════════════════════════════════════════
/*
  DELETE these from app.js — they are replaced by the unified system:

  ✗  redirectToCashfree()
  ✗  setupCashfreePaymentButton()          → replaced by setupPayButton()
  ✗  handlePaymentClick()                  → now inside paymentService.js
  ✗  handlePaymentReturn()                 → replaced by recoverPaymentSession()
  ✗  pollBookingConfirmation()             → replaced by Firestore onSnapshot
  ✗  startBookingPolling()                 → replaced by listenForPaymentConfirmation()
  ✗  recoverStaleSession()                 → replaced by recoverPaymentSession()
  ✗  paymentPollingInterval / setInterval  → all removed
  ✗  processRegistrationPayment()          → aliased above
  ✗  PAYMENT_CFG.CASHFREE_FORM_URL usage   → SDK popup, no form redirect
  ✗  localStorage bmg_pendingBooking       → no longer needed (state in Firestore)

  KEEP in app.js:
  ✓  createPendingBookingWithSlotLock()    (in paymentService.js — already updated)
  ✓  releaseLockedSlot()                  (renamed to releaseSlotLock in paymentService.js)
  ✓  showBookingSuccessConfirmation()     (UI — keep as is)
  ✓  formatCurrency(), showToast(), etc.  (utilities — keep)
*/


// ═══════════════════════════════════════════════════════════════
// ⑥ GLOBAL EXPORTS  (add to end of app.js window.* block)
// ═══════════════════════════════════════════════════════════════

window.handleBookingPayment       = handleBookingPayment;
window.showOwnerRegistrationPayment = showOwnerRegistrationPayment;
window.handleTournamentPayment    = handleTournamentPayment;
window.showBookingPage            = showBookingPage;

// ═══════════════════════════════════════════════════════════════
// ⑦ SAFE-DATA CLEANUP HELPER (extra guard for Firestore writes)
// ═══════════════════════════════════════════════════════════════

/**
 * Strip empty strings, null, undefined, and NaN from a plain object
 * before it reaches any Firestore write. Call on any object you
 * didn't construct yourself (e.g. from sessionStorage recovery).
 */
function stripEmptyFields(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => {
      if (v === null || v === undefined) return false;
      if (typeof v === 'string' && v === '') return false;
      if (typeof v === 'number' && Number.isNaN(v)) return false;
      return true;
    })
  );
}

window.stripEmptyFields = stripEmptyFields;
