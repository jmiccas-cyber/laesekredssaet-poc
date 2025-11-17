// 9. Admin ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ Adgang (super admin)
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
    showMsg("#accessMsg", "Der skal altid vÃƒÆ’Ã‚Â¦re mindst ÃƒÆ’Ã‚Â©n super admin.");
    return;
  }
  if (accessUpdating) return;
  accessUpdating = true;
  renderAccessTable();
  showMsg("#accessMsg", "Opdaterer super admin-adgang ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦");
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
  showMsg("#accessMsg", makeSuper ? `${label} er nu super admin.` : `${label} er ikke lÃƒÆ’Ã‚Â¦ngere super admin.`, true);
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
// 10. Admin ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ Kalender (tbl_national_holidays)
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
  showMsg("#calendarMsg", "Genererer Excel ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦");
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
  showMsg("#calendarMsg", "IndlÃƒÆ’Ã‚Â¦ser Excel ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦");
  let workbook;
  try {
    const buffer = await file.arrayBuffer();
    workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  } catch (e) {
    showMsg("#calendarMsg", "Kunne ikke lÃƒÆ’Ã‚Â¦se filen: " + e.message);
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
    const action = actionRaw || "tilfÃƒÆ’Ã‚Â¸j";
    const isoDate = normalizeHolidayDate(getValue(row, "Dato", "date"));
    if (!isoDate) {
      failures.push(`RÃƒÆ’Ã‚Â¦kke ${line}: dato mangler eller er ugyldig.`);
      return;
    }
    if (action === "slet" || action === "delete") {
      additionMap.delete(isoDate);
      deletionSet.add(isoDate);
      return;
    }
    const title = String(getValue(row, "Titel", "title", "Beskrivelse")).trim();
    if (!title) {
      failures.push(`RÃƒÆ’Ã‚Â¦kke ${line}: titel skal udfyldes.`);
      return;
    }
    const notes = String(getValue(row, "Noter", "notes", "Note")).trim();
    additionMap.set(isoDate, { holiday_date: isoDate, title, notes });
  });

  const additions = Array.from(additionMap.values());
  const deletions = Array.from(deletionSet);

  if (!additions.length && !deletions.length) {
    showMsg("#calendarMsg", failures[0] || "Ingen gyldige rÃƒÆ’Ã‚Â¦kker fundet.");
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
  showMsg("#calendarMsg", parts.length ? `Import gennemfÃƒÆ’Ã‚Â¸rt: ${parts.join(", ")}.` : "Import gennemfÃƒÆ’Ã‚Â¸rt.", true);
  if (failures.length) {
    alert("FÃƒÆ’Ã‚Â¸lgende rÃƒÆ’Ã‚Â¦kker blev sprunget over:\n" + failures.join("\n"));
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
  showMsg(msgSel, st.calendar.list.length ? `IndlÃƒÆ’Ã‚Â¦st ${st.calendar.list.length} dag(e).` : "Ingen dage registreret.", true);
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
    showMsg(msgSel, st.role === "admin" ? "VÃƒÆ’Ã‚Â¦lg et centralbibliotek fÃƒÆ’Ã‚Â¸rst." : "Kalender er kun tilgÃƒÆ’Ã‚Â¦ngelig for admins.");
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
  showMsg(msgSel, st.calendar.local.length ? `IndlÃƒÆ’Ã‚Â¦st ${st.calendar.local.length} dag(e).` : "Ingen lokale dage registreret.", true);
}

async function calendarLocalAdd() {
  if (!sb) return;
  const ownerId = currentAdminId();
  if (!ownerId) {
    showMsg("#calendarLocalMsg", "VÃƒÆ’Ã‚Â¦lg fÃƒÆ’Ã‚Â¸rst et centralbibliotek.");
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
    showMsg("#calendarLocalMsg", "VÃƒÆ’Ã‚Â¦lg fÃƒÆ’Ã‚Â¸rst et centralbibliotek.");
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
    showMsg("#calendarLocalMsg", "VÃƒÆ’Ã‚Â¦lg fÃƒÆ’Ã‚Â¸rst et centralbibliotek.");
    return;
  }
  showMsg("#calendarLocalMsg", "Synkroniserer globale dage ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦");
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
  showMsg("#calendarLocalMsg", toInsert.length ? `TilfÃƒÆ’Ã‚Â¸jede ${toInsert.length} global(e) dag(e).` : "Alle globale dage var allerede til stede.", true);
  if (st.calendar.localSets) {
    delete st.calendar.localSets[ownerId];
  }
  await calendarPullLocal();
}

async function calendarLocalExportExcel() {
  if (!sb) return;
  const ownerId = currentAdminId();
  if (!ownerId) {
    showMsg("#calendarLocalMsg", "VÃƒÆ’Ã‚Â¦lg fÃƒÆ’Ã‚Â¸rst et centralbibliotek.");
    return;
  }
  showMsg("#calendarLocalMsg", "Genererer Excel ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦");
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
    showMsg("#calendarLocalMsg", "VÃƒÆ’Ã‚Â¦lg fÃƒÆ’Ã‚Â¸rst et centralbibliotek.");
    return;
  }
  try {
    await ensureSheetJs();
  } catch (e) {
    showMsg("#calendarLocalMsg", e.message);
    return;
  }
  showMsg("#calendarLocalMsg", "IndlÃƒÆ’Ã‚Â¦ser Excel ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦");
  let workbook;
  try {
    const buffer = await file.arrayBuffer();
    workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  } catch (e) {
    showMsg("#calendarLocalMsg", "Kunne ikke lÃƒÆ’Ã‚Â¦se filen: " + e.message);
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
    const action = actionRaw || "tilfÃƒÆ’Ã‚Â¸j";
    const isoDate = normalizeHolidayDate(getValue(row, "Dato", "date"));
    if (!isoDate) {
      failures.push(`RÃƒÆ’Ã‚Â¦kke ${line}: dato mangler eller er ugyldig.`);
      return;
    }
    if (action === "slet" || action === "delete") {
      additionMap.delete(isoDate);
      deletionSet.add(isoDate);
      return;
    }
    const title = String(getValue(row, "Titel", "title", "Beskrivelse")).trim();
    if (!title) {
      failures.push(`RÃƒÆ’Ã‚Â¦kke ${line}: titel skal udfyldes.`);
      return;
    }
    const notes = String(getValue(row, "Noter", "notes", "Note")).trim();
    additionMap.set(isoDate, { owner_bibliotek_id: ownerId, holiday_date: isoDate, title, notes });
  });

  const additions = Array.from(additionMap.values());
  const deletions = Array.from(deletionSet);

  if (!additions.length && !deletions.length) {
    showMsg("#calendarLocalMsg", failures[0] || "Ingen gyldige rÃƒÆ’Ã‚Â¦kker fundet.");
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
  showMsg("#calendarLocalMsg", parts.length ? `Import gennemfÃƒÆ’Ã‚Â¸rt: ${parts.join(", ")}.` : "Import gennemfÃƒÆ’Ã‚Â¸rt.", true);
  if (failures.length) {
    alert("FÃƒÆ’Ã‚Â¸lgende rÃƒÆ’Ã‚Â¦kker blev sprunget over:\n" + failures.join("\n"));
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
    console.error("Kunne ikke hente sÃƒÆ’Ã‚Â¦t:", error);
    return [];
  }
  return data || [];
}

async function fetchSaetMapByIds(ids) {
  if (!sb || !ids || !ids.length) return {};
  const { data, error } = await sb
    .from("tbl_saet")
    .select("set_id,title,author,isbn")
    .in("set_id", ids);
  if (error) {
    console.error("Kunne ikke hente sÃƒÆ’Ã‚Â¦t metadata:", error);
    return {};
  }
  const map = {};
  (data || []).forEach(row => {
    if (row.set_id == null) return;
    map[row.set_id] = row;
  });
  return map;
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
    showMsg(msgSel, "Bookingregler er kun tilgÃƒÆ’Ã‚Â¦ngelige for admin-profiler.");
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
    showMsg(msgSel, "VÃƒÆ’Ã‚Â¦lg fÃƒÆ’Ã‚Â¸rst et centralbibliotek via Skift: Admin ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬Â Booker.");
    return;
  }
  st.bookingRules.owner = ownerId;
  showMsg(msgSel, "Henter bookingregel ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦");
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
  showMsg("#bookingRuleMsg", "Gemmer bookingregel ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦");
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
    showMsg("#bookingRequestsMsg", "VÃƒÆ’Ã‚Â¦lg fÃƒÆ’Ã‚Â¸rst et centralbibliotek.");
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
  const rows = data || [];
  const setIds = Array.from(new Set(rows.map(r => r.set_id).filter(Boolean)));
  const setMap = await fetchSaetMapByIds(setIds);
  st.booking.requests = rows;
  st.booking.requestSets = setMap;
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
  const setMap = st.booking.requestSets || {};
  if (!rows.length) {
    tb.appendChild(el("tr", {}, el("td", { colspan: 8 }, "Ingen anmodninger.")));
    showMsg("#bookingRequestsMsg", "Ingen aktuelle anmodninger.");
    return;
  }
  rows.forEach(r => {
    const requester = st.libs.byId[r.requester_bibliotek_id];
    const requesterLabel = requester ? fmtLibLabel(requester) : r.requester_bibliotek_id || "";
    const set = setMap[r.set_id] || null;
    const statusLabel = r.booking_status === BOOKING_STATUS_BOOKED ? "Booket"
      : r.booking_status === BOOKING_STATUS_REQUESTED ? "Reserveret"
      : r.booking_status === BOOKING_STATUS_AVAILABLE ? "Ledig"
      : "Annulleret";
    const tr = el("tr", {},
      el("td", {}, set?.title || `SÃƒÆ’Ã‚Â¦t #${r.set_id}` || ""),
      el("td", {}, set?.author || ""),
      el("td", {}, set?.isbn || ""),
      el("td", {}, requesterLabel),
      el("td", {}, formatDateDisplay(r.start_date)),
      el("td", {}, formatDateDisplay(r.end_date)),
      el("td", {}, statusLabel || ""),
      el("td", {},
        (() => {
          const approveBtn = el("button", {
            class: "btn btn-small",
            type: "button",
            onclick: () => bookingRequestsUpdate(r.booking_id, "approve", r.set_id)
          }, "Godkend");
          const cancelBtn = el("button", {
            class: "btn btn-small",
            type: "button",
            onclick: () => bookingRequestsUpdate(r.booking_id, "cancel", r.set_id)
          }, "Afvis");
          approveBtn.style.marginRight = "6px";
          approveBtn.disabled = r.booking_status !== BOOKING_STATUS_REQUESTED;
          cancelBtn.disabled = r.booking_status !== BOOKING_STATUS_REQUESTED;
          const wrapper = el("div", { style: "display:flex; gap:6px;" }, approveBtn, cancelBtn);
          return wrapper;
        })()
      )
    );
    tb.appendChild(tr);
  });
  showMsg("#bookingRequestsMsg", `${rows.length} anmodning(er) fundet.`, true);
}

async function bookingRequestsUpdate(bookingId, action, setId) {
  if (!sb || !bookingId) return;
  const bookingIdNum = Number(bookingId);
  if (!bookingIdNum) return;
  const msgSel = "#bookingRequestsMsg";
  showMsg(msgSel, "Opdaterer anmodning ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦");
  const updates = action === "approve"
    ? { booking_status: BOOKING_STATUS_BOOKED }
    : { booking_status: BOOKING_STATUS_AVAILABLE, requester_bibliotek_id: null };
  const query = sb
    .from("tbl_booking")
    .update(updates)
    .eq("booking_id", bookingIdNum);
  if (action === "approve") {
    query.eq("booking_status", BOOKING_STATUS_REQUESTED);
  } else {
    query.eq("booking_status", BOOKING_STATUS_REQUESTED);
  }
  const { error, data } = await query.select("booking_id").limit(1);
  if (error || !data?.length) {
    showMsg(msgSel, "Kunne ikke opdatere anmodning: " + (error?.message || "Slot ikke lÃƒÆ’Ã‚Â¦ngere tilgÃƒÆ’Ã‚Â¦ngelig."));
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
  showMsg("#calendarMsg", "Dag tilfÃƒÆ’Ã‚Â¸jet.", true);
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
// 11. Booker ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ sÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¸gning (tbl_saet + relationer)
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
    showMsg("#bMsg", "Fejl ved national sÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¸gning: " + natRes.error.message);
    return [];
  }
  if (regRes.error) {
    showMsg("#bMsg", "Fejl ved regional sÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¸gning: " + regRes.error.message);
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
    const ruleLabel = bookingRuleLabel(r.bookingRule) || "ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â";
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
    ? `Side ${st.b.page + 1}/${totalPages} - ${st.b.total} sÃƒÆ’Ã‚Â¦t`
    : "Ingen sÃƒÆ’Ã‚Â¦t fundet";
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
    const label = `${formatDateDisplay(slot.start_date)} ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ ${formatDateDisplay(slot.end_date)}`;
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
    showMsg("#bMsg", "VÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¦lg fÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¸rst en booker-profil (regionsbibliotek).");
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
    showMsg("#bMsg", "VÃƒÆ’Ã‚Â¦lg fÃƒÆ’Ã‚Â¸rst et regionsbibliotek via Skift: Admin ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬Â Booker.");
    return;
  }
  const bookingId = row.selectedSlotId || row.availableSlots?.[0]?.booking_id;
  if (!bookingId) {
    showMsg("#bMsg", "VÃƒÆ’Ã‚Â¦lg en ledig periode fÃƒÆ’Ã‚Â¸rst.");
    return;
  }
  const targetSlot = row.availableSlots?.find(slot => `${slot.booking_id}` === bookingId);
  if (!targetSlot) {
    showMsg("#bMsg", "Kunne ikke finde den valgte periode.");
    return;
  }
  showMsg("#bMsg", "Sender bookinganmodning ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦");
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
    showMsg("#bMsg", "Kunne ikke sende anmodning: " + (error?.message || "Slot ikke lÃƒÆ’Ã‚Â¦ngere ledig."));
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
// 11. FÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¦lles refresh pr. rolle & boot
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
  btn.textContent = count ? `Gem ${count} sÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¦t` : "Gem ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¦ndringer";
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
    showMsg("#msgSaet", "Der er ingen ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¦ndringer at gemme.");
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
    showMsg("#msgSaet", `Gemte ${successCount} sÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¦t`, true);
    highlightSaveBar();
    await saetPull();
    await regenerateBookingSlotsForOwner(currentAdminId());
  }
  if (failures.length) {
    alert("Kunne ikke gemme fÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¸lgende sÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¦t:\n" + failures.join("\n"));
  }
}












