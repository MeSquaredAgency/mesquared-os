import { cn } from "@/lib/utils";

/**
 * A person's initials on a deep colour picked from their name (so the same
 * name always gets the same colour and a list of people reads as people, not
 * a column of identical discs), the coral square when there is no name, or
 * their photo. No server imports: client components use it too.
 */
const HUES = [
  "bg-[linear-gradient(135deg,#1b3853,#2d5a86)]",
  "bg-[linear-gradient(135deg,#2e5e4e,#3f8a6e)]",
  "bg-[linear-gradient(135deg,#6b3f2a,#a6412a)]",
  "bg-[linear-gradient(135deg,#4a3d6b,#6d5a9c)]",
  "bg-[linear-gradient(135deg,#7a5a16,#b4731a)]",
  "bg-[linear-gradient(135deg,#1f4f5c,#2f7f90)]",
  "bg-[linear-gradient(135deg,#5c2e4a,#8a4a72)]",
];

function hue(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}

export function Avatar({ name, photoUrl, size = "md", className }: { name: string | null; photoUrl?: string | null; size?: "sm" | "md" | "lg"; className?: string }) {
  const dim = { sm: "size-7 text-2xs", md: "size-9 text-xs", lg: "size-12 text-sm" }[size];
  if (photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={photoUrl} alt="" className={cn(dim, "shrink-0 rounded-full object-cover shadow-[inset_0_0_0_1px_#1b232c14]", className)} />;
  }
  const initials = (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <span aria-hidden="true" className={cn(dim, "grid shrink-0 place-items-center rounded-full font-semibold text-cream shadow-[inset_0_0_0_1px_#ffffff1f]", initials ? hue(name ?? "") : "bg-navy", className)}>
      {initials || <i className="block size-2 bg-coral" />}
    </span>
  );
}
