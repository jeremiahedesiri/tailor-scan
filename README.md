# Tailor Scan

A mobile-first tailoring landmark prototype. The current UI implements Stage 3F body-axis-relative neck-base refinement.

## Stage 3F model

1. Enter the subject's actual height in inches.
2. Capture one full-body front photo.
3. MediaPipe performs on-device person segmentation and pose-landmark detection.
4. Raw pose output is stored separately from the semantic tailoring-landmark collection.
5. The dominant silhouette component resolves head top and pose-guided foot contact references.
6. Shoulder, hip, and foot evidence establishes a reusable body axis and body-relative normalization.
7. Debug artifacts include overlays, confidence diagnostics, warnings, and machine-readable JSON.
8. Pose-guided silhouette analysis independently proposes acromion, neck-base, waist, outer-hip, and crotch landmarks.
9. Stage 3B rejects side-crossed or excessively displaced acromions, validates neck and landmark ordering, requires multi-cue waist evidence, and separates visible leg separation from anatomical crotch confidence.
10. Stage 3C constrains acromions with shoulder-to-elbow direction and candidate competition, then evaluates sustained waist basins across the individual ribcage-to-pelvis profile.
11. Stage 3D resolves neck transitions first, traces ordered neck-to-shoulder ridge paths, and identifies each acromion from sustained lateral-to-upper-arm contour transitions.
12. Conservative readiness flags report whether future shoulder-, sleeve-, or neck-dependent calculations have sufficiently confident landmarks; they do not calculate measurements.
13. Stage 3E clusters adjacent shoulder candidates into anatomical regions, evaluates a shoulder-to-arm transition zone, and separates landmark acceptance from measurement readiness.
14. Neck transitions use sustained widening zones and bounded weighted confidence instead of multiplying moderate evidence toward zero.
15. Stage 3F preserves Stage 3E acromions exactly, samples the neck perpendicular to the body axis, and separates stable neck shaft, gradual anatomical widening, and shoulder-dominated expansion.

Stage 3F does not calculate tailoring measurements, circumferences, or reconstruct a 3D body. Existing shoulders, waist, hip, leg-separation, reconstruction, and repository-history work is preserved.

## Live Stage L1 experiment

The original photo workflow remains the primary mode. **Live Scan Experimental** opens a separate browser-camera session that samples frames at a configurable cadence, silently ignores weak frames, retains bounded per-landmark evidence, and stabilizes only raw shoulders, elbows, wrists, hips, knees, and ankles. Its output is temporal debug data and readiness diagnostics only; it is not passed into Stage 3F and contains no measurements.

## Accuracy boundary

This is a calibrated 2D framework, not a claim that monocular photos recover surface lengths. Perspective, clothing, posture, landmark placement, and camera tilt remain error sources. Check critical values before cutting fabric.

Serve the repository over HTTP, open `index.html`, enter standing height in inches, choose a front-view image, and select **Trace body outline**. MediaPipe model assets require an internet connection on first load.

Run tests with `node --test tests/*.test.js`.
