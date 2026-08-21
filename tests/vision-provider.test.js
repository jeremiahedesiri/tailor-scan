const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function segmentationLogic() {
  const context = { window: {}, Float32Array };
  const source = `${fs.readFileSync('vision-provider.js', 'utf8')}\nglobalThis.__visionTest = { segmentationDetails };`;
  vm.runInNewContext(source, context);
  return context.__visionTest;
}

test('scores person-mask confidence without diluting it with background pixels', () => {
  const { segmentationDetails } = segmentationLogic();
  const width = 10, height = 10;
  const data = new Float32Array(width * height).fill(.02);
  // A central, fully visible 6×8 person silhouette with high confidence.
  for (let y = 1; y < 9; y += 1) for (let x = 2; x < 8; x += 1) data[y * width + x] = .95;
  const details = segmentationDetails({ confidenceMasks: [null, { width, height, getAsFloat32Array: () => data }] }, 1080, 1920);
  assert.ok(details.confidence > .9);
  assert.equal(details.foregroundCoverage, .48);
  assert.ok(details.bodyVisibility > .9);
  assert.equal(details.edgeClipping, false);
});
