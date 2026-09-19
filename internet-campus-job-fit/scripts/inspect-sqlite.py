#!/usr/bin/env python3
"""Print SQLite table schemas and sample rows for local source research."""

from __future__ import annotations

import argparse
import json
import sqlite3


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("database")
    parser.add_argument("--sample", type=int, default=1)
    parser.add_argument("--query")
    args = parser.parse_args()
    connection = sqlite3.connect(args.database)
    connection.row_factory = sqlite3.Row
    if args.query:
        print(json.dumps([dict(row) for row in connection.execute(args.query)], ensure_ascii=False, indent=2))
        return
    output = []
    for row in connection.execute("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name"):
        name = row["name"]
        samples = [dict(value) for value in connection.execute(f'SELECT * FROM "{name}" LIMIT ?', (args.sample,))]
        output.append({"name": name, "sql": row["sql"], "samples": samples})
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
