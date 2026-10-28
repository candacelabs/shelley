import type {
  GitTour,
  GitTourEntry,
  GitTourHeaderEntry,
  GitTourMediaEntry,
} from "../../services/api";
import { analyzeTourPatch } from "./commitTourPatch";

export const TOUR_OVERVIEW_ANCHOR = "tour-overview";
export const TOUR_DECISIONS_ANCHOR = "tour-decisions";
export const TOUR_QUESTIONS_ANCHOR = "tour-questions";

export interface TourOverviewItem {
  anchor: string;
  label: string;
  kind: "overview";
}

export interface TourSectionItem {
  anchor: string;
  label: string;
  kind: "section";
}

export interface TourChangeItem {
  anchor: string;
  label: string;
  kind: "change";
  trivial: boolean;
  treePath: string[];
  decoration?: string;
  decorationTitle?: string;
  additions: number;
  deletions: number;
}

export interface TourMediaItem {
  anchor: string;
  label: string;
  kind: "media";
  video: boolean;
}

export type TourContentsItem = TourOverviewItem | TourSectionItem | TourChangeItem | TourMediaItem;

export type TourContentsRow =
  | {
      kind: "directory";
      key: string;
      label: string;
    }
  | {
      kind: "change";
      key: string;
      item: TourChangeItem;
      depth: number;
    }
  | {
      kind: "media";
      key: string;
      item: TourMediaItem;
    }
  | {
      kind: "file";
      key: string;
      anchor: string;
      label: string;
      filenameStem: string;
      filenameSuffix: string;
      depth: number;
    };

export interface TourContentsGroup {
  section: TourSectionItem | null;
  rows: TourContentsRow[];
}

export interface TourContentsLayout {
  // Front matter ahead of the narrative: overview, decisions, questions.
  lead: TourOverviewItem[];
  groups: TourContentsGroup[];
}

export function tourEntryAnchor(position: number): string {
  return `tour-entry-${position}`;
}

export function isHeaderEntry(entry: GitTourEntry): entry is GitTourHeaderEntry {
  return "header" in entry;
}

export function isMediaEntry(entry: GitTourEntry): entry is GitTourMediaEntry {
  return "blob" in entry;
}

export function isVideoMedia(entry: GitTourMediaEntry): boolean {
  return entry.mime.startsWith("video/");
}

export function headerLabel(markdown: string): string {
  const firstLine = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return "Section";
  return firstLine
    .replace(/^#{1,6}\s*/, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .trim();
}

export function buildTourContents(tour: GitTour, includeOverview: boolean): TourContentsItem[] {
  const contents: TourContentsItem[] = [];
  if (includeOverview || tour.title || tour.intro) {
    contents.push({ anchor: TOUR_OVERVIEW_ANCHOR, label: "Overview", kind: "overview" });
  }
  if (tour.decisions?.length) {
    contents.push({
      anchor: TOUR_DECISIONS_ANCHOR,
      label: "Key design decisions",
      kind: "overview",
    });
  }
  if (tour.questions?.length) {
    contents.push({
      anchor: TOUR_QUESTIONS_ANCHOR,
      label: `Questions (${tour.questions.length})`,
      kind: "overview",
    });
  }

  tour.chunks.forEach((entry, position) => {
    if (isHeaderEntry(entry)) {
      contents.push({
        anchor: tourEntryAnchor(position),
        label: headerLabel(entry.header),
        kind: "section",
      });
      return;
    }
    if (isMediaEntry(entry)) {
      contents.push({
        anchor: tourEntryAnchor(position),
        label: entry.name,
        kind: "media",
        video: isVideoMedia(entry),
      });
      return;
    }
    const patch = analyzeTourPatch(entry.patch);
    const decoration = patch.displayRange
      ? `L${patch.displayRange[0]}${patch.displayRange[0] === patch.displayRange[1] ? "" : `–${patch.displayRange[1]}`}`
      : undefined;
    contents.push({
      anchor: tourEntryAnchor(position),
      label: `${patch.label}${patch.additions ? ` +${patch.additions}` : ""}${patch.deletions ? ` −${patch.deletions}` : ""}`,
      kind: "change",
      trivial: !!entry.trivial,
      treePath: patch.fileLabel.split("/"),
      decoration,
      decorationTitle: patch.displayRange
        ? `${patch.displayRange[0]}–${patch.displayRange[1]}`
        : undefined,
      additions: patch.additions,
      deletions: patch.deletions,
    });
  });
  return contents;
}

export function buildTourContentsLayout(items: TourContentsItem[]): TourContentsLayout {
  const lead = items.filter((item): item is TourOverviewItem => item.kind === "overview");
  const groups: TourContentsGroup[] = [];
  let current: TourContentsGroup = { section: null, rows: [] };
  let previousDirectory = "";
  let previousFile = "";

  const finishGroup = () => {
    if (current.section || current.rows.length > 0) groups.push(current);
  };

  for (const item of items) {
    if (item.kind === "overview") continue;
    if (item.kind === "section") {
      finishGroup();
      current = { section: item, rows: [] };
      previousDirectory = "";
      previousFile = "";
      continue;
    }
    if (item.kind === "media") {
      current.rows.push({ kind: "media", key: item.anchor, item });
      // A change after media starts its file tree afresh; otherwise it would
      // read as belonging to the media row above it.
      previousDirectory = "";
      previousFile = "";
      continue;
    }

    const directories = item.treePath.slice(0, -1);
    const directory = directories.join("\0");
    if (directories.length > 0 && directory !== previousDirectory) {
      current.rows.push({
        kind: "directory",
        key: `directory:${item.anchor}`,
        label: directories.join(" / "),
      });
    }
    previousDirectory = directory;

    // Only coalesce consecutive chunks: sorting by file would reorder the narrative.
    const file = item.treePath.join("/");
    const depth = directories.length > 0 ? 1 : 0;
    if (file !== previousFile) {
      const filename = item.treePath.at(-1) || item.label;
      const lastDot = filename.lastIndexOf(".");
      const previousDot = lastDot > 0 ? filename.lastIndexOf(".", lastDot - 1) : -1;
      const suffixStart = previousDot > 0 ? previousDot : lastDot;
      current.rows.push({
        kind: "file",
        key: `file:${item.anchor}`,
        anchor: item.anchor,
        label: file,
        filenameStem: suffixStart > 0 ? filename.slice(0, suffixStart) : filename,
        filenameSuffix: suffixStart > 0 ? filename.slice(suffixStart) : "",
        depth,
      });
    }
    previousFile = file;
    current.rows.push({ kind: "change", key: item.anchor, item, depth: depth + 1 });
  }
  finishGroup();

  return { lead, groups };
}
