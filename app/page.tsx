import { LogoutButton } from "@/components/logout-button";
import { requirePageSession, ROLE_LABELS } from "@/lib/auth/page";

// Placeholder home: the tables grid (Phase 6) and kitchen board (Phase 7) replace it.
export default async function Home() {
  const auth = await requirePageSession();
  return (
    <main className="flex flex-1 flex-col gap-6 p-4">
      <header className="flex items-center justify-between">
        <div>
          <p className="font-bold">{auth.name}</p>
          <p className="text-sm text-stone-600">{ROLE_LABELS[auth.role]}</p>
        </div>
        <LogoutButton />
      </header>
      <p className="text-stone-600">نسخهٔ ۱ — در حال ساخت</p>
    </main>
  );
}
