import random
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).resolve().parent.parent

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

# Assign 34 areas across 9 teams (A to I):
# 34 areas / 9 teams = ~3.78 areas per team per round (7 teams with 4 areas, 2 teams with 3 areas)
# Team A: 4, Team B: 4, Team C: 4, Team D: 4, Team E: 4, Team F: 4, Team G: 4, Team H: 3, Team I: 3 = 34 total
AREA_TEAMS = {
    'A01': ('H', ['2102901', '2103906']),
    'A02': ('D', ['2101990', '2103396']),
    'A03': ('D', ['2101990', '2103396']),
    'A04': ('D', ['2101990', '2103396']),
    'A05': ('B', ['2102899']),
    'A06': ('B', ['2102899']),
    'A07': ('B', ['2102899']),
    'A08': ('D', ['2101990', '2103396']),
    'A09': ('F', ['2103391', '2103669']),
    'A10': ('H', ['2102901', '2103906']),
    'A11': ('E', ['2101946', '2103570']),
    'A12': ('E', ['2101946', '2103570']),
    'A13': ('E', ['2101946', '2103570']),
    'A14': ('E', ['2101946', '2103570']),
    'A15': ('I', ['2102396', '2103864']),
    'A16': ('I', ['2102396', '2103864']),
    'A17': ('F', ['2103391', '2103669']),
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
    'B14': ('I', ['2102396', '2103864']),
    'B15': ('B', ['2102899']),
}

# In Round 3 (Sep), Team I did not audit (both auditors absent).
# Team I's areas (A15, A16, B14) were redistributed to other teams to audit:
ROUND_3_REDISTRIBUTE = {
    'A15': ('A', ['2103100']),
    'A16': ('B', ['2102899']),
    'B14': ('C', ['2101861']),
}

# Auditors absent in Round 3 (September) based on attendance document:
ABSENT_ROUND_3 = {'2103396', '2101946', '2103391', '2102396', '2103864'}

# Assign each area to a week (1..4) for Committee audits
WEEKS_BY_CODE = {code: (i % 4) + 1 for i, (code, *_) in enumerate(AREAS)}

# Monthly target averages for Self Audit (Months 1..11: Jan - Nov)
# Strictly within 85.0% - 93.0% per user requirement
SELF_MONTH_BASE = [
    87.0,  # Jan ~87.0%
    88.2,  # Feb ~88.2%
    91.2,  # Mar ~91.2%
    86.8,  # Apr ~86.8%
    92.2,  # May ~92.2%
    89.8,  # Jun ~89.8%
    88.0,  # Jul ~88.0%
    92.4,  # Aug ~92.4%
    89.2,  # Sep ~89.2%
    87.5,  # Oct ~87.5%
    91.5,  # Nov ~91.5%
]

# Committee rounds: 3 rounds (Month 3, 6, 9)
# Spread across 84% - 90% (all above 80% pass threshold)
COMM_ROUNDS = {
    3: (1, 84.2),  # Mar (Round 1) ~84%
    6: (2, 89.2),  # Jun (Round 2) ~89%
    9: (3, 86.5),  # Sep (Round 3) ~86.5%
}

def generate_item_scores(target_total, rng):
    scores = [4] * 25
    diff = target_total - 100
    indices = list(range(25))
    rng.shuffle(indices)
    if diff > 0:
        for i in range(diff):
            scores[indices[i]] = 5
    elif diff < 0:
        for i in range(abs(diff)):
            scores[indices[i]] = 3
    # Add slight cross-pillar variation keeping sum exact
    for _ in range(rng.randint(2, 4)):
        cand_plus = [i for i in range(25) if scores[i] < 5]
        cand_minus = [i for i in range(25) if scores[i] > 3]
        if cand_plus and cand_minus:
            p = rng.choice(cand_plus)
            m = rng.choice(cand_minus)
            if p != m:
                scores[p] += 1
                scores[m] -= 1
    assert sum(scores) == target_total
    return scores

def generate_all():
    rng = random.Random(20261105)

    plans = []   # (year, code, month, week, round, team)
    audits = []  # (audit_no, year, audit_type, code, team, auditors_sql, receivers_sql, audited_at, total, percent, result, status)
    scores = []  # (audit_no, item_no, score)

    # 1. Committee Plans for months 3, 6, 9 (34 areas shared across teams A-I)
    for m, (round_no, base_pct) in COMM_ROUNDS.items():
        for code, area_type, name, owner in AREAS:
            team, aud_list = AREA_TEAMS[code]
            week = WEEKS_BY_CODE[code]
            plans.append((2026, code, m, week, round_no, team))

    # 2. Assign area target baselines distributed across 85.0% - 95.0%
    factory_areas = [a for a in AREAS if a[1] == 'โรงงาน']
    office_areas = [a for a in AREAS if a[1] == 'สำนักงาน']

    # Deterministic pseudo-random order of areas for natural ranking distribution
    factory_order = list(factory_areas)
    office_order = list(office_areas)
    rng.shuffle(factory_order)
    rng.shuffle(office_order)

    # Spread target averages: Factory (19 areas) from 85.0% to 96.5%
    # Office (15 areas) from 85.0% to 96.5%
    factory_targets = {a[0]: 85.0 + i * (96.5 - 85.0) / 18.0 for i, a in enumerate(factory_order)}
    office_targets = {a[0]: 85.0 + i * (96.5 - 85.0) / 14.0 for i, a in enumerate(office_order)}
    area_targets = {**factory_targets, **office_targets}

    mean_month_base = sum(SELF_MONTH_BASE) / len(SELF_MONTH_BASE)

    # Generate initial integer totals out of 125 for Self Audits (months 1..11 x 34 areas)
    self_totals = {}
    for code, *_ in AREAS:
        for m in range(1, 12):
            base = area_targets[code] + (SELF_MONTH_BASE[m - 1] - mean_month_base)
            noise = rng.uniform(-0.5, 0.5)
            pct = base + noise
            tot = int(round((pct / 100.0) * 125))
            tot = min(120, max(104, tot))
            self_totals[(code, m)] = tot

    # Balancing pass 1: Guarantee every area's yearly average is strictly in [85.0%, 95.0%]
    for code, *_ in AREAS:
        for _ in range(50):
            avg_a = sum(self_totals[(code, m)] for m in range(1, 12)) / (11.0 * 125.0) * 100.0
            if avg_a < 85.0:
                min_m = min(range(1, 12), key=lambda m: self_totals[(code, m)])
                self_totals[(code, min_m)] += 1
            elif avg_a > 95.0:
                max_m = max(range(1, 12), key=lambda m: self_totals[(code, m)])
                self_totals[(code, max_m)] -= 1
            else:
                break

    # Balancing pass 2: Guarantee every month's average is strictly in [85.5%, 92.5%]
    for m in range(1, 12):
        for _ in range(50):
            avg_m = sum(self_totals[(c, m)] for c, *_ in AREAS) / (len(AREAS) * 125.0) * 100.0
            if avg_m < 85.5:
                cand = min(AREAS, key=lambda a: self_totals[(a[0], m)])
                self_totals[(cand[0], m)] += 1
            elif avg_m > 92.5:
                cand = max(AREAS, key=lambda a: self_totals[(a[0], m)])
                self_totals[(cand[0], m)] -= 1
            else:
                break

    # Final verification of Self Audit bounds
    for code, *_ in AREAS:
        avg_a = sum(self_totals[(code, m)] for m in range(1, 12)) / (11.0 * 125.0) * 100.0
        if avg_a < 85.2:
            min_m = min(range(1, 12), key=lambda m: self_totals[(code, m)])
            self_totals[(code, min_m)] += 1
        elif avg_a > 94.8:
            max_m = max(range(1, 12), key=lambda m: self_totals[(code, m)])
            self_totals[(code, max_m)] -= 1

    for m in range(1, 12):
        avg_m = sum(self_totals[(c, m)] for c, *_ in AREAS) / (len(AREAS) * 125.0) * 100.0
        assert 85.0 <= avg_m <= 93.0, f"Month {m} avg {avg_m:.2f}% out of [85, 93]"

    # Build Self Audits
    for m in range(1, 12):
        for code_idx, (code, area_type, name, owner) in enumerate(AREAS):
            day = 4 + (code_idx % 5)  # days 4, 5, 6, 7, 8 (all before 10th)
            hour = 9 + (code_idx % 7)
            minute = 10 + (code_idx * 7) % 45
            date_str = f"2026-{m:02d}-{day:02d} {hour:02d}:{minute:02d}:00+07"
            audit_no = f"S-{code}-{day:02d}{m:02d}26-01"

            total = self_totals[(code, m)]
            pct = round((total / 125.0) * 100.0, 2)

            audits.append([
                audit_no, 2026, 'SELF', code, 'null::text',
                f"array['{owner}']::text[]", "'{}'::text[]",
                f"'{date_str}'::timestamptz", total, pct, 'PASS', 'COMPLETED'
            ])

            item_sc = generate_item_scores(total, rng)
            for it_no, sc in enumerate(item_sc, start=1):
                scores.append((audit_no, it_no, sc))

    # 3. Committee Audits: months 3, 6, 9
    for m, (round_no, base_pct) in COMM_ROUNDS.items():
        for code_idx, (code, area_type, name, owner) in enumerate(AREAS):
            team, aud_list = AREA_TEAMS[code]
            week = WEEKS_BY_CODE[code]
            day = (week - 1) * 7 + 2 + (code_idx % 5)
            hour = 9 + (code_idx % 7)
            minute = 10 + (code_idx * 11) % 45
            date_str = f"2026-{m:02d}-{day:02d} {hour:02d}:{minute:02d}:00+07"
            audit_no = f"C-{code}-{day:02d}{m:02d}26-01"

            if m == 9:
                if code in ROUND_3_REDISTRIBUTE:
                    audit_team, actual_auds = ROUND_3_REDISTRIBUTE[code]
                else:
                    audit_team = team
                    actual_auds = [x for x in aud_list if x not in ABSENT_ROUND_3]
            else:
                audit_team = team
                actual_auds = aud_list

            # Correlate committee score with area strength + round baseline
            area_offset = (area_targets[code] - 90.0) * 0.65
            noise = rng.uniform(-0.5, 0.5)
            target_pct = min(93.6, max(83.2, base_pct + area_offset + noise))
            total = int(round((target_pct / 100.0) * 125))
            total = min(117, max(104, total))
            pct = round((total / 125.0) * 100.0, 2)

            aud_sql = "array[" + ", ".join(f"'{x}'" for x in actual_auds) + "]::text[]"
            rec_sql = f"array['{owner}']::text[]"

            audits.append([
                audit_no, 2026, 'COMMITTEE', code, f"'{audit_team}'::text",
                aud_sql, rec_sql, f"'{date_str}'::timestamptz",
                total, pct, 'PASS', 'COMPLETED'
            ])

            item_sc = generate_item_scores(total, rng)
            for it_no, sc in enumerate(item_sc, start=1):
                scores.append((audit_no, it_no, sc))

    # Guarantee all 34 area combined averages are strictly within [85.0%, 95.0%]
    from collections import defaultdict
    for _ in range(30):
        area_map = defaultdict(list)
        for a in audits:
            area_map[a[3]].append(a)
        adjusted = False
        for code, a_list in area_map.items():
            avg_a = sum(a[9] for a in a_list) / len(a_list)
            if avg_a < 85.0:
                # Find audit with lowest score in this area and bump by 1 point
                min_a = min(a_list, key=lambda x: x[8])
                min_a[8] += 1
                min_a[9] = round((min_a[8] / 125.0) * 100.0, 2)
                # update item score
                for i, s in enumerate(scores):
                    if s[0] == min_a[0]:
                        scores[i] = (s[0], s[1], s[2] + 1)
                        break
                adjusted = True
        if not adjusted:
            break

    # Stats
    self_audits = [a for a in audits if a[2] == 'SELF']
    comm_audits = [a for a in audits if a[2] == 'COMMITTEE']
    print(f"Plans: {len(plans)} rows (months 3, 6, 9 x 34 areas)")
    print(f"Self Audits: {len(self_audits)} rows · Min: {min(a[9] for a in self_audits)}% · Max: {max(a[9] for a in self_audits)}%")
    print(f"Committee Audits: {len(comm_audits)} rows · Min: {min(a[9] for a in comm_audits)}% · Max: {max(a[9] for a in comm_audits)}%")
    print("\nSelf monthly averages:")
    for m in range(1, 12):
        m_rows = [a for a in self_audits if f"-{m:02d}-" in a[7]]
        print(f"  Month {m:2d}: {sum(a[9] for a in m_rows)/len(m_rows):.2f}% ({len(m_rows)} audits)")
    print("\nCommittee monthly averages:")
    for m in [3, 6, 9]:
        m_rows = [a for a in comm_audits if f"-{m:02d}-" in a[7]]
        print(f"  Month {m:2d}: {sum(a[9] for a in m_rows)/len(m_rows):.2f}% ({len(m_rows)} audits)")

    # Print Ranking Summary (Self + Committee up to Month 11)
    print("\n=== Factory Area Ranking (Months 1-11) ===")
    from collections import defaultdict
    area_pcts = defaultdict(list)
    for a in audits:
        area_pcts[a[3]].append(a[9])
    
    f_rows = [(c, name, sum(area_pcts[c])/len(area_pcts[c])) for c, atype, name, _ in AREAS if atype == 'โรงงาน']
    f_rows.sort(key=lambda x: x[2], reverse=True)
    for rank_no, (c, name, avg_p) in enumerate(f_rows, 1):
        print(f"  {rank_no:2d}. {c} {name:<16}: {avg_p:.2f}%")

    print("\n=== Office Area Ranking (Months 1-11) ===")
    o_rows = [(c, name, sum(area_pcts[c])/len(area_pcts[c])) for c, atype, name, _ in AREAS if atype == 'สำนักงาน']
    o_rows.sort(key=lambda x: x[2], reverse=True)
    for rank_no, (c, name, avg_p) in enumerate(o_rows, 1):
        print(f"  {rank_no:2d}. {c} {name:<16}: {avg_p:.2f}%")

    # Build SQL
    out = []
    out.append("-- Mock 5S Plans and Audits for 2026")
    out.append("-- 1. Audit Plan (mt_5s_audit_plan): 3 rounds (Mar, Jun, Sep) x 34 areas scheduled in Weeks 1-4 with assigned teams A-I (102 rows total)")
    out.append("-- 2. Self Audit (tx_5s_audit): Months 1-11 (Jan-Nov), before 10th of each month, spread 82%-93% for all 34 areas (34 per month = 374 rows)")
    out.append("-- 3. Committee Audit (tx_5s_audit): Months 3, 6, 9 (Mar, Jun, Sep), strictly following the audit plan weeks and teams, spread 82%-90% (34 per month = 102 rows)")
    out.append("-- (December excluded per user request)")
    out.append("begin;\n")
    out.append("-- Reset existing 2026 audits and plans to ensure exact counts (34 areas per month, no duplicates)")
    out.append("delete from public.tx_5s_audit where year = 2026;")
    out.append("delete from public.mt_5s_audit_plan where year = 2026;\n")

    # 1. Insert plans
    out.append("-- 1. Insert committee audit plan")
    out.append("insert into public.mt_5s_audit_plan (year, area_id, month, week, round, team)")
    out.append("select v.year, ar.id, v.month, v.week, v.round, v.team from (values")
    plan_vals = [f"  ({p[0]}::integer, '{p[1]}'::text, {p[2]}::integer, {p[3]}::integer, {p[4]}::integer, '{p[5]}'::text)" for p in plans]
    out.append(",\n".join(plan_vals))
    out.append(") v(year, code, month, week, round, team)")
    out.append("join public.mt_5s_area ar on ar.code = v.code")
    out.append("on conflict (year, area_id, month, week) do update set round = excluded.round, team = excluded.team;\n")

    # 2. Insert audits
    out.append("-- 2. Insert audits")
    out.append("insert into public.tx_5s_audit (audit_no, year, audit_type, area_id, team, auditors, receivers, audited_at, total_score, percent_score, result, status)")
    out.append("select v.audit_no, v.year, v.audit_type, ar.id, v.team, v.auditors, v.receivers, v.audited_at, v.total, v.percent, v.result, v.status from (values")
    audit_vals = [f"  ('{a[0]}'::text, {a[1]}::integer, '{a[2]}'::text, '{a[3]}'::text, {a[4]}, {a[5]}, {a[6]}, {a[7]}, {a[8]}::numeric, {a[9]}::numeric, '{a[10]}'::text, '{a[11]}'::text)" for a in audits]
    out.append(",\n".join(audit_vals))
    out.append(") v(audit_no, year, audit_type, code, team, auditors, receivers, audited_at, total, percent, result, status)")
    out.append("join public.mt_5s_area ar on ar.code = v.code")
    out.append("on conflict (audit_no) do update set")
    out.append("  audited_at = excluded.audited_at, total_score = excluded.total_score, percent_score = excluded.percent_score, result = excluded.result, status = excluded.status;\n")

    # 3. Insert scores in chunks of 500
    out.append("-- 3. Insert audit scores")
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
    out.append("select count(*) as plans_count from public.mt_5s_audit_plan where year = 2026;")

    sql_path = ROOT / "inbox" / "mock_5s_audits_2026.sql"
    sql_path.write_text("\n".join(out), encoding="utf-8")
    print(f"\nWritten to {sql_path} ({sql_path.stat().st_size:,} bytes)")

if __name__ == "__main__":
    generate_all()
