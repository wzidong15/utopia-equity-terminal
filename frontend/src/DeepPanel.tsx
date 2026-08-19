import type { DeepAnalysis } from "./deep";

function money(n?: number | null) {
  if (n == null || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}
function num(n?: number | null, d = 2) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: d });
}
function actionClass(action: string) {
  if (action === "ACCUMULATE" || action === "LEAN LONG") return "badge buy";
  if (action === "REDUCE" || action === "AVOID") return "badge sell";
  return "badge neutral";
}
function scoreTone(action: string) {
  if (action === "ACCUMULATE" || action === "LEAN LONG") return "buy";
  if (action === "REDUCE" || action === "AVOID") return "sell";
  return "neutral";
}

export default function DeepPanel({
  data,
  loading,
  error,
}: {
  data: DeepAnalysis | null;
  loading: boolean;
  error?: string | null;
}) {
  if (loading) {
    return (
      <section className="deep" id="deep-analysis">
        <div className="section-h">Deep analysis</div>
        <div className="summary">Loading insider, options, Congress, news, and forecast…</div>
      </section>
    );
  }
  if (error) {
    return (
      <section className="deep" id="deep-analysis">
        <div className="section-h">Deep analysis</div>
        <div className="err">{error}</div>
      </section>
    );
  }
  if (!data) return null;
  const s = data.suggestion;
  return (
    <section className="deep" id="deep-analysis">
      <div className="section-h">Deep analysis · {data.symbol}</div>
      <div className="decision">
        <div>
          <div className="k">Investment suggestion</div>
          <div className="decision-row">
            <span className={actionClass(s.action)}>{s.action}</span>
            <span className="px">score {s.score}/100</span>
          </div>
          <div className="score-track" aria-hidden>
            <div className={`score-fill ${scoreTone(s.action)}`} style={{ width: `${s.score}%` }} />
          </div>
        </div>
        <ul>
          {s.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <div className="muted">{s.disclaimer}</div>
      </div>

      <div className="deep-grid">
        <article>
          <div className="section-h">
            Forecast
            <span className="muted">
              {data.forecast.recommendation || "—"}
              {data.forecast.analysts ? ` · ${data.forecast.analysts} analysts` : ""}
            </span>
          </div>
          <div className="stats" style={{ gridTemplateColumns: "1fr 1fr 1fr", padding: "0 12px 8px" }}>
            <div className="stat">
              <div className="k">Mean target</div>
              <div className="v">{num(data.forecast.target_mean)}</div>
            </div>
            <div className="stat">
              <div className="k">Range</div>
              <div className="v">
                {num(data.forecast.target_low)}–{num(data.forecast.target_high)}
              </div>
            </div>
            <div className="stat">
              <div className="k">Implied upside</div>
              <div className={`v ${(data.forecast.upside_pct ?? 0) >= 0 ? "up" : "down"}`}>
                {data.forecast.upside_pct == null ? "—" : `${data.forecast.upside_pct.toFixed(1)}%`}
              </div>
            </div>
          </div>
        </article>

        <article>
          <div className="section-h">
            Option movement
            <span className="muted">
              next 3 expiries · P/C {data.options.put_call == null ? "—" : data.options.put_call.toFixed(2)}
            </span>
          </div>
          <div className="stats" style={{ gridTemplateColumns: "1fr 1fr", padding: "0 12px 8px" }}>
            <div className="stat">
              <div className="k">Call volume</div>
              <div className="v up">{num(data.options.call_volume, 0)}</div>
            </div>
            <div className="stat">
              <div className="k">Put volume</div>
              <div className="v down">{num(data.options.put_volume, 0)}</div>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Side</th>
                <th>Exp</th>
                <th>Strike</th>
                <th>Vol</th>
                <th>OI</th>
                <th>Vol/OI</th>
              </tr>
            </thead>
            <tbody>
              {data.options.items.slice(0, 6).map((o, i) => (
                <tr key={i}>
                  <td className={o.side === "call" ? "up" : "down"}>{o.side}</td>
                  <td>{(o.expiry || data.options.expiry || "—").slice(5)}</td>
                  <td>{num(o.strike, 1)}</td>
                  <td>{num(o.volume, 0)}</td>
                  <td>{num(o.open_interest, 0)}</td>
                  <td>{num(o.vol_oi, 1)}</td>
                </tr>
              ))}
              {data.options.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    {data.options.error
                      ? `Options request failed: ${data.options.error}`
                      : data.options.expiry
                        ? "No unusual volume on the nearest chains"
                        : "Yahoo returned no option chain for this ticker"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </article>

        <article>
          <div className="section-h">
            Insider trades
            <span className="muted">net {money(data.insiders.net_value)}</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Insider</th>
                <th>Text</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {data.insiders.items.slice(0, 6).map((r, i) => (
                <tr key={i}>
                  <td>{r.date || "—"}</td>
                  <td>{r.insider || "—"}</td>
                  <td>{(r.text || "").slice(0, 42)}</td>
                  <td>{money(r.value)}</td>
                </tr>
              ))}
              {data.insiders.items.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No recent Form 4 rows
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </article>

        <article>
          <div className="section-h">
            Senate / House holdings
            <span className="muted">
              {data.congress.buy_count ?? 0} buy · {data.congress.sell_count ?? 0} sell
            </span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Member</th>
                <th>Type</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.congress.items.slice(0, 6).map((r, i) => (
                <tr key={i}>
                  <td>{r.date || "—"}</td>
                  <td>
                    {r.person || "—"}
                    {r.chamber ? ` (${r.chamber})` : ""}
                  </td>
                  <td>{r.type || "—"}</td>
                  <td>{r.amount || "—"}</td>
                </tr>
              ))}
              {data.congress.items.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No matching periodic transaction reports
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </article>
      </div>

      <div className="section-h">Top news</div>
      <div className="news">
        {data.news.slice(0, 6).map((n, i) => (
          <a key={i} href={n.url || "#"} target="_blank" rel="noreferrer">
            {n.title}
            <div className="src">
              {n.publisher}
              {n.published ? ` · ${String(n.published).slice(0, 16)}` : ""}
            </div>
          </a>
        ))}
        {data.news.length === 0 && <div className="summary">No headlines returned.</div>}
      </div>
    </section>
  );
}
