"use client";

import { useState, useEffect } from "react";
import { CoachBriefing } from "@/components/coach-briefing";

interface BriefingResponse {
  cached?: boolean;
  generated?: boolean;
  summary?: string;
  insight?: string;
  createdAt?: string;
  reason?: string;
  message?: string;
}

export default function CoachPage() {
  const [briefing, setBriefing] = useState<BriefingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    fetch("/api/coach/briefing")
      .then((r) => r.json())
      .then((data) => {
        setBriefing(data);
        setLoading(false);
      });
  }, []);

  async function handleGenerate() {
    setGenerating(true);
    const res = await fetch("/api/coach/briefing", { method: "POST" });
    const data = await res.json();
    setBriefing(data);
    setGenerating(false);
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold mb-6">Coach Briefing</h1>

      {loading && <p className="text-muted">Loading...</p>}

      {!loading && briefing && (briefing.cached || briefing.generated) && briefing.summary && (
        <CoachBriefing
          date={(briefing.createdAt ?? "").slice(0, 10) || "today"}
          summary={briefing.summary}
          insight={briefing.insight || undefined}
        />
      )}

      {!loading && briefing && !briefing.cached && !briefing.generated && (
        <div>
          <p className="text-[0.875rem] text-muted mb-4">
            {briefing.message ?? "No briefing yet today."}
          </p>
          {briefing.reason !== "no_data" && (
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="px-6 py-2.5 bg-foreground text-background text-[0.875rem] font-medium rounded hover:opacity-90 disabled:opacity-50"
            >
              {generating ? "Generating..." : "Generate Briefing"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
