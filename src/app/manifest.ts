import type { MetadataRoute } from "next";

/**
 * Makes the OS an installable app on Android, iPhone and desktop: it opens
 * full screen from the Home Screen, with its own icon and a splash in the
 * brand colours. iPhones also need this before they allow notifications.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "MeSquared OS",
    short_name: "Me² OS",
    description: "Leads, tasks and messages with Me².",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f3ede3",
    theme_color: "#faf7f1",
    categories: ["business", "productivity"],
    prefer_related_applications: false,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Tapping a notification or the icon again brings back the open app instead of a second window.
    ...({ launch_handler: { client_mode: ["navigate-existing", "auto"] } } as object),
  };
}
