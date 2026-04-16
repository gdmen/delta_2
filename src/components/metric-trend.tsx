"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from "recharts";

interface Sample {
  date: string;
  value: number;
}

export function MetricTrend({
  samples,
  unit,
  target,
  color = "#171717",
  height = 220,
}: {
  samples: Sample[];
  unit: string;
  target?: number;
  color?: string;
  height?: number;
}) {
  if (samples.length === 0) {
    return (
      <div
        className="border border-border rounded flex items-center justify-center text-[0.875rem] text-muted"
        style={{ height }}
      >
        No data yet
      </div>
    );
  }

  const data = samples.map((s) => ({
    date: s.date.slice(5, 10), // MM-DD
    value: s.value,
  }));

  return (
    <div style={{ height, width: "100%" }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid stroke="#f5f5f5" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "#a3a3a3", fontFamily: "JetBrains Mono" }}
            axisLine={{ stroke: "#e5e5e5" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#a3a3a3", fontFamily: "JetBrains Mono" }}
            axisLine={false}
            tickLine={false}
            domain={["dataMin - 1", "dataMax + 1"]}
            tickFormatter={(v: number) => v.toFixed(0)}
          />
          <Tooltip
            contentStyle={{
              background: "#fff",
              border: "1px solid #e5e5e5",
              borderRadius: 4,
              fontSize: 12,
              fontFamily: "JetBrains Mono, monospace",
            }}
            formatter={(v) => [`${typeof v === "number" ? v.toFixed(1) : v} ${unit}`, ""]}
          />
          {target !== undefined && (
            <ReferenceLine y={target} stroke="#f97316" strokeDasharray="3 3" />
          )}
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            dot={{ r: 2, fill: color }}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
