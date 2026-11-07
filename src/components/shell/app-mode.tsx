"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/**
 * App plumbing on every page: registers the service worker (notifications,
 * and the offline screen for a page opened with no signal) and says plainly
 * when the connection drops, since an installed app has no browser around it
 * to say so.
 */
export function AppMode() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;
  return (
    <div role="status" className="fixed inset-x-0 z-50 flex justify-center px-4" style={{ top: "calc(env(safe-area-inset-top) + 0.75rem)" }}>
      <span className="flex items-center gap-2 rounded-full bg-navy px-4 py-2 text-sm font-medium text-white shadow-[0_8px_24px_#1b232c40]">
        <WifiOff className="size-4" aria-hidden="true" />
        You&rsquo;re offline. Changes will fail until you&rsquo;re back.
      </span>
    </div>
  );
}
