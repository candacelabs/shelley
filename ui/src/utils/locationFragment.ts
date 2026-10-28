export function replaceLocationFragment(fragment: string) {
  history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}${fragment ? `#${fragment}` : ""}`,
  );
}
