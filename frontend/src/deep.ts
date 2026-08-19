export type DeepAnalysis = {
  symbol: string;
  price?: number | null;
  name?: string;
  insiders: {
    net_value?: number;
    tilt?: string;
    items: {
      date?: string | null;
      insider?: string | null;
      title?: string | null;
      text?: string;
      shares?: number | null;
      value?: number | null;
    }[];
  };
  options: {
    expiry?: string | null;
    call_volume?: number;
    put_volume?: number;
    put_call?: number | null;
    error?: string | null;
    source?: string | null;
    items: {
      side: string;
      expiry?: string | null;
      strike?: number | null;
      last?: number | null;
      volume?: number | null;
      open_interest?: number | null;
      iv?: number | null;
      vol_oi?: number | null;
    }[];
  };
  congress: {
    buy_count?: number;
    sell_count?: number;
    tilt?: string;
    items: {
      date?: string | null;
      chamber?: string | null;
      person?: string | null;
      type?: string | null;
      amount?: string | null;
    }[];
  };
  news: { title?: string; url?: string | null; publisher?: string | null; published?: string | number | null }[];
  forecast: {
    target_mean?: number | null;
    target_high?: number | null;
    target_low?: number | null;
    analysts?: number | null;
    recommendation?: string | null;
    upside_pct?: number | null;
  };
  suggestion: {
    action: string;
    score: number;
    reasons: string[];
    disclaimer: string;
  };
};
