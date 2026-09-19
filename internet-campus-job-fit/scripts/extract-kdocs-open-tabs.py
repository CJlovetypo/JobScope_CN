#!/usr/bin/env python3
"""Archive WPS spreadsheet values and hyperlinks from already-open Chrome tabs.

The script talks to the local web-access CDP proxy so it reuses the user's
authenticated WPS session.  It preserves raw values and hyperlinks in separate,
resumable batches.  Downstream normalization must read these files without
modifying them.
"""

from __future__ import annotations

import argparse
import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path


def request_json(url: str, body: str | None = None, timeout: int = 120):
    data = body.encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method="POST" if data is not None else "GET",
        headers={"Content-Type": "text/plain; charset=utf-8"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def evaluate(proxy: str, target: str, source: str, retries: int = 3):
    url = f"{proxy.rstrip('/')}/eval?target={target}"
    last_error = None
    for attempt in range(retries):
        try:
            result = request_json(url, source)
            if "error" in result:
                raise RuntimeError(result["error"])
            return result.get("value")
        except Exception as exc:  # network/browser failures are resumable
            last_error = exc
            if attempt + 1 < retries:
                time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"CDP evaluation failed after {retries} attempts: {last_error}")


def safe_name(value: str) -> str:
    value = re.sub(r"[<>:\"/\\|?*\x00-\x1f]", "_", value).strip(" .")
    return value[:80] or "sheet"


def col_letter(number: int) -> str:
    output = ""
    while number:
        number, remainder = divmod(number - 1, 26)
        output = chr(65 + remainder) + output
    return output


READY_AND_PROBE = r"""
(async()=>{
  await window.WPSOpenApi.documentReadyPromise;
  await window.WPSOpenApi.cooperApiReadyPromise;
  await window.WPSOpenApi.componentReadyPromise;
  const app=window.WPSOpenApi.Application;
  const sheets=[];
  for(let i=1;i<=50;i++){
    try{
      const info=await Promise.race([
        (async()=>{const sh=await app.Worksheets(i), ur=await sh.UsedRange;
          return {idx:i,name:await sh.Name,rows:await (await ur.Rows).Count,
            cols:await (await ur.Columns).Count,hyperlinks:await (await sh.Hyperlinks).Count};})(),
        new Promise((_,reject)=>setTimeout(()=>reject(new Error('worksheet probe timeout')),3000))
      ]);
      sheets.push(info);
    }catch(e){if(sheets.length)break;throw e;}
  }
  return sheets;
})()
"""


def values_js(sheet_idx: int, address: str) -> str:
    return f"""
(async()=>{{
  const app=window.WPSOpenApi.Application;
  const sh=await app.Worksheets({sheet_idx});
  try{{await sh.Activate();}}catch(e){{}}
  return await (await app.Range({json.dumps(address)})).Value;
}})()
"""


def hyperlinks_js(sheet_idx: int, start: int, end: int) -> str:
    return f"""
(async()=>{{
  const app=window.WPSOpenApi.Application;
  const sh=await app.Worksheets({sheet_idx});
  try{{await sh.Activate();}}catch(e){{}}
  const hls=await sh.Hyperlinks, out=[];
  for(let i={start};i<={end};i++){{
    const rec={{idx:i}};
    try{{
      const hl=await hls.Item(i);
      try{{rec.address=await hl.Address;}}catch(e){{rec.address_err=e.message;}}
      try{{rec.text=await hl.TextToDisplay;}}catch(e){{rec.text_err=e.message;}}
      try{{const r=await hl.Range;rec.row=await r.Row;rec.col=await r.Column;}}
      catch(e){{rec.range_err=e.message;}}
    }}catch(e){{rec.item_err=e.message;}}
    out.push(rec);
  }}
  return out;
}})()
"""


def find_target(proxy: str, url: str) -> str:
    targets = request_json(f"{proxy.rstrip('/')}/targets")
    wanted = url.rstrip("/")
    for target in targets:
        if target.get("type") == "page" and target.get("url", "").split("?", 1)[0].rstrip("/") == wanted:
            return target["targetId"]
    created = request_json(f"{proxy.rstrip('/')}/new", url)
    target = created.get("targetId") or created.get("id")
    if not target:
        raise RuntimeError(f"Could not open WPS document: {url}; response={created}")
    time.sleep(8)
    return target


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path, help="JSON list with tag/title/url")
    parser.add_argument("output", type=Path)
    parser.add_argument("--proxy", default="http://localhost:3456")
    parser.add_argument("--chunk", type=int, default=500)
    parser.add_argument("--hyperlinks-batch", type=int, default=200)
    args = parser.parse_args()

    documents = json.loads(args.manifest.read_text(encoding="utf-8-sig"))
    args.output.mkdir(parents=True, exist_ok=True)
    workbook_manifest = []

    for document in documents:
        print(f"[open] {document['title']} {document['url']}", flush=True)
        target = find_target(args.proxy, document["url"])
        sheets = evaluate(args.proxy, target, READY_AND_PROBE)
        doc_dir = args.output / safe_name(document["tag"])
        doc_meta = {**document, "target_id": target, "sheets": sheets, "captured_at": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
        write_json(doc_dir / "_workbook.json", doc_meta)
        workbook_manifest.append(doc_meta)

        for sheet in sheets:
            # Preserve the dimensions in workbook metadata, but skip WPS-reserved
            # and truly empty placeholder sheets from batch extraction.
            if sheet["name"].startswith("WpsReserved_") or (
                sheet["rows"] <= 1 and sheet["cols"] <= 1 and sheet["hyperlinks"] == 0
            ):
                continue
            sheet_tag = f"sheet-{sheet['idx']:02d}-{safe_name(sheet['name'])}"
            sheet_dir = doc_dir / sheet_tag
            chunks_dir = sheet_dir / "chunks"
            links_dir = sheet_dir / "hyperlinks"
            chunks_dir.mkdir(parents=True, exist_ok=True)
            links_dir.mkdir(parents=True, exist_ok=True)
            meta = {
                "url": document["url"], "document_tag": document["tag"],
                "document_title": document["title"], "sheet_idx": sheet["idx"],
                "sheet_name": sheet["name"], "rows": sheet["rows"], "cols": sheet["cols"],
                "hyperlinks_count": sheet["hyperlinks"], "chunk_size": args.chunk,
                "hyperlinks_batch": args.hyperlinks_batch, "all_sheets_in_workbook": sheets,
                "started_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            }
            write_json(sheet_dir / "_meta.json", meta)
            print(f"  [sheet] {sheet['idx']} {sheet['name']} {sheet['rows']}x{sheet['cols']} links={sheet['hyperlinks']}", flush=True)

            for start in range(1, sheet["rows"] + 1, args.chunk):
                end = min(start + args.chunk - 1, sheet["rows"])
                output = chunks_dir / f"chunk_{start:06d}_{end:06d}.json"
                if output.exists():
                    continue
                address = f"A{start}:{col_letter(sheet['cols'])}{end}"
                write_json(output, evaluate(args.proxy, target, values_js(sheet["idx"], address)))
                print(f"    [values] {address}", flush=True)

            for start in range(1, sheet["hyperlinks"] + 1, args.hyperlinks_batch):
                end = min(start + args.hyperlinks_batch - 1, sheet["hyperlinks"])
                output = links_dir / f"batch_{start:06d}_{end:06d}.json"
                if output.exists():
                    continue
                write_json(output, evaluate(args.proxy, target, hyperlinks_js(sheet["idx"], start, end)))
                print(f"    [links] {start}-{end}", flush=True)

            meta["completed_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
            write_json(sheet_dir / "_meta.json", meta)

    write_json(args.output / "manifest.json", workbook_manifest)
    print(f"[done] {len(workbook_manifest)} workbooks -> {args.output}", flush=True)


if __name__ == "__main__":
    main()
