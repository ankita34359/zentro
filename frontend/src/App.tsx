import { useEffect, useRef, useState } from "react";

interface Spike {
  app: string;
  version: string;
  node: string;
  dbPath: string;
  visits: number;
  ticks: number;
  lastTickAt: string | null;
  serverTime: string;
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return (await res.json()) as T;
}

export function App() {
  const [data, setData] = useState<Spike | null>(null);
  const [error, setError] = useState<string | null>(null);
  const counted = useRef(false);

  async function load() {
    try {
      setData(await getJson<Spike>("/api/spike"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    // Count this page view once, then read the numbers (so the counter includes this visit).
    if (counted.current) return;
    counted.current = true;
    getJson("/api/spike/visit", { method: "POST" })
      .catch(() => undefined)
      .then(load);
  }, []);

  const isNode20 = data?.node.startsWith("20.") ?? false;

  return (
    <main>
      <h1>Zentro</h1>
      <p className="sub">Stage 1.1: deploy spike. Nothing here is real data yet; it only proves the platform works.</p>
      {error && <p className="bad">Could not load: {error}</p>}
      {!data && !error && <p>Loading…</p>}
      {data && (
        <>
          <table>
            <tbody>
              <tr><th>App</th><td data-testid="app">{data.app}</td></tr>
              <tr><th>App version</th><td data-testid="version">{data.version}</td></tr>
              <tr>
                <th>Node version</th>
                <td data-testid="node">
                  {data.node} <span className={isNode20 ? "ok" : "bad"}>{isNode20 ? "OK (20.x)" : "expected 20.x"}</span>
                </td>
              </tr>
              <tr><th>Database path</th><td data-testid="dbpath"><code>{data.dbPath}</code></td></tr>
              <tr><th>Visit counter</th><td data-testid="visits"><strong>{data.visits}</strong></td></tr>
              <tr>
                <th>Scheduled ticks</th>
                <td data-testid="ticks">
                  {data.ticks}
                  {data.lastTickAt ? ` (last: ${new Date(data.lastTickAt).toLocaleString()})` : " (none yet)"}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="sub">
            Reload the page: the visit counter goes up by one. Redeploy and reload: it keeps counting from where it was.
          </p>
          <p><a href="/healthz">/healthz</a></p>
        </>
      )}
    </main>
  );
}
