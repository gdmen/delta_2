import Link from "next/link";
import { WizardClient } from "./wizard-client";

export const dynamic = "force-dynamic";

export default function NewImportSourcePage() {
  return (
    <div className="max-w-[1200px]">
      <Link href="/data-sources" className="text-[0.8125rem] text-muted hover:text-foreground">
        ← Sources
      </Link>
      <h1 className="text-2xl font-semibold mt-3 mb-2">New CSV import source</h1>
      <p className="text-[0.875rem] text-text-secondary mb-8">
        Upload a CSV from any third-party app and map its columns onto Delta&apos;s fields. The mapping is
        saved for reuse; future imports skip straight to upload. Ask Delta in the side panel for help.
      </p>
      <WizardClient />
    </div>
  );
}
