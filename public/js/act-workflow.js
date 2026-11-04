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

// SMF: Transaction - Work Flow Automation Project View
async function wfaRenderSmfTransaction(target, currentProj, me, rerender, pmData, byMonth, projTabs) {
  let ideas = [];
  let stats = {};
  let depts = [];
  let showMonthlyTable = false;
  let teamMembers = [];
  try {
    const tData = await a5Api('smf', `team?year=${a5Year}`).catch(() => ({ members: [] }));
    teamMembers = (tData.members || []).filter((m) => m.status === 'Active');
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
    const canEdit = Boolean(me.access?.admin || me.access?.member || me.access?.smart);
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

    target.innerHTML = `
      <div class="view-body"><section class="card">
        ${pageBar(a5Seg('data-smfproj', projTabs, currentProj.id), `<div class="a5-year">${a5YearSelect(me.years)}</div>`, 'smf')}
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

          <!-- Project Submissions Table -->
          <div class="wfa-table-card card">
            <div class="wfa-table-head" style="display:flex;justify-content:space-between;align-items:center">
              <strong>รายการโปรเจค Work Flow Automation ที่สมาชิกส่ง (${ideas.length} เรื่อง)</strong>
              <span class="sum-meta">คลิกแถวเพื่อดูรายละเอียด Before-After คู่ขนาน หรือประเมินสถานะ</span>
            </div>
            <div class="table-wrap sheet">
              ${ideas.length ? `
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
              ` : '<p class="empty">ยังไม่มีการส่งข้อมูลโปรเจค Work Flow Automation หรือไม่พบข้อมูลตามตัวกรอง · คลิก "+ ส่งข้อมูลโปรเจค" เพื่อส่งแนวคิดแรก</p>'}
            </div>
          </div>

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

    $('wfa-btn-add').onclick = () => wfaOpenSubmitWizard(me, loadData, teamMembers);
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

    // 12-Month Table calculation & save handlers
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

    recalc();
    target.querySelector('#smf-rows').addEventListener('input', recalc);

    if ($('smf-copy-target')) {
      $('smf-copy-target').onclick = () => {
        const firstTarget = target.querySelector('#smf-rows tr[data-month="1"] .smf-target').value;
        if (firstTarget === '') return toast('กรุณากรอกเป้าหมายเดือนที่ 1 ก่อน', 'warn');
        target.querySelectorAll('#smf-rows tr .smf-target').forEach((el) => { el.value = firstTarget; });
        recalc();
        toast('คัดลอกเป้าหมายไปทุกเดือนแล้ว');
      };
    }

    if ($('smf-save')) {
      $('smf-save').onclick = async () => {
        const months = [...target.querySelectorAll('#smf-rows tr')].map((tr) => ({
          month: Number(tr.dataset.month),
          target: numOf(tr.querySelector('.smf-target')),
          actual: numOf(tr.querySelector('.smf-actual')),
          note: tr.querySelector('.smf-note').value || null
        }));
        try {
          $('smf-save').disabled = true;
          await a5Api('smf', 'project-months', { method: 'PUT', body: { year: a5Year, projectId: currentProj.id, months } });
          toast('บันทึกเป้าหมายและผลงานสำเร็จ');
          loadData();
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
function wfaOpenSubmitWizard(me, onSuccess, teamMembers = []) {
  let step = 1;
  const beforeImages = [];
  const afterImages = [];

  const state = {
    employee_id: me?.employeeId || '',
    full_name: me?.name || '',
    department: me?.department || '',
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
        ].map(([sNum, sLabel, sIcon], idx) => {
          const num = idx + 1;
          const cls = num === step ? 'is-current' : num < step ? 'is-done' : '';
          return `
            <div class="wfa-step-item ${cls}" data-wfa-step="${num}">
              <div class="wfa-step-circle">
                ${num < step ? '<span class="material-symbols-rounded">check</span>' : `<span class="material-symbols-rounded">${sIcon}</span>`}
              </div>
              <div class="wfa-step-lbl">${sLabel}</div>
            </div>
          `;
        }).join('')}
      </div>

      <div class="wfa-step-body" id="wfa-wiz-body"></div>

      <div class="wfa-wizard-nav" style="margin-top:16px;border-top:1px solid var(--mo-line);padding-top:12px">
        <button class="btn btn-secondary" type="button" id="wfa-wiz-prev" ${step === 1 ? 'disabled' : ''}>
          <span class="material-symbols-rounded">chevron_left</span> ย้อนกลับ
        </button>
        <div class="wfa-nav-spacer"></div>
        <button class="btn btn-primary" type="button" id="wfa-wiz-next">
          ถัดไป <span class="material-symbols-rounded">chevron_right</span>
        </button>
      </div>
    </div>
  `;

  openPopup('ส่งข้อมูลโปรเจค Work Flow Automation', modalHtml, null);

  function renderStep() {
    const body = $('wfa-wiz-body');
    if (!body) return;

    // Update Stepper header
    document.querySelectorAll('[data-wfa-step]').forEach((item) => {
      const num = Number(item.dataset.wfaStep);
      item.classList.toggle('is-current', num === step);
      item.classList.toggle('is-done', num < step);
    });

    $('wfa-wiz-prev').disabled = step === 1;
    $('wfa-wiz-next').innerHTML = step === 6
      ? `<span class="material-symbols-rounded">send</span> ยืนยันและส่งแนวคิด`
      : `ถัดไป <span class="material-symbols-rounded">chevron_right</span>`;

    if (step === 1) {
      const memberOptions = (teamMembers || []).map((m) => `<option value="${esc(m.emp_id || '')}" data-name="${esc(m.name)}" data-dept="${esc(m.unit || '')}">${esc(m.name)} (${esc(m.unit || m.role || '-')}) - ${esc(m.emp_id || '-')}</option>`).join('');
      body.innerHTML = `
        <div class="wfa-step-section">
          <div class="wfa-sec-badge">Section 01</div>
          <h3 style="margin:4px 0">ข้อมูลสมาชิกผู้ส่ง (Member Information)</h3>
          ${memberOptions ? `
          <div class="field" style="margin-bottom:12px">
            <label>เลือกสมาชิกในทีม SMF (เพื่อกรอกข้อมูลอัตโนมัติ)</label>
            <select id="wfa-pick-member" class="input">
              <option value="">-- เลือกสมาชิกในทีม หรือกรอกเองด้านล่าง --</option>
              ${memberOptions}
            </select>
          </div>` : ''}
          <div class="wfa-form-grid">
            ${field('รหัสพนักงาน', `<input id="wfa-empid" value="${esc(state.employee_id)}" placeholder="เช่น 2101999">`)}
            ${field('ชื่อ-นามสกุล', `<input id="wfa-name" value="${esc(state.full_name)}" placeholder="เช่น นางสาว อัจฉรา โสกาบุญ">`)}
            ${field('แผนก / หน่วยงาน', `<input id="wfa-dept" value="${esc(state.department)}" placeholder="เช่น PLN & STO">`)}
            ${field('วันที่ส่ง', `<input value="${new Date().toLocaleDateString('th-TH')}" readonly class="is-locked">`)}
          </div>
        </div>
      `;
      if ($('wfa-pick-member')) {
        $('wfa-pick-member').onchange = () => {
          const opt = $('wfa-pick-member').selectedOptions[0];
          if (opt && opt.value) {
            state.employee_id = opt.value;
            state.full_name = opt.dataset.name || '';
            state.department = opt.dataset.dept || '';
            if ($('wfa-empid')) $('wfa-empid').value = state.employee_id;
            if ($('wfa-name')) $('wfa-name').value = state.full_name;
            if ($('wfa-dept')) $('wfa-dept').value = state.department;
          }
        };
      }
      if ($('wfa-empid')) $('wfa-empid').oninput = () => { state.employee_id = $('wfa-empid').value.trim(); };
      if ($('wfa-name')) $('wfa-name').oninput = () => { state.full_name = $('wfa-name').value.trim(); };
      if ($('wfa-dept')) $('wfa-dept').oninput = () => { state.department = $('wfa-dept').value.trim(); };
    } else if (step === 2) {
      body.innerHTML = `
        <div class="wfa-step-section">
          <div class="wfa-sec-badge is-red">Section 02 · BEFORE</div>
          <h3 style="margin:4px 0">กระบวนการเดิมก่อนปรับปรุง (Current Process)</h3>
          
          <div class="field">
            <label class="required">ชื่อกระบวนการที่ต้องการปรับปรุง (Process Name)</label>
            <input id="wfa-proc-name" maxlength="200" value="${esc(state.process_name)}" placeholder="เช่น การบันทึกผลตรวจสอบชิ้นงาน, เอกสารเบิกจ่ายชิ้นส่วน">
          </div>
          <div class="field">
            <label class="required">อธิบายวิธีการทำงานปัจจุบัน</label>
            <textarea id="wfa-proc-desc" rows="2" placeholder="อธิบายขั้นตอนการทำงานเดิมที่เป็นปัญหาหรือเป็นกระดาษ">${esc(state.current_description)}</textarea>
          </div>
          <div class="field">
            <label class="required">ปัญหาที่พบ (Current Problem)</label>
            <textarea id="wfa-proc-prob" rows="2" placeholder="เช่น ใช้เวลานาน, เอกสารหาย, คีย์ซ้ำซ้อน">${esc(state.current_problem)}</textarea>
          </div>
          <div class="field">
            <label>ความถี่ในการทำงาน</label>
            <select id="wfa-proc-freq">
              ${options(['ทุกวัน (Daily)', 'หลายครั้งต่อวัน', 'ทุกสัปดาห์ (Weekly)', 'ทุกเดือน (Monthly)', 'อื่นๆ'], state.frequency)}
            </select>
          </div>

          <div class="wfa-img-upload-sec">
            <div class="wfa-img-upload-head">
              <strong>แนบรูปภาพ Before (เอกสาร/สภาพปัญหา)</strong>
              <span class="sum-meta">JPG, PNG (เลือกได้หลายรูป)</span>
            </div>
            <div class="wfa-img-grid" id="wfa-before-imgs"></div>
            <div class="wfa-file-drop">
              <input type="file" id="wfa-file-before" accept="image/jpeg,image/png,image/jpg" multiple class="d-none">
              <button class="btn btn-secondary small" type="button" onclick="$('wfa-file-before').click()">
                <span class="material-symbols-rounded">upload_file</span> เลือกรูป Before
              </button>
            </div>
          </div>
        </div>
      `;
      renderImageList('wfa-before-imgs', beforeImages, 'BEFORE');
      $('wfa-file-before').onchange = (e) => handleFileUpload(e, beforeImages, 'wfa-before-imgs', 'BEFORE');
    } else if (step === 3) {
      body.innerHTML = `
        <div class="wfa-step-section">
          <div class="wfa-sec-badge is-green">Section 03 · AFTER</div>
          <h3 style="margin:4px 0">แนวทางปรับปรุงและโซลูชัน (Proposed Solution)</h3>

          <div class="field">
            <label class="required">ชื่อแนวคิดหรือโครงการ (Project Name)</label>
            <input id="wfa-proj-name" maxlength="200" value="${esc(state.project_name)}" placeholder="เช่น Digital QC Inspection Sheet, Online Parts Requisition">
          </div>
          <div class="field">
            <label class="required">แนวทางการปรับปรุง</label>
            <textarea id="wfa-proj-desc" rows="2" placeholder="อธิบายระบบหรือโซลูชันที่จะนำมาใช้">${esc(state.improvement_description)}</textarea>
          </div>
          <div class="field">
            <label>เครื่องมือ / เทคโนโลยีที่ต้องการใช้</label>
            <select id="wfa-proj-tech">
              ${options(WFA_TECH_OPTIONS, state.proposed_technology)}
            </select>
          </div>

          <div class="wfa-img-upload-sec">
            <div class="wfa-img-upload-head">
              <strong>แนบรูปภาพ After (Flowchart, Mockup, แนวคิด)</strong>
              <span class="sum-meta">JPG, PNG</span>
            </div>
            <div class="wfa-img-grid" id="wfa-after-imgs"></div>
            <div class="wfa-file-drop">
              <input type="file" id="wfa-file-after" accept="image/jpeg,image/png,image/jpg" multiple class="d-none">
              <button class="btn btn-secondary small" type="button" onclick="$('wfa-file-after').click()">
                <span class="material-symbols-rounded">add_photo_alternate</span> เลือกรูป After
              </button>
            </div>
          </div>
        </div>
      `;
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
                  <strong>${esc(b.label)}</strong>
                </label>
              `;
            }).join('')}
          </div>
        </div>
      `;
      body.querySelectorAll('[name="wfa-benefit"]').forEach((chk) => {
        chk.onchange = () => chk.closest('.wfa-benefit-card').classList.toggle('is-selected', chk.checked);
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
            <label>หมายเหตุเพิ่มเติม (ถ้ามี)</label>
            <textarea id="wfa-remarks" rows="2" placeholder="ระบุผู้เกี่ยวข้องหรือข้อคิดเห็น">${esc(state.admin_note || '')}</textarea>
          </div>

          <div class="wfa-summary-box">
            <div class="wfa-sum-title">สรุปข้อมูลที่จะส่ง:</div>
            <div class="wfa-sum-row"><span>ชื่อโปรเจค:</span><b>${esc(state.project_name || '-')}</b></div>
            <div class="wfa-sum-row"><span>กระบวนการเดิม:</span><b>${esc(state.process_name || '-')}</b></div>
            <div class="wfa-sum-row"><span>เทคโนโลยี:</span><b>${esc(state.proposed_technology)}</b></div>
            <div class="wfa-sum-row"><span>รูปภาพ:</span><b>Before ${beforeImages.length} รูป · After ${afterImages.length} รูป</b></div>
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
        <input class="wfa-img-desc-input" value="${esc(img.image_description || '')}" placeholder="คำอธิบายภาพ" data-desc-img="${idx}">
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

  function handleFileUpload(e, list, containerId, type) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    files.forEach((file) => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
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
    if (step === 1) {
      state.employee_id = $('wfa-empid')?.value.trim() || state.employee_id;
      state.full_name = $('wfa-name')?.value.trim() || state.full_name;
      state.department = $('wfa-dept')?.value.trim() || state.department;
    } else if (step === 2) {
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
    if (step === 1) {
      if (!$('wfa-name')?.value.trim()) {
        toast('กรุณาระบุชื่อ-นามสกุลผู้ส่ง หรือเลือกจากรายชื่อ', 'error');
        $('wfa-name')?.focus();
        return false;
      }
    } else if (step === 2) {
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

  $('wfa-wiz-prev').onclick = () => {
    saveCurrentStep();
    if (step > 1) {
      step--;
      renderStep();
    }
  };

  $('wfa-wiz-next').onclick = async () => {
    if (!validateCurrentStep()) return;
    saveCurrentStep();
    if (step < 6) {
      step++;
      renderStep();
      return;
    }

    // Submit step 6
    try {
      $('wfa-wiz-next').disabled = true;
      $('wfa-wiz-next').innerHTML = `<span class="material-symbols-rounded">sync</span> กำลังบันทึก...`;

      const payload = {
        ...state,
        images: [...beforeImages, ...afterImages]
      };

      await api('/api/workflow/ideas', { method: 'POST', body: payload });
      toast('ส่งข้อมูลโปรเจค Work Flow Automation สำเร็จแล้ว');
      closePopup();
      if (onSuccess) onSuccess();
    } catch (err) {
      toast(err.message, 'error');
      $('wfa-wiz-next').disabled = false;
      $('wfa-wiz-next').innerHTML = `<span class="material-symbols-rounded">send</span> ยืนยันและส่งแนวคิด`;
    }
  };

  renderStep();
}

// Modal Detail View with Before vs After Comparison & Admin Evaluation
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
