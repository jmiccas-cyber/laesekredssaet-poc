
// State/lib utilities (config, globals, profile, libraries)

(() => {

const SUPABASE_CONFIG = window.SUPABASE_CONFIG || {};
const SUPABASE_URL = SUPABASE_CONFIG.url || "";
const SUPABASE_KEY = SUPABASE_CONFIG.anonKey || "";
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

let sb = null;

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

const PROFILE_KEY = "laesekredss_profile_v41";

const st = {
  role: "booker",
  authRole: null,
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
  relSort: {
    sortBy: "relation_id",
    sortDir: "asc"
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
    localSets: {},
    globalSort: {
      sortBy: "holiday_date",
      sortDir: "asc"
    },
    localSort: {
      sortBy: "holiday_date",
      sortDir: "asc"
    }
  },
  booking: {
    requests: [],
    myRequests: []
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
    centralIds: [],
    sortBy: "title",
    sortDir: "asc",
    view: "search",
    myRequests: []
  }
};

function initSupabase() {
  if (!window.supabase || !window.supabase.createClient) {
    console.error("Supabase JS bibliotek ikke fundet.");
    return;
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Supabase konfiguration mangler (url/anonKey). Indlæs supabase.config.js.");
    return;
  }
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
}

function getSupabaseClient() {
  return sb;
}

function loadProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed.role) st.role = parsed.role;
    if (parsed.profile) st.profile = { ...st.profile, ...parsed.profile };
  } catch (err) {
    console.warn("Kunne ikke loade profil:", err);
  }
}

function saveProfile() {
  localStorage.setItem(PROFILE_KEY, JSON.stringify({
    role: st.role,
    profile: st.profile
  }));
}

async function loadLibraries() {
  if (!sb) return [];
  const { data, error } = await sb
    .from("tbl_bibliotek")
    .select("*")
    .order("is_central", { ascending: false })
    .order("bibliotek_navn", { ascending: true });
  if (error) {
    console.error("Fejl ved loadLibraries:", error);
    st.libs.list = [];
    st.libs.byId = {};
    st.libs.centrals = [];
    st.libs.locals = [];
    return [];
  }

  const rows = (data || []).filter(x => x.active !== false);
  st.libs.list = rows;
  st.libs.byId = Object.fromEntries(rows.map(x => [x.bibliotek_id, x]));
  st.libs.centrals = rows.filter(x => x.is_central);
  st.libs.locals = rows.filter(x => !x.is_central);
  return rows;
}

window.StateLibStore = Object.freeze({
  st,
  initSupabase,
  getSupabaseClient,
  loadProfile,
  saveProfile,
  loadLibraries,
  SUPABASE_CONFIG,
  SUPABASE_URL,
  HOLIDAY_TABLE,
  LOCAL_HOLIDAY_TABLE,
  BOOKING_RULE_TABLE,
  BOOKING_STATUS_AVAILABLE,
  BOOKING_STATUS_REQUESTED,
  BOOKING_STATUS_BOOKED,
  BOOKING_STATUS_CANCELLED,
  BOOKING_RULE_FIRST_DAY,
  BOOKING_RULE_EVERY14,
  BOOKING_SLOT_HORIZON_MONTHS,
  BOOKING_RULE_OPTIONS,
  BOOKING_RULE_DEFAULT,
  $,
  $$,
  el,
  show,
  hide,
  safeJsonParse,
  setActiveButtonState
});

})();
