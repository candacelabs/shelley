import type { Message, QueuedMessage } from "../types";

export interface LiveTranscriptTurn {
  user: boolean;
  text: string;
}

interface Fragment extends LiveTranscriptTurn {
  through: number;
  startMs: number;
  endMs: number;
}

const thoughtGapMs = 1500;
const userThoughtGapMs = 5000;

export function readLiveDeliveryID(message: Message | QueuedMessage): string | undefined {
  if (!message.user_data) return;
  try {
    const userData =
      typeof message.user_data === "string" ? JSON.parse(message.user_data) : message.user_data;
    return typeof userData === "object" &&
      userData !== null &&
      typeof (userData as { live_delivery_id?: unknown }).live_delivery_id === "string"
      ? (userData as { live_delivery_id: string }).live_delivery_id
      : undefined;
  } catch {
    return;
  }
}

export class LiveTranscript {
  private count = 0;
  private consumed = 0;
  private fragments: Fragment[] = [];
  private handoffs = new Map<number, { deliveryID: string; fragments?: number[] }>();

  append(user: boolean, text: string, startMs: number, endMs: number) {
    this.fragments.push({ through: ++this.count, user, text, startMs, endMs });
  }

  handoff(through: number, deliveryID: string, fragments?: number[]) {
    if (through > this.consumed) this.handoffs.set(through, { deliveryID, fragments });
  }

  private consume(ids: readonly number[]) {
    const consumed = new Set(ids);
    this.fragments = this.fragments.filter((fragment) => !consumed.has(fragment.through));
  }

  reconcile(savedDeliveryIDs: readonly string[]) {
    const saved = new Set(savedDeliveryIDs);
    for (const [through, handoff] of [...this.handoffs].sort(([a], [b]) => a - b)) {
      if (!saved.has(handoff.deliveryID)) continue;
      if (handoff.fragments) this.consume(handoff.fragments);
      else this.consumed = Math.max(this.consumed, through);
      this.handoffs.delete(through);
    }
    this.fragments = this.fragments.filter((fragment) => fragment.through > this.consumed);
    for (const through of this.handoffs.keys()) {
      if (through <= this.consumed) this.handoffs.delete(through);
    }
  }

  get turns(): LiveTranscriptTurn[] {
    const turns: Array<LiveTranscriptTurn & { startMs: number; endMs: number; through: number }> =
      [];
    const latest = new Map<boolean, (typeof turns)[number]>();
    const fragments = [...this.fragments].sort(
      (a, b) => a.startMs - b.startMs || a.through - b.through,
    );
    for (const fragment of fragments) {
      const last = latest.get(fragment.user);
      const punctuationOnly = /^[\s\p{P}]+$/u.test(fragment.text);
      const sentenceClosing = /^[,;:.!?…]+(?:["'”’)\]}]+)?$/u.test(fragment.text.trim());
      const nonAudible = punctuationOnly && (sentenceClosing || fragment.text.trim() === "");
      const responseIntervened =
        last &&
        turns.some(
          (turn) =>
            turn.user !== fragment.user &&
            turn.startMs >= last.endMs &&
            turn.startMs <= fragment.startMs,
        );
      const gap =
        fragment.user && (!last || fragment.through > last.through)
          ? userThoughtGapMs
          : thoughtGapMs;
      if (
        last &&
        !responseIntervened &&
        (nonAudible || (!punctuationOnly && fragment.startMs - last.endMs <= gap))
      ) {
        last.text += fragment.text;
        last.through = Math.max(last.through, fragment.through);
        if (!punctuationOnly) last.endMs = Math.max(last.endMs, fragment.endMs);
      } else if (nonAudible) {
        // A delayed sentence closer cannot begin a new audible turn.
        continue;
      } else {
        const turn = {
          user: fragment.user,
          text: fragment.text,
          startMs: fragment.startMs,
          endMs: punctuationOnly ? fragment.startMs : fragment.endMs,
          through: fragment.through,
        };
        turns.push(turn);
        latest.set(fragment.user, turn);
      }
    }
    return turns
      .filter((turn) => /[^\s\p{P}]/u.test(turn.text))
      .map(({ user, text }) => ({
        user,
        text: text.replace(/\s+([.,!?;:…])/gu, "$1").replace(/\s*\n\s*/gu, " "),
      }));
  }
}
