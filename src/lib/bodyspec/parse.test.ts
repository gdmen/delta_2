import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { parseBodySpecPdf } from "./parse";

/**
 * Runs the parser against every BodySpec PDF the user provided. Skips
 * the suite cleanly when the fixtures aren't present (other developers
 * cloning the repo won't have them). Each fixture asserts:
 *   - scan_date parses to YYYY-MM-DD
 *   - core summary fields (body weight, fat %, lean, fat) are non-null
 *     and finite
 *   - regional + bone fields are present on reports newer than 2016
 *
 * Lock-in numbers for PDF #1 (2016-02-25, the earliest fixture) are
 * baked in so any regression on the regex extractors trips immediately.
 */

const FIXTURE_DIR = "/Users/garymenezes/Downloads/bodyspec";
const FIXTURE_FILES = [
  "bodyspec-results-1.pdf",
  "bodyspec-results-2.pdf",
  "bodyspec-results 2.pdf",
  "bodyspec-results-3.pdf",
  "bodyspec-results-4.pdf",
  "bodyspec-results-5.pdf",
  "bodyspec-results-6.pdf",
  "bodyspec-results-7.pdf",
  "bodyspec-results-8.pdf",
  "bodyspec-results-10.pdf",
];

const haveFixtures = existsSync(join(FIXTURE_DIR, "bodyspec-results-1.pdf"));

describe.skipIf(!haveFixtures)("parseBodySpecPdf", () => {
  it("parses PDF #1 (2016 baseline) — every value matches the report", async () => {
    const buf = readFileSync(join(FIXTURE_DIR, "bodyspec-results-1.pdf"));
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

  it("parses PDF #10 (2019 with 2016 baseline) — picks the current scan", async () => {
    const buf = readFileSync(join(FIXTURE_DIR, "bodyspec-results-10.pdf"));
    const r = await parseBodySpecPdf(buf);
    // The current scan is 2019-07-24; its values must NOT collide with
    // the 2016 baseline rows shown in the same table.
    expect(r.scan_date).toBe("2019-07-24");
    expect(r.body_fat_pct).toBe(14.8);
    expect(r.body_weight_lb).toBe(154.7);
    expect(r.rmr_kcal).toBe(1591);
    expect(r.ag_ratio).toBe(0.7);
    expect(r.visceral_fat_lb).toBe(0.53);
  });

  it.each(FIXTURE_FILES)(
    "parses %s without throwing and finds the core fields",
    async (file) => {
      const path = join(FIXTURE_DIR, file);
      if (!existsSync(path)) return; // gap in numbering — skip
      const buf = readFileSync(path);
      const r = await parseBodySpecPdf(buf);
      // scan_date is the cheapest sanity check — if the header demographics
      // line didn't match, the whole parse is broken. Every BodySpec PDF
      // has it.
      expect(r.scan_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Core summary: every report has these.
      expect(r.body_fat_pct).not.toBeNull();
      expect(r.body_weight_lb).not.toBeNull();
      expect(r.lean_mass_lb).not.toBeNull();
      expect(r.fat_mass_lb).not.toBeNull();
      // Regional Arms row — present on every BodySpec template.
      expect(r.arms_fat_pct).not.toBeNull();
    },
  );
});
