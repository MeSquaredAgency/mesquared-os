/**
 * Inbound SMS keywords. Carriers and the Spam Act treat the single words
 * below as an opt-out; anything longer is a conversation. "Cancel my
 * appointment" is not an unsubscribe and "Yes, Tuesday works" is not consent,
 * so only a message that is the keyword (plus punctuation) counts.
 */
const STOP = new Set(["stop", "stopall", "stop all", "unsubscribe", "end", "quit", "opt out", "optout"]);
const START = new Set(["start", "unstop", "subscribe", "opt in", "optin"]);

function keyword(body: string): string {
  return body
    .toLowerCase()
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the whole message is an opt-out keyword. */
export function isStopMessage(body: string): boolean {
  return STOP.has(keyword(body));
}

/** True when the whole message is an opt-in keyword. */
export function isStartMessage(body: string): boolean {
  return START.has(keyword(body));
}
