// Tiny Redis-over-REST client (Upstash / Vercel KV compatible) with an
// in-memory fallback that speaks the same command subset. The fallback only
// works in a single process (local dev); production needs the REST store
// because Vercel serverless instances do not share memory.

export type Cmd = (string | number)[];

const REST_URL = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

export const usingMemoryStore = !(REST_URL && REST_TOKEN);

interface MemEntry {
  value: string | string[];
  expiresAt: number | null;
}

const g = globalThis as unknown as { __memStore?: Map<string, MemEntry> };
const mem = (g.__memStore ??= new Map<string, MemEntry>());

function memGet(key: string): MemEntry | undefined {
  const e = mem.get(key);
  if (e && e.expiresAt !== null && e.expiresAt <= Date.now()) {
    mem.delete(key);
    return undefined;
  }
  return e;
}

function memExec(cmd: Cmd): unknown {
  const op = String(cmd[0]).toUpperCase();
  const key = String(cmd[1]);
  switch (op) {
    case "GET": {
      const e = memGet(key);
      return e && typeof e.value === "string" ? e.value : null;
    }
    case "SET": {
      const value = String(cmd[2]);
      let nx = false;
      let ttl: number | null = null;
      for (let i = 3; i < cmd.length; i++) {
        const o = String(cmd[i]).toUpperCase();
        if (o === "NX") nx = true;
        else if (o === "EX") ttl = Number(cmd[++i]) * 1000;
        else if (o === "PX") ttl = Number(cmd[++i]);
      }
      if (nx && memGet(key)) return null;
      mem.set(key, { value, expiresAt: ttl ? Date.now() + ttl : null });
      return "OK";
    }
    case "DEL":
      return mem.delete(key) ? 1 : 0;
    case "RPUSH": {
      const e = memGet(key);
      const list = e && Array.isArray(e.value) ? e.value : [];
      list.push(String(cmd[2]));
      mem.set(key, { value: list, expiresAt: e?.expiresAt ?? null });
      return list.length;
    }
    case "LPOP": {
      const e = memGet(key);
      if (!e || !Array.isArray(e.value) || e.value.length === 0) return null;
      const count = cmd[2] === undefined ? 1 : Number(cmd[2]);
      const out = e.value.splice(0, count);
      if (e.value.length === 0) mem.delete(key);
      return out;
    }
    case "PFADD": {
      const e = memGet(key);
      const set = e && Array.isArray(e.value) ? e.value : [];
      const before = set.length;
      for (const m of cmd.slice(2)) if (!set.includes(String(m))) set.push(String(m));
      mem.set(key, { value: set, expiresAt: e?.expiresAt ?? null });
      return set.length > before ? 1 : 0;
    }
    case "PFCOUNT": {
      const all = new Set<string>();
      for (const k of cmd.slice(1)) {
        const e = memGet(String(k));
        if (e && Array.isArray(e.value)) e.value.forEach((m) => all.add(m));
      }
      return all.size;
    }
    case "INCR": {
      const e = memGet(key);
      const n = (e && typeof e.value === "string" ? Number(e.value) : 0) + 1;
      mem.set(key, { value: String(n), expiresAt: e?.expiresAt ?? null });
      return n;
    }
    case "EXPIRE": {
      const e = memGet(key);
      if (!e) return 0;
      e.expiresAt = Date.now() + Number(cmd[2]) * 1000;
      return 1;
    }
    default:
      throw new Error(`memory store: unsupported command ${op}`);
  }
}

/** Run commands as one round trip. Results line up with the input order. */
export async function exec(cmds: Cmd[]): Promise<unknown[]> {
  if (usingMemoryStore) return cmds.map(memExec);
  const res = await fetch(`${REST_URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${REST_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmds),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`store error ${res.status}`);
  const rows = (await res.json()) as { result?: unknown; error?: string }[];
  return rows.map((r) => {
    if (r.error) throw new Error(`store: ${r.error}`);
    return r.result;
  });
}

export async function run(cmd: Cmd): Promise<unknown> {
  return (await exec([cmd]))[0];
}
