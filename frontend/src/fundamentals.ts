export type StatementRow = {
  period: string;
  revenue?: number | null;
  gross_profit?: number | null;
  operating_income?: number | null;
  net_income?: number | null;
  eps?: number | null;
  cash?: number | null;
  total_debt?: number | null;
  equity?: number | null;
  total_assets?: number | null;
  operating_cf?: number | null;
  capex?: number | null;
  fcf?: number | null;
};

export type EarningsPrint = {
  at?: number | null;
  period?: string;
  estimate?: number | null;
  actual?: number | null;
  surprise_pct?: number | null;
};

export type Fundamentals = {
  symbol: string;
  source?: string;
  next_earnings_at?: number | null;
  upcoming?: EarningsPrint | null;
  ratios: {
    gross_margin?: number | null;
    fcf?: number | null;
    net_debt?: number | null;
    roe?: number | null;
    operating_margin?: number | null;
  };
  income: StatementRow[];
  balance: StatementRow[];
  cashflow: StatementRow[];
  earnings: EarningsPrint[];
};

export type PeerList = {
  symbol: string;
  sector?: string | null;
  items: import("./types").Quote[];
  source?: string;
};

export type ScreenerResult = {
  items: import("./types").Quote[];
  source?: string;
  sectors?: string[];
};
