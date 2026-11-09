// ヒアリングで答えた、今住んでいる持ち家の買った年月・買った値段・うち土地の値段（0176 の追記 2026-11-09）を取り込むと、入力の画面の標準の欄
// （買った年月〔住み始め〕・買った値段〔土地と建物の合計〕・うち土地の値段）にそのまま入り、入力の画面で同じ値を入れたときと同じ世帯になる。
// 今の値を壊さない（0139）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sampleBytes, type SampleFile } from "../../hearing/test/sample.ts";
import { landOfShare as hearingLandOfShare, shareOfLand as hearingShareOfLand } from "../../hearing/src/ownedHome.ts";
import type { Residence } from "../src/engine/types.ts";
import { applyImport, approvalTime, defaultSelection, exportSheet, importSheet, sheetFor, withRequest } from "../src/workspace/hearing/sheet.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { withProvisionalHousing } from "../src/workspace/input/housingCredit.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { AS_OF_FOLLOWS, landOfShare, shareOfLand } from "../src/workspace/input/ownedHomeValue.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { modelHousehold, preview } from "./helpers.ts";

const BASE = "2026-10";
const AT = approvalTime(new Date(2026, 10, 9, 10, 0, 0));
let n = 0;
const seq = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const blank = (): WorkingHousehold => withRefreshedEstimates(blankHousehold(BASE, seq));
const OFFICE = { name: "【架空】みらいFP事務所", purpose: "ライフプランの作成のため", privacyContact: "" };

const stageOf = (wh: WorkingHousehold) => buildStage("housing", wh);
const fieldOf = (wh: WorkingHousehold, suffix: string): FieldDef => {
  const f = allFields(stageOf(wh)).find((x) => x.key.endsWith(suffix));
  if (f === undefined) throw new Error(`no field ${suffix}`);
  return f;
};
const owned = (wh: WorkingHousehold): Residence => (wh.request.input.household.residences ?? []).find((r) => r.kind === "own" && r.purchase === undefined)!;
const rowOf = (r: Residence, key: string) => ((r as unknown as { valueStates?: Record<string, { estimate?: { basis?: string } }> }).valueStates ?? {})[key];

/** 見本の JSON を直して .xlsx にする（undefined の値は消す） */
async function sheet(file: string, change: Record<string, SampleFile["values"][string] | undefined>): Promise<Uint8Array> {
  const sample = JSON.parse(readFileSync(join(REPO_DIR, "hearing", "samples", file), "utf8")) as SampleFile;
  const values: Record<string, SampleFile["values"][string]> = { ...sample.values };
  for (const [k, v] of Object.entries(change)) {
    if (v === undefined) delete values[k];
    else values[k] = v;
  }
  return sampleBytes(file, { ...sample, values });
}

/** 取り込んで、選んだ候補（省略は既定のチェック）を承認し、アプリが開く形（推定の入れ直し）にする */
async function take(bytes: Uint8Array, wh: WorkingHousehold, all = false) {
  const r = await importSheet(bytes, wh, seq);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  const sel = all ? new Set(r.view.candidates.map((c) => c.id)) : defaultSelection(r.view);
  return { view: r.view, wh: withRefreshedEstimates(applyImport(wh, r.view, sel, AT).wh) };
}

describe("土地の値段と割合の読み替えは、入力の画面と同じ", () => {
  it.each([
    [15_000_000, 40_000_000],
    [12_340_000, 34_560_000],
    [18_300_000, 45_800_000],
    [1, 99_999_999],
  ])("土地 %i ÷ 合計 %i", (land, total) => {
    expect(hearingShareOfLand(land, total)).toBe(shareOfLand(land, total));
    expect(hearingLandOfShare(total, "0.3")).toBe(landOfShare(total, "0.3"));
  });
});

describe("Excel（詳細の版5）: 空の世帯に取り込むと、入力の画面の標準の3欄に入る", () => {
  it("買った年月（住み始め）・買った値段・うち土地の値段がそのまま出る。評価の入れ方は買った値段で、時点は住み始めについてくる", async () => {
    const { wh } = await take(await sheet("full-5-sample.json", {}), blank());
    const r = owned(wh);
    expect(r.valuation).toMatchObject({ value: { value: 45_800_000, state: "confirmed" }, asOf: "2020-03", basis: "purchase" });
    expect(rowOf(r, "residence.valuation/asOf")?.estimate?.basis).toBe(AS_OF_FOLLOWS);
    expect(fieldOf(wh, "/from").label).toBe("買った年月（住み始め）");
    expect(fieldOf(wh, "/from").get(wh).value).toBe("2020-03");
    expect(fieldOf(wh, "/valuation/value").get(wh).value).toBe(45_800_000);
    expect(fieldOf(wh, "/valuation/land").get(wh).value).toBe(18_300_000);
    // 見本の固定資産税（納税通知書の額 12万円）はそのまま
    expect(r.propertyTax?.annual).toMatchObject({ value: 120_000, state: "confirmed" });
    expect(preview(wh.request).table.length).toBeGreaterThan(0);
  });
});

describe("シンプルの版3: 入力の画面で同じ3欄を入れた世帯と同じ評価・固定資産税の目安になる", () => {
  /** 入力の画面で持ち家を足し、買った年月・買った値段・うち土地を入れた世帯 */
  function typed(land: number | null): WorkingHousehold {
    const add = stageOf(blankHousehold(BASE, seq)).sections.flatMap((x) => [...x.actions, ...x.groups.flatMap((g) => g.actions)]).find((a) => a.key.endsWith("housing/addOwn"))!;
    let wh = withProvisionalHousing(add.run(blankHousehold(BASE, seq)));
    const set = (suffix: string, v: Parameters<FieldDef["set"]>[1]) => (wh = withRefreshedEstimates(withProvisionalHousing(fieldOf(wh, suffix).set(wh, v))));
    set("/from", { at: "2015-04" });
    set("/valuation/value", 40_000_000);
    if (land !== null) set("/valuation/land", land);
    return wh;
  }
  const answers = (land: number | undefined) => ({ "hs.housing.purchaseMonth": "2015-04", "hs.housing.purchasePrice": 40_000_000, "hs.housing.purchasePriceRange": undefined, "hs.housing.purchaseLand": land });

  for (const land of [15_000_000, null] as const) {
    it(`土地の値段${land === null ? "が空欄（目安の割合で分ける）" : "あり"}`, async () => {
      const { wh } = await take(await sheet("basic-3-sample.json", answers(land ?? undefined)), blank());
      const ui = typed(land);
      const a = owned(wh);
      const b = owned(ui);
      expect(a.from).toEqual(b.from);
      expect({ value: a.valuation?.value?.value, asOf: a.valuation?.asOf, landShare: a.valuation?.landShare, basis: a.valuation?.basis }).toEqual({ value: b.valuation?.value?.value, asOf: b.valuation?.asOf, landShare: b.valuation?.landShare, basis: b.valuation?.basis });
      expect(rowOf(a, "residence.valuation/asOf")).toEqual(rowOf(b, "residence.valuation/asOf"));
      if (land === null) expect(a.valuation?.landShare).toBeUndefined();
      // 固定資産税は、入力の画面と同じ買った値段からの推定（土地が空欄なら前提条件の土地の割合で）
      expect(a.propertyTax?.annual).toMatchObject({ value: b.propertyTax?.annual.value, state: "estimated" });
      expect((a.propertyTax?.annual as { estimate?: { basis?: string } }).estimate?.basis).toBe((b.propertyTax?.annual as { estimate?: { basis?: string } }).estimate?.basis);
      expect(fieldOf(wh, "/valuation/land").get(wh)).toEqual(fieldOf(ui, "/valuation/land").get(ui));
    });
  }

  it("範囲の答え（4,000〜5,000万円）は推定の 4,500万円。土地の欄は空のまま目安の割合の読み", async () => {
    const { wh } = await take(await sheet("basic-3-sample.json", {}), blank());
    const r = owned(wh);
    expect(r.valuation?.value).toMatchObject({ value: 45_000_000, state: "estimated", certainty: "rough" });
    expect(r.valuation?.landShare).toBeUndefined();
    expect(fieldOf(wh, "/valuation/land").get(wh)).toMatchObject({ value: null });
    expect(String(fieldOf(wh, "/valuation/land").get(wh).hint)).toContain("空欄なら合計の30%");
  });
});

describe("値の入った世帯に取り込む: 今の値を壊さない（0139）", () => {
  const filled = (): WorkingHousehold => fromRequest(modelHousehold("salariedCoupleTwoKids"));
  it("見直しのシートには前回の買った年月・買った値段・うち土地の値段が入り、そのまま取り込むと持ち家の評価は変わらない", async () => {
    const wh0 = filled();
    const s = await exportSheet(wh0, { definition: sheetFor("review"), prefill: true, customerNo: "A0001", office: OFFICE, appVersion: "0.1.0", exportedOn: "2026-11-09", random: new Uint8Array([1, 2, 3, 4, 5, 6]) });
    const wh = withRequest(wh0, s.request);
    const r = await importSheet(s.bytes, wh, seq);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const got = Object.fromEntries(r.view.result.record.answers.filter((a) => a.key.startsWith("hs.housing.purchase")).map((a) => [a.key, a.status === "value" ? `${a.raw?.kind === "bool" ? "" : (a.raw?.text ?? "")}${a.raw2 !== undefined && a.raw2.kind !== "bool" ? ` ${a.raw2.text}` : ""}` : a.status]));
    expect(got).toEqual({ "hs.housing.purchaseMonth": "2016年（平成28年） 4月", "hs.housing.purchasePrice": "3800", "hs.housing.purchaseLand": "1330" });
    const c = r.view.candidates.find((x) => x.group === "住まい");
    // 持ち家の評価の欄（買った値段・時点・土地の割合）に違いは出ない
    expect(c?.fields.flatMap((f) => f.diffs.map((d) => d.label)).filter((l) => l.startsWith("買った") || l.startsWith("土地の割合"))).toEqual([]);
    const after = withRefreshedEstimates(applyImport(wh, r.view, new Set(r.view.candidates.map((x) => x.id)), AT).wh);
    const v0 = owned(wh0).valuation!;
    expect(owned(after).valuation).toMatchObject({ value: { value: v0.value?.value }, asOf: v0.asOf, landShare: v0.landShare });
    expect(owned(after).propertyTax?.annual.value).toBe(owned(wh0).propertyTax?.annual.value);
  });

  it("買った値段だけ答え直す（土地は空欄）と、今の土地の割合・固定資産税（FP の額）は残る", async () => {
    const wh = filled();
    const before = owned(wh);
    const bytes = await sheet("full-5-sample.json", { "hs.housing.purchaseMonth": "2016-04", "hs.housing.purchasePrice": 40_000_000, "hs.housing.purchaseLand": undefined, "hs.housing.propertyTax": undefined });
    const { view, wh: after } = await take(bytes, wh);
    const c = view.candidates.find((x) => x.group === "住まい");
    expect(c?.kind).toBe("changed");
    expect(c?.fields.flatMap((f) => f.diffs.map((d) => `${d.label}: ${d.current} → ${d.next}`))).toContain("買った値段（土地と建物の合計）: 38,000,000円 → 40,000,000円");
    const r = owned(after);
    expect(r.valuation?.value?.value).toBe(40_000_000);
    expect(r.valuation?.landShare).toBe(before.valuation?.landShare);
    expect(r.valuation?.asOf).toBe("2016-04");
    // 入れ方を書いていない前の版の世帯には書き足さない（入力の画面で合計を直したときと同じ）
    expect(r.valuation?.basis).toBeUndefined();
    expect(r.propertyTax?.annual.value).toBe(before.propertyTax?.annual.value);
  });

  it("買った値段を答え直しても、シートで聞かない評価の欄（建物の構造・建った年）は残る（承認は記録のある欄だけを重ねる。0139）", async () => {
    const wh = filled();
    const before = owned(wh);
    const bytes = await sheet("full-5-sample.json", { "hs.housing.purchaseMonth": "2016-04", "hs.housing.purchasePrice": 40_000_000, "hs.housing.purchaseLand": undefined, "hs.housing.propertyTax": undefined });
    const r = owned((await take(bytes, wh)).wh);
    expect({ structure: r.valuation?.structure, builtYear: r.valuation?.builtYear }).toEqual({ structure: before.valuation?.structure, builtYear: before.valuation?.builtYear });
  });

  it("買った値段を範囲で答えると、今の確定の評価額の方が詳しいので既定で残す", async () => {
    const wh = filled();
    const bytes = await sheet("basic-3-sample.json", { "hs.housing.purchaseMonth": "2016-04" });
    const { view, wh: after } = await take(bytes, wh);
    const c = view.candidates.find((x) => x.group === "住まい");
    // 範囲の答えは「粗い」欄（今の確定の値の方が詳しい）。ほかに記入どおりの違いが無ければ既定で残し、あれば置きかわることを知らせる（0139 の2 の4）
    expect(c?.fields.flatMap((f) => f.diffs).find((d) => d.label === "買った値段（土地と建物の合計）")).toMatchObject({ current: "38,000,000円", next: "45,000,000円（推定）", rough: true });
    expect(`${c?.keep ?? ""}${c?.caution ?? ""}`).toContain("買った値段");
    if (c?.keep !== null) expect(owned(after).valuation).toEqual(owned(wh).valuation);
  });

  it("今の時価で入れていた家に買った値段を承認すると、評価の入れ方を買った値段にし、時点を住み始めにそろえる", async () => {
    const wh = mutate(filled(), (h) => {
      const r = h.residences![0]!;
      r.valuation = { ...r.valuation!, value: { value: 30_000_000, state: "confirmed", origin: { kind: "manual" } }, asOf: BASE, basis: "market" };
    });
    const bytes = await sheet("full-5-sample.json", { "hs.housing.purchaseMonth": "2016-04", "hs.housing.purchasePrice": 40_000_000, "hs.housing.purchaseLand": 14_000_000 });
    const { wh: after } = await take(bytes, wh, true);
    const r = owned(after);
    expect(r.valuation).toMatchObject({ value: { value: 40_000_000 }, asOf: "2016-04", basis: "purchase", landShare: shareOfLand(14_000_000, 40_000_000) });
    expect(rowOf(r, "residence.valuation/asOf")?.estimate?.basis).toBe(AS_OF_FOLLOWS);
  });
});
