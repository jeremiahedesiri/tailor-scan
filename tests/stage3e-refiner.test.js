const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function api() {
  const context = {};
  for (const file of ['landmark-model.js', 'stage2-resolver.js', 'torso-profile.js', 'stage3d-refiner.js', 'stage3e-refiner.js']) vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  return context;
}

function candidate(index, score = .62, overrides = {}) {
  return {
    index, x: 30 - index, y: 30 + index, score,
    score_components: { ridge_laterality: .68, upper_arm_alignment: .7, tangent_transition: .48, persistence: .72, lateral_peak: .82, vertical_plausibility: .84, upper_arm_projection: .86, distance_plausibility: .78, curvature_support: .1 },
    rejection_reasons: [], ...overrides
  };
}

function shoulderAnalysis(scale = 1, separate = false) {
  const contour = Array.from({ length: 24 }, (_, index) => ({ x: (42 - index) * scale, y: (28 + index * .7) * scale, arc_length: index * 1.35 * scale, tangent_angle: index < 12 ? 165 : 112, distance_from_centerline: (18 + index) * scale, projection_on_upper_arm_axis: index / 80 }));
  const points = [candidate(9, .61), candidate(10, .64), candidate(11, .63), candidate(12, .62)];
  if (separate) points.push(candidate(20, .6, { x: 20 * scale, y: 48 * scale }));
  points.forEach(point => { point.x *= scale; point.y *= scale; });
  return { ordered_contour: contour, candidate_ranking: points, raw_shoulder: { x: 35 * scale, y: 35 * scale, confidence: .9 }, upper_arm_onset: contour[13], shoulder_span: 28 * scale, upper_arm_vector: { x: -5 * scale, y: 40 * scale, length: 40.3 * scale }, warnings: [] };
}

function raw(scale = 1) {
  const width = 120 * scale, height = 180 * scale, point = (x, y, visibility = .9) => ({ x: x * scale / width, y: y * scale / height, visibility, presence: visibility });
  return { image_width: width, image_height: height, landmarks: { left_shoulder: point(46, 36), right_shoulder: point(74, 35), left_elbow: point(31, 78), right_elbow: point(89, 78) } };
}

function neckStage3D() {
  const samples = Array.from({ length: 14 }, (_, index) => ({ body_y: 20 + index, left_boundary: { x: 56 - index * .55, y: 20 + index }, right_boundary: { x: 64 + index * .55, y: 20 + index }, width_px: 8 + index * 1.1, smoothed_width_px: 8 + index * 1.1, width_derivative: .7, bilateral_confidence: .86 }));
  const ranking = [4, 5, 6, 7].map((index, offset) => ({ index, score: .58 + offset * .02, expansion_strength: .085, transition_persistence: .72, neck_to_shoulder_ratio: .42 }));
  return { neckAnalysis: { width_profile: samples, candidate_ranking: ranking, derivative_window: 2, contour_continuity: .84 }, warnings: [] };
}

test('adjacent high scoring samples collapse into one anatomical candidate region', () => {
  const a = api(), regions = a.tailorScanStage3E.clusterCandidateRegions(shoulderAnalysis());
  assert.equal(regions.length, 1);
  assert.equal(regions[0].point_count, 4);
});

test('spatially separate transition candidates remain competing regions', () => {
  const a = api(), regions = a.tailorScanStage3E.clusterCandidateRegions(shoulderAnalysis(1, true));
  assert.equal(regions.length, 2);
});

test('moderate soft evidence accepts a shoulder without curvature dominance', () => {
  const a = api(), result = a.tailorScanStage3E.resolveAcromion({ analysis: shoulderAnalysis(), rawPose: raw(), side: 'left', neckTransition: { x: 55, y: 30, confidence: .55 }, componentDominance: .88 });
  assert.ok(result.point);
  assert.notEqual(result.acceptanceState, 'unresolved');
  assert.ok(result.point.confidence > .35);
  assert.equal(result.analysis.candidate_region_count, 1);
  assert.ok(result.analysis.transition_zone);
});

test('low confidence accepted remains distinct from unresolved and measurement ready', () => {
  const a = api(), analysis = shoulderAnalysis();
  analysis.candidate_ranking.forEach(item => { item.score = .44; for (const key of Object.keys(item.score_components)) item.score_components[key] = .44; item.score_components.tangent_transition = .3; item.score_components.persistence = .4; item.score_components.curvature_support = 0; });
  const lowVisibilityRaw = raw(); lowVisibilityRaw.landmarks.left_shoulder.visibility = .48;
  const result = a.tailorScanStage3E.resolveAcromion({ analysis, rawPose: lowVisibilityRaw, side: 'left', neckTransition: null, componentDominance: .52 });
  assert.equal(result.acceptanceState, 'low_confidence_accepted');
  assert.ok(result.point);
  assert.equal(result.analysis.measurement_ready, false);
});

test('hard anatomical violations remain unresolved', () => {
  const a = api(), analysis = shoulderAnalysis();
  analysis.candidate_ranking.forEach(item => item.rejection_reasons = ['SIDE_CROSSING']);
  const result = a.tailorScanStage3E.resolveAcromion({ analysis, rawPose: raw(), side: 'left', componentDominance: 1 });
  assert.equal(result.point, null);
  assert.equal(result.acceptanceState, 'unresolved');
});

test('candidate clustering and acceptance are invariant across image scale', () => {
  const a = api();
  for (const scale of [1, 2, 3]) {
    const result = a.tailorScanStage3E.resolveAcromion({ analysis: shoulderAnalysis(scale), rawPose: raw(scale), side: 'left', neckTransition: { x: 55 * scale, y: 30 * scale, confidence: .6 }, componentDominance: .9 });
    assert.equal(result.analysis.candidate_region_count, 1);
    assert.ok(result.point);
  }
});

test('neck transition zone combines moderate evidence without multiplicative collapse', () => {
  const a = api(), stage3d = neckStage3D(), result = a.tailorScanStage3E.resolveNeck({ stage3d, rawPose: raw(), bodyAxis: { top: { x: 60, y: 5 }, bottom: { x: 60, y: 170 } }, componentDominance: .82 });
  assert.ok(result.base);
  assert.ok(result.analysis.left_transition_zone);
  assert.ok(result.analysis.right_transition_zone);
  assert.ok(result.base.confidence >= .5);
});

test('weak or anatomically invalid neck evidence remains unresolved', () => {
  const a = api(), stage3d = neckStage3D();
  stage3d.neckAnalysis.candidate_ranking.forEach(item => { item.expansion_strength = 0; item.transition_persistence = .1; item.score = .3; });
  const result = a.tailorScanStage3E.resolveNeck({ stage3d, rawPose: raw(), bodyAxis: { top: { x: 60, y: 5 }, bottom: { x: 60, y: 170 } }, componentDominance: .8 });
  assert.equal(result.base, null);
  assert.equal(result.analysis.landmark_acceptance_state, 'unresolved');
});

test('missing acromions produce non-evaluable bilateral diagnostics with null spans', () => {
  const a = api(), r = raw(), mask = { width: 120, height: 180, data: new Float32Array(120 * 180) };
  for (let y = 5; y < 170; y++) for (let x = 40; x <= 80; x++) mask.data[y * 120 + x] = .95;
  const empty = shoulderAnalysis(); empty.candidate_ranking.forEach(item => item.rejection_reasons = ['SIDE_CROSSING']);
  const stage3d = { resolvedLandmarks: a.tailorScanLandmarks.createTailoringLandmarks(), shoulderAnalysis: { left: empty, right: empty }, neckAnalysis: { width_profile: [], candidate_ranking: [] }, bilateralShoulderDiagnostics: { classification: 'plausible', acromion_span_px: 0, acromion_to_raw_span_ratio: 0 }, generalizationDiagnostics: {}, warnings: [] };
  const stage2 = { bodyAxis: { top: { x: 60, y: 5 }, bottom: { x: 60, y: 170 } }, normalization: { body_axis_height_px: 165 } };
  const result = a.tailorScanStage3E.resolve({ rawPose: r, personMask: mask, stage2, stage3c: {}, stage3d });
  assert.equal(result.bilateralShoulderDiagnostics.classification, 'not_evaluable');
  assert.equal(result.bilateralShoulderDiagnostics.acromion_span_px, null);
  assert.equal(result.bilateralShoulderDiagnostics.acromion_to_raw_span_ratio, null);
});
