# Dead Reckoning Plugin for AvNav

The Kalman Filter plugin estimates the boat's position, course and speed. It uses an [iterated extended Kalman filter (iEKF)](https://en.wikipedia.org/wiki/Extended_Kalman_filter), combining motion data with GPS fixes and observations you enter on the chart. When recent GPS positions are available, it follows them; when they stop, it continues in dead-reckoning mode.

![AvNav](avnav.png)

## 4D-model and 6D-model

Choose between them with **Use log and compass** in the plugin settings:

- **4D-model** (**Use log and compass** off; manual): Uses position and ground velocity. You can enter a fix and update course and speed from the chart dialog; no log or compass is required.
- **6D-model** (**Use log and compass** on; log and compass): Uses water speed from the log and heading from the compass, and estimates current as well as position. In dead-reckoning mode, chart fixes, bearings and ranges help correct the estimate. The compass needs to supply true heading.

The displayed current (**SET/DFT**) is inferred from the difference between ground motion (COG/SOG, inferred from absolute references such as GPS position fixes and charted-object bearings/ranges) and water motion (heading/speed from the compass/log). It is a residual estimate, not a direct current measurement: it can include actual current as well as leeway and sensor or model offsets and errors.

## Install

1. Upload the plugin ZIP from AvNav's **Plugins** page. NumPy must be installed in AvNav's Python environment.
2. Add the **KalmanFilter** map overlay: **Layout → Edit → On map → Add KalmanFilter**. The overlay provides the chart context for fixes, bearings and ranges.

## Configure

### Plugin settings

- **Use log and compass**: Selects the **4D-model** when off or the **6D-model** when on.
- **Log fail**: Sets a water-speed threshold in knots for detecting a failed log. When the log reports zero while the filter's estimated water speed exceeds this threshold, the zero reading is ignored. Set to `0` to disable detection.
- **Noise V**: Controls process noise for motion. Larger values let the estimate adapt faster but increase uncertainty.
- **Noise W**: In the **6D-model**, controls process noise for the estimated current. Larger values let the estimate adapt faster but increase uncertainty.
- **Measurement errors**: Set the assumed errors to suit your instruments and observations:
  - **Position** and **Range error**: metres.
  - **Speed**: knots.
  - **Course** and **Bearing**: degrees.
- **Interval**: Sets the filter loop interval.
- **Speedup**: Accelerates the filter's clock for simulation and testing; leave at `1` for normal use.
- **Talker ID** and **Priority**: Set the NMEA talker prefix and source priority.

### Map overlay settings

- **Confidence level**: Sets the covariance ellipse confidence from 0–100%; set it to `0` to hide the ellipse.
- **Overlay color**: Sets the color of the estimate and graphics.
- **Show labels**: Toggles labels on plotted observations; on by default.
- **COG vector**: Toggles the ground-velocity vector.
- **DFT vector**: Toggles the estimated current vector.

### NMEA output and diagnostics

Keep the NMEA output priority below that of your real GPS source so the estimate does not take precedence over GPS data.

- In dead-reckoning mode, the filter outputs an RMC sentence, including in the **4D-model**.
- In the **6D-model**, it also outputs a VDR sentence for estimated current.
- NMEA output is suppressed when **GPS off** is selected.
- For backend diagnostic logging, set the plugin process environment variable `DEV=1`; output is suppressed by default.

## Use

The plugin publishes its estimate under `gps.kalman.*`, which you can use in AvNav widgets.

### Check the filter state

The **KF** dialog reports the current state:

- **Uninitialized**: Provide a position fix to start the filter.
- **Locked to GPS**: Chart measurements are plotted but do not affect the estimate.
- **Dead reckoning**: Chart observations update the estimate by default.

**GPS off** simulates GPS loss by withholding GPS position and ground course/speed from the filter. Log and compass input, if selected, continues to be used.

### Enter chart observations

1. Add the **KalmanFilter** overlay and disable map rotation.
2. Center the charted object before opening **KF**. The chart center is captured when the dialog opens.
3. When the center is usable, bearing and range fields are available in GPS-lock and dead-reckoning modes. They are prefilled with the estimated bearing and range from the boat to the chart center when a position estimate is available.
4. Choose an action:
   - **Fix**: Uses the chart center as the boat's observed position, for example when close to a buoy or other known object. Available before initialization and in dead-reckoning mode, but not while locked to GPS; a marker is drawn at the fix location.
   - **BRG**: Enter the true bearing to the centered object and submit it. In dead-reckoning mode this bearing is used as a filter observation; successive bearings can be used for cross-bearings or running fixes.
   - **RNG**: Enter the measured range and submit it. The overlay draws a range arc around the prefilled bearing.
   - **BRG+RNG**: Submit bearing and range together; the overlay draws the bearing line and a narrow range arc.
   - **C/S** (**4D-model**): Enter course over ground (true) and speed over ground.

In GPS lock, **BRG**, **RNG** and **BRG+RNG** only plot observations on the chart. In dead-reckoning mode they update the filter by default. The **update filter** setting is enabled by default; disable it to plot bearing/range observations on the chart without applying them to the filter.

With **Show labels** enabled, plotted markers include their entry time, and bearing/range markers also show the entered values. The overlay retains up to 20 recent markers.

### Reset and clear markers

- **Reset** restarts the filter and clears plotted markers.
- **Cleanup** clears observation markers from the overlay; it does not undo observations already incorporated by the filter.
