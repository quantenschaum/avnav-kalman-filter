# Dead Reckoning Plugin for AvNav

## How it works in principle

- at core uses [kalman filter](https://en.wikipedia.org/wiki/Kalman_filter) to estimate position, course, speed
  - an iterative extended kalman filter iEKF
- 2 models
  - manual entry
    - work w/o any sensor, like DR plotting on paper, just live
    - 4d state vector: pos,cog,sog
    - enter fixes (like start position)
    - enter course,speed changes
    - enter bearings
  - log/compass mode
    - 6d state vector: pos, water speed, heading (course through water), current set and drift
    - continuously reads paddlewheel log + electronic compass (continuously updated DR, follow course/speed changes)
    - esitmates current when fixes or bearings are supplied manually
      - those absolute observations pull the position "back on track"
- both modes can run locked to gps and take over on failure (when on gps pos is available)
- failure can be simulated to test and tune the filter
- estimated position covariance ellpise is shown on chart
- generates NMEA RMC sentence to inject estimated pos/cog/sog into avnav

## What's in the Box?

- button on chart page to
  - allow manual data entry
  - enable/disbale simulated gps failure for testing/tuning
- map overlay to show estimated position and covariance ellpise
  - needs to added, other wise entry of bearings doesnt work

## installation

- download the zip and upload it into avnav on plugin page
- needs numpy

## setup

- configure in plugin settings
- use_log selects model, with log/compass or fully manual
- process noise describes how fast the uncertainty (ellipse) grows, adjust carefully
  - v for position course speed
  - w for current (set/drift) keep this lower to adjust current slowly
    nmea output priotriy should be low to not override actual gps data

- add the map overlay: layout > edit > on map > add kalmanfilter
- confidence level in perecent for the cov ellipse

## usage

- use avnav as normal
- the plugin published it s internal data in `gps.kalman.*` use them in widgets as usual
- observe the overlay, the cov ellpise
- if gps fails, the filter will take over
- simulate this by clicking the KF button

- the dialog has these buttons
  - reset = reset filter, start over
  - cleanup = delete all bearings from chart
  - gps off = simulate gps failure, stops feeding the filter with gps positions (will reveal following buttons)
  - fix = tell filter we are at chart center (cross hair)
  - rng = tell filter the range to chart center, enter value in rng field, circle will be drawn on chart
  - brg = tell filter a bearing to chart center, enter value in brg field, bearing line will be draw on chart

### taking bearings

- take a bearing (wrt true north)
- select object on chart, place under cross hair
- press KF button
- enter bearing, estimated bearing is prefilled
- press brg
- bearing will be drawn and position/cours/speed/covariance is adjusted accordingly

- taking ranges (from radar) works the same
- for cross bearings or running fixeds just take consecutive bearings, one after the other, the filter will merge them automatically
