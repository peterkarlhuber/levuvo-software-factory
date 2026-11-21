// Levuvo SF run containers through the Docker API (via the docker-socket-proxy, which only the factory can reach).
// The proxy is defense in depth; the real boundary is here: every run container is built from ONE fixed template in
// code (scope review finding 9). Nothing from a request decides the image, mounts, privileges or networks; only the
// run id (validated) and the values checked by settings.mjs vary.
import { request } from "node:http";

export const WORKER_IMAGE = "levuvo-sf/worker:local";
export const LABEL = "dev.levuvo-sf.run";
const RUN_ID = /^run-[a-z0-9]{6,40}$/;

export function createDocker({ host = "docker-proxy", port = 2375 } = {}) {
  function api(method, path, body, { timeout = 30_000, raw = false } = {}) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
      const req = request({ host, port, method, path, agent: false, timeout: timeout || undefined, headers: data ? { "content-type": "application/json", "content-length": data.length } : {} }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c)).on("end", () => {
          const buf = Buffer.concat(chunks);
          if (res.statusCode >= 400) return reject(Object.assign(new Error(`docker ${method} ${path.split("?")[0]}: ${res.statusCode} ${buf.toString().slice(0, 300)}`), { status: res.statusCode }));
          if (raw) return resolve(buf);
          resolve(buf.length ? JSON.parse(buf.toString()) : null);
        });
      });
      req.on("timeout", () => req.destroy(new Error(`docker ${method} timed out`)));
      req.on("error", reject);
      req.end(data);
    });
  }
  /** Waits until the container has exited. A long wait can be cut by the proxy's idle timeout (10 min): then it checks
   * that the container still runs and waits again, so a live run is never ended by a dropped connection. */
  async function wait(id) {
    for (;;) {
      try { return await api("POST", `/containers/${id}/wait`, undefined, { timeout: 0 }); } catch (e) {
        const s = await api("GET", `/containers/${id}/json`).catch((x) => (x.status === 404 ? null : Promise.reject(e)));
        if (!s) throw e;
        if (!s.State?.Running) return { StatusCode: s.State?.ExitCode ?? null };
      }
    }
  }
  return {
    api,
    self: (id) => api("GET", `/containers/${encodeURIComponent(id)}/json`),
    create: (name, spec) => api("POST", `/containers/create?name=${encodeURIComponent(name)}`, spec),
    start: (id) => api("POST", `/containers/${id}/start`),
    wait,
    stop: (id, t = 5) => api("POST", `/containers/${id}/stop?t=${t}`).catch((e) => { if (e.status !== 304 && e.status !== 404) throw e; }),
    remove: (id) => api("DELETE", `/containers/${id}?force=true&v=true`).catch((e) => { if (e.status !== 404) throw e; }),
    logs: async (id) => demux(await api("GET", `/containers/${id}/logs?stdout=true&stderr=true`, undefined, { raw: true })),
    list: (labels) => api("GET", `/containers/json?all=true&filters=${encodeURIComponent(JSON.stringify({ label: labels }))}`),
  };
}

/** Docker's multiplexed log stream (8-byte frame headers) → { stdout, stderr }. */
export function demux(buf) {
  const out = { stdout: [], stderr: [] };
  for (let i = 0; i + 8 <= buf.length; ) {
    const len = buf.readUInt32BE(i + 4);
    (buf[i] === 2 ? out.stderr : out.stdout).push(buf.subarray(i + 8, i + 8 + len));
    i += 8 + len;
  }
  return { stdout: Buffer.concat(out.stdout).toString("utf8"), stderr: Buffer.concat(out.stderr).toString("utf8") };
}

/**
 * The run container (AGENTS.md A2 run profile, PLAYBOOK G7.1–G7.3): worker image, non-root, all capabilities dropped,
 * no-new-privileges, read-only root, tmpfs for home and /tmp, limits, only the network `agents-api` (model gateway, no
 * other host, no CONNECT proxy), no Docker socket, exactly two mounts from the runs volume: the run's `in` folder
 * read-only and its `io` folder (tool requests and answers) writable.
 */
export function runContainerSpec({ runId, project, env }) {
  if (!RUN_ID.test(runId)) throw new Error("invalid run id");
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(project)) throw new Error("invalid compose project");
  const sub = (p, target, ro) => ({ Type: "volume", Source: `${project}_runs`, Target: target, ReadOnly: ro, VolumeOptions: { NoCopy: true, Subpath: `${runId}/${p}` } });
  return {
    Image: WORKER_IMAGE,
    User: "1000:1000",
    Env: env,
    WorkingDir: "/home/node",
    Labels: { [LABEL]: runId, "dev.levuvo-sf.project": project },
    NetworkDisabled: false,
    HostConfig: {
      NetworkMode: `${project}_agents-api`,
      ReadonlyRootfs: true,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges:true"],
      Privileged: false,
      Memory: 1024 * 1024 * 1024,
      NanoCpus: 1_000_000_000,
      PidsLimit: 256,
      Tmpfs: { "/tmp": "rw,nosuid,nodev,size=64m", "/home/node": "rw,nosuid,nodev,size=256m,uid=1000,gid=1000" },
      Mounts: [sub("in", "/run/levuvo/in", true), sub("io", "/run/levuvo/io", false)],
      LogConfig: { Type: "json-file", Config: { "max-size": "20m", "max-file": "1" } },
      AutoRemove: false,
    },
  };
}
