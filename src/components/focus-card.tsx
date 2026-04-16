import { Sparkline } from "./sparkline";

interface FocusCardProps {
  name: string;
  sport: string;
  sportColor: string;
  weekNumber: number;
  sparklineData: number[];
  valueLabel: string;
}

export function FocusCard({ name, sport, sportColor, weekNumber, sparklineData, valueLabel }: FocusCardProps) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-surface last:border-b-0">
      <div className="flex items-center gap-3">
        <span
          className="w-[6px] h-[6px] rounded-full flex-shrink-0"
          style={{ backgroundColor: sportColor }}
        />
        <div>
          <span className="text-[14px] font-medium">{name}</span>
          <span className="font-mono text-[11px] text-muted ml-2">Week {weekNumber}</span>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <Sparkline data={sparklineData} color={sportColor} />
        <span className="font-mono text-[13px] text-text-secondary">{valueLabel}</span>
      </div>
    </div>
  );
}
