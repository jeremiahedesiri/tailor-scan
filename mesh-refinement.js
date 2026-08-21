// Tape-constrained local mesh refinement. The raw mesh is never mutated: this
// provider copies it, makes bounded smooth regional deformations, then measures
// the new geometry again through the anatomical plane-intersection provider.
(function exposeMeshRefinementProvider() {
  const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
  const subtract = (a, b) => a.map((value, index) => value - b[index]);
  const add = (a, b) => a.map((value, index) => value + b[index]);
  const multiply = (a, factor) => a.map(value => value * factor);
  const magnitude = vector => Math.sqrt(dot(vector, vector));
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
  const POLICY = Object.freeze({ maxIterations: 4, convergenceToleranceInches: .1, maxTotalScaleDeviation: .3, maxStepScaleDeviation: .12 });

  function meshHeight(mesh) {
    const values = mesh.vertices.filter((_, index) => index % 3 === 1);
    return Math.max(...values) - Math.min(...values);
  }
  function regionFalloffWidth(region, height) {
    if (region === 'chest_region') return height * .12;
    if (region === 'waist_region') return height * .1;
    if (region === 'hip_region') return height * .13;
    return height * .07;
  }
  function deformRegion(mesh, plane, targetScale) {
    const height = meshHeight(mesh), width = regionFalloffWidth(plane.region, height);
    const stepScale = clamp(targetScale, 1 - POLICY.maxStepScaleDeviation, 1 + POLICY.maxStepScaleDeviation);
    for (let index = 0; index < mesh.vertices.length; index += 3) {
      const vertex = [mesh.vertices[index], mesh.vertices[index + 1], mesh.vertices[index + 2]];
      const relative = subtract(vertex, plane.point), alongAxis = dot(relative, plane.normal);
      const radial = subtract(relative, multiply(plane.normal, alongAxis));
      const radialLength = magnitude(radial);
      if (radialLength < 1e-8) continue;
      const falloff = Math.exp(-((alongAxis / Math.max(width, 1e-6)) ** 2));
      const localScale = 1 + (stepScale - 1) * falloff;
      const refined = add(plane.point, add(multiply(plane.normal, alongAxis), multiply(radial, localScale)));
      mesh.vertices[index] = refined[0]; mesh.vertices[index + 1] = refined[1]; mesh.vertices[index + 2] = refined[2];
    }
    return { stepScale, width };
  }
  function activeConstraints(constraints) {
    return Object.entries(constraints || {}).filter(([, constraint]) => {
      const tape = constraint.tapeValue, raw = constraint.initialReconstructedValue ?? constraint.rawGeometryValue;
      return Number.isFinite(tape) && tape > 0 && Number.isFinite(raw) && raw > 0 && constraint.geometryStatus?.startsWith('success') && (constraint.geometryConfidence ?? 0) >= .6;
    });
  }
  function constraintStatus(name, constraint, measurements) {
    const measurement = measurements.measurements?.[name];
    const value = measurement?.valueInches;
    if (!measurement?.status?.startsWith('success') || !Number.isFinite(value)) return { status: 'failed: refined closed cross-section unavailable', confidence: measurement?.confidence ?? 0 };
    return { status: 'measured', refinedValue: value, remainingError: value - constraint.tapeValue, confidence: measurement.confidence };
  }

  class LocalMeshRefinementProvider {
    refine({ rawMesh, joints, constraints, reconstructionConfidence }) {
      if (!rawMesh?.vertices?.length || !rawMesh?.faces?.length || rawMesh.coordinateUnit !== 'in') throw new Error('A raw, inch-scaled mesh is required for tape-constrained refinement.');
      if (!window.tailorScanCircumference?.createProvider) throw new Error('Anatomical circumference provider is unavailable.');
      const measurementProvider = window.tailorScanCircumference.createProvider();
      const refinedMesh = { ...rawMesh, vertices: [...rawMesh.vertices], faces: [...rawMesh.faces] };
      const active = activeConstraints(constraints);
      const results = Object.fromEntries(Object.entries(constraints || {}).map(([name, constraint]) => [name, { tapeValue: constraint.tapeValue ?? null, initialReconstructedValue: constraint.initialReconstructedValue ?? constraint.rawGeometryValue ?? null, status: constraint.tapeValue == null ? 'inactive: no tape anchor' : 'withheld: raw geometry is not valid enough for refinement' }]));
      if (!active.length) return { status: 'no eligible tape constraints for refinement', mesh: null, constraints: results, iterations: 0 };
      let iterations = 0;
      for (let iteration = 0; iteration < POLICY.maxIterations; iteration += 1) {
        iterations = iteration + 1;
        const measurements = measurementProvider.measure({ mesh: refinedMesh, joints, reconstructionConfidence });
        let changed = false;
        for (const [name, constraint] of active) {
          const measurement = measurements.measurements[name], current = measurement?.valueInches;
          if (!measurement?.status?.startsWith('success') || !Number.isFinite(current) || !measurement.plane) { results[name] = { ...results[name], status: 'failed: refinement plane/cross-section invalid' }; continue; }
          const totalScale = constraint.tapeValue / current;
          if (Math.abs(totalScale - 1) > POLICY.maxTotalScaleDeviation) { results[name] = { ...results[name], status: 'withheld: required local deformation is implausibly large', currentValue: current, proposedScaleFactor: totalScale }; continue; }
          if (Math.abs(current - constraint.tapeValue) <= POLICY.convergenceToleranceInches) { results[name] = { ...results[name], status: 'converged', currentValue: current, appliedRefinement: false }; continue; }
          const deformation = deformRegion(refinedMesh, measurement.plane, totalScale);
          results[name] = { ...results[name], status: 'refined', currentValue: current, proposedScaleFactor: totalScale, appliedRefinement: { region: measurement.plane.region, stepScale: deformation.stepScale, falloffWidth: deformation.width } };
          changed = true;
        }
        if (!changed) break;
      }
      const finalMeasurements = measurementProvider.measure({ mesh: refinedMesh, joints, reconstructionConfidence });
      active.forEach(([name, constraint]) => {
        if (results[name]?.status?.startsWith('withheld')) return;
        results[name] = { ...results[name], ...constraintStatus(name, constraint, finalMeasurements) };
      });
      return { status: 'success: bounded local tape-constrained mesh refinement', mesh: refinedMesh, constraints: results, measurements: finalMeasurements, iterations, policy: POLICY };
    }
  }
  window.tailorScanRefinement = { createProvider: () => new LocalMeshRefinementProvider(), policy: POLICY };
}());
