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

### 1. Provision

- Launch an Ubuntu 22.04+ t3.small (or t3.micro for lighter use).
- Security group: allow inbound 22 (SSH), 80 (HTTP), 443 (HTTPS). Block everything else.
- Assign an Elastic IP.
- Buy a domain and point an A record at the Elastic IP.

### 2. Install dependencies

```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx certbot python3-certbot-nginx git
```

### 3. Clone + build

```bash
cd /opt
sudo git clone <your-repo-url> delta2
sudo chown -R ubuntu:ubuntu delta2
cd delta2
npm install
npx drizzle-kit migrate
npx tsx src/db/seed.ts
npm run build
```

### 4. Environment

Create `/opt/delta2/.env.local` with your `CLAUDE_API_KEY` and `INGEST_API_KEY`.

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
sudo systemctl status delta2
```

### 6. Nginx + SSL

Create `/etc/nginx/sites-available/delta2`:

```nginx
server {
    listen 80;
    server_name yourdomain.com;

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
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d yourdomain.com
```

Certbot auto-configures HTTPS and sets up auto-renewal.

### 7. Updates

```bash
cd /opt/delta2
git pull
npm install
npx drizzle-kit migrate
npm run build
sudo systemctl restart delta2
```

### 8. Backups

Install Litestream for continuous SQLite replication:

```bash
wget https://github.com/benbjohnson/litestream/releases/download/v0.3.13/litestream-v0.3.13-linux-amd64.deb
sudo dpkg -i litestream-v0.3.13-linux-amd64.deb
```

Configure `/etc/litestream.yml` to replicate `delta2.db` to S3 or a local directory. See Litestream docs.

Or a simpler cron backup:

```bash
# /etc/cron.daily/delta2-backup
#!/bin/bash
cp /opt/delta2/delta2.db /opt/delta2/backups/delta2-$(date +%Y%m%d).db
find /opt/delta2/backups -name "delta2-*.db" -mtime +30 -delete
```

## Manual Input

Once deployed, use the app to manually log:

- **BJJ sessions** — mat time, type (class/open_mat/drilling/teaching), notes. `/input/bjj`
- **Focuses** — create, update notes, close with verdict. `/input/focus`

Lift data comes from TeamBuildr CSV import (coming soon). Body weight, protein, and water come from Apple Health if you use a smart scale and food tracking app that syncs to HealthKit.

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
