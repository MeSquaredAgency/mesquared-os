import { cn } from "@/lib/utils";

/**
 * A navy circle with initials, the coral square when there is no name, or the
 * person's photo. No server imports: client components use it too.
 */
export function Avatar({ name, photoUrl, size = "md", className }: { name: string | null; photoUrl?: string | null; size?: "sm" | "md" | "lg"; className?: string }) {
  const dim = { sm: "size-8", md: "size-10", lg: "size-14" }[size];
  if (photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={photoUrl} alt="" className={cn(dim, "shrink-0 rounded-full object-cover", className)} />;
  }
  const initials = (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <span aria-hidden="true" className={cn(dim, "grid shrink-0 place-items-center rounded-full bg-navy text-sm font-medium text-cream", className)}>
      {initials || <i className="block size-2 bg-coral" />}
    </span>
  );
}
