export const dayKey = (stamp: string) => /^\d{4}-\d{2}-\d{2}/.exec(stamp)?.[0] || "";
export function calendarCells(month: string): (string | null)[] {
  const [year, index] = month.split("-").map(Number);
  const first = new Date(year, index - 1, 1);
  const offset = (first.getDay() + 6) % 7;
  const length = new Date(year, index, 0).getDate();
  return Array.from({ length: Math.ceil((offset + length) / 7) * 7 }, (_, i) =>
    i < offset || i >= offset + length
      ? null
      : `${month}-${String(i - offset + 1).padStart(2, "0")}`,
  );
}
export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
export function dateCounts(records: { stamp: string; kind: string }[], kind: string) {
  const counts = new Map<string, number>();
  for (const r of records) {
    const date = dayKey(r.stamp);
    if (r.kind === kind && date) counts.set(date, (counts.get(date) || 0) + 1);
  }
  return counts;
}
