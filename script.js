// Læsekredssæt – v3.0 POC frontend
// Connects to Supabase; implements Booker/Admin basic flows with central filtering and date inputs.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// === Configure these two values ===
const SUPABASE_URL = 'https://https://qlkrzinyqirnigcwadki.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFsa3J6aW55cWlybmlnY3dhZGtpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3NjY2NjgsImV4cCI6MjA3ODM0MjY2OH0.-SV3dn7reKHeYis40I-aF3av0_XmCP-ZqB9KR6JT2so'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Cached state
const state = {
  me: { bibliotek_id: 'GENT' }, // demo default; replace with auth profile in real app
  centrals: [],
  ownersFilter: new Set(), // selected central IDs
}

// UI Elements
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
const loadPending = document.getElementById('loadPending')
const adminResults = document.getElementById('adminResults')

// Role toggle logic
toggleBooker.addEventListener('click', () => {
  toggleBooker.classList.add('active'); toggleAdmin.classList.remove('active')
  bookerSection.style.display = ''; adminSection.style.display = 'none'
})
toggleAdmin.addEventListener('click', () => {
  toggleAdmin.classList.add('active'); toggleBooker.classList.remove('active')
  bookerSection.style.display = 'none'; adminSection.style.display = ''
})

// Init
init().catch(console.error)

async function init() {
  await loadCentrals()
  populateCentralSelect()
  populateAdminOwner()
}

async function loadCentrals() {
  const { data, error } = await supabase
    .from('tbl_bibliotek')
    .select('bibliotek_id, bibliotek_navn')
    .eq('is_central', true)
    .eq('active', true)
    .order('bibliotek_navn', { ascending: true })
  if (error) { console.error(error); return }
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

  // Pick search mode
  if (!q && !s) {
    bookerResults.innerHTML = `<div class="muted">Angiv enten titel/forfatter/ISBN/FAUST eller en periode.</div>`
    return
  }

  let sets = []
  if (q) {
    sets = await searchByTitleOrAuthor(q)
  }
  if (!q && s && e) {
    sets = await searchByPeriod(s, e)
  } else if (q && s && e) {
    // intersect title results with those available in period
    const periodSets = await searchByPeriod(s, e)
    const periodSetIds = new Set(periodSets.map(x => x.set_id))
    sets = sets.filter(x => periodSetIds.has(x.set_id))
  }

  // Group by owner (central)
  const groups = groupBy(sets, s => s.owner_bibliotek_id)
  renderBookerResults(groups, s, e)
}

async function searchByTitleOrAuthor(q) {
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

  // Optional filter by selected centrals
  const owners = Array.from(state.ownersFilter)
  if (owners.length) query = query.in('owner_bibliotek_id', owners)

  const { data, error } = await query.limit(500)
  if (error) { console.error(error); return [] }

  // Visibility filter (national OR same central as me). In title search we show all centrals as per spec,
  // but still respect visibility rules: include regional only if owner == my central.
  const myCentral = await getMyCentralId()
  return (data || []).filter(row =>
    row.visibility === 'national' || row.owner_bibliotek_id === myCentral
  )
}

async function searchByPeriod(s, e) {
  // Start with all active sets; narrow to ownersFilter if selected
  let query = supabase
    .from('tbl_saet')
    .select('set_id,title,author,isbn,faust,visibility,owner_bibliotek_id,loan_weeks,buffer_days,requested_count,active')
    .eq('active', true)

  const owners = Array.from(state.ownersFilter)
  if (owners.length) query = query.in('owner_bibliotek_id', owners)

  const { data, error } = await query.limit(1000)
  if (error) { console.error(error); return [] }

  const myCentral = await getMyCentralId()

  // For each set, check visibility and availability (no overlaps in period)
  const sets = (data || []).filter(row =>
    row.visibility === 'national' || row.owner_bibliotek_id === myCentral
  )

  // Check overlaps in batches (client-side loop, server filter per set)
  const available = []
  for (const row of sets) {
    const ok = await isSetAvailableInPeriod(row.set_id, s, e)
    if (ok) available.push(row)
  }
  return available
}

async function isSetAvailableInPeriod(setId, s, e) {
  // Fetch bookings for this set that overlap
  const { data, error } = await supabase
    .from('tbl_booking')
    .select('start_date,end_date,status')
    .eq('set_id', setId)
    .in('status', ['pending','approved'])

  if (error) { console.error(error); return false }
  const bookings = data || []
  const hasOverlap = bookings.some(b => rangesOverlap(s, e, new Date(b.start_date), new Date(b.end_date)))
  return !hasOverlap
}

function rangesOverlap(s1, e1, s2, e2) {
  // inclusive overlap check
  return (s1 <= e2) && (s2 <= e1)
}

async function getMyCentralId() {
  // Look up my central via relation; demo fallback = 'GENT'
  const me = state.me.bibliotek_id
  const { data, error } = await supabase
    .from('tbl_bibliotek_relation')
    .select('central_id')
    .eq('bibliotek_id', me)
    .eq('active', true)
    .limit(1)
    .maybeSingle()

  if (error) { console.warn('central lookup failed; fallback GENT', error); return 'GENT' }
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
      const endCalc = s ? addDays(addWeeks(s, loanWeeks), bufferDays) : null
      tr.innerHTML = `
        <td><strong>${row.title}</strong><br><span class="muted">${row.author || ''} · ${row.isbn || ''}</span></td>
        <td>${row.visibility}</td>
        <td>${loanWeeks} uger${bufferDays? ' + '+bufferDays+' dage':''}</td>
        <td>
          <button class="primary" data-action="book" data-set="${row.set_id}">Book</button>
        </td>
      `
      tbody.appendChild(tr)

      // Attach booking handler
      tr.querySelector('button[data-action="book"]').addEventListener('click', async () => {
        if (!s || !e) {
          alert('Vælg start- og slutdato før booking.')
          return
        }
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

// Admin
loadPending.addEventListener('click', async () => {
  const owner = adminOwner.value
  const { data, error } = await supabase
    .from('tbl_booking')
    .select('booking_id,set_id,requester_bibliotek_id,start_date,end_date,status')
    .eq('owner_bibliotek_id', owner)
    .eq('status','pending')
    .order('created_at', { ascending: true })
  if (error) { adminResults.innerHTML = `<div class="err card">Fejl: ${error.message}</div>`; return }
  renderAdminPending(data || [])
})

function renderAdminPending(rows) {
  adminResults.innerHTML = ''
  if (!rows.length) { adminResults.innerHTML = `<div class="muted">Ingen pending bookinger.</div>`; return }

  const table = document.createElement('table')
  table.innerHTML = `
    <thead>
      <tr><th>ID</th><th>Sæt</th><th>Requester</th><th>Periode</th><th>Handling</th></tr>
    </thead>
    <tbody></tbody>
  `
  const tbody = table.querySelector('tbody')

  rows.forEach(r => {
    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td>${r.booking_id}</td>
      <td>${r.set_id}</td>
      <td>${r.requester_bibliotek_id}</td>
      <td>${r.start_date} → ${r.end_date}</td>
      <td>
        <button class="primary" data-approve="${r.booking_id}">Godkend</button>
        <button class="ghost" data-reject="${r.booking_id}">Afvis</button>
      </td>
    `
    tbody.appendChild(tr)

    tr.querySelector('button[data-approve]').addEventListener('click', async () => {
      // Failsafe: overlap check again
      const ok = await isSetAvailableInPeriod(r.set_id, new Date(r.start_date), new Date(r.end_date))
      if (!ok) { alert('Allerede reserveret – kan ikke godkende.'); return }
      const { error } = await supabase
        .from('tbl_booking')
        .update({ status: 'approved' })
        .eq('booking_id', r.booking_id)
      if (error) { alert('Fejl: ' + error.message); return }
      alert('Godkendt.'); loadPending.click()
    })

    tr.querySelector('button[data-reject]').addEventListener('click', async () => {
      const reason = prompt('Afvisningsårsag (valgfri):') || null
      const { error } = await supabase
        .from('tbl_booking')
        .update({ status: 'rejected', notes: reason })
        .eq('booking_id', r.booking_id)
      if (error) { alert('Fejl: ' + error.message); return }
      alert('Afvist.'); loadPending.click()
    })
  })

  adminResults.appendChild(table)
}

// Utils
function addWeeks(d, w) { const x = new Date(d); x.setDate(x.getDate() + w*7); return x }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function fmtDate(d) { return d.toISOString().slice(0,10) }
