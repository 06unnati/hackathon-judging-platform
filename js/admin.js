import {
  db, auth, doc, getDoc, updateDoc, collection, onSnapshot, writeBatch,
  signInWithEmailAndPassword, signOut, onAuthStateChanged, errMsg, toast, configured,
} from "./firebase.js";
import {
  range, esc, generate, validateSetup, toAssignments, teamsFor, makeCode, prettyCode,
  isValidScore, computeResults,
} from "./common.js";

const $ = s => document.querySelector(s);

const S = {
  user: null,
  cfg: null,
  scores: {},      // doc id -> score
  codes: {},       // code -> {judge, name, scheduleId}
  draft: null,
  tab: null,
  confirmReset: false,
  formFilled: false,
  unsubs: [],
};

function show(which) {
  $('#loading').hidden = true;
  $('#gate').hidden = which !== 'gate';
  $('#app').hidden = which !== 'app';
  $('#adminPill').hidden = which !== 'app';
  $('#logoutBtn').hidden = which !== 'app';
}

/* ---------- auth ---------- */
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('#loginBtn').disabled = true;
  $('#loginErr').textContent = '';
  try {
    await signInWithEmailAndPassword(auth, $('#email').value.trim(), $('#password').value);
  } catch (err) {
    $('#loginErr').textContent = errMsg(err);
  }
  $('#loginBtn').disabled = false;
});

$('#logoutBtn').addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, async user => {
  S.unsubs.forEach(u => u()); S.unsubs = [];
  S.user = null;
  if (!user) { show('gate'); return; }
  try {
    const adm = await getDoc(doc(db, 'admins', user.uid));
    if (!adm.exists()) {
      $('#loginErr').textContent = `${user.email} isn't an admin. Add a document with id ${user.uid} to the "admins" collection in Firestore.`;
      await signOut(auth);
      return;
    }
  } catch (err) {
    $('#loginErr').textContent = errMsg(err);
    await signOut(auth);
    return;
  }
  S.user = user;
  $('#adminEmail').textContent = user.email;
  show('app');
  listen();
  render();
});

function listen() {
  S.unsubs.push(onSnapshot(doc(db, 'config', 'main'), snap => {
    S.cfg = snap.exists() ? snap.data() : null;
    if (S.cfg && !S.formFilled) fillForm(S.cfg);
    S.formFilled = true;
    if (!S.tab) S.tab = S.cfg ? 'board' : 'setup';
    render();
  }, err => toast(errMsg(err))));
  S.unsubs.push(onSnapshot(collection(db, 'scores'), q => {
    const m = {}; q.forEach(d => { m[d.id] = d.data(); }); S.scores = m; render();
  }, err => toast(errMsg(err))));
  S.unsubs.push(onSnapshot(collection(db, 'judgeCodes'), q => {
    const m = {}; q.forEach(d => { m[d.id] = d.data(); }); S.codes = m; render();
  }, err => toast(errMsg(err))));
}

/* ---------- setup ---------- */
function fillForm(c) {
  $('#fEvent').value = c.event || '';
  $('#fTeams').value = c.teams.length;
  $('#fRounds').value = c.rounds;
  $('#fPer').value = c.perJudge;
  $('#fJudges').value = c.judges.join('\n');
  $('#fNames').value = c.teams.some(Boolean) ? c.teams.join('\n').replace(/\n+$/, '') : '';
  buildDraft();
}

function readForm() {
  const n = parseInt($('#fTeams').value, 10), x = parseInt($('#fRounds').value, 10), y = parseInt($('#fPer').value, 10);
  const judges = $('#fJudges').value.split('\n').map(s => s.trim()).filter(Boolean);
  const names = $('#fNames').value.split('\n');
  const teams = Number.isFinite(n) && n > 0 ? range(Math.min(n, 500)).map(i => (names[i] || '').trim()) : [];
  return { event: $('#fEvent').value.trim() || 'Hackathon', n, x, y, judges, teams };
}

function buildDraft() {
  const f = readForm(), err = validateSetup(f);
  if (err) { S.draft = { error: err, form: f }; return; }
  const g = generate(f.n, f.judges.length, f.x, f.y);
  S.draft = g.error ? { error: g.error, form: f } : { ...g, form: f };
}

function scheduleTable(judges, rounds, getTeams, doneFn, current) {
  let h = '<table><thead><tr><th>Judge</th>';
  for (let r = 0; r < rounds; r++) h += `<th class="${current === r ? 'current' : ''}">Round ${r + 1}</th>`;
  h += '</tr></thead><tbody>';
  judges.forEach((name, ji) => {
    h += `<tr><td>${esc(name)}</td>`;
    for (let r = 0; r < rounds; r++) {
      const done = doneFn && doneFn(r, ji);
      h += `<td class="${current === r ? 'current' : ''}"><div class="chips">${getTeams(r, ji).map(t => `<span class="chip${done ? ' on' : ''}">${t + 1}</span>`).join('')}${done ? ' <span class="tick" title="Ranking submitted">✓</span>' : ''}</div></td>`;
    }
    h += '</tr>';
  });
  return h + '</tbody></table>';
}

function renderSetup() {
  const d = S.draft;
  $('#previewSub').textContent = S.cfg ? 'Publishing replaces the live schedule' : 'Not published yet';
  if (!d || d.error) {
    $('#stats').innerHTML = '';
    $('#schedTable').innerHTML = '';
    $('#notes').innerHTML = `<div class="note">${esc(d ? d.error : 'Fill in the form.')}</div>`;
  } else {
    const f = d.form, j = f.judges.length;
    const minT = Math.min(...d.counts), maxT = Math.max(...d.counts);
    const per = d.minC === d.maxC ? `${d.minC}` : `${d.minC}–${d.maxC}`;
    const tot = minT === maxT ? `${minT}` : `${minT}–${maxT}`;
    $('#stats').innerHTML = [
      [`${f.n} × ${j}`, 'teams × judges'],
      [per, 'judges per team, each round'],
      [tot, 'judgings per team, total'],
      [d.repeats, 'repeat judge–team pairs'],
    ].map(([b, s]) => `<div class="stat"><b>${esc(b)}</b><span>${esc(s)}</span></div>`).join('');

    const lo = Math.ceil(f.n / j), hi = Math.floor((2 * f.n) / j);
    const out = [];
    if (d.maxC > 2 || d.minC < 1) {
      const rangeTxt = lo <= hi ? (lo === hi ? `${lo}` : `${lo}–${hi}`) : null;
      out.push(rangeTxt
        ? `Each round some teams get ${d.minC < 1 ? 'no judge' : 'more than 2 judges'}. Set teams per judge to ${rangeTxt} to keep every team at 1–2 judges per round.`
        : `With ${j} judges and ${f.n} teams, 1–2 judges per team per round isn't possible. Add or remove judges.`);
    }
    if (minT !== maxT) out.push(`${j * f.x * f.y} total judgings don't split evenly over ${f.n} teams, so some teams are judged once more than others. The scoreboard then ranks by average rank instead of total points.`);
    if (d.repeats > 0) out.push(`Some judges see the same team twice (${d.repeats} repeat${d.repeats > 1 ? 's' : ''}). That happens when a judge sees more teams across all rounds than exist.`);
    if (f.y < 2) out.push('With 1 team per judge, every ranking is a 1. Use at least 2 so rankings mean something.');
    const ok = !out.length;
    if (ok) out.push('Balanced: every team gets the same number of judgings, 1–2 judges each round, and no judge sees a team twice.');
    $('#notes').innerHTML = out.map(t => `<div class="note${ok ? ' ok' : ''}">${esc(t)}</div>`).join('');
    $('#schedTable').innerHTML = scheduleTable(f.judges, f.x, (r, ji) => d.schedule[r][ji], null, null);
  }
  const btn = $('#btnSave');
  btn.disabled = !d || !!d.error;
  btn.textContent = 'Publish schedule';
  btn.className = 'btn primary';
  btn.hidden = S.confirmReset;
}

let deb;
$('#setupForm').addEventListener('input', () => {
  clearTimeout(deb);
  deb = setTimeout(() => { clearConfirm(); buildDraft(); render(); }, 200);
});
$('#btnShuffle').addEventListener('click', () => { clearConfirm(); buildDraft(); render(); });

$('#setupForm').addEventListener('submit', async e => {
  e.preventDefault();
  const d = S.draft;
  if (!d || d.error) return;
  if (S.cfg && !S.confirmReset) {
    const n = validScores().length;
    S.confirmReset = true;
    const msg = $('#saveMsg');
    msg.className = 'note';
    msg.style.fontSize = '14px';
    msg.innerHTML = `<b>Replace the live schedule?</b><br>${n
      ? `${n} submitted ranking${n > 1 ? 's' : ''} will be deleted and every judge gets a new code.`
      : 'Every judge gets a new code and the old codes stop working.'}
      <div class="btns" style="margin-top:10px">
        <button type="submit" class="btn danger">Yes, replace it</button>
        <button type="button" class="btn" id="btnCancelReset">Cancel</button>
      </div>`;
    msg.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    render();
    return;
  }
  clearConfirm();
  $('#btnSave').disabled = true;
  const f = d.form;
  const scheduleId = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const cfg = {
    scheduleId, event: f.event, teams: f.teams, judges: f.judges, rounds: f.x, perJudge: f.y,
    assignments: toAssignments(d.schedule), currentRound: 0, createdAt: new Date().toISOString(),
  };
  const used = new Set();
  const codes = f.judges.map(() => { let c; do { c = makeCode(); } while (used.has(c)); used.add(c); return c; });

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'config', 'main'), cfg);
    codes.forEach((code, ji) => batch.set(doc(db, 'judgeCodes', code), { judge: ji, name: f.judges[ji], scheduleId }));
    await batch.commit();
    clearConfirm();
    toast('Schedule published. Hand out the new judge codes.');
    S.tab = 'codes';
    render();
    await cleanup(scheduleId);
  } catch (err) {
    $('#saveMsg').textContent = errMsg(err);
    toast(`Not published: ${errMsg(err)}`);
    render();
  }
});

function clearConfirm() {
  S.confirmReset = false;
  const msg = $('#saveMsg');
  msg.className = 'muted';
  msg.style.fontSize = '13px';
  msg.textContent = '';
}

$('#saveMsg').addEventListener('click', e => {
  if (e.target.closest('#btnCancelReset')) { clearConfirm(); render(); }
});

// Remove judge codes and rankings that belong to an older schedule.
async function cleanup(keepId) {
  const stale = [
    ...Object.entries(S.codes).filter(([, v]) => v.scheduleId !== keepId).map(([id]) => doc(db, 'judgeCodes', id)),
    ...Object.entries(S.scores).filter(([, v]) => v.scheduleId !== keepId).map(([id]) => doc(db, 'scores', id)),
  ];
  for (let i = 0; i < stale.length; i += 400) {
    const b = writeBatch(db);
    stale.slice(i, i + 400).forEach(ref => b.delete(ref));
    await b.commit();
  }
}

/* ---------- scoreboard ---------- */
const validScores = () => Object.values(S.scores).filter(s => isValidScore(S.cfg, s));

function renderBoard() {
  const p = $('#panel-board'), c = S.cfg;
  if (!c) { p.innerHTML = '<div class="empty">No schedule yet. Set up the event in Setup and publish it.</div>'; return; }
  const R = computeResults(c, Object.values(S.scores));
  const done = new Set(validScores().map(s => `${s.round}_${s.judge}`));
  const last = c.rounds - 1;
  const fmt = r => R.byTotal ? `${r.pts} pts` : `${(r.pts / r.got).toFixed(2)} avg`;
  const label = t => c.teams[t] || '';

  let h = `<div class="card"><div class="roundctl">
      <div><h3>Current round</h3><div class="bignum">${c.currentRound + 1} <span class="muted" style="font-size:16px">of ${c.rounds}</span></div>
      <div class="muted" style="font-size:13px">Judges can open this round and any earlier one.</div></div>
      <div class="btns">
        <button type="button" class="btn" id="btnPrevR" ${c.currentRound > 0 ? '' : 'disabled'}>Previous round</button>
        <button type="button" class="btn primary" id="btnNextR" ${c.currentRound < last ? '' : 'disabled'}>Start round ${Math.min(c.currentRound + 2, c.rounds)}</button>
      </div></div>
      <div><h3 style="margin-bottom:6px">Rankings in</h3><div class="mono">${R.submitted} / ${R.total} <span class="muted">(${Math.round((100 * R.submitted) / R.total)}%)</span></div></div>
    </div>`;

  const final = R.submitted === R.total;
  h += `<div class="card"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:baseline">
      <h2>${final ? 'Top 3' : 'Top 3 so far'}</h2>
      <span class="muted" style="font-size:13px">${R.byTotal ? 'Lowest total points wins' : 'Ranked by average rank, since teams have been judged a different number of times'}${final ? '' : ' · provisional'}</span></div>`;
  if (!R.submitted) h += '<div class="empty">No rankings yet. The top 3 appear as judges submit.</div>';
  else {
    h += '<div class="podium">';
    [1, 2, 3].forEach((pl, i) => {
      const list = R.rows.filter(r => r.place === pl);
      h += `<div class="place p${pl}"><div class="pl">${['1st', '2nd', '3rd'][i]}${list.length > 1 ? ' <span class="tie">tie</span>' : ''}</div>`;
      if (!list.length) h += '<div class="muted" style="font-size:14px">Taken by a tie above</div>';
      list.forEach(r => { h += `<div class="entry"><div><div style="font-weight:700">Team ${r.t + 1}</div><div class="muted" style="font-size:13px">${esc(label(r.t))}</div></div><b>${fmt(r)}</b></div>`; });
      h += '</div>';
    });
    h += '</div>';
  }
  h += '</div>';

  h += `<div class="card"><h3>All teams</h3><div class="tablewrap"><table><thead><tr>
    <th class="num">Place</th><th>Team</th><th class="num">Points</th><th class="num">Avg rank</th><th class="num">Judged</th></tr></thead><tbody>`;
  R.rows.forEach(r => {
    h += `<tr><td class="num">${r.place ?? '—'}</td><td><b>Team ${r.t + 1}</b>${label(r.t) ? ` <span class="muted">${esc(label(r.t))}</span>` : ''}</td>
      <td class="num">${r.got ? r.pts : '—'}</td><td class="num">${r.got ? (r.pts / r.got).toFixed(2) : '—'}</td><td class="num">${r.got} / ${r.expected}</td></tr>`;
  });
  h += '</tbody></table></div></div>';

  h += `<div class="card"><h3>Schedule and submissions</h3><p class="muted" style="margin:0;font-size:13px">✓ means that judge has submitted that round.</p>
    <div class="tablewrap">${scheduleTable(c.judges, c.rounds, (r, ji) => teamsFor(c, r, ji), (r, ji) => done.has(`${r}_${ji}`), c.currentRound)}</div></div>`;
  p.innerHTML = h;
}

$('#panel-board').addEventListener('click', async e => {
  const c = S.cfg;
  if (!c) return;
  let nr = null;
  if (e.target.closest('#btnNextR')) nr = Math.min(c.currentRound + 1, c.rounds - 1);
  if (e.target.closest('#btnPrevR')) nr = Math.max(c.currentRound - 1, 0);
  if (nr === null || nr === c.currentRound) return;
  try { await updateDoc(doc(db, 'config', 'main'), { currentRound: nr }); toast(`Round ${nr + 1} is open`); }
  catch (err) { toast(errMsg(err)); }
});

/* ---------- judge codes ---------- */
function judgeUrl() {
  return new URL('./', location.href).href;
}

function codesForSchedule() {
  if (!S.cfg) return [];
  return Object.entries(S.codes)
    .filter(([, v]) => v.scheduleId === S.cfg.scheduleId)
    .map(([code, v]) => ({ code, ...v }))
    .sort((a, b) => a.judge - b.judge);
}

function renderCodes() {
  const p = $('#panel-codes'), c = S.cfg;
  if (!c) { p.innerHTML = '<div class="empty">Publish a schedule first. Each judge gets a code when you do.</div>'; return; }
  const list = codesForSchedule();
  const done = new Set(validScores().map(s => `${s.round}_${s.judge}`));
  let h = `<div class="card">
    <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:baseline">
      <h2>Judge codes</h2>
      <button type="button" class="btn" id="btnCopyAll" ${list.length ? '' : 'disabled'}>Copy all</button>
    </div>
    <p class="muted" style="margin:0;font-size:14px">Send each judge the judge page link and their own code. Anyone with a code can submit rankings as that judge, so share codes privately.</p>
    <div class="mono" style="font-size:14px;overflow-wrap:anywhere">Judge page: <a href="${esc(judgeUrl())}" target="_blank" rel="noopener">${esc(judgeUrl())}</a></div>
    <div class="tablewrap"><table class="codes"><thead><tr><th>Judge</th><th>Code</th><th>Rounds submitted</th><th></th></tr></thead><tbody>`;
  list.forEach(j => {
    const n = range(c.rounds).filter(r => done.has(`${r}_${j.judge}`)).length;
    h += `<tr><td>${esc(j.name)}</td><td class="code">${prettyCode(j.code)}</td><td class="mono">${n} / ${c.rounds}</td>
      <td><button type="button" class="btn" data-copy="${esc(j.code)}">Copy</button></td></tr>`;
  });
  if (!list.length) h += '<tr><td colspan="4" class="muted">Codes are loading…</td></tr>';
  h += '</tbody></table></div></div>';
  p.innerHTML = h;
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); }
  catch (e) { toast("Couldn't copy. Select the text and copy it manually."); }
}

$('#panel-codes').addEventListener('click', e => {
  const one = e.target.closest('[data-copy]');
  if (one) {
    const j = codesForSchedule().find(x => x.code === one.dataset.copy);
    copy(`${j.name}, your judge code is ${prettyCode(j.code)}. Judge here: ${judgeUrl()}`);
    return;
  }
  if (e.target.closest('#btnCopyAll')) {
    copy([`Judge page: ${judgeUrl()}`, ...codesForSchedule().map(j => `${j.name}: ${prettyCode(j.code)}`)].join('\n'));
  }
});

/* ---------- render ---------- */
function render() {
  if (!S.user) return;
  const c = S.cfg;
  $('#hdrName').textContent = c ? c.event : 'Hackathon Judging';
  $('#hdrSub').textContent = c ? `Admin · ${c.teams.length} teams · ${c.judges.length} judges · ${c.rounds} rounds` : 'Admin';
  const rp = $('#roundPill');
  rp.hidden = !c;
  if (c) rp.textContent = `Round ${c.currentRound + 1} of ${c.rounds}`;

  const tab = S.tab || 'setup';
  ['setup', 'board', 'codes'].forEach(t => {
    $('#tab-' + t).setAttribute('aria-selected', String(tab === t));
    $('#panel-' + t).hidden = tab !== t;
  });
  if (tab === 'setup') renderSetup();
  if (tab === 'board') renderBoard();
  if (tab === 'codes') renderCodes();
}

$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  S.tab = b.dataset.tab;
  clearConfirm();
  render();
});

/* ---------- start ---------- */
buildDraft();
if (!configured) {
  show('gate');
  $('#loginErr').textContent = "Firebase isn't set up yet. Add your project config to js/firebase-config.js.";
  $('#loginBtn').disabled = true;
}