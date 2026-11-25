// 顧客番号の区分と通し番号・見本の棚（0033・0247）: 一覧の探し方・絞り込み、見本のセットと見出し・名前で探す、世帯の一覧の画面（初めの「区分を使いますか？」・区分を使わない形）
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { StoredHousehold } from "../src/engine/host.ts";
import { DEMO_HOUSEHOLDS } from "../src/workspace/catalog.ts";
import { CATEGORY_LATER, HouseholdPanel, copyRequest, defaultCategory, FICTIONAL_CONFIRM, type HouseholdPanelProps } from "../src/workspace/store/HouseholdPanel.tsx";
import { FIRST_SAMPLE_ID, firstSampleId, SAMPLE_SETS, shownSampleSets } from "../src/workspace/samples/sets.ts";
import { NO_FEATURES } from "../src/workspace/office/featureCodes.ts";
import { DEFAULT_FEATURES } from "../src/workspace/office/settings.ts";
import { categoryText, DEFAULT_CATEGORIES, filterCustomers, filterShelf, guessShape, matchesNumber, matchesSampleName, NO_CATEGORY, OWN_GROUP, ownSampleHeading, reservedSampleNames, sampleNameKey, SAMPLE_TRAITS, shapeText, shelfItems, shelfSections, type ShelfSet } from "../src/workspace/store/numbering.ts";
import { modelHousehold } from "./helpers.ts";

const row = (customerNo: string, label: Partial<StoredHousehold> = {}): StoredHousehold => ({ id: customerNo, customerNo, summary: "本人", createdAt: "2026-10-21T00:00:00Z", updatedAt: "2026-10-21T00:00:00Z", updatedBy: null, openBy: [], forks: 0, ...label });
const list = [
  row("A0042", { category: "A", serial: 42 }),
  row("A0042-1", { category: "A", serial: 42, branch: "1" }),
  row("C0042-C", { category: "C", serial: 42, branch: "C" }),
  row("B0420", { category: "B", serial: 420 }),
  // 今までの「PCの接頭辞＋連番」の番号（接頭辞 Z と A。番号の中身の欄が無いので区分なしの自由な番号）
  row("Z0042"),
  { ...row("A0043"), id: "old-a" },
  row("K-2019-42", { category: "A" }),
];
const nos = (q: string, cat = "") => filterCustomers(list, q, cat).map((h) => h.customerNo);
const CATS = [...DEFAULT_CATEGORIES];
/** コードの無いとき（はじめて使う人）に出すセット: ファイナンシアの見本だけ（法人経営者の見本はコードで出す。0247 の7） */
const SHOWN = shownSampleSets(SAMPLE_SETS, NO_FEATURES, DEFAULT_FEATURES);
const SHOWN_DEMOS = SHOWN.flatMap((set) => set.samples);

describe("一覧で番号を探す", () => {
  it("数字だけなら通し番号で（0042 でも 42 でも。枝番の世帯も出す）。自由な番号は番号の一部で", () => {
    expect(nos("42")).toEqual(["A0042", "A0042-1", "C0042-C", "Z0042", "K-2019-42"]);
    expect(nos("0042")).toEqual(["A0042", "A0042-1", "C0042-C", "Z0042"]);
    expect(nos("420")).toEqual(["B0420"]);
  });
  it("区分の記号つき（大文字・小文字を問わない）は区分と通し番号で。枝番まで入れればその世帯だけ", () => {
    expect(nos("A42")).toEqual(["A0042", "A0042-1"]);
    expect(nos("a0042-1")).toEqual(["A0042-1"]);
    expect(nos("c42-c")).toEqual(["C0042-C"]);
    expect(nos("k-2019")).toEqual(["K-2019-42"]);
    expect(nos("")).toHaveLength(list.length);
  });
  it("区分で絞り込む（区分なしも選べる）", () => {
    expect(nos("", "A")).toEqual(["A0042", "A0042-1", "K-2019-42"]);
    expect(nos("", NO_CATEGORY)).toEqual(["Z0042", "A0043"]);
    expect(nos("42", "C")).toEqual(["C0042-C"]);
    expect(matchesNumber(row("A0007", { category: "A", serial: 7 }), "7")).toBe(true);
  });
  it("今までの PC の接頭辞の番号（A0043 など）は、区分 A の体系の番号と取り違えない", () => {
    // 区分 A で絞り込んでも出ない（区分なし）。記号つきで探すと、区分 A の 43 番ではなく番号の一部で探す
    expect(nos("", "A")).not.toContain("A0043");
    expect(nos("A43")).toEqual([]);
    expect(nos("A0043")).toEqual(["A0043"]);
    // 数字だけで探すと、番号の一部で出る（通し番号は持たない）
    expect(nos("43")).toEqual(["A0043"]);
  });
  it("区分を使わない番号（0042）も数字だけで探せる", () => {
    const plain = [row("0042", { serial: 42 }), row("0042-1", { serial: 42, branch: "1" }), row("0420", { serial: 420 }), row("A0042")];
    const f = (q: string) => filterCustomers(plain, q, "").map((h) => h.customerNo);
    expect(f("42")).toEqual(["0042", "0042-1", "A0042"]);
    expect(f("0042")).toEqual(["0042", "0042-1", "A0042"]);
    expect(f("420")).toEqual(["0420"]);
  });
  it("区分の表示", () => {
    expect(categoryText(CATS, "A")).toBe("A 顧問契約");
    expect(categoryText(CATS, "Z")).toBe("Z");
    expect(categoryText(CATS, undefined)).toBe("区分なし");
    // 既定の区分は見込み客（C）。無ければ最初の区分、区分を使わないときは無し
    expect(CATS.map((c) => `${c.code} ${c.name}`)).toEqual(["A 顧問契約", "B 単発相談", "C 見込み客"]);
    expect(defaultCategory(CATS)).toBe("C");
    expect(defaultCategory([{ code: "K", name: "顧問" }])).toBe("K");
    expect(defaultCategory([])).toBeUndefined();
    // 開発中に保存した M・T・P の区分もそのまま使える（C が無ければ最初の区分）
    expect(defaultCategory([{ code: "M", name: "顧問契約" }, { code: "T", name: "単発相談" }, { code: "P", name: "見込み客" }])).toBe("M");
  });
});

describe("見本の棚（見本は番号を持たない。セットと見出し。0247 の2・3）", () => {
  const ownRow = (id: string, name: string, family: number, age: number, traits: string[] = []) => ({ ...row("", { sample: { name, traits, family, age } }), id });
  const own = [ownRow("own-b", "研修用", 3, 4, ["共働き"]), ownRow("own-a", "あいう研修", 1, 2), row("C0001", { category: "C", serial: 1 })];
  /** 2つ目のセット（配られたセットの形の確かめ用。架空） */
  const extra: ShelfSet = { id: "official.extra", name: "配られた見本", samples: [{ id: "x1", title: "配られた見本の世帯", traits: ["役員"], family: 3, age: 5 }] };
  const headings = { "official.basic": "ファイナンシアの見本", "official.extra": "配られた見本", [OWN_GROUP]: ownSampleHeading(false) };

  it("家族の形・本人の年代の説明。見本の名前の比べ方。アプリのすべてのセットの見本の名前は使えない名前として本体へ渡す", () => {
    expect(shapeText(4, 3)).toBe("ひとり親・30代");
    expect(shapeText(9, 3)).toBe("");
    expect(shapeText(3, 8)).toBe("");
    expect(sampleNameKey(" か\u3099 ")).toBe("が");
    const reserved = reservedSampleNames(SAMPLE_SETS);
    expect(reserved).toEqual(DEMO_HOUSEHOLDS.map((d) => d.title));
    expect(new Set(reserved.map(sampleNameKey)).size, "アプリの見本の名前は重ならない").toBe(reserved.length);
    expect(reservedSampleNames([...SAMPLE_SETS, extra])).toContain("配られた見本の世帯");
  });

  it("セットの定義: ID は「作成者.名前」。ファイナンシアの見本と、コードで出す法人経営者の見本（0247 の7）。見本の ID はセットの中で重ならない", () => {
    expect(SAMPLE_SETS.map((set) => [set.id, set.name, set.feature])).toEqual([
      ["official.basic", "ファイナンシアの見本", undefined],
      ["official.corporateOwner", "法人経営者の見本", "combinedBs"],
    ]);
    expect(SHOWN.map((set) => set.id)).toEqual(["official.basic"]);
    for (const set of SAMPLE_SETS) {
      expect(set.id).toMatch(/^[a-z][a-z0-9]*\.[a-z][A-Za-z0-9]*$/);
      expect(new Set(set.samples.map((d) => d.id)).size, set.id).toBe(set.samples.length);
    }
    expect(DEMO_HOUSEHOLDS).toHaveLength(16);
    expect(DEMO_HOUSEHOLDS.map((d) => d.id)).toEqual(SAMPLE_SETS.flatMap((set) => set.samples.map((d) => d.id)));
  });

  it("アプリの見本は名前・家族の形・年代・中身の版・絞り込みの項目を持ち、家族の形・年代は世帯の中身と合う", () => {
    for (const d of DEMO_HOUSEHOLDS) {
      expect(d.title.length, d.id).toBeGreaterThan(0);
      expect(shapeText(d.family, d.age), d.id).not.toBe("");
      expect(Number.isInteger(d.rev) && d.rev >= 1, d.id).toBe(true);
      expect(d).not.toHaveProperty("sampleNo");
      expect(d.traits.length, d.id).toBeGreaterThan(0);
      for (const t of d.traits) expect(SAMPLE_TRAITS, `${d.id} ${t}`).toContain(t);
      expect(guessShape(modelHousehold(d.id)), d.id).toEqual({ family: d.family, age: d.age });
    }
  });

  it("家族の形・年代の初めの値（guessShape）は、計算基準の月の満年齢で決まる（基準月が1〜3月・誕生月の前後）", () => {
    const req = modelHousehold("sampleSingle40s");
    const at = (baseMonth: string, birth: string) => {
      const r = structuredClone(req);
      r.input.baseMonth = baseMonth;
      const self = r.input.household.members.find((m) => m.kind === "self")!;
      self.birth.birthYearMonth = birth;
      return guessShape(r).age;
    };
    // 1980年3月生まれ: 2020年2月は39歳（30代）、2020年3月（誕生月）から40歳（40代）
    expect(at("2020-02", "1980-03")).toBe(3);
    expect(at("2020-03", "1980-03")).toBe(4);
    // 基準月が1月: 1月生まれはその月から、12月生まれは前の年の数え方のまま
    expect(at("2020-01", "1980-01")).toBe(4);
    expect(at("2020-01", "1979-12")).toBe(4);
    expect(at("2020-01", "1980-12")).toBe(3);
    // 20代より下・70代より上は 2・7 にまとめる
    expect(at("2026-10", "2008-01")).toBe(2);
    expect(at("2026-10", "1940-01")).toBe(7);
  });

  it("並び: セット（定義の順）→ 自分で作った見本（名前の順）。家族の形・年代はセットの定義と一覧の欄から読む", () => {
    const items = shelfItems(SAMPLE_SETS, own);
    expect(items.filter((i) => i.kind === "app").map((i) => i.id)).toEqual(DEMO_HOUSEHOLDS.map((d) => d.id));
    expect(items.filter((i) => i.kind === "app").map((i) => [i.id, i.group])).toEqual(SAMPLE_SETS.flatMap((set) => set.samples.map((d) => [d.id, set.id])));
    expect(items.filter((i) => i.kind === "own").map((i) => i.id)).toEqual(["own-a", "own-b"]);
    expect(items.slice(-2).map((i) => i.group)).toEqual([OWN_GROUP, OWN_GROUP]);
    for (const d of DEMO_HOUSEHOLDS) expect(items.find((i) => i.id === d.id), d.id).toMatchObject({ family: d.family, age: d.age, name: d.title });
    // 2つ目のセットはセットの定義の順で、自分で作った見本の前
    const two = shelfItems([...SAMPLE_SETS, extra], own);
    expect(two.map((i) => i.group).filter((g, n, a) => a.indexOf(g) === n)).toEqual(["official.basic", "official.corporateOwner", "official.extra", OWN_GROUP]);
    // 複製するときは同じ家族の形・年代で、名前に「（複製）」を付ける（0244）。前に付けた「（写し）」の名前はそのまま
    const app = items.find((i) => i.kind === "app") as (typeof items)[number];
    expect(copyRequest(app)).toMatchObject({ family: app.family, age: app.age, name: `${app.name}（複製）` });
    expect(copyRequest({ ...app, name: "研修用（写し）" })?.name).toBe("研修用（写し）（複製）");
  });

  it("絞り込み: 家族の形・年代は欄から（番号から読まない。全部0件にならない）・項目・名前の一部", () => {
    const items = shelfItems(SAMPLE_SETS, own);
    expect(filterShelf(items, { family: 3, age: 4, traits: ["共働き"] }).map((i) => i.id)).toContain("own-b");
    expect(filterShelf(items, { family: 1, age: 0, traits: [] }).every((i) => i.family === 1)).toBe(true);
    expect(filterShelf(items, { family: 1, age: 0, traits: [] }).filter((i) => i.kind === "app").length).toBeGreaterThan(0);
    expect(filterShelf(items, { family: 1, age: 2, traits: [] }).map((i) => i.id)).toContain("own-a");
    for (const f of [1, 2, 3, 4, 5]) expect(filterShelf(items, { family: f, age: 0, traits: [] }).length, String(f)).toBeGreaterThan(0);
    // 名前で探す: 名前の一部。全角と半角・大文字と小文字・前後の空白は問わない。空白で区切るとどれも入っている物だけ
    expect(filterShelf(items, { family: 0, age: 0, traits: [], name: "研修" }).map((i) => i.id)).toEqual(["own-a", "own-b"]);
    expect(filterShelf(items, { family: 0, age: 0, traits: [], name: "  ひとり親 " }).map((i) => i.id)).toEqual(["sampleSingleParent"]);
    expect(filterShelf(items, { family: 0, age: 0, traits: [], name: "４０代　会社員" }).map((i) => i.id)).toEqual(["sampleSingle40s"]);
    expect(filterShelf(items, { family: 0, age: 0, traits: [], name: "" })).toHaveLength(items.length);
    expect(filterShelf(items, { family: 0, age: 0, traits: [], name: "宇宙飛行士" })).toEqual([]);
    expect(matchesSampleName("合算BS の見本", "bs")).toBe(true);
    expect(matchesSampleName("合算BS の見本", "ＢＳ")).toBe(true);
    // 名前と家族の形を一緒に
    expect(filterShelf(items, { family: 1, age: 0, traits: [], name: "研修" }).map((i) => i.id)).toEqual(["own-a"]);
  });

  it("見出し: 出ている種類が2つ以上のときだけ。行の無い種類は出さない。自分で作った見本の見出しは事務所の共有で「事務所で作った見本」", () => {
    // 自分で作った見本が無い（ファイナンシアの見本だけ）: 見出しなし
    const basic = shelfSections(shelfItems(SHOWN, []), headings);
    expect(basic.map((s) => [s.group, s.heading, s.items.length])).toEqual([["official.basic", null, SHOWN_DEMOS.length]]);
    // ある: 見出し2つ
    const items = shelfItems(SHOWN, own);
    expect(shelfSections(items, headings).map((s) => [s.heading, s.items.length])).toEqual([
      ["ファイナンシアの見本", SHOWN_DEMOS.length],
      ["自分で作った見本", 2],
    ]);
    expect(shelfSections(items, { ...headings, [OWN_GROUP]: ownSampleHeading(true) }).map((s) => s.heading)).toEqual(["ファイナンシアの見本", "事務所で作った見本"]);
    expect(ownSampleHeading(false)).toBe("自分で作った見本");
    // 絞り込みで片方が0件: その種類の見出しを出さず、残りが1つなら見出しなし
    expect(shelfSections(filterShelf(items, { family: 0, age: 0, traits: [], name: "研修" }), headings).map((s) => [s.group, s.heading])).toEqual([[OWN_GROUP, null]]);
    expect(shelfSections(filterShelf(items, { family: 4, age: 0, traits: [] }), headings).map((s) => [s.group, s.heading])).toEqual([["official.basic", null]]);
    expect(shelfSections([], headings)).toEqual([]);
    // 3つの種類（配られたセットがあるとき）: 定義の順
    expect(shelfSections(shelfItems([...SHOWN, extra], own), headings).map((s) => s.heading)).toEqual(["ファイナンシアの見本", "配られた見本", "自分で作った見本"]);
    expect(shelfSections(shelfItems([...SHOWN, extra], []), headings).map((s) => s.heading)).toEqual(["ファイナンシアの見本", "配られた見本"]);
  });

  it("起動のときに開く見本は ID で決める（並びの先頭ではない）。無ければ並びの先頭", () => {
    expect(FIRST_SAMPLE_ID).toBe("salariedCoupleTwoKids");
    expect(firstSampleId(DEMO_HOUSEHOLDS)).toBe("salariedCoupleTwoKids");
    expect(firstSampleId([{ id: "sampleSingle20s" }, { id: "salariedCoupleTwoKids" }])).toBe("salariedCoupleTwoKids");
    expect(firstSampleId([{ id: "sampleSingle20s" }])).toBe("sampleSingle20s");
    expect(firstSampleId([])).toBeUndefined();
  });
});

describe("世帯の一覧の画面", () => {
  const base: HouseholdPanelProps = {
    status: { state: "ready", firstRun: false, recoveryAcknowledged: true, recoveryVerifiedAt: null, lastOpened: null, deletionsPending: 0, deletionsCompleted: 0 },
    unavailable: null,
    error: null,
    list,
    currentId: null,
    categories: CATS,
    shelf: shelfItems(SHOWN, [{ ...row("", { sample: { name: "夫婦のみ・研修用", traits: [], family: 2, age: 3 } }), id: "own-1" }]),
    currentSample: null,
    currentShape: null,
    unsavedTitle: null,
    onOpen: () => undefined,
    onCreate: () => undefined,
    onSaveCurrent: () => undefined,
    onRename: async () => null,
    onSetCategory: async () => null,
    onAssignSerial: async () => null,
    onMakeSample: async () => null,
    onSaveCategories: async () => null,
    onDelete: async () => null,
    onOpenSample: () => undefined,
    onCustomerFromSample: () => undefined,
    onCopySample: () => undefined,
    onUpdateSample: async () => null,
    onRecovery: () => undefined,
    onClose: () => undefined,
  };
  it("顧客の一覧: 区分の列・番号で探す・区分の絞り込み・自由な番号の印。見本は混ぜない", () => {
    const html = renderToString(h(HouseholdPanel, base));
    expect(html).toContain("data-household-search");
    expect(html).toContain("data-category-filter");
    expect(html).toContain("A 顧問契約");
    expect(html).toContain('data-household-row="A0042-1"');
    expect(html).toContain("自由な番号");
    expect(html).toContain('data-assign-serial="A0043"');
    expect(html).not.toContain('data-assign-serial="A0042"');
    expect(html).toContain('data-change-category="A0042"');
    expect(html).not.toContain("data-category-choice");
    expect(html).not.toContain("data-sample-row");
    // タブの数は出ている見本の数だけ（「うち自分で作った見本」は出さない。0247 の2）
    expect(html).toContain(`見本（${base.shelf.length}）`);
    expect(html).not.toContain("うち自分で作った見本");
  });
  it("見本の一覧: 見本番号の列は無く、名前・家族と年代・項目。アプリの見本は直せない（消す・名前を直すは自分で作った見本だけ）", () => {
    const html = renderToString(h(HouseholdPanel, { ...base, initialTab: "samples" }));
    expect(html).toContain('data-sample-row="salariedCoupleTwoKids"');
    expect(html).toContain('data-customer-from-sample="salariedCoupleTwoKids"');
    expect(html).toContain('data-copy-sample="salariedCoupleTwoKids"');
    expect(html).not.toContain('data-delete-sample="salariedCoupleTwoKids"');
    expect(html).toContain('data-delete-sample="own-1"');
    expect(html).not.toContain("data-household-row");
    expect(html).not.toContain("見本番号");
    expect(html).not.toMatch(/\d-\d-\d{2}/);
    expect(html).toContain("<td class=\"hh-nowrap\">夫婦のみ・30代</td>");
    expect(html).toContain("はじめから入っている見本は直せません");
  });
  it("見本の一覧の見出し: 種類が2つ以上のときだけ（ファイナンシアの見本と自分で作った見本）。事務所の共有では「事務所で作った見本」。名前で探す欄", () => {
    const heads = (html: string) => [...html.matchAll(/data-shelf-heading[^>]*>([^<]*)</g)].map((m) => m[1]);
    const withOwn = renderToString(h(HouseholdPanel, { ...base, initialTab: "samples" }));
    expect(heads(withOwn)).toEqual(["ファイナンシアの見本", "自分で作った見本"]);
    expect(withOwn).toContain('data-shelf-group="official.basic"');
    expect(withOwn).toContain(`data-shelf-group="${OWN_GROUP}"`);
    expect(withOwn).toContain("data-shelf-name");
    expect(withOwn).toContain("名前で探す");
    // 自分で作った見本の行は、見出しの下（ファイナンシアの見本の後）
    expect(withOwn.indexOf('data-sample-row="own-1"')).toBeGreaterThan(withOwn.indexOf("自分で作った見本<"));
    expect(withOwn.indexOf('data-sample-row="sampleFamilyDreams"')).toBeLessThan(withOwn.indexOf("自分で作った見本<"));
    // 自分で作った見本が無い（はじめて使う人）: 見出しを出さない
    const basicOnly = renderToString(h(HouseholdPanel, { ...base, initialTab: "samples", shelf: shelfItems(SHOWN, []) }));
    expect(heads(basicOnly)).toEqual([]);
    expect(basicOnly).not.toContain("ファイナンシアの見本");
    expect(basicOnly).toContain(`見本（${SHOWN_DEMOS.length}）`);
    // 事務所の共有・1人で複数の PC の同期フォルダ
    expect(heads(renderToString(h(HouseholdPanel, { ...base, initialTab: "samples", officeState: "member", usage: "office" })))).toEqual(["ファイナンシアの見本", "事務所で作った見本"]);
    expect(heads(renderToString(h(HouseholdPanel, { ...base, initialTab: "samples", officeState: "member", usage: "personal" })))).toEqual(["ファイナンシアの見本", "自分で作った見本"]);
  });
  it("見本の完全削除の確かめは見本の名前。見本に登録の文に番号の話を書かない。名前と項目を直すで家族の形・年代も直せる", () => {
    const panel = readFileSync(new URL("../src/workspace/store/HouseholdPanel.tsx", import.meta.url), "utf8");
    expect(panel).toContain("確認のため見本の名前（{s.name}）を入れてください");
    // 入力欄で字数を切らない（maxLength は UTF-16 の数で、名前の上限〔40字〕と数え方が違う。合うまで押せないので足りる。0247）
    expect(panel).toContain('<input value={sampleDelete.value} aria-label="確認の見本の名前"');
    expect(panel).toContain('disabled={busy || sampleDelete.value.trim() === "" || sampleNameKey(sampleDelete.value) !== sampleNameKey(s.name)}');
    expect(panel).not.toContain("見本番号");
    expect(panel).not.toContain("shapeFixed />");
    expect(panel).toContain("p.onUpdateSample(s.id, name, sampleEdit.traits, sampleEdit.family, sampleEdit.age)");
  });
  it("区分を使うかまだ決めていないときは、1回だけ「区分を使いますか？」と聞く（あとから変えられる一文つき）。新しく作るは答えてから", () => {
    const html = renderToString(h(HouseholdPanel, { ...base, list: [], categories: [], categoriesDecided: false }));
    expect(html).toContain("data-category-choice");
    expect(html).toContain("区分を使いますか？");
    expect(html).toContain("data-category-choice-use");
    expect(html).toContain("data-category-choice-none");
    expect(html).toContain(CATEGORY_LATER);
    expect(CATEGORY_LATER).toContain("世帯の一覧の下の「区分を設定する」");
    expect(CATEGORY_LATER).toContain("通し番号");
    expect(html).not.toContain("data-create-blank");
    // 決めた後は聞かない
    expect(renderToString(h(HouseholdPanel, { ...base, categoriesDecided: true }))).not.toContain("data-category-choice");
  });
  it("区分を使わないとき: 区分の列・絞り込み・「区分を変える」・区分を選ぶ欄を出さない。番号は通し番号だけ", () => {
    const plain = [row("0001", { serial: 1 }), row("0002", { serial: 2 }), row("A0007")];
    const html = renderToString(h(HouseholdPanel, { ...base, list: plain, categories: [], categoriesDecided: true, unsavedTitle: "新しい世帯" }));
    expect(html).not.toContain("data-category-filter");
    expect(html).not.toContain("data-household-category");
    expect(html).not.toContain("data-change-category");
    expect(html).not.toContain("新しい世帯の区分");
    expect(html).not.toContain("保存するときの区分");
    expect(html).toContain("例: 42、0042");
    expect(html).toContain("顧客番号は通し番号で自動で付きます（例 0042）");
    expect(html).toContain("区分を使っていません");
    expect(html).toContain("data-edit-categories");
    expect(html).toContain('data-assign-serial="A0007"');
    expect(html).not.toContain('data-assign-serial="0001"');
  });
  it("見本に登録するときの確認の文", () => {
    expect(FICTIONAL_CONFIRM).toBe("中身は架空です（実在のお客さまの情報を入れていません）");
  });
});
