import { Avatar } from "@/components/shell/avatar";
import { Button } from "@/components/ui/button";
import { repository } from "@/lib/data";
import { cn } from "@/lib/utils";

/**
 * The person at Me² who looks after this workspace: the operator assigned to
 * it. "Your Me² person" is how the brand talks about the service, so the
 * portal offers them beside the page title as one quiet button with their
 * face on it. Server component.
 */
export async function Me2Person({ tenantId, className }: { tenantId: string; className?: string }) {
  const people = await repository.listTenantPeople(tenantId);
  const person = people.find((p) => p.via === "operator") ?? null;
  const fallbackEmail = process.env.DEFAULT_FROM_EMAIL || null;
  const email = person?.email ?? fallbackEmail;
  if (!email) return null;
  const name = person?.name ?? "The Me² team";
  const first = person ? name.split(/\s+/)[0] : "us";
  return (
    <Button asChild variant="outline" className={cn("gap-2 pl-1.5", className)}>
      <a href={`mailto:${email}`} title={`Your Me² person: ${name}`}>
        <Avatar name={person ? name : null} photoUrl={person?.photoUrl} size="sm" className="size-6" />
        Talk to {first}
      </a>
    </Button>
  );
}
