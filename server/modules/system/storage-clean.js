// System > Setting > ล้างไฟล์ค้าง (ผู้ใช้กำหนด 2026-11-09): files left in Storage by deletes made before core/storage.js
// cleaned up after itself. Only folders whose links are all known are checked; a file counts as left over when no row
// links to it and it is older than a day (an upload still being saved is never touched). A folder whose links cannot
// be read (table missing, error) is skipped, never emptied.
import { mx, tx } from '../../core/db.js';
import { dropFiles, storagePath } from '../../core/storage.js';
import { ACTIVITIES, tablesOf } from '../act/common.js';

const PHOTO_BUCKET = 'img_main';
const DAY = 24 * 3600 * 1000;
const PAGE = 1000;

async function rowsOf(client, table, columns) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}

// Every file under prefix (folders opened), as { path, size, at }.
async function filesOf(client, bucket, prefix) {
  const out = [];
  const walk = async (dir) => {
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await client.storage.from(bucket).list(dir, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
      if (error) throw error;
      for (const item of data || []) {
        const path = `${dir}/${item.name}`;
        if (item.id == null) await walk(path); // a folder
        else out.push({ path, size: Number(item.metadata?.size) || 0, at: Date.parse(item.created_at || item.updated_at || '') || 0 });
      }
      if (!data || data.length < PAGE) return;
    }
  };
  await walk(prefix.replace(/\/$/, ''));
  return out;
}

// [{ client, bucket, prefix, refs: () => links or paths still in use }]
function sourcesOf(tables) {
  const list = [];
  for (const [name, spec] of Object.entries(tables)) {
    const cols = spec.columns.filter(([, type]) => type === 'photo' || type === 'logo').map(([column]) => column);
    if (!cols.length) continue;
    const client = spec.db === 'tx' ? tx : mx;
    list.push({ client, bucket: PHOTO_BUCKET, prefix: `${name}/`, refs: async () => (await rowsOf(client, name, cols.join(','))).flatMap((r) => cols.map((c) => r[c])) });
  }
  for (const activity of ACTIVITIES) {
    const t = tablesOf(activity);
    const settings = async (test) => (await rowsOf(tx, t.setting, 'key,value')).filter((r) => test(r.key));
    list.push({ client: tx, bucket: t.bucket, prefix: 'issue/', refs: async () => (await rowsOf(tx, t.issue, 'photo_before,photo_after')).flatMap((r) => [...(r.photo_before || []), ...(r.photo_after || [])]) });
    list.push({ client: tx, bucket: t.bucket, prefix: 'intro/', refs: async () => (await settings((k) => /^intro_\d{4}$/.test(k))).flatMap((r) => {
      const pages = JSON.parse(r.value || '[]');
      return (Array.isArray(pages) ? pages : []).flatMap((p) => [p?.path, p?.url]);
    }) });
    if (activity === 'cfo') {
      list.push({ client: tx, bucket: t.bucket, prefix: 'evidence/', refs: async () => (await rowsOf(tx, t.entry, 'doc')).map((r) => r.doc) });
      list.push({ client: tx, bucket: t.bucket, prefix: 'company/', refs: async () => {
        const fromSettings = (await settings((k) => k.startsWith('company_photo'))).map((r) => r.value);
        const { data } = mx ? await mx.from('mt_main_company').select('photo1,photo2').eq('id', 'main').maybeSingle() : { data: null };
        return [...fromSettings, data?.photo1, data?.photo2];
      } });
    }
  }
  list.push({ client: tx, bucket: 'img_smf', prefix: 'workflow/', refs: async () => (await rowsOf(tx, 'automation_images', 'image_url')).map((r) => r.image_url) });
  return list;
}

// { folders: [{ bucket, prefix, files, bytes, left, leftBytes, error? }], left, leftBytes, removed? }
export async function storageOrphans(tables, { remove = false } = {}) {
  const now = Date.now();
  const folders = [];
  for (const src of sourcesOf(tables)) {
    const row = { bucket: src.bucket, prefix: src.prefix, files: 0, bytes: 0, left: 0, leftBytes: 0 };
    folders.push(row);
    if (!src.client) { row.error = 'ไม่มีการเชื่อมฐานข้อมูล'; continue; }
    try {
      const files = await filesOf(src.client, src.bucket, src.prefix);
      row.files = files.length;
      row.bytes = files.reduce((n, f) => n + f.size, 0);
      if (!files.length) continue;
      const used = new Set((await src.refs()).map((v) => (String(v || '').includes('/storage/v1/') ? storagePath(v, src.bucket) : String(v || ''))).filter(Boolean));
      const left = files.filter((f) => !used.has(f.path) && f.at && now - f.at > DAY);
      row.left = left.length;
      row.leftBytes = left.reduce((n, f) => n + f.size, 0);
      if (remove && left.length) {
        const urls = left.map((f) => src.client.storage.from(src.bucket).getPublicUrl(f.path).data.publicUrl);
        row.removed = await dropFiles(src.client, src.bucket, urls);
      }
    } catch (err) {
      row.error = /not found|does not exist|PGRST205/i.test(String(err.message)) ? 'ยังไม่มีที่เก็บ / ตาราง' : String(err.message || err);
      row.left = 0;
      row.leftBytes = 0;
    }
  }
  const sum = (key) => folders.reduce((n, f) => n + (f[key] || 0), 0);
  return { folders, left: sum('left'), leftBytes: sum('leftBytes'), bytes: sum('bytes'), ...(remove ? { removed: sum('removed') } : {}) };
}
