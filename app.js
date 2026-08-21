const measurements = [
  ['height','Height','core',66], ['shoulder','Shoulder','core',16.5], ['chest','Chest / bust','core',36], ['waist','Waist','core',30], ['hip','Hip','core',39],
  ['neck','Neck circumference','upper',14.5], ['armhole','Armhole','upper',17], ['bicep','Bicep','upper',12], ['elbow','Elbow','upper',10.5], ['wrist','Wrist','upper',6.5], ['shoulderToWaist','Shoulder to waist','upper',18], ['shoulderToHip','Shoulder to hip','upper',22], ['shoulderToElbow','Shoulder to elbow','upper',13], ['shoulderToWrist','Shoulder to wrist','upper',23], ['elbowToWrist','Elbow to wrist','upper',10], ['sleeve','Sleeve length','upper',23],
  ['waistToHip','Waist to hip','lower',8], ['waistToKnee','Waist to knee','lower',23], ['waistToAnkle','Waist to ankle / floor','lower',40], ['trouserLength','Trouser length','lower',40], ['inseam','Inseam','lower',29], ['outseam','Outseam','lower',40], ['thigh','Thigh','lower',22], ['knee','Knee','lower',15], ['calf','Calf','lower',14.5], ['ankle','Ankle','lower',9]
];
// Measurements are stored in the current internal unit (inches). Keeping every
// conversion and display rule here makes a later internal-unit change safe.
const units = Object.freeze({
  internal: 'in',
  display: 'in',
  displayPrecision: 1,
  internalPrecision: 3,
  fromDisplay(value) { return Number(value); },
  toDisplay(value) { const factor = 10 ** this.displayPrecision; return (Math.round(Number(value) * factor) / factor).toFixed(this.displayPrecision); },
  toInternal(value) { return Math.round(Number(value) * 10 ** this.internalPrecision) / 10 ** this.internalPrecision; },
  format(value) { return `${this.toDisplay(value)} ${this.display}`; }
});
const baseValues = Object.fromEntries(measurements.map(([key,, ,value]) => [key, value]));
const calibrationFields = [
  { name: 'height', input: '#calibrationHeight' }, { name: 'chest', input: '#calibrationChest' },
  { name: 'waist', input: '#calibrationWaist' }, { name: 'hip', input: '#calibrationHip' },
  { name: 'bicep', input: '#calibrationBicep' }, { name: 'calf', input: '#calibrationCalf' }
];
const regionalScaleMap = Object.freeze({
  linear: { anchor: 'height', targets: [] },
  chest_region: { anchor: 'chest', targets: ['chest', 'neck', 'armhole'] },
  waist_region: { anchor: 'waist', targets: ['waist'] },
  hip_region: { anchor: 'hip', targets: ['hip', 'thigh', 'knee'] },
  upper_arm_region: { anchor: 'bicep', targets: ['bicep', 'elbow', 'wrist'] },
  lower_leg_region: { anchor: 'calf', targets: ['calf', 'ankle'] }
});
const circumferenceConstraintDefinitions = Object.freeze([
  { region: 'chest_region', measurementName: 'chest', anatomicalLevel: 'upper torso/chest cross-section' },
  { region: 'waist_region', measurementName: 'waist', anatomicalLevel: 'natural waist cross-section' },
  { region: 'hip_region', measurementName: 'hip', anatomicalLevel: 'pelvis/seat/hip cross-section' },
  { region: 'upper_arm_region', measurementName: 'bicep', anatomicalLevel: 'upper-arm axis at bicep level' },
  { region: 'lower_leg_region', measurementName: 'calf', anatomicalLevel: 'lower-leg axis at full-calf level' }
]);
const linearMeasurementDefinitions = [
  { name: 'shoulderToWaist', start: 'shoulderCenter', end: 'waistCenter' },
  { name: 'shoulderToHip', start: 'shoulderCenter', end: 'hipCenter' },
  { name: 'shoulderToElbow', start: 'shoulder', end: 'elbow' },
  { name: 'shoulderToWrist', start: 'shoulder', end: 'wrist' },
  { name: 'elbowToWrist', start: 'elbow', end: 'wrist' },
  { name: 'sleeve', start: 'shoulder', end: 'wrist' },
  { name: 'waistToHip', start: 'waistCenter', end: 'hipCenter' },
  { name: 'waistToKnee', start: 'waistCenter', end: 'knee' },
  { name: 'waistToAnkle', start: 'waistCenter', end: 'floor' },
  { name: 'trouserLength', start: 'waistCenter', end: 'floor' },
  { name: 'outseam', start: 'waistCenter', end: 'floor' },
  { name: 'inseam', start: 'crotch', end: 'ankle' }
];
const rotationStages = [
  { id: 'front', angle: 0, instruction: 'Keep your full body inside the frame. Face the camera to capture the front view.' },
  { id: 'frontRight', angle: 45, instruction: 'Rotate a little to your right. Capture an intermediate view while keeping your full body visible.' },
  { id: 'right', angle: 90, instruction: 'Rotate slowly to your right. Keep your arms slightly away from your torso.' },
  { id: 'backRight', angle: 135, instruction: 'Continue turning through an intermediate back-right view.' },
  { id: 'back', angle: 180, instruction: 'Continue turning until your back faces the camera. Keep your feet near the marked position.' },
  { id: 'backLeft', angle: 225, instruction: 'Continue turning through an intermediate back-left view.' },
  { id: 'left', angle: 270, instruction: 'Continue turning to show the opposite side. Keep the phone still and your full body in frame.' },
  { id: 'frontLeft', angle: 315, instruction: 'Continue through an intermediate front-left view.' },
  { id: 'complete', angle: 360, instruction: 'Complete the turn facing the camera again. Capture the final view to finish coverage.' }
];
const rotationSelectionConfig = Object.freeze({ minQualityScore: .68, minAngularSeparation: 20, maxSelectedFrames: 12, cardinalTolerance: 25, minIntermediateFrames: 2 });
const regionalScalingPolicy = Object.freeze({ minimumGeometryConfidence: .6, maximumRelativeScaleDeviation: .3 });
const kingDraftMeasurementMap = Object.freeze([
  ['height', 'height'], ['chest', 'chest'], ['waist', 'waist'], ['hip', 'hip'], ['bicep', 'bicep'], ['calf', 'calf'],
  ['shoulder_to_waist', 'shoulderToWaist'], ['sleeve_length', 'sleeve'], ['trouser_length', 'trouserLength'], ['inseam', 'inseam'], ['outseam', 'outseam']
]);
const state = { values: {...baseValues}, calibration: {}, circumferenceConstraints: {}, reconstruction: { landmarks: {}, rawBodyHeight: null, rawLinearMeasurements: {}, rawCircumferences: {}, globalPhysicalScale: null, rawGeometry: null, refinedGeometry: null, multiViewSession: null, refinementStatus: 'awaiting editable 3D reconstruction' }, captures: {}, rotationCaptures: {}, rotationCandidates: [], representativeFrames: [], rotationCoverage: null, rotationIndex: 0, skippedCapture: {}, stream: null, activeGroup: 'core' };
const $ = (selector) => document.querySelector(selector);

function rounded(value) { return units.toInternal(value); }
function kingDraftDiagnostic(name) {
  const calibration = state.calibration[name] || {};
  const rawValue = state.reconstruction.rawCircumferences[name] ?? state.reconstruction.rawLinearMeasurements[name] ?? calibration.rawScanValue ?? null;
  return {
    raw_value: Number.isFinite(rawValue) ? rounded(rawValue) : null,
    scale_source: calibration.scaleSource || (rawValue != null ? 'raw reconstructed measurement' : 'manual/initial estimate'),
    scale_factor: Number.isFinite(calibration.scaleFactor) ? calibration.scaleFactor : 1,
    tape_anchor: calibration.tapeValue ?? null,
    confidence: calibration.geometryConfidence ?? null,
    status: calibration.scalingStatus || calibration.confidenceStatus || (rawValue != null ? 'raw measurement available' : 'not reconstructed')
  };
}
function buildKingDraftMeasurementOutput() {
  const output = { schema_version: '1.0', measurement_type: 'body', unit: 'in' };
  const diagnostics = {};
  kingDraftMeasurementMap.forEach(([externalName, internalName]) => {
    output[externalName] = Number.isFinite(state.values[internalName]) ? rounded(state.values[internalName]) : null;
    diagnostics[externalName] = kingDraftDiagnostic(internalName);
  });
  output.diagnostics = diagnostics;
  return output;
}
function landmarkDistance(start, end) {
  if (![start, end].every(point => point && Number.isFinite(point.x) && Number.isFinite(point.y))) return null;
  const dx = end.x - start.x, dy = end.y - start.y, dz = (end.z || 0) - (start.z || 0);
  return Math.sqrt(dx ** 2 + dy ** 2 + dz ** 2);
}
function setReconstructionLandmarks(landmarks) {
  const rawBodyHeight = landmarkDistance(landmarks.headTop, landmarks.floor);
  const rawLinearMeasurements = Object.fromEntries(linearMeasurementDefinitions.map(definition => [
    definition.name, landmarkDistance(landmarks[definition.start], landmarks[definition.end])
  ]));
  state.reconstruction = {...state.reconstruction, landmarks, rawBodyHeight, rawLinearMeasurements };
  return state.reconstruction;
}
function setReconstructionCircumferences(rawCircumferences) {
  const validMeasurements = Object.fromEntries(Object.entries(rawCircumferences).filter(([, value]) => Number.isFinite(value) && value > 0));
  state.reconstruction = {...state.reconstruction, rawCircumferences: validMeasurements };
  return state.reconstruction.rawCircumferences;
}
function setRawReconstructionGeometry(rawGeometry) {
  state.reconstruction = {...state.reconstruction, rawGeometry, refinedGeometry: null, refinementStatus: 'raw geometry available; awaiting regional refinement engine' };
  return state.reconstruction.rawGeometry;
}
function buildCircumferenceConstraints(tapeValues) {
  return Object.fromEntries(circumferenceConstraintDefinitions.map(definition => {
    const tapeValue = tapeValues[definition.measurementName] ?? null;
    const initialReconstructedValue = state.reconstruction.rawCircumferences[definition.measurementName] ?? null;
    const initialError = tapeValue != null && initialReconstructedValue != null ? rounded(initialReconstructedValue - tapeValue) : null;
    return [definition.measurementName, {
      ...definition, tapeValue, initialReconstructedValue, initialError,
      initialPercentageError: initialError != null ? rounded((initialError / tapeValue) * 100) : null,
      appliedRefinement: null, refinedReconstructedValue: null, remainingError: null,
      confidenceStatus: tapeValue == null ? 'no tape constraint supplied' : (initialReconstructedValue == null ? 'awaiting valid reconstructed cross-section' : 'constraint ready for geometry refinement'),
      status: tapeValue == null ? 'inactive' : (initialReconstructedValue == null ? 'blocked: missing raw cross-section' : 'queued for local regional refinement')
    }];
  }));
}
function requestRegionalGeometryRefinement() {
  const activeConstraints = Object.values(state.circumferenceConstraints).filter(constraint => constraint.tapeValue != null);
  if (!state.reconstruction.rawGeometry) {
    activeConstraints.forEach(constraint => { constraint.status = 'awaiting editable 3D mesh'; constraint.confidenceStatus = 'temporary fallback scaling only'; });
    state.reconstruction.refinementStatus = 'awaiting editable 3D reconstruction';
    return { refined: false, reason: state.reconstruction.refinementStatus };
  }
  // This is intentionally an interface boundary. A future mesh refiner must validate
  // anatomical planes, locally deform the copied raw mesh with falloff, then remeasure it.
  activeConstraints.forEach(constraint => { constraint.status = 'awaiting connected mesh refinement engine'; });
  state.reconstruction.refinementStatus = 'raw geometry preserved; no mesh refinement engine connected';
  return { refined: false, reason: state.reconstruction.refinementStatus };
}
function readOptionalTapeValue(field) {
  const input = $(field.input), raw = input.value.trim();
  if (raw === '') return { valid: true, value: null };
  const value = units.fromDisplay(raw);
  if (!input.validity.valid || !Number.isFinite(value) || value <= 0) return { valid: false, name: field.name };
  return { valid: true, value: rounded(value) };
}
function buildCalibrationData(tapeValues) {
  const entries = Object.fromEntries(measurements.map(([name]) => [name, {
    measurementName: name, tapeValue: tapeValues[name] ?? null, rawScanValue: state.reconstruction.rawCircumferences[name] ?? state.reconstruction.rawLinearMeasurements[name] ?? baseValues[name], scaleFactor: 1,
    scaleSource: state.reconstruction.rawCircumferences[name] != null ? 'raw reconstructed circumference awaiting regional scale' : (state.reconstruction.rawLinearMeasurements[name] != null ? 'raw landmark distance awaiting height scale' : 'raw scan estimate'), finalScaledValue: baseValues[name], confidenceStatus: state.reconstruction.rawCircumferences[name] != null ? 'raw reconstructed circumference awaiting tape anchor' : (state.reconstruction.rawLinearMeasurements[name] != null ? 'raw landmark distance awaiting height anchor' : 'unanchored estimate')
  }]));
  Object.entries(regionalScaleMap).forEach(([region, definition]) => {
    if (region === 'linear') return;
    const tapeValue = tapeValues[definition.anchor];
    if (tapeValue == null) return;
    const rawAnchor = state.reconstruction.rawCircumferences[definition.anchor] ?? baseValues[definition.anchor];
    const factor = tapeValue / rawAnchor;
    definition.targets.forEach(target => {
      const entry = entries[target];
      const rawMeasurement = state.reconstruction.rawCircumferences[target] ?? baseValues[target];
      // A direct tape value always takes precedence over a broader regional anchor.
      if (entry.tapeValue != null && target !== definition.anchor) return;
      entry.rawScanValue = rawMeasurement;
      entry.scaleFactor = rounded(factor);
      entry.scaleSource = `temporary post-processing fallback: ${region} scale from ${definition.anchor} tape measurement`;
      entry.finalScaledValue = rounded(rawMeasurement * factor);
      entry.confidenceStatus = target === definition.anchor ? 'tape-confirmed regional constraint; refinement pending' : `temporary fallback scaled from ${region}`;
    });
    const anchorEntry = entries[definition.anchor];
    anchorEntry.tapeValue = tapeValue;
    anchorEntry.rawScanValue = rawAnchor;
    anchorEntry.finalScaledValue = tapeValue;
    anchorEntry.scaleFactor = rounded(factor);
    anchorEntry.scaleSource = `temporary post-processing fallback: ${region} scale from ${definition.anchor} tape measurement`;
    anchorEntry.confidenceStatus = 'tape-confirmed regional constraint; refinement pending';
  });
  const heightEntry = entries.height;
  state.reconstruction.globalPhysicalScale = null;
  if (heightEntry.tapeValue != null && Number.isFinite(state.reconstruction.rawBodyHeight) && state.reconstruction.rawBodyHeight > 0) {
    const heightScale = heightEntry.tapeValue / state.reconstruction.rawBodyHeight;
    state.reconstruction.globalPhysicalScale = rounded(heightScale);
    linearMeasurementDefinitions.forEach(definition => {
      const rawDistance = state.reconstruction.rawLinearMeasurements[definition.name];
      if (rawDistance == null) return;
      const entry = entries[definition.name];
      entry.rawScanValue = rawDistance;
      entry.scaleFactor = rounded(heightScale);
      entry.scaleSource = 'height tape measurement ÷ raw reconstructed body height';
      entry.finalScaledValue = rounded(rawDistance * heightScale);
      entry.confidenceStatus = 'height-scaled landmark measurement';
    });
    heightEntry.rawScanValue = state.reconstruction.rawBodyHeight;
    heightEntry.scaleFactor = rounded(heightScale);
    heightEntry.scaleSource = 'height tape measurement ÷ raw reconstructed body height';
    heightEntry.finalScaledValue = heightEntry.tapeValue;
    heightEntry.confidenceStatus = 'tape-confirmed primary scale anchor';
  } else if (heightEntry.tapeValue != null) {
    state.reconstruction.globalPhysicalScale = null;
    heightEntry.finalScaledValue = heightEntry.tapeValue;
    heightEntry.scaleFactor = rounded(heightEntry.tapeValue / baseValues.height);
    heightEntry.scaleSource = 'height tape measurement; raw reconstructed height unavailable';
    heightEntry.confidenceStatus = 'tape-confirmed anchor; raw reconstructed height unavailable';
  }
  return entries;
}
function buildPendingCalibrationData(tapeValues) {
  return Object.fromEntries(measurements.map(([name,, ,defaultValue]) => [name, {
    measurementName: name, tapeValue: tapeValues[name] ?? null,
    rawScanValue: state.reconstruction.rawCircumferences[name] ?? null,
    scaleFactor: 1, scaleSource: 'awaiting raw 3D mesh measurement',
    finalScaledValue: defaultValue,
    confidenceStatus: tapeValues[name] != null ? 'tape anchor stored; awaiting valid raw mesh cross-section' : 'no tape anchor supplied',
    geometryStatus: 'not yet measured from mesh', geometryConfidence: null,
    geometryError: null, scalingError: null, scalingStatus: 'inactive'
  }]));
}
function applyRegionalMeshScaling(tapeValues, meshMeasurements) {
  const records = {};
  for (const definition of circumferenceConstraintDefinitions) {
    const name = definition.measurementName, measurement = meshMeasurements?.[name];
    const rawValue = state.reconstruction.rawCircumferences[name] ?? null;
    const tapeValue = tapeValues[name] ?? null;
    const geometryConfidence = measurement?.confidence ?? 0;
    const geometryValid = measurement?.status?.startsWith('success') && Number.isFinite(rawValue) && rawValue > 0 && geometryConfidence >= regionalScalingPolicy.minimumGeometryConfidence;
    const proposedScale = tapeValue != null && rawValue != null ? tapeValue / rawValue : 1;
    const excessiveAdjustment = tapeValue != null && Math.abs(proposedScale - 1) > regionalScalingPolicy.maximumRelativeScaleDeviation;
    const canApplyScale = tapeValue != null && geometryValid && !excessiveAdjustment;
    const finalScaledValue = rawValue == null ? null : rounded(rawValue * (canApplyScale ? proposedScale : 1));
    records[name] = {
      measurementName: name, region: definition.region, tapeValue, rawScanValue: rawValue,
      rawGeometryValue: rawValue, scaleFactor: rounded(canApplyScale ? proposedScale : 1),
      proposedScaleFactor: tapeValue != null && rawValue != null ? rounded(proposedScale) : null,
      scaleSource: canApplyScale ? `${definition.region} tape measurement ÷ raw mesh cross-section` : 'raw mesh cross-section (regional scale not applied)',
      finalScaledValue, geometryStatus: measurement?.status || 'missing raw mesh measurement', geometryConfidence,
      geometryError: tapeValue != null && rawValue != null ? rounded(rawValue - tapeValue) : null,
      scalingError: tapeValue != null && finalScaledValue != null ? rounded(finalScaledValue - tapeValue) : null,
      confidenceStatus: !geometryValid ? 'geometry review required; scale withheld' : (tapeValue == null ? 'raw mesh measurement; no tape anchor' : (excessiveAdjustment ? 'review required; proposed regional adjustment is too large' : 'regional tape-derived scale applied')),
      scalingStatus: canApplyScale ? 'applied' : (tapeValue == null ? 'no tape anchor' : (excessiveAdjustment ? 'withheld: implausibly large adjustment' : 'withheld: geometry confidence too low'))
    };
  }
  return records;
}
function applyReferences(announce = false) {
  const tapeValues = {};
  for (const field of calibrationFields) {
    const result = readOptionalTapeValue(field);
    if (!result.valid) { toast(`Enter a positive valid value for ${result.name}.`); return false; }
    tapeValues[field.name] = result.value;
  }
  state.circumferenceConstraints = buildCircumferenceConstraints(tapeValues);
  // Tape anchors are retained through capture. Circumference scaling begins only
  // after a valid anatomically oriented raw mesh perimeter exists.
  state.calibration = buildPendingCalibrationData(tapeValues);
  if (tapeValues.height != null) state.values.height = tapeValues.height;
  if (announce) toast(Object.values(tapeValues).some(value => value != null) ? 'Calibration anchors applied.' : 'No tape values entered — scan estimates retained.');
  return true;
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  $('#restartButton').hidden = id === 'home';
  if (id === 'review') { renderMeasurements(); const anchors = Object.values(state.calibration).filter(entry => entry.tapeValue != null); $('#referenceStatus').textContent = anchors.length ? `Active tape constraints: ${anchors.map(entry => `${entry.measurementName} ${units.format(entry.tapeValue)}`).join(', ')}. ${state.reconstruction.refinementStatus}; displayed circumference scaling is a temporary fallback.` : 'No tape anchors entered — these remain editable scan estimates.'; }
  if (id === 'scan360') renderRotationStage();
  if (id === 'summary') renderSummary();
  stopCamera(); window.scrollTo({top: 0, behavior: 'smooth'});
}
function stopCamera() { if (state.stream) { state.stream.getTracks().forEach(track => track.stop()); state.stream = null; } }
function normalizedAngle(angle) { return ((angle % 360) + 360) % 360; }
function angularDistance(first, second) { const difference = Math.abs(normalizedAngle(first) - normalizedAngle(second)); return Math.min(difference, 360 - difference); }
function frameQualityScore(quality) {
  if (!quality || !['sharpness', 'motionBlur', 'bodyVisibility', 'landmarkReliability', 'segmentationQuality', 'occlusion'].every(key => Number.isFinite(quality[key]))) return null;
  const values = Object.values(quality);
  if (values.some(value => value < 0 || value > 1)) return null;
  if (quality.motionBlur > .35 || quality.bodyVisibility < .85 || quality.landmarkReliability < .6 || quality.segmentationQuality < .6 || quality.occlusion > .35) return null;
  return quality.sharpness * .22 + (1 - quality.motionBlur) * .18 + quality.bodyVisibility * .2 + quality.landmarkReliability * .18 + quality.segmentationQuality * .14 + (1 - quality.occlusion) * .08;
}
function frameOrientation(frame) { return Number.isFinite(frame.analysis?.orientationDeg) ? frame.analysis.orientationDeg : frame.angle; }
function selectRepresentativeFrames(candidates, config = rotationSelectionConfig) {
  const eligible = candidates.map(candidate => ({...candidate, qualityScore: frameQualityScore(candidate.quality)})).filter(candidate => candidate.qualityScore != null && candidate.qualityScore >= config.minQualityScore).sort((a, b) => b.qualityScore - a.qualityScore);
  const selected = [];
  eligible.forEach(candidate => { if (selected.length < config.maxSelectedFrames && !selected.some(frame => angularDistance(frameOrientation(frame), frameOrientation(candidate)) < config.minAngularSeparation)) selected.push(candidate); });
  return selected.sort((a, b) => normalizedAngle(frameOrientation(a)) - normalizedAngle(frameOrientation(b)));
}
function evaluateRotationCoverage(frames, config = rotationSelectionConfig) {
  const requiredAngles = { front: 0, right: 90, back: 180, left: 270 };
  const missing = Object.entries(requiredAngles).filter(([, angle]) => !frames.some(frame => angularDistance(frameOrientation(frame), angle) <= config.cardinalTolerance)).map(([name]) => name);
  const intermediateFrames = frames.filter(frame => Object.values(requiredAngles).every(angle => angularDistance(frameOrientation(frame), angle) > config.cardinalTolerance));
  const sufficient = missing.length === 0 && intermediateFrames.length >= config.minIntermediateFrames;
  return { sufficient, missing, intermediateCount: intermediateFrames.length, selectedCount: frames.length, status: sufficient ? 'sufficient representative-frame coverage' : (frames.length === 0 ? 'quality validation awaiting vision analysis' : `insufficient coverage: missing ${missing.join(', ') || 'intermediate angles'}`) };
}
function refreshRotationFrameSelection() { state.representativeFrames = selectRepresentativeFrames(state.rotationCandidates); state.rotationCoverage = evaluateRotationCoverage(state.representativeFrames); return state.rotationCoverage; }
function addRotationCandidateFrame(candidate) { state.rotationCandidates.push({...candidate, id: candidate.id || `frame-${state.rotationCandidates.length + 1}`, angle: normalizedAngle(candidate.angle)}); return refreshRotationFrameSelection(); }
function setRotationFrameVisionAnalysis(frameId, analysis) {
  const frame = state.rotationCandidates.find(candidate => candidate.id === frameId);
  if (!frame) return false;
  frame.analysis = analysis;
  if (analysis.quality) frame.quality = analysis.quality;
  refreshRotationFrameSelection();
  return true;
}
async function analyzeRotationCandidatesWithVision() {
  if (!window.tailorScanVision?.createProvider) {
    state.reconstruction.multiViewSession = { status: 'blocked: MediaPipe vision provider did not load', mesh: null };
    return state.reconstruction.multiViewSession;
  }
  try {
    const provider = state.reconstruction.visionProvider || await window.tailorScanVision.createProvider();
    state.reconstruction.visionProvider = provider;
    for (const frame of state.rotationCandidates) {
      try {
        setRotationFrameVisionAnalysis(frame.id, await provider.analyzeFrame(frame));
      } catch (error) {
        // A rejected frame is not evidence of a body. Keep it out of the
        // representative set and retain the genuine inference failure.
        setRotationFrameVisionAnalysis(frame.id, { inferenceError: error.message });
      }
    }
    return prepareMultiViewReconstruction();
  } catch (error) {
    state.reconstruction.multiViewSession = { status: `blocked: vision analysis failed (${error.message})`, mesh: null };
    return state.reconstruction.multiViewSession;
  }
}
function buildMultiViewPoseRepresentation(frames) {
  const poseFrames = frames.filter(frame => frame.analysis?.worldLandmarks).map(frame => ({ frameId: frame.id, orientationDeg: frame.analysis.orientationDeg, joints: frame.analysis.worldLandmarks }));
  return poseFrames.length ? { type: 'multi-view pose skeleton', frames: poseFrames } : null;
}
function buildReconstructionInput(frames) {
  return {
    frames: frames.map(frame => ({
      id: frame.id, image: frame.image, orientationDeg: frame.analysis.orientationDeg,
      segmentationMaskRef: frame.analysis.segmentationMaskRef, segmentation: frame.analysis.segmentation,
      landmarks: frame.analysis.landmarks, worldLandmarks: frame.analysis.worldLandmarks,
      correspondences: frame.analysis.correspondenceKeypoints || null, quality: frame.quality
    })),
    calibration: state.calibration,
    source: { cameraModel: 'approximately stationary camera; subject rotation at guided checkpoints' }
  };
}
function frameStabilityIssues(frame) {
  const stability = frame.analysis?.stability;
  if (!stability) return ['missing body-stability analysis'];
  const limits = { armsMotion: .3, shoulderHipRotationDelta: 15, clothingMotion: .3, postureChange: .3, feetReposition: .2 };
  return Object.entries(limits).filter(([key, limit]) => !Number.isFinite(stability[key]) || stability[key] > limit).map(([key]) => key);
}
async function prepareMultiViewReconstruction() {
  const coverage = state.rotationCoverage || refreshRotationFrameSelection();
  if (!coverage.sufficient) {
    state.reconstruction.multiViewSession = { status: 'blocked: insufficient representative-frame coverage', coverage, bodyRepresentation: null, mesh: null };
    return state.reconstruction.multiViewSession;
  }
  const invalidFrames = state.representativeFrames.filter(frame => !frame.analysis?.segmentationMaskRef || !frame.analysis?.landmarks || !Number.isFinite(frame.analysis?.orientationDeg));
  if (invalidFrames.length) {
    state.reconstruction.multiViewSession = { status: 'blocked: selected frames need segmentation, pose, orientation, and stability validation', coverage, invalidFrameIds: invalidFrames.map(frame => frame.id), bodyRepresentation: buildMultiViewPoseRepresentation(state.representativeFrames), mesh: null };
    return state.reconstruction.multiViewSession;
  }
  if (!window.tailorScanReconstruction?.createProvider) {
    state.reconstruction.multiViewSession = { status: 'blocked: dense reconstruction provider did not load', coverage, mesh: null };
    return state.reconstruction.multiViewSession;
  }
  try {
    await new Promise(resolve => requestAnimationFrame(resolve));
    const provider = state.reconstruction.denseProvider || window.tailorScanReconstruction.createProvider();
    state.reconstruction.denseProvider = provider;
    const result = await provider.reconstruct(buildReconstructionInput(state.representativeFrames));
    // Copy the raw arrays so a later tape-constrained deformation cannot
    // mutate the baseline mesh by reference.
    const rawGeometry = { vertices: [...result.vertices], faces: [...result.faces], coordinateUnit: result.mesh.coordinateUnit, topology: result.mesh.topology, nearWatertight: result.mesh.nearWatertight, joints: result.joints, pose: result.pose, shape: result.shape, scale: result.scale, confidence: result.confidence, sourceFrameIds: result.diagnostics.sourceFrameIds };
    setRawReconstructionGeometry(rawGeometry);
    let circumferenceMeasurement = null, regionalRefinement = null;
    if (window.tailorScanCircumference?.createProvider) {
      try {
        const measurementProvider = state.reconstruction.circumferenceProvider || window.tailorScanCircumference.createProvider();
        state.reconstruction.circumferenceProvider = measurementProvider;
        circumferenceMeasurement = measurementProvider.measure({ mesh: result.mesh, joints: result.joints, reconstructionConfidence: result.confidence });
        const rawCircumferences = Object.fromEntries(Object.entries(circumferenceMeasurement.measurements)
          .filter(([, measurement]) => measurement.status.startsWith('success') && Number.isFinite(measurement.valueInches))
          .map(([name, measurement]) => [name, rounded(measurement.valueInches)]));
        setReconstructionCircumferences(rawCircumferences);
        rawGeometry.rawCircumferences = {...rawCircumferences};
        const tapeValues = Object.fromEntries(calibrationFields.map(field => [field.name, state.calibration[field.name]?.tapeValue ?? null]));
        state.circumferenceConstraints = buildCircumferenceConstraints(tapeValues);
        const regionalCalibration = applyRegionalMeshScaling(tapeValues, circumferenceMeasurement.measurements);
        state.calibration = {...state.calibration, ...regionalCalibration};
        Object.entries(regionalCalibration).forEach(([name, record]) => {
          // Keep the raw result visible unless actual mesh refinement succeeds.
          if (record.rawGeometryValue != null) state.values[name] = record.rawGeometryValue;
          const constraint = state.circumferenceConstraints[name];
          if (constraint) Object.assign(constraint, {
            scaleFactor: record.scaleFactor, proposedScaleFactor: record.proposedScaleFactor,
            scaleSource: record.scaleSource, finalScaledValue: record.finalScaledValue,
            geometryStatus: record.geometryStatus, geometryConfidence: record.geometryConfidence,
            geometryError: record.geometryError, scalingError: record.scalingError,
            scalingStatus: record.scalingStatus
          });
        });
        if (window.tailorScanRefinement?.createProvider) {
          regionalRefinement = window.tailorScanRefinement.createProvider().refine({ rawMesh: result.mesh, joints: result.joints, constraints: state.circumferenceConstraints, reconstructionConfidence: result.confidence });
          if (regionalRefinement.mesh) {
            state.reconstruction.refinedGeometry = { vertices: [...regionalRefinement.mesh.vertices], faces: [...regionalRefinement.mesh.faces], coordinateUnit: regionalRefinement.mesh.coordinateUnit, joints: result.joints, source: 'bounded local tape-constrained refinement', iterations: regionalRefinement.iterations, constraints: regionalRefinement.constraints };
            Object.entries(regionalRefinement.measurements.measurements).forEach(([name, measurement]) => {
              if (!measurement.status.startsWith('success') || !Number.isFinite(measurement.valueInches)) return;
              state.values[name] = rounded(measurement.valueInches);
              const record = state.calibration[name];
              if (record) Object.assign(record, { finalScaledValue: rounded(measurement.valueInches), scaleFactor: rounded(measurement.valueInches / record.rawGeometryValue), scaleSource: 'remeasured from locally tape-constrained refined mesh', scalingError: record.tapeValue != null ? rounded(measurement.valueInches - record.tapeValue) : null, scalingStatus: regionalRefinement.constraints[name]?.status || 'refined' });
              const constraint = state.circumferenceConstraints[name];
              if (constraint) Object.assign(constraint, { refinedReconstructedValue: rounded(measurement.valueInches), remainingError: constraint.tapeValue != null ? rounded(measurement.valueInches - constraint.tapeValue) : null, appliedRefinement: regionalRefinement.constraints[name]?.appliedRefinement || null, status: regionalRefinement.constraints[name]?.status || constraint.status });
            });
            state.reconstruction.refinementStatus = 'raw mesh preserved; final circumference values remeasured from locally refined mesh';
          } else state.reconstruction.refinementStatus = regionalRefinement.status;
        } else state.reconstruction = {...state.reconstruction, rawGeometry, refinementStatus: 'raw mesh circumferences preserved; mesh-refinement provider did not load'};
      } catch (error) {
        circumferenceMeasurement = { status: `failed: anatomical circumference extraction (${error.message})`, measurements: {} };
      }
    }
    state.reconstruction.multiViewSession = {
      status: result.status, coverage, frames: buildReconstructionInput(state.representativeFrames).frames,
      rawGeometry, bodyRepresentation: buildMultiViewPoseRepresentation(state.representativeFrames), mesh: result.mesh,
      confidence: result.confidence, diagnostics: result.diagnostics, circumferenceMeasurement, regionalRefinement,
      stabilityWarnings: state.representativeFrames.filter(frame => frameStabilityIssues(frame).length).map(frame => ({ frameId: frame.id, issues: frameStabilityIssues(frame) }))
    };
    state.reconstruction.kingDraftMeasurementOutput = buildKingDraftMeasurementOutput();
  } catch (error) {
    state.reconstruction.multiViewSession = { status: `failed: dense reconstruction (${error.message})`, coverage, bodyRepresentation: buildMultiViewPoseRepresentation(state.representativeFrames), mesh: null };
  }
  return state.reconstruction.multiViewSession;
}
function hasSufficientRotationCoverage() { return rotationStages.every(stage => Boolean(state.rotationCaptures[stage.id])); }
function rotationProgress() { return Math.round((Object.keys(state.rotationCaptures).length / rotationStages.length) * 100); }
function renderRotationStage() {
  const stage = rotationStages[state.rotationIndex] || rotationStages[rotationStages.length - 1];
  $('#rotationInstruction').textContent = stage.instruction;
  const qualityStatus = state.rotationCoverage?.status || 'quality validation awaiting vision analysis';
  const reconstructionStatus = state.reconstruction.multiViewSession?.status;
  $('#rotationStatus').textContent = hasSufficientRotationCoverage() ? `All guided viewpoints captured. Representative-frame assessment: ${qualityStatus}. ${reconstructionStatus || ''}`.trim() : `${rotationProgress()}% guided coverage captured. Next: ${stage.angle}° ${stage.id === 'complete' ? 'turn completion' : stage.id} view.`;
  document.querySelectorAll('[data-rotation-stage]').forEach(point => point.classList.toggle('captured', Boolean(state.rotationCaptures[point.dataset.rotationStage])));
  $('#rotationRetake').hidden = state.rotationIndex === 0;
  $('#rotationCapture').textContent = hasSufficientRotationCoverage() ? 'Continue to measurements' : state.stream ? `Capture ${stage.angle}° view` : 'Open rear camera';
}
async function openRotationCamera() {
  const video = $('#scan360Video'), message = $('#scan360Message'), preview = $('#scan360Preview');
  try {
    stopCamera();
    state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    video.srcObject = state.stream; preview.hidden = true; message.hidden = true;
    renderRotationStage();
  } catch (error) {
    message.textContent = 'Camera access is unavailable. Guided 360° capture cannot be verified.';
    toast('Camera unavailable — use manual measurements.');
  }
}
function captureRotationView() {
  const stage = rotationStages[state.rotationIndex], video = $('#scan360Video'), preview = $('#scan360Preview'), canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 640; canvas.height = video.videoHeight || 960;
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  state.rotationCaptures[stage.id] = { angle: stage.angle, capturedAt: new Date().toISOString(), image: canvas.toDataURL('image/jpeg', .82) };
  addRotationCandidateFrame({...state.rotationCaptures[stage.id], stageId: stage.id, quality: null, source: 'guided checkpoint'});
  prepareMultiViewReconstruction();
  if (hasSufficientRotationCoverage()) analyzeRotationCandidatesWithVision().then(() => renderRotationStage());
  preview.src = state.rotationCaptures[stage.id].image; preview.hidden = false;
  stopCamera();
  if (state.rotationIndex < rotationStages.length - 1) state.rotationIndex += 1;
  renderRotationStage();
}
function handleRotationCapture() {
  if (hasSufficientRotationCoverage()) { showScreen('review'); return; }
  if (state.stream) { captureRotationView(); return; }
  openRotationCamera();
}
function resetRotationCapture() {
  state.rotationCaptures = {}; state.rotationCandidates = []; state.representativeFrames = [];
  // A new capture must never inherit a previous person's raw or refined mesh.
  state.reconstruction = {...state.reconstruction, rawGeometry: null, refinedGeometry: null, multiViewSession: null, refinementStatus: 'awaiting editable 3D reconstruction'};
  state.rotationCoverage = refreshRotationFrameSelection(); state.rotationIndex = 0; renderRotationStage();
}
function retakePreviousRotationView() {
  if (state.rotationIndex === 0) return;
  state.rotationIndex -= 1;
  const stageId = rotationStages[state.rotationIndex].id;
  delete state.rotationCaptures[stageId];
  state.rotationCandidates = state.rotationCandidates.filter(candidate => candidate.stageId !== stageId);
  refreshRotationFrameSelection();
  $('#scan360Preview').hidden = true;
  renderRotationStage();
}
async function openCamera(view) {
  const video = $(`#${view}Video`), message = $(`#${view}Message`), preview = $(`#${view}Preview`);
  try {
    stopCamera();
    // Rear cameras generally offer a wider, higher-quality full-body capture.
    // `ideal` keeps the flow usable on desktop browsers and single-camera devices.
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    });
    video.srcObject = state.stream; preview.hidden = true; message.hidden = true;
    $(`#${view}Capture`).textContent = 'Capture photo';
  } catch (error) {
    state.skippedCapture[view] = true;
    message.textContent = 'Camera access is unavailable. You can continue and enter measurements manually.';
    toast('Camera unavailable — manual review is ready.');
    $(`#${view}Capture`).textContent = view === 'front' ? 'Continue to side view' : 'Continue to measurements';
  }
}
function capture(view) {
  const video = $(`#${view}Video`), preview = $(`#${view}Preview`), canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 640; canvas.height = video.videoHeight || 960;
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  state.captures[view] = canvas.toDataURL('image/jpeg', .82); preview.src = state.captures[view]; preview.hidden = false;
  stopCamera(); $(`#${view}Capture`).textContent = view === 'front' ? 'Continue to side view' : 'Continue to measurements';
  if (view === 'front') $('#frontRetake').hidden = false;
}
function handleCapture(view) { state.stream ? capture(view) : ((state.captures[view] || state.skippedCapture[view]) ? showScreen(view === 'front' ? 'side' : 'review') : openCamera(view)); }
function renderMeasurements() {
  const list = $('#measurementForm'); list.innerHTML = measurements.filter(([, ,group]) => group === state.activeGroup).map(([key, label]) => `<div class="measure-row"><label for="${key}">${label}</label><div class="measure-input"><input id="${key}" type="number" min="0" max="120" step="0.1" value="${units.toDisplay(state.values[key])}" inputmode="decimal" aria-label="${label} in inches"><span>${units.display}</span></div></div>`).join('');
  list.querySelectorAll('input').forEach(input => input.addEventListener('input', () => { if (input.value !== '') state.values[input.id] = units.toInternal(units.fromDisplay(input.value)); }));
}
function renderSummary() { $('#summaryList').innerHTML = measurements.map(([key, label]) => `<div class="summary-row"><span>${label}</span><strong>${units.format(state.values[key])}</strong></div>`).join(''); }
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2600); }

document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => { if (button.dataset.go === 'scan360') { if (!applyReferences()) return; resetRotationCapture(); } if (button.dataset.go === 'front' && !applyReferences()) return; showScreen(button.dataset.go); }));
$('#applyReferences').addEventListener('click', () => applyReferences(true));
$('#restartButton').addEventListener('click', () => showScreen('home'));
$('#frontCapture').addEventListener('click', () => handleCapture('front'));
$('#sideCapture').addEventListener('click', () => handleCapture('side'));
$('#frontRetake').addEventListener('click', () => { state.captures.front = null; state.skippedCapture.front = false; openCamera('front'); });
$('#rotationCapture').addEventListener('click', handleRotationCapture);
$('#rotationRetake').addEventListener('click', retakePreviousRotationView);
document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => { state.activeGroup = tab.dataset.group; document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab)); renderMeasurements(); }));
$('#summaryButton').addEventListener('click', () => showScreen('summary'));
$('#saveButton').addEventListener('click', () => { const profiles = JSON.parse(localStorage.getItem('tailorScanProfiles') || '[]'); const name = $('#profileName').value.trim() || 'Unnamed client'; profiles.unshift({id: Date.now(), name, values: state.values, calibration: state.calibration, circumferenceConstraints: state.circumferenceConstraints, reconstruction: {globalPhysicalScale: state.reconstruction.globalPhysicalScale, refinementStatus: state.reconstruction.refinementStatus}, kingDraftMeasurementOutput: buildKingDraftMeasurementOutput(), savedAt: new Date().toISOString()}); localStorage.setItem('tailorScanProfiles', JSON.stringify(profiles)); toast(`${name}'s profile saved on this device.`); });
window.tailorScan = Object.freeze({ buildKingDraftMeasurementOutput });
