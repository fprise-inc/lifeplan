// 顧客番号の区分と通し番号・見本の棚（0033）: 一覧の探し方・絞り込み、見本番号の読み方、世帯の一覧の画面
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import type { StoredHousehold } from "../src/engine/host.ts";
import { DEMO_HOUSEHOLDS } from "../src/workspace/catalog.ts";
import { HouseholdPanel, copyRequest, defaultCategory, FICTIONAL_CONFIRM, type HouseholdPanelProps } from "../src/workspace/store/HouseholdPanel.tsx";
import { categoryText, filterCustomers, filterShelf, guessShape, matchesNumber, NO_CATEGORY, parseSampleNo, sampleNoText, SAMPLE_TRAITS, shelfItems } from "../src/workspace/store/numbering.ts";
import { modelHousehold } from "./helpers.ts";

const row = (customerNo: string, label: Partial<StoredHousehold> = {}): StoredHousehold => ({ id: customerNo, customerNo, summary: "本人", createdAt: "2026-10-21T00:00:00Z", updatedAt: "2026-10-21T00:00:00Z", updatedBy: null, openBy: [], forks: 0, ...label });
const list = [
  row("M0042", { category: "M", serial: 42 }),
  row("M0042-1", { category: "M", serial: 42, branch: "1" }),
  row("P0042-C", { category: "P", serial: 42, branch: "C" }),
  row("T0420", { category: "T", serial: 420 }),
  row("A0042"),
  row("K-2019-42", { category: "M" }),
];
const nos = (q: string, cat = "") => filterCustomers(list, q, cat).map((h) => h.customerNo);
const CATS = [
  { code: "M", name: "顧問契約" },
  { code: "T", name: "単発相談" },
  { code: "P", name: "見込み客" },
];

describe("一覧で番号を探す", () => {
  it("数字だけなら通し番号で（0042 でも 42 でも。枝番の世帯も出す）。自由な番号は番号の一部で", () => {
    expect(nos("42")).toEqual(["M0042", "M0042-1", "P0042-C", "A0042", "K-2019-42"]);
    expect(nos("0042")).toEqual(["M0042", "M0042-1", "P0042-C", "A0042"]);
    expect(nos("420")).toEqual(["T0420"]);
  });
  it("区分の記号つき（大文字・小文字を問わない）は区分と通し番号で。枝番まで入れればその世帯だけ", () => {
    expect(nos("M42")).toEqual(["M0042", "M0042-1"]);
    expect(nos("m0042-1")).toEqual(["M0042-1"]);
    expect(nos("p42-c")).toEqual(["P0042-C"]);
    expect(nos("k-2019")).toEqual(["K-2019-42"]);
    expect(nos("")).toHaveLength(list.length);
  });
  it("区分で絞り込む（区分なしも選べる）", () => {
    expect(nos("", "M")).toEqual(["M0042", "M0042-1", "K-2019-42"]);
    expect(nos("", NO_CATEGORY)).toEqual(["A0042"]);
    expect(nos("42", "P")).toEqual(["P0042-C"]);
    expect(matchesNumber(row("M0007", { category: "M", serial: 7 }), "7")).toBe(true);
  });
  it("区分の表示", () => {
    expect(categoryText(CATS, "M")).toBe("M 顧問契約");
    expect(categoryText(CATS, "Z")).toBe("Z");
    expect(categoryText(CATS, undefined)).toBe("区分なし");
    expect(defaultCategory(CATS)).toBe("P");
    expect(defaultCategory([{ code: "K", name: "顧問" }])).toBe("K");
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
    const own = [row("3-4-10", { sample: { no: "3-4-10", name: "研修用", traits: ["共働き"] } }), row("P0001", { category: "P", serial: 1 })];
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
    expect(html).toContain("M 顧問契約");
    expect(html).toContain('data-household-row="M0042-1"');
    expect(html).toContain("自由な番号");
    expect(html).toContain('data-assign-serial="A0042"');
    expect(html).not.toContain('data-assign-serial="M0042"');
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
  it("見本に登録するときの確認の文", () => {
    expect(FICTIONAL_CONFIRM).toBe("中身は架空です（実在のお客さまの情報を入れていません）");
  });
});
