# Dead Reckoning Plugin for AvNav

The Kalman Filter plugin estimates the boat's position, course and speed. It uses an [iterated extended Kalman filter (iEKF)](https://en.wikipedia.org/wiki/Extended_Kalman_filter), combining motion data with GPS fixes and observations you enter on the chart. When recent GPS positions are available, it follows them; when they stop, it continues in dead-reckoning mode.

![AvNav](avnav.png)

## Demo: 10-hour passage

[Watch the 10-hour passage replay](https://freenauticalchart.net/kalman-filter.mp4). The video replays recorded data from a passage with the filter using compass heading and log speed only; GPS is shown for comparison, not used by the filter. The green track is the true GPS track, the red track is the filter's estimated position, blue ellipses show estimated position covariance, and black lines mark bearings entered once per hour. It demonstrates how the estimate develops during dead reckoning and how periodic bearings help constrain it.

## 4D-model and 6D-model

Choose between them with **Use log and compass** in the plugin settings:

- **4D-model** (**Use log and compass** off; manual): Uses position and ground velocity. You can enter a fix and update course and speed from the chart dialog; no log or compass is required.
- **6D-model** (**Use log and compass** on; log and compass): Uses water speed from the log and heading from the compass, and estimates current as well as position. In dead-reckoning mode, chart fixes, bearings and ranges help correct the estimate. The compass needs to supply true heading.

The displayed current (**SET/DFT**) is inferred from the difference between ground motion (COG/SOG, inferred from absolute references such as GPS position fixes and charted-object bearings/ranges) and water motion (heading/speed from the compass/log). It is a residual estimate, not a direct current measurement: it can include actual current as well as leeway and sensor or model offsets and errors.

## Install

1. Upload the plugin ZIP from releases on AvNav's **Plugins** page. NumPy must be installed in AvNav's Python environment.
2. Add the **KalmanFilter** map overlay: **Layout → Edit → On map → Add KalmanFilter**. The overlay displays the estimate and plotted observations.

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
- **Scale position error with HDOP**: When enabled (default), scales the configured position measurement error by GPS HDOP for incoming GPS positions. For example, a base position error of 5m with HDOP 2 is treated as 10m. If HDOP is unavailable, the base error is used. This setting does not scale chart observations or manually injected positions.
- **Interval**: Sets the filter loop interval.
- **Speedup**: Accelerates the filter's clock for simulation and testing; leave at `1` for normal use.
- **Talker ID** and **Priority**: Set the NMEA talker prefix and source priority.

### Map overlay settings

- **Confidence level**: Sets the covariance ellipse confidence from 0–100%; set it to `0` to hide the ellipse.
- **Overlay color**: Sets the color of the estimate and graphics.
- **Marker**: Selects the symbol at the estimated position: **boat** (default), **circle**, or **none**. The boat marker points along CTW when available, otherwise COG. Choosing **none** hides only the position marker; the confidence ellipse, vectors, and observations remain controlled by their own settings.
- **Show labels**: Toggles labels on plotted observations; on by default.
- **COG vector**: Toggles the ground-velocity vector; off by default.
- **CTW vector**: Toggles the water-velocity vector; off by default.
- **DFT vector**: Toggles the estimated current vector; off by default.

### NMEA output and diagnostics

Normally, keep the NMEA output priority below that of your real GPS source so the estimate does not take precedence. To override GPS with the filter’s dead-reckoning output, set the plugin priority higher than the GPS source’s priority, then press **GPS off** to withhold GPS position and ground course/speed from the filter to force the filter to provide the position to AvNav.

- In dead-reckoning mode, the filter outputs an RMC sentence, including in the **4D-model**.
- In the **6D-model**, it also outputs a VDR sentence for estimated current.
- **GPS off** withholds GPS position and ground course/speed from the filter.
- The plugin's **NMEA** status includes the model and mode, recent GPS fix metadata (fix type/quality, satellites, HDOP), input data, updated measurements and emitted sentence types.
- For backend diagnostic logging, set the plugin process environment variable `DEV=1`; output is suppressed by default.

## Use

The plugin publishes its estimate under `gps.kalman.*`, which you can use in AvNav widgets.

### Check the filter state

The **KF** button icon indicates the filter's current mode, and the **KF** dialog describes it:

- ![OFF mode icon](icons/off.svg) **OFF**: The filter is not initialized. Provide a position fix to start it.
- ![GPS mode icon](icons/gps.svg) **GPS**: Locked to recent GPS positions; chart observations do not affect the estimate unless **update filter** is enabled.
- ![DR mode icon](icons/dr.svg) **DR**: Dead reckoning with the 6D model. Chart observations update the estimate by default.
- ![DRM mode icon](icons/drm.svg) **DRM**: Dead reckoning in manual mode with the 4D model. The dialog allows manual course and speed entry (C/S).

**GPS off** simulates GPS loss by withholding GPS position and ground course/speed from the filter. Log and compass input, if selected, continues to be used.

### Enter chart observations

1. Center the chart on a known reference object, such as a beacon or lighthouse.
2. Click the **KF** button to open the dialog. The chart center is captured when the dialog opens.
3. Bearing and range fields are available in GPS-lock and dead-reckoning modes. They are prefilled with the bearing and range from AvNav’s current boat position to the chart center. If magnetic variation is available, the dialog also offers a **magnetic** checkbox and pre-fills the bearing as magnetic; otherwise bearings are true.
4. Choose an action:
   - ![Fix icon](icons/gps.svg) **Fix**: Uses the chart center as the boat's observed position, for example when close to a buoy or other known object. Available before initialization, in GPS lock, and in dead-reckoning mode. With **update filter** enabled, the fix is submitted to the filter; otherwise it is only plotted.
   - ![BRG icon](icons/brg.svg) **BRG**: Enter the bearing to the centered object. Select **magnetic** for a magnetic bearing; when **update filter** is enabled, the plugin converts it to true before submission. When enabled, the bearing is submitted as a filter observation; otherwise it is only plotted. Successive bearings can be used for cross-bearings or running fixes.
   - ![RNG icon](icons/rng.svg) **RNG**: Enter the measured range and submit it. The overlay draws a range arc around the prefilled bearing (or the bearing entered in the dialog).
   - ![BRG+RNG icon](icons/brgrng.svg) **BRG+RNG**: Submit bearing and range together. Select **magnetic** if needed; when updating the filter, the plugin converts the bearing to true before submission. The overlay draws the bearing line and a narrow range arc.
   - ![C/S icon](icons/cogsog.svg) **C/S** (**4D-model**): In manual dead-reckoning mode, enter course over ground (true) and speed over ground. The button is available after initialization; selecting it submits the values.

The **update filter** setting is enabled by default before initialization and in dead-reckoning mode, and disabled by default while locked to GPS. It is available in all modes and controls whether Fix, BRG, RNG and BRG+RNG are submitted to the filter or only plotted. It does not gate the **C/S** button.

With **Show labels** enabled, plotted markers include their entry time, and bearing/range markers also show the entered values; bearing labels are marked **M** or **T** for magnetic or true. The overlay retains up to 20 recent markers.

### Phone compass (CMP)

1. In the **KF** dialog, click **CMP** to open the tilt-compensated compass, which uses the phone's orientation sensors.
2. Sight the reference object along the phone's long edge; you do not need to look at the screen. Tap anywhere on the screen to stop the compass.
3. The bearing is entered in the **BRG** field when the dialog reopens. Accept it or adjust it, then choose **BRG** or **BRG+RNG**.

Calibrate the phone's compass before use. **CMP** is shown only if the device and browser provide a valid orientation reading and permission is granted. Sensor access requires a secure context. AvNav is often served over HTTP on a local network, which some browsers block. For a trusted AvNav origin only, add its exact origin (including scheme, host, and port) to `chrome://flags/#unsafely-treat-insecure-origin-as-secure` page in Chrome, enable the flag, and restart the browser. This flag weakens browser security for that origin.

### Reset and clear markers

- ![Reset icon](icons/reset.svg) **Reset** restarts the filter and clears plotted markers.
- ![Cleanup icon](icons/eraser.svg) **Cleanup** clears observation markers from the overlay; it does not undo observations already incorporated by the filter.

## How the filter combines measurements

A Kalman filter keeps one evolving estimate of the boat, rather than choosing one sensor as the answer. In the **4D-model**, that estimate contains position and ground velocity. In the **6D-model**, it contains position, water velocity from the log and compass, and an estimated current. Each input provides a different clue about the same boat state.

On each active update, the plugin first **predicts** where the boat should be now. It advances the previous state using the estimated velocity (and, in the 6D-model, current). The prediction also increases the state’s covariance—the filter’s representation of how uncertain it is. Motion process-noise settings control how quickly that uncertainty grows, allowing the estimate to adapt when real motion differs from the model.

It then **corrects** the prediction with available observations. For each one, the filter compares the observation with what its current estimate would predict, and adjusts the shared state by an amount based on both the state covariance and the configured measurement error. A small measurement error makes an observation more influential; a large error makes the filter rely more on its existing estimate. Position covariance is also what the overlay visualizes as the confidence ellipse.

A single bearing mainly reduces uncertainty **across** the line of sight: it tells the filter the direction to the reference point, but not the distance along that direction. The ellipse therefore tends to narrow across the bearing line while remaining elongated along it. Two bearings whose lines of sight cross at roughly a right angle form a **cross-bearing** and can reduce uncertainty in both directions. The bearings need not be taken at the same time: the filter predicts the boat forward between observations, carries the resulting uncertainty forward, and corrects it with each new bearing. This is a **running fix**. For the most useful next bearing, choose a reference whose line of sight is preferably perpendicular to the ellipse’s long axis, the direction in which the position is currently least certain.

The plugin gathers new, valid sensor values on each loop and applies the matching updates in sequence:

- **Position (GPS or Fix):** A longitude/latitude position is converted to local metre coordinates and corrects the estimated position. When enabled, GPS HDOP scales the configured position error; chart fixes use the configured error without HDOP scaling.
- **Compass and log (6D-model):** A true heading (**HDT**) and water speed (**STW**) together correct water velocity. The filter estimates current as part of the same state, so position references can also help it distinguish ground motion from water motion.
- **Course and speed (4D-model):** **COG/SOG** set the ground-velocity portion of the state from the manual course and speed input.
- **Chart bearing and range:** A bearing (**BRG**) to a known charted point corrects the boat’s position using the point’s location and the configured bearing error. A range (**RNG**) to that point similarly corrects position using the configured range error. **BRG+RNG** applies both observations in sequence.

These corrections are not averaged independently and combined later: each one updates the same state and covariance before the next observation is processed. Thus, when several fresh inputs are available together, their information accumulates in the estimate according to their uncertainty. Invalid or stale sensor values are skipped. Chart observations are sent to the plugin only when **update filter** is enabled; otherwise they are plotted without changing the estimate. The plugin also avoids reading its own published estimate back as an input.

For a deeper explanation of Kalman filters and their use in tracking, see [Kalman and Bayesian Filters in Python](https://github.com/rlabbe/Kalman-and-Bayesian-Filters-in-Python).
