/* =========================================================
   DIGIWIZR SALES TRACKER — APP LOGIC
   ========================================================= */

// -----------------------------------------------------------
// CONFIG
// -----------------------------------------------------------
// Fill this in with your deployed Apps Script /exec URL.
const BACKEND_URL = "https://script.google.com/macros/s/AKfycbyuGbPDAFD9pMHRsA-3YiNTVY7cmeaaTHEIMIls4BL7xvwGVyEBJg5zlNPIFqzckjDf/exec";

// localStorage keys
const LS_SHEET_ID = "digiwizr_sheetId";
const LS_BUSINESS_NAME = "digiwizr_businessName";
const LS_PENDING_SYNC = "digiwizr_pendingSync";
const LS_IOS_BANNER_DISMISSED = "digiwizr_iosBannerDismissed";

// -----------------------------------------------------------
// STATE
// -----------------------------------------------------------
let selectedProduct = null; // currently selected product name on the Sale screen

// -----------------------------------------------------------
// DOM SHORTCUTS
// -----------------------------------------------------------
const $ = (id) => document.getElementById(id);

const screens = {
  setup: $("screen-setup"),
  home: $("screen-home"),
  sale: $("screen-sale"),
  expense: $("screen-expense"),
  products: $("screen-products"),
};

const headerScreenTitle = $("headerScreenTitle");
const headerBusinessName = $("headerBusinessName");
const backBtn = $("backBtn");
const offlineBanner = $("offlineBanner");
const syncBadge = $("syncBadge");

// Screen titles shown in the header for each screen (home/setup show none)
const SCREEN_TITLES = {
  sale: "Record a Sale",
  expense: "Record an Expense",
  products: "Manage Products",
};

// -----------------------------------------------------------
// NAVIGATION
// -----------------------------------------------------------
function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.classList.toggle("active", key === name);
  });

  // Header: back button + screen title only appear on sub-screens
  const isSubScreen = ["sale", "expense", "products"].includes(name);
  backBtn.style.display = isSubScreen ? "inline-flex" : "none";

  if (SCREEN_TITLES[name]) {
    headerScreenTitle.textContent = SCREEN_TITLES[name];
    headerScreenTitle.style.display = "block";
  } else {
    headerScreenTitle.style.display = "none";
  }

  // Screen-specific setup when navigating in
  if (name === "sale") loadProductsForSale();
  if (name === "products") loadProductsForManage();
  if (name === "home") refreshSyncBadge();
}

backBtn.addEventListener("click", () => showScreen("home"));

// -----------------------------------------------------------
// BACKEND COMMUNICATION
// -----------------------------------------------------------
/**
 * Calls the Apps Script backend with the given action + params.
 * Uses text/plain content-type to avoid CORS preflight (Apps Script
 * web apps can't answer OPTIONS preflight requests), while still
 * sending a JSON body that the script parses on its end.
 */
async function callBackend(action, params) {
  if (!BACKEND_URL) {
    throw new Error("Backend URL is not configured yet.");
  }

  const payload = Object.assign({ action }, params);

  const response = await fetch(BACKEND_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error("Network response was not ok (" + response.status + ")");
  }

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || "Unknown backend error");
  }

  return data;
}

// -----------------------------------------------------------
// MESSAGE HELPERS
// -----------------------------------------------------------
function showMessage(el, text, type) {
  el.textContent = text;
  el.className = "message visible " + type;
}

function clearMessage(el) {
  el.textContent = "";
  el.className = "message";
}

// -----------------------------------------------------------
// SCREEN 1 — SETUP
// -----------------------------------------------------------
$("setupBtn").addEventListener("click", handleSetup);

async function handleSetup() {
  const businessName = $("businessNameInput").value.trim();
  const msgEl = $("setupMessage");
  clearMessage(msgEl);

  if (!businessName) {
    showMessage(msgEl, "Please enter your business name.", "error");
    return;
  }

  setSetupLoading(true);

  try {
    const data = await callBackend("setupClient", { businessName });

    localStorage.setItem(LS_SHEET_ID, data.sheetId);
    localStorage.setItem(LS_BUSINESS_NAME, businessName);

    applyBusinessNameToHeader(businessName);
    showScreen("home");
  } catch (err) {
    showMessage(msgEl, "Setup failed: " + err.message, "error");
  } finally {
    setSetupLoading(false);
  }
}

function setSetupLoading(isLoading) {
  $("setupBtn").disabled = isLoading;
  $("setupSpinner").style.display = isLoading ? "flex" : "none";
}

function applyBusinessNameToHeader(name) {
  headerBusinessName.textContent = name;
  headerBusinessName.style.display = "block";
}

// -----------------------------------------------------------
// SCREEN 2 — HOME
// -----------------------------------------------------------
$("cardSale").addEventListener("click", () => showScreen("sale"));
$("cardExpense").addEventListener("click", () => showScreen("expense"));
$("manageProductsLink").addEventListener("click", () => showScreen("products"));

// Keyboard accessibility for the card "buttons"
[$("cardSale"), $("cardExpense")].forEach((card) => {
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      card.click();
    }
  });
});

function refreshSyncBadge() {
  const pending = getPendingSync();
  syncBadge.classList.toggle("visible", pending.length > 0);
  syncBadge.textContent =
    pending.length > 0
      ? `${pending.length} unsynced ${pending.length === 1 ? "entry" : "entries"} — will sync automatically`
      : "";
}

// -----------------------------------------------------------
// SCREEN 3 — RECORD A SALE
// -----------------------------------------------------------
async function loadProductsForSale() {
  const listEl = $("saleProductList");
  const loadingEl = $("saleLoading");
  const formEl = $("saleFormFields");
  const msgEl = $("saleMessage");

  clearMessage(msgEl);
  selectedProduct = null;
  listEl.innerHTML = "";
  formEl.style.display = "none";
  loadingEl.style.display = "flex";

  const sheetId = localStorage.getItem(LS_SHEET_ID);

  try {
    const data = await callBackend("getProducts", { sheetId });
    renderProductList(data.products || []);
    formEl.style.display = "block";
  } catch (err) {
    showMessage(msgEl, "Could not load products: " + err.message, "error");
  } finally {
    loadingEl.style.display = "none";
  }
}

/**
 * Normalizes a product entry into a consistent { name, size, price }
 * shape. The backend currently returns plain product-name strings;
 * once the Apps Script is updated to include Size/Price columns it
 * can return objects instead, and this keeps both cases working.
 */
function normalizeProduct(product) {
  if (typeof product === "string") {
    return { name: product, size: "", price: "" };
  }
  return {
    name: product.name || product.itemName || "",
    size: product.size || "",
    price: product.price !== undefined && product.price !== null ? product.price : "",
  };
}

function buildProductMetaText(product) {
  const parts = [];
  if (product.size) parts.push(product.size);
  if (product.price !== "") parts.push("BDT " + product.price);
  return parts.length ? " | " + parts.join(" | ") : "";
}

function renderProductList(products) {
  const listEl = $("saleProductList");
  listEl.innerHTML = "";

  if (products.length === 0) {
    listEl.innerHTML = '<div class="empty-state">No products yet. Add some from "Manage Products".</div>';
    return;
  }

  products.forEach((rawProduct) => {
    const product = normalizeProduct(rawProduct);
    const metaText = buildProductMetaText(product);

    const card = document.createElement("div");
    card.className = "product-card";
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");

    const nameEl = document.createElement("span");
    nameEl.className = "product-card-name";
    nameEl.textContent = product.name;
    card.appendChild(nameEl);

    if (metaText) {
      const metaEl = document.createElement("span");
      metaEl.className = "product-card-meta";
      metaEl.textContent = metaText;
      card.appendChild(metaEl);
    }

    card.addEventListener("click", () => selectProduct(product.name, card));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectProduct(product.name, card);
      }
    });

    listEl.appendChild(card);
  });
}

function selectProduct(name, cardEl) {
  selectedProduct = name;
  document.querySelectorAll("#saleProductList .product-card").forEach((c) => {
    c.classList.remove("selected");
  });
  cardEl.classList.add("selected");
}

$("saveSaleBtn").addEventListener("click", handleSaveSale);

async function handleSaveSale() {
  const msgEl = $("saleMessage");
  clearMessage(msgEl);

  if (!selectedProduct) {
    showMessage(msgEl, "Please select a product.", "error");
    return;
  }

  const quantityRaw = $("quantityInput").value.trim();
  const quantity = Number(quantityRaw);

  if (!quantityRaw || isNaN(quantity) || quantity <= 0) {
    showMessage(msgEl, "Please enter a valid quantity.", "error");
    $("quantityInput").focus();
    return;
  }

  const notes = $("notesInput").value.trim();
  const sheetId = localStorage.getItem(LS_SHEET_ID);

  const entry = {
    action: "saveSale",
    sheetId,
    itemName: selectedProduct,
    quantity: quantityRaw,
    notes,
  };

  const btn = $("saveSaleBtn");
  btn.disabled = true;

  try {
    if (!navigator.onLine) throw new Error("offline");

    await callBackend("saveSale", entry);
    showMessage(msgEl, "Sale recorded!", "success");
    resetSaleForm();
  } catch (err) {
    if (!navigator.onLine || err.message === "offline") {
      queuePendingEntry(entry);
      showMessage(msgEl, "You're offline — sale saved locally and will sync automatically.", "error");
      resetSaleForm();
    } else {
      showMessage(msgEl, "Could not save sale: " + err.message, "error");
    }
  } finally {
    btn.disabled = false;
  }
}

function resetSaleForm() {
  selectedProduct = null;
  document.querySelectorAll("#saleProductList .product-card").forEach((c) => {
    c.classList.remove("selected");
  });
  $("quantityInput").value = "";
  $("notesInput").value = "";
}

// -----------------------------------------------------------
// SCREEN 4 — RECORD AN EXPENSE
// -----------------------------------------------------------
$("saveExpenseBtn").addEventListener("click", handleSaveExpense);

async function handleSaveExpense() {
  const msgEl = $("expenseMessage");
  clearMessage(msgEl);

  const description = $("descriptionInput").value.trim();
  const amount = $("amountInput").value.trim();
  const sheetId = localStorage.getItem(LS_SHEET_ID);

  if (!description || !amount) {
    showMessage(msgEl, "Please fill in both fields.", "error");
    return;
  }

  const entry = {
    action: "saveExpense",
    sheetId,
    description,
    amount,
  };

  const btn = $("saveExpenseBtn");
  btn.disabled = true;

  try {
    if (!navigator.onLine) throw new Error("offline");

    await callBackend("saveExpense", entry);
    showMessage(msgEl, "Expense recorded!", "success");
    clearExpenseForm();
  } catch (err) {
    if (!navigator.onLine || err.message === "offline") {
      queuePendingEntry(entry);
      showMessage(msgEl, "You're offline — expense saved locally and will sync automatically.", "error");
      clearExpenseForm();
    } else {
      showMessage(msgEl, "Could not save expense: " + err.message, "error");
    }
  } finally {
    btn.disabled = false;
  }
}

function clearExpenseForm() {
  $("descriptionInput").value = "";
  $("amountInput").value = "";
}

// -----------------------------------------------------------
// SCREEN 5 — MANAGE PRODUCTS
// -----------------------------------------------------------
async function loadProductsForManage() {
  const listEl = $("productsList");
  const loadingEl = $("productsLoading");
  const msgEl = $("productsMessage");

  clearMessage(msgEl);
  listEl.style.display = "none";
  listEl.innerHTML = "";
  loadingEl.style.display = "flex";

  const sheetId = localStorage.getItem(LS_SHEET_ID);

  try {
    const data = await callBackend("getProducts", { sheetId });
    renderManageList(data.products || []);
  } catch (err) {
    showMessage(msgEl, "Could not load products: " + err.message, "error");
  } finally {
    loadingEl.style.display = "none";
    listEl.style.display = "flex";
  }
}

function renderManageList(products) {
  const listEl = $("productsList");
  listEl.innerHTML = "";

  if (products.length === 0) {
    listEl.innerHTML = '<li class="empty-state">No products added yet.</li>';
    return;
  }

  products.forEach((rawProduct) => {
    const product = normalizeProduct(rawProduct);
    const metaText = buildProductMetaText(product);

    const li = document.createElement("li");

    const nameEl = document.createElement("span");
    nameEl.className = "product-name";
    nameEl.textContent = product.name;
    li.appendChild(nameEl);

    if (metaText) {
      const metaEl = document.createElement("span");
      metaEl.className = "product-meta";
      metaEl.textContent = metaText;
      li.appendChild(metaEl);
    }

    listEl.appendChild(li);
  });
}

$("addProductBtn").addEventListener("click", handleAddProduct);

async function handleAddProduct() {
  const msgEl = $("productsMessage");
  clearMessage(msgEl);

  const productName = $("newProductInput").value.trim();
  const size = $("newProductSizeInput").value.trim();
  const price = $("newProductPriceInput").value.trim();
  const sheetId = localStorage.getItem(LS_SHEET_ID);

  if (!productName) {
    showMessage(msgEl, "Please enter a product name.", "error");
    return;
  }

  const btn = $("addProductBtn");
  btn.disabled = true;

  try {
    await callBackend("addProduct", { sheetId, productName, size, price });
    $("newProductInput").value = "";
    $("newProductSizeInput").value = "";
    $("newProductPriceInput").value = "";
    showMessage(msgEl, "Product added!", "success");
    loadProductsForManage();
  } catch (err) {
    showMessage(msgEl, "Could not add product: " + err.message, "error");
  } finally {
    btn.disabled = false;
  }
}

// -----------------------------------------------------------
// OFFLINE HANDLING & PENDING SYNC QUEUE
// -----------------------------------------------------------
function getPendingSync() {
  try {
    return JSON.parse(localStorage.getItem(LS_PENDING_SYNC)) || [];
  } catch (e) {
    return [];
  }
}

function setPendingSync(list) {
  localStorage.setItem(LS_PENDING_SYNC, JSON.stringify(list));
}

function queuePendingEntry(entry) {
  const pending = getPendingSync();
  pending.push(entry);
  setPendingSync(pending);
  refreshSyncBadge();
}

/**
 * Attempts to send every queued entry to the backend. Entries that
 * succeed are removed from the queue; entries that fail stay queued
 * for the next attempt.
 */
async function syncPendingEntries() {
  if (!BACKEND_URL) return;

  const pending = getPendingSync();
  if (pending.length === 0) return;

  const stillPending = [];

  for (const entry of pending) {
    try {
      const { action, ...params } = entry;
      await callBackend(action, params);
    } catch (err) {
      stillPending.push(entry);
    }
  }

  setPendingSync(stillPending);
  refreshSyncBadge();
}

function updateOfflineBanner() {
  offlineBanner.classList.toggle("visible", !navigator.onLine);
}

window.addEventListener("online", () => {
  updateOfflineBanner();
  syncPendingEntries();
});

window.addEventListener("offline", updateOfflineBanner);

// -----------------------------------------------------------
// iOS SAFARI "ADD TO HOME SCREEN" BANNER
// -----------------------------------------------------------
/**
 * True on iPhone/iPad/iPod. Deliberately excludes desktop Safari
 * on macOS (which reports "Macintosh", not one of these tokens).
 */
function isIosDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

/**
 * True only for Safari itself on iOS — excludes Chrome, Firefox,
 * Edge, and other browsers on iOS, which all use Safari's engine
 * but identify themselves with their own UA tokens (CriOS, FxiOS,
 * EdgiOS, OPiOS) and can't be "added to home screen" the same way.
 */
function isIosSafari() {
  const ua = navigator.userAgent;
  const isSafariUA = /Safari/.test(ua);
  const isOtherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|mercury/.test(ua);
  return isIosDevice() && isSafariUA && !isOtherBrowser;
}

/**
 * True if the app is already running as an installed home-screen
 * app (standalone), whether launched on iOS or via the standard
 * PWA display-mode media query on other platforms.
 */
function isRunningStandalone() {
  const iosStandalone = window.navigator.standalone === true;
  const displayModeStandalone = window.matchMedia("(display-mode: standalone)").matches;
  return iosStandalone || displayModeStandalone;
}

function shouldShowIosInstallBanner() {
  if (isRunningStandalone()) return false;
  if (!isIosSafari()) return false;
  if (localStorage.getItem(LS_IOS_BANNER_DISMISSED) === "true") return false;
  return true;
}

function showIosInstallBanner() {
  const banner = $("iosInstallBanner");
  banner.classList.add("visible");
  document.body.classList.add("ios-banner-visible");
}

function dismissIosInstallBanner() {
  const banner = $("iosInstallBanner");
  banner.classList.remove("visible");
  document.body.classList.remove("ios-banner-visible");
  localStorage.setItem(LS_IOS_BANNER_DISMISSED, "true");
}

function initIosInstallBanner() {
  if (shouldShowIosInstallBanner()) {
    showIosInstallBanner();
  }
  $("iosBannerClose").addEventListener("click", dismissIosInstallBanner);
}

// -----------------------------------------------------------
// APP INIT
// -----------------------------------------------------------
function init() {
  updateOfflineBanner();
  initIosInstallBanner();

  const savedSheetId = localStorage.getItem(LS_SHEET_ID);
  const savedBusinessName = localStorage.getItem(LS_BUSINESS_NAME);

  if (savedSheetId) {
    applyBusinessNameToHeader(savedBusinessName || "");
    showScreen("home");
    if (navigator.onLine) syncPendingEntries();
  } else {
    showScreen("setup");
  }
}

init();
