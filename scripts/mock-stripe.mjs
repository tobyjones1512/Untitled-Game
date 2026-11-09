// Tiny local stand-in for Stripe Identity's verification_sessions API, for tests only.
//   node scripts/mock-stripe.mjs   (port 4010)
// Control: POST /__set/<id> {"status":"verified","dob":{"day":1,"month":1,"year":1990}}
import { createServer } from "node:http";

const sessions = new Map();
let n = 0;
const readBody = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
  if (!url.pathname.startsWith("/__set/") && !(req.headers.authorization ?? "").startsWith("Bearer sk_")) return send(401, { error: { message: "no key" } });

  if (req.method === "POST" && url.pathname === "/v1/identity/verification_sessions") {
    const f = new URLSearchParams(await readBody(req));
    const id = `vs_mock${++n}`;
    const s = {
      id, object: "identity.verification_session", status: "requires_input", url: `http://localhost:4010/hosted/${id}`,
      type: f.get("type"), return_url: f.get("return_url"),
      options: { document: { require_matching_selfie: f.get("options[document][require_matching_selfie]") === "true", require_live_capture: f.get("options[document][require_live_capture]") === "true" } },
      metadata: { nonce: f.get("metadata[nonce]"), purpose: f.get("metadata[purpose]") },
      verified_outputs: null,
    };
    sessions.set(id, s);
    return send(200, s);
  }
  const get = url.pathname.match(/^\/v1\/identity\/verification_sessions\/(vs_\w+)$/);
  if (req.method === "GET" && get) {
    const s = sessions.get(get[1]);
    if (!s) return send(404, { error: { message: "No such session" } });
    const expanded = url.searchParams.getAll("expand[]").includes("verified_outputs");
    return send(200, { ...s, verified_outputs: expanded ? s.verified_outputs : null });
  }
  const set = url.pathname.match(/^\/__set\/(vs_\w+)$/);
  if (req.method === "POST" && set) {
    const s = sessions.get(set[1]);
    const b = JSON.parse((await readBody(req)) || "{}");
    s.status = b.status ?? s.status;
    s.verified_outputs = b.dob ? { dob: b.dob } : s.status === "verified" ? { dob: null } : null;
    return send(200, s);
  }
  send(404, { error: { message: "not found" } });
}).listen(4010, () => console.log("mock stripe on 4010"));
