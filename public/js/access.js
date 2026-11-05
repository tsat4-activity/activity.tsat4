// Access in one place (ผู้ใช้กำหนด 2026-11-04). Each activity (5S · CFO · SMF) has its own team of the year, so one person may
// be ผู้ดูแล of SMF, ผู้ตรวจ of 5S and ผู้ชม of CFO at once. Four levels with the same names everywhere (server people.js):
// ผู้ดูแล · กรรมการ · ผู้ปฏิบัติ · ผู้ชม. Here: the sidebar shows only the pages one may open + the level of each activity,
// สิทธิ์ของฉัน (user menu), and Setting > สิทธิ์ผู้ใช้ for the creator (every person × activity of a year, roles + sign-in).
const ACCESS_LEVELS = {
  admin: ['ผู้ดูแล', 'Dashboard · Transaction · Setting'],
  committee: ['กรรมการ', 'Dashboard · Transaction (ดูทั้งหมด / ยืนยัน)'],
  operator: ['ผู้ปฏิบัติ', 'Dashboard · Transaction (เฉพาะขอบเขตของตัวเอง)'],
  viewer: ['ผู้ชม', 'Dashboard · Transaction (ดูอย่างเดียว)'],
  none: ['', 'Dashboard']
};
let myAccess = null;

// one role as text: บทบาท + where (5S team / SMF project / audit group / department)
function accessRoleText(activity, r, unitNames = {}) {
  const unit = r.unit ? (A5_UNITS_OF[activity]?.[r.unit] || unitNames[r.unit] || r.unit) : '';
  const label = actRoleLabel(activity, r.role, r.unit);
  return [label, r.team ? `กลุ่ม ${r.team}` : '', unit, r.role === 'member' && !r.unit ? r.department : ''].filter(Boolean).join(' · ');
}

// sidebar: the level next to each activity · Setting only for its ผู้ดูแล (and the creator) · next year's ผู้ดูแล prepares the
// year ahead (December: team, plan, announcement), so that year counts for Setting, and shows as the level until the year starts
async function accessNav() {
  const year = new Date().getFullYear();
  let next;
  try {
    [myAccess, next] = await Promise.all([api(`/api/access?year=${year}`), api(`/api/access?year=${year + 1}`)]);
  } catch { return; }
  const nextOf = new Map(next.activities.map((a) => [a.id, a]));
  for (const a of myAccess.activities) {
    const later = nextOf.get(a.id);
    const acc = document.querySelector(`[data-nav-acc="${a.id}"]`);
    if (!acc) continue;
    const parent = acc.querySelector('.nav-parent');
    parent.querySelector('.nav-level')?.remove();
    const shown = a.level === 'none' || (later?.level === 'admin' && a.level !== 'admin') ? later || a : a;
    const label = ACCESS_LEVELS[shown.level]?.[0];
    if (label && !me.creator) parent.insertAdjacentHTML('beforeend', `<span class="nav-level nav-level-${shown.level}" title="${shown === a ? `ปี ${year}` : `ปี ${year + 1}`}">${esc(shown === a ? label : `${label} ${year + 1}`)}</span>`);
    acc.querySelector(`.nav-btn[data-view="${a.id}-setting"]`)?.classList.toggle('d-none', !me.creator && a.level !== 'admin' && later?.level !== 'admin');
  }
}

// user menu > สิทธิ์ของฉัน: what this account may do in each activity this year
async function accessMine() {
  const year = new Date().getFullYear();
  const d = await api(`/api/access?year=${year}`);
  const units = await aplUnitsOf('smf').catch(() => ({}));
  const sys = me.founder ? 'ผู้สร้างระบบ' : me.creator ? 'ผู้ดูแลระบบ' : me.executive ? 'ผู้บริหาร (ดูได้ทุกกิจกรรม)' : '';
  openPopup(`สิทธิ์ของฉัน ปี ${year}`, `
    ${sys ? `<p class="sum-meta">สิทธิ์ทั้งระบบ: <b>${esc(sys)}</b></p>` : ''}
    <div class="table-wrap"><table class="mo-data-table"><thead><tr><th>กิจกรรม</th><th>ระดับ</th><th>บทบาท</th><th>เข้าได้</th></tr></thead>
    <tbody>${d.activities.map((a) => `<tr><td><b>${esc(ACTIVITIES.find(([id]) => id === a.id)?.[1] || a.id)}</b></td>
      <td>${a.level === 'none' ? '<span class="sum-meta">-</span>' : `<span class="nav-level nav-level-${a.level}">${esc(ACCESS_LEVELS[a.level][0])}</span>`}</td>
      <td>${a.roles.map((r) => esc(accessRoleText(a.id, r, a.id === 'smf' ? units : {}))).join('<br>') || '<span class="sum-meta">ไม่มีบทบาท</span>'}</td>
      <td>${esc(ACCESS_LEVELS[a.level][1])}</td></tr>`).join('')}</tbody></table></div>
    <p class="sum-meta">บทบาทกำหนดรายปี: ผู้ดูแลระบบแต่งตั้งผู้ดูแลแต่ละกิจกรรม ผู้ดูแลเพิ่มสมาชิกของตัวเอง · เป็นทีมของกิจกรรมใดก็ได้ = ดูกิจกรรมอื่นได้</p>`, null);
  $('popup-save')?.classList.add('d-none');
  document.querySelector('#popup .popup')?.classList.add('popup-wide');
}

// Setting > สิทธิ์ผู้ใช้ (creator): everyone with a role in a year, one column per activity · search to add a first role
const accessView = { q: '' };
async function accessPeople(target) {
  if (!me.creator) { openView('main'); return; }
  const now = new Date().getFullYear();
  target.innerHTML = `<div class="view-body"><section class="card">
    <div class="toolbar a5-filters">
      ${field('ปี', `<select id="acc-year">${options([now - 1, now, now + 1].map(String), String(a5Year))}</select>`)}
      ${searchSlot('ค้นหาพนักงาน', 'acc-q', 'acc-search', { placeholder: 'รหัส หรือชื่อ (เพื่อเพิ่มบทบาทให้คนใหม่)' })}
      <div class="action-bar">${button('acc-roles', 'บทบาท / เพิ่มบทบาท', 'primary', 'disabled')}${button('acc-login', 'รหัสเข้าระบบ', 'secondary', 'disabled')}</div>
    </div>
    <div class="table-wrap sheet" id="acc-rows"><div class="empty">กำลังโหลด...</div></div>
    <p class="sum-meta" id="acc-note"></p>
  </section></div>`;
  const rerender = () => accessPeople(target).catch(onErr);
  $('acc-year').onchange = () => { a5Year = Number($('acc-year').value); rerender(); };
  $('acc-q').value = accessView.q;
  let latest = 0;
  // searching reloads the table only, so the box keeps its focus · an older answer must not replace a newer one
  const load = async () => {
    const ask = (latest += 1);
    const [d, units] = await Promise.all([api(`/api/access/people?year=${a5Year}&q=${encodeURIComponent(accessView.q)}`), aplUnitsOf('smf').catch(() => ({}))]);
    if (ask !== latest) return;
    ['acc-roles', 'acc-login'].forEach((b) => { $(b).disabled = true; });
    const label = (id) => ACTIVITIES.find(([x]) => x === id)?.[1] || id;
    const chips = (p, id) => p.roles[id].map((r) => `<span class="acc-chip${r.status === 'Active' ? '' : ' is-muted'}">${esc(accessRoleText(id, r, id === 'smf' ? units : {}))}</span>`).join(' ');
    fillTable('acc-rows', ['รหัส', 'ชื่อ', 'หน่วยงาน', ...ACTIVITIES.map(([, l]) => l), 'บัญชีเข้าระบบ'], d.people.map((p) => `<tr data-pick="${esc(p.employeeId)}"><td>${esc(p.employeeId)}</td><td>${esc(p.name)}${p.system ? ` <span class="sum-meta">(${p.system === 'creator' ? 'ผู้ดูแลระบบ' : p.system === 'executive' ? 'ผู้บริหาร' : 'ผู้ดูแลระบบบางส่วน'})</span>` : ''}</td><td>${esc(p.department)}</td>
      ${ACTIVITIES.map(([id]) => `<td>${chips(p, id)}</td>`).join('')}<td>${A5_LOGIN[p.login] || ''}</td></tr>`).join(''), `ไม่มีรายชื่อปี ${a5Year}`);
    $('acc-note').textContent = `ปี ${a5Year} · ${d.people.filter((p) => Object.values(p.roles).some((l) => l.length)).length} คนที่มีบทบาท · เลือกแถวแล้วกด บทบาท เพื่อเพิ่ม แก้ หรือลบ`;
    a5Lift(target.querySelector('section'));
    let picked = null;
    bindRowSelect($('acc-rows'), (id) => {
      picked = d.people.find((p) => p.employeeId === id);
      $('acc-roles').disabled = !picked;
      $('acc-login').disabled = !picked || !Object.values(picked.roles).some((l) => l.length);
    });
    const rowOf = (id, r) => ({ ...r, area_id: r.areaId, employee_id: picked.employeeId, name: picked.name, login: picked.login, activity: id });
    // every role of the person (edit / delete) + add one in any activity, with the form of Setting > Team
    $('acc-roles').onclick = () => {
      if (!picked) return;
      const list = ACTIVITIES.flatMap(([id]) => picked.roles[id].map((r) => [id, r]));
      openPopup(`${esc(picked.employeeId)} ${esc(picked.name)} · ปี ${a5Year}`, `
        <div class="table-wrap"><table class="mo-data-table"><thead><tr><th>กิจกรรม</th><th>บทบาท</th><th>สถานะ</th><th></th></tr></thead>
        <tbody>${list.map(([id, r], i) => `<tr><td>${esc(label(id))}</td><td>${esc(accessRoleText(id, r, id === 'smf' ? units : {}))}</td><td>${esc(r.status)}</td>
          <td><button class="apl-link" type="button" data-acc-edit="${i}">แก้ไข</button> · <button class="apl-link" type="button" data-acc-del="${i}">ลบ</button></td></tr>`).join('') || '<tr><td colspan="4" class="empty">ยังไม่มีบทบาทปีนี้</td></tr>'}</tbody></table></div>
        ${field('เพิ่มบทบาทในกิจกรรม', `<select id="acc-add-act">${options(ACTIVITIES.map(([id]) => id), ACTIVITIES[0][0], label)}</select>`)}`, async () => {
        const spec = await a5TeamSpec($('acc-add-act').value);
        a5TeamForm({ ...spec, rerender }, null, { employeeId: picked.employeeId, name: picked.name, department: picked.department });
      }, 'เพิ่มบทบาท');
      document.querySelector('#popup .popup')?.classList.add('popup-wide');
      document.querySelectorAll('[data-acc-edit]').forEach((node) => {
        node.onclick = async () => {
          const [id, r] = list[Number(node.dataset.accEdit)];
          a5TeamForm({ ...(await a5TeamSpec(id)), rerender }, rowOf(id, r));
        };
      });
      document.querySelectorAll('[data-acc-del]').forEach((node) => {
        node.onclick = () => {
          const [id, r] = list[Number(node.dataset.accDel)];
          confirmPopup('ลบบทบาท', `ลบ ${esc(label(id))} · ${esc(accessRoleText(id, r, id === 'smf' ? units : {}))} ของ ${esc(picked.name)} ปี ${a5Year}`, async () => {
            await a5Api(id, `team/${r.id}`, { method: 'DELETE' });
            toast('ลบแล้ว');
            rerender();
          });
        };
      });
    };
    // sign-in: through any team row of the person this year (the account is one for every activity)
    $('acc-login').onclick = () => {
      const first = picked && ACTIVITIES.map(([id]) => [id, picked.roles[id].find((r) => r.status === 'Active')]).find(([, r]) => r);
      if (first) a5LoginPopup(first[0], rowOf(first[0], first[1]), rerender);
    };
  };
  const search = () => { accessView.q = $('acc-q').value.trim(); load().catch(onErr); };
  $('acc-search').onclick = search;
  onEnter('acc-q', search);
  await load();
}

Object.assign(VIEWS, { access: accessPeople });
TITLES.access = ['สิทธิ์ผู้ใช้', 'ระบบตั้งค่า > สิทธิ์ผู้ใช้'];
