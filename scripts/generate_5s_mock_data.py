import random
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).resolve().parent.parent

# 34 Areas and their owners (from master_5s.xlsx / inbox/import_5s_setup.sql)
AREAS = [
    ('A01', 'โรงงาน', 'HDF', '2103918'),
    ('A02', 'โรงงาน', 'SHOP DIE', '2103411'),
    ('A03', 'โรงงาน', 'SHOP MTN', '2102396'),
    ('A04', 'โรงงาน', 'SHOP JIG', '2101728'),
    ('A05', 'โรงงาน', 'WH,DEL', '2103906'),
    ('A06', 'โรงงาน', 'RACK', '2101643'),
    ('A07', 'โรงงาน', 'HRM EXT', '2103895'),
    ('A08', 'โรงงาน', 'QA IQA', '2101974'),
    ('A09', 'โรงงาน', 'QA PD1,2', '2102194'),
    ('A10', 'โรงงาน', 'QA PD3,4', '2103864'),
    ('A11', 'โรงงาน', 'LINE C,D,E PD1', '2102613'),
    ('A12', 'โรงงาน', 'LINE A PD1', '2102695'),
    ('A13', 'โรงงาน', 'LINE B PD1', '2102613'),
    ('A14', 'โรงงาน', 'ASSY PD2', '2101991'),
    ('A15', 'โรงงาน', 'ASSY PD3', '2101990'),
    ('A16', 'โรงงาน', 'ASSY PD4', '2103669'),
    ('A17', 'โรงงาน', 'STO RAW', '2102159'),
    ('A18', 'โรงงาน', 'STO SEMI', '2102159'),
    ('A19', 'โรงงาน', 'STO PUR', '2102159'),
    ('B01', 'สำนักงาน', 'ACC', '2103127'),
    ('B02', 'สำนักงาน', 'HRM', '2102597'),
    ('B03', 'สำนักงาน', 'QSM,PUR', '2103270'),
    ('B04', 'สำนักงาน', 'PE', '2102652'),
    ('B05', 'สำนักงาน', 'PLN,STO,SALE', '2101999'),
    ('B06', 'สำนักงาน', 'PD1,2', '2103523'),
    ('B07', 'สำนักงาน', 'PD3', '2103790'),
    ('B08', 'สำนักงาน', 'PD4,JIG', '2101861'),
    ('B09', 'สำนักงาน', 'MTN', '2102600'),
    ('B10', 'สำนักงาน', 'DIE', '2102600'),
    ('B11', 'สำนักงาน', 'QA', '2103724'),
    ('B12', 'สำนักงาน', 'QA CMM1', '2101741'),
    ('B13', 'สำนักงาน', 'QA CMM2', '2103724'),
    ('B14', 'สำนักงาน', 'CIC', '2102569'),
    ('B15', 'สำนักงาน', 'WH,DEL', '2103433'),
]

# Committee team assignments and auditors
AREA_TEAM = {
    'A01': ('H', ['2102901', '2103906']),
    'A02': ('D', ['2101990', '2103396']),
    'A03': ('D', ['2101990', '2103396']),
    'A04': ('D', ['2101990', '2103396']),
    'A05': ('I', ['2102396', '2103864']),
    'A06': ('B', ['2102899']),
    'A07': ('B', ['2102899']),
    'A08': ('D', ['2101990', '2103396']),
    'A09': ('F', ['2103391', '2103669']),
    'A10': ('H', ['2102901', '2103906']),
    'A11': ('E', ['2101946', '2103570']),
    'A12': ('F', ['2103391', '2103669']),
    'A13': ('E', ['2101946', '2103570']),
    'A14': ('F', ['2103391', '2103669']),
    'A15': ('H', ['2102901', '2103906']),
    'A16': ('H', ['2102901', '2103906']),
    'A17': ('D', ['2101990', '2103396']),
    'A18': ('F', ['2103391', '2103669']),
    'A19': ('F', ['2103391', '2103669']),
    'B01': ('C', ['2101861']),
    'B02': ('G', ['2101744', '2103865']),
    'B03': ('C', ['2101861']),
    'B04': ('C', ['2101861']),
    'B05': ('C', ['2101861']),
    'B06': ('G', ['2101744', '2103865']),
    'B07': ('A', ['2103100']),
    'B08': ('A', ['2103100']),
    'B09': ('A', ['2103100']),
    'B10': ('A', ['2103100']),
    'B11': ('G', ['2101744', '2103865']),
    'B12': ('G', ['2101744', '2103865']),
    'B13': ('H', ['2102901', '2103906']),
    'B14': ('A', ['2103100']),
    'B15': ('B', ['2102899']),
}

def generate_item_scores(target_total):
    """Generate 25 scores between 1 and 5 that sum exactly to target_total."""
    # Start with all 4s (sum = 100)
    scores = [4] * 25
    diff = target_total - 100
    if diff > 0:
        # Increase some 4s to 5s
        indices = list(range(25))
        random.shuffle(indices)
        for i in range(diff):
            scores[indices[i]] = 5
    elif diff < 0:
        # Decrease some 4s to 3s
        indices = list(range(25))
        random.shuffle(indices)
        for i in range(abs(diff)):
            scores[indices[i]] = 3
    # Add slight natural jitter if possible while keeping exact sum
    for _ in range(random.randint(1, 3)):
        cand_plus = [i for i in range(25) if scores[i] < 5]
        cand_minus = [i for i in range(25) if scores[i] > 3]
        if cand_plus and cand_minus:
            p = random.choice(cand_plus)
            m = random.choice(cand_minus)
            if p != m:
                scores[p] += 1
                scores[m] -= 1
    assert sum(scores) == target_total
    return scores

def generate_sql():
    random.seed(20261102)
    audits = [] # (audit_no, year, audit_type, code, team, auditors_sql, receivers_sql, audited_at, total, percent, result, status)
    scores = [] # (audit_no, item_no, score)

    # 1. Self Audit: months 1 to 11 (January to November 2026)
    # Taught: before 10th of the month, score 83% - 92% (total 104 to 115)
    for m in range(1, 12):
        for code, area_type, name, owner in AREAS:
            day = random.randint(4, 8)
            hour = random.randint(9, 15)
            minute = random.randint(5, 55)
            second = random.randint(10, 50)
            date_str = f"2026-{m:02d}-{day:02d} {hour:02d}:{minute:02d}:{second:02d}+07"
            audit_no = f"S-{code}-{day:02d}{m:02d}26-01"
            
            # Target score between 83% and 92%: total between 104 and 115 (out of 125)
            # 104 / 125 = 83.2%, 115 / 125 = 92.0%
            total = random.randint(104, 115)
            pct = round((total / 125.0) * 100.0, 2)
            result = 'PASS'
            
            audits.append((
                audit_no, 2026, 'SELF', code, 'null::text',
                f"array['{owner}']::text[]", "'{}'::text[]",
                f"'{date_str}'::timestamptz", total, pct, result, 'COMPLETED'
            ))
            
            item_scores = generate_item_scores(total)
            for item_no, sc in enumerate(item_scores, start=1):
                scores.append((audit_no, item_no, sc))

    # 2. Committee Audit: every 3 months starting from March (months 3, 6, 9)
    # Taught: score 80% - 90% (total 100 to 112)
    committee_months = [(3, 16, 22), (6, 16, 22), (9, 4, 8)]
    for m, day_start, day_end in committee_months:
        for code, area_type, name, owner in AREAS:
            team, aud_list = AREA_TEAM.get(code, ('A', ['2103100']))
            aud_sql = "array[" + ", ".join(f"'{x}'" for x in aud_list) + "]::text[]"
            rec_sql = f"array['{owner}']::text[]"
            day = random.randint(day_start, day_end)
            hour = random.randint(9, 16)
            minute = random.randint(5, 55)
            second = random.randint(10, 50)
            date_str = f"2026-{m:02d}-{day:02d} {hour:02d}:{minute:02d}:{second:02d}+07"
            audit_no = f"C-{code}-{day:02d}{m:02d}26-01"

            # Target score between 80% and 90%: total between 100 and 112 (out of 125)
            # 100 / 125 = 80.0%, 112 / 125 = 89.6%
            total = random.randint(100, 112)
            pct = round((total / 125.0) * 100.0, 2)
            result = 'PASS'

            audits.append((
                audit_no, 2026, 'COMMITTEE', code, f"'{team}'::text",
                aud_sql, rec_sql, f"'{date_str}'::timestamptz",
                total, pct, result, 'COMPLETED'
            ))

            item_scores = generate_item_scores(total)
            for item_no, sc in enumerate(item_scores, start=1):
                scores.append((audit_no, item_no, sc))

    print(f"Generated {len(audits)} audits ({len(scores)} item scores)")
    self_audits = [a for a in audits if a[2] == 'SELF']
    comm_audits = [a for a in audits if a[2] == 'COMMITTEE']
    self_avg = sum(a[9] for a in self_audits) / len(self_audits)
    comm_avg = sum(a[9] for a in comm_audits) / len(comm_audits)
    print(f"Self Audits: {len(self_audits)} rows · Avg: {self_avg:.2f}% (min {min(a[9] for a in self_audits)}%, max {max(a[9] for a in self_audits)}%)")
    print(f"Committee Audits: {len(comm_audits)} rows · Avg: {comm_avg:.2f}% (min {min(a[9] for a in comm_audits)}%, max {max(a[9] for a in comm_audits)}%)")

    # Format into SQL file
    out = []
    out.append("-- Mock 5S Audits for 2026")
    out.append("-- Self Audit: Months 1-11 (Jan-Nov), before 10th of each month, score 83%-92% for all 34 areas")
    out.append("-- Committee Audit: Months 3, 6, 9 (Mar, Jun, Sep), score 80%-90% for all 34 areas")
    out.append("-- (December excluded per user request)")
    out.append("begin;\n")

    # Insert audits in chunks of 100
    out.append("-- 1. Insert audits")
    out.append("insert into public.tx_5s_audit (audit_no, year, audit_type, area_id, team, auditors, receivers, audited_at, total_score, percent_score, result, status)")
    out.append("select v.audit_no, v.year, v.audit_type, ar.id, v.team, v.auditors, v.receivers, v.audited_at, v.total, v.percent, v.result, v.status from (values")
    
    audit_vals = []
    for a in audits:
        audit_vals.append(f"  ('{a[0]}'::text, {a[1]}::integer, '{a[2]}'::text, '{a[3]}'::text, {a[4]}, {a[5]}, {a[6]}, {a[7]}, {a[8]}::numeric, {a[9]}::numeric, '{a[10]}'::text, '{a[11]}'::text)")
    out.append(",\n".join(audit_vals))
    out.append(") v(audit_no, year, audit_type, code, team, auditors, receivers, audited_at, total, percent, result, status)")
    out.append("join public.mt_5s_area ar on ar.code = v.code")
    out.append("on conflict (audit_no) do update set")
    out.append("  audited_at = excluded.audited_at, total_score = excluded.total_score, percent_score = excluded.percent_score, result = excluded.result, status = excluded.status;\n")

    # Insert scores in chunks of 500
    out.append("-- 2. Insert audit scores")
    chunk_size = 500
    for idx in range(0, len(scores), chunk_size):
        chunk = scores[idx:idx + chunk_size]
        out.append("insert into public.tx_5s_audit_score (audit_id, checklist_id, score)")
        out.append("select au.id, c.id, v.score from (values")
        chunk_vals = [f"  ('{s[0]}'::text, {s[1]}::integer, {s[2]}::numeric)" for s in chunk]
        out.append(",\n".join(chunk_vals))
        out.append(") v(audit_no, item_no, score)")
        out.append("join public.tx_5s_audit au on au.audit_no = v.audit_no")
        out.append("join public.mt_5s_checklist c on c.year = au.year and c.item_no = v.item_no")
        out.append("on conflict (audit_id, checklist_id) do update set score = excluded.score;\n")

    out.append("commit;\n")
    out.append("-- Verification count")
    out.append("select audit_type, count(*), round(avg(percent_score), 2) as avg_percent from public.tx_5s_audit where year = 2026 group by audit_type;")

    sql_path = ROOT / "inbox" / "mock_5s_audits_2026.sql"
    sql_path.write_text("\n".join(out), encoding="utf-8")
    print(f"Saved to {sql_path} ({sql_path.stat().st_size:,} bytes)")

if __name__ == "__main__":
    generate_sql()
