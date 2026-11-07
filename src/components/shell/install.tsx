"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Download, Share, SquarePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Installing the OS as an app. Chrome, Edge and Samsung Internet hand over an
 * install prompt (captured as early as possible by a script in the page head
 * and kept on window.__msqInstall); iPhone and iPad never do, so there the
 * banner shows the two taps instead. Once installed it opens full screen and
 * none of this shows.
 */
interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Window {
    __msqInstall?: InstallEvent | null;
  }
}

export interface InstallState {
  ready: boolean;
  /** Running as an installed app. */
  installed: boolean;
  /** iPhone or iPad, where installing is Share, then Add to Home Screen. */
  apple: boolean;
  /** A one-tap install is available (Android, desktop Chrome and Edge). */
  canPrompt: boolean;
  /** A phone or tablet, where the banner is worth showing. */
  touch: boolean;
}

let state: InstallState = { ready: false, installed: false, apple: false, canPrompt: false, touch: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<InstallState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));
const SERVER = state;

export function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function isAppleMobile(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

let started = false;
function init() {
  if (started) return;
  started = true;
  set({ ready: true, installed: isStandalone(), apple: isAppleMobile(), canPrompt: Boolean(window.__msqInstall), touch: window.matchMedia("(pointer: coarse)").matches });
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    window.__msqInstall = e as InstallEvent;
    set({ canPrompt: true });
  });
  window.addEventListener("appinstalled", () => {
    window.__msqInstall = null;
    set({ canPrompt: false, installed: true });
  });
  window.matchMedia("(display-mode: standalone)").addEventListener("change", () => set({ installed: isStandalone() }));
}

export function useInstall(): InstallState {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => SERVER);
  useEffect(init, []);
  return snapshot;
}

/** Shows the browser's own install dialog. False when there is none to show. */
export async function promptInstall(): Promise<boolean> {
  const e = window.__msqInstall;
  if (!e) return false;
  window.__msqInstall = null;
  set({ canPrompt: false });
  await e.prompt();
  const { outcome } = await e.userChoice;
  if (outcome === "accepted") set({ installed: true });
  return outcome === "accepted";
}

const KEY = "msq.install.dismissedAt";
let dismissedNow = false;
const dismissedRecently = () => {
  if (dismissedNow) return true;
  try {
    return Date.now() - Number(localStorage.getItem(KEY) ?? 0) < 14 * 86_400_000;
  } catch {
    return false;
  }
};

/** True while the install banner is showing, so the notifications ask waits its turn. */
export function useInstallBannerShowing(): boolean {
  const s = useInstall();
  const hidden = useSyncExternalStore(subscribe, dismissedRecently, () => true);
  return s.ready && !hidden && s.touch && !s.installed && (s.apple || s.canPrompt);
}

/** "Install Me² OS on this phone", on phones and tablets that aren't running it as an app yet. */
export function InstallPrompt() {
  const s = useInstall();
  const showing = useInstallBannerShowing();
  if (!showing) return null;
  const device = /iPad/.test(navigator.userAgent) ? "iPad" : s.apple ? "iPhone" : "phone";
  const dismiss = () => {
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {}
    dismissedNow = true;
    listeners.forEach((l) => l());
  };
  return (
    <div role="region" aria-label="Install the app" className="surface rise mb-6 flex flex-col gap-3 px-4 py-3.5">
      <div className="flex items-start gap-3.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="" className="size-10 shrink-0 rounded-[10px] shadow-[0_1px_3px_#1b232c33]" />
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-medium">Install Me² OS on this {device}.</span> <span className="text-muted-foreground">It opens full screen from your Home Screen like any app, and can notify you about messages and deadlines.</span>
        </p>
        <Button variant="ghost" size="icon" className="-mt-1 -mr-1 size-8 shrink-0" onClick={dismiss} aria-label="Not now">
          <X />
        </Button>
      </div>
      {s.apple ? (
        <ol className="flex flex-col gap-1.5 rounded-lg bg-accent/60 px-3.5 py-2.5 text-sm">
          <li className="flex items-center gap-2">
            <span className="flex size-5 items-center justify-center rounded-full bg-card text-2xs font-semibold">1</span>
            Tap <Share className="size-4 text-[#007aff]" aria-label="Share" /> {/CriOS/.test(navigator.userAgent) ? "at the top" : "in the toolbar"}.
          </li>
          <li className="flex items-center gap-2">
            <span className="flex size-5 items-center justify-center rounded-full bg-card text-2xs font-semibold">2</span>
            Choose <SquarePlus className="size-4" aria-hidden="true" /> <span className="font-medium">Add to Home Screen</span>, then Add.
          </li>
        </ol>
      ) : (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => void promptInstall()}>
            <Download /> Install
          </Button>
        </div>
      )}
    </div>
  );
}
