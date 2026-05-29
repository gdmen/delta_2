/**
 * Server-fetched data the form pickers need. Threaded through the editor
 * so the metric/activity pickers don't each fire their own API call when
 * the settings drawer opens.
 */
export interface FormContext {
  metricTypes: Array<{ id: number; name: string; unit: string }>;
  activities: Array<{ id: number; name: string; color: string }>;
}
