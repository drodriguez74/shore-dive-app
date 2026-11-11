"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { FreshnessBadge } from "@/components/freshness-badge";
import { HazardRecencyBadge } from "@/components/hazard-recency-badge";
import { LegalAccessBadge } from "@/components/legal-access-badge";
import { ProvenanceBadge } from "@/components/provenance-badge";
import { SiteDiveProfile } from "@/components/site-dive-profile";
import { SiteResearchSummary } from "@/components/site-research-summary";
import { listCachedSites, removeCachedSite, type CachedSite } from "@/lib/offline/prefetch-site";

/**
 * Lists every site saved on this device and renders each one in full from
 * IndexedDB — the read side of the offline cache (Tasks 12/13). Every site
 * carries its own "as of" freshness; nothing here implies the data is live.
 */

function subscribeToConnectivity(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

type LoadState = { status: "loading" } | { status: "ready"; sites: CachedSite[] } | { status: "error" };

export function OfflineSavedSites() {
  const online = useSyncExternalStore(
    subscribeToConnectivity,
    () => navigator.onLine,
    () => true,
  );
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [openSiteId, setOpenSiteId] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void listCachedSites().then((result) => {
      if (cancelled) return;
      setState(result.error ? { status: "error" } : { status: "ready", sites: result.sites });
    });
    return () => {
      cancelled = true;
    };
  }, [reloadNonce]);

  async function handleRemove(siteId: string) {
    if (await removeCachedSite(siteId)) setReloadNonce((nonce) => nonce + 1);
  }

  return (
    <>
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Saved sites
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {online
            ? "Sites you've saved to this device for use without a connection."
            : "You're offline. These are the sites saved on this device — the rest of the app needs a connection."}
        </p>
        <p className="mt-2 rounded-lg border border-amber-600/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:border-amber-400/30 dark:text-amber-200">
          Saved copies only refresh while this app is open with a connection — never in the background. Hazard
          reports are only as current as each site&apos;s &quot;cached&quot; time below; conditions may have
          changed since.
        </p>
      </div>

      {state.status === "loading" && <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading saved sites…</p>}

      {state.status === "error" && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          Couldn&apos;t read this device&apos;s saved sites — browser storage may be blocked (for example in
          private browsing). This doesn&apos;t mean nothing was saved.
        </p>
      )}

      {state.status === "ready" && state.sites.length === 0 && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Nothing saved on this device yet. While you have a connection, open a site and tap &quot;Prefetch
          Now&quot;.
        </p>
      )}

      {state.status === "ready" && state.sites.length > 0 && (
        <ul className="flex flex-col gap-3">
          {state.sites.map(({ payload, cachedAt }) => {
            const { site, hazards, hazardsTruncated } = payload;
            const isOpen = openSiteId === site.id;
            return (
              <li
                key={site.id}
                className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-depth-border dark:bg-depth-1"
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpenSiteId(isOpen ? null : site.id)}
                  className="flex w-full flex-col gap-2 text-left"
                >
                  <span className="text-base font-semibold text-black dark:text-zinc-50">{site.name}</span>
                  <span className="flex flex-wrap items-center gap-2">
                    <FreshnessBadge cachedAt={cachedAt} />
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {hazards.length === 0
                        ? "No hazard reports when saved"
                        : `${hazards.length} hazard report${hazards.length === 1 ? "" : "s"} when saved`}
                    </span>
                  </span>
                </button>

                {isOpen && (
                  <div className="mt-4 flex flex-col gap-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <ProvenanceBadge provenance={site.provenance} />
                      <LegalAccessBadge status={site.legal_access_status} />
                    </div>
                    <p className="text-xs text-zinc-500">
                      {site.latitude.toFixed(5)}, {site.longitude.toFixed(5)}
                    </p>

                    {site.description && (
                      <section className="flex flex-col gap-2">
                        <h2 className="text-sm font-semibold text-black dark:text-zinc-50">About this site</h2>
                        {site.description
                          .split(/\n\s*\n/)
                          .map((paragraph) => paragraph.trim())
                          .filter(Boolean)
                          .map((paragraph, index) => (
                            <p key={index} className="text-sm text-zinc-600 dark:text-zinc-400">
                              {paragraph}
                            </p>
                          ))}
                      </section>
                    )}

                    <SiteResearchSummary
                      summary={site.research_summary ?? null}
                      sources={site.research_sources ?? null}
                      updatedAt={site.research_summary_updated_at ?? null}
                    />

                    <SiteDiveProfile site={site} />

                    <section className="flex flex-col gap-2">
                      <h2 className="text-sm font-semibold text-black dark:text-zinc-50">
                        Hazard reports as of when this was saved
                      </h2>
                      {hazards.length === 0 ? (
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          None were on file. That isn&apos;t a safety guarantee — and anything reported since
                          isn&apos;t shown here.
                        </p>
                      ) : (
                        <ul className="flex flex-col gap-2">
                          {hazards.map((hazard) => (
                            <li
                              key={hazard.id}
                              className="rounded-lg border border-amber-600/20 bg-amber-500/5 p-3 dark:border-amber-400/20"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <ProvenanceBadge provenance={hazard.provenance} />
                                <HazardRecencyBadge reportedAt={hazard.created_at} />
                              </div>
                              <p className="mt-1.5 text-sm text-zinc-700 dark:text-zinc-300">{hazard.description}</p>
                            </li>
                          ))}
                        </ul>
                      )}
                      {hazardsTruncated && (
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                          Only the most recent reports were saved — this site had more on file.
                        </p>
                      )}
                    </section>

                    <div className="flex flex-wrap items-center gap-4 text-sm">
                      {online && (
                        // A plain <a>: a full navigation works whether or not the client router is healthy.
                        <a
                          href={`/sites/${site.id}`}
                          className="font-medium text-sky-700 hover:underline dark:text-sky-400"
                        >
                          Open live page to refresh →
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemove(site.id)}
                        className="font-medium text-red-700 hover:underline dark:text-red-400"
                      >
                        Remove from this device
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
