"use client";

import { useEffect, useSyncExternalStore } from "react";
import { BellRing, Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deletePushSubscriptionAction, pushPublicKey, savePushSubscriptionAction, sendTestPushAction } from "@/lib/push/actions";

/**
 * Notifications on this device, shared by the prompt and the account menu.
 * "install" is an iPhone or iPad in the browser: Apple only allows
 * notifications once the OS is added to the Home Screen and opened from there.
 */
export type PushState = "loading" | "unsupported" | "install" | "off" | "denied" | "on" | "unavailable";

interface Store {
  state: PushState;
  busy: boolean;
  note: string | null;
}

let store: Store = { state: "loading", busy: false, note: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<Store>) => {
  store = { ...store, ...patch };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));
const SERVER: Store = { state: "loading", busy: false, note: null };

function toKey(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array) => !!a && a.byteLength === b.byteLength && new Uint8Array(a).every((v, i) => v === b[i]);

function isAppleMobile() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) || isAppleMobile() ? "iPad" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Computer";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return os === "iPhone" || os === "iPad" ? os : `${browser} on ${os}`;
}

async function registration() {
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  return reg;
}

/** Subscribes (or refreshes an existing subscription) and tells the server about it. */
async function connect(): Promise<PushState> {
  const key = await pushPublicKey();
  if (!key) return "unavailable";
  const reg = await registration();
  const appKey = toKey(key);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options.applicationServerKey, appKey)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
  const saved = await savePushSubscriptionAction({ ...sub.toJSON(), device: deviceLabel() });
  return saved.ok ? "on" : "unavailable";
}

let started = false;
async function init() {
  if (started) return;
  started = true;
  try {
    if (!("serviceWorker" in navigator) || !("Notification" in window) || !("PushManager" in window)) return set({ state: isAppleMobile() && !isStandalone() ? "install" : "unsupported" });
    if (Notification.permission === "denied") return set({ state: "denied" });
    if (Notification.permission === "granted") return set({ state: await connect() });
    set({ state: "off" });
  } catch {
    set({ state: "off" });
  }
}

export async function enablePush() {
  set({ busy: true, note: null });
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return set({ state: permission === "denied" ? "denied" : "off" });
    const state = await connect();
    set({ state, note: state === "on" ? "Notifications are on for this device." : "Notifications aren't set up on this server yet." });
  } catch {
    set({ note: "This browser couldn't turn notifications on." });
  } finally {
    set({ busy: false });
  }
}

export async function disablePush() {
  set({ busy: true, note: null });
  try {
    const sub = await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription();
    if (sub) {
      await deletePushSubscriptionAction(sub.endpoint);
      await sub.unsubscribe();
    }
    set({ state: "off", note: "Notifications are off for this device." });
  } finally {
    set({ busy: false });
  }
}

export async function testPush() {
  set({ busy: true });
  try {
    const r = await sendTestPushAction();
    set({ note: r.message });
  } finally {
    set({ busy: false });
  }
}

export function usePush(): Store {
  const snapshot = useSyncExternalStore(subscribe, () => store, () => SERVER);
  useEffect(() => {
    void init();
  }, []);
  return snapshot;
}

const DISMISS_KEY = "msq.push.dismissedAt";
const DISMISS_DAYS = 14;

function dismissedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return Date.now() - at < DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

/**
 * The one-time ask at the top of the app. It only shows while this device
 * could have notifications but doesn't, and "Not now" hides it for two weeks.
 */
export function PushPrompt({ audience }: { audience: "client" | "operator" }) {
  const { state, busy } = usePush();
  const hidden = useSyncExternalStore(subscribe, () => dismissedNow ?? dismissedRecently(), () => true);
  if (hidden || (state !== "off" && state !== "install")) return null;
  const who = audience === "client" ? "Me² messages you" : "a client messages you";
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {}
    dismissedNow = true;
    listeners.forEach((l) => l());
  };
  return (
    <div role="region" aria-label="Notifications" className="surface rise mb-6 flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 sm:flex-nowrap">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">{state === "install" ? <Share className="size-4" aria-hidden="true" /> : <BellRing className="size-4" aria-hidden="true" />}</span>
      <p className="min-w-0 flex-1 text-sm">
        {state === "install" ? (
          <>
            <span className="font-medium">Get notifications on this {/iPad/.test(navigator.userAgent) ? "iPad" : "iPhone"}.</span> <span className="text-muted-foreground">Tap Share, then Add to Home Screen, and open the OS from your Home Screen.</span>
          </>
        ) : (
          <>
            <span className="font-medium">Get a notification when {who} or a deadline is close.</span> <span className="text-muted-foreground">On this device, instantly. Messages never show their text on your lock screen.</span>
          </>
        )}
      </p>
      <div className="flex shrink-0 items-center gap-1.5">
        {state === "off" && (
          <Button size="sm" disabled={busy} onClick={() => void enablePush()}>
            {busy ? "Turning on…" : "Turn on"}
          </Button>
        )}
        <Button size={state === "off" ? "sm" : "icon"} variant="ghost" onClick={dismiss} aria-label="Not now" className={state === "off" ? "" : "size-8"}>
          {state === "off" ? "Not now" : <X />}
        </Button>
      </div>
    </div>
  );
}

let dismissedNow: boolean | null = null;
