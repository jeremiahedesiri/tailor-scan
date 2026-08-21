const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
function load(file, key, extra = {}) { const context = { ...extra }; vm.runInNewContext(fs.readFileSync(file, 'utf8'), context); return context[key]; }

test('creates a semantic landmark without changing raw pose data', () => {
  const model = load('landmark-model.js', 'tailorScanLandmarks');
  const rawPoint = { x: .2, y: .3, visibility: .9 };
  const raw = model.createRawPoseLandmarks({ image_width: 100, image_height: 200, landmarks: { leftShoulder: rawPoint } });
  const landmark = model.createLandmark({ name: 'left_acromion', x_px: 22, y_px: 61, x_norm: .22, y_norm: .305, confidence: .8, source: 'refined' });
  const tailoring = model.createTailoringLandmarks({ left_acromion: landmark });
  assert.equal(raw.landmarks.leftShoulder.x, .2);
  assert.equal(tailoring.left_acromion.source, 'refined');
  assert.equal(tailoring.natural_waist_center, null);
  const referenced = model.createPoseReferencedTailoringLandmarks(model.createRawPoseLandmarks({ image_width: 100, image_height: 200, landmarks: { left_elbow: rawPoint }, frame_id: 'frame-1', view_id: 'front' }));
  assert.equal(referenced.left_elbow.x_px, 20);
  assert.equal(referenced.left_elbow.source, 'pose');
  assert.equal(referenced.left_acromion, null);
});

test('rejects invalid landmark coordinates and height input', () => {
  const model = load('landmark-model.js', 'tailorScanLandmarks');
  const calibration = load('calibration.js', 'tailorScanCalibration');
  assert.throws(() => model.createLandmark({ name: 'left_elbow', x_px: 1, y_px: 2, x_norm: 1.2, y_norm: .2, confidence: .9, source: 'pose' }), /between 0 and 1/);
  assert.throws(() => calibration.createHeightInput(0), /greater than zero/);
  assert.equal(calibration.createHeightInput(72.5).height_inches, 72.5);
});

test('image loader handles valid, missing, and undecodable inputs', async () => {
  class GoodImage { set src(value) { this.value = value; this.onload(); } }
  class BadImage { set src(value) { this.onerror(); } }
  const images = load('image-loader.js', 'tailorScanImages');
  assert.equal((await images.loadImage('data:image/png;base64,x', GoodImage)).value, 'data:image/png;base64,x');
  await assert.rejects(images.loadImage('', GoodImage), /non-empty/);
  await assert.rejects(images.loadImage('broken', BadImage), /decode/);
});

test('silhouette helpers report extremes, boundaries, and disjoint runs', () => {
  const utils = load('silhouette-utils.js', 'tailorScanSilhouetteUtils');
  const data = new Float32Array(20); [6, 7, 9, 11, 12, 13].forEach(index => { data[index] = 1; });
  const mask = { width: 5, height: 4, data };
  assert.equal(JSON.stringify(utils.get_mask_row_intersections(mask, 1)), JSON.stringify([{ left: 1, right: 2 }, { left: 4, right: 4 }]));
  assert.equal(JSON.stringify(utils.get_left_boundary(mask, 2)), JSON.stringify({ x: 1, y: 2 }));
  assert.equal(JSON.stringify(utils.get_right_boundary(mask, 2)), JSON.stringify({ x: 3, y: 2 }));
  assert.equal(JSON.stringify(utils.get_topmost_subject_point(mask)), JSON.stringify({ x: 2.5, y: 1 }));
  assert.equal(JSON.stringify(utils.get_bottommost_subject_point(mask)), JSON.stringify({ x: 2, y: 2 }));
  assert.throws(() => utils.get_left_boundary(mask, 9), /outside/);
});
