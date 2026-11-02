# db/ — SQL ที่รันเองใน Supabase

AI ไม่มีสิทธิ์เข้าฐานข้อมูล ผู้ใช้รันไฟล์ใน SQL Editor ของ Supabase เอง

| ไฟล์ | ใช้ทำอะไร |
|---|---|
| `setup.sql` | **ฐานว่าง รันไฟล์นี้ไฟล์เดียว** = `00_main.sql` + `act/5s.sql` + `act/cfo.sql` + `act/cfo_ef_ref_seed.sql` + `act/smf.sql` (สร้างด้วย `node scripts/setup-sql.js` ห้ามแก้มือ) รันซ้ำได้ |
| `00_main.sql` | ตารางกลาง `mt_main_employee`, `mt_main_costcenter`, `mt_main_user` + รหัสผู้ดูแลแรก 2102899 |
| `act/5s.sql` | ตาราง 5S ทั้งชุด + bucket `img_5s` สร้างจาก `scripts/act-sql.js` เท่านั้น ห้ามแก้มือ |
| `act/cfo.sql` | ตาราง CFO ทั้งชุด (Scope, GWP, EF, กิจกรรม, บันทึกรายเดือน, Fr-03.2, ประวัติปรับปรุง) + bucket `img_cfo` สร้างจาก `scripts/act-sql.js` ห้ามแก้มือ รันซ้ำได้ |
| `act/cfo_ef_ref_seed.sql` | ข้อมูลตั้งต้น Emission Factor อ้างอิง TGO AR5 V2 (พลังงาน, สารเคมี, IPCC, เชื้อเพลิง) สร้างจาก `scripts/cfo_ef_ref_excel.py` |
| `act/smf.sql` | ตาราง SMF (ทีม + แผนงาน Project Planner) `node scripts/act-sql.js smf --no-audit` ห้ามแก้มือ รันซ้ำได้ |
| `act/5s_task.sql` | สำหรับฐาน 5S เก่าที่ยังไม่มี Project Planner (ฐานใหม่ไม่ต้องใช้) |

เปลี่ยนแม่แบบ: แก้ `scripts/act-sql.js` → `node scripts/act-sql.js 5s` (CFO: `node scripts/act-sql.js cfo --no-audit --no-planner`) → `node scripts/setup-sql.js` → `npm run test:act`
