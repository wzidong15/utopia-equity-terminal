"""Official STOCK Act PTR trades: House Clerk ZIP/PDFs + Senate eFD.

Cached under ~/.zintopia (or ZINTOPIA_DATA_DIR). Deep analysis reads the cache;
refresh runs in a background thread so ticker lookups stay fast.
"""

from __future__ import annotations

import csv
import io
import json
import logging
import os
import re
import threading
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
from pypdf import PdfReader

log = logging.getLogger("congress_ptr")

HOUSE_ZIP = "https://disclosures-clerk.house.gov/public_disc/financial-pdfs/{year}FD.zip"
HOUSE_PDF = "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/{year}/{doc_id}.pdf"
SENATE_HOME = "https://efdsearch.senate.gov/search/home/"
SENATE_SEARCH = "https://efdsearch.senate.gov/search/"
SENATE_DATA = "https://efdsearch.senate.gov/search/report/data/"
SENATE_ORIGIN = "https://efdsearch.senate.gov"

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
CACHE_VERSION = 1
LOOKBACK_DAYS = 120
TTL_SEC = 12 * 3600

_house_tx_re = re.compile(
    r"\(([A-Z]{1,5}(?:[.-][A-Z]{1,2})?)\)\s*\[([A-Z]{1,6})\]\s*"
    r"([PSE])\s+(\d{2}/\d{2}/\d{4})(\d{2}/\d{2}/\d{4})\s*"
    r"(\$[\d,]+\s*(?:-\s*\$[\d,]+(?:\+)?)?)",
    re.S,
)
_ticker_in_name_re = re.compile(r"\(([A-Z]{1,5}(?:[.-][A-Z]{1,2})?)\)")
_lock = threading.Lock()
_refreshing = False
_thread: threading.Thread | None = None

HOUSE_TYPE = {"P": "Purchase", "S": "Sale", "E": "Exchange"}


def _data_dir() -> Path:
    override = (
        os.environ.get("ZINTOPIA_DATA_DIR")
        or os.environ.get("FINTOPIA_DATA_DIR")
        or os.environ.get("UTOPIA_DATA_DIR")
        or ""
    ).strip()
    if override:
        return Path(override).expanduser().resolve()
    new = Path.home() / ".zintopia"
    old = Path.home() / ".fintopia"
    if not new.exists() and old.exists():
        try:
            old.rename(new)
        except OSError:
            return old
    return new


def _cache_path() -> Path:
    return _data_dir() / "congress_ptr.json"


def _docs_path() -> Path:
    return _data_dir() / "congress_ptr_house_docs.json"


def _ttl_sec() -> float:
    raw = (os.environ.get("ZINTOPIA_CONGRESS_TTL_SEC") or os.environ.get("FINTOPIA_CONGRESS_TTL_SEC") or "").strip()
    if raw.isdigit():
        return float(raw)
    return float(TTL_SEC)


def _lookback_days() -> int:
    raw = (os.environ.get("ZINTOPIA_CONGRESS_LOOKBACK_DAYS") or os.environ.get("FINTOPIA_CONGRESS_LOOKBACK_DAYS") or "").strip()
    if raw.isdigit():
        return max(30, int(raw))
    return LOOKBACK_DAYS


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _mdy_to_iso(value: str) -> str | None:
    text = (value or "").strip()
    for fmt in ("%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return text
    return None


def _parse_mdy(value: str) -> date | None:
    iso = _mdy_to_iso(value)
    if not iso:
        return None
    return date.fromisoformat(iso)


def _clean_amount(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip())


def _ticker_aliases(symbol: str) -> set[str]:
    needle = symbol.strip().upper().split(":")[-1]
    if not needle:
        return set()
    return {needle, needle.replace("-", "."), needle.replace(".", "-")}


def _empty_payload(status: str = "empty", note: str | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {
        "buy_count": 0,
        "sell_count": 0,
        "tilt": "neutral",
        "items": [],
        "source": "House Clerk + Senate eFD",
        "status": status,
    }
    if note:
        out["note"] = note
    return out


def _read_json(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text())
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2))
    tmp.replace(path)


def _cache_age_sec(cache: dict[str, Any]) -> float | None:
    built = cache.get("built_at")
    if not built:
        return None
    try:
        ts = datetime.fromisoformat(str(built).replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - ts).total_seconds()
    except Exception:
        return None


def kick_refresh(force: bool = False) -> None:
    """Start a background rebuild if the cache is missing or stale."""
    global _refreshing, _thread
    cache = _read_json(_cache_path())
    age = _cache_age_sec(cache)
    fresh = bool(cache.get("trades")) and age is not None and age < _ttl_sec()
    if fresh and not force:
        return
    with _lock:
        if _refreshing:
            return
        _refreshing = True
        _thread = threading.Thread(target=_refresh_safe, name="congress-ptr", daemon=True)
        _thread.start()


def _refresh_safe() -> None:
    global _refreshing
    try:
        _refresh()
    except Exception:
        log.exception("Congress PTR refresh failed")
    finally:
        with _lock:
            _refreshing = False


def _refresh() -> None:
    cutoff = date.today() - timedelta(days=_lookback_days())
    notes: list[str] = []
    senate_trades: list[dict[str, Any]] = []
    try:
        senate_trades = _fetch_senate(cutoff)
        _persist_cache(senate_trades, notes, house_index_date=None, status="refreshing")
    except Exception as e:
        log.warning("Senate eFD refresh failed: %s", e)
        notes.append(f"Senate eFD unavailable ({e})")

    house_trades: list[dict[str, Any]] = []
    house_index_date = None
    try:
        house_trades, house_index_date = _fetch_house(cutoff)
    except Exception as e:
        log.warning("House Clerk refresh failed: %s", e)
        notes.append(f"House Clerk unavailable ({e})")

    _persist_cache(senate_trades + house_trades, notes, house_index_date, status="ready")


def _persist_cache(
    trades: list[dict[str, Any]],
    notes: list[str],
    house_index_date: str | None,
    status: str,
) -> None:
    trades = sorted(trades, key=lambda t: t.get("filed") or t.get("tx_date") or "", reverse=True)
    filed_dates = [t.get("filed") for t in trades if t.get("filed")]
    sources = []
    if any(t.get("chamber") == "House" for t in trades):
        sources.append("House Clerk")
    if any(t.get("chamber") == "Senate" for t in trades):
        sources.append("Senate eFD")
    payload = {
        "version": CACHE_VERSION,
        "built_at": _now_iso(),
        "house_index_date": house_index_date,
        "filed_through": max(filed_dates) if filed_dates else None,
        "lookback_days": _lookback_days(),
        "source": " + ".join(sources) if sources else "House Clerk + Senate eFD",
        "status": "ready" if trades and status == "ready" else status if trades else "empty",
        "note": "; ".join(notes) if notes else None,
        "trade_count": len(trades),
        "trades": trades,
    }
    _write_json(_cache_path(), payload)


def _headers(accept: str = "text/html") -> dict[str, str]:
    return {"User-Agent": UA, "Accept": accept, "Origin": SENATE_ORIGIN}


def _fetch_senate(cutoff: date) -> list[dict[str, Any]]:
    start = cutoff.strftime("%m/%d/%Y")
    end = date.today().strftime("%m/%d/%Y")
    trades: list[dict[str, Any]] = []
    with httpx.Client(timeout=40.0, follow_redirects=True, headers=_headers()) as client:
        home = client.get(SENATE_HOME)
        home.raise_for_status()
        token_m = re.search(r'name="csrfmiddlewaretoken"\s+value="([^"]+)"', home.text)
        if not token_m:
            raise RuntimeError("Senate eFD CSRF token missing")
        agr = client.post(
            SENATE_HOME,
            data={"csrfmiddlewaretoken": token_m.group(1), "prohibition_agreement": "1"},
            headers={**_headers(), "Referer": SENATE_HOME},
        )
        agr.raise_for_status()
        token2 = re.search(r'name="csrfmiddlewaretoken"\s+value="([^"]+)"', agr.text)
        csrf = (token2.group(1) if token2 else None) or client.cookies.get("csrftoken")
        posted = client.post(
            SENATE_SEARCH,
            data={
                "csrfmiddlewaretoken": csrf or "",
                "first_name": "",
                "last_name": "",
                "filer_type": "1",
                "report_type": "11",
                "submitted_start_date": start,
                "submitted_end_date": end,
            },
            headers={**_headers(), "Referer": SENATE_SEARCH},
        )
        posted.raise_for_status()
        csrf = client.cookies.get("csrftoken") or csrf
        reports = _senate_report_rows(client, csrf or "", start, end)
        for row in reports:
            href = row["href"]
            person = row["person"]
            filed = row["filed"]
            try:
                page = client.get(f"{SENATE_ORIGIN}{href}")
                page.raise_for_status()
            except Exception as e:
                log.debug("Senate PTR %s failed: %s", href, e)
                continue
            for tx in _parse_senate_ptr_html(page.text):
                tx.update(
                    {
                        "chamber": "Senate",
                        "person": person,
                        "filed": filed,
                        "link": f"{SENATE_ORIGIN}{href}",
                        "source": "efdsearch.senate.gov",
                    }
                )
                trades.append(tx)
    return trades


def _senate_report_rows(client: httpx.Client, csrf: str, start: str, end: str) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    start_idx = 0
    page_len = 100
    while True:
        payload = {
            "draw": "1",
            "start": str(start_idx),
            "length": str(page_len),
            "report_types": "[11]",
            "filer_types": "[1]",
            "submitted_start_date": f"{start} 00:00:00",
            "submitted_end_date": f"{end} 23:59:59",
            "candidate_state": "",
            "senator_state": "",
            "office_id": "",
            "first_name": "",
            "last_name": "",
            "order[0][column]": "4",
            "order[0][dir]": "desc",
            "search[value]": "",
            "search[regex]": "false",
        }
        for i in range(5):
            payload[f"columns[{i}][data]"] = str(i)
            payload[f"columns[{i}][name]"] = ""
            payload[f"columns[{i}][searchable]"] = "true"
            payload[f"columns[{i}][orderable]"] = "true"
            payload[f"columns[{i}][search][value]"] = ""
            payload[f"columns[{i}][search][regex]"] = "false"
        r = client.post(
            SENATE_DATA,
            data=payload,
            headers={
                **_headers("application/json, text/javascript, */*; q=0.01"),
                "Referer": SENATE_SEARCH,
                "X-CSRFToken": csrf,
                "X-Requested-With": "XMLHttpRequest",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            },
        )
        r.raise_for_status()
        body = r.json()
        data = body.get("data") or []
        if not isinstance(data, list):
            break
        for item in data:
            if not isinstance(item, list) or len(item) < 5:
                continue
            href_m = re.search(r'href="(/search/view/(?:ptr|paper)/[^"]+)"', str(item[3]))
            if not href_m:
                continue
            first = str(item[0] or "").strip()
            last = str(item[1] or "").strip()
            office = str(item[2] or "").strip()
            person = office if "Senator" in office or "," in office else " ".join(p for p in (first, last) if p)
            rows.append(
                {
                    "href": href_m.group(1),
                    "person": person or f"{last}, {first}".strip(", "),
                    "filed": _mdy_to_iso(str(item[4] or "")) or "",
                }
            )
        start_idx += page_len
        total = int(body.get("recordsFiltered") or body.get("recordsTotal") or 0)
        if start_idx >= total or not data:
            break
    return rows


def _parse_senate_ptr_html(html: str) -> list[dict[str, Any]]:
    m = re.search(r"List of transactions.*?<tbody>(.*?)</tbody>", html, re.S | re.I)
    if not m:
        return []
    out: list[dict[str, Any]] = []
    for row in re.findall(r"<tr>(.*?)</tr>", m.group(1), re.S):
        tds = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
        texts = [" ".join(re.sub(r"<[^>]+>", "", td).split()) for td in tds]
        if len(texts) < 8:
            continue
        ticker = texts[3].strip()
        asset = texts[4]
        if ticker in {"", "--", "—"}:
            name_m = _ticker_in_name_re.search(asset)
            ticker = name_m.group(1) if name_m else ""
        ticker = ticker.upper().replace("—", "").strip()
        if not ticker or ticker in {"--", "N/A"}:
            continue
        kind = texts[6]
        out.append(
            {
                "ticker": ticker,
                "tx_date": _mdy_to_iso(texts[1]),
                "type": kind,
                "amount": texts[7],
                "asset": asset,
            }
        )
    return out


def _fetch_house(cutoff: date) -> tuple[list[dict[str, Any]], str | None]:
    years = sorted({cutoff.year, date.today().year})
    filings: list[dict[str, Any]] = []
    index_date = None
    docs: dict[str, Any] = {}
    with httpx.Client(timeout=60.0, follow_redirects=True, headers={"User-Agent": UA}) as client:
        for year in years:
            z = client.get(HOUSE_ZIP.format(year=year))
            z.raise_for_status()
            lm = z.headers.get("last-modified")
            if lm:
                index_date = lm
            with zipfile.ZipFile(io.BytesIO(z.content)) as zf:
                name = next((n for n in zf.namelist() if n.lower().endswith(".txt")), None)
                if not name:
                    continue
                text = zf.read(name).decode("utf-8-sig", errors="replace")
            filings.extend(_parse_house_index(text, year, cutoff))
        filings.sort(key=lambda f: f.get("filed") or "", reverse=True)
        filings = filings[:150]
        known = _read_json(_docs_path())
        docs = dict(known.get("docs") or {}) if isinstance(known.get("docs"), dict) else {}
        todo = [f for f in filings if str(f["doc_id"]) not in docs]
        if todo:
            with ThreadPoolExecutor(max_workers=4) as pool:
                futs = {pool.submit(_download_house_pdf, f): f for f in todo}
                completed = 0
                for fut in as_completed(futs):
                    rec = futs[fut]
                    key = str(rec["doc_id"])
                    try:
                        docs[key] = fut.result()
                    except Exception as e:
                        log.debug("House PDF %s failed: %s", key, e)
                        docs[key] = []
                    completed += 1
                    if completed % 10 == 0:
                        _write_json(_docs_path(), {"updated_at": _now_iso(), "docs": docs})
            _write_json(_docs_path(), {"updated_at": _now_iso(), "docs": docs})
    trades: list[dict[str, Any]] = []
    wanted = {str(f["doc_id"]) for f in filings}
    meta = {str(f["doc_id"]): f for f in filings}
    for doc_id, rows in docs.items():
        if doc_id not in wanted:
            continue
        rec = meta.get(doc_id) or {}
        for tx in rows or []:
            item = dict(tx)
            item.update(
                {
                    "chamber": "House",
                    "person": rec.get("person"),
                    "filed": rec.get("filed"),
                    "link": HOUSE_PDF.format(year=rec.get("year") or date.today().year, doc_id=doc_id),
                    "source": "disclosures-clerk.house.gov",
                }
            )
            trades.append(item)
    return trades, index_date


def _parse_house_index(text: str, year: int, cutoff: date) -> list[dict[str, Any]]:
    reader = csv.DictReader(io.StringIO(text), delimiter="\t")
    out: list[dict[str, Any]] = []
    for row in reader:
        if (row.get("FilingType") or "").strip() != "P":
            continue
        filed = _parse_mdy(row.get("FilingDate") or "")
        if filed is None or filed < cutoff:
            continue
        first = (row.get("First") or "").strip()
        last = (row.get("Last") or "").strip()
        out.append(
            {
                "doc_id": str(row.get("DocID") or "").strip(),
                "person": " ".join(p for p in (first, last) if p) or last,
                "filed": filed.isoformat(),
                "year": int(row.get("Year") or year),
            }
        )
    return [r for r in out if r["doc_id"]]


def _download_house_pdf(rec: dict[str, Any]) -> list[dict[str, Any]]:
    url = HOUSE_PDF.format(year=rec["year"], doc_id=rec["doc_id"])
    with httpx.Client(timeout=25.0, follow_redirects=True, headers={"User-Agent": UA}) as client:
        r = client.get(url)
        r.raise_for_status()
        if "pdf" not in (r.headers.get("content-type") or "").lower() and not r.content.startswith(b"%PDF"):
            return []
        return _parse_house_pdf_bytes(r.content)


def _parse_house_pdf_bytes(data: bytes) -> list[dict[str, Any]]:
    reader = PdfReader(io.BytesIO(data))
    raw = "".join((page.extract_text() or "") for page in reader.pages)
    clean = raw.replace("\x00", "")
    out: list[dict[str, Any]] = []
    for ticker, asset_type, kind, tx_date, _filed, amount in _house_tx_re.findall(clean):
        if asset_type != "ST":
            continue
        out.append(
            {
                "ticker": ticker.upper(),
                "tx_date": _mdy_to_iso(tx_date),
                "type": HOUSE_TYPE.get(kind, kind),
                "amount": _clean_amount(amount),
                "asset": ticker.upper(),
            }
        )
    return out


def _kind_bucket(kind: str) -> str | None:
    low = (kind or "").lower()
    if "buy" in low or "purchase" in low:
        return "buy"
    if "sell" in low or "sale" in low:
        return "sell"
    return None


def query(symbol: str) -> dict[str, Any]:
    """Return PTR trades for one ticker from the local cache, kicking a refresh if needed."""
    kick_refresh()
    cache = _read_json(_cache_path())
    aliases = _ticker_aliases(symbol)
    if not aliases:
        return _empty_payload("empty")
    trades = [t for t in (cache.get("trades") or []) if str(t.get("ticker") or "").upper() in aliases]
    trades.sort(key=lambda t: t.get("filed") or t.get("tx_date") or "", reverse=True)
    items = []
    buys = 0
    sells = 0
    for row in trades:
        bucket = _kind_bucket(str(row.get("type") or ""))
        if bucket == "buy":
            buys += 1
        elif bucket == "sell":
            sells += 1
        if len(items) < 12:
            items.append(
                {
                    "date": row.get("tx_date") or row.get("filed"),
                    "chamber": row.get("chamber"),
                    "person": row.get("person"),
                    "type": row.get("type"),
                    "amount": row.get("amount"),
                    "asset": row.get("asset"),
                    "filed": row.get("filed"),
                    "link": row.get("link"),
                }
            )
    tilt = "buy" if buys > sells else "sell" if sells > buys else "neutral"
    status = cache.get("status") or "empty"
    with _lock:
        refreshing = _refreshing
    note = cache.get("note")
    if refreshing:
        status = "refreshing"
        if not trades:
            note = note or "Updating official periodic transaction reports"
    return {
        "buy_count": buys,
        "sell_count": sells,
        "tilt": tilt,
        "items": items,
        "source": cache.get("source") or "House Clerk + Senate eFD",
        "last_updated": cache.get("built_at"),
        "filed_through": cache.get("filed_through"),
        "house_index_date": cache.get("house_index_date"),
        "status": status,
        "note": note,
    }
