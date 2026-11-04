// ระบบกิจกรรม > <activity>: Dashboard (Summary / Ranking / Schedule / Audit Plan / Team) and Setting (plan / areas / team / checklist / audit plan)
// Schedule (Dashboard, read only) and แผนงาน (Setting, admins edit) are the Project Planner (act-planner.js).
// for checklist-audit activities. Server: server/modules/act/audit.js · spec: docs/specs/act-5s.md
// Turn it on for another activity by adding its id to A5_ON (and its group names to A5_GROUPS).
const A5_ON = ['5s'];
const A5_GROUPS = { '5s': ['สะสาง', 'สะดวก', 'สะอาด', 'สร้างมาตรฐาน', 'สร้างวินัย'] };
const A5_TEAMS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
const A5_TEAM_COLORS = { A: '#1f2937', B: '#ec4899', C: '#f97316', D: '#ca8a04', E: '#0d9488', F: '#2563eb', G: '#9333ea', H: '#06b6d4', I: '#9ca3af' };
const A5_AREA_TYPES = ['โรงงาน', 'สำนักงาน'];
// 5S team (ผู้ใช้กำหนด 2026-10-30, ปรับ 2026-11-01): four teams only (mt_5s_team.unit), no committee · each team has
// ประธาน · รองประธาน · ที่ปรึกษา · ผู้ประสานงาน + สมาชิก · ทีมตรวจประเมิน has no สมาชิก: its people are split by role into
// ผู้รับผิดชอบพื้นที่ and ผู้ตรวจประเมิน (กลุ่ม A–I). Rows saved earlier without a team show as ไม่ระบุทีม until edited.
const A5_ROLE_LABEL = { ...ACT_TEAM_ROLES, owner: 'ผู้รับผิดชอบพื้นที่', auditor: 'ผู้ตรวจประเมิน' };
const A5_UNITS = { '': 'ไม่ระบุทีม', standard: 'ทีมมาตรฐาน', academic: 'ทีมวิชาการ', pr: 'ทีมประชาสัมพันธ์', audit: 'ทีมตรวจประเมิน' };
const A5_UNIT_LOOK = { '': ['#475569', 'groups'], standard: ['#0d9488', 'verified'], academic: ['#2563eb', 'menu_book'], pr: ['#d97706', 'campaign'], audit: ['#7c3aed', 'fact_check'] };
// Roles each unit may hold, in screen order
const a5RolesOf = (unit) => ['chairman', 'vice', 'advisor', 'admin', ...(unit === 'audit' ? ['owner', 'auditor'] : unit ? ['member'] : [])];
// Sub-teams per activity (server ACT_UNITS); others have one team
const A5_UNITS_OF = { '5s': A5_UNITS };
const A5_DASH_TABS = { summary: 'Summary', ranking: 'Ranking', auditor: 'Auditor', schedule: 'Schedule', audit: 'Audit Plan', team: 'Team' };
// Setting tabs: ทีม, แผนงาน, then the activity's own tables (ผู้ใช้กำหนด 2026-10-29)
const A5_SET_TABS = { team: 'Team', gantt: 'Plan', areas: 'Areas', checklist: 'Checklist', plan: 'Audit plan' }; // English names (ผู้ใช้กำหนด 2026-11-03)
let a5Year = new Date().getFullYear();
let a5DashTab = 'summary';
let a5SetTab = 'team';
let a5AreaType = A5_AREA_TYPES[0];
const a5Summary = { type: '', areaType: '', area: '' };
let a5RankMonth = new Date().getMonth() + 1;

function a5Api(activity, path, options) {
  return api(`/api/act/${encodeURIComponent(activity)}/${path}`, options);
}

function a5GroupName(activity, n) {
  const names = A5_GROUPS[activity] || [];
  return `ส${n}${names[n - 1] ? ` ${names[n - 1]}` : ''}`;
}

function a5TeamColor(team) {
  return A5_TEAM_COLORS[team] || '#64748b';
}

// Setting pages pick their sub-page from one dropdown (ผู้ใช้กำหนด 2026-11-02, AGENTS.md) · the page binds #a5-setpick
function a5SetPick(tabs, active) {
  return field('หน้า', `<select id="a5-setpick">${options(Object.keys(tabs), active, (k) => tabs[k])}</select>`);
}

function a5Seg(attr, tabs, active) {
  const entries = Array.isArray(tabs) ? tabs : Object.entries(tabs);
  return `<div class="seg" role="group">${entries.map(([key, name]) => `<button class="seg-btn${key === active ? ' is-active' : ''}" type="button" ${attr}="${esc(key)}" aria-pressed="${key === active}">${esc(name)}</button>`).join('')}</div>`;
}

function a5YearSelect(years) {
  const now = new Date().getFullYear();
  const list = [...new Set([...(years || []), now - 2, now - 1, now, now + 1, a5Year])].filter((y) => y >= 2000 && y <= 2100).sort();
  return field('ปี', `<select id="a5-year">${options(list, a5Year)}</select>`);
}

// Week w of month m (1-based): the last day, used to decide "missed" vs "waiting".
function a5WeekEnd(year, month, week) {
  const last = new Date(year, month, 0).getDate();
  return new Date(year, month - 1, week === 4 ? last : week * 7);
}

// Move a tab's filters, search and buttons from its body up into the right side of the page bar (core.js pageBar,
// slot a5-tools, after the year): filters in body order (large to small) → search → buttons at the far right.
// The left side keeps only tabs. Notes (p, .sum-meta) stay in the body. Bind events before calling.
function a5Lift(body) {
  const left = $('a5-left');
  const tools = $('a5-tools');
  if (!tools) return;
  tools.innerHTML = '';
  if (left) left.innerHTML = '';
  const groups = { filter: [], search: [], action: [] };
  body.querySelectorAll(':scope > .a5-actions, :scope > .a5-filters').forEach((box) => {
    [...box.children].forEach((child) => {
      if (child.matches('p, .sum-meta')) return;
      if (child.matches('.search-slot')) groups.search.push(child);
      else if (child.matches('.action-bar, .btn') || box.classList.contains('a5-actions')) groups.action.push(child);
      else groups.filter.push(child);
    });
    if (!box.children.length) box.remove();
  });
  tools.append(...groups.filter, ...groups.search, ...groups.action);
}

// ---------- Dashboard ----------

async function a5Dashboard(target, activity) {
  const me = await a5Api(activity, `me?year=${a5Year}`);
  target.innerHTML = `<div class="view-body"><section class="card">
    ${pageBar(a5Seg('data-a5dash', A5_DASH_TABS, a5DashTab), `<div class="a5-year">${a5YearSelect(me.years)}</div>`, 'a5')}
    <div id="a5-body"><div class="empty">กำลังโหลด...</div></div>
  </section></div>`;
  const rerender = () => a5Dashboard(target, activity).catch(onErr);
  target.querySelectorAll('[data-a5dash]').forEach((node) => { node.onclick = () => { a5DashTab = node.dataset.a5dash; rerender(); }; });
  $('a5-year').onchange = () => { a5Year = Number($('a5-year').value); rerender(); };
  const body = $('a5-body');
  if (a5DashTab === 'schedule') return aplRender(body, activity, { inPage: true, readOnly: true });
  const draw = { summary: a5DrawSummary, ranking: a5DrawRanking, auditor: a5DrawAuditors, audit: a5DrawSchedule, team: a5DrawTeam }[a5DashTab] || a5DrawSummary;
  await draw(body, activity, me);
}

// 5S Summary (ผู้ใช้กำหนด 2026-10-30): left = Self Audit chart over Committee chart, right = one table with both;
// Self = ชุดสี A, Committee = ชุดสี B, the same colours on the charts and the table headers.
const A5_TYPE_SETS = [['SELF', 'Self Audit', 1], ['COMMITTEE', 'Committee Audit', 2]]; // [type, label, CHART.series index]

async function a5DrawSummary(body, activity, me) {
  if (!me) me = await a5Api(activity, `me?year=${a5Year}`).catch(() => ({ access: {} }));
  const canEditTarget = Boolean(me?.access?.admin || me?.access?.chairman);
  const q = new URLSearchParams({ year: a5Year, type: a5Summary.type, areaType: a5Summary.areaType, area: a5Summary.area });
  const data = await a5Api(activity, `dashboard/summary?${q}`);
  const areas = data.areas.filter((a) => !a5Summary.areaType || a.areaType === a5Summary.areaType);
  const byType = data.byType || {};
  const passBase = data.pass || 80;
  const passSelf = data.passSelf || passBase;
  const passCommittee = data.passCommittee || passBase;
  const targetOf = { SELF: passSelf, COMMITTEE: passCommittee };
  const sets = A5_TYPE_SETS.map(([type, label, c]) => ({
    type,
    label,
    pass: targetOf[type] || passBase,
    color: CHART.series[c],
    months: byType[type] || Array.from({ length: 12 }, (_, i) => ({ month: i + 1, percent: 0, audits: 0 }))
  }));
  const chart = (set, i) => chartCard(`${esc(set.label)} Score % รายเดือน`, chartPlot({
    id: `a5-plot-${i}`,
    labels: ACT_MONTHS_SHORT,
    left: 'Score (%)',
    leftMax: 100,
    bars: [{ values: set.months.map((m) => m.percent), colors: [set.color], unit: '%', inner: set.months.map((m) => (m.audits ? `${m.audits} ใบ` : '')) }],
    lines: [{ values: set.months.map(() => set.pass), color: CHART.target, dash: true, dots: false, unit: '%' }],
    legend: [
      { box: set.color, label: `${set.label} % เฉลี่ยของเดือน` },
      { line: CHART.target, dash: true, label: `เกณฑ์ผ่าน ${set.label} ${set.pass}%` }
    ]
  }));
  const head = sets.map((set) => `<th colspan="2" class="a5-type-head" style="--team:${set.color}">${esc(set.label)}</th>`).join('');
  const row = (i) => `<tr><td>${ACT_MONTHS[i]}</td>${sets.map((set) => `<td>${set.months[i].percent}%</td><td>${set.months[i].audits}</td>`).join('')}</tr>`;
  const kpiPass = a5Summary.type === 'SELF' ? passSelf : passCommittee;
  const targetOptions = [
    { value: 'current', label: `Self ${passSelf}% · Committee ${passCommittee}%` },
    ...(canEditTarget ? [
      ...[[80, 80], [85, 80], [85, 85], [90, 85], [90, 90]]
        .filter(([s, c]) => s !== passSelf || c !== passCommittee)
        .map(([s, c]) => ({ value: `${s}:${c}`, label: `Self ${s}% · Committee ${c}%` })),
      { value: 'custom', label: '⚙️ ปรับเป้าหมายเอง...' }
    ] : [])
  ];
  const targetField = field('เป้าหมาย', `<select id="a5-target-sel"${canEditTarget ? '' : ' disabled'}>${targetOptions.map((o) => `<option value="${o.value}">${esc(o.label)}</option>`).join('')}</select>`);
  setHeaderMeta(data.owner ? `เจ้าของพื้นที่: <strong>${esc(data.owner.name || data.owner.employeeId)}</strong>` : '');
  body.innerHTML = `
    <div class="toolbar a5-filters">
      ${field('ประเภท', `<select id="a5-type">${options(['', 'SELF', 'COMMITTEE'], a5Summary.type, (v) => ({ '': 'ทั้งหมด', SELF: 'Self Audit', COMMITTEE: 'Committee' }[v]))}</select>`)}
      ${field('ประเภทพื้นที่', `<select id="a5-atype">${options(['', ...A5_AREA_TYPES], a5Summary.areaType, (v) => v || 'ทั้งหมด')}</select>`)}
      ${field('พื้นที่', `<select id="a5-area"><option value="">ทั้งหมด</option>${areas.map((a) => `<option value="${a.id}"${String(a.id) === String(a5Summary.area) ? ' selected' : ''}>${esc(a.code)} ${esc(a.name)}</option>`).join('')}</select>`, 'grow')}
      ${targetField}
    </div>
    <div class="ch-kpis">${(data.groups.length ? data.groups : [1, 2, 3, 4, 5].map((n) => ({ group: n, percent: 0 }))).map((g, i) => chartKpi({ label: `${esc(a5GroupName(activity, g.group))} · เฉลี่ยทั้งปี`, value: g.percent, unit: '%', pie: g.percent, color: CHART.series[i % CHART.series.length], note: g.percent >= kpiPass ? 'ผ่านเกณฑ์' : g.percent ? `ต่ำกว่าเกณฑ์ ${kpiPass}%` : '' })).join('')}</div>
    <div class="a5-side">
      <div class="a5-charts">${sets.map(chart).join('')}</div>
      <div class="table-wrap"><table class="mo-data-table">
        <colgroup><col style="width:28%"><col style="width:18%"><col style="width:18%"><col style="width:18%"><col style="width:18%"></colgroup>
        <thead><tr><th rowspan="2">เดือน</th>${head}</tr><tr>${sets.map(() => '<th>%</th><th>ครั้ง</th>').join('')}</tr></thead>
        <tbody>${ACT_MONTHS.map((_, i) => row(i)).join('')}</tbody>
      </table></div>
    </div>`;
  a5Lift(body);
  const redraw = () => a5DrawSummary(body, activity, me).catch(onErr);
  const editTarget = (focusField = 'self') => {
    if (!canEditTarget) return;
    const fields = `
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        ${field('เป้าหมาย Self Audit (%)', `<input id="a5-target-self" type="number" min="1" max="100" value="${passSelf}" placeholder="80">`)}
        ${field('เป้าหมาย Committee Audit (%)', `<input id="a5-target-comm" type="number" min="1" max="100" value="${passCommittee}" placeholder="85">`)}
      </div>
    `;
    openPopup(`ปรับเป้าหมายปี ${a5Year}`, fields, async () => {
      const selfVal = Math.round(Number($('a5-target-self').value));
      const commVal = Math.round(Number($('a5-target-comm').value));
      if (!selfVal || selfVal < 1 || selfVal > 100) throw new Error('ระบุเป้าหมาย Self Audit เป็นตัวเลข 1–100%');
      if (!commVal || commVal < 1 || commVal > 100) throw new Error('ระบุเป้าหมาย Committee Audit เป็นตัวเลข 1–100%');
      await a5Api(activity, 'target', { method: 'PUT', body: { year: a5Year, self: selfVal, committee: commVal } });
      toast(`บันทึกเป้าหมายปี ${a5Year}: Self ${selfVal}% · Committee ${commVal}% แล้ว`);
      closePopup();
      redraw();
    });
    setTimeout(() => {
      const targetInput = focusField === 'comm' ? $('a5-target-comm') : $('a5-target-self');
      targetInput?.focus();
      targetInput?.select();
    }, 50);
  };
  if ($('a5-target-sel') && canEditTarget) {
    $('a5-target-sel').onchange = async () => {
      const val = $('a5-target-sel').value;
      if (val === 'current') return;
      if (val === 'custom') {
        $('a5-target-sel').value = 'current';
        editTarget('self');
        return;
      }
      const [s, c] = val.split(':').map(Number);
      if (s && c) {
        await a5Api(activity, 'target', { method: 'PUT', body: { year: a5Year, self: s, committee: c } });
        toast(`บันทึกเป้าหมายปี ${a5Year}: Self ${s}% · Committee ${c}% แล้ว`);
        redraw();
      }
    };
  }
  const plots = body.querySelectorAll('.ch-plot');
  plots.forEach((plot, idx) => {
    const isComm = idx === 1;
    const passVal = isComm ? passCommittee : passSelf;
    const label = isComm ? 'Committee Audit' : 'Self Audit';
    plot.querySelectorAll('.ch-target, .ch-target-line').forEach((el) => {
      el.classList.add('is-clickable');
      el.style.pointerEvents = 'auto';
      el.style.cursor = 'pointer';
      el.title = `คลิกเพื่อปรับเป้าหมาย ${label} ปี ${a5Year} (ปัจจุบัน ${passVal}%)`;
      el.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        editTarget(isComm ? 'comm' : 'self');
      };
    });
  });
  $('a5-type').onchange = () => { a5Summary.type = $('a5-type').value; redraw(); };
  $('a5-atype').onchange = () => { a5Summary.areaType = $('a5-atype').value; a5Summary.area = ''; redraw(); };
  $('a5-area').onchange = () => { a5Summary.area = $('a5-area').value; redraw(); };
  sets.forEach((set, n) => chartTip(`a5-plot-${n}`, (i) => `<strong>${esc(set.label)} · ${ACT_MONTHS[i]} ${a5Year}</strong><div class="ch-tip-row"><span>Score</span><b>${set.months[i].percent}%</b></div><div class="ch-tip-row"><span>ใบตรวจ</span><b>${set.months[i].audits}</b></div>${set.months[i].audits ? chartPill(set.months[i].percent, set.pass, ' เทียบเกณฑ์', true) : ''}`));
}

async function a5DrawRanking(body, activity) {
  const month = a5Year === new Date().getFullYear() ? Math.min(a5RankMonth, 12) : (a5RankMonth || 12);
  const data = await a5Api(activity, `dashboard/ranking?year=${a5Year}&month=${month}`);
  setHeaderMeta(data.month ? `สะสม ม.ค.–${ACT_MONTHS_SHORT[data.month - 1]} ${a5Year}` : '');
  const groups = data.groups.length ? data.groups : [1, 2, 3, 4, 5];
  const table = (type) => {
    const t = data.types[type] || { rows: [], total: { groups: [], average: 0 } };
    return `<section class="card"><div class="card-title">${esc(type)}</div>
      <div class="table-wrap"><table class="mo-data-table a5-rank"><thead><tr><th>ลำดับ</th><th>ชื่อพื้นที่</th>${groups.map((n) => `<th title="${esc(a5GroupName(activity, n))}">ส${n}</th>`).join('')}<th>เฉลี่ย</th></tr></thead>
      <tbody>${t.rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td>${r.groups.map((v) => `<td>${v.toFixed(1)}</td>`).join('')}<td><strong>${r.average.toFixed(1)}</strong></td></tr>`).join('') || `<tr><td colspan="${groups.length + 3}" class="empty">ยังไม่มีผลตรวจ</td></tr>`}</tbody>
      ${t.rows.length ? `<tfoot><tr><td></td><td>เฉลี่ยรวม (${t.rows.length})</td>${t.total.groups.map((v) => `<td>${v.toFixed(1)}</td>`).join('')}<td>${t.total.average.toFixed(1)}</td></tr></tfoot>` : ''}</table></div></section>`;
  };
  body.innerHTML = `
    <div class="toolbar a5-filters">${field('เดือน', `<select id="a5-rank-month">${options(Array.from({ length: 12 }, (_, i) => i + 1), data.month, (m) => (m === 1 ? 'ม.ค.' : `สะสม ม.ค.–${ACT_MONTHS_SHORT[m - 1]}`))}</select>`)}</div>
    <div class="a5-two">${A5_AREA_TYPES.map(table).join('')}</div>`;
  a5Lift(body);
  $('a5-rank-month').onchange = () => { a5RankMonth = Number($('a5-rank-month').value); a5DrawRanking(body, activity).catch(onErr); };
}

const a5AudFilter = { team: '', status: '', q: '' };
const a5AudHead = { sort: 'team', dir: 'asc' };

async function a5DrawAuditors(body, activity) {
  const data = await a5Api(activity, `dashboard/auditors?year=${a5Year}`);
  const passTarget = data.passTarget || 80;
  const rounds = data.rounds || [];
  const teams = data.teams || [];
  setHeaderMeta(`ผู้ตรวจประเมิน ${data.totalAuditors} คน · เกณฑ์ผ่าน ${passTarget}%`);

  const renderView = () => {
    const term = a5AudFilter.q.trim().toLowerCase();
    const filtered = (data.auditors || []).filter((a) => {
      if (a5AudFilter.team && a.team !== a5AudFilter.team) return false;
      if (a5AudFilter.status === 'complete' && a.percent < 100) return false;
      if (a5AudFilter.status === 'pass' && a.percent < passTarget) return false;
      if (a5AudFilter.status === 'below' && (a.percent >= passTarget || a.percent === 0)) return false;
      if (a5AudFilter.status === 'none' && a.percent > 0) return false;
      if (term) {
        const text = `${a.employeeId} ${a.name} ${a.department} ${a.team}`.toLowerCase();
        if (!text.includes(term)) return false;
      }
      return true;
    });

    const dir = a5AudHead.dir === 'desc' ? -1 : 1;
    const sorted = [...filtered].sort((a, b) => {
      const k = a5AudHead.sort;
      let valA = a[k] ?? '';
      let valB = b[k] ?? '';
      if (k === 'seq') return 0;
      if (k.startsWith('r_')) {
        const m = Number(k.slice(2));
        valA = a.rounds?.find((r) => r.month === m)?.percent ?? -1;
        valB = b.rounds?.find((r) => r.month === m)?.percent ?? -1;
      }
      if (typeof valA === 'number' && typeof valB === 'number') return (valA - valB) * dir;
      return String(valA).localeCompare(String(valB), 'th') * dir;
    });

    const headers = [
      { label: 'ลำดับ', key: 'seq' },
      { label: 'รหัสพนักงาน', key: 'employeeId' },
      { label: 'ชื่อ - นามสกุล', key: 'name' },
      { label: 'ทีม', key: 'team' },
      { label: 'แผนรวม', key: 'planned', num: true },
      { label: 'ตรวจจริง', key: 'actual', num: true },
      { label: '% การมีส่วนร่วม', key: 'percent' },
      ...rounds.map((r) => ({
        label: r.round ? `รอบ ${r.round} (${ACT_MONTHS_SHORT[r.month - 1]})` : ACT_MONTHS_SHORT[r.month - 1],
        key: `r_${r.month}`,
        num: true
      })),
      { label: 'คะแนนเฉลี่ย', key: 'avgScore', num: true },
      { label: 'สถานะประเมิน', key: 'status' },
      { label: 'จัดการ', key: 'action' }
    ];

    const statusBadge = (a) => {
      if (a.percent >= 100) return '<span class="badge badge-success">ครบตามแผน</span>';
      if (a.percent >= passTarget) return '<span class="badge badge-success">ผ่านเกณฑ์</span>';
      if (a.percent > 0) return '<span class="badge badge-danger">ต่ำกว่าเกณฑ์</span>';
      return '<span class="badge badge-warning">ยังไม่เข้าตรวจ</span>';
    };

    const progBar = (pct) => {
      const clr = pct >= 100 ? 'var(--mo-success)' : pct >= passTarget ? 'var(--ch-1)' : pct > 0 ? 'var(--mo-danger)' : 'var(--mo-text-muted)';
      return `<div class="cfo-prog"><span><i style="width:${Math.min(100, pct)}%;background:color-mix(in srgb,${clr} 40%,transparent);box-shadow:inset 0 0 0 1px ${clr}"></i></span>${pct}%</div>`;
    };

    const rowsHtml = sorted.map((a, idx) => {
      const roundTds = rounds.map((r) => {
        const stat = a.rounds?.find((x) => x.month === r.month);
        if (!stat || (!stat.planned && !stat.actual)) return '<td class="num">-</td>';
        const isPass = stat.percent >= passTarget;
        const clr = stat.percent >= 100 ? 'var(--mo-success)' : isPass ? 'var(--mo-info)' : 'var(--mo-danger)';
        const tag = isPass ? 'ผ่าน' : 'ไม่ผ่าน';
        return `<td class="num" title="แผน ${stat.planned} ครั้ง · ตรวจจริง ${stat.actual} ครั้ง (${tag})">${stat.actual}/${stat.planned} <b style="color:${clr}">(${stat.percent}%)</b></td>`;
      }).join('');

      const teamColor = a5TeamColor(a.team);
      const teamBadge = a.team ? `<span class="a5-team-pill" style="--team:${teamColor}">ทีม ${esc(a.team)}</span>` : '-';

      return `<tr data-auditor="${esc(a.employeeId)}">
        <td>${idx + 1}</td>
        <td><strong>${esc(a.employeeId)}</strong></td>
        <td>${esc(a.name)}</td>
        <td>${teamBadge}</td>
        <td class="num">${a.planned}</td>
        <td class="num"><strong>${a.actual}</strong></td>
        <td>${progBar(a.percent)}</td>
        ${roundTds}
        <td class="num"><strong>${a.avgScore != null ? `${a.avgScore}%` : '-'}</strong></td>
        <td>${statusBadge(a)}</td>
        <td><button class="btn btn-sm secondary a5-aud-view-btn" type="button" data-view-aud="${esc(a.employeeId)}">ดูประวัติ</button></td>
      </tr>`;
    }).join('');

    fillTable(
      'a5-aud-table-wrap',
      headers,
      rowsHtml,
      `ไม่พบข้อมูลผู้ตรวจประเมินในปี ${a5Year}`,
      {
        sort: a5AudHead.sort,
        dir: a5AudHead.dir,
        onChange: (head) => {
          a5AudHead.sort = head.sort;
          a5AudHead.dir = head.dir;
          renderView();
        }
      }
    );

    const tableWrap = $('a5-aud-table-wrap');
    if (tableWrap) {
      tableWrap.querySelectorAll('.a5-aud-view-btn').forEach((btn) => {
        btn.onclick = (e) => {
          e.stopPropagation();
          showAuditorDetail(btn.dataset.viewAud);
        };
      });
      tableWrap.querySelectorAll('tbody tr').forEach((tr) => {
        tr.style.cursor = 'pointer';
        tr.onclick = (e) => {
          if (e.target.closest('button')) return;
          const empId = tr.dataset.auditor;
          if (empId) showAuditorDetail(empId);
        };
      });
    }
  };

  const showAuditorDetail = (empId) => {
    const aud = data.auditors.find((a) => a.employeeId === empId);
    if (!aud) return;
    const teamColor = a5TeamColor(aud.team);
    const title = `ประวัติการเข้าตรวจประเมิน 5S: ${aud.employeeId} · ${aud.name}`;
    const content = `
      <div class="a5-aud-kpis">
        <div class="a5-aud-kpi"><div class="a5-aud-kpi-label">ทีมตรวจประเมิน</div><div class="a5-aud-kpi-val"><span class="a5-team-pill" style="--team:${teamColor}">ทีม ${esc(aud.team || '-')}</span></div></div>
        <div class="a5-aud-kpi"><div class="a5-aud-kpi-label">แผนการเข้าตรวจ</div><div class="a5-aud-kpi-val">${aud.planned} <small>ครั้ง</small></div></div>
        <div class="a5-aud-kpi"><div class="a5-aud-kpi-label">เข้าตรวจจริง</div><div class="a5-aud-kpi-val">${aud.actual} <small>ครั้ง</small></div></div>
        <div class="a5-aud-kpi"><div class="a5-aud-kpi-label">การมีส่วนร่วม</div><div class="a5-aud-kpi-val" style="color:${aud.percent >= passTarget ? 'var(--mo-success)' : 'var(--mo-danger)'}">${aud.percent}%</div></div>
        <div class="a5-aud-kpi"><div class="a5-aud-kpi-label">คะแนนเฉลี่ยที่ตรวจ</div><div class="a5-aud-kpi-val">${aud.avgScore != null ? `${aud.avgScore}%` : '-'}</div></div>
      </div>
      <div class="table-wrap" style="max-height:360px">
        <table class="mo-data-table">
          <thead><tr><th>ลำดับ</th><th>วันที่ตรวจ</th><th>Audit ID</th><th>รหัสพื้นที่</th><th>ชื่อพื้นที่</th><th>ประเภท</th><th>ทีม</th><th class="num">คะแนน</th><th>ผลประเมิน</th></tr></thead>
          <tbody>
            ${aud.audits.map((x, i) => `
              <tr>
                <td>${i + 1}</td>
                <td>${DMY.toDmy(String(x.auditedAt || '').slice(0, 10)) || '-'}</td>
                <td><strong>${esc(x.auditNo)}</strong></td>
                <td>${esc(x.areaCode)}</td>
                <td>${esc(x.areaName)}</td>
                <td>${esc(x.areaType)}</td>
                <td><span class="a5-dot is-done" style="--team:${a5TeamColor(x.team)}"></span> ${esc(x.team)}</td>
                <td class="num"><strong>${x.percentScore}%</strong></td>
                <td><span class="badge ${x.result === 'PASS' ? 'badge-success' : 'badge-danger'}">${esc(x.result)}</span></td>
              </tr>`).join('') || '<tr><td colspan="9" class="empty">ยังไม่มีประวัติการเข้าตรวจประเมินในปีนี้</td></tr>'}
          </tbody>
        </table>
      </div>`;

    openPopup(title, content, closePopup, 'ปิด');
    const cancelBtn = $('popup-cancel');
    if (cancelBtn) cancelBtn.style.display = 'none';
  };

  const kpisHtml = [
    chartKpi({ label: 'ผู้ตรวจประเมินทั้งหมด', value: data.totalAuditors, unit: 'คน', icon: 'group', color: CHART.series[0] }),
    chartKpi({ label: 'แผนการเข้าตรวจรวม', value: data.totalPlanned, unit: 'ครั้ง', icon: 'calendar_month', color: CHART.series[1] }),
    chartKpi({ label: 'เข้าตรวจจริงรวม', value: data.totalActual, unit: 'ครั้ง', icon: 'fact_check', color: CHART.series[2] }),
    chartKpi({ label: '% การมีส่วนร่วมเฉลี่ย', value: data.avgParticipation, unit: '%', pie: data.avgParticipation, color: CHART.series[3], note: data.avgParticipation >= passTarget ? 'ผ่านเกณฑ์เป้าหมาย' : 'ต่ำกว่าเป้าหมาย' }),
    chartKpi({ label: `ผ่านเกณฑ์ (≥ ${passTarget}%)`, value: `${data.passedCount} / ${data.totalAuditors}`, unit: 'คน', icon: 'verified', color: CHART.series[4], note: `คิดเป็น ${data.passedRate}% ของทั้งหมด` })
  ].join('');

  const statusOptions = [
    ['', 'ทั้งหมด'],
    ['complete', 'ครบตามแผน (100%)'],
    ['pass', `ผ่านเกณฑ์ (≥ ${passTarget}%)`],
    ['below', `ต่ำกว่าเกณฑ์ (< ${passTarget}%)`],
    ['none', 'ยังไม่เข้าตรวจ (0%)']
  ];

  body.innerHTML = `
    <div class="toolbar a5-filters">
      ${field('ทีม', `<select id="a5-aud-team">${options(['', ...teams], a5AudFilter.team, (t) => (t ? `ทีม ${t}` : 'ทั้งหมด'))}</select>`)}
      ${field('สถานะ', `<select id="a5-aud-status">${options(statusOptions.map(([v]) => v), a5AudFilter.status, (v) => statusOptions.find(([val]) => val === v)?.[1] || v)}</select>`)}
      ${searchSlot('ค้นหา', 'a5-aud-q', 'a5-aud-search', { placeholder: 'รหัส / ชื่อ / แผนก / ทีม...', value: a5AudFilter.q })}
    </div>
    <div class="ch-kpis">${kpisHtml}</div>
    <div class="table-wrap sheet" id="a5-aud-table-wrap"></div>`;

  a5Lift(body);

  const teamSel = $('a5-aud-team');
  const statusSel = $('a5-aud-status');
  const searchInput = $('a5-aud-q');

  if (teamSel) teamSel.onchange = () => { a5AudFilter.team = teamSel.value; renderView(); };
  if (statusSel) statusSel.onchange = () => { a5AudFilter.status = statusSel.value; renderView(); };
  if (searchInput) searchInput.oninput = () => { a5AudFilter.q = searchInput.value; renderView(); };

  renderView();
}

// One circle per area x month x week (shared by the Schedule dashboard and the Setting audit plan).
function a5Dot(year, plan, audit, today) {
  const team = plan?.team || audit?.team || '';
  const color = a5TeamColor(team);
  if (audit) {
    const fixed = audit.issues > 0 && audit.openIssues === 0;
    const title = `${audit.auditNo} · ทีม ${team || '-'} · ${audit.percent}%${audit.issues ? ` · Issue ${audit.issues - audit.openIssues}/${audit.issues} แก้แล้ว` : ''}`;
    return `<span class="a5-dot is-done${fixed ? ' is-fixed' : ''}" style="--team:${color}" title="${esc(title)}"></span>`;
  }
  if (plan) {
    const missed = a5WeekEnd(year, plan.month, plan.week) < today;
    const title = `แผน ทีม ${team}${plan.round ? ` ครั้งที่ ${plan.round}` : ''}${missed ? ' · ไม่ได้ตรวจตามช่วงแผน' : ' · รอตรวจ'}`;
    return `<span class="a5-dot ${missed ? 'is-missed' : 'is-plan'}" style="--team:${color}" title="${esc(title)}">${missed ? '' : esc(team)}</span>`;
  }
  return '<span class="a5-dot"></span>';
}

function a5Grid(year, areas, plans, audits, cell) {
  const head1 = ACT_MONTHS_SHORT.map((m) => `<th colspan="4" class="a5-month">${m}</th>`).join('');
  const head2 = ACT_MONTHS_SHORT.map(() => [1, 2, 3, 4].map((w) => `<th class="a5-wk">${w}</th>`).join('')).join('');
  const planMap = new Map(plans.map((p) => [`${p.area_id}:${p.month}:${p.week}`, p]));
  const auditMap = new Map(audits.map((x) => [`${x.areaId}:${x.month}:${x.week}`, x]));
  const rows = areas.map((a) => `<tr><td class="a5-sticky">${esc(a.code)}</td><td class="a5-sticky a5-sticky2">${esc(a.name)}</td>${ACT_MONTHS_SHORT.map((_, mi) => [1, 2, 3, 4].map((w) => {
    const key = `${a.id}:${mi + 1}:${w}`;
    return `<td class="a5-cell" data-cell="${key}">${cell(planMap.get(key), auditMap.get(key))}</td>`;
  }).join('')).join('')}</tr>`).join('');
  return `<div class="a5-sched-wrap"><table class="a5-sched"><thead><tr><th rowspan="2" class="a5-sticky">ID</th><th rowspan="2" class="a5-sticky a5-sticky2">ชื่อพื้นที่</th>${head1}</tr><tr>${head2}</tr></thead><tbody>${rows || `<tr><td colspan="50" class="empty">ยังไม่มีพื้นที่ ${esc(a5AreaType)}</td></tr>`}</tbody></table></div>`;
}

function a5Legend() {
  return `<div class="a5-legend">
    <span><span class="a5-dot is-plan" style="--team:#64748b"></span>มีแผน รอตรวจ (ขอบสีทีม)</span>
    <span><span class="a5-dot is-done" style="--team:#64748b"></span>ตรวจแล้ว (สีทีม)</span>
    <span><span class="a5-dot is-missed"></span>ไม่ได้ตามช่วงแผน</span>
    <span><span class="a5-dot is-done is-fixed"></span>Issue แก้ไขครบ</span>
    <span><span class="a5-dot"></span>ไม่มีแผน</span>
  </div>
  <div class="a5-legend">${A5_TEAMS.map((t) => `<span><span class="a5-dot is-done" style="--team:${a5TeamColor(t)}"></span>ทีม ${t}</span>`).join('')}<span class="sum-meta">W1: 1–7 · W2: 8–14 · W3: 15–21 · W4: 22–สิ้นเดือน</span></div>`;
}

async function a5DrawSchedule(body, activity) {
  const data = await a5Api(activity, `dashboard/schedule?year=${a5Year}&areaType=${encodeURIComponent(a5AreaType)}`);
  setHeaderMeta(`แผนตรวจรอบปี ${data.year} (${data.areaType || 'ทั้งหมด'})`);
  const today = new Date();
  body.innerHTML = `<div class="toolbar a5-filters">${a5Seg('data-a5atype', { โรงงาน: 'แผนโรงงาน', สำนักงาน: 'แผนสำนักงาน' }, a5AreaType)}</div>
    ${a5Legend()}
    ${a5Grid(a5Year, data.areas, data.plans, data.audits, (plan, audit) => a5Dot(a5Year, plan, audit, today))}`;
  body.querySelectorAll('[data-a5atype]').forEach((node) => { node.onclick = () => { a5AreaType = node.dataset.a5atype; a5DrawSchedule(body, activity).catch(onErr); }; });
  a5Lift(body);
}

async function a5DrawTeam(body, activity) {
  const data = await a5Api(activity, `team?year=${a5Year}`);
  setHeaderMeta(`คณะกรรมการ 5ส และทีมตรวจประเมิน (${a5Year})`);
  const active = data.members.filter((m) => m.status === 'Active');
  const unitOf = (m) => m.unit || (['owner', 'auditor'].includes(m.role) ? 'audit' : '');
  const person = (m, note) => `<div class="a5-person">${esc(m.employee_id)} · ${esc(m.name || '-')}<span>${esc(note ?? m.department ?? '')}</span></div>`;
  const head = (unit, count) => {
    const [tone, icon] = A5_UNIT_LOOK[unit];
    return `<div class="a5-team-head"><span class="a5-badge" style="background:${tone}"><span class="material-symbols-rounded" style="font-size:15px">${icon}</span></span>${esc(A5_UNITS[unit])}<span>${count} คน</span></div>`;
  };
  const leads = (list) => ['chairman', 'vice', 'advisor', 'admin', 'member'].flatMap((role) => list.filter((m) => m.role === role).map((m) => person(m, A5_ROLE_LABEL[role]))).join('');
  // rows saved before the committee was dropped (no team): listed apart until an admin moves them into a team
  const top = active.filter((m) => unitOf(m) === '');
  // the four teams: leads + members; ทีมตรวจประเมิน also lists its auditors (by กลุ่ม) and the area owners
  const unitCards = ['standard', 'academic', 'pr', 'audit'].map((unit) => {
    const list = active.filter((m) => unitOf(m) === unit);
    const team = list.filter((m) => !['owner', 'auditor'].includes(m.role));
    let extra = '';
    if (unit === 'audit') {
      const auditors = list.filter((m) => m.role === 'auditor').sort((a, b) => String(a.team).localeCompare(String(b.team)));
      const owners = list.filter((m) => m.role === 'owner').sort((a, b) => String(a.area_code).localeCompare(String(b.area_code)));
      extra = `<div class="a5-team-sub">ผู้ตรวจประเมิน ${auditors.length} คน</div><div class="a5-people">${auditors.map((m) => person(m, `กลุ่ม ${m.team}`)).join('') || '<div class="a5-person sum-meta">-</div>'}</div>
        <div class="a5-team-sub">ผู้รับผิดชอบพื้นที่ ${owners.length} พื้นที่</div><div class="a5-people">${owners.map((m) => person(m, [m.area_code, m.area_name].filter(Boolean).join(' '))).join('') || '<div class="a5-person sum-meta">-</div>'}</div>`;
    }
    // ทีมตรวจประเมิน is long (owners of every area): full width, people in columns
    return `<div class="a5-team${unit === 'audit' ? ' is-wide' : ''}" style="--team:${A5_UNIT_LOOK[unit][0]}">${head(unit, list.length)}<div class="a5-people">${leads(team) || '<div class="a5-person sum-meta">ยังไม่มีรายชื่อ</div>'}</div>${extra}</div>`;
  }).join('');
  const title = (icon, text) => `<div class="a5-team-title"><span class="material-symbols-rounded">${icon}</span>${text}</div>`;
  body.innerHTML = `
    ${title('account_tree', `ทีม 5ส ปี ${a5Year}`)}
    <div class="a5-team-grid a5-unit-grid">${unitCards}</div>
    ${top.length ? `${title('help', `ไม่ระบุทีม ${top.length} คน (แก้ไขที่ Setting > ทีม เพื่อเลือกทีม)`)}<div class="a5-team-grid">${top.map((m) => `<div class="a5-team" style="--team:${A5_UNIT_LOOK[''][0]}">${person(m, A5_ROLE_LABEL[m.role] || m.role)}</div>`).join('')}</div>` : ''}
    <p class="sum-meta">ปี ${a5Year} · ${active.length} รายชื่อ · ผู้รับผิดชอบพื้นที่ Self Audit 25 ข้อก่อนวันที่ 10 ทุกเดือน · ผู้ตรวจประเมิน Committee Audit ทุก 3 เดือน</p>`;
  a5Lift(body);
}

// ---------- Setting ----------

async function a5Setting(target, activity) {
  const me = await a5Api(activity, `me?year=${a5Year}`);
  const admin = me.access.admin;
  target.innerHTML = `<div class="view-body"><section class="card">
    ${pageBar(a5SetPick(A5_SET_TABS, a5SetTab), `<div class="a5-year">${a5YearSelect(me.years)}</div>`, 'a5')}
    <div id="a5-body"><div class="empty">กำลังโหลด...</div></div>
  </section></div>`;
  const rerender = () => a5Setting(target, activity).catch(onErr);
  $('a5-setpick').onchange = () => { a5SetTab = $('a5-setpick').value; rerender(); };
  if ($('a5-year')) $('a5-year').onchange = () => { a5Year = Number($('a5-year').value); rerender(); };
  const body = $('a5-body');
  if (a5SetTab === 'gantt') return aplRender(body, activity, { inPage: true });
  const draw = { areas: a5SetAreas, team: a5SetTeam, checklist: a5SetChecklist, plan: a5SetPlan }[a5SetTab] || a5SetAreas;
  await draw(body, activity, admin, rerender);
}

// Popup with an employee search; onPick(person) gets { employeeId, name, department }.
function a5EmployeeSearch(activity, onPick, year = a5Year) {
  const run = async () => {
    const data = await a5Api(activity, `employees?year=${year}&q=${encodeURIComponent($('a5-emp-q').value.trim())}`);
    fillTable('a5-emp-list', ['รหัส', 'ชื่อ', 'หน่วยงาน'], data.employees.map((p) => `<tr data-pick="${esc(p.employeeId)}" data-name="${esc(p.name)}" data-dept="${esc(p.department)}"><td>${esc(p.employeeId)}</td><td>${esc(p.name)}</td><td>${esc(p.department)}</td></tr>`).join(''), 'ไม่พบพนักงาน');
    bindRowSelect($('a5-emp-list'), (id, row) => onPick({ employeeId: id, name: row.dataset.name, department: row.dataset.dept }));
  };
  $('a5-emp-search').onclick = () => run().catch(onErr);
  onEnter('a5-emp-q', () => run().catch(onErr));
}

// One field: type, pick from the list under it (core.js SEARCH_BOXES); value = the current choice shown in the field.
const a5EmpField = (label = 'ค้นพนักงาน', value = '') => searchBlock(searchSlot(label, 'a5-emp-q', 'a5-emp-search', { placeholder: 'รหัส ชื่อ หรือหน่วยงาน', value }), 'a5-emp-list');
const a5Heads = { areas: { sort: '', dir: 'asc', filters: {} }, team: { sort: '', dir: 'asc', filters: {} }, check: { sort: '', dir: 'asc', filters: {} } };

async function a5SetAreas(body, activity, admin, rerender) {
  const data = await a5Api(activity, `areas?year=${a5Year}`);
  let picked = null;
  body.innerHTML = `
    ${admin ? `<div class="action-bar a5-actions">${button('a5-add', 'เพิ่มพื้นที่', 'primary')}${button('a5-edit', 'แก้ไข', 'secondary', 'disabled')}${button('a5-owner', 'กำหนดผู้ดูแลปี ' + a5Year, 'secondary', 'disabled')}${button('a5-del', 'ลบ', 'danger', 'disabled')}</div>` : ''}
    <div class="table-wrap sheet" id="a5-rows"></div>
    <p class="sum-meta">${data.areas.length} พื้นที่ · ผู้รับผิดชอบพื้นที่เป็นผู้ดูแลพื้นที่ (ปี ${a5Year})</p>`;
  const areas = listQuery(data.areas, a5Heads.areas, (a, key) => (key === 'owner' ? (a.owner ? `${a.owner.employeeId} ${a.owner.name}` : '') : a[key] || ''));
  fillTable('a5-rows', [{ label: 'รหัส', key: 'code' }, { label: 'ประเภท', key: 'area_type' }, { label: 'ชื่อพื้นที่', key: 'name' }, { label: 'Section', key: 'section' }, { label: `ผู้ดูแลปี ${a5Year}`, key: 'owner' }, { label: 'สถานะ', key: 'status' }], areas.map((a) => `<tr data-pick="${a.id}"><td>${esc(a.code)}</td><td>${esc(a.area_type)}</td><td>${esc(a.name)}</td><td>${esc(a.section || '')}</td><td>${a.owner ? `${esc(a.owner.employeeId)} · ${esc(a.owner.name)}` : '<span class="sum-meta">ยังไม่กำหนด</span>'}</td><td>${esc(a.status)}</td></tr>`).join(''), 'ยังไม่มีพื้นที่', headFor(a5Heads.areas, () => a5SetAreas(body, activity, admin, rerender).catch(onErr)));
  a5Lift(body);
  if (!admin) return;
  bindRowSelect($('a5-rows'), (id) => {
    picked = data.areas.find((a) => String(a.id) === id);
    ['a5-edit', 'a5-owner', 'a5-del'].forEach((b) => { $(b).disabled = !picked; });
  });
  const form = (area) => openPopup(area ? `แก้ไขพื้นที่ ${esc(area.code)}` : 'เพิ่มพื้นที่', [
    field('รหัสพื้นที่', `<input id="a5-code" maxlength="20" value="${esc(area?.code || '')}" placeholder="เช่น A20">`),
    field('ประเภท', `<select id="a5-atype-f">${options(A5_AREA_TYPES, area?.area_type || a5AreaType)}</select>`),
    field('ชื่อพื้นที่', `<input id="a5-name" maxlength="120" value="${esc(area?.name || '')}">`),
    field('Section', `<input id="a5-section" maxlength="120" value="${esc(area?.section || '')}">`),
    field('สถานะ', `<select id="a5-status">${options(['Active', 'Inactive'], area?.status || 'Active')}</select>`)
  ].join(''), async () => {
    const payload = { year: a5Year, code: $('a5-code').value, areaType: $('a5-atype-f').value, name: $('a5-name').value, section: $('a5-section').value, status: $('a5-status').value };
    await a5Api(activity, area ? `areas/${area.id}` : 'areas', { method: area ? 'PATCH' : 'POST', body: payload });
    toast('บันทึกแล้ว');
    closePopup();
    rerender();
  });
  // Add = Excel-style grid (ผู้ใช้กำหนด 2026-11-01): paste many areas at once · edit stays the one-area form
  $('a5-add').onclick = () => {
    openPopup('เพิ่มพื้นที่', gridField('a5-grid', [
      { key: 'code', label: 'รหัสพื้นที่', width: '110px' },
      { key: 'areaType', label: 'ประเภท', type: 'select', options: A5_AREA_TYPES.map((t) => [t, t]), value: a5AreaType, width: '130px' },
      { key: 'name', label: 'ชื่อพื้นที่' },
      { key: 'section', label: 'Section', width: '180px' },
      { key: 'status', label: 'สถานะ', type: 'select', options: [['Active', 'Active'], ['Inactive', 'Inactive']], value: 'Active', width: '110px' }
    ]), async () => {
      const n = await gridSave(grid, (v) => a5Api(activity, 'areas', { method: 'POST', body: { year: a5Year, ...v } }));
      toast(`เพิ่ม ${n} พื้นที่`);
      closePopup();
      rerender();
    });
    const grid = gridBind('a5-grid');
  };
  $('a5-edit').onclick = () => picked && form(picked);
  $('a5-del').onclick = () => picked && confirmPopup('ลบพื้นที่', `ตรวจ ${esc(picked.code)} ${esc(picked.name)} อีกครั้งก่อนลบ (ถ้ามีผลตรวจแล้วจะเปลี่ยนเป็น Inactive แทน)`, async () => {
    const r = await a5Api(activity, `areas/${picked.id}?year=${a5Year}`, { method: 'DELETE' });
    toast(r.inactive ? 'มีผลตรวจแล้ว จึงเปลี่ยนเป็น Inactive' : 'ลบแล้ว');
    rerender();
  });
  $('a5-owner').onclick = () => {
    if (!picked) return;
    let chosen = picked.owner ? { employeeId: picked.owner.employeeId, name: picked.owner.name } : null;
    openPopup(`ผู้รับผิดชอบพื้นที่ ${esc(picked.code)} ปี ${a5Year}`, `${a5EmpField('ผู้รับผิดชอบพื้นที่ (ลบข้อความ = ไม่มีผู้ดูแล)', chosen ? `${chosen.employeeId} · ${chosen.name}` : '')}`, async () => {
      await a5Api(activity, `areas/${picked.id}/owner`, { method: 'PUT', body: { year: a5Year, employeeId: chosen?.employeeId || '' } });
      toast('บันทึกแล้ว');
      closePopup();
      rerender();
    });
    a5EmployeeSearch(activity, (p) => { chosen = p; });
    $('a5-emp-q').closest('.search-block').addEventListener('pick-clear', () => { chosen = null; });
  };
}

// roles: { role: label } this activity uses (5S: A5_ROLE_LABEL by sub-team · CFO: + member + department).
// Activities with sub-teams (A5_UNITS_OF) pick ทีม first; the role list follows that team (a5RolesOf).
// unitsIn: { '': committee label, code: project name } for activities whose sub-teams are their projects (SMF).
async function a5SetTeam(body, activity, admin, rerender, roles = A5_ROLE_LABEL, unitsIn = null) {
  const units = unitsIn || A5_UNITS_OF[activity] || null;
  const keys = Object.keys(roles);
  const [data, areasData] = await Promise.all([a5Api(activity, `team?year=${a5Year}`),
    keys.includes('owner') ? a5Api(activity, `areas?year=${a5Year}`).catch(() => ({ areas: [] })) : { areas: [] }]);
  const areasList = (areasData.areas || []).filter((a) => a.status === 'Active');
  let picked = null;
  const hasTeam = keys.includes('auditor');
  const unitKeys = units ? Object.keys(units) : [''];
  const unitOf = (m) => m.unit || (units && ['owner', 'auditor'].includes(m.role) ? 'audit' : '');
  // in a project team (SMF) a member is สมาชิก, not the committee's ตัวแทนหน่วยงาน
  const roleLabel = (role, unit) => (role === 'member' && unit && !A5_UNITS_OF[activity] ? 'สมาชิก' : roles[role] || role);
  const rows = listQuery([...data.members].sort((a, b) => unitKeys.indexOf(unitOf(a)) - unitKeys.indexOf(unitOf(b)) || keys.indexOf(a.role) - keys.indexOf(b.role) || String(a.team || '').localeCompare(String(b.team || '')) || String(a.area_code || '').localeCompare(String(b.area_code || '')) || String(a.employee_id).localeCompare(String(b.employee_id))), a5Heads.team, (m, key) => (key === 'role' ? roleLabel(m.role, unitOf(m)) : key === 'unit' ? units[unitOf(m)] : m[key] || ''));
  body.innerHTML = `
    ${admin ? `<div class="action-bar a5-actions">${button('a5-add', 'เพิ่มรายชื่อ', 'primary')}${button('a5-edit', 'แก้ไข', 'secondary', 'disabled')}${button('a5-del', 'ลบ', 'danger', 'disabled')}${button('a5-copy', `คัดลอกจากปี ${a5Year - 1}`)}</div>` : ''}
    <div class="table-wrap sheet" id="a5-rows"></div>
    <p class="sum-meta">${rows.length} รายชื่อ</p>`;
  const teamCell = (m) => (hasTeam ? `<td>${m.team ? `<span class="a5-dot is-done" style="--team:${a5TeamColor(m.team)}"></span> กลุ่ม ${esc(m.team)}` : (m.area_code ? `<span class="sum-meta">[${esc(m.area_code)}]</span> ${esc(m.area_name || '')}` : '')}</td>` : '');
  fillTable('a5-rows', [...(units ? [{ label: 'ทีม', key: 'unit' }] : []), { label: 'บทบาท', key: 'role' }, ...(hasTeam ? [{ label: 'กลุ่มตรวจ / พื้นที่', key: 'team' }] : []), { label: 'รหัส', key: 'employee_id' }, { label: 'ชื่อ', key: 'name' }, { label: 'หน่วยงาน', key: 'department' }, { label: 'สถานะ', key: 'status' }], rows.map((m) => `<tr data-pick="${m.id}">${units ? `<td>${esc(units[unitOf(m)])}</td>` : ''}<td>${esc(roleLabel(m.role, unitOf(m)))}</td>${teamCell(m)}<td>${esc(m.employee_id)}</td><td>${esc(m.name)}</td><td>${esc(m.department)}</td><td>${esc(m.status)}</td></tr>`).join(''), `ยังไม่มีทีมปี ${a5Year}`, headFor(a5Heads.team, () => a5SetTeam(body, activity, admin, rerender, roles, unitsIn).catch(onErr)));
  a5Lift(body);
  if (!admin) return;
  bindRowSelect($('a5-rows'), (id) => { picked = rows.find((m) => String(m.id) === id); $('a5-edit').disabled = !picked; $('a5-del').disabled = !picked; });
  // One form for add (m = null: pick the employee) and edit (m = the row: the employee stays, the rest can change).
  const form = (m) => {
    let chosen = m ? { employeeId: m.employee_id, name: m.name } : null;
    // 5S has no committee: a team is required (an old row without one may stay as it is until a team is picked)
    const teamKeys = A5_UNITS_OF[activity] ? unitKeys.filter((k) => k || (m && !unitOf(m))) : unitKeys;
    const unit0 = m ? unitOf(m) : teamKeys[0];
    // 5S: a5RolesOf · project teams (SMF): the four leads + สมาชิก · the committee: every role of the activity
    const rolesFor = (unit) => (!units ? keys : A5_UNITS_OF[activity] ? a5RolesOf(unit) : unit ? ['chairman', 'vice', 'advisor', 'admin', 'member'] : keys.filter((r) => !['owner', 'auditor'].includes(r)));
    // ผู้ดูแล (admin, SMF smart) of a year are added by the creator only; the ผู้ดูแล add their members (server grantsAdmin)
    const lead = (r, unit) => r === 'smart' || (r === 'admin' && !(activity === 'smf' && unit));
    const roleOptions = (unit, current) => options(rolesFor(unit).filter((r) => keys.includes(r) && (me?.creator || r === current || !lead(r, unit))), current || '', (v) => roleLabel(v, unit));
    const who = m ? field('พนักงาน', `<input value="${esc(`${m.employee_id} · ${m.name || ''}`)}" disabled>`) : a5EmpField('พนักงาน');
    openPopup(m ? `แก้ไขรายชื่อปี ${a5Year}` : `เพิ่มรายชื่อปี ${a5Year}`, `${who}
      ${units ? field('ทีม', `<select id="a5-unit">${options(teamKeys, unit0, (v) => units[v])}</select>`) : ''}
      ${field('บทบาท', `<select id="a5-role">${roleOptions(unit0, m?.role)}</select>`)}
      ${hasTeam ? field('กลุ่มตรวจ (เฉพาะผู้ตรวจประเมิน)', `<select id="a5-team">${options(A5_TEAMS, m?.team || 'A', (t) => `กลุ่ม ${t}`)}</select>`, '') : ''}
      ${keys.includes('owner') && areasList.length ? field('พื้นที่ (เฉพาะผู้รับผิดชอบพื้นที่)', `<select id="a5-owner-area">${options(areasList.map((a) => a.id), m?.area_id || areasList[0]?.id, (id) => { const a = areasList.find((x) => String(x.id) === String(id)); return a ? `${a.code} - ${a.name}` : id; })}</select>`, '') : ''}
      ${keys.includes('member') && !A5_UNITS_OF[activity] ? field('หน่วยงาน (เฉพาะสมาชิกที่ไม่อยู่ในโครงการ)', `<input id="a5-dept" maxlength="80" placeholder="เช่น PD1" value="${esc(m?.department || '')}">`) : ''}
      ${m ? field('สถานะ', `<select id="a5-status">${options(['Active', 'Inactive'], m.status)}</select>`) : ''}`, async () => {
      if (!chosen) throw new Error('เลือกพนักงานจากรายชื่อก่อน');
      const r = $('a5-role').value;
      if (r === 'owner' && !$('a5-owner-area')) throw new Error('ยังไม่มีพื้นที่ เพิ่มพื้นที่ที่แท็บ พื้นที่ ก่อน');
      const body = { role: r, unit: $('a5-unit')?.value || null, team: r === 'auditor' ? $('a5-team')?.value : null, areaId: r === 'owner' ? Number($('a5-owner-area')?.value) : null, department: r === 'member' ? $('a5-dept')?.value.trim() : null };
      if (m) await a5Api(activity, `team/${m.id}`, { method: 'PATCH', body: { ...body, status: $('a5-status').value } });
      else await a5Api(activity, 'team', { method: 'POST', body: { ...body, year: a5Year, employeeId: chosen.employeeId } });
      toast(m ? 'บันทึกแล้ว' : 'เพิ่มแล้ว');
      closePopup();
      rerender();
    });
    if (!m) {
      a5EmployeeSearch(activity, (p) => {
        chosen = p;
        if ($('a5-dept') && !$('a5-dept').value && p.department) $('a5-dept').value = p.department; // สมาชิก: the employee's own department
      });
      $('a5-emp-q').closest('.search-block').addEventListener('pick-clear', () => { chosen = null; });
    }
    const show = (id, on) => { if ($(id)) $(id).closest('.field').style.display = on ? '' : 'none'; };
    const syncRole = () => {
      const r = $('a5-role').value;
      show('a5-team', r === 'auditor');
      show('a5-owner-area', r === 'owner');
      show('a5-dept', r === 'member' && !$('a5-unit')?.value);
    };
    if ($('a5-unit')) $('a5-unit').onchange = () => { $('a5-role').innerHTML = roleOptions($('a5-unit').value, $('a5-role').value); syncRole(); };
    $('a5-role').onchange = syncRole;
    syncRole();
  };
  $('a5-add').onclick = () => form(null);
  $('a5-edit').onclick = () => picked && form(picked);
  $('a5-del').onclick = () => picked && confirmPopup('ลบรายชื่อ', `ตรวจ ${esc(picked.employee_id)} ${esc(picked.name)} (${esc(roles[picked.role] || picked.role)}) อีกครั้งก่อนลบ`, async () => {
    await a5Api(activity, `team/${picked.id}`, { method: 'DELETE' });
    toast('ลบแล้ว');
    rerender();
  });
  $('a5-copy').onclick = () => confirmPopup('คัดลอกทีม', `คัดลอกรายชื่อทีมปี ${a5Year - 1} มาเป็นปี ${a5Year}${me?.creator ? '' : ' (ไม่รวมผู้ดูแล: ผู้ดูแลระบบเป็นผู้กำหนด)'} (รายชื่อที่มีอยู่แล้วจะไม่ซ้ำ)`, async () => {
    const r = await a5Api(activity, 'team/copy', { method: 'POST', body: { from: a5Year - 1, to: a5Year } });
    toast(`คัดลอก ${r.copied} รายชื่อ`);
    rerender();
  }, 'คัดลอก');
}

async function a5SetChecklist(body, activity, admin, rerender) {
  const data = await a5Api(activity, `checklist?year=${a5Year}`);
  let picked = null;
  const total = data.items.filter((i) => i.status === 'Active').reduce((s, i) => s + Number(i.score_max), 0);
  body.innerHTML = `
    ${admin ? `<div class="action-bar a5-actions">${button('a5-add', 'เพิ่มหัวข้อ', 'primary')}${button('a5-edit', 'แก้ไข', 'secondary', 'disabled')}${button('a5-del', 'ลบ', 'danger', 'disabled')}${button('a5-copy', `คัดลอกจากปี ${a5Year - 1}`)}</div>` : ''}
    <div class="table-wrap sheet" id="a5-rows"></div>
    <p class="sum-meta">${data.items.length} ข้อ · คะแนนเต็มรวม ${total} · หัวข้อแยกตามปี แก้ปีนี้ไม่กระทบผลตรวจปีก่อน</p>`;
  const items = listQuery(data.items, a5Heads.check, (i, key) => (key === 's_group' ? a5GroupName(activity, i.s_group) : i[key]));
  fillTable('a5-rows', [{ label: 'ข้อที่', key: 'item_no' }, { label: 'หมวด', key: 's_group' }, { label: 'หัวข้อตรวจ', key: 'title' }, { label: 'คะแนนเต็ม', key: 'score_max' }, { label: 'สถานะ', key: 'status' }], items.map((i) => `<tr data-pick="${i.id}"><td>${i.item_no}</td><td>${esc(a5GroupName(activity, i.s_group))}</td><td>${esc(actNoLead(i.title))}</td><td>${i.score_max}</td><td>${esc(i.status)}</td></tr>`).join(''), `ยังไม่มีหัวข้อปี ${a5Year}`, headFor(a5Heads.check, () => a5SetChecklist(body, activity, admin, rerender).catch(onErr)));
  a5Lift(body);
  if (!admin) return;
  bindRowSelect($('a5-rows'), (id) => { picked = data.items.find((i) => String(i.id) === id); $('a5-edit').disabled = !picked; $('a5-del').disabled = !picked; });
  const groupCount = Math.max(5, (A5_GROUPS[activity] || []).length);
  const form = (item) => openPopup(item ? `แก้ไขข้อที่ ${item.item_no}` : `เพิ่มหัวข้อปี ${a5Year}`, [
    field('ข้อที่', `<input id="a5-no" type="number" min="1" max="200" value="${item?.item_no || (data.items.length + 1)}">`),
    field('หมวด', `<select id="a5-group">${options(Array.from({ length: groupCount }, (_, i) => i + 1), item?.s_group || 1, (n) => a5GroupName(activity, n))}</select>`),
    field('หัวข้อตรวจ', `<textarea id="a5-title" rows="2" maxlength="300">${esc(item?.title || '')}</textarea>`),
    field('คะแนนเต็ม', `<input id="a5-max" type="number" min="1" max="100" value="${item?.score_max || 5}">`),
    field('สถานะ', `<select id="a5-status">${options(['Active', 'Inactive'], item?.status || 'Active')}</select>`)
  ].join(''), async () => {
    const payload = { year: a5Year, itemNo: Number($('a5-no').value), sGroup: Number($('a5-group').value), title: $('a5-title').value, scoreMax: Number($('a5-max').value), status: $('a5-status').value };
    await a5Api(activity, item ? `checklist/${item.id}` : 'checklist', { method: item ? 'PATCH' : 'POST', body: payload });
    toast('บันทึกแล้ว');
    closePopup();
    rerender();
  });
  // Add = Excel-style grid (ผู้ใช้กำหนด 2026-11-01): paste many items at once · edit stays the one-item form
  $('a5-add').onclick = () => {
    const next = Math.max(0, ...data.items.map((i) => Number(i.item_no))) + 1;
    const groups = Array.from({ length: groupCount }, (_, i) => [String(i + 1), a5GroupName(activity, i + 1)]);
    openPopup(`เพิ่มหัวข้อปี ${a5Year}`, gridField('a5-grid', [
      { key: 'itemNo', label: 'ข้อที่', type: 'number', width: '80px' },
      { key: 'sGroup', label: 'หมวด', type: 'select', options: groups, value: '1', width: '170px' },
      { key: 'title', label: 'หัวข้อตรวจ' },
      { key: 'scoreMax', label: 'คะแนนเต็ม', type: 'number', value: '5', width: '90px' },
      { key: 'status', label: 'สถานะ', type: 'select', options: [['Active', 'Active'], ['Inactive', 'Inactive']], value: 'Active', width: '110px' }
    ], 5, `ข้อที่ว่าง = ต่อจากข้อล่าสุด (${next}) · คัดลอกหลายแถวจาก Excel แล้ววาง (Ctrl+V) · แถวว่างไม่บันทึก`), async () => {
      let auto = next;
      const n = await gridSave(grid, async (v) => {
        const itemNo = v.itemNo ? Number(v.itemNo) : auto;
        await a5Api(activity, 'checklist', { method: 'POST', body: { year: a5Year, itemNo, sGroup: Number(v.sGroup), title: v.title, scoreMax: Number(v.scoreMax || 5), status: v.status } });
        auto = Math.max(auto, itemNo + 1);
      });
      toast(`เพิ่ม ${n} ข้อ`);
      closePopup();
      rerender();
    });
    const grid = gridBind('a5-grid');
  };
  $('a5-edit').onclick = () => picked && form(picked);
  $('a5-del').onclick = () => picked && confirmPopup('ลบหัวข้อ', `ตรวจข้อที่ ${picked.item_no} อีกครั้งก่อนลบ (ถ้ามีคะแนนแล้วจะเปลี่ยนเป็น Inactive แทน)`, async () => {
    const r = await a5Api(activity, `checklist/${picked.id}`, { method: 'DELETE' });
    toast(r.inactive ? 'มีคะแนนแล้ว จึงเปลี่ยนเป็น Inactive' : 'ลบแล้ว');
    rerender();
  });
  $('a5-copy').onclick = () => confirmPopup('คัดลอกหัวข้อ', `คัดลอกหัวข้อปี ${a5Year - 1} มาเป็นปี ${a5Year} (ข้อที่มีอยู่แล้วจะไม่ถูกทับ)`, async () => {
    const r = await a5Api(activity, 'checklist/copy', { method: 'POST', body: { from: a5Year - 1, to: a5Year } });
    toast(`คัดลอก ${r.copied} ข้อ`);
    rerender();
  }, 'คัดลอก');
}

async function a5SetPlan(body, activity, admin) {
  const [areas, plan] = await Promise.all([a5Api(activity, `areas?year=${a5Year}`), a5Api(activity, `audit-plan?year=${a5Year}`)]);
  const list = areas.areas.filter((a) => a.area_type === a5AreaType && (a.status === 'Active' || plan.plans.some((p) => p.area_id === a.id)));
  const today = new Date();
  body.innerHTML = `<div class="toolbar a5-filters">${a5Seg('data-a5atype', { โรงงาน: 'แผนโรงงาน', สำนักงาน: 'แผนสำนักงาน' }, a5AreaType)}</div>
    ${a5Legend()}
    ${a5Grid(a5Year, list, plan.plans, [], (p) => a5Dot(a5Year, p, null, today))}`;
  const redraw = () => a5SetPlan(body, activity, admin).catch(onErr);
  body.querySelectorAll('[data-a5atype]').forEach((node) => { node.onclick = () => { a5AreaType = node.dataset.a5atype; redraw(); }; });
  a5Lift(body);
  if (!admin) return;
  body.querySelectorAll('[data-cell]').forEach((node) => {
    node.classList.add('is-editable');
    node.onclick = () => {
      const [areaId, month, week] = node.dataset.cell.split(':').map(Number);
      const area = list.find((a) => a.id === areaId);
      const current = plan.plans.find((p) => p.area_id === areaId && p.month === month && p.week === week);
      openPopup(`${esc(area.code)} ${esc(area.name)} · ${ACT_MONTHS[month - 1]} W${week}`, [
        field('ทีมที่ตรวจ', `<select id="a5-plan-team">${options(['', ...A5_TEAMS], current?.team || '', (t) => (t ? `ทีม ${t}` : 'ไม่มีแผน (ลบช่องนี้)'))}</select>`),
        field('ครั้งที่', `<select id="a5-plan-round">${options(['', 1, 2, 3, 4, 5, 6], current?.round || '', (r) => (r ? `ครั้งที่ ${r}` : '-'))}</select>`)
      ].join(''), async () => {
        await a5Api(activity, 'audit-plan', { method: 'PUT', body: { year: a5Year, areaId, month, week, team: $('a5-plan-team').value, round: $('a5-plan-round').value || null } });
        toast('บันทึกแล้ว');
        closePopup();
        redraw();
      });
    };
  });
}

for (const id of A5_ON) {
  VIEWS[`${id}-home`] = (target) => a5Dashboard(target, id);
  VIEWS[`${id}-setting`] = (target) => a5Setting(target, id);
}
