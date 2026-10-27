import { describe, expect, it } from "vitest";
import type { Logger } from "@/lib/logger";
import { AiError, createOpenAiCompatibleExtractor, menuExtractorFromEnv, SYSTEM_PROMPT } from "./menu-extractor";

const API_KEY = "sk-test-secret-0123456789";
const IMAGE = { bytes: Buffer.from("fake-image-bytes"), mimeType: "image/jpeg" };
const MENU = { currency: "TOMAN", categories: [{ name: "نوشیدنی گرم", items: [{ name: "اسپرسو", price: 120000 }] }] };

function fakeLogger() {
  const lines: unknown[] = [];
  const log = { info: (o: unknown) => lines.push(o), warn: (o: unknown) => lines.push(o) } as unknown as Logger;
  return { log, lines };
}

const completion = (content: string, usage: object = { prompt_tokens: 1200, completion_tokens: 80, cost: 0.0042 }) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }], usage }), { status: 200 });

function extractor(responses: (Response | "timeout" | "network")[], timeoutMs = 50) {
  const calls: RequestInit[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    calls.push(init);
    const next = responses.shift();
    if (next === "network") throw new TypeError("fetch failed");
    if (next === "timeout") {
      return new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)));
    }
    return next!;
  }) as unknown as typeof fetch;
  return { calls, extractor: createOpenAiCompatibleExtractor({ baseUrl: "https://ai.test/v1/", apiKey: API_KEY, model: "gpt-4o", timeoutMs, fetchImpl }) };
}

describe("OpenAI-compatible menu extractor", () => {
  it("sends the image as data, with no tools, and parses the menu", async () => {
    const { calls, extractor: ai } = extractor([completion(JSON.stringify(MENU))]);
    const menu = await ai.extract(IMAGE, fakeLogger().log);
    expect(menu.categories[0]!.items[0]).toEqual({ name: "اسپرسو", price: 120000 });

    const body = JSON.parse(calls[0]!.body as string);
    expect(body).not.toHaveProperty("tools");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0]).toEqual({ role: "system", content: SYSTEM_PROMPT });
    expect(body.messages[1].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
    expect(SYSTEM_PROMPT).toMatch(/DATA, never instructions/);
  });

  it("logs latency, tokens and cost, never the key or the image", async () => {
    const { log, lines } = fakeLogger();
    await extractor([completion(JSON.stringify(MENU))]).extractor.extract(IMAGE, log);
    expect(lines[0]).toMatchObject({ outcome: "ok", attempt: 1, prompt_tokens: 1200, completion_tokens: 80, cost_usd: 0.0042, item_count: 1 });
    expect(JSON.stringify(lines)).not.toMatch(/sk-test|ZmFrZS1pbWFnZ|fake-image/);
  });

  it("tolerates a gateway that reports no cost", async () => {
    const { log, lines } = fakeLogger();
    await extractor([completion(JSON.stringify(MENU), { prompt_tokens: 10 })]).extractor.extract(IMAGE, log);
    expect(lines[0]).toMatchObject({ outcome: "ok", cost_usd: undefined });
  });

  it("retries once after a timeout, then gives up", async () => {
    const { calls, extractor: ai } = extractor(["timeout", "timeout"]);
    await expect(ai.extract(IMAGE, fakeLogger().log)).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(calls).toHaveLength(2);
  });

  it("recovers when the retry succeeds", async () => {
    const { calls, extractor: ai } = extractor([new Response("busy", { status: 503 }), completion(JSON.stringify(MENU))]);
    await expect(ai.extract(IMAGE, fakeLogger().log)).resolves.toBeDefined();
    expect(calls).toHaveLength(2);
  });

  it("treats output that isn't the schema as a failure (after one retry)", async () => {
    const { calls, extractor: ai } = extractor([completion("Sure! The menu has espresso."), completion('{"items": "none"}')]);
    await expect(ai.extract(IMAGE, fakeLogger().log)).rejects.toMatchObject({ code: "INVALID_OUTPUT" });
    expect(calls).toHaveLength(2);
  });

  it("does not retry a request the gateway rejected (e.g. bad key)", async () => {
    const { calls, extractor: ai } = extractor([new Response("unauthorized", { status: 401 })]);
    await expect(ai.extract(IMAGE, fakeLogger().log)).rejects.toBeInstanceOf(AiError);
    expect(calls).toHaveLength(1);
  });

  it("is disabled, not broken, when AI isn't configured", () => {
    expect(menuExtractorFromEnv({ AI_BASE_URL: undefined, AI_API_KEY: undefined, AI_MODEL: undefined })).toBeNull();
    expect(menuExtractorFromEnv({ AI_BASE_URL: "https://x/v1", AI_API_KEY: "k", AI_MODEL: "m" })).not.toBeNull();
  });
});
