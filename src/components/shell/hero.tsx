import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The Me² motif: a navy slab bleeding off the top edge with coral and haze
 * satellites, and the 8px coral square repeated on a 20px pitch. Decorative
 * only; used on the sign-in panel, never inside the working screens.
 */
export function Motif({ className }: { className?: string }) {
  const dots: ReactNode[] = [];
  for (let row = 0; row < 5; row++) for (let col = 0; col < 6; col++) dots.push(<rect key={`${row}-${col}`} x={40 + col * 20} y={40 + row * 20} width="8" height="8" fill="var(--coral)" />);
  return (
    <svg viewBox="0 0 460 300" aria-hidden="true" className={cn("pointer-events-none select-none", className)}>
      <rect x="0" y="-20" width="280" height="248" rx="18" fill="var(--navy)" />
      <rect x="296" y="-20" width="164" height="140" rx="18" fill="var(--coral)" />
      <rect x="296" y="136" width="164" height="172" rx="18" fill="var(--haze)" />
      <rect x="0" y="244" width="120" height="64" rx="18" fill="var(--coral-deep)" />
      {dots}
    </svg>
  );
}
