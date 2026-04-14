# Coffee Journal

A shared multi-user coffee journal. Each person logs in by name, keeps their own coffee collection, and can browse everyone else's.

## Files

- `server.js` — Node.js backend (no dependencies needed)
- `index.html` — frontend (served by the backend)
- `db.json` — created automatically, stores all data
- `package.json` — project metadata

## Running locally

You need Node.js installed (v14+).

```bash
node server.js
```

Then open http://localhost:3000 in your browser.

## Deploying to a server

### Any Linux VPS (e.g. DigitalOcean, Hetzner, Linode)

1. Copy the files to your server:
   ```bash
   scp server.js index.html package.json user@your-server:/var/www/coffee-journal/
   ```

2. SSH in and start it:
   ```bash
   cd /var/www/coffee-journal
   node server.js
   ```

3. To keep it running permanently, use PM2:
   ```bash
   npm install -g pm2
   pm2 start server.js --name coffee-journal
   pm2 save
   pm2 startup
   ```

4. To serve on port 80/443, put Nginx in front:
   ```nginx
   server {
       listen 80;
       server_name yourcoffeejournal.com;
       location / {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
       }
   }
   ```

### Railway / Render / Fly.io (free tiers available)

1. Push the files to a GitHub repo
2. Connect the repo to Railway/Render
3. Set start command to `node server.js`
4. Done — they handle everything else

**Note:** On platforms like Railway, the `db.json` file resets on each deploy. For permanent storage there, use their built-in volume/disk add-on, or swap the JSON file for a free Postgres/SQLite database.

## Privacy

- **Grind settings** (grind size + grind time) are private — only the owner sees them. The API strips them before sharing with other users.
- All other coffee data (name, origin, roaster, notes, rating, tags, photos) is visible to everyone in the community.

## Notes

- Photos are stored as base64 inside `db.json`. For large communities, consider storing photos separately (e.g. Cloudflare R2 or S3).
- No passwords — anyone can log in as any name. Add a PIN field to `server.js` if you want basic protection.
