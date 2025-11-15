// Læsekredssæt – v4.1 (clean drop-in)
// Bevarer funktionalitet fra v4.0, men med ryddet struktur.

// ----------------------------------------------------------
// 1. Konfiguration & utilities
// ----------------------------------------------------------

const SUPABASE_URL = "https://qlkrzinyqirnigcwadki.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFsa3J6aW55cWlybmlnY3dhZGtpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3NjY2NjgsImV4cCI6MjA3ODM0MjY2OH0.-SV3dn7reKHeYis40I-aF3av0_XmCP-ZqB9KR6JT2so";

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
    status: "",
    q: ""
  },
  saet: {
    page: 0,
    pageSize: 15,
    total: 0,
    owner: "",
    vis: "",
    q: "",
    usage: {}
  },
  b: {
    page: 0,
    pageSize: 15,
    total: 0,
    q: "",
    start: null,
    weeks: 8,
    results: [],
    centralIds: [] // relationer for booker
  }
};

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

  // Sæt-ejer filter
  const ownerSel = document.querySelector("#saetOwnerFilterSel");
  if (ownerSel) {
    ownerSel.innerHTML = '<option value="">(alle)</option>';
    st.libs.centrals.forEach(lib => {
      ownerSel.appendChild(el("option", { value: lib.bibliotek_id }, fmtLibLabel(lib)));
    });
    if (st.profile.adminCentralId) {
      ownerSel.value = st.profile.adminCentralId;
    }
  }

  // Region: dropdown med lånerbiblioteker
  const relLocal = document.querySelector("#relLocal");
  if (relLocal) {
    relLocal.innerHTML = "";
    st.libs.locals.forEach(lib => {
      relLocal.appendChild(el("option", { value: lib.bibliotek_id }, fmtLibLabel(lib)));
    });
  }

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
    bookerSel.appendChild(el("option", { value: "" }, "(ingen lånerbiblioteker fundet)"));
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
    profileText.textContent = lib ? ` · ${fmtLibLabel(lib)}` : " · (ingen låner valgt)";
  }
}

function renderLayout() {
  const adminTabs = $("#adminTabs");
  const bookerView = $("#bookerView");
  const panels = $$(".panel");

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
  $$(".tabs button[data-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
      const tabId = btn.getAttribute("data-tab");
      $$(".panel").forEach(p => p.classList.remove("active"));
      const panel = $("#" + tabId);
      if (panel) panel.classList.add("active");
    });
  });
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
        alert("Vælg et lånerbibliotek.");
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

async function eksCount() {
  if (!sb || !st.profile.adminCentralId) return 0;
  let q = sb.from("tbl_beholdning").select("*", { count: "exact", head: true })
    .eq("owner_bibliotek_id", st.profile.adminCentralId);
  if (st.eks.status) q = q.eq("booking_status", st.eks.status);
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
    .select("barcode,title,author,isbn,faust,booking_status")
    .eq("owner_bibliotek_id", st.profile.adminCentralId)
    .order("barcode", { ascending: true })
    .range(from, to);

  if (st.eks.status) q = q.eq("booking_status", st.eks.status);
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
    const suffix = dirtyCount > 1 ? "ændringer" : "ændring";
    btn.textContent = `Gem ${dirtyCount} ${suffix}`;
  } else {
    btn.textContent = "Gem alle ændringer";
  }
}

async function loadInventorySummary() {
  if (!sb) return;

  const { data, error } = await sb
    .from("tbl_beholdning")
    .select("owner_bibliotek_id,isbn,title,author,faust")
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
    }
    aggregates[key].count++;
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
    booking_status: tr.querySelector(".status")?.value || "Ledig",
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
    const stSel = tr.querySelector(".status");
    if (stSel) stSel.value = original.booking_status || "Ledig";
    clearEksDirty(tr);
  } catch (e) {
    console.warn("Kunne ikke fortryde række", e);
  }
}

async function eksSaveAll() {
  if (!sb) return;
  if (!st.profile.adminCentralId) {
    showMsg("#msg", "Vælg først en admin-profil.");
    return;
  }
  const dirtyRows = eksDirtyRows();
  if (!dirtyRows.length) {
    showMsg("#msg", "Der er ingen ændringer at gemme.");
    return;
  }

  const payload = [];
  for (const tr of dirtyRows) {
    const rec = eksCollectRow(tr);
    const err = eksValidate(rec || {});
    if (err) {
      showMsg("#msg", `Fejl i række (${rec?.barcode || "ny"}): ${err}`);
      tr.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    payload.push(rec);
  }

  showMsg("#msg", "Gemmer ændringer...");
  const { error } = await sb.from("tbl_beholdning").upsert(payload, { onConflict: "barcode" });
  if (error) {
    showMsg("#msg", "Fejl ved gem: " + error.message);
    return;
  }

  showMsg("#msg", `Gemte ${payload.length} ændring${payload.length > 1 ? "er" : ""}.`, true);
  await eksPull();
  await loadInventorySummary();
}

function eksValidate(r) {
  if (!r.barcode) return "Stregkode skal udfyldes";
  if (!r.title) return "Titel skal udfyldes";
  if (!["Ledig", "Reserveret", "Booket"].includes(r.booking_status)) {
    return "Ugyldig booking-status";
  }
  return null;
}

async function eksPull() {
  const tb = $("#tblEks tbody");
  if (!tb) return;

  if (!st.profile.adminCentralId) {
    tb.innerHTML = "";
    $("#pinfo").textContent = "Vælg først en admin-profil (centralbibliotek) via Skift: Admin ↔ Booker.";
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

    const stSel = el("select", { class: "status" },
      el("option", { value: "Ledig" }, "Ledig"),
      el("option", { value: "Reserveret" }, "Reserveret"),
      el("option", { value: "Booket" }, "Booket")
    );
    stSel.value = r.booking_status || "Ledig";

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
      el("td", {}, stSel),
      actions
    );
    eksAttachRowListeners(tr);
    tb.appendChild(tr);
  });

  renderEksPagerInfo();
  updateEksSaveButton();
}

async function eksDeleteRow(tr) {
  if (!sb) return;
  const bc = tr.dataset.barcode || tr.querySelector(".bc-label")?.textContent || tr.querySelector(".bc")?.value || "";
  if (!bc) {
    tr.remove();
    updateEksSaveButton();
    return;
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

  const btnCancel = el("button", {
    class: "btn",
    onclick: () => {
      tr.remove();
      updateEksSaveButton();
    }
  }, "Annullér");
  const info = el("span", { class: "hint" }, "Gem via knappen ovenfor");

  tr.append(
    el("td", {}, bcInput),
    el("td", {}, el("input", { class: "title" })),
    el("td", {}, el("input", { class: "author" })),
    el("td", {}, el("input", { class: "isbn" })),
    el("td", {}, el("input", { class: "faust" })),
    el("td", {}, stSel),
    el("td", {}, info, " ", btnCancel)
  );
  tb.prepend(tr);
  eksAttachRowListeners(tr);
}

function bindEksControls() {
  $("#btnSearch")?.addEventListener("click", () => {
    st.eks.status = $("#statusFilter")?.value || "";
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
  updateEksSaveButton();
}

// ----------------------------------------------------------
// 7. Admin – Sæt (tbl_saet)
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

function saetValidate(r) {
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
  return null;
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
    hint.title = "Vælg først ejer og ISBN.";
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
      ? `Andre sæt bruger ${otherUsed} af ${available} eksemplarer. Der er ingen ledige tilbage.`
      : "Ingen eksemplarer i beholdningen med dette ISBN.";
    hint.dataset.state = "error";
    reqInput.max = maxForRow || 0;
    return;
  }

  if (desired > maxForRow) {
    hint.title = `Du har valgt ${desired}, men der er kun ${maxForRow} ledige (${available} total, ${otherUsed} bruges af andre sæt).`;
    hint.dataset.state = "warning";
  } else {
    hint.title = `Andre sæt bruger ${otherUsed} af ${available} eksemplarer. Max til dette sæt: ${maxForRow}.`;
    hint.dataset.state = "ok";
  }
  reqInput.max = maxForRow || "";
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


async function saetCount() {
  if (!sb) return 0;
  let q = sb.from("tbl_saet").select("*", { count: "exact", head: true });
  const f = st.saet;
  if (f.owner) q = q.eq("owner_bibliotek_id", f.owner);
  else if (currentAdminId()) q = q.eq("owner_bibliotek_id", currentAdminId());
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

async function saetFetch() {
  if (!sb) return [];
  const from = st.saet.page * st.saet.pageSize;
  const to = from + st.saet.pageSize - 1;
  let q = sb.from("tbl_saet")
    .select("set_id,title,author,isbn,faust,requested_count,loan_weeks,buffer_days,visibility,owner_bibliotek_id,active,allow_substitution,allow_partial,min_delivery,notes")
    .order("set_id", { ascending: true })
    .range(from, to);

  const f = st.saet;
  if (f.owner) q = q.eq("owner_bibliotek_id", f.owner);
  else if (currentAdminId()) q = q.eq("owner_bibliotek_id", currentAdminId());
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
  const ownerSel = $("#saetOwnerFilterSel");
  if (ownerSel) {
    if (!ownerSel.value && adminId) {
      ownerSel.value = adminId;
    }
    ownerSel.disabled = !adminId;
  }

  const activeOwner = ownerSel?.value || adminId || "";
  st.saet.owner = activeOwner;

  if (!activeOwner) {
    tb.innerHTML = "";
    $("#saetPinfo").textContent = "";
    showMsg("#msgSaet", "Vælg først en admin-profil (centralbibliotek) via Skift: Admin ↔ Booker.");
    return;
  }
  showMsg("#msgSaet", "");

  st.saet.vis = $("#saetVisFilter")?.value || "";
  st.saet.q = $("#saetQ")?.value || "";

  const [usage, total, rows] = await Promise.all([
    fetchSaetUsage(),
    saetCount(),
    saetFetch()
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
    const tiIn = el("input", { class: "saet-title", value: r.title || "" });
    const auIn = el("input", { class: "saet-author", value: r.author || "" });
    const isbnSel = el("select", { class: "saet-isbn" });
    const isbnField = el("input", { type: "text", class: "saet-isbn-field", value: r.isbn || "", readonly: true });
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
    const faIn = el("input", { class: "saet-faust", value: r.faust || "", style: "width:6ch" });
    const reqIn = el("input", {
      type: "number",
      class: "saet-requested",
      value: r.requested_count ?? 1,
      min: "1",
      style: "width:6ch"
    });
    const reqHint = el("span", { class: "saet-availability", title: "" }, "●");
    const weeksIn = el("input", {
      type: "number",
      class: "saet-weeks",
      value: r.loan_weeks ?? 8,
      min: "1",
      max: "12"
    });
    const bufferIn = el("input", { type: "number", class: "saet-buffer", value: r.buffer_days ?? 0, min: "0", style: "width:6ch" });

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

    const btnSave = el("button", { class: "btn", onclick: () => saetSaveRow(tr) }, "Gem");
    const btnDel = el("button", { class: "btn", onclick: () => saetDeleteRow(tr) }, "Slet");
    const actions = el("td", {}, btnSave, " ", btnDel);

    tr.append(
      idCell,
      el("td", {}, tiIn),
      el("td", {}, auIn),
      el("td", {}, isbnWrap),
      el("td", {}, faIn),
    el("td", {}, reqIn, " ", reqHint),
      el("td", {}, weeksIn),
      el("td", {}, bufferIn),
      el("td", {}, visSel),
      el("td", {}, ownerLabel, ownerHidden),
      el("td", {}, activeSel),
      el("td", {}, subSel),
      el("td", {}, partSel),
      el("td", {}, minIn),
      actions
    );

    isbnSel.addEventListener("change", () => {
      applyInventoryMeta(tr, ownerVal, isbnSel.value, true);
      updateSaetAvailability(tr);
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

    tb.appendChild(tr);
  });

  const totalPages = Math.ceil((st.saet.total || 0) / st.saet.pageSize);
  $("#saetPinfo").textContent = st.saet.total
    ? `Side ${st.saet.page + 1}/${totalPages} – ${st.saet.total} sæt`
    : "Ingen sæt fundet";
}

async function ensureSaetCapacity(ownerId, isbn, requestedCount, currentSetId) {
  const available = getInventoryCount(ownerId, isbn);
  if (!available) {
    return {
      ok: false,
      message: "Der er ingen eksemplarer i beholdningen med det valgte ISBN."
    };
  }

  const { data, error } = await sb
    .from("tbl_saet")
    .select("set_id,requested_count")
    .eq("owner_bibliotek_id", ownerId)
    .eq("isbn", isbn);

  if (error) {
    return {
      ok: false,
      message: "Kunne ikke kontrollere øvrige sæt: " + error.message
    };
  }

  let otherTotal = 0;
  (data || []).forEach(row => {
    const rowId = row.set_id == null ? null : Number(row.set_id);
    if (currentSetId != null && rowId === currentSetId) return;
    otherTotal += Number(row.requested_count) || 0;
  });

  if (requestedCount + otherTotal > available) {
    const max = Math.max(0, available - otherTotal);
    return {
      ok: false,
      message: `Der er ${available} eksemplarer i beholdningen og andre sæt bruger ${otherTotal}. Du kan maksimalt bruge ${max} eksemplarer i dette sæt.`
    };
  }

  return { ok: true };
}

async function saetSaveRow(tr) {
  if (!sb) return;
  const setId = tr.dataset.setId ? Number(tr.dataset.setId) : null;

  const title = tr.querySelector(".saet-title")?.value.trim() || "";
  const author = tr.querySelector(".saet-author")?.value.trim() || "";
  const isbn = tr.querySelector(".saet-isbn")?.value || "";
  const faust = tr.querySelector(".saet-faust")?.value.trim() || "";
  const requested_count = Math.floor(Number(tr.querySelector(".saet-requested")?.value || 0));
  const loan_weeks = Number(tr.querySelector(".saet-weeks")?.value || 0);
  const buffer_days = Number(tr.querySelector(".saet-buffer")?.value || 0);
  const visibility = (tr.querySelector(".saet-vis")?.value || "national").toLowerCase();
  const owner_bibliotek_id = tr.querySelector(".saet-owner")?.value || currentAdminId() || "";
  const active = (tr.querySelector(".saet-active")?.value || "true") === "true";
  const allow_substitution = (tr.querySelector(".saet-sub")?.value || "false") === "true";
  const allow_partial = (tr.querySelector(".saet-part")?.value || "false") === "true";
  const min_delivery = Number(tr.querySelector(".saet-min")?.value || 0);

  const rec = {
    set_id: setId,
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
    showMsg("#msgSaet", err);
    return;
  }

  const capacity = await ensureSaetCapacity(owner_bibliotek_id, isbn, requested_count, setId);
  if (!capacity.ok) {
    showMsg("#msgSaet", capacity.message);
    return;
  }

  const { error } = await sb.from("tbl_saet").upsert(rec, { onConflict: "set_id" });
  if (error) {
    showMsg("#msgSaet", "Fejl ved gem: " + error.message);
  } else {
    showMsg("#msgSaet", "Sæt gemt", true);
    await saetPull();
  }
}

async function saetDeleteRow(tr) {
  if (!sb) return;
  const setId = tr.dataset.setId;
  if (!setId) {
    tr.remove();
    return;
  }
  if (!confirm("Slet sæt " + setId + "?")) return;
  const { error } = await sb.from("tbl_saet").delete().eq("set_id", Number(setId));
  if (error) {
    showMsg("#msgSaet", "Fejl ved sletning: " + error.message);
  } else {
    showMsg("#msgSaet", "Sæt slettet", true);
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
    showMsg("#msgSaet", "Vælg først en admin-profil (centralbibliotek) via Skift: Admin ↔ Booker.");
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

  const btnSave = el("button", { class: "btn", onclick: () => saetSaveRow(tr) }, "Gem");
  const btnCancel = el("button", { class: "btn", onclick: () => tr.remove() }, "Annullér");
  if (isbnSel.disabled) {
    btnSave.disabled = true;
    btnSave.title = "Ingen titler i beholdningen for det valgte centralbibliotek.";
  }

  const reqIn = el("input", { type: "number", class: "saet-requested", value: "1", min: "1", style: "width:6ch" });
  const reqHint = el("span", { class: "saet-availability", title: "" }, "●");
  const weeksIn = el("input", { type: "number", class: "saet-weeks", value: "8", min: "1", max: "12" });
  const bufferIn = el("input", { type: "number", class: "saet-buffer", value: "0", min: "0", style: "width:6ch" });
  const minIn = el("input", { type: "number", class: "saet-min", value: "0", min: "0" });

  tr.append(
    el("td", {}, ""), // ID (autoincrement)
    el("td", {}, el("input", { class: "saet-title" })),
    el("td", {}, el("input", { class: "saet-author" })),
    el("td", {}, isbnWrap),
    el("td", {}, el("input", { class: "saet-faust", style: "width:6ch" })),
    el("td", {}, reqIn, " ", reqHint),
    el("td", {}, weeksIn),
    el("td", {}, bufferIn),
    el("td", {}, visSel),
    el("td", {}, ownerLabel, ownerHidden),
    el("td", {}, activeSel),
    el("td", {}, subSel),
    el("td", {}, partSel),
    el("td", {}, minIn),
    el("td", {}, btnSave, " ", btnCancel)
  );
  tb.prepend(tr);

  isbnSel.addEventListener("change", () => {
    applyInventoryMeta(tr, ownerId, isbnSel.value, true);
    updateSaetAvailability(tr);
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
}

function bindSaetControls() {
  $("#btnSaetSearch")?.addEventListener("click", () => {
    st.saet.page = 0;
    saetPull();
  });
  $("#btnSaetMine")?.addEventListener("click", () => {
    const adminId = currentAdminId();
    if (!adminId) {
      showMsg("#msgSaet", "Vælg først en admin-profil (centralbibliotek).");
      return;
    }
    const ownerSel = $("#saetOwnerFilterSel");
    if (ownerSel) {
      ownerSel.value = adminId;
    }
    const qInput = $("#saetQ");
    if (qInput) qInput.value = "";
    const visSel = $("#saetVisFilter");
    if (visSel) visSel.value = "";
    st.saet.page = 0;
    saetPull();
  });
  $("#btnSaetNew")?.addEventListener("click", () => {
    saetNewRow();
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
}

// ----------------------------------------------------------
// 8. Admin – Region / relationer (tbl_bibliotek_relation)
// ----------------------------------------------------------

async function relList() {
  if (!sb || !st.profile.adminCentralId) return;
  const centralId = st.profile.adminCentralId;
  $("#relCentralReadonly").value = fmtLibLabel(st.libs.byId[centralId]) || "";

  const { data, error } = await sb
    .from("tbl_bibliotek_relation")
    .select("relation_id,bibliotek_id,central_id,active")
    .eq("central_id", centralId)
    .order("relation_id");

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

  showMsg("#msgRel", data && data.length ? `Antal relationer: ${data.length}` : "Ingen relationer endnu.", true);
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
  if (!sb || !st.profile.adminCentralId) return;
  const centralId = st.profile.adminCentralId;
  const local = $("#relLocal")?.value;
  if (!local) {
    showMsg("#msgRel", "Vælg lånerbibliotek.");
    return;
  }
  if (local === centralId) {
    showMsg("#msgRel", "Et bibliotek kan ikke være sin egen låner.");
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
  if (!sb || !st.profile.adminCentralId) return;
  const centralId = st.profile.adminCentralId;
  const id = $("#newLocalId")?.value.trim();
  const name = $("#newLocalName")?.value.trim();
  const activeStr = $("#newLocalActive")?.value || "true";
  const active = activeStr === "true";

  if (!id || id.length > 20) {
    showMsg("#msgRel", "ID skal udfyldes (1–20 tegn).");
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
    active: active
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
    showMsg("#msgRel", "Lånerbibliotek oprettet og relateret", true);
  }

  await loadLibraries();
  await relList();
}

function bindRelControls() {
  $("#btnRelAdd")?.addEventListener("click", relAddExisting);
  $("#btnCreateLocal")?.addEventListener("click", relCreateLocal);
  // Auto-gem ændringer i active-dropdowns når man forlader fanen kunne laves her – vi holder det manuelt
}

// ----------------------------------------------------------
// 9. Booker – søgning (tbl_saet + relationer)
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
    .select("set_id,title,author,isbn,faust,visibility,owner_bibliotek_id,active")
    .eq("visibility", "national")
    .eq("active", true);

  // regional
  let qReg = sb.from("tbl_saet")
    .select("set_id,title,author,isbn,faust,visibility,owner_bibliotek_id,active")
    .eq("visibility", "regional")
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
    showMsg("#bMsg", "Fejl ved national søgning: " + natRes.error.message);
    return [];
  }
  if (regRes.error) {
    showMsg("#bMsg", "Fejl ved regional søgning: " + regRes.error.message);
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
  const slice = st.b.results.slice(from, to);

  tb.innerHTML = "";
  slice.forEach(r => {
    const owner = st.libs.byId[r.owner_bibliotek_id];
    const ownerLabel = owner ? fmtLibLabel(owner) : r.owner_bibliotek_id || "";
    const tr = el("tr", {},
      el("td", {}, r.title || ""),
      el("td", {}, r.author || ""),
      el("td", {}, r.isbn || ""),
      el("td", {}, r.faust || ""),
      el("td", {}, r.visibility || ""),
      el("td", {}, ownerLabel),
      el("td", {}, el("span", { class: "hint" }, "Booking POC – ingen rigtig booking endnu"))
    );
    tb.appendChild(tr);
  });

  const totalPages = Math.ceil((st.b.total || 0) / st.b.pageSize);
  $("#bInfo").textContent = st.b.total
    ? `Side ${st.b.page + 1}/${totalPages} – ${st.b.total} sæt`
    : "Ingen sæt fundet";
}

async function bookerSearch() {
  if (!st.profile.bookerLocalId) {
    showMsg("#bMsg", "Vælg først en booker-profil (lånerbibliotek).");
    return;
  }
  st.b.q = $("#bQ")?.value || "";
  st.b.weeks = Number($("#bWeeks")?.value || 8);
  st.b.start = $("#bStart")?.value || null;
  st.b.page = 0;

  await resolveBookerCentrals();
  const results = await bookerSearchInternal();
  st.b.results = results;
  st.b.total = results.length;
  renderBookerResults();
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
}

// ----------------------------------------------------------
// 10. Fælles refresh pr. rolle & boot
// ----------------------------------------------------------

async function refreshForRole() {
  renderRoleBadge();
  renderLayout();

  if (st.role === "admin") {
    await loadInventorySummary();
    await eksPull();
    await saetPull();
    await relList();
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
  bindRelControls();
  bindBookerControls();

  await loadLibraries();
  await refreshForRole();
}

document.addEventListener("DOMContentLoaded", () => {
  boot().catch(e => console.error("Boot fejl:", e));
});
