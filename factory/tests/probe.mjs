// Network probe for the integration test, run inside a hardened container on an agent network.
//   node probe.mjs connect <proxy-host> <host:port>   -> the proxy's HTTP status for a CONNECT
//   node probe.mjs direct <host> <port>                -> "connected" or the error code (no proxy)
//   node probe.mjs dns <name>                          -> the address or the error code
import { lookup } from "node:dns/promises";
import { connect } from "node:net";

const [cmd, a, b] = process.argv.slice(2);
const done = (v) => { console.log(v); process.exit(0); };
setTimeout(() => done("TIMEOUT"), 8000);

if (cmd === "connect") {
  const s = connect(3128, a, () => s.write(`CONNECT ${b} HTTP/1.1\r\nHost: ${b}\r\n\r\n`));
  s.on("data", (d) => done(/^HTTP\/1\.1 (\d{3})/.exec(String(d))?.[1] ?? "BAD"));
  s.on("error", (e) => done(e.code));
} else if (cmd === "direct") {
  const s = connect(Number(b), a, () => done("connected"));
  s.on("error", (e) => done(e.code));
} else if (cmd === "dns") {
  lookup(a).then((r) => done(r.address), (e) => done(e.code));
} else {
  done("usage");
}
