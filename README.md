# Delta 2

A self-hosted fitness coaching dashboard with an AI coach. Tracks powerlifting, BJJ, running, hiking, and biking. The coach synthesizes across data sources to produce causal hypotheses about your training.

Two hearts: a **dashboard** (key metrics, PR curves, goal progress) and a **coach** (morning briefings, chat, case files per training focus). The differentiator is `focus-as-primitive` — training focuses are first-class objects the coach reads and correlates with metrics.

## Features

- **Data ingestion.** Apple Health via iOS Shortcut, Strava via OAuth sync (distance + elevation attached as per-event metrics), BodySpec DEXA via PDF upload, generic CSV import wizard with saved column mappings per source.
- **Metric canonicalization.** Duplicate metric types from different sources (e.g. `fiber_g` / `apple_health:fiber` / `dietary_fiber`) can be merged from `/data`. A DB-backed alias table routes future ingests of any merged name directly to the canonical type.
- **Data browser.** `/data` lists every metric type with row counts; `/data/events` is a paginated, free-text filterable event log; drill-in pages are editable. Full ZIP export + re-import round-trip for metrics, events, event_metrics, and workout_sets.
- **Coach.** Morning briefings, chat (with tool-use for metric queries), per-focus case files.

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

The app ingests Apple Health via the [Health Auto Export](https://www.healthyapps.dev/) iOS app, which POSTs its native JSON format to `/api/ingest/apple-health`.

1. Install Health Auto Export on your iPhone.
2. Create an automation targeting a REST API endpoint:
   - URL: `https://delta.garymenezes.com/api/ingest/apple-health`
   - Method: POST
   - Headers: `Authorization: Bearer <your INGEST_API_KEY>`
3. Select the data types to export (steps, heart rate, HRV, active energy, sleep analysis, body mass, body fat %, VO2 max, dietary protein, dietary water, etc.) and enable workouts.
4. Set a schedule (daily or hourly).

The endpoint accepts HAE's native payload shape:

```json
{
  "data": {
    "metrics": [
      {
        "name": "step_count",
        "units": "count",
        "data": [{ "date": "2026-04-16 00:00:00 +0000", "qty": 8234 }]
      },
      {
        "name": "sleep_analysis",
        "data": [{
          "date": "2026-04-16 00:00:00 +0000",
          "totalSleep": 7.2, "deep": 1.5, "rem": 1.8
        }]
      }
    ],
    "workouts": [
      { "name": "Running", "start": "2026-04-16 07:30:00 +0000",
        "end": "2026-04-16 08:15:00 +0000", "duration": 45.0 }
    ]
  }
}
```

### Name routing

Raw HAE metric names (`step_count`, `heart_rate_variability`, `dietary_water`, …) route to canonical Delta metric types via the `metric_type_aliases` table (seeded in migration 0006 from the former hardcoded map). Unknown names auto-create as `apple_health:<name>` orphans; merge them into a canonical type from `/data` when you want them unified — that merge inserts an alias row so future syncs land on the canonical directly.

## Deployment (AWS EC2 Ubuntu)

Two scripts in `scripts/` do the actual work:

- **`scripts/bootstrap.sh`** — one-time, fresh box
- **`scripts/deploy.sh`** — ongoing updates

The sections below explain what they do and what you still need to do by hand
(anything external to the box: provisioning, DNS, secrets).

### Quick start

On a freshly provisioned EC2 instance (see section 1 for sizing):

```bash
# As the ubuntu user, after ssh'ing in with -A (agent-forwarded SSH key):
sudo mkdir -p /opt/delta2 && sudo chown ubuntu:ubuntu /opt/delta2
cd /opt
git clone git@github.com:gdmen/delta_2.git delta2
cd delta2
./scripts/bootstrap.sh delta.garymenezes.com gary@example.com
```

The script will prompt for your `CLAUDE_API_KEY`, then install everything,
configure Nginx + systemd + Let's Encrypt, and print the generated
`INGEST_API_KEY` at the end (for your iOS Shortcut).

For ongoing updates:

```bash
cd /opt/delta2
./scripts/deploy.sh
```

If the script fails at any step, the sections below document what it was
trying to do so you can finish by hand and learn where it broke.

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
- DNS takes 1-10 minutes to propagate. Verify with `dig delta.garymenezes.com +short` before proceeding.

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
sudo mkdir -p /opt/delta2 && sudo chown ubuntu:ubuntu /opt/delta2
cd /opt
git clone git@github.com:gdmen/delta_2.git delta2   # SSH form if the repo is private and you forwarded your key.
                                                    # Use https://github.com/gdmen/delta_2.git if public or no agent.
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
    server_name delta.garymenezes.com;

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
sudo certbot --nginx -d delta.garymenezes.com     # Certbot rewrites the config to listen on 443 + auto-redirect HTTP → HTTPS
```

Certbot sets up auto-renewal via a systemd timer. Verify:

```bash
sudo certbot renew --dry-run
```

### 7. Post-deploy smoke test

Run these in order. Each checks a specific subsystem:

```bash
# 1. Server + DNS + TLS
curl -I https://delta.garymenezes.com/           # → HTTP/2 200

# 2. Ingest auth (should return 401 without a key)
curl -I https://delta.garymenezes.com/api/ingest/apple-health
#    → HTTP/2 401

# 3. Ingest accepts valid key with empty body (should 200 with zero counts)
INGEST_KEY="<your-INGEST_API_KEY>"
curl -X POST https://delta.garymenezes.com/api/ingest/apple-health \
  -H "Authorization: Bearer $INGEST_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
#    → {"metrics":{"accepted":0,"skipped":0,"errors":[]},"workouts":{"accepted":0,"skipped":0,"errors":[]},"unknownSampleTypes":[]}

# 4. Nginx body size (upload a 3MB dummy file, should 400 not 413)
dd if=/dev/urandom of=/tmp/dummy.pdf bs=1M count=3
curl -X POST https://delta.garymenezes.com/api/ingest/bodyspec-dexa/extract \
  -H "Authorization: Bearer $INGEST_KEY" \
  -F "file=@/tmp/dummy.pdf"
#    → Claude will complain about malformed PDF (expected) — NOT 413
```

Then in a browser:
- `/` renders (Today page, sidebar, metrics strip)
- `/data-sources` loads (Apple Health section visible)
- `/coach/chat` accepts a message and returns a reply within 30s

### 8. Updates (re-deploys)

Use the deploy script:

```bash
cd /opt/delta2
./scripts/deploy.sh
```

It does the sequence below in one go, with the service stopped around
the DB steps so `drizzle-kit migrate` doesn't contend with the running
better-sqlite3 connection for the WAL write lock (observed in prod:
that lock contention causes `migrate` to hang silently):

```bash
git fetch && git reset --hard origin/main
npm ci
sudo systemctl stop delta2
timeout 60 npx drizzle-kit migrate
timeout 60 npx tsx src/db/seed.ts
npm run build
sudo systemctl start delta2
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
- [ ] `dig delta.garymenezes.com +short` returns the EIP
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
- [ ] `sudo certbot --nginx` completed, `https://delta.garymenezes.com` serves over TLS
- [ ] Browser smoke test: `/`, `/data-sources`, `/coach/chat` all load
- [ ] API smoke tests (section 7) all return expected status codes
- [ ] Backups configured (Litestream OR cron)
- [ ] A test DEXA PDF uploaded through `/data-sources/bodyspec` round-trips cleanly

## Manual Input

Once deployed, use the app to manually log:

- **Goals** — numeric targets with deadlines (e.g. deadlift 500lb by Apr 2027). `/input/goal`
- **Focuses** — multi-week training themes, optionally linked to a goal they advance. `/input/focus`
- **BJJ sessions** — mat time, type (class/open_mat/drilling/teaching), notes. `/input/bjj`

Lift data comes from CSV — map a TeamBuildr (or any other) export via the
import-source wizard at `/data-sources/import/new`; the mapping is saved
and reused for future uploads. Strava rides and runs flow in via OAuth
sync. Body weight, protein, water, sleep, HRV, etc. come from Apple Health
if you use a smart scale and food tracking app that syncs to HealthKit.
DEXA scans come from BodySpec PDF upload at `/data-sources/bodyspec`.

## Project Structure

```
src/
├── app/                       # Next.js App Router
│   ├── api/
│   │   ├── ingest/            # Apple Health, Strava, BodySpec ingest
│   │   ├── import/            # Bulk ZIP/CSV import (all 4 tables)
│   │   ├── export/            # Bulk ZIP export
│   │   ├── import-sources/    # CSV source wizard + per-source sync/migrate
│   │   ├── metric-types/      # Merge + alias management
│   │   ├── events/            # Manual event CRUD
│   │   ├── focuses/           # Focus CRUD
│   │   └── coach/             # Briefing generation + chat
│   ├── data/                  # Data browser (metrics tab, events tab)
│   ├── data-sources/          # Per-source config + ingest UI
│   ├── input/                 # Manual input forms
│   └── coach/                 # Coach views
├── components/                # UI components
├── db/                        # Drizzle schema + client + seed
└── lib/
    ├── coach/                 # Pre-aggregate + context + Claude client
    ├── ingest/                # Metric-type resolver + alias cache
    ├── ingest-service.ts      # Shared dedup/upsert helpers
    └── auth.ts                # API key validation
```
