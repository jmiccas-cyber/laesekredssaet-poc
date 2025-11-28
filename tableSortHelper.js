// Utility for managing table sorting and header indicators

(() => {
  const createEl = window.StateLibStore?.el || window.el || ((tag, attrs = {}, ...kids) => {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else node.setAttribute(key, value);
    });
    kids.forEach(kid => {
      if (kid == null) return;
      if (kid instanceof Node) node.appendChild(kid);
      else node.appendChild(document.createTextNode(String(kid)));
    });
    return node;
  });
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

  function renderTable(options = {}) {
    const {
      tableSelector,
      rows,
      columns = [],
      stateRoot,
      defaultSort = { sortBy: "title", sortDir: "asc" },
      emptyText = "Ingen data.",
      rowClass = () => "",
      rowKey = (row, idx) => idx,
      rowActions = null,
      onRowRender = null
    } = options;

    const table = document.querySelector(tableSelector);
    if (!table) return;
    const tbody = table.querySelector("tbody");
    if (!tbody) return;

    const sortState = getSortState(stateRoot || {}, defaultSort);
    const accessors = Object.fromEntries(columns.map(col => [col.sortKey || col.id, col.accessor || (row => row[col.id])])); 
    const sortedRows = Array.isArray(rows)
      ? [...rows].sort((a, b) => compareRows(a, b, sortState.sortBy, sortState.sortDir, accessors))
      : [];

    tbody.innerHTML = "";
    if (!sortedRows.length) {
      const colSpan = Math.max(columns.length + (rowActions ? 1 : 0), 1);
      tbody.appendChild(createEl("tr", {}, createEl("td", { colspan: colSpan }, emptyText)));
    } else {
      sortedRows.forEach((row, idx) => {
        const tr = createEl("tr", { class: typeof rowClass === "function" ? rowClass(row, idx) : rowClass });
        tr.dataset.key = rowKey(row, idx);
        columns.forEach(col => {
          const value = col.render ? col.render(row, idx) : (row[col.id] ?? "");
          tr.appendChild(createEl("td", {}, value));
        });
        if (rowActions) {
          const actions = rowActions(row, idx);
          tr.appendChild(createEl("td", {}, actions));
        }
        if (typeof onRowRender === "function") {
          onRowRender(tr, row, idx);
        }
        tbody.appendChild(tr);
      });
    }

    applySortIndicators(tableSelector, sortState);
  }

  window.TableSortHelper = Object.freeze({
    getSortState,
    toggleSort,
    applySortIndicators,
    compareRows,
    attachSortHandlers,
    renderTable
  });
})();
