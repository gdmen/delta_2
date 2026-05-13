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
- Postgres via Drizzle ORM (`postgres-js` driver). Prod runs on AWS RDS; tests use `pglite` in-memory.
- Tailwind CSS v4
- Claude API (Haiku) via `@anthropic-ai/sdk`
- Recharts + custom SVG components

## Local Development

```bash
npm install
```

You need a Postgres 14+ instance the app can talk to. The fastest local
option is the system package:

```bash
# macOS (Homebrew):
brew install postgresql@16
brew services start postgresql@16
createdb delta_dev

# Ubuntu / Debian:
sudo apt install postgresql
sudo -u postgres createuser -s "$USER"
createdb delta_dev
```

Create `.env.local`:

```bash
DATABASE_URL=postgresql://localhost:5432/delta_dev
CLAUDE_API_KEY=sk-ant-...
INGEST_API_KEY=<random-string-at-least-32-chars>
```

Generate a random `INGEST_API_KEY` with `openssl rand -hex 32`.

Initialize the database:

```bash
npx drizzle-kit migrate
npx tsx src/db/seed.ts
```

`drizzle-kit migrate` applies every file in `drizzle/*.sql` in order against
`DATABASE_URL`. Safe to re-run.

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
| Postgres (idle, default config) | ~150 MB |
| `npm run build` peak | **~1.5-2 GB** |
| Ubuntu + Nginx + journald baseline | ~300-400 MB |

- **Recommended: t3.small (2 GB RAM, ~$15/mo)** — builds finish in under a minute, comfortable runtime + DB headroom, no swap gymnastics. Start here.
- **Budget: t3.micro (1 GB RAM, ~$7.60/mo) + 2 GB swap** — runtime + DB fit, build OOMs without swap. Free tier eligible for new AWS accounts (750h/month for 12 months). Stop the app + Postgres during build if RAM gets tight, or build elsewhere and rsync `.next/` over.
- **Do not use t3.nano (0.5 GB)** — can't complete `npm install`.

**Storage.** Default 8 GB EBS fills up between `node_modules`, `.next`, apt
packages, journald logs, and the Postgres data directory. Provision
**20 GB gp3** (+$1.20/mo). At ~100 MB per user × 20 users that's a 2 GB DB
ceiling — you'll have ~10 GB of headroom for everything else.

**Postgres lives on the same box.** At this scale (low single-digit GB,
~20 users, sole-author writes) RDS is overkill — $12/mo for a managed
instance buys 5-minute PITR and a console-driven restore, but if
"losing a day of fitness logs" isn't catastrophic, a nightly `pg_dump`
from cron is enough. Roll your own — see section 11.

We use **localhost-TCP with `trust` auth** (no password to manage). The
`bootstrap.sh` script:

1. Creates a Postgres role named `ubuntu` (matches the OS user the
   systemd unit runs as) and a database `delta_prod`.
2. Patches `pg_hba.conf` so connections to `127.0.0.1/32` and `::1/128`
   skip authentication. Idempotent — only flips lines that are
   currently `scram-sha-256`/`md5`/`password`.
3. Reloads Postgres.

This is safe at this scale because Postgres binds to `localhost` only by
default (the cluster's `listen_addresses = 'localhost'` in
`postgresql.conf`) and the EC2 security group keeps 5432 closed
externally — so "anyone on localhost can connect without a password" is
"the app process can connect without a password," because nothing else
on this box runs as a user that needs DB access.

After bootstrap, your `DATABASE_URL` looks like:

```
postgresql://ubuntu@localhost/delta_prod
```

(We tried `?host=/var/run/postgresql` for socket-peer auth instead, but
postgres-js doesn't honor that query param the way libpq does — it
parses the URL host as `localhost` and connects via TCP regardless.
Trust-on-localhost gives us the same "no password" UX without fighting
the driver.)

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
- Security group inbound: **22 (SSH), 80 (HTTP), 443 (HTTPS). Block everything else.** Postgres binds to localhost only, so 5432 stays closed externally.
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
sudo apt install -y nodejs nginx certbot python3-certbot-nginx git postgresql
node -v   # Should be v20.x or newer
psql --version   # Should be 14+; Ubuntu 24.04 ships 16
```

**Create the app's Postgres role + database AND trust localhost-TCP**
(one-shot; bootstrap.sh does all of this for you):

```bash
sudo -u postgres createuser -s ubuntu          # role ubuntu, superuser of this cluster
sudo -u postgres createdb -O ubuntu delta_prod
psql -d delta_prod -c '\conninfo'              # peer-auth via socket — sanity check

# Trust localhost-TCP so postgres-js (the app's driver) can connect
# without a password. Postgres binds to localhost only by default.
PG_HBA="$(sudo -u postgres psql -tAc 'SHOW hba_file')"
sudo sed -i.bak -E \
  -e 's|(^host\s+all\s+all\s+127\.0\.0\.1/32\s+)(scram-sha-256\|md5\|password)|\1trust|' \
  -e 's|(^host\s+all\s+all\s+::1/128\s+)(scram-sha-256\|md5\|password)|\1trust|' \
  "$PG_HBA"
sudo systemctl reload postgresql
```

### 3. Clone, install, migrate, seed, build

`.env.local` (next section) MUST exist with `DATABASE_URL` before the
migrate step — drizzle-kit reads it via `dotenv` at startup.

```bash
sudo mkdir -p /opt/delta2 && sudo chown ubuntu:ubuntu /opt/delta2
cd /opt
git clone git@github.com:gdmen/delta_2.git delta2   # SSH form if the repo is private and you forwarded your key.
                                                    # Use https://github.com/gdmen/delta_2.git if public or no agent.
cd delta2
npm ci                          # 'ci', not 'install' — respects package-lock.json exactly
npx drizzle-kit migrate         # Applies drizzle/*.sql in order against $DATABASE_URL
npx tsx src/db/seed.ts          # Seeds sports + metric types (idempotent)
npm run build                   # Production build to .next/
```

**What each step does:**
- `npm ci` — deterministic install from `package-lock.json`
- `drizzle-kit migrate` — applies every file under `drizzle/*.sql` in order against `DATABASE_URL`. Safe to re-run; the `__drizzle_migrations` table tracks which files have run.
- `seed.ts` — inserts the 5 sports + all metric types using `ON CONFLICT DO NOTHING`. Safe to re-run; new metric types added over time will be inserted, existing ones untouched.
- `npm run build` — Next.js production build. Must complete without errors.

### 3a. EC2 → GitHub pull access

Every `scripts/deploy.sh` run (manual or via the auto-deploy Action) starts with `git fetch && git reset --hard origin/main`. The EC2 box therefore needs its own SSH key registered as a GitHub Deploy Key on this repo — agent-forwarded keys only work for the initial interactive clone above, not for ongoing automated pulls.

```bash
# Generate a keypair on EC2 specifically for git pulls. Different key
# from anything else you have; never shared.
ssh-keygen -t ed25519 -f ~/.ssh/delta_deploy -C "ec2-delta2-pull" -N ""
chmod 600 ~/.ssh/delta_deploy   # OpenSSH refuses to use a key with looser perms.
chmod 644 ~/.ssh/delta_deploy.pub
```

Add `~/.ssh/delta_deploy.pub` to the repo's Deploy Keys at https://github.com/gdmen/delta_2/settings/keys/new. **Leave "Allow write access" unchecked** — read is all the box needs.

Route `git@github.com` traffic through this key by appending to `~/.ssh/config`:

```sshconfig
Host github.com
    HostName github.com
    User git
    IdentityFile ~/.ssh/delta_deploy
    IdentitiesOnly yes
```

Verify:

```bash
ssh -T git@github.com
# Expect: Hi gdmen/delta_2! You've successfully authenticated, but GitHub does not provide shell access.
```

If you see "Permission denied (publickey)" — the public-key half didn't land on the repo's deploy keys page, OR the private-key perms are still wrong (`chmod 600` again).

### 4. Environment variables

Create `/opt/delta2/.env.local`:

```bash
DATABASE_URL=postgresql://ubuntu@localhost/delta_prod
CLAUDE_API_KEY=sk-ant-...
INGEST_API_KEY=$(openssl rand -hex 32)
```

`DATABASE_URL` is plain TCP-localhost — no password, no `sslmode`.
Postgres binds to localhost only by default and `pg_hba.conf` is patched
to `trust` localhost connections (see section 2 / bootstrap step 1c).
That gives every PG client (the app via postgres-js, drizzle-kit,
ad-hoc `psql`) the same passwordless access without fighting any one
driver's URL parser.

Optional, for the Strava integration:

```bash
STRAVA_CLIENT_ID=<from strava.com/settings/api>
STRAVA_CLIENT_SECRET=<from strava.com/settings/api>
```

**Save the `INGEST_API_KEY` value** — you'll paste it into your iOS Shortcut's
`Authorization: Bearer <key>` header. If you lose it, just rotate and reconfigure
the Shortcut.

Permissions should be 600 (only owner reads — the file holds the Claude key):

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

Every push to `main` auto-deploys via GitHub Actions — see section 8a for one-time setup. The flow:

1. `.github/workflows/test.yml` runs (lint + tsc + vitest + migrate + build).
2. On success, `.github/workflows/deploy.yml` SSHs into EC2 and runs `scripts/deploy.sh`.
3. Post-deploy health check curls the public URL and fails the run if it doesn't return 2xx/3xx within ~60s.

Watch deploys in the Actions tab. Failures show up as emails + push notifications via the GitHub mobile app.

**Manual deploy** (for emergency rollbacks or out-of-CI changes):

```bash
cd /opt/delta2
./scripts/deploy.sh
```

It does the sequence below in one go. We stop the app briefly around the
build to free RAM on small instances and avoid serving half-built bundles:

```bash
git fetch && git reset --hard origin/main
npm ci
timeout 60 npx drizzle-kit migrate     # safe to run while the app is up
timeout 60 npx tsx src/db/seed.ts
sudo systemctl stop delta2             # frees ~400 MB for the build on t3.micro
npm run build
sudo systemctl start delta2
```

If the new build bumps `COACH_PROMPT_VERSION`, briefings generated before the
deploy will still be visible (they're stamped with the old version). New
briefings use the new prompt.

### 8a. Auto-deploy Action setup (one-time)

The Action needs two things: an SSH key that's allowed onto the box (and locked to a single command server-side), and a pinned host fingerprint.

#### Generate the Action's SSH keypair

Run this on a trusted machine (not the EC2 box):

```bash
ssh-keygen -t ed25519 -f /tmp/delta_action -C "github-actions-delta2" -N ""
```

You now have `/tmp/delta_action` (private) and `/tmp/delta_action.pub` (public).

#### Lock the public key on EC2

On the EC2 box, append to `~ubuntu/.ssh/authorized_keys` with a `command=` prefix so a leaked key can ONLY run `scripts/deploy.sh`:

```
command="/opt/delta2/scripts/deploy.sh",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA…<paste delta_action.pub here> github-actions-delta2
```

The `cd /opt/delta2 &&` part of the Action's command gets ignored — the server forces the run to be exactly `deploy.sh`. The repo's `deploy.sh` already starts with `cd "$(dirname "$0")/.."` so the working directory is correct.

#### Capture the EC2 host fingerprint

From a machine you trust (NOT the EC2 box):

```bash
ssh-keyscan -t ed25519,rsa delta.garymenezes.com
```

Cross-check the fingerprint against what you see in the EC2 console (Instance → Connect → "EC2 Instance Connect" tab shows the public host keys). Copy the entire multi-line output — that's the `DEPLOY_KNOWN_HOSTS` value.

#### Add four repository secrets

At https://github.com/gdmen/delta_2/settings/secrets/actions:

| Secret | Value |
|---|---|
| `DEPLOY_SSH_KEY` | The contents of `/tmp/delta_action` (private key, full `-----BEGIN…END-----` block). |
| `DEPLOY_KNOWN_HOSTS` | The `ssh-keyscan` output from above. |
| `DEPLOY_HOST` | `delta.garymenezes.com` |
| `DEPLOY_USER` | `ubuntu` |

Then `rm /tmp/delta_action` — the private key now lives only in the repo secret.

#### Verify

Push a no-op commit (e.g. tweak a comment) to `main`. The Actions tab should show `test` then `deploy` running. The deploy job's "Health-check the public URL" step should print `Site healthy (200 or 3xx) on attempt N.` and turn green.

If it fails: see the troubleshooting section below, especially the "Action deploy fails at …" rows.

#### Disabling auto-deploy temporarily

Comment out the `if:` line in `.github/workflows/deploy.yml` and push. Every `workflow_run` will skip the deploy step. Restore by uncommenting + pushing.

### 9. Logs + troubleshooting

```bash
# Application logs (live tail):
sudo journalctl -u delta2 -f

# Last 200 lines:
sudo journalctl -u delta2 -n 200 --no-pager

# Nginx access + error:
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# Postgres state:
psql -d delta_prod -c '\dt'                              # list tables
psql -d delta_prod -c 'SELECT COUNT(*) FROM metrics;'    # row count
psql -d delta_prod -c 'SELECT * FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 5;'   # what's been applied
sudo systemctl status postgresql                          # is the DB running at all
du -sh /var/lib/postgresql/16/main                        # on-disk size (check vs your 20 GB EBS)
```

**Common failures:**

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `502 Bad Gateway` | Node crashed or not started | `sudo systemctl status delta2` → `sudo journalctl -u delta2 -n 100` |
| `DATABASE_URL is not set` on app start | Missing or unreadable `.env.local` | Check it exists, perms are 600, `EnvironmentFile=` in the systemd unit points at it |
| App starts but errors on every request with `ECONNREFUSED` | Postgres not running | `sudo systemctl status postgresql` → `sudo systemctl start postgresql` |
| `role "ubuntu" does not exist` | The Postgres role wasn't created | `sudo -u postgres createuser -s ubuntu` then `sudo -u postgres createdb -O ubuntu delta_prod` |
| `413 Request Entity Too Large` on BodySpec upload | Missing `client_max_body_size` | Add `client_max_body_size 12M;` to Nginx, `sudo systemctl reload nginx` |
| `401` from ingest endpoint | Wrong `INGEST_API_KEY` in header | Verify header matches `.env.local` — trailing newlines from paste break it |
| `503` from `/api/coach/*` | `CLAUDE_API_KEY` unset or placeholder | Check `.env.local`, then `sudo systemctl restart delta2` (env is read at startup) |
| Chat returns `"not enough data yet"` | Briefing refuses on empty context | Import some metrics first, or log a focus |
| Migration errors on deploy | A prior migration crashed mid-flight | `psql -d delta_prod -c 'SELECT * FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 5;'`. Find the missing entry; if needed, manually run the offending SQL from `drizzle/` and insert the row |
| Action deploy fails at "Run deploy.sh on EC2" → `Permission denied (publickey)` | Wrong/missing key in `~ubuntu/.ssh/authorized_keys`, or the `command="..."` prefix is malformed | Re-paste the full pubkey from `/tmp/delta_action.pub` with the exact prefix from section 8a. Test by SSH'ing manually with the same key. |
| Action deploy fails at "Run deploy.sh on EC2" → `Host key verification failed` | `DEPLOY_KNOWN_HOSTS` secret is missing, stale, or doesn't match the actual EC2 host (e.g. instance was replaced) | Re-run `ssh-keyscan -t ed25519,rsa <host>` from a trusted machine, update the secret. |
| Action deploy fails inside `deploy.sh` with `git@github.com: Permission denied (publickey)` | EC2's own pull key isn't set up or the private-key file perms are too loose | On EC2: `chmod 600 ~/.ssh/delta_deploy`, confirm the pubkey is on the repo's Deploy Keys page (section 3a), confirm `~/.ssh/config` routes `github.com` through it |
| Action deploy fails at "Health-check the public URL" | `deploy.sh` exited 0 but the site returned 4xx/5xx (or didn't respond at all) | SSH in: `sudo journalctl -u delta2 -n 200`. Build succeeded but runtime is broken — usually a missing env var (CLAUDE_API_KEY, etc.) or a migration that landed weird |
| Two deploys ran back-to-back, older one got cancelled mid-flight | Expected. `concurrency: cancel-in-progress: true` keeps prod on the newest code | No fix needed; the newer deploy lands prod state correctly |

### 10. Rollback

Tag good commits. If a deploy breaks at the app layer:

```bash
cd /opt/delta2
git log --oneline -10              # Find the last known-good SHA
git checkout <good-sha>
npm ci
npm run build
sudo systemctl restart delta2
```

**Migration rollback.** Drizzle doesn't auto-generate down-migrations. If
a bad migration corrupts the DB, restore from your most recent backup
(see section 11 — you wired this up yourself):

```bash
sudo systemctl stop delta2
gunzip -c <your-backup>.sql.gz | psql -d delta_prod
sudo systemctl start delta2
```

If the bad migration corrupted the schema (not just the data), drop and
re-create the database first so the dump's `CREATE TABLE` statements
don't collide:

```bash
sudo systemctl stop delta2
sudo -u postgres dropdb delta_prod
sudo -u postgres createdb -O ubuntu delta_prod
gunzip -c <your-backup>.sql.gz | psql -d delta_prod
sudo systemctl start delta2
```

### 11. Backups

Not wired up by this repo. Whatever fits your blast-radius tolerance —
`pg_dump | gzip > file.sql.gz` from cron is the cheapest sane option;
EBS snapshots cover the whole disk; managed offsite (rclone, restic, S3
sync) if you want offsite. **Test the restore at least once before you
need it** — restore a recent dump into a throwaway database, run
`SELECT COUNT(*) FROM metrics;`, drop the test DB. If the round-trip
works, your backups work.

---

### Fresh-deploy checklist

Tick these off in order. Don't skip — most prod problems are a missed step.

- [ ] EC2 instance type is t3.small (or t3.micro with 2 GB swap configured)
- [ ] Root EBS volume is 20 GB gp3 (not the default 8 GB)
- [ ] Elastic IP assigned, DNS A-record pointing at it
- [ ] `dig delta.garymenezes.com +short` returns the EIP
- [ ] System deps installed (Node 20+, Nginx, Certbot, Git, **postgresql**)
- [ ] Postgres role `ubuntu` and database `delta_prod` exist (`psql -d delta_prod -c '\conninfo'` connects)
- [ ] `pg_hba.conf` trusts `127.0.0.1/32` and `::1/128` (postgres-js connects via TCP-localhost — auth must not be `scram-sha-256`/`md5`/`password`)
- [ ] Repo cloned to `/opt/delta2`, owned by `ubuntu`
- [ ] EC2 pull-key generated at `~/.ssh/delta_deploy` with `chmod 600`, public half added as a read-only Deploy Key on the repo, `~/.ssh/config` routes `github.com` through it (`ssh -T git@github.com` succeeds) — section 3a
- [ ] `.env.local` exists at `/opt/delta2/.env.local` with `DATABASE_URL=postgresql://ubuntu@localhost/delta_prod`, real `CLAUDE_API_KEY`, real `INGEST_API_KEY`
- [ ] `.env.local` permissions are 600
- [ ] `npm ci` succeeded
- [ ] `npx drizzle-kit migrate` succeeded (creates schema in `delta_prod`)
- [ ] `npx tsx src/db/seed.ts` succeeded (seeds sports + metric types)
- [ ] `npm run build` succeeded with no errors
- [ ] **Saved the `INGEST_API_KEY` somewhere you can copy-paste into the iOS Shortcut**
- [ ] systemd service installed, enabled, and `active (running)`
- [ ] `curl http://localhost:3000/` returns HTML from the server
- [ ] Nginx site file includes `client_max_body_size 12M` and `proxy_read_timeout 60s`
- [ ] `sudo nginx -t` passes
- [ ] `sudo certbot --nginx` completed, `https://delta.garymenezes.com` serves over TLS
- [ ] Browser smoke test: `/`, `/data-sources`, `/coach/chat` all load
- [ ] API smoke tests (section 7) all return expected status codes
- [ ] Auto-deploy Action wired (section 8a): four repo secrets set (`DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `DEPLOY_HOST`, `DEPLOY_USER`), EC2 `authorized_keys` has the locked-command entry, one no-op push to `main` produced a green `deploy` job in the Actions tab
- [ ] Backups configured (see section 11 — at minimum a `pg_dump` cron, restore tested at least once)
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
