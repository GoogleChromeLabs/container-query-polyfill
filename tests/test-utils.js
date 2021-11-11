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

export function assert(bool, msg) {
  if (!bool) {
    throw Error(msg);
  }
}

export async function testSuite(name, cb) {
  try {
    await cb();
  } catch (e) {
    console.error(e);
    fail(`${name}: ${e}`);
    return;
  }
  success();
}
