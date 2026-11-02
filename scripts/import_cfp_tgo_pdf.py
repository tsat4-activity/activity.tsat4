"""TGO "Emission Factor (CFP)" PDF -> inbox/import_cfp_tgo.sql (EF CFP table, mt_cfo_ef_ref sheet cfp).

    python -I scripts/import_cfp_tgo_pdf.py "C:/Work/projects/Activity/CFO/inbox/ts_9ad4f2f7d6.pdf"

The PDF (thaicarbonlabel.tgo.or.th, กรกฎาคม 2569) lists 539 items by industry group: ลำดับ · ชื่อ · รายละเอียด · หน่วย ·
ค่าแฟคเตอร์ (kgCO2e/หน่วย) · แหล่งข้อมูลอ้างอิง · วันที่อัพเดท. Each cell is rebuilt from its characters in the PDF's stream order
(reading order; sorting by position puts Thai marks after the wrong consonant) and ำ is restored (its nikhahit is not extracted).
The SQL (ผู้ใช้กำหนด 2026-11-02): TGO rows first in PDF order, the user's own rows after them; a user row with the same name and
unit as a TGO row is removed (materials that used it move to the TGO row) · ids renumbered CFP-0001 … · safe to re-run.
"""
import json
import re
import sys
import warnings
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parent.parent
MARKS = {0x0E31, *range(0x0E34, 0x0E3B), *range(0x0E47, 0x0E4F)}


def rebuild(chars):
    """Characters of one cell → text. The PDF draws Thai in reading order, so the characters keep the page's stream order
    (sorting by x puts vowel and tone marks after the wrong consonant). A new line or a gap becomes a space."""
    text, prev = '', None
    for c in chars:
        t = c['text']
        if prev is not None and t.strip():
            mark = ord(t[0]) in MARKS
            thai = lambda ch: 'ก' <= ch <= '๛'
            if abs(c['top'] - prev['top']) > 3.5:
                # a wrapped line: Thai words have no spaces, so Thai to Thai joins straight on
                if not (thai(t[0]) and thai(text.rstrip()[-1:] or ' ')):
                    text += ' '
            elif not mark and c['x0'] - prev['x1'] > 2.0:
                text += ' '
        text += t
        if t.strip() and ord(t[0]) not in MARKS:
            prev = c
        elif prev is None and t.strip():
            prev = c
    # ำ: its nikhahit has no character in this PDF and shows as a space before า, before or after a tone mark
    # (น ้า / ล า → น้ำ / ลำ) · า never starts a word, so a space before it is never a real word break
    text = re.sub(r'([ก-ฮ])(?:\s+([่-๋]?)|([่-๋])\s+)า', lambda m: m.group(1) + (m.group(2) or m.group(3) or '') + 'ำ', text)
    return re.sub(r'\s+', ' ', text.replace('ํา', 'ำ')).strip()


def num(v):
    text = str(v).replace(',', '').strip()
    sci = re.match(r'^([\d.]+)\s*[x×]\s*10\s*([-−]?\d+)$', text)  # 5.59x10-10 = 5.59 × 10⁻¹⁰ (superscript lost in the PDF)
    if sci:
        return float(sci.group(1)) * 10 ** int(sci.group(2).replace('−', '-'))
    try:
        return float(text)
    except ValueError:
        return None


def extract(pdf_path):
    rows, group = [], None
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            for table in page.find_tables():
                for r in table.rows:
                    cells = [rebuild([c for c in page.chars if cell and cell[0] - 0.5 <= c['x0'] <= cell[2] and cell[1] - 0.5 <= c['top'] <= cell[3]]) if cell else '' for cell in r.cells]
                    first = cells[0] if cells else ''
                    if not any(cells) or first.startswith('ล') and 'ชื่อ' in ''.join(cells[1:3]):
                        continue  # header row
                    g = re.match(r'^\d+\.\s*(กลุ่ม.*?)(?:\s*\(\d+\s*รายการ\))?$', first)
                    if g and not any(cells[1:]):
                        group = g.group(1).strip()
                        continue
                    item = re.match(r'^(\d+)\.?$', first)
                    if item and len(cells) >= 7:
                        rows.append({'grp': group, 'item_no': item.group(1), 'name': cells[1], 'formula': cells[2], 'unit': cells[3],
                                     'total': num(cells[4]), 'reference': cells[5], 'remark': cells[6]})
                    elif rows and not first and any(cells[1:]):
                        # a row split over a page break: the rest of the text goes to the row above
                        last = rows[-1]
                        for k, v in zip(['name', 'formula', 'unit', None, 'reference', 'remark'], cells[1:7]):
                            if k and v:
                                last[k] = f'{last[k]} {v}'.strip()
    return rows


def lit(v):
    if v is None or v == '':
        return 'null'
    if isinstance(v, (int, float)):
        return repr(v) if not float(v).is_integer() else str(int(v))
    return "'" + str(v).replace("'", "''") + "'"


def main(pdf_path):
    warnings.simplefilter('ignore')
    rows = extract(pdf_path)
    (ROOT / 'inbox' / 'cfp_tgo.json').write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding='utf-8')
    values = ',\n'.join(f"  ({i}, {lit(r['grp'])}, {lit(r['item_no'])}, {lit(r['name'])}, {lit(r['formula'])}, {lit(r['unit'])}, {lit(r['total'])}, {lit(r['reference'])}, {lit(r['remark'])})"
                        for i, r in enumerate(rows, start=1))
    sql = f"""-- EF CFP ของ อบก. ({len(rows)} รายการ จาก PDF) · scripts/import_cfp_tgo_pdf.py · รันใน activity01 หลัง db/act/cfo.sql · รันซ้ำได้
-- ผลที่ได้: รายการ อบก. อยู่ก่อนตามลำดับใน PDF · รายการเดิมของผู้ใช้ต่อท้าย · รายการเดิมที่ชื่อ + หน่วยซ้ำกับของ อบก. ถูกลบ
-- (วัสดุที่จับคู่ไว้ย้ายไปใช้ของ อบก.) · id เรียงใหม่ CFP-0001 …
begin;
create temp table tgo (seq int, grp text, item_no text, name text, formula text, unit text, total numeric, reference text, remark text) on commit drop;
insert into tgo values
{values};

-- 1) รายการ อบก. ที่ยังไม่มี (ชื่อ + หน่วย + รายละเอียด เดียวกัน = มีแล้ว ไม่เพิ่มซ้ำตอนรันรอบสอง)
insert into public.mt_cfo_ef_ref (sheet, grp, item_no, name, formula, unit, total, reference, remark, sort_no, status)
select 'cfp', t.grp, t.item_no, t.name, t.formula, t.unit, t.total, t.reference, t.remark, t.seq, 'Active'
from tgo t
where not exists (select 1 from public.mt_cfo_ef_ref r where r.sheet = 'cfp' and lower(trim(r.name)) = lower(trim(t.name))
  and lower(coalesce(r.unit, '')) = lower(coalesce(t.unit, '')) and coalesce(r.formula, '') = coalesce(t.formula, ''));

-- แถวของ อบก. ในตาราง (ตัวแรกของแต่ละ seq) และรายการเดิมที่ซ้ำ (ชื่อ + หน่วยตรงกับ อบก. แต่ไม่ใช่แถวของ อบก.)
create temp table tgo_row on commit drop as
select distinct on (t.seq) t.seq, r.id from tgo t
join public.mt_cfo_ef_ref r on r.sheet = 'cfp' and lower(trim(r.name)) = lower(trim(t.name))
  and lower(coalesce(r.unit, '')) = lower(coalesce(t.unit, '')) and coalesce(r.formula, '') = coalesce(t.formula, '')
order by t.seq, r.id;
create temp table dup on commit drop as
select r.id as old_id, (select g.id from tgo_row g join tgo t on t.seq = g.seq where lower(trim(t.name)) = lower(trim(r.name))
  and lower(coalesce(t.unit, '')) = lower(coalesce(r.unit, '')) order by g.seq limit 1) as new_id
from public.mt_cfo_ef_ref r
where r.sheet = 'cfp' and r.id not in (select id from tgo_row)
  and exists (select 1 from tgo t where lower(trim(t.name)) = lower(trim(r.name)) and lower(coalesce(t.unit, '')) = lower(coalesce(r.unit, '')));

-- 2) วัสดุที่จับคู่กับรายการเดิมที่ซ้ำ → ใช้ของ อบก. แล้วลบรายการเดิมที่ซ้ำ
update public.mt_cfo_material m set ef_ref_id = d.new_id from dup d where m.ef_ref_id = d.old_id;
delete from public.mt_cfo_ef_ref where id in (select old_id from dup);

-- 3) เรียงใหม่: อบก. ตามลำดับ PDF (1 …) แล้วรายการเดิมของผู้ใช้ต่อท้าย · id CFP-0001 … ตามลำดับนั้น
update public.mt_cfo_ef_ref r set sort_no = g.seq from tgo_row g where r.id = g.id;
update public.mt_cfo_ef_ref r set sort_no = 100000 + x.n
from (select id, row_number() over (order by sort_no, id) as n from public.mt_cfo_ef_ref where sheet = 'cfp' and id not in (select id from tgo_row)) x
where r.id = x.id;
update public.mt_cfo_ef_ref set code = null where sheet = 'cfp';
update public.mt_cfo_ef_ref r set code = 'CFP-' || lpad(x.n::text, 4, '0')
from (select id, row_number() over (order by sort_no, id) as n from public.mt_cfo_ef_ref where sheet = 'cfp') x
where r.id = x.id;
commit;

-- ตรวจ: จำนวนของ อบก. / ของเดิมที่เหลือ และ 5 แถวแรก
select count(*) filter (where sort_no < 100000) as tgo, count(*) filter (where sort_no >= 100000) as own from public.mt_cfo_ef_ref where sheet = 'cfp';
select code, grp, item_no, name, unit, total from public.mt_cfo_ef_ref where sheet = 'cfp' order by sort_no limit 5;
"""
    target = ROOT / 'inbox' / 'import_cfp_tgo.sql'
    target.write_text(sql, encoding='utf-8', newline='\n')
    groups = {}
    for r in rows:
        groups[r['grp']] = groups.get(r['grp'], 0) + 1
    sys.stdout.reconfigure(encoding='utf-8')
    print(f'{target.relative_to(ROOT)} written · {len(rows)} items · {len(groups)} groups')
    for g, n in groups.items():
        print(f'  {n:4} {g}')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'inbox' / 'ts_9ad4f2f7d6.pdf')
