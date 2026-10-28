const COPY_ICON =
  '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

const CHECK_ICON =
  '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';

function languageLabel(code: HTMLElement): string {
  for (const className of code.classList) {
    const match = /^language-(.+)$/.exec(className);
    if (match) return match[1];
  }
  return "text";
}

export function addCodeBlockHeaders(root: HTMLElement): void {
  for (const code of root.querySelectorAll<HTMLElement>("pre > code")) {
    const pre = code.parentElement;
    if (!pre || pre.parentElement?.classList.contains("shelley-code-block")) continue;

    const wrapper = document.createElement("div");
    wrapper.className = "shelley-code-block";

    const header = document.createElement("div");
    header.className = "shelley-code-header";

    const language = document.createElement("span");
    language.textContent = languageLabel(code);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "shelley-code-copy";
    button.setAttribute("aria-label", "Copy code");
    button.dataset.tooltip = "Copy code";
    button.innerHTML = COPY_ICON;

    pre.replaceWith(wrapper);
    header.append(language, button);
    wrapper.append(header, pre);
  }
}

export function codeBlockText(button: HTMLButtonElement): string | undefined {
  const code = button.closest(".shelley-code-block")?.querySelector("pre > code");
  return code?.textContent?.replace(/\n$/, "");
}

export function setCodeBlockCopied(button: HTMLButtonElement, copied: boolean): void {
  button.classList.toggle("shelley-code-copy-success", copied);
  button.setAttribute("aria-label", copied ? "Code copied" : "Copy code");
  button.dataset.tooltip = copied ? "Copied" : "Copy code";
  button.innerHTML = copied ? CHECK_ICON : COPY_ICON;
}
