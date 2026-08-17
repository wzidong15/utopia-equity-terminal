import { useEffect, useState } from "react";
import { api } from "./api";
import type { LlmAdviceResponse } from "./llm";

function actionClass(action: string) {
  const a = action.toUpperCase();
  if (a === "BUY" || a === "LONG CALL") return "badge buy";
  if (a === "SELL" || a === "LONG PUT") return "badge sell";
  return "badge neutral";
}

export default function LlmAdvicePanel({ symbol }: { symbol: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LlmAdviceResponse | null>(null);

  const run = () => {
    setLoading(true);
    setError(null);
    api
      .llmAdvice(symbol)
      .then((r) => {
        setData(r);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e.message || e));
        setLoading(false);
      });
  };

  useEffect(() => {
    setData(null);
    setError(null);
  }, [symbol]);

  const advice = data?.advice;

  return (
    <section className="llm-advice">
      <div className="llm-advice-head">
        <div>
          <div className="llm-advice-title">AI investment view</div>
          <div className="llm-advice-sub">
            Uses quote, fundamentals, insiders, options, news, and macro (SPY, QQQ, DIA, IWM, VIX).
          </div>
        </div>
        <button type="button" className="llm-btn" onClick={run} disabled={loading}>
          {loading ? "Analyzing…" : "Generate suggestion"}
        </button>
      </div>

      {error && <div className="err llm-err">{error}</div>}

      {!advice && !loading && !error && (
        <div className="llm-placeholder">
          Click <strong>Generate suggestion</strong> to send the current stock context to an LLM (OpenAI or
          Claude). Requires <code>OPENAI_API_KEY</code> or <code>ANTHROPIC_API_KEY</code> in <code>.env</code>.
        </div>
      )}

      {advice && (
        <div className="decision llm-result">
          <div className="decision-row">
            <span className={actionClass(advice.action)}>{advice.action}</span>
            <span className="muted">
              {advice.confidence} confidence · {advice.time_horizon} horizon
            </span>
            <span className="muted llm-meta">
              {advice.provider}/{advice.model}
            </span>
          </div>
          {advice.thesis && <p className="llm-thesis">{advice.thesis}</p>}
          {advice.macro_view && (
            <div className="llm-block">
              <div className="k">Macro context</div>
              <p>{advice.macro_view}</p>
            </div>
          )}
          {advice.reasons.length > 0 && (
            <div className="llm-block">
              <div className="k">Reasons</div>
              <ul>
                {advice.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          {advice.risks.length > 0 && (
            <div className="llm-block">
              <div className="k">Risks</div>
              <ul>
                {advice.risks.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="muted">{advice.disclaimer}</div>
        </div>
      )}
    </section>
  );
}
