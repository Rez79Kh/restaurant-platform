import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as logoutRoute } from "@/app/api/auth/logout/route";
import { GET as meRoute } from "@/app/api/auth/me/route";
import type { PrismaClient } from "@/generated/prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { createTenant, ownerDb, type TenantFixture } from "./fixtures";
import { call, freshIp, loginAs, sessionCookieOf, type Handler } from "./http";

const login = (body: unknown, ip = freshIp(), path = "/api/auth/login") =>
  call(loginRoute as Handler, { method: "POST", path, body, ip });
const me = (cookie?: string) => call(meRoute as Handler, { path: "/api/auth/me", cookie });

let owner: PrismaClient;
let t: TenantFixture;

beforeAll(async () => {
  owner = ownerDb();
  t = await createTenant(owner, "auth");
});

afterAll(async () => {
  await owner.$disconnect();
  await db().$disconnect();
});

const creds = (role: "MANAGER" | "STAFF" | "KITCHEN" = "STAFF") => ({
  slug: t.slug,
  phone: t.people[role].phone,
  pin: t.people[role].pin,
});

describe("login", () => {
  it("sets an HttpOnly, SameSite=Lax session cookie and the session resolves", async () => {
    const { res, status, body } = await login(creds());
    expect(status).toBe(200);
    expect(body.staff).toMatchObject({ id: t.people.STAFF.id, role: "STAFF" });

    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^rp_session=[\w-]{43};/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Secure"); // plain-HTTP localhost

    const who = await me(sessionCookieOf(res));
    expect(who.status).toBe(200);
    expect(who.body.staff.id).toBe(t.people.STAFF.id);
  });

  it("marks the cookie Secure over HTTPS", async () => {
    // call() builds http:// URLs, so build the https request directly.
    const res = await (loginRoute as Handler)(
      new Request("https://app.example/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": freshIp() },
        body: JSON.stringify(creds()),
      }),
      { params: Promise.resolve({}) as Promise<never> },
    );
    expect(res.headers.get("set-cookie")).toContain("Secure");
  });

  it("stores only a hash of the session token", async () => {
    const { res } = await login(creds());
    const token = sessionCookieOf(res).split("=")[1]!;
    expect(await owner.session.count({ where: { tokenHash: token } })).toBe(0);
  });

  it("accepts Persian digits and spacing in phone and PIN", async () => {
    const toPersian = (s: string) => s.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]!);
    const phone = t.people.MANAGER.phone;
    const { status } = await login({
      slug: t.slug.toUpperCase(),
      phone: `${toPersian(phone.slice(0, 4))} ${toPersian(phone.slice(4))}`,
      pin: toPersian(t.people.MANAGER.pin),
    });
    expect(status).toBe(200);
  });

  it("gives the same answer for a wrong PIN, an unknown phone and an unknown restaurant", async () => {
    const wrongPin = await login({ ...creds(), pin: "9999" });
    const unknownPhone = await login({ ...creds(), phone: "09999999999" });
    const unknownSlug = await login({ ...creds(), slug: "no-such-cafe" });

    for (const r of [wrongPin, unknownPhone, unknownSlug]) {
      expect(r.status).toBe(401);
      expect(r.body).toEqual(wrongPin.body);
    }
    expect(wrongPin.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("audit-logs a failed login in the restaurant, without the phone in full", async () => {
    await login({ ...creds("KITCHEN"), pin: "0000" });
    const events = await owner.auditEvent.findMany({
      where: { restaurantId: t.restaurantId, action: "auth.login_failed", entityId: t.people.KITCHEN.id },
    });
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events)).not.toContain(t.people.KITCHEN.phone);
  });

  it("refuses a deactivated staff member", async () => {
    const other = await createTenant(owner, "inactive");
    await owner.staffMember.update({ where: { id: other.people.STAFF.id }, data: { isActive: false } });
    const { status } = await login({ slug: other.slug, phone: other.people.STAFF.phone, pin: "2222" });
    expect(status).toBe(401);
  });
});

describe("rate limiting", () => {
  it("locks an account after 5 failures, even for the right PIN", async () => {
    const other = await createTenant(owner, "lock");
    const account = { slug: other.slug, phone: other.people.STAFF.phone };
    for (let i = 0; i < 5; i++) {
      expect((await login({ ...account, pin: "9999" })).status).toBe(401);
    }
    const locked = await login({ ...account, pin: other.people.STAFF.pin });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe("RATE_LIMITED");
  });

  it("a successful login resets the account's failure count", async () => {
    const other = await createTenant(owner, "reset");
    const account = { slug: other.slug, phone: other.people.STAFF.phone };
    for (let i = 0; i < 4; i++) await login({ ...account, pin: "9999" });
    expect((await login({ ...account, pin: "2222" })).status).toBe(200);
    for (let i = 0; i < 4; i++) await login({ ...account, pin: "9999" });
    expect((await login({ ...account, pin: "2222" })).status).toBe(200);
  });

  it("limits one IP to 20 failures across accounts and restaurants", async () => {
    const ip = freshIp();
    for (let i = 0; i < 20; i++) {
      await login({ slug: t.slug, phone: `0935000${String(i).padStart(4, "0")}`, pin: "1111" }, ip);
    }
    expect((await login(creds("MANAGER"), ip)).status).toBe(429);
    expect((await login(creds("MANAGER"))).status).toBe(200); // other IPs unaffected
  });
});

describe("sessions and requireRole()", () => {
  const asRequest = (cookie?: string) => ({
    req: new Request("http://localhost/x", { headers: cookie ? { cookie } : {} }),
    log: logger.child({}),
  });

  it("rejects a missing or forged session with 401", async () => {
    expect((await me()).status).toBe(401);
    expect((await me("rp_session=forged-token")).status).toBe(401);
    expect((await me(`rp_session=${"a".repeat(500)}`)).status).toBe(401);
  });

  it("enforces roles server-side: 403 for the wrong role, the context for the right one", async () => {
    const kitchen = await loginAs(t, "KITCHEN");
    const staff = await loginAs(t, "STAFF");
    const manager = await loginAs(t, "MANAGER");

    await expect(requireRole(asRequest(kitchen), "MANAGER", "STAFF")).rejects.toMatchObject({ status: 403 });
    await expect(requireRole(asRequest(staff), "MANAGER")).rejects.toMatchObject({ status: 403 });
    const auth = await requireRole(asRequest(manager), "MANAGER");
    expect(auth).toMatchObject({ restaurantId: t.restaurantId, staffId: t.people.MANAGER.id, role: "MANAGER" });
  });

  it("takes the restaurant from the session, never from the request", async () => {
    const other = await createTenant(owner, "spoof");
    const cookie = await loginAs(t, "MANAGER");
    const req = new Request(`http://localhost/x?restaurantId=${other.restaurantId}`, {
      headers: { cookie, "x-restaurant-id": other.restaurantId },
    });
    const auth = await requireRole({ req, log: logger.child({}) }, "MANAGER");
    expect(auth.restaurantId).toBe(t.restaurantId);
  });

  it("an expired session no longer resolves", async () => {
    const { res } = await login(creds());
    const cookie = sessionCookieOf(res);
    await owner.session.updateMany({
      where: { staffMemberId: t.people.STAFF.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await me(cookie)).status).toBe(401);
  });

  it("deactivating a staff member ends their existing sessions", async () => {
    const other = await createTenant(owner, "deact");
    const cookie = await loginAs(other, "STAFF");
    expect((await me(cookie)).status).toBe(200);
    await owner.staffMember.update({ where: { id: other.people.STAFF.id }, data: { isActive: false } });
    expect((await me(cookie)).status).toBe(401);
  });

  it("logout deletes the session and clears the cookie", async () => {
    const cookie = await loginAs(t, "MANAGER");
    const { res, status } = await call(logoutRoute as Handler, { method: "POST", path: "/api/auth/logout", cookie });
    expect(status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await me(cookie)).status).toBe(401);
  });
});
