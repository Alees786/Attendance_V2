// ═══════════════════════════════════════════════════════════════
//  ▼▼▼  PASTE YOUR APPS SCRIPT WEB APP URL HERE  ▼▼▼
// ═══════════════════════════════════════════════════════════════
const API_URL = 'https://script.google.com/macros/s/AKfycbzYEpToO_087F5ymiXq94WtEBt-02mJvCtTCgpQy-kUMb0jntDLPpg8UPPP3hiOyPaI/exec';
// Example:
// const API_URL = 'https://script.google.com/macros/s/AKfy.../exec';
// ═══════════════════════════════════════════════ ════════════════

// ─── API HELPER ───────────────────────────────────────────────
// All requests are GET with params (Apps Script only supports
// anonymous GET for public Web Apps without OAuth).
// Large writes (saveAttendance etc.) are sent as POST.
async function api(params) {
  const url = new URL(API_URL);
  Object.entries(params).forEach(([k, v]) => {
    url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : v);
  });
  const res = await fetch(url.toString(), { redirect: 'follow' });
  const data = await res.json();
  if (data && data.error) throw new Error(data.error);
  return data;
}

async function apiPost(body) {
  const res = await fetch(API_URL, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain' }, // text/plain avoids CORS preflight
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (data && data.error) throw new Error(data.error);
  return data;
}

// ─── STATE ────────────────────────────────────────────────────
let currentRole = 'teacher';
let currentUser = null;
let currentClass = null;
let allClasses   = [];
let attendanceData = {};
let students     = [];
let pendingChanges = {};

// ─── INIT ─────────────────────────────────────────────────────
window.onload = async function() {
  if (API_URL === 'YOUR_APPS_SCRIPT_WEB_APP_URL_HERE') {
    document.getElementById('api-notice').textContent = '⚠️ API URL not set — open index.html and set API_URL.';
    document.getElementById('api-notice').style.color = 'var(--warn)';
    document.getElementById('login-btn').disabled = true;
    return;
  }
  showLoading('Connecting to Server…');
  try {
    allClasses = await api({ action: 'getVisibleClasses' });
    populateLoginDropdown();
    document.getElementById('api-notice').textContent = '✅ Connected to Server';
    document.getElementById('api-notice').style.color = 'var(--success)';
  } catch(e) {
    document.getElementById('api-notice').textContent = '❌ Cannot reach API: ' + e.message;
    document.getElementById('api-notice').style.color = 'var(--danger)';
  }
  hideLoading();
};

function populateLoginDropdown() {
  const sel = document.getElementById('class-select');
  sel.innerHTML = '<option value="">— Select your class —</option>';
  allClasses.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name + (c.teacher && c.teacher !== 'Class Teacher' ? ' (' + c.teacher + ')' : '');
    sel.appendChild(opt);
  });
}

// ─── LOGIN ────────────────────────────────────────────────────
function switchRole(r) {
  currentRole = r;
  document.getElementById('teacher-fields').style.display = r === 'teacher' ? 'block' : 'none';
  document.getElementById('admin-fields').style.display   = r === 'admin'   ? 'block' : 'none';
  document.getElementById('tab-teacher').classList.toggle('active', r === 'teacher');
  document.getElementById('tab-admin').classList.toggle('active',   r === 'admin');
  document.getElementById('login-hint').textContent = r === 'admin'
    ? 'Admin credentials required.' : 'Each class has its own password set by the admin.';
  document.getElementById('login-error').style.display = 'none';
}

async function doLogin() {
  const btn = document.getElementById('login-btn');
  btn.disabled = true;
  document.getElementById('login-error').style.display = 'none';
  showLoading('Authenticating…');

  try {
    let result;
    if (currentRole === 'admin') {
      const u = document.getElementById('admin-username').value.trim();
      const p = document.getElementById('admin-password').value;
      result = await api({ action: 'adminLogin', username: u, password: p });
    } else {
      const classId = document.getElementById('class-select').value;
      const pass    = document.getElementById('class-password').value;
      if (!classId) { hideLoading(); showLoginError('Please select a class.'); btn.disabled=false; return; }
      if (!pass)    { hideLoading(); showLoginError('Please enter the class password.'); btn.disabled=false; return; }
      result = await api({ action: 'teacherLogin', classId, password: pass });
    }
    hideLoading();
    btn.disabled = false;
    if (!result.success) { showLoginError(result.message || 'Login failed.'); return; }
    currentUser = result;
    launchApp();
  } catch(e) {
    hideLoading(); btn.disabled = false;
    showLoginError('Connection error: ' + e.message);
  }
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg; el.style.display = 'block';
}

function logout() {
  currentUser = null; currentClass = null; students = []; attendanceData = {}; pendingChanges = {};
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('class-password').value = '';
  document.getElementById('admin-password').value = '';
  document.getElementById('login-error').style.display = 'none';
  switchRole('teacher');
  api({ action: 'getVisibleClasses' }).then(cls => { allClasses = cls; populateLoginDropdown(); }).catch(()=>{});
}

// ─── LAUNCH APP ───────────────────────────────────────────────
async function launchApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('user-name-display').textContent = currentUser.display;
  const rb = document.getElementById('role-badge-display');
  rb.textContent = currentUser.role === 'admin' ? 'ADMIN' : 'TEACHER';
  rb.className = 'role-badge ' + currentUser.role;
  document.getElementById('nav-admin').style.display = currentUser.role === 'admin' ? 'flex' : 'none';
  setSyncStatus(true);

  if (currentUser.role === 'admin') {
    showLoading('Loading admin data…');
    try {
      allClasses = await api({ action: 'getAllClasses' });
    } catch(e) { showToast('Error loading classes: ' + e.message, true); }
    buildSidebar(); buildStats(); buildAdminGrid(); buildStudentClassFilter(); populateReportClassSel();
    hideLoading(); showWelcome();
  } else {
    const cls = { id: currentUser.classId, name: currentUser.className,
                  teacher: currentUser.teacher, contact: currentUser.contact };
    allClasses = [cls];
    buildSidebar(); buildStats(); populateReportClassSel(); openClass(cls);
  }
}

function setSyncStatus(online) {
  document.getElementById('sync-dot').className = 'sync-dot' + (online ? '' : ' offline');
  document.getElementById('sync-label').textContent = online ? 'Live' : 'Offline';
}

// ─── SIDEBAR ─────────────────────────────────────────────────
function buildSidebar() {
  const list = document.getElementById('class-list');
  list.innerHTML = '';
  const visible = currentUser.role === 'admin' ? allClasses : allClasses.filter(c => c.visible !== false);
  visible.forEach(cls => {
    const d = document.createElement('div');
    d.className = 'class-item'; d.dataset.id = cls.id;
    d.innerHTML = `<div class="class-icon">${classInitial(cls.name)}</div><span>${cls.name}</span>`;
    d.onclick = () => openClass(cls, d);
    list.appendChild(d);
  });
}

function classInitial(n) {
  if (n.includes('Pre')) return 'PK';
  if (n.includes('LKG')) return 'LK';
  if (n.includes('UKG')) return n.includes('A') ? 'UA' : 'UB';
  const m = n.match(/(\w+)$/); return m ? m[1].slice(0,2).toUpperCase() : '??';
}

// ─── VIEWS ───────────────────────────────────────────────────
function hideAll() {
  ['welcome-view','admin-panel','class-view','report-view'].forEach(id =>
    document.getElementById(id).style.display = 'none');
  document.querySelectorAll('.class-item').forEach(i => i.classList.remove('active'));
}
function showWelcome(el) {
  hideAll();
  document.getElementById('welcome-view').style.display = 'block';
  document.getElementById('nav-dashboard').classList.add('active');
  buildQuickGrid();
}
function showAdminPanel(el) { hideAll(); document.getElementById('admin-panel').style.display='block'; if(el)el.classList.add('active'); }
function showReportView(el) {
  hideAll();
  document.getElementById('report-view').style.display = 'block';
  if(el) el.classList.add('active');
  const today = new Date(); const past = new Date(); past.setDate(today.getDate()-29);
  document.getElementById('report-end').value   = localDateStr(today);
  document.getElementById('report-start').value = localDateStr(past);
}

// ─── QUICK GRID ───────────────────────────────────────────────
function buildQuickGrid() {
  const qg = document.getElementById('quick-grid'); qg.innerHTML = '';
  const visible = currentUser.role === 'admin' ? allClasses : allClasses.filter(c => c.visible !== false);
  visible.forEach(cls => {
    const card = document.createElement('div'); card.className = 'quick-card';
    card.innerHTML = `<div class="quick-card-title">${cls.name}</div>
      <div class="quick-card-sub">${cls.teacher && cls.teacher !== 'Class Teacher' ? cls.teacher : 'Class Teacher'}</div>`;
    card.onclick = () => { const item = document.querySelector(`.class-item[data-id="${cls.id}"]`); openClass(cls, item); };
    qg.appendChild(card);
  });
}

// ─── OPEN CLASS ───────────────────────────────────────────────
function openClass(cls, el) {
  hideAll();
  if(el) el.classList.add('active');
  else { const item = document.querySelector(`.class-item[data-id="${cls.id}"]`); if(item) item.classList.add('active'); }
  currentClass = cls; pendingChanges = {};
  document.getElementById('cv-title').textContent    = cls.name;
  document.getElementById('cv-subtitle').textContent = (cls.teacher || 'Class Teacher') + (cls.contact ? ' • ' + cls.contact : '');
  document.getElementById('chip-class').textContent   = cls.name;
  document.getElementById('chip-teacher').textContent = cls.teacher || 'Class Teacher';
  document.getElementById('class-view').style.display = 'block';
  document.getElementById('start-date').value = localDateStr(new Date());
  document.getElementById('days-count').value = 5;
  loadSheet();
}

// ─── DATE HELPERS ─────────────────────────────────────────────
function localDateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function parseLocalDate(s) { const p = s.split('-'); return new Date(+p[0], +p[1]-1, +p[2]); }
function goToToday() { document.getElementById('start-date').value = localDateStr(new Date()); loadSheet(); }
function shiftDays(delta) {
  const v = document.getElementById('start-date').value; if(!v) return;
  const d = parseLocalDate(v); d.setDate(d.getDate()+delta);
  document.getElementById('start-date').value = localDateStr(d); loadSheet();
}

// ─── LOAD SHEET ───────────────────────────────────────────────
async function loadSheet() {
  if (!currentClass) return;
  const startVal = document.getElementById('start-date').value;
  const days = parseInt(document.getElementById('days-count').value) || 5;
  if (!startVal) return;
  const endD = parseLocalDate(startVal); endD.setDate(endD.getDate() + days - 1);
  const endDate = localDateStr(endD);
  document.getElementById('chip-dates').textContent = formatDate(parseLocalDate(startVal)) + ' → ' + formatDate(endD);
  showLoading('Loading from Server…');
  try {
    [students, attendanceData] = await Promise.all([
      api({ action: 'getStudents', classId: currentClass.id }),
      api({ action: 'getAttendance', classId: currentClass.id, startDate: startVal, endDate })
    ]);
    document.getElementById('chip-students').textContent = students.length + ' Students';
    setSyncStatus(true);
  } catch(e) {
    setSyncStatus(false);
    showToast('Error loading data: ' + e.message, true);
  }
  hideLoading();
  renderSheet(startVal, days);
}

// ─── RENDER SHEET ─────────────────────────────────────────────
function renderSheet(startDate, days) {
  const dates = [];
  const d = parseLocalDate(startDate);
  while (dates.length < days) { dates.push(new Date(d)); d.setDate(d.getDate()+1); }

  let headDate='', headFNAN='';
  dates.forEach(dt => {
    headDate += `<th colspan="2" style="background:rgba(0,180,216,0.15);color:#90e0ef;font-size:10.5px;padding:6px 3px;border:1px solid rgba(255,255,255,0.08)">${formatDate(dt)}</th>`;
    headFNAN += `<th>FN</th><th>AN</th>`;
  });

  const colTotals = {};
  dates.forEach(dt => ['FN','AN'].forEach(s => { colTotals[localDateStr(dt)+'|'+s] = {P:0,A:0,L:0}; }));

  let rows = '';
  if (!students.length) {
    rows = `<tr><td colspan="${3+dates.length*2}" style="text-align:center;padding:32px;color:var(--muted)">No students found.<br>Add students in Admin Panel → Student Roster.</td></tr>`;
  } else {
    students.forEach(s => {
      let cells = '';
      dates.forEach(dt => {
        const ds = localDateStr(dt);
        ['FN','AN'].forEach(session => {
          const key = ds+'|'+s.admNo+'|'+session;
          const status = pendingChanges[key] !== undefined ? pendingChanges[key] : (attendanceData[key]||'');
          if (status && colTotals[ds+'|'+session]) colTotals[ds+'|'+session][status]=(colTotals[ds+'|'+session][status]||0)+1;
          cells += `<td style="padding:3px;text-align:center">
            <button class="att-cell-btn ${status}" data-key="${key}" onclick="cycleStatus(this)">${status}</button></td>`;
        });
      });
      rows += `<tr><td class="sl-cell">${s.slNo}</td><td>${s.admNo||''}</td><td class="name-cell">${s.name||''}</td>${cells}</tr>`;
    });
  }

  let footP='', footA='', footL='';
  dates.forEach(dt => ['FN','AN'].forEach(ses => {
    const ct = colTotals[localDateStr(dt)+'|'+ses]||{P:0,A:0,L:0};
    footP += `<td style="color:var(--success)">${ct.P||'—'}</td>`;
    footA += `<td style="color:var(--danger)">${ct.A||'—'}</td>`;
    footL += `<td style="color:var(--warn)">${ct.L||'—'}</td>`;
  }));

  document.getElementById('sheet-output').innerHTML = `
  <table class="att-table">
    <thead>
      <tr><th class="school-head" colspan="${3+dates.length*2}">
        NUSRATH SECONDARY SCHOOL RANDATHANI<br>
        <span style="font-size:12px;font-weight:500">${currentClass.name} — Attendance Register 2026–27</span>
      </th></tr>
      <tr class="info-row"><th colspan="${3+dates.length*2}">
        Class Teacher: <strong>${currentClass.teacher||'—'}</strong>
        ${currentClass.contact?'&nbsp;&nbsp;|&nbsp;&nbsp;Contact: <strong>'+currentClass.contact+'</strong>':''}
      </th></tr>
      <tr class="col-head">
        <th style="width:40px">Sl.</th><th style="width:70px">Adm. No</th>
        <th style="min-width:155px;text-align:left;padding-left:10px">Full Name</th>${headDate}
      </tr>
      <tr class="col-head"><th></th><th></th><th></th>${headFNAN}</tr>
    </thead>
    <tbody>${rows}</tbody>
    ${students.length?`<tfoot>
      <tr><td class="foot-label" colspan="3">✅ Present</td>${footP}</tr>
      <tr><td class="foot-label" colspan="3">❌ Absent</td>${footA}</tr>
      <tr><td class="foot-label" colspan="3">📋 Leave</td>${footL}</tr>
    </tfoot>`:''}
  </table>`;
}

// ─── ATTENDANCE MARKING ───────────────────────────────────────
const CYCLE = {'':'P','P':'A','A':'L','L':''};
function cycleStatus(btn) {
  const key = btn.dataset.key;
  const next = CYCLE[btn.textContent.trim()] !== undefined ? CYCLE[btn.textContent.trim()] : 'P';
  btn.textContent = next; btn.className = 'att-cell-btn ' + next;
  pendingChanges[key] = next;
  document.getElementById('save-status').style.display = 'none';
}

function bulkMark(status) {
  const startVal = document.getElementById('start-date').value;
  if (!startVal || !students.length) return;
  students.forEach(s => ['FN','AN'].forEach(session => {
    const key = startVal+'|'+s.admNo+'|'+session;
    pendingChanges[key] = status;
    const btn = document.querySelector(`.att-cell-btn[data-key="${key}"]`);
    if(btn){ btn.textContent=status; btn.className='att-cell-btn '+status; }
  }));
  showToast(status ? '✅ Marked all as '+status : '✖ Cleared all for '+formatDate(parseLocalDate(startVal)));
}

async function saveAttendance() {
  const records = Object.entries(pendingChanges).map(([key,status]) => {
    const p=key.split('|'); return {date:p[0],admNo:p[1],session:p[2],status};
  });
  if (!records.length) { showToast('No changes to save.'); return; }
  showLoading('Saving to Server…');
  try {
    const result = await apiPost({ action:'saveAttendance', classId:currentClass.id, records });
    hideLoading();
    if (result.success) {
      Object.assign(attendanceData, pendingChanges); pendingChanges = {};
      document.getElementById('save-status').style.display = 'inline';
      showToast('✅ Saved '+result.saved+' records to Server!');
      setSyncStatus(true);
      setTimeout(() => document.getElementById('save-status').style.display='none', 4000);
    } else { showToast('❌ '+result.message, true); }
  } catch(e) { hideLoading(); setSyncStatus(false); showToast('Save error: '+e.message, true); }
}

// ─── REPORTS ─────────────────────────────────────────────────
function populateReportClassSel() {
  const sel = document.getElementById('report-class-sel');
  sel.innerHTML = '<option value="">— Select Class —</option>';
  allClasses.forEach(c => { const o=document.createElement('option'); o.value=c.id; o.textContent=c.name; sel.appendChild(o); });
}

async function generateReport() {
  const classId = document.getElementById('report-class-sel').value;
  const start   = document.getElementById('report-start').value;
  const end     = document.getElementById('report-end').value;
  const out     = document.getElementById('report-output');
  if (!classId) { out.innerHTML='<p style="color:var(--muted);text-align:center;padding:28px">Select a class first.</p>'; return; }
  if (!start||!end) { out.innerHTML='<p style="color:var(--muted);text-align:center;padding:28px">Select a date range.</p>'; return; }
  if (start>end) { showToast('Start must be before end date.',true); return; }

  showLoading('Fetching from Server…');
  try {
    const [studs, attData] = await Promise.all([
      api({ action:'getStudents', classId }),
      api({ action:'getAttendance', classId, startDate:start, endDate:end })
    ]);
    hideLoading();
    renderReport(classId, studs, attData, start, end);
  } catch(e) { hideLoading(); showToast('Error: '+e.message,true); }
}

function renderReport(classId, studs, attData, start, end) {
  const out = document.getElementById('report-output');
  const cls = allClasses.find(c=>c.id===classId)||{name:classId};
  if (!studs||!studs.length) { out.innerHTML='<p style="color:var(--muted);text-align:center;padding:32px">No students found.</p>'; return; }

  const dates=[], cur=parseLocalDate(start), endD=parseLocalDate(end);
  while(cur<=endD){ dates.push(localDateStr(cur)); cur.setDate(cur.getDate()+1); }
  const maxSessions = dates.length*2;

  const rows = studs.map(s => {
    let P=0,A=0,L=0,total=0;
    dates.forEach(dt => ['FN','AN'].forEach(ses => {
      const st=attData[dt+'|'+s.admNo+'|'+ses];
      if(st==='P'){P++;total++;} else if(st==='A'){A++;total++;} else if(st==='L'){L++;total++;}
    }));
    const pct=total>0?Math.round(P/total*100):null;
    const pctClass=pct===null?'':pct>=75?'pct-good':pct>=60?'pct-warn':'pct-bad';
    return {s,P,A,L,total,pct,pctClass};
  });

  const totalP=rows.reduce((a,r)=>a+r.P,0), totalA=rows.reduce((a,r)=>a+r.A,0), totalL=rows.reduce((a,r)=>a+r.L,0);
  let tableRows='';
  rows.forEach(({s,P,A,L,total,pct,pctClass}) => {
    tableRows+=`<tr>
      <td>${s.slNo}</td><td>${s.admNo||''}</td><td class="name-td">${s.name||''}</td>
      <td style="color:var(--success)">${P}</td><td style="color:var(--danger)">${A}</td><td style="color:var(--warn)">${L}</td>
      <td>${total}/${maxSessions}</td>
      <td style="min-width:90px">${pct!==null
        ?`<div class="pct-bar-wrap"><div class="pct-bar ${pctClass}" style="width:${pct}%"></div></div><div class="pct-text ${pctClass}">${pct}%</div>`
        :'<span style="color:var(--muted)">—</span>'}</td></tr>`;
  });

  out.innerHTML=`
    <div style="padding:14px 18px 10px;border-bottom:1px solid rgba(255,255,255,0.07)">
      <strong style="font-family:'Playfair Display',serif;font-size:15px">${cls.name} — Attendance Report</strong>
      <span style="font-size:12px;color:var(--muted);margin-left:12px">${formatDate(parseLocalDate(start))} to ${formatDate(parseLocalDate(end))} · ${dates.length} days · ${maxSessions} sessions/student</span>
    </div>
    <div style="padding:9px 18px;display:flex;gap:20px;flex-wrap:wrap;border-bottom:1px solid rgba(255,255,255,0.06)">
      <span style="font-size:12px;color:var(--success)">✅ Present: <strong>${totalP}</strong></span>
      <span style="font-size:12px;color:var(--danger)">❌ Absent: <strong>${totalA}</strong></span>
      <span style="font-size:12px;color:var(--warn)">📋 Leave: <strong>${totalL}</strong></span>
    </div>
    <div style="overflow-x:auto"><table class="report-table">
      <thead><tr><th style="width:44px">Sl.</th><th style="width:80px">Adm.</th>
        <th style="text-align:left">Name</th><th>Present</th><th>Absent</th><th>Leave</th><th>Marked</th><th style="min-width:100px">%</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table></div>`;
}

// ─── ADMIN: CLASSES ───────────────────────────────────────────
function buildAdminGrid() {
  const grid = document.getElementById('admin-grid'); grid.innerHTML=''; let visCount=0;
  allClasses.forEach(cls => {
    if(cls.visible!==false&&cls.visible!==0) visCount++;
    const card=document.createElement('div'); card.className='admin-class-card'; card.dataset.id=cls.id;
    card.innerHTML=`
      <div class="card-header">
        <div style="display:flex;align-items:center;gap:11px">
          <div class="card-class-icon">${classInitial(cls.name)}</div>
          <div><div class="card-name">${cls.name}</div>
          <div class="card-teacher-text" id="ct-${cls.id}">${cls.teacher||'Class Teacher'}</div></div>
        </div>
        <label class="toggle-switch">
          <div class="toggle-sw">
            <input type="checkbox" id="vis-${cls.id}" ${cls.visible!==false&&cls.visible!==0?'checked':''} onchange="updateVisCount()">
            <div class="toggle-track"></div>
          </div><span class="toggle-label">Visible</span>
        </label>
      </div>
      <div class="card-fields">
        <div class="card-field"><label>Class Password</label>
          <input type="text" id="pw-${cls.id}" value="${cls.password||''}" placeholder="Set password…"></div>
        <div class="card-field"><label>Class Teacher</label>
          <input type="text" id="teacher-${cls.id}" value="${cls.teacher||''}" placeholder="Teacher name"
            onchange="document.getElementById('ct-${cls.id}').textContent=this.value||'Class Teacher'"></div>
        <div class="card-field"><label>Contact</label>
          <input type="text" id="contact-${cls.id}" value="${cls.contact||''}" placeholder="Phone number"></div>
      </div>`;
    grid.appendChild(card);
  });
  document.getElementById('visible-count').textContent = visCount+' of '+allClasses.length+' classes visible to teachers';
}

function updateVisCount() {
  let v=0; allClasses.forEach(c=>{ if(document.getElementById('vis-'+c.id)?.checked) v++; });
  document.getElementById('visible-count').textContent = v+' of '+allClasses.length+' classes visible to teachers';
}
function setAllVisible(val) {
  allClasses.forEach(c=>{ const el=document.getElementById('vis-'+c.id); if(el) el.checked=val; }); updateVisCount();
}

async function saveAllConfig() {
  const updated = allClasses.map(c => ({
    id:c.id, name:c.name,
    password: document.getElementById('pw-'+c.id)?.value      || c.password ||'',
    teacher:  document.getElementById('teacher-'+c.id)?.value || c.teacher  ||'',
    contact:  document.getElementById('contact-'+c.id)?.value || c.contact  ||'',
    visible:  document.getElementById('vis-'+c.id)?.checked!==false,
  }));
  showLoading('Saving to Server…');
  try {
    const r = await apiPost({ action:'saveClassConfig', classes:updated });
    hideLoading();
    if(r.success){ allClasses=updated; buildSidebar(); showToast('✅ Configuration saved to Server!'); }
    else showToast('❌ '+r.message, true);
  } catch(e){ hideLoading(); showToast('Error: '+e.message, true); }
}

// ─── ADMIN: STUDENTS ──────────────────────────────────────────
function switchAdminTab(tab,btn) {
  document.querySelectorAll('.admin-tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.admin-section').forEach(s=>s.classList.remove('active'));
  btn.classList.add('active'); document.getElementById('tab-'+tab).classList.add('active');
}

function buildStudentClassFilter() {
  const sel=document.getElementById('student-class-filter');
  sel.innerHTML='<option value="">— Select a class —</option>';
  allClasses.forEach(c=>{ const o=document.createElement('option'); o.value=c.id; o.textContent=c.name; sel.appendChild(o); });
}

async function loadStudentEditor() {
  const classId=document.getElementById('student-class-filter').value;
  if(!classId){ document.getElementById('student-tbody').innerHTML=''; return; }
  showLoading('Loading students…');
  try {
    const studs = await api({ action:'getStudents', classId });
    hideLoading(); renderStudentEditor(classId, studs);
  } catch(e){ hideLoading(); showToast('Error: '+e.message,true); }
}

function renderStudentEditor(classId,studs) {
  const tbody=document.getElementById('student-tbody'); tbody.innerHTML='';
  const rows=studs&&studs.length?studs:Array.from({length:5},(_,i)=>({slNo:i+1,admNo:'',name:''}));
  rows.forEach(s=>addStudentRowData(s));
}
function addStudentRow() {
  const tbody=document.getElementById('student-tbody');
  const last=tbody.querySelector('tr:last-child');
  const lastSl=last?parseInt(last.querySelector('input[data-col=sl]').value)||0:0;
  addStudentRowData({slNo:lastSl+1,admNo:'',name:''});
}
function addStudentRowData(s) {
  const tbody=document.getElementById('student-tbody'); const tr=document.createElement('tr');
  tr.innerHTML=`<td><input type="number" data-col="sl" value="${s.slNo}" style="width:48px"></td>
    <td><input type="text" data-col="adm" value="${s.admNo||''}"></td>
    <td><input type="text" data-col="name" value="${s.name||''}"></td>
    <td><button onclick="this.closest('tr').remove()"
      style="background:rgba(230,57,70,0.15);border:none;color:var(--danger);padding:4px 9px;border-radius:6px;cursor:pointer;font-size:13px">✕</button></td>`;
  tbody.appendChild(tr);
}

async function saveStudentRoster() {
  const classId=document.getElementById('student-class-filter').value;
  if(!classId){ showToast('Select a class first.',true); return; }
  const rows=document.querySelectorAll('#student-tbody tr');
  const arr=[];
  rows.forEach(row=>{
    const sl=parseInt(row.querySelector('[data-col=sl]').value)||0;
    const adm=row.querySelector('[data-col=adm]').value.trim();
    const name=row.querySelector('[data-col=name]').value.trim();
    if(name||adm) arr.push({classId,slNo:sl,admNo:adm,name});
  });
  showLoading('Saving roster to Server…');
  try {
    const r=await apiPost({action:'saveStudents',students:arr});
    hideLoading();
    showToast(r.success?'✅ Roster saved! '+arr.length+' students.':'❌ '+r.message, !r.success);
  } catch(e){ hideLoading(); showToast('Error: '+e.message,true); }
}

// ─── STATS ────────────────────────────────────────────────────
function buildStats() {
  const isAdmin=currentUser.role==='admin';
  const visible=isAdmin?allClasses:allClasses.filter(c=>c.visible!==false);
  document.getElementById('stats-row').innerHTML=`
    <div class="stat-card"><div class="stat-num">${visible.length}</div><div class="stat-lbl">Classes</div></div>
    <div class="stat-card"><div class="stat-num">2026–27</div><div class="stat-lbl">Academic Year</div></div>
    ${isAdmin?'<div class="stat-card"><div class="stat-num">'+allClasses.filter(c=>c.visible!==false).length+'</div><div class="stat-lbl">Teacher Access</div></div>':''}`;
  document.getElementById('welcome-sub').textContent = isAdmin
    ? 'All data syncs live to Server. Click any class to mark attendance.'
    : 'Click your class to mark attendance. All data saves to Server in real time.';
}

// ─── UTILS ───────────────────────────────────────────────────
function formatDate(dt) { return dt.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}); }
function showLoading(msg) { document.getElementById('loading-text').textContent=msg||'Loading…'; document.getElementById('loading-overlay').style.display='flex'; }
function hideLoading() { document.getElementById('loading-overlay').style.display='none'; }
function showToast(msg,isError) {
  const t=document.getElementById('toast'); t.textContent=msg;
  t.className='toast'+(isError?' error':''); t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),3500);
}
function showError(msg){ showToast(msg,true); }
