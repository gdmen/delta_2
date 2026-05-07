import Link from "next/link";
import { Sparkline } from "./sparkline";

interface FocusCardProps {
  name: string;
  sportColor: string;
  weekNumber: number;
  sparklineData: number[];
  valueLabel: string;
  href?: string;
}

export function FocusCard({ name, sportColor, weekNumber, sparklineData, valueLabel, href }: FocusCardProps) {
  const inner = (
    <>
      <div className="flex items-center gap-3 min-w-0">
        <span
          className="w-[6px] h-[6px] rounded-full flex-shrink-0"
          style={{ backgroundColor: sportColor }}
        />
        <div className="min-w-0">
          <span className="text-[0.875rem] font-medium">{name}</span>
          <span className="font-mono text-[0.6875rem] text-muted ml-2 whitespace-nowrap">Week {weekNumber}</span>
        </div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="hidden sm:block">
          <Sparkline data={sparklineData} color={sportColor} />
        </div>
        <span className="font-mono text-[0.8125rem] text-text-secondary whitespace-nowrap">{valueLabel}</span>
      </div>
    </>
  );

  const baseClass = "flex justify-between items-center gap-3 py-2 border-b border-surface last:border-b-0";

  if (href) {
    return (
      <Link href={href} className={`${baseClass} -mx-2 px-2 rounded hover:bg-surface/40`}>
        {inner}
      </Link>
    );
  }

  return <div className={baseClass}>{inner}</div>;
}
