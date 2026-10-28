// Live microphone level meter shared by the chat and diff-viewer recorders.
// Calls onLevels once per animation frame with one 0.1–1 level per bar; the
// returned function stops metering and releases the audio graph.
export function startRecordingMeter(
  stream: MediaStream,
  bars: number,
  onLevels: (levels: number[]) => void,
): () => void {
  if (stream.getAudioTracks().length === 0 || typeof AudioContext !== "function") return () => {};

  const context = new AudioContext();
  if (typeof context.createAnalyser !== "function") {
    void context.close();
    return () => {};
  }
  const analyser = context.createAnalyser();
  analyser.fftSize = 64;
  analyser.smoothingTimeConstant = 0.7;
  const source = context.createMediaStreamSource(stream);
  source.connect(analyser);
  if (context.state === "suspended") void context.resume();

  const samples = new Uint8Array(analyser.fftSize);
  let levels = Array.from({ length: bars }, () => 0.15);
  let frame: number | null = null;
  const draw = () => {
    analyser.getByteTimeDomainData(samples);
    levels = levels.map((level, index) => {
      const start = Math.floor((index / bars) * samples.length);
      const end = Math.floor(((index + 1) / bars) * samples.length);
      let peak = 0;
      for (let sampleIndex = start; sampleIndex < end; sampleIndex++) {
        peak = Math.max(peak, Math.abs((samples[sampleIndex] ?? 128) - 128));
      }
      const target = Math.max(0.1, Math.min(1, Math.pow(peak / 128, 0.65) * 2.3));
      return target >= level ? target : Math.max(0.1, level * 0.8 + target * 0.2);
    });
    onLevels(levels);
    frame = requestAnimationFrame(draw);
  };
  draw();

  return () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    source.disconnect();
    analyser.disconnect();
    void context.close();
  };
}
