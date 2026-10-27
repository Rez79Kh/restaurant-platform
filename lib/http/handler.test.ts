import { describe, expect, it } from "vitest";
import { z } from "zod";
import { conflict } from "./errors";
import { route } from "./handler";
import { parseBody } from "./validate";

const ctx = { params: Promise.resolve({}) };
const get = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/test", { headers });

describe("route()", () => {
  it("returns the handler response with a generated request id", async () => {
    const handler = route(async ({ requestId }) => Response.json({ requestId }));
    const res = await handler(get(), ctx);

    expect(res.status).toBe(200);
    const id = res.headers.get("x-request-id");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await res.json()).toEqual({ requestId: id });
  });

  it("keeps a well-formed incoming request id and replaces a malformed one", async () => {
    const handler = route(async () => Response.json({}));

    const kept = await handler(get({ "x-request-id": "client-req-12345" }), ctx);
    expect(kept.headers.get("x-request-id")).toBe("client-req-12345");

    const replaced = await handler(get({ "x-request-id": "bad id; drop table" }), ctx);
    expect(replaced.headers.get("x-request-id")).not.toBe("bad id; drop table");
  });

  it("maps AppError to its status and the standard error body", async () => {
    const handler = route(async () => {
      throw conflict(undefined, { status: "PREPARING" });
    });
    const res = await handler(get(), ctx);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.details).toEqual({ status: "PREPARING" });
  });

  it("hides unknown errors behind a generic 500", async () => {
    const handler = route(async () => {
      throw new Error("connection to 10.0.0.5 failed: password=hunter2");
    });
    const res = await handler(get(), ctx);

    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("hunter2");
    expect(JSON.parse(text).error.code).toBe("INTERNAL_ERROR");
  });
});

describe("parseBody()", () => {
  const schema = z.object({ quantity: z.number().int().positive() });
  const post = (body: string) =>
    route(async ({ req }) => Response.json(await parseBody(req, schema)))(
      new Request("http://localhost/api/test", { method: "POST", body }),
      ctx,
    );

  it("rejects malformed JSON with INVALID_JSON", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_JSON");
  });

  it("rejects schema violations with VALIDATION_ERROR and field paths", async () => {
    const res = await post(JSON.stringify({ quantity: -1 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.issues[0].path).toBe("quantity");
  });

  it("passes valid input through", async () => {
    const res = await post(JSON.stringify({ quantity: 2 }));
    expect(await res.json()).toEqual({ quantity: 2 });
  });
});
