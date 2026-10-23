export default function ConsoleLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <div className="h-6 w-40 animate-pulse rounded bg-muted" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl border bg-card" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-xl border bg-card" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
