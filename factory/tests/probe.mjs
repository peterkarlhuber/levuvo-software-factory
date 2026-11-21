// Network probe for the integration test, run inside a hardened container on an agent network.
//   node probe.mjs connect <proxy-host[:port]> <host:port>  -> the proxy's HTTP status for a CONNECT (port 3128 by default),
//                                                         "closed" if the server drops it without an answer
//   node probe.mjs direct <host> <port>                -> "connected" or the error code (no proxy)
//   node probe.mjs tls <proxy-host> <host:port> <sni>  -> "handshake" if TLS with that name completes through the
//                                                         tunnel (certificate not checked), else "closed" or the error
//   node probe.mjs dns <name>                          -> the address or the error code
import { lookup } from "node:dns/promises";
import { connect } from "node:net";
import { connect as tlsConnect } from "node:tls";

const [cmd, a, b] = process.argv.slice(2);
const done = (v) => { console.log(v); process.exit(0); };
setTimeout(() => done("TIMEOUT"), 8000);

if (cmd === "connect") {
  const [host, port = "3128"] = a.split(":");
  const s = connect(Number(port), host, () => s.write(`CONNECT ${b} HTTP/1.1\r\nHost: ${b}\r\n\r\n`));
  s.on("data", (d) => done(/^HTTP\/1\.1 (\d{3})/.exec(String(d))?.[1] ?? "BAD"));
  s.on("close", () => done("closed"));
  s.on("error", (e) => done(e.code));
} else if (cmd === "tls") {
  const s = connect(3128, a, () => s.write(`CONNECT ${b} HTTP/1.1\r\nHost: ${b}\r\n\r\n`));
  s.once("data", (d) => {
    if (!String(d).startsWith("HTTP/1.1 200")) return done(String(d).slice(9, 12));
    const t = tlsConnect({ socket: s, servername: process.argv[5], rejectUnauthorized: false }, () => done("handshake"));
    t.on("error", (e) => done(e.code === "ECONNRESET" ? "closed" : e.code));
    t.on("close", () => done("closed"));
  });
  s.on("error", (e) => done(e.code));
} else if (cmd === "direct") {
  const s = connect(Number(b), a, () => done("connected"));
  s.on("error", (e) => done(e.code));
} else if (cmd === "dns") {
  lookup(a).then((r) => done(r.address), (e) => done(e.code));
} else {
  done("usage");
}
