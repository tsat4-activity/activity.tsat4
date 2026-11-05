// Shared shell: helpers, popup, api(), session screens, and the view router.
// Modules register into VIEWS / TITLES. Scripts share one global scope: never reuse a top-level name.
const PAGE = 50;
const TITLES = {
  main: ['TSAT4 Activity', 'หน้าหลัก']
};
// view name -> render(target)
const VIEWS = {};
// render for view names not in VIEWS (set by units.js)
let viewFallback = null;

let me = null;
let view = 'main';

const $ = (id) => document.getElementById(id);
const onErr = (err) => toast(err.message, 'error');

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function button(id, label, kind = 'secondary', extra = '') {
  return `<button class="btn btn-${kind}" type="button"${id ? ` id="${id}"` : ''} ${extra}>${label}</button>`;
}

function field(label, control, extra = '') {
  return `<label class="field${extra ? ` ${extra}` : ''}">${label}${control}</label>`;
}

// A picked image file -> JPEG data URL of width × height, cropped from the centre to that ratio (e.g. 500 × 600 = 2.5 : 3).
function cropJpeg(file, width, height) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const scale = Math.min(image.width / width, image.height / height);
      const sw = width * scale;
      const sh = height * scale;
      canvas.getContext('2d').drawImage(image, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('เปิดรูปไม่ได้')); };
    image.src = url;
  });
}

// Excel-style entry grid for "เพิ่ม" popups (ผู้ใช้กำหนด 2026-11-01): type in the cells, or copy rows in Excel and paste
// (Ctrl+V) into any cell; the rows grow to fit. cols: [{ key, label, type: 'text' | 'number' | 'select', options: [[value, label]],
// value: default, width }] · a select cell takes a pasted value or label (also part of a label, e.g. "สะสาง").
function gridField(id, cols, rows = 5, note = 'คัดลอกหลายแถวจาก Excel แล้ววาง (Ctrl+V) ที่ช่องไหนก็ได้ · แถวว่างไม่บันทึก') {
  const head = cols.map((c) => `<th style="${c.width ? `width:${c.width}` : ''}">${esc(c.label)}</th>`).join('');
  return `<div class="grid-edit" id="${id}" data-cols="${esc(JSON.stringify(cols))}"><div class="table-wrap"><table class="mo-data-table"><thead><tr><th class="grid-no">#</th>${head}<th class="grid-x"></th></tr></thead>
    <tbody>${Array.from({ length: rows }, () => gridRowHtml(cols)).join('')}</tbody></table></div>
    <div class="grid-foot"><button class="apl-link" type="button" data-grid-add>+ เพิ่มแถว</button><span class="sum-meta">${note}</span></div></div>`;
}

function gridRowHtml(cols, values = {}) {
  const cell = (c) => {
    const v = values[c.key] ?? c.value ?? '';
    if (c.type === 'select') return `<td><select data-key="${c.key}">${c.options.map(([val, label]) => `<option value="${esc(val)}"${String(val) === String(v) ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select></td>`;
    return `<td><input data-key="${c.key}"${c.type === 'number' ? ' type="number"' : ''} value="${esc(v)}"></td>`;
  };
  return `<tr><td class="grid-no"></td>${cols.map(cell).join('')}<td class="grid-x"><button class="icon-btn" type="button" data-grid-del title="ลบแถว" aria-label="ลบแถว">×</button></td></tr>`;
}

// Wire one grid (after openPopup) · returns rows() = [{ row: n, values }] of the rows with any typed value.
function gridBind(id) {
  const box = $(id);
  const cols = JSON.parse(box.dataset.cols);
  const body = box.querySelector('tbody');
  const number = () => [...body.rows].forEach((r, i) => { r.cells[0].textContent = i + 1; });
  const pick = (c, raw) => {
    const text = String(raw ?? '').trim();
    if (c.type !== 'select') return text;
    const low = text.toLowerCase();
    const hit = c.options.find(([v, l]) => String(v).toLowerCase() === low || String(l).toLowerCase() === low)
      || (low && c.options.find(([, l]) => String(l).toLowerCase().includes(low)));
    return hit ? hit[0] : c.value ?? c.options[0]?.[0];
  };
  number();
  box.querySelector('[data-grid-add]').onclick = () => { body.insertAdjacentHTML('beforeend', gridRowHtml(cols)); number(); };
  body.addEventListener('click', (e) => {
    if (!e.target.closest('[data-grid-del]')) return;
    if (body.rows.length > 1) e.target.closest('tr').remove();
    else e.target.closest('tr').outerHTML = gridRowHtml(cols);
    number();
  });
  body.addEventListener('paste', (e) => {
    const start = e.target.closest('[data-key]');
    const text = e.clipboardData?.getData('text/plain') || '';
    if (!start || !/[\t\n]/.test(text.replace(/\r?\n$/, ''))) return; // one value: the browser pastes it normally
    e.preventDefault();
    const lines = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n').map((l) => l.split('\t'));
    let r = [...body.rows].indexOf(start.closest('tr'));
    const c0 = cols.findIndex((c) => c.key === start.dataset.key);
    for (const line of lines) {
      while (r >= body.rows.length) body.insertAdjacentHTML('beforeend', gridRowHtml(cols));
      line.forEach((value, k) => {
        const c = cols[c0 + k];
        if (!c) return;
        const node = body.rows[r].querySelector(`[data-key="${c.key}"]`);
        node.value = pick(c, value);
      });
      r += 1;
    }
    number();
    toast(`วาง ${lines.length} แถว`);
  });
  return {
    rows: () => [...body.rows].map((tr, i) => ({ row: i + 1, tr, values: Object.fromEntries(cols.map((c) => [c.key, tr.querySelector(`[data-key="${c.key}"]`).value.trim()])) }))
      .filter(({ values }) => cols.some((c) => c.type !== 'select' && values[c.key] !== '' && String(values[c.key]) !== String(c.value ?? ''))),
    done: (tr) => { tr.remove(); if (!body.rows.length) body.insertAdjacentHTML('beforeend', gridRowHtml(cols)); number(); }
  };
}

// Save every filled row one by one; a saved row leaves the grid, the first failing row stops with its row number
// (fix it and press บันทึก again: only what is left is sent).
async function gridSave(grid, saveRow) {
  const list = grid.rows();
  if (!list.length) throw new Error('ยังไม่มีข้อมูลในตาราง');
  let saved = 0;
  for (const { row, tr, values } of list) {
    try {
      await saveRow(values);
    } catch (err) {
      throw new Error(`${saved ? `บันทึกแล้ว ${saved} แถว · ` : ''}แถว ${row}: ${err.message}`);
    }
    grid.done(tr);
    saved += 1;
  }
  return saved;
}

function options(values, current, labelOf = (value) => value) {
  return values.map((value) => `<option value="${esc(value)}"${String(current) === String(value) ? ' selected' : ''}>${esc(labelOf(value))}</option>`).join('');
}

// value: text already in the box (a pick field showing the current choice). The ค้นหา button stays for the page's code
// but is hidden: SEARCH_BOXES below runs it while typing.
function searchSlot(label, inputId, buttonId, { placeholder = '', grow = false, value = '' } = {}) {
  const hint = placeholder ? ` placeholder="${esc(placeholder)}"` : '';
  return `<div class="search-slot">${field(label, `<input id="${inputId}"${hint} value="${esc(value)}" autocomplete="off">`, grow ? 'grow' : '')}${button(buttonId, 'ค้นหา')}</div>`;
}

function searchBlock(slot, listId) {
  return `<div class="search-block">${slot}<div class="search-list" id="${listId}"></div></div>`;
}

function crudBar(prefix) {
  return `<div class="action-bar">${button(`${prefix}-add`, 'เพิ่ม', 'primary')}${button(`${prefix}-edit`, 'แก้ไข', 'secondary', 'disabled')}${button(`${prefix}-del`, 'ลบ', 'danger', 'disabled')}</div>`;
}

function tableFoot(prefix) {
  return `<div class="table-foot">
      <div class="sum-meta" id="${prefix}-count"></div>
      <div class="pager">${button(`${prefix}-prev`, 'ก่อนหน้า')}<span class="pager-page" id="${prefix}-page"></span>${button(`${prefix}-next`, 'ถัดไป')}</div>
    </div>`;
}

function tablePage(prefix, toolbar) {
  return `<div class="toolbar">${toolbar}</div>
    <div class="table-wrap sheet" id="${prefix}-rows"></div>
    ${tableFoot(prefix)}`;
}

function setPager(prefix, offset, total) {
  const pages = Math.max(1, Math.ceil(Number(total) / PAGE) || 1);
  const page = total > 0 ? Math.min(pages, Math.floor(offset / PAGE) + 1) : 1;
  const label = $(`${prefix}-page`);
  if (label) label.textContent = `หน้า ${page.toLocaleString('en-US')} / ${pages.toLocaleString('en-US')}`;
  const prev = $(`${prefix}-prev`);
  const next = $(`${prefix}-next`);
  if (prev) prev.disabled = page <= 1;
  if (next) next.disabled = page >= pages || !(total > 0);
}

function listQuery(rows, head, valueOf) {
  const filters = head?.filters || {};
  const filtered = rows.filter((row) => Object.entries(filters).every(([key, term]) => {
    const want = String(term || '').trim().toLowerCase();
    if (!want) return true;
    return String(valueOf(row, key) ?? '').toLowerCase().includes(want);
  }));
  if (!head?.sort) return filtered;
  const dir = head.dir === 'desc' ? -1 : 1;
  const compare = (a, b) => {
    const as = String(a ?? '').trim();
    const bs = String(b ?? '').trim();
    if (!as && bs) return 1;
    if (as && !bs) return -1;
    if (/^-?\d+(\.\d+)?$/.test(as) && /^-?\d+(\.\d+)?$/.test(bs)) return Number(as) - Number(bs);
    return as.localeCompare(bs, 'th', { numeric: true, sensitivity: 'base' });
  };
  return [...filtered].sort((a, b) => dir * compare(valueOf(a, head.sort), valueOf(b, head.sort)));
}

function fillTable(id, headers, rows, emptyText, head) {
  const cells = headers.map((header) => {
    const label = typeof header === 'string' ? header : header.label;
    const key = typeof header === 'string' ? '' : header.key;
    const num = typeof header === 'object' && header.num ? ' num' : ''; // number column: header right-aligned like its values
    if (!head || !key) return `<th${num ? ' class="num"' : ''}>${esc(label)}</th>`;
    const asc = head.sort === key && head.dir !== 'desc';
    return `<th class="has-menu${num}"><div class="th-line"><span class="th-label">${esc(label)}</span><button class="th-tool${asc ? ' is-active' : ''}" type="button" data-col-sort="${esc(key)}" aria-label="${asc ? 'เรียง Z ไป A' : 'เรียง A ไป Z'}"><span class="material-symbols-rounded">sort_by_alpha</span></button></div></th>`;
  }).join('');
  const body = rows || `<tr><td class="empty" colspan="${Math.max(headers.length, 1)}">${emptyText}</td></tr>`;
  const node = $(id);
  if (!rows && !head) {
    node.innerHTML = `<p class="empty">${emptyText}</p>`;
    return;
  }
  node.innerHTML = `<table class="mo-data-table"><thead><tr>${cells}</tr></thead><tbody>${body}</tbody></table>`;
  if (!head) return;
  node.querySelectorAll('[data-col-sort]').forEach((btn) => {
    btn.onclick = (event) => {
      event.stopPropagation();
      const key = btn.dataset.colSort;
      const asc = head.sort === key && head.dir !== 'desc';
      head.onChange({ sort: key, dir: asc ? 'desc' : 'asc', filters: head.filters || {} });
    };
  });
}

// fillTable's `head`: keeps sort and filters in the given object and calls reload() after a change.
function headFor(head, reload) {
  return { ...head, onChange: (next) => { Object.assign(head, next); reload(); } };
}

// ---------- Charts: one look for every dashboard (CFO layout) ----------
// Tone by section: ระบบงาน warm (red/orange/yellow/brown/pink, neighbours different hues), ระบบกิจกรรม and the rest
// green family from the user palette (#1B5E20 #2E7D32 #43A047 #66BB6A) spread across forest / yellow-green / teal so
// neighbours stay apart. Base year = slate. Marks: solid edge + the same
// colour inside 60% transparent (AGENTS.md "หน้าจอ"). CSS: .ch-* in app.css.
const CHART_THEMES = {
  cool: { series: ['#1B5E20', '#7CB342', '#00897B', '#43A047', '#C5E1A5', '#4DB6AC', '#2E7D32', '#64748b'], base: ['#334155', '#64748b', '#94a3b8'], line: '#2E7D32', dark: '#1e293b', target: '#43A047' },
  warm: { series: ['#ea580c', '#dc2626', '#eab308', '#92400e', '#db2777', '#fb923c', '#a16207', '#78716c'], base: ['#44403c', '#78716c', '#a8a29e'], line: '#ea580c', dark: '#292524', target: '#b45309' }
};
// Read at render time, so the colours follow the page being drawn (openView sets body[data-zone]).
const CHART = {
  get theme() { return CHART_THEMES[document.body.dataset.zone === 'work' ? 'warm' : 'cool']; },
  get series() { return CHART.theme.series; },
  get base() { return CHART.theme.base; },
  get line() { return CHART.theme.line; },
  get dark() { return CHART.theme.dark; },
  get target() { return CHART.theme.target; }
};

function chartNum(value, digits = 3) {
  return Number(value || 0).toLocaleString('th-TH', { maximumFractionDigits: digits });
}

// Axis top: a round number at or above v, in 4 steps.
function chartNiceMax(v) {
  const step = Math.max(v, 1e-9) / 4;
  const mag = 10 ** Math.floor(Math.log10(step));
  return [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10].map((n) => n * mag).find((n) => n >= step) * 4;
}

// "ลดลง x%" / "เพิ่มขึ้น x%" of now against was. Lower is good (green) unless upGood.
function chartPill(now, was, suffix = '', upGood = false) {
  if (!was) return '';
  const pct = Math.round(((now - was) / was) * 1000) / 10;
  const good = upGood ? pct >= 0 : pct <= 0;
  return `<span class="ch-pill ${good ? 'is-good' : 'is-bad'}">${pct > 0 ? 'เพิ่มขึ้น' : 'ลดลง'} ${Math.abs(pct)}%${suffix}</span>`;
}

// KPI card, same frame everywhere: [pie or icon] label / value + unit / pill + note.
// pie = 0–100 share drawn in color; otherwise icon (Material Symbol name, default insights).
function chartKpi({ label, value, unit = '', pill = '', note = '', color = CHART.series[0], pie = null, icon = 'insights' }) {
  const lead = pie != null ? `<span class="ch-pie" style="--p:${Math.max(0, Math.min(100, pie))}%"></span>` : `<span class="ch-icon material-symbols-rounded">${icon}</span>`;
  return `<article class="ch-kpi" style="--c:${color}">${lead}<div class="ch-kpi-body"><div class="ch-kpi-label">${label}</div>
    <div class="ch-kpi-value"><strong>${value}</strong>${unit ? `<small>${unit}</small>` : ''}</div><div class="ch-kpi-foot">${pill}${note ? `<span>${note}</span>` : ''}</div></div></article>`;
}

// Chart card frame: title (left), optional small text (right), then the chart.
// A card holding a chart has no title (ผู้ใช้กำหนด 2026-10-28): only its small note on the right, if any.
// Table cards keep their title.
function chartCard(title, body, meta = '') {
  const chart = /class="ch-plot/.test(body);
  const head = chart ? (meta ? `<div class="ch-head is-meta"><div class="sum-meta">${meta}</div></div>` : '') : `<div class="ch-head"><div class="card-title">${title}</div>${meta ? `<div class="sum-meta">${meta}</div>` : ''}</div>`;
  return `<section class="card ch-card"${chart ? ` aria-label="${esc(String(title).replace(/<[^>]*>/g, ''))}"` : ''}>${head}${body}</section>`;
}

// Monthly (or any labelled) chart: bars on the left axis — each series one bar per label, a value or a stack
// [v1, v2, …] coloured by `colors` — and lines on the left or right axis, gridlines, and a legend.
// Axis titles sit above their axis (left / right), so the plot keeps the full width.
// legend: { line: color, dash, label } | { box: color, label } | { head: text }. Hover tip: chartTip(id, (i) => html).
function chartPlot({ id, labels, bars = [], lines = [], left = '', right = '', legend = [], leftMax = 0, digits = 0 }) {
  const n = labels.length;
  const sum = (v) => (Array.isArray(v) ? v.reduce((t, x) => t + (Number(x) || 0), 0) : Number(v) || 0);
  const leftLines = lines.filter((l) => l.axis !== 'right');
  const rightLines = lines.filter((l) => l.axis === 'right');
  const yL = leftMax || chartNiceMax(Math.max(...bars.flatMap((b) => b.values.map(sum)), ...leftLines.flatMap((l) => l.values.filter((v) => v != null)), 1) * 1.1);
  const yR = rightLines.length ? chartNiceMax(Math.max(...rightLines.flatMap((l) => l.values.filter((v) => v != null)), 1) * 1.05) : 0;
  // small values (e.g. 0.3 tCO2e) keep their decimals: the axis shows 0.3 · 0.6 … not 0 · 1 · 1, a value 0.332 not 0
  // (ผู้ใช้แจ้ง 2026-11-03) · whole numbers (counts, %) stay as they are
  const tickDigits = (max) => { let d = digits; while (d < 4 && Math.abs(Number((max / 4).toFixed(d)) - max / 4) > 1e-9) d += 1; return d; };
  const vd = (v) => Math.max(digits, Math.abs(v) < 1 ? 3 : Math.abs(v) < 10 ? 2 : 0);
  const ticks = (max) => [4, 3, 2, 1, 0].map((k) => `<span>${chartNum((max / 4) * k, tickDigits(max))}</span>`).join('');
  const x = (i) => ((i + 0.5) / n) * 100;
  const bar = (b, i) => {
    const v = b.values[i];
    const parts = Array.isArray(v) ? v : [v];
    const total = sum(v);
    // unit: suffix of the value on top (87%) · inner: a label per column shown in the middle of the bar (e.g. 33 ใบ)
    const inner = b.inner?.[i] ? `<span class="ch-in">${esc(b.inner[i])}</span>` : '';
    // flex as a share of the total: grow factors that add up to less than 1 fill only that part of the bar, so a month
    // under 1 tCO2e floated above the axis (ผู้ใช้แจ้ง 2026-11-03)
    return `<div class="ch-stack" style="height:${(total / yL) * 100}%">${total ? `<span class="ch-val">${chartNum(total, vd(total))}${esc(b.unit || '')}</span>${inner}` : ''}${total ? parts.map((p, k) => (p ? `<div style="flex:${Number(p) / total};--c:${(b.colors || CHART.series)[k]}"></div>` : '')).reverse().join('') : ''}</div>`;
  };
  const scale = (l) => (l.axis === 'right' ? yR : yL);
  // Target line = dashed with one value all year (or target: true): drawn edge to edge across the plot, one label at the right end.
  const targetOf = (l) => {
    const shown = l.values.filter((v) => v != null);
    return l.target || (l.dash && shown.length > 1 && shown.every((v) => v === shown[0])) ? shown[shown.length - 1] : null;
  };
  const targetLine = (l) => (targetOf(l) == null ? '' : `<i class="ch-target-line" style="bottom:${(targetOf(l) / scale(l)) * 100}%;--c:${l.color}"></i>`);
  const poly = (l) => {
    if (targetOf(l) != null) return '';
    const pts = l.values.map((v, i) => (v == null ? null : `${x(i) * 12},${1000 - (v / scale(l)) * 1000}`)).filter(Boolean);
    return pts.length ? `<polyline points="${pts.join(' ')}" fill="none" stroke="${l.color}" stroke-width="2.5"${l.dash ? ' stroke-dasharray="7 5"' : ''} vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>` : '';
  };
  const dots = (l) => (l.dots === false || targetOf(l) != null ? '' : l.values.map((v, i) => (v == null ? '' : `<i class="ch-pt" style="left:${x(i)}%;bottom:${(v / scale(l)) * 100}%;--c:${l.color}"></i>`)).join(''));
  // Value above each point (below for a dashed line, so a target under its base line does not collide); labels: 'last' = only the latest point (lines that sit close to another line), false = none.
  // A target line (dashed, one value all year, or target: true) gets one label "Target : 80%" on the line at the right end (ผู้ใช้กำหนด 2026-10-29).
  const values = (l) => {
    if (l.labels === false) return '';
    const v = targetOf(l);
    if (v != null) {
      return `<span class="ch-target" style="bottom:${(v / scale(l)) * 100}%;--c:${l.color}">Target : ${chartNum(v, vd(v))}${esc(l.unit || '')}</span>`;
    }
    const last = l.values.reduce((k, v, i) => (v == null ? k : i), -1);
    return l.values.map((v, i) => (v == null || (l.labels === 'last' && i !== last) ? '' : `<span class="ch-lv${l.dash ? ' is-below' : ''}" style="left:${x(i)}%;bottom:${(v / scale(l)) * 100}%;--c:${l.color}">${chartNum(v, vd(v))}</span>`)).join('');
  };
  const key = (item) => (item.head ? `<b>${esc(item.head)}</b>` : item.line ? `<span><i class="ln${item.dash ? ' is-dash' : ''}" style="--c:${item.line}"></i>${esc(item.label)}</span>` : `<span><i class="sq" style="--c:${item.box}"></i>${esc(item.label)}</span>`);
  return `<div class="ch-plot${yR ? ' has-right' : ''}">
      <div class="ch-titles"><span>${esc(left)}</span>${legend.length ? `<div class="ch-legend">${legend.map(key).join('')}</div>` : ''}<span>${yR ? esc(right) : ''}</span></div>
      <div class="ch-yaxis">${ticks(yL)}</div>
      <div class="ch-area" id="${id}">
        ${[0, 1, 2, 3, 4].map((k) => `<i class="ch-grid" style="bottom:${k * 25}%"></i>`).join('')}
        <div class="ch-cols" style="grid-template-columns:repeat(${n},minmax(0,1fr))">${labels.map((_, i) => `<div class="ch-col" data-i="${i}"><div class="ch-pair">${bars.map((b) => bar(b, i)).join('')}</div></div>`).join('')}</div>
        <svg class="ch-lines" viewBox="0 0 1200 1000" preserveAspectRatio="none" aria-hidden="true">${lines.map(poly).join('')}</svg>
        ${lines.map(targetLine).join('')}${lines.map(dots).join('')}${lines.map(values).join('')}
        <div class="ch-tip" hidden></div>
      </div>
      ${yR ? `<div class="ch-yaxis is-right">${ticks(yR)}</div>` : ''}
      <div class="ch-xaxis" style="grid-template-columns:repeat(${n},minmax(0,1fr))">${labels.map((l) => `<span>${esc(l)}</span>`).join('')}</div>
    </div>
    `;
}

// Every bar shows its total on top and every line point its value (AGENTS.md: chart rules).
// Hover box over a chartPlot column; html(i) returns its content (rows: <div class="ch-tip-row"><span>…</span><b>…</b></div>).
function chartTip(id, html) {
  const area = $(id);
  if (!area) return;
  const tip = area.querySelector('.ch-tip');
  const n = area.querySelectorAll('.ch-col').length;
  area.querySelectorAll('.ch-col').forEach((col) => {
    col.onmouseenter = () => {
      const i = Number(col.dataset.i);
      tip.innerHTML = html(i);
      tip.hidden = false;
      tip.style.left = `${Math.min(Math.max(((i + 0.5) / n) * 100, 14), 86)}%`;
    };
    col.onmouseleave = () => { tip.hidden = true; };
  });
}

function tableParams(query, head) {
  if (head?.sort) {
    query.set('sort', head.sort);
    query.set('dir', head.dir === 'desc' ? 'desc' : 'asc');
  }
  const filters = Object.fromEntries(Object.entries(head?.filters || {}).filter(([, value]) => String(value || '').trim()));
  if (Object.keys(filters).length) query.set('filters', JSON.stringify(filters));
  return query;
}

function countText(id, shown, total) {
  $(id).textContent = `แสดง ${Number(shown).toLocaleString('en-US')} จาก ${Number(total).toLocaleString('en-US')} แถว`;
}

function bindPager(prefix, state, load) {
  $(`${prefix}-search`).onclick = () => { state.offset = 0; load().catch(onErr); };
  $(`${prefix}-prev`).onclick = () => { state.offset = Math.max(0, state.offset - PAGE); load().catch(onErr); };
  $(`${prefix}-next`).onclick = () => { state.offset += PAGE; load().catch(onErr); };
}

function onEnter(id, run) {
  $(id)?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    run();
  });
}

// Page toolbar rule (AGENTS.md "หน้าจอ"): no title card (the header already names the page), one row:
// left = only buttons that open sub-pages (tabs, table picker), right = year → view switch (ปี/เดือน/สัปดาห์) and filters
// from large to small → search → create/edit/delete
// at the far right. `right` comes first (the year); a tab fills the slots <id>-left / <id>-tools after it.
function pageBar(left, right = '', id = 'page') {
  return `<div class="page-bar"><div class="page-bar-left">${left}<span class="page-bar-slot" id="${id}-left"></span></div><div class="page-bar-right">${right}<span class="page-bar-slot" id="${id}-tools"></span></div></div>`;
}

function cardView(title, meta, body = '') {
  return `<div class="view-body"><section class="card"><div class="card-title">${title}</div>${meta ? `<p class="sum-meta">${meta}</p>` : ''}${body}</section></div>`;
}

function closePopup() {
  document.removeEventListener('keydown', popupKey);
  $('popup')?.remove();
}

function popupKey(event) {
  if (event.key === 'Escape') closePopup();
}

function openPopup(title, body, onSave, saveLabel = 'บันทึก') {
  closePopup();
  const node = document.createElement('div');
  node.className = 'popup-back';
  node.id = 'popup';
  node.innerHTML = `<section class="popup" role="dialog" aria-modal="true">
    <div class="popup-title">${title}</div>
    <div class="popup-fields">${body}</div>
    <div class="popup-actions">
      ${button('popup-cancel', 'ยกเลิก')}
      ${button('popup-save', saveLabel, saveLabel === 'ลบ' ? 'danger' : 'primary')}
    </div>
  </section>`;
  document.body.appendChild(node);
  document.addEventListener('keydown', popupKey);
  $('popup-cancel').onclick = closePopup;
  node.addEventListener('click', (event) => { if (event.target === node) closePopup(); });
  // one save at a time: a double click must not send it twice (audit 2026-11-03)
  $('popup-save').onclick = async () => {
    const save = $('popup-save');
    if (save.disabled) return;
    save.disabled = true;
    try { await onSave(); } catch (err) { onErr(err); } finally { if (save.isConnected) save.disabled = false; }
  };
  node.querySelector('input:not([readonly]):not([disabled]),select,textarea')?.focus({ preventScroll: true }); // a form at the bottom must not scroll the top away
}

function confirmPopup(title, text, onYes, saveLabel = 'ลบ') {
  openPopup(title, `<p class="sum-meta">${text}</p>`, async () => { await onYes(); closePopup(); }, saveLabel);
}

function toast(message, kind = 'success') {
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = message;
  $('toasts').appendChild(node);
  setTimeout(() => node.remove(), 3200);
}

function setHeaderMeta(content = '') {
  const node = $('header-meta');
  if (!node) return;
  node.innerHTML = content ? String(content) : '';
}

function openChangePassword() {
  const fields = `
    <div class="field">
      <label class="required">รหัสผ่านปัจจุบัน</label>
      <div class="pw-wrap">
        <input id="pw-cur" type="password" autocomplete="current-password" required>
        <button class="icon-btn pw-toggle" type="button" data-pw-toggle title="แสดง/ซ่อนรหัส" aria-label="แสดง/ซ่อน"><span class="material-symbols-rounded">visibility</span></button>
      </div>
    </div>
    <div class="field">
      <label class="required">รหัสผ่านใหม่</label>
      <div class="pw-wrap">
        <input id="pw-new" type="password" autocomplete="new-password" minlength="8" required>
        <button class="icon-btn pw-toggle" type="button" data-pw-toggle title="แสดง/ซ่อนรหัส" aria-label="แสดง/ซ่อน"><span class="material-symbols-rounded">visibility</span></button>
      </div>
      <small class="sum-meta">ต้องยาวอย่างน้อย 8 ตัวอักษร</small>
    </div>
    <div class="field">
      <label class="required">ยืนยันรหัสผ่านใหม่</label>
      <div class="pw-wrap">
        <input id="pw-cfm" type="password" autocomplete="new-password" minlength="8" required>
        <button class="icon-btn pw-toggle" type="button" data-pw-toggle title="แสดง/ซ่อนรหัส" aria-label="แสดง/ซ่อน"><span class="material-symbols-rounded">visibility</span></button>
      </div>
    </div>
    <p class="form-error" id="pw-pop-err" style="display:none"></p>
  `;
  openPopup('เปลี่ยนรหัสผ่าน', fields, async () => {
    const cur = $('pw-cur').value.trim();
    const next = $('pw-new').value.trim();
    const cfm = $('pw-cfm').value.trim();
    const errBox = $('pw-pop-err');
    const showErr = (msg) => {
      if (errBox) {
        errBox.textContent = msg;
        errBox.style.display = 'block';
      }
      throw new Error(msg);
    };
    if (!cur) showErr('กรุณากรอกรหัสผ่านปัจจุบัน');
    if (!next) showErr('กรุณากรอกรหัสผ่านใหม่');
    if (next.length < 8) showErr('รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัว');
    if (next !== cfm) showErr('รหัสผ่านใหม่และการยืนยันไม่ตรงกัน');
    if (cur === next) showErr('รหัสผ่านใหม่ต้องไม่ซ้ำรหัสเดิม');
    try {
      await api('/api/password', { method: 'POST', body: { current: cur, password: next } });
      toast('เปลี่ยนรหัสผ่านสำเร็จแล้ว');
      closePopup();
    } catch (err) {
      showErr(err.message || 'เปลี่ยนรหัสผ่านไม่ได้');
    }
  });
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    if (path !== '/api/password') showLogin();
    throw new Error(data.error || 'กรุณาเข้าสู่ระบบ');
  }
  if (res.status === 403 && String(data.error || '').includes('90')) { showPassword(); throw new Error(data.error); }
  if (!res.ok) throw new Error(data.error || 'ไม่สำเร็จ');
  return data;
}

function bindRowSelect(container, onSelect) {
  if (!container) return; // the page was left while it loaded
  const rows = [...container.querySelectorAll('tbody tr[data-pick]')];
  rows.forEach((row) => {
    row.classList.add('row-pick');
    row.onclick = () => {
      rows.forEach((item) => item.classList.toggle('is-selected', item === row));
      onSelect(row.dataset.pick, row);
    };
  });
}

function showLogin() {
  me = null;
  $('login').classList.remove('d-none');
  $('password-gate').classList.add('d-none');
  $('shell').classList.add('d-none');
}

function showPassword() {
  $('login').classList.add('d-none');
  $('password-gate').classList.remove('d-none');
  $('shell').classList.add('d-none');
}

function showShell() {
  $('login').classList.add('d-none');
  $('password-gate').classList.add('d-none');
  $('shell').classList.remove('d-none');
  $('header-user').textContent = me.name || me.employeeId;
  const access = me.founder ? 'ผู้สร้างระบบ' : me.creator ? 'ผู้ช่วยดูแลระบบ' : me.executive ? 'ผู้บริหาร' : me.adminOf?.length ? 'ผู้ดูแลระบบ' : 'ผู้ใช้งาน';
  $('header-role').textContent = `${access} · ${me.employeeId}`;
  document.querySelectorAll('[data-system]').forEach((node) => node.classList.toggle('d-none', !me.creator));
  if (typeof accessNav === 'function') accessNav(); // access.js: level badges + Setting only for ผู้ดูแล
  openView(view);
}

function zoneOf(name) {
  if (name === 'setup' || name === 'act-plan' || name === 'system' || name === 'access') return 'setup';
  if (name === 'activity' || name.startsWith('workflow') || name.startsWith('smf')) return 'act';
  if (typeof plantOf === 'function' && plantOf(name)) return 'act';
  return '';
}

let viewRun = 0;
let viewDrawn = 0;
function openView(name) {
  setHeaderMeta('');
  if ((name === 'system' || name === 'access') && !me.creator) name = 'main';
  view = name;
  // Dashboard pages use the compact sizes (body[data-dash] in app.css).
  if (TITLES[name]?.[0] === 'Dashboard') document.body.dataset.dash = '1';
  else delete document.body.dataset.dash;
  const zone = zoneOf(view);
  if (zone) document.body.dataset.zone = zone;
  else delete document.body.dataset.zone;
  const [title, subtitle] = TITLES[name] || [name, ''];
  $('header-page-title').textContent = title;
  $('header-page-subtitle').textContent = subtitle;
  document.querySelectorAll('.nav-btn').forEach((node) => node.classList.toggle('active', node.dataset.view === name && !node.classList.contains('nav-parent')));
  document.querySelectorAll('.nav-acc').forEach((acc) => {
    if (!acc.querySelector(`.nav-btn[data-view="${name}"]`)) return;
    acc.classList.remove('is-collapsed');
    acc.querySelector('[data-nav-toggle]')?.setAttribute('aria-expanded', 'true');
  });
  document.body.classList.remove('sidebar-open');
  const target = $('app-view');
  target.innerHTML = '<div class="empty">กำลังโหลด...</div>';
  const render = VIEWS[name] || viewFallback(name);
  // a page left while it still loads must not put its error over the page now open, and if it draws over
  // that page after it has finished, the page now open is drawn again
  const run = (viewRun += 1);
  render(target).catch((err) => { if (run === viewRun) target.innerHTML = `<p class="form-error">${esc(err.message)}</p>`; }).finally(() => {
    if (run === viewRun) viewDrawn = run;
    else if (viewDrawn === viewRun) openView(view);
  });
}

function moduleCard(viewName, icon, title, text) {
  return `<button class="card module-card" type="button" data-go="${viewName}"><span class="material-symbols-rounded">${icon}</span><div class="card-title">${title}</div><div class="sum-meta">${text}</div></button>`;
}

function bindGo(target) {
  target.querySelectorAll('[data-go]').forEach((node) => { node.onclick = () => openView(node.dataset.go); });
}

function modulePage(target, title, meta, cards) {
  const grid = `<div class="module-grid">${cards.map((card) => moduleCard(...card)).join('')}</div>`;
  target.innerHTML = cardView(title, meta, grid);
  bindGo(target);
}

// VIEWS.main (หน้าหลัก = ภาพรวมกิจกรรม 5S · CFO · SMF) is aplHome in act-planner.js

// One search field, no ค้นหา button to press (ผู้ใช้กำหนด 2026-10-29):
// · .search-slot (filters a list): typing runs the slot's search after a short pause.
// · .search-block (picks a person / item): results drop down under the field (also when an empty field is clicked);
//   clicking one runs the page's own pick code, then shows "code · name" in the same field and closes the list.
//   Emptying the field fires 'pick-clear' on the block so the page can drop its choice.
const SEARCH_BOXES = (() => {
  let timer;
  const run = (input) => input.closest('.search-slot')?.querySelector(':scope > .btn')?.click();
  const listOf = (block) => block.querySelector(':scope > .search-list');
  document.addEventListener('input', (e) => {
    const input = e.target;
    if (!(input instanceof HTMLInputElement) || !input.closest('.search-slot')) return;
    const block = input.closest('.search-block');
    clearTimeout(timer);
    if (block && !input.value.trim()) {
      listOf(block).innerHTML = '';
      block.dispatchEvent(new CustomEvent('pick-clear', { bubbles: true }));
      return;
    }
    timer = setTimeout(() => run(input), 300);
  });
  document.addEventListener('focusin', (e) => {
    const block = e.target.closest?.('.search-block');
    if (block && e.target.matches('.search-slot input') && !e.target.value.trim() && !listOf(block).innerHTML) run(e.target);
  });
  document.addEventListener('click', (e) => {
    const block = e.target.closest('.search-block');
    document.querySelectorAll('.search-block').forEach((other) => { if (other !== block) listOf(other).innerHTML = ''; });
    const row = e.target.closest('.search-block > .search-list tr[data-pick]');
    if (!row) return;
    // after the page's row handler (bindRowSelect) has taken the choice
    setTimeout(() => {
      const input = block.querySelector('.search-slot input');
      if (input) input.value = [...row.cells].map((c) => c.textContent.trim()).filter(Boolean).slice(0, 2).join(' · ');
      listOf(block).innerHTML = '';
    }, 0);
  });
  return { run };
})();

// Dashboard charts grow to fill the empty height under the page (ผู้ใช้กำหนด 2026-10-29): after each render and on
// resize, the free space below the card is shared between the chart rows (charts side by side get the same height),
// up to DASH_FIT_MAX px of plot per chart. Report pages laid out for one sheet (.cfo-report-page) keep their size.
const DASH_FIT_MAX = 520;
const DASH_ROW_MAX = 44;
(() => {
  const view = document.getElementById('app-view');
  if (!view) return;
  let timer;
  // Long tables scroll inside their own frame so the column header (sticky th) and the page bar stay in view
  // (ผู้ใช้กำหนด 2026-10-29): a table whose top is on screen gets the height left down to the bottom of the page.
  const fitTables = (box) => {
    if (!box) return;
    const bottom = box.getBoundingClientRect().bottom - 8;
    box.querySelectorAll('.table-wrap, .a5-sched-wrap').forEach((wrap) => {
      if (wrap.parentElement.closest('.table-wrap, .a5-sched-wrap')) return;
      wrap.style.removeProperty('max-height');
      // keep what follows the table (totals line, pager, card padding) on screen too
      const rect = wrap.getBoundingClientRect();
      const after = Math.max(0, (box.lastElementChild || wrap).getBoundingClientRect().bottom - rect.bottom);
      const room = bottom - rect.top - after;
      if (room >= 120 && wrap.scrollHeight > room + 2) wrap.style.maxHeight = `${Math.floor(room)}px`; // short screens too (audit 2026-11-03)
    });
  };
  const fit = () => {
    const box = view.querySelector(':scope > .view-body');
    const plots = box ? [...box.querySelectorAll('.ch-plot')].filter((p) => p.offsetParent && !p.closest('.cfo-report-page')) : [];
    plots.forEach((p) => p.style.removeProperty('grid-template-rows'));
    const dashTables = box ? [...box.querySelectorAll('.table-wrap table')].filter((t) => t.offsetParent) : [];
    dashTables.forEach((t) => t.style.removeProperty('--row-h'));
    const sheet = box?.querySelector('.table-wrap.sheet');
    sheet?.style.removeProperty('min-height');
    fitTables(box);
    if (!box?.lastElementChild) return;
    const card = box.lastElementChild;
    const last = card.lastElementChild || card;
    const free = box.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom - parseFloat(getComputedStyle(card).paddingBottom) - 10;
    if (free < 24) return;
    // Other pages (Transaction / Setting lists): the main table frame reaches the bottom of the page.
    if (!document.body.dataset.dash) {
      if (sheet && sheet.offsetParent) {
        sheet.style.minHeight = `${Math.floor(sheet.getBoundingClientRect().height + free)}px`;
        // a margin that escapes the last block (e.g. the note under the table) is not in its rect: take back what
        // overflows, so the page itself never scrolls and only the table frame has a scrollbar (ผู้ใช้กำหนด 2026-11-02)
        const over = box.scrollHeight - box.clientHeight;
        if (over > 0) sheet.style.minHeight = `${Math.floor(sheet.getBoundingClientRect().height - over)}px`;
      }
      return;
    }
    if (!plots.length && !dashTables.length) return;
    // A Dashboard of tables only (e.g. 5S Ranking): taller rows fill the card, up to DASH_ROW_MAX px; tables side by
    // side share the row height of the longest one.
    if (!plots.length) {
      const rowsOf = (t) => t.tBodies[0]?.rows.length || 0;
      const n = Math.max(0, ...dashTables.map(rowsOf));
      const base = dashTables.find((t) => rowsOf(t) === n)?.tBodies[0]?.rows[0]?.getBoundingClientRect().height || 22;
      if (n) dashTables.forEach((t) => t.style.setProperty('--row-h', `${Math.floor(Math.min(DASH_ROW_MAX, base + free / n))}px`));
      return;
    }
    const rows = new Set(plots.map((p) => Math.round(p.getBoundingClientRect().top)));
    const extra = free / rows.size;
    plots.forEach((p) => {
      const now = p.querySelector('.ch-area').getBoundingClientRect().height;
      p.style.gridTemplateRows = `auto ${Math.round(Math.min(DASH_FIT_MAX, now + extra))}px auto`;
    });
  };
  const later = () => { clearTimeout(timer); timer = setTimeout(fit, 120); };
  // New page content is fitted before it is painted (ผู้ใช้กำหนด 2026-11-02): with the 120 ms wait a new, taller table
  // overflowed the page for a few frames and the page scrollbar flashed at the right edge when switching pages
  let frame = 0;
  const now = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; fit(); }); };
  window.addEventListener('resize', later);
  // Fonts change line heights after the first render.
  document.fonts?.ready.then(later);
  window.addEventListener('load', later);
  // Re-fit when the page content changes, not when a chart's hover tip does.
  new MutationObserver((list) => { if (list.some((m) => !m.target.closest?.('.ch-tip'))) now(); }).observe(view, { childList: true, subtree: true });
})();

// Text cut off with … shows in full on hover (ผู้ใช้กำหนด 2026-10-29, ย้ำ 2026-11-01): one floating box for the whole app,
// next to the cut-off text, at once. A cut-off element's title becomes the box text (the browser's slow tooltip is
// turned off for it); an element that is not cut off keeps its own title.
const OVERFLOW_TIP = (() => {
  if (!window.matchMedia('(hover: hover)').matches) return null;
  const tip = document.createElement('div');
  tip.className = 'ov-tip';
  tip.hidden = true;
  document.body.append(tip);
  let shown = null;
  const clipped = (el) => {
    for (let node = el, k = 0; node && k < 4 && node !== document.body; node = node.parentElement, k += 1) {
      if (node.matches('input, select, textarea, .ov-tip')) return null;
      const style = getComputedStyle(node);
      const oneLine = style.textOverflow === 'ellipsis' || (style.overflow === 'hidden' && style.whiteSpace === 'nowrap');
      if (oneLine && node.scrollWidth > node.clientWidth + 1 && node.textContent.trim() && node.textContent.length < 400) return node;
      if (node.title) return null;
    }
    return null;
  };
  document.addEventListener('mouseover', (e) => {
    const node = e.target instanceof Element ? clipped(e.target) : null;
    if (node === shown) return;
    shown = node;
    tip.hidden = !node;
    if (!node) return;
    if (node.title) { node.dataset.tip = node.title; node.removeAttribute('title'); }
    tip.textContent = (node.dataset.tip || node.textContent).trim().replace(/\s+/g, ' ').slice(0, 500);
    const r = node.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(r.left, innerWidth - tip.offsetWidth - 8))}px`;
    tip.style.top = `${r.bottom + 4 + tip.offsetHeight > innerHeight ? r.top - tip.offsetHeight - 4 : r.bottom + 4}px`;
  });
  return tip;
})();

// Every <input type="date"> is typed as วัน/เดือน/ปี (dd/mm/yyyy) whatever the browser language (ผู้ใช้กำหนด 2026-10-29).
// A text box shows dd/mm/yyyy (slashes added while typing) and keeps the real date input — hidden, still holding the
// id — in step, so pages keep reading and writing .value as YYYY-MM-DD; the calendar button opens the browser's picker.
const DMY = (() => {
  const valueOf = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  const disabledOf = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'disabled');
  const toDmy = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
  const toIso = (text) => {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(text).trim());
    if (!m) return null;
    const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    const date = new Date(`${iso}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
  };
  const wrap = (input) => {
    if (input.dataset.dmy) return;
    input.dataset.dmy = '1';
    const box = document.createElement('span');
    box.className = 'dmy';
    const text = document.createElement('input');
    Object.assign(text, { type: 'text', inputMode: 'numeric', placeholder: 'วว/ดด/ปปปป', maxLength: 10, autocomplete: 'off' });
    const pick = document.createElement('button');
    Object.assign(pick, { type: 'button', className: 'dmy-pick', tabIndex: -1, innerHTML: '<span class="material-symbols-rounded">calendar_month</span>' });
    pick.setAttribute('aria-label', 'เลือกจากปฏิทิน');
    input.parentNode.insertBefore(box, input);
    box.append(text, pick, input);
    input.classList.add('dmy-real');
    input.tabIndex = -1;
    const show = () => {
      text.value = toDmy(valueOf.get.call(input));
      text.disabled = pick.disabled = disabledOf.get.call(input);
      text.classList.remove('is-bad');
    };
    // Code that sets .value / .disabled on the real input updates the text box too.
    Object.defineProperty(input, 'value', { configurable: true, get() { return valueOf.get.call(this); }, set(v) { valueOf.set.call(this, v); show(); } });
    Object.defineProperty(input, 'disabled', { configurable: true, get() { return disabledOf.get.call(this); }, set(v) { disabledOf.set.call(this, v); show(); } });
    text.addEventListener('input', () => {
      const digits = text.value.replace(/\D/g, '').slice(0, 8);
      text.value = digits.length > 4 ? `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}` : digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
      const iso = toIso(text.value);
      text.classList.toggle('is-bad', text.value.length === 10 && !iso);
      // a date typed half way is no date: the old value must not be saved silently (audit 2026-11-03) · no event until
      // it is whole, so filters do not reload on every key
      if (!iso && text.value) { valueOf.set.call(input, ''); return; }
      valueOf.set.call(input, iso || '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    text.addEventListener('blur', show);
    pick.onclick = () => { try { input.showPicker(); } catch { input.focus(); } };
    input.addEventListener('change', () => { if (document.activeElement !== text) show(); });
    show();
  };
  const scan = (root) => root.querySelectorAll?.('input[type="date"]:not([data-dmy])').forEach(wrap);
  new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach((node) => {
    if (node.nodeType !== 1) return;
    if (node.matches('input[type="date"]')) wrap(node);
    scan(node);
  }))).observe(document.documentElement, { childList: true, subtree: true });
  scan(document);
  return { toDmy, toIso };
})();

// Hovering a list thumbnail shows it large next to the pointer (ผู้ใช้กำหนด 2026-10-28). One floating box for the
// whole app, fixed position so table cells that clip overflow do not cut it. New thumbnails: add class img-zoom.
const ZOOM_THUMBS = 'img.img-zoom';
(() => {
  if (!window.matchMedia('(hover: hover)').matches) return;
  const box = document.createElement('div');
  box.className = 'img-zoom-box';
  box.hidden = true;
  box.innerHTML = '<img alt="">';
  document.body.appendChild(box);
  const place = (thumb) => {
    const r = thumb.getBoundingClientRect();
    const size = Math.min(200, window.innerWidth - 32, window.innerHeight - 32);
    const left = r.right + 12 + size <= window.innerWidth ? r.right + 12 : Math.max(16, r.left - 12 - size);
    const top = Math.min(Math.max(16, r.top + r.height / 2 - size / 2), window.innerHeight - 16 - size);
    Object.assign(box.style, { left: `${left}px`, top: `${top}px`, width: `${size}px`, height: `${size}px` });
  };
  document.addEventListener('mouseover', (event) => {
    const thumb = event.target.closest?.(ZOOM_THUMBS);
    if (!thumb || !thumb.getAttribute('src')) return;
    box.firstChild.src = thumb.src;
    place(thumb);
    box.hidden = false;
  });
  document.addEventListener('mouseout', (event) => { if (event.target.closest?.(ZOOM_THUMBS)) box.hidden = true; });
  window.addEventListener('scroll', () => { box.hidden = true; }, true);
})();
