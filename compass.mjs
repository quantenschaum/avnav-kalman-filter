import {
  isNumber,
  quaternionToHeading,
  dir,
  to180,
  to360,
  devmode,
} from "./utils.mjs";

function log(...a) {
  if (!devmode) return;
  console.log("🧭", ...a);
}

let hasCompass = null;

export function compassAvailable() {
  return new Promise((resolve) => {
    log("available", hasCompass);
    if (hasCompass != null) resolve(hasCompass);
    startCompass(
      (hdg, stop) => {
        stop();
        resolve((hasCompass = true));
      },
      () => resolve((hasCompass = false)),
    );
  });
}

let closeCurrentCompass = null;

export function compass(magvar = 0) {
  closeCurrentCompass?.();
  const container = document.querySelector("body");
  container.querySelector(".compass-overlay")?.remove();

  return new Promise((resolve, reject) => {
    const overlay = document.createElement("div");
    overlay.className = "compass-overlay";
    overlay.innerHTML = "<div>…</div>";

    let heading = null;
    let closed = false;
    let stopSensor = () => {};

    function finish(error, event) {
      event?.preventDefault();
      event?.stopPropagation();
      if (closed) return;
      closed = true;
      try {
        stopSensor();
      } catch (stopError) {
        log("unable to stop compass sensor", stopError);
      }
      overlay.remove();
      if (closeCurrentCompass === close) closeCurrentCompass = null;
      if (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      } else if (heading == null) {
        reject(new Error("No compass heading was received before closing"));
      } else {
        resolve(heading);
      }
    }

    function update(hdm) {
      if (!isNumber(hdm)) return;
      heading = hdm;
      const hdt = to360(hdm + magvar);
      overlay.innerHTML = `<div class="mag">${dir(hdm)}M</div>`;
      if (magvar) {
        overlay.innerHTML += `<div class="var">${magvar >= 0 ? "+" : ""}${magvar.toFixed(1)}°</div>`;
        overlay.innerHTML += `<div class="tru">${dir(hdt)}T</div>`;
      }
    }

    function close(event) {
      finish(null, event);
    }

    function fail(error) {
      finish(error);
    }

    closeCurrentCompass = close;
    overlay.onclick = close;
    container.append(overlay);
    try {
      stopSensor = startCompass(update, fail, 500, 100);
      if (closed) stopSensor();
    } catch (error) {
      fail(error);
    }
  });
}

function startCompass(onHeading, onError, timeout = 500) {
  if (devmode) {
    log("sim compass");
    let stopped = false;
    let timer = null;
    const stop = () => {
      if (stopped) return;
      log("sim stop");
      stopped = true;
      clearInterval(timer);
    };
    const emitHeading = () => {
      if (!stopped) {
        const hdg = -5 + Math.random() * 10;
        log("sim", hdg);
        onHeading(hdg, stop);
      }
    };
    emitHeading();
    timer = setInterval(emitHeading, 200);
    return stop;
  }
  log("start compass");

  let sensor = null;
  let handler = null;
  let heading = null;
  let absolute = false;
  let fallbackTimer = null;
  let readingTimer = null;
  let orientationRequested = false;
  let stopped = false;

  function clearSources() {
    log("clearSources");
    if (fallbackTimer !== null) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    if (readingTimer !== null) {
      clearTimeout(readingTimer);
      readingTimer = null;
    }
    if (sensor) {
      const activeSensor = sensor;
      sensor = null;
      try {
        activeSensor.stop();
      } catch (error) {
        log("unable to stop orientation sensor", error);
      }
    }
    if (handler) {
      window.removeEventListener("deviceorientation", handler, true);
      window.removeEventListener("deviceorientationabsolute", handler, true);
      handler = null;
    }
  }

  function stop() {
    log("stop");
    if (stopped) return;
    stopped = true;
    clearSources();
  }

  function fail(error) {
    log("fail", error);
    if (stopped) return;
    stop();
    onError(error instanceof Error ? error : new Error(String(error)));
  }

  function armReadingTimeout() {
    if (readingTimer !== null) clearTimeout(readingTimer);
    readingTimer = setTimeout(() => {
      readingTimer = null;
      fail(new Error("Compass sensor stopped producing readings"));
    }, timeout);
  }

  function applyHeading(hdm) {
    if (stopped || !isNumber(hdm)) return;
    if (!isNumber(heading)) heading = hdm;
    const delta = to180(hdm - heading);
    const alpha = Math.max(0.2, Math.min(0.05 * Math.abs(delta), 1));
    heading = to360(heading + alpha * delta);
    log("HDM", heading);
    onHeading(heading, stop);
    armReadingTimeout();
  }

  function startDeviceOrientation() {
    if (stopped) return;
    const OrientationEvent = window.DeviceOrientationEvent;
    if (typeof OrientationEvent === "undefined") {
      fail(new Error("Device orientation is unavailable"));
      return;
    }

    log("startDeviceOrientation");
    clearSources();
    handler = (e) => {
      if (stopped) return;
      log(e);
      let hdg = null;
      if (typeof e.webkitCompassHeading === "number") {
        hdg = e.webkitCompassHeading;
      } else if (typeof e.alpha === "number") {
        hdg = 360 - e.alpha;
      }
      absolute ||= e.absolute === true;
      if (absolute && !e.absolute) return;
      applyHeading(hdg);
    };

    window.addEventListener("deviceorientation", handler, true);
    window.addEventListener("deviceorientationabsolute", handler, true);
    armReadingTimeout();
  }

  function requestPermissionAndStartOrientation() {
    log("request permission");
    if (stopped || orientationRequested) return;
    orientationRequested = true;
    const OrientationEvent = window.DeviceOrientationEvent;
    if (typeof OrientationEvent === "undefined") {
      fail(new Error("No supported orientation sensor is available"));
      return;
    }

    if (typeof OrientationEvent.requestPermission === "function") {
      if (readingTimer !== null) {
        clearTimeout(readingTimer);
        readingTimer = null;
      }
      try {
        Promise.resolve(OrientationEvent.requestPermission())
          .then((state) => {
            if (stopped) return;
            if (state === "granted") startDeviceOrientation();
            else fail(new Error("Device orientation permission was denied"));
          })
          .catch(fail);
      } catch (error) {
        fail(error);
      }
    } else {
      startDeviceOrientation();
    }
  }

  if (typeof window.AbsoluteOrientationSensor === "function") {
    try {
      sensor = new window.AbsoluteOrientationSensor({ frequency: 30 });
      const activeSensor = sensor;
      log("compass", activeSensor);
      activeSensor.addEventListener("error", (e) => {
        if (stopped) return;
        log("orientation sensor error", e);
        requestPermissionAndStartOrientation();
      });
      activeSensor.addEventListener("reading", () => {
        if (!stopped && sensor === activeSensor) {
          applyHeading(quaternionToHeading(activeSensor.quaternion));
        }
      });
      activeSensor.start();
      armReadingTimeout();

      fallbackTimer = setTimeout(() => {
        fallbackTimer = null;
        if (!stopped && heading == null) requestPermissionAndStartOrientation();
      }, 1200);
    } catch (error) {
      if (!stopped) requestPermissionAndStartOrientation();
    }
  } else {
    requestPermissionAndStartOrientation();
  }

  return stop;
}
