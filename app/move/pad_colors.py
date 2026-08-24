"""Ableton Move set-pad colour IDs, as used by the device LEDs.

IDs 1–25 are from the extending-move mapping (measured against the hardware).
26 is in Move's documented range but has no published RGB; it falls back to grey.
"""

from __future__ import annotations

PAD_COLORS: dict[int, tuple[int, int, int]] = {
    1: (255, 25, 23),
    2: (255, 142, 12),
    3: (255, 98, 41),
    4: (255, 186, 115),
    5: (215, 74, 9),
    6: (231, 231, 127),
    7: (255, 233, 94),
    8: (192, 255, 112),
    9: (135, 255, 109),
    10: (93, 219, 32),
    11: (161, 206, 47),
    12: (106, 237, 196),
    13: (0, 206, 197),
    14: (0, 212, 198),
    15: (29, 247, 243),
    16: (113, 167, 231),
    17: (34, 133, 240),
    18: (125, 87, 229),
    19: (34, 171, 240),
    20: (150, 139, 233),
    21: (178, 139, 233),
    22: (223, 139, 233),
    23: (199, 90, 214),
    24: (247, 35, 141),
    25: (227, 95, 200),
}


def hex_color(color_id: int | None) -> str | None:
    if color_id is None:
        return None
    rgb = PAD_COLORS.get(color_id)
    if rgb is None:
        return None
    return f"#{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}"
