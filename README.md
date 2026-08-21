# Tailor Scan MVP

A mobile-first, static prototype for a tailor's measurement workflow. It supports a short guided 360° video scan using the rear camera when available, editable inch measurements, summary review, and local profile saving.

## Run

Serve this folder from any static file server, then open `index.html` on a device/browser. Camera access requires HTTPS or `localhost` and user permission.

## Accuracy boundary

The app intentionally labels the values as estimates. It does not claim that ordinary 2D phone images yield reliable tailoring measurements. Actual height scales length estimates, snug chest anchors upper-body circumferences, and snug hip anchors lower-body circumferences. These inputs create proportional starting estimates only; users should confirm and correct every value manually. The UI/state boundary is prepared for a future landmark/3D engine to replace the defaults with derived estimates.

## Multi-view vision and reconstruction status

### Continuous 360° video capture

The preferred flow records a short continuous rear-camera scan (a 10–20 second slow turn is guidance, not a requirement). While recording, the browser samples a lightweight candidate image about every 650 ms, capped at 42 candidates. After the user presses **Finish Scan**, Tailor Scan releases the camera, analyzes those candidates with the existing MediaPipe pipeline, rejects weak/duplicate views, and sends only the selected representative frames (up to 20, target range 12–30) into the existing reconstruction flow.

The 0°–360° indicator is a guided time/progression prior, not a claimed vision-derived absolute azimuth. Scan acceptance still requires front, both sides, back, intermediate views, usable body visibility, segmentation, and pose results. Automatic stop is deliberately not enabled yet: a user presses **Finish Scan** after the full turn because elapsed time alone is not reliable coverage evidence. MediaRecorder is used where available to create a temporary recording, but the app does not retain it after useful frame extraction; live-frame sampling remains available on browsers without MediaRecorder. The older photo-checkpoint flow remains as an explicit fallback.

The browser loads `@mediapipe/tasks-vision` from jsDelivr for on-device person segmentation and Pose Landmarker inference. The provider records the real segmentation confidence mask, frame bounds, pose landmarks, pose world landmarks, and semantic pose-index correspondence keys for representative 360-degree frames. The package is Apache-2.0 and the official Selfie Segmenter model card is Apache-2.0. The Pose Landmarker task asset is loaded from its official MediaPipe URL, but its exact pinned model-asset terms must be verified and recorded before commercial distribution; the implementation is deliberately isolated behind `vision-provider.js` for that reason.

Angular coverage is currently based on the guided rotation checkpoints. Pose landmarks contribute a broad-torso confidence signal, but a monocular 2D pose does not reliably recover a person's absolute azimuth, so the app does not claim it does. Inter-frame pose/body-motion stability is retained as an explicit warning because it cannot be reliably inferred from a few rotating stills alone.

## Dense reconstruction status

`reconstruction-provider.js` adds an experimental, project-owned visual-hull method. It combines the selected real person masks using the stationary-camera / rotating-person assumption, then extracts the exposed surface of the intersected volume as a dense triangular mesh. This is a genuine silhouette-derived volume and is not a cylinder body or a fabricated mesh. Pose landmarks remain attached as anatomical references and are used to reject inputs without body pose data.

For scans with adequate angular coverage and quality, `mesh` is populated with vertices and triangular face indices. The raw mesh is stored separately in `state.reconstruction.rawGeometry`; the tape circumference anchors are not applied to it. When actual tape height is provided, the generated mesh vertices are scaled into inches and the physical transformation is stored in `scale`.

This method is intentionally experimental: guided checkpoints are used as relative view-angle priors, the camera is not intrinsically calibrated, and human movement/clothing can make masks inconsistent. The output is a closed voxel-surface visual hull suitable for later plane-intersection work, but its blocky resolution and visual-hull concavities are not production tailoring accuracy. No external parametric body model or restricted-license asset is used by the dense reconstruction provider.

## Anatomical circumference extraction

`circumference-measurement.js` measures chest, waist, hip, bicep, and calf only by intersecting the raw 3D mesh with an anatomically oriented plane. It triangulates semantic 2D pose landmarks across the guided views into the reconstruction's body coordinate system, then uses torso, pelvic, upper-arm, or lower-leg axes to orient each plane. The result is accepted only when a closed mesh-intersection curve is found; a missing or low-confidence curve is reported as a failure instead of being replaced with front-view width or a proportion estimate. Physical inches come from the height-scaled mesh. The raw values are retained in both `state.reconstruction.rawCircumferences` and `state.reconstruction.rawGeometry.rawCircumferences`. Tape circumference values are not used before this raw stage completes.

After a valid raw cross-section is available, the calibration layer can apply independent tape-derived regional factors: chest-to-chest, waist-to-waist, hip-to-hip, bicep-to-bicep, and calf-to-calf. It never uses a universal torso or limb factor. Each calibration record retains the raw mesh perimeter, geometric confidence/status, raw-versus-tape geometry error, proposed and applied scale, final value, and remaining scaling error. A low-confidence plane or a large proposed adjustment is withheld for review rather than being concealed by scaling. Height remains the physical global scale applied to the mesh itself and to compatible landmark-distance measurements.

`mesh-refinement.js` now uses eligible tape anchors as required local 3D constraints. It copies the raw mesh, scales only the radial geometry around the relevant anatomical plane, blends the adjustment smoothly along the local anatomical axis, and remeasures the altered mesh. It uses up to twelve bounded iterations and retains both raw and refined geometry. A valid anchor is driven toward a 0.1-inch residual; only missing/invalid mesh cross-sections can prevent refinement. Final values come from the refined mesh remeasurement—not directly from the tape input.

## KingDraft-ready output

`window.tailorScan.buildKingDraftMeasurementOutput()` returns a versioned body-measurement payload in inches with `height`, `chest`, `waist`, `hip`, `bicep`, `calf`, `shoulder_to_waist`, `sleeve_length`, `trouser_length`, `inseam`, and `outseam`. It has no garment ease or drafting calculations. A separate `diagnostics` object records each field's raw value, scale source/factor, tape anchor, confidence, and status. The same payload is saved with each local measurement profile for a future KingDraft connector.
