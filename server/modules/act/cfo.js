import { mx, tx } from '../../core/db.js';
import { fail } from '../../core/http.js';
import { accessOf, actRoute, dateOf, fetchAll, imageBytes, must, namesOf, requireAdmin, yearOf } from './common.js';

// CFO (Carbon Footprint for Organization): Dashboard totals, monthly entry, and master data (EF, activities, company).
// Tables: db/act/cfo.sql (scripts/act-sql.js cfoSql) · spec: docs/specs/act-cfo.md
export const CFO_ON = ['cfo'];
const SETTING_KEYS = ['company_name', 'company_address', 'company_area', 'company_business', 'company_customers', 'company_employees', 'company_updated',
  'company_photo1', 'company_photo2', 'company_register', 'base_year', 'target_percent', 'septic_bod', 'septic_b0', 'septic_mcf', 'septic_i'];
// production_<year> = pieces produced that year (Carbon intensity = tCO2e / pieces)
const settingKey = (k) => SETTING_KEYS.includes(k) || /^production_\d{4}$/.test(k);
// Values an EF keeps once entries use it (Fr-04.1 gas columns included).
const EF_NUMBERS = ['kgco2e', 'co2', 'ch4_fossil', 'ch4', 'n2o', 'sf6', 'nf3', 'hfc', 'hfc_gwp', 'pfc', 'pfc_gwp', 'other', 'other_gwp', 'co2_bio'];
const EF_VALUES = [...EF_NUMBERS, 'unit', 'scope_code', 'separate'];
const EF_SOURCES = ['self', 'supplier', 'th_lci', 'tgo', 'thai_res', 'int_db', 'other'];
const GWP_GASES = ['co2', 'ch4_fossil', 'ch4', 'n2o', 'sf6', 'nf3'];
// mt_cfo_ef_ref: energy = EF ต่อหน่วย · chemical = GWP สารเคมี · ipcc = EF ต่อ TJ · fuel = ค่าความร้อน / ความหนาแน่น / ตัวแปลงหน่วย · cfp = EF ของ CFP
const REF_SHEETS = ['energy', 'chemical', 'ipcc', 'fuel', 'cfp'];
// tables an activity can take its EF from (per unit of what it records; IPCC is per TJ and fuel holds properties)
const REF_PICK = ['energy', 'chemical', 'cfp'];
const REF_NUMBERS = ['co2', 'ch4_fossil', 'ch4', 'n2o', 'total', 'ratio'];
// TGO Fr-03.2 criteria as % scores (e.g. 5.00), like the user's sheet: significant = has a source and scores on at least one.
export const S3_CRITERIA = ['magnitude', 'influence', 'risk', 'sector', 'outsourcing', 'engagement'];
// 0–100 with 2 decimals (an old ✓ / × column reads true / false = 1 / 0).
export const s3Score = (v) => Math.min(100, Math.max(0, Math.round((Number(v) || 0) * 100) / 100));

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
    const settings = await settingsOf(t);
    const baseYear = yearOf(settings.base_year, 0) || null;
    const compareYear = baseYear && baseYear !== year ? baseYear : year - 1;
    const target = Number(settings.target_percent ?? 5) || 0;
    const rowsOf = (y) => fetchAll(() => {
      let q = tx.from(t.entryView).select('*').gte('month', `${y}-01-01`).lte('month', `${y}-12-01`).order('id');
      if (department) q = q.eq('department', department);
      return q;
    });
    // รายงานแยก (EF separate) stays out of every Scope total and is reported on its own (Fr-05 "อื่นๆ").
    const [curAll, baseAll] = await Promise.all([rowsOf(year), rowsOf(compareYear)]);
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
    const [access, settings, activities, efs, scopes, gwp, entries, details] = await Promise.all([
      accessOf(req, activity, year),
      settingsOf(t),
      fetchAll(() => tx.from(t.activity).select('id,department,name,detail,calc,status,ef_id,gwp_code').order('id')),
      fetchAll(() => tx.from(t.ef).select('id,scope_code,kind,name,unit,kgco2e').order('id')),
      fetchAll(() => tx.from(t.cfoScope).select('code,name').order('code')),
      fetchAll(() => tx.from(t.gwp).select('code,ch4').order('code')),
      fetchAll(() => tx.from(t.entryView).select('*').gte('month', `${year}-01-01`).lte('month', `${year}-12-01`).order('id')).then((list) => list.filter((e) => (e.part || 'main') === 'main')),
      fetchAll(() => tx.from(t.entry).select('id,status,inputs,doc,remark,updated_at,updated_by').gte('month', `${year}-01-01`).lte('month', `${year}-12-01`).order('id'))
    ]);
    const efById = new Map(efs.map((e) => [e.id, e]));
    const scopeName = new Map(scopes.map((s) => [s.code, s.name]));
    const gwpCh4 = new Map(gwp.map((g) => [g.code, g.ch4]));
    const detailOf = new Map(details.map((d) => [d.id, d]));
    const category = (ef) => `${scopeName.get(ef.scope_code) || ef.scope_code || '-'}${ef.scope_code?.startsWith('1-') && ef.kind ? `(${ef.kind})` : ''}`;
    res.json({
      year,
      due,
      admin: access.admin,
      departments: access.departments,
      septic: Object.fromEntries(Object.entries(settings).filter(([k]) => k.startsWith('septic_'))),
      materials: await usageBySection(t, year),
      rows: activities.filter((a) => a.status === 'Active' || entries.some((e) => e.activity_id === a.id)).map((a) => {
        const list = entries.filter((e) => e.activity_id === a.id);
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
    const act = must(await tx.from(t.activity).select('department').eq('id', entry.activity_id).single());
    const access = await accessOf(req, activity, Number(entry.month.slice(0, 4)));
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
    const [scopes, gwp, ef, refs, activities, used, settings] = await Promise.all([
      fetchAll(() => tx.from(t.cfoScope).select('*').order('scope').order('code')),
      fetchAll(() => tx.from(t.gwp).select('*').order('code')),
      fetchAll(() => tx.from(t.ef).select('*').order('scope_code').order('id')),
      fetchAll(() => tx.from(t.efRef).select('*').order('sheet').order('sort_no').order('id')),
      fetchAll(() => tx.from(t.activity).select('*').order('department').order('id')),
      fetchAll(() => tx.from(t.entry).select('ef_id,activity_id,gwp_code').order('id')),
      settingsOf(t)
    ]);
    const usedEf = new Set(used.map((u) => u.ef_id));
    const usedGwp = new Set([...used, ...activities].map((u) => u.gwp_code));
    const usedAct = new Set(used.map((u) => u.activity_id));
    res.json({
      admin: (await accessOf(req, activity, thisYear())).admin,
      scopes, settings, refs,
      gwp: gwp.map((g) => ({ ...g, used: usedGwp.has(g.code) })),
      ef: ef.map((e) => ({ ...e, used: usedEf.has(e.id) })),
      activities: activities.map((a) => ({ ...a, used: usedAct.has(a.id) }))
    });
  });

  const efInput = (b) => {
    const row = { scope_code: text(b.scope_code, 10), kind: text(b.kind, 120), name: text(b.name, 300), detail: text(b.detail, 1000), unit: text(b.unit, 30), reference: text(b.reference, 500), year: numOrNull(b.year), status: b.status === 'Inactive' ? 'Inactive' : 'Active',
      separate: b.separate === true || b.separate === 'true', source_type: EF_SOURCES.includes(b.source_type) ? b.source_type : null, substitute: text(b.substitute, 300) };
    for (const k of EF_NUMBERS) row[k] = numOrNull(b[k]);
    if (!row.scope_code || !row.name || !row.unit) return { error: 'ระบุหมวด ชื่อ และหน่วย' };
    if ([...EF_NUMBERS, 'year'].some((k) => Number.isNaN(row[k]))) return { error: 'ค่าตัวเลขไม่ถูกต้อง' };
    if (row.status === 'Active' && row.kgco2e == null) return { error: 'EF ที่ใช้งานต้องมีค่า kgCO2e ต่อหน่วย' };
    return { row };
  };
  route('post', '/api/act/:activity/cfo/ef', async (req, res, activity, t) => {
    if (!(await requireAdmin(req, res, activity, thisYear()))) return;
    const { row, error } = efInput(req.body || {});
    if (error) return fail(res, 400, error);
    must(await tx.from(t.ef).insert(row));
    await logRev(t, req, 'Emission Factor', `${row.scope_code} ${row.name}`, `เพิ่ม EF ${row.kgco2e ?? '-'} kgCO2e/${row.unit}`);
    res.status(201).json({ ok: true });
  });
  // An EF that entries already use keeps its values: add a new row and set the old one Inactive.
  route('patch', '/api/act/:activity/cfo/ef/:id', async (req, res, activity, t) => {
    if (!(await requireAdmin(req, res, activity, thisYear()))) return;
    const id = Number(req.params.id);
    const current = must(await tx.from(t.ef).select('*').eq('id', id).maybeSingle());
    if (!current) return fail(res, 404, 'ไม่พบ EF');
    const { row, error } = efInput(req.body || {});
    if (error) return fail(res, 400, error);
    const used = must(await tx.from(t.entry).select('id').eq('ef_id', id).limit(1)).length > 0;
    if (used && EF_VALUES.some((k) => String(row[k] ?? '') !== String(current[k] ?? ''))) return fail(res, 400, 'EF นี้ถูกใช้แล้ว แก้ค่าไม่ได้ ให้เพิ่ม EF ใหม่แล้วปิดตัวเดิม');
    must(await tx.from(t.ef).update(row).eq('id', id));
    await logRev(t, req, 'Emission Factor', current.code || `${current.scope_code} ${current.name}`, changes(current, row, Object.keys(row)));
    res.json({ ok: true });
  });
  route('delete', '/api/act/:activity/cfo/ef/:id', async (req, res, activity, t) => {
    if (!(await requireAdmin(req, res, activity, thisYear()))) return;
    const id = Number(req.params.id);
    const usedBy = must(await tx.from(t.activity).select('id').eq('ef_id', id).limit(1)).length + must(await tx.from(t.entry).select('id').eq('ef_id', id).limit(1)).length;
    if (usedBy) return fail(res, 400, 'EF นี้ถูกใช้แล้ว ลบไม่ได้ ให้ตั้งเป็น Inactive');
    const gone = must(await tx.from(t.ef).delete().eq('id', id).select('code,scope_code,name'));
    if (gone[0]) await logRev(t, req, 'Emission Factor', gone[0].code || `${gone[0].scope_code} ${gone[0].name}`, 'ลบ EF');
    res.json({ ok: true });
  });

  // ---------- Setting > Emission Factor: GWP + reference tables (EF TGO AR5 V2, ผู้ใช้กำหนด 2026-11-01) ----------
  // A GWP set that activities or entries point at keeps its values (v_cfo_entry reads them live): add a new code instead.
  const gwpInput = (b) => {
    const row = { code: text(b.code, 20), reference: text(b.reference, 500), status: b.status === 'Inactive' ? 'Inactive' : 'Active' };
    for (const k of GWP_GASES) row[k] = numOrNull(b[k]) ?? (k === 'co2' ? 1 : 0);
    if (!row.code) return { error: 'ระบุรหัส GWP (เช่น AR5)' };
    if (GWP_GASES.some((k) => Number.isNaN(row[k]) || row[k] < 0)) return { error: 'ค่า GWP ไม่ถูกต้อง' };
    return { row };
  };
  const gwpUsed = async (t, code) => must(await tx.from(t.activity).select('id').eq('gwp_code', code).limit(1)).length + must(await tx.from(t.entry).select('id').eq('gwp_code', code).limit(1)).length > 0;
  route('post', '/api/act/:activity/cfo/gwp', async (req, res, activity, t) => {
    if (!(await requireAdmin(req, res, activity, thisYear()))) return;
    const { row, error } = gwpInput(req.body || {});
    if (error) return fail(res, 400, error);
    if (must(await tx.from(t.gwp).select('code').eq('code', row.code).maybeSingle())) return fail(res, 400, `มี GWP ${row.code} แล้ว`);
    must(await tx.from(t.gwp).insert(row));
    await logRev(t, req, 'GWP', row.code, `เพิ่ม GWP CH₄ ${row.ch4} · N₂O ${row.n2o}`);
    res.status(201).json({ ok: true });
  });
  route('patch', '/api/act/:activity/cfo/gwp/:code', async (req, res, activity, t) => {
    if (!(await requireAdmin(req, res, activity, thisYear()))) return;
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
    if (!(await requireAdmin(req, res, activity, thisYear()))) return;
    if (await gwpUsed(t, req.params.code)) return fail(res, 400, 'GWP นี้ถูกใช้แล้ว ลบไม่ได้ ให้ตั้งเป็น Inactive');
    const gone = must(await tx.from(t.gwp).delete().eq('code', req.params.code).select('code'));
    if (gone[0]) await logRev(t, req, 'GWP', gone[0].code, 'ลบ GWP');
    res.json({ ok: true });
  });

  // Reference rows are for reading and copying only (nothing is computed from them), so they stay editable.
  // Total left empty with gas values = CO₂ + gas × GWP of the Active set (AR5 first), like the sheet's formula.
  const refInput = async (t, b) => {
    const row = { sheet: REF_SHEETS.includes(b.sheet) ? b.sheet : null, grp: text(b.grp, 120), name: text(b.name, 300), formula: text(b.formula, 120), unit: text(b.unit, 30),
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
  route('post', '/api/act/:activity/cfo/ref', async (req, res, activity, t) => {
    if (!(await requireAdmin(req, res, activity, thisYear()))) return;
    const { row, error } = await refInput(t, req.body || {});
    if (error) return fail(res, 400, error);
    if (row.sort_no == null) {
      const last = must(await tx.from(t.efRef).select('sort_no').eq('sheet', row.sheet).order('sort_no', { ascending: false }).limit(1));
      row.sort_no = (last[0]?.sort_no || 0) + 1;
    }
    must(await tx.from(t.efRef).insert(row));
    res.status(201).json({ ok: true });
  });
  route('patch', '/api/act/:activity/cfo/ref/:id', async (req, res, activity, t) => {
    if (!(await requireAdmin(req, res, activity, thisYear()))) return;
    const current = must(await tx.from(t.efRef).select('id,sort_no').eq('id', Number(req.params.id)).maybeSingle());
    if (!current) return fail(res, 404, 'ไม่พบรายการ');
    const { row, error } = await refInput(t, req.body || {});
    if (error) return fail(res, 400, error);
    if (row.sort_no == null) row.sort_no = current.sort_no;
    must(await tx.from(t.efRef).update(row).eq('id', current.id));
    res.json({ ok: true });
  });
  route('delete', '/api/act/:activity/cfo/ref/:id', async (req, res, activity, t) => {
    if (!(await requireAdmin(req, res, activity, thisYear()))) return;
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
    const [rows, uses] = await Promise.all([
      fetchAll(() => tx.from(t.material).select('*').order('material')),
      fetchAll(() => tx.from(t.materialUse).select('month,tco2e').order('month'))
    ]);
    const months = Object.values(uses.reduce((acc, u) => {
      const m = (acc[u.month] = acc[u.month] || { month: u.month, rows: 0, tco2e: 0 });
      m.rows += 1;
      m.tco2e += Number(u.tco2e);
      return acc;
    }, {})).map((m) => ({ ...m, tco2e: Math.round(m.tco2e * 1000) / 1000 }));
    res.json({ admin: (await accessOf(req, activity, thisYear())).admin, rows, months, sections: await usageBySection(t, yearOf(req.query.year) || thisYear()) });
  });
  // partial (grid paste): a blank cell keeps what the material already has, so pasting only EF + factor does not
  // wipe the SAP unit that the Usage check compares against
  const matInput = async (t, b, partial = false) => {
    const given = (k) => b[k] !== undefined && !(partial && String(b[k] ?? '').trim() === '');
    const row = { material: matCode(b.material) };
    if (!row.material) return { error: 'ระบุรหัสวัสดุ' };
    if (given('name')) row.name = text(b.name, 300);
    if (given('sap_unit')) row.sap_unit = text(b.sap_unit, 20);
    if (given('status')) row.status = b.status === 'Inactive' ? 'Inactive' : 'Active';
    if (given('kind')) {
      row.kind = String(b.kind).trim();
      if (!MAT_KINDS[row.kind]) row.kind = Object.keys(MAT_KINDS).find((k) => MAT_KINDS[k] === row.kind) || null;
      if (!row.kind) return { error: 'ประเภทต้องเป็น Usage / วัตถุดิบ / อื่นๆ' };
    }
    if (given('ef_ref_id') || given('ef_name')) {
      if (b.ef_name !== undefined && String(b.ef_name || '').trim()) {
        const want = String(b.ef_name).trim().toLowerCase();
        const refs = must(await tx.from(t.efRef).select('id,name,sheet,unit,total').in('sheet', MAT_SHEETS));
        const hit = refs.find((r) => r.name.replace(/^-\s*/, '').trim().toLowerCase() === want && r.unit && r.total != null);
        if (!hit) return { error: `ไม่พบ EF ชื่อ "${b.ef_name}" ในตาราง EF CFP / EF พลังงาน` };
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
    if (!(await requireAdmin(req, res, activity, thisYear()))) return;
    const list = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 2000) : [req.body || {}];
    const rows = [];
    for (const [i, b] of list.entries()) {
      const { row, error } = await matInput(t, b, true);
      if (error) return fail(res, 400, list.length > 1 ? `แถว ${i + 1}: ${error}` : error);
      const current = must(await tx.from(t.material).select('*').eq('material', row.material).maybeSingle());
      if (current) must(await tx.from(t.material).update(row).eq('material', row.material));
      else rows.push({ name: row.material, ...row, ...(row.ef_ref_id && row.factor === undefined ? { factor: 1 } : {}) });
    }
    if (rows.length) must(await tx.from(t.material).insert(rows));
    await logRev(t, req, 'วัสดุ (SAP)', list.length === 1 ? matCode(list[0].material) : `${list.length} รายการ`, 'เพิ่ม / แก้วัสดุและ EF');
    res.status(201).json({ ok: true, count: list.length });
  });
  route('patch', '/api/act/:activity/cfo/materials/:material', async (req, res, activity, t) => {
    if (!(await requireAdmin(req, res, activity, thisYear()))) return;
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
    if (!(await requireAdmin(req, res, activity, thisYear()))) return;
    if (must(await tx.from(t.materialUse).select('id').eq('material', req.params.material).limit(1)).length) return fail(res, 400, 'วัสดุนี้มี Usage แล้ว ลบไม่ได้ ให้ตั้งเป็น Inactive');
    must(await tx.from(t.material).delete().eq('material', req.params.material));
    res.json({ ok: true });
  });

  // Usage of one month pasted from SAP: rows [{ material, qty, unit, department }] (department may be a cost center).
  // save = false only checks: counted / unit not matching / no EF / not in the list. save = true replaces that month.
  route('post', '/api/act/:activity/cfo/material-usage', async (req, res, activity, t) => {
    if (!(await requireAdmin(req, res, activity, thisYear()))) return;
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
      const key = `${department}|${code}|${unitKey(r.unit)}`;
      const line = lines.get(key) || { department, material: code, unit: text(r.unit, 20), qty: 0 };
      line.qty += qty;
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
      counted.push({ month, department: l.department, material: l.material, name: m.name, qty: Math.round(l.qty * 1e6) / 1e6, unit: l.unit || m.sap_unit, factor: Number(m.factor),
        ef_ref_id: e.id, source: e.name.replace(/^-\s*/, ''), ef_unit: e.unit, kgco2e: Number(e.total), scope_code: m.scope_code, tco2e, uploaded_by: req.user.employeeId,
        ...(m.kind ? { kind: m.kind } : {}) });
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
  route('delete', '/api/act/:activity/cfo/material-usage/:month', async (req, res, activity, t) => {
    if (!(await requireAdmin(req, res, activity, thisYear()))) return;
    const month = monthOf(req.params.month);
    if (!month) return fail(res, 400, 'เดือนไม่ถูกต้อง');
    must(await tx.from(t.materialUse).delete().eq('month', month));
    await logRev(t, req, 'Usage วัสดุ (SAP)', month.slice(0, 7), 'ลบ Usage ทั้งเดือน');
    res.json({ ok: true });
  });

  // An activity picks its EF from Setting > Emission Factor (EF พลังงาน / GWP สารเคมี / EF CFP, ผู้ใช้กำหนด 2026-11-01):
  // the reference row is copied into mt_cfo_ef (code ref:<id>:<scope>) because entries keep the EF they were saved with.
  // The copy is reused while the reference values stay the same; after an edit a new copy is made, old entries keep theirs.
  const efFromRef = async (t, refId, scopeCode, direct = false) => {
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
    const base = `ref:${ref.id}:${scopeCode}${direct ? ':sep' : ''}`;
    const copies = must(await tx.from(t.ef).select('id,code,kgco2e,unit,co2_bio').like('code', `${base}*`).order('id', { ascending: false }))
      .filter((c) => direct || !c.code.slice(base.length).startsWith(':sep'));
    const same = copies.find((c) => c.unit === row.unit && Number(c.kgco2e) === row.kgco2e && Number(c.co2_bio ?? 0) === Number(row.co2_bio ?? 0));
    if (same) return { id: same.id };
    row.code = copies.length ? `${base}:${copies.length + 1}` : base;
    const made = must(await tx.from(t.ef).insert(row).select('id'));
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
        const up = await efFromRef(t, Number(id), '3-3');
        if (up.error) return up;
        row.ef3_id = up.id;
      } else row.ef3_id = kind === 'ef' && Number(id) ? Number(id) : null;
    }
    return { row };
  };
  route('post', '/api/act/:activity/cfo/activities', async (req, res, activity, t) => {
    if (!(await requireAdmin(req, res, activity, thisYear()))) return;
    const { row, error } = await activityInput(t, req.body || {});
    if (error) return fail(res, 400, error);
    must(await tx.from(t.activity).insert(row));
    await logRev(t, req, 'กิจกรรม', `${row.department} · ${row.name}`, 'เพิ่มกิจกรรม');
    res.status(201).json({ ok: true });
  });
  route('patch', '/api/act/:activity/cfo/activities/:id', async (req, res, activity, t) => {
    if (!(await requireAdmin(req, res, activity, thisYear()))) return;
    const { row, error } = await activityInput(t, req.body || {});
    if (error) return fail(res, 400, error);
    const current = must(await tx.from(t.activity).select('*').eq('id', Number(req.params.id)).maybeSingle());
    if (!current) return fail(res, 404, 'ไม่พบกิจกรรม');
    must(await tx.from(t.activity).update(row).eq('id', current.id));
    await logRev(t, req, 'กิจกรรม', `${current.department} · ${current.name}`, changes(current, row, Object.keys(row)));
    res.json({ ok: true });
  });
  route('delete', '/api/act/:activity/cfo/activities/:id', async (req, res, activity, t) => {
    if (!(await requireAdmin(req, res, activity, thisYear()))) return;
    const id = Number(req.params.id);
    if (must(await tx.from(t.entry).select('id').eq('activity_id', id).limit(1)).length) return fail(res, 400, 'กิจกรรมนี้มีข้อมูลแล้ว ลบไม่ได้ ให้ตั้งเป็น Inactive');
    const gone = must(await tx.from(t.activity).delete().eq('id', id).select('department,name'));
    if (gone[0]) await logRev(t, req, 'กิจกรรม', `${gone[0].department} · ${gone[0].name}`, 'ลบกิจกรรม');
    res.json({ ok: true });
  });

  route('post', '/api/act/:activity/cfo/photo', async (req, res, activity, t) => {
    if (!(await requireAdmin(req, res, activity, thisYear()))) return;
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
    if (!(await requireAdmin(req, res, activity, thisYear()))) return;
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
    const [scopes, rows, access] = await Promise.all([
      fetchAll(() => tx.from(t.cfoScope).select('code,name,name_th').eq('scope', 3)),
      fetchAll(() => tx.from(t.s3Assess).select('*').lte('year', year).order('year', { ascending: false })),
      accessOf(req, activity, year)
    ]);
    const fromYear = rows.some((r) => r.year === year) ? year : rows[0]?.year || null;
    const byCode = new Map(rows.filter((r) => r.year === fromYear).map((r) => [r.scope_code, r]));
    const sorted = scopes.sort((a, b) => Number(a.code.split('-')[1]) - Number(b.code.split('-')[1]));
    res.json({
      year, fromYear, admin: access.admin, criteria: S3_CRITERIA,
      rows: sorted.map((s) => {
        const r = byCode.get(s.code) || { has_source: true };
        const marks = Object.fromEntries(S3_CRITERIA.map((k) => [k, s3Score(r[k])]));
        return { scope_code: s.code, name: s.name, name_th: s.name_th, has_source: r.has_source !== false, ...marks, remark: r.remark || '',
          significant: r.has_source !== false && S3_CRITERIA.some((k) => marks[k] > 0), updated_by: r.updated_by || null, updated_at: r.updated_at || null };
      })
    });
  });
  route('put', '/api/act/:activity/cfo/s3', async (req, res, activity, t) => {
    const year = yearOf(req.body?.year, 0);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    if (!(await requireAdmin(req, res, activity, year))) return;
    const list = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const rows = list.filter((r) => /^3-\d{1,2}$/.test(String(r?.scope_code))).map((r) => ({
      year, scope_code: r.scope_code, has_source: r.has_source !== false, remark: text(r.remark, 1000),
      ...Object.fromEntries(S3_CRITERIA.map((k) => [k, s3Score(r[k])])), updated_by: req.user.employeeId, updated_at: new Date().toISOString()
    }));
    if (!rows.length) return fail(res, 400, 'ไม่มีข้อมูลให้บันทึก');
    const before = new Map((await fetchAll(() => tx.from(t.s3Assess).select('*').eq('year', year))).map((r) => [r.scope_code, r]));
    const saved = await tx.from(t.s3Assess).upsert(rows, { onConflict: 'year,scope_code' });
    // 22P02: the criteria columns are still ✓ / × (boolean) until db/act/cfo.sql is run again
    if (saved.error?.code === '22P02') return fail(res, 503, 'เกณฑ์ Fr-03.2 เป็นคะแนน % แล้ว ต้องรัน db/act/cfo.sql ใน Tx Data อีกรอบก่อนบันทึก');
    must(saved);
    const changed = rows.map((r) => {
      const d = changes(before.get(r.scope_code), r, ['has_source', ...S3_CRITERIA, 'remark']);
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
      const key = `${u.scope_code}|${u.kind}|${u.department}|${u.source}|${u.ef_unit}|${u.kgco2e}`;
      const g = (acc[key] = acc[key] || { ...u, qty: 0, tco2e: 0, items: new Set() });
      g.qty += Number(u.qty) * Number(u.factor);
      g.tco2e += Number(u.tco2e);
      g.items.add(u.material);
      return acc;
    }, {})).map((g) => {
      const s = scope.get(g.scope_code) || {};
      const none = { co2: 0, ch4_fossil: 0, ch4: 0, n2o: 0, sf6: 0, nf3: 0 };
      return { group: `s${s.scope}`, scope: s.scope, scope_code: g.scope_code, scope_name: s.name, department: g.department || '', activity: `${MAT_KINDS[g.kind] || 'Usage'} (SAP)`, detail: `${g.items.size} รายการ`,
        source: g.source, unit: g.ef_unit, qty: r6(g.qty), ef: { ...none, hfc: 0, hfc_gwp: null, pfc: 0, pfc_gwp: null, other: 0, other_gwp: 0 }, total_ef: Number(g.kgco2e),
        source_type: null, substitute: null, reference: null, ton: { ...none }, tco2e: { ...none, hfc: 0, pfc: 0, other: 0 }, total: r6(g.tco2e) };
    })).sort((x, y) => x.scope_code.localeCompare(y.scope_code, 'en', { numeric: true }) || x.department.localeCompare(y.department) || x.activity.localeCompare(y.activity));
    res.json({ year, baseYear, department, gwp: gwps.find((g) => g.code === 'AR5') || gwps[0] || null, rows });
  });

  // บันทึกการปรับปรุง: newest first; admins add a note by hand. No delete.
  route('get', '/api/act/:activity/cfo/revisions', async (req, res, activity, t) => {
    const rows = await fetchAll(() => tx.from(t.revision).select('*').order('at', { ascending: false }).order('id', { ascending: false }));
    const names = await namesOf([...new Set(rows.map((r) => r.by))]);
    res.json({
      admin: (await accessOf(req, activity, thisYear())).admin,
      rows: rows.map((r, i) => ({ ...r, no: rows.length - i, by_name: names.get(String(r.by))?.name || '' }))
    });
  });
  route('post', '/api/act/:activity/cfo/revisions', async (req, res, activity, t) => {
    if (!(await requireAdmin(req, res, activity, thisYear()))) return;
    const area = text(req.body?.area, 120);
    const detail = text(req.body?.detail, 2000);
    if (!area || !detail) return fail(res, 400, 'ระบุส่วนที่แก้และรายละเอียด');
    must(await tx.from(t.revision).insert({ area, ref: text(req.body?.ref, 300), detail, by: req.user.employeeId }));
    res.status(201).json({ ok: true });
  });
}
