/** Persian (۰–۹) and Arabic-Indic (٠–٩) digits → ASCII. Phone keyboards in Iran type either. */
export function toAsciiDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/** "+98 912 000 0001", "۰۹۱۲۰۰۰۰۰۰۱" → "09120000001". Validity is checked by the caller. */
export function normalizePhone(value: string): string {
  return toAsciiDigits(value)
    .replace(/[\s()-]/g, "")
    .replace(/^(\+98|0098)/, "0");
}
