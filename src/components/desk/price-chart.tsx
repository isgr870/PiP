import { Bar, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Bar as Candle } from "@/lib/fx/model";
import { formatPx, type PairId } from "@/lib/fx/research";

interface Point {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  span: [number, number];
}

function clock(minute: number): string {
  const dm = ((minute % 1440) + 1440) % 1440;
  const eat = (dm + 180) % 1440;
  const h = Math.floor(eat / 60);
  const m = eat % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function CandleShape(props: unknown) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = props as {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    payload?: Point;
  };
  if (!payload || height <= 0 || payload.h === payload.l) return <g />;
  const yOf = (price: number) => y + ((payload.h - price) / (payload.h - payload.l)) * height;
  const yOpen = yOf(payload.o);
  const yClose = yOf(payload.c);
  const up = payload.c >= payload.o;
  const color = up ? "var(--color-up)" : "var(--color-down)";
  const bodyTop = Math.min(yOpen, yClose);
  const bodyHeight = Math.max(Math.abs(yClose - yOpen), 1);
  const cx = x + width / 2;
  return (
    <g>
      <line x1={cx} x2={cx} y1={y} y2={y + height} stroke={color} strokeWidth={1} />
      <rect x={x + 1} y={bodyTop} width={Math.max(width - 2, 1)} height={bodyHeight} fill={color} />
    </g>
  );
}

export function PriceChart({ pair, bars }: { pair: PairId; bars: Candle[] }) {
  const data: Point[] = bars.slice(-64).map((bar) => ({
    t: bar.t,
    o: bar.o,
    h: bar.h,
    l: bar.l,
    c: bar.c,
    span: [bar.l, bar.h],
  }));
  const lows = data.map((d) => d.l);
  const highs = data.map((d) => d.h);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const pad = (max - min) * 0.12 || max * 0.0004;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <XAxis
          dataKey="t"
          tickFormatter={clock}
          tick={{ fill: "var(--color-subtle)", fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          minTickGap={28}
        />
        <YAxis
          domain={[min - pad, max + pad]}
          tickFormatter={(v: number) => formatPx(pair, v)}
          tick={{ fill: "var(--color-subtle)", fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={72}
        />
        <Tooltip
          cursor={{ stroke: "var(--color-border)" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const bar = payload[0]?.payload as Point | undefined;
            if (!bar) return null;
            return (
              <div className="rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm text-fg">
                <p>{formatPx(pair, bar.c)}</p>
                <p className="text-muted">{clock(bar.t)} EAT</p>
              </div>
            );
          }}
        />
        <Bar dataKey="span" shape={CandleShape} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function EquitySpark({ points }: { points: { t: number; v: number }[] }) {
  if (points.length < 2) return null;
  const up = points[points.length - 1].v >= points[0].v;
  return (
    <div className="h-16">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 6, right: 0, left: 0, bottom: 0 }}>
          <Line
            type="monotone"
            dataKey="v"
            stroke={up ? "var(--color-up)" : "var(--color-down)"}
            dot={false}
            strokeWidth={1.5}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
