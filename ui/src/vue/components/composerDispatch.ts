export type ComposerSubmissionIntent = "send" | "send-now" | "queue";

export type ComposerDispatch =
  | { route: "btw"; question: string }
  | { route: "send" | "queue" | "btw-blocked" | "terminal" };

interface ComposerDispatchOptions {
  intent?: ComposerSubmissionIntent;
  isChildConversation?: boolean;
}

function btwQuestion(message: string): string | null {
  const match = message.match(/^[ \t\r\n]*\/btw(?:$|[ \t\r\n])([\s\S]*)$/);
  return match ? match[1].trim() : null;
}

export function composerDispatch(
  message: string,
  options: ComposerDispatchOptions = {},
): ComposerDispatch {
  if (message.trim() === "!" || message.trim() === "/shell") return { route: "terminal" };

  const question = btwQuestion(message);
  if (question !== null) {
    if (options.isChildConversation) return { route: "btw-blocked" };
    return { route: "btw", question };
  }

  const intent = options.intent ?? "send";
  if (intent === "queue") return { route: "queue" };
  return { route: "send" };
}

export function composerSessionID(
  conversationID: string | null | undefined,
  lazyDraftID: string | null | undefined,
): string | null {
  return conversationID === lazyDraftID ? null : (conversationID ?? null);
}

export function guardComposerClear(
  origin: { session: string | null; generation: number },
  current: () => { session: string | null; generation: number },
  clear: () => void,
): void {
  const value = current();
  if (value.session === origin.session && value.generation === origin.generation) clear();
}
