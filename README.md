# Dead Reckoning Plugin for AvNav

The Kalman Filter plugin estimates the boat's position, course and speed. It uses an iterative extended Kalman filter (iEKF), combining motion data with GPS fixes and observations you enter on the chart. When recent GPS positions are available, it follows them; when they stop, it continues in dead-reckoning mode.

![AvNav](avnav.png)

## Models

Choose the model with **Use log and compass** in the plugin settings:

- **Manual** (off): Uses position and ground velocity. You can enter a fix and update course and speed from the chart dialog; no log or compass is required.
- **Log and compass** (on): Uses water speed from the log and heading from the compass, and estimates current as well as position. Chart fixes, bearings and ranges help correct the estimate. The compass needs to supply true heading.

Both models can use GPS input. The **GPS off** button simulates lost GPS for testing by withholding GPS position and ground course/speed from the filter. Log and compass input, if selected, continues to be used.

## Install and configure

1. Upload the plugin ZIP from AvNav's **Plugins** page. NumPy must be installed in AvNav's Python environment.
2. Configure the plugin in its settings. **Use log and compass** selects the model. **Noise v** controls how quickly uncertainty in motion and position grows; in log-and-compass mode, **Noise w** controls how quickly the estimated current can change. Higher values let the estimate adapt faster but make uncertainty grow faster too.
3. Add the **KalmanFilter** map overlay: **Layout → Edit → On map → Add KalmanFilter**. The overlay shows the estimated position and its covariance ellipse, and is needed for chart-based fixes, bearings and ranges.
4. Set the overlay's confidence level (percent) to control the ellipse shown. The overlay can also show the course/speed and current vectors.

Keep the NMEA output priority below that of your real GPS source so the estimate does not take precedence over GPS data. The plugin sends an RMC sentence when operating in dead-reckoning mode and GPS input has not been disabled manually.

## Use

The plugin publishes its estimate under `gps.kalman.*`, which you can use in AvNav widgets.

Click **KF** button on the chart to open the controls. In dead-reckoning mode, you can:

- **Fix**: use the chart center as the boat's observed position (when close to buoy or other know object).
- **C/S** (manual model): enter course over ground (true) and speed over ground.
- **BRG**: enter a true bearing to the object at the chart center.
- **RNG**: enter the range to the object at the chart center (in nautical miles).

Bearings and ranges are prefilled with the estimate from the boat to the chart center. To take a bearing, place the charted object at the center, press **KF**, enter the true bearing you measured, then press **BRG**. For a range, place the object at the center, enter the measured range and press **RNG**. The overlay draws each observation on the chart and the filter incorporates it into the estimate. Enter successive bearings to combine cross-bearings or running fixes.

**GPS off** simulates GPS loss. **Reset** restarts the filter; **Cleanup** clears the observation markers from the overlay (it does not undo observations already incorporated by the filter).
