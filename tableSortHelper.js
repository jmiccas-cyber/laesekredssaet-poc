// Utility for managing table sorting and header indicators

(() => {
  function getSortState(stateRoot, defaultSort = { sortBy: "title", sortDir: "asc" }) {
    if (!stateRoot.sortBy) stateRoot.sortBy = defaultSort.sortBy;
    if (!stateRoot.sortDir) stateRoot.sortDir = defaultSort.sortDir;
    return stateRoot;
  }

  function toggleSort(stateRoot, field) {
    if (!field) return stateRoot;
    if (stateRoot.sortBy === field) {
      stateRoot.sortDir = stateRoot.sortDir === "asc" ? "desc" : "asc";
    } else {
      stateRoot.sortBy = field;
      stateRoot.sortDir = "asc";
    }
    return stateRoot;
  }

  function applySortIndicators(tableSelector, stateRoot) {
    document.querySelectorAll(`${tableSelector} thead th[data-sort]`)?.forEach(th => {
      const field = th.dataset.sort;
      th.classList.toggle("sorted-asc", field === stateRoot.sortBy && stateRoot.sortDir === "asc");
      th.classList.toggle("sorted-desc", field === stateRoot.sortBy && stateRoot.sortDir === "desc");
    });
  }

  function compareRows(a, b, sortBy, sortDir, accessors = {}) {
    const dir = sortDir === "desc" ? -1 : 1;
    const accessor = accessors[sortBy] || (row => row[sortBy]);
    const valA = accessor(a);
    const valB = accessor(b);
    if (typeof valA === "number" && typeof valB === "number") {
      return (valA - valB) * dir;
    }
    return String(valA || "").localeCompare(String(valB || "")) * dir;
  }

  function attachSortHandlers(tableSelector, stateRoot, renderFn) {
    document.querySelectorAll(`${tableSelector} thead th[data-sort]`)?.forEach(th => {
      if (th.dataset.sortBound === "1") return;
      th.dataset.sortBound = "1";
      th.addEventListener("click", () => {
        toggleSort(stateRoot, th.dataset.sort);
        renderFn();
      });
    });
  }

  window.TableSortHelper = Object.freeze({
    getSortState,
    toggleSort,
    applySortIndicators,
    compareRows,
    attachSortHandlers
  });
})();
