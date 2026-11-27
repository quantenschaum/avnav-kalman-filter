import assert from "node:assert/strict";
import test from "node:test";

import {
  pixelsPerMeter,
  renderCovEllipse,
  renderMarkerIcon,
  renderMeasurements,
  renderSpeedVectors,
} from "../overlay.mjs";

function makeContext() {
  const calls = [];
  const methods = [
    "arc",
    "beginPath",
    "closePath",
    "fill",
    "fillText",
    "lineTo",
    "moveTo",
    "restore",
    "rotate",
    "save",
    "setLineDash",
    "stroke",
    "translate",
  ];
  const ctx = Object.fromEntries(
    methods.map((name) => [name, (...args) => calls.push([name, ...args])]),
  );
  return {
    calls,
    context: {
      getContext: () => ctx,
      getRotation: () => 0,
      getScale: () => 2,
      lonLatToPixel: (lon, lat) => [lon * 100, lat * 100],
    },
  };
}


test("pixelsPerMeter derives the chart scale from latitude distance", () => {
  const { context } = makeContext();
  const ppm = pixelsPerMeter(context, { lon: 12, lat: 50 });

  assert.ok(Math.abs(ppm - (100 / 60) / 1852) < 1e-12);
});


test("renderMeasurements draws a location marker", () => {
  const { context, calls } = makeContext();

  renderMeasurements(context, { labels: false }, [{ lon: 1, lat: 2 }], 4);

  const arcs = calls.filter(([name]) => name === "arc");
  assert.deepEqual(arcs[0], ["arc", 100, 200, 10, 0, 2 * Math.PI]);
  assert.deepEqual(arcs[1], ["arc", 100, 200, 20, 0, 2 * Math.PI]);
  assert.equal(calls.some(([name]) => name === "fill"), true);
  assert.equal(calls.some(([name]) => name === "stroke"), true);
});


test("renderCovEllipse draws an ellipse for positive confidence", () => {
  const { context, calls } = makeContext();

  renderCovEllipse(
    context,
    { Pxx: 4, Pxy: 0, Pyy: 1, confidence: 50, color: "navy" },
    10,
  );

  assert.equal(calls.filter(([name]) => name === "lineTo").length, 127);
  assert.equal(calls.some(([name]) => name === "closePath"), true);
  assert.equal(calls.some(([name]) => name === "fill"), true);
  assert.equal(calls.some(([name]) => name === "stroke"), true);
});


test("renderSpeedVectors draws the configured course and speed", () => {
  const { context, calls } = makeContext();

  renderSpeedVectors(
    context,
    { show_cog: true, COG: 90, SOG: 2, cvt: 3, color: "blue" },
    10,
  );

  const line = calls.find(([name]) => name === "lineTo");
  assert.equal(line[0], "lineTo");
  assert.ok(Math.abs(line[1] - 60) < 1e-12);
  assert.ok(Math.abs(line[2]) < 1e-12);
});


test("renderMarkerIcon draws a circle marker", () => {
  const { context, calls } = makeContext();

  renderMarkerIcon(context, { marker: "circle", color: "green" });

  assert.deepEqual(
    calls.find(([name]) => name === "arc"),
    ["arc", 0, 0, 16, 0, 2 * Math.PI],
  );
  assert.equal(calls.some(([name]) => name === "fill"), true);
  assert.equal(calls.some(([name]) => name === "stroke"), true);
});
