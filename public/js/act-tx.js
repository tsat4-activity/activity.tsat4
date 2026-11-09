// ระบบกิจกรรม > <activity> > transaction: audit list + Self / Committee audit form, and Issues.
// Server: server/modules/act/transaction.js · rules: docs/specs/act-5s.md · uses helpers from act-5s.js (a5Api, a5Seg, a5Year ...).
const ATX_TABS = { audits: 'Audit', issues: 'Issue' };
const ATX_TYPES = { SELF: 'Self Audit', COMMITTEE: 'Committee Audit' };
const ATX_STATUS = {
  OPEN: ['เปิด รอแก้', 'badge-warning'],
  ON_PLAN: ['แก้แล้ว ตามกำหนด', 'badge-primary'],
  WAIT_VERIFY: ['แก้แล้ว เลยกำหนด', 'badge-primary'],
  OVERDUE: ['เลยกำหนด', 'badge-danger'],
  CLOSED: ['ปิดแล้ว', 'badge-success']
};
let atxTab = 'audits';
let atxIssueAll = false;

function atxBadge(status) {
  const [label, kind] = ATX_STATUS[status] || [status, ''];
  return `<span class="badge ${kind}">${esc(label)}</span>`;
}

function atxDate(iso) {
  if (!iso) return '-';
  const d = actDate(String(iso).slice(0, 10));
  return `${d.getDate()} ${ACT_MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

// Problem / after photos: center crop to 16:9, 1280x720 JPEG capped at ~250 KB.
function atxWideJpeg(file) {
  return cropJpeg(file, 1280, 720, 250000);
}

// File input + 16:9 preview; onPick(dataUrl).
function atxPhotoInput(id, onPick) {
  const input = $(id);
  if (!input) return;
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const data = await atxWideJpeg(file);
      const preview = $(`${id}-preview`);
      if (preview) { preview.src = data; preview.classList.remove('d-none'); }
      onPick(data);
    } catch (err) { onErr(err); }
  };
}

async function atxPage(target, activity) {
  const me = await a5Api(activity, `me?year=${a5Year}`);
  target.innerHTML = viewShellPageBar(
    a5Pick('data-atx', ATX_TABS, atxTab),
    `<div class="a5-year">${a5YearSelect(me.years)}</div>`,
    '',
    'a5',
    { mainId: 'atx-body' },
  );
  const rerender = () => atxPage(target, activity).catch(onErr);
  target.querySelectorAll('[data-atx]').forEach((node) => { node.onclick = () => { atxTab = node.dataset.atx; rerender(); }; });
  $('a5-year').onchange = () => { a5Year = Number($('a5-year').value); rerender(); };
  const body = $('atx-body');
  // members of any activity that year may read the others (ผู้ใช้กำหนด 2026-11-04) · writing stays with this activity's team
  if (!me.access.member && !me.access.viewer) { body.innerHTML = `<p class="empty">เข้าได้เฉพาะทีมของกิจกรรมปี ${a5Year} (ผู้ดูแลเพิ่มรายชื่อที่ Setting > Team)</p>`; return; }
  if (atxTab === 'issues') return atxIssues(body, activity);
  return atxAudits(body, activity, me);
}

// ---------- audits ----------

// Audit list like the old TSAT4-5S page: filters, open / edit / delete, double click for details.
const atxFilter = { quarter: '', type: '', areaType: '', area: '', q: '' };
const ATX_QUARTERS = { '': 'ทั้งปี', 1: 'Q1 (ม.ค.–มี.ค.)', 2: 'Q2 (เม.ย.–มิ.ย.)', 3: 'Q3 (ก.ค.–ก.ย.)', 4: 'Q4 (ต.ค.–ธ.ค.)' };

const atxHeads = { audits: { sort: '', dir: 'asc', filters: {} }, issues: { sort: '', dir: 'asc', filters: {} } };

async function atxAudits(body, activity, me) {
  const data = await a5Api(activity, `audits?year=${a5Year}`);
  const canAudit = me.access.admin || me.access.chairman || me.access.auditor || me.access.ownerAreaIds.length > 0;
  const areas = [...new Map([...(data.areas || []), ...data.audits].map((a) => [a.area_id, a])).values()].sort((x, y) => String(x.areaCode).localeCompare(String(y.areaCode)));
  body.innerHTML = `
    <div class="toolbar a5-filters">
      ${field('ไตรมาส', `<select id="atx-f-quarter">${options(Object.keys(ATX_QUARTERS), atxFilter.quarter, (k) => ATX_QUARTERS[k])}</select>`)}
      ${field('ประเภท', `<select id="atx-f-type">${options(['', 'SELF', 'COMMITTEE'], atxFilter.type, (v) => (v ? ATX_TYPES[v] : 'ทั้งหมด'))}</select>`)}
      ${field('ประเภทพื้นที่', `<select id="atx-f-atype">${options(['', ...A5_AREA_TYPES], atxFilter.areaType, (v) => v || 'ทั้งหมด')}</select>`)}
      ${field('พื้นที่', `<select id="atx-f-area"><option value="">ทั้งหมด</option>${areas.filter((a) => !atxFilter.areaType || a.areaType === atxFilter.areaType).map((a) => `<option value="${a.area_id}"${String(a.area_id) === String(atxFilter.area) ? ' selected' : ''}>${esc(a.areaCode)} ${esc(a.areaName)}</option>`).join('')}</select>`)}
      ${searchSlot('ค้นหา', 'atx-f-q', 'atx-f-search', { placeholder: 'Audit ID หรือชื่อพื้นที่' })}
      <div class="action-bar">${canAudit ? button('atx-new', 'เพิ่ม', 'primary') : ''}${button('atx-edit', 'แก้ไข', 'secondary', 'disabled')}${data.canDelete ? button('atx-del', 'ลบ', 'danger', 'disabled') : ''}</div>
    </div>
    <div class="table-wrap sheet" id="atx-rows"></div>
    <p class="sum-meta" id="atx-count"></p>`;
  $('atx-f-q').value = atxFilter.q;
  let picked = null;
  const draw = () => {
    const term = atxFilter.q.trim().toLowerCase();
    const rows = listQuery(data.audits.filter((a) => {
      const month = actDate(String(a.audited_at).slice(0, 10)).getMonth() + 1;
      return (!atxFilter.quarter || Math.ceil(month / 3) === Number(atxFilter.quarter))
        && (!atxFilter.type || a.audit_type === atxFilter.type)
        && (!atxFilter.areaType || a.areaType === atxFilter.areaType)
        && (!atxFilter.area || String(a.area_id) === String(atxFilter.area))
        && (!term || `${a.audit_no} ${a.areaCode} ${a.areaName}`.toLowerCase().includes(term));
    }), atxHeads.audits, (a, key) => (key === 'audited_at' ? String(a.audited_at).slice(0, 10) : a[key] ?? ''));
    fillTable('atx-rows', [{ label: 'วันที่', key: 'audited_at' }, { label: 'Audit ID', key: 'audit_no' }, { label: 'ประเภท', key: 'audit_type' }, { label: 'ประเภทพื้นที่', key: 'areaType' }, { label: 'พื้นที่', key: 'areaName' }, { label: 'ทีม', key: 'team' }, { label: 'คะแนน', key: 'total_score' }, { label: '%', key: 'percent_score' }, { label: 'ผล', key: 'result' }, { label: 'สถานะ', key: 'status' }], rows.map((a) => `<tr data-pick="${a.id}">
      <td>${String(a.audited_at).slice(0, 10)}</td><td>${esc(a.audit_no)}</td>
      <td><span class="badge ${a.audit_type === 'COMMITTEE' ? 'badge-primary' : 'badge-warning'}">${esc(a.audit_type)}</span></td>
      <td>${esc(a.areaType || '')}</td><td>${esc(a.areaName || '')}</td>
      <td>${a.team ? `<span class="a5-dot is-done" style="--team:${a5TeamColor(a.team)}"></span> ${esc(a.team)}` : '-'}</td>
      <td>${Number(a.total_score)}</td><td>${Number(a.percent_score).toFixed(2)}%</td>
      <td><span class="badge ${a.result === 'PASS' ? '' : 'badge-danger'}">${esc(a.result || '-')}</span></td>
      <td><span class="badge ${a.status === 'COMPLETED' ? 'badge-success' : 'badge-warning'}">${esc(a.status)}</span>${a.openIssues ? ` <span class="sum-meta">Issue ค้าง ${a.openIssues}</span>` : ''}</td></tr>`).join(''), `ยังไม่มีใบตรวจปี ${a5Year}`, headFor(atxHeads.audits, () => draw()));
    setHeaderMeta(`ใบตรวจ ${rows.length} / ${data.audits.length} ใบ (${a5Year})`);
    $('atx-count').textContent = `แสดง ${rows.length} จาก ${data.audits.length} ใบตรวจ · เลือกแถวแล้วแก้ไขคะแนนหรือลบ · ดับเบิลคลิกดูรายละเอียด`;
    picked = null;
    $('atx-edit').disabled = true;
    if ($('atx-del')) $('atx-del').disabled = true;
    bindRowSelect($('atx-rows'), (id) => {
      picked = data.audits.find((a) => String(a.id) === id);
      $('atx-edit').disabled = !picked?.canEdit;
      if ($('atx-del')) $('atx-del').disabled = !picked;
    });
    $('atx-rows').querySelectorAll('tbody tr[data-pick]').forEach((row) => { row.ondblclick = () => atxAuditDetail(activity, Number(row.dataset.pick)).catch(onErr); });
  };
  const reload = () => atxAudits(body, activity, me).catch(onErr);
  $('atx-f-quarter').onchange = () => { atxFilter.quarter = $('atx-f-quarter').value; draw(); };
  $('atx-f-type').onchange = () => { atxFilter.type = $('atx-f-type').value; draw(); };
  $('atx-f-atype').onchange = () => { atxFilter.areaType = $('atx-f-atype').value; atxFilter.area = ''; reload(); };
  $('atx-f-area').onchange = () => { atxFilter.area = $('atx-f-area').value; draw(); };
  $('atx-f-search').onclick = () => { atxFilter.q = $('atx-f-q').value; draw(); };
  onEnter('atx-f-q', () => { atxFilter.q = $('atx-f-q').value; draw(); });
  a5Lift(body);
  if ($('atx-new')) $('atx-new').onclick = () => atxForm(activity, me, reload).catch(onErr);
  $('atx-edit').onclick = () => picked?.canEdit && atxForm(activity, me, reload, picked.id).catch(onErr);
  if ($('atx-del')) $('atx-del').onclick = () => picked && confirmPopup('ลบใบตรวจ', `ลบ ${esc(picked.audit_no)} และ Issue ที่เปิดจากใบนี้ (Issue เดิมที่ใบนี้ยืนยันไปแล้วจะไม่ย้อนกลับ)`, async () => {
    await a5Api(activity, `audits/${picked.id}`, { method: 'DELETE' });
    toast('ลบแล้ว');
    reload();
  });
  draw();
}

async function atxAuditDetail(activity, id) {
  const d = await a5Api(activity, `audits/${id}`);
  const a = d.audit;
  const groups = [...new Set(d.scores.map((s) => s.s_group))].sort((x, y) => x - y);
  const people = (kind) => d.people.filter((p) => p.kind === kind).map((p) => `${esc(p.employee_id)} ${esc(p.name)}`).join(', ') || '-';
  openPopup(`${esc(a.audit_no)}`, `<div class="plan-detail">
      <p class="sum-meta">${esc(ATX_TYPES[a.audit_type])} · ${esc(a.area?.code || '')} ${esc(a.area?.name || '')} · ${atxDate(a.audited_at)}${a.team ? ` · ทีม ${esc(a.team)}` : ''}</p>
      <p><strong>${Number(a.total_score)}</strong> คะแนน · <strong>${Number(a.percent_score).toFixed(2)}%</strong> · ${a.result === 'PASS' ? 'PASS' : 'ต้องปรับปรุง'}</p>
      <p class="sum-meta">ผู้ตรวจ: ${people('participated')} · ผู้รับตรวจ: ${people('receiver')}</p>
      ${groups.map((g) => `<div class="atx-detail-group"><strong>${esc(a5GroupName(activity, g))}</strong>${d.scores.filter((s) => s.s_group === g).map((s) => `<div class="atx-detail-row"><span>${s.item_no}. ${esc(s.title)}</span><span class="${Number(s.score) <= 3 ? 'atx-low' : ''}">${Number(s.score)}/${s.score_max}</span></div>`).join('')}</div>`).join('')}
      ${d.issues.length ? `<p><strong>Issue ${d.issues.length} รายการ</strong></p>${d.issues.map((i) => `<div class="atx-detail-row"><span>${esc(i.issue_no)} · ${esc(i.description)}</span>${atxBadge(i.status)}</div>`).join('')}` : ''}
    </div>`, () => closePopup(), 'ปิด');
}

// New audit, or edit one (editId): type and area are fixed when editing. Standard Stepper Wizard modal popup.
async function atxForm(activity, me, onDone, editId = 0) {
  const isCurYear = a5Year === new Date().getFullYear();
  const defaultDate = isCurYear ? actIso(new Date()) : `${a5Year}-01-15`;
  const state = { type: '', areaId: '', date: defaultDate, team: '', participated: new Set(), receivers: [], scores: {}, text: {}, photo: {}, editId, auditNo: '', ownItems: new Set() };
  let [form, d] = await Promise.all([
    a5Api(activity, `audit-form?year=${a5Year}`),
    editId ? a5Api(activity, `audits/${editId}`) : null
  ]);
  if (!editId && !form.types.length) throw new Error('คุณยังไม่มีสิทธิ์ทำการตรวจปีนี้');
  if (!form.items.length) throw new Error(`ยังไม่มีหัวข้อตรวจปี ${a5Year} (admin เพิ่มที่ Setting > หัวข้อตรวจ)`);
  state.type = form.types.includes('COMMITTEE') && !form.access.ownerAreaIds.length ? 'COMMITTEE' : form.types[0];
  state.team = form.access.teams[0] || form.teams[0]?.team || '';

  const areasFor = () => form.areas.filter((a) => state.editId || state.type === 'COMMITTEE' || a.self);
  const teamMembers = () => (form.teams.find((t) => t.team === state.team) || { members: [] }).members;
  const resetParticipants = () => { state.participated = new Set(teamMembers().map((m) => m.employeeId)); };
  resetParticipants();
  if (editId) {
    Object.assign(state, {
      type: d.audit.audit_type, areaId: String(d.audit.area_id), date: String(d.audit.audited_at).slice(0, 10), team: d.audit.team || '', auditNo: d.audit.audit_no,
      participated: new Set(d.people.filter((p) => p.kind === 'participated').map((p) => String(p.employee_id))),
      receivers: d.people.filter((p) => p.kind === 'receiver').map((p) => ({ employeeId: String(p.employee_id), name: p.name })),
      scores: Object.fromEntries(d.scores.filter((s) => Number(s.score) > 0).map((s) => [s.checklist_id, Number(s.score)])),
      ownItems: new Set(d.issues.map((i) => i.checklist_id))
    });
    if (!form.types.includes(state.type)) form.types = [state.type, ...form.types];
    if (state.type === 'COMMITTEE') form = { ...form, openIssues: (await a5Api(activity, `audit-form?year=${a5Year}&area=${state.areaId}&audit=${editId}`)).openIssues };
  }
  const openBy = () => new Map(form.openIssues.map((i) => [i.checklist_id, i]));
  const forcedZero = (issue) => issue && !(String(issue.action_description || '').trim() && issue.after_photos > 0);
  // a new audit: an Issue without Action locks its item at 0 · an audit being edited keeps the 0 it was saved with (as the server)
  const savedZero = new Set(editId ? d.scores.filter((s) => Number(s.score) === 0).map((s) => s.checklist_id) : []);
  const lockedItem = (id, open) => (editId ? savedZero.has(id) : Boolean(forcedZero(open.get(id))));

  const groups = [...new Set(form.items.map((i) => i.s_group))].sort((x, y) => x - y);
  const groupIcons = ['delete_sweep', 'grid_view', 'cleaning_services', 'health_and_safety', 'military_tech'];
  const STEPS = [
    { step: 1, label: 'ข้อมูลทั่วไป', icon: 'fact_check', group: 0 },
    ...groups.map((g, idx) => ({
      step: idx + 2,
      label: a5GroupName(activity, g),
      icon: groupIcons[idx] || 'checklist',
      group: g
    }))
  ];
  let step = 1;

  const title = state.editId ? `แก้ไขผลตรวจ ${esc(state.auditNo)}` : 'บันทึกผลตรวจ 5S';
  const saveLabel = state.editId ? 'บันทึกการแก้ไข' : 'บันทึกผลตรวจ';
  openPopup(title, '<div class="wfa-wizard-modal atx-modal" id="atx-wizard-container"></div>', async () => {
    await atxSave(activity, state, form, openBy(), onDone, groups, (newStep) => { step = newStep; draw(true); }, lockedItem);
  }, saveLabel);

  const popupEl = $('popup')?.querySelector('.popup');
  if (popupEl) {
    popupEl.style.width = 'min(620px, 95vw)';
  }
  const actionsEl = popupEl?.querySelector('.popup-actions');
  if (actionsEl && !$('atx-pop-summary')) {
    const sumEl = document.createElement('div');
    sumEl.id = 'atx-pop-summary';
    sumEl.className = 'atx-pop-summary';
    actionsEl.prepend(sumEl);
  }

  const draw = (resetScroll = false) => {
    const container = $('atx-wizard-container');
    if (!container) return;
    const open = state.type === 'COMMITTEE' ? openBy() : new Map();
    const scoreOf = (item) => (lockedItem(item.id, open) ? 0 : state.scores[item.id]);
    const max = form.items.reduce((s, i) => s + i.score_max, 0);
    const total = form.items.reduce((s, i) => s + (Number(scoreOf(i)) || 0), 0);
    const done = form.items.filter((i) => scoreOf(i) != null).length;
    const percent = max ? (total / max) * 100 : 0;
    const passMark = (state.type === 'SELF' ? form.settings.pass_self : form.settings.pass_committee) ?? form.settings.pass_percent; // as the server

    const sumEl = $('atx-pop-summary');
    if (sumEl) {
      sumEl.innerHTML = `ให้คะแนนแล้ว <strong>${done}/${form.items.length}</strong> · รวม <strong>${total}/${max}</strong> · <strong>${percent.toFixed(2)}%</strong> · <span class="badge ${percent >= passMark ? 'badge-success' : 'badge-danger'}">${percent >= passMark ? 'PASS' : 'ต้องปรับปรุง'}</span>`;
    }
    const saveBtn = $('popup-save');
    if (saveBtn) saveBtn.disabled = !state.areaId;

    const isStepDone = (sNum) => {
      if (sNum === 1) return Boolean(state.areaId && (state.type !== 'COMMITTEE' || state.participated.size > 0));
      const grpObj = STEPS.find((s) => s.step === sNum);
      if (!grpObj || !grpObj.group) return false;
      const gItems = form.items.filter((i) => i.s_group === grpObj.group);
      return gItems.length > 0 && gItems.every((i) => lockedItem(i.id, open) || state.scores[i.id] != null);
    };

    const stepperHtml = `
      <div class="wfa-stepper">
        ${STEPS.map((s) => {
          const isDone = isStepDone(s.step);
          const isCur = s.step === step;
          const cls = isCur ? 'is-current' : isDone ? 'is-done' : '';
          return `
            <div class="wfa-step-item ${cls}" data-atx-step="${s.step}" title="ไปยังขั้นตอนที่ ${s.step}: ${s.label}">
              <div class="wfa-step-circle">
                <span class="material-symbols-rounded">${s.icon}</span>
              </div>
              <div class="wfa-step-lbl">${s.label}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    const itemRow = (item) => {
      const issue = open.get(item.id);
      const locked = lockedItem(item.id, open);
      const value = scoreOf(item);
      const isScored = value != null;
      const isLow = value != null && value <= form.settings.issue_score;
      const needIssue = state.type === 'COMMITTEE' && !issue && !state.ownItems.has(item.id) && isLow;
      return `<div class="atx-item${isScored ? (isLow ? ' is-low' : ' is-good') : ''}">
        <div class="atx-item-header">
          <div class="atx-item-title">
            <span class="atx-no-pill">${item.item_no}</span>
            <div style="flex:1 1 auto;min-width:0;text-align:left">
              <span class="atx-title-text">${esc(actNoLead(item.title))}</span>
              ${issue ? `<div class="atx-carry">
                Issue เดิม <strong>${esc(issue.issue_no)}</strong>: ${esc(issue.description)} · ${locked ? '<b style="color:var(--mo-danger)">ยังไม่มี Action → ข้อนี้ได้ 0 คะแนน</b>' : '<span style="color:var(--mo-success)">มี Action แล้ว ให้คะแนน ≥ 4 เพื่อปิด Issue</span>'}
              </div>` : ''}
            </div>
          </div>
          <div class="atx-scores">
            ${locked ? '<span class="atx-zero">0</span>' : Array.from({ length: item.score_max }, (_, i) => i + 1).map((n) => `
              <button type="button" class="atx-score${value === n ? ' is-on' : ''}${n <= form.settings.issue_score ? ' is-low-btn' : ''}" data-score="${item.id}:${n}">${n}</button>
            `).join('')}
          </div>
        </div>

        ${needIssue ? `
          <div class="atx-issue">
            <div class="atx-issue-head">
              <span class="material-symbols-rounded" style="font-size:16px">warning</span>
              <span>ได้คะแนน ${value} (≤ ${form.settings.issue_score}) กรุณาระบุรายละเอียดปัญหาและแนบรูปภาพ</span>
            </div>
            ${field(`รายละเอียดปัญหา (ข้อที่ ${item.item_no})`, `<textarea id="atx-text-${item.id}" rows="2" maxlength="2000" placeholder="ระบุสิ่งที่พบเห็น ปัญหา หรือจุดที่ไม่เป็นไปตามมาตรฐาน..." data-text="${item.id}">${esc(state.text[item.id] || '')}</textarea>`, 'required')}
            ${field('รูปปัญหา (อัตราส่วน 16:9)', `<input id="atx-photo-${item.id}" type="file" accept="image/*"><img id="atx-photo-${item.id}-preview" class="atx-photo${state.photo[item.id] ? '' : ' d-none'}" src="${state.photo[item.id] || ''}" alt="" style="max-height:180px;width:auto;object-fit:cover;border-radius:6px;margin-top:6px">`, 'required')}
          </div>
        ` : ''}
      </div>`;
    };

    let contentHtml = '';
    let currentGroupItems = [];
    const curStepObj = STEPS.find((s) => s.step === step);

    if (step === 1) {
      contentHtml = `
        <div class="wfa-step-section" style="width:100%">
          <div class="wfa-sec-badge">Section 01 · ข้อมูลทั่วไป</div>
          <h3 style="margin:4px 0 12px;font-size:16px;font-weight:700">ข้อมูลการตรวจประเมินและพื้นที่</h3>
          ${state.editId ? `<p class="atx-note">แก้ไข ${esc(state.auditNo)} · ประเภทและพื้นที่เปลี่ยนไม่ได้ · ข้อที่ Issue เดิมไม่มี Action ยังเป็น 0</p>` : ''}

          <div style="display:flex;flex-direction:column;gap:12px">
            <div class="field">
              <label>ประเภทการตรวจประเมิน</label>
              ${state.editId ? `<span class="badge badge-primary" style="display:inline-block;padding:6px 14px;font-size:12.5px">${esc(ATX_TYPES[state.type])}</span>` : a5Seg('data-atype', Object.fromEntries(form.types.map((t) => [t, ATX_TYPES[t]])), state.type)}
            </div>

            <div class="field">
              <label class="required">พื้นที่ตรวจประเมิน (Area)</label>
              <select id="atx-area"${state.editId ? ' disabled' : ''}>
                <option value="">-- เลือกพื้นที่เพื่อเริ่มทำการตรวจ --</option>
                ${areasFor().map((a) => `<option value="${a.id}"${String(a.id) === String(state.areaId) ? ' selected' : ''}>${esc(a.code)} ${esc(a.name)} (${esc(a.areaType || '')})</option>`).join('')}
              </select>
            </div>

            <div class="field">
              <label class="required">วันที่ตรวจประเมิน</label>
              <input id="atx-date" type="date" min="${a5Year}-01-01" max="${isCurYear ? actIso(new Date()) : `${a5Year}-12-31`}" value="${state.date}">
            </div>

            ${state.type === 'COMMITTEE' ? `
              <div class="field">
                <label class="required">ทีมตรวจประเมิน</label>
                <select id="atx-team">${options(form.teams.map((t) => t.team), state.team, (t) => `ทีม ${t}`)}</select>
              </div>
              <div class="field">
                <label>รายชื่อผู้ตรวจประเมินในทีม (ทำเครื่องหมายผู้ที่เข้าร่วมตรวจจริง)</label>
                <div class="wfa-member-grid">
                  ${teamMembers().map((m) => {
                    const isChecked = state.participated.has(m.employeeId);
                    return `
                      <label class="wfa-member-card ${isChecked ? 'is-selected' : ''}">
                        <input type="checkbox" data-part="${esc(m.employeeId)}"${isChecked ? ' checked' : ''}>
                        <span>${esc(m.name)} <small>(${esc(m.employeeId)})</small></span>
                      </label>
                    `;
                  }).join('') || '<span class="sum-meta">ทีมนี้ยังไม่มีรายชื่อผู้ตรวจ</span>'}
                </div>
              </div>
            ` : ''}

            <div class="field">
              <label>ผู้รับการตรวจ (ตัวแทนพื้นที่)</label>
              <div class="atx-recv-chips">
                ${state.receivers.map((p, i) => `
                  <span class="atx-chip">
                    ${esc(p.employeeId)} ${esc(p.name)}
                    <button type="button" data-unrecv="${i}" aria-label="เอาออก">×</button>
                  </span>
                `).join('') || '<span class="sum-meta">ยังไม่ได้ระบุผู้รับตรวจ (เลือกพื้นที่เพื่อดึงข้อมูลตัวแทนพื้นที่อัตโนมัติ)</span>'}
              </div>
            </div>

            ${state.type === 'COMMITTEE' && state.areaId && form.openIssues.length ? `
              <div class="atx-note" style="margin-top:6px;border-left:4px solid var(--mo-warning,#f59e0b);padding:10px 14px;border-radius:6px">
                <strong>⚠️ แจ้งเตือน Issue ค้างของพื้นที่:</strong>
                <p style="margin:4px 0 0;font-size:12.5px">พื้นที่นี้มี Issue ค้าง <strong>${form.openIssues.length} รายการ</strong> ซึ่งจะถูกตรวจสอบยืนยันในการตรวจครั้งนี้โดยอัตโนมัติ (หากไม่มี Action จะได้ 0 คะแนน · หากมี Action และให้คะแนน ≥ 4 จะเป็นการปิด Issue)</p>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    } else {
      const curGroup = curStepObj.group;
      currentGroupItems = form.items.filter((i) => i.s_group === curGroup);
      const groupDone = currentGroupItems.filter((i) => scoreOf(i) != null).length;
      const groupMax = currentGroupItems.reduce((s, i) => s + i.score_max, 0);
      const groupScore = currentGroupItems.reduce((s, i) => s + (Number(scoreOf(i)) || 0), 0);

      contentHtml = `
        <div class="wfa-step-section" style="width:100%">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
            <div class="wfa-sec-badge is-green">Section 0${step} · ${esc(a5GroupName(activity, curGroup))}</div>
            <div class="sum-meta" style="font-size:12.5px">
              ให้คะแนนแล้ว <strong>${groupDone}/${currentGroupItems.length} ข้อ</strong> · รวม <strong>${groupScore}/${groupMax} คะแนน</strong>
            </div>
          </div>
          <h3 style="margin:4px 0 8px;font-size:16px;font-weight:700">${esc(a5GroupName(activity, curGroup))}</h3>
          ${!state.areaId ? '<div class="atx-note" style="margin-bottom:8px">⚠️ กรุณากลับไปเลือกพื้นที่ใน <strong>ขั้นตอนที่ 1 (ข้อมูลทั่วไป)</strong> ก่อนทำการบันทึกคะแนน</div>' : ''}

          <div class="atx-items-list">
            ${currentGroupItems.map(itemRow).join('')}
          </div>
        </div>
      `;
    }

    const navHtml = `
      <div class="wfa-wizard-nav">
        <button class="btn btn-secondary" type="button" id="atx-wiz-prev"${step === 1 ? ' disabled' : ''}>
          <span class="material-symbols-rounded">chevron_left</span> ย้อนกลับ
        </button>
        <div style="text-align:center;font-size:12px;color:var(--mo-text-muted)" id="atx-wiz-step-indicator">
          ขั้นตอนที่ ${step} / ${STEPS.length} · ${esc(curStepObj?.label || '')}
        </div>
        <button class="btn btn-secondary" type="button" id="atx-wiz-next"${step === STEPS.length ? ' disabled' : ''}>
          ถัดไป <span class="material-symbols-rounded">chevron_right</span>
        </button>
      </div>
    `;

    const scroller = $('atx-step-body');
    const oldY = resetScroll ? 0 : (scroller ? scroller.scrollTop : 0);
    container.innerHTML = `
      ${stepperHtml}
      <div class="wfa-step-body" id="atx-step-body">${contentHtml}</div>
      ${navHtml}
    `;
    const newScroller = $('atx-step-body');
    if (newScroller) newScroller.scrollTop = oldY;

    // Bind navigation
    container.querySelectorAll('[data-atx-step]').forEach((node) => {
      node.onclick = () => {
        step = Number(node.dataset.atxStep) || 1;
        draw(true);
      };
    });
    if ($('atx-wiz-prev')) {
      $('atx-wiz-prev').onclick = () => {
        if (step > 1) {
          step--;
          draw(true);
        }
      };
    }
    if ($('atx-wiz-next')) {
      $('atx-wiz-next').onclick = () => {
        if (step < STEPS.length) {
          step++;
          draw(true);
        }
      };
    }

    // Bind Step 1 fields
    if (step === 1) {
      container.querySelectorAll('[data-atype]').forEach((node) => {
        node.onclick = async () => {
          state.type = node.dataset.atype;
          state.areaId = '';
          form.openIssues = [];
          draw(false);
        };
      });
      if ($('atx-area')) {
        $('atx-area').onchange = async () => {
          state.areaId = $('atx-area').value;
          const picked = state.areaId ? await a5Api(activity, `audit-form?year=${a5Year}&area=${state.areaId}`) : null;
          form = { ...form, openIssues: state.type === 'COMMITTEE' ? picked?.openIssues || [] : [] };
          state.receivers = picked?.receivers || []; // ผู้รับการตรวจ = the owner of the area
          draw(false);
        };
      }
      if ($('atx-date')) $('atx-date').onchange = () => { state.date = $('atx-date').value; };
      if ($('atx-team')) {
        $('atx-team').onchange = () => {
          state.team = $('atx-team').value;
          resetParticipants();
          draw(false);
        };
      }
      container.querySelectorAll('[data-part]').forEach((node) => {
        node.onchange = () => {
          if (node.checked) {
            state.participated.add(node.dataset.part);
            node.closest('.wfa-member-card')?.classList.add('is-selected');
          } else {
            state.participated.delete(node.dataset.part);
            node.closest('.wfa-member-card')?.classList.remove('is-selected');
          }
        };
      });
      container.querySelectorAll('[data-unrecv]').forEach((node) => {
        node.onclick = () => {
          state.receivers.splice(Number(node.dataset.unrecv), 1);
          draw(false);
        };
      });
    } else {
      // Bind Step 2..6 items
      container.querySelectorAll('[data-score]').forEach((node) => {
        node.onclick = () => {
          const [id, n] = node.dataset.score.split(':').map(Number);
          state.scores[id] = n;
          draw(false);
        };
      });
      container.querySelectorAll('[data-text]').forEach((node) => {
        node.oninput = () => { state.text[node.dataset.text] = node.value; };
      });
      currentGroupItems.forEach((item) => atxPhotoInput(`atx-photo-${item.id}`, (data) => { state.photo[item.id] = data; }));
    }
  };
  draw(true);
}

async function atxSave(activity, state, form, open, onDone, groups, setStepAndDraw, lockedItem) {
  if (!state.areaId) {
    setStepAndDraw(1);
    toast('กรุณาเลือกพื้นที่ในขั้นตอนที่ 1 (ข้อมูลทั่วไป)', 'error');
    $('atx-area')?.focus();
    throw new Error('กรุณาเลือกพื้นที่');
  }

  const missing = form.items.filter((i) => state.scores[i.id] == null && !lockedItem(i.id, open));
  if (missing.length) {
    const firstMissing = missing[0];
    const stepIdx = groups.indexOf(firstMissing.s_group);
    if (stepIdx >= 0) setStepAndDraw(stepIdx + 2);
    toast(`กรุณาให้คะแนนให้ครบ (ข้อที่ ${missing.map(i => i.item_no).join(', ')})`, 'error');
    throw new Error(`ให้คะแนนให้ครบ (ข้อที่ ${missing.map(i => i.item_no).join(', ')})`);
  }

  const need = state.type === 'COMMITTEE' ? form.items.filter((i) => !open.get(i.id) && !state.ownItems.has(i.id) && state.scores[i.id] <= form.settings.issue_score) : [];
  const noText = need.filter((i) => !String(state.text[i.id] || '').trim());
  if (noText.length) {
    const stepIdx = groups.indexOf(noText[0].s_group);
    if (stepIdx >= 0) setStepAndDraw(stepIdx + 2);
    toast(`กรุณาใส่รายละเอียด Issue (ข้อที่ ${noText.map(i => i.item_no).join(', ')})`, 'error');
    $('atx-text-' + noText[0].id)?.focus();
    throw new Error(`ใส่รายละเอียด Issue`);
  }

  const noPhoto = need.filter((i) => !state.photo[i.id]);
  if (noPhoto.length) {
    const stepIdx = groups.indexOf(noPhoto[0].s_group);
    if (stepIdx >= 0) setStepAndDraw(stepIdx + 2);
    toast(`กรุณาแนบรูปปัญหา 16:9 (ข้อที่ ${noPhoto.map(i => i.item_no).join(', ')})`, 'error');
    throw new Error(`แนบรูปปัญหา`);
  }

  const result = await a5Api(activity, state.editId ? `audits/${state.editId}` : 'audits', {
    method: state.editId ? 'PATCH' : 'POST',
    body: {
      type: state.type, areaId: Number(state.areaId), auditedAt: state.date, team: state.team,
      participated: [...state.participated], receivers: state.receivers.map((r) => r.employeeId),
      scores: state.scores, issues: need.map((i) => ({ checklistId: i.id, description: state.text[i.id] }))
    }
  });
  let failedPhotos = 0;
  await Promise.all((result.issues || []).map(async (issue) => {
    try {
      await a5Api(activity, `issues/${issue.id}/photo`, { method: 'POST', body: { kind: 'BEFORE', image: state.photo[issue.checklist_id] } });
    } catch (err) { failedPhotos += 1; toast(`${issue.issue_no}: ${err.message}`, 'error'); }
  }));
  toast(`บันทึก ${result.auditNo} แล้ว · ${Number(result.percent).toFixed(2)}%${failedPhotos ? ` · รูปไม่ขึ้น ${failedPhotos} รายการ (แนบใหม่ที่แท็บ Issue)` : ''}`);
  closePopup();
  if (onDone) onDone();
}

// ---------- issues ----------

async function atxIssues(body, activity) {
  const data = await a5Api(activity, `issues?year=${a5Year}`);
  const list = listQuery(data.issues.filter((i) => atxIssueAll || i.status !== 'CLOSED'), atxHeads.issues, (i, key) => ({
    issue_no: i.issue_no,
    area: `${i.area?.code || ''} ${i.area?.name || ''}`,
    item_no: i.item?.item_no || '',
    score: i.score,
    description: i.description,
    responsible: i.responsibleName || i.responsible_id || '',
    due_date: i.due_date || '',
    status: i.shownStatus || i.status,
    photos: i.photos?.length || 0
  }[key]));
  body.innerHTML = `
    <div class="toolbar a5-filters">${a5Seg('data-iall', { open: 'ยังไม่ปิด', all: 'ทั้งหมด' }, atxIssueAll ? 'all' : 'open')}</div>
    <div class="table-wrap sheet" id="atx-rows"></div>`;
  setHeaderMeta(`Issue ${list.length} รายการ (${a5Year})`);
  fillTable('atx-rows', [{ label: 'เลขที่', key: 'issue_no' }, { label: 'พื้นที่', key: 'area' }, { label: 'ข้อ', key: 'item_no' }, { label: 'คะแนน', key: 'score' }, { label: 'ปัญหา', key: 'description' }, { label: 'ผู้รับผิดชอบ', key: 'responsible' }, { label: 'กำหนดแก้', key: 'due_date' }, { label: 'สถานะ', key: 'status' }, { label: 'รูป', key: 'photos' }], list.map((i) => `<tr data-pick="${i.id}">
    <td>${esc(i.issue_no)}</td><td>${esc(i.area.code || '')} ${esc(i.area.name || '')}</td><td>${i.item.item_no || ''}</td><td>${Number(i.score)}</td>
    <td>${esc(i.description)}</td><td>${esc(i.responsibleName || i.responsible_id || '-')}</td><td>${i.due_date ? atxDate(i.due_date) : '<span class="sum-meta">รอกำหนด</span>'}</td>
    <td>${atxBadge(i.shownStatus)}</td><td>${i.photos.length}</td></tr>`).join(''), 'ไม่มี Issue', headFor(atxHeads.issues, () => atxIssues(body, activity).catch(onErr)));
  body.querySelectorAll('[data-iall]').forEach((node) => { node.onclick = () => { atxIssueAll = node.dataset.iall === 'all'; atxIssues(body, activity).catch(onErr); }; });
  a5Lift(body);
  bindRowSelect($('atx-rows'), (id) => atxIssueDetail(activity, data.issues.find((i) => String(i.id) === id), () => atxIssues(body, activity).catch(onErr)));
}

function atxIssueDetail(activity, issue, reload) {
  const before = issue.photos.filter((p) => p.kind === 'BEFORE');
  const after = issue.photos.filter((p) => p.kind === 'AFTER');
  const img = (p) => `<a href="${esc(p.url)}" target="_blank" rel="noopener"><img class="atx-photo" src="${esc(p.url)}" alt=""></a>`;
  let beforeData = '';
  let afterData = '';
  openPopup(`${esc(issue.issue_no)} · ${esc(issue.area.code || '')} ${esc(issue.area.name || '')}`, `<div class="plan-detail">
      <p>${atxBadge(issue.shownStatus)} <span class="sum-meta">ข้อ ${issue.item.item_no || ''} ${esc(issue.item.title || '')} · ได้ ${Number(issue.score)} · ใบตรวจ ${esc(issue.auditNo)} · ${atxDate(issue.issue_date)}</span></p>
      <p><strong>ปัญหา:</strong> ${esc(issue.description)}</p>
      <p class="sum-meta">ผู้รับผิดชอบ: ${esc(issue.responsibleName || issue.responsible_id || '-')} · กำหนดแก้: ${issue.due_date ? atxDate(issue.due_date) : 'รอกำหนดรอบถัดไป'}${issue.verify_audit_no ? ` · ยืนยันโดย ${esc(issue.verify_audit_no)} (${Number(issue.final_score)})` : ''}</p>
      <div class="atx-photos">${before.map(img).join('') || '<span class="sum-meta">ยังไม่มีรูปปัญหา</span>'}</div>
      ${issue.canAddBefore && !before.length ? field('แนบรูปปัญหา 16:9', '<input id="atx-before" type="file" accept="image/*"><img id="atx-before-preview" class="atx-photo d-none" alt="">') + button('atx-before-save', 'อัปโหลดรูปปัญหา') : ''}
      ${issue.action_description ? `<p><strong>สิ่งที่แก้ไข:</strong> ${esc(issue.action_description)} <span class="sum-meta">(${atxDate(issue.action_date)})</span></p>` : ''}
      <div class="atx-photos">${after.map(img).join('')}</div>
      ${issue.canAct ? `${field('สิ่งที่แก้ไข', `<textarea id="atx-action" rows="2" maxlength="2000">${esc(issue.action_description || '')}</textarea>`)}
        ${after.length ? '' : field('รูปหลังแก้ 16:9', '<input id="atx-after" type="file" accept="image/*"><img id="atx-after-preview" class="atx-photo d-none" alt="">')}
        ${button('atx-action-save', 'ส่ง Action', 'primary')}` : ''}
      ${issue.canEditDue ? `<div class="atx-due">${field('กำหนดแก้ (admin)', `<input id="atx-due" type="date" value="${esc(issue.due_date || '')}">`)}${button('atx-due-save', 'บันทึกกำหนด')}</div>` : ''}
    </div>`, () => closePopup(), 'ปิด');
  atxPhotoInput('atx-before', (d) => { beforeData = d; });
  atxPhotoInput('atx-after', (d) => { afterData = d; });
  if ($('atx-before-save')) $('atx-before-save').onclick = async () => {
    try {
      if (!beforeData) throw new Error('เลือกรูปก่อน');
      await a5Api(activity, `issues/${issue.id}/photo`, { method: 'POST', body: { kind: 'BEFORE', image: beforeData } });
      toast('แนบรูปแล้ว');
      closePopup();
      reload();
    } catch (err) { onErr(err); }
  };
  if ($('atx-action-save')) $('atx-action-save').onclick = async () => {
    try {
      const text = $('atx-action').value.trim();
      if (!text) throw new Error('ระบุสิ่งที่แก้ไข');
      if (!after.length && !afterData) throw new Error('แนบรูปหลังแก้');
      if (afterData) await a5Api(activity, `issues/${issue.id}/photo`, { method: 'POST', body: { kind: 'AFTER', image: afterData } });
      const r = await a5Api(activity, `issues/${issue.id}/action`, { method: 'POST', body: { description: text } });
      toast(r.status === 'ON_PLAN' ? 'ส่ง Action แล้ว (ตามกำหนด)' : 'ส่ง Action แล้ว (เลยกำหนด)');
      closePopup();
      reload();
    } catch (err) { onErr(err); }
  };
  if ($('atx-due-save')) $('atx-due-save').onclick = async () => {
    try {
      await a5Api(activity, `issues/${issue.id}`, { method: 'PATCH', body: { dueDate: $('atx-due').value || null } });
      toast('บันทึกกำหนดแล้ว');
      closePopup();
      reload();
    } catch (err) { onErr(err); }
  };
}

for (const id of A5_ON) VIEWS[`${id}-edit`] = (target) => atxPage(target, id);
