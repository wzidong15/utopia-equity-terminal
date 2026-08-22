import { fmtNewsTime } from "./format";
import type { NewsItem } from "./types";

function kindLabel(kind?: string | null) {
  if (kind === "blackswan") return "Alert";
  if (kind === "breaking") return "Breaking";
  return null;
}

export default function NewsFeed({
  items,
  empty,
  variant = "stack",
  hint,
}: {
  items: NewsItem[];
  empty: string;
  variant?: "stack" | "tape";
  hint?: string;
}) {
  if (variant === "tape") {
    const hot = items.some((n) => n.kind === "blackswan" || n.kind === "breaking");
    return (
      <div className={`news-tape${hot ? " hot" : ""}`} role="region" aria-label="Market news">
        <div className="news-tape-k">
          Market News
          {hint && <span className="muted">{hint}</span>}
        </div>
        <div className="news-tape-track">
          {items.length === 0 && <span className="news-tape-empty">{empty}</span>}
          {items.map((n, i) => {
            const label = kindLabel(n.kind);
            return (
              <a
                key={`${n.url || n.title}-${i}`}
                href={n.url || "#"}
                target="_blank"
                rel="noreferrer"
                className={n.kind === "blackswan" ? "news-alert" : n.kind === "breaking" ? "news-breaking" : undefined}
                title={n.title}
              >
                <div className="news-tape-line">
                  {label && <span className={`news-tag ${n.kind}`}>{label}</span>}
                  <span className="news-tape-title">{n.title}</span>
                </div>
                <div className="src">
                  {n.publisher || "Yahoo"}
                  {n.published != null && n.published !== "" ? ` · ${fmtNewsTime(n.published)}` : ""}
                </div>
              </a>
            );
          })}
        </div>
      </div>
    );
  }
  if (!items.length) {
    return <div className="watch-empty">{empty}</div>;
  }
  return (
    <div className="news">
      {items.map((n, i) => {
        const label = kindLabel(n.kind);
        return (
          <a
            key={`${n.url || n.title}-${i}`}
            href={n.url || "#"}
            target="_blank"
            rel="noreferrer"
            className={n.kind === "blackswan" ? "news-alert" : n.kind === "breaking" ? "news-breaking" : undefined}
          >
            <div className="news-title">
              {label && <span className={`news-tag ${n.kind}`}>{label}</span>}
              {n.title}
            </div>
            <div className="src">
              {n.publisher || "Yahoo"}
              {n.published != null && n.published !== "" ? ` · ${fmtNewsTime(n.published)}` : ""}
            </div>
          </a>
        );
      })}
    </div>
  );
}
