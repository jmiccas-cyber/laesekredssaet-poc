// Læsekredssæt v4.1 (clean drop-in)
// Bevarer funktionalitet fra v4.0, men med ryddet struktur.

// ----------------------------------------------------------
// 1. Konfiguration & utilities
// ----------------------------------------------------------

const SUPABASE_URL = "https://qlkrzinyqirnigcwadki.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFsa3J6aW55cWlybmlnY3dhZGtpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3NjY2NjgsImV4cCI6MjA3ODM0MjY2OH0.-SV3dn7reKHeYis40I-aF3av0_XmCP-ZqB9KR6JT2so";
const HOLIDAY_TABLE = "tbl_national_holidays";
const LOCAL_HOLIDAY_TABLE = "tbl_local_holidays";
const BOOKING_RULE_TABLE = "tbl_booking_rules";
const BOOKING_STATUS_AVAILABLE = "available";
const BOOKING_STATUS_REQUESTED = "requested";
const BOOKING_STATUS_BOOKED = "booked";
const BOOKING_STATUS_CANCELLED = "cancelled";
const BOOKING_RULE_FIRST_DAY = "first_working_day";
const BOOKING_RULE_EVERY14 = "every_14_days";
const BOOKING_SLOT_HORIZON_MONTHS = 12;
const BOOKING_RULE_OPTIONS = [
  { value: BOOKING_RULE_FIRST_DAY, label: "Kun fra første hverdag i måneden" },
  { value: BOOKING_RULE_EVERY14, label: "Hver 14. dag (førstkommende hverdag)" }
];
const BOOKING_RULE_DEFAULT = BOOKING_RULE_FIRST_DAY;

let sb = null; // Supabase client

const $  = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of kids) {
    if (c == null) continue;
    if (c instanceof Node) n.appendChild(c);
    else n.appendChild(document.createTextNode(String(c)));
  }
  return n;
}

function show(node) { if (node) node.style.display = ""; }
function hide(node) { if (node) node.style.display = "none"; }
function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
}

function setActiveButtonState(btn, val) {
  if (!btn) return;
  const normalized = val === "false" ? "false" : "true";
  btn.dataset.value = normalized;
  btn.textContent = normalized === "true" ? "Aktiv" : "Inaktiv";
  btn.style.background = normalized === "true" ? "#2e8540" : "#c32626";
  btn.style.color = "#fff";
}

let sheetJsPromise = null;
let accessUpdating = false;
function ensureSheetJs() {
  if (window.XLSX) return Promise.resolve();
  if (!sheetJsPromise) {
    sheetJsPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Kunne ikke indlæse Excel-biblioteket."));
      document.head.appendChild(script);
    });
  }
  return sheetJsPromise;
}

function showMsg(selectorOrEl, text, ok = false) {
  const box = typeof selectorOrEl === "string" ? $(selectorOrEl) : selectorOrEl;
  if (!box) return;
  box.textContent = text || "";
  box.style.display = text ? "block" : "none";
  box.classList.toggle("ok", !!ok);
}

function fmtLibLabel(lib) {
  if (!lib) return "";
  return `${lib.bibliotek_navn} (${lib.bibliotek_id})`;
}

function fmtOwnerCity(lib) {
  if (!lib) return "";
  const name = lib.bibliotek_navn || "";
  const idx = name.toLowerCase().indexOf("centralbibliotek");
  if (idx > 0) {
    return name.slice(0, idx).trim();
  }
  return (name.split(" ")[0] || name).trim();
}

function isSuperLibrary(lib) {
  if (!lib) return false;
  if (lib.is_super_admin) return true;
  const id = (lib.bibliotek_id || "").toLowerCase();
  return id === "gent";
}

function currentAdminId() {
  return st.profile?.adminCentralId || "";
}

// ----------------------------------------------------------
// 2. Global state
// ----------------------------------------------------------

const PROFILE_KEY = "laesekredss_profile_v41";

const st = {
  role: "admin", // 'admin' | 'booker'
  profile: {
    adminCentralId: null,
    bookerLocalId: null
  },
  libs: {
    list: [],
    byId: {},
    centrals: [],
    locals: []
  },
  stock: {
    list: [],
    byOwner: {},
    byOwnerMap: {}
  },
  eks: {
    page: 0,
    pageSize: 20,
    total: 0,
    q: "",
    sortBy: "barcode",
    sortDir: "asc"
  },
  saet: {
    page: 0,
    pageSize: 15,
    total: 0,
    owner: "",
    ownerAdminId: "",
    vis: "",
    q: "",
    sortBy: "set_id",
    sortDir: "asc",
    usage: {}
  },
  calendar: {
    list: [],
    local: [],
    localSets: {}
  },
  booking: {
    requests: []
  },
  bookingRules: {
    byOwner: {},
    owner: ""
  },
  b: {
    page: 0,
    pageSize: 15,
    total: 0,
    q: "",
    start: null,
    weeks: 8,
    results: [],
    allResults: [],
    centralIds: [], // relationer for booker
    sortBy: "title",
    sortDir: "asc"
  }
};

const bookingSlotLocks = new Set();

// ----------------------------------------------------------
// 3. Supabase & profil
// ----------------------------------------------------------

function initSupabase() {
  if (!window.supabase || !window.supabase.createClient) {
    console.error("Supabase JS bibliotek ikke fundet. Tjek <script src='supabase.min.js'> i index.html.");
    return;
  }
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log("âœ… Supabase klient initialiseret");
}

function loadProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed.role) st.role = parsed.role;
    if (parsed.profile) st.profile = { ...st.profile, ...parsed.profile };
  } catch (e) {
    console.warn("Kunne ikke loade profil:", e);
  }
}

function saveProfile() {
  localStorage.setItem(PROFILE_KEY, JSON.stringify({
    role: st.role,
    profile: st.profile
  }));
}

// ----------------------------------------------------------
// 4. Biblioteker (tbl_bibliotek)
// ----------------------------------------------------------

async function loadLibraries() {
  if (!sb) {
    console.error("loadLibraries: Supabase-klient ikke initialiseret.");
    st.libs.list = [];
    st.libs.byId = {};
    st.libs.centrals = [];
    st.libs.locals = [];
    return;
  }

  // Hent alle kolonner for robusthed (nogle installationer kan have ekstra felter)
  const { data, error } = await sb
    .from("tbl_bibliotek")
    .select("*")
    .order("is_central", { ascending: false })
    .order("bibliotek_navn", { ascending: true });

  console.debug("loadLibraries: raw data", data, "error", error);

  if (error) {
    console.error("Fejl ved loadLibraries:", error);
    st.libs.list = [];
    st.libs.byId = {};
    st.libs.centrals = [];
    st.libs.locals = [];
    return;
  }

  const rows = (data || []).filter(x => x.active !== false);
  console.log("loadLibraries: hentede", rows.length, "biblioteker");

  st.libs.list = rows;
  st.libs.byId = Object.fromEntries(rows.map(x => [x.bibliotek_id, x]));
  st.libs.centrals = rows.filter(x => x.is_central);
  st.libs.locals = rows.filter(x => !x.is_central);
  populateCentralDropdown(document.querySelector("#relFilterSel"), { includeAll: true, allLabel: "(alle centralbiblioteker)" });
  populateCentralDropdown(document.querySelector("#relCentralAssign"));
  populateCentralDropdown(document.querySelector("#newLocalCentral"));
  const defaultCentral = st.profile.adminCentralId || st.libs.centrals[0]?.bibliotek_id || "";
  const assignSel = document.querySelector("#relCentralAssign");
  const newCentralSel = document.querySelector("#newLocalCentral");
  if (assignSel && !assignSel.value) assignSel.value = defaultCentral;
  if (newCentralSel && !newCentralSel.value) newCentralSel.value = defaultCentral;
  populateSaetOwnerSelect();
  populateBookingRuleOwnerSelect();

  // SÃ¦t-ejer filter
  populateRegionSelects();
  renderAccessTable();

// Hvis der ikke er valgt admin-central, sÃ¦t default = Gentofte eller fÃ¸rste central
  if (!st.profile.adminCentralId && st.libs.centrals.length) {
    const gent = st.libs.centrals.find(x =>
      (x.bibliotek_navn || "").toLowerCase().includes("gentofte")
    );
    const chosen = gent || st.libs.centrals[0];
    st.profile.adminCentralId = chosen.bibliotek_id;
    st.role = "admin";
    saveProfile();
  }
}

// Centraliseret: fyld profil-dropdowns i modal
function populateCentralDropdown(select, { includeAll = false, allLabel = "(alle)" } = {}) {
  if (!select) return;
  select.innerHTML = "";
  if (includeAll) {
    select.appendChild(el("option", { value: "" }, allLabel));
  }
  st.libs.centrals.forEach(lib => {
    select.appendChild(el("option", { value: lib.bibliotek_id }, fmtLibLabel(lib)));
  });
}

function populateSaetOwnerSelect() {
  populateCentralDropdown(document.querySelector("#saetOwnerFilterSel"));
}

function populateBookingRuleOwnerSelect() {
  populateCentralDropdown(document.querySelector("#bookingRuleOwnerSel"));
}

function populateRegionSelects() {
  const locals = st.libs.locals || [];
  const relLocal = document.querySelector("#relLocal");
  if (relLocal) {
    relLocal.innerHTML = "";
    locals.forEach(lib => {
      relLocal.appendChild(el("option", { value: lib.bibliotek_id }, fmtLibLabel(lib)));
    });
  }
  const detailSel = document.querySelector("#relDetailSel");
  if (detailSel) {
    const current = detailSel.value;
    detailSel.innerHTML = '<option value="">(vÃ¦lg regionsbibliotek)</option>';
    locals.forEach(lib => {
      detailSel.appendChild(el("option", { value: lib.bibliotek_id }, fmtLibLabel(lib)));
    });
    if (current && locals.some(lib => lib.bibliotek_id === current)) {
      detailSel.value = current;
    }
    renderRegionDetails();
  }
}

function renderRegionDetails() {
  const id = $("#relDetailSel")?.value || "";
  const info = $("#relDetailInfo");
  const fields = {
    name: $("#relDetailName"),
    address: $("#relDetailAddress"),
    postal: $("#relDetailPostal"),
    city: $("#relDetailCity"),
    notes: $("#relDetailNotes"),
    active: $("#relDetailActive"),
    saveBtn: $("#btnRelDetailSave")
  };
  const resetFields = () => {
    if (fields.name) fields.name.value = "";
    if (fields.address) fields.address.value = "";
    if (fields.postal) fields.postal.value = "";
    if (fields.city) fields.city.value = "";
    if (fields.notes) fields.notes.value = "";
    if (fields.active) fields.active.value = "true";
  };
  const setDisabled = disabled => {
    Object.values(fields).forEach(ctrl => {
      if (!ctrl) return;
      ctrl.disabled = disabled;
    });
  };

  resetFields();
  setDisabled(true);
  if (info) info.textContent = "Vælg et regionsbibliotek for at se detaljer.";

  if (!id) {
    return;
  }

  const lib = st.libs.byId[id];
  if (!lib) {
    if (info) info.textContent = "Biblioteket findes ikke længere.";
    return;
  }

  if (fields.name) fields.name.value = lib.bibliotek_navn || "";
  if (fields.address) fields.address.value = lib.addr_line1 || "";
  if (fields.postal) fields.postal.value = lib.postal_code || "";
  if (fields.city) fields.city.value = lib.city || "";
  if (fields.notes) fields.notes.value = lib.shipping_notes || "";
  if (fields.active) fields.active.value = lib.active !== false ? "true" : "false";
  setDisabled(false);
  if (info) info.textContent = "Opdater oplysninger og tryk Gem detaljer.";
}

async function saveRegionDetails() {
  if (!sb) return;
  const info = $("#relDetailInfo");
  const id = $("#relDetailSel")?.value || "";
  if (!id) {
    if (info) info.textContent = "Vælg et regionsbibliotek først.";
    return;
  }
  const name = $("#relDetailName")?.value?.trim() || "";
  const addr_line1 = $("#relDetailAddress")?.value?.trim() || "";
  const postal_code = $("#relDetailPostal")?.value?.trim() || "";
  const city = $("#relDetailCity")?.value?.trim() || "";
  const shipping_notes = $("#relDetailNotes")?.value?.trim() || "";
  const activeStr = $("#relDetailActive")?.value || "true";
  const active = activeStr === "true";

  if (!name) {
    if (info) info.textContent = "Navn skal udfyldes.";
    return;
  }

  const payload = { bibliotek_navn: name, addr_line1, postal_code, city, shipping_notes, active };
  const { error } = await sb.from("tbl_bibliotek").update(payload).eq("bibliotek_id", id);
  if (error) {
    if (info) info.textContent = "Fejl ved opdatering: " + error.message;
    return;
  }

  if (st.libs.byId[id]) {
    Object.assign(st.libs.byId[id], payload);
  }
  populateRegionSelects();
  await relList();
  if (info) info.textContent = "Detaljer opdateret.";
}
function loadProfileDropdown() {
  const adminSel = document.querySelector("#adminProfileSel");
  const bookerSel = document.querySelector("#bookerProfileSel");
  if (!adminSel || !bookerSel) return;

  adminSel.innerHTML = "";
  bookerSel.innerHTML = "";

  const centrals = st.libs.centrals || [];
  const locals = st.libs.locals || [];

  if (!centrals.length) {
    adminSel.appendChild(el("option", { value: "" }, "(ingen centralbiblioteker fundet)"));
  } else {
    centrals.forEach(lib => {
      adminSel.appendChild(el("option", { value: lib.bibliotek_id }, fmtLibLabel(lib)));
    });
  }

  if (!locals.length) {
    bookerSel.appendChild(el("option", { value: "" }, "(ingen regionsbiblioteker fundet)"));
  } else {
    locals.forEach(lib => {
      bookerSel.appendChild(el("option", { value: lib.bibliotek_id }, fmtLibLabel(lib)));
    });
  }

  if (st.profile.adminCentralId && st.libs.byId[st.profile.adminCentralId]) {
    adminSel.value = st.profile.adminCentralId;
  } else if (centrals.length) {
    adminSel.value = centrals[0].bibliotek_id;
  }

  if (st.profile.bookerLocalId && st.libs.byId[st.profile.bookerLocalId]) {
    bookerSel.value = st.profile.bookerLocalId;
  } else if (locals.length) {
    bookerSel.value = locals[0].bibliotek_id;
  }
}

// ----------------------------------------------------------
// 5. Rolle / layout / profil-modal
// ----------------------------------------------------------

function renderRoleBadge() {
  const roleBadge = $("#roleBadge");
  const roleText = $("#roleText");
  const profileText = $("#profileText");
  const relCentralReadonly = $("#relCentralReadonly");

  if (!roleBadge || !roleText || !profileText) return;

  roleBadge.classList.toggle("role-admin", st.role === "admin");
  roleBadge.classList.toggle("role-booker", st.role === "booker");
  roleText.textContent = st.role === "admin" ? "Admin" : "Booker";

  if (st.role === "admin") {
    const id = st.profile.adminCentralId;
    const lib = id ? st.libs.byId[id] : null;
    profileText.textContent = lib ? ` Â· ${fmtLibLabel(lib)}` : " Â· (ingen central valgt)";
    if (relCentralReadonly) {
      relCentralReadonly.value = lib ? fmtLibLabel(lib) : "";
    }
  } else {
    const id = st.profile.bookerLocalId;
    const lib = id ? st.libs.byId[id] : null;
    profileText.textContent = lib ? ` Â· ${fmtLibLabel(lib)}` : " Â· (ingen regionsbibliotek valgt)";
  }
}

function renderLayout() {
  const adminTabs = $("#adminTabs");
  const bookerView = $("#bookerView");
  const panels = $$(".panel");
  const adminLib = st.libs.byId[currentAdminId()];
  const isSuper = isSuperLibrary(adminLib);
  ["tab-region", "tab-access"].forEach(tabId => {
    const btn = document.querySelector(`nav.tabs button[data-tab="${tabId}"]`);
    const panel = $("#" + tabId);
    if (btn) btn.style.display = isSuper ? "" : "none";
    if (panel) panel.style.display = isSuper ? "" : "none";
    if (!isSuper && panel?.classList.contains("active")) {
      panel.classList.remove("active");
      btn?.classList.remove("active");
    }
  });
  const firstTabBtn = document.querySelector('nav.tabs button[data-tab="tab-eks"]');
  if (firstTabBtn && !firstTabBtn.classList.contains("active") && !document.querySelector('nav.tabs button.active')) {
    firstTabBtn.click();
  }

  if (!adminTabs || !bookerView) return;

  if (st.role === "admin") {
    adminTabs.classList.remove("hidden");
    bookerView.classList.add("hidden");

    // Aktiver fÃ¸rste admin-tab, hvis ingen valgt
    if (!panels.some(p => p.classList.contains("active"))) {
      const firstBtn = document.querySelector('nav.tabs button[data-tab="tab-eks"]');
      if (firstBtn) firstBtn.click();
    }
  } else {
    adminTabs.classList.add("hidden");
    bookerView.classList.remove("hidden");
    panels.forEach(p => p.classList.remove("active"));
    $("#bookerView")?.classList.add("active");
  }
}

function bindTabs() {
  const tabButtons = $$(".tabs button[data-tab]");
  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const tabId = btn.getAttribute("data-tab");
      tabButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      $$(".panel").forEach(p => p.classList.remove("active"));
      const panel = $("#" + tabId);
      if (panel) panel.classList.add("active");
      handleTabActivated(tabId);
    });
  });
}

function handleTabActivated(tabId) {
  if (tabId === "tab-calendar") {
    calendarPullGlobal();
    calendarPullLocal();
  } else if (tabId === "tab-booking") {
    bookingRulePull();
  } else if (tabId === "tab-requests") {
    bookingRequestsPull();
  }
}

async function openRoleModal(targetRole) {
  const modal = document.querySelector("#roleModal");
  if (!modal) return;

  const roleSelect = document.querySelector("#roleSelect");
  const adminWrap  = document.querySelector("#adminProfileWrap");
  const bookerWrap = document.querySelector("#bookerProfileWrap");
  const adminSel   = document.querySelector("#adminProfileSel");
  const bookerSel  = document.querySelector("#bookerProfileSel");

  // 1) Hent biblioteker frisk hver gang modal Ã¥bnes
  await loadLibraries();

  // 2) Hvis der stadig ikke er biblioteker, giv en klar fejl
  if (!st.libs.list.length) {
    alert("Der blev ikke hentet nogen biblioteker fra databasen. Tjek tbl_bibliotek og RLS.");
    adminSel.innerHTML = "";
    bookerSel.innerHTML = "";
    modal.style.display = "flex";
    return;
  }

  roleSelect.value = targetRole || st.role;

  // 3+4) Fyld dropdowns via central helper
  await loadProfileDropdown();

  // 5) Vis/hide blokke afhÃ¦ngigt af valgt rolle
  function updateRoleWrap() {
    if (roleSelect.value === "admin") {
      adminWrap.style.display = "block";
      bookerWrap.style.display = "none";
    } else {
      adminWrap.style.display = "none";
      bookerWrap.style.display = "block";
    }
  }
  roleSelect.onchange = updateRoleWrap;
  updateRoleWrap();

  // 6) Gem-knap
  document.querySelector("#roleSave").onclick = async () => {
    const newRole = roleSelect.value;

    if (newRole === "admin") {
      if (!adminSel.value) {
        alert("VÃ¦lg et centralbibliotek.");
        return;
      }
      st.role = "admin";
      st.profile.adminCentralId = adminSel.value;
      saveProfile();
      await refreshForRole();
      modal.style.display = "none";
      return;
    }

    if (newRole === "booker") {
      if (!bookerSel.value) {
        alert("VÃ¦lg et regionsbibliotek.");
        return;
      }
      st.role = "booker";
      st.profile.bookerLocalId = bookerSel.value;
      saveProfile();
      await refreshForRole();
      modal.style.display = "none";
      return;
    }
  };

  // 7) Annuller
  document.querySelector("#roleCancel").onclick = () => {
    modal.style.display = "none";
  };

  modal.style.display = "flex";
}

function bindRoleControls() {
  $("#roleBadge")?.addEventListener("click", () => openRoleModal());
  $("#toggleRole")?.addEventListener("click", () => {
    const target = st.role === "admin" ? "booker" : "admin";
    openRoleModal(target);
  });
}

// ----------------------------------------------------------
// 6. Admin â€“ Eksemplarer (tbl_beholdning)
// ----------------------------------------------------------

async function eksCount() {
  if (!sb || !st.profile.adminCentralId) return 0;
  let q = sb.from("tbl_beholdning").select("*", { count: "exact", head: true })
    .eq("owner_bibliotek_id", st.profile.adminCentralId);
  if (st.eks.q) {
    const v = st.eks.q;
    q = q.or([
      `title.ilike.%${v}%`,
      `author.ilike.%${v}%`,
      `isbn.ilike.%${v}%`,
      `faust.ilike.%${v}%`,
      `barcode.ilike.%${v}%`
    ].join(","));
  }
  const { count, error } = await q;
  if (error) {
    showMsg("#msg", "Fejl ved hentning: " + error.message);
    return 0;
  }
  return count || 0;
}

async function eksFetch() {
  if (!sb || !st.profile.adminCentralId) return [];
  const from = st.eks.page * st.eks.pageSize;
  const to = from + st.eks.pageSize - 1;

  let q = sb.from("tbl_beholdning")
    .select("barcode,title,author,isbn,faust,aktiv")
    .eq("owner_bibliotek_id", st.profile.adminCentralId);

  if (st.eks.q) {
    const v = st.eks.q;
    q = q.or([
      `title.ilike.%${v}%`,
      `author.ilike.%${v}%`,
      `isbn.ilike.%${v}%`,
      `faust.ilike.%${v}%`,
      `barcode.ilike.%${v}%`
    ].join(","));
  }

  const sortMap = {
    barcode: "barcode",
    title: "title",
    author: "author",
    isbn: "isbn",
    faust: "faust"
  };
  const sortKey = sortMap[st.eks.sortBy] || "barcode";
  const ascending = st.eks.sortDir !== "desc";
  q = q.order(sortKey, { ascending });
  if (sortKey !== "barcode") {
    q = q.order("barcode", { ascending: true });
  }

  q = q.range(from, to);

  const { data, error } = await q;
  if (error) {
    showMsg("#msg", "Fejl ved hentning: " + error.message);
    return [];
  }
  return data || [];
}

function eksDirtyRows() {
  return Array.from(document.querySelectorAll("#tblEks tbody tr"))
    .filter(tr => tr.dataset.dirty === "1");
}

function updateEksSaveButton() {
  const btn = $("#btnSaveAll");
  if (!btn) return;
  const dirtyCount = eksDirtyRows().length;
  btn.disabled = dirtyCount === 0;
  if (dirtyCount > 0) {
    const suffix = dirtyCount > 1 ? "Ã¦ndringer" : "Ã¦ndring";
    btn.textContent = `Gem ${dirtyCount} ${suffix}`;
  } else {
    btn.textContent = "Gem alle Ã¦ndringer";
  }
}

async function loadInventorySummary() {
  if (!sb) return;

  const { data, error } = await sb
    .from("tbl_beholdning")
    .select("owner_bibliotek_id,isbn,title,author,faust,aktiv")
    .neq("isbn", "")
    .order("title", { ascending: true });

  if (error) {
    console.error("Fejl ved loadInventorySummary:", error);
    st.stock.list = [];
    st.stock.byOwner = {};
    st.stock.byOwnerMap = {};
    return;
  }

  const rows = data || [];
  const aggregates = {};
  rows.forEach(row => {
    const owner = row.owner_bibliotek_id || "";
    const isbn = row.isbn || "";
    if (!owner || !isbn) return;
    const key = `${owner}::${isbn}`;
    if (!aggregates[key]) {
      aggregates[key] = {
        owner_bibliotek_id: owner,
        isbn,
        title: row.title,
        author: row.author,
        faust: row.faust,
        count: 0
      };
    } else {
      if (!aggregates[key].title && row.title) aggregates[key].title = row.title;
      if (!aggregates[key].author && row.author) aggregates[key].author = row.author;
      if (!aggregates[key].faust && row.faust) aggregates[key].faust = row.faust;
    }
    if (row.aktiv !== false) {
      aggregates[key].count++;
    }
  });

  st.stock.list = Object.values(aggregates);
  st.stock.byOwner = {};
  st.stock.byOwnerMap = {};

  st.stock.list.forEach(row => {
    const owner = row.owner_bibliotek_id;
    if (!st.stock.byOwner[owner]) {
      st.stock.byOwner[owner] = [];
      st.stock.byOwnerMap[owner] = {};
    }
    const meta = {
      owner_bibliotek_id: owner,
      isbn: row.isbn,
      title: row.title,
      author: row.author,
      faust: row.faust,
      count: Number(row.count) || 0
    };
    st.stock.byOwner[owner].push(meta);
    if (meta.isbn) {
      st.stock.byOwnerMap[owner][meta.isbn] = meta;
    }
  });

  Object.values(st.stock.byOwner).forEach(list => {
    list.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  });

  refreshSaetInventoryControls();
  refreshSaetAvailabilityIndicators();
}

async function syncSaetMetadataFromIsbns(isbns) {
  if (!sb) return;
  const unique = Array.from(
    new Set(
      (isbns || [])
        .map(isbn => (isbn || "").trim())
        .filter(Boolean)
    )
  );
  if (!unique.length) return;

  const { data, error } = await sb
    .from("tbl_beholdning")
    .select("isbn,title,author,faust")
    .in("isbn", unique);
  if (error) {
    console.error("Fejl ved syncSaetMetadataFromIsbns:", error);
    return;
  }

  const metaMap = {};
  (data || []).forEach(row => {
    const isbn = (row.isbn || "").trim();
    if (!isbn || metaMap[isbn]) return;
    metaMap[isbn] = {
      title: row.title || "",
      author: row.author || "",
      faust: row.faust || ""
    };
  });
  const entries = Object.entries(metaMap);
  if (!entries.length) return;

  let anyUpdated = false;
  for (const [isbn, meta] of entries) {
    const { error: updError } = await sb
      .from("tbl_saet")
      .update({
        title: meta.title,
        author: meta.author,
        faust: meta.faust
      })
      .eq("isbn", isbn);
    if (updError) {
      console.error("Kunne ikke opdatere sæt for ISBN", isbn, updError);
    } else {
      anyUpdated = true;
    }
  }

  if (anyUpdated && $("#tab-saet")?.classList.contains("active")) {
    await saetPull();
  }
}

function getOwnerInventory(ownerId) {
  if (!ownerId) return [];
  return st.stock.byOwner[ownerId] || [];
}

function getInventoryMeta(ownerId, isbn) {
  if (!ownerId || !isbn) return null;
  return st.stock.byOwnerMap[ownerId]?.[isbn] || null;
}

function getInventoryCount(ownerId, isbn) {
  const meta = getInventoryMeta(ownerId, isbn);
  return meta ? Number(meta.count) || 0 : 0;
}

async function fetchOwnerBarcodes(ownerId) {
  if (!sb || !ownerId) return new Map();
  const { data, error } = await sb
    .from("tbl_beholdning")
    .select("barcode,isbn")
    .eq("owner_bibliotek_id", ownerId);
  if (error) {
    showMsg("#msg", "Kunne ikke hente eksisterende eksemplarer: " + error.message);
    return null;
  }
  const map = new Map();
  (data || []).forEach(row => {
    if (!row.barcode) return;
    map.set(row.barcode, row.isbn || "");
  });
  return map;
}

async function fetchOwnerSetMap(ownerId) {
  if (!sb || !ownerId) return new Map();
  const { data, error } = await sb
    .from("tbl_saet")
    .select("set_id,isbn,requested_count")
    .eq("owner_bibliotek_id", ownerId);
  if (error) {
    showMsg("#msgSaet", "Kunne ikke hente eksisterende sæt: " + error.message);
    return null;
  }
  const map = new Map();
  (data || []).forEach(row => {
    if (row.set_id != null) {
      map.set(String(row.set_id), row);
    }
  });
  return map;
}
function markEksDirty(tr) {
  if (!tr) return;
  tr.dataset.dirty = "1";
  tr.classList.add("dirty");
  updateEksSaveButton();
}

function clearEksDirty(tr) {
  if (!tr) return;
  tr.dataset.dirty = "";
  tr.classList.remove("dirty");
  updateEksSaveButton();
}

function eksAttachRowListeners(tr) {
  if (!tr) return;
  const fields = tr.querySelectorAll("input, select");
  fields.forEach(field => {
    field.addEventListener("input", () => markEksDirty(tr));
    field.addEventListener("change", () => markEksDirty(tr));
  });
}

function eksCollectRow(tr) {
  if (!tr) return null;
  const barcode = tr.dataset.barcode || tr.querySelector(".bc")?.value || "";
  return {
    barcode: (barcode || "").trim(),
    title: tr.querySelector(".title")?.value.trim() || "",
    author: tr.querySelector(".author")?.value.trim() || "",
    isbn: tr.querySelector(".isbn")?.value.trim() || "",
    faust: tr.querySelector(".faust")?.value.trim() || "",
    aktiv: tr.querySelector(".active-flag")?.dataset.value !== "false",
    loan_status: "Ukendt",
    owner_bibliotek_id: st.profile.adminCentralId
  };
}

function renderEksPagerInfo() {
  const totalPages = Math.ceil((st.eks.total || 0) / st.eks.pageSize);
  $("#pinfo").textContent = st.eks.total
    ? `Side ${st.eks.page + 1}/${totalPages} - ${st.eks.total} eksemplarer`
    : "Ingen eksemplarer fundet";
}

function eksRevertRow(tr) {
  if (!tr) return;
  const raw = tr.dataset.original;
  if (!raw) return;
  try {
    const original = JSON.parse(raw);
    tr.querySelector(".title").value = original.title || "";
    tr.querySelector(".author").value = original.author || "";
    tr.querySelector(".isbn").value = original.isbn || "";
    tr.querySelector(".faust").value = original.faust || "";
    const aktBtn = tr.querySelector(".active-flag");
    if (aktBtn) {
      setActiveButtonState(aktBtn, original.aktiv === false ? "false" : "true");
    }
    clearEksDirty(tr);
  } catch (e) {
    console.warn("Kunne ikke fortryde rÃ¦kke", e);
  }
}

function setEksSort(field) {
  const valid = {
    barcode: true,
    title: true,
    author: true,
    isbn: true,
    faust: true,
    aktiv: true
  };
  if (!valid[field]) return;
  if (st.eks.sortBy === field) {
    st.eks.sortDir = st.eks.sortDir === "asc" ? "desc" : "asc";
  } else {
    st.eks.sortBy = field;
    st.eks.sortDir = "asc";
  }
  st.eks.page = 0;
  eksPull();
}

function updateEksSortIndicators() {
  document.querySelectorAll("#tblEks thead th[data-sort]").forEach(th => {
    const field = th.dataset.sort;
    th.classList.toggle("sorted-asc", field === st.eks.sortBy && st.eks.sortDir === "asc");
    th.classList.toggle("sorted-desc", field === st.eks.sortBy && st.eks.sortDir === "desc");
  });
}

async function eksSaveAll() {
  if (!sb) return;
  if (!st.profile.adminCentralId) {
    showMsg("#msg", "VÃ¦lg fÃ¸rst en admin-profil.");
    return;
  }
  const dirtyRows = eksDirtyRows();
  if (!dirtyRows.length) {
    showMsg("#msg", "Der er ingen Ã¦ndringer at gemme.");
    return;
  }

  const payload = [];
  for (const tr of dirtyRows) {
    const rec = eksCollectRow(tr);
    const err = eksValidate(rec || {});
    if (err) {
      showMsg("#msg", `Fejl i rÃ¦kke (${rec?.barcode || "ny"}): ${err}`);
      tr.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    payload.push(rec);
  }

  showMsg("#msg", "Gemmer Ã¦ndringer...");
  const { error } = await sb.from("tbl_beholdning").upsert(payload, { onConflict: "barcode" });
  if (error) {
    showMsg("#msg", "Fejl ved gem: " + error.message);
    return;
  }

  showMsg("#msg", `Gemte ${payload.length} Ã¦ndring${payload.length > 1 ? "er" : ""}.`, true);
  await eksPull();
  await loadInventorySummary();
  await syncSaetMetadataFromIsbns(payload.map(r => r.isbn));
}

function eksValidate(r) {
  if (!r.barcode) return "Stregkode skal udfyldes";
  if (!r.title) return "Titel skal udfyldes";
  if (typeof r.aktiv !== "boolean") {
    r.aktiv = true;
  }
  return null;
}

async function exportEksToExcel() {
  if (!sb) return;
  const ownerId = currentAdminId();
  if (!ownerId) {
    showMsg("#msg", "Vælg først en admin-profil (centralbibliotek) via Skift: Admin ↔ Booker.");
    return;
  }

  showMsg("#msg", "Henter eksemplarer til Excel …");
  const { data, error } = await sb
    .from("tbl_beholdning")
    .select("barcode,title,author,isbn,faust,aktiv")
    .eq("owner_bibliotek_id", ownerId)
    .order("barcode");

  if (error) {
    showMsg("#msg", "Kunne ikke hente eksemplarer: " + error.message);
    return;
  }

  try {
    await ensureSheetJs();
  } catch (e) {
    showMsg("#msg", e.message);
    return;
  }

  const rows = (data || []).map(row => ({
    Handling: "Opdater",
    Barcode: row.barcode || "",
    Titel: row.title || "",
    Forfatter: row.author || "",
    ISBN: row.isbn || "",
    FAUST: row.faust || "",
    Aktiv: row.aktiv === false ? "Inaktiv" : "Aktiv"
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{
    Handling: "Opdater",
    Barcode: "",
    Titel: "",
    Forfatter: "",
    ISBN: "",
    FAUST: "",
    Aktiv: "Aktiv"
  }]);
  XLSX.utils.book_append_sheet(wb, ws, "Eksemplarer");
  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `eksemplarer_${ownerId}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showMsg("#msg", "Excel klar til download.", true);
}

async function importEksFromExcel(file) {
  if (!sb || !file) return;
  const ownerId = currentAdminId();
  if (!ownerId) {
    showMsg("#msg", "Vælg først en admin-profil (centralbibliotek) via Skift: Admin ↔ Booker.");
    return;
  }

  showMsg("#msg", "Indlæser Excel …");
  try {
    await ensureSheetJs();
  } catch (e) {
    showMsg("#msg", e.message);
    return;
  }

  await loadInventorySummary();
  const usageMap = await fetchSaetUsage();
  st.saet.usage = usageMap;
  const existing = await fetchOwnerBarcodes(ownerId);

  let workbook;
  try {
    const buffer = await file.arrayBuffer();
    workbook = XLSX.read(buffer, { type: "array" });
  } catch (e) {
    showMsg("#msg", "Kunne ikke læse Excel-filen: " + e.message);
    return;
  }

  const sheetName = workbook.SheetNames?.[0];
  if (!sheetName) {
    showMsg("#msg", "Excel-filen indeholder ingen ark.");
    return;
  }

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
  if (!rows.length) {
    showMsg("#msg", "Excel-arket er tomt.");
    return;
  }

  const updates = [];
  const deletions = [];
  const failures = [];
  const seen = new Set();

  const getValue = (row, ...keys) => {
    for (const key of keys) {
      if (row[key] != null && row[key] !== "") return row[key];
      const lower = typeof key === "string" ? key.toLowerCase() : key;
      if (row[lower] != null && row[lower] !== "") return row[lower];
    }
    return "";
  };

  rows.forEach((row, idx) => {
    const line = idx + 2;
    const barcode = String(getValue(row, "Barcode", "barcode", "Stregkode")).trim();
    if (!barcode) {
      failures.push(`Række ${line}: mangler stregkode.`);
      return;
    }
    if (seen.has(barcode)) {
      failures.push(`Række ${line}: stregkode ${barcode} er duplikeret i Excel.`);
      return;
    }
    seen.add(barcode);

    let action = String(getValue(row, "Handling", "handling", "Action")).trim().toLowerCase();
    if (!action) action = "opdater";

    if (action === "slet") {
      const isbn = existing.get(barcode);
      if (!isbn) {
        failures.push(`Række ${line}: stregkode ${barcode} findes ikke i databasen.`);
        return;
      }
      deletions.push({ barcode, isbn });
      return;
    }

    if (action !== "opdater") {
      failures.push(`Række ${line}: ukendt handling "${action}". Brug Opdater eller Slet.`);
      return;
    }

    const activeRaw = String(getValue(row, "Aktiv", "aktiv", "Active")).trim().toLowerCase();
    let aktiv = true;
    if (activeRaw === "inaktiv" || activeRaw === "false" || activeRaw === "nej") {
      aktiv = false;
    } else if (activeRaw === "aktiv" || activeRaw === "true" || activeRaw === "ja") {
      aktiv = true;
    }

    const record = {
      barcode,
      title: String(getValue(row, "Titel", "title")).trim(),
      author: String(getValue(row, "Forfatter", "author")).trim(),
      isbn: String(getValue(row, "ISBN", "isbn")).trim(),
      faust: String(getValue(row, "FAUST", "faust")).trim(),
      aktiv,
      owner_bibliotek_id: ownerId
    };

    const validation = eksValidate(record);
    if (validation) {
      failures.push(`Række ${line}: ${validation}`);
      return;
    }
    updates.push(record);
  });

  if (!updates.length && !deletions.length) {
    showMsg("#msg", failures[0] || "Ingen gyldige rækker fundet.");
    return;
  }

  if (deletions.length) {
    const deleteByIsbn = {};
    deletions.forEach(({ isbn }) => {
      deleteByIsbn[isbn] = (deleteByIsbn[isbn] || 0) + 1;
    });
    const blocking = Object.entries(deleteByIsbn).filter(([isbn, count]) => {
      const available = getInventoryCount(ownerId, isbn);
      const reserved = Number(usageMap?.[ownerId]?.[isbn]) || 0;
      return available - count < reserved;
    });
    if (blocking.length) {
      const sample = blocking.slice(0, 5).map(([isbn, count]) =>
        `${isbn} (krævet: ${Number(usageMap?.[ownerId]?.[isbn]) || 0}, tilbage efter sletning: ${Math.max(0, getInventoryCount(ownerId, isbn) - count)})`
      );
      showMsg("#msg", "Eksemplarer kan ikke slettes før tilhørende sæt er nedtaget: " + sample.join(", "));
      return;
    }
    const confirmMsg = `Der er ${deletions.length} stregkoder markeret til sletning. Handlingen kan ikke fortrydes. Fortsæt?`;
    if (!confirm(confirmMsg)) {
      showMsg("#msg", "Import annulleret.");
      return;
    }
  }

  const chunkSize = 100;
  let updatesDone = 0;
  for (let i = 0; i < updates.length; i += chunkSize) {
    const chunk = updates.slice(i, i + chunkSize);
    const { error } = await sb.from("tbl_beholdning").upsert(chunk, { onConflict: "barcode" });
    if (error) {
      showMsg("#msg", "Fejl ved import: " + error.message);
      return;
    }
    updatesDone += chunk.length;
  }

  let deletesDone = 0;
  for (let i = 0; i < deletions.length; i += chunkSize) {
    const chunk = deletions.slice(i, i + chunkSize);
    const { error } = await sb
      .from("tbl_beholdning")
      .delete()
      .eq("owner_bibliotek_id", ownerId)
      .in("barcode", chunk.map(d => d.barcode));
    if (error) {
      showMsg("#msg", "Fejl ved sletning: " + error.message);
      return;
    }
    deletesDone += chunk.length;
  }

  const parts = [];
  if (updatesDone) parts.push(`opdaterede ${updatesDone} eksemplarer`);
  if (deletesDone) parts.push(`slettede ${deletesDone}`);
  showMsg("#msg", parts.length ? `Import gennemført: ${parts.join(", ")}.` : "Import gennemført.", true);
  if (failures.length) {
    alert("Følgende rækker blev sprunget over:\n" + failures.join("\n"));
  }
  await eksPull();
  await loadInventorySummary();
  await syncSaetMetadataFromIsbns(updates.map(r => r.isbn));
}

async function eksPull() {
  const tb = $("#tblEks tbody");
  if (!tb) return;

  if (!st.profile.adminCentralId) {
    tb.innerHTML = "";
    $("#pinfo").textContent = "VÃ¦lg fÃ¸rst en admin-profil (centralbibliotek) via Skift: Admin â†” Booker.";
     updateEksSaveButton();
    return;
  }

  st.eks.total = await eksCount();
  const rows = await eksFetch();

  tb.innerHTML = "";
  rows.forEach(r => {
    const tr = el("tr");
    tr.dataset.barcode = r.barcode;
    tr.dataset.original = JSON.stringify(r);

    const bcLabel = el("span", { class: "bc-label" }, r.barcode || "");
    const bcCell = el("td", {}, bcLabel);

    const ti = el("input", { class: "title", value: r.title || "" });
    const au = el("input", { class: "author", value: r.author || "" });
    const isb = el("input", { class: "isbn", value: r.isbn || "" });
    const fa = el("input", { class: "faust", value: r.faust || "" });
    const aktSel = el("button", {
      class: "btn btn-small active-flag",
      type: "button"
    }, "");
    setActiveButtonState(aktSel, r.aktiv === false ? "false" : "true");
    aktSel.addEventListener("click", () => {
      const next = aktSel.dataset.value === "true" ? "false" : "true";
      setActiveButtonState(aktSel, next);
      markEksDirty(tr);
    });

    const btnReset = el("button", {
      class: "btn",
      onclick: () => eksRevertRow(tr)
    }, "Fortryd");
    const btnDel = el("button", {
      class: "btn",
      onclick: () => eksDeleteRow(tr)
    }, "Slet");
    const actions = el("td", {}, btnReset, " ", btnDel);

    tr.append(
      bcCell,
      el("td", {}, ti),
      el("td", {}, au),
      el("td", {}, isb),
      el("td", {}, fa),
      el("td", {}, aktSel),
      actions
    );
    eksAttachRowListeners(tr);
    tb.appendChild(tr);
  });

  renderEksPagerInfo();
  updateEksSaveButton();
  updateEksSortIndicators();
}

async function eksDeleteRow(tr) {
  if (!sb) return;
  const bc = tr.dataset.barcode || tr.querySelector(".bc-label")?.textContent || tr.querySelector(".bc")?.value || "";
  if (!bc) {
    tr.remove();
    updateEksSaveButton();
    return;
  }
  const ownerId = currentAdminId();
  const original = tr.dataset.original ? safeJsonParse(tr.dataset.original) : null;
  const isbn = (tr.querySelector(".isbn")?.value || original?.isbn || "").trim();

  if (ownerId && isbn) {
    const { count: available, error: countError } = await sb
      .from("tbl_beholdning")
      .select("barcode", { count: "exact", head: true })
      .eq("owner_bibliotek_id", ownerId)
      .eq("isbn", isbn)
      .eq("aktiv", true);
    if (countError) {
      showMsg("#msg", "Kunne ikke verificere beholdning: " + countError.message);
      return;
    }
    const usageMap = await fetchSaetUsage();
    st.saet.usage = usageMap;
    const reserved = Number(usageMap?.[ownerId]?.[isbn]) || 0;
    if ((available ?? 0) - 1 < reserved) {
      showMsg("#msg", `Eksemplarer for ISBN ${isbn} kan ikke slettes før tilhørende sæt reduceres (krævet: ${reserved}, tilbage efter sletning: ${(available ?? 0) - 1}).`);
      return;
    }
  }

  if (!confirm("Slet eksemplar " + bc + "?")) return;
  const { error } = await sb.from("tbl_beholdning").delete().eq("barcode", bc);
  if (error) {
    showMsg("#msg", "Fejl ved sletning: " + error.message);
    return;
  }
  showMsg("#msg", "Eksemplar slettet", true);
  tr.remove();
  st.eks.total = Math.max(0, (st.eks.total || 0) - 1);
  renderEksPagerInfo();
  updateEksSaveButton();
  await loadInventorySummary();
}

function eksNewRow() {
  const tb = $("#tblEks tbody");
  if (!tb) return;
  const tr = el("tr");
  tr.dataset.new = "1";

  const bcInput = el("input", { class: "bc" });
  const stSel = el("select", { class: "status" },
    el("option", { value: "Ledig" }, "Ledig"),
    el("option", { value: "Reserveret" }, "Reserveret"),
    el("option", { value: "Booket" }, "Booket")
  );
  stSel.value = "Ledig";
  const aktSel = el("button", { class: "btn btn-small active-flag", type: "button" }, "");
  setActiveButtonState(aktSel, "true");
  aktSel.addEventListener("click", () => {
    const next = aktSel.dataset.value === "true" ? "false" : "true";
    setActiveButtonState(aktSel, next);
    markEksDirty(tr);
  });

  const btnCancel = el("button", {
    class: "btn",
    onclick: () => {
      tr.remove();
      updateEksSaveButton();
    }
  }, "AnnullÃ©r");
  const info = el("span", { class: "hint" }, "Gem via knappen ovenfor");

  tr.append(
    el("td", {}, bcInput),
    el("td", {}, el("input", { class: "title" })),
    el("td", {}, el("input", { class: "author" })),
    el("td", {}, el("input", { class: "isbn" })),
    el("td", {}, el("input", { class: "faust" })),
    el("td", {}, aktSel),
    el("td", {}, info, " ", btnCancel)
  );
  tb.prepend(tr);
  eksAttachRowListeners(tr);
}

function bindEksControls() {
  $("#btnSearch")?.addEventListener("click", () => {
    st.eks.q = $("#q")?.value || "";
    st.eks.page = 0;
    eksPull();
  });
  $("#btnReload")?.addEventListener("click", () => {
    st.eks.page = 0;
    eksPull();
  });
  $("#btnNew")?.addEventListener("click", () => {
    eksNewRow();
  });
  $("#btnSaveAll")?.addEventListener("click", () => {
    eksSaveAll();
  });
  document.querySelectorAll("#tblEks thead th[data-sort]").forEach(th => {
    th.addEventListener("click", () => {
      const field = th.dataset.sort;
      if (field) setEksSort(field);
    });
  });
  $("#prev")?.addEventListener("click", () => {
    if (st.eks.page > 0) {
      st.eks.page--;
      eksPull();
    }
  });
  $("#next")?.addEventListener("click", () => {
    const totalPages = Math.ceil((st.eks.total || 0) / st.eks.pageSize);
    if (st.eks.page < totalPages - 1) {
      st.eks.page++;
      eksPull();
    }
  });
  $("#btnEksExport")?.addEventListener("click", () => {
    exportEksToExcel();
  });
  $("#btnEksImport")?.addEventListener("click", () => {
    $("#eksImportFile")?.click();
  });
  $("#eksImportFile")?.addEventListener("change", evt => {
    const file = evt.target?.files?.[0];
    if (file) {
      importEksFromExcel(file);
    }
    evt.target.value = "";
  });
  updateEksSaveButton();
}

// ----------------------------------------------------------
// 7. Admin â€“ SÃ¦t (tbl_saet)
// ----------------------------------------------------------

async function fetchSaetUsage() {
  if (!sb) return {};
  const { data, error } = await sb
    .from("tbl_saet")
    .select("owner_bibliotek_id,isbn,requested_count");

  if (error) {
    console.error("Fejl ved fetchSaetUsage:", error);
    return {};
  }

  const usage = {};
  (data || []).forEach(row => {
    const owner = row.owner_bibliotek_id || "";
    if (!owner || !row.isbn) return;
    if (!usage[owner]) usage[owner] = {};
    usage[owner][row.isbn] = (usage[owner][row.isbn] || 0) + (Number(row.requested_count) || 0);
  });
  return usage;
}

function saetUsageFor(ownerId, isbn) {
  if (!ownerId || !isbn) return 0;
  return Number(st.saet.usage?.[ownerId]?.[isbn]) || 0;
}

function saetValidate(r, opts = {}) {
  if (!r.title) return "Titel skal udfyldes";
  if (!r.visibility || !["national", "regional"].includes(r.visibility.toLowerCase())) {
    return "Synlighed skal være national eller regional";
  }
  if (!r.owner_bibliotek_id) return "Ejer (centralbibliotek) skal udfyldes";
  if (!r.isbn) return "Vælg et ISBN fra beholdningen";
  if (r.requested_count <= 0) return "Et sæt skal indeholde mindst 1 eksemplar";
  if (r.loan_weeks < 1 || r.loan_weeks > 12) {
    return "Bookingperioden skal være mellem 1 og 12 uger";
  }
  if (r.buffer_days < 0 || r.min_delivery < 0) {
    return "Talværdier må ikke være negative";
  }
  if (opts.ownerId && opts.desiredCount != null) {
    const available = getInventoryCount(opts.ownerId, r.isbn);
    const source = opts.usageOverride?.[opts.ownerId]?.[r.isbn];
    const used = source != null ? source : saetUsageFor(opts.ownerId, r.isbn);
    const savedCount = opts.savedCount || 0;
    const otherUsed = Math.max(0, used - savedCount);
    const remaining = available - otherUsed;
    if (opts.desiredCount > remaining) {
      return `Der er kun ${Math.max(0, remaining)} eksemplarer tilbage af ISBN ${r.isbn}. (${available} i alt, ${otherUsed} bruges i andre sæt)`;
    }
  }
  return null;
}

async function exportSaetToExcel() {
  if (!sb) return;
  const ownerId = st.saet.owner || currentAdminId();
  if (!ownerId) {
    showMsg("#msgSaet", "Vælg først en admin-profil (centralbibliotek).");
    return;
  }

  showMsg("#msgSaet", "Henter sæt til Excel …");
  const { data, error } = await sb
    .from("tbl_saet")
    .select("set_id,title,author,isbn,faust,requested_count,loan_weeks,buffer_days,visibility,owner_bibliotek_id,active,allow_substitution,allow_partial,min_delivery,notes")
    .eq("owner_bibliotek_id", ownerId)
    .order("set_id");

  if (error) {
    showMsg("#msgSaet", "Kunne ikke hente sæt: " + error.message);
    return;
  }

  try {
    await ensureSheetJs();
  } catch (e) {
    showMsg("#msgSaet", e.message);
    return;
  }

  const rows = (data || []).map(row => ({
    Handling: "Opdater",
    ID: row.set_id || "",
    Titel: row.title || "",
    Forfatter: row.author || "",
    ISBN: row.isbn || "",
    FAUST: row.faust || "",
    requested_count: row.requested_count ?? "",
    loan_weeks: row.loan_weeks ?? "",
    buffer_days: row.buffer_days ?? "",
    visibility: row.visibility || "national",
    active: row.active ? "true" : "false",
    allow_substitution: row.allow_substitution ? "true" : "false",
    allow_partial: row.allow_partial ? "true" : "false",
    min_delivery: row.min_delivery ?? "",
    notes: row.notes || ""
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{
    Handling: "Opdater",
    ID: "",
    Titel: "",
    Forfatter: "",
    ISBN: "",
    FAUST: "",
    requested_count: "",
    loan_weeks: "",
    buffer_days: "",
    visibility: "national",
    active: "true",
    allow_substitution: "false",
    allow_partial: "false",
    min_delivery: "",
    notes: ""
  }]);
  XLSX.utils.book_append_sheet(wb, ws, "Sæt");
  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `saet_${ownerId}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showMsg("#msgSaet", "Excel med sæt er klar.", true);
}

async function importSaetFromExcel(file) {
  if (!sb || !file) return;
  const ownerId = st.saet.owner || currentAdminId();
  if (!ownerId) {
    showMsg("#msgSaet", "Vælg først en admin-profil (centralbibliotek).");
    return;
  }

  showMsg("#msgSaet", "Indlæser Excel …");
  try {
    await ensureSheetJs();
  } catch (e) {
    showMsg("#msgSaet", e.message);
    return;
  }

  await loadInventorySummary();
  const latestUsage = await fetchSaetUsage();
  st.saet.usage = latestUsage;
  const usageOverride = JSON.parse(JSON.stringify(latestUsage || {}));
  const existingSets = await fetchOwnerSetMap(ownerId);
  if (existingSets === null) return;

  let workbook;
  try {
    const buffer = await file.arrayBuffer();
    workbook = XLSX.read(buffer, { type: "array" });
  } catch (e) {
    showMsg("#msgSaet", "Kunne ikke læse Excel-filen: " + e.message);
    return;
  }

  const sheetName = workbook.SheetNames?.[0];
  if (!sheetName) {
    showMsg("#msgSaet", "Excel-filen indeholder ingen ark.");
    return;
  }

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
  if (!rows.length) {
    showMsg("#msgSaet", "Excel-arket er tomt.");
    return;
  }

  const updates = [];
  const deletions = [];
  const failures = [];
  const seenIds = new Set();

  const getValue = (row, ...keys) => {
    for (const key of keys) {
      if (row[key] != null && row[key] !== "") return row[key];
      const lower = typeof key === "string" ? key.toLowerCase() : key;
      if (row[lower] != null && row[lower] !== "") return row[lower];
    }
    return "";
  };
  const toNumber = (val, fallback = 0) => {
    if (val === "" || val == null) return fallback;
    const num = Number(val);
    return Number.isFinite(num) ? num : fallback;
  };
  const toBool = (val, fallback = false) => {
    const str = String(val).trim().toLowerCase();
    if (!str) return fallback;
    if (["true", "ja", "1", "x"].includes(str)) return true;
    if (["false", "nej", "0"].includes(str)) return false;
    return fallback;
  };

  rows.forEach((row, idx) => {
    const line = idx + 2;
    const idRaw = String(getValue(row, "ID", "set_id")).trim();
    let setId = null;
    if (idRaw) {
      setId = Number(idRaw);
      if (!Number.isFinite(setId)) {
        failures.push(`Række ${line}: ID er ikke et tal.`);
        return;
      }
      if (seenIds.has(setId)) {
        failures.push(`Række ${line}: ID ${setId} er duplikeret i Excel.`);
        return;
      }
      seenIds.add(setId);
    }

    let action = String(getValue(row, "Handling", "handling", "Action")).trim().toLowerCase();
    if (!action) action = "opdater";

    if (action === "slet") {
      if (!setId) {
        failures.push(`Række ${line}: Handling=Slet kræver et ID.`);
        return;
      }
      if (!existingSets.has(String(setId))) {
        failures.push(`Række ${line}: Sæt ID ${setId} findes ikke.`);
        return;
      }
      deletions.push(setId);
      return;
    }

    if (action !== "opdater") {
      failures.push(`Række ${line}: ukendt handling "${action}". Brug Opdater eller Slet.`);
      return;
    }

    const requested_count = toNumber(getValue(row, "requested_count", "eksemplarer"), 0);
    const loan_weeks = toNumber(getValue(row, "loan_weeks", "uger"), 8);
    const buffer_days = toNumber(getValue(row, "buffer_days", "buffer"), 0);
    const min_delivery = toNumber(getValue(row, "min_delivery", "mindste"), 0);
    let visibility = String(getValue(row, "visibility", "synlighed")).trim().toLowerCase() || "national";
    if (!["national", "regional"].includes(visibility)) visibility = "national";
    const active = toBool(getValue(row, "active", "aktiv"), true);
    const allow_substitution = toBool(getValue(row, "allow_substitution", "substitution"), false);
    const allow_partial = toBool(getValue(row, "allow_partial", "partial"), false);

    const record = {
      set_id: setId || undefined,
      title: String(getValue(row, "Titel", "title")).trim(),
      author: String(getValue(row, "Forfatter", "author")).trim(),
      isbn: String(getValue(row, "ISBN", "isbn")).trim(),
      faust: String(getValue(row, "FAUST", "faust")).trim(),
      requested_count,
      loan_weeks,
      buffer_days,
      visibility,
      owner_bibliotek_id: ownerId,
      active,
      allow_substitution,
      allow_partial,
      min_delivery,
      notes: String(getValue(row, "notes", "Noter")).trim()
    };

    const existing = setId ? existingSets.get(String(setId)) : null;
    if (setId && !existing) {
      failures.push(`Række ${line}: Sæt ID ${setId} findes ikke.`);
      return;
    }
    if (existing && existing.isbn && existing.isbn !== record.isbn) {
      failures.push(`Række ${line}: Sæt ID ${setId} kan ikke ændre ISBN.`);
      return;
    }

    const savedCount = existing ? Number(existing.requested_count) || 0 : 0;
    const validation = saetValidate(record, {
      ownerId,
      desiredCount: record.requested_count,
      savedCount,
      usageOverride
    });
    if (validation) {
      failures.push(`Række ${line}: ${validation}`);
      return;
    }

    if (!usageOverride[ownerId]) usageOverride[ownerId] = {};
    const currentTotal = usageOverride[ownerId][record.isbn] ?? saetUsageFor(ownerId, record.isbn);
    usageOverride[ownerId][record.isbn] = (currentTotal - savedCount) + record.requested_count;

    updates.push(record);
  });

  if (!updates.length && !deletions.length) {
    showMsg("#msgSaet", failures[0] || "Ingen gyldige rækker fundet.");
    return;
  }

  if (deletions.length) {
    const confirmMsg = `Der er ${deletions.length} sæt markeret til sletning. Handlingen kan ikke fortrydes. Fortsæt?`;
    if (!confirm(confirmMsg)) {
      showMsg("#msgSaet", "Import annulleret.");
      return;
    }
  }

  const chunkSize = 100;
  let upsertsDone = 0;
  for (let i = 0; i < updates.length; i += chunkSize) {
    const chunk = updates.slice(i, i + chunkSize);
    const { error } = await sb.from("tbl_saet").upsert(chunk, { onConflict: "set_id" });
    if (error) {
      showMsg("#msgSaet", "Fejl ved import: " + error.message);
      return;
    }
    upsertsDone += chunk.length;
  }

  let deletesDone = 0;
  for (let i = 0; i < deletions.length; i += chunkSize) {
    const chunk = deletions.slice(i, i + chunkSize);
    const { error } = await sb
      .from("tbl_saet")
      .delete()
      .eq("owner_bibliotek_id", ownerId)
      .in("set_id", chunk);
    if (error) {
      showMsg("#msgSaet", "Fejl ved sletning af sæt: " + error.message);
      return;
    }
    deletesDone += chunk.length;
  }

  const parts = [];
  if (upsertsDone) parts.push(`opdaterede ${upsertsDone} sæt`);
  if (deletesDone) parts.push(`slettede ${deletesDone} sæt`);
  showMsg("#msgSaet", parts.length ? `Import gennemført: ${parts.join(", ")}.` : "Import gennemført.", true);
  if (failures.length) {
    alert("Følgende rækker blev sprunget over:\n" + failures.join("\n"));
  }
  await saetPull();
}

function populateSaetIsbnSelect(selectEl, ownerId, selectedIsbn) {
  if (!selectEl) return;
  const inventory = getOwnerInventory(ownerId);
  selectEl.innerHTML = "";

  if (!inventory.length) {
    selectEl.appendChild(el("option", { value: "" }, "(ingen titler i beholdningen)"));
    if (selectedIsbn) {
      selectEl.appendChild(el("option", { value: selectedIsbn }, `${selectedIsbn} (ikke i beholdning)`));
      selectEl.value = selectedIsbn;
      selectEl.disabled = false;
    } else {
      selectEl.value = "";
      selectEl.disabled = true;
    }
    return;
  }

  selectEl.disabled = false;
  selectEl.appendChild(el("option", { value: "" }, "(vælg ISBN)"));
  inventory.forEach(meta => {
    const label = `${meta.isbn || ""} – ${meta.title || "(uden titel)"} – ${meta.author || ""} – ${meta.faust || ""}`;
    selectEl.appendChild(el("option", { value: meta.isbn }, label));
  });

  if (selectedIsbn && !inventory.some(m => m.isbn === selectedIsbn)) {
    selectEl.appendChild(el("option", { value: selectedIsbn }, `${selectedIsbn} (ikke i beholdning)`));
  }
  selectEl.value = selectedIsbn || "";
}

function applyInventoryMeta(tr, ownerId, isbn, force = false) {
  const meta = getInventoryMeta(ownerId, isbn);
  if (!meta) return;
  const titleEl = tr.querySelector(".saet-title");
  const authorEl = tr.querySelector(".saet-author");
  const faustEl = tr.querySelector(".saet-faust");
  const isbnField = tr.querySelector(".saet-isbn-field");

  if (titleEl && (force || !titleEl.value)) titleEl.value = meta.title || "";
  if (authorEl && (force || !authorEl.value)) authorEl.value = meta.author || "";
  if (faustEl && (force || !faustEl.value)) faustEl.value = meta.faust || "";
  if (isbnField) isbnField.value = isbn || "";
}

function updateSaetAvailability(tr) {
  if (!tr) return;
  const ownerId = tr.querySelector(".saet-owner")?.value || "";
  const isbn = tr.querySelector(".saet-isbn")?.value || "";
  const reqInput = tr.querySelector(".saet-requested");
  const hint = tr.querySelector(".saet-availability");
  if (!reqInput || !hint) return;

  const savedCount = Number(tr.dataset.savedCount || 0);
  if (!ownerId || !isbn) {
    hint.title = "VÃ¦lg fÃ¸rst ejer og ISBN.";
    hint.dataset.state = "error";
    reqInput.max = "";
    return;
  }

  const available = getInventoryCount(ownerId, isbn);
  const usedTotal = saetUsageFor(ownerId, isbn);
  const otherUsed = Math.max(0, usedTotal - savedCount);
  const remaining = available - otherUsed;
  const maxForRow = Math.max(0, remaining);
  const desired = Math.floor(Number(reqInput.value || 0));

  if (!available || maxForRow <= 0) {
    hint.title = available
      ? `Andre sÃ¦t bruger ${otherUsed} af ${available} eksemplarer. Der er ingen ledige tilbage.`
      : "Ingen eksemplarer i beholdningen med dette ISBN.";
    hint.dataset.state = "error";
    reqInput.max = maxForRow || 0;
    return;
  }

  if (desired > maxForRow) {
    hint.title = `Du har valgt ${desired}, men der er kun ${maxForRow} ledige (${available} total, ${otherUsed} bruges af andre sÃ¦t).`;
    hint.dataset.state = "warning";
  } else {
    hint.title = `Andre sÃ¦t bruger ${otherUsed} af ${available} eksemplarer. Max til dette sÃ¦t: ${maxForRow}.`;
    hint.dataset.state = "ok";
  }
  reqInput.max = maxForRow || "";
}

function setSaetSort(field) {
  const valid = {
    set_id: true,
    isbn: true,
    title: true,
    author: true,
    faust: true,
    requested_count: true,
    loan_weeks: true,
    buffer_days: true,
    visibility: true,
    owner: true,
    active: true,
    substitution: true,
    partial: true,
    min_delivery: true
  };
  if (!valid[field]) return;
  if (st.saet.sortBy === field) {
    st.saet.sortDir = st.saet.sortDir === "asc" ? "desc" : "asc";
  } else {
    st.saet.sortBy = field;
    st.saet.sortDir = "asc";
  }
  st.saet.page = 0;
  saetPull();
}

function updateSaetSortIndicators() {
  const headers = document.querySelectorAll("#tblSaet thead th[data-sort]");
  headers.forEach(th => {
    const field = th.dataset.sort;
    th.classList.toggle("sorted-asc", field === st.saet.sortBy && st.saet.sortDir === "asc");
    th.classList.toggle("sorted-desc", field === st.saet.sortBy && st.saet.sortDir === "desc");
  });
}

function highlightSaveBar() {
  const bar = document.getElementById("saveNotice");
  if (!bar) return;
  bar.classList.add("visible");
  setTimeout(() => bar.classList.remove("visible"), 2500);
}

function refreshSaetInventoryControls() {
  $$("#tblSaet tbody tr").forEach(tr => {
    const ownerId = tr.querySelector(".saet-owner")?.value || "";
    const isbnSel = tr.querySelector(".saet-isbn");
    if (isbnSel) {
      const current = isbnSel.value;
      populateSaetIsbnSelect(isbnSel, ownerId, current);
    }
    updateSaetAvailability(tr);
  });
}


async function saetCount(ownerFilter) {
  if (!sb) return 0;
  let q = sb.from("tbl_saet").select("*", { count: "exact", head: true });
  const f = st.saet;
  const owner = ownerFilter || f.owner || currentAdminId();
  if (owner) q = q.eq("owner_bibliotek_id", owner);
  if (f.vis) q = q.eq("visibility", f.vis);
  if (f.q) {
    const v = f.q;
    q = q.or([
      `title.ilike.%${v}%`,
      `author.ilike.%${v}%`,
      `isbn.ilike.%${v}%`,
      `faust.ilike.%${v}%`
    ].join(","));
  }
  const { count, error } = await q;
  if (error) {
    showMsg("#msgSaet", "Fejl ved hentning: " + error.message);
    return 0;
  }
  return count || 0;
}

async function saetFetch(ownerFilter) {
  if (!sb) return [];
  const from = st.saet.page * st.saet.pageSize;
  const to = from + st.saet.pageSize - 1;
  let q = sb.from("tbl_saet")
    .select("set_id,title,author,isbn,faust,requested_count,loan_weeks,buffer_days,visibility,owner_bibliotek_id,active,allow_substitution,allow_partial,min_delivery,notes");

  const f = st.saet;
  const owner = ownerFilter || f.owner || currentAdminId();
  if (owner) q = q.eq("owner_bibliotek_id", owner);
  if (f.vis) q = q.eq("visibility", f.vis);
  if (f.q) {
    const v = f.q;
    q = q.or([
      `title.ilike.%${v}%`,
      `author.ilike.%${v}%`,
      `isbn.ilike.%${v}%`,
      `faust.ilike.%${v}%`
    ].join(","));
  }

  const { data, error } = await q;
  if (error) {
    showMsg("#msgSaet", "Fejl ved hentning: " + error.message);
    return [];
  }
  return data || [];
}

async function saetPull() {
  const tb = $("#tblSaet tbody");
  if (!tb) return;

  if (!st.stock.list.length) {
    await loadInventorySummary();
  }

  const adminId = currentAdminId();
  const adminLib = st.libs.byId[adminId];
  const isSuper = isSuperLibrary(adminLib);
  const ownerWrap = $("#saetOwnerWrap");
  const ownerSel = $("#saetOwnerFilterSel");

  if (ownerWrap) ownerWrap.style.display = isSuper ? "" : "none";
  if (ownerSel) {
    if (isSuper) {
      if (!ownerSel.options.length) populateSaetOwnerSelect();
    } else {
      ownerSel.value = "";
    }
  }

  if (adminId && st.saet.ownerAdminId !== adminId) {
    st.saet.ownerAdminId = adminId;
    st.saet.owner = adminId;
    if (ownerSel) ownerSel.value = adminId;
  }

  let activeOwner = adminId || "";
  if (isSuper && ownerSel) {
    if (!ownerSel.value) ownerSel.value = adminId;
    activeOwner = ownerSel.value;
  }
  st.saet.owner = activeOwner;

  if (!activeOwner) {
    tb.innerHTML = "";
    $("#saetPinfo").textContent = "";
    showMsg("#msgSaet", "VÃ¦lg fÃ¸rst en admin-profil (centralbibliotek) via Skift: Admin â†” Booker.");
    return;
  }
  showMsg("#msgSaet", "");

  st.saet.vis = "";
  st.saet.q = $("#saetQ")?.value || "";

  const [usage, total, rows] = await Promise.all([
    fetchSaetUsage(),
    saetCount(activeOwner),
    saetFetch(activeOwner)
  ]);

  st.saet.usage = usage;
  st.saet.total = total;

  tb.innerHTML = "";
  rows.forEach(r => {
    const tr = el("tr");
    tr.dataset.setId = r.set_id;
    tr.dataset.savedCount = String(r.requested_count ?? 0);

    const owner = st.libs.byId[r.owner_bibliotek_id];

    const idCell = el("td", {}, String(r.set_id ?? ""));
    const isbnSel = el("select", { class: "saet-isbn" });
    const isbnField = el("input", { type: "text", class: "saet-isbn-field", value: r.isbn || "", readonly: true });
    const tiIn = el("input", { class: "saet-title", value: r.title || "", readonly: true });
    const auIn = el("input", { class: "saet-author", value: r.author || "", readonly: true });
    const isbnWrap = el("div", { class: "saet-isbn-wrap" }, isbnField, isbnSel);
    isbnWrap.style.position = "relative";
    Object.assign(isbnSel.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      opacity: "0",
      cursor: "pointer",
      background: "transparent"
    });
    populateSaetIsbnSelect(isbnSel, r.owner_bibliotek_id, r.isbn || "");
    const faIn = el("input", { class: "saet-faust", value: r.faust || "", style: "width:6ch", readonly: true });
    const reqIn = el("input", {
      type: "number",
      class: "saet-requested",
      value: r.requested_count ?? 1,
      min: "1",
      style: "width:6ch"
    });
    const reqHint = el("span", { class: "saet-availability", title: "" }, "â—");
    reqHint.dataset.state = "error";
    const weeksIn = el("input", {
      type: "number",
      class: "saet-weeks",
      value: r.loan_weeks ?? 8,
      min: "1",
      max: "12"
    });
    const bufferIn = el("input", { type: "number", class: "saet-buffer", value: r.buffer_days ?? 0, min: "0", style: "width:6ch" });
    const bufferWrap = el("div", { class: "buffer-wrap" }, bufferIn, " dg");

    const visSel = el("select", { class: "saet-vis" },
      el("option", { value: "national" }, "national"),
      el("option", { value: "regional" }, "regional")
    );
    visSel.value = (r.visibility || "national").toLowerCase();

    const ownerVal = r.owner_bibliotek_id || adminId || "";
    const ownerHidden = el("input", { type: "hidden", class: "saet-owner", value: ownerVal });
    const ownerLabel = el("span", { class: "saet-owner-label" }, fmtOwnerCity(st.libs.byId[ownerVal]) || ownerVal || "");

    const activeSel = el("select", { class: "saet-active" },
      el("option", { value: "true" }, "Ja"),
      el("option", { value: "false" }, "Nej")
    );
    activeSel.value = r.active ? "true" : "false";

    const subSel = el("select", { class: "saet-sub" },
      el("option", { value: "true" }, "Ja"),
      el("option", { value: "false" }, "Nej")
    );
    subSel.value = r.allow_substitution ? "true" : "false";

    const partSel = el("select", { class: "saet-part" },
      el("option", { value: "true" }, "Ja"),
      el("option", { value: "false" }, "Nej")
    );
    partSel.value = r.allow_partial ? "true" : "false";

    const minIn = el("input", { type: "number", class: "saet-min", value: r.min_delivery ?? 0, min: "0" });

    const btnDel = el("button", { class: "btn btn-small", onclick: () => saetDeleteRow(tr) }, "Slet");
    const deleteCell = el("td", {}, btnDel);

    tr.append(
      idCell,
      el("td", {}, isbnWrap),
      el("td", {}, tiIn),
      el("td", {}, auIn),
      el("td", {}, faIn),
      el("td", {}, reqIn, " ", reqHint),
      el("td", {}, weeksIn),
      el("td", {}, bufferWrap),
      el("td", {}, visSel),
      el("td", {}, ownerLabel, ownerHidden),
      el("td", {}, activeSel),
      el("td", {}, subSel),
      el("td", {}, partSel),
      el("td", {}, minIn),
      deleteCell
    );

    isbnSel.addEventListener("change", () => {
      applyInventoryMeta(tr, ownerVal, isbnSel.value, true);
      updateSaetAvailability(tr);
      isbnWrap.classList.remove("highlight");
    });
    const focusSelect = () => {
      isbnSel.focus();
      isbnSel.click();
    };
    isbnField.addEventListener("click", focusSelect);
    isbnField.addEventListener("focus", focusSelect);
    reqIn.addEventListener("input", () => updateSaetAvailability(tr));
    reqIn.addEventListener("change", () => updateSaetAvailability(tr));
    updateSaetAvailability(tr);

    saetAttachRowListeners(tr);
    clearSaetDirty(tr);

    tb.appendChild(tr);
  });

  updateSaetSortIndicators();
  updateSaetSaveButton();
  const totalPages = Math.ceil((st.saet.total || 0) / st.saet.pageSize);
  $("#saetPinfo").textContent = st.saet.total
    ? `Side ${st.saet.page + 1}/${totalPages} â€“ ${st.saet.total} sÃ¦t`
    : "Ingen sÃ¦t fundet";
}

function ensureSaetCapacity(ownerId, isbn, requestedCount, currentSetId, savedCount = 0, usageOverride) {
  const available = getInventoryCount(ownerId, isbn);
  if (!available) {
    return {
      ok: false,
      message: "Der er ingen eksemplarer i beholdningen med det valgte ISBN."
    };
  }

  const usageSource = usageOverride?.[ownerId]?.[isbn];
  const totalUsed = usageSource != null ? usageSource : saetUsageFor(ownerId, isbn);
  const otherUsed = Math.max(0, (totalUsed || 0) - savedCount);
  const maxForSet = available - otherUsed;

  if (requestedCount > maxForSet) {
    return {
      ok: false,
      message: `Der er ${available} eksemplarer og andre sÃ¦t bruger ${otherUsed}. Maksimalt ${Math.max(0, maxForSet)} til dette sÃ¦t.`
    };
  }

  return { ok: true };
}

async function saetDeleteRow(tr) {
  if (!sb) return;
  const setId = tr.dataset.setId;
  if (!setId) {
    tr.remove();
    updateSaetSaveButton();
    return;
  }
  if (!confirm("Slet sÃ¦t " + setId + "?")) return;
  const { error } = await sb.from("tbl_saet").delete().eq("set_id", Number(setId));
  if (error) {
    showMsg("#msgSaet", "Fejl ved sletning: " + error.message);
  } else {
    showMsg("#msgSaet", "SÃ¦t slettet", true);
    await saetPull();
  }
}

function saetNewRow() {
  const tb = $("#tblSaet tbody");
  if (!tb) return;
  const tr = el("tr");
  tr.dataset.setId = "";
  tr.dataset.savedCount = "0";

  const ownerId = currentAdminId();
  if (!ownerId) {
    showMsg("#msgSaet", "VÃ¦lg fÃ¸rst en admin-profil (centralbibliotek) via Skift: Admin â†” Booker.");
    return;
  }

  const visSel = el("select", { class: "saet-vis" },
    el("option", { value: "national" }, "national"),
    el("option", { value: "regional" }, "regional")
  );
  visSel.value = "national";

  const ownerHidden = el("input", { type: "hidden", class: "saet-owner", value: ownerId });
  const ownerLabel = el("span", { class: "saet-owner-label" }, fmtOwnerCity(st.libs.byId[ownerId]) || ownerId);

  const isbnSel = el("select", { class: "saet-isbn" });
  const isbnField = el("input", { type: "text", class: "saet-isbn-field", readonly: true });
  const titleIn = el("input", { class: "saet-title", readonly: true });
  const authorIn = el("input", { class: "saet-author", readonly: true });
  const isbnWrap = el("div", { class: "saet-isbn-wrap" }, isbnField, isbnSel);
  isbnWrap.style.position = "relative";
  Object.assign(isbnSel.style, {
    position: "absolute",
    inset: "0",
    width: "100%",
    height: "100%",
    opacity: "0",
    cursor: "pointer",
    background: "transparent"
  });
  populateSaetIsbnSelect(isbnSel, ownerId, "");

  const activeSel = el("select", { class: "saet-active" },
    el("option", { value: "true" }, "Ja"),
    el("option", { value: "false" }, "Nej")
  );
  activeSel.value = "true";

  const subSel = el("select", { class: "saet-sub" },
    el("option", { value: "true" }, "Ja"),
    el("option", { value: "false" }, "Nej")
  );
  subSel.value = "false";

  const partSel = el("select", { class: "saet-part" },
    el("option", { value: "true" }, "Ja"),
    el("option", { value: "false" }, "Nej")
  );
  partSel.value = "false";

  const btnCancel = el("button", {
    class: "btn btn-small",
    onclick: () => {
      tr.remove();
      updateSaetSaveButton();
    }
  }, "AnnullÃ©r");
  if (isbnSel.disabled) {
    btnSave.disabled = true;
    btnSave.title = "Ingen titler i beholdningen for det valgte centralbibliotek.";
  }

  const reqIn = el("input", { type: "number", class: "saet-requested", value: "1", min: "1", style: "width:6ch" });
  const reqHint = el("span", { class: "saet-availability", title: "" }, "â—");
  reqHint.dataset.state = "error";
  const weeksIn = el("input", { type: "number", class: "saet-weeks", value: "8", min: "1", max: "12" });
  const bufferIn = el("input", { type: "number", class: "saet-buffer", value: "0", min: "0", style: "width:6ch" });
  const bufferWrap = el("div", { class: "buffer-wrap" }, bufferIn, " dg");
  const minIn = el("input", { type: "number", class: "saet-min", value: "0", min: "0" });

  tr.append(
    el("td", {}, ""), // ID (autoincrement)
    el("td", {}, isbnWrap),
    el("td", {}, titleIn),
    el("td", {}, authorIn),
    el("td", {}, el("input", { class: "saet-faust", style: "width:6ch", readonly: true })),
    el("td", {}, reqIn, " ", reqHint),
    el("td", {}, weeksIn),
    el("td", {}, bufferWrap),
    el("td", {}, visSel),
    el("td", {}, ownerLabel, ownerHidden),
    el("td", {}, activeSel),
    el("td", {}, subSel),
    el("td", {}, partSel),
    el("td", {}, minIn),
    el("td", {}, btnCancel)
  );
  tb.prepend(tr);
  saetAttachRowListeners(tr);
  markSaetDirty(tr);

  isbnSel.addEventListener("change", () => {
    applyInventoryMeta(tr, ownerId, isbnSel.value, true);
    updateSaetAvailability(tr);
    isbnWrap.classList.remove("highlight");
  });
  const focusSelect = () => {
    isbnSel.focus();
    isbnSel.click();
  };
  isbnField.addEventListener("click", focusSelect);
  isbnField.addEventListener("focus", focusSelect);
  reqIn.addEventListener("input", () => updateSaetAvailability(tr));
  reqIn.addEventListener("change", () => updateSaetAvailability(tr));
  updateSaetAvailability(tr);
  isbnWrap.classList.add("highlight");
}

function bindSaetControls() {
  $("#btnSaetSearch")?.addEventListener("click", () => {
    st.saet.page = 0;
    saetPull();
  });
  $("#btnSaetSaveAll")?.addEventListener("click", () => {
    saetSaveAll();
  });
  $("#btnSaetMine")?.addEventListener("click", () => {
    const adminId = currentAdminId();
    if (!adminId) {
      showMsg("#msgSaet", "VÃ¦lg fÃ¸rst en admin-profil (centralbibliotek).");
      return;
    }
    st.saet.owner = adminId;
    st.saet.ownerAdminId = adminId;
    const ownerSel = $("#saetOwnerFilterSel");
    if (ownerSel) {
      ownerSel.value = adminId;
    }
    const qInput = $("#saetQ");
    if (qInput) qInput.value = "";
    st.saet.page = 0;
    saetPull();
  });
  $("#btnSaetNew")?.addEventListener("click", () => {
    saetNewRow();
  });
  document.querySelectorAll("#tblSaet thead th[data-sort]")?.forEach(th => {
    th.addEventListener("click", () => {
      const field = th.dataset.sort;
      if (field) setSaetSort(field);
    });
  });
  $("#saetOwnerFilterSel")?.addEventListener("change", () => {
    st.saet.owner = $("#saetOwnerFilterSel").value || currentAdminId();
    st.saet.page = 0;
    saetPull();
  });
  $("#saetPrev")?.addEventListener("click", () => {
    if (st.saet.page > 0) {
      st.saet.page--;
      saetPull();
    }
  });
  $("#saetNext")?.addEventListener("click", () => {
    const totalPages = Math.ceil((st.saet.total || 0) / st.saet.pageSize);
    if (st.saet.page < totalPages - 1) {
      st.saet.page++;
      saetPull();
    }
  });
  $("#btnSaetExport")?.addEventListener("click", () => {
    exportSaetToExcel();
  });
  $("#btnSaetImport")?.addEventListener("click", () => {
    $("#saetImportFile")?.click();
  });
  $("#saetImportFile")?.addEventListener("change", evt => {
    const file = evt.target?.files?.[0];
    if (file) {
      importSaetFromExcel(file);
    }
    evt.target.value = "";
  });
}

function refreshSaetAvailabilityIndicators() {
  const rows = document.querySelectorAll("#tblSaet tbody tr");
  rows.forEach(tr => updateSaetAvailability(tr));
}

// ----------------------------------------------------------
// 8. Admin â€“ Region / relationer (tbl_bibliotek_relation)
// ----------------------------------------------------------

async function relList() {
  if (!sb) return;
  const filter = $("#relFilterSel")?.value || "";

  let query = sb
    .from("tbl_bibliotek_relation")
    .select("relation_id,bibliotek_id,central_id,active")
    .order("relation_id");
  if (filter) {
    query = query.eq("central_id", filter);
  }

  const { data, error } = await query;

  if (error) {
    showMsg("#msgRel", "Fejl ved hentning af relationer: " + error.message);
    return;
  }

  const tb = $("#tblRel tbody");
  if (!tb) return;

  tb.innerHTML = "";
  (data || []).forEach(r => {
    const local = st.libs.byId[r.bibliotek_id];
    const central = st.libs.byId[r.central_id];

    const activeSel = el("select", { "data-rel-id": r.relation_id, class: "rel-active" },
      el("option", { value: "true" }, "Ja"),
      el("option", { value: "false" }, "Nej")
    );
    activeSel.value = r.active ? "true" : "false";

    const borrowerActive = local && local.active !== false ? "Ja" : "Nej";

    const btnDel = el("button", {
      class: "btn",
      onclick: () => relDelete(r.relation_id)
    }, "Slet");

    const tr = el("tr", {},
      el("td", {}, String(r.relation_id)),
      el("td", {}, local ? fmtLibLabel(local) : r.bibliotek_id),
      el("td", {}, central ? fmtLibLabel(central) : r.central_id),
      el("td", {}, activeSel),
      el("td", {}, borrowerActive),
      el("td", {}, btnDel)
    );
    tb.appendChild(tr);
  });

  const filterLabel = filter ? (fmtLibLabel(st.libs.byId[filter]) || filter) : "";
  const msg = data && data.length
    ? `Antal relationer${filterLabel ? " for " + filterLabel : ""}: ${data.length}`
    : "Ingen relationer.";
  showMsg("#msgRel", msg, true);
}

async function relSaveActives() {
  if (!sb) return;
  const selects = $$("#tblRel select.rel-active[data-rel-id]");
  const updates = selects.map(sel => ({
    relation_id: Number(sel.getAttribute("data-rel-id")),
    active: sel.value === "true"
  }));
  if (!updates.length) return;
  const { error } = await sb.from("tbl_bibliotek_relation").upsert(updates, { onConflict: "relation_id" });
  if (error) {
    showMsg("#msgRel", "Fejl ved gem af relationer: " + error.message);
  } else {
    showMsg("#msgRel", "Relationer opdateret", true);
    await relList();
  }
}

async function relDelete(relationId) {
  if (!sb) return;
  if (!confirm(`Slet relation ${relationId}?`)) return;
  const { error } = await sb.from("tbl_bibliotek_relation").delete().eq("relation_id", relationId);
  if (error) {
    showMsg("#msgRel", "Fejl ved sletning: " + error.message);
  } else {
    showMsg("#msgRel", "Relation slettet", true);
    await relList();
  }
}

async function relAddExisting() {
  if (!sb) return;
  const centralId = $("#relCentralAssign")?.value || currentAdminId();
  if (!centralId) {
    showMsg("#msgRel", "VÃ¦lg fÃ¸rst et centralbibliotek.");
    return;
  }
  const local = $("#relLocal")?.value;
  if (!local) {
    showMsg("#msgRel", "VÃ¦lg regionsbibliotek.");
    return;
  }
  if (local === centralId) {
    showMsg("#msgRel", "Et bibliotek kan ikke vÃ¦re sin egen region.");
    return;
  }

  const { error } = await sb.from("tbl_bibliotek_relation").insert({
    bibliotek_id: local,
    central_id: centralId,
    active: true
  });
  if (error) {
    showMsg("#msgRel", "Fejl ved oprettelse af relation: " + error.message);
  } else {
    showMsg("#msgRel", "Relation oprettet", true);
    await relList();
  }
}

async function relCreateLocal() {
  if (!sb) return;
  const centralId = $("#newLocalCentral")?.value || currentAdminId();
  if (!centralId) {
    showMsg("#msgRel", "VÃ¦lg hvilket centralbibliotek regionen skal tilknyttes.");
    return;
  }
  const id = $("#newLocalId")?.value.trim();
  const name = $("#newLocalName")?.value.trim();
  const address = $("#newLocalAddress")?.value.trim() || "";
  const postal_code = $("#newLocalPostal")?.value.trim() || "";
  const city = $("#newLocalCity")?.value.trim() || "";
  const notes = $("#newLocalNotes")?.value.trim() || "";
  const activeStr = $("#newLocalActive")?.value || "true";
  const active = activeStr === "true";

  if (!id || id.length > 20) {
    showMsg("#msgRel", "ID skal udfyldes (1â€“20 tegn).");
    return;
  }
  if (!name) {
    showMsg("#msgRel", "Navn skal udfyldes.");
    return;
  }

  const { error: e1 } = await sb.from("tbl_bibliotek").insert({
    bibliotek_id: id,
    bibliotek_navn: name,
    is_central: false,
    active,
    address,
    postal_code,
    city,
    notes
  });
  if (e1) {
    showMsg("#msgRel", "Fejl ved oprettelse af bibliotek: " + e1.message);
    return;
  }

  const { error: e2 } = await sb.from("tbl_bibliotek_relation").insert({
    bibliotek_id: id,
    central_id: centralId,
    active: true
  });
  if (e2) {
    showMsg("#msgRel", "Bibliotek oprettet, men fejl ved relation: " + e2.message);
  } else {
    showMsg("#msgRel", "Regionsbibliotek oprettet og relateret", true);
    ["#newLocalId","#newLocalName","#newLocalAddress","#newLocalPostal","#newLocalCity","#newLocalNotes"].forEach(sel => {
      const input = $(sel);
      if (input) input.value = "";
    });
    $("#newLocalActive").value = "true";
  }

  await loadLibraries();
  await relList();
}

function bindRelControls() {
  $("#btnRelAdd")?.addEventListener("click", relAddExisting);
  $("#btnCreateLocal")?.addEventListener("click", relCreateLocal);
  $("#btnRelDetailSave")?.addEventListener("click", saveRegionDetails);
  $("#relFilterSel")?.addEventListener("change", () => {
    relList();
  });
  $("#relDetailSel")?.addEventListener("change", renderRegionDetails);
  renderRegionDetails();
  // Auto-gem Ã¦ndringer i active-dropdowns nÃ¥r man forlader fanen kunne laves her â€“ vi holder det manuelt
}

// ----------------------------------------------------------
// 9. Admin â€“ Adgang (super admin)
// ----------------------------------------------------------

function renderAccessTable() {
  const tb = $("#tblSuperAdmin tbody");
  if (!tb) return;
  tb.innerHTML = "";
  const centrals = st.libs.centrals || [];
  if (!centrals.length) {
    tb.appendChild(el("tr", {}, el("td", { colspan: 3 }, "Ingen centralbiblioteker fundet.")));
    return;
  }
  const totalSuper = centrals.filter(lib => lib.is_super_admin).length || 0;
  centrals.forEach(lib => {
    const isSuper = !!lib.is_super_admin;
    const disabled = accessUpdating || (isSuper && totalSuper <= 1);
    const btn = el("button", {
      class: `btn btn-small access-toggle ${isSuper ? "on" : "off"}`,
      "data-action": "toggle-super",
      "data-id": lib.bibliotek_id,
      "data-next": isSuper ? "remove" : "add",
      style: `background:${isSuper ? "#2e8540" : "#c32626"};color:#fff;border:0;min-width:70px;`,
      title: isSuper ? "Klik for at fjerne super admin" : "Klik for at give super admin"
    }, isSuper ? "Ja" : "Nej");
    btn.disabled = !!disabled;
    tb.appendChild(el("tr", {},
      el("td", {}, fmtLibLabel(lib)),
      el("td", {}, btn)
    ));
  });
}

async function toggleSuperAdmin(bibId, makeSuper) {
  if (!sb || !bibId) return;
  const centrals = st.libs.centrals || [];
  const currentSuper = centrals.filter(lib => lib.is_super_admin).length || 0;
  if (!makeSuper && currentSuper <= 1) {
    showMsg("#accessMsg", "Der skal altid være mindst én super admin.");
    return;
  }
  if (accessUpdating) return;
  accessUpdating = true;
  renderAccessTable();
  showMsg("#accessMsg", "Opdaterer super admin-adgang …");
  const { error } = await sb
    .from("tbl_bibliotek")
    .update({ is_super_admin: makeSuper })
    .eq("bibliotek_id", bibId);
  if (error) {
    showMsg("#accessMsg", "Kunne ikke opdatere: " + error.message);
    accessUpdating = false;
    renderAccessTable();
    return;
  }
  await loadLibraries();
  accessUpdating = false;
  renderAccessTable();
  const lib = st.libs.byId[bibId];
  const label = fmtLibLabel(lib) || bibId;
  showMsg("#accessMsg", makeSuper ? `${label} er nu super admin.` : `${label} er ikke længere super admin.`, true);
}

function bindAccessControls() {
  const table = $("#tblSuperAdmin");
  if (!table) return;
  table.addEventListener("click", evt => {
    const btn = evt.target.closest("button[data-action='toggle-super']");
    if (!btn || accessUpdating) return;
    const id = btn.dataset.id;
    if (!id) return;
    const next = btn.dataset.next === "add";
    toggleSuperAdmin(id, next);
  });
  renderAccessTable();
}

// ----------------------------------------------------------
// 10. Admin â€“ Kalender (tbl_national_holidays)
// ----------------------------------------------------------

function setCalendarFormEnabledGlobal(enabled) {
  ["#calDate", "#calTitle", "#calNotes", "#btnCalAdd", "#btnCalExport", "#btnCalImport", "#calImportFile"].forEach(sel => {
    const elRef = $(sel);
    if (elRef) {
      elRef.disabled = !enabled;
    }
  });
}

function clearCalendarFormGlobal() {
  ["#calDate", "#calTitle", "#calNotes"].forEach(sel => {
    const elRef = $(sel);
    if (elRef) elRef.value = "";
  });
}

function renderCalendarRowsGlobal(rows) {
  const tb = $("#tblCalendar tbody");
  if (!tb) return;
  tb.innerHTML = "";
  if (!rows || !rows.length) {
    tb.appendChild(el("tr", {}, el("td", { colspan: 4 }, "Ingen registrerede fridage.")));
    return;
  }
  rows.forEach(row => {
    const dateStr = row.holiday_date ? new Date(row.holiday_date).toLocaleDateString("da-DK") : "";
    const delBtn = el("button", {
      class: "btn btn-small",
      "data-cal-delete": row.holiday_id
    }, "Slet");
    tb.appendChild(el("tr", {},
      el("td", {}, dateStr),
      el("td", {}, row.title || ""),
      el("td", {}, row.notes || ""),
      el("td", {}, delBtn)
    ));
  });
}

function normalizeHolidayDate(value) {
  if (value == null || value === "") return "";
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && window.XLSX?.SSF) {
    const parsed = window.XLSX.SSF.parse_date_code(value);
    if (parsed) {
      const d = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
      return d.toISOString().slice(0, 10);
    }
  }
  const str = String(value).trim();
  if (!str) return "";
  let match = str.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (match) {
    const [ , y, m, d ] = match;
    const pad = n => String(n).padStart(2, "0");
    return `${y}-${pad(m)}-${pad(d)}`;
  }
  match = str.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (match) {
    const [ , d, m, y ] = match;
    const pad = n => String(n).padStart(2, "0");
    return `${y}-${pad(m)}-${pad(d)}`;
  }
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return "";
}

async function calendarExportExcelGlobal() {
  if (!sb) return;
  const adminLib = st.libs.byId[currentAdminId()];
  if (!isSuperLibrary(adminLib)) {
    showMsg("#calendarMsg", "Kun super admin kan eksportere kalenderen.");
    return;
  }
  showMsg("#calendarMsg", "Genererer Excel …");
  const { data, error } = await sb
    .from(HOLIDAY_TABLE)
    .select("holiday_date,title,notes")
    .order("holiday_date", { ascending: true });
  if (error) {
    showMsg("#calendarMsg", "Kunne ikke hente kalender: " + error.message);
    return;
  }
  try {
    await ensureSheetJs();
  } catch (e) {
    showMsg("#calendarMsg", e.message);
    return;
  }
  const rows = (data || []).map(row => ({
    Dato: row.holiday_date || "",
    Titel: row.title || "",
    Noter: row.notes || ""
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{
    Dato: "",
    Titel: "",
    Noter: ""
  }]);
  XLSX.utils.book_append_sheet(wb, ws, "Kalender");
  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "kalender.xlsx";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showMsg("#calendarMsg", "Excel klar til download.", true);
}

async function calendarImportExcelGlobal(file) {
  if (!sb || !file) return;
  const adminLib = st.libs.byId[currentAdminId()];
  if (!isSuperLibrary(adminLib)) {
    showMsg("#calendarMsg", "Kun super admin kan importere kalenderen.");
    return;
  }
  try {
    await ensureSheetJs();
  } catch (e) {
    showMsg("#calendarMsg", e.message);
    return;
  }
  showMsg("#calendarMsg", "Indlæser Excel …");
  let workbook;
  try {
    const buffer = await file.arrayBuffer();
    workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  } catch (e) {
    showMsg("#calendarMsg", "Kunne ikke læse filen: " + e.message);
    return;
  }
  const sheetName = workbook.SheetNames?.[0];
  if (!sheetName) {
    showMsg("#calendarMsg", "Excel-filen indeholder ingen ark.");
    return;
  }
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
  if (!rows.length) {
    showMsg("#calendarMsg", "Excel-arket er tomt.");
    return;
  }

  const additionMap = new Map();
  const deletionSet = new Set();
  const failures = [];
  const getValue = (row, ...keys) => {
    for (const key of keys) {
      if (row[key] != null && row[key] !== "") return row[key];
      const lower = typeof key === "string" ? key.toLowerCase() : key;
      if (row[lower] != null && row[lower] !== "") return row[lower];
    }
    return "";
  };

  rows.forEach((row, idx) => {
    const line = idx + 2;
    const actionRaw = String(getValue(row, "Handling", "handling", "Action")).trim().toLowerCase();
    const action = actionRaw || "tilføj";
    const isoDate = normalizeHolidayDate(getValue(row, "Dato", "date"));
    if (!isoDate) {
      failures.push(`Række ${line}: dato mangler eller er ugyldig.`);
      return;
    }
    if (action === "slet" || action === "delete") {
      additionMap.delete(isoDate);
      deletionSet.add(isoDate);
      return;
    }
    const title = String(getValue(row, "Titel", "title", "Beskrivelse")).trim();
    if (!title) {
      failures.push(`Række ${line}: titel skal udfyldes.`);
      return;
    }
    const notes = String(getValue(row, "Noter", "notes", "Note")).trim();
    additionMap.set(isoDate, { holiday_date: isoDate, title, notes });
  });

  const additions = Array.from(additionMap.values());
  const deletions = Array.from(deletionSet);

  if (!additions.length && !deletions.length) {
    showMsg("#calendarMsg", failures[0] || "Ingen gyldige rækker fundet.");
    return;
  }

  const chunkSize = 100;
  let upsertsDone = 0;
  for (let i = 0; i < additions.length; i += chunkSize) {
    const chunk = additions.slice(i, i + chunkSize);
    const { error } = await sb.from(HOLIDAY_TABLE).upsert(chunk, { onConflict: "holiday_date" });
    if (error) {
      showMsg("#calendarMsg", "Fejl ved import: " + error.message);
      return;
    }
    upsertsDone += chunk.length;
  }

  let deletesDone = 0;
  for (let i = 0; i < deletions.length; i += chunkSize) {
    const chunk = deletions.slice(i, i + chunkSize);
    const { error } = await sb
      .from(HOLIDAY_TABLE)
      .delete()
      .in("holiday_date", chunk);
    if (error) {
      showMsg("#calendarMsg", "Fejl ved sletning: " + error.message);
      return;
    }
    deletesDone += chunk.length;
  }

  const parts = [];
  if (upsertsDone) parts.push(`opdaterede ${upsertsDone} dag(e)`);
  if (deletesDone) parts.push(`slettede ${deletesDone}`);
  showMsg("#calendarMsg", parts.length ? `Import gennemført: ${parts.join(", ")}.` : "Import gennemført.", true);
  if (failures.length) {
    alert("Følgende rækker blev sprunget over:\n" + failures.join("\n"));
  }
  await calendarPullGlobal();
}

async function calendarPullGlobal() {
  if (!sb) return;
  const msgSel = "#calendarMsg";
  const adminLib = st.libs.byId[currentAdminId()];
  const isSuper = isSuperLibrary(adminLib);
  const globalSection = $("#calendarGlobalSection");
  if (globalSection) globalSection.style.display = isSuper ? "" : "none";
  setCalendarFormEnabledGlobal(isSuper);
  if (!isSuper) {
    renderCalendarRowsGlobal([]);
    showMsg(msgSel, "Kun super admin kan vedligeholde kalenderen.");
    return;
  }

  showMsg(msgSel, "Henter kalender...");
  const { data, error } = await sb
    .from(HOLIDAY_TABLE)
    .select("holiday_id,holiday_date,title,notes")
    .order("holiday_date", { ascending: true });

  if (error) {
    showMsg(msgSel, "Kunne ikke hente kalender: " + error.message);
    return;
  }
  st.calendar.list = data || [];
  renderCalendarRowsGlobal(st.calendar.list);
  showMsg(msgSel, st.calendar.list.length ? `Indlæst ${st.calendar.list.length} dag(e).` : "Ingen dage registreret.", true);
}

function renderCalendarLocalRows(rows) {
  const tb = $("#tblCalendarLocal tbody");
  if (!tb) return;
  tb.innerHTML = "";
  if (!rows || !rows.length) {
    tb.appendChild(el("tr", {}, el("td", { colspan: 4 }, "Ingen lokale lukkedage.")));
    return;
  }
  rows.forEach(row => {
    const dateStr = row.holiday_date ? new Date(row.holiday_date).toLocaleDateString("da-DK") : "";
    const delBtn = el("button", { class: "btn btn-small", "data-cal-local-delete": row.local_holiday_id }, "Slet");
    tb.appendChild(el("tr", {},
      el("td", {}, dateStr),
      el("td", {}, row.title || ""),
      el("td", {}, row.notes || ""),
      el("td", {}, delBtn)
    ));
  });
}

async function calendarPullLocal() {
  if (!sb) return;
  const msgSel = "#calendarLocalMsg";
  const section = $("#calendarLocalSection");
  const ownerLabel = $("#calendarLocalOwner");
  const ownerId = currentAdminId();
  const adminLib = st.libs.byId[ownerId];
  if (section) section.style.display = st.role === "admin" ? "" : "none";
  if (!ownerId || st.role !== "admin") {
    renderCalendarLocalRows([]);
    showMsg(msgSel, st.role === "admin" ? "Vælg et centralbibliotek først." : "Kalender er kun tilgængelig for admins.");
    return;
  }
  if (ownerLabel) ownerLabel.textContent = fmtLibLabel(adminLib) || ownerId;
  showMsg(msgSel, "Henter lokal kalender...");
  const { data, error } = await sb
    .from(LOCAL_HOLIDAY_TABLE)
    .select("local_holiday_id,holiday_date,title,notes,source_global")
    .eq("owner_bibliotek_id", ownerId)
    .order("holiday_date", { ascending: true });
  if (error) {
    showMsg(msgSel, "Kunne ikke hente lokal kalender: " + error.message);
    return;
  }
  st.calendar.local = data || [];
  renderCalendarLocalRows(st.calendar.local);
  showMsg(msgSel, st.calendar.local.length ? `Indlæst ${st.calendar.local.length} dag(e).` : "Ingen lokale dage registreret.", true);
}

async function calendarLocalAdd() {
  if (!sb) return;
  const ownerId = currentAdminId();
  if (!ownerId) {
    showMsg("#calendarLocalMsg", "Vælg først et centralbibliotek.");
    return;
  }
  const date = $("#calLocalDate")?.value || "";
  const title = $("#calLocalTitle")?.value.trim() || "";
  const notes = $("#calLocalNotes")?.value.trim() || "";
  if (!date) {
    showMsg("#calendarLocalMsg", "Dato skal udfyldes.");
    return;
  }
  if (!title) {
    showMsg("#calendarLocalMsg", "Beskrivelse skal udfyldes.");
    return;
  }
  showMsg("#calendarLocalMsg", "Gemmer dag...");
  const payload = { owner_bibliotek_id: ownerId, holiday_date: date, title, notes };
  const { error } = await sb.from(LOCAL_HOLIDAY_TABLE).upsert(payload, { onConflict: "owner_bibliotek_id,holiday_date" });
  if (error) {
    showMsg("#calendarLocalMsg", "Kunne ikke gemme: " + error.message);
    return;
  }
  ["#calLocalDate", "#calLocalTitle", "#calLocalNotes"].forEach(sel => {
    const elRef = $(sel);
    if (elRef) elRef.value = "";
  });
  showMsg("#calendarLocalMsg", "Dag gemt.", true);
  if (st.calendar.localSets) {
    delete st.calendar.localSets[ownerId];
  }
  await calendarPullLocal();
}

async function calendarLocalDelete(id) {
  if (!sb || !id) return;
  const ownerId = currentAdminId();
  if (!ownerId) {
    showMsg("#calendarLocalMsg", "Vælg først et centralbibliotek.");
    return;
  }
  if (!confirm("Slet denne lokale dag?")) return;
  const { error } = await sb
    .from(LOCAL_HOLIDAY_TABLE)
    .delete()
    .eq("owner_bibliotek_id", ownerId)
    .eq("local_holiday_id", id);
  if (error) {
    showMsg("#calendarLocalMsg", "Kunne ikke slette: " + error.message);
    return;
  }
  showMsg("#calendarLocalMsg", "Dag slettet.", true);
  if (st.calendar.localSets) {
    delete st.calendar.localSets[ownerId];
  }
  await calendarPullLocal();
}

async function calendarLocalResync() {
  if (!sb) return;
  const ownerId = currentAdminId();
  if (!ownerId) {
    showMsg("#calendarLocalMsg", "Vælg først et centralbibliotek.");
    return;
  }
  showMsg("#calendarLocalMsg", "Synkroniserer globale dage …");
  const { data: globalRows, error: globalError } = await sb
    .from(HOLIDAY_TABLE)
    .select("holiday_date,title,notes")
    .order("holiday_date", { ascending: true });
  if (globalError) {
    showMsg("#calendarLocalMsg", "Kunne ikke hente globale dage: " + globalError.message);
    return;
  }
  const { data: existing } = await sb
    .from(LOCAL_HOLIDAY_TABLE)
    .select("holiday_date")
    .eq("owner_bibliotek_id", ownerId);
  const existingSet = new Set((existing || []).map(r => r.holiday_date));
  const toInsert = globalRows
    .filter(row => row.holiday_date && !existingSet.has(row.holiday_date))
    .map(row => ({
      owner_bibliotek_id: ownerId,
      holiday_date: row.holiday_date,
      title: row.title,
      notes: row.notes,
      source_global: true
    }));
  if (toInsert.length) {
    const chunkSize = 100;
    for (let i = 0; i < toInsert.length; i += chunkSize) {
      const chunk = toInsert.slice(i, i + chunkSize);
      const { error } = await sb.from(LOCAL_HOLIDAY_TABLE).upsert(chunk, { onConflict: "owner_bibliotek_id,holiday_date" });
      if (error) {
        showMsg("#calendarLocalMsg", "Synkronisering fejlede: " + error.message);
        return;
      }
    }
  }
  showMsg("#calendarLocalMsg", toInsert.length ? `Tilføjede ${toInsert.length} global(e) dag(e).` : "Alle globale dage var allerede til stede.", true);
  if (st.calendar.localSets) {
    delete st.calendar.localSets[ownerId];
  }
  await calendarPullLocal();
}

async function calendarLocalExportExcel() {
  if (!sb) return;
  const ownerId = currentAdminId();
  if (!ownerId) {
    showMsg("#calendarLocalMsg", "Vælg først et centralbibliotek.");
    return;
  }
  showMsg("#calendarLocalMsg", "Genererer Excel …");
  const { data, error } = await sb
    .from(LOCAL_HOLIDAY_TABLE)
    .select("holiday_date,title,notes")
    .eq("owner_bibliotek_id", ownerId)
    .order("holiday_date", { ascending: true });
  if (error) {
    showMsg("#calendarLocalMsg", "Kunne ikke hente kalender: " + error.message);
    return;
  }
  try {
    await ensureSheetJs();
  } catch (e) {
    showMsg("#calendarLocalMsg", e.message);
    return;
  }
  const rows = (data || []).map(row => ({
    Dato: row.holiday_date || "",
    Titel: row.title || "",
    Noter: row.notes || ""
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{
    Dato: "",
    Titel: "",
    Noter: ""
  }]);
  XLSX.utils.book_append_sheet(wb, ws, "Lokal kalender");
  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `kalender_${ownerId}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showMsg("#calendarLocalMsg", "Excel klar til download.", true);
}

async function calendarLocalImportExcel(file) {
  if (!sb || !file) return;
  const ownerId = currentAdminId();
  if (!ownerId) {
    showMsg("#calendarLocalMsg", "Vælg først et centralbibliotek.");
    return;
  }
  try {
    await ensureSheetJs();
  } catch (e) {
    showMsg("#calendarLocalMsg", e.message);
    return;
  }
  showMsg("#calendarLocalMsg", "Indlæser Excel …");
  let workbook;
  try {
    const buffer = await file.arrayBuffer();
    workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  } catch (e) {
    showMsg("#calendarLocalMsg", "Kunne ikke læse filen: " + e.message);
    return;
  }
  const sheetName = workbook.SheetNames?.[0];
  if (!sheetName) {
    showMsg("#calendarLocalMsg", "Excel-filen indeholder ingen ark.");
    return;
  }
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
  if (!rows.length) {
    showMsg("#calendarLocalMsg", "Excel-arket er tomt.");
    return;
  }

  const additionMap = new Map();
  const deletionSet = new Set();
  const failures = [];
  const getValue = (row, ...keys) => {
    for (const key of keys) {
      if (row[key] != null && row[key] !== "") return row[key];
      const lower = typeof key === "string" ? key.toLowerCase() : key;
      if (row[lower] != null && row[lower] !== "") return row[lower];
    }
    return "";
  };

  rows.forEach((row, idx) => {
    const line = idx + 2;
    const actionRaw = String(getValue(row, "Handling", "handling", "Action")).trim().toLowerCase();
    const action = actionRaw || "tilføj";
    const isoDate = normalizeHolidayDate(getValue(row, "Dato", "date"));
    if (!isoDate) {
      failures.push(`Række ${line}: dato mangler eller er ugyldig.`);
      return;
    }
    if (action === "slet" || action === "delete") {
      additionMap.delete(isoDate);
      deletionSet.add(isoDate);
      return;
    }
    const title = String(getValue(row, "Titel", "title", "Beskrivelse")).trim();
    if (!title) {
      failures.push(`Række ${line}: titel skal udfyldes.`);
      return;
    }
    const notes = String(getValue(row, "Noter", "notes", "Note")).trim();
    additionMap.set(isoDate, { owner_bibliotek_id: ownerId, holiday_date: isoDate, title, notes });
  });

  const additions = Array.from(additionMap.values());
  const deletions = Array.from(deletionSet);

  if (!additions.length && !deletions.length) {
    showMsg("#calendarLocalMsg", failures[0] || "Ingen gyldige rækker fundet.");
    return;
  }

  const chunkSize = 100;
  let upsertsDone = 0;
  for (let i = 0; i < additions.length; i += chunkSize) {
    const chunk = additions.slice(i, i + chunkSize);
    const { error } = await sb.from(LOCAL_HOLIDAY_TABLE).upsert(chunk, { onConflict: "owner_bibliotek_id,holiday_date" });
    if (error) {
      showMsg("#calendarLocalMsg", "Fejl ved import: " + error.message);
      return;
    }
    upsertsDone += chunk.length;
  }

  let deletesDone = 0;
  for (let i = 0; i < deletions.length; i += chunkSize) {
    const chunk = deletions.slice(i, i + chunkSize);
    const { error } = await sb
      .from(LOCAL_HOLIDAY_TABLE)
      .delete()
      .eq("owner_bibliotek_id", ownerId)
      .in("holiday_date", chunk);
    if (error) {
      showMsg("#calendarLocalMsg", "Fejl ved sletning: " + error.message);
      return;
    }
    deletesDone += chunk.length;
  }

  const parts = [];
  if (upsertsDone) parts.push(`opdaterede ${upsertsDone} dag(e)`);
  if (deletesDone) parts.push(`slettede ${deletesDone}`);
  showMsg("#calendarLocalMsg", parts.length ? `Import gennemført: ${parts.join(", ")}.` : "Import gennemført.", true);
  if (failures.length) {
    alert("Følgende rækker blev sprunget over:\n" + failures.join("\n"));
  }
  if (st.calendar.localSets) {
    delete st.calendar.localSets[ownerId];
  }
  await calendarPullLocal();
}

function toIsoDate(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function loadOwnerHolidaySet(ownerId) {
  if (!ownerId) return new Set();
  if (!st.calendar.localSets) st.calendar.localSets = {};
  if (st.calendar.localSets[ownerId]) return st.calendar.localSets[ownerId];
  const { data, error } = await sb
    .from(LOCAL_HOLIDAY_TABLE)
    .select("holiday_date")
    .eq("owner_bibliotek_id", ownerId);
  if (error) {
    console.error("Kunne ikke hente lokale helligdage:", error);
    st.calendar.localSets[ownerId] = new Set();
    return st.calendar.localSets[ownerId];
  }
  const set = new Set((data || []).map(row => row.holiday_date));
  st.calendar.localSets[ownerId] = set;
  return set;
}

function isHolidayDate(date, holidaySet) {
  const day = date.getDay();
  if (day === 0 || day === 6) return true;
  const iso = toIsoDate(date);
  return holidaySet?.has(iso);
}

function nextWorkingDay(date, holidaySet) {
  const d = new Date(date);
  while (isHolidayDate(d, holidaySet)) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

function firstWorkingDayOfMonth(year, month, holidaySet) {
  const start = new Date(year, month, 1);
  return nextWorkingDay(start, holidaySet);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function calculateEndDate(startDate, loanWeeks, bufferDays) {
  const totalDays = Math.max((Number(loanWeeks) || 0) * 7 + (Number(bufferDays) || 0), 0);
  return addDays(startDate, totalDays);
}

function slotOverlaps(startA, endA, booking) {
  const startB = new Date(booking.start_date);
  const endB = new Date(booking.end_date);
  return startA <= endB && endA >= startB;
}

function isSlotFree(start, end, bookings) {
  return !bookings.some(b => {
    const status = String(b.booking_status || "").toLowerCase();
    if (![BOOKING_STATUS_REQUESTED, BOOKING_STATUS_BOOKED].includes(status)) return false;
    return slotOverlaps(start, end, b);
  });
}

function advanceFirstWorkingRule(date, holidaySet) {
  const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return firstWorkingDayOfMonth(nextMonth.getFullYear(), nextMonth.getMonth(), holidaySet);
}

function advanceEvery14Rule(date, holidaySet) {
  const next = nextWorkingDay(addDays(date, 14), holidaySet);
  const nextMonthStart = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  const firstNextMonth = firstWorkingDayOfMonth(nextMonthStart.getFullYear(), nextMonthStart.getMonth(), holidaySet);
  if (next < firstNextMonth) return next;
  return firstNextMonth;
}

function computeNextBookingWindow(setRow, rule, holidaySet, bookings, baseDate) {
  let today = baseDate ? new Date(baseDate) : new Date();
  if (Number.isNaN(today.getTime())) {
    today = new Date();
  }
  let candidate;
  const maxIterations = 60;
  if (rule === BOOKING_RULE_EVERY14) {
    candidate = firstWorkingDayOfMonth(today.getFullYear(), today.getMonth(), holidaySet);
    while (candidate <= today) {
      candidate = advanceEvery14Rule(candidate, holidaySet);
    }
    for (let i = 0; i < maxIterations; i++) {
      const end = calculateEndDate(candidate, setRow.loan_weeks, setRow.buffer_days);
      if (isSlotFree(candidate, end, bookings)) {
        return { start: toIsoDate(candidate), end: toIsoDate(end) };
      }
      candidate = advanceEvery14Rule(candidate, holidaySet);
    }
    return null;
  }
  candidate = firstWorkingDayOfMonth(today.getFullYear(), today.getMonth(), holidaySet);
  if (candidate <= today) {
    candidate = advanceFirstWorkingRule(candidate, holidaySet);
  }
  for (let i = 0; i < maxIterations; i++) {
    const end = calculateEndDate(candidate, setRow.loan_weeks, setRow.buffer_days);
    if (isSlotFree(candidate, end, bookings)) {
      return { start: toIsoDate(candidate), end: toIsoDate(end) };
    }
    candidate = advanceFirstWorkingRule(candidate, holidaySet);
  }
  return null;
}

function bookingRuleLabel(value) {
  return BOOKING_RULE_OPTIONS.find(opt => opt.value === value)?.label || "";
}

function formatDateDisplay(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("da-DK");
}

async function fetchBookingsForSetIds(setIds) {
  const map = new Map();
  if (!sb || !setIds.length) return map;
  const { data, error } = await sb
    .from("tbl_booking")
    .select("booking_id,set_id,start_date,end_date,booking_status,requester_bibliotek_id")
    .in("set_id", setIds);
  if (error) {
    console.error("Kunne ikke hente eksisterende bookinger:", error);
    return map;
  }
  (data || []).forEach(row => {
    if (!map.has(row.set_id)) map.set(row.set_id, []);
    map.get(row.set_id).push(row);
  });
  return map;
}

function generateSlotsForSet(setRow, rule, holidaySet, minStartDate, horizonDate) {
  const slots = [];
  let candidate = firstWorkingDayOfMonth(minStartDate.getFullYear(), minStartDate.getMonth(), holidaySet);
  if (rule === BOOKING_RULE_EVERY14) {
    while (candidate < minStartDate) {
      candidate = advanceEvery14Rule(candidate, holidaySet);
    }
    while (candidate < horizonDate) {
      const end = calculateEndDate(candidate, setRow.loan_weeks, setRow.buffer_days);
      slots.push({ start: toIsoDate(candidate), end: toIsoDate(end) });
      candidate = advanceEvery14Rule(candidate, holidaySet);
    }
    return slots;
  }
  // first working day per month
  while (candidate < minStartDate) {
    candidate = advanceFirstWorkingRule(candidate, holidaySet);
  }
  while (candidate < horizonDate) {
    const end = calculateEndDate(candidate, setRow.loan_weeks, setRow.buffer_days);
    slots.push({ start: toIsoDate(candidate), end: toIsoDate(end) });
    candidate = advanceFirstWorkingRule(candidate, holidaySet);
  }
  return slots;
}

async function ensureBookingSlotsForSet(setRow, rule, holidaySet, minStartDate = new Date()) {
  if (!sb || !setRow?.set_id) return;
  const minStart = new Date(minStartDate);
  minStart.setHours(0, 0, 0, 0);
  const horizon = addMonths(minStart, BOOKING_SLOT_HORIZON_MONTHS);
  const { data, error } = await sb
    .from("tbl_booking")
    .select("booking_id,start_date,end_date,booking_status")
    .eq("set_id", setRow.set_id);
  if (error) {
    console.error("Kunne ikke hente booking slots:", error);
    return;
  }
  let existing = data || [];
  const outdated = existing
    .filter(b => {
      if (b.booking_status !== BOOKING_STATUS_AVAILABLE) return false;
      const start = new Date(b.start_date);
      return start < minStart || start > horizon;
    })
    .map(b => b.booking_id);
  if (outdated.length) {
    await sb.from("tbl_booking").delete().in("booking_id", outdated);
    existing = existing.filter(b => !outdated.includes(b.booking_id));
  }
  const slots = generateSlotsForSet(setRow, rule, holidaySet, minStart, horizon);
  const inserts = [];
  slots.forEach(slot => {
    const start = new Date(slot.start);
    const end = new Date(slot.end);
    const overlaps = existing.some(b => b.booking_status !== BOOKING_STATUS_AVAILABLE && slotOverlaps(start, end, b));
    if (overlaps) return;
    const already = existing.some(b =>
      b.booking_status === BOOKING_STATUS_AVAILABLE &&
      b.start_date === slot.start &&
      b.end_date === slot.end
    );
    if (already) return;
    inserts.push({
      set_id: setRow.set_id,
      owner_bibliotek_id: setRow.owner_bibliotek_id,
      requester_bibliotek_id: null,
      start_date: slot.start,
      end_date: slot.end,
      booking_status: BOOKING_STATUS_AVAILABLE,
      notes: null
    });
  });
  if (inserts.length) {
    await sb.from("tbl_booking").insert(inserts);
  }
}

async function fetchSetsByOwner(ownerId) {
  if (!sb || !ownerId) return [];
  const { data, error } = await sb
    .from("tbl_saet")
    .select("set_id,title,owner_bibliotek_id,loan_weeks,buffer_days,active")
    .eq("owner_bibliotek_id", ownerId)
    .eq("active", true);
  if (error) {
    console.error("Kunne ikke hente sæt:", error);
    return [];
  }
  return data || [];
}

async function regenerateBookingSlotsForOwner(ownerId) {
  if (!ownerId || bookingSlotLocks.has(ownerId)) return;
  bookingSlotLocks.add(ownerId);
  try {
    const sets = await fetchSetsByOwner(ownerId);
    if (!sets.length) return;
    const rule = currentBookingRule(ownerId);
    const holidaySet = await loadOwnerHolidaySet(ownerId);
    for (const setRow of sets) {
      await ensureBookingSlotsForSet(setRow, rule, holidaySet);
    }
  } finally {
    bookingSlotLocks.delete(ownerId);
  }
}


function compareBookerRows(a, b) {
  const dir = st.b.sortDir === "desc" ? -1 : 1;
  const field = st.b.sortBy;
  const getString = val => (val || "").toString().toLowerCase();
  const getNumber = val => Number(val) || 0;
  if (field === "title") return dir * getString(a.title).localeCompare(getString(b.title));
  if (field === "author") return dir * getString(a.author).localeCompare(getString(b.author));
  if (field === "isbn") return dir * getString(a.isbn).localeCompare(getString(b.isbn));
  if (field === "faust") return dir * getString(a.faust).localeCompare(getString(b.faust));
  if (field === "visibility") return dir * getString(a.visibility).localeCompare(getString(b.visibility));
  if (field === "owner") {
    const aOwner = st.libs.byId[a.owner_bibliotek_id];
    const bOwner = st.libs.byId[b.owner_bibliotek_id];
    const aLabel = aOwner ? (aOwner.bibliotek_navn?.split(" ")[0] || fmtLibLabel(aOwner)) : (a.owner_bibliotek_id || "");
    const bLabel = bOwner ? (bOwner.bibliotek_navn?.split(" ")[0] || fmtLibLabel(bOwner)) : (b.owner_bibliotek_id || "");
    return dir * getString(aLabel).localeCompare(getString(bLabel));
  }
  if (field === "rule") return dir * getString(bookingRuleLabel(a.bookingRule)).localeCompare(getString(bookingRuleLabel(b.bookingRule)));
  if (field === "loan_weeks") return dir * (getNumber(a.loan_weeks) - getNumber(b.loan_weeks));
  if (field === "requested_count") return dir * (getNumber(a.requested_count) - getNumber(b.requested_count));
  if (field === "next") {
    const aTime = a.availableSlots?.length ? new Date(a.availableSlots[0].start_date).getTime() : Infinity;
    const bTime = b.availableSlots?.length ? new Date(b.availableSlots[0].start_date).getTime() : Infinity;
    return dir * (aTime - bTime);
  }
  return dir * getString(a.title).localeCompare(getString(b.title));
}

function setBookerSort(field) {
  if (!field) return;
  if (st.b.sortBy === field) {
    st.b.sortDir = st.b.sortDir === "asc" ? "desc" : "asc";
  } else {
    st.b.sortBy = field;
    st.b.sortDir = "asc";
  }
  renderBookerResults();
}

function updateBookerSortIndicators() {
  document.querySelectorAll("#bTbl thead th[data-sort]").forEach(th => {
    const field = th.dataset.sort;
    th.classList.toggle("sorted-asc", st.b.sortBy === field && st.b.sortDir === "asc");
    th.classList.toggle("sorted-desc", st.b.sortBy === field && st.b.sortDir === "desc");
  });
}

async function loadBookingRules() {
  if (!sb) return {};
  const { data, error } = await sb
    .from(BOOKING_RULE_TABLE)
    .select("owner_bibliotek_id,rule");
  if (error) {
    console.error("Kunne ikke hente bookingregler:", error);
    st.bookingRules.byOwner = {};
    return {};
  }
  const map = {};
  (data || []).forEach(row => {
    if (!row.owner_bibliotek_id) return;
    map[row.owner_bibliotek_id] = row.rule || BOOKING_RULE_DEFAULT;
  });
  st.bookingRules.byOwner = map;
  return map;
}

function currentBookingRule(ownerId) {
  return st.bookingRules.byOwner?.[ownerId] || BOOKING_RULE_DEFAULT;
}

async function bookingRulePull() {
  const msgSel = "#bookingRuleMsg";
  if (!sb) {
    showMsg(msgSel, "Forbindelse til databasen mangler.");
    return;
  }
  if (st.role !== "admin") {
    showMsg(msgSel, "Bookingregler er kun tilgængelige for admin-profiler.");
    return;
  }
  const adminId = currentAdminId();
  const adminLib = st.libs.byId[adminId];
  const isSuper = isSuperLibrary(adminLib);
  const ownerWrap = $("#bookingRuleOwnerWrap");
  if (ownerWrap) ownerWrap.style.display = isSuper ? "" : "none";
  const superHint = $("#bookingRuleSuperHint");
  if (superHint) superHint.style.display = isSuper ? "inline" : "none";
  const ownerSel = $("#bookingRuleOwnerSel");
  if (isSuper && ownerSel && !ownerSel.options.length) {
    populateBookingRuleOwnerSelect();
  }
  let ownerId = st.bookingRules.owner || adminId;
  if (isSuper && ownerSel) {
    if (!ownerSel.value && ownerId) ownerSel.value = ownerId;
    ownerId = ownerSel.value || ownerId || adminId;
  } else {
    ownerId = adminId;
    if (ownerSel) ownerSel.value = ownerId || "";
  }
  if (!ownerId) {
    showMsg(msgSel, "Vælg først et centralbibliotek via Skift: Admin ↔ Booker.");
    return;
  }
  st.bookingRules.owner = ownerId;
  showMsg(msgSel, "Henter bookingregel …");
  await loadBookingRules();
  const selectEl = $("#bookingRuleSelect");
  if (selectEl) selectEl.value = currentBookingRule(ownerId);
  showMsg(msgSel, "Regel opdateret.", true);
}

async function bookingRuleSave() {
  if (!sb) return;
  const ownerId = st.bookingRules.owner || currentAdminId();
  if (!ownerId) {
    showMsg("#bookingRuleMsg", "Ingen centralbibliotek valgt.");
    return;
  }
  const rule = $("#bookingRuleSelect")?.value || BOOKING_RULE_DEFAULT;
  showMsg("#bookingRuleMsg", "Gemmer bookingregel …");
  const payload = { owner_bibliotek_id: ownerId, rule };
  const { error } = await sb
    .from(BOOKING_RULE_TABLE)
    .upsert(payload, { onConflict: "owner_bibliotek_id" });
  if (error) {
    showMsg("#bookingRuleMsg", "Kunne ikke gemme: " + error.message);
    return;
  }
  if (!st.bookingRules.byOwner) st.bookingRules.byOwner = {};
  st.bookingRules.byOwner[ownerId] = rule;
  showMsg("#bookingRuleMsg", "Bookingregel gemt.", true);
  await regenerateBookingSlotsForOwner(ownerId);
}

async function bookingRequestsPull() {
  if (!sb) return;
  const ownerId = currentAdminId();
  if (!ownerId) {
    showMsg("#bookingRequestsMsg", "Vælg først et centralbibliotek.");
    return;
  }
  const { data, error } = await sb
    .from("tbl_booking")
    .select("booking_id,set_id,requester_bibliotek_id,start_date,end_date,booking_status,notes")
    .eq("owner_bibliotek_id", ownerId)
    .in("booking_status", [BOOKING_STATUS_REQUESTED, BOOKING_STATUS_BOOKED])
    .order("start_date", { ascending: true });
  if (error) {
    showMsg("#bookingRequestsMsg", "Kunne ikke hente anmodninger: " + error.message);
    return;
  }
  st.booking.requests = data || [];
  renderBookingRequests();
}

function renderBookingRequests() {
  const tb = $("#tblBookingRequests tbody");
  if (!tb) return;
  tb.innerHTML = "";
  const ownerId = currentAdminId();
  const ownerLabel = ownerId ? (fmtLibLabel(st.libs.byId[ownerId]) || ownerId) : "";
  const hint = $("#bookingRequestsOwner");
  if (hint) hint.textContent = ownerLabel;
  const rows = st.booking.requests || [];
  if (!rows.length) {
    tb.appendChild(el("tr", {}, el("td", { colspan: 6 }, "Ingen anmodninger.")));
    showMsg("#bookingRequestsMsg", "Ingen aktuelle anmodninger.");
    return;
  }
  rows.forEach(r => {
    const requester = st.libs.byId[r.requester_bibliotek_id];
    const requesterLabel = requester ? fmtLibLabel(requester) : r.requester_bibliotek_id || "";
    const set = st.saet?.list?.find?.(s => s.set_id === r.set_id) || null;
    const statusLabel = r.booking_status === BOOKING_STATUS_BOOKED ? "Booket"
      : r.booking_status === BOOKING_STATUS_REQUESTED ? "Reserveret"
      : r.booking_status === BOOKING_STATUS_AVAILABLE ? "Ledig"
      : "Annulleret";
    const tr = el("tr", {},
      el("td", {}, set?.title || `Sæt #${r.set_id}` || ""),
      el("td", {}, requesterLabel),
      el("td", {}, formatDateDisplay(r.start_date)),
      el("td", {}, formatDateDisplay(r.end_date)),
      el("td", {}, statusLabel || ""),
      el("td", {},
        el("button", {
          class: "btn btn-small",
          disabled: r.booking_status === BOOKING_STATUS_BOOKED,
          "data-booking-approve": r.booking_id,
          "data-booking-set": r.set_id
        }, "Godkend"),
        " ",
        el("button", {
          class: "btn btn-small",
          "data-booking-cancel": r.booking_id,
          "data-booking-set": r.set_id
        }, "Afvis")
      )
    );
    tb.appendChild(tr);
  });
  showMsg("#bookingRequestsMsg", `${rows.length} anmodning(er) fundet.`, true);
}

async function bookingRequestsUpdate(bookingId, action, setId) {
  if (!sb || !bookingId) return;
  const msgSel = "#bookingRequestsMsg";
  showMsg(msgSel, "Opdaterer anmodning …");
  const updates = action === "approve"
    ? { booking_status: BOOKING_STATUS_BOOKED }
    : { booking_status: BOOKING_STATUS_AVAILABLE, requester_bibliotek_id: null };
  const { error } = await sb
    .from("tbl_booking")
    .update(updates)
    .eq("booking_id", bookingId);
  if (error) {
    showMsg(msgSel, "Kunne ikke opdatere anmodning: " + error.message);
    return;
  }
  showMsg(msgSel, action === "approve" ? "Anmodning godkendt." : "Anmodning afvist.", true);
  if (setId) {
    const ownerId = currentAdminId();
    await regenerateBookingSlotsForOwner(ownerId);
  }
  await bookingRequestsPull();
}

async function calendarAddGlobal() {
  if (!sb) return;
  const date = $("#calDate")?.value || "";
  const title = $("#calTitle")?.value.trim() || "";
  const notes = $("#calNotes")?.value.trim() || "";
  if (!date) {
    showMsg("#calendarMsg", "Dato skal udfyldes.");
    return;
  }
  if (!title) {
    showMsg("#calendarMsg", "Beskrivelse skal udfyldes.");
    return;
  }
  showMsg("#calendarMsg", "Gemmer dag...");
  const payload = { holiday_date: date, title, notes };
  const { error } = await sb.from(HOLIDAY_TABLE).insert(payload);
  if (error) {
    showMsg("#calendarMsg", "Kunne ikke gemme: " + error.message);
    return;
  }
  clearCalendarFormGlobal();
  showMsg("#calendarMsg", "Dag tilføjet.", true);
  await calendarPullGlobal();
}

async function calendarDeleteGlobal(id) {
  if (!sb || !id) return;
  if (!confirm("Slet denne dag fra kalenderen?")) return;
  const { error } = await sb.from(HOLIDAY_TABLE).delete().eq("holiday_id", id);
  if (error) {
    showMsg("#calendarMsg", "Kunne ikke slette: " + error.message);
    return;
  }
  showMsg("#calendarMsg", "Dag slettet.", true);
  await calendarPullGlobal();
}

function bindCalendarControls() {
  $("#btnCalAdd")?.addEventListener("click", calendarAddGlobal);
  $("#btnCalRefresh")?.addEventListener("click", () => calendarPullGlobal());
  $("#btnCalExport")?.addEventListener("click", () => calendarExportExcelGlobal());
  $("#btnCalImport")?.addEventListener("click", () => $("#calImportFile")?.click());
  $("#calImportFile")?.addEventListener("change", evt => {
    const file = evt.target?.files?.[0];
    if (file) {
      calendarImportExcelGlobal(file);
    }
    evt.target.value = "";
  });
  $("#tblCalendar")?.addEventListener("click", evt => {
    const btn = evt.target.closest("button[data-cal-delete]");
    if (!btn) return;
    const id = Number(btn.getAttribute("data-cal-delete"));
    if (id) calendarDeleteGlobal(id);
  });

  $("#btnCalLocalAdd")?.addEventListener("click", calendarLocalAdd);
  $("#btnCalLocalRefresh")?.addEventListener("click", () => calendarPullLocal());
  $("#btnCalLocalResync")?.addEventListener("click", () => calendarLocalResync());
  $("#btnCalLocalExport")?.addEventListener("click", () => calendarLocalExportExcel());
  $("#btnCalLocalImport")?.addEventListener("click", () => $("#calLocalImportFile")?.click());
  $("#calLocalImportFile")?.addEventListener("change", evt => {
    const file = evt.target?.files?.[0];
    if (file) {
      calendarLocalImportExcel(file);
    }
    evt.target.value = "";
  });
  $("#tblCalendarLocal")?.addEventListener("click", evt => {
    const btn = evt.target.closest("button[data-cal-local-delete]");
    if (!btn) return;
    const id = Number(btn.getAttribute("data-cal-local-delete"));
    if (id) calendarLocalDelete(id);
  });
}

function bindBookingRuleControls() {
  $("#bookingRuleOwnerSel")?.addEventListener("change", () => {
    st.bookingRules.owner = $("#bookingRuleOwnerSel").value || currentAdminId();
    bookingRulePull();
  });
  $("#btnBookingRuleSave")?.addEventListener("click", () => bookingRuleSave());
}

function bindBookingRequestControls() {
  $("#tblBookingRequests")?.addEventListener("click", evt => {
    const approve = evt.target.closest("button[data-booking-approve]");
    if (approve) {
      const bookingId = Number(approve.getAttribute("data-booking-approve"));
      const setId = Number(approve.getAttribute("data-booking-set"));
      bookingRequestsUpdate(bookingId, "approve", setId);
      return;
    }
    const cancel = evt.target.closest("button[data-booking-cancel]");
    if (cancel) {
      const bookingId = Number(cancel.getAttribute("data-booking-cancel"));
      const setId = Number(cancel.getAttribute("data-booking-set"));
      bookingRequestsUpdate(bookingId, "cancel", setId);
    }
  });
}

// ----------------------------------------------------------
// 11. Booker â€“ sÃ¸gning (tbl_saet + relationer)
// ----------------------------------------------------------

async function resolveBookerCentrals() {
  st.b.centralIds = [];
  if (!sb || !st.profile.bookerLocalId) return;
  const { data, error } = await sb
    .from("tbl_bibliotek_relation")
    .select("central_id,active")
    .eq("bibliotek_id", st.profile.bookerLocalId)
    .eq("active", true);
  if (error) {
    console.error("resolveBookerCentrals:", error);
    return;
  }
  st.b.centralIds = (data || []).map(r => r.central_id);
}

async function bookerSearchInternal() {
  if (!sb) return [];
  const q = st.b.q;
  const centralIds = st.b.centralIds;

  // national
  let qNat = sb.from("tbl_saet")
    .select("set_id,title,author,isbn,faust,visibility,owner_bibliotek_id,active,requested_count,loan_weeks,buffer_days")
    .ilike("visibility", "national")
    .eq("active", true);

  // regional
  let qReg = sb.from("tbl_saet")
    .select("set_id,title,author,isbn,faust,visibility,owner_bibliotek_id,active,requested_count,loan_weeks,buffer_days")
    .ilike("visibility", "regional")
    .eq("active", true);

  if (q) {
    qNat = qNat.or([
      `title.ilike.%${q}%`,
      `author.ilike.%${q}%`,
      `isbn.ilike.%${q}%`,
      `faust.ilike.%${q}%`
    ].join(","));
    qReg = qReg.or([
      `title.ilike.%${q}%`,
      `author.ilike.%${q}%`,
      `isbn.ilike.%${q}%`,
      `faust.ilike.%${q}%`
    ].join(","));
  }

  const [natRes, regRes] = await Promise.all([
    qNat,
    centralIds.length ? qReg.in("owner_bibliotek_id", centralIds) : { data: [], error: null }
  ]);

  if (natRes.error) {
    showMsg("#bMsg", "Fejl ved national sÃ¸gning: " + natRes.error.message);
    return [];
  }
  if (regRes.error) {
    showMsg("#bMsg", "Fejl ved regional sÃ¸gning: " + regRes.error.message);
    return [];
  }

  const all = (natRes.data || []).concat(regRes.data || []);
  return all;
}

function renderBookerResults() {
  const tb = $("#bTbl tbody");
  if (!tb) return;

  const from = st.b.page * st.b.pageSize;
  const to = from + st.b.pageSize;
  const sorted = [...st.b.results].sort(compareBookerRows);
  const slice = sorted.slice(from, to);

  tb.innerHTML = "";
  slice.forEach(r => {
    const owner = st.libs.byId[r.owner_bibliotek_id];
    const ownerLabel = owner ? (owner.bibliotek_navn?.split(" ")[0] || fmtLibLabel(owner)) : r.owner_bibliotek_id || "";
    const ruleLabel = bookingRuleLabel(r.bookingRule) || "—";
    const loanWeeks = r.loan_weeks || "";
    const copies = r.requested_count || "";
    const nextInfo = r.availableSlots?.length
      ? renderSlotSelect(r)
      : el("span", { class: "hint" }, "Ingen ledige datoer");
    const btn = el("button", {
      class: "btn btn-small",
      type: "button",
      disabled: !r.availableSlots?.length
    }, "Anmod om booking");
    btn.addEventListener("click", ev => {
      ev.preventDefault();
      bookerRequestBooking(r.set_id);
    });
    const tr = el("tr", {},
      el("td", {}, r.title || ""),
      el("td", {}, r.author || ""),
      el("td", {}, r.isbn || ""),
      el("td", {}, r.faust || ""),
      el("td", {}, r.visibility || ""),
      el("td", {}, ownerLabel),
      el("td", {}, ruleLabel),
      el("td", {}, loanWeeks ? `${loanWeeks}` : ""),
      el("td", {}, copies ? `${copies}` : ""),
      el("td", {}, nextInfo),
      el("td", {}, btn)
    );
    tb.appendChild(tr);
  });

  const totalPages = Math.ceil((st.b.total || 0) / st.b.pageSize);
  $("#bInfo").textContent = st.b.total
    ? `Side ${st.b.page + 1}/${totalPages} - ${st.b.total} sæt`
    : "Ingen sæt fundet";
  updateBookerSortIndicators();
}

function renderSlotSelect(row) {
  const select = el("select", {
    class: "slot-select",
    "data-slot-set": row.set_id,
    onchange: ev => {
      row.selectedSlotId = ev.target.value;
    }
  });
  row.availableSlots.slice(0, 50).forEach(slot => {
    const label = `${formatDateDisplay(slot.start_date)} → ${formatDateDisplay(slot.end_date)}`;
    select.appendChild(el("option", { value: `${slot.booking_id}` }, label));
  });
  if (row.selectedSlotId) {
    select.value = row.selectedSlotId;
  } else if (row.availableSlots[0]) {
    select.value = `${row.availableSlots[0].booking_id}`;
    row.selectedSlotId = select.value;
  }
  return select;
}

async function bookerSearch() {
  if (!st.profile.bookerLocalId) {
    showMsg("#bMsg", "VÃ¦lg fÃ¸rst en booker-profil (regionsbibliotek).");
    return;
  }
  st.b.q = $("#bQ")?.value || "";
  st.b.weeks = Number($("#bWeeks")?.value || 8);
  st.b.start = $("#bStart")?.value || null;
  st.b.page = 0;

  await resolveBookerCentrals();
  const results = await bookerSearchInternal();
  await loadBookingRules();
  const setIds = results.map(r => r.set_id).filter(Boolean);
  const ownerIds = Array.from(new Set(results.map(r => r.owner_bibliotek_id).filter(Boolean)));
  await Promise.all(ownerIds.map(id => regenerateBookingSlotsForOwner(id)));
  const bookingMap = await fetchBookingsForSetIds(setIds);
  await Promise.all(ownerIds.map(id => loadOwnerHolidaySet(id)));
  const baseDate = st.b.start ? new Date(st.b.start) : new Date();
  await Promise.all(results.map(async r => {
    const holidaySet = await loadOwnerHolidaySet(r.owner_bibliotek_id);
    const bookings = bookingMap.get(r.set_id) || [];
    const rule = currentBookingRule(r.owner_bibliotek_id);
    r.bookingRule = rule;
    const availableSlots = bookings
      .filter(b => b.booking_status === BOOKING_STATUS_AVAILABLE && new Date(b.start_date) >= baseDate)
      .sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
    r.availableSlots = availableSlots;
    r.nextBooking = availableSlots.length
      ? { start: availableSlots[0].start_date, end: availableSlots[0].end_date }
      : null;
    r.selectedSlotId = availableSlots.length ? `${availableSlots[0].booking_id}` : "";
  }));
  const minWeeks = Number(st.b.weeks) || 0;
  const filtered = minWeeks ? results.filter(r => (Number(r.loan_weeks) || 0) >= minWeeks) : results;
  st.b.results = filtered;
  st.b.allResults = filtered;
  st.b.total = filtered.length;
  renderBookerResults();
}

async function bookerRequestBooking(setId) {
  if (!sb) return;
  const sorted = [...(st.b.allResults || st.b.results)].sort(compareBookerRows);
  const row = sorted.find(r => r.set_id === setId);
  if (!row) return;
  const requesterId = st.profile.bookerLocalId;
  if (!requesterId) {
    showMsg("#bMsg", "Vælg først et regionsbibliotek via Skift: Admin ↔ Booker.");
    return;
  }
  const bookingId = row.selectedSlotId || row.availableSlots?.[0]?.booking_id;
  if (!bookingId) {
    showMsg("#bMsg", "Vælg en ledig periode først.");
    return;
  }
  const targetSlot = row.availableSlots?.find(slot => `${slot.booking_id}` === bookingId);
  if (!targetSlot) {
    showMsg("#bMsg", "Kunne ikke finde den valgte periode.");
    return;
  }
  showMsg("#bMsg", "Sender bookinganmodning …");
  const { data, error } = await sb
    .from("tbl_booking")
    .update({
      booking_status: BOOKING_STATUS_REQUESTED,
      requester_bibliotek_id: requesterId
    })
    .eq("booking_id", targetSlot.booking_id)
    .eq("booking_status", BOOKING_STATUS_AVAILABLE)
    .select("booking_id");
  if (error || !data?.length) {
    showMsg("#bMsg", "Kunne ikke sende anmodning: " + (error?.message || "Slot ikke længere ledig."));
    return;
  }
  showMsg("#bMsg", "Anmodning sendt.", true);
  await bookerSearch();
}

function bindBookerControls() {
  $("#bSearch")?.addEventListener("click", () => {
    bookerSearch();
  });
  $("#bPrev")?.addEventListener("click", () => {
    if (st.b.page > 0) {
      st.b.page--;
      renderBookerResults();
    }
  });
  $("#bNext")?.addEventListener("click", () => {
    const totalPages = Math.ceil((st.b.total || 0) / st.b.pageSize);
    if (st.b.page < totalPages - 1) {
      st.b.page++;
      renderBookerResults();
    }
  });
  document.querySelectorAll("#bTbl thead th[data-sort]")?.forEach(th => {
    th.addEventListener("click", () => {
      const field = th.dataset.sort;
      if (field) setBookerSort(field);
    });
  });
}

// ----------------------------------------------------------
// 11. FÃ¦lles refresh pr. rolle & boot
// ----------------------------------------------------------

async function refreshForRole() {
  renderRoleBadge();
  renderLayout();

  if (st.role === "admin") {
    await loadInventorySummary();
    await eksPull();
    await saetPull();
    await relList();
    await calendarPullGlobal();
    await calendarPullLocal();
    await bookingRulePull();
    await bookingRequestsPull();
  } else {
    await bookerSearch();
  }
}

async function boot() {
  initSupabase();
  loadProfile();
  bindTabs();
  bindRoleControls();
  bindEksControls();
  bindSaetControls();
  bindAccessControls();
  bindBookingRuleControls();
  bindBookingRequestControls();
  bindCalendarControls();
  bindRelControls();
  bindBookerControls();

  await loadLibraries();
  await refreshForRole();
}

document.addEventListener("DOMContentLoaded", () => {
  boot().catch(e => console.error("Boot fejl:", e));
});
function saetDirtyRows() {
  return Array.from(document.querySelectorAll("#tblSaet tbody tr"))
    .filter(tr => tr.dataset.dirty === "1");
}

function markSaetDirty(tr) {
  if (!tr) return;
  tr.dataset.dirty = "1";
  tr.classList.add("saet-dirty");
  updateSaetSaveButton();
}

function clearSaetDirty(tr) {
  if (!tr) return;
  tr.dataset.dirty = "";
  tr.classList.remove("saet-dirty");
  updateSaetSaveButton();
}

function updateSaetSaveButton() {
  const btn = $("#btnSaetSaveAll");
  if (!btn) return;
  const count = saetDirtyRows().length;
  btn.disabled = count === 0;
  btn.textContent = count ? `Gem ${count} sÃ¦t` : "Gem Ã¦ndringer";
}

function saetAttachRowListeners(tr) {
  if (!tr) return;
  const fields = tr.querySelectorAll("input:not([readonly]), select:not([disabled])");
  fields.forEach(el => {
    el.addEventListener("input", () => markSaetDirty(tr));
    el.addEventListener("change", () => markSaetDirty(tr));
  });
  const isbnSelect = tr.querySelector(".saet-isbn");
  if (isbnSelect) {
    isbnSelect.addEventListener("change", () => markSaetDirty(tr));
  }
}

async function saetPrepareRecord(tr, usageOverride) {
  const setId = tr.dataset.setId ? Number(tr.dataset.setId) : null;
  const savedCount = Number(tr.dataset.savedCount || 0);

  const isbn = tr.querySelector(".saet-isbn")?.value || "";
  const owner_bibliotek_id = tr.querySelector(".saet-owner")?.value || currentAdminId() || "";

  let title = tr.querySelector(".saet-title")?.value.trim() || "";
  let author = tr.querySelector(".saet-author")?.value.trim() || "";
  let faust = tr.querySelector(".saet-faust")?.value.trim() || "";

  const meta = getInventoryMeta(owner_bibliotek_id, isbn);
  if (meta) {
    if (meta.title) title = meta.title;
    if (meta.author) author = meta.author;
    if (meta.faust) faust = meta.faust;
  }

  const requested_count = Math.floor(Number(tr.querySelector(".saet-requested")?.value || 0));
  const loan_weeks = Number(tr.querySelector(".saet-weeks")?.value || 0);
  const buffer_days = Number(tr.querySelector(".saet-buffer")?.value || 0);
  const visibility = (tr.querySelector(".saet-vis")?.value || "national").toLowerCase();
  const active = (tr.querySelector(".saet-active")?.value || "true") === "true";
  const allow_substitution = (tr.querySelector(".saet-sub")?.value || "false") === "true";
  const allow_partial = (tr.querySelector(".saet-part")?.value || "false") === "true";
  const min_delivery = Number(tr.querySelector(".saet-min")?.value || 0);

  const rec = {
    set_id: setId || undefined,
    title,
    author,
    isbn,
    faust,
    requested_count,
    loan_weeks,
    buffer_days,
    visibility,
    owner_bibliotek_id,
    active,
    allow_substitution,
    allow_partial,
    min_delivery
  };

  const err = saetValidate(rec);
  if (err) {
    return { error: err };
  }

  const capacity = ensureSaetCapacity(owner_bibliotek_id, isbn, requested_count, setId, savedCount, usageOverride);
  if (!capacity.ok) {
    return { error: capacity.message };
  }

  return { rec, savedCount };
}

async function saetSaveAll() {
  const rows = saetDirtyRows();
  if (!rows.length) {
    showMsg("#msgSaet", "Der er ingen Ã¦ndringer at gemme.");
    return;
  }
  if (!sb) return;

  const usageOverride = JSON.parse(JSON.stringify(st.saet.usage || {}));
  const failures = [];
  let successCount = 0;

  for (const tr of rows) {
    const prepared = await saetPrepareRecord(tr, usageOverride);
    if (!prepared || prepared.error) {
      failures.push(prepared?.error || "Ukendt fejl.");
      continue;
    }
    const { rec, savedCount } = prepared;
    const { error } = await sb.from("tbl_saet").upsert(rec, { onConflict: "set_id" });
    if (error) {
      failures.push(error.message);
      continue;
    }

    const owner = rec.owner_bibliotek_id;
    const isbn = rec.isbn;
    if (!usageOverride[owner]) usageOverride[owner] = {};
    const currentTotal = usageOverride[owner][isbn] ?? saetUsageFor(owner, isbn);
    usageOverride[owner][isbn] = (currentTotal - savedCount) + rec.requested_count;

    tr.dataset.savedCount = rec.requested_count;
    clearSaetDirty(tr);
    successCount++;
  }

  if (successCount) {
    showMsg("#msgSaet", `Gemte ${successCount} sÃ¦t`, true);
    highlightSaveBar();
    await saetPull();
    await regenerateBookingSlotsForOwner(currentAdminId());
  }
  if (failures.length) {
    alert("Kunne ikke gemme fÃ¸lgende sÃ¦t:\n" + failures.join("\n"));
  }
}









