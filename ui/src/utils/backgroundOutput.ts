// The bash tool result ends with a bracketed trailer for the model, naming the
// job and giving instructions. Use the structured job metadata to remove that
// trailer from the UI, without editing the message the model receives or
// depending on the instructions' wording.
export interface BackgroundJobDisplay {
  jobId: string;
  logPath: string;
  pgid: number;
}

export function backgroundOutput(text: string, job: BackgroundJobDisplay): string {
  const header = ` background job ${job.jobId} (PGID ${job.pgid}). Log: ${job.logPath}\n`;
  const at = text.lastIndexOf(header);
  // An unrecognized trailer may contain IDs or instructions for the model.
  // Fail closed rather than showing it as command output.
  if (at < 0 || !text.endsWith(`Cancel with \`kill -- -${job.pgid}\`.]`)) return "";

  const prefix = text.slice(0, at);
  const start = /(?:^|\n)\[(?:Started as|Still running after [^\n]+; moved to)$/.exec(prefix);
  if (!start) return "";
  return prefix.slice(0, start.index).replace(/\n$/, "");
}
