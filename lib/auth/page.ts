import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession, SESSION_COOKIE, type AuthContext, type Role } from "./session";

/** Server components: the signed-in staff member, or a redirect to /login. */
export async function requirePageSession(...roles: Role[]): Promise<AuthContext> {
  const auth = await getSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!auth) redirect("/login");
  if (roles.length > 0 && !roles.includes(auth.role)) redirect("/");
  return auth;
}

export const ROLE_LABELS: Record<Role, string> = {
  MANAGER: "مدیر",
  STAFF: "سالن",
  KITCHEN: "آشپزخانه",
};
