# รายงานการตรวจสอบบั๊กและข้อบกพร่อง (Bug Audit Report) — TSAT4 Activity (5S + CFO + SMF)

**วันที่ตรวจสอบ:** 2026-11-02  
**เครื่องมือตรวจสอบ:** Antigravity / Gemini  
**เป้าหมาย:** `C:\Work\projects\Activity\5S` (ครอบคลุมโมดูล 5S, CFO, SMF, แกนระบบ และ SQL generator)  
**เกณฑ์การตรวจสอบ:** Logic การคำนวณ, สิทธิ์การเข้าถึง (Authorization/Access Control), การตรวจสอบ Input & ความปลอดภัย (XSS/Validation), การทำงาน Asynchronous & Race Condition, ความสอดคล้องของ UI ตาม AGENTS.md, และความถูกต้องของคำสั่ง SQL  
**สถานะการทดสอบระบบ:** `npm run check` (ผ่านทั้งหมด) และ `npm run test:act` (ผ่านทั้งหมด)  
**เงื่อนไข:** รายงานนี้เป็นการตรวจสอบเชิงลึก **ไม่มีการแก้ไขโค้ด และไม่มีการ commit / push**

---

## สรุปภาพรวมข้อบกพร่องตามระดับความร้ายแรง

| ลำดับ | ระดับความร้ายแรง | หมวดหมู่ | หัวข้อปัญหา | ไฟล์:บรรทัด | ความมั่นใจ |
|:---:|:---:|:---:|:---|:---|:---:|
| 1 | **ร้ายแรงมาก** | Security | Stored XSS ในหน้าภาพรวม (Home/Overview) จากชื่อโครงการ SMF | `public/js/act-planner.js:484`, `520` | ยืนยันแล้ว |
| 2 | **ร้ายแรงมาก** | Authorization | สิทธิ์ข้ามโครงการใน SMF (`PUT project-months` ตรวจแค่ `access.member`) | `server/modules/act/smf.js:113` | ยืนยันแล้ว |
| 3 | **ร้ายแรงมาก** | Data / Crash | Foreign Key Violation เมื่อลบหัวข้อตรวจ 5S ที่มี Issue อ้างอิง | `server/modules/act/audit.js:583-587` | ยืนยันแล้ว |
| 4 | **ร้ายแรงปานกลาง** | Authorization | สิทธิ์ปรับเป้าหมายผ่านเกณฑ์ 5S กว้างเกินไป (ยอมรับ member และ auditor) | `server/modules/act/audit.js:619` | ยืนยันแล้ว |
| 5 | **ร้ายแรงปานกลาง** | Async / Race | ดับเบิลคลิกปุ่มบันทึกใน Popup ส่งคำขอซ้ำซ้อน เกิดข้อมูลซ้ำหรือพัง | `public/js/core.js:434`, `439`, `public/js/act-tx.js:276` | ยืนยันแล้ว |
| 6 | **ร้ายแรงปานกลาง** | Logic / Auth | เช็กสิทธิ์แอดมิน CFO ฟิกซ์ปีปัจจุบันของเครื่อง (`thisYear()`) ข้อมูลข้ามปีแก้ไม่ได้ | `server/modules/act/cfo.js:539`, `639`, `723`, `731`, `741`, `750`, `763` | ยืนยันแล้ว |
| 7 | **ร้ายแรงปานกลาง** | Logic / Input | ช่องกรอกวันที่ `DMY` แอบใช้ค่าวันที่เก่าเงียบๆ เมื่อพิมพ์วันที่ไม่ครบถ้วน | `public/js/core.js:742-747` | ยืนยันแล้ว |
| 8 | **ร้ายแรงน้อย** | UI Compliance | `fitTables` ไม่คำนวณ `maxHeight` บนจอความสูงต่ำ ดันหน้าจอให้มี scrollbar | `public/js/core.js:608` | ยืนยันแล้ว |
| 9 | **ร้ายแรงน้อย** | Robustness | `req.body` เสี่ยงเกิด `TypeError` หากไม่ส่ง Content-Type ใน Login/Password | `server/core/auth.js:17`, `38` | ยืนยันแล้ว |
| 10 | **ร้ายแรงน้อย** | UI Feature | `OVERFLOW_TIP` ถูกบล็อกเมื่อ element หรือ child มี native `title` | `public/js/core.js:682` | น่าจะใช่ |

---

## รายละเอียดข้อบกพร่อง เรียงจากร้ายแรงมากไปน้อย

---

### 1. [ร้ายแรงมาก - Security] Stored Cross-Site Scripting (XSS) ในหน้าภาพรวม (Home / Overview)
- **ไฟล์:บรรทัด**: [`public/js/act-planner.js:484`](file:///C:/Work/projects/Activity/5S/public/js/act-planner.js#L484), [`public/js/act-planner.js:520`](file:///C:/Work/projects/Activity/5S/public/js/act-planner.js#L520)
- **ปัญหาคืออะไร**:  
  ในหน้าภาพรวมหลัก (Home) ที่แสดงการ์ดสรุปทุกกิจกรรม ฟังก์ชัน `teamHtml` ในบรรทัดที่ 520 ดึงชื่อโครงการ SMF จาก `names[u]` แล้วส่งเข้าไปในฟังก์ชัน `row(label, value)` ซึ่งนิยามไว้ในบรรทัด 484 ดังนี้:
  ```javascript
  const row = (label, value) => `<div class="ov-row"><span>${label}</span><b>${value}</b></div>`;
  ```
  จะเห็นว่าตัวแปร `label` ถูกต่อเข้า HTML String โดยตรงโดย**ไม่ได้ครอบฟังก์ชัน `esc(label)`** ซึ่งชื่อโครงการ (`name`) มาจากตาราง `mt_smf_project` ที่ผู้ใช้สามารถกรอกและบันทึกผ่านหน้า Setting ได้
- **ตัวอย่างที่ทำให้พัง**:  
  1. ผู้ใช้ที่มีสิทธิ์ตั้งค่าโครงการ SMF ไปที่หน้า `SMF > Setting > โครงการ`  
  2. กด "เพิ่มโครงการ" หรือ "แก้ไขโครงการ" โดยตั้งชื่อโครงการว่า:  
     `<img src=x onerror="alert(document.cookie)">`  
  3. บันทึกข้อมูล จากนั้นผู้ใช้ทุกคนที่เปิดหน้าหลัก (หน้าแรกของเว็บ TSAT4 Activity ซึ่งเรียก `VIEWS.main = aplHome`) โค้ด JavaScript อันตรายจะถูกสั่งรันในเบราว์เซอร์ทันที สามารถขโมย Session หรือยิง API แทนผู้ใช้ได้
- **วิธีแก้ที่เสนอ**:  
  แก้ไขใน `public/js/act-planner.js:484` ให้ฟังก์ชัน `row` ทำการ escape ตัวแปร `label` เสมอ:
  ```javascript
  const row = (label, value) => `<div class="ov-row"><span>${esc(label)}</span><b>${value}</b></div>`;
  ```
  หรือ escape ที่บรรทัด 520:
  ```javascript
  const units = Object.entries(p.team.units).map(([u, n]) => row(esc(labels[u] || names[u] || u), `${n} คน`)).join('');
  ```
- **ความมั่นใจ**: ยืนยันแล้ว

---

### 2. [ร้ายแรงมาก - Authorization] สิทธิ์การบันทึกเป้าหมายและผลงานข้ามโครงการใน SMF
- **ไฟล์:บรรทัด**: [`server/modules/act/smf.js:113`](file:///C:/Work/projects/Activity/5S/server/modules/act/smf.js#L113)
- **ปัญหาคืออะไร**:  
  ในการบันทึกเป้าหมาย (target) และผลงาน (actual) รายเดือนของโครงการ SMF ผ่าน API `PUT /api/act/:activity/project-months` มีการตรวจสอบสิทธิ์ดังนี้:
  ```javascript
  const [projectResult, access] = await Promise.all([
    tx.from(t.project).select('*').eq('id', projectId).eq('year', year).maybeSingle(),
    accessOf(req, activity, year)
  ]);
  const project = must(projectResult);
  if (!project) return fail(res, 404, 'ไม่พบโครงการ');
  if (!access.admin && !access.member) return fail(res, 403, 'ไม่มีสิทธิ์บันทึกข้อมูลโครงการนี้');
  ```
  แต่ตัวแปร `access.member` ใน `server/modules/act/common.js:173` ถูกกำหนดเป็น `access.member = roles.length > 0` ซึ่งหมายถึง "ผู้ใช้มีบทบาทใดๆ ในกิจกรรม SMF ปีนั้น"  
  ส่งผลให้พนักงานที่เป็นสมาชิกในทีมของโครงการ A (เช่น โครงการ Smart OEE) ได้รับสิทธิ์ `access.member === true` และสามารถส่งคำขอบันทึกทับเป้าหมายและผลงานของโครงการ B (เช่น Vision Camera หรือ Automation) ได้ ทั้งๆ ที่ตนเองไม่ได้สังกัดในโครงการนั้น
- **ตัวอย่างที่ทำให้พัง**:  
  1. นาย ก. ได้รับมอบหมายให้อยู่ในทีมโครงการ `oee` (`unit = 'oee'`) ไม่ใช่แอดมิน  
  2. นาย ก. ยิงคำขอ `PUT /api/act/smf/project-months` ระบุ `projectId` ของโครงการ `vision` พร้อมค่า target/actual ใหม่  
  3. เซิร์ฟเวอร์ตรวจสอบ `access.member` พบว่าเป็นจริง จึงทำการ `upsert` ทับข้อมูลผลงานของโครงการ Vision Camera ทันที
- **วิธีแก้ที่เสนอ**:  
  ใน `server/modules/act/smf.js` ต้องตรวจสอบความสัมพันธ์ระหว่างผู้ใช้กับโครงการ (`project.code`) เพิ่มเติม:
  ```javascript
  const isAuthorized = access.admin || access.creator || (access.member && roles.some((r) => r.unit === project.code));
  if (!isAuthorized) return fail(res, 403, 'ไม่มีสิทธิ์บันทึกข้อมูลโครงการนี้');
  ```
- **ความมั่นใจ**: ยืนยันแล้ว

---

### 3. [ร้ายแรงมาก - Data / Crash] Foreign Key Violation เมื่อลบหัวข้อตรวจประเมิน 5S ที่มี Issue
- **ไฟล์:บรรทัด**: [`server/modules/act/audit.js:583-587`](file:///C:/Work/projects/Activity/5S/server/modules/act/audit.js#L583-L587)
- **ปัญหาคืออะไร**:  
  เมื่อผู้ดูแลระบบสั่งลบหัวข้อตรวจประเมิน `DELETE /api/act/:activity/checklist/:id` ฟังก์ชันตรวจสอบว่าหัวข้อนี้ถูกใช้งานหรือไม่ โดยเช็กเฉพาะตารางคะแนน `tx_5s_audit_score`:
  ```javascript
  const used = await tx.from(tablesOf(activity).score).select('audit_id', { count: 'exact', head: true }).eq('checklist_id', current.id);
  throwIf(used.error);
  const { error } = used.count
    ? await tx.from(tablesOf(activity).checklist).update({ status: 'Inactive' }).eq('id', current.id)
    : await tx.from(tablesOf(activity).checklist).delete().eq('id', current.id);
  ```
  แต่ในฐานข้อมูล ตาราง `tx_5s_issue` มี foreign key อ้างอิงมายัง `mt_5s_checklist.id` ด้วย:
  `checklist_id bigint not null references public.mt_${k}_checklist (id)` (โดยไม่มี `on delete cascade`)  
  หากหัวข้อนั้นเคยถูกเปิดเป็น Issue (เช่น ใบตรวจถูกลบไปแล้วทำให้ไม่มีใน `score` หรือคะแนนถูกเคลียร์) `used.count` จะเป็น 0 และโค้ดจะส่งคำสั่ง `DELETE` ไปยัง `mt_5s_checklist` ทำให้เกิด Database Constraint Error `23503 foreign key violation` เซิร์ฟเวอร์ตอบกลับ 500 พังทันที
- **ตัวอย่างที่ทำให้พัง**:  
  1. หัวข้อตรวจประเมินข้อที่ 5 มีแถวใน `tx_5s_issue`  
  2. แอดมินทดลองลบใบตรวจนั้นทิ้ง (ตาราง `tx_5s_audit_score` ของข้อนั้นว่างลง)  
  3. แอดมินไปที่หน้า Setting > หัวข้อตรวจประเมิน แล้วกดปุ่ม "ลบ" ข้อที่ 5  
  4. เซิร์ฟเวอร์ส่งคำสั่ง `DELETE FROM mt_5s_checklist WHERE id = ...` Postgres ปฏิเสธด้วย error 23503 หน้าเว็บแสดงข้อผิดพลาดสีแดงลบไม่สำเร็จ
- **วิธีแก้ที่เสนอ**:  
  ให้ตรวจสอบทั้งตารางคะแนนและตาราง Issue ร่วมกัน:
  ```javascript
  const [scoreUsed, issueUsed] = await Promise.all([
    tx.from(tablesOf(activity).score).select('audit_id', { count: 'exact', head: true }).eq('checklist_id', current.id),
    tx.from(tablesOf(activity).issue).select('id', { count: 'exact', head: true }).eq('checklist_id', current.id)
  ]);
  throwIf(scoreUsed.error, issueUsed.error);
  const isUsed = (scoreUsed.count || 0) > 0 || (issueUsed.count || 0) > 0;
  const { error } = isUsed
    ? await tx.from(tablesOf(activity).checklist).update({ status: 'Inactive' }).eq('id', current.id)
    : await tx.from(tablesOf(activity).checklist).delete().eq('id', current.id);
  ```
- **ความมั่นใจ**: ยืนยันแล้ว

---

### 4. [ร้ายแรงปานกลาง - Authorization] สิทธิ์การปรับเป้าหมายประจำปีของ 5S กว้างเกินไป
- **ไฟล์:บรรทัด**: [`server/modules/act/audit.js:618-621`](file:///C:/Work/projects/Activity/5S/server/modules/act/audit.js#L618-L621)
- **ปัญหาคืออะไร**:  
  ใน API ปรับเป้าหมายเปอร์เซ็นต์ผ่านเกณฑ์รายปี `PUT /api/act/:activity/target` มีเงื่อนไขการตรวจสอบสิทธิ์ดังนี้:
  ```javascript
  const access = await accessOf(req, activity, year);
  if (!access.admin && !access.chairman && !access.auditor && !access.member && !req.user?.creator) {
    return fail(res, 403, `ไม่มีสิทธิ์ปรับเป้าหมายของกิจกรรมนี้ปี ${year}`);
  }
  ```
  การอนุญาตให้ `access.auditor` (ผู้ตรวจประเมิน) และ `access.member` (สมาชิกทั่วไปหรือตัวแทนหน่วยงาน) สามารถปรับเปลี่ยนเป้าหมายได้ ขัดแย้งกับข้อกำหนดใน `AGENTS.md` (เป้าหมายระดับ Setting ของทั้งระบบต้องอนุญาตเฉพาะ Admin หรือ Chairman ประธานกิจกรรมเท่านั้น) ทำให้พนักงานทั่วไปที่มีชื่อเป็นสมาชิกในทีม 5S สามารถยิง API ปรับลดเกณฑ์ผ่านลงได้เองตามใจชอบ
- **ตัวอย่างที่ทำให้พัง**:  
  พนักงานที่อยู่ในบทบาท `auditor` หรือ `member` เปิด DevTools Console หรือยิง API request:  
  `PUT /api/act/5s/target` พร้อม body `{ year: 2026, self: 30, committee: 30 }`  
  ระบบยอมรับและอัปเดตค่า `pass_self:2026` และ `pass_committee:2026` ใน `mt_5s_setting` กลายเป็น 30% ทันที
- **วิธีแก้ที่เสนอ**:  
  ตัดสิทธิ์ `access.auditor` และ `access.member` ออกจากเงื่อนไข:
  ```javascript
  if (!access.admin && !access.chairman && !req.user?.creator) {
    return fail(res, 403, `ไม่มีสิทธิ์ปรับเป้าหมายของกิจกรรมนี้ปี ${year}`);
  }
  ```
- **ความมั่นใจ**: ยืนยันแล้ว

---

### 5. [ร้ายแรงปานกลาง - Async / Race Condition] ปุ่ม `popup-save` ไม่ปิดการทำงาน (Disable) ขณะบันทึก
- **ไฟล์:บรรทัด**: [`public/js/core.js:434`](file:///C:/Work/projects/Activity/5S/public/js/core.js#L434), [`public/js/core.js:439`](file:///C:/Work/projects/Activity/5S/public/js/core.js#L439), [`public/js/act-tx.js:276`](file:///C:/Work/projects/Activity/5S/public/js/act-tx.js#L276)
- **ปัญหาคืออะไร**:  
  ฟังก์ชัน `openPopup` และ `confirmPopup` ใน `core.js` ผูกอีเวนต์บันทึกดังนี้:
  ```javascript
  $('popup-save').onclick = () => Promise.resolve(onSave()).catch(onErr);
  ```
  ปุ่มไม่ได้ถูกตั้งค่า `disabled = true` ในระหว่างที่ `onSave()` กำลังทำงานแบบ asynchronous  
  ในหลายหน้า เช่น การบันทึกใบตรวจประเมิน 5S (`act-tx.js:276`) ฟังก์ชัน `onSave` จะทำการส่ง `POST /api/act/5s/audits` รอผลลัพธ์ จากนั้นวนลูปอัปโหลดรูปภาพ Issue ต่อเนื่อง ซึ่งใช้เวลา 1-3 วินาที หากผู้ใช้เผลอกดปุ่ม "บันทึก" ซ้ำๆ (Double-click) คำขอจะถูกยิงออกไปพร้อมกัน 2 ครั้ง
- **ตัวอย่างที่ทำให้พัง**:  
  ผู้ใช้คลิกปุ่มบันทึกผลตรวจในหน้า Transaction ซ้ำ 2 ครั้งอย่างรวดเร็ว:  
  1. คำขอที่ 1 สร้างใบตรวจ `C-A01-021126-01` สำเร็จ  
  2. คำขอที่ 2 รันพร้อมกัน แย่งคำนวณ `auditNo` ได้ชื่อเดียวกัน และเกิดข้อผิดพลาด Database Unique Constraint `23505` บน `audit_no` หน้าเว็บแจ้งเตือนสีแดงล้มเหลว หรือในบางกรณีอาจเกิด Issue และรูปภาพซ้ำซ้อน 2 ชุด
- **วิธีแก้ที่เสนอ**:  
  ใน `openPopup` (`public/js/core.js:434`) ให้ปิดการใช้งานปุ่มทันทีที่เริ่มรัน และคืนค่าเมื่อเสร็จสิ้น:
  ```javascript
  $('popup-save').onclick = async () => {
    const btn = $('popup-save');
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      await onSave();
    } catch (err) {
      btn.disabled = false;
      onErr(err);
    }
  };
  ```
- **ความมั่นใจ**: ยืนยันแล้ว

---

### 6. [ร้ายแรงปานกลาง - Logic / Auth] การเช็กสิทธิ์แอดมิน CFO ฟิกซ์ปีปัจจุบันของเซิร์ฟเวอร์ (`thisYear()`)
- **ไฟล์:บรรทัด**: [`server/modules/act/cfo.js:539`](file:///C:/Work/projects/Activity/5S/server/modules/act/cfo.js#L539), `639`, `723`, `731`, `741`, `750`, `763`
- **ปัญหาคืออะไร**:  
  ในโมดูล CFO ฟังก์ชันตรวจสอบสิทธิ์ผู้จัดทำ/แอดมินหลายจุดเรียกใช้ `requireAdmin(req, res, activity, thisYear())` โดยที่ `thisYear()` คือปีตามนาฬิกาของเครื่องเซิร์ฟเวอร์ (`new Date().getFullYear()`)  
  หากระบบเปลี่ยนผ่านเข้าสู่ปีใหม่ (เช่น ปี 2027) แต่ผู้ประสานงาน CFO กำลังทำงานสรุปข้อมูลย้อนหลังของปี 2026 หรือนำเข้า Usage ของเดือนธันวาคม 2026 สิทธิ์จะถูกตรวจสอบกับปี 2027 ใน `mt_cfo_team` ซึ่งยังไม่มีการสร้างหรือคัดลอกทีมงานของปี 2027 ส่งผลให้ผู้ประสานงานถูกปฏิเสธสิทธิ์ (403 Forbidden)
- **ตัวอย่างที่ทำให้พัง**:  
  ในวันที่ 2 มกราคม 2027 แอดมิน CFO ทำการนำเข้า SAP Material Usage ของเดือน 12/2026 (`POST /api/act/cfo/material-usage`) ฟังก์ชันจะเช็กสิทธิ์ `requireAdmin(req, res, 'cfo', 2027)` เนื่องจากตารางทีมปี 2027 ยังว่างเปล่า แอดมินจึงถูกปฏิเสธสิทธิ์และไม่สามารถบันทึกข้อมูลเดือน 12/2026 ได้
- **วิธีแก้ที่เสนอ**:  
  ดึงปีจากข้อมูลที่ส่งมาใน payload ก่อน:
  ```javascript
  const year = month ? Number(month.slice(0, 4)) : yearOf(req.body?.year) || thisYear();
  if (!(await requireAdmin(req, res, activity, year))) return;
  ```
- **ความมั่นใจ**: ยืนยันแล้ว

---

### 7. [ร้ายแรงปานกลาง - Logic / Input] ช่องกรอกวันที่ `DMY` แอบใช้ค่าวันที่เก่าเงียบๆ เมื่อพิมพ์ไม่ครบ
- **ไฟล์:บรรทัด**: [`public/js/core.js:742-747`](file:///C:/Work/projects/Activity/5S/public/js/core.js#L742-L747)
- **ปัญหาคืออะไร**:  
  ตัวจัดการแปลงรูปแบบวันที่ `DMY` ดักจับการพิมพ์ใน input box และมีบรรทัดตรวจสอบ:
  ```javascript
  const iso = toIso(text.value);
  text.classList.toggle('is-bad', text.value.length === 10 && !iso);
  if (!iso && text.value) return;
  valueOf.set.call(input, iso || '');
  ```
  เมื่อผู้ใช้พิมพ์วันที่ไม่ครบ (เช่น `15/03/` หรือลบปีออกเพื่อพิมพ์ใหม่) `iso` จะได้ค่า `null` ทำให้คำสั่ง `return;` ทำงานทันทีโดย**ไม่ไปอัปเดตค่าใน `input.value` ที่แท้จริง** ส่งผลให้ `input.value` ยังคงจำค่าวันที่เดิมก่อนแก้ไขอยู่  
  หากผู้ใช้กดปุ่มบันทึก ฟอร์มจะอ่านค่าวันที่เดิมไปส่งเซิร์ฟเวอร์โดยไม่มีข้อผิดพลาด และหากคลิกเมาส์ออกนอกช่อง (blur) ฟังก์ชัน `show()` จะรีเซ็ตข้อความบนหน้าจอกลับเป็นวันที่เดิมทันที
- **ตัวอย่างที่ทำให้พัง**:  
  ผู้ใช้เปิดฟอร์มแก้ไขรายการงานใน Project Planner วันที่เริ่มเดิมคือ `2026-03-01` ผู้ใช้ดับเบิลคลิกช่องวันที่แล้วพิมพ์ `15/03` แต่ยังไม่ได้พิมพ์ปี แล้วกด "บันทึก"  
  ระบบไม่ได้ส่งค่าว่างหรือขึ้นเตือน แต่ดึงค่า `input.value` เดิม (`2026-03-01`) ไปบันทึก ทำให้งานเริ่มในวันที่ผิดพลาดโดยผู้ใช้ไม่รู้ตัว
- **วิธีแก้ที่เสนอ**:  
  หากข้อความในช่องพิมพ์ไม่ใช่วันที่ที่ถูกต้อง ให้เคลียร์ค่า `input.value = ''` ทันที เพื่อให้การกดบันทึกติด validation `กรุณาระบุวันที่`:
  ```javascript
  valueOf.set.call(input, iso || '');
  ```
- **ความมั่นใจ**: ยืนยันแล้ว

---

### 8. [ร้ายแรงน้อย - UI Compliance] `fitTables` ไม่จำกัด `maxHeight` บนจอเตี้ย ดันหน้าจอให้มี scrollbar
- **ไฟล์:บรรทัด**: [`public/js/core.js:608`](file:///C:/Work/projects/Activity/5S/public/js/core.js#L608)
- **ปัญหาคืออะไร**:  
  ฟังก์ชันคำนวณความสูงตาราง `fitTables` มีเงื่อนไข:
  ```javascript
  const room = bottom - rect.top - after;
  if (room >= 240 && wrap.scrollHeight > room + 2) wrap.style.maxHeight = `${Math.floor(room)}px`;
  ```
  หากเปิดหน้าเว็บบนจอภาพขนาดเล็ก (เช่น โน้ตบุ๊กความสูง 768px, จอแนวตั้ง, หรือหน้าต่างที่เปิด Bookmark Bar / DevTools) พื้นที่ `room` ด้านล่างอาจเหลือประมาณ 180–230px เงื่อนไข `room >= 240` จะไม่เป็นจริง ทำให้ตารางไม่ถูกกำหนด `maxHeight`  
  ตารางจะขยายความสูงตามจำนวนแถว และดันโครงสร้าง `.view-body` ให้เกิด scrollbar ของหน้าต่างเบราว์เซอร์ภายนอก ซึ่งขัดกับกฎของระบบใน AGENTS.md ข้อ 100 ("ตารางหลักของหน้าเลื่อนในกรอบตารางเท่านั้น หน้าไม่มี scrollbar ของตัวเอง")
- **ตัวอย่างที่ทำให้พัง**:  
  เปิดหน้า `5S > Setting > หัวข้อตรวจประเมิน` หรือ `CFO > Transaction` บนจอความละเอียด 1366×768 พื้นที่ว่างใต้แถบตัวกรองเหลือ 215px ตารางจะไม่ถูกตัดให้อยู่ในกรอบ เกิด scrollbar ยาวที่ขอบขวาสุดของหน้าเว็บ
- **วิธีแก้ที่เสนอ**:  
  ปรับลดเกณฑ์ขั้นต่ำของ `room` ลงมา เช่น `room >= 120` หรือใช้ `Math.max(120, room)`:
  ```javascript
  if (room >= 120 && wrap.scrollHeight > room + 2) wrap.style.maxHeight = `${Math.floor(room)}px`;
  ```
- **ความมั่นใจ**: ยืนยันแล้ว

---

### 9. [ร้ายแรงน้อย - Robustness] `req.body` เสี่ยงเกิด `TypeError` หากไม่ส่ง Content-Type ใน Login
- **ไฟล์:บรรทัด**: [`server/core/auth.js:17`](file:///C:/Work/projects/Activity/5S/server/core/auth.js#L17), [`server/core/auth.js:38`](file:///C:/Work/projects/Activity/5S/server/core/auth.js#L38)
- **ปัญหาคืออะไร**:  
  ในเอนด์พอยต์ `POST /api/login` และ `POST /api/password`:
  ```javascript
  const employeeId = String(req.body.employeeId || '').trim();
  const password = String(req.body.password || '');
  ```
  หากมี client ยิงเข้ามาโดยไม่ระบุ Header `Content-Type: application/json` หรือส่งข้อมูล body ว่างเปล่า Express body-parser จะไม่ประมวลผล body ทำให้ `req.body` มีค่าเป็น `undefined` และการเข้าถึง `.employeeId` จะพ่น `TypeError: Cannot read properties of undefined` กลายเป็นข้อผิดพลาด 500 Uncaught Exception
- **ตัวอย่างที่ทำให้พัง**:  
  ทดสอบยิงคำขอ curl หรือ API health test:  
  `curl -X POST https://core-activity.onrender.com/api/login` (โดยไม่ใส่ Content-Type)  
  เซิร์ฟเวอร์จะ throw TypeError ทันทีแทนที่จะตอบกลับ 400 หรือ 401
- **วิธีแก้ที่เสนอ**:  
  ใช้ Optional chaining เพื่อความปลอดภัย:
  ```javascript
  const employeeId = String(req.body?.employeeId || '').trim();
  const password = String(req.body?.password || '');
  ```
- **ความมั่นใจ**: ยืนยันแล้ว

---

### 10. [ร้ายแรงน้อย - UI / Hover Tip] `OVERFLOW_TIP` ถูกยกเลิกเมื่อ element มี native `title`
- **ไฟล์:บรรทัด**: [`public/js/core.js:682`](file:///C:/Work/projects/Activity/5S/public/js/core.js#L682)
- **ปัญหาคืออะไร**:  
  ในฟังก์ชัน `clipped(el)` สำหรับตรวจจับข้อความยาวที่ถูกตัดด้วย `...` เพื่อแสดงกล่องลอยทันที มีบรรทัด:
  ```javascript
  if (node.title) return null;
  ```
  การใส่ `if (node.title) return null;` ในลูป จะทำให้หากผู้พัฒนาใส่ `title="..."` ไว้ที่ element หรือ child element ลูปจะหยุดค้นหาทันทีและคืนค่า `null` ส่งผลให้กล่องลอย `OVERFLOW_TIP` ไม่ทำงาน และหลุดไปแสดงผลผ่าน native tooltip ของเบราว์เซอร์ ซึ่งแสดงผลช้ากว่าและไม่สวยงาม
- **ตัวอย่างที่ทำให้พัง**:  
  ในตารางที่มีการใส่ `title` ดักไว้ เช่น `cfo-rev-detail`:  
  `<td class="cfo-rev-detail" title="${esc(r.detail)}">${esc(r.detail)}</td>`  
  หากมีการกำหนดโครงสร้างหรือ hover โดน child ที่มี title กล่อง tooltip ลอยจะไม่ขึ้นทันที แต่ต้องรอเบราว์เซอร์หน่วงเวลา 1-2 วินาที
- **วิธีแก้ที่เสนอ**:  
  ให้เก็บข้อความ `node.title` ไว้ใน `dataset.tip` แล้วลบ `title` ออกตามเจตนารมณ์ของโค้ดในบรรทัด 692 แทนการ `return null`
- **ความมั่นใจ**: น่าจะใช่

---

## สรุปข้อเสนอแนะในการปรับปรุง
1. **ความปลอดภัย:** แก้ไขจุด Stored XSS ใน `act-planner.js` และป้องกัน Race Condition ในปุ่มบันทึก Popup ของ `core.js` เป็นลำดับแรก
2. **ความสมบูรณ์ของสิทธิ์:** ปรับปรุงเงื่อนไข `access.member` ใน `smf.js` ให้ตรวจสอบตรงกับโครงการที่กำลังบันทึก และจำกัดสิทธิ์การปรับเป้าหมาย 5S ใน `audit.js` ให้เฉพาะ Admin / Chairman
3. **ความเสถียรของฐานข้อมูล:** เพิ่มการตรวจสอบ `tx_5s_issue` ก่อนลบหัวข้อตรวจประเมิน เพื่อป้องกัน Foreign Key Error
4. **ความเข้ากันได้ข้ามปี:** ปรับการเช็กสิทธิ์ CFO ใน `cfo.js` ให้ใช้ปีของข้อมูลจริงแทน `thisYear()` เพื่อความราบรื่นในการทำงานช่วงรอยต่อสิ้นปี

