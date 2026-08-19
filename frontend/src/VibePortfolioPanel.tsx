import { useEffect, useRef, useState } from "react";
import { api, isAbortError } from "./api";
import type { VibeChatMessage, VibePortfolioAdvice, VibeSuggestion } from "./llm";

const STARTERS: { label: string; action: "generate" | "ask" }[] = [
  { label: "Analyze the book: ADD RISK, HOLD, REDUCE RISK, or REBALANCE", action: "generate" },
  { label: "Where is concentration risk?", action: "ask" },
  { label: "What should I do with idle cash?", action: "ask" },
];

function stanceClass(stance: string) {
  const s = stance.toUpperCase();
  if (s === "ADD RISK") return "badge buy";
  if (s === "REDUCE RISK") return "badge sell";
  if (s === "REBALANCE") return "badge ta-buy";
  return "badge neutral";
}

function actionClass(action: string) {
  const a = action.toUpperCase();
  if (a === "ADD") return "badge buy";
  if (a === "TRIM" || a === "EXIT") return "badge sell";
  return "badge neutral";
}

function AdviceCard({
  advice,
  cashWeight,
  topWeight,
  engine,
  onApply,
}: {
  advice: VibePortfolioAdvice;
  cashWeight?: number;
  topWeight?: number;
  engine?: string;
  onApply?: (s: VibeSuggestion) => void;
}) {
  return (
    <div className="decision llm-result llm-result-inline">
      <div className="decision-row">
        <span className={stanceClass(advice.stance)}>{advice.stance}</span>
        <span className="muted">
          {advice.confidence} confidence · {advice.time_horizon}
          {engine ? ` · ${engine}` : ""}
        </span>
        <span className="muted llm-meta">
          {advice.provider}/{advice.model}
        </span>
      </div>
      {advice.thesis && <p className="llm-thesis">{advice.thesis}</p>}
      {(cashWeight != null || topWeight != null) && (
        <div className="muted pf-hint">
          {cashWeight != null ? `Cash ${cashWeight.toFixed(1)}% of NAV` : ""}
          {topWeight != null ? ` · largest name ${topWeight.toFixed(1)}%` : ""}
        </div>
      )}
      {advice.suggestions.length > 0 && (
        <div className="llm-block">
          <div className="k">Position notes</div>
          <ul className="vibe-suggestions">
            {advice.suggestions.map((s) => (
              <li key={`${s.symbol}-${s.action}`}>
                <span className={actionClass(s.action)}>{s.action}</span>{" "}
                <button type="button" className="linkish" onClick={() => onApply?.(s)}>
                  {s.symbol}
                </button>
                {s.note ? <span className="muted"> — {s.note}</span> : null}
              </li>
            ))}
          </ul>
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
  );
}

export default function VibePortfolioPanel({
  portfolioId,
  fundName,
  onApply,
}: {
  portfolioId: string | null;
  fundName?: string;
  onApply?: (s: VibeSuggestion) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [advice, setAdvice] = useState<VibePortfolioAdvice | null>(null);
  const [messages, setMessages] = useState<VibeChatMessage[]>([]);
  const [cashWeight, setCashWeight] = useState<number | undefined>();
  const [topWeight, setTopWeight] = useState<number | undefined>();
  const [engine, setEngine] = useState<string | undefined>();
  const [draft, setDraft] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const idRef = useRef(portfolioId);
  idRef.current = portfolioId;

  const label = fundName || "this fund";

  useEffect(() => {
    api
      .health()
      .then((h) => setConfigured(!!h.llm?.any))
      .catch(() => setConfigured(null));
  }, []);

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setSending(false);
    setError(null);
    setConversationId(null);
    setAdvice(null);
    setMessages([]);
    setCashWeight(undefined);
    setTopWeight(undefined);
    setEngine(undefined);
    setDraft("");
  }, [portfolioId]);

  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, loading, sending]);

  const busy = loading || sending;
  const ready = configured !== false && Boolean(portfolioId);

  const nextController = () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    return controller;
  };

  const stop = () => {
    abortRef.current?.abort();
  };

  const beginConversation = async (signal: AbortSignal) => {
    if (!portfolioId) throw new Error("Select a fund first");
    const id = portfolioId;
    const r = await api.vibePortfolio(id, signal);
    if (id !== idRef.current) throw new Error("Fund changed");
    const nextMessages = r.messages?.length
      ? r.messages
      : [{ role: "assistant", kind: "advice", content: "", advice: r.advice }];
    setConversationId(r.conversation_id);
    setAdvice(r.advice);
    setEngine(r.engine);
    setCashWeight(r.research?.cash_weight_pct);
    setTopWeight(r.research?.top_weight_pct);
    if (r.llm?.any || r.engine === "llm") setConfigured(true);
    return { id: r.conversation_id, messages: nextMessages, advice: r.advice };
  };

  const generate = async () => {
    if (busy || !ready) return;
    const controller = nextController();
    setLoading(true);
    setError(null);
    try {
      const started = await beginConversation(controller.signal);
      if (controller.signal.aborted) return;
      setMessages(started.messages);
    } catch (e) {
      if (isAbortError(e) || controller.signal.aborted) return;
      setError(String((e as Error).message || e));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
      requestAnimationFrame(() => composerRef.current?.focus());
    }
  };

  const send = async (preset?: string) => {
    const text = (preset ?? draft).trim();
    if (!text || busy || !ready || !portfolioId) return;
    if (!preset) setDraft("");
    const controller = nextController();
    setSending(true);
    setError(null);

    let cid = conversationId;
    const pendingUser: VibeChatMessage = { role: "user", kind: "text", content: text };
    const id = portfolioId;

    try {
      if (!cid) {
        setMessages([pendingUser]);
        setLoading(true);
        const started = await beginConversation(controller.signal);
        setLoading(false);
        cid = started.id;
        setMessages([...started.messages, pendingUser]);
      } else {
        setMessages((prev) => [...prev, pendingUser]);
      }
      const r = await api.vibePortfolioChat(id, cid, text, controller.signal);
      if (id !== idRef.current || controller.signal.aborted) return;
      setMessages(r.messages);
      if (r.advice) setAdvice(r.advice);
    } catch (e) {
      if (id !== idRef.current) return;
      if (isAbortError(e) || controller.signal.aborted) {
        setDraft(text);
        setMessages((prev) => prev.filter((m) => !(m.role === "user" && m.content === text && m.kind === "text")));
        return;
      }
      setError(String((e as Error).message || e));
      setDraft(text);
      setMessages((prev) => prev.filter((m) => !(m.role === "user" && m.content === text && m.kind === "text")));
    } finally {
      if (id !== idRef.current) return;
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
      setSending(false);
      requestAnimationFrame(() => composerRef.current?.focus());
    }
  };

  const empty = !loading && !sending && messages.length === 0;

  return (
    <section className="llm-advice">
      <div className="llm-advice-head">
        <div>
          <div className="llm-advice-title">Vibe dialog</div>
          <div className="llm-advice-sub">
            Chat about {label}. Analyze fund posts a structured review; type in the box to follow up on the same
            conversation. Requires <code>OPENAI_API_KEY</code> or <code>ANTHROPIC_API_KEY</code> in <code>.env</code>.
          </div>
        </div>
        <button type="button" className="llm-btn" onClick={generate} disabled={busy || !ready}>
          {conversationId ? "New review" : "Analyze fund"}
        </button>
      </div>

      <div className="llm-dialog" role="region" aria-labelledby="vibe-dialog-title">
        <div className="llm-dialog-bar">
          <div>
            <div id="vibe-dialog-title" className="llm-dialog-title">
              {label} conversation
            </div>
            <div className="llm-dialog-sub">
              {conversationId
                ? `Conversation ${conversationId} · type below to follow up`
                : "Type below to start, or analyze the fund first"}
            </div>
          </div>
          {busy && (
            <div className="llm-dialog-actions">
              <button type="button" className="llm-btn llm-btn-stop" onClick={stop}>
                Stop
              </button>
            </div>
          )}
        </div>

        {error && <div className="err llm-err llm-err-dialog">{error}</div>}

        <div className="llm-thread" ref={threadRef}>
          {configured === false && (
            <div className="llm-empty">
              <div className="llm-empty-kicker">Not connected</div>
              <h3>Add an LLM key to use this dialog</h3>
              <p>
                Put one of these in the repo-root <code>.env</code>, then restart <code>./start.sh</code>. The box
                below is the chat — it stays on this paper fund.
              </p>
              <pre>
                OPENAI_API_KEY=sk-…
                # or
                ANTHROPIC_API_KEY=sk-ant-…
              </pre>
            </div>
          )}

          {configured !== false && !portfolioId && (
            <div className="llm-empty">
              <div className="llm-empty-kicker">No fund</div>
              <h3>Select a paper fund</h3>
              <p>Open a portfolio on the left, then ask about holdings, cash, or risk in this dialog.</p>
            </div>
          )}

          {ready && empty && (
            <div className="llm-empty">
              <div className="llm-empty-kicker">Ready</div>
              <h3>Ask about {label} here</h3>
              <p>
                This is a live Vibe-style review chat. Type under this thread, then Send. Analyze fund posts HOLD /
                ADD / TRIM / EXIT notes first; your next messages stay on that thread. Shares only — no options.
              </p>
              <div className="llm-starters">
                {STARTERS.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className="llm-chip"
                    disabled={busy}
                    onClick={() => (item.action === "generate" ? generate() : send(item.label))}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {loading && (
            <div className="llm-bubble assistant llm-bubble-status">
              Sending {label} holdings, Yahoo marks, and daily TA to the model. This can take a few seconds.
            </div>
          )}

          {messages.map((m, i) => {
            if (m.kind === "advice" && (m.advice || advice)) {
              const card = m.advice || advice!;
              return (
                <div key={`${m.role}-${i}`} className="llm-bubble assistant llm-bubble-advice">
                  <div className="llm-bubble-label">Review</div>
                  <AdviceCard
                    advice={card}
                    cashWeight={cashWeight}
                    topWeight={topWeight}
                    engine={engine}
                    onApply={onApply}
                  />
                </div>
              );
            }
            if (m.role === "user") {
              return (
                <div key={`${m.role}-${i}`} className="llm-bubble user">
                  <div className="llm-bubble-label">You</div>
                  <p>{m.content}</p>
                </div>
              );
            }
            return (
              <div key={`${m.role}-${i}`} className="llm-bubble assistant">
                <div className="llm-bubble-label">Vibe</div>
                <p>{m.content}</p>
              </div>
            );
          })}

          {sending && !loading && <div className="llm-bubble assistant llm-bubble-status">Thinking…</div>}
        </div>

        <form
          className="llm-compose"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <label className="llm-compose-label" htmlFor="vibe-compose-input">
            Message
          </label>
          <div className="llm-compose-row">
            <textarea
              id="vibe-compose-input"
              ref={composerRef}
              rows={3}
              value={draft}
              disabled={!ready || busy}
              placeholder={
                configured === false
                  ? "LLM key required before you can chat"
                  : !portfolioId
                    ? "Select a fund first"
                    : conversationId
                      ? `Reply about ${label} (same conversation)…`
                      : `Ask anything about ${label}…`
              }
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button type="submit" className="llm-btn" disabled={!ready || busy || !draft.trim()}>
              {conversationId ? "Send" : "Ask"}
            </button>
            {busy && (
              <button type="button" className="llm-btn llm-btn-stop" onClick={stop}>
                Stop
              </button>
            )}
          </div>
          <div className="llm-compose-hint">
            Enter to send · Shift+Enter for a new line
            {conversationId ? " · follow-ups reuse this conversation id" : " · first send starts a conversation"}
          </div>
        </form>
      </div>
    </section>
  );
}
