import { useEffect, useState } from "react";
import { api } from "./api";
import { CHART_REFRESH_MS } from "./config";
import NavChart from "./NavChart";
import {
  STRATEGY_OPTIONS,
  type Portfolio,
  type PortfolioStrategyKind,
  type PortfolioSummary,
} from "./portfolio";

function money(n?: number | null) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}
function pct(n?: number | null) {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}
function cls(n?: number | null) {
  if (n == null) return "";
  return n >= 0 ? "up" : "down";
}

export default function PortfolioPanel({
  onOpenSymbol,
}: {
  onOpenSymbol: (symbol: string) => void;
}) {
  const [items, setItems] = useState<PortfolioSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Portfolio | null>(null);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("100000");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tradeSym, setTradeSym] = useState("AAPL");
  const [tradeSide, setTradeSide] = useState<"buy" | "sell">("buy");
  const [tradeQty, setTradeQty] = useState("");
  const [tradeNotional, setTradeNotional] = useState("");
  const [stratKind, setStratKind] = useState<PortfolioStrategyKind>("manual");
  const [stratAuto, setStratAuto] = useState(false);
  const [stratSym, setStratSym] = useState("SPY");

  const loadList = () =>
    api
      .portfolios()
      .then((r) => {
        setItems(r.items || []);
        setSelectedId((cur) => cur || r.items?.[0]?.id || null);
      })
      .catch((e) => setErr(String(e.message || e)));

  useEffect(() => {
    loadList();
    const id = setInterval(loadList, CHART_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let live = true;
    const pull = () => {
      api
        .portfolio(selectedId)
        .then((p) => {
          if (!live) return;
          setDetail(p);
          setStratKind(p.strategy?.kind || "manual");
          setStratAuto(!!p.strategy?.auto);
          setStratSym(p.strategy?.symbol || "SPY");
        })
        .catch((e) => live && setErr(String(e.message || e)));
    };
    pull();
    const id = setInterval(pull, CHART_REFRESH_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [selectedId]);

  const create = () => {
    const dollars = Number(amount.replace(/,/g, ""));
    if (!name.trim() || !Number.isFinite(dollars) || dollars <= 0) {
      setErr("Enter a fund name and a positive dollar amount.");
      return;
    }
    setBusy(true);
    setErr(null);
    api
      .createPortfolio(name.trim(), dollars)
      .then((p) => {
        setName("");
        setSelectedId(p.id);
        setDetail(p);
        return loadList();
      })
      .catch((e) => setErr(String(e.message || e)))
      .finally(() => setBusy(false));
  };

  const remove = (id: string) => {
    if (!window.confirm("Delete this paper portfolio?")) return;
    api
      .deletePortfolio(id)
      .then(() => {
        if (selectedId === id) setSelectedId(null);
        return loadList();
      })
      .catch((e) => setErr(String(e.message || e)));
  };

  const submitTrade = () => {
    if (!selectedId) return;
    const shares = tradeQty.trim() ? Number(tradeQty) : undefined;
    const notional = tradeNotional.trim() ? Number(tradeNotional) : undefined;
    if (!tradeSym.trim() || (!shares && !notional)) {
      setErr("Enter a ticker and either shares or dollar amount.");
      return;
    }
    setBusy(true);
    setErr(null);
    api
      .portfolioOrder(selectedId, {
        symbol: tradeSym.trim().toUpperCase(),
        side: tradeSide,
        shares,
        notional,
      })
      .then((p) => {
        setDetail(p);
        setTradeQty("");
        setTradeNotional("");
        return loadList();
      })
      .catch((e) => setErr(String(e.message || e)))
      .finally(() => setBusy(false));
  };

  const saveStrategy = () => {
    if (!selectedId) return;
    setBusy(true);
    setErr(null);
    api
      .setPortfolioStrategy(selectedId, {
        kind: stratKind,
        auto: stratKind !== "manual" && stratAuto,
        symbol: stratSym.trim().toUpperCase() || "SPY",
      })
      .then((p) => {
        setDetail(p);
        return loadList();
      })
      .catch((e) => setErr(String(e.message || e)))
      .finally(() => setBusy(false));
  };

  const runNow = () => {
    if (!selectedId) return;
    setBusy(true);
    api
      .tickPortfolio(selectedId, true)
      .then((p) => {
        setDetail(p);
        return loadList();
      })
      .catch((e) => setErr(String(e.message || e)))
      .finally(() => setBusy(false));
  };

  const hint = STRATEGY_OPTIONS.find((s) => s.id === stratKind)?.hint;

  return (
    <div className="layout pf-layout">
      <aside className="col">
        <div className="section-h">Paper portfolios</div>
        <div className="pf-create">
          <input
            value={name}
            placeholder="Fund name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
          <input
            value={amount}
            placeholder="Starting dollars"
            inputMode="decimal"
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
          <button type="button" className="llm-btn" onClick={create} disabled={busy}>
            Create fund
          </button>
        </div>
        {items.length === 0 && (
          <div className="watch-empty">Create a fund with a name and starting cash to paper-trade.</div>
        )}
        {items.map((p) => (
          <div key={p.id} className={`row ${p.id === selectedId ? "sel" : ""}`}>
            <button type="button" className="row-main" onClick={() => setSelectedId(p.id)}>
              <span className="sym">{p.name}</span>
              <span>
                <div className="px">{money(p.nav)}</div>
                <div className={`meta ${cls(p.return_pct)}`}>{pct(p.return_pct)}</div>
              </span>
              <span className="muted">{p.strategy?.kind === "manual" ? "manual" : p.strategy?.kind}</span>
            </button>
            <button
              type="button"
              className="remove-btn"
              title="Delete portfolio"
              onClick={() => remove(p.id)}
            >
              ×
            </button>
          </div>
        ))}
      </aside>

      <main className="center">
        {err && <div className="err">{err}</div>}
        {!detail && <div className="watch-empty">Select or create a portfolio.</div>}
        {detail && (
          <>
            <div className="header">
              <div>
                <h1>{detail.name}</h1>
                <div className="name">
                  Started {money(detail.initial_cash)} · cash {money(detail.cash)} · paper trading, not a
                  broker
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className={`bigpx ${cls(detail.pnl)}`}>{money(detail.nav)}</div>
                <div className={cls(detail.pnl)}>
                  {money(detail.pnl)} ({pct(detail.return_pct)})
                </div>
              </div>
            </div>
            <div className="stats">
              <div className="stat">
                <div className="k">NAV</div>
                <div className="v">{money(detail.nav)}</div>
              </div>
              <div className="stat">
                <div className="k">Cash</div>
                <div className="v">{money(detail.cash)}</div>
              </div>
              <div className="stat">
                <div className="k">P/L</div>
                <div className={`v ${cls(detail.pnl)}`}>{money(detail.pnl)}</div>
              </div>
              <div className="stat">
                <div className="k">Return</div>
                <div className={`v ${cls(detail.return_pct)}`}>{pct(detail.return_pct)}</div>
              </div>
              <div className="stat">
                <div className="k">Max DD</div>
                <div className="v">{pct(detail.max_drawdown_pct)}</div>
              </div>
              <div className="stat">
                <div className="k">Positions</div>
                <div className="v">{detail.holdings?.length ?? 0}</div>
              </div>
            </div>
            <div className="section-h">NAV over time</div>
            <div className="chart-wrap pf-chart">
              <NavChart snapshots={detail.snapshots || []} />
            </div>
            <div className="section-h">Holdings</div>
            <table className="pf-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Shares</th>
                  <th>Avg cost</th>
                  <th>Last</th>
                  <th>Value</th>
                  <th>uP/L</th>
                </tr>
              </thead>
              <tbody>
                {(detail.holdings || []).length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      No positions yet.
                    </td>
                  </tr>
                )}
                {(detail.holdings || []).map((h) => (
                  <tr key={h.symbol}>
                    <td>
                      <button type="button" className="linkish" onClick={() => onOpenSymbol(h.symbol)}>
                        {h.symbol}
                      </button>
                    </td>
                    <td>{h.shares}</td>
                    <td>{money(h.avg_cost)}</td>
                    <td>{money(h.last_price)}</td>
                    <td>{money(h.market_value)}</td>
                    <td className={cls(h.unrealized_pnl)}>{money(h.unrealized_pnl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </main>

      <aside className="col">
        <div className="section-h">Simulate a trade</div>
        <div className="pf-form">
          <label>
            Ticker
            <input value={tradeSym} onChange={(e) => setTradeSym(e.target.value.toUpperCase())} />
          </label>
          <div className="tabs">
            {(["buy", "sell"] as const).map((s) => (
              <button key={s} className={tradeSide === s ? "on" : ""} onClick={() => setTradeSide(s)}>
                {s}
              </button>
            ))}
          </div>
          <label>
            Shares
            <input
              value={tradeQty}
              placeholder="e.g. 10"
              onChange={(e) => setTradeQty(e.target.value)}
            />
          </label>
          <label>
            Or dollars
            <input
              value={tradeNotional}
              placeholder="e.g. 5000"
              onChange={(e) => setTradeNotional(e.target.value)}
            />
          </label>
          <button type="button" className="llm-btn" onClick={submitTrade} disabled={busy || !detail}>
            Place paper order
          </button>
        </div>

        <div className="section-h">Quant strategy</div>
        <div className="pf-form">
          <label>
            Strategy
            <select
              value={stratKind}
              onChange={(e) => setStratKind(e.target.value as PortfolioStrategyKind)}
            >
              {STRATEGY_OPTIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          {hint && <div className="muted pf-hint">{hint}</div>}
          {stratKind !== "momentum" && (
            <label>
              Symbol
              <input value={stratSym} onChange={(e) => setStratSym(e.target.value.toUpperCase())} />
            </label>
          )}
          {stratKind !== "manual" && (
            <label className="pf-check">
              <input type="checkbox" checked={stratAuto} onChange={(e) => setStratAuto(e.target.checked)} />
              Run automatically every hour while the terminal is up
            </label>
          )}
          <button type="button" className="llm-btn" onClick={saveStrategy} disabled={busy || !detail}>
            Save strategy
          </button>
          {stratKind !== "manual" && (
            <button type="button" className="ghost-btn" onClick={runNow} disabled={busy || !detail}>
              Run one step now
            </button>
          )}
          {detail?.strategy?.note && <div className="muted pf-hint">Last: {detail.strategy.note}</div>}
          {detail?.strategy?.auto && detail.strategy.next_run_at ? (
            <div className="muted pf-hint">
              Next automatic run around {new Date(detail.strategy.next_run_at * 1000).toLocaleString()}
            </div>
          ) : null}
          {detail?.last_error && <div className="err">{detail.last_error}</div>}
        </div>

        <div className="section-h">Trade log</div>
        <div className="news">
          {(detail?.trades || [])
            .slice()
            .reverse()
            .slice(0, 40)
            .map((t, i) => (
              <div key={`${t.t}-${i}`} className="pf-trade">
                <div>
                  <b className={t.side === "buy" ? "up" : "down"}>{t.side.toUpperCase()}</b> {t.shares}{" "}
                  {t.symbol} @ {money(t.price)}
                </div>
                <div className="src">
                  {t.source} · {new Date(t.t * 1000).toLocaleString()}
                </div>
              </div>
            ))}
          {(!detail?.trades || detail.trades.length === 0) && (
            <div className="watch-empty">No trades yet.</div>
          )}
        </div>
      </aside>
    </div>
  );
}
