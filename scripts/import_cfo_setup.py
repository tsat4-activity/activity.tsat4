"""CFO set-up from the user's mt_cfo.xlsx -> inbox/import_cfo_setup.sql (team, company, activities with their EF).

    python -I scripts/import_cfo_setup.py "C:/Work/projects/Activity/CFO/inbox/mt_cfo.xlsx" [year]

Sheets: mt_org (team + role) · mt_company (company form Fr-01) · scope (emission_source · department · activity_name ·
description · Detail). Each activity takes its EF from the reference tables (db/act/cfo_ef_ref_seed.sql) the way the
activity form does (server efFromRef): the reference row is copied into mt_cfo_ef as ref:<id>:<category>, B7 / E85
"Report in Scope 1" carries the biogenic CO2 of its pair row, electricity also gets the 3-3 line (การได้มาของไฟฟ้า).
Run after db/act/cfo.sql + db/act/cfo_ef_ref_seed.sql. Re-running updates the same rows (codes xl-<row>).
Category rule (ผู้ใช้ 2026-11-01 "แบ่งประเภทให้ก่อน"): Detail "รถบริษัทเช่า" = company controls the car → Scope 1 (1-2);
"รถส่วนตัว" = the car is not the company's → Scope 3-6 (การเดินทางเพื่อธุรกิจ). Set PRIVATE_CAR = '1-2' to keep them in Scope 1.
"""
import sys
import warnings
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
PRIVATE_CAR = '3-6'
ROLES = {'ประธาน': 'chairman', 'รองประธาน': 'vice', 'ผู้จัดทำ': 'admin', 'ที่ปรึกษา': 'advisor', 'สมาชิก': 'member'}
COMPANY = ['company_name', 'company_address', 'company_area', 'company_business', 'company_customers', 'company_employees', 'company_updated', 'company_photo1', 'company_photo2']
# reference row of each emission source (sheet, sort_no, name as in the seed) + its biogenic pair; the values match the
# EF the old CFO workbook used (B7 on-road 2.5504, E85 on-road 0.3439, LPG off-road 3.2057 / stationary 3.1133 ...)
REF = {
    ('- Diesel (B7): Report in Scope 1', 'car'): ('energy', 116, '- Diesel (B7): Report in Scope 1', 117),
    ('- Gasohol: E85 report in Scope 1', 'car'): ('energy', 137, '- Gasohol: E85 report in Scope 1', 138),
    ('- Gasohol: E85 report in Scope 1', 'other'): ('energy', 32, '- Gasohol: E85 report in Scope 1', 33),
    ('- Diesel B7: Report in Scope 1', 'other'): ('energy', 20, '- Diesel B7: Report in Scope 1', 21),
    ('LPG: kg', 'forklift'): ('energy', 63, 'LPG: kg', None),
    ('LPG: kg', 'other'): ('energy', 6, 'LPG: kg', None),
    ('R-22 (HCFC-22)', 'other'): ('chemical', 2, 'R-22 (HCFC-22)', None),
    ('R-32', 'other'): ('chemical', 3, 'R-32', None),
}
ELECTRIC = ('energy', 143, 'ไฟฟ้าแบบ grid mix ปี 2022-2024; LCIA method IPCC 2013 GWP 100a V1.03 (CFO Scope2)')
ELECTRIC_3 = ('energy', 144, 'ไฟฟ้าแบบ grid mix ปี 2022-2024; การได้มาซึ่งเชื้อเพลิงรวมถึงการขนส่งเชื้อเพลิงที่ใช้ในการผลิตไฟฟ้าสำหรับ SCOPE 3)')


def q(v):
    if v is None:
        return 'null'
    return "'" + str(v).replace("'", "''") + "'"


def txt(v):
    s = ' '.join(str(v or '').replace('\xa0', ' ').split())
    return s or None


def ref_row(sheet, sort_no, name):
    return f"(select r.id from public.mt_cfo_ef_ref r where r.sheet = {q(sheet)} and r.sort_no = {sort_no} and r.name = {q(name)})"


def copy_ref(sheet, sort_no, name, scope, bio=None):
    """SQL that copies one reference row into mt_cfo_ef (same columns as server efFromRef)."""
    pair = f"(select b.total from public.mt_cfo_ef_ref b where b.sheet = 'energy' and b.sort_no = {bio} and b.name ilike '%biogenic%')" if bio else 'null'
    non_kyoto = 'HCFC' in name
    gas = "r.co2, r.ch4_fossil, r.ch4, r.n2o" if sheet == 'energy' else 'null, null, null, null'
    hfc = "1, r.total" if sheet == 'chemical' and not non_kyoto else 'null, null'
    other = "1, r.total" if non_kyoto else 'null, null'
    kg = '0' if non_kyoto else 'r.total'
    return (f"insert into public.mt_cfo_ef (code, scope_code, kind, name, detail, unit, reference, year, status, source_type, separate, kgco2e, co2, ch4_fossil, ch4, n2o, hfc, hfc_gwp, other, other_gwp, co2_bio)\n"
            f"select 'ref:' || r.id || ':{scope}', '{scope}', r.grp, regexp_replace(r.name, '^-\\s*', ''), r.formula, r.unit, r.reference, 2026, 'Active', 'tgo', {'true' if non_kyoto else 'false'}, {kg}, {gas}, {hfc}, {other}, {pair}\n"
            f"from public.mt_cfo_ef_ref r where r.id = {ref_row(sheet, sort_no, name)}\non conflict (code) do nothing;")


def ef_id_of(sheet, sort_no, name, scope):
    return f"(select f.id from public.mt_cfo_ef f where f.code = 'ref:' || {ref_row(sheet, sort_no, name)} || ':{scope}')"


def main(book_path, year):
    warnings.simplefilter('ignore')
    book = openpyxl.load_workbook(book_path, read_only=True, data_only=True)
    out = [f'-- CFO ตั้งต้นจาก mt_cfo.xlsx (scripts/import_cfo_setup.py) · ทีมปี {year} · ข้อมูลบริษัท · กิจกรรม 34 รายการพร้อม EF',
           '-- รันใน Tx Data หลัง db/act/cfo.sql + db/act/cfo_ef_ref_seed.sql · รันซ้ำได้', 'begin;', '']
    # team
    team = []
    for r in book['mt_org'].iter_rows(min_row=2, values_only=True):
        emp, dept, role = txt(r[0]), txt(r[6]), ROLES.get(txt(r[8]) or '')
        if emp and role:
            team.append(f"  ({year}, {q(emp)}, {q(role)}, {q(dept if role == 'member' else None)})")
    out += ['insert into public.mt_cfo_team (year, employee_id, role, department) values', ',\n'.join(team), 'on conflict do nothing;', '']
    # company (Fr-01)
    c = next(book['mt_company'].iter_rows(min_row=2, max_row=2, values_only=True))
    values = [(k, (c[i].strftime('%Y-%m-%d') if hasattr(c[i], 'strftime') else txt(c[i]))) for i, k in enumerate(COMPANY)]
    out += ['insert into public.mt_cfo_setting (key, value) values', ',\n'.join(f'  ({q(k)}, {q(v)})' for k, v in values if v),
            'on conflict (key) do update set value = excluded.value;', '']
    # fixed EF: welding CO2 (1 kg CO2 / kg) and septic tank (kg CH4 × GWP CH4, as server efSeptic)
    out += ["insert into public.mt_cfo_ef (code, scope_code, name, unit, kgco2e, co2, reference, year, status) values",
            "  ('co2-gas:1-1', '1-1', 'CO2 (แก๊สเชื่อม)', 'kg', 1, 1, 'ก๊าซ CO2 ที่ใช้ = การปล่อยโดยตรง 1 kg CO2 / kg', 2026, 'Active'),",
            "  ('septic:1-4', '1-4', 'Septic Tank (kg CH₄ × GWP CH₄)', 'kg CH4', 28, null, 'IPCC 2006 Vol.5 ch.6 (บ่อเกรอะ)', 2026, 'Active')",
            'on conflict (code) do nothing;', '']
    acts, copies, report = [], [], []
    for i, r in enumerate(book['scope'].iter_rows(min_row=2, values_only=True), start=2):
        source, dept, name = txt(r[0]), txt(r[1]), txt(r[2])
        if not source or not name:
            continue
        detail = ' · '.join(x for x in (txt(r[3]), txt(r[4])) if x) or None
        calc, ef, ef3 = None, None, 'null'
        if source == 'CO2':
            scope, ef = '1-1', "(select id from public.mt_cfo_ef where code = 'co2-gas:1-1')"
        elif source == 'CH4':
            scope, calc, ef = '1-4', 'septic', "(select id from public.mt_cfo_ef where code = 'septic:1-4')"
        elif source.startswith('ไฟฟ้า'):
            scope = '2-1'
            copies += [copy_ref(*ELECTRIC, scope), copy_ref(*ELECTRIC_3, '3-3')]
            ef, ef3 = ef_id_of(*ELECTRIC, scope), ef_id_of(*ELECTRIC_3, '3-3')
        else:
            car = 'รถ' in name and 'โฟร์คลิฟท์' not in name
            use = 'car' if car else 'forklift' if 'โฟร์คลิฟท์' in name else 'other'
            sheet, sort_no, ref_name, bio = REF[(source, use)]
            scope = '1-4' if sheet == 'chemical' else '1-2' if use in ('car', 'forklift') else '1-1'
            if car and 'รถส่วนตัว' in (detail or ''):
                scope = PRIVATE_CAR
            copies.append(copy_ref(sheet, sort_no, ref_name, scope, bio))
            ef = ef_id_of(sheet, sort_no, ref_name, scope)
        acts.append(f"  ({q(f'xl-{i}')}, {ef}, {ef3}, 'AR5', {q(dept)}, {q(name)}, {q(detail)}, {q(calc)}, 'Active')")
        report.append(f'{scope:5} {dept:8} {name} · {detail or ""} ({source})')
    out += list(dict.fromkeys(copies)) + ['',
            'insert into public.mt_cfo_activity (code, ef_id, ef3_id, gwp_code, department, name, detail, calc, status) values', ',\n'.join(acts),
            'on conflict (code) do update set ef_id = excluded.ef_id, ef3_id = excluded.ef3_id, department = excluded.department, name = excluded.name, detail = excluded.detail, calc = excluded.calc;',
            '', 'commit;', '']
    target = ROOT / 'inbox' / 'import_cfo_setup.sql'
    target.write_text('\n'.join(out), encoding='utf-8', newline='\n')
    sys.stdout.reconfigure(encoding='utf-8')
    print(f'{target.relative_to(ROOT)} written · team {len(team)} · activities {len(acts)}')
    print('\n'.join(sorted(report)))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'inbox' / 'mt_cfo.xlsx', int(sys.argv[2]) if len(sys.argv) > 2 else 2026)
