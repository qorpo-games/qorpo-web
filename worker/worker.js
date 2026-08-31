/**
 * QORPO Points — Cloudflare Worker (qorpo-points)
 * Endpoints: /health, /leaderboard, /status?wallet=, /spin (POST), /verify?wallet=&day=, /admin/accrue?key=
 *
 * Bindings (already configured in the Worker's Settings — DO NOT need to be in code):
 *   KV namespace  -> env.POINTS   (namespace "qorpo-points")
 *   Secret        -> env.ACCRUE_KEY  (admin key for /admin/accrue, also used by the daily cron)
 *
 * KV schema (UNCHANGED — preserves existing balances):
 *   key   = "bal:<lowercased wallet address>"   (e.g. "bal:0x1234...") — matches the original store
 *   value = {"points":number,"updatedDay":"YYYY-MM-DD"|"","firstDay":"YYYY-MM-DD","staked":number,"lvl":number}
 *   plus helper keys:  "seed:<day>" (daily provably-fair seed),  "used:<wallet>:<day>" (spins used that day)
 *
 * Reward model (QORPO Power — official sheet, 2026):
 *   L1 100-1000 | L2 1001-5000 | L3 5001-15000 | L4 15001-50000 | L5 50001-500000 | L6 500000+
 *   Daily SPINS = 1 / 2 / 3 / 4 / 5 / 10   (spins available from L1, i.e. stake >= 100)
 *   Daily Community Points (passive, by level, piecewise): 1-10 / 10-50 / 50-150 / 150-500 / 500-5000 / 5000+
 *   APY is on-chain (15% / 30%) — not handled here.
 *   ANTI-DUMP: accumulated Community Points are retained ONLY while current stake >= 10,000 $QORPO.
 *              If stake drops below 10,000 the balance is wiped (0). Spins still work from L1, but points
 *              only "bank"/count once stake >= 10,000.
 */

const RETAIN_MIN = 10000;               // points retained only while staked >= this
const SPIN_MIN   = 100;                 // spins available from L1 (stake >= 100)

// On-chain staking (same $QORPO staking contract on both chains)
const STAKING = { 1: '0xe6086858b572afd3194a608dc11ec5b955ff6c44', 56: '0x74306096cea09927fa3125cd3b9ce4f9ca11031a' };
const RPC = {
  1:  ['https://ethereum-rpc.publicnode.com', 'https://cloudflare-eth.com'],
  56: ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.binance.org']
};
const SEL_NOAPY = '0xdb15d822';   // getStakeWithNoApy(address)
const SEL_APY   = '0x36d7cfe4';   // getStakesWithApy(address)

// QORPO Power tiers (whole $QORPO). Matches the site's staking.html table.
const TIERS = [
  { min: 100,    max: 1000,     spins: 1,  pMin: 1,    pMax: 10   },
  { min: 1001,   max: 5000,     spins: 2,  pMin: 10,   pMax: 50   },
  { min: 5001,   max: 15000,    spins: 3,  pMin: 50,   pMax: 150  },
  { min: 15001,  max: 50000,    spins: 4,  pMin: 150,  pMax: 500  },
  { min: 50001,  max: 500000,   spins: 5,  pMin: 500,  pMax: 5000 },
  { min: 500001, max: Infinity, spins: 10, pMin: 5000, pMax: 5000 }
];
// 16-segment weighted wheel (0..10). Same as the site.
const WHEEL = [1,0,2,1,3,0,5,1,2,10,0,3,1,4,2,7];

/* ---------------- helpers ---------------- */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type'
};
const J = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...CORS }
});

function levelOf(amt) { for (let i = 0; i < TIERS.length; i++) if (amt >= TIERS[i].min && amt <= TIERS[i].max) return i + 1; return 0; }
function spinsForLevel(lvl) { return (lvl >= 1 && lvl <= 6) ? TIERS[lvl - 1].spins : 0; }
function dailyPoints(amt) {
  const i = levelOf(amt) - 1; if (i < 0) return 0;
  const t = TIERS[i];
  if (t.max === Infinity) { const l5 = TIERS[4]; const slope = (l5.pMax - l5.pMin) / (l5.max - l5.min); return t.pMin + (amt - t.min) * slope; }
  return t.pMin + (amt - t.min) / (t.max - t.min) * (t.pMax - t.pMin);
}
function dayKeyUTC(d = new Date()) {
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}
function nextMidnightUTC() { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.getTime(); }
function pad32(addr) { return '000000000000000000000000' + addr.toLowerCase().replace(/^0x/, ''); }
function U(hex64) { return BigInt('0x' + hex64); }
const WEI = 1000000000000000000n;

async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function randomHex(bytes = 32) {
  const a = new Uint8Array(bytes); crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ---------------- on-chain stake reading (batched JSON-RPC eth_call) ---------------- */
// Returns whole-$QORPO number, or null if the read failed for that chain (so callers never wipe on error).
async function rpcBatch(chainId, calls) {
  const body = calls.map((c, i) => ({ jsonrpc: '2.0', id: i, method: 'eth_call', params: [{ to: STAKING[chainId], data: c }, 'latest'] }));
  let lastErr;
  for (const url of RPC[chainId]) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const t = await r.text();
      let arr; try { arr = JSON.parse(t); } catch (e) { lastErr = 'nonjson'; continue; }
      if (!Array.isArray(arr)) { lastErr = 'notarray'; continue; }
      const out = new Array(calls.length).fill(null);
      for (const item of arr) { if (item.error || item.result == null) { /* leave null */ } else out[item.id] = item.result; }
      if (out.every(x => x != null)) return out;
      lastErr = 'partial';
    } catch (e) { lastErr = e.message; }
  }
  throw new Error('rpc ' + chainId + ' failed: ' + lastErr);
}
function decNoApy(res) { return U(res.replace(/^0x/, '').slice(0, 64)); }
function decApySum(res) {
  const h = res.replace(/^0x/, ''); const w = []; for (let i = 0; i < h.length; i += 64) w.push(h.slice(i, i + 64));
  if (w.length < 2) return 0n;
  const off = Number(U(w[0])) / 32; const len = Number(U(w[off])); let s = 0n;
  for (let k = 0; k < len; k++) { const b = off + 1 + k * 4; if (b + 3 < w.length && U(w[b + 3]) === 0n) s += U(w[b]); }
  return s;
}
// Read one wallet's total staked (whole tokens) across both chains. null on error.
async function readStaked(wallet) {
  const pw = pad32(wallet);
  let total = 0n;
  for (const cid of [1, 56]) {
    try {
      const [no, apy] = await rpcBatch(cid, [SEL_NOAPY + pw, SEL_APY + pw]);
      total += decNoApy(no) + decApySum(apy);
    } catch (e) { return null; }   // any chain error -> unknown (never wipe on uncertainty)
  }
  return Number(total / WEI) + Number(total % WEI) / 1e18;
}
// Read many wallets in as few subrequests as possible (2 batched POSTs per chain). Returns Map(wallet->staked|null).
async function readStakedMany(wallets) {
  const sum = new Map(); wallets.forEach(w => sum.set(w, 0n));
  const errChain = { 1: false, 56: false };
  for (const cid of [1, 56]) {
    const calls = []; const idx = [];
    for (const w of wallets) { const pw = pad32(w); calls.push(SEL_NOAPY + pw); idx.push([w, 'no']); calls.push(SEL_APY + pw); idx.push([w, 'apy']); }
    try {
      const res = await rpcBatch(cid, calls);
      for (let i = 0; i < res.length; i++) {
        const [w, kind] = idx[i];
        sum.set(w, sum.get(w) + (kind === 'no' ? decNoApy(res[i]) : decApySum(res[i])));
      }
    } catch (e) { errChain[cid] = true; }
  }
  const map = new Map();
  for (const w of wallets) {
    map.set(w, (errChain[1] || errChain[56]) ? null : (Number(sum.get(w) / WEI) + Number(sum.get(w) % WEI) / 1e18));
  }
  return map;
}

/* ---------------- KV record helpers ----------------
 * IMPORTANT: existing records are stored under the key "bal:<wallet>" (NOT the bare address).
 * Keep this prefix so the ~70 live balances are read/updated in place, never orphaned.
 */
const BAL = 'bal:';
async function loadRec(env, wallet) {
  const raw = await env.POINTS.get(BAL + wallet);
  if (raw) { try { return JSON.parse(raw); } catch (e) {} }
  return { points: 0, updatedDay: '', firstDay: dayKeyUTC(), staked: 0, lvl: 0 };
}
async function saveRec(env, wallet, rec) {
  // preserve any extra fields the original record had (e.g. "eth"); only ensure the known ones exist
  rec.points = rec.points || 0;
  rec.updatedDay = rec.updatedDay || '';
  rec.firstDay = rec.firstDay || dayKeyUTC();
  rec.staked = rec.staked || 0;
  rec.lvl = rec.lvl || 0;
  await env.POINTS.put(BAL + wallet, JSON.stringify(rec));
}

/* provably-fair daily seed */
async function getSeed(env, day) {
  let seed = await env.POINTS.get('seed:' + day);
  if (!seed) { seed = randomHex(32); await env.POINTS.put('seed:' + day, seed, { expirationTtl: 60 * 60 * 24 * 8 }); }
  return seed;
}
async function spinValue(seed, wallet, day, n) {
  const h = await sha256hex(seed + ':' + wallet.toLowerCase() + ':' + day + ':' + n);
  const idx = Number(BigInt('0x' + h) % 16n);
  return { idx, value: WHEEL[idx] };
}

/* ---------------- endpoints ---------------- */
async function handleStatus(env, wallet) {
  wallet = wallet.toLowerCase();
  const day = dayKeyUTC();
  const rec = await loadRec(env, wallet);
  const live = await readStaked(wallet);                        // null on RPC error
  const staked = (live == null) ? (rec.staked || 0) : live;     // fall back to last known; never invent 0
  const lvl = levelOf(staked);
  rec.staked = staked; rec.lvl = lvl;                           // upsert stake/level WITHOUT touching points
  await saveRec(env, wallet, rec);

  const retained = staked >= RETAIN_MIN;
  const spinsAllowed = (staked >= SPIN_MIN) ? spinsForLevel(lvl) : 0;
  const used = Number(await env.POINTS.get('used:' + wallet + ':' + day)) || 0;
  const spinsLeft = Math.max(0, spinsAllowed - used);
  const seed = await getSeed(env, day);
  return J({
    wallet, staked, level: lvl,
    points: retained ? (rec.points || 0) : 0,                   // points only count while >= 10k
    retained,
    spinsAllowed, spinsLeft, spinAvailable: spinsLeft > 0,
    expiresAt: nextMidnightUTC(),
    commit: await sha256hex(seed)
  });
}

async function handleSpin(env, req) {
  let b; try { b = await req.json(); } catch (e) { return J({ error: 'bad_request' }, 400); }
  const wallet = (b && b.wallet || '').toLowerCase();
  const day = (b && b.day) || dayKeyUTC();
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) return J({ error: 'bad_wallet' }, 400);
  if (!b.signature) return J({ error: 'no_signature' }, 400);   // client must sign; keeps casual spoofing out
  if (day !== dayKeyUTC()) return J({ error: 'stale_day' }, 400);

  const staked = await readStaked(wallet);
  if (staked == null) return J({ error: 'rpc_unavailable' }, 503);
  if (staked < SPIN_MIN) return J({ error: 'not_staked' });
  const lvl = levelOf(staked);
  const allowed = spinsForLevel(lvl);
  const usedKey = 'used:' + wallet + ':' + day;
  const used = Number(await env.POINTS.get(usedKey)) || 0;
  if (used >= allowed) return J({ error: 'no_spins_left' });

  const seed = await getSeed(env, day);
  const { idx, value } = await spinValue(seed, wallet, day, used);

  const rec = await loadRec(env, wallet);
  rec.points = (rec.points || 0) + value;                       // add points; retained-gating applied on read
  rec.staked = staked; rec.lvl = lvl;
  await saveRec(env, wallet, rec);
  await env.POINTS.put(usedKey, String(used + 1), { expirationTtl: 60 * 60 * 48 });

  const retained = staked >= RETAIN_MIN;
  return J({
    value, segment: idx,
    points: retained ? rec.points : 0,
    spinsLeft: Math.max(0, allowed - (used + 1)),
    seed, day
  });
}

async function handleVerify(env, wallet, day) {
  wallet = (wallet || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(wallet) || !day) return J({ error: 'bad_request' }, 400);
  const seed = await env.POINTS.get('seed:' + day);
  if (!seed) return J({ error: 'no_seed_for_day' });
  const used = Number(await env.POINTS.get('used:' + wallet + ':' + day)) || 0;
  const spins = [];
  for (let n = 0; n < used; n++) spins.push({ n, ...(await spinValue(seed, wallet, day, n)) });
  return J({ wallet, day, seed, commit: await sha256hex(seed), formula: 'WHEEL[ sha256(seed:wallet:day:n) mod 16 ]', wheel: WHEEL, spins });
}

async function handleLeaderboard(env) {
  const wallets = [];
  let cursor;
  do {
    const list = await env.POINTS.list({ cursor, prefix: BAL, limit: 1000 });
    for (const k of list.keys) { const w = k.name.slice(BAL.length); if (/^0x[0-9a-f]{40}$/.test(w)) wallets.push(w); }
    cursor = list.list_complete ? null : list.cursor;
  } while (cursor);

  const rows = [];
  for (const w of wallets) {
    const rec = await loadRec(env, w);
    if ((rec.staked || 0) < RETAIN_MIN) continue;                // only wallets currently >= 10k appear
    rows.push({ wallet: w, points: rec.points || 0, staked: rec.staked || 0, level: rec.lvl || 0 });
  }
  rows.sort((a, b) => b.points - a.points);
  rows.forEach((r, i) => r.rank = i + 1);
  return J({ count: rows.length, updated: new Date().toISOString(), leaderboard: rows });
}

// Daily cron / admin: accrue passive Community Points by level, apply the 10k anti-dump wipe.
async function handleAccrue(env) {
  const day = dayKeyUTC();
  const wallets = [];
  let cursor;
  do {
    const list = await env.POINTS.list({ cursor, prefix: BAL, limit: 1000 });
    for (const k of list.keys) { const w = k.name.slice(BAL.length); if (/^0x[0-9a-f]{40}$/.test(w)) wallets.push(w); }
    cursor = list.list_complete ? null : list.cursor;
  } while (cursor);

  const stakeMap = await readStakedMany(wallets);
  let accrued = 0, wiped = 0, skipped = 0;
  for (const w of wallets) {
    const staked = stakeMap.get(w);
    if (staked == null) { skipped++; continue; }                 // RPC uncertain -> never touch (protects points)
    const rec = await loadRec(env, w);
    rec.staked = staked; rec.lvl = levelOf(staked);
    if (staked < RETAIN_MIN) {
      if ((rec.points || 0) !== 0) { rec.points = 0; wiped++; }   // anti-dump wipe (deliberate, once/day)
      rec.updatedDay = day;
    } else if (rec.updatedDay !== day) {
      rec.points = (rec.points || 0) + dailyPoints(staked);       // passive daily accrual by level
      rec.updatedDay = day; accrued++;
    }
    await saveRec(env, w, rec);
  }
  return J({ ok: true, day, wallets: wallets.length, accrued, wiped, skipped });
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    const p = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (p === '/') return J({ service: 'qorpo-points', endpoints: ['/health', '/leaderboard', '/status?wallet=0x..', '/spin (POST)', '/verify?wallet=&day='] });
      if (p === '/health') return J({ ok: true, ts: Date.now() });
      if (p === '/status') { const w = url.searchParams.get('wallet') || ''; if (!/^0x[0-9a-fA-F]{40}$/.test(w)) return J({ error: 'bad_wallet' }, 400); return await handleStatus(env, w); }
      if (p === '/spin' && req.method === 'POST') return await handleSpin(env, req);
      if (p === '/verify') return await handleVerify(env, url.searchParams.get('wallet'), url.searchParams.get('day'));
      if (p === '/leaderboard') return await handleLeaderboard(env);
      if (p === '/admin/accrue') { if ((url.searchParams.get('key') || '') !== (env.ACCRUE_KEY || '\0')) return J({ error: 'unauthorized' }, 401); return await handleAccrue(env); }
      return J({ error: 'not_found' }, 404);
    } catch (e) {
      return J({ error: 'server_error', detail: String(e && e.message || e) }, 500);
    }
  },
  // Daily cron (schedule "15 0 * * *") -> accrual + anti-dump wipe
  async scheduled(event, env, ctx) { ctx.waitUntil(handleAccrue(env)); }
};
