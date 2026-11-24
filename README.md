# Dead Reckoning Plugin for AvNav

The Kalman Filter plugin estimates the boat's position, course and speed. It uses an iterative extended Kalman filter (iEKF), combining motion data with GPS fixes and observations you enter on the chart. When recent GPS positions are available, it follows them; when they stop, it continues in dead-reckoning mode.

![AvNav](avnav.png)

## Models

Choose the model with **Use log and compass** in the plugin settings:

- **Manual** (off): Uses position and ground velocity. You can enter a fix and update course and speed from the chart dialog; no log or compass is required.
- **Log and compass** (on): Uses water speed from the log and heading from the compass, and estimates current as well as position. In dead-reckoning mode, chart fixes, bearings and ranges help correct the estimate. The compass needs to supply true heading.

Both models can use GPS input. The **GPS off** button simulates lost GPS for testing by withholding GPS position and ground course/speed from the filter. Log and compass input, if selected, continues to be used.

## Install and configure

1. Upload the plugin ZIP from AvNav's **Plugins** page. NumPy must be installed in AvNav's Python environment.
2. Configure the plugin in its settings. **Use log and compass** selects the model. **Log fail** sets a water-speed threshold in knots for detecting a failed log: when the log reports zero while the filter's estimated water speed exceeds this threshold, the zero reading is ignored. Set it to `0` to disable detection. **Noise V** controls process noise for motion; in log-and-compass mode, **Noise W** controls process noise for the estimated current. Larger values let the estimate adapt faster but increase its uncertainty. **Position**, **Speed**, **Course**, **Bearing** and **Range error** are the assumed measurement errors (position/range in metres, speed in knots, and course/bearing in degrees); adjust them to suit your sensors and observations. **Interval** sets the filter loop interval. **Speedup** accelerates the filter's clock for simulation and testing; leave it at `1` for normal use. **Talker ID** and **Priority** configure the talker prefix and priority of generated NMEA sentences.
3. Add the **KalmanFilter** map overlay: **Layout → Edit → On map → Add KalmanFilter**. It shows the estimated position and covariance ellipse, and provides the chart context for fixes, bearings and ranges. Disable map rotation before entering chart-based data; these controls are unavailable while the map is rotated ([#718](https://github.com/wellenvogel/avnav/issues/718)).
4. In the overlay settings, choose the ellipse confidence level (percent) and color. **COG vector** toggles the ground-velocity vector; **DFT vector** toggles the estimated current vector.

Keep the NMEA output priority below that of your real GPS source so the estimate does not take precedence over GPS data. When in dead-reckoning mode the filter outputs an RMC sentence, including in the manual (4D) model. In the log-and-compass model it also outputs a VDR sentence for estimated current. NMEA output is suppressed when **GPS off** is selected. For diagnostic logging, set the plugin process environment variable `DEV` to a truthy value; output is suppressed by default.

## Use

The plugin publishes its estimate under `gps.kalman.*`, which you can use in AvNav widgets.

Click **KF** on the chart to open the controls. The chart center is captured when the dialog opens, so center the charted object first. When the center is usable, bearing and range fields are available in both GPS lock and dead-reckoning mode. In GPS lock, **BRG**, **RNG** and **BRG+RNG** only plot observations on the chart; they do not change the filter's estimate. In dead-reckoning mode, they update the filter by default. Select **draw only** to plot them without updating the filter; this option is available only in dead-reckoning mode. You can also:

- **Fix**: use the chart center as the boat's observed position (for example, when close to a buoy or other known object). This is available before initialization and in dead-reckoning mode, but not while locked to GPS. A marker is drawn at the fix location.
- **C/S** (manual model): enter course over ground (true) and speed over ground.

The bearing and range fields are prefilled with the estimate from the boat to the chart center when a position is available. To take a bearing, place the charted object at the center, open **KF**, enter the true bearing you measured, then press **BRG**. To enter a range, place the object at the center, enter the measured range and press **RNG**; the overlay draws a range arc around the prefilled bearing. **BRG+RNG** submits both measurements together and plots their bearing line and a narrow range arc. In dead-reckoning mode, successive bearings can be used for cross-bearings or running fixes. The overlay retains up to 20 recent markers.

The dialog indicates whether the filter is uninitialized (provide a fix), locked to GPS (observations will not affect the estimate), or dead reckoning. **GPS off** simulates GPS loss by withholding GPS position and ground course/speed; log and compass data continue to be used if selected. **Reset** restarts the filter and clears plotted markers. **Cleanup** clears the observation markers from the overlay, but does not undo observations already incorporated by the filter.
