import { mx, tx } from '../../core/db.js';
import { cleanTerm, fail, wrap } from '../../core/http.js';
import { nameOf, requireUser } from '../../core/users.js';
import { ACTIVITIES, accessOf, fetchIn, tablesOf, viewerOf, yearOf } from './common.js';

// Access in one place (ผู้ใช้กำหนด 2026-11-04). Every activity (5S · CFO · SMF) checks its own team of the year, so one
// person may be ผู้ดูแล of SMF, ผู้ตรวจ of 5S and ผู้ชม of CFO at once. The four levels, the same names everywhere:
//   admin = ผู้ดูแล (Setting + everything) · committee = กรรมการ (ประธาน / รองประธาน / ที่ปรึกษา: read all, confirm)
//   operator = ผู้ปฏิบัติ (ตัวแทนหน่วยงาน / ผู้ตรวจ / ผู้รับผิดชอบพื้นที่ / สมาชิกโครงการ / หัวหน้าโครงการ: own scope)
//   viewer = ผู้ชม (in the team of another activity that year, or ผู้บริหาร: read only) · none
// GET /api/access = mine (the user menu and the sidebar) · GET /api/access/people = everyone's, for the creator.
const COMMITTEE = ['chairman', 'vice', 'advisor'];
export const levelOf = (access, roles, viewer) => (access.admin ? 'admin'
  : roles.some((r) => COMMITTEE.includes(r.role)) ? 'committee'
    : roles.length ? 'operator'
      : viewer || access.chairman ? 'viewer' : 'none');
const roleRow = ({ id, role, unit, team, area_id: areaId, department, status }) => ({ id, role, unit, team, areaId, department, status });

export function mountPeople(app) {
  app.get('/api/access', wrap(requireUser), wrap(async (req, res) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const activities = await Promise.all(ACTIVITIES.map(async (id) => {
      const [access, team] = await Promise.all([
        accessOf(req, id, year),
        tx.from(tablesOf(id).team).select('*').eq('year', year).eq('employee_id', req.user.employeeId).eq('status', 'Active')
      ]);
      const roles = team.error ? [] : team.data.map(roleRow);
      return { id, roles, access, level: levelOf(access, roles, roles.length ? true : await viewerOf(req, year, access)) };
    }));
    res.json({ year, creator: req.user.creator, executive: req.user.executive, activities });
  }));

  // Everyone with a role in any activity that year (+ employees found by q, to give a first role) · creator only
  app.get('/api/access/people', wrap(requireUser), wrap(async (req, res) => {
    if (!req.user.creator) return fail(res, 403, 'เฉพาะผู้ดูแลระบบ');
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const teams = await Promise.all(ACTIVITIES.map((id) => tx.from(tablesOf(id).team).select('*').eq('year', year).order('id')));
    const people = new Map();
    const personOf = (employeeId) => {
      const key = String(employeeId);
      if (!people.has(key)) people.set(key, { employeeId: key, roles: Object.fromEntries(ACTIVITIES.map((a) => [a, []])) });
      return people.get(key);
    };
    teams.forEach((t, i) => (t.error ? [] : t.data).forEach((r) => personOf(r.employee_id).roles[ACTIVITIES[i]].push(roleRow(r))));
    const term = cleanTerm(req.query.q);
    if (term) {
      const found = await mx.from('mt_main_employee').select('employee_id').eq('status', 'Active')
        .or(`employee_id.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%`).limit(30);
      (found.data || []).forEach((e) => personOf(e.employee_id));
    }
    const ids = [...people.keys()];
    const [employees, users] = await Promise.all([
      fetchIn(() => mx.from('mt_main_employee').select('employee_id,prefix,first_name,last_name,department'), 'employee_id', ids),
      fetchIn(() => mx.from('mt_main_user').select('employee_id,status,creator,executive,admin_of'), 'employee_id', ids)
    ]);
    const emp = new Map(employees.map((e) => [String(e.employee_id), e]));
    const user = new Map(users.map((u) => [String(u.employee_id), u]));
    const rows = [...people.values()].map((p) => {
      const e = emp.get(p.employeeId);
      const u = user.get(p.employeeId);
      return { ...p, name: nameOf(e), department: e?.department || '', login: u ? (u.status === 'Active' ? 'active' : 'inactive') : 'none',
        system: u?.creator ? 'creator' : u?.executive ? 'executive' : (u?.admin_of || []).length ? 'admin_of' : '' };
    }).filter((p) => !term || Object.values(p.roles).some((l) => l.length) || `${p.employeeId} ${p.name}`.toLowerCase().includes(term.toLowerCase()))
      .sort((a, b) => a.department.localeCompare(b.department) || a.employeeId.localeCompare(b.employeeId));
    res.json({ year, people: rows });
  }));
}
