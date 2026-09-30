// Coffee Journal server — data stored in Supabase (Postgres)
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_KEY environment variables.');
  process.exit(1);
}

// ── Supabase REST helpers ────────────────────────────────────────
function sbHeaders(extra = {}) {
  const h = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', ...extra };
  // Legacy keys are JWTs and also go in Authorization; new sb_ keys do not
  if (!SUPABASE_KEY.startsWith('sb_')) h.Authorization = `Bearer ${SUPABASE_KEY}`;
  return h;
}
async function sb(method, query, body, prefer) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/accounts${query}`, {
    method,
    headers: sbHeaders(prefer ? { Prefer: prefer } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}
const eq = key => `?key=eq.${encodeURIComponent(key)}`;

async function getAccount(key) {
  const rows = await sb('GET', `${eq(key)}&select=*`);
  return rows && rows[0] ? rows[0] : null;
}
async function getAllAccounts() {
  return (await sb('GET', '?select=key,name,coffees&order=created_at.asc')) || [];
}
async function createAccount(key, name) {
  try {
    const rows = await sb('POST', '', { key, name, coffees: [] }, 'return=representation');
    return rows[0];
  } catch (e) {
    const existing = await getAccount(key); // created at the same moment by someone else
    if (existing) return existing;
    throw e;
  }
}
async function updateAccount(key, fields) {
  await sb('PATCH', eq(key), fields, 'return=minimal');
}
async function deleteAccount(key) {
  await sb('DELETE', eq(key));
}

// ── Helpers ──────────────────────────────────────────────────────
const keyOf = name => name.trim().toLowerCase();
const newId = () => Date.now() * 1000 + Math.floor(Math.random() * 1000);

// Remove private fields (grind settings + private notes) before sharing
function publicCoffee(c) {
  const { grindSize, grindTime, doseIn, doseOut, privateNotes, ...pub } = c;
  return {
    ...pub,
    entries: (c.entries || []).map(({ grindSize, grindTime, doseIn, doseOut, privateNotes, ...e }) => e),
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', d => (body += d));
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { resolve({}); } });
    req.on('error', reject);
  });
}
function json(res, status, data) {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ── Routes ───────────────────────────────────────────────────────
async function handle(req, res) {
  const { pathname } = new URL(req.url, 'http://localhost');
  let m;

  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/check-pin') {
    const { name } = await readBody(req);
    if (!name || !name.trim()) return json(res, 400, { error: 'Name required' });
    const acct = await getAccount(keyOf(name));
    return json(res, 200, { hasPin: !!(acct && acct.pin), displayName: acct ? acct.name : name.trim() });
  }

  if (req.method === 'POST' && pathname === '/api/login') {
    const { name, pin } = await readBody(req);
    if (!name || !name.trim()) return json(res, 400, { error: 'Name required' });
    const key = keyOf(name);
    const acct = (await getAccount(key)) || (await createAccount(key, name.trim()));
    if (acct.pin) {
      if (!pin) return json(res, 401, { error: 'PIN required' });
      if (String(pin) !== String(acct.pin)) return json(res, 401, { error: 'Incorrect PIN' });
    }
    return json(res, 200, { name: acct.name, key });
  }

  if (req.method === 'GET' && pathname === '/api/community') {
    const out = {};
    for (const a of await getAllAccounts()) {
      out[a.key] = { name: a.name, coffees: (a.coffees || []).map(publicCoffee) };
    }
    return json(res, 200, out);
  }

  if ((m = pathname.match(/^\/api\/account\/([^/]+)$/))) {
    const key = decodeURIComponent(m[1]).toLowerCase();
    if (req.method === 'GET') {
      const a = await getAccount(key);
      if (!a) return json(res, 404, { error: 'Not found' });
      return json(res, 200, { name: a.name, coffees: a.coffees || [] });
    }
    if (req.method === 'DELETE') {
      await deleteAccount(key);
      return json(res, 200, { ok: true });
    }
  }

  if ((m = pathname.match(/^\/api\/account\/([^/]+)\/pin$/)) && req.method === 'POST') {
    const key = decodeURIComponent(m[1]).toLowerCase();
    const { pin } = await readBody(req);
    if (!(await getAccount(key))) return json(res, 404, { error: 'Not found' });
    if (pin && !/^\d{4}$/.test(String(pin))) return json(res, 400, { error: 'PIN must be 4 digits' });
    await updateAccount(key, { pin: pin ? String(pin) : null });
    return json(res, 200, { ok: true });
  }

  if ((m = pathname.match(/^\/api\/account\/([^/]+)\/coffees$/)) && req.method === 'POST') {
    const key = decodeURIComponent(m[1]).toLowerCase();
    const a = await getAccount(key);
    if (!a) return json(res, 404, { error: 'Not found' });
    const coffee = await readBody(req);
    coffee.id = newId();
    await updateAccount(key, { coffees: [...(a.coffees || []), coffee] });
    return json(res, 200, coffee);
  }

  if ((m = pathname.match(/^\/api\/account\/([^/]+)\/coffees\/(\d+)$/))) {
    const key = decodeURIComponent(m[1]).toLowerCase();
    const id = Number(m[2]);
    const a = await getAccount(key);
    if (!a) return json(res, 404, { error: 'Not found' });
    const coffees = a.coffees || [];
    if (req.method === 'PUT') {
      const i = coffees.findIndex(c => c.id === id);
      if (i < 0) return json(res, 404, { error: 'Coffee not found' });
      const body = await readBody(req);
      body.id = id;
      coffees[i] = body;
      await updateAccount(key, { coffees });
      return json(res, 200, body);
    }
    if (req.method === 'DELETE') {
      await updateAccount(key, { coffees: coffees.filter(c => c.id !== id) });
      return json(res, 200, { ok: true });
    }
  }

  res.writeHead(404);
  res.end('Not found');
}

http
  .createServer((req, res) => handle(req, res).catch(e => { console.error(e); json(res, 500, { error: e.message }); }))
  .listen(PORT, () => console.log(`Coffee Journal running on http://localhost:${PORT} (data: Supabase)`));
