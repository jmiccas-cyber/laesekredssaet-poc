// Inventory module (Admin – Eksemplarer)

(function () {
  const StateLibStore = window.StateLibStore || {};
  const st = StateLibStore.st || window.st;
  const $ = StateLibStore.$ || window.$;
  const showMsg = StateLibStore.showMsg || window.showMsg || (() => {});
  const el = StateLibStore.el || window.el;
  const setActiveButtonState = StateLibStore.setActiveButtonState || window.setActiveButtonState;
  const ExcelHelper = window.ExcelHelper || null;

// 6. Admin – Eksemplarer (tbl_beholdning)
// ----------------------------------------------------------
// 6. Admin Ã¢â‚¬â€œ Eksemplarer (tbl_beholdning)
// ----------------------------------------------------------

async function eksCount() {
  if (!sb || !st.profile.adminCentralId) return 0;
  let q = sb.from("tbl_beholdning").select("*", { count: "exact", head: true })
    .eq("owner_bibliotek_id", st.profile.adminCentralId);
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
    .select("barcode,title,author,isbn,faust,aktiv")
    .eq("owner_bibliotek_id", st.profile.adminCentralId);

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

  const sortMap = {
    barcode: "barcode",
    title: "title",
    author: "author",
    isbn: "isbn",
    faust: "faust"
  };
  const sortKey = sortMap[st.eks.sortBy] || "barcode";
  const ascending = st.eks.sortDir !== "desc";
  q = q.order(sortKey, { ascending });
  if (sortKey !== "barcode") {
    q = q.order("barcode", { ascending: true });
  }

  q = q.range(from, to);

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
    const suffix = dirtyCount > 1 ? "ÃƒÂ¦ndringer" : "ÃƒÂ¦ndring";
    btn.textContent = `Gem ${dirtyCount} ${suffix}`;
  } else {
    btn.textContent = "Gem alle ÃƒÂ¦ndringer";
  }
}

async function loadInventorySummary() {
  if (!sb) return;

  const { data, error } = await sb
    .from("tbl_beholdning")
    .select("owner_bibliotek_id,isbn,title,author,faust,aktiv")
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
    } else {
      if (!aggregates[key].title && row.title) aggregates[key].title = row.title;
      if (!aggregates[key].author && row.author) aggregates[key].author = row.author;
      if (!aggregates[key].faust && row.faust) aggregates[key].faust = row.faust;
    }
    if (row.aktiv !== false) {
      aggregates[key].count++;
    }
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

  window.StoreRegistry?.getStore?.("SaetStore")?.refreshSaetInventoryControls?.();
  window.StoreRegistry?.getStore?.("SaetStore")?.refreshSaetAvailabilityIndicators?.();
}

async function syncSaetMetadataFromIsbns(isbns) {
  if (!sb) return;
  const unique = Array.from(
    new Set(
      (isbns || [])
        .map(isbn => (isbn || "").trim())
        .filter(Boolean)
    )
  );
  if (!unique.length) return;

  const { data, error } = await sb
    .from("tbl_beholdning")
    .select("isbn,title,author,faust")
    .in("isbn", unique);
  if (error) {
    console.error("Fejl ved syncSaetMetadataFromIsbns:", error);
    return;
  }

  const metaMap = {};
  (data || []).forEach(row => {
    const isbn = (row.isbn || "").trim();
    if (!isbn || metaMap[isbn]) return;
    metaMap[isbn] = {
      title: row.title || "",
      author: row.author || "",
      faust: row.faust || ""
    };
  });
  const entries = Object.entries(metaMap);
  if (!entries.length) return;

  let anyUpdated = false;
  for (const [isbn, meta] of entries) {
    const { error: updError } = await sb
      .from("tbl_saet")
      .update({
        title: meta.title,
        author: meta.author,
        faust: meta.faust
      })
      .eq("isbn", isbn);
    if (updError) {
      console.error("Kunne ikke opdatere sÃ¦t for ISBN", isbn, updError);
    } else {
      anyUpdated = true;
    }
  }

  if (anyUpdated && $("#tab-saet")?.classList.contains("active")) {
    await saetPull();
  }
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

async function fetchOwnerBarcodes(ownerId) {
  if (!sb || !ownerId) return new Map();
  const { data, error } = await sb
    .from("tbl_beholdning")
    .select("barcode,isbn")
    .eq("owner_bibliotek_id", ownerId);
  if (error) {
    showMsg("#msg", "Kunne ikke hente eksisterende eksemplarer: " + error.message);
    return null;
  }
  const map = new Map();
  (data || []).forEach(row => {
    if (!row.barcode) return;
    map.set(row.barcode, row.isbn || "");
  });
  return map;
}

async function fetchOwnerSetMap(ownerId) {
  if (!sb || !ownerId) return new Map();
  const { data, error } = await sb
    .from("tbl_saet")
    .select("set_id,isbn,requested_count")
    .eq("owner_bibliotek_id", ownerId);
  if (error) {
    showMsg("#msgSaet", "Kunne ikke hente eksisterende sÃ¦t: " + error.message);
    return null;
  }
  const map = new Map();
  (data || []).forEach(row => {
    if (row.set_id != null) {
      map.set(String(row.set_id), row);
    }
  });
  return map;
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
    aktiv: tr.querySelector(".active-flag")?.dataset.value !== "false",
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
    const aktBtn = tr.querySelector(".active-flag");
    if (aktBtn) {
      setActiveButtonState(aktBtn, original.aktiv === false ? "false" : "true");
    }
    clearEksDirty(tr);
  } catch (e) {
    console.warn("Kunne ikke fortryde rÃƒÂ¦kke", e);
  }
}


async function eksSaveAll() {
  if (!sb) return;
  if (!st.profile.adminCentralId) {
    showMsg("#msg", "VÃƒÂ¦lg fÃƒÂ¸rst en admin-profil.");
    return;
  }
  const dirtyRows = eksDirtyRows();
  if (!dirtyRows.length) {
    showMsg("#msg", "Der er ingen ÃƒÂ¦ndringer at gemme.");
    return;
  }

  const payload = [];
  for (const tr of dirtyRows) {
    const rec = eksCollectRow(tr);
    const err = eksValidate(rec || {});
    if (err) {
      showMsg("#msg", `Fejl i rÃƒÂ¦kke (${rec?.barcode || "ny"}): ${err}`);
      tr.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    payload.push(rec);
  }

  showMsg("#msg", "Gemmer ÃƒÂ¦ndringer...");
  const { error } = await sb.from("tbl_beholdning").upsert(payload, { onConflict: "barcode" });
  if (error) {
    showMsg("#msg", "Fejl ved gem: " + error.message);
    return;
  }

  showMsg("#msg", `Gemte ${payload.length} ÃƒÂ¦ndring${payload.length > 1 ? "er" : ""}.`, true);
  await eksPull();
  await loadInventorySummary();
  await syncSaetMetadataFromIsbns(payload.map(r => r.isbn));
}

function eksValidate(r) {
  if (!r.barcode) return "Stregkode skal udfyldes";
  if (!r.title) return "Titel skal udfyldes";
  if (typeof r.aktiv !== "boolean") {
    r.aktiv = true;
  }
  return null;
}

async function exportEksToExcel() {
  if (!sb) return;
  const ownerId = currentAdminId();
  if (!ownerId) {
    showMsg("#msg", "VÃ¦lg fÃ¸rst en admin-profil (centralbibliotek) via Skift: Admin â†” Booker.");
    return;
  }

  showMsg("#msg", "Henter eksemplarer til Excel â€¦");
  const { data, error } = await sb
    .from("tbl_beholdning")
    .select("barcode,title,author,isbn,faust,aktiv")
    .eq("owner_bibliotek_id", ownerId)
    .order("barcode");

  if (error) {
    showMsg("#msg", "Kunne ikke hente eksemplarer: " + error.message);
    return;
  }

  const rows = (data || []).map(row => ({
    Handling: "Opdater",
    Barcode: row.barcode || "",
    Titel: row.title || "",
    Forfatter: row.author || "",
    ISBN: row.isbn || "",
    FAUST: row.faust || "",
    Aktiv: row.aktiv === false ? "Inaktiv" : "Aktiv"
  }));

  if (!ExcelHelper) {
    showMsg("#msg", "Excel-helper mangler. PrÃ¸v at genindlÃ¦se siden.");
    return;
  }
  try {
    await ExcelHelper.exportRows({
      rows,
      sheetName: "Eksemplarer",
      fileName: `eksemplarer_${ownerId}.xlsx`,
      emptyRowTemplate: {
        Handling: "Opdater",
        Barcode: "",
        Titel: "",
        Forfatter: "",
        ISBN: "",
        FAUST: "",
        Aktiv: "Aktiv"
      },
      messageSelector: "#msg",
      beforeText: null,
      successText: "Excel klar til download."
    });
  } catch (err) {
    showMsg("#msg", err.message || "Kunne ikke generere Excel.");
  }
}

async function importEksFromExcel(file) {
  if (!sb || !file) return;
  const ownerId = currentAdminId();
  if (!ownerId) {
    showMsg("#msg", "VÃ¦lg fÃ¸rst en admin-profil (centralbibliotek) via Skift: Admin â†” Booker.");
    return;
  }

  if (!ExcelHelper) {
    showMsg("#msg", "Excel-helper mangler. PrÃ¸v at genindlÃ¦se siden.");
    return;
  }
  let rows;
  try {
    rows = await ExcelHelper.readSheetRows(file, {
      messageSelector: "#msg",
      loadingText: "IndlÃ¦ser Excel â€¦",
      emptySheetText: "Excel-arket er tomt."
    });
  } catch (err) {
    return;
  }
  if (!rows.length) {
    return;
  }

  await loadInventorySummary();
  const usageMap = await fetchSaetUsage();
  st.saet.usage = usageMap;
  const existing = await fetchOwnerBarcodes(ownerId);

  const updates = [];
  const deletions = [];
  const seen = new Set();
  const { failures } = ExcelHelper.processActionRows(rows, {
    columnMap: {
      action: ["Handling", "handling", "Action"],
      barcode: ["Barcode", "barcode", "Stregkode"],
      title: ["Titel", "title"],
      author: ["Forfatter", "author"],
      isbn: ["ISBN", "isbn"],
      faust: ["FAUST", "faust"],
      active: ["Aktiv", "aktiv", "Active"]
    },
    defaultAction: "opdater",
    onRow: ({ action, values }) => {
      const barcode = String(values.barcode || "").trim();
      if (!barcode) {
        return "mangler stregkode.";
      }
      if (seen.has(barcode)) {
        return `stregkode ${barcode} er duplikeret i Excel.`;
      }
      seen.add(barcode);

      if (action === "slet" || action === "delete") {
        const isbn = existing.get(barcode);
        if (!isbn) {
          return `stregkode ${barcode} findes ikke i databasen.`;
        }
        deletions.push({ barcode, isbn });
        return;
      }

      if (action !== "opdater" && action !== "update") {
        return `ukendt handling "${action}". Brug Opdater eller Slet.`;
      }

      const activeRaw = String(values.active || "").trim().toLowerCase();
      let aktiv = true;
      if (activeRaw === "inaktiv" || activeRaw === "false" || activeRaw === "nej") {
        aktiv = false;
      } else if (activeRaw === "aktiv" || activeRaw === "true" || activeRaw === "ja") {
        aktiv = true;
      }

      const record = {
        barcode,
        title: String(values.title || "").trim(),
        author: String(values.author || "").trim(),
        isbn: String(values.isbn || "").trim(),
        faust: String(values.faust || "").trim(),
        aktiv,
        owner_bibliotek_id: ownerId
      };

      const validation = eksValidate(record);
      if (validation) {
        return validation;
      }
      updates.push(record);
    }
  });

  if (!updates.length && !deletions.length) {
    showMsg("#msg", failures[0] || "Ingen gyldige rÃ¦kker fundet.");
    return;
  }

  if (deletions.length) {
    const deleteByIsbn = {};
    deletions.forEach(({ isbn }) => {
      deleteByIsbn[isbn] = (deleteByIsbn[isbn] || 0) + 1;
    });
    const blocking = Object.entries(deleteByIsbn).filter(([isbn, count]) => {
      const available = getInventoryCount(ownerId, isbn);
      const reserved = Number(usageMap?.[ownerId]?.[isbn]) || 0;
      return available - count < reserved;
    });
    if (blocking.length) {
      const sample = blocking.slice(0, 5).map(([isbn, count]) =>
        `${isbn} (krÃ¦vet: ${Number(usageMap?.[ownerId]?.[isbn]) || 0}, tilbage efter sletning: ${Math.max(0, getInventoryCount(ownerId, isbn) - count)})`
      );
      showMsg("#msg", "Eksemplarer kan ikke slettes fÃ¸r tilhÃ¸rende sÃ¦t er nedtaget: " + sample.join(", "));
      return;
    }
    const confirmMsg = `Der er ${deletions.length} stregkoder markeret til sletning. Handlingen kan ikke fortrydes. FortsÃ¦t?`;
    if (!confirm(confirmMsg)) {
      showMsg("#msg", "Import annulleret.");
      return;
    }
  }

  const chunkSize = 100;
  let updatesDone = 0;
  for (let i = 0; i < updates.length; i += chunkSize) {
    const chunk = updates.slice(i, i + chunkSize);
    const { error } = await sb.from("tbl_beholdning").upsert(chunk, { onConflict: "barcode" });
    if (error) {
      showMsg("#msg", "Fejl ved import: " + error.message);
      return;
    }
    updatesDone += chunk.length;
  }

  let deletesDone = 0;
  for (let i = 0; i < deletions.length; i += chunkSize) {
    const chunk = deletions.slice(i, i + chunkSize);
    const { error } = await sb
      .from("tbl_beholdning")
      .delete()
      .eq("owner_bibliotek_id", ownerId)
      .in("barcode", chunk.map(d => d.barcode));
    if (error) {
      showMsg("#msg", "Fejl ved sletning: " + error.message);
      return;
    }
    deletesDone += chunk.length;
  }

  const parts = [];
  if (updatesDone) parts.push(`opdaterede ${updatesDone} eksemplarer`);
  if (deletesDone) parts.push(`slettede ${deletesDone}`);
  showMsg("#msg", parts.length ? `Import gennemfÃ¸rt: ${parts.join(", ")}.` : "Import gennemfÃ¸rt.", true);
  if (failures.length) {
    alert("FÃ¸lgende rÃ¦kker blev sprunget over:\n" + failures.join("\n"));
  }
  await eksPull();
  await loadInventorySummary();
  await syncSaetMetadataFromIsbns(updates.map(r => r.isbn));
}

async function eksPull() {
  if (!$("#tblEks tbody")) return;
  if (!st.profile.adminCentralId) {
    $("#tblEks tbody").innerHTML = "";
    $("#pinfo").textContent = "VÃƒÂ¦lg fÃƒÂ¸rst en admin-profil (centralbibliotek) via Skift: Admin Ã¢â€ â€ Booker.";
     updateEksSaveButton();
    return;
  }

  st.eks.total = await eksCount();
  const rows = await eksFetch();

  TableSortHelper.renderTable({
    tableSelector: "#tblEks",
    rows,
    columns: [
      {
        id: "barcode",
        accessor: row => row.barcode || "",
        render: row => el("span", { class: "bc-label" }, row.barcode || "")
      },
      {
        id: "title",
        accessor: row => (row.title || "").toLowerCase(),
        render: row => {
          const input = el("input", { class: "title", value: row.title || "" });
          input.addEventListener("input", () => {
            const tr = input.closest("tr");
            if (tr) markEksDirty(tr);
          });
          input.addEventListener("change", () => {
            const tr = input.closest("tr");
            if (tr) markEksDirty(tr);
          });
          return input;
        }
      },
      {
        id: "author",
        accessor: row => (row.author || "").toLowerCase(),
        render: row => {
          const input = el("input", { class: "author", value: row.author || "" });
          input.addEventListener("input", () => {
            const tr = input.closest("tr");
            if (tr) markEksDirty(tr);
          });
          input.addEventListener("change", () => {
            const tr = input.closest("tr");
            if (tr) markEksDirty(tr);
          });
          return input;
        }
      },
      {
        id: "isbn",
        accessor: row => row.isbn || "",
        render: row => {
          const input = el("input", { class: "isbn", value: row.isbn || "" });
          input.addEventListener("input", () => {
            const tr = input.closest("tr");
            if (tr) markEksDirty(tr);
          });
          input.addEventListener("change", () => {
            const tr = input.closest("tr");
            if (tr) markEksDirty(tr);
          });
          return input;
        }
      },
      {
        id: "faust",
        accessor: row => row.faust || "",
        render: row => {
          const input = el("input", { class: "faust", value: row.faust || "" });
          input.addEventListener("input", () => {
            const tr = input.closest("tr");
            if (tr) markEksDirty(tr);
          });
          input.addEventListener("change", () => {
            const tr = input.closest("tr");
            if (tr) markEksDirty(tr);
          });
          return input;
        }
      },
      {
        id: "aktiv",
        accessor: row => (row.aktiv === false ? "false" : "true"),
        render: row => {
          const btn = el("button", {
            class: "btn btn-small active-flag",
            type: "button"
          }, "");
          setActiveButtonState(btn, row.aktiv === false ? "false" : "true");
          btn.addEventListener("click", () => {
            const tr = btn.closest("tr");
            const next = btn.dataset.value === "true" ? "false" : "true";
            setActiveButtonState(btn, next);
            if (tr) markEksDirty(tr);
          });
          return btn;
        }
      }
    ],
    stateRoot: st.eks,
    defaultSort: { sortBy: "barcode", sortDir: "asc" },
    emptyText: "Ingen eksemplarer.",
    rowActions: row => {
      const btnReset = el("button", { class: "btn", type: "button" }, "Fortryd");
      btnReset.addEventListener("click", () => {
        const tr = btnReset.closest("tr");
        if (tr) eksRevertRow(tr);
      });
      const btnDel = el("button", { class: "btn", type: "button" }, "Slet");
      btnDel.addEventListener("click", () => {
        const tr = btnDel.closest("tr");
        if (tr) eksDeleteRow(tr);
      });
      return el("span", {}, btnReset, " ", btnDel);
    },
    onRowRender: (tr, row) => {
      tr.dataset.barcode = row.barcode || "";
      tr.dataset.original = JSON.stringify(row);
      eksAttachRowListeners(tr);
    }
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
  const ownerId = currentAdminId();
  const original = tr.dataset.original ? safeJsonParse(tr.dataset.original) : null;
  const isbn = (tr.querySelector(".isbn")?.value || original?.isbn || "").trim();

  if (ownerId && isbn) {
    const { count: available, error: countError } = await sb
      .from("tbl_beholdning")
      .select("barcode", { count: "exact", head: true })
      .eq("owner_bibliotek_id", ownerId)
      .eq("isbn", isbn)
      .eq("aktiv", true);
    if (countError) {
      showMsg("#msg", "Kunne ikke verificere beholdning: " + countError.message);
      return;
    }
    const usageMap = await fetchSaetUsage();
    st.saet.usage = usageMap;
    const reserved = Number(usageMap?.[ownerId]?.[isbn]) || 0;
    if ((available ?? 0) - 1 < reserved) {
      showMsg("#msg", `Eksemplarer for ISBN ${isbn} kan ikke slettes fÃ¸r tilhÃ¸rende sÃ¦t reduceres (krÃ¦vet: ${reserved}, tilbage efter sletning: ${(available ?? 0) - 1}).`);
      return;
    }
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
  const aktSel = el("button", { class: "btn btn-small active-flag", type: "button" }, "");
  setActiveButtonState(aktSel, "true");
  aktSel.addEventListener("click", () => {
    const next = aktSel.dataset.value === "true" ? "false" : "true";
    setActiveButtonState(aktSel, next);
    markEksDirty(tr);
  });

  const btnCancel = el("button", {
    class: "btn",
    onclick: () => {
      tr.remove();
      updateEksSaveButton();
    }
  }, "AnnullÃƒÂ©r");
  const info = el("span", { class: "hint" }, "Gem via knappen ovenfor");

  tr.append(
    el("td", {}, bcInput),
    el("td", {}, el("input", { class: "title" })),
    el("td", {}, el("input", { class: "author" })),
    el("td", {}, el("input", { class: "isbn" })),
    el("td", {}, el("input", { class: "faust" })),
    el("td", {}, aktSel),
    el("td", {}, info, " ", btnCancel)
  );
  tb.prepend(tr);
  eksAttachRowListeners(tr);
}

function bindEksControls() {
  $("#btnSearch")?.addEventListener("click", () => {
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
  const eksSortState = TableSortHelper.getSortState(st.eks, { sortBy: "barcode", sortDir: "asc" });
  TableSortHelper.attachSortHandlers("#tblEks", eksSortState, () => {
    st.eks.page = 0;
    eksPull();
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
  $("#btnEksExport")?.addEventListener("click", () => {
    exportEksToExcel();
  });
  $("#btnEksImport")?.addEventListener("click", () => {
    $("#eksImportFile")?.click();
  });
  $("#eksImportFile")?.addEventListener("change", evt => {
    const file = evt.target?.files?.[0];
    if (file) {
      importEksFromExcel(file);
    }
    evt.target.value = "";
  });
  updateEksSaveButton();
}

// ----------------------------------------------------------


// ----------------------------------------------------------

  const InventoryStore = Object.freeze({
    eksCount,
    eksFetch,
    eksPull,
    bindEksControls,
    loadInventorySummary,
    syncSaetMetadataFromIsbns,
    getOwnerInventory,
    fetchOwnerSetMap,
    getInventoryMeta,
    getInventoryCount,
    markEksDirty,
    clearEksDirty
  });

  window.InventoryStore = InventoryStore;
  Object.assign(window, {
    loadInventorySummary,
    eksPull,
    bindEksControls,
    syncSaetMetadataFromIsbns,
    getOwnerInventory,
    fetchOwnerSetMap,
    getInventoryMeta,
    getInventoryCount,
    markEksDirty,
    clearEksDirty
  });
  window.StoreRegistry?.registerStore?.("InventoryStore", InventoryStore);
})();
const InventoryStore = window.InventoryStore || {};
InventoryStore.init?.({ state: StateLibStore.st, getSupabaseClient: StateLibStore.getSupabaseClient, uiHelpers: { showMsg, el, $ } });
