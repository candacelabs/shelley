// Shelley may be served under a prefix (csf serves it at /shelley/): the
// server says where in the page's <base href> and in init data's base_path,
// so the UI's URLs are relative and resolve under the mount. Run standalone,
// the base is "/".

/** basePath is the path Shelley is mounted at, ending in "/" ("/" outside a page). */
export function basePath(): string {
  return (typeof window !== "undefined" && window.__SHELLEY_INIT__?.base_path) || "/";
}

/** routePath is a pathname inside the mount: "/c/x" whether Shelley is at "/" or "/shelley/". */
export function routePath(pathname: string = window.location.pathname): string {
  const base = basePath();
  return pathname.startsWith(base) ? "/" + pathname.slice(base.length) : pathname;
}
