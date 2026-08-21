(function exposeStage2Resolver(root) {
  const clamp = value => Math.max(0, Math.min(1, value));
  const confidence = point => clamp(point?.visibility ?? point?.presence ?? 0);
  const midpoint = (a, b) => a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
  const inPixels = (point, width, height) => point && Number.isFinite(point.x) && Number.isFinite(point.y) ? { x: point.x * width, y: point.y * height } : null;

  function dominantComponent(mask, threshold = .5) {
    const { width, height, data } = mask || {};
    if (!Number.isInteger(width) || !Number.isInteger(height) || !data || data.length !== width * height) throw new TypeError('A valid person mask is required.');
    const visited = new Uint8Array(data.length); let best = [], componentCount = 0, foregroundCount = 0;
    for (let i = 0; i < data.length; i += 1) {
      if (data[i] < threshold) continue; foregroundCount += 1;
      if (visited[i]) continue; componentCount += 1; const queue = [i], pixels = []; visited[i] = 1;
      for (let q = 0; q < queue.length; q += 1) {
        const index = queue[q], x = index % width, y = Math.floor(index / width); pixels.push(index);
        for (const next of [index - 1, index + 1, index - width, index + width]) {
          if (next < 0 || next >= data.length || visited[next] || data[next] < threshold) continue;
          const nx = next % width, ny = Math.floor(next / width); if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
          visited[next] = 1; queue.push(next);
        }
      }
      if (pixels.length > best.length) best = pixels;
    }
    if (!best.length) throw new Error('No dominant subject component was found.');
    const binary = new Uint8Array(data.length); let minX = width, minY = height, maxX = -1, maxY = -1, sum = 0;
    best.forEach(index => { binary[index] = 1; const x = index % width, y = Math.floor(index / width); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); sum += data[index]; });
    return { width, height, data: binary, bounds: { min_x: minX, min_y: minY, max_x: maxX, max_y: maxY }, area: best.length, component_count: componentCount, dominance: best.length / foregroundCount, mean_confidence: sum / best.length };
  }

  function resolveHeadTop(component, rawPose) {
    const scaleX = component.width / rawPose.image_width, scaleY = component.height / rawPose.image_height;
    const face = ['nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear'].map(name => inPixels(rawPose.landmarks[name], component.width, component.height)).filter(Boolean);
    const shoulders = ['left_shoulder', 'right_shoulder'].map(name => inPixels(rawPose.landmarks[name], component.width, component.height)).filter(Boolean);
    if (!face.length && !shoulders.length) return null;
    const centerX = face.length ? face.reduce((sum, p) => sum + p.x, 0) / face.length : shoulders.reduce((sum, p) => sum + p.x, 0) / shoulders.length;
    const shoulderWidth = shoulders.length === 2 ? Math.abs(shoulders[0].x - shoulders[1].x) : component.width * .25;
    const radius = Math.max(3, shoulderWidth * .55), maxY = shoulders.length ? Math.min(...shoulders.map(p => p.y)) : component.bounds.min_y + (component.bounds.max_y - component.bounds.min_y) * .3;
    let selected = null;
    for (let y = component.bounds.min_y; y <= maxY; y += 1) {
      const xs = []; for (let x = Math.max(component.bounds.min_x, Math.floor(centerX - radius)); x <= Math.min(component.bounds.max_x, Math.ceil(centerX + radius)); x += 1) if (component.data[y * component.width + x]) xs.push(x);
      const nextCount = y + 1 < component.height ? xs.filter(x => component.data[(y + 1) * component.width + x]).length : 0;
      if (xs.length >= 2 && nextCount >= 2) { selected = { x: xs.reduce((a, b) => a + b, 0) / xs.length, y }; break; }
    }
    if (!selected) return null;
    const faceAgreement = face.length ? clamp(1 - Math.abs(selected.x - centerX) / Math.max(radius, 1)) : .45;
    const score = clamp(component.mean_confidence * component.dominance * (.6 + .4 * faceAgreement));
    return { x: selected.x / scaleX, y: selected.y / scaleY, confidence: score, diagnostics: { component_dominance: component.dominance, component_count: component.component_count, head_search_center_x_mask: centerX, head_search_radius_mask: radius, face_landmark_count: face.length, face_agreement: faceAgreement, rejected_isolated_components: component.component_count - 1 } };
  }

  function resolveFoot(component, rawPose, side) {
    const names = [`${side}_ankle`, `${side}_heel`, `${side}_foot_index`], points = names.map(name => ({ name, raw: rawPose.landmarks[name], point: inPixels(rawPose.landmarks[name], component.width, component.height) })).filter(v => v.point);
    if (!points.length) return null;
    const xCenter = points.reduce((sum, v) => sum + v.point.x, 0) / points.length, poseBottom = Math.max(...points.map(v => v.point.y));
    const radius = Math.max(2, component.width * .035), startY = Math.max(component.bounds.min_y, Math.floor(poseBottom - component.height * .06)), endY = Math.min(component.bounds.max_y, Math.ceil(poseBottom + component.height * .06)); let selected = null;
    for (let y = endY; y >= startY; y -= 1) { const xs = []; for (let x = Math.max(0, Math.floor(xCenter - radius)); x <= Math.min(component.width - 1, Math.ceil(xCenter + radius)); x += 1) if (component.data[y * component.width + x]) xs.push(x); if (xs.length >= 2) { selected = { x: xs.reduce((a, b) => a + b, 0) / xs.length, y }; break; } }
    const poseConfidence = points.reduce((sum, v) => sum + confidence(v.raw), 0) / points.length, segmentationAgreement = selected ? clamp(1 - Math.abs(selected.y - poseBottom) / Math.max(component.height * .06, 1)) : 0, score = clamp(poseConfidence * (.55 + .45 * segmentationAgreement) * component.dominance);
    if (!selected) selected = { x: xCenter, y: poseBottom };
    return { x: selected.x * rawPose.image_width / component.width, y: selected.y * rawPose.image_height / component.height, confidence: score, diagnostics: { evidence_landmarks: points.map(v => v.name), pose_confidence: poseConfidence, segmentation_agreement: segmentationAgreement, method: segmentationAgreement ? 'pose-guided dominant-silhouette contact' : 'pose-only fallback' } };
  }

  function calculateFloor(left, right, bodyHeightEstimate) {
    if (!left && !right) throw new Error('Foot data is required to calculate floor level.');
    const reliable = foot => foot && foot.confidence >= .45, both = reliable(left) && reliable(right), difference = left && right ? Math.abs(left.y - right.y) : null, mismatch = difference !== null && difference > Math.max(4, bodyHeightEstimate * .035); let level, method;
    if (both && !mismatch) { level = (left.y + right.y) / 2; method = 'bilateral-foot-average'; }
    else if (reliable(left) && (!reliable(right) || left.y >= right.y)) { level = left.y; method = 'left-reliable-foot'; }
    else if (reliable(right)) { level = right.y; method = 'right-reliable-foot'; }
    else { const candidates = [left, right].filter(Boolean); level = candidates.reduce((best, foot) => foot.confidence > best.confidence ? foot : best).y; method = 'highest-confidence-foot-fallback'; }
    return { left_floor_y: left?.y ?? null, right_floor_y: right?.y ?? null, floor_level_y: level, both_feet_reliable: both, left_foot_confidence: left?.confidence ?? 0, right_foot_confidence: right?.confidence ?? 0, foot_height_difference_px: difference, floor_method: method, floor_confidence: both && !mismatch ? Math.min(left.confidence, right.confidence) : Math.max(left?.confidence ?? 0, right?.confidence ?? 0) * .85 };
  }

  function calculateCenterline(rawPose, headTop, floor, leftFloor, rightFloor) {
    const px = name => inPixels(rawPose.landmarks[name], rawPose.image_width, rawPose.image_height), shoulder = midpoint(px('left_shoulder'), px('right_shoulder')), hip = midpoint(px('left_hip'), px('right_hip')), feet = leftFloor && rightFloor ? midpoint(leftFloor, rightFloor) : (leftFloor || rightFloor); const anchors = [shoulder, hip, feet].filter(Boolean);
    if (anchors.length < 2 || !headTop || !Number.isFinite(floor.floor_level_y)) throw new Error('Insufficient evidence for body centerline.');
    const meanY = anchors.reduce((s, p) => s + p.y, 0) / anchors.length, meanX = anchors.reduce((s, p) => s + p.x, 0) / anchors.length, denominator = anchors.reduce((s, p) => s + (p.y - meanY) ** 2, 0), slope = denominator ? anchors.reduce((s, p) => s + (p.y - meanY) * (p.x - meanX), 0) / denominator : 0, intercept = meanX - slope * meanY;
    const top = { x: intercept + slope * headTop.y, y: headTop.y }, bottom = { x: intercept + slope * floor.floor_level_y, y: floor.floor_level_y }, angle = Math.atan2(bottom.x - top.x, bottom.y - top.y) * 180 / Math.PI;
    return { top, bottom, angle_degrees: angle, confidence: clamp((anchors.length / 3) * (1 - Math.min(Math.abs(angle), 25) / 50)), anchors_used: anchors.length };
  }

  function createNormalization(axis) {
    const dx = axis.bottom.x - axis.top.x, dy = axis.bottom.y - axis.top.y, length = Math.hypot(dx, dy); if (!(length > 0)) throw new Error('Body axis height must be positive.'); const ux = dx / length, uy = dy / length;
    return { body_axis_height_px: length, vertical_image_height_px: Math.abs(dy), normalized_body_height: 1, coordinate_basis: 'projection onto head-to-floor centerline', point(point, width, height) { const rx = point.x - axis.top.x, ry = point.y - axis.top.y; return { x_image_norm: point.x / width, y_image_norm: point.y / height, x_body_norm: .5 + (rx * uy - ry * ux) / length, y_body_norm: (rx * ux + ry * uy) / length }; } };
  }

  function resolve({ rawPose, personMask, segmentation = null, heightInput = null }) {
    const component = dominantComponent(personMask), head = resolveHeadTop(component, rawPose); if (!head) throw new Error('Head top could not be resolved.');
    const leftFoot = resolveFoot(component, rawPose, 'left'), rightFoot = resolveFoot(component, rawPose, 'right'); if (!leftFoot && !rightFoot) throw new Error('Foot data is required.');
    const floor = calculateFloor(leftFoot, rightFoot, component.bounds.max_y - component.bounds.min_y), axis = calculateCenterline(rawPose, head, floor, leftFoot, rightFoot), normalization = createNormalization(axis), model = root.tailorScanLandmarks;
    const values = {};
    const add = (name, point, source, diagnostics, bodyYOverride = null) => { if (!point) return; const norm = normalization.point(point, rawPose.image_width, rawPose.image_height); if (bodyYOverride !== null) norm.y_body_norm = bodyYOverride; values[name] = model.createLandmark({ name, x_px: point.x, y_px: point.y, x_norm: norm.x_image_norm, y_norm: norm.y_image_norm, ...norm, confidence: point.confidence, source, diagnostics, frame_id: rawPose.frame_id, view_id: rawPose.view_id }); };
    add('head_top', head, 'silhouette', head.diagnostics, 0); add('left_floor', leftFoot, 'silhouette', leftFoot?.diagnostics); add('right_floor', rightFoot, 'silhouette', rightFoot?.diagnostics);
    const direct = { left_elbow: 'left_elbow', right_elbow: 'right_elbow', left_wrist: 'left_wrist', right_wrist: 'right_wrist', left_knee: 'left_knee', right_knee: 'right_knee', left_ankle: 'left_ankle', right_ankle: 'right_ankle' };
    Object.entries(direct).forEach(([name, rawName]) => { const raw = rawPose.landmarks[rawName], point = inPixels(raw, rawPose.image_width, rawPose.image_height); if (point) add(name, { ...point, confidence: confidence(raw) }, 'pose', { raw_landmark: rawName, visibility: raw.visibility ?? null, presence: raw.presence ?? null }); });
    const warnings = []; if (head.confidence < .55) warnings.push('HEAD_TOP_LOW_CONFIDENCE'); if (!leftFoot || leftFoot.confidence < .45) warnings.push('LEFT_FOOT_LOW_CONFIDENCE'); if (!rightFoot || rightFoot.confidence < .45) warnings.push('RIGHT_FOOT_LOW_CONFIDENCE'); if (Math.abs(axis.angle_degrees) > 8) warnings.push('BODY_TILT_HIGH'); if (component.dominance < .9 || component.component_count > 3) warnings.push('SEGMENTATION_NOISY'); if (floor.foot_height_difference_px !== null && floor.foot_height_difference_px > normalization.vertical_image_height_px * .035) warnings.push('FOOT_LEVEL_MISMATCH'); if (component.bounds.min_y <= 1) warnings.push('HEAD_MAY_BE_CLIPPED'); if (component.bounds.max_y >= component.height - 2) warnings.push('FEET_MAY_BE_CLIPPED'); if ((component.bounds.max_y - component.bounds.min_y + 1) / component.height < .55) warnings.push('BODY_TOO_SMALL'); const major = Object.values(direct).filter(name => rawPose.landmarks[name] && confidence(rawPose.landmarks[name]) >= .35).length; if (major < 6) warnings.push('MAJOR_POSE_JOINTS_MISSING');
    const resolved = model.createTailoringLandmarks(values), calibration = heightInput ? { known_height_inches: heightInput.height_inches, body_height_px: normalization.body_axis_height_px, normalized_body_height: 1, first_order_image_scale: { inches_per_body_axis_pixel: heightInput.height_inches / normalization.body_axis_height_px, warning: 'Image-plane reference only; does not correct perspective.' } } : null;
    return { resolvedLandmarks: resolved, bodyAxis: axis, floor, normalization: { body_axis_height_px: normalization.body_axis_height_px, vertical_image_height_px: normalization.vertical_image_height_px, normalized_body_height: 1, head_top_y_body: 0, floor_level_y_body: 1, coordinate_basis: normalization.coordinate_basis }, calibration, component: { bounds: component.bounds, area: component.area, dominance: component.dominance, component_count: component.component_count }, confidence: { head_top: head.confidence, floor: floor.floor_confidence, body_axis: axis.confidence }, warnings };
  }
  root.tailorScanStage2 = Object.freeze({ dominantComponent, resolveHeadTop, resolveFoot, calculateFloor, calculateCenterline, createNormalization, resolve });
})(typeof window === 'undefined' ? globalThis : window);
