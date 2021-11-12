import { transpileStyleSheet } from "./engine.js";

const sheetObserver = new MutationObserver((entries) => {
  for (const entry of entries) {
    for (const addedNode of entry.addedNodes) {
      if (addedNode instanceof HTMLStyleElement) {
        handleStyleTag(addedNode);
      }
      if (addedNode instanceof HTMLLinkElement) {
        handleLinkedStylesheet(addedNode);
      }
    }
  }
});
sheetObserver.observe(document.documentElement, {
  childList: true,
  subtree: true,
});

function handleStyleTag(el: HTMLStyleElement) {
  const newSrc = transpileStyleSheet(el.innerHTML);
  el.innerHTML = newSrc;
}

async function handleLinkedStylesheet(el: HTMLLinkElement) {
  if (el.rel !== "stylesheet") return;
  const srcUrl = new URL(el.href, import.meta.url);
  if (srcUrl.origin !== location.origin) return;
  const src = await fetch(srcUrl.toString()).then((r) => r.text());
  const newSrc = transpileStyleSheet(src);
  const blob = new Blob([newSrc], { type: "text/css" });
  el.href = URL.createObjectURL(blob);
}

document.querySelectorAll("style").forEach((tag) => handleStyleTag(tag));
document.querySelectorAll("link").forEach((tag) => handleLinkedStylesheet(tag));

export { transpileStyleSheet };
