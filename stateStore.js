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

function callInventoryStore(method, ...args) {
  const store = window.InventoryStore;
  const fn = store?.[method] || window[method];
  if (typeof fn === "function") {
    return fn(...args);
  }
  console.warn(`InventoryStore.${method} er ikke tilgængelig.`);
  return undefined;
}

function callSaetStore(method, ...args) {
  const store = window.SaetStore;
  const fn = store?.[method] || window[method];
  if (typeof fn === "function") {
    return fn(...args);
  }
  console.warn(`SaetStore.${method} er ikke tilgængelig.`);
  return undefined;
}

function callCalendarStore(method, ...args) {
  const store = window.CalendarStore;
  const fn = store?.[method] || window[method];
  if (typeof fn === "function") {
    return fn(...args);
  }
  console.warn(`CalendarStore.${method} er ikke tilgængelig.`);
  return undefined;
}

// ----------------------------------------------------------
// 2. Global state
// ----------------------------------------------------------

const bookingSlotLocks = new Set();

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
    callCalendarStore("calendarPullGlobal");
    callCalendarStore("calendarPullLocal");
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

function bindBookingRuleControls() {
  $("#bookingRuleOwnerSel")?.addEventListener("change", () => {
    st.bookingRules.owner = $("#bookingRuleOwnerSel").value || currentAdminId();
    bookingRulePull();
  });
  $("#btnBookingRuleSave")?.addEventListener("click", () => bookingRuleSave());
}

function bindBookingRequestControls() {
  $("#tblBookingRequests")?.addEventListener("click", evt => {
    const target = evt.target.nodeType === 1 ? evt.target : evt.target.parentElement;
    const approve = target?.closest("button[data-booking-approve]");
    if (approve) {
      const bookingId = Number(approve.getAttribute("data-booking-approve"));
      const setId = Number(approve.getAttribute("data-booking-set"));
      bookingRequestsUpdate(bookingId, "approve", setId);
      return;
    }
    const cancel = target?.closest("button[data-booking-cancel]");
    if (cancel) {
      const bookingId = Number(cancel.getAttribute("data-booking-cancel"));
      const setId = Number(cancel.getAttribute("data-booking-set"));
      bookingRequestsUpdate(bookingId, "cancel", setId);
    }
  });
}

// ----------------------------------------------------------
// 10. Booking-regler, slots og anmodninger
// ----------------------------------------------------------

function toIsoDate(date) {
  if (!(date instanceof Date)) return "";
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
    .eq("set_id", setRow.set_id)
    .order("start_date", { ascending: true });
  if (error) {
    console.error("Kunne ikke hente bookinger:", error);
    return;
  }
  const existing = data || [];
  const planned = generateSlotsForSet(setRow, rule, holidaySet, minStart, horizon);
  const existingKeys = new Set(existing.map(b => `${b.start_date}::${b.end_date}`));
  const missing = planned.filter(slot => !existingKeys.has(`${slot.start}::${slot.end}`));
  if (!missing.length) return;
  const payload = missing.map(slot => ({
    owner_bibliotek_id: setRow.owner_bibliotek_id,
    set_id: setRow.set_id,
    start_date: slot.start,
    end_date: slot.end,
    booking_status: BOOKING_STATUS_AVAILABLE
  }));
  const chunkSize = 100;
  for (let i = 0; i < payload.length; i += chunkSize) {
    const chunk = payload.slice(i, i + chunkSize);
    const { error: insertError } = await sb.from("tbl_booking").insert(chunk);
    if (insertError) {
      console.error("Kunne ikke oprette slots:", insertError);
      return;
    }
  }
}

async function regenerateBookingSlotsForOwner(ownerId) {
  if (!sb || !ownerId) return;
  if (bookingSlotLocks.has(ownerId)) return;
  bookingSlotLocks.add(ownerId);
  try {
    await loadBookingRules();
    const rule = currentBookingRule(ownerId);
    const holidaySet = await loadOwnerHolidaySet(ownerId);
    const { data, error } = await sb
      .from("tbl_saet")
      .select("set_id,loan_weeks,buffer_days,owner_bibliotek_id,active")
      .eq("owner_bibliotek_id", ownerId)
      .eq("active", true);
    if (error) {
      console.error("Kunne ikke hente sæt til booking slots:", error);
      return;
    }
    await Promise.all((data || []).map(row => ensureBookingSlotsForSet(row, rule, holidaySet)));
  } finally {
    bookingSlotLocks.delete(ownerId);
  }
}

async function loadBookingRules(force = false) {
  if (!sb) return st.bookingRules.byOwner || {};
  if (!force && st.bookingRules.byOwner && Object.keys(st.bookingRules.byOwner).length) {
    return st.bookingRules.byOwner;
  }
  const { data, error } = await sb
    .from(BOOKING_RULE_TABLE)
    .select("owner_bibliotek_id,rule");
  if (error) {
    console.error("Kunne ikke hente bookingregler:", error);
    st.bookingRules.byOwner = st.bookingRules.byOwner || {};
    return st.bookingRules.byOwner;
  }
  const map = {};
  (data || []).forEach(row => {
    if (row.owner_bibliotek_id) {
      map[row.owner_bibliotek_id] = {
        owner_bibliotek_id: row.owner_bibliotek_id,
        rule: row.rule || BOOKING_RULE_DEFAULT
      };
    }
  });
  st.bookingRules.byOwner = map;
  return map;
}

function currentBookingRule(ownerId) {
  if (!ownerId) return BOOKING_RULE_DEFAULT;
  return st.bookingRules.byOwner?.[ownerId]?.rule || BOOKING_RULE_DEFAULT;
}

async function bookingRulePull() {
  if (!sb) return;
  const wrap = $("#bookingRuleOwnerWrap");
  const sel = $("#bookingRuleOwnerSel");
  const selectRule = $("#bookingRuleSelect");
  const msg = "#bookingRuleMsg";
  const adminLib = st.libs.byId[currentAdminId()];
  const isSuper = isSuperLibrary(adminLib);
  if (wrap) wrap.style.display = isSuper ? "" : "none";
  const superHint = $("#bookingRuleSuperHint");
  if (superHint) {
    superHint.style.display = isSuper ? "inline" : "none";
  }
  if (!st.bookingRules.owner || !isSuper) {
    st.bookingRules.owner = currentAdminId();
  }
  if (isSuper && sel) {
    sel.innerHTML = "";
    st.libs.centrals.forEach(lib => {
      sel.appendChild(el("option", { value: lib.bibliotek_id }, fmtLibLabel(lib)));
    });
    sel.value = st.bookingRules.owner || currentAdminId();
  }
  await loadBookingRules(true);
  const currentRule = currentBookingRule(st.bookingRules.owner || currentAdminId());
  if (selectRule) {
    selectRule.value = currentRule;
  }
  showMsg(msg, "");
}

async function bookingRuleSave() {
  if (!sb) return;
  const ownerId = st.bookingRules.owner || currentAdminId();
  if (!ownerId) {
    showMsg("#bookingRuleMsg", "Vælg et centralbibliotek først.");
    return;
  }
  const ruleSel = $("#bookingRuleSelect");
  const rule = ruleSel?.value || BOOKING_RULE_DEFAULT;
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
  st.bookingRules.byOwner[ownerId] = payload;
  showMsg("#bookingRuleMsg", "Regel gemt.", true);
  await regenerateBookingSlotsForOwner(ownerId);
}

async function fetchSaetMapByIds(ids) {
  const map = new Map();
  if (!sb || !ids?.length) return map;
  const { data, error } = await sb
    .from("tbl_saet")
    .select("set_id,title,owner_bibliotek_id,loan_weeks,buffer_days,requested_count")
    .in("set_id", ids);
  if (error) {
    console.error("Kunne ikke hente sæt:", error);
    return map;
  }
  (data || []).forEach(row => map.set(row.set_id, row));
  return map;
}

function renderBookingRequestsTable(rows) {
  const tb = $("#tblBookingRequests tbody");
  if (!tb) return;
  tb.innerHTML = "";
  if (!rows.length) {
    tb.appendChild(el("tr", {}, el("td", { colspan: 5 }, "Ingen anmodninger.")));
    return;
  }
  rows.forEach(row => {
    const setInfo = row.set || {};
    const requester = st.libs.byId[row.requester_bibliotek_id];
    const requesterLabel = requester ? fmtLibLabel(requester) : (row.requester_bibliotek_id || "Ukendt");
    const approveBtn = el("button", {
      class: "btn btn-small",
      "data-booking-approve": row.booking_id,
      "data-booking-set": row.set_id
    }, "Godkend");
    const cancelBtn = el("button", {
      class: "btn btn-small ghost",
      "data-booking-cancel": row.booking_id,
      "data-booking-set": row.set_id
    }, "Afvis");
    tb.appendChild(el("tr", {},
      el("td", {}, setInfo.title || `Sæt #${row.set_id}` || "—"),
      el("td", {}, requesterLabel),
      el("td", {}, formatDateDisplay(row.start_date)),
      el("td", {}, formatDateDisplay(row.end_date)),
      el("td", {}, approveBtn, " ", cancelBtn)
    ));
  });
}

async function bookingRequestsPull() {
  if (!sb) return;
  const ownerId = currentAdminId();
  const ownerLabel = $("#bookingRequestsOwner");
  if (ownerLabel) {
    ownerLabel.textContent = fmtLibLabel(st.libs.byId[ownerId]) || ownerId || "—";
  }
  if (!ownerId) {
    renderBookingRequestsTable([]);
    showMsg("#bookingRequestsMsg", "Vælg først et centralbibliotek.");
    return;
  }
  showMsg("#bookingRequestsMsg", "Henter anmodninger …");
  const { data, error } = await sb
    .from("tbl_booking")
    .select("booking_id,set_id,start_date,end_date,booking_status,requester_bibliotek_id")
    .eq("owner_bibliotek_id", ownerId)
    .eq("booking_status", BOOKING_STATUS_REQUESTED)
    .order("start_date", { ascending: true });
  if (error) {
    showMsg("#bookingRequestsMsg", "Kunne ikke hente anmodninger: " + error.message);
    renderBookingRequestsTable([]);
    return;
  }
  const rows = data || [];
  const setIds = Array.from(new Set(rows.map(r => r.set_id).filter(Boolean)));
  const setMap = await fetchSaetMapByIds(setIds);
  st.booking.requests = rows.map(row => ({
    ...row,
    set: setMap.get(row.set_id) || null
  }));
  renderBookingRequestsTable(st.booking.requests);
  showMsg("#bookingRequestsMsg", st.booking.requests.length ? "" : "Ingen anmodninger.", st.booking.requests.length === 0);
}

async function bookingRequestsUpdate(bookingId, action, setId) {
  if (!sb || !bookingId) return;
  const msgSel = "#bookingRequestsMsg";
  const ownerId = currentAdminId();
  const target = st.booking.requests?.find(r => r.booking_id === bookingId);
  if (!target) {
    showMsg(msgSel, "Kunne ikke finde anmodningen.");
    return;
  }
  const updates = action === "approve"
    ? { booking_status: BOOKING_STATUS_BOOKED }
    : { booking_status: BOOKING_STATUS_AVAILABLE, requester_bibliotek_id: null };
  showMsg(msgSel, action === "approve" ? "Godkender anmodning …" : "Afviser anmodning …");
  const { error } = await sb
    .from("tbl_booking")
    .update(updates)
    .eq("booking_id", bookingId)
    .eq("owner_bibliotek_id", ownerId);
  if (error) {
    showMsg(msgSel, "Kunne ikke opdatere anmodning: " + error.message);
    return;
  }
  showMsg(msgSel, action === "approve" ? "Anmodning godkendt." : "Anmodning afvist.", true);
  if (setId) {
    await regenerateBookingSlotsForOwner(ownerId);
  }
  await bookingRequestsPull();
}

// ----------------------------------------------------------

// ----------------------------------------------------------
// 11. Booker – søgning (tbl_saet + relationer)
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
      "data-request-set": r.set_id
    }, "Anmod om booking");
    btn.disabled = !(r.availableSlots?.length);
    btn.addEventListener("click", ev => {
      ev.preventDefault();
      const setId = Number(ev.currentTarget.getAttribute("data-request-set"));
      bookerRequestBooking(setId);
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
  st.b.resultsMap = {};
  filtered.forEach(r => { st.b.resultsMap[r.set_id] = r; });
  renderBookerResults();
}

async function bookerRequestBooking(setId) {
  if (!sb) return;
  const row = st.b.resultsMap?.[setId];
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

// 11. Fælles refresh pr. rolle & boot
// ----------------------------------------------------------

async function refreshForRole() {
  renderRoleBadge();
  renderLayout();

  if (st.role === "admin") {
    await callInventoryStore("loadInventorySummary");
    await callInventoryStore("eksPull");
    await callSaetStore("saetPull");
    await relList();
    await callCalendarStore("calendarPullGlobal");
    await callCalendarStore("calendarPullLocal");
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
  callInventoryStore("bindEksControls");
  callSaetStore("bindSaetControls");
  bindAccessControls();
  bindBookingRuleControls();
  bindBookingRequestControls();
  callCalendarStore("bindCalendarControls");
  bindRelControls();
  bindBookerControls();

  await loadLibraries();
  await refreshForRole();
}

// ----------------------------------------------------------

window.LaesekredssApp = Object.freeze({
  refreshForRole,
  boot
});


