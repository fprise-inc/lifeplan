// 0007: 制度データの形式・読み込み
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPack, parseStrictYaml, REGULATION_DIR, serializePack, type PackJson } from "../scripts/regulation.ts";
import { asRate, asRoundingRule, RegulationStore, type PackJson as EnginePack } from "../src/regulation/reader.ts";
import { parseDate } from "../src/time/civil.ts";
import { samplePack } from "./helpers.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const HEADER = `packId: regulation.demo
formatVersion: "1.0"
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
  copyFileSync(join(REGULATION_DIR, "sample", "LICENSE"), join(dir, "LICENSE"));
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
  it("見本のパックは架空と分かる印を持ち、正規化した JSON は毎回同じ", () => {
    const p = samplePack();
    expect(p.pack.fictional).toBe(true);
    expect(String(p.pack.title)).toContain("架空");
    for (const v of p.values) expect(String(v.id).startsWith("test.")).toBe(true);
    expect(serializePack(samplePack())).toBe(serializePack(p));
    expect(p.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("basis を目的語つきの形に正規化する", () => {
    const v = samplePack().values.find((x) => x.id === "test.sample.lumpSum.withholdingRate");
    expect(v?.basis).toEqual({ type: "incomeYear" });
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

  it("rounding は同じパックの kind: rounding の値を指す", () => {
    const v = valueFile("test.demo.a", entry({}), "unit: rate\nkind: constant\nbasis: incomeYear\nrounding: test.demo.missing\n");
    expect(() => buildPack(makePack({ "test.demo.a.yaml": v }))).toThrow("rounding");
  });
});

describe("エンジン側の読み取り", () => {
  const d = (s: string) => parseDate(s);
  const store = (p: PackJson, dataSet: Record<string, string> = {}) => new RegulationStore([p as unknown as EnginePack], dataSet);

  it("適用期間と 2本の時間軸（知った時点）で行を選ぶ", () => {
    const p = samplePack();
    const latest = store(p);
    const id = "test.sample.lumpSum.withholdingRate";
    expect(latest.select(id, d("2027-01-01")).entry.rev).toBe(1);
    expect(latest.select(id, d("2028-01-01")).entry.rev).toBe(3);
    // パックの版 2026.1.0 の時点では、訂正前の r2 を使う
    const old = store(p, { "regulation.sample": "2026.1.0" });
    expect(old.select(id, d("2028-01-01")).entry.rev).toBe(2);
    expect(String(asRate(old.select(id, d("2030-01-01"))) && "ok")).toBe("ok");
    expect(asRoundingRule(latest.select("test.sample.lumpSum.rounding", d("2030-01-01")))).toEqual({ mode: "DOWN", unit: 100 });
    expect(() => latest.select(id, d("2019-12-31"))).toThrow("E_PARAM_NO_VALUE");
  });

  it("形式の大の版の違い・知らない機能・重複したパックは使わない", () => {
    const p = samplePack();
    const other = JSON.parse(JSON.stringify(p)) as PackJson;
    other.pack.formatVersion = "2.0";
    expect(() => store(other)).toThrow("E_PACK_FORMAT_VERSION");
    other.pack.formatVersion = "1.1";
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
