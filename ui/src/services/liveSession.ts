// Browser side of a GPT-Live WebRTC session: microphone up, model audio down,
// JSON events on the "oai-events" data channel. The server brokers the SDP
// exchange (api.createLiveSession); media and events go straight to OpenAI.
import { api, type LiveConversationSettings } from "./api";

export interface LiveEvent {
  type: string;
  [key: string]: unknown;
}

const START_TIMEOUT_MS = 15_000;
const CLOSE_TIMEOUT_MS = 15_000;

export class LiveSession {
  private closed = false;
  /** Live's session id, which also names Shelley's side of the call. */
  id = "";

  private constructor(
    private readonly pc: RTCPeerConnection,
    private readonly events: RTCDataChannel,
    private readonly mic: MediaStream,
    private readonly audio: HTMLAudioElement,
  ) {}

  // Connects and resolves once the server reports session.started. onEvent
  // receives every event from then on; onClosed fires once if the session
  // ends on its own. Aborting the signal while connecting releases the
  // microphone and rejects; conversationId may create the conversation only
  // once the microphone and network are ready.
  static async start(
    conversationId: () => Promise<string>,
    onEvent: (event: LiveEvent) => void,
    onClosed: (error?: Error) => void,
    signal: AbortSignal,
    settings?: () => LiveConversationSettings | undefined,
  ): Promise<LiveSession> {
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    const pc = new RTCPeerConnection();
    const audio = new Audio();
    audio.autoplay = true;
    pc.ontrack = (e) => {
      audio.srcObject = e.streams[0] ?? new MediaStream([e.track]);
    };
    for (const track of mic.getAudioTracks()) pc.addTrack(track, mic);
    const events = pc.createDataChannel("oai-events");
    const session = new LiveSession(pc, events, mic, audio);

    let fail: (err: Error) => void;
    const failed = new Promise<never>((_, reject) => (fail = reject));
    const started = new Promise<void>((resolve) => {
      events.onmessage = (e) => {
        let event: LiveEvent;
        try {
          event = JSON.parse(e.data as string) as LiveEvent;
        } catch {
          return;
        }
        if (event.type === "session.started") resolve();
        onEvent(event);
      };
    });
    const finish = (err?: Error) => {
      if (session.closed) return;
      session.release();
      fail(err ?? new Error("Cancelled"));
      onClosed(err);
    };
    events.onclose = () => finish();
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") finish(new Error("Live connection failed"));
    };
    signal.addEventListener("abort", () => finish(), { once: true });
    const timer = setTimeout(
      () => finish(new Error("Timed out starting the live session")),
      START_TIMEOUT_MS,
    );

    try {
      await Promise.race([
        failed,
        (async () => {
          await pc.setLocalDescription(await pc.createOffer());
          if (pc.iceGatheringState !== "complete") {
            await new Promise<void>((resolve) =>
              pc.addEventListener("icegatheringstatechange", () => {
                if (pc.iceGatheringState === "complete") resolve();
              }),
            );
          }
          const id = await conversationId();
          const answer = await api.createLiveSession(
            id,
            pc.localDescription!.sdp,
            signal,
            settings?.(),
          );
          session.id = answer.session.id;
          await pc.setRemoteDescription({ type: "answer", sdp: answer.transport.sdp });
          await started;
        })(),
      ]);
    } catch (err) {
      finish(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      clearTimeout(timer);
    }
    return session;
  }

  get muted(): boolean {
    return this.mic.getAudioTracks().every((t) => !t.enabled);
  }

  get microphoneStream(): MediaStream {
    return this.mic;
  }

  setMuted(muted: boolean): void {
    for (const t of this.mic.getAudioTracks()) t.enabled = !muted;
  }

  send(event: LiveEvent): void {
    if (this.closed || this.events.readyState !== "open") {
      throw new Error("Live session is not connected");
    }
    this.events.send(JSON.stringify(event));
  }

  // User-initiated stop. The microphone and speaker go quiet at once; the
  // transport stays up until the server acknowledges session.close (or
  // drops the channel, or CLOSE_TIMEOUT_MS passes). No events reach the
  // caller after this.
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const t of this.mic.getTracks()) t.stop();
    this.audio.muted = true;
    this.pc.onconnectionstatechange = null;
    this.events.onclose = () => this.release();
    this.events.onmessage = (e) => {
      if (String(e.data).includes('"session.closed"')) this.release();
    };
    if (this.events.readyState !== "open") return this.release();
    setTimeout(() => this.release(), CLOSE_TIMEOUT_MS);
    this.events.send(JSON.stringify({ type: "session.close" }));
  }

  private release(): void {
    this.closed = true;
    this.events.onmessage = null;
    this.events.onclose = null;
    this.pc.onconnectionstatechange = null;
    this.events.close();
    this.pc.close();
    for (const t of this.mic.getTracks()) t.stop();
    this.audio.srcObject = null;
  }
}
