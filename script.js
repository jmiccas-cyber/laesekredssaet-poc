// Læsekredssæt – v3.0: Booker + Admin (Region/Sæt/Eksemplarer) + rapporter
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// ===== Supabase (indsat) =====
const SUPABASE_URL = 'https://qlkrzinyqirnigcwadki.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFsa3J6aW55cWlybmlnY3dhZGtpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3NjY2NjgsImV4cCI6MjA3ODM0MjY2OH0.-SV3dn7reKHeYis40I-aF3av0_XmCP-ZqB9KR6JT2so'
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ===== Konstanter for beholdning (kolonnenavne) =====
const COPY_TABLE = 'tbl_beholdning'
const COPY_BARCODE_COL = 'barcode'
const COPY_BOOKING_COL = 'booking_status'     // POC-bookingstatus
const COPY_LOAN_COL    = 'loan_status'        // Udlånsstatus (FBI-API senere, read-only nu)
const COPY_TITLE_COL   = 'title'
const COPY_AUTHOR_COL  = 'author'
const COPY_ISBN_COL    = 'isbn'
const COPY_FAUST_COL   = 'faust'
const COPY_OWNER_COL   = 'owner_bibliotek_id'

// ===== Status banner =====
const statusBox = document.getElementById('statusBox')
const showStatus = (msg, tone='err') => { statusBox.style.display=''; statusBox.className=`status card ${tone}`; statusBox.textContent=String(msg) }
const hideStatus = () => { statusBox.style.display='none' }

// ===== State =====
const state = {
  me: { bibliotek_id: 'GENT-L1' },   // simuleret login som regionalt bibliotek
  centrals: [],
  allRegionals: [],
  ownersFilter: new Set(),
  myProfile: null,
  regionalMap: new Map(),
  setsForOwner: [],
  selectedSet: null,
  copies: []
}

// ===== Elements =====
const toggleBooker = document.getElementById('toggleBooker')
const toggleAdmin  = document.getElementById('toggleAdmin')
const bookerSection = document.getElementById('bookerSection')
const adminSection  = document.getElementById('adminSection')

// Booker søg + login
const loginAsSelect = document.getElementById('loginAsSelect')
const centralSelect = document.getElementById('centralSelect')
const qInput = document.getElementById('q')
const startDate = document.getElementById('startDate')
const endDate   = document.getElementById('endDate')
const searchBtn = document.getElementById('searchBtn')
const clearBtn  = document.getElementById('clearBtn')
const bookerResults = document.getElementById('bookerResults')

// Booker profil
const profileForm = document.getElementById('profileForm')
const saveProfile = document.getElementById('saveProfile')

// Admin top + tabs
const adminOwner = document.getElementById('adminOwner')
const loadAdminData = document.getElementById('loadAdminData')
const tabBtnRegion = document.getElementById('tabBtnRegion')
const tabBtnSets   = document.getElementById('tabBtnSets')
const tabBtnCopies = document.getElementById('tabBtnCopies')
const tabRegion = document.getElementById('tabRegion')
const tabSets   = document.getElementById('tabSets')
const tabCopies = document.getElementById('tabCopies')

// Region-tab
const regionalsTable = document.getElementById('regionalsTable')
const addRegional = document.getElementById('addRegional')
const newRegionalId = document.getElementById('newRegionalId')

// Sets-tab
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

// Copies-tab
const copiesSetSelect = document.getElementById('copiesSetSelect')
const loadCopies = document.getElementById('loadCopies')
const newCopyBarcode = document.getElementById('newCopyBarcode')
const addCopy = document.getElementById('addCopy')
const copiesTable = document.getElementById('copiesTable')
const reportBookedButLoaned = document.getElementById('reportBookedButLoaned')
const reportArea = document.getElementById('reportArea')

// ===== Role toggle =====
toggleBooker.addEventListener('click', () => {
  toggleBooker.classList.add('active'); toggleAdmin.classList.remove('active')
  bookerSection.classList.remove('hidden'); adminSection.classList.add('hidden')
})
toggleAdmin.addEventListener('click', () => {
  toggleAdmin.classList.add('active'); toggleBooker.classList.remove('active')
  bookerSection.classList.add('hidden'); adminSection.classList.remove('hidden')
})

// ===== Tabs logic (admin) =====
const allTabButtons = [tabBtnRegion, tabBtnSets, tabBtnCopies]
const allPanels = [tabRegion, tabSets, tabCopies]
function activateTab(btn) {
  allTabButtons.forEach(b => b.classList.toggle('active', b === btn))
  allPanels.forEach(p => p.classList.add('hidden'))
  if (btn === tabBtnRegion) tabRegion.classList.remove('hidden')
  if (btn === tabBtnSets)   tabSets.classList.remove('hidden')
  if (btn === tabBtnCopies) tabCopies.classList.remove('hidden')
}
tabBtnRegion.addEventListener('click', () => activateTab(tabBtnRegion))
tabBtnSets.addEventListener('click',   () => activateTab(tabBtnSets))
tabBtnCopies.addEventListener('click', () => activateTab(tabBtnCopies))

// ===== Init =====
init().catch(e => showStatus('Init error: ' + (e?.message || e), 'err'))
async function init(){
  showStatus('Forbinder til database…')
  const ping = await supabase.from('tbl_bibliotek').select('bibliotek_id').limit(1)
  if (ping.error) { showStatus('❌ DB fejl: ' + ping.error.message, 'err'); return }
  hideStatus()

  await Promise.all([loadCentrals(), loadAllRegionals()])
  populateCentralSelect()
  populateLoginAsSelect()
  populateAdminOwner()
  await loadMyProfile(); renderMyProfile()

  // auto-list visning ved load (ingen filtre ⇒ alle sæt)
  runSearch()
}

// ===== Load helpers =====
async function loadCentrals() {
  const { data, error } = await supabase
    .from('tbl_bibliotek')
    .select('bibliotek_id, bibliotek_navn')
    .eq('is_central', true).eq('active', true)
    .order('bibliotek_navn')
  if (error) { showStatus('loadCentrals: ' + error.message, 'err'); return }
  state.centrals = data || []
}
async function loadAllRegionals() {
  const [{ data: libs, error: e1 }, { data: rels, error: e2 }] = await Promise.all([
    supabase.from('tbl_bibliotek')
      .select('bibliotek_id,bibliotek_navn,active')
      .eq('active', true).eq('is_central', false).order('bibliotek_navn'),
    supabase.from('tbl_bibliotek_relation')
      .select('bibliotek_id,central_id,active')
  ])
  if (e1) { showStatus('loadAllRegionals.libs: ' + e1.message, 'err'); return }
  if (e2) { showStatus('loadAllRegionals.rels: ' + e2.message, 'err'); return }
  const relMap = new Map(rels.map(r => [r.bibliotek_id, r.central_id]))
  state.allRegionals = (libs || []).map(l => ({ ...l, central_id: relMap.get(l.bibliotek_id) || '—' }))
}
function populateCentralSelect(){
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
function populateLoginAsSelect(){
  loginAsSelect.innerHTML = ''
  state.allRegionals.forEach(b => {
    const opt = document.createElement('option')
    opt.value = b.bibliotek_id
    opt.textContent = `${b.bibliotek_navn} (${b.bibliotek_id}) · ${b.central_id}`
    loginAsSelect.appendChild(opt)
  })
  // auto-vælg første hvis findes
  if (state.allRegionals.length) {
    loginAsSelect.value = state.allRegionals[0].bibliotek_id
    state.me.bibliotek_id = state.allRegionals[0].bibliotek_id
  }
}
function populateAdminOwner(){
  adminOwner.innerHTML = ''
  state.centrals.forEach(c => {
    const opt = document.createElement('option')
    opt.value = c.bibliotek_id
    opt.textContent = `${c.bibliotek_navn} (${c.bibliotek_id})`
    adminOwner.appendChild(opt)
  })
  if (state.centrals.length) adminOwner.value = state.centrals[0].bibliotek_id
}

// ===== Booker: login as (simuleret) =====
loginAsSelect.addEventListener('change', async () => {
  const sel = loginAsSelect.value
  if (!sel) return
  state.me.bibliotek_id = sel
  await loadMyProfile(); renderMyProfile()
  runSearch() // auto-hent sæt for valgt login
})

// ===== Booker: søg =====
searchBtn.addEventListener('click', () => runSearch())
clearBtn.addEventListener('click', () => {
  qInput.value=''; startDate.value=''; endDate.value=''; state.ownersFilter.clear()
  Array.from(centralSelect.options).forEach(o => o.selected=false)
  bookerResults.innerHTML=''
})

async function runSearch(){
  const q = qInput.value.trim()
  const s = startDate.value ? new Date(startDate.value) : null
  const e = endDate.value ? new Date(endDate.value) : null
  const owners = Array.from(state.ownersFilter)

  let sets=[]
  if(!q && !s && !e){
    sets = await listSetsForOwners(owners)
  }else{
    if(q) sets = await searchByTitleOrAuthor(q, owners)
    if(s && e){
      const periodSets = await searchByPeriod(s, e, owners)
      sets = q ? sets.filter(x => new Set(periodSets.map(y=>y.set_id)).has(x.set_id)) : periodSets
    }
  }

  // Udvid med Central-kolonne + næste ledige periode
  const extended = await addNextAvailability(sets)
  renderBookerTable(extended, s, e)
}

async function listSetsForOwners(owners){
  let q = supabase.from('tbl_saet')
    .select('set_id,title,author,isbn,faust,visibility,owner_bibliotek_id,loan_weeks,buffer_days,requested_count,active')
    .eq('active', true)
  if(owners.length) q = q.in('owner_bibliotek_id', owners)
  const { data, error } = await q.limit(1000)
  if(error){ showStatus('listSets: ' + error.message, 'err'); return [] }
  const myCentral = await getMyCentralId()
  return (data||[]).filter(r => r.visibility==='national' || r.owner_bibliotek_id===myCentral)
}
async function searchByTitleOrAuthor(q, owners){
  const or = [`title.ilike.%${q}%`,`author.ilike.%${q}%`,`isbn.ilike.%${q}%`,`faust.ilike.%${q}%`].join(',')
  let query = supabase.from('tbl_saet')
    .select('set_id,title,author,isbn,faust,visibility,owner_bibliotek_id,loan_weeks,buffer_days,requested_count,active')
    .or(or).eq('active', true)
  if(owners.length) query = query.in('owner_bibliotek_id', owners)
  const { data, error } = await query.limit(500)
  if(error){ showStatus('searchByTitleOrAuthor: ' + error.message, 'err'); return [] }
  const myCentral = await getMyCentralId()
  return (data||[]).filter(r => r.visibility==='national' || r.owner_bibliotek_id===myCentral)
}
async function searchByPeriod(s,e,owners){
  let query = supabase.from('tbl_saet')
    .select('set_id,title,author,isbn,faust,visibility,owner_bibliotek_id,loan_weeks,buffer_days,requested_count,active')
    .eq('active', true)
  if(owners.length) query = query.in('owner_bibliotek_id', owners)
  const { data, error } = await query.limit(1000)
  if(error){ showStatus('searchByPeriod: ' + error.message, 'err'); return [] }
  const myCentral = await getMyCentralId()
  const sets = (data||[]).filter(r => r.visibility==='national' || r.owner_bibliotek_id===myCentral)
  const available=[]
  for(const r of sets){
    const ok = await isSetAvailableInPeriod(r.set_id,s,e)
    if(ok) available.push(r)
  }
  return available
}
async function isSetAvailableInPeriod(setId,s,e){
  const { data, error } = await supabase.from('tbl_booking')
    .select('start_date,end_date,status').eq('set_id', setId)
    .in('status',['pending','approved'])
  if(error){ showStatus('isSetAvailableInPeriod: '+error.message,'err'); return false }
  return !(data||[]).some(b => (s<=new Date(b.end_date)) && (new Date(b.start_date)<=e))
}
async function getMyCentralId(){
  const me = state.me.bibliotek_id
  const { data, error } = await supabase.from('tbl_bibliotek_relation')
    .select('central_id').eq('bibliotek_id', me).eq('active', true).limit(1).maybeSingle()
  if(error) return 'GENT'
  return data?.central_id || 'GENT'
}

// Næste ledige periode pr. sæt
async function addNextAvailability(sets){
  const result=[]
  await Promise.all((sets||[]).map(async s=>{
    const from = startDate.value ? new Date(startDate.value) : today()
    const { data, error } = await supabase.from('tbl_booking')
      .select('start_date,end_date,status').eq('set_id', s.set_id).in('status',['pending','approved']).order('start_date')
    const bookings = error ? [] : (data||[]).map(b=>({ s:new Date(b.start_date), e:new Date(b.end_date) }))
    const next = findNextWindow(bookings, from, s.loan_weeks ?? 8, s.buffer_days ?? 0)
    result.push({ ...s, next_window: next })
  }))
  return result
}
function findNextWindow(bookings, from, loanWeeks, bufferDays){
  const neededDays = loanWeeks*7 + bufferDays
  const sorted = [...bookings].sort((a,b)=>a.s - b.s)
  let start = new Date(from)
  for (const b of sorted){
    const end = addDays(start, neededDays - 1)
    if (rangesOverlap(start, end, b.s, b.e)) {
      start = addDays(b.e, 1) // skub efter overlap
    } else {
      return { start, end }
    }
  }
  const end = addDays(start, neededDays - 1)
  return { start, end }
}

// Tabelvisning (én tabel)
function renderBookerTable(items, s, e){
  if(!items || !items.length){
    bookerResults.innerHTML = `<div class="muted">Ingen resultater for dine filtre.</div>`
    return
  }
  const table = document.createElement('table')
  table.innerHTML = `
    <thead>
      <tr>
        <th>Sæt</th>
        <th>Centralbibliotek</th>
        <th>Synlighed</th>
        <th>Låneperiode</th>
        <th>Næste ledige periode</th>
        <th>Handling</th>
      </tr>
    </thead>
    <tbody></tbody>
  `
  const tbody = table.querySelector('tbody')

  items.forEach(row=>{
    const loanWeeks=row.loan_weeks??8, bufferDays=row.buffer_days??0
    const next = row.next_window
    const nextTxt = next ? `${fmtDate(next.start)} → ${fmtDate(next.end)}` : '—'
    const tr = document.createElement('tr'); tr.innerHTML = `
      <td><strong>${escapeHtml(row.title||'')}</strong><br><span class="muted">${escapeHtml(row.author||'')} · ${escapeHtml(row.isbn||row.faust||'')}</span></td>
      <td>${escapeHtml(row.owner_bibliotek_id)}</td>
      <td>${row.visibility}</td>
      <td>${loanWeeks} uger${bufferDays? ' + '+bufferDays+' dage':''}</td>
      <td>${nextTxt}</td>
      <td><button class="primary" type="button">Book</button></td>
    `
    tbody.appendChild(tr)

    tr.querySelector('button').addEventListener('click', async ()=>{
      let sDate = s, eDate = e
      if (!sDate || !eDate) {
        if (!next) { alert('Ingen ledig periode fundet. Vælg datoer manuelt.'); return }
        sDate = next.start; eDate = next.end
      }
      const ok=await isSetAvailableInPeriod(row.set_id, sDate, eDate)
      if(!ok){ alert('Reserveret i perioden – vælg anden dato.'); return }
      const { error } = await supabase.from('tbl_booking').insert({
        set_id: row.set_id,
        requester_bibliotek_id: state.me.bibliotek_id,
        owner_bibliotek_id: row.owner_bibliotek_id,
        start_date: fmtDate(sDate),
        end_date: fmtDate(eDate),
        status:'pending'
      })
      if(error){ alert('Fejl ved booking: '+error.message); return }
      alert('Booking sendt (Pending).')
    })
  })

  bookerResults.innerHTML = ''
  bookerResults.appendChild(table)
}

// ===== Booker: Min profil =====
async function loadMyProfile(){
  const { data, error } = await supabase.from('tbl_bibliotek')
    .select('bibliotek_id,bibliotek_navn,addr_line1,addr_line2,postal_code,city,contact_name,contact_email,contact_phone,shipping_notes')
    .eq('bibliotek_id', state.me.bibliotek_id).maybeSingle()
  if(error){ showStatus('Profil-fejl: '+error.message,'err'); return }
  state.myProfile = data
}
function renderMyProfile(){
  const p = state.myProfile || {}
  profileForm.innerHTML = `
    <div><label>Bibliotek ID</label><input type="text" value="${escapeHtml(p.bibliotek_id||'')}" disabled /></div>
    <div><label>Navn</label><input id="pf_navn" type="text" value="${escapeHtml(p.bibliotek_navn||'')}" /></div>
    <div><label>Adresse 1</label><input id="pf_addr1" type="text" value="${escapeHtml(p.addr_line1||'')}" /></div>
    <div><label>Adresse 2</label><input id="pf_addr2" type="text" value="${escapeHtml(p.addr_line2||'')}" /></div>
    <div><label>Postnr.</label><input id="pf_post" type="text" value="${escapeHtml(p.postal_code||'')}" /></div>
    <div><label>By</label><input id="pf_city" type="text" value="${escapeHtml(p.city||'')}" /></div>
    <div><label>Kontakt</label><input id="pf_contact" type="text" value="${escapeHtml(p.contact_name||'')}" /></div>
    <div><label>Email</label><input id="pf_email" type="email" value="${escapeHtml(p.contact_email||'')}" /></div>
    <div><label>Telefon</label><input id="pf_phone" type="tel" value="${escapeHtml(p.contact_phone||'')}" /></div>
    <div style="grid-column:1/-1;"><label>Forsendelsesnoter</label><textarea id="pf_notes">${escapeHtml(p.shipping_notes||'')}</textarea></div>
  `
}
saveProfile.addEventListener('click', async ()=>{
  const payload = {
    bibliotek_navn: getVal('#pf_navn'), addr_line1: getVal('#pf_addr1'), addr_line2: getVal('#pf_addr2'),
    postal_code: getVal('#pf_post'), city: getVal('#pf_city'),
    contact_name: getVal('#pf_contact'), contact_email: getVal('#pf_email'), contact_phone: getVal('#pf_phone'),
    shipping_notes: getVal('#pf_notes')
  }
  const { error } = await supabase.from('tbl_bibliotek').update(payload).eq('bibliotek_id', state.me.bibliotek_id)
  if(error){ showStatus('Gem profil: '+error.message,'err'); return }
  showStatus('Profil gemt','ok'); setTimeout(hideStatus,1500)
})

// ===== Admin: Region & Sæt & Copies =====
loadAdminData.addEventListener('click', async ()=>{
  await loadRegionalsWithProfiles()
  await loadSets(true)
})

addRegional.addEventListener('click', async ()=>{
  const owner=adminOwner.value, child=(newRegionalId.value||'').trim()
  if(!owner||!child){ showStatus('Angiv både central og bibliotek_id','err'); return }
  const { data:exists, error:exErr } = await supabase.from('tbl_bibliotek').select('bibliotek_id').eq('bibliotek_id',child).maybeSingle()
  if(exErr){ showStatus('Opslag fejl: '+exErr.message,'err'); return }
  if(!exists){ showStatus('Bibliotek findes ikke: '+child,'err'); return }
  const { error } = await supabase.from('tbl_bibliotek_relation').insert({ bibliotek_id: child, central_id: owner, active:true })
  if(error){ showStatus('Tilføj relation: '+error.message,'err'); return }
  newRegionalId.value=''
  await loadRegionalsWithProfiles()
  showStatus('Relation tilføjet','ok'); setTimeout(hideStatus,1200)
})

async function loadRegionalsWithProfiles(){
  const owner=adminOwner.value
  const { data:rels, error } = await supabase.from('tbl_bibliotek_relation')
    .select('relation_id,bibliotek_id,central_id,active').eq('central_id',owner).order('bibliotek_id')
  if(error){ showStatus('loadRegionals: '+error.message,'err'); return }
  const ids=(rels||[]).map(r=>r.bibliotek_id)
  let profs=[]
  if(ids.length){
    const { data, error:e2 } = await supabase.from('tbl_bibliotek')
      .select('bibliotek_id,bibliotek_navn,addr_line1,addr_line2,postal_code,city,contact_name,contact_email,contact_phone,shipping_notes')
      .in('bibliotek_id', ids)
    if(e2){ showStatus('Hent profiler: '+e2.message,'err'); return }
    profs=data||[]
  }
  state.regionalMap=new Map(profs.map(p=>[p.bibliotek_id,p]))
  renderRegionalEditor(rels||[])
}
function renderRegionalEditor(relRows){
  const table=document.createElement('table'); table.innerHTML=`
    <thead>
      <tr>
        <th>ID</th><th>Aktiv</th><th>Navn</th><th>Adresse 1</th><th>Adresse 2</th>
        <th>Postnr.</th><th>By</th><th>Kontakt</th><th>Email</th><th>Tlf</th>
        <th style="min-width:220px;">Forsendelsesnoter</th><th>Gem</th><th>Fjern</th>
      </tr>
    </thead><tbody></tbody>`
  const tbody=table.querySelector('tbody')
  relRows.forEach(r=>{
    const p=state.regionalMap.get(r.bibliotek_id)||{}
    const tr=document.createElement('tr'); tr.innerHTML=`
      <td>${r.bibliotek_id}</td>
      <td><input type="checkbox" ${r.active?'checked':''} /></td>
      <td><input type="text" value="${escapeHtml(p.bibliotek_navn||'')}" data-f="bibliotek_navn"/></td>
      <td><input type="text" value="${escapeHtml(p.addr_line1||'')}" data-f="addr_line1"/></td>
      <td><input type="text" value="${escapeHtml(p.addr_line2||'')}" data-f="addr_line2"/></td>
      <td><input type="text" value="${escapeHtml(p.postal_code||'')}" data-f="postal_code"/></td>
      <td><input type="text" value="${escapeHtml(p.city||'')}" data-f="city"/></td>
      <td><input type="text" value="${escapeHtml(p.contact_name||'')}" data-f="contact_name"/></td>
      <td><input type="email" value="${escapeHtml(p.contact_email||'')}" data-f="contact_email"/></td>
      <td><input type="tel" value="${escapeHtml(p.contact_phone||'')}" data-f="contact_phone"/></td>
      <td><textarea data-f="shipping_notes">${escapeHtml(p.shipping_notes||'')}</textarea></td>
      <td><button class="primary" type="button">Gem</button></td>
      <td><button class="ghost" type="button">Fjern</button></td>`
    tbody.appendChild(tr)

    tr.children[1].querySelector('input').addEventListener('change', async ev=>{
      const { error } = await supabase.from('tbl_bibliotek_relation').update({ active: ev.target.checked }).eq('relation_id', r.relation_id)
      if(error){ showStatus('Opdater relation: '+error.message,'err'); ev.target.checked=!ev.target.checked; return }
      showStatus('Relation opdateret','ok'); setTimeout(hideStatus,1200)
    })
    tr.children[11].querySelector('button.primary').addEventListener('click', async ()=>{
      const payload=collectRowPayload(tr,[
        'bibliotek_navn','addr_line1','addr_line2','postal_code','city','contact_name','contact_email','contact_phone','shipping_notes'
      ])
      const { error } = await supabase.from('tbl_bibliotek').update(payload).eq('bibliotek_id', r.bibliotek_id)
      if(error){ showStatus('Gem profil ('+r.bibliotek_id+'): '+error.message,'err'); return }
      showStatus('Profil opdateret ('+r.bibliotek_id+')','ok'); setTimeout(hideStatus,1200)
    })
    tr.children[12].querySelector('button.ghost').addEventListener('click', async ()=>{
      const { error } = await supabase.from('tbl_bibliotek_relation').delete().eq('relation_id', r.relation_id)
      if(error){ showStatus('Slet relation: '+error.message,'err'); return }
      await loadRegionalsWithProfiles()
      showStatus('Relation fjernet','ok'); setTimeout(hideStatus,1200)
    })
  })
  regionalsTable.innerHTML=''; regionalsTable.appendChild(table)
}

// ---- SÆT
refreshSets.addEventListener('click', ()=>loadSets(true))
createSet.addEventListener('click', createNewSet)

async function loadSets(fillCopiesDropdown=false){
  const owner=adminOwner.value
  const { data, error } = await supabase.from('tbl_saet')
    .select('set_id,title,author,isbn,faust,visibility,loan_weeks,buffer_days,active,requested_count,allow_substitution,allow_partial,min_delivery,notes,owner_bibliotek_id')
    .eq('owner_bibliotek_id', owner).order('title')
  if(error){ showStatus('loadSets: '+error.message,'err'); return }
  state.setsForOwner = data || []
  renderSetsTable(state.setsForOwner)

  if(fillCopiesDropdown){
    copiesSetSelect.innerHTML=''
    state.setsForOwner.forEach(s=>{
      const opt=document.createElement('option')
      opt.value = s.set_id
      opt.textContent = `${s.title} (${s.isbn||s.faust||'—'})`
      copiesSetSelect.appendChild(opt)
    })
    state.selectedSet = state.setsForOwner[0] || null
    if(state.selectedSet) copiesSetSelect.value = state.selectedSet.set_id
  }
}
function renderSetsTable(rows){
  const table=document.createElement('table'); table.innerHTML=`
    <thead>
      <tr><th>Titel</th><th>Synlighed</th><th>Uger</th><th>Buffer</th><th>Aktiv</th>
      <th>Min.lev</th><th>Delvis</th><th>Subst.</th><th>Gem</th></tr>
    </thead><tbody></tbody>`
  const tbody=table.querySelector('tbody')
  ;(rows||[]).forEach(r=>{
    const tr=document.createElement('tr'); tr.innerHTML=`
      <td><input type="text" value="${escapeHtml(r.title||'')}" data-f="title"/></td>
      <td><select data-f="visibility">
            <option value="national" ${r.visibility==='national'?'selected':''}>national</option>
            <option value="regional" ${r.visibility==='regional'?'selected':''}>regional</option>
          </select></td>
      <td><input type="number" min="1" value="${r.loan_weeks||8}" data-f="loan_weeks"/></td>
      <td><input type="number" min="0" value="${r.buffer_days||0}" data-f="buffer_days"/></td>
      <td><input type="checkbox" ${r.active?'checked':''} data-f="active"/></td>
      <td><input type="number" min="0" value="${r.min_delivery||0}" data-f="min_delivery"/></td>
      <td><input type="checkbox" ${r.allow_partial?'checked':''} data-f="allow_partial"/></td>
      <td><input type="checkbox" ${r.allow_substitution?'checked':''} data-f="allow_substitution"/></td>
      <td><button class="primary" type="button">Gem</button></td>`
    tbody.appendChild(tr)
    tr.querySelector('button').addEventListener('click', async ()=>{
      const payload=collectRowPayload(tr,['title','visibility','loan_weeks','buffer_days','active','min_delivery','allow_partial','allow_substitution'])
      const { error } = await supabase.from('tbl_saet').update(payload).eq('set_id', r.set_id)
      if(error){ showStatus('Gem sæt: '+error.message,'err'); return }
      showStatus('Sæt opdateret','ok'); setTimeout(hideStatus,1200)
    })
  })
  setsTable.innerHTML=''; setsTable.appendChild(table)
}
async function createNewSet(){
  const owner=adminOwner.value
  const payload = {
    title:(newTitle.value||'').trim(), author:(newAuthor.value||'').trim()||null,
    isbn:(newISBN.value||'').trim()||null, faust:(newFAUST.value||'').trim()||null,
    requested_count:10, loan_weeks:parseInt(newLoanWeeks.value,10)||8, buffer_days:parseInt(newBufferDays.value,10)||0,
    visibility:newVisibility.value, owner_bibliotek_id:owner, active:true
  }
  if(!payload.title){ showStatus('Titel er påkrævet','err'); return }
  const { error } = await supabase.from('tbl_saet').insert(payload)
  if(error){ showStatus('Opret sæt: '+error.message,'err'); return }
  newTitle.value=''; newAuthor.value=''; newISBN.value=''; newFAUST.value=''
  await loadSets(true)
  showStatus('Sæt oprettet','ok'); setTimeout(hideStatus,1500)
}

// ---- EKSEMPLARER
copiesSetSelect.addEventListener('change', ()=>{
  state.selectedSet = state.setsForOwner.find(s => String(s.set_id)===String(copiesSetSelect.value)) || null
})
loadCopies.addEventListener('click', loadCopiesForSelectedSet)
addCopy.addEventListener('click', addNewCopy)

async function loadCopiesForSelectedSet(){
  const s = state.selectedSet
  if(!s){ showStatus('Vælg et sæt først','err'); return }
  const owner = adminOwner.value

  let q = supabase.from(COPY_TABLE)
    .select(`${COPY_BARCODE_COL}, ${COPY_BOOKING_COL}, ${COPY_LOAN_COL}, ${COPY_TITLE_COL}, ${COPY_AUTHOR_COL}, ${COPY_ISBN_COL}, ${COPY_FAUST_COL}, ${COPY_OWNER_COL}`)
    .eq(COPY_OWNER_COL, owner)

  if (s.isbn)  q = q.eq(COPY_ISBN_COL, s.isbn)
  else if (s.faust) q = q.eq(COPY_FAUST_COL, s.faust)

  const { data, error } = await q.order(COPY_BARCODE_COL, { ascending:true })
  if(error){ showStatus('Hent eksemplarer: '+error.message,'err'); return }
  state.copies = data || []
  renderCopiesTable()
}
function renderCopiesTable(){
  const table=document.createElement('table'); table.innerHTML=`
    <thead>
      <tr><th>Stregkode</th><th>Bookingstatus</th><th>Udlånsstatus</th><th>Titel</th><th>Forfatter</th><th>ISBN</th><th>FAUST</th><th>Gem</th><th>Slet</th></tr>
    </thead><tbody></tbody>`
  const tbody=table.querySelector('tbody')
  state.copies.forEach(c=>{
    const tr=document.createElement('tr'); tr.innerHTML=`
      <td><input type="text" value="${escapeHtml(c[COPY_BARCODE_COL]||'')}" data-f="${COPY_BARCODE_COL}" disabled /></td>
      <td>
        <select data-f="${COPY_BOOKING_COL}">
          <option value="Ledig" ${c[COPY_BOOKING_COL]==='Ledig'?'selected':''}>Ledig</option>
          <option value="Reserveret" ${c[COPY_BOOKING_COL]==='Reserveret'?'selected':''}>Reserveret</option>
          <option value="Udlånt" ${c[COPY_BOOKING_COL]==='Udlånt'?'selected':''}>Udlånt</option>
          <option value="Hjemkommet" ${c[COPY_BOOKING_COL]==='Hjemkommet'?'selected':''}>Hjemkommet</option>
          <option value="Mangler" ${c[COPY_BOOKING_COL]==='Mangler'?'selected':''}>Mangler</option>
        </select>
      </td>
      <td><input type="text" value="${escapeHtml(c[COPY_LOAN_COL]||'Ukendt')}" data-f="${COPY_LOAN_COL}" disabled /></td>
      <td><input type="text" value="${escapeHtml(c[COPY_TITLE_COL]||'')}" data-f="${COPY_TITLE_COL}" /></td>
      <td><input type="text" value="${escapeHtml(c[COPY_AUTHOR_COL]||'')}" data-f="${COPY_AUTHOR_COL}" /></td>
      <td><input type="text" value="${escapeHtml(c[COPY_ISBN_COL]||'')}" data-f="${COPY_ISBN_COL}" /></td>
      <td><input type="text" value="${escapeHtml(c[COPY_FAUST_COL]||'')}" data-f="${COPY_FAUST_COL}" /></td>
      <td><button class="primary" type="button">Gem</button></td>
      <td><button class="ghost" type="button">Slet</button></td>`
    tbody.appendChild(tr)

    tr.children[7].querySelector('button').addEventListener('click', async ()=>{
      const payload = collectRowPayload(tr, [COPY_BOOKING_COL,COPY_TITLE_COL,COPY_AUTHOR_COL,COPY_ISBN_COL,COPY_FAUST_COL])
      const { error } = await supabase.from(COPY_TABLE).update(payload).eq(COPY_BARCODE_COL, c[COPY_BARCODE_COL]).eq(COPY_OWNER_COL, c[COPY_OWNER_COL])
      if(error){ showStatus('Gem eksemplar: '+error.message,'err'); return }
      showStatus('Eksemplar opdateret','ok'); setTimeout(hideStatus,1200)
    })
    tr.children[8].querySelector('button').addEventListener('click', async ()=>{
      const { error } = await supabase.from(COPY_TABLE).delete().eq(COPY_BARCODE_COL, c[COPY_BARCODE_COL]).eq(COPY_OWNER_COL, c[COPY_OWNER_COL])
      if(error){ showStatus('Slet eksemplar: '+error.message,'err'); return }
      await loadCopiesForSelectedSet()
      showStatus('Eksemplar slettet','ok'); setTimeout(hideStatus,1200)
    })
  })
  copiesTable.innerHTML=''; copiesTable.appendChild(table)
}
async function addNewCopy(){
  const s=state.selectedSet
  if(!s){ showStatus('Vælg et sæt først','err'); return }
  const owner=adminOwner.value
  const bc=(newCopyBarcode.value||'').trim()
  if(!bc){ showStatus('Indtast stregkode','err'); return }

  const payload={}
  payload[COPY_BARCODE_COL]=bc
  payload[COPY_BOOKING_COL]='Ledig'
  payload[COPY_LOAN_COL]='Ukendt'
  payload[COPY_TITLE_COL]=s.title || null
  payload[COPY_AUTHOR_COL]=s.author || null
  if(s.isbn)  payload[COPY_ISBN_COL]=s.isbn
  if(s.faust) payload[COPY_FAUST_COL]=s.faust
  payload[COPY_OWNER_COL]=owner

  const { error } = await supabase.from(COPY_TABLE).insert(payload)
  if(error){ showStatus('Tilføj eksemplar: '+error.message,'err'); return }
  newCopyBarcode.value=''
  await loadCopiesForSelectedSet()
  showStatus('Eksemplar tilføjet','ok'); setTimeout(hideStatus,1200)
}

// Rykkerrapport (næste 30 dage)
reportBookedButLoaned.addEventListener('click', async ()=>{
  const owner = adminOwner.value
  const { data, error } = await supabase
    .from('vw_booked_but_loaned_next30_summary')
    .select('*')
    .eq('owner_bibliotek_id', owner)
    .order('start_date', { ascending: true })
  if(error){ showStatus('Rapport-fejl: '+error.message,'err'); return }

  if (!data?.length) {
    reportArea.innerHTML = '<div class="muted">Ingen bookede men stadig udlånte eksemplarer de næste 30 dage.</div>'
    return
  }
  const rows = data.map(r => `
    <tr>
      <td>${r.booking_id}</td>
      <td><strong>${escapeHtml(r.title||'')}</strong><br><span class="muted">${escapeHtml(r.isbn||r.faust||'')}</span></td>
      <td>${r.start_date} → ${r.end_date}</td>
      <td style="text-align:right">${r.loaned_copies}</td>
      <td>${(r.barcodes||[]).join(', ')}</td>
    </tr>
  `).join('')
  reportArea.innerHTML = `
    <table>
      <thead>
        <tr><th>Booking</th><th>Sæt</th><th>Periode</th><th>Udlånte eksemplarer</th><th>Stregkoder</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `
})

// ===== Utils =====
const getVal = sel => { const el=document.querySelector(sel); return (el && 'value' in el)? el.value.trim():null }
const escapeHtml = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
const fmtDate = d => d.toISOString().slice(0,10)
const today = () => { const d=new Date(); d.setHours(0,0,0,0); return d }
function addDays(d, n) { const x=new Date(d); x.setDate(x.getDate()+n); return x }
function rangesOverlap(s1,e1,s2,e2){ return (s1 <= e2) && (s2 <= e1) }
function collectRowPayload(tr, fields){
  const out={}
  fields.forEach(f=>{
    const n=tr.querySelector(`[data-f="${f}"]`); if(!n) return
    if(n.type==='checkbox') out[f]=!!n.checked
    else if(n.type==='number') out[f]= n.value === '' ? null : Number(n.value)
    else out[f]=n.value ?? null
  })
  return out
}
