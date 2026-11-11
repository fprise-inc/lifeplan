// 合算BS の見本（0197）: 会社の数字を入れた見本の世帯（sampleOwnerCompany。架空）と、アプリの見本の世帯でだけ、
// 機能を有効にするコード（0110）が無くても合算BS を見られる形。見本でない世帯（保存した世帯・FP が作った見本）の扱いは変えない
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { hasCompanyAmounts, readCombinedInput } from "../../sdk/examples/extensions/combined-bs/parts/combinedBs.ts";
import { BalanceTab } from "../src/presentation/BalanceTab.tsx";
import type { BsCustomViewModel } from "../src/presentation/model.ts";
import { balanceTabModel, bsPlan, defaultGuideBasis, DEFAULT_BS_GUIDE, DEFAULT_BS_POINTS } from "../src/workspace/balanceTab.ts";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { COMBINED_BS_EXTENSION, OFFICIAL_EXTENSIONS } from "../src/workspace/extensions/official.ts";
import { activeExtensions, chapterIdsOf, chapterMaterials, demoExtValues, extensionChapters, extensionViews, SAMPLE_PREVIEW_TEXT, sampleExtensions } from "../src/workspace/extensions/run.ts";
import { hasExecutive } from "../src/workspace/input/officer.ts";
import { NO_FEATURES } from "../src/workspace/office/featureCodes.ts";
import { DEFAULT_OFFICE_SETTINGS } from "../src/workspace/office/settings.ts";
import type { FeatureStatus } from "../src/engine/host.ts";
import { modelHousehold, preview } from "./helpers.ts";

const ID = "sampleOwnerCompany";
const demo = demoHousehold(ID)!;
const req = modelHousehold(ID);
const hh = req.input.household;
const values = demoExtValues(OFFICIAL_EXTENSIONS, demo.extValues);
const on: FeatureStatus = { ...NO_FEATURES, active: ["combinedBs"] };
const officeOn = { ...DEFAULT_OFFICE_SETTINGS.features, combinedBs: true };
const officeOff = DEFAULT_OFFICE_SETTINGS.features;
const ids = (xs: readonly { manifest: { id: string } }[]) => xs.map((x) => x.manifest.id);
const M = 10000;
const noop = () => undefined;

describe("合算BS の見本の世帯（架空）", () => {
  it("役員として働く人がいて、会社の数字が束の宣言に合う形で入っている（開くときに捨てる値が無い）", () => {
    expect(hasExecutive(hh)).toBe(true);
    expect(values).toEqual(demo.extValues);
    expect(hasCompanyAmounts(readCombinedInput(values?.[COMBINED_BS_EXTENSION]))).toBe(true);
    // 会社の資産＝負債＋資本金＋剰余金（つり合う丸い数字）
    const a = (values?.[COMBINED_BS_EXTENSION] as { amounts: Record<string, number> }).amounts;
    const assets = ["cash", "receivables", "inventory", "otherCurrent", "land", "buildings", "investments", "otherFixed"].reduce((s, k) => s + (a[k] ?? 0), 0);
    const rest = ["shortDebt", "longDebt", "loanFromOwner", "otherLiabilities", "capital", "retained"].reduce((s, k) => s + (a[k] ?? 0), 0);
    expect(assets).toBe(rest);
    for (const v of Object.values(a)) expect(v % (10 * M)).toBe(0);
  });

  it("宣言に合わない値・宣言の無いキーは、開くときに捨てる", () => {
    expect(demoExtValues(OFFICIAL_EXTENSIONS, { [COMBINED_BS_EXTENSION]: { amounts: { cash: -1, capital: 10 * M }, stage: "x" }, "ext.other.memo": { a: 1 } })).toEqual({ [COMBINED_BS_EXTENSION]: { amounts: { capital: 10 * M } } });
    expect(demoExtValues(OFFICIAL_EXTENSIONS, undefined)).toBeUndefined();
    expect(demoExtValues(OFFICIAL_EXTENSIONS, { [COMBINED_BS_EXTENSION]: { amounts: { cash: "1" } } })).toBeUndefined();
  });

  it("ほかのアプリの見本には会社の数字を入れていない", () => {
    expect(demoHousehold("sampleExecutive")?.extValues).toBeUndefined();
  });
});

describe("見本の世帯でだけ、コードが無くても見られる（0197）", () => {
  it("アプリの見本（保存していない）を開いているときだけ、コードも事務所の設定の印も無くても合算BS を見せる", () => {
    expect(ids(sampleExtensions(OFFICIAL_EXTENSIONS, { features: NO_FEATURES, office: officeOff, household: hh, appSample: true }))).toEqual([COMBINED_BS_EXTENSION]);
    // コードはあるが印を外している事務所でも、見本の世帯では見られる
    expect(ids(sampleExtensions(OFFICIAL_EXTENSIONS, { features: on, office: officeOff, household: hh, appSample: true }))).toEqual([COMBINED_BS_EXTENSION]);
  });

  it("保存した世帯・FP が作った見本（appSample でない）では見せない。役員のいない見本・世帯の無いときも見せない", () => {
    expect(sampleExtensions(OFFICIAL_EXTENSIONS, { features: NO_FEATURES, office: officeOn, household: hh, appSample: false })).toEqual([]);
    expect(sampleExtensions(OFFICIAL_EXTENSIONS, { features: NO_FEATURES, office: officeOff, household: modelHousehold("salariedCoupleTwoKids").input.household, appSample: true })).toEqual([]);
    expect(sampleExtensions(OFFICIAL_EXTENSIONS, { features: NO_FEATURES, office: officeOff, household: null, appSample: true })).toEqual([]);
  });

  it("コードで有効で印も付いていれば、見本の世帯でもふつうに使える（見本の印は付けない）", () => {
    expect(sampleExtensions(OFFICIAL_EXTENSIONS, { features: on, office: officeOn, household: hh, appSample: true })).toEqual([]);
    expect(ids(activeExtensions(OFFICIAL_EXTENSIONS, { features: on, office: officeOn, household: hh }))).toEqual([COMBINED_BS_EXTENSION]);
  });

  it("見本でない世帯の条件（activeExtensions）は前のまま: コードか印のどちらかが無ければ使えない", () => {
    for (const [features, office] of [
      [NO_FEATURES, officeOn],
      [on, officeOff],
      [NO_FEATURES, officeOff],
    ] as const) {
      expect(activeExtensions(OFFICIAL_EXTENSIONS, { features, office, household: hh })).toEqual([]);
    }
  });
});

describe("見本の世帯の合算BS の見え方", () => {
  const plan = bsPlan({ key: "A", letter: "A", name: "現状", title: "", base: true, req, table: preview(req).table });
  const home = plan.years[0]!;
  const ext = sampleExtensions(OFFICIAL_EXTENSIONS, { features: NO_FEATURES, office: officeOff, household: hh, appSample: true });
  const samples = new Set(ids(ext));
  const v = extensionViews(ext, values, home, samples)[0]!;
  const tab = (views: BsCustomViewModel[]) =>
    renderToString(
      h(BalanceTab, {
        model: balanceTabModel({ plans: [plan], selected: "A", base: "A", guide: DEFAULT_BS_GUIDE, guideBasis: defaultGuideBasis(req), pointDefaults: DEFAULT_BS_POINTS, columns: null, prevChoices: [], prev: { status: "idle", model: null }, provisional: false, who: "ご本人", customViews: views }),
        band: null,
        onPrev: noop,
        onGuide: noop,
        onColumns: noop,
        onPointDefaults: noop,
        initial: { open: "combined" },
      }),
    );

  it("見本の案内を付ける。案内のほかはふつうに使えるときと同じ見るもの", () => {
    expect(v.sample).toBe(SAMPLE_PREVIEW_TEXT);
    const { sample: _s, ...rest } = v;
    void _s;
    expect(rest).toEqual(extensionViews(ext, values, home)[0]);
    expect(extensionViews(ext, values, home)[0]?.sample).toBeUndefined();
  });

  it("3つの段・相殺の組・純資産の内訳・何か月分・段階の1文が出て、貸付金の組の食い違いはお知らせになる", () => {
    expect(v.empty).toBeUndefined();
    expect(v.steps?.map((s) => s.label)).toEqual(["① 2枚を並べる", "② 貸し借りを相殺する", "③ 足して1枚にする"]);
    const keys = v.sections?.map((s) => s.key) ?? [];
    for (const k of ["pairs", "net", "months", "stage"]) expect(keys).toContain(k);
    expect(v.notices?.some((n) => n.includes("会社への貸付金") && n.includes("500万円") && n.includes("600万円"))).toBe(true);
    expect(v.notices?.some((n) => n.includes("二重には数えません"))).toBe(true);
    expect(JSON.stringify(v.sections)).toContain("成熟期");
  });

  it("画面: 見るものの切り替えと見るものの中に「見本」の印と案内。ふつうに使えるときは出さない", () => {
    const html = tab([v]);
    expect(html).toContain("data-bs-custom-sample");
    expect(html).toContain(SAMPLE_PREVIEW_TEXT);
    expect(html).toContain("bs-sample-tag");
    const plain = tab(extensionViews(ext, values, home));
    expect(plain).not.toContain("data-bs-custom-sample");
    expect(plain).not.toContain("bs-sample-tag");
  });

  it("提案書の章: 章の名前に「（見本）」を付け、見本の印を付ける章の id を出す。材料は同じ", () => {
    expect(extensionChapters(ext, samples)).toEqual([{ id: COMBINED_BS_EXTENSION, label: "会社と合わせたバランスシート（合算BS）（見本）" }]);
    expect(extensionChapters(ext)).toEqual([{ id: COMBINED_BS_EXTENSION, label: "会社と合わせたバランスシート（合算BS）" }]);
    expect(chapterIdsOf(ext, samples)).toEqual([COMBINED_BS_EXTENSION]);
    expect(chapterIdsOf(ext, new Set())).toEqual([]);
    expect(Object.keys(chapterMaterials(ext, values, home, new Set([COMBINED_BS_EXTENSION])))).toEqual([COMBINED_BS_EXTENSION]);
  });
});
