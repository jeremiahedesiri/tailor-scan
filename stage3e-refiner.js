(function exposeStage3E(root) {
  const clamp = value => Math.max(0, Math.min(1, value));
  const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const category = value => value === null ? 'unresolved' : value >= .75 ? 'high' : value >= .5 ? 'moderate' : 'low';
  const rawConfidence = (rawPose, name) => clamp(rawPose.landmarks[name]?.visibility ?? rawPose.landmarks[name]?.presence ?? 0);

  function clusterCandidateRegions(analysis) {
    const contour = analysis?.ordered_contour || [], shoulderSpan = analysis?.shoulder_span || 1;
    const usable = (analysis?.candidate_ranking || [])
      .filter(candidate => !(candidate.rejection_reasons || []).length)
      .sort((a, b) => a.index - b.index);
    if (!usable.length || !contour.length) return [];
    const totalArc = contour.at(-1)?.arc_length || shoulderSpan;
    const maximumGap = Math.max(totalArc * .075, shoulderSpan * .06);
    const regions = [];
    for (const candidate of usable) {
      const previous = regions.at(-1), arc = contour[candidate.index]?.arc_length ?? 0;
      if (!previous || arc - previous.end_arc > maximumGap) {
        regions.push({ candidates: [candidate], start_arc: arc, end_arc: arc });
      } else {
        previous.candidates.push(candidate); previous.end_arc = arc;
      }
    }
    return regions.map((region, index) => {
      const ranked = [...region.candidates].sort((a, b) => b.score - a.score), scores = ranked.map(candidate => candidate.score);
      const representative = ranked[0], topCount = Math.max(1, Math.ceil(scores.length * .4));
      return {
        region_index: index,
        start_index: region.candidates[0].index,
        end_index: region.candidates.at(-1).index,
        start_arc: region.start_arc,
        end_arc: region.end_arc,
        normalized_arc_span: (region.end_arc - region.start_arc) / Math.max(totalArc, 1),
        point_count: region.candidates.length,
        score: mean(scores.sort((a, b) => b - a).slice(0, topCount)),
        representative,
        candidates: region.candidates
      };
    }).sort((a, b) => b.score - a.score);
  }

  function resolveAcromion({ analysis, rawPose, side, neckTransition, componentDominance = 1 }) {
    const contour = analysis?.ordered_contour || [], regions = clusterCandidateRegions(analysis), rawShoulder = analysis?.raw_shoulder;
    if (!rawShoulder || !contour.length || !regions.length) return { point: null, acceptanceState: 'unresolved', analysis: { ...analysis, candidate_points: analysis?.candidate_ranking || [], candidate_regions: regions, transition_zone: null, selected_acromion: null, landmark_acceptance_state: 'unresolved', measurement_ready: false, confidence: { numeric: 0, category: 'unresolved' }, warnings: ['ACROMION_TRANSITION_REGION_UNRESOLVED'] } };
    const onset = analysis.upper_arm_onset, onsetIndex = onset ? contour.reduce((best, point, index) => Math.hypot(point.x - onset.x, point.y - onset.y) < best.distance ? { index, distance: Math.hypot(point.x - onset.x, point.y - onset.y) } : best, { index: 0, distance: Infinity }).index : null;
    const enriched = regions.map(region => {
      const centerIndex = Math.round((region.start_index + region.end_index) / 2), distanceToOnset = onsetIndex === null ? null : Math.min(...region.candidates.map(candidate => Math.abs((contour[candidate.index]?.arc_length || 0) - (contour[onsetIndex]?.arc_length || 0))));
      const onsetAgreement = distanceToOnset === null ? .35 : clamp(1 - distanceToOnset / Math.max(analysis.shoulder_span * .28, 1));
      const components = region.representative.score_components || {}, anatomicalConsistency = mean([
        components.ridge_laterality ?? 0, components.upper_arm_alignment ?? 0,
        components.lateral_peak ?? 0, components.vertical_plausibility ?? 0,
        components.upper_arm_projection ?? 0, components.distance_plausibility ?? 0
      ]);
      const transitionStrength = mean([components.tangent_transition ?? 0, components.persistence ?? 0, onsetAgreement]);
      return { ...region, center_index: centerIndex, distance_to_upper_arm_onset_along_contour: distanceToOnset, upper_arm_onset_agreement: onsetAgreement, anatomical_consistency: anatomicalConsistency, transition_strength: transitionStrength, acceptance_score: clamp(.38 * region.score + .34 * anatomicalConsistency + .28 * transitionStrength) };
    }).sort((a, b) => b.acceptance_score - a.acceptance_score);
    const best = enriched[0], second = enriched[1], regionMargin = second ? clamp((best.acceptance_score - second.acceptance_score) / Math.max(best.acceptance_score, 1e-6)) : 1;
    const zoneCandidates = best.candidates.filter(candidate => candidate.score >= best.representative.score * .78);
    const transitionZone = { start_index: Math.min(...zoneCandidates.map(candidate => candidate.index)), end_index: Math.max(...zoneCandidates.map(candidate => candidate.index)) };
    transitionZone.center_index = Math.round((transitionZone.start_index + transitionZone.end_index) / 2);
    transitionZone.start = contour[transitionZone.start_index]; transitionZone.end = contour[transitionZone.end_index]; transitionZone.center = contour[transitionZone.center_index];
    const selected = [...zoneCandidates].sort((a, b) => {
      const aOnset = onsetIndex === null ? 0 : Math.abs(a.index - onsetIndex), bOnset = onsetIndex === null ? 0 : Math.abs(b.index - onsetIndex);
      return (b.score + best.upper_arm_onset_agreement * .18 - bOnset / contour.length * .12) - (a.score + best.upper_arm_onset_agreement * .18 - aOnset / contour.length * .12);
    })[0];
    const soft = selected.score_components || {}, pose = rawConfidence(rawPose, `${side}_shoulder`), continuity = clamp((analysis.ordered_contour.length || 0) / 12), neckSupport = neckTransition ? clamp(neckTransition.confidence ?? .5) : .3;
    // Bounded weighted evidence prevents one merely moderate soft cue from collapsing confidence.
    const confidence = clamp(.2 * best.transition_strength + .17 * best.upper_arm_onset_agreement + .13 * (soft.lateral_peak ?? 0) + .11 * regionMargin + .11 * pose + .08 * continuity + .07 * (soft.vertical_plausibility ?? 0) + .05 * (soft.distance_plausibility ?? 0) + .05 * componentDominance + .03 * neckSupport);
    const hardRejections = selected.rejection_reasons || [], sufficient = best.acceptance_score >= .43 && best.transition_strength >= .25 && !hardRejections.length;
    const acceptanceState = !sufficient ? 'unresolved' : confidence >= .56 && best.acceptance_score >= .54 ? 'accepted' : 'low_confidence_accepted';
    const point = acceptanceState === 'unresolved' ? null : { x: selected.x, y: selected.y, confidence };
    const measurementReady = acceptanceState === 'accepted' && confidence >= .72;
    return { point, acceptanceState, analysis: { ...analysis, candidate_points: analysis.candidate_ranking || [], candidate_regions: enriched, candidate_region_count: enriched.length, best_region_score: best.acceptance_score, second_region_score: second?.acceptance_score ?? null, region_margin: regionMargin, transition_zone: transitionZone, upper_arm_onset: onset || null, selected_acromion: point, landmark_acceptance_state: acceptanceState, measurement_ready: measurementReady, confidence: { numeric: point?.confidence ?? 0, category: category(point?.confidence ?? null) }, confidence_formula: '0.20 transition + 0.17 onset + 0.13 outward + 0.11 region margin + 0.11 pose + 0.08 continuity + 0.07 vertical + 0.05 displacement + 0.05 segmentation + 0.03 neck support', warnings: acceptanceState === 'unresolved' ? ['ACROMION_UNRESOLVED'] : acceptanceState === 'low_confidence_accepted' ? ['ACROMION_LOW_CONFIDENCE_ACCEPTED'] : [] } };
  }

  function resolveNeck({ stage3d, rawPose, bodyAxis, componentDominance = 1, acromions = {} }) {
    const prior = stage3d.neckAnalysis || {}, samples = prior.width_profile || [], candidates = [...(prior.candidate_ranking || [])].sort((a, b) => a.index - b.index);
    if (!samples.length || !candidates.length) return { left: null, right: null, base: null, analysis: { ...prior, left_transition_zone: null, right_transition_zone: null, landmark_acceptance_state: 'unresolved', measurement_ready: false, confidence: { numeric: 0, category: 'unresolved' }, warnings: ['NECK_TRANSITION_UNRESOLVED'] } };
    const bestScore = Math.max(...candidates.map(candidate => candidate.score)), threshold = Math.max(.28, bestScore * .68), eligible = candidates.filter(candidate => candidate.score >= threshold);
    const groups = [];
    for (const candidate of eligible) {
      const group = groups.at(-1);
      if (!group || candidate.index - group.at(-1).index > Math.max(2, prior.derivative_window || 2)) groups.push([candidate]); else group.push(candidate);
    }
    groups.sort((a, b) => mean(b.map(candidate => candidate.score)) - mean(a.map(candidate => candidate.score)));
    const group = groups[0];
    if (!group?.length) return { left: null, right: null, base: null, analysis: { ...prior, landmark_acceptance_state: 'unresolved', measurement_ready: false, confidence: { numeric: 0, category: 'unresolved' }, warnings: ['NECK_TRANSITION_ZONE_UNRESOLVED'] } };
    const startIndex = Math.min(...group.map(candidate => candidate.index)), endIndex = Math.max(...group.map(candidate => candidate.index)), representative = [...group].sort((a, b) => b.score - a.score)[0], sample = samples[representative.index];
    const centerX = root.tailorScanTorsoProfile.axisX(bodyAxis, sample.body_y), width = sample.width_px, left = { x: sample.left_boundary.x, y: sample.body_y }, right = { x: sample.right_boundary.x, y: sample.body_y };
    const shoulderSpan = Math.hypot((rawPose.landmarks.left_shoulder.x - rawPose.landmarks.right_shoulder.x) * rawPose.image_width, (rawPose.landmarks.left_shoulder.y - rawPose.landmarks.right_shoulder.y) * rawPose.image_height);
    const ratio = width / Math.max(shoulderSpan, 1), widthPlausibility = ratio > .12 && ratio < .72 ? 1 : clamp(1 - Math.abs(ratio - .42));
    const bilateral = clamp(1 - Math.abs((centerX - left.x) - (right.x - centerX)) / Math.max(width, 1)), expansion = clamp((representative.expansion_strength || 0) * 5), persistence = clamp(representative.transition_persistence || 0), continuity = clamp(prior.contour_continuity ?? mean(samples.slice(startIndex, endIndex + 1).map(item => item.bilateral_confidence || 0))), pose = Math.min(rawConfidence(rawPose, 'left_shoulder'), rawConfidence(rawPose, 'right_shoulder'));
    const medialLeft = !acromions.left || left.x > acromions.left.x, medialRight = !acromions.right || right.x < acromions.right.x, levelAgreement = 1;
    // Weighted confidence retains explicit penalties without multiplying moderate evidence toward zero.
    let confidence = clamp(.24 * expansion + .16 * persistence + .14 * bilateral + .12 * continuity + .11 * pose + .09 * componentDominance + .08 * widthPlausibility + .06 * levelAgreement);
    if (!medialLeft || !medialRight) confidence *= .35;
    const defensible = widthPlausibility >= .45 && bilateral >= .35 && medialLeft && medialRight && (expansion >= .2 || persistence >= .5);
    const acceptanceState = !defensible || confidence < .3 ? 'unresolved' : confidence >= .58 ? 'accepted' : 'low_confidence_accepted';
    const pointConfidence = acceptanceState === 'unresolved' ? 0 : confidence, base = acceptanceState === 'unresolved' ? null : { x: centerX, y: sample.body_y, confidence: pointConfidence };
    if (base) { left.confidence = pointConfidence; right.confidence = pointConfidence; }
    const zone = { start_index: startIndex, end_index: endIndex, start_y: samples[startIndex].body_y, end_y: samples[endIndex].body_y, representative_index: representative.index };
    const measurementReady = acceptanceState === 'accepted' && confidence >= .72;
    return { left: base ? left : null, right: base ? right : null, base, analysis: { ...prior, left_transition_zone: { ...zone, boundaries: samples.slice(startIndex, endIndex + 1).map(item => item.left_boundary) }, right_transition_zone: { ...zone, boundaries: samples.slice(startIndex, endIndex + 1).map(item => item.right_boundary) }, left_transition: base ? left : null, right_transition: base ? right : null, neck_base: base, neck_width: width, neck_to_shoulder_ratio: ratio, landmark_acceptance_state: acceptanceState, measurement_ready: measurementReady, confidence: { numeric: pointConfidence, category: category(base?.confidence ?? null) }, confidence_formula: '0.24 widening + 0.16 persistence + 0.14 bilateral + 0.12 continuity + 0.11 pose + 0.09 segmentation + 0.08 width plausibility + 0.06 axis/level stability', warnings: acceptanceState === 'unresolved' ? ['NECK_TRANSITION_UNRESOLVED'] : acceptanceState === 'low_confidence_accepted' ? ['NECK_LOW_CONFIDENCE_ACCEPTED'] : [] } };
  }

  function resolve({ rawPose, personMask, stage2, stage3c, stage3d }) {
    const component = root.tailorScanStage2.dominantComponent(personMask), initialNeck = resolveNeck({ stage3d, rawPose, bodyAxis: stage2.bodyAxis, componentDominance: component.dominance });
    const left = resolveAcromion({ analysis: stage3d.shoulderAnalysis.left, rawPose, side: 'left', neckTransition: initialNeck.left, componentDominance: component.dominance });
    const right = resolveAcromion({ analysis: stage3d.shoulderAnalysis.right, rawPose, side: 'right', neckTransition: initialNeck.right, componentDominance: component.dominance });
    const neck = resolveNeck({ stage3d, rawPose, bodyAxis: stage2.bodyAxis, componentDominance: component.dominance, acromions: { left: left.point, right: right.point } });
    const values = { ...stage3d.resolvedLandmarks }, normalization = root.tailorScanStage2.createNormalization(stage2.bodyAxis);
    const make = (name, point, source, diagnostics) => { if (!point) return null; const normalized = normalization.point(point, rawPose.image_width, rawPose.image_height); return root.tailorScanLandmarks.createLandmark({ name, x_px: point.x, y_px: point.y, x_norm: normalized.x_image_norm, y_norm: normalized.y_image_norm, ...normalized, confidence: point.confidence, source, diagnostics, frame_id: rawPose.frame_id, view_id: rawPose.view_id }); };
    values.left_acromion = make('left_acromion', left.point, 'refined', left.analysis); values.right_acromion = make('right_acromion', right.point, 'refined', right.analysis);
    values.left_neck_transition = make('left_neck_transition', neck.left, 'silhouette', neck.analysis); values.right_neck_transition = make('right_neck_transition', neck.right, 'silhouette', neck.analysis); values.neck_base = make('neck_base', neck.base, 'derived', neck.analysis);
    const acromionSpan = left.point && right.point ? Math.hypot(left.point.x - right.point.x, left.point.y - right.point.y) : null, rawLeft = stage3d.shoulderAnalysis.left.raw_shoulder, rawRight = stage3d.shoulderAnalysis.right.raw_shoulder, rawSpan = rawLeft && rawRight ? Math.hypot(rawLeft.x - rawRight.x, rawLeft.y - rawRight.y) : null, heightDifference = left.point && right.point ? Math.abs(left.point.y - right.point.y) : null;
    const bilateral = { ...stage3d.bilateralShoulderDiagnostics, left_acromion_body_y: left.point ? normalization.point(left.point, rawPose.image_width, rawPose.image_height).y_body_norm : null, right_acromion_body_y: right.point ? normalization.point(right.point, rawPose.image_width, rawPose.image_height).y_body_norm : null, acromion_span_px: acromionSpan, acromion_to_raw_span_ratio: acromionSpan !== null && rawSpan ? acromionSpan / rawSpan : null, shoulder_height_difference_px: heightDifference, shoulder_height_difference_body_fraction: heightDifference === null ? null : heightDifference / stage2.normalization.body_axis_height_px, classification: acromionSpan === null ? 'not_evaluable' : heightDifference / stage2.normalization.body_axis_height_px < .025 ? 'plausible' : heightDifference / stage2.normalization.body_axis_height_px < .05 ? 'unusual' : 'highly_suspicious' };
    const ready = (result, landmark) => result.analysis.measurement_ready && Boolean(landmark);
    const readiness = { shoulder_width_ready: ready(left, values.left_acromion) && ready(right, values.right_acromion), left_sleeve_ready: ready(left, values.left_acromion) && (values.left_elbow?.confidence ?? 0) >= .72 && (values.left_wrist?.confidence ?? 0) >= .72, right_sleeve_ready: ready(right, values.right_acromion) && (values.right_elbow?.confidence ?? 0) >= .72 && (values.right_wrist?.confidence ?? 0) >= .72, neck_based_measurements_ready: neck.analysis.measurement_ready && Boolean(values.neck_base) };
    const preservedWarnings = (stage3d.warnings || []).filter(warning => !warning.includes('ACROMION') && !warning.includes('NECK'));
    const warnings = [...new Set([...preservedWarnings, ...(left.analysis.warnings || []).map(warning => `LEFT_${warning}`), ...(right.analysis.warnings || []).map(warning => `RIGHT_${warning}`), ...(neck.analysis.warnings || [])])];
    return { resolvedLandmarks: root.tailorScanLandmarks.createTailoringLandmarks(values), shoulderAnalysis: { left: left.analysis, right: right.analysis }, neckAnalysis: neck.analysis, bilateralShoulderDiagnostics: bilateral, measurementLandmarkReadiness: readiness, generalizationDiagnostics: { ...stage3d.generalizationDiagnostics, candidate_clustering_scale: '7.5% contour arc or 6% shoulder span', confidence_policy: 'bounded weighted evidence; hard violations remain exclusions' }, warnings };
  }

  root.tailorScanStage3E = Object.freeze({ clusterCandidateRegions, resolveAcromion, resolveNeck, resolve, category });
})(typeof window === 'undefined' ? globalThis : window);
