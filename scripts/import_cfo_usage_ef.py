"""Workbook 7xxxxx 01-31.10 Rev.01.xlsx (sheets cfp + cal_ef) -> SQL for Supabase (activity01), ผู้ใช้กำหนด 2026-11-09.

    python -I scripts/import_cfo_usage_ef.py "C:/Work/projects/Activity/CFO/inbox/7xxxxx 01-31.10 Rev.01.xlsx"

Writes inbox/import_cfo_usage_ef.sql (not in git), run after db/act/cfo.sql:
1) sheet cfp    -> mt_cfo_ef_ref (sheet cfp). The ids of the sheet (CFP-0726 …) are the workbook's own numbering, not the
   ones in the database (live CFP-0795 = Polyurethane, sheet CFP-0795 = Presta RT, ผู้ใช้รัน 2026-11-09): a row is found by
   name + unit + value, else added under the next free CFP id. x_map = sheet id → database row.
2) sheet usage_ef (or cal_ef) -> mt_cfo_usage_ef: Id_usage (column Id_usage, else Usage-0001 … in sheet order) · Id_cfp of the
   sheet → its database row through x_map · group · material · material_description · bun · kgCO₂e/unit = usage_ef.
   Same material = updated (its Id_usage kept).
Safe to re-run. Ends with a table: sheet Id_cfp → database id, and the EF rows added.
"""
import sys
import warnings
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent

# same EF = same name (spaces ignored, any case) + unit + value
SAME = ("lower(regexp_replace(r.name, '\\s+', '', 'g')) = lower(regexp_replace(x.name, '\\s+', '', 'g')) "
        "and lower(coalesce(r.unit, '')) = lower(coalesce(x.unit, '')) and round(r.total, 4) is not distinct from round(x.total, 4)")


def q(v):
    if v is None or (isinstance(v, str) and not v.strip()):
        return 'null'
    if isinstance(v, float):
        return repr(v)
    if isinstance(v, int):
        return str(v)
    return "'" + str(v).strip().replace("'", "''") + "'"


def rows_of(ws):
    rows = [r for r in ws.iter_rows(values_only=True) if any(c is not None and str(c).strip() for c in r)]
    head = [str(c or '').strip().lower().replace('₂', '2').replace(' ', '') for c in rows[0]]
    return head, rows[1:]


def main(path):
    warnings.filterwarnings('ignore')
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    out = ['-- EF CFP (ชีต cfp) + usage_ef (ชีต usage_ef / cal_ef) จาก ' + Path(path).name + ' · scripts/import_cfo_usage_ef.py · ผู้ใช้กำหนด 2026-11-09',
           '-- รันใน activity01 หลัง db/act/cfo.sql · รันซ้ำได้ · ท้ายไฟล์มีตาราง id ในไฟล์ → id ในระบบ', 'begin;', '']

    # 1) EF CFP
    head, rows = rows_of(wb['cfp'])
    at = lambda *k: next((head.index(x) for x in k if x in head), -1)
    c = {'code': at('id'), 'grp': at('กลุ่ม'), 'item': at('ลำดับ'), 'name': at('ชื่อ'), 'formula': at('รายละเอียด'), 'unit': at('หน่วย'),
         'total': next((i for i, h in enumerate(head) if h.startswith('ค่าแฟคเตอร์')), -1), 'ref': at('ข้อมูลอ้างอิง'), 'remark': at('วันที่อัพเดท')}
    get = lambda r, k: r[c[k]] if c[k] >= 0 else None
    cfp = [r for r in rows if get(r, 'code') and get(r, 'name')]
    values = [f"  ({q(get(r, 'code'))}, {q(get(r, 'grp'))}, {q(get(r, 'item'))}, {q(get(r, 'name'))}, {q(get(r, 'formula'))}, {q(get(r, 'unit'))}, "
              f"{q(get(r, 'total'))}, {q(get(r, 'ref'))}, {q(get(r, 'remark'))})" for r in cfp]
    out += [f'-- 1) EF CFP {len(cfp)} รายการ: id ในชีตเป็นเลขของไฟล์ ไม่ใช่เลขในระบบ · หาแถวเดิมด้วย ชื่อ + หน่วย + ค่า · ไม่มี = เพิ่มด้วย id ใหม่ต่อท้าย',
            'create temp table x_cfp (code text, grp text, item_no text, name text, formula text, unit text, total numeric, reference text, remark text) on commit drop;',
            'insert into x_cfp values', ',\n'.join(values) + ';',
            f"create temp table x_new on commit drop as select x.* from x_cfp x where not exists (select 1 from public.mt_cfo_ef_ref r where r.sheet = 'cfp' and {SAME});",
            'insert into public.mt_cfo_ef_ref (sheet, code, grp, item_no, name, formula, unit, total, reference, remark, sort_no, status)',
            "select 'cfp', 'CFP-' || lpad((b.base + row_number() over (order by x.code))::text, 4, '0'), x.grp, x.item_no, x.name, x.formula, x.unit, x.total, x.reference, x.remark,",
            "  100000 + coalesce((select max(sort_no) - 100000 from public.mt_cfo_ef_ref where sheet = 'cfp' and sort_no >= 100000), 0) + row_number() over (order by x.code), 'Active'",
            "from x_new x cross join (select coalesce(max(substring(code from 5)::int), 0) as base from public.mt_cfo_ef_ref where code ~ '^CFP-[0-9]+$') b;",
            '-- id ในไฟล์ → แถวในระบบ',
            'create temp table x_map on commit drop as select distinct on (x.code) x.code as file_code, r.id as ref_id, r.code as db_code, x.name',
            f"from x_cfp x join public.mt_cfo_ef_ref r on r.sheet = 'cfp' and {SAME} order by x.code, r.id;", '']

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
    out += [f'-- 2) usage_ef {len(items)} รายการ (ชีต {sheet}) · kgCO₂e/unit = Usage_ef · Id_cfp ของไฟล์ → แถวในระบบผ่าน x_map · material เดิม = แก้ค่า (Id_usage เดิมคงไว้)',
            'create temp table x_ue (id text, material text, ref text, grp text, name text, unit text, usage_ef numeric) on commit drop;',
            'insert into x_ue values', ',\n'.join(lines) + ';',
            'insert into public.mt_cfo_usage_ef as u (id, material, ref_id, grp, name, unit, usage_ef, status)',
            'select coalesce((select id from public.mt_cfo_usage_ef where material = x.material), x.id), x.material,',
            "  (select m.ref_id from x_map m where upper(m.file_code) = upper(x.ref)), x.grp, x.name, x.unit, x.usage_ef, 'Active'",
            'from x_ue x',
            'on conflict (material) do update set ref_id = excluded.ref_id, grp = excluded.grp, name = excluded.name, unit = excluded.unit, usage_ef = excluded.usage_ef;',
            '']

    # 3) activities: every material of usage_ef × costcenter issued in sheet sap10 (net qty > 0) = 1 activity (calc usage)
    pairs = []
    if 'sap10' in wb.sheetnames:
        head, rows = rows_of(wb['sap10'])
        at = lambda *k: next((head.index(x) for x in k if x in head), -1)
        mi, ci, qi = at('material'), at('costctr', 'costcenter'), at('qtyinune', 'qty')
        mats = {str(r[c['mat']]).strip().removesuffix('.0').lstrip('0') for r in items}
        net = {}
        for r in rows:
            if mi < 0 or not r[mi] or r[ci] in (None, '') or r[qi] in (None, ''):
                continue
            mat = str(r[mi]).strip().removesuffix('.0').lstrip('0')
            if mat in mats:
                key = (mat, str(r[ci]).strip().removesuffix('.0').upper())
                net[key] = net.get(key, 0) - float(r[qi])  # SAP issue = minus
        pairs = sorted(k for k, v in net.items() if v > 0)
    if pairs:
        out += [f'-- 3) กิจกรรม Usage {len(pairs)} รายการ = material ใน usage_ef × costcenter ที่เบิกจริงในชีต sap10 (Id_usage × costcenter, Scope 3-1)',
                '--    หน่วยงาน = department ของ costcenter (mt_main_costcenter) · ชื่อ = กลุ่ม · มีอยู่แล้วไม่สร้างซ้ำ · EF = สำเนา Usage_ef (usage:<Id_usage>:3-1)',
                'create temp table x_act (material text, costcenter text) on commit drop;',
                'insert into x_act values', ',\n'.join(f'  ({q(m)}, {q(cc)})' for m, cc in pairs) + ';',
                'insert into public.mt_cfo_ef (code, scope_code, kind, name, detail, unit, kgco2e, ref_id, reference, year, status)',
                "select case when exists (select 1 from public.mt_cfo_ef f where f.code = 'usage:' || u.id || ':3-1') then 'usage:' || u.id || ':3-1:' || ((select count(*) from public.mt_cfo_ef f where f.code ~ ('^usage:' || u.id || ':3-1(:[0-9]+)?$')) + 1) else 'usage:' || u.id || ':3-1' end,",
                "  '3-1', u.grp, u.name, u.id || ' · material ' || u.material, coalesce(u.unit, 'unit'), u.usage_ef, u.ref_id, 'Setting > EF SAP (usage_ef)', extract(year from now())::int, 'Active'",
                'from public.mt_cfo_usage_ef u where u.material in (select material from x_act)',
                "  and not exists (select 1 from public.mt_cfo_ef f where f.code ~ ('^usage:' || u.id || ':3-1(:[0-9]+)?$') and f.kgco2e = u.usage_ef and f.unit = coalesce(u.unit, 'unit') and f.ref_id is not distinct from u.ref_id);",
                'insert into public.mt_cfo_activity (ef_id, gwp_code, department, name, detail, calc, status, usage_id, costcenter)',
                "select (select f.id from public.mt_cfo_ef f where f.code ~ ('^usage:' || u.id || ':3-1(:[0-9]+)?$') and f.kgco2e = u.usage_ef order by f.id desc limit 1),",
                "  coalesce((select code from public.mt_cfo_gwp where code = 'AR5'), (select code from public.mt_cfo_gwp order by code limit 1)),",
                "  coalesce(c.department, x.costcenter), u.grp, coalesce(c.department, x.costcenter) || ' : ' || x.costcenter || coalesce(' ' || c.object_name, ''), 'usage', 'Active', u.id, x.costcenter",
                'from x_act x join public.mt_cfo_usage_ef u on u.material = x.material',
                'left join public.mt_main_costcenter c on upper(trim(c.costcenter::text)) = x.costcenter',
                'where not exists (select 1 from public.mt_cfo_activity a where a.usage_id = u.id and upper(a.costcenter) = x.costcenter);',
                '']
    out += ['-- ผล: Id_cfp ในไฟล์ → id ในระบบ (ไม่พบ = ควรไม่มี) · EF CFP ที่เพิ่มใหม่รอบนี้ · จำนวนกิจกรรม Usage',
            "select case when m.db_code is null then 'ไม่พบ' else 'Id_cfp ในไฟล์ → id ในระบบ' end as check, x.material, x.ref as file_id, m.db_code, x.name",
            'from x_ue x left join x_map m on upper(m.file_code) = upper(x.ref) where x.ref is not null',
            'union all',
            "select 'EF CFP เพิ่มใหม่', null, x.code, m.db_code, x.name from x_new x join x_map m on m.file_code = x.code",
            'union all',
            "select 'กิจกรรม Usage ทั้งหมด', null, null, count(*)::text, null from public.mt_cfo_activity where calc = 'usage';",
            '', 'commit;', '', "notify pgrst, 'reload schema';", '']
    target = ROOT / 'inbox' / 'import_cfo_usage_ef.sql'
    target.write_text('\n'.join(out), encoding='utf-8')
    print(f'wrote inbox/import_cfo_usage_ef.sql: cfp {len(cfp)} · usage_ef {len(items)} (sheet {sheet})')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'C:/Work/projects/Activity/CFO/inbox/7xxxxx 01-31.10 Rev.01.xlsx')
