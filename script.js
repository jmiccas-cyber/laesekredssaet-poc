/* global SUPABASE_URL, SUPABASE_ANON_KEY */
(function () {
  'use strict';

  // ---------- Supabase init ----------
  const statusEl = document.getElementById('status');
  const errEl = document.getElementById('error');

  function setStatus(msg) { statusEl.textContent = msg; }
  function setError(msg) { errEl.textContent = msg || ''; }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    setError('Supabase client not initialized – mangler URL eller ANON KEY i index.html.');
  }

  const sb = window.__APP.supabase = (window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

  // ---------- DOM refs ----------
  const modeBookerBtn = document.getElementById('modeBooker');
  const modeAdminBtn = document.getElementById('modeAdmin');
  const bookerCard = document.getElementById('bookerCard');
  const adminCard = document.getElementById('adminCard');

  const bibliotekSelect = document.getElementById('bibliotekSelect');
  const qInput = document.getElementById('q');
  const startInput = document.getElementById('startDato');
  const slutInput = document.getElementById('slutDato');
  const btnSearch = document.getElementById('btnSearch');
  const saetList = document.getElementById('saetList');
  const bookerMsg = document.getElementById('bookerMsg');

  const adminCentralSelect = document.getElementById('adminCentralSelect');
  const btnLoadPending = document.getElementById('btnLoadPending');
  const pendingList = document.getElementById('pendingList');
  const adminMsg = document.getElementById('adminMsg');

  // ---------- Mode switch ----------
  modeBookerBtn.addEventListener('click', () => {
    window.__APP.mode = 'booker';
    modeBookerBtn.classList.add('active');
    modeAdminBtn.classList.remove('active');
    bookerCard.style.display = '';
    adminCard.style.display = 'none';
    setStatus('Booker-visning');
    setError('');
  });

  modeAdminBtn.addEventListener('click', () => {
    window.__APP.mode = 'admin';
    modeAdminBtn.classList.add('active');
    modeBookerBtn.classList.remove('active');
    bookerCard.style.display = 'none';
    adminCard.style.display = '';
    setStatus('Admin-visning');
    setError('');
  });

  // ---------- Helpers ----------
  function iso(d) {
    if (!d) return null;
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return null;
    // Return yyyy-mm-dd (no TZ) for date-only comparisons stored as date
    return dt.toISOString().slice(0, 10);
  }

  function overlap(aStart, aEnd, bStart, bEnd) {
    // date strings "YYYY-MM-DD"
    return (aStart <= bEnd) && (bStart <= aEnd);
  }

  // ---------- Load biblioteker ----------
  async function loadBiblioteker() {
    if (!sb) return;
    setStatus('Henter biblioteker...');
    const { data, error } = await sb
      .from('tbl_bibliotek')
      .select('bibliotek_id, navn, type')
      .order('navn', { ascending: true });

    if (error) { setError('Fejl ved hentning af biblioteker: ' + error.message); return; }

    // Booker select (alle biblioteker)
    bibliotekSelect.innerHTML = '';
    for (const b of data) {
      const opt = document.createElement('option');
      opt.value = b.bibliotek_id;
      opt.textContent = `${b.navn}${b.type === 'Central' ? ' (Central)' : ''}`;
      bibliotekSelect.appendChild(opt);
    }

    // Admin: kun Central
    adminCentralSelect.innerHTML = '';
    for (const b of data.filter(x => x.type === 'Central')) {
      const opt = document.createElement('option');
      opt.value = b.bibliotek_id;
      opt.textContent = b.navn;
      adminCentralSelect.appendChild(opt);
    }

    if (data.length) {
      window.__APP.currentBibliotekId = bibliotekSelect.value;
      setStatus('Biblioteker indlæst.');
    }
  }

  // Hent central ID for valgt bibliotek
  async function getCentralForBibliotek(bibliotekId) {
    if (!sb || !bibliotekId) return null;
    const { data, error } = await sb
      .from('tbl_bibliotek_relation')
      .select('central_bibliotek_id')
      .eq('bibliotek_id', bibliotekId)
      .eq('aktiv', true)
      .maybeSingle();

    if (error) { setError('Fejl ved opslag af centralbibliotek: ' + error.message); return null; }
    return data ? data.central_bibliotek_id : null;
  }

  // ---------- Søg sæt ----------
  btnSearch.addEventListener('click', doSearch);
  bibliotekSelect.addEventListener('change', () => {
    window.__APP.currentBibliotekId = bibliotekSelect.value;
  });

  async function doSearch() {
    setError('');
    saetList.innerHTML = '';
    bookerMsg.textContent = '';

    const bibId = window.__APP.currentBibliotekId = bibliotekSelect.value;
    if (!bibId) { setError('Vælg et bibliotek.'); return; }

    const centralId = window.__APP.currentCentralId = await getCentralForBibliotek(bibId);
    if (!centralId) {
      // Måske er det et centralbibliotek selv – i så fald er centralId = bibId
      window.__APP.currentCentralId = centralId || bibId;
    }

    const q = (qInput.value || '').trim();
    const start = iso(startInput.value);
    const slut = iso(slutInput.value);

    if (!start || !slut) {
      setError('Vælg både start- og slutdato.');
      return;
    }
    if (start > slut) {
      setError('Startdato kan ikke være efter slutdato.');
      return;
    }

    setStatus('Søger sæt...');
    // Filter: synlighed = Land ELLER (Region og central_bibliotek_id = brugerens central)
    const visibilityFilter = `synlighed.eq.Land,and(synlighed.eq.Region,central_bibliotek_id.eq.${window.__APP.currentCentralId})`;

    // Basisselekt
    let query = sb
      .from('tbl_saet')
      .select('set_id, titel, forfatter, isbn, faust, antal_onskede, standard_laneperiode_uger, buffer_dage, synlighed, central_bibliotek_id, aktiv, substitution_tilladt, delvis_leverance_tilladt, minimum_leverance')
      .eq('aktiv', true)
      .or(visibilityFilter)
      .order('titel', { ascending: true });

    // Søgning
    if (q) {
      // simpelt OR-udtryk over tekstfelter
      query = query.or(
        `titel.ilike.%${q}%,forfatter.ilike.%${q}%,isbn.ilike.%${q}%,faust.ilike.%${q}%`
      );
    }

    const { data: saet, error } = await query;
    if (error) { setError('Fejl ved søgning: ' + error.message); return; }
    setStatus(`Fandt ${saet.length} sæt. Tjekker kalender...`);

    // Tjek kalender-tilgængelighed pr. sæt (Approved overlaps)
    for (const s of saet) {
      const avail = await isSetAvailable(s.set_id, start, slut);
      renderSetItem(s, avail, { start, slut, bibId });
    }

    bookerMsg.textContent = 'Kalender styrer udlånbarhed i POC. Inventarstatus er info-only.';
    setStatus('Færdig.');
  }

  async function isSetAvailable(setId, start, slut) {
    // hent approved bookinger der overlapper
    const { data, error } = await sb
      .from('tbl_booking')
      .select('start_dato, slut_dato, status')
      .eq('set_id', setId)
      .eq('status', 'Approved');

    if (error) { setError('Fejl ved kalenderopslag: ' + error.message); return { ok:false, conflicts:[] }; }

    const conflicts = (data || []).filter(b => overlap(start, slut, b.start_dato, b.slut_dato));
    return { ok: conflicts.length === 0, conflicts };
  }

  function renderSetItem(s, avail, ctx) {
    const div = document.createElement('div');
    div.className = 'item';

    const head = document.createElement('div');
    head.style.display = 'flex';
    head.style.gap = '8px';
    head.style.alignItems = 'center';

    const h3 = document.createElement('h3');
    const subj = `<strong>${s.titel}</strong> ${s.forfatter ? '· ' + s.forfatter : ''}`;
    h3.innerHTML = subj;

    const badge = document.createElement('span');
    badge.className = 'badge ' + (avail.ok ? 'ok' : 'warn');
    badge.textContent = avail.ok ? 'Ledig (kalender)' : 'Ikke ledig i perioden';

    head.appendChild(h3);
    head.appendChild(badge);
    head.appendChild(document.createElement('div')).className = 'right';
    div.appendChild(head);

    const meta = document.createElement('div');
    meta.className = 'muted';
    meta.textContent = `ISBN: ${s.isbn || '-'} · FAUST: ${s.faust || '-'} · Synlighed: ${s.synlighed}${s.synlighed === 'Region' ? ' (central krævet)' : ''}`;
    div.appendChild(meta);

    // Booking form
    const form = document.createElement('div');
    form.className = 'row';
    form.style.marginTop = '10px';

    const kontakt = document.createElement('input');
    kontakt.placeholder = 'Kontaktperson';
    kontakt.ariaLabel = 'Kontaktperson';
    const email = document.createElement('input');
    email.type = 'email';
    email.placeholder = 'E-mail';
    email.ariaLabel = 'E-mail';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'primary';
    btn.textContent = 'Anmod om booking';
    btn.disabled = !avail.ok; // kun gyldige (i POC)

    btn.addEventListener('click', async () => {
      setError('');
      setStatus('Opretter booking...');
      btn.disabled = true;
      const { data, error } = await sb
        .from('tbl_booking')
        .insert([{
          set_id: s.set_id,
          bibliotek_id: ctx.bibId,
          kontakt_navn: kontakt.value || null,
          kontakt_email: email.value || null,
          start_dato: ctx.start,
          slut_dato: ctx.slut,
          status: 'Pending'
        }])
        .select('booking_id')
        .single();

      if (error) {
        setError('Fejl ved oprettelse af booking: ' + error.message);
        btn.disabled = false;
        return;
      }
      setStatus('Booking oprettet (Pending).');
      const note = document.createElement('div');
      note.className = 'success';
      note.textContent = 'Anmodning sendt. Du får svar, når sættet er godkendt/afvist.';
      div.appendChild(note);
    });

    form.appendChild(kontakt);
    form.appendChild(email);
    form.appendChild(btn);
    div.appendChild(form);

    // Konfliktinfo
    if (!avail.ok && avail.conflicts?.length) {
      const k = document.createElement('div');
      k.className = 'note';
      const next = nextAvailableDate(avail.conflicts, ctx.start, ctx.slut);
      k.textContent = `Næste mulige start (estimat): ${next || '—'}`;
      div.appendChild(k);
    }

    saetList.appendChild(div);
  }

  function nextAvailableDate(conflicts, desiredStart /* yyyy-mm-dd */) {
    // simpelt estimat: vælg seneste slut_dato + 1 dag
    const latest = conflicts
      .map(c => c.slut_dato)
      .sort()
      .pop();
    if (!latest) return null;
    const d = new Date(latest);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  // ---------- Admin pending ----------
  btnLoadPending.addEventListener('click', loadPending);

  async function loadPending() {
    setError('');
    pendingList.innerHTML = '';
    adminMsg.textContent = '';

    const centralId = adminCentralSelect.value;
    if (!centralId) { setError('Vælg centralbibliotek.'); return; }

    setStatus('Henter afventende bookinger...');
    // Find sæt der hører til denne central (enten Land (må alle se) — men til godkendelse viser vi typisk Region + Land)
    // Vi henter Pending for sæt hvor set.central_bibliotek_id = centralId ELLER synlighed = 'Land'
    const { data, error } = await sb
      .from('tbl_booking')
      .select('booking_id, set_id, bibliotek_id, kontakt_navn, kontakt_email, start_dato, slut_dato, status, tbl_saet!inner(set_id, titel, synlighed, central_bibliotek_id), tbl_bibliotek!inner(bibliotek_id, navn)')
      .eq('status', 'Pending')
      .or(`tbl_saet.synlighed.eq.Land,and(tbl_saet.synlighed.eq.Region,tbl_saet.central_bibliotek_id.eq.${centralId})`)
      .order('start_dato', { ascending: true });

    if (error) { setError('Fejl ved indlæsning: ' + error.message); return; }

    for (const b of (data || [])) {
      renderPending(b);
    }
    adminMsg.textContent = `${data?.length || 0} afventende.`;
    setStatus('Færdig.');
  }

  function renderPending(b) {
    const div = document.createElement('div');
    div.className = 'item';

    const h3 = document.createElement('h3');
    h3.innerHTML = `<strong>${b.tbl_saet.titel}</strong> · ${b.tbl_saet.synlighed}`;
    div.appendChild(h3);

    const meta = document.createElement('div');
    meta.className = 'muted';
    meta.textContent = `Booking: ${b.start_dato} → ${b.slut_dato} · Fra: ${b.tbl_bibliotek.navn} · Kontakt: ${b.kontakt_navn || '-'} (${b.kontakt_email || '-'})`;
    div.appendChild(meta);

    const row = document.createElement('div');
    row.className = 'row';
    const approve = document.createElement('button');
    approve.type = 'button';
    approve.className = 'primary';
    approve.textContent = 'Godkend';

    const reject = document.createElement('button');
    reject.type = 'button';
    reject.className = 'ghost';
    reject.textContent = 'Afvis';

    const info = document.createElement('div');
    info.className = 'note';

    approve.addEventListener('click', async () => {
      setError('');
      info.textContent = 'Validerer kalender...';
      const clash = await isSetAvailable(b.set_id, b.start_dato, b.slut_dato);
      if (!clash.ok) {
        info.textContent = '';
        setError('Kan ikke godkende: Konflikt i perioden.');
        return;
      }
      const { error } = await sb
        .from('tbl_booking')
        .update({ status: 'Approved' })
        .eq('booking_id', b.booking_id);
      if (error) { setError('Fejl ved godkendelse: ' + error.message); return; }
      info.textContent = 'Godkendt.';
      approve.disabled = true; reject.disabled = true;
    });

    reject.addEventListener('click', async () => {
      setError('');
      const { error } = await sb
        .from('tbl_booking')
        .update({ status: 'Rejected' })
        .eq('booking_id', b.booking_id);
      if (error) { setError('Fejl ved afvisning: ' + error.message); return; }
      info.textContent = 'Afvist.';
      approve.disabled = true; reject.disabled = true;
    });

    row.appendChild(approve);
    row.appendChild(reject);
    row.appendChild(info);
    div.appendChild(row);

    pendingList.appendChild(div);
  }

  // ---------- Init on load ----------
  (async function init() {
    try {
      if (!window.__APP.supabase) return;
      await loadBiblioteker();
      // Sæt default-datoer (8 ugers standard)
      const today = new Date();
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7);
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 56);
      startInput.value = start.toISOString().slice(0,10);
      slutInput.value = end.toISOString().slice(0,10);
      setStatus('Klar.');
    } catch (e) {
      setError(String(e?.message || e));
    }
  })();

})();
