#!/usr/bin/env python3
"""Estimate vertical body measurements from a single full-body photograph.

The program uses MediaPipe Pose landmarks and a user-provided standing height
to convert vertical pixel distances into centimetres or inches.

Important: MediaPipe Pose does not provide a crown-of-head landmark. The
highest visible nose/ear landmark and lowest visible heel/foot-index landmark
are therefore used as reference endpoints. Results remain approximations, not
tailoring- or medical-grade measurements.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Iterable

import cv2
import mediapipe as mp


Point = tuple[int, int]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Estimate torso and leg lengths from a full-body photo."
    )
    parser.add_argument("image", type=Path, help="Path to the input image")
    parser.add_argument(
        "height", type=float, help="Person's actual standing height"
    )
    parser.add_argument(
        "--unit",
        choices=("cm", "in"),
        default="cm",
        help="Unit for height and output measurements (default: cm)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Output image path (default: <input_stem>_measured.<extension>)",
    )
    parser.add_argument(
        "--min-visibility",
        type=float,
        default=0.5,
        help="Minimum accepted landmark visibility, from 0 to 1 (default: 0.5)",
    )
    args = parser.parse_args()
    if args.height <= 0:
        parser.error("height must be greater than zero")
    if not 0 <= args.min_visibility <= 1:
        parser.error("--min-visibility must be between 0 and 1")
    return args


def landmark_point(landmark: object, width: int, height: int) -> Point:
    """Convert one normalized MediaPipe landmark to image coordinates."""
    x = max(0, min(width - 1, round(landmark.x * width)))
    y = max(0, min(height - 1, round(landmark.y * height)))
    return x, y


def center(a: Point, b: Point) -> Point:
    return round((a[0] + b[0]) / 2), round((a[1] + b[1]) / 2)


def euclidean_distance(a: Point, b: Point) -> float:
    """Return the straight-line 2D pixel distance between two points."""
    return math.hypot(b[0] - a[0], b[1] - a[1])


def require_visible(
    landmarks: list[object], indices: Iterable[int], min_visibility: float
) -> None:
    missing = [
        mp.solutions.pose.PoseLandmark(index).name
        for index in indices
        if landmarks[index].visibility < min_visibility
    ]
    if missing:
        raise RuntimeError(
            "Required landmarks are not visible enough: " + ", ".join(missing)
        )


def draw_measurement(
    image: object,
    start: Point,
    end: Point,
    label: str,
    color: tuple[int, int, int],
) -> None:
    cv2.line(image, start, end, color, 3, cv2.LINE_AA)
    cv2.circle(image, start, 6, color, -1, cv2.LINE_AA)
    cv2.circle(image, end, 6, color, -1, cv2.LINE_AA)
    text_x = min(image.shape[1] - 10, max(10, (start[0] + end[0]) // 2 + 10))
    text_y = max(25, (start[1] + end[1]) // 2)
    cv2.putText(
        image,
        label,
        (text_x, text_y),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.65,
        color,
        2,
        cv2.LINE_AA,
    )


def main() -> None:
    args = parse_args()
    image = cv2.imread(str(args.image))
    if image is None:
        raise SystemExit(f"Could not load image: {args.image}")

    height_px, width_px = image.shape[:2]
    pose_module = mp.solutions.pose
    required = [
        pose_module.PoseLandmark.LEFT_SHOULDER.value,
        pose_module.PoseLandmark.RIGHT_SHOULDER.value,
        pose_module.PoseLandmark.LEFT_HIP.value,
        pose_module.PoseLandmark.RIGHT_HIP.value,
        pose_module.PoseLandmark.LEFT_KNEE.value,
        pose_module.PoseLandmark.RIGHT_KNEE.value,
        pose_module.PoseLandmark.LEFT_ANKLE.value,
        pose_module.PoseLandmark.RIGHT_ANKLE.value,
    ]

    with pose_module.Pose(
        static_image_mode=True,
        model_complexity=2,
        enable_segmentation=False,
        min_detection_confidence=0.5,
    ) as pose:
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        result = pose.process(rgb)

    if result.pose_landmarks is None:
        raise SystemExit("No person/pose was detected in the image.")

    landmarks = result.pose_landmarks.landmark
    try:
        require_visible(landmarks, required, args.min_visibility)
    except RuntimeError as exc:
        raise SystemExit(str(exc)) from exc

    def point(name: object) -> Point:
        return landmark_point(landmarks[name.value], width_px, height_px)

    def extreme_visible_point(
        names: list[object], *, highest: bool
    ) -> tuple[object, Point]:
        visible = [
            (name, point(name))
            for name in names
            if landmarks[name.value].visibility >= args.min_visibility
        ]
        if not visible:
            candidates = ", ".join(name.name for name in names)
            raise SystemExit(
                f"None of the reference landmarks passed the visibility threshold: "
                f"{candidates}"
            )
        return (min if highest else max)(visible, key=lambda item: item[1][1])

    head_name, head_point = extreme_visible_point(
        [
            pose_module.PoseLandmark.NOSE,
            pose_module.PoseLandmark.LEFT_EAR,
            pose_module.PoseLandmark.RIGHT_EAR,
        ],
        highest=True,
    )
    foot_name, foot_point = extreme_visible_point(
        [
            pose_module.PoseLandmark.LEFT_HEEL,
            pose_module.PoseLandmark.RIGHT_HEEL,
            pose_module.PoseLandmark.LEFT_FOOT_INDEX,
            pose_module.PoseLandmark.RIGHT_FOOT_INDEX,
        ],
        highest=False,
    )
    shoulder_center = center(
        point(pose_module.PoseLandmark.LEFT_SHOULDER),
        point(pose_module.PoseLandmark.RIGHT_SHOULDER),
    )
    hip_center = center(
        point(pose_module.PoseLandmark.LEFT_HIP),
        point(pose_module.PoseLandmark.RIGHT_HIP),
    )
    knee_center = center(
        point(pose_module.PoseLandmark.LEFT_KNEE),
        point(pose_module.PoseLandmark.RIGHT_KNEE),
    )
    ankle_center = center(
        point(pose_module.PoseLandmark.LEFT_ANKLE),
        point(pose_module.PoseLandmark.RIGHT_ANKLE),
    )

    # Standing height is vertical, so its scale uses the Y-span. Individual body
    # segments below use Euclidean distance to preserve diagonal posture length.
    total_vertical_pixels = foot_point[1] - head_point[1]
    if total_vertical_pixels <= 0:
        raise SystemExit("Invalid pose geometry: feet must appear below the head.")

    ratio = args.height / total_vertical_pixels
    torso_pixels = euclidean_distance(shoulder_center, hip_center)
    leg_pixels = euclidean_distance(hip_center, ankle_center)
    torso_length = torso_pixels * ratio
    leg_length = leg_pixels * ratio

    print(
        f"Reference span ({head_name.name} to {foot_name.name}): "
        f"{total_vertical_pixels} px"
    )
    print(f"Scale: {ratio:.6f} {args.unit}/px")
    print(f"Torso length (shoulder center to hip center): {torso_length:.2f} {args.unit}")
    print(f"Leg length (hip center to ankle center): {leg_length:.2f} {args.unit}")
    print("Note: pose landmarks approximate the crown-to-floor span; results are approximate.")

    annotated = image.copy()
    reference_end = (head_point[0], foot_point[1])
    draw_measurement(
        annotated,
        head_point,
        reference_end,
        f"Reference: {args.height:g} {args.unit}",
        (0, 255, 255),
    )
    draw_measurement(
        annotated,
        shoulder_center,
        hip_center,
        f"Torso: {torso_length:.2f} {args.unit}",
        (0, 255, 0),
    )
    draw_measurement(
        annotated,
        hip_center,
        ankle_center,
        f"Leg: {leg_length:.2f} {args.unit}",
        (255, 128, 0),
    )
    cv2.circle(annotated, knee_center, 5, (255, 0, 255), -1, cv2.LINE_AA)
    output = args.output
    if output is None:
        suffix = args.image.suffix or ".jpg"
        output = args.image.with_name(f"{args.image.stem}_measured{suffix}")
    output.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(output), annotated):
        raise SystemExit(f"Could not save output image: {output}")
    print(f"Saved annotated image: {output}")

    measurement_data = {
        "input_image": str(args.image),
        "output_image": str(output),
        "unit": args.unit,
        "actual_height": args.height,
        "reference": {
            "top_landmark": head_name.name,
            "bottom_landmark": foot_name.name,
            "vertical_pixels": total_vertical_pixels,
            "real_units_per_pixel": ratio,
        },
        "measurements": {
            "torso": {
                "from": "SHOULDER_CENTER",
                "to": "HIP_CENTER",
                "pixels": torso_pixels,
                "value": torso_length,
            },
            "leg": {
                "from": "HIP_CENTER",
                "to": "ANKLE_CENTER",
                "pixels": leg_pixels,
                "value": leg_length,
            },
        },
        "landmark_centers_pixels": {
            "shoulders": {"x": shoulder_center[0], "y": shoulder_center[1]},
            "hips": {"x": hip_center[0], "y": hip_center[1]},
            "knees": {"x": knee_center[0], "y": knee_center[1]},
            "ankles": {"x": ankle_center[0], "y": ankle_center[1]},
        },
    }
    print(json.dumps(measurement_data, indent=2))


if __name__ == "__main__":
    main()
