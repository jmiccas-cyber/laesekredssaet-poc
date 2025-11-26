(function () {
  const StateLibStore = window.StateLibStore || {};
  const st = StateLibStore.st || window.st;
  const $ = StateLibStore.$ || window.$;
  const el = StateLibStore.el || window.el;
  const showMsg = window.showMsg || (() => {});
  const fmtLibLabel = window.fmtLibLabel || (() => "");
  const isSuperLibrary = window.isSuperLibrary || (() => false);
  const currentAdminId = window.currentAdminId || (() => "");
  const BOOKING_RULE_TABLE = StateLibStore.BOOKING_RULE_TABLE || window.BOOKING_RULE_TABLE || "tbl_booking_rules";
  const LOCAL_HOLIDAY_TABLE = StateLibStore.LOCAL_HOLIDAY_TABLE || window.LOCAL_HOLIDAY_TABLE || "tbl_local_holidays";
  const BOOKING_STATUS_AVAILABLE = StateLibStore.BOOKING_STATUS_AVAILABLE || window.BOOKING_STATUS_AVAILABLE || "available";
  const BOOKING_STATUS_REQUESTED = StateLibStore.BOOKING_STATUS_REQUESTED || window.BOOKING_STATUS_REQUESTED || "requested";
  const BOOKING_STATUS_BOOKED = StateLibStore.BOOKING_STATUS_BOOKED || window.BOOKING_STATUS_BOOKED || "booked";
  const BOOKING_STATUS_CANCELLED = StateLibStore.BOOKING_STATUS_CANCELLED || window.BOOKING_STATUS_CANCELLED || "cancelled";
  const BOOKING_RULE_EVERY14 = StateLibStore.BOOKING_RULE_EVERY14 || window.BOOKING_RULE_EVERY14 || "every_14_days";
  const BOOKING_RULE_OPTIONS = StateLibStore.BOOKING_RULE_OPTIONS || window.BOOKING_RULE_OPTIONS || [];
  const BOOKING_RULE_DEFAULT = StateLibStore.BOOKING_RULE_DEFAULT || window.BOOKING_RULE_DEFAULT || BOOKING_RULE_OPTIONS[0]?.value || "first_working_day";
  const BOOKING_SLOT_HORIZON_MONTHS = StateLibStore.BOOKING_SLOT_HORIZON_MONTHS || window.BOOKING_SLOT_HORIZON_MONTHS || 12;

  const getClient = () => StateLibStore.getSupabaseClient?.() || window.sb || null;
  let sb = getClient();
  const bookingSlotLocks = new Set();
  const CANCELLABLE_STATUSES = new Set([
    (BOOKING_STATUS_REQUESTED || "").toLowerCase() || "requested",
    (BOOKING_STATUS_BOOKED || "").toLowerCase() || "booked"
  ]);

  function refreshClient() {
    sb = getClient();
    return sb;
  }

  function toIsoDate(date) {
    if (!(date instanceof Date)) return "";
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  async function loadOwnerHolidaySet(ownerId) {
    if (!ownerId) return new Set();
    if (!st.calendar.localSets) st.calendar.localSets = {};
    if (st.calendar.localSets[ownerId]) return st.calendar.localSets[ownerId];
    const client = refreshClient();
    if (!client) return new Set();
    const { data, error } = await client
      .from(LOCAL_HOLIDAY_TABLE)
      .select("holiday_date")
      .eq("owner_bibliotek_id", ownerId);
    if (error) {
      console.error("loadOwnerHolidaySet:", error);
      st.calendar.localSets[ownerId] = new Set();
      return st.calendar.localSets[ownerId];
    }
    const set = new Set((data || []).map(row => row.holiday_date));
    st.calendar.localSets[ownerId] = set;
    return set;
  }

  function isHoliday(date, set) {
    const day = date.getDay();
    if (day === 0 || day === 6) return true;
    return set?.has(toIsoDate(date));
  }

  function nextWorkingDay(date, set) {
    const d = new Date(date);
    while (isHoliday(d, set)) {
      d.setDate(d.getDate() + 1);
    }
    return d;
  }

  function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }

  function addMonths(date, n) {
    const d = new Date(date);
    d.setMonth(d.getMonth() + n);
    return d;
  }

  function firstWorkingDayOfMonth(year, month, set) {
    return nextWorkingDay(new Date(year, month, 1), set);
  }

  function advanceFirstRule(date, set) {
    const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1);
    return firstWorkingDayOfMonth(nextMonth.getFullYear(), nextMonth.getMonth(), set);
  }

  function advanceEvery14(date, set) {
    const next = nextWorkingDay(addDays(date, 14), set);
    const nextMonthStart = new Date(date.getFullYear(), date.getMonth() + 1, 1);
    const firstNext = firstWorkingDayOfMonth(nextMonthStart.getFullYear(), nextMonthStart.getMonth(), set);
    return next < firstNext ? next : firstNext;
  }

  function calculateEndDate(startDate, loanWeeks, bufferDays) {
    const days = Math.max((Number(loanWeeks) || 0) * 7 + (Number(bufferDays) || 0), 0);
    return addDays(startDate, days);
  }

  function overlaps(startA, endA, booking) {
    const startB = new Date(booking.start_date);
    const endB = new Date(booking.end_date);
    return startA <= endB && endA >= startB;
  }

  function slotAvailable(start, end, bookings) {
    return !bookings.some(b => {
      const status = String(b.booking_status || "").toLowerCase();
      if ([BOOKING_STATUS_REQUESTED, BOOKING_STATUS_BOOKED].includes(status)) {
        return overlaps(start, end, b);
      }
      return false;
    });
  }

  function generateSlots(row, rule, holidaySet, minStart, horizon) {
    const slots = [];
    let candidate = firstWorkingDayOfMonth(minStart.getFullYear(), minStart.getMonth(), holidaySet);
    if (rule === BOOKING_RULE_EVERY14) {
      while (candidate < minStart) candidate = advanceEvery14(candidate, holidaySet);
      while (candidate < horizon) {
        const end = calculateEndDate(candidate, row.loan_weeks, row.buffer_days);
        slots.push({ start: toIsoDate(candidate), end: toIsoDate(end) });
        candidate = advanceEvery14(candidate, holidaySet);
      }
      return slots;
    }
    while (candidate < minStart) candidate = advanceFirstRule(candidate, holidaySet);
    while (candidate < horizon) {
      const end = calculateEndDate(candidate, row.loan_weeks, row.buffer_days);
      slots.push({ start: toIsoDate(candidate), end: toIsoDate(end) });
      candidate = advanceFirstRule(candidate, holidaySet);
    }
    return slots;
  }

  async function fetchBookingsForSetIds(ids) {
    const map = new Map();
    if (!ids?.length) return map;
    const client = refreshClient();
    if (!client) return map;
    const { data, error } = await client
      .from("tbl_booking")
      .select("booking_id,set_id,start_date,end_date,booking_status,requester_bibliotek_id")
      .in("set_id", ids);
    if (error) {
      console.error("fetchBookingsForSetIds:", error);
      return map;
    }
    (data || []).forEach(row => {
      if (!map.has(row.set_id)) map.set(row.set_id, []);
      map.get(row.set_id).push(row);
    });
    return map;
  }

  async function ensureBookingSlotsForSet(row, rule, holidaySet, minStart = new Date()) {
    if (!row?.set_id) return;
    const client = refreshClient();
    if (!client) return;
    const start = new Date(minStart);
    start.setHours(0, 0, 0, 0);
    const horizon = addMonths(start, BOOKING_SLOT_HORIZON_MONTHS);
    const { data, error } = await client
      .from("tbl_booking")
      .select("booking_id,start_date,end_date,booking_status")
      .eq("set_id", row.set_id)
      .order("start_date", { ascending: true });
    if (error) {
      console.error("ensureBookingSlotsForSet:", error);
      return;
    }
    const existing = data || [];
    const planned = generateSlots(row, rule, holidaySet, start, horizon);
    const existingKeys = new Set(existing.map(b => `${b.start_date}::${b.end_date}`));
    const missing = planned.filter(slot => !existingKeys.has(`${slot.start}::${slot.end}`));
    if (!missing.length) return;
    const payload = missing.map(slot => ({
      owner_bibliotek_id: row.owner_bibliotek_id,
      set_id: row.set_id,
      start_date: slot.start,
      end_date: slot.end,
      booking_status: BOOKING_STATUS_AVAILABLE
    }));
    const chunkSize = 100;
    for (let i = 0; i < payload.length; i += chunkSize) {
      const chunk = payload.slice(i, i + chunkSize);
      const { error: insertError } = await client.from("tbl_booking").insert(chunk);
      if (insertError) {
        console.error("ensureBookingSlotsForSet insert:", insertError);
        return;
      }
    }
  }

  async function regenerateBookingSlotsForOwner(ownerId) {
    if (!ownerId || bookingSlotLocks.has(ownerId)) return;
    const client = refreshClient();
    if (!client) return;
    bookingSlotLocks.add(ownerId);
    try {
      await loadBookingRules();
      const rule = currentBookingRule(ownerId);
      const holidaySet = await loadOwnerHolidaySet(ownerId);
      const { data, error } = await client
        .from("tbl_saet")
        .select("set_id,loan_weeks,buffer_days,owner_bibliotek_id,active")
        .eq("owner_bibliotek_id", ownerId)
        .eq("active", true);
      if (error) {
        console.error("regenerateBookingSlotsForOwner:", error);
        return;
      }
      await Promise.all((data || []).map(row => ensureBookingSlotsForSet(row, rule, holidaySet)));
    } finally {
      bookingSlotLocks.delete(ownerId);
    }
  }

  async function loadBookingRules(force = false) {
    if (!force && st.bookingRules.byOwner && Object.keys(st.bookingRules.byOwner).length) {
      return st.bookingRules.byOwner;
    }
    const client = refreshClient();
    if (!client) return st.bookingRules.byOwner || {};
    const { data, error } = await client
      .from(BOOKING_RULE_TABLE)
      .select("owner_bibliotek_id,rule");
    if (error) {
      console.error("loadBookingRules:", error);
      return st.bookingRules.byOwner || {};
    }
    const map = {};
    (data || []).forEach(row => {
      if (row.owner_bibliotek_id) {
        map[row.owner_bibliotek_id] = {
          owner_bibliotek_id: row.owner_bibliotek_id,
          rule: row.rule || BOOKING_RULE_DEFAULT
        };
      }
    });
    st.bookingRules.byOwner = map;
    return map;
  }

  function currentBookingRule(ownerId) {
    if (!ownerId) return BOOKING_RULE_DEFAULT;
    return st.bookingRules.byOwner?.[ownerId]?.rule || BOOKING_RULE_DEFAULT;
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

  async function bookingRulePull() {
    const wrap = $("#bookingRuleOwnerWrap");
    const sel = $("#bookingRuleOwnerSel");
    const selectRule = $("#bookingRuleSelect");
    const msg = "#bookingRuleMsg";
    const adminLib = st.libs.byId[currentAdminId()];
    const isSuper = isSuperLibrary(adminLib);
    if (wrap) wrap.style.display = isSuper ? "" : "none";
    $("#bookingRuleSuperHint")?.classList.toggle("hidden", !isSuper);
    if (!st.bookingRules.owner || !isSuper) {
      st.bookingRules.owner = currentAdminId();
    }
    if (isSuper && sel) {
      sel.innerHTML = "";
      st.libs.centrals.forEach(lib => {
        sel.appendChild(el("option", { value: lib.bibliotek_id }, fmtLibLabel(lib)));
      });
      sel.value = st.bookingRules.owner || currentAdminId();
    }
    await loadBookingRules(true);
    const currentRule = currentBookingRule(st.bookingRules.owner || currentAdminId());
    if (selectRule) selectRule.value = currentRule;
    showMsg(msg, "");
  }

  async function bookingRuleSave() {
    const ownerId = st.bookingRules.owner || currentAdminId();
    if (!ownerId) {
      showMsg("#bookingRuleMsg", "Vælg et centralbibliotek først.");
      return;
    }
    const client = refreshClient();
    if (!client) return;
    const ruleSel = $("#bookingRuleSelect");
    const rule = ruleSel?.value || BOOKING_RULE_DEFAULT;
    showMsg("#bookingRuleMsg", "Gemmer bookingregel …");
    const payload = { owner_bibliotek_id: ownerId, rule };
    const { error } = await client
      .from(BOOKING_RULE_TABLE)
      .upsert(payload, { onConflict: "owner_bibliotek_id" });
    if (error) {
      showMsg("#bookingRuleMsg", "Kunne ikke gemme: " + error.message);
      return;
    }
    if (!st.bookingRules.byOwner) st.bookingRules.byOwner = {};
    st.bookingRules.byOwner[ownerId] = payload;
    showMsg("#bookingRuleMsg", "Regel gemt.", true);
    await regenerateBookingSlotsForOwner(ownerId);
  }

  async function fetchSaetMapByIds(ids) {
    const map = new Map();
    if (!ids?.length) return map;
    const client = refreshClient();
    if (!client) return map;
    const { data, error } = await client
      .from("tbl_saet")
      .select("set_id,title,owner_bibliotek_id,loan_weeks,buffer_days,requested_count,isbn,active")
      .in("set_id", ids);
    if (error) {
      console.error("fetchSaetMapByIds:", error);
      return map;
    }
    (data || []).forEach(row => map.set(row.set_id, row));
    return map;
  }

  function renderBookingRequestsTable(rows) {
    const tb = $("#tblBookingRequests tbody");
    if (!tb) return;
    tb.innerHTML = "";
    if (!rows.length) {
      tb.appendChild(el("tr", {}, el("td", { colspan: 5 }, "Ingen anmodninger.")));
      return;
    }
    rows.forEach(row => {
      const setInfo = row.set || {};
      const requester = st.libs.byId[row.requester_bibliotek_id];
      const requesterLabel = requester ? fmtLibLabel(requester) : (row.requester_bibliotek_id || "Ukendt");
      const approveBtn = el("button", {
        class: "btn btn-small",
        "data-booking-approve": row.booking_id,
        "data-booking-set": row.set_id
      }, "Godkend");
      const cancelBtn = el("button", {
        class: "btn btn-small ghost",
        "data-booking-cancel": row.booking_id,
        "data-booking-set": row.set_id
      }, "Afvis");
      tb.appendChild(el("tr", {},
        el("td", {}, setInfo.title || `Sæt #${row.set_id}` || "—"),
        el("td", {}, requesterLabel),
        el("td", {}, formatDateDisplay(row.start_date)),
        el("td", {}, formatDateDisplay(row.end_date)),
        el("td", {}, approveBtn, " ", cancelBtn)
      ));
    });
  }

  async function bookingRequestsPull() {
    const ownerId = currentAdminId();
    const ownerLabel = $("#bookingRequestsOwner");
    if (ownerLabel) {
      ownerLabel.textContent = fmtLibLabel(st.libs.byId[ownerId]) || ownerId || "—";
    }
    if (!ownerId) {
      renderBookingRequestsTable([]);
      showMsg("#bookingRequestsMsg", "Vælg først et centralbibliotek.");
      return;
    }
    const client = refreshClient();
    if (!client) return;
    showMsg("#bookingRequestsMsg", "Henter anmodninger …");
    const { data, error } = await client
      .from("tbl_booking")
      .select("booking_id,set_id,start_date,end_date,booking_status,requester_bibliotek_id")
      .eq("owner_bibliotek_id", ownerId)
      .eq("booking_status", BOOKING_STATUS_REQUESTED)
      .order("start_date", { ascending: true });
    if (error) {
      showMsg("#bookingRequestsMsg", "Kunne ikke hente anmodninger: " + error.message);
      renderBookingRequestsTable([]);
      return;
    }
    const rows = data || [];
    const setIds = Array.from(new Set(rows.map(r => r.set_id).filter(Boolean)));
    const setMap = await fetchSaetMapByIds(setIds);
    st.booking.requests = rows.map(row => ({
      ...row,
      set: setMap.get(row.set_id) || null
    }));
    renderBookingRequestsTable(st.booking.requests);
    showMsg("#bookingRequestsMsg", st.booking.requests.length ? "" : "Ingen anmodninger.", st.booking.requests.length === 0);
  }

  async function bookingRequestsUpdate(bookingId, action, setId) {
    if (!bookingId) return;
    const ownerId = currentAdminId();
    const client = refreshClient();
    if (!client) return;
    const msgSel = "#bookingRequestsMsg";
    const updates = action === "approve"
      ? { booking_status: BOOKING_STATUS_BOOKED }
      : { booking_status: BOOKING_STATUS_AVAILABLE, requester_bibliotek_id: null };
    showMsg(msgSel, action === "approve" ? "Godkender anmodning …" : "Afviser anmodning …");
    const { error } = await client
      .from("tbl_booking")
      .update(updates)
      .eq("booking_id", bookingId)
      .eq("owner_bibliotek_id", ownerId);
    if (error) {
      showMsg(msgSel, "Kunne ikke opdatere anmodning: " + error.message);
      return;
    }
    showMsg(msgSel, action === "approve" ? "Anmodning godkendt." : "Anmodning afvist.", true);
    if (setId) {
      await regenerateBookingSlotsForOwner(ownerId);
    }
    await bookingRequestsPull();
  }

  function compareMyRequests(a, b) {
    const sortBy = st.booking?.mySortBy || "start_date";
    const dir = st.booking?.mySortDir === "desc" ? -1 : 1;
    const getVal = row => {
      switch (sortBy) {
        case "title":
          return (row.set?.title || "").toLowerCase();
        case "owner":
          return (fmtLibLabel(st.libs.byId[row.owner_bibliotek_id]) || row.owner_bibliotek_id || "").toLowerCase();
        case "end_date":
          return row.end_date || "";
        case "status":
          return (row.booking_status || "").toLowerCase();
        case "start_date":
        default:
          return row.start_date || "";
      }
    };
    return getVal(a).localeCompare(getVal(b)) * dir;
  }

  function setMyRequestSort(field) {
    const valid = { title: true, owner: true, start_date: true, end_date: true, status: true };
    if (!valid[field]) return;
    if (!st.booking.mySortBy) st.booking.mySortBy = "start_date";
    if (!st.booking.mySortDir) st.booking.mySortDir = "asc";
    if (st.booking.mySortBy === field) {
      st.booking.mySortDir = st.booking.mySortDir === "asc" ? "desc" : "asc";
    } else {
      st.booking.mySortBy = field;
      st.booking.mySortDir = "asc";
    }
    const sorted = [...(st.booking.myRequests || [])].sort(compareMyRequests);
    st.booking.myRequests = sorted;
    renderBookerMyRequests(sorted);
    updateMySortIndicators();
  }

  function updateMySortIndicators() {
    document.querySelectorAll("#bMyTbl thead th[data-sort]")?.forEach(th => {
      const field = th.dataset.sort;
      th.classList.toggle("sorted-asc", field === st.booking.mySortBy && st.booking.mySortDir === "asc");
      th.classList.toggle("sorted-desc", field === st.booking.mySortBy && st.booking.mySortDir === "desc");
    });
  }

  function renderBookerMyRequests(rows) {
    const tb = $("#bMyTbl tbody");
    if (!tb) return;
    tb.innerHTML = "";
    if (!rows.length) {
      tb.appendChild(el("tr", {}, el("td", { colspan: 6 }, "Ingen anmodninger.")));
      updateMySortIndicators();
      return;
    }
    rows.forEach(row => {
      const setInfo = row.set || {};
      const ownerLabel = fmtLibLabel(st.libs.byId[row.owner_bibliotek_id]) || row.owner_bibliotek_id || "";
      const status = (row.booking_status || "").toLowerCase();
      const canCancel = CANCELLABLE_STATUSES.has(status);
      const btn = el("button", {
        class: "btn btn-small",
        type: "button",
        "data-my-cancel": row.booking_id
      }, "Annuller");
      if (canCancel) {
        btn.removeAttribute("disabled");
        btn.title = "Annuller anmodning";
      } else {
        btn.setAttribute("disabled", "disabled");
        btn.title = "Kan ikke annulleres";
        btn.classList.add("hint");
      }
      const startText = formatDateDisplay(row.start_date);
      const endText = formatDateDisplay(row.end_date);
      const statusCell = el("td", { "data-sort": status }, status || "");
      if (row.warning) {
        statusCell.appendChild(el("div", { class: "hint warning" }, row.warning));
      }
      tb.appendChild(el("tr", {},
        el("td", { "data-sort": (setInfo.title || "").toLowerCase() }, setInfo.title || `Sæt #${row.set_id}` || ""),
        el("td", { "data-sort": (ownerLabel || "").toLowerCase() }, ownerLabel),
        el("td", { "data-sort": row.start_date || "" }, startText || ""),
        el("td", { "data-sort": row.end_date || "" }, endText || ""),
        statusCell,
        el("td", {}, btn)
      ));
    });
    updateMySortIndicators();
  }

  async function bookerMyRequestsPull() {
    const requesterId = st.profile.bookerLocalId;
    if (!requesterId) {
      renderBookerMyRequests([]);
      showMsg("#bMyMsg", "Vælg først en booker-profil (regionsbibliotek).");
      return;
    }
    if (!st.booking.mySortBy) st.booking.mySortBy = "start_date";
    if (!st.booking.mySortDir) st.booking.mySortDir = "asc";
    const client = refreshClient();
    if (!client) return;
    showMsg("#bMyMsg", "Henter anmodninger …");
    const { data, error } = await client
      .from("tbl_booking")
      .select("booking_id,set_id,start_date,end_date,booking_status,owner_bibliotek_id")
      .eq("requester_bibliotek_id", requesterId)
      .order("start_date", { ascending: false });
    if (error) {
      showMsg("#bMyMsg", "Kunne ikke hente anmodninger: " + error.message);
      renderBookerMyRequests([]);
      return;
    }
    const rows = data || [];
    const setIds = Array.from(new Set(rows.map(r => r.set_id).filter(Boolean)));
    const setMap = await fetchSaetMapByIds(setIds);
    const inventoryStore = window.InventoryStore || {};
    if (typeof inventoryStore.loadInventorySummary === "function") {
      try {
        await inventoryStore.loadInventorySummary();
      } catch (err) {
        console.warn("Kunne ikke opdatere beholdningsoversigt:", err);
      }
    }
    const getInventoryCount = inventoryStore.getInventoryCount;
    const enriched = rows.map(row => {
      const setInfo = setMap.get(row.set_id) || null;
      let warning = "";
      if (!setInfo) {
        warning = "Sæt er ikke længere tilgængeligt.";
      } else if (setInfo.active === false) {
        warning = "Sæt er sat som inaktivt.";
      } else if (typeof getInventoryCount === "function" && setInfo.isbn) {
        const invCount = getInventoryCount(setInfo.owner_bibliotek_id || row.owner_bibliotek_id, setInfo.isbn);
        const desired = Number(setInfo.requested_count) || 0;
        if (Number.isFinite(invCount) && invCount < desired) {
          warning = `Sættet er reduceret til ${invCount} eksemplarer (krævet ${desired}).`;
        }
      }
      return {
        ...row,
        set: setInfo,
        warning
      };
    });
    st.booking.myRequests = enriched;
    const sorted = [...enriched].sort(compareMyRequests);
    renderBookerMyRequests(sorted);
    showMsg("#bMyMsg", enriched.length ? "" : "Ingen anmodninger.", enriched.length === 0);
  }

  async function bookerCancelRequest(bookingId) {
    if (!bookingId) return;
    const requesterId = st.profile.bookerLocalId;
    if (!requesterId) {
      showMsg("#bMyMsg", "Vælg først en booker-profil (regionsbibliotek).");
      return;
    }
    const target = st.booking.myRequests?.find(r => r.booking_id === bookingId);
    if (!target) return;
    if (!CANCELLABLE_STATUSES.has((target.booking_status || "").toLowerCase())) {
      showMsg("#bMyMsg", "Denne anmodning kan ikke annulleres længere.");
      return;
    }
    const client = refreshClient();
    if (!client) return;
    showMsg("#bMyMsg", "Annullerer anmodning …");
    const { error } = await client
      .from("tbl_booking")
      .update({
        booking_status: BOOKING_STATUS_AVAILABLE,
        requester_bibliotek_id: null
      })
      .eq("booking_id", bookingId)
      .eq("requester_bibliotek_id", requesterId)
      .in("booking_status", Array.from(CANCELLABLE_STATUSES));
    if (error) {
      showMsg("#bMyMsg", "Kunne ikke annullere: " + error.message);
      return;
    }
    showMsg("#bMyMsg", "Anmodning annulleret.", true);
    await bookerMyRequestsPull();
  }

  function setBookerTab(tab = "search") {
    const normalized = tab === "requests" ? "requests" : "search";
    if (!st.b) st.b = {};
    st.b.view = normalized;
    document.querySelectorAll("[data-booker-tab]")?.forEach(btn => {
      btn.classList.toggle("active", (btn.dataset.bookerTab || "search") === normalized);
    });
    $("#bookerSearchPanel")?.classList.toggle("hidden", normalized !== "search");
    $("#bookerRequestsPanel")?.classList.toggle("hidden", normalized !== "requests");
    if (normalized === "requests") {
      bookerMyRequestsPull();
    }
  }

  function renderSlotSelect(row) {
    const select = el("select", {
      class: "slot-select",
      "data-slot-set": row.set_id,
      onchange: ev => {
        row.selectedSlotId = ev.target.value;
      }
    });
    row.availableSlots?.slice(0, 50).forEach(slot => {
      const label = `${formatDateDisplay(slot.start_date)} → ${formatDateDisplay(slot.end_date)}`;
      select.appendChild(el("option", { value: `${slot.booking_id}` }, label));
    });
    if (row.selectedSlotId) {
      select.value = row.selectedSlotId;
    } else if (row.availableSlots?.[0]) {
      select.value = `${row.availableSlots[0].booking_id}`;
      row.selectedSlotId = select.value;
    }
    return select;
  }

  function compareBookerRows(a, b) {
    const sortBy = st.b.sortBy || "title";
    const dir = st.b.sortDir === "desc" ? -1 : 1;
    const normalize = val => (val == null ? "" : String(val).toLowerCase());
    const numberize = val => (val == null ? -Infinity : Number(val));
    const getValue = row => {
      switch (sortBy) {
        case "title":
          return normalize(row.title);
        case "author":
          return normalize(row.author);
        case "isbn":
          return normalize(row.isbn);
        case "faust":
          return normalize(row.faust);
        case "visibility":
          return normalize(row.visibility);
        case "owner":
          return normalize(row.owner_bibliotek_id);
        case "rule":
          return normalize(row.bookingRule);
        case "loan_weeks":
          return numberize(row.loan_weeks);
        case "requested_count":
          return numberize(row.requested_count);
        case "next":
          return row.nextBooking?.start
            ? new Date(row.nextBooking.start).getTime()
            : Number.MAX_SAFE_INTEGER;
        default:
          return normalize(row.title);
      }
    };
    const valA = getValue(a);
    const valB = getValue(b);
    if (typeof valA === "number" && typeof valB === "number") {
      return (valA - valB) * dir;
    }
    return String(valA).localeCompare(String(valB)) * dir;
  }

  function setBookerSort(field) {
    const valid = {
      title: true,
      author: true,
      isbn: true,
      faust: true,
      visibility: true,
      owner: true,
      rule: true,
      loan_weeks: true,
      requested_count: true,
      next: true
    };
    if (!valid[field]) return;
    if (st.b.sortBy === field) {
      st.b.sortDir = st.b.sortDir === "asc" ? "desc" : "asc";
    } else {
      st.b.sortBy = field;
      st.b.sortDir = "asc";
    }
    st.b.page = 0;
    renderBookerResults();
  }

  function updateBookerSortIndicators() {
    document.querySelectorAll("#bTbl thead th[data-sort]")?.forEach(th => {
      const field = th.dataset.sort;
      th.classList.toggle("sorted-asc", field === st.b.sortBy && st.b.sortDir === "asc");
      th.classList.toggle("sorted-desc", field === st.b.sortBy && st.b.sortDir === "desc");
    });
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
      tb.appendChild(el("tr", {},
        el("td", {}, r.title || ""),
        el("td", {}, r.author || ""),
        el("td", {}, r.isbn || ""),
        el("td", {}, r.faust || ""),
        el("td", {}, r.visibility || ""),
        el("td", {}, ownerLabel),
        el("td", {}, ruleLabel),
        el("td", {}, r.loan_weeks ? `${r.loan_weeks}` : ""),
        el("td", {}, copies ? `${copies}` : ""),
        el("td", {}, nextInfo),
        el("td", {}, btn)
      ));
    });
    updateBookerSortIndicators();
    const info = $("#bInfo");
    if (info) {
      const totalPages = Math.ceil((st.b.total || 0) / st.b.pageSize);
      info.textContent = st.b.total ? `Side ${st.b.page + 1}/${Math.max(1, totalPages)} – ${st.b.total} sæt` : "Ingen sæt fundet";
    }
  }

  async function resolveBookerCentrals() {
    st.b.centralIds = [];
    const client = refreshClient();
    if (!client || !st.profile.bookerLocalId) return;
    const { data, error } = await client
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
    const client = refreshClient();
    if (!client) return [];
    const q = st.b.q;
    const centralIds = st.b.centralIds || [];
    let qNat = client.from("tbl_saet")
      .select("set_id,title,author,isbn,faust,visibility,owner_bibliotek_id,active,requested_count,loan_weeks,buffer_days")
      .ilike("visibility", "national")
      .eq("active", true);
    let qReg = client.from("tbl_saet")
      .select("set_id,title,author,isbn,faust,visibility,owner_bibliotek_id,active,requested_count,loan_weeks,buffer_days")
      .ilike("visibility", "regional")
      .eq("active", true);
    if (q) {
      const search = [
        `title.ilike.%${q}%`,
        `author.ilike.%${q}%`,
        `isbn.ilike.%${q}%`,
        `faust.ilike.%${q}%`
      ].join(",");
      qNat = qNat.or(search);
      qReg = qReg.or(search);
    }
    const [natRes, regRes] = await Promise.all([
      qNat,
      centralIds.length ? qReg.in("owner_bibliotek_id", centralIds) : { data: [], error: null }
    ]);
    if (natRes.error) {
      showMsg("#bMsg", "Fejl ved national søgning: " + natRes.error.message);
      return [];
    }
    if (regRes.error) {
      showMsg("#bMsg", "Fejl ved regional søgning: " + regRes.error.message);
      return [];
    }
    return (natRes.data || []).concat(regRes.data || []);
  }

  async function bookerSearch() {
    if (!st.profile.bookerLocalId) {
      showMsg("#bMsg", "Vælg først en booker-profil (regionsbibliotek).");
      return;
    }
    setBookerTab("search");
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
    if (!setId) return;
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
    const client = refreshClient();
    if (!client) return;
    showMsg("#bMsg", "Sender bookinganmodning …");
    const { data, error } = await client
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

  function bindBookingRuleControls() {
    $("#bookingRuleOwnerSel")?.addEventListener("change", () => {
      st.bookingRules.owner = $("#bookingRuleOwnerSel").value || currentAdminId();
      bookingRulePull();
    });
    $("#btnBookingRuleSave")?.addEventListener("click", () => bookingRuleSave());
  }

  function bindBookingRequestControls() {
    $("#tblBookingRequests")?.addEventListener("click", evt => {
      const btn = evt.target.closest("button[data-booking-approve],button[data-booking-cancel]");
      if (!btn) return;
      const bookingId = Number(btn.getAttribute("data-booking-approve") || btn.getAttribute("data-booking-cancel"));
      const setId = Number(btn.getAttribute("data-booking-set"));
      if (!bookingId) return;
      if (btn.hasAttribute("data-booking-approve")) {
        bookingRequestsUpdate(bookingId, "approve", setId);
      } else {
        bookingRequestsUpdate(bookingId, "cancel", setId);
      }
    });
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
    document.querySelectorAll("#bMyTbl thead th[data-sort]")?.forEach(th => {
      th.addEventListener("click", () => {
        const field = th.dataset.sort;
        if (field) setMyRequestSort(field);
      });
    });
    document.querySelectorAll("[data-booker-tab]")?.forEach(btn => {
      btn.addEventListener("click", () => {
        setBookerTab(btn.dataset.bookerTab || "search");
      });
    });
    $("#bMyTbl")?.addEventListener("click", evt => {
      const btn = evt.target.closest("button[data-my-cancel]");
      if (!btn) return;
      const bookingId = Number(btn.getAttribute("data-my-cancel"));
      if (bookingId) {
        bookerCancelRequest(bookingId);
      }
    });
    setBookerTab(st.b.view || "search");
  }

  const BookingStore = Object.freeze({
    toIsoDate,
    loadOwnerHolidaySet,
    regenerateBookingSlotsForOwner,
    loadBookingRules,
    currentBookingRule,
    bookingRulePull,
    bookingRuleSave,
    fetchSaetMapByIds,
    bookingRequestsPull,
    bookingRequestsUpdate,
    compareMyRequests,
    setMyRequestSort,
    updateMySortIndicators,
    renderBookerMyRequests,
    bookerMyRequestsPull,
    bookerCancelRequest,
    setBookerTab,
    renderBookerResults,
    bookerSearch,
    bookerRequestBooking,
    bindBookingRuleControls,
    bindBookingRequestControls,
    bindBookerControls
  });

  window.BookingStore = BookingStore;
  Object.assign(window, BookingStore);
})();

const BookingStore = window.BookingStore || {};
BookingStore.init?.({
  state: window.StateLibStore?.st,
  getSupabaseClient: window.StateLibStore?.getSupabaseClient,
  uiHelpers: {
    showMsg: window.showMsg,
    el: window.StateLibStore?.el || window.el,
    $: window.StateLibStore?.$ || window.$
  }
});
