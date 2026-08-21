import type { Fundamentals } from "./fundamentals";
import { fmt, fmtEarnings, money } from "./format";

function ratioPct(n?: number | null) {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toFixed(1)}%`;
}

export default function FundamentalsPanel({
  data,
  loading,
}: {
  data: Fundamentals | null;
  loading: boolean;
}) {
  if (loading && !data) {
    return (
      <section className="fundamentals">
        <div className="section-h">Financials</div>
        <div className="summary">Loading statements and EPS history…</div>
      </section>
    );
  }
  if (!data) return null;
  const incomeCols = data.income.slice(0, 4);
  const balanceCols = data.balance.slice(0, 4);
  const cashCols = data.cashflow.slice(0, 4);
  const r = data.ratios || {};
  return (
    <section className="fundamentals">
      <div className="section-h">
        Financials · {data.symbol}
        <span className="muted">
          {data.next_earnings_at ? `Next report ${fmtEarnings(data.next_earnings_at)}` : "Yahoo annual + TTM"}
        </span>
      </div>
      <div className="stats fa-ratios">
        <div className="stat">
          <div className="k">Gross margin</div>
          <div className="v">{ratioPct(r.gross_margin)}</div>
        </div>
        <div className="stat">
          <div className="k">Op. margin</div>
          <div className="v">{ratioPct(r.operating_margin)}</div>
        </div>
        <div className="stat">
          <div className="k">ROE</div>
          <div className="v">{ratioPct(r.roe)}</div>
        </div>
        <div className="stat">
          <div className="k">FCF</div>
          <div className="v">{money(r.fcf)}</div>
        </div>
        <div className="stat">
          <div className="k">Net debt</div>
          <div className={`v ${(r.net_debt ?? 0) > 0 ? "down" : "up"}`}>{money(r.net_debt)}</div>
        </div>
      </div>

      <div className="fa-grid">
        <article>
          <div className="section-h">Income</div>
          <StatementTable
            cols={incomeCols}
            rows={[
              ["Revenue", "revenue", "money"],
              ["Gross profit", "gross_profit", "money"],
              ["Operating income", "operating_income", "money"],
              ["Net income", "net_income", "money"],
              ["Diluted EPS", "eps", "num"],
            ]}
          />
        </article>
        <article>
          <div className="section-h">Cash flow</div>
          <StatementTable
            cols={cashCols}
            rows={[
              ["Operating CF", "operating_cf", "money"],
              ["Capex", "capex", "money"],
              ["Free cash flow", "fcf", "money"],
            ]}
          />
        </article>
        <article>
          <div className="section-h">Balance sheet</div>
          <StatementTable
            cols={balanceCols}
            rows={[
              ["Cash", "cash", "money"],
              ["Total debt", "total_debt", "money"],
              ["Equity", "equity", "money"],
              ["Total assets", "total_assets", "money"],
            ]}
          />
        </article>
        <article>
          <div className="section-h">
            EPS vs estimate
            <span className="muted">last four reported quarters</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Period</th>
                <th>Est</th>
                <th>Actual</th>
                <th>Surprise</th>
              </tr>
            </thead>
            <tbody>
              {data.earnings.map((e, i) => (
                <tr key={i}>
                  <td>{e.period || fmtEarnings(e.at)}</td>
                  <td>{fmt(e.estimate)}</td>
                  <td>{fmt(e.actual)}</td>
                  <td className={(e.surprise_pct ?? 0) >= 0 ? "up" : "down"}>
                    {e.surprise_pct == null ? "—" : `${e.surprise_pct >= 0 ? "+" : ""}${e.surprise_pct.toFixed(1)}%`}
                  </td>
                </tr>
              ))}
              {data.earnings.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No EPS history from Yahoo
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

function StatementTable({
  cols,
  rows,
}: {
  cols: Fundamentals["income"];
  rows: [string, keyof Fundamentals["income"][number], "money" | "num"][];
}) {
  if (!cols.length) {
    return <div className="summary">No statement rows</div>;
  }
  return (
    <div className="fa-scroll">
      <table>
        <thead>
          <tr>
            <th></th>
            {cols.map((c) => (
              <th key={c.period}>{c.period}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, key, kind]) => (
            <tr key={key}>
              <td className="muted">{label}</td>
              {cols.map((c) => {
                const v = c[key] as number | null | undefined;
                return <td key={c.period}>{kind === "money" ? money(v) : fmt(v)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
