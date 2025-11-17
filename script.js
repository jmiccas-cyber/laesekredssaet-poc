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
// 11. FÃ¦lles refresh pr. rolle & boot
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
  btn.textContent = count ? `Gem ${count} sÃ¦t` : "Gem Ã¦ndringer";
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
    showMsg("#msgSaet", "Der er ingen Ã¦ndringer at gemme.");
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
    showMsg("#msgSaet", `Gemte ${successCount} sÃ¦t`, true);
    highlightSaveBar();
    await saetPull();
    await regenerateBookingSlotsForOwner(currentAdminId());
  }
  if (failures.length) {
    alert("Kunne ikke gemme fÃ¸lgende sÃ¦t:\n" + failures.join("\n"));
  }
}












