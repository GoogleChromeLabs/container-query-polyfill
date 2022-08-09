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

export function doubleRaf() {
  return new Promise(resolve => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });
}

export function fail(msg) {
  window.parent?.postMessage(msg, '*');
}

export function success() {
  window.parent?.postMessage(true, '*');
}

export function nextEvent(el, name) {
  return new Promise(resolve =>
    el.addEventListener(name, resolve, {once: true})
  );
}

export function assert(bool, msg) {
  if (!bool) {
    throw Error(msg);
  }
}

export function assertEquals(a, b, msg) {
  if (a !== b) {
    throw Error(`Expected ${a} == ${b}. ${msg}`);
  }
}

export function timeout(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function testSuite(name, cb) {
  try {
    await Promise.race([
      cb(),
      // timeout(2000).then(() => {
      //   throw Error(`Timeout`);
      // }),
    ]);
  } catch (e) {
    console.error(e);
    fail(`${name}: ${e}`);
    return;
  }
  success();
  console.log('Test passed successfully');
}
