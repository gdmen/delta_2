export const SPORT_COLORS: Record<string, string> = {
  powerlifting: "#2563eb",
  bjj: "#db2777",
  running: "#059669",
  hiking: "#7c3aed",
  biking: "#d97706",
};

export function sportColor(name: string): string {
  return SPORT_COLORS[name.toLowerCase()] ?? "#a3a3a3";
}
