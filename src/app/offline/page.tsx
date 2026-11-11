import type { Metadata } from "next";
import { OfflineSavedSites } from "@/components/offline/offline-saved-sites";

export const metadata: Metadata = { title: "Saved sites — Shore Dive" };

/**
 * Saved-sites view, and the service worker's fallback for any navigation
 * that fails with no network (see `src/app/sw.ts`). Renders entirely from
 * IndexedDB on the client, so it must not depend on server data.
 */
export default function OfflinePage() {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-depth-0">
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-10">
        <OfflineSavedSites />
      </main>
    </div>
  );
}
