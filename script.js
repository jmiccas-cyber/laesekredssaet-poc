// Læsekredssæt – v3.1.9 (Hotfix – booking_status & eksemplarer)
// Forudsætter tbl_beholdning som i din schema.sql (booking_status + loan_status, ingen status-kolonne).

const SUPABASE_URL = "https://qlkrzinyqirnigcwadki.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFsa3J6aW55cWlybmlnY3dhZGtpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3NjY2NjgsImV4cCI6MjA3ODM0MjY2OH0.-SV3dn7reKHeYis40I-aF3av0_XmCP-ZqB9KR6JT2so";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------- State ----------
const st = {
  role: "admin",
  profile: {
    adminCentralId: null,
    bookerLocalId: null
  },
  libs: {
    list: [],
    byId: {}
  },
  // Admin: Eksemplarer
  eks: {
    pageSize: 20,
    page: 0,
    total: 0,
    filters: { booking_status: "", q: "" },
    allowedStatuses: ["Ledig", "Reserveret", "Booket"]
  },
  // Admin: Sæt
  saet: {
    pageSize: 15,
    page: 0,
    total: 0,
    filters: { owner: "", vis: "", q: "" }
  },
  // Booker
  b: {
    pageSize: 15,
    page: 0,
    total: 0,
    q: "",
    start: null,
    weeks: 8,
    centralIds: [],
    _cacheRows: []
  }
};

// ---------- Utils ----------
const $ = (sel) => document.querySelector(sel);

function el(tag, attrs = {}, ...kids) {
  const E = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") E.className = v;
    else if (k.startsWith("on")) E.addEventListener(k.substring(2), v);
    else E.setAttribute(k, v);
  }
  for (const c of kids) {
    if (c == null) continue;
    E.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return E;
}

function msg(id, text, ok = false) {
  const box = typeof id === "string" ? $(id) : id;
  if (!box) return;
  box.textContent = text;
  box.className = "msg " + (ok ? "ok" : "err");
  box.style.display = "block";
  setTimeout(() => {
    box.style.display = "none";
  }, 4000);
}

function formatLibLabel(x) {
  const tag = x.is_central ? "central" : "lokal";
  return `${x.bibliotek_navn} (${x.bibliotek_id}) · ${tag}`;
}

// ---------- Local storage for role/profile ----------
function saveProfile() {
  localStorage.setItem("lk_role", st.role);
  localStorage.setItem("lk_adminCentralId", st.profile.adminCentralId || "");
  localStorage.setItem("lk_bookerLocalId", st.profile.bookerLocalId || "");
}

function loadProfile() {
  st.role = localStorage.getItem("lk_role") || "admin";
  const a = localStorage.getItem("lk_adminCentralId");
  const b = localStorage.getItem("lk_bookerLocalId");
  if (a) st.profile.adminCentralId = a;
  if (b) st.profile.bookerLocalId = b;
}

// ---------- Role badge & layout ----------
function renderRoleBadge() {
  const rb = $("#roleBadge");
  const rt = $("#roleText");
  const pt = $("#profileText");

  rb.classList.toggle("role-admin", st.role === "admin");
  rb.classList.toggle("role-booker", st.role === "booker");
  rt.textContent = st.role === "admin" ? "Admin" : "Booker";

  if (st.role === "admin") {
    const id = st.profile.adminCentralId || "—";
    const lib = st.libs.byId[id];
    pt.textContent = lib
      ? ` · ${lib.bibliotek_navn} (${id})`
      : id !== "—"
      ? ` · ${id}`
      : "";
    const ro = $("#relCentralReadonly");
    if (ro) {
      ro.value = lib ? `${lib.bibliotek_navn} (${lib.bibliotek_id})` : "";
    }
  } else {
    const id = st.profile.bookerLocalId || "—";
    const lib = st.libs.byId[id];
    pt.textContent = lib
      ? ` · ${lib.bibliotek_navn} (${id})`
      : id !== "—"
      ? ` · ${id}`
      : "";
  }
}

function renderLayout() {
  const adminTabs = $("#adminTabs");
  const adminPanels = ["tab-eks", "tab-saet", "tab-region"].map((id) =>
    $("#" + id)
  );
  const bookerPanel = $("#bookerView");

  if (st.role === "admin") {
    adminTabs.classList.remove("hidden");
    adminPanels.forEach((p) => p.classList.remove("active", "hidden"));
    bookerPanel.classList.add("hidden");
    if (
      ![...document.querySelectorAll(".panel")].some((p) =>
        p.classList.contains("active")
      )
    ) {
      document
        .querySelector('nav.tabs button[data-tab="tab-eks"]')
        ?.click();
    }
  } else {
    adminTabs.classList.add("hidden");
    adminPanels.forEach((p) => p.classList.add("hidden"));
    document.querySelectorAll(".panel").forEach((p) =>
      p.classList.remove("active")
    );
    bookerPanel.classList.remove("hidden");
    bookerPanel.classList.add("active");
    const bl = st.libs.byId[st.profile.bookerLocalId];
    $("#bookerProfileText").textContent = bl
      ? `${bl.bibliotek_navn} (${bl.bibliotek_id})`
      : "—";
  }
}

// ---------- Tabs ----------
function bindTabs() {
  document.querySelectorAll("nav.tabs button[data-tab]").forEach((b) => {
    b.onclick = () => {
      document
        .querySelectorAll("nav.tabs button")
        .forEach((x) => x.classList.remove("active"));
      b.classList.add("active");

      document
        .querySelectorAll(".panel")
        .forEach((p) => p.classList.remove("active"));
      $("#" + b.dataset.tab).classList.add("active");

      if (b.dataset.tab === "tab-region") {
        relList();
      }
    };
  });
}

// ---------- Role/Profile modal ----------
function openRoleModal(target) {
  const modal = $("#roleModal");
  modal.style.display = "flex";

  const roleSel = $("#roleSelect");
  const adminWrap = $("#adminProfileWrap");
  const bookerWrap = $("#bookerProfileWrap");
  const adminSel = $("#adminProfileSel");
  const bookerSel = $("#bookerProfileSel");

  roleSel.value = target || st.role;

  // Fyld dropdowns
  adminSel.innerHTML = "";
  st.libs.list
    .filter((x) => x.active && x.is_central)
    .forEach((x) =>
      adminSel.append(el("option", { value: x.bibliotek_id }, formatLibLabel(x)))
    );

  bookerSel.innerHTML = "";
  st.libs.list
    .filter((x) => x.active && !x.is_central)
    .forEach((x) =>
      bookerSel.append(
        el("option", { value: x.bibliotek_id }, formatLibLabel(x))
      )
    );

  if (st.profile.adminCentralId) adminSel.value = st.profile.adminCentralId;
  if (st.profile.bookerLocalId) bookerSel.value = st.profile.bookerLocalId;

  const updRoleVisibility = () => {
    if (roleSel.value === "admin") {
      adminWrap.style.display = "flex";
      bookerWrap.style.display = "none";
    } else {
      adminWrap.style.display = "none";
      bookerWrap.style.display = "flex";
    }
  };
  updRoleVisibility();
  roleSel.onchange = updRoleVisibility;

  $("#roleSave").onclick = async () => {
    const newRole = roleSel.value;

    if (newRole === "admin") {
      st.role = "admin";
      st.profile.adminCentralId = adminSel.value || null;

      saveProfile();
      renderRoleBadge();
      renderLayout();
      await relList();
      modal.style.display = "none";
      return;
    }

    if (newRole === "booker") {
      const chosen = bookerSel.value;
      if (!chosen) {
        msg("#bMsg", "Vælg et aktivt lånerbibliotek.");
        return;
      }
      if (!st.libs.byId[chosen]) {
        msg("#bMsg", "Det valgte lånerbibliotek er deaktiveret. Vælg et andet.");
        return;
      }

      st.role = "booker";
      st.profile.bookerLocalId = chosen;

      await resolveBookerCentrals();
      st.b.page = 0;
      await bookerPull();

      saveProfile();
      renderRoleBadge();
      renderLayout();
      modal.style.display = "none";
      return;
    }
  };

  $("#roleCancel").onclick = () => {
    modal.style.display = "none";
  };
}

function bindRoleToggle() {
  $("#toggleRole")?.addEventListener("click", () => {
    const target = st.role === "admin" ? "booker" : "admin";
    openRoleModal(target);
  });
}

// ---------- Load libraries ----------
async function loadLibraries() {
  const { data, error } = await sb
    .from("tbl_bibliotek")
    .select("bibliotek_id,bibliotek_navn,is_central,active")
    .order("is_central", { ascending: false })
    .order("bibliotek_navn", { ascending: true });

  if (error) {
    console.error(error);
    return;
  }

  st.libs.list = (data || []).filter((x) => x.active);
  st.libs.byId = Object.fromEntries(
    st.libs.list.map((x) => [x.bibliotek_id, x])
  );

  // Sæt-ejer filter
  const saetOwner = $("#saetOwnerFilterSel");
  if (saetOwner) {
    saetOwner.innerHTML = "";
    saetOwner.append(el("option", { value: "" }, "(alle)"));
    st.libs.list.forEach((x) =>
      saetOwner.append(
        el(
          "option",
          { value: x.bibliotek_id },
          `${x.bibliotek_navn} (${x.bibliotek_id})`
        )
      )
    );
  }

  // Region dropdown for lånerbiblioteker
  const localSel = $("#relLocal");
  if (localSel) {
    localSel.innerHTML = "";
    st.libs.list
      .filter((x) => !x.is_central)
      .forEach((x) =>
        localSel.append(
          el(
            "option",
            { value: x.bibliotek_id },
            `${x.bibliotek_navn} (${x.bibliotek_id})`
          )
        )
      );
  }

  renderRoleBadge();
}

// ---------- Admin: Eksemplarer ----------

function bindEksControls() {
  $("#btnSearch").onclick = () => {
    st.eks.page = 0;
    eksPull();
  };
  $("#btnReload").onclick = () => eksPull();
  $("#prev").onclick = () => {
    if (st.eks.page > 0) {
      st.eks.page--;
      eksPull();
    }
  };
  $("#next").onclick = () => {
    const max = Math.ceil(st.eks.total / st.eks.pageSize) - 1;
    if (st.eks.page < max) {
      st.eks.page++;
      eksPull();
    }
  };

  $("#btnNew").onclick = eksAddRow;
  $("#btnSaveAll").onclick = eksSaveAll;

  $("#statusFilter").onchange = (e) => {
    st.eks.filters.booking_status = e.target.value || "";
  };

  $("#q").oninput = (e) => {
    st.eks.filters.q = e.target.value.trim();
  };
}

// Dropdown til booking_status (kun Ledig / Reserveret / Booket)
function eksStatusSelect(val) {
  const allowed = st.eks.allowedStatuses;
  const v = allowed.includes(val) ? val : "Ledig";

  const s = el("select", { class: "edit status" });
  s.append(
    el("option", { value: "Ledig", selected: v === "Ledig" }, "Ledig"),
    el(
      "option",
      { value: "Reserveret", selected: v === "Reserveret" },
      "Reserveret"
    ),
    el("option", { value: "Booket", selected: v === "Booket" }, "Booket")
  );
  return s;
}

function eksValidate(r) {
  if (!r.barcode) return "Stregkode skal udfyldes";
  if (!r.title) return "Titel skal udfyldes";
  if (
    r.booking_status &&
    !st.eks.allowedStatuses.includes(r.booking_status)
  ) {
    return "Ugyldig booking-status";
  }
  return null;
}

async function eksCount() {
  const centralId = st.profile.adminCentralId;
  let q = sb.from("tbl_beholdning").select("*", {
    count: "exact",
    head: true
  });

  if (centralId) {
    q = q.eq("owner_bibliotek_id", centralId);
  }

  const f = st.eks.filters;
  if (f.booking_status) {
    q = q.eq("booking_status", f.booking_status);
  }
  if (f.q) {
    q = q.or(
      [
        "title.ilike.%" + f.q + "%",
        "author.ilike.%" + f.q + "%",
        "isbn.ilike.%" + f.q + "%",
        "faust.ilike.%" + f.q + "%",
        "barcode.ilike.%" + f.q + "%"
      ].join(",")
    );
  }

  const { count, error } = await q;
  if (error) {
    msg("#msg", "Fejl ved optælling: " + error.message);
    return 0;
  }
  return count || 0;
}

async function eksFetch() {
  const centralId = st.profile.adminCentralId;
  const f = st.eks.filters;
  const from = st.eks.page * st.eks.pageSize;
  const to = from + st.eks.pageSize - 1;

  let q = sb
    .from("tbl_beholdning")
    .select(
      "barcode,isbn,faust,title,author,booking_status,loan_status,owner_bibliotek_id"
    )
    .order("barcode", { ascending: true })
    .range(from, to);

  if (centralId) q = q.eq("owner_bibliotek_id", centralId);
  if (f.booking_status) q = q.eq("booking_status", f.booking_status);
  if (f.q) {
    q = q.or(
      [
        "title.ilike.%" + f.q + "%",
        "author.ilike.%" + f.q + "%",
        "isbn.ilike.%" + f.q + "%",
        "faust.ilike.%" + f.q + "%",
        "barcode.ilike.%" + f.q + "%"
      ].join(",")
    );
  }

  const { data, error } = await q;
  if (error) {
    msg("#msg", "Fejl ved hentning: " + error.message);
    return [];
  }
  return data || [];
}

async function eksPull() {
  if (st.role !== "admin" || !st.profile.adminCentralId) {
    const tb = $("#tblEks tbody");
    tb.innerHTML = "";
    $("#pinfo").textContent =
      "Vælg først en admin-profil (centralbibliotek) via Skift: Admin ↔ Booker.";
    return;
  }

  st.eks.total = await eksCount();
  const rows = await eksFetch();
  const tb = $("#tblEks tbody");
  tb.innerHTML = "";

  rows.forEach((r) => {
    const tr = el("tr");
    tr.dataset.barcode = r.barcode;

    const bcCell = el(
      "td",
      {},
      el("span", { class: "k bc-label" }, r.barcode || "")
    );
    const ti = el("input", {
      class: "edit title",
      value: r.title || ""
    });
    const au = el("input", {
      class: "edit author",
      value: r.author || ""
    });
    const isb = el("input", {
      class: "edit isbn",
      value: r.isbn || ""
    });
    const fa = el("input", {
      class: "edit faust",
      value: r.faust || ""
    });

    const stSel = eksStatusSelect(r.booking_status);

    const btnDel = el(
      "button",
      {
        class: "btn danger",
        onclick: async () => {
          if (!confirm("Slet eksemplar " + r.barcode + "?")) return;
          const { error } = await sb
            .from("tbl_beholdning")
            .delete()
            .eq("barcode", r.barcode);
          if (error) {
            msg("#msg", "Fejl ved sletning: " + error.message);
          } else {
            msg("#msg", "Eksemplar slettet", true);
            eksPull();
          }
        }
      },
      "Slet"
    );

    tr.append(
      bcCell,
      el("td", {}, ti),
      el("td", {}, au),
      el("td", {}, isb),
      el("td", {}, fa),
      el("td", {}, stSel),
      el("td", {}, btnDel)
    );
    tb.append(tr);
  });

  const pages = Math.max(1, Math.ceil(st.eks.total / st.eks.pageSize));
  $("#pinfo").textContent = `Side ${st.eks.page + 1} af ${pages} • ${
    st.eks.total
  } eksemplarer`;
}

function eksAddRow() {
  if (st.role !== "admin" || !st.profile.adminCentralId) {
    msg(
      "#msg",
      "Nye eksemplarer kan kun oprettes af et indlogget centralbibliotek (Admin-profil)."
    );
    return;
  }

  const tb = $("#tblEks tbody");
  const tr = el("tr");
  tr.dataset.new = "1";

  const bcInput = el("input", {
    class: "edit bc",
    placeholder: "Stregkode (unik)"
  });
  const ti = el("input", { class: "edit title", placeholder: "Titel" });
  const au = el("input", { class: "edit author", placeholder: "Forfatter" });
  const isb = el("input", { class: "edit isbn", placeholder: "ISBN" });
  const fa = el("input", { class: "edit faust", placeholder: "FAUST" });
  const stSel = eksStatusSelect("Ledig");

  const btnCancel = el(
    "button",
    {
      class: "btn ghost",
      onclick: () => tr.remove()
    },
    "Annullér"
  );

  tr.append(
    el("td", {}, bcInput),
    el("td", {}, ti),
    el("td", {}, au),
    el("td", {}, isb),
    el("td", {}, fa),
    el("td", {}, stSel),
    el("td", {}, btnCancel)
  );

  tb.prepend(tr);
}

async function eksSaveAll() {
  if (st.role !== "admin" || !st.profile.adminCentralId) {
    msg("#msg", "Gem kræver en aktiv Admin-profil med centralbibliotek.");
    return;
  }

  const centralId = st.profile.adminCentralId;
  const rows = Array.from(document.querySelectorAll("#tblEks tbody tr"));

  if (!rows.length) {
    msg("#msg", "Ingen rækker at gemme.");
    return;
  }

  const toInsert = [];
  const toUpdate = [];

  for (const tr of rows) {
    const isNew = tr.dataset.new === "1";

    const bcInput = tr.querySelector(".bc");
    const bcLabel = tr.querySelector(".bc-label");
    const barcode = (bcInput ? bcInput.value : bcLabel?.textContent || "")
      .trim();

    const title = tr.querySelector(".title")?.value.trim() || "";
    const author = tr.querySelector(".author")?.value.trim() || "";
    const isbn = tr.querySelector(".isbn")?.value.trim() || "";
    const faust = tr.querySelector(".faust")?.value.trim() || "";
    const booking_status =
      tr.querySelector(".status")?.value || "Ledig";

    const err = eksValidate({ barcode, title, booking_status });
    if (err) {
      msg("#msg", `Fejl i række (${barcode || "ny"}): ` + err);
      return;
    }

    const payload = {
      barcode,
      title,
      author,
      isbn,
      faust,
      booking_status,      // POC-status i systemet
      loan_status: "Ukendt", // placeholder indtil FBI-API
      owner_bibliotek_id: centralId
    };

    if (isNew) toInsert.push(payload);
    else toUpdate.push(payload);
  }

  try {
    if (toInsert.length) {
      const { error: insErr } = await sb
        .from("tbl_beholdning")
        .insert(toInsert);
      if (insErr) throw insErr;
    }

    for (const row of toUpdate) {
      const { barcode, loan_status, ...rest } = row;
      const { error: updErr } = await sb
        .from("tbl_beholdning")
        .update(rest)
        .eq("barcode", barcode);
      if (updErr) throw updErr;
    }

    msg("#msg", "Alle ændringer gemt", true);
    eksPull();
  } catch (e) {
    console.error("eksSaveAll error", e);
    msg("#msg", "Fejl ved gem: " + e.message);
  }
}

// ---------- Admin: Sæt (som før, bare let opryddet) ----------

function bindSaetControls() {
  $("#btnSaetSearch").onclick = () => {
    st.saet.page = 0;
    saetPull();
  };
  $("#saetPrev").onclick = () => {
    if (st.saet.page > 0) {
      st.saet.page--;
      saetPull();
    }
  };
  $("#saetNext").onclick = () => {
    const m = Math.ceil(st.saet.total / st.saet.pageSize) - 1;
    if (st.saet.page < m) {
      st.saet.page++;
      saetPull();
    }
  };
  $("#btnSaetNew").onclick = saetAddRow;
  $("#saetOwnerFilterSel").onchange = (e) => {
    st.saet.filters.owner = e.target.value;
  };
  $("#saetVisFilter").onchange = (e) => {
    st.saet.filters.vis = e.target.value;
  };
  $("#saetQ").oninput = (e) => {
    st.saet.filters.q = e.target.value.trim();
  };
}

function saetValidate(r) {
  if (!r.title) return "title skal udfyldes";
  if (!["national", "regional"].includes(r.visibility))
    return "visibility skal være national eller regional";
  if (!r.owner_bibliotek_id) return "owner_bibliotek_id skal udfyldes";
  if (
    r.requested_count < 0 ||
    r.loan_weeks < 0 ||
    r.buffer_days < 0 ||
    r.min_delivery < 0
  )
    return "talværdier må ikke være negative";
  return null;
}

async function saetCount() {
  let q = sb.from("tbl_saet").select("*", {
    count: "exact",
    head: true
  });
  const f = st.saet.filters;
  if (f.owner) q = q.eq("owner_bibliotek_id", f.owner);
  if (f.vis) q = q.eq("visibility", f.vis);
  if (f.q) {
    q = q.or(
      [
        "title.ilike.%" + f.q + "%",
        "author.ilike.%" + f.q + "%",
        "isbn.ilike.%" + f.q + "%",
        "faust.ilike.%" + f.q + "%"
      ].join(",")
    );
  }
  const { count, error } = await q;
  if (error) {
    msg("#msgSaet", "Fejl ved optælling: " + error.message);
    return 0;
  }
  return count || 0;
}

async function saetFetch() {
  const f = st.saet.filters;
  const from = st.saet.page * st.saet.pageSize;
  const to = from + st.saet.pageSize - 1;

  let q = sb
    .from("tbl_saet")
    .select(
      "set_id,title,author,isbn,faust,requested_count,loan_weeks,buffer_days,visibility,owner_bibliotek_id,active,allow_substitution,allow_partial,min_delivery"
    )
    .order("set_id", { ascending: true })
    .range(from, to);

  if (f.owner) q = q.eq("owner_bibliotek_id", f.owner);
  if (f.vis) q = q.eq("visibility", f.vis);
  if (f.q) {
    q = q.or(
      [
        "title.ilike.%" + f.q + "%",
        "author.ilike.%" + f.q + "%",
        "isbn.ilike.%" + f.q + "%",
        "faust.ilike.%" + f.q + "%"
      ].join(",")
    );
  }

  const { data, error } = await q;
  if (error) {
    msg("#msgSaet", "Fejl ved hentning: " + error.message);
    return [];
  }
  return data || [];
}

async function saetPull() {
  st.saet.total = await saetCount();
  const rows = await saetFetch();
  const tb = $("#tblSaet tbody");
  tb.innerHTML = "";

  rows.forEach((r) => {
    const tr = el("tr");

    const id = el("td", {}, String(r.set_id));
    const ti = el("input", { class: "edit s_title", value: r.title || "" });
    const au = el("input", { class: "edit s_author", value: r.author || "" });
    const isb = el("input", { class: "edit s_isbn", value: r.isbn || "" });
    const fa = el("input", { class: "edit s_faust", value: r.faust || "" });
    const rc = el("input", {
      class: "edit s_rc",
      type: "number",
      value: r.requested_count ?? 0
    });
    const lw = el("input", {
      class: "edit s_lw",
      type: "number",
      value: r.loan_weeks ?? 8
    });
    const bd = el("input", {
      class: "edit s_bd",
      type: "number",
      value: r.buffer_days ?? 0
    });

    const vis = el(
      "select",
      { class: "edit s_vis" },
      el(
        "option",
        { value: "national", selected: r.visibility === "national" },
        "national"
      ),
      el(
        "option",
        { value: "regional", selected: r.visibility === "regional" },
        "regional"
      )
    );

    const ow = el("input", {
      class: "edit s_ow",
      value: r.owner_bibliotek_id || ""
    });

    const act = el(
      "select",
      { class: "edit s_act" },
      el(
        "option",
        { value: "true", selected: r.active === true },
        "Ja"
      ),
      el(
        "option",
        { value: "false", selected: r.active === false },
        "Nej"
      )
    );

    const sub = el(
      "select",
      { class: "edit s_sub" },
      el(
        "option",
        { value: "true", selected: r.allow_substitution === true },
        "Ja"
      ),
      el(
        "option",
        { value: "false", selected: r.allow_substitution === false },
        "Nej"
      )
    );

    const par = el(
      "select",
      { class: "edit s_par" },
      el(
        "option",
        { value: "true", selected: r.allow_partial === true },
        "Ja"
      ),
      el(
        "option",
        { value: "false", selected: r.allow_partial === false },
        "Nej"
      )
    );

    const md = el("input", {
      class: "edit s_md",
      type: "number",
      value: r.min_delivery ?? 0
    });

    const btnDel = el(
      "button",
      {
        class: "btn danger",
        style: "margin-left:6px;",
        onclick: async () => {
          if (!confirm("Slet sæt " + r.set_id + "?")) return;
          const { error } = await sb
            .from("tbl_saet")
            .delete()
            .eq("set_id", r.set_id);
          if (error) {
            msg("#msgSaet", "Fejl ved sletning: " + error.message);
          } else {
            msg("#msgSaet", "Sæt slettet", true);
            saetPull();
          }
        }
      },
      "Slet"
    );

    tr.append(
      id,
      el("td", {}, ti),
      el("td", {}, au),
      el("td", {}, isb),
      el("td", {}, fa),
      el("td", {}, rc),
      el("td", {}, lw),
      el("td", {}, bd),
      el("td", {}, vis),
      el("td", {}, ow),
      el("td", {}, act),
      el("td", {}, sub),
      el("td", {}, par),
      el("td", {}, md),
      el("td", {}, btnDel)
    );
    tb.append(tr);
  });

  const pages = Math.max(1, Math.ceil(st.saet.total / st.saet.pageSize));
  $("#saetPinfo").textContent = `Side ${st.saet.page + 1} af ${pages} • ${
    st.saet.total
  } rækker`;
}

function saetAddRow() {
  const tb = $("#tblSaet tbody");
  const tr = el("tr");
  tr.append(
    el("td", {}, "(ny)"),
    el("td", {}, el("input", { class: "edit s_title", placeholder: "Titel" })),
    el(
      "td",
      {},
      el("input", { class: "edit s_author", placeholder: "Forfatter" })
    ),
    el("td", {}, el("input", { class: "edit s_isbn", placeholder: "ISBN" })),
    el("td", {}, el("input", { class: "edit s_faust", placeholder: "FAUST" })),
    el(
      "td",
      {},
      el("input", { class: "edit s_rc", type: "number", value: "10" })
    ),
    el(
      "td",
      {},
      el("input", { class: "edit s_lw", type: "number", value: "8" })
    ),
    el(
      "td",
      {},
      el("input", { class: "edit s_bd", type: "number", value: "0" })
    ),
    el(
      "td",
      {},
      (() => {
        const s = el("select", { class: "edit s_vis" });
        s.append(
          el("option", { value: "national" }, "national"),
          el("option", { value: "regional" }, "regional")
        );
        return s;
      })()
    ),
    el(
      "td",
      {},
      el("input", { class: "edit s_ow", placeholder: "Ejer (fx GENT)" })
    ),
    el(
      "td",
      {},
      (() => {
        const s = el("select", { class: "edit s_act" });
        s.append(
          el("option", { value: "true", selected: true }, "Ja"),
          el("option", { value: "false" }, "Nej")
        );
        return s;
      })()
    ),
    el(
      "td",
      {},
      (() => {
        const s = el("select", { class: "edit s_sub" });
        s.append(
          el("option", { value: "false", selected: true }, "Nej"),
          el("option", { value: "true" }, "Ja")
        );
        return s;
      })()
    ),
    el(
      "td",
      {},
      (() => {
        const s = el("select", { class: "edit s_par" });
        s.append(
          el("option", { value: "false", selected: true }, "Nej"),
          el("option", { value: "true" }, "Ja")
        );
        return s;
      })()
    ),
    el(
      "td",
      {},
      el("input", { class: "edit s_md", type: "number", value: "0" })
    ),
    el(
      "td",
      {},
      el(
        "button",
        {
          class: "btn primary",
          onclick: async () => {
            const row = {
              title: tr.querySelector(".s_title").value.trim(),
              author: tr.querySelector(".s_author").value.trim(),
              isbn: tr.querySelector(".s_isbn").value.trim(),
              faust: tr.querySelector(".s_faust").value.trim(),
              requested_count: Number(
                tr.querySelector(".s_rc").value || 0
              ),
              loan_weeks: Number(tr.querySelector(".s_lw").value || 0),
              buffer_days: Number(tr.querySelector(".s_bd").value || 0),
              visibility: tr.querySelector(".s_vis").value,
              owner_bibliotek_id: tr.querySelector(".s_ow").value.trim(),
              active: true,
              allow_substitution: false,
              allow_partial: false,
              min_delivery: 0
            };
            const e = saetValidate(row);
            if (e) {
              msg("#msgSaet", e);
              return;
            }
            const { error } = await sb.from("tbl_saet").insert(row);
            if (error) {
              msg("#msgSaet", "Fejl ved oprettelse: " + error.message);
            } else {
              msg("#msgSaet", "Sæt oprettet", true);
              saetPull();
            }
          }
        },
        "Opret"
      ),
      el(
        "button",
        {
          class: "btn ghost",
          style: "margin-left:6px;",
          onclick: () => tr.remove()
        },
        "Annullér"
      )
    )
  );
  tb.prepend(tr);
}

// ---------- Admin: Region ----------

function bindRelControls() {
  $("#btnRelAdd").onclick = relAdd;
  $("#btnCreateLocal").onclick = createLocalLibrary;
}

function relBuildLocalDropdown(excludeIds = new Set()) {
  const localSel = $("#relLocal");
  if (!localSel) return;
  localSel.innerHTML = "";
  st.libs.list
    .filter(
      (x) =>
        x.active && !x.is_central && !excludeIds.has(x.bibliotek_id)
    )
    .forEach((x) =>
      localSel.append(
        el(
          "option",
          { value: x.bibliotek_id },
          `${x.bibliotek_navn} (${x.bibliotek_id})`
        )
      )
    );
}

async function createLocalLibrary() {
  const centralId = st.profile.adminCentralId;
  if (!centralId) {
    msg("#msgRel", "Vælg først en admin-profil (central).");
    return;
  }

  const id = ($("#newLocalId").value || "").trim();
  const name = ($("#newLocalName").value || "").trim();
  const active = $("#newLocalActive").value === "true";

  if (!id || !/^[A-Z0-9_/-]{1,20}$/i.test(id)) {
    msg(
      "#msgRel",
      "Ugyldigt ID. Brug 1–20 ASCII-tegn (bogstaver/tal/_-/)."
    );
    return;
  }
  if (!name) {
    msg("#msgRel", "Angiv et navn.");
    return;
  }

  const { error: e1 } = await sb.from("tbl_bibliotek").insert({
    bibliotek_id: id,
    bibliotek_navn: name,
    is_central: false,
    active
  });
  if (e1) {
    msg("#msgRel", "Fejl ved oprettelse af bibliotek: " + e1.message);
    return;
  }

  const { error: e2 } = await sb.from("tbl_bibliotek_relation").insert({
    bibliotek_id: id,
    central_id: centralId,
    active: true
  });
  if (e2) {
    msg(
      "#msgRel",
      "Bibliotek oprettet, men fejl ved relation: " + e2.message
    );
  }

  msg("#msgRel", "Lånerbibliotek oprettet og relateret", true);

  $("#newLocalId").value = "";
  $("#newLocalName").value = "";
  $("#newLocalActive").value = "true";

  await loadLibraries();
  await relList();
}

async function relList() {
  const centralId = st.profile.adminCentralId;
  const msgBox = "#msgRel";
  if (!centralId) {
    msg(
      msgBox,
      'Vælg først en admin-profil (centralbibliotek) via “Skift: Admin ↔ Booker”.'
    );
    const tb = $("#tblRel tbody");
    if (tb) tb.innerHTML = "";
    $("#relCentralReadonly").value = "";
    relBuildLocalDropdown(new Set());
    return;
  }

  const lib = st.libs.byId[centralId];
  $("#relCentralReadonly").value = lib
    ? `${lib.bibliotek_navn} (${lib.bibliotek_id})`
    : centralId;

  const { data, error } = await sb
    .from("tbl_bibliotek_relation")
    .select("relation_id,bibliotek_id,central_id,active")
    .eq("central_id", centralId)
    .order("relation_id");

  if (error) {
    msg(msgBox, "Fejl ved hentning af relationer: " + error.message);
    return;
  }

  const tb = $("#tblRel tbody");
  tb.innerHTML = "";
  const related = new Set((data || []).map((r) => r.bibliotek_id));
  relBuildLocalDropdown(related);

  (data || []).forEach((r) => {
    const local = st.libs.byId[r.bibliotek_id];
    const central = st.libs.byId[r.central_id];
    const tr = el("tr");

    const activeSel = el(
      "select",
      {},
      el("option", { value: "true", selected: !!r.active }, "Ja"),
      el("option", { value: "false", selected: !r.active }, "Nej")
    );

    const btnDel = el(
      "button",
      {
        class: "btn danger",
        style: "margin-left:6px;",
        onclick: async () => {
          const hasActive = await bibliotekHasActiveBookings(
            r.bibliotek_id,
            centralId
          );
          if (hasActive) {
            msg(
              msgBox,
              "Biblioteket har en eller flere aktive bookinger og kan derfor ikke slettes"
            );
            return;
          }
          if (
            !confirm(
              `Slet relation #${r.relation_id} (${r.bibliotek_id} → ${centralId})?`
            )
          )
            return;
          const { error } = await sb
            .from("tbl_bibliotek_relation")
            .delete()
            .eq("relation_id", r.relation_id)
            .eq("central_id", centralId);
          if (error) {
            msg(msgBox, "Fejl ved sletning: " + error.message);
          } else {
            msg(msgBox, "Relation slettet", true);
            relList();
          }
        }
      },
      "Slet"
    );

    const localObj = st.libs.byId[r.bibliotek_id];
    const borrowerActiveSel = el(
      "select",
      {},
      el(
        "option",
        { value: "true", selected: !!(localObj && localObj.active) },
        "Ja"
      ),
      el(
        "option",
        { value: "false", selected: !(localObj && localObj.active) },
        "Nej"
      )
    );

    const btnBorrowerSave = el(
      "button",
      {
        class: "btn",
        style: "margin-left:6px;",
        onclick: async () => {
          const newActive = borrowerActiveSel.value === "true";
          const { error } = await sb
            .from("tbl_bibliotek")
            .update({ active: newActive })
            .eq("bibliotek_id", r.bibliotek_id);
          if (error) {
            msg(
              msgBox,
              "Fejl ved opdatering af låner: " + error.message
            );
            return;
          }
          msg(msgBox, "Lånerbibliotek opdateret", true);
          await loadLibraries();
          await relList();
        }
      },
      "Gem"
    );

    tr.append(
      el("td", {}, String(r.relation_id)),
      el(
        "td",
        {},
        local
          ? `${local.bibliotek_navn} (${local.bibliotek_id})`
          : r.bibliotek_id
      ),
      el(
        "td",
        {},
        central
          ? `${central.bibliotek_navn} (${central.bibliotek_id})`
          : r.central_id
      ),
      el("td", {}, activeSel),
      el(
        "td",
        {},
        borrowerActiveSel,
        btnBorrowerSave,
        btnDel
      )
    );
    tb.append(tr);
  });
}

async function relAdd() {
  const centralId = st.profile.adminCentralId;
  if (!centralId) {
    msg("#msgRel", "Vælg først en admin-profil (centralbibliotek).");
    return;
  }
  const local = $("#relLocal").value;
  if (!local) {
    msg("#msgRel", "Vælg lånerbibliotek.");
    return;
  }
  if (local === centralId) {
    msg("#msgRel", "Central og låner må ikke være samme ID");
    return;
  }

  const { error } = await sb.from("tbl_bibliotek_relation").insert({
    bibliotek_id: local,
    central_id: centralId,
    active: true
  });
  if (error) {
    msg("#msgRel", "Fejl ved oprettelse: " + error.message);
  } else {
    msg("#msgRel", "Relation oprettet", true);
    relList();
  }
}

async function bibliotekHasActiveBookings(bibliotekId, centralId) {
  const { count, error } = await sb
    .from("tbl_booking")
    .select("booking_id", { count: "exact", head: true })
    .eq("requester_bibliotek_id", bibliotekId)
    .eq("owner_bibliotek_id", centralId)
    .in("status", ["pending", "approved"]);
  if (error) {
    console.error("booking check error", error);
    return false;
  }
  return (count || 0) > 0;
}

// ---------- BOOKER ----------

async function resolveBookerCentrals() {
  st.b.centralIds = [];
  const bookerId = st.profile.bookerLocalId;
  if (!bookerId) return;

  const { data, error } = await sb
    .from("tbl_bibliotek_relation")
    .select("central_id,active")
    .eq("bibliotek_id", bookerId)
    .eq("active", true);
  if (error) {
    console.error(error);
    return;
  }
  st.b.centralIds = (data || []).map((x) => x.central_id);
}

function bindBookerControls() {
  $("#bQ").oninput = (e) => {
    st.b.q = e.target.value.trim();
  };
  $("#bStart").onchange = (e) => {
    st.b.start = e.target.value || null;
  };
  $("#bWeeks").onchange = (e) => {
    st.b.weeks = Number(e.target.value || 8);
  };
  $("#bSearch").onclick = () => {
    st.b.page = 0;
    bookerPull();
  };
  $("#bPrev").onclick = () => {
    if (st.b.page > 0) {
      st.b.page--;
      bookerPull();
    }
  };
  $("#bNext").onclick = () => {
    const m = Math.ceil(st.b.total / st.b.pageSize) - 1;
    if (st.b.page < m) {
      st.b.page++;
      bookerPull();
    }
  };
}

async function bookerFetchAllowedSets() {
  const filters = [];
  if (st.b.q) {
    filters.push("title.ilike.%" + st.b.q + "%");
    filters.push("author.ilike.%" + st.b.q + "%");
    filters.push("isbn.ilike.%" + st.b.q + "%");
    filters.push("faust.ilike.%" + st.b.q + "%");
  }
  const searchOr = filters.length ? filters.join(",") : null;

  let qNat = sb
    .from("tbl_saet")
    .select(
      "set_id,title,author,isbn,faust,visibility,owner_bibliotek_id,active"
    )
    .eq("visibility", "national")
    .eq("active", true);
  if (searchOr) qNat = qNat.or(searchOr);

  let regionRows = [];
  if (st.b.centralIds.length) {
    let qReg = sb
      .from("tbl_saet")
      .select(
        "set_id,title,author,isbn,faust,visibility,owner_bibliotek_id,active"
      )
      .eq("visibility", "regional")
      .in("owner_bibliotek_id", st.b.centralIds)
      .eq("active", true);
    if (searchOr) qReg = qReg.or(searchOr);
    const { data: regData, error: regErr } = await qReg;
    if (regErr) {
      msg("#bMsg", "Fejl ved regional søgning: " + regErr.message);
    }
    regionRows = regData || [];
  }

  const { data: natData, error: natErr } = await qNat;
  if (natErr) {
    msg("#bMsg", "Fejl ved national søgning: " + natErr.message);
    return [];
  }

  const all = [...(natData || []), ...regionRows];
  all.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  return all;
}

async function bookerCount() {
  const rows = await bookerFetchAllowedSets();
  st.b._cacheRows = rows;
  return rows.length;
}

async function bookerPull() {
  const total = await bookerCount();
  st.b.total = total;
  const from = st.b.page * st.b.pageSize;
  const to = from + st.b.pageSize;
  const pageRows = (st.b._cacheRows || []).slice(from, to);

  const tb = $("#bTbl tbody");
  tb.innerHTML = "";

  pageRows.forEach((r) => {
    const owner = st.libs.byId[r.owner_bibliotek_id];
    const tr = el("tr");

    const btn = el(
      "button",
      {
        class: "btn primary",
        onclick: () => {
          alert(
            `Anmod om booking\n\nSæt: ${r.title}\nEjer (central): ${
              owner
                ? owner.bibliotek_navn + " (" + owner.bibliotek_id + ")"
                : r.owner_bibliotek_id
            }\nPeriode: ${$("#bStart").value || "(ikke valgt)"} • ${
              $("#bWeeks").value || 8
            } uger`
          );
        }
      },
      "Anmod om booking"
    );

    tr.append(
      el("td", {}, r.title || ""),
      el("td", {}, r.author || ""),
      el("td", {}, r.isbn || ""),
      el("td", {}, r.faust || ""),
      el("td", {}, r.visibility || ""),
      el(
        "td",
        {},
        owner
          ? `${owner.bibliotek_navn} (${owner.bibliotek_id})`
          : r.owner_bibliotek_id
      ),
      el("td", {}, btn)
    );
    tb.append(tr);
  });

  const pages = Math.max(1, Math.ceil(total / st.b.pageSize));
  $("#bInfo").textContent = `Side ${st.b.page + 1} af ${pages} • ${total} sæt`;
}

// ---------- Bindings & boot ----------

function bindAdmin() {
  bindTabs();
  bindEksControls();
  bindSaetControls();
  bindRelControls();
}

function bindGlobal() {
  bindRoleToggle();
  bindBookerControls();
}

async function boot() {
  loadProfile();
  bindGlobal();
  bindAdmin();
  await loadLibraries();
  renderRoleBadge();
  renderLayout();

  eksPull();
  saetPull();
  relList();

  if (st.role === "booker") {
    await resolveBookerCentrals();
    await bookerPull();
  }
}

boot();
