"""Past monthly CFO records (tx_detail.xlsx: tx_scope1 / tx_scope2 / tx_scope3) -> inbox/import_cfo_tx.sql for tx_cfo_entry.

    python -I scripts/import_cfo_tx.py "C:/Work/projects/Activity/CFO/inbox/tx_detail.xlsx"

Each row goes to the activity we set up (ผู้ใช้กำหนด 2026-11-03): the activity whose code is the ac_id, else the same
หน่วยงาน + ชื่อกิจกรรม + รายละเอียด (the detail in the system may go on after " · "). The entry takes the activity's
EF of now (not the old source_id: an executive car moved to 3-6 stays there) and its 3-3 EF (ef3_id), so the old
records also count การได้มาของเชื้อเพลิง / ไฟฟ้า, which the old sheet did not. tCO2e is not imported: v_cfo_entry
computes it. A month already in the system is replaced unless it is CONFIRMED. Safe to re-run.
"""
import sys
import warnings
from datetime import date, datetime
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent


def lit(v):
    if v is None or v == '':
        return 'null'
    if isinstance(v, (int, float)):
        return repr(round(float(v), 6))
    return "'" + str(v).replace("'", "''") + "'"


def month_of(v):
    if isinstance(v, (datetime, date)):
        return f'{v.year}-{v.month:02d}-01'
    text = str(v or '').strip()
    return f'{text[:7]}-01' if len(text) >= 7 and text[4] == '-' else None


def main(path):
    warnings.simplefilter('ignore')
    book = openpyxl.load_workbook(path, read_only=True, data_only=True)
    rows, skipped = [], 0
    for name in ('tx_scope1', 'tx_scope2', 'tx_scope3'):
        if name not in book.sheetnames:
            continue
        data = [r for r in book[name].iter_rows(values_only=True) if any(c not in (None, '') for c in r)]
        if not data:
            continue
        head = [str(c or '').strip() for c in data[0]]
        col = {k: head.index(k) for k in ('ac_id', 'month/year', 'department_id', 'activity_name', 'description', 'activity_quantity') if k in head}
        st = head.index('status') if 'status' in head else None
        rm = head.index('remark') if 'remark' in head else None
        for r in data[1:]:
            month = month_of(r[col['month/year']])
            try:
                qty = float(str(r[col['activity_quantity']]).replace(',', ''))
            except (TypeError, ValueError):
                skipped += 1
                continue
            if not month or qty < 0:
                skipped += 1
                continue
            status = 'CONFIRMED' if st is not None and str(r[st] or '').upper() == 'CONFIRMED' else 'DRAFT'
            rows.append((name, r[col['ac_id']], month, str(r[col['department_id']] or '').strip(), str(r[col['activity_name']] or '').strip(),
                         ' '.join(str(r[col['description']] or '').split()), qty, status, r[rm] if rm is not None else None))
    values = ',\n'.join('  (' + ', '.join(lit(x) for x in row) + ')' for row in rows)
    sql = f"""-- ข้อมูลย้อนหลัง tx_detail.xlsx → tx_cfo_entry · scripts/import_cfo_tx.py · ผู้ใช้กำหนด 2026-11-03 · {len(rows)} แถว
-- รันใน activity01 หลัง db/act/cfo.sql · รันซ้ำได้ · ใช้ EF ปัจจุบันของกิจกรรม + EF 3-3 (ef3_id) → Fr-04.1 คิด 3-3 ให้ข้อมูลเก่าด้วย
-- (กิจกรรมที่ยังไม่มี 3-3 ระบบเติมให้เองเมื่อ admin เปิด Setting / Dashboard และเติมให้รายการเก่าด้วย)
begin;
-- temp tables live for the session (not on commit drop): the checks at the end read them after commit
drop table if exists old_tx, old_map;
create temp table old_tx (sheet text, ac text, month date, department text, name text, detail text, qty numeric, status text, remark text);
insert into old_tx values
{values};

-- กิจกรรมของแต่ละแถว: รหัส ac_id ก่อน แล้วหน่วยงาน + ชื่อ + รายละเอียด (รายละเอียดในระบบอาจต่อด้วย " · ...")
create temp table old_map as
select distinct on (o.ac, o.department, o.name, o.detail) o.ac, o.department, o.name, o.detail, a.id as activity_id
from (select distinct ac, department, name, detail from old_tx) o
join public.mt_cfo_activity a on a.code = o.ac
  or (lower(trim(a.department)) = lower(o.department) and trim(a.name) = o.name
      and (regexp_replace(coalesce(a.detail, ''), '\\s+', ' ', 'g') = o.detail or regexp_replace(coalesce(a.detail, ''), '\\s+', ' ', 'g') like o.detail || ' ·%'))
order by o.ac, o.department, o.name, o.detail, (a.code = o.ac) desc, (a.status = 'Active') desc, a.id;

insert into public.tx_cfo_entry (activity_id, month, qty, ef_id, ef3_id, gwp_code, status, remark, created_by)
select a.id, t.month, t.qty, a.ef_id, a.ef3_id, a.gwp_code, t.status, t.remark, 'import'
from old_tx t
join old_map m on m.ac is not distinct from t.ac and m.department = t.department and m.name = t.name and m.detail = t.detail
join public.mt_cfo_activity a on a.id = m.activity_id
on conflict (activity_id, month) do update set qty = excluded.qty, ef_id = excluded.ef_id, ef3_id = coalesce(excluded.ef3_id, public.tx_cfo_entry.ef3_id),
  gwp_code = excluded.gwp_code, remark = coalesce(excluded.remark, public.tx_cfo_entry.remark), updated_by = 'import', updated_at = now()
where public.tx_cfo_entry.status <> 'CONFIRMED';
commit;

-- ตรวจ: แถวที่ไม่พบกิจกรรม (ต้องสร้างกิจกรรมก่อน) · จำนวนต่อปี / Scope · tCO2e ที่คิดได้ รวม 3-3
select t.sheet, t.ac, t.department, t.name, t.detail, count(*) as months from old_tx t
where not exists (select 1 from old_map m where m.ac is not distinct from t.ac and m.department = t.department and m.name = t.name and m.detail = t.detail)
group by 1, 2, 3, 4, 5 order by 1, 3, 4;
select extract(year from month)::int as year, scope_code, round(sum(tco2e), 3) as tco2e, count(*) as rows
from public.v_cfo_entry where month >= '2025-01-01' group by 1, 2 order by 1, 2;
"""
    target = ROOT / 'inbox' / 'import_cfo_tx.sql'
    target.write_text(sql, encoding='utf-8', newline='\n')
    sys.stdout.reconfigure(encoding='utf-8')
    print(f'{target.relative_to(ROOT)} · {len(rows)} แถว · ข้าม {skipped}')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'C:/Work/projects/Activity/CFO/inbox/tx_detail.xlsx')
