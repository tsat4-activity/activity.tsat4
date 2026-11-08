// Skeleton: ตัวส่งคำขอ API ข้ามโปรเจกต์ (Cross-Project API Client)
// สถานะ: วางโครงไว้สำหรับอนาคต ยังไม่ได้เรียกใช้งานจริง
// ออกแบบรองรับ Render แผนฟรี (ตั้ง Timeout 65 วินาทีเผื่อเครื่องตื่นจากโหมดหลับ และลองใหม่อัตโนมัติ)

const DEFAULT_TIMEOUT_MS = 65_000;
const DEFAULT_RETRIES = 2;

export const SERVICE_URLS = {
  store: process.env.STORE_API_URL || '',
  planning: process.env.PLANNING_API_URL || '',
  activity: process.env.ACTIVITY_API_URL || ''
};

export async function callServiceApi(serviceName, endpointPath, options = {}) {
  // TODO: เปิดใช้งานจริงเมื่อเชื่อมต่อ API ระหว่างโปรเจกต์
  const baseUrl = SERVICE_URLS[serviceName];
  if (!baseUrl) {
    return { ok: false, implemented: false, serviceName, endpointPath, timeoutMs: DEFAULT_TIMEOUT_MS, retries: DEFAULT_RETRIES, options };
  }
  return { ok: false, implemented: false, url: `${baseUrl}${endpointPath}` };
}
