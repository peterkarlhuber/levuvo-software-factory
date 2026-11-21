import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { request } from "node:http";
import { connect, createServer } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { test } from "node:test";
import { createProxy, isAllowed, isPrivateAddress, parseAllowlist, readSni } from "./proxy.mjs";

test("allowlist parsing and exact matching", () => {
  const rules = parseAllowlist("# comment\napi.anthropic.com\nlocal.test:8443 # note\n\n");
  assert.equal(rules.length, 2);
  assert.ok(isAllowed(rules, "api.anthropic.com", 443));
  assert.ok(isAllowed(rules, "API.Anthropic.com.", 443));
  assert.ok(!isAllowed(rules, "api.anthropic.com", 80));
  assert.ok(!isAllowed(rules, "evil-api.anthropic.com", 443));
  assert.ok(!isAllowed(rules, "x.api.anthropic.com", 443));
  assert.ok(!isAllowed(rules, "api.anthropic.com.evil.net", 443));
  assert.ok(isAllowed(rules, "local.test", 8443));
  assert.ok(!isAllowed(rules, "local.test", 443));
});

test("an invalid allowlist entry fails closed instead of being skipped", () => {
  for (const bad of ["*.example.org", "weird host", "localhost", "http://x.org", "x.org:port"]) {
    assert.throws(() => parseAllowlist(bad), /invalid allowlist entry/, bad);
  }
});

test("the shipped profiles allow exactly what the roles need", () => {
  const read = (p) => parseAllowlist(readFileSync(new URL(`./allowlist-${p}.txt`, import.meta.url), "utf8"));
  assert.deepEqual(read("model"), [{ host: "api.anthropic.com", port: 443 }]);
  assert.deepEqual(read("build"), [{ host: "api.anthropic.com", port: 443 }, { host: "registry.npmjs.org", port: 443 }]);
});

test("every non-public address is refused, however it is written", () => {
  for (const ip of ["10.1.2.3", "127.0.0.1", "172.20.0.5", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::",
    "fd00::1", "fe80::1", "fe80::1%eth0", "fec0::1", "::ffff:10.0.0.1", "::ffff:7f00:1", "::FFFF:127.0.0.1", "[::1]", "198.18.0.1",
    "192.0.2.1", "203.0.113.9", "240.0.0.1", "255.255.255.255", "224.0.0.1", "64:ff9b::a00:1", "2002:7f00:1::1", "2001:db8::1",
    "3fff::1", "ff02::1", "not-an-ip", ""]) assert.ok(isPrivateAddress(ip), ip);
  for (const ip of ["1.1.1.1", "8.8.8.8", "160.79.104.10", "100.128.0.1", "172.32.0.1", "2606:4700::1111", "2a00:1450:4001::200e"]) {
    assert.ok(!isPrivateAddress(ip), ip);
  }
});

// --- the proxy server, with a local upstream and the DNS / private-address seams ---

async function withProxy(opts, fn) {
  const received = []; // what the upstream got through the tunnel
  const upstream = createServer((s) => s.on("data", (d) => received.push(d)));
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  const records = [];
  const proxy = createProxy({
    rules: parseAllowlist(`allowed.test:${upstream.address().port}\nprivate.test:${upstream.address().port}\nnodns.test:443`),
    profile: "test",
    resolve: async (host) => {
      if (host === "nodns.test") throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
      return { address: host === "private.test" ? "10.0.0.1" : "127.0.0.1" };
    },
    isPrivate: (ip) => ip !== "127.0.0.1" && isPrivateAddress(ip), // the local upstream counts as public here
    record: (e) => records.push(e),
    helloTimeoutMs: 500,
    ...opts,
  });
  await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
  try {
    await fn({ proxyPort: proxy.address().port, upstreamPort: upstream.address().port, records, received });
  } finally {
    proxy.close();
    upstream.close();
  }
}

/** Sends a raw CONNECT; resolves with the status code and, on 200, the open socket. */
function connectVia(proxyPort, target) {
  return new Promise((resolve, reject) => {
    const s = connect(proxyPort, "127.0.0.1", () => s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    s.once("data", (d) => {
      const code = Number(/^HTTP\/1\.1 (\d{3})/.exec(String(d))?.[1]);
      if (code !== 200) s.destroy();
      resolve({ code, socket: s });
    });
    s.on("error", reject);
  });
}
const tunnel = async (port, target) => { const r = await connectVia(port, target); r.socket.destroy(); return { code: r.code }; };

/** Opens a tunnel and sends `payload` (or a real TLS ClientHello for `sni`); resolves "closed" or "forwarded". */
async function sendThrough(proxyPort, target, { sni, payload, received }) {
  const { code, socket } = await connectVia(proxyPort, target);
  assert.equal(code, 200);
  return new Promise((resolve) => {
    const check = setInterval(() => { if (received.length) { clearInterval(check); socket.destroy(); resolve("forwarded"); } }, 10);
    socket.on("close", () => { clearInterval(check); setTimeout(() => resolve(received.length ? "forwarded" : "closed"), 20); });
    if (payload !== undefined) socket.write(payload);
    else tlsConnect({ socket, servername: sni, rejectUnauthorized: false }).on("error", () => {});
  });
}

test("an allowed host with the same TLS name gets a working tunnel, the ClientHello is forwarded and logged", async () => {
  await withProxy({}, async ({ proxyPort, upstreamPort, records, received }) => {
    assert.equal(await sendThrough(proxyPort, `allowed.test:${upstreamPort}`, { sni: "allowed.test", received }), "forwarded");
    assert.equal(readSni(Buffer.concat(received)), "allowed.test");
    assert.equal(records.at(-1).action, "allowed");
  });
});

test("a different, missing or non-TLS first message closes the tunnel before anything reaches the upstream", async () => {
  for (const [opts, reason] of [
    [{ sni: "evil.example" }, /TLS name evil.example does not match allowed.test/],
    [{ payload: Buffer.from("GET / HTTP/1.1\r\nHost: evil.example\r\n\r\n") }, /no TLS ClientHello/],
    [{ payload: Buffer.from([0x16, 0x03, 0x01, 0x00]) }, /no TLS ClientHello/], // incomplete, runs into the timeout
  ]) {
    await withProxy({}, async ({ proxyPort, upstreamPort, records, received }) => {
      assert.equal(await sendThrough(proxyPort, `allowed.test:${upstreamPort}`, { ...opts, received }), "closed");
      assert.equal(received.length, 0);
      assert.match(records.at(-1).reason, reason);
    });
  }
});

test("readSni reads exactly one host name and rejects anything else", () => {
  assert.equal(readSni(Buffer.alloc(0)), null);
  assert.equal(readSni(Buffer.from("hello world")), null);
  assert.equal(readSni(Buffer.from([0x16, 3, 1, 0, 200, 1])), null); // truncated record
});

test("hosts and ports off the list are refused with 403", async () => {
  await withProxy({}, async ({ proxyPort, upstreamPort, records }) => {
    assert.equal((await tunnel(proxyPort, "example.com:443")).code, 403);
    assert.equal((await tunnel(proxyPort, "allowed.test:443")).code, 403);
    assert.equal((await tunnel(proxyPort, `127.0.0.1:${upstreamPort}`)).code, 403);
    assert.ok(records.every((r) => r.action === "blocked" && r.reason === "not on allowlist"));
  });
});

test("an allowed name that resolves to a private address is refused", async () => {
  await withProxy({}, async ({ proxyPort, upstreamPort, records }) => {
    assert.equal((await tunnel(proxyPort, `private.test:${upstreamPort}`)).code, 403);
    assert.match(records.at(-1).reason, /private or reserved/);
  });
});

test("a DNS failure answers 502 and is logged", async () => {
  await withProxy({}, async ({ proxyPort, records }) => {
    assert.equal((await tunnel(proxyPort, "nodns.test:443")).code, 502);
    assert.match(records.at(-1).reason, /dns failed: ENOTFOUND/);
  });
});

test("malformed CONNECT targets and plain HTTP are refused", async () => {
  await withProxy({}, async ({ proxyPort }) => {
    assert.equal((await tunnel(proxyPort, "[::1]:443")).code, 400);
    assert.equal((await tunnel(proxyPort, "allowed.test")).code, 400);
    const plain = await new Promise((resolve) => {
      request({ host: "127.0.0.1", port: proxyPort, path: "http://allowed.test/", method: "GET" }, (res) => { res.resume(); resolve(res.statusCode); })
        .on("error", (e) => resolve(e.code)).end();
    });
    assert.equal(plain, 403);
  });
});
