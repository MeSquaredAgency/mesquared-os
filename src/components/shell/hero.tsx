import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The Me² motif: a navy slab bleeding off the top edge with coral and haze
 * satellites, and the 8px coral square repeated on a 20px pitch. Decorative
 * only; sits in the corner of a dark panel.
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

interface HeroProps {
  /** A small line above the headline: the date, the section, the count. */
  kicker?: string;
  title: ReactNode;
  lede?: ReactNode;
  /** Sits to the right on wide screens: the Me² person, a number, a form. */
  aside?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/** The dark panel that opens a page: kicker → display headline → lede → actions, with the motif in the corner. */
export function Hero({ kicker, title, lede, aside, children, className }: HeroProps) {
  return (
    <section data-theme="abyss" className={cn("panel-dark relative overflow-hidden rounded-2xl px-6 py-8 text-foreground md:px-10 md:py-11", className)}>
      <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-12">
        <div className="flex max-w-2xl flex-col gap-5 lg:py-2">
          {kicker && <p className="kicker">{kicker}</p>}
          <h1 className="display">{title}</h1>
          {lede && <p className="lede">{lede}</p>}
          {children && <div className="mt-1 flex flex-wrap gap-3">{children}</div>}
        </div>
        <div className="flex flex-col justify-between gap-6 lg:-mt-11 lg:-mr-10">
          <Motif className="hidden w-[320px] self-end lg:block" />
          {aside && <div className="lg:mr-10">{aside}</div>}
        </div>
      </div>
    </section>
  );
}
