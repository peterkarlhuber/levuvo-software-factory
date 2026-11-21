// Levuvo SF project repositories on the local Forgejo (WORKFLOW A0, GA0.1, GA0.2). The factory uses its own account
// `levuvo-factory` (created by git-init, member of the organization's owners; its token lives only in the factory's
// volume). Creating a project creates a private repository in the organization `levuvo-sf` with a generated README
// and protects `main` before anything else happens: only the factory account may push to it, no force pushes, and no
// one may delete it.
import { readFileSync } from "node:fs";
import { request } from "node:http";

export const ORG = "levuvo-sf";
export const BOT = "levuvo-factory";

export function createForgejo({ base = "http://git:3000/api/v1", tokenFile = "/run/levuvo/git/token" } = {}) {
  const u = new URL(base);
  function api(method, path, body) {
    let token;
    try { token = readFileSync(tokenFile, "utf8").trim(); } catch { token = ""; }
    if (!token) return Promise.reject(Object.assign(new Error("the factory's Forgejo token is missing (git-init has not run)"), { status: 503 }));
    return new Promise((resolve, reject) => {
      const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
      const req = request({ host: u.hostname, port: u.port || 80, method, path: `${u.pathname}${path}`, timeout: 30_000,
        headers: { authorization: `token ${token}`, accept: "application/json", ...(data ? { "content-type": "application/json", "content-length": data.length } : {}) } }, (res) => {
        let b = "";
        res.on("data", (c) => (b += c)).on("end", () => {
          let j = null;
          try { j = b ? JSON.parse(b) : null; } catch { /* not JSON */ }
          if (res.statusCode >= 400) return reject(Object.assign(new Error(`git server: ${res.statusCode} ${(j?.message ?? b).slice(0, 200)}`), { status: res.statusCode }));
          resolve(j);
        });
      });
      req.on("timeout", () => req.destroy(new Error("git server timed out")));
      req.on("error", reject);
      req.end(data);
    });
  }

  async function createProjectRepo(slug, description) {
    let created;
    try {
      created = await api("POST", `/orgs/${ORG}/repos`, { name: slug, description, private: true, auto_init: true, readme: "Default", default_branch: "main" });
    } catch (e) {
      if (e.status === 409) throw Object.assign(new Error(`a project named ${slug} already exists`), { status: 409 });
      throw e;
    }
    try {
      await api("POST", `/repos/${ORG}/${slug}/branch_protections`, {
        rule_name: "main", enable_push: true, enable_push_whitelist: true, push_whitelist_usernames: [BOT],
        enable_merge_whitelist: true, merge_whitelist_usernames: [BOT], block_on_outdated_branch: true,
      });
    } catch (e) {
      await api("DELETE", `/repos/${ORG}/${slug}`).catch(() => {}); // never leave an unprotected repository behind
      throw e;
    }
    return { org: ORG, name: slug, id: created?.id, web_url: `http://localhost:${process.env.LEVUVO_SF_GIT_PORT ?? 3000}/${ORG}/${slug}` };
  }

  return { api, createProjectRepo };
}
