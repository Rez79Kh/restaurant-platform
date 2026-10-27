/**
 * Every error response has the shape { error: { code, message, details? } }.
 * `code` is a stable English constant for clients and logs; `message` is
 * Persian and safe to show to staff. `details` carries structured data the UI
 * needs, e.g. the current state of a line on a 409 conflict.
 */
export type ErrorBody = {
  error: { code: string; message: string; details?: unknown };
};

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }

  toBody(): ErrorBody {
    const error: ErrorBody["error"] = { code: this.code, message: this.message };
    if (this.details !== undefined) error.details = this.details;
    return { error };
  }
}

export const badRequest = (
  message = "درخواست نامعتبر است.",
  details?: unknown,
  code = "BAD_REQUEST",
) => new AppError(400, code, message, details);

export const unauthorized = (message = "لطفاً دوباره وارد شوید.") =>
  new AppError(401, "UNAUTHORIZED", message);

export const forbidden = (message = "شما اجازه انجام این کار را ندارید.") =>
  new AppError(403, "FORBIDDEN", message);

export const notFound = (message = "مورد درخواستی پیدا نشد.") =>
  new AppError(404, "NOT_FOUND", message);

export const conflict = (
  message = "این مورد هم‌زمان توسط شخص دیگری تغییر کرده است. صفحه را به‌روز کنید.",
  details?: unknown,
) => new AppError(409, "CONFLICT", message, details);

export const tooManyRequests = (
  message = "تعداد تلاش‌ها زیاد است. کمی بعد دوباره امتحان کنید.",
) => new AppError(429, "RATE_LIMITED", message);

export const INTERNAL_ERROR_BODY: ErrorBody = {
  error: {
    code: "INTERNAL_ERROR",
    message: "خطای غیرمنتظره‌ای رخ داد. دوباره امتحان کنید.",
  },
};
