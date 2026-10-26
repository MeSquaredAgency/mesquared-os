export const metadata = { title: "Data deletion" };

/**
 * Public page Meta requires of every app: how a person gets their data
 * removed. The platform holds Facebook and Instagram data only on behalf of
 * the business whose page it is, so requests are honoured per business.
 * Styled with plain utilities so it renders the same on every branch.
 */
export default function DataDeletionPage() {
  const email = process.env.DEFAULT_FROM_EMAIL || "hello@mesquaredagency.com";
  return (
    <main className="min-h-screen bg-background px-5 py-12 text-foreground md:px-10 md:py-20">
      <article className="mx-auto flex max-w-2xl flex-col gap-8">
        <header className="flex flex-col gap-3">
          <p className="text-sm font-medium text-muted-foreground">MeSquared OS</p>
          <h1 className="text-3xl font-semibold tracking-tight">How to have your data deleted</h1>
          <p className="text-lg text-muted-foreground">MeSquared OS runs operations and marketing for businesses. When one of those businesses connects its Facebook page or Instagram account, we hold a small amount of data on its behalf. Here is what that is and how to have it removed.</p>
        </header>

        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold tracking-tight">What we hold</h2>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-base">
            <li>Answers you submitted on a lead form run by that business, and the name, email and phone you gave with them.</li>
            <li>Comments and messages you sent to that business’s page or account, so a person can reply.</li>
            <li>Reviews you left for the business.</li>
          </ul>
          <p className="text-base text-muted-foreground">We do not hold your Facebook or Instagram password, your friends, or anything from your own profile beyond the name shown on the message or form.</p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold tracking-tight">How to ask</h2>
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-base">
            <li>
              Email <a className="underline underline-offset-4" href={`mailto:${email}?subject=Data%20deletion%20request`}>{email}</a> with the subject “Data deletion request”.
            </li>
            <li>Tell us the business you contacted and the name, email or phone number you used, so we can find the records.</li>
            <li>We confirm within 7 days and delete the records within 30 days, then confirm again when it is done.</li>
          </ol>
          <p className="text-base text-muted-foreground">You can also ask the business directly. They can remove you from their records in the platform themselves.</p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold tracking-tight">Disconnecting the app</h2>
          <p className="text-base">If you are a business and want to disconnect entirely, remove the app under Settings, Business integrations on Facebook. Your page data stops flowing to us the moment you do, and the stored records go with the deletion request above.</p>
        </section>

        <footer className="border-t pt-6 text-sm text-muted-foreground">
          Me² · <a className="underline underline-offset-4" href="https://mesquaredagency.com/privacy">Privacy policy</a>
        </footer>
      </article>
    </main>
  );
}
