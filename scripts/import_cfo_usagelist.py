"""Usage.xlsx sheet "Usagelist" (the SAP materials the user picked for CFO) -> EF id + kg per SAP unit.

    python -I scripts/import_cfo_usagelist.py "C:/Work/projects/Activity/CFO/inbox/Usage.xlsx"

Writes (inbox/, not in git):
  - inbox/Usagelist_EF.xlsx       one row per material (duplicates of the sheet removed) with the EF id, kg per SAP unit,
                                  kgCO2e per SAP unit, how the kg was worked out and how sure it is — for the user to check
  - inbox/import_cfo_usagelist.sql for activity01 after db/act/cfo.sql + inbox/import_cfp_tgo.sql: adds the product
                                  carbon labels the user found (TGO CFP FY..) as own rows of EF CFP, then sets EF + factor of
                                  each material in mt_cfo_material (kind usage, Scope 3-1) · safe to re-run

EF ids CFP-0001 … CFP-0539 are the TGO list (inbox/import_cfp_tgo.sql, PDF order). factor = kg (or cylinder / litre, the
unit of the EF) per 1 SAP unit; a material without a factor stays uncounted until the user fills it in Setting > วัสดุ.
spec: docs/specs/act-cfo.md (ผู้ใช้กำหนด 2026-11-02)
"""
import re
import sys
import warnings
from pathlib import Path

import openpyxl
from openpyxl.styles import Font, PatternFill

ROOT = Path(__file__).resolve().parent.parent

# TGO CFP (code, name, unit, kgCO2e/unit) used here
TGO = {
    'paper': ('CFP-0498', 'กระดาษพิมพ์เขียนแบบไม่เคลือบผิว', 'kg', 2.102),
    'board': ('CFP-0503', 'กระดาษกล่องขาวเคลือบแป้ง/ กระดาษกล่องแป้งหลังเทา', 'kg', 1.8679),
    'lldpe': ('CFP-0006', 'Linear Low Density Polyethylene (LLDPE)', 'kg', 2.3995),
    'steelwire': ('CFP-0537', 'ลวดเหล็กกล้าดึงเย็นเสริมคอนกรีต (ลวดปลอก)', 'kg', 2.5748),
    'cotton': ('CFP-0255', 'ผ้าถักจากเส้นด้ายฝ้าย', 'kg', 8.2794),
}
# Product carbon labels the user found (Usagelist column อ้างอิง) → own rows of EF CFP. The unit is not written in the sheet:
# a gas cylinder label is taken per cylinder (7 m³), the others per kg / litre — the user checks these (col. ความมั่นใจ).
LABEL = {
    'n2': ('ก๊าซไนโตรเจน อุตสาหกรรม ท่อ 7 m³ (ฉลาก CFP)', 'cylinder', 81.1, 'TGO CFP FY26-849-7831'),
    'ar': ('ก๊าซอาร์กอน อุตสาหกรรม ท่อ 7 m³ (ฉลาก CFP)', 'cylinder', 42.4, 'TGO CFP FY26-849-7835'),
    'arco2': ('ก๊าซผสม ARGOSHIELD Ar80% + CO2 20% ท่อ 7 m³ (ฉลาก CFP)', 'cylinder', 42.4, 'TGO CFP FY26-849-7836'),
    'o2': ('ก๊าซออกซิเจน อุตสาหกรรม ท่อ 7 m³ (ฉลาก CFP)', 'cylinder', 83.8, 'TGO CFP FY22-085-910'),
    'co2': ('ก๊าซคาร์บอนไดออกไซด์ (ฉลาก CFP)', 'kg', 1.15, 'TGO CFP FY26-753-7420'),
    'cl': ('คลอรีนน้ำ 10% (ฉลาก CFP)', 'kg', 0.89, 'TGO CFP FY26-535-4700'),
    'wachem611': ('สารเคมีบำบัดน้ำ WACHEM 850 / PHAMINOX 1000 (ฉลาก CFP)', 'kg', 0.611, 'TGO CFP FY26-535-4700'),
    'water': ('น้ำกลั่น (ฉลาก CFP)', 'l', 0.558, 'TGO CFP FY25-332-2190'),
    'paint': ('สีน้ำมัน DENZO (ฉลาก CFP)', 'kg', 2.09, 'TGO CFP FY26-757-7536 / 7537'),
}
A4, A3, F9x11 = 0.06237, 0.12474, 0.2286 * 0.2794  # m² per sheet
ARGON_KG_PER_CYL = 7 * 1.69  # 7 m³ argon at 15 °C, 1 atm


def paper(name, unit):
    """kg per SAP unit of a paper item from its name: gsm × sheet area × sheets."""
    gsm = re.search(r'(\d{2,3})\s*(?:แกรม|G\b|g\b|G\))', name, re.I)
    gsm = float(gsm.group(1)) if gsm else 80.0
    area = A3 if 'A3' in name.upper() else A4
    if unit == 'SHE':
        return gsm * area / 1000, f'{gsm:g} g/m² × {area} m² (1 แผ่น)', 'จากชื่อ' if 'แกรม' in name or 'G' in name else 'ประมาณ (80 แกรม)'
    sheets = re.search(r'(\d{2,4})\s*แผ่น', name)
    n = float(sheets.group(1)) if sheets else 500.0
    sure = 'จากชื่อ' if sheets else 'ประมาณ (500 แผ่น/รีม)'
    return gsm * area * n / 1000, f'{gsm:g} g/m² × {area} m² × {n:g} แผ่น', sure


def continuous(name):
    """Continuous form 9"×11": 1000 sets a box (as written for 2P), plies from nP, 60 g (1P as written) else 55 g."""
    plies = re.search(r'(\d)\s*P', name, re.I)
    p = int(plies.group(1)) if plies else 1
    gsm = 60.0 if p == 1 else 55.0
    return F9x11 * gsm * p * 1000 / 1000, f'9"×11" {F9x11:.5f} m² × {gsm:g} g × {p} ชั้น × 1000 ชุด', 'ประมาณ (1000 ชุด/กล่อง)'


def match(code, name, unit):
    """(ef key, kg per SAP unit, how, sure) — ef key in TGO / LABEL, or None with the reason."""
    n = name.upper()
    if 'แก้วกาแฟกระดาษ' in name:
        each = 0.008 if '8ออนซ์' in name else 0.006
        return ('board', each * 50, f'{each * 1000:g} g/ใบ × 50 ใบ', 'ประมาณ (ไม่รวมฝา)')
    if 'กระดาษต่อเนื่อง' in name:
        return ('paper', *continuous(name))
    if any(w in name for w in ('กระดาษชำระ', 'กระดาษเช็ดมือ')) or 'KIMTECH' in n:
        return ('paper', None, 'กระดาษทิชชู / ผ้าเช็ด: ไม่รู้น้ำหนักต่อหน่วย', 'ต้องชั่ง')
    if 'กระดาษ' in name or 'ปรุ' in name:
        return ('paper', *paper(name, unit))
    if 'ฟิล์มยืด' in name:
        w, length, mic = (0.5, 300, 15) if '50CM' in n else (1.4, 70, 17)
        return ('lldpe', w * length * mic * 1e-6 * 920, f'{w} m × {length} m × {mic} µm × 920 kg/m³', 'จากชื่อ')
    if 'ถุงซิป' in name:
        return ('lldpe', 1.0, 'หน่วย SAP = kg', 'จากชื่อ')
    if 'NITROGEN' in n:
        return ('n2', 1.0, '1 ท่อ', 'ค่าฉลากต่อท่อ (ตรวจหน่วยฉลาก)')
    if 'ARGOSHIELD' in n:
        return ('arco2', 1.0, '1 ท่อ', 'ค่าฉลากต่อท่อ (ตรวจหน่วยฉลาก)')
    if 'LIQUID ARGON' in n:
        return ('ar', 1 / ARGON_KG_PER_CYL, f'1 kg ÷ {ARGON_KG_PER_CYL:.2f} kg ต่อท่อ 7 m³', 'ประมาณ')
    if 'ARGON' in n:
        return ('ar', 1.0, '1 ท่อ', 'ค่าฉลากต่อท่อ (ตรวจหน่วยฉลาก)')
    if 'OXYGEN' in n:
        return ('o2', 1.0, '1 ท่อ', 'ค่าฉลากต่อท่อ (ตรวจหน่วยฉลาก)')
    if 'CARBON DIOXIDE' in n:
        return ('co2', 1.0, 'หน่วย SAP = kg', 'จากชื่อ')
    if 'คาร์บอนไดออกไซด์' in name:
        kg = re.search(r'(\d+)\s*กก', name)
        return ('co2', float(kg.group(1)) if kg else None, f'{kg.group(1)} kg/ท่อ' if kg else 'ไม่รู้ kg/ท่อ', 'จากชื่อ' if kg else 'ต้องชั่ง')
    if 'คลอรีน' in name or 'ZERGUARD' in n:
        return ('cl', 1.0, 'หน่วย SAP = kg', 'จากชื่อ')
    if 'WACHEM' in n:
        return ('wachem611', 1.0, 'หน่วย SAP = kg', 'จากชื่อ')
    if 'น้ำกลั่น' in name:
        return ('water', 1.0, '1 ลิตร/ขวด', 'จากชื่อ')
    if 'DENZO' in n:
        litre = 3.785 if unit == 'GAL' else 0.946
        return ('paint', litre * 1.1, f'{litre} ลิตร × 1.1 kg/ลิตร', 'ประมาณ (ขนาดกระป๋อง)')
    if 'ถุงมือผ้า' in name:
        g = re.search(r'(\d+)\s*ขีด', name)
        return ('cotton', int(g.group(1)) * 0.1 if g else None, f'{g.group(1)} ขีด/โหล' if g else '', 'จากชื่อ')
    if 'ลวดเชื่อม' in name and 'TUNGST' not in n:
        if unit == 'KG':
            return ('steelwire', 1.0, 'หน่วย SAP = kg', 'จากชื่อ (ใช้ลวดเหล็กกล้าแทนลวดเชื่อม)')
        kg = re.search(r'(\d+)\s*(?:KG|กก)', name, re.I)
        return ('steelwire', float(kg.group(1)) if kg else None, f'{kg.group(1)} kg/{unit}' if kg else 'ไม่รู้ kg', 'จากชื่อ (ใช้ลวดเหล็กกล้าแทนลวดเชื่อม)')
    if 'TIP' in n:
        return (None, None, 'Tip ทองแดงผสม (CuCrZr): ยังไม่มี EF ทองแดงในตาราง อบก.', '')
    if 'ถุงมือ' in name:
        return (None, None, 'ถุงมือยาง / ไนไตรล์ / หนัง: ยังไม่มี EF ในตาราง อบก.', '')
    if 'LABEL' in n:
        return (None, None, 'ฉลาก: ไม่รู้ขนาด / น้ำหนัก', '')
    if 'แอลกอฮอล์' in name:
        return (None, None, 'แอลกอฮอล์: ยังไม่มี EF ในตาราง อบก.', '')
    return (None, None, 'ยังไม่มี EF', '')


def lit(v):
    if v is None:
        return 'null'
    if isinstance(v, (int, float)):
        return repr(round(float(v), 6))
    return "'" + str(v).replace("'", "''") + "'"


def main(book_path):
    warnings.simplefilter('ignore')
    book = openpyxl.load_workbook(book_path, read_only=True, data_only=True)
    rows = list(book['Usagelist'].iter_rows(values_only=True))
    # the unit SAP really reports (sheet Usage) wins over the one typed in Usagelist (e.g. ฟิล์มยืด PC → ROL),
    # otherwise the monthly Usage is rejected as "หน่วยไม่ตรง"
    sap_units = {}
    usage = book['Usage'].iter_rows(values_only=True)
    head = [str(h or '').strip().lower() for h in next(usage)]
    for r in usage:
        code = str(r[head.index('material')] or '').strip().removesuffix('.0')
        unit = str(r[head.index('unit')] or '').strip().upper()
        if code and unit:
            sap_units.setdefault(code, set()).add(unit)
    seen, items, dropped = {}, [], []
    for i, r in enumerate(rows[1:], start=2):
        code = str(r[0] or '').strip().removesuffix('.0')
        if not code:
            dropped.append((i, r[1], 'ไม่มีรหัส material'))
            continue
        if code in seen:
            dropped.append((i, r[1], f'ซ้ำกับแถว {seen[code]}'))
            continue
        seen[code] = i
        unit = str(r[2] or '').strip().upper()
        used = sap_units.get(code, set())
        note = ''
        if len(used) == 1 and unit not in used:
            note = f' · หน่วยใน Usagelist {unit} แต่ SAP ใช้ {next(iter(used))}'
            unit = next(iter(used))
        key, kg, how, sure = match(code, str(r[1] or ''), unit)
        how += note
        ef = TGO.get(key) or (LABEL.get(key) and ('CFP-ใหม่',) + LABEL[key][:3])
        items.append({'row': i, 'material': code, 'name': ' '.join(str(r[1] or '').split()), 'unit': unit, 'price': r[3], 'group': r[6],
                      'key': key, 'ef': ef, 'kg': kg, 'how': how, 'sure': sure, 'old': r[7], 'old_unit': r[8]})

    # ---------- Excel for the user ----------
    out = openpyxl.Workbook()
    sh = out.active
    sh.title = 'Usagelist_EF'
    head = ['material', 'material_description', 'bun', 'price', 'หมวดหลัก', 'EF id', 'EF (ตาราง EF CFP)', 'หน่วย EF', 'kgCO2e / หน่วย EF',
            'ตัวแปลง (หน่วย EF ต่อ 1 หน่วย SAP)', 'kg ต่อ 1 หน่วย SAP', 'kgCO2e ต่อ 1 หน่วย SAP', 'วิธีคิด', 'ความมั่นใจ', 'EF เดิมในชีต', 'แถวในชีตเดิม']
    sh.append(head)
    for c in sh[1]:
        c.font = Font(bold=True)
        c.fill = PatternFill('solid', fgColor='D9F2E6')
    for it in items:
        ef = it['ef']
        kg_col = it['kg'] if ef and ef[2] == 'kg' else (it['kg'] * ARGON_KG_PER_CYL if it['key'] in ('ar',) and it['kg'] else None)
        if it['key'] == 'water' and it['kg']:
            kg_col = it['kg']  # 1 l of water ≈ 1 kg
        sh.append([int(it['material']) if it['material'].isdigit() else it['material'], it['name'], it['unit'], it['price'], it['group'],
                   ef[0] if ef else '', ef[1] if ef else '', ef[2] if ef else '', ef[3] if ef else None,
                   round(it['kg'], 6) if it['kg'] else None, round(kg_col, 6) if kg_col else None,
                   round(it['kg'] * ef[3], 6) if ef and it['kg'] else None, it['how'], it['sure'],
                   f"{it['old']} {it['old_unit'] or ''}".strip() if it['old'] is not None else '', it['row']])
    for col, w in zip('ABCDEFGHIJKLMNOP', [11, 44, 6, 8, 14, 10, 40, 9, 10, 12, 10, 12, 44, 30, 14, 8]):
        sh.column_dimensions[col].width = w
    sh.freeze_panes = 'C2'
    gone = out.create_sheet('ตัดออก (ซ้ำ)')
    gone.append(['แถวในชีตเดิม', 'material_description', 'เหตุผล'])
    for d in dropped:
        gone.append(list(d))
    gone.column_dimensions['B'].width = 46
    gone.column_dimensions['C'].width = 22
    xlsx = ROOT / 'inbox' / 'Usagelist_EF.xlsx'
    out.save(xlsx)

    # ---------- SQL ----------
    labels = ',\n'.join(f"  ({lit(k)}, {lit(v[0])}, {lit(v[1])}, {lit(v[2])}, {lit(v[3])})" for k, v in LABEL.items())
    mats = ',\n'.join(f"  ({lit(it['material'])}, {lit(it['name'])}, {lit(it['unit'])}, {lit(it['price'] if isinstance(it['price'], (int, float)) else None)}, "
                      f"{lit(TGO[it['key']][0] if it['key'] in TGO else None)}, {lit(it['key'] if it['key'] in LABEL else None)}, {lit(it['kg'])})"
                      for it in items)
    sql = f"""-- Usagelist (Usage.xlsx) → EF + ตัวแปลงของวัสดุ SAP · scripts/import_cfo_usagelist.py · ผู้ใช้กำหนด 2026-11-02
-- รันใน activity01 หลัง db/act/cfo.sql และ inbox/import_cfp_tgo.sql · รันซ้ำได้ · {len(items)} วัสดุ (ตัดแถวซ้ำ {len(dropped)})
begin;
-- 1) ฉลากคาร์บอนฟุตพริ้นท์ของผลิตภัณฑ์ (ผู้ใช้หามา) = แถวของเราใน EF CFP ต่อท้ายรายการ อบก. · id CFP- ต่อเลขเดิม
create temp table lab (k text, name text, unit text, total numeric, reference text) on commit drop;
insert into lab values
{labels};
insert into public.mt_cfo_ef_ref (sheet, grp, name, unit, total, reference, sort_no, status)
select 'cfp', 'ฉลากคาร์บอนฟุตพริ้นท์ผลิตภัณฑ์', l.name, l.unit, l.total, l.reference,
  100000 + coalesce((select max(sort_no) - 100000 from public.mt_cfo_ef_ref where sheet = 'cfp' and sort_no >= 100000), 0) + row_number() over (order by l.k), 'Active'
from lab l where not exists (select 1 from public.mt_cfo_ef_ref r where r.sheet = 'cfp' and r.name = l.name);
update public.mt_cfo_ef_ref r set code = 'CFP-' || lpad((x.n + x.base)::text, 4, '0')
from (select id, row_number() over (order by sort_no, id) as n,
        coalesce((select max(substring(code from 5)::int) from public.mt_cfo_ef_ref where code ~ '^CFP-[0-9]+$'), 0) as base
      from public.mt_cfo_ef_ref where sheet = 'cfp' and code is null) x
where r.id = x.id;

-- 2) วัสดุ: EF (id ของ อบก. หรือฉลาก) + ตัวแปลง = หน่วย EF ต่อ 1 หน่วย SAP · ไม่มี EF / ไม่รู้น้ำหนัก = เก็บรายการไว้แต่ยังไม่คิด
create temp table ul (material text, name text, sap_unit text, price numeric, ef_code text, label text, factor numeric) on commit drop;
insert into ul values
{mats};
insert into public.mt_cfo_material (material, name, sap_unit, price, ef_ref_id, factor, scope_code, kind, status)
select u.material, u.name, u.sap_unit, u.price,
  coalesce((select id from public.mt_cfo_ef_ref where code = u.ef_code), (select r.id from public.mt_cfo_ef_ref r join lab l on l.name = r.name and r.sheet = 'cfp' where l.k = u.label limit 1)),
  u.factor, '3-1', 'usage', 'Active'
from ul u
on conflict (material) do update set name = excluded.name, sap_unit = excluded.sap_unit, price = coalesce(excluded.price, public.mt_cfo_material.price),
  ef_ref_id = coalesce(excluded.ef_ref_id, public.mt_cfo_material.ef_ref_id), factor = coalesce(excluded.factor, public.mt_cfo_material.factor), kind = 'usage';
commit;

-- ตรวจ: วัสดุจาก Usagelist ที่คิดค่าได้ (มี EF + ตัวแปลง) / ยังไม่ได้
select count(*) filter (where m.ef_ref_id is not null and m.factor is not null) as counted, count(*) filter (where m.ef_ref_id is null or m.factor is null) as not_yet
from public.mt_cfo_material m where m.material in (select material from (values {', '.join(f"({lit(it['material'])})" for it in items)}) v(material));
select code, name, unit, total from public.mt_cfo_ef_ref where grp = 'ฉลากคาร์บอนฟุตพริ้นท์ผลิตภัณฑ์' order by code;
"""
    target = ROOT / 'inbox' / 'import_cfo_usagelist.sql'
    target.write_text(sql, encoding='utf-8', newline='\n')
    sys.stdout.reconfigure(encoding='utf-8')
    ok = sum(1 for it in items if it['ef'] and it['kg'])
    print(f'{xlsx.relative_to(ROOT)} + {target.relative_to(ROOT)} · {len(items)} วัสดุ · ตัดซ้ำ {len(dropped)} · คิดได้ {ok} · มี EF แต่ไม่รู้น้ำหนัก '
          f'{sum(1 for it in items if it["ef"] and not it["kg"])} · ยังไม่มี EF {sum(1 for it in items if not it["ef"])}')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'C:/Work/projects/Activity/CFO/inbox/Usage.xlsx')
