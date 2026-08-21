const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function api() {
  const context = {};
  vm.runInNewContext(fs.readFileSync('landmark-model.js', 'utf8'), context);
  vm.runInNewContext(fs.readFileSync('stage2-resolver.js', 'utf8'), context);
  return context;
}
function syntheticMask() {
  const width = 40, height = 100, data = new Float32Array(width * height);
  const fill = (x1, x2, y1, y2, value = .95) => { for (let y = y1; y <= y2; y += 1) for (let x = x1; x <= x2; x += 1) data[y * width + x] = value; };
  fill(16, 23, 5, 18); fill(10, 29, 19, 60); fill(11, 17, 61, 88); fill(22, 28, 61, 88); fill(10, 18, 89, 94); fill(21, 29, 89, 94);
  data[1] = 1; // isolated noise above the real head
  return { width, height, data };
}
function point(x, y, visibility = .9) { return { x: x / 40, y: y / 100, z: -.1, visibility, presence: visibility }; }
function raw(model, overrides = {}) {
  return model.createRawPoseLandmarks({ image_width: 40, image_height: 100, frame_id: 'f1', view_id: 'front', landmarks: {
    nose: point(20, 12), left_eye: point(18, 10), right_eye: point(22, 10), left_ear: point(16, 13), right_ear: point(24, 13),
    left_shoulder: point(13, 25), right_shoulder: point(27, 25), left_elbow: point(10, 42, .81), right_elbow: point(30, 42, .82), left_wrist: point(9, 58, .78), right_wrist: point(31, 58, .79),
    left_hip: point(16, 58), right_hip: point(24, 58), left_knee: point(14, 74, .88), right_knee: point(26, 74, .87), left_ankle: point(14, 89, .86), right_ankle: point(26, 89, .85),
    left_heel: point(13, 93, .9), right_heel: point(25, 93, .9), left_foot_index: point(17, 94, .88), right_foot_index: point(29, 94, .88), ...overrides
  } });
}

test('dominant component rejects isolated top noise and resolves scalp top', () => {
  const { tailorScanLandmarks: model, tailorScanStage2: stage2 } = api(), component = stage2.dominantComponent(syntheticMask()), head = stage2.resolveHeadTop(component, raw(model));
  assert.equal(component.bounds.min_y, 5);
  assert.equal(head.y, 5);
  assert.ok(head.confidence > .5);
  assert.equal(head.diagnostics.rejected_isolated_components, 1);
});

test('floor selection averages agreeing reliable feet', () => {
  const { tailorScanStage2: stage2 } = api(), floor = stage2.calculateFloor({ y: 94, confidence: .9 }, { y: 92, confidence: .8 }, 90);
  assert.equal(floor.floor_level_y, 93);
  assert.equal(floor.floor_method, 'bilateral-foot-average');
  assert.equal(floor.both_feet_reliable, true);
});

test('one reliable foot dominates a low-confidence foot', () => {
  const { tailorScanStage2: stage2 } = api(), floor = stage2.calculateFloor({ y: 94, confidence: .91 }, { y: 85, confidence: .2 }, 90);
  assert.equal(floor.floor_level_y, 94);
  assert.equal(floor.floor_method, 'left-reliable-foot');
  assert.equal(floor.both_feet_reliable, false);
});

test('centerline, height, and body-relative coordinates preserve tilt', () => {
  const { tailorScanLandmarks: model, tailorScanStage2: stage2 } = api(), pose = raw(model), head = { x: 19, y: 5 }, floor = { floor_level_y: 95 }, axis = stage2.calculateCenterline(pose, head, floor, { x: 15, y: 94 }, { x: 29, y: 94 }), normalization = stage2.createNormalization(axis);
  assert.ok(normalization.body_axis_height_px >= normalization.vertical_image_height_px);
  assert.equal(normalization.point(axis.top, 40, 100).y_body_norm, 0);
  assert.ok(Math.abs(normalization.point(axis.bottom, 40, 100).y_body_norm - 1) < 1e-12);
});

test('full resolution propagates confidence and produces normalized landmarks', () => {
  const { tailorScanLandmarks: model, tailorScanStage2: stage2 } = api(), result = stage2.resolve({ rawPose: raw(model), personMask: syntheticMask(), heightInput: { height_inches: 72.5 } });
  assert.equal(result.resolvedLandmarks.left_elbow.confidence, .81);
  assert.equal(result.resolvedLandmarks.left_elbow.source, 'pose');
  assert.equal(result.resolvedLandmarks.head_top.source, 'silhouette');
  assert.ok(Math.abs(result.resolvedLandmarks.head_top.y_body_norm) < .02);
  assert.equal(result.calibration.known_height_inches, 72.5);
  assert.match(result.calibration.first_order_image_scale.warning, /perspective/);
  assert.equal(result.resolvedLandmarks.left_acromion, null);
});

test('missing head evidence and missing feet are rejected', () => {
  const { tailorScanLandmarks: model, tailorScanStage2: stage2 } = api(), poseWithoutHead = raw(model, { nose: null, left_eye: null, right_eye: null, left_ear: null, right_ear: null, left_shoulder: null, right_shoulder: null });
  assert.throws(() => stage2.resolve({ rawPose: poseWithoutHead, personMask: syntheticMask() }), /Head top/);
  const poseWithoutFeet = raw(model, { left_ankle: null, right_ankle: null, left_heel: null, right_heel: null, left_foot_index: null, right_foot_index: null });
  assert.throws(() => stage2.resolve({ rawPose: poseWithoutFeet, personMask: syntheticMask() }), /Foot data/);
});
