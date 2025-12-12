// ----------------------------------------------------------
// 1. Konfiguration & utilities
// ----------------------------------------------------------

const StateLibStore = window.StateLibStore || {};
const {
  st,
  initSupabase: baseInitSupabase = () => {},
  getSupabaseClient: baseGetSupabaseClient = () => null,
  loadProfile: baseLoadProfile = () => {},
  saveProfile: baseSaveProfile = () => {},
  loadLibraries: baseLoadLibraries = async () => {},
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
} = StateLibStore;

var sb = baseGetSupabaseClient();

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

function resolveStore(name) {
  return window.StoreRegistry?.getStore?.(name) || window[name];
}

function callStore(name, method, ...args) {
  const store = resolveStore(name);
  const fn = store?.[method] || window[method];
  if (typeof fn === "function") {
    return fn(...args);
  }
  console.warn(`${name}.${method} er ikke tilgængelig.`);
  return undefined;
}

// ----------------------------------------------------------
// 2. Global state
// ----------------------------------------------------------

// ----------------------------------------------------------
// 3. Supabase & profil
// ----------------------------------------------------------
// (håndteres via stateLibStore)

function initSupabase() {
  if (typeof baseInitSupabase === "function") {
    baseInitSupabase();
    sb = baseGetSupabaseClient();
  }
}

function loadProfile() {
  if (typeof baseLoadProfile === "function") {
    baseLoadProfile();
  }
}

function saveProfile() {
  if (typeof baseSaveProfile === "function") {
    baseSaveProfile();
  }
}

async function syncRoleFromAuth() {
  if (!sb?.auth) {
    st.authRole = null;
    if (st.role === "admin" || !st.role) {
      st.role = "booker";
    }
    return;
  }
  try {
    const { data, error } = await sb.auth.getSession();
    if (error) {
      console.warn("Kunne ikke hente auth-session:", error);
      return;
    }
    const session = data?.session;
    const rawRole = session?.user?.app_metadata?.role
      || session?.user?.user_metadata?.role
      || (Array.isArray(session?.user?.user_metadata?.roles) ? session.user.user_metadata.roles[0] : null);
    const normalized = rawRole ? String(rawRole).toLowerCase() : null;
    if (normalized === "admin" || normalized === "booker") {
      st.authRole = normalized;
      st.role = normalized;
    } else if (!st.role || st.role === "admin") {
      st.authRole = null;
      st.role = "booker";
    } else {
      st.authRole = null;
    }
  } catch (err) {
    console.warn("Auth sync fejlede:", err);
  }
}

// ----------------------------------------------------------
// 4. Biblioteker (tbl_bibliotek)
// ----------------------------------------------------------

async function loadLibraries() {
  if (typeof baseLoadLibraries === "function") {
    await baseLoadLibraries();
  }

  st.libs.byId = Object.fromEntries(st.libs.list.map(x => [x.bibliotek_id, x]));
  st.libs.centrals = st.libs.list.filter(x => x.is_central);
  st.libs.locals = st.libs.list.filter(x => !x.is_central);
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

  populateRegionSelects();
  renderAccessTable();

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
    callStore("BookingStore", "setBookerTab", st.b?.view || "search");
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
    callStore("CalendarStore", "calendarPullGlobal");
    callStore("CalendarStore", "calendarPullLocal");
  } else if (tabId === "tab-booking") {
    callStore("BookingStore", "bookingRulePull");
  } else if (tabId === "tab-requests") {
    callStore("BookingStore", "bookingRequestsPull");
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

  // Allow selecting admin without auth gating (security hardening to be added later)
  const desiredRole = targetRole || st.role;
  roleSelect.value = desiredRole || "booker";

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
// 8. Admin – Region / relationer (tbl_bibliotek_relation)
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

  if (!$("#tblRel tbody")) return;

  const sortState = st.relSort || (st.relSort = { sortBy: "relation_id", sortDir: "asc" });
  const rows = data || [];
  TableSortHelper.renderTable({
    tableSelector: "#tblRel",
    rows,
    columns: [
      {
        id: "relation_id",
        accessor: row => Number(row.relation_id) || 0,
        render: row => String(row.relation_id)
      },
      {
        id: "local",
        accessor: row => {
          const local = st.libs.byId[row.bibliotek_id];
          return local ? fmtLibLabel(local).toLowerCase() : (row.bibliotek_id || "");
        },
        render: row => {
          const local = st.libs.byId[row.bibliotek_id];
          return local ? fmtLibLabel(local) : row.bibliotek_id;
        }
      },
      {
        id: "central",
        accessor: row => {
          const central = st.libs.byId[row.central_id];
          return central ? fmtLibLabel(central).toLowerCase() : (row.central_id || "");
        },
        render: row => {
          const central = st.libs.byId[row.central_id];
          return central ? fmtLibLabel(central) : row.central_id;
        }
      },
      {
        id: "relation_active",
        accessor: row => (row.active ? "true" : "false"),
        render: row => {
          const activeSel = el("select", { "data-rel-id": row.relation_id, class: "rel-active" },
            el("option", { value: "true" }, "Ja"),
            el("option", { value: "false" }, "Nej")
          );
          activeSel.value = row.active ? "true" : "false";
          return activeSel;
        }
      },
      {
        id: "borrower_active",
        accessor: row => {
          const local = st.libs.byId[row.bibliotek_id];
          const isActive = local && local.active !== false;
          return isActive ? "true" : "false";
        },
        render: row => {
          const local = st.libs.byId[row.bibliotek_id];
          const isActive = local && local.active !== false;
          return isActive ? "Ja" : "Nej";
        }
      }
    ],
    stateRoot: sortState,
    defaultSort: { sortBy: "relation_id", sortDir: "asc" },
    emptyText: "Ingen relationer.",
    rowActions: row => el("button", {
      class: "btn",
      onclick: () => relDelete(row.relation_id)
    }, "Slet")
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
  const relSortState = st.relSort || (st.relSort = { sortBy: "relation_id", sortDir: "asc" });
  TableSortHelper.attachSortHandlers("#tblRel", relSortState, () => {
    relList();
  });
  renderRegionDetails();
  // Auto-gem Ã¦ndringer i active-dropdowns nÃ¥r man forlader fanen kunne laves her â€“ vi holder det manuelt
}

// ----------------------------------------------------------

// ----------------------------------------------------------
// 9. Admin – Adgang (super admin)
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

// ----------------------------------------------------------
// 11. Fælles refresh pr. rolle & boot
// ----------------------------------------------------------

async function refreshForRole() {
  await syncRoleFromAuth();
  renderRoleBadge();
  renderLayout();

  if (st.role === "admin") {
    await callStore("InventoryStore", "loadInventorySummary");
    await callStore("InventoryStore", "eksPull");
    await callStore("SaetStore", "saetPull");
    await relList();
    await callStore("CalendarStore", "calendarPullGlobal");
    await callStore("CalendarStore", "calendarPullLocal");
    await callStore("BookingStore", "bookingRulePull");
    await callStore("BookingStore", "bookingRequestsPull");
  } else {
    await callStore("BookingStore", "bookerSearch");
  }
}

async function boot() {
  initSupabase();
  loadProfile();
  bindTabs();
  bindRoleControls();
  callStore("InventoryStore", "bindEksControls");
  callStore("SaetStore", "bindSaetControls");
  bindAccessControls();
  callStore("BookingStore", "bindBookingRuleControls");
  callStore("BookingStore", "bindBookingRequestControls");
  callStore("CalendarStore", "bindCalendarControls");
  bindRelControls();
  callStore("BookingStore", "bindBookerControls");

  await loadLibraries();
  await refreshForRole();
}

// ----------------------------------------------------------

window.LaesekredssApp = Object.freeze({
  refreshForRole,
  boot
});

