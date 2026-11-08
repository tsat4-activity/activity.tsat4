import { mx, dbReady } from './db.js';
import { fail } from './http.js';
import { cookies, readSession, setSession } from './session.js';
import { CREATOR_ID, MEMBER_TABLES, isCreatorRow } from './access.js';

const USER_CACHE = new Map();
const USER_CACHE_TTL_MS = 60_000;

export function clearUserCache(employeeId) {
  if (employeeId) USER_CACHE.delete(String(employeeId));
  else USER_CACHE.clear();
}

export function nameOf(employee) {
  if (!employee) return '';
  return [employee.prefix, employee.first_name, employee.last_name].filter(Boolean).join(' ');
}

export async function loadUser(employeeId, { fresh = false } = {}) {
  const key = String(employeeId || '');
  if (!fresh) {
    const cached = USER_CACHE.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.row;
  }
  const { data, error } = await mx
    .from('mt_main_user')
    // '*' so executive / admin_of read as missing (not an error) before db/06_main_user_access.sql is run.
    .select('*,mt_main_employee!mt_main_user_employee_id_fkey(prefix,first_name,last_name,department,position,status)')
    .eq('employee_id', employeeId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    USER_CACHE.delete(key);
    return null;
  }
  const entries = Object.entries(MEMBER_TABLES);
  const members = await Promise.all(entries.map(([, table]) => mx.from(table).select('role,status,department').eq('employee_id', employeeId).maybeSingle()));
  data.members = {};
  entries.forEach(([moduleId, table], i) => {
    // PGRST205 = table not created yet: a new module must not lock everyone out before its SQL is run.
    if (members[i].error?.code === 'PGRST205') console.warn(`member table ${table} is missing`);
    else if (members[i].error) throw members[i].error;
    data.members[moduleId] = members[i].data || null;
  });
  USER_CACHE.set(key, { row: data, expiresAt: Date.now() + USER_CACHE_TTL_MS });
  return data;
}

const adminOf = (row) => (Array.isArray(row.admin_of) ? row.admin_of : []);

function rolesOf(row) {
  const creator = isCreatorRow(row);
  const roles = {};
  for (const moduleId of Object.keys(MEMBER_TABLES)) {
    const member = row.members?.[moduleId];
    const own = member?.status === 'Active' ? member.role : null;
    // creator / ผู้ดูแลของระบบนี้ = admin · ผู้บริหาร = at least viewer everywhere.
    if (creator || adminOf(row).includes(moduleId)) roles[moduleId] = 'admin';
    else roles[moduleId] = own || (row.executive ? 'viewer' : null);
  }
  return roles;
}

export function publicUser(row) {
  const employee = row.mt_main_employee || {};
  const roles = rolesOf(row);
  return {
    employeeId: row.employee_id,
    creator: isCreatorRow(row),
    founder: row.employee_id === CREATOR_ID,
    executive: Boolean(row.executive),
    adminOf: adminOf(row),
    roles,
    status: row.status,
    name: nameOf(employee),
    department: row.department || employee.department || '',
    position: employee.position || '',
    passwordExpiresAt: row.password_expires_at,
    passwordExpired: new Date(row.password_expires_at).getTime() <= Date.now()
  };
}

export async function requireUser(req, res, next) {
  if (!dbReady()) return fail(res, 503, 'ยังไม่ได้ตั้งค่าการเชื่อมฐานข้อมูล');
  const session = readSession(cookies(req).smf_session);
  if (!session) return fail(res, 401, 'กรุณาเข้าสู่ระบบ');
  const row = await loadUser(session.employeeId);
  if (!row || row.status !== 'Active' || row.mt_main_employee?.status !== 'Active') {
    setSession(res, '');
    return fail(res, 401, 'บัญชีนี้ใช้งานไม่ได้');
  }
  req.user = publicUser(row);
  req.userHash = row.password_hash;
  const open = req.path === '/api/me' || req.path === '/api/logout' || req.path === '/api/password';
  if (req.user.passwordExpired && !open) return fail(res, 403, 'ครบกำหนด 90 วัน ต้องเปลี่ยนรหัสผ่าน');
  next();
}
requireUser.need = 'auth';
