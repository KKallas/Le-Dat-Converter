"""
Auto-discovery registry for DAT format plugins.

Each .py file in this package that defines a ``FORMAT`` dict is
automatically registered. Use :func:`get_format` to look up by name.

Example::

    from ledat.formats import get_format
    fmt = get_format("DMX")
    header = fmt["build_header"](controller_count=2)
"""

import importlib
import pkgutil

FORMATS: list[dict] = []
_BY_NAME: dict[str, dict] = {}


def _discover() -> None:
    for _, modname, _ in pkgutil.iter_modules(__path__):
        mod = importlib.import_module(f".{modname}", __package__)
        fmt = getattr(mod, "FORMAT", None)
        if fmt is not None:
            FORMATS.append(fmt)
            _BY_NAME[fmt["name"]] = fmt


_discover()

DEFAULT_FORMAT: dict | None = _BY_NAME.get("DM1812", FORMATS[0] if FORMATS else None)


def get_format(name: str) -> dict | None:
    """Look up a format by name (case-insensitive). Returns default if not found."""
    if not name:
        return DEFAULT_FORMAT
    return _BY_NAME.get(name) or _BY_NAME.get(name.upper()) or DEFAULT_FORMAT
