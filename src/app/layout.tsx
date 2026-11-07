import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

/** Instrument Sans, the Me² face: one variable file, weight 400–700, width 75–100% (headlines run condensed). */
const instrument = localFont({
  src: "./fonts/InstrumentSans-Variable.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--font-instrument",
  declarations: [{ prop: "font-stretch", value: "75% 100%" }],
});

export const metadata: Metadata = {
  title: { default: "MeSquared OS", template: "%s · MeSquared OS" },
  description: "Multi-tenant operations, social marketing and revenue platform.",
  icons: { icon: "/brand/me2-app-icon.svg", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Me² OS", statusBarStyle: "default" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="paper" className={instrument.variable} suppressHydrationWarning>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
