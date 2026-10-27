import { LogoutButton } from "@/components/logout-button";
import { requirePageSession } from "@/lib/auth/page";

// Placeholder: the kitchen board arrives in Phase 7.
export default async function KitchenPage() {
  const auth = await requirePageSession("KITCHEN", "MANAGER");
  return (
    <main className="flex flex-1 flex-col gap-6 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">آشپزخانه — {auth.name}</h1>
        <LogoutButton />
      </header>
      <p className="text-stone-600">صفحهٔ آشپزخانه در مرحلهٔ بعد اضافه می‌شود.</p>
    </main>
  );
}
