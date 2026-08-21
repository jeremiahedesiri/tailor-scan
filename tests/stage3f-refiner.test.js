const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function api() {
  const context = {};
  for (const file of ['landmark-model.js', 'stage2-resolver.js', 'torso-profile.js', 'stage3f-refiner.js']) vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  return context;
}

function fixture(scale = 1, options = {}) {
  const a = api(), width = 140 * scale, height = 190 * scale, data = new Float32Array(width * height), tilt = options.tilt || 0, shaftHalf = options.shaftHalf ?? 7, shoulderHalf = options.shoulderHalf ?? 35, shaftEnd = options.shaftEnd ?? 45, entryStart = options.entryStart ?? 58;
  const centerAt = y => 70 * scale + tilt * (y / scale - 20) * scale;
  for (let y = 10 * scale; y < 175 * scale; y++) {
    const baseY = y / scale, center = centerAt(y), asymmetry = options.asymmetry && baseY > shaftEnd ? 2.5 * scale : 0;
    let half;
    if (baseY < 25) half = 11 * scale;
    else if (baseY <= shaftEnd) half = shaftHalf * scale + Math.max(0, baseY - 32) * (options.weakWidening ? .03 : .16) * scale;
    else if (baseY < entryStart) half = (shaftHalf + (shaftEnd - 32) * (options.weakWidening ? .03 : .16) + (baseY - shaftEnd) * (options.gradual ?? .52)) * scale;
    else half = shoulderHalf * scale + Math.min(8 * scale, (baseY - entryStart) * .3 * scale);
    if (options.collar && baseY >= 37 && baseY <= 38) half += 12 * scale;
    if (options.spike && baseY === 42) half += 18 * scale;
    if (options.missingSide && baseY > 34 && baseY < entryStart) half = baseY % 3 ? half : 1;
    const left = Math.max(0, Math.round(center - half - asymmetry)), right = Math.min(width - 1, Math.round(center + half));
    for (let x = left; x <= right; x++) data[y * width + x] = options.noise && (x + y) % 31 === 0 ? .35 : .96;
  }
  const mask = { width, height, data }, component = a.tailorScanStage2.dominantComponent(mask), point = (x, y, confidence = .92) => ({ x: x * scale / width, y: y * scale / height, visibility: confidence, presence: confidence }), rawPose = a.tailorScanLandmarks.createRawPoseLandmarks({ image_width: width, image_height: height, landmarks: { left_shoulder: point(42, 63), right_shoulder: point(98, 61), left_elbow: point(28, 105), right_elbow: point(112, 104) } }), axis = { top: { x: centerAt(10 * scale), y: 10 * scale }, bottom: { x: centerAt(175 * scale), y: 175 * scale }, confidence: .9 }, normalization = a.tailorScanStage2.createNormalization(axis), landmark = (name, x, y, confidence = .9, source = 'refined') => { const n = normalization.point({ x: x * scale, y: y * scale }, width, height); return a.tailorScanLandmarks.createLandmark({ name, x_px: x * scale, y_px: y * scale, x_norm: n.x_image_norm, y_norm: n.y_image_norm, ...n, confidence, source }); }, values = { left_acromion: landmark('left_acromion', 34, 61), right_acromion: landmark('right_acromion', 106, 59) };
  for (const name of ['left_elbow', 'right_elbow', 'left_wrist', 'right_wrist', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle', 'head_top', 'natural_waist_center', 'left_outer_hip', 'right_outer_hip', 'visible_leg_separation']) values[name] = null;
  const stage3e = { resolvedLandmarks: a.tailorScanLandmarks.createTailoringLandmarks(values), shoulderAnalysis: { left: { landmark_acceptance_state: 'accepted' }, right: { landmark_acceptance_state: 'accepted' } }, neckAnalysis: {}, bilateralShoulderDiagnostics: { classification: 'plausible', acromion_span_px: 72 * scale }, measurementLandmarkReadiness: { shoulder_width_ready: true, left_sleeve_ready: false, right_sleeve_ready: false, neck_based_measurements_ready: false }, generalizationDiagnostics: {}, warnings: [] }, stage2 = { bodyAxis: axis, normalization: { body_axis_height_px: 165 * scale }, resolvedLandmarks: a.tailorScanLandmarks.createTailoringLandmarks() }, prior = Array.from({ length: 35 }, (_, index) => ({ body_y: (25 + index) * scale })), stage3d = { neckAnalysis: { width_profile: prior } };
  return { a, mask, component, rawPose, stage2, stage3d, stage3e, scale };
}

function run(f) { const profile = f.a.tailorScanStage3F.buildNeckProfile({ personMask: f.mask, component: f.component, rawPose: f.rawPose, stage2: f.stage2, stage3d: f.stage3d, stage3e: f.stage3e }), analysis = f.a.tailorScanStage3F.analyzeProfile(profile), neck = f.a.tailorScanStage3F.resolveNeck({ profile, analysis, stage2: f.stage2, stage3e: f.stage3e }); return { profile, analysis, neck }; }

test('normal neck separates shaft, gradual widening, shoulder entry, and transition', () => {
  const result = run(fixture());
  assert.ok(result.analysis.neck_shaft_zone);
  assert.ok(result.analysis.anatomical_expansion_zone);
  assert.ok(result.analysis.shoulder_entry_zone);
  assert.ok(result.analysis.selected_transition_region);
  assert.ok(result.neck.base);
});

test('neck and shoulder build families remain bounded or deliberately unresolved', () => {
  const cases = [
    { shaftHalf: 5, shoulderHalf: 42 },
    { shaftHalf: 11, shoulderHalf: 29 },
    { shaftEnd: 52, entryStart: 67 },
    { shaftEnd: 36, entryStart: 48 },
    { asymmetry: true },
    { gradual: .75 },
    { weakWidening: true }
  ];
  for (const options of cases) {
    const result = run(fixture(1, options));
    assert.ok(['accepted', 'low_confidence_accepted', 'unresolved'].includes(result.neck.analysis.acceptance_state));
    if (result.neck.base) assert.ok(result.neck.base.confidence >= 0 && result.neck.base.confidence <= 1);
  }
});

test('tilted body axis uses perpendicular profile slices', () => {
  const result = run(fixture(2, { tilt: .08 }));
  assert.ok(result.profile.normalized_profile.length > 15);
  assert.ok(result.profile.normalized_profile.every(sample => Number.isFinite(sample.body_axis_position)));
  assert.ok(result.analysis.neck_shaft_zone);
});

test('noise, one-row spikes, and collar-like expansion do not become the shoulder entry by themselves', () => {
  for (const options of [{ noise: true }, { spike: true }, { collar: true }, { spike: true, collar: true }]) {
    const result = run(fixture(1, options));
    if (result.analysis.shoulder_entry_zone) assert.ok(result.analysis.shoulder_entry_zone.start_index > result.analysis.neck_shaft_zone.end_index);
  }
});

test('abrupt shoulder entry and multiple derivative peaks select a supported region before entry', () => {
  for (const options of [{ shoulderHalf: 44 }, { collar: true, shoulderHalf: 40 }]) {
    const result = run(fixture(1, options));
    assert.ok(result.analysis.shoulder_entry_zone);
    assert.ok(result.analysis.selected_transition_region.end_index <= result.analysis.shoulder_entry_zone.start_index);
  }
});

test('weak side or missing bilateral evidence lowers confidence or resolves null', () => {
  for (const options of [{ missingSide: true }, { weakWidening: true, missingSide: true }]) {
    const result = run(fixture(1, options));
    assert.ok(result.neck.analysis.acceptance_state !== 'accepted' || result.neck.base.confidence < .85);
  }
  const f = fixture(), emptyProfile = { raw_profile: [], normalized_profile: [], acromion_span: 72, sample_spacing: 1 };
  const emptyAnalysis = f.a.tailorScanStage3F.analyzeProfile(emptyProfile), result = f.a.tailorScanStage3F.resolveNeck({ profile: emptyProfile, analysis: emptyAnalysis, stage2: f.stage2, stage3e: f.stage3e });
  assert.equal(result.base, null);
});

test('accepted acromions support a valid neck but do not force an unresolved neck', () => {
  assert.ok(run(fixture()).neck.base);
  const weak = run(fixture(1, { weakWidening: true, gradual: 0, shoulderHalf: 9 }));
  assert.equal(weak.neck.base, null);
  assert.equal(weak.neck.analysis.acceptance_state, 'unresolved');
});

test('same geometry is stable at 1x 2x and 3x scale', () => {
  const outcomes = [1, 2, 3].map(scale => run(fixture(scale)));
  assert.equal(new Set(outcomes.map(result => result.neck.analysis.acceptance_state)).size, 1);
  const levels = outcomes.map((result, index) => result.neck.base ? result.neck.analysis.body_axis_projected_level / [1, 2, 3][index] : null);
  if (levels.every(Number.isFinite)) assert.ok(Math.max(...levels) - Math.min(...levels) < 2);
});

test('Stage 3F preserves Stage 3E acromions and all unrelated landmarks exactly', () => {
  const f = fixture(), before = f.stage3e.resolvedLandmarks, result = f.a.tailorScanStage3F.resolve({ rawPose: f.rawPose, personMask: f.mask, stage2: f.stage2, stage3d: f.stage3d, stage3e: f.stage3e });
  for (const name of Object.keys(before)) if (!['left_neck_transition', 'right_neck_transition', 'neck_base'].includes(name)) assert.equal(result.resolvedLandmarks[name], before[name], name);
  assert.equal(result.shoulderAnalysis, f.stage3e.shoulderAnalysis);
  assert.equal(result.resolvedLandmarks.left_acromion, before.left_acromion);
  assert.equal(result.resolvedLandmarks.right_acromion, before.right_acromion);
});
