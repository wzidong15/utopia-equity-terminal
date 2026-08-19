export type MarketSession = "pre" | "rth" | "post" | "closed";

export type MarketClock = {
  session: MarketSession;
  label: string;
  hours: string;
  timeEt: string;
};

const ET = "America/New_York";

const LABELS: Record<MarketSession, string> = {
  pre: "Pre-market",
  rth: "Open market",
  post: "Post-market",
  closed: "Closed",
};

const HOURS: Record<MarketSession, string> = {
  pre: "4:00–9:30 AM ET",
  rth: "9:30 AM–4:00 PM ET",
  post: "4:00–8:00 PM ET",
  closed: "8:00 PM–4:00 AM ET",
};

function parts(now: Date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    hourCycle: "h12",
  });
  const bag: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) {
    if (p.type !== "literal") bag[p.type] = p.value;
  }
  const hour = Number(bag.hour);
  const minute = Number(bag.minute);
  const second = Number(bag.second);
  const day = bag.weekday;
  const isPm = (bag.dayPeriod || "").toLowerCase().startsWith("p");
  let hour24 = hour % 12;
  if (isPm) hour24 += 12;
  if (!isPm && hour === 12) hour24 = 0;
  return { hour24, minute, second, day, hour, dayPeriod: bag.dayPeriod || "" };
}

export function marketClock(now = new Date()): MarketClock {
  const p = parts(now);
  const weekend = p.day === "Sat" || p.day === "Sun";
  const mins = p.hour24 * 60 + p.minute;
  let session: MarketSession = "closed";
  if (!weekend) {
    if (mins >= 4 * 60 && mins < 9 * 60 + 30) session = "pre";
    else if (mins >= 9 * 60 + 30 && mins < 16 * 60) session = "rth";
    else if (mins >= 16 * 60 && mins < 20 * 60) session = "post";
  }
  const timeEt = `${p.day} ${p.hour}:${String(p.minute).padStart(2, "0")}:${String(p.second).padStart(2, "0")} ${p.dayPeriod} ET`;
  return {
    session,
    label: LABELS[session],
    hours: weekend ? "Weekend" : HOURS[session],
    timeEt,
  };
}

export function sessionTitle(session?: string | null): string | null {
  if (!session) return null;
  if (session === "pre") return "Pre-market";
  if (session === "post") return "Post-market";
  if (session === "rth") return "Open market";
  if (session === "closed") return "Closed";
  return session;
}
