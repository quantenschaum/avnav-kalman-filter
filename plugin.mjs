export default async (api) => {
  const devmode =
    new URLSearchParams(window.location.search).get("noCloseDialog") == "true";
  function log(...a) {
    if (!devmode) return;
    console.log(
      "%cKF",
      "background: red; color: black; padding: 2px 4px; border-radius: 3px;",
      ...a,
    );
  }
  log("start", api);

  const LatLon = api.LatLon();

  function LonLat(lon, lat) {
    return new LatLon(lat, lon);
  }

  // ---------- small linear algebra helpers (plain arrays) ----------
  // const isMat = (a) => Array.isArray(a[0]);
  const zeros = (r, c) => Array.from({ length: r }, () => new Array(c).fill(0));
  // const eye = (n) => zeros(n, n).map((row, i) => ((row[i] = 1), row));
  // const diag = (v) =>
  //   zeros(v.length, v.length).map((row, i) => ((row[i] = v[i]), row));
  // const transpose = (A) => A[0].map((_, j) => A.map((row) => row[j]));
  // const copy = (a) => (isMat(a) ? a.map((r) => r.slice()) : a.slice());
  // const norm = (v) => Math.sqrt(v.reduce((s, a) => s + a * a, 0));
  const radians = (deg) => (deg * Math.PI) / 180;
  const degrees = (rad) => (rad * 180) / Math.PI;
  // const topi = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI)); // wrap angle to [-pi, pi]
  const to360 = (d) => (d + 360) % 360;
  const to180 = (d) => to360(d + 180) - 180;
  // isNaN = (x) => x == null || Number.isNaN(x);
  // // unit conversion factors, internal units are meters and seconds
  const nm = 1 / 1852; // m -> nm
  const kn = 3600 / 1852; // m/s -> kn
  // const kmh = 3600 / 1000; // m/s -> km/h

  /** Cholesky decomposition: returns lower-triangular L with L Lᵀ = A */
  function cholesky(A) {
    const n = A.length;
    const L = zeros(n, n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let s = A[i][j];
        for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
        if (i === j) {
          if (s <= 0) throw new Error("Matrix is not positive definite");
          L[i][j] = Math.sqrt(s);
        } else {
          L[i][j] = s / L[j][j];
        }
      }
    }
    return L;
  }
  /**
   * Coordinates of a covariance ellipse.
   * @param {number[]} center [cx, cy]
   * @param {number[][]} cova 2x2 covariance matrix
   * @param {number} confidence e.g. 0.5, 0.95
   * @param {number} npoints number of points on the ellipse
   * @returns {number[][]} [xs, ys] (same layout as ellipse.T in numpy)
   */
  function covEllipse(center, cova, confidence = 0.5, npoints = 100) {
    const nsigma = Math.sqrt(-2 * Math.log(1 - confidence));
    const L = cholesky(cova);
    const xs = new Array(npoints);
    const ys = new Array(npoints);
    for (let i = 0; i < npoints; i++) {
      const t = (2 * Math.PI * i) / (npoints - 1);
      const s = Math.sin(t);
      const c = Math.cos(t);
      xs[i] = nsigma * (L[0][0] * c + L[0][1] * s) + center[0];
      ys[i] = -nsigma * (L[1][0] * c + L[1][1] * s) + center[1];
    }
    return [xs, ys];
  }

  const base = api.getBaseUrl();
  const modeUrl = base + "api/mode";
  const inputUrl = base + "api/input";

  let boatpos = null;
  let cogsog = null;
  let center = null;
  const markers = [];

  const KalmanOverlay = {
    name: "KalmanFilter",
    type: "map",
    storeKeys: {
      model: "nav.gps.kalman.model",
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
      cvt: "properties.navBoatCourseTime",
    },
    initFunction: function (map, data) {},
    finalizeFunction: function () {},
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
      const s = map.getScale();
      const r = map.getRotation();
      const [w0, h0] = map.getDimensions();
      const [w, h] = [w0 / s, h0 / s];
      center = LonLat(...map.pixelToLonLat(w / 2, h / 2));

      if (data.LON == null && data.LAT == null) return;
      boatpos = LonLat(data.LON, data.LAT);
      cogsog = { cog: data.COG, sog: data.SOG };

      const [px0, py0] = map.lonLatToPixel(center.lon, center.lat - 0.5 / 60);
      const [px1, py1] = map.lonLatToPixel(center.lon, center.lat + 0.5 / 60);
      const ppm = Math.hypot(px1 - px0, py1 - py0) / 1852;
      // log("ppm", ppm);

      const ctx = map.getContext();
      ctx.save();

      if (devmode) {
        let [cx, cy] = map.lonLatToPixel(center.lon, center.lat);
        ctx.beginPath();
        ctx.arc(cx, cy, s * 10, 0, radians(360));
        ctx.fillStyle = "blue";
        ctx.globalAlpha = 0.5;
        ctx.fill();
      }

      if (r) center = boatpos = null; // lonLatToPixel broken if rotated

      for (const b of markers) {
        const [bx, by] = map.lonLatToPixel(b.lon, b.lat);
        // target marker
        ctx.beginPath();
        ctx.arc(bx, by, s * 5, 0, radians(360));
        ctx.fillStyle = "black";
        ctx.globalAlpha = 0.9;
        ctx.fill();
        if (b.brg != null) {
          // bearing ling
          const brg = radians(b.brg + 180);
          const d = b.rng * ppm;
          const ex = bx + d * Math.sin(brg);
          const ey = by - d * Math.cos(brg);
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(ex, ey);
          ctx.strokeStyle = "black";
          ctx.lineWidth = s * 2;
          ctx.stroke();
        } else if (b.rng != null) {
          // range circle
          ctx.beginPath();
          ctx.arc(bx, by, b.rng * ppm, 0, radians(360));
          ctx.strokeStyle = "black";
          ctx.lineWidth = s * 2;
          ctx.stroke();
        }
      }

      const [tx, ty] = map.lonLatToPixel(data.LON, data.LAT);
      ctx.translate(tx, ty);

      // position marker
      ctx.beginPath();
      ctx.arc(0, 0, s * 5, 0, radians(360));
      ctx.fillStyle = data.color;
      ctx.globalAlpha = 0.8;
      ctx.fill();

      const P = [
        [data.Pxx, data.Pxy],
        [data.Pxy, data.Pyy],
      ];
      const p = [data.confidence];
      for (const c of p) {
        const [xs, ys] = covEllipse([0, 0], P, c / 100, 128);
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

      if (data.show_cog && data.COG != null && data.SOG != null) {
        const cog = radians(data.COG);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(
          Math.sin(cog) * data.cvt * data.SOG * ppm,
          -Math.cos(cog) * data.cvt * data.SOG * ppm,
        );
        ctx.lineWidth = s * 2;
        ctx.strokeStyle = data.color;
        ctx.globalAlpha = 0.8;
        ctx.stroke();
      }

      if (data.show_dft && data.SET != null && data.DFT != null) {
        const set = radians(data.SET);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(
          Math.sin(set) * data.cvt * data.DFT * ppm,
          -Math.cos(set) * data.cvt * data.DFT * ppm,
        );
        ctx.setLineDash([s * 2, s * 2]);
        ctx.lineWidth = s * 2;
        ctx.strokeStyle = data.color;
        ctx.globalAlpha = 0.8;
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.restore();
      }
    },
  };

  api.registerWidget(KalmanOverlay, {
    color: {
      displayName: "overlay color",
      type: "COLOR",
      default: "red",
      description: "covariance ellipe color",
    },
    confidence: {
      displayName: "confidence level",
      type: "FLOAT",
      default: 50,
      description: "covariance ellipe confidence level [%]",
    },
    show_cog: {
      displayName: "COG vector",
      type: "BOOLEAN",
      default: true,
      description: "display COG/SOG vector (solid line)",
    },
    show_dft: {
      displayName: "DFT vector",
      type: "BOOLEAN",
      default: true,
      description: "display SET/DFT vector (dotted line)",
    },
  });

  async function showDialog(e) {
    const m = await fetch(modeUrl).then((r) => r.json());
    log(m, center, boatpos);
    const brg = Math.round(boatpos?.initialBearingTo(center) ?? NaN);
    const rng =
      Math.round((boatpos?.distanceTo(center) ?? NaN) * nm * 100) / 100;
    const cog = Math.round(cogsog?.cog ?? NaN);
    const sog = Math.round((cogsog?.sog ?? NaN) * kn * 10) / 10;
    const values = { brg, rng, cog, sog };
    const parameters = [];
    if (m.mode > 1 && center != null) {
      parameters.push(
        {
          name: "brg",
          displayName: "BRG (T)",
          description: "bearing to object at map center",
          type: "FLOAT",
          list: [0, 360],
        },
        {
          name: "rng",
          displayName: "RNG (nm)",
          description: "range to object at map center",
          type: "FLOAT",
          list: [0, 100],
        },
      );
    }
    if (m.mode > 1 && m.model == 4) {
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
          list: [0, 100],
        },
      );
    }

    api.showDialog(
      {
        title: "Kalman-Filter",
        text:
          center != null
            ? ""
            : "If buttons are missing, disable chart rotation.",
        parameters,
        values,
        buttons: [
          { name: "cancel", shortText: " " },
          {
            name: "reset",
            icon: `${base}icons/reset.svg`,
            onClick: (event, values, close) => {
              if (!window.confirm("Reset the Kalman filter?")) return;
              fetch(`${modeUrl}?reset=true`);
              markers.length = 0;
            },
          },
          {
            name: "delete",
            icon: `${base}icons/delete.svg`,
            shortText: "cleanup",
            visible: markers.length > 0,
            onClick: (event, values, close) => {
              markers.length = 0;
            },
          },
          {
            name: "gps",
            icon: `${base}icons/sat.svg`,
            shortText: "GPS off",
            toggle: !m.gps,
            onClick: (event, values, close) => {
              fetch(`${modeUrl}?gps=${!m.gps}`);
            },
          },
          {
            name: "fix",
            icon: `${base}icons/gps.svg`,
            shortText: "FIX",
            visible: m.mode != 1 && center != null,
            onClick: (event, values, close) => {
              if (center != null) {
                fetch(`${inputUrl}?LON=${center.lon}&LAT=${center.lat}`);
              }
            },
          },
          {
            name: "c_s",
            icon: `${base}icons/speed.svg`,
            shortText: "C/S",
            visible: m.mode > 1 && m.model == 4,
            disabled: () => !(isFinite(values.cog) && isFinite(values.sog)),
            onClick: (event, values, close) => {
              fetch(`${inputUrl}?COG=${values.cog}&SOG=${values.sog / kn}`);
            },
          },
          {
            name: "rng",
            icon: `${base}icons/range.svg`,
            shortText: "RNG",
            visible: center != null,
            disabled: () => !isFinite(values.rng),
            onClick: (event, values, close) => {
              markers.push({
                lon: center.lon,
                lat: center.lat,
                rng: values.rng / nm,
              });
              if (markers.length > 20) {
                markers.splice(0, markers.length - 20);
              }
              if (m.mode > 1) {
                fetch(
                  `${inputUrl}?BLON=${center.lon}&BLAT=${center.lat}&RNG=${values.rng / nm}`,
                );
              }
            },
          },
          {
            name: "brg",
            icon: `${base}icons/compass.svg`,
            shortText: "BRG",
            visible: center != null,
            disabled: () => !isFinite(values.brg),
            onClick: (event, values, close) => {
              markers.push({
                lon: center.lon,
                lat: center.lat,
                brg: values.brg,
                rng: 2 * (boatpos?.distanceTo(center) ?? 5000),
              });
              if (markers.length > 20) {
                markers.splice(0, markers.length - 20);
              }
              if (m.mode > 1) {
                fetch(
                  `${inputUrl}?BLON=${center.lon}&BLAT=${center.lat}&BRG=${values.brg}`,
                );
              }
            },
          },
        ],
        onChange: (event, changed) => Object.assign(values, changed),
      },
      e,
    );
  }

  api.registerUserButton(
    {
      name: "button",
      shortText: "KF",
      longText: "Kalman-Filter",
      icon: "off.svg",
      // visible: false,
      // toggle: true,
      storeKeys: {
        // toggle: STOREKEYTOGGLE,
        // visible: STOREKEYMAP,
        mode: "nav.gps.kalman.mode",
      },
      updateFunction: (state) => {
        log("state", state);
        return {
          iconClass: "KF-" + state.mode,
          // icon: `${state.mode.toLowerCase()}.svg`,
          // visible: !!state.visible,
        };
      },
      onClick: showDialog,
    },
    "navpage",
  );
};
