import { tx } from '../../core/db.js';
import { fail, wrap } from '../../core/http.js';
import { requireUser } from '../../core/users.js';
import { ACTIVITIES, AUDIT_UNIT, fetchAll, namesOf, projectsOf, tablesOf, yearOf } from './common.js';
import { PLANNER_ON, planStatus, withSpans } from './planner.js';
import { shownStatus } from './transaction.js';
import { CFO_ON } from './cfo.js';

// SMF Dashboard > ภาพรวม (ผู้ใช้กำหนด 2026-11-01): SMF (Smart Factory) oversees the main projects 5S, CFO and SMF.
// One read for the page: per project its plan progress, key results, team and open problems. Read only, any user.
// A project whose tables are not created yet comes back as null parts instead of failing the page.
const MISSING = ['PGRST205', '42P01', 'PGRST204', '42703'];
const safe = async (fn) => {
  try {
    return await fn();
  } catch (err) {
    if (MISSING.includes(err?.code)) return null;
    throw err;
  }
};
const todayIso = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10); // Thailand date
const daysOf = (start, end) => Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const avg = (list) => (list.length ? list.reduce((s, v) => s + v, 0) / list.length : 0);

// Main items: overall % (weighted by days), how many are ahead / on plan / behind, and late items at any level.
function planSummary(rows, today, names = new Map(), deptMap = new Map()) {
  const mains = rows.filter((r) => r.parent_id == null);
  const dated = mains.filter((r) => r.start_date && r.end_date);
  const days = dated.reduce((s, r) => s + daysOf(r.start_date, r.end_date), 0);
  const percent = days ? Math.round(dated.reduce((s, r) => s + daysOf(r.start_date, r.end_date) * r.progress, 0) / days) : Math.round(avg(mains.map((r) => r.progress)));
  const counts = {};
  for (const r of mains) {
    const code = planStatus(r, today).code;
    counts[code] = (counts[code] || 0) + 1;
  }
  const overdue = rows.filter((r) => planStatus(r, today).code === 'overdue').map((r) => ({ title: r.title, end: r.end_date, progress: r.progress }));
  const kids = rows.filter((r) => r.parent_id != null);
  const completedCount = kids.length
    ? kids.filter((r) => Number(r.progress) >= 100).length
    : mains.filter((r) => Number(r.progress) >= 100).length;
  const subtasks = (kids.length ? kids : mains).map((r) => {
    const st = planStatus(r, today);
    let ownerName = r.owner_id ? (names.get(String(r.owner_id))?.name || r.owner_id) : '';
    if (!ownerName && deptMap.size) {
      const titleLower = String(r.title || '').toLowerCase();
      for (const [deptKey, repName] of deptMap.entries()) {
        if (titleLower.includes(deptKey)) {
          ownerName = repName;
          break;
        }
      }
    }
    return {
      id: r.id,
      title: r.title,
      progress: Number(r.progress) || 0,
      code: st.code,
      label: st.label,
      start: r.start_date,
      end: r.end_date,
      owner_id: r.owner_id ? String(r.owner_id) : '',
      owner_name: ownerName
    };
  });
  return {
    items: mains.length,
    percent,
    counts,
    overdue: overdue.length,
    late: overdue.sort((a, b) => a.end.localeCompare(b.end)).slice(0, 5),
    completedCount,
    totalTasks: (kids.length || mains.length),
    subtasks
  };
}

// The year's plan, and per project (SMF: main item unit; sub items follow their main item).
async function planOf(activity, year, today) {
  if (!PLANNER_ON.includes(activity)) return null;
  const [tasksRes, projects, teamRows] = await Promise.all([
    fetchAll(() => tx.from(tablesOf(activity).task).select('*').eq('year', year).order('sort_no').order('id')),
    projectsOf(activity, year),
    fetchAll(() => tx.from(tablesOf(activity).team).select('employee_id,department,role').eq('year', year).eq('status', 'Active')).catch(() => [])
  ]);
  const rows = withSpans(tasksRes);
  const projMap = new Map((projects || []).flatMap((p) => [[p.code.toLowerCase(), p.code], [p.name.trim().toLowerCase(), p.code]]));
  const resolveUnit = (r) => r.unit || (r.title ? projMap.get(r.title.trim().toLowerCase()) : null) || '';
  const unitOfMain = new Map(rows.filter((r) => r.parent_id == null).map((r) => [Number(r.id), resolveUnit(r)]));
  const unitOf = (r) => (r.parent_id == null ? resolveUnit(r) : unitOfMain.get(Number(r.parent_id)) || '');

  // Resolve responsible names (owner_id or department representative)
  const allEmpIds = [...new Set([...rows.map((r) => r.owner_id), ...(teamRows || []).map((t) => t.employee_id)].filter(Boolean))];
  const names = allEmpIds.length ? await namesOf(allEmpIds) : new Map();
  const deptMap = new Map();
  for (const t of teamRows || []) {
    const emp = names.get(String(t.employee_id));
    const name = emp?.name || '';
    const dept = (t.department || emp?.department || '').trim();
    if (dept && name) {
      dept.split('&').forEach((part) => {
        const k = part.trim().toLowerCase();
        if (k && !deptMap.has(k)) deptMap.set(k, name);
      });
      const fullK = dept.toLowerCase();
      if (!deptMap.has(fullK)) deptMap.set(fullK, name);
    }
  }

  const byUnit = {};
  for (const code of new Set(rows.map(unitOf))) if (code) byUnit[code] = planSummary(rows.filter((r) => unitOf(r) === code), today, names, deptMap);
  return { ...planSummary(rows, today, names, deptMap), byUnit };
}

// Active team of the year: the committee's leads, its members / Smart Team, each sub-team, and how many people in all.
const LEADS = ['chairman', 'vice', 'advisor', 'admin'];
async function teamOf(activity, year) {
  const rows = await fetchAll(() => tx.from(tablesOf(activity).team).select('employee_id,role,unit').eq('year', year).eq('status', 'Active'));
  const unitOf = (r) => r.unit || (['owner', 'auditor'].includes(r.role) && activity === '5s' ? AUDIT_UNIT : '');
  const top = rows.filter((r) => !unitOf(r));
  const units = {};
  for (const r of rows.filter((x) => unitOf(x))) units[unitOf(r)] = (units[unitOf(r)] || 0) + 1;
  return {
    people: new Set(rows.map((r) => r.employee_id)).size,
    committee: top.filter((r) => LEADS.includes(r.role)).length,
    smart: top.filter((r) => r.role === 'smart').length,
    members: top.filter((r) => r.role === 'member').length,
    units
  };
}

// 5S: average score of completed audits, Self / Committee this month, Self Audits still due (owners by the 10th), Issues.
async function fiveS(year, today) {
  const t = tablesOf('5s');
  const month = Number(today.slice(5, 7));
  const [audits, owners, issues] = await Promise.all([
    fetchAll(() => tx.from(t.audit).select('id,audit_type,area_id,audited_at,percent_score').eq('year', year).eq('status', 'COMPLETED')),
    fetchAll(() => tx.from(t.team).select('area_id').eq('year', year).eq('role', 'owner').eq('status', 'Active')),
    fetchAll(() => tx.from(t.issue).select('status,due_date').neq('status', 'CLOSED'))
  ]);
  const thisMonth = audits.filter((a) => Number(String(a.audited_at).slice(0, 4)) === year && Number(String(a.audited_at).slice(5, 7)) === month);
  const selfDone = new Set(thisMonth.filter((a) => a.audit_type === 'SELF').map((a) => Number(a.area_id)));
  const shown = issues.map((i) => shownStatus(i, today));
  return {
    score: round(avg(audits.map((a) => Number(a.percent_score)))),
    audits: audits.length,
    self: audits.filter((a) => a.audit_type === 'SELF').length,
    committee: audits.filter((a) => a.audit_type === 'COMMITTEE').length,
    month,
    monthAudits: thisMonth.length,
    selfDue: owners.filter((o) => !selfDone.has(Number(o.area_id))).length,
    areas: owners.length,
    openIssues: shown.length,
    overdueIssues: shown.filter((s) => s === 'OVERDUE').length
  };
}

// CFO: tCO2e of the year (not the separately reported EF) against the compare year and its target, months recorded.
async function cfo(year) {
  const t = tablesOf('cfo');
  const rowsOf = (y) => fetchAll(() => tx.from(t.entryView).select('month,tco2e,separate').gte('month', `${y}-01-01`).lte('month', `${y}-12-01`));
  const [settingRows, curAll] = await Promise.all([fetchAll(() => tx.from(t.setting).select('key,value')), rowsOf(year)]);
  const settings = Object.fromEntries(settingRows.map((r) => [r.key, r.value]));
  const baseYear = yearOf(settings.base_year, 0) || null;
  const compareYear = baseYear && baseYear !== year ? baseYear : year - 1;
  const target = Number(settings.target_percent ?? 5) || 0;
  const [cur, base] = [curAll, await rowsOf(compareYear)].map((list) => list.filter((r) => !r.separate));
  const sum = (list) => round(list.reduce((s, r) => s + Number(r.tco2e), 0), 3);
  const months = new Set(cur.map((r) => r.month.slice(0, 7))).size;
  // compare the same months only, so a half-recorded year is not set against a full one
  const recorded = new Set(cur.map((r) => Number(r.month.slice(5, 7))));
  const baseSame = sum(base.filter((r) => recorded.has(Number(r.month.slice(5, 7)))));
  return { total: sum(cur), months, compareYear, compareTotal: sum(base), compareSame: baseSame, target, targetSame: round(baseSame * (1 - target / 100), 3) };
}

export function mountOverview(app) {
  app.get('/api/act/overview', wrap(requireUser), wrap(async (req, res) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const today = todayIso();
    const projects = await Promise.all(ACTIVITIES.map(async (activity) => {
      const [plan, team, results, projList] = await Promise.all([
        safe(() => planOf(activity, year, today)),
        safe(() => teamOf(activity, year)),
        safe(() => (activity === '5s' ? fiveS(year, today) : CFO_ON.includes(activity) ? cfo(year) : null)),
        safe(() => projectsOf(activity, year))
      ]);
      return { activity, plan, team, results, projects: projList };
    }));
    res.json({ year, today, projects });
  }));
}
