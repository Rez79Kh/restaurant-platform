import Link from "next/link";
import { KitchenBoard } from "@/components/kitchen-board";
import { LogoutButton } from "@/components/logout-button";
import { requirePageSession } from "@/lib/auth/page";

// Tablet layout: ticket cards by order, oldest first, one tap per step.
export default async function KitchenPage() {
  const auth = await requirePageSession("KITCHEN", "MANAGER");
  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">آشپزخانه</h1>
        <div className="flex items-center gap-2">
          {auth.role === "MANAGER" && (
            <Link href="/" className="rounded-lg border border-stone-300 px-3 py-2 text-sm">میزها</Link>
          )}
          <span className="text-sm text-stone-600">{auth.name}</span>
          <LogoutButton />
        </div>
      </header>
      <KitchenBoard />
    </main>
  );
}
