import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google";
import { SiteHeader } from "@/components/site-header/site-header";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Display/headline font — see creative/design-system/DESIGN_SYSTEM.md §3.
// Free Google Font, self-hosted at build time via next/font/google (no
// runtime request, no cost). Exposed as --font-display via globals.css's
// @theme inline block, consistent with tokens.css.
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Shore Dive",
  description:
    "Discover and safely dive hyper-local shore sites — offline-first, community-sourced, zero monetization.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Shore Dive",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b1220",
};

// SiteHeader checks the real session on every render (via cookies()), so
// every route under this layout needs a live request anyway — force
// dynamic rendering here rather than letting Next.js attempt static
// generation per-route and bail out. Without this, the attempted-then-
// bailed static generation throws Next's internal "Dynamic server usage"
// signal from inside SiteHeader's auth check on every build, which its
// catch block can't distinguish from a real Supabase failure and logs as
// a false-positive warning — see the build output before this was added.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
