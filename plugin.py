import os
import sys
from datetime import datetime
from enum import IntEnum
from math import isfinite, nan
from time import monotonic, sleep

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
CURRENT = "current"
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
        "name": CURRENT,
        "description": "estimate current, use 6D state vector",
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
        "condition": {CURRENT: True},
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
    # {
    #     "name": "allowKeyOverwrite",
    #     "description": "Allow this plugin to replace existing AvNav data keys",
    #     "type": "BOOLEAN",
    #     "default": False,
    # },
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
    DR = 2  # dead reckoning, integrating course/speed
    MAN = 3  # dead reckoning, manual input

    def __str__(self) -> str:
        return self.name


POS = ["LON", "LAT"]
C_S = ["COG", "SOG"]
H_W = ["HDT", "STW"]


class Plugin:
    @classmethod
    def pluginInfo(cls):
        return {
            "description": "simple NMEA based simulator",
            "version": __version__,
            "config": CONFIG,
            "data": [
                {
                    "path": PATH_PREFIX + "*",
                    "description": "kalman filter data",
                },
                {
                    "path": "gps.lon",
                },
                {
                    "path": "gps.lat",
                },
                {
                    "path": "gps.track",
                },
                {
                    "path": "gps.speed",
                },
            ],
        }

    def __init__(self, api: AVNApi):
        self.api = api
        self.api.registerEditableParameters(CONFIG, self.changeParam)
        self.api.registerRestart(self.stop)
        self.api.registerSettingsFile("test file", "foo.json")
        self.saveAllConfig()

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
        lati = f"{lat_deg:02d}{lat_min:05.2f}"
        lat_hemi = "N" if lat >= 0 else "S"
        lon_abs = abs(lon)
        lon_deg = int(lon_abs)
        lon_min = (lon_abs - lon_deg) * 60
        longi = f"{lon_deg:03d}{lon_min:05.2f}"
        lon_hemi = "E" if lon >= 0 else "W"
        return f"${self.config[TALKER_ID]}RMC,{hhmmss},A,{lati},{lat_hemi},{longi},{lon_hemi},{sog:.1f},{cog:.1f},{ddmmyy},,,E"

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
        qw = self.config[NOISE_W] / 1000 if self.config[CURRENT] else 0
        boat = kalman.Boat(qv, qw)  # the actual kalman filter
        t0, values0 = monotonic(), {}  # last values
        # scale and offset for cartesian tanget plane coordinates, boat starts at [0,0] meters
        b0, x0, y0, scale = 0, 0, 0, 1

        def toGrid(lon, lat):
            "lon/lat --> cartesian meters"
            x, y = kalman.to_webmercator(lon, lat)
            return (x - x0) / scale, (y - y0) / scale

        def toLL(x, y):
            "cartesian meters --> lon/lat"
            return kalman.to_lonlat(scale * x + x0, scale * y + y0)

        seq = 0
        while not self.api.shouldStopMainThread():
            if self.config_changed:
                break
            t1 = monotonic()
            # seq, records = self.api.fetchFromQueue(
            #     seq, number=1, waitTime=0.5, filter="$RMC", includeSource=True
            # )
            # for record in records:
            #     log(record.data.strip())
            #     log(record.timestamp, monotonic() - record.timestamp)
            #     log(record.omitDecode)
            #     log(record.source)
            #     log(record.subsource)
            #     log(record.sourcePriority)
            #     log()

            values1 = {}  # new input values
            for k, p in INPUT_FIELDS.items():
                v0 = values0.get(k)
                v1 = self.readValue(p)
                if not v1 or v1.value is None or not isfinite(v1.value):
                    continue  # skip invalid
                if v0 and v0.timestamp >= v1.timestamp:
                    continue  # must be a new value with different timestamp
                age = t1 - v1.timestamp
                if 0 <= age < 5:  # must be recent
                    values1[k] = v1
                    # log(k, v1.value, v1.source, age)

            # avaliable input data = data received within last n seconds
            input = [k for k, v in values0.items() if t1 - v.timestamp < 15]
            mode = (  # mode based on avaliable input data
                Mode.OFF
                if not boat.t
                else Mode.GPS
                if all(k in input for k in POS)
                else Mode.DR
                if all(k in input for k in H_W) and boat.n > 4
                else Mode.MAN
            )
            log(mode, boat.n, input)

            if mode > Mode.OFF:
                dt = t1 - b0 - boat.t
                boat.predict(dt)
                log("[magenta]predict dt", dt, "t", boat.t)

            updated = []
            if all(k in values1 for k in POS):
                lon, lat = [values1[k].value for k in POS]
                s = 1 / kalman.scale_factor(lat)
                if abs(scale - s) > 1e-3:
                    scale = s  # update scale and offset
                    x0, y0 = kalman.to_webmercator(lon, lat)
                    b0 = t1
                    boat.x[:2] = 0, 0
                    boat.predict(1)  # initialize (also avoids singluar matrix)
                    mode = Mode.GPS
                    log("[red]scale", scale, "offset", x0, y0)
                x, y = toGrid(lon, lat)
                boat.measure_position(x, y)
                updated.append("POS")

            if mode > Mode.OFF and boat.n > 4 and all(k in values1 for k in H_W):
                hdt, stw = [values1[k].value for k in H_W]
                boat.measure_velocity(hdt, stw)
                updated.append("C/S")

            # if all(k in values1 for k in H_W):
            # cog, sog = [values1[k].value for k in H_W]
            # log(lon, lat)
            # log(x, y)
            # boat.measure_position(x, y)

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
            if mode > Mode.GPS:
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
            values0.update(values1)
            self.api.setStatus(
                "NMEA",
                f"running model:{boat.n} mode:{mode} input:{input} updated:{updated} {rmc}",
            )
            t0 = t1
            sleep(self.config[INTERVAL] - (monotonic() - t1))
