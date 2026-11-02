// Test the activity tables (scripts/act-sql.js) on in-memory Postgres (PGlite): npm run test:act
// If inbox/import_5s.sql exists (python -I scripts/import_5s_excel.py), also loads the real 5S data
// and checks the server's dashboard functions against the old TSAT4-5S dashboard.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { actSql, actTaskSql } from './act-sql.js';
import { setupSql } from './setup-sql.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const importFile = path.join(ROOT, 'inbox', 'import_5s.sql');
let failed = 0;
const ok = (c, label) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${label}`); if (!c) failed++; };
const one = async (db, sql) => (await db.query(sql)).rows[0];
const throws = async (db, sql) => { try { await db.exec(sql); return false; } catch { return true; } };

ok(fs.readFileSync(path.join(ROOT, 'db', 'act', '5s.sql'), 'utf8') === actSql('5s'), 'db/act/5s.sql is up to date (node scripts/act-sql.js 5s)');
ok(fs.readFileSync(path.join(ROOT, 'db', 'act', '5s_task.sql'), 'utf8') === actTaskSql('5s'), 'db/act/5s_task.sql is up to date (node scripts/act-sql.js 5s --add-task)');
ok(fs.readFileSync(path.join(ROOT, 'db', 'act', 'smf.sql'), 'utf8') === actSql('smf', { audit: false }), 'db/act/smf.sql is up to date (node scripts/act-sql.js smf --no-audit)');
{
  // SMF projects of the year (2026: Smart OEE, Vision Camera, Work Flow Automation): team and plan point at the code
  const smf = new PGlite();
  await smf.exec(`do $$ begin create role anon; create role authenticated; exception when duplicate_object then null; end $$;`);
  await smf.exec(actSql('smf', { audit: false }));
  await smf.exec(actSql('smf', { audit: false }));
  const names = (await smf.query(`select name from mt_smf_project where year = 2026 order by sort_no`)).rows.map((r) => r.name);
  ok(names.join(' / ') === 'Smart OEE / Vision Camera / Work Flow Automation', 'SMF 2026 projects seeded once');
  ok(await throws(smf, `insert into mt_smf_project (year, code, name) values (2026, 'oee', 'x')`), 'one code per year');
  ok(await throws(smf, `insert into mt_smf_project (year, code, name) values (2027, 'Smart OEE', 'x')`), 'code is a–z 0–9 - _');
  await smf.exec(`insert into mt_smf_team (year, employee_id, role, unit) values (2026, '1', 'chairman', 'oee'), (2026, '2', 'member', 'vision')`);
  await smf.exec(`insert into mt_smf_task (year, title, unit, created_by) values (2026, 'OEE dashboard', 'oee', '1')`);
  const oeeId = (await smf.query(`select id from mt_smf_project where year = 2026 and code = 'oee'`)).rows[0].id;
  await smf.exec(`insert into tx_smf_project_month (year, project_id, month, target, actual, note) values (2026, ${oeeId}, 1, 80, 85.5, 'ดีขึ้น')`);
  ok(await throws(smf, `insert into tx_smf_project_month (year, project_id, month, target) values (2026, ${oeeId}, 1, 85)`), 'one row per project and month');
  ok(await throws(smf, `insert into tx_smf_project_month (year, project_id, month, target) values (2026, ${oeeId}, 13, 85)`), 'month between 1 and 12');
  ok(true, 'project team (chairman, member without department) and a main plan item of a project');
  await smf.close();
}
ok(fs.readFileSync(path.join(ROOT, 'db', 'setup.sql'), 'utf8') === setupSql(), 'db/setup.sql is up to date (node scripts/setup-sql.js)');

// A new Supabase: db/setup.sql builds everything on an empty database, twice.
{
  const fresh = new PGlite();
  await fresh.exec(`do $$ begin create role anon; create role authenticated; exception when duplicate_object then null; end $$;`);
  await fresh.exec(setupSql());
  await fresh.exec(setupSql());
  ok((await one(fresh, `select count(*)::int n from mt_main_employee where employee_id = '2102899'`)).n === 1, 'setup.sql: first admin employee seeded once');
  ok((await one(fresh, `select count(*)::int n from pg_constraint where conname = 'mt_main_user_employee_id_fkey'`)).n === 1, 'setup.sql: login FK has the name loadUser joins on');
  await fresh.exec(`insert into mt_main_user (employee_id, password_hash, creator, password_changed_at) values ('2102899', 'x', true, '2026-01-01T00:00:00Z')`);
  ok((await one(fresh, `select (password_expires_at = '2026-04-01T00:00:00Z'::timestamptz) ok from mt_main_user`)).ok, 'setup.sql: a password lasts 90 days');
  await fresh.exec(`update mt_main_user set password_changed_at = '2026-02-01T00:00:00Z'`);
  ok((await one(fresh, `select (password_expires_at = '2026-05-02T00:00:00Z'::timestamptz) ok from mt_main_user`)).ok, 'setup.sql: changing the password moves the expiry');
  ok(await throws(fresh, `insert into mt_main_user (employee_id, password_hash) values ('nobody', 'x')`), 'setup.sql: a login needs an employee');
  ok(await throws(fresh, `insert into mt_main_employee (employee_id, first_name, last_name, level) values ('9', 'a', 'b', 'X9')`), 'setup.sql: level from the list only');
  ok((await one(fresh, `select count(*)::int n from information_schema.columns where table_name = 'mt_main_employee' and column_name = 'photo'`)).n === 1, 'setup.sql: employee photo column (2.5:3 link in Storage img_main)');
  await fresh.close();
}

const db = new PGlite();
await db.exec(`do $$ begin create role anon; create role authenticated; exception when duplicate_object then null; end $$;`);
await db.exec(actSql('5s'));
await db.exec(actSql('5s'));
await db.exec(actSql('safety'));
await db.exec(actSql('kaizen', { audit: false }));
ok(true, 'schemas run twice; another activity (safety) and one without audits (kaizen) build from the same template');
{
  const r = await one(db, `select to_regclass('public.mt_kaizen_task') is not null p, to_regclass('public.tx_kaizen_audit') is null a, to_regclass('public.mt_kaizen_plan') is null g`);
  ok(r.p && r.a && r.g, 'activity without audits has the Planner but no audit tables (and no old Gantt plan table)');
}

// rules, on the safety tables
await db.exec(`
insert into mt_safety_area (code, area_type, name) values ('X1', 'โรงงาน', 'Test');
insert into mt_safety_checklist (year, item_no, s_group, title) values (2026, 1, 1, 'a'), (2026, 2, 1, 'b'), (2026, 3, 2, 'c');
insert into tx_safety_audit (audit_no, year, audit_type, area_id, audited_at, status) select 'C-X1-1', 2026, 'COMMITTEE', id, now(), 'COMPLETED' from mt_safety_area;
insert into tx_safety_audit_score select a.id, c.id, v.s from tx_safety_audit a, mt_safety_checklist c, (values (1, 5), (2, 3), (3, 4)) v(n, s) where c.item_no = v.n;
`);
const g = (await db.query(`select s_group, percent::float from v_safety_audit_group order by s_group`)).rows;
ok(g.length === 2 && g[0].percent === 80 && g[1].percent === 80, `group percent (got ${JSON.stringify(g)})`);
ok(await throws(db, `insert into mt_safety_area (code, area_type, name) values ('X2', 'บ้าน', 'x')`), 'area_type must be โรงงาน/สำนักงาน');
ok(await throws(db, `insert into mt_safety_team (year, employee_id, role) values (2026, '1', 'auditor')`), 'auditor needs a team');
ok(await throws(db, `insert into mt_safety_team (year, employee_id, role, team) values (2026, '1', 'admin', 'A')`), 'admin has no team');
await db.exec(`insert into mt_safety_team (year, employee_id, role) values (2026, '1', 'admin')`);
ok(await throws(db, `insert into mt_safety_team (year, employee_id, role) values (2026, '1', 'admin')`), 'same admin twice is refused (nulls not distinct)');
ok(await throws(db, `insert into mt_safety_audit_plan (year, area_id, month, week) select 2026, id, 1, 5 from mt_safety_area`), 'week must be 1-4');
// area owners live in the team table (role owner + area_id)
await db.exec(`insert into mt_safety_area (code, area_type, name) values ('X2', 'สำนักงาน', 'Test 2')`);
ok(await throws(db, `insert into mt_safety_team (year, employee_id, role) values (2026, '7', 'owner')`), 'owner needs an area');
await db.exec(`insert into mt_safety_team (year, employee_id, role, area_id) select 2026, '7', 'owner', id from mt_safety_area`);
ok((await one(db, `select count(*)::int n from mt_safety_team where role = 'owner' and employee_id = '7'`)).n === 2, 'one person may own several areas');
ok(await throws(db, `insert into mt_safety_team (year, employee_id, role, area_id) select 2026, '8', 'owner', id from mt_safety_area where code = 'X1'`), 'one owner per area per year');
await db.exec(`insert into mt_safety_team (year, employee_id, role, area_id) select 2027, '8', 'owner', id from mt_safety_area where code = 'X1'`);
ok(true, 'the area may get a new owner next year');
ok(await throws(db, `insert into mt_safety_team (year, employee_id, role, area_id) select 2026, '9', 'admin', id from mt_safety_area where code = 'X1'`), 'only owners carry an area');
await db.exec(`delete from mt_safety_area where code = 'X2'`);
ok((await one(db, `select count(*)::int n from mt_safety_team where role = 'owner' and employee_id = '7'`)).n === 1, 'deleting an area removes its owner rows');
ok((await one(db, `select count(*)::int n from mt_5s_setting`)).n === 5, 'settings seeded');
ok((await one(db, `select value from mt_5s_setting where key = 'issue_due_days_before_next'`)).value === '15', 'Action due 15 days before the next audit');
// 5S sub-teams (unit): a team member needs no department, a plain member still does, leads have none
await db.exec(`insert into mt_5s_team (year, employee_id, role, unit) values (2026, '50', 'member', 'standard'), (2026, '50', 'chairman', 'pr'), (2026, '51', 'advisor', null)`);
ok(true, 'sub-team member without department, team chairman, committee advisor');
ok(await throws(db, `insert into mt_5s_team (year, employee_id, role) values (2026, '52', 'member')`), 'a member outside a sub-team needs a department');
ok(await throws(db, `insert into mt_5s_team (year, employee_id, role, unit, department) values (2026, '52', 'chairman', 'pr', 'PD1')`), 'a lead has no department');
await db.exec(`insert into mt_5s_team (year, employee_id, role, unit) values (2026, '50', 'chairman', 'academic')`);
ok(true, 'the same person may lead two sub-teams');
await db.exec(`delete from mt_5s_team where employee_id in ('50', '51')`); // keep the real-data counts below exact
{
  // the earlier draft stored the sub-team as the role (standard / academic / pr): 5s.sql moves it to unit
  const old = new PGlite();
  await old.exec(`do $$ begin create role anon; create role authenticated; exception when duplicate_object then null; end $$;`);
  await old.exec(actSql('5s'));
  await old.exec(`alter table mt_5s_team drop constraint mt_5s_team_role_check; insert into mt_5s_team (year, employee_id, role) values (2026, '60', 'pr'), (2026, '61', 'academic'); update mt_5s_setting set value = '10' where key = 'issue_due_days_before_next'`);
  await old.exec(actSql('5s'));
  const r = (await old.query(`select employee_id, role, unit from mt_5s_team order by employee_id`)).rows;
  ok(r.length === 2 && r.every((x) => x.role === 'member') && r[0].unit === 'pr' && r[1].unit === 'academic', 'old draft roles become members of that sub-team');
  ok((await one(old, `select value from mt_5s_setting where key = 'issue_due_days_before_next'`)).value === '15', 'the old default 10 days becomes 15');
  await old.close();
}

// Project Planner: main items and sub items in one table (every activity has it)
await db.exec(actSql('100p', { audit: false }));
// A running activity adds the Planner and copies its old Gantt plan once (db/act/<act>_task.sql). The old plan
// table is no longer in the template, so make a copy of it here on the kaizen tables.
await db.exec(`create table mt_kaizen_plan (id bigint generated by default as identity primary key, title text not null, detail text,
  start_date date not null, end_date date not null, responsible text, status text not null default 'planned', created_by text not null)`);
await db.exec(`insert into mt_kaizen_plan (title, start_date, end_date, status, responsible, created_by) values
  ('Kick off', '2026-01-05', '2026-01-09', 'done', 'สมชาย', '1'),
  ('Patrol', '2026-03-02', '2026-03-06', 'planned', null, '1'),
  ('Patrol', '2026-06-01', '2026-06-05', 'planned', null, '1'),
  ('Old', '2026-02-02', '2026-02-03', 'cancelled', null, '1')`);
await db.exec(actTaskSql('kaizen'));
await db.exec(actTaskSql('kaizen'));
{
  const r = await one(db, `select
    (select count(*)::int from mt_kaizen_task where parent_id is null) main,
    (select count(*)::int from mt_kaizen_task where parent_id is not null) sub,
    (select progress from mt_kaizen_task where title = 'Kick off') kick,
    (select note from mt_kaizen_task where title = 'Kick off') note,
    (select start_date is null from mt_kaizen_task where title = 'Patrol' and parent_id is null) patrol_main`);
  ok(r.main === 2 && r.sub === 2 && r.kick === 100 && r.note === 'ผู้รับผิดชอบ: สมชาย' && r.patrol_main, `old plan copied once: one title = one item, two ranges = main + 2 sub items, cancelled skipped (got ${JSON.stringify(r)})`);
}
await db.exec(actTaskSql('safety'));
ok(true, 'the add-on file also runs where there is no old plan table');
await db.exec(`insert into mt_100p_task (year, title, created_by) values (2026, 'เตรียมโครงการ', '1')`);
ok(true, 'a main item may wait for dates');
await db.exec(`insert into mt_100p_task (year, parent_id, title, start_date, end_date, progress, created_by) select 2026, id, 'ตั้งทีม', '2026-01-05', '2026-01-30', 100, '1' from mt_100p_task`);
ok(await throws(db, `insert into mt_100p_task (year, parent_id, title, created_by) select 2026, id, 'x', '1' from mt_100p_task where parent_id is null`), 'a sub item needs dates');
ok(await throws(db, `insert into mt_100p_task (year, title, start_date, created_by) values (2026, 'x', '2026-01-01', '1')`), 'start and end come together');
ok(await throws(db, `insert into mt_100p_task (year, title, start_date, end_date, created_by) values (2026, 'x', '2026-02-02', '2026-02-01', '1')`), 'task end date not before start');
ok(await throws(db, `insert into mt_100p_task (year, title, progress, created_by) values (2026, 'x', 101, '1')`), 'progress 0-100');
await db.exec(`delete from mt_100p_task where parent_id is null`);
ok((await one(db, `select count(*)::int n from mt_100p_task`)).n === 0, 'deleting a main item removes its sub items');
{
  // Plan vs actual: done early / on time / late, overdue, behind / on plan / ahead of the straight-line % for today
  const { planStatus, withSpans: spans } = await import('../server/modules/act/planner.js');
  const t = { start_date: '2026-01-01', end_date: '2026-11-30' };
  ok(planStatus({ ...t, progress: 100, done_on: '2026-10-20' }, '2026-10-29').code === 'early' && planStatus({ ...t, progress: 100, done_on: '2026-10-20' }).text === 'เสร็จก่อนแผน 41 วัน', 'done 41 days before the end = early');
  ok(planStatus({ ...t, progress: 100, done_on: '2026-11-30' }).code === 'done' && planStatus({ ...t, progress: 100, done_on: '2026-12-03' }).text === 'เสร็จช้า 3 วัน', 'done on the end day = on time, after = late');
  ok(planStatus({ ...t, progress: 60 }, '2026-12-05').text === 'เลยกำหนด 5 วัน', 'open after the end day = overdue');
  ok(planStatus({ ...t, progress: 40 }, '2026-10-29').code === 'behind' && planStatus({ ...t, progress: 40 }, '2026-10-29').expected === 90, 'Oct 29 of a Jan–Nov plan should be 90%: 40% is behind');
  ok(planStatus({ ...t, progress: 85 }, '2026-10-29').code === 'ontrack' && planStatus({ ...t, progress: 30 }, '2026-02-01').code === 'ahead', 'within 10 points = on plan, more = ahead');
  ok(planStatus({ ...t, progress: 0 }, '2025-12-01').code === 'waiting' && planStatus({ progress: 0 }).code === 'none', 'not started yet / no dates');
  const parent = spans([{ id: 1, parent_id: null, progress: 0 }, { id: 2, parent_id: 1, start_date: '2026-01-01', end_date: '2026-01-10', progress: 100, done_on: '2026-01-08' }, { id: 3, parent_id: 1, start_date: '2026-02-01', end_date: '2026-02-10', progress: 100, done_on: '2026-02-05' }])[0];
  ok(parent.done_on === '2026-02-05' && planStatus(parent).code === 'early', 'a main item is done when all sub items are, on the last one\'s day');
}
{
  const { withSpans } = await import('../server/modules/act/planner.js');
  const rows = withSpans([
    { id: 1, parent_id: null, start_date: null, end_date: null, progress: 0 },
    { id: 2, parent_id: 1, start_date: '2026-01-01', end_date: '2026-01-10', progress: 100 },
    { id: 3, parent_id: 1, start_date: '2026-01-21', end_date: '2026-02-19', progress: 20 },
    { id: 4, parent_id: null, start_date: '2026-03-01', end_date: '2026-03-02', progress: 40 }
  ]);
  ok(rows[0].derived && rows[0].start_date === '2026-01-01' && rows[0].end_date === '2026-02-19', 'main item spans its sub items');
  ok(rows[0].progress === 40, `main item % weighted by days (got ${rows[0].progress})`);
  ok(!rows[3].derived && rows[3].progress === 40 && !rows[1].derived, 'items without sub items keep their own values');
}

if (!fs.existsSync(importFile)) {
  console.log('skip real data: inbox/import_5s.sql not found (python -I scripts/import_5s_excel.py)');
} else {
  const sql = fs.readFileSync(importFile, 'utf8');
  await db.exec(sql);
  await db.exec(sql);
  ok(true, 'real import runs twice');
  const parts = path.join(ROOT, 'inbox', 'import_5s');
  for (const f of fs.readdirSync(parts).sort()) await db.exec(fs.readFileSync(path.join(parts, f), 'utf8'));
  ok(true, 'import part files run on top of it');
  const c = await one(db, `select
    (select count(*)::int from mt_5s_area) areas,
    (select count(*)::int from mt_5s_team where role = 'owner') owners,
    (select count(*)::int from mt_5s_team where role <> 'owner') team,
    (select count(*)::int from mt_5s_checklist) checklist,
    (select count(*)::int from mt_5s_audit_plan) plans,
    (select count(*)::int from tx_5s_audit) audits,
    (select count(*)::int from tx_5s_audit_score) scores,
    (select count(*)::int from tx_5s_audit where cardinality(auditors) > 0) people,
    (select count(*)::int from tx_5s_issue) issues,
    (select coalesce(sum(cardinality(photo_before) + cardinality(photo_after)), 0)::int from tx_5s_issue) photos`);
  console.log('     counts', JSON.stringify(c));
  ok(c.areas === 34 && c.owners === 34 && c.team === 19 && c.checklist === 25 && c.plans === 14 && c.audits === 33 && c.issues === 52 && c.people === 33 && c.photos === 54, 'all rows imported (owners in team, auditors on audits, photos on issues)');
  ok(c.scores === 33 * 25, `25 scores per audit (got ${c.scores})`);
  const bad = await one(db, `select count(*)::int n from tx_5s_audit a where abs((select sum(score) from tx_5s_audit_score s where s.audit_id = a.id) - a.total_score) > 0.001`);
  ok(bad.n === 0, 'stored total = sum of item scores');
  const sep = await one(db, `select round(avg(percent_score), 2)::float p, count(*)::int n from tx_5s_audit where extract(month from audited_at at time zone 'Asia/Bangkok') = 9`);
  ok(sep.p === 86.67 && sep.n === 33, `September 5S % = 86.67 over 33 audits (got ${sep.p} / ${sep.n})`);

  // The server's own dashboard functions on the same rows.
  const { summarize, rank } = await import('../server/modules/act/audit.js');
  const areas = (await db.query(`select id::int, code, area_type, name, section, status from mt_5s_area order by code`)).rows;
  const audits = (await db.query(`select id::int, audit_no, audit_type, area_id::int, team, audited_at::text, total_score::float, percent_score::float, result from tx_5s_audit where year = 2026 and status = 'COMPLETED'`)).rows;
  const groups = (await db.query(`select audit_id::int, s_group, percent::float from v_5s_audit_group`)).rows;
  const s = summarize(audits, groups);
  ok(s.groups.map((x) => x.percent).join('/') === '85.2/82.5/87/88.7/89.8' && s.months[8].percent === 86.67 && s.months[8].audits === 33, 'summarize() = old Summary page (85.2/82.5/87.0/88.7/89.8, Sep 86.67% of 33)');
  const r = rank(areas, audits, groups, 10);
  const f = r.types['โรงงาน'];
  const o = r.types['สำนักงาน'];
  ok(f.rows.length === 18 && f.rows[0].name === 'ASSY PD4' && f.rows[0].groups.join('/') === '100/92/100/100/92' && f.rows[0].average === 96.8, 'rank(): factory #1 ASSY PD4 100/92/100/100/92 · 96.8 of 18 areas');
  ok(f.total.groups.join('/') === '88.2/85.1/88/91.8/90' && f.total.average === 88.6, 'rank(): factory total = old Ranking (88.2/85.1/88.0/91.8/90.0 · 88.6)');
  ok(o.rows.length === 15 && o.rows[0].name === 'CIC' && o.total.groups.join('/') === '81.6/79.5/85.9/85.1/89.6' && o.total.average === 84.3, 'rank(): office = old Ranking (CIC first · 84.3)');
}

// Transaction rules (server/modules/act/transaction.js)
{
  const { scoreAudit, verifyIssues, dueDateFor, weekStartIso, shownStatus, photosOf } = await import('../server/modules/act/transaction.js');
  ok(JSON.stringify(photosOf({ photo_before: ['b1'], photo_after: ['a1', 'a2'] })) === JSON.stringify([{ kind: 'BEFORE', url: 'b1' }, { kind: 'AFTER', url: 'a1' }, { kind: 'AFTER', url: 'a2' }]) && photosOf({}).length === 0, 'photosOf() turns the Issue photo lists into [{ kind, url }] for the page');
  const items = [1, 2, 3, 4, 5].map((id) => ({ id, score_max: 5 }));
  const sc = scoreAudit(items, new Map([[1, 5], [2, 4], [3, 4], [4, 3], [5, 4]]), 80);
  ok(sc.total === 20 && sc.percent === 80 && sc.result === 'PASS', `scoreAudit 20/25 = 80% PASS (got ${JSON.stringify(sc)})`);
  ok(scoreAudit(items, new Map([[1, 5], [2, 4], [3, 4], [4, 3], [5, 3]]), 80).result === 'NEED_IMPROVE', 'scoreAudit 19/25 = 76% NEED_IMPROVE');
  const open = [
    { id: 10, checklist_id: 1, action_description: '', after_photos: 0 },
    { id: 11, checklist_id: 2, action_description: 'ติดป้ายแล้ว', after_photos: 1 },
    { id: 12, checklist_id: 3, action_description: 'จัดใหม่', after_photos: 1 },
    { id: 13, checklist_id: 4, action_description: 'มีข้อความแต่ไม่มีรูป', after_photos: 0 }
  ];
  const v = verifyIssues(open, new Map([[1, 5], [2, 4], [3, 2], [4, 5], [5, 5]]));
  const by = Object.fromEntries(v.updates.map((u) => [u.id, u.status]));
  ok(v.scores.get(1) === 0 && by[10] === 'OVERDUE', 'no action -> item 0 + OVERDUE');
  ok(by[11] === 'CLOSED' && v.scores.get(2) === 4, 'action + score 4 -> CLOSED');
  ok(by[12] === 'OPEN' && v.updates.find((u) => u.id === 12).carry, 'action + score 2 (still below 3) -> carries on');
  ok(verifyIssues([open[2]], new Map([[3, 3]])).updates[0].status === 'CLOSED', 'action + score 3 (no longer below 3) -> CLOSED');
  ok(by[13] === 'OVERDUE' && v.scores.get(4) === 0, 'action text without after photo counts as no action');
  ok(weekStartIso(2026, 10, 3) === '2026-10-15', 'week 3 starts on the 15th');
  const plans = [{ year: 2026, month: 10, week: 1 }, { year: 2027, month: 1, week: 2 }, { year: 2026, month: 9, week: 1 }];
  ok(dueDateFor(plans, '2026-09-04', 10) === '2026-09-21', `due = next plan (1 Oct) - 10 days (got ${dueDateFor(plans, '2026-09-04', 10)})`);
  ok(dueDateFor(plans, '2026-10-05', 10) === '2026-12-29', 'due crosses into next year (8 Jan 2027 - 10)');
  ok(dueDateFor(plans, '2027-02-01', 10) === null, 'no next plan -> due null (รอกำหนด)');
  ok(shownStatus({ status: 'OPEN', due_date: '2026-09-11' }, '2026-10-25') === 'OVERDUE' && shownStatus({ status: 'ON_PLAN', due_date: '2026-09-11' }, '2026-10-25') === 'ON_PLAN', 'OPEN past due shows OVERDUE, actions keep their status');
  if (fs.existsSync(importFile)) {
    const real = (await db.query(`select id::int, checklist_id::int, action_description, 0 as after_photos from tx_5s_issue where area_id = (select id from mt_5s_area where code = 'B11')`)).rows;
    const rv = verifyIssues(real, new Map());
    ok(real.length > 0 && rv.updates.every((u) => u.status === 'OVERDUE'), `real data: B11 has ${real.length} open Issues without action -> all OVERDUE at the next committee audit`);
  }
}

// CFO (db/act/cfo.sql + inbox/import_cfo.sql from python -I scripts/import_cfo_excel.py): totals must match the Excel.
ok(fs.readFileSync(path.join(ROOT, 'db', 'act', 'cfo.sql'), 'utf8') === actSql('cfo', { audit: false, planner: false }), 'db/act/cfo.sql is up to date (node scripts/act-sql.js cfo --no-audit --no-planner)');
await db.exec(actSql('cfo', { audit: false, planner: false }));
await db.exec(actSql('cfo', { audit: false, planner: false }));
ok(await throws(db, `insert into mt_cfo_team (year, employee_id, role) values (2026, '1', 'member')`), 'a member needs a department');
await db.exec(`insert into mt_cfo_team (year, employee_id, role, department) values (2026, '1', 'member', 'PD1'), (2026, '1', 'member', 'PD2')`);
ok(true, 'one person may represent several departments');
ok(await throws(db, `insert into mt_cfo_scope (code, scope, name) values ('4-1', 4, 'x')`), 'scope is 1-3');
// EF reference tables (Setting > Emission Factor): the seed fills each table once, so a re-run keeps edits.
const refSeed = fs.readFileSync(path.join(ROOT, 'db', 'act', 'cfo_ef_ref_seed.sql'), 'utf8');
await db.exec(refSeed);
await db.exec(`update mt_cfo_ef_ref set total = 9 where sheet = 'chemical' and name = 'R-32'`);
await db.exec(refSeed);
const ref = await one(db, `select (select count(*)::int from mt_cfo_ef_ref where sheet = 'energy') energy, (select count(*)::int from mt_cfo_ef_ref where sheet = 'chemical') chemical,
  (select count(*)::int from mt_cfo_ef_ref where sheet = 'ipcc') ipcc, (select count(*)::int from mt_cfo_ef_ref where sheet = 'fuel') fuel, (select total::float from mt_cfo_ef_ref where name = 'R-32') r32, (select ch4::float from mt_cfo_gwp where code = 'AR5') ch4`);
ok(ref.energy > 100 && ref.chemical > 10 && ref.ipcc > 40 && ref.fuel === 30 && ref.r32 === 9 && ref.ch4 === 28, `EF reference seed runs twice without duplicates or overwrites ${JSON.stringify(ref)}`);
ok(await throws(db, `insert into mt_cfo_ef_ref (sheet, name) values ('web', 'x')`), 'EF reference sheet is energy / chemical / ipcc / fuel / cfp');
await db.exec(`insert into mt_cfo_ef_ref (sheet, name, unit, total) values ('cfp', 'Steel sheet', 'kg', 2.3); delete from mt_cfo_ef_ref where sheet = 'cfp'`);
const cfoFile = path.join(ROOT, 'inbox', 'import_cfo.sql');
if (!fs.existsSync(cfoFile)) {
  console.log('skip CFO data: inbox/import_cfo.sql not found (python -I scripts/import_cfo_excel.py)');
} else {
  await db.exec(fs.readFileSync(cfoFile, 'utf8'));
  await db.exec(fs.readFileSync(cfoFile, 'utf8'));
  const c = await one(db, `select (select count(*)::int from mt_cfo_scope) scopes, (select count(*)::int from mt_cfo_ef) ef, (select count(*)::int from mt_cfo_activity) activities,
    (select count(*)::int from tx_cfo_entry) entries, (select count(*)::int from mt_cfo_team where role = 'member') members,
    (select round(sum(tco2e), 3)::float from v_cfo_entry where scope = 1) s1, (select round(sum(tco2e), 3)::float from v_cfo_entry where scope = 2) s2,
    (select tco2e::float from v_cfo_entry where activity = 'Septic Tank' and month = '2026-01-01') septic`);
  console.log('     cfo', JSON.stringify(c));
  ok(c.scopes === 23 && c.ef === 302 && c.activities === 34 && c.entries === 187, 'CFO rows imported once (23 scopes, 302 EF, 34 activities, 167 + 20 entries)');
  ok(Math.abs(c.s1 - 188.863) < 0.01 && Math.abs(c.s2 - 6642.52) < 0.01, `tCO2e = Excel (scope 1 188.863 / scope 2 6642.52, got ${c.s1} / ${c.s2})`);
  ok(c.septic === 32.844, `septic 1,173 kg CH4 x 28 = 32.844 tCO2e (got ${c.septic})`);
  // Fr-04.1 รายงานแยก: an EF marked separate leaves the Scope totals (v_cfo_month) and shows its non-Kyoto part.
  await db.exec(`begin; update mt_cfo_ef set separate = true, other = 1, other_gwp = 1760 where id = (select ef_id from tx_cfo_entry where qty > 0 order by id limit 1)`);
  const sep = await one(db, `select (select round(sum(tco2e), 3)::float from v_cfo_month where scope = 1) s1, (select round(sum(tco2e), 3)::float from v_cfo_entry where separate) sep,
    (select sum(tco2e_other)::float from v_cfo_entry where separate) other`);
  await db.exec('rollback');
  ok(Math.abs(sep.s1 + sep.sep - 188.863) < 0.01 && sep.other > 0, `separately reported EF leaves Scope 1 (${sep.s1} + ${sep.sep}) and carries its non-Kyoto tCO2e`);
  // EF การได้มาของเชื้อเพลิง (ef3_id): the same quantity adds a Scope 3-3 line and leaves Scope 1 as it was.
  await db.exec(`begin; insert into mt_cfo_ef (code, scope_code, name, unit, kgco2e) values ('t-up', '3-3', 'Diesel B7 upstream', 'Liter', 0.5);
    update tx_cfo_entry set ef3_id = (select id from mt_cfo_ef where code = 't-up') where id = (select id from tx_cfo_entry where qty > 0 order by id limit 1)`);
  const up = await one(db, `select (select round(sum(tco2e), 3)::float from v_cfo_month where scope = 1) s1, (select tco2e::float from v_cfo_entry where part = 'upstream') t3,
    (select round(qty * 0.5 / 1000, 6)::float from tx_cfo_entry where ef3_id is not null) want, (select scope_code from v_cfo_entry where part = 'upstream') code`);
  await db.exec('rollback');
  ok(Math.abs(up.s1 - 188.863) < 0.01 && up.t3 === up.want && up.code === '3-3', `the 3-3 line uses the entry quantity × its EF (${up.t3}) and Scope 1 stays ${up.s1}`);
  // วัสดุ (SAP): usage rows join v_cfo_entry as Scope 3 (qty in EF units) and v_cfo_month counts them; Scope 1 untouched.
  await db.exec(`begin; insert into mt_cfo_material (material, name, sap_unit, factor) values ('700001', 'A4 80g', 'REAM', 2.495);
    insert into tx_cfo_material (month, department, material, name, qty, unit, factor, source, ef_unit, kgco2e, scope_code, tco2e, uploaded_by)
    values ('2026-10-01', 'QSM', '700001', 'A4 80g', 100, 'REAM', 2.495, 'Paper', 'kg', 1.2, '3-1', 0.2994, 't')`);
  const mat = await one(db, `select (select round(sum(tco2e), 3)::float from v_cfo_month where scope = 1) s1, (select qty::float from v_cfo_entry where part = 'material') qty,
    (select tco2e::float from v_cfo_month where scope = 3 and month = '2026-10-01') s3`);
  await db.exec('rollback');
  ok(Math.abs(mat.s1 - 188.863) < 0.01 && mat.qty === 249.5 && mat.s3 >= 0.2994, `SAP material usage counts in Scope 3 (${mat.qty} kg, ${mat.s3} tCO2e)`);
  ok(await throws(db, `insert into mt_cfo_material (material, name, scope_code) values ('x', 'x', '1-1')`), 'a material belongs to a Scope 3 category');
  ok(await throws(db, `insert into mt_cfo_s3_assess (year, scope_code) values (2026, '1-1')`), 'Fr-03.2 rows are Scope 3 categories only');
  {
    // Fr-03.2 weighted (VerificationSheet CFO): M 5 · I 3 · R 3 · O 5 = 2.00 + 0.90 + 0.45 + 0.75 = 4.10 · all 1 = 1.00 · 13.19% → level 2
    const { s3Rule, s3Weighted, s3MagLevel } = await import('../server/modules/act/cfo.js');
    const rule = s3Rule({});
    ok(s3Weighted({ magnitude: 5, influence: 3, risk: 3, opportunity: 5 }, rule) === 4.1 && s3Weighted({ magnitude: 1, influence: 1, risk: 1, opportunity: 1 }, rule) === 1
      && s3MagLevel(13.19, rule) === 2 && s3MagLevel(9.99, rule) === 1 && s3MagLevel(40, rule) === 5 && rule.pass === 3, 'Fr-03.2 score = 0.40 M + 0.30 I + 0.15 R + 0.15 O, Magnitude bands 10/20/30/40%');
  }
  {
    // Fr-03.2 criteria were ✓ / × (boolean) and are now % scores: ✓ = 1.00, × = 0, and the file runs again cleanly
    const old = new PGlite();
    await old.exec(`create table mt_cfo_s3_assess (year integer, scope_code text, has_source boolean not null default true, magnitude boolean not null default false,
      influence boolean not null default false, risk boolean not null default false, sector boolean not null default false, outsourcing boolean not null default false,
      engagement boolean not null default false, remark text, updated_by text, updated_at timestamptz, primary key (year, scope_code));
      insert into mt_cfo_s3_assess (year, scope_code, magnitude, risk) values (2025, '3-1', true, false);`);
    const cfo = actSql('cfo', { audit: false, planner: false }).replace(/notify pgrst[^;]*;/, '');
    await old.exec(cfo);
    await old.exec(cfo);
    const r = await one(old, `select magnitude::float m, risk::float r, (select data_type from information_schema.columns where table_name = 'mt_cfo_s3_assess' and column_name = 'sector') t from mt_cfo_s3_assess`);
    await old.exec(`update mt_cfo_s3_assess set magnitude = 5.25`);
    ok(r.m === 1 && r.r === 0 && r.t === 'numeric', 'Fr-03.2 old ✓ / × become 1.00 / 0 % scores (numeric), run twice');
  }
  ok(await throws(db, `insert into mt_cfo_ef (scope_code, name, unit, source_type) values ('1-1', 'x', 'L', 'web')`), 'EF data source is one of the Fr-04.1 types');
  // B7 (EF TGO AR5 V2): Scope 1 total + biogenic CO2 reported apart, both per liter of the blend.
  await db.exec(`begin; update mt_cfo_ef set co2_bio = 0.11507832 where id = (select ef_id from tx_cfo_entry where qty > 0 order by id limit 1)`);
  const bio = await one(db, `select round(sum(tco2e_bio), 6)::float bio, (select round(sum(tco2e), 3)::float from v_cfo_month where scope = 1) s1,
    round(sum(qty) * 0.11507832 / 1000, 6)::float want from v_cfo_entry where tco2e_bio > 0`);
  await db.exec('rollback');
  ok(Math.abs(bio.bio - bio.want) < 1e-5 && Math.abs(bio.s1 - 188.863) < 0.01, `biogenic CO2 = qty × co2_bio / 1000 (${bio.bio}) and stays out of Scope 1`);
  ok(await throws(db, `update mt_cfo_activity set calc = 'other' where id = (select min(id) from mt_cfo_activity)`), 'activity formula is septic / tkm / km_fuel');
  const { CFO_CALCS } = await import('../server/modules/act/cfo.js');
  ok(CFO_CALCS.tkm.qty({ tons: 12.5, km: 80 }) === 1000 && CFO_CALCS.km_fuel.qty({ km: 450, km_per_l: 12 }) === 37.5 && !CFO_CALCS.km_fuel.ok({ km: 1, km_per_l: 0 }),
    'transport tkm = ตัน × กม., km_fuel = กม. ÷ กม./ลิตร');
}

// Sheet status flow (common.js), search text for PostgREST or()
const { statusMove, sheetEditable } = await import('../server/modules/act/common.js');
ok(sheetEditable('DRAFT', { owner: true }) && sheetEditable('REJECTED', { owner: true }) && !sheetEditable('SUBMITTED', { owner: true }) && !sheetEditable('APPROVED', { owner: true }), 'owner edits only a draft or a rejected sheet (sent = locked)');
ok(sheetEditable('APPROVED', { admin: true }) && !sheetEditable('DRAFT', {}), 'admin edits any sheet, others none');
const { cleanTerm } = await import('../server/core/http.js');
const who = (o) => ({ owner: false, reviewer: false, admin: false, self: false, denied: 'no', ...o });
ok(statusMove('DRAFT', 'SUBMITTED', who({ owner: true })) === null && statusMove('REJECTED', 'SUBMITTED', who({ owner: true })) === null, 'owner sends a draft or a rejected sheet');
ok(statusMove('APPROVED', 'SUBMITTED', who({ owner: true }))?.[0] === 409, 'an approved sheet cannot be sent again');
ok(statusMove('DRAFT', 'SUBMITTED', who({ reviewer: true }))?.[0] === 403, 'a reviewer who is not the owner cannot send');
ok(statusMove('SUBMITTED', 'APPROVED', who({ reviewer: true })) === null && statusMove('APPROVED', 'REJECTED', who({ reviewer: true })) === null, 'reviewer decides a sent sheet and may change the decision');
ok(statusMove('DRAFT', 'APPROVED', who({ reviewer: true }))?.[0] === 409, 'a draft cannot be approved before it is sent');
ok(statusMove('APPROVED', 'DRAFT', who({ reviewer: true, admin: true }))?.[0] === 400, 'nobody moves a sheet back to DRAFT');
ok(statusMove('SUBMITTED', 'APPROVED', who({ reviewer: true, self: true }))?.[0] === 403 && statusMove('SUBMITTED', 'APPROVED', who({ reviewer: true, admin: true, self: true })) === null, 'no self-approval except the admin');
ok(statusMove('SUBMITTED', 'APPROVED', who({ owner: true }))?.[0] === 403, 'the owner cannot approve');
ok(cleanTerm(' นาย (A), 50%_x*"\\ ') === 'นาย A 50x', 'search text drops % _ * , ( ) " \\');

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
