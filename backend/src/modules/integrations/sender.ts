import dns from "node:dns/promises";
import net from "node:net";

export interface SendRequest { url: string; headers: Record<string, string>; body: string; timeoutMs: number }
export interface SendResult { status: number }
/** How a webhook leaves the server. Tests give the service a fake one; production uses `FetchSender`. */
export interface WebhookSender { send(req: SendRequest): Promise<SendResult> }

/** A failure with a short, fixed word (never a response body or an address): "timeout", "network", "blocked_address". */
export class SendError extends Error {
  constructor(readonly code: "timeout" | "network" | "blocked_address") { super(code); }
}

/** True for an address that is not a public one (loopback, private ranges, link-local including cloud metadata, carrier-grade NAT, multicast, unspecified). */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff");
  }
  return true; // not an address at all: refuse
}

/** What an administrator may save: a plain https address with a host name, no sign-in details in it, and not an address of this machine or a private network. */
export function validateWebhookUrl(raw: string, allowPrivate = false): { ok: true; url: URL } | { ok: false; reason: string } {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return { ok: false, reason: "That is not a valid address. It should look like https://hooks.example.com/path." }; }
  // plain http is accepted only where private addresses are (a developer's own machine); a real server accepts https only
  if (u.protocol !== "https:" && !(allowPrivate && u.protocol === "http:")) return { ok: false, reason: "The address must start with https://." };
  if (u.username || u.password) return { ok: false, reason: "The address must not contain a user name or password." };
  if (u.hash) return { ok: false, reason: "The address must not contain a # part." };
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!allowPrivate) {
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".") && !net.isIP(host)) return { ok: false, reason: "The address must be a public one, not this machine or a private network." };
    if (net.isIP(host) && isPrivateAddress(host)) return { ok: false, reason: "The address must be a public one, not this machine or a private network." };
  }
  return { ok: true, url: u };
}

/** The real sender: refuses private destinations (checked again when the name is looked up), follows no redirects, waits at most `timeoutMs`, and reads nothing of the reply but its status. */
export class FetchSender implements WebhookSender {
  constructor(private readonly allowPrivate = false, private readonly lookup: (host: string) => Promise<string[]> = async (h) => (await dns.lookup(h, { all: true })).map((a) => a.address)) {}
  async send(req: SendRequest): Promise<SendResult> {
    const u = new URL(req.url);
    const host = u.hostname.replace(/^\[|\]$/g, "");
    if (!this.allowPrivate) {
      let addrs: string[];
      try { addrs = net.isIP(host) ? [host] : await this.lookup(host); } catch { throw new SendError("network"); }
      if (addrs.length === 0 || addrs.some(isPrivateAddress)) throw new SendError("blocked_address");
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), req.timeoutMs);
    try {
      const res = await fetch(req.url, { method: "POST", headers: req.headers, body: req.body, redirect: "manual", signal: ctl.signal });
      void res.body?.cancel().catch(() => undefined);
      return { status: res.status };
    } catch (e) {
      throw new SendError((e as { name?: string })?.name === "AbortError" ? "timeout" : "network");
    } finally {
      clearTimeout(timer);
    }
  }
}
