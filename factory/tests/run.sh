#!/usr/bin/env bash
# Levuvo SF factory tests: unit tests of every image, then the whole stack in Docker – block 1 (Forgejo setup,
# hardening, network isolation, restart, password reset) and block 2 (factory API, project repositories, briefing
# screening, isolated interviewer runs with the real Claude CLI against a scripted fake model API, model gateway,
# pause/resume, wait time, run container isolation, no API key in any agent container or log). Needs only Docker,
# bash and curl. Optional: LEVUVO_SF_EXTRA_CA=<CA bundle> for builds behind a TLS-intercepting proxy (cloud sessions).
# Usage (from the repo root): factory/tests/run.sh
# Runs as its own Compose project `levuvo-sf-test` (own containers, volume, networks and port 3999), so it never
# touches the real factory `levuvo-sf`. It removes only the test project and its volume at the end.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
FACTORY="$(pwd)"
P=levuvo-sf-test
export LEVUVO_SF_GIT_PORT=${LEVUVO_SF_TEST_GIT_PORT:-3999}
export LEVUVO_SF_API_PORT=${LEVUVO_SF_TEST_API_PORT:-3998}
dc() { docker compose --project-directory "$FACTORY" -f "$FACTORY/compose.yaml" -f "$FACTORY/tests/compose.test.yaml" -p "$P" "$@"; }
TEST_KEY=sk-ant-test-e2e-0123456789abcdefghijklmnop

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

BUILD=(); [[ -n "${LEVUVO_SF_EXTRA_CA:-}" ]] && BUILD+=(--secret "id=extra_ca,src=$LEVUVO_SF_EXTRA_CA" --network host)
build() { docker build -q "${BUILD[@]}" "$@" >/dev/null; }

echo "› unit tests"
build --target test "$FACTORY/egress-proxy" && ok "egress proxy unit tests" || bad "egress proxy unit tests"
build --target test "$FACTORY/model-gateway" && ok "model gateway unit tests" || bad "model gateway unit tests"
build --target test "$FACTORY/worker" && ok "worker unit tests (CLI flags, MCP relay)" || bad "worker unit tests"
build --target test -f "$FACTORY/api/Dockerfile" "$FACTORY/.." && ok "factory unit tests (coverage floor 90 %)" || bad "factory unit tests"

echo "› build the images and start the stack (project $P)"
build -t levuvo-sf/egress-proxy:local "$FACTORY/egress-proxy"
build -t levuvo-sf/model-gateway:local "$FACTORY/model-gateway"
build -t levuvo-sf/model-gateway:testable --target testable "$FACTORY/model-gateway"
build -t levuvo-sf/worker:local "$FACTORY/worker"
build -t levuvo-sf/factory:local -f "$FACTORY/api/Dockerfile" "$FACTORY/.."
cleanup
dc up -d >/dev/null 2>&1 || { dc logs; echo "✗ docker compose up failed"; exit 1; }
wait_init() { check "${1:-git-init finished without error}" "${2:-0}" "$(docker wait "$P-git-init-1")"; }
wait_init
for s in egress-model egress-build model-gateway factory; do
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
for c in git git-init egress-model egress-build model-gateway factory worker-image; do
  id="$P-$c-1"
  read -r user ro caps secopt mem cpus pids <<< "$(docker inspect -f '{{.Config.User}} {{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}} {{.HostConfig.SecurityOpt}} {{.HostConfig.Memory}} {{.HostConfig.NanoCpus}} {{.HostConfig.PidsLimit}}' "$id")"
  check "$c: non-root user set" yes "$([[ -n $user && $user != 0 && $user != root && $user != 0:* ]] && echo yes || echo "no ($user)")"
  check "$c: read-only root, all caps dropped, no-new-privileges" "true [ALL] [no-new-privileges:true]" "$ro $caps $secopt"
  check "$c: memory, CPU and process limits" 1 "$(( mem > 0 && cpus > 0 && pids > 0 ))"
  # git-init has exited by now; its user is checked above
  [[ $c == git-init || $c == worker-image ]] || check "$c: the running process is not root" yes "$([[ "$(docker exec "$id" id -u)" != 0 ]] && echo yes || echo no)"
done
check "git port is published on 127.0.0.1 only" "127.0.0.1" "$(docker inspect -f '{{range $p, $b := .NetworkSettings.Ports}}{{range $b}}{{.HostIp}} {{end}}{{end}}' "$P-git-1" | xargs)"
read -r caps secopt <<< "$(docker inspect -f '{{.HostConfig.CapDrop}} {{.HostConfig.SecurityOpt}}' "$P-docker-proxy-1")"
check "docker-proxy: all caps dropped, no-new-privileges, own network only" "[ALL] [no-new-privileges:true] ${P}_docker" "$caps $secopt $(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$P-docker-proxy-1" | xargs)"
check "factory API port is published on 127.0.0.1 only" "127.0.0.1" "$(docker inspect -f '{{range $p, $b := .NetworkSettings.Ports}}{{range $b}}{{.HostIp}} {{end}}{{end}}' "$P-factory-1" | xargs)"
for n in factory agents-model agents-build agents-api docker; do
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

echo "› factory API (block 2)"
API=http://127.0.0.1:$LEVUVO_SF_API_PORT
post() { curl -s -X "${3:-POST}" -H 'Content-Type: application/json' --data "$2" "$API$1"; }
get() { curl -s "$API$1"; }
b64() { printf '%s' "$1" | base64 | tr -d '\n'; }
check "health" true "$(get /api/health | json 'd.ok')"
check "wrong Host header refused (DNS rebinding)" 421 "$(status -H 'Host: evil.example' "$API/api/health")"
check "foreign Origin refused" 403 "$(status -X POST -H 'Content-Type: application/json' -H 'Origin: https://evil.example' --data '{"name":"x"}' "$API/api/projects")"
check "non-JSON write refused" 415 "$(status -X POST -H 'Content-Type: text/plain' --data 'name=x' "$API/api/projects")"
check "default model and effort per role" "claude-opus-5-5 medium 9" "$(get /api/settings | json 'd.roles.interviewer.model+" "+d.roles.interviewer.effort+" "+Object.keys(d.roles).length')"
check "subscription mode not available yet" 400 "$(status -X PUT -H 'Content-Type: application/json' --data '{"billing_mode":"subscription"}' "$API/api/settings")"

echo "› project creation: private repository with protected main (A0)"
for p in e2e-main e2e-pause e2e-timeout e2e-web; do
  check "create project $p" 201 "$(status -X POST -H 'Content-Type: application/json' --data "{\"name\":\"E2E $p\",\"slug\":\"$p\"}" "$API/api/projects")"
done
check "a second project with the same name is refused" 409 "$(status -X POST -H 'Content-Type: application/json' --data '{"name":"x","slug":"e2e-main"}' "$API/api/projects")"
check "repository is private and has its README" "true true" "$(admin "$GIT/api/v1/repos/levuvo-sf/e2e-main" | json 'd.private+" "+!d.empty')"
check "main is protected; only the factory account may push" "main levuvo-factory" "$(admin "$GIT/api/v1/repos/levuvo-sf/e2e-main/branch_protections" | json 'd[0].rule_name+" "+d[0].push_whitelist_usernames.join(",")')"
check "the factory account is not an admin" false "$(admin "$GIT/api/v1/users/levuvo-factory" | json 'd.is_admin')"

echo "› briefing upload and screening (A1)"
NOTES="# Idea\nCourt booking for our tennis club, 180 members, 6 courts. Guests play with members."
for p in e2e-main e2e-pause e2e-timeout e2e-web; do
  post "/api/projects/$p/briefing" "{\"path\":\"notes.md\",\"content_base64\":\"$(b64 "$(printf "$NOTES")")\"}" "PUT" >/dev/null
done
check "a text file with a secret is blocked" "false blocked" "$(post /api/projects/e2e-main/briefing "{\"path\":\"secret.txt\",\"content_base64\":\"$(b64 'aws_access_key_id = AKIAZ7Q3XK4N2TJ5WB6M')\"}" PUT | json 'd.file.readable+" "+d.file.secret_scan.status')"
check "a video is marked unreadable" false "$(post /api/projects/e2e-main/briefing "{\"path\":\"talk.mp4\",\"content_base64\":\"$(b64 'video')\"}" PUT | json 'd.file.readable')"
check "a path with .. is refused" 400 "$(status -X PUT -H 'Content-Type: application/json' --data "{\"path\":\"../x.md\",\"content_base64\":\"eA==\"}" "$API/api/projects/e2e-main/briefing")"

echo "› model gateway and agent network (agents-api)"
agent() { # agent <args…>: runs node in the worker image on agents-api, hardened like a run
  docker run --rm --network "${P}_agents-api" --read-only --cap-drop ALL --security-opt no-new-privileges:true --user 1000:1000 \
    -v "$FACTORY/tests/probe.mjs:/probe.mjs:ro" --entrypoint node levuvo-sf/worker:local "$@"
}
gw() { agent -e "const [m,p,k]=process.argv.slice(1);fetch('http://model-gateway:8080'+p,{method:m,headers:{'content-type':'application/json',...(k?{'x-api-key':k}:{})},body:m==='POST'?'{}':undefined}).then(r=>console.log(r.status),e=>console.log(e.cause?.code??'ERR'))" "$@"; }
check "gateway: no token → 401" 401 "$(gw POST /v1/messages)"
check "gateway: unknown token → 401" 401 "$(gw POST /v1/messages "$(printf 'f%.0s' {1..64})")"
check "gateway: other path → 404" 404 "$(gw POST /v1/models)"
check "gateway: GET → 405" 405 "$(gw GET /v1/messages)"
r="$(agent /probe.mjs connect model-gateway:8080 'api.anthropic.com:443' 2>&1 | head -1)"; [[ "$r" == closed || "$r" == 4* ]] && ok "gateway: no CONNECT tunnel ($r)" || bad "gateway: no CONNECT tunnel ($r)"
r="$(agent /probe.mjs direct 1.1.1.1 443)"; [[ "$r" != connected ]] && ok "agents-api: no direct internet ($r)" || bad "agents-api: no direct internet"
for h in example.com egress-model egress-build git factory docker-proxy fake-model; do
  r="$(agent /probe.mjs dns $h)"; [[ ! "$r" =~ ^[0-9a-f.:]+$ ]] && ok "agents-api: $h not reachable ($r)" || bad "agents-api: $h not reachable ($r)"
done
check "docker-proxy refuses exec start" 403 "$(dc exec -T factory node -e "require('http').request({host:'docker-proxy',port:2375,method:'POST',path:'/exec/x/start'},r=>console.log(r.statusCode)).on('error',e=>console.log(e.code)).end()")"
check "docker-proxy refuses image pulls" 403 "$(dc exec -T factory node -e "require('http').request({host:'docker-proxy',port:2375,method:'POST',path:'/images/create?fromImage=alpine'},r=>console.log(r.statusCode)).on('error',e=>console.log(e.code)).end()")"
printf '%s\n' "$TEST_KEY" | dc run --rm -T set-api-key >/dev/null 2>&1
check "set-api-key stores the key with mode 0600" "600" "$(dc exec -T model-gateway stat -c '%a' /run/levuvo/key/api-key)"
out="$(printf 'not-a-key\n' | dc run --rm -T set-api-key 2>&1 || true)"; grep -q "does not look like" <<< "$out" && ok "set-api-key refuses a wrong key" || bad "set-api-key refuses a wrong key ($out)"

wait_iv() { # wait_iv <project> <status regexp> <seconds>
  for _ in $(seq 1 "$3"); do s="$(get "/api/projects/$1/interview" | json 'd.status')"; [[ "$s" =~ ^($2)$ ]] && { echo "$s"; return; }; sleep 1; done; echo "timeout ($s)"
}
open_q() { get "/api/projects/$1/interview" | json 'd.open_question ? d.open_question.id : ""'; }
answer() { post "/api/projects/$1/interview/answer" "{\"question_id\":\"$2\",\"text\":\"$3\"}" | json 'd.delivered'; }

echo "› interview run (A2) with the real Claude CLI: full lifecycle"
check "start the interview" true "$(post /api/projects/e2e-main/interview/start '{}' | json '/^run-/.test(d.run_id)')"
check "a second start is refused while it runs" 409 "$(status -X POST -H 'Content-Type: application/json' --data '{}' "$API/api/projects/e2e-main/interview/start")"
check "the agent asks its first question" waiting_for_human "$(wait_iv e2e-main waiting_for_human 120)"
RUN="$(docker ps --filter label=dev.levuvo-sf.run --filter label=dev.levuvo-sf.project=$P --format '{{.Names}}' | head -1)"
read -r user ro caps secopt nets mounts <<< "$(docker inspect -f '{{.Config.User}} {{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}} {{.HostConfig.SecurityOpt}} {{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}} {{len .Mounts}}' "$RUN")"
check "run container: non-root, read-only, no caps, no-new-privileges" "1001:1001 true [ALL] [no-new-privileges:true]" "$user $ro $caps $secopt"
check "run container: only the agents-api network, two mounts" "${P}_agents-api 2" "$nets $mounts"
check "run container: no Docker socket, in read-only, io writable" "/run/levuvo/in:false /run/levuvo/io:true" "$(docker inspect -f '{{range .Mounts}}{{.Destination}}:{{.RW}} {{end}}' "$RUN" | xargs)"
if docker exec "$RUN" sh -c 'touch /run/levuvo/io/res/x || mv /run/levuvo/io/res /run/levuvo/io/r2 || ln -s /etc /run/levuvo/io/res/l' 2>/dev/null; then bad "the run cannot write or replace the answer folder"; else ok "the run cannot write or replace the answer folder"; fi
if docker inspect -f '{{.Config.Env}}' "$RUN" | grep -qF "$TEST_KEY"; then bad "the API key is not in the run container"; else ok "the API key is not in the run container"; fi
if docker exec "$RUN" sh -c "grep -rqsF '$TEST_KEY' /run /home /tmp /opt 2>/dev/null"; then bad "no file in the run container holds the API key"; else ok "no file in the run container holds the API key"; fi
echo "  (holding the question for 130 s: ask_human must not move to the background after 2 minutes)"
sleep 130
check "after 130 s the run still waits for the answer" waiting_for_human "$(wait_iv e2e-main waiting_for_human 1)"
Q="$(open_q e2e-main)"
check "answer delivered to the waiting run" true "$(answer e2e-main "$Q" 'Ja, passt so')"
check "the closing question comes" waiting_for_human "$(sleep 3; wait_iv e2e-main waiting_for_human 120)"
Q2="$(open_q e2e-main)"
check "the closing question is marked as interview end" "interview end" "$(get /api/projects/e2e-main/interview | json 'd.open_question.refs.join(",")')"
answer e2e-main "$Q2" "Ja, fertig" >/dev/null
check "the interview finishes" finished "$(wait_iv e2e-main finished 120)"
for _ in $(seq 1 30); do [[ -z "$(docker ps -aq --filter label=dev.levuvo-sf.project=$P --filter label=dev.levuvo-sf.run)" ]] && break; sleep 1; done
check "the run container is removed" "" "$(docker ps -aq --filter label=dev.levuvo-sf.project=$P --filter label=dev.levuvo-sf.run)"
RID="$(get /api/projects/e2e-main/interview | json 'd.log.runs[0].run_id')"
REC="$(get "/api/runs/$RID")"
check "run record: reason, model, effort, billing" "finished claude-opus-5-5 medium api" "$(json 'd.exit_reason+" "+d.model+" "+d.effort+" "+d.billing_mode' <<< "$REC")"
check "the CLI offered exactly the six A2 tools" "mcp__factory__ask_human,mcp__factory__finish_interview,mcp__factory__read_briefing,mcp__factory__tag_briefing_file,mcp__factory__update_features,mcp__factory__update_prd_section" "$(json 'd.tools_offered.slice().sort().join(",")' <<< "$REC")"
check "usage recorded per run incl. cache tokens, cost estimated" "true true true" "$(json '(d.usage.calls>15)+" "+(d.usage.cache_read_input_tokens>0)+" "+(d.usage.estimated_cost_usd>0)' <<< "$REC")"
check "the run token was revoked" "" "$(dc exec -T factory ls /run/levuvo/tokens)"
FAKE="$(dc logs --no-log-prefix fake-model)"
check "no script mismatch in the fake model" 0 "$(grep -c '"mismatch"' <<< "$FAKE")"
check "the gateway always sent exactly the stored key, never the run token" 0 "$(grep '"project":"e2e-main"' <<< "$FAKE" | grep -c '"key_ok":false')"
check "the model got the interview skill as system prompt and only the six tools" 0 "$(grep '"project":"e2e-main"' <<< "$FAKE" | grep -v '"skill_in_system":true' | grep -c .)"
check "PRD rendered with status and source" "> Status: deferred · Source: briefing/notes.md; answer $Q" "$(get /api/projects/e2e-main/interview/prd.md | grep -A1 '## 10 Open questions' | tail -1)"
check "feature list rendered" 1 "$(get /api/projects/e2e-main/interview/features.md | grep -c '| F-001 | Book a court')"

echo "› pause and resume (fresh run, drafts and answer handed over)"
post /api/projects/e2e-pause/interview/start '{}' >/dev/null
check "the agent asks" waiting_for_human "$(wait_iv e2e-pause waiting_for_human 120)"
check "pause by the human" paused "$(post /api/projects/e2e-pause/interview/pause '{}' >/dev/null; wait_iv e2e-pause paused 60)"
check "the draft is kept" drafted "$(get /api/projects/e2e-pause/interview | json 'd.prd[1].status')"
check "an answer while paused is stored for the next run" false "$(answer e2e-pause Q-001 'Nur Mitglieder')"
post /api/projects/e2e-pause/interview/start '{}' >/dev/null
check "the resumed run ends without finishing" paused "$(sleep 2; wait_iv e2e-pause paused 120)"
check "the fresh run got the draft and the answer" 1 "$(dc logs --no-log-prefix fake-model | grep '"project":"e2e-pause","resume":true' | grep -c '"action":"text"')"
check "two runs, reasons paused_by_human and ended_without_finish" "paused_by_human ended_without_finish" "$(for r in $(get /api/projects/e2e-pause/interview | json 'd.log.runs.map(r=>r.run_id).join(" ")'); do get "/api/runs/$r" | json 'd.exit_reason'; done | xargs)"

echo "› the ask_human wait time ends the run like a pause (G2.2)"
post /api/settings '{"ask_human_wait_minutes":1}' PUT >/dev/null
post /api/projects/e2e-timeout/interview/start '{}' >/dev/null
check "the agent asks" waiting_for_human "$(wait_iv e2e-timeout waiting_for_human 120)"
check "after the wait time the run is paused" paused "$(wait_iv e2e-timeout paused 100)"
check "reason: paused_wait_timeout" paused_wait_timeout "$(get /api/projects/e2e-timeout/interview | json 'd.last_exit_reason')"
post /api/settings '{"ask_human_wait_minutes":10}' PUT >/dev/null

echo "› web search for the interviewer: off by default, switched on with the README command"
check "levuvo-sf web-search shows: off by default" "Interviewer web search: off" "$(dc exec -T factory levuvo-sf web-search | cut -d' ' -f1-4)"
check "web search refused for other roles" 400 "$(status -X PUT -H 'Content-Type: application/json' --data '{"roles":{"builder":{"web_search":true}}}' "$API/api/settings")"
check "the run without web search had no WebSearch tool and sent no server-side tool" "0 0" "$(grep -c '"project":"e2e-main".*WebSearch' <<< "$FAKE") $(grep -c '"project":"websearch"' <<< "$FAKE")"
check "levuvo-sf web-search on" "Interviewer web search: on" "$(dc exec -T factory levuvo-sf web-search on | cut -d' ' -f1-4)"
post /api/projects/e2e-web/interview/start '{}' >/dev/null
check "the run with web search ends" paused "$(wait_iv e2e-web paused 120)"
WREC="$(get "/api/runs/$(get /api/projects/e2e-web/interview | json 'd.log.runs[0].run_id')")"
check "run record: web search on, one search counted and priced" "true 1 true" "$(json 'd.web_search+" "+d.usage.web_search_requests+" "+(d.usage.estimated_cost_usd>=0.01)' <<< "$WREC")"
check "the CLI offered the six A2 tools plus WebSearch, nothing else" "WebSearch,mcp__factory__ask_human,mcp__factory__finish_interview,mcp__factory__read_briefing,mcp__factory__tag_briefing_file,mcp__factory__update_features,mcp__factory__update_prd_section" "$(json 'd.tools_offered.slice().sort().join(",")' <<< "$WREC")"
WFAKE="$(dc logs --no-log-prefix fake-model)"
check "the search went through the gateway as Anthropic's server-side search, with the stored key" "1 0" "$(grep '"project":"websearch"' <<< "$WFAKE" | grep -c '"server_tools":\["web_search_20250305"\]') $(grep '"project":"websearch"' <<< "$WFAKE" | grep -c '"key_ok":false')"
check "no script mismatch with web search" 0 "$(grep -E '"project":"(e2e-web|websearch)"' <<< "$WFAKE" | grep -c '"mismatch"')"
check "the PRD cites the web source with its retrieval date" 1 "$(get /api/projects/e2e-web/interview/prd.md | grep -c "web https://eur-lex.europa.eu/eli/dir/2019/882/oj (retrieved $(date -u +%F))")"
check "the gateway log holds no search query" 0 "$(dc logs model-gateway 2>&1 | grep -c 'Accessibility')"
check "levuvo-sf web-search off" "Interviewer web search: off" "$(dc exec -T factory levuvo-sf web-search off | cut -d' ' -f1-4)"

echo "› levuvo-sf demo as the owner runs it (README step 5)"
# answers like a person: types once each question is shown, stdin stays open until the demo has ended
answer_demo() { # waits for each NEW question id (Q-001, then Q-002) before answering
  local n=0
  for a in "1, aber Buchung im Viertelstundentakt" ""; do
    n=$((n + 1))
    for _ in $(seq 1 90); do dc exec -T factory levuvo-sf status 2>/dev/null | grep -q "^demo-.*waiting for Q-00$n" && break; sleep 1; done
    printf '%s\n' "$a"
  done
  sleep 20
}
out="$(answer_demo | dc exec -T factory levuvo-sf demo 2>&1 || true)"
if grep -q "Empfehlung:" <<< "$out" && grep -q "Deine Antwort:" <<< "$out" && grep -q "^Interview finished (finished)" <<< "$out" && grep -qE "^Tokens: [1-9][0-9]* in" <<< "$out" && grep -q "## 1 Vision" <<< "$out"; then ok "demo: German labels, option plus note, finished with usage and PRD"; else bad "demo: German labels, option plus note, finished with usage and PRD ($(tail -8 <<< "$out" | tr '\n' ' '))"; fi
if dc logs fake-model 2>/dev/null | grep '"project":"demo"' | grep -q mismatch; then bad "demo: the fake model saw what it expected"; else ok "demo: the fake model saw what it expected"; fi
check "status lists the demo project" 1 "$(dc exec -T factory levuvo-sf status | grep -c '^demo-')"

echo "› the API key appears nowhere else"
if dc logs 2>&1 | grep -qF "$TEST_KEY"; then bad "the API key is in no container log"; else ok "the API key is in no container log"; fi
if dc exec -T factory sh -c "grep -rqsF '$TEST_KEY' /var/lib/levuvo /run/levuvo"; then bad "the API key is nowhere in the factory's data"; else ok "the API key is nowhere in the factory's data"; fi

echo "› docker compose stop ends active runs cleanly"
post /api/projects/e2e-timeout/interview/start '{}' >/dev/null
check "the agent asks" waiting_for_human "$(wait_iv e2e-timeout waiting_for_human 120)"
dc stop factory >/dev/null 2>&1
check "no run container is left" 0 "$(docker ps -a --filter label=dev.levuvo-sf.project=$P --filter label=dev.levuvo-sf.run -q | wc -l | xargs)"
check "no run token is left" 0 "$(dc exec -T model-gateway sh -c 'ls /run/levuvo/tokens | wc -l' | xargs)"
dc start factory >/dev/null 2>&1
for _ in $(seq 1 60); do [[ "$(docker inspect -f '{{.State.Health.Status}}' "$P-factory-1")" == healthy ]] && break; sleep 1; done
check "the run ended as factory_stopped and the interview is paused" "factory_stopped paused" "$(get /api/projects/e2e-timeout/interview | json 'd.last_exit_reason+" "+d.status')"
check "its usage was recorded" true "$(get "/api/runs/$(get /api/projects/e2e-timeout/interview | json 'd.log.runs.at(-1).run_id')" | json 'd.usage.calls>0')"

echo "› restart keeps data and password"
dc down >/dev/null 2>&1
dc up -d >/dev/null 2>&1
wait_init
check "same password works after restart" levuvo-admin "$(admin "$GIT/api/v1/user" | json 'd.login')"
check "repository survived the restart" 200 "$(admin -o /dev/null -w '%{http_code}' "$GIT/api/v1/repos/levuvo-sf/probe")"
for _ in $(seq 1 60); do [[ "$(docker inspect -f '{{.State.Health.Status}}' "$P-factory-1")" == healthy ]] && break; sleep 1; done
check "factory data survived the restart" finished "$(get /api/projects/e2e-main/interview | json 'd.status')"
check "the factory token still works after the restart" 201 "$(status -X POST -H 'Content-Type: application/json' --data '{"name":"after restart","slug":"e2e-after"}' "$API/api/projects")"

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
