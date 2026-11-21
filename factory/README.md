# Levuvo SF – factory stack

The factory's own containers, defined in [compose.yaml](compose.yaml) (Docker Compose project `levuvo-sf`). The host needs only Docker.

Implemented so far (implementation block 1, the base):

| Service | What it does |
|---|---|
| `git` | Local Forgejo 15 LTS: the factory's git server (WORKFLOW A0). Only on the Mac at http://localhost:3000. Registration off, sign-in required to see anything, every repository private (forced), no migrations, mirrors, Actions or federation. |
| `git-init` | One-shot setup after every start: admin user `levuvo-admin` and private organization `levuvo-sf`. Idempotent; stops with an error instead of guessing (e.g. admin exists but its password file is gone). |
| `egress-model` | Egress proxy, profile `model`: HTTPS only to `api.anthropic.com`. For runs that only talk to the model. |
| `egress-build` | Egress proxy, profile `build`: HTTPS to `api.anthropic.com` and `registry.npmjs.org`. For the (skeleton) builder. |

## Use

From this folder (`factory/`):

```sh
docker compose up -d --build                                       # start (first start pulls and builds, ~1–2 min)
docker compose exec git cat /var/lib/gitea/levuvo/admin-password   # admin password for levuvo-admin
docker compose ps                                                  # git, egress-model, egress-build "Up"; git-init "Exited (0)"
docker compose logs git-init                                       # what the setup did
docker compose stop                                                # stop, data stays
```

Then open http://localhost:3000 and sign in as `levuvo-admin`.

If you change the admin password in the Forgejo UI, the stored file is no longer valid and the next start's setup stops with "admin login failed". Keep the generated password, or write the new one to the file: `docker compose exec git sh -c 'cat > /var/lib/gitea/levuvo/admin-password'` (type it, then Ctrl-D).

Reset the password: `docker compose exec git forgejo admin user change-password --username levuvo-admin --password <new> --must-change-password=false`, then store it in the file as above.

Delete everything including all repositories: `docker compose down -v` (cannot be undone).

## Security model

PLAYBOOK G7.1 and G7.2, checked by the tests:

- Every container runs as a non-root user, with all Linux capabilities dropped, `no-new-privileges`, a read-only root filesystem and memory, CPU and process limits. Data lives only in the named volume `levuvo-sf-git`, temporary files in tmpfs.
- Networks: `levuvo-sf-web` carries only the git server's host port (bound to 127.0.0.1). `levuvo-sf-factory` (internal) is for trusted factory services; agent containers never join it. `levuvo-sf-agents-model` and `levuvo-sf-agents-build` (internal) are where the factory will put agent runs; each has exactly one way out, its egress proxy (`http://egress-model:3128` or `http://egress-build:3128`). Only the proxies are on `levuvo-sf-internet`.
- The proxies pass only HTTPS `CONNECT` to the exact host and port of their profile's allowlist ([egress-proxy/allowlist-model.txt](egress-proxy/allowlist-model.txt), [egress-proxy/allowlist-build.txt](egress-proxy/allowlist-build.txt)). After DNS they refuse private and reserved addresses and connect to the checked address. Plain HTTP is refused. Every decision is one JSON line in the proxy log (`docker compose logs egress-model`). The lists are baked into the image: changing them is a reviewed PR, never a runtime switch.
- The admin password is generated on the first start, stored only in the git volume (mode 0600), never printed or logged. No secret is in the repository.
- The git server sits on a non-internal network (Docker needs that to publish a port), so it could reach the internet; everything in it that would call out (migrations, mirrors, webhooks, update check, federation) is switched off.

## Not yet here

- *Block 2:* the factory API and the first isolated agent run; the model path of the proxy that adds the API key and records token usage in API billing mode (PLAYBOOK G7.4, G12.1). The CONNECT path stays as it is, also for subscription mode.
- *Block 3:* the web UI. *Block 4:* Forgejo CI runner and gates.
- *Later:* Tailscale/iPhone access, GitHub archive mirror.

## Tests

`factory/tests/run.sh` (from the repo root; needs only Docker): the proxy unit tests (`docker build --target test factory/egress-proxy`), then the whole stack: Forgejo setup and settings, anonymous access, forced private repos, password never logged, hardening of every container, network isolation of both agent networks (allowed and refused hosts, no direct internet or DNS, git server and the other proxy invisible), restart keeps data and password, setup fails closed. It removes the `levuvo-sf` project and its volumes at the end, so it refuses to run where that project already exists.
