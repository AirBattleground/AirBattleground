"""Small geometry helpers: boxes, layout-unit conversion, kernel sizes. All ratios come from layout.yaml."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Box:
    """Axis-aligned pixel box, half-open: [x0, x1) x [y0, y1)."""

    x0: int
    y0: int
    x1: int
    y1: int

    @property
    def w(self) -> int:
        return max(0, self.x1 - self.x0)

    @property
    def h(self) -> int:
        return max(0, self.y1 - self.y0)

    @property
    def area(self) -> int:
        return self.w * self.h

    def clip(self, width: int, height: int) -> Box:
        return Box(
            min(max(self.x0, 0), width),
            min(max(self.y0, 0), height),
            min(max(self.x1, 0), width),
            min(max(self.y1, 0), height),
        )

    def sub(self, spec: Mapping[str, Any]) -> Box:
        """Sub-box from fractions of this box: {x0, x1, y0, y1} in [0, 1]."""
        return Box(
            self.x0 + round(float(spec["x0"]) * self.w),
            self.y0 + round(float(spec["y0"]) * self.h),
            self.x0 + round(float(spec["x1"]) * self.w),
            self.y0 + round(float(spec["y1"]) * self.h),
        )

    def row_strip(self, x0: float, x1: float, center: float, height: float, ref_h: int | None = None) -> Box:
        """Horizontal strip of this box: x in fractions of width, centre/height in fractions of `ref_h`
        (defaults to this box's height; blocks cut by a panel edge pass their nominal height)."""
        rh = self.h if ref_h is None else ref_h
        cy = self.y0 + center * rh
        half = height * rh / 2
        return Box(
            self.x0 + round(x0 * self.w),
            round(cy - half),
            self.x0 + round(x1 * self.w),
            round(cy + half),
        )

    def as_list(self) -> list[int]:
        return [self.x0, self.y0, self.x1, self.y1]


def to_px_x(value: float, width: int, height: int, units: str) -> int:
    """Convert a panel-level x coordinate from layout units to pixels."""
    if units == "center_h":
        return round(width / 2 + value * height)
    if units == "width":
        return round(value * width)
    raise ValueError(f"unknown x_units {units!r}")


def to_px_y(value: float, height: int) -> int:
    return round(value * height)


def odd_kernel(frac: float, height: int, minimum: int = 1) -> int:
    """Kernel size from a fraction of the image height, rounded to an odd integer >= minimum."""
    k = max(minimum, round(frac * height))
    return k if k % 2 == 1 else k + 1
