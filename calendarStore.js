// Calendar module (Admin – Kalender)

(function () {
  const StateLibStore = window.StateLibStore || {};
  const st = StateLibStore.st || window.st;
  const $ = StateLibStore.$ || window.$;
  const el = StateLibStore.el || window.el;
  const HOLIDAY_TABLE = StateLibStore.HOLIDAY_TABLE || window.HOLIDAY_TABLE;
  const LOCAL_HOLIDAY_TABLE = StateLibStore.LOCAL_HOLIDAY_TABLE || window.LOCAL_HOLIDAY_TABLE;
  const showMsg = window.showMsg || (() => {});
  const ExcelHelper = window.ExcelHelper || null;
  const MessageHelper = window.MessageHelper || null;
  const SupabaseHelper = window.SupabaseHelper || null;
  const currentAdminId = window.currentAdminId || (() => "");
  const fmtLibLabel = window.fmtLibLabel || (() => "");
  const isSuperLibrary = window.isSuperLibrary || (() => false);
  const TableSortHelper = window.TableSortHelper || null;
  const calendarMessenger = MessageHelper?.create("#calendarMsg");
  const calendarLocalMessenger = MessageHelper?.create("#calendarLocalMsg");

  function setCalendarMsg(text, ok = false) {
    if (calendarMessenger) calendarMessenger.set(text, ok);
    else showMsg("#calendarMsg", text, ok);
  }

  function setCalendarLocalMsg(text, ok = false) {
    if (calendarLocalMessenger) calendarLocalMessenger.set(text, ok);
    else showMsg("#calendarLocalMsg", text, ok);
  }

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
    if (!TableSortHelper) return;
    const defaultSort = { sortBy: "holiday_date", sortDir: "asc" };
    const sortRoot = st.calendar?.globalSort || (st.calendar.globalSort = { ...defaultSort });
    const toTimestamp = value => {
      const parsed = value ? Date.parse(value) : NaN;
      return isNaN(parsed) ? 0 : parsed;
    };
    TableSortHelper.renderTable({
      tableSelector: "#tblCalendar",
      rows: Array.isArray(rows) ? rows : [],
      columns: [
        {
          id: "holiday_date",
          accessor: row => toTimestamp(row.holiday_date),
          render: row => row.holiday_date ? new Date(row.holiday_date).toLocaleDateString("da-DK") : ""
        },
        {
          id: "title",
          accessor: row => (row.title || "").toLowerCase(),
          render: row => row.title || ""
        },
        {
          id: "notes",
          accessor: row => (row.notes || "").toLowerCase(),
          render: row => row.notes || ""
        }
      ],
      stateRoot: sortRoot,
      defaultSort,
      emptyText: "Ingen registrerede fridage.",
      rowActions: row => el("button", {
        class: "btn btn-small",
        "data-cal-delete": row.holiday_id
      }, "Slet")
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
    setCalendarMsg("Kun super admin kan eksportere kalenderen.");
      return;
    }
    setCalendarMsg("Genererer Excel …");
    const { data, error } = await sb
      .from(HOLIDAY_TABLE)
      .select("holiday_date,title,notes")
      .order("holiday_date", { ascending: true });
    if (error) {
      setCalendarMsg("Kunne ikke hente kalender: " + error.message);
      return;
    }
    const rows = (data || []).map(row => ({
      Dato: row.holiday_date || "",
      Titel: row.title || "",
      Noter: row.notes || ""
    }));
    if (!ExcelHelper) {
      setCalendarMsg("Excel-helper mangler. Prøv at genindlæse siden.");
      return;
    }
    try {
      await ExcelHelper.exportRows({
        rows,
        sheetName: "Kalender",
        fileName: "kalender.xlsx",
        emptyRowTemplate: { Dato: "", Titel: "", Noter: "" },
        messageSelector: "#calendarMsg",
        beforeText: null,
        successText: "Excel klar til download."
      });
    } catch (err) {
      setCalendarMsg(err.message || "Kunne ikke generere Excel.");
    }
  }

  async function calendarImportExcelGlobal(file) {
    if (!sb || !file) return;
    const adminLib = st.libs.byId[currentAdminId()];
    if (!isSuperLibrary(adminLib)) {
      setCalendarMsg("Kun super admin kan importere kalenderen.");
      return;
    }
    if (!ExcelHelper) {
      setCalendarMsg("Excel-helper mangler. Prøv at genindlæse siden.");
      return;
    }
    let rows;
    try {
      rows = await ExcelHelper.readSheetRows(file, {
        messageSelector: "#calendarMsg",
        loadingText: "Indlæser Excel …",
        emptySheetText: "Excel-arket er tomt."
      });
    } catch (err) {
      return;
    }
    if (!rows.length) {
      return;
    }

    const additionMap = new Map();
    const deletionSet = new Set();
    const { failures } = ExcelHelper.processActionRows(rows, {
      columnMap: {
        action: ["Handling", "handling", "Action"],
        date: ["Dato", "date"],
        title: ["Titel", "title", "Beskrivelse"],
        notes: ["Noter", "notes", "Note"]
      },
      defaultAction: "tilføj",
      onRow: ({ action, values }) => {
        const isoDate = normalizeHolidayDate(values.date);
        if (!isoDate) {
          return "dato mangler eller er ugyldig.";
        }
        if (action === "slet" || action === "delete") {
          additionMap.delete(isoDate);
          deletionSet.add(isoDate);
          return;
        }
        if (action !== "tilføj" && action !== "add" && action !== "opdater") {
          return `ukendt handling "${action}". Brug Tilføj eller Slet.`;
        }
        const title = String(values.title || "").trim();
        if (!title) {
          return "titel skal udfyldes.";
        }
        const notes = String(values.notes || "").trim();
        additionMap.set(isoDate, { holiday_date: isoDate, title, notes });
        deletionSet.delete(isoDate);
      }
    });

    const additions = Array.from(additionMap.values());
    const deletions = Array.from(deletionSet);

    if (!additions.length && !deletions.length) {
      setCalendarMsg(failures[0] || "Ingen gyldige rækker fundet.");
      return;
    }

    let upsertsDone = 0;
    if (additions.length) {
      try {
        const result = await SupabaseHelper.processChunks(additions, 100, async chunk => {
          const { error } = await sb.from(HOLIDAY_TABLE).upsert(chunk, { onConflict: "holiday_date" });
          if (error) throw error;
        });
        upsertsDone = result?.processed || 0;
      } catch (error) {
        setCalendarMsg("Fejl ved import: " + error.message);
        return;
      }
    }

    let deletesDone = 0;
    if (deletions.length) {
      try {
        const result = await SupabaseHelper.processChunks(deletions, 100, async chunk => {
          const { error } = await sb
            .from(HOLIDAY_TABLE)
            .delete()
            .in("holiday_date", chunk);
          if (error) throw error;
        });
        deletesDone = result?.processed || 0;
      } catch (error) {
        setCalendarMsg("Fejl ved sletning: " + error.message);
        return;
      }
    }

    const parts = [];
    if (upsertsDone) parts.push(`opdaterede ${upsertsDone} dag(e)`);
    if (deletesDone) parts.push(`slettede ${deletesDone}`);
    setCalendarMsg(parts.length ? `Import gennemført: ${parts.join(", ")}.` : "Import gennemført.", true);
    if (failures.length) {
      alert("Følgende rækker blev sprunget over:\n" + failures.join("\n"));
    }
    await calendarPullGlobal();
  }

  async function calendarPullGlobal() {
    if (!sb) return;
    const adminLib = st.libs.byId[currentAdminId()];
    const isSuper = isSuperLibrary(adminLib);
    const globalSection = $("#calendarGlobalSection");
    if (globalSection) globalSection.style.display = isSuper ? "" : "none";
    setCalendarFormEnabledGlobal(isSuper);
    if (!isSuper) {
      renderCalendarRowsGlobal([]);
      setCalendarMsg("Kun super admin kan vedligeholde kalenderen.");
      return;
    }

    setCalendarMsg("Henter kalender...");
    const { data, error } = await sb
      .from(HOLIDAY_TABLE)
      .select("holiday_id,holiday_date,title,notes")
      .order("holiday_date", { ascending: true });

    if (error) {
      setCalendarMsg("Kunne ikke hente kalender: " + error.message);
      return;
    }
    st.calendar.list = data || [];
    renderCalendarRowsGlobal(st.calendar.list);
    setCalendarMsg(st.calendar.list.length ? `Indlæst ${st.calendar.list.length} dag(e).` : "Ingen dage registreret.", true);
  }

  function renderCalendarLocalRows(rows) {
    if (!TableSortHelper) return;
    const defaultSort = { sortBy: "holiday_date", sortDir: "asc" };
    const sortRoot = st.calendar?.localSort || (st.calendar.localSort = { ...defaultSort });
    const toTimestamp = value => {
      const parsed = value ? Date.parse(value) : NaN;
      return isNaN(parsed) ? 0 : parsed;
    };
    TableSortHelper.renderTable({
      tableSelector: "#tblCalendarLocal",
      rows: Array.isArray(rows) ? rows : [],
      columns: [
        {
          id: "holiday_date",
          accessor: row => toTimestamp(row.holiday_date),
          render: row => row.holiday_date ? new Date(row.holiday_date).toLocaleDateString("da-DK") : ""
        },
        {
          id: "title",
          accessor: row => (row.title || "").toLowerCase(),
          render: row => row.title || ""
        },
        {
          id: "notes",
          accessor: row => (row.notes || "").toLowerCase(),
          render: row => row.notes || ""
        }
      ],
      stateRoot: sortRoot,
      defaultSort,
      emptyText: "Ingen lokale lukkedage.",
      rowActions: row => el("button", { class: "btn btn-small", "data-cal-local-delete": row.local_holiday_id }, "Slet")
    });
  }

  async function calendarPullLocal() {
    if (!sb) return;
    const section = $("#calendarLocalSection");
    const ownerLabel = $("#calendarLocalOwner");
    const ownerId = currentAdminId();
    const adminLib = st.libs.byId[ownerId];
    if (section) section.style.display = st.role === "admin" ? "" : "none";
    if (!ownerId || st.role !== "admin") {
      renderCalendarLocalRows([]);
      setCalendarLocalMsg(st.role === "admin" ? "Vælg et centralbibliotek først." : "Kalender er kun tilgængelig for admins.");
      return;
    }
    if (ownerLabel) ownerLabel.textContent = fmtLibLabel(adminLib) || ownerId;
    setCalendarLocalMsg("Henter lokal kalender...");
    const { data, error } = await sb
      .from(LOCAL_HOLIDAY_TABLE)
      .select("local_holiday_id,holiday_date,title,notes,source_global")
      .eq("owner_bibliotek_id", ownerId)
      .order("holiday_date", { ascending: true });
    if (error) {
      setCalendarLocalMsg("Kunne ikke hente lokal kalender: " + error.message);
      return;
    }
    st.calendar.local = data || [];
    renderCalendarLocalRows(st.calendar.local);
    setCalendarLocalMsg(st.calendar.local.length ? `Indlæst ${st.calendar.local.length} dag(e).` : "Ingen lokale dage registreret.", true);
  }

  async function calendarLocalAdd() {
    if (!sb) return;
    const ownerId = currentAdminId();
    if (!ownerId) {
      setCalendarLocalMsg("Vælg først et centralbibliotek.");
      return;
    }
    const date = $("#calLocalDate")?.value || "";
    const title = $("#calLocalTitle")?.value.trim() || "";
    const notes = $("#calLocalNotes")?.value.trim() || "";
    if (!date) {
      setCalendarLocalMsg("Dato skal udfyldes.");
      return;
    }
    if (!title) {
      setCalendarLocalMsg("Beskrivelse skal udfyldes.");
      return;
    }
    setCalendarLocalMsg("Gemmer dag...");
    const payload = { owner_bibliotek_id: ownerId, holiday_date: date, title, notes, source_global: false };
    const { error } = await sb.from(LOCAL_HOLIDAY_TABLE).insert(payload);
    if (error) {
      setCalendarLocalMsg("Kunne ikke gemme: " + error.message);
      return;
    }
    $("#calLocalDate").value = "";
    $("#calLocalTitle").value = "";
    $("#calLocalNotes").value = "";
    setCalendarLocalMsg("Dag gemt.", true);
    if (st.calendar.localSets) {
      delete st.calendar.localSets[ownerId];
    }
    await calendarPullLocal();
  }

  async function calendarLocalDelete(id) {
    if (!sb || !id) return;
    const ownerId = currentAdminId();
    if (!ownerId) {
      setCalendarLocalMsg("Vælg først et centralbibliotek.");
      return;
    }
    if (!confirm("Slet denne dag fra lokal kalender?")) return;
    const { error } = await sb.from(LOCAL_HOLIDAY_TABLE).delete().eq("local_holiday_id", id).eq("owner_bibliotek_id", ownerId);
    if (error) {
      setCalendarLocalMsg("Kunne ikke slette: " + error.message);
      return;
    }
    setCalendarLocalMsg("Dag slettet.", true);
    if (st.calendar.localSets) {
      delete st.calendar.localSets[ownerId];
    }
    await calendarPullLocal();
  }

  async function calendarLocalResync() {
    if (!sb) return;
    const ownerId = currentAdminId();
    if (!ownerId) {
      setCalendarLocalMsg("Vælg først et centralbibliotek.");
      return;
    }
    setCalendarLocalMsg("Synkroniserer globale dage …");
    const { data: globalRows, error: globalError } = await sb
      .from(HOLIDAY_TABLE)
      .select("holiday_date,title,notes")
      .order("holiday_date", { ascending: true });
    if (globalError) {
      setCalendarLocalMsg("Kunne ikke hente globale dage: " + globalError.message);
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
          setCalendarLocalMsg("Synkronisering fejlede: " + error.message);
          return;
        }
      }
    }
    setCalendarLocalMsg(toInsert.length ? `Tilføjede ${toInsert.length} global(e) dag(e).` : "Alle globale dage var allerede til stede.", true);
    if (st.calendar.localSets) {
      delete st.calendar.localSets[ownerId];
    }
    await calendarPullLocal();
  }

  async function calendarLocalExportExcel() {
    if (!sb) return;
    const ownerId = currentAdminId();
    if (!ownerId) {
      setCalendarLocalMsg("Vælg først et centralbibliotek.");
      return;
    }
    setCalendarLocalMsg("Genererer Excel …");
    const { data, error } = await sb
      .from(LOCAL_HOLIDAY_TABLE)
      .select("holiday_date,title,notes")
      .eq("owner_bibliotek_id", ownerId)
      .order("holiday_date", { ascending: true });
    if (error) {
      setCalendarLocalMsg("Kunne ikke hente kalender: " + error.message);
      return;
    }
    const rows = (data || []).map(row => ({
      Dato: row.holiday_date || "",
      Titel: row.title || "",
      Noter: row.notes || ""
    }));
    if (!ExcelHelper) {
      setCalendarLocalMsg("Excel-helper mangler. Prøv at genindlæse siden.");
      return;
    }
    try {
      await ExcelHelper.exportRows({
        rows,
        sheetName: "Lokal kalender",
        fileName: `kalender_${ownerId}.xlsx`,
        emptyRowTemplate: { Dato: "", Titel: "", Noter: "" },
        messageSelector: "#calendarLocalMsg",
        beforeText: null,
        successText: "Excel klar til download."
      });
    } catch (err) {
      setCalendarLocalMsg(err.message || "Kunne ikke generere Excel.");
    }
  }

  async function calendarLocalImportExcel(file) {
    if (!sb || !file) return;
    const ownerId = currentAdminId();
    if (!ownerId) {
      setCalendarLocalMsg("Vælg først et centralbibliotek.");
      return;
    }
    if (!ExcelHelper) {
      setCalendarLocalMsg("Excel-helper mangler. Prøv at genindlæse siden.");
      return;
    }
    let rows;
    try {
      rows = await ExcelHelper.readSheetRows(file, {
        messageSelector: "#calendarLocalMsg",
        loadingText: "Indlæser Excel …",
        emptySheetText: "Excel-arket er tomt."
      });
    } catch (err) {
      return;
    }
    if (!rows.length) {
      return;
    }

    const additionMap = new Map();
    const deletionSet = new Set();
    const { failures } = ExcelHelper.processActionRows(rows, {
      columnMap: {
        action: ["Handling", "handling", "Action"],
        date: ["Dato", "date"],
        title: ["Titel", "title", "Beskrivelse"],
        notes: ["Noter", "notes", "Note"]
      },
      defaultAction: "tilføj",
      onRow: ({ action, values }) => {
        const isoDate = normalizeHolidayDate(values.date);
        if (!isoDate) {
          return "dato mangler eller er ugyldig.";
        }
        if (action === "slet" || action === "delete") {
          additionMap.delete(isoDate);
          deletionSet.add(isoDate);
          return;
        }
        const title = String(values.title || "").trim();
        if (!title) {
          return "titel skal udfyldes.";
        }
        const notes = String(values.notes || "").trim();
        additionMap.set(isoDate, { owner_bibliotek_id: ownerId, holiday_date: isoDate, title, notes });
        deletionSet.delete(isoDate);
      }
    });

    const additions = Array.from(additionMap.values());
    const deletions = Array.from(deletionSet);

    if (!additions.length && !deletions.length) {
      setCalendarLocalMsg(failures[0] || "Ingen gyldige rækker fundet.");
      return;
    }

    let upsertsDone = 0;
    if (additions.length) {
      try {
        const result = await SupabaseHelper.processChunks(additions, 100, async chunk => {
          const { error } = await sb.from(LOCAL_HOLIDAY_TABLE).upsert(chunk, { onConflict: "owner_bibliotek_id,holiday_date" });
          if (error) throw error;
        });
        upsertsDone = result?.processed || 0;
      } catch (error) {
        setCalendarLocalMsg("Fejl ved import: " + error.message);
        return;
      }
    }

    let deletesDone = 0;
    if (deletions.length) {
      try {
        const result = await SupabaseHelper.processChunks(deletions, 100, async chunk => {
          const { error } = await sb
            .from(LOCAL_HOLIDAY_TABLE)
            .delete()
            .eq("owner_bibliotek_id", ownerId)
            .in("holiday_date", chunk);
          if (error) throw error;
        });
        deletesDone = result?.processed || 0;
      } catch (error) {
        setCalendarLocalMsg("Fejl ved sletning: " + error.message);
        return;
      }
    }

    const parts = [];
    if (upsertsDone) parts.push(`opdaterede ${upsertsDone} dag(e)`);
    if (deletesDone) parts.push(`slettede ${deletesDone}`);
    setCalendarLocalMsg(parts.length ? `Import gennemført: ${parts.join(", ")}.` : "Import gennemført.", true);
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
      setCalendarMsg("Dato skal udfyldes.");
      return;
    }
    if (!title) {
      setCalendarMsg("Beskrivelse skal udfyldes.");
      return;
    }
    setCalendarMsg("Gemmer dag...");
    const payload = { holiday_date: date, title, notes };
    const { error } = await sb.from(HOLIDAY_TABLE).insert(payload);
    if (error) {
      setCalendarMsg("Kunne ikke gemme: " + error.message);
      return;
    }
    clearCalendarFormGlobal();
    setCalendarMsg("Dag tilføjet.", true);
    await calendarPullGlobal();
  }

  async function calendarDeleteGlobal(id) {
    if (!sb || !id) return;
    if (!confirm("Slet denne dag fra kalenderen?")) return;
    const { error } = await sb.from(HOLIDAY_TABLE).delete().eq("holiday_id", id);
    if (error) {
      setCalendarMsg("Kunne ikke slette: " + error.message);
      return;
    }
    setCalendarMsg("Dag slettet.", true);
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
