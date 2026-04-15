const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'db.json');

// Anthropic API key — set env var or paste your key here
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'YOUR_API_KEY_HERE';

// ── DB helpers ──────────────────────────────────────────────────
function loadDb() {
  if (!fs.existsSync(DB_FILE)) return { accounts: {}, nextId: 1 };
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch(e) { return { accounts: {}, nextId: 1 }; }
}
function saveDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ── HTTP helpers ────────────────────────────────────────────────
function readBody(req) {
  return new Promise((res, rej) => {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => { try { res(JSON.parse(body)); } catch(e) { res({}); } });
    req.on('error', rej);
  });
}
function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
  res.end(body);
}
function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

// ── Strip private fields from a coffee object ───────────────────
function publicCoffee(c) {
  const { grindSize, grindTime, ...pub } = c;
  return pub;
}

// ── Router ──────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') { json(res, 204, {}); return; }

  // Serve frontend
  if (req.method === 'GET' && pathname === '/') {
    serveFile(res, path.join(__dirname, 'index.html'), 'text/html'); return;
  }

  // ── POST /api/login  { name }
  // Creates account if new, returns account (without other users' grind data)
  // ── POST /api/check-pin { name } — returns whether account has a PIN
  if (req.method === 'POST' && pathname === '/api/check-pin') {
    const { name } = await readBody(req);
    if (!name || !name.trim()) { json(res, 400, { error: 'Name required' }); return; }
    const db = loadDb();
    const key = name.trim().toLowerCase();
    const acct = db.accounts[key];
    json(res, 200, { hasPin: !!(acct && acct.pin), displayName: acct ? acct.name : name.trim() });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/login') {
    const { name, pin } = await readBody(req);
    if (!name || !name.trim()) { json(res, 400, { error: 'Name required' }); return; }
    const db = loadDb();
    const key = name.trim().toLowerCase();
    if (!db.accounts[key]) {
      // New account — create it
      db.accounts[key] = { name: name.trim(), coffees: [] };
      saveDb(db);
    }
    const acct = db.accounts[key];
    // If account has a PIN, verify it
    if (acct.pin) {
      if (!pin) { json(res, 401, { error: 'PIN required' }); return; }
      if (String(pin) !== String(acct.pin)) { json(res, 401, { error: 'Incorrect PIN' }); return; }
    }
    json(res, 200, { name: acct.name, key });
    return;
  }

  // ── GET /api/community
  // Returns all accounts with public coffee data only (no grind settings)
  if (req.method === 'GET' && pathname === '/api/community') {
    const db = loadDb();
    const community = {};
    for (const [k, a] of Object.entries(db.accounts)) {
      community[k] = { name: a.name, coffees: a.coffees.map(publicCoffee) };
    }
    json(res, 200, community);
    return;
  }

  // ── GET /api/account/:key
  // Returns full account data (including grind) — only the owner should call this
  const accountMatch = pathname.match(/^\/api\/account\/([^/]+)$/);
  if (req.method === 'GET' && accountMatch) {
    const key = decodeURIComponent(accountMatch[1]).toLowerCase();
    const db = loadDb();
    if (!db.accounts[key]) { json(res, 404, { error: 'Not found' }); return; }
    json(res, 200, db.accounts[key]);
    return;
  }

  // ── POST /api/account/:key/coffees  (add)
  const addMatch = pathname.match(/^\/api\/account\/([^/]+)\/coffees$/);
  if (req.method === 'POST' && addMatch) {
    const key = decodeURIComponent(addMatch[1]).toLowerCase();
    const db = loadDb();
    if (!db.accounts[key]) { json(res, 404, { error: 'Not found' }); return; }
    const body = await readBody(req);
    body.id = db.nextId++;
    db.accounts[key].coffees.push(body);
    saveDb(db);
    json(res, 200, body);
    return;
  }

  // ── PUT /api/account/:key/coffees/:id  (edit)
  const editMatch = pathname.match(/^\/api\/account\/([^/]+)\/coffees\/(\d+)$/);
  if (req.method === 'PUT' && editMatch) {
    const key = decodeURIComponent(editMatch[1]).toLowerCase();
    const id = parseInt(editMatch[2]);
    const db = loadDb();
    if (!db.accounts[key]) { json(res, 404, { error: 'Not found' }); return; }
    const body = await readBody(req);
    const i = db.accounts[key].coffees.findIndex(c => c.id === id);
    if (i < 0) { json(res, 404, { error: 'Coffee not found' }); return; }
    body.id = id;
    db.accounts[key].coffees[i] = body;
    saveDb(db);
    json(res, 200, body);
    return;
  }

  // ── DELETE /api/account/:key/coffees/:id
  if (req.method === 'DELETE' && editMatch) {
    const key = decodeURIComponent(editMatch[1]).toLowerCase();
    const id = parseInt(editMatch[2]);
    const db = loadDb();
    if (!db.accounts[key]) { json(res, 404, { error: 'Not found' }); return; }
    db.accounts[key].coffees = db.accounts[key].coffees.filter(c => c.id !== id);
    saveDb(db);
    json(res, 200, { ok: true });
    return;
  }

  // ── DELETE /api/account/:key
  const delAcctMatch = pathname.match(/^\/api\/account\/([^/]+)$/);
  if (req.method === 'DELETE' && delAcctMatch) {
    const key = decodeURIComponent(delAcctMatch[1]).toLowerCase();
    const db = loadDb();
    if (!db.accounts[key]) { json(res, 404, { error: 'Not found' }); return; }
    delete db.accounts[key];
    saveDb(db);
    json(res, 200, { ok: true });
    return;
  }

  // ── POST /api/ai  — proxy to Anthropic (keeps API key server-side)
  if (req.method === 'POST' && pathname === '/api/ai') {
    if (!ANTHROPIC_API_KEY || ANTHROPIC_API_KEY === 'YOUR_API_KEY_HERE') {
      json(res, 503, { error: 'No API key configured in server.js' }); return;
    }
    const body = await readBody(req);
    const postData = JSON.stringify(body);
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(postData),
      },
    };
    const proxyReq = https.request(options, proxyRes => {
      let data = '';
      proxyRes.on('data', chunk => data += chunk);
      proxyRes.on('end', () => {
        res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
        res.end(data);
      });
    });
    proxyReq.on('error', e => json(res, 500, { error: e.message }));
    proxyReq.write(postData);
    proxyReq.end();
    return;
  }

  // ── POST /api/account/:key/pin { pin }
  const pinMatch = pathname.match(/^\/api\/account\/([^/]+)\/pin$/);
  if (req.method === 'POST' && pinMatch) {
    const key = decodeURIComponent(pinMatch[1]).toLowerCase();
    const { pin } = await readBody(req);
    const db = loadDb();
    if (!db.accounts[key]) { json(res, 404, { error: 'Not found' }); return; }
    if (pin) {
      if (!/^\d{4}$/.test(String(pin))) { json(res, 400, { error: 'PIN must be 4 digits' }); return; }
      db.accounts[key].pin = String(pin);
    } else {
      delete db.accounts[key].pin;
    }
    saveDb(db);
    json(res, 200, { ok: true });
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => console.log(`Coffee Journal running on http://localhost:${PORT}`));
