import { MediaEmbed } from "@/components/media-embed";
import type { MediaEmbedSource } from "@/components/media-embed";

// T20 demo route — deliberately self-contained and NOT linked from the
// homepage (src/app/page.tsx is owned by other concurrent work). Exists
// only to exercise the media-embed component's fallback chain (live stream
// → embedded player → refreshing stills → unavailable) against mock source
// configs, since there's no real `camera_sources` data yet (T17.1 just
// landed the schema; T17.2's ingestion connector hasn't been built).

const MOCK_SOURCES: Array<{ id: string; description: string; source: MediaEmbedSource }> = [
  {
    id: "stream-ok",
    description: "Live-stream tier succeeds — a direct, playable video URL, so it never falls through.",
    source: {
      label: "Harbor Cam",
      streamUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    },
  },
  {
    id: "embed-allowlisted",
    description:
      "No stream URL, so it falls to the embedded-player tier. The embed URL's hostname " +
      "(embed.example.com) IS on EMBED_DOMAIN_ALLOWLIST, so it renders inside the sandboxed " +
      "iframe. A still-image fallback is also configured, refreshed every 20s, in case the " +
      "embed itself fails to load in your browser (e.g. the placeholder host refuses to be " +
      "framed) — demonstrating the embed → still fallback step.",
    source: {
      label: "Pier Cam",
      embedUrl: "https://embed.example.com/pier-cam",
      stillImageUrl: "https://picsum.photos/seed/shore-dive-pier-cam/800/450",
      stillRefreshIntervalSeconds: 20,
    },
  },
  {
    id: "embed-not-allowlisted",
    description:
      "No stream URL and no still fallback. The embed URL's hostname (not-a-partner.example.net) " +
      "is NOT on EMBED_DOMAIN_ALLOWLIST, so the component refuses to render an iframe at all — " +
      "not even briefly — and shows a clear refusal message instead of a blank space. This is " +
      "the domain-allowlist / sandboxing requirement (T20.2) working as intended.",
    source: {
      label: "Unverified Cam",
      embedUrl: "https://not-a-partner.example.net/some-embed",
    },
  },
  {
    id: "everything-fails",
    description:
      "A deliberately broken stream URL, no embed, no still. Demonstrates the video element's " +
      "onError detection advancing straight to the terminal \"unavailable\" state (with a Retry " +
      "button) rather than showing a blank/broken player.",
    source: {
      label: "Offline Cam",
      streamUrl: "https://example.invalid/does-not-exist.mp4",
    },
  },
  {
    id: "no-sources",
    description: "No sources configured at all — shows the \"no media source configured\" state.",
    source: {
      label: "Unconfigured Cam",
    },
  },
];

export default function MediaDemoPage() {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-black">
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-10">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Media Embed demo (T20)
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Mock-data demo of the unified media embed &amp; fallback component
            (<code>src/components/media-embed</code>). Fallback order: live stream → embedded
            player (sandboxed, domain-allowlisted) → refreshing stills → unavailable. Not linked
            from the homepage — this route exists only to exercise the component.
          </p>
        </div>

        {MOCK_SOURCES.map(({ id, description, source }) => (
          <section key={id} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-black dark:text-zinc-50">{source.label}</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-500">{description}</p>
            <MediaEmbed source={source} />
          </section>
        ))}
      </main>
    </div>
  );
}
