import { tx } from '../../core/db.js';
import { fail } from '../../core/http.js';
import { PROJECT_ON, accessOf, actRoute, imageBytes, must, projectsOf, requireAdmin, tablesOf, yearOf } from './common.js';

// SMF (Smart Factory) projects of a year (ผู้ใช้กำหนด 2026-11-01: 2026 = Smart OEE, Vision Camera, Work Flow Automation).
// Setting > โครงการ: admins add / edit / delete; a project already used by the team or the plan becomes Inactive instead.
// The code is what mt_smf_team.unit and mt_smf_task.unit point at, so it cannot change once used.
const CODE = /^[a-z0-9_-]{1,20}$/;

export function mountSmf(app) {
  const route = actRoute(app, { only: PROJECT_ON });
  const usedBy = async (t, project) => {
    const [team, task] = await Promise.all([
      tx.from(t.team).select('id', { count: 'exact', head: true }).eq('year', project.year).eq('unit', project.code),
      tx.from(t.task).select('id', { count: 'exact', head: true }).eq('year', project.year).eq('unit', project.code)
    ]);
    if (team.error || task.error) throw team.error || task.error;
    return (team.count || 0) + (task.count || 0);
  };
  const input = (body) => {
    const name = String(body?.name || '').trim().slice(0, 120);
    const code = String(body?.code || '').trim().toLowerCase();
    if (!name) return { error: 'ระบุชื่อโครงการ' };
    if (!CODE.test(code)) return { error: 'รหัสใช้ a–z 0–9 - _ ไม่เกิน 20 ตัว เช่น oee' };
    const sort = Number(body?.sortNo);
    const targetName = body?.targetName != null ? String(body.targetName).trim().slice(0, 80) || null : undefined;
    const unit = body?.unit != null ? String(body.unit).trim().slice(0, 30) || null : undefined;
    const teamType = ['team', 'individual'].includes(body?.teamType) ? body.teamType : 'team';
    const targetType = ['plan', 'count'].includes(body?.targetType) ? body.targetType : 'plan';
    const targetCount = Number.isInteger(Number(body?.targetCount)) && Number(body.targetCount) > 0 ? Number(body.targetCount) : null;
    const row = {
      name,
      code,
      sort_no: Number.isInteger(sort) && sort > 0 ? sort : 1,
      status: body?.status === 'Inactive' ? 'Inactive' : 'Active',
      team_type: teamType,
      target_type: targetType,
      target_count: targetType === 'count' ? targetCount : null
    };
    if (targetName !== undefined) row.target_name = targetName;
    if (unit !== undefined) row.unit = unit;
    return { row };
  };

  route('get', '/api/act/:activity/projects', async (req, res, activity) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    res.json({ year, projects: await projectsOf(activity, year) });
  });

  route('post', '/api/act/:activity/projects', async (req, res, activity, t) => {
    const year = yearOf(req.body?.year);
    if (!year || !(await requireAdmin(req, res, activity, year))) return;
    const { row, error } = input(req.body);
    if (error) return fail(res, 400, error);
    let done = await tx.from(t.project).insert({ ...row, year });
    if (done.error?.code === '42703') {
      const { team_type, target_type, target_count, ...legacy } = row;
      done = await tx.from(t.project).insert({ ...legacy, year });
    }
    if (done.error?.code === '23505') return fail(res, 400, `ปี ${year} มีรหัส ${row.code} แล้ว`);
    must(done);
    res.status(201).json({ ok: true });
  });

  route('patch', '/api/act/:activity/projects/:id', async (req, res, activity, t) => {
    const project = must(await tx.from(t.project).select('*').eq('id', Number(req.params.id)).maybeSingle());
    if (!project) return fail(res, 404, 'ไม่พบโครงการ');
    if (!(await requireAdmin(req, res, activity, project.year))) return;
    const { row, error } = input({ code: project.code, ...req.body });
    if (error) return fail(res, 400, error);
    if (row.code !== project.code && await usedBy(t, project)) return fail(res, 400, 'โครงการนี้มีทีม / แผนงานแล้ว เปลี่ยนรหัสไม่ได้');
    let done = await tx.from(t.project).update(row).eq('id', project.id);
    if (done.error?.code === '42703') {
      const { team_type, target_type, target_count, ...legacy } = row;
      done = await tx.from(t.project).update(legacy).eq('id', project.id);
    }
    if (done.error?.code === '23505') return fail(res, 400, `ปี ${project.year} มีรหัส ${row.code} แล้ว`);
    must(done);
    res.json({ ok: true });
  });

  route('delete', '/api/act/:activity/projects/:id', async (req, res, activity, t) => {
    const project = must(await tx.from(t.project).select('*').eq('id', Number(req.params.id)).maybeSingle());
    if (!project) return fail(res, 404, 'ไม่พบโครงการ');
    if (!(await requireAdmin(req, res, activity, project.year))) return;
    if (await usedBy(t, project)) {
      must(await tx.from(t.project).update({ status: 'Inactive' }).eq('id', project.id));
      return res.json({ ok: true, inactive: true });
    }
    must(await tx.from(t.project).delete().eq('id', project.id));
    res.json({ ok: true });
  });

  // Next year: copy the Active projects (codes and names) from another year; existing codes are kept.
  route('post', '/api/act/:activity/projects/copy', async (req, res, activity, t) => {
    const from = yearOf(req.body?.from);
    const to = yearOf(req.body?.to);
    if (!from || !to || from === to) return fail(res, 400, 'เลือกปีต้นทางและปลายทาง');
    if (!(await requireAdmin(req, res, activity, to))) return;
    const rows = (await projectsOf(activity, from)).filter((p) => p.status === 'Active');
    if (!rows.length) return fail(res, 400, `ปี ${from} ไม่มีโครงการ Active ให้คัดลอก`);
    let done = await tx.from(tablesOf(activity).project).upsert(rows.map(({ code, name, sort_no, status, target_name, unit, team_type, target_type, target_count }) => ({ year: to, code, name, sort_no, status, target_name, unit, team_type, target_type, target_count })), { onConflict: 'year,code', ignoreDuplicates: true });
    if (done.error?.code === '42703') {
      done = await tx.from(tablesOf(activity).project).upsert(rows.map(({ code, name, sort_no, status, target_name, unit }) => ({ year: to, code, name, sort_no, status, target_name, unit })), { onConflict: 'year,code', ignoreDuplicates: true });
    }
    must(done);
    res.json({ ok: true, copied: rows.length });
  });

  // Monthly Target & Actual for each project (ผู้ใช้สั่ง 2026-11-01)
  route('get', '/api/act/:activity/project-months', async (req, res, activity, t) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const [projects, { data, error }] = await Promise.all([
      projectsOf(activity, year),
      tx.from(t.projectMonth).select('*').eq('year', year).order('month')
    ]);
    if (error?.code === 'PGRST205') return res.json({ year, projects, months: [] });
    if (error) throw error;
    res.json({ year, projects, months: data || [] });
  });

  route('put', '/api/act/:activity/project-months', async (req, res, activity, t) => {
    const year = yearOf(req.body?.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const projectId = Number(req.body?.projectId);
    if (!projectId) return fail(res, 400, 'ระบุโครงการ');
    const [projectResult, access] = await Promise.all([
      tx.from(t.project).select('*').eq('id', projectId).eq('year', year).maybeSingle(),
      accessOf(req, activity, year)
    ]);
    const project = must(projectResult);
    if (!project) return fail(res, 404, 'ไม่พบโครงการ');
    // an SMF project is led by its own team (common.js accessOf): a member of another project may not write it (audit 2026-11-03)
    const inProject = !access.admin && must(await tx.from(t.team).select('id').eq('year', year).eq('employee_id', req.user.employeeId)
      .eq('status', 'Active').eq('unit', project.code).limit(1)).length > 0;
    if (!access.admin && !inProject) return fail(res, 403, 'บันทึกได้เฉพาะ admin หรือทีมของโครงการนี้');

    const rawList = Array.isArray(req.body?.months) ? req.body.months : [req.body];
    const rows = [];
    for (const item of rawList) {
      const month = Number(item.month);
      if (!Number.isInteger(month) || month < 1 || month > 12) continue;
      const target = item.target != null && item.target !== '' ? Number(item.target) : null;
      const actual = item.actual != null && item.actual !== '' ? Number(item.actual) : null;
      if (target != null && Number.isNaN(target)) return fail(res, 400, `Target เดือน ${month} ไม่ถูกต้อง`);
      if (actual != null && Number.isNaN(actual)) return fail(res, 400, `Actual เดือน ${month} ไม่ถูกต้อง`);
      const note = item.note != null ? String(item.note).trim().slice(0, 300) : null;
      rows.push({
        year,
        project_id: projectId,
        month,
        target,
        actual,
        note,
        updated_by: req.user.employeeId,
        updated_at: new Date().toISOString()
      });
    }
    if (!rows.length) return fail(res, 400, 'ไม่มีข้อมูลเดือนที่ถูกต้อง');

    const done = await tx.from(t.projectMonth).upsert(rows, { onConflict: 'project_id,month' });
    must(done);
    res.json({ ok: true, saved: rows.length });
  });

  // Dashboard > Introduction (ผู้ใช้กำหนด 2026-11-04): the pages of a year, uploaded by the ผู้ดูแล in Setting > Introduction as
  // images or a PDF (the browser turns each PDF page into a JPEG) · JPEG ≤ 700 KB in the activity bucket intro/<year>/ ·
  // the list is mt_<act>_setting intro_<year> = JSON [{ url, path }] · a year without pages shows the latest year before it
  const introKey = (year) => `intro_${year}`;
  const introOf = async (t) => {
    const rows = must(await tx.from(t.setting).select('key,value')).filter((r) => /^intro_\d{4}$/.test(r.key));
    return new Map(rows.map((r) => {
      try { return [Number(r.key.slice(6)), JSON.parse(r.value)]; } catch { return [Number(r.key.slice(6)), []]; }
    }).filter(([y, pages]) => y && Array.isArray(pages) && pages.length));
  };
  route('get', '/api/act/:activity/intro', async (req, res, activity, t) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const all = await introOf(t);
    const shown = [...all.keys()].filter((y) => y <= year).sort((a, b) => b - a)[0] || null;
    res.json({ year, shown, years: [...all.keys()].sort(), pages: shown ? all.get(shown).map((p) => p.url) : [] });
  });
  // pages: [data:image/jpeg;base64,...] in order · mode replace (the first batch) or append (the next batches)
  route('post', '/api/act/:activity/intro', async (req, res, activity, t) => {
    const year = yearOf(req.body?.year);
    if (!year || !(await requireAdmin(req, res, activity, year))) return;
    const images = Array.isArray(req.body?.pages) ? req.body.pages.slice(0, 10) : [];
    if (!images.length) return fail(res, 400, 'ยังไม่มีหน้าเอกสาร');
    const bytes = images.map(imageBytes);
    if (bytes.some((b) => !b)) return fail(res, 400, 'แต่ละหน้าต้องเป็น JPEG ไม่เกิน 700 KB');
    const old = (await introOf(t)).get(year) || [];
    const replace = req.body?.mode !== 'append';
    const stamp = Date.now();
    const added = [];
    for (const [i, b] of bytes.entries()) {
      const path = `intro/${year}/${stamp}_${String(i).padStart(3, '0')}.jpg`;
      const up = await tx.storage.from(t.bucket).upload(path, new Uint8Array(b), { contentType: 'image/jpeg', upsert: false });
      if (up.error) return fail(res, 400, /bucket/i.test(String(up.error.message)) ? `ยังไม่ได้สร้างที่เก็บรูป ${t.bucket} ใน Tx Data` : 'อัปโหลดหน้าเอกสารไม่ได้');
      added.push({ path, url: tx.storage.from(t.bucket).getPublicUrl(path).data.publicUrl });
    }
    const pages = replace ? added : [...old, ...added];
    must(await tx.from(t.setting).upsert({ key: introKey(year), value: JSON.stringify(pages) }, { onConflict: 'key' }));
    if (replace && old.length) await tx.storage.from(t.bucket).remove(old.map((p) => p.path));
    res.json({ ok: true, pages: pages.length });
  });
  route('delete', '/api/act/:activity/intro/:year', async (req, res, activity, t) => {
    const year = yearOf(req.params.year);
    if (!year || !(await requireAdmin(req, res, activity, year))) return;
    const old = (await introOf(t)).get(year) || [];
    must(await tx.from(t.setting).delete().eq('key', introKey(year)));
    if (old.length) await tx.storage.from(t.bucket).remove(old.map((p) => p.path));
    res.json({ ok: true });
  });
}
