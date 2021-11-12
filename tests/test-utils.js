export function doubleRaf() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });
}

export function fail(msg) {
  window.parent?.postMessage(msg, "*");
}

export function success() {
  window.parent?.postMessage(true, "*");
}

export function nextEvent(el, name) {
  return new Promise((resolve) =>
    el.addEventListener(name, resolve, { once: true })
  );
}

export function assert(bool, msg) {
  if (!bool) {
    throw Error(msg);
  }
}

export function timeout(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function testSuite(name, cb) {
  try {
    await Promise.race([
      cb(),
      timeout(2000).then(() => {
        throw Error(`Timeout`);
      }),
    ]);
  } catch (e) {
    console.error(e);
    fail(`${name}: ${e}`);
    return;
  }
  success();
}
