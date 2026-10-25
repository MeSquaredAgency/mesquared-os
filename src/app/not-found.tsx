import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h1 className="text-xl font-semibold">That page doesn’t exist</h1>
      <p className="max-w-sm text-sm text-muted-foreground">The link may be out of date, or the page may have moved.</p>
      <Button asChild variant="outline">
        <Link href="/">Back to the start</Link>
      </Button>
    </main>
  );
}
