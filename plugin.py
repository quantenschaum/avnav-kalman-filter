import os
import sys
from datetime import datetime
from enum import IntEnum
from math import isfinite, nan
from time import monotonic, sleep
from typing import NamedTuple

sys.path.insert(0, os.path.dirname(__file__))

log = print
try:
    from rich import print as log
except:
    pass
# log = lambda *a: None

try:
    from avnav_api import AVNApi
except:
    pass

__version__ = "dev"
SOURCE = "kalman"
PATH_PREFIX = f"gps.{SOURCE}."
INTERVAL = "interval"
USE_LOG = "use_log"
NOISE_V = "noise_v"
NOISE_W = "noise_w"
TALKER_ID = "talker_id"
PRIORITY = "priority"
CONFIG = [
    {
        "name": INTERVAL,
        "description": "loop interval (seconds)",
        "type": "FLOAT",
        "default": 1,
        "rangeOrList": [0.1, 20.0],
    },
    {
        "name": USE_LOG,
        "description": "use log and compass, estimate current, use 6D state vector",
        "type": "BOOLEAN",
        "default": True,
    },
    {
        "name": NOISE_V,
        "description": "process noise",
        "type": "NUMBER",
        "default": 10,
        "rangeOrList": [1, 5000],
    },
    {
        "name": NOISE_W,
        "description": "process noise for current",
        "type": "NUMBER",
        "default": 5,
        "rangeOrList": [1, 5000],
        "condition": {USE_LOG: True},
    },
    {
        "name": TALKER_ID,
        "description": "NMEA talker id for sent sentences",
        "type": "STRING",
        "default": "KF",
    },
    {
        "name": PRIORITY,
        "description": "source priority",
        "type": "NUMBER",
        "default": 20,
        "rangeOrList": [0, 100],
    },
]

INPUT_FIELDS = {
    "LAT": "gps.lat",
    "LON": "gps.lon",
    "COG": "gps.track",
    "SOG": "gps.speed",
    "HDT": "gps.headingTrue",
    "STW": "gps.waterSpeed",
    "SET": "gps.currentSet",
    "DFT": "gps.currentDrift",
}


class Mode(IntEnum):
    OFF = 0  # not initialized
    GPS = 1  # locked to GPS
    DR = 2  # dead reckoning

    def __str__(self) -> str:
        return self.name


POS = ["LON", "LAT"]
C_S = ["COG", "SOG"]
H_W = ["HDT", "STW"]


class Entry(NamedTuple):
    value: float
    timestamp: float


class Plugin:
    @classmethod
    def pluginInfo(cls):
        return {
            "description": "Kalman filter based dead reckoning",
            "version": __version__,
            "config": CONFIG,
            "data": [
                {
                    "path": PATH_PREFIX + "*",
                    "description": "kalman filter data",
                },
            ],
        }

    def __init__(self, api: AVNApi):
        self.api = api
        self.api.registerEditableParameters(CONFIG, self.changeParam)
        self.api.registerRestart(self.stop)
        self.api.registerRequestHandler(self.handleApiRequest)
        self.saveAllConfig()
        print(self.api.getBaseUrl())

    def handleApiRequest(self, url, handler, args):
        log(url, args)
        if url == "input":
            self.input = {
                k.upper(): Entry(float(v[0]), monotonic()) for k, v in args.items()
            }
            log(self.input)
            return {"status": "ok"}
        if url == "mode":
            if "gps" in args:
                self.use_gps = args["gps"][0] in ["1", "yes", "on", "true"]
            if "log" in args:
                self.use_log = args["log"][0] in ["1", "yes", "on", "true"]
            if "reset" in args:
                self.reset = args["reset"][0] in ["1", "yes", "on", "true"]
            return {
                "gps": self.use_gps,
                "log": self.use_log,
                "mode": self.mode,
                "model": self.boat.n,
            }

    def stop(self):
        pass

    def getConfigValue(self, name):
        defaults = self.pluginInfo()["config"]
        for cf in defaults:
            if cf["name"] == name:
                return self.api.getConfigValue(name, cf.get("default"))
        return self.api.getConfigValue(name)

    def saveAllConfig(self):
        d = {}
        defaults = self.pluginInfo()["config"]
        for cf in defaults:
            v = self.getConfigValue(cf.get("name"))
            d.update({cf.get("name"): v})
        self.api.saveConfigValues(d)
        return

    def changeConfig(self, newValues):
        self.api.saveConfigValues(newValues)

    def changeParam(self, param):
        self.api.saveConfigValues(param)
        self.read_config()

    def read_config(self):
        config = {}
        for c in CONFIG:
            name = c["name"]
            TYPES = {"FLOAT": float, "NUMBER": int, "BOOLEAN": lambda s: s == "True"}
            value = self.getConfigValue(name)
            value = TYPES.get(c.get("type"), str)(value)
            config[name] = value
        self.config = config
        self.config_changed = True

    def readValue(self, path):
        "prevents reading values that we self have calculated"
        a = self.api.getSingleValue(path, includeInfo=True)
        # if a: log(path, a.value, a.source, a.priority / 10)
        if a and SOURCE not in a.source:
            return a

    def writeValue(self, value, path, overwrite=False):
        "do not overwrite existing values"
        a = None if overwrite else self.api.getSingleValue(path, includeInfo=True)
        if not a or SOURCE in a.source:
            return self.api.addData(path, value, source=SOURCE)

    def rmc(self, time, lon, lat, cog, sog):
        hhmmss = time.strftime("%H%M%S.%f")[:9]
        ddmmyy = time.strftime("%d%m%y")
        lat_abs = abs(lat)
        lat_deg = int(lat_abs)
        lat_min = (lat_abs - lat_deg) * 60
        lati = f"{lat_deg:02d}{lat_min:08.5f}"
        lat_hemi = "N" if lat >= 0 else "S"
        lon_abs = abs(lon)
        lon_deg = int(lon_abs)
        lon_min = (lon_abs - lon_deg) * 60
        longi = f"{lon_deg:03d}{lon_min:08.5f}"
        lon_hemi = "E" if lon >= 0 else "W"
        return f"${self.config[TALKER_ID]}RMC,{hhmmss},A,{lati},{lat_hemi},{longi},{lon_hemi},{sog:.3f},{cog:.2f},{ddmmyy},,,E"

    def run(self):
        while not self.api.shouldStopMainThread():
            try:
                self.loop()
            except Exception as x:
                log("ERROR", x)
                self.api.error(f"{x}")
                self.api.setStatus("ERROR", f"{x}")
                sleep(5)

    def loop(self):
        import kalman

        self.api.log("started")
        self.read_config()
        self.config_changed = False
        self.api.setStatus("STARTED", "starting")
        KN = kalman.kn

        qv = self.config[NOISE_V] / 1000
        qw = self.config[NOISE_W] / 1000 if self.config[USE_LOG] else 0
        self.boat = boat = kalman.Boat(qv, qw)  # the actual kalman filter
        t0, values0 = monotonic(), {}  # last values
        # scale and offset for cartesian tanget plane coordinates, boat starts at [0,0] meters
        b0, x0, y0, scale = 0, 0, 0, 1

        self.input = {}
        self.use_gps = True
        self.use_log = True
        self.reset = False

        def toGrid(lon, lat):
            "lon/lat --> cartesian meters"
            x, y = kalman.to_webmercator(lon, lat)
            return (x - x0) / scale, (y - y0) / scale

        def toLL(x, y):
            "cartesian meters --> lon/lat"
            return kalman.to_lonlat(scale * x + x0, scale * y + y0)

        while not self.api.shouldStopMainThread():
            if self.config_changed or self.reset:
                break
            t1 = monotonic()

            values1 = {}  # new input values
            for k, p in INPUT_FIELDS.items():
                v0 = values0.get(k)
                v1 = self.readValue(p)
                if not v1 or v1.value is None or not isfinite(v1.value):
                    continue  # skip invalid
                if v0 and v0.timestamp >= v1.timestamp:
                    continue  # must be a new value with different timestamp
                age = t1 - v1.timestamp
                if 0 <= age < 2 * self.config[INTERVAL]:  # must be recent
                    values1[k] = v1
                    # log(k, v1.value, v1.source, age)

            if not self.use_gps:
                for k in POS + C_S:
                    values0.pop(k, None)
                    values1.pop(k, None)
            if not self.use_log:
                for k in H_W:
                    values0.pop(k, None)
                    values1.pop(k, None)

            # avaliable input data = data received within last n seconds
            input = [k for k, v in values0.items() if t1 - v.timestamp < 15]
            self.mode = mode = (  # mode based on avaliable input data
                Mode.OFF
                if not boat.t
                else Mode.GPS
                if input and all(k in input for k in POS)
                else Mode.DR
            )
            log(mode, boat.n, input)

            if self.input:  # inject values received via api
                values1 = self.input  # replace
                # values1.update(self.input)  # merge

            if mode > Mode.OFF:
                dt = max(0, t1 - b0 - boat.t)
                boat.predict(dt)
                log("[green]predict dt", dt, "t", boat.t)

            updated = []
            if all(k in values1 for k in POS):
                lon, lat = [values1[k].value for k in POS]
                self.fix = None
                s = 1 / kalman.scale_factor(lat)
                if abs(scale - s) > 1e-3:
                    scale = s  # update scale and offset
                    x0, y0 = kalman.to_webmercator(lon, lat)
                    b0 = t1
                    boat.t = 0
                    boat.x[:2] = 0, 0
                    boat.predict(1)  # initialize (also avoids singluar matrix)
                    # mode = Mode.GPS
                    log("[red]scale", scale, "offset", x0, y0)
                x, y = toGrid(lon, lat)
                boat.measure_position(x, y)
                updated.append("POS")

            if mode > Mode.OFF:
                if boat.n > 4 and all(k in values1 for k in H_W):
                    hdt, stw = [values1[k].value for k in H_W]
                    boat.measure_velocity(hdt, stw)
                    updated.append("H/W")

                if boat.n == 4 and all(k in values1 for k in C_S):
                    cog, sog = [values1[k].value for k in C_S]
                    boat.measure_velocity(cog, sog, reset=True)
                    updated.append("C/S")

                BRG = ["BLON", "BLAT", "BRG"]
                if all(k in values1 for k in BRG):
                    lon, lat, brg = [values1[k].value for k in BRG]
                    x, y = toGrid(lon, lat)
                    boat.measure_bearing(x, y, brg)
                    updated.append("BRG")

                RNG = ["BLON", "BLAT", "RNG"]
                if all(k in values1 for k in RNG):
                    lon, lat, rng = [values1[k].value for k in RNG]
                    x, y = toGrid(lon, lat)
                    boat.measure_range(x, y, rng)
                    updated.append("RNG")

            if updated:
                log(f"[red]updated {','.join(updated)}")

            data = {
                "mode": str(mode),
                "model": boat.n,
            }
            if mode > Mode.OFF:
                lon, lat = toLL(*boat.pos)
                data.update(
                    {
                        "upd": ",".join(updated),
                        "time": boat.t,
                        "Pxx": boat.P[0, 0],
                        "Pyy": boat.P[1, 1],
                        "Pxy": boat.P[0, 1],
                        "LON": lon,
                        "LAT": lat,
                        "COG": boat.cog,
                        "SOG": boat.sog,
                    }
                )
                if boat.n > 4:
                    data.update(
                        {
                            "CTW": boat.ctw,
                            "STW": boat.stw,
                            "SET": boat.set,
                            "DFT": boat.dft,
                        }
                    )
            for k, v in data.items():
                if k[0] == k[0].upper():
                    v = float(v)
                w = v * KN if k in ["SOG", "STW", "DFT"] else v
                if isinstance(w, float):
                    w = f"{w:7.3f}"
                l = "HDT" if k == "CTW" else k
                u = values1[l].value if l in values1 else nan
                u *= KN if k in ["SOG", "STW", "DFT"] else 1
                log(f"{k:>6}  {w:>7}  {u:7.3f}")
                self.writeValue(v, PATH_PREFIX + k)

            # if mode > Mode.GPS:
            #     self.writeValue(lon, INPUT_FIELDS["LON"])
            #     self.writeValue(lat, INPUT_FIELDS["LAT"])
            #     self.writeValue(cog, INPUT_FIELDS["COG"])
            #     self.writeValue(sog, INPUT_FIELDS["SOG"])

            rmc = ""
            if mode > Mode.GPS and self.use_gps and self.use_log:
                rmc = self.rmc(datetime.utcnow(), lon, lat, boat.cog, boat.sog * KN)
                log(rmc)
                self.api.addNMEA(
                    rmc,
                    source=SOURCE,
                    addCheckSum=True,
                    omitDecode=False,
                    sourcePriority=self.config[PRIORITY],
                )

            log()
            if self.input:
                self.input = None
            else:
                values0.update(values1)
            self.api.setStatus(
                "NMEA",
                f"model:{boat.n} mode:{mode} input:{input} updated:{updated} {rmc}",
            )
            t0 = t1
            sleep(self.config[INTERVAL] - (monotonic() - t1))
