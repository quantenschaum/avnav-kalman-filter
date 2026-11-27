import { degrees, log, to180, to360 } from "./utils.mjs";

function dir(a, digits = 0, magnetic = false, DEC = 0) {
  const p = digits ? 0 : 3;
  let mag = "";
  if (magnetic)
    mag = `(${to360(a - DEC)
      .toFixed(digits)
      .padStart(p, "0")}°M)`;
  return `${to360(a).toFixed(digits).padStart(p, "0")}°` + mag;
}

export function compass(DEC = 0) {
  const container = document.querySelector("body");
  let overlay = container.querySelector(".compass-overlay");
  if (overlay) overlay.remove();
  overlay = document.createElement("div");
  overlay.className = "compass-overlay";

  function update(hdg) {
    running = true;
    const mag = hdg - DEC;
    let html = '<div class="rose"></div>';
    html += `<div class="mag">${dir(mag)}M</div>`;
    html += `<div class="dec">${DEC >= 0 ? "+" : ""}${DEC.toFixed(1)}°</div>`;
    html += `<div class="tru">${dir(hdg)}T</div>`;
    html += `<div class="tme">${new Date().toLocaleTimeString("de-DE")}</div>`;
    overlay.innerHTML = html;
    const rose = overlay.querySelector(".rose");
    rose.style.transform = `translate(-50%, -50%) rotate(${-mag}deg)`.trim();
  }

  function remove(e) {
    log("remove", e);
    e.preventDefault();
    e.stopPropagation();
    stopCompass();
    overlay.remove();
  }

  let running = false;

  function freeze(e) {
    log("freeze", e);
    e.preventDefault();
    e.stopPropagation();
    if (running) {
      stopCompass();
      running = false;
      overlay.classList.add("frozen");
    } else {
      startCompass(update, DEC);
      overlay.classList.remove("frozen");
    }
  }

  overlay.onclick = freeze;
  overlay.ondblclick = remove;

  container.append(overlay);
  update(0);
  startCompass(update, DEC);
}

function isNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function quaternionToHeading(quaternion) {
  const [x, y, z, w] = quaternion;
  let sinYaw = 2 * (w * z + x * y);
  let cosYaw = 1 - 2 * (y * y + z * z);
  let yaw = Math.atan2(sinYaw, cosYaw);
  return to360(360 - degrees(yaw));
}

let stopCompass = () => null;

function startCompass(callback, DEC = 0) {
  stopCompass();
  let sensor = null;
  let handler = null;
  let heading = null;
  let absolute = false;
  let fallbackTimer = null;

  function stop() {
    if (fallbackTimer) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    if (sensor) {
      sensor.stop();
      sensor = null;
    }
    if (handler) {
      window.removeEventListener("deviceorientation", handler, true);
      window.removeEventListener("deviceorientationabsolute", handler, true);
      handler = null;
    }
  }

  stopCompass = stop;

  function applyHeading(hdg) {
    if (!isNumber(hdg)) return;
    hdg = to360(hdg + DEC);
    if (!isNumber(heading)) heading = hdg;
    const delta = to180(hdg - heading);
    const alpha = Math.max(0.2, Math.min(0.05 * Math.abs(delta), 1));
    heading = to360(heading + alpha * delta);
    console.log("HDG", heading);
    callback(heading);
  }

  function startDeviceOrientation() {
    console.log("startDeviceOrientation");
    stop();
    handler = (e) => {
      console.log(e);
      let hdg = null;
      if (typeof e.webkitCompassHeading === "number") {
        hdg = e.webkitCompassHeading;
      } else if (typeof e.alpha === "number") {
        hdg = 360 - e.alpha;
      }
      if (isNumber(hdg)) absolute |= e.absolute;
      if (absolute && !e.absolute) return;
      applyHeading(hdg);
    };

    window.addEventListener("deviceorientation", handler, true);
    window.addEventListener("deviceorientationabsolute", handler, true);
  }

  function requestPermissionAndStartOrientation() {
    if (
      typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function"
    ) {
      DeviceOrientationEvent.requestPermission()
        .then((state) => {
          if (state === "granted") startDeviceOrientation();
          else console.warn("Device orientation permission denied");
        })
        .catch((err) => console.error(err));
    } else {
      startDeviceOrientation();
    }
  }

  if (typeof window.AbsoluteOrientationSensor === "function") {
    try {
      sensor = new window.AbsoluteOrientationSensor({ frequency: 30 });
      console.log("compass", sensor);
      sensor.addEventListener("error", (e) => {
        console.error(
          `${sensor} ${e?.error?.name || "SensorError"} ${e?.error?.message || ""}`,
        );
        if (heading == null) requestPermissionAndStartOrientation();
      });
      sensor.addEventListener("reading", () => {
        let hdg = quaternionToHeading(sensor.quaternion);
        applyHeading(hdg);
      });
      sensor.start();

      // Fallback when API exists but never produces readings (common on iOS).
      fallbackTimer = setTimeout(() => {
        if (heading == null) {
          if (sensor) {
            sensor.stop();
            sensor = null;
          }
          requestPermissionAndStartOrientation();
        }
      }, 1200);
    } catch (x) {
      console.error(x);
      requestPermissionAndStartOrientation();
    }
  } else {
    requestPermissionAndStartOrientation();
  }
}
