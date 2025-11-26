// Calendar module (Admin – Kalender)

(function () {
  const StateLibStore = window.StateLibStore || {};
  const st = StateLibStore.st || window.st;
  const $ = StateLibStore.$ || window.$;
  const el = StateLibStore.el || window.el;
  const HOLIDAY_TABLE = StateLibStore.HOLIDAY_TABLE || window.HOLIDAY_TABLE;
  const LOCAL_HOLIDAY_TABLE = StateLibStore.LOCAL_HOLIDAY_TABLE || window.LOCAL_HOLIDAY_TABLE;
  const showMsg = window.showMsg || (() => {});
  const ensureSheetJs = window.ensureSheetJs || (async () => {});
  const currentAdminId = window.currentAdminId || (() => "");
  const fmtLibLabel = window.fmtLibLabel || (() => "");
  const isSuperLibrary = window.isSuperLibrary || (() => false);
  const TableSortHelper = window.TableSortHelper || null;

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
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) {
      tb.appendChild(el("tr", {}, el("td", { colspan: 4 }, "Ingen registrerede fridage.")));
      if (TableSortHelper) {
        const defaultSort = { sortBy: "holiday_date", sortDir: "asc" };
        const sortRoot = st.calendar?.globalSort || (st.calendar.globalSort = { ...defaultSort });
        TableSortHelper.applySortIndicators("#tblCalendar", TableSortHelper.getSortState(sortRoot, defaultSort));
      }
      return;
    }
    const defaultSort = { sortBy: "holiday_date", sortDir: "asc" };
    const sortRoot = st.calendar?.globalSort || (st.calendar.globalSort = { ...defaultSort });
    const sortState = TableSortHelper ? TableSortHelper.getSortState(sortRoot, defaultSort) : sortRoot;
    const toTimestamp = value => {
      const parsed = value ? Date.parse(value) : NaN;
      return isNaN(parsed) ? 0 : parsed;
    };
    const accessors = {
      holiday_date: row => toTimestamp(row.holiday_date),
      title: row => (row.title || "").toLowerCase(),
      notes: row => (row.notes || "").toLowerCase()
    };
    const sortedRows = TableSortHelper
      ? [...list].sort((a, b) => TableSortHelper.compareRows(a, b, sortState.sortBy, sortState.sortDir, accessors))
      : list;
    sortedRows.forEach(row => {
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
    if (TableSortHelper) {
      TableSortHelper.applySortIndicators("#tblCalendar", sortState);
    }
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
      const [, y, m, d] = match;
      const pad = n => String(n).padStart(2, "0");
      return `${y}-${pad(m)}-${pad(d)}`;
    }
    match = str.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (match) {
      const [, d, m, y] = match;
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
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) {
      tb.appendChild(el("tr", {}, el("td", { colspan: 4 }, "Ingen lokale lukkedage.")));
      if (TableSortHelper) {
        const defaultSort = { sortBy: "holiday_date", sortDir: "asc" };
        const sortRoot = st.calendar?.localSort || (st.calendar.localSort = { ...defaultSort });
        TableSortHelper.applySortIndicators("#tblCalendarLocal", TableSortHelper.getSortState(sortRoot, defaultSort));
      }
      return;
    }
    const defaultSort = { sortBy: "holiday_date", sortDir: "asc" };
    const sortRoot = st.calendar?.localSort || (st.calendar.localSort = { ...defaultSort });
    const sortState = TableSortHelper ? TableSortHelper.getSortState(sortRoot, defaultSort) : sortRoot;
    const toTimestamp = value => {
      const parsed = value ? Date.parse(value) : NaN;
      return isNaN(parsed) ? 0 : parsed;
    };
    const accessors = {
      holiday_date: row => toTimestamp(row.holiday_date),
      title: row => (row.title || "").toLowerCase(),
      notes: row => (row.notes || "").toLowerCase()
    };
    const sortedRows = TableSortHelper
      ? [...list].sort((a, b) => TableSortHelper.compareRows(a, b, sortState.sortBy, sortState.sortDir, accessors))
      : list;
    sortedRows.forEach(row => {
      const dateStr = row.holiday_date ? new Date(row.holiday_date).toLocaleDateString("da-DK") : "";
      const delBtn = el("button", { class: "btn btn-small", "data-cal-local-delete": row.local_holiday_id }, "Slet");
      tb.appendChild(el("tr", {},
        el("td", {}, dateStr),
        el("td", {}, row.title || ""),
        el("td", {}, row.notes || ""),
        el("td", {}, delBtn)
      ));
    });
    if (TableSortHelper) {
      TableSortHelper.applySortIndicators("#tblCalendarLocal", sortState);
    }
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
    const payload = { owner_bibliotek_id: ownerId, holiday_date: date, title, notes, source_global: false };
    const { error } = await sb.from(LOCAL_HOLIDAY_TABLE).insert(payload);
    if (error) {
      showMsg("#calendarLocalMsg", "Kunne ikke gemme: " + error.message);
      return;
    }
    $("#calLocalDate").value = "";
    $("#calLocalTitle").value = "";
    $("#calLocalNotes").value = "";
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
    if (!confirm("Slet denne dag fra lokal kalender?")) return;
    const { error } = await sb.from(LOCAL_HOLIDAY_TABLE).delete().eq("local_holiday_id", id).eq("owner_bibliotek_id", ownerId);
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
    if (TableSortHelper) {
      const globalSortState = st.calendar?.globalSort || (st.calendar.globalSort = { sortBy: "holiday_date", sortDir: "asc" });
      TableSortHelper.attachSortHandlers("#tblCalendar", globalSortState, () => {
        renderCalendarRowsGlobal(st.calendar.list || []);
      });
    }

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
    if (TableSortHelper) {
      const localSortState = st.calendar?.localSort || (st.calendar.localSort = { sortBy: "holiday_date", sortDir: "asc" });
      TableSortHelper.attachSortHandlers("#tblCalendarLocal", localSortState, () => {
        renderCalendarLocalRows(st.calendar.local || []);
      });
    }
  }

  const CalendarStore = Object.freeze({
    calendarPullGlobal,
    calendarPullLocal,
    calendarExportExcelGlobal,
    calendarImportExcelGlobal,
    calendarLocalAdd,
    calendarLocalDelete,
    calendarLocalResync,
    calendarLocalExportExcel,
    calendarLocalImportExcel,
    calendarAddGlobal,
    calendarDeleteGlobal,
    bindCalendarControls,
    renderCalendarRowsGlobal,
    renderCalendarLocalRows
  });

  window.CalendarStore = CalendarStore;
  Object.assign(window, CalendarStore);
  window.StoreRegistry?.registerStore?.("CalendarStore", CalendarStore);
})();

const CalendarStore = window.CalendarStore || {};
CalendarStore.init?.({
  state: window.StateLibStore?.st,
  getSupabaseClient: window.StateLibStore?.getSupabaseClient,
  uiHelpers: {
    showMsg: window.showMsg,
    el: window.StateLibStore?.el || window.el,
    $: window.StateLibStore?.$ || window.$
  }
});
