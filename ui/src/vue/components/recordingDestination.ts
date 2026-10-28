export type RecordingMode = "microphone" | "screen";

// A recording is bound at start, never to the conversation selected at stop.
export interface RecordingDestination {
  conversationId: string;
  complete: (path: string, context: string) => Promise<void>;
  // stillWanted is checked after the lookup, before navigating.
  returnTo: (stillWanted: () => boolean) => Promise<void>;
}

export interface RecordingPreparation {
  resolve: () => Promise<RecordingDestination>;
  release: () => void;
}
