import { loadUserTimezone } from "@/lib/app-settings";
import { requireUserOrSignin } from "@/lib/auth/require";
import { TimezonePicker } from "./timezone-picker";

export const dynamic = "force-dynamic";

export default async function PreferencesPage() {
  const user = await requireUserOrSignin();
  const timezone = await loadUserTimezone(user.id);
  // The full IANA list lives in the JS runtime; pass it through so the
  // client doesn't have to re-fetch and we don't ship a bundle of TZ
  // names ourselves. ~600 entries, ~18 KB JSON; fine for a settings page.
  const allZones = Intl.supportedValuesOf("timeZone");
  const runtimeDefault = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <div className="max-w-[640px]">
      <h1 className="text-2xl font-semibold mb-2">Preferences</h1>
      <p className="text-[0.875rem] text-text-secondary mb-6">
        App-wide settings that affect how Delta interprets your data.
      </p>

      <section className="border border-border rounded p-5 space-y-3">
        <header>
          <h2 className="text-[0.9375rem] font-semibold mb-1">Timezone</h2>
          <p className="text-[0.8125rem] text-text-secondary leading-[1.55]">
            Used to compute &ldquo;today&rdquo; for daily-aggregate metrics
            (sleep, steps, etc). The 7-day windows on Recovery and similar
            dashboards drop today&apos;s mid-flight value before averaging
            — getting the timezone right keeps that boundary at your
            local midnight, not the server&apos;s.
          </p>
        </header>
        <TimezonePicker
          initial={timezone}
          all={allZones}
          runtimeDefault={runtimeDefault}
        />
      </section>
    </div>
  );
}
