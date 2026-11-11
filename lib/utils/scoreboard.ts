export type PerformanceMetric = 'verified_revenue' | 'closed_deals' | 'signed_contracts' | 'dials_period';

// Competition ranks: 1, 1, 3. Names only stabilize display order, never break ties.
export function rankManagers<T extends Record<PerformanceMetric, number> & { full_name: string }>(rows: T[], metric: PerformanceMetric) {
  const sorted = [...rows].sort((a, b) => Number(b[metric]) - Number(a[metric]) || a.full_name.localeCompare(b.full_name));
  let rank = 0;
  return sorted.map((row, index) => {
    if (index === 0 || Number(row[metric]) !== Number(sorted[index - 1][metric])) rank = index + 1;
    return { ...row, rank, prev_rank: null, has_activity: Number(row[metric]) > 0 };
  });
}
