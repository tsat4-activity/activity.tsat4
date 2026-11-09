// System > Setting: creator-only table editor (server: server/modules/system).
const CHOICES = {
  status: ['Active', 'Inactive'],
  group: ['Factory', 'Non', 'Center'],
  level: ['S1', 'S2', 'S3', 'T1', 'T2', 'T3', 'T6', 'T7', 'T8', 'M1', 'M2', 'M3', 'G1', 'G2', 'G3'],
  prefix: ['นาย', 'นาง', 'นางสาว', 'Mr.', 'Mrs.', 'Ms.'],
  areatype: ['โรงงาน', 'สำนักงาน'],
  actrole: ['admin', 'chairman', 'vice', 'advisor', 'smart', 'auditor', 'owner', 'member']
};

TITLES.system = ['Setting', 'ตารางทั้งระบบ'];
const SYS_LEVEL_NAMES = { M: 'ผู้จัดการ', G: 'ผู้จัดการโรงงาน' };
let sysDepts = null; // department choices = departments in mt_main_costcenter (GET /api/system/choices)
// mt_main_user.admin_of choices (server: ADMIN_SCOPES in server/core/access.js).
const SYS_SCOPES = ACTIVITIES.map(([id, label]) => [id, label]);
const SYS_USER_LABELS = { creator: 'จัดการได้ทั้งหมด', executive: 'ผู้บริหาร', admin_of: 'ผู้ดูแลระบบ' };

const SYS_COMPANY_LABELS = {
  id: 'รหัส', logo: 'โลโก้ (1:1)', name_en: 'ชื่อบริษัท (อังกฤษ)', name_th: 'ชื่อบริษัท (ไทย)',
  legal_name: 'ชื่อธุรกิจ', address: 'สถานที่ตั้ง', area: 'พื้นที่โรงงาน', business: 'ประเภทธุรกิจ',
  customers: 'กลุ่มลูกค้าหลัก', employees: 'จำนวนพนักงาน', profile_on: 'อัพเดท (YYYY-MM-DD)',
  register_on: 'วันที่ขอขึ้นทะเบียน (YYYY-MM-DD)', photo1: 'ลิงก์รูป 1', photo2: 'ลิงก์รูป 2'
};
function columnLabel(table, column) {
  if (table?.name === 'mt_main_user' && SYS_USER_LABELS[column.name]) return SYS_USER_LABELS[column.name];
  if (table?.name === 'mt_main_company' && SYS_COMPANY_LABELS[column.name]) return SYS_COMPANY_LABELS[column.name];
  return column.name;
}

function cellText(column, value) {
  if (column.type === 'scopes') return (Array.isArray(value) ? value : []).map((id) => (SYS_SCOPES.find(([key]) => key === id) || [, id])[1]).join(', ');
  if (column.type === 'bool') return value ? '✓' : '';
  return value ?? '';
}

// Table cell: a photo column shows its thumbnail (hover zooms, ZOOM_THUMBS), the rest plain text.
function cellHtml(column, value) {
  if (column.type === 'photo' || column.type === 'logo') return value ? `<img class="sys-photo img-zoom${column.type === 'logo' ? ' is-square' : ''}" src="${esc(value)}" alt="" loading="lazy">` : '';
  return esc(cellText(column, value));
}

// Photo field (mt_main_employee.photo, ผู้ใช้กำหนด 2026-10-30: อัตราส่วน 2.5:3): the picked file is cropped in the
// browser to 500×600 JPEG and kept in data-new until save; the server uploads it (Storage img_main) and stores the link.
function photoControl(id, label, value, shape = 'portrait') {
  const square = shape === 'square';
  return `<div class="field">${label}<div class="sys-photo-edit">
    <img id="${id}-view" class="sys-photo is-large${square ? ' is-square' : ''}" src="${esc(value || '')}" alt=""${value ? '' : ' hidden'}>
    <div class="sys-photo-actions">
      <input id="${id}" type="file" accept="image/*" data-new="" data-shape="${square ? 'square' : 'portrait'}">
      ${value ? `<label class="check"><input id="${id}-remove" type="checkbox"> ลบรูป</label>` : ''}
      <span class="sum-meta">${square ? 'ครอปเป็น 1 : 1 และคงพื้นโปร่งของ PNG' : 'ครอปเป็น 2.5 : 3 อัตโนมัติ'}</span>
    </div>
  </div></div>`;
}

function bindPhotoControl(id) {
  const input = $(id);
  if (!input) return;
  input.onchange = async () => {
    const file = input.files?.[0];
    input.dataset.new = '';
    if (!file) return;
    try {
      const square = input.dataset.shape === 'square';
      input.dataset.new = await cropJpeg(file, square ? 512 : 500, square ? 512 : 600, 250000, square ? 'image/png' : 'image/jpeg');
      $(`${id}-view`).src = input.dataset.new;
      $(`${id}-view`).hidden = false;
      if ($(`${id}-remove`)) $(`${id}-remove`).checked = false;
    } catch (err) { onErr(err); }
  };
}

function columnControl(table, column, value) {
  const id = `sys-${column.name}`;
  const label = columnLabel(table, column);
  if (column.type === 'password') return field(label, `<input id="${id}" type="password" autocomplete="new-password">`);
  if (column.type === 'photo' || column.type === 'logo') return photoControl(id, label, value, column.type === 'logo' ? 'square' : 'portrait');
  if (column.type === 'bool') return field(label, `<select id="${id}"><option value="false">false</option><option value="true"${value ? ' selected' : ''}>true</option></select>`);
  if (column.type === 'scopes') {
    const on = Array.isArray(value) ? value : [];
    // A div, not field(): checkbox labels must not sit inside another label.
    return `<div class="field sys-scope-field">${label}<div id="${id}" class="sys-scopes">${SYS_SCOPES.map(([key, name]) => `<label class="check"><input type="checkbox" value="${esc(key)}"${on.includes(key) ? ' checked' : ''}> ${esc(name)}</label>`).join('')}</div></div>`;
  }
  const list = column.type === 'dept' ? sysDepts || [] : CHOICES[column.type];
  if (list) {
    // A value no longer in the list (old data) stays selectable so the row can still be saved unchanged.
    const all = [...(column.required ? [] : ['']), ...(value && !list.includes(value) ? [value] : []), ...list];
    const text = (v) => (v === '' ? '-' : column.type === 'level' && SYS_LEVEL_NAMES[v[0]] ? `${v} · ${SYS_LEVEL_NAMES[v[0]]}` : v);
    return field(label, `<select id="${id}">${options(all, value ?? '', text)}</select>`);
  }
  const number = ['int', 'qty', 'money'].includes(column.type);
  const step = column.type === 'int' ? '1' : '0.001';
  return field(label, `<input id="${id}" ${number ? `type="number" step="${step}"` : ''} value="${esc(value ?? '')}">`);
}

// Pick ระบบ → งาน / กิจกรรม → ตาราง (ผู้ใช้กำหนด 2026-10-29). A table's unit comes from its name (mt_<key>_* / tx_<key>_*).
// mt_main_* = ข้อมูลกลาง (ระบบตั้งค่า), mt_5s_* / tx_5s_* = 5S.
const SYS_GROUPS = [['setting', 'ระบบตั้งค่า'], ['activity', 'ระบบกิจกรรม']];
const sysUnitsOf = (group) => (group === 'activity' ? ACTIVITIES.map(([id, label]) => [id, label]) : [['main', 'ข้อมูลกลาง']]);
function sysUnitOf(name) {
  const key = (/^(?:mt|tx|v)_([a-z0-9]+)_/.exec(name) || [])[1] || 'main';
  const act = ACTIVITIES.find(([id]) => id.replace(/[^a-z0-9]/g, '') === key);
  return act ? ['activity', act[0]] : ['setting', 'main'];
}
const sysPick = { group: 'setting', unit: 'main', table: '' };

async function renderSystem(target) {
  const catalog = await api('/api/system/tables');
  const state = { offset: 0, editing: null, rows: [], selected: null };
  const head = { sort: '', dir: 'asc', filters: {} };
  const columnHead = () => headFor(head, () => { state.offset = 0; loadRows().catch(onErr); });
  target.innerHTML = tablePage('sys', `
    ${field('ระบบ', `<select id="sys-group">${options(SYS_GROUPS.map(([id]) => id), sysPick.group, (v) => SYS_GROUPS.find(([id]) => id === v)[1])}</select>`)}
    ${field('งาน / กิจกรรม', '<select id="sys-unit"></select>')}
    ${field('ตาราง', '<select id="sys-table"></select>', 'grow')}
    ${searchSlot('ค้นหา', 'sys-q', 'sys-search', { grow: true })}
    ${crudBar('sys')}
    ${button('sys-clean', 'ล้างไฟล์ค้าง', 'secondary', 'title="ลบรูป / ไฟล์ใน Storage ที่ไม่มีข้อมูลไหนใช้แล้ว"')}`);
  const tableOf = () => catalog.tables.find((table) => table.name === $('sys-table').value);
  const tablesIn = (group, unit) => catalog.tables.filter((table) => { const [g, u] = sysUnitOf(table.name); return g === group && u === unit; });
  // งาน / กิจกรรม list with its table count; ตาราง list of the chosen unit only.
  const fillUnits = () => {
    const units = sysUnitsOf(sysPick.group);
    if (!units.some(([id]) => id === sysPick.unit)) sysPick.unit = (units.find(([id]) => tablesIn(sysPick.group, id).length) || units[0])[0];
    $('sys-unit').innerHTML = options(units.map(([id]) => id), sysPick.unit, (id) => `${units.find(([u]) => u === id)[1]} (${tablesIn(sysPick.group, id).length})`);
  };
  const fillTables = () => {
    const list = tablesIn(sysPick.group, sysPick.unit);
    if (!list.some((table) => table.name === sysPick.table)) sysPick.table = list[0]?.name || '';
    $('sys-table').innerHTML = list.length ? options(list.map((table) => table.name), sysPick.table) : '<option value="">ยังไม่มีตาราง</option>';
    $('sys-table').disabled = !list.length;
  };
  const loadRows = async () => {
    const table = tableOf();
    state.rows = [];
    state.selected = null;
    $('sys-edit').disabled = true;
    $('sys-del').disabled = true;
    $('sys-add').disabled = !table;
    if (!table) {
      fillTable('sys-rows', [], '', `ยังไม่มีตารางของ ${esc($('sys-unit').selectedOptions[0]?.textContent.replace(/ \(\d+\)$/, '') || '')} ในระบบ`);
      countText('sys-count', 0, 0);
      setPager('sys', 0, 0);
      return;
    }
    let data;
    try {
      const params = tableParams(new URLSearchParams({ q: $('sys-q').value.trim(), offset: String(state.offset) }), head);
      data = await api(`/api/system/tables/${encodeURIComponent(table.name)}?${params}`);
    } catch (err) {
      fillTable('sys-rows', [], '', esc(err.message));
      countText('sys-count', 0, 0);
      setPager('sys', 0, 0);
      throw err;
    }
    state.rows = data.rows;
    countText('sys-count', state.rows.length, data.total);
    setPager('sys', state.offset, data.total);
    const visible = table.columns.filter((column) => column.type !== 'password');
    fillTable('sys-rows', visible.map((column) => ({ label: columnLabel(table, column), key: column.name })), state.rows.map((row, index) => `<tr data-pick="${index}">${visible.map((column) => `<td>${cellHtml(column, row[column.name])}</td>`).join('')}</tr>`).join(''), 'ไม่มีแถว', columnHead());
    bindRowSelect($('sys-rows'), (pick) => {
      state.selected = state.rows[Number(pick)];
      $('sys-edit').disabled = false;
      $('sys-del').disabled = false;
    });
  };
  const saveRow = async () => {
    const table = tableOf();
    const values = {};
    for (const column of table.columns) {
      if (column.type === 'read') continue;
      const input = $(`sys-${column.name}`);
      if (!input || input.disabled) continue;
      if (column.type === 'password') { if (input.value) values.password = input.value; continue; }
      if (column.type === 'scopes') { values[column.name] = [...input.querySelectorAll('input:checked')].map((box) => box.value); continue; }
      // photo: a new picture (data URL) or '' to remove; untouched = not sent
      if (column.type === 'photo' || column.type === 'logo') {
        if (input.dataset.new) values[column.name] = input.dataset.new;
        else if ($(`sys-${column.name}-remove`)?.checked) values[column.name] = '';
        continue;
      }
      values[column.name] = column.type === 'bool' ? input.value === 'true' : input.value;
    }
    if (state.editing) {
      const key = {};
      table.pk.forEach((column) => { key[column] = state.editing[column]; });
      await api(`/api/system/tables/${encodeURIComponent(table.name)}`, { method: 'PATCH', body: { key, values } });
    } else {
      await api(`/api/system/tables/${encodeURIComponent(table.name)}`, { method: 'POST', body: values });
    }
    toast('บันทึกแล้ว');
    if (table.name === 'mt_main_company' && typeof loadAppBranding === 'function') loadAppBranding();
    state.editing = null;
    closePopup();
    await loadRows();
  };
  const drawForm = async () => {
    const table = tableOf();
    if (table.columns.some((column) => column.type === 'dept') && !sysDepts) sysDepts = (await api('/api/system/choices')).dept || [];
    const fields = table.columns.map((column) => {
      if (column.type === 'read') return '';
      return columnControl(table, column, state.editing ? state.editing[column.name] : '');
    }).join('');
    const title = table.name === 'mt_main_user'
      ? (state.editing ? 'แก้ไขสิทธิ์จัดการระบบ' : 'เพิ่มสิทธิ์จัดการระบบ')
      : `${state.editing ? 'แก้ไขแถว' : 'เพิ่มแถว'} ${esc(table.name)}`;
    openPopup(title, fields, saveRow);
    table.columns.filter((column) => column.type === 'photo' || column.type === 'logo').forEach((column) => bindPhotoControl(`sys-${column.name}`));
  };
  const reset = () => { state.offset = 0; head.sort = ''; head.dir = 'asc'; head.filters = {}; state.editing = null; closePopup(); loadRows().catch(onErr); };
  $('sys-group').onchange = () => { sysPick.group = $('sys-group').value; fillUnits(); fillTables(); reset(); };
  $('sys-unit').onchange = () => { sysPick.unit = $('sys-unit').value; fillTables(); reset(); };
  $('sys-table').onchange = () => { sysPick.table = $('sys-table').value; reset(); };
  fillUnits();
  fillTables();
  $('sys-add').onclick = () => { state.editing = null; drawForm().catch(onErr); };
  $('sys-edit').onclick = () => { if (!state.selected) return toast('เลือกแถวก่อน', 'error'); state.editing = state.selected; drawForm().catch(onErr); };
  $('sys-del').onclick = () => {
    if (!state.selected) return toast('เลือกแถวก่อน', 'error');
    const table = tableOf();
    const key = {};
    table.pk.forEach((column) => { key[column] = state.selected[column]; });
    const removing = table.name === 'mt_main_user' ? 'นำสิทธิ์จัดการระบบออก' : `ลบแถว ${esc(table.name)}`;
    confirmPopup(removing, 'ตรวจแถวที่เลือกอีกครั้งก่อนลบ', async () => {
      await api(`/api/system/tables/${encodeURIComponent(table.name)}`, { method: 'DELETE', body: { key } });
      toast('ลบแล้ว');
      await loadRows();
    });
  };
  $('sys-clean').onclick = () => sysCleanStorage().catch(onErr);
  bindPager('sys', state, loadRows);
  await loadRows();
}

// ล้างไฟล์ค้าง (ผู้ใช้กำหนด 2026-11-09): count first, then remove after the creator confirms.
const sysSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);
async function sysCleanStorage() {
  toast('กำลังตรวจไฟล์ใน Storage...');
  const scan = await api('/api/system/storage/orphans');
  const rows = scan.folders.filter((f) => f.files || f.error);
  const lines = rows.map((f) => `${esc(f.bucket)}/${esc(f.prefix)} · ${f.files} ไฟล์ ${sysSize(f.bytes)}${f.error ? ` · ข้าม (${esc(f.error)})` : f.left ? ` · <b>ค้าง ${f.left} ไฟล์ ${sysSize(f.leftBytes)}</b>` : ''}`).join('<br>');
  const head = `ไฟล์ทั้งหมด ${sysSize(scan.bytes)} จากพื้นที่ฟรี 1 GB`;
  if (!scan.left) return openPopup('ล้างไฟล์ค้าง', `<p class="sum-meta">${head} · ไม่มีไฟล์ค้าง<br><br>${lines}</p>`, async () => closePopup(), 'ปิด');
  confirmPopup('ล้างไฟล์ค้าง', `${head} · พบไฟล์ที่ไม่มีข้อมูลไหนใช้แล้ว <b>${scan.left} ไฟล์ ${sysSize(scan.leftBytes)}</b> (นับเฉพาะไฟล์ที่เก่ากว่า 1 วัน)<br><br>${lines}<br><br>ลบแล้วกู้คืนไม่ได้`, async () => {
    const done = await api('/api/system/storage/orphans', { method: 'POST' });
    toast(`ลบไฟล์ค้างแล้ว ${done.removed || 0} ไฟล์`);
  }, `ลบ ${scan.left} ไฟล์`);
}

VIEWS.system = renderSystem;
