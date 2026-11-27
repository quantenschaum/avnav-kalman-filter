import assert from "node:assert/strict";
import test from "node:test";

function makeBrowser({ orientationSupported = true } = {}) {
  const listeners = new Map();
  const timers = new Set();
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = () => {
    const timer = Symbol("timer");
    timers.add(timer);
    return timer;
  };
  globalThis.clearTimeout = (timer) => timers.delete(timer);
  const body = {
    children: [],
    append(element) {
      element.parent = this;
      this.children.push(element);
    },
    querySelector(selector) {
      return selector === ".compass-overlay"
        ? (this.children.find((element) => !element.removed) ?? null)
        : null;
    },
  };

  class FakeElement {
    constructor() {
      this.className = "";
      this.innerHTML = "";
      this.removed = false;
    }

    remove() {
      this.removed = true;
      this.parent.children = this.parent.children.filter(
        (element) => element !== this,
      );
    }
  }

  globalThis.document = {
    createElement: () => new FakeElement(),
    querySelector: (selector) => (selector === "body" ? body : null),
  };
  globalThis.window = {
    location: { search: "" },
    DeviceOrientationEvent: orientationSupported ? class {} : undefined,
    addEventListener(name, handler) {
      const handlers = listeners.get(name) ?? new Set();
      handlers.add(handler);
      listeners.set(name, handlers);
    },
    removeEventListener(name, handler) {
      listeners.get(name)?.delete(handler);
    },
    emit(name, event) {
      for (const handler of listeners.get(name) ?? []) handler(event);
    },
  };

  return {
    body,
    listeners,
    timers,
    restoreTimers() {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    },
  };
}

function restoreGlobal(name, previous) {
  if (previous === undefined) delete globalThis[name];
  else globalThis[name] = previous;
}

test(
  "compass displays magnetic and true headings and resolves on close",
  { concurrency: false },
  async () => {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const { body, listeners, timers, restoreTimers } = makeBrowser();
    const { compass } = await import("../compass.mjs?heading-test");

    try {
      const result = compass(5);
      const overlay = body.children[0];
      assert.equal(overlay.className, "compass-overlay");

      window.emit("deviceorientation", {
        absolute: true,
        webkitCompassHeading: 359,
      });
      assert.match(overlay.innerHTML, /359°M/);
      assert.match(overlay.innerHTML, /\+5\.0°/);
      assert.match(overlay.innerHTML, /004°T/);

      overlay.onclick();
      assert.equal(await result, 359);
      assert.equal(overlay.removed, true);
      assert.equal(
        [...listeners.values()].every((handlers) => handlers.size === 0),
        true,
      );
      assert.equal(timers.size, 0);
    } finally {
      restoreTimers();
      restoreGlobal("window", previousWindow);
      restoreGlobal("document", previousDocument);
    }
  },
);

test(
  "closing compass before a heading rejects and removes its overlay",
  { concurrency: false },
  async () => {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const { body, timers, restoreTimers } = makeBrowser();
    const { compass } = await import("../compass.mjs?close-test");

    try {
      const result = compass();
      const overlay = body.children[0];
      overlay.onclick();

      await assert.rejects(
        result,
        /No compass heading was received before closing/,
      );
      assert.equal(overlay.removed, true);
      assert.equal(timers.size, 0);
    } finally {
      restoreTimers();
      restoreGlobal("window", previousWindow);
      restoreGlobal("document", previousDocument);
    }
  },
);

test(
  "compass availability resolves true after receiving a heading",
  { concurrency: false },
  async () => {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const { timers, restoreTimers } = makeBrowser();
    const { compassAvailable } = await import("../compass.mjs?available-test");

    try {
      const available = compassAvailable();
      window.emit("deviceorientation", {
        absolute: true,
        webkitCompassHeading: 42,
      });

      assert.equal(await available, true);
      assert.equal(await compassAvailable(), true);
      assert.equal(timers.size, 0);
    } finally {
      restoreTimers();
      restoreGlobal("window", previousWindow);
      restoreGlobal("document", previousDocument);
    }
  },
);

test(
  "compass availability resolves false when orientation is unsupported",
  { concurrency: false },
  async () => {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const { timers, restoreTimers } = makeBrowser({
      orientationSupported: false,
    });
    const { compassAvailable } =
      await import("../compass.mjs?unsupported-test");

    try {
      assert.equal(await compassAvailable(), false);
      assert.equal(await compassAvailable(), false);
      assert.equal(timers.size, 0);
    } finally {
      restoreTimers();
      restoreGlobal("window", previousWindow);
      restoreGlobal("document", previousDocument);
    }
  },
);
