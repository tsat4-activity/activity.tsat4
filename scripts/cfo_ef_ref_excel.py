"""EF reference tables of CFO from the TGO workbook -> db/act/cfo_ef_ref_seed.sql (mt_cfo_ef_ref + GWP AR5).

    python -I scripts/cfo_ef_ref_excel.py "C:/Work/projects/Store/inbox/Verify sheet TGO.xlsx"

Sheet "EF TGO AR5 V2": GWP (row 8), EF for energy consumption per unit (rows 15-159), common chemical GWP
(rows 164-175), EF from IPCC Guidelines per TJ (rows 188-234) and fuel properties: heating value, density and
conversion factors (rows 237-269). The seed fills a table only while it is empty,
so rows edited in Setting > Emission Factor are never overwritten. spec: docs/specs/act-cfo.md
"""
import sys
import warnings
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
SHEETS = [('energy', 15, 159), ('chemical', 164, 175), ('ipcc', 188, 234), ('fuel', 237, 269)]
# fuel: a header row (Unit in column E) starts each part; its column D names the value
FUEL_PARTS = {'Heating value': 'Heating value', 'Density': 'Density', 'Factor': 'Conversion Factor'}
NUMERIC = {c: 'numeric' for c in ('co2', 'ch4_fossil', 'ch4', 'n2o', 'total', 'ratio')} | {'sort_no': 'integer'}


def num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def txt(v):
    if v is None:
        return None
    s = ' '.join(str(v).split())
    return s or None


def lit(v):
    if v is None:
        return 'null'
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() else f'{v:.12g}'  # 12 digits: drops float noise (1.0200000000000001e-07)
    if isinstance(v, int):
        return str(v)
    return "'" + v.replace("'", "''") + "'"


def main(book_path):
    warnings.simplefilter('ignore')
    ws = openpyxl.load_workbook(book_path, read_only=True, data_only=True)['EF TGO AR5 V2']
    rows = {i: r for i, r in enumerate(ws.iter_rows(min_row=1, max_row=275, values_only=True), start=1)}
    g = rows[8]
    out = ['-- CFO: ตารางอ้างอิง Emission Factor (แผ่น EF TGO AR5 V2) · สร้างจาก scripts/cfo_ef_ref_excel.py ห้ามแก้มือ',
           '-- รันใน Tx Data หลัง db/act/cfo.sql · รันซ้ำได้: เติมเฉพาะตารางที่ยังว่าง ไม่ทับค่าที่แก้ใน Setting', '',
           'insert into public.mt_cfo_gwp (code, co2, ch4_fossil, ch4, n2o, sf6, nf3, reference) values',
           f"  ('AR5', {g[2]}, {g[3]}, {g[4]}, {g[5]}, 23500, 16100, {lit(txt(rows[7][6]).replace('Ref.: ', ''))})",
           'on conflict (code) do nothing;', '']
    cols = ['sheet', 'grp', 'name', 'formula', 'unit', 'co2', 'ch4_fossil', 'ch4', 'n2o', 'total', 'ratio', 'reference', 'remark', 'sort_no']
    for sheet, first, last in SHEETS:
        values, grp = [], None
        for i in range(first, last + 1):
            r = rows[i]
            if sheet == 'fuel':
                if txt(r[4]) == 'Unit':
                    grp = FUEL_PARTS.get(txt(r[3]), txt(r[3]))
                elif num(r[3]) is not None:
                    values.append([sheet, grp, txt(r[1]).rstrip(':').strip(), None, txt(r[4]), None, None, None, None, num(r[3]), None, txt(r[5]), None, len(values) + 1])
                continue
            name = txt(r[2])
            if not name:
                continue
            grp = txt(r[1]) or grp
            gas = [num(r[k]) for k in (5, 6, 7, 8)]
            total = num(r[9])
            unit = txt(r[4])
            if sheet == 'ipcc':
                unit = 'TJ' if gas[0] is not None else None
            if not unit and all(v is None for v in gas):
                total = None  # heading row (e.g. On-road vehicles)
            remark = ' · '.join(x for x in (txt(r[13]), txt(r[14])) if x) or None
            values.append([sheet, grp, name, None, unit, *gas, total, num(r[12]), txt(r[10]), remark, len(values) + 1])
        out.append(f'-- {sheet}: {len(values)} แถว')
        out.append(f'insert into public.mt_cfo_ef_ref ({", ".join(cols)})')
        picks = ', '.join(f'v.{c}::{NUMERIC.get(c, "text")}' for c in cols)
        out.append(f'select {picks} from (values')
        out.append(',\n'.join('  (' + ', '.join(lit(v) for v in row) + ')' for row in values))
        out.append(f') as v ({", ".join(cols)})')
        out.append(f"where not exists (select 1 from public.mt_cfo_ef_ref where sheet = '{sheet}');")
        out.append('')
    # ids CFO-0001 … of EF พลังงาน + GWP สารเคมี (the same update as db/act/cfo.sql, for a database seeded after it)
    out.append("""-- id ของ EF ตามเอกสาร อบก. "ค่าการปล่อยก๊าซเรือนกระจก ... คาร์บอนฟุตพริ้นท์ขององค์กร" (ผู้ใช้กำหนด 2026-11-02): EF พลังงาน แล้ว GWP สารเคมี
-- เรียงตามเอกสาร CFO-0001 … · เฉพาะแถวที่มีหน่วยและค่า (หัวข้อไม่มี id) · แถวใหม่ต่อเลขเดิม
update public.mt_cfo_ef_ref r set code = 'CFO-' || lpad((x.n + x.base)::text, 4, '0')
from (select id, row_number() over (order by case sheet when 'energy' then 1 else 2 end, sort_no, id) as n,
        coalesce((select max(substring(code from 5)::int) from public.mt_cfo_ef_ref where code ~ '^CFO-[0-9]+$'), 0) as base
      from public.mt_cfo_ef_ref where sheet in ('energy', 'chemical') and code is null and unit is not null and total is not null) x
where r.id = x.id;
""")
    target = ROOT / 'db' / 'act' / 'cfo_ef_ref_seed.sql'
    target.write_text('\n'.join(out), encoding='utf-8', newline='\n')
    print(f'{target.relative_to(ROOT)} written')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'inbox' / 'Verify sheet TGO.xlsx')
