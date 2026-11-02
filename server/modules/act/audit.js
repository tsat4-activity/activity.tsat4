import { mx, tx } from '../../core/db.js';
import { fail, cleanTerm } from '../../core/http.js';
import { nameOf } from '../../core/users.js';
import { ACT_UNITS, AUDIT_UNIT, unitsOf, accessOf, actRoute, fetchAll, fetchIn, namesOf, requireAdmin, roundTo, tablesOf, throwIf, yearOf } from './common.js';

// Checklist audits (5S and similar): Dashboard reads for everyone, Setting writes for the year's admins.
// Tables (Tx Data, one set per activity): db/act/<activity>.sql via tablesOf() · rules: docs/specs/act-5s.md
const AREA_TYPES = ['โรงงาน', 'สำนักงาน'];
const ROLES = ['admin', 'chairman', 'vice', 'advisor', 'smart', 'auditor', 'owner', 'member'];
// Area owners and auditors belong to ทีมตรวจประเมิน; plain members of a sub-team need no department.
const AUDIT_ONLY = ['owner', 'auditor'];
const AUDIT_TYPES = ['SELF', 'COMMITTEE'];

// Default 5S master data from inbox/master_5s.xlsx (34 areas + area owners, 17 audit team members, 25 checklist items for 2026).
const SEED_5S_AREAS = [
  ['A01', 'โรงงาน', 'HDF', 'HDF', '2103918'], ['A02', 'โรงงาน', 'SHOP DIE', 'SHOP DIE', '2103411'],
  ['A03', 'โรงงาน', 'SHOP MTN', 'SHOP MTN', '2102396'], ['A04', 'โรงงาน', 'SHOP JIG', 'SHOP JIG', '2101728'],
  ['A05', 'โรงงาน', 'WH,DEL', 'WH,DEL', '2103906'], ['A06', 'โรงงาน', 'RACK', 'RACK', '2101643'],
  ['A07', 'โรงงาน', 'HRM EXT', 'HRM EXT', '2103895'], ['A08', 'โรงงาน', 'QA IQA', 'QA IQA', '2101974'],
  ['A09', 'โรงงาน', 'QA PD1,2', 'QA PD1,2', '2102194'], ['A10', 'โรงงาน', 'QA PD3,4', 'QA PD3,4', '2103864'],
  ['A11', 'โรงงาน', 'LINE C,D,E PD1', 'LINE C,D,E PD1', '2102613'], ['A12', 'โรงงาน', 'LINE A PD1', 'LINE A PD1', '2102695'],
  ['A13', 'โรงงาน', 'LINE B PD1', 'LINE B PD1', '2102613'], ['A14', 'โรงงาน', 'ASSY PD2', 'ASSY PD2', '2101991'],
  ['A15', 'โรงงาน', 'ASSY PD3', 'ASSY PD3', '2101990'], ['A16', 'โรงงาน', 'ASSY PD4', 'ASSY PD4', '2103669'],
  ['A17', 'โรงงาน', 'STO RAW', 'STO RAW', '2102159'], ['A18', 'โรงงาน', 'STO SEMI', 'STO SEMI', '2102159'],
  ['A19', 'โรงงาน', 'STO PUR', 'STO PUR', '2102159'], ['B01', 'สำนักงาน', 'ACC', 'ACC', '2103127'],
  ['B02', 'สำนักงาน', 'HRM', 'HRM', '2102597'], ['B03', 'สำนักงาน', 'QSM,PUR', 'QSM,PUR', '2103270'],
  ['B04', 'สำนักงาน', 'PE', 'PE', '2102652'], ['B05', 'สำนักงาน', 'PLN,STO,SALE', 'PLN,STO,SALE', '2101999'],
  ['B06', 'สำนักงาน', 'PD1,2', 'PD1,2', '2103523'], ['B07', 'สำนักงาน', 'PD3', 'PD3', '2103790'],
  ['B08', 'สำนักงาน', 'PD4,JIG', 'PD4,JIG', '2101861'], ['B09', 'สำนักงาน', 'MTN', 'MTN', '2102600'],
  ['B10', 'สำนักงาน', 'DIE', 'DIE', '2102600'], ['B11', 'สำนักงาน', 'QA', 'QA', '2103724'],
  ['B12', 'สำนักงาน', 'QA CMM1', 'QA CMM1', '2101741'], ['B13', 'สำนักงาน', 'QA CMM2', 'QA CMM2', '2103724'],
  ['B14', 'สำนักงาน', 'CIC', 'CIC', '2102569'], ['B15', 'สำนักงาน', 'WH,DEL', 'WH,DEL', '2103433']
];
const SEED_5S_AUDIT_TEAM = [
  ['2102899', 'chairman', null], ['2103100', 'chairman', null],
  ['2103100', 'auditor', 'A'], ['2102899', 'auditor', 'B'], ['2101861', 'auditor', 'C'],
  ['2101990', 'auditor', 'D'], ['2103396', 'auditor', 'D'], ['2101946', 'auditor', 'E'],
  ['2103570', 'auditor', 'E'], ['2103669', 'auditor', 'F'], ['2103391', 'auditor', 'F'],
  ['2101744', 'auditor', 'G'], ['2103865', 'auditor', 'G'], ['2102901', 'auditor', 'H'],
  ['2103906', 'auditor', 'H'], ['2102396', 'auditor', 'I'], ['2103864', 'auditor', 'I']
];
const SEED_5S_CHECKLIST = [
  [1, 1, 'มีเฉพาะสิ่งของที่จำเป็นในพื้นที่เท่านั้น'], [2, 1, 'สิ่งของที่ไม่จำเป็นถูกแยกออกจากพื้นที่'],
  [3, 1, 'มีการกำจัดหรือเคลื่อนย้ายของที่ไม่ใช้งานตามขั้นตอน'], [4, 1, 'มีการระบุสิ่งของที่ควรกำจัดได้อย่างชัดเจน'],
  [5, 1, 'เครื่องมือ/อุปกรณ์วางตามจุดที่กำหนด'], [6, 2, 'มีป้าย Label หรือ Tag แสดงชื่อและตำแหน่งจัดเก็บ'],
  [7, 2, 'อุปกรณ์ถูกจัดวางอย่างเป็นระเบียบ ใช้งานได้ทันที'], [8, 2, 'มีแผนภาพหรือแผนผังแสดงตำแหน่งจัดเก็บชัดเจน'],
  [9, 2, 'มีระบบแยกประเภทหรือหมวดหมู่ของใช้อย่างชัดเจน'], [10, 2, 'สามารถค้นหาสิ่งของที่จำเป็นได้ภายใน 30 วินาที'],
  [11, 3, 'พื้นที่โดยรวมสะอาด ไม่มีฝุ่น คราบ หรือสิ่งสกปรก'], [12, 3, 'เครื่องมือ/อุปกรณ์สะอาด และดูแลรักษาอย่างเหมาะสม'],
  [13, 3, 'มีตารางทำความสะอาด และมีการบันทึกตามแผน'], [14, 3, 'ไม่มีขยะ/วัสดุเหลือทิ้งในพื้นที่ทำงาน'],
  [15, 3, 'มีผู้รับผิดชอบชัดเจนในการดูแลความสะอาดแต่ละพื้นที่'], [16, 4, 'มีมาตรฐานการทำงาน (WI, SOP, 5S) ติดไว้ชัดเจน'],
  [17, 4, 'พื้นที่มีการทำเส้นแบ่งเขต ป้ายบอกสี และสัญลักษณ์มาตรฐาน'], [18, 4, 'การแต่งกาย PPE เป็นไปตามข้อกำหนด และควบคุมได้จริง'],
  [19, 4, 'ป้ายบ่งชี้/ชื่อเครื่องจักรไม่ลอกจางหรือหลุดหาย'], [20, 4, 'มีการอบรมหรือให้ความรู้เกี่ยวกับ 5ส จากทีมวิชาการ'],
  [21, 5, 'มีการตรวจ Self Audit ตามแผน'], [22, 5, 'มีรายงานผลกรณีประเมินตนเองต่ำกว่าเป้าหมาย'],
  [23, 5, 'มีการแก้ไข Kadai ภายใน 60วัน หรือแผนที่วางไว้'], [24, 5, 'ความร่วมมือ/ตรงต่อเวลาในการรับตรวจประเมิน'],
  [25, 5, 'มีการทบทวน/ปรับปรุงมาตรฐาน 5ส ให้สอดคล้องกับสภาพงาน']
];

let master5sReady = null;
export async function ensure5sMaster(activity) {
  if (activity !== '5s') return;
  if (!master5sReady) master5sReady = seed5sMaster().catch(() => { master5sReady = null; });
  await master5sReady;
}

async function seed5sMaster() {
  const [areaRes, checkRes, teamRes, empRes] = await Promise.all([
    tx.from('mt_5s_area').select('id,code'),
    tx.from('mt_5s_checklist').select('item_no').eq('year', 2026),
    tx.from('mt_5s_team').select('id,employee_id,role,unit,team,area_id').eq('year', 2026),
    mx.from('mt_main_employee').select('employee_id')
  ]);
  if (areaRes.error || checkRes.error || teamRes.error) return;
  let areas = areaRes.data || [];
  const areaCodes = new Set(areas.map((a) => a.code));
  if (SEED_5S_AREAS.some(([code]) => !areaCodes.has(code))) {
    await tx.from('mt_5s_area').upsert(SEED_5S_AREAS.map(([code, area_type, name, section]) => ({ code, area_type, name, section, status: 'Active' })), { onConflict: 'code' });
    const reread = await tx.from('mt_5s_area').select('id,code');
    if (!reread.error) areas = reread.data || [];
  }
  const checkNos = new Set((checkRes.data || []).map((c) => Number(c.item_no)));
  if (SEED_5S_CHECKLIST.some(([item_no]) => !checkNos.has(item_no))) {
    await tx.from('mt_5s_checklist').upsert(SEED_5S_CHECKLIST.map(([item_no, s_group, title]) => ({ year: 2026, item_no, s_group, title, score_max: 5, status: 'Active' })), { onConflict: 'year,item_no' });
  }
  const teamRows = teamRes.data || [];
  const noUnitIds = teamRows.filter((r) => !r.unit && ['owner', 'auditor', 'chairman', 'admin'].includes(r.role)).map((r) => r.id);
  if (noUnitIds.length) await tx.from('mt_5s_team').update({ unit: AUDIT_UNIT }).in('id', noUnitIds);
  const validEmps = new Set((empRes.data || []).map((e) => String(e.employee_id)));
  const canUseEmp = (id) => !validEmps.size || validEmps.has(id);
  const areaIdByCode = new Map(areas.map((a) => [a.code, Number(a.id)]));
  const ownedAreas = new Set(teamRows.filter((r) => r.role === 'owner' && r.area_id).map((r) => Number(r.area_id)));
  const auditKeys = new Set(teamRows.map((r) => `${r.employee_id}:${r.role}:${r.team || ''}`));
  const toInsert = [];
  for (const [code, , , , ownerEmp] of SEED_5S_AREAS) {
    const areaId = areaIdByCode.get(code);
    if (areaId && !ownedAreas.has(areaId) && canUseEmp(ownerEmp)) {
      toInsert.push({ year: 2026, employee_id: ownerEmp, role: 'owner', unit: AUDIT_UNIT, area_id: areaId, status: 'Active' });
    }
  }
  for (const [empId, role, team] of SEED_5S_AUDIT_TEAM) {
    if (!auditKeys.has(`${empId}:${role}:${team || ''}`) && canUseEmp(empId)) {
      toInsert.push({ year: 2026, employee_id: empId, role, unit: AUDIT_UNIT, team, status: 'Active' });
    }
  }
  if (toInsert.length) {
    await Promise.all(toInsert.map((row) => tx.from('mt_5s_team').insert(row)));
  }
}

const round1 = (n) => roundTo(n, 1);
const round2 = (n) => roundTo(n, 2);
const avg = (list) => (list.length ? list.reduce((s, n) => s + Number(n), 0) / list.length : null);
// audited_at is stored in UTC; plans and dashboards use Thai dates.
const bangkok = (ts) => new Date(Date.parse(ts) + 7 * 3600000);
const monthOf = (ts) => bangkok(ts).getUTCMonth() + 1;
const weekOf = (ts) => Math.min(4, Math.floor((bangkok(ts).getUTCDate() - 1) / 7) + 1);

function intIn(value, min, max) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

const areasOf = (activity) => fetchAll(() => tx.from(tablesOf(activity).area).select('id,code,area_type,name,section,status').order('code'));

function auditsOf(activity, year, type) {
  return fetchAll(() => {
    let q = tx.from(tablesOf(activity).audit).select('id,audit_no,audit_type,area_id,team,audited_at,total_score,percent_score,result')
      .eq('year', year).eq('status', 'COMPLETED').order('audited_at').order('id');
    if (AUDIT_TYPES.includes(type)) q = q.eq('audit_type', type);
    return q;
  });
}

const groupsOf = (activity, auditIds) => fetchIn(() => tx.from(tablesOf(activity).group).select('audit_id,s_group,percent'), 'audit_id', auditIds);

async function ownersOf(activity, year, areaIds) {
  const rows = await fetchIn(() => tx.from(tablesOf(activity).team).select('area_id,employee_id').eq('year', year).eq('role', 'owner'), 'area_id', areaIds);
  return new Map(rows.map((row) => [Number(row.area_id), String(row.employee_id)]));
}

// Summary: average % per group over every audit, and the average audit % per month.
export function summarize(audits, groups) {
  const byGroup = new Map();
  for (const g of groups) {
    const n = Number(g.s_group);
    if (!byGroup.has(n)) byGroup.set(n, []);
    byGroup.get(n).push(g.percent);
  }
  const byMonth = Array.from({ length: 12 }, () => []);
  for (const a of audits) byMonth[monthOf(a.audited_at) - 1]?.push(a.percent_score);
  return {
    groups: [...byGroup.keys()].sort((x, y) => x - y).map((n) => ({ group: n, percent: round1(avg(byGroup.get(n)) || 0) })),
    months: byMonth.map((scores, i) => ({ month: i + 1, percent: scores.length ? round2(avg(scores)) : 0, audits: scores.length })),
    audits: audits.length
  };
}

// Ranking: per area the average % of each group up to a month, their mean, sorted best first, per area type.
export function rank(areas, audits, groups, upTo) {
  const inRange = audits.filter((a) => monthOf(a.audited_at) <= upTo);
  const ids = new Set(inRange.map((a) => a.id));
  const used = groups.filter((g) => ids.has(g.audit_id));
  const groupNos = [...new Set(used.map((g) => Number(g.s_group)))].sort((x, y) => x - y);
  const byArea = areaScores(inRange, used);
  const types = {};
  for (const type of AREA_TYPES) {
    const rows = areas.filter((a) => a.area_type === type && byArea.has(a.id)).map((a) => {
      const list = byArea.get(a.id);
      const values = groupNos.map((n) => round1(avg(list.map((m) => m.get(n)).filter((v) => v != null)) || 0));
      return { id: a.id, code: a.code, name: a.name, audits: list.length, groups: values, average: round1(avg(values) || 0) };
    }).sort((x, y) => y.average - x.average || x.code.localeCompare(y.code));
    types[type] = {
      rows,
      total: { groups: groupNos.map((_, i) => round1(avg(rows.map((r) => r.groups[i])) || 0)), average: round1(avg(rows.map((r) => r.average)) || 0) }
    };
  }
  return { groups: groupNos, types };
}

// Per area: the group percents of each of its audits.
function areaScores(audits, groups) {
  const byAudit = new Map();
  for (const g of groups) {
    if (!byAudit.has(g.audit_id)) byAudit.set(g.audit_id, new Map());
    byAudit.get(g.audit_id).set(Number(g.s_group), Number(g.percent));
  }
  const byArea = new Map();
  for (const a of audits) {
    const list = byArea.get(a.area_id) || [];
    list.push(byAudit.get(a.id) || new Map());
    byArea.set(a.area_id, list);
  }
  return byArea;
}

export function mountAudit(app) {
  const baseRoute = actRoute(app);
  const route = (method, path, handler) => baseRoute(method, path, async (req, res, activity, t) => {
    await ensure5sMaster(activity);
    return handler(req, res, activity, t);
  });

  // ---------- read: everyone signed in ----------

  route('get', '/api/act/:activity/me', async (req, res, activity) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const [access, team, audits] = await Promise.all([
      accessOf(req, activity, year),
      tx.from(tablesOf(activity).team).select('year'),
      tx.from(tablesOf(activity).audit).select('year')
    ]);
    // Activities without audit tables (CFO, 100P) have no tx_<act>_audit; uncreated activities have no mt_<act>_team yet.
    throwIf(team.error?.code === 'PGRST205' ? null : team.error, audits.error?.code === 'PGRST205' ? null : audits.error);
    const years = [...new Set([new Date().getFullYear(), year, ...(team.data || []).map((r) => r.year), ...(audits.data || []).map((r) => r.year)].map(Number))].sort();
    res.json({ year, years, access });
  });

  route('get', '/api/act/:activity/dashboard/summary', async (req, res, activity) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const areaType = AREA_TYPES.includes(req.query.areaType) ? req.query.areaType : '';
    const areaId = Number(req.query.area) || 0;
    const [areas, rawAudits, ownerMap, pass] = await Promise.all([
      areasOf(activity),
      auditsOf(activity, year),
      areaId ? ownersOf(activity, year, [areaId]) : null,
      tx.from(tablesOf(activity).setting).select('value').eq('key', 'pass_percent').maybeSingle()
    ]);
    const allowed = new Set(areas.filter((a) => (!areaType || a.area_type === areaType) && (!areaId || a.id === areaId)).map((a) => a.id));
    // Every type in one read: the KPI cards follow the ประเภท filter, the monthly charts show Self and Committee apart.
    const all = rawAudits.filter((a) => allowed.has(a.area_id));
    const type = AUDIT_TYPES.includes(req.query.type) ? req.query.type : '';
    const audits = type ? all.filter((a) => a.audit_type === type) : all;
    const owner = areaId ? ownerMap.get(areaId) : '';
    const [groups, ownerNames] = await Promise.all([
      groupsOf(activity, audits.map((a) => a.id)),
      owner ? namesOf([owner]) : null
    ]);
    res.json({
      pass: Number(pass.data?.value) || 80,
      areas: areas.filter((a) => a.status === 'Active' || allowed.has(a.id)).map((a) => ({ id: a.id, code: a.code, name: a.name, areaType: a.area_type })),
      ...summarize(audits, groups),
      byType: Object.fromEntries(AUDIT_TYPES.map((t) => [t, summarize(all.filter((a) => a.audit_type === t), []).months])),
      owner: owner ? { employeeId: owner, name: ownerNames.get(owner)?.name || '' } : null
    });
  });

  route('get', '/api/act/:activity/dashboard/ranking', async (req, res, activity) => {
    const year = yearOf(req.query.year);
    const upTo = intIn(req.query.month, 1, 12) || 12;
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const [areas, rawAudits] = await Promise.all([areasOf(activity), auditsOf(activity, year, req.query.type)]);
    const audits = rawAudits.filter((a) => monthOf(a.audited_at) <= upTo);
    const groups = await groupsOf(activity, audits.map((a) => a.id));
    res.json({ year, month: upTo, ...rank(areas, audits, groups, upTo) });
  });

  route('get', '/api/act/:activity/dashboard/schedule', async (req, res, activity) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const areaType = AREA_TYPES.includes(req.query.areaType) ? req.query.areaType : AREA_TYPES[0];
    const areas = (await areasOf(activity)).filter((a) => a.area_type === areaType);
    const ids = areas.map((a) => a.id);
    const idSet = new Set(ids);
    const [plans, audits] = await Promise.all([
      fetchIn(() => tx.from(tablesOf(activity).auditPlan).select('id,area_id,month,week,round,team').eq('year', year), 'area_id', ids),
      auditsOf(activity, year, 'COMMITTEE')
    ]);
    const mine = audits.filter((a) => idSet.has(a.area_id));
    const issues = await fetchIn(() => tx.from(tablesOf(activity).issue).select('audit_id,status'), 'audit_id', mine.map((a) => a.id));
    const issuesByAudit = new Map();
    for (const i of issues) {
      if (!issuesByAudit.has(i.audit_id)) issuesByAudit.set(i.audit_id, []);
      issuesByAudit.get(i.audit_id).push(i);
    }
    const hasActivity = new Set([...plans.map((p) => p.area_id), ...mine.map((x) => x.area_id)]);
    res.json({
      year,
      areaType,
      areas: areas.filter((a) => a.status === 'Active' || hasActivity.has(a.id)).map((a) => ({ id: a.id, code: a.code, name: a.name })),
      plans,
      audits: mine.map((a) => {
        const own = issuesByAudit.get(a.id) || [];
        return { id: a.id, auditNo: a.audit_no, areaId: a.area_id, month: monthOf(a.audited_at), week: weekOf(a.audited_at), team: a.team, percent: Number(a.percent_score), issues: own.length, openIssues: own.filter((i) => i.status !== 'CLOSED').length };
      })
    });
  });

  route('get', '/api/act/:activity/team', async (req, res, activity) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const t = tablesOf(activity);
    const [rows, empDepts, areas] = await Promise.all([
      fetchAll(() => tx.from(t.team).select('*').eq('year', year).order('unit', { nullsFirst: true }).order('role').order('team').order('employee_id')),
      mx.from('mt_main_employee').select('department').eq('status', 'Active'),
      activity === '5s' ? fetchAll(() => tx.from(t.area).select('id,code,name,area_type')) : []
    ]);
    const areaMap = new Map((areas || []).map((a) => [Number(a.id), a]));
    const departments = [...new Set([...(empDepts.data || []).map((r) => String(r.department || '').trim()), ...rows.map((r) => String(r.department || '').trim())].filter(Boolean))].sort();
    const names = await namesOf([...rows.map((r) => r.employee_id), ...rows.map((r) => r.manager_id).filter(Boolean)]);
    res.json({
      year,
      departments,
      members: rows.map((r) => {
        const area = r.area_id ? areaMap.get(Number(r.area_id)) : null;
        return {
          ...r,
          name: names.get(String(r.employee_id))?.name || '',
          department: r.department || names.get(String(r.employee_id))?.department || '',
          manager_name: r.manager_id ? names.get(String(r.manager_id))?.name || '' : '',
          area_code: area?.code || '',
          area_name: area?.name || ''
        };
      })
    });
  });

  route('get', '/api/act/:activity/checklist', async (req, res, activity) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const rows = await fetchAll(() => tx.from(tablesOf(activity).checklist).select('id,item_no,s_group,title,score_max,status').eq('year', year).order('item_no'));
    res.json({ year, items: rows });
  });

  route('get', '/api/act/:activity/areas', async (req, res, activity) => {
    if (activity !== '5s') return res.json({ year: yearOf(req.query.year) || new Date().getFullYear(), areas: [] });
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const [areas, ownerRows] = await Promise.all([
      areasOf(activity),
      fetchAll(() => tx.from(tablesOf(activity).team).select('area_id,employee_id').eq('year', year).eq('role', 'owner'))
    ]);
    const owners = new Map(ownerRows.map((row) => [Number(row.area_id), String(row.employee_id)]));
    const names = await namesOf([...owners.values()]);
    res.json({ year, areas: areas.map((a) => ({ ...a, owner: owners.get(a.id) ? { employeeId: owners.get(a.id), name: names.get(owners.get(a.id))?.name || '' } : null })) });
  });

  route('get', '/api/act/:activity/audit-plan', async (req, res, activity) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const plans = await fetchAll(() => tx.from(tablesOf(activity).auditPlan).select('id,area_id,month,week,round,team').eq('year', year).order('area_id').order('month').order('week'));
    res.json({ year, plans });
  });

  // ---------- Setting: admin of the year ----------

  // Employee picker for Setting (admins) and for the audit form's receivers (any team member of the year).
  route('get', '/api/act/:activity/employees', async (req, res, activity) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    if (!(await accessOf(req, activity, year)).member) return fail(res, 403, `ค้นพนักงานได้เฉพาะทีมของกิจกรรมนี้ปี ${year}`);
    const term = cleanTerm(req.query.q);
    let q = mx.from('mt_main_employee').select('employee_id,prefix,first_name,last_name,department,position').eq('status', 'Active').order('employee_id').limit(20);
    if (term) q = q.or(`employee_id.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%,department.ilike.%${term}%`);
    const { data, error } = await q;
    if (error) return fail(res, 400, 'ค้นหาพนักงานไม่ได้');
    res.json({ employees: (data || []).map((r) => ({ employeeId: String(r.employee_id), name: nameOf(r), department: r.department || '', position: r.position || '' })) });
  });

  const areaInput = (body) => {
    const code = String(body.code || '').trim().toUpperCase().slice(0, 20);
    const name = String(body.name || '').trim().slice(0, 120);
    if (!code || !name || !AREA_TYPES.includes(body.areaType)) return { error: 'ระบุรหัส ชื่อ และประเภทพื้นที่' };
    return { row: { code, name, area_type: body.areaType, section: String(body.section || '').trim().slice(0, 120) || null, status: body.status === 'Inactive' ? 'Inactive' : 'Active' } };
  };

  route('post', '/api/act/:activity/areas', async (req, res, activity) => {
    const year = yearOf(req.body?.year);
    if (!year || !(await requireAdmin(req, res, activity, year))) return;
    const { row, error: invalid } = areaInput(req.body || {});
    if (invalid) return fail(res, 400, invalid);
    const { error } = await tx.from(tablesOf(activity).area).insert(row);
    if (error?.code === '23505') return fail(res, 400, `มีรหัสพื้นที่ ${row.code} แล้ว`);
    throwIf(error);
    res.status(201).json({ ok: true });
  });

  route('patch', '/api/act/:activity/areas/:id', async (req, res, activity) => {
    const year = yearOf(req.body?.year);
    if (!year || !(await requireAdmin(req, res, activity, year))) return;
    const { row, error: invalid } = areaInput(req.body || {});
    if (invalid) return fail(res, 400, invalid);
    const { data, error } = await tx.from(tablesOf(activity).area).update(row).eq('id', Number(req.params.id)).select('id');
    if (error?.code === '23505') return fail(res, 400, `มีรหัสพื้นที่ ${row.code} แล้ว`);
    throwIf(error);
    if (!data?.length) return fail(res, 404, 'ไม่พบพื้นที่');
    res.json({ ok: true });
  });

  // An area that already has audits is kept (Inactive) so old results stay readable.
  route('delete', '/api/act/:activity/areas/:id', async (req, res, activity) => {
    const year = yearOf(req.query.year);
    if (!year || !(await requireAdmin(req, res, activity, year))) return;
    const id = Number(req.params.id);
    const used = await tx.from(tablesOf(activity).audit).select('id', { count: 'exact', head: true }).eq('area_id', id);
    throwIf(used.error);
    if (used.count) {
      const { error } = await tx.from(tablesOf(activity).area).update({ status: 'Inactive' }).eq('id', id);
      throwIf(error);
      return res.json({ ok: true, inactive: true });
    }
    const { error } = await tx.from(tablesOf(activity).area).delete().eq('id', id);
    throwIf(error);
    res.json({ ok: true });
  });

  route('put', '/api/act/:activity/areas/:id/owner', async (req, res, activity) => {
    const year = yearOf(req.body?.year);
    if (!year || !(await requireAdmin(req, res, activity, year))) return;
    const areaId = Number(req.params.id);
    const area = await tx.from(tablesOf(activity).area).select('id').eq('id', areaId).maybeSingle();
    throwIf(area.error);
    if (!area.data) return fail(res, 404, 'ไม่พบพื้นที่');
    const employeeId = String(req.body?.employeeId || '').trim();
    // The owner is a team row (role owner, area_id); one per area per year, so replace it.
    const team = tablesOf(activity).team;
    const removed = await tx.from(team).delete().eq('year', year).eq('area_id', areaId).eq('role', 'owner');
    throwIf(removed.error);
    const { error } = employeeId ? await tx.from(team).insert({ year, employee_id: employeeId, role: 'owner', area_id: areaId, ...(ACT_UNITS[activity] ? { unit: AUDIT_UNIT } : {}), status: 'Active' }) : { error: null };
    throwIf(error);
    res.json({ ok: true });
  });

  // Where one team row sits: role + sub-team + audit group / area / department, checked the same way for add and edit.
  const placementOf = (activity, body, units) => {
    const role = ROLES.includes(body?.role) ? body.role : '';
    if (body?.unit && !units.includes(body.unit)) return { error: 'ทีมย่อยไม่ถูกต้อง' };
    // owner / auditor always sit in ทีมตรวจประเมิน when the activity has an audit team (5S)
    const unit = units.includes(AUDIT_UNIT) && AUDIT_ONLY.includes(role) ? AUDIT_UNIT : units.includes(body?.unit) ? body.unit : null;
    const team = role === 'auditor' ? String(body?.team || '').trim().toUpperCase() : null;
    const areaId = role === 'owner' && body?.areaId ? Number(body.areaId) : null;
    const department = role === 'member' && !unit ? String(body?.department || '').trim().slice(0, 80) : '';
    if (!role) return { error: 'เลือกบทบาท' };
    // 5S (ผู้ใช้กำหนด 2026-11-01): no committee, every row is in one of the four teams · ทีมตรวจประเมิน has no สมาชิก
    if (units.includes(AUDIT_UNIT) && !unit) return { error: 'เลือกทีม (ทีมมาตรฐาน / วิชาการ / ประชาสัมพันธ์ / ตรวจประเมิน)' };
    if (unit === AUDIT_UNIT && role === 'member') return { error: 'ทีมตรวจประเมินไม่มีสมาชิก เลือกผู้รับผิดชอบพื้นที่หรือผู้ตรวจประเมิน' };
    if (role === 'auditor' && !/^[A-Z]$/.test(team)) return { error: 'ผู้ตรวจต้องเลือกกลุ่มตรวจ A–Z' };
    if (role === 'owner' && !areaId) return { error: 'ผู้รับผิดชอบพื้นที่ต้องระบุพื้นที่' };
    if (role === 'member' && !unit && !department) return { error: 'ตัวแทนหน่วยงานต้องระบุหน่วยงาน' };
    return { role, unit, team, area_id: areaId, department: department || null };
  };

  route('post', '/api/act/:activity/team', async (req, res, activity) => {
    const year = yearOf(req.body?.year);
    if (!year || !(await requireAdmin(req, res, activity, year))) return;
    const employeeId = String(req.body?.employeeId || '').trim();
    if (!employeeId) return fail(res, 400, 'เลือกพนักงาน');
    const place = placementOf(activity, req.body, await unitsOf(activity, year, true));
    if (place.error) return fail(res, 400, place.error);
    const member = place.role === 'member';
    const targetCount = member && req.body?.targetCount != null && req.body.targetCount !== '' ? Math.max(0, Math.floor(Number(req.body.targetCount) || 0)) : undefined;
    const managerId = member && req.body?.managerId ? String(req.body.managerId).trim().slice(0, 20) || null : undefined;
    // one owner per area per year: the new one replaces the old
    if (place.role === 'owner') await tx.from(tablesOf(activity).team).delete().eq('year', year).eq('area_id', place.area_id).eq('role', 'owner');
    const row = Object.fromEntries(Object.entries(place).filter(([, v]) => v != null));
    const extra = { ...(targetCount !== undefined ? { target_count: targetCount } : {}), ...(managerId !== undefined ? { manager_id: managerId } : {}) };
    const { error } = await tx.from(tablesOf(activity).team).insert({ year, employee_id: employeeId, ...row, ...extra, status: 'Active' });
    if (error?.code === '23505') return fail(res, 400, 'คนนี้มีบทบาทนี้อยู่แล้ว');
    throwIf(error);
    res.status(201).json({ ok: true });
  });

  // Edit one row (ผู้ใช้กำหนด 2026-10-30: เพิ่ม แก้ไข ลบ ทุกหน้า): status, and when role is sent, the whole placement.
  route('patch', '/api/act/:activity/team/:id', async (req, res, activity) => {
    const { data: row, error } = await tx.from(tablesOf(activity).team).select('*').eq('id', Number(req.params.id)).maybeSingle();
    throwIf(error);
    if (!row) return fail(res, 404, 'ไม่พบรายชื่อ');
    if (!(await requireAdmin(req, res, activity, row.year))) return;
    const patch = {};
    if (req.body?.status) patch.status = req.body.status === 'Inactive' ? 'Inactive' : 'Active';
    if (req.body?.role !== undefined) {
      // a row may keep the project it already has even if that project was closed since
      const units = await unitsOf(activity, row.year, true);
      const place = placementOf(activity, req.body, row.unit && !units.includes(row.unit) ? [...units, row.unit] : units);
      if (place.error) return fail(res, 400, place.error);
      const self = String(row.employee_id) === req.user.employeeId && !req.user.creator;
      if (self && row.role === 'admin' && !row.unit && (place.role !== 'admin' || place.unit || patch.status === 'Inactive')) return fail(res, 400, 'นำสิทธิ์ผู้ประสานงานของตัวเองออกไม่ได้');
      Object.assign(patch, place);
      if (place.role === 'owner') {
        const old = await tx.from(tablesOf(activity).team).delete().eq('year', row.year).eq('area_id', place.area_id).eq('role', 'owner').neq('id', row.id);
        throwIf(old.error);
      }
    } else if (row.role === 'member' && req.body?.department != null) {
      const department = String(req.body.department).trim().slice(0, 80);
      if (!department && !row.unit) return fail(res, 400, 'ตัวแทนหน่วยงานต้องระบุหน่วยงาน');
      patch.department = department || null;
    }
    if ((patch.role ?? row.role) === 'member') {
      if (req.body?.targetCount != null) patch.target_count = Math.max(0, Math.floor(Number(req.body.targetCount) || 0));
      if (req.body?.managerId !== undefined) patch.manager_id = String(req.body.managerId || '').trim().slice(0, 20) || null;
    }
    if (!Object.keys(patch).length) return fail(res, 400, 'ไม่มีข้อมูลให้แก้ไข');
    const upd = await tx.from(tablesOf(activity).team).update(patch).eq('id', row.id);
    if (upd.error?.code === '23505') return fail(res, 400, 'คนนี้มีบทบาทนี้อยู่แล้ว');
    throwIf(upd.error);
    res.json({ ok: true });
  });

  route('delete', '/api/act/:activity/team/:id', async (req, res, activity) => {
    const { data: row, error } = await tx.from(tablesOf(activity).team).select('id,year,employee_id,role').eq('id', Number(req.params.id)).maybeSingle();
    throwIf(error);
    if (!row) return fail(res, 404, 'ไม่พบรายชื่อ');
    if (!(await requireAdmin(req, res, activity, row.year))) return;
    if (row.role === 'admin' && String(row.employee_id) === req.user.employeeId && !req.user.creator) return fail(res, 400, 'นำสิทธิ์ admin ของตัวเองออกไม่ได้');
    const del = await tx.from(tablesOf(activity).team).delete().eq('id', row.id);
    throwIf(del.error);
    res.json({ ok: true });
  });

  // Rows go in one by one so a row that already exists (unique constraint) is simply skipped.
  const copyYear = (key) => async (req, res, activity) => {
    const table = tablesOf(activity)[key];
    const from = yearOf(req.body?.from);
    const to = yearOf(req.body?.to);
    if (!from || !to || from === to) return fail(res, 400, 'เลือกปีต้นทางและปลายทาง');
    if (!(await requireAdmin(req, res, activity, to))) return;
    const rows = await fetchAll(() => tx.from(table).select('*').eq('year', from).order('id'));
    if (!rows.length) return fail(res, 400, `ปี ${from} ไม่มีข้อมูลให้คัดลอก`);
    const results = await Promise.all(rows.map(async ({ id, ...row }) => {
      const { error } = await tx.from(table).insert({ ...row, year: to });
      if (error?.code === '23505') return 0;
      throwIf(error);
      return 1;
    }));
    res.json({ ok: true, copied: results.reduce((s, v) => s + v, 0) });
  };
  route('post', '/api/act/:activity/team/copy', copyYear('team'));
  route('post', '/api/act/:activity/checklist/copy', copyYear('checklist'));

  const itemInput = (body) => {
    const itemNo = intIn(body.itemNo, 1, 200);
    const sGroup = intIn(body.sGroup, 1, 20);
    const scoreMax = intIn(body.scoreMax ?? 5, 1, 100);
    const title = String(body.title || '').trim().slice(0, 300);
    if (!itemNo || !sGroup || !scoreMax || !title) return { error: 'ระบุข้อที่ หมวด หัวข้อ และคะแนนเต็ม' };
    return { row: { item_no: itemNo, s_group: sGroup, title, score_max: scoreMax, status: body.status === 'Inactive' ? 'Inactive' : 'Active' } };
  };

  route('post', '/api/act/:activity/checklist', async (req, res, activity) => {
    const year = yearOf(req.body?.year);
    if (!year || !(await requireAdmin(req, res, activity, year))) return;
    const { row, error: invalid } = itemInput(req.body || {});
    if (invalid) return fail(res, 400, invalid);
    const { error } = await tx.from(tablesOf(activity).checklist).insert({ ...row, year });
    if (error?.code === '23505') return fail(res, 400, `มีข้อที่ ${row.item_no} ของปี ${year} แล้ว`);
    throwIf(error);
    res.status(201).json({ ok: true });
  });

  route('patch', '/api/act/:activity/checklist/:id', async (req, res, activity) => {
    const { data: current, error: readError } = await tx.from(tablesOf(activity).checklist).select('id,year').eq('id', Number(req.params.id)).maybeSingle();
    throwIf(readError);
    if (!current) return fail(res, 404, 'ไม่พบหัวข้อ');
    if (!(await requireAdmin(req, res, activity, current.year))) return;
    const { row, error: invalid } = itemInput(req.body || {});
    if (invalid) return fail(res, 400, invalid);
    const { error } = await tx.from(tablesOf(activity).checklist).update(row).eq('id', current.id);
    if (error?.code === '23505') return fail(res, 400, `มีข้อที่ ${row.item_no} แล้ว`);
    throwIf(error);
    res.json({ ok: true });
  });

  route('delete', '/api/act/:activity/checklist/:id', async (req, res, activity) => {
    const { data: current, error: readError } = await tx.from(tablesOf(activity).checklist).select('id,year').eq('id', Number(req.params.id)).maybeSingle();
    throwIf(readError);
    if (!current) return fail(res, 404, 'ไม่พบหัวข้อ');
    if (!(await requireAdmin(req, res, activity, current.year))) return;
    const used = await tx.from(tablesOf(activity).score).select('audit_id', { count: 'exact', head: true }).eq('checklist_id', current.id);
    throwIf(used.error);
    const { error } = used.count
      ? await tx.from(tablesOf(activity).checklist).update({ status: 'Inactive' }).eq('id', current.id)
      : await tx.from(tablesOf(activity).checklist).delete().eq('id', current.id);
    throwIf(error);
    res.json({ ok: true, inactive: Boolean(used.count) });
  });

  // One cell of the committee plan: area x month x week. Empty team = remove the cell.
  route('put', '/api/act/:activity/audit-plan', async (req, res, activity) => {
    const year = yearOf(req.body?.year);
    if (!year || !(await requireAdmin(req, res, activity, year))) return;
    const areaId = Number(req.body?.areaId);
    const month = intIn(req.body?.month, 1, 12);
    const week = intIn(req.body?.week, 1, 4);
    const team = String(req.body?.team || '').trim().toUpperCase();
    const round = req.body?.round ? intIn(req.body.round, 1, 6) : null;
    if (!areaId || !month || !week) return fail(res, 400, 'ระบุพื้นที่ เดือน และสัปดาห์');
    if (team && !/^[A-Z]$/.test(team)) return fail(res, 400, 'ทีมต้องเป็น A–Z');
    if (req.body?.round && !round) return fail(res, 400, 'ครั้งที่ต้องเป็น 1–6');
    const area = await tx.from(tablesOf(activity).area).select('id').eq('id', areaId).maybeSingle();
    throwIf(area.error);
    if (!area.data) return fail(res, 404, 'ไม่พบพื้นที่');
    const { error } = team
      ? await tx.from(tablesOf(activity).auditPlan).upsert({ year, area_id: areaId, month, week, round, team }, { onConflict: 'year,area_id,month,week' })
      : await tx.from(tablesOf(activity).auditPlan).delete().eq('year', year).eq('area_id', areaId).eq('month', month).eq('week', week);
    throwIf(error);
    res.json({ ok: true });
  });
}
