export type PortfolioStrategyKind =
  | "manual"
  | "buy_hold"
  | "sma_cross"
  | "momentum"
  | "rsi_reversion";

export type PortfolioStrategy = {
  kind: PortfolioStrategyKind;
  auto?: boolean;
  symbol?: string;
  last_run_at?: number;
  next_run_at?: number;
  interval_sec?: number;
  note?: string;
};

export type PortfolioHolding = {
  symbol: string;
  shares: number;
  avg_cost: number;
  last_price?: number | null;
  market_value?: number | null;
  unrealized_pnl?: number | null;
};

export type PortfolioTrade = {
  t: number;
  symbol: string;
  side: "buy" | "sell";
  shares: number;
  price: number;
  notional: number;
  source?: string;
};

export type PortfolioSnapshot = {
  t: number;
  nav: number;
  cash: number;
};

export type Portfolio = {
  id: string;
  name: string;
  initial_cash: number;
  cash: number;
  nav: number;
  pnl: number;
  return_pct: number;
  max_drawdown_pct?: number;
  created_at: number;
  updated_at?: number;
  holdings: PortfolioHolding[];
  trades?: PortfolioTrade[];
  snapshots?: PortfolioSnapshot[];
  strategy?: PortfolioStrategy;
  last_error?: string | null;
  tick_note?: string | null;
};

export type PortfolioSummary = {
  id: string;
  name: string;
  initial_cash: number;
  cash: number;
  nav: number;
  pnl: number;
  return_pct: number;
  strategy?: PortfolioStrategy;
  updated_at?: number;
  created_at: number;
  holdings_count: number;
  last_error?: string | null;
};

export const STRATEGY_OPTIONS: { id: PortfolioStrategyKind; label: string; hint: string }[] = [
  { id: "manual", label: "Manual", hint: "You place paper buy/sell orders." },
  { id: "buy_hold", label: "Buy & hold", hint: "Automatically invest cash in one ticker and hold." },
  { id: "sma_cross", label: "SMA crossover", hint: "Buy when SMA20 > SMA50; sell when it crosses down." },
  { id: "momentum", label: "Momentum", hint: "Rotate into the top 3 US gainers (equal weight)." },
  { id: "rsi_reversion", label: "RSI mean reversion", hint: "Buy ~25% cash when RSI < 30; sell when RSI > 70." },
];
