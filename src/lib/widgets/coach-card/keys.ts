export const DATA_KEY = "coach_card:latest";

export interface CoachCardData {
  ts: string;
  endpoint: string;
  goalId: number | null;
  goalName: string | null;
  status: string;
}
