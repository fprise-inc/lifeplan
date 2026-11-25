// 合算BS の見本（0197 の1）と、法人経営者の見本のセット（0247 の7）: 会社の数字を入れた見本の世帯（sampleOwnerCompany。架空）は、
// 機能を有効にするコード（0110）で出す見本のセット「法人経営者の見本」に入る。セットは合算BS が出るのと同じ条件（コードが今使えて、
// 事務所の既定値の印があるとき）でだけ出す。コードの無いときは、見本でも合算BS を見せない（見本の世帯でだけコードなしで見せる扱いは外した）
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { hasCompanyAmounts, readCombinedInput } from "../../sdk/examples/extensions/combined-bs/parts/combinedBs.ts";
import { BalanceTab } from "../src/presentation/BalanceTab.tsx";
import type { BsCustomViewModel } from "../src/presentation/model.ts";
import { balanceTabModel, bsPlan, defaultGuideBasis, DEFAULT_BS_GUIDE, DEFAULT_BS_POINTS } from "../src/workspace/balanceTab.ts";
import { DEMO_HOUSEHOLDS, demoHousehold } from "../src/workspace/catalog.ts";
import { COMBINED_BS_EXTENSION, OFFICIAL_EXTENSIONS } from "../src/workspace/extensions/official.ts";
import * as run from "../src/workspace/extensions/run.ts";
import { activeExtensions, chapterMaterials, demoExtValues, extensionChapters, extensionViews } from "../src/workspace/extensions/run.ts";
import { hasExecutive } from "../src/workspace/input/officer.ts";
import { NO_FEATURES } from "../src/workspace/office/featureCodes.ts";
import { DEFAULT_OFFICE_SETTINGS } from "../src/workspace/office/settings.ts";
import { firstSampleId, SAMPLE_SETS, sampleSetShown, shownSampleSets } from "../src/workspace/samples/sets.ts";
import { HouseholdPanel, type HouseholdPanelProps } from "../src/workspace/store/HouseholdPanel.tsx";
import { OWN_GROUP, ownSampleHeading, reservedSampleNames, shelfItems, shelfSections } from "../src/workspace/store/numbering.ts";
import type { FeatureCodeView, FeatureStatus, StoredHousehold } from "../src/engine/host.ts";
import { modelHousehold, preview } from "./helpers.ts";

const ID = "sampleOwnerCompany";
const demo = demoHousehold(ID)!;
const req = modelHousehold(ID);
const hh = req.input.household;
const values = demoExtValues(OFFICIAL_EXTENSIONS, demo.extValues);
const code = (state: FeatureCodeView["state"]): FeatureCodeView => ({ ref: "r1", id: "c1", name: "試験", features: ["combinedBs"], issued: "2026-10-01", expires: "2027-10-01", state, daysLeft: state === "expired" ? -3 : 300, notice: false, noticeSince: null });
const on: FeatureStatus = { ...NO_FEATURES, active: ["combinedBs"], codes: [code("active")] };
const expiring: FeatureStatus = { ...NO_FEATURES, active: ["combinedBs"], codes: [code("expiring")] };
const expired: FeatureStatus = { ...NO_FEATURES, codes: [code("expired")] };
const revoked: FeatureStatus = { ...NO_FEATURES, codes: [code("revoked")] };
const officeOn = { ...DEFAULT_OFFICE_SETTINGS.features, combinedBs: true };
const officeOff = DEFAULT_OFFICE_SETTINGS.features;
const ids = (xs: readonly { id: string }[]) => xs.map((x) => x.id);
const extIds = (xs: readonly { manifest: { id: string } }[]) => xs.map((x) => x.manifest.id);
const M = 10000;
const noop = () => undefined;
const BASIC = SAMPLE_SETS.find((s) => s.id === "official.basic")!;
const OWNER = SAMPLE_SETS.find((s) => s.id === "official.corporateOwner")!;
/** 法人経営者の見本の名前・見出し・合算BS の言葉（コードの無いときは画面のどこにも出さない） */
const HIDDEN_WORDS = ["法人経営者", "合算BS", OWNER.samples[0]!.title, ID];
/** コードのある・無いの組（出すのは「コードが今使える」かつ「事務所の既定値の印」のときだけ） */
const CASES: { name: string; features: FeatureStatus; office: typeof officeOn; shown: boolean }[] = [
  { name: "コードと印がある", features: on, office: officeOn, shown: true },
  { name: "コードの期限が近い（30日以内）・印がある", features: expiring, office: officeOn, shown: true },
  { name: "コードが無い・印がある", features: NO_FEATURES, office: officeOn, shown: false },
  { name: "コードがある・印が無い", features: on, office: officeOff, shown: false },
  { name: "コードの期限が切れた・印がある", features: expired, office: officeOn, shown: false },
  { name: "コードを提供元が止めた・印がある", features: revoked, office: officeOn, shown: false },
  { name: "コードも印も無い（はじめて使う人）", features: NO_FEATURES, office: officeOff, shown: false },
];

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
    expect(DEMO_HOUSEHOLDS.filter((d) => d.extValues !== undefined).map((d) => d.id)).toEqual([ID]);
  });
});

describe("法人経営者の見本のセット（0247 の7）", () => {
  it("セット official.corporateOwner（「法人経営者の見本」）は合算BS と同じ機能の名前で、合算BS の見本の世帯だけを持つ。ファイナンシアの見本には入れない", () => {
    expect(SAMPLE_SETS.map((s) => [s.id, s.name, s.feature])).toEqual([
      ["official.basic", "ファイナンシアの見本", undefined],
      ["official.corporateOwner", "法人経営者の見本", "combinedBs"],
    ]);
    expect(ids(OWNER.samples)).toEqual([ID]);
    expect(ids(BASIC.samples)).not.toContain(ID);
    expect(OFFICIAL_EXTENSIONS.find((x) => x.manifest.id === COMBINED_BS_EXTENSION)?.manifest.activation?.feature).toBe(OWNER.feature);
    // 名前に機能の名前（「（合算BS の見本）」）を付けない
    expect(OWNER.samples[0]?.title).toBe("会社を経営する夫婦と子1人・50代");
    for (const d of DEMO_HOUSEHOLDS) expect(d.title, d.id).not.toContain("合算BS");
    // 見本の名前に使えない名前は、出していないセットの見本も含む（0247 の1）
    expect(reservedSampleNames(SAMPLE_SETS)).toContain(OWNER.samples[0]!.title);
  });

  for (const c of CASES) {
    it(`${c.name}: セットを${c.shown ? "出す" : "出さない"}。合算BS が出る条件（activeExtensions）と同じ`, () => {
      expect(sampleSetShown(OWNER, c.features, c.office)).toBe(c.shown);
      expect(extIds(activeExtensions(OFFICIAL_EXTENSIONS, { features: c.features, office: c.office, household: hh })).includes(COMBINED_BS_EXTENSION)).toBe(c.shown);
      // ファイナンシアの見本はいつも出す
      expect(sampleSetShown(BASIC, c.features, c.office)).toBe(true);
      expect(ids(shownSampleSets(SAMPLE_SETS, c.features, c.office))).toEqual(c.shown ? ["official.basic", "official.corporateOwner"] : ["official.basic"]);
      // 起動のときに開く見本は、どちらでもファイナンシアの見本の決まった見本
      expect(firstSampleId(shownSampleSets(SAMPLE_SETS, c.features, c.office).flatMap((s) => s.samples))).toBe("salariedCoupleTwoKids");
    });
  }

  it("事務所の既定値の印が空（欄が無い・false）でも出さない。印は true のときだけ", () => {
    expect(sampleSetShown(OWNER, on, {} as typeof officeOn)).toBe(false);
    expect(sampleSetShown(OWNER, on, { combinedBs: false })).toBe(false);
    expect(sampleSetShown(OWNER, on, { combinedBs: true })).toBe(true);
  });

  it("セットを出すかは世帯の中身に頼らない（計算基準月が1〜3月・誕生月の前後で変わらない）。合算BS の条件も基準月で変わらない", () => {
    for (const baseMonth of ["2027-01", "2027-02", "2027-03", "2026-12"]) {
      const moved = { ...req.input, baseMonth };
      for (const c of CASES) expect(extIds(activeExtensions(OFFICIAL_EXTENSIONS, { features: c.features, office: c.office, household: moved.household })).includes(COMBINED_BS_EXTENSION), `${baseMonth} ${c.name}`).toBe(c.shown);
    }
  });
});

describe("見本の一覧（世帯の一覧の画面）", () => {
  const status = { state: "ready", firstRun: false, recoveryAcknowledged: true, recoveryVerifiedAt: null, lastOpened: null, deletionsPending: 0, deletionsCompleted: 0 } as const;
  const own: StoredHousehold = { id: "own-1", customerNo: "", summary: "本人", createdAt: "2026-10-21T00:00:00Z", updatedAt: "2026-10-21T00:00:00Z", updatedBy: null, openBy: [], forks: 0, sample: { name: "夫婦のみ・研修用", traits: [], family: 2, age: 3 } };
  const panel = (features: FeatureStatus, office: typeof officeOn, owned: StoredHousehold[] = []): HouseholdPanelProps => ({
    status,
    unavailable: null,
    error: null,
    list: [],
    currentId: null,
    categories: [],
    shelf: shelfItems(shownSampleSets(SAMPLE_SETS, features, office), owned),
    currentSample: null,
    currentShape: null,
    unsavedTitle: null,
    initialTab: "samples",
    onOpen: noop,
    onCreate: noop,
    onSaveCurrent: noop,
    onRename: async () => null,
    onSetCategory: async () => null,
    onAssignSerial: async () => null,
    onMakeSample: async () => null,
    onSaveCategories: async () => null,
    onDelete: async () => null,
    onOpenSample: noop,
    onCustomerFromSample: noop,
    onCopySample: noop,
    onUpdateSample: async () => null,
    onRecovery: noop,
    onClose: noop,
  });
  const heads = (html: string) => [...html.matchAll(/data-shelf-heading[^>]*>([^<]*)</g)].map((m) => m[1]);
  const headings = { ...Object.fromEntries(SAMPLE_SETS.map((s) => [s.id, s.name])), [OWN_GROUP]: ownSampleHeading(false) };

  it("コードと印があるとき: 見出し「ファイナンシアの見本」「法人経営者の見本」。法人経営者の見本の行は、ファイナンシアの見本の後。数に入る", () => {
    const html = renderToString(h(HouseholdPanel, panel(on, officeOn)));
    expect(heads(html)).toEqual(["ファイナンシアの見本", "法人経営者の見本"]);
    expect(html).toContain('data-shelf-group="official.corporateOwner"');
    expect(html).toContain(`data-sample-row="${ID}"`);
    expect(html).toContain(OWNER.samples[0]!.title);
    expect(html.indexOf(`data-sample-row="${ID}"`)).toBeGreaterThan(html.indexOf('data-sample-row="sampleFamilyDreams"'));
    expect(html).toContain(`見本（${BASIC.samples.length + 1}）`);
    // セットの見本は直せない（完全削除・名前を直すは自分で作った見本だけ）。この見本をもとに顧客を作る・複製するは出す
    expect(html).not.toContain(`data-delete-sample="${ID}"`);
    expect(html).toContain(`data-customer-from-sample="${ID}"`);
    expect(html).toContain(`data-copy-sample="${ID}"`);
    // 自分で作った見本もあると、見出しは3つ（定義の順 → 自分で作った見本）
    expect(heads(renderToString(h(HouseholdPanel, panel(on, officeOn, [own]))))).toEqual(["ファイナンシアの見本", "法人経営者の見本", "自分で作った見本"]);
    // 絞り込みで法人経営者の見本が0件なら、その見出しは出さない（残りが1つなら見出しなし）
    const items = shelfItems(shownSampleSets(SAMPLE_SETS, on, officeOn), []);
    expect(shelfSections(items.filter((i) => i.family === 4), headings).map((s) => [s.group, s.heading])).toEqual([["official.basic", null]]);
    expect(shelfSections(items.filter((i) => i.id === ID), headings).map((s) => [s.group, s.heading])).toEqual([["official.corporateOwner", null]]);
  });

  for (const c of CASES.filter((x) => !x.shown)) {
    it(`${c.name}: セットの見出し・行・数・名前を出さない（ファイナンシアの見本だけ・見出しなし）`, () => {
      const html = renderToString(h(HouseholdPanel, panel(c.features, c.office)));
      expect(heads(html)).toEqual([]);
      expect(html).not.toContain('data-shelf-group="official.corporateOwner"');
      expect(html).toContain(`見本（${BASIC.samples.length}）`);
      for (const w of HIDDEN_WORDS) expect(html, w).not.toContain(w);
      // 自分で作った見本があっても、出るのはファイナンシアの見本と自分で作った見本の見出しだけ
      const withOwn = renderToString(h(HouseholdPanel, panel(c.features, c.office, [own])));
      expect(heads(withOwn)).toEqual(["ファイナンシアの見本", "自分で作った見本"]);
      for (const w of HIDDEN_WORDS) expect(withOwn, w).not.toContain(w);
    });
  }
});

describe("見本の世帯でだけコードなしで見せる扱いは無い（0197 の2〜4 を 0247 の7 で外した）", () => {
  it("作業の層に、見本の世帯でだけ見せる束・見本の案内・見本から作ったときの知らせ・章の「（見本）」の部品が無い", () => {
    for (const name of ["sampleExtensions", "SAMPLE_PREVIEW_TEXT", "SAMPLE_SAVED_TEXT", "savedSampleNotice", "chapterIdsOf"]) expect(Object.keys(run), name).not.toContain(name);
    const app = readFileSync(new URL("../src/workspace/App.tsx", import.meta.url), "utf8");
    for (const w of ["sampleExtensions", "previewExts", "previewIds", "previewRef", "featuresRef", "appSample =", "SAMPLE_SAVED_TEXT", "keptHidden"]) expect(app, w).not.toContain(w);
    // 見本の棚・開く・起動のときの最初の見本は、今出すセット（shownSampleSets）だけを使う
    expect(app).toContain("shownSampleSets(SAMPLE_SETS, featureStatus, officeSettings.features)");
    expect(app).toContain("shelfItems(shownSets, storedSamples)");
    expect(app).toContain('item.kind === "app" ? shownDemos.some((d) => d.id === item.id) && (await open(item.id))');
    expect(app).toContain("firstSampleId(shownDemos)");
    expect(app).not.toContain("firstSampleId(households)");
    const report = readFileSync(new URL("../src/workspace/report/assemble.ts", import.meta.url), "utf8");
    expect(report).not.toContain("extensionSamples");
    expect(report).not.toContain("sampleExtensions");
  });

  it("コードの無いときは、見本の世帯を（開発用の入口で）開いても合算BS の見るもの・提案書の章が出ない", () => {
    const plan = bsPlan({ key: "A", letter: "A", name: "現状", title: "", base: true, req, table: preview(req).table });
    const home = plan.years[0]!;
    for (const c of CASES.filter((x) => !x.shown)) {
      const ext = activeExtensions(OFFICIAL_EXTENSIONS, { features: c.features, office: c.office, household: hh });
      expect(ext, c.name).toEqual([]);
      expect(extensionViews(ext, values, home)).toEqual([]);
      expect(extensionChapters(ext)).toEqual([]);
      expect(chapterMaterials(ext, values, home, new Set([COMBINED_BS_EXTENSION]))).toEqual({});
    }
  });
});

describe("コードと印があるときの、法人経営者の見本の合算BS（ふつうに出る。「見本」の印は無い）", () => {
  const plan = bsPlan({ key: "A", letter: "A", name: "現状", title: "", base: true, req, table: preview(req).table });
  const home = plan.years[0]!;
  const ext = activeExtensions(OFFICIAL_EXTENSIONS, { features: on, office: officeOn, household: hh });
  const v = extensionViews(ext, values, home)[0]!;
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

  it("3つの段・相殺の組・純資産の内訳・何か月分・段階の1文が出て、貸付金の組の食い違いはお知らせになる", () => {
    expect(extIds(ext)).toEqual([COMBINED_BS_EXTENSION]);
    expect(v.empty).toBeUndefined();
    expect(v.steps?.map((s) => s.label)).toEqual(["① 2枚を並べる", "② 貸し借りを相殺する", "③ 足して1枚にする"]);
    const keys = v.sections?.map((s) => s.key) ?? [];
    for (const k of ["pairs", "net", "months", "stage"]) expect(keys).toContain(k);
    expect(v.notices?.some((n) => n.includes("会社への貸付金") && n.includes("500万円") && n.includes("600万円"))).toBe(true);
    expect(v.notices?.some((n) => n.includes("二重には数えません"))).toBe(true);
    expect(JSON.stringify(v.sections)).toContain("成熟期");
  });

  it("見るものに「見本」の印と案内が無い。見るものの形に見本の欄が無い", () => {
    expect(Object.keys(v)).not.toContain("sample");
    const html = tab([v]);
    expect(html).toContain('data-bs-sub="ext.official.combinedBs"');
    expect(html).not.toContain("data-bs-custom-sample");
    expect(html).not.toContain("bs-sample-tag");
    expect(html).not.toContain("見本の世帯でご覧いただいている");
  });

  it("提案書の章: 名前に「（見本）」を付けない。材料は選んだときだけ", () => {
    expect(extensionChapters(ext)).toEqual([{ id: COMBINED_BS_EXTENSION, label: "会社と合わせたバランスシート（合算BS）" }]);
    expect(Object.keys(chapterMaterials(ext, values, home, new Set([COMBINED_BS_EXTENSION])))).toEqual([COMBINED_BS_EXTENSION]);
    expect(chapterMaterials(ext, values, home, new Set())).toEqual({});
  });
});
