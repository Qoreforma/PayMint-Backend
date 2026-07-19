export type StatsPeriod = "1d" | "7d" | "1m" | "custom";

export interface PeriodFilter {
  period?: StatsPeriod;
  startDate?: string | Date;
  endDate?: string | Date;
}

// Returns a Mongo-ready { $gte, $lte } object, or undefined for "all time".
// Non-breaking: every existing caller passes {} today and gets undefined back,
// identical to current behavior (no createdAt filter applied).
export function resolveDateRange(filters: PeriodFilter = {}): { $gte: Date; $lte: Date } | undefined {
  const now = new Date();

  if (filters.period && filters.period !== "custom") {
    const start = new Date(now);
    if (filters.period === "1d") start.setDate(start.getDate() - 1);
    if (filters.period === "7d") start.setDate(start.getDate() - 7);
    if (filters.period === "1m") start.setMonth(start.getMonth() - 1);
    return { $gte: start, $lte: now };
  }

  if (filters.startDate && filters.endDate) {
    return { $gte: new Date(filters.startDate), $lte: new Date(filters.endDate) };
  }

  return undefined;
}