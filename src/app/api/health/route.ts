import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/error-message";
import { createLogger } from "@/lib/logger";

const logger = createLogger("health");

/**
 * Liveness check that performs one tiny real database read. Doubles as the
 * keep-alive target for `.github/workflows/keep-alive.yml`: the free-tier
 * Supabase project pauses after about a week with no activity.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("sites").select("id").limit(1);
    if (error) throw error;
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logger.error("database_unreachable", { error: errorMessage(error) });
    return NextResponse.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
