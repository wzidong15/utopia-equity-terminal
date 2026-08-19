import { useEffect, useRef } from "react";
import { ColorType, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import type { PortfolioSnapshot } from "./portfolio";

export default function NavChart({ snapshots }: { snapshots: PortfolioSnapshot[] }) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Line"> | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const c = createChart(host.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#656d76",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      },
      grid: {
        vertLines: { color: "#eaeef2" },
        horzLines: { color: "#eaeef2" },
      },
      rightPriceScale: { borderColor: "#d0d7de" },
      timeScale: { borderColor: "#d0d7de", timeVisible: true },
    });
    const line = c.addLineSeries({ color: "#0969da", lineWidth: 2 });
    chart.current = c;
    series.current = line;
    const ro = new ResizeObserver(() => {
      if (!host.current) return;
      c.applyOptions({ width: host.current.clientWidth, height: host.current.clientHeight });
    });
    ro.observe(host.current);
    return () => {
      ro.disconnect();
      c.remove();
      chart.current = null;
      series.current = null;
    };
  }, []);

  useEffect(() => {
    if (!series.current) return;
    const byTime = new Map<number, number>();
    for (const s of snapshots) {
      if (s.nav == null || !s.t) continue;
      byTime.set(s.t, s.nav);
    }
    const rows = [...byTime.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([t, nav]) => ({ t, nav }));
    const data =
      rows.length === 1
        ? [
            { time: (rows[0].t - 60) as UTCTimestamp, value: rows[0].nav },
            { time: rows[0].t as UTCTimestamp, value: rows[0].nav },
          ]
        : rows.map((s) => ({ time: s.t as UTCTimestamp, value: s.nav }));
    series.current.setData(data);
    chart.current?.timeScale().fitContent();
  }, [snapshots]);

  return <div className="chart nav-chart" ref={host} />;
}
