// --- Læsekredssæt POC v2.8 — script.js (ASCII + periodesøgning + overlap + admin) ---
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// ✅ Supabase (din URL + anon key)
const supabaseUrl = 'https://qlkrzinyqirnigcwadki.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFsa3J6aW55cWlybmlnY3dhZGtpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3NjY2NjgsImV4cCI6MjA3ODM0MjY2OH0.-SV3dn7reKHeYis40I-aF3av0_XmCP-ZqB9KR6JT2so'
const supabase = createClient(supabaseUrl, supabaseKey)

// --- DOM ---
const qInput = document.getElementById('searchInput')
const fromEl  = document.getElementById('fromDate')
const toEl    = document.getElementById('toDate')
const btn     = document.getElementById('searchButton')
const results = document.getElementById('results')
const adminPanel = document.getElementById('adminPanel')
const adminTable = document.getElementById('adminTable')

// --- Utils (datoer) ---
const parseDate = (s) => s ? new Date(s + 'T00:00:00') : null
const formatDate = (d) => d.toISOString().slice(0,10)
const addDays = (d,n) => { const x=new Date(d); x.setDate(x.getDate()+n); return x }
const addWeeks = (d,w) => addDays(d, w*7)
const overlaps = (aStart, aEnd, bStart, bEnd) => (aStart <= bEnd) && (bStart <= aEnd)

// Beregn næste ledige startdato for ønsket periode (start -> end), givet eksisterende bookinger
function nextAvailableStart(requestStart, requestEnd, existingRanges) {
  if (!existingRanges || existingRanges.length===0) return requestStart
  // sortér efter start
  const rs = existingRanges.slice().sort((a,b)=> (a.s-b.s))
  let start = new Date(requestStart)
  let end   = new Date(requestEnd)
  for (const r of rs) {
    if (overlaps(start, end, r.s, r.e)) {
      // skub start til dagen efter r.e
      start = addDays(r.e, 1)
      const span = Math.round((requestEnd - requestStart) / 86400000) // antal dage
      end = addDays(start, span)
    }
  }
  return start
}

// --- Søgning (fritekst +/eller periode) ---
btn.addEventListener('click', runSearch)
qInput.addEventListener('keypress', (e)=>{ if(e.key==='Enter') runSearch() })
fromEl.addEventListener('change', ()=> {/*no-op*/})
toEl.addEventListener('change', ()=> {/*no-op*/})

async function runSearch() {
  const term = (qInput?.value||'').trim()
  const from = parseDate(fromEl.value)
  const to   = parseDate(toEl.value)

  results.innerHTML = '<p>⏳ Søger…</p>'

  // 1) Hent sæt (filtrér på fritekst hvis angivet)
  let query = supabase.from('tbl_saet')
    .select('id,titel,forfatter,isbn,faust,antal_oenskede_eksemplarer,centralbibliotek_id,standard_laaneperiode_uger,buffer_dage')
    .limit(100)

  if (term) {
    query = query.or(`titel.ilike.%${term}%,forfatter.ilike.%${term}%,isbn.ilike.%${term}%,faust.ilike.%${term}%`)
  }
  const { data: sets, error: setErr } = await query
  if (setErr) {
    results.innerHTML = `<p style="color:red;">Fejl: ${escapeHtml(setErr.message)}</p>`
    return
  }
  if (!sets || sets.length===0) {
    results.innerHTML = '<p>Ingen sæt fundet.</p>'
    return
  }

  // 2) Hvis periode er valgt, hent bookinger for alle de fundne sæt i den periode (Pending/Approved regnes som optaget)
  let bookingsBySet = {}
  if (from && to) {
    const ids = sets.map(s=>s.id)
    // hent kun bookinger for disse sæt, der kan overlappe (bredt filter)
    const { data: bks, error: bkErr } = await supabase
      .from('tbl_booking')
      .select('id,set_id,start_dato,slut_dato,status')
      .in('set_id', ids)
      .in('status', ['Pending','Approved']) // POC: disse spærrer kalenderen
    if (bkErr) {
      results.innerHTML = `<p style="color:red;">Fejl (bookings): ${escapeHtml(bkErr.message)}</p>`
      return
    }
    // grupper
    for (const b of (bks||[])) {
      const s = new Date(b.start_dato + 'T00:00:00')
      const e = new Date(b.slut_dato  + 'T00:00:00')
      ;(bookingsBySet[b.set_id] ||= []).push({ s, e, status:b.status })
    }
  }

  // 3) Render (med badge for kalender/inventar placeholder)
  renderResults(sets, { from, to, bookingsBySet })
}

function renderResults(rows, ctx) {
  const { from, to, bookingsBySet } = ctx
  let html = `
    <table class="result-table">
      <thead>
        <tr>
          <th>Titel</th>
          <th>Forfatter</th>
          <th>ISBN</th>
          <th>FAUST</th>
          <th>Antal ønskede</th>
          <th>Badges</th>
          <th>Handling</th>
        </tr>
      </thead>
      <tbody>
  `
  for (const row of rows) {
    // Kalenderbadge
    let calBadge = `<span class="badge ok">Kalender: (ingen periode valgt)</span>`
    let nextStartText = ''
    if (from && to) {
      const ranges = (bookingsBySet[row.id]||[]).map(r => ({ s: r.s, e: r.e }))
      const conflicts = ranges.some(r => overlaps(from, to, r.s, r.e))
      if (conflicts) {
        const next = nextAvailableStart(from, to, ranges)
        nextStartText = ` (Næste ledige: ${formatDate(next)})`
        calBadge = `<span class="badge warn">Reserveret i perioden</span>${nextStartText}`
      } else {
        calBadge = `<span class="badge ok">Ledig i perioden</span>`
      }
    }

    // Inventarbadge (POC-info, ikke styrende endnu)
    const invBadge = `<span class="badge">Inventar: info</span>`

    html += `
      <tr>
        <td>${escapeHtml(row.titel ?? '')}</td>
        <td>${escapeHtml(row.forfatter ?? '')}</td>
        <td>${escapeHtml(row.isbn ?? '')}</td>
        <td>${escapeHtml(row.faust ?? '')}</td>
        <td>${row.antal_oenskede_eksemplarer ?? ''}</td>
        <td>${calBadge} ${invBadge}</td>
        <td>
          <button class="bookBtn"
            data-id="${row.id}"
            data-laaneuger="${row.standard_laaneperiode_uger ?? 8}"
            data-buffer="${row.buffer_dage ?? 0}">
            Book
          </button>
        </td>
      </tr>
    `
  }
  html += '</tbody></table>'
  results.innerHTML = html

  // Aktivér Book-knapper
  document.querySelectorAll('.bookBtn').forEach(btn => {
    btn.addEventListener('click', () => {
      const setId   = btn.getAttribute('data-id')
      const weeks   = parseInt(btn.getAttribute('data-laaneuger')||'8', 10)
      const buffer  = parseInt(btn.getAttribute('data-buffer')||'0', 10)
      openBookingFlow(setId, weeks, buffer)
    })
  })
}

// --- Booking-flow med overlap-tjek + auto slutdato + “næste ledige” ---
async function openBookingFlow(setId, weeks, bufferDays) {
  // 1) Vælg start (default = fromDate hvis sat)
  const uiStart = fromEl.value || ''
  const startInput = prompt(`Startdato (YYYY-MM-DD):`, uiStart)
  if (!startInput) return

  const start = parseDate(startInput)
  if (isNaN(start)) { alert('Ugyldig dato'); return }

  // 2) Beregn slutdato = start + uger + buffer
  const end = addDays(addWeeks(start, weeks), bufferDays)

  // 3) Hent eksisterende bookinger for sættet (Pending/Approved spærrer)
  const { data: bks, error } = await supabase
    .from('tbl_booking')
    .select('start_dato,slut_dato,status')
    .eq('set_id', setId)
    .in('status', ['Pending','Approved'])
  if (error) { alert('Fejl ved overlap-tjek: ' + error.message); return }

  const ranges = (bks||[]).map(b => ({
    s: new Date(b.start_dato + 'T00:00:00'),
    e: new Date(b.slut_dato  + 'T00:00:00')
  }))

  // 4) Overlap?
  const conflict = ranges.some(r => overlaps(start, end, r.s, r.e))
  if (conflict) {
    const next = nextAvailableStart(start, end, ranges)
    const spanDays = Math.round((end - start)/86400000)
    const nextEnd  = addDays(next, spanDays)
    const accept = confirm(
      `Valgt periode er optaget.\n`+
      `Næste ledige startdato: ${formatDate(next)}\n\n`+
      `Vil du booke ${formatDate(next)} → ${formatDate(nextEnd)} i stedet?`
    )
    if (!accept) return
    await createBooking(setId, formatDate(next), formatDate(nextEnd))
  } else {
    await createBooking(setId, formatDate(start), formatDate(end))
  }
}

async function createBooking(setId, startStr, endStr) {
  const borrower = prompt('Lånerbibliotek (navn):')
  if (!borrower) return

  const payload = {
    set_id: setId,
    laaner_bibliotek: borrower,
    start_dato: startStr,
    slut_dato: endStr,
    status: 'Pending',
    oprettet_dato: new Date().toISOString()
  }
  const { error } = await supabase.from('tbl_booking').insert([payload])
  if (error) { alert('Fejl: ' + error.message); return }
  alert(`Booking sendt til godkendelse:\n${startStr} → ${endStr}`)
}

// --- Admin (simple pending-oversigt + godkend/afvis). Vises hvis ?admin=1 ---
initAdminIfNeeded()
async function initAdminIfNeeded() {
  const params = new URLSearchParams(location.search)
  if (params.get('admin') !== '1') return
  adminPanel.style.display = 'block'
  await loadPending()
}

async function loadPending() {
  adminTable.innerHTML = '<p>⏳ Henter pending…</p>'
  const { data, error } = await supabase
    .from('tbl_booking')
    .select('id,set_id,laaner_bibliotek,start_dato,slut_dato,status')
    .eq('status','Pending')
    .order('oprettet_dato', { ascending:false })

  if (error) { adminTable.innerHTML = `<p style="color:red;">Fejl: ${escapeHtml(error.message)}</p>`; return }
  if (!data || data.length===0) { adminTable.innerHTML = '<p class="muted">Ingen pending-bookinger.</p>'; return }

  // Hent titler for visning
  const setIds = [...new Set(data.map(x=>x.set_id))]
  const { data: sets } = await supabase.from('tbl_saet').select('id,titel').in('id', setIds)
  const mapTitle = Object.fromEntries((sets||[]).map(s=>[s.id, s.titel||'']))

  let html = `
    <table>
      <thead>
        <tr><th>Titel</th><th>Lånerbibliotek</th><th>Periode</th><th>Status</th><th>Handling</th></tr>
      </thead>
      <tbody>
  `
  for (const r of data) {
    html += `
      <tr>
        <td>${escapeHtml(mapTitle[r.set_id]||r.set_id)}</td>
        <td>${escapeHtml(r.laaner_bibliotek||'')}</td>
        <td>${escapeHtml(r.start_dato)} → ${escapeHtml(r.slut_dato)}</td>
        <td>${escapeHtml(r.status)}</td>
        <td class="row-actions">
          <button data-id="${r.id}" data-act="approve">Godkend</button>
          <button data-id="${r.id}" data-act="reject"  style="background:var(--danger);color:white;border:1px solid var(--border)">Afvis</button>
        </td>
      </tr>
    `
  }
  html += '</tbody></table>'
  adminTable.innerHTML = html

  adminTable.querySelectorAll('button[data-act]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      const id = b.getAttribute('data-id')
      const act = b.getAttribute('data-act')
      const newStatus = act==='approve' ? 'Approved' : 'Rejected'
      const { error } = await supabase.from('tbl_booking').update({ status: newStatus }).eq('id', id)
      if (error) { alert('Fejl: ' + error.message); return }
      await loadPending()
    })
  })
}

// --- Helpers ---
function escapeHtml(str) {
  return String(str)
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#039;')
}

console.log('📘 Læsekredssæt POC v2.8 – UI med periode/overlap/admin indlæst')
