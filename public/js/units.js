// Unit catalog: the activities of this app (5S pages in act-5s.js, CFO in act-cfo.js, SMF in act-planner.js).
const ACTIVITIES = [
  ['5s', '5S', 'event'],
  ['cfo', 'CFO', 'event'],
  ['smf', 'SMF', 'event']
];
const PLANT_PAGES = [
  ['home', 'monitoring', 'Dashboard', 'ภาพรวม'],
  ['edit', 'edit_note', 'Edit data', 'แก้ไขข้อมูล'],
  ['setting', 'settings', 'Setting', 'ข้อมูลตั้งต้น']
];
// Sidebar: only Edit data + Setting — activity name opens *-home (ภาพรวม)
const PLANT_NAV = PLANT_PAGES.filter(([page]) => page !== 'home');
for (const [id, label] of ACTIVITIES) {
  const path = `ระบบกิจกรรม > ${label}`;
  TITLES[`${id}-home`] = [label, path];
  for (const [page, , title] of PLANT_NAV) TITLES[`${id}-${page}`] = [title, path];
}
Object.assign(TITLES, {
  activity: ['ระบบกิจกรรม', 'Activity']
});

function plantOf(name) {
  const row = ACTIVITIES.find(([id]) => name === id || name.startsWith(`${id}-`));
  return row ? { row, group: 'ระบบกิจกรรม' } : null;
}

function plantRender(name) {
  const unit = plantOf(name);
  if (!unit) return async (target) => { target.innerHTML = cardView('ไม่พบหน้า', '', '<p class="empty">ไม่มีหน้านี้</p>'); };
  const id = unit.row[0];
  const page = name === id ? '' : name.slice(id.length + 1);
  return async (target) => {
    if (page) return renderPlantPage(target, id, page);
    const home = VIEWS[`${id}-home`];
    if (home) return home(target);
    target.innerHTML = cardView(unit.row[1], `${unit.group} > ${unit.row[1]}`, '<p class="empty">ยังไม่มีข้อมูลภาพรวม</p>');
  };
}

function renderPlantPage(target, id, page) {
  const unit = plantOf(id);
  const found = PLANT_PAGES.find((row) => row[0] === page);
  const title = found ? found[2] : page;
  const text = page === 'edit' ? 'ยังไม่มีรายการในส่วนนี้' : page === 'setting' ? 'ยังไม่มีการตั้งค่าในส่วนนี้' : 'ยังไม่มีข้อมูลในส่วนนี้';
  target.innerHTML = cardView(title, `${unit.group} > ${unit.row[1]}`, `<p class="empty">${text}</p>`);
}

async function renderActivity(target) {
  const cards = ACTIVITIES.map(([id, label, icon]) => moduleCard(`${id}-home`, icon, label, 'ภาพรวม · Edit data · Setting')).join('');
  target.innerHTML = `<div class="view-body"><div class="module-grid">${cards}</div></div>`;
  bindGo(target);
}

function unitNav(rows) {
  return rows.map(([id, label, icon]) => `<div class="nav-acc is-collapsed" data-nav-acc="${id}">
  <div class="nav-split">
    <button class="nav-btn nav-parent" type="button" data-view="${id}-home" title="${label}"><span class="material-symbols-rounded">${icon}</span><span>${label}</span></button>
    <button class="nav-caret-btn" type="button" data-nav-toggle="${id}" aria-expanded="false" aria-label="ย่อ ${label}" title="ย่อ/ขยาย"><span class="material-symbols-rounded nav-caret">expand_more</span></button>
  </div>
  <div class="nav-sub" data-nav-panel="${id}">${PLANT_NAV.map(([page, itemIcon, title]) => `<button class="nav-btn" data-view="${id}-${page}" title="${title}"><span class="material-symbols-rounded">${itemIcon}</span><span>${title}</span></button>`).join('')}</div>
</div>`).join('');
}

Object.assign(VIEWS, { activity: renderActivity });
viewFallback = plantRender;
