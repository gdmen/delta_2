import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseBodySpecPdf } from "./parse";

/**
 * Pinned regression test for the BodySpec DEXA PDF parser. The
 * `bodyspec-results-1.pdf` fixture lives at __fixtures__/ next to this
 * file (committed) so CI runs against the same bytes a fresh clone
 * does — the parser's regex extractors are picky about column spacing,
 * and any PDF text-layout drift in pdf-parse breaks the tests loudly.
 *
 * The numbers below are the values from the actual report (2016-02-25
 * scan), so a regression in any extractor surfaces on the matching
 * field.
 *
 * Older versions of this file pulled fixtures from the user's local
 * `~/Downloads/bodyspec/` and skipped the suite when absent. That made
 * CI silently green even when the parser broke — co-locating one PDF
 * in the repo turns the suite back on for everyone.
 */

const FIXTURE_PATH = join(__dirname, "__fixtures__", "bodyspec-results-1.pdf");

describe("parseBodySpecPdf", () => {
  it("parses the 2016 baseline PDF — every value matches the report", async () => {
    const buf = readFileSync(FIXTURE_PATH);
    const r = await parseBodySpecPdf(buf);
    expect(r.scan_date).toBe("2016-02-25");
    expect(r.height_in).toBe(70.0);
    // Summary
    expect(r.body_fat_pct).toBe(17.9);
    expect(r.body_weight_lb).toBe(166.3);
    expect(r.fat_mass_lb).toBe(29.8);
    expect(r.lean_mass_lb).toBe(130.1);
    expect(r.bone_mineral_content_lb).toBe(6.4);
    // Regional
    expect(r.arms_fat_pct).toBe(14.7);
    expect(r.arms_total_mass_lb).toBe(20.9);
    expect(r.arms_fat_mass_lb).toBe(3.1);
    expect(r.arms_lean_mass_lb).toBe(17.0);
    expect(r.arms_bmc_lb).toBe(0.9);
    expect(r.legs_fat_pct).toBe(17.7);
    expect(r.trunk_fat_pct).toBe(19.1);
    expect(r.android_fat_pct).toBe(19.0);
    expect(r.gynoid_fat_pct).toBe(20.1);
    // Supplemental
    expect(r.rmr_kcal).toBe(1632);
    expect(r.ag_ratio).toBe(0.94);
    // VAT
    expect(r.visceral_fat_lb).toBe(0.44);
    expect(r.vat_volume_in3).toBe(12.80);
    // Bone
    expect(r.head_bmd).toBe(2.098);
    expect(r.arms_bmd).toBe(1.042);
    expect(r.legs_bmd).toBe(1.481);
    expect(r.trunk_bmd).toBe(1.059);
    expect(r.ribs_bmd).toBe(0.882);
    expect(r.spine_bmd).toBe(1.052);
    expect(r.pelvis_bmd).toBe(1.209);
    expect(r.bone_mineral_density).toBe(1.325);
    expect(r.t_score).toBe(1.2);
    expect(r.z_score).toBeNull(); // shown as `-` in this report
  });
});
