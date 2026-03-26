// app/(protected)/inventory/shared/date-utils.ts

/**
 * Format string "YYYY-MM-DD" or ISO datetime to "DD-MM-YYYY"
 */
export function formatToVietnameseDate(d: string | null | undefined): string {
  if (!d) return "";
  const datePart = d.slice(0, 10);
  const parts = datePart.split("-");
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return datePart;
}

/**
 * Derives the effective snapshot period given a user-selected range [qStart, qEnd].
 * Finds the latest snapshot S strictly before qEnd.
 * The effective period starts at max(qStart, S + 1 day).
 * Also derives the previous snapshot period bounds for "So với kỳ trước".
 */
export function computeSnapshotBounds(qStart: string, qEnd: string, openings: { period_month: string }[]) {
  const distinctDates = Array.from(new Set(
    openings.map(o => o.period_month.slice(0, 10))
  )).sort();

  // Find S: largest snapshot strictly < qEnd
  let S: string | null = null;
  let sIndex = -1;
  for (let i = distinctDates.length - 1; i >= 0; i--) {
    if (distinctDates[i] < qEnd) {
      S = distinctDates[i];
      sIndex = i;
      break;
    }
  }

  // Find S_prev: snapshot strictly < S
  let S_prev: string | null = null;
  if (sIndex > 0) {
    S_prev = distinctDates[sIndex - 1];
  }

  let effectiveStart = qStart;
  if (S && S >= qStart) {
    const sDate = new Date(S);
    sDate.setDate(sDate.getDate() + 1);
    const y = sDate.getFullYear();
    const m = String(sDate.getMonth() + 1).padStart(2, "0");
    const d = String(sDate.getDate()).padStart(2, "0");
    effectiveStart = `${y}-${m}-${d}`;
  }

  // "So với kỳ trước" dates
  let prevSnapshotQStart = qStart;
  let prevSnapshotQEnd = qStart;
  
  if (S) {
    prevSnapshotQEnd = S;
    if (S_prev) {
      const spDate = new Date(S_prev);
      spDate.setDate(spDate.getDate() + 1);
      prevSnapshotQStart = `${spDate.getFullYear()}-${String(spDate.getMonth() + 1).padStart(2, "0")}-${String(spDate.getDate()).padStart(2, "0")}`;
    } else {
      const sDate = new Date(S);
      prevSnapshotQStart = `${sDate.getFullYear()}-${String(sDate.getMonth() + 1).padStart(2, "0")}-01`;
      if (prevSnapshotQStart > prevSnapshotQEnd) prevSnapshotQStart = prevSnapshotQEnd;
    }
  } else {
    // Fallback if no snapshots exist strictly before qEnd
    const qeDate = new Date(qEnd);
    qeDate.setDate(0);
    prevSnapshotQEnd = `${qeDate.getFullYear()}-${String(qeDate.getMonth() + 1).padStart(2, "0")}-${String(qeDate.getDate()).padStart(2, "0")}`;
    const psDate = new Date(qeDate.getFullYear(), qeDate.getMonth(), 1);
    prevSnapshotQStart = `${psDate.getFullYear()}-${String(psDate.getMonth() + 1).padStart(2, "0")}-01`;
  }

  return {
    S,
    effectiveStart,
    effectiveEnd: qEnd, 
    prevSnapshotQStart,
    prevSnapshotQEnd
  };
}

/**
 * Returns exact 1 year shift bounds
 */
export function applySamePeriodLastYearDates(effStart: string, effEnd: string) {
  const sDate = new Date(effStart);
  const eDate = new Date(effEnd);
  sDate.setFullYear(sDate.getFullYear() - 1);
  eDate.setFullYear(eDate.getFullYear() - 1);
  const fmt = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  return { newStart: fmt(sDate), newEnd: fmt(eDate) };
}
