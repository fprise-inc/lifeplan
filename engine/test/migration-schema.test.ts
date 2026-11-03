// 0113 の4・5・11・12: 読み取り規則（migration-rule@1.0）と用語辞書（term-dictionary@1.0）の JSON Schema と検査。
// 知らない欄・登録簿に無い ID・プログラムらしき値を断ること、過去の版の書き方の見本がいつまでも読めること、
// 公開側の規則の reads.product が null であること（CI の npm run migration:check と同じ検査）
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_DIR } from "../scripts/lib.ts";
import { checkDictionary, checkPublicFiles, checkRule, compileValidators, loadContext } from "../scripts/migrationRules.ts";

const ctx = loadContext();
const v = compileValidators();
const EX = join(REPO_DIR, "migration", "schema", "examples");
const exampleRule = () => JSON.parse(readFileSync(join(EX, "migration-rule-1.0.json"), "utf8")) as Record<string, unknown> & { reads: Record<string, unknown>; blocks: Record<string, unknown>[]; detect: Record<string, unknown> };
const exampleDict = () => JSON.parse(readFileSync(join(EX, "term-dictionary-1.0.json"), "utf8")) as Record<string, unknown> & { entries: Record<string, unknown>[] };
const rule = (f: (r: ReturnType<typeof exampleRule>) => void) => {
  const r = exampleRule();
  f(r);
  return checkRule(r, ctx, v, "rule");
};
const dict = (f: (d: ReturnType<typeof exampleDict>) => void) => {
  const d = exampleDict();
  f(d);
  return checkDictionary(d, ctx, v, "dict");
};

describe("読み取り規則と用語辞書の書き方（0113 の4・5）", () => {
  it("書き方の見本（migration-rule@1.0・term-dictionary@1.0）が読める（消さない）", () => {
    expect(checkRule(exampleRule(), ctx, v, "rule")).toEqual([]);
    expect(checkDictionary(exampleDict(), ctx, v, "dict")).toEqual([]);
  });

  it("リポジトリの公開側の規則・辞書・見本はすべて検査に通る（CI と同じ）", () => {
    expect(checkPublicFiles()).toEqual([]);
  });

  it.each([
    ["知らない欄", (r: ReturnType<typeof exampleRule>) => (r.script = "x")],
    ["知らない書き方の版", (r: ReturnType<typeof exampleRule>) => (r.contract = "migration-rule@2.0")],
    ["format が違う", (r: ReturnType<typeof exampleRule>) => (r.format = "lifeplan.termDictionary")],
    ["改訂が0", (r: ReturnType<typeof exampleRule>) => (r.revision = 0)],
    ["ID の形（大文字・1段）", (r: ReturnType<typeof exampleRule>) => (r.id = "Generic")],
    ["知らない読み手", (r: ReturnType<typeof exampleRule>) => (r.reads.readers = ["ocr"])],
    ["知らない区画の種類", (r: ReturnType<typeof exampleRule>) => r.blocks.push({ id: "x", kind: "script", anchor: { words: ["x"] } })],
    ["区画に知らない欄（座標）", (r: ReturnType<typeof exampleRule>) => ((r.blocks[0] as Record<string, unknown>).x = 10)],
    ["table の区画に物の種類が無い", (r: ReturnType<typeof exampleRule>) => delete (r.blocks[2] as Record<string, unknown>).object],
    ["見出しの言葉に式（${}）", (r: ReturnType<typeof exampleRule>) => (r.detect.anyWords = ["${process.env}", "年間収支"])],
    ["見出しの言葉に正規表現（\\d）", (r: ReturnType<typeof exampleRule>) => (r.detect.anyWords = ["\\d+年", "年間収支"])],
    ["見出しの言葉にタグ（<script>）", (r: ReturnType<typeof exampleRule>) => (r.blocks[0] = { id: "family", kind: "pairs", anchor: { words: ["<script>"] } })],
    ["名前に制御文字", (r: ReturnType<typeof exampleRule>) => (r.label = "見本\u0007")],
    ["数え方の知らない値", (r: ReturnType<typeof exampleRule>) => (r.conventions = { tableAge: "midYear" })],
    ["単位の知らない値", (r: ReturnType<typeof exampleRule>) => (r.units = { money: "億円" })],
  ])("規則の形が合わないものを断る（%s）", (_name, f) => {
    const problems = rule(f);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("形が合いません");
  });

  it("JSON Schema で書けない規則の決まりを断る", () => {
    expect(rule((r) => r.blocks.push({ id: "family", kind: "drop", anchor: { words: ["担当者"] } }))).toEqual(["rule: 区画の ID family が重なっています"]);
    expect(rule((r) => ((r.blocks[2] as Record<string, unknown>).object = "spaceship"))).toEqual(["rule: 区画 loans の物の種類 spaceship はエンジンの入力の物の集まりにありません"]);
    expect(rule((r) => (r.detect = { allWords: [], anyWords: ["a"], minHits: 3 }))).toEqual(["rule: detect.minHits が anyWords の数より大きい"]);
    expect(rule((r) => (r.detect = { allWords: [], anyWords: [], minHits: 0 }))[0]).toContain("当てはまる言葉がありません");
  });

  it.each([
    ["知らない欄", (d: ReturnType<typeof exampleDict>) => (d.extra = 1)],
    ["対応先が2つ", (d: ReturnType<typeof exampleDict>) => (d.entries[0] = { words: ["x"], to: { item: "member.sex", row: "cf.net" } })],
    ["対応先の知らない種類", (d: ReturnType<typeof exampleDict>) => (d.entries[0] = { words: ["x"], to: { formula: "a+b" } })],
    ["行ID の形が違う", (d: ReturnType<typeof exampleDict>) => (d.entries[0] = { words: ["x"], to: { row: "net" } })],
    ["知らない単位", (d: ReturnType<typeof exampleDict>) => (d.entries[0] = { words: ["x"], to: { item: "member.sex" }, value: { unit: "regex" } })],
    ["選択肢の写し方が無い", (d: ReturnType<typeof exampleDict>) => (d.entries[0] = { words: ["x"], to: { item: "member.sex" }, value: { unit: "choice" } })],
    ["文字のまま（text）を入力項目に", (d: ReturnType<typeof exampleDict>) => (d.entries[0] = { words: ["x"], to: { item: "member.sex" }, value: { unit: "text" } })],
    ["読まない行に値の読み方", (d: ReturnType<typeof exampleDict>) => (d.entries[0] = { words: ["x"], to: { drop: true }, value: { unit: "money" } })],
    ["年額・月額を金額でない値に", (d: ReturnType<typeof exampleDict>) => (d.entries[0] = { words: ["x"], to: { item: "assumptions.inflation" }, value: { unit: "percent", period: "annual" } })],
    ["知らない続柄", (d: ReturnType<typeof exampleDict>) => (d.roles = [{ words: ["叔父"], role: "uncle" }])],
    ["言葉に式", (d: ReturnType<typeof exampleDict>) => (d.entries[0] = { words: ["`rm -rf`"], to: { memo: true } })],
  ])("辞書の形が合わないものを断る（%s）", (_name, f) => {
    const problems = dict(f);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("形が合いません");
  });

  it("対応先の ID は登録簿の ID だけ（無い ID・deprecated の ID を断る）", () => {
    expect(dict((d) => (d.entries[0] = { words: ["x"], to: { item: "employment.salary.yearly" } }))).toEqual(["dict: entries[0]（x）: 入力項目ID employment.salary.yearly が登録簿にありません"]);
    const deprecated = [...ctx.items].find(([, e]) => e.status === "deprecated")?.[0] as string;
    expect(deprecated).toBeDefined();
    expect(dict((d) => (d.entries[0] = { words: ["x"], to: { item: deprecated } }))).toEqual([`dict: entries[0]（x）: 入力項目ID ${deprecated} は deprecated（使えません）`]);
    expect(dict((d) => (d.entries[0] = { words: ["x"], to: { row: "cf.balance.imaginary" } }))).toEqual(["dict: entries[0]（x）: 行ID cf.balance.imaginary が登録簿にありません"]);
  });

  it("JSON Schema で書けない辞書の決まりを断る（前提条件・物の種類・参照値・移行メモの値）", () => {
    expect(dict((d) => (d.entries[0] = { words: ["x"], to: { item: "assumptions.inflation", member: "self" } }))).toEqual(["dict: entries[0]（x）: 前提条件には member・object を付けません"]);
    expect(dict((d) => (d.entries[0] = { words: ["x"], to: { item: "account.marketValue", object: "debt" } }))).toEqual(["dict: entries[0]（x）: account.marketValue は物の種類 debt の入力項目ではありません"]);
    expect(dict((d) => (d.entries[0] = { words: ["x"], to: { row: "cf.net" }, value: { unit: "percent" } }))).toEqual(["dict: entries[0]（x）: 表の行（参照値）の値は money か yen"]);
    expect(dict((d) => (d.entries[0] = { words: ["x"], to: { memo: true }, value: { unit: "money" } }))).toEqual(["dict: entries[0]（x）: 移行メモの値は text だけ"]);
  });
});

describe("公開側の規則と辞書（0113 の11。CI）", () => {
  const tree = (rules: Record<string, unknown>, dicts: Record<string, unknown>): string => {
    const dir = mkdtempSync(join(tmpdir(), "migration-"));
    mkdirSync(join(dir, "migration", "rules"), { recursive: true });
    mkdirSync(join(dir, "migration", "dictionaries"), { recursive: true });
    for (const [f, doc] of Object.entries(rules)) writeFileSync(join(dir, "migration", "rules", f), JSON.stringify(doc));
    for (const [f, doc] of Object.entries(dicts)) writeFileSync(join(dir, "migration", "dictionaries", f), JSON.stringify(doc));
    return dir;
  };
  const officialRule = (product: string | null) => ({ ...exampleRule(), id: "official.genericReport", dictionaries: ["official.fpTerms"], reads: { ...exampleRule().reads, product } });
  const officialDict = () => ({ ...exampleDict(), id: "official.fpTerms" });

  it("reads.product が null の公式の規則は通る", () => {
    expect(checkPublicFiles(tree({ "official.genericReport.json": officialRule(null) }, { "official.fpTerms.json": officialDict() }), ctx, v)).toEqual([]);
  });

  it("製品名を持つ規則は公開側に置けない", () => {
    expect(checkPublicFiles(tree({ "official.genericReport.json": officialRule("（製品名）") }, { "official.fpTerms.json": officialDict() }), ctx, v)).toEqual([
      "migration/rules/official.genericReport.json: 公開側の規則の reads.product は null（製品ごとの規則は非公開のリポジトリにだけ置く。0113 の11）",
    ]);
  });

  it("作成者は official・ファイル名は <id>.json・挙げた辞書は公開側にある", () => {
    const problems = checkPublicFiles(tree({ "generic.json": { ...officialRule(null), id: "office.generic" } }, { "official.fpTerms.json": { ...officialDict(), id: "official.otherTerms" } }), ctx, v);
    expect(problems).toEqual([
      "migration/dictionaries/official.fpTerms.json: ファイル名は <id>.json（official.otherTerms.json）",
      "migration/rules/generic.json: 公開側の規則の作成者は official",
      "migration/rules/generic.json: ファイル名は <id>.json（office.generic.json）",
      "migration/rules/generic.json: 辞書 official.fpTerms が公開側（migration/dictionaries/）にありません",
    ]);
  });

  it("JSON として読めないファイルを知らせる", () => {
    const dir = tree({}, {});
    writeFileSync(join(dir, "migration", "rules", "official.broken.json"), "{");
    expect(checkPublicFiles(dir, ctx, v)).toEqual(["migration/rules/official.broken.json: JSON として読めません"]);
  });
});
