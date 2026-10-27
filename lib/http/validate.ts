import type { z } from "zod";
import { badRequest } from "./errors";

/** Validates any input (params, query, parsed body) or throws a 400 VALIDATION_ERROR. */
export function parseWith<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw badRequest(
      "اطلاعات ارسال‌شده نامعتبر است.",
      {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
      },
      "VALIDATION_ERROR",
    );
  }
  return result.data;
}

/** Reads a JSON body and validates it. Malformed JSON → 400 INVALID_JSON. */
export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest("بدنه درخواست JSON معتبر نیست.", undefined, "INVALID_JSON");
  }
  return parseWith(schema, raw);
}
