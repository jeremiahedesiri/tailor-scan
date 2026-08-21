# Tailor Scan

A mobile-first two-photo tailoring measurement prototype.

## Measurement model

1. Enter the subject's actual height in inches.
2. Capture one full-body front photo and one full-body side photo.
3. MediaPipe performs on-device person segmentation and pose-landmark detection.
4. Each mask is reduced to its 2D boundary; named anatomical landmarks remain attached.
5. The detected head-to-floor span establishes an independent scale for each view.
6. Point-to-point lengths are converted to inches using that height scale.

The app does not reconstruct a 3D body and does not calculate circumferences from image width or a body-shape assumption. All circumference fields start blank and are manual tape entries.

## Accuracy boundary

This is a calibrated 2D framework, not a claim that monocular photos recover surface lengths. Perspective, clothing, posture, landmark placement, and camera tilt remain error sources. Check critical values before cutting fabric.

Run tests with `node --test tests/*.test.js`.
