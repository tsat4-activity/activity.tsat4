// ระบบกิจกรรม > CFO (Carbon Footprint for Organization): Dashboard (Summary / Scope / TGO forms Fr-01, Fr-03.1,
// Fr-03.2, Fr-04.1 + บันทึกการปรับปรุง),
// transaction (TSATP4-CFO Scope pages + บันทึกกิจกรรม), Setting (plan / activities / emission factors + GWP + reference tables / วัสดุ SAP + Usage / team / company). Server: server/modules/act/cfo.js
// spec: docs/specs/act-cfo.md · uses the shared year (a5Year), page bar slots and team tab of act-5s.js.
const CFO = 'cfo';
// Scope 1/2/3 colours = the shared chart palette (core.js CHART, green here): this year greens, the base year slate.
const CFO_SCOPE_COLORS = CHART_THEMES.cool.series.slice(0, 3);
const CFO_BASE_COLORS = CHART_THEMES.cool.base;
const CFO_ROLE_LABEL = { ...ACT_TEAM_ROLES, admin: 'ผู้ประสานงาน (ผู้จัดทำ)', member: 'สมาชิก (ตัวแทนหน่วยงาน)' }; // TGO forms call the coordinator ผู้จัดทำ
const CFO_DASH_TABS = { summary: 'Summary', scope: 'Scope', usage: 'Usage (SAP)', company: 'Fr-01', team: 'Fr-03.1', fr032: 'Fr-03.2', fr041: 'Fr-04.1', revision: 'บันทึกการปรับปรุง' };
const CFO_SET_TABS = { team: 'ทีม', activities: 'กิจกรรม', ef: 'Emission Factor', material: 'วัสดุ (SAP)', s3: 'Scope 3 (Fr-03.2)', company: 'บริษัท' };
// TGO Fr-03.2 weighted criteria (server s3Rule, ผู้ใช้กำหนด 2026-11-02): level 1–5 per issue · Magnitude comes from the data
const CFO_S3_LEVELS = [
  ['magnitude', 'Magnitude', '% GHG ของหมวด เทียบ Scope 1+2+3 (ระบบคิดจากข้อมูลจริง)'],
  ['influence', 'Level of influence', '1 ไม่มีศักยภาพในการลด · 3 มีแผนเบื้องต้นแต่ยังไม่ได้ตั้งเป้า · 5 มีเป้าหมายในการลด'],
  ['risk', 'Risk', '1 ไม่มีความเสี่ยง · 3 ปานกลาง · 5 มีความเสี่ยง'],
  ['opportunity', 'Opportunity', '1 ไม่มีโอกาส · 3 ปานกลาง · 5 มีโอกาส']
];
const CFO_S3_CHOICE = {
  influence: ['ยังไม่ประเมิน', '1 ไม่มีศักยภาพในการลด', '2', '3 มีแผนแต่ยังไม่ตั้งเป้า', '4', '5 มีเป้าหมายในการลด'],
  risk: ['ยังไม่ประเมิน', '1 ไม่มีความเสี่ยง', '2', '3 ปานกลาง', '4', '5 มีความเสี่ยง'],
  opportunity: ['ยังไม่ประเมิน', '1 ไม่มีโอกาส', '2', '3 ปานกลาง', '4', '5 มีโอกาส']
};
// Quantity formulas (server CFO_CALCS): what the record form asks for and what it turns into.
const CFO_CALCS = {
  septic: { label: 'บ่อเกรอะ (คน × วัน → kg CH₄)', short: 'บ่อเกรอะ', out: 'kg CH₄', fields: [['people', 'จำนวนคน', 1], ['days', 'จำนวนวันทำงาน', 1]],
    qty: (i, s) => i.people * i.days * Number(s.septic_bod || 0) * 0.001 * Number(s.septic_i || 0) * Number(s.septic_b0 || 0) * Number(s.septic_mcf || 0) },
  tkm: { label: 'ขนส่ง (ตัน × กม. → tkm)', short: 'ตัน × กม.', out: 'tkm', unit: /t\.?km/i, fields: [['tons', 'น้ำหนักที่ขนส่ง (ตัน)', 'any'], ['km', 'ระยะทาง (กม.)', 'any']], qty: (i) => i.tons * i.km },
  km_fuel: { label: 'ระยะทาง ÷ อัตราสิ้นเปลือง → ลิตร', short: 'กม. ÷ กม./ลิตร', out: 'ลิตร', unit: /^(l|liter|litre|ลิตร)$/i, fields: [['km', 'ระยะทาง (กม.)', 'any'], ['km_per_l', 'อัตราสิ้นเปลือง (กม./ลิตร)', 'any']], qty: (i) => (i.km_per_l ? i.km / i.km_per_l : 0) }
};
const CFO_SOURCE_TYPES = [['self', 'Self collect (1st)'], ['supplier', 'Supplier (1st)'], ['th_lci', 'TH LCI DB (2nd)'], ['tgo', 'TGO EF (2nd)'], ['thai_res', 'Thai Res. (2nd)'], ['int_db', 'Int. DB (2nd)'], ['other', 'Other']];
const CFO_COMPANY = [['company_name', 'ชื่อธุรกิจ'], ['company_address', 'สถานที่ตั้ง'], ['company_area', 'พื้นที่โรงงาน'], ['company_business', 'ประเภทธุรกิจ'],
  ['company_customers', 'กลุ่มลูกค้าหลัก'], ['company_employees', 'จำนวนพนักงาน'], ['company_updated', 'อัพเดท (วันที่)'], ['company_register', 'วันที่ขอขึ้นทะเบียน'], ['company_photo1', 'ลิงก์รูป 1'], ['company_photo2', 'ลิงก์รูป 2'],
  ['base_year', 'ปีฐาน'], ['target_percent', 'เป้าลด (% จากปีฐาน)'], ['septic_bod', 'บ่อเกรอะ BOD (g/คน/วัน)'], ['septic_b0', 'บ่อเกรอะ B0'], ['septic_mcf', 'บ่อเกรอะ MCF'], ['septic_i', 'บ่อเกรอะ I'],
  ['s3_w_magnitude', 'Fr-03.2 น้ำหนัก Magnitude (%)'], ['s3_w_influence', 'Fr-03.2 น้ำหนัก Influence (%)'], ['s3_w_risk', 'Fr-03.2 น้ำหนัก Risk (%)'],
  ['s3_w_opportunity', 'Fr-03.2 น้ำหนัก Opportunity (%)'], ['s3_pass', 'Fr-03.2 เกณฑ์มีนัยสำคัญ (คะแนน ≥)'], ['s3_mag_bands', 'Fr-03.2 ช่วง % Magnitude ระดับ 2,3,4,5']];
let cfoDashTab = 'summary';
let cfoSetTab = 'team';
// Setting > Emission Factor (ผู้ใช้กำหนด 2026-11-01): GWP + separate reference tables of the TGO sheet
// "EF TGO AR5 V2" (mt_cfo_ef_ref, seed db/act/cfo_ef_ref_seed.sql) so each table is easy to read and add to.
// "EF ที่ใช้คำนวณ" was cut from here (ผู้ใช้สั่ง 2026-11-01); mt_cfo_ef stays for activities and entries.
// table names in English (ผู้ใช้กำหนด 2026-11-02)
const CFO_EF_VIEWS = { energy: 'EF Energy', gwp: 'GWP', chemical: 'GWP Chemicals', ipcc: 'EF IPCC', fuel: 'Fuel Properties', cfp: 'EF CFP' };
let cfoEfView = 'energy';
// tables an activity can take its EF from (server REF_PICK)
const CFO_EF_PICK = ['energy', 'chemical', 'cfp'];
// <optgroup>s of the reference EF that pass keep(r): label = table · group · section (heading rows without a reference,
// e.g. "On-road vehicles"), rows in sheet order · used by the activity form
function cfoEfGroups(keep) {
  return CFO_EF_PICK.map((sheet) => {
    const out = new Map();
    let section = '';
    let grp = null;
    m0().refs.filter((r) => r.sheet === sheet).sort((x, y) => x.sort_no - y.sort_no).forEach((r) => {
      if (r.grp !== grp) { grp = r.grp; section = ''; }
      if (!r.unit && r.total == null && !r.reference) { section = r.name; return; }
      if (!r.unit || r.total == null || r.status !== 'Active' || !keep(r)) return;
      const label = [CFO_EF_VIEWS[sheet], r.grp, section].filter(Boolean).join(' · ');
      out.set(label, [...(out.get(label) || []), r]);
    });
    return [...out].map(([label, list]) => `<optgroup label="${esc(label)}">${list.map((r) => `<option value="ref:${r.id}">${esc(`${r.code ? `[${r.code}] ` : ''}${r.name.replace(/^-\s*/, '')}${r.formula && r.sheet === 'cfp' ? ` · ${r.formula}` : ''} (${cfoRefNum(r.total)} kgCO₂e/${r.unit})`)}</option>`).join('')}</optgroup>`).join('');
  }).join('');
}
let cfoMaster = null; // Setting master data of the open page (cfoEfGroups reads it)
const m0 = () => cfoMaster;
// activity form: Scope picks the categories and the EF that fit it (sep = การปล่อย GHG โดยตรงที่ทำการรายงานแยก)
const CFO_ACT_TYPES = { 1: 'Scope 1', 2: 'Scope 2', 3: 'Scope 3', sep: 'การปล่อย GHG โดยตรงที่ทำการรายงานแยก' };
const cfoBio = (r) => /biogenic/i.test(r.name);
const cfoNonKyoto = (r) => r.sheet === 'chemical' && /HCFC|R-22\b/i.test(r.name);
const CFO_EF_FOR = {
  1: (r) => (r.sheet === 'energy' && r.grp !== 'Electricity' && !cfoBio(r)) || (r.sheet === 'chemical' && !cfoNonKyoto(r)),
  2: (r) => r.sheet === 'energy' && r.grp === 'Electricity',
  3: (r) => r.sheet === 'cfp' || (r.sheet === 'energy' && !cfoBio(r)),
  sep: (r) => cfoBio(r) || cfoNonKyoto(r)
};
// Scope 1 category → EF group (ผู้ใช้กำหนด 2026-11-01): 1-1 = Stationary Source · 1-2 = Mobile Source (On-road / Off-road) · 1-4 = สารทำความเย็น
const CFO_EF_CATEGORY = {
  '1-1': (r) => r.sheet === 'energy' && r.grp === 'Stationary Source',
  '1-2': (r) => r.sheet === 'energy' && r.grp === 'Mobile Source',
  '1-4': (r) => r.sheet === 'chemical'
};
// EF that fits the activity unit for the Scope 3-3 line (Liter = L = litre)
const cfoUnitKey = (u) => String(u || '').trim().toLowerCase().replace(/^(l|liter|litre|ลิตร)$/, 'l');
const CFO_GWP_GASES = [['co2', 'CO₂'], ['ch4_fossil', 'Fossil CH₄'], ['ch4', 'CH₄'], ['n2o', 'N₂O'], ['sf6', 'SF₆'], ['nf3', 'NF₃']];
// Columns of each reference table as in the sheet: [key, label, unit line, number column]
const CFO_REF_COLS = {
  energy: { title: 'GHG Emission Factors for energy consumption (per unit)', cols: [['code', 'id'], ['name', 'Emission Source'], ['unit', 'Units'], ['co2', 'CO₂', '(kgCO₂/unit)', 1], ['ch4_fossil', 'Fossil CH₄', '(kgCH₄/unit)', 1],
    ['ch4', 'CH₄', '(kgCH₄/unit)', 1], ['n2o', 'N₂O', '(kgN₂O/unit)', 1], ['total', 'Total', '(kgCO₂-eq/unit)', 1], ['reference', 'Emission Reference'], ['remark', 'หมายเหตุ']] },
  chemical: { title: 'Global warming potential ของสารเคมี / สารทำความเย็น', cols: [['code', 'id'], ['name', 'Common chemical name'], ['unit', 'Units'], ['total', 'GWP Total', '(kgCO₂-eq/unit)', 1], ['reference', 'Reference']] },
  ipcc: { title: 'GHG Emission Factors from IPCC Guidelines', cols: [['name', 'Emission Source'], ['co2', 'CO₂', '(kgCO₂/TJ)', 1], ['ch4_fossil', 'Fossil CH₄', '(kgCH₄/TJ)', 1], ['ch4', 'CH₄', '(kgCH₄/TJ)', 1],
    ['n2o', 'N₂O', '(kgN₂O/TJ)', 1], ['total', 'Total', '(kgCO₂-eq/TJ)', 1], ['reference', 'Emission Reference']] },
  // grp = Heating value / Density / Conversion Factor: the band row names what the value is
  fuel: { title: 'Defaults for Fuel Heating Value (LHV, NCV) & Other Properties', cols: [['name', 'Fuel'], ['total', 'ค่า', '(ตาม Unit)', 1], ['unit', 'Unit'], ['reference', 'Reference']] },
  // EF ของ CFP (Carbon Footprint of Product) ไว้คำนวณย่อย (ผู้ใช้ขอ 2026-11-01) · grp = หมวด (วัสดุ / ขนส่ง / ของเสีย ...)
  // EF CFP in the column order of อบก. (thaicarbonlabel.tgo.or.th) + id (code) typed in activities / materials (ผู้ใช้กำหนด 2026-11-02)
  // groupCol: กลุ่ม is a column (no band rows) · file = Export / Import columns, one Thai header row like the TGO table
  cfp: { title: 'Emission Factor (CFP) ตาม อบก.', groupCol: true,
    cols: [['code', 'id'], ['grp', 'กลุ่ม'], ['item_no', 'ลำดับ'], ['name', 'ชื่อ'], ['formula', 'รายละเอียด'], ['unit', 'หน่วย'], ['total', 'ค่าแฟคเตอร์', '(kgCO₂e)', 1], ['reference', 'ข้อมูลอ้างอิง'], ['remark', 'วันที่อัพเดท']],
    file: [['code', 'id'], ['grp', 'กลุ่ม'], ['item_no', 'ลำดับ'], ['name', 'ชื่อ'], ['formula', 'รายละเอียด'], ['unit', 'หน่วย'], ['total', 'ค่าแฟคเตอร์ (kgCO2e)'], ['reference', 'ข้อมูลอ้างอิง'], ['remark', 'วันที่อัพเดท'], ['status', 'สถานะ']] }
};
const cfoFilter = { scope: '', department: '', q: '', status: '' };
// page: Summary หน้า 1 (monthly accumulation) / หน้า 2 (summary by Scope), picked in the dropdown before the year
const cfoDash = { department: '', chartScope: '', scope: '1', page: '1' };
// transaction filters: Scope → month (one month, or '' = the year) → category (main) → activity (sub)
const cfoTx = { scope: '1', month: String(new Date().getMonth() + 1), category: '', activity: '' };
const cfoHeads = { entries: { sort: '', dir: 'asc', filters: {} }, activities: { sort: '', dir: 'asc', filters: {} } };
// width class of a reference-table column (app.css .cfo-efgrid .c-*): every EF table lines up (ผู้ใช้กำหนด 2026-11-01)
const cfoCol = (key, num) => (num ? 'c-num' : ['name', 'formula', 'unit', 'reference', 'remark'].includes(key) ? `c-${key}` : ['code', 'item_no'].includes(key) ? 'c-unit' : key === 'grp' ? 'c-formula' : 'c-name');
// reference tables: 5 decimals like the user asked (ผู้ใช้กำหนด 2026-11-01) · the full value is in the cell's tooltip
const cfoRefNum = (v) => (v == null || v === '' ? '' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 5, maximumFractionDigits: 5 }));
// small EF values (1.02e-6) stay readable: exponent below 0.001, else up to 6 decimals like the sheet
const cfoEfNum = (v) => (v == null || v === '' ? '' : Number(v) === 0 ? '0' : Math.abs(v) < 0.001 ? Number(v).toExponential(3) : Number(v).toLocaleString('en-US', { maximumFractionDigits: 6 }));

const cfoT = (n) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 3 });
const cfoPct = (part, total) => (total ? `${Math.round((part / total) * 1000) / 10}%` : '0%');
const cfoMonthIso = (m) => `${a5Year}-${String(m).padStart(2, '0')}`;

// Page frame shared by the three CFO pages: tabs on the left, year (+ extra) on the right, body below.
async function cfoFrame(target, tabs, attr, active, rightExtra = '', { year = true, pick = false } = {}) {
  const me = await a5Api(CFO, `me?year=${a5Year}`);
  target.innerHTML = `<div class="view-body"><section class="card">
    ${pageBar(tabs ? (pick ? a5SetPick(tabs, active) : a5Seg(attr, tabs, active)) : '', `${year ? `<div class="a5-year">${a5YearSelect(me.years)}</div>` : ''}${rightExtra}`, 'a5')}
    <div id="a5-body"><div class="empty">กำลังโหลด...</div></div>
  </section></div>`;
  return { me, body: $('a5-body') };
}

// ---------- Dashboard ----------

async function cfoDashboard(target) {
  const { me, body } = await cfoFrame(target, CFO_DASH_TABS, 'data-cfodash', cfoDashTab);
  const rerender = () => cfoDashboard(target).catch(onErr);
  target.querySelectorAll('[data-cfodash]').forEach((node) => { node.onclick = () => { cfoDashTab = node.dataset.cfodash; rerender(); }; });
  $('a5-year').onchange = () => { a5Year = Number($('a5-year').value); rerender(); };
  if (cfoDashTab === 'scope') return cfoDrawProgress(body);
  if (cfoDashTab === 'usage') return cfoDrawUsage(body);
  if (cfoDashTab === 'company') return cfoDrawCompany(body, me.access.admin, rerender);
  if (cfoDashTab === 'team') return cfoDrawTeam(body, me.access.admin);
  if (cfoDashTab === 'fr032') return cfoDrawS3(body);
  if (cfoDashTab === 'fr041') return cfoDrawInventory(body);
  if (cfoDashTab === 'revision') return cfoDrawRevisions(body);
  document.querySelector('.a5-year').insertAdjacentHTML('beforebegin', field('หน้า', `<select id="cfo-d-page">${options(['1', '2', '3'], cfoDash.page, (v) => (v === '3' ? 'หน้า 3 · ตามก๊าซ' : v === '2' ? 'หน้า 2 · ตาม Scope' : 'หน้า 1 · รายเดือน'))}</select>`));
  $('cfo-d-page').onchange = () => { cfoDash.page = $('cfo-d-page').value; rerender(); };
  if (cfoDash.page === '3') return cfoDrawGases(body);
  return cfoDash.page === '2' ? cfoDrawReport(body) : cfoDrawSummary(body);
}

// Change against the compared year (base year, or last year without one): +x% / −x%.
// Summary (like carbon-form "Accumulation CO2 Emission"): KPI cards with a share pie and a change pill,
// then per month stacked bars (base year next to this year, by Scope) with cumulative lines for this year, the base
// year and the target (base × (1 − target%)). Hover a month for its numbers. Department and Scope filter everything.
async function cfoDrawSummary(body) {
  const d = await a5Api(CFO, `cfo/summary?year=${a5Year}&department=${encodeURIComponent(cfoDash.department)}`);
  const c = d.compare;
  const baseName = c.isBase ? `ค่าปีฐาน (${c.year})` : `ปี ${c.year}`;
  const pick = Number(cfoDash.chartScope) || 0;
  const scopes = pick ? [pick] : [1, 2, 3];
  const cur = d.months.map((m) => (pick ? m.scopes[pick - 1] : m.total));
  const was = d.months.map((m) => (pick ? m.baseScopes[pick - 1] : m.base));
  const hasBase = was.some((v) => v > 0);
  const factor = 1 - c.target / 100;
  const lastMonth = cur.reduce((last, v, i) => (v > 0 ? i : last), -1);
  const cumulative = (list, upto = 11) => { let t = 0; return list.map((v, i) => (i > upto ? null : (t += v))); };
  const cumNow = cumulative(cur, lastMonth);
  const cumBase = hasBase ? cumulative(was) : [];
  const departments = [...new Set([...d.departments.map((x) => x.key), cfoDash.department].filter(Boolean))].sort();
  // Two axes: left = monthly bars, right = cumulative lines (a year adds up to ~12 bars, one axis would flatten them).
  const chart = chartPlot({
    id: 'cfo-area',
    labels: ACT_MONTHS_SHORT,
    left: 'รายเดือน (tCO₂e)',
    right: 'สะสม (tCO₂e)',
    bars: [
      ...(hasBase ? [{ values: d.months.map((m, i) => (pick ? [was[i]] : m.baseScopes)), colors: pick ? [CFO_BASE_COLORS[pick - 1]] : CFO_BASE_COLORS }] : []),
      { values: d.months.map((m, i) => (pick ? [cur[i]] : m.scopes)), colors: pick ? [CFO_SCOPE_COLORS[pick - 1]] : CFO_SCOPE_COLORS }
    ],
    lines: [
      ...(hasBase ? [{ values: cumBase, color: CHART.dark, axis: 'right', labels: 'last' }, { values: cumBase.map((v) => v * factor), color: CHART.target, dash: true, axis: 'right', labels: 'last' }] : []),
      { values: cumNow, color: CHART.line, axis: 'right' }
    ],
    legend: [
      { line: CHART.line, label: 'ค่าปีปัจจุบัน (สะสม)' },
      ...(hasBase ? [{ line: CHART.dark, label: `${baseName} (สะสม)` }, { line: CHART.target, dash: true, label: `ค่าเป้าหมาย (−${c.target}%)` },
        { head: c.isBase ? 'ปีฐาน' : `ปี ${c.year}` }, ...scopes.map((n) => ({ box: CFO_BASE_COLORS[n - 1], label: `Scope ${n}` }))] : []),
      { head: `ปี ${a5Year}` }, ...scopes.map((n) => ({ box: CFO_SCOPE_COLORS[n - 1], label: `Scope ${n}` }))
    ]
  });
  body.innerHTML = `
    <div class="toolbar a5-filters">
      ${field('หน่วยงาน', `<select id="cfo-d-dept">${options(['', ...departments], cfoDash.department, (v) => v || 'ทั้งหมด')}</select>`)}
      ${field('Scope', `<select id="cfo-d-scope">${options(['', '1', '2', '3'], cfoDash.chartScope, (v) => (v ? `Scope ${v}` : 'All Scope'))}</select>`)}
    </div>
    <div class="ch-kpis">
      ${chartKpi({ label: 'Total Emission', value: cfoT(d.total), unit: 'tCO₂e', icon: 'co2', pill: chartPill(d.total, c.total), note: c.total ? `เทียบ${baseName}` : `ไม่มีข้อมูล${baseName}` })}
      ${d.scopes.map((x, i) => chartKpi({ label: `Scope ${x.scope}`, value: cfoT(x.tco2e), unit: 'tCO₂e', pill: chartPill(x.tco2e, c.scopes[i]), note: `${cfoPct(x.tco2e, d.total)} ของทั้งหมด`, color: CFO_SCOPE_COLORS[i], pie: d.total ? (x.tco2e / d.total) * 100 : 0 })).join('')}
    </div>
    ${chartCard(`Accumulation CO₂ Emission${pick ? ` · Scope ${pick}` : ''}`, chart)}
    <div class="table-wrap cfo-month-table"><table class="mo-data-table"><thead><tr><th>เดือน</th>${hasBase ? `<th class="num">${esc(baseName)}</th>` : ''}<th class="num">ปี ${a5Year}</th>${hasBase ? '<th class="num">เป้า</th>' : ''}<th class="num">Scope 1</th><th class="num">Scope 2</th><th class="num">Scope 3</th></tr></thead>
      <tbody>${d.months.map((m) => `<tr><td>${ACT_MONTHS[m.month - 1]}</td>${hasBase ? `<td class="num">${cfoT(m.base)}</td>` : ''}<td class="num">${cfoT(m.total)}</td>${hasBase ? `<td class="num">${cfoT(m.target)}</td>` : ''}${m.scopes.map((x) => `<td class="num">${cfoT(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  a5Lift(body);
  $('cfo-d-dept').onchange = () => { cfoDash.department = $('cfo-d-dept').value; cfoDrawSummary(body).catch(onErr); };
  $('cfo-d-scope').onchange = () => { cfoDash.chartScope = $('cfo-d-scope').value; cfoDrawSummary(body).catch(onErr); };
  // Hover a month: its emission, against the target and the base year.
  chartTip('cfo-area', (i) => {
    const target = was[i] * factor;
    return `<strong>การปล่อยคาร์บอนเดือน ${ACT_MONTHS_SHORT[i]}</strong>
      <div class="ch-tip-row"><span>ปี ${a5Year}</span><b>${cfoT(cur[i])} tCO₂e</b></div>
      ${hasBase ? `<div class="ch-tip-row"><span>${esc(baseName)}</span><b>${cfoT(was[i])}</b></div><div class="ch-tip-row"><span>เป้า</span><b>${cfoT(target)}</b></div>
      ${cur[i] ? `${chartPill(cur[i], target, ' เทียบกับค่าเป้าหมาย')}<div class="ch-tip-note">${chartPill(cur[i], was[i], ` เทียบกับ${c.isBase ? 'ค่าปีฐาน' : `ปี ${c.year}`}`)}</div>` : ''}` : ''}
      <div class="ch-tip-row"><span>สะสมถึงเดือนนี้</span><b>${cfoT(cumNow[i] ?? 0)}</b></div>`;
  });
}

// Dashboard > Summary หน้า 2 (TGO CFO summary sheet, fits one screen): base year next to this year — each Scope and its categories with
// tCO2e, share within the Scope, share of Scope 1+2 and of Scope 1+2+3, then Carbon intensity per piece produced
// (production_<year> in Setting > บริษัท). Filter: department.
async function cfoDrawReport(body) {
  const d = await a5Api(CFO, `cfo/summary?year=${a5Year}&department=${encodeURIComponent(cfoDash.department)}`);
  const c = d.compare;
  const departments = [...new Set([...d.departments.map((x) => x.key), cfoDash.department].filter(Boolean))].sort();
  const years = [{ key: 'base', year: c.year, title: c.isBase ? `ปีฐาน ${c.year}` : `ปี ${c.year} (ยังไม่ตั้งปีฐาน)` }, { key: 'tco2e', year: a5Year, title: `ปีปัจจุบัน ${a5Year}` }];
  const pct = (part, total) => (total ? (Math.round((part / total) * 10000) / 100).toFixed(2) : '-');
  const table = ({ key, year, title }) => {
    const byScope = [1, 2, 3].map((n) => d.categories.filter((g) => g.scope === n).reduce((t, g) => t + g[key], 0));
    const s12 = byScope[0] + byScope[1];
    const s123 = s12 + byScope[2];
    const pieces = Number(d.settings[`production_${year}`]) || 0;
    const row = (cls, label, v, inScope, scope) => `<tr class="${cls}"><td>${label}</td><td class="num">${cfoT(v)}</td><td class="num">${inScope}</td>
      <td class="num">${scope < 3 ? pct(v, s12) : ''}</td><td class="num">${pct(v, s123)}</td></tr>`;
    const rows = [1, 2, 3].map((n) => row('cfo-group', `Scope ${n}`, byScope[n - 1], byScope[n - 1] ? '100.00' : '-', n)
      + d.categories.filter((g) => g.scope === n).map((g) => row('cfo-sub', esc(g.label), g[key], pct(g[key], byScope[n - 1]), n)).join('')).join('');
    const intensity = (label, v) => `<tr><td>Carbon intensity (${label})</td><td class="num">${pieces ? (v / pieces).toFixed(4) : '-'}</td><td colspan="3" class="sum-meta">tCO₂e / ชิ้น · ${pieces ? `ผลิต ${cfoT(pieces)} ชิ้น` : 'ใส่ปริมาณผลิตที่ Setting > บริษัท'}</td></tr>`;
    return chartCard(title, `<div class="table-wrap cfo-report"><table class="mo-data-table"><thead><tr><th>ขอบเขต</th><th class="num">tCO₂e</th><th class="num">สัดส่วน (%)</th><th class="num">สัดส่วน (%)<br>Scope 1+2</th><th class="num">สัดส่วน (%)<br>Scope 1+2+3</th></tr></thead>
      <tbody>${rows}
        <tr class="cfo-total"><td>รวม Scope 1 + 2</td><td class="num">${cfoT(s12)}</td><td></td><td class="num">${s12 ? '100.00' : '-'}</td><td></td></tr>
        <tr class="cfo-total"><td>รวม Scope 1 + 2 + 3</td><td class="num">${cfoT(s123)}</td><td></td><td></td><td class="num">${s123 ? '100.00' : '-'}</td></tr>
        <tr><td>อื่นๆ (รายงานแยก)</td><td class="num">${cfoT(d.separate?.[key] || 0)}</td><td colspan="3" class="sum-meta">ไม่รวมในยอด Scope</td></tr>
        ${intensity('Scope 1+2', s12)}${intensity('Scope 1+2+3', s123)}</tbody></table></div>`, 'ม.ค. – ธ.ค.');
  };
  const scopeSum = (key) => [1, 2, 3].map((n) => d.categories.filter((g) => g.scope === n).reduce((t, g) => t + g[key], 0));
  const [was, now] = [scopeSum('base'), scopeSum('tco2e')];
  const chart = chartPlot({
    id: 'cfo-cmp', labels: ['Scope 1', 'Scope 2', 'Scope 3'], left: 'tCO₂e',
    bars: [{ values: was, colors: [CFO_BASE_COLORS[1]] }, { values: now, colors: [CFO_SCOPE_COLORS[0]] }],
    legend: [{ box: CFO_BASE_COLORS[1], label: years[0].title }, { box: CFO_SCOPE_COLORS[0], label: years[1].title }]
  });
  body.innerHTML = `
    <div class="toolbar a5-filters">${field('หน่วยงาน', `<select id="cfo-d-dept">${options(['', ...departments], cfoDash.department, (v) => v || 'ทั้งหมด')}</select>`)}${button('cfo-export', 'ดาวน์โหลด Excel', 'secondary')}</div>
    <div class="cfo-report-page">${chartCard('เปรียบเทียบตาม Scope', chart, 'tCO₂e ทั้งปี')}
    <div class="a5-two">${years.map(table).join('')}</div></div>`;
  a5Lift(body);
  $('cfo-d-dept').onchange = () => { cfoDash.department = $('cfo-d-dept').value; cfoDrawReport(body).catch(onErr); };
  $('cfo-export').onclick = () => cfoDownload(`cfo-summary-${a5Year}.csv`, [
    ['ขอบเขต', 'ปี', 'tCO2e'],
    ...d.categories.flatMap((g) => [[g.label, years[0].year, g.base], [g.label, years[1].year, g.tco2e]]),
    ...(d.gases || []).map((g) => [g.scope ? `Scope ${g.scope}` : 'รวม', 'CO2', g.co2, 'CH4', g.ch4, 'N2O', g.n2o, 'F-gas', g.fgas])
  ]);
  chartTip('cfo-cmp', (i) => `<strong>Scope ${i + 1}</strong>
    <div class="ch-tip-row"><span>${esc(years[0].title)}</span><b>${cfoT(was[i])} tCO₂e</b></div>
    <div class="ch-tip-row"><span>${esc(years[1].title)}</span><b>${cfoT(now[i])} tCO₂e</b></div>
    ${now[i] && was[i] ? chartPill(now[i], was[i], ` เทียบ${esc(years[0].title)}`) : ''}`);
}

// Dashboard > Summary หน้า 3: CO₂ / CH₄ / N₂O and fluorinated gases together. SF₆ and NF₃ are not stored separately.
async function cfoDrawGases(body) {
  const d = await a5Api(CFO, `cfo/summary?year=${a5Year}&department=${encodeURIComponent(cfoDash.department)}`);
  const departments = [...new Set([...d.departments.map((x) => x.key), cfoDash.department].filter(Boolean))].sort();
  const names = [['co2', 'CO₂'], ['ch4', 'CH₄'], ['n2o', 'N₂O'], ['sf6nf3', 'SF₆ + NF₃'], ['fgas', 'HFCs + PFCs']];
  const rows = (d.gases || []).map((g) => `<tr class="${g.scope ? '' : 'cfo-total'}"><td>${g.scope ? `Scope ${g.scope}` : 'รวม'}</td>${names.map(([key]) => `<td class="num">${cfoT(g[key])}</td>`).join('')}</tr>`).join('');
  body.innerHTML = `
    <div class="toolbar a5-filters">${field('หน่วยงาน', `<select id="cfo-d-dept">${options(['', ...departments], cfoDash.department, (v) => v || 'ทั้งหมด')}</select>`)}</div>
    ${chartCard(`สรุปตามก๊าซ ปี ${a5Year}`, `<div class="table-wrap"><table class="mo-data-table"><thead><tr><th>ขอบเขต</th>${names.map(([, label]) => `<th class="num">${label}</th>`).join('')}</tr></thead><tbody>${rows || '<tr><td colspan="6" class="empty">ยังไม่มีรายการ</td></tr>'}</tbody></table></div>`, 'tCO₂e · ไม่รวมรายการที่รายงานแยก')}
    <p class="sum-meta">แยกรายก๊าซครบทุกคอลัมน์ และก๊าซนอกข้อกำหนด ดูที่แท็บ Fr-04.1</p>`;
  a5Lift(body);
  $('cfo-d-dept').onchange = () => { cfoDash.department = $('cfo-d-dept').value; cfoDrawGases(body).catch(onErr); }
}

function cfoDownload(name, rows) {
  const csv = `\uFEFF${rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')}`;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

// ---------- TGO forms ----------

// Fr-03.2 (ผู้ใช้กำหนด 2026-11-02): weighted score of levels 1–5, ≥ pass = significant; Sector guidance ✓ = significant at once.
const cfoS3Name = (r) => `${esc(r.name)}${r.name_th ? `<div class="sum-meta">${esc(r.name_th)}</div>` : ''}`;
const cfoS3Score = (r, rule) => Math.round(CFO_S3_LEVELS.reduce((sum, [k]) => sum + (Number(r[k]) || 0) * (rule.weights[k] / 100), 0) * 100) / 100;
const cfoS3Explain = (rule) => {
  const b = rule.bands;
  return `<details class="cfo-explain"><summary>หลักเกณฑ์การประเมินความมีนัยสำคัญ (ถ่วงน้ำหนัก)</summary>
  <div class="table-wrap"><table class="mo-data-table cfo-s3-rule"><thead><tr><th>ประเด็น</th><th class="cfo-c">1</th><th class="cfo-c">2</th><th class="cfo-c">3</th><th class="cfo-c">4</th><th class="cfo-c">5</th><th class="num">น้ำหนัก</th></tr></thead><tbody>
    <tr><td>Magnitude (% GHG เทียบ Scope 1+2+3)</td><td class="cfo-c">&lt;${b[0]}%</td><td class="cfo-c">${b[0]}–&lt;${b[1]}%</td><td class="cfo-c">${b[1]}–&lt;${b[2]}%</td><td class="cfo-c">${b[2]}–&lt;${b[3]}%</td><td class="cfo-c">≥${b[3]}%</td><td class="num">${rule.weights.magnitude}%</td></tr>
    <tr><td>Level of influence</td><td class="cfo-c">ไม่มีศักยภาพในการลด</td><td></td><td class="cfo-c">มีแผนเบื้องต้นแต่ยังไม่ได้ตั้งเป้า</td><td></td><td class="cfo-c">มีเป้าหมายในการลด</td><td class="num">${rule.weights.influence}%</td></tr>
    <tr><td>Risk</td><td class="cfo-c">ไม่มีความเสี่ยง</td><td></td><td class="cfo-c">ปานกลาง</td><td></td><td class="cfo-c">มีความเสี่ยง</td><td class="num">${rule.weights.risk}%</td></tr>
    <tr><td>Opportunity</td><td class="cfo-c">ไม่มีโอกาส</td><td></td><td class="cfo-c">ปานกลาง</td><td></td><td class="cfo-c">มีโอกาส</td><td class="num">${rule.weights.opportunity}%</td></tr>
    <tr><td>Sector guidance</td><td class="cfo-c" colspan="5">✓ = Sector guidance แนะนำให้ใช้ประเมิน ถือว่า Category นั้นมีนัยสำคัญ</td><td class="num">—</td></tr>
    <tr><td>Outsourcing · Employee engagement</td><td class="cfo-c" colspan="5">องค์กรไม่พิจารณาประเด็นนี้</td><td class="num">—</td></tr>
  </tbody></table></div>
  <p class="sum-meta">คะแนน = Magnitude × ${rule.weights.magnitude}% + Influence × ${rule.weights.influence}% + Risk × ${rule.weights.risk}% + Opportunity × ${rule.weights.opportunity}% · ≥ ${rule.pass} = มีนัยสำคัญ นับรวมในขอบเขต · &lt; ${rule.pass} = ไม่มีนัยสำคัญ · น้ำหนักและเกณฑ์แก้ที่ Setting > บริษัท · ที่มา: หัวข้อที่ 12 ข้อกำหนดในการคำนวณและรายงานคาร์บอนฟุตพริ้นท์ขององค์กร</p></details>`;
};
const cfoS3Head = `<tr><th>No</th><th>Category</th><th class="cfo-c">Source of GHG</th><th class="num">tCO₂e</th><th class="num">% GHG</th>${CFO_S3_LEVELS.map(([, label]) => `<th class="cfo-c">${label}</th>`).join('')}<th class="cfo-c">Sector guidance</th><th class="num">คะแนน</th><th class="cfo-c">ผล</th><th>Remark</th></tr>`;
const cfoS3Result = (r, rule) => (!r.has_source ? '-' : r.sector || cfoS3Score(r, rule) >= rule.pass ? '<b class="cfo-s3-yes">มีนัยสำคัญ</b>' : '<span class="sum-meta">ไม่มีนัยสำคัญ</span>');

// Dashboard > Fr-03.2 ประเมินความมีนัยสำคัญ Scope 3 (read only; Setting > Scope 3 edits).
async function cfoDrawS3(body) {
  const d = await a5Api(CFO, `cfo/s3?year=${a5Year}`);
  const note = d.fromYear === d.year ? '' : d.fromYear ? `ยังไม่ได้ประเมินปี ${d.year} · แสดงผลของปี ${d.fromYear}` : `ยังไม่ได้ประเมินปี ${d.year}`;
  body.innerHTML = chartCard(`ประเมินความมีนัยสำคัญของการปล่อยก๊าซเรือนกระจกทางอ้อม (Scope 3) ปี ${d.year}`, `${cfoS3Explain(d.rule)}
    <div class="table-wrap cfo-s3"><table class="mo-data-table"><thead>${cfoS3Head}</thead><tbody>${d.rows.map((r, i) => `<tr class="${r.significant ? 'is-significant' : 'is-muted'}">
      <td>${i + 1}</td><td>${cfoS3Name(r)}</td><td class="cfo-c">${r.has_source ? '✓' : '×'}</td><td class="num">${r.tco2e ? cfoT(r.tco2e) : ''}</td><td class="num">${r.has_source ? `${r.share.toFixed(2)}%` : ''}</td>
      ${CFO_S3_LEVELS.map(([k]) => `<td class="cfo-c">${r.has_source && r[k] ? r[k] : ''}</td>`).join('')}<td class="cfo-c">${r.has_source && r.sector ? '✓' : ''}</td>
      <td class="num">${r.has_source ? r.score.toFixed(2) : ''}</td><td class="cfo-c">${cfoS3Result(r, d.rule)}</td><td>${esc(r.remark)}</td></tr>`).join('')}</tbody></table></div>`,
    `${note ? `${note} · ` : ''}มีนัยสำคัญ ${d.rows.filter((r) => r.significant).length} / ${d.rows.length} หมวด · Scope 1+2+3 ปีนี้ ${cfoT(d.total)} tCO₂e`);
}

// Setting > Scope 3 (Fr-03.2): Source ✓ · Magnitude from the data (read only) · Influence / Risk / Opportunity 1–5 ·
// Sector guidance ✓ · the score and the result follow each change; Save keeps the year (with the Magnitude shown).
async function cfoSetS3(body, rerender) {
  const d = await a5Api(CFO, `cfo/s3?year=${a5Year}`);
  const off = d.admin ? '' : ' disabled';
  const pick = (i, k, v) => `<select data-s3="${i}" data-k="${k}"${off}>${CFO_S3_CHOICE[k].map((label, n) => `<option value="${n}"${Number(v) === n ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
  body.innerHTML = `
    ${d.admin ? `<div class="action-bar a5-actions">${button('cfo-s3-save', 'บันทึก', 'primary')}</div>` : ''}
    ${d.fromYear !== d.year ? `<p class="sum-meta">${d.fromYear ? `ยังไม่ได้ประเมินปี ${d.year} · ตั้งต้นจากปี ${d.fromYear} กดบันทึกเพื่อใช้เป็นของปีนี้` : `ยังไม่ได้ประเมินปี ${d.year}`}</p>` : ''}
    ${cfoS3Explain(d.rule)}
    <div class="table-wrap cfo-s3"><table class="mo-data-table"><thead>${cfoS3Head}</thead><tbody>${d.rows.map((r, i) => `<tr>
      <td>${i + 1}</td><td>${cfoS3Name(r)}</td><td class="cfo-c"><input type="checkbox" data-s3="${i}" data-k="has_source"${r.has_source ? ' checked' : ''}${off}></td>
      <td class="num">${r.tco2e ? cfoT(r.tco2e) : ''}</td><td class="num">${r.share.toFixed(2)}%</td><td class="cfo-c" title="จาก % GHG ของปี ${d.year}"><b>${r.magnitude}</b></td>
      ${['influence', 'risk', 'opportunity'].map((k) => `<td class="cfo-c">${pick(i, k, r[k])}</td>`).join('')}
      <td class="cfo-c"><input type="checkbox" data-s3="${i}" data-k="sector"${r.sector ? ' checked' : ''}${off}></td>
      <td class="num" id="cfo-s3-score-${i}"></td><td class="cfo-c" id="cfo-s3-sig-${i}"></td><td><input data-s3-remark="${i}" maxlength="1000" value="${esc(r.remark)}"${d.admin ? '' : ' readonly'}></td></tr>`).join('')}</tbody></table></div>
    <p class="sum-meta">Magnitude คิดจากข้อมูลปี ${d.year}: tCO₂e ของหมวด ÷ Scope 1+2+3 (${cfoT(d.total)} tCO₂e) · บันทึกแล้วเก็บระดับ ณ วันนั้น</p>`;
  a5Lift(body);
  const val = (i, k) => body.querySelector(`[data-s3="${i}"][data-k="${k}"]`);
  const read = (i) => ({ ...d.rows[i], has_source: val(i, 'has_source').checked, sector: val(i, 'sector').checked,
    influence: Number(val(i, 'influence').value), risk: Number(val(i, 'risk').value), opportunity: Number(val(i, 'opportunity').value),
    remark: body.querySelector(`[data-s3-remark="${i}"]`).value });
  const mark = (i) => {
    const r = read(i);
    ['influence', 'risk', 'opportunity', 'sector'].forEach((k) => { val(i, k).disabled = !d.admin || !r.has_source; });
    $(`cfo-s3-score-${i}`).textContent = r.has_source ? cfoS3Score(r, d.rule).toFixed(2) : '';
    $(`cfo-s3-sig-${i}`).innerHTML = cfoS3Result(r, d.rule);
  };
  d.rows.forEach((_, i) => mark(i));
  body.querySelectorAll('[data-s3]').forEach((node) => { node.onchange = () => mark(Number(node.dataset.s3)); });
  if (!d.admin) return;
  $('cfo-s3-save').onclick = async () => {
    await a5Api(CFO, 'cfo/s3', { method: 'PUT', body: { year: a5Year, rows: d.rows.map((_, i) => read(i)) } });
    toast('บันทึกแล้ว');
    rerender();
  };
}

// Dashboard > Fr-04.1 บัญชีรายการก๊าซเรือนกระจก (Fr-04.2 = the same form for the base year): the TGO sheet's
// columns per activity for the whole year. Groups Scope 1 / รายงานแยก / Scope 2 / Scope 3 with their totals.
const CFO_INV_GROUPS = [['s1', 'ขอบเขต 1'], ['separate', 'การปล่อย GHG โดยตรงที่ทำการรายงานแยก'], ['s2', 'ขอบเขต 2'], ['s3', 'ขอบเขต 3']];
const CFO_INV_EF = [['co2', 'CO₂'], ['ch4_fossil', 'Fossil CH₄'], ['ch4', 'CH₄'], ['n2o', 'N₂O'], ['sf6', 'SF₆'], ['nf3', 'NF₃'], ['hfc', 'HFCs'], ['pfc', 'PFCs'], ['hfc_gwp', 'GWP HFCs'], ['pfc_gwp', 'GWP PFCs']];
const CFO_INV_TON = [['co2', 'CO₂'], ['ch4_fossil', 'Fossil CH₄'], ['ch4', 'CH₄'], ['n2o', 'N₂O'], ['sf6', 'SF₆'], ['nf3', 'NF₃']];
const CFO_INV_CO2E = [['ch4_fossil', 'Fossil CH₄'], ['ch4', 'CH₄'], ['n2o', 'N₂O'], ['sf6', 'SF₆'], ['nf3', 'NF₃'], ['hfc', 'HFCs'], ['pfc', 'PFCs'], ['other', 'Other']];
let cfoInvBase = false;

async function cfoDrawInventory(body) {
  const d = await a5Api(CFO, `cfo/inventory?year=${a5Year}${cfoInvBase ? '&base=1' : ''}&department=${encodeURIComponent(cfoDash.department)}`);
  const num = (v, digits = 6) => (v ? Number(v).toLocaleString('en-US', { maximumFractionDigits: digits }) : '');
  const sumOf = (list, pick) => list.reduce((t, r) => t + (pick(r) || 0), 0);
  const groups = Object.fromEntries(CFO_INV_GROUPS.map(([g]) => [g, d.rows.filter((r) => r.group === g)]));
  const total = Object.fromEntries(CFO_INV_GROUPS.map(([g]) => [g, sumOf(groups[g], (r) => r.total)]));
  const s12 = total.s1 + total.s2;
  const s123 = s12 + total.s3;
  const pct = (v, all) => (all && v ? ((v / all) * 100).toFixed(2) : '');
  const source = (k) => (CFO_SOURCE_TYPES.find(([key]) => key === k) || [, ''])[1];
  const span = 3 + CFO_INV_EF.length + 2 + 1 + 3;
  const line = (r) => `<tr><td title="${esc(r.department)} · ${esc(r.source)}">${esc(r.activity)}<div class="sum-meta">${esc(r.department)} · ${esc(r.scope_code)}</div></td><td>${esc(r.unit)}</td><td class="num">${num(r.qty, 3) || '0'}</td>
    ${CFO_INV_EF.map(([k]) => `<td class="num">${num(r.ef[k])}</td>`).join('')}<td class="num">${num(r.ef.other)}</td><td class="num">${num(r.ef.other_gwp)}</td>
    <td class="num"><b>${num(r.total_ef)}</b></td><td>${esc(source(r.source_type))}</td><td>${esc(r.substitute || '')}</td><td class="cfo-ref" title="${esc(r.reference || '')}">${esc(r.reference || '')}</td>
    ${CFO_INV_TON.map(([k]) => `<td class="num">${num(r.ton[k])}</td>`).join('')}${CFO_INV_CO2E.map(([k]) => `<td class="num">${num(r.tco2e[k])}</td>`).join('')}
    <td class="num"><b>${num(r.total)}</b></td><td class="num">${pct(r.total, total[r.group])}</td><td class="num">${['s1', 's2'].includes(r.group) ? pct(r.total, s12) : ''}</td><td class="num">${r.group === 'separate' ? '' : pct(r.total, s123)}</td></tr>`;
  const sums = (label, list, value, cls = 'cfo-total') => `<tr class="${cls}"><td colspan="${span}">${label}</td>
    ${CFO_INV_TON.map(([k]) => `<td class="num">${num(sumOf(list, (r) => r.ton[k]))}</td>`).join('')}${CFO_INV_CO2E.map(([k]) => `<td class="num">${num(sumOf(list, (r) => r.tco2e[k]))}</td>`).join('')}
    <td class="num"><b>${num(value)}</b></td><td colspan="3"></td></tr>`;
  const bodyRows = CFO_INV_GROUPS.map(([g, label]) => `<tr class="cfo-group"><td colspan="${span + CFO_INV_TON.length + CFO_INV_CO2E.length + 4}">${label}</td></tr>
    ${groups[g].map(line).join('') || `<tr><td colspan="${span + CFO_INV_TON.length + CFO_INV_CO2E.length + 4}" class="empty">ไม่มีรายการ</td></tr>`}
    ${sums(`รวม ${label}`, groups[g], total[g], 'cfo-sub-total')}`).join('')
    + sums('รวม Scope 1 + 2', [...groups.s1, ...groups.s2], s12) + sums('รวม Scope 1 + 2 + 3', [...groups.s1, ...groups.s2, ...groups.s3], s123);
  const head = `<tr><th rowspan="2">รายการ</th><th rowspan="2">หน่วย</th><th rowspan="2" class="num">ปริมาณ</th>
      <th colspan="${CFO_INV_EF.length}" class="cfo-c">GHG ที่ต้องรายงานตามข้อกำหนด · ค่า EF (kg GHG/หน่วย)</th><th colspan="2" class="cfo-c">GHG นอกข้อกำหนด</th>
      <th rowspan="2" class="num">Total<br>(kgCO₂e/หน่วย)</th><th rowspan="2">ที่มา</th><th rowspan="2">Substitute</th><th rowspan="2">แหล่งอ้างอิง</th>
      <th colspan="${CFO_INV_TON.length}" class="cfo-c">ผลคูณ (ton GHG)</th><th colspan="${CFO_INV_CO2E.length}" class="cfo-c">ผลคูณ (tCO₂e)</th>
      <th rowspan="2" class="num">Total GHG<br>(tCO₂e)</th><th rowspan="2" class="num">สัดส่วน<br>(%)</th><th rowspan="2" class="num">สัดส่วน (%)<br>Scope 1+2</th><th rowspan="2" class="num">สัดส่วน (%)<br>Scope 1+2+3</th></tr>
    <tr>${CFO_INV_EF.map(([, l]) => `<th class="num">${l}</th>`).join('')}<th class="num">EF</th><th class="num">GWP</th>
      ${CFO_INV_TON.map(([, l]) => `<th class="num">${l}</th>`).join('')}${CFO_INV_CO2E.map(([, l]) => `<th class="num">${l}</th>`).join('')}</tr>`;
  const g = d.gwp || {};
  const departments = [...new Set([...d.rows.map((r) => r.department), cfoDash.department].filter(Boolean))].sort();
  body.innerHTML = `
    <div class="toolbar a5-filters">
      ${field('ฟอร์ม', `<select id="cfo-inv-form">${options(['0', '1'], cfoInvBase ? '1' : '0', (v) => (v === '1' ? `Fr-04.2 · ปีฐาน${d.baseYear ? ` ${d.baseYear}` : ''}` : `Fr-04.1 · ปี ${a5Year}`))}</select>`)}
      ${field('หน่วยงาน', `<select id="cfo-d-dept">${options(['', ...departments], cfoDash.department, (v) => v || 'ทั้งหมด')}</select>`)}
      ${button('cfo-export', 'ดาวน์โหลด Excel', 'secondary')}
    </div>
    ${chartCard(`บัญชีรายการก๊าซเรือนกระจก${cfoInvBase ? ' ปีฐาน' : ''} ปี ${d.year}`, `<div class="table-wrap cfo-inv"><table class="mo-data-table"><thead>${head}</thead><tbody>${bodyRows}</tbody></table></div>
      <p class="sum-meta">GWP100 ${esc(g.code || '')}: CO₂ ${num(g.co2)} · Fossil CH₄ ${num(g.ch4_fossil)} · CH₄ ${num(g.ch4)} · N₂O ${num(g.n2o)} · SF₆ ${num(g.sf6)} · NF₃ ${num(g.nf3)} · Total = Σ EF × GWP · ผลคูณ = ปริมาณ × EF (× GWP) / 1000</p>`,
      `${d.rows.length} รายการ · รวม Scope 1+2+3 ${cfoT(s123)} tCO₂e`)}`;
  a5Lift(body);
  $('cfo-inv-form').onchange = () => { cfoInvBase = $('cfo-inv-form').value === '1'; cfoDrawInventory(body).catch(onErr); };
  $('cfo-d-dept').onchange = () => { cfoDash.department = $('cfo-d-dept').value; cfoDrawInventory(body).catch(onErr); };
  $('cfo-export').onclick = () => cfoDownload(`cfo-fr04-${d.year}.csv`, [
    ['ขอบเขต', 'รายการ', 'หน่วยงาน', 'หน่วย', 'ปริมาณ', ...CFO_INV_EF.map(([, l]) => `EF ${l}`), 'EF นอกข้อกำหนด', 'GWP นอกข้อกำหนด', 'Total (kgCO2e/หน่วย)', 'ที่มา', 'Substitute', 'แหล่งอ้างอิง',
      ...CFO_INV_TON.map(([, l]) => `ton ${l}`), ...CFO_INV_CO2E.map(([, l]) => `tCO2e ${l}`), 'Total GHG (tCO2e)'],
    ...d.rows.map((r) => [CFO_INV_GROUPS.find(([k]) => k === r.group)?.[1] || r.group, r.activity, r.department, r.unit, r.qty, ...CFO_INV_EF.map(([k]) => r.ef[k] ?? ''), r.ef.other, r.ef.other_gwp,
      r.total_ef, source(r.source_type), r.substitute || '', r.reference || '', ...CFO_INV_TON.map(([k]) => r.ton[k]), ...CFO_INV_CO2E.map(([k]) => r.tco2e[k]), r.total])
  ]);
}

// Dashboard > บันทึกการปรับปรุง: what changed in master data, settings and confirmations (written by the server),
// plus notes the admin adds. Search + area filter.
const cfoRev = { q: '', area: '' };
// Dashboard > Usage (SAP) (ผู้ใช้กำหนด 2026-11-02): the SAP Usage counted for a month (or the whole year) —
// costcenters by tCO₂e most first with money (บาท) and Top 5 materials · server cfo/usage-report
const cfoUsageView = { month: '' };
const cfoBaht = (n) => (n == null ? '' : Number(n).toLocaleString('th-TH', { maximumFractionDigits: 0 }));
async function cfoDrawUsage(body) {
  const month = cfoUsageView.month ? `${a5Year}-${cfoUsageView.month.padStart(2, '0')}` : '';
  const d = await a5Api(CFO, `cfo/usage-report?year=${a5Year}${month ? `&month=${month}` : ''}`);
  const have = d.months.map((x) => String(Number(x.month.slice(5, 7))));
  const all = d.total.tco2e || 0;
  const title = month ? `${ACT_MONTHS[Number(cfoUsageView.month) - 1]} ${a5Year}` : `ทั้งปี ${a5Year}`;
  body.innerHTML = `
    <div class="toolbar a5-filters">
      ${field('เดือน', `<select id="cfo-us-month">${options(['', ...have], cfoUsageView.month, (v) => (v ? ACT_MONTHS[Number(v) - 1] : 'ทั้งปี'))}</select>`)}
    </div>
    <div class="ch-kpis">
      ${chartKpi({ label: `Usage ${title}`, value: cfoT(d.total.tco2e), unit: 'tCO₂e', icon: 'co2', note: `${d.total.lines.toLocaleString()} บรรทัดที่คิดได้` })}
      ${chartKpi({ label: 'มูลค่าที่ใช้', value: cfoBaht(d.total.amount), unit: 'บาท', icon: 'payments', note: 'เฉพาะรายการที่คิด tCO₂e ได้' })}
      ${chartKpi({ label: 'Costcenter', value: d.costcenters.length.toLocaleString(), icon: 'apartment', note: d.costcenters[0] ? `มากสุด ${esc(d.costcenters[0].costcenter || d.costcenters[0].department)}` : '' })}
    </div>
    ${chartCard(`Top 5 รายการที่ปล่อยมากสุด · ${title}`, `<div class="table-wrap"><table class="mo-data-table"><thead><tr><th class="num">#</th><th>Material</th><th>รายการ</th><th class="num">ปริมาณ</th><th>หน่วย</th><th class="num">tCO₂e</th><th class="num">%</th><th class="num">เงิน (บาท)</th></tr></thead>
      <tbody>${d.top.map((x, i) => `<tr><td class="num">${i + 1}</td><td>${esc(x.material)}</td><td title="${esc(x.name)}">${esc(x.name)}</td><td class="num">${cfoT(x.qty)}</td><td>${esc(x.unit || '')}</td><td class="num"><b>${cfoT(x.tco2e)}</b></td>
        <td class="num">${all ? Math.round((x.tco2e / all) * 100) : 0}%</td><td class="num">${cfoBaht(x.amount)}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">ยังไม่มี Usage ที่คิดได้</td></tr>'}</tbody></table></div>`)}
    ${chartCard(`Costcenter เรียงจากปล่อยมากไปน้อย · ${title}`, `<div class="table-wrap"><table class="mo-data-table"><thead><tr><th class="num">#</th><th>Costcenter</th><th>ชื่อ</th><th>Section</th><th class="num">รายการ</th><th class="num">tCO₂e</th><th class="num">%</th><th class="num">เงิน (บาท)</th></tr></thead>
      <tbody>${d.costcenters.map((x, i) => `<tr><td class="num">${i + 1}</td><td>${esc(x.costcenter || '-')}</td><td title="${esc(x.name)}">${esc(x.name)}</td><td>${esc(x.department)}</td><td class="num">${x.items}</td>
        <td class="num"><b>${cfoT(x.tco2e)}</b></td><td class="num">${all ? Math.round((x.tco2e / all) * 100) : 0}%</td><td class="num">${cfoBaht(x.amount)}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">ยังไม่มี Usage · วางได้ที่ Setting > วัสดุ (SAP) > วาง Usage</td></tr>'}</tbody></table></div>`)}
    <p class="sum-meta">คิดเฉพาะวัสดุที่มี EF + ตัวแปลง (Setting > วัสดุ (SAP)) · เงิน = คอลัมน์ total ของไฟล์ SAP (ไม่มี = ปริมาณ × ราคา)${d.costcenter || !d.total.lines ? '' : ' · เดือนที่วางก่อนเพิ่มคอลัมน์ costcenter แสดงตาม Section: วางเดือนนั้นใหม่เพื่อแยก costcenter'}</p>`;
  $('cfo-us-month').onchange = () => { cfoUsageView.month = $('cfo-us-month').value; cfoDrawUsage(body).catch(onErr); };
}

async function cfoDrawRevisions(body) {
  const d = await a5Api(CFO, 'cfo/revisions');
  const areas = [...new Set(d.rows.map((r) => r.area))].sort();
  const draw = () => {
    const term = cfoRev.q.trim().toLowerCase();
    const list = d.rows.filter((r) => (!cfoRev.area || r.area === cfoRev.area) && (!term || `${r.ref || ''} ${r.detail} ${r.by} ${r.by_name}`.toLowerCase().includes(term)));
    $('cfo-rev-rows').innerHTML = `<table class="mo-data-table"><thead><tr><th>วันที่</th><th class="num">ลำดับ</th><th>ส่วนที่แก้</th><th>ตำแหน่ง</th><th>รายละเอียด</th><th>ผู้ทำการแก้ไข</th></tr></thead>
      <tbody>${list.map((r) => `<tr><td>${new Date(r.at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</td><td class="num">${r.no}</td><td>${esc(r.area)}</td><td>${esc(r.ref || '')}</td>
        <td class="cfo-rev-detail" title="${esc(r.detail)}">${esc(r.detail)}</td><td>${esc(r.by_name || r.by)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">ยังไม่มีบันทึก</td></tr>'}</tbody></table>`;
  };
  body.innerHTML = `
    <div class="toolbar a5-filters">
      ${field('ส่วนที่แก้', `<select id="cfo-rev-area">${options(['', ...areas], cfoRev.area, (v) => v || 'ทั้งหมด')}</select>`)}
      ${searchSlot('ค้นหา', 'cfo-rev-q', 'cfo-rev-search', { placeholder: 'รายการ รายละเอียด หรือผู้แก้ไข' })}
      ${d.admin ? `<div class="action-bar">${button('cfo-rev-add', 'เพิ่มบันทึก', 'primary')}</div>` : ''}
    </div>
    <div class="table-wrap" id="cfo-rev-rows"></div>
    <p class="sum-meta">${d.rows.length} รายการ · ระบบบันทึกให้เองเมื่อผู้จัดทำแก้ EF กิจกรรม ตั้งค่า Fr-03.2 และยืนยัน/เปิดข้อมูล · ลบไม่ได้</p>`;
  $('cfo-rev-q').value = cfoRev.q;
  draw();
  a5Lift(body);
  $('cfo-rev-area').onchange = () => { cfoRev.area = $('cfo-rev-area').value; draw(); };
  const search = () => { cfoRev.q = $('cfo-rev-q').value; draw(); };
  $('cfo-rev-search').onclick = search;
  onEnter('cfo-rev-q', search);
  if (!d.admin) return;
  $('cfo-rev-add').onclick = () => openPopup('เพิ่มบันทึกการปรับปรุง', `
    ${field('ส่วนที่แก้', `<input id="cfo-rev-f-area" maxlength="120" placeholder="เช่น Fr-05, EF TGO AR5, สูตรคำนวณ">`)}
    ${field('ตำแหน่ง', `<input id="cfo-rev-f-ref" maxlength="300" placeholder="รายการ / รหัส (ถ้ามี)">`)}
    ${field('รายละเอียด', '<textarea id="cfo-rev-f-detail" rows="3" maxlength="2000"></textarea>')}`, async () => {
    await a5Api(CFO, 'cfo/revisions', { method: 'POST', body: { area: $('cfo-rev-f-area').value, ref: $('cfo-rev-f-ref').value, detail: $('cfo-rev-f-detail').value } });
    toast('บันทึกแล้ว');
    closePopup();
    cfoDrawRevisions(body).catch(onErr);
  });
}

// Dashboard > Scope: how complete each activity is this year — 12 month cells (recorded / due but missing),
// % recorded of the months due, quantity and tCO2e. Filters: Scope, department, search.
async function cfoDrawProgress(body) {
  const d = await a5Api(CFO, `cfo/progress?year=${a5Year}`);
  const scope = Number(cfoDash.scope) || 1;
  const rows = d.rows.filter((r) => String(r.scope_code || '').startsWith(`${scope}-`));
  const departments = [...new Set(rows.map((r) => r.department))].sort();
  body.innerHTML = `
    <div class="toolbar a5-filters">
      ${field('Scope', `<select id="cfo-p-scope">${options(['1', '2', '3'], String(scope), (v) => `Scope ${v}`)}</select>`)}
      ${field('หน่วยงาน', `<select id="cfo-f-dept">${options(['', ...departments], cfoFilter.department, (v) => v || 'ทั้งหมด')}</select>`)}
      ${searchSlot('ค้นหา', 'cfo-f-q', 'cfo-f-search', { placeholder: 'กิจกรรมหรือรายละเอียด' })}
    </div>
    <div class="table-wrap sheet" id="cfo-rows"></div>
    <p class="sum-meta" id="cfo-sum"></p>`;
  $('cfo-f-q').value = cfoFilter.q;
  const draw = () => {
    const term = cfoFilter.q.trim().toLowerCase();
    const list = listQuery(rows.filter((r) => (!cfoFilter.department || r.department === cfoFilter.department)
      && (!term || `${r.name} ${r.detail || ''} ${r.source || ''}`.toLowerCase().includes(term))), cfoHeads.entries, (r, key) => r[key] ?? '');
    const cells = (r) => `<div class="cfo-months">${Array.from({ length: 12 }, (_, i) => `<i class="${r.months.includes(i + 1) ? 'is-done' : i < d.due ? 'is-missing' : ''}" title="${ACT_MONTHS_SHORT[i]}"></i>`).join('')}</div>`;
    // Category is a group row (sub heading) over its activities; sorting works inside each group.
    const groups = [...new Set(list.map((r) => r.category))];
    fillTable('cfo-rows', [{ label: 'หน่วยงาน', key: 'department' }, { label: 'กิจกรรม', key: 'name' }, { label: 'รายละเอียด', key: 'detail' }, 'รายเดือน',
      { label: 'ครบ', key: 'percent' }, { label: 'ปริมาณรวม', key: 'qty', num: true }, 'หน่วย', { label: 'tCO₂e', key: 'tco2e', num: true }],
    groups.map((g) => `<tr class="cfo-group"><td colspan="8">${esc(g || '-')}</td></tr>${list.filter((r) => r.category === g).map((r) => `<tr><td>${esc(r.department)}</td><td>${esc(r.name)}</td><td>${esc(r.detail || '')}</td><td>${cells(r)}</td>
      <td><div class="cfo-prog"><span><i style="width:${r.percent}%"></i></span>${r.percent}%</div></td><td class="num">${cfoT(r.qty)}</td><td>${esc(r.unit || '')}</td><td class="num">${cfoT(r.tco2e)}</td></tr>`).join('')}`).join(''), 'ไม่มีกิจกรรม', headFor(cfoHeads.entries, draw));
    const full = list.filter((r) => r.percent >= 100).length;
    $('cfo-sum').textContent = `Scope ${scope} · ${list.length} กิจกรรม · ครบถึงเดือนปัจจุบัน ${full} · ขาด ${list.length - full} · รวม ${cfoT(list.reduce((t, r) => t + r.tco2e, 0))} tCO₂e`;
  };
  draw();
  a5Lift(body);
  $('cfo-p-scope').onchange = () => { cfoDash.scope = $('cfo-p-scope').value; cfoDrawProgress(body).catch(onErr); };
  $('cfo-f-dept').onchange = () => { cfoFilter.department = $('cfo-f-dept').value; draw(); };
  const search = () => { cfoFilter.q = $('cfo-f-q').value; draw(); };
  $('cfo-f-search').onclick = search;
  onEnter('cfo-f-q', search);
}

// Google Drive links (uc?export=view / file/d/<id>) show through the thumbnail URL, as TSATP4-CFO drivePhotoUrl_.
function cfoPhotoSrc(url, width = 1600) {
  const id = String(url || '').match(/drive\.google\.com.*(?:[?&]id=|\/d\/)([\w-]+)/);
  return id ? `https://drive.google.com/thumbnail?id=${id[1]}&sz=w${width}` : url;
}

// Resize a photo to JPEG within 1600 px and about 650 KB (bucket limit 700 KB), keeping its shape.
function cfoJpeg(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      let quality = 0.85;
      let data = canvas.toDataURL('image/jpeg', quality);
      while (data.length * 0.75 > 650000 && quality > 0.4) { quality -= 0.1; data = canvas.toDataURL('image/jpeg', quality); }
      resolve(data);
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('เปิดรูปไม่ได้')); };
    image.src = url;
  });
}

// Fr-01 รายละเอียดขององค์กร (TGO TCFO_R_01): photos + organisation details on the left, ขอบเขตขององค์กร on the right
// (each Scope's categories with the activities recorded under them, period and production of this year and the base
// year), then the GHG per Scope bar chart. ผู้จัดทำ edits the details and photos (Setting values company_*).
async function cfoDrawCompany(body, admin, rerender) {
  const [m, team, sum] = await Promise.all([a5Api(CFO, 'cfo/master'), a5Api(CFO, `team?year=${a5Year}`), a5Api(CFO, `cfo/summary?year=${a5Year}`)]);
  const s = m.settings;
  const day = (v) => { const d = v ? new Date(`${v}T00:00:00`) : null; return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-GB') : ''; };
  const img = (url, cls) => (url ? `<img class="${cls}" src="${esc(cfoPhotoSrc(url))}" alt="" loading="lazy">` : '');
  const makers = team.members.filter((x) => x.role === 'admin' && x.status === 'Active').map((x) => x.name || x.employee_id).join(', ');
  // ขอบเขตขององค์กร: categories that have active activities, with those activities' names
  const efById = new Map(m.ef.map((e) => [e.id, e]));
  const scopeName = new Map(m.scopes.map((x) => [x.code, x]));
  const byCode = new Map();
  m.activities.filter((x) => x.status === 'Active').forEach((x) => {
    const code = efById.get(x.ef_id)?.scope_code;
    if (!code) return;
    if (!byCode.has(code)) byCode.set(code, new Set());
    byCode.get(code).add(x.name);
  });
  const codes = [...byCode.keys()].sort((x, y) => x.localeCompare(y, 'en', { numeric: true }));
  const scopeRows = [1, 2, 3].map((n) => {
    const list = codes.filter((c) => c.startsWith(`${n}-`));
    const cells = list.length ? list.map((c) => `<td class="fr01-code">${esc(c)}</td><td><b>${esc(scopeName.get(c)?.name || '')}</b><span>${esc([...byCode.get(c)].join(', '))}</span></td>`)
      : [`<td class="fr01-code">-</td><td class="fr01-none">ยังไม่มีกิจกรรม${n === 3 ? ' (ประเมินนัยสำคัญที่ Fr-03.2)' : ''}</td>`];
    return cells.map((cell, i) => `<tr>${i ? '' : `<th rowspan="${cells.length}">ประเภท ${n}</th>`}${cell}</tr>`).join('');
  }).join('');
  const baseYear = Number(s.base_year) || 0;
  const pieces = (y) => (Number(s[`production_${y}`]) ? Number(s[`production_${y}`]).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '-');
  const tail = [
    ['ระยะเวลาเก็บข้อมูล', `ม.ค. – ธ.ค. ${a5Year}`],
    ['ผลผลิต', pieces(a5Year), 'ชิ้น'],
    ['ปีฐาน', baseYear ? `ม.ค. – ธ.ค. ${baseYear}` : 'ยังไม่ได้ตั้ง (Setting > บริษัท)'],
    ['ผลผลิตปีฐาน', baseYear ? pieces(baseYear) : '-', 'ชิ้น']
  ].map(([label, value, unit]) => `<tr class="fr01-tail"><th colspan="2">${label}</th>${unit ? `<td class="num"><b>${esc(value)}</b> <span>${unit}</span></td>` : `<td class="fr01-center">${esc(value)}</td>`}</tr>`).join('');
  const info = [['ชื่อธุรกิจ', s.company_name], ['ประเภทธุรกิจ', s.company_business], ['พื้นที่โรงงาน', s.company_area], ['กลุ่มลูกค้าหลัก', s.company_customers],
    ['จำนวนพนักงาน', s.company_employees ? `${s.company_employees} คน${day(s.company_updated) ? ` (อัพเดท ${day(s.company_updated)})` : ''}` : '']];
  const c = sum.compare;
  const chart = chartPlot({
    id: 'cfo-fr01', labels: ['Scope 1', 'Scope 2', 'Scope 3'], left: 'tCO₂e',
    bars: [...(c.total ? [{ values: c.scopes, colors: [CFO_BASE_COLORS[1]] }] : []), { values: sum.scopes.map((x) => x.tco2e), colors: [CFO_SCOPE_COLORS[0]] }],
    legend: [...(c.total ? [{ box: CFO_BASE_COLORS[1], label: c.isBase ? `ปีฐาน ${c.year}` : `ปี ${c.year}` }] : []), { box: CFO_SCOPE_COLORS[0], label: `ปี ${a5Year}` }]
  });
  body.innerHTML = `
    ${admin ? `<div class="action-bar a5-actions">${button('cfo-co-edit', 'แก้ไขข้อมูล')}</div>` : ''}
    <div class="cfo-fr01">
      <section class="card fr01-head"><div><div class="card-title">รายละเอียดขององค์กร</div><strong>${esc(s.company_name || 'ยังไม่มีชื่อองค์กร')}</strong></div>
        <dl><dt>รหัสฟอร์ม</dt><dd>Fr-01</dd><dt>ผู้จัดทำ</dt><dd>${esc(makers || '-')}</dd><dt>ปี</dt><dd>${a5Year}</dd></dl></section>
      <div class="fr01-grid">
        <section class="card fr01-org">
          <div class="card-title">รูปขององค์กร</div>
          <div class="fr01-photos">${img(s.company_photo2 || s.company_photo1, 'fr01-building') || '<p class="empty">ยังไม่มีรูป</p>'}</div>
          <div class="card-title">ข้อมูลองค์กร</div>
          <ol class="fr01-info">${info.map(([label, value]) => `<li><span>${label}</span><b>${esc(value || '-')}</b></li>`).join('')}</ol>
          <dl class="fr01-more"><dt>สถานที่ติดต่อ</dt><dd>${esc(s.company_address || '-')}</dd><dt>วันที่ขอขึ้นทะเบียน</dt><dd>${esc(day(s.company_register) || '-')}</dd></dl>
        </section>
        <section class="card fr01-scope">
          <table class="fr01-table"><thead><tr><th colspan="3">ขอบเขตขององค์กร</th></tr></thead><tbody>${scopeRows}${tail}</tbody></table>
        </section>
      </div>
      ${chartCard('กราฟแท่งแสดงการปล่อย GHG แต่ละขอบเขต', chart, `tCO₂e ทั้งปี${c.total ? ' · เทียบปีฐาน' : ''}`)}
    </div>`;
  a5Lift(body);
  chartTip('cfo-fr01', (i) => `<strong>Scope ${i + 1}</strong><div class="ch-tip-row"><span>ปี ${a5Year}</span><b>${cfoT(sum.scopes[i].tco2e)} tCO₂e</b></div>
    ${c.total ? `<div class="ch-tip-row"><span>${c.isBase ? 'ปีฐาน' : 'ปี'} ${c.year}</span><b>${cfoT(c.scopes[i])}</b></div>` : ''}`);
  if (!admin) return;
  $('cfo-co-edit').onclick = () => {
    const picked = {};
    const fields = CFO_COMPANY.filter(([key]) => key.startsWith('company_') && !key.startsWith('company_photo'))
      .map(([key, label]) => field(label, `<input id="cfo-s-${key}" maxlength="1000" value="${esc(s[key] ?? '')}"${['company_updated', 'company_register'].includes(key) ? ' type="date"' : ''}>`)).join('');
    openPopup('แก้ไข Fr-01 รายละเอียดขององค์กร', `${fields}
      ${field('รูปองค์กร (แสดงเต็มกว้าง ตามสัดส่วนที่อัปโหลด)', '<input id="cfo-s-photo2" type="file" accept="image/*">')}
      <p class="sum-meta">ไม่เลือกรูป = ใช้รูปเดิม · ผลผลิตและปีฐานแก้ที่ Setting > บริษัท</p>`, async () => {
      if (picked[2]) await a5Api(CFO, 'cfo/photo', { method: 'POST', body: { slot: 2, image: picked[2] } });
      const values = Object.fromEntries(CFO_COMPANY.filter(([key]) => $(`cfo-s-${key}`)).map(([key]) => [key, $(`cfo-s-${key}`).value]));
      await a5Api(CFO, 'cfo/settings', { method: 'PUT', body: values });
      toast('บันทึกแล้ว');
      closePopup();
      rerender();
    });
    $('cfo-s-photo2').onchange = (e) => { const f = e.target.files[0]; if (f) cfoJpeg(f).then((data) => { picked[2] = data; }).catch(onErr); };
  };
}

// Team Member (TSATP4-CFO): org chart by level — ประธาน · รองประธาน / ผู้จัดทำ · สมาชิก (ตัวแทนหน่วยงาน).
async function cfoDrawTeam(body, admin) {
  const team = await a5Api(CFO, `team?year=${a5Year}`);
  const active = team.members.filter((p) => p.status === 'Active');
  const first = (name) => String(name || '').replace(/^(นางสาว|นาง|นาย|Mr\.?|Mrs\.?|Ms\.?|Miss)\s*/, '').split(/\s+/)[0];
  const tiers = [
    { label: 'ประธาน', color: 'var(--cfo-tier-1)', people: active.filter((p) => p.role === 'chairman') },
    { label: 'รองประธาน , ผู้จัดทำ', color: 'var(--cfo-tier-2)', people: [...active.filter((p) => p.role === 'vice'), ...active.filter((p) => p.role === 'admin')] },
    { label: 'สมาชิก', color: 'var(--cfo-tier-3)', people: active.filter((p) => p.role === 'member').sort((a, b) => String(a.department).localeCompare(String(b.department))) }
  ];
  const card = (p) => `<div class="cfo-person"><span class="material-symbols-rounded">person</span><strong>${esc(p.name ? `คุณ${first(p.name)}` : p.employee_id)}</strong><small>${esc(p.department || '')}</small></div>`;
  body.innerHTML = `
    ${admin ? `<div class="action-bar a5-actions">${button('cfo-team-edit', 'แก้ไขทีม')}</div>` : ''}
    <section class="card cfo-team">
      <div class="plan-head"><div class="card-title">Fr-03.1 โครงสร้างและหน้าที่ความรับผิดชอบ · ปี ${a5Year}</div><span class="sum-meta">${active.length} คน</span></div>
      ${tiers.map((t) => `<div class="cfo-tier">${t.people.length ? `<div class="cfo-tier-people">${t.people.map(card).join('')}</div>` : '<p class="empty">ยังไม่มี</p>'}
        <div class="cfo-tier-rule" style="--tier:${t.color}"><span>${esc(t.label)}</span></div></div>`).join('')}
    </section>`;
  a5Lift(body);
  if (admin) $('cfo-team-edit').onclick = () => { cfoSetTab = 'team'; openView(`${CFO}-setting`); };
}

// ---------- transaction: TSATP4-CFO Scope pages + บันทึกกิจกรรม ----------
// Activities of one Scope grouped by category (main) with their rows (sub). Month = values of that month (or the year).
// Pick a row you may record (your department, or all for ผู้จัดทำ) → บันทึกกิจกรรม. ผู้จัดทำ confirms / reopens a month.
async function cfoEntries(target) {
  const { me, body } = await cfoFrame(target, null, '', '');
  const rerender = () => cfoEntries(target).catch(onErr);
  $('a5-year').onchange = () => { a5Year = Number($('a5-year').value); rerender(); };
  if (!me.access.member) { body.innerHTML = `<p class="empty">เข้าได้เฉพาะทีม CFO ปี ${a5Year} (ตัวแทนหน่วยงาน / ผู้จัดทำ / ประธาน)</p>`; return; }
  const d = await a5Api(CFO, `cfo/progress?year=${a5Year}`);
  const scope = Number(cfoTx.scope) || 1;
  const all = d.rows.filter((r) => String(r.scope_code || '').startsWith(`${scope}-`));
  const categories = [...new Set(all.map((r) => r.category))];
  if (!categories.includes(cfoTx.category) && cfoTx.category !== 'Usage (SAP)') cfoTx.category = '';
  const inCategory = all.filter((r) => !cfoTx.category || r.category === cfoTx.category);
  if (!inCategory.some((r) => String(r.id) === cfoTx.activity)) cfoTx.activity = '';
  const list = inCategory.filter((r) => !cfoTx.activity || String(r.id) === cfoTx.activity);
  const m = Number(cfoTx.month) || 0;
  const value = (r, key) => (m ? Number(r.byMonth[m]?.[key] || 0) : Number(r[key] || 0));
  const confirmed = m && d.rows.some((r) => r.byMonth[m]?.status === 'CONFIRMED');
  const status = (r) => {
    const e = m && r.byMonth[m];
    if (!m) return '';
    return e ? `<span class="badge ${e.status === 'CONFIRMED' ? 'badge-success' : 'badge-warning'}">${e.status === 'CONFIRMED' ? 'ยืนยันแล้ว' : 'ร่าง'}</span>` : '<span class="sum-meta">ยังไม่บันทึก</span>';
  };
  const groups = [...new Set(list.map((r) => r.category))];
  // Scope 3: SAP Usage by section (read only, from Setting > วัสดุ) · bar = share of the Usage tCO2e · biggest first
  const USAGE = 'Usage (SAP)';
  const usage = scope === 3 && (!cfoTx.category || cfoTx.category === USAGE) && !cfoTx.activity
    ? d.materials.map((x) => ({ ...x, value: m ? Number(x.months[m] || 0) : x.tco2e, items: m ? x.items[m] || 0 : Math.max(0, ...Object.values(x.items)) })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value) : [];
  const usageTotal = usage.reduce((sum, x) => sum + x.value, 0);
  const usageRows = usage.length ? `<tr class="cfo-group"><td colspan="10">${USAGE} · ตาม Section</td></tr>${usage.map((x) => {
    const share = usageTotal ? Math.round((x.value / usageTotal) * 100) : 0;
    return `<tr><td>${USAGE}</td><td>${esc(x.department)}</td><td>${x.items.toLocaleString()} รายการ</td><td class="num">-</td>
      <td><div class="cfo-prog" title="สัดส่วนของ Usage ทั้งหมด"><span><i style="width:${share}%"></i></span>${share}%</div></td><td class="num"></td><td></td><td class="num">${cfoT(x.value)}</td><td><span class="sum-meta">SAP</span></td><td></td></tr>`;
  }).join('')}` : '';
  const row = (r) => `<tr data-pick="${r.id}"${r.canEdit ? '' : ' class="is-muted"'}><td>${esc(r.name)}</td><td>${esc(r.detail || '')}</td><td>${esc(r.source || '')}</td><td class="num">${r.kgco2e == null ? '-' : cfoT(r.kgco2e)}</td>
    <td><div class="cfo-prog"><span><i style="width:${r.percent}%"></i></span>${r.percent}%<b class="cfo-freq" title="รายเดือน">M</b></div></td>
    <td class="num">${cfoT(value(r, 'qty'))}</td><td>${esc(r.unit || '')}</td><td class="num">${cfoT(value(r, 'tco2e'))}</td><td>${status(r)}</td>
    <td><button class="icon-btn" type="button" data-hist="${r.id}" title="ประวัติการบันทึก" aria-label="ประวัติการบันทึก ${esc(r.name)}"><span class="material-symbols-rounded">history</span></button></td></tr>`;
  body.innerHTML = `
    <div class="toolbar a5-filters">
      ${field('Scope', `<select id="cfo-s-scope">${options(['1', '2', '3'], String(scope), (v) => `Scope ${v}`)}</select>`)}
      ${field('เดือน', `<select id="cfo-s-month">${options(['', ...Array.from({ length: 12 }, (_, i) => String(i + 1))], cfoTx.month, (v) => (v ? ACT_MONTHS[v - 1] : 'ทั้งปี'))}</select>`)}
      ${field('category', `<select id="cfo-s-cat">${options(['', ...categories, ...(scope === 3 && d.materials.length ? [USAGE] : [])], cfoTx.category, (v) => v || 'ทั้งหมด')}</select>`)}
      ${field('Activity', `<select id="cfo-s-act"><option value="">ทั้งหมด</option>${inCategory.map((r) => `<option value="${r.id}"${String(r.id) === cfoTx.activity ? ' selected' : ''}>${esc(r.name)} · ${esc(r.detail || '')}</option>`).join('')}</select>`)}
      <div class="action-bar">${button('cfo-record', 'บันทึกกิจกรรม', 'primary', 'disabled')}${d.admin ? `${button('cfo-confirm', confirmed ? 'เปิดให้แก้เดือนนี้' : 'ยืนยันเดือนนี้', 'secondary', m ? '' : 'disabled title="เลือกเดือนก่อน"')}${button('cfo-year', 'ปิดทั้งปี', 'secondary')}` : ''}</div>
    </div>
    <div class="table-wrap sheet" id="cfo-rows"><table class="mo-data-table cfo-scope-table"><thead><tr><th>Activity</th><th>Description</th><th>emission source</th><th class="num">kgCO₂e/unit</th><th>Progress</th><th class="num">Amount</th><th>Unit</th><th class="num">tCO₂e</th><th>สถานะ</th><th></th></tr></thead>
      <tbody>${(cfoTx.category === USAGE ? '' : groups.map((g) => `<tr class="cfo-group"><td colspan="10">${esc(g)}</td></tr>${list.filter((r) => r.category === g).map(row).join('')}`).join('')) + usageRows || '<tr><td colspan="10" class="empty">ไม่มีกิจกรรม</td></tr>'}</tbody></table></div>
    <p class="sum-meta">รวม ${cfoT((cfoTx.category === USAGE ? 0 : list.reduce((t, r) => t + value(r, 'tco2e'), 0)) + usageTotal)} tCO₂e · ${list.length} กิจกรรม${usage.length ? ` + ${USAGE} ${usage.length} Section` : ''}${m ? ` · ${ACT_MONTHS[m - 1]} ${a5Year} บันทึกแล้ว ${list.filter((r) => r.byMonth[m]).length}` : ` · ปี ${a5Year}`}${a5Year === new Date().getFullYear() ? ` · เดือนนี้หน่วยงานคุณยังไม่บันทึก ${all.filter((r) => r.canEdit && !r.byMonth[new Date().getMonth() + 1]).length} กิจกรรม` : ''}</p>`;
  a5Lift(body);
  $('cfo-s-scope').onchange = () => { cfoTx.scope = $('cfo-s-scope').value; cfoTx.category = ''; cfoTx.activity = ''; rerender(); };
  $('cfo-s-month').onchange = () => { cfoTx.month = $('cfo-s-month').value; rerender(); };
  $('cfo-s-cat').onchange = () => { cfoTx.category = $('cfo-s-cat').value; cfoTx.activity = ''; rerender(); };
  $('cfo-s-act').onchange = () => { cfoTx.activity = $('cfo-s-act').value; rerender(); };
  let picked = null;
  const open = (id) => { const r = all.find((x) => String(x.id) === String(id)); if (r?.canEdit) cfoEntryForm(r, d.septic, m || new Date().getMonth() + 1, rerender); };
  $('cfo-rows').querySelectorAll('tr[data-pick]').forEach((tr) => {
    tr.classList.add('row-pick');
    tr.onclick = () => {
      $('cfo-rows').querySelectorAll('tr.is-selected').forEach((x) => x.classList.remove('is-selected'));
      tr.classList.add('is-selected');
      picked = tr.dataset.pick;
      $('cfo-record').disabled = !all.find((x) => String(x.id) === picked)?.canEdit;
    };
    tr.ondblclick = () => open(tr.dataset.pick);
  });
  $('cfo-record').onclick = () => open(picked);
  body.querySelectorAll('[data-hist]').forEach((btn) => {
    btn.onclick = (ev) => {
      ev.stopPropagation();
      const r = all.find((x) => String(x.id) === btn.dataset.hist);
      const months = Object.keys(r.byMonth).map(Number).sort((x, y) => y - x);
      openPopup(`ประวัติ ${esc(r.name)} ${esc(r.detail || '')}`, months.length ? `<div class="table-wrap"><table class="mo-data-table"><thead><tr><th>เดือน</th><th class="num">ปริมาณ</th><th>หน่วย</th><th class="num">tCO₂e</th><th>สถานะ</th><th>หมายเหตุ</th><th>เอกสาร</th></tr></thead><tbody>${months.map((k) => {
        const e = r.byMonth[k];
        return `<tr><td>${ACT_MONTHS[k - 1]} ${a5Year}</td><td class="num">${cfoT(e.qty)}</td><td>${esc(r.unit || '')}</td><td class="num">${cfoT(e.tco2e)}</td><td>${e.status === 'CONFIRMED' ? 'ยืนยันแล้ว' : 'ร่าง'}</td><td>${esc(e.remark || '')}</td><td>${/^https?:\/\//.test(e.doc || '') ? `<a href="${esc(e.doc)}" target="_blank" rel="noopener">เปิด</a>` : esc(e.doc || '')}</td></tr>`;
      }).join('')}</tbody></table></div>` : `<p class="empty">ยังไม่มีการบันทึกปี ${a5Year}</p>`, () => closePopup(), 'ปิด');
    };
  });
  if ($('cfo-confirm')) {
    $('cfo-confirm').onclick = () => m && confirmPopup(confirmed ? 'เปิดให้แก้' : 'ยืนยันข้อมูล', `${confirmed ? 'เปิดให้ตัวแทนหน่วยงานแก้' : 'ยืนยัน'}ข้อมูลทั้งหมดของ ${ACT_MONTHS[m - 1]} ${a5Year} (ทุก Scope)`, async () => {
      const r = await a5Api(CFO, 'cfo/confirm', { method: 'POST', body: { month: cfoMonthIso(m), status: confirmed ? 'DRAFT' : 'CONFIRMED' } });
      toast(`${confirmed ? 'เปิดแก้' : 'ยืนยัน'} ${r.count} รายการ`);
      rerender();
    }, confirmed ? 'เปิดให้แก้' : 'ยืนยัน');
  }
  if ($('cfo-year')) {
    $('cfo-year').onclick = () => confirmPopup('ปิดทั้งปี', `ยืนยันข้อมูลที่บันทึกไว้ทั้งปี ${a5Year} ทุกเดือน ทุก Scope`, async () => {
      const r = await a5Api(CFO, 'cfo/confirm', { method: 'POST', body: { year: a5Year, status: 'CONFIRMED' } });
      toast(`ปิดปีแล้ว ${r.count} รายการ`);
      rerender();
    }, 'ปิดทั้งปี');
  }
}

// บันทึกกิจกรรม: quantity of one activity for a month (changing the month loads what that month has).
// Septic tank: people × days → kg CH4 (same formula as the server).
function cfoEntryForm(row, septic, month, reload) {
  const calc = CFO_CALCS[row.calc];
  const inputs = () => Object.fromEntries(calc.fields.map(([k]) => [k, Number($(`cfo-in-${k}`).value || 0)]));
  const fields = `<p class="sum-meta">${esc(row.department)} · ${esc(row.name)} ${esc(row.detail || '')} · ${esc(row.source || '')} (${cfoT(row.kgco2e)} kgCO₂e/${esc(row.unit || '')})</p>
    ${field('เดือน', `<select id="cfo-e-month">${options(Array.from({ length: 12 }, (_, i) => i + 1), month, (v) => `${ACT_MONTHS[v - 1]} ${a5Year}${row.byMonth[v] ? ' · บันทึกแล้ว' : ''}`)}</select>`)}
    ${calc ? `${calc.fields.map(([k, label, step]) => field(label, `<input id="cfo-in-${k}" type="number" min="0" step="${step}">`)).join('')}
      <p class="sum-meta" id="cfo-kg"></p>`
    : field(`ปริมาณ (${esc(row.unit || '')})`, '<input id="cfo-qty" type="number" min="0" step="any">')}
    ${field('ลิงก์เอกสาร / หลักฐาน', '<input id="cfo-doc" maxlength="500">')}
    ${field('รูปหลักฐาน', '<input id="cfo-shot" type="file" accept="image/*">')}
    ${field('คุณภาพข้อมูลกิจกรรม', `<select id="cfo-q-act">${options(['', 'X', 'Y', 'Z'], '', (v) => ({ '': 'ไม่ระบุ', X: 'X เก็บต่อเนื่อง (6)', Y: 'Y มิเตอร์/ใบเสร็จ (3)', Z: 'Z ประมาณค่า (1)' }[v]))}</select>`)}
    ${field('คุณภาพ EF', `<select id="cfo-q-ef">${options(['', 'C', 'D', 'E', 'F'], '', (v) => ({ '': 'ไม่ระบุ', C: 'C วัดเอง (4)', D: 'D ประเทศ/ผู้ผลิต (3)', E: 'E ภูมิภาค (2)', F: 'F สากล (1)' }[v]))}</select>`)}
    ${field('หมายเหตุ', '<textarea id="cfo-remark" rows="2" maxlength="500"></textarea>')}
    <p class="sum-meta" id="cfo-e-note"></p>
    ${button('cfo-del', 'ลบข้อมูลเดือนนี้', 'danger')}`;
  openPopup('บันทึกกิจกรรม', fields, async () => {
    const body = { activityId: row.id, month: cfoMonthIso($('cfo-e-month').value), doc: $('cfo-doc').value, remark: $('cfo-remark').value };
    if ($('cfo-q-act').value && $('cfo-q-ef').value) body.quality = { activity: $('cfo-q-act').value, ef: $('cfo-q-ef').value };
    const file = $('cfo-shot').files?.[0];
    if (file) body.image = await cfoJpeg(file);
    if (calc) body.inputs = inputs();
    else body.qty = $('cfo-qty').value;
    await a5Api(CFO, 'cfo/entries', { method: 'PUT', body });
    toast('บันทึกแล้ว');
    closePopup();
    reload();
  });
  const show = () => {
    if (!calc) return;
    const qty = calc.qty(inputs(), septic);
    $('cfo-kg').textContent = `= ${cfoT(qty)} ${calc.out} · ${cfoT((qty * Number(row.kgco2e || 0)) / 1000)} tCO₂e`;
  };
  const load = () => {
    const e = row.byMonth[Number($('cfo-e-month').value)] || {};
    if (calc) calc.fields.forEach(([k]) => { $(`cfo-in-${k}`).value = e.inputs?.[k] ?? ''; });
    else $('cfo-qty').value = e.qty ?? '';
    $('cfo-doc').value = e.doc || '';
    $('cfo-remark').value = e.remark || '';
    $('cfo-q-act').value = e.inputs?.quality?.activity || '';
    $('cfo-q-ef').value = e.inputs?.quality?.ef || '';
    scoreNote();
    $('cfo-del').hidden = !e.id;
    show();
  };
  const scoreNote = () => {
    const points = { X: 6, Y: 3, Z: 1 }[$('cfo-q-act').value] + { C: 4, D: 3, E: 2, F: 1 }[$('cfo-q-ef').value];
    const level = points >= 19 ? 4 : points >= 13 ? 3 : points >= 7 ? 2 : points ? 1 : 0;
    const e = row.byMonth[Number($('cfo-e-month').value)] || {};
    $('cfo-e-note').textContent = `${e.id ? `${e.status === 'CONFIRMED' ? 'ยืนยันแล้ว (แก้ได้เฉพาะผู้จัดทำ)' : 'ร่าง'}${e.updated_at ? ` · แก้ล่าสุด ${new Date(e.updated_at).toLocaleString('th-TH')}` : ''}` : 'ยังไม่บันทึกเดือนนี้'}${level ? ` · คุณภาพข้อมูลระดับ ${level} (${points} คะแนน)` : ''}`;
  };
  $('cfo-e-month').onchange = load;
  $('cfo-q-act').onchange = scoreNote;
  $('cfo-q-ef').onchange = scoreNote;
  if (calc) calc.fields.forEach(([k]) => { $(`cfo-in-${k}`).oninput = show; });
  load();
  $('cfo-del').onclick = () => {
    const e = row.byMonth[Number($('cfo-e-month').value)];
    if (e?.id) confirmPopup('ลบข้อมูล', `ลบ ${esc(row.name)} ของ ${ACT_MONTHS[Number($('cfo-e-month').value) - 1]} ${a5Year}`, async () => {
      await a5Api(CFO, `cfo/entries/${e.id}`, { method: 'DELETE' });
      toast('ลบแล้ว');
      reload();
    });
  };
}

// ---------- Setting ----------

async function cfoSetting(target) {
  // Emission Factor is master data for every year, so its tab has no year (ผู้ใช้กำหนด 2026-11-01)
  const { me, body } = await cfoFrame(target, CFO_SET_TABS, 'data-cfoset', cfoSetTab, '', { year: !['ef', 'material'].includes(cfoSetTab), pick: true });
  const rerender = () => cfoSetting(target).catch(onErr);
  $('a5-setpick').onchange = () => { cfoSetTab = $('a5-setpick').value; rerender(); };
  if ($('a5-year')) $('a5-year').onchange = () => { a5Year = Number($('a5-year').value); rerender(); };
  if (cfoSetTab === 'team') return a5SetTeam(body, CFO, me.access.admin, rerender, CFO_ROLE_LABEL);
  if (cfoSetTab === 's3') return cfoSetS3(body, rerender);
  const m = await a5Api(CFO, 'cfo/master');
  cfoMaster = m;
  const draw = { activities: cfoSetActivities, ef: cfoSetEfTab, material: cfoSetMaterial, company: cfoSetCompany }[cfoSetTab] || cfoSetActivities;
  draw(body, m, rerender);
}

function cfoEfLabel(e) {
  return e ? `${e.scope_code} · ${e.name} (${e.kgco2e == null ? '-' : cfoT(e.kgco2e)} kgCO₂e/${e.unit})` : '';
}

function cfoSetActivities(body, m, rerender) {
  const efById = new Map(m.ef.map((e) => [e.id, e]));
  const refById = new Map(m.refs.map((r) => [r.id, r]));
  // EF id of an activity = the reference row its EF copy points to (mt_cfo_ef.ref_id → mt_cfo_ef_ref.code)
  const efCode = (a) => refById.get(efById.get(a.ef_id)?.ref_id)?.code || '';
  const departments = [...new Set(m.activities.map((a) => a.department))].sort();
  const draw = () => {
    const term = cfoFilter.q.trim().toLowerCase();
    const list = listQuery(m.activities.filter((a) => (!cfoFilter.department || a.department === cfoFilter.department)
      && (!cfoFilter.scope || String(efById.get(a.ef_id)?.scope_code || '').startsWith(`${cfoFilter.scope}-`))
      && (!term || `${a.name} ${a.detail || ''} ${efCode(a)}`.toLowerCase().includes(term))), cfoHeads.activities, (a, key) => (key === 'ef' ? cfoEfLabel(efById.get(a.ef_id)) : key === 'efcode' ? efCode(a) : a[key] ?? ''));
    fillTable('cfo-rows', [{ label: 'หน่วยงาน', key: 'department' }, { label: 'กิจกรรม', key: 'name' }, { label: 'รายละเอียด', key: 'detail' }, { label: 'EF id', key: 'efcode' }, { label: 'Emission factor', key: 'ef' }, { label: 'สูตร', key: 'calc' }, { label: 'สถานะ', key: 'status' }],
      list.map((a) => `<tr data-pick="${a.id}"><td>${esc(a.department)}</td><td>${esc(a.name)}</td><td>${esc(a.detail || '')}</td><td><b>${esc(efCode(a))}</b></td><td>${esc(cfoEfLabel(efById.get(a.ef_id)))}</td><td>${esc(CFO_CALCS[a.calc]?.short || '')}</td><td>${esc(a.status)}</td></tr>`).join(''), 'ยังไม่มีกิจกรรม', headFor(cfoHeads.activities, draw));
    bindRowSelect($('cfo-rows'), (id) => { picked = m.activities.find((a) => String(a.id) === id); ['cfo-edit', 'cfo-del'].forEach((b) => { if ($(b)) $(b).disabled = !picked; }); });
  };
  let picked = null;
  body.innerHTML = `
    <div class="toolbar a5-filters">
      ${field('Scope', `<select id="cfo-f-scope">${options(['', '1', '2', '3'], cfoFilter.scope, (v) => (v ? `Scope ${v}` : 'ทั้งหมด'))}</select>`)}
      ${field('หน่วยงาน', `<select id="cfo-f-dept">${options(['', ...departments], cfoFilter.department, (v) => v || 'ทั้งหมด')}</select>`)}
      ${searchSlot('ค้นหา', 'cfo-f-q', 'cfo-f-search', { placeholder: 'ชื่อกิจกรรม' })}
      ${m.admin ? `<div class="action-bar">${button('cfo-add', 'เพิ่ม', 'primary')}${button('cfo-edit', 'แก้ไข', 'secondary', 'disabled')}${button('cfo-del', 'ลบ', 'danger', 'disabled')}</div>` : ''}
    </div>
    <div class="table-wrap sheet" id="cfo-rows"></div>
    <p class="sum-meta">${m.activities.length} กิจกรรม · กิจกรรมที่มีข้อมูลแล้วลบไม่ได้ ให้ตั้งเป็น Inactive</p>`;
  $('cfo-f-q').value = cfoFilter.q;
  draw();
  a5Lift(body);
  $('cfo-f-scope').onchange = () => { cfoFilter.scope = $('cfo-f-scope').value; draw(); };
  $('cfo-f-dept').onchange = () => { cfoFilter.department = $('cfo-f-dept').value; draw(); };
  const search = () => { cfoFilter.q = $('cfo-f-q').value; draw(); };
  $('cfo-f-search').onclick = search;
  onEnter('cfo-f-q', search);
  if (!m.admin) return;
  const form = (a) => {
    // Scope → หมวด → Emission factor → สูตร (ผู้ใช้กำหนด 2026-11-01): each list follows the one before it.
    // EF comes from Setting > Emission Factor; an activity saved earlier keeps its own EF on top of the list.
    const current = m.ef.find((e) => e.id === a?.ef_id);
    const type0 = current ? (current.separate ? 'sep' : current.scope_code[0]) : '1';
    const efName = (r) => `${r.grp ? `${r.grp} · ` : ''}${r.name.replace(/^-\s*/, '')} (${cfoRefNum(r.total)} kgCO₂e/${r.unit})`;
    openPopup(a ? 'แก้ไขกิจกรรม' : 'เพิ่มกิจกรรม', `
      ${field('หน่วยงาน', `<input id="cfo-a-dept" maxlength="80" list="cfo-depts" value="${esc(a?.department || '')}"><datalist id="cfo-depts">${departments.map((v) => `<option value="${esc(v)}">`).join('')}</datalist>`)}
      ${field('ชื่อกิจกรรม', `<input id="cfo-a-name" maxlength="200" value="${esc(a?.name || '')}">`)}
      ${field('รายละเอียด', `<input id="cfo-a-detail" maxlength="500" value="${esc(a?.detail || '')}">`)}
      ${field('Scope', `<select id="cfo-a-type">${options(Object.keys(CFO_ACT_TYPES), type0, (v) => CFO_ACT_TYPES[v])}</select>`)}
      ${field('หมวด', '<select id="cfo-a-scope"></select>')}
      ${field('สูตรปริมาณ', '<select id="cfo-a-calc"></select>')}
      ${field('EF id (กรอกได้เลย เช่น CFP-0001)', `<input id="cfo-a-efcode" maxlength="40" list="cfo-ef-codes" autocomplete="off"><datalist id="cfo-ef-codes">${m.refs.filter((x) => x.code && x.unit && x.total != null).map((x) => `<option value="${esc(x.code)}">${esc(x.name)}</option>`).join('')}</datalist>`)}
      ${field('Emission factor', '<select id="cfo-a-ef"></select>')}
      <p class="sum-meta" id="cfo-a-hint"></p>
      <div id="cfo-a-up">${field('EF การได้มาของเชื้อเพลิง / ไฟฟ้า (Scope 3-3)', '<select id="cfo-a-ef3"></select>')}<div id="cfo-a-f3box">${field('ตัวคูณแปลงหน่วย (ความหนาแน่น kg/ลิตร)', '<input id="cfo-a-f3" type="number" step="any" min="0">')}</div><p class="sum-meta" id="cfo-a-hint3"></p></div>
      ${field('GWP', `<select id="cfo-a-gwp">${options(m.gwp.map((g) => g.code), a?.gwp_code || m.gwp[0]?.code)}</select>`)}
      ${field('สถานะ', `<select id="cfo-a-status">${options(['Active', 'Inactive'], a?.status || 'Active')}</select>`)}`, async () => {
      const [kind, id] = $('cfo-a-ef').value.split(':');
      const ef3 = $('cfo-a-up').hidden ? '' : $('cfo-a-ef3').value;
      const f3 = ef3.startsWith('ref:') && !$('cfo-a-f3box').hidden ? $('cfo-a-f3').value : '';
      const body2 = { department: $('cfo-a-dept').value, name: $('cfo-a-name').value, detail: $('cfo-a-detail').value, gwp_code: $('cfo-a-gwp').value, calc: $('cfo-a-calc').value, status: $('cfo-a-status').value,
        type: $('cfo-a-type').value, scope_code: $('cfo-a-scope').value, ...(kind === 'ref' ? { ref_id: id } : kind === 'ef' ? { ef_id: id } : {}),
        ...(ef3 || a?.ef3_id ? { ef3 } : {}), ...(f3 ? { ef3_factor: f3 } : {}) }; // ef3 only when used, so saving works before db/act/cfo.sql adds the column
      await a5Api(CFO, `cfo/activities${a ? `/${a.id}` : ''}`, { method: a ? 'PATCH' : 'POST', body: body2 });
      toast('บันทึกแล้ว');
      closePopup();
      rerender();
    });
    const fillScope = () => {
      const type = $('cfo-a-type').value;
      // by number: 3-1, 3-2 … 3-15 (the code is text, so the server order puts 3-10 after 3-1)
      const list = m.scopes.filter((sc) => String(sc.scope) === (type === 'sep' ? '1' : type)).sort((x, y) => Number(x.code.split('-')[1]) - Number(y.code.split('-')[1]));
      const keep = list.some((sc) => sc.code === $('cfo-a-scope').value) ? $('cfo-a-scope').value : (current && list.some((sc) => sc.code === current.scope_code) ? current.scope_code : list[0]?.code);
      $('cfo-a-scope').innerHTML = list.map((sc) => `<option value="${esc(sc.code)}"${sc.code === keep ? ' selected' : ''}>${esc(sc.code)} ${esc(sc.name_th || sc.name)}</option>`).join('') || '<option value="">ยังไม่มีหมวด (รัน db/act/cfo.sql)</option>';
    };
    const fillCalc = () => {
      const type = $('cfo-a-type').value;
      const keys = ['', ...Object.keys(CFO_CALCS).filter((k) => k !== 'septic' || type === '1' || type === 'sep')];
      const keep = keys.includes($('cfo-a-calc').value) ? $('cfo-a-calc').value : (keys.includes(a?.calc || '') ? a?.calc || '' : '');
      $('cfo-a-calc').innerHTML = options(keys, keep, (v) => (v ? CFO_CALCS[v].label : 'กรอกปริมาณเอง'));
    };
    const fillEf = () => {
      const type = $('cfo-a-type').value;
      const calc = $('cfo-a-calc').value;
      const box = $('cfo-a-ef');
      box.disabled = calc === 'septic';
      if (calc === 'septic') {
        box.innerHTML = '<option value="">บ่อเกรอะ: ใช้ kg CH₄ × GWP CH₄ (ระบบตั้ง EF ให้)</option>';
        $('cfo-a-hint').textContent = 'บ่อเกรอะ: กรอกจำนวนคนและวันทำงานตอนบันทึก ระบบคิด kg CH₄ จากค่าบ่อเกรอะใน Setting > บริษัท';
        return;
      }
      const unitOk = (unit) => !CFO_CALCS[calc]?.unit || CFO_CALCS[calc].unit.test(unit || '');
      const inCategory = CFO_EF_CATEGORY[$('cfo-a-scope').value] || (() => true);
      const groups = cfoEfGroups((r) => CFO_EF_FOR[type](r) && inCategory(r) && unitOk(r.unit));
      const own = current && unitOk(current.unit) ? `<optgroup label="EF ที่ใช้อยู่"><option value="ef:${current.id}" selected>${esc(cfoEfLabel(current))}</option></optgroup>` : '';
      const keep = box.value;
      box.innerHTML = `<option value="">- เลือก EF -</option>${own}${groups}`;
      if (keep && box.querySelector(`option[value="${keep}"]`)) box.value = keep;
      const n = box.querySelectorAll('option[value^="ref:"]').length;
      $('cfo-a-hint').textContent = `${n} EF ที่ใช้กับ ${CFO_ACT_TYPES[type]} หมวด ${$('cfo-a-scope').value}${CFO_CALCS[calc]?.unit ? ` และสูตร ${CFO_CALCS[calc].short} (หน่วย ${CFO_CALCS[calc].out})` : ''}${n ? '' : ' · ยังไม่มี เพิ่มได้ที่ Setting > Emission Factor'}`;
      fillEf3();
    };
    // Scope 1 fuel and Scope 2 electricity: the same quantity is also counted in 3-3 (การได้มาของเชื้อเพลิง / ไฟฟ้า)
    // with an EF of the same unit, like the TGO Fr-04.1 sheet (ผู้ใช้กำหนด 2026-11-01). A fuel in litres can also use an EF CFP
    // per kg (การได้มาของเชื้อเพลิง ของ อบก. เป็น kg): × density of Setting > Fuel Properties (ผู้ใช้กำหนด 2026-11-02)
    const fuelOf = (name) => (/diesel|ดีเซล|\bB\d+\b/i.test(name) ? 'Diesel' : /gasohol|gasoline|เบนซิน|โซฮอล|\bE\d+\b/i.test(name) ? 'Gasoline' : /LPG|ก๊าซหุงต้ม/i.test(name) ? 'LPG' : null);
    // [name, detail]: ก๊าซหุงต้ม has two TGO items, the one from the refinery (กลั่นน้ำมันดิบ) is the LPG bought as fuel
    const CFP_UPSTREAM = { Diesel: [/^น้ำมันดีเซล/], Gasoline: [/^แก๊สโซลีน$/], LPG: [/^ก๊าซหุงต้ม$/, /กลั่น/] };
    const densityOf = (fuel) => m.refs.find((r) => r.sheet === 'fuel' && r.grp === 'Density' && r.name === fuel)?.total;
    const fillF3 = (mainUnit, mainName) => {
      const [kind, id] = $('cfo-a-ef3').value.split(':');
      const up = kind === 'ref' && m.refs.find((r) => String(r.id) === id);
      const convert = up && cfoUnitKey(mainUnit) === 'l' && cfoUnitKey(up.unit) === 'kg';
      $('cfo-a-f3box').hidden = !convert;
      if (convert && !$('cfo-a-f3').value) $('cfo-a-f3').value = densityOf(fuelOf(mainName)) ?? '';
      return convert;
    };
    const fillEf3 = () => {
      const [kind, id] = $('cfo-a-ef').value.split(':');
      const unit = kind === 'ref' ? m.refs.find((r) => String(r.id) === id)?.unit : kind === 'ef' ? current?.unit : null;
      const type = $('cfo-a-type').value;
      const show = (type === '1' && $('cfo-a-calc').value !== 'septic' && ['1-1', '1-2'].includes($('cfo-a-scope').value)) || type === '2';
      $('cfo-a-up').hidden = !show;
      if (!show) return;
      const box = $('cfo-a-ef3');
      const keep = box.value || (a?.ef3_id ? `ef:${a.ef3_id}` : '');
      const own = a?.ef3_id ? m.ef.find((e) => e.id === a.ef3_id) : null;
      const mainName = kind === 'ref' ? m.refs.find((r) => String(r.id) === id)?.name || '' : current?.name || '';
      const fits = (r) => cfoUnitKey(r.unit) === cfoUnitKey(unit) || (r.sheet === 'cfp' && cfoUnitKey(unit) === 'l' && cfoUnitKey(r.unit) === 'kg');
      const groups = unit ? cfoEfGroups((r) => (r.sheet === 'cfp' || r.sheet === 'energy') && !cfoBio(r) && fits(r) && r.id !== Number(id)) : '';
      box.innerHTML = `<option value="">- ไม่คิด 3-3 -</option>${own ? `<optgroup label="EF ที่ใช้อยู่"><option value="ef:${own.id}">${esc(cfoEfLabel(own))}</option></optgroup>` : ''}${groups}`;
      if (keep && box.querySelector(`option[value="${keep}"]`)) box.value = keep;
      else if (kind === 'ref') {
        // grid mix "(CFO Scope2)" → its "SCOPE 3" row of the same years (e.g. 2022-2024: 0.475 → 0.0812)
        const main = m.refs.find((r) => String(r.id) === id);
        const years = /ปี (\d{4}-\d{4})/.exec(main?.name || '')?.[1];
        const pair = years && m.refs.find((r) => r.sheet === main.sheet && r.grp === main.grp && r.name.includes(years) && /SCOPE 3/i.test(r.name));
        if (pair && box.querySelector(`option[value="ref:${pair.id}"]`)) box.value = `ref:${pair.id}`;
        // fuel: the TGO "การได้มาของเชื้อเพลิง" item (EF CFP) of the same fuel, e.g. Diesel B7 → น้ำมันดีเซล / น้ำมันโซล่าร์
        const [name, detail] = CFP_UPSTREAM[fuelOf(mainName)] || [];
        const fuelUp = !pair && name && m.refs.find((r) => r.sheet === 'cfp' && name.test(r.name) && (!detail || detail.test(r.formula || '')) && box.querySelector(`option[value="ref:${r.id}"]`));
        if (fuelUp) { box.value = `ref:${fuelUp.id}`; $('cfo-a-f3').value = ''; }
      }
      const convert = fillF3(unit, mainName);
      const up = m.refs.find((r) => `ref:${r.id}` === box.value);
      $('cfo-a-hint3').textContent = !unit ? 'เลือก EF ด้านบนก่อน' : convert
        ? `ปริมาณเดียวกัน (${unit}) คิดใน 3-3 · ${up.code || ''} ${cfoRefNum(up.total)} kgCO₂e/kg × ${$('cfo-a-f3').value || '?'} kg/ลิตร = ${cfoRefNum(up.total * Number($('cfo-a-f3').value || 0))} kgCO₂e/ลิตร`
        : `ปริมาณเดียวกัน (${unit}) คิดอีกบรรทัดใน 3-3 · ${type === '2' ? 'ไฟฟ้า grid mix เลือกแถว SCOPE 3 ของปีเดียวกันให้' : 'EF การได้มาของเชื้อเพลิง: EF CFP ของ อบก. (หน่วย kg คูณความหนาแน่นให้)'}`;
    };
    fillScope();
    fillCalc();
    fillEf();
    $('cfo-a-type').onchange = () => { fillScope(); fillCalc(); fillEf(); };
    $('cfo-a-scope').onchange = fillEf;
    $('cfo-a-calc').onchange = fillEf;
    // EF id ↔ Emission factor: typing an id picks that EF in the list (if it fits the Scope / หมวด / สูตร chosen), picking an EF shows its id
    const showCode = () => {
      const [kind, id] = $('cfo-a-ef').value.split(':');
      const refId = kind === 'ref' ? Number(id) : kind === 'ef' ? m.ef.find((e) => String(e.id) === id)?.ref_id : null;
      $('cfo-a-efcode').value = m.refs.find((x) => x.id === refId)?.code || '';
    };
    $('cfo-a-efcode').oninput = () => {
      const code = $('cfo-a-efcode').value.trim().toUpperCase();
      const hit = code && m.refs.find((x) => String(x.code || '').toUpperCase() === code);
      if (!hit) { $('cfo-a-hint').textContent = code ? `ไม่พบ EF id ${code}` : ''; return; }
      if ($('cfo-a-ef').querySelector(`option[value="ref:${hit.id}"]`)) { $('cfo-a-ef').value = `ref:${hit.id}`; fillEf3(); $('cfo-a-hint').textContent = `${hit.code} · ${hit.name} (${cfoRefNum(hit.total)} kgCO₂e/${hit.unit})`; }
      else $('cfo-a-hint').textContent = `${hit.code} ไม่ตรงกับ Scope / หมวด / สูตรที่เลือก ให้เปลี่ยน Scope หรือหมวดก่อน`;
    };
    $('cfo-a-ef').onchange = () => { showCode(); fillEf3(); };
    $('cfo-a-ef3').onchange = () => { $('cfo-a-f3').value = ''; fillEf3(); };
    $('cfo-a-f3').oninput = () => fillEf3();
    showCode();
  };
  $('cfo-add').onclick = () => form(null);
  $('cfo-edit').onclick = () => picked && form(picked);
  $('cfo-del').onclick = () => picked && confirmPopup('ลบกิจกรรม', `ลบ ${esc(picked.department)} · ${esc(picked.name)}`, async () => {
    await a5Api(CFO, `cfo/activities/${picked.id}`, { method: 'DELETE' });
    toast('ลบแล้ว');
    rerender();
  });
}

// The table picker is a dropdown at the start of each table's toolbar (ผู้ใช้กำหนด 2026-11-01) · cells have light grid lines.
function cfoSetEfTab(body, m, rerender) {
  body.innerHTML = '<div id="cfo-efbody" class="cfo-efgrid"></div>';
  const box = $('cfo-efbody');
  if (!CFO_EF_VIEWS[cfoEfView]) cfoEfView = 'energy';
  if (cfoEfView === 'gwp') cfoSetGwp(box, m, rerender);
  else cfoSetRef(box, m, rerender, cfoEfView);
  $('cfo-ef-view').onchange = () => { cfoEfView = $('cfo-ef-view').value; cfoSetEfTab(body, m, rerender); };
}

// table names in alphabetical order, A–Z then Thai (ผู้ใช้กำหนด 2026-11-01)
const cfoEfPicker = () => field('ตาราง', `<select id="cfo-ef-view">${options(Object.keys(CFO_EF_VIEWS).sort((a, b) => CFO_EF_VIEWS[a].localeCompare(CFO_EF_VIEWS[b], 'en')), cfoEfView, (v) => CFO_EF_VIEWS[v])}</select>`);

// GWP100a per gas (mt_cfo_gwp) · a set that activities use keeps its values: add a new code and set the old one Inactive.
function cfoSetGwp(body, m, rerender) {
  let picked = null;
  const draw = () => {
    const term = cfoFilter.q.trim().toLowerCase();
    const list = m.gwp.filter((g) => (!cfoFilter.status || g.status === cfoFilter.status) && (!term || `${g.code} ${g.reference || ''}`.toLowerCase().includes(term)));
    fillTable('cfo-rows', ['รหัส', ...CFO_GWP_GASES.map(([, label]) => ({ label, num: true })), 'อ้างอิง', 'ใช้แล้ว', 'สถานะ'],
      list.map((g) => `<tr data-pick="${esc(g.code)}"><td class="c-name"><b>${esc(g.code)}</b></td>${CFO_GWP_GASES.map(([k]) => `<td class="num c-num">${cfoEfNum(g[k])}</td>`).join('')}<td class="c-reference">${esc(g.reference || '')}</td><td class="c-unit">${g.used ? '✓' : ''}</td><td class="c-unit">${esc(g.status)}</td></tr>`).join('') || null, 'ไม่มี GWP');
    picked = null;
    ['cfo-edit', 'cfo-del'].forEach((b) => { if ($(b)) $(b).disabled = true; });
    bindRowSelect($('cfo-rows'), (code) => { picked = m.gwp.find((g) => g.code === code); ['cfo-edit', 'cfo-del'].forEach((b) => { if ($(b)) $(b).disabled = !picked; }); });
  };
  body.innerHTML = `
    <div class="toolbar a5-filters">${cfoEfPicker()}
      ${field('สถานะ', `<select id="cfo-f-status">${options(['', 'Active', 'Inactive'], cfoFilter.status, (v) => v || 'ทั้งหมด')}</select>`)}
      ${searchSlot('ค้นหา', 'cfo-f-q', 'cfo-f-search', { placeholder: 'รหัส หรืออ้างอิง' })}
      ${m.admin ? `<div class="action-bar">${button('cfo-add', 'เพิ่ม', 'primary')}${button('cfo-edit', 'แก้ไข', 'secondary', 'disabled')}${button('cfo-del', 'ลบ', 'danger', 'disabled')}</div>` : ''}</div>
    <div class="table-wrap sheet" id="cfo-rows"></div>
    <p class="sum-meta">กิจกรรมเลือกชุด GWP ที่ใช้ (Setting > กิจกรรม) · ชุดที่ใช้แล้วแก้ค่าไม่ได้ ให้เพิ่มรหัสใหม่แล้วตั้งตัวเดิมเป็น Inactive</p>`;
  $('cfo-f-q').value = cfoFilter.q;
  draw();
  a5Lift(body);
  $('cfo-f-status').onchange = () => { cfoFilter.status = $('cfo-f-status').value; draw(); };
  const search = () => { cfoFilter.q = $('cfo-f-q').value; draw(); };
  $('cfo-f-search').onclick = search;
  onEnter('cfo-f-q', search);
  if (!m.admin) return;
  const status = [['Active', 'Active'], ['Inactive', 'Inactive']];
  $('cfo-add').onclick = () => {
    openPopup('เพิ่ม GWP', gridField('cfo-grid', [{ key: 'code', label: 'รหัส', width: '90px' }, ...CFO_GWP_GASES.map(([key, label]) => ({ key, label, type: 'number', width: '90px' })),
      { key: 'reference', label: 'อ้างอิง' }, { key: 'status', label: 'สถานะ', type: 'select', options: status, value: 'Active', width: '110px' }], 2), async () => {
      const n = await gridSave(grid, (v) => a5Api(CFO, 'cfo/gwp', { method: 'POST', body: v }));
      toast(`เพิ่ม ${n} ชุด`);
      closePopup();
      rerender();
    });
    const grid = gridBind('cfo-grid');
  };
  $('cfo-edit').onclick = () => {
    if (!picked) return;
    const g = picked;
    const lock = g.used ? ' disabled' : '';
    openPopup(`แก้ไข GWP ${g.code}`, `
      ${g.used ? '<p class="sum-meta">ชุดนี้ถูกใช้แล้ว แก้ได้เฉพาะอ้างอิงและสถานะ</p>' : ''}
      <div class="cfo-gas">${CFO_GWP_GASES.map(([k, label]) => field(label, `<input id="cfo-g-${k}" type="number" step="any" value="${esc(g[k] ?? '')}"${lock}>`)).join('')}</div>
      ${field('อ้างอิง', `<input id="cfo-g-ref" maxlength="500" value="${esc(g.reference || '')}">`)}
      ${field('สถานะ', `<select id="cfo-g-status">${options(['Active', 'Inactive'], g.status)}</select>`)}`, async () => {
      const body2 = { reference: $('cfo-g-ref').value, status: $('cfo-g-status').value };
      CFO_GWP_GASES.forEach(([k]) => { body2[k] = $(`cfo-g-${k}`).value; });
      await a5Api(CFO, `cfo/gwp/${encodeURIComponent(g.code)}`, { method: 'PATCH', body: body2 });
      toast('บันทึกแล้ว');
      closePopup();
      rerender();
    });
  };
  $('cfo-del').onclick = () => picked && confirmPopup('ลบ GWP', `ลบชุด ${esc(picked.code)}`, async () => {
    await a5Api(CFO, `cfo/gwp/${encodeURIComponent(picked.code)}`, { method: 'DELETE' });
    toast('ลบแล้ว');
    rerender();
  });
}

// Reference table (energy / chemical / ipcc) laid out like the sheet: group bands, a two-line header with the units,
// heading rows (no unit, no value) in bold and "- …" rows indented. Total left empty = CO₂ + gases × GWP (server).
function cfoSetRef(body, m, rerender, sheet) {
  const spec = CFO_REF_COLS[sheet];
  const rows = m.refs.filter((r) => r.sheet === sheet);
  const groups = [...new Set(rows.map((r) => r.grp).filter(Boolean))];
  const gwp = m.gwp.find((g) => g.code === 'AR5' && g.status === 'Active') || m.gwp.find((g) => g.status === 'Active') || {};
  let picked = null;
  const thead = `<tr>${spec.cols.map(([key, label, unit, num]) => `<th class="${cfoCol(key, num)}${unit ? ' num' : ''}"${unit ? '' : ' rowspan="2"'}>${esc(label)}</th>`).join('')}</tr>
    <tr>${spec.cols.filter((c) => c[2]).map((c) => `<th class="num cfo-unit c-num">${esc(c[2])}</th>`).join('')}</tr>`;
  const draw = () => {
    const term = cfoFilter.q.trim().toLowerCase();
    const list = rows.filter((r) => (!cfoFilter.status || r.status === cfoFilter.status)
      && (!term || `${r.code || ''} ${r.name} ${r.formula || ''} ${r.grp || ''} ${r.reference || ''}`.toLowerCase().includes(term)));
    let band;
    const html = list.map((r) => {
      const top = !spec.groupCol && r.grp !== band ? `<tr class="cfo-band"><td colspan="${spec.cols.length}">${esc(r.grp || 'ไม่ระบุกลุ่ม')}</td></tr>` : '';
      band = r.grp;
      const heading = !r.unit && r.total == null && r.co2 == null;
      const child = /^-\s/.test(r.name);
      const cell = ([key, , , num]) => {
        if (num) return `<td class="num c-num"${r[key] == null ? '' : ` title="${esc(r[key])}"`}>${cfoRefNum(r[key])}</td>`;
        if (key === 'name') {
          const name = `${child ? r.name.replace(/^-\s*/, '') : r.name}${r.ratio != null ? ` (สัดส่วน ${cfoEfNum(r.ratio)})` : ''}`;
          return `<td class="c-name${heading ? ' cfo-head' : ''}${child ? ' cfo-child' : ''}" title="${esc(name)}">${esc(name)}</td>`;
        }
        if (key === 'code') return `<td class="c-unit"><b>${esc(r.code || '')}</b></td>`;
        return `<td class="${cfoCol(key)}" title="${esc(r[key] || '')}">${esc(r[key] || '')}</td>`;
      };
      return `${top}<tr data-pick="${r.id}"${r.status === 'Inactive' ? ' class="is-muted"' : ''}>${spec.cols.map(cell).join('')}</tr>`;
    }).join('') || `<tr><td class="empty" colspan="${spec.cols.length}">ยังไม่มีรายการ</td></tr>`;
    $('cfo-rows').innerHTML = `<table class="mo-data-table cfo-reftab"><thead>${thead}</thead><tbody>${html}</tbody></table>`;
    picked = null;
    ['cfo-edit', 'cfo-del'].forEach((b) => { if ($(b)) $(b).disabled = true; });
    bindRowSelect($('cfo-rows'), (id) => { picked = rows.find((r) => String(r.id) === id); ['cfo-edit', 'cfo-del'].forEach((b) => { if ($(b)) $(b).disabled = !picked; }); });
  };
  body.innerHTML = `
    <div class="toolbar a5-filters">${cfoEfPicker()}
      ${field('สถานะ', `<select id="cfo-f-status">${options(['', 'Active', 'Inactive'], cfoFilter.status, (v) => v || 'ทั้งหมด')}</select>`)}
      ${searchSlot('ค้นหา', 'cfo-f-q', 'cfo-f-search', { placeholder: 'ชื่อ หรืออ้างอิง' })}
      <div class="action-bar">${button('cfo-export', 'Export')}${m.admin ? `${button('cfo-import', 'Import')}${button('cfo-add', 'เพิ่ม', 'primary')}${button('cfo-edit', 'แก้ไข', 'secondary', 'disabled')}${button('cfo-del', 'ลบ', 'danger', 'disabled')}` : ''}</div>
    </div>
    <div class="table-wrap sheet" id="cfo-rows"></div>
    <p class="sum-meta">${esc(spec.title)} · ${rows.length} รายการ · ${sheet === 'cfp' ? 'กรอกเอง หรือคัดลอกจาก Excel แล้ววางในหน้าต่างเพิ่ม' : 'ตารางอ้างอิงตามแผ่น EF TGO AR5 V2 ไว้ดูค่าและที่มา'}${spec.cols.some((c) => c[0] === 'co2') ? ` · Total ว่าง = คิดจาก GWP ${esc(gwp.code || '')} (CO₂ + Fossil CH₄ × ${gwp.ch4_fossil ?? '-'} + CH₄ × ${gwp.ch4 ?? '-'} + N₂O × ${gwp.n2o ?? '-'})` : ''}</p>`;
  $('cfo-f-q').value = cfoFilter.q;
  draw();
  a5Lift(body);
  $('cfo-f-status').onchange = () => { cfoFilter.status = $('cfo-f-status').value; draw(); };
  const search = () => { cfoFilter.q = $('cfo-f-q').value; draw(); };
  $('cfo-f-search').onclick = search;
  onEnter('cfo-f-q', search);
  // Export / Import (ผู้ใช้กำหนด 2026-11-02): one file per table, the first row = column names (CFO_REF_FILE) · id = the row to update
  const fileCols = spec.file || CFO_REF_FILE;
  $('cfo-export').onclick = () => cfoDownload(`EF_${sheet}_${new Date().toISOString().slice(0, 10)}.csv`,
    [...(spec.file ? [] : [fileCols.map(([k]) => k)]), fileCols.map(([, label]) => label), ...rows.map((r) => fileCols.map(([k]) => r[k] ?? ''))]);
  if (!m.admin) return;
  $('cfo-import').onclick = () => cfoRefImport(sheet, spec, rerender);
  const fields = spec.cols.map(([key, label, unit, num]) => ({ key, label: unit ? `${label} ${unit}` : label, type: num ? 'number' : undefined }));
  const fixed = sheet === 'ipcc' ? { unit: 'TJ' } : {};
  $('cfo-add').onclick = () => {
    const lastGroup = rows[rows.length - 1]?.grp || '';
    openPopup(`เพิ่ม: ${spec.title}`, gridField('cfo-grid', [...(spec.groupCol ? [] : [{ key: 'grp', label: 'กลุ่ม', value: lastGroup, width: '140px' }]), ...fields.map((f) => ({ ...f, width: f.type || ['code', 'item_no', 'unit'].includes(f.key) ? '100px' : undefined, ...(f.key === 'grp' ? { value: lastGroup } : {}) }))], 5,
      `คัดลอกหลายแถวจาก Excel แล้ววาง (Ctrl+V)${spec.groupCol ? ' · id ว่าง = ระบบตั้งให้' : ' · Total ว่าง = คิดจาก GWP'} · แถวว่างไม่บันทึก`), async () => {
      const n = await gridSave(grid, (v) => a5Api(CFO, 'cfo/ref', { method: 'POST', body: { ...fixed, ...v, sheet } }));
      toast(`เพิ่ม ${n} รายการ`);
      closePopup();
      rerender();
    });
    const grid = gridBind('cfo-grid');
  };
  $('cfo-edit').onclick = () => {
    if (!picked) return;
    const r = picked;
    const area = (key) => key === 'reference' || key === 'remark';
    openPopup('แก้ไขรายการ', `
      ${spec.groupCol ? '' : field('กลุ่ม', `<input id="cfo-r-grp" maxlength="120" list="cfo-groups" value="${esc(r.grp || '')}"><datalist id="cfo-groups">${groups.map((v) => `<option value="${esc(v)}">`).join('')}</datalist>`)}
      ${fields.filter((f) => !f.type).map((f) => field(f.label, area(f.key) ? `<textarea id="cfo-r-${f.key}" rows="2" maxlength="1000">${esc(r[f.key] || '')}</textarea>` : `<input id="cfo-r-${f.key}" maxlength="300" value="${esc(r[f.key] || '')}">`)).join('')}
      <div class="cfo-gas">${fields.filter((f) => f.type).map((f) => field(f.label, `<input id="cfo-r-${f.key}" type="number" step="any" value="${esc(r[f.key] ?? '')}">`)).join('')}
        ${field('สัดส่วนชีวมวล', `<input id="cfo-r-ratio" type="number" step="any" value="${esc(r.ratio ?? '')}">`)}${field('ลำดับ', `<input id="cfo-r-sort" type="number" value="${esc(r.sort_no)}">`)}</div>
      ${field('สถานะ', `<select id="cfo-r-status">${options(['Active', 'Inactive'], r.status)}</select>`)}`, async () => {
      const body2 = { ...fixed, sheet, grp: $('cfo-r-grp').value, ratio: $('cfo-r-ratio').value, sort_no: $('cfo-r-sort').value, status: $('cfo-r-status').value };
      fields.forEach((f) => { body2[f.key] = $(`cfo-r-${f.key}`).value; });
      await a5Api(CFO, `cfo/ref/${r.id}`, { method: 'PATCH', body: body2 });
      toast('บันทึกแล้ว');
      closePopup();
      rerender();
    });
    // the gas values drive Total like the sheet's formula (it can still be typed over)
    const gases = ['co2', 'ch4_fossil', 'ch4', 'n2o'].filter((k) => $(`cfo-r-${k}`));
    const v = (key) => Number($(`cfo-r-${key}`)?.value || 0);
    gases.forEach((k) => { $(`cfo-r-${k}`).oninput = () => { $('cfo-r-total').value = Number((v('co2') + v('ch4_fossil') * (gwp.ch4_fossil || 0) + v('ch4') * (gwp.ch4 || 0) + v('n2o') * (gwp.n2o || 0)).toPrecision(12)); }; });
  };
  $('cfo-del').onclick = () => picked && confirmPopup('ลบรายการ', `ลบ ${esc(picked.name)}`, async () => {
    await a5Api(CFO, `cfo/ref/${picked.id}`, { method: 'DELETE' });
    toast('ลบแล้ว');
    rerender();
  });
}

// Setting > วัสดุ (SAP) (ผู้ใช้กำหนด 2026-11-01): SAP materials matched to an EF + unit factor, and the monthly Usage
// pasted from SAP. Only materials with an EF are counted (Scope 3); the rest are listed so more can be matched.
// Server: cfo/materials, cfo/material-usage · the paper helper turns gsm × sheet size × sheets into kg per SAP unit.
const CFO_PAPER = { A4: 0.06237, A3: 0.12474, A5: 0.031185, F4: 0.0710 }; // m² per sheet
const cfoMatFilter = { ef: '', kind: '', q: '' };
// ประเภทวัสดุ (server MAT_KINDS): Usage = ของใช้สิ้นเปลือง (Store) · วัตถุดิบ · อื่นๆ
const CFO_MAT_KINDS = { usage: 'Usage', raw: 'วัตถุดิบ', other: 'อื่นๆ' };
async function cfoSetMaterial(body, m, rerender) {
  const d = await a5Api(CFO, `cfo/materials?year=${a5Year}`);
  const refs = new Map(m.refs.map((r) => [r.id, r]));
  const s3 = m.scopes.filter((sc) => sc.scope === 3).sort((x, y) => Number(x.code.split('-')[1]) - Number(y.code.split('-')[1]));
  const efOf = (row) => refs.get(row.ef_ref_id);
  let picked = null;
  const draw = () => {
    const term = cfoMatFilter.q.trim().toLowerCase();
    const list = d.rows.filter((r) => (!cfoMatFilter.ef || (cfoMatFilter.ef === 'yes') === Boolean(r.ef_ref_id && r.factor)) && (!cfoMatFilter.kind || (r.kind || 'usage') === cfoMatFilter.kind)
      && (!term || `${r.material} ${r.name} ${efOf(r)?.name || ''}`.toLowerCase().includes(term)));
    const shown = list.slice(0, 500);
    $('cfo-rows').innerHTML = `<table class="mo-data-table cfo-reftab"><thead><tr><th class="c-unit">Material</th><th class="c-unit">ประเภท</th><th class="c-name">รายละเอียด</th><th class="c-unit">หน่วย SAP</th>
      <th class="c-name">Emission factor</th><th class="num c-num">ตัวแปลง</th><th class="c-unit">หน่วย EF</th><th class="num c-num">kgCO₂e / หน่วย SAP</th><th class="c-unit">หมวด</th><th class="c-unit">สถานะ</th></tr></thead>
      <tbody>${shown.map((r) => {
        const e = efOf(r);
        return `<tr data-pick="${esc(r.material)}"${r.status === 'Inactive' ? ' class="is-muted"' : ''}><td class="c-unit">${esc(r.material)}</td><td class="c-unit">${esc(CFO_MAT_KINDS[r.kind || 'usage'])}</td><td class="c-name">${esc(r.name)}</td><td class="c-unit">${esc(r.sap_unit || '')}</td>
          <td class="c-name">${e ? esc(e.name.replace(/^-\s*/, '')) : '<span class="sum-meta">ยังไม่มี EF</span>'}</td><td class="num c-num">${r.factor == null ? '' : cfoRefNum(r.factor)}</td><td class="c-unit">${esc(e?.unit || '')}</td>
          <td class="num c-num">${e && r.factor ? cfoRefNum(Number(r.factor) * Number(e.total)) : ''}</td><td class="c-unit">${esc(r.scope_code)}</td><td class="c-unit">${esc(r.status)}</td></tr>`;
      }).join('') || '<tr><td class="empty" colspan="10">ไม่มีรายการ</td></tr>'}</tbody></table>`;
    $('cfo-mat-count').textContent = `${list.length.toLocaleString()} รายการ${list.length > shown.length ? ` (แสดง ${shown.length} แรก พิมพ์ค้นหาเพื่อดูเพิ่ม)` : ''} · มี EF ${d.rows.filter((r) => r.ef_ref_id && r.factor).length.toLocaleString()} จาก ${d.rows.length.toLocaleString()}`;
    picked = null;
    ['cfo-edit', 'cfo-del'].forEach((b) => { if ($(b)) $(b).disabled = true; });
    bindRowSelect($('cfo-rows'), (code) => { picked = d.rows.find((r) => r.material === code); ['cfo-edit', 'cfo-del'].forEach((b) => { if ($(b)) $(b).disabled = !picked; }); });
  };
  const months = d.months.slice().reverse();
  body.innerHTML = `
    <div class="toolbar a5-filters">
      ${field('ประเภท', `<select id="cfo-f-matkind">${options(['', ...Object.keys(CFO_MAT_KINDS)], cfoMatFilter.kind, (v) => (v ? CFO_MAT_KINDS[v] : 'ทั้งหมด'))}</select>`)}
      ${field('EF', `<select id="cfo-f-matef">${options(['', 'yes', 'no'], cfoMatFilter.ef, (v) => ({ '': 'ทั้งหมด', yes: 'มี EF (คิดค่า)', no: 'ยังไม่มี EF' })[v])}</select>`)}
      ${searchSlot('ค้นหา', 'cfo-f-q', 'cfo-f-search', { placeholder: 'รหัส ชื่อวัสดุ หรือ EF' })}
      ${d.admin ? `<div class="action-bar">${button('cfo-usage', 'วาง Usage', 'primary')}${button('cfo-add', 'เพิ่ม', 'secondary')}${button('cfo-edit', 'แก้ไข', 'secondary', 'disabled')}${button('cfo-del', 'ลบ', 'danger', 'disabled')}</div>` : ''}
    </div>
    <div class="table-wrap sheet cfo-efgrid" id="cfo-rows"></div>
    <p class="sum-meta" id="cfo-mat-count"></p>
    ${d.sections.length ? `<div class="cfo-mat-months"><strong class="plan-label">Usage ตาม Section ปี ${a5Year} (tCO₂e · มากไปน้อย)</strong>
      <div class="table-wrap cfo-efgrid"><table class="mo-data-table"><thead><tr><th class="c-unit">Section</th>${ACT_MONTHS_SHORT.map((n) => `<th class="num">${esc(n)}</th>`).join('')}<th class="num">รวม</th><th class="num">%</th></tr></thead>
      <tbody>${(() => { const all = d.sections.reduce((t, x) => t + x.tco2e, 0); return d.sections.map((x) => `<tr><td class="c-unit">${esc(x.department)}</td>${ACT_MONTHS.map((_, i) => `<td class="num">${x.months[i + 1] ? cfoT(x.months[i + 1]) : ''}</td>`).join('')}<td class="num"><b>${cfoT(x.tco2e)}</b></td><td class="num">${all ? Math.round((x.tco2e / all) * 100) : 0}%</td></tr>`).join(''); })()}</tbody></table></div></div>` : ''}
    <div class="cfo-mat-months"><strong class="plan-label">Usage ที่บันทึกแล้ว</strong>
      ${months.length ? `<div class="table-wrap cfo-efgrid cfo-mat-saved"><table class="mo-data-table"><thead><tr><th class="c-unit">เดือน</th><th class="num c-num">รายการ</th><th class="num c-num">tCO₂e</th>${d.admin ? '<th class="c-unit"></th>' : ''}</tr></thead>
        <tbody>${months.map((x) => `<tr><td class="c-unit">${esc(x.month.slice(0, 7))}</td><td class="num c-num">${x.rows.toLocaleString()}</td><td class="num c-num">${cfoT(x.tco2e)}</td>${d.admin ? `<td class="c-unit"><button class="apl-link" type="button" data-mat-del="${esc(x.month.slice(0, 7))}">ลบเดือนนี้</button></td>` : ''}</tr>`).join('')}</tbody></table></div>` : '<p class="sum-meta">ยังไม่มี กด "วาง Usage" แล้วคัดลอกจาก SAP มาวาง</p>'}</div>`;
  $('cfo-f-q').value = cfoMatFilter.q;
  draw();
  a5Lift(body);
  $('cfo-f-matef').onchange = () => { cfoMatFilter.ef = $('cfo-f-matef').value; draw(); };
  $('cfo-f-matkind').onchange = () => { cfoMatFilter.kind = $('cfo-f-matkind').value; draw(); };
  const search = () => { cfoMatFilter.q = $('cfo-f-q').value; draw(); };
  $('cfo-f-search').onclick = search;
  onEnter('cfo-f-q', search);
  if (!d.admin) return;
  body.querySelectorAll('[data-mat-del]').forEach((node) => {
    node.onclick = () => confirmPopup('ลบ Usage', `ลบ Usage วัสดุเดือน ${esc(node.dataset.matDel)} ทั้งเดือน`, async () => {
      await a5Api(CFO, `cfo/material-usage/${node.dataset.matDel}`, { method: 'DELETE' });
      toast('ลบแล้ว');
      rerender();
    });
  });
  const scopeOpts = s3.map((sc) => [sc.code, `${sc.code} ${sc.name_th || sc.name}`]);
  // add / match many: paste from Excel · EF = the name as written in EF CFP / EF พลังงาน
  $('cfo-add').onclick = () => {
    openPopup('เพิ่ม / จับคู่วัสดุ', gridField('cfo-grid', [
      { key: 'material', label: 'Material', width: '110px' }, { key: 'kind', label: 'ประเภท', type: 'select', options: Object.entries(CFO_MAT_KINDS), value: 'usage', width: '110px' },
      { key: 'name', label: 'รายละเอียด' }, { key: 'sap_unit', label: 'หน่วย SAP', width: '90px' },
      { key: 'ef_name', label: 'EF (ชื่อตามตาราง EF CFP)' }, { key: 'factor', label: 'ตัวแปลง', type: 'number', width: '100px' },
      { key: 'scope_code', label: 'หมวด', type: 'select', options: scopeOpts, value: '3-1', width: '150px' }
    ], 5, 'วางหลายแถวจาก Excel ได้ · รหัสที่มีอยู่แล้ว = แก้ EF / ตัวแปลง · ตัวแปลง = 1 หน่วย SAP เท่ากับกี่หน่วยของ EF · แถวว่างไม่บันทึก'), async () => {
      const rows = grid.rows().map(({ values }) => values);
      if (!rows.length) throw new Error('ยังไม่มีข้อมูลในตาราง');
      const r = await a5Api(CFO, 'cfo/materials', { method: 'POST', body: { rows } });
      toast(`บันทึก ${r.count} รายการ`);
      closePopup();
      rerender();
    });
    const grid = gridBind('cfo-grid');
  };
  $('cfo-edit').onclick = () => {
    if (!picked) return;
    const r = picked;
    const groups = cfoEfGroups((x) => ['cfp', 'energy', 'chemical'].includes(x.sheet));
    openPopup(`วัสดุ ${esc(r.material)}`, `
      ${field('ประเภท', `<select id="cfo-m-kind">${options(Object.keys(CFO_MAT_KINDS), r.kind || 'usage', (v) => CFO_MAT_KINDS[v])}</select>`)}
      ${field('รายละเอียด', `<input id="cfo-m-name" maxlength="300" value="${esc(r.name)}">`)}
      ${field('หน่วย SAP', `<input id="cfo-m-unit" maxlength="20" value="${esc(r.sap_unit || '')}">`)}
      ${field('Emission factor', `<select id="cfo-m-ef"><option value="">- ไม่คิด (ยังไม่มี EF) -</option>${groups}</select>`)}
      ${field('ตัวแปลง: 1 หน่วย SAP = ? หน่วย EF', `<input id="cfo-m-factor" type="number" step="any" value="${esc(r.factor ?? '')}">`)}
      <p class="sum-meta" id="cfo-m-hint"></p>
      <details class="cfo-paper"><summary>ตัวช่วยคิดกระดาษ (แกรม × ขนาด × จำนวนแผ่น → kg)</summary>
        <div class="cfo-gas">${field('แกรม (g/m²)', '<input id="cfo-p-gsm" type="number" step="any" value="80">')}${field('ขนาด', `<select id="cfo-p-size">${options(Object.keys(CFO_PAPER), 'A4')}</select>`)}${field('แผ่นต่อหน่วย SAP', '<input id="cfo-p-sheets" type="number" value="500">')}</div>
        ${button('cfo-p-calc', 'ใส่ค่าตัวแปลง')}</details>
      ${field('หมวด', `<select id="cfo-m-scope">${scopeOpts.map(([v, l]) => `<option value="${v}"${v === r.scope_code ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`)}
      ${field('สถานะ', `<select id="cfo-m-status">${options(['Active', 'Inactive'], r.status)}</select>`)}`, async () => {
      await a5Api(CFO, `cfo/materials/${encodeURIComponent(r.material)}`, { method: 'PATCH', body: { kind: $('cfo-m-kind').value, name: $('cfo-m-name').value, sap_unit: $('cfo-m-unit').value,
        ef_ref_id: $('cfo-m-ef').value.replace('ref:', ''), factor: $('cfo-m-factor').value, scope_code: $('cfo-m-scope').value, status: $('cfo-m-status').value } });
      toast('บันทึกแล้ว');
      closePopup();
      rerender();
    });
    if (r.ef_ref_id) $('cfo-m-ef').value = `ref:${r.ef_ref_id}`;
    const hint = () => {
      const e = refs.get(Number($('cfo-m-ef').value.replace('ref:', '')));
      const f = Number($('cfo-m-factor').value);
      $('cfo-m-hint').textContent = e ? `1 ${$('cfo-m-unit').value || 'หน่วย SAP'} = ${f || '?'} ${e.unit} × ${cfoRefNum(e.total)} kgCO₂e/${e.unit} = ${f ? cfoRefNum(f * Number(e.total)) : '?'} kgCO₂e` : 'ยังไม่เลือก EF: วัสดุนี้จะไม่ถูกคิด';
    };
    ['cfo-m-ef', 'cfo-m-factor', 'cfo-m-unit'].forEach((id) => { $(id).oninput = hint; $(id).onchange = hint; });
    $('cfo-p-calc').onclick = () => {
      $('cfo-m-factor').value = Number(((Number($('cfo-p-gsm').value) * CFO_PAPER[$('cfo-p-size').value] * Number($('cfo-p-sheets').value)) / 1000).toPrecision(6));
      hint();
    };
    hint();
  };
  $('cfo-del').onclick = () => picked && confirmPopup('ลบวัสดุ', `ลบ ${esc(picked.material)} ${esc(picked.name)}`, async () => {
    await a5Api(CFO, `cfo/materials/${encodeURIComponent(picked.material)}`, { method: 'DELETE' });
    toast('ลบแล้ว');
    rerender();
  });
  // monthly Usage: paste the SAP export (Material · ปริมาณ · หน่วย · หน่วยงาน / Cost center), check, then save the month
  $('cfo-usage').onclick = () => {
    const now = new Date();
    const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    openPopup('วาง Usage จาก SAP', `
      ${field('เดือน', `<input id="cfo-u-month" type="month" value="${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}">`)}
      ${field('คัดลอกจาก Excel ทั้งแผ่นพร้อมหัวตาราง (costcenter · material · unit · current) หรือ 4 คอลัมน์ Material · ปริมาณ · หน่วย · Cost center', '<textarea id="cfo-u-text" rows="8" placeholder="costcenter&#9;material&#9;material_description&#9;unit&#9;price&#9;currency&#9;total&#9;min&#9;current"></textarea>')}
      ${button('cfo-u-check', 'ตรวจ')}
      <div id="cfo-u-result" class="sum-meta">วางข้อมูลแล้วกด ตรวจ ก่อนบันทึก · บันทึกเดือนเดิมซ้ำ = แทนที่ทั้งเดือน</div>`, async () => {
      const r = await send(true);
      toast(`บันทึก ${r.counted} รายการ ${cfoT(r.tco2e)} tCO₂e`);
      closePopup();
      rerender();
    }, 'บันทึกเดือนนี้');
    // a header row picks the columns by name (SAP Usage sheet: costcenter · material · unit · current = ปริมาณ);
    // without one the order is Material · ปริมาณ · หน่วย · หน่วยงาน / Cost center
    const parse = () => {
      const lines = $('cfo-u-text').value.replace(/\r/g, '').split('\n').filter((l) => l.trim()).map((l) => l.split('\t').map((c) => c.trim()));
      const head = (lines[0] || []).map((c) => c.toLowerCase());
      const at = (...names) => head.findIndex((h) => names.includes(h));
      const col = head.includes('material')
        ? { material: at('material'), qty: at('current', 'qty', 'quantity', 'usage', 'ปริมาณ'), unit: at('unit', 'bun', 'หน่วย'), department: at('costcenter', 'cost center', 'section', 'department', 'หน่วยงาน'),
          amount: at('total', 'amount', 'มูลค่า', 'เงิน'), price: at('price', 'ราคา') }
        : { material: 0, qty: 1, unit: 2, department: 3, amount: -1, price: -1 };
      if (col.qty < 0) throw new Error('ไม่พบคอลัมน์ปริมาณ (current / qty)');
      const num = (v) => String(v ?? '').replace(/,/g, '');
      return lines.slice(head.includes('material') ? 1 : 0).filter((c) => c[col.material] && num(c[col.qty]) !== '' && Number.isFinite(Number(num(c[col.qty]))))
        .map((c) => ({ material: c[col.material].replace(/\.0+$/, ''), qty: num(c[col.qty]), unit: col.unit >= 0 ? c[col.unit] : '', department: col.department >= 0 ? String(c[col.department] || '').replace(/\.0+$/, '') : '',
          amount: col.amount >= 0 ? num(c[col.amount]) : '', price: col.price >= 0 ? num(c[col.price]) : '' }));
    };
    const send = async (save) => {
      const rows = parse();
      if (!rows.length) throw new Error('ยังไม่มีข้อมูล (คอลัมน์ 2 ต้องเป็นตัวเลข)');
      return a5Api(CFO, 'cfo/material-usage', { method: 'POST', body: { month: $('cfo-u-month').value, rows, save } });
    };
    const list = (title, part, extra) => (part.count ? `<details><summary>${title} ${part.count.toLocaleString()} รายการ</summary><ul class="cfo-u-list">${part.top.map((x) => `<li>${esc(x.material)} ${esc(x.name || '')} · ${cfoT(x.qty)} ${esc(x.unit || '')}${extra ? extra(x) : ''}${x.department ? ` · ${esc(x.department)}` : ''}</li>`).join('')}</ul></details>` : '');
    $('cfo-u-check').onclick = () => send(false).then((r) => {
      $('cfo-u-result').innerHTML = `<b>${r.lines.toLocaleString()} บรรทัด → คิดได้ ${r.counted.toLocaleString()} รายการ = ${cfoT(r.tco2e)} tCO₂e</b>${r.skipped ? ` · ข้าม ${r.skipped.toLocaleString()} บรรทัดที่ปริมาณ 0 หรือติดลบ` : ''}
        ${list('ยังไม่มี EF (ไม่คิด)', r.noEf)}${list('หน่วยไม่ตรงกับที่จับคู่ (ไม่คิด)', r.unitWrong, (x) => ` (จับคู่ไว้ ${esc(x.sap_unit)})`)}${list('ไม่มีในรายการวัสดุ (ไม่คิด)', r.unknown)}`;
    }).catch(onErr);
  };
}

// File columns of a reference table (Export writes them, Import reads them by the key in row 1; row 2 = Thai label, skipped)
const CFO_REF_FILE = [['code', 'id'], ['id', 'รหัสระบบ (ห้ามแก้)'], ['grp', 'กลุ่ม'], ['name', 'ชื่อ / รายการ'], ['formula', 'รายละเอียด'], ['unit', 'หน่วย'],
  ['co2', 'CO2'], ['ch4_fossil', 'Fossil CH4'], ['ch4', 'CH4'], ['n2o', 'N2O'], ['total', 'Total / EF / ค่า'], ['ratio', 'สัดส่วนชีวมวล'],
  ['reference', 'แหล่งข้อมูล'], ['remark', 'หมายเหตุ'], ['sort_no', 'ลำดับ'], ['status', 'สถานะ (Active / Inactive)']];

// CSV text → rows of cells (quotes, "" inside quotes, commas and new lines inside quotes)
function cfoCsv(text) {
  const out = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i += 1; row.push(cell); out.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out;
}

// .xlsx / .xls need SheetJS: loaded from cdnjs the first time an Excel file is imported
let cfoXlsx = null;
const cfoLoadXlsx = () => cfoXlsx || (cfoXlsx = new Promise((resolve, reject) => {
  const tag = document.createElement('script');
  tag.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  tag.onload = () => resolve(window.XLSX);
  tag.onerror = () => { cfoXlsx = null; reject(new Error('โหลดตัวอ่าน Excel ไม่ได้ ลองบันทึกไฟล์เป็น CSV แล้ว Import อีกครั้ง')); };
  document.head.append(tag);
}));

async function cfoReadSheetFile(file) {
  if (/\.csv$/i.test(file.name)) return cfoCsv((await file.text()).replace(/^﻿/, ''));
  const XLSX = await cfoLoadXlsx();
  const book = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, raw: true, defval: '' });
}

// Import popup: choose the file → check (counts of new / updated rows) → save. Columns are found by the key or Thai label
// of row 1, so a file from Export (or the same columns typed by hand) works.
function cfoRefImport(sheet, spec, rerender) {
  let rows = null;
  openPopup(`Import: ${spec.title}`, `
    ${field('ไฟล์ Excel (.xlsx) หรือ CSV', '<input id="cfo-imp-file" type="file" accept=".xlsx,.xls,.csv">')}
    <p class="sum-meta">ใช้ไฟล์จากปุ่ม Export เป็นแบบฟอร์ม (EF CFP เรียงคอลัมน์ตาม อบก. คัดลอกตารางจากเว็บ อบก. มาวางแล้วเติม id ได้) · แถวแรก = ชื่อคอลัมน์ · id ที่มีอยู่ = แก้รายการเดิม · id ว่างหรือใหม่ = เพิ่ม (id ว่าง ระบบตั้งให้) · กลุ่มว่าง = ใช้กลุ่มของแถวบน · Total ว่าง + มีค่าแยกก๊าซ = คิดจาก GWP · ระบบตรวจทุกแถวก่อน ถ้ามีแถวผิดจะไม่บันทึกเลย</p>
    <div id="cfo-imp-result" class="sum-meta"></div>`, async () => {
    if (!rows) throw new Error('เลือกไฟล์ก่อน');
    const r = await a5Api(CFO, 'cfo/ref/import', { method: 'POST', body: { sheet, rows, save: true } });
    toast(`นำเข้าแล้ว เพิ่ม ${r.add} · แก้ ${r.update} รายการ`);
    closePopup();
    rerender();
  }, 'นำเข้า');
  $('cfo-imp-file').onchange = async () => {
    const file = $('cfo-imp-file').files[0];
    rows = null;
    $('cfo-imp-result').textContent = 'กำลังอ่านไฟล์...';
    try {
      const cells = (await cfoReadSheetFile(file)).filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
      const name = (h) => String(h ?? '').trim().toLowerCase();
      const head = (cells[0] || []).map(name);
      const cols = spec.file || CFO_REF_FILE;
      const at = Object.fromEntries(cols.map(([k, label]) => [k, head.findIndex((h) => h === k || h === name(label) || (k === 'total' && h.startsWith('ค่าแฟคเตอร์')))]));
      if (at.name < 0) throw new Error('ไม่พบคอลัมน์ชื่อในแถวแรก ใช้ไฟล์จากปุ่ม Export เป็นแบบ');
      const nameLabel = name((cols.find(([k]) => k === 'name') || [])[1]);
      const isLabelRow = (r) => name(r[at.name]) === nameLabel;
      rows = cells.slice(1).map((r, i) => ({ r, line: i + 2 })).filter(({ r }) => !isLabelRow(r) && String(r[at.name] ?? '').trim())
        .map(({ r, line }) => ({ line, ...Object.fromEntries(cols.filter(([k]) => at[k] >= 0).map(([k]) => [k, String(r[at[k]] ?? '').trim()])) }));
      if (!rows.length) throw new Error('ไม่พบแถวข้อมูล');
      const check = await a5Api(CFO, 'cfo/ref/import', { method: 'POST', body: { sheet, rows, save: false } });
      $('cfo-imp-result').innerHTML = `<b>${rows.length} แถว · เพิ่มใหม่ ${check.add} · แก้รายการเดิม ${check.update}</b> · กด นำเข้า เพื่อบันทึก`;
    } catch (err) {
      rows = null;
      $('cfo-imp-result').innerHTML = `<span class="form-error">${esc(err.message)}</span>`;
    }
  };
}

function cfoSetCompany(body, m, rerender) {
  // + pieces produced in the base year and this year (Summary 2 Carbon intensity)
  const years = [...new Set([Number(m.settings.base_year) || 0, a5Year].filter(Boolean))];
  const keys = [...CFO_COMPANY, ...years.map((y) => [`production_${y}`, `ปริมาณผลิต ปี ${y} (ชิ้น)`])];
  body.innerHTML = `
    ${m.admin ? `<div class="action-bar a5-actions">${button('cfo-save', 'บันทึก', 'primary')}</div>` : ''}
    <div class="cfo-company">${keys.map(([key, label]) => field(label, `<input id="cfo-s-${key}" maxlength="1000" value="${esc(m.settings[key] ?? '')}"${key === 'company_updated' ? ' type="date"' : ''}${m.admin ? '' : ' readonly'}>`)).join('')}</div>`;
  a5Lift(body);
  if (!m.admin) return;
  $('cfo-save').onclick = () => {
    const values = Object.fromEntries(keys.map(([key]) => [key, $(`cfo-s-${key}`).value]));
    a5Api(CFO, 'cfo/settings', { method: 'PUT', body: values }).then(() => { toast('บันทึกแล้ว'); rerender(); }).catch(onErr);
  };
}

Object.assign(VIEWS, { [`${CFO}-home`]: cfoDashboard, [`${CFO}-edit`]: cfoEntries, [`${CFO}-setting`]: cfoSetting });
