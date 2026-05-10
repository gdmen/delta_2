#!/usr/bin/env bash
#
# Delta bootstrap — one-time initial deploy on a fresh Ubuntu EC2 instance.
#
# Usage:
#   ./scripts/bootstrap.sh <domain> <letsencrypt-email>
#
# Example:
#   ./scripts/bootstrap.sh delta.garymenezes.com gary@example.com
#
# Run from inside the cloned repo as the 'ubuntu' user. Needs passwordless sudo
# (default on Ubuntu EC2). Idempotent — safe to re-run if something fails.
#
# What it does:
#   1.  System deps (nodejs 20, nginx, certbot, git, postgresql)
#   1b. Local Postgres role 'ubuntu' + database 'delta_prod'
#   1c. Flip pg_hba.conf localhost-TCP rules to `trust` (idempotent — only
#       lines currently using scram-sha-256/md5 get changed)
#   2.  2 GB swap (for t3.micro)
#   3.  npm ci / verify DB connection / migrate / seed / build
#   4.  .env.local with hardcoded DATABASE_URL (postgresql://ubuntu@localhost/
#       delta_prod) + CLAUDE_API_KEY (prompted) + generated INGEST_API_KEY,
#       plus STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET (optional, prompted)
#   5.  systemd service + start
#   6.  Nginx site with client_max_body_size 12M + proxy_read_timeout 60s
#   7.  Let's Encrypt SSL via certbot --nginx
#   8.  Smoke test
#
# When it's done, it prints the INGEST_API_KEY — copy it into your iOS Shortcut.
#
# Re-running this script on an existing install: it will detect the existing
# .env.local and offer to append Strava credentials if they're missing.

set -euo pipefail

# -----------------------------------------------------------------------------
# Args + preflight
# -----------------------------------------------------------------------------

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <domain> <letsencrypt-email>"
  echo "Example: $0 delta.garymenezes.com gary@example.com"
  exit 1
fi

DOMAIN="$1"
EMAIL="$2"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

step() {
  echo
  echo "===> $1"
}

if [[ "$(id -un)" == "root" ]]; then
  echo "Run this as the 'ubuntu' user, not root. sudo will be used inline where needed."
  exit 1
fi

if [[ ! -f "$REPO_ROOT/package.json" ]]; then
  echo "Expected to find package.json at $REPO_ROOT. Run this script from inside the cloned repo."
  exit 1
fi

echo "Delta bootstrap"
echo "  Domain: $DOMAIN"
echo "  Email:  $EMAIL"
echo "  Repo:   $REPO_ROOT"
echo

# -----------------------------------------------------------------------------
# Prompt for secrets
# -----------------------------------------------------------------------------

prompt_strava() {
  # Sets STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET. Empty = skip.
  echo
  echo "Strava integration is optional. Press Enter at both prompts to skip."
  echo "Register your app at https://www.strava.com/settings/api first."
  echo "Set the Authorization Callback Domain to: $DOMAIN"
  echo
  read -r -p "STRAVA_CLIENT_ID (optional, Enter to skip): " STRAVA_CLIENT_ID || STRAVA_CLIENT_ID=""
  if [[ -n "$STRAVA_CLIENT_ID" ]]; then
    read -r -s -p "STRAVA_CLIENT_SECRET (input hidden): " STRAVA_CLIENT_SECRET
    echo
    if [[ -z "$STRAVA_CLIENT_SECRET" ]]; then
      echo "STRAVA_CLIENT_SECRET required when ID is set. Skipping Strava."
      STRAVA_CLIENT_ID=""
      STRAVA_CLIENT_SECRET=""
    fi
  else
    STRAVA_CLIENT_SECRET=""
  fi
}

STRAVA_CLIENT_ID=""
STRAVA_CLIENT_SECRET=""
APPEND_STRAVA=false

# Postgres connection: deterministic, no password, localhost-only.
# The bootstrap creates the role + db AND patches pg_hba.conf to trust
# localhost-TCP connections (safe — Postgres binds to localhost only by
# default and 5432 stays closed at the security group).
#
# We can't use Unix-socket peer auth via DATABASE_URL because postgres-js
# (the runtime + drizzle-kit driver) doesn't honor the `?host=...` query
# param the way libpq does — it parses the URL host (localhost) and
# connects via TCP, ignoring the query. Using TCP-localhost-trust keeps
# the URL clean and works with every PG client identically.
PG_DB="delta_prod"
PG_ROLE="ubuntu"  # OS user the systemd unit runs as
DATABASE_URL="postgresql://${PG_ROLE}@localhost/${PG_DB}"

if [[ -f "$REPO_ROOT/.env.local" ]]; then
  echo "Found existing .env.local — will not overwrite Claude/Ingest keys."
  echo "(Edit $REPO_ROOT/.env.local by hand if you need to rotate those.)"
  CLAUDE_API_KEY=""  # placeholder; .env.local already has the real value
  INGEST_API_KEY=""
  SITE_PASSWORD=""

  # Offer to append Strava keys if they're not already set.
  if ! grep -q '^STRAVA_CLIENT_ID=' "$REPO_ROOT/.env.local"; then
    echo
    echo "No STRAVA_CLIENT_ID found in existing .env.local."
    read -r -p "Add Strava credentials now? (y/N): " add_strava
    if [[ "$add_strava" =~ ^[Yy]$ ]]; then
      prompt_strava
      if [[ -n "$STRAVA_CLIENT_ID" ]]; then
        APPEND_STRAVA=true
      fi
    fi
  else
    echo "Strava credentials already configured in .env.local. Skipping."
  fi
else
  read -r -s -p "Paste your CLAUDE_API_KEY (input hidden): " CLAUDE_API_KEY
  echo
  if [[ -z "$CLAUDE_API_KEY" || "$CLAUDE_API_KEY" == "sk-ant-..." ]]; then
    echo "CLAUDE_API_KEY cannot be empty. Aborting."
    exit 1
  fi
  INGEST_API_KEY="$(openssl rand -hex 32)"

  echo
  echo "Site password: gates the entire web UI behind HTTP Basic Auth."
  echo "Leave blank to skip (site will be publicly accessible)."
  read -r -s -p "SITE_PASSWORD (input hidden, Enter to skip): " SITE_PASSWORD
  echo

  prompt_strava
fi

# -----------------------------------------------------------------------------
# 1. System deps
# -----------------------------------------------------------------------------

step "Installing system packages"

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
fi

sudo apt-get update -y
sudo apt-get install -y nodejs nginx certbot python3-certbot-nginx git postgresql

node -v
psql --version

# -----------------------------------------------------------------------------
# 1b. Postgres role + database
# -----------------------------------------------------------------------------

step "Configuring Postgres (role $PG_ROLE, database $PG_DB)"

# `createuser -s` makes ubuntu a superuser of the local cluster — fine for
# a single-app box. If we ever ship a second app on the same Postgres
# we'll narrow the grants. Idempotent.
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$PG_ROLE'" | grep -q 1; then
  sudo -u postgres createuser -s "$PG_ROLE"
  echo "Created role $PG_ROLE."
else
  echo "Role $PG_ROLE already exists. Skipping."
fi

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$PG_DB'" | grep -q 1; then
  sudo -u postgres createdb -O "$PG_ROLE" "$PG_DB"
  echo "Created database $PG_DB."
else
  echo "Database $PG_DB already exists. Skipping."
fi

# Sanity check: peer auth on the Unix socket works as the script's
# invoking user. (psql with -d uses the socket by default; the app uses
# TCP via DATABASE_URL — see step 1c.)
psql -d "$PG_DB" -c '\conninfo'

# -----------------------------------------------------------------------------
# 1c. Trust localhost-TCP in pg_hba.conf
# -----------------------------------------------------------------------------
#
# postgres-js (used by both the app at runtime and drizzle-kit at build
# time) connects via TCP to localhost when DATABASE_URL is
# postgresql://user@localhost/db. The default Ubuntu pg_hba.conf wants
# scram-sha-256/md5 for those connections, which means a password.
# Rather than manage one, we trust localhost (5432 is bound to lo only
# by default; the SG keeps it closed externally too). Idempotent — only
# flips lines that are currently scram-sha-256/md5/password.

step "Patching pg_hba.conf to trust localhost-TCP"

PG_HBA="$(sudo -u postgres psql -tAc 'SHOW hba_file')"
echo "  hba_file: $PG_HBA"

if sudo grep -qE '^host\s+all\s+all\s+(127\.0\.0\.1/32|::1/128)\s+(scram-sha-256|md5|password)' "$PG_HBA"; then
  sudo sed -i.bak-$(date +%Y%m%d%H%M%S) -E \
    -e 's|(^host\s+all\s+all\s+127\.0\.0\.1/32\s+)(scram-sha-256\|md5\|password)|\1trust|' \
    -e 's|(^host\s+all\s+all\s+::1/128\s+)(scram-sha-256\|md5\|password)|\1trust|' \
    "$PG_HBA"
  sudo systemctl reload postgresql
  echo "  pg_hba.conf patched + postgres reloaded."
else
  echo "  Localhost-TCP already trust (or no scram/md5/password lines to flip). Skipping."
fi

# -----------------------------------------------------------------------------
# 2. Swap (for t3.micro — harmless on larger instances)
# -----------------------------------------------------------------------------

step "Configuring 2 GB swap (if not already present)"

if ! grep -q "/swapfile" /etc/fstab; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  echo "Swap enabled."
else
  echo "Swap already configured in /etc/fstab. Skipping."
fi

free -h

# -----------------------------------------------------------------------------
# 3. Env file
# -----------------------------------------------------------------------------

step "Writing .env.local (if missing) / appending Strava (if requested)"

if [[ ! -f "$REPO_ROOT/.env.local" ]]; then
  {
    echo "DATABASE_URL=$DATABASE_URL"
    echo "CLAUDE_API_KEY=$CLAUDE_API_KEY"
    echo "INGEST_API_KEY=$INGEST_API_KEY"
    if [[ -n "$SITE_PASSWORD" ]]; then
      echo "SITE_PASSWORD=$SITE_PASSWORD"
    fi
    if [[ -n "$STRAVA_CLIENT_ID" ]]; then
      echo "STRAVA_CLIENT_ID=$STRAVA_CLIENT_ID"
      echo "STRAVA_CLIENT_SECRET=$STRAVA_CLIENT_SECRET"
    fi
  } > "$REPO_ROOT/.env.local"
  chmod 600 "$REPO_ROOT/.env.local"
  echo ".env.local written."
elif [[ "$APPEND_STRAVA" == "true" ]]; then
  {
    echo "STRAVA_CLIENT_ID=$STRAVA_CLIENT_ID"
    echo "STRAVA_CLIENT_SECRET=$STRAVA_CLIENT_SECRET"
  } >> "$REPO_ROOT/.env.local"
  echo "Appended STRAVA_* to existing .env.local."
fi

# -----------------------------------------------------------------------------
# 4. Install, migrate, seed, build
# -----------------------------------------------------------------------------

step "npm ci (this takes 1-2 min)"
cd "$REPO_ROOT"
npm ci

# drizzle-kit + seed read DATABASE_URL from process env, not from
# .env.local automatically. Source it before invoking either.
step "Verifying DATABASE_URL is reachable"
set -a; source "$REPO_ROOT/.env.local"; set +a
if ! psql "$DATABASE_URL" -c '\conninfo' >/dev/null 2>&1; then
  echo "Could not connect with DATABASE_URL ($DATABASE_URL)."
  echo "Postgres should be running locally (sudo systemctl status postgresql)"
  echo "and the role/db should exist (step 1b above)."
  exit 1
fi

step "Running database migrations"
npx drizzle-kit migrate

step "Seeding sports + metric types"
npx tsx src/db/seed.ts

step "Building Next.js (this takes 30-90 sec; may swap on t3.micro)"
npm run build

# -----------------------------------------------------------------------------
# 5. systemd service
# -----------------------------------------------------------------------------

step "Installing systemd service"

sudo tee /etc/systemd/system/delta2.service > /dev/null <<EOF
[Unit]
Description=Delta 2
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=$REPO_ROOT
EnvironmentFile=$REPO_ROOT/.env.local
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable delta2
sudo systemctl restart delta2

# Give it a moment to bind the port.
sleep 3
sudo systemctl status delta2 --no-pager | head -15 || true

# -----------------------------------------------------------------------------
# 6. Nginx site
# -----------------------------------------------------------------------------

step "Writing Nginx site config for $DOMAIN"

sudo tee /etc/nginx/sites-available/delta2 > /dev/null <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    # BodySpec PDFs are up to ~10 MB; Health Auto Export backfill POSTs can
    # easily hit 50-100 MB on first run. 200M gives headroom for both.
    client_max_body_size 200M;

    # Chat tool-use loops can take 15-30s.
    proxy_read_timeout 60s;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/delta2 /etc/nginx/sites-enabled/delta2

# Remove default site if present so our server_name catches requests.
if [[ -L /etc/nginx/sites-enabled/default ]]; then
  sudo rm /etc/nginx/sites-enabled/default
fi

sudo nginx -t
sudo systemctl reload nginx

# -----------------------------------------------------------------------------
# 7. SSL via Let's Encrypt (idempotent — skips if cert already exists)
# -----------------------------------------------------------------------------

step "Obtaining SSL cert from Let's Encrypt"

if [[ -d "/etc/letsencrypt/live/$DOMAIN" ]]; then
  echo "Cert already exists for $DOMAIN. Skipping certbot."
else
  sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect
fi

# -----------------------------------------------------------------------------
# 8. Smoke test
# -----------------------------------------------------------------------------

step "Smoke test"

echo "--- Local Node: ---"
curl -sS -I http://localhost:3000/ | head -1

echo "--- Nginx + SSL: ---"
curl -sS -I "https://$DOMAIN/" | head -1

echo "--- Ingest auth check (should be 401): ---"
curl -sS -o /dev/null -w "  HTTP %{http_code}\n" -X POST "https://$DOMAIN/api/ingest/apple-health"

# -----------------------------------------------------------------------------
# Done
# -----------------------------------------------------------------------------

step "Done."
echo
echo "  App:       https://$DOMAIN/"
echo "  Logs:      sudo journalctl -u delta2 -f"
echo "  Re-deploy: ./scripts/deploy.sh"
echo

if [[ -n "$INGEST_API_KEY" ]]; then
  echo "INGEST_API_KEY (copy this into your iOS Shortcut's Authorization header):"
  echo
  echo "  Bearer $INGEST_API_KEY"
  echo
  echo "Also saved to $REPO_ROOT/.env.local (chmod 600)."
  echo
fi

if [[ -n "$STRAVA_CLIENT_ID" ]]; then
  echo "Strava configured. Visit https://$DOMAIN/data-sources/strava to connect."
fi
