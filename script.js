// Læsekredssæt – v3.0 Updated frontend
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// === Your Supabase (already filled in) ===
const SUPABASE_URL = 'https://qlkrzinyqirnigcwadki.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFsa3J6aW55cWlybmlnY3dhZGtpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3NjY2NjgsImV4cCI6MjA3ODM0MjY2OH0.-SV3dn7reKHeYis40I-aF3av0_XmCP-ZqB9KR6JT2so'
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ---------- Status banner (no DevTools needed) ----------
const statusBox = document.getElementById('statusBox')
function showStatus(msg, tone = 'err') {
  if (!statusBox) return
  statusBox.style.display = ''
  statusBox.className = `card ${tone}`
  statusBox.textContent = String(msg)
}
function hideStatus() { if (statusBox) statusBox.style.display = 'none' }

// ---------- State ----------
const state = {
  me: { bibliotek_id: 'GENT' }, // demo default; replace with auth profile later
  centrals: [],
  ownersFilter: new Set(), // selected central IDs
}

// ---------- Elements ----------
const toggleBooker = document.getElementById('toggleBooker')
const toggleAdmin  = document.getElementById('toggleAdmin')
const bookerSection = document.getElementById('bookerSection')
const adminSection  = document.getElementById('adminSection')

const centralSelect = document.getElementById('centralSelect')
const qInput = document.getElementById('q')
const startDate = document.getElementById('startDate')
const endDate   = document.getElementById('endDate')
const searchBtn = document.getElementById('searchBtn')
const clearBtn  = document.getElementById('clearBtn')
const bookerResults = document.getElementById('bookerResults')

const adminOwner = document.getElementById('adminOwner')
const loadAdminData = document.getElementById('loadAdminData')
const regionalsTable = document.getElementById('regionalsTable')
const addRegional = document.getElementById('addRegional')
const newRegionalId = document.getElementById('newRegionalId')
const setsTable = document.getElementById('setsTable')
const refreshSets = document.getElementById('refreshSets')
const createSet = document.getElementById('createSet')
const newTitle = document.getElementById('newTitle')
const newAuthor = document.getElementById('newAuthor')
const newISBN = document.getElementById('newISBN')
const newFAUST = document.getElementById('newFAUST')
const newVisibility = document.getElementById('newVisibility')
const newLoanWeeks = document.getElementById('newLoanWeeks')
const newBufferDays = document.getElementById('newBufferDays')
const adminResults = document.getElementById('adminResults')

// ---------- Guards (prevent “dead UI” if something is missing) ----------
function guardElements() {
  const elems = [
    toggleBooker,toggleAdmin,bookerSection,adminSection,
    centralSelect,qInput,startDate,endDate,searchBtn,clearBtn,bookerResults,
    adminOwner,loadAdminData,regionalsTable,addRegional,newRegionalId,
    setsTable,refreshSets,createSet,newTitle,newAuthor,newISBN,newFAUST,
    newVisibility,newLoanWeeks,newBufferDays,adminResults
  ]
  if (elems.some(el => !el)) {
    showStatus('UI initialisering fejlede – mangler elementer i HTML.', 'err')
    return false
  }
  return true
}

// ---------- Role toggle ----------
toggleBooker.addEventListener('click', () => {
  toggleBooker.classList.add('active'); toggleAdmin.classList.remove('active')
  bookerSection.style.display = ''; adminSection.style.display = 'none'
})
toggleAdmin.addEventListener('click', () => {
  toggleAdmin.classList.add('active'); toggleBooker.classList.remove('active')
  bookerSection.style.display = 'none'; adminSection.style.display = ''
})

// ---------- Init ----------
init().catch(e => showStatus('Init error: ' + (e?.message || e), 'err'))

async function init() {
  if (!guardElements()) return
  showStatus('Forbinder til database...')
  const ok = await testConnection()
  if (!ok) return
  hideStatus()
  await loadCentrals()
  populateCentralSelect()
  populateAdminOwner()
}

// simple ping to ensure policies and URL/key work
async function testConnection() {
  const { error } = await supabase.from('tbl_bibliotek').select('bibliotek_id').limit(1)
  if (error) { showStatus('❌ DB fejl: ' + error.message, 'err'); return false }
  return true
}

// ---------- Load centrals ----------
async function loadCentrals() {
  const { data, error } = await supabase
    .from('tbl_bibliotek')
    .select('bibliotek_id, bibliotek_navn')
    .eq('is_central', true)
    .eq('active', true)
    .order('bibliotek_navn', { ascending: true })
  if (error) { showStatus('loadCentrals: ' + error.message, 'err'); return }
  state.centrals = data || []
}

function populateCentralSelect() {
  centralSelect.innerHTML = ''
  state.centrals.forEach(c => {
    const opt = document.createElement('option')
    opt.value = c.bibliotek_id
    opt.textContent = `${c.bibliotek_navn} (${c.bibliotek_id})`
    centralSelect.appendChild(opt)
  })
  centralSelect.addEventListener('change', () => {
    const selected = Array.from(centralSelect.selectedOptions).map(o => o.value)
    state.ownersFilter = new Set(selected)
  })
}

function populateAdminOwner() {
  adminOwner.innerHTML = ''
  state.centrals.forEach(c => {
    const opt = document.createElement('option')
    opt.value = c.bibliotek_id
    opt.textContent = `${c.bibliotek_navn} (${c.bibliotek_id})`
    adminOwner.appendChild(opt)
  })
}

// ---------- Booker search ----------
searchBtn.addEventListener('click', () => runSearch())
clearBtn.addEventListener('click', () => {
  qInput.value = ''; startDate.value = ''; endDate.value = ''; state.ownersFilter.clear()
  Array.from(centralSelect.options).forEach(o => o.selected = false)
  bookerResults.innerHTML = ''
})

async function runSearch() {
  const q = qInput.value.trim()
  const s = startDate.value ? new Date(startDate.value) : null
  const e = endDate.value ? new Date(endDate.value) : null
  const owners = Array.from(state.ownersFilter)

  let sets = []
  if (!q && !s && !e) {
    // no text or dates: list all sets for selected centrals (or all centrals if none selected)
    sets = await listSetsForOwners(owners)
  } else {
    if (q) {
      sets = await searchByTitleOrAuthor(q, owners)
    }
    if (s && e) {
      const periodSets = await searchByPeriod(s, e, owners)
      if (q) {
        const okIds = new Set(periodSets.map(x => x.set_id))
        sets = sets.filter(x => okIds.has(x.set_id))
      } else {
        sets = periodSets
      }
    }
  }

  const groups = groupBy(sets, s => s.owner_bibliotek_id)
  renderBookerResults(groups, s, e)
}

async function listSetsForOwners(owners) {
  let query = supabase
    .from('tbl_saet')
    .select('set_id,title,author,isbn,faust,visibility,owner_bibliotek_id,loan_weeks,buffer_days,requested_count,active')
    .eq('active', true)

  if (owners.length) query = query.in('owner_bibliotek_id', owners)

  const { data, error } = await query.limit(1000)
  if (error) { showStatus('listSets: ' + error.message, 'err'); return [] }
  const myCentral = await getMyCentralId()
  return (data || []).filter(row =>
    row.visibility === 'national' || row.owner_bibliotek_id === myCentral
  )
}

async function searchByTitleOrAuthor(q, owners) {
  const or = [
    `title.ilike.%${q}%`,
    `author.ilike.%${q}%`,
    `isbn.ilike.%${q}%`,
    `faust.ilike.%${q}%`
  ].join(',')
  let query = supabase
    .from('tbl_saet')
    .select('set_id,title,author,isbn,faust,visibility,owner_bibliotek_id,loan_weeks,buffer_days,requested_count,active')
    .or(or)
    .eq('active', true)

  if (owners.length) query = query.in('owner_bibliotek_id', owners)

  const { data, error } = await query.limit(500)
  if (error) { showStatus('searchByTitleOrAuthor: ' + error.message, 'err'); return [] }
  const myCentral = await getMyCentralId()
  return (data || []).filter(row =>
    row.visibility === 'national' || row.owner_bibliotek_id === myCentral
  )
}

async function searchByPeriod(s, e, owners) {
  let query = supabase
    .from('tbl_saet')
    .select('set_id,title,author,isbn,faust,visibility,owner_bibliotek_id,loan_weeks,buffer_days,requested_count,active')
    .eq('active', true)

  if (owners.length) query = query.in('owner_bibliotek_id', owners)

  const { data, error } = await query.limit(1000)
  if (error) { showStatus('searchByPeriod: ' + error.message, 'err'); return [] }
  const myCentral = await getMyCentralId()
  const sets = (data || []).filter(row =>
    row.visibility === 'national' || row.owner_bibliotek_id === myCentral
  )

  const available = []
  for (const row of sets) {
    const ok = await isSetAvailableInPeriod(row.set_id, s, e)
    if (ok) available.push(row)
  }
  return available
}

async function isSetAvailableInPeriod(setId, s, e) {
  const { data, error } = await supabase
    .from('tbl_booking')
    .select('start_date,end_date,status')
    .eq('set_id', setId)
    .in('status', ['pending','approved'])

  if (error) { showStatus('isSetAvailableInPeriod: ' + error.message, 'err'); return false }
  const bookings = data || []
  const hasOverlap = bookings.some(b => rangesOverlap(s, e, new Date(b.start_date), new Date(b.end_date)))
  return !hasOverlap
}

function rangesOverlap(s1, e1, s2, e2) {
  return (s1 <= e2) && (s2 <= e1)
}

async function getMyCentralId() {
  const me = state.me.bibliotek_id
  const { data, error } = await supabase
    .from('tbl_bibliotek_relation')
    .select('central_id')
    .eq('bibliotek_id', me)
    .eq('active', true)
    .limit(1)
    .maybeSingle()
  if (error) { showStatus('getMyCentralId: ' + error.message, 'err'); return 'GENT' }
  return data?.central_id || 'GENT'
}

function groupBy(arr, keyFn) {
  const map = new Map()
  for (const item of arr) {
    const k = keyFn(item)
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(item)
  }
  return map
}

function renderBookerResults(groups, s, e) {
  if (!groups || !groups.size) {
    bookerResults.innerHTML = `<div class="muted">Ingen resultater for dine filtre.</div>`
    return
  }
  bookerResults.innerHTML = ''
  groups.forEach((items, owner) => {
    const box = document.createElement('div'); box.className = 'card'
    const title = document.createElement('h3')
    title.textContent = `Centralbibliotek: ${owner}`
    box.appendChild(title)

    const table = document.createElement('table')
    table.innerHTML = `
      <thead>
        <tr>
          <th>Sæt</th><th>Synlighed</th><th>Låneperiode</th><th>Handling</th>
        </tr>
      </thead>
      <tbody></tbody>
    `
    const tbody = table.querySelector('tbody')

    items.forEach(row => {
      const tr = document.createElement('tr')
      const loanWeeks = row.loan_weeks ?? 8
      const bufferDays = row.buffer_days ?? 0
      tr.innerHTML = `
        <td><strong>${row.title}</strong><br><span class="muted">${row.author || ''} · ${row.isbn || ''}</span></td>
        <td>${row.visibility}</td>
        <td>${loanWeeks} uger${bufferDays ? ' + ' + bufferDays + ' dage' : ''}</td>
        <td>
          <button class="primary" type="button" data-action="book" data-set="${row.set_id}">Book</button>
        </td>
      `
      tbody.appendChild(tr)

      tr.querySelector('button[data-action="book"]').addEventListener('click', async () => {
        if (!s || !e) { alert('Vælg start- og slutdato før booking.'); return }
        const ok = await isSetAvailableInPeriod(row.set_id, s, e)
        if (!ok) { alert('Reserveret i perioden – vælg en anden dato.'); return }
        const { error } = await supabase.from('tbl_booking').insert({
          set_id: row.set_id,
          requester_bibliotek_id: state.me.bibliotek_id,
          owner_bibliotek_id: owner,
          start_date: fmtDate(s),
          end_date: fmtDate(e),
          status: 'pending'
        })
        if (error) { alert('Fejl ved booking: ' + error.message); return }
        alert('Booking sendt (Pending).')
      })
    })

    box.appendChild(table)
    bookerResults.appendChild(box)
  })
}

// ---------- Admin: Region & Sæt ----------
loadAdminData.addEventListener('click', async () => {
  await loadRegionals()
  await loadSets()
})

refreshSets.addEventListener('click', loadSets)

addRegional.addEventListener('click', async () => {
  const owner = adminOwner.value
  const child = (newRegionalId.value || '').trim()
  if (!owner || !child) { showStatus('Angiv både central (øverst) og bibliotek_id for tilknytning', 'err'); return }
  const { data: exists, error: exErr } = await supabase
    .from('tbl_bibliotek')
    .select('bibliotek_id')
    .eq('bibliotek_id', child)
    .maybeSingle()
  if (exErr) { showStatus('Opslag fejl: ' + exErr.message, 'err'); return }
  if (!exists) { showStatus('Bibliotek findes ikke i tbl_bibliotek: ' + child, 'err'); return }
  const { error } = await supabase.from('tbl_bibliotek_relation').insert({ bibliotek_id: child, central_id: owner, active: true })
  if (error) { showStatus('Tilføj relation fejl: ' + error.message, 'err'); return }
  newRegionalId.value = ''
  await loadRegionals()
  showStatus('Relation tilføjet', 'ok'); setTimeout(hideStatus, 1500)
})

async function loadRegionals() {
  const owner = adminOwner.value
  const { data, error } = await supabase
    .from('tbl_bibliotek_relation')
    .select('relation_id,bibliotek_id,central_id,active')
    .eq('central_id', owner)
    .order('bibliotek_id', { ascending: true })
  if (error) { showStatus('loadRegionals: ' + error.message, 'err'); return }

  const table = document.createElement('table')
  table.innerHTML = `
    <thead><tr><th>Bibliotek</th><th>Aktiv</th><th>Handling</th></tr></thead>
    <tbody></tbody>
  `
  const tbody = table.querySelector('tbody')
  ;(data || []).forEach(r => {
    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td>${r.bibliotek_id}</td>
      <td><input type="checkbox" ${r.active ? 'checked' : ''} data-rel="${r.relation_id}" /></td>
      <td><button class="ghost" type="button" data-del="${r.relation_id}">Fjern</button></td>
    `
    tbody.appendChild(tr)

    tr.querySelector('input[type="checkbox"]').addEventListener('change', async (ev) => {
      const { error } = await supabase.from('tbl_bibliotek_relation').update({ active: ev.target.checked }).eq('relation_id', r.relation_id)
      if (error) { showStatus('Opdater relation: ' + error.message, 'err'); ev.target.checked = !ev.target.checked; return }
      showStatus('Relation opdateret', 'ok'); setTimeout(hideStatus, 1200)
    })
    tr.querySelector('button[data-del]').addEventListener('click', async () => {
      const { error } = await supabase.from('tbl_bibliotek_relation').delete().eq('relation_id', r.relation_id)
      if (error) { showStatus('Slet relation: ' + error.message, 'err'); return }
      await loadRegionals()
      showStatus('Relation fjernet', 'ok'); setTimeout(hideStatus, 1200)
    })
  })
  regionalsTable.innerHTML = ''
  regionalsTable.appendChild(table)
}

async function loadSets() {
  const owner = adminOwner.value
  const { data, error } = await supabase
    .from('tbl_saet')
    .select('set_id,title,author,isbn,faust,visibility,loan_weeks,buffer_days,active,requested_count,allow_substitution,allow_partial,min_delivery,notes,owner_bibliotek_id')
    .eq('owner_bibliotek_id', owner)
    .order('title', { ascending: true })
  if (error) { showStatus('loadSets: ' + error.message, 'err'); return }

  const table = document.createElement('table')
  table.innerHTML = `
    <thead>
      <tr>
        <th>Titel</th><th>Synlighed</th><th>Uger</th><th>Buffer</th><th>Aktiv</th>
        <th>Min.lev</th><th>Delvis</th><th>Subst.</th><th>Gem</th>
      </tr>
    </thead>
    <tbody></tbody>
  `
  const tbody = table.querySelector('tbody')
  ;(data || []).forEach(r => {
    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td><input type="text" value="${escapeHtml(r.title || '')}" data-f="title"/></td>
      <td>
        <select data-f="visibility">
          <option value="national" ${r.visibility==='national'?'selected':''}>national</option>
          <option value="regional" ${r.visibility==='regional'?'selected':''}>regional</option>
        </select>
      </td>
      <td><input type="number" min="1" value="${r.loan_weeks||8}" data-f="loan_weeks"/></td>
      <td><input type="number" min="0" value="${r.buffer_days||0}" data-f="buffer_days"/></td>
      <td><input type="checkbox" ${r.active ? 'checked' : ''} data-f="active"/></td>
      <td><input type="number" min="0" value="${r.min_delivery||0}" data-f="min_delivery"/></td>
      <td><input type="checkbox" ${r.allow_partial ? 'checked' : ''} data-f="allow_partial"/></td>
      <td><input type="checkbox" ${r.allow_substitution ? 'checked' : ''} data-f="allow_substitution"/></td>
      <td><button class="primary" type="button" data-save="${r.set_id}">Gem</button></td>
    `
    tbody.appendChild(tr)

    tr.querySelector('button[data-save]').addEventListener('click', async () => {
      const payload = collectRowPayload(tr)
      const { error } = await supabase.from('tbl_saet').update(payload).eq('set_id', r.set_id)
      if (error) { showStatus('Gem sæt: ' + error.message, 'err'); return }
      showStatus('Sæt opdateret', 'ok'); setTimeout(hideStatus, 1200)
    })
  })
  setsTable.innerHTML = ''
  setsTable.appendChild(table)
}

function collectRowPayload(tr) {
  const get = (sel) => tr.querySelector(sel)
  const title = get('[data-f="title"]').value
  const visibility = get('[data-f="visibility"]').value
  const loan_weeks = parseInt(get('[data-f="loan_weeks"]').value,10) || 8
  const buffer_days = parseInt(get('[data-f="buffer_days"]').value,10) || 0
  const active = get('[data-f="active"]').checked
  const min_delivery = parseInt(get('[data-f="min_delivery"]').value,10) || 0
  const allow_partial = get('[data-f="allow_partial"]').checked
  const allow_substitution = get('[data-f="allow_substitution"]').checked
  return { title, visibility, loan_weeks, buffer_days, active, min_delivery, allow_partial, allow_substitution }
}

// ---------- Utils ----------
function fmtDate(d) { return d.toISOString().slice(0,10) }
function escapeHtml(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }
