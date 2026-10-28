// Follow the Shelley app's theme setting. Load it in <head> so the page
// never paints in the wrong theme.
{
  const theme = localStorage.getItem("shelley-theme");
  document.documentElement.classList.toggle(
    "dark",
    theme === "dark" || (theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches),
  );
}
