/**
 * Shared by the inventory web pages and the OpenClaw read-only CLI.
 * Manual/rollover openings are start-of-day; stocktake openings are end-of-day.
 * @typedef {{ period_month: string, source_stocktake_id?: string | null, deleted_at?: string | null }} SnapshotBoundRow
 */

function addDays(dateStr, days) {
  const date = new Date(`${dateStr.slice(0, 10)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function firstDayOfMonth(dateStr) {
  return `${dateStr.slice(0, 7)}-01`;
}

/** @param {string} dateStr @param {SnapshotBoundRow[]} openings */
function isEndOfDaySnapshot(dateStr, openings) {
  const rowsOnDate = openings.filter((opening) =>
    !opening.deleted_at && opening.period_month.slice(0, 10) === dateStr);
  return rowsOnDate.length > 0 && rowsOnDate.every((opening) => Boolean(opening.source_stocktake_id));
}

/** @param {string} dateStr @param {SnapshotBoundRow[]} openings */
function movementStartForSnapshot(dateStr, openings) {
  return isEndOfDaySnapshot(dateStr, openings) ? addDays(dateStr, 1) : dateStr;
}

/**
 * Derives the effective snapshot period for a selected range [qStart, qEnd].
 * @param {string} qStart
 * @param {string} qEnd
 * @param {SnapshotBoundRow[]} openings
 */
export function computeSnapshotBounds(qStart, qEnd, openings) {
  const liveOpenings = openings.filter((opening) => !opening.deleted_at);
  const distinctDates = Array.from(new Set(
    liveOpenings.map((opening) => opening.period_month.slice(0, 10)),
  )).sort();

  let snapshot = null;
  let snapshotIndex = -1;
  for (let index = distinctDates.length - 1; index >= 0; index -= 1) {
    if (distinctDates[index] <= qEnd) {
      snapshot = distinctDates[index];
      snapshotIndex = index;
      break;
    }
  }

  const previousSnapshot = snapshotIndex > 0 ? distinctDates[snapshotIndex - 1] : null;
  let effectiveStart = qStart;
  if (snapshot && snapshot >= qStart) {
    effectiveStart = snapshot < qEnd
      ? movementStartForSnapshot(snapshot, liveOpenings)
      : snapshot;
    if (effectiveStart < qStart) effectiveStart = qStart;
  }

  let prevSnapshotQStart = qStart;
  let prevSnapshotQEnd = qStart;
  if (snapshot) {
    prevSnapshotQEnd = isEndOfDaySnapshot(snapshot, liveOpenings)
      ? snapshot
      : addDays(snapshot, -1);
    if (previousSnapshot) {
      prevSnapshotQStart = movementStartForSnapshot(previousSnapshot, liveOpenings);
    } else {
      prevSnapshotQStart = firstDayOfMonth(snapshot);
      if (prevSnapshotQStart > prevSnapshotQEnd) prevSnapshotQStart = prevSnapshotQEnd;
    }
  } else {
    const endDate = new Date(`${qEnd}T00:00:00.000Z`);
    endDate.setUTCDate(0);
    prevSnapshotQEnd = `${endDate.getUTCFullYear()}-${String(endDate.getUTCMonth() + 1).padStart(2, "0")}-${String(endDate.getUTCDate()).padStart(2, "0")}`;
    prevSnapshotQStart = `${endDate.getUTCFullYear()}-${String(endDate.getUTCMonth() + 1).padStart(2, "0")}-01`;
  }

  return {
    S: snapshot,
    effectiveStart,
    effectiveEnd: qEnd,
    prevSnapshotQStart,
    prevSnapshotQEnd,
  };
}
