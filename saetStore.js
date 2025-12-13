// 7. Admin – Sæt (tbl_saet)
// ----------------------------------------------------------

// 7. Admin sæt (tbl_saet)
// ----------------------------------------------------------
(function () {
  const StateLibStore = window.StateLibStore || {};
  const st = StateLibStore.st || window.st;
  const $ = StateLibStore.$ || window.$;
  const el = StateLibStore.el || window.el;
  const InventoryStore = window.InventoryStore || {};
  const getInventoryCount = InventoryStore.getInventoryCount || window.getInventoryCount || (() => 0);
  const getInventoryMeta = InventoryStore.getInventoryMeta || window.getInventoryMeta || (() => null);
  const getOwnerInventory = InventoryStore.getOwnerInventory || window.getOwnerInventory || (() => []);
  const fetchOwnerSetMap = InventoryStore.fetchOwnerSetMap || window.fetchOwnerSetMap || (async () => new Map());
  const loadInventorySummary = InventoryStore.loadInventorySummary || window.loadInventorySummary || (async () => {});
  const showMsg = window.showMsg || (() => {});
  const ExcelHelper = window.ExcelHelper || null;
  const currentAdminId = window.currentAdminId || (() => "");
  let saetBookingModeSupported = true;

  function saetIsBookingModeError(error) {
    return !!(error?.message && /booking_mode/i.test(error.message));
  }

  async function saetSelectWithMode(buildQuery) {
    const tryInclude = saetBookingModeSupported;
    let result = await buildQuery(tryInclude);
    if (result.error && (saetIsBookingModeError(result.error) || tryInclude)) {
      saetBookingModeSupported = false;
      result = await buildQuery(false);
    }
    return result;
  }

async function fetchSaetUsage() {
  if (!sb) return {};
  const { data, error } = await sb
    .from("tbl_saet")
    .select("owner_bibliotek_id,isbn,requested_count");

  if (error) {
    console.error("Fejl ved fetchSaetUsage:", error);
    return {};
  }

  const usage = {};
  (data || []).forEach(row => {
    const owner = row.owner_bibliotek_id || "";
    if (!owner || !row.isbn) return;
    if (!usage[owner]) usage[owner] = {};
    usage[owner][row.isbn] = (usage[owner][row.isbn] || 0) + (Number(row.requested_count) || 0);
  });
  return usage;
}

function saetUsageFor(ownerId, isbn) {
  if (!ownerId || !isbn) return 0;
  return Number(st.saet.usage?.[ownerId]?.[isbn]) || 0;
}

function saetValidate(r, opts = {}) {
  const bookingMode = (r.booking_mode || "advanced").toLowerCase();
  if (!r.title) return "Titel skal udfyldes";
  if (!r.visibility || !["national", "regional"].includes(r.visibility.toLowerCase())) {
    return "Synlighed skal være national eller regional";
  }
  if (!r.owner_bibliotek_id) return "Ejer (centralbibliotek) skal udfyldes";
  if (!r.isbn) return "Vælg et ISBN fra beholdningen";
  if (r.requested_count <= 0) return "Et sæt skal indeholde mindst 1 eksemplar";
  if (bookingMode !== "simple" && (r.loan_weeks < 1 || r.loan_weeks > 12)) {
    return "Bookingperioden skal være mellem 1 og 12 uger";
  }
  if (r.buffer_days < 0 || r.min_delivery < 0) {
    return "Talværdier må ikke være negative";
  }
  if (opts.ownerId && opts.desiredCount != null) {
    const available = getInventoryCount(opts.ownerId, r.isbn);
    const source = opts.usageOverride?.[opts.ownerId]?.[r.isbn];
    const used = source != null ? source : saetUsageFor(opts.ownerId, r.isbn);
    const savedCount = opts.savedCount || 0;
    const otherUsed = Math.max(0, used - savedCount);
    const remaining = available - otherUsed;
    if (opts.desiredCount > remaining) {
      return `Der er kun ${Math.max(0, remaining)} eksemplarer tilbage af ISBN ${r.isbn}. (${available} i alt, ${otherUsed} bruges i andre sæt)`;
    }
  }
  return null;
}

async function exportSaetToExcel() {
  if (!sb) return;
  const ownerId = st.saet.owner || currentAdminId();
  if (!ownerId) {
    
    return;
  }

  
  const { data, error } = await saetSelectWithMode(includeMode => {
    const columns = includeMode
      ? "set_id,title,author,isbn,faust,requested_count,loan_weeks,buffer_days,visibility,owner_bibliotek_id,active,allow_substitution,allow_partial,min_delivery,notes,booking_mode"
      : "set_id,title,author,isbn,faust,requested_count,loan_weeks,buffer_days,visibility,owner_bibliotek_id,active,allow_substitution,allow_partial,min_delivery,notes";
    return sb
      .from("tbl_saet")
      .select(columns)
      .eq("owner_bibliotek_id", ownerId)
      .order("set_id");
  });

  if (error) {
    
    return;
  }

  const rows = (data || []).map(row => ({
    Handling: "Opdater",
    ID: row.set_id || "",
    Titel: row.title || "",
    Forfatter: row.author || "",
    ISBN: row.isbn || "",
    FAUST: row.faust || "",
    requested_count: row.requested_count ?? "",
    loan_weeks: row.loan_weeks ?? "",
    buffer_days: row.buffer_days ?? "",
    booking_mode: row.booking_mode || "advanced",
    visibility: row.visibility || "national",
    active: row.active ? "true" : "false",
    allow_substitution: row.allow_substitution ? "true" : "false",
    allow_partial: row.allow_partial ? "true" : "false",
    min_delivery: row.min_delivery ?? "",
    notes: row.notes || ""
  }));

  if (!ExcelHelper) {
    
    return;
  }
  try {
    await ExcelHelper.exportRows({
      rows,
      sheetName: "Sæt",
      fileName: `saet_${ownerId}.xlsx`,
      emptyRowTemplate: {
        Handling: "Opdater",
        ID: "",
        Titel: "",
        Forfatter: "",
        ISBN: "",
        FAUST: "",
        requested_count: "",
        loan_weeks: "",
        buffer_days: "",
        booking_mode: "advanced",
        visibility: "national",
        active: "true",
        allow_substitution: "false",
        allow_partial: "false",
        min_delivery: "",
        notes: ""
      },
      messageSelector: "#msgSaet",
      beforeText: null,
      successText: "Excel med sæt er klar."
    });
  } catch (err) {
    
  }
}

async function importSaetFromExcel(file) {
  if (!sb || !file) return;
  const ownerId = st.saet.owner || currentAdminId();
  if (!ownerId) {
    
    return;
  }

  if (!ExcelHelper) {
    
    return;
  }
  let rows;
  try {
    rows = await ExcelHelper.readSheetRows(file, {
      messageSelector: "#msgSaet",
      loadingText: "Indlæser Excel …",
      emptySheetText: "Excel-arket er tomt."
    });
  } catch (err) {
    return;
  }
  if (!rows.length) {
    return;
  }

  await loadInventorySummary();
  const latestUsage = await fetchSaetUsage();
  st.saet.usage = latestUsage;
  const usageOverride = JSON.parse(JSON.stringify(latestUsage || {}));
  const existingSets = await fetchOwnerSetMap(ownerId);
  if (existingSets === null) return;

  const updates = [];
  const deletions = [];
  const seenIds = new Set();
  const toNumber = (val, fallback = 0) => {
    if (val === "" || val == null) return fallback;
    const num = Number(val);
    return Number.isFinite(num) ? num : fallback;
  };
  const toBool = (val, fallback = false) => {
    const str = String(val).trim().toLowerCase();
    if (!str) return fallback;
    if (["true", "ja", "1", "x"].includes(str)) return true;
    if (["false", "nej", "0"].includes(str)) return false;
    return fallback;
  };
  const { failures } = ExcelHelper.processActionRows(rows, {
    columnMap: {
      action: ["Handling", "handling", "Action"],
      set_id: ["ID", "set_id"],
      title: ["Titel", "title"],
      author: ["Forfatter", "author"],
      isbn: ["ISBN", "isbn"],
      faust: ["FAUST", "faust"],
      requested_count: ["requested_count", "eksemplarer"],
      loan_weeks: ["loan_weeks", "uger"],
      buffer_days: ["buffer_days", "buffer"],
      booking_mode: ["booking_mode", "bookingmode", "booking_model"],
      min_delivery: ["min_delivery", "mindste"],
      visibility: ["visibility", "synlighed"],
      active: ["active", "aktiv"],
      allow_substitution: ["allow_substitution", "substitution"],
      allow_partial: ["allow_partial", "partial"],
      notes: ["notes", "Noter"]
    },
    defaultAction: "opdater",
    onRow: ({ action, values }) => {
      const idRaw = String(values.set_id || "").trim();
      let setId = null;
      if (idRaw) {
        setId = Number(idRaw);
        if (!Number.isFinite(setId)) {
          return "ID er ikke et tal.";
        }
        if (seenIds.has(setId)) {
          return `ID ${setId} er duplikeret i Excel.`;
        }
        seenIds.add(setId);
      }

      if (action === "slet" || action === "delete") {
        if (!setId) {
          return "Handling=Slet kræver et ID.";
        }
        if (!existingSets.has(String(setId))) {
          return `Sæt ID ${setId} findes ikke.`;
        }
        deletions.push(setId);
        return;
      }

      if (action !== "opdater" && action !== "update") {
        return `ukendt handling "${action}". Brug Opdater eller Slet.`;
      }

      const requested_count = toNumber(values.requested_count, 0);
      const loan_weeks = toNumber(values.loan_weeks, 8);
      const buffer_days = toNumber(values.buffer_days, 0);
      const booking_mode_raw = String(values.booking_mode || "").trim().toLowerCase();
      const booking_mode = booking_mode_raw === "simple" ? "simple" : "advanced";
      const min_delivery = toNumber(values.min_delivery, 0);
      let visibility = String(values.visibility || "").trim().toLowerCase() || "national";
      if (!["national", "regional"].includes(visibility)) visibility = "national";
      const active = toBool(values.active, true);
      const allow_substitution = toBool(values.allow_substitution, false);
      const allow_partial = toBool(values.allow_partial, false);

      const record = {
        set_id: setId || undefined,
        title: String(values.title || "").trim(),
        author: String(values.author || "").trim(),
        isbn: String(values.isbn || "").trim(),
        faust: String(values.faust || "").trim(),
        requested_count,
        loan_weeks,
        buffer_days,
        booking_mode,
        visibility,
        owner_bibliotek_id: ownerId,
        active,
        allow_substitution,
        allow_partial,
        min_delivery,
        notes: String(values.notes || "").trim()
      };

      const existing = setId ? existingSets.get(String(setId)) : null;
      if (setId && !existing) {
        return `Sæt ID ${setId} findes ikke.`;
      }
      if (existing && existing.isbn && existing.isbn !== record.isbn) {
        return `Sæt ID ${setId} kan ikke ændre ISBN.`;
      }

      const savedCount = existing ? Number(existing.requested_count) || 0 : 0;
      const validation = saetValidate(record, {
        ownerId,
        desiredCount: record.requested_count,
        savedCount,
        usageOverride
      });
      if (validation) {
        return validation;
      }

      if (!usageOverride[ownerId]) usageOverride[ownerId] = {};
      const currentTotal = usageOverride[ownerId][record.isbn] ?? saetUsageFor(ownerId, record.isbn);
      usageOverride[ownerId][record.isbn] = (currentTotal - savedCount) + record.requested_count;

      updates.push(record);
    }
  });

  if (!updates.length && !deletions.length) {
    
    return;
  }

  if (deletions.length) {
    const confirmMsg = `Der er ${deletions.length} sæt markeret til sletning. Handlingen kan ikke fortrydes. Fortsæt?`;
    if (!confirm(confirmMsg)) {
      
      return;
    }
  }

  let upsertsDone = 0;
  if (updates.length) {
    try {
      const result = await SupabaseHelper.processChunks(updates, 100, async chunk => {
        const { error } = await sb.from("tbl_saet").upsert(chunk, { onConflict: "set_id" });
        if (error) throw error;
      });
      upsertsDone = result?.processed || 0;
    } catch (error) {
      
      return;
    }
  }

  let deletesDone = 0;
  if (deletions.length) {
    try {
      const result = await SupabaseHelper.processChunks(deletions, 100, async chunk => {
        const { error } = await sb
          .from("tbl_saet")
          .delete()
          .eq("owner_bibliotek_id", ownerId)
          .in("set_id", chunk);
        if (error) throw error;
      });
      deletesDone = result?.processed || 0;
    } catch (error) {
      
      return;
    }
  }

  const parts = [];
  if (upsertsDone) parts.push(`opdaterede ${upsertsDone} sæt`);
  if (deletesDone) parts.push(`slettede ${deletesDone} sæt`);
  saetSetMsg( parts.length ? `Import gennemført: ${parts.join(", ")}.` : "Import gennemført.", true);
  if (failures.length) {
    alert("Følgende rækker blev sprunget over:\n" + failures.join("\n"));
  }
  await saetPull();
}

function populateSaetIsbnSelect(selectEl, ownerId, selectedIsbn) {
  if (!selectEl) return;
  const inventory = getOwnerInventory(ownerId);
  selectEl.innerHTML = "";

  if (!inventory.length) {
    selectEl.appendChild(el("option", { value: "" }, "(ingen titler i beholdningen)"));
    if (selectedIsbn) {
      selectEl.appendChild(el("option", { value: selectedIsbn }, `${selectedIsbn} (ikke i beholdning)`));
      selectEl.value = selectedIsbn;
      selectEl.disabled = false;
    } else {
      selectEl.value = "";
      selectEl.disabled = true;
    }
    return;
  }

  selectEl.disabled = false;
  selectEl.appendChild(el("option", { value: "" }, "(vælg ISBN)"));
  inventory.forEach(meta => {
    const label = `${meta.isbn || ""} – ${meta.title || "(uden titel)"} – ${meta.author || ""} – ${meta.faust || ""}`;
    selectEl.appendChild(el("option", { value: meta.isbn }, label));
  });

  if (selectedIsbn && !inventory.some(m => m.isbn === selectedIsbn)) {
    selectEl.appendChild(el("option", { value: selectedIsbn }, `${selectedIsbn} (ikke i beholdning)`));
  }
  selectEl.value = selectedIsbn || "";
}

function applyInventoryMeta(tr, ownerId, isbn, force = false) {
  const meta = getInventoryMeta(ownerId, isbn);
  if (!meta) return;
  const titleEl = tr.querySelector(".saet-title");
  const authorEl = tr.querySelector(".saet-author");
  const faustEl = tr.querySelector(".saet-faust");
  const isbnField = tr.querySelector(".saet-isbn-field");

  if (titleEl && (force || !titleEl.value)) titleEl.value = meta.title || "";
  if (authorEl && (force || !authorEl.value)) authorEl.value = meta.author || "";
  if (faustEl && (force || !faustEl.value)) faustEl.value = meta.faust || "";
  if (isbnField) isbnField.value = isbn || "";
}

function updateSaetAvailability(tr) {
  if (!tr) return;
  const ownerId = tr.querySelector(".saet-owner")?.value || "";
  const isbn = tr.querySelector(".saet-isbn")?.value || "";
  const reqInput = tr.querySelector(".saet-requested");
  const hint = tr.querySelector(".saet-availability");
  if (!reqInput || !hint) return;

  const savedCount = Number(tr.dataset.savedCount || 0);
  if (!ownerId || !isbn) {
    hint.title = "VÃ¦lg fÃ¸rst ejer og ISBN.";
    hint.dataset.state = "error";
    reqInput.max = "";
    return;
  }

  const available = getInventoryCount(ownerId, isbn);
  const usedTotal = saetUsageFor(ownerId, isbn);
  const otherUsed = Math.max(0, usedTotal - savedCount);
  const remaining = available - otherUsed;
  const maxForRow = Math.max(0, remaining);
  const desired = Math.floor(Number(reqInput.value || 0));

  if (!available || maxForRow <= 0) {
    hint.title = available
      ? `Andre sÃ¦t bruger ${otherUsed} af ${available} eksemplarer. Der er ingen ledige tilbage.`
      : "Ingen eksemplarer i beholdningen med dette ISBN.";
    hint.dataset.state = "error";
    reqInput.max = maxForRow || 0;
    return;
  }

  if (desired > maxForRow) {
    hint.title = `Du har valgt ${desired}, men der er kun ${maxForRow} ledige (${available} total, ${otherUsed} bruges af andre sÃ¦t).`;
    hint.dataset.state = "warning";
  } else {
    hint.title = `Andre sÃ¦t bruger ${otherUsed} af ${available} eksemplarer. Max til dette sÃ¦t: ${maxForRow}.`;
    hint.dataset.state = "ok";
  }
  reqInput.max = maxForRow || "";
}

function saetDirtyRows() {
  return Array.from(document.querySelectorAll("#tblSaet tbody tr"))
    .filter(tr => tr.dataset.dirty === "1");
}

function saetApplyBookingMode(tr) {
  if (!tr) return;
  const modeSel = tr.querySelector(".saet-mode");
  const mode = (modeSel?.value || "advanced").toLowerCase();
  const isSimple = mode === "simple";
  const weeksInput = tr.querySelector(".saet-weeks");
  const bufferInput = tr.querySelector(".saet-buffer");
  [weeksInput, bufferInput].forEach(input => {
    if (!input) return;
    input.disabled = isSimple;
    input.classList.toggle("disabled", isSimple);
  });
  const hint = tr.querySelector(".saet-mode-hint");
  if (hint) {
    hint.textContent = isSimple ? "2 mdr fast periode" : "";
  }
}

function markSaetDirty(tr) {
  if (!tr) return;
  if (tr.dataset.dirty !== "1") {
    tr.dataset.dirty = "1";
    tr.classList.add("dirty");
    highlightSaveBar();
  }
  updateSaetSaveButton();
}

function clearSaetDirty(tr) {
  if (!tr) return;
  tr.dataset.dirty = "";
  tr.classList.remove("dirty");
  updateSaetSaveButton();
}

function updateSaetSaveButton() {
  const btn = document.getElementById("btnSaetSaveAll");
  if (!btn) return;
  const dirtyCount = saetDirtyRows().length;
  btn.disabled = dirtyCount === 0;
  if (dirtyCount > 0) {
    const suffix = dirtyCount === 1 ? "ændring" : "ændringer";
    btn.textContent = `Gem ${dirtyCount} ${suffix}`;
    btn.title = "";
  } else {
    btn.textContent = "Gem alle ændringer";
    btn.title = "";
  }
}

function saetAttachRowListeners(tr) {
  if (!tr) return;
  const controls = tr.querySelectorAll("input, select, textarea");
  controls.forEach(ctrl => {
    const handler = () => {
      markSaetDirty(tr);
      if (ctrl.classList.contains("saet-requested") ||
        ctrl.classList.contains("saet-isbn") ||
        ctrl.classList.contains("saet-owner")) {
        updateSaetAvailability(tr);
      }
      if (ctrl.classList.contains("saet-mode")) {
        saetApplyBookingMode(tr);
      }
    };
    ctrl.addEventListener("input", handler);
    ctrl.addEventListener("change", handler);
  });
  saetApplyBookingMode(tr);
}

function saetCollectRow(tr) {
  if (!tr) return null;
  const ownerId = tr.querySelector(".saet-owner")?.value || currentAdminId();
  const getVal = selector => (tr.querySelector(selector)?.value || "").trim();
  const toNumber = selector => {
    const raw = tr.querySelector(selector)?.value;
    const num = Number(raw);
    return Number.isFinite(num) ? num : 0;
  };
  const boolFromSelect = selector => (tr.querySelector(selector)?.value || "true") !== "false";
  return {
    set_id: tr.dataset.setId ? Number(tr.dataset.setId) : null,
    title: getVal(".saet-title"),
    author: getVal(".saet-author"),
    isbn: getVal(".saet-isbn"),
    faust: getVal(".saet-faust"),
    requested_count: toNumber(".saet-requested"),
    loan_weeks: toNumber(".saet-weeks"),
    buffer_days: toNumber(".saet-buffer"),
    booking_mode: (getVal(".saet-mode") || "advanced").toLowerCase(),
    visibility: (getVal(".saet-vis") || "national").toLowerCase(),
    owner_bibliotek_id: ownerId,
    active: boolFromSelect(".saet-active"),
    allow_substitution: boolFromSelect(".saet-sub"),
    allow_partial: boolFromSelect(".saet-part"),
    min_delivery: toNumber(".saet-min")
  };
}

async function saetSaveAll() {
  if (!sb) return;
  const dirtyRows = saetDirtyRows();
  if (!dirtyRows.length) {
    
    return;
  }

  const usageOverride = JSON.parse(JSON.stringify(st.saet.usage || {}));
  const ownerCache = {};
  const payload = [];

  for (const tr of dirtyRows) {
    const record = saetCollectRow(tr);
    if (!record) continue;
    if (!record.owner_bibliotek_id) {
      
      return;
    }

    let ownerSets = ownerCache[record.owner_bibliotek_id];
    if (!ownerSets) {
      ownerSets = await fetchOwnerSetMap(record.owner_bibliotek_id);
      if (ownerSets === null) {
        
        return;
      }
      ownerCache[record.owner_bibliotek_id] = ownerSets;
    }

    const savedCount = Number(tr.dataset.savedCount || ownerSets.get(String(record.set_id))?.requested_count || 0);
    const validation = saetValidate(record, {
      ownerId: record.owner_bibliotek_id,
      desiredCount: record.requested_count,
      savedCount,
      usageOverride
    });
    if (validation) {
      
      tr.scrollIntoView({ block: "center", behavior: "smooth" });
      tr.classList.add("error");
      setTimeout(() => tr.classList.remove("error"), 2000);
      return;
    }

    if (!usageOverride[record.owner_bibliotek_id]) {
      usageOverride[record.owner_bibliotek_id] = {};
    }
    const currentUsage = usageOverride[record.owner_bibliotek_id][record.isbn] ?? saetUsageFor(record.owner_bibliotek_id, record.isbn);
    usageOverride[record.owner_bibliotek_id][record.isbn] = (currentUsage - savedCount) + record.requested_count;

    payload.push({
      ...record,
      set_id: record.set_id || undefined
    });
  }

  if (!payload.length) {
    
    return;
  }

  
  const payloadToSave = saetBookingModeSupported ? payload : payload.map(record => {
    const { booking_mode, ...rest } = record;
    return rest;
  });

  const { error } = await sb.from("tbl_saet").upsert(payloadToSave, { onConflict: "set_id" });
  if (error) {
    
    return;
  }
  const ownersToRefresh = Array.from(new Set(payload.map(r => r.owner_bibliotek_id).filter(Boolean)));
  const bookingStore = window.BookingStore || {};
  if (ownersToRefresh.length && typeof bookingStore.regenerateBookingSlotsForOwner === "function") {
    try {
      await Promise.all(ownersToRefresh.map(id => bookingStore.regenerateBookingSlotsForOwner(id)));
    } catch (err) {
      console.warn("Kunne ikke regenerere booking-slots efter gem:", err);
    }
  }

  await saetPull();
}


function highlightSaveBar() {
  const bar = document.getElementById("saveNotice");
  if (!bar) return;
  bar.classList.add("visible");
  setTimeout(() => bar.classList.remove("visible"), 2500);
}

function refreshSaetInventoryControls() {
  $$("#tblSaet tbody tr").forEach(tr => {
    const ownerId = tr.querySelector(".saet-owner")?.value || "";
    const isbnSel = tr.querySelector(".saet-isbn");
    if (isbnSel) {
      const current = isbnSel.value;
      populateSaetIsbnSelect(isbnSel, ownerId, current);
    }
    updateSaetAvailability(tr);
  });
}


async function saetCount(ownerFilter) {
  if (!sb) return 0;
  let q = sb.from("tbl_saet").select("*", { count: "exact", head: true });
  const f = st.saet;
  const owner = ownerFilter || f.owner || currentAdminId();
  if (owner) q = q.eq("owner_bibliotek_id", owner);
  if (f.vis) q = q.eq("visibility", f.vis);
  if (f.q) {
    const v = f.q;
    q = q.or([
      `title.ilike.%${v}%`,
      `author.ilike.%${v}%`,
      `isbn.ilike.%${v}%`,
      `faust.ilike.%${v}%`
    ].join(","));
  }
  const { count, error } = await q;
  if (error) {
    
    return 0;
  }
  return count || 0;
}

async function saetFetch(ownerFilter) {
  if (!sb) return [];
  const from = st.saet.page * st.saet.pageSize;
  const to = from + st.saet.pageSize - 1;
  let baseQuery = () => sb.from("tbl_saet");
  let selectColumns = includeMode => includeMode
    ? "set_id,title,author,isbn,faust,requested_count,loan_weeks,buffer_days,visibility,owner_bibliotek_id,active,allow_substitution,allow_partial,min_delivery,notes,booking_mode"
    : "set_id,title,author,isbn,faust,requested_count,loan_weeks,buffer_days,visibility,owner_bibliotek_id,active,allow_substitution,allow_partial,min_delivery,notes";

  const f = st.saet;
  const owner = ownerFilter || f.owner || currentAdminId();
  const selectResult = await saetSelectWithMode(includeMode => {
    let q = baseQuery().select(selectColumns(includeMode));
    if (owner) q = q.eq("owner_bibliotek_id", owner);
    if (f.vis) q = q.eq("visibility", f.vis);
    if (f.q) {
      const v = f.q;
      q = q.or([
        `title.ilike.%${v}%`,
        `author.ilike.%${v}%`,
        `isbn.ilike.%${v}%`,
        `faust.ilike.%${v}%`
      ].join(","));
    }
    return q;
  });

  const { data, error } = selectResult;
  if (error) {
    
    return [];
  }
  return data || [];
}

async function saetPull() {
  const tb = $("#tblSaet tbody");
  if (!tb) return;

  if (!st.stock.list.length) {
    await loadInventorySummary();
  }

  const adminId = currentAdminId();
  const adminLib = st.libs.byId[adminId];
  const isSuper = isSuperLibrary(adminLib);
  const ownerWrap = $("#saetOwnerWrap");
  const ownerSel = $("#saetOwnerFilterSel");

  if (ownerWrap) ownerWrap.style.display = isSuper ? "" : "none";
  if (ownerSel) {
    if (isSuper) {
      if (!ownerSel.options.length) populateSaetOwnerSelect();
    } else {
      ownerSel.value = "";
    }
  }

  if (adminId && st.saet.ownerAdminId !== adminId) {
    st.saet.ownerAdminId = adminId;
    st.saet.owner = adminId;
    if (ownerSel) ownerSel.value = adminId;
  }

  let activeOwner = adminId || "";
  if (isSuper && ownerSel) {
    if (!ownerSel.value) ownerSel.value = adminId;
    activeOwner = ownerSel.value;
  }
  st.saet.owner = activeOwner;

  if (!activeOwner) {
    tb.innerHTML = "";
    $("#saetPinfo").textContent = "";
    
    return;
  }
  

  st.saet.vis = "";
  st.saet.q = $("#saetQ")?.value || "";

  const [usage, total, rows] = await Promise.all([
    fetchSaetUsage(),
    saetCount(activeOwner),
    saetFetch(activeOwner)
  ]);

  st.saet.usage = usage;
  st.saet.total = total;

  TableSortHelper.renderTable({
    tableSelector: "#tblSaet",
    rows,
    columns: [
      {
        id: "set_id",
        accessor: row => Number(row.set_id) || 0,
        render: row => String(row.set_id ?? "")
      },
      {
        id: "isbn",
        accessor: row => row.isbn || "",
        render: row => {
          const ownerVal = row.owner_bibliotek_id || st.saet.owner || currentAdminId();
          const isbnSel = el("select", { class: "saet-isbn" });
          const isbnField = el("input", { type: "text", class: "saet-isbn-field", value: row.isbn || "", readonly: true });
          const wrap = el("div", { class: "saet-isbn-wrap" }, isbnField, isbnSel);
          wrap.style.position = "relative";
          Object.assign(isbnSel.style, {
            position: "absolute",
            inset: "0",
            width: "100%",
            height: "100%",
            opacity: "0",
            cursor: "pointer",
            background: "transparent"
          });
          populateSaetIsbnSelect(isbnSel, ownerVal, row.isbn || "");
          const focusSelect = () => {
            isbnSel.focus();
            isbnSel.click();
          };
          isbnField.addEventListener("click", focusSelect);
          isbnField.addEventListener("focus", focusSelect);
          isbnSel.addEventListener("change", () => {
            const tr = isbnSel.closest("tr");
            const ownerId = tr?.querySelector(".saet-owner")?.value || ownerVal;
            applyInventoryMeta(tr, ownerId, isbnSel.value, true);
            updateSaetAvailability(tr);
            wrap.classList.remove("highlight");
          });
          return wrap;
        }
      },
      {
        id: "title",
        accessor: row => (row.title || "").toLowerCase(),
        render: row => el("input", { class: "saet-title", value: row.title || "", readonly: true })
      },
      {
        id: "author",
        accessor: row => (row.author || "").toLowerCase(),
        render: row => el("input", { class: "saet-author", value: row.author || "", readonly: true })
      },
      {
        id: "faust",
        accessor: row => row.faust || "",
        render: row => el("input", { class: "saet-faust", value: row.faust || "", style: "width:6ch", readonly: true })
      },
      {
        id: "requested_count",
        accessor: row => Number(row.requested_count) || 0,
        render: row => {
          const reqInput = el("input", {
            type: "number",
            class: "saet-requested",
            value: row.requested_count ?? 1,
            min: "1",
            style: "width:6ch"
          });
          const hint = el("span", { class: "saet-availability", title: "" }, "•");
          hint.dataset.state = "error";
          reqInput.addEventListener("input", () => {
            const tr = reqInput.closest("tr");
            if (tr) updateSaetAvailability(tr);
          });
          reqInput.addEventListener("change", () => {
            const tr = reqInput.closest("tr");
            if (tr) updateSaetAvailability(tr);
          });
          return el("span", {}, reqInput, " ", hint);
        }
      },
      {
        id: "booking_mode",
        accessor: row => (row.booking_mode || "advanced"),
        render: row => {
          const select = el("select", { class: "saet-mode" },
            el("option", { value: "advanced" }, "Avanceret"),
            el("option", { value: "simple" }, "Simpel (2 mdr)")
          );
          select.value = (row.booking_mode || "advanced").toLowerCase() === "simple" ? "simple" : "advanced";
          const hint = el("div", { class: "saet-mode-hint hint" }, select.value === "simple" ? "2 mdr" : "");
          return el("div", {}, select, hint);
        }
      },
      {
        id: "loan_weeks",
        accessor: row => Number(row.loan_weeks) || 0,
        render: row => el("input", {
          type: "number",
          class: "saet-weeks",
          value: row.loan_weeks ?? 8,
          min: "1",
          max: "12"
        })
      },
      {
        id: "buffer_days",
        accessor: row => Number(row.buffer_days) || 0,
        render: row => {
          const input = el("input", { type: "number", class: "saet-buffer", value: row.buffer_days ?? 0, min: "0", style: "width:6ch" });
          return el("div", { class: "buffer-wrap" }, input, " dg");
        }
      },
      {
        id: "visibility",
        accessor: row => row.visibility || "national",
        render: row => {
          const select = el("select", { class: "saet-vis" },
            el("option", { value: "national" }, "national"),
            el("option", { value: "regional" }, "regional")
          );
          select.value = (row.visibility || "national").toLowerCase();
          return select;
        }
      },
      {
        id: "owner",
        accessor: row => row.owner_bibliotek_id || "",
        render: row => {
          const ownerVal = row.owner_bibliotek_id || "";
          const ownerHidden = el("input", { type: "hidden", class: "saet-owner", value: ownerVal });
          const ownerLabel = el("span", { class: "saet-owner-label" }, fmtOwnerCity(st.libs.byId[ownerVal]) || ownerVal || "");
          return el("span", {}, ownerLabel, ownerHidden);
        }
      },
      {
        id: "active",
        accessor: row => (row.active ? "true" : "false"),
        render: row => {
          const select = el("select", { class: "saet-active" },
            el("option", { value: "true" }, "Ja"),
            el("option", { value: "false" }, "Nej")
          );
          select.value = row.active ? "true" : "false";
          return select;
        }
      },
      {
        id: "allow_substitution",
        accessor: row => (row.allow_substitution ? "true" : "false"),
        render: row => {
          const select = el("select", { class: "saet-sub" },
            el("option", { value: "true" }, "Ja"),
            el("option", { value: "false" }, "Nej")
          );
          select.value = row.allow_substitution ? "true" : "false";
          return select;
        }
      },
      {
        id: "allow_partial",
        accessor: row => (row.allow_partial ? "true" : "false"),
        render: row => {
          const select = el("select", { class: "saet-part" },
            el("option", { value: "true" }, "Ja"),
            el("option", { value: "false" }, "Nej")
          );
          select.value = row.allow_partial ? "true" : "false";
          return select;
        }
      },
      {
        id: "min_delivery",
        accessor: row => Number(row.min_delivery) || 0,
        render: row => el("input", { type: "number", class: "saet-min", value: row.min_delivery ?? 0, min: "0" })
      }
    ],
    stateRoot: st.saet,
    defaultSort: { sortBy: "set_id", sortDir: "asc" },
    emptyText: "Ingen sæt fundet.",
    rowActions: row => {
      const btn = el("button", { class: "btn btn-small", type: "button" }, "Slet");
      btn.addEventListener("click", () => {
        const tr = btn.closest("tr");
        if (tr) saetDeleteRow(tr);
      });
      return btn;
    },
    onRowRender: (tr, row) => {
      tr.dataset.setId = row.set_id ?? "";
      tr.dataset.savedCount = String(row.requested_count ?? 0);
      saetAttachRowListeners(tr);
      clearSaetDirty(tr);
      updateSaetAvailability(tr);
    }
  });
  updateSaetSaveButton();
  const totalPages = Math.ceil((st.saet.total || 0) / st.saet.pageSize);
  $("#saetPinfo").textContent = st.saet.total
    ? `Side ${st.saet.page + 1}/${totalPages} â€“ ${st.saet.total} sÃ¦t`
    : "Ingen sÃ¦t fundet";
}

function ensureSaetCapacity(ownerId, isbn, requestedCount, currentSetId, savedCount = 0, usageOverride) {
  const available = getInventoryCount(ownerId, isbn);
  if (!available) {
    return {
      ok: false,
      message: "Der er ingen eksemplarer i beholdningen med det valgte ISBN."
    };
  }

  const usageSource = usageOverride?.[ownerId]?.[isbn];
  const totalUsed = usageSource != null ? usageSource : saetUsageFor(ownerId, isbn);
  const otherUsed = Math.max(0, (totalUsed || 0) - savedCount);
  const maxForSet = available - otherUsed;

  if (requestedCount > maxForSet) {
    return {
      ok: false,
      message: `Der er ${available} eksemplarer og andre sÃ¦t bruger ${otherUsed}. Maksimalt ${Math.max(0, maxForSet)} til dette sÃ¦t.`
    };
  }

  return { ok: true };
}

async function saetDeleteRow(tr) {
  if (!sb) return;
  const setId = tr.dataset.setId;
  if (!setId) {
    tr.remove();
    updateSaetSaveButton();
    return;
  }
  if (!confirm("Slet sÃ¦t " + setId + "?")) return;
  const { error } = await sb.from("tbl_saet").delete().eq("set_id", Number(setId));
  if (error) {
    
  } else {
    
    await saetPull();
  }
}

function saetNewRow() {
  const tb = $("#tblSaet tbody");
  if (!tb) return;
  const tr = el("tr");
  tr.dataset.setId = "";
  tr.dataset.savedCount = "0";

  const ownerId = currentAdminId();
  if (!ownerId) {
    
    return;
  }

  const visSel = el("select", { class: "saet-vis" },
    el("option", { value: "national" }, "national"),
    el("option", { value: "regional" }, "regional")
  );
  visSel.value = "national";

  const ownerHidden = el("input", { type: "hidden", class: "saet-owner", value: ownerId });
  const ownerLabel = el("span", { class: "saet-owner-label" }, fmtOwnerCity(st.libs.byId[ownerId]) || ownerId);

  const isbnSel = el("select", { class: "saet-isbn" });
  const isbnField = el("input", { type: "text", class: "saet-isbn-field", readonly: true });
  const titleIn = el("input", { class: "saet-title", readonly: true });
  const authorIn = el("input", { class: "saet-author", readonly: true });
  const isbnWrap = el("div", { class: "saet-isbn-wrap" }, isbnField, isbnSel);
  isbnWrap.style.position = "relative";
  Object.assign(isbnSel.style, {
    position: "absolute",
    inset: "0",
    width: "100%",
    height: "100%",
    opacity: "0",
    cursor: "pointer",
    background: "transparent"
  });
  populateSaetIsbnSelect(isbnSel, ownerId, "");

  const activeSel = el("select", { class: "saet-active" },
    el("option", { value: "true" }, "Ja"),
    el("option", { value: "false" }, "Nej")
  );
  activeSel.value = "true";

  const subSel = el("select", { class: "saet-sub" },
    el("option", { value: "true" }, "Ja"),
    el("option", { value: "false" }, "Nej")
  );
  subSel.value = "false";

  const partSel = el("select", { class: "saet-part" },
    el("option", { value: "true" }, "Ja"),
    el("option", { value: "false" }, "Nej")
  );
  partSel.value = "false";

  const btnCancel = el("button", {
    class: "btn btn-small",
    onclick: () => {
      tr.remove();
      updateSaetSaveButton();
    }
  }, "AnnullÃ©r");
  if (isbnSel.disabled) {
    const saveBtn = $("#btnSaetSaveAll");
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.title = "Ingen titler i beholdningen for det valgte centralbibliotek.";
    }
  }

  const reqIn = el("input", { type: "number", class: "saet-requested", value: "1", min: "1", style: "width:6ch" });
  const reqHint = el("span", { class: "saet-availability", title: "" }, "â—");
  reqHint.dataset.state = "error";
  const modeSel = el("select", { class: "saet-mode" },
    el("option", { value: "advanced" }, "Avanceret"),
    el("option", { value: "simple" }, "Simpel (2 mdr)")
  );
  modeSel.value = "advanced";
  const modeHint = el("div", { class: "saet-mode-hint hint" }, "");
  const modeWrap = el("div", {}, modeSel, modeHint);
  const weeksIn = el("input", { type: "number", class: "saet-weeks", value: "8", min: "1", max: "12" });
  const bufferIn = el("input", { type: "number", class: "saet-buffer", value: "0", min: "0", style: "width:6ch" });
  const bufferWrap = el("div", { class: "buffer-wrap" }, bufferIn, " dg");
  const minIn = el("input", { type: "number", class: "saet-min", value: "0", min: "0" });

  tr.append(
    el("td", {}, ""), // ID (autoincrement)
    el("td", {}, isbnWrap),
    el("td", {}, titleIn),
    el("td", {}, authorIn),
    el("td", {}, el("input", { class: "saet-faust", style: "width:6ch", readonly: true })),
    el("td", {}, reqIn, " ", reqHint),
    el("td", {}, modeWrap),
    el("td", {}, weeksIn),
    el("td", {}, bufferWrap),
    el("td", {}, visSel),
    el("td", {}, ownerLabel, ownerHidden),
    el("td", {}, activeSel),
    el("td", {}, subSel),
    el("td", {}, partSel),
    el("td", {}, minIn),
    el("td", {}, btnCancel)
  );
  tb.prepend(tr);
  saetAttachRowListeners(tr);
  markSaetDirty(tr);

  isbnSel.addEventListener("change", () => {
    applyInventoryMeta(tr, ownerId, isbnSel.value, true);
    updateSaetAvailability(tr);
    isbnWrap.classList.remove("highlight");
  });
  const focusSelect = () => {
    isbnSel.focus();
    isbnSel.click();
  };
  isbnField.addEventListener("click", focusSelect);
  isbnField.addEventListener("focus", focusSelect);
  reqIn.addEventListener("input", () => updateSaetAvailability(tr));
  reqIn.addEventListener("change", () => updateSaetAvailability(tr));
  updateSaetAvailability(tr);
  isbnWrap.classList.add("highlight");
}

function bindSaetControls() {
  $("#btnSaetSearch")?.addEventListener("click", () => {
    st.saet.page = 0;
    saetPull();
  });
  $("#btnSaetSaveAll")?.addEventListener("click", () => {
    saetSaveAll();
  });
  $("#btnSaetMine")?.addEventListener("click", () => {
    const adminId = currentAdminId();
    if (!adminId) {
      
      return;
    }
    st.saet.owner = adminId;
    st.saet.ownerAdminId = adminId;
    const ownerSel = $("#saetOwnerFilterSel");
    if (ownerSel) {
      ownerSel.value = adminId;
    }
    const qInput = $("#saetQ");
    if (qInput) qInput.value = "";
    st.saet.page = 0;
    saetPull();
  });
  $("#btnSaetNew")?.addEventListener("click", () => {
    saetNewRow();
  });
  const saetSortState = TableSortHelper.getSortState(st.saet, { sortBy: "set_id", sortDir: "asc" });
  TableSortHelper.attachSortHandlers("#tblSaet", saetSortState, () => {
    st.saet.page = 0;
    saetPull();
  });
  $("#saetOwnerFilterSel")?.addEventListener("change", () => {
    st.saet.owner = $("#saetOwnerFilterSel").value || currentAdminId();
    st.saet.page = 0;
    saetPull();
  });
  $("#saetPrev")?.addEventListener("click", () => {
    if (st.saet.page > 0) {
      st.saet.page--;
      saetPull();
    }
  });
  $("#saetNext")?.addEventListener("click", () => {
    const totalPages = Math.ceil((st.saet.total || 0) / st.saet.pageSize);
    if (st.saet.page < totalPages - 1) {
      st.saet.page++;
      saetPull();
    }
  });
  $("#btnSaetExport")?.addEventListener("click", () => {
    exportSaetToExcel();
  });
  $("#btnSaetImport")?.addEventListener("click", () => {
    $("#saetImportFile")?.click();
  });
  $("#saetImportFile")?.addEventListener("change", evt => {
    const file = evt.target?.files?.[0];
    if (file) {
      importSaetFromExcel(file);
    }
    evt.target.value = "";
  });
}

function refreshSaetAvailabilityIndicators() {
  const rows = document.querySelectorAll("#tblSaet tbody tr");
  rows.forEach(tr => updateSaetAvailability(tr));
}

// ----------------------------------------------------------

// ----------------------------------------------------------

  const SaetStore = Object.freeze({
    fetchSaetUsage,
    saetUsageFor,
    saetValidate,
    exportSaetToExcel,
    importSaetFromExcel,
    populateSaetIsbnSelect,
    applyInventoryMeta,
    updateSaetAvailability,
    saetDirtyRows,
    saetApplyBookingMode,
    markSaetDirty,
    clearSaetDirty,
    updateSaetSaveButton,
    saetAttachRowListeners,
    saetCollectRow,
    highlightSaveBar,
    refreshSaetInventoryControls,
    saetCount,
    saetFetch,
    saetPull,
    ensureSaetCapacity,
    saetDeleteRow,
    saetNewRow,
    saetSaveAll,
    bindSaetControls,
    refreshSaetAvailabilityIndicators
  });

  window.SaetStore = SaetStore;
  Object.assign(window, SaetStore);
  window.StoreRegistry?.registerStore?.("SaetStore", SaetStore);
})();

const SaetStore = window.SaetStore || {};
const StateLibStoreRef = window.StateLibStore || {};
SaetStore.init?.({
  state: StateLibStoreRef.st,
  getSupabaseClient: StateLibStoreRef.getSupabaseClient,
  uiHelpers: {
    showMsg: window.showMsg,
    el: StateLibStoreRef.el || window.el,
    $: StateLibStoreRef.$ || window.$
  }
});





(() => {
  function saetSetMsg(text, ok = false) {
    const box = document.querySelector('#saetMsg');
    if (!box) return;
    box.textContent = text || '';
    box.style.display = text ? 'block' : 'none';
    box.classList.toggle('ok', !!ok);
  }
  window.saetSetMsg = saetSetMsg;
})();
