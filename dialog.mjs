import { compass } from "./compass.mjs";
import { devmode, kn, log, nm, round, to360 } from "./utils.mjs";

export async function showDialog(e, { api, measurements }) {
  const LatLon = api.LatLon();
  function LonLat(lon, lat) {
    if (lon == null || lat == null) return null;
    return new LatLon(lat, lon);
  }
  const base = api.getBaseUrl();
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

  const modeUrl = base + "api/mode";
  const inputUrl = base + "api/input";

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
          onClick: () => {
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
          onClick: () => {
            measurements.length = 0;
          },
        },
        {
          name: "gps_off",
          icon: `${base}icons/off.svg`,
          shortText: "GPS off",
          toggle: !usegps,
          onClick: () => fetch(`${modeUrl}?gps=${!usegps}`),
        },
        {
          name: "c_s",
          icon: `${base}icons/cogsog.svg`,
          shortText: "C/S",
          visible: mode == 3,
          disabled: () => !(isFinite(values.cog) && isFinite(values.sog)),
          onClick: (event, vals) => {
            fetch(`${inputUrl}?COG=${vals.cog}&SOG=${vals.sog / kn}`);
          },
        },
        {
          name: "fix",
          icon: `${base}icons/gps.svg`,
          shortText: "FIX",
          onClick: (event, vals) => {
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
          onClick: (event, vals) => {
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
          onClick: (event, vals) => {
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
          onClick: (event, vals) => {
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
          name: "compass",
          icon: `${base}icons/compass.svg`,
          shortText: "BRG",
          visible: devmode,
          // disabled: () => !isFinite(values.brg),
          onClick: () => {
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
