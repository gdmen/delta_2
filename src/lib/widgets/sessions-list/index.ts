import { defineWidget } from "../types";
import { sessionsListSchema, type SessionsListConfig } from "./schema";
import { SessionsListComponent } from "./Component";

export const sessionsListWidget = defineWidget<SessionsListConfig>({
  type: "sessions_list",
  name: "Recent sessions",
  description: "Last few training events for a sport.",
  category: "session",
  defaultSize: { w: 6, h: 3 },
  minSize: { w: 4, h: 2 },
  schema: sessionsListSchema,
  defaultConfig: { sportFilter: null, limit: 10 },
  uiMeta: {
    sportFilter: {
      label: "Filter by sport",
      component: "sport-picker",
      helpText: "Show only sessions for one sport. Leave blank for all.",
    },
    limit: {
      label: "Limit",
      component: "number",
      helpText: "How many recent sessions to show (1-50).",
    },
  },
  Component: SessionsListComponent,
});
