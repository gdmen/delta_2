/**
 * Minimal CSV serialization / parsing helpers.
 *
 * We don't need a full-featured library - our data is simple: strings,
 * numbers, nulls. Quote any field containing comma/quote/newline, escape
 * internal quotes by doubling them (RFC 4180).
 */

export type CsvValue = string | number | null | undefined;

export function serializeCsv(headers: readonly string[], rows: Iterable<readonly CsvValue[]>): string {
  const out: string[] = [headers.map(escapeField).join(",")];
  for (const row of rows) {
    out.push(row.map(escapeField).join(","));
  }
  return out.join("\n") + "\n";
}

function escapeField(v: CsvValue): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Parse a CSV string into { headers, rows }. Each row is an array of
 * strings; the caller is responsible for coercing to numbers / nulls /
 * dates. Blank cells come through as empty strings.
 */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ",") {
        cur.push(field);
        field = "";
        i++;
      } else if (ch === "\n" || ch === "\r") {
        cur.push(field);
        // Emit row if it has any content (skip blank trailing line).
        if (cur.length > 1 || cur[0] !== "") rows.push(cur);
        cur = [];
        field = "";
        // Handle \r\n as a single line break.
        if (ch === "\r" && text[i + 1] === "\n") i += 2;
        else i++;
      } else {
        field += ch;
        i++;
      }
    }
  }

  // Last field/row if file doesn't end with newline.
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    if (cur.length > 1 || cur[0] !== "") rows.push(cur);
  }

  const headers = rows.shift() ?? [];
  return { headers, rows };
}

/**
 * Produce a Map<header, index> for row access by column name.
 * Throws if any required header is missing.
 */
export function headerIndex(headers: string[], required: readonly string[] = []): Map<string, number> {
  const idx = new Map<string, number>();
  headers.forEach((h, i) => idx.set(h, i));
  for (const r of required) {
    if (!idx.has(r)) throw new Error(`CSV missing required column "${r}"`);
  }
  return idx;
}
