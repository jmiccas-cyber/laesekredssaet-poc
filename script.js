/* Læsekredssæt – POC v2.8
 * script.js — Supabase-connected search + simple availability
 * -----------------------------------------------------------
 * Requirements in index.html (before this script):
 *  <script src="https://unpkg.com/@supabase/supabase-js@2"></script>
 *  <script>
 *    window.SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
 *    window.SUPABASE_ANON_KEY = "YOUR-ANON-KEY";
 *  </script>
 */

// ---------- Supabase client ----------
let sb = null;
(function initSupabase() {
  const url = window.SUPABASE_URL;
  const key = window.SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error("Supabase URL/Anon key missing. Set them in index.html.");
    return;
  }
  sb = window.supabase.createClient(url, key);
})();

// ---------- DOM helpers ----------
const $ = (id) => document.getElementById(id);
const resultsDiv = $("results");
const importBtn = $("importBtn");
const fileUpload = $("fileUpload");

// Simple message helpers
function setStatus(el, html) {
  el.innerHTML = html;
}
function escapeHTML(str) {
  return (str ?? "")
    .toString()
    .replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
}

// ---------- Data access ----------
/**
 * Search Saet by title/author/FAUST/ISBN (case-insensitive).
 * If q is empty, returns a default list (limit 20).
 */
async function searchSaet(q) {
  if (!sb) throw new Error("Supabase client not initialized");

  if (!q || q.trim() === "") {
    const { data, error } = await sb.from("Saet").select("*").limit(20);
    if (error) throw error;
    return data;
  }

  const needle = `%${q.trim()}%`;
  const { data, error } = await sb
    .from("Saet")
    .select("*")
    .or(
      `Titel.ilike.${needle},Forfatter.ilike.${needle},FAUST.ilike.${needle},ISBN.ilike.${needle}`
    )
    .limit(50);

  if (error) throw error;
  return data;
}

/**
 * Returns count of available copies for a set (by matching ISBN or FAUST) from Beholdning.
 * Counts rows with Status = 'Ledig'.
 */
async function getAvailableCountForSet(setRow) {
  if (!sb) return 0;
  const filters = [];
  if (setRow?.ISBN) filters.push(`ISBN.eq.${setRow.ISBN}`);
  if (setRow?.FAUST) filters.push(`FAUST.eq.${setRow.FAUST}`);

  // If neither ISBN nor FAUST exists, we can't correlate; return 0 gracefully.
  if (filters.length === 0) return 0;

  // Build a query with OR if both exist
  let q = sb.from("Beholdning").select("Stregkode", { count: "exact", head: true }).eq("Status", "Ledig");
  if (filters.length === 2) {
    q = q.or(filters.join(","));
  } else {
    // Single filter
    const [single] = filters;
    const [col, , val] = single.split(".");
    q = q.eq(col, val);
  }

  const { count, error } = await q;
  if (error) {
    console.warn("Availability count error:", error);
    return 0;
  }
  return count ?? 0;
}

/**
 * Given an array of Saet rows, attach a computed 'availableCount' for each (in parallel).
 */
async function attachAvailability(sets) {
  const withCounts = await Promise.all(
    sets.map(async (s) => {
      const available = await getAvailableCountForSet(s);
      return { ...s, availableCount: available };
    })
  );
  return withCounts;
}

// ---------- Rendering ----------
function renderResults(sets) {
  resultsDiv.innerHTML = "";
  if (!sets || sets.length === 0) {
    resultsDiv.innerHTML = "<p>Ingen resultater.</p>";
    return;
  }

  sets.forEach((s) => {
    const card = document.createElement("div");
    card.className = "result-card";
    const title = escapeHTML(s.Titel);
    const author = escapeHTML(s.Forfatter);
    const faust = escapeHTML(s.FAUST);
    const isbn = escapeHTML(s.ISBN);
    const synlighed = escapeHTML(s.Synlighed);
    const antal = s.Antal ?? "—";
    const avail = Number.isFinite(s.availableCount) ? s.availableCount : "—";
    const availBadgeClass = typeof s.availableCount === "number" && s.availableCount > 0 ? "green" : "red";
    const availText = typeof s.availableCount === "number" ? (s.availableCount > 0 ? "Ledig" : "Optaget") : "Ukendt";

    card.innerHTML = `
      <strong>${title}</strong> — ${author}<br/>
      FAUST: ${faust} · ISBN: ${isbn}<br/>
      <span class="badge blue">Synlighed: ${synlighed || "—"}</span>
      <span class="badge">Antal: ${antal}</span>
      <span class="badge ${availBadgeClass}">${availText}${typeof avail === "number" ? ` (${avail})` : ""}</span>
    `;
    resultsDiv.appendChild(card);
  });
}

// ---------- Events ----------
$("search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("searchQuery").value;
  setStatus(resultsDiv, "Søger…");

  try {
    const sets = await searchSaet(q);
    const withAvail = await attachAvailability(sets);
    renderResults(withAvail);
  } catch (err) {
    console.error(err);
    setStatus(resultsDiv, `<p style="color:red">Fejl ved søgning: ${escapeHTML(err.message)}</p>`);
  }
});

// Demo import handler (no backend write in POC)
if (importBtn) {
  importBtn.addEventListener("click", () => {
    const log = $("inventory-log");
    if (!fileUpload || !fileUpload.files || fileUpload.files.length === 0) {
      setStatus(log, "<p style='color:red'>Vælg en fil først.</p>");
      return;
    }
    const file = fileUpload.files[0];
    setStatus(log, `<p>Importerede: <strong>${escapeHTML(file.name)}</strong> (demo – ingen backend endnu)</p>`);
  });
}

// Optional: UX niceties (keyup = live search)
$("searchQuery").addEventListener("keyup", debounce(async () => {
  const q = $("searchQuery").value;
  if (!q || q.length < 2) return; // avoid spamming
  setStatus(resultsDiv, "Søger…");
  try {
    const sets = await searchSaet(q);
    const withAvail = await attachAvailability(sets);
    renderResults(withAvail);
  } catch (err) {
    console.error(err);
    setStatus(resultsDiv, `<p style="color:red">Fejl ved søgning: ${escapeHTML(err.message)}</p>`);
  }
}, 350));

// ---------- Utilities ----------
function debounce(fn, wait = 300) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(null, args), wait);
  };
}
