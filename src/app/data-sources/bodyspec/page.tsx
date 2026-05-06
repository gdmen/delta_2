import Link from "next/link";
import { SourceDataBrowser } from "@/components/source-data-browser";
import { SourceSyncBehavior } from "@/components/source-sync-behavior";
import { WipeSourceButton } from "@/components/wipe-source-button";
import { Wordmark } from "@/components/wordmark";
import BodySpecUploadClient from "./upload-client";

export const dynamic = "force-dynamic";

export default function BodySpecPage() {
  return (
    <>
      <div className="max-w-[820px]">
        <Link href="/data-sources" className="text-[0.8125rem] text-muted hover:text-foreground">
          ← Sources
        </Link>
        <h1 className="text-2xl font-semibold mt-3 mb-2">BodySpec DEXA</h1>
        <p className="text-[0.875rem] text-text-secondary mb-8">
          Upload BodySpec DEXA scan PDFs. <Wordmark /> extracts body fat %, lean mass, fat mass, bone mineral
          density, and visceral fat. Review before saving.
        </p>
      </div>

      {/* Upload section collapsed by default; spans the full content column
          when open so the PDF preview + review form both fit on desktop. */}
      <details className="mb-10 border-b border-border pb-6">
        <summary className="cursor-pointer text-[0.8125rem] font-semibold uppercase tracking-wider text-muted max-w-[820px]">
          Upload a new scan
        </summary>
        <div className="mt-6">
          <BodySpecUploadClient />
        </div>
      </details>

      <div className="max-w-[820px]">
        <SourceSyncBehavior source="bodyspec_dexa" />
      </div>

      <section className="max-w-[820px]">
        <h2 className="text-[1rem] font-semibold mb-4">Imported data</h2>
        <SourceDataBrowser source="bodyspec_dexa" />
      </section>

      <div className="max-w-[820px]">
        <WipeSourceButton source="bodyspec_dexa" />
      </div>
    </>
  );
}
