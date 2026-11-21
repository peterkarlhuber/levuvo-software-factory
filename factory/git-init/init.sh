#!/bin/sh
# Levuvo SF first-start setup for Forgejo: admin user `levuvo-admin` and organization `levuvo-sf`.
# Runs in a one-shot container from the Forgejo image after the server is healthy, on every `docker compose up`.
# Idempotent: a second run changes nothing. Fails closed: anything unexpected stops with an error, nothing is guessed.
# The generated admin password lives only in the Forgejo data volume (mode 0600) and is never printed.
set -eu

ADMIN=levuvo-admin
ORG=levuvo-sf
API=http://git:3000/api/v1
SECRETS=/var/lib/gitea/levuvo
PWFILE=$SECRETS/admin-password

fail() { echo "git-init: ERROR: $*" >&2; exit 1; }

umask 077
mkdir -p "$SECRETS"
chmod 700 "$SECRETS"

if forgejo admin user list --admin | awk 'NR > 1 { print $2 }' | grep -qx "$ADMIN"; then
  [ -s "$PWFILE" ] || fail "admin user exists but its password file is missing; reset it with: docker compose exec git forgejo admin user change-password --username $ADMIN --password <new> (see factory/README.md)"
  echo "git-init: admin user $ADMIN already exists"
else
  [ -s "$PWFILE" ] || head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32 > "$PWFILE"
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

[ "$(api GET /user)" = 200 ] || fail "admin login failed; the stored password does not match"

case "$(api GET "/orgs/$ORG")" in
  200) echo "git-init: organization $ORG already exists" ;;
  404)
    [ "$(api POST /orgs "{\"username\":\"$ORG\",\"visibility\":\"private\",\"repo_admin_change_team_access\":false}")" = 201 ] \
      || fail "could not create organization $ORG"
    echo "git-init: organization $ORG created" ;;
  *) fail "unexpected answer when checking organization $ORG" ;;
esac
echo "git-init: done"
