import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "MeSquared OS", template: "%s · MeSquared OS" },
  description: "Multi-tenant operations, social marketing and revenue platform.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
