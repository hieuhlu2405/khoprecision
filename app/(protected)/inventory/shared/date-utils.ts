// app/(protected)/inventory/shared/date-utils.ts

export { computeSnapshotBounds } from "@/lib/inventory-snapshot-bounds.mjs";

/** Format string "YYYY-MM-DD" or ISO datetime to "DD-MM-YYYY". */
export function formatToVietnameseDate(d: string | null | undefined): string {
  if (!d) return "";
  const datePart = d.slice(0, 10);
  const parts = datePart.split("-");
  if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
  return datePart;
}

/** Returns exact one-year-shift bounds. */
export function applySamePeriodLastYearDates(effStart: string, effEnd: string) {
  const startDate = new Date(effStart);
  const endDate = new Date(effEnd);
  startDate.setFullYear(startDate.getFullYear() - 1);
  endDate.setFullYear(endDate.getFullYear() - 1);
  const format = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { newStart: format(startDate), newEnd: format(endDate) };
}
