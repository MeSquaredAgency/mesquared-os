/** The shape of a console page while it loads: header, four numbers, a table. */
export default function ConsoleLoading() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-live="polite">
      <div className="flex flex-col gap-2">
        <div className="h-3 w-28 animate-pulse rounded-full bg-muted" />
        <div className="h-7 w-56 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded-full bg-muted" />
      </div>
      <div className="surface grid grid-cols-2 gap-px overflow-hidden bg-border xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse bg-card" />
        ))}
      </div>
      <div className="h-5 w-40 animate-pulse rounded-full bg-muted" />
      <div className="surface h-64 animate-pulse" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
