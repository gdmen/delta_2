# Delta 2

A self-hosted fitness coaching dashboard with an AI coach. Tracks powerlifting, BJJ, running, hiking, and biking. The coach synthesizes across data sources to produce causal hypotheses about your training.

Two hearts: a **dashboard** (key metrics, PR curves, goal progress) and a **coach** (morning briefings, chat, case files per training focus). The differentiator is `focus-as-primitive` — training focuses are first-class objects the coach reads and correlates with metrics.

## Tech Stack

- Next.js 16 (App Router) + TypeScript
- SQLite (WAL mode) via Drizzle ORM
- Tailwind CSS v4
- Claude API (Haiku) via `@anthropic-ai/sdk`
- Recharts + custom SVG components

## Local Development

```bash
npm install
```

Create `.env.local`:

```bash
CLAUDE_API_KEY=sk-ant-...
INGEST_API_KEY=<random-string-at-least-32-chars>
```

Generate a random `INGEST_API_KEY` with `openssl rand -hex 32`.

Initialize the database:

```bash
npx drizzle-kit migrate
npx tsx src/db/seed.ts
```

Run the dev server:

```bash
npm run dev
```

Open http://localhost:3000.

## Apple Health Integration

The app ingests Apple Health data via an iOS Shortcut that POSTs JSON to `/api/ingest/apple-health`.

1. On your iPhone, open the Shortcuts app.
2. Create a new Shortcut.
3. Add a "Find Health Samples" action for each data type you want to sync: sleep analysis, heart rate, HRV, active energy, steps, body mass, body fat %, VO2 max, dietary protein, dietary water.
4. For workouts, add a "Find Workouts" action.
5. Format each result as JSON and combine into a single payload:

```json
{
  "samples": [
    { "type": "sleep_analysis_total", "value": 7.2, "unit": "h", "startDate": "2026-04-15T23:00:00Z", "uuid": "..." },
    { "type": "heart_rate_variability", "value": 45, "unit": "ms", "startDate": "2026-04-16T08:00:00Z", "uuid": "..." }
  ],
  "workouts": [
    { "type": "martial_arts", "startDate": "2026-04-15T18:00:00Z", "endDate": "2026-04-15T19:30:00Z", "durationMinutes": 90, "uuid": "..." }
  ]
}
```

6. Add a "Get Contents of URL" action:
   - URL: `https://yourdomain.com/api/ingest/apple-health`
   - Method: POST
   - Headers: `Authorization: Bearer <your INGEST_API_KEY>`
   - Request Body: JSON from the previous step

7. Set the Shortcut to run automatically via Personal Automation (e.g., "When I wake up" or "Daily at 6am").

### Supported sample types

See `METRIC_TYPE_MAP` in `src/app/api/ingest/apple-health/route.ts` for the full list. Currently mapped:
sleep (total/deep/REM), heart rate, resting HR, HRV, active energy, steps, body mass, body fat %, lean mass, VO2 max, dietary protein, dietary water.

## Deployment (AWS EC2 Ubuntu)

Everything needed to stand up a fresh production instance. The full procedure
is ~30 minutes. If you've done it before, skip to the **checklist** at the end.

### 1. Provision the server

**Instance sizing.** The build is the memory bottleneck, not the runtime:

| Workload | RAM used |
|----------|----------|
| Next.js production server (idle) | ~200 MB |
| Next.js production server (serving requests) | ~400-600 MB |
| `npm run build` peak | **~1.5-2 GB** |
| Ubuntu + Nginx + journald baseline | ~300-400 MB |

- **Recommended: t3.small (2 GB RAM, ~$15/mo)** — builds finish in under a minute, comfortable runtime headroom, no swap gymnastics. Start here.
- **Budget: t3.micro (1 GB RAM, ~$7.60/mo) + 2 GB swap** — runtime is fine, builds OOM without swap. Free tier eligible for new AWS accounts (750h/month for 12 months). See "Build locally" escape hatch below.
- **Do not use t3.nano (0.5 GB)** — can't complete `npm install`.

**Storage.** Default 8 GB EBS fills up between `node_modules`, `.next`, apt packages, journald logs, and backups. Provision **20 GB gp3** (+$1.20/mo).

**If you went with t3.micro, add swap before trying to build:**

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h   # Confirm swap is active
```

**Network + DNS:**
- Security group inbound: **22 (SSH), 80 (HTTP), 443 (HTTPS). Block everything else.**
- Assign an **Elastic IP** (so it survives stop/start — instance-type changes keep the EIP).
- **Buy a domain** and set an A record pointing to the Elastic IP. HTTPS is required for:
  - Strava OAuth callback (when that integration lands)
  - iOS Shortcuts to POST reliably (HTTP works on LAN but not over cellular)
  - Let's Encrypt SSL
- DNS takes 1-10 minutes to propagate. Verify with `dig yourdomain.com +short` before proceeding.

**Resizing later** is trivial: Stop → Change Instance Type → Start. The Elastic IP and EBS volume stay put, DNS doesn't change, no reconfiguration needed.

### 2. Install system dependencies

```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx certbot python3-certbot-nginx git
node -v   # Should be v20.x or newer
```

### 3. Clone, install, migrate, seed, build

```bash
cd /opt
sudo git clone <your-repo-url> delta2
sudo chown -R ubuntu:ubuntu delta2
cd delta2
npm ci              # Use 'ci' in prod, not 'install' — respects package-lock.json exactly
npx drizzle-kit migrate        # Creates/updates delta2.db schema
npx tsx src/db/seed.ts         # Seeds sports + metric types (idempotent)
npm run build                  # Production build to .next/
```

**What each step does:**
- `npm ci` — deterministic install from `package-lock.json`
- `drizzle-kit migrate` — applies every file under `drizzle/*.sql` in order. Safe to re-run.
- `seed.ts` — inserts the 5 sports + all metric types using `ON CONFLICT DO NOTHING`. Safe to re-run; new metric types added over time will be inserted, existing ones untouched.
- `npm run build` — Next.js production build. Must complete without errors.

#### Escape hatch: build locally if your server is small

If you're on t3.micro and want to avoid swapping during builds, build on your
laptop and ship the artifact. Your server only needs to run the compiled output.

```bash
# On your laptop, after npm run build succeeds locally:
rsync -avz --delete \
  --exclude node_modules --exclude .git --exclude delta2.db --exclude '*.db-wal' --exclude '*.db-shm' \
  ./.next ./drizzle ./package.json ./package-lock.json ./public ./src ./tsconfig.json ./next.config.ts ./drizzle.config.ts ./postcss.config.mjs \
  ubuntu@delta.yourdomain.com:/opt/delta2/

# On the server (only needed once + whenever package-lock changes):
cd /opt/delta2
npm ci            # still needs devDeps for drizzle-kit + tsx; see note below
npx drizzle-kit migrate
npx tsx src/db/seed.ts
sudo systemctl restart delta2
```

The server still needs `drizzle-kit` and `tsx` (both `devDependencies`) to run
migrations + the seed script. Two options:
1. Keep `npm ci` (installs dev + prod) — simple, a bit heavier on disk.
2. Move `drizzle-kit` + `tsx` into `dependencies` and use `npm ci --omit=dev` — leaner, but you have to remember.

Option 1 is fine for a single-user deploy.

### 4. Environment variables

Create `/opt/delta2/.env.local`:

```bash
CLAUDE_API_KEY=sk-ant-...
INGEST_API_KEY=$(openssl rand -hex 32)
```

**Save the `INGEST_API_KEY` value** — you'll paste it into your iOS Shortcut's
`Authorization: Bearer <key>` header. If you lose it, just rotate and reconfigure
the Shortcut.

Permissions should be 600 (only owner reads):

```bash
chmod 600 /opt/delta2/.env.local
```

### 5. systemd service

Create `/etc/systemd/system/delta2.service`:

```ini
[Unit]
Description=Delta 2
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/delta2
EnvironmentFile=/opt/delta2/.env.local
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable delta2
sudo systemctl start delta2
sudo systemctl status delta2     # Should show 'active (running)'
curl http://localhost:3000/      # Should return HTML
```

### 6. Nginx + SSL

Create `/etc/nginx/sites-available/delta2`:

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    # REQUIRED: BodySpec PDF uploads are up to 10MB. Default Nginx
    # limit of 1M will reject them with 413. Without this, the
    # /data-sources/bodyspec page appears broken.
    client_max_body_size 12M;

    # Give the chat endpoint room to breathe — tool-use loops can
    # take 15-30s on a slow Claude response.
    proxy_read_timeout 60s;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable the site and obtain SSL:

```bash
sudo ln -s /etc/nginx/sites-available/delta2 /etc/nginx/sites-enabled/
sudo nginx -t                              # Syntax check
sudo systemctl reload nginx
sudo certbot --nginx -d yourdomain.com     # Certbot rewrites the config to listen on 443 + auto-redirect HTTP → HTTPS
```

Certbot sets up auto-renewal via a systemd timer. Verify:

```bash
sudo certbot renew --dry-run
```

### 7. Post-deploy smoke test

Run these in order. Each checks a specific subsystem:

```bash
# 1. Server + DNS + TLS
curl -I https://yourdomain.com/           # → HTTP/2 200

# 2. Ingest auth (should return 401 without a key)
curl -I https://yourdomain.com/api/ingest/apple-health
#    → HTTP/2 401

# 3. Ingest accepts valid key with empty body (should 200 with zero counts)
INGEST_KEY="<your-INGEST_API_KEY>"
curl -X POST https://yourdomain.com/api/ingest/apple-health \
  -H "Authorization: Bearer $INGEST_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
#    → {"metrics":{"accepted":0,"skipped":0,"errors":[]},"workouts":{"accepted":0,"skipped":0,"errors":[]},"unknownSampleTypes":[]}

# 4. Nginx body size (upload a 3MB dummy file, should 400 not 413)
dd if=/dev/urandom of=/tmp/dummy.pdf bs=1M count=3
curl -X POST https://yourdomain.com/api/ingest/bodyspec-dexa/extract \
  -H "Authorization: Bearer $INGEST_KEY" \
  -F "file=@/tmp/dummy.pdf"
#    → Claude will complain about malformed PDF (expected) — NOT 413
```

Then in a browser:
- `/` renders (Today page, sidebar, metrics strip)
- `/data-sources` loads (Apple Health section visible)
- `/coach/chat` accepts a message and returns a reply within 30s

### 8. Updates (re-deploys)

```bash
cd /opt/delta2
git pull
npm ci
npx drizzle-kit migrate          # ← run every time. Skipped migrations will fail at runtime.
npx tsx src/db/seed.ts           # ← run every time. Idempotent; picks up new metric types.
npm run build
sudo systemctl restart delta2
sudo systemctl status delta2     # Verify active (running)
```

If the new build bumps `COACH_PROMPT_VERSION`, briefings generated before the
deploy will still be visible (they're stamped with the old version). New
briefings use the new prompt.

### 9. Logs + troubleshooting

```bash
# Application logs (live tail):
sudo journalctl -u delta2 -f

# Last 200 lines:
sudo journalctl -u delta2 -n 200 --no-pager

# Nginx access + error:
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# SQLite state:
cd /opt/delta2 && sqlite3 delta2.db ".tables"
sqlite3 delta2.db "SELECT COUNT(*) FROM metrics;"
```

**Common failures:**

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `502 Bad Gateway` | Node crashed or not started | `sudo systemctl status delta2` → `sudo journalctl -u delta2 -n 100` |
| `413 Request Entity Too Large` on BodySpec upload | Missing `client_max_body_size` | Add `client_max_body_size 12M;` to Nginx, `sudo systemctl reload nginx` |
| `401` from ingest endpoint | Wrong `INGEST_API_KEY` in header | Verify header matches `.env.local` — trailing newlines from paste break it |
| `503` from `/api/coach/*` | `CLAUDE_API_KEY` unset or placeholder | Check `.env.local`, then `sudo systemctl restart delta2` (env is read at startup) |
| Chat returns `"not enough data yet"` | Briefing refuses on empty context | Import some metrics first, or log a focus |
| Migration errors on deploy | Conflicting schema state | Back up `delta2.db`, then `sqlite3 delta2.db ".dump" > backup.sql` and investigate |

### 10. Rollback

Tag good commits. If a deploy breaks:

```bash
cd /opt/delta2
git log --oneline -10              # Find the last known-good SHA
git checkout <good-sha>
npm ci
npm run build
sudo systemctl restart delta2
```

**Migration rollback**: Drizzle doesn't auto-generate down-migrations. If a
bad migration corrupts the DB, restore from backup:

```bash
sudo systemctl stop delta2
cp /opt/delta2/backups/delta2-<date>.db /opt/delta2/delta2.db
sudo systemctl start delta2
```

### 11. Backups

**Option A — Litestream (continuous replication, recommended):**

```bash
wget https://github.com/benbjohnson/litestream/releases/download/v0.3.13/litestream-v0.3.13-linux-amd64.deb
sudo dpkg -i litestream-v0.3.13-linux-amd64.deb
```

Create `/etc/litestream.yml`:

```yaml
dbs:
  - path: /opt/delta2/delta2.db
    replicas:
      - type: file
        path: /opt/delta2/backups/litestream
      # Or replicate to S3:
      # - type: s3
      #   bucket: your-bucket
      #   path: delta2
```

Start:

```bash
sudo systemctl enable litestream
sudo systemctl start litestream
```

**Option B — Simple cron snapshot:**

```bash
sudo tee /etc/cron.daily/delta2-backup > /dev/null <<'EOF'
#!/bin/bash
mkdir -p /opt/delta2/backups
cp /opt/delta2/delta2.db /opt/delta2/backups/delta2-$(date +%Y%m%d).db
find /opt/delta2/backups -name "delta2-*.db" -mtime +30 -delete
EOF
sudo chmod +x /etc/cron.daily/delta2-backup
```

---

### Fresh-deploy checklist

Tick these off in order. Don't skip — most prod problems are a missed step.

- [ ] EC2 instance type is t3.small (or t3.micro with 2 GB swap configured)
- [ ] Root EBS volume is 20 GB gp3 (not the default 8 GB)
- [ ] Elastic IP assigned, DNS A-record pointing at it
- [ ] `dig yourdomain.com +short` returns the EIP
- [ ] System deps installed (Node 20+, Nginx, Certbot, Git)
- [ ] Repo cloned to `/opt/delta2`, owned by `ubuntu`
- [ ] `npm ci` succeeded
- [ ] `npx drizzle-kit migrate` succeeded (creates `delta2.db`)
- [ ] `npx tsx src/db/seed.ts` succeeded (seeds sports + metric types)
- [ ] `npm run build` succeeded with no errors
- [ ] `.env.local` exists at `/opt/delta2/.env.local` with real `CLAUDE_API_KEY` + real `INGEST_API_KEY`
- [ ] `.env.local` permissions are 600
- [ ] **Saved the `INGEST_API_KEY` somewhere you can copy-paste into the iOS Shortcut**
- [ ] systemd service installed, enabled, and `active (running)`
- [ ] `curl http://localhost:3000/` returns HTML from the server
- [ ] Nginx site file includes `client_max_body_size 12M` and `proxy_read_timeout 60s`
- [ ] `sudo nginx -t` passes
- [ ] `sudo certbot --nginx` completed, `https://yourdomain.com` serves over TLS
- [ ] Browser smoke test: `/`, `/data-sources`, `/coach/chat` all load
- [ ] API smoke tests (section 7) all return expected status codes
- [ ] Backups configured (Litestream OR cron)
- [ ] A test DEXA PDF uploaded through `/data-sources/bodyspec` round-trips cleanly

## Manual Input

Once deployed, use the app to manually log:

- **Goals** — numeric targets with deadlines (e.g. deadlift 500lb by Apr 2027). `/input/goal`
- **Focuses** — multi-week training themes, optionally linked to a goal they advance. `/input/focus`
- **BJJ sessions** — mat time, type (class/open_mat/drilling/teaching), notes. `/input/bjj`

Lift data comes from TeamBuildr CSV import (coming soon). Body weight, protein, and water come from Apple Health if you use a smart scale and food tracking app that syncs to HealthKit. DEXA scans come from the BodySpec PDF import at `/data-sources/bodyspec`.

## Project Structure

```
src/
├── app/                   # Next.js App Router
│   ├── api/
│   │   ├── ingest/        # Apple Health + Strava ingest endpoints
│   │   ├── events/        # Manual event creation
│   │   ├── focuses/       # Focus CRUD
│   │   └── coach/         # Briefing generation
│   ├── input/             # Manual input forms
│   └── coach/             # Coach views
├── components/            # UI components
├── db/                    # Drizzle schema + client + seed
└── lib/
    ├── coach/             # Pre-aggregate + context + Claude client
    ├── ingest-service.ts  # Shared dedup/upsert logic
    └── auth.ts            # API key validation
```
