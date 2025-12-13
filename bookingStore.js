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
  const BOOKING_MODE_ADVANCED = "advanced";
  const BOOKING_MODE_SIMPLE = "simple";
  let bookingModeSupported = true;

  const getClient = () => StateLibStore.getSupabaseClient?.() || window.sb || null;
  let sb = getClient();
  const bookingSlotLocks = new Set();
  const CANCELLABLE_STATUSES = new Set([
    (BOOKING_STATUS_REQUESTED || "").toLowerCase() || "requested",
    (BOOKING_STATUS_BOOKED || "").toLowerCase() || "booked"
  ]);

  function getBookingMode(row) {
    const mode = (row?.booking_mode || row?.bookingMode || "").toLowerCase();
    return mode === BOOKING_MODE_ADVANCED ? BOOKING_MODE_ADVANCED : BOOKING_MODE_SIMPLE;
  }

  function refreshClient() {
    sb = getClient();
    return sb;
  }

  function isBookingModeColumnError(error) {
    return !!(error?.message && /booking_mode/i.test(error.message));
  }

  async function selectSaetWithMode(buildQuery) {
    const tryInclude = bookingModeSupported;
    let result = await buildQuery(tryInclude);
    if (result.error && (isBookingModeColumnError(result.error) || tryInclude)) {
      bookingModeSupported = false;
      result = await buildQuery(false);
    } else if (!result.error && tryInclude) {
      bookingModeSupported = true;
    }
    return result;
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

  function startOfMonth(date) {
    const d = new Date(date);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function endOfNextMonth(date) {
    const d = new Date(date.getFullYear(), date.getMonth() + 2, 0);
    d.setHours(0, 0, 0, 0);
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

  function generateSimpleSlots(minStart, horizon) {
    const slots = [];
    let candidate = startOfMonth(minStart);
    if (candidate < minStart) {
      candidate = startOfMonth(addMonths(minStart, 1));
    }
    while (candidate < horizon) {
      const end = endOfNextMonth(candidate);
      slots.push({ start: toIsoDate(candidate), end: toIsoDate(end) });
      candidate = addMonths(candidate, 1);
    }
    return slots;
  }

  function generateAdvancedSlots(row, rule, holidaySet, minStart, horizon) {
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

  function generateSlots(row, rule, holidaySet, minStart, horizon) {
    return getBookingMode(row) === BOOKING_MODE_SIMPLE
      ? generateSimpleSlots(minStart, horizon)
      : generateAdvancedSlots(row, rule, holidaySet, minStart, horizon);
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
    const plannedKeys = new Set(planned.map(slot => `${slot.start}::${slot.end}`));
    const missing = planned.filter(slot => !existingKeys.has(`${slot.start}::${slot.end}`));
    if (missing.length) {
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
    const extraAvailableIds = existing
      .filter(b => b.booking_status === BOOKING_STATUS_AVAILABLE && !plannedKeys.has(`${b.start_date}::${b.end_date}`))
      .map(b => b.booking_id);
    if (extraAvailableIds.length) {
      try {
        await client.from("tbl_booking").delete().in("booking_id", extraAvailableIds);
      } catch (deleteErr) {
        console.warn("ensureBookingSlotsForSet delete:", deleteErr);
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
      const { data, error } = await selectSaetWithMode(includeMode => {
        const columns = includeMode
          ? "set_id,loan_weeks,buffer_days,owner_bibliotek_id,active,booking_mode"
          : "set_id,loan_weeks,buffer_days,owner_bibliotek_id,active";
        return client
          .from("tbl_saet")
          .select(columns)
          .eq("owner_bibliotek_id", ownerId)
          .eq("active", true);
      });
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

  function bookingRuleLabel(value, mode) {
    if ((mode || value) === BOOKING_MODE_SIMPLE) return "Simpel (2 mdr)";
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
    showMsg("#bookingRuleMsg", "Gemmer bookingregel");
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
    const { data, error } = await selectSaetWithMode(includeMode => {
      const columns = includeMode
        ? "set_id,title,author,owner_bibliotek_id,loan_weeks,buffer_days,requested_count,isbn,active,booking_mode"
        : "set_id,title,author,owner_bibliotek_id,loan_weeks,buffer_days,requested_count,isbn,active";
      return client
        .from("tbl_saet")
        .select(columns)
        .in("set_id", ids);
    });
    if (error) {
      console.error("fetchSaetMapByIds:", error);
      return map;
    }
    (data || []).forEach(row => map.set(row.set_id, row));
    return map;
  }

  function renderBookingRequestsTable(rows) {
    const sortState = st.booking.requestsSort || (st.booking.requestsSort = {});
    TableSortHelper.renderTable({
      tableSelector: "#tblBookingRequests",
      rows: rows || [],
      columns: [
        {
          id: "title",
          accessor: row => (row.set?.title || "").toLowerCase(),
          render: row => row.set?.title || `set #${row.set_id}` || "?"
        },
        {
          id: "author",
          accessor: row => (row.set?.author || "").toLowerCase(),
          render: row => row.set?.author || "?"
        },
        {
          id: "isbn",
          accessor: row => row.set?.isbn || "",
          render: row => row.set?.isbn || "?"
        },
        {
          id: "requester",
          accessor: row => {
            const req = st.libs.byId[row.requester_bibliotek_id];
            return req ? fmtLibLabel(req).toLowerCase() : (row.requester_bibliotek_id || "");
          },
          render: row => {
            const req = st.libs.byId[row.requester_bibliotek_id];
            return req ? fmtLibLabel(req) : (row.requester_bibliotek_id || "Ukendt");
          }
        },
        {
          id: "start_date",
          accessor: row => row.start_date || "",
          render: row => formatDateDisplay(row.start_date)
        },
        {
          id: "end_date",
          accessor: row => row.end_date || "",
          render: row => formatDateDisplay(row.end_date)
        },
        {
          id: "status",
          accessor: row => (row.booking_status || "").toLowerCase(),
          render: row => (row.booking_status || "").replace(/^\w/, ch => ch.toUpperCase()) || "?"
        }
      ],
      stateRoot: sortState,
      defaultSort: { sortBy: "start_date", sortDir: "asc" },
      emptyText: "Ingen anmodninger.",
      rowActions: row => {
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
        return el("span", {}, approveBtn, " ", cancelBtn);
      }
    });
  }

  async function bookingRequestsPull() {
    const ownerId = currentAdminId();
    const ownerLabel = $("#bookingRequestsOwner");
    if (ownerLabel) {
      ownerLabel.textContent = fmtLibLabel(st.libs.byId[ownerId]) || ownerId || "?";
    }
    if (!ownerId) {
      renderBookingRequestsTable([]);
      showMsg("#bookingRequestsMsg", "Vælg først et centralbibliotek.");
      return;
    }
    const client = refreshClient();
    if (!client) return;
    showMsg("#bookingRequestsMsg", "Henter anmodninger ?");
    const { data, error } = await client
      .from("tbl_booking")
      .select("booking_id,set_id,start_date,end_date,booking_status,requester_bibliotek_id,owner_bibliotek_id")
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
    const requestRow = st.booking.requests?.find(r => r.booking_id === bookingId);
    const isApprove = action === "approve";
    const updates = isApprove
      ? { booking_status: BOOKING_STATUS_BOOKED }
      : { booking_status: BOOKING_STATUS_CANCELLED };
    showMsg(msgSel, isApprove ? "Godkender anmodning ?" : "Afviser anmodning ?");
    const { error } = await client
      .from("tbl_booking")
      .update(updates)
      .eq("booking_id", bookingId)
      .eq("owner_bibliotek_id", ownerId);
    if (error) {
      showMsg(msgSel, "Kunne ikke opdatere anmodning: " + error.message);
      return;
    }
    if (!isApprove && requestRow) {
      try {
        await client.from("tbl_booking").insert({
          owner_bibliotek_id: requestRow.owner_bibliotek_id || ownerId,
          set_id: requestRow.set_id || setId,
          start_date: requestRow.start_date,
          end_date: requestRow.end_date,
          booking_status: BOOKING_STATUS_AVAILABLE
        });
      } catch (insertErr) {
        console.warn("Kunne ikke indsette ny booking-slot efter afvisning:", insertErr);
      }
    }
    showMsg(msgSel, isApprove ? "Anmodning godkendt." : "Anmodning afvist.", true);
    if (setId) {
      await regenerateBookingSlotsForOwner(ownerId);
    }
    await bookingRequestsPull();
  }

  function renderBookerMyRequests(rows) {
    const sortState = st.booking.myRequestsSort || (st.booking.myRequestsSort = { sortBy: "start_date", sortDir: "asc" });
    TableSortHelper.renderTable({
      tableSelector: "#bMyTbl",
      rows: rows || [],
      columns: [
        {
          id: "title",
          accessor: row => (row.set?.title || "").toLowerCase(),
          render: row => row.set?.title || `set #${row.set_id}` || ""
        },
        {
          id: "owner",
          accessor: row => (fmtLibLabel(st.libs.byId[row.owner_bibliotek_id]) || row.owner_bibliotek_id || "").toLowerCase(),
          render: row => fmtLibLabel(st.libs.byId[row.owner_bibliotek_id]) || row.owner_bibliotek_id || ""
        },
        {
          id: "start_date",
          accessor: row => row.start_date || "",
          render: row => formatDateDisplay(row.start_date) || ""
        },
        {
          id: "end_date",
          accessor: row => row.end_date || "",
          render: row => formatDateDisplay(row.end_date) || ""
        },
        {
          id: "status",
          accessor: row => (row.booking_status || "").toLowerCase(),
          render: row => {
            const status = (row.booking_status || "").toLowerCase();
            const label = status === (BOOKING_STATUS_CANCELLED || "").toLowerCase() ? "Afvist" : status || "";
            const wrapper = el("span", {}, label || "");
            if (row.warning) {
              wrapper.appendChild(el("div", { class: "hint warning" }, row.warning));
            }
            return wrapper;
          }
        }
      ],
      stateRoot: sortState,
      defaultSort: { sortBy: "start_date", sortDir: "asc" },
      emptyText: "Ingen anmodninger.",
      rowActions: row => {
        const status = (row.booking_status || "").toLowerCase();
        const canCancel = CANCELLABLE_STATUSES.has(status);
        const buttonProps = {
          class: "btn btn-small",
          type: "button"
        };
        let btnLabel = "Annuller";
        if (status === (BOOKING_STATUS_CANCELLED || "").toLowerCase()) {
          buttonProps["data-my-dismiss"] = row.booking_id;
          btnLabel = "Fjern";
        } else {
          buttonProps["data-my-cancel"] = row.booking_id;
        }
        const btn = el("button", buttonProps, btnLabel);
        if (status === (BOOKING_STATUS_CANCELLED || "").toLowerCase()) {
          btn.title = "Fjern beskeden";
        } else if (canCancel) {
          btn.title = "Annuller anmodning";
        } else {
          btn.setAttribute("disabled", "disabled");
          btn.title = "Kan ikke annulleres";
          btn.classList.add("hint");
        }
        return btn;
      }
    });
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
    showMsg("#bMyMsg", "Henter anmodninger ?");
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
      const statusLower = (row.booking_status || "").toLowerCase();
      if (statusLower === (BOOKING_STATUS_CANCELLED || "").toLowerCase()) {
        warning = warning ? `Afvist - ${warning}` : "Afvist";
      }
      return {
        ...row,
        set: setInfo,
        warning
      };
    });
    st.booking.myRequests = enriched;
    renderBookerMyRequests(enriched);
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
    showMsg("#bMyMsg", "Annullerer anmodning ?");
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

  async function bookerDismissCancelledRequest(bookingId) {
    if (!bookingId) return;
    const requesterId = st.profile.bookerLocalId;
    if (!requesterId) return;
    const client = refreshClient();
    if (!client) return;
    try {
      await client
        .from("tbl_booking")
        .delete()
        .eq("booking_id", bookingId)
        .eq("requester_bibliotek_id", requesterId)
        .eq("booking_status", BOOKING_STATUS_CANCELLED);
    } catch (err) {
      showMsg("#bMyMsg", "Kunne ikke fjerne beskeden: " + err.message);
      return;
    }
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
      const label = `${formatDateDisplay(slot.start_date)} - ${formatDateDisplay(slot.end_date)}`;
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
          return normalize(row.bookingMode === BOOKING_MODE_SIMPLE ? BOOKING_MODE_SIMPLE : row.bookingRule);
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

  function renderBookerResults() {
    if (!$("#bTbl tbody")) return;
    const sortState = TableSortHelper.getSortState(st.b, { sortBy: "title", sortDir: "asc" });
    const from = st.b.page * st.b.pageSize;
    const to = from + st.b.pageSize;
    const sorted = [...(st.b.results || [])].sort(compareBookerRows);
    const slice = sorted.slice(from, to);
    TableSortHelper.renderTable({
      tableSelector: "#bTbl",
      rows: slice,
      manualSort: true,
      columns: [
        {
          id: "title",
          accessor: row => (row.title || "").toLowerCase(),
          render: row => row.title || ""
        },
        {
          id: "author",
          accessor: row => (row.author || "").toLowerCase(),
          render: row => row.author || ""
        },
        {
          id: "isbn",
          accessor: row => row.isbn || "",
          render: row => row.isbn || ""
        },
        {
          id: "faust",
          accessor: row => row.faust || "",
          render: row => row.faust || ""
        },
        {
          id: "visibility",
          accessor: row => row.visibility || "",
          render: row => row.visibility || ""
        },
        {
          id: "owner",
          accessor: row => (fmtLibLabel(st.libs.byId[row.owner_bibliotek_id]) || row.owner_bibliotek_id || "").toLowerCase(),
          render: row => {
            const owner = st.libs.byId[row.owner_bibliotek_id];
            return owner ? (owner.bibliotek_navn?.split(" ")[0] || fmtLibLabel(owner)) : row.owner_bibliotek_id || "";
          }
        },
        {
          id: "rule",
          accessor: row => row.bookingMode === BOOKING_MODE_SIMPLE ? BOOKING_MODE_SIMPLE : (row.bookingRule || ""),
          render: row => bookingRuleLabel(row.bookingRule, row.bookingMode) || "?"
        },
        {
          id: "loan_weeks",
          accessor: row => row.bookingMode === BOOKING_MODE_SIMPLE ? Number.MAX_SAFE_INTEGER : Number(row.loan_weeks) || 0,
          render: row => row.bookingMode === BOOKING_MODE_SIMPLE ? "2 mdr" : (row.loan_weeks ? `${row.loan_weeks}` : "")
        },
        {
          id: "requested_count",
          accessor: row => Number(row.requested_count) || 0,
          render: row => row.requested_count ? `${row.requested_count}` : ""
        },
        {
          id: "next",
          accessor: row => row.nextBooking?.start ? new Date(row.nextBooking.start).getTime() : Number.MAX_SAFE_INTEGER,
          render: row => row.availableSlots?.length
            ? renderSlotSelect(row)
            : el("span", { class: "hint" }, "Ingen ledige datoer")
        }
      ],
      stateRoot: st.b,
      defaultSort: { sortBy: "title", sortDir: "asc" },
      emptyText: "Ingen sæt fundet",
      rowActions: row => {
        const btn = el("button", {
          class: "btn btn-small",
          type: "button",
          "data-request-set": row.set_id
        }, "Anmod om booking");
        btn.disabled = !(row.availableSlots?.length);
        btn.addEventListener("click", ev => {
          ev.preventDefault();
          bookerRequestBooking(row.set_id);
        });
        return btn;
      }
    });
    const info = $("#bInfo");
    if (info) {
      const totalPages = Math.ceil((st.b.total || 0) / st.b.pageSize);
      info.textContent = st.b.total ? `Side ${st.b.page + 1}/${Math.max(1, totalPages)} af ${st.b.total} sæt` : "Ingen sæt fundet";
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
    let includeMode = bookingModeSupported;
    while (true) {
      const columns = includeMode
        ? "set_id,title,author,isbn,faust,visibility,owner_bibliotek_id,active,requested_count,loan_weeks,buffer_days,booking_mode"
        : "set_id,title,author,isbn,faust,visibility,owner_bibliotek_id,active,requested_count,loan_weeks,buffer_days";
      let qNat = client.from("tbl_saet")
        .select(columns)
        .ilike("visibility", "national")
        .eq("active", true);
      let qReg = client.from("tbl_saet")
        .select(columns)
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
      if (includeMode && (natRes.error || regRes.error)) {
        includeMode = false;
        bookingModeSupported = false;
        continue;
      }
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
  }

  async function bookerSearch() {
    if (!st.profile.bookerLocalId) {
      showMsg("#bMsg", "Vælg først en booker-profil (regionsbibliotek).");
      return;
    }
    const inventoryStore = window.InventoryStore || {};
    if (typeof inventoryStore.loadInventorySummary === "function") {
      try {
        await inventoryStore.loadInventorySummary();
      } catch (err) {
        console.warn("Kunne ikke opdatere beholdningsoversigt:", err);
      }
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
      const mode = getBookingMode(r);
      r.bookingMode = mode;
      const holidaySet = mode === BOOKING_MODE_SIMPLE ? null : await loadOwnerHolidaySet(r.owner_bibliotek_id);
      const bookings = bookingMap.get(r.set_id) || [];
      const rule = mode === BOOKING_MODE_SIMPLE ? BOOKING_MODE_SIMPLE : currentBookingRule(r.owner_bibliotek_id);
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
    const filtered = minWeeks ? results.filter(r => {
      const weeksValue = getBookingMode(r) === BOOKING_MODE_SIMPLE ? 8 : (Number(r.loan_weeks) || 0);
      return weeksValue >= minWeeks;
    }) : results;
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
      showMsg("#bMsg", "Vælg først et regionsbibliotek via Skift: Admin ? Booker.");
      return;
    }
    const bookingId = row.selectedSlotId || row.availableSlots?.[0]?.booking_id;
    if (!bookingId) {
      showMsg("#bMsg", "Vælg en ledig periode først.");
      return;
    }
    const inventoryStore = window.InventoryStore || {};
    const getInventoryCount = typeof inventoryStore.getInventoryCount === "function" ? inventoryStore.getInventoryCount : null;
    if (getInventoryCount && row.isbn) {
      const invCount = getInventoryCount(row.owner_bibliotek_id, row.isbn);
      if (!invCount || invCount <= 0) {
        showMsg("#bMsg", "Sæt kan ikke bookes: ingen eksemplarer tilgængelige.");
        return;
      }
    }
    const targetSlot = row.availableSlots?.find(slot => `${slot.booking_id}` === bookingId);
    if (!targetSlot) {
      showMsg("#bMsg", "Kunne ikke finde den valgte periode.");
      return;
    }
    const client = refreshClient();
    if (!client) return;
    showMsg("#bMsg", "Sender bookinganmodning .");
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
      if (btn.hasettribute("data-booking-approve")) {
        bookingRequestsUpdate(bookingId, "approve", setId);
      } else {
        bookingRequestsUpdate(bookingId, "cancel", setId);
      }
    });
    const sortState = TableSortHelper.getSortState(st.booking.requestsSort || (st.booking.requestsSort = {}), { sortBy: "start_date", sortDir: "asc" });
    TableSortHelper.attachSortHandlers("#tblBookingRequests", sortState, () => {
      renderBookingRequestsTable(st.booking.requests || []);
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
    const bookerSortState = TableSortHelper.getSortState(st.b, { sortBy: "title", sortDir: "asc" });
    TableSortHelper.attachSortHandlers("#bTbl", bookerSortState, () => {
      st.b.page = 0;
      renderBookerResults();
    });
    const requestSortState = TableSortHelper.getSortState(st.booking.myRequestsSort || (st.booking.myRequestsSort = { sortBy: "start_date", sortDir: "asc" }), { sortBy: "start_date", sortDir: "asc" });
    TableSortHelper.attachSortHandlers("#bMyTbl", requestSortState, () => {
      renderBookerMyRequests(st.booking.myRequests || []);
    });
    document.querySelectorAll("[data-booker-tab]")?.forEach(btn => {
      btn.addEventListener("click", () => {
        setBookerTab(btn.dataset.bookerTab || "search");
      });
    });
    $("#bMyTbl")?.addEventListener("click", evt => {
      const cancelBtn = evt.target.closest("button[data-my-cancel]");
      if (cancelBtn) {
        const bookingId = Number(cancelBtn.getAttribute("data-my-cancel"));
        if (bookingId) {
          bookerCancelRequest(bookingId);
        }
        return;
      }
      const dismissetn = evt.target.closest("button[data-my-dismiss]");
      if (dismissetn) {
        const bookingId = Number(dismissetn.getAttribute("data-my-dismiss"));
        if (bookingId) {
          bookerDismissCancelledRequest(bookingId);
        }
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
    renderBookerMyRequests,
    bookerMyRequestsPull,
    bookerCancelRequest,
    bookerDismissCancelledRequest,
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
  window.StoreRegistry?.registerStore?.("BookingStore", BookingStore);
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
