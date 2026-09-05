import { errorMessage } from "@/lib/error-message";
import { logger } from "./logger";

/**
 * Fetches a web page and extracts plain, readable text from its HTML —
 * built 2026-08-11 after live testing showed Brave's search-result
 * *snippets* never carry a dive site's coordinates, even for a query that
 * explicitly asks for GPS/geolocation (confirmed against 20 real results
 * for La Romana, DR — zero contained a coordinate-looking number). The
 * coordinate, when it exists at all, lives in the full page body of a
 * specialized dive-site directory, not the ~160-character description a
 * search engine shows in its listing. `area-research.ts`'s
 * `enrichMissingCoordinates` fetches the top follow-up-search result per
 * candidate and hands this fuller text to Gemini instead of (in addition
 * to) the snippet.
 *
 * Used only to widen what Gemini can read — never to render or embed
 * third-party content in the app itself, a different risk category from
 * `media-embed`'s iframe allowlist, which this is unrelated to.
 *
 * Deliberately simple (regex-based tag stripping, no HTML-parsing
 * dependency) — this only needs to hand Gemini readable prose, not to
 * render markup correctly. Defensive on every axis a page-fetch needs to
 * be: timed out, size-capped, degrades to `{ text: null, error }` rather
 * than throwing on a non-HTML response, a network failure, or a page that
 * blocks scraping — callers must treat a failure here as "this candidate
 * stays without a coordinate," never as a reason to fail the whole
 * request.
 */

const FETCH_TIMEOUT_MS = 8000;
// Raw-HTML cap, applied BEFORE tag-stripping — bounds worst-case
// processing cost even after the full response body has already been
// buffered by `response.text()`. A truncation mid-tag can leave a minor
// stray artifact in the stripped text; harmless for this best-effort use.
const MAX_HTML_CHARS = 2_000_000;
// Cap on the plain text actually handed to Gemini — keeps input tokens
// (and therefore free-tier consumption) bounded regardless of how large
// the source page is.
const MAX_TEXT_CHARS = 8000;

export function extractReadableText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchReadableText(url: string): Promise<{ text: string | null; error: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "text/html",
        // Several real dive-site directories (diveboard.com, gpsmycity.com
        // — confirmed live 2026-08-11) 403 a request with no User-Agent at
        // all, which reads to their bot-detection as a script rather than
        // a browser. A standard browser UA is not evasion of any access
        // control beyond that basic check — this fetch still respects a
        // real 403/blocked response as a hard stop (see below), it isn't
        // trying to get past anything more sophisticated (a Cloudflare
        // challenge, a login wall).
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
    });

    if (!response.ok) {
      return { text: null, error: `Fetch responded ${response.status}` };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      return { text: null, error: `Non-HTML content-type: ${contentType || "unknown"}` };
    }

    const html = await response.text();
    const text = extractReadableText(html.slice(0, MAX_HTML_CHARS)).slice(0, MAX_TEXT_CHARS);
    return { text: text.length > 0 ? text : null, error: null };
  } catch (error) {
    const message = errorMessage(error);
    logger.warn("page_fetch.failed", { url, message });
    return { text: null, error: message };
  } finally {
    clearTimeout(timeout);
  }
}
