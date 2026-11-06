import Link from "next/link";
import { notFound } from "next/navigation";
import { getConsoleContext } from "@/lib/auth/access";

/** The operator's access to a workspace in the console, or a 404. */
export async function consoleWorkspace(slug: string) {
  const { tenants, user } = await getConsoleContext();
  const access = tenants.find((t) => t.tenant.slug === slug);
  if (!access) notFound();
  return { access, user };
}

export function ConsoleCrumbs({ slug, name, section }: { slug: string; name: string; section?: { href: string; label: string } }) {
  return (
    <>
      <Link href="/console" className="hover:text-foreground hover:underline">
        Portfolio
      </Link>
      <span aria-hidden="true">/</span>
      <Link href={`/console/${slug}`} className="hover:text-foreground hover:underline">
        {name}
      </Link>
      {section && (
        <>
          <span aria-hidden="true">/</span>
          <Link href={section.href} className="hover:text-foreground hover:underline">
            {section.label}
          </Link>
        </>
      )}
    </>
  );
}
