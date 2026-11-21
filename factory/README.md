# Levuvo SF – factory stack

The factory's own containers, defined in [compose.yaml](compose.yaml) (Docker Compose project `levuvo-sf`). The host needs only Docker (Docker Desktop 4.30 or newer).

| Service | What it does |
|---|---|
| `git` | Local Forgejo 15 LTS (official multi-arch image, pinned by digest): the factory's git server (WORKFLOW A0). Only on the Mac at http://localhost:3000. Registration off, sign-in required to see anything, every repository private (forced), no migrations, mirrors, Actions or federation. |
| `git-init` | One-shot setup after every start: admin user `levuvo-admin`, private organization `levuvo-sf` and the factory's own account `levuvo-factory` (not an admin, owner of the organization) with its access token. Idempotent; stops with an error instead of guessing. |
| `factory` | The factory service (block 2): internal API on http://localhost:3100 (Mac only), projects, briefing, the interviewer run (A2), settings. |
| `model-gateway` | The model path in API billing mode: the only container that holds the Anthropic API key; adds it to the agents' model calls and records token usage per run. |
| `docker-proxy` | Restricted Docker access for the `factory` service only (start, stop and remove run containers). |
| `worker-image` | Builds the worker image (official Claude CLI, pinned) that every agent run uses; exits at once. |
| `egress-model`, `egress-build` | Egress proxies (block 1) for subscription mode and builders in later blocks: HTTPS only to `api.anthropic.com` (and `registry.npmjs.org` for `build`). |

## Commands

All commands run in Terminal from the `factory/` folder of the repository (`cd ~/Projects/levuvo-software-factory/factory`), in the order you need them.

**1. Start** (the first start downloads and builds for a few minutes):

```sh
docker compose up -d --build
```

**2. Check** – `git`, `factory`, `model-gateway`, `docker-proxy`, `egress-model`, `egress-build` show "Up"; `git-init` and `worker-image` show "Exited (0)":

```sh
docker compose ps -a
```

**3. Store the Anthropic API key** (once; paste the key, the input stays hidden; a new key applies at once):

```sh
docker compose run --rm set-api-key
```

**4. Git server password and sign-in** – show the password of `levuvo-admin`, then open http://localhost:3000 and sign in:

```sh
docker compose exec git cat /var/lib/gitea/levuvo/admin-password
```

**5. See an interview run** – the interviewer asks you about a small sample idea (a tennis club court booking) in the terminal, using the real model; it costs a few cents (estimate). Enter alone takes the recommendation, `p` pauses, `q` pauses and quits. At the end it shows the PRD draft, the feature list and the tokens used:

```sh
docker compose exec factory levuvo-sf demo
```

Projects and their interview status: `docker compose exec factory levuvo-sf status`. Each demo project also appears as a private repository in the organization `levuvo-sf` on the git server.

**6. Stop and start again** (all data stays):

```sh
docker compose stop
docker compose start
```

**7. Get the newest version after a merge** (fetches the code, rebuilds what changed, restarts):

```sh
cd ~/Projects/levuvo-software-factory && git pull && cd factory && docker compose up -d --build
```

**8. Troubleshooting**

- What a service did: `docker compose logs factory` (or `git-init`, `model-gateway`, `egress-model`).
- The git server password was changed in the web UI or the file is lost (the setup then stops with "admin login failed"): set a new random one, nothing to type:

  ```sh
  docker compose run --rm git-init reset-password
  ```

- A run ends at once with "no API key stored": run step 3.

**9. Delete everything** including all repositories, projects and the stored API key (cannot be undone):

```sh
docker compose down -v
```

Keep the generated git password; do not change it in the Forgejo UI.

## Factory API (block 2)

Local only (`127.0.0.1:3100`), JSON. The web UI of block 3 will use it from the same origin. Every request needs the Host `localhost:3100` or `127.0.0.1:3100`; changing requests must be `Content-Type: application/json` and carry no foreign `Origin`.

| Method and path | What it does |
|---|---|
| `GET /api/health` | liveness |
| `GET`/`PUT /api/settings` | model and effort per role (all nine roles, default `claude-opus-5-5` / `medium`), `billing_mode` (`api` only for now), `ask_human_wait_minutes` (10), `idle_stop_minutes` (15), `max_turns_per_run` (300), `human_language` (`de`) |
| `GET`/`POST /api/projects` | list; create `{name, slug?, description?}` → private repository `levuvo-sf/<slug>` with README and protected `main` (A0) |
| `GET /api/projects/<slug>` | overview |
| `GET`/`PUT`/`DELETE /api/projects/<slug>/briefing` | inventory; upload `{path, content_base64}` (max. 20 MB); delete `{path}` |
| `POST /api/projects/<slug>/interview/start` | starts (or resumes) the interview in a fresh run |
| `GET /api/projects/<slug>/interview` | status, open question, PRD drafts, features, question log, what still blocks finishing |
| `POST /api/projects/<slug>/interview/answer` | `{question_id, text?, chosen_option?}` |
| `POST /api/projects/<slug>/interview/pause` | ends the run; drafts, answers and log stay |
| `GET /api/projects/<slug>/interview/prd.md`, `…/features.md` | rendered drafts |
| `GET /api/runs/<run-id>` | run record: model, effort, billing mode, skill hash, tool calls, tools offered, tokens, estimated cost, exit reason |

## How an agent run works (A2)

1. The factory checks the settings, creates the run record and a random **run token**, and writes the run's `in` folder: the interview skill from this repository (as the system prompt), the start message (fresh, or on resume: drafts, question log and answers) and the tool list.
2. It starts a **fresh container** from the worker image through the docker-proxy, always from the same fixed template: user 1000, read-only root, all capabilities dropped, `no-new-privileges`, memory/CPU/process limits, network `agents-api` only, exactly two mounts (its own `in` read-only, its own `io` writable), no Docker socket.
3. Inside, the official Claude CLI runs with `--bare --tools ""` (no shell, no file access, no web tools), only the factory's MCP server (`--strict-mcp-config`), exactly the six A2 tools by name (`--allowedTools`), `--permission-mode dontAsk`, the role's model and effort and the turn cap. Its API "key" is the run token; its only reachable host is the model gateway, which swaps the token for the real key.
4. Each tool call is a request file in `io`; the factory validates it (JSON Schema 2020-12 with Ajv against `templates/`, plus its own checks) and alone writes PRD drafts, feature list, question log and tags. `ask_human` waits for your answer (API or `levuvo-sf demo`) up to the wait time; then the run ends like a pause and the answer starts a new run later.
5. At the end the container is removed, the token revoked, the usage summed (tokens incl. cache, estimated cost from [api/prices.json](api/prices.json); a call without usage data counts as unknown, never zero) and the run record written.

Interview rules the factory enforces: a section counts as `confirmed` or `deferred` only with an answered question about that section; every source must name a briefing file or an answered question; finishing needs every section settled, a feature list, no unread briefing change and an answered closing question after the last change; feature IDs and statuses come from the factory.

## Security model

PLAYBOOK G7.1–G7.5, checked by the tests:

- Every container runs as a non-root user, with all Linux capabilities dropped, `no-new-privileges`, a read-only root filesystem and memory, CPU and process limits. Exception: `docker-proxy` runs as root (it needs the Docker socket) with a writable root filesystem (HAProxy renders its config at start); it still has all capabilities dropped, `no-new-privileges`, and sits on its own internal network that only `factory` joins.
- Networks (Compose prefixes them with the project name): `levuvo-sf_web` carries only the host ports of `git` and `factory` (bound to 127.0.0.1). `levuvo-sf_factory` (internal) is for trusted factory services; agent containers never join it. `levuvo-sf_docker` (internal): `factory` and `docker-proxy` only. `levuvo-sf_agents-api` (internal): agent runs in API billing mode and the model gateway, nothing else. `levuvo-sf_agents-model` and `levuvo-sf_agents-build` (internal) each have exactly one way out, their CONNECT egress proxy. Only the proxies and the gateway are on `levuvo-sf_internet`.
- Model gateway: accepts only `POST /v1/messages` (and `count_tokens`) with a token of a live run, drops every client credential and header it does not need, adds the key, talks only to `https://api.anthropic.com` with certificate check (fixed in the image; only the separate test image can point it elsewhere), follows no redirects. The key lives in the volume `levuvo-sf_model-key`, mounted read-only into the gateway and nowhere else; no agent container ever sees it (G7.4).
- Docker: only `factory` reaches the docker-socket-proxy, which allows only the containers endpoints (no exec start, images, networks, volumes, build). The proxy is defense in depth; the boundary is the factory's fixed run template, in which nothing comes from a request.
- Briefing: paths are checked before any file access; files over 20 MB are refused (until Git LFS); text files are scanned with gitleaks before any agent access and a finding blocks the file; images are not scanned (the inventory says so); unsupported formats are marked unreadable; agents get only readable, clean files whose hash still matches.
- Local API: exact Host check (against DNS rebinding), JSON-only writes, no foreign Origin, size limits. No user accounts yet; remote access (Tailscale) gets its own sign-in later.
- The egress proxies pass only HTTPS `CONNECT` to the exact host and port of their profile's allowlist ([egress-proxy/allowlist-model.txt](egress-proxy/allowlist-model.txt), [egress-proxy/allowlist-build.txt](egress-proxy/allowlist-build.txt)), refuse private and reserved addresses after DNS and check the TLS server name (SNI). Remaining limit: the HTTP Host header inside TLS is not checked (domain fronting on a shared CDN address). Every decision is one JSON line in the proxy log. The lists are baked into the image: changing them is a reviewed PR.
- Secrets: the git admin password and the factory's git token are generated on start, stored only in the git volume (mode 0600) and never logged; the factory mounts only the token's folder, read-only. No secret is in the repository.
- The git server sits on a non-internal network (Docker needs that to publish a port), so it could reach the internet; everything in it that would call out is switched off.

## Not yet here

- *Block 3:* the web UI (same origin as the API), answer attachments (G2.5).
- *Block 4:* the remaining steps (A3 commits the approved PRD to the project repository, A4–B7), Forgejo CI runner and gates, subscription billing mode (G7.4 exception), Git LFS.
- *Later:* Tailscale/iPhone access with sign-in, GitHub archive mirror.

## Tests

`factory/tests/run.sh` (from the repo root; needs only Docker, bash and curl). Unit tests of every image (egress proxy, model gateway, worker, factory service with a 90 % line coverage floor), then the whole stack as its own Compose project `levuvo-sf-test` (own volumes, networks, ports 3999 and 3998, so it never touches the real factory):

- block 1: Forgejo setup and settings, anonymous access, forced private repos, hardening of every container, isolation of the agent networks, restart keeps data, setup fails closed and `reset-password` repairs it;
- block 2: API same-origin rules, project repositories with protected `main`, briefing screening (secret blocked, video unreadable, bad paths refused), the gateway's refusals and the `agents-api` isolation (no internet, DNS, git, factory, proxies or Docker), docker-proxy refusals, `set-api-key`, and three interviewer runs with the **real Claude CLI in the real worker container** against a scripted fake model API (test image of the gateway only): the full lifecycle with a 130-second wait on `ask_human`, refused shell and blocked-file attempts, refused confirmations without an answer, finish refused then accepted, exactly six tools offered, usage recorded, container removed and token revoked; pause and resume with drafts and answer handed over; the wait time ending a run. The test key must never appear in a run container, a log or the factory's data.

No real API key is needed and nothing is billed. With your real key stored (step 3), `levuvo-sf demo` is the real-model check.
