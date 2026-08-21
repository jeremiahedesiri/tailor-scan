(function exposeLandmarkModel(root) {
  const TAILORING_LANDMARK_NAMES = Object.freeze([
    'head_top', 'neck_base', 'left_neck_transition', 'right_neck_transition', 'left_acromion', 'right_acromion',
    'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist',
    'natural_waist_center', 'visible_leg_separation', 'crotch_center', 'left_outer_hip',
    'right_outer_hip', 'left_waist_boundary', 'right_waist_boundary',
    'left_knee', 'right_knee', 'left_ankle',
    'right_ankle', 'left_floor', 'right_floor'
  ]);
  const SOURCES = Object.freeze(['pose', 'silhouette', 'derived', 'refined']);

  function finite(name, value) {
    if (!Number.isFinite(value)) throw new TypeError(`${name} must be a finite number.`);
  }

  function createLandmark({ name, x_px, y_px, x_norm, y_norm, x_image_norm = x_norm, y_image_norm = y_norm, x_body_norm = null, y_body_norm = null, confidence, source, ...metadata }) {
    if (!TAILORING_LANDMARK_NAMES.includes(name)) throw new RangeError(`Unknown tailoring landmark: ${name}`);
    finite('x_px', x_px); finite('y_px', y_px); finite('x_norm', x_norm); finite('y_norm', y_norm); finite('confidence', confidence);
    if (x_px < 0 || y_px < 0) throw new RangeError('Pixel coordinates cannot be negative.');
    if (x_norm < 0 || x_norm > 1 || y_norm < 0 || y_norm > 1) throw new RangeError('Normalized coordinates must be between 0 and 1.');
    if (confidence < 0 || confidence > 1) throw new RangeError('confidence must be between 0 and 1.');
    if (!SOURCES.includes(source)) throw new RangeError(`Unsupported landmark source: ${source}`);
    if (x_body_norm !== null) finite('x_body_norm', x_body_norm);
    if (y_body_norm !== null) finite('y_body_norm', y_body_norm);
    // x_norm/y_norm remain image-relative for backward compatibility.
    return Object.freeze({ name, x_px, y_px, x_norm, y_norm, x_image_norm, y_image_norm, x_body_norm, y_body_norm, confidence, source, ...metadata });
  }

  function createRawPoseLandmarks({ image_width, image_height, landmarks, world_landmarks = null, frame_id = null, view_id = null }) {
    if (!Number.isInteger(image_width) || image_width <= 0 || !Number.isInteger(image_height) || image_height <= 0) throw new RangeError('Raw pose image dimensions must be positive integers.');
    if (!landmarks || typeof landmarks !== 'object') throw new TypeError('Raw pose landmarks are required.');
    // Keep MediaPipe values intact. Tailoring refinement must create separate records.
    return Object.freeze({ image_width, image_height, landmarks, world_landmarks, frame_id, view_id });
  }

  function createTailoringLandmarks(values = {}) {
    for (const name of Object.keys(values)) if (!TAILORING_LANDMARK_NAMES.includes(name)) throw new RangeError(`Unknown tailoring landmark: ${name}`);
    return Object.freeze(Object.fromEntries(TAILORING_LANDMARK_NAMES.map(name => [name, values[name] || null])));
  }

  const DIRECT_POSE_REFERENCES = Object.freeze({ left_elbow: 'left_elbow', right_elbow: 'right_elbow', left_wrist: 'left_wrist', right_wrist: 'right_wrist', left_knee: 'left_knee', right_knee: 'right_knee', left_ankle: 'left_ankle', right_ankle: 'right_ankle' });
  function createPoseReferencedTailoringLandmarks(rawPose) {
    const values = {};
    Object.entries(DIRECT_POSE_REFERENCES).forEach(([name, poseName]) => {
      const point = rawPose.landmarks[poseName];
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
      values[name] = createLandmark({ name, x_px: point.x * rawPose.image_width, y_px: point.y * rawPose.image_height, x_norm: point.x, y_norm: point.y, confidence: Math.max(0, Math.min(1, point.visibility ?? point.presence ?? 0)), source: 'pose', frame_id: rawPose.frame_id, view_id: rawPose.view_id });
    });
    return createTailoringLandmarks(values);
  }

  root.tailorScanLandmarks = Object.freeze({ TAILORING_LANDMARK_NAMES, SOURCES, createLandmark, createRawPoseLandmarks, createTailoringLandmarks, createPoseReferencedTailoringLandmarks });
})(typeof window === 'undefined' ? globalThis : window);
