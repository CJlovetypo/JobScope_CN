#!/usr/bin/env python3
"""Report URL-looking cell text not represented by WPS hyperlink objects."""

from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path


URL_RE = re.compile(r"https?://[^\s<>\"']+")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("artifact", type=Path)
    args = parser.parse_args()
    indexed: set[str] = set()
    with (args.artifact / "derived" / "all-link-occurrences.csv").open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            indexed.add(row["url_original"])
            indexed.add(row["url_normalized"])
    found = []
    for file in (args.artifact / "raw").rglob("chunk_*.json"):
        data = json.loads(file.read_text(encoding="utf-8-sig"))
        for row_index, row in enumerate(data, start=1):
            for column_index, value in enumerate(row if isinstance(row, list) else [], start=1):
                for url in URL_RE.findall(str(value or "")):
                    found.append((str(file), row_index, column_index, url.rstrip("),.，。；;")))
    missing = [row for row in found if row[3] not in indexed]
    print(json.dumps({
        "text_url_occurrences": len(found),
        "text_url_unique": len({row[3] for row in found}),
        "not_in_hyperlink_index_occurrences": len(missing),
        "not_in_hyperlink_index_unique": len({row[3] for row in missing}),
        "samples": missing[:20],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
