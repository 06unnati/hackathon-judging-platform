// Shared logic: schedule generation, scoring, and small helpers.
// No Firebase imports here, so this file can also be tested in Node.

export const range = n => [...Array(n).keys()];

export function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const k = (Math.random() * (i + 1)) | 0;
    [a[i], a[k]] = [a[k], a[i]];
  }
  return a;
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- schedule generation ----------
   n teams, j judges, x rounds, y teams per judge per round.
   Each round: spread the j*y judging slots as evenly as possible over teams
   (teams with fewer judgings so far get the extra slots), then hand them to
   judges while avoiding judge-team pairs that already happened. */

function tryAssign(n, j, y, mult, pair) {
  const cap = new Array(j).fill(y);
  const lists = range(j).map(() => []);
  let rep = 0;
  const teams = shuffle(range(n)).filter(t => mult[t] > 0).sort((a, b) => mult[b] - mult[a]);
  for (const t of teams) {
    const cands = shuffle(range(j).filter(ji => cap[ji] > 0))
      .sort((a, b) => (pair[a][t] - pair[b][t]) || (cap[b] - cap[a]));
    if (cands.length < mult[t]) return null;
    for (let i = 0; i < mult[t]; i++) {
      const ji = cands[i];
      lists[ji].push(t);
      cap[ji]--;
      if (pair[ji][t] > 0) rep++;
    }
  }
  return { lists, rep };
}

export function generate(n, j, x, y) {
  const slots = j * y;
  const counts = new Array(n).fill(0);
  const pair = range(j).map(() => new Array(n).fill(0));
  const schedule = []; // schedule[round][judge] = [team indexes]
  let repeats = 0, minC = Infinity, maxC = 0;

  for (let r = 0; r < x; r++) {
    const order = shuffle(range(n)).sort((a, b) => counts[a] - counts[b]);
    const base = Math.floor(slots / n), extra = slots % n;
    const mult = new Array(n).fill(base);
    for (let i = 0; i < extra; i++) mult[order[i]]++;
    mult.forEach(m => { minC = Math.min(minC, m); maxC = Math.max(maxC, m); });

    let best = null, bestRep = Infinity;
    for (let a = 0; a < 500 && bestRep > 0; a++) {
      const res = tryAssign(n, j, y, mult, pair);
      if (res && res.rep < bestRep) { best = res; bestRep = res.rep; }
    }
    if (!best) return { error: `Couldn't fit round ${r + 1}. Try fewer teams per judge.` };
    repeats += best.rep;
    best.lists.forEach((l, ji) => l.forEach(t => { pair[ji][t]++; counts[t]++; }));
    schedule.push(best.lists.map(l => l.sort((a, b) => a - b)));
  }
  return { schedule, counts, repeats, minC, maxC };
}

export function validateSetup(f) {
  if (!Number.isFinite(f.n) || f.n < 2) return 'Enter at least 2 teams.';
  if (f.n > 500) return 'Up to 500 teams are supported.';
  if (!f.judges.length) return 'Add at least one judge.';
  if (new Set(f.judges).size !== f.judges.length) return 'Each judge needs a different name.';
  if (!Number.isFinite(f.x) || f.x < 1) return 'Enter at least 1 round.';
  if (f.x > 30) return 'Up to 30 rounds are supported.';
  if (!Number.isFinite(f.y) || f.y < 1) return 'Each judge needs at least 1 team per round.';
  if (f.y > f.n) return `A judge can't see more teams (${f.y}) than there are (${f.n}).`;
  return null;
}

/* Firestore can't store arrays inside arrays, so the schedule is saved as a
   map keyed "round_judge" -> [team indexes]. */
export const aKey = (r, ji) => `${r}_${ji}`;

export function toAssignments(schedule) {
  const out = {};
  schedule.forEach((rd, r) => rd.forEach((teams, ji) => { out[aKey(r, ji)] = teams; }));
  return out;
}

export function teamsFor(cfg, r, ji) {
  return cfg.assignments[aKey(r, ji)] || [];
}

/* ---------- access codes ---------- */
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
export function makeCode() {
  const buf = new Uint32Array(8);
  crypto.getRandomValues(buf);
  return [...buf].map(v => ALPHA[v % ALPHA.length]).join('');
}
export const normalizeCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const prettyCode = c => c.slice(0, 4) + '-' + c.slice(4);
export const scoreId = (code, r) => `${code}_r${r}`;

/* ---------- scoring ----------
   Rank 1 = 1 point, rank 2 = 2 points, ... Lowest total wins.
   If teams have been judged a different number of times, rank by average
   instead so nobody is penalized for extra judgings. */

export function isValidScore(cfg, s) {
  if (!s || !cfg || s.scheduleId !== cfg.scheduleId) return false;
  const want = teamsFor(cfg, s.round, s.judge);
  if (!Array.isArray(s.ranking) || s.ranking.length !== want.length || !want.length) return false;
  const set = new Set(want);
  return s.ranking.every(t => set.has(t)) && new Set(s.ranking).size === want.length;
}

export function computeResults(cfg, scores) {
  const n = cfg.teams.length;
  const pts = new Array(n).fill(0), got = new Array(n).fill(0), expected = new Array(n).fill(0);
  Object.values(cfg.assignments).forEach(l => l.forEach(t => expected[t]++));

  const valid = scores.filter(s => isValidScore(cfg, s));
  valid.forEach(s => s.ranking.forEach((t, i) => { pts[t] += i + 1; got[t]++; }));

  const byTotal = got.every(g => g > 0 && g === got[0]);
  const rows = range(n).map(t => ({
    t, pts: pts[t], got: got[t], expected: expected[t],
    metric: got[t] ? (byTotal ? pts[t] : pts[t] / got[t]) : Infinity,
  }));
  rows.sort((a, b) => a.metric - b.metric || a.t - b.t);
  // Competition ranking: tied teams share a place, so a tie for 1st can push
  // the next team to 3rd. Every team with place <= 3 is shown in the top 3.
  rows.forEach(r => { r.place = r.got ? 1 + rows.filter(o => o.metric < r.metric - 1e-9).length : null; });

  const total = cfg.judges.length * cfg.rounds;
  return { rows, byTotal, submitted: valid.length, total };
}