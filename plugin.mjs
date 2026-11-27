import {
  covEllipse,
  degrees,
  kn,
  nm,
  radians,
  round,
  to180,
  to360,
} from "./utils.mjs";

export default async (api) => {
  const devmode = new URLSearchParams(window.location.search).get("dev") == 1;
  function log(...a) {
    if (!devmode) return;
    console.log(
      "%cKF",
      "background: red; color: black; padding: 2px 4px; border-radius: 3px;",
      ...a,
    );
  }
  log("start", api, api.getAvNavVersion());
  const avnavVersion = api.getAvNavVersion();
  const LatLon = api.LatLon();

  function LonLat(lon, lat) {
    if (lon == null || lat == null) return null;
    return new LatLon(lat, lon);
  }

  const base = api.getBaseUrl();
  const modeUrl = base + "api/mode";
  const inputUrl = base + "api/input";

  const measurements = [];

  const KalmanOverlay = {
    name: "KalmanFilter",
    type: "map",
    storeKeys: {
      rtime: "nav.gps.rtime",
      var: "nav.gps.magVariation",
      pos: "nav.gps.position",
      cog: "nav.gps.course",
      sog: "nav.gps.speed",
      LON: "nav.gps.kalman.LON",
      LAT: "nav.gps.kalman.LAT",
      Pxx: "nav.gps.kalman.Pxx",
      Pyy: "nav.gps.kalman.Pyy",
      Pxy: "nav.gps.kalman.Pxy",
      COG: "nav.gps.kalman.COG",
      SOG: "nav.gps.kalman.SOG",
      CTW: "nav.gps.kalman.CTW",
      STW: "nav.gps.kalman.STW",
      SET: "nav.gps.kalman.SET",
      DFT: "nav.gps.kalman.DFT",
      model: "nav.gps.kalman.model",
      cvt: "properties.navBoatCourseTime",
      center: "map.centerPosition",
      fontsize: "properties.baseFontSize",
    },
    // initFunction: function (map, data) {log('init')},
    // finalizeFunction: function () {log('finalize')},
    renderCanvas: function (canvas, data, map) {
      // log(canvas);
      // log(data);
      // log(map);
      // log(map.pixelToLonLat(0, 0));
      // log(map.getDimensions());
      // log(map.getScale());
      // log(map.getRotation());
      // log(api.getBaseUrl());
      // console.log(api.getStoreBaseKey());
      // console.log(api.getStoreData());
      if (data?.center == null) return;
      if (data?.LON == null || data?.LAT == null) return;
      const s = map.getScale();
      const r = map.getRotation();
      const center = data.center;
      const [px0, py0] = map.lonLatToPixel(center.lon, center.lat - 0.5 / 60);
      const [px1, py1] = map.lonLatToPixel(center.lon, center.lat + 0.5 / 60);
      const ppm = Math.hypot(px1 - px0, py1 - py0) / 1852;
      // log("ppm", ppm);

      const ctx = map.getContext();
      try {
        ctx.save();

        if (measurements.length > 20) measurements.shift();
        function label(text, x, y, rot = 0, dx = 0, dy = 0) {
          if (text == null || !data.labels) return;
          ctx.save();
          ctx.translate(x, y);
          if (Math.abs(to180(rot + degrees(r))) > 90) rot += 180; // keep upright
          ctx.rotate(radians(rot));
          ctx.translate(dx, dy);
          ctx.font = `${s * data.fontsize}px Roboto, Arial, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillText(text, 0, 0);
          ctx.restore();
        }
        for (const m of measurements) {
          const [bx, by] = map.lonLatToPixel(m.lon, m.lat);
          // marker
          ctx.fillStyle = ctx.strokeStyle = m.color ?? "black";
          ctx.lineWidth = s * (m.width ?? 2);
          ctx.globalAlpha = m.alpha ?? 0.9;
          ctx.beginPath();
          ctx.arc(bx, by, s * 5, 0, radians(360));
          ctx.fill();

          if (m.brg == null && m.rng == null) {
            // fix marker
            ctx.beginPath();
            ctx.arc(bx, by, s * 10, 0, radians(360));
            ctx.stroke();
            label(m.label, bx, by, degrees(-r), 0, -s * 10);
          }
          if (m.brg != null) {
            // bearing line
            const brg = radians(m.brg + 180);
            const d = 1.1 * m.rng * ppm;
            const ex = bx + d * Math.sin(brg);
            const ey = by - d * Math.cos(brg);
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.lineTo(ex, ey);
            ctx.stroke();
            const a = to180(m.brg);
            const b = Math.sign(a) * 90;
            label(m.label, (bx + ex) / 2, (by + ey) / 2, a - b);
          }
          if (m.rng != null && m.a != null && m.b != null) {
            // range circle
            ctx.beginPath();
            const a = m.a ?? 0;
            const b = m.b ?? 360;
            ctx.arc(bx, by, m.rng * ppm, radians(a - 90), radians(b - 90));
            ctx.stroke();
            if (m.brg == null) {
              const a = to180(m.a + to180(m.b - m.a) / 2);
              const b = Math.abs(a) > 90 ? 180 : 0;
              const d = m.rng * ppm;
              const x = bx + d * Math.sin(radians(a));
              const y = by - d * Math.cos(radians(a));
              label(m.label, x, y, a + b);
            }
          }
        }

        const [tx, ty] = map.lonLatToPixel(data.LON, data.LAT);
        ctx.translate(tx, ty);

        const P = [
          [data.Pxx, data.Pxy],
          [data.Pxy, data.Pyy],
        ];
        const p = [data.confidence];
        if (p > 0) {
          const [xs, ys] = covEllipse([0, 0], P, p / 100, 128);
          ctx.beginPath();
          ctx.moveTo(xs[0] * ppm, ys[0] * ppm);
          for (let i = 1; i < xs.length; i++) {
            ctx.lineTo(xs[i] * ppm, ys[i] * ppm);
          }
          ctx.closePath();
          ctx.fillStyle = data.color;
          ctx.globalAlpha = 0.1;
          ctx.fill();
          ctx.strokeStyle = data.color;
          ctx.lineWidth = s * 2;
          ctx.globalAlpha = 0.8;
          ctx.stroke();
        }

        function speedvector(crs, spd, dash = []) {
          if (crs == null || spd == null) return;
          crs = radians(crs);
          spd *= data.cvt * ppm;
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.sin(crs) * spd, -Math.cos(crs) * spd);
          ctx.lineWidth = s * 2;
          ctx.strokeStyle = data.color;
          ctx.setLineDash(dash);
          ctx.globalAlpha = 0.8;
          ctx.stroke();
          ctx.restore();
        }

        if (data.show_cog) {
          speedvector(data.COG, data.SOG);
        }
        if (data.show_ctw) {
          speedvector(data.CTW, data.STW, [s * 6, s * 6]);
        }
        if (data.show_dft) {
          speedvector(data.SET, data.DFT, [s * 2, s * 2]);
        }

        if (data.marker == "boat") {
          ctx.save();
          ctx.rotate(radians(data.CTW ?? data.COG));
          ctx.beginPath();
          ctx.moveTo(0, -s * 20);
          ctx.lineTo(-s * 10, s * 20);
          ctx.lineTo(s * 10, s * 20);
          ctx.closePath();
          ctx.lineWidth = 1.5 * s;
          ctx.strokeStyle = "black";
          ctx.fillStyle = data.color;
          ctx.globalAlpha = 0.8;
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        } else if (data.marker == "circle") {
          ctx.beginPath();
          ctx.arc(0, 0, s * 8, 0, radians(360));
          ctx.lineWidth = 1.5 * s;
          ctx.strokeStyle = "black";
          ctx.fillStyle = data.color;
          ctx.globalAlpha = 0.8;
          ctx.fill();
          ctx.stroke();
        }
      } finally {
        ctx.restore();
      }
    },
  };

  api.registerWidget(KalmanOverlay, {
    color: {
      displayName: "overlay color",
      type: "COLOR",
      default: "magenta",
      description: "covariance ellipe color",
    },
    marker: {
      displayName: "marker",
      type: "SELECT",
      default: "boat",
      list: ["boat", "circle", "none"],
      description: "what kind of marker to display at estimated position",
    },
    confidence: {
      displayName: "confidence level",
      type: "FLOAT",
      default: 50,
      list: [0, 100],
      description: "covariance ellipe confidence level [%]",
    },
    show_cog: {
      displayName: "COG vector",
      type: "BOOLEAN",
      default: false,
      description: "display COG/SOG ground speed vector (solid line)",
    },
    show_ctw: {
      displayName: "CTW vector",
      type: "BOOLEAN",
      default: false,
      description: "display CTW/STW water speed vector (dashed line)",
    },
    show_dft: {
      displayName: "DFT vector",
      type: "BOOLEAN",
      default: false,
      description: "display SET/DFT current vector (dotted line)",
    },
    labels: {
      displayName: "show labels",
      type: "BOOLEAN",
      default: true,
      description: "add labels to bearings/ranges",
    },
  });

  async function showDialog(e) {
    const pos0 = api.getStoreData("nav.gps.position");
    const pos = LonLat(pos0?.lon, pos0?.lat);
    const cog = api.getStoreData("nav.gps.course");
    const sog = api.getStoreData("nav.gps.speed");
    const magvar = api.getStoreData("nav.gps.magVariation", 0);
    const center = api.getStoreData("map.centerPosition");
    const mode = api.getStoreData("nav.gps.kalman.mode");
    const model = api.getStoreData("nav.gps.kalman.model");
    const usegps = api.getStoreData("nav.gps.kalman.gps");
    if (center == null) return;
    // log(m, center, pos, cog, sog, magvar, center);
    const brg = to360(pos?.initialBearingTo(center) - magvar);
    const rng = pos?.distanceTo(center);
    const values = {
      brg: round(brg),
      rng: round(rng * nm, 3),
      cog: round(cog),
      sog: round(sog * kn, 1),
      update: mode != 1,
      magnetic: !!magvar,
    };
    const parameters = [];
    if (mode > 0) {
      parameters.push({
        name: "brg",
        displayName: values.magnetic ? "BRG" : "BRG (T)",
        description: "bearing to object at map obj",
        type: "FLOAT",
        list: [0, 360],
      });
      if (values.magnetic) {
        parameters.push({
          name: "magnetic",
          displayName: "magnetic",
          description: "magnetic bearing",
          type: "BOOLEAN",
        });
      }
      parameters.push(
        {
          name: "rng",
          displayName: "RNG (nm)",
          description: "range to object at map obj",
          type: "FLOAT",
          list: [0, 100, 0.1],
        },
        {
          name: "update",
          displayName: "update filter",
          description: "update the filter, disable to only draw on the chart",
          type: "BOOLEAN",
        },
      );
    }
    if (mode == 3) {
      parameters.push(
        {
          name: "cog",
          displayName: "COG (T)",
          description: "course over ground",
          type: "FLOAT",
          list: [0, 360],
        },
        {
          name: "sog",
          displayName: "SOG (kn)",
          description: "speed over ground",
          type: "FLOAT",
          list: [0, 100, 0.1],
        },
      );
    }

    let text = "";
    if (mode < 1) text += "Filter not initialized, provide a fix to start. ";
    if (mode == 1) text += "Locked to GPS. ";
    if (mode > 1) text += `Dead reckoning (${model}D). `;
    if (values.magnetic)
      text += `Variation: ${magvar > 0 ? "E" : "W"} ${Math.abs(magvar).toFixed(1)}° `;

    function time() {
      const t = api.getStoreData("nav.gps.rtime", new Date());
      return t.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    }

    api.showDialog(
      {
        title: "Kalman-Filter",
        text,
        parameters,
        values,
        buttons: [
          { name: "cancel", shortText: " " },
          {
            name: "reset",
            icon: `${base}icons/reset.svg`,
            onClick: (event, vals, close) => {
              if (!window.confirm("Reset the Kalman filter?")) return;
              fetch(`${modeUrl}?reset=true`);
              measurements.length = 0;
            },
          },
          {
            name: "cleanup",
            icon: `${base}icons/eraser.svg`,
            shortText: "cleanup",
            visible: measurements.length > 0,
            onClick: (event, vals, close) => {
              measurements.length = 0;
            },
          },
          {
            name: "gps_off",
            icon: `${base}icons/off.svg`,
            shortText: "GPS off",
            toggle: !usegps,
            onClick: (event, vals, close) => fetch(`${modeUrl}?gps=${!usegps}`),
          },
          {
            name: "c_s",
            icon: `${base}icons/cogsog.svg`,
            shortText: "C/S",
            visible: mode == 3,
            disabled: () => !(isFinite(values.cog) && isFinite(values.sog)),
            onClick: (event, vals, close) => {
              fetch(`${inputUrl}?COG=${vals.cog}&SOG=${vals.sog / kn}`);
            },
          },
          {
            name: "fix",
            icon: `${base}icons/gps.svg`,
            shortText: "FIX",
            onClick: (event, vals, close) => {
              measurements.push({
                lon: center.lon,
                lat: center.lat,
                alpha: vals.update ? 1 : 0.5,
                label: time(),
              });
              if (vals.update) {
                fetch(`${inputUrl}?LON=${center.lon}&LAT=${center.lat}`);
              }
            },
          },
          {
            name: "brgrng",
            icon: `${base}icons/brgrng.svg`,
            shortText: "BRG+RNG",
            disabled: () => !isFinite(values.brg) || !isFinite(values.rng),
            onClick: (event, vals, close) => {
              log(vals);
              const brg = to360(vals.brg + (vals.magnetic ? magvar : 0));
              measurements.push({
                lon: center.lon,
                lat: center.lat,
                brg,
                rng: vals.rng / nm,
                a: brg + 180 - 5,
                b: brg + 180 + 5,
                alpha: vals.update ? 1 : 0.5,
                label: `${vals.brg.toFixed(0)}°${vals.magnetic ? "M" : "T"}/${vals.rng.toFixed(2)}nm ${time()}`,
              });
              if (vals.update) {
                fetch(
                  `${inputUrl}?BLON=${center.lon}&BLAT=${center.lat}&BRG=${brg}&RNG=${vals.rng / nm}`,
                );
              }
            },
          },
          {
            name: "rng",
            icon: `${base}icons/rng.svg`,
            shortText: "RNG",
            disabled: () => !isFinite(values.brg) || !isFinite(values.rng),
            onClick: (event, vals, close) => {
              log(vals);
              const brg = to360(vals.brg + (vals.magnetic ? magvar : 0));
              measurements.push({
                lon: center.lon,
                lat: center.lat,
                rng: vals.rng / nm,
                a: brg + 180 - 45,
                b: brg + 180 + 45,
                alpha: vals.update ? 1 : 0.5,
                label: `${vals.rng.toFixed(2)}nm ${time()}`,
              });
              if (vals.update) {
                fetch(
                  `${inputUrl}?BLON=${center.lon}&BLAT=${center.lat}&RNG=${vals.rng / nm}`,
                );
              }
            },
          },
          {
            name: "brg",
            icon: `${base}icons/brg.svg`,
            shortText: "BRG",
            disabled: () => !isFinite(values.brg),
            onClick: (event, vals, close) => {
              log(vals);
              const brg = to360(vals.brg + (vals.magnetic ? magvar : 0));
              measurements.push({
                lon: center.lon,
                lat: center.lat,
                brg,
                rng: 1.5 * (pos?.distanceTo(center) ?? 5000),
                alpha: vals.update ? 1 : 0.5,
                label: `${vals.brg.toFixed(0)}°${vals.magnetic ? "M" : "T"} ${time()}`,
              });
              if (vals.update) {
                fetch(
                  `${inputUrl}?BLON=${center.lon}&BLAT=${center.lat}&BRG=${brg}`,
                );
              }
            },
          },
          {
            name: "brg2",
            icon: `${base}icons/compass.svg`,
            shortText: "BRG",
            // disabled: () => !isFinite(values.brg),
            onClick: (event, vals, close) => {
              compass(magvar);
            },
          },
        ],
        onChange: (event, changed) => {
          Object.assign(values, changed);
          log(values);
        },
      },
      e,
    );
  }

  api.registerUserButton(
    {
      name: "button",
      shortText: "KF",
      longText: "Kalman-Filter",
      icon: "icons/off.svg",
      // visible: false,
      // toggle: true,
      storeKeys: {
        // toggle: STOREKEYTOGGLE,
        // visible: STOREKEYMAP,
        mode: "nav.gps.kalman.mode",
      },
      updateFunction: (data) => {
        log(data, base);
        try {
          const name = base.split("/").filter(Boolean).at(-1) ?? "";
          const button = document.querySelector(`.${name}-button`);
          if (button) {
            button.style.background =
              data.mode == 1 ? "lightgreen" : data.mode > 1 ? "gold" : null;
          }
        } catch (e) {}
        const icon =
          data.mode == 1
            ? "GPS"
            : data.mode == 2
              ? "DR"
              : data.mode == 3
                ? "DRM"
                : "OFF";
        return {
          iconClass: "KF-" + icon,
          // icon: `${data.mode.toLowerCase()}.svg`,
          // visible: !!data.visible,
        };
      },
      onClick: showDialog,
    },
    "navpage",
  );

  function dir(a, digits = 0, magnetic = false, DEC = 0) {
    const p = digits ? 0 : 3;
    let mag = "";
    if (magnetic)
      mag = `(${to360(a - DEC)
        .toFixed(digits)
        .padStart(p, "0")}°M)`;
    return `${to360(a).toFixed(digits).padStart(p, "0")}°` + mag;
  }

  function compass(DEC = 0) {
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
};
