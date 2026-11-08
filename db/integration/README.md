# โครงสร้าง SQL สำหรับแชร์ข้อมูลข้ามโปรเจกต์ (`db/integration/`)

> **สถานะ:** วางโครงสร้างเตรียมไว้ (ยังไม่รันจริงบน Supabase)

ตามมาตรฐาน `docs/integration-standard.md` ข้อมูลที่ใช้ร่วมกันบ่อย (เช่น พนักงาน และ Cost Center) สามารถเปิดเป็น Read-only View ชื่อ `share_<ข้อมูล>` บนฐานข้อมูลต้นทางควบคู่กับ API:

- `share_employee`: รหัสพนักงาน, คำนำหน้า, ชื่อ-นามสกุล, แผนก, ระดับ, สถานะ
- `share_costcenter`: รหัส Cost Center, ชื่อหน่วยงาน (`department`), กลุ่ม (`group_name`)
- `share_kpi_monthly`: ยอดสรุป KPI รายเดือนของแต่ละระบบ
