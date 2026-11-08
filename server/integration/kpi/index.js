// Skeleton หมวดที่ 2: เชื่อมโยงข้อมูลสรุป Dashboard / KPI ข้ามระบบ
// สถานะ: วางโครงไว้สำหรับอนาคต ยังไม่ได้ mount เข้ากับ server/app.js
//
// แนวทางเมื่อเปิดใช้งานจริง:
// - GET /api/integration/v1/kpi/summary?year=YYYY&month=MM
//   ส่งค่าสรุป KPI ของโปรเจกต์นี้ (เช่น % 5S, ยอดคาร์บอน CFO, ความคืบหน้า SMF, ยอดเบิกจ่าย Store, แผนงาน Planning)
//   เพื่อให้หน้า Dashboard ภาพรวมดึงไปแสดงผลได้โดยมี In-Memory Cache ลดการปลุกเครื่องบ่อย

export function mountKpiIntegration(/* app */) {
  // TODO: เปิด route เมื่อพร้อมแสดงผล Dashboard ภาพรวมข้ามโปรเจกต์
}
