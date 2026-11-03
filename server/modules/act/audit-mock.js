import { tx } from '../../core/db.js';
import { roundTo } from './common.js';

const AREA_OWNERS = {
  A01: '2103918', A02: '2103411', A03: '2102396', A04: '2101728', A05: '2103906',
  A06: '2101643', A07: '2103895', A08: '2101974', A09: '2102194', A10: '2103864',
  A11: '2102613', A12: '2102695', A13: '2102613', A14: '2101991', A15: '2101990',
  A16: '2103669', A17: '2102159', A18: '2102159', A19: '2102159', B01: '2103127',
  B02: '2102597', B03: '2103270', B04: '2102652', B05: '2101999', B06: '2103523',
  B07: '2103790', B08: '2101861', B09: '2102600', B10: '2102600', B11: '2103724',
  B12: '2101741', B13: '2103724', B14: '2102569', B15: '2103433'
};

// 34 areas divided across 9 teams (7 teams x 4 areas + 2 teams x 3 areas = 34)
const AREA_TEAMS = {
  A01: ['H', ['2102901', '2103906']], A02: ['D', ['2101990', '2103396']],
  A03: ['D', ['2101990', '2103396']], A04: ['D', ['2101990', '2103396']],
  A05: ['B', ['2102899']], A06: ['B', ['2102899']],
  A07: ['B', ['2102899']], A08: ['D', ['2101990', '2103396']],
  A09: ['F', ['2103391', '2103669']], A10: ['H', ['2102901', '2103906']],
  A11: ['E', ['2101946', '2103570']], A12: ['E', ['2101946', '2103570']],
  A13: ['E', ['2101946', '2103570']], A14: ['E', ['2101946', '2103570']],
  A15: ['I', ['2102396', '2103864']], A16: ['I', ['2102396', '2103864']],
  A17: ['F', ['2103391', '2103669']], A18: ['F', ['2103391', '2103669']],
  A19: ['F', ['2103391', '2103669']], B01: ['C', ['2101861']],
  B02: ['G', ['2101744', '2103865']], B03: ['C', ['2101861']],
  B04: ['C', ['2101861']], B05: ['C', ['2101861']],
  B06: ['G', ['2101744', '2103865']], B07: ['A', ['2103100']],
  B08: ['A', ['2103100']], B09: ['A', ['2103100']],
  B10: ['A', ['2103100']], B11: ['G', ['2101744', '2103865']],
  B12: ['G', ['2101744', '2103865']], B13: ['H', ['2102901', '2103906']],
  B14: ['I', ['2102396', '2103864']], B15: ['B', ['2102899']]
};

const ABSENT_ROUND_3 = new Set(['2103396', '2101946', '2103391', '2102396', '2103864']);

// Round 3 redistribution for Team I (both absent):
const ROUND_3_REDISTRIBUTE = {
  A15: ['A', ['2103100']],
  A16: ['B', ['2102899']],
  B14: ['C', ['2101861']]
};

const SELF_MONTH_BASE = [84.6, 87.2, 90.5, 83.5, 91.8, 88.4, 85.2, 92.5, 87.6, 84.2, 89.8];
const COMM_ROUNDS = { 3: [1, 83.6], 6: [2, 89.2], 9: [3, 86.4] };

function simpleRandom(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function generateScores(targetTotal, rand) {
  const scores = Array(25).fill(4);
  const diff = targetTotal - 100;
  if (diff > 0) {
    const indices = Array.from({ length: 25 }, (_, i) => i).sort(() => rand() - 0.5);
    for (let i = 0; i < diff; i++) scores[indices[i]] = 5;
  } else if (diff < 0) {
    const indices = Array.from({ length: 25 }, (_, i) => i).sort(() => rand() - 0.5);
    for (let i = 0; i < Math.abs(diff); i++) scores[indices[i]] = 3;
  }
  return scores;
}

export async function seed5sMockAudits(areas) {
  const checkRes = await tx.from('mt_5s_checklist').select('id,item_no').eq('year', 2026).order('item_no');
  if (checkRes.error || !checkRes.data?.length) return;
  const checkMap = new Map(checkRes.data.map((c) => [c.item_no, c.id]));

  const rand = simpleRandom(20261102);
  const plans = [];
  const audits = [];
  const scoreRowsMap = [];

  // Assign week 1..4 per area
  const weekByCode = new Map(areas.map((a, i) => [a.code, (i % 4) + 1]));

  // 1. Committee Plans for months 3, 6, 9 (34 areas shared across teams A-I)
  for (const [mStr, [roundNo]] of Object.entries(COMM_ROUNDS)) {
    const m = Number(mStr);
    for (const area of areas) {
      const [team] = AREA_TEAMS[area.code] || ['A'];
      const week = weekByCode.get(area.code) || 1;
      plans.push({ year: 2026, area_id: area.id, month: m, week, round: roundNo, team });
    }
  }

  // 2. Self Audit: months 1 to 11
  for (let mIdx = 0; mIdx < SELF_MONTH_BASE.length; mIdx++) {
    const m = mIdx + 1;
    const basePct = SELF_MONTH_BASE[mIdx];
    for (let codeIdx = 0; codeIdx < areas.length; codeIdx++) {
      const area = areas[codeIdx];
      const owner = AREA_OWNERS[area.code] || '2102899';
      const day = 4 + (codeIdx % 5);
      const hour = 9 + (codeIdx % 7);
      const min = 10 + ((codeIdx * 7) % 45);
      const auditedAt = `2026-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00+07:00`;
      const auditNo = `S-${area.code}-${String(day).padStart(2, '0')}${String(m).padStart(2, '0')}26-01`;

      const areaOffset = (((codeIdx * 17 + m * 7) % 11) - 5) * 0.7;
      const targetPct = Math.min(93.6, Math.max(82.4, basePct + areaOffset));
      const total = Math.min(117, Math.max(103, Math.round((targetPct / 100) * 125)));
      const pct = roundTo((total / 125) * 100, 2);
      const items = generateScores(total, rand);

      audits.push({
        audit_no: auditNo,
        year: 2026,
        audit_type: 'SELF',
        area_id: area.id,
        team: null,
        auditors: [owner],
        receivers: [],
        audited_at: auditedAt,
        total_score: total,
        percent_score: pct,
        result: 'PASS',
        status: 'COMPLETED'
      });
      scoreRowsMap.push({ auditNo, items });
    }
  }

  // 3. Committee Audits: months 3, 6, 9
  // Round 1 & 2: full attendance for all auditors ("ส่วนครั้งที่ 1 2 เต็มทุกคน")
  // Round 3: 34 areas audited, but absent auditors excluded per attendance image
  for (const [mStr, [, basePct]] of Object.entries(COMM_ROUNDS)) {
    const m = Number(mStr);
    for (let codeIdx = 0; codeIdx < areas.length; codeIdx++) {
      const area = areas[codeIdx];
      const owner = AREA_OWNERS[area.code] || '2102899';
      const [team, audList] = AREA_TEAMS[area.code] || ['A', ['2103100']];
      const week = weekByCode.get(area.code) || 1;
      const day = (week - 1) * 7 + 2 + (codeIdx % 5);
      const hour = 9 + (codeIdx % 7);
      const min = 10 + ((codeIdx * 11) % 45);
      const auditedAt = `2026-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00+07:00`;
      const auditNo = `C-${area.code}-${String(day).padStart(2, '0')}${String(m).padStart(2, '0')}26-01`;

      let auditTeam = team;
      let actualAuds = audList;
      if (m === 9) {
        if (ROUND_3_REDISTRIBUTE[area.code]) {
          [auditTeam, actualAuds] = ROUND_3_REDISTRIBUTE[area.code];
        } else {
          actualAuds = audList.filter((x) => !ABSENT_ROUND_3.has(x));
        }
      }

      const areaOffset = (((codeIdx * 13 + m * 11) % 9) - 4) * 0.65;
      const targetPct = Math.min(90.4, Math.max(82.4, basePct + areaOffset));
      const total = Math.min(113, Math.max(103, Math.round((targetPct / 100) * 125)));
      const pct = roundTo((total / 125) * 100, 2);
      const items = generateScores(total, rand);

      audits.push({
        audit_no: auditNo,
        year: 2026,
        audit_type: 'COMMITTEE',
        area_id: area.id,
        team: auditTeam,
        auditors: actualAuds,
        receivers: [owner],
        audited_at: auditedAt,
        total_score: total,
        percent_score: pct,
        result: 'PASS',
        status: 'COMPLETED'
      });
      scoreRowsMap.push({ auditNo, items });
    }
  }

  // Clear existing 2026 audits (cascades to scores) and plans to avoid duplicate accumulations
  await tx.from('tx_5s_audit').delete().eq('year', 2026);
  await tx.from('mt_5s_audit_plan').delete().eq('year', 2026);

  // Upsert plans
  for (let i = 0; i < plans.length; i += 100) {
    const chunk = plans.slice(i, i + 100);
    await tx.from('mt_5s_audit_plan').upsert(chunk, { onConflict: 'year,area_id,month,week' });
  }

  // Upsert audits
  for (let i = 0; i < audits.length; i += 100) {
    const chunk = audits.slice(i, i + 100);
    await tx.from('tx_5s_audit').upsert(chunk, { onConflict: 'audit_no' });
  }

  // Read back audit IDs
  const { data: savedAudits, error: readErr } = await tx.from('tx_5s_audit').select('id,audit_no').eq('year', 2026);
  if (readErr || !savedAudits) return;
  const auditIdByNo = new Map(savedAudits.map((a) => [a.audit_no, a.id]));

  // Prepare score rows
  const allScores = [];
  for (const { auditNo, items } of scoreRowsMap) {
    const auditId = auditIdByNo.get(auditNo);
    if (!auditId) continue;
    items.forEach((sc, idx) => {
      const checklistId = checkMap.get(idx + 1);
      if (checklistId) allScores.push({ audit_id: auditId, checklist_id: checklistId, score: sc });
    });
  }

  // Upsert scores in batches of 500
  for (let i = 0; i < allScores.length; i += 500) {
    const chunk = allScores.slice(i, i + 500);
    await tx.from('tx_5s_audit_score').upsert(chunk, { onConflict: 'audit_id,checklist_id' });
  }
}
