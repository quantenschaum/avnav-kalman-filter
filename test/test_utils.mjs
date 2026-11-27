import assert from "node:assert/strict";
import test from "node:test";

import {
  cholesky,
  copy,
  covEllipse,
  degrees,
  diag,
  dir,
  eye,
  isMat,
  isNaN,
  isNumber,
  kmh,
  kn,
  nm,
  norm,
  radians,
  round,
  to180,
  to360,
  topi,
  transpose,
  zeros,
  quaternionToHeading,
} from "../utils.mjs";

test("array and matrix helpers operate on plain arrays", () => {
  assert.deepEqual(zeros(2, 3), [
    [0, 0, 0],
    [0, 0, 0],
  ]);
  assert.deepEqual(eye(2), [
    [1, 0],
    [0, 1],
  ]);
  assert.deepEqual(diag([2, 3]), [
    [2, 0],
    [0, 3],
  ]);
  assert.deepEqual(
    transpose([
      [1, 2],
      [3, 4],
    ]),
    [
      [1, 3],
      [2, 4],
    ],
  );
  assert.equal(isMat([[1]]), true);
  assert.equal(isMat([1]), false);
  assert.equal(norm([3, 4]), 5);

  const matrix = [
    [1, 2],
    [3, 4],
  ];
  const matrixCopy = copy(matrix);
  matrixCopy[0][0] = 9;
  assert.equal(matrix[0][0], 1);
  assert.deepEqual(matrixCopy, [
    [9, 2],
    [3, 4],
  ]);
});

test("angle and direction helpers wrap and format values", () => {
  assert.equal(to360(-1), 359);
  assert.equal(to180(180), -180);
  assert.equal(topi(Math.PI), -Math.PI);
  assert.equal(dir(5), "005°");
  assert.equal(dir(15, 1, true, 3), "15.0°(12.0°M)");
  assert.equal(degrees(radians(42)), 42);
});

test("numeric helpers identify values, round, and expose conversion factors", () => {
  assert.equal(isNaN(null), true);
  assert.equal(isNaN(Number.NaN), true);
  assert.equal(isNaN("3"), false);
  assert.equal(isNumber(3), true);
  assert.equal(isNumber(Number.POSITIVE_INFINITY), false);
  assert.equal(round(1.236, 2), 1.24);
  assert.equal(Number.isNaN(round(null)), true);
  assert.equal(nm, 1 / 1852);
  assert.equal(kn, 3600 / 1852);
  assert.equal(kmh, 3.6);
});

test("Cholesky decomposition and covariance ellipse use the covariance", () => {
  assert.deepEqual(
    cholesky([
      [4, 0],
      [0, 9],
    ]),
    [
      [2, 0],
      [0, 3],
    ],
  );
  assert.throws(
    () =>
      cholesky([
        [1, 2],
        [2, 1],
      ]),
    /positive definite/,
  );

  const center = [3, -2];
  const [xs, ys] = covEllipse(
    center,
    [
      [4, 0],
      [0, 1],
    ],
    0.5,
    3,
  );
  const nsigma = Math.sqrt(-2 * Math.log(0.5));
  assert.equal(xs.length, 3);
  assert.equal(ys.length, 3);
  assert.ok(Math.abs(xs[0] - (center[0] + 2 * nsigma)) < 1e-12);
  assert.ok(Math.abs(xs[1] - (center[0] - 2 * nsigma)) < 1e-12);
  assert.ok(ys.every((y) => Math.abs(y - center[1]) < 1e-12));
});

test("quaternion heading converts orientation to compass degrees", () => {
  assert.equal(quaternionToHeading([0, 0, 0, 1]), 0);
  const halfQuarterTurn = Math.sqrt(0.5);
  assert.equal(
    quaternionToHeading([0, 0, halfQuarterTurn, halfQuarterTurn]),
    270,
  );
});
