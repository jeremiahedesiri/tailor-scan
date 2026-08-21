const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function loadVideoLogic() {
  const element = { hidden: false, value: '', textContent: '', innerHTML: '', disabled: false, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {} };
  const context = {
    document: { querySelector: () => element, querySelectorAll: () => [] },
    window: { scrollTo() {}, clearInterval() {} }, setTimeout() {}, console
  };
  const source = `${fs.readFileSync('app.js', 'utf8')}\nglobalThis.__videoTest = { guidedVideoAngle, selectRepresentativeFrames, evaluateRotationCoverage, rotationSelectionConfig, videoCaptureConfig, frameQualityScore };`;
  vm.runInNewContext(source, context);
  return context.__videoTest;
}

const goodQuality = { sharpness: .95, motionBlur: .05, bodyVisibility: .98, landmarkReliability: .95, segmentationQuality: .95, occlusion: .05 };
function frame(angle, quality = goodQuality) { return { id: `frame-${angle}`, angle, quality }; }

test('video timing is a bounded guidance prior, not an exact capture requirement', () => {
  const { guidedVideoAngle, videoCaptureConfig } = loadVideoLogic();
  assert.equal(guidedVideoAngle(0), 0);
  assert.equal(guidedVideoAngle(videoCaptureConfig.targetDurationMs / 2), 180);
  assert.equal(guidedVideoAngle(videoCaptureConfig.targetDurationMs * 2), 359);
  assert.equal(videoCaptureConfig.frameSampleIntervalMs, 650);
  assert.ok(videoCaptureConfig.targetRepresentativeFrames >= 12 && videoCaptureConfig.targetRepresentativeFrames <= 30);
});

test('representative selection rejects blurred and duplicate video samples', () => {
  const { selectRepresentativeFrames, rotationSelectionConfig } = loadVideoLogic();
  const candidates = [frame(0), frame(5), frame(45), frame(90), frame(135), frame(180), frame(225), frame(270), frame(315), frame(350), frame(120, { ...goodQuality, motionBlur: .8 })];
  const selected = selectRepresentativeFrames(candidates);
  assert.ok(selected.every(candidate => candidate.quality.motionBlur <= .35));
  assert.ok(selected.length < candidates.length - 1);
  for (let index = 0; index < selected.length; index += 1) for (let next = index + 1; next < selected.length; next += 1) {
    const difference = Math.abs(selected[index].angle - selected[next].angle);
    assert.ok(Math.min(difference, 360 - difference) >= rotationSelectionConfig.minAngularSeparation);
  }
});

test('coverage rejects incomplete turns, a missing side, and a missing back', () => {
  const { evaluateRotationCoverage } = loadVideoLogic();
  assert.equal(evaluateRotationCoverage([frame(0), frame(45), frame(90), frame(135)]).sufficient, false);
  const missingSide = evaluateRotationCoverage([frame(0), frame(45), frame(180), frame(225), frame(270), frame(315)]);
  assert.equal(missingSide.sufficient, false);
  assert.ok(missingSide.missing.includes('right'));
  const missingBack = evaluateRotationCoverage([frame(0), frame(45), frame(90), frame(135), frame(270), frame(315)]);
  assert.equal(missingBack.sufficient, false);
  assert.ok(missingBack.missing.includes('back'));
  assert.equal(evaluateRotationCoverage([frame(0), frame(45), frame(90), frame(135), frame(180), frame(225), frame(270), frame(315)]).sufficient, true);
});
