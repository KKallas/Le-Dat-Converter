"""
DAT file writer for H803TC / H801RC / H802RA LED controllers.

Generates .dat files compatible with LEDBuild software and Huacan LED
controller hardware. The binary format uses a 512-byte header followed
by frame data in BGR pixel order, padded to a 512-byte boundary.
"""

import os
import numpy as np
from typing import Optional


class DATFile:
    """
    LEDBuild DAT file generator.

    File structure:
        - Header: 512 bytes (magic + config, mostly zeros)
        - Frame data: (total_pixels * 3) bytes per frame, BGR order
        - Padding: zeros to align to 512-byte boundary

    Usage::

        dat = DATFile()
        dat.add_universe(400)
        dat.add_universe(400)
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
        """Number of universes."""
        return len(self._universes)

    @property
    def num_frames(self) -> int:
        """Global frame count."""
        return self._num_frames

    @property
    def total_pixels(self) -> int:
        """Total pixels across all universes."""
        return sum(self._universes)

    def universe_leds(self, universe: int) -> int:
        """LED count for a specific universe."""
        return self._universes[universe]

    # -- building the animation ---------------------------------------- #

    def add_universe(self, num_leds: int) -> int:
        """
        Add a universe with *num_leds* LEDs.

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
        """Set a single pixel's RGB colour."""
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

        with open(filename, "wb") as f:
            f.write(self._build_header(template_header))

            frame_bytes = self.total_pixels * 3
            frame_pad = (512 - frame_bytes % 512) % 512

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
        if template_header is not None:
            hdr = bytearray(template_header[:self.HEADER_SIZE])
            hdr[16] = self.num_universes & 0xFF
            hdr[17] = (self.num_universes >> 8) & 0xFF
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
        hdr[16] = self.num_universes & 0xFF
        hdr[17] = (self.num_universes >> 8) & 0xFF
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
        buf = bytearray(self.total_pixels * 3)
        offset = 0
        for uid in range(self.num_universes):
            rgb = self._pixel_data[uid][frame_idx]
            bgr = rgb[:, ::-1]
            b = bgr.tobytes()
            buf[offset:offset + len(b)] = b
            offset += self._universes[uid] * 3
        return bytes(buf)

    def __repr__(self) -> str:
        parts = ", ".join(f"u{i}={n}" for i, n in enumerate(self._universes))
        return f"DATFile(universes=[{parts}], frames={self._num_frames})"
