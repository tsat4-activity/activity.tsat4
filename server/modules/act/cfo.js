import { mx, tx } from '../../core/db.js';
import { fail } from '../../core/http.js';
import { accessOf, actRoute, dateOf, fetchAll, fetchIn, imageBytes, must, namesOf, requireAdmin, yearOf } from './common.js';

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
  const requireAdminNow = async (req, res, activity) => {
    const now = thisYear();
    if ((await accessOf(req, activity, now)).admin) return true;
    if ((await accessOf(req, activity, now - 1)).admin) return true;
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
    const [access, settings, activities, efs, scopes, gwp, entries, details, materials] = await Promise.all([
      accessOf(req, activity, year),
      settingsOf(t),
      fetchAll(() => tx.from(t.activity).select('id,department,name,detail,calc,status,ef_id,gwp_code').order('id')),
      fetchAll(() => tx.from(t.ef).select('id,scope_code,kind,name,unit,kgco2e').order('id')),
      fetchAll(() => tx.from(t.cfoScope).select('code,name').order('code')),
      fetchAll(() => tx.from(t.gwp).select('code,ch4').order('code')),
      fetchAll(() => tx.from(t.entryView).select('*').gte('month', `${year}-01-01`).lte('month', `${year}-12-01`).order('id')).then((list) => list.filter((e) => (e.part || 'main') === 'main')),
      fetchAll(() => tx.from(t.entry).select('id,status,inputs,doc,remark,updated_at,updated_by').gte('month', `${year}-01-01`).lte('month', `${year}-12-01`).order('id')),
      usageBySection(t, year)
    ]);
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
      materials,
      rows: activities.filter((a) => a.status === 'Active' || entriesByAct.has(a.id)).map((a) => {
        const list = entriesByAct.get(a.id) || [];
        const months = [...new Set(list.map((e) => Number(e.month.slice(5, 7))))];
        const ef = efById.get(a.ef_id) || {};
        return {
          id: a.id, department: a.department, name: a.name, detail: a.detail, calc: a.calc, scope_code: ef.scope_code, category: category(ef), source: ef.name,
          canEdit: access.admin || access.departments.includes(a.department),
          unit: a.calc === 'septic' ? 'kg CH₄' : ef.unit, kgco2e: a.calc === 'septic' ? gwpCh4.get(a.gwp_code) : ef.kgco2e,
          byMonth: Object.fromEntries(list.map((e) => [Number(e.month.slice(5, 7)), { qty: e.qty, tco2e: e.tco2e, ...detailOf.get(e.id) }])),
          months: months.sort((x, y) => x - y),
          percent: due ? Math.min(100, Math.round((months.filter((m) => m <= due).length / due) * 100)) : 0,
          qty: Math.round(list.reduce((s, e) => s + Number(e.qty), 0) * 1000) / 1000,
          tco2e: Math.round(list.reduce((s, e) => s + Number(e.tco2e), 0) * 1000) / 1000
        };
      })
    });
  });

  // ---------- transaction: save one activity × month ----------
  route('put', '/api/act/:activity/cfo/entries', async (req, res, activity, t) => {
    const month = monthOf(req.body?.month);
    const activityId = Number(req.body?.activityId);
    if (!month || !activityId) return fail(res, 400, 'เลือกกิจกรรมและเดือน');
    const act = must(await tx.from(t.activity).select('*').eq('id', activityId).maybeSingle());
    if (!act) return fail(res, 404, 'ไม่พบกิจกรรม');
    const access = await accessOf(req, activity, Number(month.slice(0, 4)));
    if (!access.admin && !access.departments.includes(act.department)) return fail(res, 403, `บันทึกได้เฉพาะตัวแทนหน่วยงาน ${act.department} หรือผู้จัดทำ`);
    const current = must(await tx.from(t.entry).select('id,status').eq('activity_id', act.id).eq('month', month).maybeSingle());
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
    res.json({ ok: true, qty });
  });

  route('delete', '/api/act/:activity/cfo/entries/:id', async (req, res, activity, t) => {
    const entry = must(await tx.from(t.entry).select('id,month,status,activity_id').eq('id', Number(req.params.id)).maybeSingle());
    if (!entry) return fail(res, 404, 'ไม่พบรายการ');
    const [actRes, access] = await Promise.all([
      tx.from(t.activity).select('department').eq('id', entry.activity_id).single(),
      accessOf(req, activity, Number(entry.month.slice(0, 4)))
    ]);
    const act = must(actRes);
    if (!access.admin && (entry.status === 'CONFIRMED' || !access.departments.includes(act.department))) return fail(res, 403, 'ลบรายการนี้ไม่ได้');
    must(await tx.from(t.entry).delete().eq('id', entry.id));
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
    const [scopes, gwp, ef, refs, activities, used, settings, access, mats] = await Promise.all([
      fetchAll(() => tx.from(t.cfoScope).select('*').order('scope').order('code')),
      fetchAll(() => tx.from(t.gwp).select('*').order('code')),
      fetchAll(() => tx.from(t.ef).select('*').order('scope_code').order('id')),
      fetchAll(() => tx.from(t.efRef).select('*').order('sheet').order('sort_no').order('id')),
      fetchAll(() => tx.from(t.activity).select('*').order('department').order('id')),
      fetchAll(() => tx.from(t.entry).select('ef_id,activity_id,gwp_code').order('id')),
      settingsOf(t),
      accessOf(req, activity, thisYear()),
      fetchAll(() => tx.from(t.material).select('grp,scope_code,ef_ref_id,factor,status')).catch(() => [])
    ]);
    // Usage (SAP) activities (ผู้ใช้กำหนด 2026-11-03): one per หมวดหลัก of the materials, counted from the SAP Usage
    const matGroups = Object.values(mats.filter((x) => x.grp && x.status !== 'Inactive').reduce((acc, x) => {
      const g = (acc[`${x.scope_code}|${x.grp}`] = acc[`${x.scope_code}|${x.grp}`] || { grp: x.grp, scope_code: x.scope_code, items: 0, counted: 0, refs: new Set() });
      g.items += 1;
      if (x.ef_ref_id && x.factor) { g.counted += 1; g.refs.add(x.ef_ref_id); }
      return acc;
    }, {})).map((g) => ({ ...g, refs: [...g.refs] })).sort((a, b) => a.grp.localeCompare(b.grp, 'th'));
    const usedEf = new Set(used.map((u) => u.ef_id));
    const usedGwp = new Set([...used, ...activities].map((u) => u.gwp_code));
    const usedAct = new Set(used.map((u) => u.activity_id));
    res.json({
      admin: access.admin,
      scopes, settings, refs, matGroups,
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
    const current = must(await tx.from(t.efRef).select('id,sort_no').eq('id', Number(req.params.id)).maybeSingle());
    if (!current) return fail(res, 404, 'ไม่พบรายการ');
    const { row, error } = await refInput(t, req.body || {});
    if (error) return fail(res, 400, error);
    if (row.sort_no == null) row.sort_no = current.sort_no;
    if (await codeTaken(t, row.code, current.id)) return fail(res, 400, `id ${row.code} มีอยู่แล้ว`);
    if (!row.code) delete row.code;
    must(await tx.from(t.efRef).update(row).eq('id', current.id));
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
    const all = await fetchAll(() => tx.from(t.efRef).select('id,sheet,code,sort_no'));
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
      const { row, error } = await refInput(t, { ...b, grp: group, sheet, ...(sheet === 'ipcc' && !b.unit ? { unit: 'TJ' } : {}) });
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
    must(await tx.from(t.efRef).delete().eq('id', Number(req.params.id)));
    res.json({ ok: true });
  });

  // ---------- Setting > วัสดุ (SAP): Store usage → Scope 3 (ผู้ใช้กำหนด 2026-11-01) ----------
  // A material is counted once it has an EF (reference table row) and a factor (1 SAP unit = factor EF units).
  const matCode = (v) => String(v ?? '').trim().replace(/^0+(?=\d)/, '').slice(0, 40) || null;
  const MAT_SHEETS = ['cfp', 'energy', 'chemical'];
  // usage = ของใช้สิ้นเปลือง (Store) · raw = วัตถุดิบ · other = อื่นๆ (ผู้ใช้กำหนด 2026-11-02)
  const MAT_KINDS = { usage: 'Usage', raw: 'วัตถุดิบ', other: 'อื่นๆ' };
  route('get', '/api/act/:activity/cfo/materials', async (req, res, activity, t) => {
    const [rows, uses, access, sections] = await Promise.all([
      fetchAll(() => tx.from(t.material).select('*').order('material')),
      fetchAll(() => tx.from(t.materialUse).select('month,tco2e').order('month')),
      accessOf(req, activity, thisYear()),
      usageBySection(t, yearOf(req.query.year) || thisYear())
    ]);
    const months = Object.values(uses.reduce((acc, u) => {
      const m = (acc[u.month] = acc[u.month] || { month: u.month, rows: 0, tco2e: 0 });
      m.rows += 1;
      m.tco2e += Number(u.tco2e);
      return acc;
    }, {})).map((m) => ({ ...m, tco2e: Math.round(m.tco2e * 1000) / 1000 }));
    res.json({ admin: access.admin, rows, months, sections });
  });
  // partial (grid paste): a blank cell keeps what the material already has, so pasting only EF + factor does not
  // wipe the SAP unit that the Usage check compares against
  const matInput = async (t, b, partial = false, preloadedRefs = null) => {
    const given = (k) => b[k] !== undefined && !(partial && String(b[k] ?? '').trim() === '');
    const row = { material: matCode(b.material) };
    if (!row.material) return { error: 'ระบุรหัสวัสดุ' };
    if (given('name')) row.name = text(b.name, 300);
    if (given('sap_unit')) row.sap_unit = text(b.sap_unit, 20);
    if (given('grp')) row.grp = text(b.grp, 120); // หมวดหลัก = กิจกรรม 3-1
    if (given('status')) row.status = b.status === 'Inactive' ? 'Inactive' : 'Active';
    if (given('kind')) {
      row.kind = String(b.kind).trim();
      if (!MAT_KINDS[row.kind]) row.kind = Object.keys(MAT_KINDS).find((k) => MAT_KINDS[k] === row.kind) || null;
      if (!row.kind) return { error: 'ประเภทต้องเป็น Usage / วัตถุดิบ / อื่นๆ' };
    }
    if (given('ef_ref_id') || given('ef_name')) {
      if (b.ef_name !== undefined && String(b.ef_name || '').trim()) {
        const want = String(b.ef_name).trim().toLowerCase();
        const refs = preloadedRefs || must(await tx.from(t.efRef).select('id,code,name,sheet,unit,total').in('sheet', MAT_SHEETS));
        // the EF id (CFP-0001) first, then the name as written in the table
        const hit = refs.find((r) => String(r.code || '').toLowerCase() === want && r.unit && r.total != null)
          || refs.find((r) => r.name.replace(/^-\s*/, '').trim().toLowerCase() === want && r.unit && r.total != null);
        if (!hit) return { error: `ไม่พบ EF id หรือชื่อ "${b.ef_name}" ในตาราง EF CFP / EF พลังงาน` };
        row.ef_ref_id = hit.id;
      } else row.ef_ref_id = Number(b.ef_ref_id) || null;
    }
    if (given('factor')) {
      row.factor = numOrNull(b.factor);
      if (Number.isNaN(row.factor) || (row.factor != null && row.factor <= 0)) return { error: 'ตัวแปลงต้องเป็นตัวเลขมากกว่า 0' };
    }
    if (given('scope_code')) {
      row.scope_code = text(b.scope_code, 10) || '3-1';
      if (!/^3-\d{1,2}$/.test(row.scope_code)) return { error: 'หมวดของวัสดุต้องเป็น Scope 3 (3-1 … 3-15)' };
    }
    if (row.ef_ref_id && row.factor === undefined && !partial) row.factor = 1;
    return { row };
  };
  // Add or update many at once (grid paste): material · name · SAP unit · EF name · factor · category
  route('post', '/api/act/:activity/cfo/materials', async (req, res, activity, t) => {
    if (!(await requireAdminNow(req, res, activity))) return;
    const list = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 2000) : [req.body || {}];
    const needRefs = list.some((b) => b.ef_name !== undefined && String(b.ef_name || '').trim());
    const [refs, existingList] = await Promise.all([
      needRefs ? tx.from(t.efRef).select('id,code,name,sheet,unit,total').in('sheet', MAT_SHEETS).then(must) : null,
      fetchIn(() => tx.from(t.material).select('material'), 'material', list.map((b) => matCode(b.material)))
    ]);
    const existing = new Set(existingList.map((r) => r.material));
    const parsed = [];
    for (const [i, b] of list.entries()) {
      const { row, error } = await matInput(t, b, true, refs);
      if (error) return fail(res, 400, list.length > 1 ? `แถว ${i + 1}: ${error}` : error);
      parsed.push(row);
    }
    const toInsert = [];
    const toUpdate = [];
    for (const row of parsed) {
      if (existing.has(row.material)) toUpdate.push(row);
      else {
        existing.add(row.material);
        toInsert.push({ name: row.material, ...row, ...(row.ef_ref_id && row.factor === undefined ? { factor: 1 } : {}) });
      }
    }
    await Promise.all([
      toInsert.length ? tx.from(t.material).insert(toInsert).then(must) : null,
      ...toUpdate.map((row) => tx.from(t.material).update(row).eq('material', row.material).then(must))
    ]);
    await logRev(t, req, 'วัสดุ (SAP)', list.length === 1 ? matCode(list[0].material) : `${list.length} รายการ`, 'เพิ่ม / แก้วัสดุและ EF');
    res.status(201).json({ ok: true, count: list.length });
  });
  route('patch', '/api/act/:activity/cfo/materials/:material', async (req, res, activity, t) => {
    if (!(await requireAdminNow(req, res, activity))) return;
    const current = must(await tx.from(t.material).select('*').eq('material', req.params.material).maybeSingle());
    if (!current) return fail(res, 404, 'ไม่พบวัสดุ');
    const { row, error } = await matInput(t, { ...req.body, material: current.material });
    if (error) return fail(res, 400, error);
    if (!row.name) row.name = current.name;
    must(await tx.from(t.material).update(row).eq('material', current.material));
    await logRev(t, req, 'วัสดุ (SAP)', current.material, changes(current, row, Object.keys(row)));
    res.json({ ok: true });
  });
  route('delete', '/api/act/:activity/cfo/materials/:material', async (req, res, activity, t) => {
    if (!(await requireAdminNow(req, res, activity))) return;
    if (must(await tx.from(t.materialUse).select('id').eq('material', req.params.material).limit(1)).length) return fail(res, 400, 'วัสดุนี้มี Usage แล้ว ลบไม่ได้ ให้ตั้งเป็น Inactive');
    must(await tx.from(t.material).delete().eq('material', req.params.material));
    res.json({ ok: true });
  });

  // Usage of one month pasted from SAP: rows [{ material, qty, unit, department }] (department may be a cost center).
  // save = false only checks: counted / unit not matching / no EF / not in the list. save = true replaces that month.
  route('post', '/api/act/:activity/cfo/material-usage', async (req, res, activity, t) => {
    if (!(await requireAdminNow(req, res, activity))) return;
    const month = monthOf(req.body?.month);
    const input = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!month) return fail(res, 400, 'เลือกเดือน');
    if (!input.length) return fail(res, 400, 'ยังไม่มีข้อมูล Usage');
    const [mats, refs, centers] = await Promise.all([
      fetchAll(() => tx.from(t.material).select('*')),
      fetchAll(() => tx.from(t.efRef).select('id,name,unit,total,status').in('sheet', MAT_SHEETS)),
      fetchAll(() => mx.from('mt_main_costcenter').select('costcenter,department'))
    ]);
    const mat = new Map(mats.map((m) => [m.material, m]));
    const ref = new Map(refs.map((r) => [r.id, r]));
    const dept = new Map(centers.map((c) => [String(c.costcenter).trim().toUpperCase(), c.department]));
    // costcenter / amount: columns from db/act/cfo.sql 2026-11-02 · before that SQL the month still saves without them
    const ccCols = !(await tx.from(t.materialUse).select('costcenter,amount,grp').limit(1)).error;
    const unitKey = (u) => String(u || '').trim().toUpperCase();
    // one line per department × material × unit
    const lines = new Map();
    let skipped = 0;
    for (const r of input) {
      const code = matCode(r.material);
      const qty = Number(String(r.qty ?? '').replace(/,/g, ''));
      if (!code || !Number.isFinite(qty)) continue;
      if (qty <= 0) { skipped += 1; continue; }
      const raw = text(r.department, 80);
      const department = raw ? dept.get(raw.toUpperCase()) || raw : null;
      // money: the SAP column total (บาท) when pasted, else qty × price of the row
      const amount = Number(String(r.amount ?? '').replace(/,/g, ''));
      const price = Number(String(r.price ?? '').replace(/,/g, ''));
      const key = `${raw}|${code}|${unitKey(r.unit)}`;
      const line = lines.get(key) || { department, costcenter: raw, material: code, unit: text(r.unit, 20), qty: 0, amount: 0, priced: false };
      line.qty += qty;
      if (String(r.amount ?? '').trim() !== '' && Number.isFinite(amount)) { line.amount += amount; line.priced = true; }
      else if (Number.isFinite(price) && String(r.price ?? '').trim() !== '') { line.amount += qty * price; line.priced = true; }
      lines.set(key, line);
    }
    const counted = [];
    const noEf = [];
    const unknown = [];
    const unitWrong = [];
    for (const l of lines.values()) {
      const m = mat.get(l.material);
      if (!m) { unknown.push(l); continue; }
      const e = m.ef_ref_id ? ref.get(m.ef_ref_id) : null;
      if (!e || e.total == null || !m.factor || m.status !== 'Active') { noEf.push({ ...l, name: m.name }); continue; }
      if (l.unit && m.sap_unit && unitKey(l.unit) !== unitKey(m.sap_unit)) { unitWrong.push({ ...l, name: m.name, sap_unit: m.sap_unit }); continue; }
      const tco2e = Math.round(((l.qty * Number(m.factor) * Number(e.total)) / 1000) * 1e6) / 1e6;
      const amount = l.priced ? l.amount : m.price != null ? l.qty * Number(m.price) : null;
      counted.push({ month, department: l.department, material: l.material, name: m.name, qty: Math.round(l.qty * 1e6) / 1e6, unit: l.unit || m.sap_unit, factor: Number(m.factor),
        ef_ref_id: e.id, source: e.name.replace(/^-\s*/, ''), ef_unit: e.unit, kgco2e: Number(e.total), scope_code: m.scope_code, tco2e, uploaded_by: req.user.employeeId,
        ...(m.kind ? { kind: m.kind } : {}), ...(ccCols ? { costcenter: l.costcenter, amount: amount == null ? null : Math.round(amount * 100) / 100, grp: m.grp ?? null } : {}) });
    }
    const byQty = (list) => list.sort((x, y) => y.qty - x.qty).slice(0, 300);
    const total = Math.round(counted.reduce((sum, c) => sum + c.tco2e, 0) * 1000) / 1000;
    if (req.body?.save === true) {
      must(await tx.from(t.materialUse).delete().eq('month', month));
      for (let i = 0; i < counted.length; i += 500) must(await tx.from(t.materialUse).insert(counted.slice(i, i + 500)));
      await logRev(t, req, 'Usage วัสดุ (SAP)', month.slice(0, 7), `วาง Usage ${input.length} บรรทัด คิดได้ ${counted.length} รายการ ${total} tCO2e`);
    }
    res.json({ ok: true, saved: req.body?.save === true, month, lines: lines.size, skipped, counted: counted.length, tco2e: total,
      noEf: { count: noEf.length, top: byQty(noEf) }, unknown: { count: unknown.length, top: byQty(unknown) }, unitWrong: { count: unitWrong.length, top: byQty(unitWrong) } });
  });
  // Dashboard > Usage (SAP) (ผู้ใช้กำหนด 2026-11-02): one month (or the year) of the SAP Usage that was counted —
  // per costcenter tCO2e + เงิน (บาท) most first, and the Top 5 materials by tCO2e
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
    const r6 = (v) => Math.round(v * 1e6) / 1e6;
    const r2 = (v) => Math.round(v * 100) / 100;
    const group = (keyOf, make) => Object.values(list.reduce((acc, r) => {
      const key = keyOf(r);
      const g = (acc[key] = acc[key] || { ...make(r), tco2e: 0, amount: 0, priced: 0, items: new Set() });
      g.tco2e += Number(r.tco2e);
      if (r.amount != null) { g.amount += Number(r.amount); g.priced += 1; }
      g.items.add(r.material);
      return acc;
    }, {})).map((g) => ({ ...g, tco2e: r6(g.tco2e), amount: g.priced ? r2(g.amount) : null, items: g.items.size, priced: undefined }));
    const ccs = group((r) => r.costcenter || r.department || '', (r) => {
      const c = centerOf.get(String(r.costcenter || '').toUpperCase());
      return { costcenter: r.costcenter || '', name: c?.object_name || '', department: r.department || c?.department || '' };
    }).sort((a, b) => b.tco2e - a.tco2e);
    const top = group((r) => r.material, (r) => ({ material: r.material, name: r.name, unit: r.unit, qty: 0 }));
    const qtyOf = list.reduce((acc, r) => acc.set(r.material, (acc.get(r.material) || 0) + Number(r.qty)), new Map());
    const byMonth = months.map((m) => {
      const of = rows.filter((r) => r.month === m);
      return { month: m, tco2e: r6(of.reduce((s, r) => s + Number(r.tco2e), 0)), amount: r2(of.reduce((s, r) => s + Number(r.amount || 0), 0)) };
    });
    res.json({ year, month, months: byMonth, costcenter: rows.some((r) => r.costcenter), costcenters: ccs,
      top: top.map((x) => ({ ...x, qty: r6(qtyOf.get(x.material) || 0) })).sort((a, b) => b.tco2e - a.tco2e).slice(0, 5),
      total: { tco2e: r6(list.reduce((s, r) => s + Number(r.tco2e), 0)), amount: r2(list.reduce((s, r) => s + Number(r.amount || 0), 0)), lines: list.length } });
  });
  route('delete', '/api/act/:activity/cfo/material-usage/:month', async (req, res, activity, t) => {
    if (!(await requireAdminNow(req, res, activity))) return;
    const month = monthOf(req.params.month);
    if (!month) return fail(res, 400, 'เดือนไม่ถูกต้อง');
    must(await tx.from(t.materialUse).delete().eq('month', month));
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
      .filter((c) => !/^:(sep|x)/.test(c.code.slice(base.length)));
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
    const { row, error } = await activityInput(t, req.body || {});
    if (error) return fail(res, 400, error);
    const current = must(await tx.from(t.activity).select('*').eq('id', Number(req.params.id)).maybeSingle());
    if (!current) return fail(res, 404, 'ไม่พบกิจกรรม');
    must(await tx.from(t.activity).update(row).eq('id', current.id));
    // a 3-3 line added to an activity also counts for the months already recorded without one (ผู้ใช้กำหนด 2026-11-03)
    if (row.ef3_id && row.ef3_id !== current.ef3_id) must(await tx.from(t.entry).update({ ef3_id: row.ef3_id }).eq('activity_id', current.id).is('ef3_id', null));
    await logRev(t, req, 'กิจกรรม', `${current.department} · ${current.name}`, changes(current, row, Object.keys(row)));
    res.json({ ok: true });
  });
  // Fill the 3-3 line of every fuel activity that has none (ผู้ใช้กำหนด 2026-11-03), the pick the activity form makes:
  // Diesel / B7 → EF CFP น้ำมันดีเซล, Gasohol / gasoline → แก๊สโซลีน, LPG → ก๊าซหุงต้ม (กลั่น) · litres × density (Fuel Properties)
  // · the months already recorded get it too. Scope 1 (1-1, 1-2) and Scope 3 (not 3-3); electricity and refrigerants are left.
  const FUEL_UP = { Diesel: [/^น้ำมันดีเซล/], Gasoline: [/^แก๊สโซลีน$/], LPG: [/^ก๊าซหุงต้ม$/, /กลั่น/] };
  const fuelOf = (name) => (/diesel|ดีเซล|\bB\d+\b/i.test(name) ? 'Diesel' : /gasohol|gasoline|เบนซิน|โซฮอล|\bE\d+\b/i.test(name) ? 'Gasoline' : /LPG|ก๊าซหุงต้ม/i.test(name) ? 'LPG' : null);
  const litre = (u) => /^(l|liter|litre|ลิตร)$/i.test(String(u || '').trim());
  route('post', '/api/act/:activity/cfo/activities/fill-ef3', async (req, res, activity, t) => {
    if (!(await requireAdminNow(req, res, activity))) return;
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
      if (a.ef3_id || !e || a.calc === 'septic' || e.hfc || e.other) continue;
      if (!(['1-1', '1-2'].includes(e.scope_code) || (e.scope_code?.startsWith('3-') && e.scope_code !== '3-3'))) continue;
      const ref = refById.get(e.ref_id);
      if (ref && (ref.sheet !== 'energy' || ref.grp === 'Electricity')) continue;
      const fuel = fuelOf(ref?.name || e.name);
      if (!fuel) continue;
      const [name, detail] = FUEL_UP[fuel];
      const up = refs.find((r) => r.sheet === 'cfp' && name.test(r.name) && (!detail || detail.test(r.formula || '')) && r.total != null);
      const density = refs.find((r) => r.sheet === 'fuel' && r.grp === 'Density' && r.name === fuel)?.total;
      const same = up && String(up.unit).toLowerCase() === String(e.unit).toLowerCase();
      if (!up || (!same && !(litre(e.unit) && String(up.unit).toLowerCase() === 'kg' && density))) { skipped.push(`${a.department} · ${a.name} ${a.detail || ''}`.trim()); continue; }
      const made = await efFromRef(t, up.id, '3-3', false, same ? null : { factor: Number(density), unit: e.unit });
      if (made.error) { skipped.push(`${a.department} · ${a.name}: ${made.error}`); continue; }
      must(await tx.from(t.activity).update({ ef3_id: made.id }).eq('id', a.id));
      must(await tx.from(t.entry).update({ ef3_id: made.id }).eq('activity_id', a.id).is('ef3_id', null));
      done.push(a.id);
    }
    if (done.length) await logRev(t, req, 'กิจกรรม', 'เติม 3-3', `เติม EF การได้มาของเชื้อเพลิง (3-3) ให้ ${done.length} กิจกรรม`);
    res.json({ ok: true, filled: done.length, skipped });
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
    must(await tx.from(t.setting).upsert([{ key: `company_photo${slot}`, value: url }], { onConflict: 'key' }));
    res.status(201).json({ url });
  });

  route('put', '/api/act/:activity/cfo/settings', async (req, res, activity, t) => {
    if (!(await requireAdminNow(req, res, activity))) return;
    const rows = Object.entries(req.body || {}).filter(([k]) => settingKey(k)).map(([key, value]) => ({ key, value: String(value ?? '').trim().slice(0, 1000) }));
    if (!rows.length) return fail(res, 400, 'ไม่มีข้อมูลให้บันทึก');
    const before = await settingsOf(t);
    must(await tx.from(t.setting).upsert(rows, { onConflict: 'key' }));
    const after = Object.fromEntries(rows.map((r) => [r.key, r.value]));
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
    const [entries, activities, efs, gwps, scopes, matUse] = await Promise.all([
      fetchAll(() => tx.from(t.entry).select('*').gte('month', `${year}-01-01`).lte('month', `${year}-12-01`).order('id')),
      fetchAll(() => tx.from(t.activity).select('id,department,name,detail,calc').order('id')),
      fetchAll(() => tx.from(t.ef).select('*').order('id')),
      fetchAll(() => tx.from(t.gwp).select('*')),
      fetchAll(() => tx.from(t.cfoScope).select('code,scope,name')),
      // before db/act/cfo.sql adds tx_cfo_material the report still works without it
      fetchAll(() => tx.from(t.materialUse).select('*').gte('month', `${year}-01-01`).lte('month', `${year}-12-01`)).catch(() => [])
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
    }).concat(Object.values(matUse.filter((u) => !department || u.department === department).reduce((acc, u) => {
      const key = `${u.scope_code}|${u.grp || u.kind}|${u.department}|${u.source}|${u.ef_unit}|${u.kgco2e}`;
      const g = (acc[key] = acc[key] || { ...u, qty: 0, tco2e: 0, items: new Set() });
      g.qty += Number(u.qty) * Number(u.factor);
      g.tco2e += Number(u.tco2e);
      g.items.add(u.material);
      return acc;
    }, {})).map((g) => {
      const s = scope.get(g.scope_code) || {};
      const none = { co2: 0, ch4_fossil: 0, ch4: 0, n2o: 0, sf6: 0, nf3: 0 };
      return { group: `s${s.scope}`, scope: s.scope, scope_code: g.scope_code, scope_name: s.name, department: g.department || '', activity: `${g.grp || MAT_KINDS[g.kind] || 'Usage'} (SAP)`, detail: `${g.items.size} รายการ`,
        source: g.source, unit: g.ef_unit, qty: r6(g.qty), ef: { ...none, hfc: 0, hfc_gwp: null, pfc: 0, pfc_gwp: null, other: 0, other_gwp: 0 }, total_ef: Number(g.kgco2e),
        source_type: null, substitute: null, reference: null, ton: { ...none }, tco2e: { ...none, hfc: 0, pfc: 0, other: 0 }, total: r6(g.tco2e) };
    })).sort((x, y) => x.scope_code.localeCompare(y.scope_code, 'en', { numeric: true }) || x.department.localeCompare(y.department) || x.activity.localeCompare(y.activity));
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
