import os
import sys
import traceback
from datetime import datetime
from enum import IntEnum
from math import isfinite, nan
from time import monotonic, sleep
from typing import NamedTuple

sys.path.insert(0, os.path.dirname(__file__))


try:
    from rich import print
except ImportError:
    pass

DEV = os.getenv("DEV", "").lower() in {"1", "true", "on", "yes"}
log = print if DEV else lambda *a: None


def exception(e):
    log(e, traceback.format_exc())
    raise e


try:
    from avnav_api import AVNApi
except ImportError:
    pass

__version__ = "dev"
SOURCE = "kalman"
PATH_PREFIX = f"gps.{SOURCE}."
INTERVAL = "interval"
USE_LOG = "use_log"
LOG_FAIL = "log_fail"
NOISE_V = "noise_v"
NOISE_W = "noise_w"
TALKER_ID = "talker_id"
PRIORITY = "priority"
SPEEDUP = "speedup"
HDOP_SCALE = "hdop_scale"
SPD_ERROR = "spd_error"
CRS_ERROR = "crs_error"
POS_ERROR = "pos_error"
BRG_ERROR = "brg_error"
RNG_ERROR = "rng_error"
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
        "name": LOG_FAIL,
        "description": "detect log failure, ignore log reading if log reports speed=0 and current speed is > threshold (kn, 0=disabled)",
        "type": "FLOAT",
        "default": 0,
        "rangeOrList": [0, 20],
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
        "name": POS_ERROR,
        "description": "position measurement error (±m)",
        "type": "FLOAT",
        "default": 5,
        "rangeOrList": [0.5, 500],
    },
    {
        "name": HDOP_SCALE,
        "description": "scale position error with hdop if available",
        "type": "BOOLEAN",
        "default": True,
    },
    {
        "name": SPD_ERROR,
        "description": "speed measurement error (±kn)",
        "type": "FLOAT",
        "default": 0.1,
        "rangeOrList": [0.01, 10, 0.1],
    },
    {
        "name": CRS_ERROR,
        "description": "course measurement error (±°)",
        "type": "FLOAT",
        "default": 2,
        "rangeOrList": [0.1, 20],
    },
    {
        "name": BRG_ERROR,
        "description": "bearing measurement error (±°)",
        "type": "FLOAT",
        "default": 2,
        "rangeOrList": [0.1, 20],
    },
    {
        "name": RNG_ERROR,
        "description": "range measurement error (±m)",
        "type": "FLOAT",
        "default": 5,
        "rangeOrList": [0.5, 500],
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
    {
        "name": SPEEDUP,
        "description": "time speedup factor (for simulation and testing)",
        "type": "FLOAT",
        "default": 1,
        "rangeOrList": [1, 100],
    },
]

INPUT_FIELDS = {
    "FIX": "gps.fixType",
    "QUAL": "gps.fixQuality",
    "SATS": "gps.satUsed",
    "HDOP": "gps.HDOP",
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
    DRM = 3  # dead reckoning, manual entry

    def __str__(self) -> str:
        return self.name


POS = ["LON", "LAT"]
C_S = ["COG", "SOG"]
H_W = ["HDT", "STW"]


class Entry(NamedTuple):
    value: float
    timestamp: float
    source: str = SOURCE


def slist(items):
    return ",".join(map(str, sorted(items)))


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
        # self.api.registerRestart(self.stop)
        self.api.registerRequestHandler(self.handleApiRequest)
        self.saveAllConfig()
        self.use_gps = True
        log(self.api.getBaseUrl())

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
            if "reset" in args:
                self.reset = args["reset"][0] in ["1", "yes", "on", "true"]
            return {
                "gps": self.use_gps,
                "mode": self.mode,
                "model": self.boat.n,
            }

    def stop(self):
        log("[red]STOP")

    def monotonic(self):
        return self.config[SPEEDUP] * monotonic()

    def utcnow(self):
        if self.config[SPEEDUP] > 1:
            t1 = datetime.utcnow().timestamp()
            t0 = self.start.timestamp()
            t1 = t0 + (t1 - t0) * self.config[SPEEDUP]
            return datetime.fromtimestamp(t1)
        return datetime.utcnow()

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

    def vdr(self, set, dft):
        "set/drift NMEA sentence"
        return f"${self.config[TALKER_ID]}VDR,{set:.2f},T,,,{dft:.3f},N"

    def run(self):
        sleep(1)
        while not self.api.shouldStopMainThread():
            try:
                self.loop()
            except Exception as x:
                self.api.error(f"{x}")
                self.api.setStatus("ERROR", f"{x}")
                exception(x)
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
        self.start = datetime.utcnow()
        values0 = {}  # last values
        # scale and offset for cartesian tanget plane coordinates, boat starts at [0,0] meters
        b0, x0, y0, scale = 0, 0, 0, 1

        self.input = {}
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
                age = monotonic() - v1.timestamp
                if 0 <= age < 2 * self.config[INTERVAL]:  # must be recent
                    values1[k] = v1
                    # log(k, v1.value, v1.source, age)
                    #

            gps = {}
            for k in ["FIX", "QUAL", "SATS", "HDOP"]:
                if k in values0:
                    gps[k] = values0[k].value
                if k in values1:
                    gps[k] = values1[k].value
            log(gps)

            if not self.use_gps:
                log("[blue]GPS off")
                for k in POS + C_S:
                    values0.pop(k, None)
                    values1.pop(k, None)

            # avaliable input data = data received within last n seconds
            input = [k for k, v in values0.items() if monotonic() - v.timestamp < 15]
            self.mode = mode = (  # mode based on avaliable input data
                Mode.OFF
                if not boat.t
                else Mode.GPS
                if input and all(k in input for k in POS)
                else Mode.DR
                if boat.n > 4
                else Mode.DRM
            )
            log("mode", mode, boat.n)
            log(input)

            slog = self.config[LOG_FAIL] / KN
            if (
                slog
                and "STW" in values1
                and values1["STW"].value == 0
                and boat.stw > slog
            ):
                log("[red]log failure detected")
                values1["STW"] = Entry(nan, monotonic())

            if self.input:  # inject values received via api
                values1 = self.input  # replace
                # values1.update(self.input)  # merge

            if mode > Mode.OFF:
                dt = max(0, self.monotonic() - b0 - boat.t)
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
                    b0 = self.monotonic()
                    boat.t = 0
                    boat.x[:2] = 0, 0
                    boat.predict(1)  # initialize (also avoids singluar matrix)
                    # mode = Mode.GPS
                    log("[red]scale", scale, "offset", x0, y0)
                x, y = toGrid(lon, lat)
                hdop = (
                    gps.get("HDOP", 1)
                    if self.config[HDOP_SCALE] and not self.input
                    else 1
                )
                error = hdop * self.config[POS_ERROR]
                log("[yellow]pos", x, y, error)
                boat.measure_position(x, y, error)
                updated.append("POS")

            if mode > Mode.OFF:
                cerr, serr = self.config[CRS_ERROR], self.config[SPD_ERROR]
                if boat.n > 4 and all(k in values1 for k in H_W):
                    hdt, stw = [values1[k].value for k in H_W]
                    log("[yellow]hdt/stw", hdt, stw)
                    boat.measure_velocity(hdt, stw, cerr, serr)
                    updated.append("H/W")
                if boat.n == 4 and all(k in values1 for k in C_S):
                    cog, sog = [values1[k].value for k in C_S]
                    log("[yellow]cog/sog", cog, sog)
                    boat.measure_velocity(cog, sog, cerr, serr, reset=True)
                    updated.append("C/S")

                BRG = ["BLON", "BLAT", "BRG"]
                if all(k in values1 for k in BRG):
                    lon, lat, brg = [values1[k].value for k in BRG]
                    x, y = toGrid(lon, lat)
                    log("[yellow]brg", x, y, brg)
                    boat.measure_bearing(x, y, brg, self.config[BRG_ERROR])
                    updated.append("BRG")

                RNG = ["BLON", "BLAT", "RNG"]
                if all(k in values1 for k in RNG):
                    lon, lat, rng = [values1[k].value for k in RNG]
                    x, y = toGrid(lon, lat)
                    log("[yellow]rng", x, y, rng)
                    boat.measure_range(x, y, rng, self.config[RNG_ERROR])
                    updated.append("RNG")

            if updated:
                log(f"[red]updated {','.join(updated)}")

            data = {
                "mode": mode,
                "model": boat.n,
                "gps": self.use_gps,
            }
            if mode > Mode.OFF:
                lon, lat = toLL(*boat.pos)
                data.update(
                    {
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
                value_key = "HDT" if k == "CTW" else k
                u = values1[value_key].value if value_key in values1 else nan
                u *= KN if k in ["SOG", "STW", "DFT"] else 1
                s = values1[value_key].source if value_key in values1 else ""
                log(f"{k:>6}  {w:>7}  {u:7.3f} {s}")
                self.writeValue(v, PATH_PREFIX + k)

            # if mode > Mode.GPS:
            #     self.writeValue(lon, INPUT_FIELDS["LON"])
            #     self.writeValue(lat, INPUT_FIELDS["LAT"])
            #     self.writeValue(cog, INPUT_FIELDS["COG"])
            #     self.writeValue(sog, INPUT_FIELDS["SOG"])

            nmea = []
            if mode > Mode.GPS:
                rmc = self.rmc(self.utcnow(), lon, lat, boat.cog, boat.sog * KN)
                log(rmc)
                self.api.addNMEA(
                    rmc,
                    source=SOURCE,
                    addCheckSum=True,
                    omitDecode=False,
                    sourcePriority=self.config[PRIORITY],
                )
                nmea.append("RMC")
                if boat.n > 4:
                    vdr = self.vdr(boat.set, boat.dft * KN)
                    log(vdr)
                    self.api.addNMEA(
                        vdr,
                        source=SOURCE,
                        addCheckSum=True,
                        omitDecode=False,
                        sourcePriority=self.config[PRIORITY],
                    )
                    nmea.append("VDR")

            log()
            if self.input:
                self.input = None
            else:
                values0.update(values1)

            self.api.setStatus(
                "NMEA",
                f"model:{boat.n}D mode:{mode} gps:{slist(f'{k}:{v}' for k, v in gps.items())} input:{slist(input)} updated:{slist(updated)} NMEA:{slist(nmea)}",
            )
            sleep(max(0, self.config[INTERVAL] - (monotonic() - t1)))
