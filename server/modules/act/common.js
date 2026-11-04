import { mx, tx } from '../../core/db.js';
import { fail, wrap } from '../../core/http.js';
import { nameOf, requireUser } from '../../core/users.js';

// Shared by the act routes. Activity data lives in Tx Data (client `tx`), one table set per activity:
// mt_<key>_* / tx_<key>_* made by scripts/act-sql.js. Employees and logins stay in Mx Data (client `mx`).
export const ACTIVITIES = ['5s', 'cfo', 'smf'];
const PAGE = 1000;

// Decimal rounding (85.15 -> 85.2) like the old system and SQL; plain Math.round(n * 10) gives 85.1.
export const roundTo = (n, digits) => Number(`${Math.round(Number(`${Number(n).toFixed(8)}e${digits}`))}e-${digits}`);

export function tablesOf(activity) {
  const k = activity.replace(/[^a-z0-9]/g, '');
  return {
    sql: `db/act/${activity}.sql`,
    bucket: `img_${k}`, // Storage bucket for this activity's photos
    team: `mt_${k}_team`,
    setting: `mt_${k}_setting`,
    task: `mt_${k}_task`, // Project Planner (planner.js)
    project: `mt_${k}_project`, // SMF projects per year (smf.js)
    projectMonth: `tx_${k}_project_month`, // Monthly target and actual per project (smf.js)
    area: `mt_${k}_area`,
    checklist: `mt_${k}_checklist`,
    auditPlan: `mt_${k}_audit_plan`,
    audit: `tx_${k}_audit`,
    score: `tx_${k}_audit_score`,
    issue: `tx_${k}_issue`,
    group: `v_${k}_audit_group`,
    // CFO only (scripts/act-sql.js cfoSql)
    cfoScope: `mt_${k}_scope`,
    gwp: `mt_${k}_gwp`,
    ef: `mt_${k}_ef`,
    efRef: `mt_${k}_ef_ref`, // reference tables of EF TGO AR5 V2 (energy / chemical / ipcc)
    material: `mt_${k}_material`, // SAP materials + EF match (Scope 3 Store usage)
    matGroup: `mt_${k}_mat_group`, // กลุ่มวัสดุ: 1 กลุ่ม = 1 EF = กิจกรรม 3-1 ต่อ costcenter
    materialUse: `tx_${k}_material`, // monthly SAP usage that has an EF
    activity: `mt_${k}_activity`,
    entry: `tx_${k}_entry`,
    entryView: `v_${k}_entry`,
    s3Assess: `mt_${k}_s3_assess`,
    revision: `tx_${k}_revision`
  };
}

export function dateOf(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? null : text;
}

export function yearOf(value, fallback = new Date().getFullYear()) {
  const n = Number(value || fallback);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : null;
}

// Route maker for /api/act/:activity/...: signed in, a known activity (and one of `only` when given), and the
// handler gets (req, res, activity, tablesOf(activity)). Any thrown error that means a missing table
// (PGRST205) becomes a 503 naming the SQL file to run in Tx Data instead of a 500.
export function actRoute(app, { only, sqlOf = () => null } = {}) {
  return (method, path, handler) => app[method](path, wrap(requireUser), wrap(async (req, res) => {
    const { activity } = req.params;
    if (!ACTIVITIES.includes(activity) || (only && !only.includes(activity))) return fail(res, 404, 'ไม่พบกิจกรรม');
    try {
      await handler(req, res, activity, tablesOf(activity));
    } catch (err) {
      const sql = sqlOf(activity) || tablesOf(activity).sql;
      // PGRST204 / 42703 = a column added to the template later (e.g. mt_5s_task.done_on) that this database does not have yet.
      if (err?.code === 'PGRST204' || err?.code === '42703') return fail(res, 503, `ตารางของกิจกรรมนี้ยังไม่มีคอลัมน์ใหม่ ต้องรัน ${sql} ใน Tx Data อีกรอบ`);
      if (err?.code !== 'PGRST205') throw err;
      fail(res, 503, `ยังไม่ได้สร้างตารางของกิจกรรมนี้ใน Tx Data (${sql})`);
    }
  }));
}

// Supabase result -> data, or throw its error (actRoute turns it into a response).
export function must({ data, error }) {
  if (error) throw error;
  return data;
}

// JPEG data URL from the browser -> bytes for Storage (img_<act> bucket limit 700 KB), or null.
export function imageBytes(dataUrl) {
  const match = String(dataUrl || '').match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.length < 32 || bytes.length > 700000 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  return bytes;
}

export function throwIf(...errors) {
  const error = errors.find(Boolean);
  if (error) throw error;
}

// Reads every row past PostgREST's 1000-row page. build() must return a fresh query each call.
export async function fetchAll(build) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}

export async function fetchIn(build, column, ids, size = 200) {
  const unique = [...new Set(ids.filter((id) => id != null && id !== ''))];
  if (!unique.length) return [];
  const chunks = [];
  for (let i = 0; i < unique.length; i += size) chunks.push(unique.slice(i, i + size));
  return (await Promise.all(chunks.map((chunk) => fetchAll(() => build().in(column, chunk))))).flat();
}

export async function namesOf(ids) {
  const rows = await fetchIn(() => mx.from('mt_main_employee').select('employee_id,prefix,first_name,last_name,department'), 'employee_id', ids.map(String));
  return new Map(rows.map((row) => [String(row.employee_id), { name: nameOf(row), department: row.department || '' }]));
}

// What the signed-in user may do in one activity for one year.
// admin -> Setting · chairman (+ vice) / auditor / area owner / department member -> transaction · everyone -> Dashboard
// Account level (mt_main_user): creator or admin_of this activity = admin every year · executive = chairman every year.
// Sub-teams (mt_<act>_team.unit, ผู้ใช้กำหนด 2026-10-30): empty = the activity's committee (ประธาน · รองประธาน ·
// ที่ปรึกษา · ผู้ประสานงาน). 5S has four teams; ทีมตรวจประเมิน also holds the area owners and the auditors.
export const ACT_UNITS = { '5s': ['standard', 'academic', 'pr', 'audit'] };
export const AUDIT_UNIT = 'audit';
// Activities whose sub-teams are their projects of the year (mt_<act>_project, ผู้ใช้กำหนด 2026-11-01): SMF.
export const PROJECT_ON = ['smf'];

// The year's sub-team codes: fixed (5S) or the activity's projects (SMF; activeOnly = what new rows may use).
export async function unitsOf(activity, year, activeOnly = false) {
  if (!PROJECT_ON.includes(activity)) return ACT_UNITS[activity] || [];
  let q = tx.from(tablesOf(activity).project).select('code,status').eq('year', year);
  if (activeOnly) q = q.eq('status', 'Active');
  const { data, error } = await q;
  if (error?.code === 'PGRST205') return [];
  if (error) throw error;
  return (data || []).map((r) => r.code);
}

// [{ code, name, status }] of the year, in screen order (SMF projects); [] for other activities.
export async function projectsOf(activity, year) {
  if (!PROJECT_ON.includes(activity)) return [];
  const { data, error } = await tx.from(tablesOf(activity).project).select('*').eq('year', year).order('sort_no').order('id');
  if (error?.code === 'PGRST205') return [];
  if (error) throw error;
  return (data || []).map((p) => ({
    ...p,
    team_type: p.team_type || 'team',
    target_type: p.target_type || (p.code === 'workflow' ? 'count' : 'plan'),
    target_count: p.target_count != null ? Number(p.target_count) : (p.code === 'workflow' ? 10 : null)
  }));
}

export async function accessOf(req, activity, year) {
  const me = req.user.employeeId;
  const t = tablesOf(activity);
  const lead = Boolean(req.user.creator) || (req.user.adminOf || []).includes(activity);
  const executive = Boolean(req.user.executive);
  const none = { admin: lead, chairman: executive, auditor: false, teams: [], ownerAreaIds: [], departments: [], member: lead || executive };
  // One table says who does what this year, area owners included (role owner + area_id).
  const team = await tx.from(t.team).select('*').eq('year', year).eq('employee_id', me).eq('status', 'Active');
  if (team.error?.code === 'PGRST205') return none;
  if (team.error) throw team.error;
  const roles = team.data || [];
  const access = {
    // Setting: the committee's ผู้ประสานงาน (admin, no unit) · 5S has no committee, so the ผู้ประสานงาน of any of its teams
    // (ผู้ใช้กำหนด 2026-11-01) · smart = SMF Smart Team (docs/specs/act-smf.md) · an SMF project's ผู้ประสานงาน leads that project only.
    admin: lead || roles.some((r) => (r.role === 'admin' && (!r.unit || !PROJECT_ON.includes(activity))) || r.role === 'smart'),
    // Committee Audit and Issue rights: the committee's ประธาน / รองประธาน and those of ทีมตรวจประเมิน.
    chairman: executive || roles.some((r) => (r.role === 'chairman' || r.role === 'vice') && (!r.unit || r.unit === AUDIT_UNIT)),
    advisor: roles.some((r) => r.role === 'advisor'),
    auditor: roles.some((r) => r.role === 'auditor'),
    teams: [...new Set(roles.filter((r) => r.team).map((r) => r.team))],
    ownerAreaIds: roles.filter((r) => r.role === 'owner').map((r) => Number(r.area_id)),
    departments: roles.filter((r) => r.role === 'member').map((r) => r.department)
  };
  access.member = roles.length > 0 || access.admin || executive;
  return access;
}

// Sheets the owner may still edit (Kaizen, QCC): once sent they are locked until decided; admins edit any time.
export const SHEET_OPEN = ['DRAFT', 'REJECTED'];
export const sheetEditable = (status, { owner, admin }) => admin || (owner && SHEET_OPEN.includes(status));

// Write to a sheet only while its status is still the one that was read (like STO move()): two people pressing at
// once cannot overwrite each other. -> false when the status changed meanwhile (answer 409, reload).
export async function sheetWrite(table, row, patch) {
  return must(await tx.from(table).update(patch).eq('id', row.id).eq('status', row.status).select('id')).length > 0;
}
export const SHEET_STALE = [409, 'สถานะของใบนี้เปลี่ยนไปแล้ว โหลดหน้าใหม่แล้วลองอีกครั้ง'];

// Sheet status flow (Kaizen, QCC): the owner sends DRAFT / REJECTED -> SUBMITTED; a reviewer decides APPROVED / REJECTED
// on a sent sheet (and may change that decision), never on a draft, and never on their own sheet unless admin.
// -> null when allowed, else [http status, message].
export function statusMove(from, to, { owner, reviewer, admin, self, denied }) {
  if (to === 'SUBMITTED') {
    if (!owner && !admin) return [403, denied];
    return ['DRAFT', 'REJECTED'].includes(from) ? null : [409, 'ส่งพิจารณาได้เฉพาะใบร่าง หรือใบที่ไม่ผ่าน'];
  }
  if (!['APPROVED', 'REJECTED'].includes(to)) return [400, 'สถานะไม่ถูกต้อง'];
  if (!reviewer) return [403, denied];
  if (from === 'DRAFT') return [409, 'ยังไม่ได้ส่งพิจารณา'];
  if (self && !admin) return [403, 'พิจารณาใบของตนเองไม่ได้'];
  return null;
}

export async function requireAdmin(req, res, activity, year) {
  const access = await accessOf(req, activity, year);
  if (access.admin) return access;
  fail(res, 403, `แก้ได้เฉพาะ admin ของกิจกรรมนี้ปี ${year}`);
  return null;
}
