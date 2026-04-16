"use client";

import { useState } from "react";

interface CoachBriefingProps {
  date: string;
  summary: string;
  insight?: string;
}

export function CoachBriefing({ date, summary, insight }: CoachBriefingProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="border-t-2 border-foreground pt-3 mb-8">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex justify-between items-center w-full text-left"
      >
        <span className="font-mono text-[11px] text-muted">{date}</span>
        <span className="text-[11px] text-muted">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="mt-2">
          <p className="text-[14px] leading-[1.7] text-text-secondary">{summary}</p>

          {insight && (
            <div className="mt-3 p-[10px_14px] bg-insight-bg border border-insight-border rounded">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-accent-orange mb-1">
                Coach Insight
              </div>
              <p className="text-[13px] leading-[1.6] text-text-secondary">{insight}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
