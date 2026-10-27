import { redirect } from "next/navigation";
import { FloorView } from "@/components/floor";
import { LogoutButton } from "@/components/logout-button";
import { requirePageSession, ROLE_LABELS } from "@/lib/auth/page";

export default async function Home() {
  const auth = await requirePageSession();
  if (auth.role === "KITCHEN") redirect("/kitchen");
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <div>
          <p className="font-bold">{auth.name}</p>
          <p className="text-sm text-stone-600">{ROLE_LABELS[auth.role]}</p>
        </div>
        <LogoutButton />
      </header>
      <FloorView />
    </main>
  );
}
