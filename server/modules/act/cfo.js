import { mx, tx } from '../../core/db.js';
import { fail } from '../../core/http.js';
import { dropFiles } from '../../core/storage.js';
import { accessOf, actRoute, dateOf, fetchAll, fetchIn, imageBytes, must, namesOf, requireAdmin, tablesOf, yearOf } from './common.js';

// CFO (Carbon Footprint for Organization): Dashboard totals, monthly entry, and master data (EF, activities, company).
// Tables: db/act/cfo.sql (scripts/act-sql.js cfoSql) · spec: docs/specs/act-cfo.md
export const CFO_ON = ['cfo'];
const SETTING_KEYS = ['company_name', 'company_address', 'company_area', 'company_business', 'company_customers', 'company_employees', 'company_updated',
  'company_photo1', 'company_photo2', 'company_register', 'base_year', 'target_percent', 'septic_bod', 'septic_b0', 'septic_mcf', 'septic_i',
  's3_w_magnitude', 's3_w_influence', 's3_w_risk', 's3_w_opportunity', 's3_pass', 's3_mag_bands'];
// production_<year> = pieces produced that year (Carbon intensity = tCO2e / pieces)
const settingKey = (k) => SETTING_KEYS.includes(k) || /^production_\d{4}$/.test(k);
const GWP_GASES = ['co2', 'ch4_fossil', 'ch4', 'n2o', 'sf6', 'nf3'];
// mt_cfo_ef_ref: energy = EF ต่อหน่วย · chemical = GWP สารเคมี · ipcc = EF ต่อ TJ · fuel = ค่าความร้อน / ความหนาแน่น / ตัวแปลงหน่วย · cfp = EF ของ CFP
const REF_SHEETS = ['energy', 'chemical', 'ipcc', 'fuel', 'cfp'];
// tables an activity can take its EF from (per unit of what it records; IPCC is per TJ and fuel holds properties)
const REF_PICK = ['energy', 'chemical', 'cfp'];
const REF_NUMBERS = ['co2', 'ch4_fossil', 'ch4', 'n2o', 'total', 'ratio'];
// id shown to users (mt_cfo_ef_ref.code): prefix per table, CFP-0001 … · a code is typed in activities and materials
const REF_PREFIX = { cfp: 'CFP', energy: 'CFO', chemical: 'CFO' }; // CFO-xxxx = เอกสาร EF ของ CFO (อบก.)
const refCode = (v) => String(v ?? '').trim().toUpperCase().slice(0, 40) || null;
// Weighted Fr-03.2 (ผู้ใช้กำหนด 2026-11-02): levels 1–5 · score = Σ level × weight · significant = source and (sector ✓ or score ≥ pass)
export const S3_LEVELS = ['magnitude', 'influence', 'risk', 'opportunity'];
export const s3Rule = (settings = {}) => {
  const num = (k, d) => (Number.isFinite(Number(settings[k])) && settings[k] !== '' && settings[k] != null ? Number(settings[k]) : d);
  const bands = String(settings.s3_mag_bands || '10,20,30,40').split(',').map(Number).filter(Number.isFinite);
  return { weights: { magnitude: num('s3_w_magnitude', 40), influence: num('s3_w_influence', 30), risk: num('s3_w_risk', 15), opportunity: num('s3_w_opportunity', 15) },
    pass: num('s3_pass', 3), bands: bands.length === 4 ? bands : [10, 20, 30, 40] };
};
// % GHG of the category → level 1 (<10%) … 5 (≥40%) with the bands of the rule
export const s3MagLevel = (pct, rule) => 1 + rule.bands.filter((b) => pct >= b).length;
export const s3Level = (v) => Math.min(5, Math.max(0, Math.round(Number(v) || 0)));
export const s3Weighted = (r, rule) => Math.round(S3_LEVELS.reduce((sum, k) => sum + s3Level(r[k]) * (rule.weights[k] / 100), 0) * 100) / 100;

const text = (v, max = 500) => String(v ?? '').trim().slice(0, max) || null;
const numOrNull = (v) => (v === '' || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : NaN);
const monthOf = (v) => (/^\d{4}-\d{2}$/.test(String(v || '')) ? dateOf(`${v}-01`) : null);

// Septic tank (IPCC, as TSATP4-CFO septicCalc): kg CH4 = people × days × BOD × 0.001 × I × B0 × MCF.
export function septicKg(inputs, s) {
  const n = (k) => Number(s[k] || 0);
  return Math.round(Number(inputs.people || 0) * Number(inputs.days || 0) * n('septic_bod') * 0.001 * n('septic_i') * n('septic_b0') * n('septic_mcf') * 1e6) / 1e6;
}

// Quantity formulas (activity.calc): the inputs the form asks for → qty in the EF unit.
export const CFO_CALCS = {
  septic: { fields: ['people', 'days'], ok: (i) => i.people >= 0 && i.days > 0, error: 'ระบุจำนวนคน (0 ขึ้นไป) และจำนวนวันทำงาน (มากกว่า 0)', qty: (i, s) => septicKg(i, s) },
  tkm: { fields: ['tons', 'km'], ok: (i) => i.tons >= 0 && i.km >= 0, error: 'ระบุน้ำหนัก (ตัน) และระยะทาง (กม.) 0 ขึ้นไป', qty: (i) => Math.round(i.tons * i.km * 1e6) / 1e6 },
  km_fuel: { fields: ['km', 'km_per_l'], ok: (i) => i.km >= 0 && i.km_per_l > 0, error: 'ระบุระยะทาง (กม.) และอัตราสิ้นเปลือง (กม./ลิตร มากกว่า 0)', qty: (i) => Math.round((i.km / i.km_per_l) * 1e6) / 1e6 }
};

export function mountCfo(app) {
  const route = actRoute(app, { only: CFO_ON });
  const settingsOf = async (t) => Object.fromEntries((must(await tx.from(t.setting).select('key,value'))).map((r) => [r.key, r.value]));
  const thisYear = () => new Date().getFullYear();
  // บันทึกการปรับปรุง: written next to an admin change. A missing table (SQL not run yet) never blocks the change.
  const logRev = async (t, req, area, ref, detail) => {
    if (!detail) return;
    const { error } = await tx.from(t.revision).insert({ area, ref: ref == null ? null : String(ref).slice(0, 300), detail: String(detail).slice(0, 2000), by: req.user.employeeId });
    if (error) console.warn(`cfo revision log: ${error.message}`);
  };
  const changes = (before, after, keys) => keys.filter((k) => String(before?.[k] ?? '') !== String(after[k] ?? ''))
    .map((k) => `${k}: ${before?.[k] ?? '-'} → ${after[k] ?? '-'}`).join(' · ');

  // ---------- Dashboard ----------
  // Year totals by month / scope / category / department, compared with the base year (setting base_year) and
  // its target (target_percent, default 5% as TSATP4-CFO) or, without a base year, with the year before.
  // department filters everything; base and target follow the same filter.
  route('get', '/api/act/:activity/cfo/summary', async (req, res, activity, t) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const department = text(req.query.department, 80);
    const rowsOf = (y) => fetchAll(() => {
      let q = tx.from(t.entryView).select('*').gte('month', `${y}-01-01`).lte('month', `${y}-12-01`).order('id');
      if (department) q = q.eq('department', department);
      return q;
    });
    const [settings, curAll] = await Promise.all([settingsOf(t), rowsOf(year)]);
    const baseYear = yearOf(settings.base_year, 0) || null;
    const compareYear = baseYear && baseYear !== year ? baseYear : year - 1;
    const target = Number(settings.target_percent ?? 5) || 0;
    // รายงานแยก (EF separate) stays out of every Scope total and is reported on its own (Fr-05 "อื่นๆ").
    const baseAll = await rowsOf(compareYear);
    const [cur, base] = [curAll, baseAll].map((list) => list.filter((r) => !r.separate));
    const sum = (list) => Math.round(list.reduce((s, r) => s + Number(r.tco2e), 0) * 1000) / 1000;
    const inMonth = (list, m) => list.filter((r) => Number(r.month.slice(5, 7)) === m);
    // tco2e = this year, base = the compare year (categories: every category used in either year)
    const group = (key, label, list) => Object.values(list.reduce((acc, [r, field]) => {
      const k = r[key];
      acc[k] = acc[k] || { key: k, scope: r.scope, label: label(r), tco2e: 0, base: 0 };
      acc[k][field] += Number(r.tco2e);
      return acc;
    }, {})).map((g) => ({ ...g, tco2e: Math.round(g.tco2e * 1000) / 1000, base: Math.round(g.base * 1000) / 1000 })).sort((a, b) => b.tco2e - a.tco2e);
    const tagged = (withBase) => [...cur.map((r) => [r, 'tco2e']), ...(withBase ? base.map((r) => [r, 'base']) : [])];
    const gasOf = (list) => {
      const add = (key) => Math.round(list.reduce((s, r) => s + Number(r[key] || 0), 0) * 1000) / 1000;
      return { co2: add('tco2e_co2'), ch4: add('tco2e_ch4'), n2o: add('tco2e_n2o'), fgas: add('tco2e_fgas'), sf6nf3: add('tco2e_sf6_nf3') };
    };
    res.json({
      year,
      department,
      compare: { year: compareYear, isBase: compareYear === baseYear, target, total: sum(base), scopes: [1, 2, 3].map((n) => sum(base.filter((r) => r.scope === n))) },
      total: sum(cur),
      scopes: [1, 2, 3].map((scope) => ({ scope, tco2e: sum(cur.filter((r) => r.scope === scope)) })),
      months: Array.from({ length: 12 }, (_, i) => {
        const list = inMonth(cur, i + 1);
        const before = inMonth(base, i + 1);
        const was = sum(before);
        return {
          month: i + 1, scopes: [1, 2, 3].map((n) => sum(list.filter((r) => r.scope === n))), total: sum(list),
          base: was, baseScopes: [1, 2, 3].map((n) => sum(before.filter((r) => r.scope === n))), target: Math.round(was * (1 - target / 100) * 1000) / 1000
        };
      }),
      categories: group('scope_code', (r) => `${r.scope_code} ${r.scope_name}`, tagged(true))
        .sort((a, b) => a.scope - b.scope || Number(a.key.split('-')[1]) - Number(b.key.split('-')[1])),
      departments: group('department', (r) => r.department, tagged(false)),
      gases: [0, 1, 2, 3].map((scope) => ({ scope, ...gasOf(scope ? cur.filter((r) => r.scope === scope) : cur) })),
      separate: [curAll, baseAll].reduce((o, list, i) => ({ ...o, [i ? 'base' : 'tco2e']: Math.round((sum(list.filter((r) => r.separate)) + list.reduce((s, r) => s + Number(r.tco2e_bio || 0), 0)) * 1000) / 1000 }), {}),
      settings
    });
  });

  // CFO master data (EF, activities, materials) has no year: the admin of this year, or of last year while this year's
  // team is not set up yet (early January), may edit it (audit 2026-11-03)
  // next year's admin prepares too (activities and EF before the year starts, ผู้ใช้กำหนด 2026-11-05)
  const adminNext = async (req, activity) => (await accessOf(req, activity, thisYear() + 1)).admin;
  const requireAdminNow = async (req, res, activity) => {
    const now = thisYear();
    if ((await accessOf(req, activity, now)).admin || await adminNext(req, activity)) return true;
    const thisTeam = must(await tx.from(tablesOf(activity).team).select('id').eq('year', now).eq('role', 'admin').eq('status', 'Active').limit(1));
    if (!thisTeam.length && (await accessOf(req, activity, now - 1)).admin) return true;
    fail(res, 403, `แก้ได้เฉพาะ admin ของกิจกรรมนี้ปี ${now}`);
    return null;
  };
  // Every activity of a year with its months (Dashboard > Scope and transaction): months recorded / months due
  // (this year: up to this month) as TSATP4-CFO getScopeAccount, plus what this user may record (canEdit).
  // SAP Usage per section × month (ผู้ใช้กำหนด 2026-11-02): section = department of the cost center · [] before db/act/cfo.sql
  const usageBySection = async (t, year) => {
    const list = await fetchAll(() => tx.from(t.materialUse).select('department,month,tco2e,material,kind').gte('month', `${year}-01-01`).lte('month', `${year}-12-01`)).catch(() => []);
    const out = {};
    for (const u of list) {
      const key = u.department || '(ไม่ระบุ)';
      const sec = (out[key] = out[key] || { department: key, months: {}, items: {}, tco2e: 0 });
      const mo = Number(u.month.slice(5, 7));
      sec.months[mo] = Math.round(((sec.months[mo] || 0) + Number(u.tco2e)) * 1e6) / 1e6;
      (sec.items[mo] = sec.items[mo] || new Set()).add(u.material);
      sec.tco2e += Number(u.tco2e);
    }
    return Object.values(out).map((x) => ({ ...x, tco2e: Math.round(x.tco2e * 1e6) / 1e6, items: Object.fromEntries(Object.entries(x.items).map(([k, v]) => [k, v.size])) }))
      .sort((a, b) => b.tco2e - a.tco2e);
  };
  route('get', '/api/act/:activity/cfo/progress', async (req, res, activity, t) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const now = new Date();
    const due = year < now.getFullYear() ? 12 : year > now.getFullYear() ? 0 : now.getMonth() + 1;
    const adminNow = (await accessOf(req, activity, thisYear())).admin;
    await autoFillEf3(t, req, adminNow);
    await autoSyncSap(t, req, adminNow);
    const [access, settings, activities, efs, scopes, gwp, allEntries, details] = await Promise.all([
      accessOf(req, activity, year),
      settingsOf(t),
      fetchAll(() => tx.from(t.activity).select('*').order('id')),
      fetchAll(() => tx.from(t.ef).select('id,scope_code,kind,name,unit,kgco2e').order('id')),
      fetchAll(() => tx.from(t.cfoScope).select('code,name').order('code')),
      fetchAll(() => tx.from(t.gwp).select('code,ch4').order('code')),
      fetchAll(() => tx.from(t.entryView).select('*').gte('month', `${year}-01-01`).lte('month', `${year}-12-01`).order('id')),
      fetchAll(() => tx.from(t.entry).select('id,status,inputs,doc,remark,updated_at,updated_by').gte('month', `${year}-01-01`).lte('month', `${year}-12-01`).order('id'))
    ]);
    const entries = allEntries.filter((e) => (e.part || 'main') === 'main');
    const efById = new Map(efs.map((e) => [e.id, e]));
    const scopeName = new Map(scopes.map((s) => [s.code, s.name]));
    const gwpCh4 = new Map(gwp.map((g) => [g.code, g.ch4]));
    const detailOf = new Map(details.map((d) => [d.id, d]));
    const entriesByAct = new Map();
    for (const e of entries) {
      if (!entriesByAct.has(e.activity_id)) entriesByAct.set(e.activity_id, []);
      entriesByAct.get(e.activity_id).push(e);
    }
    const category = (ef) => `${scopeName.get(ef.scope_code) || ef.scope_code || '-'}${ef.scope_code?.startsWith('1-') && ef.kind ? `(${ef.kind})` : ''}`;
    res.json({
      year,
      due,
      admin: access.admin,
      departments: access.departments,
      septic: Object.fromEntries(Object.entries(settings).filter(([k]) => k.startsWith('septic_'))),
      rows: activities.filter((a) => a.status === 'Active' || entriesByAct.has(a.id)).map((a) => {
        const list = entriesByAct.get(a.id) || [];
        const months = [...new Set(list.map((e) => Number(e.month.slice(5, 7))))];
        const ef = efById.get(a.ef_id) || {};
        return {
          id: a.id, department: a.department, name: a.name, detail: a.detail, calc: a.calc, scope_code: ef.scope_code, category: category(ef), source: ef.name,
          canEdit: a.calc !== 'sap' && (access.admin || access.departments.includes(a.department)), // sap = from the SAP Usage
          unit: a.calc === 'septic' ? 'kg CH₄' : ef.unit, kgco2e: a.calc === 'septic' ? gwpCh4.get(a.gwp_code) : ef.kgco2e,
          byMonth: Object.fromEntries(list.map((e) => [Number(e.month.slice(5, 7)), { qty: e.qty, tco2e: e.tco2e, ...detailOf.get(e.id) }])),
          months: months.sort((x, y) => x - y),
          percent: due ? Math.min(100, Math.round((months.filter((m) => m <= due).length / due) * 100)) : 0,
          qty: Math.round(list.reduce((s, e) => s + Number(e.qty), 0) * 1000) / 1000,
          tco2e: Math.round(list.reduce((s, e) => s + Number(e.tco2e), 0) * 1000) / 1000
        };
      }),
      derived: derivedRows()
    });

    // Lines that are counted but not recorded by hand (ผู้ใช้กำหนด 2026-11-03), for Dashboard > Scope only:
    // 3-3 การได้มาของเชื้อเพลิง / ไฟฟ้า of an activity with ef3_id (same months as the activity). The SAP Usage has its own
    // activities (กลุ่มวัสดุ × costcenter, calc = sap) since 2026-11-04.
    function derivedRows() {
      const pct = (months) => (due ? Math.min(100, Math.round((months.filter((m) => m <= due).length / due) * 100)) : 0);
      const r3 = (v) => Math.round(v * 1000) / 1000;
      const up = new Map();
      for (const e of allEntries.filter((x) => x.part === 'upstream')) {
        if (!up.has(e.activity_id)) up.set(e.activity_id, []);
        up.get(e.activity_id).push(e);
      }
      const upstream = activities.filter((a) => a.ef3_id && (a.status === 'Active' || up.has(a.id))).map((a) => {
        const f = efById.get(a.ef3_id) || {};
        const list = up.get(a.id) || [];
        const months = [...new Set(list.map((e) => Number(e.month.slice(5, 7))))].sort((x, y) => x - y);
        const power = /kwh/i.test(f.unit || '') || a.ef_id && /kwh/i.test(efById.get(a.ef_id)?.unit || '');
        return { id: `up:${a.id}`, derived: 'upstream', department: a.department, name: `${a.name} (การได้มาของ${power ? 'ไฟฟ้า' : 'เชื้อเพลิง'})`, detail: a.detail,
          scope_code: '3-3', category: category({ scope_code: '3-3' }), source: f.name, unit: f.unit, kgco2e: f.kgco2e, months, percent: pct(months),
          qty: r3(list.reduce((s, e) => s + Number(e.qty), 0)), tco2e: r3(list.reduce((s, e) => s + Number(e.tco2e), 0)) };
      });
      return upstream;
    }
  });

  // ---------- transaction: save one activity × month ----------
  route('put', '/api/act/:activity/cfo/entries', async (req, res, activity, t) => {
    const month = monthOf(req.body?.month);
    const activityId = Number(req.body?.activityId);
    if (!month || !activityId) return fail(res, 400, 'เลือกกิจกรรมและเดือน');
    const act = must(await tx.from(t.activity).select('*').eq('id', activityId).maybeSingle());
    if (!act) return fail(res, 404, 'ไม่พบกิจกรรม');
    if (act.calc === 'sap') return fail(res, 400, 'กิจกรรมนี้คิดจาก Usage (SAP) ให้วาง Usage ที่ Setting > Materials (SAP)');
    const access = await accessOf(req, activity, Number(month.slice(0, 4)));
    if (!access.admin && !access.departments.includes(act.department)) return fail(res, 403, `บันทึกได้เฉพาะตัวแทนหน่วยงาน ${act.department} หรือผู้จัดทำ`);
    const current = must(await tx.from(t.entry).select('id,status,doc').eq('activity_id', act.id).eq('month', month).maybeSingle());
    if (current?.status === 'CONFIRMED' && !access.admin) return fail(res, 400, 'เดือนนี้ยืนยันแล้ว แก้ได้เฉพาะผู้จัดทำ');
    let inputs = null;
    let qty = numOrNull(req.body?.qty);
    const calc = CFO_CALCS[act.calc];
    if (calc) {
      inputs = Object.fromEntries(calc.fields.map((k) => [k, Number(req.body?.inputs?.[k])]));
      if (!calc.ok(inputs)) return fail(res, 400, calc.error);
      qty = calc.qty(inputs, act.calc === 'septic' ? await settingsOf(t) : {});
    }
    if (qty == null || Number.isNaN(qty) || qty < 0) return fail(res, 400, 'ปริมาณต้องเป็นตัวเลข 0 ขึ้นไป');
    const linked = must(await tx.from(t.ef).select('id,code,year,kgco2e,status').eq('id', act.ef_id).maybeSingle());
    let ef = linked;
    if (linked?.code) {
      const peers = must(await tx.from(t.ef).select('id,year,kgco2e,status').eq('code', linked.code).eq('status', 'Active'));
      const entryYear = Number(month.slice(0, 4));
      const fit = peers.filter((row) => row.kgco2e != null && (row.year == null || Number(row.year) <= entryYear))
        .sort((a, b) => Number(b.year || 0) - Number(a.year || 0))[0];
      if (fit) ef = fit;
    }
    if (!ef || ef.kgco2e == null) return fail(res, 400, 'EF ของกิจกรรมนี้ยังไม่มีค่า ให้ผู้จัดทำแก้ที่ Setting');
    const quality = req.body?.quality && typeof req.body.quality === 'object' ? {
      activity: ['X', 'Y', 'Z'].includes(req.body.quality.activity) ? req.body.quality.activity : '',
      ef: ['C', 'D', 'E', 'F'].includes(req.body.quality.ef) ? req.body.quality.ef : ''
    } : null;
    if (quality?.activity && quality?.ef) inputs = { ...(inputs || {}), quality };
    let doc = text(req.body?.doc);
    const shot = imageBytes(req.body?.image);
    if (shot) {
      const key = `evidence/${act.id}_${month}_${Date.now()}.jpg`;
      const uploaded = await tx.storage.from(t.bucket).upload(key, new Uint8Array(shot), { contentType: 'image/jpeg', upsert: false });
      if (uploaded.error) return fail(res, 400, /bucket/i.test(String(uploaded.error.message)) ? `ยังไม่ได้สร้างที่เก็บรูป ${t.bucket} ใน Tx Data` : 'อัปโหลดหลักฐานไม่ได้');
      doc = tx.storage.from(t.bucket).getPublicUrl(key).data.publicUrl;
    }
    const row = { qty, inputs, doc, ef_id: ef.id, gwp_code: act.gwp_code, remark: text(req.body?.remark), updated_by: req.user.employeeId, updated_at: new Date().toISOString(),
      ...(act.ef3_id !== undefined ? { ef3_id: act.ef3_id } : {}) }; // ef3_id: column from db/act/cfo.sql 2026-11-01
    if (current) must(await tx.from(t.entry).update(row).eq('id', current.id));
    else must(await tx.from(t.entry).insert({ ...row, activity_id: act.id, month, created_by: req.user.employeeId }));
    if (current?.doc && current.doc !== doc) await dropFiles(tx, t.bucket, current.doc); // the evidence photo was replaced or removed
    res.json({ ok: true, qty });
  });

  route('delete', '/api/act/:activity/cfo/entries/:id', async (req, res, activity, t) => {
    const entry = must(await tx.from(t.entry).select('id,month,status,activity_id,doc').eq('id', Number(req.params.id)).maybeSingle());
    if (!entry) return fail(res, 404, 'ไม่พบรายการ');
    const [actRes, access] = await Promise.all([
      tx.from(t.activity).select('department').eq('id', entry.activity_id).single(),
      accessOf(req, activity, Number(entry.month.slice(0, 4)))
    ]);
    const act = must(actRes);
    if (!access.admin && (entry.status === 'CONFIRMED' || !access.departments.includes(act.department))) return fail(res, 403, 'ลบรายการนี้ไม่ได้');
    must(await tx.from(t.entry).delete().eq('id', entry.id));
    await dropFiles(tx, t.bucket, entry.doc);
    res.json({ ok: true });
  });

  // Admin confirms (or reopens) a whole month.
  route('post', '/api/act/:activity/cfo/confirm', async (req, res, activity, t) => {
    const status = req.body?.status === 'DRAFT' ? 'DRAFT' : 'CONFIRMED';
    const year = !req.body?.month && yearOf(req.body?.year, 0);
    const month = monthOf(req.body?.month);
    if (!month && !year) return fail(res, 400, 'เดือนไม่ถูกต้อง');
    if (!(await requireAdmin(req, res, activity, Number((month || String(year)).slice(0, 4))))) return;
    let query = tx.from(t.entry).update({ status, updated_by: req.user.employeeId, updated_at: new Date().toISOString() }).select('id');
    query = month ? query.eq('month', month) : query.gte('month', `${year}-01-01`).lte('month', `${year}-12-01`);
    const done = must(await query);
    await logRev(t, req, status === 'CONFIRMED' ? 'ยืนยันข้อมูล' : 'เปิดให้แก้', month ? month.slice(0, 7) : `ปี ${year}`, `${status === 'CONFIRMED' ? 'ยืนยัน' : 'เปิดให้แก้'} ${done.length} รายการ`);
    res.json({ ok: true, count: done.length });
  });

  // ---------- Setting: master data (admin of this year edits) ----------
  route('get', '/api/act/:activity/cfo/master', async (req, res, activity, t) => {
    const adminNow = (await accessOf(req, activity, thisYear())).admin;
    await autoFillEf3(t, req, adminNow);
    await autoSyncSap(t, req, adminNow);
    const [scopes, gwp, ef, refs, activities, used, settings, access] = await Promise.all([
      fetchAll(() => tx.from(t.cfoScope).select('*').order('scope').order('code')),
      fetchAll(() => tx.from(t.gwp).select('*').order('code')),
      fetchAll(() => tx.from(t.ef).select('*').order('scope_code').order('id')),
      fetchAll(() => tx.from(t.efRef).select('*').order('sheet').order('sort_no').order('id')),
      fetchAll(() => tx.from(t.activity).select('*').order('department').order('id')),
      fetchAll(() => tx.from(t.entry).select('ef_id,activity_id,gwp_code').order('id')),
      settingsOf(t),
      accessOf(req, activity, thisYear())
    ]);
    const usedEf = new Set(used.map((u) => u.ef_id));
    const usedGwp = new Set([...used, ...activities].map((u) => u.gwp_code));
    const usedAct = new Set(used.map((u) => u.activity_id));
    res.json({
      admin: access.admin || await adminNext(req, activity),
      scopes, settings, refs,
      gwp: gwp.map((g) => ({ ...g, used: usedGwp.has(g.code) })),
      ef: ef.map((e) => ({ ...e, used: usedEf.has(e.id) })),
      activities: activities.map((a) => ({ ...a, used: usedAct.has(a.id) }))
    });
  });

  // EF copies (mt_cfo_ef) are made from the reference tables when an activity is saved (efFromRef): no direct add / edit
  // since the page "EF ที่ใช้คำนวณ" was removed (ผู้ใช้กำหนด 2026-11-01)

  // ---------- Setting > Emission Factor: GWP + reference tables (EF TGO AR5 V2, ผู้ใช้กำหนด 2026-11-01) ----------
  // A GWP set that activities or entries point at keeps its values (v_cfo_entry reads them live): add a new code instead.
  const gwpInput = (b) => {
    const row = { code: text(b.code, 20), reference: text(b.reference, 500), status: b.status === 'Inactive' ? 'Inactive' : 'Active' };
    for (const k of GWP_GASES) row[k] = numOrNull(b[k]) ?? (k === 'co2' ? 1 : 0);
    if (!row.code) return { error: 'ระบุรหัส GWP (เช่น AR5)' };
    if (GWP_GASES.some((k) => Number.isNaN(row[k]) || row[k] < 0)) return { error: 'ค่า GWP ไม่ถูกต้อง' };
    return { row };
  };
  const gwpUsed = async (t, code) => {
    const [u1, u2] = await Promise.all([tx.from(t.activity).select('id').eq('gwp_code', code).limit(1), tx.from(t.entry).select('id').eq('gwp_code', code).limit(1)]);
    return must(u1).length + must(u2).length > 0;
  };
  route('post', '/api/act/:activity/cfo/gwp', async (req, res, activity, t) => {
    if (!(await requireAdminNow(req, res, activity))) return;
    const { row, error } = gwpInput(req.body || {});
    if (error) return fail(res, 400, error);
    if (must(await tx.from(t.gwp).select('code').eq('code', row.code).maybeSingle())) return fail(res, 400, `มี GWP ${row.code} แล้ว`);
    must(await tx.from(t.gwp).insert(row));
    await logRev(t, req, 'GWP', row.code, `เพิ่ม GWP CH₄ ${row.ch4} · N₂O ${row.n2o}`);
    res.status(201).json({ ok: true });
  });
  route('patch', '/api/act/:activity/cfo/gwp/:code', async (req, res, activity, t) => {
    if (!(await requireAdminNow(req, res, activity))) return;
    const current = must(await tx.from(t.gwp).select('*').eq('code', req.params.code).maybeSingle());
    if (!current) return fail(res, 404, 'ไม่พบ GWP');
    const { row, error } = gwpInput({ ...req.body, code: current.code });
    if (error) return fail(res, 400, error);
    if (GWP_GASES.some((k) => Number(row[k]) !== Number(current[k])) && (await gwpUsed(t, current.code))) return fail(res, 400, 'GWP นี้ถูกใช้แล้ว แก้ค่าไม่ได้ ให้เพิ่มรหัสใหม่แล้วปิดตัวเดิม');
    must(await tx.from(t.gwp).update(row).eq('code', current.code));
    await logRev(t, req, 'GWP', current.code, changes(current, row, Object.keys(row)));
    res.json({ ok: true });
  });
  route('delete', '/api/act/:activity/cfo/gwp/:code', async (req, res, activity, t) => {
    if (!(await requireAdminNow(req, res, activity))) return;
    if (await gwpUsed(t, req.params.code)) return fail(res, 400, 'GWP นี้ถูกใช้แล้ว ลบไม่ได้ ให้ตั้งเป็น Inactive');
    const gone = must(await tx.from(t.gwp).delete().eq('code', req.params.code).select('code'));
    if (gone[0]) await logRev(t, req, 'GWP', gone[0].code, 'ลบ GWP');
    res.json({ ok: true });
  });

  // Reference rows are for reading and copying only (nothing is computed from them), so they stay editable.
  // Total left empty with gas values = CO₂ + gas × GWP of the Active set (AR5 first), like the sheet's formula.
  const refInput = async (t, b) => {
    const row = { sheet: REF_SHEETS.includes(b.sheet) ? b.sheet : null, grp: text(b.grp, 120), name: text(b.name, 300), formula: text(b.formula, 300), unit: text(b.unit, 30),
      code: refCode(b.code), item_no: text(String(b.item_no ?? '').replace(/\.$/, ''), 20),
      reference: text(b.reference, 1000), remark: text(b.remark, 1000), status: b.status === 'Inactive' ? 'Inactive' : 'Active' };
    for (const k of REF_NUMBERS) row[k] = numOrNull(b[k]);
    row.sort_no = numOrNull(b.sort_no);
    if (!row.sheet || !row.name) return { error: 'ระบุตารางและชื่อ' };
    if ([...REF_NUMBERS, 'sort_no'].some((k) => Number.isNaN(row[k]))) return { error: 'ค่าตัวเลขไม่ถูกต้อง' };
    if (row.total == null && ['co2', 'ch4_fossil', 'ch4', 'n2o'].some((k) => row[k] != null)) {
      const sets = must(await tx.from(t.gwp).select('*').eq('status', 'Active').order('code'));
      const g = sets.find((x) => x.code === 'AR5') || sets[0] || { ch4_fossil: 0, ch4: 0, n2o: 0 };
      row.total = Number(((row.co2 || 0) + (row.ch4_fossil || 0) * g.ch4_fossil + (row.ch4 || 0) * g.ch4 + (row.n2o || 0) * g.n2o).toPrecision(12));
    }
    return { row };
  };
  const nextCodes = async (t, sheet) => {
    const prefix = REF_PREFIX[sheet];
    if (!prefix) return () => null;
    const used = must(await tx.from(t.efRef).select('code').like('code', `${prefix}-*`));
    let n = Math.max(0, ...used.map((r) => Number(String(r.code).slice(prefix.length + 1)) || 0));
    return () => `${prefix}-${String((n += 1)).padStart(4, '0')}`;
  };
  const codeTaken = async (t, code, id) => code && must(await tx.from(t.efRef).select('id').eq('code', code)).some((r) => r.id !== id);
  route('post', '/api/act/:activity/cfo/ref', async (req, res, activity, t) => {
    if (!(await requireAdminNow(req, res, activity))) return;
    const { row, error } = await refInput(t, req.body || {});
    if (error) return fail(res, 400, error);
    if (await codeTaken(t, row.code)) return fail(res, 400, `id ${row.code} มีอยู่แล้ว`);
    if (!row.code) row.code = (await nextCodes(t, row.sheet))();
    if (row.sort_no == null) {
      const last = must(await tx.from(t.efRef).select('sort_no').eq('sheet', row.sheet).order('sort_no', { ascending: false }).limit(1));
      row.sort_no = (last[0]?.sort_no || 0) + 1;
    }
    must(await tx.from(t.efRef).insert(row));
    res.status(201).json({ ok: true });
  });
  route('patch', '/api/act/:activity/cfo/ref/:id', async (req, res, activity, t) => {
    if (!(await requireAdminNow(req, res, activity))) return;
    const current = must(await tx.from(t.efRef).select('*').eq('id', Number(req.params.id)).maybeSingle());
    if (!current) return fail(res, 404, 'ไม่พบรายการ');
    // a form sends only the columns of its table: the others (item_no, formula ...) stay as they are
    const { row, error } = await refInput(t, { ...current, ...req.body });
    if (error) return fail(res, 400, error);
    if (row.sort_no == null) row.sort_no = current.sort_no;
    if (await codeTaken(t, row.code, current.id)) return fail(res, 400, `id ${row.code} มีอยู่แล้ว`);
    if (!row.code) delete row.code;
    must(await tx.from(t.efRef).update(row).eq('id', current.id));
    // the Usage (SAP) of the groups on this EF follows a new value at once, not at some later sync
    if (Number(row.total) !== Number(current.total) || row.unit !== current.unit) {
      const groups = (await tx.from(t.matGroup).select('id').eq('ef_ref_id', current.id)).data || [];
      if (groups.length) await resyncSap(t, req, (await fetchIn(() => tx.from(t.material).select('material'), 'group_id', groups.map((g) => g.id))).map((m) => m.material));
    }
    res.json({ ok: true });
  });
  // Import a reference table from Excel / CSV (ผู้ใช้กำหนด 2026-11-02): a row with id of this table = update, without id = add.
  // Every row is checked first; nothing is saved when one fails (the reply names the row numbers of the file).
  route('post', '/api/act/:activity/cfo/ref/import', async (req, res, activity, t) => {
    if (!(await requireAdminNow(req, res, activity))) return;
    const sheet = REF_SHEETS.includes(req.body?.sheet) ? req.body.sheet : null;
    const list = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 5000) : [];
    if (!sheet) return fail(res, 400, 'เลือกตาราง');
    if (!list.length) return fail(res, 400, 'ไฟล์ไม่มีข้อมูล');
    const all = await fetchAll(() => tx.from(t.efRef).select('*'));
    const have = new Map(all.filter((r) => r.sheet === sheet).map((r) => [r.id, r]));
    const byCode = new Map(all.filter((r) => r.code).map((r) => [r.code, r]));
    let next = Math.max(0, ...[...have.values()].map((r) => r.sort_no || 0));
    const newCode = await nextCodes(t, sheet);
    const adds = [];
    const updates = [];
    const errors = [];
    const seen = new Set();
    let group = null;
    for (const [i, b] of list.entries()) {
      const line = b.line || i + 2;
      group = String(b.grp ?? '').trim() || group; // the TGO file merges กลุ่ม over its rows
      // a row that updates keeps the columns the file does not have
      const known = (refCode(b.code) && byCode.get(refCode(b.code))) || (!refCode(b.code) && Number(b.id) && have.get(Number(b.id))) || null;
      const { row, error } = await refInput(t, { ...(known?.sheet === sheet ? known : {}), ...b, grp: group || known?.grp, sheet, ...(sheet === 'ipcc' && !b.unit ? { unit: 'TJ' } : {}) });
      if (error) { errors.push(`แถว ${line}: ${error}`); continue; }
      if (row.code && seen.has(row.code)) { errors.push(`แถว ${line}: id ${row.code} ซ้ำในไฟล์`); continue; }
      if (row.code) seen.add(row.code);
      const old = (row.code && byCode.get(row.code)) || (!row.code && Number(b.id) && have.get(Number(b.id))) || null;
      if (old && old.sheet !== sheet) { errors.push(`แถว ${line}: id ${row.code} เป็นของตารางอื่น`); continue; }
      if (old) updates.push({ id: old.id, row: { ...row, code: row.code || old.code, sort_no: row.sort_no ?? old.sort_no } });
      else adds.push({ ...row, code: row.code || newCode(), sort_no: row.sort_no ?? (next += 1) });
    }
    if (errors.length) return fail(res, 400, `ไม่ได้บันทึก มี ${errors.length} แถวที่ผิด: ${errors.slice(0, 5).join(' · ')}${errors.length > 5 ? ' …' : ''}`);
    if (req.body?.save !== true) return res.json({ ok: true, saved: false, add: adds.length, update: updates.length });
    for (let i = 0; i < adds.length; i += 500) must(await tx.from(t.efRef).insert(adds.slice(i, i + 500)));
    for (const u of updates) must(await tx.from(t.efRef).update(u.row).eq('id', u.id));
    await logRev(t, req, 'Emission Factor', `นำเข้า ${sheet}`, `เพิ่ม ${adds.length} · แก้ ${updates.length} รายการ`);
    res.json({ ok: true, saved: true, add: adds.length, update: updates.length });
  });
  route('delete', '/api/act/:activity/cfo/ref/:id', async (req, res, activity, t) => {
    if (!(await requireAdminNow(req, res, activity))) return;
    const id = Number(req.params.id);
    const current = must(await tx.from(t.efRef).select('id,code,name').eq('id', id).maybeSingle());
    if (!current) return fail(res, 404, 'ไม่พบรายการ');
    // the Usage (SAP) is worked out from this row: without it every month of the group would drop out of Scope 3
    const groups = (await tx.from(t.matGroup).select('name').eq('ef_ref_id', id).limit(3)).data || [];
    if (groups.length) return fail(res, 400, `กลุ่มวัสดุใช้ EF นี้อยู่ (${groups.map((g) => g.name).join(', ')}) ลบไม่ได้ ให้ตั้งเป็น Inactive`);
    must(await tx.from(t.efRef).delete().eq('id', id));
    await logRev(t, req, 'Emission Factor', current.code || current.name, 'ลบรายการ');
    res.json({ ok: true });
  });

  // ---------- Setting > วัสดุ (SAP): Store usage → Scope 3 (ผู้ใช้กำหนด 2026-11-01) ----------
  // A material is counted once it has an EF (reference table row) and a factor (1 SAP unit = factor EF units).
  const matCode = (v) => String(v ?? '').trim().replace(/^0+(?=\d)/, '').slice(0, 40) || null;
  const MAT_SHEETS = ['cfp', 'energy', 'chemical'];
  // usage = ของใช้สิ้นเปลือง (Store) · raw = วัตถุดิบ · other = อื่นๆ (ผู้ใช้กำหนด 2026-11-02)
  const MAT_KINDS = { usage: 'Usage', raw: 'วัตถุดิบ', other: 'อื่นๆ' };
  // กลุ่มวัสดุ (ผู้ใช้กำหนด 2026-11-04): 1 กลุ่ม = 1 EF (EF ไม่เท่ากันแยกกลุ่ม) · วัสดุหลายรุ่นอยู่กลุ่มเดียวกัน · กิจกรรม = กลุ่ม × costcenter
  // (calc = sap) ที่ syncSap สร้างให้และเติมปริมาณรายเดือน · columns from db/act/cfo.sql 2026-11-04
  const sapReady = async (t) => !(await tx.from(t.matGroup).select('id').limit(1)).error;
  const unitKey = (u) => String(u || '').trim().toUpperCase();
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  // why a Usage line is not counted (null = counted): material → group → EF of the group + factor + same SAP unit.
  // cal_ef (ผู้ใช้กำหนด 2026-11-09): a material with its own kgCO₂e per SAP unit (kgco2e_unit) counts as Qty × kgco2e_unit,
  // whatever EF the group has; its ef_ref_id is then the Ref (ที่มาของค่า in EF CFP), not the group's EF.
  const directOf = (m) => (Number(m?.kgco2e_unit) > 0 ? Number(m.kgco2e_unit) : 0);
  const sapWhy = (l, m, g, e) => {
    if (!m) return 'nomat';
    if (!g) return 'nogroup';
    if (g.status === 'Inactive') return 'noef';
    if (!directOf(m)) {
      if (!e || e.total == null) return 'noef';
      if (!(Number(m.factor) > 0)) return 'nofactor';
    }
    if (m.status === 'Inactive') return 'nofactor';
    if (l.unit && m.sap_unit && unitKey(l.unit) !== unitKey(m.sap_unit)) return 'unit';
    return null;
  };
  // kgCO₂e of one Usage line
  const lineKg = (l, m, e) => (directOf(m) ? Number(l.qty) * directOf(m) : Number(l.qty) * Number(m.factor) * Number(e.total));
  // the EF of an activity whose quantity is already kgCO₂e (its lines carry their own kgCO₂e per unit)
  const efKg = async (t, scopeCode) => {
    const code = `sapkg:${scopeCode}`;
    const found = must(await tx.from(t.ef).select('id').eq('code', code).maybeSingle());
    if (found) return { id: found.id };
    const made = must(await tx.from(t.ef).insert({ code, scope_code: scopeCode, name: 'รวม kgCO₂e ของวัสดุ (Qty SAP × kgCO₂e/หน่วย)', unit: 'kgCO2e', kgco2e: 1,
      reference: 'Setting > Materials (SAP): kgCO₂e/หน่วย และ Ref ของแต่ละวัสดุ', year: thisYear(), status: 'Active' }).select('id'));
    return { id: made[0].id };
  };
  const sapMaster = async (t) => {
    const [mats, groups, refs, centers] = await Promise.all([
      fetchAll(() => tx.from(t.material).select('*')),
      fetchAll(() => tx.from(t.matGroup).select('*')),
      fetchAll(() => tx.from(t.efRef).select('id,name,unit,total').in('sheet', MAT_SHEETS)),
      fetchAll(() => mx.from('mt_main_costcenter').select('costcenter,object_name,department')).catch(() => [])
    ]);
    return { mat: new Map(mats.map((m) => [m.material, m])), group: new Map(groups.map((g) => [g.id, g])), ref: new Map(refs.map((r) => [r.id, r])),
      center: new Map(centers.map((c) => [String(c.costcenter).trim().toUpperCase(), c])) };
  };
  // Work a month out again from the master of now and replace it: its Usage lines (given, or the ones saved) and the
  // months of the SAP activities. A material grouped later, or a group given another EF, counts for the months already pasted.
  // One at a time (two admins opening a page must not double the lines): the process is the only writer.
  let sapQueue = Promise.resolve();
  const syncSap = (t, req, months, given = null) => {
    const run = () => syncSapNow(t, req, months, given);
    const job = sapQueue.then(run, run);
    sapQueue = job.catch(() => null);
    return job;
  };
  const syncSapNow = async (t, req, months, given) => {
    const master = await sapMaster(t);
    const acts = await fetchAll(() => tx.from(t.activity).select('*').not('mat_group_id', 'is', null));
    const actOf = new Map(acts.map((a) => [`${a.mat_group_id}|${a.costcenter}`, a]));
    const efOf = new Map();
    let total = 0;
    for (const month of months) {
      const lines = given || await fetchAll(() => tx.from(t.materialUse).select('*').eq('month', month).order('id'));
      const out = [];
      const sums = new Map();
      const keys = new Map(); // group × costcenter → { g, cc, department, detail, direct, rows: [[row, efQty, kg]] }
      for (const l of lines) {
        const m = master.mat.get(l.material);
        const g = m?.group_id ? master.group.get(m.group_id) : null;
        const e = g?.ef_ref_id ? master.ref.get(g.ef_ref_id) : null;
        const { id, ...row } = l;
        Object.assign(row, { month, grp: g?.name ?? null, group_id: 0, activity_id: null, factor: 0, ef_ref_id: null, source: '', ef_unit: null, kgco2e: 0, tco2e: 0, name: m?.name || l.name });
        out.push(row);
        if (sapWhy(l, m, g, e)) continue;
        const cc = l.costcenter || l.department || '(ไม่ระบุ)';
        const c = master.center.get(unitKey(cc));
        const department = c?.department || l.department || cc;
        const key = `${g.id}|${cc}`;
        const k = keys.get(key) || { g, cc, department, detail: `${department} : ${cc}${c?.object_name ? ` ${c.object_name}` : ''}`.slice(0, 500), direct: false, rows: [] };
        keys.set(key, k);
        const kg = lineKg(l, m, e);
        if (directOf(m)) {
          const ref = m.ef_ref_id ? master.ref.get(m.ef_ref_id) : null;
          Object.assign(row, { department, group_id: g.id, factor: 1, ef_ref_id: ref?.id ?? null, source: ref ? ref.name.replace(/^-\s*/, '') : 'kgCO₂e/หน่วย (cal_ef)',
            ef_unit: m.sap_unit || l.unit || null, kgco2e: directOf(m), scope_code: g.scope_code, kind: g.kind, tco2e: r6(kg / 1000) });
          k.direct = true;
          k.rows.push([row, 0, kg]);
        } else {
          Object.assign(row, { department, group_id: g.id, factor: Number(m.factor), ef_ref_id: e.id, source: e.name.replace(/^-\s*/, ''), ef_unit: e.unit,
            kgco2e: Number(e.total), scope_code: g.scope_code, kind: g.kind, tco2e: r6(kg / 1000) });
          k.rows.push([row, Number(l.qty) * Number(m.factor), kg]);
        }
      }
      for (const [key, k] of keys) {
        const ef = k.direct ? await efKg(t, k.g.scope_code) : null;
        if (!k.direct && !efOf.has(k.g.id)) efOf.set(k.g.id, (await efFromRef(t, k.g.ef_ref_id, k.g.scope_code)).id || null);
        const efId = k.direct ? ef.id : efOf.get(k.g.id);
        if (!efId) { k.rows.forEach(([row]) => Object.assign(row, { group_id: 0, tco2e: 0 })); continue; }
        const want = { name: k.g.name, department: k.department, detail: k.detail, ef_id: efId };
        let a = actOf.get(key);
        if (!a) {
          a = must(await tx.from(t.activity).insert({ ...want, gwp_code: 'AR5', calc: 'sap', status: 'Active', mat_group_id: k.g.id, costcenter: k.cc }).select('*'))[0];
          actOf.set(key, a);
          acts.push(a);
        } else if (['name', 'department', 'detail', 'ef_id'].some((x) => a[x] !== want[x])) {
          must(await tx.from(t.activity).update(want).eq('id', a.id));
          Object.assign(a, want);
        }
        // quantity of the month: kgCO₂e (cal_ef, EF = 1) or the units of the group's EF
        for (const [row, efQty, kg] of k.rows) {
          row.activity_id = a.id;
          sums.set(a.id, (sums.get(a.id) || 0) + (k.direct ? kg : efQty));
          total += row.tco2e;
        }
      }
      // a month confirmed before stays confirmed
      const ids = acts.map((a) => a.id);
      const old = ids.length ? await fetchIn(() => tx.from(t.entry).select('id,status,activity_id').eq('month', month), 'activity_id', ids) : [];
      const status = old.some((x) => x.status === 'CONFIRMED') ? 'CONFIRMED' : 'DRAFT';
      const byId = new Map(acts.map((a) => [a.id, a]));
      const entries = [...sums].map(([id, qty]) => ({ activity_id: id, month, qty: r6(qty), ef_id: byId.get(id).ef_id, gwp_code: byId.get(id).gwp_code, status, remark: 'Usage (SAP)',
        created_by: req.user.employeeId, updated_by: req.user.employeeId }));
      // new rows first, the old ones go last: a failure on the way leaves the month as it was
      const oldLines = (await fetchAll(() => tx.from(t.materialUse).select('id').eq('month', month).order('id'))).map((l) => l.id);
      const fresh = [];
      try {
        for (let i = 0; i < out.length; i += 500) fresh.push(...must(await tx.from(t.materialUse).insert(out.slice(i, i + 500)).select('id')).map((l) => l.id));
        for (let i = 0; i < entries.length; i += 500) must(await tx.from(t.entry).upsert(entries.slice(i, i + 500), { onConflict: 'activity_id,month' }));
      } catch (err) {
        for (let i = 0; i < fresh.length; i += 200) await tx.from(t.materialUse).delete().in('id', fresh.slice(i, i + 200));
        throw err;
      }
      const gone = old.filter((x) => !sums.has(x.activity_id)).map((x) => x.id);
      for (let i = 0; i < gone.length; i += 200) must(await tx.from(t.entry).delete().in('id', gone.slice(i, i + 200)));
      for (let i = 0; i < oldLines.length; i += 200) must(await tx.from(t.materialUse).delete().in('id', oldLines.slice(i, i + 200)));
    }
    return { tco2e: Math.round(total * 1000) / 1000 };
  };
  // months whose Usage has the materials given (after a material or group changed) · months never worked out by group
  const sapMonthsOf = async (t, codes) => [...new Set((await fetchIn(() => tx.from(t.materialUse).select('month'), 'material', codes)).map((r) => r.month))].sort();
  const resyncSap = async (t, req, codes) => {
    const months = codes.length ? await sapMonthsOf(t, codes) : [];
    if (months.length) await syncSap(t, req, months);
  };
  // the Usage pasted before groups (db/act/cfo.sql 2026-11-04) is counted through the SAP activities when an admin opens a page
  const autoSyncSap = async (t, req, admin) => {
    if (!admin || !(await sapReady(t))) return;
    const left = (await tx.from(t.materialUse).select('month').is('group_id', null).limit(1000)).data || [];
    const months = [...new Set(left.map((r) => r.month))].sort();
    if (months.length) await syncSap(t, req, months).catch((err) => console.error('autoSyncSap failed', err?.message || err)); // the page still opens
  };

  route('get', '/api/act/:activity/cfo/materials', async (req, res, activity, t) => {
    const access = await accessOf(req, activity, thisYear());
    await autoSyncSap(t, req, access.admin);
    const [rows, uses, sections, groups] = await Promise.all([
      fetchAll(() => tx.from(t.material).select('*').order('material')),
      fetchAll(() => tx.from(t.materialUse).select('month,tco2e').order('month')),
      usageBySection(t, yearOf(req.query.year) || thisYear()),
      fetchAll(() => tx.from(t.matGroup).select('*').order('name')).catch(() => [])
    ]);
    const months = Object.values(uses.reduce((acc, u) => {
      const m = (acc[u.month] = acc[u.month] || { month: u.month, rows: 0, tco2e: 0 });
      m.rows += 1;
      m.tco2e += Number(u.tco2e);
      return acc;
    }, {})).map((m) => ({ ...m, tco2e: Math.round(m.tco2e * 1000) / 1000 }));
    const count = (id, ok) => rows.filter((r) => r.group_id === id && (!ok || Number(r.factor) > 0 || directOf(r))).length;
    res.json({ admin: access.admin || await adminNext(req, activity), ready: groups.length > 0 || (await sapReady(t)), rows, months, sections,
      groups: groups.map((g) => ({ ...g, items: count(g.id), counted: count(g.id, true) })) });
  });

  // ---------- กลุ่มวัสดุ ----------
  // EF = id (CFP-0001) or the name in EF CFP / EF พลังงาน / GWP สารเคมี · a group used by SAP activities keeps its id
  const refOfName = async (t, value, refs = null) => {
    const want = String(value || '').trim().toLowerCase();
    if (!want) return { id: null };
    const list = refs || must(await tx.from(t.efRef).select('id,code,name,sheet,unit,total').in('sheet', MAT_SHEETS));
    const hit = list.find((r) => String(r.code || '').toLowerCase() === want && r.unit && r.total != null)
      || list.find((r) => r.name.replace(/^-\s*/, '').trim().toLowerCase() === want && r.unit && r.total != null);
    return hit ? { id: hit.id } : { error: `ไม่พบ EF id หรือชื่อ "${value}" ในตาราง EF CFP / EF พลังงาน` };
  };
  const groupInput = async (t, b) => {
    const row = { name: text(b.name, 120), scope_code: text(b.scope_code, 10) || '3-1', kind: MAT_KINDS[b.kind] ? b.kind : 'usage', remark: text(b.remark, 500),
      status: b.status === 'Inactive' ? 'Inactive' : 'Active' };
    if (!row.name) return { error: 'ระบุชื่อกลุ่ม' };
    if (!/^3-\d{1,2}$/.test(row.scope_code)) return { error: 'หมวดของกลุ่มต้องเป็น Scope 3 (3-1 … 3-15)' };
    if (b.ef_name !== undefined && String(b.ef_name).trim()) {
      const found = await refOfName(t, b.ef_name);
      if (found.error) return found;
      row.ef_ref_id = found.id;
    } else row.ef_ref_id = Number(String(b.ef_ref_id ?? '').replace('ref:', '')) || null;
    return { row };
  };
  route('post', '/api/act/:activity/cfo/mat-groups', async (req, res, activity, t) => {
    if (!(await requireAdminNow(req, res, activity))) return;
    if (!(await sapReady(t))) return fail(res, 400, 'ให้รัน db/act/cfo.sql ก่อน (ตารางกลุ่มวัสดุ)');
    const { row, error } = await groupInput(t, req.body || {});
    if (error) return fail(res, 400, error);
    if (must(await tx.from(t.matGroup).select('id').eq('name', row.name).limit(1)).length) return fail(res, 400, `มีกลุ่ม "${row.name}" แล้ว`);
    must(await tx.from(t.matGroup).insert(row));
    await logRev(t, req, 'กลุ่มวัสดุ', row.name, 'เพิ่มกลุ่ม');
    res.status(201).json({ ok: true });
  });
  route('patch', '/api/act/:activity/cfo/mat-groups/:id', async (req, res, activity, t) => {
    if (!(await requireAdminNow(req, res, activity))) return;
    const current = must(await tx.from(t.matGroup).select('*').eq('id', Number(req.params.id)).maybeSingle());
    if (!current) return fail(res, 404, 'ไม่พบกลุ่ม');
    const { row, error } = await groupInput(t, { ...current, ...req.body });
    if (error) return fail(res, 400, error);
    if (row.name !== current.name && must(await tx.from(t.matGroup).select('id').eq('name', row.name).limit(1)).length) return fail(res, 400, `มีกลุ่ม "${row.name}" แล้ว`);
    must(await tx.from(t.matGroup).update(row).eq('id', current.id));
    const codes = must(await tx.from(t.material).select('material').eq('group_id', current.id)).map((m) => m.material);
    if (codes.length) {
      must(await tx.from(t.material).update({ grp: row.name, scope_code: row.scope_code, kind: row.kind }).eq('group_id', current.id));
      const plain = await tx.from(t.material).update({ ef_ref_id: row.ef_ref_id }).eq('group_id', current.id).is('kgco2e_unit', null);
      if (plain.error) must(await tx.from(t.material).update({ ef_ref_id: row.ef_ref_id }).eq('group_id', current.id)); // before db/act/cfo.sql 2026-11-09
    }
    if (row.status === 'Inactive') must(await tx.from(t.activity).update({ status: 'Inactive' }).eq('mat_group_id', current.id));
    await resyncSap(t, req, codes);
    await logRev(t, req, 'กลุ่มวัสดุ', current.name, changes(current, row, Object.keys(row)));
    res.json({ ok: true });
  });
  route('delete', '/api/act/:activity/cfo/mat-groups/:id', async (req, res, activity, t) => {
    if (!(await requireAdminNow(req, res, activity))) return;
    const id = Number(req.params.id);
    const [used, acts] = await Promise.all([tx.from(t.material).select('material').eq('group_id', id).limit(1), tx.from(t.activity).select('id').eq('mat_group_id', id).limit(1)]);
    if (must(used).length || must(acts).length) return fail(res, 400, 'กลุ่มนี้มีวัสดุหรือกิจกรรมแล้ว ลบไม่ได้ ให้ตั้งเป็น Inactive');
    must(await tx.from(t.matGroup).delete().eq('id', id));
    res.json({ ok: true });
  });

  // partial (grid paste): a blank cell keeps what the material already has · the group decides EF, Scope and ประเภท
  const matInput = (b, groups, partial = false, refs = null) => {
    const given = (k) => b[k] !== undefined && !(partial && String(b[k] ?? '').trim() === '');
    const row = { material: matCode(b.material) };
    if (!row.material) return { error: 'ระบุรหัสวัสดุ' };
    if (given('name')) row.name = text(b.name, 300);
    if (given('sap_unit')) row.sap_unit = text(b.sap_unit, 20);
    if (given('status')) row.status = b.status === 'Inactive' ? 'Inactive' : 'Active';
    if (given('group_id') || given('group')) {
      const want = String(b.group ?? '').trim().toLowerCase();
      const g = b.group_id !== undefined && String(b.group_id).trim() !== '' ? groups.get(Number(b.group_id)) : [...groups.values()].find((x) => x.name.toLowerCase() === want);
      if (!g && (want || String(b.group_id ?? '').trim())) return { error: `ไม่พบกลุ่ม "${b.group ?? b.group_id}" (เพิ่มกลุ่มก่อน)` };
      Object.assign(row, g ? { group_id: g.id, grp: g.name, ef_ref_id: g.ef_ref_id, scope_code: g.scope_code, kind: g.kind } : { group_id: null, grp: null, ef_ref_id: null });
    }
    if (given('factor')) {
      row.factor = numOrNull(b.factor);
      if (Number.isNaN(row.factor) || (row.factor != null && row.factor <= 0)) return { error: 'ตัวแปลงต้องเป็นตัวเลขมากกว่า 0' };
    }
    // cal_ef (ผู้ใช้กำหนด 2026-11-09): kgCO₂e per SAP unit used as is · Ref = EF CFP id where the value comes from
    if (given('kgco2e_unit')) {
      row.kgco2e_unit = numOrNull(b.kgco2e_unit);
      if (Number.isNaN(row.kgco2e_unit) || (row.kgco2e_unit != null && row.kgco2e_unit <= 0)) return { error: 'kgCO₂e/หน่วย ต้องเป็นตัวเลขมากกว่า 0' };
    }
    if (given('ref')) {
      const code = String(b.ref ?? '').trim().toUpperCase();
      const ref = code ? refs?.get(code) : null;
      if (code && !ref) return { error: `ไม่พบ Ref ${code} ในตาราง EF (เพิ่ม EF CFP ก่อน)` };
      row.ef_ref_id = ref ? ref.id : null;
    }
    return { row };
  };
  const groupMap = async (t) => new Map((await fetchAll(() => tx.from(t.matGroup).select('*')).catch(() => [])).map((g) => [g.id, g]));
  // Add or update many at once (grid paste): material · group · name · SAP unit · factor
  route('post', '/api/act/:activity/cfo/materials', async (req, res, activity, t) => {
    if (!(await requireAdminNow(req, res, activity))) return;
    if (!(await sapReady(t))) return fail(res, 400, 'ให้รัน db/act/cfo.sql ก่อน (ตารางกลุ่มวัสดุ)');
    const list = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 5000) : [req.body || {}];
    const direct = list.some((b) => String(b.kgco2e_unit ?? '').trim() !== '' || String(b.ref ?? '').trim() !== '');
    if (direct && (await tx.from(t.material).select('kgco2e_unit').limit(1)).error) return fail(res, 400, 'ให้รัน db/act/cfo.sql อีกครั้งก่อน (คอลัมน์ kgCO₂e/หน่วย ของวัสดุ)');
    const [groups, existingList, refList] = await Promise.all([groupMap(t), fetchIn(() => tx.from(t.material).select('*'), 'material', list.map((b) => matCode(b.material))),
      direct ? fetchAll(() => tx.from(t.efRef).select('id,code,name,unit,total').in('sheet', MAT_SHEETS)) : []]);
    const refs = new Map(refList.filter((r) => r.code).map((r) => [String(r.code).toUpperCase(), r]));
    // cal_ef (makeGroups): a group named in the file and not there yet is made (no EF: its materials count by kgCO₂e/หน่วย)
    const wantGroups = req.body?.makeGroups ? [...new Set(list.map((b) => String(b.group ?? '').trim()).filter(Boolean))]
      .filter((name) => ![...groups.values()].some((g) => g.name.toLowerCase() === name.toLowerCase())) : [];
    wantGroups.forEach((name, i) => groups.set(-1 - i, { id: -1 - i, name, scope_code: '3-1', kind: 'usage', status: 'Active' })); // made after the check
    const existing = new Map(existingList.map((r) => [r.material, r]));
    const toInsert = [];
    const toUpdate = [];
    const errors = [];
    const odd = []; // kgCO₂e/หน่วย far from the Ref EF on a weight / volume unit (kg, L): 1 unit should be about 1 × EF
    for (const [i, b] of list.entries()) {
      const { row, error } = matInput(b, groups, true, refs);
      if (error) { errors.push(list.length > 1 ? `แถว ${b.line || i + 1}: ${error}` : error); continue; }
      const ref = row.ef_ref_id ? refList.find((r) => r.id === row.ef_ref_id) : null;
      const unit = String(row.sap_unit || existing.get(row.material)?.sap_unit || '').toUpperCase();
      const sameUnit = ref && String(ref.unit || '').toUpperCase() === unit;
      if (row.kgco2e_unit && ['KG', 'L'].includes(unit) && (sameUnit ? Math.abs(row.kgco2e_unit / Number(ref.total) - 1) > 0.5 : row.kgco2e_unit > 50)) {
        odd.push({ material: row.material, name: row.name || existing.get(row.material)?.name || '', unit, value: row.kgco2e_unit, ref: ref?.code || '', ef: ref ? Number(ref.total) : null, efUnit: ref?.unit || '' });
      }
      if (existing.has(row.material)) toUpdate.push(row);
      else {
        existing.set(row.material, row);
        toInsert.push({ name: row.material, ...row });
      }
    }
    if (errors.length) return fail(res, 400, list.length > 1 ? `ไม่ได้บันทึก มี ${errors.length} แถวที่ผิด: ${errors.slice(0, 5).join(' · ')}${errors.length > 5 ? ' …' : ''}` : errors[0]);
    if (req.body?.save === false) return res.json({ ok: true, saved: false, count: list.length, add: toInsert.length, update: toUpdate.length, newGroups: wantGroups, odd });
    if (wantGroups.length) {
      const made = must(await tx.from(t.matGroup).insert(wantGroups.map((name) => ({ name: name.slice(0, 120), scope_code: '3-1', kind: 'usage', status: 'Active' }))).select('id,name'));
      const real = new Map(wantGroups.map((name, i) => [-1 - i, made.find((g) => g.name === name.slice(0, 120))?.id]));
      [...toInsert, ...toUpdate].forEach((row) => { if (row.group_id < 0) row.group_id = real.get(row.group_id); });
    }
    await Promise.all([
      toInsert.length ? tx.from(t.material).insert(toInsert).then(must) : null,
      ...toUpdate.map((row) => tx.from(t.material).update(row).eq('material', row.material).then(must))
    ]);
    await resyncSap(t, req, [...toInsert, ...toUpdate].map((r) => r.material));
    await logRev(t, req, 'วัสดุ (SAP)', list.length === 1 ? matCode(list[0].material) : `${list.length} รายการ`, 'เพิ่ม / แก้วัสดุและกลุ่ม');
    res.status(201).json({ ok: true, count: list.length });
  });
  route('patch', '/api/act/:activity/cfo/materials/:material', async (req, res, activity, t) => {
    if (!(await requireAdminNow(req, res, activity))) return;
    const current = must(await tx.from(t.material).select('*').eq('material', req.params.material).maybeSingle());
    if (!current) return fail(res, 404, 'ไม่พบวัสดุ');
    const refs = req.body?.ref !== undefined ? new Map((await fetchAll(() => tx.from(t.efRef).select('id,code').in('sheet', MAT_SHEETS))).filter((r) => r.code).map((r) => [String(r.code).toUpperCase(), r])) : null;
    const { row, error } = matInput({ ...req.body, material: current.material }, await groupMap(t), false, refs);
    if (error) return fail(res, 400, error);
    if (!row.name) row.name = current.name;
    must(await tx.from(t.material).update(row).eq('material', current.material));
    await resyncSap(t, req, [current.material]);
    await logRev(t, req, 'วัสดุ (SAP)', current.material, changes(current, row, Object.keys(row)));
    res.json({ ok: true });
  });
  route('delete', '/api/act/:activity/cfo/materials/:material', async (req, res, activity, t) => {
    if (!(await requireAdminNow(req, res, activity))) return;
    if (must(await tx.from(t.materialUse).select('id').eq('material', req.params.material).limit(1)).length) return fail(res, 400, 'วัสดุนี้มี Usage แล้ว ลบไม่ได้ ให้ตั้งเป็น Inactive');
    must(await tx.from(t.material).delete().eq('material', req.params.material));
    res.json({ ok: true });
  });

  // Usage of one month from SAP (the GI export 7xxxxx: Material · Material Description · Cost Ctr · Qty · EUn · Amount LC, or the
  // Usage sheet): rows [{ material, name, qty, unit, department = costcenter, amount }] · qty of the issue (the client turns the
  // SAP minus into plus; a return is minus) and lines are netted per costcenter × material × unit.
  // save = false only checks. save = true replaces the month: every line is kept (also the ones not counted yet, for the money
  // report and to count later), a material not in the list is added (to be grouped), then syncSap makes the month.
  route('post', '/api/act/:activity/cfo/material-usage', async (req, res, activity, t) => {
    if (!(await requireAdminNow(req, res, activity))) return;
    if (!(await sapReady(t))) return fail(res, 400, 'ให้รัน db/act/cfo.sql ก่อน (ตารางกลุ่มวัสดุ)');
    const month = monthOf(req.body?.month);
    const input = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!month) return fail(res, 400, 'เลือกเดือน');
    if (!input.length) return fail(res, 400, 'ยังไม่มีข้อมูล Usage');
    const master = await sapMaster(t);
    const lines = new Map();
    for (const r of input) {
      const code = matCode(r.material);
      const qty = Number(String(r.qty ?? '').replace(/,/g, ''));
      if (!code || !Number.isFinite(qty)) continue;
      const raw = text(r.department, 80);
      const c = raw ? master.center.get(unitKey(raw)) : null;
      // money: the SAP column (บาท) when given, else qty × price of the row
      const amount = Number(String(r.amount ?? '').replace(/,/g, ''));
      const price = Number(String(r.price ?? '').replace(/,/g, ''));
      const key = `${raw}|${code}|${unitKey(r.unit)}`;
      const line = lines.get(key) || { month, department: c?.department || raw, costcenter: raw, material: code, name: text(r.name, 300), unit: text(r.unit, 20), qty: 0, amount: 0, priced: false };
      line.qty += qty;
      if (String(r.amount ?? '').trim() !== '' && Number.isFinite(amount)) { line.amount += amount; line.priced = true; }
      else if (Number.isFinite(price) && String(r.price ?? '').trim() !== '') { line.amount += qty * price; line.priced = true; }
      lines.set(key, line);
    }
    const kept = [...lines.values()].filter((l) => l.qty > 0);
    const skipped = lines.size - kept.length;
    const groups = { nomat: [], nogroup: [], noef: [], nofactor: [], unit: [] };
    const acts = new Set();
    let tco2e = 0;
    let counted = 0;
    for (const l of kept) {
      const m = master.mat.get(l.material);
      const g = m?.group_id ? master.group.get(m.group_id) : null;
      const e = g?.ef_ref_id ? master.ref.get(g.ef_ref_id) : null;
      const why = sapWhy(l, m, g, e);
      if (why) { groups[why].push({ ...l, name: m?.name || l.name, sap_unit: m?.sap_unit, group: g?.name }); continue; }
      counted += 1;
      acts.add(`${g.id}|${l.costcenter}`);
      tco2e += lineKg(l, m, e) / 1000;
    }
    tco2e = Math.round(tco2e * 1000) / 1000;
    if (req.body?.save === true) {
      const fresh = kept.filter((l) => !master.mat.has(l.material));
      for (let i = 0; i < fresh.length; i += 500) {
        must(await tx.from(t.material).upsert(fresh.slice(i, i + 500).map((l) => ({ material: l.material, name: l.name || l.material, sap_unit: l.unit, scope_code: '3-1', kind: 'usage', status: 'Active' })),
          { onConflict: 'material', ignoreDuplicates: true }));
      }
      const rows = kept.map(({ priced, amount, ...l }) => {
        const m = master.mat.get(l.material);
        const money = priced ? amount : m?.price != null ? l.qty * Number(m.price) : null;
        return { ...l, qty: r6(l.qty), amount: money == null ? null : Math.round(money * 100) / 100, scope_code: '3-1', kind: 'usage', factor: 0, source: '', kgco2e: 0, tco2e: 0,
          uploaded_by: req.user.employeeId };
      });
      await syncSap(t, req, [month], rows);
      await logRev(t, req, 'Usage วัสดุ (SAP)', month.slice(0, 7), `วาง Usage ${input.length} บรรทัด คิดได้ ${counted} รายการ ${tco2e} tCO2e · กิจกรรม ${acts.size}`);
    }
    const top = (list) => ({ count: list.length, top: list.sort((x, y) => y.qty - x.qty).slice(0, 300) });
    res.json({ ok: true, saved: req.body?.save === true, month, lines: lines.size, skipped, counted, tco2e, activities: acts.size,
      unknown: top(groups.nomat), noGroup: top(groups.nogroup), noEf: top([...groups.noef, ...groups.nofactor]), unitWrong: top(groups.unit) });
  });
  // Dashboard > Usage (SAP) (ผู้ใช้กำหนด 2026-11-02): one month (or the year) of the SAP Usage —
  // per costcenter tCO2e + เงิน (บาท) most first, and the Top 5 materials by tCO2e · money counts every line pasted
  route('get', '/api/act/:activity/cfo/usage-report', async (req, res, activity, t) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const month = monthOf(req.query.month);
    const [rows, centers] = await Promise.all([
      fetchAll(() => tx.from(t.materialUse).select('*').gte('month', `${year}-01-01`).lte('month', `${year}-12-01`).order('id')).catch(() => []),
      fetchAll(() => mx.from('mt_main_costcenter').select('costcenter,object_name,department')).catch(() => [])
    ]);
    const centerOf = new Map(centers.map((c) => [String(c.costcenter).trim().toUpperCase(), c]));
    const months = [...new Set(rows.map((r) => r.month))].sort();
    const list = month ? rows.filter((r) => r.month === month) : rows;
    const r2 = (v) => Math.round(v * 100) / 100;
    const group = (keyOf, make) => Object.values(list.reduce((acc, r) => {
      const key = keyOf(r);
      const g = (acc[key] = acc[key] || { ...make(r), tco2e: 0, amount: 0, priced: 0, items: new Set() });
      g.tco2e += Number(r.tco2e);
      if (r.amount != null) { g.amount += Number(r.amount); g.priced += 1; }
      if (Number(r.tco2e) > 0) g.items.add(r.material);
      return acc;
    }, {})).map((g) => ({ ...g, tco2e: r6(g.tco2e), amount: g.priced ? r2(g.amount) : null, items: g.items.size, priced: undefined }));
    const ccs = group((r) => r.costcenter || r.department || '', (r) => {
      const c = centerOf.get(String(r.costcenter || '').toUpperCase());
      return { costcenter: r.costcenter || '', name: c?.object_name || '', department: r.department || c?.department || '' };
    }).sort((a, b) => b.tco2e - a.tco2e || (b.amount || 0) - (a.amount || 0));
    const top = group((r) => r.material, (r) => ({ material: r.material, name: r.name, unit: r.unit, qty: 0 })).filter((x) => x.tco2e > 0);
    const qtyOf = list.reduce((acc, r) => acc.set(r.material, (acc.get(r.material) || 0) + Number(r.qty)), new Map());
    const byMonth = months.map((m) => {
      const of = rows.filter((r) => r.month === m);
      return { month: m, tco2e: r6(of.reduce((s, r) => s + Number(r.tco2e), 0)), amount: r2(of.reduce((s, r) => s + Number(r.amount || 0), 0)) };
    });
    res.json({ year, month, months: byMonth, costcenter: rows.some((r) => r.costcenter), costcenters: ccs,
      top: top.map((x) => ({ ...x, qty: r6(qtyOf.get(x.material) || 0) })).sort((a, b) => b.tco2e - a.tco2e).slice(0, 5),
      total: { tco2e: r6(list.reduce((s, r) => s + Number(r.tco2e), 0)), amount: r2(list.reduce((s, r) => s + Number(r.amount || 0), 0)), lines: list.filter((r) => Number(r.tco2e) > 0).length } });
  });
  route('delete', '/api/act/:activity/cfo/material-usage/:month', async (req, res, activity, t) => {
    if (!(await requireAdminNow(req, res, activity))) return;
    const month = monthOf(req.params.month);
    if (!month) return fail(res, 400, 'เดือนไม่ถูกต้อง');
    must(await tx.from(t.materialUse).delete().eq('month', month));
    // the months of the SAP activities go with it
    const ids = (await fetchAll(() => tx.from(t.activity).select('id').eq('calc', 'sap'))).map((a) => a.id);
    for (let i = 0; i < ids.length; i += 200) must(await tx.from(t.entry).delete().eq('month', month).in('activity_id', ids.slice(i, i + 200)));
    await logRev(t, req, 'Usage วัสดุ (SAP)', month.slice(0, 7), 'ลบ Usage ทั้งเดือน');
    res.json({ ok: true });
  });

  // An activity picks its EF from Setting > Emission Factor (EF พลังงาน / GWP สารเคมี / EF CFP, ผู้ใช้กำหนด 2026-11-01):
  // the reference row is copied into mt_cfo_ef (code ref:<id>:<scope>) because entries keep the EF they were saved with.
  // The copy is reused while the reference values stay the same; after an edit a new copy is made, old entries keep theirs.
  // conv = { factor, unit }: the 3-3 line of a fuel used in litres with an EF CFP per kg (Fr-04.1 ผู้ใช้กำหนด 2026-11-02):
  // EF per litre = EF per kg × density (kg/l, Setting > Fuel Properties) · the copy keeps the unit of the activity
  const efFromRef = async (t, refId, scopeCode, direct = false, conv = null) => {
    const ref = must(await tx.from(t.efRef).select('*').eq('id', refId).maybeSingle());
    if (!ref || !REF_PICK.includes(ref.sheet)) return { error: 'ไม่พบ EF ในตารางอ้างอิง' };
    if (!ref.unit || ref.total == null) return { error: 'รายการนี้เป็นหัวข้อ ไม่มีค่า EF ให้เลือกรายการย่อย' };
    if (!must(await tx.from(t.cfoScope).select('code').eq('code', scopeCode).maybeSingle())) return { error: 'เลือกหมวด (Scope) ของกิจกรรม' };
    const biogenic = /biogenic/i.test(ref.name);
    const nonKyoto = ref.sheet === 'chemical' && /HCFC|R-22\b/i.test(ref.name);
    const row = { scope_code: scopeCode, kind: ref.grp, name: ref.name.replace(/^-\s*/, ''), detail: ref.formula, unit: ref.unit, reference: ref.reference, year: thisYear(), status: 'Active',
      source_type: ref.sheet === 'cfp' ? null : 'tgo', separate: direct || biogenic || nonKyoto,
      kgco2e: biogenic || nonKyoto ? 0 : Number(ref.total), co2_bio: biogenic ? Number(ref.total) : null };
    if (ref.sheet === 'energy' && !biogenic) Object.assign(row, { co2: ref.co2, ch4_fossil: ref.ch4_fossil, ch4: ref.ch4, n2o: ref.n2o });
    // B7 / E10 / ฟืน: the "Report in Scope 1" row and its "Report in Biogenic CO2" pair sit under the same heading,
    // so one activity carries both (co2_bio is reported apart in Fr-04.1, not in the Scope total)
    if (ref.sheet === 'energy' && !biogenic && !direct && /^-\s/.test(ref.name)) {
      const next = must(await tx.from(t.efRef).select('name,total,unit').eq('sheet', 'energy').gt('sort_no', ref.sort_no).order('sort_no').limit(3));
      const pair = next.find((r, i) => /biogenic/i.test(r.name) && next.slice(0, i).every((x) => /^-\s/.test(x.name)) && r.unit === ref.unit);
      if (pair?.total != null) row.co2_bio = Number(pair.total);
    }
    if (ref.sheet === 'chemical') Object.assign(row, nonKyoto ? { other: 1, other_gwp: Number(ref.total) } : { hfc: 1, hfc_gwp: Number(ref.total) });
    const factor = conv && Number(conv.factor) > 0 && Number(conv.factor) !== 1 ? Number(conv.factor) : null;
    if (factor) {
      Object.assign(row, { unit: conv.unit, kgco2e: Math.round(Number(ref.total) * factor * 1e6) / 1e6, co2: null, ch4_fossil: null, ch4: null, n2o: null, co2_bio: null,
        detail: `${ref.total} kgCO₂e/${ref.unit} × ${factor} ${ref.unit}/${conv.unit}${ref.formula ? ` · ${ref.formula}` : ''}`.slice(0, 500) });
    }
    const base = `ref:${ref.id}:${scopeCode}${direct ? ':sep' : ''}${factor ? `:x${factor}` : ''}`;
    const copies = must(await tx.from(t.ef).select('id,code,kgco2e,unit,co2_bio').like('code', `${base}*`).order('id', { ascending: false }))
      .filter((c) => /^(:\d+)?$/.test(c.code.slice(base.length))); // exactly this copy: 3-1 must not take 3-10 … 3-15, or :sep / :x
    const same = copies.find((c) => c.unit === row.unit && Number(c.kgco2e) === row.kgco2e && Number(c.co2_bio ?? 0) === Number(row.co2_bio ?? 0));
    if (same) return { id: same.id };
    row.code = copies.length ? `${base}:${copies.length + 1}` : base;
    const made = must(await tx.from(t.ef).insert({ ...row, ref_id: ref.id }).select('id'));
    return { id: made[0].id };
  };
  // Septic tank: the quantity is kg CH4 and v_cfo_entry multiplies it by the GWP CH4, so the EF is a fixed one per category.
  const efSeptic = async (t, scopeCode) => {
    const code = `septic:${scopeCode}`;
    const found = must(await tx.from(t.ef).select('id').eq('code', code).maybeSingle());
    if (found) return { id: found.id };
    const made = must(await tx.from(t.ef).insert({ code, scope_code: scopeCode, name: 'Septic Tank (kg CH₄ × GWP CH₄)', unit: 'kg CH4', kgco2e: 28, ch4: 1, reference: 'IPCC 2006 Vol.5 ch.6 (บ่อเกรอะ)', year: thisYear(), status: 'Active' }).select('id'));
    return { id: made[0].id };
  };
  // type = Scope 1 / 2 / 3, or sep = การปล่อย GHG โดยตรงที่ทำการรายงานแยก (Scope 1 categories, kept out of the Scope totals)
  const activityInput = async (t, b) => {
    const row = { ef_id: Number(b.ef_id), gwp_code: text(b.gwp_code, 20) || 'AR5', department: text(b.department, 80), name: text(b.name, 200), detail: text(b.detail, 500), calc: CFO_CALCS[b.calc] ? b.calc : null, status: b.status === 'Inactive' ? 'Inactive' : 'Active' };
    if (!row.department || !row.name) return { error: 'ระบุหน่วยงานและชื่อกิจกรรม' };
    const scopeCode = text(b.scope_code, 10);
    const type = ['1', '2', '3', 'sep'].includes(String(b.type)) ? String(b.type) : null;
    if (type && scopeCode && !scopeCode.startsWith(`${type === 'sep' ? 1 : type}-`)) return { error: 'หมวดไม่ตรงกับ Scope ที่เลือก' };
    if (b.ref_id) {
      const picked = await efFromRef(t, Number(b.ref_id), scopeCode, type === 'sep');
      if (picked.error) return picked;
      row.ef_id = picked.id;
    } else if (row.calc === 'septic' && !row.ef_id) {
      if (!scopeCode) return { error: 'เลือกหมวด (Scope) ของกิจกรรม' };
      row.ef_id = (await efSeptic(t, scopeCode)).id;
    }
    if (!row.ef_id) return { error: 'เลือก Emission factor' };
    if (b.ef3 !== undefined) {
      const [kind, id] = String(b.ef3 || '').split(':');
      if (kind === 'ref') {
        const main = must(await tx.from(t.ef).select('unit').eq('id', row.ef_id).maybeSingle());
        const factor = Number(b.ef3_factor);
        if (b.ef3_factor !== undefined && b.ef3_factor !== '' && !(factor > 0)) return { error: 'ตัวคูณแปลงหน่วย 3-3 ต้องมากกว่า 0' };
        const up = await efFromRef(t, Number(id), '3-3', false, factor > 0 ? { factor, unit: main?.unit } : null);
        if (up.error) return up;
        row.ef3_id = up.id;
      } else row.ef3_id = kind === 'ef' && Number(id) ? Number(id) : null;
    }
    // ef3_off: the admin chose "ไม่คิด 3-3", so fillEf3 leaves this activity alone (sent only when it is or was chosen)
    if (b.ef3_off !== undefined) row.ef3_off = b.ef3_off === true;
    return { row };
  };
  route('post', '/api/act/:activity/cfo/activities', async (req, res, activity, t) => {
    if (!(await requireAdminNow(req, res, activity))) return;
    const { row, error } = await activityInput(t, req.body || {});
    if (error) return fail(res, 400, error);
    must(await tx.from(t.activity).insert(row));
    await logRev(t, req, 'กิจกรรม', `${row.department} · ${row.name}`, 'เพิ่มกิจกรรม');
    res.status(201).json({ ok: true });
  });
  route('patch', '/api/act/:activity/cfo/activities/:id', async (req, res, activity, t) => {
    if (!(await requireAdminNow(req, res, activity))) return;
    const current = must(await tx.from(t.activity).select('*').eq('id', Number(req.params.id)).maybeSingle());
    if (!current) return fail(res, 404, 'ไม่พบกิจกรรม');
    if (current.calc === 'sap') {
      const status = req.body?.status === 'Inactive' ? 'Inactive' : 'Active';
      must(await tx.from(t.activity).update({ status }).eq('id', current.id));
      await logRev(t, req, 'กิจกรรม', `${current.department} · ${current.name}`, `สถานะ ${status}`);
      return res.json({ ok: true });
    }
    const { row, error } = await activityInput(t, req.body || {});
    if (error) return fail(res, 400, error);
    must(await tx.from(t.activity).update(row).eq('id', current.id));
    // a 3-3 line added to an activity also counts for the months already recorded without one (ผู้ใช้กำหนด 2026-11-03)
    if (row.ef3_id && row.ef3_id !== current.ef3_id) must(await tx.from(t.entry).update({ ef3_id: row.ef3_id }).eq('activity_id', current.id).is('ef3_id', null));
    // "ไม่คิด 3-3": the months not confirmed yet stop counting it too
    if (row.ef3_off) must(await tx.from(t.entry).update({ ef3_id: null }).eq('activity_id', current.id).neq('status', 'CONFIRMED'));
    await logRev(t, req, 'กิจกรรม', `${current.department} · ${current.name}`, changes(current, row, Object.keys(row)));
    res.json({ ok: true });
  });
  // Fill the 3-3 line of every fuel activity that has none (ผู้ใช้กำหนด 2026-11-03), the pick the activity form makes:
  // Diesel / B7 → EF CFP น้ำมันดีเซล, Gasohol / gasoline → แก๊สโซลีน, LPG → ก๊าซหุงต้ม (กลั่น) · litres × density (Fuel Properties)
  // · the months already recorded get it too. Scope 1 (1-1, 1-2) and Scope 3 (not 3-3); electricity and refrigerants are left.
  const FUEL_UP = { Diesel: [/^น้ำมันดีเซล/], Gasoline: [/^แก๊สโซลีน$/], LPG: [/^ก๊าซหุงต้ม$/, /กลั่น/] };
  const fuelOf = (name) => (/diesel|ดีเซล|\bB\d+\b/i.test(name) ? 'Diesel' : /gasohol|gasoline|เบนซิน|โซฮอล|\bE\d+\b/i.test(name) ? 'Gasoline' : /LPG|ก๊าซหุงต้ม/i.test(name) ? 'LPG' : null);
  const litre = (u) => /^(l|liter|litre|ลิตร)$/i.test(String(u || '').trim());
  // TGO EF CFP rows the 3-3 line needs (inbox/import_cfp_tgo.sql, same text so that import finds them and adds no copy)
  // and Fuel Properties density (kg/l): used when the database does not have them yet
  const TGO_FUEL = {
    Diesel: { item_no: '41', name: 'น้ำมันดีเซล / น้ำมันโซล่าร์', formula: 'น้ำมันดีเซลที่ได้จากกระบวนการกลั่นน้ำมันดิบ; LCIA method IPCC 2013 GWP 100a V1.03', total: 0.3503, density: 0.87 },
    Gasoline: { item_no: '38', name: 'แก๊สโซลีน', formula: 'แก๊สโซลีน (น้ำมันเบนซิน) ที่ได้จากกระบวนการกลั่นน้ำมันดิบ; LCIA method IPCC 2013 GWP 100a V1.03', total: 0.4006, density: 0.7347 },
    LPG: { item_no: '37', name: 'ก๊าซหุงต้ม', formula: 'ก๊าซหุงต้มที่ได้จากกระบวนการกลั่นน้ำมันดิบ; LCIA method IPCC 2013 GWP 100a V1.03', total: 0.4304, density: 0.54 }
  };
  const tgoFuelRow = async (t, fuel) => {
    const f = TGO_FUEL[fuel];
    const code = `CFP-${f.item_no.padStart(4, '0')}`;
    const taken = must(await tx.from(t.efRef).select('id').eq('code', code).limit(1)).length > 0;
    const made = must(await tx.from(t.efRef).insert({ sheet: 'cfp', grp: 'กลุ่มพลังงานและเชื้อเพลิง (Energy and Fuels)', item_no: f.item_no, name: f.name, formula: f.formula, unit: 'kg', total: f.total,
      reference: 'Thai National LCI Database, TIIS-MTEC-NSTDA (with TGO electricity 2022-2024)', remark: 'Update_April2026', sort_no: Number(f.item_no), status: 'Active', code: taken ? null : code })
      .select('id,sheet,grp,name,formula,unit,total'));
    return made[0];
  };
  // Every fuel activity without 3-3 gets it (button เติม 3-3, and on its own when an admin opens Setting or Dashboard)
  const fillEf3 = async (t, req) => {
    const [acts, efs, refs] = await Promise.all([
      fetchAll(() => tx.from(t.activity).select('*').order('id')),
      fetchAll(() => tx.from(t.ef).select('*')),
      fetchAll(() => tx.from(t.efRef).select('id,sheet,grp,name,formula,unit,total').in('sheet', ['energy', 'cfp', 'fuel']))
    ]);
    const efById = new Map(efs.map((e) => [e.id, e]));
    const refById = new Map(refs.map((r) => [r.id, r]));
    const done = [];
    const skipped = [];
    for (const a of acts) {
      const e = efById.get(a.ef_id);
      if (a.ef3_id || a.ef3_off || !e || a.calc === 'septic' || e.hfc || e.other) continue;
      if (!(['1-1', '1-2'].includes(e.scope_code) || e.scope_code?.startsWith('2-') || (e.scope_code?.startsWith('3-') && e.scope_code !== '3-3'))) continue;
      const ref = refById.get(e.ref_id);
      // electricity: the grid mix "SCOPE 3" row of the same years (2022-2024: 0.475 → 0.0812), as the activity form picks
      if (e.scope_code?.startsWith('2-') || ref?.grp === 'Electricity') {
        const years = /ปี (\d{4}-\d{4})/.exec(ref?.name || e.name || '')?.[1];
        const pair = years && refs.find((r) => r.sheet === 'energy' && r.grp === 'Electricity' && r.name.includes(years) && /SCOPE 3/i.test(r.name) && r.total != null);
        if (!pair) { skipped.push(`${a.department} · ${a.name}: ไม่พบ EF ไฟฟ้า SCOPE 3 ของปีเดียวกัน`); continue; }
        const made = await efFromRef(t, pair.id, '3-3');
        if (made.error) { skipped.push(`${a.department} · ${a.name}: ${made.error}`); continue; }
        must(await tx.from(t.activity).update({ ef3_id: made.id }).eq('id', a.id));
        a.ef3_id = made.id;
        done.push(a.id);
        continue;
      }
      if (ref && ref.sheet !== 'energy') continue;
      const fuel = fuelOf(ref?.name || e.name);
      if (!fuel) continue;
      const [name, detail] = FUEL_UP[fuel];
      let up = refs.find((r) => r.sheet === 'cfp' && name.test(r.name) && (!detail || detail.test(r.formula || '')) && r.total != null);
      if (!up) refs.push((up = await tgoFuelRow(t, fuel)));
      const density = refs.find((r) => r.sheet === 'fuel' && r.grp === 'Density' && r.name === fuel)?.total ?? TGO_FUEL[fuel].density;
      const same = up && String(up.unit).toLowerCase() === String(e.unit).toLowerCase();
      if (!up || (!same && !(litre(e.unit) && String(up.unit).toLowerCase() === 'kg' && density))) { skipped.push(`${a.department} · ${a.name} ${a.detail || ''}`.trim()); continue; }
      const made = await efFromRef(t, up.id, '3-3', false, same ? null : { factor: Number(density), unit: e.unit });
      if (made.error) { skipped.push(`${a.department} · ${a.name}: ${made.error}`); continue; }
      must(await tx.from(t.activity).update({ ef3_id: made.id }).eq('id', a.id));
      a.ef3_id = made.id;
      done.push(a.id);
    }
    // entries recorded or imported (inbox/import_cfo_tx.sql) without the 3-3 EF of their activity get it: one update per EF
    const byEf3 = new Map();
    for (const a of acts.filter((x) => x.ef3_id)) byEf3.set(a.ef3_id, [...(byEf3.get(a.ef3_id) || []), a.id]);
    for (const [ef3, ids] of byEf3) must(await tx.from(t.entry).update({ ef3_id: ef3 }).in('activity_id', ids).is('ef3_id', null));
    if (done.length) await logRev(t, req, 'กิจกรรม', 'เติม 3-3', `เติม EF การได้มาของเชื้อเพลิง (3-3) ให้ ${done.length} กิจกรรม`);
    return { filled: done.length, skipped };
  };
  // quietly, for an admin: a failure (e.g. before db/act/cfo.sql) must not stop the page
  const autoFillEf3 = (t, req, admin) => (admin ? fillEf3(t, req).catch(() => null) : null);
  route('post', '/api/act/:activity/cfo/activities/fill-ef3', async (req, res, activity, t) => {
    if (!(await requireAdminNow(req, res, activity))) return;
    res.json({ ok: true, ...(await fillEf3(t, req)) });
  });
  route('delete', '/api/act/:activity/cfo/activities/:id', async (req, res, activity, t) => {
    if (!(await requireAdminNow(req, res, activity))) return;
    const id = Number(req.params.id);
    if (must(await tx.from(t.entry).select('id').eq('activity_id', id).limit(1)).length) return fail(res, 400, 'กิจกรรมนี้มีข้อมูลแล้ว ลบไม่ได้ ให้ตั้งเป็น Inactive');
    const gone = must(await tx.from(t.activity).delete().eq('id', id).select('department,name'));
    if (gone[0]) await logRev(t, req, 'กิจกรรม', `${gone[0].department} · ${gone[0].name}`, 'ลบกิจกรรม');
    res.json({ ok: true });
  });

  route('post', '/api/act/:activity/cfo/photo', async (req, res, activity, t) => {
    if (!(await requireAdminNow(req, res, activity))) return;
    const slot = [1, 2].includes(Number(req.body?.slot)) ? Number(req.body.slot) : 0;
    const bytes = imageBytes(req.body?.image);
    if (!slot || !bytes) return fail(res, 400, 'รูปต้องเป็น JPEG ไม่เกิน 700 KB');
    const key = `company/photo${slot}_${Date.now()}.jpg`;
    const uploaded = await tx.storage.from(t.bucket).upload(key, new Uint8Array(bytes), { contentType: 'image/jpeg', upsert: false });
    if (uploaded.error) return fail(res, 400, /bucket/i.test(String(uploaded.error.message)) ? `ยังไม่ได้สร้างที่เก็บรูป ${t.bucket} ใน Tx Data` : 'อัปโหลดรูปไม่ได้');
    const url = tx.storage.from(t.bucket).getPublicUrl(key).data.publicUrl;
    const was = must(await tx.from(t.setting).select('value').eq('key', `company_photo${slot}`).maybeSingle());
    must(await tx.from(t.setting).upsert([{ key: `company_photo${slot}`, value: url }], { onConflict: 'key' }));
    if (was?.value && was.value !== url) await dropFiles(tx, t.bucket, was.value);
    res.status(201).json({ url });
  });

  route('put', '/api/act/:activity/cfo/settings', async (req, res, activity, t) => {
    if (!(await requireAdminNow(req, res, activity))) return;
    const rows = Object.entries(req.body || {}).filter(([k]) => settingKey(k)).map(([key, value]) => ({ key, value: String(value ?? '').trim().slice(0, 1000) }));
    if (!rows.length) return fail(res, 400, 'ไม่มีข้อมูลให้บันทึก');
    const before = await settingsOf(t);
    must(await tx.from(t.setting).upsert(rows, { onConflict: 'key' }));
    const after = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    await dropFiles(tx, t.bucket, Object.keys(after).filter((k) => k.startsWith('company_photo') && before[k] && before[k] !== after[k]).map((k) => before[k]));
    await logRev(t, req, 'ตั้งค่า', null, changes(before, after, Object.keys(after).filter((k) => !k.startsWith('company_photo'))));
    res.json({ ok: true });
  });

  // ---------- TGO forms ----------
  // Fr-03.2: the 15 Scope 3 categories of a year with the 6 criteria. A year not assessed yet shows the latest
  // earlier year (fromYear) so the admin starts from it.
  route('get', '/api/act/:activity/cfo/s3', async (req, res, activity, t) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const [scopes, rows, access, settings, entries] = await Promise.all([
      fetchAll(() => tx.from(t.cfoScope).select('code,name,name_th').eq('scope', 3)),
      fetchAll(() => tx.from(t.s3Assess).select('*').lte('year', year).order('year', { ascending: false })),
      accessOf(req, activity, year),
      settingsOf(t),
      fetchAll(() => tx.from(t.entryView).select('scope,scope_code,tco2e,separate').gte('month', `${year}-01-01`).lte('month', `${year}-12-01`))
    ]);
    // Magnitude = tCO2e of the category ÷ Scope 1+2+3 of the year (รายงานแยก not counted), as the form's % GHG
    const rule = s3Rule(settings);
    const counted = entries.filter((e) => !e.separate);
    const total = counted.reduce((sum, e) => sum + Number(e.tco2e), 0);
    const byCat = counted.filter((e) => e.scope === 3).reduce((acc, e) => ({ ...acc, [e.scope_code]: (acc[e.scope_code] || 0) + Number(e.tco2e) }), {});
    const fromYear = rows.some((r) => r.year === year) ? year : rows[0]?.year || null;
    const byCode = new Map(rows.filter((r) => r.year === fromYear).map((r) => [r.scope_code, r]));
    const sorted = scopes.sort((a, b) => Number(a.code.split('-')[1]) - Number(b.code.split('-')[1]));
    res.json({
      year, fromYear, admin: access.admin, rule, total: Math.round(total * 1000) / 1000,
      rows: sorted.map((s) => {
        const r = byCode.get(s.code) || { has_source: !!byCat[s.code] };
        const tco2e = Math.round((byCat[s.code] || 0) * 1000) / 1000;
        const share = total ? Math.round((tco2e / total) * 10000) / 100 : 0;
        const levels = { magnitude: s3MagLevel(share, rule), influence: s3Level(r.influence), risk: s3Level(r.risk), opportunity: s3Level(r.opportunity) };
        const score = s3Weighted(levels, rule);
        const has = r.has_source !== false;
        const sector = Number(r.sector) > 0;
        return { scope_code: s.code, name: s.name, name_th: s.name_th, has_source: has, tco2e, share, ...levels, sector, score, remark: r.remark || '',
          significant: has && (sector || score >= rule.pass), updated_by: r.updated_by || null, updated_at: r.updated_at || null };
      })
    });
  });
  route('put', '/api/act/:activity/cfo/s3', async (req, res, activity, t) => {
    const year = yearOf(req.body?.year, 0);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    if (!(await requireAdmin(req, res, activity, year))) return;
    const list = Array.isArray(req.body?.rows) ? req.body.rows : [];
    // levels 0–5 (0 = ยังไม่ประเมิน) · magnitude is the level the page showed from the data of the year
    const rows = list.filter((r) => /^3-\d{1,2}$/.test(String(r?.scope_code))).map((r) => ({
      year, scope_code: r.scope_code, has_source: r.has_source !== false, remark: text(r.remark, 1000),
      ...Object.fromEntries(S3_LEVELS.map((k) => [k, s3Level(r[k])])), sector: r.sector === true || Number(r.sector) > 0 ? 1 : 0,
      updated_by: req.user.employeeId, updated_at: new Date().toISOString()
    }));
    if (!rows.length) return fail(res, 400, 'ไม่มีข้อมูลให้บันทึก');
    const before = new Map((await fetchAll(() => tx.from(t.s3Assess).select('*').eq('year', year))).map((r) => [r.scope_code, r]));
    const saved = await tx.from(t.s3Assess).upsert(rows, { onConflict: 'year,scope_code' });
    // 22P02: the criteria columns are still ✓ / × (boolean) until db/act/cfo.sql is run again
    if (['22P02', 'PGRST204', '42703'].includes(saved.error?.code)) return fail(res, 503, 'เกณฑ์ Fr-03.2 แบบถ่วงน้ำหนักต้องรัน db/act/cfo.sql ใน Tx Data อีกรอบก่อนบันทึก');
    must(saved);
    const changed = rows.map((r) => {
      const d = changes(before.get(r.scope_code), r, ['has_source', ...S3_LEVELS, 'sector', 'remark']);
      return d && `${r.scope_code} ${d}`;
    }).filter(Boolean);
    await logRev(t, req, 'Fr-03.2', `ปี ${year}`, before.size ? changed.join(' | ') : 'ประเมินครั้งแรกของปี');
    res.json({ ok: true });
  });

  // Fr-04.1 (Fr-04.2 = the base year): one row per activity × EF for the whole year with the form's columns —
  // EF per gas, ton GHG and tCO2e per gas, total. Groups: Scope 1, รายงานแยก, Scope 2, Scope 3.
  route('get', '/api/act/:activity/cfo/inventory', async (req, res, activity, t) => {
    const baseYear = yearOf((await settingsOf(t)).base_year, 0) || null;
    const year = req.query.base === '1' ? baseYear : yearOf(req.query.year);
    if (!year) return fail(res, 400, req.query.base === '1' ? 'ยังไม่ได้ตั้งปีฐาน (Setting > บริษัท)' : 'ปีไม่ถูกต้อง');
    const department = text(req.query.department, 80);
    await autoSyncSap(t, req, (await accessOf(req, activity, thisYear())).admin);
    const [entries, activities, efs, gwps, scopes] = await Promise.all([
      fetchAll(() => tx.from(t.entry).select('*').gte('month', `${year}-01-01`).lte('month', `${year}-12-01`).order('id')),
      fetchAll(() => tx.from(t.activity).select('id,department,name,detail,calc').order('id')),
      fetchAll(() => tx.from(t.ef).select('*').order('id')),
      fetchAll(() => tx.from(t.gwp).select('*')),
      fetchAll(() => tx.from(t.cfoScope).select('code,scope,name'))
    ]);
    const act = new Map(activities.map((a) => [a.id, a]));
    const ef = new Map(efs.map((e) => [e.id, e]));
    const gwp = new Map(gwps.map((g) => [g.code, g]));
    const scope = new Map(scopes.map((s) => [s.code, s]));
    const lines = new Map();
    for (const e of entries) {
      const a = act.get(e.activity_id);
      if (!a || (department && a.department !== department)) continue;
      const key = `${e.activity_id}|${e.ef_id}|${e.gwp_code}`;
      const line = lines.get(key) || { a, f: ef.get(e.ef_id), g: gwp.get(e.gwp_code), qty: 0 };
      line.qty += Number(e.qty);
      lines.set(key, line);
      if (!e.ef3_id) continue;
      const up = `${e.activity_id}|${e.ef3_id}|${e.gwp_code}|up`;
      const upLine = lines.get(up) || { a, f: ef.get(e.ef3_id), g: gwp.get(e.gwp_code), qty: 0, upstream: true };
      upLine.qty += Number(e.qty);
      lines.set(up, upLine);
    }
    const n = (v) => Number(v || 0);
    const r6 = (v) => Math.round(v * 1e6) / 1e6;
    const rows = [...lines.values()].filter((l) => l.f && l.g).flatMap(({ a, f, g, qty, upstream }) => {
      // Septic: qty is kg CH4 (EF CH4 = 1 kg/kg), as v_cfo_entry · upstream = the 3-3 line (การได้มาของเชื้อเพลิง)
      const septic = a.calc === 'septic' && !upstream;
      const efGas = { co2: septic ? 0 : n(f.co2), ch4_fossil: septic ? 0 : n(f.ch4_fossil), ch4: septic ? 1 : n(f.ch4), n2o: septic ? 0 : n(f.n2o), sf6: n(f.sf6), nf3: n(f.nf3) };
      const gw = { co2: n(g.co2) || 1, ch4_fossil: n(g.ch4_fossil), ch4: n(g.ch4), n2o: n(g.n2o), sf6: n(g.sf6), nf3: n(g.nf3) };
      const hfcGwp = f.hfc_gwp == null ? 1 : n(f.hfc_gwp);
      const pfcGwp = f.pfc_gwp == null ? 1 : n(f.pfc_gwp);
      const ton = Object.fromEntries(Object.keys(efGas).map((k) => [k, r6((qty * efGas[k]) / 1000)]));
      const tco2e = {
        ...Object.fromEntries(Object.keys(efGas).map((k) => [k, r6((qty * efGas[k] * gw[k]) / 1000)])),
        hfc: r6((qty * n(f.hfc) * hfcGwp) / 1000), pfc: r6((qty * n(f.pfc) * pfcGwp) / 1000), other: r6((qty * n(f.other) * n(f.other_gwp)) / 1000)
      };
      const s = scope.get(f.scope_code) || {};
      const row = {
        group: f.separate ? 'separate' : `s${s.scope}`, scope: s.scope, scope_code: f.scope_code, scope_name: s.name,
        department: a.department, activity: upstream ? `${a.name} (การได้มาของ${f.kind === "Electricity" || /kwh/i.test(f.unit || "") ? "ไฟฟ้า" : "เชื้อเพลิง"})` : a.name, detail: a.detail, source: f.name, unit: f.unit, qty: r6(qty),
        ef: { ...efGas, hfc: n(f.hfc), hfc_gwp: n(f.hfc) ? hfcGwp : null, pfc: n(f.pfc), pfc_gwp: n(f.pfc) ? pfcGwp : null, other: n(f.other), other_gwp: n(f.other_gwp) },
        total_ef: septic ? gw.ch4 : n(f.kgco2e), source_type: f.source_type, substitute: f.substitute, reference: f.reference,
        ton, tco2e, total: r6((qty * (septic ? gw.ch4 : n(f.kgco2e))) / 1000)
      };
      // B7 / E10 / biomass: the biogenic CO2 is reported apart (EF TGO "Report in Biogenic CO2 emissions").
      if (!n(f.co2_bio)) return [row];
      const zero = (o) => Object.fromEntries(Object.keys(o).map((k) => [k, 0]));
      const bio = r6((qty * n(f.co2_bio)) / 1000);
      return [row, { ...row, group: 'separate', activity: `${a.name} (Biogenic CO₂)`, ef: { ...zero(row.ef), co2: n(f.co2_bio), hfc_gwp: null, pfc_gwp: null },
        total_ef: n(f.co2_bio), ton: { ...zero(ton), co2: bio }, tco2e: { ...zero(row.tco2e), co2: bio }, total: bio }];
    }).sort((x, y) => x.scope_code.localeCompare(y.scope_code, 'en', { numeric: true }) || x.department.localeCompare(y.department) || x.activity.localeCompare(y.activity));
    res.json({ year, baseYear, department, gwp: gwps.find((g) => g.code === 'AR5') || gwps[0] || null, rows });
  });

  // บันทึกการปรับปรุง: newest first; admins add a note by hand. No delete.
  route('get', '/api/act/:activity/cfo/revisions', async (req, res, activity, t) => {
    const [rows, access] = await Promise.all([
      fetchAll(() => tx.from(t.revision).select('*').order('at', { ascending: false }).order('id', { ascending: false })),
      accessOf(req, activity, thisYear())
    ]);
    const names = await namesOf([...new Set(rows.map((r) => r.by))]);
    res.json({
      admin: access.admin,
      rows: rows.map((r, i) => ({ ...r, no: rows.length - i, by_name: names.get(String(r.by))?.name || '' }))
    });
  });
  route('post', '/api/act/:activity/cfo/revisions', async (req, res, activity, t) => {
    if (!(await requireAdminNow(req, res, activity))) return;
    const area = text(req.body?.area, 120);
    const detail = text(req.body?.detail, 2000);
    if (!area || !detail) return fail(res, 400, 'ระบุส่วนที่แก้และรายละเอียด');
    must(await tx.from(t.revision).insert({ area, ref: text(req.body?.ref, 300), detail, by: req.user.employeeId }));
    res.status(201).json({ ok: true });
  });
}
