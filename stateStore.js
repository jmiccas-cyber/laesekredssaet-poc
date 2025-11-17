
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
  console.log("✅ Supabase klient initialiseret");
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

  // Sæt-ejer filter
  populateRegionSelects();
  renderAccessTable();

  // Hvis der ikke er valgt admin-central, sæt default = Gentofte eller første central
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
    detailSel.innerHTML = '<option value="">(vælg regionsbibliotek)</option>';
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
    profileText.textContent = lib ? ` · ${fmtLibLabel(lib)}` : " · (ingen central valgt)";
    if (relCentralReadonly) {
      relCentralReadonly.value = lib ? fmtLibLabel(lib) : "";
    }
  } else {
    const id = st.profile.bookerLocalId;
    const lib = id ? st.libs.byId[id] : null;
    profileText.textContent = lib ? ` · ${fmtLibLabel(lib)}` : " · (ingen regionsbibliotek valgt)";
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

    // Aktiver første admin-tab, hvis ingen valgt
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

  // 1) Hent biblioteker frisk hver gang modal åbnes
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

  // 5) Vis/hide blokke afhængigt af valgt rolle
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
        alert("Vælg et centralbibliotek.");
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
        alert("Vælg et regionsbibliotek.");
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
// 6. Admin – Eksemplarer (tbl_beholdning)
// ----------------------------------------------------------
// 6. Admin Ã¢â‚¬â€œ Eksemplarer (tbl_beholdning)
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
    const suffix = dirtyCount > 1 ? "ÃƒÂ¦ndringer" : "ÃƒÂ¦ndring";
    btn.textContent = `Gem ${dirtyCount} ${suffix}`;
  } else {
    btn.textContent = "Gem alle ÃƒÂ¦ndringer";
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
      console.error("Kunne ikke opdatere sÃ¦t for ISBN", isbn, updError);
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
    showMsg("#msgSaet", "Kunne ikke hente eksisterende sÃ¦t: " + error.message);
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
    console.warn("Kunne ikke fortryde rÃƒÂ¦kke", e);
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
    showMsg("#msg", "VÃƒÂ¦lg fÃƒÂ¸rst en admin-profil.");
    return;
  }
  const dirtyRows = eksDirtyRows();
  if (!dirtyRows.length) {
    showMsg("#msg", "Der er ingen ÃƒÂ¦ndringer at gemme.");
    return;
  }

  const payload = [];
  for (const tr of dirtyRows) {
    const rec = eksCollectRow(tr);
    const err = eksValidate(rec || {});
    if (err) {
      showMsg("#msg", `Fejl i rÃƒÂ¦kke (${rec?.barcode || "ny"}): ${err}`);
      tr.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    payload.push(rec);
  }

  showMsg("#msg", "Gemmer ÃƒÂ¦ndringer...");
  const { error } = await sb.from("tbl_beholdning").upsert(payload, { onConflict: "barcode" });
  if (error) {
    showMsg("#msg", "Fejl ved gem: " + error.message);
    return;
  }

  showMsg("#msg", `Gemte ${payload.length} ÃƒÂ¦ndring${payload.length > 1 ? "er" : ""}.`, true);
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
    showMsg("#msg", "VÃ¦lg fÃ¸rst en admin-profil (centralbibliotek) via Skift: Admin â†” Booker.");
    return;
  }

  showMsg("#msg", "Henter eksemplarer til Excel â€¦");
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
    showMsg("#msg", "VÃ¦lg fÃ¸rst en admin-profil (centralbibliotek) via Skift: Admin â†” Booker.");
    return;
  }

  showMsg("#msg", "IndlÃ¦ser Excel â€¦");
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
    showMsg("#msg", "Kunne ikke lÃ¦se Excel-filen: " + e.message);
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
      failures.push(`RÃ¦kke ${line}: mangler stregkode.`);
      return;
    }
    if (seen.has(barcode)) {
      failures.push(`RÃ¦kke ${line}: stregkode ${barcode} er duplikeret i Excel.`);
      return;
    }
    seen.add(barcode);

    let action = String(getValue(row, "Handling", "handling", "Action")).trim().toLowerCase();
    if (!action) action = "opdater";

    if (action === "slet") {
      const isbn = existing.get(barcode);
      if (!isbn) {
        failures.push(`RÃ¦kke ${line}: stregkode ${barcode} findes ikke i databasen.`);
        return;
      }
      deletions.push({ barcode, isbn });
      return;
    }

    if (action !== "opdater") {
      failures.push(`RÃ¦kke ${line}: ukendt handling "${action}". Brug Opdater eller Slet.`);
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
      failures.push(`RÃ¦kke ${line}: ${validation}`);
      return;
    }
    updates.push(record);
  });

  if (!updates.length && !deletions.length) {
    showMsg("#msg", failures[0] || "Ingen gyldige rÃ¦kker fundet.");
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
        `${isbn} (krÃ¦vet: ${Number(usageMap?.[ownerId]?.[isbn]) || 0}, tilbage efter sletning: ${Math.max(0, getInventoryCount(ownerId, isbn) - count)})`
      );
      showMsg("#msg", "Eksemplarer kan ikke slettes fÃ¸r tilhÃ¸rende sÃ¦t er nedtaget: " + sample.join(", "));
      return;
    }
    const confirmMsg = `Der er ${deletions.length} stregkoder markeret til sletning. Handlingen kan ikke fortrydes. FortsÃ¦t?`;
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
  showMsg("#msg", parts.length ? `Import gennemfÃ¸rt: ${parts.join(", ")}.` : "Import gennemfÃ¸rt.", true);
  if (failures.length) {
    alert("FÃ¸lgende rÃ¦kker blev sprunget over:\n" + failures.join("\n"));
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
    $("#pinfo").textContent = "VÃƒÂ¦lg fÃƒÂ¸rst en admin-profil (centralbibliotek) via Skift: Admin Ã¢â€ â€ Booker.";
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
      showMsg("#msg", `Eksemplarer for ISBN ${isbn} kan ikke slettes fÃ¸r tilhÃ¸rende sÃ¦t reduceres (krÃ¦vet: ${reserved}, tilbage efter sletning: ${(available ?? 0) - 1}).`);
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
  }, "AnnullÃƒÂ©r");
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


// ----------------------------------------------------------
// 7. Admin – Sæt (tbl_saet)
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
