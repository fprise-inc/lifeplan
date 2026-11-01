// 基本生活費の内訳の並べ方（事務所の既定値。0109）: 名前を変える・まとめる・隠す・分ける。計算の10の内訳と推定は変えず、
// 並べ方を変えただけでは世帯の値も結果も変わらない。分けた行の額は世帯の拡張領域に残し、ほかの並べ方の事務所で開いても失わない
import { afterEach, describe, expect, it } from "vitest";
import type { LivingExpense } from "../src/engine/types.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { allFields, type FieldDef, type StageDef } from "../src/workspace/input/form.ts";
import { blankHousehold, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { addMember } from "../src/workspace/input/stages/family.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { LAYOUT_NOTE } from "../src/workspace/input/stages/living.ts";
import { applyStateOp, availableOps, fieldStatus } from "../src/workspace/input/valueState.ts";
import { LIVING_PARTS_EXT, partsOf, partsToSave } from "../src/workspace/input/livingParts.ts";
import { apportion, hiddenCategories, isStandardLivingLayout, readLivingLayout, setLivingLayoutNow, STANDARD_LIVING_LAYOUT, type LivingLayout } from "../src/workspace/office/livingLayout.ts";
import { previewRows, sharesProblem } from "../src/workspace/office/LivingLayoutEditor.tsx";
import { DEFAULT_OFFICE_SETTINGS, isDefaultSettings, publishOfficeSettings, readOfficeSettings, withLivingLayout } from "../src/workspace/office/settings.ts";
import { DEFAULT_BALANCE_SETTINGS, DEFAULT_DISPLAY_SETTINGS } from "../src/workspace/settings.ts";
import { bodyObject, bodyOf, EMPTY_CARRY, fromBody } from "../src/workspace/store/body.ts";
import { CURRENT } from "../src/workspace/plans/band.ts";
import type { Proposal } from "../src/workspace/plans/plans.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { planView, recordPlanEdit } from "../src/workspace/plans/planEdit.ts";
import { preview } from "./helpers.ts";

const BASE = "2026-10";
const seq = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
const living = (wh: WorkingHousehold): LivingExpense => wh.request.input.household.livingExpenses![0]!;
const stage = (wh: WorkingHousehold): StageDef => buildStage("living", wh);
const fields = (wh: WorkingHousehold): FieldDef[] => allFields(stage(wh));
const fieldOf = (wh: WorkingHousehold, key: string): FieldDef => {
  const f = fields(wh).find((x) => x.key === key);
  if (f === undefined) throw new Error(`no field ${key}: ${fields(wh).map((x) => x.key).join(", ")}`);
  return f;
};
const byLabel = (wh: WorkingHousehold, label: string): FieldDef => {
  const g = stage(wh).sections.flatMap((s) => s.groups).find((x) => x.title === "内訳（月額）")!;
  const f = g.fields.find((x) => x.label === label);
  if (f === undefined) throw new Error(`no row ${label}: ${g.fields.map((x) => x.label).join(", ")}`);
  return f;
};
const rowLabels = (wh: WorkingHousehold): string[] =>
  stage(wh)
    .sections.flatMap((s) => s.groups)
    .find((x) => x.title === "内訳（月額）")!
    .fields.map((f) => f.label);
const cat = (wh: WorkingHousehold, c: string) => living(wh).categories?.find((x) => x.category === c);
const sum = (wh: WorkingHousehold) => (living(wh).categories ?? []).reduce((s, c) => s + (c.monthly.value ?? 0), 0);

/** 本人40歳・配偶者38歳・子1人の3人の世帯で、内訳で入れる（10の内訳は統計の割合の推定） */
function family(): WorkingHousehold {
  let wh = blankHousehold(BASE, seq());
  wh = mutate(wh, (h) => void (h.members[0]!.birth.birthYearMonth = "1986-06"));
  wh = withRefreshedEstimates(addMember(wh, "spouse"));
  wh = withRefreshedEstimates(addMember(wh, "child"));
  const id = living(wh).id;
  return fieldOf(wh, `living/${id}/mode`).set(wh, "byCategory");
}

/** 名前を変える（食費→食べ物）・まとめる（水道・光熱費＋通信費＝固定費）・隠す（医療費）・分ける（趣味・娯楽→旅行・そのほかの趣味 60%・40%） */
const LAYOUT: LivingLayout = {
  rows: [
    { kind: "one", category: "food", label: "食べ物" },
    { kind: "group", label: "固定費", categories: ["utilities", "communication"] },
    { kind: "one", category: "transit" },
    { kind: "one", category: "furniture" },
    { kind: "one", category: "clothing" },
    { kind: "split", category: "recreation", parts: [{ label: "旅行", share: 60 }, { label: "そのほかの趣味", share: 40 }] },
    { kind: "one", category: "pocketAndSocial" },
    { kind: "one", category: "other" },
  ],
};

afterEach(() => setLivingLayoutNow(null));

describe("並べ方を読む（0109 の1）", () => {
  it("標準と同じなら null。読めない行・同じ内訳の2つ目は捨て、その他は無ければ最後に足す", () => {
    expect(readLivingLayout(STANDARD_LIVING_LAYOUT)).toBeNull();
    expect(readLivingLayout({ rows: [{ kind: "one", category: "food", label: "食費" }] })).toEqual({ rows: [{ kind: "one", category: "food" }, { kind: "one", category: "other" }] });
    const l = readLivingLayout({ rows: [{ kind: "one", category: "food" }, { kind: "one", category: "food", label: "x" }, { kind: "zzz" }, { kind: "group", label: "", categories: ["utilities", "communication", "nope"] }] })!;
    expect(l.rows).toEqual([
      { kind: "one", category: "food" },
      { kind: "group", label: "水道・光熱費・通信費", categories: ["utilities", "communication"] },
      { kind: "one", category: "other" },
    ]);
    expect(hiddenCategories(l)).toEqual(["transit", "furniture", "clothing", "health", "recreation", "pocketAndSocial"]);
  });
  it("その他は分けない。分けた行が2つに満たなければ1行。割合はどの行にもあって合計100のときだけ", () => {
    expect(readLivingLayout({ rows: [{ kind: "split", category: "other", parts: [{ label: "a" }, { label: "b" }] }] })!.rows).toEqual([{ kind: "one", category: "other" }]);
    expect(readLivingLayout({ rows: [{ kind: "split", category: "food", parts: [{ label: "自炊" }] }, { kind: "one", category: "other" }] })!.rows[0]).toEqual({ kind: "one", category: "food" });
    const bad = readLivingLayout({ rows: [{ kind: "split", category: "food", parts: [{ label: "自炊", share: 70 }, { label: "外食", share: 20 }] }] })!;
    expect(bad.rows[0]).toEqual({ kind: "split", category: "food", parts: [{ label: "自炊" }, { label: "外食" }] });
    expect(sharesProblem({ kind: "split", category: "food", parts: [{ label: "自炊", share: 70 }, { label: "外食", share: 20 }] })).toContain("90%");
    expect(readLivingLayout(LAYOUT)).toEqual(LAYOUT);
  });
  it("額を重みで分けると合計はそのまま（端は重みの一番大きい物）", () => {
    expect(apportion(30000, [22000, 15000])).toEqual([18000, 12000]);
    const a = apportion(30001, [1, 1, 1])!;
    expect(a.reduce((s, x) => s + x, 0)).toBe(30001);
    expect(apportion(100, [0, 0])).toBeNull();
  });
  it("事務所の既定値に足すだけの欄。欄の無い古い事務所データは標準", () => {
    expect(readOfficeSettings({}).living).toBeUndefined();
    const s = readOfficeSettings({ living: LAYOUT });
    expect(s.living).toEqual(LAYOUT);
    expect(isDefaultSettings(s)).toBe(false);
    expect(isDefaultSettings(withLivingLayout(s, STANDARD_LIVING_LAYOUT))).toBe(true);
    expect(isDefaultSettings(DEFAULT_OFFICE_SETTINGS)).toBe(true);
    publishOfficeSettings(s);
    expect(rowLabels(family())).toContain("固定費");
    publishOfficeSettings(DEFAULT_OFFICE_SETTINGS);
    expect(rowLabels(family())).not.toContain("固定費");
  });
  it("見え方: 4人の世帯の平均で、行の額と合計（合計は10の内訳の平均の合計のまま）", () => {
    const rows = previewRows(LAYOUT);
    const std = previewRows(STANDARD_LIVING_LAYOUT);
    expect(rows.at(-1)).toEqual(std.at(-1));
    const fixed = rows.find((r) => r.label === "固定費")!;
    expect(fixed.note).toBe("水道・光熱費＋通信費");
    expect(fixed.amount).toBe(std.find((r) => r.label === "水道・光熱費")!.amount! + std.find((r) => r.label === "通信費")!.amount!);
    expect(rows.find((r) => r.label === "その他")!.note).toBe("隠した医療費を含む");
    const trip = rows.find((r) => r.label === "旅行")!;
    expect(trip.sub).toBe(true);
    expect(trip.amount! + rows.find((r) => r.label === "そのほかの趣味")!.amount!).toBe(rows.find((r) => r.label === "趣味・娯楽")!.amount);
  });
});

describe("内訳の行（0109 の2）", () => {
  it("並べ方を変えただけでは、世帯の値も結果も変わらない", () => {
    const wh = family();
    const before = JSON.stringify(wh.request);
    const r0 = preview(wh.request);
    setLivingLayoutNow(LAYOUT);
    const s = stage(wh);
    expect(JSON.stringify(wh.request)).toBe(before);
    expect(preview(wh.request)).toEqual(r0);
    expect(s.sections.flatMap((x) => x.groups).find((g) => g.title === "内訳（月額）")!.note).toContain(LAYOUT_NOTE);
    expect(rowLabels(wh)).toEqual(["食べ物", "固定費", "交通費", "日用品", "被服・美容", "趣味・娯楽", "旅行（趣味・娯楽）", "そのほかの趣味（趣味・娯楽）", "こづかい・交際費", "その他", "合計"]);
  });

  it("名前を変えた行は今までの欄（同じ鍵・同じ当て先）で、「?」に中身の内訳", () => {
    const wh = family();
    const std = byLabel(wh, "食費");
    setLivingLayoutNow(LAYOUT);
    const f = byLabel(wh, "食べ物");
    expect(f.key).toBe(std.key);
    expect(f.help).toMatch(/^中身は内訳の「食費」です。\n食材・外食/u);
    const w2 = f.set(wh, 90000);
    expect(cat(w2, "food")!.monthly).toMatchObject({ value: 90000, state: "confirmed" });
  });

  it("まとめた行: 値は内訳の合計。入れた額は今の額の割合で分け（合計はそのまま）、どれも確定。計算は10の内訳のまま", () => {
    let wh = family();
    setLivingLayoutNow(LAYOUT);
    const u0 = cat(wh, "utilities")!.monthly.value!;
    const c0 = cat(wh, "communication")!.monthly.value!;
    const f = byLabel(wh, "固定費");
    expect(f.get(wh).value).toBe(u0 + c0);
    expect(fieldStatus(f, wh).status).toBe("estimated");
    expect(f.help).toContain("「水道・光熱費」「通信費」をまとめた行です");
    expect(f.help).toContain("・通信費: スマホ");
    const total0 = sum(wh);
    wh = f.set(wh, 40000);
    const u = cat(wh, "utilities")!.monthly;
    const c = cat(wh, "communication")!.monthly;
    expect(u.value! + c.value!).toBe(40000);
    expect(u.state).toBe("confirmed");
    expect(c.state).toBe("confirmed");
    expect(Math.abs(u.value! / 40000 - u0 / (u0 + c0))).toBeLessThan(0.03);
    expect(sum(wh)).toBe(total0 - (u0 + c0) + 40000);
    expect(fieldOf(wh, `ro/living/${living(wh).id}/categories/total`).get(wh).value).toBe(sum(wh));
    // 同じ額を入れ直しても変えない（0041）
    expect(byLabel(wh, "固定費").set(wh, 40000)).toBe(wh);
    // 空にすると、まとめた内訳を外す
    const cleared = byLabel(wh, "固定費").set(wh, null);
    expect(cat(cleared, "utilities")).toBeUndefined();
    expect(cat(cleared, "communication")).toBeUndefined();
    // 中身の内訳がどれも無いときに0円を入れると、代表の内訳を0円で持つ（入れた印）
    const zero = byLabel(cleared, "固定費").set(cleared, 0);
    expect(cat(zero, "utilities")!.monthly).toMatchObject({ value: 0, state: "confirmed" });
    expect(byLabel(zero, "固定費").get(zero).value).toBe(0);
  });

  it("まとめた行の「この値にする」は、まとめた内訳の推定をどれもその額のまま確定にする", () => {
    const wh = family();
    setLivingLayoutNow(LAYOUT);
    const f = byLabel(wh, "固定費");
    expect(availableOps(f, wh)).toContain("confirm");
    const w2 = applyStateOp(wh, f, "confirm");
    expect(cat(w2, "utilities")!.monthly.state).toBe("confirmed");
    expect(cat(w2, "communication")!.monthly.state).toBe("confirmed");
    expect(sum(w2)).toBe(sum(wh));
  });

  it("隠した内訳はその他の行に入る（値は隠した内訳との合計。入れた額はその他と隠した内訳で分ける）", () => {
    let wh = family();
    setLivingLayoutNow(LAYOUT);
    const other = byLabel(wh, "その他");
    const o0 = cat(wh, "other")!.monthly.value!;
    const h0 = cat(wh, "health")!.monthly.value!;
    expect(other.get(wh).value).toBe(o0 + h0);
    expect(other.help).toContain("隠している内訳（医療費）の分も、ここに入れます");
    expect(rowLabels(wh)).not.toContain("医療費");
    wh = other.set(wh, 30000);
    expect(cat(wh, "other")!.monthly.value! + cat(wh, "health")!.monthly.value!).toBe(30000);
    // 隠した内訳に値が無ければ、今までのその他の欄
    const none = mutate(family(), (h) => void (h.livingExpenses![0]!.categories = h.livingExpenses![0]!.categories!.filter((c) => c.category !== "health")));
    expect(byLabel(none, "その他").key).toMatch(/\/cat\//u);
  });

  it("分けた行: 分けていないときは事務所の割合の目安（推定）。1つ入れると、ほかは目安のまま推定で、内訳は行の合計", () => {
    let wh = family();
    setLivingLayoutNow(LAYOUT);
    const id = living(wh).id;
    const r0 = cat(wh, "recreation")!.monthly.value!;
    const trip = fieldOf(wh, `living/${id}/part/recreation/0`);
    const rest = fieldOf(wh, `living/${id}/part/recreation/1`);
    expect((trip.get(wh).value as number) + (rest.get(wh).value as number)).toBe(r0);
    expect(trip.get(wh).estimated).toContain("事務所の割合（旅行 60%・そのほかの趣味 40%）");
    expect(trip.get(wh).hint).toContain("趣味・娯楽の平均の60%");
    const subtotal = fieldOf(wh, `ro/living/${id}/split/recreation`);
    expect(subtotal.readOnly).toContain("「旅行」「そのほかの趣味」の合計です");
    wh = trip.set(wh, 10000);
    const restV = rest.get(wh).value as number;
    expect(cat(wh, "recreation")!.monthly).toMatchObject({ value: 10000 + restV, state: "estimated" });
    expect(rest.get(wh).estimated).not.toBeNull();
    expect(trip.get(wh)).toMatchObject({ value: 10000, estimated: null });
    expect(subtotal.get(wh).value).toBe(10000 + restV);
    expect(partsOf(wh, cat(wh, "recreation")!.id, 10000 + restV)).toEqual([
      { label: "旅行", monthly: 10000 },
      { label: "そのほかの趣味", monthly: restV, estimated: expect.stringContaining("目安") },
    ]);
    // 残りの行も「この値にする」と、内訳は確定
    wh = applyStateOp(wh, rest, "confirm");
    expect(cat(wh, "recreation")!.monthly).toMatchObject({ value: 10000 + restV, state: "confirmed" });
    wh = rest.set(wh, 8000);
    expect(cat(wh, "recreation")!.monthly).toMatchObject({ value: 18000, state: "confirmed" });
  });

  it("分けた額は世帯ファイルの拡張領域に残り、ほかの並べ方の事務所で開いても失わない（合計がずれた物は保存しない）", () => {
    let wh = family();
    setLivingLayoutNow(LAYOUT);
    const id = living(wh).id;
    wh = fieldOf(wh, `living/${id}/part/recreation/0`).set(wh, 12000);
    wh = fieldOf(wh, `living/${id}/part/recreation/1`).set(wh, 7000);
    const state = { wh, workspace: { template: null, band: [CURRENT], base: CURRENT, selected: CURRENT, shownItems: [] }, display: { result: DEFAULT_DISPLAY_SETTINGS, balance: DEFAULT_BALANCE_SETTINGS }, carry: { extDefinitions: { "ext.exampleOffice.carCount": { type: "integer" } }, ext: { "ext.exampleOffice.carCount": 2 } } };
    const body = bodyObject(state);
    expect((body.household as Record<string, unknown>).livingParts).toBeUndefined();
    expect(body.ext[LIVING_PARTS_EXT]).toEqual({ [cat(wh, "recreation")!.id!]: [{ label: "旅行", monthly: 12000 }, { label: "そのほかの趣味", monthly: 7000 }] });
    expect(body.ext["ext.exampleOffice.carCount"]).toBe(2);
    expect(body.extDefinitions[LIVING_PARTS_EXT]).toMatchObject({ attachTo: "household", version: 1 });
    const back = fromBody(bodyOf(state));
    expect(back.wh.livingParts).toEqual(wh.livingParts);
    expect(back.carry.ext).toEqual({ "ext.exampleOffice.carCount": 2 });
    expect(JSON.parse(bodyOf({ ...back }))).toEqual(JSON.parse(bodyOf(state)));
    // 標準の並べ方の事務所で開くと、趣味・娯楽の欄（合計）に分けた行の名前と額が添えて出る
    setLivingLayoutNow(null);
    const f = byLabel(back.wh, "趣味・娯楽");
    expect(f.get(back.wh).value).toBe(19000);
    expect(f.get(back.wh).hint).toContain("分けた行: 旅行 1.2万円・そのほかの趣味 0.7万円");
    // そこで趣味・娯楽を直すと、分けた額は合計とずれるので使わず、保存もしない
    const edited = f.set(back.wh, 25000);
    expect(partsToSave(edited)).toBeNull();
    expect(bodyObject({ ...back, wh: edited }).ext[LIVING_PARTS_EXT]).toBeUndefined();
    // 分けていない世帯は拡張領域を作らない
    expect(bodyObject({ ...state, wh: family(), carry: EMPTY_CARRY }).ext).toEqual({});
  });

  it("ほかの名前で分けた事務所で開くと、合計の行に前の分け方を添え、行は目安で見せる", () => {
    let wh = family();
    setLivingLayoutNow(LAYOUT);
    const id = living(wh).id;
    wh = fieldOf(wh, `living/${id}/part/recreation/0`).set(wh, 12000);
    setLivingLayoutNow({ rows: [...LAYOUT.rows.filter((r) => r.kind !== "split"), { kind: "split", category: "recreation", parts: [{ label: "本・新聞" }, { label: "スポーツ" }] }] });
    const subtotal = fieldOf(wh, `ro/living/${id}/split/recreation`);
    expect(subtotal.get(wh).hint).toContain("前の分けた行: 旅行 1.2万円");
    expect(fieldOf(wh, `living/${id}/part/recreation/0`).get(wh).estimated).toContain("等分");
  });

  it("プランで分けた行を直すと、内訳はプランの差分になり、分けた額はそのプランの所に持つ（現状は変わらない）", () => {
    const wh0 = family();
    setLivingLayoutNow(LAYOUT);
    const id = living(wh0).id;
    const self = wh0.request.input.household.members.find((m) => m.kind === "self")!;
    const plan = { id: "00000000-0000-4000-8000-00000000b109", name: "プランB", base: null, diffs: [], tags: [], createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", origin: { kind: "manual" } } as unknown as Proposal;
    const wh = { ...wh0, proposals: [plan] };
    const catalog = buildCatalog(wh, self.id, null);
    const before = planView(wh, catalog, plan.id);
    const after = fieldOf(before, `living/${id}/part/recreation/0`).set(before, 5000);
    const n = recordPlanEdit(wh, catalog, plan.id, before, after);
    expect(n.request).toEqual(wh.request);
    expect(n.proposals[0]!.diffs).toMatchObject([{ op: "set", item: "livingExpense.categories" }]);
    const elId = cat(wh, "recreation")!.id!;
    expect(Object.keys(n.livingParts ?? {})).toEqual([`${plan.id}:${elId}`]);
    const view = planView(n, catalog, plan.id);
    expect(fieldOf(view, `living/${id}/part/recreation/0`).get(view)).toMatchObject({ value: 5000, estimated: null });
    // 現状は分けていないまま（目安）
    expect(fieldOf(n, `living/${id}/part/recreation/0`).get(n).estimated).not.toBeNull();
    expect(partsToSave(n)).toEqual(n.livingParts);
  });

  it("並べ方の行は、まとめた行・分けた行を対策の動かす項目にしない（名前を変えた行は今までどおり）", () => {
    const wh = family();
    setLivingLayoutNow(LAYOUT);
    const self = wh.request.input.household.members.find((m) => m.kind === "self")!;
    const keys = buildCatalog(wh, self.id, null).items.map((i) => i.key);
    expect(keys.some((k) => k.includes("/row/") || k.includes("/part/"))).toBe(false);
    expect(isStandardLivingLayout(null)).toBe(true);
  });
});
