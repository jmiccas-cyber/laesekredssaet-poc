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

  window.ExcelHelper = Object.freeze({
    ensureSheetJs,
    exportRows,
    readSheetRows
  });
})();
