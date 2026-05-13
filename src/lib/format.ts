/**
 * "YYYY-MM-DD HH:MM" rendering of an ISO timestamp in the local timezone.
 * Non-ISO input falls back to a best-effort slice so table cells never
 * show a blank or "Invalid Date".
 */
export function formatShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace("T", " ");
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

/**
 * Convert a UTC ISO timestamp to the `YYYY-MM-DDTHH:MM` shape
 * `<input type="datetime-local">` expects, expressed in the browser's
 * local timezone.
 *
 * The naive `iso.slice(0, 16)` shows UTC clock numbers labeled as
 * local, which then double-rolls on save (every PATCH shifts the
 * stored time by the user's TZ offset). Use this instead anywhere
 * you initialize a `datetime-local` input from a stored ISO.
 */
export function utcIsoToLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
