# โมดูลเชื่อมโยง API ข้ามโปรเจกต์ (`server/integration/`)

> **สถานะ:** วางโครงสร้างเตรียมไว้ (Skeleton Only — ยังไม่ได้ mount เข้ากับ `server/app.js` และยังไม่เปิดใช้งานจริง)

## โครงสร้างโฟลเดอร์

```text
server/integration/
├── README.md                 # คู่มือโครงสร้างและการตั้งค่าเชื่อมโยง API
├── client.js                 # ตัวส่ง Request ข้ามเว็บ (รองรับ Render Cold-Start Timeout 65s + Retry)
├── middleware.js             # ตัวตรวจสอบ X-Api-Key สำหรับ Request ขาเข้าจากโปรเจกต์อื่น
├── master/                   # 1. ข้อมูลหลักกลาง (Master Data & SSO)
│   └── index.js              #    - /api/integration/v1/master/employees, costcenters, sso
├── kpi/                      # 2. ข้อมูลสรุป Dashboard / KPI ข้ามระบบ
│   └── index.js              #    - /api/integration/v1/kpi/summary
└── transactions/             # 3. การส่งรายการข้ามระบบ (Cross-System Transactions)
    └── index.js              #    - /api/integration/v1/transactions/sync
```

## ตัวแปร Environment (`.env`) ที่จะใช้เมื่อเปิดทำงานจริง

```ini
# รหัสลับสำหรับยืนยันตัวตนระหว่างโปรเจกต์ (Header: X-Api-Key)
INTEGRATION_API_KEY=

# URL ของแต่ละโปรเจกต์ในระบบ (Render Account 1 & Account 2)
STORE_API_URL=https://tsat4-smf.onrender.com
PLANNING_API_URL=https://tsat4-planning.onrender.com
ACTIVITY_API_URL=https://core-activity.onrender.com
```
