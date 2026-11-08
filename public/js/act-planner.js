// ระบบกิจกรรม > <activity> > Setting: Project Planner (server: server/modules/act/planner.js).
// Main items with sub items on a Gantt: year view = 12 months × W1–W4 (longer when items run into next year), month view = days. The year's admins
// drag bars (whole bar = move, edge = resize), add rows with +, and create / edit / delete. Others read only.
// SMF: its own Dashboard / Setting pages (APL_ON). 5S: a tab inside Setting (edit) and Dashboard (read only), see act-5s.js.
const APL_ON = ['smf'];
// Main item colours (ผู้ใช้ขอเพิ่ม 2026-10-29: 5 → 12); keys are stored in mt_<act>_task.color, server COLORS lists the same keys.
const APL_COLORS = {
  p1: '#ec6f73', p2: '#3fbfbf', p3: '#e3a52f', p4: '#8b6fd8', p5: '#4b8bea', p6: '#2fa36b',
  p7: '#f08a3c', p8: '#e46aa8', p9: '#8d6e52', p10: '#5f7488', p11: '#1f8a99', p12: '#a8b236'
};
// Narrowest column in px; wider screens stretch the columns so the last month ends at the right edge.
const APL_COL = { year: 15, month: 26 };
const APL_LEFT = 384; // left columns, app.css .apl-row (260 on phones)
// A plan of year Y may run until December of Y + 1 (planner.js datesIn).
const APL_MAX_MONTHS = 24;
let aplView = 'year';
let aplYear = new Date().getFullYear();
let aplMonth = new Date().getMonth(); // month of the plan, 12–23 = next year
let aplSelected = null;
let aplQuery = '';
let aplUnit = ''; // โครงการ filter (SMF projects); '' = all
const aplCollapsed = new Set();

function aplLastDay(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function aplMonthOf(iso) {
  const date = actDate(iso);
  return (date.getFullYear() - aplYear) * 12 + date.getMonth();
}

function aplMonthName(month, long = false) {
  const name = (long ? ACT_MONTHS : ACT_MONTHS_SHORT)[month % 12];
  if (month < 12) return long ? `${name} ${aplYear}` : name;
  return long ? `${name} ${aplYear + 1}` : `${name} ${String(aplYear + 1).slice(2)}`;
}

// Year view column = plan month * 4 + week (W1 1–7, W2 8–14, W3 15–21, W4 22–end of month), as in the 5S audit plan.
function aplWeekCol(iso) {
  return aplMonthOf(iso) * 4 + Math.min(3, Math.floor((actDate(iso).getDate() - 1) / 7));
}

function aplColStart(col) {
  return actIso(new Date(aplYear, Math.floor(col / 4), (col % 4) * 7 + 1));
}

function aplColEnd(col) {
  const month = Math.floor(col / 4);
  const week = col % 4;
  return actIso(new Date(aplYear, month, week < 3 ? week * 7 + 7 : aplLastDay(aplYear, month)));
}

// Year view shows 12 months, or more when an item runs into next year.
function aplGeometry(tasks) {
  if (aplView === 'month') {
    const cols = aplLastDay(aplYear, aplMonth);
    return { cols, min: APL_COL.month, first: actIso(new Date(aplYear, aplMonth, 1)), last: actIso(new Date(aplYear, aplMonth, cols)) };
  }
  const lastMonth = Math.max(11, ...tasks.filter((t) => t.end_date).map((t) => Math.min(APL_MAX_MONTHS - 1, aplMonthOf(t.end_date))));
  return { cols: (lastMonth + 1) * 4, months: lastMonth + 1, min: APL_COL.year };
}

// Column span [a, b] of an item, clipped to the view; null when it is outside.
function aplPlace(task, g) {
  if (!task.start_date || !task.end_date) return null;
  if (aplView === 'year') {
    const a = Math.max(0, aplWeekCol(task.start_date));
    const b = Math.min(g.cols - 1, aplWeekCol(task.end_date));
    return b < a ? null : { a, b };
  }
  if (task.end_date < g.first || task.start_date > g.last) return null;
  return { a: task.start_date < g.first ? 0 : actDate(task.start_date).getDate() - 1, b: task.end_date > g.last ? g.cols - 1 : actDate(task.end_date).getDate() - 1 };
}

// Today as a column position (fractional), or null.
function aplTodayCol(g) {
  const today = actIso(new Date());
  if (aplView === 'month') return today >= g.first && today <= g.last ? actDate(today).getDate() - 0.5 : null;
  const col = aplWeekCol(today);
  if (col < 0 || col >= g.cols) return null;
  const date = actDate(today);
  const from = (col % 4) * 7 + 1;
  const to = col % 4 < 3 ? from + 6 : aplLastDay(date.getFullYear(), date.getMonth());
  return col + (date.getDate() - from + 0.5) / (to - from + 1);
}

const aplPct = (col, g) => `${(col / g.cols) * 100}%`;

// New dates after dragging `delta` columns. Year view snaps to whole weeks, month view moves by days.
function aplShift(task, mode, delta, g) {
  if (aplView === 'year') {
    const max = APL_MAX_MONTHS * 4 - 1;
    let a = aplWeekCol(task.start_date);
    let b = aplWeekCol(task.end_date);
    if (mode === 'move') {
      const len = b - a;
      a = Math.max(0, Math.min(max - len, a + delta));
      b = a + len;
    } else if (mode === 'l') a = Math.max(0, Math.min(b, a + delta));
    else b = Math.min(Math.max(g.cols - 1, b), Math.max(a, b + delta));
    return { startDate: aplColStart(a), endDate: aplColEnd(b) };
  }
  const first = actIso(new Date(aplYear, 0, 1));
  const last = actIso(new Date(aplYear + 1, 11, 31));
  const add = (iso) => actIso(actAddDays(actDate(iso), delta));
  let start = task.start_date;
  let end = task.end_date;
  if (mode === 'move') {
    const days = Math.round((actDate(end) - actDate(start)) / 86400000);
    start = add(start);
    if (start < first) start = first;
    end = actIso(actAddDays(actDate(start), days));
    if (end > last) { end = last; start = actIso(actAddDays(actDate(end), -days)); }
  } else if (mode === 'l') {
    start = add(start);
    if (start > end) start = end;
    if (start < first) start = first;
  } else {
    end = add(end);
    if (end < start) end = start;
    if (end > last) end = last;
  }
  return { startDate: start, endDate: end };
}

function aplHead(g) {
  if (aplView === 'year') {
    return `<div class="apl-months" style="grid-template-columns:repeat(${g.months}, 1fr)">${Array.from({ length: g.months }, (_, m) => `<div class="${m === 12 ? 'is-year' : ''}">${aplMonthName(m)}</div>`).join('')}</div>
      <div class="apl-ticks" style="grid-template-columns:repeat(${g.cols}, 1fr)">${Array.from({ length: g.cols }, (_, c) => `<div class="${c % 4 === 0 ? 'is-month' : ''}${c === 48 ? ' is-year' : ''}" title="${aplMonthName(Math.floor(c / 4))} W${c % 4 + 1}">${c % 4 + 1}</div>`).join('')}</div>`;
  }
  return `<div class="apl-months"><div>${aplMonthName(aplMonth, true)}</div></div>
    <div class="apl-ticks" style="grid-template-columns:repeat(${g.cols}, 1fr)">${Array.from({ length: g.cols }, (_, c) => {
      const day = new Date(aplYear, aplMonth, c + 1).getDay();
      return `<div class="${day === 0 || day === 6 ? 'is-weekend' : ''}">${c + 1}</div>`;
    }).join('')}</div>`;
}

function aplLines(g) {
  const cells = Array.from({ length: g.cols }, (_, c) => {
    if (aplView === 'year') return `<div class="${c % 4 === 0 ? 'is-month' : ''}${c === 48 ? ' is-year' : ''}"></div>`;
    const day = new Date(aplYear, aplMonth, c + 1).getDay();
    return `<div class="${day === 0 || day === 6 ? 'is-weekend' : ''}"></div>`;
  }).join('');
  const today = aplTodayCol(g);
  return `<div class="apl-lines" style="grid-template-columns:repeat(${g.cols}, 1fr)">${cells}</div>${today == null ? '' : `<div class="apl-today" style="left:${aplPct(today, g)}"></div>`}`;
}

// Owner without the title (นาย / นาง / นางสาว ...) to keep the column short.
const aplOwner = (name) => String(name || '').replace(/^(นางสาว|นาง|นาย|Mr\.?|Mrs\.?|Ms\.?|Miss)\s*/, '');
// Plan vs actual (server planStatus): colour key for the % cell and the label beside the bar.
const APL_PLAN_KEY = [['early', 'เสร็จก่อนแผน'], ['done', 'เสร็จ / ตามแผน'], ['ahead', 'เร็วกว่าแผน'], ['behind', 'ช้ากว่าแผน'], ['overdue', 'เลยกำหนด / เสร็จช้า']];

// Where the dark (actual) bar ends: the done day, today while open (past the end when late), none before the start.
function aplActualEnd(task) {
  if (!task.start_date) return null;
  if (task.progress >= 100) return task.done_on || task.end_date;
  const today = actIso(new Date());
  // nothing done yet = no actual bar (like an empty A row in the Excel plan)
  return today < task.start_date || task.progress <= 0 ? null : today;
}

// Dates + plan status beside the bar: on the right when there is room, else on the left, else only in the bar's tooltip.
function aplDatesLabel(pos, g, text) {
  const room = Math.max(0.18, text.length * 0.0042);
  if ((g.cols - pos.b - 1) / g.cols >= room) return `<div class="apl-dates" style="left:calc(${aplPct(pos.b + 1, g)} + 6px)">${text}</div>`;
  if (pos.a / g.cols >= room) return `<div class="apl-dates" style="right:calc(${aplPct(g.cols - pos.a, g)} + 6px)">${text}</div>`;
  return '';
}

function aplRow(task, code, color, g, lines, canEdit, phase, canUp = false, canDown = false) {
  const pos = aplPlace(task, g);
  const plan = task.plan || { code: 'none', text: '' };
  const span = task.start_date ? `${actShort(task.start_date)} – ${actShort(task.end_date)}${plan.text ? ` · ${plan.text}` : ''}` : '';
  // Light bar = plan (start → end, the one you drag). Dark bar = actual, from the start to the day it was done,
  // or to today while open — so it stops short when done early and runs past the end when late (ผู้ใช้กำหนด 2026-10-29).
  const act = pos ? aplPlace({ start_date: task.start_date, end_date: aplActualEnd(task) }, g) : null;
  const tip = `${esc(task.title)} · ${span} · ${task.progress}%`;
  const bar = pos ? `<div class="apl-bar${canEdit ? ' is-editable' : ''}" data-bar="${task.id}" data-a="${pos.a}" data-b="${pos.b}" style="left:${aplPct(pos.a, g)};width:${aplPct(pos.b - pos.a + 1, g)};--bar:${color}" title="${tip}">
      ${canEdit && !task.derived ? '<div class="apl-handle is-l" data-h="l"></div><div class="apl-handle is-r" data-h="r"></div>' : ''}</div>
    ${act ? `<div class="apl-act" style="left:${aplPct(act.a, g)};width:${aplPct(Math.min(act.b, pos.b) - act.a + 1, g)};--bar:${color}"></div>
    ${act.b > pos.b ? `<div class="apl-act is-over" style="left:${aplPct(pos.b + 1, g)};width:${aplPct(act.b - pos.b, g)}" title="เลยกำหนด"></div>` : ''}
    <div class="apl-act-pct" style="${act.b + 1 > g.cols * 0.95 ? 'right:4px' : `left:calc(${aplPct(act.b + 1, g)} + 4px)`}">${task.progress}%</div>` : ''}
    ${aplDatesLabel(pos, g, span)}` : '';
  const title = phase
    ? `<div class="apl-title"><button class="apl-tog" type="button" data-tog="${task.id}" aria-expanded="${!aplCollapsed.has(task.id)}" aria-label="ย่อ/ขยาย">${phase.kids ? (aplCollapsed.has(task.id) ? '▸' : '▾') : ''}</button><span>${esc(actNoLead(task.title))}</span></div>`
    : `<div class="apl-title is-sub"><span>${esc(actNoLead(task.title))}</span></div>`;
  const movesHtml = canEdit ? `<span class="apl-row-moves">
    <button class="apl-move-btn is-up" type="button" data-move="up" data-id="${task.id}" ${canUp ? '' : 'disabled'} aria-label="เลื่อนขึ้น" title="เลื่อนขึ้น">▲</button>
    <button class="apl-move-btn is-down" type="button" data-move="down" data-id="${task.id}" ${canDown ? '' : 'disabled'} aria-label="เลื่อนลง" title="เลื่อนลง">▼</button>
  </span>` : '';
  return `<div class="apl-row${phase ? ' is-phase' : ''}${aplSelected === task.id ? ' is-selected' : ''}" data-task="${task.id}">
    <div class="apl-left"><div class="apl-code"><span>${code}</span>${movesHtml}</div>${title}<div title="${esc(task.owner_name)}">${esc(aplOwner(task.owner_name))}</div><div class="apl-pct is-${plan.code}" title="${esc(plan.text)}">${task.progress}</div></div>
    <div class="apl-track">${lines}${bar}</div></div>`;
}

// inPage: inside a tab of another page that has its own year (a5Year) and page bar (slot a5-tools).
// readOnly: no create / edit / drag even for admins (Dashboard).
async function aplRender(target, activity, opts = {}) {
  const { inPage = false, readOnly = false } = opts;
  if (inPage) aplYear = a5Year;
  let data;
  try {
    data = await api(`/api/act/${encodeURIComponent(activity)}/tasks?year=${aplYear}`);
  } catch (err) {
    if (inPage) $('a5-tools').innerHTML = '';
    target.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
    return;
  }
  const tasks = data.tasks || [];
  const canEdit = Boolean(data.canEdit) && !readOnly;
  if (!tasks.some((t) => t.id === aplSelected)) aplSelected = null;
  const g = aplGeometry(tasks);
  const kidsOf = (id) => tasks.filter((t) => t.parent_id === id).sort((a, b) => a.sort_no - b.sort_no || a.id - b.id);
  const phases = tasks.filter((t) => t.parent_id == null).sort((a, b) => a.sort_no - b.sort_no || a.id - b.id);
  const q = aplQuery.trim().toLowerCase();
  const match = (t) => !q || `${t.title} ${t.owner_name}`.toLowerCase().includes(q);
  const lines = aplLines(g);
  // SMF: main items belong to a project (ผู้ใช้กำหนด 2026-11-01) · rows are grouped under each project's name
  const units = data.units || [];
  if (aplUnit && !units.some((u) => u.code === aplUnit)) aplUnit = '';
  const unitName = (code) => units.find((u) => u.code === code)?.name || 'ไม่ระบุโครงการ';

  const getSiblings = (t) => {
    if (!t) return [];
    if (t.parent_id != null) return kidsOf(t.parent_id);
    return phases;
  };

  let rows = '';
  const drawPhases = (list) => list.forEach((p) => {
    const pi = phases.indexOf(p);
    const kids = kidsOf(p.id);
    const shownKids = q ? kids.filter(match) : kids;
    if (!match(p) && !shownKids.length) return;
    const color = APL_COLORS[p.color] || Object.values(APL_COLORS)[pi % Object.keys(APL_COLORS).length];
    const pSibs = getSiblings(p);
    const pIdx = pSibs.findIndex((x) => x.id === p.id);
    const pCanUp = pIdx > 0;
    const pCanDown = pIdx !== -1 && pIdx < pSibs.length - 1;
    rows += aplRow(p, `${pi + 1}`, color, g, lines, canEdit, { kids: kids.length }, pCanUp, pCanDown);
    if (!aplCollapsed.has(p.id)) {
      shownKids.forEach((k) => {
        const kSibs = getSiblings(k);
        const kIdx = kSibs.findIndex((x) => x.id === k.id);
        const kCanUp = kIdx > 0;
        const kCanDown = kIdx !== -1 && kIdx < kSibs.length - 1;
        rows += aplRow(k, `${pi + 1}.${kids.indexOf(k) + 1}`, color, g, lines, canEdit, null, kCanUp, kCanDown);
      });
    }
  });
  const unitOfPhase = (p) => p.unit || units.find((u) => u.code.toLowerCase() === p.title?.trim().toLowerCase() || u.name.trim().toLowerCase() === p.title?.trim().toLowerCase())?.code || '';
  const filteredPhases = aplUnit ? phases.filter((p) => unitOfPhase(p) === aplUnit) : phases;
  drawPhases(filteredPhases);
  if (canEdit) rows += `<div class="apl-row apl-addrow"><div class="apl-left"><div></div><div><button class="apl-link" type="button" id="apl-add-phase">+ เพิ่มข้อหลัก</button></div><div></div><div></div></div><div class="apl-track">${lines}</div></div>`;
  const byId = (id) => tasks.find((t) => t.id === Number(id));
  const selTask = aplSelected ? byId(aplSelected) : null;
  const selSibs = selTask ? getSiblings(selTask) : [];
  const selIdx = selTask ? selSibs.findIndex((t) => t.id === selTask.id) : -1;
  const canSelUp = selIdx > 0;
  const canSelDown = selIdx !== -1 && selIdx < selSibs.length - 1;
  const now = new Date().getFullYear();
  const years = [...new Set([now - 2, now - 1, now, now + 1, aplYear])].filter((y) => y >= 2000 && y <= 2100).sort();
  const seg = `<div class="seg" role="group" aria-label="มุมมอง">${[['year', 'รายปี'], ['month', 'รายเดือน']].map(([mode, name]) => `<button class="seg-btn${mode === aplView ? ' is-active' : ''}" type="button" data-aplview="${mode}" aria-pressed="${mode === aplView}">${name}</button>`).join('')}</div>`;
  const search = (units.length ? field('โครงการ', `<select id="apl-unit">${options(['', ...units.map((u) => u.code)], aplUnit, (v) => (v ? unitName(v) : 'ทั้งหมด'))}</select>`) : '')
    + field('ค้นหา', `<input id="apl-q" placeholder="ชื่อรายการหรือผู้รับผิดชอบ" value="${esc(aplQuery)}">`);
  // All on the right (the page has no sub-pages), large to small: year → year/month view → month → search →
  // create / edit / delete at the far right.
  const tools = `${inPage ? '' : `<div class="a5-year">${field('ปี', `<select id="apl-year">${years.map((y) => `<option value="${y}"${y === aplYear ? ' selected' : ''}>${y}</option>`).join('')}</select>`)}</div>`}
    ${seg}
    ${aplView === 'month' ? `<div class="plan-nav">${button('apl-prev', '‹', 'secondary', 'aria-label="เดือนก่อน"')}${button('apl-next', '›', 'secondary', 'aria-label="เดือนถัดไป"')}</div><strong class="plan-label">${aplMonthName(aplMonth, true)}</strong>` : ''}
    ${search}
    ${canEdit ? `${button('apl-new', 'สร้าง', 'primary')}${button('apl-edit', 'แก้ไข', 'secondary', aplSelected ? '' : 'disabled')}${button('apl-del', 'ลบ', 'danger', aplSelected ? '' : 'disabled')}${button('apl-up', '↑ ขึ้น', 'secondary', canSelUp ? '' : 'disabled', 'title="เลื่อนขึ้น"')}${button('apl-down', '↓ ลง', 'secondary', canSelDown ? '' : 'disabled', 'title="เลื่อนลง"')}` : ''}`;
  const keepScroll = target.querySelector('.apl-scroll');
  const scroll = keepScroll ? [keepScroll.scrollLeft, keepScroll.scrollTop] : null;
  const content = `<div class="apl-scroll"><div class="apl-grid" style="--apl-tl:${g.cols * g.min}px">
      <div class="apl-row apl-head"><div class="apl-left"><div>ลำดับ</div><div>รายการ</div><div>ผู้รับผิดชอบ</div><div class="apl-pct">%</div></div><div class="apl-track">${aplHead(g)}</div></div>
      ${rows}
    </div></div>
    ${tasks.length ? `<div class="apl-key">${APL_PLAN_KEY.map(([k, label]) => `<span><i class="apl-pct is-${k}"></i>${label}</span>`).join('')}<span class="sum-meta">แถบบน (อ่อน) = แผน · แถบล่าง (เข้ม) = ทำจริง ถึงวันเสร็จ / วันนี้ · แดง = เลยกำหนด · สถานะเทียบ % จริงกับ % ที่ควรได้ถึงวันนี้ ต่างไม่เกิน 10% = ตามแผน${canEdit ? ' · เพิ่มข้อรอง: เลือกข้อหลักแล้วกด "สร้าง"' : ''}</span></div>` : `<p class="empty">ยังไม่มีแผนปี ${aplYear}${canEdit ? ' กด "สร้าง" หรือ "+ เพิ่มข้อหลัก"' : ''}</p>`}`;
  if (inPage) {
    $('a5-tools').innerHTML = tools;
    target.innerHTML = content;
  } else {
    target.innerHTML = `<div class="view-body"><section class="card plan-card">${pageBar('', tools, 'apl')}${content}</section></div>`;
  }
  const box = target.querySelector('.apl-scroll');
  // The scrollbars start below the header row and right of the left columns (app.css .apl-scroll).
  box.style.setProperty('--apl-head', `${box.querySelector('.apl-head').offsetHeight}px`);
  box.style.setProperty('--apl-left', `${box.querySelector('.apl-left').offsetWidth}px`);
  if (scroll) [box.scrollLeft, box.scrollTop] = scroll;
  else if (box.scrollWidth > box.clientWidth) {
    const track = box.scrollWidth - box.querySelector('.apl-left').offsetWidth;
    box.scrollLeft = Math.max(0, ((aplTodayCol(g) ?? 0) / g.cols) * track - (box.clientWidth - APL_LEFT) / 2);
  }

  const rerender = () => aplRender(target, activity, opts).catch(onErr);
  document.querySelectorAll('[data-aplview]').forEach((node) => { node.onclick = () => { aplView = node.dataset.aplview; rerender(); }; });
  if ($('apl-year')) $('apl-year').onchange = () => { aplYear = Number($('apl-year').value); aplMonth %= 12; aplSelected = null; rerender(); };
  if ($('apl-unit')) $('apl-unit').onchange = () => { aplUnit = $('apl-unit').value; rerender(); };
  let typing;
  $('apl-q').oninput = () => { clearTimeout(typing); typing = setTimeout(() => { aplQuery = $('apl-q').value; rerender().then(() => { const input = $('apl-q'); input?.focus(); input?.setSelectionRange(input.value.length, input.value.length); }); }, 250); };
  if ($('apl-prev')) {
    // Month view moves within the plan: January of its year to December of the next.
    $('apl-prev').disabled = aplMonth <= 0;
    $('apl-next').disabled = aplMonth >= APL_MAX_MONTHS - 1;
    $('apl-prev').onclick = () => { aplMonth = Math.max(0, aplMonth - 1); rerender(); };
    $('apl-next').onclick = () => { aplMonth = Math.min(APL_MAX_MONTHS - 1, aplMonth + 1); rerender(); };
  }
  target.querySelectorAll('[data-tog]').forEach((node) => {
    node.onclick = (e) => { e.stopPropagation(); const id = Number(node.dataset.tog); if (aplCollapsed.has(id)) aplCollapsed.delete(id); else aplCollapsed.add(id); rerender(); };
  });

  const syncActionButtons = () => {
    if ($('apl-edit')) $('apl-edit').disabled = !aplSelected;
    if ($('apl-del')) $('apl-del').disabled = !aplSelected;
    const cur = aplSelected ? byId(aplSelected) : null;
    const curSibs = cur ? getSiblings(cur) : [];
    const curIdx = cur ? curSibs.findIndex((t) => t.id === cur.id) : -1;
    if ($('apl-up')) $('apl-up').disabled = curIdx <= 0;
    if ($('apl-down')) $('apl-down').disabled = curIdx === -1 || curIdx >= curSibs.length - 1;
  };

  target.querySelectorAll('[data-task]').forEach((row) => {
    row.onclick = (e) => {
      if (e.target.closest('[data-add],[data-tog],[data-move]')) return;
      aplSelected = Number(row.dataset.task);
      target.querySelectorAll('[data-task]').forEach((r) => r.classList.toggle('is-selected', r === row));
      syncActionButtons();
    };
    if (canEdit) row.ondblclick = (e) => { if (!e.target.closest('[data-add],[data-tog],[data-move]')) aplOpenForm(activity, tasks, byId(row.dataset.task), null, rerender, units); };
  });
  if (!canEdit) return;

  async function aplMoveTask(taskId, dir) {
    if (!taskId) return;
    try {
      await api(`/api/act/${encodeURIComponent(activity)}/tasks/${taskId}`, {
        method: 'PATCH',
        body: { move: dir }
      });
      aplSelected = taskId;
      rerender();
    } catch (err) {
      onErr(err);
    }
  }

  if ($('apl-up')) $('apl-up').onclick = () => aplMoveTask(aplSelected, 'up');
  if ($('apl-down')) $('apl-down').onclick = () => aplMoveTask(aplSelected, 'down');
  target.querySelectorAll('[data-move]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.id);
      const dir = btn.dataset.move;
      aplMoveTask(id, dir);
    };
  });

  // one handler for the page on screen: a rerender makes a new target, so it cannot live on target
  if (aplMoveKeys) window.removeEventListener('keydown', aplMoveKeys);
  aplMoveKeys = (e) => {
    if (!document.body.contains(target)) { window.removeEventListener('keydown', aplMoveKeys); aplMoveKeys = null; return; }
    if (!canEdit || !aplSelected) return;
    if (e.target.matches('input, textarea, select')) return;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const dir = e.key === 'ArrowUp' ? 'up' : 'down';
      const cur = byId(aplSelected);
      const curSibs = cur ? getSiblings(cur) : [];
      const curIdx = cur ? curSibs.findIndex((t) => t.id === cur.id) : -1;
      if (dir === 'up' && curIdx > 0) aplMoveTask(aplSelected, 'up');
      else if (dir === 'down' && curIdx !== -1 && curIdx < curSibs.length - 1) aplMoveTask(aplSelected, 'down');
    }
  };
  window.addEventListener('keydown', aplMoveKeys);

  $('apl-add-phase').onclick = () => aplOpenForm(activity, tasks, null, null, rerender, units);
  // With a main item selected, "สร้าง" adds a sub item under it (the + button per row was removed for space).
  $('apl-new').onclick = () => {
    const sel = byId(aplSelected);
    if (sel) {
      const parentPhase = sel.parent_id ? byId(sel.parent_id) : sel;
      const uCode = unitOfPhase(parentPhase);
      const proj = units.find((u) => u.code === uCode);
      if (proj && proj.team_type === 'individual') {
        toast('โครงการรูปแบบเดี่ยว ไม่สามารถเพิ่มข้อรองได้ (เพิ่มข้อรองได้เฉพาะโครงการรูปแบบทีม)', 'error');
        return;
      }
    }
    aplOpenForm(activity, tasks, null, sel ? (sel.parent_id ?? sel.id) : null, rerender, units);
  };
  $('apl-edit').onclick = () => { const task = byId(aplSelected); if (task) aplOpenForm(activity, tasks, task, null, rerender, units); };
  $('apl-del').onclick = () => {
    const task = byId(aplSelected);
    if (!task) return;
    const kids = kidsOf(task.id).length;
    confirmPopup('ลบรายการ', `ลบ "${esc(task.title)}"${kids ? ` และข้อรอง ${kids} รายการ` : ''}`, async () => {
      await api(`/api/act/${encodeURIComponent(activity)}/tasks/${task.id}`, { method: 'DELETE' });
      aplSelected = null;
      toast('ลบแล้ว');
      rerender();
    });
  };
  target.querySelectorAll('[data-bar]').forEach((node) => node.addEventListener('pointerdown', (e) => aplDrag(e, node, g, activity, tasks, kidsOf, rerender)));
}

// Drag a bar; a main item with sub items has no edges and moves all its sub items by the same step.
function aplDrag(e, node, g, activity, tasks, kidsOf, rerender) {
  if (e.button !== 0) return;
  e.preventDefault();
  const task = tasks.find((t) => t.id === Number(node.dataset.bar));
  const mode = e.target.dataset.h || 'move';
  const x0 = e.clientX;
  const colPx = node.parentElement.getBoundingClientRect().width / g.cols;
  const a0 = Number(node.dataset.a);
  const b0 = Number(node.dataset.b);
  let delta = 0;
  try { node.setPointerCapture(e.pointerId); } catch { // keep dragging without capture
  }
  node.classList.add('is-dragging');
  const move = (ev) => {
    delta = Math.round((ev.clientX - x0) / colPx);
    let a = a0;
    let b = b0;
    if (mode === 'move') { a += delta; b += delta; } else if (mode === 'l') a = Math.min(b0, a0 + delta); else b = Math.max(a0, b0 + delta);
    node.style.left = aplPct(a, g);
    node.style.width = aplPct(b - a + 1, g);
  };
  const up = async () => {
    node.removeEventListener('pointermove', move);
    node.removeEventListener('pointerup', up);
    node.removeEventListener('pointercancel', up);
    node.classList.remove('is-dragging');
    aplSelected = task.id;
    if (!delta) return rerender();
    const targets = task.derived ? kidsOf(task.id) : [task];
    const items = targets.map((t) => ({ id: t.id, ...aplShift(t, mode, delta, g) }))
      .filter((item, i) => item.startDate !== targets[i].start_date || item.endDate !== targets[i].end_date);
    try {
      if (items.length) await api(`/api/act/${encodeURIComponent(activity)}/tasks/dates`, { method: 'PATCH', body: { year: aplYear, items } });
    } catch (err) {
      onErr(err);
    }
    rerender();
  };
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', up);
}

// units: the activity's projects (SMF) · a main item picks one, a sub item follows its main item.
function aplOpenForm(activity, tasks, task, parentId, rerender, units = []) {
  const unitOfPhase = (p) => p.unit || units.find((u) => u.code?.toLowerCase() === p.title?.trim().toLowerCase() || u.name?.trim().toLowerCase() === p.title?.trim().toLowerCase())?.code || '';
  const canHaveKids = (p) => {
    const uCode = unitOfPhase(p);
    const proj = units.find((u) => u.code === uCode);
    return !proj || proj.team_type !== 'individual';
  };
  const phases = tasks.filter((t) => t.parent_id == null && (!task || t.id !== task.id) && canHaveKids(t)).sort((a, b) => a.sort_no - b.sort_no);
  const pid = task ? task.parent_id : parentId;
  const derived = Boolean(task?.derived);
  const base = aplView === 'month' ? new Date(aplYear, aplMonth, 1) : new Date(aplYear, aplYear === new Date().getFullYear() ? new Date().getMonth() : 0, 1);
  const range = `min="${aplYear}-01-01" max="${aplYear + 1}-12-31"`;
  const start = task ? task.start_date || '' : actIso(base);
  const end = task ? task.end_date || '' : actIso(actAddDays(base, 13));
  let ownerId = task?.owner_id || '';
  const color = task?.color || 'p5';
  const kidCount = task ? tasks.filter((t) => t.parent_id === task.id).length : 0;
  const curUnit = task ? (task.unit || units.find((u) => u.code.toLowerCase() === task.title?.trim().toLowerCase() || u.name.trim().toLowerCase() === task.title?.trim().toLowerCase())?.code || '') : aplUnit;
  const fields = [
    // Said first: a main item with sub items takes its dates and % from them, so those fields are locked here.
    derived ? `<p class="apl-locked">ข้อหลักนี้มีข้อรอง ${kidCount} ข้อ: วันเริ่ม วันจบ และ % คิดจากข้อรองให้อัตโนมัติ · แก้วันหรือ % ที่ข้อรอง (ดับเบิลคลิกแถวข้อรอง) หรือลากแท่งข้อหลักเพื่อเลื่อนทั้งชุด · ที่นี่แก้ได้: ชื่อ ผู้รับผิดชอบ สี รายละเอียด</p>` : '',
    field('ระดับ', `<select id="apl-parent"${derived ? ' disabled' : ''}><option value="">ข้อหลัก</option>${phases.map((p) => `<option value="${p.id}"${p.id === pid ? ' selected' : ''}>ข้อรองของ: ${esc(p.title)}</option>`).join('')}</select>`),
    units.length ? `<div id="apl-unit-wrap">${field('โครงการ', `<select id="apl-unit-f">${options(['', ...units.map((u) => u.code)], curUnit, (v) => (v ? units.find((u) => u.code === v)?.name || v : 'ไม่ระบุโครงการ'))}</select>`)}</div>` : '',
    field('ชื่อรายการ', `<input id="apl-title" maxlength="200" value="${esc(task?.title || '')}">`),
    a5EmpField('ผู้รับผิดชอบ', ownerId ? `${ownerId} · ${task.owner_name}` : ''),
    field('วันเริ่ม', `<input id="apl-start" type="date" ${range} value="${esc(start)}"${derived ? ' disabled' : ''}>`),
    field('วันจบ', `<input id="apl-end" type="date" ${range} value="${esc(end)}"${derived ? ' disabled' : ''}>`),
    field(`ความคืบหน้า <span id="apl-pct-v">${task?.progress ?? 0}%</span>`, `<input id="apl-pct" type="range" min="0" max="100" step="5" value="${task?.progress ?? 0}"${derived ? ' disabled' : ''}>`),
    `<div id="apl-done-wrap">${field('วันที่ทำเสร็จ (100%)', `<input id="apl-done" type="date" value="${esc(task?.done_on || actIso(new Date()))}">`)}<p class="sum-meta">ใช้เทียบกับวันจบ: เสร็จก่อนแผน / ตามแผน / เสร็จช้า</p></div>`,
    `<div id="apl-color-wrap">${field('สีข้อหลัก', `<div class="apl-swatches">${Object.entries(APL_COLORS).map(([key, hex]) => `<label class="apl-swatch" style="--bar:${hex}"><input type="radio" name="apl-color" value="${key}"${key === color ? ' checked' : ''}><span></span></label>`).join('')}</div>`)}</div>`,
    field('รายละเอียด', `<textarea id="apl-note" rows="2" maxlength="2000">${esc(task?.note || '')}</textarea>`),
    derived ? '' : `<p class="sum-meta">วางแผนได้ถึง ธ.ค. ${aplYear + 1} · ข้อหลักเว้นวันว่างได้ ข้อรองต้องมีวันเริ่มและวันจบ</p>`
  ].join('');
  const title = task ? 'แก้ไขรายการ' : pid ? 'เพิ่มข้อรอง' : 'สร้างข้อหลัก';
  openPopup(title, fields, async () => {
    const body = {
      year: aplYear,
      title: $('apl-title').value.trim(),
      parentId: $('apl-parent').value || null,
      ownerId,
      note: $('apl-note').value.trim(),
      color: document.querySelector('[name="apl-color"]:checked')?.value,
      unit: $('apl-unit-f')?.value || null,
      startDate: $('apl-start').value,
      endDate: $('apl-end').value,
      progress: Number($('apl-pct').value),
      doneOn: Number($('apl-pct').value) >= 100 ? $('apl-done').value : ''
    };
    if (!body.title) throw new Error('ระบุชื่อรายการ');
    if (body.parentId && (!body.startDate || !body.endDate)) throw new Error('ข้อรองต้องมีวันเริ่มและวันจบ');
    if (body.startDate && body.endDate && body.endDate < body.startDate) throw new Error('วันจบต้องไม่ก่อนวันเริ่ม');
    const path = `/api/act/${encodeURIComponent(activity)}/tasks${task ? `/${task.id}` : ''}`;
    const saved = await api(path, { method: task ? 'PATCH' : 'POST', body });
    if (!task && saved?.id) aplSelected = saved.id;
    if (body.parentId) aplCollapsed.delete(Number(body.parentId));
    // The finish date needs mt_<act>_task.done_on: the server says which SQL to run when it is missing.
    toast(saved?.warn || 'บันทึกแล้ว', saved?.warn ? 'error' : undefined);
    closePopup();
    rerender();
  });
  const syncColor = () => {
    $('apl-color-wrap').hidden = Boolean($('apl-parent').value);
    if ($('apl-unit-wrap')) $('apl-unit-wrap').hidden = Boolean($('apl-parent').value);
  };
  $('apl-parent').onchange = syncColor;
  syncColor();
  const syncDone = () => { $('apl-done-wrap').hidden = derived || Number($('apl-pct').value) < 100; };
  $('apl-pct').oninput = () => { $('apl-pct-v').textContent = `${$('apl-pct').value}%`; syncDone(); };
  syncDone();
  a5EmployeeSearch(activity, (p) => { ownerId = p.employeeId; }, aplYear);
  $('a5-emp-q').closest('.search-block').addEventListener('pick-clear', () => { ownerId = ''; });
}

let aplMoveKeys = null;
const APL_DASH_TABS = { schedule: 'Schedule', team: 'Team' };
// SMF Dashboard opens on ภาพรวม of its own projects of the year (Smart OEE, Vision Camera, Work Flow Automation);
// the overview of every activity (5S · CFO · SMF) is the home page (ผู้ใช้กำหนด 2026-11-01).
const APL_DASH_TABS_OF = { smf: { intro: 'Introduction', overview: 'ภาพรวม', ...APL_DASH_TABS } };
const APL_SET_TABS = { team: 'Team', plan: 'Plan' }; // English names (ผู้ใช้กำหนด 2026-11-03)
// SMF: its projects of the year come between ทีม and แผนงาน (ผู้ใช้กำหนด 2026-11-01)
const APL_SET_TABS_OF = { smf: { team: 'Team', project: 'Project', plan: 'Plan', intro: 'Introduction' } };
const APL_PROJECTS_ON = ['smf'];
const APL_ROLE_LABEL = { ...ACT_TEAM_ROLES, auditor: 'ผู้ตรวจประเมิน' };
// Team per activity (ผู้ใช้กำหนด 2026-10-29, docs/specs/act-teams.md); others use APL_ROLE_LABEL.
// SMF = Smart Factory: Smart Team manages Setting (server accessOf), ที่ปรึกษา views.
const APL_ROLE_LABELS = { smf: { chairman: 'ประธาน', vice: 'รองประธาน', advisor: 'ที่ปรึกษา', admin: 'ผู้ประสานงาน', smart: 'Smart Team', member: 'สมาชิกหลัก' } };
const aplRolesOf = (activity) => APL_ROLE_LABELS[activity] || APL_ROLE_LABEL;
const aplDashTab = {};
const aplSetTab = {};

async function aplDashboard(target, activity) {
  const me = await a5Api(activity, `me?year=${a5Year}`);
  const tabs = APL_DASH_TABS_OF[activity] || APL_DASH_TABS;
  const tab = tabs[aplDashTab[activity]] ? aplDashTab[activity] : Object.keys(tabs)[0];
  target.innerHTML = `<div class="view-body"><section class="card">
    ${pageBar(a5Pick('data-apldash', tabs, tab), `<div class="a5-year">${a5YearSelect(me.years)}</div>`, 'a5')}
    <div id="a5-body"><div class="empty">กำลังโหลด...</div></div>
  </section></div>`;
  const rerender = () => aplDashboard(target, activity).catch(onErr);
  target.querySelectorAll('[data-apldash]').forEach((node) => {
    node.onclick = () => { aplDashTab[activity] = node.dataset.apldash; rerender(); };
  });
  if ($('a5-year')) $('a5-year').onchange = () => { a5Year = Number($('a5-year').value); rerender(); };
  const body = $('a5-body');
  if (tab === 'intro') return aplDrawIntro(body, activity);
  if (tab === 'overview') return aplDrawSmfOverview(body, activity);
  if (tab === 'team') return aplDrawTeam(body, activity, me.access.admin);
  return aplRender(body, activity, { inPage: true, readOnly: true });
}

// Dashboard > Introduction (ผู้ใช้กำหนด 2026-11-04): the introduction of the year read like a book — one page at a time,
// turned from the left edge · buttons, ← → keys, a click on the right / left half, or a swipe. The pages are uploaded in
// Setting > Introduction (images, or a PDF the browser turns into images; server smf.js intro) · a year without pages shows
// the latest year before it, and with none at all the PDF that came with the app (TSAT4-SMF 2569-001, rendered by PDF.js).
const APL_INTRO = { smf: { file: 'docs/smf-intro-2569-001.pdf', title: 'TSAT4-SMF 2569-001' } };
// PDF.js from cdnjs (loaded the first time); its worker is cross-origin, so it runs from a blob
let aplPdf = null;
const aplLoadPdf = () => aplPdf || (aplPdf = new Promise((resolve, reject) => {
  const base = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  const tag = document.createElement('script');
  tag.src = `${base}pdf.min.js`;
  tag.onload = async () => {
    try {
      const worker = await (await fetch(`${base}pdf.worker.min.js`)).text();
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([worker], { type: 'text/javascript' }));
      resolve(window.pdfjsLib);
    } catch (err) { aplPdf = null; reject(err); }
  };
  tag.onerror = () => { aplPdf = null; reject(new Error('โหลดตัวอ่าน PDF ไม่ได้ ลองใหม่อีกครั้ง')); };
  document.head.append(tag);
}));
// each page of a PDF (File or URL) drawn on a canvas `width` px wide
async function aplPdfPages(source, width) {
  const pdfjs = await aplLoadPdf();
  const pdf = await pdfjs.getDocument(typeof source === 'string' ? source : { data: await source.arrayBuffer() }).promise;
  const out = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const view = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(view.width);
    canvas.height = Math.round(view.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: view }).promise;
    out.push(canvas);
  }
  return out;
}
let aplBookKeys = null;
async function aplDrawIntro(body, activity) {
  const d = await a5Api(activity, `intro?year=${a5Year}`);
  const doc = APL_INTRO[activity];
  body.innerHTML = `<div class="apl-book">
    <div class="apl-book-stage" id="apl-book"><div class="empty">กำลังเปิดเอกสาร...</div></div>
    <div class="apl-book-bar">
      <button class="icon-btn" type="button" id="apl-book-prev" aria-label="หน้าก่อน" title="หน้าก่อน"><span class="material-symbols-rounded">chevron_left</span></button>
      <span id="apl-book-no" class="sum-meta"></span>
      <button class="icon-btn" type="button" id="apl-book-next" aria-label="หน้าถัดไป" title="หน้าถัดไป"><span class="material-symbols-rounded">chevron_right</span></button>
      <button class="icon-btn" type="button" id="apl-book-full" aria-label="เต็มจอ" title="เต็มจอ (Esc = ออก)"><span class="material-symbols-rounded">fullscreen</span></button>
      ${d.pages.length ? (d.shown !== a5Year ? `<span class="sum-meta">ฉบับปี ${d.shown}</span>` : '') : doc ? `<a class="apl-link" href="${doc.file}" target="_blank" rel="noopener">เปิด PDF</a>` : ''}
    </div></div>`;
  const stage = $('apl-book');
  let pages;
  if (d.pages.length) {
    pages = await Promise.all(d.pages.map((url, i) => new Promise((resolve) => {
      const img = new Image();
      img.alt = `หน้า ${i + 1}`;
      img.onload = () => resolve(img);
      img.onerror = () => resolve(img);
      img.src = url;
    })));
  } else if (doc) {
    pages = await aplPdfPages(doc.file, Math.min(2400, stage.clientWidth * (window.devicePixelRatio || 1)));
  } else {
    stage.innerHTML = '<div class="empty">ยังไม่มีเอกสาร Introduction · ผู้ดูแลอัปโหลด PDF หรือรูปได้ที่ Setting > Introduction</div>';
    $('apl-book-no').closest('.apl-book-bar').classList.add('d-none');
    return;
  }
  if (!document.body.contains(stage)) return;
  const first = pages[0];
  stage.style.setProperty('--ratio', (first.naturalWidth || first.width) / (first.naturalHeight || first.height) || 16 / 9);
  stage.innerHTML = '';
  pages.forEach((p) => { p.classList.add('apl-page'); stage.append(p); });
  let at = 0;
  let busy = false;
  const show = () => {
    pages.forEach((p, i) => p.classList.toggle('is-on', i === at));
    $('apl-book-no').textContent = `หน้า ${at + 1} / ${pages.length}`;
    $('apl-book-prev').disabled = at === 0;
    $('apl-book-next').disabled = at === pages.length - 1;
  };
  // next: this page turns away to the left over the next one · back: the page before turns in over this one
  const turn = (step) => {
    const to = at + step;
    if (busy || to < 0 || to >= pages.length) return;
    busy = true;
    const moving = step > 0 ? pages[at] : pages[to];
    const under = step > 0 ? pages[to] : pages[at];
    under.classList.add('is-on');
    moving.classList.add(step > 0 ? 'turn-out' : 'turn-in');
    moving.addEventListener('animationend', () => {
      moving.classList.remove('turn-out', 'turn-in');
      at = to;
      busy = false;
      show();
    }, { once: true });
  };
  show();
  // เต็มจอ (ผู้ใช้กำหนด 2026-11-04): the whole book, Esc or the button again leaves
  const book = stage.closest('.apl-book');
  $('apl-book-full').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : book.requestFullscreen?.())?.catch?.(() => null);
  book.onfullscreenchange = () => { $('apl-book-full').firstElementChild.textContent = document.fullscreenElement ? 'fullscreen_exit' : 'fullscreen'; };
  $('apl-book-prev').onclick = () => turn(-1);
  $('apl-book-next').onclick = () => turn(1);
  stage.onclick = (e) => turn(e.offsetX > stage.clientWidth / 2 ? 1 : -1);
  let x0 = null;
  stage.onpointerdown = (e) => { x0 = e.clientX; };
  stage.onpointerup = (e) => { if (x0 != null && Math.abs(e.clientX - x0) > 40) { e.preventDefault(); turn(e.clientX < x0 ? 1 : -1); } x0 = null; };
  if (aplBookKeys) document.removeEventListener('keydown', aplBookKeys);
  aplBookKeys = (e) => {
    if (!document.body.contains(stage)) { document.removeEventListener('keydown', aplBookKeys); aplBookKeys = null; return; }
    if (e.key === 'ArrowRight') turn(1);
    if (e.key === 'ArrowLeft') turn(-1);
  };
  document.addEventListener('keydown', aplBookKeys);
}

// Setting > Introduction: upload the pages of a year — images (in the order chosen) or a PDF (each page becomes an image)
// · JPEG 1600 px wide, smaller quality until ≤ 680 KB · sent 4 pages a request (first replaces the year, then appends)
// · at most APL_INTRO_MAX pages a year (ผู้ใช้กำหนด 2026-11-08), counted before any page is drawn; the server checks it too
const APL_INTRO_W = 1600;
const APL_INTRO_MAX = 5;
const aplJpeg = (canvas) => {
  for (const q of [0.85, 0.75, 0.65, 0.55, 0.45]) {
    const url = canvas.toDataURL('image/jpeg', q);
    if (url.length * 0.75 < 680000) return url;
  }
  throw new Error('หน้าเอกสารใหญ่เกินไป');
};
const aplImageCanvas = (file) => new Promise((resolve, reject) => {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    const scale = Math.min(1, APL_INTRO_W / img.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    resolve(canvas);
  };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`เปิดรูป ${file.name} ไม่ได้`)); };
  img.src = url;
});
async function aplSetIntro(body, activity, admin, rerender) {
  const d = await a5Api(activity, `intro?year=${a5Year}`);
  const own = d.shown === a5Year;
  body.innerHTML = `
    ${admin ? `<div class="apl-intro-up">
      ${field(`ไฟล์ปี ${a5Year}: PDF หรือรูป ไม่เกิน ${APL_INTRO_MAX} หน้า (เรียงหน้าตามชื่อไฟล์)`, '<input id="apl-intro-file" type="file" accept="application/pdf,image/*" multiple>')}
      ${button('apl-intro-up', 'อัปโหลด', 'primary', 'disabled')}${own ? button('apl-intro-del', `ลบฉบับปี ${a5Year}`, 'danger') : ''}
    </div>` : ''}
    <p class="sum-meta" id="apl-intro-note">${own ? `ปี ${a5Year} มี ${d.pages.length} หน้า · อัปโหลดใหม่ = แทนที่ทั้งชุด` : d.shown ? `ปี ${a5Year} ยังไม่มี Dashboard แสดงฉบับปี ${d.shown} (${d.pages.length} หน้า)` : (APL_INTRO[activity] ? 'ยังไม่มีเอกสารที่อัปโหลด Dashboard แสดง PDF ที่มากับระบบ' : 'ยังไม่มีเอกสาร เลือกไฟล์ PDF หรือรูปแล้วกด อัปโหลด')}</p>
    <div class="apl-intro-thumbs">${d.pages.map((url, i) => `<figure><img src="${esc(url)}" alt="หน้า ${i + 1}" loading="lazy"><figcaption>${i + 1}</figcaption></figure>`).join('')}</div>`;
  if (!admin) return;
  const pick = $('apl-intro-file');
  pick.onchange = () => { $('apl-intro-up').disabled = !pick.files.length; };
  $('apl-intro-up').onclick = async () => {
    const files = [...pick.files];
    const btn = $('apl-intro-up');
    btn.disabled = true;
    try {
      const note = (text) => { $('apl-intro-note').textContent = text; };
      // a PDF gives its pages; images are pages in the order of their file names
      const canvases = [];
      const pdfs = files.filter((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
      let count = files.length - pdfs.length;
      if (pdfs.length) {
        const pdfjs = await aplLoadPdf();
        for (const f of pdfs) count += (await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise).numPages;
      }
      if (count > APL_INTRO_MAX) throw new Error(`อัปโหลดได้ไม่เกิน ${APL_INTRO_MAX} หน้า (ไฟล์ที่เลือกมี ${count} หน้า)`);
      for (const f of pdfs) { note(`กำลังแปลง ${f.name} เป็นรูป...`); canvases.push(...await aplPdfPages(f, APL_INTRO_W)); }
      for (const f of files.filter((x) => !pdfs.includes(x)).sort((a, b) => a.name.localeCompare(b.name, 'th', { numeric: true }))) canvases.push(await aplImageCanvas(f));
      if (!canvases.length) throw new Error('เลือกไฟล์ PDF หรือรูปก่อน');
      const pages = canvases.map(aplJpeg);
      for (let i = 0; i < pages.length; i += 4) {
        note(`กำลังอัปโหลดหน้า ${i + 1}–${Math.min(pages.length, i + 4)} จาก ${pages.length}...`);
        await a5Api(activity, 'intro', { method: 'POST', body: { year: a5Year, pages: pages.slice(i, i + 4), mode: i ? 'append' : 'replace' } });
      }
      toast(`อัปโหลด ${pages.length} หน้าแล้ว`);
      rerender();
    } catch (err) {
      btn.disabled = false;
      onErr(err);
    }
  };
  if ($('apl-intro-del')) $('apl-intro-del').onclick = () => confirmPopup('ลบเอกสาร', `ลบเอกสาร Introduction ปี ${a5Year} ทั้ง ${d.pages.length} หน้า`, async () => {
    await a5Api(activity, `intro/${a5Year}`, { method: 'DELETE' });
    toast('ลบแล้ว');
    rerender();
  });
}

// หน้าหลัก = ภาพรวมกิจกรรมในโรงงาน (server: server/modules/act/overview.js): KPIs of every activity, then one card per
// activity (5S · CFO · SMF) with plan progress · key results · team · open problems, and a link to its Dashboard.
const OV_PLAN = [['early', 'เสร็จก่อนแผน'], ['done', 'เสร็จ'], ['ahead', 'เร็วกว่าแผน'], ['ontrack', 'ตามแผน'], ['behind', 'ช้ากว่าแผน'], ['late', 'เสร็จช้า'], ['overdue', 'เลยกำหนด'], ['waiting', 'ยังไม่ถึง']];
// progress bars: red below 50%, yellow up to 99%, green at 100% (ผู้ใช้กำหนด 2026-11-05)
const ovTone = (pct) => (pct >= 100 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444');
const ovBar = (pct) => `<div class="ov-bar"><span style="width:${Math.min(100, pct)}%;background:${ovTone(pct)}"></span></div>`;
// a project measured by count (Work Flow, 12 โครงการ): the items of its plan at 100% against the target, not the plan's average
const ovCount = (u, plan) => {
  const target = u.target_count || 10;
  const done = plan?.completedCount || 0;
  return { target, done, percent: Math.min(100, Math.round((done / target) * 100)) };
};
const OV_UNIT_LABEL = { '5s': { standard: 'ทีมมาตรฐาน', academic: 'ทีมวิชาการ', pr: 'ทีมประชาสัมพันธ์', audit: 'ทีมตรวจประเมิน' } };
const ovNum = (n, d = 0) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: d, minimumFractionDigits: d });

async function aplDrawOverview(body) {
  const data = await api(`/api/act/overview?year=${a5Year}`);
  const ps = data.projects;
  const plans = ps.filter((p) => p.plan?.items);
  const sumOf = (fn) => ps.reduce((s, p) => s + (fn(p) || 0), 0);
  const kpis = [
    chartKpi({ label: 'ความคืบหน้าแผนรวม', value: plans.length ? Math.round(plans.reduce((s, p) => s + p.plan.percent, 0) / plans.length) : 0, unit: '%', pie: plans.length ? plans.reduce((s, p) => s + p.plan.percent, 0) / plans.length : 0, note: `${plans.length} โครงการที่มีแผนงาน`, color: CHART.series[0] }),
    chartKpi({ label: 'รายการแผนเลยกำหนด', value: ovNum(sumOf((p) => p.plan?.overdue)), unit: 'รายการ', icon: 'event_busy', note: 'ทุกโครงการ', color: CHART.series[2] }),
    chartKpi({ label: 'Issue 5ส ที่ยังเปิด', value: ovNum(sumOf((p) => p.results?.openIssues)), unit: 'รายการ', icon: 'report', note: `เลยกำหนด ${ovNum(sumOf((p) => p.results?.overdueIssues))}`, color: CHART.series[1] }),
    chartKpi({ label: 'คนในทีมทุกโครงการ', value: ovNum(sumOf((p) => p.team?.people)), unit: 'คน', icon: 'groups', note: `ปี ${data.year} · คนเดียวอยู่หลายโครงการนับแยก`, color: CHART.series[3] })
  ].join('');
  const row = (label, value) => `<div class="ov-row"><span>${esc(label)}</span><b>${value}</b></div>`; // label = text (SMF project name)
  const section = (title, html) => `<div class="ov-sec"><div class="ov-sec-title">${title}</div>${html}</div>`;
  // SMF: one line per project of the year (progress bar · items · overdue · team)
  const projectHtml = (p) => {
    const list = (p.projects || []).filter((u) => u.status === 'Active');
    if (!list.length) return '';
    return list.map((u) => {
      const plan = p.plan?.byUnit?.[u.code];
      const team = p.team?.units?.[u.code] || 0;
      const count = u.target_type === 'count' ? ovCount(u, plan) : null;
      const pct = count ? count.percent : plan?.percent || 0;
      return `<div class="ov-proj"><div class="ov-proj-name">${esc(u.name)}</div><div class="ov-progress">${ovBar(pct)}<b>${pct}%</b></div>
        <div class="sum-meta">${count ? `สำเร็จ ${count.done} จากเป้าหมาย ${count.target} ${esc(u.unit || 'โครงการ')}` : plan ? `${plan.items} หัวข้อ${plan.overdue ? ` · <span class="ov-bad">เลยกำหนด ${plan.overdue}</span>` : ''}` : 'ยังไม่มีแผน'} · ทีม ${team} คน</div></div>`;
    }).join('');
  };
  const planHtml = (p) => {
    if (!p.plan) return '<p class="sum-meta">ไม่มีแผนงาน (Project Planner)</p>';
    if (!p.plan.items) return '<p class="sum-meta">ยังไม่มีรายการแผนปีนี้</p>';
    const chips = OV_PLAN.filter(([code]) => p.plan.counts[code]).map(([code, label]) => `<span class="ov-chip is-${code}">${label} ${p.plan.counts[code]}</span>`).join('');
    return `<div class="ov-progress">${ovBar(p.plan.percent)}<b>${p.plan.percent}%</b></div>
      <div class="ov-chips">${chips}</div><p class="sum-meta">${p.plan.items} หัวข้อหลัก</p>`;
  };
  const resultHtml = (p) => {
    const r = p.results;
    if (p.activity === '5s' && r) return row('คะแนนเฉลี่ยทั้งปี', `${ovNum(r.score, 1)}%`) + row('ใบตรวจปีนี้', `${ovNum(r.audits)} (Self ${ovNum(r.self)} · Committee ${ovNum(r.committee)})`)
      + row(`${ACT_MONTHS[r.month - 1]}`, `ตรวจแล้ว ${ovNum(r.monthAudits)} ใบ`) + row('Self Audit ค้างเดือนนี้', `${ovNum(r.selfDue)} / ${ovNum(r.areas)} พื้นที่`);
    if (p.activity === 'cfo' && r) {
      const pill = r.compareSame ? chartPill(r.total, r.compareSame, ` จากปี ${r.compareYear}`) : '';
      return row('tCO₂e ปีนี้', `${ovNum(r.total, 3)}`) + row('บันทึกแล้ว', `${r.months} เดือน`)
        + row(`ปี ${r.compareYear} เดือนเดียวกัน`, r.compareSame ? ovNum(r.compareSame, 3) : '-') + row(`เป้า (ลด ${r.target}%)`, r.compareSame ? ovNum(r.targetSame, 3) : '-') + (pill ? `<div class="ov-pill">${pill}</div>` : '');
    }
    if (p.plan?.items) return row('หัวข้อแผนงาน', ovNum(p.plan.items)) + row('ความคืบหน้า', `${p.plan.percent}%`);
    return '<p class="sum-meta">ยังไม่มีข้อมูล</p>';
  };
  const teamHtml = (p) => {
    if (!p.team) return '<p class="sum-meta">ยังไม่ได้สร้างตารางทีม</p>';
    const labels = OV_UNIT_LABEL[p.activity] || {};
    const names = Object.fromEntries((p.projects || []).map((u) => [u.code, u.name]));
    const units = Object.entries(p.team.units).map(([u, n]) => row(labels[u] || names[u] || u, `${n} คน`)).join('');
    const memberLabel = actRoleLabel(p.activity, 'member', '');
    return row('ทั้งหมด', `${ovNum(p.team.people)} คน`) + row('คณะกรรมการ', `${ovNum(p.team.committee)} คน`)
      + (p.team.smart ? row('Smart Team', `${p.team.smart} คน`) : '') + (p.team.members ? row(memberLabel, `${p.team.members} คน`) : '') + units;
  };
  const problemHtml = (p) => {
    const r = p.results;
    const list = p.plan?.late?.length ? `<ul class="ov-late">${p.plan.late.map((t) => `<li><span>${esc(actNoLead(t.title))}</span><b>${actShort(t.end)} · ${t.progress}%</b></li>`).join('')}</ul>` : '';
    return (p.activity === '5s' && r ? row('Issue ที่ยังเปิด', ovNum(r.openIssues)) + row('Issue เลยกำหนด', `<span class="${r.overdueIssues ? 'ov-bad' : ''}">${ovNum(r.overdueIssues)}</span>`) : '')
      + (p.plan ? row('แผนเลยกำหนด', `<span class="${p.plan.overdue ? 'ov-bad' : ''}">${ovNum(p.plan.overdue)}</span>`) : '') + list || '<p class="sum-meta">ไม่มี</p>';
  };
  const cards = ps.map((p) => `<article class="card ov-card" style="--ov:${actColor(p.activity)}">
      <div class="ov-head"><strong>${esc(actLabel(p.activity))}</strong><span class="sum-meta">${p.activity === 'smf' ? 'Smart Factory' : p.activity === 'cfo' ? 'Carbon Footprint for Organization' : '5ส'}</span>${button('', 'เปิด Dashboard', 'secondary', `data-ov-go="${p.activity}-home"`)}</div>
      ${section('ความคืบหน้าแผนงาน', planHtml(p))}${projectHtml(p) ? section(`โครงการปี ${data.year}`, projectHtml(p)) : ''}${section('ผลลัพธ์หลัก', resultHtml(p))}${section('ทีม', teamHtml(p))}${section('ปัญหา / เลยกำหนด', problemHtml(p))}
    </article>`).join('');
  body.innerHTML = `<div class="ch-kpis">${kpis}</div><div class="ov-grid">${cards}</div><p class="sum-meta">ข้อมูล ณ ${actShort(data.today)} ${data.year}</p>`;
  body.querySelectorAll('[data-ov-go]').forEach((node) => { node.onclick = () => openView(node.dataset.ovGo); });
  a5Lift(body);
}

// { '': committee, code: name } of the year's projects, or null when the activity has none (a5SetTeam unitsIn).
async function aplUnitsOf(activity) {
  if (!APL_PROJECTS_ON.includes(activity)) return null;
  const { projects } = await a5Api(activity, `projects?year=${a5Year}`);
  return { '': `คณะกรรมการ ${actLabel(activity)}`, ...Object.fromEntries(projects.filter((p) => p.status === 'Active').map((p) => [p.code, p.name])) };
}

// Setting > โครงการ (SMF): the year's projects, add / edit / delete, copy from last year.
async function aplSetProjects(body, activity, admin, rerender) {
  const { projects } = await a5Api(activity, `projects?year=${a5Year}`);
  let picked = null;
  body.innerHTML = `
    ${admin ? `<div class="action-bar a5-actions">${button('apl-p-add', 'เพิ่มโครงการ', 'primary')}${button('apl-p-edit', 'แก้ไข', 'secondary', 'disabled')}${button('apl-p-del', 'ลบ', 'danger', 'disabled')}${button('apl-p-copy', `คัดลอกจากปี ${a5Year - 1}`)}</div>` : ''}
    <div class="table-wrap sheet" id="apl-p-rows"></div>
    <p class="sum-meta">${projects.length} โครงการ ปี ${a5Year} · แต่ละโครงการกำหนดรูปแบบ (ทีม/เดี่ยว) การวัดเป้าหมาย (ตามแผน/ตามจำนวน) แผนงาน และเป้าหมาย/ผลงานรายเดือน (Transaction)</p>`;
  fillTable('apl-p-rows', ['ลำดับ', 'รหัส', 'ชื่อโครงการ', 'รูปแบบ', 'การวัดเป้าหมาย', 'เป้าหมาย (KPI)', 'หน่วย', 'สถานะ'], projects.map((p) => {
    const isCount = p.target_type === 'count';
    const tgt = isCount ? `ตามจำนวน (${p.target_count || '-'} ${esc(p.unit || 'โครงการ')})` : 'ตามแผน (ระยะเวลา)';
    const teamBadge = `<span class="badge ${p.team_type === 'individual' ? '' : 'badge-primary'}">${p.team_type === 'individual' ? 'เดี่ยว' : 'ทีม'}</span>`;
    const tgtBadge = `<span class="badge ${isCount ? 'badge-success' : ''}">${tgt}</span>`;
    return `<tr data-pick="${p.id}"><td>${p.sort_no}</td><td>${esc(p.code)}</td><td>${esc(p.name)}</td><td>${teamBadge}</td><td>${tgtBadge}</td><td>${esc(p.target_name || '-')}</td><td>${esc(p.unit || '-')}</td><td>${esc(p.status)}</td></tr>`;
  }).join(''), `ยังไม่มีโครงการปี ${a5Year}`);
  a5Lift(body);
  if (!admin) return;
  bindRowSelect($('apl-p-rows'), (id) => { picked = projects.find((p) => String(p.id) === id); $('apl-p-edit').disabled = !picked; $('apl-p-del').disabled = !picked; });
  const form = (p) => {
    const isCount = (p?.target_type || (p?.code === 'workflow' ? 'count' : 'plan')) === 'count';
    openPopup(p ? `แก้ไขโครงการ ${esc(p.name)}` : 'เพิ่มโครงการ', [
      field('ปีที่ทำโครงการ', `<select id="apl-p-year">${options([...new Set([new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1, new Date().getFullYear() + 2, a5Year])].sort().map(String), String(a5Year))}</select>`),
      field('ชื่อโครงการ', `<input id="apl-p-name" maxlength="120" value="${esc(p?.name || '')}" placeholder="เช่น Smart OEE">`),
      field('รหัส (a–z 0–9 ใช้ผูกทีมและแผน)', `<input id="apl-p-code" maxlength="20" value="${esc(p?.code || '')}" placeholder="เช่น oee">`),
      field('รูปแบบโครงการ', `<select id="apl-p-team-type"><option value="team"${(p?.team_type || 'team') === 'team' ? ' selected' : ''}>ทำเป็นทีม (Team)</option><option value="individual"${p?.team_type === 'individual' ? ' selected' : ''}>ทำเดี่ยว (Individual)</option></select>`),
      field('การวัดเป้าหมาย', `<select id="apl-p-target-type"><option value="plan"${!isCount ? ' selected' : ''}>วัดตามแผนงาน (ระยะเวลา / Milestone)</option><option value="count"${isCount ? ' selected' : ''}>วัดตามจำนวนโครงการ (Count / Quantity)</option></select>`),
      `<div id="apl-p-count-wrap" class="${isCount ? '' : 'd-none'}">${field('เป้าหมายจำนวนโครงการ', `<input id="apl-p-target-count" type="number" min="1" value="${p?.target_count || (p?.code === 'workflow' ? 10 : '')}" placeholder="เช่น 10">`)}</div>`,
      field('ชื่อเป้าหมาย (KPI)', `<input id="apl-p-target" maxlength="80" value="${esc(p?.target_name || '')}" placeholder="เช่น OEE, Accuracy, Time Saved, โครงการที่สำเร็จ">`),
      field('หน่วย', `<input id="apl-p-unit" maxlength="30" value="${esc(p?.unit || (isCount ? 'โครงการ' : ''))}" placeholder="เช่น %, ชม., โครงการ">`),
      field('ลำดับ', `<input id="apl-p-sort" type="number" min="1" value="${p?.sort_no || projects.length + 1}">`),
      field('สถานะ', `<select id="apl-p-status">${options(['Active', 'Inactive'], p?.status || 'Active')}</select>`)
    ].join(''), async () => {
      const targetType = $('apl-p-target-type').value;
      const year = Number($('apl-p-year').value);
      const payload = {
        year,
        name: $('apl-p-name').value,
        code: $('apl-p-code').value,
        teamType: $('apl-p-team-type').value,
        targetType,
        targetCount: targetType === 'count' ? Number($('apl-p-target-count').value) || null : null,
        targetName: $('apl-p-target').value,
        unit: $('apl-p-unit').value,
        sortNo: Number($('apl-p-sort').value),
        status: $('apl-p-status').value
      };
      await a5Api(activity, p ? `projects/${p.id}` : 'projects', { method: p ? 'PATCH' : 'POST', body: payload });
      toast(year === a5Year ? 'บันทึกแล้ว' : `บันทึกในปี ${year} แล้ว`);
      closePopup();
      a5Year = year; // show the year it went to
      rerender();
    });
    $('apl-p-target-type').onchange = () => {
      const count = $('apl-p-target-type').value === 'count';
      $('apl-p-count-wrap').classList.toggle('d-none', !count);
      if (count && !$('apl-p-unit').value.trim()) $('apl-p-unit').value = 'โครงการ';
      if (count && !$('apl-p-target-count').value) $('apl-p-target-count').value = 10;
    };
  };
  $('apl-p-add').onclick = () => form(null);
  $('apl-p-edit').onclick = () => picked && form(picked);
  $('apl-p-del').onclick = () => picked && confirmPopup('ลบโครงการ', `ตรวจ ${esc(picked.name)} อีกครั้งก่อนลบ (ถ้ามีทีมหรือแผนงานแล้วจะเปลี่ยนเป็น Inactive แทน)`, async () => {
    const r = await a5Api(activity, `projects/${picked.id}`, { method: 'DELETE' });
    toast(r.inactive ? 'มีทีม / แผนงานแล้ว จึงเปลี่ยนเป็น Inactive' : 'ลบแล้ว');
    rerender();
  });
  $('apl-p-copy').onclick = () => confirmPopup('คัดลอกโครงการ', `คัดลอกรายชื่อโครงการปี ${a5Year - 1} มาเป็นปี ${a5Year} (รหัสที่มีอยู่แล้วไม่ซ้ำ)`, async () => {
    const r = await a5Api(activity, 'projects/copy', { method: 'POST', body: { from: a5Year - 1, to: a5Year } });
    toast(`คัดลอก ${r.copied} โครงการ`);
    rerender();
  }, 'คัดลอก');
}

async function aplDrawTeam(body, activity, admin) {
  let data;
  let units = null;
  try {
    [data, units] = await Promise.all([a5Api(activity, `team?year=${a5Year}`), aplUnitsOf(activity)]);
  } catch (err) {
    body.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
    return;
  }
  const active = (data.members || []).filter((m) => m.status === 'Active');
  const actName = actLabel(activity);
  const deckForUnit = (code, name, tone) => {
    const list = active.filter((m) => m.unit === code);
    const chair = list.find((m) => m.role === 'chairman');
    const vice = list.find((m) => m.role === 'vice');
    const members = list.filter((m) => !['chairman', 'vice'].includes(m.role));
    return actDeckTeamFrame({
      deckId: code,
      headHtml: `<div class="a5-team-head">${esc(name)}<span>${list.length} คน</span></div>`,
      tone,
      activity,
      unit: code,
      chair,
      vice,
      chairEmpty: 'หัวหน้าทีม',
      viceEmpty: 'รองหัวหน้าทีม',
      extraHtml: actDeckGrid(members, activity, code),
      extraCount: members.length
    });
  };
  const cardsOf = (keep) => (units ? Object.entries(units).filter(([code]) => code && keep(code)).map(([code, name], i) => deckForUnit(code, name, CHART.series[(i + 2) % CHART.series.length])).join('') : '');
  const projectCards = cardsOf((code) => code !== 'workflow');
  const workflowCards = cardsOf((code) => code === 'workflow');
  const top = units ? active.filter((m) => !m.unit) : active;
  const topChair = top.find((m) => m.role === 'chairman');
  const topVice = top.find((m) => m.role === 'vice');
  const topRest = top.filter((m) => !['chairman', 'vice'].includes(m.role));
  const committeeBlock = units && top.length ? actDeckTeamFrame({
    deckId: `${activity}-committee`,
    headHtml: `<div class="a5-team-head"><span class="material-symbols-rounded">groups</span>${esc(units[''])}<span>${top.length} คน</span></div>`,
    tone: CHART.series[0],
    activity,
    unit: '',
    chair: topChair,
    vice: topVice,
    chairEmpty: 'ประธาน',
    viceEmpty: 'รองประธาน',
    extraHtml: actDeckGrid(topRest, activity, ''),
    extraCount: topRest.length
  }) : (top.length ? `<div class="a5-team a5-team-deck is-wide">${actDeckGrid(top, activity, '')}</div>` : '');
  body.innerHTML = `
    ${admin ? `<div class="action-bar a5-actions">${button('apl-team-edit', 'แก้ไขทีม')}</div>` : ''}
    ${units ? `<div class="a5-team-title"><span class="material-symbols-rounded">groups</span>${esc(units[''])}</div><div class="a5-team-grid">${committeeBlock}</div>` : ''}
    ${projectCards ? `<div class="a5-team-title"><span class="material-symbols-rounded">account_tree</span>ทีม ${esc(actName)}</div><div class="a5-team-grid a5-unit-grid a5-unit-grid--auto">${projectCards}</div>` : ''}
    ${workflowCards ? `<div class="a5-team-title"><span class="material-symbols-rounded">group</span>สมาชิกทีมรอง</div><div class="a5-team-grid a5-unit-grid a5-unit-grid--auto">${workflowCards}</div>` : ''}
    <p class="sum-meta">โครงสร้างทีม ${esc(actName)} ปี ${a5Year} · ${active.length} รายชื่อ</p>`;
  actDeckBindToggles(body);
  a5Lift(body);
  if (admin && $('apl-team-edit')) $('apl-team-edit').onclick = () => {
    aplSetTab[activity] = 'team';
    openView(`${activity}-setting`);
  };
}

async function aplSetting(target, activity) {
  const me = await a5Api(activity, `me?year=${a5Year}`);
  const admin = me.access.admin;
  const tabs = APL_SET_TABS_OF[activity] || APL_SET_TABS;
  const tab = tabs[aplSetTab[activity]] ? aplSetTab[activity] : 'team';
  target.innerHTML = `<div class="view-body"><section class="card">
    ${pageBar(a5SetPick(tabs, tab), `<div class="a5-year">${a5YearSelect(me.years)}</div>`, 'a5')}
    <div id="a5-body"><div class="empty">กำลังโหลด...</div></div>
  </section></div>`;
  const rerender = () => aplSetting(target, activity).catch(onErr);
  $('a5-setpick').onchange = () => { aplSetTab[activity] = $('a5-setpick').value; rerender(); };
  if ($('a5-year')) $('a5-year').onchange = () => { a5Year = Number($('a5-year').value); rerender(); };
  const body = $('a5-body');
  if (tab === 'project') return aplSetProjects(body, activity, admin, rerender);
  if (tab === 'intro') return aplSetIntro(body, activity, admin, rerender);
  if (tab === 'team') {
    try {
      return await a5SetTeam(body, activity, admin, rerender, aplRolesOf(activity), await aplUnitsOf(activity));
    } catch (err) {
      body.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
      return;
    }
  }
  return aplRender(body, activity, { inPage: true });
}

const smfPickedProj = {};
const smfDiffPct = (tVal, aVal, bar = true) => {
  if (tVal == null || aVal == null || Number.isNaN(tVal) || Number.isNaN(aVal)) return ['-', '-'];
  const diff = aVal - tVal;
  const diffHtml = `<span class="${diff >= 0 ? 'ov-good' : 'ov-bad'}">${diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)}</span>`;
  if (tVal === 0) return [diffHtml, '-'];
  const pct = (aVal / tVal) * 100;
  const color = pct >= 100 ? '#10b981' : pct >= 80 ? '#f59e0b' : '#ef4444';
  return [diffHtml, `<b>${pct.toFixed(1)}%</b>${bar ? `<div class="ov-bar" style="height:4px;margin-top:2px"><span style="width:${Math.min(pct, 100)}%;background:${color}"></span></div>` : ''}`];
};

// SMF Transaction: บันทึกเป้าหมาย (target) และผลงาน (actual) รายเดือนของแต่ละโครงการ (ผู้ใช้กำหนด 2026-11-01)
async function smfTransaction(target, activity = 'smf') {
  let me, pmData;
  try {
    [me, pmData] = await Promise.all([a5Api(activity, `me?year=${a5Year}`), a5Api(activity, `project-months?year=${a5Year}`)]);
  } catch (err) {
    target.innerHTML = `<div class="view-body"><section class="card"><p class="empty">${esc(err.message)}</p></section></div>`;
    return;
  }
  const canEdit = !!(me.access?.admin || me.access?.member || me.access?.smart);
  const projects = (pmData.projects || []).filter((p) => p.status === 'Active');
  const rerender = () => smfTransaction(target, activity).catch(onErr);

  if (!projects.length) {
    target.innerHTML = `<div class="view-body"><section class="card">
      ${pageBar('<strong class="plan-label">เป้าหมายและผลงานรายเดือน (SMF)</strong>', `<div class="a5-year">${a5YearSelect(me.years)}</div>`, 'smf')}
      <div id="smf-body"><p class="empty">ยังไม่มีโครงการปี ${a5Year} · เพิ่มโครงการได้ที่ Setting > โครงการ</p></div>
    </section></div>`;
    if ($('a5-year')) $('a5-year').onchange = () => { a5Year = Number($('a5-year').value); rerender(); };
    return;
  }

  if (!projects.some((p) => p.id === smfPickedProj[activity])) smfPickedProj[activity] = projects[0].id;
  const currentProj = projects.find((p) => p.id === smfPickedProj[activity]) || projects[0];
  const byMonth = Object.fromEntries((pmData.months || []).filter((m) => m.project_id === currentProj.id).map((m) => [m.month, m]));
  const projTabs = Object.fromEntries(projects.map((p) => [p.id, p.name]));
  if (typeof wfaRenderSmfTransaction === 'function') {
    return wfaRenderSmfTransaction(target, currentProj, me, rerender, pmData, byMonth, projTabs, projects);
  }
  const kpiLabel = currentProj.target_name || 'เป้าหมาย';
  const unitLabel = currentProj.unit ? ` (${currentProj.unit})` : '';
  const lock = canEdit ? '' : 'disabled';

  const rowsHtml = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const item = byMonth[m] || {};
    return `<tr data-month="${m}">
      <td style="font-weight:600">${m}. ${ACT_MONTHS[i]}</td>
      <td><input class="input smf-input smf-target" type="number" step="any" value="${item.target ?? ''}" ${lock} placeholder="Target"></td>
      <td><input class="input smf-input smf-actual" type="number" step="any" value="${item.actual ?? ''}" ${lock} placeholder="Actual"></td>
      <td class="smf-diff-cell">-</td>
      <td class="smf-pct-cell">-</td>
      <td><input class="input smf-input smf-note" type="text" maxlength="300" value="${esc(item.note || '')}" ${lock} placeholder="หมายเหตุ..."></td>
    </tr>`;
  }).join('');

  target.innerHTML = `<div class="view-body"><section class="card">
    ${pageBar(a5Pick('data-smfproj', projTabs, currentProj.id, 'โครงการ'), `<div class="a5-year">${a5YearSelect(me.years)}</div>`, 'smf')}
    <div id="smf-body" style="padding-top:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px">
        <div>
          <h3 style="margin:0;font-size:1.1rem">${esc(currentProj.name)}</h3>
          <span class="sum-meta">ตัวชี้วัดหลัก: <strong>${esc(kpiLabel)}</strong>${esc(unitLabel)}</span>
        </div>
        ${canEdit ? `<div class="action-bar a5-actions" style="margin:0">
          ${button('smf-copy-target', 'คัดลอกเป้าเดือน 1 ไปทุกเดือน', 'secondary')}
          ${button('smf-save', 'บันทึกข้อมูล', 'primary')}
        </div>` : ''}
      </div>
      <div class="table-wrap sheet">
        <table class="mo-data-table smf-month-table">
          <thead><tr>
            <th style="width:120px">เดือน</th>
            <th style="width:140px">เป้าหมาย ${esc(unitLabel)}</th>
            <th style="width:140px">ผลงานจริง ${esc(unitLabel)}</th>
            <th style="width:110px">ผลต่าง</th>
            <th style="width:130px">% บรรลุ</th>
            <th>หมายเหตุ</th>
          </tr></thead>
          <tbody id="smf-rows">${rowsHtml}</tbody>
          <tfoot><tr id="smf-summary" style="background:var(--bg-subtle, #f8fafc);font-weight:600">
            <td>เฉลี่ยทั้งปี</td>
            <td id="smf-sum-target">-</td>
            <td id="smf-sum-actual">-</td>
            <td id="smf-sum-diff">-</td>
            <td id="smf-sum-pct">-</td>
            <td id="smf-sum-info" class="sum-meta"></td>
          </tr></tfoot>
        </table>
      </div>
      <p class="sum-meta" style="margin-top:10px">บันทึกเป้าหมายและผลงานได้รายเดือน · ผู้ดูแล (Smart Team, ผู้ประสานงาน, สมาชิกโครงการ) สามารถบันทึกได้</p>
    </div>
  </section></div>`;

  target.querySelectorAll('[data-smfproj]').forEach((node) => { node.onclick = () => { smfPickedProj[activity] = Number(node.dataset.smfproj); rerender(); }; });
  if ($('a5-year')) $('a5-year').onchange = () => { a5Year = Number($('a5-year').value); rerender(); };

  const numOf = (el) => (el.value !== '' && Number.isFinite(Number(el.value)) ? Number(el.value) : null);
  const recalc = () => {
    let tSum = 0, tCount = 0, aSum = 0, aCount = 0;
    target.querySelectorAll('#smf-rows tr').forEach((tr) => {
      const tVal = numOf(tr.querySelector('.smf-target'));
      const aVal = numOf(tr.querySelector('.smf-actual'));
      if (tVal != null) { tSum += tVal; tCount++; }
      if (aVal != null) { aSum += aVal; aCount++; }
      const [diffHtml, pctHtml] = smfDiffPct(tVal, aVal, true);
      tr.querySelector('.smf-diff-cell').innerHTML = diffHtml;
      tr.querySelector('.smf-pct-cell').innerHTML = pctHtml;
    });
    const tAvg = tCount > 0 ? tSum / tCount : null;
    const aAvg = aCount > 0 ? aSum / aCount : null;
    const [sumDiff, sumPct] = smfDiffPct(tAvg, aAvg, false);
    $('smf-sum-target').textContent = tAvg != null ? tAvg.toFixed(2) : '-';
    $('smf-sum-actual').textContent = aAvg != null ? aAvg.toFixed(2) : '-';
    $('smf-sum-diff').innerHTML = sumDiff;
    $('smf-sum-pct').innerHTML = sumPct;
    $('smf-sum-info').textContent = `บันทึกแล้ว ${aCount}/12 เดือน`;
  };

  recalc();
  target.querySelector('#smf-rows').addEventListener('input', recalc);

  if (canEdit && $('smf-copy-target')) {
    $('smf-copy-target').onclick = () => {
      const firstTarget = target.querySelector('#smf-rows tr[data-month="1"] .smf-target').value;
      if (firstTarget === '') return toast('กรุณากรอกเป้าหมายเดือนที่ 1 ก่อน', 'warn');
      target.querySelectorAll('#smf-rows tr .smf-target').forEach((el) => { el.value = firstTarget; });
      recalc();
      toast('คัดลอกเป้าหมายไปทุกเดือนแล้ว');
    };
  }

  if (canEdit && $('smf-save')) {
    $('smf-save').onclick = async () => {
      const months = [...target.querySelectorAll('#smf-rows tr')].map((tr) => ({
        month: Number(tr.dataset.month),
        target: numOf(tr.querySelector('.smf-target')),
        actual: numOf(tr.querySelector('.smf-actual')),
        note: tr.querySelector('.smf-note').value || null
      }));
      try {
        $('smf-save').disabled = true;
        await a5Api(activity, 'project-months', { method: 'PUT', body: { year: a5Year, projectId: currentProj.id, months } });
        toast('บันทึกเป้าหมายและผลงานสำเร็จ');
        rerender();
      } catch (err) {
        onErr(err);
      } finally {
        if ($('smf-save')) $('smf-save').disabled = false;
      }
    };
  }
}

for (const id of APL_ON) {
  VIEWS[`${id}-home`] = (target) => aplDashboard(target, id);
  VIEWS[`${id}-setting`] = (target) => aplSetting(target, id);
}
VIEWS['smf-edit'] = (target) => smfTransaction(target, 'smf');


// SMF Dashboard > ภาพรวม: only SMF and its projects of the year (ผู้ใช้กำหนด 2026-11-01) · one card per project with
// plan progress, status of its main items, late items, team, and monthly Target vs Actual KPI.
async function aplDrawSmfOverview(body, activity) {
  let data;
  let pmData = { months: [] };
  let teamData = { members: [] };
  try {
    [data, pmData, teamData] = await Promise.all([
      api(`/api/act/overview?year=${a5Year}`),
      a5Api(activity, `project-months?year=${a5Year}`).catch(() => ({ months: [] })),
      a5Api(activity, `team?year=${a5Year}`).catch(() => ({ members: [] }))
    ]);
  } catch (err) {
    body.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
    return;
  }
  const p = data.projects.find((x) => x.activity === activity) || {};
  const projects = (p.projects || []).filter((u) => u.status === 'Active');
  const unassigned = p.plan ? p.plan.items - projects.reduce((s, u) => s + (p.plan.byUnit?.[u.code]?.items || 0), 0) : 0;
  const kpis = [
    chartKpi({ label: 'ความคืบหน้ารวม', value: p.plan?.percent || 0, unit: '%', pie: p.plan?.percent || 0, note: `${p.plan?.items || 0} หัวข้อหลัก`, color: CHART.series[0] }),
    chartKpi({ label: 'โครงการปีนี้', value: projects.length, unit: 'โครงการ', icon: 'account_tree', note: projects.map((u) => u.name).join(' · ') || 'ยังไม่มี (Setting > โครงการ)', color: CHART.series[1] }),
    chartKpi({ label: 'หัวข้อเลยกำหนด', value: ovNum(p.plan?.overdue), unit: 'รายการ', icon: 'event_busy', note: 'ทุกโครงการ', color: CHART.series[2] }),
    chartKpi({ label: 'คนในทีม', value: ovNum(p.team?.people), unit: 'คน', icon: 'groups', note: `คณะกรรมการ ${ovNum(p.team?.committee)} · Smart Team ${ovNum(p.team?.smart)}`, color: CHART.series[3] })
  ].join('');
  const row = (label, value) => `<div class="ov-row"><span>${esc(label)}</span><b>${value}</b></div>`; // label = text (SMF project name)

  const kpiSection = (u) => {
    const list = (pmData.months || []).filter((m) => m.project_id === u.id);
    const withActual = list.filter((m) => m.actual != null).sort((a, b) => b.month - a.month);
    const kpiName = u.target_name ? `${u.target_name} (${u.unit || ''})` : `เป้าหมาย (${u.unit || ''})`;
    if (!withActual.length) {
      return `<div class="ov-sec"><div class="ov-sec-title">เป้าหมายและผลงาน (KPI)</div><div class="ov-kpi-empty"><span>ตัวชี้วัด: ${esc(kpiName)}</span><span class="sum-meta">ยังไม่มีผลงานบันทึก</span></div></div>`;
    }
    const latest = withActual[0];
    const mName = ACT_MONTHS[latest.month - 1] || `เดือน ${latest.month}`;
    const diff = latest.target != null ? latest.actual - latest.target : null;
    const diffText = diff != null ? (diff >= 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)) : '-';
    const diffClass = diff != null ? (diff >= 0 ? 'ov-good' : 'ov-bad') : '';
    const pct = latest.target != null && latest.target > 0 ? ((latest.actual / latest.target) * 100).toFixed(1) : null;
    return `<div class="ov-sec"><div class="ov-sec-title">ผลงานล่าสุด: ${mName} (${esc(kpiName)})</div>
      ${row('ผลงานจริง', `${latest.actual} ${esc(u.unit || '')}`)}
      ${row('เป้าหมาย', latest.target != null ? `${latest.target} ${esc(u.unit || '')}` : '-')}
      ${diff != null ? row('ผลต่าง', `<span class="${diffClass}">${diffText}</span>`) : ''}
      ${pct != null ? row('% บรรลุ', `<b>${pct}%</b>`) : ''}
      <div style="margin-top:6px">${button('', 'บันทึก / ดูรายเดือน', 'secondary small', `data-ov-go="smf-edit"`)}</div>
    </div>`;
  };

  const card = (u, i) => {
    const plan = p.plan?.byUnit?.[u.code];
    const isCount = u.target_type === 'count';
    const isIndiv = u.team_type === 'individual';
    const count = ovCount(u, plan);
    const targetCount = count.target;
    const completed = count.done;
    const countPct = count.percent;
    const pctVal = isCount ? countPct : (plan ? plan.percent : 0);
    const chips = plan ? OV_PLAN.filter(([code]) => plan.counts[code]).map(([code, label]) => `<span class="ov-chip is-${code}">${label} ${plan.counts[code]}</span>`).join('') : '';
    const late = plan?.late?.length ? `<ul class="ov-late">${plan.late.map((t) => `<li><span>${esc(actNoLead(t.title))}</span><b>${actShort(t.end)} · ${t.progress}%</b></li>`).join('')}</ul>` : '';

    const progressSec = `<div class="ov-sec">
      <div class="ov-sec-head">
        <span class="ov-sec-title">${isCount ? 'ความคืบหน้าตามเป้าหมาย' : 'ความคืบหน้าแผนงาน'}</span>
        <b class="ov-pct-big">${pctVal}%</b>
      </div>
      ${plan || isCount ? `
        <div class="ov-progress">${ovBar(pctVal)}</div>
        <div class="ov-count-sub">${isCount ? `สำเร็จแล้ว <b>${completed}</b> จากเป้าหมาย <b>${targetCount}</b> ${esc(u.unit || 'โครงการ')}` : `สำเร็จแล้ว <b>${completed}</b> จาก <b>${plan.totalTasks || plan.items || 1}</b> หัวข้อแผนงาน`}</div>
        <div class="ov-chips">${chips}</div>
      ` : '<p class="sum-meta">ยังไม่มีหัวข้อแผน (Setting > แผนงาน เลือกโครงการนี้)</p>'}
    </div>`;

    const summarySec = `<div class="ov-sec">
      <div class="ov-sec-title">สรุปข้อมูล</div>
      <div class="ov-stat-grid">
        <div class="ov-stat-box">
          <span class="ov-stat-num">${ovNum(plan?.items)}</span>
          <span class="ov-stat-lbl">หัวข้อหลัก</span>
        </div>
        <div class="ov-stat-box ${isCount ? (completed >= targetCount ? 'is-done' : 'is-active') : (plan?.percent >= 100 ? 'is-done' : '')}">
          <span class="ov-stat-num">${isCount ? `${completed}/${targetCount}` : `${plan ? plan.percent : 0}%`}</span>
          <span class="ov-stat-lbl">${isCount ? 'โครงการสำเร็จ' : 'บรรลุตามแผน'}</span>
        </div>
        <div class="ov-stat-box ${plan?.overdue ? 'is-danger' : ''}">
          <span class="ov-stat-num">${ovNum(plan?.overdue)}</span>
          <span class="ov-stat-lbl">เลยกำหนด</span>
        </div>
        <div class="ov-stat-box">
          <span class="ov-stat-num">${ovNum(p.team?.units?.[u.code])}</span>
          <span class="ov-stat-lbl">${isIndiv ? 'ผู้รับผิดชอบ' : 'ทีมงาน'}</span>
        </div>
      </div>
      ${late}
    </div>`;

    const subtasksSec = plan?.subtasks?.length ? `
      <div class="ov-subtasks-wrap">
        <details class="ov-subtasks"${u.code === 'workflow' ? ' open' : ''}>
          <summary>
            <span class="ov-subtasks-title">
              <span class="material-symbols-rounded">account_tree</span>
              โปรเจคย่อย (${plan.subtasks.length} รายการ)
            </span>
            <span class="ov-subtasks-arrow material-symbols-rounded">expand_more</span>
          </summary>
          <div class="ov-subtasks-list">
            ${plan.subtasks.map((st, sIdx) => {
              const ownerPart = st.owner_name ? ` · ${esc(st.owner_name)}` : '';
              const fullTip = `${esc(st.title)}${st.owner_name ? ` (${esc(st.owner_name)})` : ''} · ${st.label || ''} ${st.progress}%`;
              return `
                <div class="ov-subtask-item" title="${fullTip}">
                  <div class="ov-subtask-head">
                    <span class="ov-subtask-name">
                      ${sIdx + 1}. ${esc(actNoLead(st.title))}${ownerPart ? `<span class="ov-subtask-owner">${ownerPart}</span>` : ''}
                    </span>
                    <span class="ov-subtask-pct ${st.progress >= 100 ? 'is-done' : ''}">${st.progress}%</span>
                  </div>
                  <div class="ov-subtask-bar">
                    <span style="width:${Math.min(100, Math.max(0, st.progress))}%;background:${ovTone(st.progress)}"></span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </details>
      </div>
    ` : '';

    // a project measured by count (ผู้ใช้กำหนด 2026-11-05): the chairman holds the total, each member one project of their own in
    // the plan: every member of the team with their projects, who has none yet first · an owner outside the team is listed too
    const subs = plan?.subtasks || [];
    const members = teamData.members.filter((m) => m.unit === u.code && m.role === 'member' && m.status === 'Active');
    const mine = (m) => subs.filter((st) => (st.owner_id && st.owner_id === String(m.employee_id)) || (st.owner_name && st.owner_name === m.name));
    const others = [...new Set(subs.filter((st) => st.owner_name && !members.some((m) => mine(m).includes(st))).map((st) => st.owner_name))]
      .map((name) => ({ name, department: 'นอกทีม', list: subs.filter((st) => st.owner_name === name) }));
    const people = [...members.map((m) => ({ name: m.name || m.employee_id, department: m.department, list: mine(m) })), ...others]
      .map((m) => ({ ...m, rank: !m.list.length ? 0 : m.list.some((st) => st.progress >= 100) ? 2 : 1 }))
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, 'th'));
    const tally = (rank) => people.filter((m) => m.rank === rank).length;
    const memberSec = isCount && people.length ? `
      <div class="ov-subtasks-wrap">
        <details class="ov-subtasks" open>
          <summary>
            <span class="ov-subtasks-title"><span class="material-symbols-rounded">groups</span>สมาชิก ${people.length} คน · สำเร็จ ${tally(2)} · กำลังทำ ${tally(1)} · ยังไม่มีแผน ${tally(0)}</span>
            <span class="ov-subtasks-arrow material-symbols-rounded">expand_more</span>
          </summary>
          <div class="ov-subtasks-list">
            ${people.map((m) => {
              const best = m.list.reduce((top, st) => Math.max(top, st.progress), 0);
              const tag = [['ยังไม่มีแผน', 'badge-danger'], ['กำลังทำ', 'badge-warning'], ['สำเร็จ', 'badge-success']][m.rank];
              return `<div class="ov-subtask-item" title="${esc(m.list.map((st) => `${actNoLead(st.title)} ${st.progress}%`).join(' · '))}">
                <div class="ov-subtask-head">
                  <span class="ov-subtask-name">${esc(m.name)}<span class="ov-subtask-owner"> · ${esc(m.department || '-')}</span></span>
                  <span class="badge ${tag[1]}">${tag[0]}</span>
                </div>
                <div class="sum-meta">${m.list.length ? `${esc(m.list.map((st) => actNoLead(st.title)).join(', '))} · ${best}%` : 'ยังไม่มีหัวข้อใน Plan'}</div>
              </div>`;
            }).join('')}
          </div>
        </details>
      </div>
    ` : '';

    return `<article class="card ov-card" style="--ov:${CHART.series[i % CHART.series.length]}">
      <div class="ov-head">
        <div class="ov-title-group">
          <strong>${esc(u.name)}</strong>
          <div class="ov-pills">
            <span class="ov-pill ${isIndiv ? 'is-indiv' : 'is-team'}">${isIndiv ? 'เดี่ยว' : 'ทีม'}</span>
            <span class="ov-pill ${isCount ? 'is-count' : 'is-plan'}">${isCount ? `เป้าหมาย ${targetCount} ${esc(u.unit || 'โครงการ')}` : 'วัดตามแผน'}</span>
          </div>
        </div>
      </div>
      ${progressSec}
      ${summarySec}
      ${memberSec}${subtasksSec}
      ${u.code === 'workflow' ? `<div style="margin-top:6px">${button('', 'ส่งข้อมูล / จัดการ Work Flow Automation', 'primary small', `data-ov-proj="${u.id}"`)}</div>` : ''}
    </article>`;
  };
  body.innerHTML = `<div class="ch-kpis">${kpis}</div>
    <div class="ov-grid">${projects.map(card).join('') || `<p class="empty">ยังไม่มีโครงการปี ${a5Year} · เพิ่มที่ Setting > โครงการ</p>`}</div>
    <p class="sum-meta">${unassigned > 0 ? `หัวข้อที่ยังไม่ระบุโครงการ ${unassigned} หัวข้อ · ` : ''}ข้อมูล ณ ${actShort(data.today)} ${data.year} · ภาพรวมทุกกิจกรรม (5S · CFO · SMF) อยู่ที่หน้าหลัก</p>`;
  body.querySelectorAll('[data-ov-go]').forEach((node) => { node.onclick = () => openView(node.dataset.ovGo); });
  body.querySelectorAll('[data-ov-proj]').forEach((node) => {
    node.onclick = () => {
      smfPickedProj['smf'] = Number(node.dataset.ovProj);
      openView('smf-edit');
    };
  });
  a5Lift(body);
}

// หน้าหลัก: ภาพรวมกิจกรรมในโรงงาน 5S · CFO · SMF with its own year (ผู้ใช้กำหนด 2026-11-01).
async function aplHome(target) {
  const now = new Date().getFullYear();
  const years = [...new Set([now - 2, now - 1, now, now + 1, a5Year])].filter((y) => y >= 2000 && y <= 2100).sort();
  target.innerHTML = `<div class="view-body"><section class="card">
    ${pageBar('<strong class="plan-label">ภาพรวมกิจกรรมในโรงงาน</strong>', `<div class="a5-year">${field('ปี', `<select id="ov-year">${options(years, a5Year)}</select>`)}</div>`, 'ov')}
    <div id="ov-body"><div class="empty">กำลังโหลด...</div></div>
  </section></div>`;
  $('ov-year').onchange = () => { a5Year = Number($('ov-year').value); aplHome(target).catch(onErr); };
  await aplDrawOverview($('ov-body'));
}
VIEWS.main = aplHome;
