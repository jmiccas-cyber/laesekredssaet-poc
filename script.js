// Læsekredssæt – Admin Eksemplarer UI (v3.1.3)
// Auto-connect version (POC demo)

const SUPABASE_URL = "https://qlkrzinyqirnigcwadki.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFsa3J6aW55cWlybmlnY3dhZGtpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3NjY2NjgsImV4cCI6MjA3ODM0MjY2OH0.-SV3dn7reKHeYis40I-aF3av0_XmCP-ZqB9KR6JT2so";

let supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let state = {
  pageSize: 20,
  page: 0,
  total: 0,
  filters: { owner_bibliotek_id: '', status: '', q: '' },
  statusAllow: ['ledig','reserveret','udlaant','hjemkommet','mangler']
};

function $(s){ return document.querySelector(s); }
function el(tag, attrs={}, ...children){
  const e = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)){
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.substring(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children){ if (c) e.append(c instanceof Node ? c : document.createTextNode(c)); }
  return e;
}
function showMsg(t, ok=false){
  const m = $('#msg'); m.textContent = t;
  m.className = 'msg ' + (ok ? 'ok' : 'err');
  m.style.display = 'block'; setTimeout(()=> m.style.display = 'none', 4000);
}

function bindTabs(){
  document.querySelectorAll('nav.tabs button[data-tab]').forEach(b=>{
    b.onclick = () => {
      document.querySelectorAll('nav.tabs button').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
      $('#'+b.dataset.tab).classList.add('active');
    };
  });
}
function bindControls(){
  $('#btnSearch').onclick = ()=>{ state.page=0; pull(); };
  $('#btnReload').onclick = ()=> pull();
  $('#prev').onclick = ()=>{ if(state.page>0){ state.page--; pull(); } };
  $('#next').onclick = ()=>{ if(state.page < Math.ceil(state.total/state.pageSize)-1){ state.page++; pull(); } };
  $('#btnNew').onclick = ()=> addNewRow();
  $('#toggleRole').onclick = ()=> alert('POC: Rolle-skift ikke implementeret i denne build');

  $('#ownerFilter').oninput = e => state.filters.owner_bibliotek_id = e.target.value.trim();
  $('#statusFilter').onchange = e => state.filters.status = e.target.value;
  $('#q').oninput = e => state.filters.q = e.target.value.trim();
}

async function countTotal(){
  let q = supabaseClient.from('tbl_beholdning').select('*', { count:'exact', head:true });
  const f = state.filters;
  if (f.owner_bibliotek_id) q = q.eq('owner_bibliotek_id', f.owner_bibliotek_id);
  if (f.status) q = q.eq('status', f.status);
  if (f.q) q = q.or([
    'title.ilike.%'+f.q+'%',
    'author.ilike.%'+f.q+'%',
    'isbn.ilike.%'+f.q+'%',
    'faust.ilike.%'+f.q+'%',
    'barcode.ilike.%'+f.q+'%'
  ].join(','));
  const { count, error } = await q;
  if (error){ showMsg('Fejl ved optælling: '+error.message); return 0; }
  return count || 0;
}

async function fetchPage(){
  const f = state.filters;
  const from = state.page * state.pageSize, to = from + state.pageSize - 1;
  let q = supabaseClient.from('tbl_beholdning')
    .select('barcode,isbn,faust,title,author,status,owner_bibliotek_id')
    .order('barcode', { ascending:true })
    .range(from, to);

  if (f.owner_bibliotek_id) q = q.eq('owner_bibliotek_id', f.owner_bibliotek_id);
  if (f.status) q = q.eq('status', f.status);
  if (f.q) q = q.or([
    'title.ilike.%'+f.q+'%',
    'author.ilike.%'+f.q+'%',
    'isbn.ilike.%'+f.q+'%',
    'faust.ilike.%'+f.q+'%',
    'barcode.ilike.%'+f.q+'%'
  ].join(','));

  const { data, error } = await q;
  if (error){ showMsg('Fejl ved hentning: '+error.message); return []; }
  return data || [];
}

async function pull(){
  state.total = await countTotal();
  const rows = await fetchPage();
  renderTable(rows);
  $('#pinfo').textContent = `Side ${state.page+1} af ${Math.max(1, Math.ceil(state.total/state.pageSize))} • ${state.total} rækker`;
}

function statusSelect(v){
  const s = el('select', { class:'edit status' });
  state.statusAllow.forEach(st=>{
    const o = el('option', { value: st }, st);
    if (st === v) o.selected = true;
    s.append(o);
  });
  return s;
}

function renderTable(rows){
  const tb = $('#tbl tbody'); tb.innerHTML = '';
  rows.forEach(r=>{
    const tr = el('tr');
    const bc = el('td', {}, el('span', { class:'k' }, r.barcode || ''));
    const ti = el('input', { class:'edit title', value: r.title || '' });
    const au = el('input', { class:'edit author', value: r.author || '' });
    const isb = el('input', { class:'edit isbn', value: r.isbn || '' });
    const fa = el('input', { class:'edit faust', value: r.faust || '' });
    const st = statusSelect(r.status || 'ledig');
    const ow = el('input', { class:'edit owner', value: r.owner_bibliotek_id || '' });

    const act = el('td');
    const save = el('button', { class:'btn primary', onclick: async ()=>{
      await saveRow({
        barcode: r.barcode,
        title: ti.value.trim(),
        author: au.value.trim(),
        isbn: isb.value.trim(),
        faust: fa.value.trim(),
        status: st.value,
        owner_bibliotek_id: ow.value.trim()
      });
    }}, 'Gem');

    const del = el('button', { class:'btn danger', style:'margin-left:6px;', onclick: async ()=>{
      if (!confirm('Slet '+r.barcode+'?')) return;
      await deleteRow(r.barcode);
    }}, 'Slet');

    act.append(save, del);
    tr.append(bc, el('td', {}, ti), el('td', {}, au), el('td', {}, isb), el('td', {}, fa), el('td', {}, st), el('td', {}, ow), act);
    tb.append(tr);
  });
}

function validateRow(r){
  if (!r.barcode) return 'stregkode mangler';
  if (!r.title) return 'title skal udfyldes';
  if (r.status && !state.statusAllow.includes(r.status)) return 'Ugyldig status';
  return null;
}

async function saveRow(r){
  const e = validateRow(r);
  if (e){ showMsg(e); return; }
  const { error } = await supabaseClient.from('tbl_beholdning').update({
    title: r.title,
    author: r.author,
    isbn: r.isbn,
    faust: r.faust,
    status: r.status,
    owner_bibliotek_id: r.owner_bibliotek_id
  }).eq('barcode', r.barcode);
  if (error) showMsg('Fejl ved gem: '+error.message);
  else { showMsg('Række gemt', true); pull(); }
}

async function deleteRow(bc){
  const { error } = await supabaseClient.from('tbl_beholdning').delete().eq('barcode', bc);
  if (error) showMsg('Fejl ved sletning: '+error.message);
  else { showMsg('Slettet', true); pull(); }
}

function addNewRow(){
  const tb = $('#tbl tbody');
  const tmp = 'TMP-' + Date.now();

  const tr = el('tr');
  const bc = el('td', {}, el('span', { class:'k' }, tmp));
  const ti = el('input', { class:'edit title', placeholder:'Titel' });
  const au = el('input', { class:'edit author', placeholder:'Forfatter' });
  const isb = el('input', { class:'edit isbn', placeholder:'ISBN' });
  const fa = el('input', { class:'edit faust', placeholder:'FAUST' });
  const st = statusSelect('ledig');
  const ow = el('input', { class:'edit owner', placeholder:'Ejer (fx GENT)' });

  const act = el('td');
  const cr = el('button', { class:'btn primary', onclick: async ()=>{
    const row = {
      barcode: tmp,
      title: ti.value.trim(),
      author: au.value.trim(),
      isbn: isb.value.trim(),
      faust: fa.value.trim(),
      status: st.value,
      owner_bibliotek_id: ow.value.trim()
    };
    const e = validateRow(row);
    if (e){ showMsg(e); return; }
    await createRow(row);
  }}, 'Opret');
  const ca = el('button', { class:'btn ghost', style:'margin-left:6px;', onclick: ()=> tr.remove() }, 'Annullér');

  act.append(cr, ca);
  tr.append(bc, el('td', {}, ti), el('td', {}, au), el('td', {}, isb), el('td', {}, fa), el('td', {}, st), el('td', {}, ow), act);
  tb.prepend(tr);
}

async function createRow(r){
  const { error } = await supabaseClient.from('tbl_beholdning').insert(r);
  if (error) showMsg('Fejl ved oprettelse: '+error.message);
  else { showMsg('Eksemplar oprettet', true); pull(); }
}

(function init(){
  bindTabs();
  bindControls();
  pull();
})();
