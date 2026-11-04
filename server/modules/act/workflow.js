import { tx } from '../../core/db.js';
import { fail, wrap } from '../../core/http.js';
import { requireUser } from '../../core/users.js';
import { accessOf } from './common.js';

const T_IDEAS = 'automation_ideas';
const T_IMAGES = 'automation_images';
const T_EVALS = 'automation_evaluations';

// Work Flow belongs to SMF: its ผู้ดูแล of this year (Smart Team, ผู้ประสานงาน), or the ผู้ดูแลระบบ. A ผู้บริหาร reads only.
const isAdmin = async (req) => (await accessOf(req, 'smf', new Date().getFullYear())).admin;

export function calcReduction(before, after) {
  const b = Number(before);
  const a = Number(after);
  if (!Number.isFinite(b) || b <= 0) return null;
  if (!Number.isFinite(a) || a < 0) return 0;
  return Math.round(((b - a) / b) * 1000) / 10;
}

// In-memory fallback only while the tables are not created yet in Supabase: any other failure must not look saved
const tableMissing = (error) => ['PGRST205', '42P01'].includes(error?.code);
// A column the database does not have yet: say which file to run. Saving without it would lose the team or the project.
const WF_SQL = 'ตาราง Work Flow ยังไม่มีคอลัมน์ใหม่ ต้องรัน db/act/workflow.sql ใน Tx Data';
const columnMissing = (error) => ['PGRST204', '42703'].includes(error?.code);
const wf = (fn) => wrap(async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (!columnMissing(err)) throw err;
    fail(res, 503, WF_SQL);
  }
});

// A picture is a real image: https (Storage) or a base64 data URL, nothing that can break out of src="" (audit 2026-11-05)
const IMAGE_URL = /^(https?:\/\/[^\s"'<>()\\]+|data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+)$/;
const imageUrl = (v) => (IMAGE_URL.test(String(v || '').trim()) ? String(v).trim() : null);

const mem = {
  ideas: [],
  images: [],
  evals: [],
  nextId: 1
};

export function mountWorkflow(app) {
  // Who the idea is under: yourself, or (Team Submission) someone else of the SMF team when you are in that team too. Admin: anyone.
  const ownerAllowed = async (req, employeeId) => {
    if (employeeId === req.user.employeeId || (await isAdmin(req)) || !tx) return true;
    const year = new Date().getFullYear();
    const { data, error } = await tx.from('mt_smf_team').select('employee_id').in('employee_id', [employeeId, req.user.employeeId]).eq('status', 'Active').gte('year', year - 1);
    if (error) throw error;
    return new Set((data || []).map((r) => String(r.employee_id))).size === 2;
  };
  // Only the owner of the idea or an admin changes its pictures
  const ideaEditable = async (req, id) => {
    let idea = mem.ideas.find((i) => i.id === id) || null;
    if (!idea && tx) {
      const { data, error } = await tx.from(T_IDEAS).select('id,employee_id').eq('id', id).maybeSingle();
      if (error && !tableMissing(error)) throw error;
      idea = data || null;
    }
    return Boolean(idea && ((await isAdmin(req)) || idea.employee_id === req.user.employeeId));
  };

  // 1. List ideas
  app.get('/api/workflow/ideas', wrap(requireUser), wf(async (req, res) => {
    const admin = await isAdmin(req);
    const projCode = String(req.query.project_code || '').trim();
    const q = String(req.query.q || '').trim().toLowerCase();
    const dept = String(req.query.department || '').trim();
    const status = String(req.query.status || '').trim();
    const myOnly = req.query.my === '1';

    let ideas = [];
    let useMem = false;

    if (tx) {
      try {
        let query = tx.from(T_IDEAS).select('*').order('created_at', { ascending: false });
        if (projCode) query = query.eq('project_code', projCode);
        if (dept) query = query.eq('department', dept);
        if (status) query = query.eq('project_status', status);
        if (myOnly) query = query.eq('employee_id', req.user.employeeId);
        let { data, error } = await query;
        if (error && error.code === '42703') {
          // If project_code column not in DB yet, query without it
          let retry = tx.from(T_IDEAS).select('*').order('created_at', { ascending: false });
          if (dept) retry = retry.eq('department', dept);
          if (status) retry = retry.eq('project_status', status);
          if (myOnly) retry = retry.eq('employee_id', req.user.employeeId);
          const r = await retry;
          if (!r.error) {
            data = r.data || [];
            error = null;
          }
        }
        if (error) {
          if (error.code === 'PGRST205' || error.code === '42P01') useMem = true;
          else throw error;
        } else {
          ideas = data || [];
        }
      } catch (err) {
        if (!tableMissing(err)) throw err;
        useMem = true;
      }
    } else {
      useMem = true;
    }

    if (useMem) {
      ideas = [...mem.ideas];
      if (projCode) ideas = ideas.filter((i) => (i.project_code || 'workflow') === projCode);
      if (dept) ideas = ideas.filter((i) => i.department === dept);
      if (status) ideas = ideas.filter((i) => i.project_status === status);
      if (myOnly) ideas = ideas.filter((i) => i.employee_id === req.user.employeeId);
      ideas.sort((a, b) => b.created_at.localeCompare(a.created_at));
    }

    if (q) {
      ideas = ideas.filter((i) =>
        (i.project_name || '').toLowerCase().includes(q) ||
        (i.process_name || '').toLowerCase().includes(q) ||
        (i.full_name || '').toLowerCase().includes(q) ||
        (i.department || '').toLowerCase().includes(q) ||
        (i.employee_id || '').toLowerCase().includes(q) ||
        (i.team_name || '').toLowerCase().includes(q)
      );
    }

    // Fetch images for the returned ideas so Proposal Cards can render Before/After photos immediately
    let allImages = [];
    if (!useMem && tx && ideas.length) {
      try {
        const ids = ideas.map((i) => i.id);
        const { data: imgRows } = await tx.from(T_IMAGES).select('*').in('idea_id', ids).order('created_at');
        allImages = imgRows || [];
      } catch (_) {}
    } else if (useMem) {
      allImages = [...mem.images];
    }
    const imgMap = new Map();
    for (const img of allImages) {
      const list = imgMap.get(img.idea_id) || [];
      list.push(img);
      imgMap.set(img.idea_id, list);
    }

    // Decorate with calculated reductions, images, and permissions
    const decorated = ideas.map((item) => ({
      ...item,
      images: imgMap.get(item.id) || [],
      time_saving_pct: calcReduction(item.time_before, item.time_after),
      paper_reduction_pct: calcReduction(item.paper_before, item.paper_after),
      steps_reduction_pct: calcReduction(item.steps_before, item.steps_after),
      can_edit: admin || item.employee_id === req.user.employeeId,
      can_evaluate: admin
    }));

    res.json({ ideas: decorated, total: decorated.length, admin });
  }));

  // 2. Get single idea with images and evaluations
  app.get('/api/workflow/ideas/:id', wrap(requireUser), wf(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) return fail(res, 400, 'ID ไม่ถูกต้อง');

    let idea = null;
    let images = [];
    let evaluations = [];
    let useMem = false;

    if (tx) {
      try {
        const [iRes, imgRes, evRes] = await Promise.all([
          tx.from(T_IDEAS).select('*').eq('id', id).maybeSingle(),
          tx.from(T_IMAGES).select('*').eq('idea_id', id).order('created_at'),
          tx.from(T_EVALS).select('*').eq('idea_id', id).order('created_at', { ascending: false })
        ]);
        if (iRes.error?.code === 'PGRST205' || iRes.error?.code === '42P01') useMem = true;
        else if (iRes.error) throw iRes.error;
        else {
          idea = iRes.data;
          images = imgRes.data || [];
          evaluations = evRes.data || [];
        }
      } catch (err) {
        if (!tableMissing(err)) throw err;
        useMem = true;
      }
    } else {
      useMem = true;
    }

    if (useMem) {
      idea = mem.ideas.find((i) => i.id === id) || null;
      images = mem.images.filter((img) => img.idea_id === id);
      evaluations = mem.evals.filter((ev) => ev.idea_id === id);
    }

    if (!idea) return fail(res, 404, 'ไม่พบโครงการ');

    const admin = await isAdmin(req);
    res.json({
      idea: {
        ...idea,
        time_saving_pct: calcReduction(idea.time_before, idea.time_after),
        paper_reduction_pct: calcReduction(idea.paper_before, idea.paper_after),
        steps_reduction_pct: calcReduction(idea.steps_before, idea.steps_after),
        can_edit: admin || idea.employee_id === req.user.employeeId,
        can_evaluate: admin
      },
      images,
      evaluations
    });
  }));

  // 3. Create new idea
  app.post('/api/workflow/ideas', wrap(requireUser), wf(async (req, res) => {
    const b = req.body || {};
    const processName = String(b.process_name || '').trim().slice(0, 200);
    const projectName = String(b.project_name || '').trim().slice(0, 200);

    if (!processName) return fail(res, 400, 'ระบุชื่อกระบวนการที่ต้องการปรับปรุง');
    if (!projectName) return fail(res, 400, 'ระบุชื่อแนวคิดหรือโครงการ');

    const empId = String(b.employee_id || req.user.employeeId || '').trim();
    if (!(await ownerAllowed(req, empId))) return fail(res, 403, 'ส่งในชื่อคนอื่นได้เฉพาะสมาชิกทีม SMF');
    const pictures = Array.isArray(b.images) ? b.images.filter((img) => img?.image_url) : [];
    if (pictures.some((img) => !imageUrl(img.image_url))) return fail(res, 400, 'รูปภาพไม่ถูกต้อง');
    const fullName = String(b.full_name || req.user.name || '').trim();
    const dept = String(b.department || req.user.department || '').trim();
    const projCode = String(b.project_code || 'workflow').trim();
    const teamName = String(b.team_name || '').trim().slice(0, 200);
    const teamMembers = Array.isArray(b.team_members) ? b.team_members : [];

    const row = {
      project_code: projCode,
      team_name: teamName,
      team_members: teamMembers,
      employee_id: empId,
      full_name: fullName,
      department: dept,
      process_name: processName,
      current_description: String(b.current_description || '').trim().slice(0, 2000),
      current_problem: String(b.current_problem || '').trim().slice(0, 2000),
      frequency: String(b.frequency || '').trim().slice(0, 100),
      project_name: projectName,
      improvement_description: String(b.improvement_description || '').trim().slice(0, 2000),
      proposed_technology: String(b.proposed_technology || '').trim().slice(0, 100),
      improvement_benefits: Array.isArray(b.improvement_benefits) ? b.improvement_benefits : [],
      time_before: Number(b.time_before) || 0,
      time_after: Number(b.time_after) || 0,
      paper_before: Number(b.paper_before) || 0,
      paper_after: Number(b.paper_after) || 0,
      steps_before: Number(b.steps_before) || 0,
      steps_after: Number(b.steps_after) || 0,
      difficulty: ['Easy', 'Medium', 'Hard'].includes(b.difficulty) ? b.difficulty : 'Medium',
      budget: ['Free', 'Low', 'Medium', 'High'].includes(b.budget) ? b.budget : 'Free',
      project_status: ['Idea', 'Prototype', 'Testing', 'Implemented'].includes(b.project_status) ? b.project_status : 'Idea',
      admin_note: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    let inserted = null;
    let useMem = false;

    if (tx) {
      try {
        const { data, error } = await tx.from(T_IDEAS).insert([row]).select().maybeSingle();
        if (error && !tableMissing(error)) throw error;
        if (error) {
          console.warn('workflow ideas table is missing, using fallback:', error.message || error);
          useMem = true;
        } else if (data) {
          inserted = data;
        } else {
          useMem = true;
        }
      } catch (err) {
        if (!tableMissing(err)) throw err;
        console.warn('workflow ideas table is missing, using fallback:', err.message || err);
        useMem = true;
      }
    } else {
      useMem = true;
    }

    if (useMem || !inserted) {
      inserted = { id: mem.nextId++, ...row };
      mem.ideas.push(inserted);
    }

    // Process images if provided in payload
    if (pictures.length && inserted?.id) {
      for (const img of pictures) {
        let finalUrl = imageUrl(img.image_url);

        // Try uploading base64 to Supabase Storage if available
        if (tx && finalUrl.startsWith('data:image/')) {
          try {
            const matches = finalUrl.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
            if (matches) {
              const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
              const buffer = Buffer.from(matches[2], 'base64');
              const fileName = `workflow/${inserted.id}_${(img.image_type || 'img').toLowerCase()}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
              const bucket = 'img_smf';
              const up = await tx.storage.from(bucket).upload(fileName, buffer, { contentType: `image/${matches[1]}`, upsert: true });
              if (!up.error) {
                finalUrl = tx.storage.from(bucket).getPublicUrl(fileName).data.publicUrl;
              }
            }
          } catch (_) {
            // Keep base64 dataUrl if storage upload is not configured
          }
        }

        const imgRow = {
          idea_id: inserted.id,
          image_type: ['BEFORE', 'AFTER'].includes(img.image_type) ? img.image_type : 'BEFORE',
          image_url: finalUrl,
          image_description: String(img.image_description || '').trim().slice(0, 500),
          created_at: new Date().toISOString()
        };

        if (!useMem && tx) {
          try {
            const { error: imgErr } = await tx.from(T_IMAGES).insert([imgRow]);
            if (imgErr && !tableMissing(imgErr)) throw imgErr;
            if (imgErr) mem.images.push({ id: mem.nextId++, ...imgRow });
          } catch (err) {
            if (!tableMissing(err)) throw err;
            mem.images.push({ id: mem.nextId++, ...imgRow });
          }
        } else {
          mem.images.push({ id: mem.nextId++, ...imgRow });
        }
      }
    }

    res.status(201).json({ ok: true, id: inserted.id, idea: inserted });
  }));

  // 4. Update idea
  app.patch('/api/workflow/ideas/:id', wrap(requireUser), wf(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) return fail(res, 400, 'ID ไม่ถูกต้อง');

    const admin = await isAdmin(req);
    const b = req.body || {};

    const updates = {
      updated_at: new Date().toISOString()
    };
    if (b.team_name !== undefined) updates.team_name = String(b.team_name).trim().slice(0, 200);
    if (Array.isArray(b.team_members)) updates.team_members = b.team_members;
    if (b.employee_id) {
      updates.employee_id = String(b.employee_id).trim();
      if (!(await ownerAllowed(req, updates.employee_id))) return fail(res, 403, 'ส่งในชื่อคนอื่นได้เฉพาะสมาชิกทีม SMF');
    }
    if (b.full_name) updates.full_name = String(b.full_name).trim();
    if (b.department) updates.department = String(b.department).trim();
    if (b.process_name) updates.process_name = String(b.process_name).trim().slice(0, 200);
    if (b.project_name) updates.project_name = String(b.project_name).trim().slice(0, 200);
    if (b.current_description !== undefined) updates.current_description = String(b.current_description).trim().slice(0, 2000);
    if (b.current_problem !== undefined) updates.current_problem = String(b.current_problem).trim().slice(0, 2000);
    if (b.frequency !== undefined) updates.frequency = String(b.frequency).trim().slice(0, 100);
    if (b.improvement_description !== undefined) updates.improvement_description = String(b.improvement_description).trim().slice(0, 2000);
    if (b.proposed_technology !== undefined) updates.proposed_technology = String(b.proposed_technology).trim().slice(0, 100);
    if (Array.isArray(b.improvement_benefits)) updates.improvement_benefits = b.improvement_benefits;
    if (b.time_before !== undefined) updates.time_before = Number(b.time_before) || 0;
    if (b.time_after !== undefined) updates.time_after = Number(b.time_after) || 0;
    if (b.paper_before !== undefined) updates.paper_before = Number(b.paper_before) || 0;
    if (b.paper_after !== undefined) updates.paper_after = Number(b.paper_after) || 0;
    if (b.steps_before !== undefined) updates.steps_before = Number(b.steps_before) || 0;
    if (b.steps_after !== undefined) updates.steps_after = Number(b.steps_after) || 0;
    if (['Easy', 'Medium', 'Hard'].includes(b.difficulty)) updates.difficulty = b.difficulty;
    if (['Free', 'Low', 'Medium', 'High'].includes(b.budget)) updates.budget = b.budget;
    if (admin && ['Idea', 'Prototype', 'Testing', 'Implemented'].includes(b.project_status)) updates.project_status = b.project_status;
    if (admin && b.admin_note !== undefined) updates.admin_note = String(b.admin_note).trim();

    let updated = null;
    let useMem = false;

    if (tx) {
      try {
        let query = tx.from(T_IDEAS).update(updates).eq('id', id);
        if (!admin) query = query.eq('employee_id', req.user.employeeId);
        const { data, error } = await query.select().maybeSingle();
        if (error) {
          if (error.code === 'PGRST205' || error.code === '42P01') useMem = true;
          else throw error;
        } else {
          updated = data;
        }
      } catch (err) {
        if (!tableMissing(err)) throw err;
        useMem = true;
      }
    } else {
      useMem = true;
    }

    if (useMem) {
      const idx = mem.ideas.findIndex((i) => i.id === id && (admin || i.employee_id === req.user.employeeId));
      if (idx !== -1) {
        mem.ideas[idx] = { ...mem.ideas[idx], ...updates };
        updated = mem.ideas[idx];
      }
    }

    if (!updated) return fail(res, 404, 'ไม่พบโครงการ หรือไม่มีสิทธิ์แก้ไข');
    res.json({ ok: true, idea: updated });
  }));

  // 5. Delete idea
  app.delete('/api/workflow/ideas/:id', wrap(requireUser), wf(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) return fail(res, 400, 'ID ไม่ถูกต้อง');

    const admin = await isAdmin(req);
    let useMem = false;

    if (tx) {
      try {
        let query = tx.from(T_IDEAS).delete().eq('id', id);
        if (!admin) query = query.eq('employee_id', req.user.employeeId);
        const { error } = await query;
        if (error) {
          if (error.code === 'PGRST205' || error.code === '42P01') useMem = true;
          else throw error;
        }
      } catch (err) {
        if (!tableMissing(err)) throw err;
        useMem = true;
      }
    } else {
      useMem = true;
    }

    if (useMem) {
      mem.ideas = mem.ideas.filter((i) => !(i.id === id && (admin || i.employee_id === req.user.employeeId)));
      mem.images = mem.images.filter((img) => img.idea_id !== id);
      mem.evals = mem.evals.filter((ev) => ev.idea_id !== id);
    }

    res.json({ ok: true });
  }));

  // 6. Upload image for idea
  app.post('/api/workflow/ideas/:id/images', wrap(requireUser), wf(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) return fail(res, 400, 'ID ไม่ถูกต้อง');

    const b = req.body || {};
    const type = ['BEFORE', 'AFTER'].includes(b.image_type) ? b.image_type : 'BEFORE';
    const desc = String(b.image_description || '').trim().slice(0, 500);
    const dataUrl = String(b.image || b.image_url || '').trim();

    if (!dataUrl) return fail(res, 400, 'กรุณาแนบรูปภาพ');
    if (!imageUrl(dataUrl)) return fail(res, 400, 'รูปภาพไม่ถูกต้อง');
    if (!(await ideaEditable(req, id))) return fail(res, 403, 'แก้รูปได้เฉพาะเจ้าของโครงการหรือ Admin');

    let finalUrl = dataUrl;

    // Upload to Supabase Storage if available
    if (tx && dataUrl.startsWith('data:image/')) {
      try {
        const matches = dataUrl.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
        if (matches) {
          const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
          const buffer = Buffer.from(matches[2], 'base64');
          const fileName = `workflow/${id}_${type.toLowerCase()}_${Date.now()}.${ext}`;
          const bucket = 'img_smf';
          const up = await tx.storage.from(bucket).upload(fileName, buffer, { contentType: `image/${matches[1]}`, upsert: true });
          if (!up.error) {
            finalUrl = tx.storage.from(bucket).getPublicUrl(fileName).data.publicUrl;
          }
        }
      } catch (e) {
        // Fallback to storing dataUrl directly
      }
    }

    const row = {
      idea_id: id,
      image_type: type,
      image_url: finalUrl,
      image_description: desc,
      created_at: new Date().toISOString()
    };

    let inserted = null;
    let useMem = false;

    if (tx) {
      try {
        const { data, error } = await tx.from(T_IMAGES).insert([row]).select().maybeSingle();
        if (error) {
          if (error.code === 'PGRST205' || error.code === '42P01') useMem = true;
          else throw error;
        } else {
          inserted = data;
        }
      } catch (err) {
        if (!tableMissing(err)) throw err;
        useMem = true;
      }
    } else {
      useMem = true;
    }

    if (useMem) {
      inserted = { id: mem.nextId++, ...row };
      mem.images.push(inserted);
    }

    res.status(201).json({ ok: true, image: inserted });
  }));

  // 7. Delete image
  app.delete('/api/workflow/images/:id', wrap(requireUser), wf(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) return fail(res, 400, 'ID ไม่ถูกต้อง');
    let image = mem.images.find((img) => img.id === id) || null;
    if (!image && tx) {
      const found = await tx.from(T_IMAGES).select('id,idea_id').eq('id', id).maybeSingle();
      if (found.error && !tableMissing(found.error)) throw found.error;
      image = found.data || null;
    }
    if (!image) return fail(res, 404, 'ไม่พบรูปภาพ');
    if (!(await ideaEditable(req, image.idea_id))) return fail(res, 403, 'แก้รูปได้เฉพาะเจ้าของโครงการหรือ Admin');

    let useMem = false;
    if (tx) {
      try {
        const { error } = await tx.from(T_IMAGES).delete().eq('id', id);
        if (error) {
          if (error.code === 'PGRST205' || error.code === '42P01') useMem = true;
          else throw error;
        }
      } catch (err) {
        if (!tableMissing(err)) throw err;
        useMem = true;
      }
    } else {
      useMem = true;
    }

    if (useMem) {
      mem.images = mem.images.filter((img) => img.id !== id);
    }

    res.json({ ok: true });
  }));

  // 8. Admin evaluation & status update
  app.post('/api/workflow/ideas/:id/evaluate', wrap(requireUser), wf(async (req, res) => {
    if (!(await isAdmin(req))) return fail(res, 403, 'เฉพาะ Admin เท่านั้นที่สามารถประเมินโครงการได้');
    const id = Number(req.params.id);
    if (!id) return fail(res, 400, 'ID ไม่ถูกต้อง');

    const b = req.body || {};
    const status = ['Idea', 'Prototype', 'Testing', 'Implemented'].includes(b.project_status) ? b.project_status : 'Prototype';
    const note = String(b.admin_note || b.evaluation_note || '').trim();

    const evalRow = {
      idea_id: id,
      admin_id: req.user.employeeId,
      evaluation_note: note,
      evaluation_status: status,
      created_at: new Date().toISOString()
    };

    let useMem = false;

    if (tx) {
      try {
        const done = await Promise.all([
          tx.from(T_IDEAS).update({ project_status: status, admin_note: note, updated_at: new Date().toISOString() }).eq('id', id),
          tx.from(T_EVALS).insert([evalRow])
        ]);
        const failed = done.find((r) => r.error)?.error;
        if (failed) throw failed;
      } catch (err) {
        if (!tableMissing(err)) throw err;
        useMem = true;
      }
    } else {
      useMem = true;
    }

    if (useMem) {
      const idx = mem.ideas.findIndex((i) => i.id === id);
      if (idx !== -1) {
        mem.ideas[idx].project_status = status;
        mem.ideas[idx].admin_note = note;
        mem.ideas[idx].updated_at = new Date().toISOString();
      }
      mem.evals.push({ id: mem.nextId++, ...evalRow });
    }

    res.json({ ok: true, status, note });
  }));

  // 9. Dashboard stats
  app.get('/api/workflow/stats', wrap(requireUser), wf(async (req, res) => {
    const projCode = String(req.query.project_code || '').trim();
    let ideas = [];
    let useMem = false;

    if (tx) {
      try {
        let query = tx.from(T_IDEAS).select('*');
        if (projCode) query = query.eq('project_code', projCode);
        const { data, error } = await query;
        if (error) {
          if (error.code === 'PGRST205' || error.code === '42P01' || error.code === '42703') useMem = true;
          else throw error;
        } else {
          ideas = data || [];
        }
      } catch (err) {
        if (!tableMissing(err)) throw err;
        useMem = true;
      }
    } else {
      useMem = true;
    }

    if (useMem) {
      ideas = [...mem.ideas];
      if (projCode) ideas = ideas.filter((i) => (i.project_code || 'workflow') === projCode);
    }

    const totalProjects = ideas.length;
    const depts = new Set(ideas.map((i) => i.department).filter(Boolean));
    const totalDepartments = depts.size;

    // Reductions averages
    let paperRedSum = 0;
    let paperRedCount = 0;
    let timeSavSum = 0;
    let timeSavCount = 0;

    const byDepartment = {};
    const byBenefits = {};
    const byStatus = { Idea: 0, Prototype: 0, Testing: 0, Implemented: 0 };

    for (const item of ideas) {
      // Dept counts
      const d = item.department || 'ไม่ระบุ';
      byDepartment[d] = (byDepartment[d] || 0) + 1;

      // Status counts
      if (byStatus[item.project_status] !== undefined) {
        byStatus[item.project_status] += 1;
      } else {
        byStatus[item.project_status] = 1;
      }

      // Benefits counts
      const benefits = Array.isArray(item.improvement_benefits) ? item.improvement_benefits : [];
      for (const b of benefits) {
        byBenefits[b] = (byBenefits[b] || 0) + 1;
      }

      // Savings
      const pRed = calcReduction(item.paper_before, item.paper_after);
      if (pRed !== null) {
        paperRedSum += pRed;
        paperRedCount += 1;
      }

      const tSav = calcReduction(item.time_before, item.time_after);
      if (tSav !== null) {
        timeSavSum += tSav;
        timeSavCount += 1;
      }
    }

    res.json({
      totalProjects,
      totalDepartments,
      avgPaperReduction: paperRedCount > 0 ? Math.round((paperRedSum / paperRedCount) * 10) / 10 : 0,
      avgTimeSaving: timeSavCount > 0 ? Math.round((timeSavSum / timeSavCount) * 10) / 10 : 0,
      byDepartment,
      byBenefits,
      byStatus
    });
  }));

  // 10. Export CSV
  app.get('/api/workflow/export', wrap(requireUser), wf(async (req, res) => {
    let ideas = [];
    let useMem = false;

    if (tx) {
      try {
        const { data, error } = await tx.from(T_IDEAS).select('*').order('created_at', { ascending: false });
        if (error) {
          if (error.code === 'PGRST205' || error.code === '42P01') useMem = true;
          else throw error;
        } else {
          ideas = data || [];
        }
      } catch (err) {
        if (!tableMissing(err)) throw err;
        useMem = true;
      }
    } else {
      useMem = true;
    }

    if (useMem) {
      ideas = [...mem.ideas];
      ideas.sort((a, b) => b.created_at.localeCompare(a.created_at));
    }

    const headers = [
      'ลำดับ',
      'วันที่ส่ง',
      'รหัสพนักงาน',
      'ชื่อ-นามสกุล',
      'แผนก',
      'ชื่อกระบวนการเดิม',
      'ปัญหาที่พบ',
      'ความถี่',
      'ชื่อโครงการใหม่',
      'แนวทางการปรับปรุง',
      'เทคโนโลยีที่ใช้',
      'ประโยชน์ที่ได้รับ',
      'เวลาเดิม(นาที)',
      'เวลาใหม่(นาที)',
      '%ประหยัดเวลา',
      'กระดาษเดิม(แผ่น/ด)',
      'กระดาษใหม่(แผ่น/ด)',
      '%ลดกระดาษ',
      'ขั้นตอนเดิม',
      'ขั้นตอนใหม่',
      '%ลดขั้นตอน',
      'ระดับความยาก',
      'งบประมาณ',
      'สถานะโครงการ',
      'หมายเหตุ Admin'
    ];

    const escapeCsv = (str) => {
      if (str == null) return '';
      const s = String(str).replace(/"/g, '""');
      return `"${s}"`;
    };

    const rows = ideas.map((item, idx) => {
      const tPct = calcReduction(item.time_before, item.time_after);
      const pPct = calcReduction(item.paper_before, item.paper_after);
      const sPct = calcReduction(item.steps_before, item.steps_after);
      const benefits = Array.isArray(item.improvement_benefits) ? item.improvement_benefits.join(', ') : '';
      const dateStr = item.created_at ? new Date(item.created_at).toLocaleDateString('th-TH') : '';

      return [
        idx + 1,
        dateStr,
        item.employee_id,
        item.full_name,
        item.department,
        item.process_name,
        item.current_problem,
        item.frequency,
        item.project_name,
        item.improvement_description,
        item.proposed_technology,
        benefits,
        item.time_before,
        item.time_after,
        tPct != null ? `${tPct}%` : 'N/A',
        item.paper_before,
        item.paper_after,
        pPct != null ? `${pPct}%` : 'N/A',
        item.steps_before,
        item.steps_after,
        sPct != null ? `${sPct}%` : 'N/A',
        item.difficulty,
        item.budget,
        item.project_status,
        item.admin_note || ''
      ].map(escapeCsv).join(',');
    });

    // UTF-8 BOM + CSV
    const csvContent = '\uFEFF' + [headers.map(escapeCsv).join(','), ...rows].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="workflow_automation_ideas.csv"');
    res.send(csvContent);
  }));
}

