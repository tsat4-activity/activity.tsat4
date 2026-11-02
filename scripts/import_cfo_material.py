"""SAP materials (Store usage list) -> inbox/import_cfo_material.sql for mt_cfo_material (CFO Scope 3 วัสดุ).

    python -I scripts/import_cfo_material.py "C:/Work/projects/Activity/CFO/inbox/Usage.xlsx"

Sheet "usage" / "Usage": material · material_description · bun or unit (SAP unit) · price · status. Only the list is loaded;
the EF and the unit factor are matched later in Setting > วัสดุ (SAP). Re-running keeps that matching (on conflict
updates name / unit / price only). The file stays in inbox/ (company data, not in git). spec: docs/specs/act-cfo.md
"""
import sys
import warnings
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent


def lit(v):
    if v is None:
        return 'null'
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return str(int(v)) if float(v).is_integer() else repr(float(v))
    return "'" + str(v).replace("'", "''") + "'"


def main(book_path):
    warnings.simplefilter('ignore')
    book = openpyxl.load_workbook(book_path, read_only=True, data_only=True)
    ws = next(w for w in book.worksheets if w.title.lower() == 'usage')
    rows = ws.iter_rows(values_only=True)
    head = [str(h or '').strip().lower() for h in next(rows)]
    col = {name: head.index(name) for name in ('material', 'material_description', 'price', 'status')}
    col['bun'] = head.index('bun') if 'bun' in head else head.index('unit')
    seen, values = set(), []
    for r in rows:
        code = str(r[col['material']] or '').strip().removesuffix('.0').lstrip('0') or None
        if not code or code in seen:
            continue
        seen.add(code)
        name = ' '.join(str(r[col['material_description']] or code).split())
        price = r[col['price']] if isinstance(r[col['price']], (int, float)) else None
        status = 'Inactive' if str(r[col['status']] or '').strip().lower() == 'inactive' else 'Active'  # Usage sheet: Short / Over = stock status, still Active
        values.append(f"  ({lit(code)}, {lit(name)}, {lit(str(r[col['bun']] or '').strip() or None)}, {lit(price)}, {lit(status)})")
    out = ['-- CFO วัสดุจาก SAP (master_sto.xlsx แผ่น usage) · สร้างจาก scripts/import_cfo_material.py · รันใน Tx Data หลัง db/act/cfo.sql · รันซ้ำได้',
           f'-- {len(values)} รายการ · รันซ้ำแก้เฉพาะชื่อ หน่วย ราคา (EF และตัวแปลงที่จับคู่ไว้ไม่หาย)',
           'insert into public.mt_cfo_material (material, name, sap_unit, price, status) values',
           ',\n'.join(values),
           'on conflict (material) do update set name = excluded.name, sap_unit = excluded.sap_unit, price = excluded.price;', '']
    target = ROOT / 'inbox' / 'import_cfo_material.sql'
    target.write_text('\n'.join(out), encoding='utf-8', newline='\n')
    print(f'{target.relative_to(ROOT)} written ({len(values)} materials)')
    # sheet Costcenter (costcenter · objectname · group · section · status): section = mt_main_costcenter.department,
    # which turns the Usage cost center into the section it is measured by
    sheet = next((w for w in book.worksheets if w.title.lower() == 'costcenter'), None)
    if sheet is None:
        return
    it = sheet.iter_rows(values_only=True)
    h = [str(x or '').strip().lower() for x in next(it)]
    centers = []
    for r in it:
        code = str(r[h.index('costcenter')] or '').strip().removesuffix('.0')
        if not code:
            continue
        group = str(r[h.index('group')] or 'Factory').strip().title()
        status = 'Inactive' if str(r[h.index('status')] or '').strip().lower() == 'inactive' else 'Active'
        centers.append(f"  ({lit(code)}, {lit(str(r[h.index('objectname')] or code).strip())}, {lit(group if group in ('Factory', 'Non', 'Center') else 'Factory')}, {lit(str(r[h.index('section')] or '').strip())}, {lit(status)})")
    cc = ROOT / 'inbox' / 'import_costcenter.sql'
    cc.write_text('\n'.join(['-- Cost center → Section จาก Usage.xlsx แผ่น Costcenter (scripts/import_cfo_material.py) · รันใน Mx Data (activity01) · รันซ้ำได้',
                              'insert into public.mt_main_costcenter (costcenter, object_name, group_name, department, status) values', ',\n'.join(centers),
                              'on conflict (costcenter) do update set object_name = excluded.object_name, group_name = excluded.group_name, department = excluded.department, status = excluded.status;', '']),
                  encoding='utf-8', newline='\n')
    print(f'{cc.relative_to(ROOT)} written ({len(centers)} cost centers)')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'inbox' / 'master_sto.xlsx')
