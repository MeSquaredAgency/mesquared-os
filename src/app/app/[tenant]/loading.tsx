/** The shape of a portal page while it loads: header, three numbers, a list. */
export default function PortalLoading() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-live="polite">
      <div className="flex flex-col gap-2">
        <div className="h-3 w-40 animate-pulse rounded-full bg-muted" />
        <div className="h-7 w-72 max-w-full animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded-full bg-muted" />
      </div>
      <div className="surface grid grid-cols-2 gap-px overflow-hidden bg-border lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse bg-card" />
        ))}
      </div>
      <div className="h-5 w-32 animate-pulse rounded-full bg-muted" />
      <div className="surface h-56 animate-pulse" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
