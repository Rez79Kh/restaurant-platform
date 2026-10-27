export function ConnectionBanner({ offline }: { offline: boolean }) {
  if (!offline) return null;
  return (
    <p role="status" className="rounded-lg bg-amber-100 p-3 text-sm text-amber-900">
      اتصال قطع است؛ اطلاعات این صفحه ممکن است به‌روز نباشد. با برقراری اتصال خودکار به‌روز می‌شود.
    </p>
  );
}
