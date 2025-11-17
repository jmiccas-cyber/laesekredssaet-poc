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












