import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main data-theme="paper" className="flex min-h-screen flex-col items-center justify-center gap-5 bg-background p-6 text-center text-foreground">
      <p className="kicker">404</p>
      <h1 className="page-title">That page doesn’t exist</h1>
      <p className="lede text-center">The link may be out of date, or the page may have moved.</p>
      <Button asChild variant="outline">
        <Link href="/">Back to the start</Link>
      </Button>
    </main>
  );
}
