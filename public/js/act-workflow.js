// Work Flow Automation Module (Industrial Digital Transformation)
// Tagline: Less Paper. Less Time. More Efficiency.

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
  { id: 'paper', label: 'Reduce Paper (ลดการใช้กระดาษ)', icon: 'description' },
  { id: 'time', label: 'Reduce Working Time (ลดเวลาการทำงาน)', icon: 'timer' },
  { id: 'steps', label: 'Reduce Process Steps (ลดขั้นตอนการทำงาน)', icon: 'route' },
  { id: 'manpower', label: 'Reduce Manpower (ลดกำลังคน)', icon: 'groups' },
  { id: 'error', label: 'Reduce Human Error (ลดความผิดพลาด)', icon: 'rule' },
  { id: 'waiting', label: 'Reduce Waiting Time (ลดเวลารอคอย)', icon: 'hourglass_empty' },
  { id: 'access', label: 'Improve Data Accessibility (เข้าถึงข้อมูลง่ายขึ้น)', icon: 'database' },
  { id: 'tracking', label: 'Improve Tracking & Monitoring (ติดตามสถานะได้แม่นยำ)', icon: 'monitoring' }
];

const WFA_STATUS_BADGES = {
  Idea: { label: 'Idea (แนวคิด)', class: 'badge-warning', color: '#f59e0b' },
  Prototype: { label: 'Prototype (ต้นแบบ)', class: 'badge-primary', color: '#3b82f6' },
  Testing: { label: 'Testing (ทดสอบ)', class: 'badge-primary', color: '#8b5cf6' },
  Implemented: { label: 'Implemented (ใช้งานจริง)', class: 'badge-success', color: '#10b981' }
};

function wfaCalcReduction(before, after) {
  const b = Number(before);
  const a = Number(after);
  if (!Number.isFinite(b) || b <= 0) return null;
  if (!Number.isFinite(a) || a < 0) return 0;
  return Math.round(((b - a) / b) * 1000) / 10;
}

// 1. Home / Landing Page
async function wfaHome(target) {
  let stats = { totalProjects: 0, totalDepartments: 0, avgPaperReduction: 0, avgTimeSaving: 0 };
  let recent = [];
  try {
    const [sData, iData] = await Promise.all([
      api('/api/workflow/stats').catch(() => stats),
      api('/api/workflow/ideas').catch(() => ({ ideas: [] }))
    ]);
    stats = sData || stats;
    recent = (iData.ideas || []).slice(0, 4);
  } catch (err) {
    // continue with defaults
  }

  target.innerHTML = `
    <div class="view-body wfa-page">
      <div class="wfa-hero">
        <div class="wfa-hero-content">
          <div class="wfa-hero-badge"><span class="material-symbols-rounded">bolt</span> INDUSTRIAL DIGITAL TRANSFORMATION</div>
          <h1 class="wfa-hero-title">WORK FLOW AUTOMATION</h1>
          <p class="wfa-hero-tagline">Less Paper. Less Time. More Efficiency.</p>
          <p class="wfa-hero-desc">เปลี่ยนกระบวนการทำงานแบบ Manual และ Paper-based ให้เป็น Digital Workflow & Automation เพื่อความแม่นยำ รวดเร็ว และลดความสูญเปล่าในโรงงาน</p>
          <div class="wfa-hero-actions">
            <button class="btn btn-primary btn-lg" type="button" id="wfa-btn-submit">
              <span class="material-symbols-rounded">add_circle</span> ส่งแนวคิดปรับปรุง Workflow
            </button>
            <button class="btn btn-secondary btn-lg" type="button" id="wfa-btn-dashboard">
              <span class="material-symbols-rounded">dashboard</span> ดูโครงการและสถิติ
            </button>
          </div>
        </div>
      </div>

      <div class="wfa-stats-strip">
        <div class="wfa-stat-card">
          <span class="material-symbols-rounded wfa-stat-icon">lightbulb</span>
          <div class="wfa-stat-info">
            <strong class="wfa-stat-num">${stats.totalProjects || 0}</strong>
            <span class="wfa-stat-text">โครงการที่ส่งแนวคิด</span>
          </div>
        </div>
        <div class="wfa-stat-card">
          <span class="material-symbols-rounded wfa-stat-icon">domain</span>
          <div class="wfa-stat-info">
            <strong class="wfa-stat-num">${stats.totalDepartments || 0}</strong>
            <span class="wfa-stat-text">แผนกที่เข้าร่วม</span>
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

      <div class="wfa-sec">
        <div class="wfa-sec-head">
          <h2>เป้าหมายหลักในการปรับปรุง 6 ด้าน</h2>
          <span class="sum-meta">ขับเคลื่อน Smart Factory สู่กระบวนการทำงานดิจิทัล</span>
        </div>
        <div class="wfa-goals-grid">
          <div class="wfa-goal-box">
            <div class="wfa-goal-icon is-green"><span class="material-symbols-rounded">description</span></div>
            <strong>ลดการใช้กระดาษ</strong>
            <p>Paper Reduction เปลี่ยนเอกสารสู่ Digital Form & Approval</p>
          </div>
          <div class="wfa-goal-box">
            <div class="wfa-goal-icon is-blue"><span class="material-symbols-rounded">schedule</span></div>
            <strong>ลดเวลาการทำงาน</strong>
            <p>Time Reduction ลดเวลากรอกข้อมูลและรอคอย</p>
          </div>
          <div class="wfa-goal-box">
            <div class="wfa-goal-icon is-purple"><span class="material-symbols-rounded">alt_route</span></div>
            <strong>ลดขั้นตอนการทำงาน</strong>
            <p>Process Simplification ยุบรวมขั้นตอนซ้ำซ้อนให้กระชับ</p>
          </div>
          <div class="wfa-goal-box">
            <div class="wfa-goal-icon is-amber"><span class="material-symbols-rounded">sync_problem</span></div>
            <strong>ลดงานซ้ำซ้อน</strong>
            <p>Reduce Duplicate บันทึกครั้งเดียว เชื่อมโยงทุกระบบ</p>
          </div>
          <div class="wfa-goal-box">
            <div class="wfa-goal-icon is-red"><span class="material-symbols-rounded">check_circle</span></div>
            <strong>ลดความผิดพลาด</strong>
            <p>Error Reduction ป้องกันความผิดพลาดจากการทำงานแบบ Manual</p>
          </div>
          <div class="wfa-goal-box">
            <div class="wfa-goal-icon is-teal"><span class="material-symbols-rounded">visibility</span></div>
            <strong>เพิ่มประสิทธิภาพติดตามข้อมูล</strong>
            <p>Data Visibility รายงานสถานะและแดชบอร์ดแบบ Real-time</p>
          </div>
        </div>
      </div>

      ${recent.length ? `
        <div class="wfa-sec">
          <div class="wfa-sec-head">
            <h2>โครงการที่ส่งล่าสุด</h2>
            <button class="btn btn-secondary small" type="button" id="wfa-btn-view-all">ดูทั้งหมด</button>
          </div>
          <div class="wfa-recent-grid">
            ${recent.map((item) => {
              const status = WFA_STATUS_BADGES[item.project_status] || WFA_STATUS_BADGES.Idea;
              const tPct = item.time_saving_pct != null ? `${item.time_saving_pct}%` : null;
              const pPct = item.paper_reduction_pct != null ? `${item.paper_reduction_pct}%` : null;
              return `
                <div class="wfa-card" data-pick-id="${item.id}">
                  <div class="wfa-card-head">
                    <span class="badge ${status.class}">${status.label}</span>
                    <span class="sum-meta">${esc(item.department || '-')}</span>
                  </div>
                  <strong class="wfa-card-title">${esc(item.project_name)}</strong>
                  <p class="wfa-card-sub"><span class="wfa-tag-before">Before</span> ${esc(item.process_name)}</p>
                  <div class="wfa-card-savings">
                    ${tPct ? `<span class="wfa-saving-chip"><span class="material-symbols-rounded">timer</span> ประหยัดเวลา ${tPct}</span>` : ''}
                    ${pPct ? `<span class="wfa-saving-chip is-paper"><span class="material-symbols-rounded">description</span> ลดกระดาษ ${pPct}</span>` : ''}
                  </div>
                  <div class="wfa-card-footer">
                    <span>${esc(item.full_name)}</span>
                    <span class="sum-meta">${item.created_at ? new Date(item.created_at).toLocaleDateString('th-TH') : ''}</span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;

  $('wfa-btn-submit').onclick = () => openView('workflow-submit');
  $('wfa-btn-dashboard').onclick = () => openView('workflow-dashboard');
  if ($('wfa-btn-view-all')) $('wfa-btn-view-all').onclick = () => openView('workflow-dashboard');

  target.querySelectorAll('[data-pick-id]').forEach((node) => {
    node.onclick = () => wfaOpenDetail(Number(node.dataset.pickId));
  });
}

// 2. 6-Step Submission Form Wizard
async function wfaSubmit(target) {
  let me;
  try {
    me = await api('/api/me');
  } catch (err) {
    target.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
    return;
  }

  let step = 1;
  const beforeImages = [];
  const afterImages = [];

  const state = {
    employee_id: me.employeeId || '',
    full_name: me.name || '',
    department: me.department || '',
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
    project_status: 'Idea'
  };

  function renderWizard() {
    target.innerHTML = `
      <div class="view-body wfa-form-page">
        <div class="wfa-wizard-head">
          <div>
            <button class="btn btn-secondary small" type="button" id="wfa-back-home">
              <span class="material-symbols-rounded">arrow_back</span> กลับหน้าหลัก
            </button>
            <h1 class="wfa-wizard-title">ส่งแนวคิดปรับปรุง Work Flow Automation</h1>
            <p class="sum-meta">กรอกข้อมูล 6 ขั้นตอนเพื่อเสนอโครงการเปลี่ยนผ่านสู่ดิจิทัลและลดความสูญเปล่า</p>
          </div>
          <div class="wfa-step-counter">ขั้นตอนที่ <b>${step}</b> จาก 6</div>
        </div>

        <div class="wfa-stepper">
          ${[
            ['1', 'ข้อมูลผู้ส่ง', 'person'],
            ['2', 'ก่อนปรับปรุง (BEFORE)', 'history'],
            ['3', 'แนวทางแก้ (AFTER)', 'lightbulb'],
            ['4', 'ประโยชน์', 'verified'],
            ['5', 'ผลลัพธ์ที่คาดหวัง', 'calculate'],
            ['6', 'การดำเนินการ', 'rocket_launch']
          ].map(([sNum, sLabel, sIcon], idx) => {
            const num = idx + 1;
            const cls = num === step ? 'is-current' : num < step ? 'is-done' : '';
            return `
              <div class="wfa-step-item ${cls}">
                <div class="wfa-step-circle">
                  ${num < step ? '<span class="material-symbols-rounded">check</span>' : `<span class="material-symbols-rounded">${sIcon}</span>`}
                </div>
                <div class="wfa-step-lbl">${sLabel}</div>
              </div>
            `;
          }).join('')}
        </div>

        <div class="card wfa-step-card" id="wfa-step-content"></div>

        <div class="wfa-wizard-nav">
          <button class="btn btn-secondary btn-lg" type="button" id="wfa-nav-prev" ${step === 1 ? 'disabled' : ''}>
            <span class="material-symbols-rounded">chevron_left</span> ย้อนกลับ
          </button>
          <div class="wfa-nav-spacer"></div>
          ${step < 6 ? `
            <button class="btn btn-primary btn-lg" type="button" id="wfa-nav-next">
              ถัดไป <span class="material-symbols-rounded">chevron_right</span>
            </button>
          ` : `
            <button class="btn btn-primary btn-lg wfa-btn-save" type="button" id="wfa-nav-submit">
              <span class="material-symbols-rounded">send</span> ยืนยันและส่งแนวคิด
            </button>
          `}
        </div>
      </div>
    `;

    renderStepBody();
    bindEvents();
  }

  function renderStepBody() {
    const body = $('wfa-step-content');
    if (step === 1) {
      body.innerHTML = `
        <div class="wfa-step-section">
          <div class="wfa-sec-badge">Section 01</div>
          <h2>ข้อมูลสมาชิกผู้ส่งแนวคิด (Member Information)</h2>
          <p class="sum-meta">ระบบดึงข้อมูลจากบัญชีที่เข้าสู่ระบบปัจจุบันให้อัตโนมัติ</p>

          <div class="wfa-form-grid">
            ${field('รหัสพนักงาน (Employee ID)', `<input id="wfa-empid" value="${esc(state.employee_id)}" readonly class="is-locked">`)}
            ${field('ชื่อ-นามสกุล (Full Name)', `<input id="wfa-name" value="${esc(state.full_name)}" readonly class="is-locked">`)}
            ${field('หน่วยงาน / แผนก (Department)', `<input id="wfa-dept" value="${esc(state.department)}" readonly class="is-locked">`)}
            ${field('วันที่ส่งแนวคิด (Submission Date)', `<input value="${new Date().toLocaleDateString('th-TH')}" readonly class="is-locked">`)}
          </div>
        </div>
      `;
    } else if (step === 2) {
      body.innerHTML = `
        <div class="wfa-step-section">
          <div class="wfa-sec-badge is-red">Section 02 · BEFORE</div>
          <h2>กระบวนการทำงานปัจจุบัน (Current Process)</h2>
          <p class="sum-meta">ระบุขั้นตอนที่เป็นเอกสารกระดาษ หรือปัญหาความล่าช้า/ผิดพลาดในปัจจุบัน</p>

          <div class="field">
            <label class="required">ชื่อกระบวนการที่ต้องการปรับปรุง (Process Name)</label>
            <input id="wfa-proc-name" maxlength="200" value="${esc(state.process_name)}" placeholder="เช่น การบันทึกผลตรวจสอบชิ้นงานประจำกะ, ใบเบิกเครื่องมือ">
          </div>

          <div class="field">
            <label class="required">อธิบายวิธีการทำงานปัจจุบัน (Current Process Description)</label>
            <textarea id="wfa-proc-desc" rows="3" placeholder="อธิบายขั้นตอนการทำงานตั้งแต่เริ่มต้นจนเสร็จสิ้น">${esc(state.current_description)}</textarea>
          </div>

          <div class="field">
            <label class="required">ปัญหาที่พบ (Current Problem)</label>
            <textarea id="wfa-proc-prob" rows="3" placeholder="เช่น ใช้เวลากรอกกระดาษนาน, ข้อมูลหาย, คีย์ซ้ำซ้อนในระบบ">${esc(state.current_problem)}</textarea>
          </div>

          <div class="field">
            <label>ความถี่ในการทำงาน (Frequency)</label>
            <select id="wfa-proc-freq">
              ${options(['ทุกวัน (Daily)', 'หลายครั้งต่อวัน', 'ทุกสัปดาห์ (Weekly)', 'ทุกเดือน (Monthly)', 'อื่นๆ'], state.frequency)}
            </select>
          </div>

          <div class="wfa-img-upload-sec">
            <div class="wfa-img-upload-head">
              <strong>แนบรูปภาพกระบวนการเดิม (Before Photos)</strong>
              <span class="sum-meta">รองรับ JPG, PNG (เอกสารกระดาษ, สภาพปัญหา, แผนผัง)</span>
            </div>
            <div class="wfa-img-grid" id="wfa-before-imgs"></div>
            <div class="wfa-file-drop">
              <input type="file" id="wfa-file-before" accept="image/jpeg,image/png,image/jpg" multiple class="d-none">
              <button class="btn btn-secondary" type="button" onclick="$('wfa-file-before').click()">
                <span class="material-symbols-rounded">upload_file</span> เลือกไฟล์รูปภาพ Before
              </button>
            </div>
          </div>
        </div>
      `;
      renderImageList('wfa-before-imgs', beforeImages, 'BEFORE');
    } else if (step === 3) {
      body.innerHTML = `
        <div class="wfa-step-section">
          <div class="wfa-sec-badge is-green">Section 03 · AFTER</div>
          <h2>แนวทางการปรับปรุงและดิจิทัลเวิร์กโฟลว์ (Proposed Solution)</h2>
          <p class="sum-meta">แนวคิดการพัฒนาระบบหรือเครื่องมือเพื่อแก้ไขปัญหา</p>

          <div class="field">
            <label class="required">ชื่อแนวคิดหรือโครงการ (Project Name)</label>
            <input id="wfa-proj-name" maxlength="200" value="${esc(state.project_name)}" placeholder="เช่น Digital QC Inspection Sheet, Smart Tool Borrowing App">
          </div>

          <div class="field">
            <label class="required">แนวทางการปรับปรุง (Improvement Description)</label>
            <textarea id="wfa-proj-desc" rows="3" placeholder="อธิบายว่าจะนำระบบใดมาใช้ แทนที่กระบวนการเดิมอย่างไร">${esc(state.improvement_description)}</textarea>
          </div>

          <div class="field">
            <label>เครื่องมือ / เทคโนโลยีที่ต้องการใช้ (Proposed Technology)</label>
            <select id="wfa-proj-tech">
              ${options(WFA_TECH_OPTIONS, state.proposed_technology)}
            </select>
          </div>

          <div class="wfa-img-upload-sec">
            <div class="wfa-img-upload-head">
              <strong>แนบรูปภาพแนวคิด / ภาพจำลอง (After / Concept Photos)</strong>
              <span class="sum-meta">รองรับ Flowchart, UI Mockup, หน้าจอระบบที่ต้องการ</span>
            </div>
            <div class="wfa-img-grid" id="wfa-after-imgs"></div>
            <div class="wfa-file-drop">
              <input type="file" id="wfa-file-after" accept="image/jpeg,image/png,image/jpg" multiple class="d-none">
              <button class="btn btn-secondary" type="button" onclick="$('wfa-file-after').click()">
                <span class="material-symbols-rounded">add_photo_alternate</span> เลือกไฟล์รูปภาพ After
              </button>
            </div>
          </div>
        </div>
      `;
      renderImageList('wfa-after-imgs', afterImages, 'AFTER');
    } else if (step === 4) {
      body.innerHTML = `
        <div class="wfa-step-section">
          <div class="wfa-sec-badge">Section 04</div>
          <h2>ประโยชน์ที่คาดว่าจะได้รับ (Improvement Benefits)</h2>
          <p class="sum-meta">เลือกประโยชน์ที่คาดว่าจะได้รับจากโครงการนี้ (เลือกได้หลายข้อ)</p>

          <div class="wfa-benefits-grid">
            ${WFA_BENEFITS.map((b) => {
              const checked = state.improvement_benefits.includes(b.label);
              return `
                <label class="wfa-benefit-card ${checked ? 'is-selected' : ''}">
                  <input type="checkbox" name="wfa-benefit" value="${esc(b.label)}" ${checked ? 'checked' : ''}>
                  <span class="material-symbols-rounded wfa-benefit-icon">${b.icon}</span>
                  <strong>${esc(b.label)}</strong>
                </label>
              `;
            }).join('')}
          </div>
        </div>
      `;
    } else if (step === 5) {
      const tPct = wfaCalcReduction(state.time_before, state.time_after);
      const pPct = wfaCalcReduction(state.paper_before, state.paper_after);
      const sPct = wfaCalcReduction(state.steps_before, state.steps_after);

      body.innerHTML = `
        <div class="wfa-step-section">
          <div class="wfa-sec-badge">Section 05</div>
          <h2>ผลลัพธ์ที่คาดหวังและคำนวณผลประหยัด (Expected Results)</h2>
          <p class="sum-meta">ระบุตัวเลขเปรียบเทียบก่อน-หลัง ระบบจะคำนวณผลการประหยัดให้อัตโนมัติ</p>

          <div class="wfa-results-grid">
            <div class="wfa-metric-input-box">
              <h3><span class="material-symbols-rounded">timer</span> เวลาการทำงาน (Working Time)</h3>
              <div class="wfa-pair">
                ${field('ก่อนปรับปรุง (นาที / ครั้ง)', `<input id="wfa-t-b" type="number" min="0" step="1" value="${state.time_before || ''}">`)}
                ${field('หลังปรับปรุง (นาที / ครั้ง)', `<input id="wfa-t-a" type="number" min="0" step="1" value="${state.time_after || ''}">`)}
              </div>
              <div class="wfa-calc-pill ${tPct != null && tPct > 0 ? 'is-good' : ''}">
                <span>ลดเวลาลง:</span>
                <strong id="wfa-t-pct">${tPct != null ? `${tPct}%` : 'N/A'}</strong>
              </div>
            </div>

            <div class="wfa-metric-input-box">
              <h3><span class="material-symbols-rounded">description</span> การใช้กระดาษ (Paper Usage)</h3>
              <div class="wfa-pair">
                ${field('ก่อนปรับปรุง (แผ่น / เดือน)', `<input id="wfa-p-b" type="number" min="0" step="1" value="${state.paper_before || ''}">`)}
                ${field('หลังปรับปรุง (แผ่น / เดือน)', `<input id="wfa-p-a" type="number" min="0" step="1" value="${state.paper_after || ''}">`)}
              </div>
              <div class="wfa-calc-pill ${pPct != null && pPct > 0 ? 'is-good' : ''}">
                <span>ลดกระดาษลง:</span>
                <strong id="wfa-p-pct">${pPct != null ? `${pPct}%` : 'N/A'}</strong>
              </div>
            </div>

            <div class="wfa-metric-input-box">
              <h3><span class="material-symbols-rounded">route</span> ขั้นตอนการทำงาน (Process Steps)</h3>
              <div class="wfa-pair">
                ${field('ขั้นตอนเดิม (จำนวนขั้นตอน)', `<input id="wfa-s-b" type="number" min="0" step="1" value="${state.steps_before || ''}">`)}
                ${field('ขั้นตอนใหม่ (จำนวนขั้นตอน)', `<input id="wfa-s-a" type="number" min="0" step="1" value="${state.steps_after || ''}">`)}
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
          <h2>ข้อมูลการดำเนินการและสรุป (Implementation)</h2>
          <p class="sum-meta">ประเมินความยาก งบประมาณ และตรวจสอบความพร้อมก่อนส่ง</p>

          <div class="field">
            <label>ระดับความยากในการพัฒนา (Implementation Difficulty)</label>
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
            <label>งบประมาณโดยประมาณ (Estimated Budget)</label>
            <div class="wfa-radio-group">
              ${['Free', 'Low', 'Medium', 'High'].map((b) => `
                <label class="wfa-radio-pill ${state.budget === b ? 'is-selected' : ''}">
                  <input type="radio" name="wfa-budget" value="${b}" ${state.budget === b ? 'checked' : ''}>
                  <span>${b === 'Free' ? '✨ ไม่มีค่าใช้จ่าย (Free)' : b === 'Low' ? 'งบประมาณต่ำ (Low)' : b === 'Medium' ? 'งบประมาณปานกลาง (Medium)' : 'งบประมาณสูง (High)'}</span>
                </label>
              `).join('')}
            </div>
          </div>

          <div class="field">
            <label>หมายเหตุเพิ่มเติม (Additional Remarks - ถ้ามี)</label>
            <textarea id="wfa-remarks" rows="3" placeholder="ระบุผู้เกี่ยวข้อง, อุปกรณ์ที่ต้องใช้, หรือข้อเสนอแนะเพิ่มเติม">${esc(state.admin_note || '')}</textarea>
          </div>

          <div class="wfa-summary-box">
            <div class="wfa-sum-title">สรุปข้อมูลแนวคิด</div>
            <div class="wfa-sum-row"><span>โครงการ:</span><b>${esc(state.project_name || '-')}</b></div>
            <div class="wfa-sum-row"><span>กระบวนการเดิม:</span><b>${esc(state.process_name || '-')}</b></div>
            <div class="wfa-sum-row"><span>เทคโนโลยี:</span><b>${esc(state.proposed_technology)}</b></div>
            <div class="wfa-sum-row"><span>รูปภาพแนบ:</span><b>Before ${beforeImages.length} รูป · After ${afterImages.length} รูป</b></div>
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
    }
  }

  function renderImageList(containerId, list, type) {
    const wrap = $(containerId);
    if (!wrap) return;
    if (!list.length) {
      wrap.innerHTML = `<p class="sum-meta">ยังไม่มีรูปภาพแนบ</p>`;
      return;
    }
    wrap.innerHTML = list.map((img, idx) => `
      <div class="wfa-img-thumb-box">
        <div class="wfa-img-thumb" style="background-image:url('${img.image_url}')">
          <button class="wfa-img-del" type="button" data-del-img="${idx}">×</button>
        </div>
        <input class="wfa-img-desc-input" value="${esc(img.image_description || '')}" placeholder="คำอธิบายรูป" data-desc-img="${idx}">
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

  function bindEvents() {
    $('wfa-back-home').onclick = () => openView('workflow');
    $('wfa-nav-prev').onclick = () => {
      saveCurrentStep();
      if (step > 1) {
        step--;
        renderWizard();
      }
    };

    if ($('wfa-nav-next')) {
      $('wfa-nav-next').onclick = () => {
        if (!validateCurrentStep()) return;
        saveCurrentStep();
        if (step < 6) {
          step++;
          renderWizard();
        }
      };
    }

    if ($('wfa-nav-submit')) {
      $('wfa-nav-submit').onclick = async () => {
        saveCurrentStep();
        try {
          $('wfa-nav-submit').disabled = true;
          $('wfa-nav-submit').innerHTML = `<span class="material-symbols-rounded">sync</span> กำลังบันทึก...`;

          const payload = {
            ...state,
            images: [...beforeImages, ...afterImages]
          };

          const res = await api('/api/workflow/ideas', { method: 'POST', body: payload });
          toast('บันทึกแนวคิดสำเร็จเรียบร้อย!');

          confirmPopup(
            'ส่งแนวคิดเรียบร้อย!',
            `แนวคิด "${esc(state.project_name)}" ได้รับการบันทึกแล้ว คุณสามารถดูสถานะและรายละเอียดโครงการได้ที่หน้า Dashboard`,
            () => openView('workflow-dashboard'),
            { confirmLabel: 'ดูแดชบอร์ดโครงการ', cancelLabel: 'ส่งอีกแนวคิด' }
          );
        } catch (err) {
          toast(err.message, 'error');
          $('wfa-nav-submit').disabled = false;
          $('wfa-nav-submit').innerHTML = `<span class="material-symbols-rounded">send</span> ยืนยันและส่งแนวคิด`;
        }
      };
    }

    if ($('wfa-file-before')) {
      $('wfa-file-before').onchange = (e) => handleFileUpload(e, beforeImages, 'wfa-before-imgs', 'BEFORE');
    }
    if ($('wfa-file-after')) {
      $('wfa-file-after').onchange = (e) => handleFileUpload(e, afterImages, 'wfa-after-imgs', 'AFTER');
    }
  }

  function handleFileUpload(e, list, containerId, type) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    files.forEach((file) => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        // Compress / resize to max 1280px via Canvas
        const img = new Image();
        img.onload = () => {
          const max = 1280;
          let w = img.width;
          let h = img.height;
          if (w > max || h > max) {
            if (w > h) { h = Math.round((h * max) / w); w = max; }
            else { w = Math.round((w * max) / h); h = max; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
          list.push({
            image_type: type,
            image_url: dataUrl,
            image_description: file.name.replace(/\.[^.]+$/, '')
          });
          renderImageList(containerId, list, type);
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  }

  function saveCurrentStep() {
    if (step === 2) {
      state.process_name = $('wfa-proc-name')?.value.trim() || '';
      state.current_description = $('wfa-proc-desc')?.value.trim() || '';
      state.current_problem = $('wfa-proc-prob')?.value.trim() || '';
      state.frequency = $('wfa-proc-freq')?.value || state.frequency;
    } else if (step === 3) {
      state.project_name = $('wfa-proj-name')?.value.trim() || '';
      state.improvement_description = $('wfa-proj-desc')?.value.trim() || '';
      state.proposed_technology = $('wfa-proj-tech')?.value || state.proposed_technology;
    } else if (step === 4) {
      state.improvement_benefits = Array.from(document.querySelectorAll('[name="wfa-benefit"]:checked')).map((n) => n.value);
    } else if (step === 5) {
      state.time_before = Number($('wfa-t-b')?.value) || 0;
      state.time_after = Number($('wfa-t-a')?.value) || 0;
      state.paper_before = Number($('wfa-p-b')?.value) || 0;
      state.paper_after = Number($('wfa-p-a')?.value) || 0;
      state.steps_before = Number($('wfa-s-b')?.value) || 0;
      state.steps_after = Number($('wfa-s-a')?.value) || 0;
    } else if (step === 6) {
      state.admin_note = $('wfa-remarks')?.value.trim() || '';
    }
  }

  function validateCurrentStep() {
    if (step === 2) {
      if (!$('wfa-proc-name')?.value.trim()) {
        toast('กรุณาระบุชื่อกระบวนการที่ต้องการปรับปรุง', 'error');
        $('wfa-proc-name')?.focus();
        return false;
      }
      if (!$('wfa-proc-desc')?.value.trim()) {
        toast('กรุณาอธิบายวิธีการทำงานปัจจุบัน', 'error');
        $('wfa-proc-desc')?.focus();
        return false;
      }
      if (!$('wfa-proc-prob')?.value.trim()) {
        toast('กรุณาระบุปัญหาที่พบในปัจจุบัน', 'error');
        $('wfa-proc-prob')?.focus();
        return false;
      }
    } else if (step === 3) {
      if (!$('wfa-proj-name')?.value.trim()) {
        toast('กรุณาระบุชื่อแนวคิดหรือโครงการ', 'error');
        $('wfa-proj-name')?.focus();
        return false;
      }
      if (!$('wfa-proj-desc')?.value.trim()) {
        toast('กรุณาระบุแนวทางการปรับปรุง', 'error');
        $('wfa-proj-desc')?.focus();
        return false;
      }
    }
    return true;
  }

  renderWizard();
}

// 3. Admin & Member Projects Dashboard
async function wfaDashboard(target) {
  let ideas = [];
  let stats = {};
  let depts = [];

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
    target.innerHTML = `
      <div class="view-body wfa-page">
        <div class="wfa-dash-header">
          <div>
            <h1 class="wfa-dash-title">Work Flow Automation Dashboard</h1>
            <p class="sum-meta">ระบบบริหารจัดการและติดตามโครงการเปลี่ยนผ่านกระบวนการทำงานสู่ดิจิทัล</p>
          </div>
          <div class="wfa-dash-actions">
            <button class="btn btn-secondary" type="button" id="wfa-export-btn">
              <span class="material-symbols-rounded">download</span> Export CSV / Excel
            </button>
            <button class="btn btn-primary" type="button" id="wfa-new-btn">
              <span class="material-symbols-rounded">add</span> ส่งแนวคิดใหม่
            </button>
          </div>
        </div>

        <div class="wfa-stats-strip">
          <div class="wfa-stat-card">
            <span class="material-symbols-rounded wfa-stat-icon">lightbulb</span>
            <div class="wfa-stat-info">
              <strong class="wfa-stat-num">${stats.totalProjects || 0}</strong>
              <span class="wfa-stat-text">โครงการทั้งหมด</span>
            </div>
          </div>
          <div class="wfa-stat-card">
            <span class="material-symbols-rounded wfa-stat-icon">domain</span>
            <div class="wfa-stat-info">
              <strong class="wfa-stat-num">${stats.totalDepartments || 0}</strong>
              <span class="wfa-stat-text">แผนกที่เสนอ</span>
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

        <div class="card wfa-filter-bar">
          <div class="field" style="flex:2;min-width:220px">
            <input id="wfa-flt-q" placeholder="ค้นหาชื่อโครงการ, ปัญหา, พนักงาน, แผนก" value="${esc(filter.q)}">
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

        <div class="wfa-table-card card">
          <div class="wfa-table-head">
            <strong>รายการโครงการ (${ideas.length} รายการ)</strong>
          </div>
          <div class="table-wrap sheet">
            ${ideas.length ? `
              <table class="mo-data-table">
                <thead>
                  <tr>
                    <th>ลำดับ</th>
                    <th>โครงการ</th>
                    <th>กระบวนการเดิม</th>
                    <th>ผู้เสนอ / แผนก</th>
                    <th>เทคโนโลยี</th>
                    <th>ผลประหยัด</th>
                    <th>สถานะ</th>
                    <th>วันที่</th>
                    <th>จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  ${ideas.map((item, idx) => {
                    const status = WFA_STATUS_BADGES[item.project_status] || WFA_STATUS_BADGES.Idea;
                    const tPct = item.time_saving_pct != null ? `${item.time_saving_pct}%` : null;
                    const pPct = item.paper_reduction_pct != null ? `${item.paper_reduction_pct}%` : null;
                    return `
                      <tr data-pick-id="${item.id}">
                        <td>${idx + 1}</td>
                        <td>
                          <div class="wfa-col-title">
                            <strong>${esc(item.project_name)}</strong>
                          </div>
                        </td>
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
                        <td><small class="sum-meta">${item.created_at ? new Date(item.created_at).toLocaleDateString('th-TH') : ''}</small></td>
                        <td>
                          <div class="wfa-col-actions">
                            <button class="btn btn-secondary small" type="button" data-act-view="${item.id}" title="ดูรายละเอียด">
                              <span class="material-symbols-rounded">visibility</span>
                            </button>
                            ${item.can_edit ? `
                              <button class="btn btn-danger small" type="button" data-act-del="${item.id}" title="ลบโครงการ">
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
            ` : '<p class="empty">ไม่พบโครงการที่ค้นหา หรือยังไม่มีการส่งแนวคิด</p>'}
          </div>
        </div>
      </div>
    `;

    bindDashEvents();
  }

  function bindDashEvents() {
    $('wfa-new-btn').onclick = () => openView('workflow-submit');
    $('wfa-export-btn').onclick = () => {
      window.open('/api/workflow/export', '_blank');
    };

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
  }

  await loadData();
}

// 4. Modal Detail with Before vs After Comparison & Admin Evaluation
async function wfaOpenDetail(id, onRefresh) {
  let data;
  try {
    data = await api(`/api/workflow/ideas/${id}`);
  } catch (err) {
    toast(err.message, 'error');
    return;
  }

  const { idea, images, evaluations } = data;
  const beforeImgs = images.filter((img) => img.image_type === 'BEFORE');
  const afterImgs = images.filter((img) => img.image_type === 'AFTER');
  const status = WFA_STATUS_BADGES[idea.project_status] || WFA_STATUS_BADGES.Idea;

  const html = `
    <div class="wfa-modal-detail">
      <div class="wfa-detail-banner">
        <div class="wfa-detail-head">
          <div>
            <span class="badge ${status.class}">${status.label}</span>
            <h2 class="wfa-detail-title">${esc(idea.project_name)}</h2>
            <p class="sum-meta">ผู้เสนอ: ${esc(idea.full_name)} (${esc(idea.employee_id)}) · แผนก ${esc(idea.department || '-')} · วันที่ ${idea.created_at ? new Date(idea.created_at).toLocaleDateString('th-TH') : ''}</p>
          </div>
          <div class="wfa-detail-tech">
            <span class="wfa-tech-chip"><span class="material-symbols-rounded">memory</span> ${esc(idea.proposed_technology || '-')}</span>
          </div>
        </div>
      </div>

      <div class="wfa-comp-grid">
        <!-- BEFORE Column -->
        <div class="wfa-comp-col is-before">
          <div class="wfa-comp-header">
            <span class="material-symbols-rounded">history</span>
            <strong>BEFORE (กระบวนการเดิม)</strong>
          </div>
          <div class="wfa-comp-body">
            <div class="wfa-field-pair">
              <span>กระบวนการ:</span>
              <b>${esc(idea.process_name)}</b>
            </div>
            <div class="wfa-field-pair">
              <span>ความถี่:</span>
              <b>${esc(idea.frequency || '-')}</b>
            </div>
            <div class="wfa-comp-text-box">
              <small>วิธีการทำงานปัจจุบัน:</small>
              <p>${esc(idea.current_description || '-')}</p>
            </div>
            <div class="wfa-comp-text-box is-problem">
              <small>ปัญหาที่พบ:</small>
              <p>${esc(idea.current_problem || '-')}</p>
            </div>

            <div class="wfa-comp-metrics">
              <div class="wfa-metric-col">
                <span class="sum-meta">เวลาทำงาน</span>
                <strong>${idea.time_before || 0} นาที</strong>
              </div>
              <div class="wfa-metric-col">
                <span class="sum-meta">ใช้กระดาษ</span>
                <strong>${idea.paper_before || 0} แผ่น/ด</strong>
              </div>
              <div class="wfa-metric-col">
                <span class="sum-meta">ขั้นตอน</span>
                <strong>${idea.steps_before || 0} ขั้น</strong>
              </div>
            </div>

            <div class="wfa-comp-gallery">
              <small class="sum-meta">รูปภาพกระบวนการเดิม (${beforeImgs.length} รูป):</small>
              <div class="wfa-gallery-thumbs">
                ${beforeImgs.map((img) => `
                  <a href="${img.image_url}" target="_blank" class="wfa-gallery-link" title="${esc(img.image_description || '')}">
                    <img src="${img.image_url}" alt="Before photo">
                    ${img.image_description ? `<span>${esc(img.image_description)}</span>` : ''}
                  </a>
                `).join('') || '<p class="sum-meta">ไม่มีรูปภาพแนบ</p>'}
              </div>
            </div>
          </div>
        </div>

        <!-- AFTER Column -->
        <div class="wfa-comp-col is-after">
          <div class="wfa-comp-header">
            <span class="material-symbols-rounded">lightbulb</span>
            <strong>AFTER (แนวทางการปรับปรุง)</strong>
          </div>
          <div class="wfa-comp-body">
            <div class="wfa-field-pair">
              <span>โครงการ:</span>
              <b>${esc(idea.project_name)}</b>
            </div>
            <div class="wfa-field-pair">
              <span>เทคโนโลยี:</span>
              <b>${esc(idea.proposed_technology || '-')}</b>
            </div>
            <div class="wfa-comp-text-box">
              <small>แนวทางการปรับปรุง:</small>
              <p>${esc(idea.improvement_description || '-')}</p>
            </div>

            <div class="wfa-comp-metrics is-green">
              <div class="wfa-metric-col">
                <span class="sum-meta">เวลาทำงาน</span>
                <strong>${idea.time_after || 0} นาที</strong>
                ${idea.time_saving_pct != null ? `<span class="wfa-pct-tag">ลด ${idea.time_saving_pct}%</span>` : ''}
              </div>
              <div class="wfa-metric-col">
                <span class="sum-meta">ใช้กระดาษ</span>
                <strong>${idea.paper_after || 0} แผ่น/ด</strong>
                ${idea.paper_reduction_pct != null ? `<span class="wfa-pct-tag">ลด ${idea.paper_reduction_pct}%</span>` : ''}
              </div>
              <div class="wfa-metric-col">
                <span class="sum-meta">ขั้นตอน</span>
                <strong>${idea.steps_after || 0} ขั้น</strong>
                ${idea.steps_reduction_pct != null ? `<span class="wfa-pct-tag">ลด ${idea.steps_reduction_pct}%</span>` : ''}
              </div>
            </div>

            <div class="wfa-comp-gallery">
              <small class="sum-meta">รูปภาพแนวคิด / ภาพจำลอง (${afterImgs.length} รูป):</small>
              <div class="wfa-gallery-thumbs">
                ${afterImgs.map((img) => `
                  <a href="${img.image_url}" target="_blank" class="wfa-gallery-link" title="${esc(img.image_description || '')}">
                    <img src="${img.image_url}" alt="After photo">
                    ${img.image_description ? `<span>${esc(img.image_description)}</span>` : ''}
                  </a>
                `).join('') || '<p class="sum-meta">ไม่มีรูปภาพแนบ</p>'}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Benefits Section -->
      <div class="wfa-detail-sec">
        <strong>ประโยชน์ที่ได้รับ:</strong>
        <div class="wfa-chips-wrap">
          ${(idea.improvement_benefits || []).map((b) => `<span class="wfa-benefit-tag"><span class="material-symbols-rounded">check</span> ${esc(b)}</span>`).join('') || '<span class="sum-meta">-</span>'}
        </div>
      </div>

      <!-- Implementation Meta -->
      <div class="wfa-meta-bar">
        <div><span>ระดับความยาก:</span> <b>${esc(idea.difficulty || '-')}</b></div>
        <div><span>งบประมาณ:</span> <b>${esc(idea.budget || '-')}</b></div>
        <div><span>อัปเดตล่าสุด:</span> <b>${idea.updated_at ? new Date(idea.updated_at).toLocaleString('th-TH') : '-'}</b></div>
      </div>

      <!-- Admin Evaluation Box -->
      ${idea.can_evaluate ? `
        <div class="wfa-eval-box">
          <div class="wfa-eval-head">
            <span class="material-symbols-rounded">admin_panel_settings</span>
            <strong>ส่วนประเมินโครงการสำหรับ Admin</strong>
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
            <button class="btn btn-primary" type="button" id="wfa-btn-save-eval">บันทึกผลการประเมิน</button>
          </div>

          ${evaluations.length ? `
            <div class="wfa-eval-history">
              <small class="sum-meta">ประวัติการประเมิน (${evaluations.length} ครั้ง):</small>
              <ul>
                ${evaluations.map((ev) => `
                  <li>
                    <span>${ev.admin_id} · สถานะ: <b>${ev.evaluation_status}</b></span>
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

  openPopup(`รายละเอียดโครงการ #${idea.id}`, html, null);

  if ($('wfa-btn-save-eval')) {
    $('wfa-btn-save-eval').onclick = async () => {
      try {
        const payload = {
          project_status: $('wfa-eval-status').value,
          admin_note: $('wfa-eval-note').value.trim()
        };
        await api(`/api/workflow/ideas/${idea.id}/evaluate`, { method: 'POST', body: payload });
        toast('บันทึกผลการประเมินเรียบร้อย');
        closePopup();
        if (onRefresh) onRefresh();
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }
}

// Register views
VIEWS['workflow'] = wfaHome;
VIEWS['workflow-submit'] = wfaSubmit;
VIEWS['workflow-dashboard'] = wfaDashboard;
VIEWS['smf-workflow'] = wfaHome;
