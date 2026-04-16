# TODOS

## P2: Meet Countdown / War Room View
**What:** Dedicated `/meet-prep` view aggregating all powerlifting goals with required-rate vs actual-rate, days remaining, weight class tracking, peaking phase awareness, and coach readiness summary.
**Why:** The powerlifting meet is the primary forcing function for the project. A dedicated view makes the app feel purpose-built for meet prep rather than generic fitness tracking.
**When:** Build when the meet is ~3 months away. The home dashboard goal bars cover the basics until then.
**Effort:** S-M (human: ~6h / CC: ~30-45 min)
**Depends on:** Dashboard views, goal calculation, coach integration all working.

## P2: Focus Retrospective / Cross-Focus Comparison
**What:** When opening a new focus, include prior completed focuses with similar sport + metric links as context for the coach. When closing a focus, generate a comparison to prior focuses on the same topic.
**Why:** Enables compounding: each focus teaches the coach about the user's patterns. "Your last bench campaign: 8 weeks, +20lb, 85% protein compliance. This time: 6 weeks, +25lb, 90% compliance."
**When:** Build after 2+ completed focuses exist. The feature has no value with 0-1 completed focuses.
**Effort:** S (human: ~3h / CC: ~20 min)
**Depends on:** Focus lifecycle working, coach context assembly.

## P3: BJJ Belt Progress Tracker
**What:** Dedicated BJJ view with total mat hours by category (class/open_mat/drilling/teaching), monthly training volume trend, focus history timeline, and time-at-current-belt tracking.
**Why:** BJJ belts take years. A long-term progression view provides the same motivation as powerlifting PR curves but on a multi-year timescale.
**When:** Build when BJJ-specific visualization needs become clear through daily use.
**Effort:** S (human: ~3h / CC: ~20 min)
**Depends on:** Events table populated with BJJ data, Sport Detail view working.

## P3: Alert-Driven Drift Notifications
**What:** Proactive notifications when metrics drift beyond thresholds. "Your sleep dropped 20% this week, expect your lifts to suffer Thursday." Requires: threshold definitions per metric, notification storage, suppression logic (don't alert every day for same issue), and a delivery mechanism (in-app banner or push).
**Why:** The coach currently only speaks when asked (chat) or on schedule (briefing/review). Alert-driven mode catches issues in real-time.
**When:** Post-month-1. Requires understanding which thresholds matter through actual usage first.
**Effort:** M (human: ~1 week / CC: ~45 min)
**Depends on:** Pre-aggregation layer, coach engine, sufficient data history to define meaningful thresholds.
