// Skeleton หมวดที่ 1: เชื่อมโยงข้อมูลหลักกลาง (Master Data: พนักงาน, แผนก/Cost Center, และสิทธิ์ SSO)
// สถานะ: วางโครงไว้สำหรับอนาคต ยังไม่ได้ mount เข้ากับ server/app.js
//
// แนวทางเมื่อเปิดใช้งานจริง:
// - GET  /api/integration/v1/master/employees    ดึงรายชื่อพนักงานที่ Active
// - GET  /api/integration/v1/master/costcenters  ดึงรหัส Cost Center และชื่อแผนก
// - POST /api/integration/v1/master/sso-verify   ตรวจสอบ Token เพื่อ Login ข้ามโปรเจกต์โดยไม่ต้องกรอกรหัสซ้ำ

export function mountMasterIntegration(/* app */) {
  // TODO: เปิด route เมื่อพร้อมเชื่อมข้อมูลหลักระหว่าง Store, Planning, Activity และโปรเจกต์ใหม่
}
