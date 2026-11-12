/**
 * True when the request carries a Supabase auth cookie
 * (`sb-<project-ref>-auth-token`, possibly chunked as `.0`, `.1`, …).
 * Used to skip auth round-trips for visitors who cannot be signed in.
 */
export function hasSupabaseSessionCookie(cookies: { name: string }[]): boolean {
  return cookies.some(({ name }) => name.startsWith("sb-") && name.includes("-auth-token"));
}
