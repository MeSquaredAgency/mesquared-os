/**
 * Speech to text for voice notes and video. One adapter (Deepgram, by URL)
 * because it is a single HTTP call; without DEEPGRAM_API_KEY nothing is
 * transcribed and the source waits for a pasted transcript, which the console
 * says plainly.
 *
 * Needs: DEEPGRAM_API_KEY. The media URL must be reachable by Deepgram (a
 * presigned object-storage URL is fine).
 */
export interface Transcriber {
  readonly name: string;
  transcribe(mediaUrl: string): Promise<{ text: string; durationSeconds: number | null }>;
}

export const deepgramTranscriber: Transcriber = {
  name: "deepgram",
  async transcribe(mediaUrl) {
    const key = process.env.DEEPGRAM_API_KEY;
    if (!key) throw new Error("DEEPGRAM_API_KEY is not set.");
    const url = new URL("https://api.deepgram.com/v1/listen");
    url.searchParams.set("model", process.env.DEEPGRAM_MODEL ?? "nova-2");
    url.searchParams.set("smart_format", "true");
    url.searchParams.set("punctuate", "true");
    const res = await fetch(url, { method: "POST", headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ url: mediaUrl }), signal: AbortSignal.timeout(120_000) });
    const json = (await res.json().catch(() => ({}))) as { results?: { channels?: { alternatives?: { transcript?: string }[] }[] }; metadata?: { duration?: number }; err_msg?: string };
    if (!res.ok) throw new Error(`Deepgram HTTP ${res.status}: ${json.err_msg ?? "transcription failed"}`);
    const text = json.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
    if (!text) throw new Error("Deepgram returned an empty transcript.");
    return { text, durationSeconds: typeof json.metadata?.duration === "number" ? Math.round(json.metadata.duration) : null };
  },
};

export function getTranscriber(env: Record<string, string | undefined> = process.env): Transcriber | null {
  return env.DEEPGRAM_API_KEY ? deepgramTranscriber : null;
}
