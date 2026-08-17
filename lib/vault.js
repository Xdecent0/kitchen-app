// The vault speaks markdown. These parsers turn its tables and recipe notes
// into the structures the app runs on, so the reference data stays human-editable.

/** Rows of the first pipe table in a document, keyed by its header cells. */
export function parseTable(markdown) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s*\|.*\|\s*$/.test(l));
  if (start === -1) return [];

  const cells = (line) =>
    line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

  const header = cells(lines[start]);
  const rows = [];

  for (let i = start + 2; i < lines.length; i += 1) {
    const line = lines[i];
    if (!/^\s*\|.*\|\s*$/.test(line)) break;
    const values = cells(line);
    rows.push(Object.fromEntries(header.map((h, j) => [h, values[j] ?? ""])));
  }

  return rows;
}

const num = (v) => {
  const n = parseInt(String(v).replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : null;
};

export function parseShelf(markdown) {
  return parseTable(markdown)
    .filter((r) => r["продукт"])
    .map((r) => ({
      product: r["продукт"].toLowerCase(),
      zone: r["зона"] || "полка",
      closed: num(r["закрыт"]) ?? 30,
      opened: num(r["открыт"]),
    }));
}

export function parseSynonyms(markdown) {
  const rows = parseTable(markdown)
    .filter((r) => r["маска"] && r["продукт"])
    .map((r) => ({ mask: r["маска"].toUpperCase(), product: r["продукт"] }));

  const junkBlock = markdown.match(/```([\s\S]*?)```/);
  const junk = junkBlock
    ? junkBlock[1].split(/\r?\n/).map((l) => l.trim().toUpperCase()).filter(Boolean)
    : [];

  return { synonyms: rows, junk };
}

/**
 * Where things are physically kept. Four is what a flat usually has, but a
 * cellar, a balcony in winter or a second freezer are all real, so the list is
 * a table in the vault like every other reference rather than four words in the
 * source. The icon column is optional: an unknown glyph falls back to a shelf.
 */
export function parseZones(markdown) {
  return parseTable(markdown)
    .filter((r) => r["зона"])
    .map((r) => ({
      name: r["зона"].toLowerCase(),
      icon: r["значок"] || null,
      into: r["куда кладу"] || `в ${r["зона"].toLowerCase()}`,
    }));
}

export function parseAisles(markdown) {
  return parseTable(markdown)
    .filter((r) => r["отдел"])
    .map((r) => ({
      order: num(r["№"]) ?? 99,
      name: r["отдел"],
      items: (r["что внутри"] ?? "")
        .split(/[,;]/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    }));
}

/* ---------- recipes ---------- */

/** A recipe note: YAML-ish front matter, an ingredients table or list, then steps. */
export function parseRecipe(name, markdown) {
  const fm = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const meta = {};

  if (fm) {
    for (const line of fm[1].split(/\r?\n/)) {
      const m = line.match(/^([\wа-яё]+):\s*(.+)$/i);
      if (m) meta[m[1].toLowerCase()] = m[2].trim();
    }
  }

  const body = fm ? markdown.slice(fm[0].length) : markdown;

  return {
    id: `r_${slug(name)}`,
    name: meta["название"] || name,
    minutes: num(meta["время"]) ?? null,
    servings: num(meta["порции"]) ?? null,
    difficulty: meta["сложность"] ?? null,
    ingredients: parseIngredients(body),
    steps: parseSteps(body),
    source: meta["источник"] ?? null,
    note: meta["заметка"] ?? null,
  };
}

function parseIngredients(body) {
  const rows = parseTable(body);
  if (rows.length && (rows[0]["продукт"] || rows[0]["ингредиент"])) {
    return rows
      .map((r) => ({ product: r["продукт"] || r["ингредиент"], qty: r["сколько"] || r["количество"] || "" }))
      .filter((i) => i.product);
  }

  const section = body.match(/##+\s*(?:Продукты|Ингредиенты)[^\n]*\n([\s\S]*?)(?:\n##|$)/i);
  if (!section) return [];

  return section[1]
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-*+]\s*/, "").trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(.+?)\s*[—–-]\s*(.+)$/);
      return m ? { product: m[1].trim(), qty: m[2].trim() } : { product: line, qty: "" };
    });
}

function parseSteps(body) {
  const section = body.match(/##+\s*(?:Шаги|Приготовление|Как готовить)[^\n]*\n([\s\S]*?)(?:\n##|$)/i);
  if (!section) return [];

  return section[1]
    .split(/\r?\n/)
    .map((l) => l.replace(/^\d+[.)]\s*|^[-*+]\s*/, "").trim())
    .filter(Boolean);
}

export function recipeToMarkdown(recipe) {
  const lines = [
    "---",
    "тип: рецепт",
    `название: ${recipe.name}`,
    recipe.minutes ? `время: ${recipe.minutes} мин` : null,
    recipe.servings ? `порции: ${recipe.servings}` : null,
    recipe.source ? `источник: ${recipe.source}` : null,
    "теги:",
    "  - тип/рецепт",
    "  - область/быт",
    "---",
    "",
    `# ${recipe.name}`,
    "",
    "## Продукты",
    "",
    ...recipe.ingredients.map((i) => `- ${i.product}${i.qty ? ` — ${i.qty}` : ""}`),
    "",
    "## Шаги",
    "",
    ...recipe.steps.map((s, i) => `${i + 1}. ${s}`),
  ];

  if (recipe.note) lines.push("", "## Заметки", "", recipe.note);

  // The vault's rule is class plus connection: tags without links make an
  // orphan, and the gate counts it as one. A generated note knows where it
  // belongs, so it says so.
  lines.push("", "## Связано", "", "[[30 - Личное/Кухня/_index|🍳 Кухня]] · [[30 - Личное/Кухня/Справочники/Сроки|⏳ Сроки]]");

  return lines.filter((l) => l !== null).join("\n") + "\n";
}

export function slug(name) {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
}
