export type Quote = {
  ticker: string;
  symbol: string;
  name: string;
  exchange?: string | null;
  price: number | null;
  change_pct: number | null;
  change: number | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  volume?: number | null;
  avg_volume?: number | null;
  market_cap?: number | null;
  pe?: number | null;
  eps?: number | null;
  dividend_yield?: number | null;
  year_high?: number | null;
  year_low?: number | null;
  perf_w?: number | null;
  perf_1m?: number | null;
  perf_3m?: number | null;
  perf_y?: number | null;
  rsi?: number | null;
  sma20?: number | null;
  sma50?: number | null;
  sma200?: number | null;
  macd?: number | null;
  macd_signal?: number | null;
  recommend?: number | null;
  recommend_label?: string | null;
  recommend_ma?: number | null;
  recommend_os?: number | null;
  sector?: string | null;
  industry?: string | null;
  source?: string;
  delay?: string;
  as_of?: number;
  prev_close?: number | null;
  regular_close?: number | null;
  pre_price?: number | null;
  post_price?: number | null;
  vs_close?: number | null;
  vs_close_pct?: number | null;
  session?: "pre" | "rth" | "post" | "closed" | string;
};

export type Bar = {
  time: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  session?: "pre" | "rth" | "post" | string;
};

export type NewsItem = {
  title: string;
  url?: string | null;
  publisher?: string | null;
  published?: string | number | null;
};

export type Profile = Record<string, string | number | null>;

export type TA = {
  summary: { RECOMMENDATION?: string; BUY?: number; SELL?: number; NEUTRAL?: number };
  oscillators: Record<string, unknown>;
  moving_averages: Record<string, unknown>;
  indicators: Record<string, number | null>;
};
