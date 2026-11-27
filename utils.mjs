// ---------- small linear algebra helpers (plain arrays) ----------
// export const isMat = (a) => Array.isArray(a[0]);
export const zeros = (r, c) =>
  Array.from({ length: r }, () => new Array(c).fill(0));
// export const eye = (n) => zeros(n, n).map((row, i) => ((row[i] = 1), row));
// export const diag = (v) =>
//   zeros(v.length, v.length).map((row, i) => ((row[i] = v[i]), row));
// export const transpose = (A) => A[0].map((_, j) => A.map((row) => row[j]));
// export const copy = (a) => (isMat(a) ? a.map((r) => r.slice()) : a.slice());
// export const norm = (v) => Math.sqrt(v.reduce((s, a) => s + a * a, 0));
export const radians = (deg) => (deg * Math.PI) / 180;
export const degrees = (rad) => (rad * 180) / Math.PI;
// export const topi = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI)); // wrap angle to [-pi, pi]
export const to360 = (d) => (d + 360) % 360;
export const to180 = (d) => to360(d + 180) - 180;
// isNaN = (x) => x == null || Number.isNaN(x);
// // unit conversion factors, internal units are meters and seconds
export const nm = 1 / 1852; // m -> nm
export const kn = 3600 / 1852; // m/s -> kn
// export const kmh = 3600 / 1000; // m/s -> km/h
//
export function round(v, n = 0) {
  if (v == null) return NaN;
  const f = n == 0 ? 1 : Math.pow(10, n);
  return Math.round(v * f) / f;
}

/** Cholesky decomposition: returns lower-triangular L with L Lᵀ = A */
export function cholesky(A) {
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
export function covEllipse(center, cova, confidence = 0.5, npoints = 100) {
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
