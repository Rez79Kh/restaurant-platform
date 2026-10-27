// Persian digits, thousands separators, Jalali calendar, Tehran time.
const numbers = new Intl.NumberFormat("fa-IR");
const clock = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Tehran",
});
const dateTime = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Tehran",
});

export const formatNumber = (n: number) => numbers.format(n);
export const formatToman = (n: number) => `${numbers.format(n)} تومان`;
export const formatClock = (iso: string | Date) => clock.format(new Date(iso));
export const formatDateTime = (iso: string | Date) => dateTime.format(new Date(iso));

export function minutesSince(iso: string | Date, now = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
}

export const LINE_STATUS_LABELS: Record<string, string> = {
  SENT: "ارسال شد",
  PREPARING: "در حال آماده‌سازی",
  READY: "آماده",
  SERVED: "سرو شد",
  VOID: "لغو شد",
};

/** Table labels are usually numbers ("7" → "۷"); anything else is shown as typed. */
export const formatLabel = (label: string) => (/^\d+$/.test(label) ? formatNumber(Number(label)) : label);
