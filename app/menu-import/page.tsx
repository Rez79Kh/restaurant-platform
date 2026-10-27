import Link from "next/link";
import { MenuImport } from "@/components/menu-import";
import { requirePageSession } from "@/lib/auth/page";

export default async function MenuImportPage() {
  await requirePageSession("MANAGER");
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">ورود منو از عکس</h1>
        <Link href="/" className="rounded-lg border border-stone-300 px-3 py-2 text-sm">→ میزها</Link>
      </header>
      <MenuImport />
    </main>
  );
}
