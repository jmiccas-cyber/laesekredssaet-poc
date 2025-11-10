// --- Læsekredssæt POC v2.8 — script.js ---
// Kræver: <script type="module" src="script.js"></script> i index.html

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// ✅ DINE SUPABASE OPLYSNINGER
const supabaseUrl = 'https://qlkrzinyqirnigcwadki.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFsa3J6aW55cWlybmlnY3dhZGtpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3NjY2NjgsImV4cCI6MjA3ODM0MjY2OH0.-SV3dn7reKHeYis40I-aF3av0_XmCP-ZqB9KR6JT2so'

const supabase = createClient(supabaseUrl, supabaseKey)
console.log('✅ Supabase client initialized:', !!supabase)

// --- DOM ELEMENTER (tilpas til dine IDs i index.html) ---
const searchInput  = document.getElementById('searchInput')
const searchButton = document.getElementById('searchButton')
const resultsDiv   = document.getElementById('results')

// --- SØGNING I tblSæt ---
async function searchSets() {
  const term = (searchInput?.value || '').trim()

  if (!term) {
    resultsDiv.innerHTML = '<p>Indtast søgeord…</p>'
    return
  }

  resultsDiv.innerHTML = '<p>⏳ Søger…</p>'

  const { data, error } = await supabase
    .from('tblSæt')
    .select('*')
    .or(`Titel.ilike.%${term}%,Forfatter.ilike.%${term}%,ISBN.ilike.%${term}%,FAUST.ilike.%${term}%`)
    .limit(50)

  if (error) {
    console.error('Fejl ved søgning:', error)
    resultsDiv.innerHTML = `<p style="color:red;">Fejl ved søgning: ${error.message}</p>`
    return
  }

  if (!data || data.length === 0) {
    resultsDiv.innerHTML = '<p>Ingen resultater.</p>'
    return
  }

  renderResults(data)
}

// --- VISNING AF RESULTATER ---
function renderResults(rows) {
  let html = `
    <table class="result-table">
      <thead>
        <tr>
          <th>Titel</th>
          <th>Forfatter</th>
          <th>ISBN</th>
          <th>FAUST</th>
          <th>Antal ønskede</th>
          <th>CentralbibliotekID</th>
          <th>Handling</th>
        </tr>
      </thead>
      <tbody>
  `
  for (const row of rows) {
    html += `
      <tr>
        <td>${escapeHtml(row.Titel ?? '')}</td>
        <td>${escapeHtml(row.Forfatter ?? '')}</td>
        <td>${escapeHtml(row.ISBN ?? '')}</td>
        <td>${escapeHtml(row.FAUST ?? '')}</td>
        <td>${row.AntalØnskedeEksemplarer ?? ''}</td>
        <td>${row.CentralbibliotekID ?? ''}</td>
        <td><button class="bookBtn" data-id="${row.id}">Book</button></td>
      </tr>
    `
  }
  html += '</tbody></table>'
  resultsDiv.innerHTML = html

  document.querySelectorAll('.bookBtn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id')
      openBookingForm(id)
    })
  })
}

// --- BOOKING DIALOG (POC simpel) ---
function openBookingForm(setId) {
  const borrower = prompt('Lånerbibliotek (navn):')
  if (!borrower) return
  const fromDate = prompt('Startdato (YYYY-MM-DD):')
  const toDate   = prompt('Slutdato (YYYY-MM-DD):')
  if (!fromDate || !toDate) return

  createBooking(setId, borrower, fromDate, toDate)
}

// --- GEM BOOKING I tblBooking ---
async function createBooking(setId, borrower, fromDate, toDate) {
  const booking = {
    SetID: setId,
    LånerBibliotek: borrower,
    StartDato: fromDate,
    SlutDato: toDate,
    Status: 'Pending',
    OprettetDato: new Date().toISOString()
  }

  const { error } = await supabase.from('tblBooking').insert([booking])

  if (error) {
    console.error('Fejl ved oprettelse af booking:', error)
    alert('Fejl: ' + error.message)
    return
  }
  alert('Booking sendt til godkendelse ✅')
}

// --- HJÆLPEFUNKTION: HTML-escape ---
function escapeHtml(str) {
  return String(str)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#039;')
}

// --- EVENT LISTENERS ---
searchButton?.addEventListener('click', searchSets)
searchInput?.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') searchSets()
})

console.log('📘 Læsekredssæt POC v2.8 script indlæst')
