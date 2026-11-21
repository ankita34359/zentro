// Fails when any installed package's own engines.node excludes Node 20.20.2.
// Run before the build (npm run build calls it) and in CI under a real Node 20.
import fs from "node:fs";

const RUNTIME = [20, 20, 2];

const cmp = (a, b) => { for (let i = 0; i < 3; i++) { if ((a[i] ?? 0) !== (b[i] ?? 0)) return a[i] - b[i]; } return 0; };
const parse = (s) => { const m = /^v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/.exec(s.trim()); if (!m) return null; return [Number(m[1]), m[2] && /\d/.test(m[2]) ? Number(m[2]) : 0, m[3] && /\d/.test(m[3]) ? Number(m[3]) : 0]; };

/** Does one comparator (e.g. ">=22", "^20.19.0", "20 || 22") accept RUNTIME? Only the shapes npm packages use. */
function comparatorOk(c) {
  c = c.trim().replace(/(>=|<=|>|<|=|\^|~)\s+/g, "$1");
  if (c === "" || c === "*" || c === "x") return true;
  const parts = c.split(/\s+/).filter(Boolean);
  // hyphen range "a - b"
  if (parts.length === 3 && parts[1] === "-") { const lo = parse(parts[0]), hi = parse(parts[2]); return cmp(RUNTIME, lo) >= 0 && cmp(RUNTIME, hi) <= 0; }
  return parts.every((p) => {
    const m = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(p);
    const op = m[1] || "=", v = parse(m[2]);
    if (!v) return true;
    switch (op) {
      case ">=": return cmp(RUNTIME, v) >= 0;
      case ">": return cmp(RUNTIME, v) > 0;
      case "<=": return cmp(RUNTIME, v) <= 0;
      case "<": return cmp(RUNTIME, v) < 0;
      case "^": return cmp(RUNTIME, v) >= 0 && RUNTIME[0] === v[0];
      case "~": return cmp(RUNTIME, v) >= 0 && RUNTIME[0] === v[0] && RUNTIME[1] === v[1];
      default: { const given = m[2].replace(/^v/, "").split(".").filter((x) => /^\d+$/.test(x)); return given.every((x, i) => Number(x) === RUNTIME[i]); }
    }
  });
}
const rangeOk = (r) => r.split("||").some(comparatorOk);

const lock = JSON.parse(fs.readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const bad = [];
for (const [name, info] of Object.entries(lock.packages ?? {})) {
  const range = info?.engines?.node;
  if (name && range && !rangeOk(range)) bad.push(`${name} ${info.version ?? ""} needs node ${range}`);
}
if (bad.length) {
  console.error(`check-node20: ${bad.length} package(s) do not accept Node ${RUNTIME.join(".")}:`);
  for (const b of bad) console.error("  - " + b);
  process.exit(1);
}
console.log(`check-node20: all ${Object.keys(lock.packages ?? {}).length - 1} locked packages accept Node ${RUNTIME.join(".")}`);
