#!/usr/bin/env bash
# Levuvo SF block 1 tests: egress proxy unit tests, then the whole stack in Docker (Forgejo setup, hardening,
# network isolation, restart, password reset). Needs only Docker, bash and curl.
# Usage (from the repo root): factory/tests/run.sh
# Runs as its own Compose project `levuvo-sf-test` (own containers, volume, networks and port 3999), so it never
# touches the real factory `levuvo-sf`. It removes only the test project and its volume at the end.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
FACTORY="$(pwd)"
P=levuvo-sf-test
export LEVUVO_SF_GIT_PORT=${LEVUVO_SF_TEST_GIT_PORT:-3999}
dc() { docker compose --project-directory "$FACTORY" -p "$P" "$@"; }

fails=0
ok() { echo "✓ $1"; }
bad() { echo "✗ $1"; fails=$((fails + 1)); }
check() { # check <description> <expected> <actual>
  if [[ "$3" == "$2" ]]; then ok "$1"; else bad "$1 (expected '$2', got '$3')"; fi
}
cleanup() { dc down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT
# json <expression over d>: reads JSON on stdin, prints the expression (node from the proxy image, no host Python)
json() { docker run --rm -i --entrypoint node levuvo-sf/egress-proxy:local -e \
  'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const d=JSON.parse(s);console.log(new Function("d","return "+process.argv[1])(d))})' "$1"; }

echo "› unit tests (egress proxy)"
docker build -q --target test "$FACTORY/egress-proxy" >/dev/null && ok "egress proxy unit tests" || bad "egress proxy unit tests"

echo "› start the stack (project $P)"
cleanup
dc up -d --build >/dev/null 2>&1 || { dc logs; echo "✗ docker compose up failed"; exit 1; }
wait_init() { check "${1:-git-init finished without error}" "${2:-0}" "$(docker wait "$P-git-init-1")"; }
wait_init
for s in egress-model egress-build; do
  for _ in $(seq 1 30); do [[ "$(docker inspect -f '{{.State.Health.Status}}' "$P-$s-1")" == healthy ]] && break; sleep 1; done
  check "$s healthy" healthy "$(docker inspect -f '{{.State.Health.Status}}' "$P-$s-1")"
done

GIT=http://127.0.0.1:$LEVUVO_SF_GIT_PORT
read_pw() { PW="$(dc exec -T git cat /var/lib/gitea/levuvo/admin-password)"; }
read_pw
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
admin() { printf 'user = "levuvo-admin:%s"\n' "$PW" | curl -s -K - "$@"; }

echo "› Forgejo"
check "official image, pinned by digest" "codeberg.org/forgejo/forgejo:15.0.12-rootless@sha256:b670d7724274e1d5c7801b76017b7267e6e5432aa4fe8bed49f781d09476b9dd" \
  "$(docker inspect -f '{{.Config.Image}}' "$P-git-1")"
check "admin password has 32 characters" 32 "${#PW}"
check "password file is private (0600, owner git)" "600 git" "$(dc exec -T git stat -c '%a %U' /var/lib/gitea/levuvo/admin-password)"
check "admin can sign in and is admin" "levuvo-admin true" "$(admin "$GIT/api/v1/user" | json 'd.login+" "+d.is_admin')"
check "organization levuvo-sf exists and is private" private "$(admin "$GIT/api/v1/orgs/levuvo-sf" | json 'd.visibility')"
check "anonymous API access is refused" 403 "$(status "$GIT/api/v1/orgs/levuvo-sf")"
check "anonymous web access goes to the login page" "303" "$(status "$GIT/explore/repos")"
if curl -s "$GIT/user/sign_up" | grep -q "Registration is disabled"; then ok "self-registration is disabled"; else bad "self-registration is disabled"; fi
check "a repo requested as public is created private" true "$(admin -X POST -H 'Content-Type: application/json' \
  --data '{"name":"probe","private":false}' "$GIT/api/v1/orgs/levuvo-sf/repos" | json 'd.private')"
check "migrations and mirrors are disabled" "true true" "$(admin "$GIT/api/v1/settings/repository" | json 'd.migrations_disabled+" "+d.mirrors_disabled')"
if dc logs 2>&1 | grep -qF "$PW"; then bad "admin password never appears in a log"; else ok "admin password never appears in a log"; fi

echo "› container hardening"
for c in git git-init egress-model egress-build; do
  id="$P-$c-1"
  read -r user ro caps secopt mem cpus pids <<< "$(docker inspect -f '{{.Config.User}} {{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}} {{.HostConfig.SecurityOpt}} {{.HostConfig.Memory}} {{.HostConfig.NanoCpus}} {{.HostConfig.PidsLimit}}' "$id")"
  check "$c: non-root user set" yes "$([[ -n $user && $user != 0 && $user != root && $user != 0:* ]] && echo yes || echo "no ($user)")"
  check "$c: read-only root, all caps dropped, no-new-privileges" "true [ALL] [no-new-privileges:true]" "$ro $caps $secopt"
  check "$c: memory, CPU and process limits" 1 "$(( mem > 0 && cpus > 0 && pids > 0 ))"
  # git-init has exited by now; its user is checked above
  [[ $c == git-init ]] || check "$c: the running process is not root" yes "$([[ "$(docker exec "$id" id -u)" != 0 ]] && echo yes || echo no)"
done
check "git port is published on 127.0.0.1 only" "127.0.0.1" "$(docker inspect -f '{{range $p, $b := .NetworkSettings.Ports}}{{range $b}}{{.HostIp}} {{end}}{{end}}' "$P-git-1" | xargs)"
for n in factory agents-model agents-build; do
  check "network ${P}_$n is internal" true "$(docker network inspect -f '{{.Internal}}' "${P}_$n")"
done

echo "› agent network isolation"
probe() { # probe <network> <args…>: runs tests/probe.mjs in a hardened container like a later agent run
  docker run --rm --network "${P}_$1" --read-only --cap-drop ALL --security-opt no-new-privileges:true --user 1000:1000 \
    -v "$FACTORY/tests/probe.mjs:/probe.mjs:ro" --entrypoint node levuvo-sf/egress-proxy:local /probe.mjs "${@:2}"
}
check "model: Claude API, TLS handshake through the tunnel" handshake "$(probe agents-model tls egress-model api.anthropic.com:443 api.anthropic.com)"
check "model: Claude API tunnel with another TLS name refused" closed "$(probe agents-model tls egress-model api.anthropic.com:443 example.com)"
check "model: npm refused" 403 "$(probe agents-model connect egress-model registry.npmjs.org:443)"
check "model: other host refused" 403 "$(probe agents-model connect egress-model example.com:443)"
check "model: Claude API on port 80 refused" 403 "$(probe agents-model connect egress-model api.anthropic.com:80)"
check "model: git server via proxy refused" 403 "$(probe agents-model connect egress-model git:3000)"
check "build: Claude API, TLS handshake" handshake "$(probe agents-build tls egress-build api.anthropic.com:443 api.anthropic.com)"
check "build: npm, TLS handshake" handshake "$(probe agents-build tls egress-build registry.npmjs.org:443 registry.npmjs.org)"
check "build: npm tunnel with another TLS name refused" closed "$(probe agents-build tls egress-build registry.npmjs.org:443 example.com)"
check "build: other host refused" 403 "$(probe agents-build connect egress-build example.com:443)"
for n in agents-model agents-build; do
  r="$(probe "$n" direct 1.1.1.1 443)"; [[ "$r" != connected ]] && ok "$n: no direct internet ($r)" || bad "$n: no direct internet"
  r="$(probe "$n" dns example.com)"; [[ ! "$r" =~ ^[0-9a-f.:]+$ ]] && ok "$n: no outside DNS ($r)" || bad "$n: no outside DNS ($r)"
  r="$(probe "$n" dns git)"; [[ ! "$r" =~ ^[0-9a-f.:]+$ ]] && ok "$n: git server not visible ($r)" || bad "$n: git server not visible ($r)"
done
r="$(probe agents-model dns egress-build)"; [[ ! "$r" =~ ^[0-9a-f.:]+$ ]] && ok "model network cannot reach the build proxy ($r)" || bad "model network cannot reach the build proxy ($r)"
if dc logs egress-model | grep -q '"action":"blocked","host":"example.com"'; then ok "refused requests are logged"; else bad "refused requests are logged"; fi
if dc logs egress-model | grep -q '"reason":"TLS name example.com does not match'; then ok "TLS name mismatches are logged"; else bad "TLS name mismatches are logged"; fi

echo "› restart keeps data and password"
dc down >/dev/null 2>&1
dc up -d >/dev/null 2>&1
wait_init
check "same password works after restart" levuvo-admin "$(admin "$GIT/api/v1/user" | json 'd.login')"
check "repository survived the restart" 200 "$(admin -o /dev/null -w '%{http_code}' "$GIT/api/v1/repos/levuvo-sf/probe")"

echo "› setup fails closed, reset repairs it"
dc exec -T git sh -c 'echo wrong-password-for-the-test > /var/lib/gitea/levuvo/admin-password'
dc up -d --no-deps --force-recreate git-init >/dev/null 2>&1
wait_init "wrong stored password stops setup with an error" 1
if dc logs git-init | grep -q "admin login failed"; then ok "the error names the failed login"; else bad "the error names the failed login"; fi
dc exec -T git rm /var/lib/gitea/levuvo/admin-password
dc up -d --no-deps --force-recreate git-init >/dev/null 2>&1
wait_init "missing password file stops setup with an error" 1
if dc logs git-init | grep -q "password file is missing"; then ok "the error says the file is missing"; else bad "the error says the file is missing"; fi
out="$(dc run --rm --no-deps git-init reset-password 2>&1)"
if grep -q "new admin password stored" <<< "$out"; then ok "reset-password sets a new password"; else bad "reset-password sets a new password ($out)"; fi
OLD="$PW"; read_pw
check "the new password differs and is never printed" "yes no" "$([[ $PW != "$OLD" && ${#PW} == 32 ]] && echo yes || echo no) $(grep -qF "$PW" <<< "$out" && echo yes || echo no)"
check "admin signs in with the new password" levuvo-admin "$(admin "$GIT/api/v1/user" | json 'd.login')"
dc up -d --no-deps --force-recreate git-init >/dev/null 2>&1
wait_init "setup passes again after the reset"

echo
if (( fails )); then echo "✗ $fails check(s) failed"; exit 1; fi
echo "✓ all checks passed"
