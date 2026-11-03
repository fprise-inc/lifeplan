// 拡張の束（0114）: 同梱の公式の拡張の確かめ・束の決まり・宣言型の入力欄・差し込み口に渡す値・有効にする条件・提案書の拡張の章
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { chapterList, CHAPTER_IDS, man as sdkMan } from "../../report/src/index.ts";
import { COMPANY_ASSETS, COMPANY_EQUITY, COMPANY_LIABILITIES, COMPANY_MONTHLY, COMPANY_STAGES, RESTATE_ITEMS } from "../../sdk/examples/extensions/combined-bs/parts/combinedBs.ts";
import { man } from "../src/presentation/format.ts";
import { fieldText, readExtValue, withFieldText } from "../src/workspace/extensions/fields.ts";
import { checkExtension, checkFields } from "../src/workspace/extensions/manifest.ts";
import { COMBINED_BS_EXTENSION, OFFICIAL_CHECKS, OFFICIAL_EXTENSIONS } from "../src/workspace/extensions/official.ts";
import { activeExtensions, chapterMaterials, extensionChapters, extensionViews, extInput } from "../src/workspace/extensions/run.ts";
import { DEFAULT_CHAPTERS } from "../src/workspace/report/assemble.ts";
import { DEFAULT_OFFICE_SETTINGS } from "../src/workspace/office/settings.ts";
import { NO_FEATURES } from "../src/workspace/office/featureCodes.ts";
import type { FeatureStatus } from "../src/engine/host.ts";
import { bsPlan } from "../src/workspace/balanceTab.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { modelHousehold, preview } from "./helpers.ts";

const BUNDLE = join(REPO_DIR, "sdk", "examples", "extensions", "combined-bs");
const combined = OFFICIAL_EXTENSIONS.find((x) => x.manifest.id === COMBINED_BS_EXTENSION)!;
const decl = combined.fields[0]!;
const manifest = JSON.parse(readFileSync(join(BUNDLE, "manifest.json"), "utf8")) as Record<string, unknown>;
const fieldsJson = JSON.parse(readFileSync(join(BUNDLE, "fields", "company.json"), "utf8")) as Record<string, unknown>;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe("同梱の公式の拡張（合算BS）", () => {
  it("束の宣言（manifest・入力欄）に誤りが無く、読み込まれる", () => {
    expect(OFFICIAL_CHECKS).toEqual([{ id: COMBINED_BS_EXTENSION, errors: [] }]);
    expect(combined.official).toBe(true);
    expect(combined.manifest.activation).toEqual({ feature: "combinedBs", households: "executive" });
    expect(decl.key).toBe(COMBINED_BS_EXTENSION);
    expect(extensionChapters([combined])).toEqual([{ id: COMBINED_BS_EXTENSION, label: "会社と合わせたバランスシート（合算BS）" }]);
    // 章の Typst の置き場所は manifest のとおり（本体の帳票の部品が同じファイルを読み込む）
    const typst = combined.manifest.provides.find((p) => p.extensionPoint === "report.chapter")?.chapter?.typst ?? "";
    expect(readFileSync(join(BUNDLE, typst), "utf8")).toContain("#let ext-chapter(cb, data)");
    expect(readFileSync(join(REPO_DIR, "crates", "report-pdf", "src", "lib.rs"), "utf8")).toContain("sdk/examples/extensions/combined-bs/reports/chapter.typ");
  });

  it("束の決まり（0114 の1）: 読み込むのは束の中の相対パスと @lifeplan/sdk だけ。時計・乱数・端末に依る関数・動的な読み込みを使わない", () => {
    const sources = files(BUNDLE).filter((f) => f.endsWith(".ts"));
    expect(sources.length).toBeGreaterThan(0);
    for (const f of sources) {
      const src = readFileSync(f, "utf8").replace(/\/\/.*$/gm, "");
      for (const m of src.matchAll(/(?:import|export)\s[^;]*?from\s+"([^"]+)"/g)) {
        const spec = m[1]!;
        if (spec === "@lifeplan/sdk") continue;
        expect(spec.startsWith("./") || spec.startsWith("../"), `${relative(BUNDLE, f)}: ${spec}`).toBe(true);
        expect(relative(BUNDLE, resolve(dirname(f), spec)).startsWith(".."), `${relative(BUNDLE, f)}: ${spec} は束の外`).toBe(false);
      }
      for (const bad of [/\bDate\b/, /Math\.random/, /Math\.(pow|exp|log|sqrt|sin|cos)\b/, /\bimport\s*\(/, /toLocaleString/, /\bIntl\b/, /\bfetch\b/, /\beval\b/, /new Function/, /globalThis/]) {
        expect(bad.test(src), `${relative(BUNDLE, f)}: ${String(bad)}`).toBe(false);
      }
    }
  });

  it("入力欄の宣言は、計算の部品の科目・段階・点検の項目と同じ名前と並び", () => {
    const label = (id: string) => decl.fields.find((f) => f.id === id)?.label;
    for (const x of [...COMPANY_ASSETS, ...COMPANY_LIABILITIES, ...COMPANY_EQUITY, ...COMPANY_MONTHLY]) expect(label(`amount:${x.key}`), x.key).toBe(x.label);
    for (const x of RESTATE_ITEMS.filter((r) => r.amount)) {
      expect(label(`restated:${x.key}`)).toBe(`${x.label}（直した額）`);
      expect(decl.fields.find((f) => f.id === `restated:${x.key}`)?.help).toBe(x.hint);
    }
    expect(decl.fields.find((f) => f.id === "stage")?.options).toEqual(COMPANY_STAGES.map((s) => ({ value: s.key, label: s.label })));
    expect(decl.fields.filter((f) => f.negative === true).map((f) => f.id)).toEqual(["amount:retained"]);
  });

  it("@lifeplan/sdk の man は画面の man と同じ書き方", () => {
    for (const v of [0, 4999, 5000, 12_345_678, -20_270_000, 1_000_000_000_000]) expect(sdkMan(v)).toBe(man(v));
  });
});

describe("束の宣言の確かめ（段2 の FP の束にも使う）", () => {
  const parts = combined.parts as Record<string, unknown>;
  const as = (over: Record<string, unknown>) => ({ ...manifest, ...over });
  it("作成者 official は同梱・提供元の束だけ。コードの機能は公式の拡張だけが書ける", () => {
    expect(checkExtension(manifest, [fieldsJson], parts, { official: false }).some((e) => e.includes("official は提供元だけ"))).toBe(true);
    const provides = (manifest.provides as Record<string, unknown>[]).map((p) => (p.chapter !== undefined ? { ...p, chapter: { ...(p.chapter as object), id: "ext.myOffice.combinedBs" } } : p));
    const mine = as({ id: "ext.myOffice.combinedBs", provides });
    const f = { ...fieldsJson, key: "ext.myOffice.combinedBs" };
    expect(checkExtension(mine, [f], parts, { official: false }).some((e) => e.includes("公式の拡張だけ"))).toBe(true);
    // 写して作成者を変え、コードの機能を外せば FP の束として読める（0107 の 2026-11-02 の追記・0114 の7）
    expect(checkExtension({ ...mine, activation: { households: "executive" } }, [f], parts, { official: false })).toEqual([]);
  });
  it("知らない差し込み口・約束の版・入口に無い関数・作成者の違う入力欄・既定の値・使えない字は読み込まない", () => {
    const p0 = (manifest.provides as Record<string, unknown>[])[0]!;
    expect(checkExtension(as({ provides: [{ ...p0, extensionPoint: "view.result" }] }), [fieldsJson], parts, { official: true }).join()).toContain("知らない差し込み口");
    expect(checkExtension(as({ provides: [{ ...p0, contract: "2" }] }), [fieldsJson], parts, { official: true }).join()).toContain("約束の版");
    expect(checkExtension(as({ provides: [{ ...p0, export: "nope" }] }), [fieldsJson], parts, { official: true }).join()).toContain("関数「nope」");
    expect(checkExtension(as({ reads: ["memo"] }), [fieldsJson], parts, { official: true }).join()).toContain("渡せない値");
    expect(checkFields({ ...fieldsJson, key: "ext.other.x" }, COMBINED_BS_EXTENSION).join()).toContain("作成者");
    const withDefault = { ...fieldsJson, fields: [...(fieldsJson.fields as object[]), { id: "x", path: ["x"], type: "yen", label: "x", default: 1 }] };
    expect(checkFields(withDefault, COMBINED_BS_EXTENSION).join()).toContain("既定の値");
    expect(checkFields({ ...fieldsJson, label: "会社‮の数字" }, COMBINED_BS_EXTENSION).join()).toContain("使えない字");
  });
});

describe("宣言型の入力欄（0114 の4）", () => {
  it("宣言に合わない値・場所は捨て、空は欄を持たない。文字は画面が決まった形で読む", () => {
    expect(readExtValue(decl, { version: 1, asOf: "2026-9", amounts: { cash: 1.5, land: 100, retained: -5 }, stage: "x", useRestated: false, other: 1 })).toEqual({ amounts: { land: 100, retained: -5 } });
    expect(readExtValue(decl, { amounts: { cash: -1 } })).toBeNull();
    expect(readExtValue(decl, "x")).toBeNull();
    const a = withFieldText(decl, null, "amount:cash", "２，０００");
    expect(a).toEqual({ amounts: { cash: 20_000_000 } });
    expect(fieldText(decl.fields.find((f) => f.id === "amount:cash")!, a!)).toBe("2000");
    expect(withFieldText(decl, a!, "useRestated", "1")).toEqual({ amounts: { cash: 20_000_000 }, useRestated: true });
    expect(withFieldText(decl, a!, "asOf", "2026年9月")).toEqual({ amounts: { cash: 20_000_000 }, asOf: "2026-09" });
    expect(withFieldText(decl, a!, "asOf", "2026-13")).toBeUndefined();
    expect(withFieldText(decl, a!, "amount:cash", "")).toBeNull();
    expect(withFieldText(decl, a!, "nope", "1")).toBeUndefined();
  });
});

describe("差し込み口に渡す値と、有効にする条件（0114 の5・7）", () => {
  const req = modelHousehold("executiveOwner");
  const plan = bsPlan({ key: "A", letter: "A", name: "現状", title: "", base: true, req, table: preview(req).table });
  const home = plan.years[0]!;
  const on: FeatureStatus = { ...NO_FEATURES, active: ["combinedBs"] };
  const office = { ...DEFAULT_OFFICE_SETTINGS.features, combinedBs: true };

  it("自分の入力欄の値と reads に書いた balance.now だけを、写しで渡す（ほかの束の値は渡さない）", () => {
    const values = { [COMBINED_BS_EXTENSION]: { amounts: { cash: 1 } }, "ext.other.memo": { a: 1 } };
    const input = extInput(combined, values, { at: { year: 2026, lines: [], totalAssets: 0, totalLiabilities: 0, netWorth: 0, financial: 0, shortfall: 0 }, monthly: 1, guarantee: 0 });
    expect(Object.keys(input.values)).toEqual([COMBINED_BS_EXTENSION]);
    expect(input.balance?.now.monthly).toBe(1);
    (input.values[COMBINED_BS_EXTENSION] as { amounts: { cash: number } }).amounts.cash = 9;
    expect(values[COMBINED_BS_EXTENSION]!.amounts.cash).toBe(1);
  });

  it("コードで有効・事務所の設定の印・役員として働く人のいる世帯がそろったときだけ使える", () => {
    const h = req.input.household;
    expect(activeExtensions(OFFICIAL_EXTENSIONS, { features: NO_FEATURES, office, household: h })).toEqual([]);
    expect(activeExtensions(OFFICIAL_EXTENSIONS, { features: on, office: DEFAULT_OFFICE_SETTINGS.features, household: h })).toEqual([]);
    expect(activeExtensions(OFFICIAL_EXTENSIONS, { features: on, office, household: modelHousehold("salariedCoupleTwoKids").input.household })).toEqual([]);
    expect(activeExtensions(OFFICIAL_EXTENSIONS, { features: on, office, household: null })).toEqual([]);
    expect(activeExtensions(OFFICIAL_EXTENSIONS, { features: on, office, household: h }).map((x) => x.manifest.id)).toEqual([COMBINED_BS_EXTENSION]);
  });

  it("見るものの鍵は束の id。入力欄は宣言から作り、束の関数が返した差し込みの文を当てる", () => {
    const v = extensionViews([combined], undefined, home)[0]!;
    expect(v.key).toBe(COMBINED_BS_EXTENSION);
    expect(v.label).toBe("合算BS（会社と合わせる）");
    const owner = v.form?.groups.flatMap((g) => g.fields).find((f) => f.id === "ownerMonthly");
    expect(owner?.help).toContain("空欄は生活費＋ローン返済");
    expect(owner?.unit).toBe("万円");
    expect(extensionViews([combined], undefined, undefined)).toEqual([]);
  });

  it("提案書の拡張の章: 章の一覧の「提案での変更点」の後に出て、最初から選んである。材料は選んだ章だけ", () => {
    const list = chapterList(extensionChapters([combined])).map((c) => c.id);
    expect(list.indexOf(COMBINED_BS_EXTENSION)).toBe(list.indexOf("changes") + 1);
    expect(list.filter((id) => id !== COMBINED_BS_EXTENSION)).toEqual(CHAPTER_IDS);
    expect(DEFAULT_CHAPTERS).toContain(COMBINED_BS_EXTENSION);
    const values = { [COMBINED_BS_EXTENSION]: { amounts: { cash: 20_000_000, capital: 10_000_000 } } };
    expect(Object.keys(chapterMaterials([combined], values, home, new Set([COMBINED_BS_EXTENSION])))).toEqual([COMBINED_BS_EXTENSION]);
    expect(chapterMaterials([combined], values, home, new Set(["summary"]))).toEqual({});
    expect(chapterMaterials([combined], undefined, home, new Set([COMBINED_BS_EXTENSION]))).toEqual({});
  });
});
