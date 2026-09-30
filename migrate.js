// OPTIONAL one-time import: copies accounts from a local db.json into Supabase.
// Run from the Coffee folder with:  node --env-file=.env migrate.js
const fs = require('fs');
const URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_KEY || '';
if (!URL || !KEY) { console.error('Missing SUPABASE_URL or SUPABASE_KEY (check your .env file)'); process.exit(1); }
if (!fs.existsSync('db.json')) { console.error('No db.json found in this folder — nothing to import.'); process.exit(1); }

const db = JSON.parse(fs.readFileSync('db.json', 'utf8'));
const headers = { apikey: KEY, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' };
if (!KEY.startsWith('sb_')) headers.Authorization = `Bearer ${KEY}`;

(async () => {
  for (const [key, a] of Object.entries(db.accounts || {})) {
    const res = await fetch(`${URL}/rest/v1/accounts?on_conflict=key`, {
      method: 'POST', headers,
      body: JSON.stringify({ key, name: a.name, pin: a.pin || null, coffees: a.coffees || [] }),
    });
    console.log(res.ok ? `✓ ${a.name} (${(a.coffees || []).length} coffees)` : `✗ ${a.name}: ${await res.text()}`);
  }
  console.log('Done.');
})();
