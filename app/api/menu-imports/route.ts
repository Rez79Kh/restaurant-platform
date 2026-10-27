import { requireRole } from "@/lib/auth/session";
import { toDraft } from "@/lib/ai/menu-checks";
import { AiError, menuExtractorFromEnv } from "@/lib/ai/menu-extractor";
import { getEnv } from "@/lib/env";
import { AppError, badRequest, tooManyRequests } from "@/lib/http/errors";
import { route } from "@/lib/http/handler";
import { withTenant } from "@/lib/tenant";

// Two attempts × 20 s timeout, plus upload. Vercel's default would cut it short.
export const maxDuration = 60;

// Vercel rejects request bodies over 4.5 MB, so the cap sits below that. The
// browser shrinks photos to ~1600 px before upload, typically a few hundred KB.
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_IMPORTS_PER_HOUR = 10;

/** Trust the bytes, not the client's content type. */
function sniffImageType(bytes: Buffer): string | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length > 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

const FAILURE_MESSAGES: Record<string, string> = {
  TIMEOUT: "خواندن منو بیش از حد طول کشید.",
  INVALID_OUTPUT: "نتیجهٔ خواندن منو قابل استفاده نبود.",
};

// Photo → draft. Never touches the menu: the draft waits for a manager's
// review and explicit confirmation. The AI is not on the service-time path;
// if it's slow, down or unconfigured, the manager enters items manually.
// No idempotency key: this only creates a draft, and replaying it would
// mean holding a DB transaction open across a 40 s AI call.
export const POST = route(async ({ req, log }) => {
  const auth = await requireRole({ req, log }, "MANAGER");

  const extractor = menuExtractorFromEnv(getEnv());
  if (!extractor) {
    throw new AppError(503, "AI_UNAVAILABLE", "خواندن خودکار منو فعلاً در دسترس نیست. می‌توانید آیتم‌ها را دستی وارد کنید.");
  }

  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES + 64 * 1024) throw new AppError(413, "IMAGE_TOO_LARGE", "حجم عکس بیش از ۴ مگابایت است.");
  const form = await req.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof File)) throw badRequest("عکسی ارسال نشده است.", undefined, "IMAGE_REQUIRED");
  if (file.size > MAX_BYTES) throw new AppError(413, "IMAGE_TOO_LARGE", "حجم عکس بیش از ۴ مگابایت است.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const mimeType = sniffImageType(bytes);
  if (!mimeType) throw new AppError(415, "UNSUPPORTED_IMAGE", "فقط عکس JPEG، PNG یا WebP پذیرفته می‌شود.");

  const recent = await withTenant(auth.restaurantId, (tx, restaurantId) =>
    tx.menuImportDraft.count({ where: { restaurantId, createdAt: { gt: new Date(Date.now() - 3_600_000) } } }),
  );
  if (recent >= MAX_IMPORTS_PER_HOUR) throw tooManyRequests("در هر ساعت حداکثر ۱۰ عکس منو قابل پردازش است.");

  try {
    const menu = await extractor.extract({ bytes, mimeType }, log);
    const draft = toDraft(menu);
    const saved = await withTenant(auth.restaurantId, (tx, restaurantId) =>
      tx.menuImportDraft.create({
        data: { restaurantId, createdById: auth.staffId, status: "READY", items: draft.items, warnings: draft.warnings },
        select: { id: true },
      }),
    );
    log.info({ draft_id: saved.id, item_count: draft.items.length, warnings: draft.warnings }, "menu draft created");
    return Response.json({ draftId: saved.id, ...draft }, { status: 201 });
  } catch (err) {
    if (!(err instanceof AiError)) throw err;
    await withTenant(auth.restaurantId, (tx, restaurantId) =>
      tx.menuImportDraft.create({ data: { restaurantId, createdById: auth.staffId, status: "FAILED", errorCode: err.code } }),
    );
    log.warn({ ai_failure: err.code }, "menu extraction failed");
    throw new AppError(
      err.code === "TIMEOUT" ? 504 : 502,
      "AI_FAILED",
      `${FAILURE_MESSAGES[err.code] ?? "سرویس خواندن منو پاسخ نداد."} دوباره امتحان کنید یا آیتم‌ها را دستی وارد کنید.`,
      { reason: err.code },
    );
  }
});
