// pdf-parse@1.1.1's index.js has a debug guard (`!module.parent`) that
// fires under modern bundlers / vitest / Next, attempting to read a
// fixture PDF from `./test/data/`. Importing the lib file directly
// skips the guard. Behavior is identical otherwise.
import pdf from "pdf-parse/lib/pdf-parse.js";

/**
 * Programmatic BodySpec DEXA PDF parser. Replaces the previous
 * Claude-API-based extractor.
 *
 * Strategy:
 *   1. Extract the full document as text via pdf-parse (one big string).
 *   2. Slice into section blobs using header markers ("SUMMARY RESULTS",
 *      "REGIONAL ASSESSMENT", "SUPPLEMENTAL RESULTS", "BONE REPORT",
 *      "MUSCLE BALANCE REPORT"). Trend-tab pages 3-6 carry no new info
 *      so they're ignored.
 *   3. Run a section-specific regex to pull values. Newer reports show
 *      the current scan + baselines stacked vertically — we always take
 *      the FIRST match in each section, which is the current reading.
 *
 * Layout quirks we handle:
 *   - Numbers in tables run together: `Arms14.7%20.93.117.00.9`. We
 *     match each value as `\d+\.\d+` (one+ decimal places); since every
 *     BodySpec value has exactly one decimal place, greedy matching of
 *     `\d+\.\d` works without ambiguity.
 *   - Dates: both `02/25/2016` (zero-padded) and `7/24/2019` (single
 *     digit) appear. Handle with `\d{1,2}/\d{1,2}/\d{4}`.
 *   - `(e)` extrapolation markers prefix some BMD rows in the 2023+
 *     template. Strip before matching.
 *   - Header line repeats on every page; we read demographics from the
 *     first occurrence only.
 *
 * Every field returns null when not found in the report — older scans
 * sometimes lack a section. Fail-soft is right here; the user reviews
 * everything in the UI before saving and can fill blanks by hand.
 */

export interface Extracted {
  // Header demographics (height comes from a constant on the report; we
  // still read it so it can be saved as a metric for cross-source checks).
  height_in: number | null;
  scan_date: string | null; // YYYY-MM-DD

  // Group A — total composition + supplemental
  body_weight_lb: number | null;
  body_fat_pct: number | null;
  lean_mass_lb: number | null;
  fat_mass_lb: number | null;
  bone_mineral_content_lb: number | null;
  bone_mineral_density: number | null; // total BMD g/cm²
  visceral_fat_lb: number | null;
  vat_volume_in3: number | null;
  t_score: number | null;
  z_score: number | null;
  rmr_kcal: number | null;
  ag_ratio: number | null;

  // Group B — regional 5x5
  arms_fat_pct: number | null;
  arms_total_mass_lb: number | null;
  arms_fat_mass_lb: number | null;
  arms_lean_mass_lb: number | null;
  arms_bmc_lb: number | null;
  legs_fat_pct: number | null;
  legs_total_mass_lb: number | null;
  legs_fat_mass_lb: number | null;
  legs_lean_mass_lb: number | null;
  legs_bmc_lb: number | null;
  trunk_fat_pct: number | null;
  trunk_total_mass_lb: number | null;
  trunk_fat_mass_lb: number | null;
  trunk_lean_mass_lb: number | null;
  trunk_bmc_lb: number | null;
  android_fat_pct: number | null;
  android_total_mass_lb: number | null;
  android_fat_mass_lb: number | null;
  android_lean_mass_lb: number | null;
  android_bmc_lb: number | null;
  gynoid_fat_pct: number | null;
  gynoid_total_mass_lb: number | null;
  gynoid_fat_mass_lb: number | null;
  gynoid_lean_mass_lb: number | null;
  gynoid_bmc_lb: number | null;

  // Group C — per-region BMD (g/cm²)
  head_bmd: number | null;
  arms_bmd: number | null;
  legs_bmd: number | null;
  trunk_bmd: number | null;
  ribs_bmd: number | null;
  spine_bmd: number | null;
  pelvis_bmd: number | null;

  // Group D — muscle balance (lb)
  right_arm_lean_mass_lb: number | null;
  right_arm_fat_mass_lb: number | null;
  left_arm_lean_mass_lb: number | null;
  left_arm_fat_mass_lb: number | null;
  right_leg_lean_mass_lb: number | null;
  right_leg_fat_mass_lb: number | null;
  left_leg_lean_mass_lb: number | null;
  left_leg_fat_mass_lb: number | null;
}

const NULL_EXTRACTED = (): Extracted => ({
  height_in: null,
  scan_date: null,
  body_weight_lb: null,
  body_fat_pct: null,
  lean_mass_lb: null,
  fat_mass_lb: null,
  bone_mineral_content_lb: null,
  bone_mineral_density: null,
  visceral_fat_lb: null,
  vat_volume_in3: null,
  t_score: null,
  z_score: null,
  rmr_kcal: null,
  ag_ratio: null,
  arms_fat_pct: null,
  arms_total_mass_lb: null,
  arms_fat_mass_lb: null,
  arms_lean_mass_lb: null,
  arms_bmc_lb: null,
  legs_fat_pct: null,
  legs_total_mass_lb: null,
  legs_fat_mass_lb: null,
  legs_lean_mass_lb: null,
  legs_bmc_lb: null,
  trunk_fat_pct: null,
  trunk_total_mass_lb: null,
  trunk_fat_mass_lb: null,
  trunk_lean_mass_lb: null,
  trunk_bmc_lb: null,
  android_fat_pct: null,
  android_total_mass_lb: null,
  android_fat_mass_lb: null,
  android_lean_mass_lb: null,
  android_bmc_lb: null,
  gynoid_fat_pct: null,
  gynoid_total_mass_lb: null,
  gynoid_fat_mass_lb: null,
  gynoid_lean_mass_lb: null,
  gynoid_bmc_lb: null,
  head_bmd: null,
  arms_bmd: null,
  legs_bmd: null,
  trunk_bmd: null,
  ribs_bmd: null,
  spine_bmd: null,
  pelvis_bmd: null,
  right_arm_lean_mass_lb: null,
  right_arm_fat_mass_lb: null,
  left_arm_lean_mass_lb: null,
  left_arm_fat_mass_lb: null,
  right_leg_lean_mass_lb: null,
  right_leg_fat_mass_lb: null,
  left_leg_lean_mass_lb: null,
  left_leg_fat_mass_lb: null,
});

export async function parseBodySpecPdf(buffer: Buffer): Promise<Extracted> {
  const data = await pdf(buffer);
  return parseBodySpecText(data.text);
}

/** Exposed separately so unit tests can feed in extracted text directly
 * without re-running pdf-parse on every fixture. */
export function parseBodySpecText(text: string): Extracted {
  const out = NULL_EXTRACTED();

  // Header: scan date + height. The first occurrence of the demographics
  // line carries the current scan date — every page repeats it but the
  // first one is what we want.
  // Pattern e.g.
  //   Menezes, GaryMale(not specified)2/1/199170.0 in.165.0 lbs.7/24/2019
  // Capture: <height> in.<weight> lbs.<date>
  // Height is constrained to 2 digits before the decimal so a regex
  // doesn't accidentally swallow the trailing digits of the birth year
  // (`1991` running into `70.0` reads as `199170.0` without the bound).
  const headerMatch = text.match(
    /(\d{2}\.\d+)\s*in\.(\d+\.\d+)\s*lbs?\.(\d{1,2}\/\d{1,2}\/\d{4})/,
  );
  if (headerMatch) {
    out.height_in = parseFloat(headerMatch[1]);
    out.scan_date = mmddyyyyToIso(headerMatch[3]);
  }

  // -- SUMMARY RESULTS ------------------------------------------------------
  // The summary table reads, on a single line in the extracted text:
  //   <date><pct>%<mass><fat><lean>
  // and BMC sometimes wraps to its own line. Several scans newer than the
  // first add a baseline row immediately below. We anchor on the first
  // date we see in this block, which is always the current scan.
  // Each value carries exactly one decimal place — restrict to `\d+\.\d`
  // (single fractional digit) so values that run together don't get
  // greedy-merged (e.g., `154.722.9` should split as `154.7` + `22.9`,
  // not `154.72` + `2.9`).
  const summary = sliceBetween(text, "SUMMARY RESULTS", "REGIONAL ASSESSMENT");
  if (summary) {
    const m = summary.match(
      /\d{1,2}\/\d{1,2}\/\d{4}(\d+\.\d)%(\d+\.\d)(\d+\.\d)(\d+\.\d)\s*\n?\s*(\d+\.\d)?/,
    );
    if (m) {
      out.body_fat_pct = parseFloat(m[1]);
      out.body_weight_lb = parseFloat(m[2]);
      out.fat_mass_lb = parseFloat(m[3]);
      out.lean_mass_lb = parseFloat(m[4]);
      if (m[5]) out.bone_mineral_content_lb = parseFloat(m[5]);
    }
  }

  // -- REGIONAL ASSESSMENT --------------------------------------------------
  // Each region row: `Arms14.7%20.93.117.00.9` → fat%, total, fat, lean, BMC.
  // Single-decimal across the row (same constraint as the summary table).
  const regional = sliceBetween(text, "REGIONAL ASSESSMENT", "SUPPLEMENTAL RESULTS");
  if (regional) {
    for (const region of ["Arms", "Legs", "Trunk", "Android", "Gynoid"] as const) {
      const m = regional.match(
        new RegExp(`${region}(\\d+\\.\\d)%(\\d+\\.\\d)(\\d+\\.\\d)(\\d+\\.\\d)(\\d+\\.\\d)`),
      );
      if (m) {
        const key = region.toLowerCase() as Lowercase<typeof region>;
        out[`${key}_fat_pct`] = parseFloat(m[1]);
        out[`${key}_total_mass_lb`] = parseFloat(m[2]);
        out[`${key}_fat_mass_lb`] = parseFloat(m[3]);
        out[`${key}_lean_mass_lb`] = parseFloat(m[4]);
        out[`${key}_bmc_lb`] = parseFloat(m[5]);
      }
    }
  }

  // -- SUPPLEMENTAL RESULTS -------------------------------------------------
  // Layout (current scan is the first block of values):
  //   1,643 cal/day14.0%16.0%
  //   0.87
  // OR on older reports the A/G ratio sits inline:
  //   1,632 cal/day19.0%20.1%0.94
  // RMR may be comma-separated thousand digits.
  const supplemental = sliceBetween(text, "SUPPLEMENTAL RESULTS", "VATBONE REPORT");
  if (supplemental) {
    // Android % / Gynoid % are single-decimal; A/G ratio is 1 or 2
    // decimals (older reports show `0.94`, newer ones `0.7`).
    const m = supplemental.match(
      /(\d{1,3}(?:,\d{3})*)\s*cal\/day\s*(\d+\.\d)%\s*(\d+\.\d)%\s*\n?\s*(\d+\.\d{1,2})/,
    );
    if (m) {
      out.rmr_kcal = parseInt(m[1].replace(/,/g, ""), 10);
      out.android_fat_pct ??= parseFloat(m[2]); // fall through to regional if not yet set
      out.gynoid_fat_pct ??= parseFloat(m[3]);
      out.ag_ratio = parseFloat(m[4]);
    }
  }

  // -- VAT (visceral adipose tissue) ----------------------------------------
  // Within the BONE REPORT block, the VAT panel sits to the left:
  //   Mass (lbs)0.44     OR over multiple lines    Mass (lbs)0.45
  //   Volume (in 3 )12.80                          0.49
  //                                                ...
  //                                                Volume (in
  //                                                3
  //                                                )
  //                                                15.52
  //                                                ...
  // Take the FIRST numeric after the labels in each case.
  const vatBlock = sliceBetween(text, "VATBONE REPORT", "Z-Score");
  if (vatBlock) {
    const massMatch = vatBlock.match(/Mass\s*\(lbs?\)\s*(\d+\.\d+)/);
    if (massMatch) out.visceral_fat_lb = parseFloat(massMatch[1]);
    const volMatch = vatBlock.match(/Volume\s*\(\s*in\s*[³3]?\s*\)?\s*(\d+\.\d+)/);
    if (volMatch) out.vat_volume_in3 = parseFloat(volMatch[1]);
  }

  // -- BONE REPORT ----------------------------------------------------------
  // Per-region BMD: `Head2.098`, `Arms1.042`, etc. Some 2023+ reports
  // prefix `(e)` on a row to mark extrapolation — strip it before matching.
  // Total carries T-Score and Z-Score: `Total1.325\n1.2-` or `Total1.371\n1.71.7`.
  const boneBlock = sliceBetween(text, "BONE REPORT", "MUSCLE BALANCE REPORT") ?? "";
  const cleanBone = boneBlock.replace(/\(e\)/g, "");
  for (const region of ["Head", "Arms", "Legs", "Trunk", "Ribs", "Spine", "Pelvis"] as const) {
    const m = cleanBone.match(new RegExp(`${region}\\s*(\\d+\\.\\d+)\\s*[-\\d]`));
    if (m) {
      const key = region.toLowerCase() as Lowercase<typeof region>;
      out[`${key}_bmd`] = parseFloat(m[1]);
    }
  }
  const totalBmd = cleanBone.match(/Total\s*(\d+\.\d+)\s*\n?\s*(\d+\.\d+|[-])\s*(\d+\.\d+|[-])/);
  if (totalBmd) {
    out.bone_mineral_density = parseFloat(totalBmd[1]);
    if (totalBmd[2] !== "-") out.t_score = parseFloat(totalBmd[2]);
    if (totalBmd[3] !== "-") out.z_score = parseFloat(totalBmd[3]);
  }

  // -- MUSCLE BALANCE REPORT ------------------------------------------------
  // Each row, e.g.:
  //   Right Arm
  //   12.310.91.39.10.5
  // Columns: % Fat, Total Mass, Fat Mass, Lean Mass, BMC.
  // We only persist fat/lean per side (totals + %fat are derivable).
  // Section ends mid-document; bound by the next page-break line that
  // begins with "REGIONAL FAT TISSUE REPORT" or end of string.
  const muscle =
    sliceBetween(text, "MUSCLE BALANCE REPORT", "REGIONAL FAT TISSUE REPORT") ?? "";
  for (const side of ["Right Arm", "Left Arm", "Right Leg", "Left Leg"] as const) {
    // Single decimal across the row.
    const m = muscle.match(
      new RegExp(`${side}\\s*\\n?\\s*(\\d+\\.\\d)(\\d+\\.\\d)(\\d+\\.\\d)(\\d+\\.\\d)(\\d+\\.\\d)`),
    );
    if (m) {
      const key = side.toLowerCase().replace(" ", "_") as
        | "right_arm"
        | "left_arm"
        | "right_leg"
        | "left_leg";
      out[`${key}_fat_mass_lb`] = parseFloat(m[3]);
      out[`${key}_lean_mass_lb`] = parseFloat(m[4]);
    }
  }

  return out;
}

// --- helpers ----------------------------------------------------------------

/** Slice text from the first `start` marker (inclusive) up to the first
 * `end` marker (exclusive) found AFTER `start`. Returns null if either is
 * missing. */
function sliceBetween(text: string, start: string, end: string): string | null {
  const i = text.indexOf(start);
  if (i < 0) return null;
  const j = text.indexOf(end, i + start.length);
  return text.slice(i, j < 0 ? text.length : j);
}

/** "MM/DD/YYYY" or "M/D/YYYY" → "YYYY-MM-DD". Returns null on malformed. */
function mmddyyyyToIso(s: string): string | null {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const mm = m[1].padStart(2, "0");
  const dd = m[2].padStart(2, "0");
  return `${m[3]}-${mm}-${dd}`;
}
