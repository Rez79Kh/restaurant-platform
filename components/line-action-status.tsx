import type { LineAction } from "@/lib/client/use-line-actions";

/** Inline feedback under a line: failed (with retry) or conflict (acknowledge). */
export function LineActionStatus({
  action,
  onRetry,
  onDismiss,
}: {
  action: LineAction | undefined;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  if (!action || action.status === "pending") return null;
  const failed = action.status === "failed";
  return (
    <div
      role="alert"
      className={`mt-1 flex items-center justify-between gap-2 rounded p-2 text-sm ${failed ? "bg-red-50 text-red-800" : "bg-amber-100 text-amber-900"}`}
    >
      <span>{failed ? `ثبت نشد: ${action.message}` : action.message}</span>
      <button className="shrink-0 rounded border border-current px-2 py-1" onClick={failed ? onRetry : onDismiss}>
        {failed ? "دوباره" : "باشه"}
      </button>
    </div>
  );
}
