// Mutation operators: small, realistic one-line changes.
//   App mutants  -> the truth is "app-bug"  (the code is wrong, the tests are right)
//   Test mutants -> the truth is "test-bug" (the test is wrong, the code is right)
// Every mutant changes exactly ONE line, so we always know what the right answer is.

export type Level = "basic" | "hard";

export type Mutant = {
  id: string;
  level: Level;
  target: "app" | "test";
  truth: "app-bug" | "test-bug";
  operator: string;
  file: string;
  line: number; // 1-based (first line, if the change spans two lines)
  before: string; // may contain "\n" when two lines are swapped
  after: string;
};

type LineRule = { operator: string; apply: (line: string) => string[] };

// ---------- helpers ----------
// Replace each occurrence of `find` (one at a time) and return all variants.
function eachOccurrence(line: string, find: RegExp, replacer: (match: string) => string | null): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(new RegExp(find.source, find.flags.includes("g") ? find.flags : find.flags + "g"))) {
    const replacement = replacer(m[0]);
    if (replacement === null || replacement === m[0]) continue;
    out.push(line.slice(0, m.index) + replacement + line.slice(m.index! + m[0].length));
  }
  return out;
}

// Change one character of a text value so it is "almost right" (like a real typo).
function typo(value: string): string | null {
  const digit = value.search(/\d/);
  if (digit >= 0) return value.slice(0, digit) + ((Number(value[digit]) + 1) % 10) + value.slice(digit + 1);
  if (value.length < 3) return null;
  const i = Math.floor(value.length / 2);
  return value.slice(0, i - 1) + value[i] + value[i - 1] + value.slice(i + 1); // swap two letters
}

// Lines we never mutate: comments, imports, server setup, logging, blank lines and lone brackets.
function skippable(line: string): boolean {
  const t = line.trim();
  return (
    t === "" ||
    /^[{}()\[\];,]*$/.test(t) ||
    t.startsWith("//") ||
    t.startsWith("*") ||
    t.startsWith("import ") ||
    /console\.|\.listen\(|PORT|express\.(static|json)|fileURLToPath|path\.(join|dirname)|loadProducts\(\);$/.test(t)
  );
}

// ---------- app operators ----------
const APP_JS_RULES: LineRule[] = [
  {
    operator: "relational operator",
    apply: (l) =>
      /<[a-z/]/i.test(l) // skip HTML template lines
        ? []
        : eachOccurrence(l, / (===|!==|<=|>=|<|>) /, (m) => ({ " === ": " !== ", " !== ": " === ", " <= ": " < ", " >= ": " > ", " < ": " <= ", " > ": " >= " })[m] ?? null),
  },
  {
    operator: "arithmetic operator",
    apply: (l) => eachOccurrence(l, / (\+|-|\*|\/) /, (m) => ({ " + ": " - ", " - ": " + ", " * ": " / ", " / ": " * " })[m] ?? null),
  },
  {
    operator: "changed number",
    apply: (l) =>
      eachOccurrence(l, /(?<![\w.$#-])\d+(\.\d+)?(?![\w.])/, (m) => {
        if (m.includes(".")) return m.endsWith("0") ? m.slice(0, -1) + "5" : m + "0"; // 0.1 -> 0.10 is equal, so 12.5 -> 12.50 is skipped below
        return String(Number(m) + 1);
      }).filter((v) => {
        // drop "equivalent" number changes like 12.5 -> 12.50
        const nums = (s: string) => (s.match(/\d+(\.\d+)?/g) ?? []).map(Number).join(",");
        return nums(v) !== nums(l);
      }),
  },
  { operator: "flipped boolean", apply: (l) => eachOccurrence(l, /\b(true|false)\b/, (m) => (m === "true" ? "false" : "true")) },
  {
    operator: "negated condition",
    apply: (l) => {
      const m = l.match(/^(\s*(?:\} else )?if \()(.+)(\) .*)$/);
      return m ? [`${m[1]}!(${m[2]})${m[3]}`] : [];
    },
  },
  {
    operator: "removed statement",
    apply: (l) => (/^\s*[\w$.()[\]"'-]+\(.*\);\s*$/.test(l) && !/^\s*(const|let|var|return)\b/.test(l) ? [l.replace(/\S.*$/, "// (removed)")] : []),
  },
  {
    operator: "changed message",
    apply: (l) => eachOccurrence(l, /"[A-Z][^"]*\s[^"]*"/, (m) => `"${typo(m.slice(1, -1)) ?? m.slice(1, -1)}"`),
  },
];

// Note: renaming a data-testid in the app is NOT used. Whether that is an app bug or an
// outdated test depends on intent, so there is no single right answer to grade against.
const HTML_RULES: LineRule[] = [
  { operator: "removed label", apply: (l) => (/^\s*<label /.test(l) ? [l.replace(/\S.*$/, "")] : []) },
];

// ---------- test operators ----------
const TEST_RULES: LineRule[] = [
  { operator: "wrong selector", apply: (l) => eachOccurrence(l, /getByTestId\("[^"]+"\)/, (m) => m.replace(/"\)$/, '-old")')) },
  {
    operator: "wrong expected value",
    apply: (l) =>
      eachOccurrence(l, /(toHaveText|toContainText|toBe)\("[^"]*"\)/, (m) => {
        const value = m.slice(m.indexOf('"') + 1, m.lastIndexOf('"'));
        const changed = typo(value);
        return changed ? m.replace(`"${value}"`, `"${changed}"`) : null;
      }),
  },
  {
    operator: "wrong expected number",
    apply: (l) => eachOccurrence(l, /(toHaveCount|toHaveLength|toBe)\(\d+\)/, (m) => m.replace(/\d+/, (n) => String(Number(n) + 1))),
  },
  {
    operator: "bad test data",
    apply: (l) =>
      eachOccurrence(l, /\.fill\("[^"]+"\)/, (m) => {
        const value = m.slice(7, -2);
        if (value.includes("@")) return m.replace(/\.[a-z]+"\)$/, '")'); // drop the domain ending of an email
        const changed = typo(value);
        return changed ? `.fill("${changed}")` : null;
      }),
  },
  { operator: "wrong URL", apply: (l) => eachOccurrence(l, /request\.get\("\/api\/products/, (m) => m.replace("products", "product")) },
  {
    operator: "missing step",
    apply: (l) => (/^\s*await (page\.|addToCart|mugRow|product\.)/.test(l) && !/expect|goto/.test(l) ? [l.replace(/\S.*$/, "// (step removed)")] : []),
  },
  {
    operator: "missing wait",
    apply: (l) => {
      const m = l.match(/^(\s*)await expect\((.+)\)\.toHaveText\(("[^"]*")\);$/);
      return m ? [`${m[1]}expect(await ${m[2]}.textContent()).toBe(${m[3]});`] : [];
    },
  },
];


// ---------- HARD operators ----------
// Designed so that each mutant LOOKS LIKE the other kind of problem.

// App bugs that look like a test problem (the code is subtly wrong, the test is right)
const APP_JS_HARD: LineRule[] = [
  {
    operator: "wrong field",
    apply: (l) =>
      eachOccurrence(l, /\.(price|quantity|username|password|message)\b/, (m) =>
        ({ ".price": ".quantity", ".quantity": ".price", ".username": ".password", ".password": ".username", ".message": ".ok" })[m] ?? null
      ),
  },
  {
    operator: "boundary change",
    apply: (l) => [
      ...eachOccurrence(l, /Math\.max\(1,/, () => "Math.max(0,"),
      ...eachOccurrence(l, /\.length === 0/, () => ".length === 1"),
      ...eachOccurrence(l, /toFixed\(2\)/, () => "toFixed(1)"),
    ],
  },
  { operator: "missing await", apply: (l) => (/<[a-z/]/i.test(l) ? [] : eachOccurrence(l, /\bawait /, () => "")) },
  {
    operator: "weakened validation",
    apply: (l) => [
      ...eachOccurrence(l, /\\\.\[\^\\s@\]\+\$/, () => "$"), // email no longer needs a dot after @
      ...eachOccurrence(l, /\.toLowerCase\(\)/, () => ""), // search becomes case-sensitive again
      ...eachOccurrence(l, /\.toUpperCase\(\)/, () => ""), // discount code becomes case-sensitive
      ...eachOccurrence(l, / && u\.password === password/, () => ""), // password no longer checked
    ],
  },
];

// Test bugs that look like an app bug (the app is right, the test is subtly wrong)
function testHardRules(testIds: string[], products: string[]): LineRule[] {
  return [
    {
      operator: "checks wrong element",
      apply: (l) =>
        eachOccurrence(l, /getByTestId\("[^"]+"\)/, (m) => {
          const id = m.slice(13, -2);
          const suffix = id.split("-").at(-1);
          const other = testIds.find((t) => t !== id && t.split("-").at(-1) === suffix); // a REAL id of a similar element
          return other ? `getByTestId("${other}")` : null;
        }),
    },
    {
      operator: "wrong product used",
      apply: (l) =>
        eachOccurrence(l, /"(Coffee Mug|Desk Lamp|Notebook|Water Bottle|Headphones)"/, (m) => {
          const name = m.slice(1, -1);
          return `"${products[(products.indexOf(name) + 1) % products.length]}"`; // another product that really exists
        }),
    },
    {
      operator: "plausible wrong number",
      apply: (l) =>
        eachOccurrence(l, /toHaveText\("\$?\d+\.\d{2}"\)/, (m) => {
          const value = Number(m.match(/\d+\.\d{2}/)![0]);
          const wrong = (value * 2).toFixed(2); // what a quantity/discount bug would produce
          return m.replace(/\d+\.\d{2}/, wrong);
        }),
    },
    {
      operator: "wrong letter case",
      apply: (l) =>
        eachOccurrence(l, /\.fill\("[^"@]+"\)/, (m) => {
          const v = m.slice(7, -2);
          const flipped = v[0] === v[0].toUpperCase() ? v[0].toLowerCase() + v.slice(1) : v[0].toUpperCase() + v.slice(1);
          return flipped === v ? null : `.fill("${flipped}")`;
        }),
    },
  ];
}

// Two neighbouring statements swapped (order bug). Works on pairs of lines.
function swappedPairs(lines: string[], isStatement: (l: string) => boolean) {
  const out: { line: number; before: string; after: string }[] = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    const a = lines[i];
    const b = lines[i + 1];
    if (isStatement(a) && isStatement(b) && a.match(/^\s*/)![0] === b.match(/^\s*/)![0] && a.trim() !== b.trim()) {
      out.push({ line: i + 1, before: `${a}\n${b}`, after: `${b}\n${a}` });
    }
  }
  return out;
}
// A real statement: a call or an assignment (not a type field like "id: number;")
const appStatement = (l: string) =>
  /^\s*[\w$.()[\]"'=-]+.*;\s*$/.test(l) &&
  /\(|\s[-+*]?=\s/.test(l) &&
  !/^\s*\w+\??:\s/.test(l) &&
  !/^\s*(const|let|var|return|import)\b/.test(l) &&
  !skippable(l) &&
  !/[{}]/.test(l);
const testStep = (l: string) => /^\s*await (page\.|addToCart|mugRow|product\.)/.test(l) && !/expect|goto/.test(l);

// ---------- generate all candidates ----------
export function generateMutants(sources: Record<string, string>, level: Level = "basic"): Mutant[] {
  const mutants: Mutant[] = [];
  const testFiles = Object.keys(sources).filter((f) => f.startsWith("tests/"));
  const testIds = [...new Set(testFiles.flatMap((f) => [...sources[f].matchAll(/getByTestId\("([^"]+)"\)/g)].map((m) => m[1])))].sort();
  const products = ["Coffee Mug", "Desk Lamp", "Notebook", "Water Bottle", "Headphones"];

  const add = (m: Omit<Mutant, "id" | "level" | "truth">) =>
    mutants.push({ ...m, id: "", level, truth: m.target === "app" ? "app-bug" : "test-bug" });

  for (const [file, content] of Object.entries(sources)) {
    const isTest = file.startsWith("tests/");
    const isHtml = file.endsWith(".html");
    if (file.endsWith(".css")) continue;
    const rules =
      level === "basic"
        ? isTest ? TEST_RULES : isHtml ? HTML_RULES : APP_JS_RULES
        : isTest ? testHardRules(testIds, products) : isHtml ? [] : APP_JS_HARD;
    const lines = content.split("\n");

    // In test files only mutate inside test(...) bodies, not imports/helpers.
    const inside: boolean[] = [];
    let insideTest = !isTest;
    lines.forEach((line, i) => {
      if (isTest && /^test\(/.test(line)) insideTest = true;
      inside[i] = insideTest && !(isTest && /^test\(/.test(line));
      if (isTest && /^\}\);/.test(line)) insideTest = false;
    });

    lines.forEach((line, i) => {
      if (!inside[i] || skippable(line)) return;
      for (const rule of rules) {
        for (const after of new Set(rule.apply(line))) {
          if (after !== line) add({ target: isTest ? "test" : "app", operator: rule.operator, file, line: i + 1, before: line, after });
        }
      }
    });

    // Hard level: swapped neighbouring statements (an order bug)
    if (level === "hard" && !isHtml) {
      for (const p of swappedPairs(lines, isTest ? testStep : appStatement)) {
        if (inside[p.line - 1] && inside[p.line]) add({ target: isTest ? "test" : "app", operator: "swapped steps", file, ...p });
      }
    }
  }
  return mutants;
}

export function applyMutant(sources: Record<string, string>, m: Mutant): Record<string, string> {
  const lines = sources[m.file].split("\n");
  const span = m.before.split("\n").length; // 1 line, or 2 for swapped statements
  if (lines.slice(m.line - 1, m.line - 1 + span).join("\n") !== m.before) {
    throw new Error(`Mutant ${m.id} no longer matches ${m.file}:${m.line}`);
  }
  lines.splice(m.line - 1, span, ...m.after.split("\n"));
  return { ...sources, [m.file]: lines.join("\n") };
}

// ---------- reproducible random sampling ----------
// A seeded random generator: the same seed always picks the same mutants.
function seededRandom(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Pick `count` mutants: half app, half test, spread evenly over the operators.
export function sampleMutants(all: Mutant[], count: number, seed: number): Mutant[] {
  const random = seededRandom(seed);
  const shuffle = <T>(arr: T[]) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const picked: Mutant[] = [];
  for (const target of ["app", "test"] as const) {
    const want = target === "app" ? Math.ceil(count / 2) : Math.floor(count / 2);
    const byOperator = Map.groupBy(shuffle(all.filter((m) => m.target === target)), (m) => m.operator);
    const queues = shuffle([...byOperator.values()]);
    while (picked.filter((m) => m.target === target).length < want && queues.some((q) => q.length)) {
      for (const q of queues) {
        const next = q.shift();
        if (next && picked.filter((m) => m.target === target).length < want) picked.push(next);
      }
    }
  }
  return picked.map((m, i) => ({ ...m, id: `M${String(i + 1).padStart(3, "0")}` }));
}
