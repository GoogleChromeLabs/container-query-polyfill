/**
 * Copyright 2022 Google Inc. All Rights Reserved.
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

let resolveFirstRender: (() => void) | null;
const firstRenderPromise = new Promise<void>(resolve => {
  resolveFirstRender = resolve;
});

export function handleUpdate() {
  if (resolveFirstRender) {
    resolveFirstRender();
    resolveFirstRender = null;
  }
}

export function initializeForWPT() {
  // HACK: Make WPT's testharnessreport.js think that we
  // are running in the default test environment, so that
  // we can configure it.
  if (!window.opener) {
    window.opener = window;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).testharness_properties = {
    output: true,
    timeout_multiplier: 20,
  };

  window.addEventListener('error', e => {
    e.stopImmediatePropagation();
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).waitForPolyfill = async function () {
    await firstRenderPromise;
    return await new Promise<void>(resolve => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                resolve();
              });
            });
          });
        });
      });
    });
  };

  const oldSupports = CSS.supports;
  CSS.supports = (ident: string) => {
    if (ident === 'container-type:size') {
      return true;
    }
    return oldSupports(ident);
  };
}
