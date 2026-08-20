# Tailor Scan MVP

A mobile-first, static prototype for a tailor's measurement workflow. It supports guided front and side capture using the rear camera when available, editable inch measurements, summary review, and local profile saving.

## Run

Serve this folder from any static file server, then open `index.html` on a device/browser. Camera access requires HTTPS or `localhost` and user permission.

## Accuracy boundary

The app intentionally labels the values as estimates. It does not claim that ordinary 2D phone images yield reliable tailoring measurements. Actual height scales length estimates, snug chest anchors upper-body circumferences, and snug hip anchors lower-body circumferences. These inputs create proportional starting estimates only; users should confirm and correct every value manually. The UI/state boundary is prepared for a future landmark/3D engine to replace the defaults with derived estimates.

