"""Command-line entry point: python -m funroads <step> [--bbox ...]"""

from __future__ import annotations

import argparse
import logging
import sys
from typing import Sequence

from .config import setup_logging, select_country

log = logging.getLogger("funroads.cli")

STEPS = ("fetch", "graph", "features", "score", "calibrate", "route", "linked", "all")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="funroads",
        description="Score mapped driving roads and build circuits, sprints and linked rides.",
    )
    parser.add_argument("step", choices=STEPS, help="pipeline step to run")
    parser.add_argument("-v", "--verbose", action="store_true")
    parser.add_argument("--country", choices=("nl", "ee"), default="nl")
    parser.add_argument(
        "--bbox",
        type=str,
        default=None,
        help="debug: restrict to min_lon,min_lat,max_lon,max_lat (WGS84)",
    )
    args = parser.parse_args(argv)

    setup_logging(args.verbose)
    select_country(args.country)

    if args.country == "ee":
        if args.bbox:
            parser.error("the Estonia adapter uses its documented national bounds, not --bbox")
        from . import estonia
        estonia.run(args.step)
        return 0

    bbox = None
    if args.bbox:
        parts = [float(x) for x in args.bbox.split(",")]
        if len(parts) != 4:
            log.error("--bbox needs four comma-separated numbers")
            return 2
        bbox = tuple(parts)
        log.warning("bbox filter active: %s (smoke/debug mode)", bbox)

    steps: list[str] = list(STEPS[:-1]) if args.step == "all" else [args.step]
    # Steps are imported lazily so a partial pipeline still runs while later
    # modules are being written or their optional dependencies are missing.
    takes_bbox = {"graph", "features"}
    for step in steps:
        log.info("=== step: %s ===", step)
        mod = __import__(f"funroads.{step}", fromlist=["run"])
        mod.run(bbox) if step in takes_bbox else mod.run()
    log.info("done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
