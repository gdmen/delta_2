// Map Strava activity types to Delta's sport + event type.
// Strava's `sport_type` is newer/more specific than `type`; prefer it when present.
//
// Anything not listed here is intentionally skipped - WeightTraining overlaps
// with TeamBuildr, and Swim/Yoga/etc. aren't sports Delta tracks.

const MAPPING: Record<string, { sport: string; type: string }> = {
  // Running
  Run: { sport: "running", type: "run" },
  TrailRun: { sport: "running", type: "trail_run" },
  VirtualRun: { sport: "running", type: "virtual_run" },

  // Cycling
  Ride: { sport: "biking", type: "ride" },
  VirtualRide: { sport: "biking", type: "virtual_ride" },
  EBikeRide: { sport: "biking", type: "ebike" },
  MountainBikeRide: { sport: "biking", type: "mtb" },
  GravelRide: { sport: "biking", type: "gravel" },

  // Hiking
  Hike: { sport: "hiking", type: "hike" },
  Walk: { sport: "hiking", type: "walk" },
};

export function mapStravaType(type: string, sportType?: string | null): { sport: string; type: string } | null {
  return MAPPING[sportType ?? ""] ?? MAPPING[type] ?? null;
}

export function isMappedType(type: string, sportType?: string | null): boolean {
  return mapStravaType(type, sportType) !== null;
}
