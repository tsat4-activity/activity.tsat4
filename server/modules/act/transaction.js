import { tx } from '../../core/db.js';
import { fail } from '../../core/http.js';
import { dropFiles } from '../../core/storage.js';
import { ensure5sMaster } from './audit.js';
import { accessOf, actRoute, dateOf, fetchAll, fetchIn, imageBytes, must, namesOf, roundTo, tablesOf, viewerOf, yearOf } from './common.js';

// Checklist audits — transaction: record Self / Committee audits and follow Issues to closure.
// Rules: docs/specs/act-5s.md ("transaction", "Issue"). Pure rule functions are exported for scripts/test-act-audit.js.
const AUDIT_TYPES = ['SELF', 'COMMITTEE'];
const DEFAULTS = { pass_percent: 80, pass_self: 80, pass_committee: 80, issue_score: 3, issue_due_days_before_next: 15, issue_photo_max: 1, self_audit_due_day: 10 };

const todayIso = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const addDays = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

// First day of plan week (W1 = 1, W2 = 8, W3 = 15, W4 = 22).
export function weekStartIso(year, month, week) {
  return `${year}-${String(month).padStart(2, '0')}-${String((week - 1) * 7 + 1).padStart(2, '0')}`;
}

// Issue due date = start of the next planned committee week for the area − N days; null when nothing is planned yet.
export function dueDateFor(plans, afterIso, daysBefore) {
  const next = plans.map((p) => weekStartIso(p.year, p.month, p.week)).filter((d) => d > afterIso).sort()[0];
  return next ? addDays(next, -daysBefore) : null;
}

export function scoreAudit(items, scores, passPercent) {
  const max = items.reduce((s, i) => s + Number(i.score_max), 0);
  const total = items.reduce((s, i) => s + Number(scores.get(i.id) ?? 0), 0);
  const percent = max ? roundTo((total / max) * 100, 2) : 0;
  return { total, max, percent, result: percent >= passPercent ? 'PASS' : 'NEED_IMPROVE' };
}

// Next committee audit confirms the area's open Issues (old TSAT4-5S rule):
// no action (text + after photo) -> that item scores 0 and the Issue is OVERDUE · action and a score strictly above
// issue_score (3: ผู้ใช้กำหนด 2026-11-02 เปิด Issue เมื่อได้ 3 หรือต่ำกว่า) -> CLOSED (≥ 4) · otherwise it carries on.
export function verifyIssues(openIssues, scores, issueScore = DEFAULTS.issue_score) {
  const adjusted = new Map(scores);
  const updates = [];
  for (const issue of openIssues) {
    const hasAction = Boolean(String(issue.action_description || '').trim()) && Number(issue.after_photos || 0) > 0;
    if (!hasAction) {
      adjusted.set(issue.checklist_id, 0);
      updates.push({ id: issue.id, status: 'OVERDUE', final_score: 0 });
      continue;
    }
    const score = Number(adjusted.get(issue.checklist_id) ?? 0);
    updates.push(score > issueScore ? { id: issue.id, status: 'CLOSED', final_score: score, closed: true } : { id: issue.id, status: 'OPEN', final_score: score, carry: true });
  }
  return { scores: adjusted, updates };
}

// Shown status: an OPEN Issue past its due date without action reads as OVERDUE.
export function shownStatus(issue, today = todayIso()) {
  if (issue.status === 'OPEN' && issue.due_date && issue.due_date < today) return 'OVERDUE';
  return issue.status;
}

// Issue photos are two lists on the Issue row; the page reads them as [{ kind, url }].
export function photosOf(issue) {
  return (issue.photo_before || []).map((url) => ({ kind: 'BEFORE', url })).concat((issue.photo_after || []).map((url) => ({ kind: 'AFTER', url })));
}

function idList(list) {
  return [...new Set((Array.isArray(list) ? list : []).map((x) => String(x).trim()).filter(Boolean))];
}

async function settingsOf(activity, year) {
  const { data, error } = await tx.from(tablesOf(activity).setting).select('key,value');
  if (error) throw error;
  const out = { ...DEFAULTS };
  for (const row of data || []) if (row.key in out) out[row.key] = Number(row.value);
  // pass marks: as the dashboards (audit.js): this year's, the general one, then pass_percent
  const stored = (key) => Number((data || []).find((r) => r.key === key)?.value) || null;
  out.pass_percent = stored(`pass_percent:${year}`) ?? stored('pass_percent') ?? DEFAULTS.pass_percent;
  out.pass_self = stored(`pass_self:${year}`) ?? stored('pass_self') ?? out.pass_percent;
  out.pass_committee = stored(`pass_committee:${year}`) ?? stored('pass_committee') ?? out.pass_percent;
  return out;
}

export function mountTransaction(app) {
  const baseRoute = actRoute(app);
  const route = (method, path, handler) => baseRoute(method, path, async (req, res, activity, t) => {
    await ensure5sMaster(activity);
    return handler(req, res, activity, t);
  });

  // Open Issues of an area with how many after photos they have (for the committee form and verification).
  // exceptAuditId leaves out the Issues an audit opened itself; upTo = its date (used when that audit is edited).
  const openIssuesOf = async (t, areaId, exceptAuditId = 0, upTo = '') => {
    let query = tx.from(t.issue).select('id,issue_no,audit_id,checklist_id,score,description,issue_date,due_date,action_description,action_date,status,responsible_id,verify_audit_no,photo_before,photo_after')
      .eq('area_id', areaId).neq('status', 'CLOSED').order('issue_no');
    if (exceptAuditId) query = query.neq('audit_id', exceptAuditId);
    if (upTo) query = query.lte('issue_date', upTo);
    const issues = must(await query);
    return issues.map((i) => ({ ...i, photos: photosOf(i), after_photos: (i.photo_after || []).length }));
  };

  // ผู้รับการตรวจ = the area's owner of the year, unless the form sent names
  const receiversOf = async (t, year, areaId, sent) => {
    const list = idList(sent);
    if (list.length) return list;
    const owner = must(await tx.from(t.team).select('employee_id').eq('year', year).eq('area_id', areaId).eq('role', 'owner').eq('status', 'Active').limit(1));
    return owner.map((o) => String(o.employee_id));
  };

  const insertIssues = async (t, { auditId, year, areaId, auditedAt, needIssue, scores, described, daysBefore, plans: preloadedPlans }) => {
    if (!needIssue.length) return [];
    const [ownerRes, plansRes, lastRes] = await Promise.all([
      tx.from(t.team).select('employee_id').eq('year', year).eq('area_id', areaId).eq('role', 'owner').maybeSingle(),
      preloadedPlans ? { data: preloadedPlans, error: null } : tx.from(t.auditPlan).select('year,month,week').eq('area_id', areaId).gte('year', year),
      tx.from(t.issue).select('issue_no').order('issue_no', { ascending: false }).limit(1)
    ]);
    const owner = must(ownerRes);
    const due = dueDateFor(must(plansRes), auditedAt, daysBefore);
    const last = must(lastRes);
    let n = Number(String(last[0]?.issue_no || 'ISS0000').replace(/\D/g, '')) || 0;
    return must(await tx.from(t.issue).insert(needIssue.map((i) => ({
      issue_no: `ISS${String(++n).padStart(4, '0')}`, audit_id: auditId, area_id: areaId, checklist_id: i.id, score: scores.get(i.id),
      description: described.get(i.id), issue_date: auditedAt, responsible_id: owner?.employee_id || null, due_date: due, status: 'OPEN'
    }))).select('id,issue_no,checklist_id'));
  };

  route('get', '/api/act/:activity/audit-form', async (req, res, activity, t) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const access = await accessOf(req, activity, year);
    if (!access.member) return fail(res, 403, `บันทึกได้เฉพาะทีมของกิจกรรมนี้ปี ${year}`);
    const areaId = Number(req.query.area) || 0;
    const editing = Number(req.query.audit) || 0;
    const editDate = editing ? must(await tx.from(t.audit).select('audited_at').eq('id', editing).maybeSingle())?.audited_at?.slice(0, 10) || '' : '';
    const [settings, items, areas, team, openIssues, areaOwner] = await Promise.all([
      settingsOf(activity, year),
      fetchAll(() => tx.from(t.checklist).select('id,item_no,s_group,title,score_max').eq('year', year).eq('status', 'Active').order('item_no')),
      fetchAll(() => tx.from(t.area).select('id,code,area_type,name').eq('status', 'Active').order('code')),
      fetchAll(() => tx.from(t.team).select('employee_id,role,team').eq('year', year).eq('status', 'Active')),
      areaId ? openIssuesOf(t, areaId, editing, editDate) : [],
      areaId ? receiversOf(t, year, areaId, []) : []
    ]);
    const types = [];
    if (access.admin || access.ownerAreaIds.length) types.push('SELF');
    if (access.admin || access.chairman || access.auditor) types.push('COMMITTEE');
    const names = await namesOf([...team.map((m) => m.employee_id), ...areaOwner]);
    res.json({
      year,
      access,
      receivers: areaOwner.map((id) => ({ employeeId: id, name: names.get(id)?.name || '' })),
      settings,
      types,
      items,
      areas: areas.map((a) => ({ ...a, self: access.admin || access.ownerAreaIds.includes(a.id) })),
      teams: [...new Set(team.filter((m) => m.team).map((m) => m.team))].sort().map((letter) => ({
        team: letter,
        members: team.filter((m) => m.team === letter).map((m) => ({ employeeId: String(m.employee_id), name: names.get(String(m.employee_id))?.name || '' }))
      })),
      openIssues
    });
  });

  // Edit an audit's scores, date, and people. A stored 0 (an unanswered Issue, a real score is 1 or more) stays 0, and the
  // score of an item made Inactive later stays as it is: the audit keeps what it was scored on.
  // Its own Issues: an item that rose above the issue score drops its untouched Issue; a newly low committee item opens one.
  route('patch', '/api/act/:activity/audits/:id', async (req, res, activity, t) => {
    const body = req.body || {};
    const audit = must(await tx.from(t.audit).select('*').eq('id', Number(req.params.id)).maybeSingle());
    if (!audit) return fail(res, 404, 'ไม่พบใบตรวจ');
    const access = await accessOf(req, activity, audit.year);
    if (!(access.admin || audit.created_by === req.user.employeeId)) return fail(res, 403, 'แก้ได้เฉพาะคนที่บันทึกใบนี้หรือ admin');
    const auditedAt = dateOf(body.auditedAt) || audit.audited_at.slice(0, 10);
    if (auditedAt > todayIso()) return fail(res, 400, 'วันที่ตรวจต้องไม่เกินวันนี้');
    if (Number(auditedAt.slice(0, 4)) !== audit.year) return fail(res, 400, `วันที่ตรวจต้องอยู่ในปี ${audit.year}`);
    const team = audit.audit_type === 'COMMITTEE' ? String(body.team || audit.team || '').trim().toUpperCase() : null;
    if (audit.audit_type === 'COMMITTEE' && !/^[A-Z]$/.test(team || '')) return fail(res, 400, 'เลือกทีมที่ตรวจ');

    const [settings, itemsRes, storedRes, ownRes, carriedIssues] = await Promise.all([
      settingsOf(activity, audit.year),
      tx.from(t.checklist).select('id,item_no,s_group,title,score_max,status').eq('year', audit.year).order('item_no'),
      tx.from(t.score).select('checklist_id,score').eq('audit_id', audit.id),
      tx.from(t.issue).select('id,checklist_id,score,status,action_description,photo_before,photo_after').eq('audit_id', audit.id),
      audit.audit_type === 'COMMITTEE' ? openIssuesOf(t, audit.area_id, audit.id, audit.audited_at.slice(0, 10)) : []
    ]);
    const stored = new Map(must(storedRes).map((s) => [s.checklist_id, Number(s.score)]));
    const items = must(itemsRes).filter((i) => i.status === 'Active' || stored.has(i.id));
    const locked = new Set([...stored].filter(([, score]) => score === 0).map(([id]) => id));
    const scores = new Map();
    for (const item of items) {
      if (locked.has(item.id)) { scores.set(item.id, 0); continue; }
      if (item.status !== 'Active') { scores.set(item.id, stored.get(item.id)); continue; }
      const value = Number(body.scores?.[item.id]);
      scores.set(item.id, Number.isInteger(value) && value >= 1 && value <= Number(item.score_max) ? value : null);
    }
    const missing = items.filter((i) => scores.get(i.id) == null).map((i) => i.item_no);
    if (missing.length) return fail(res, 400, `ให้คะแนนให้ครบ (ข้อที่ ${missing.join(', ')})`);

    const own = must(ownRes);
    const carried = new Set(carriedIssues.map((i) => i.checklist_id));
    const low = (id) => scores.get(id) <= settings.issue_score;
    // Drop own Issues whose item is no longer low, only while nobody has worked on them yet.
    const drop = own.filter((i) => scores.has(i.checklist_id) && !low(i.checklist_id) && i.status === 'OPEN' && !String(i.action_description || '').trim() && !(i.photo_after || []).length);
    const stillOwn = new Set(own.filter((i) => !drop.includes(i)).map((i) => i.checklist_id));
    const needIssue = audit.audit_type === 'COMMITTEE' ? items.filter((i) => low(i.id) && !stillOwn.has(i.id) && !carried.has(i.id) && !locked.has(i.id)) : [];
    const described = new Map((Array.isArray(body.issues) ? body.issues : []).map((x) => [Number(x.checklistId), String(x.description || '').trim().slice(0, 2000)]));
    const undescribed = needIssue.filter((i) => !described.get(i.id)).map((i) => i.item_no);
    if (undescribed.length) return fail(res, 400, `ข้อที่ได้ ${settings.issue_score} หรือต่ำกว่า ต้องเปิด Issue พร้อมรายละเอียด (ข้อที่ ${undescribed.join(', ')})`);

    const passPercent = (audit.audit_type === 'SELF' ? settings.pass_self : settings.pass_committee) ?? settings.pass_percent;
    const score = scoreAudit(items, scores, passPercent);
    const auditPatch = { audited_at: `${auditedAt}T05:00:00Z`, team, total_score: score.total, percent_score: score.percent, result: score.result };
    if (Array.isArray(body.participated) || Array.isArray(body.receivers)) {
      auditPatch.auditors = idList(body.participated).length ? idList(body.participated) : [audit.created_by].filter(Boolean);
      auditPatch.receivers = await receiversOf(t, audit.year, audit.area_id, body.receivers);
    }
    must(await tx.from(t.audit).update(auditPatch).eq('id', audit.id));
    must(await tx.from(t.score).delete().eq('audit_id', audit.id));
    must(await tx.from(t.score).insert(items.map((i) => ({ audit_id: audit.id, checklist_id: i.id, score: scores.get(i.id) }))));
    if (drop.length) {
      must(await tx.from(t.issue).delete().in('id', drop.map((i) => i.id)));
      await dropFiles(tx, t.bucket, drop.map((i) => [i.photo_before, i.photo_after]));
    }
    const created = await insertIssues(t, { auditId: audit.id, year: audit.year, areaId: audit.area_id, auditedAt, needIssue, scores, described, daysBefore: settings.issue_due_days_before_next });
    // Keep the score on the audit's own remaining Issues in step with the edited item scores.
    await Promise.all(own.filter((x) => !drop.includes(x) && Number(scores.get(x.checklist_id)) !== Number(x.score)).map(async (i) => {
      must(await tx.from(t.issue).update({ score: scores.get(i.checklist_id) }).eq('id', i.id));
    }));
    res.json({ id: audit.id, auditNo: audit.audit_no, ...score, issues: created, dropped: drop.length });
  });

  route('post', '/api/act/:activity/audits', async (req, res, activity, t) => {
    const body = req.body || {};
    const type = AUDIT_TYPES.includes(body.type) ? body.type : '';
    const auditedAt = dateOf(body.auditedAt);
    const areaId = Number(body.areaId);
    if (!type || !auditedAt || !areaId) return fail(res, 400, 'เลือกประเภท พื้นที่ และวันที่ตรวจ');
    if (auditedAt > todayIso()) return fail(res, 400, 'วันที่ตรวจต้องไม่เกินวันนี้');
    const year = Number(auditedAt.slice(0, 4));
    const [access, areaRes, settings, itemsRes, open] = await Promise.all([
      accessOf(req, activity, year),
      tx.from(t.area).select('id,code,status').eq('id', areaId).maybeSingle(),
      settingsOf(activity, year),
      tx.from(t.checklist).select('id,item_no,s_group,title,score_max').eq('year', year).eq('status', 'Active').order('item_no'),
      type === 'COMMITTEE' ? openIssuesOf(t, areaId) : []
    ]);
    const area = must(areaRes);
    if (!area || area.status !== 'Active') return fail(res, 404, 'ไม่พบพื้นที่');
    if (type === 'SELF' && !(access.admin || access.ownerAreaIds.includes(areaId))) return fail(res, 403, 'Self Audit ทำได้เฉพาะเจ้าของพื้นที่ปีนี้');
    if (type === 'COMMITTEE' && !(access.admin || access.chairman || access.auditor)) return fail(res, 403, 'Committee Audit ทำได้เฉพาะทีมตรวจประเมิน');
    const team = type === 'COMMITTEE' ? String(body.team || access.teams[0] || '').trim().toUpperCase() : null;
    if (type === 'COMMITTEE' && !/^[A-Z]$/.test(team || '')) return fail(res, 400, 'เลือกทีมที่ตรวจ');

    const items = must(itemsRes);
    if (!items.length) return fail(res, 400, `ยังไม่มีหัวข้อตรวจปี ${year}`);
    let scores = new Map();
    for (const item of items) {
      const value = Number(body.scores?.[item.id]);
      if (!Number.isInteger(value) || value < 1 || value > Number(item.score_max)) scores.set(item.id, null);
      else scores.set(item.id, value);
    }
    let verification = { updates: [] };
    if (type === 'COMMITTEE') {
      verification = verifyIssues(open, scores, settings.issue_score);
      scores = verification.scores;
    }
    const missing = items.filter((i) => scores.get(i.id) == null).map((i) => i.item_no);
    if (missing.length) return fail(res, 400, `ให้คะแนนให้ครบ (ข้อที่ ${missing.join(', ')})`);

    // Committee: every item at or below the issue score opens an Issue, unless an open Issue for that item carries on.
    const carried = new Set(verification.updates.filter((u) => u.carry || u.status === 'OVERDUE').map((u) => open.find((i) => i.id === u.id)?.checklist_id));
    const needIssue = type === 'COMMITTEE' ? items.filter((i) => scores.get(i.id) <= settings.issue_score && !carried.has(i.id)) : [];
    const described = new Map((Array.isArray(body.issues) ? body.issues : []).map((x) => [Number(x.checklistId), String(x.description || '').trim().slice(0, 2000)]));
    const undescribed = needIssue.filter((i) => !described.get(i.id)).map((i) => i.item_no);
    if (undescribed.length) return fail(res, 400, `ข้อที่ได้ ${settings.issue_score} หรือต่ำกว่า ต้องเปิด Issue พร้อมรายละเอียด (ข้อที่ ${undescribed.join(', ')})`);

    const passPercent = (type === 'SELF' ? settings.pass_self : settings.pass_committee) ?? settings.pass_percent;
    const score = scoreAudit(items, scores, passPercent);
    const prefix = `${type === 'SELF' ? 'S' : 'C'}-${area.code}-${auditedAt.slice(8, 10)}${auditedAt.slice(5, 7)}${auditedAt.slice(2, 4)}-`;
    const same = must(await tx.from(t.audit).select('audit_no').like('audit_no', `${prefix}%`));
    const auditNo = `${prefix}${String(same.length + 1).padStart(2, '0')}`;
    const receivers = await receiversOf(t, year, areaId, body.receivers);
    const audit = must(await tx.from(t.audit).insert({
      audit_no: auditNo, year, audit_type: type, area_id: areaId, team,
      audited_at: `${auditedAt}T05:00:00Z`, // 12:00 Thai time, so the Thai date never shifts
      total_score: score.total, percent_score: score.percent, result: score.result, status: 'DRAFT', created_by: req.user.employeeId,
      auditors: idList(body.participated).length ? idList(body.participated) : [req.user.employeeId],
      receivers
    }).select('id').single());

    try {
      must(await tx.from(t.score).insert(items.map((i) => ({ audit_id: audit.id, checklist_id: i.id, score: scores.get(i.id) }))));
      const plans = needIssue.length || verification.updates.length ? must(await tx.from(t.auditPlan).select('year,month,week').eq('area_id', areaId).gte('year', year)) : [];
      const created = await insertIssues(t, { auditId: audit.id, year, areaId, auditedAt, needIssue, scores, described, daysBefore: settings.issue_due_days_before_next, plans });
      await Promise.all(verification.updates.map(async (u) => {
        const patch = { status: u.status, final_score: u.final_score, verify_audit_no: auditNo };
        if (u.closed) Object.assign(patch, { closed_by: req.user.employeeId, closed_at: auditedAt });
        if (u.carry) Object.assign(patch, { due_date: dueDateFor(plans, auditedAt, settings.issue_due_days_before_next) });
        must(await tx.from(t.issue).update(patch).eq('id', u.id));
      }));
      must(await tx.from(t.audit).update({ status: 'COMPLETED' }).eq('id', audit.id));
      res.status(201).json({ id: audit.id, auditNo, ...score, issues: created, verified: verification.updates.length });
    } catch (err) {
      await tx.from(t.audit).delete().eq('id', audit.id);
      throw err;
    }
  });

  route('get', '/api/act/:activity/audits', async (req, res, activity, t) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const access = await accessOf(req, activity, year);
    if (!(await viewerOf(req, year, access))) return fail(res, 403, `ดูได้เฉพาะทีมของกิจกรรมปี ${year}`);
    const [audits, areas] = await Promise.all([
      fetchAll(() => tx.from(t.audit).select('id,audit_no,audit_type,area_id,team,audited_at,total_score,percent_score,result,status,created_by').eq('year', year).order('audited_at', { ascending: false })),
      fetchAll(() => tx.from(t.area).select('id,code,name,area_type,status').order('code'))
    ]);
    const issues = await fetchIn(() => tx.from(t.issue).select('audit_id,status'), 'audit_id', audits.map((a) => a.id));
    const areaById = new Map(areas.map((x) => [x.id, x]));
    const issuesByAudit = new Map();
    for (const i of issues) {
      if (!issuesByAudit.has(i.audit_id)) issuesByAudit.set(i.audit_id, []);
      issuesByAudit.get(i.audit_id).push(i);
    }
    res.json({
      year,
      canDelete: access.admin,
      areas: areas.filter((a) => a.status !== 'Inactive').map((a) => ({ area_id: a.id, areaCode: a.code, areaName: a.name, areaType: a.area_type })),
      audits: audits.map((a) => {
        const canEdit = access.admin || a.created_by === req.user.employeeId;
        const area = areaById.get(a.area_id) || {};
        const own = issuesByAudit.get(a.id) || [];
        return { ...a, canEdit, areaCode: area.code, areaName: area.name, areaType: area.area_type, issues: own.length, openIssues: own.filter((i) => i.status !== 'CLOSED').length };
      })
    });
  });

  route('get', '/api/act/:activity/audits/:id', async (req, res, activity, t) => {
    const audit = must(await tx.from(t.audit).select('*').eq('id', Number(req.params.id)).maybeSingle());
    if (!audit) return fail(res, 404, 'ไม่พบใบตรวจ');
    if (!(await viewerOf(req, audit.year, await accessOf(req, activity, audit.year)))) return fail(res, 403, 'ดูได้เฉพาะทีมของกิจกรรม');
    const people = (audit.auditors || []).map((id) => ({ employee_id: id, kind: 'participated' })).concat((audit.receivers || []).map((id) => ({ employee_id: id, kind: 'receiver' })));
    const [scores, issues, area, names] = await Promise.all([
      fetchAll(() => tx.from(t.score).select('checklist_id,score').eq('audit_id', audit.id)),
      fetchAll(() => tx.from(t.issue).select('id,issue_no,checklist_id,score,description,status,due_date').eq('audit_id', audit.id)),
      tx.from(t.area).select('code,name,area_type').eq('id', audit.area_id).maybeSingle(),
      namesOf(people.map((p) => p.employee_id))
    ]);
    const items = await fetchIn(() => tx.from(t.checklist).select('id,item_no,s_group,title,score_max'), 'id', scores.map((s) => s.checklist_id));
    const itemById = new Map(items.map((i) => [i.id, i]));
    res.json({
      audit: { ...audit, area: area.data },
      scores: scores.map((s) => ({ ...s, ...(itemById.get(s.checklist_id) || {}) })).sort((a, b) => a.item_no - b.item_no),
      people: people.map((p) => ({ ...p, name: names.get(String(p.employee_id))?.name || '' })),
      issues
    });
  });

  route('delete', '/api/act/:activity/audits/:id', async (req, res, activity, t) => {
    const audit = must(await tx.from(t.audit).select('id,year,audit_no').eq('id', Number(req.params.id)).maybeSingle());
    if (!audit) return fail(res, 404, 'ไม่พบใบตรวจ');
    if (!(await accessOf(req, activity, audit.year)).admin) return fail(res, 403, `ลบได้เฉพาะ admin ปี ${audit.year}`);
    const photos = must(await tx.from(t.issue).select('photo_before,photo_after').eq('audit_id', audit.id)); // its Issues go with it (on delete cascade)
    must(await tx.from(t.audit).delete().eq('id', audit.id));
    await dropFiles(tx, t.bucket, photos.map((i) => [i.photo_before, i.photo_after]));
    res.json({ ok: true });
  });

  // Who may do what on one Issue: auditors add the problem photo, the owner sends the action, admins move the due date.
  const issueRights = (access, issue, me) => ({
    canAddBefore: access.admin || access.chairman || access.auditor,
    canAct: issue.status !== 'CLOSED' && (access.admin || String(issue.responsible_id || '') === me || access.ownerAreaIds.includes(issue.area_id)),
    canEditDue: access.admin
  });

  route('get', '/api/act/:activity/issues', async (req, res, activity, t) => {
    const year = yearOf(req.query.year);
    if (!year) return fail(res, 400, 'ปีไม่ถูกต้อง');
    const access = await accessOf(req, activity, year);
    if (!(await viewerOf(req, year, access))) return fail(res, 403, `ดูได้เฉพาะทีมของกิจกรรมปี ${year}`);
    const [audits, areas] = await Promise.all([
      fetchAll(() => tx.from(t.audit).select('id,audit_no,year').eq('year', year)),
      fetchAll(() => tx.from(t.area).select('id,code,name'))
    ]);
    const issues = await fetchIn(() => tx.from(t.issue).select('*').order('issue_no'), 'audit_id', audits.map((a) => a.id));
    const [items, names] = await Promise.all([
      fetchIn(() => tx.from(t.checklist).select('id,item_no,s_group,title'), 'id', issues.map((i) => i.checklist_id)),
      namesOf(issues.map((i) => i.responsible_id).filter(Boolean))
    ]);
    const auditById = new Map(audits.map((a) => [a.id, a]));
    const areaById = new Map(areas.map((a) => [a.id, a]));
    const itemById = new Map(items.map((x) => [x.id, x]));
    const today = todayIso();
    res.json({
      year,
      issues: issues.map((i) => ({
        ...i,
        shownStatus: shownStatus(i, today),
        auditNo: auditById.get(i.audit_id)?.audit_no || '',
        area: areaById.get(i.area_id) || {},
        item: itemById.get(i.checklist_id) || {},
        responsibleName: names.get(String(i.responsible_id))?.name || '',
        photos: photosOf(i),
        ...issueRights(access, i, req.user.employeeId)
      })).sort((a, b) => b.issue_no.localeCompare(a.issue_no))
    });
  });

  const issueWithAccess = async (req, res, activity, t) => {
    const issue = must(await tx.from(t.issue).select('*').eq('id', Number(req.params.id)).maybeSingle());
    if (!issue) {
      fail(res, 404, 'ไม่พบ Issue');
      return null;
    }
    const audit = must(await tx.from(t.audit).select('year').eq('id', issue.audit_id).maybeSingle());
    const access = await accessOf(req, activity, audit?.year || Number(issue.issue_date.slice(0, 4)));
    return { issue, access, rights: issueRights(access, issue, req.user.employeeId) };
  };

  route('post', '/api/act/:activity/issues/:id/photo', async (req, res, activity, t) => {
    const found = await issueWithAccess(req, res, activity, t);
    if (!found) return;
    const kind = req.body?.kind === 'AFTER' ? 'AFTER' : 'BEFORE';
    if (kind === 'BEFORE' && !found.rights.canAddBefore) return fail(res, 403, 'แนบรูปปัญหาได้เฉพาะทีมตรวจประเมิน');
    if (kind === 'AFTER' && !found.rights.canAct) return fail(res, 403, 'แนบรูปหลังแก้ได้เฉพาะผู้รับผิดชอบพื้นที่');
    const bytes = imageBytes(req.body?.image);
    if (!bytes) return fail(res, 400, 'รูปต้องเป็น JPEG ไม่เกิน 700 KB');
    const settings = await settingsOf(activity);
    const column = kind === 'AFTER' ? 'photo_after' : 'photo_before';
    const have = found.issue[column] || [];
    if (have.length >= settings.issue_photo_max) return fail(res, 400, `แนบรูป${kind === 'AFTER' ? 'หลังแก้' : 'ปัญหา'}ได้ ${settings.issue_photo_max} รูป`);
    // Each activity has its own bucket img_<key>; files: issue/<ISSxxxx>_<BEFORE|AFTER>_<time>.jpg
    const key = `issue/${found.issue.issue_no}_${kind}_${Date.now()}.jpg`;
    const uploaded = await tx.storage.from(t.bucket).upload(key, new Uint8Array(bytes), { contentType: 'image/jpeg', upsert: false });
    if (uploaded.error) {
      const text = String(uploaded.error.message || '');
      return fail(res, 400, /bucket/i.test(text) ? `ยังไม่ได้สร้างที่เก็บรูป ${t.bucket} ใน Tx Data (รัน ${t.sql} อีกครั้ง)` : 'อัปโหลดรูปไม่ได้');
    }
    const url = tx.storage.from(t.bucket).getPublicUrl(key).data.publicUrl;
    must(await tx.from(t.issue).update({ [column]: [...have, url] }).eq('id', found.issue.id));
    res.status(201).json({ url });
  });

  route('post', '/api/act/:activity/issues/:id/action', async (req, res, activity, t) => {
    const found = await issueWithAccess(req, res, activity, t);
    if (!found) return;
    if (!found.rights.canAct) return fail(res, 403, 'ส่ง Action ได้เฉพาะผู้รับผิดชอบพื้นที่');
    const description = String(req.body?.description || '').trim().slice(0, 2000);
    if (!description) return fail(res, 400, 'ระบุสิ่งที่แก้ไข');
    if (!(found.issue.photo_after || []).length) return fail(res, 400, 'แนบรูปหลังแก้ก่อนส่ง Action');
    const today = todayIso();
    const status = !found.issue.due_date || today <= found.issue.due_date ? 'ON_PLAN' : 'WAIT_VERIFY';
    const sent = must(await tx.from(t.issue).update({ action_description: description, action_date: today, status }).eq('id', found.issue.id).neq('status', 'CLOSED').select('id'));
    if (!sent.length) return fail(res, 409, 'Issue นี้ปิดไปแล้ว โหลดหน้าใหม่');
    res.json({ ok: true, status });
  });

  route('patch', '/api/act/:activity/issues/:id', async (req, res, activity, t) => {
    const found = await issueWithAccess(req, res, activity, t);
    if (!found) return;
    if (!found.rights.canEditDue) return fail(res, 403, 'แก้กำหนดได้เฉพาะ admin');
    const due = req.body?.dueDate ? dateOf(req.body.dueDate) : null;
    if (req.body?.dueDate && !due) return fail(res, 400, 'วันที่ไม่ถูกต้อง');
    must(await tx.from(t.issue).update({ due_date: due }).eq('id', found.issue.id));
    res.json({ ok: true });
  });
}
