export type LlmAdvice = {
  action: "BUY" | "SELL" | "LONG CALL" | "LONG PUT" | string;
  confidence: "high" | "medium" | "low" | string;
  thesis: string;
  reasons: string[];
  macro_view: string;
  risks: string[];
  time_horizon: string;
  provider: string;
  model: string;
  disclaimer: string;
};

export type LlmAdviceResponse = {
  symbol: string;
  advice: LlmAdvice;
  context_as_of?: number;
};
