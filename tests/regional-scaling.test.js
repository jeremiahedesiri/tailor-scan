const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function loadCalibrationLogic() {
  const element = { hidden: false, value: '', textContent: '', innerHTML: '', classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {} };
  const context = {
    document: { querySelector: () => element, querySelectorAll: () => [] },
    window: { scrollTo() {} }, setTimeout() {}, console
  };
  const source = `${fs.readFileSync('app.js', 'utf8')}\nglobalThis.__tailorTest = { state, applyRegionalMeshScaling, buildKingDraftMeasurementOutput };`;
  vm.runInNewContext(source, context);
  return context.__tailorTest;
}
function successfulMeasurement(confidence = .9) { return { status: 'success: mesh cross-section measured in inches', confidence }; }

test('uses independent tape-derived factors for each valid anatomical region', () => {
  const { state, applyRegionalMeshScaling } = loadCalibrationLogic();
  state.reconstruction.rawCircumferences = { chest: 40, waist: 32, hip: 42, bicep: 14, calf: 16 };
  const records = applyRegionalMeshScaling(
    { chest: 42, waist: 30, hip: 44, bicep: 13.5, calf: 17 },
    { chest: successfulMeasurement(), waist: successfulMeasurement(), hip: successfulMeasurement(), bicep: successfulMeasurement(), calf: successfulMeasurement() }
  );
  assert.equal(records.chest.scaleFactor, 1.05);
  assert.equal(records.waist.scaleFactor, .938);
  assert.equal(records.hip.scaleFactor, 1.048);
  assert.equal(records.bicep.scaleFactor, .964);
  assert.equal(records.calf.scaleFactor, 1.063);
  for (const record of Object.values(records)) {
    assert.equal(record.scalingStatus, 'applied');
    assert.equal(record.scalingError, 0);
    assert.match(record.scaleSource, /tape measurement ÷ raw mesh cross-section/);
  }
});

test('withholds a scale when geometry is weak or the proposed adjustment is implausible', () => {
  const { state, applyRegionalMeshScaling } = loadCalibrationLogic();
  state.reconstruction.rawCircumferences = { chest: 40, waist: 32 };
  const records = applyRegionalMeshScaling(
    { chest: 42, waist: 48 },
    { chest: successfulMeasurement(.4), waist: successfulMeasurement(.95) }
  );
  assert.equal(records.chest.scaleFactor, 1);
  assert.equal(records.chest.finalScaledValue, 40);
  assert.match(records.chest.scalingStatus, /^withheld: geometry confidence/);
  assert.equal(records.waist.scaleFactor, 1);
  assert.equal(records.waist.finalScaledValue, 32);
  assert.match(records.waist.scalingStatus, /^withheld: implausibly large/);
  assert.equal(records.waist.geometryError, -16);
  assert.equal(records.waist.scalingError, -16);
});

test('creates a KingDraft-ready body-measurement payload with separate diagnostics', () => {
  const { state, buildKingDraftMeasurementOutput } = loadCalibrationLogic();
  Object.assign(state.values, { height: 72, chest: 42, waist: 30, hip: 44, bicep: 13.5, calf: 17, shoulderToWaist: 18, sleeve: 25, trouserLength: 42, inseam: 31, outseam: 43 });
  state.reconstruction.rawCircumferences = { chest: 40, waist: 32, hip: 42, bicep: 14, calf: 16 };
  state.calibration.chest = { tapeValue: 42, rawScanValue: 40, scaleFactor: 1.05, scaleSource: 'chest_region tape measurement ÷ raw mesh cross-section', geometryConfidence: .9, scalingStatus: 'applied' };
  const output = buildKingDraftMeasurementOutput();
  assert.equal(output.schema_version, '1.0');
  assert.equal(output.measurement_type, 'body');
  assert.equal(output.unit, 'in');
  assert.deepEqual(Object.keys(output).filter(key => key !== 'diagnostics'), ['schema_version', 'measurement_type', 'unit', 'height', 'chest', 'waist', 'hip', 'bicep', 'calf', 'shoulder_to_waist', 'sleeve_length', 'trouser_length', 'inseam', 'outseam']);
  assert.equal(output.chest, 42);
  assert.equal(output.diagnostics.chest.raw_value, 40);
  assert.equal(output.diagnostics.chest.scale_factor, 1.05);
  assert.equal(output.diagnostics.chest.tape_anchor, 42);
  assert.equal(output.diagnostics.chest.status, 'applied');
  assert.equal(output.diagnostics.shoulder_to_waist.raw_value, null);
});

test('starts scan-result fields without default body measurements', () => {
  const { state, buildKingDraftMeasurementOutput } = loadCalibrationLogic();
  assert.ok(Object.values(state.values).every(value => value === null));
  const output = buildKingDraftMeasurementOutput();
  assert.equal(output.shoulder_to_waist, null);
  assert.equal(output.chest, null);
  assert.equal(output.diagnostics.chest.status, 'not reconstructed');
});
