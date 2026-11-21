#!/bin/sh
# Levuvo SF first-start setup for Forgejo: admin user `levuvo-admin` and organization `levuvo-sf`.
# Runs in a one-shot container from the Forgejo image after the server is healthy, on every `docker compose up`.
# Idempotent: a second run changes nothing. Fails closed: anything unexpected stops with an error, nothing is guessed.
# The generated admin password lives only in the Forgejo data volume (mode 0600) and is never printed.
# `init.sh reset-password` (docker compose run --rm git-init reset-password) sets a new random admin password in
# Forgejo and in the file, e.g. after the password was changed in the web UI or the file was lost.
set -eu

ADMIN=levuvo-admin
ORG=levuvo-sf
API=http://git:3000/api/v1
SECRETS=/var/lib/gitea/levuvo
PWFILE=$SECRETS/admin-password

fail() { echo "git-init: ERROR: $*" >&2; exit 1; }
newpw() { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32; }

umask 077
mkdir -p "$SECRETS"
chmod 700 "$SECRETS"

if [ "${1:-}" = reset-password ]; then
  pw="$(newpw)"
  [ "${#pw}" -eq 32 ] || fail "could not generate a password"
  forgejo admin user change-password --username "$ADMIN" --password "$pw" --must-change-password=false > /dev/null
  printf '%s' "$pw" > "$PWFILE.new" && mv "$PWFILE.new" "$PWFILE"
  echo "git-init: new admin password stored; show it with: docker compose exec git cat $PWFILE"
  exit 0
elif [ -n "${1:-}" ]; then
  fail "unknown command: $1 (known: reset-password)"
fi

if forgejo admin user list --admin | awk 'NR > 1 { print $2 }' | grep -qx "$ADMIN"; then
  [ -s "$PWFILE" ] || fail "admin user exists but its password file is missing; set a new one with: docker compose run --rm git-init reset-password"
  echo "git-init: admin user $ADMIN already exists"
else
  [ -s "$PWFILE" ] || newpw > "$PWFILE"
  [ "$(wc -c < "$PWFILE")" -ge 24 ] || fail "could not generate a password"
  forgejo admin user create --admin --username "$ADMIN" --email "$ADMIN@levuvo-sf.local" \
    --password "$(cat "$PWFILE")" --must-change-password=false > /dev/null
  echo "git-init: admin user $ADMIN created"
fi

# the password goes to curl on its standard input (a config file), never on a command line or into a log
api() { # api <method> <path> [json] -> prints the HTTP status
  printf 'user = "%s:%s"\n' "$ADMIN" "$(cat "$PWFILE")" | curl -s -o /dev/null -w '%{http_code}' -K - \
    -X "$1" -H 'Content-Type: application/json' ${3:+--data "$3"} "$API$2"
}

[ "$(api GET /user)" = 200 ] || fail "admin login failed; the stored password does not match; set a new one with: docker compose run --rm git-init reset-password"

case "$(api GET "/orgs/$ORG")" in
  200) echo "git-init: organization $ORG already exists" ;;
  404)
    [ "$(api POST /orgs "{\"username\":\"$ORG\",\"visibility\":\"private\",\"repo_admin_change_team_access\":false}")" = 201 ] \
      || fail "could not create organization $ORG"
    echo "git-init: organization $ORG created" ;;
  *) fail "unexpected answer when checking organization $ORG" ;;
esac
echo "git-init: done"
