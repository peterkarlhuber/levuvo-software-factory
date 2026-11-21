// Levuvo SF web UI: the only place that talks to the factory API (same origin, JSON only).
// Errors carry the factory's message; a network failure is marked `offline` so the UI can say the connection is lost.

export async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: method === "GET" ? {} : { "content-type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
      cache: "no-store",
    });
  } catch (e) {
    throw Object.assign(new Error(e.message), { offline: true });
  }
  const type = res.headers.get("content-type") ?? "";
  const data = type.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw Object.assign(new Error(data?.error ?? `HTTP ${res.status}`), { status: res.status });
  return data;
}

export const get = (path) => api("GET", path);
export const post = (path, body) => api("POST", path, body);
export const put = (path, body) => api("PUT", path, body);
export const del = (path, body) => api("DELETE", path, body);

/** A browser File as `{name, content_base64}` for uploads. */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
