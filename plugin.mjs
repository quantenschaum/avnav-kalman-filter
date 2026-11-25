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
  //
  function round(v, n = 0) {
    if (v == null) return NaN;
    const f = n == 0 ? 1 : Math.pow(10, n);
    return Math.round(v * f) / f;
  }

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
    if (center == null) return;
    const m = await fetch(modeUrl).then((r) => r.json());
    // log(m, center, pos, cog, sog, magvar, center);
    const brg = to360(pos?.initialBearingTo(center) - magvar);
    const rng = pos?.distanceTo(center);
    const values = {
      brg: round(brg),
      rng: round(rng * nm, 3),
      cog: round(cog),
      sog: round(sog * kn, 1),
      update: m.mode != 1,
      magnetic: !!magvar,
    };
    const parameters = [];
    if (m.mode > 0) {
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
      parameters.push({
        name: "rng",
        displayName: "RNG (nm)",
        description: "range to object at map obj",
        type: "FLOAT",
        list: [0, 100],
      });
    }
    parameters.push({
      name: "update",
      displayName: "update filter",
      description: "update the filter, disable to only draw on the chart",
      type: "BOOLEAN",
    });
    if (m.mode == 3) {
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

    let text = "";
    if (m.mode < 1) text += "Filter not initialized, provide a fix to start. ";
    if (m.mode == 1) text += "Locked to GPS. ";
    if (m.mode > 1) text += `Dead reckoning (${m.model}D). `;
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
            name: "gps",
            icon: `${base}icons/sat.svg`,
            shortText: "GPS off",
            toggle: !m.gps,
            onClick: (event, vals, close) => fetch(`${modeUrl}?gps=${!m.gps}`),
          },
          {
            name: "c_s",
            icon: `${base}icons/speed.svg`,
            shortText: "C/S",
            visible: m.mode == 3,
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
            icon: `${base}icons/radar.svg`,
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
            icon: `${base}icons/range.svg`,
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
            icon: `${base}icons/compass.svg`,
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
        log(data);
        return {
          iconClass: "KF-" + data.mode,
          // icon: `${data.mode.toLowerCase()}.svg`,
          // visible: !!data.visible,
        };
      },
      onClick: showDialog,
    },
    "navpage",
  );
};
