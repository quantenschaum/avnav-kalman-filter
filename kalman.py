from numpy import (
    arctan,
    array,
    atan2,
    cos,
    degrees,
    diag,
    exp,
    eye,
    isnan,
    ix_,
    linspace,
    log,
    ndarray,
    pi,
    radians,
    sin,
    sqrt,
    tan,
    zeros,
)
from numpy.linalg import cholesky, inv, norm

kn = 3600 / 1852

printm = print
printm = lambda *a: None

R = 6378137.0


def to_webmercator(lon, lat):
    x = R * radians(lon)
    y = R * log(tan(pi / 4 + radians(lat) / 2))
    return x, y


def to_lonlat(x, y):
    lon = degrees(x / R)
    lat = degrees(2 * arctan(exp(y / R)) - pi / 2)
    return lon, lat


def scale_factor(lat):
    return cos(radians(lat))


def cov_ellipse(
    center: ndarray, cova: ndarray, confidence: float = 0.5, npoints: int = 100
) -> ndarray:
    """
    Return the coordinates of a covariance ellipse.
    https://stackoverflow.com/questions/20126061/creating-a-confidence-ellipse-in-a-scatterplot-using-matplotlib

    Args:
        center (ndarray): The center of the ellipse.
        cova (ndarray): The covariance matrix.
        confidence (float, optional): confidence interval
        npoints (int, optional): The number of points to generate on the ellipse.

    Returns:
        ndarray: The coordinates of the ellipse.
    """
    try:
        nsigma = sqrt(-2 * log(1 - confidence))
        cholesky_l = cholesky(cova)
        t = linspace(0, 2 * pi, npoints)
        circle = column_stack([cos(t), sin(t)])
        ellipse = nsigma * circle @ cholesky_l.T + center
        return ellipse.T
    except Exception as x:
        print(x)
        return [], []


def to360(a):
    "limit angle a to [0,360)"
    # Python's modulo always returns same sign as divisor
    # it is done twice to fix round off errors (like for a=-1e-14)
    return (a % 360) % 360


def to180(a):
    "limit angle a to [-180,+180)"
    return to360(a + 180) - 180


def to2pi(a):
    "limit angle a to [0,2pi)"
    # Python's modulo always returns same sign as divisor
    # it is done twice to fix round off errors (like for a=-1e-14)
    return (a % (2 * pi)) % (2 * pi)


def topi(a):
    "limit angle a to [-pi,+pi)"
    return to2pi(a + pi) - pi


# type Vector = ndarray[tuple[int], dtype[float64]]
# type Matrix = ndarray[tuple[int, int], dtype[float64]]
# type VectorOp = Callable[[Vector], Vector]
# type VectorMatrixOp = Callable[[Vector], Matrix]
# type MatrixOp = Callable[[Matrix], Matrix]
# type MatrixVectorOp = Callable[[Matrix], Vector]


class Kalman:
    def __init__(self, x0, p0=0):
        self.t = 0
        if isinstance(x0, int):
            x0 = x0 * [0]
        self.x = array(x0)  # initial state [x,y,vx,vy]
        self.P = diag(self.n * [p0])  # initial covariance

    def __str__(self) -> str:
        return str(self.x)

    @property  # state size
    def n(self):
        return len(self.x)

    def prediction(
        self,
        F,  #: VectorMatrixOp | Matrix,
        Q=None,  #: Matrix | None = None,
        f=None,  # l: VectorOp | None = None,
    ):
        """perform prediction step
        Args:
            F: state transition Jacobian
            Q: process noise matrix
            f: state transition function, optional if linear then F.x used
        """
        printm(self.x, "x0")
        Fx = F(self.x) if callable(F) else F
        printm(Fx, "F")
        self.x = f(self.x) if f else Fx @ self.x  # predict state
        printm(self.x, "x")
        self.P = Fx @ self.P @ Fx.T  # predict covariance
        self.P += Q if Q is not None else self.Q  # add process noise
        printm(self.P, "P")

    def correction(
        self,
        z,  #: Vector,
        R,  #: Matrix,
        H,  #: VectorMatrixOp | Matrix,
        h,  #: VectorMatrixOp,
        r=None,
        iter=10,
    ):
        """perform correction step incorporating a measurement
        Args:
            z: measured values
            R: covariance of z
            H: Jacobian dh/dx, function of state or constant
            h: function of state returning predicted measured values
            r: residuum wrapper function
        """
        printm(z, "z")
        printm(R, "R")

        x = self.x.copy()  # state for iteration
        printm(x, "x0")

        if not callable(H):
            iter = 0

        for i in range(iter + 1):
            hx = h(x)  # prediced measurement at current state
            printm(hx, "h")
            rx = z - hx  # residuum, difference between prediced and actual measurement
            if r:
                rx = r(rx)
            printm(rx, "r")
            Hx = H(x) if callable(H) else H  # measurement Jacobian at current state
            printm(Hx, "H")
            n = Hx.shape[1]  # size for reduced update
            P = self.P[:n, :n]  # reduced P
            S = Hx @ P @ Hx.T + R  # residual covariance
            printm(S, "S")
            K = P @ Hx.T @ inv(S)  # Kalman gain
            printm(K, "K")
            if i and (iter == i or e < 1):
                break  # IEKF, recalculate H and K at new x
            dx = x[:n] - self.x[:n]
            d = (
                K @ (rx + Hx @ dx) - dx
            )  # state change delta with Hx@... term which in 0 in first iteration
            printm(d, "d")
            e = d.T @ inv(P) @ d  # size of step d with respect to current covariance P
            # print(f'e[{i}] = {e}')
            x[:n] += d  # state update
            printm(x, "x")
            if not iter:
                break  # stop here for plain EKF

        self.x = x  # commit new state
        U = eye(n) - K @ Hx  # error transition matrix
        printm(U, "U")
        self.P[:n, :n] = U @ P @ U.T + K @ R @ K.T  # covariance update
        printm(self.P, "P")


class Boat(Kalman):
    def __init__(self, qv=0.01, qw=0, p0=0):
        super().__init__(6 if qw else 4, p0)
        self.qv = qv
        self.qw = qw
        self.t = 0

    def __str__(self) -> str:
        if self.n <= 4:
            return (
                f"COG={self.cog:.1f} SOG={self.sog:.1f} POS={self.pos} T={self.t:.1f}"
            )
        return f"COG={self.cog:.1f} SOG={self.sog:.1f} CTW={self.ctw:.1f} STW={self.stw:.1f} SET={self.set:.1f} DFT={self.dft:.1f} POS={self.pos} T={self.t:.1f}"

    @property  # position
    def pos(self):
        return self.x[:2]

    @property  # water veloctiy
    def vtw(self):
        return self.x[2:4]

    @property  # heading
    def ctw(self):
        return to360(degrees(atan2(*self.vtw)))

    @property  # water speed
    def stw(self):
        return norm(self.vtw)

    @property  # current veloctiy
    def vcr(self):
        return array([0, 0]) if self.n == 4 else self.x[4:6]

    @property  # current direction (set)
    def set(self):
        return to360(degrees(atan2(*self.vcr)))

    @property  # current speed (drift)
    def dft(self):
        return norm(self.vcr)

    @property  # ground veloctiy
    def vog(self):
        return self.vtw + self.vcr

    @property  # course over ground
    def cog(self):
        return to360(degrees(atan2(*self.vog)))

    @property  # speed over ground
    def sog(self):
        return norm(self.vog)

    def predict(self, dt, qv=0, qw=0):
        self.t += dt
        qv = qv or self.qv
        qw = qw or self.qw

        F = eye(self.n)
        F[0, 2] = F[1, 3] = dt
        if self.n > 4:
            F[0, 4] = F[1, 5] = dt

        def Q2x2(q, dt):
            # discrete random acceleration
            # return q**2 * array([[dt**4/4,dt**3/2],[dt**3/2,dt**2]])
            # continuous time white acceleration
            return q**2 * array([[dt**3 / 3, dt**2 / 2], [dt**2 / 2, dt]])

        Q = zeros([self.n, self.n])
        Qv = Q2x2(qv, dt)
        Q[ix_([0, 2], [0, 2])] += Qv
        Q[ix_([1, 3], [1, 3])] += Qv
        if self.n > 4:
            Qw = Q2x2(qw, dt)
            Q[ix_([0, 4], [0, 4])] += Qw
            Q[ix_([1, 5], [1, 5])] += Qw

        self.prediction(F, Q)

    def measure_velocity(
        self, course, speed, course_error=2, speed_error=0.1, reset=False
    ):
        course = radians(course)
        course_error = radians(course_error)

        r = lambda x: x

        if speed < 1e-6 or isnan(course):  # ignore course when stationary
            if self.stw < 1e-6:
                return  # no update needed, avoids zero division
            # print('speed only')
            z = array([speed])  # measured speed
            R = array([[speed_error**2]])  # speed covariance

            def h(x):
                v = x[2:4]
                return array([sqrt(v @ v)])

            def H(x):
                vx, vy = x[2:4]
                v = sqrt(vx**2 + vy**2)
                return array([[0, 0, vx / v, vy / v]])

        elif isnan(speed):  # course only
            if self.stw < 1e-6:
                return  # no update needed, avoids zero division
            # print('course only')
            z = array([course])
            R = array([[course_error**2]])

            def h(x):
                vx, vy = x[2:4]
                return array([atan2(vx, vy)])

            def H(x):
                vx, vy = x[2:4]
                v2 = vx**2 + vy**2
                if v2 < 1e-12:
                    return
                return array([[0, 0, vy / v2, -vx / v2]])

            r = lambda x: array([topi(x[0])])

        elif (
            self.stw < 1e-6 or reset
        ):  # cartsesian velocity measurement, avoids zero division
            # print('cartesian')
            z = array([course, speed])  # compass and log measurement
            R = array(
                [[course_error**2, 0], [0, speed_error**2]]
            )  # compass and log covariance
            c, s = course, speed
            sc, cc = sin(c), cos(c)
            z = array([s * sc, s * cc])  # cartesian velocity
            J = array([[s * cc, sc], [-s * sc, cc]])  # polar -> cartesian Jacobian
            R = J @ R @ J.T  # transformed speed covariance
            h = lambda x: x[2:4]
            H = array([[0, 0, 1, 0], [0, 0, 0, 1]])

            if reset:
                self.x[2:4] = speed * array([sin(course), cos(course)])
                self.P[2:4, 2:4] = R
                return

        else:
            # print('polar')
            z = array([course, speed])  # compass and log measurement
            R = array(
                [[course_error**2, 0], [0, speed_error**2]]
            )  # compass and log covariance

            def h(x):
                vx, vy = x[2:4]
                v2 = vx**2 + vy**2
                v = sqrt(v2)
                return array([atan2(vx, vy), v])

            def H(x):
                vx, vy = x[2:4]
                v2 = vx**2 + vy**2
                v = sqrt(v2)
                return array([[0, 0, vy / v2, -vx / v2], [0, 0, vx / v, vy / v]])

            r = lambda x: array([topi(x[0]), x[1]])

        self.correction(z, R, H, h, r)

    def measure_position(self, x, y, error=5):
        z = array([x, y])  # measured position
        R = array([[error**2, 0], [0, error**2]])  # position covariance
        h = lambda x: x[:2]
        H = zeros([2, self.n])
        H[0, 0] = H[1, 1] = 1
        self.correction(z, R, H, h)

    def measure_bearing(self, x, y, bearing, error=2):
        bearing = radians(bearing)
        error = radians(error)

        z = array([bearing])  # measured bearing
        R = array([[error**2]])  # bearing covariance

        def h(s):
            dx, dy = x - s[0], y - s[1]
            return array([atan2(dx, dy)])

        def H(s):
            dx, dy = x - s[0], y - s[1]
            d2 = dx**2 + dy**2
            H = zeros([1, self.n])
            H[0, 0] = -dy / d2
            H[0, 1] = dx / d2
            return H

        r = lambda x: array([topi(x[0])])
        self.correction(z, R, H, h, r)

    def measure_range(self, x, y, range, range_error=5):
        z = array([range])  # measured range
        R = array([[range_error**2]])  # range covariance

        def h(s):
            dx, dy = x - s[0], y - s[1]
            return array([sqrt(dx**2 + dy**2)])

        def H(s):
            dx, dy = x - s[0], y - s[1]
            d2 = dx**2 + dy**2
            d = sqrt(d2)
            H = zeros([1, self.n])
            H[0, 0] = -dx / d
            H[0, 1] = -dy / d
            return H

        self.correction(z, R, H, h)

    def measure_angle(self, ax, ay, bx, by, angle, error=0.2):
        angle = radians(angle)
        error = radians(error)

        z = array([angle])
        R = array([[error**2]])

        def h(s):
            x, y = s[:2]
            a = atan2(ax - x, ay - y)
            b = atan2(bx - x, by - y)
            return array([topi(b - a)])

        def H(s):
            x, y = s[:2]
            dax, day = ax - x, ay - y
            da2 = dax**2 + day**2
            da = sqrt(da2)
            dbx, dby = bx - x, by - y
            db2 = dbx**2 + dby**2
            db = sqrt(db2)
            H = zeros([1, self.n])
            H[0, 0] = dby / db2 - day / da2
            H[0, 1] = -dbx / db2 + dax / da2
            return H

        r = lambda x: array([topi(x[0])])

        self.correction(z, R, H, h, r)
