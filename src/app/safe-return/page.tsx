import type { Metadata } from "next";
import Link from "next/link";
import { SafeReturnTimer } from "@/components/safe-return/safe-return-timer";

export const metadata: Metadata = {
  title: "Safe-Return Timer — Shore Dive",
  description: "An on-device countdown with a local alarm on expiry — alerts only this device.",
};

export default function SafeReturnPage() {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-depth-0">
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-6 py-10">
        <div>
          <Link
            href="/"
            className="text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-300"
          >
            ← Shore Dive
          </Link>
          <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Safe-Return Timer
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            An on-device countdown with a local alarm on expiry. v1 is intentionally
            local-only — read the disclaimer below before you start.
          </p>
        </div>
        <SafeReturnTimer />
      </main>
    </div>
  );
}
