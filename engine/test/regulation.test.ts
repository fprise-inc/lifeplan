// 0007: 制度データの形式・読み込み
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPack, parseStrictYaml, pendingReviewEntries, serializePack, type PackJson } from "../scripts/regulation.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { asBrackets, asGrades, asRate, asRoundingRule, gradeFor, RegulationStore, type PackJson as EnginePack } from "../src/regulation/reader.ts";
import { yen } from "../src/money/yen.ts";
import { parseDate } from "../src/time/civil.ts";
import { fictionalPacks, realPacks } from "./helpers.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const HEADER = `packId: regulation.demo
formatVersion: "0.1"
version: "2026.3.0"
features: []
title: 【架空】テスト
fictional: true
requires: {}
license: {values: CC0-1.0, sources: なし}
`;

const entry = (o: Record<string, string>) => `  - rev: ${o.rev ?? "1"}
    appliesFrom: "${o.from ?? "2020-01-01"}"
    appliesTo: ${o.to ?? "null"}
    enforcedOn: "${o.from ?? "2020-01-01"}"
    status: ${o.status ?? "enacted"}
    jurisdiction: national
    conditions: ${o.conditions ?? "[]"}
    value: ${o.value ?? '"0.1"'}
    sources: [{type: fictional, note: 架空}]
    recordedIn: "${o.recordedIn ?? "2026.1.0"}"
    supersededIn: ${o.supersededIn ?? "null"}
`;

const valueFile = (id: string, body: string, extra = "unit: rate\nkind: constant\nbasis: incomeYear\n") =>
  `id: ${id}\ntitle: 【架空】${id}\n${extra}entries:\n${body}`;

/** 一時フォルダにパックを作る */
function makePack(files: Record<string, string>, header = HEADER): string {
  const root = mkdtempSync(join(tmpdir(), "financia-reg-"));
  dirs.push(root);
  const dir = join(root, "demo");
  mkdirSync(dir);
  writeFileSync(join(dir, "pack.yaml"), header);
  copyFileSync(join(REPO_DIR, "registry", "LICENSE"), join(dir, "LICENSE"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

describe("YAML の書き方の制限", () => {
  it("アンカー・エイリアス・タグ・マージキー・小数を拒む", () => {
    expect(() => parseStrictYaml("a: &x 1\nb: *x\n", "t")).toThrow("アンカー");
    expect(() => parseStrictYaml("a: !!str 1\n", "t")).toThrow("タグ");
    expect(() => parseStrictYaml("<<: {a: 1}\n", "t")).toThrow("マージキー");
    expect(() => parseStrictYaml("rate: 0.0985\n", "t")).toThrow("小数");
    expect(() => parseStrictYaml("a: 1\na: 2\n", "t")).toThrow();
    expect(parseStrictYaml('d: "2026-01-01"\nn: 100\nr: "0.1"\n', "t")).toEqual({ d: "2026-01-01", n: 100, r: "0.1" });
  });
});

describe("パックの組み立て", () => {
  it("架空のパックは架空と分かる印を持ち、正規化した JSON は毎回同じ", () => {
    for (const p of fictionalPacks()) {
      expect(p.pack.fictional).toBe(true);
      expect(String(p.pack.title)).toContain("架空");
      for (const v of p.values) expect(String(v.id).startsWith("test.")).toBe(true);
      expect(p.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
    expect(serializePack(fictionalPacks()[0] as PackJson)).toBe(serializePack(buildPack(join(REPO_DIR, "engine", "test", "fixtures", "regulation", "testTax"))));
  });

  it("製品のパックは test. の値を持たず、すべての行に承認の記録（いまは原本での確認待ち）がある", () => {
    for (const p of realPacks()) {
      expect(p.pack.fictional).toBeUndefined();
      expect(p.pack.formatVersion).toBe("0.1");
      for (const v of p.values) expect(String(v.id).startsWith("test.")).toBe(false);
      const rows = p.values.reduce((n, v) => n + (v.entries as unknown[]).length, 0);
      expect(pendingReviewEntries(p)).toHaveLength(rows);
    }
  });

  it("basis を目的語つきの形に正規化する", () => {
    const v = realPacks()[1]?.values.find((x) => x.id === "residentTax.basicDeduction");
    expect(v?.basis).toEqual({ type: "priorYearIncome", switchMonth: 6 });
    expect(v?.linkage).toBe("none");
  });

  it("ファイル名と値IDの食い違い・率の数値書き・出典なしを拒む", () => {
    expect(() => buildPack(makePack({ "test.demo.a.yaml": valueFile("test.demo.b", entry({})) }))).toThrow("ファイル名");
    expect(() => buildPack(makePack({ "test.demo.a.yaml": valueFile("test.demo.a", entry({ value: "0.1" })) }))).toThrow("小数");
    const noSource = valueFile("test.demo.a", entry({})).replace("    sources: [{type: fictional, note: 架空}]\n", "    sources: []\n");
    expect(() => buildPack(makePack({ "test.demo.a.yaml": noSource }))).toThrow("形式の誤り");
  });

  it("架空のパックに test. 以外の値、製品のパックに test. の値を置けない", () => {
    expect(() => buildPack(makePack({ "demo.a.yaml": valueFile("demo.a", entry({})) }))).toThrow("test.");
    expect(() => buildPack(makePack({ "test.demo.a.yaml": valueFile("test.demo.a", entry({})) }, HEADER.replace("fictional: true\n", "")))).toThrow("test.");
  });

  it("同じ条件の行の適用期間の重なり・空白を拒む", () => {
    const overlap = entry({ rev: "1", to: '"2027-12-31"' }) + entry({ rev: "2", from: "2027-01-01" });
    expect(() => buildPack(makePack({ "test.demo.a.yaml": valueFile("test.demo.a", overlap) }))).toThrow("重なるか");
    const gap = entry({ rev: "1", to: '"2025-12-31"' }) + entry({ rev: "2", from: "2027-01-01" });
    expect(() => buildPack(makePack({ "test.demo.a.yaml": valueFile("test.demo.a", gap) }))).toThrow("空白");
    const ok = entry({ rev: "1", to: '"2026-12-31"' }) + entry({ rev: "2", from: "2027-01-01" });
    expect(buildPack(makePack({ "test.demo.a.yaml": valueFile("test.demo.a", ok) })).values).toHaveLength(1);
  });

  it("basis と適用期間の揃いを確かめる", () => {
    const bad = entry({ from: "2020-04-01" });
    expect(() => buildPack(makePack({ "test.demo.a.yaml": valueFile("test.demo.a", bad) }))).toThrow("揃っていません");
    const fy = valueFile("test.demo.a", entry({ from: "2020-04-01", to: '"2021-03-31"' }), "unit: rate\nkind: constant\nbasis: fiscalYear\n");
    expect(buildPack(makePack({ "test.demo.a.yaml": fy })).values).toHaveLength(1);
  });

  it("rev の重複・暦にない日付・訂正の版の矛盾を拒む", () => {
    const dup = entry({ rev: "1", to: '"2026-12-31"' }) + entry({ rev: "1", from: "2027-01-01" });
    expect(() => buildPack(makePack({ "test.demo.a.yaml": valueFile("test.demo.a", dup) }))).toThrow("rev が重複");
    expect(() => buildPack(makePack({ "test.demo.a.yaml": valueFile("test.demo.a", entry({ from: "2021-02-29" })) }))).toThrow();
    const sup = entry({ supersededIn: '"2026.1.0"' });
    expect(() => buildPack(makePack({ "test.demo.a.yaml": valueFile("test.demo.a", sup) }))).toThrow("supersededIn");
  });

  it("等級表は1から1ずつ・隙間なし・最後だけ上限なし", () => {
    const g = (rows: string) => valueFile("test.demo.a", entry({ value: rows }), "unit: JPY\nkind: gradeTable\nbasis: month\n").replace('appliesFrom: "2020-01-01"', 'appliesFrom: "2020-01-01"');
    const ok = "[{grade: 1, amount: 100, from: 0, below: 150}, {grade: 2, amount: 200, from: 150, below: null}]";
    expect(buildPack(makePack({ "test.demo.a.yaml": g(ok) })).values).toHaveLength(1);
    expect(() => buildPack(makePack({ "test.demo.a.yaml": g("[{grade: 1, amount: 100, from: 0, below: 150}, {grade: 2, amount: 200, from: 160, below: null}]") }))).toThrow("from");
    expect(() => buildPack(makePack({ "test.demo.a.yaml": g("[{grade: 1, amount: 100, from: 0, below: 150}, {grade: 3, amount: 200, from: 150, below: null}]") }))).toThrow("grade");
    expect(() => buildPack(makePack({ "test.demo.a.yaml": g("[{grade: 1, amount: 100, from: 0, below: null}, {grade: 2, amount: 200, from: 150, below: null}]") }))).toThrow();
  });

  it("製品のパックの行には承認の記録が要り、施行日を null にできるのは原本での確認待ちだけ", () => {
    const real = HEADER.replace("fictional: true\n", "");
    const web = '    sources: [{type: web, url: "https://www.nta.go.jp/x.htm", retrievedAt: "2026-10-08", retrievedVia: searchExcerpt, note: 検索の要約}]\n';
    const body = entry({}).replace("    sources: [{type: fictional, note: 架空}]\n", web);
    expect(() => buildPack(makePack({ "demo.a.yaml": valueFile("demo.a", body) }, real))).toThrow("approval");
    const pending = body + "    approval: {method: pendingReview, paths: 2}\n";
    expect(buildPack(makePack({ "demo.a.yaml": valueFile("demo.a", pending.replace('enforcedOn: "2020-01-01"', "enforcedOn: null")) }, real)).values).toHaveLength(1);
    const reviewed = body.replace('enforcedOn: "2020-01-01"', "enforcedOn: null") + "    approval: {method: reviewed}\n";
    expect(() => buildPack(makePack({ "demo.a.yaml": valueFile("demo.a", reviewed) }, real))).toThrow("施行日");
    // 原本の指紋の無い web の出典は、検索の抜粋（retrievedVia: searchExcerpt）としてだけ書ける
    const noDigest = pending.replace(", retrievedVia: searchExcerpt", "");
    expect(() => buildPack(makePack({ "demo.a.yaml": valueFile("demo.a", noDigest) }, real))).toThrow("形式の誤り");
  });

  it("rounding は同じパックの kind: rounding の値を指す", () => {
    const v = valueFile("test.demo.a", entry({}), "unit: rate\nkind: constant\nbasis: incomeYear\nrounding: test.demo.missing\n");
    expect(() => buildPack(makePack({ "test.demo.a.yaml": v }))).toThrow("rounding");
  });
});

describe("エンジン側の読み取り", () => {
  const d = (s: string) => parseDate(s);
  const store = (p: PackJson, dataSet: Record<string, string> = {}) => new RegulationStore([p as unknown as EnginePack], dataSet);

  it("適用期間と 2本の時間軸（知った時点）で行を選ぶ", () => {
    const [tax] = realPacks().filter((p) => p.pack.packId === "regulation.tax");
    const latest = store(tax as PackJson);
    const id = "incomeTax.reconstructionSurtax.rate";
    expect(latest.select(id, d("2026-01-01")).entry.rev).toBe(3);
    expect(String(asRate(latest.select(id, d("2027-01-01"))) && "ok")).toBe("ok");
    expect(latest.select(id, d("2027-01-01")).entry.rev).toBe(4);
    // パックの版 2026.1.0 の時点（令和8年度改正の前）では、訂正前の行を使う
    const old = store(tax as PackJson, { "regulation.tax": "2026.1.0" });
    expect(old.select(id, d("2027-01-01")).entry.rev).toBe(1);
    expect(old.select(id, d("2040-01-01")).entry.rev).toBe(2);
    expect(asRoundingRule(latest.select("incomeTax.taxAmount.rounding", d("2030-01-01")))).toEqual({ mode: "DOWN", unit: 100 });
    expect(() => latest.select(id, d("2024-12-31"))).toThrow("E_PARAM_NO_VALUE");
    // 期限つきの特例の後の区分が分からない値は、行を置かない（推測で埋めない）。延長の仮定で最後の行が続くとみなす（0007 の追記）
    const ext = latest.select("incomeTax.employmentIncomeDeduction", d("2028-01-01"));
    expect([ext.entry.rev, ext.extendedYear]).toEqual([2, 2028]);
    expect(latest.select("incomeTax.employmentIncomeDeduction", d("2027-01-01")).extendedYear).toBeUndefined();
  });

  it("全国以外の管轄（協会けんぽの支部）の値を選ぶ", () => {
    const [si] = realPacks().filter((p) => p.pack.packId === "regulation.socialInsurance");
    const s = store(si as PackJson);
    const id = "socialInsurance.health.kyokaikenpo.rate";
    const at = (code: string, date: string) => s.select(id, d(date), { jurisdiction: { level: "insurer", code } }).entry.value;
    expect(at("kyokaikenpo.13", "2026-02-01")).toBe("0.0991");
    expect(at("kyokaikenpo.13", "2026-03-01")).toBe("0.0985");
    expect(at("kyokaikenpo.47", "2026-03-01")).toBe("0.0944");
    expect(() => s.select(id, d("2026-03-01"))).toThrow("E_PARAM_NO_VALUE");
    expect(() => s.select(id, d("2026-03-01"), { jurisdiction: { level: "insurer", code: "kyokaikenpo.48" } })).toThrow("E_PARAM_NO_VALUE");
  });

  it("架空のパックの test.<値ID> は、代わりをする製品のパックの <値ID> で引ける", () => {
    const [t] = fictionalPacks();
    const s = store(t as PackJson);
    expect(asBrackets(s.select("incomeTax.basicDeduction", d("2027-01-01")))?.[0]?.amount).toBe(600000);
    expect(asBrackets(new RegulationStore([t as unknown as EnginePack], { "regulation.testTax": "2026.1.0" }).select("incomeTax.basicDeduction", d("2027-01-01")))?.[0]?.amount).toBe(500000);
    expect(() => s.select("test.incomeTax.basicDeduction", d("2027-01-01"))).toThrow("E_PARAM_UNKNOWN");
    expect((s.packs()[0] as { fictional: boolean; fictionalOf?: string }).fictionalOf).toBe("regulation.tax");
    // 製品のパックと一緒には読めない（同じ値IDになる）
    expect(() => new RegulationStore([t, ...realPacks()] as unknown as EnginePack[])).toThrow("E_PACK_DUPLICATE");
  });

  it("等級表（gradeTable）で報酬月額の等級を引く", () => {
    const [, si] = fictionalPacks();
    const g = asGrades(store(si as PackJson).select("socialInsurance.health.standardMonthlyRemuneration", d("2026-05-01"))) ?? [];
    expect(gradeFor(g, yen(0)).grade).toBe(1);
    expect(gradeFor(g, yen(149999)).amount).toBe(100000);
    expect(gradeFor(g, yen(150000)).amount).toBe(200000);
    expect(gradeFor(g, yen(99999999)).amount).toBe(1000000);
  });

  it("形式の版の違い・知らない機能・重複したパックは使わない", () => {
    const p = fictionalPacks()[0] as PackJson;
    const other = JSON.parse(JSON.stringify(p)) as PackJson;
    other.pack.formatVersion = "1.0";
    expect(() => store(other)).toThrow("E_PACK_FORMAT_VERSION");
    // 0.x の間は小の版の違いも読まない
    other.pack.formatVersion = "0.2";
    expect(() => store(other)).toThrow("E_PACK_FORMAT_VERSION");
    other.pack.formatVersion = "0.1";
    other.pack.features = ["futureThing"];
    expect(() => store(other)).toThrow("E_PACK_FEATURE");
    expect(() => new RegulationStore([p, p] as unknown as EnginePack[])).toThrow("E_PACK_DUPLICATE");
  });

  it("案（proposed）の行は使わない", () => {
    const body = entry({ rev: "1", to: '"2026-12-31"', value: '"0.1"' }) + entry({ rev: "2", from: "2027-01-01", value: '"0.2"' }) +
      entry({ rev: "3", from: "2028-01-01", value: '"0.3"', status: "proposed" }).replace("    jurisdiction:", "    scenarioId: test.demo.reform\n    jurisdiction:");
    const p = buildPack(makePack({ "test.demo.a.yaml": valueFile("test.demo.a", body) }));
    expect(store(p).select("test.demo.a", d("2029-01-01")).entry.rev).toBe(2);
  });

  it("生年月日の条件（経過措置）を、生年月＋1日生まれかで選ぶ。月の途中の境目は決まらない", () => {
    const body =
      entry({ rev: "1", value: '"0.1"', conditions: '[{key: birthDate, from: null, to: "1961-04-01"}]' }) +
      entry({ rev: "2", value: '"0.2"', conditions: '[{key: birthDate, from: "1961-04-02", to: null}]' });
    const p = buildPack(makePack({ "test.demo.a.yaml": valueFile("test.demo.a", body, "unit: rate\nkind: constant\nbasis: birthDate\n") }));
    const s = store(p);
    const sel = (ym: string, first: boolean) => s.select("test.demo.a", d("2030-01-01"), { birth: { birthYearMonth: ym, bornOnFirst: first } }).entry.rev;
    expect(sel("1961-03", false)).toBe(1);
    expect(sel("1961-04", true)).toBe(1); // 4月1日生まれ
    expect(sel("1961-04", false)).toBe(2); // 4月2日以後
    expect(sel("1961-05", false)).toBe(2);
    const mid =
      entry({ rev: "1", conditions: '[{key: birthDate, from: null, to: "1961-04-15"}]' }) +
      entry({ rev: "2", conditions: '[{key: birthDate, from: "1961-04-16", to: null}]' });
    const p2 = buildPack(makePack({ "test.demo.a.yaml": valueFile("test.demo.a", mid, "unit: rate\nkind: constant\nbasis: birthDate\n") }));
    expect(() => store(p2).select("test.demo.a", d("2030-01-01"), { birth: { birthYearMonth: "1961-04", bornOnFirst: false } })).toThrow(
      "E_PARAM_AMBIGUOUS",
    );
  });
});
