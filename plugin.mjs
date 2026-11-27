import { showDialog } from "./dialog.mjs";
import {
  pixelsPerMeter,
  renderCovEllipse,
  renderMarkerIcon,
  renderMeasurements,
  renderSpeedVectors,
} from "./overlay.mjs";
import { log } from "./utils.mjs";

export default async (api) => {
  log("start");
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
    // initFunction: function (context, data) {log('init')},
    // finalizeFunction: function () {log('finalize')},
    renderCanvas: function (canvas, data, context) {
      // log(data);
      if (data?.center == null) return;
      if (data?.LON == null || data?.LAT == null) return;
      const center = data.center;
      const ppm = pixelsPerMeter(context, center);
      const ctx = context.getContext();
      try {
        ctx.save();
        if (measurements.length > 20) measurements.shift();
        renderMeasurements(context, data, measurements, ppm);
        const [tx, ty] = context.lonLatToPixel(data.LON, data.LAT);
        ctx.translate(tx, ty);
        renderCovEllipse(context, data, ppm);
        renderSpeedVectors(context, data, ppm);
        renderMarkerIcon(context, data);
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
        try {
          const name = api.getBaseUrl().split("/").filter(Boolean).at(-1) ?? "";
          const button = document.querySelector(`.${name}-button`);
          if (button) {
            button.style.background =
              data.mode == 1 ? "lightgreen" : data.mode > 1 ? "gold" : null;
          }
        } catch (e) {}
        const mode =
          data.mode == 1
            ? "GPS"
            : data.mode == 2
              ? "DR"
              : data.mode == 3
                ? "DRM"
                : "OFF";
        // api.showToast(`KF mode: ${mode}`, 5000);
        return {
          iconClass: "KF-" + mode,
          // icon: `${data.mode.toLowerCase()}.svg`,
          // visible: !!data.visible,
        };
      },
      onClick: (event) => showDialog(event, { api, measurements }),
    },
    "navpage",
  );
};
