import { covEllipse, degrees, radians, to180 } from "./utils.mjs";

export function pixelsPerMeter(context, center) {
  const [px0, py0] = context.lonLatToPixel(center.lon, center.lat - 0.5 / 60);
  const [px1, py1] = context.lonLatToPixel(center.lon, center.lat + 0.5 / 60);
  return Math.hypot(px1 - px0, py1 - py0) / 1852;
}

export function renderMeasurements(context, data, measurements, ppm) {
  const ctx = context.getContext();
  const scale = context.getScale();
  const rotation = context.getRotation();

  function label(text, x, y, rot = 0, dx = 0, dy = 0) {
    if (text == null || !data.labels) return;
    ctx.save();
    ctx.translate(x, y);
    if (Math.abs(to180(rot + degrees(rotation))) > 90) rot += 180; // keep upright
    ctx.rotate(radians(rot));
    ctx.translate(dx, dy);
    ctx.font = `${scale * data.fontsize}px Roboto, Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  for (const m of measurements) {
    const [bx, by] = context.lonLatToPixel(m.lon, m.lat);
    ctx.fillStyle = ctx.strokeStyle = m.color ?? "black";
    ctx.lineWidth = scale * (m.width ?? 2);
    ctx.globalAlpha = m.alpha ?? 0.9;
    ctx.beginPath();
    ctx.arc(bx, by, scale * 5, 0, radians(360));
    ctx.fill();

    if (m.brg == null && m.rng == null) {
      ctx.beginPath();
      ctx.arc(bx, by, scale * 10, 0, radians(360));
      ctx.stroke();
      label(m.label, bx, by, degrees(-rotation), 0, -scale * 10);
    }

    if (m.brg != null) {
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
}

export function renderCovEllipse(context, data, ppm) {
  const ctx = context.getContext();
  const scale = context.getScale();
  const P = [
    [data.Pxx, data.Pxy],
    [data.Pxy, data.Pyy],
  ];
  const p = [data.confidence];
  if (p <= 0) return;

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
  ctx.lineWidth = scale * 2;
  ctx.globalAlpha = 0.8;
  ctx.stroke();
}

export function renderSpeedVectors(context, data, ppm) {
  const ctx = context.getContext();
  const scale = context.getScale();

  function speedVector(crs, spd, dash = []) {
    if (crs == null || spd == null) return;
    crs = radians(crs);
    spd *= data.cvt * ppm;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.sin(crs) * spd, -Math.cos(crs) * spd);
    ctx.lineWidth = scale * 2;
    ctx.strokeStyle = data.color;
    ctx.setLineDash(dash);
    ctx.globalAlpha = 0.8;
    ctx.stroke();
    ctx.restore();
  }

  if (data.show_cog) speedVector(data.COG, data.SOG);
  if (data.show_ctw) speedVector(data.CTW, data.STW, [scale * 6, scale * 6]);
  if (data.show_dft) speedVector(data.SET, data.DFT, [scale * 2, scale * 2]);
}

export function renderMarkerIcon(context, data) {
  const ctx = context.getContext();
  const scale = context.getScale();
  if (data.marker == "boat") {
    ctx.save();
    ctx.rotate(radians(data.CTW ?? data.COG));
    ctx.beginPath();
    ctx.moveTo(0, -scale * 20);
    ctx.lineTo(-scale * 10, scale * 20);
    ctx.lineTo(scale * 10, scale * 20);
    ctx.closePath();
    ctx.lineWidth = 1.5 * scale;
    ctx.strokeStyle = "black";
    ctx.fillStyle = data.color;
    ctx.globalAlpha = 0.8;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  } else if (data.marker == "circle") {
    ctx.beginPath();
    ctx.arc(0, 0, scale * 8, 0, radians(360));
    ctx.lineWidth = 1.5 * scale;
    ctx.strokeStyle = "black";
    ctx.fillStyle = data.color;
    ctx.globalAlpha = 0.8;
    ctx.fill();
    ctx.stroke();
  }
}
