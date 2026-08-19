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

export type LlmChatMessage = {
  role: "user" | "assistant" | string;
  kind?: "advice" | "text" | "context" | string;
  content: string;
  advice?: LlmAdvice;
};

export type LlmAdviceResponse = {
  symbol: string;
  conversation_id: string;
  advice: LlmAdvice;
  messages?: LlmChatMessage[];
  context_as_of?: number;
};

export type LlmAdviceChatResponse = {
  symbol: string;
  conversation_id: string;
  advice?: LlmAdvice;
  reply: string;
  messages: LlmChatMessage[];
};

export type VibeSuggestion = {
  symbol: string;
  action: "HOLD" | "ADD" | "TRIM" | "EXIT" | string;
  note: string;
};

export type VibePortfolioAdvice = {
  stance: "ADD RISK" | "HOLD" | "REDUCE RISK" | "REBALANCE" | string;
  confidence: "high" | "medium" | "low" | string;
  thesis: string;
  suggestions: VibeSuggestion[];
  reasons: string[];
  risks: string[];
  time_horizon: string;
  provider: string;
  model: string;
  disclaimer: string;
  llm_error?: string;
};

export type VibeChatMessage = {
  role: "user" | "assistant" | string;
  kind?: "advice" | "text" | "context" | string;
  content: string;
  advice?: VibePortfolioAdvice;
};

export type VibePortfolioResponse = {
  portfolio_id: string;
  conversation_id: string;
  engine: "llm" | "heuristic" | string;
  advice: VibePortfolioAdvice;
  messages?: VibeChatMessage[];
  research?: {
    as_of?: number;
    stack?: string;
    cash_weight_pct?: number;
    top_weight_pct?: number;
    holdings?: { symbol: string; weight_pct?: number; rsi?: number | null; ta_label?: string | null }[];
    fund?: { id?: string; name?: string };
  };
  llm?: { openai: boolean; anthropic: boolean; any: boolean };
};

export type VibePortfolioChatResponse = {
  portfolio_id: string;
  conversation_id: string;
  advice?: VibePortfolioAdvice;
  reply: string;
  messages: VibeChatMessage[];
};
