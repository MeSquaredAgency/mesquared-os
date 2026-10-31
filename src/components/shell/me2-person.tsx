import { Mail } from "lucide-react";
import { Avatar } from "@/components/shell/avatar";
import { Button } from "@/components/ui/button";
import { repository } from "@/lib/data";
import { cn } from "@/lib/utils";

/**
 * The person at Me² who looks after this workspace: the operator assigned to
 * it. "Your Me² person" is how the brand talks about the service, so the
 * portal shows them beside the page title. Server component.
 */
export async function Me2Person({ tenantId, className }: { tenantId: string; className?: string }) {
  const people = await repository.listTenantPeople(tenantId);
  const person = people.find((p) => p.via === "operator") ?? null;
  const fallbackEmail = process.env.DEFAULT_FROM_EMAIL || null;
  const email = person?.email ?? fallbackEmail;
  const name = person?.name ?? "The Me² team";
  const first = person ? name.split(/\s+/)[0] : "us";
  return (
    <div className={cn("surface flex items-center gap-3 py-2.5 pr-2.5 pl-3", className)}>
      <Avatar name={person ? name : null} photoUrl={person?.photoUrl} size="md" />
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="text-2xs font-medium text-muted-foreground">Your Me² person</span>
        <span className="truncate text-sm font-medium">{name}</span>
      </div>
      {email && (
        <Button asChild variant="outline" size="sm" className="ml-2">
          <a href={`mailto:${email}`}>
            <Mail /> Talk to {first}
          </a>
        </Button>
      )}
    </div>
  );
}
