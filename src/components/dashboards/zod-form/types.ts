/**
 * Server-fetched data the form pickers need. Threaded through the editor
 * so the metric/sport pickers don't each fire their own API call when
 * the settings drawer opens.
 */
export interface FormContext {
  metricTypes: Array<{ id: number; name: string; unit: string }>;
  sports: Array<{ id: number; name: string; color: string }>;
}
