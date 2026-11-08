// Skeleton หมวดที่ 3: การส่งรายการข้ามระบบ (Cross-System Transactions)
// สถานะ: วางโครงไว้สำหรับอนาคต ยังไม่ได้ mount เข้ากับ server/app.js
//
// แนวทางเมื่อเปิดใช้งานจริง:
// - POST /api/integration/v1/transactions/sync
//   รับ-ส่งรายการธุรกรรมที่อนุมัติแล้วข้ามระบบ เช่น:
//   1. Store ส่งยอดเบิกจ่ายวัสดุ/สารเคมีรายเดือน -> เข้าสู่ CFO (Scope 3 Materials)
//   2. Store / Activity ส่งสถานะงานหรือคำขอ -> เข้าสู่ระบบ Planning

export function mountTransactionIntegration(/* app */) {
  // TODO: เปิด route เมื่อพร้อมรับ-ส่งรายการธุรกรรมข้ามระบบ
}
