/** The shape of the portfolio while it loads: hero, five numbers, the table. */
export default function ConsoleLoading() {
  return (
    <div className="flex flex-col gap-12" aria-busy="true" aria-live="polite">
      <div className="h-72 animate-pulse rounded-2xl bg-muted" />
      <div className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse bg-card" />
        ))}
      </div>
      <div className="h-8 w-64 animate-pulse rounded-full bg-muted" />
      <div className="h-64 animate-pulse rounded-xl border bg-card" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
