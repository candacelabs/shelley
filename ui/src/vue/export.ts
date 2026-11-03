// Extract the /export/<id> conversation id from the current path.
import { routePath } from "../utils/basePath";

export function exportConversationIdFromPath(): string | null {
  const m = routePath().match(/^\/export\/([^/]+)\/?$/);
  return m ? decodeURIComponent(m[1]) : null;
}
