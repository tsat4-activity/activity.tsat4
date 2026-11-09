// Remove stored photos / files when their row is deleted or the photo is replaced (ผู้ใช้กำหนด 2026-11-09: ไม่ให้ไฟล์ค้างกินพื้นที่).
// Takes public links (getPublicUrl) and removes only those inside the given bucket; other links are left alone.
// Best effort: a failed clean-up is logged and never fails the request that deleted the data.
const MARK = '/storage/v1/object/public/';

export function storagePath(url, bucket) {
  const text = String(url || '');
  const head = `${MARK}${bucket}/`;
  const at = text.indexOf(head);
  if (at < 0) return '';
  try {
    return decodeURIComponent(text.slice(at + head.length).split(/[?#]/)[0]);
  } catch {
    return '';
  }
}

export async function dropFiles(client, bucket, urls) {
  const paths = [...new Set([urls].flat(3).map((url) => storagePath(url, bucket)).filter(Boolean))];
  if (!client || !bucket || !paths.length) return 0;
  let removed = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const part = paths.slice(i, i + 100);
    try {
      const { error } = await client.storage.from(bucket).remove(part);
      if (error) console.warn(`[storage] remove ${bucket}: ${error.message}`);
      else removed += part.length;
    } catch (err) {
      console.warn(`[storage] remove ${bucket}: ${err.message}`);
    }
  }
  return removed;
}
