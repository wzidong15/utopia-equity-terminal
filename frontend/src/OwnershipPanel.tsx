import { cls, fmt, fmtEarnings, fmtInt, pct } from "./format";

export type OwnershipHolder = {
  name?: string | null;
  shares?: number | null;
  value?: number | null;
  pct_held?: number | null;
  pct_change?: number | null;
  as_of?: string | null;
};

export type SecFiling = {
  type?: string | null;
  title?: string | null;
  date?: string | null;
  url?: string | null;
};

export type Ownership = {
  symbol: string;
  source?: string;
  beta?: number | null;
  float?: number | null;
  shares_out?: number | null;
  short_shares?: number | null;
  short_pct_float?: number | null;
  short_ratio?: number | null;
  short_prior?: number | null;
  short_as_of?: number | null;
  insider_pct?: number | null;
  inst_pct?: number | null;
  holders: OwnershipHolder[];
  filings: SecFiling[];
};

export default function OwnershipPanel({
  data,
  loading,
}: {
  data: Ownership | null;
  loading: boolean;
}) {
  if (loading && !data) {
    return (
      <section className="fundamentals ownership">
        <div className="section-h">Ownership · filings</div>
        <div className="summary">Loading short interest, holders, and SEC filings…</div>
      </section>
    );
  }
  if (!data) return null;
  return (
    <section className="fundamentals ownership">
      <div className="section-h">
        Ownership · {data.symbol}
        <span className="muted">
          Yahoo float / short
          {data.short_as_of ? ` · SI as of ${fmtEarnings(data.short_as_of)}` : ""}
        </span>
      </div>
      <div className="stats fa-ratios own-ratios">
        <div className="stat">
          <div className="k">Beta</div>
          <div className="v">{fmt(data.beta, 2)}</div>
        </div>
        <div className="stat">
          <div className="k">Float</div>
          <div className="v">{fmtInt(data.float)}</div>
        </div>
        <div className="stat">
          <div className="k">Short % float</div>
          <div className="v">{data.short_pct_float == null ? "—" : `${data.short_pct_float.toFixed(2)}%`}</div>
        </div>
        <div className="stat">
          <div className="k">Days to cover</div>
          <div className="v">{fmt(data.short_ratio, 1)}</div>
        </div>
        <div className="stat">
          <div className="k">Inst / insider</div>
          <div className="v">
            {data.inst_pct == null ? "—" : `${data.inst_pct.toFixed(0)}%`}
            {" / "}
            {data.insider_pct == null ? "—" : `${data.insider_pct.toFixed(1)}%`}
          </div>
        </div>
      </div>
      <div className="fa-grid">
        <article>
          <div className="section-h">
            SEC filings
            <span className="muted">10-K · 10-Q · 8-K</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Title</th>
              </tr>
            </thead>
            <tbody>
              {data.filings.map((f, i) => (
                <tr key={`${f.type}-${f.date}-${i}`}>
                  <td>{f.date || "—"}</td>
                  <td>{f.type || "—"}</td>
                  <td className="own-title">
                    {f.url ? (
                      <a href={f.url} target="_blank" rel="noreferrer">
                        {(f.title || f.type || "Filing").slice(0, 56)}
                      </a>
                    ) : (
                      (f.title || "—").slice(0, 56)
                    )}
                  </td>
                </tr>
              ))}
              {data.filings.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    No 10-K / 10-Q / 8-K rows from Yahoo
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </article>
        <article>
          <div className="section-h">
            Top holders
            <span className="muted">13F snapshot</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Holder</th>
                <th>%</th>
                <th>Shares</th>
                <th>Chg</th>
              </tr>
            </thead>
            <tbody>
              {data.holders.map((h, i) => (
                <tr key={`${h.name}-${i}`}>
                  <td className="own-title">{h.name || "—"}</td>
                  <td>{h.pct_held == null ? "—" : `${h.pct_held.toFixed(1)}%`}</td>
                  <td>{fmtInt(h.shares)}</td>
                  <td className={cls(h.pct_change)}>{pct(h.pct_change)}</td>
                </tr>
              ))}
              {data.holders.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No institutional holders from Yahoo
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </article>
      </div>
    </section>
  );
}
