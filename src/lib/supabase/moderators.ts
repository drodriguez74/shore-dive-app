/**
 * Moderator allowlist. There is no role column yet, so moderator rights come
 * from `MODERATOR_EMAILS` (comma-separated, server-only). Unset or empty
 * means nobody is a moderator — fail closed, never "any signed-in user".
 */
export function moderatorEmails(): string[] {
  return (process.env.MODERATOR_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isModerator(user: { email?: string | null } | null | undefined): boolean {
  const email = user?.email?.trim().toLowerCase();
  return Boolean(email) && moderatorEmails().includes(email as string);
}
