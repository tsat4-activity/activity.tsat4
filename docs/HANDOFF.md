# HANDOFF — อ่านก่อนเริ่ม และอัปเดตก่อน commit

## กำลังทำอยู่

(ไม่มี)

## SQL ที่รอผู้ใช้รัน

- [SMF] `db/act/smf.sql` (หรือ `db/setup.sql`) ใน Tx Data (activity01): ตาราง `mt_smf_team`, `mt_smf_setting`, `mt_smf_task`, `mt_smf_project` (พร้อม `target_name`, `unit`), และตาราง `tx_smf_project_month` (เป้าหมายและผลงานรายเดือน)

- `db/act/cfo.sql` ใน Supabase activity01 (5S + ตารางกลางรันแล้ว) · ฐานว่างใหม่ใช้ `db/setup.sql` ไฟล์เดียว

## ข้อควรระวัง

- `db/setup.sql` สร้างจาก `db/00_main.sql` + `db/act/5s.sql` ด้วย `node scripts/setup-sql.js` ห้ามแก้มือ (`npm run test:act` ตรวจให้)
- `public/app.css` ยังมีสไตล์ของ Store / CFO / Kaizen / QCC ติดมา (ไม่มีผลกับหน้าจอ) ลบทีหลังได้
- ข้อมูลเดิมจาก TSAT4 SMF (พนักงาน, ผลตรวจ 5S, CFO) ยังไม่ได้ย้ายมา · มีไฟล์นำเข้า `inbox/import_5s.sql`, `inbox/import_cfo.sql` (ไม่อยู่ใน git) ทดสอบแล้วใน test:act

## บันทึก (อันใหม่อยู่บนสุด)

- 2026-11-01 · Antigravity [SMF] · เพิ่มระบบบันทึกเป้าหมาย (target) และผลงาน (actual) รายเดือนของโครงการ SMF: ตาราง `tx_smf_project_month` (project_id, month 1..12, target, actual, note) · API GET/PUT `/api/act/:activity/project-months` · หน้า Transaction (`smf-edit`) ตาราง 12 เดือนคำนวณผลต่างและ % บรรลุแบบเรียลไทม์ พร้อมปุ่มคัดลอกเป้าหมายเดือนที่ 1 ไปทุกเดือน · Setting > โครงการ กำหนด KPI และหน่วยได้ · Dashboard แสดงผลงาน KPI ล่าสุดต่อโครงการ · **ผู้ใช้ต้องรัน db/act/smf.sql ใน Tx Data**

- 2026-11-01 · Claude [5S] · CFO Setting > Emission Factor แยก 5 ตาราง: EF ที่ใช้คำนวณ · GWP (เพิ่ม/แก้/ลบ) · EF พลังงาน · GWP สารเคมี · EF IPCC (`mt_cfo_ef_ref` + seed 204 แถวจากแผ่น EF TGO AR5 V2) · ผู้ใช้ต้องรัน db/act/cfo.sql แล้ว db/act/cfo_ef_ref_seed.sql
- 2026-11-01 · Claude [5S] · เพิ่มตาราง คุณสมบัติเชื้อเพลิง (sheet fuel: Heating value / Density / Conversion Factor 30 แถว) · ตัดหน้า EF ที่ใช้คำนวณออกตามผู้ใช้ · ต้องรัน db/act/cfo.sql + cfo_ef_ref_seed.sql อีกครั้ง
- 2026-11-01 · Claude [5S] · ตาราง EF ทุกหน้าความกว้างคอลัมน์เท่ากัน (.cfo-efgrid .c-*) · เพิ่มตาราง EF CFP (sheet cfp, ว่าง ผู้ใช้วางจาก Excel) · ต้องรัน db/act/cfo.sql อีกครั้ง (constraint sheet)
- 2026-11-01 · Claude [5S] · ฟอร์มกิจกรรม CFO เลือกหมวด Scope + EF จากตาราง EF พลังงาน / GWP สารเคมี / EF CFP · server คัดลอกเป็น mt_cfo_ef (code ref:<id>:<scope>) ใช้ซ้ำถ้าค่าเท่าเดิม · ไม่ต้องรัน SQL
- 2026-11-01 · Claude [5S] · ฟอร์มกิจกรรม CFO เลือกตามลำดับ Scope 1/2/3/รายงานแยก → หมวด → สูตร → EF (กรองตามกัน) · บ่อเกรอะตั้ง EF septic:<หมวด> ให้ · cfo.sql มี 23 หมวด TGO แล้ว (activity01 ไม่มีหมวด) · ต้องรัน db/act/cfo.sql
- 2026-11-01 · Claude [5S] · CFO กระบะ B7 คิด 3 ส่วนจากปริมาณเดียว: Scope 1 + Biogenic (co2_bio จากแถวคู่) + 3-3 การได้มาของเชื้อเพลิง (ef3_id ใน mt_cfo_activity / tx_cfo_entry, v_cfo_entry part=upstream) · หมวด 1-1/1-2/1-4 กรอง EF · ต้องรัน db/act/cfo.sql
- 2026-11-01 · Claude [5S] · CFO Setting > วัสดุ (SAP): mt_cfo_material (1,347 รายการจาก master_sto.xlsx → inbox/import_cfo_material.sql) + EF + ตัวแปลง · วาง Usage รายเดือน → tx_cfo_material → Scope 3 (v_cfo_entry part=material, Fr-04.1) · cost center → หน่วยงานจาก mt_main_costcenter · ต้องรัน db/act/cfo.sql + inbox/import_cfo_material.sql
- 2026-11-02 · Claude [5S] · CFO ตั้งต้นจาก mt_cfo.xlsx (scripts/import_cfo_setup.py → inbox/import_cfo_setup.sql: ทีม 23 · บริษัท · กิจกรรม 34 พร้อม EF, รถส่วนตัว = 3-6) · วัสดุมีประเภท Usage / วัตถุดิบ / อื่นๆ (kind) · ต้องรัน cfo.sql + seed + import_cfo_setup.sql + import_cfo_material.sql
- 2026-11-02 · Claude [5S] · CFO Usage จาก SAP (Usage.xlsx): วางทั้งแผ่นพร้อมหัวตาราง (current = ปริมาณ, 0 / ติดลบข้าม) · cost center → Section (inbox/import_costcenter.sql) · ตาราง Usage ตาม Section + กลุ่ม Usage (SAP) ใน Transaction Scope 3 · import_cfo_material.py อ่าน Usage.xlsx ได้ (1,349 วัสดุ)

- 2026-11-01 · Claude [5S] · ทีม 5ส ตัดคณะกรรมการ 5ส ออก เหลือ 4 ทีม (ต้องเลือกทีม) · ทีมตรวจประเมินไม่มีสมาชิก (ผู้รับผิดชอบพื้นที่ / ผู้ตรวจประเมิน) · สิทธิ์ Setting = ผู้ประสานงานของทีมใดก็ได้ใน 5S · แถวเดิมที่ไม่มีทีมแสดงเป็น ไม่ระบุทีม จนกว่าจะแก้

- 2026-11-01 · Claude [5S] · Popup เพิ่มแบบตาราง Excel (`gridField` ใน core.js): วางหลายแถวจาก Excel ได้ · ใช้ที่ 5S > Setting > หัวข้อตรวจ (ข้อที่ว่าง = ต่อเลขเอง) และ พื้นที่

- 2026-11-01 · Claude [SMF] · ย้ายภาพรวม 5S · CFO · SMF ไปเป็น **หน้าหลัก** (`VIEWS.main = aplHome` ใน act-planner.js, ลบ renderMain ใน core.js) · SMF Dashboard > ภาพรวม เหลือเฉพาะ 3 โครงการของ SMF

- 2026-11-01 · Claude [SMF] · SMF มีโครงการรายปี (`mt_smf_project`, 2026: Smart OEE · Vision Camera · Work Flow Automation): Setting > โครงการ (เพิ่ม/แก้ไข/ลบ/คัดลอกปี) · ทีมต่อโครงการ (`unit`) · ข้อหลักของแผนเลือกโครงการ (`mt_<act>_task.unit` ทุกกิจกรรม) Gantt จัดกลุ่ม + ตัวกรอง · ภาพรวม/Team แสดงต่อโครงการ · `unitsOf` / `projectsOf` ใน common.js

- 2026-11-01 · Claude · แยกงานให้หลาย AI: `Activity\5S` (branch main) + `Activity\SMF` (git worktree branch smf, inbox = junction ไป 5S) · ตารางว่าใครดูแลไฟล์ไหนอยู่ใน AGENTS.md หัวข้อ 0.1 · `Activity\CFO` เป็นสำเนา CFO แยกเดิม (repo อื่น) ผู้ใช้ให้คงไว้

- 2026-11-01 · Claude · SMF Dashboard แท็บแรก **ภาพรวม** ของโครงการหลัก 5S · CFO · SMF (SMF = Smart Factory ดูแลภาพรวม): KPI รวม + การ์ดต่อโครงการ = ความคืบหน้าแผน (สถานะหัวข้อหลัก) · ผลลัพธ์หลัก (5S คะแนน/ใบตรวจ/Self ค้าง · CFO tCO₂e เทียบปีก่อนเดือนเดียวกัน+เป้า) · ทีม · ปัญหา (Issue / แผนเลยกำหนด) · API `GET /api/act/overview` (server/modules/act/overview.js) อ่านอย่างเดียว ตารางที่ยังไม่สร้าง = ส่วนนั้นว่าง

- 2026-10-30 · Claude · ทีม (5S / CFO / SMF ใช้ a5SetTeam ร่วมกัน) เพิ่มปุ่มแก้ไข: เปลี่ยนทีม บทบาท กลุ่มตรวจ พื้นที่ หน่วยงาน สถานะ (PATCH /team/:id ตรวจแบบเดียวกับเพิ่ม `placementOf`) · ตรวจทุกหน้าแล้ว หน้าอื่นมี เพิ่ม/แก้ไข/ลบ ครบ · กฎใหม่ใน AGENTS.md

- 2026-10-30 · Claude · โครงสร้างทีมใหม่ทุกกิจกรรม (docs/specs/act-teams.md): เริ่มด้วย ประธาน · รองประธาน · ที่ปรึกษา · ผู้ประสานงาน · 5S มีคอลัมน์ `unit` = 4 ทีมย่อย (มาตรฐาน / วิชาการ / ประชาสัมพันธ์ / ตรวจประเมิน) แทนร่าง role standard/academic/pr (ย้ายข้อมูลให้เอง) · Issue เมื่อคะแนน**ต่ำกว่า** 3 · Action ก่อนตรวจถัดไป 15 วัน · ปิด Issue เมื่อตรวจได้ ≥ 3 · **ผู้ใช้ต้องรัน db/act/5s.sql, cfo.sql, smf.sql ซ้ำใน TX (activity01)**

- 2026-10-30 · Claude · `mt_main_employee.photo` รูปพนักงาน 2.5:3: Setting เลือกรูป → ครอป 500×600 JPEG ในเบราว์เซอร์ (`cropJpeg` แทน squareJpeg ที่ไม่มีใครใช้) → server อัปโหลด Storage `img_main` ของ MX แล้วเก็บลิงก์ · ติ๊ก ลบรูป = ล้างค่า (ไฟล์เก่าไม่ลบ) · **ผู้ใช้ต้องรัน db/00_main.sql ซ้ำใน MX (activity02)**

- 2026-10-30 · จัดโครงสร้าง Table 5S ครบ 3 ส่วน:
  1. **ทีม:** ทีมบริหาร (`chairman`, `vice`, `admin` ผู้ประสานงาน) แยกโครงสร้างย่อยเป็นทีมมาตรฐาน (`standard`), ทีมวิชาการ (`academic`), ทีมตรวจประเมิน (`auditor` ทีม A–Z), ทีมประชาสัมพันธ์ (`pr`)
  2. **พื้นที่ประเมิน:** ผู้รับผิดชอบพื้นที่ (`owner`) เป็นผู้ดูแลพื้นที่
  3. **หัวข้อประเมิน:** ร่างหัวข้อมาตรฐาน 25 ข้อ (ส1–ส5 หมวดละ 5 ข้อ เต็ม 125) ใน `db/act/5s.sql`, `db/setup.sql` และ `db/act/5s_checklist_seed.sql` รันซ้ำได้

- 2026-10-30 · Claude · เพิ่มกิจกรรม SMF (Smart Factory: ทีม ประธาน/รองประธาน/ที่ปรึกษา/Smart Team/ตัวแทนหน่วยงาน + แผนงาน) จาก SMF-act · role `smart` = admin ของ SMF · db/act/smf.sql + setup.sql · **ผู้ใช้ต้องรัน db/act/smf.sql ใน TX (activity01)**

- 2026-10-30 · ปรับปรุงบทบาททีมกิจกรรม 5S ตามข้อกำหนด: ประธาน (`chairman`), รองประธาน (`vice`), ผู้ประสานงาน (`admin`), ผู้ตรวจประเมิน (`auditor`), ผู้รับผิดชอบพื้นที่ (`owner`) ทั้งใน Setting (เพิ่ม/แสดงทีม) และ Dashboard (แท็บ Team)

- 2026-10-30 · Claude · รวม CFO เข้าเว็บเดียวกับ 5S (ชื่อ TSAT4 Activity, โฟลเดอร์ Activity\SMF-5S): cfo.js / act-cfo.js / db/act/cfo.sql จาก SMF-act 8440ac5 · setup.sql รวม cfo · test:act รวม CFO (ข้อมูลจริง tCO2e ตรง Excel) · Setting ไม่แสดง mt_cfo_task (CFO ไม่มี Planner)

- 2026-10-30 · Claude · ใช้ Supabase ของตัวเอง: เพิ่ม `db/00_main.sql` (mt_main_employee / costcenter / user + รหัส 2102899) และ `db/setup.sql` ไฟล์เดียวสำหรับฐานว่าง · ตารางกลางกลับมาแก้ได้ใน System Setting · ทดสอบ ฐานว่าง → setup.sql → bootstrap → login → เพิ่มพนักงาน ผ่าน
- 2026-10-30 · Claude · แยก 5S ออกจาก TSAT4 SMF (commit ต้นทาง 8440ac5): เหลือ login + 5S (Dashboard / Transaction / Setting) + ปฏิทิน + System Setting · ตัด Store, ระบบงาน, CFO, Kaizen, QCC, 100P, SMF, E-DAY, LEAN, SAFETY
