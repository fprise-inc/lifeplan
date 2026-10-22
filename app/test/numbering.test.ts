// 顧客番号の区分と通し番号・見本の棚（0033）: 一覧の探し方・絞り込み、見本番号の読み方、世帯の一覧の画面（初めの「区分を使いますか？」・区分を使わない形）
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import type { StoredHousehold } from "../src/engine/host.ts";
import { DEMO_HOUSEHOLDS } from "../src/workspace/catalog.ts";
import { CATEGORY_LATER, HouseholdPanel, copyRequest, defaultCategory, FICTIONAL_CONFIRM, type HouseholdPanelProps } from "../src/workspace/store/HouseholdPanel.tsx";
import { categoryText, DEFAULT_CATEGORIES, filterCustomers, filterShelf, guessShape, matchesNumber, NO_CATEGORY, parseSampleNo, sampleNoText, SAMPLE_TRAITS, shelfItems } from "../src/workspace/store/numbering.ts";
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

describe("見本番号と見本の棚", () => {
  it("家族の形-年代-順番", () => {
    expect(parseSampleNo("3-4-01")).toEqual({ family: 3, age: 4, order: 1 });
    expect(parseSampleNo("6-4-01")).toBeNull();
    expect(parseSampleNo("3-4-1")).toBeNull();
    expect(sampleNoText("4-3-10")).toBe("ひとり親・30代");
  });
  it("アプリの見本はすべて番号が重ならず、順番は01〜09。名前と絞り込みの項目がある", () => {
    const seen = new Set<string>();
    for (const d of DEMO_HOUSEHOLDS) {
      const p = parseSampleNo(d.sampleNo);
      expect(p, d.id).not.toBeNull();
      expect(p?.order ?? 0, d.id).toBeLessThanOrEqual(9);
      expect(seen.has(d.sampleNo), d.sampleNo).toBe(false);
      seen.add(d.sampleNo);
      expect(d.traits.length, d.id).toBeGreaterThan(0);
      for (const t of d.traits) expect(SAMPLE_TRAITS, `${d.id} ${t}`).toContain(t);
      // 見本番号の家族の形・年代が、世帯の中身と合う
      const g = guessShape(modelHousehold(d.id));
      expect(`${g.family}-${g.age}`, d.id).toBe(d.sampleNo.slice(0, 3));
    }
  });
  it("アプリの見本と自分で作った見本を番号の順に並べ、家族の形・年代・項目で絞り込む", () => {
    const own = [row("3-4-10", { sample: { no: "3-4-10", name: "研修用", traits: ["共働き"] } }), row("C0001", { category: "C", serial: 1 })];
    const items = shelfItems(
      DEMO_HOUSEHOLDS.map((d) => ({ id: d.id, sampleNo: d.sampleNo, title: d.title, traits: d.traits })),
      own,
    );
    expect(items.map((i) => i.no)).toEqual([...items.map((i) => i.no)].sort());
    expect(items.filter((i) => i.kind === "own").map((i) => i.no)).toEqual(["3-4-10"]);
    expect(filterShelf(items, { family: 3, age: 4, traits: ["共働き"] }).map((i) => i.no)).toContain("3-4-10");
    expect(filterShelf(items, { family: 1, age: 0, traits: [] }).every((i) => i.no.startsWith("1-"))).toBe(true);
    // 写すときは同じ家族の形・年代で、名前に「写し」を付ける
    const app = items.find((i) => i.kind === "app") as (typeof items)[number];
    expect(copyRequest(app)).toMatchObject({ family: Number(app.no[0]), age: Number(app.no[2]), name: `${app.name}（写し）` });
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
    shelf: shelfItems(
      DEMO_HOUSEHOLDS.map((d) => ({ id: d.id, sampleNo: d.sampleNo, title: d.title, traits: d.traits })),
      [row("2-3-10", { sample: { no: "2-3-10", name: "夫婦のみ・研修用", traits: [] } })],
    ),
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
    expect(html).toContain(`見本（${base.shelf.length}・うち自分で作った見本 1）`);
  });
  it("見本の一覧: 見本番号の順、アプリの見本は直せない（消す・名前を直すは自分で作った見本だけ）", () => {
    const html = renderToString(h(HouseholdPanel, { ...base, initialTab: "samples" }));
    expect(html).toContain('data-sample-row="3-4-01"');
    expect(html).toContain('data-customer-from-sample="3-4-01"');
    expect(html).toContain('data-copy-sample="3-4-01"');
    expect(html).not.toContain('data-delete-sample="3-4-01"');
    expect(html).toContain('data-delete-sample="2-3-10"');
    expect(html).not.toContain("data-household-row");
    expect(html).toContain("01〜09 はアプリに入っている見本");
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
