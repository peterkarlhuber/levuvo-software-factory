# Levuvo SF – factory stack

The factory's own containers, defined in [compose.yaml](compose.yaml) (Docker Compose project `levuvo-sf`). The host needs only Docker (Docker Desktop 4.30 or newer).

| Service | What it does |
|---|---|
| `git` | Local Forgejo 15 LTS (official multi-arch image, pinned by digest): the factory's git server (WORKFLOW A0). Only on the Mac at http://localhost:3000. Registration off, sign-in required to see anything, every repository private (forced), no migrations, mirrors, Actions or federation. |
| `git-init` | One-shot setup after every start: admin user `levuvo-admin`, private organization `levuvo-sf` and the factory's own account `levuvo-factory` (not an admin, owner of the organization) with its access token. Idempotent; stops with an error instead of guessing. |
| `factory` | The factory service: the web UI and its internal API on http://localhost:3100 (Mac only), projects, briefing, the interviewer run (A2), settings. |
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

**5. Open the factory** in Safari: http://localhost:3100

- **Projekte → Neues Projekt:** a name, your idea in a few sentences (stored as `briefing/idea.md`) and any files you have. Each project also gets a private repository in the organization `levuvo-sf` on the git server.
- **Interview starten** on the project page. The interviewer runs in its own sealed container with the real model (a few cents per interview, estimate). The PRD draft and the feature list grow live on the project page.
- **Braucht dich** (start page) lists everything waiting for you: a question, a paused interview, a run that ended with an error. Answer a question by picking an option (the recommendation is preselected), adding a note if you like, or writing your own answer; files can be attached. If the interview was paused (by you, or because nobody answered within the wait time), sending the answer resumes it.
- **Project page → Eigenschaften:** web search for the interviewer (off by default; see below) and **Projekt löschen** (type the name to confirm; it also deletes the project's repository on the git server and cannot be undone).
- **Einstellungen:** language, wait time for your answers, idle stop, turn cap, model and effort per role.

**Web search for the interviewer** (off for every project until you switch it on in the project's Eigenschaften). When it is on, the interviewer may look up current facts, mainly whether laws and regulations apply or have changed, and cites each web source with URL and date. The search runs at Anthropic (about 1 cent per search plus tokens, shown in the run's cost); the run container still reaches nothing but the model gateway, which lets no other server-side tool through. Search queries leave the factory, so the interviewer is told to keep them generic; a manipulated agent could still leak details through a query, which is why you switch it on yourself. API billing mode only. It applies from the next interview run.

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
- The web page says "Keine Verbindung zur Factory": check step 2; `docker compose logs factory` shows why it stopped.

**9. Delete everything** including all repositories, projects and the stored API key (cannot be undone):

```sh
docker compose down -v
```

Keep the generated git password; do not change it in the Forgejo UI.

## Web UI and factory API

The web UI (`factory/ui/`: plain HTML, CSS and JavaScript modules, no framework, no build step) is served by the factory service at `/` from the same origin as the API. The service serves only the files that are in that folder of the image, read once at start, each with a strict Content Security Policy (no inline script or style, nothing from other hosts, no framing); uploaded files are never served to the browser. Everything agents write is shown as text, never as HTML. Every screen refreshes from the API (every 2 s while a run is active, else every 10 s); the factory alone decides every state.

The API is local only (`127.0.0.1:3100`), JSON. Every request needs the Host `localhost:3100` or `127.0.0.1:3100`; changing requests must be `Content-Type: application/json` and carry no foreign `Origin`.

| Method and path | What it does |
|---|---|
| `GET /api/health` | liveness |
| `GET`/`PUT /api/settings` | model and effort per role (all nine roles, default `claude-opus-5-5` / `medium`), `billing_mode` (`api` only for now), `ask_human_wait_minutes` (10), `idle_stop_minutes` (15), `max_turns_per_run` (300), `human_language` (`de`) |
| `GET`/`POST /api/projects` | list with interview status and open question per project; create `{name, slug?, description?}` → private repository `levuvo-sf/<slug>` with README and protected `main` (A0) |
| `GET`/`PUT /api/projects/<slug>` | overview; properties `{web_search: true\|false}` (off for every new project) |
| `DELETE /api/projects/<slug>` | `{confirm: <name or slug>}`: refused while a run is active; first removes whatever an earlier run left (container, token, open run record; if that fails, nothing is deleted), then deletes the project's own repository on the git server (only `levuvo-sf/<slug>` with the id stored at creation; any mismatch refuses), then its data and run records. Runs under the project lock (no start, upload or answer in between); after a failure the project stays marked `deleting`, refuses changes and can be deleted again |
| `GET`/`PUT`/`DELETE /api/projects/<slug>/briefing` | inventory; upload `{path, content_base64}` (max. 20 MB); delete `{path}`. Files under `briefing/answers/` belong to an answer and cannot be replaced or deleted |
| `POST /api/projects/<slug>/interview/start` | starts (or resumes) the interview in a fresh run |
| `GET /api/projects/<slug>/interview` | status, the question you can answer now, PRD drafts, features, question log, what still blocks finishing |
| `POST /api/projects/<slug>/interview/answer` | `{question_id, text?, chosen_option?, attachments?: [{name, content_base64}]}`. Attachments (G2.5) are all screened before anything is stored (a secret refuses the whole answer, nothing is kept), then stored under `briefing/answers/<question id>/`, added to the inventory (`added_via: answer`, without making the interview outdated) and linked with their hash to the answer; if the answer cannot be saved, they are taken back. Only the current question can be answered (the one a run waits for, or after a pause the latest one); older unanswered questions stay in the history. If no run waits for the answer (also when the run is just ending), it resumes the interview once in a fresh run (`resumed: <run id>`, or `resume_error` with the reason) |
| `POST /api/projects/<slug>/interview/pause` | ends the run; drafts, answers and log stay |
| `GET /api/projects/<slug>/interview/prd.md`, `…/features.md` | rendered drafts |
| `GET /api/runs/<run-id>` | run record: model, effort, billing mode, skill hash, tool calls, tools offered, tokens, estimated cost, exit reason |

## How an agent run works (A2)

1. The factory checks the settings, creates the run record and a random **run token**, and writes the run's `in` folder: the interview skill from this repository (as the system prompt), the start message (fresh, or on resume: drafts, question log and answers) and the tool list.
2. It starts a **fresh container** from the worker image through the docker-proxy, always from the same fixed template: user 1001 (not the factory's own user), read-only root, all capabilities dropped, `no-new-privileges`, memory/CPU/process limits, network `agents-api` only, exactly two mounts (its own `in` read-only, its own `io`), no Docker socket. In `io` the run can only create request files (`io/req`) and only read answers (`io/res`); it cannot replace these folders or plant links where the factory writes.
3. Inside, the official Claude CLI runs with `--bare --tools ""` (no shell, no file access, no web tools), only the factory's MCP server (`--strict-mcp-config`), exactly the six A2 tools by name (`--allowedTools`), `--permission-mode dontAsk`, the role's model and effort and the turn cap. Its API "key" is the run token; its only reachable host is the model gateway, which swaps the token for the real key. With web search on, `--bare` is replaced by `--restricted --tools WebSearch` (CLI 2.1.330 drops WebSearch in bare mode): still no command, code or WebFetch tool and no settings files; auto-memory, CLAUDE.md files and bundled skills are switched off by environment variables. In every run `@` file references are switched off (`CLAUDE_CODE_DISABLE_ATTACHMENTS`): files come only through the factory's tools. WebSearch makes its own model call with Anthropic's server-side search tool; the run record shows the setting and the number of searches.
4. Each tool call is a request file in `io/req`; the factory opens it without following links, validates it (JSON Schema 2020-12 with Ajv against `templates/`, plus its own checks) and alone writes PRD drafts, feature list, question log and tags. `ask_human` waits for your answer (web UI) up to the wait time; then the run ends like a pause, and sending the answer later resumes the interview in a new run. Answer attachments reach the run only as paths; it reads them with `read_briefing` and must have read them before it may finish. The same failing tool call three times in a row stops the run (`repeated_failure`).
5. At the end the container is removed, the token revoked (it is renewed on every tool call and answer while the run lives), the usage summed (tokens incl. cache, estimated cost from [api/prices.json](api/prices.json); a call without usage data counts as unknown, never zero), the drafts, feature list and transcript secret-scanned with gitleaks (best effort; a finding is recorded and shown as `output_secret_scan`, nothing is changed) and the run record written. `docker compose stop` ends active runs the same way (`factory_stopped`) before the factory exits; after a crash the next start removes leftover run containers, keeps their transcripts and records the usage the gateway saw. If ending a run fails half-way, the interview is still set to paused (`finish_failed`) and the run record closed, and before every start or deletion the factory removes whatever no live run owns (container, token, run folder) and closes any run record left open; a cleanup that fails refuses the start or the deletion. A new run never starts while a run of the same project still lives or ends.

Interview rules the factory enforces: a section counts as `confirmed` or `deferred` only with an answered question about that section; a briefing change sets the sections whose source names that file back to `drafted`; after `finish_interview` no tool changes anything; every source must name a briefing file, an answered question, an answer attachment or (with web search) a dated web source; until the PRD approval (A3, block 4) a briefing change after the interview finished reopens it; finishing needs every section settled, a feature list, no unread briefing change and an answered closing question after the last change; feature IDs and statuses come from the factory.

## Security model

PLAYBOOK G7.1–G7.5, checked by the tests:

- Every container runs as a non-root user, with all Linux capabilities dropped, `no-new-privileges`, a read-only root filesystem and memory, CPU and process limits. Exception: `docker-proxy` runs as root (it needs the Docker socket) with a writable root filesystem (HAProxy renders its config at start); it still has all capabilities dropped, `no-new-privileges`, and sits on its own internal network that only `factory` joins.
- Networks (Compose prefixes them with the project name): `levuvo-sf_web` carries only the host ports of `git` and `factory` (bound to 127.0.0.1). `levuvo-sf_factory` (internal) is for trusted factory services; agent containers never join it. `levuvo-sf_docker` (internal): `factory` and `docker-proxy` only. `levuvo-sf_agents-api` (internal): agent runs in API billing mode and the model gateway, nothing else. `levuvo-sf_agents-model` and `levuvo-sf_agents-build` (internal) each have exactly one way out, their CONNECT egress proxy. Only the proxies and the gateway are on `levuvo-sf_internet`.
- Model gateway: accepts only `POST /v1/messages` (and `count_tokens`) with a token of a live run, drops every client credential and header it does not need, adds the key, talks only to `https://api.anthropic.com` with certificate check (fixed in the image; only the separate test image can point it elsewhere), follows no redirects. It reads every request: a server-side tool passes only if the run's token allows it, and only the web search version tested with the pinned CLI (`web_search_20250305`, no programmatic callers) for an interviewer run with web search on; newer search versions (which can run code at Anthropic), web fetch, code execution, other Anthropic-defined tools, malformed tool entries, remote MCP servers (`mcp_servers`) and code containers are refused with 403 and a fixed reason, and never reach the API. It records the number of searches per call, never the queries. The key lives in the volume `levuvo-sf_model-key`, mounted read-only into the gateway and nowhere else; no agent container ever sees it (G7.4).
- Docker: only `factory` reaches the docker-socket-proxy, which allows only the containers endpoints (no exec start, images, networks, volumes, build). The proxy is defense in depth; the boundary is the factory's fixed run template, in which nothing comes from a request.
- Briefing: paths are checked before any file access; files over 20 MB are refused (until Git LFS); text files are scanned with gitleaks before any agent access and a finding blocks the file; images are not scanned (the inventory says so); unsupported formats are marked unreadable; agents get only readable, clean files whose hash still matches.
- Local API and web UI: exact Host check (against DNS rebinding), JSON-only writes, no foreign Origin, size limits; the UI is a fixed set of files with a strict Content Security Policy and shows agent text only as text. No user accounts yet; remote access (Tailscale) gets its own sign-in later.
- The egress proxies pass only HTTPS `CONNECT` to the exact host and port of their profile's allowlist ([egress-proxy/allowlist-model.txt](egress-proxy/allowlist-model.txt), [egress-proxy/allowlist-build.txt](egress-proxy/allowlist-build.txt)), refuse private and reserved addresses after DNS and check the TLS server name (SNI). Remaining limit: the HTTP Host header inside TLS is not checked (domain fronting on a shared CDN address). Every decision is one JSON line in the proxy log. The lists are baked into the image: changing them is a reviewed PR.
- Secrets: the git admin password and the factory's git token are generated on start, stored only in the git volume (mode 0600) and never logged; the factory mounts only the token's folder, read-only. No secret is in the repository.
- The git server sits on a non-internal network (Docker needs that to publish a port), so it could reach the internet; everything in it that would call out is switched off.

## Not yet here

- *Block 4:* the remaining steps (A3 commits the approved PRD and the briefing to the project repository – until then the briefing lives only in the factory's volume; A4–B7), Forgejo CI runner and gates, subscription billing mode (G7.4 exception), Git LFS.
- *Next small step:* iPhone access over Tailscale with a sign-in.
- *Later:* GitHub archive mirror, the final design of the UI.

## Tests

`factory/tests/run.sh` (from the repo root; needs only Docker, bash and curl). Unit tests of every image (egress proxy, model gateway, worker, factory service with a 90 % line coverage floor), then the whole stack as its own Compose project `levuvo-sf-test` (own volumes, networks, ports 3999 and 3998, so it never touches the real factory):

- block 1: Forgejo setup and settings, anonymous access, forced private repos, hardening of every container, isolation of the agent networks, restart keeps data, setup fails closed and `reset-password` repairs it;
- block 2: API same-origin rules, project repositories with protected `main`, briefing screening (secret blocked, video unreadable, bad paths refused), the gateway's refusals and the `agents-api` isolation (no internet, DNS, git, factory, proxies or Docker), docker-proxy refusals, `set-api-key`, and interviewer runs with the **real Claude CLI in the real worker container** against a scripted fake model API (test image of the gateway only): the full lifecycle with a 130-second wait on `ask_human` (runs longer than the docker-proxy's 10-minute idle timeout: unit test of the sliced wait), refused shell and blocked-file attempts, refused confirmations without an answer, finish refused then accepted, exactly six tools offered, usage recorded, container removed and token revoked; pause and resume with drafts and answer handed over; the wait time ending a run; the run unable to write or replace its answer folder. The stack is started with `docker compose up -d --build` exactly as in step 1; `docker compose stop` (step 6) during an open question leaves no run container or token, and `docker compose start` brings everything back; a restart with `docker compose up -d --build` (step 7 without `git pull`, which needs a newer remote version) keeps all data. The test key must never appear in a run container, a log or the factory's data.
- web search: off for every new project, no longer a role setting, switched on per project, a run in which the real CLI offers exactly the six tools plus WebSearch and refuses `Bash`, `Read` and `WebFetch`, its search call reaches the API only as Anthropic's server-side search through the gateway, the search is counted and priced in the run record, the PRD cites the web source with its retrieval date, no query in the gateway log, switched off again. The gateway's refusal of web fetch, code execution, remote MCP servers and search without permission is covered by its unit tests.

- block 3, web UI ([tests/ui/ui.mjs](tests/ui/ui.mjs), Playwright in the official image pinned by digest): the owner's whole way through the UI in **Chromium on a desktop (light)** and **WebKit, Safari's engine, on an iPhone viewport (dark)**, in German: new project with idea and file, start, the question in "Braucht dich", option plus note, typed text surviving the refresh, pause, an own answer refused without text, a secret attachment refused with its reason, an attachment answer resuming the interview in a fresh run that reads it, finish, features/briefing/history/run cost, web search on and off, a setting and the language, delete with the typed name (its repository gone from the git server); a hostile `<img onerror>` in agent text shown as text; no console errors, no CSP violations, no horizontal scrolling. Every screen is also captured in Chromium phone light and WebKit desktop dark; the screenshots land in `tests/ui/screenshots/` for the look check. The served UI's CSP and that uploaded files are never served are checked with curl. Answer attachments (incl. taking them back when the answer cannot be saved), resume on answer (incl. an answer that arrives while the run ends), only the current question answerable, no second run while one ends, reconcile after a failed run end (incl. the run record), deletion (races, leftover run containers, foreign repository) and the upgrade of block 2 settings files are unit tests.

No real API key is needed and nothing is billed. With your real key stored (step 3), your first interview in the web UI is the real-model check.
