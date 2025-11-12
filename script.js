// Læsekredssæt – Admin (v3.1.6) – Auto-connect
// Schema: Version 3.0 (POC Final). RLS/policies skal være sat.

const SUPABASE_URL = "https://qlkrzinyqirnigcwadki.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFsa3J6aW55cWlybmlnY3dhZGtpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3NjY2NjgsImV4cCI6MjA3ODM0MjY2OH0.-SV3dn7reKHeYis40I-aF3av0_XmCP-ZqB9KR6JT2so";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const st = {
  // Eksemplarer
  eks: { pageSize: 20, page: 0, total: 0, filters: { owner: '', status: '', q: '' }, statuses: ['ledig','reserveret','udlaant','hjemkommet','mangler'] },
  // Sæt
  saet: { pageSize: 15, page: 0, total: 0, filters: { owner: '', vis: '', q: '' }},
  // Biblioteker cache
  libs: { list: [], byId: {} }
};

// ------- Helpers -------
const $ = s => document.querySelector(s);
function el(tag, attrs={}, ...kids){
  const E = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)){
    if (k === 'class') E.className = v;
    else if (k.startsWith('on')) E.addEventListener(k.substring(2), v);
    else E.setAttribute(k, v);
  }
  for (const c of kids) if (c!=null) E.append(c instanceof Node ? c : document.createTextNode(c));
  return E;
}
function msg(id, text, ok=false){
  const box = $(id);
  if (!box) return;
  box.textContent = text;
  box.className = 'msg ' + (ok ? 'ok' : 'err');
  box.style.display = 'block';
  setTimeout(()=> box.style.display='none', 4000);
}
function bindTabs(){
  document.querySelectorAll('nav.tabs button[data-tab]').forEach(b=>{
    b.onclick = ()=>{
      document.querySelectorAll('nav.tabs button').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
      $('#'+b.dataset.tab).classList.add('active');
    };
  });
}
$('#toggleRole')?.addEventListener('click', ()=>alert('POC-toggle: Booker-view ikke implementeret i denne build.'));

// ==========================================
// ============ Eksemplarer (CRUD) ==========
// ==========================================
function bindEksControls(){
  $('#btnSearch').onclick = ()=>{ st.eks.page=0; eksPull(); };
  $('#btnReload').onclick = ()=> eksPull();
  $('#prev').onclick = ()=>{ if(st.eks.page>0){ st.eks.page--; eksPull(); } };
  $('#next').onclick = ()=>{ const max = Math.ceil(st.eks.total/st.eks.pageSize)-1; if(st.eks.page<max){ st.eks.page++; eksPull(); } };
  $('#btnNew').onclick = eksAddRow;

  $('#ownerFilterSel').onchange = e => { st.eks.filters.owner = e.target.value; };
  $('#statusFilter').onchange = e => st.eks.filters.status = e.target.value;
  $('#q').oninput = e => st.eks.filters.q = e.target.value.trim();
}
function eksStatusSelect(v){
  const s = el('select', { class:'edit status' });
  st.eks.statuses.forEach(x=> s.append(el('option', { value:x, selected: x===v }, x)));
  return s;
}
function eksValidate(r){
  if(!r.barcode) return 'stregkode mangler';
  if(!r.title) return 'title skal udfyldes';
  if(r.status && !st.eks.statuses.includes(r.status)) return 'Ugyldig status';
  return null;
}
async function eksCount(){
  let q = sb.from('tbl_beholdning').select('*', { count:'exact', head:true });
  const f = st.eks.filters;
  if (f.owner) q = q.eq('owner_bibliotek_id', f.owner);
  if (f.status) q = q.eq('status', f.status);
  if (f.q) q = q.or(['title.ilike.%'+f.q+'%','author.ilike.%'+f.q+'%','isbn.ilike.%'+f.q+'%','faust.ilike.%'+f.q+'%','barcode.ilike.%'+f.q+'%'].join(','));
  const { count, error } = await q; if(error){ msg('#msg','Fejl ved optælling: '+error.message); return 0; }
  return count||0;
}
async function eksFetch(){
  const f = st.eks.filters, from = st.eks.page*st.eks.pageSize, to = from+st.eks.pageSize-1;
  let q = sb.from('tbl_beholdning')
    .select('barcode,isbn,faust,title,author,status,owner_bibliotek_id')
    .order('barcode',{ascending:true})
    .range(from,to);
  if (f.owner) q = q.eq('owner_bibliotek_id', f.owner);
  if (f.status) q = q.eq('status', f.status);
  if (f.q) q = q.or(['title.ilike.%'+f.q+'%','author.ilike.%'+f.q+'%','isbn.ilike.%'+f.q+'%','faust.ilike.%'+f.q+'%','barcode.ilike.%'+f.q+'%'].join(','));
  const { data, error } = await q; if(error){ msg('#msg','Fejl ved hentning: '+error.message); return []; }
  return data||[];
}
async function eksPull(){
  st.eks.total = await eksCount();
  const rows = await eksFetch();
  const tb = $('#tblEks tbody'); tb.innerHTML='';
  rows.forEach(r=>{
    const tr = el('tr');
    const bc = el('td', {}, el('span',{class:'k'}, r.barcode||''));
    const ti = el('input',{class:'edit title', value:r.title||''});
    const au = el('input',{class:'edit author', value:r.author||''});
    const isb= el('input',{class:'edit isbn', value:r.isbn||''});
    const fa = el('input',{class:'edit faust', value:r.faust||''});
    const stsel = eksStatusSelect(r.status||'ledig');
    const ow = el('input',{class:'edit owner', value:r.owner_bibliotek_id||''});
    const act = el('td');

    const save = el('button',{class:'btn primary', onclick: async ()=>{
      const row = {
        title: ti.value.trim(),
        author: au.value.trim(),
        isbn: isb.value.trim(),
        faust: fa.value.trim(),
        status: stsel.value,
        owner_bibliotek_id: ow.value.trim()
      };
      const e = eksValidate({ ...row, barcode:r.barcode });
      if(e){ msg('#msg', e); return; }
      const { error } = await sb.from('tbl_beholdning').update(row).eq('barcode', r.barcode);
      if(error) msg('#msg','Fejl ved gem: '+error.message); else { msg('#msg','Række gemt',true); eksPull(); }
    }},'Gem');

    const del = el('button',{class:'btn danger', style:'margin-left:6px;', onclick: async ()=>{
      if(!confirm('Slet '+r.barcode+'?')) return;
      const { error } = await sb.from('tbl_beholdning').delete().eq('barcode', r.barcode);
      if(error) msg('#msg','Fejl ved sletning: '+error.message); else { msg('#msg','Slettet',true); eksPull(); }
    }},'Slet');

    act.append(save, del);
    tr.append(bc, el('td',{},ti), el('td',{},au), el('td',{},isb), el('td',{},fa), el('td',{},stsel), el('td',{},ow), act);
    tb.append(tr);
  });
  $('#pinfo').textContent = `Side ${st.eks.page+1} af ${Math.max(1,Math.ceil(st.eks.total/st.eks.pageSize))} • ${st.eks.total} rækker`;
}
function eksAddRow(){
  const tb = $('#tblEks tbody');
  const tmp = 'TMP-'+Date.now();
  const tr = el('tr');
  tr.append(
    el('td',{}, el('span',{class:'k'}, tmp)),
    el('td',{}, el('input',{class:'edit title', placeholder:'Titel'})),
    el('td',{}, el('input',{class:'edit author', placeholder:'Forfatter'})),
    el('td',{}, el('input',{class:'edit isbn', placeholder:'ISBN'})),
    el('td',{}, el('input',{class:'edit faust', placeholder:'FAUST'})),
    el('td',{}, eksStatusSelect('ledig')),
    el('td',{}, el('input',{class:'edit owner', placeholder:'Ejer (fx GENT)'})),
    el('td',{},
      el('button',{class:'btn primary', onclick: async ()=>{
        const row = {
          barcode: tmp,
          title: tr.querySelector('.title').value.trim(),
          author: tr.querySelector('.author').value.trim(),
          isbn: tr.querySelector('.isbn').value.trim(),
          faust: tr.querySelector('.faust').value.trim(),
          status: tr.querySelector('.status').value,
          owner_bibliotek_id: tr.querySelector('.owner').value.trim()
        };
        const err = eksValidate(row); if(err){ msg('#msg', err); return; }
        const { error } = await sb.from('tbl_beholdning').insert(row);
        if(error) msg('#msg','Fejl ved oprettelse: '+error.message); else { msg('#msg','Eksemplar oprettet', true); eksPull(); }
      }}, 'Opret'),
      el('button',{class:'btn ghost', style:'margin-left:6px;', onclick:()=> tr.remove()}, 'Annullér')
    )
  );
  tb.prepend(tr);
}

// ==========================================
// ============ Sæt – vedligehold ===========
// ==========================================
function bindSaetControls(){
  $('#btnSaetSearch').onclick = ()=>{ st.saet.page=0; saetPull(); };
  $('#saetPrev').onclick = ()=>{ if(st.saet.page>0){ st.saet.page--; saetPull(); } };
  $('#saetNext').onclick = ()=>{ const m = Math.ceil(st.saet.total/st.saet.pageSize)-1; if(st.saet.page<m){ st.saet.page++; saetPull(); } };
  $('#btnSaetNew').onclick = saetAddRow;

  $('#saetOwnerFilterSel').onchange = e => { st.saet.filters.owner = e.target.value; };
  $('#saetVisFilter').onchange = e => st.saet.filters.vis = e.target.value;
  $('#saetQ').oninput = e => st.saet.filters.q = e.target.value.trim();
}
function saetValidate(r){
  if(!r.title) return 'title skal udfyldes';
  if(!r.visibility || !['national','regional'].includes(r.visibility)) return 'visibility skal være national/regional';
  if(!r.owner_bibliotek_id) return 'owner_bibliotek_id skal udfyldes';
  if(r.requested_count < 0 || r.loan_weeks < 0 || r.buffer_days < 0 || r.min_delivery < 0) return 'talværdier må ikke være negative';
  return null;
}
async function saetCount(){
  let q = sb.from('tbl_saet').select('*', { count:'exact', head:true });
  const f = st.saet.filters;
  if(f.owner) q = q.eq('owner_bibliotek_id', f.owner);
  if(f.vis) q = q.eq('visibility', f.vis);
  if(f.q) q = q.or(['title.ilike.%'+f.q+'%','author.ilike.%'+f.q+'%','isbn.ilike.%'+f.q+'%','faust.ilike.%'+f.q+'%'].join(','));
  const { count, error } = await q; if(error){ msg('#msgSaet','Fejl ved optælling: '+error.message); return 0; }
  return count||0;
}
async function saetFetch(){
  const f = st.saet.filters, from = st.saet.page*st.saet.pageSize, to = from+st.saet.pageSize-1;
  let q = sb.from('tbl_saet')
    .select('set_id,title,author,isbn,faust,requested_count,loan_weeks,buffer_days,visibility,owner_bibliotek_id,active,allow_substitution,allow_partial,min_delivery,notes')
    .order('set_id',{ascending:true})
    .range(from,to);
  if(f.owner) q = q.eq('owner_bibliotek_id', f.owner);
  if(f.vis) q = q.eq('visibility', f.vis);
  if(f.q) q = q.or(['title.ilike.%'+f.q+'%','author.ilike.%'+f.q+'%','isbn.ilike.%'+f.q+'%','faust.ilike.%'+f.q+'%'].join(','));
  const { data, error } = await q; if(error){ msg('#msgSaet','Fejl ved hentning: '+error.message); return []; }
  return data||[];
}
async function saetPull(){
  st.saet.total = await saetCount();
  const rows = await saetFetch();
  const tb = $('#tblSaet tbody'); tb.innerHTML = '';
  rows.forEach(r=>{
    const tr = el('tr');
    const id = el('td',{}, String(r.set_id));
    const ti = el('input',{class:'edit s_title', value:r.title||''});
    const au = el('input',{class:'edit s_author', value:r.author||''});
    const isb= el('input',{class:'edit s_isbn', value:r.isbn||''});
    const fa = el('input',{class:'edit s_faust', value:r.faust||''});
    const rc = el('input',{class:'edit s_rc', type:'number', value:r.requested_count??0});
    const lw = el('input',{class:'edit s_lw', type:'number', value:r.loan_weeks??8});
    const bd = el('input',{class:'edit s_bd', type:'number', value:r.buffer_days??0});
    const vis= el('select',{class:'edit s_vis'},
      el('option',{value:'national',selected:r.visibility==='national'},'national'),
      el('option',{value:'regional',selected:r.visibility==='regional'},'regional')
    );
    const ow = el('input',{class:'edit s_ow', value:r.owner_bibliotek_id||''});
    const act= el('select',{class:'edit s_act'},
      el('option',{value:'true',selected:r.active===true},'Ja'),
      el('option',{value:'false',selected:r.active===false},'Nej')
    );
    const sub= el('select',{class:'edit s_sub'},
      el('option',{value:'true',selected:r.allow_substitution===true},'Ja'),
      el('option',{value:'false',selected:r.allow_substitution===false},'Nej')
    );
    const par= el('select',{class:'edit s_par'},
      el('option',{value:'true',selected:r.allow_partial===true},'Ja'),
      el('option',{value:'false',selected:r.allow_partial===false},'Nej')
    );
    const md = el('input',{class:'edit s_md', type:'number', value:r.min_delivery??0});

    const btnSave = el('button',{class:'btn primary', onclick: async ()=>{
      const row = {
        title: ti.value.trim(), author: au.value.trim(), isbn: isb.value.trim(), faust: fa.value.trim(),
        requested_count: Number(rc.value||0), loan_weeks: Number(lw.value||0), buffer_days: Number(bd.value||0),
        visibility: vis.value, owner_bibliotek_id: ow.value.trim(),
        active: act.value==='true', allow_substitution: sub.value==='true', allow_partial: par.value==='true',
        min_delivery: Number(md.value||0)
      };
      const e = saetValidate(row); if(e){ msg('#msgSaet', e); return; }
      const { error } = await sb.from('tbl_saet').update(row).eq('set_id', r.set_id);
      if(error) msg('#msgSaet','Fejl ved gem: '+error.message); else { msg('#msgSaet','Sæt gemt',true); saetPull(); }
    }}, 'Gem');

    const btnDel = el('button',{class:'btn danger', style:'margin-left:6px;', onclick: async ()=>{
      if(!confirm('Slet sæt '+r.set_id+'?')) return;
      const { error } = await sb.from('tbl_saet').delete().eq('set_id', r.set_id);
      if(error) msg('#msgSaet','Fejl ved sletning: '+error.message); else { msg('#msgSaet','Sæt slettet',true); saetPull(); }
    }}, 'Slet');

    tr.append(
      id, el('td',{},ti), el('td',{},au), el('td',{},isb), el('td',{},fa),
      el('td',{},rc), el('td',{},lw), el('td',{},bd), el('td',{},vis), el('td',{},ow),
      el('td',{},act), el('td',{},sub), el('td',{},par), el('td',{},md),
      el('td',{}, btnSave, btnDel)
    );
    tb.append(tr);
  });
  $('#saetPinfo').textContent = `Side ${st.saet.page+1} af ${Math.max(1,Math.ceil(st.saet.total/st.saet.pageSize))} • ${st.saet.total} rækker`;
}
function saetAddRow(){
  const tb = $('#tblSaet tbody');
  const tr = el('tr');
  tr.append(
    el('td',{}, '(ny)'),
    el('td',{}, el('input',{class:'edit s_title', placeholder:'Titel'})),
    el('td',{}, el('input',{class:'edit s_author', placeholder:'Forfatter'})),
    el('td',{}, el('input',{class:'edit s_isbn', placeholder:'ISBN'})),
    el('td',{}, el('input',{class:'edit s_faust', placeholder:'FAUST'})),
    el('td',{}, el('input',{class:'edit s_rc', type:'number', value:'10'})),
    el('td',{}, el('input',{class:'edit s_lw', type:'number', value:'8'})),
    el('td',{}, el('input',{class:'edit s_bd', type:'number', value:'0'})),
    el('td',{}, (()=>{
      const s=el('select',{class:'edit s_vis'});
      s.append(el('option',{value:'national'},'national'), el('option',{value:'regional'},'regional'));
      return s;
    })()),
    el('td',{}, el('input',{class:'edit s_ow', placeholder:'Ejer (fx GENT)'})),
    el('td',{}, (()=>{
      const s=el('select',{class:'edit s_act'}); s.append(el('option',{value:'true',selected:true},'Ja'), el('option',{value:'false'},'Nej')); return s;
    })()),
    el('td',{}, (()=>{
      const s=el('select',{class:'edit s_sub'}); s.append(el('option',{value:'false',selected:true},'Nej'), el('option',{value:'true'},'Ja')); return s;
    })()),
    el('td',{}, (()=>{
      const s=el('select',{class:'edit s_par'}); s.append(el('option',{value:'false',selected:true},'Nej'), el('option',{value:'true'},'Ja')); return s;
    })()),
    el('td',{}, el('input',{class:'edit s_md', type:'number', value:'0'})),
    el('td',{},
      el('button',{class:'btn primary', onclick: async ()=>{
        const row = {
          title: tr.querySelector('.s_title').value.trim(),
          author: tr.querySelector('.s_author').value.trim(),
          isbn: tr.querySelector('.s_isbn').value.trim(),
          faust: tr.querySelector('.s_faust').value.trim(),
          requested_count: Number(tr.querySelector('.s_rc').value||0),
          loan_weeks: Number(tr.querySelector('.s_lw').value||0),
          buffer_days: Number(tr.querySelector('.s_bd').value||0),
          visibility: tr.querySelector('.s_vis').value,
          owner_bibliotek_id: tr.querySelector('.s_ow').value.trim(),
          active: tr.querySelector('.s_act').value==='true',
          allow_substitution: tr.querySelector('.s_sub').value==='true',
          allow_partial: tr.querySelector('.s_par').value==='true',
          min_delivery: Number(tr.querySelector('.s_md').value||0)
        };
        const e = saetValidate(row); if(e){ msg('#msgSaet', e); return; }
        const { error } = await sb.from('tbl_saet').insert(row);
        if(error) msg('#msgSaet','Fejl ved oprettelse: '+error.message); else { msg('#msgSaet','Sæt oprettet', true); saetPull(); }
      }}, 'Opret'),
      el('button',{class:'btn ghost', style:'margin-left:6px;', onclick:()=> tr.remove()}, 'Annullér')
    )
  );
  tb.prepend(tr);
}

// ==========================================
// ======= Biblioteker / Region-fanen =======
// ==========================================
function formatLibLabel(x){
  const tag = x.is_central ? 'central' : 'lokal';
  return `${x.bibliotek_navn} (${x.bibliotek_id}) · ${tag}`;
}
async function loadLibraries(){
  const { data, error } = await sb.from('tbl_bibliotek')
    .select('bibliotek_id,bibliotek_navn,is_central,active')
    .order('is_central',{ascending:false})  // centrals først
    .order('bibliotek_navn',{ascending:true});
  if(error){ msg('#msgRel','Fejl ved hentning af biblioteker: '+error.message); return; }

  st.libs.list = (data||[]).filter(x=>x.active);
  st.libs.byId = Object.fromEntries(st.libs.list.map(x=>[x.bibliotek_id,x]));

  // Region: central/local dropdowns
  const centralSel = $('#relCentral'); centralSel.innerHTML='';
  st.libs.list.filter(x=>x.is_central).forEach(x=>{
    centralSel.append(el('option',{value:x.bibliotek_id}, formatLibLabel(x)));
  });
  const localSel = $('#relLocal'); localSel.innerHTML='';
  st.libs.list.filter(x=>!x.is_central).forEach(x=>{
    localSel.append(el('option',{value:x.bibliotek_id}, formatLibLabel(x)));
  });

  // Sæt-filter: owner dropdown
  const saetOwner = $('#saetOwnerFilterSel'); saetOwner.innerHTML='';
  saetOwner.append(el('option',{value:''},'(alle)'));
  st.libs.list.forEach(x=>{
    saetOwner.append(el('option',{value:x.bibliotek_id}, formatLibLabel(x)));
  });

  // Eksemplar-filter: owner dropdown
  const eksOwner = $('#ownerFilterSel'); eksOwner.innerHTML='';
  eksOwner.append(el('option',{value:''},'(alle)'));
  st.libs.list.forEach(x=>{
    eksOwner.append(el('option',{value:x.bibliotek_id}, formatLibLabel(x)));
  });
}
async function relList(){
  const { data, error } = await sb.from('tbl_bibliotek_relation').select('relation_id,bibliotek_id,central_id,active').order('relation_id');
  iferror: if(error){ msg('#msgRel','Fejl ved hentning af relationer: '+error.message); return; }
  const tb = $('#tblRel tbody'); tb.innerHTML='';
  (data||[]).forEach(r=>{
    const lib = st.libs.byId[r.bibliotek_id]; const cen = st.libs.byId[r.central_id];
    const tr = el('tr');
    tr.append(
      el('td',{}, String(r.relation_id)),
      el('td',{}, lib ? formatLibLabel(lib) : r.bibliotek_id),
      el('td',{}, cen ? formatLibLabel(cen) : r.central_id),
      el('td',{}, r.active ? 'Ja' : 'Nej'),
      el('td',{},
        el('button',{class:'btn danger', onclick: async ()=>{
          if(!confirm('Slet relation '+r.relation_id+'?')) return;
          const { error } = await sb.from('tbl_bibliotek_relation').delete().eq('relation_id', r.relation_id);
          if(error) msg('#msgRel','Fejl ved sletning: '+error.message); else { msg('#msgRel','Relation slettet',true); relList(); }
        }}, 'Slet')
      )
    );
    tb.append(tr);
  });
}
async function relAdd(){
  const central = $('#relCentral').value;
  const local = $('#relLocal').value;
  if(!central || !local){ msg('#msgRel','Vælg både central og lånerbibliotek'); return; }
  if(central === local){ msg('#msgRel','Central og låner må ikke være samme ID'); return; }
  const { error } = await sb.from('tbl_bibliotek_relation').insert({ bibliotek_id: local, central_id: central, active: true });
  if(error) msg('#msgRel','Fejl ved oprettelse: '+error.message); else { msg('#msgRel','Relation oprettet',true); relList(); }
}
function bindRelControls(){ $('#btnRelAdd').onclick = relAdd; }

// ===== Layout-sikkerhedssele =====
function validateLayout(){
  const requiredIds = [
    // Eksemplarer
    'tab-eks','tblEks','btnSearch','btnReload','btnNew','prev','next','ownerFilterSel','statusFilter','q',
    // Sæt
    'tab-saet','tblSaet','btnSaetSearch','btnSaetNew','saetPrev','saetNext','saetOwnerFilterSel','saetVisFilter','saetQ',
    // Region
    'tab-region','tblRel','btnRelAdd','relCentral','relLocal',
    // Header toggle
    'toggleRole'
  ];
  const missing = requiredIds.filter(id => !document.getElementById(id));
  if (missing.length) {
    alert('Layout-kontrakt brudt. Mangler: ' + missing.join(', '));
    console.error('Layout-kontrakt brudt:', missing);
  }
}

// ===== Init =====
function bindNav(){
  bindTabs();
  bindEksControls();
  bindSaetControls();
  bindRelControls();
}
async function boot(){
  bindNav();
  await loadLibraries();
  eksPull();
  saetPull();
  relList();
  validateLayout();
}
boot();
