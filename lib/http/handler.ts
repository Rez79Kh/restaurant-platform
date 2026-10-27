import { logger, type Logger } from "@/lib/logger";
import { AppError, INTERNAL_ERROR_BODY } from "./errors";

export type HandlerArgs<P> = {
  req: Request;
  params: P;
  requestId: string;
  /** Child logger bound to this request. Auth adds restaurant_id, staff_id and role via log.setBindings(). */
  log: Logger;
};

type RouteContext<P> = { params: Promise<P> };

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * Wraps every Route Handler. One place for: request id, timing, the single
 * "request completed" log line, and mapping errors to { error: { code, message } }.
 *
 * Unknown errors become a generic 500; their details go to the log only.
 * 401/403/409/429 are logged at warn — they are the 3am signals (auth
 * failures, concurrency conflicts, lockouts).
 */
export function route<P = Record<string, never>>(
  handler: (args: HandlerArgs<P>) => Promise<Response>,
) {
  return async (req: Request, ctx: RouteContext<P>): Promise<Response> => {
    const startedAt = performance.now();
    const incoming = req.headers.get("x-request-id");
    const requestId =
      incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : crypto.randomUUID();
    const log = logger.child({
      request_id: requestId,
      route: `${req.method} ${new URL(req.url).pathname}`,
    });

    let response: Response;
    let errorCode: string | undefined;
    try {
      const params = (await ctx?.params) ?? ({} as P);
      response = await handler({ req, params, requestId, log });
    } catch (err) {
      if (err instanceof AppError) {
        errorCode = err.code;
        response = Response.json(err.toBody(), { status: err.status });
      } else {
        errorCode = INTERNAL_ERROR_BODY.error.code;
        log.error({ err }, "unhandled error");
        response = Response.json(INTERNAL_ERROR_BODY, { status: 500 });
      }
    }

    response.headers.set("x-request-id", requestId);
    response.headers.set("cache-control", "no-store");

    const status = response.status;
    const level =
      status >= 500 ? "error" : [401, 403, 409, 429].includes(status) ? "warn" : "info";
    log[level](
      { status, duration_ms: Math.round(performance.now() - startedAt), error_code: errorCode },
      "request completed",
    );
    return response;
  };
}
