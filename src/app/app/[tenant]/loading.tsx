/** The shape of a portal page while it loads: header, a list, a row of tiles. */
export default function PortalLoading() {
  return (
    <div className="flex flex-col gap-10" aria-busy="true" aria-live="polite">
      <div className="flex flex-col gap-2.5">
        <div className="h-3 w-40 animate-pulse rounded-full bg-muted" />
        <div className="h-8 w-80 max-w-full animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded-full bg-muted" />
      </div>
      <div className="flex flex-col gap-3">
        <div className="h-5 w-32 animate-pulse rounded-full bg-muted" />
        <div className="surface h-56 animate-pulse" />
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="surface h-24 animate-pulse" />
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
