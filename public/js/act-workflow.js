// Work Flow Automation Module (SMF: Transaction)
// Concept: Less Paper. Less Time. More Efficiency.

const WFA_TECH_OPTIONS = [
  'Web Application',
  'Mobile Application',
  'Digital Form',
  'QR Code',
  'Workflow Approval',
  'Auto Notification',
  'Dashboard',
  'AI / OCR',
  'IoT',
  'Other'
];

const WFA_BENEFITS = [
  { id: 'paper', label: 'Reduce Paper', th: 'ลดการใช้กระดาษ', icon: 'description' },
  { id: 'time', label: 'Reduce Working Time', th: 'ลดเวลาการทำงาน', icon: 'schedule' },
  { id: 'steps', label: 'Reduce Process Steps', th: 'ลดขั้นตอนการทำงาน', icon: 'route' },
  { id: 'manpower', label: 'Reduce Manpower', th: 'ลดกำลังคน', icon: 'groups' },
  { id: 'error', label: 'Reduce Human Error', th: 'ลดความผิดพลาด', icon: 'verified_user' },
  { id: 'wait', label: 'Reduce Waiting Time', th: 'ลดเวลารอคอย', icon: 'hourglass_empty' },
  { id: 'access', label: 'Improve Data Accessibility', th: 'เข้าถึงข้อมูลได้ง่ายขึ้น', icon: 'cloud_done' },
  { id: 'track', label: 'Improve Tracking & Monitoring', th: 'ติดตามสถานะได้ดีขึ้น', icon: 'monitoring' }
];

const WFA_STATUS_BADGES = {
  Idea: { label: 'Idea (แนวคิด)', class: 'badge-neutral' },
  Prototype: { label: 'Prototype (ต้นแบบ)', class: 'badge-warning' },
  Testing: { label: 'Testing (ทดสอบ)', class: 'badge-info' },
  Implemented: { label: 'Implemented (ใช้งานจริง)', class: 'badge-success' }
};

function wfaCalcReduction(before, after) {
  const b = Number(before);
  const a = Number(after);
  if (!Number.isFinite(b) || b <= 0) return null;
  if (!Number.isFinite(a) || a < 0) return 0;
  return Math.round(((b - a) / b) * 1000) / 10;
}

// Render a single Improvement Proposal card matching Image 2 (16:9 Before/After + Details + Expected Results table)
function wfaProposalCardHtml(item, { showActions = true } = {}) {
  const imgs = Array.isArray(item.images) ? item.images : [];
  const beforeImgs = imgs.filter((img) => img.image_type === 'BEFORE');
  const afterImgs = imgs.filter((img) => img.image_type === 'AFTER');
  const firstBefore = beforeImgs[0] || null;
  const firstAfter = afterImgs[0] || null;

  const status = WFA_STATUS_BADGES[item.project_status] || WFA_STATUS_BADGES.Idea;
  const tPct = item.time_saving_pct ?? wfaCalcReduction(item.time_before, item.time_after);
  const pPct = item.paper_reduction_pct ?? wfaCalcReduction(item.paper_before, item.paper_after);
  const sPct = item.steps_reduction_pct ?? wfaCalcReduction(item.steps_before, item.steps_after);
  const dateText = item.created_at ? new Date(item.created_at).toLocaleDateString('th-TH') : '';

  const beforeCap = firstBefore?.image_description || item.current_problem || item.current_description || '-';
  const afterCap = firstAfter?.image_description || item.improvement_description || '-';

  return `
    <article class="wfa-proposal-card" data-prop-card="${item.id}">
      <div class="wfa-prop-top">
        <div>
          <h3 class="wfa-prop-heading">Improvement Proposal</h3>
          <div class="wfa-prop-submeta">
            ${item.team_name ? `กลุ่ม: <b>${esc(item.team_name)}</b> · ` : ''}ผู้เสนอ: ${esc(item.full_name || '-')}${item.employee_id ? ` (${esc(item.employee_id)})` : ''} · แผนก: ${esc(item.department || '-')}${dateText ? ` · วันที่ส่ง: ${esc(dateText)}` : ''}
            ${Array.isArray(item.team_members) && item.team_members.length ? `<br><small class="sum-meta">สมาชิกในกลุ่ม: ${item.team_members.map((m) => esc(typeof m === 'object' ? (m.name || m.employee_id) : m)).join(', ')}</small>` : ''}
          </div>
        </div>
        <div class="wfa-prop-top-actions">
          <span class="badge ${status.class}">${status.label}</span>
          ${showActions ? `
            <button class="btn btn-secondary small" type="button" data-act-view="${item.id}">
              <span class="material-symbols-rounded">visibility</span> ${item.can_evaluate ? 'รายละเอียด / ประเมิน' : 'รายละเอียด'}
            </button>
            ${item.can_edit ? `
              <button class="btn btn-danger small" type="button" data-act-del="${item.id}" title="ลบโครงการ">
                <span class="material-symbols-rounded">delete</span>
              </button>
            ` : ''}
          ` : ''}
        </div>
      </div>

      <div class="wfa-prop-proj-title">Project: ${esc(item.project_name || '-')}</div>

      <div class="wfa-prop-media-grid">
        <!-- BEFORE Column (16:9) -->
        <div class="wfa-prop-media-col">
          <div class="wfa-prop-img-wrap">
            ${firstBefore ? `<img src="${firstBefore.image_url}" alt="Before" class="img-zoom" id="wfa-prop-b-img-${item.id}">` : `
              <div class="wfa-prop-img-empty">
                <span class="material-symbols-rounded">image</span>
                <span>ไม่มีรูปภาพ Before (16:9)</span>
              </div>
            `}
          </div>
          ${beforeImgs.length > 1 ? `
            <div class="wfa-prop-thumbs">
              ${beforeImgs.map((img, i) => `
                <button type="button" class="wfa-prop-thumb-btn ${i === 0 ? 'is-active' : ''}" data-swap-img="wfa-prop-b-img-${item.id}" data-swap-cap="wfa-prop-b-cap-${item.id}" data-src="${img.image_url}" data-desc="${esc(img.image_description || beforeCap)}">
                  <img src="${img.image_url}" alt="Before ${i + 1}">
                </button>
              `).join('')}
            </div>
          ` : ''}
          <span class="wfa-prop-pill is-before">BEFORE</span>
          <div class="wfa-prop-cap-title">${esc(item.process_name || 'Current Process')}</div>
          <div class="wfa-prop-cap-sub" id="wfa-prop-b-cap-${item.id}">${esc(beforeCap)}</div>
        </div>

        <!-- AFTER Column (16:9) -->
        <div class="wfa-prop-media-col">
          <div class="wfa-prop-img-wrap">
            ${firstAfter ? `<img src="${firstAfter.image_url}" alt="After" class="img-zoom" id="wfa-prop-a-img-${item.id}">` : `
              <div class="wfa-prop-img-empty">
                <span class="material-symbols-rounded">auto_awesome</span>
                <span>ไม่มีรูปภาพ After (16:9)</span>
              </div>
            `}
          </div>
          ${afterImgs.length > 1 ? `
            <div class="wfa-prop-thumbs">
              ${afterImgs.map((img, i) => `
                <button type="button" class="wfa-prop-thumb-btn ${i === 0 ? 'is-active' : ''}" data-swap-img="wfa-prop-a-img-${item.id}" data-swap-cap="wfa-prop-a-cap-${item.id}" data-src="${img.image_url}" data-desc="${esc(img.image_description || afterCap)}">
                  <img src="${img.image_url}" alt="After ${i + 1}">
                </button>
              `).join('')}
            </div>
          ` : ''}
          <span class="wfa-prop-pill is-after">AFTER</span>
          <div class="wfa-prop-cap-title">${esc(item.proposed_technology || item.project_name || 'Digital Solution')}</div>
          <div class="wfa-prop-cap-sub" id="wfa-prop-a-cap-${item.id}">${esc(afterCap)}</div>
        </div>
      </div>

      <!-- รายละเอียดการปรับปรุง -->
      <div class="wfa-prop-sec">
        <h4 class="wfa-prop-sec-title">รายละเอียดการปรับปรุง</h4>
        <div class="wfa-prop-detail-item">
          <span class="wfa-prop-detail-lbl">Before</span>
          <p class="wfa-prop-detail-text">${esc(item.current_description || '-')}${item.current_problem && item.current_problem !== item.current_description ? ` · ปัญหา: ${esc(item.current_problem)}` : ''}</p>
        </div>
        <div class="wfa-prop-detail-item">
          <span class="wfa-prop-detail-lbl">After</span>
          <p class="wfa-prop-detail-text">${esc(item.improvement_description || '-')}</p>
        </div>
      </div>

      <!-- ผลลัพธ์ที่คาดหวัง -->
      <div class="wfa-prop-sec">
        <h4 class="wfa-prop-sec-title">ผลลัพธ์ที่คาดหวัง</h4>
        <table class="wfa-prop-table">
          <thead>
            <tr>
              <th>ตัวชี้วัด</th>
              <th class="num">Before</th>
              <th class="num">After</th>
              <th class="num">ผลประหยัด</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>เวลาทำงาน</td>
              <td class="num">${Number(item.time_before || 0).toLocaleString('th-TH')} นาที</td>
              <td class="num">${Number(item.time_after || 0).toLocaleString('th-TH')} นาที</td>
              <td class="num is-save">${tPct != null ? `ลดลง ${tPct}%` : 'N/A'}</td>
            </tr>
            <tr>
              <td>การใช้กระดาษ</td>
              <td class="num">${Number(item.paper_before || 0).toLocaleString('th-TH')} แผ่น/เดือน</td>
              <td class="num">${Number(item.paper_after || 0).toLocaleString('th-TH')} แผ่น/เดือน</td>
              <td class="num is-save">${pPct != null ? `ลดลง ${pPct}%` : 'N/A'}</td>
            </tr>
            <tr>
              <td>ขั้นตอนการทำงาน</td>
              <td class="num">${Number(item.steps_before || 0).toLocaleString('th-TH')} ขั้นตอน</td>
              <td class="num">${Number(item.steps_after || 0).toLocaleString('th-TH')} ขั้นตอน</td>
              <td class="num is-save">${sPct != null ? `ลดลง ${sPct}%` : 'N/A'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="wfa-prop-foot">
        <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">
          <span class="wfa-prop-chip"><span class="material-symbols-rounded" style="font-size:14px">memory</span> ${esc(item.proposed_technology || '-')}</span>
          ${(item.improvement_benefits || []).map((b) => `<span class="wfa-prop-chip">${esc(b)}</span>`).join('')}
        </div>
        <div>
          ความยาก: <b>${esc(item.difficulty || '-')}</b> · งบประมาณ: <b>${esc(item.budget || '-')}</b>${item.frequency ? ` · ความถี่: <b>${esc(item.frequency)}</b>` : ''}
        </div>
      </div>
    </article>
  `;
}

function wfaBindProposalThumbs(root) {
  root.querySelectorAll('[data-swap-img]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const imgEl = $(btn.dataset.swapImg);
      const capEl = $(btn.dataset.swapCap);
      if (imgEl) imgEl.src = btn.dataset.src;
      if (capEl && btn.dataset.desc) capEl.textContent = btn.dataset.desc;
      btn.parentElement.querySelectorAll('.wfa-prop-thumb-btn').forEach((b) => b.classList.toggle('is-active', b === btn));
    };
  });
}

// SMF: Transaction - Unified Project View (Smart OEE, Vision Camera, Work Flow Automation)
async function wfaRenderSmfTransaction(target, currentProj, actMe, rerender, pmData, byMonth, projTabs, allProjects = []) {
  // Merge global logged-in user `me` (from core.js) with activity access `actMe`
  const userMe = { ...(typeof me === 'object' && me ? me : {}), ...(actMe || {}) };
  const isTeam = currentProj.team_type === 'team' || (currentProj.code && currentProj.code !== 'workflow');
  const projList = Array.isArray(allProjects) && allProjects.length
    ? allProjects
    : (pmData?.projects || []).filter((p) => p.status === 'Active');

  let ideas = [];
  let stats = {};
  let depts = [];
  let teamMembers = [];

  try {
    const tData = await a5Api('smf', `team?year=${a5Year}`).catch(() => ({ members: [] }));
    const seen = new Set();
    for (const m of (tData.members || [])) {
      if (m.status !== 'Active') continue;
      const empId = String(m.employee_id || '').trim();
      if (!empId || seen.has(empId)) continue;
      seen.add(empId);
      teamMembers.push({
        employee_id: empId,
        name: String(m.name || '').trim(),
        department: String(m.department || '').trim(),
        role: String(m.role || '').trim()
      });
    }
  } catch (_) {}

  const filter = {
    q: '',
    department: '',
    status: '',
    myOnly: false
  };

  const loadData = async () => {
    const qParams = new URLSearchParams();
    qParams.set('project_code', currentProj.code || 'workflow');
    if (filter.q) qParams.set('q', filter.q);
    if (filter.department) qParams.set('department', filter.department);
    if (filter.status) qParams.set('status', filter.status);
    if (filter.myOnly) qParams.set('my', '1');

    const [iData, sData] = await Promise.all([
      api(`/api/workflow/ideas?${qParams.toString()}`).catch(() => ({ ideas: [] })),
      api(`/api/workflow/stats?project_code=${encodeURIComponent(currentProj.code || 'workflow')}`).catch(() => ({}))
    ]);
    ideas = iData.ideas || [];
    stats = sData || {};
    depts = Object.keys(stats.byDepartment || {}).sort();
    render();
  };

  function render() {
    const rowsHtml = ideas.map((item, idx) => {
      const status = WFA_STATUS_BADGES[item.project_status] || WFA_STATUS_BADGES.Idea;
      const tPct = item.time_saving_pct != null ? `${item.time_saving_pct}%` : null;
      const pPct = item.paper_reduction_pct != null ? `${item.paper_reduction_pct}%` : null;
      const memberNames = Array.isArray(item.team_members) && item.team_members.length
        ? item.team_members.map((m) => (typeof m === 'object' ? (m.name || m.employee_id) : m)).filter(Boolean).join(', ')
        : '';
      const presenterHtml = item.team_name
        ? `<div class="wfa-col-emp"><strong>${esc(item.team_name)}</strong><small class="sum-meta">${esc(memberNames || item.full_name)} · ${esc(item.department || '-')}</small></div>`
        : `<div class="wfa-col-emp"><span>${esc(item.full_name)}</span><small class="sum-meta">${esc(item.department || '-')}${item.employee_id ? ` · ${esc(item.employee_id)}` : ''}</small></div>`;

      return `
        <tr data-pick-id="${item.id}" class="row-pick">
          <td>${idx + 1}</td>
          <td><small class="sum-meta">${item.created_at ? new Date(item.created_at).toLocaleDateString('th-TH') : ''}</small></td>
          <td><div class="wfa-col-title"><strong>${esc(item.project_name)}</strong></div></td>
          <td><span class="wfa-text-muted">${esc(item.process_name)}</span></td>
          <td>${presenterHtml}</td>
          <td><span class="wfa-tech-badge">${esc(item.proposed_technology || '-')}</span></td>
          <td>
            <div class="wfa-col-savings">
              ${tPct ? `<span class="wfa-saving-mini" title="ลดเวลาทำงาน"><span class="material-symbols-rounded">timer</span>${tPct}</span>` : ''}
              ${pPct ? `<span class="wfa-saving-mini is-paper" title="ลดการใช้กระดาษ"><span class="material-symbols-rounded">description</span>${pPct}</span>` : ''}
              ${!tPct && !pPct ? '<span class="sum-meta">-</span>' : ''}
            </div>
          </td>
          <td><span class="badge ${status.class}">${status.label}</span></td>
          <td style="text-align:center" onclick="event.stopPropagation()">
            <button class="btn btn-secondary small" type="button" data-act-view="${item.id}" style="padding:2px 8px;min-height:22px;font-size:11px" title="กดแสดงผล Improvement Proposal">
              <span class="material-symbols-rounded" style="font-size:13px">visibility</span> แสดงผล
            </button>
          </td>
        </tr>
      `;
    }).join('');

    const contentHtml = `
      <div class="table-wrap sheet" id="wfa-table-wrap">
        <table class="mo-data-table">
          <thead>
            <tr>
              <th style="width:45px">no</th>
              <th style="width:90px">วันที่ส่ง</th>
              <th>ชื่อโปรเจค (AFTER)</th>
              <th>กระบวนการเดิม (BEFORE)</th>
              <th>ผู้เสนอ / ทีม / แผนก</th>
              <th>เทคโนโลยี</th>
              <th>ผลประหยัด / KPI</th>
              <th style="width:115px">สถานะ</th>
              <th style="width:120px;text-align:center">การจัดการ</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || `<tr><td colspan="9" class="empty">ยังไม่มีการส่งข้อมูลโปรเจค ${esc(currentProj.name)} หรือไม่พบข้อมูลตามตัวกรอง · คลิก "เพิ่ม" เพื่อส่งโครงการแรก</td></tr>`}
          </tbody>
        </table>
      </div>
      <p class="sum-meta">${ideas.length} รายการ · ดับเบิลคลิกแถวเพื่อดูรายละเอียด</p>
    `;

    setHeaderMeta(`<span class="sum-meta">${esc(currentProj.name)}</span> <strong>${currentProj.target_count ? `เป้าหมาย ${currentProj.target_count} ${esc(currentProj.unit || 'โครงการ')}` : 'วัดตามแผนงาน'}</strong>`);

    const leftBar = `
      <div class="field" style="margin:0;min-width:170px">
        <select id="smf-proj-select" style="font-weight:700;font-size:13px;padding:4px 8px;border-radius:var(--mo-radius);background:var(--mo-surface);color:var(--mo-text);border:1px solid var(--mo-border);cursor:pointer">
          ${projList.map((p) => `<option value="${p.id}" ${p.id === currentProj.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select>
      </div>
    `;

    const rightBar = `
      <div class="toolbar a5-filters" style="margin:0;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <div class="field" style="width:160px">
          <input id="wfa-flt-q" placeholder="ค้นหาโปรเจค, ปัญหา, พนักงาน" value="${esc(filter.q)}" style="padding:4px 8px;font-size:12px">
        </div>
        <div class="field" style="width:110px">
          <select id="wfa-flt-dept" style="padding:4px 6px;font-size:12px">
            <option value="">ทุกแผนก</option>
            ${options(depts, filter.department)}
          </select>
        </div>
        <div class="field" style="width:110px">
          <select id="wfa-flt-status" style="padding:4px 6px;font-size:12px">
            <option value="">ทุกสถานะ</option>
            ${options(['Idea', 'Prototype', 'Testing', 'Implemented'], filter.status, (v) => WFA_STATUS_BADGES[v]?.label || v)}
          </select>
        </div>
        <label class="wfa-check-label" style="align-self:center;font-size:11.5px;margin:0;white-space:nowrap">
          <input type="checkbox" id="wfa-flt-my" ${filter.myOnly ? 'checked' : ''}> เฉพาะของฉัน
        </label>
        <div class="a5-year">${a5YearSelect(userMe.years)}</div>
        <div class="action-bar a5-actions" style="margin:0">
          ${button('wfa-btn-add', 'เพิ่ม', 'primary')}
          ${button('wfa-btn-edit', 'แก้ไข', 'secondary', 'disabled')}
          ${button('wfa-btn-del', 'ลบ', 'danger', 'disabled')}
        </div>
      </div>
    `;

    target.innerHTML = `
      <div class="view-body"><section class="card">
        ${pageBar(leftBar, rightBar, 'smf')}
        ${contentHtml}
      </section></div>
    `;

    bindTxEvents();
  }

  function bindTxEvents() {
    let picked = null;
    const updateActions = () => {
      if ($('wfa-btn-edit')) $('wfa-btn-edit').disabled = !picked || !picked.can_edit;
      if ($('wfa-btn-del')) $('wfa-btn-del').disabled = !picked || !picked.can_edit;
    };

    if ($('smf-proj-select')) {
      $('smf-proj-select').onchange = () => {
        smfPickedProj['smf'] = Number($('smf-proj-select').value);
        rerender();
      };
    }

    if ($('a5-year')) {
      $('a5-year').onchange = () => {
        a5Year = Number($('a5-year').value);
        rerender();
      };
    }

    if ($('wfa-btn-add')) {
      $('wfa-btn-add').onclick = () => wfaOpenSubmitWizard(userMe, loadData, teamMembers, currentProj);
    }

    if ($('wfa-btn-edit')) {
      $('wfa-btn-edit').onclick = () => {
        if (picked) wfaOpenSubmitWizard(userMe, loadData, teamMembers, currentProj, picked);
      };
    }

    if ($('wfa-btn-del')) {
      $('wfa-btn-del').onclick = () => {
        if (!picked) return;
        confirmPopup('ลบโครงการ', `ต้องการลบโครงการ "${esc(picked.project_name)}" หรือไม่?`, async () => {
          await api(`/api/workflow/ideas/${picked.id}`, { method: 'DELETE' });
          toast('ลบเรียบร้อยแล้ว');
          picked = null;
          updateActions();
          loadData();
        });
      };
    }

    $('wfa-flt-q').onchange = () => { filter.q = $('wfa-flt-q').value.trim(); loadData(); };
    $('wfa-flt-dept').onchange = () => { filter.department = $('wfa-flt-dept').value; loadData(); };
    $('wfa-flt-status').onchange = () => { filter.status = $('wfa-flt-status').value; loadData(); };
    $('wfa-flt-my').onchange = () => { filter.myOnly = $('wfa-flt-my').checked; loadData(); };

    target.querySelectorAll('[data-act-view]').forEach((node) => {
      node.onclick = (e) => {
        e.stopPropagation();
        wfaOpenDetail(Number(node.dataset.actView), loadData);
      };
    });

    target.querySelectorAll('tr[data-pick-id]').forEach((node) => {
      node.onclick = () => {
        const id = Number(node.dataset.pickId);
        if (picked?.id === id) {
          picked = null;
          node.classList.remove('is-selected');
        } else {
          target.querySelectorAll('tr[data-pick-id]').forEach((r) => r.classList.toggle('is-selected', r === node));
          picked = ideas.find((i) => i.id === id) || null;
        }
        updateActions();
      };
      node.ondblclick = () => {
        wfaOpenDetail(Number(node.dataset.pickId), loadData);
      };
    });
  }

  await loadData();
}

// 6-Step Submission Wizard in Modal Popup
function wfaOpenSubmitWizard(userMe, onSuccess, teamMembers = [], currentProj = {}, editIdea = null) {
  let step = 1;
  const isEdit = Boolean(editIdea && editIdea.id);
  const beforeImages = Array.isArray(editIdea?.images) ? editIdea.images.filter((img) => img.image_type === 'BEFORE') : [];
  const afterImages = Array.isArray(editIdea?.images) ? editIdea.images.filter((img) => img.image_type === 'AFTER') : [];

  const isTeam = currentProj.team_type === 'team' || (currentProj.code && currentProj.code !== 'workflow');
  const projTitle = currentProj.name || 'Work Flow Automation';
  const projCode = currentProj.code || 'workflow';

  let techOptions = WFA_TECH_OPTIONS;
  if (projCode === 'oee') {
    techOptions = [
      'Smart OEE System',
      'IoT Sensors & Gateway',
      'PLC / Machine Data Logging',
      'Real-time OEE Dashboard',
      'Auto Downtime Alert / Line Notify',
      'Digital Checklist & Maintenance Form',
      'Web Application',
      'Mobile Application',
      'Other'
    ];
  } else if (projCode === 'vision') {
    techOptions = [
      'Vision Inspection Camera',
      'AI / Deep Learning Object Detection',
      'OCR / Barcode / 2D DataMatrix Scanner',
      'Defect Sorting & Auto Reject System',
      'Edge Computing Box',
      'Real-time Inspection Dashboard',
      'Web Application',
      'Other'
    ];
  }

  const myEmpId = String(userMe?.employeeId || '').trim();
  const matchedMember = teamMembers.find((m) => m.employee_id === myEmpId);

  const state = {
    project_code: editIdea?.project_code || projCode,
    team_name: editIdea?.team_name || '',
    team_members: Array.isArray(editIdea?.team_members) ? editIdea.team_members : [],
    employee_id: editIdea ? String(editIdea.employee_id || '') : myEmpId,
    full_name: editIdea ? String(editIdea.full_name || '') : String(userMe?.name || matchedMember?.name || '').trim(),
    department: editIdea ? String(editIdea.department || '') : String(userMe?.department || matchedMember?.department || '').trim(),
    process_name: editIdea?.process_name || '',
    current_description: editIdea?.current_description || '',
    current_problem: editIdea?.current_problem || '',
    frequency: editIdea?.frequency || 'ทุกวัน (Daily)',
    project_name: editIdea?.project_name || '',
    improvement_description: editIdea?.improvement_description || '',
    proposed_technology: editIdea?.proposed_technology || techOptions[0],
    improvement_benefits: Array.isArray(editIdea?.improvement_benefits) ? editIdea.improvement_benefits : [],
    time_before: editIdea ? Number(editIdea.time_before) || 0 : 0,
    time_after: editIdea ? Number(editIdea.time_after) || 0 : 0,
    paper_before: editIdea ? Number(editIdea.paper_before) || 0 : 0,
    paper_after: editIdea ? Number(editIdea.paper_after) || 0 : 0,
    steps_before: editIdea ? Number(editIdea.steps_before) || 0 : 0,
    steps_after: editIdea ? Number(editIdea.steps_after) || 0 : 0,
    difficulty: editIdea?.difficulty || 'Medium',
    budget: editIdea?.budget || 'Free',
    project_status: editIdea?.project_status || 'Idea',
    admin_note: editIdea?.admin_note || ''
  };

  const modalHtml = `
    <div class="wfa-wizard-modal">
      <div class="wfa-stepper">
        ${[
          ['1', 'ผู้ส่ง', 'person'],
          ['2', 'BEFORE', 'history'],
          ['3', 'AFTER', 'lightbulb'],
          ['4', 'ประโยชน์', 'verified'],
          ['5', 'ผลลัพธ์', 'calculate'],
          ['6', 'ดำเนินการ', 'rocket_launch']
        ].map(([, sLabel, sIcon], idx) => {
          const num = idx + 1;
          const cls = num === step ? 'is-current' : num < step ? 'is-done' : '';
          return `
            <div class="wfa-step-item ${cls}" data-wfa-step="${num}" title="ไปยังขั้นตอนที่ ${num}: ${sLabel}">
              <div class="wfa-step-circle">
                <span class="material-symbols-rounded">${sIcon}</span>
              </div>
              <div class="wfa-step-lbl">${sLabel}</div>
            </div>
          `;
        }).join('')}
      </div>

      <div class="wfa-step-body" id="wfa-wiz-body"></div>

      <div class="wfa-wizard-nav" style="margin-top:16px;border-top:1px solid var(--mo-line);padding-top:12px">
        <button class="btn btn-secondary" type="button" id="wfa-wiz-prev">
          <span class="material-symbols-rounded">chevron_left</span> ย้อนกลับ
        </button>
        <div class="wfa-nav-spacer" style="text-align:center;font-size:12px;color:var(--mo-text-muted)" id="wfa-wiz-step-indicator"></div>
        <button class="btn btn-secondary" type="button" id="wfa-wiz-next">
          ถัดไป <span class="material-symbols-rounded">chevron_right</span>
        </button>
      </div>
    </div>
  `;

  function saveCurrentStep() {
    if (step === 1) {
      if ($('wfa-empid')) state.employee_id = $('wfa-empid').value.trim();
      if ($('wfa-name')) state.full_name = $('wfa-name').value.trim();
      if ($('wfa-dept')) state.department = $('wfa-dept').value.trim();
      if ($('wfa-team-name')) state.team_name = $('wfa-team-name').value.trim();
      const chkMembers = document.querySelectorAll('[name="wfa-team-member"]:checked');
      if (chkMembers.length || document.querySelector('[name="wfa-team-member"]')) {
        state.team_members = Array.from(chkMembers).map((el) => ({
          employee_id: el.value,
          name: el.dataset.name || '',
          department: el.dataset.dept || ''
        }));
      }
    } else if (step === 2) {
      if ($('wfa-proc-name')) state.process_name = $('wfa-proc-name').value.trim();
      if ($('wfa-proc-desc')) state.current_description = $('wfa-proc-desc').value.trim();
      if ($('wfa-proc-prob')) state.current_problem = $('wfa-proc-prob').value.trim();
      if ($('wfa-proc-freq')) state.frequency = $('wfa-proc-freq').value || state.frequency;
    } else if (step === 3) {
      if ($('wfa-proj-name')) state.project_name = $('wfa-proj-name').value.trim();
      if ($('wfa-proj-desc')) state.improvement_description = $('wfa-proj-desc').value.trim();
      if ($('wfa-proj-tech')) state.proposed_technology = $('wfa-proj-tech').value || state.proposed_technology;
    } else if (step === 4) {
      const chks = document.querySelectorAll('[name="wfa-benefit"]:checked');
      if (chks.length || document.querySelector('[name="wfa-benefit"]')) {
        state.improvement_benefits = Array.from(chks).map((n) => n.value);
      }
    } else if (step === 5) {
      if ($('wfa-t-b')) state.time_before = Number($('wfa-t-b').value) || 0;
      if ($('wfa-t-a')) state.time_after = Number($('wfa-t-a').value) || 0;
      if ($('wfa-p-b')) state.paper_before = Number($('wfa-p-b').value) || 0;
      if ($('wfa-p-a')) state.paper_after = Number($('wfa-p-a').value) || 0;
      if ($('wfa-s-b')) state.steps_before = Number($('wfa-s-b').value) || 0;
      if ($('wfa-s-a')) state.steps_after = Number($('wfa-s-a').value) || 0;
    } else if (step === 6) {
      if ($('wfa-remarks')) state.admin_note = $('wfa-remarks').value.trim();
    }
  }

  // Validate only when clicking Save (บันทึก)
  async function handleFinalSave() {
    saveCurrentStep();

    if (isTeam && !state.team_name) {
      step = 1;
      renderStep();
      $('wfa-team-name')?.focus();
      throw new Error('กรุณาระบุชื่อกลุ่ม / ชื่อทีม (ขั้นตอนที่ 1)');
    }
    if (!state.full_name) {
      step = 1;
      renderStep();
      $('wfa-name')?.focus();
      throw new Error(`กรุณาระบุชื่อ-นามสกุล${isTeam ? 'ผู้ส่ง/หัวหน้ากลุ่ม' : 'ผู้ส่ง'} (ขั้นตอนที่ 1)`);
    }
    if (!state.process_name) {
      step = 2;
      renderStep();
      $('wfa-proc-name')?.focus();
      throw new Error('กรุณาระบุชื่อกระบวนการเดิมที่ต้องการปรับปรุง (ขั้นตอนที่ 2 BEFORE)');
    }
    if (!state.current_description) {
      step = 2;
      renderStep();
      $('wfa-proc-desc')?.focus();
      throw new Error('กรุณาอธิบายวิธีการทำงานปัจจุบัน (ขั้นตอนที่ 2 BEFORE)');
    }
    if (!state.current_problem) {
      step = 2;
      renderStep();
      $('wfa-proc-prob')?.focus();
      throw new Error('กรุณาระบุปัญหาที่พบในปัจจุบัน (ขั้นตอนที่ 2 BEFORE)');
    }
    if (!state.project_name) {
      step = 3;
      renderStep();
      $('wfa-proj-name')?.focus();
      throw new Error('กรุณาระบุชื่อแนวคิดหรือโครงการ (ขั้นตอนที่ 3 AFTER)');
    }
    if (!state.improvement_description) {
      step = 3;
      renderStep();
      $('wfa-proj-desc')?.focus();
      throw new Error('กรุณาระบุแนวทางการปรับปรุง (ขั้นตอนที่ 3 AFTER)');
    }

    const payload = {
      ...state,
      images: [...beforeImages, ...afterImages]
    };

    if (isEdit) {
      await api(`/api/workflow/ideas/${editIdea.id}`, { method: 'PATCH', body: payload });
      toast(`แก้ไขข้อมูลโปรเจค ${projTitle} เรียบร้อยแล้ว`);
    } else {
      await api('/api/workflow/ideas', { method: 'POST', body: payload });
      toast(`บันทึกข้อมูลโปรเจค ${projTitle} สำเร็จแล้ว`);
    }
    closePopup();
    if (onSuccess) onSuccess();
  }

  openPopup(isEdit ? `แก้ไขข้อมูลโปรเจค ${projTitle}` : `ส่งข้อมูลโปรเจค ${projTitle}`, modalHtml, handleFinalSave, 'บันทึก');
  const popupEl = $('popup')?.querySelector('.popup');
  if (popupEl) {
    popupEl.style.alignSelf = 'start';
    popupEl.style.marginTop = 'max(16px, min(4vh, 28px))';
    popupEl.style.width = 'min(760px, 95vw)';
    popupEl.style.height = 'min(88vh, 740px)';
    popupEl.style.maxHeight = 'min(92vh, 860px)';
  }

  let empLookupTimer = null;

  function renderStep() {
    const body = $('wfa-wiz-body');
    if (!body) return;

    // Update Stepper header
    document.querySelectorAll('[data-wfa-step]').forEach((item) => {
      const num = Number(item.dataset.wfaStep);
      item.classList.toggle('is-current', num === step);
      item.classList.toggle('is-done', num < step);
    });

    if ($('wfa-wiz-prev')) $('wfa-wiz-prev').disabled = step <= 1;
    if ($('wfa-wiz-next')) $('wfa-wiz-next').disabled = step >= 6;
    if ($('wfa-wiz-step-indicator')) $('wfa-wiz-step-indicator').textContent = `ขั้นตอนที่ ${step} / 6 · กดถัดไป/ย้อนกลับได้อิสระ และกด "บันทึก" เมื่อกรอกครบ`;

    if (step === 1) {
      const memberOptions = teamMembers.map((m) => {
        const sel = m.employee_id === state.employee_id ? ' selected' : '';
        return `<option value="${esc(m.employee_id)}" data-name="${esc(m.name)}" data-dept="${esc(m.department || '')}"${sel}>${esc(m.employee_id)} · ${esc(m.name)}${m.department ? ` (${esc(m.department)})` : ''}</option>`;
      }).join('');

      const teamSectionHtml = isTeam ? `
        <div class="field" style="margin-bottom:10px">
          <label class="field required">
            ชื่อกลุ่ม / ชื่อทีม (Team Name)
            <input id="wfa-team-name" maxlength="200" value="${esc(state.team_name)}" placeholder="เช่น กลุ่ม AI Vision Line 1, กลุ่ม Smart OEE Press" style="margin-top:4px">
          </label>
        </div>
      ` : '';

      const teamMembersPickerHtml = isTeam && teamMembers.length ? `
        <div class="field" style="margin-top:10px">
          <label style="font-weight:600;font-size:12px;margin-bottom:6px;display:block">เลือกสมาชิกในกลุ่มที่ร่วมทำโปรเจค (เลือกได้หลายคน):</label>
          <div class="wfa-member-grid">
            ${teamMembers.map((m) => {
              const isChecked = state.team_members.some((tm) => tm.employee_id === m.employee_id || tm.name === m.name);
              return `
                <label class="wfa-member-card ${isChecked ? 'is-selected' : ''}">
                  <input type="checkbox" name="wfa-team-member" value="${esc(m.employee_id)}" data-name="${esc(m.name)}" data-dept="${esc(m.department || '')}" ${isChecked ? 'checked' : ''}>
                  <span>${esc(m.name)} <small>(${esc(m.department || '-')})</small></span>
                </label>
              `;
            }).join('')}
          </div>
        </div>
      ` : '';

      body.innerHTML = `
        <div class="wfa-step-section">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">
            <span class="wfa-sec-badge">Section 01</span>
            <h3 style="margin:0;font-size:15px;font-weight:700">${isTeam ? 'ข้อมูลกลุ่มและผู้ส่ง (Team & Submitter)' : 'ข้อมูลสมาชิกผู้ส่ง (Member Information)'}</h3>
          </div>
          ${teamSectionHtml}
          ${memberOptions ? `
          <div class="field" style="margin-bottom:10px">
            <label>${isTeam ? 'เลือกหัวหน้ากลุ่ม / ผู้ส่งหลัก (เชื่อมโยงรหัส ชื่อ และแผนกอัตโนมัติ)' : 'เลือกสมาชิกในทีม SMF (เชื่อมโยงรหัส ชื่อ และแผนกอัตโนมัติ)'}</label>
            <select id="wfa-pick-member">
              <option value="">-- เลือกจากรายชื่อ หรือกรอกเองด้านล่าง --</option>
              ${memberOptions}
            </select>
          </div>` : ''}
          <div class="wfa-form-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px">
            ${field(isTeam ? 'รหัสพนักงานผู้ส่ง' : 'รหัสพนักงาน', `<input id="wfa-empid" value="${esc(state.employee_id)}" placeholder="เช่น 2101999" autocomplete="off">`)}
            ${field(isTeam ? 'ชื่อ-นามสกุลผู้ส่ง' : 'ชื่อ-นามสกุล', `<input id="wfa-name" value="${esc(state.full_name)}" placeholder="เช่น นางสาว อัจฉรา โสกาบุญ" autocomplete="off">`, 'required')}
            ${field('แผนก / หน่วยงาน', `<input id="wfa-dept" value="${esc(state.department)}" placeholder="เช่น PLN & STO" autocomplete="off">`)}
            ${field('วันที่ส่ง', `<input value="${new Date().toLocaleDateString('th-TH')}" readonly class="is-locked">`)}
          </div>
          ${teamMembersPickerHtml}
        </div>
      `;

      if ($('wfa-team-name')) {
        $('wfa-team-name').oninput = () => { state.team_name = $('wfa-team-name').value.trim(); };
      }

      body.querySelectorAll('[name="wfa-team-member"]').forEach((chk) => {
        chk.onchange = () => {
          state.team_members = Array.from(body.querySelectorAll('[name="wfa-team-member"]:checked')).map((el) => ({
            employee_id: el.value,
            name: el.dataset.name || '',
            department: el.dataset.dept || ''
          }));
        };
      });

      const applyPerson = (empId, name, dept) => {
        state.employee_id = String(empId || '').trim();
        state.full_name = String(name || '').trim();
        state.department = String(dept || '').trim();
        if ($('wfa-empid') && document.activeElement !== $('wfa-empid')) $('wfa-empid').value = state.employee_id;
        if ($('wfa-name') && document.activeElement !== $('wfa-name')) $('wfa-name').value = state.full_name;
        if ($('wfa-dept') && document.activeElement !== $('wfa-dept')) $('wfa-dept').value = state.department;
        if ($('wfa-pick-member')) {
          const matchOpt = [...$('wfa-pick-member').options].find((o) => o.value === state.employee_id);
          $('wfa-pick-member').value = matchOpt ? state.employee_id : '';
        }
      };

      if ($('wfa-pick-member')) {
        $('wfa-pick-member').onchange = () => {
          const empId = $('wfa-pick-member').value;
          const found = teamMembers.find((m) => m.employee_id === empId);
          if (found) {
            state.employee_id = found.employee_id;
            state.full_name = found.name;
            state.department = found.department;
            if ($('wfa-empid')) $('wfa-empid').value = state.employee_id;
            if ($('wfa-name')) $('wfa-name').value = state.full_name;
            if ($('wfa-dept')) $('wfa-dept').value = state.department;
          }
        };
      }

      if ($('wfa-empid')) {
        $('wfa-empid').oninput = () => {
          const val = $('wfa-empid').value.trim();
          state.employee_id = val;
          // 1. Check SMF team members immediately
          const hit = teamMembers.find((m) => m.employee_id === val);
          if (hit) {
            applyPerson(hit.employee_id, hit.name, hit.department);
            return;
          }
          // 2. Query employee master if 5+ chars typed
          clearTimeout(empLookupTimer);
          if (val.length >= 5) {
            empLookupTimer = setTimeout(async () => {
              try {
                const res = await a5Api('smf', `employees?year=${a5Year}&q=${encodeURIComponent(val)}`);
                const exact = (res.employees || []).find((p) => String(p.employeeId) === val);
                if (exact && $('wfa-empid')?.value.trim() === val) {
                  applyPerson(exact.employeeId, exact.name, exact.department);
                }
              } catch (_) {}
            }, 250);
          }
        };
      }

      if ($('wfa-name')) {
        $('wfa-name').oninput = () => {
          const val = $('wfa-name').value.trim();
          state.full_name = val;
          const hit = teamMembers.find((m) => m.name === val);
          if (hit) {
            state.employee_id = hit.employee_id;
            state.department = hit.department || state.department;
            if ($('wfa-empid')) $('wfa-empid').value = state.employee_id;
            if ($('wfa-dept')) $('wfa-dept').value = state.department;
            if ($('wfa-pick-member')) $('wfa-pick-member').value = hit.employee_id;
          }
        };
      }

      if ($('wfa-dept')) {
        $('wfa-dept').oninput = () => { state.department = $('wfa-dept').value.trim(); };
      }
    } else if (step === 2) {
      body.innerHTML = `
        <div class="wfa-step-section">
          <div class="wfa-sec-badge is-red">Section 02 · BEFORE</div>
          <h3 style="margin:4px 0">กระบวนการเดิมก่อนปรับปรุง (Current Process)</h3>
          
          <div class="field">
            <label class="required">ชื่อกระบวนการที่ต้องการปรับปรุง (Process Name)</label>
            <input id="wfa-proc-name" maxlength="200" value="${esc(state.process_name)}" placeholder="เช่น Paper Checklist, การบันทึกผลตรวจสอบชิ้นงาน">
          </div>
          <div class="field">
            <label class="required">อธิบายวิธีการทำงานปัจจุบัน</label>
            <textarea id="wfa-proc-desc" rows="2" placeholder="เช่น ต้องพิมพ์ใบตรวจสอบเครื่องจักรทุกวัน พนักงานเขียนข้อมูลและส่งให้หัวหน้าเซ็นอนุมัติ">${esc(state.current_description)}</textarea>
          </div>
          <div class="field">
            <label class="required">ปัญหาที่พบ / คำอธิบายใต้ภาพ Before (Current Problem)</label>
            <textarea id="wfa-proc-prob" rows="2" placeholder="เช่น กรอกกระดาษ ส่งเอกสาร และจัดเก็บแฟ้ม ใช้เวลานาน">${esc(state.current_problem)}</textarea>
          </div>
          <div class="field">
            <label>ความถี่ในการทำงาน</label>
            <select id="wfa-proc-freq">
              ${options(['ทุกวัน (Daily)', 'หลายครั้งต่อวัน', 'ทุกสัปดาห์ (Weekly)', 'ทุกเดือน (Monthly)', 'อื่นๆ'], state.frequency)}
            </select>
          </div>

          <div class="wfa-img-upload-sec">
            <div class="wfa-img-upload-head">
              <strong>แนบรูปภาพ Before (อัตราส่วน 16:9 เท่านั้น)</strong>
              <span class="sum-meta">JPG, PNG · ระบบครอปอัตราส่วน 16:9 อัตโนมัติ</span>
            </div>
            <div class="wfa-img-grid" id="wfa-before-imgs"></div>
            <div class="wfa-file-drop">
              <input type="file" id="wfa-file-before" accept="image/jpeg,image/png,image/jpg" multiple class="d-none">
              <button class="btn btn-secondary small" type="button" id="wfa-btn-pick-before">
                <span class="material-symbols-rounded">upload_file</span> เลือกรูป Before (16:9)
              </button>
            </div>
          </div>
        </div>
      `;
      $('wfa-proc-name').oninput = () => { state.process_name = $('wfa-proc-name').value.trim(); };
      $('wfa-proc-desc').oninput = () => { state.current_description = $('wfa-proc-desc').value.trim(); };
      $('wfa-proc-prob').oninput = () => { state.current_problem = $('wfa-proc-prob').value.trim(); };
      $('wfa-proc-freq').onchange = () => { state.frequency = $('wfa-proc-freq').value; };
      $('wfa-btn-pick-before').onclick = () => $('wfa-file-before').click();
      renderImageList('wfa-before-imgs', beforeImages, 'BEFORE');
      $('wfa-file-before').onchange = (e) => handleFileUpload(e, beforeImages, 'wfa-before-imgs', 'BEFORE');
    } else if (step === 3) {
      body.innerHTML = `
        <div class="wfa-step-section">
          <div class="wfa-sec-badge is-green">Section 03 · AFTER</div>
          <h3 style="margin:4px 0">แนวทางปรับปรุงและโซลูชัน (Proposed Solution)</h3>

          <div class="field">
            <label class="required">ชื่อแนวคิดหรือโครงการ (Project Name)</label>
            <input id="wfa-proj-name" maxlength="200" value="${esc(state.project_name)}" placeholder="เช่น Digital Maintenance Checklist">
          </div>
          <div class="field">
            <label class="required">แนวทางการปรับปรุง</label>
            <textarea id="wfa-proj-desc" rows="2" placeholder="เช่น ใช้ QR Code เปิด Web App กรอกข้อมูล ตรวจสอบ และจัดเก็บในฐานข้อมูลอัตโนมัติ">${esc(state.improvement_description)}</textarea>
          </div>
          <div class="field">
            <label>เครื่องมือ / เทคโนโลยีที่ต้องการใช้</label>
            <select id="wfa-proj-tech">
              ${options(techOptions, state.proposed_technology)}
            </select>
          </div>

          <div class="wfa-img-upload-sec">
            <div class="wfa-img-upload-head">
              <strong>แนบรูปภาพ After (อัตราส่วน 16:9 เท่านั้น)</strong>
              <span class="sum-meta">JPG, PNG · ระบบครอปอัตราส่วน 16:9 อัตโนมัติ</span>
            </div>
            <div class="wfa-img-grid" id="wfa-after-imgs"></div>
            <div class="wfa-file-drop">
              <input type="file" id="wfa-file-after" accept="image/jpeg,image/png,image/jpg" multiple class="d-none">
              <button class="btn btn-secondary small" type="button" id="wfa-btn-pick-after">
                <span class="material-symbols-rounded">add_photo_alternate</span> เลือกรูป After (16:9)
              </button>
            </div>
          </div>
        </div>
      `;
      $('wfa-proj-name').oninput = () => { state.project_name = $('wfa-proj-name').value.trim(); };
      $('wfa-proj-desc').oninput = () => { state.improvement_description = $('wfa-proj-desc').value.trim(); };
      $('wfa-proj-tech').onchange = () => { state.proposed_technology = $('wfa-proj-tech').value; };
      $('wfa-btn-pick-after').onclick = () => $('wfa-file-after').click();
      renderImageList('wfa-after-imgs', afterImages, 'AFTER');
      $('wfa-file-after').onchange = (e) => handleFileUpload(e, afterImages, 'wfa-after-imgs', 'AFTER');
    } else if (step === 4) {
      body.innerHTML = `
        <div class="wfa-step-section">
          <div class="wfa-sec-badge">Section 04</div>
          <h3 style="margin:4px 0">ประโยชน์ที่คาดว่าจะได้รับ (Improvement Benefits)</h3>
          <p class="sum-meta">เลือกประโยชน์ที่ได้รับ (เลือกได้หลายข้อ):</p>
          <div class="wfa-benefits-grid">
            ${WFA_BENEFITS.map((b) => {
              const checked = state.improvement_benefits.includes(b.label);
              return `
                <label class="wfa-benefit-card ${checked ? 'is-selected' : ''}">
                  <input type="checkbox" name="wfa-benefit" value="${esc(b.label)}" ${checked ? 'checked' : ''}>
                  <span class="material-symbols-rounded wfa-benefit-icon">${b.icon}</span>
                  <div>
                    <strong>${esc(b.label)}</strong>
                    <div class="sum-meta">${esc(b.th)}</div>
                  </div>
                </label>
              `;
            }).join('')}
          </div>
        </div>
      `;
      body.querySelectorAll('[name="wfa-benefit"]').forEach((chk) => {
        chk.onchange = () => {
          chk.closest('.wfa-benefit-card').classList.toggle('is-selected', chk.checked);
          state.improvement_benefits = Array.from(body.querySelectorAll('[name="wfa-benefit"]:checked')).map((n) => n.value);
        };
      });
    } else if (step === 5) {
      const tPct = wfaCalcReduction(state.time_before, state.time_after);
      const pPct = wfaCalcReduction(state.paper_before, state.paper_after);
      const sPct = wfaCalcReduction(state.steps_before, state.steps_after);

      body.innerHTML = `
        <div class="wfa-step-section">
          <div class="wfa-sec-badge">Section 05</div>
          <h3 style="margin:4px 0">ผลลัพธ์ที่คาดหวังและคำนวณผลประหยัด (Expected Results)</h3>
          <p class="sum-meta">ระบุตัวเลขเปรียบเทียบก่อน-หลัง ระบบจะคำนวณ % การประหยัดให้อัตโนมัติ</p>

          <div class="wfa-results-grid">
            <div class="wfa-metric-input-box">
              <h3><span class="material-symbols-rounded">timer</span> เวลาทำงาน (Working Time)</h3>
              <div class="wfa-pair">
                ${field('ก่อนปรับปรุง (นาที / ครั้ง)', `<input id="wfa-t-b" type="number" min="0" value="${state.time_before || ''}">`)}
                ${field('หลังปรับปรุง (นาที / ครั้ง)', `<input id="wfa-t-a" type="number" min="0" value="${state.time_after || ''}">`)}
              </div>
              <div class="wfa-calc-pill ${tPct != null && tPct > 0 ? 'is-good' : ''}">
                <span>ลดเวลาลง:</span>
                <strong id="wfa-t-pct">${tPct != null ? `${tPct}%` : 'N/A'}</strong>
              </div>
            </div>

            <div class="wfa-metric-input-box">
              <h3><span class="material-symbols-rounded">description</span> ใช้กระดาษ (Paper Usage)</h3>
              <div class="wfa-pair">
                ${field('ก่อนปรับปรุง (แผ่น / เดือน)', `<input id="wfa-p-b" type="number" min="0" value="${state.paper_before || ''}">`)}
                ${field('หลังปรับปรุง (แผ่น / เดือน)', `<input id="wfa-p-a" type="number" min="0" value="${state.paper_after || ''}">`)}
              </div>
              <div class="wfa-calc-pill ${pPct != null && pPct > 0 ? 'is-good' : ''}">
                <span>ลดกระดาษลง:</span>
                <strong id="wfa-p-pct">${pPct != null ? `${pPct}%` : 'N/A'}</strong>
              </div>
            </div>

            <div class="wfa-metric-input-box">
              <h3><span class="material-symbols-rounded">route</span> ขั้นตอนทำงาน (Process Steps)</h3>
              <div class="wfa-pair">
                ${field('ขั้นตอนเดิม', `<input id="wfa-s-b" type="number" min="0" value="${state.steps_before || ''}">`)}
                ${field('ขั้นตอนใหม่', `<input id="wfa-s-a" type="number" min="0" value="${state.steps_after || ''}">`)}
              </div>
              <div class="wfa-calc-pill ${sPct != null && sPct > 0 ? 'is-good' : ''}">
                <span>ลดขั้นตอนลง:</span>
                <strong id="wfa-s-pct">${sPct != null ? `${sPct}%` : 'N/A'}</strong>
              </div>
            </div>
          </div>
        </div>
      `;

      const syncCalc = () => {
        state.time_before = Number($('wfa-t-b').value) || 0;
        state.time_after = Number($('wfa-t-a').value) || 0;
        state.paper_before = Number($('wfa-p-b').value) || 0;
        state.paper_after = Number($('wfa-p-a').value) || 0;
        state.steps_before = Number($('wfa-s-b').value) || 0;
        state.steps_after = Number($('wfa-s-a').value) || 0;

        const tp = wfaCalcReduction(state.time_before, state.time_after);
        const pp = wfaCalcReduction(state.paper_before, state.paper_after);
        const sp = wfaCalcReduction(state.steps_before, state.steps_after);

        $('wfa-t-pct').textContent = tp != null ? `${tp}%` : 'N/A';
        $('wfa-p-pct').textContent = pp != null ? `${pp}%` : 'N/A';
        $('wfa-s-pct').textContent = sp != null ? `${sp}%` : 'N/A';

        $('wfa-t-pct').parentElement.classList.toggle('is-good', tp != null && tp > 0);
        $('wfa-p-pct').parentElement.classList.toggle('is-good', pp != null && pp > 0);
        $('wfa-s-pct').parentElement.classList.toggle('is-good', sp != null && sp > 0);
      };

      ['wfa-t-b', 'wfa-t-a', 'wfa-p-b', 'wfa-p-a', 'wfa-s-b', 'wfa-s-a'].forEach((id) => {
        $(id).oninput = syncCalc;
      });
    } else if (step === 6) {
      body.innerHTML = `
        <div class="wfa-step-section">
          <div class="wfa-sec-badge">Section 06</div>
          <h3 style="margin:4px 0">ข้อมูลการดำเนินการและสรุป (Implementation)</h3>

          <div class="field">
            <label>ระดับความยากในการพัฒนา</label>
            <div class="wfa-radio-group">
              ${['Easy', 'Medium', 'Hard'].map((d) => `
                <label class="wfa-radio-pill ${state.difficulty === d ? 'is-selected' : ''}">
                  <input type="radio" name="wfa-diff" value="${d}" ${state.difficulty === d ? 'checked' : ''}>
                  <span>${d === 'Easy' ? '🟢 ง่าย (Easy)' : d === 'Medium' ? '🟡 ปานกลาง (Medium)' : '🔴 ซับซ้อน (Hard)'}</span>
                </label>
              `).join('')}
            </div>
          </div>

          <div class="field">
            <label>งบประมาณโดยประมาณ</label>
            <div class="wfa-radio-group">
              ${['Free', 'Low', 'Medium', 'High'].map((b) => `
                <label class="wfa-radio-pill ${state.budget === b ? 'is-selected' : ''}">
                  <input type="radio" name="wfa-budget" value="${b}" ${state.budget === b ? 'checked' : ''}>
                  <span>${b === 'Free' ? '✨ ไม่มีค่าใช้จ่าย' : b === 'Low' ? 'งบประมาณต่ำ' : b === 'Medium' ? 'งบประมาณปานกลาง' : 'งบประมาณสูง'}</span>
                </label>
              `).join('')}
            </div>
          </div>

          <div class="field">
            <label>สถานะโครงการเริ่มต้น</label>
            <select id="wfa-init-status">
              ${options(['Idea', 'Prototype', 'Testing', 'Implemented'], state.project_status, (v) => WFA_STATUS_BADGES[v]?.label || v)}
            </select>
          </div>

          <div class="field">
            <label>หมายเหตุเพิ่มเติม (ถ้ามี)</label>
            <textarea id="wfa-remarks" rows="2" placeholder="ระบุผู้เกี่ยวข้องหรือข้อคิดเห็น">${esc(state.admin_note || '')}</textarea>
          </div>

          <div class="wfa-summary-box">
            <div class="wfa-sum-title">สรุปข้อมูลก่อนกดปุ่ม "บันทึก":</div>
            ${isTeam && state.team_name ? `<div class="wfa-sum-row"><span>ชื่อกลุ่ม:</span><b>${esc(state.team_name)}</b></div>` : ''}
            <div class="wfa-sum-row"><span>${isTeam ? 'ผู้ส่งหลัก / หัวหน้ากลุ่ม:' : 'ผู้ส่ง:'}</span><b>${esc(state.full_name || '-')} (${esc(state.department || '-')})</b></div>
            ${isTeam && state.team_members.length ? `<div class="wfa-sum-row"><span>สมาชิกในกลุ่ม:</span><b>${state.team_members.map((m) => esc(m.name || m.employee_id)).join(', ')}</b></div>` : ''}
            <div class="wfa-sum-row"><span>ชื่อโปรเจค (After):</span><b>${esc(state.project_name || '-')}</b></div>
            <div class="wfa-sum-row"><span>กระบวนการเดิม (Before):</span><b>${esc(state.process_name || '-')}</b></div>
            <div class="wfa-sum-row"><span>เทคโนโลยี:</span><b>${esc(state.proposed_technology)}</b></div>
            <div class="wfa-sum-row"><span>รูปภาพ (16:9):</span><b>Before ${beforeImages.length} รูป · After ${afterImages.length} รูป</b></div>
          </div>
        </div>
      `;

      body.querySelectorAll('[name="wfa-diff"]').forEach((node) => {
        node.onchange = () => {
          state.difficulty = node.value;
          body.querySelectorAll('[name="wfa-diff"]').forEach((n) => n.closest('.wfa-radio-pill').classList.toggle('is-selected', n.checked));
        };
      });
      body.querySelectorAll('[name="wfa-budget"]').forEach((node) => {
        node.onchange = () => {
          state.budget = node.value;
          body.querySelectorAll('[name="wfa-budget"]').forEach((n) => n.closest('.wfa-radio-pill').classList.toggle('is-selected', n.checked));
        };
      });
      if ($('wfa-init-status')) {
        $('wfa-init-status').onchange = () => { state.project_status = $('wfa-init-status').value; };
      }
      if ($('wfa-remarks')) {
        $('wfa-remarks').oninput = () => { state.admin_note = $('wfa-remarks').value.trim(); };
      }
    }
  }

  function renderImageList(containerId, list, type) {
    const wrap = $(containerId);
    if (!wrap) return;
    if (!list.length) {
      wrap.innerHTML = `<p class="sum-meta">ยังไม่มีรูปภาพแนบ (อัตราส่วน 16:9)</p>`;
      return;
    }
    wrap.innerHTML = list.map((img, idx) => `
      <div class="wfa-img-thumb-box">
        <div class="wfa-img-thumb" style="background-image:url('${img.image_url}')">
          <button class="wfa-img-del" type="button" data-del-img="${idx}" title="ลบรูป">×</button>
        </div>
        <input class="wfa-img-desc-input" value="${esc(img.image_description || '')}" placeholder="คำอธิบายใต้ภาพ ${type}" data-desc-img="${idx}">
      </div>
    `).join('');

    wrap.querySelectorAll('[data-del-img]').forEach((node) => {
      node.onclick = () => {
        list.splice(Number(node.dataset.delImg), 1);
        renderImageList(containerId, list, type);
      };
    });
    wrap.querySelectorAll('[data-desc-img]').forEach((node) => {
      node.oninput = () => {
        list[Number(node.dataset.descImg)].image_description = node.value.trim();
      };
    });
  }

  // Strictly 16:9 center-crop using cropJpeg(file, 960, 540)
  async function handleFileUpload(e, list, containerId, type) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const dataUrl = await cropJpeg(file, 960, 540);
        list.push({
          image_type: type,
          image_url: dataUrl,
          image_description: ''
        });
        renderImageList(containerId, list, type);
      } catch (err) {
        toast(err.message || 'เปิดรูปไม่ได้', 'error');
      }
    }
  }

  // Free navigation without blocking validation
  $('wfa-wiz-prev').onclick = () => {
    saveCurrentStep();
    if (step > 1) {
      step--;
      renderStep();
    }
  };

  $('wfa-wiz-next').onclick = () => {
    saveCurrentStep();
    if (step < 6) {
      step++;
      renderStep();
    }
  };

  document.querySelectorAll('[data-wfa-step]').forEach((node) => {
    node.onclick = () => {
      saveCurrentStep();
      step = Number(node.dataset.wfaStep) || 1;
      renderStep();
    };
  });

  renderStep();
}

// Modal Detail View with Image 2 Improvement Proposal Layout & Admin Evaluation
async function wfaOpenDetail(id, onRefresh) {
  let data;
  try {
    data = await api(`/api/workflow/ideas/${id}`);
  } catch (err) {
    toast(err.message, 'error');
    return;
  }

  const { idea, images, evaluations } = data;
  const fullIdea = { ...idea, images: images || [] };

  const html = `
    <div class="wfa-modal-detail">
      ${wfaProposalCardHtml(fullIdea, { showActions: false })}

      ${idea.can_evaluate ? `
        <div class="wfa-eval-box">
          <div class="wfa-eval-head">
            <span class="material-symbols-rounded">admin_panel_settings</span>
            <strong>ส่วนประเมินและอัปเดตสถานะโครงการ (Admin)</strong>
          </div>
          <div class="wfa-eval-form">
            <div class="field">
              <label>เปลี่ยนสถานะโครงการ</label>
              <select id="wfa-eval-status">
                ${options(['Idea', 'Prototype', 'Testing', 'Implemented'], idea.project_status, (v) => WFA_STATUS_BADGES[v]?.label || v)}
              </select>
            </div>
            <div class="field">
              <label>ข้อคิดเห็น / คำแนะนำจาก Admin</label>
              <textarea id="wfa-eval-note" rows="2" placeholder="ใส่ข้อเสนอแนะหรือผลการพิจารณา">${esc(idea.admin_note || '')}</textarea>
            </div>
          </div>

          ${evaluations.length ? `
            <div class="wfa-eval-history">
              <small class="sum-meta">ประวัติการประเมิน (${evaluations.length} ครั้ง):</small>
              <ul>
                ${evaluations.map((ev) => `
                  <li>
                    <span>${esc(ev.admin_id)} · สถานะ: <b>${esc(ev.evaluation_status)}</b></span>
                    <small>${ev.created_at ? new Date(ev.created_at).toLocaleString('th-TH') : ''}</small>
                    ${ev.evaluation_note ? `<p>${esc(ev.evaluation_note)}</p>` : ''}
                  </li>
                `).join('')}
              </ul>
            </div>
          ` : ''}
        </div>
      ` : ''}
    </div>
  `;

  if (idea.can_evaluate) {
    openPopup(`Improvement Proposal #${idea.id}`, html, async () => {
      const payload = {
        project_status: $('wfa-eval-status').value,
        admin_note: $('wfa-eval-note').value.trim()
      };
      await api(`/api/workflow/ideas/${idea.id}/evaluate`, { method: 'POST', body: payload });
      toast('บันทึกผลการประเมินเรียบร้อย');
      closePopup();
      if (onRefresh) onRefresh();
    }, 'บันทึกผลประเมิน');
  } else {
    openPopup(`Improvement Proposal #${idea.id}`, html, async () => { closePopup(); }, 'ปิด');
    if ($('popup-cancel')) $('popup-cancel').hidden = true;
  }

  const popupNode = $('popup');
  if (popupNode) {
    const p = popupNode.querySelector('.popup');
    if (p) {
      p.style.alignSelf = 'start';
      p.style.marginTop = 'max(16px, min(4vh, 28px))';
      p.style.width = 'min(760px, 95vw)';
      p.style.height = 'min(88vh, 740px)';
      p.style.maxHeight = 'min(92vh, 860px)';
    }
    wfaBindProposalThumbs(popupNode);
  }
}
