// On-device vision provider. MediaPipe Tasks Vision and the referenced selfie
// segmentation / pose models are used for real per-frame inference only.
// This provider intentionally does not fabricate a body mesh.
// Keep the JavaScript module and WASM files on the exact same release. The
// newer 0.10.35 binary currently fails WebAssembly validation on iOS Safari.
// Both candidates below use the CPU path and the second is a separate release,
// so Safari never retries the same corrupt/incompatible binary.
const VISION_RUNTIMES = [
  { module: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/+esm', wasm: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm' },
  { module: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm', wasm: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm' }
];
const POSE_MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task';
const SEGMENTATION_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';
const POSE_INDEX = { nose: 0, left_eye: 2, right_eye: 5, left_ear: 7, right_ear: 8, left_shoulder: 11, right_shoulder: 12, left_elbow: 13, right_elbow: 14, left_wrist: 15, right_wrist: 16, left_hip: 23, right_hip: 24, left_knee: 25, right_knee: 26, left_ankle: 27, right_ankle: 28, left_heel: 29, right_heel: 30, left_foot_index: 31, right_foot_index: 32 };

function clamp(value) { return Math.max(0, Math.min(1, value)); }
function namedLandmarks(landmarks) { return Object.fromEntries(Object.entries(POSE_INDEX).map(([name, index]) => [name, landmarks[index] || null])); }
function averageVisibility(landmarks) { return landmarks.reduce((total, point) => total + (point.visibility ?? point.presence ?? 0), 0) / landmarks.length; }
function sharpnessScore(image) {
  const canvas = document.createElement('canvas'), size = 96; canvas.width = size; canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0, size, size);
  const pixels = context.getImageData(0, 0, size, size).data; let total = 0, samples = 0;
  for (let y = 1; y < size - 1; y += 1) for (let x = 1; x < size - 1; x += 1) { const i = (y * size + x) * 4, center = pixels[i] + pixels[i + 1] + pixels[i + 2], neighbours = pixels[i - 4] + pixels[i + 4] + pixels[i - size * 4] + pixels[i + size * 4] + pixels[i - 3] + pixels[i + 5] + pixels[i - size * 4 + 1] + pixels[i + size * 4 + 1] + pixels[i - 2] + pixels[i + 6] + pixels[i - size * 4 + 2] + pixels[i + size * 4 + 2]; total += Math.abs(4 * center - neighbours); samples += 1; }
  return clamp((total / Math.max(samples, 1)) / 220);
}
function segmentationDetails(result, frameWidth, frameHeight) {
  const mask = result.confidenceMasks?.[1] || result.confidenceMasks?.[0];
  if (!mask?.getAsFloat32Array) throw new Error('Person-confidence mask was not returned by the segmentation model.');
  const data = new Float32Array(mask.getAsFloat32Array()), width = mask.width, height = mask.height; let personConfidenceSum = 0, count = 0, minX = width, minY = height, maxX = -1, maxY = -1;
  data.forEach((confidence, index) => { if (confidence >= .5) { const x = index % width, y = Math.floor(index / width); count += 1; personConfidenceSum += confidence; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); } });
  if (!count) throw new Error('No usable person silhouette detected.');
  const boundingBox = { x: minX / width, y: minY / height, width: (maxX - minX + 1) / width, height: (maxY - minY + 1) / height };
  const edgeClipping = boundingBox.x < .01 || boundingBox.y < .01 || boundingBox.x + boundingBox.width > .99 || boundingBox.y + boundingBox.height > .99;
  // Quality must describe confidence in the detected person pixels, not the
  // average over mostly-background pixels. The old whole-frame average made a
  // valid full-body silhouette look low-confidence and rejected every video frame.
  return { segmentationMaskRef: { width, height, data }, confidence: personConfidenceSum / count, foregroundCoverage: count / data.length, frameDimensions: { width: frameWidth, height: frameHeight }, boundingBox, bodyVisibility: edgeClipping ? .3 : clamp((boundingBox.height - .55) / .25), edgeClipping };
}
function estimateOrientation(landmarks, guidedAngle) {
  const left = landmarks[POSE_INDEX.left_shoulder], right = landmarks[POSE_INDEX.right_shoulder], leftHip = landmarks[POSE_INDEX.left_hip], rightHip = landmarks[POSE_INDEX.right_hip];
  if (![left, right, leftHip, rightHip].every(Boolean)) return { orientationDeg: guidedAngle, confidence: 0, source: 'guided checkpoint; pose orientation unavailable' };
  const shoulderWidth = Math.hypot(left.x - right.x, left.y - right.y), hipWidth = Math.hypot(leftHip.x - rightHip.x, leftHip.y - rightHip.y), torso = Math.hypot(((left.x + right.x) - (leftHip.x + rightHip.x)) / 2, ((left.y + right.y) - (leftHip.y + rightHip.y)) / 2);
  const frontality = clamp(((shoulderWidth + hipWidth) / 2) / Math.max(torso, .001));
  // A single monocular pose does not reliably recover a person's azimuth. The
  // guided checkpoint remains the angular reference; frontality only expresses
  // whether this frame has a usable broad torso view, not a recovered heading.
  return { orientationDeg: guidedAngle, confidence: frontality, source: 'guided checkpoint with pose-derived broad-view confidence' };
}

class MediaPipeVisionProvider {
  static async create() {
    const failures = [];
    for (const runtime of VISION_RUNTIMES) {
      try {
        const { FilesetResolver, ImageSegmenter, PoseLandmarker } = await import(runtime.module);
        const fileset = await FilesetResolver.forVisionTasks(runtime.wasm);
        const [pose, segmenter] = await Promise.all([
          PoseLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: POSE_MODEL, delegate: 'CPU' }, runningMode: 'IMAGE', numPoses: 1, outputSegmentationMasks: false }),
          ImageSegmenter.createFromOptions(fileset, { baseOptions: { modelAssetPath: SEGMENTATION_MODEL, delegate: 'CPU' }, runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: true })
        ]);
        return new MediaPipeVisionProvider(pose, segmenter);
      } catch (error) { failures.push(error?.message || String(error)); }
    }
    throw new Error(`The iPhone vision engine could not start after two compatible runtime attempts. ${failures.at(-1) || ''}`.trim());
  }
  constructor(pose, segmenter) { this.pose = pose; this.segmenter = segmenter; }
  analyzeFrame = async (frame) => {
    const image = await window.tailorScanImages.loadImage(frame.image), poseResult = this.pose.detect(image), segmentationResult = this.segmenter.segment(image);
    const landmarks = poseResult.landmarks?.[0], worldLandmarks = poseResult.worldLandmarks?.[0];
    if (!landmarks || !worldLandmarks) throw new Error('No reliable body pose was detected.');
    const segmentation = segmentationDetails(segmentationResult, image.naturalWidth, image.naturalHeight), visibility = averageVisibility(landmarks), orientation = estimateOrientation(landmarks, frame.angle), sharpness = sharpnessScore(image);
    // The raw Laplacian score is deliberately conservative at phone-video
    // resolution. Convert it to a blur heuristic before the frame gate rather
    // than treating every normally detailed iPhone frame as severely blurred.
    const motionBlur = clamp(1 - sharpness * 2.2);
    const rawPose = window.tailorScanLandmarks.createRawPoseLandmarks({ image_width: image.naturalWidth, image_height: image.naturalHeight, landmarks: namedLandmarks(landmarks), world_landmarks: namedLandmarks(worldLandmarks), frame_id: frame.id, view_id: frame.id });
    const tailoringLandmarks = window.tailorScanLandmarks.createPoseReferencedTailoringLandmarks(rawPose);
    return { quality: { sharpness, motionBlur, bodyVisibility: segmentation.bodyVisibility, landmarkReliability: visibility, segmentationQuality: segmentation.confidence, occlusion: segmentation.edgeClipping ? 1 : 1 - visibility }, segmentationMaskRef: segmentation.segmentationMaskRef, segmentation, rawPose, rawShoulderReferences: { raw_left_shoulder: rawPose.landmarks.left_shoulder, raw_right_shoulder: rawPose.landmarks.right_shoulder }, landmarks: rawPose.landmarks, worldLandmarks: rawPose.world_landmarks, correspondenceKeypoints: rawPose.landmarks, tailoringLandmarks, orientationDeg: orientation.orientationDeg, orientation, stability: null, frameReference: frame.id };
  };
}

window.tailorScanVision = { createProvider: MediaPipeVisionProvider.create, license: { package: 'Apache-2.0', models: 'Selfie Segmenter model card: Apache-2.0. Pin and verify the exact Pose Landmarker model-asset terms before commercial distribution.' } };
