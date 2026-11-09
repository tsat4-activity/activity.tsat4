"""Workbook 7xxxxx 01-31.10 Rev.01.xlsx (sheets cfp + cal_ef) -> SQL for Supabase (activity01), ผู้ใช้กำหนด 2026-11-09.

    python -I scripts/import_cfo_usage_ef.py "C:/Work/projects/Activity/CFO/inbox/7xxxxx 01-31.10 Rev.01.xlsx"

Writes inbox/import_cfo_usage_ef.sql (not in git), run after db/act/cfo.sql:
1) sheet cfp    -> mt_cfo_ef_ref (sheet cfp): the EF Std rows whose id (CFP-0726 …) is not there yet
2) sheet cal_ef -> mt_cfo_usage_ef: Id_usage (sheet usage_ef column Id_usage, else Usage-0001 … in sheet order) ·
   Id_cfp → ref_id · group · material · material_description · bun · kgCO₂e/unit = usage_ef. Same material = updated.
Safe to re-run. Ends with checks: Id_cfp not found, and ids already used by another EF name.
"""
import sys
import warnings
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent


def q(v):
    if v is None or (isinstance(v, str) and not v.strip()):
        return 'null'
    if isinstance(v, (int, float)):
        return repr(float(v)) if isinstance(v, float) else str(v)
    return "'" + str(v).strip().replace("'", "''") + "'"


def rows_of(ws):
    rows = [r for r in ws.iter_rows(values_only=True) if any(c is not None and str(c).strip() for c in r)]
    head = [str(c or '').strip().lower().replace('₂', '2').replace(' ', '') for c in rows[0]]
    return head, rows[1:]


def main(path):
    warnings.filterwarnings('ignore')
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    out = ['-- EF CFP (ชีต cfp) + usage_ef (ชีต usage_ef / cal_ef) จาก ' + Path(path).name + ' · scripts/import_cfo_usage_ef.py · ผู้ใช้กำหนด 2026-11-09',
           '-- รันใน activity01 หลัง db/act/cfo.sql · รันซ้ำได้ · ท้ายไฟล์มีตารางตรวจ (ควรว่าง)', 'begin;', '']

    # 1) EF CFP
    head, rows = rows_of(wb['cfp'])
    at = lambda *k: next((head.index(x) for x in k if x in head), -1)
    c = {'code': at('id'), 'grp': at('กลุ่ม'), 'item': at('ลำดับ'), 'name': at('ชื่อ'), 'formula': at('รายละเอียด'), 'unit': at('หน่วย'),
         'total': next((i for i, h in enumerate(head) if h.startswith('ค่าแฟคเตอร์')), -1), 'ref': at('ข้อมูลอ้างอิง'), 'remark': at('วันที่อัพเดท')}
    cfp = [r for r in rows if r[c['code']] and r[c['name']]]
    get = lambda r, k: r[c[k]] if c[k] >= 0 else None
    out += ['-- 1) EF CFP ' + str(len(cfp)) + ' รายการ: เพิ่มเฉพาะ id ที่ยังไม่มี',
            'create temp table x_cfp (code text, grp text, item_no text, name text, formula text, unit text, total numeric, reference text, remark text) on commit drop;',
            'insert into x_cfp values']
    out.append(',\n'.join(f"  ({q(get(r, 'code'))}, {q(get(r, 'grp'))}, {q(get(r, 'item'))}, {q(get(r, 'name'))}, {q(get(r, 'formula'))}, {q(get(r, 'unit'))}, "
                          f"{q(get(r, 'total'))}, {q(get(r, 'ref'))}, {q(get(r, 'remark'))})" for r in cfp) + ';')
    out += ['insert into public.mt_cfo_ef_ref (sheet, code, grp, item_no, name, formula, unit, total, reference, remark, sort_no, status)',
            "select 'cfp', x.code, x.grp, x.item_no, x.name, x.formula, x.unit, x.total, x.reference, x.remark,",
            "  100000 + coalesce((select max(sort_no) - 100000 from public.mt_cfo_ef_ref where sheet = 'cfp' and sort_no >= 100000), 0) + row_number() over (order by x.code), 'Active'",
            'from x_cfp x where not exists (select 1 from public.mt_cfo_ef_ref r where upper(r.code) = upper(x.code));', '']

    # 2) usage_ef
    sheet = 'usage_ef' if 'usage_ef' in wb.sheetnames else 'cal_ef'
    head, rows = rows_of(wb[sheet])
    at = lambda *k: next((head.index(x) for x in k if x in head), -1)
    c = {'id': at('id_usage', 'idusage'), 'ref': at('id_cfp', 'idcfp'), 'grp': at('group', 'กลุ่ม'), 'mat': at('material'), 'name': at('material_description', 'ชื่อ'),
         'unit': at('bun', 'eun', 'unit'), 'ef': next((i for i, h in enumerate(head) if h.startswith('kgco2e') or h == 'usage_ef'), -1)}
    items = [r for r in rows if r[c['mat']]]
    lines = []
    for n, r in enumerate(items, 1):
        mat = str(r[c['mat']]).strip().removesuffix('.0').lstrip('0') or '0'
        uid = str(r[c['id']]).strip() if c['id'] >= 0 and r[c['id']] else f'Usage-{n:04d}'
        lines.append(f"  ({q(uid)}, {q(mat)}, {q(r[c['ref']] if c['ref'] >= 0 else None)}, {q(r[c['grp']])}, {q(r[c['name']] or mat)}, {q(r[c['unit']])}, {q(r[c['ef']])})")
    out += [f'-- 2) usage_ef {len(items)} รายการ (ชีต {sheet}) · kgCO₂e/unit = Usage_ef · material เดิม = แก้ค่า (Id_usage เดิมคงไว้)',
            'create temp table x_ue (id text, material text, ref text, grp text, name text, unit text, usage_ef numeric) on commit drop;',
            'insert into x_ue values', ',\n'.join(lines) + ';',
            'insert into public.mt_cfo_usage_ef as u (id, material, ref_id, grp, name, unit, usage_ef, status)',
            "select coalesce((select id from public.mt_cfo_usage_ef where material = x.material), x.id), x.material,",
            "  (select id from public.mt_cfo_ef_ref r where upper(r.code) = upper(x.ref) limit 1), x.grp, x.name, x.unit, x.usage_ef, 'Active'",
            'from x_ue x',
            'on conflict (material) do update set ref_id = excluded.ref_id, grp = excluded.grp, name = excluded.name, unit = excluded.unit, usage_ef = excluded.usage_ef;',
            '',
            '-- ตรวจ (ควรว่าง): Id_cfp ที่ไม่พบในตาราง EF · id EF CFP ที่มีอยู่แล้วแต่ชื่อไม่ตรงกับไฟล์ (ไม่ได้เขียนทับ ให้ตรวจเอง)',
            "select 'ไม่พบ Id_cfp' as check, x.material, x.ref as id, x.name from x_ue x where x.ref is not null and not exists (select 1 from public.mt_cfo_ef_ref r where upper(r.code) = upper(x.ref))",
            'union all',
            "select 'id ซ้ำชื่อไม่ตรง', r.code, x.code, r.name || ' ≠ ' || x.name from x_cfp x join public.mt_cfo_ef_ref r on upper(r.code) = upper(x.code) where lower(trim(r.name)) <> lower(trim(x.name));",
            '', 'commit;', '', "notify pgrst, 'reload schema';", '']
    target = ROOT / 'inbox' / 'import_cfo_usage_ef.sql'
    target.write_text('\n'.join(out), encoding='utf-8')
    print(f'wrote {target} · cfp {len(cfp)} · usage_ef {len(items)} (sheet {sheet})')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'C:/Work/projects/Activity/CFO/inbox/7xxxxx 01-31.10 Rev.01.xlsx')
