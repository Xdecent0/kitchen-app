"""Answer every pending job the app left in Задания/вход.

Three kinds exist: fetching a fiscal receipt from its QR link, running OCR over a
photographed receipt, and pulling a recipe off a web page. Each writes one answer
file and deletes its request, so a rerun never repeats work.
"""

from __future__ import annotations

import base64
import io
import json
import os
import re
import sys
import traceback
from pathlib import Path

import requests
from bs4 import BeautifulSoup

IN_DIR = Path("Задания/вход")
OUT_DIR = Path("Задания/выход")
TIMEOUT = 25
UA = "Mozilla/5.0 (compatible; kitchen-bot/1.0)"


# --------------------------------------------------------------------------- #
# receipts from a fiscal QR
# --------------------------------------------------------------------------- #

def fetch_receipt_qr(payload: dict) -> dict:
    url = payload.get("url", "").strip()
    if not url.startswith("http"):
        raise ValueError("в QR не ссылка — этот чек придётся снять фотографией")

    res = requests.get(url, timeout=TIMEOUT, headers={"User-Agent": UA})
    res.raise_for_status()

    body = res.text
    if body.lstrip().startswith("{"):
        return parse_receipt_json(res.json())
    return parse_receipt_html(body)


def parse_receipt_json(data: dict) -> dict:
    """Some tax services answer JSON directly; field names differ by country."""
    doc = data
    for key in ("document", "receipt", "content", "ticket"):
        if isinstance(doc.get(key), dict):
            doc = doc[key]

    raw_items = doc.get("items") or doc.get("positions") or doc.get("goods") or []
    lines = []

    for raw in raw_items:
        name = raw.get("name") or raw.get("nm") or raw.get("productName")
        if not name:
            continue
        lines.append(
            {
                "name": str(name).strip(),
                "qty": normalize_qty(raw.get("quantity") or raw.get("qty")),
                "price": normalize_price(raw.get("sum") or raw.get("price") or raw.get("total")),
            }
        )

    return {
        "lines": lines,
        "store": (doc.get("user") or doc.get("retailPlace") or doc.get("seller") or "магазин"),
        "total": normalize_price(doc.get("totalSum") or doc.get("total")),
    }


def parse_receipt_html(body: str) -> dict:
    """Fallback: read the printed table the tax cabinet renders for humans."""
    soup = BeautifulSoup(body, "lxml")
    lines = []

    for row in soup.select("tr"):
        cells = [c.get_text(" ", strip=True) for c in row.select("td")]
        if len(cells) < 2:
            continue

        name = cells[0]
        if not name or len(name) < 3 or looks_like_total(name):
            continue

        price = next((normalize_price(c) for c in reversed(cells[1:]) if normalize_price(c)), None)
        qty = next((c for c in cells[1:] if re.search(r"\d\s*(шт|кг|г|л|мл)", c, re.I)), None)
        lines.append({"name": name, "qty": qty, "price": price})

    store = ""
    title = soup.find(["h1", "h2", "title"])
    if title:
        store = title.get_text(" ", strip=True)[:60]

    if not lines:
        raise ValueError("страница чека не содержит позиций — возможно, магазин их не публикует")

    return {"lines": lines, "store": store or "магазин", "total": None}


def looks_like_total(text: str) -> bool:
    lowered = text.lower()
    return any(word in lowered for word in ("итого", "сума", "сумма", "разом", "к оплате", "решта", "сдача"))


# --------------------------------------------------------------------------- #
# receipts from a photo
# --------------------------------------------------------------------------- #

def fetch_receipt_ocr(payload: dict) -> dict:
    from PIL import Image, ImageOps
    import pytesseract

    blob = base64.b64decode(payload["image"])
    image = Image.open(io.BytesIO(blob))

    # Till paper is low contrast and often skewed; grayscale plus autocontrast
    # is the cheapest thing that reliably lifts recognition.
    image = ImageOps.autocontrast(ImageOps.grayscale(image))

    text = pytesseract.image_to_string(image, lang="ukr+rus", config="--psm 6")
    lines = []

    for raw in text.splitlines():
        line = raw.strip()
        if len(line) < 4 or looks_like_total(line):
            continue

        price_match = re.search(r"(\d+[.,]\d{2})\s*$", line)
        price = normalize_price(price_match.group(1)) if price_match else None
        name = line[: price_match.start()].strip() if price_match else line

        name = re.sub(r"\s{2,}", " ", name)
        if len(name) < 3:
            continue

        lines.append({"name": name, "qty": None, "price": price})

    if not lines:
        raise ValueError("на фото не удалось разобрать ни одной строки — попробуй снять ровнее и ближе")

    return {"lines": lines, "store": "по фото", "total": None}


# --------------------------------------------------------------------------- #
# recipes from a page
# --------------------------------------------------------------------------- #

def fetch_recipe(payload: dict) -> dict:
    url = payload.get("url", "").strip()
    if not url.startswith("http"):
        raise ValueError("нужна ссылка на страницу с рецептом")

    res = requests.get(url, timeout=TIMEOUT, headers={"User-Agent": UA})
    res.raise_for_status()
    soup = BeautifulSoup(res.text, "lxml")

    data = find_recipe_schema(soup)
    if data:
        name = data.get("name") or "Рецепт"
        ingredients = [str(i).strip() for i in data.get("recipeIngredient", []) if str(i).strip()]
        steps = extract_schema_steps(data.get("recipeInstructions"))
        minutes = parse_iso_minutes(data.get("totalTime") or data.get("cookTime"))
    else:
        name, ingredients, steps, minutes = scrape_recipe(soup)

    if not ingredients:
        raise ValueError("на странице не нашлось списка продуктов")

    return {"name": name, "markdown": to_markdown(name, minutes, url, ingredients, steps)}


def find_recipe_schema(soup: BeautifulSoup):
    """schema.org/Recipe is the only reliable structure recipe sites agree on."""
    for tag in soup.select('script[type="application/ld+json"]'):
        try:
            payload = json.loads(tag.string or "{}")
        except (json.JSONDecodeError, TypeError):
            continue

        for node in flatten_schema(payload):
            types = node.get("@type")
            types = types if isinstance(types, list) else [types]
            if "Recipe" in types:
                return node
    return None


def flatten_schema(node):
    if isinstance(node, list):
        for entry in node:
            yield from flatten_schema(entry)
    elif isinstance(node, dict):
        yield node
        for key in ("@graph", "mainEntity", "itemListElement"):
            if key in node:
                yield from flatten_schema(node[key])


def extract_schema_steps(instructions) -> list[str]:
    if not instructions:
        return []
    if isinstance(instructions, str):
        return [s.strip() for s in re.split(r"(?<=[.!?])\s+", instructions) if s.strip()]

    steps = []
    for entry in instructions:
        if isinstance(entry, str):
            steps.append(entry.strip())
        elif isinstance(entry, dict):
            if entry.get("itemListElement"):
                steps.extend(extract_schema_steps(entry["itemListElement"]))
            elif entry.get("text"):
                steps.append(str(entry["text"]).strip())
    return [s for s in steps if s]


def scrape_recipe(soup: BeautifulSoup):
    name = soup.find("h1")
    name = name.get_text(" ", strip=True) if name else "Рецепт"

    ingredients = []
    for heading in soup.find_all(re.compile("^h[2-4]$")):
        if re.search(r"ингредиент|продукт|склад", heading.get_text(), re.I):
            block = heading.find_next(["ul", "ol"])
            if block:
                ingredients = [li.get_text(" ", strip=True) for li in block.find_all("li")]
                break

    steps = []
    for heading in soup.find_all(re.compile("^h[2-4]$")):
        if re.search(r"приготовл|шаг|способ", heading.get_text(), re.I):
            block = heading.find_next(["ol", "ul"])
            if block:
                steps = [li.get_text(" ", strip=True) for li in block.find_all("li")]
                break

    return name, ingredients, steps, None


def to_markdown(name, minutes, source, ingredients, steps) -> str:
    head = ["---", "тип: рецепт", f"название: {name}"]
    if minutes:
        head.append(f"время: {minutes} мин")
    head += [f"источник: {source}", "теги:", "  - тип/рецепт", "  - область/быт", "---", ""]

    body = [f"# {name}", "", "## Продукты", ""]
    body += [f"- {i}" for i in ingredients]

    if steps:
        body += ["", "## Шаги", ""]
        body += [f"{n}. {s}" for n, s in enumerate(steps, 1)]

    return "\n".join(head + body) + "\n"


def parse_iso_minutes(value) -> int | None:
    if not value or not isinstance(value, str):
        return None
    match = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?", value)
    if not match:
        return None
    hours, minutes = match.groups()
    return (int(hours or 0) * 60) + int(minutes or 0) or None


# --------------------------------------------------------------------------- #
# shared helpers
# --------------------------------------------------------------------------- #

def normalize_price(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        # Fiscal APIs report kopecks; anything above a plausible rouble price is one.
        return round(value / 100, 2) if value > 10000 else round(float(value), 2)

    text = re.sub(r"[^\d,.]", "", str(value)).replace(",", ".")
    try:
        return round(float(text), 2)
    except ValueError:
        return None


def normalize_qty(value):
    if value in (None, ""):
        return None
    return str(value).strip()


HANDLERS = {
    "receipt-qr": fetch_receipt_qr,
    "receipt-ocr": fetch_receipt_ocr,
    "import-recipe": fetch_recipe,
}


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if not IN_DIR.exists():
        print("нет входящих заданий")
        return 0

    pending = sorted(IN_DIR.glob("*.json"))
    if not pending:
        print("нет входящих заданий")
        return 0

    for path in pending:
        job = json.loads(path.read_text(encoding="utf-8"))
        job_id = job.get("id") or path.stem
        handler = HANDLERS.get(job.get("kind"))

        if handler is None:
            answer = {"id": job_id, "error": f"неизвестный вид задания: {job.get('kind')}"}
        else:
            try:
                answer = {"id": job_id, **handler(job.get("payload") or {})}
                print(f"{job_id}: готово")
            except Exception as err:  # noqa: BLE001 — the answer file is the error channel
                answer = {"id": job_id, "error": str(err)}
                print(f"{job_id}: {err}", file=sys.stderr)
                traceback.print_exc()

        (OUT_DIR / f"{job_id}.json").write_text(
            json.dumps(answer, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        path.unlink()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
