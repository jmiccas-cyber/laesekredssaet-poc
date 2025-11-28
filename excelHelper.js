// Shared Excel helper utilities (SheetJS wrapper for export/import)

(function () {
  const globalShowMsg = window.showMsg || (() => {});

  async function ensureSheetJs() {
    if (window.XLSX) return;
    if (typeof window.ensureSheetJs === "function") {
      await window.ensureSheetJs();
      return;
    }
    throw new Error("Excel-biblioteket er ikke tilgængeligt.");
  }

  async function exportRows(options = {}) {
    const {
      rows,
      sheetName = "Data",
      fileName = "export.xlsx",
      emptyRowTemplate = {},
      messageSelector,
      beforeText = "Genererer Excel …",
      successText = "Excel klar til download.",
      showMsg = globalShowMsg
    } = options;

    if (messageSelector && beforeText) {
      showMsg(messageSelector, beforeText);
    }

    await ensureSheetJs();
    const data = rows && rows.length ? rows : [emptyRowTemplate];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    if (messageSelector && successText) {
      showMsg(messageSelector, successText, true);
    }
  }

  async function readSheetRows(file, options = {}) {
    const {
      messageSelector,
      loadingText = "Indlæser Excel …",
      emptySheetText = "Excel-arket er tomt.",
      noSheetText = "Excel-filen indeholder ingen ark.",
      showMsg = globalShowMsg
    } = options;

    if (!file) {
      throw new Error("Ingen fil valgt.");
    }

    if (messageSelector && loadingText) {
      showMsg(messageSelector, loadingText);
    }

    await ensureSheetJs();

    let workbook;
    try {
      const buffer = await file.arrayBuffer();
      workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    } catch (err) {
      if (messageSelector) {
        showMsg(messageSelector, "Kunne ikke læse Excel-filen: " + err.message);
      }
      throw err;
    }

    const sheetName = workbook.SheetNames?.[0];
    if (!sheetName) {
      if (messageSelector && noSheetText) {
        showMsg(messageSelector, noSheetText);
      }
      return [];
    }

    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
    if (!rows.length) {
      if (messageSelector && emptySheetText) {
        showMsg(messageSelector, emptySheetText);
      }
      return [];
    }
    return rows;
  }

  function getValue(row, keys) {
    if (!row || keys == null) return "";
    const list = Array.isArray(keys) ? keys : [keys];
    for (const key of list) {
      if (key == null) continue;
      if (row[key] != null && row[key] !== "") return row[key];
      const strKey = String(key);
      const lower = strKey.toLowerCase();
      if (lower !== key && row[lower] != null && row[lower] !== "") {
        return row[lower];
      }
    }
    return "";
  }

  function normalizeRows(rawRows = [], columnMap = {}) {
    const normalizedMap = {};
    Object.entries(columnMap).forEach(([field, names]) => {
      normalizedMap[field] = Array.isArray(names) ? names : [names];
    });
    return rawRows.map((row, idx) => {
      const values = {};
      Object.entries(normalizedMap).forEach(([field, names]) => {
        values[field] = getValue(row, names);
      });
      return { line: idx + 2, values, raw: row };
    });
  }

  function processActionRows(rawRows, options = {}) {
    const {
      columnMap = {},
      actionField = "action",
      defaultAction = "opdater",
      onRow
    } = options;
    const normalized = normalizeRows(rawRows || [], columnMap);
    const failures = [];
    normalized.forEach(({ line, values, raw }) => {
      let action = (values[actionField] || "").toString().trim().toLowerCase();
      if (!action) action = defaultAction;
      if (!onRow) return;
      const result = onRow({ action, line, values, raw });
      if (result === false || result == null) return;
      if (typeof result === "string") {
        failures.push(`Række ${line}: ${result}`);
      } else if (Array.isArray(result?.errors)) {
        result.errors.forEach(msg => failures.push(`Række ${line}: ${msg}`));
      }
    });
    return { failures };
  }

  window.ExcelHelper = Object.freeze({
    ensureSheetJs,
    exportRows,
    readSheetRows,
    getValue,
    normalizeRows,
    processActionRows
  });
})();
