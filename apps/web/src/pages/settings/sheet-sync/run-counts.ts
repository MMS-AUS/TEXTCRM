/** "2 new · 1 updated · 1 skipped" — only the parts that happened. */
export function runCounts(run: {
  rowsRead: number;
  created: number;
  updated: number;
  linked: number;
  skipped: number;
  errors: number;
}): string {
  const parts = [
    run.created && `${String(run.created)} new`,
    run.updated && `${String(run.updated)} updated`,
    run.linked && `${String(run.linked)} linked`,
    run.skipped && `${String(run.skipped)} skipped`,
    run.errors && `${String(run.errors)} ${run.errors === 1 ? 'error' : 'errors'}`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : `${String(run.rowsRead)} rows read — no changes`;
}
