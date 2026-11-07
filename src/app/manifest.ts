import type { MetadataRoute } from "next";

/** Makes the OS installable, which iPhones require before a web app may show notifications. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MeSquared OS",
    short_name: "Me² OS",
    description: "Leads, tasks and messages with Me².",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f3ede3",
    theme_color: "#0d1116",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/me2-app-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
