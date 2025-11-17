
// State/lib utilities (config, globals, profile, libraries)

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
  role: "admin",
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
    centralIds: [],
    sortBy: "title",
    sortDir: "asc"
  }
};

function initSupabase() {
  if (!window.supabase || !window.supabase.createClient) {
    console.error("Supabase JS bibliotek ikke fundet.");
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
