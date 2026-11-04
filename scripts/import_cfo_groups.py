"""SAP GI export of one month (7xxxxx 01-31.10.xlsx) -> groups + EF + factor for the materials whose EF is known -> SQL.

    python -I scripts/import_cfo_groups.py "C:/Work/projects/Activity/CFO/inbox/7xxxxx 01-31.10.xlsx"

Writes inbox/import_cfo_groups.sql (not in git) for activity01 after db/act/cfo.sql (กลุ่มวัสดุ, ผู้ใช้กำหนด 2026-11-04):
1 group = 1 EF (EF ไม่เท่ากันแยกกลุ่ม) = the 3-1 activity per costcenter. The materials of the file that were not in Usagelist
and have an EF in EF CFP (TGO list or the user's own rows from Usage.xlsx Sheet1) get a group and a factor (unit of the EF
per 1 SAP unit, worked out from the name). Proxy EFs (oil, varnish, soap) are written in the group remark for the user to check.
Left out on purpose: LPG cylinders for forklifts (burned on site = Scope 1, counted there), drinking water, copper tips,
gloves, pens and tools (no EF yet) — they come in as "รอจัดกลุ่ม" when the month is pasted. Safe to re-run.
"""
import sys
import warnings
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent

# own EF CFP rows (Usage.xlsx Sheet1, added by inbox/import_cfo_usagelist.sql) · added again here when missing
OWN = {
    'oil': ('Lubricating oil (น้ำมันหล่อลื่น)', 'kg', 0.8319, '18. กลุ่มเคมีภัณฑ์', 'Ecoinvent 2.2, IPCC 2007 GWP 100a'),
    'alcohol': ('Alcohol', 'kg', 1.2381, '18. กลุ่มเคมีภัณฑ์', 'Ecoinvent 2.2, IPCC 2007 GWP 100a'),
    'soap': ('Soap (สบู่)', 'kg', 1.6685, '18. กลุ่มเคมีภัณฑ์', 'Ecoinvent 2.2, IPCC 2007 GWP 100a'),
    'adhesive': ('Adhesive', 'kg', 2.4172, '18. กลุ่มเคมีภัณฑ์', 'Ecoinvent 2.2, IPCC 2007 GWP 100a'),
    'varnish': ('Varnish', 'kg', 1.8823, '18. กลุ่มเคมีภัณฑ์', 'Ecoinvent 2.2, IPCC 2007 GWP 100a'),
    'tissue': ('กระดาษทิชชู่', 'kg', 2.69, None, None),
}
# group name → (EF: TGO code or OWN key, reuse = take a group that already has this EF (from Usagelist), remark)
GROUPS = {
    'ถุงขยะพลาสติก (HDPE)': ('CFP-0004', False, 'ถุงขยะสีขาวขุ่น หน่วย SAP = kg'),
    'พลาสติกเคลือบบัตร (PET)': ('CFP-0027', False, 'น้ำหนักจากขนาด × 2 ชั้น × ความหนา × 1,380 kg/m³ (ประมาณ)'),
    'แผ่นพลาสติกลูกฟูก (PP)': ('CFP-0008', False, 'แผ่น 3 มม. ≈ 0.55 kg/m² (ประมาณ)'),
    'กล่อง / ซองกระดาษคราฟท์': ('CFP-0501', False, 'น้ำหนักจากขนาด (ประมาณ)'),
    'น้ำมันหล่อลื่น / น้ำมันขึ้นรูป / สารหล่อเย็น': ('oil', False, 'ใช้ EF น้ำมันหล่อลื่น (Ecoinvent) แทนน้ำมันขึ้นรูปและสารหล่อเย็น: ผู้ใช้ตรวจ'),
    'แอลกอฮอล์': ('alcohol', True, 'แอลกอฮอล์ 70% ≈ 0.885 kg/ลิตร'),
    'สบู่ / น้ำยาล้าง': ('soap', False, 'ใช้ EF สบู่ (Ecoinvent) ทั้งปริมาณ: ผู้ใช้ตรวจ'),
    'กาว': ('adhesive', False, None),
    'น้ำยาเคลือบเงาพื้น': ('varnish', False, 'ใช้ EF Varnish (Ecoinvent) แทน: ผู้ใช้ตรวจ'),
    'สกรู / น็อต (เหล็กกล้า)': ('CFP-0537', False, 'ใช้ EF ลวดเหล็กกล้าดึงเย็นแทน (เหมือนลวดเชื่อม) · น้ำหนักตามขนาดมาตรฐาน'),
    'กระดาษพิมพ์เขียน ไม่เคลือบผิว': ('CFP-0498', True, None),
    'กระดาษทิชชู': ('tissue', True, None),
    'ลวดเชื่อม Arc weld': ('CFP-0537', True, None),
}
# material → (group, factor = unit of the EF per 1 SAP unit or None, how) · the SAP unit is the one of the file (the factor is
# per that unit; SAP issues WD40 as PC and the 1.2 mm wire in KG although the material list says CAN / ROL)
MATS = {
    '70031367': ('ลวดเชื่อม Arc weld', 1.0, 'หน่วย SAP ในไฟล์ = KG (รายการเดิม ROL × 15)'),
    '70102253': ('ถุงขยะพลาสติก (HDPE)', 1.0, 'หน่วย SAP = kg'),
    '70102252': ('ถุงขยะพลาสติก (HDPE)', 1.0, 'หน่วย SAP = kg'),
    '70102639': ('ถุงขยะพลาสติก (HDPE)', 1.0, 'หน่วย SAP = kg'),
    '70026594': ('พลาสติกเคลือบบัตร (PET)', 0.12474 * 2 * 125e-6 * 1380 * 100, 'A3 × 2 ชั้น × 125 µm × 1,380 kg/m³ × 100 แผ่น'),
    '70004952': ('พลาสติกเคลือบบัตร (PET)', 0.065 * 0.095 * 2 * 125e-6 * 1380, '65 × 95 มม. × 2 ชั้น × 125 µm'),
    '70004572': ('แผ่นพลาสติกลูกฟูก (PP)', 1.30 * 2.45 * 0.55, '1.30 × 2.45 m × 0.55 kg/m²'),
    '70075959': ('กล่อง / ซองกระดาษคราฟท์', 2 * (0.355 * 0.523 + 0.523 * 0.292 + 0.292 * 0.355) * 0.5, 'พื้นที่ผิวกล่อง 0.88 m² × 0.5 kg/m²'),
    '70015739': ('กล่อง / ซองกระดาษคราฟท์', 0.25 * 0.35 * 2 * 0.09, 'ซอง 25 × 35 ซม. × 2 ด้าน × 90 g/m²'),
    '70028953': ('กระดาษพิมพ์เขียน ไม่เคลือบผิว', 0.0762 * 0.0762 * 100 * 0.075, '3" × 3" × 100 แผ่น × 75 g/m²'),
    '70028954': ('กระดาษพิมพ์เขียน ไม่เคลือบผิว', None, 'ไม่รู้จำนวนแผ่น: ชั่งแล้วใส่ตัวแปลง'),
    '70028679': ('กระดาษพิมพ์เขียน ไม่เคลือบผิว', None, 'ไม่รู้จำนวนแผ่น: ชั่งแล้วใส่ตัวแปลง'),
    '70111027': ('น้ำมันหล่อลื่น / น้ำมันขึ้นรูป / สารหล่อเย็น', 1.02, 'Syntilo 9954 ≈ 1.02 kg/ลิตร'),
    '70117528': ('น้ำมันหล่อลื่น / น้ำมันขึ้นรูป / สารหล่อเย็น', 18 * 1.02, '18 ลิตร × 1.02 kg/ลิตร'),
    '70006324': ('น้ำมันหล่อลื่น / น้ำมันขึ้นรูป / สารหล่อเย็น', 200 * 0.87, '200 ลิตร × 0.87 kg/ลิตร'),
    '70006322': ('น้ำมันหล่อลื่น / น้ำมันขึ้นรูป / สารหล่อเย็น', 20 * 0.87, 'P20L: 20 ลิตร × 0.87 kg/ลิตร'),
    '70077193': ('น้ำมันหล่อลื่น / น้ำมันขึ้นรูป / สารหล่อเย็น', 20 * 0.88, '20 ลิตร × 0.88 kg/ลิตร'),
    '70001333': ('น้ำมันหล่อลื่น / น้ำมันขึ้นรูป / สารหล่อเย็น', 0.311, 'WD40 311 g'),
    '70001323': ('น้ำมันหล่อลื่น / น้ำมันขึ้นรูป / สารหล่อเย็น', 0.3, '400 ml ≈ 0.3 kg (ไม่รวมก๊าซและกระป๋อง)'),
    '70103606': ('แอลกอฮอล์', 4 * 0.885, '4 ลิตร × 0.885 kg/ลิตร'),
    '70004602': ('แอลกอฮอล์', 0.45 * 0.885, '450 ml × 0.885 kg/ลิตร'),
    '70056035': ('สบู่ / น้ำยาล้าง', 3.8 * 1.02, '3,800 ml × 1.02 kg/ลิตร'),
    '70001711': ('สบู่ / น้ำยาล้าง', 3.2 * 1.02, '3,200 ml × 1.02 kg/ลิตร'),
    '70000808': ('กาว', 0.02, '20 g/หลอด'),
    '70106643': ('น้ำยาเคลือบเงาพื้น', 20 * 1.02, '20 ลิตร × 1.02 kg/ลิตร'),
    '70054027': ('สกรู / น็อต (เหล็กกล้า)', 0.155, 'M16 × 80 ≈ 155 g'),
    '70004144': ('สกรู / น็อต (เหล็กกล้า)', 0.046, 'M10 × 60 ≈ 46 g'),
    '70040627': ('กระดาษทิชชู', 620 * 0.095 * 16 / 1000 * 12, 'JRT 620 m × 9.5 ซม. × 16 g/m² × 12 ม้วน'),
}


def lit(v):
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return repr(round(float(v), 6))
    return "'" + str(v).replace("'", "''") + "'"


def main(path):
    warnings.simplefilter('ignore')
    book = openpyxl.load_workbook(path, read_only=True, data_only=True)
    seen = {}
    for r in book.worksheets[0].iter_rows(values_only=True):
        if len(r) > 13 and isinstance(r[7], (int, float)):
            seen.setdefault(str(int(r[7])), (str(r[8] or '').strip(), str(r[13] or '').strip()))
    items = [(code, *seen[code], *MATS[code]) for code in MATS if code in seen]
    own = ',\n'.join(f'  ({lit(k)}, {lit(v[0])}, {lit(v[1])}, {lit(v[2])}, {lit(v[3])}, {lit(v[4])})' for k, v in OWN.items())
    groups = ',\n'.join(f'  ({lit(n)}, {lit(v[0] if v[0].startswith("CFP-") else None)}, {lit(None if v[0].startswith("CFP-") else v[0])}, {lit(v[1])}, {lit(v[2])})'
                        for n, v in GROUPS.items())
    mats = ',\n'.join(f'  ({lit(c)}, {lit(n)}, {lit(u)}, {lit(f)}, {lit(g)}, {lit(h)})' for c, n, u, g, f, h in items)
    sql = f"""-- กลุ่มวัสดุ + EF + ตัวแปลง ของวัสดุใหม่ในไฟล์ SAP ({Path(path).name}) · scripts/import_cfo_groups.py · ผู้ใช้กำหนด 2026-11-04
-- รันใน activity01 หลัง db/act/cfo.sql · รันซ้ำได้ · {len(items)} วัสดุ · {len(GROUPS)} กลุ่ม (1 กลุ่ม = 1 EF = กิจกรรม 3-1 ต่อ costcenter)
begin;
-- 0) EF ของเรา (Usage.xlsx Sheet1) ที่กลุ่มใช้ · เพิ่มเฉพาะที่ยังไม่มี (ชื่อ + หน่วย + ค่า)
create temp table g_own (k text, name text, unit text, total numeric, grp text, reference text) on commit drop;
insert into g_own values
{own};
insert into public.mt_cfo_ef_ref (sheet, grp, name, unit, total, reference, sort_no, status)
select 'cfp', o.grp, o.name, o.unit, o.total, o.reference,
  100000 + coalesce((select max(sort_no) - 100000 from public.mt_cfo_ef_ref where sheet = 'cfp' and sort_no >= 100000), 0) + row_number() over (order by o.k), 'Active'
from g_own o
where not exists (select 1 from public.mt_cfo_ef_ref r where r.sheet = 'cfp' and lower(regexp_replace(r.name, '\\s+', '', 'g')) = lower(regexp_replace(o.name, '\\s+', '', 'g'))
  and lower(coalesce(r.unit, '')) = lower(o.unit) and round(r.total, 4) = round(o.total, 4));
update public.mt_cfo_ef_ref r set code = 'CFP-' || lpad((x.n + x.base)::text, 4, '0')
from (select id, row_number() over (order by sort_no, id) as n,
        coalesce((select max(substring(code from 5)::int) from public.mt_cfo_ef_ref where code ~ '^CFP-[0-9]+$'), 0) as base
      from public.mt_cfo_ef_ref where sheet = 'cfp' and code is null) x
where r.id = x.id;

-- 1) กลุ่ม: EF id ของ อบก. หรือ EF ของเรา · reuse = ใช้กลุ่มเดิมที่มี EF เดียวกันอยู่แล้ว (จาก Usagelist) ไม่สร้างซ้ำ
create temp table g_new (name text, ef_code text, own text, reuse boolean, remark text) on commit drop;
insert into g_new values
{groups};
create temp table g_ref on commit drop as
select g.*, coalesce((select r.id from public.mt_cfo_ef_ref r where r.code = g.ef_code limit 1),
  (select r.id from public.mt_cfo_ef_ref r join g_own o on o.k = g.own where r.sheet = 'cfp' and lower(regexp_replace(r.name, '\\s+', '', 'g')) = lower(regexp_replace(o.name, '\\s+', '', 'g'))
     and round(r.total, 4) = round(o.total, 4) order by r.sort_no desc limit 1)) as ef_id
from g_new g;
insert into public.mt_cfo_mat_group (name, ef_ref_id, scope_code, kind, remark)
select g.name, g.ef_id, '3-1', 'usage', g.remark from g_ref g
where not exists (select 1 from public.mt_cfo_mat_group x where x.name = g.name)
  and not (g.reuse and exists (select 1 from public.mt_cfo_mat_group x where x.ef_ref_id = g.ef_id));

-- 2) วัสดุ: กลุ่ม + ตัวแปลง (หน่วย EF ต่อ 1 หน่วย SAP) · ไม่รู้น้ำหนัก = มีกลุ่มแต่ยังไม่คิด จนใส่ตัวแปลง
create temp table g_mat (material text, name text, sap_unit text, factor numeric, grp text, how text) on commit drop;
insert into g_mat values
{mats};
insert into public.mt_cfo_material (material, name, sap_unit, factor, scope_code, kind, status, group_id, grp, ef_ref_id)
select m.material, m.name, m.sap_unit, m.factor, '3-1', 'usage', 'Active', x.id, x.name, x.ef_ref_id
from g_mat m join g_ref r on r.name = m.grp
join lateral (select g.id, g.name, g.ef_ref_id from public.mt_cfo_mat_group g where g.name = r.name or (r.reuse and g.ef_ref_id = r.ef_id)
  order by (g.name = r.name) desc, g.id limit 1) x on true
on conflict (material) do update set group_id = excluded.group_id, grp = excluded.grp, ef_ref_id = excluded.ef_ref_id, scope_code = '3-1', kind = 'usage',
  factor = coalesce(excluded.factor, public.mt_cfo_material.factor), sap_unit = excluded.sap_unit;
commit;

-- ตรวจ: กลุ่มทั้งหมด (EF id · วัสดุ · คิดได้) · Usage ที่วางไว้แล้วคิดใหม่ให้เองเมื่อ admin เปิด Setting / Dashboard (หรือวางเดือนนั้นอีกครั้ง)
select g.name as "กลุ่ม (กิจกรรม)", r.code as "EF id", r.name as "EF", r.total as "kgCO2e", r.unit, count(m.material) as "วัสดุ",
  count(m.material) filter (where m.factor > 0) as "คิดได้"
from public.mt_cfo_mat_group g left join public.mt_cfo_ef_ref r on r.id = g.ef_ref_id left join public.mt_cfo_material m on m.group_id = g.id
group by g.id, g.name, r.code, r.name, r.total, r.unit order by g.name;
"""
    target = ROOT / 'inbox' / 'import_cfo_groups.sql'
    target.write_text(sql, encoding='utf-8', newline='\n')
    sys.stdout.reconfigure(encoding='utf-8')
    missing = [c for c in MATS if c not in seen]
    print(f'{target.relative_to(ROOT)} · {len(items)} วัสดุ · {len(GROUPS)} กลุ่ม' + (f' · ไม่พบในไฟล์ {missing}' if missing else ''))
    for c, n, u, g, f, h in items:
        print(f'  {c} {n[:40]:40} {u:4} → {g} · {"-" if f is None else round(f, 4)} ({h})')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'C:/Work/projects/Activity/CFO/inbox/7xxxxx 01-31.10.xlsx')
