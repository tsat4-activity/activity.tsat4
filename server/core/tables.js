// Master tables (mt_main_*) shown in System > Setting. This app owns them (its own Supabase, db/00_main.sql). Column: [name, type, required].
// Types are validated in server/modules/system/index.js (adminValue).
export const MAIN_TABLES = {
  mt_main_employee: { db: 'mx', pk: ['employee_id'], columns: [
    ['employee_id', 'text', true], ['prefix', 'prefix'], ['first_name', 'text', true], ['last_name', 'text', true],
    ['position', 'text'], ['level', 'level', true], ['department', 'dept'], ['photo', 'photo'], ['status', 'status', true]
  ] },
  mt_main_costcenter: { db: 'mx', pk: ['costcenter'], columns: [
    ['costcenter', 'text', true], ['object_name', 'text', true], ['group_name', 'group', true], ['department', 'text', true], ['status', 'status', true]
  ] },
  mt_main_company: { db: 'mx', pk: ['id'], columns: [
    ['id', 'text', true], ['logo', 'logo'], ['name_en', 'text', true], ['name_th', 'text', true]
  ] },
  mt_main_user: { db: 'mx', pk: ['employee_id'], columns: [
    ['employee_id', 'text', true], ['department', 'read'], ['password', 'password'], ['creator', 'bool'], ['executive', 'bool'], ['admin_of', 'scopes'], ['status', 'status', true], ['password_expires_at', 'read']
  ] }
};
