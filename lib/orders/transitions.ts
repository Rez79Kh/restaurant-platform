import type { Role } from "@/lib/auth/session";

export type LineStatus = "SENT" | "PREPARING" | "READY" | "SERVED" | "VOID";

// The only status moves a line can make through this endpoint, and who may
// make them. Voiding is separate (Phase 8: reason, audit, manager rules).
export const LINE_TRANSITIONS: readonly { from: LineStatus; to: LineStatus; roles: readonly Role[] }[] = [
  { from: "SENT", to: "PREPARING", roles: ["KITCHEN", "MANAGER"] },
  { from: "PREPARING", to: "READY", roles: ["KITCHEN", "MANAGER"] },
  { from: "READY", to: "SERVED", roles: ["STAFF", "MANAGER"] },
];

export const findTransition = (from: LineStatus, to: LineStatus) =>
  LINE_TRANSITIONS.find((t) => t.from === from && t.to === to);
