#!/usr/bin/env node
// Levuvo SF egress proxy: the only way out of the internet for agent containers (PLAYBOOK G7.2).
// HTTPS CONNECT only, to hosts on the allowlist of this instance's profile; after DNS, private and reserved
// addresses are refused; the client's TLS ClientHello must name the same host (SNI), then the tunnel goes to the
// checked address. Every decision is one JSON line on stdout.
// Remaining limit: the HTTP Host header inside TLS is encrypted and cannot be checked here (domain fronting on a
// shared CDN address); the model path of block 2 terminates TLS itself.
// No admin API, no per-run grants, no plain HTTP: a run's network rights come from the agent network the factory
// puts it on (one proxy instance per profile). Based on the legacy factory proxy, cut down to these checks.
import { lookup } from "node:dns/promises";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { BlockList, connect, isIP } from "node:net";
import { pathToFileURL } from "node:url";

export function parseAllowlist(text) {
  return text
    .split("\n")
    .map((l) => l.replace(/#.*/, "").trim().toLowerCase())
    .filter(Boolean)
    .map((l) => {
      const m = /^([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::(\d+))?$/.exec(l);
      if (!m) throw new Error(`invalid allowlist entry: ${l}`);
      return { host: m[1], port: m[2] ? Number(m[2]) : 443 };
    });
}

/** Exact host and port match; no wildcards. A trailing dot and letter case are ignored. */
export function isAllowed(list, host, port) {
  const h = String(host).toLowerCase().replace(/\.$/, "");
  return list.some((r) => r.port === port && r.host === h);
}

// Every range that is not the public internet, also IPv6 forms that embed an IPv4 address.
const NOT_PUBLIC = { 4: new BlockList(), 6: new BlockList() };
for (const [net, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]]) NOT_PUBLIC[4].addSubnet(net, bits, "ipv4");
for (const [net, bits] of [["::", 96], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 23],
  ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20], ["5f00::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8]]) NOT_PUBLIC[6].addSubnet(net, bits, "ipv6");

export function isPrivateAddress(ip) {
  const v = String(ip).toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const family = isIP(v);
  if (!family) return true; // anything that is not a plain address is refused rather than guessed at
  return NOT_PUBLIC[family].check(v, family === 4 ? "ipv4" : "ipv6");
}

/**
 * The server name (SNI) of a TLS ClientHello, or null unless `buf` starts with one complete, well-formed ClientHello
 * that fills its TLS record exactly and carries exactly one host name. Every declared length must match the
 * structure it encloses; anything inconsistent is refused. Real clients send the whole ClientHello in one record.
 */
export function readSni(buf) {
  try {
    if (buf.length < 9 || buf[0] !== 0x16) return null;
    const end = 5 + buf.readUInt16BE(3); // TLS record
    if (buf.length !== end || buf[5] !== 0x01) return null; // nothing may follow the ClientHello before the reply
    if (9 + buf.readUIntBE(6, 3) !== end) return null; // handshake length fills the record exactly
    let i = 9 + 2 + 32; // client version, random
    const skip = (lenBytes) => { // skips a length-prefixed vector, refusing one that overruns the record
      const len = lenBytes === 1 ? buf[i] : buf.readUInt16BE(i);
      if (i + lenBytes + len > end) throw new Error("overrun");
      i += lenBytes + len;
    };
    skip(1); // session id
    skip(2); // cipher suites
    skip(1); // compression methods
    if (i + 2 + buf.readUInt16BE(i) !== end) return null; // extensions fill the rest exactly
    const names = [];
    for (i += 2; i < end; ) {
      if (i + 4 > end) return null;
      const type = buf.readUInt16BE(i);
      const len = buf.readUInt16BE(i + 2);
      const extEnd = i + 4 + len;
      if (extEnd > end) return null;
      if (type === 0) {
        if (len < 2 || buf.readUInt16BE(i + 4) !== len - 2) return null; // server name list fills the extension
        for (let j = i + 6; j < extEnd; ) {
          if (j + 3 > extEnd) return null;
          const nlen = buf.readUInt16BE(j + 1);
          if (j + 3 + nlen > extEnd) return null;
          if (buf[j] === 0) names.push(buf.toString("latin1", j + 3, j + 3 + nlen));
          j += 3 + nlen;
        }
      }
      i = extEnd;
    }
    if (names.length !== 1 || !/^[a-z0-9.-]{1,253}$/i.test(names[0])) return null;
    return names[0].toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}

/** Collects the first TLS record from the client (at most 16 KiB + header, at most `ms`), then calls back once. */
function firstRecord(socket, ms, cb) {
  let buf = Buffer.alloc(0);
  let finished = false;
  const finish = (b) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    socket.removeListener("data", onData);
    socket.pause();
    cb(b);
  };
  const onData = (d) => {
    buf = Buffer.concat([buf, d]);
    if (buf.length >= 5 && (buf[0] !== 0x16 || buf.length >= 5 + buf.readUInt16BE(3))) finish(buf);
    else if (buf.length > 16384 + 5) finish(buf);
  };
  const timer = setTimeout(() => finish(buf), ms);
  socket.on("data", onData);
  socket.on("end", () => finish(buf));
}

function log(entry) {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

function refuse(socket, code, text) {
  socket.end(`HTTP/1.1 ${code} ${text}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n${text} by Levuvo SF egress policy\n`);
}

/** `resolve` and `isPrivate` are seams for the tests; the program always uses the real ones. */
export function createProxy({ rules, profile = "", resolve = lookup, isPrivate = isPrivateAddress, record = log, helloTimeoutMs = 10_000 }) {
  // plain HTTP requests (no CONNECT) are always refused
  const proxy = createServer((req, res) => {
    record({ profile, action: "blocked", client: req.socket.remoteAddress, reason: `plain http ${req.method} not allowed` });
    res.writeHead(403, { "content-type": "text/plain" }).end("Forbidden by Levuvo SF egress policy\n");
  });

  proxy.on("connect", async (req, socket, head) => {
    const client = socket.remoteAddress;
    socket.on("error", () => socket.destroy());
    // bytes sent before the proxy's answer (pipelined after CONNECT) are not supported: refuse instead of guessing
    if (head?.length) {
      record({ profile, action: "blocked", client, reason: "data sent before the CONNECT answer" });
      return refuse(socket, 400, "Bad Request");
    }
    const m = /^([^:\s]+):(\d{1,5})$/.exec(req.url ?? "");
    if (!m) {
      record({ profile, action: "blocked", client, reason: "bad CONNECT target" });
      return refuse(socket, 400, "Bad Request");
    }
    const host = m[1];
    const port = Number(m[2]);
    if (!isAllowed(rules, host, port)) {
      record({ profile, action: "blocked", host, port, client, reason: "not on allowlist" });
      return refuse(socket, 403, "Forbidden");
    }
    let address;
    try {
      ({ address } = await resolve(host));
    } catch (e) {
      record({ profile, action: "blocked", host, port, client, reason: `dns failed: ${e.code ?? e.message}` });
      return refuse(socket, 502, "Bad Gateway");
    }
    if (isPrivate(address)) {
      record({ profile, action: "blocked", host, port, client, address, reason: "resolves to a private or reserved address" });
      return refuse(socket, 403, "Forbidden");
    }
    // the tunnel opens only after the client's TLS ClientHello names the same host
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    firstRecord(socket, helloTimeoutMs, (hello) => {
      const sni = readSni(hello);
      const name = host.toLowerCase().replace(/\.$/, "");
      if (sni !== name) {
        record({ profile, action: "blocked", host, port, client, address,
          reason: sni ? `TLS name ${sni} does not match ${name}` : "no TLS ClientHello with exactly one server name" });
        return socket.destroy();
      }
      // connect to the checked address, never resolve the name a second time
      const upstream = connect(port, address, () => {
        record({ profile, action: "allowed", host, port, client, address });
        upstream.write(hello);
        upstream.pipe(socket);
        socket.pipe(upstream);
        socket.resume();
      });
      upstream.setTimeout(30 * 60_000, () => upstream.destroy());
      upstream.on("error", (e) => {
        record({ profile, action: "error", host, port, client, reason: e.code ?? e.message });
        socket.destroy();
      });
      socket.on("close", () => upstream.destroy());
    });
  });
  proxy.on("clientError", (_e, socket) => socket.destroy());
  return proxy;
}

function main() {
  const profile = process.env.EGRESS_PROFILE ?? "";
  if (!/^[a-z]+$/.test(profile)) throw new Error("EGRESS_PROFILE must be set (e.g. model or build)");
  const file = `/etc/levuvo/allowlist-${profile}.txt`;
  // fail closed: an unreadable or invalid list stops the proxy, so nothing gets out
  const rules = parseAllowlist(readFileSync(file, "utf8"));
  // no global error handler on purpose: an unexpected error ends the process and Docker restarts it (fail closed)
  const port = Number(process.env.PROXY_PORT || 3128);
  createProxy({ rules, profile }).listen(port, () =>
    log({ profile, action: "config", reason: `listening on ${port}, allowlist ${rules.map((r) => `${r.host}:${r.port}`).join(", ")}` }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
