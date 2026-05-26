#!/bin/sh
# Deploys the Panini tracker on an Alpine Linux host.
#
# Run this on the Alpine VM as root, after the project folder is in place:
#   /path/to/project/scripts/deploy.sh
#
# Idempotent — re-run after updating the source.
#
# Config (override via env):
#   APP_DIR       project root              (default: auto-detected from script path)
#   APP_USER      unprivileged user         (default: panini)
#   PORT          port the Node server uses (default: 3001)
#   SERVICE_NAME  OpenRC service name       (default: panini)
#   SKIP_VERIFY   1 to skip the post-build  (default: unset — verifier runs and
#                 browser verifier            blocks restart on failure)

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
APP_USER="${APP_USER:-panini}"
PORT="${PORT:-3001}"
SERVICE_NAME="${SERVICE_NAME:-panini}"

if [ "$(id -u)" -ne 0 ]; then
    echo "must run as root" >&2
    exit 1
fi

if [ ! -f "$APP_DIR/package.json" ]; then
    echo "$APP_DIR does not look like the project (no package.json)" >&2
    exit 1
fi

echo "==> installing system packages"
# python3/make/g++ are needed because better-sqlite3 compiles from source on musl.
apk add --no-cache nodejs npm python3 make g++

if [ -z "${SKIP_VERIFY:-}" ]; then
    echo "==> installing browser packages for the verifier"
    # NOTE: full /usr/bin/chromium on Alpine 3.23 has a broken
    # chrome_crashpad_handler invocation (SIGTRAPs on every launch).
    # chromium-headless-shell is the same Chromium minus the GUI + that bug.
    apk add --no-cache chromium-headless-shell nss freetype harfbuzz font-freefont
fi

echo "==> ensuring $APP_USER system group and user exist"
# Remove stale user first so HOME stays consistent with APP_DIR. busybox deluser
# also removes the same-name group when its last member leaves, so the group
# check has to come after deluser, not before.
if id "$APP_USER" >/dev/null 2>&1; then
    current_home=$(awk -F: -v u="$APP_USER" '$1==u {print $6}' /etc/passwd)
    if [ "$current_home" != "$APP_DIR" ]; then
        echo "    home dir is stale ($current_home), recreating $APP_USER"
        deluser "$APP_USER"
    fi
fi
# busybox adduser -S does NOT create a same-named group (assigns nogroup by default),
# so the group must already exist and be passed via -G.
if ! grep -q "^$APP_USER:" /etc/group; then
    addgroup -S "$APP_USER"
fi
if ! id "$APP_USER" >/dev/null 2>&1; then
    adduser -S -D -H -h "$APP_DIR" -s /bin/sh -G "$APP_USER" "$APP_USER"
fi

echo "==> preparing data directory"
mkdir -p "$APP_DIR/data"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "==> installing npm dependencies"
su -s /bin/sh -c "cd '$APP_DIR' && npm install --no-audit --no-fund" "$APP_USER"

echo "==> building frontend"
# Snapshot the prior dist/ so we can roll back the served frontend if the
# verifier fails — express.static reads it per-request, so a bad build is
# live the moment vite rewrites it, even before we restart the service.
if [ -z "${SKIP_VERIFY:-}" ] && [ -d "$APP_DIR/dist" ]; then
    rm -rf "$APP_DIR/dist.prev"
    cp -a "$APP_DIR/dist" "$APP_DIR/dist.prev"
fi
su -s /bin/sh -c "cd '$APP_DIR' && npm run build" "$APP_USER"

if [ -z "${SKIP_VERIFY:-}" ]; then
    echo "==> installing verifier deps"
    # playwright-core is kept out of the main package.json so production npm
    # install stays lean. PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD prevents the
    # postinstall from pulling a glibc-only chromium that wouldn't run anyway.
    su -s /bin/sh -c "cd '$APP_DIR/scripts/verify' && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-audit --no-fund" "$APP_USER"

    echo "==> running offline-sync verifier against an isolated server (port 3099)"
    # The verifier spins up its own Node server on a throwaway port + tempfile
    # DB; the live service on $PORT is untouched. If it fails, restore the
    # prior dist/ so the served frontend reverts, then exit before service
    # restart so the old code stays loaded.
    if ! su -s /bin/sh -c "cd '$APP_DIR' && CHROMIUM_PATH=/usr/bin/chromium-headless-shell node scripts/verify/offline-sync.mjs" "$APP_USER"; then
        echo "    verifier FAILED"
        if [ -d "$APP_DIR/dist.prev" ]; then
            echo "    restoring previous dist/ snapshot"
            rm -rf "$APP_DIR/dist"
            mv "$APP_DIR/dist.prev" "$APP_DIR/dist"
        fi
        echo "    evidence: $APP_DIR/scripts/verify/tmp/report.json"
        echo "    re-run with SKIP_VERIFY=1 to bypass (e.g. during a hotfix where the verifier itself is broken)."
        exit 1
    fi

    rm -rf "$APP_DIR/dist.prev"
fi

echo "==> writing /etc/init.d/$SERVICE_NAME"
cat > "/etc/init.d/$SERVICE_NAME" <<EOF
#!/sbin/openrc-run

name="$SERVICE_NAME"
description="Panini World Cup 2026 Tracker"

supervisor="supervise-daemon"
command="/usr/bin/node"
command_args="server/server.js"
command_user="$APP_USER:$APP_USER"
directory="$APP_DIR"
supervise_daemon_args="--env PORT=$PORT --stdout /var/log/$SERVICE_NAME.log --stderr /var/log/$SERVICE_NAME.log"

depend() {
    need net
}
EOF
chmod +x "/etc/init.d/$SERVICE_NAME"

touch "/var/log/$SERVICE_NAME.log"
chown "$APP_USER:$APP_USER" "/var/log/$SERVICE_NAME.log"

echo "==> enabling and restarting service"
rc-update add "$SERVICE_NAME" default >/dev/null 2>&1 || true
rc-service "$SERVICE_NAME" restart || rc-service "$SERVICE_NAME" start

echo
echo "==> deploy complete"
echo "    service:  rc-service $SERVICE_NAME {start|stop|restart|status}"
echo "    logs:     tail -F /var/log/$SERVICE_NAME.log"
echo "    listen:   http://<vm-ip>:$PORT  (UI + /api on the same port)"
