// Every language of the dashboard has every word: the dictionaries in web/src/i18n.ts have the same keys, no empty
// value, and the same {placeholders} as English.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "src", "i18n.ts"), "utf8");

function dictionary(name) {
  const start = source.search(new RegExp(`const ${name}(: Dict)? = \\{`));
  assert.ok(start >= 0, `dictionary ${name}`);
  const body = source.slice(source.indexOf("{", start) + 1, source.indexOf("\n};", start));
  return Object.fromEntries([...body.matchAll(/^\s*"([^"]+)":\s*"((?:[^"\\]|\\.)*)",?$/gm)].map((m) => [m[1], m[2]]));
}

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("every language has every key with the same placeholders", () => {
  const en = dictionary("en");
  assert.ok(Object.keys(en).length > 150);
  for (const lang of ["vi", "ja", "ko", "zh"]) {
    const dict = dictionary(lang);
    assert.deepEqual(Object.keys(dict).sort(), Object.keys(en).sort(), `${lang} keys`);
    for (const [key, value] of Object.entries(dict)) {
      assert.notEqual(value.trim(), "", `${lang} ${key} is empty`);
      assert.deepEqual(placeholders(value), placeholders(en[key]), `${lang} ${key} placeholders`);
    }
  }
});
