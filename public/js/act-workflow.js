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
            ผู้เสนอ: ${esc(item.full_name || '-')}${item.employee_id ? ` (${esc(item.employee_id)})` : ''} · แผนก: ${esc(item.department || '-')}${dateText ? ` · วันที่ส่ง: ${esc(dateText)}` : ''}
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

// SMF: Transaction - Work Flow Automation Project View
async function wfaRenderSmfTransaction(target, currentProj, actMe, rerender, pmData, byMonth, projTabs) {
  // Merge global logged-in user `me` (from core.js) with activity access `actMe`
  const userMe = { ...(typeof me === 'object' && me ? me : {}), ...(actMe || {}) };
  let ideas = [];
  let stats = {};
  let depts = [];
  let showMonthlyTable = false;
  let viewMode = 'proposal'; // 'proposal' (Image 2 style) or 'table'
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
    if (filter.q) qParams.set('q', filter.q);
    if (filter.department) qParams.set('department', filter.department);
    if (filter.status) qParams.set('status', filter.status);
    if (filter.myOnly) qParams.set('my', '1');

    const [iData, sData] = await Promise.all([
      api(`/api/workflow/ideas?${qParams.toString()}`).catch(() => ({ ideas: [] })),
      api('/api/workflow/stats').catch(() => ({}))
    ]);
    ideas = iData.ideas || [];
    stats = sData || {};
    depts = Object.keys(stats.byDepartment || {}).sort();
    render();
  };

  function render() {
    const canEdit = Boolean(userMe.access?.admin || userMe.access?.member || userMe.access?.smart);
    const targetCount = currentProj.target_count || 10;
    const implementedCount = stats.byStatus?.Implemented || 0;
    const totalSubmitted = ideas.length;

    // Monthly 12-month table rows HTML
    const lock = canEdit ? '' : 'disabled';
    const rowsHtml = Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      const item = byMonth[m] || {};
      return `<tr data-month="${m}">
        <td style="font-weight:600">${m}. ${ACT_MONTHS[i]}</td>
        <td><input class="input smf-input smf-target" type="number" step="any" value="${item.target ?? ''}" ${lock} placeholder="Target"></td>
        <td><input class="input smf-input smf-actual" type="number" step="any" value="${item.actual ?? ''}" ${lock} placeholder="Actual"></td>
        <td class="smf-diff-cell">-</td>
        <td class="smf-pct-cell">-</td>
        <td><input class="input smf-input smf-note" type="text" maxlength="300" value="${esc(item.note || '')}" ${lock} placeholder="หมายเหตุ..."></td>
      </tr>`;
    }).join('');

    const contentHtml = !ideas.length
      ? '<div class="card"><p class="empty">ยังไม่มีการส่งข้อมูลโปรเจค Work Flow Automation หรือไม่พบข้อมูลตามตัวกรอง · คลิก "+ ส่งข้อมูลโปรเจค" เพื่อส่งแนวคิดแรก</p></div>'
      : viewMode === 'proposal'
        ? `<div class="wfa-proposal-list">${ideas.map((item) => wfaProposalCardHtml(item, { showActions: true })).join('')}</div>`
        : `
          <div class="wfa-table-card card">
            <div class="wfa-table-head" style="display:flex;justify-content:space-between;align-items:center">
              <strong>รายการโปรเจค Work Flow Automation ที่สมาชิกส่ง (${ideas.length} เรื่อง)</strong>
              <span class="sum-meta">คลิกแถวเพื่อดูรายละเอียด Improvement Proposal หรือประเมินสถานะ</span>
            </div>
            <div class="table-wrap sheet">
              <table class="mo-data-table">
                <thead>
                  <tr>
                    <th style="width:50px">ลำดับ</th>
                    <th style="width:90px">วันที่ส่ง</th>
                    <th>โปรเจคที่ดำเนินการ (AFTER)</th>
                    <th>กระบวนการเดิม (BEFORE)</th>
                    <th>ผู้เสนอ / แผนก</th>
                    <th>เทคโนโลยี</th>
                    <th>ผลประหยัด</th>
                    <th>สถานะ</th>
                    <th style="width:80px">จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  ${ideas.map((item, idx) => {
                    const status = WFA_STATUS_BADGES[item.project_status] || WFA_STATUS_BADGES.Idea;
                    const tPct = item.time_saving_pct != null ? `${item.time_saving_pct}%` : null;
                    const pPct = item.paper_reduction_pct != null ? `${item.paper_reduction_pct}%` : null;
                    return `
                      <tr data-pick-id="${item.id}" style="cursor:pointer">
                        <td>${idx + 1}</td>
                        <td><small class="sum-meta">${item.created_at ? new Date(item.created_at).toLocaleDateString('th-TH') : ''}</small></td>
                        <td><div class="wfa-col-title"><strong>${esc(item.project_name)}</strong></div></td>
                        <td><span class="wfa-text-muted">${esc(item.process_name)}</span></td>
                        <td>
                          <div class="wfa-col-emp">
                            <span>${esc(item.full_name)}</span>
                            <small class="sum-meta">${esc(item.department || '-')}</small>
                          </div>
                        </td>
                        <td><span class="wfa-tech-badge">${esc(item.proposed_technology || '-')}</span></td>
                        <td>
                          <div class="wfa-col-savings">
                            ${tPct ? `<span class="wfa-saving-mini"><span class="material-symbols-rounded">timer</span>${tPct}</span>` : ''}
                            ${pPct ? `<span class="wfa-saving-mini is-paper"><span class="material-symbols-rounded">description</span>${pPct}</span>` : ''}
                            ${!tPct && !pPct ? '<span class="sum-meta">-</span>' : ''}
                          </div>
                        </td>
                        <td><span class="badge ${status.class}">${status.label}</span></td>
                        <td>
                          <div class="wfa-col-actions">
                            <button class="btn btn-secondary small" type="button" data-act-view="${item.id}" title="ดูรายละเอียด">
                              <span class="material-symbols-rounded">visibility</span>
                            </button>
                            ${item.can_edit ? `
                              <button class="btn btn-danger small" type="button" data-act-del="${item.id}" title="ลบ">
                                <span class="material-symbols-rounded">delete</span>
                              </button>
                            ` : ''}
                          </div>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `;

    target.innerHTML = `
      <div class="view-body"><section class="card">
        ${pageBar(a5Seg('data-smfproj', projTabs, currentProj.id), `<div class="a5-year">${a5YearSelect(userMe.years)}</div>`, 'smf')}
        <div id="smf-body" style="padding-top:12px;display:flex;flex-direction:column;gap:14px">
          
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
            <div>
              <h3 style="margin:0;font-size:1.2rem;display:flex;align-items:center;gap:8px">
                <span>${esc(currentProj.name)}</span>
                <span class="badge badge-success">เป้าหมาย ${targetCount} โครงการ</span>
              </h3>
              <p class="sum-meta" style="margin:4px 0 0">
                ระบบสมาชิกส่งข้อมูลโปรเจคที่ดำเนินการของ Work Flow Automation (Less Paper. Less Time. More Efficiency.)
              </p>
            </div>
            <div class="action-bar a5-actions" style="margin:0">
              <button class="btn btn-primary" type="button" id="wfa-btn-add">
                <span class="material-symbols-rounded">add_circle</span> ส่งข้อมูลโปรเจค (6 ขั้นตอน)
              </button>
              <button class="btn btn-secondary" type="button" id="wfa-btn-viewmode">
                <span class="material-symbols-rounded">${viewMode === 'proposal' ? 'table_rows' : 'view_agenda'}</span>
                ${viewMode === 'proposal' ? 'มุมมองตาราง' : 'มุมมอง Proposal'}
              </button>
              <button class="btn btn-secondary" type="button" id="wfa-btn-export">
                <span class="material-symbols-rounded">download</span> Export รายงาน (CSV)
              </button>
              <button class="btn btn-secondary" type="button" id="wfa-btn-toggle-month">
                <span class="material-symbols-rounded">calendar_month</span> ${showMonthlyTable ? 'ซ่อนตารางรายเดือน' : 'ตารางรายเดือน'}
              </button>
            </div>
          </div>

          <!-- Stats Strip -->
          <div class="wfa-stats-strip">
            <div class="wfa-stat-card">
              <span class="material-symbols-rounded wfa-stat-icon">flag</span>
              <div class="wfa-stat-info">
                <strong class="wfa-stat-num">${targetCount} โครงการ</strong>
                <span class="wfa-stat-text">เป้าหมายปี ${a5Year}</span>
              </div>
            </div>
            <div class="wfa-stat-card">
              <span class="material-symbols-rounded wfa-stat-icon">send</span>
              <div class="wfa-stat-info">
                <strong class="wfa-stat-num">${totalSubmitted} เรื่อง</strong>
                <span class="wfa-stat-text">สมาชิกส่งข้อมูลแล้ว</span>
              </div>
            </div>
            <div class="wfa-stat-card is-success">
              <span class="material-symbols-rounded wfa-stat-icon">task_alt</span>
              <div class="wfa-stat-info">
                <strong class="wfa-stat-num">${implementedCount} เรื่อง</strong>
                <span class="wfa-stat-text">ดำเนินการสำเร็จ (Implemented)</span>
              </div>
            </div>
            <div class="wfa-stat-card is-success">
              <span class="material-symbols-rounded wfa-stat-icon">timer</span>
              <div class="wfa-stat-info">
                <strong class="wfa-stat-num">${stats.avgTimeSaving || 0}%</strong>
                <span class="wfa-stat-text">ลดเวลาทำงานเฉลี่ย</span>
              </div>
            </div>
            <div class="wfa-stat-card is-success">
              <span class="material-symbols-rounded wfa-stat-icon">description</span>
              <div class="wfa-stat-info">
                <strong class="wfa-stat-num">${stats.avgPaperReduction || 0}%</strong>
                <span class="wfa-stat-text">ลดการใช้กระดาษเฉลี่ย</span>
              </div>
            </div>
          </div>

          <!-- Filter Bar -->
          <div class="card wfa-filter-bar">
            <div class="field" style="flex:2;min-width:200px">
              <input id="wfa-flt-q" placeholder="ค้นหาชื่อโปรเจค, ปัญหา, พนักงาน, แผนก" value="${esc(filter.q)}">
            </div>
            <div class="field" style="min-width:140px">
              <select id="wfa-flt-dept">
                <option value="">ทุกแผนก</option>
                ${options(depts, filter.department)}
              </select>
            </div>
            <div class="field" style="min-width:140px">
              <select id="wfa-flt-status">
                <option value="">ทุกสถานะ</option>
                ${options(['Idea', 'Prototype', 'Testing', 'Implemented'], filter.status, (v) => WFA_STATUS_BADGES[v]?.label || v)}
              </select>
            </div>
            <label class="wfa-check-label" style="align-self:center">
              <input type="checkbox" id="wfa-flt-my" ${filter.myOnly ? 'checked' : ''}> เฉพาะของฉัน
            </label>
          </div>

          <!-- Project Submissions (Proposal Cards or Table) -->
          ${contentHtml}

          <!-- Optional Collapsible 12-Month Target/Actual Table -->
          <div id="wfa-month-wrap" class="${showMonthlyTable ? '' : 'd-none'}" style="margin-top:10px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <strong>ตารางบันทึกเป้าหมายและผลงานรายเดือน (12 เดือน)</strong>
              ${canEdit ? `<div class="action-bar a5-actions" style="margin:0">
                ${button('smf-copy-target', 'คัดลอกเป้าเดือน 1 ไปทุกเดือน', 'secondary')}
                ${button('smf-save', 'บันทึกข้อมูลรายเดือน', 'primary')}
              </div>` : ''}
            </div>
            <div class="table-wrap sheet">
              <table class="mo-data-table smf-month-table">
                <thead><tr>
                  <th style="width:120px">เดือน</th>
                  <th style="width:140px">เป้าหมาย (โครงการ)</th>
                  <th style="width:140px">ผลงานจริง (โครงการ)</th>
                  <th style="width:110px">ผลต่าง</th>
                  <th style="width:130px">% บรรลุ</th>
                  <th>หมายเหตุ</th>
                </tr></thead>
                <tbody id="smf-rows">${rowsHtml}</tbody>
                <tfoot><tr id="smf-summary" style="background:var(--bg-subtle, #f8fafc);font-weight:600">
                  <td>เฉลี่ยทั้งปี</td>
                  <td id="smf-sum-target">-</td>
                  <td id="smf-sum-actual">-</td>
                  <td id="smf-sum-diff">-</td>
                  <td id="smf-sum-pct">-</td>
                  <td id="smf-sum-info" class="sum-meta"></td>
                </tr></tfoot>
              </table>
            </div>
          </div>

        </div>
      </section></div>
    `;

    bindTxEvents();
  }

  function bindTxEvents() {
    // Project tab switching
    target.querySelectorAll('[data-smfproj]').forEach((btn) => {
      btn.onclick = () => {
        smfPickedProj['smf'] = Number(btn.dataset.smfproj);
        rerender();
      };
    });

    if ($('a5-year')) {
      $('a5-year').onchange = () => {
        a5Year = Number($('a5-year').value);
        rerender();
      };
    }

    $('wfa-btn-add').onclick = () => wfaOpenSubmitWizard(userMe, loadData, teamMembers);
    $('wfa-btn-viewmode').onclick = () => {
      viewMode = viewMode === 'proposal' ? 'table' : 'proposal';
      render();
    };
    $('wfa-btn-export').onclick = () => window.open('/api/workflow/export', '_blank');
    $('wfa-btn-toggle-month').onclick = () => {
      showMonthlyTable = !showMonthlyTable;
      $('wfa-month-wrap').classList.toggle('d-none', !showMonthlyTable);
      $('wfa-btn-toggle-month').innerHTML = `<span class="material-symbols-rounded">calendar_month</span> ${showMonthlyTable ? 'ซ่อนตารางรายเดือน' : 'ตารางรายเดือน'}`;
    };

    $('wfa-flt-q').onchange = () => { filter.q = $('wfa-flt-q').value.trim(); loadData(); };
    $('wfa-flt-dept').onchange = () => { filter.department = $('wfa-flt-dept').value; loadData(); };
    $('wfa-flt-status').onchange = () => { filter.status = $('wfa-flt-status').value; loadData(); };
    $('wfa-flt-my').onchange = () => { filter.myOnly = $('wfa-flt-my').checked; loadData(); };

    wfaBindProposalThumbs(target);

    target.querySelectorAll('[data-act-view]').forEach((node) => {
      node.onclick = (e) => {
        e.stopPropagation();
        wfaOpenDetail(Number(node.dataset.actView), loadData);
      };
    });

    target.querySelectorAll('[data-act-del]').forEach((node) => {
      node.onclick = (e) => {
        e.stopPropagation();
        const id = Number(node.dataset.actDel);
        const item = ideas.find((i) => i.id === id);
        confirmPopup('ลบโครงการ', `ต้องการลบโครงการ "${esc(item?.project_name)}" หรือไม่?`, async () => {
          await api(`/api/workflow/ideas/${id}`, { method: 'DELETE' });
          toast('ลบเรียบร้อยแล้ว');
          loadData();
        });
      };
    });

    target.querySelectorAll('tr[data-pick-id]').forEach((node) => {
      node.onclick = () => wfaOpenDetail(Number(node.dataset.pickId), loadData);
    });

    // Monthly table calculations & save
    const numOf = (el) => (el.value !== '' && Number.isFinite(Number(el.value)) ? Number(el.value) : null);
    const recalc = () => {
      let tSum = 0, tCount = 0, aSum = 0, aCount = 0;
      target.querySelectorAll('#smf-rows tr').forEach((tr) => {
        const tVal = numOf(tr.querySelector('.smf-target'));
        const aVal = numOf(tr.querySelector('.smf-actual'));
        if (tVal != null) { tSum += tVal; tCount++; }
        if (aVal != null) { aSum += aVal; aCount++; }
        const [diffHtml, pctHtml] = smfDiffPct(tVal, aVal, true);
        tr.querySelector('.smf-diff-cell').innerHTML = diffHtml;
        tr.querySelector('.smf-pct-cell').innerHTML = pctHtml;
      });
      const tAvg = tCount > 0 ? tSum / tCount : null;
      const aAvg = aCount > 0 ? aSum / aCount : null;
      const [sumDiff, sumPct] = smfDiffPct(tAvg, aAvg, false);
      if ($('smf-sum-target')) $('smf-sum-target').textContent = tAvg != null ? tAvg.toFixed(2) : '-';
      if ($('smf-sum-actual')) $('smf-sum-actual').textContent = aAvg != null ? aAvg.toFixed(2) : '-';
      if ($('smf-sum-diff')) $('smf-sum-diff').innerHTML = sumDiff;
      if ($('smf-sum-pct')) $('smf-sum-pct').innerHTML = sumPct;
      if ($('smf-sum-info')) $('smf-sum-info').textContent = `บันทึกแล้ว ${aCount}/12 เดือน`;
    };

    target.querySelectorAll('.smf-target, .smf-actual').forEach((inp) => { inp.oninput = recalc; });
    recalc();

    if ($('smf-copy-target')) {
      $('smf-copy-target').onclick = () => {
        const first = target.querySelector('#smf-rows tr[data-month="1"] .smf-target');
        if (!first || first.value === '') { toast('กรอกเป้าหมายเดือน 1 ก่อน', 'error'); return; }
        target.querySelectorAll('#smf-rows .smf-target').forEach((inp) => { inp.value = first.value; });
        recalc();
        toast('คัดลอกเป้าหมายเดือน 1 ไปทุกเดือนแล้ว');
      };
    }

    if ($('smf-save')) {
      $('smf-save').onclick = async () => {
        const rows = [...target.querySelectorAll('#smf-rows tr')].map((tr) => ({
          month: Number(tr.dataset.month),
          target: numOf(tr.querySelector('.smf-target')),
          actual: numOf(tr.querySelector('.smf-actual')),
          note: tr.querySelector('.smf-note').value.trim()
        }));
        try {
          $('smf-save').disabled = true;
          await a5Api('smf', 'project-months', { method: 'PUT', body: { year: a5Year, projectId: currentProj.id, rows } });
          toast(`บันทึกข้อมูล ${currentProj.name} เรียบร้อย`);
          rerender();
        } catch (err) {
          onErr(err);
        } finally {
          if ($('smf-save')) $('smf-save').disabled = false;
        }
      };
    }
  }

  await loadData();
}

// 6-Step Submission Wizard in Modal Popup
function wfaOpenSubmitWizard(userMe, onSuccess, teamMembers = []) {
  let step = 1;
  const beforeImages = [];
  const afterImages = [];

  const myEmpId = String(userMe?.employeeId || '').trim();
  const matchedMember = teamMembers.find((m) => m.employee_id === myEmpId);

  const state = {
    employee_id: myEmpId,
    full_name: String(userMe?.name || matchedMember?.name || '').trim(),
    department: String(userMe?.department || matchedMember?.department || '').trim(),
    process_name: '',
    current_description: '',
    current_problem: '',
    frequency: 'ทุกวัน (Daily)',
    project_name: '',
    improvement_description: '',
    proposed_technology: WFA_TECH_OPTIONS[0],
    improvement_benefits: [],
    time_before: 0,
    time_after: 0,
    paper_before: 0,
    paper_after: 0,
    steps_before: 0,
    steps_after: 0,
    difficulty: 'Medium',
    budget: 'Free',
    project_status: 'Idea',
    admin_note: ''
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

    if (!state.full_name) {
      step = 1;
      renderStep();
      $('wfa-name')?.focus();
      throw new Error('กรุณาระบุชื่อ-นามสกุลผู้ส่ง (ขั้นตอนที่ 1)');
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

    await api('/api/workflow/ideas', { method: 'POST', body: payload });
    toast('บันทึกข้อมูลโปรเจค Work Flow Automation สำเร็จแล้ว');
    closePopup();
    if (onSuccess) onSuccess();
  }

  openPopup('ส่งข้อมูลโปรเจค Work Flow Automation', modalHtml, handleFinalSave, 'บันทึก');

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

      body.innerHTML = `
        <div class="wfa-step-section">
          <div class="wfa-sec-badge">Section 01</div>
          <h3 style="margin:4px 0">ข้อมูลสมาชิกผู้ส่ง (Member Information)</h3>
          ${memberOptions ? `
          <div class="field" style="margin-bottom:12px">
            <label>เลือกสมาชิกในทีม SMF (เชื่อมโยงรหัส ชื่อ และแผนกอัตโนมัติ)</label>
            <select id="wfa-pick-member">
              <option value="">-- เลือกสมาชิกในทีม หรือกรอกเองด้านล่าง --</option>
              ${memberOptions}
            </select>
          </div>` : ''}
          <div class="wfa-form-grid">
            ${field('รหัสพนักงาน', `<input id="wfa-empid" value="${esc(state.employee_id)}" placeholder="เช่น 2101999" autocomplete="off">`)}
            ${field('ชื่อ-นามสกุล *', `<input id="wfa-name" value="${esc(state.full_name)}" placeholder="เช่น นางสาว อัจฉรา โสกาบุญ" autocomplete="off">`)}
            ${field('แผนก / หน่วยงาน', `<input id="wfa-dept" value="${esc(state.department)}" placeholder="เช่น PLN & STO" autocomplete="off">`)}
            ${field('วันที่ส่ง', `<input value="${new Date().toLocaleDateString('th-TH')}" readonly class="is-locked">`)}
          </div>
        </div>
      `;

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
              ${options(WFA_TECH_OPTIONS, state.proposed_technology)}
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
            <div class="wfa-sum-row"><span>ผู้ส่ง:</span><b>${esc(state.full_name || '-')} (${esc(state.department || '-')})</b></div>
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

  // Strictly 16:9 center-crop using cropJpeg(file, 1280, 720)
  async function handleFileUpload(e, list, containerId, type) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const dataUrl = await cropJpeg(file, 1280, 720);
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
  if (popupNode) wfaBindProposalThumbs(popupNode);
}
