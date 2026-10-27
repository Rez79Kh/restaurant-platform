"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

const SLUG_KEY = "rp:last-slug";

export default function LoginPage() {
  const router = useRouter();
  const slugRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Staff log in on the same device every shift; remember the restaurant.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SLUG_KEY);
      if (saved && slugRef.current && !slugRef.current.value) slugRef.current.value = saved;
    } catch {}
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: data.slug, phone: data.phone, pin: data.pin }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? "ورود ناموفق بود. دوباره امتحان کنید.");
        (form.elements.namedItem("pin") as HTMLInputElement).value = "";
        return;
      }
      try {
        localStorage.setItem(SLUG_KEY, (data.slug ?? "").trim().toLowerCase());
      } catch {}
      router.replace("/");
      router.refresh();
    } catch {
      setError("اتصال به سرور برقرار نشد. اینترنت را بررسی کنید و دوباره امتحان کنید.");
    } finally {
      setPending(false);
    }
  }

  const field = "w-full rounded-lg border border-stone-300 bg-white px-3 py-3 text-lg";
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-bold">ورود کارکنان</h1>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span>کد رستوران</span>
          <input
            ref={slugRef}
            name="slug"
            className={field}
            dir="ltr"
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="cafe-narenj"
            required
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>شماره موبایل</span>
          <input
            name="phone"
            className={field}
            dir="ltr"
            type="tel"
            inputMode="numeric"
            autoComplete="username"
            placeholder="۰۹۱۲۳۴۵۶۷۸۹"
            required
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>رمز ورود (PIN)</span>
          <input
            name="pin"
            className={field}
            dir="ltr"
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            required
          />
        </label>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-stone-900 py-3 text-lg font-bold text-white disabled:opacity-50"
        >
          {pending ? "در حال ورود…" : "ورود"}
        </button>
      </form>
    </main>
  );
}
