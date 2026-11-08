// Skeleton: ตัวตรวจสอบสิทธิ์ระหว่างเซิร์ฟเวอร์ (Server-to-Server API Key Guard)
// สถานะ: วางโครงไว้สำหรับอนาคต ยังไม่ได้ผูกเข้ากับ Express app

export function requireIntegrationKey(req, res, next) {
  // TODO: เปิดตรวจ Header 'x-api-key' เทียบกับ process.env.INTEGRATION_API_KEY เมื่อเปิดใช้งานจริง
  const expectedKey = process.env.INTEGRATION_API_KEY;
  const providedKey = req.headers['x-api-key'];
  if (!expectedKey || providedKey !== expectedKey) {
    return res.status(401).json({ error: 'INVALID_INTEGRATION_KEY' });
  }
  return next();
}
