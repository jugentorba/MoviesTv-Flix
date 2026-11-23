#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import sys
import xml.etree.ElementTree as ET

ANDROID = "{http://schemas.android.com/apk/res/android}"

EXPECTED_FEATURES = {
    "android.software.leanback": True,
    "android.hardware.touchscreen": False,
    "android.hardware.faketouch": False,
}


def required_value(node: ET.Element) -> bool:
    raw = node.get(f"{ANDROID}required")
    if raw is None:
        return True
    return raw.lower() == "true"


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(
            "usage: verify-android-tv-manifest.py <AndroidManifest.xml>"
        )

    path = Path(sys.argv[1])
    root = ET.parse(path).getroot()

    features: dict[str, list[bool]] = {}
    for feature in root.findall("uses-feature"):
        name = feature.get(f"{ANDROID}name")
        if name:
            features.setdefault(name, []).append(required_value(feature))

    for name, expected in EXPECTED_FEATURES.items():
        states = features.get(name, [])
        if states != [expected]:
            raise SystemExit(
                f"{path}: {name} expected exactly one required={str(expected).lower()} "
                f"declaration, found {states or 'none'}"
            )

    application = root.find("application")
    if application is None:
        raise SystemExit(f"{path}: missing application element")
    if not application.get(f"{ANDROID}banner"):
        raise SystemExit(f"{path}: missing Android TV application banner")

    has_leanback_launcher = False
    for tag in ("activity", "activity-alias"):
        for activity in application.findall(tag):
            for intent_filter in activity.findall("intent-filter"):
                actions = {
                    action.get(f"{ANDROID}name")
                    for action in intent_filter.findall("action")
                }
                categories = {
                    category.get(f"{ANDROID}name")
                    for category in intent_filter.findall("category")
                }
                if (
                    "android.intent.action.MAIN" in actions
                    and "android.intent.category.LEANBACK_LAUNCHER" in categories
                ):
                    has_leanback_launcher = True
                    break
            if has_leanback_launcher:
                break
        if has_leanback_launcher:
            break

    if not has_leanback_launcher:
        raise SystemExit(f"{path}: missing Leanback launcher activity")

    print(f"PASS Android TV manifest requirements: {path}")


if __name__ == "__main__":
    main()
