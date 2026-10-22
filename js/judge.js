import { db, doc, getDoc, setDoc, onSnapshot, errMsg, toast, configured } from "./firebase.js";
import { esc, teamsFor, scoreId, normalizeCode, prettyCode, isValidScore } from "./common.js";

const $ = s => document.querySelector(s);
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};

const S = {
  code: null,        // this judge's access code
  me: null,          // {judge, name, scheduleId}
  cfg: null,         // config/main
  scores: {},        // round -> score doc
  viewRound: null,
  picks: null,       // team indexes in ranked order
  unsubs: [],
};

function show(which) {
  $('#loading').hidden = true;
  $('#gate').hidden = which !== 'gate';
  $('#judge').hidden = which !== 'judge';
}

function stopListening() { S.unsubs.forEach(u => u()); S.unsubs = []; }

function signOutJudge(msg) {
  stopListening();
  ls.del('judgeCode');
  Object.assign(S, { code: null, me: null, cfg: null, scores: {}, viewRound: null, picks: null });
  $('#whoPill').hidden = true;
  $('#roundPill').hidden = true;
  $('#hdrName').textContent = 'Hackathon Judging';
  $('#hdrSub').textContent = 'Judge portal';
  $('#codeErr').textContent = msg || '';
  show('gate');
  $('#codeInput').focus();
}

async function signIn(code) {
  const snap = await getDoc(doc(db, 'judgeCodes', code));
  if (!snap.exists()) return false;
  S.code = code;
  S.me = snap.data();
  ls.set('judgeCode', code);
  listen();
  return true;
}

function listen() {
  stopListening();
  S.unsubs.push(onSnapshot(doc(db, 'config', 'main'), snap => {
    const cfg = snap.exists() ? snap.data() : null;
    if (!cfg || cfg.scheduleId !== S.me.scheduleId) {
      signOutJudge('That code is from an older schedule. Ask the organizer for your new code.');
      return;
    }
    const first = !S.cfg;
    S.cfg = cfg;
    if (first) {
      // one listener per round for this judge's own rankings
      for (let r = 0; r < cfg.rounds; r++) {
        S.unsubs.push(onSnapshot(doc(db, 'scores', scoreId(S.code, r)), s => {
          S.scores[r] = s.exists() ? s.data() : null;
          render();
        }, () => {}));
      }
    }
    render();
  }, err => toast(errMsg(err))));
}

function render() {
  const c = S.cfg;
  if (!c) return;
  show('judge');
  $('#hdrName').textContent = c.event || 'Hackathon Judging';
  $('#hdrSub').textContent = `Judge portal · ${c.teams.length} teams`;
  const who = $('#whoPill');
  who.hidden = false;
  who.textContent = S.me.name;
  const rp = $('#roundPill');
  rp.hidden = false;
  rp.textContent = `Round ${c.currentRound + 1} of ${c.rounds}`;

  if (S.viewRound === null || S.viewRound > c.currentRound) { S.viewRound = c.currentRound; S.picks = null; }

  $('#judgeRounds').innerHTML = Array.from({ length: c.rounds }, (_, r) => {
    const done = isValidScore(c, S.scores[r]);
    return `<button type="button" data-r="${r}" aria-pressed="${r === S.viewRound}" ${r > c.currentRound ? 'disabled title="Not started yet"' : ''}>${r + 1}${done ? ' ✓' : ''}</button>`;
  }).join('');

  const r = S.viewRound;
  const teams = teamsFor(c, r, S.me.judge);
  const existing = isValidScore(c, S.scores[r]) ? S.scores[r] : null;
  if (S.picks === null) S.picks = existing ? existing.ranking.slice() : [];
  const complete = S.picks.length === teams.length;
  const same = existing && existing.ranking.join(',') === S.picks.join(',');

  const status = existing ? 'Ranking submitted. You can change it and resubmit.'
    : r < c.currentRound ? 'This round has passed. Submit if you still need to.'
    : 'Tap teams from best to worst.';

  let h = `<div class="card">
    <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;align-items:baseline">
      <h2>Round ${r + 1}: your ${teams.length} teams</h2>
      <span class="muted" style="font-size:14px">${status}</span>
    </div>
    <p class="muted" style="margin:0;font-size:14px">The first team you tap is rank 1. Tap a ranked team to take it out.</p>
    <div class="teams">`;
  teams.forEach(t => {
    const k = S.picks.indexOf(t);
    h += `<button type="button" class="team${k >= 0 ? ' ranked' : ''}" data-t="${t}" aria-label="Team ${t + 1}${k >= 0 ? ', ranked ' + (k + 1) : ''}">
      ${k >= 0 ? `<span class="rk">#${k + 1}</span>` : ''}
      <span class="lbl">Team</span><span class="no">${t + 1}</span><span class="nm">${esc(c.teams[t] || '')}</span></button>`;
  });
  h += `</div>
    <div class="order"><span class="muted">Order:</span> ${S.picks.length ? S.picks.map((t, i) => `<span class="chip on">${i + 1}. T${t + 1}</span>`).join('') : '<span class="muted">nothing ranked yet</span>'}</div>
    <div class="btns">
      <button type="button" class="btn" id="btnClear" ${S.picks.length ? '' : 'disabled'}>Clear</button>
      <button type="button" class="btn primary" id="btnSubmit" ${complete && !same ? '' : 'disabled'}>${existing ? 'Update ranking' : 'Submit ranking'}</button>
    </div>
    ${complete || existing ? '' : `<div class="muted" style="font-size:13px">Rank all ${teams.length} teams to submit.</div>`}
  </div>`;
  $('#judgeBody').innerHTML = h;
}

/* ---------- events ---------- */
$('#codeForm').addEventListener('submit', async e => {
  e.preventDefault();
  const code = normalizeCode($('#codeInput').value);
  if (code.length !== 8) { $('#codeErr').textContent = 'Codes are 8 letters and numbers, like ABCD-EFGH.'; return; }
  $('#codeBtn').disabled = true;
  $('#codeErr').textContent = '';
  try {
    if (!(await signIn(code))) $('#codeErr').textContent = `No judge has the code ${prettyCode(code)}. Check it with the organizer.`;
  } catch (err) {
    $('#codeErr').textContent = errMsg(err);
  }
  $('#codeBtn').disabled = false;
});

$('#switchBtn').addEventListener('click', () => signOutJudge(''));

$('#judgeRounds').addEventListener('click', e => {
  const b = e.target.closest('[data-r]');
  if (!b || b.disabled) return;
  S.viewRound = +b.dataset.r;
  S.picks = null;
  render();
});

$('#judgeBody').addEventListener('click', async e => {
  const t = e.target.closest('[data-t]');
  if (t) {
    const id = +t.dataset.t, k = S.picks.indexOf(id);
    if (k >= 0) S.picks.splice(k, 1); else S.picks.push(id);
    render();
    return;
  }
  if (e.target.closest('#btnClear')) { S.picks = []; render(); return; }
  const btn = e.target.closest('#btnSubmit');
  if (btn) {
    btn.disabled = true;
    const r = S.viewRound;
    try {
      await setDoc(doc(db, 'scores', scoreId(S.code, r)), {
        scheduleId: S.cfg.scheduleId, judge: S.me.judge, round: r,
        ranking: S.picks.slice(), at: new Date().toISOString(),
      });
      S.picks = null;
      toast(`Round ${r + 1} ranking saved`);
      render();
    } catch (err) {
      toast(errMsg(err));
      btn.disabled = false;
    }
  }
});

/* ---------- start ---------- */
(async function boot() {
  if (!configured) {
    show('gate');
    $('#codeErr').textContent = 'Firebase isn\'t set up yet. Add your project config to js/firebase-config.js.';
    $('#codeBtn').disabled = true;
    return;
  }
  const saved = normalizeCode(ls.get('judgeCode'));
  if (saved) {
    try { if (await signIn(saved)) return; } catch (e) {}
    signOutJudge('Your saved code no longer works. Enter your current code.');
    return;
  }
  show('gate');
})();