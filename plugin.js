(function () {
  console.log("kalman");

  // ---------- small linear algebra helpers (plain arrays) ----------
  // const isMat = (a) => Array.isArray(a[0]);
  const zeros = (r, c) => Array.from({ length: r }, () => new Array(c).fill(0));
  // const eye = (n) => zeros(n, n).map((row, i) => ((row[i] = 1), row));
  // const diag = (v) =>
  //   zeros(v.length, v.length).map((row, i) => ((row[i] = v[i]), row));
  // const transpose = (A) => A[0].map((_, j) => A.map((row) => row[j]));
  // const copy = (a) => (isMat(a) ? a.map((r) => r.slice()) : a.slice());
  // const norm = (v) => Math.sqrt(v.reduce((s, a) => s + a * a, 0));
  // const radians = (deg) => (deg * Math.PI) / 180;
  // const degrees = (rad) => (rad * 180) / Math.PI;
  // const topi = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI)); // wrap angle to [-pi, pi]
  // const to360 = (d) => (d + 360) % 360;
  // isNaN = (x) => x == null || Number.isNaN(x);
  // // unit conversion factors, internal units are meters and seconds
  // const nm = 1 / 1852; // m -> nm
  // const kn = 3600 / 1852; // m/s -> kn
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
      const t = (2 * Math.PI * i) / (npoints - 1); // like linspace(0, 2π, npoints), endpoint included
      const c = Math.cos(t),
        s = Math.sin(t);
      xs[i] = nsigma * (L[0][0] * c + L[0][1] * s) + center[0];
      ys[i] = nsigma * (L[1][0] * c + L[1][1] * s) + center[1];
    }
    return [xs, ys];
  }

  const KalmanOverlay = {
    name: "KalmanFilter",
    type: "map",
    storeKeys: {
      LON: "nav.gps.kalman.LON",
      LAT: "nav.gps.kalman.LAT",
      Pxx: "nav.gps.kalman.Pxx",
      Pyy: "nav.gps.kalman.Pyy",
      Pxy: "nav.gps.kalman.Pxy",
    },
    initFunction: function () {},
    finalizeFunction: function () {},
    renderCanvas: function (canvas, data, center) {
      // console.log(canvas, data, center);
      if (data.LON == null && data.LAT == null) return;
      let ctx = canvas.getContext("2d");
      ctx.save();
      const [tx, ty] = this.lonLatToPixel(data.LON, data.LAT);
      const [sx, sy] = this.lonLatToPixel(data.LON, data.LAT + 1 / 600);
      ppm = (ty - sy) / 185.2; // px per meter
      // console.log("ppm", ppm);
      ctx.translate(tx, ty);

      // position marker
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, 2 * Math.PI);
      ctx.fillStyle = data.color;
      ctx.globalAlpha = 0.8;
      ctx.fill();

      const P = [
        [data.Pxx, data.Pxy],
        [data.Pxy, data.Pyy],
      ];
      const p = [50, 90];
      const [xs, ys] = covEllipse([0, 0], P, data.confidence / 100, 128);
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
      ctx.globalAlpha = 0.8;
      ctx.stroke();

      ctx.restore();
    },
  };
  const KalmanOverlayParams = {
    color: {
      type: "COLOR",
      default: "red",
      description: "covariance ellipe color",
    },
    confidence: {
      type: "FLOAT",
      default: 50,
      description: "covariance ellipe confidence level [%]",
    },
  };

  avnav.api.registerWidget(KalmanOverlay, KalmanOverlayParams);
})();
