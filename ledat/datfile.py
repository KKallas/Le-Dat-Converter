"""
DAT file writer for H803TC / H801RC / H802RA LED controllers.

Generates .dat files compatible with LEDBuild software and Huacan LED
controller hardware.

Format: 512-byte header, then frames padded to 512-byte boundaries.
Each frame uses groups of (8 × controllerCount) bytes. Each LED uses
3 consecutive groups for B, G, R channels. Within each controller's
8-byte block, port N maps to byte position (8 - N).

Multi-controller: universes 0-7 → controller 1, 8-15 → controller 2, etc.
"""

import math
import os
import numpy as np
from typing import Optional


PORTS_PER_CONTROLLER = 8

# Gamma 2.2 lookup table
GAMMA_LUT = np.array(
    [round(pow(i / 255.0, 2.2) * 255.0) for i in range(256)],
    dtype=np.uint8,
)


class DATFile:
    """
    LEDBuild DAT file generator.

    File structure:
        - Header: 512 bytes (magic + config, mostly zeros)
        - Frame data: interleaved groups, BGR channel order
        - Each frame padded to 512-byte boundary

    Usage::

        dat = DATFile()
        dat.add_universe(400)   # universe 0 = ctrl 1, port 1
        dat.add_universe(400)   # universe 1 = ctrl 1, port 2
        dat.set_num_frames(60)
        dat.set_pixel(universe=0, frame=0, pixel=0, r=255, g=0, b=0)
        dat.write("output.dat")  # also writes output.txt
    """

    HEADER_SIZE = 512
    MAGIC = bytes([0x00, 0x00, 0x48, 0x43])  # "HC" signature

    KNOWN_HEADERS: dict[tuple, bytes] = {}

    # ------------------------------------------------------------------ #
    # Class-level header registry
    # ------------------------------------------------------------------ #

    @classmethod
    def register_header(cls, num_slaves: int, pixels_per_slave: int,
                        header: bytes, ic_type: str = "QED3110") -> None:
        """Register a known-working 512-byte header for a configuration."""
        key = (num_slaves, pixels_per_slave, ic_type)
        cls.KNOWN_HEADERS[key] = header[:cls.HEADER_SIZE]

    @classmethod
    def load_header_from_file(cls, dat_file: str, num_slaves: int,
                               pixels_per_slave: int,
                               ic_type: str = "QED3110") -> bytes:
        """Load and register a header from an existing DAT file."""
        with open(dat_file, "rb") as f:
            header = f.read(cls.HEADER_SIZE)
        cls.register_header(num_slaves, pixels_per_slave, header, ic_type)
        return header

    # ------------------------------------------------------------------ #
    # Instance
    # ------------------------------------------------------------------ #

    def __init__(self, template_file: Optional[str] = None):
        """
        Create an empty DAT file builder.

        Args:
            template_file: Optional path to a LEDBuild-generated DAT file
                           whose 512-byte header will be reused on write.
        """
        self.template_file = template_file

        self._universes: list[int] = []       # LED count per universe
        self._num_frames: int = 0
        self._pixel_data: list[np.ndarray] = []  # per-universe (frames, leds, 3)

    # -- properties ---------------------------------------------------- #

    @property
    def num_universes(self) -> int:
        """Number of universes (ports)."""
        return len(self._universes)

    @property
    def num_frames(self) -> int:
        """Global frame count."""
        return self._num_frames

    @property
    def total_pixels(self) -> int:
        """Total pixels across all universes."""
        return sum(self._universes)

    @property
    def max_leds_per_port(self) -> int:
        """Max LEDs across all universes (determines frame group count)."""
        return max(self._universes) if self._universes else 0

    @property
    def controller_count(self) -> int:
        """Number of H801RC controllers needed (each has 8 ports)."""
        if not self._universes:
            return 1
        return math.ceil(len(self._universes) / PORTS_PER_CONTROLLER)

    @property
    def group_size(self) -> int:
        """Group size in bytes: 8 per controller."""
        return PORTS_PER_CONTROLLER * self.controller_count

    def universe_leds(self, universe: int) -> int:
        """LED count for a specific universe."""
        return self._universes[universe]

    # -- building the animation ---------------------------------------- #

    def add_universe(self, num_leds: int) -> int:
        """
        Add a universe (port) with *num_leds* LEDs.

        Returns:
            The 0-based universe index.
        """
        if num_leds <= 0:
            raise ValueError(f"num_leds must be positive, got {num_leds}")

        uid = len(self._universes)
        self._universes.append(num_leds)

        if self._num_frames > 0:
            self._pixel_data.append(
                np.zeros((self._num_frames, num_leds, 3), dtype=np.uint8)
            )
        else:
            self._pixel_data.append(np.zeros((0, num_leds, 3), dtype=np.uint8))

        return uid

    def set_num_frames(self, n: int) -> None:
        """
        Set the global frame count. New pixels are initialised to black.
        Existing pixel data is preserved up to the new frame count.
        """
        if n <= 0:
            raise ValueError(f"Frame count must be positive, got {n}")

        old_n = self._num_frames
        self._num_frames = n

        for i, num_leds in enumerate(self._universes):
            old_data = self._pixel_data[i]
            new_data = np.zeros((n, num_leds, 3), dtype=np.uint8)
            copy_frames = min(old_n, n)
            if copy_frames > 0:
                new_data[:copy_frames] = old_data[:copy_frames]
            self._pixel_data[i] = new_data

    def set_pixel(self, universe: int, frame: int, pixel: int,
                  r: int, g: int, b: int) -> None:
        """Set a single pixel's RGB colour (linear, before gamma)."""
        self._check_indices(universe, frame, pixel)
        self._pixel_data[universe][frame, pixel] = [r, g, b]

    def get_pixel(self, universe: int, frame: int,
                  pixel: int) -> tuple[int, int, int]:
        """Return ``(r, g, b)`` for the given pixel."""
        self._check_indices(universe, frame, pixel)
        rgb = self._pixel_data[universe][frame, pixel]
        return int(rgb[0]), int(rgb[1]), int(rgb[2])

    def append(self, frames: np.ndarray, universe: int) -> "DATFile":
        """
        Append pre-built frame data for a universe (backward-compatible).

        Args:
            frames: ``(num_frames, pixels, 3)`` or ``(pixels, 3)`` RGB array.
            universe: Universe index (0-based).

        Returns:
            *self* for chaining.
        """
        if universe < 0 or universe >= len(self._universes):
            raise ValueError(
                f"Universe {universe} out of range [0, {len(self._universes)})"
            )

        frames = np.atleast_3d(frames)
        if frames.ndim == 2:
            frames = frames[np.newaxis, ...]
        if frames.shape[1] == 3 and frames.shape[2] != 3:
            frames = frames.transpose(1, 0, 2)

        num_new = frames.shape[0]
        needed = self._num_frames + num_new
        if needed > self._num_frames:
            self.set_num_frames(needed)

        start = self._num_frames - num_new
        self._pixel_data[universe][start:self._num_frames] = frames.astype(np.uint8)
        return self

    def clear(self) -> "DATFile":
        """Clear all frame data (keeps universe configuration)."""
        self._num_frames = 0
        self._pixel_data = [
            np.zeros((0, n, 3), dtype=np.uint8) for n in self._universes
        ]
        return self

    # -- writing ------------------------------------------------------- #

    def write(self, filename: str,
              template_file: Optional[str] = None) -> int:
        """
        Write the ``.dat`` file **and** an accompanying ``.txt`` summary.

        Args:
            filename: Output path (e.g. ``"output.dat"``).
            template_file: Optional DAT file to copy the header from.

        Returns:
            Number of bytes written to the ``.dat`` file.
        """
        template_header = None
        tpl = template_file or self.template_file
        if tpl:
            with open(tpl, "rb") as tf:
                template_header = tf.read(self.HEADER_SIZE)

        max_leds = self.max_leds_per_port
        grp_size = self.group_size
        frame_bytes = max_leds * 3 * grp_size
        frame_pad = (512 - frame_bytes % 512) % 512

        with open(filename, "wb") as f:
            f.write(self._build_header(template_header))

            for idx in range(self._num_frames):
                f.write(self._build_frame(idx))
                if frame_pad:
                    f.write(bytes(frame_pad))

            dat_size = f.tell()

        base, _ = os.path.splitext(filename)
        self.write_txt(base + ".txt")
        return dat_size

    def write_txt(self, filename: str) -> None:
        """Write a human-readable ``.txt`` summary of the configuration."""
        with open(filename, "w") as f:
            f.write(f"Universes: {self.num_universes}\n")
            for i, n in enumerate(self._universes):
                f.write(f"Universe {i}: {n} LEDs\n")
            f.write(f"Frames: {self._num_frames}\n")

    # -- internals ----------------------------------------------------- #

    def _check_indices(self, universe: int, frame: int, pixel: int) -> None:
        if universe < 0 or universe >= len(self._universes):
            raise IndexError(
                f"Universe {universe} out of range [0, {len(self._universes)})"
            )
        if frame < 0 or frame >= self._num_frames:
            raise IndexError(
                f"Frame {frame} out of range [0, {self._num_frames})"
            )
        if pixel < 0 or pixel >= self._universes[universe]:
            raise IndexError(
                f"Pixel {pixel} out of range [0, {self._universes[universe]})"
            )

    def _build_header(self, template_header: Optional[bytes] = None) -> bytes:
        """Build the 512-byte header. Byte 16-17 = controller/slave count."""
        ctrl_count = self.controller_count

        if template_header is not None:
            hdr = bytearray(template_header[:self.HEADER_SIZE])
            hdr[16] = ctrl_count & 0xFF
            hdr[17] = (ctrl_count >> 8) & 0xFF
            return bytes(hdr)

        for key, hdr in self.KNOWN_HEADERS.items():
            if key[0] == self.num_universes:
                return bytes(hdr)

        hdr = bytearray(self.HEADER_SIZE)
        hdr[0:4] = self.MAGIC
        hdr[4:16] = bytes([
            0x40, 0x40, 0x0A, 0x60, 0x40, 0x4A, 0x0A, 0x60,
            0x04, 0x08, 0x50, 0x32,
        ])
        hdr[16] = ctrl_count & 0xFF
        hdr[17] = (ctrl_count >> 8) & 0xFF
        hdr[18:70] = bytes([
            0xB3, 0x2F, 0x76, 0x45, 0x28, 0x02, 0x83, 0xAC,
            0xE3, 0x00, 0x04, 0xDF, 0x67, 0x43, 0x11, 0x40,
            0x08, 0xA0, 0xAF, 0xAF, 0xF5, 0xE9, 0xB4, 0xFB,
            0x15, 0x55, 0xB1, 0xAF, 0x7C, 0x45, 0x32, 0x22,
            0x85, 0xEC, 0xEC, 0x20, 0x0B, 0x9F, 0x7C, 0x03,
            0x17, 0x40, 0x0E, 0xE0, 0xB9, 0x8F, 0x83, 0x31,
            0x52, 0x70, 0x50, 0x55,
        ])
        return bytes(hdr)

    def _build_frame(self, frame_idx: int) -> bytes:
        """
        Build one frame with interleaved groups and BGR channel order.

        Group size = 8 × controllerCount. Each LED uses 3 consecutive groups
        (B, G, R). Within each controller's 8-byte block, port N (1-based
        within that controller) maps to byte position (8 - N).

        Universe uid maps to: controller = uid // 8, local port = (uid % 8) + 1,
        byte offset within group = controller * 8 + (7 - uid % 8).

        Values are gamma-corrected (gamma 2.2) before writing.
        """
        max_leds = self.max_leds_per_port
        grp_size = self.group_size
        frame_bytes = max_leds * 3 * grp_size
        buf = bytearray(frame_bytes)

        for uid in range(self.num_universes):
            num_leds = self._universes[uid]
            rgb = self._pixel_data[uid][frame_idx]  # (num_leds, 3)
            # controller index × 8 + (7 - local port index)
            ctrl_idx = uid // PORTS_PER_CONTROLLER
            local_port = uid % PORTS_PER_CONTROLLER
            byte_pos = ctrl_idx * PORTS_PER_CONTROLLER + (7 - local_port)

            for led in range(num_leds):
                r, g, b = int(rgb[led, 0]), int(rgb[led, 1]), int(rgb[led, 2])

                # 3 groups per LED: B, G, R (each group is grp_size bytes)
                group_base = led * 3 * grp_size
                buf[group_base + byte_pos] = GAMMA_LUT[b]                          # B group
                buf[group_base + grp_size + byte_pos] = GAMMA_LUT[g]               # G group
                buf[group_base + 2 * grp_size + byte_pos] = GAMMA_LUT[r]           # R group

        return bytes(buf)

    def __repr__(self) -> str:
        parts = ", ".join(f"u{i}={n}" for i, n in enumerate(self._universes))
        return f"DATFile(universes=[{parts}], frames={self._num_frames})"
