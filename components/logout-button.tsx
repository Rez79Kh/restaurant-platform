"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function logout() {
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Leave anyway: the session cookie expires on its own.
    }
    router.replace("/login");
    router.refresh();
  }
  return (
    <button
      onClick={logout}
      disabled={pending}
      className="rounded-lg border border-stone-300 px-3 py-2 text-sm disabled:opacity-50"
    >
      {pending ? "در حال خروج…" : "خروج"}
    </button>
  );
}
