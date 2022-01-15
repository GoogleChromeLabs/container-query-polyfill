/**
 * Copyright 2021 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { transpileStyleSheet } from "./engine.js";

function init() {
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
    // Don’t touch empty style tags.
    if (el.innerHTML.trim().length === 0) return;
    const newSrc = transpileStyleSheet(el.innerHTML);
    el.innerHTML = newSrc;
  }

  async function handleLinkedStylesheet(el: HTMLLinkElement) {
    if (el.rel !== "stylesheet") return;
    const srcUrl = new URL(el.href, document.baseURI);
    if (srcUrl.origin !== location.origin) return;
    const src = await fetch(srcUrl.toString()).then((r) => r.text());
    const newSrc = transpileStyleSheet(src, srcUrl.toString());
    const blob = new Blob([newSrc], { type: "text/css" });
    el.href = URL.createObjectURL(blob);
  }

  document.querySelectorAll("style").forEach((tag) => handleStyleTag(tag));
  document
    .querySelectorAll("link")
    .forEach((tag) => handleLinkedStylesheet(tag));
}

const supportsContainerQueries = "container" in document.documentElement.style;
if (!supportsContainerQueries) {
  init();
}

export { transpileStyleSheet };
