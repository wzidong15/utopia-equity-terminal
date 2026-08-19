export type MarketSession = "pre" | "rth" | "post" | "closed";

export type MarketClock = {
  session: MarketSession;
  label: string;
  hours: string;
  timeEt: string;
  weekday: string;
  until: string;
};

const ET = "America/New_York";

const LABELS: Record<MarketSession, string> = {
  pre: "Pre-market",
  rth: "Market open",
  post: "After hours",
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

function formatUntil(totalMins: number): string {
  const mins = Math.max(0, Math.floor(totalMins));
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const minutes = mins % 60;
  if (days > 0) return hours ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
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
  let until = "";
  if (weekend) {
    const daysUntilMon = p.day === "Sun" ? 1 : 2;
    until = `Pre-market in ${formatUntil(daysUntilMon * 1440 - mins + 4 * 60)}`;
  } else if (session === "pre") {
    until = `Opens in ${formatUntil(9 * 60 + 30 - mins)}`;
  } else if (session === "rth") {
    until = `Closes in ${formatUntil(16 * 60 - mins)}`;
  } else if (session === "post") {
    until = `Ends in ${formatUntil(20 * 60 - mins)}`;
  } else {
    const toPre = mins < 4 * 60 ? 4 * 60 - mins : 24 * 60 - mins + 4 * 60;
    until = `Pre-market in ${formatUntil(toPre)}`;
  }
  const hh = String(p.hour);
  const mm = String(p.minute).padStart(2, "0");
  const ss = String(p.second).padStart(2, "0");
  const timeEt = `${hh}:${mm}:${ss} ${p.dayPeriod} ET`;
  return {
    session,
    label: LABELS[session],
    hours: weekend ? "Weekend" : HOURS[session],
    timeEt,
    weekday: p.day,
    until,
  };
}

export function sessionTitle(session?: string | null): string | null {
  if (!session) return null;
  if (session === "pre") return "Pre-market";
  if (session === "post") return "After hours";
  if (session === "rth") return "Market open";
  if (session === "closed") return "Closed";
  return session;
}
