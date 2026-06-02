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
 * Manual/rollover openings are start-of-day, so movements start on S.
 * Stocktake openings are end-of-day, so movements start on S + 1 day.
 * Also derives the previous snapshot period bounds for "So với kỳ trước".
 */
type SnapshotBoundRow = {
  period_month: string;
  source_stocktake_id?: string | null;
  deleted_at?: string | null;
};

function addDays(dateStr: string, days: number) {
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function firstDayOfMonth(dateStr: string) {
  return `${dateStr.slice(0, 7)}-01`;
}

function isEndOfDaySnapshot(dateStr: string, openings: SnapshotBoundRow[]) {
  const rowsOnDate = openings.filter(o => !o.deleted_at && o.period_month.slice(0, 10) === dateStr);
  return rowsOnDate.length > 0 && rowsOnDate.every(o => !!o.source_stocktake_id);
}

function movementStartForSnapshot(dateStr: string, openings: SnapshotBoundRow[]) {
  return isEndOfDaySnapshot(dateStr, openings) ? addDays(dateStr, 1) : dateStr;
}

export function computeSnapshotBounds(qStart: string, qEnd: string, openings: SnapshotBoundRow[]) {
  const liveOpenings = openings.filter(o => !o.deleted_at);
  const distinctDates = Array.from(new Set(
    liveOpenings.map(o => o.period_month.slice(0, 10))
  )).sort();

  // Find S: largest snapshot <= qEnd
  let S: string | null = null;
  let sIndex = -1;
  for (let i = distinctDates.length - 1; i >= 0; i--) {
    if (distinctDates[i] <= qEnd) {
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
    effectiveStart = S < qEnd ? movementStartForSnapshot(S, liveOpenings) : S;
    if (effectiveStart < qStart) effectiveStart = qStart;
  }

  // "So với kỳ trước" dates
  let prevSnapshotQStart = qStart;
  let prevSnapshotQEnd = qStart;
  
  if (S) {
    prevSnapshotQEnd = isEndOfDaySnapshot(S, liveOpenings) ? S : addDays(S, -1);
    if (S_prev) {
      prevSnapshotQStart = movementStartForSnapshot(S_prev, liveOpenings);
    } else {
      prevSnapshotQStart = firstDayOfMonth(S);
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
