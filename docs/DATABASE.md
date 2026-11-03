# เอกสารสรุปฐานข้อมูลและไฟล์ SQL ล่าสุด (TSAT4 Activity)

> อัปเดตล่าสุด: 2026-11-03  
> ฐานข้อมูล: Supabase (`activity01`) · Stack: PostgreSQL + RLS + Supabase JS

---

## 1. โครงสร้างตารางหลัก (Master Database Schema)

ไฟล์ติดตั้งโครงสร้างตารางทั้งหมดรวมอยู่ในไฟล์เดียว **รันซ้ำได้ปลอดภัย (Idempotent)**:

| ไฟล์ | ขนาด | หน้าที่และรายละเอียด |
|---|---|---|
| **`db/setup.sql`** | ~140 KB | **ไฟล์สร้างโครงสร้างหลัก (Master Schema)** รวมทุกโมดูล:<br>• `db/00_main.sql`: ตารางกลาง พนักงาน แผนก Cost Center สิทธิ์ผู้ใช้ (`mt_main_*`)<br>• `db/act/5s.sql` & `5s_task.sql`: ตารางพื้นที่ ทีม เกณฑ์ตรวจ ใบตรวจ คะแนน Issue (`mt_5s_*`, `tx_5s_*`)<br>• `db/act/cfo.sql`: ตาราง Scope กิจกรรม บันทึกรายเดือน และการประเมิน TGO (`mt_cfo_*`, `tx_cfo_*`)<br>• `db/act/cfo_ef_ref_seed.sql`: ข้อมูลค่า Emission Factor มาตรฐาน (Energy, Fuel, Chemical, IPCC ฯลฯ)<br>• `db/act/smf.sql`: ตารางโครงการ ตัวชี้วัด และผลงานรายเดือน SMF (`mt_smf_*`, `tx_smf_*`) |

> [!NOTE]
> `db/setup.sql` ถูกสร้างอัตโนมัติด้วยคำสั่ง `node scripts/setup-sql.js` ห้ามแก้ไขไฟล์ด้วยมือโดยตรง

---

## 2. ไฟล์ข้อมูลเริ่มต้นและข้อมูลจำลองล่าสุด (Active Data SQL Files ใน `inbox/`)

ไฟล์นำเข้าข้อมูลในโฟลเดอร์ `inbox/` ที่ผ่านการคัดกรองและคงไว้เฉพาะ **เวอร์ชันล่าสุด** ที่ใช้งานจริง:

### 2.1 ข้อมูลตั้งค่าระบบและมาสเตอร์ดาต้า (Setup & Master Data)
1. **`inbox/import_5s_setup.sql`** (~14 KB)
   - ข้อมูลพื้นที่ 34 พื้นที่ (`A01`–`A19` โรงงาน, `B01`–`B15` สำนักงาน)
   - ตัวแทนพื้นที่ (Owner) 34 ท่านตามรหัสพนักงาน
   - ทีมผู้ตรวจประเมิน 17 รายชื่อ (ประธาน 2 ท่าน + ผู้ตรวจกลุ่ม A–I 15 ท่าน)
   - หัวข้อตรวจประเมินมาตรฐาน 25 ข้อย่อยประจำปี 2026 (ส1–ส5)
2. **`inbox/import_costcenter.sql`** (~7 KB)
   - ข้อมูลรหัส Cost Center และหน่วยงานที่สังกัด
3. **`inbox/users_access.sql`** (~2 KB)
   - กำหนดสิทธิ์การเข้าใช้งานระบบสำหรับผู้ดูแลและผู้ใช้งานเริ่มต้น

### 2.2 ข้อมูลผลการตรวจประเมิน 5S ปี 2026 ล่าสุด (5S Mock Audit Data)
* **`inbox/mock_5s_audits_2026.sql`** (~778 KB) — *สร้างจาก `scripts/generate_5s_mock_data.py`*
  - **แผนตรวจ Committee (`mt_5s_audit_plan`):** 3 รอบ (มี.ค., มิ.ย., ก.ย.) ครบ 34 พื้นที่ รวม 102 แถว จัดสรรเฉลี่ยตาม 9 ทีม (ทีม A–G ตรวจละ 4 พื้นที่, ทีม H–I ตรวจละ 3 พื้นที่)
  - **Self Audit (`tx_5s_audit`):** ทุกเดือน (ม.ค.–พ.ย. รวม 11 เดือน) ก่อนวันที่ 10 ของเดือน ครบ 34 พื้นที่ รวม 374 ใบตรวจ คะแนนเฉลี่ย 82.4%–93.6%
  - **Committee Audit (`tx_5s_audit`):** 3 รอบ รวม 102 ใบตรวจ:
    - **รอบ 1 (มี.ค.) & รอบ 2 (มิ.ย.):** คณะกรรมการเข้าตรวจครบ 100% (ผ่านเกณฑ์ทุกคน)
    - **รอบ 3 (ก.ย.):** ทีม I ไม่ได้เข้าตรวจ โดยกระจาย 3 พื้นที่ของทีม I ให้ทีม A, B, C ตรวจแทนจนครบ 34 พื้นที่ ผู้ตรวจ 5 ท่านที่ไม่ได้เข้าร่วม (อนุวัต ทีม D, ณัฐวุฒิ ทีม E, อนุชิต ทีม F, สมหวัง ทีม I, ไพรัช ทีม I) ได้ผลรอบ 3 เท่ากับ 0% และประเมินผลรวมทั้งปี 67% (ไม่ผ่านเกณฑ์ 80%) ส่วนอีก 10 ท่านผ่านเกณฑ์ 100%
  - **คะแนนรายข้อ (`tx_5s_audit_score`):** ครบทั้ง 25 ข้อ รวม 11,900 แถว

### 2.3 ข้อมูล CFO ล่าสุด (Carbon Footprint for Organization)
1. **`inbox/import_cfo_setup.sql`** (~24 KB) — โครงสร้าง Scope 1–3, กิจกรรมปล่อยก๊าซ, และเป้าหมายลดการปล่อย
2. **`inbox/import_cfo_material.sql`** (~128 KB) — ข้อมูลการเบิกใช้วัสดุและสารเคมีจาก SAP (Scope 3)
3. **`inbox/import_cfo_usagelist.sql`** (~77 KB) — ข้อมูลการใช้พลังงานไฟฟ้าและน้ำมันเชื้อเพลิงแยกตาม Section
4. **`inbox/import_cfo_tx.sql`** (~34 KB) — ข้อมูลธุรกรรมการปล่อยก๊าซเรือนกระจกรายเดือน
5. **`inbox/import_cfp_tgo.sql`** (~319 KB) — ข้อมูลค่า Emission Factor (CFP) จากองค์การบริหารจัดการก๊าซเรือนกระจก (TGO)

---

## 3. ลำดับการรันไฟล์ใน Supabase SQL Editor

หากต้องการติดตั้งหรืออัปเดตฐานข้อมูลใหม่ ให้รันตามลำดับต่อไปนี้:

```text
[ขั้นตอนที่ 1: ติดตั้ง Schema]
  └── db/setup.sql

[ขั้นตอนที่ 2: นำเข้า Master Data]
  ├── inbox/import_costcenter.sql
  ├── inbox/users_access.sql
  └── inbox/import_5s_setup.sql

[ขั้นตอนที่ 3: นำเข้าข้อมูลผลตรวจ 5S ประจำปี]
  └── inbox/mock_5s_audits_2026.sql

[ขั้นตอนที่ 4: นำเข้าข้อมูล CFO]
  ├── inbox/import_cfo_setup.sql
  ├── inbox/import_cfp_tgo.sql
  ├── inbox/import_cfo_material.sql
  ├── inbox/import_cfo_usagelist.sql
  └── inbox/import_cfo_tx.sql
```

---

## 4. ไฟล์ SQL เก่าที่ตัดออกแล้ว (Cleaned Up Files)

ไฟล์ต่อไปนี้ถูกลบออกจากระบบเนื่องจากล้าสมัยหรือมีไฟล์เวอร์ชันใหม่ทดแทนแล้ว:
- `inbox/import_5s.sql` (แทนที่ด้วย `import_5s_setup.sql` และ `mock_5s_audits_2026.sql`)
- `inbox/import_5s/` (`01_areas.sql` ถึง `08_issues.sql` รวม 8 ไฟล์เดิม)
- `inbox/import_cfo.sql` (แทนที่ด้วย `import_cfo_setup.sql` + ไฟล์แยกย่อยเฉพาะทาง)
- `inbox/import_main.sql` (รวมเข้าไปใน `db/setup.sql` แล้ว)
