import { Avatar } from "@/components/shell/avatar";
import { Button } from "@/components/ui/button";
import { repository } from "@/lib/data";
import { cn } from "@/lib/utils";

/**
 * The person at Me² who looks after this workspace: the operator assigned to
 * it. "Your Me² person" is how the brand talks about the service, so the
 * portal leads with them rather than with a dashboard. Server component.
 */
export async function Me2Person({ tenantId, className }: { tenantId: string; className?: string }) {
  const people = await repository.listTenantPeople(tenantId);
  const person = people.find((p) => p.via === "operator") ?? null;
  const fallbackEmail = process.env.DEFAULT_FROM_EMAIL || null;
  const email = person?.email ?? fallbackEmail;
  const name = person?.name ?? "The Me² team";
  return (
    <div className={cn("flex flex-col gap-4 rounded-xl border bg-card/70 p-5", className)}>
      <div className="flex items-center gap-4">
        <Avatar name={person ? name : null} photoUrl={person?.photoUrl} size="lg" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="kicker text-xs">Your Me² person</span>
          <span className="truncate text-base font-medium">{name}</span>
          <span className="truncate text-sm text-muted-foreground">{person?.title ?? "Looking after your back office"}</span>
        </div>
      </div>
      {email && (
        <Button asChild size="sm" className="w-full">
          <a href={`mailto:${email}`}>Talk to {person ? name.split(/\s+/)[0] : "us"}</a>
        </Button>
      )}
    </div>
  );
}
