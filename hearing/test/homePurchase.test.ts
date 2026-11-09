// 持ち家の方に、家を買った年月・買ったときの値段（土地と建物の合計）・そのうち土地の値段を聞く（シンプルの basic 版3・詳細の full 版5。0176 の追記 2026-11-09）。
// 取り込むと、入力の画面の標準の3欄と同じ所（住み始め・valuation.value・valuation.asOf・valuation.landShare）に入る
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { approveAll, createHearingSheet, exportAnswers, importAnswers, importHearingSheet, type Answer, type FilledSheet, type SheetDefinition } from "../src/index.ts";
import { itemByKey } from "../src/definition.ts";
import { landOfShare, shareOfLand } from "../src/ownedHome.ts";
import { formatValue } from "../src/values.ts";
import type { EngineRequest, Residence } from "../src/types.ts";
import { answersOf, draftKey, initialDraft, issueRequest, openRequest, screenId, screens, selectionFromSheet, type DraftAnswer, type QuestionsPacket, type RelayTransport, type Screen } from "../src/web/index.ts";
import { handleApi } from "../relay/handler.ts";
import { memoryStore } from "../relay/store.ts";
import { API_PREFIX } from "../src/web/protocol.ts";
import { engineAvailable, full4, full5, HEARING_DIR, idSeq, modelHousehold, OFFICE, preview, simple, simple2 } from "./helpers.ts";
import { sampleBytes, type SampleFile } from "./sample.ts";

const KEYS = ["hs.housing.purchaseMonth", "hs.housing.purchasePrice", "hs.housing.purchaseLand"];
const M = (def: SheetDefinition) => ({ format: "fprise-lifeplan-hearing" as const, formatVersion: "0.1", sheetId: def.sheetId, sheetVersion: def.version, requestId: "R-ABCDEF", customerNo: "", layoutDigest: "0".repeat(64), appVersion: "0.1.0", exportedOn: "2026-11-09" });

function answer(def: SheetDefinition, key: string, value: string | number | "unknown" | "notApplicable", index?: number): Answer {
  const at = { key, ...(index !== undefined ? { index } : {}) };
  if (value === "unknown" || value === "notApplicable") return { ...at, status: value };
  const f = formatValue(itemByKey(def).get(key) as NonNullable<ReturnType<ReturnType<typeof itemByKey>["get"]>>, value);
  return { ...at, status: "value", raw: f.raw, ...(f.raw2 !== undefined ? { raw2: f.raw2 } : {}) };
}
const base = (def: SheetDefinition, type = "own") => [answer(def, "hs.meta.filledOn", "2026-10"), answer(def, "hs.family.adult.birthYearMonth", "1980-05", 1), answer(def, "hs.family.adult.sex", "male", 1), answer(def, "hs.family.adult.birthYearMonth", "notApplicable", 2), answer(def, "hs.housing.type", type)];
function run(def: SheetDefinition, values: Record<string, string | number | "unknown" | "notApplicable">, type = "own") {
  const answers = [...base(def, type), ...Object.entries(values).map(([k, v]) => answer(def, k, v))];
  const filled: FilledSheet = { management: M(def), answers };
  return importAnswers(def, filled, { baseMonth: "2026-10", newId: idSeq("home") });
}
const home = (r: ReturnType<typeof run>): Residence | undefined => (r.request.input.household.residences ?? [])[0];
const fieldsOf = (r: ReturnType<typeof run>) => r.candidates.find((c) => c.collection === "residences")?.fields ?? [];

describe("シート定義: 詳細の版5・シンプルの版3", () => {
  it("詳細の版5 は版4 の項目に、住み始めた年月の次の3問を足した。版4 は廃止", () => {
    const v4 = full4().items.map((i) => i.key);
    const v5 = full5().items.map((i) => i.key);
    expect(v5.filter((k) => !KEYS.includes(k))).toEqual(v4);
    expect(v5.slice(v5.indexOf("hs.housing.since") + 1, v5.indexOf("hs.housing.since") + 4)).toEqual(KEYS);
    for (const k of KEYS) expect(itemByKey(full5()).get(k)).toMatchObject({ addedIn: 5, retiredIn: null });
    expect(full4().status).toBe("retired");
    expect(full5().status).toBe("draft");
    const home = full5().sections.find((s) => s.id === "housing")!.groups.find((g) => g.id === "home")!.items;
    expect(home.slice(home.indexOf("hs.housing.since") + 1, home.indexOf("hs.housing.since") + 4)).toEqual(KEYS);
  });

  it("シンプルの版3 は版2 の項目に、家賃の範囲の次の4問（買った値段は範囲でも答えられる）を足した。版2 は廃止", () => {
    const v2 = simple2().items.map((i) => i.key);
    const v3 = simple().items.map((i) => i.key);
    const added = ["hs.housing.purchaseMonth", "hs.housing.purchasePrice", "hs.housing.purchasePriceRange", "hs.housing.purchaseLand"];
    expect(v3.filter((k) => !added.includes(k))).toEqual(v2);
    expect(v3.slice(v3.indexOf("hs.housing.rentRange") + 1, v3.indexOf("hs.housing.rentRange") + 5)).toEqual(added);
    expect(itemByKey(simple()).get("hs.housing.purchasePriceRange")).toMatchObject({ type: "moneyRange", rangeOf: "hs.housing.purchasePrice", addedIn: 3 });
    expect(simple2().status).toBe("retired");
    expect(simple().status).toBe("draft");
  });

  it("金額は万円・1回の額。入る先は住み始めと持ち家の評価", () => {
    for (const def of [simple(), full5()]) {
      const items = itemByKey(def);
      expect(items.get("hs.housing.purchaseMonth")?.inputItems).toEqual(["residence.from", "residence.valuation"]);
      for (const k of ["hs.housing.purchasePrice", "hs.housing.purchaseLand"]) expect(items.get(k)).toMatchObject({ type: "money", unit: { scale: "manYen", basis: "once" }, inputItems: ["residence.valuation"] });
    }
  });
});

describe("取り込み: 入力の画面の標準の3欄と同じ所に入る", () => {
  it("詳細: 買った年月 → 住み始めと評価の時点、買った値段 → 評価額、うち土地 → 土地の割合（入れた土地の値段がそのまま出る12桁）", () => {
    const r = run(full5(), { "hs.housing.purchaseMonth": "2015-04", "hs.housing.purchasePrice": 40_000_000, "hs.housing.purchaseLand": 15_000_000 });
    const res = home(r)!;
    expect(res.from).toEqual({ at: "2015-04" });
    expect(res.valuation).toEqual({ value: { value: 40_000_000, state: "confirmed", origin: { kind: "hearing", ref: "R-ABCDEF" } }, asOf: "2015-04", landShare: shareOfLand(15_000_000, 40_000_000) });
    expect(res.valuation?.landShare).toBe("0.375");
    // 評価の入れ方は書かない（アプリが承認のときに入力の画面と同じ決まりで書く）
    expect(res.valuation?.basis).toBeUndefined();
    expect(fieldsOf(r).filter((f) => f.item === "residence.valuation").map((f) => `${f.key} ${f.path} ${f.state}${f.noAnswer === true ? " noAnswer" : ""}`)).toEqual([
      "hs.housing.purchasePrice /valuation/value confirmed",
      "hs.housing.purchaseMonth /valuation/asOf confirmed",
      "hs.housing.purchaseLand /valuation/landShare confirmed",
    ]);
    expect(fieldsOf(r).find((f) => f.path === "/from/at")?.key).toBe("hs.housing.purchaseMonth");
    expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
    // 固定資産税が空欄なら、買った値段から目安を出すと面談のチェックリストに
    expect(r.checklist.find((c) => c.key === "hs.housing.propertyTax")?.message).toBe("固定資産税が未記入（買った値段から目安を出します）");
  });

  it("土地の値段が空欄・わからないなら土地の割合を書かず（前提条件の土地の割合で分ける）、答えの無い欄にする（今の世帯の割合は残る）", () => {
    for (const land of [undefined, "unknown" as const]) {
      const r = run(full5(), { "hs.housing.purchaseMonth": "2015-04", "hs.housing.purchasePrice": 40_000_000, ...(land !== undefined ? { "hs.housing.purchaseLand": land } : {}) });
      expect(home(r)?.valuation).toMatchObject({ asOf: "2015-04" });
      expect(home(r)?.valuation?.landShare).toBeUndefined();
      expect(fieldsOf(r).find((f) => f.path === "/valuation/landShare")).toMatchObject({ key: "hs.housing.purchaseLand", noAnswer: true });
    }
  });

  it("土地の値段が合計より大きいと、土地は取り込まずに知らせる。合計が無い土地の値段も取り込まない", () => {
    const r = run(full5(), { "hs.housing.purchaseMonth": "2015-04", "hs.housing.purchasePrice": 30_000_000, "hs.housing.purchaseLand": 35_000_000 });
    expect(home(r)?.valuation?.landShare).toBeUndefined();
    expect(r.issues.find((i) => i.code === "H_CONTRADICTION" && i.key === "hs.housing.purchaseLand")?.message).toContain("買った値段（3,000万円）より大きい");
    const r2 = run(full5(), { "hs.housing.purchaseMonth": "2015-04", "hs.housing.purchaseLand": 15_000_000 });
    expect(home(r2)?.valuation).toBeUndefined();
    expect(r2.issues.find((i) => i.code === "H_MISSING" && i.key === "hs.housing.purchasePrice")?.message).toContain("土地の値段は取り込みませんでした");
  });

  it("買った値段が空欄・わからない・該当なし（相続した家など）なら評価を書かない。空欄は面談のチェックリストに", () => {
    for (const price of [undefined, "unknown" as const, "notApplicable" as const]) {
      const r = run(full5(), { "hs.housing.purchaseMonth": "2015-04", ...(price !== undefined ? { "hs.housing.purchasePrice": price } : {}) });
      expect(home(r)?.valuation).toBeUndefined();
      expect(home(r)?.from).toEqual({ at: "2015-04" });
    }
    expect(run(full5(), {}).checklist.find((c) => c.key === "hs.housing.purchasePrice")?.message).toBe("買った値段が未記入（今の家の評価額を推計できません）");
  });

  it("住み始めた年月と家を買った年月が違えば、家を買った年月を住み始めにして知らせる。家を買った年月が無ければ住み始めた年月を使う", () => {
    const r = run(full5(), { "hs.housing.since": "2015-07", "hs.housing.purchaseMonth": "2015-04", "hs.housing.purchasePrice": 40_000_000 });
    expect(home(r)?.from).toEqual({ at: "2015-04" });
    expect(r.issues.find((i) => i.code === "H_IGNORED" && i.key === "hs.housing.since")?.message).toContain("家を買った年月（2015年4月）と違うため");
    const r2 = run(full5(), { "hs.housing.since": "2015-07", "hs.housing.purchasePrice": 40_000_000 });
    expect(home(r2)?.from).toEqual({ at: "2015-07" });
    expect(home(r2)?.valuation?.asOf).toBe("2015-07");
    expect(fieldsOf(r2).find((f) => f.path === "/valuation/asOf")).toMatchObject({ key: "hs.housing.since", state: "confirmed" });
  });

  it("買った年月が空欄なら、住み始めと評価の時点は計算基準月（仮の値・答えの無い欄。今の世帯の時点を残す）", () => {
    const r = run(full5(), { "hs.housing.purchasePrice": 40_000_000 });
    expect(home(r)?.from).toEqual({ at: "2026-10" });
    expect(home(r)?.valuation?.asOf).toBe("2026-10");
    expect(fieldsOf(r).find((f) => f.path === "/valuation/asOf")).toMatchObject({ key: "hs.housing.purchaseMonth", state: "assumed", noAnswer: true });
  });

  it("持ち家でない方の記入は取り込まずに知らせる", () => {
    const r = run(full5(), { "hs.housing.rent": 98000, "hs.housing.purchaseMonth": "2015-04", "hs.housing.purchasePrice": 40_000_000 }, "rent");
    expect(home(r)?.valuation).toBeUndefined();
    expect(home(r)?.from).not.toEqual({ at: "2015-04" });
    expect(r.issues.some((i) => i.code === "H_CONTRADICTION" && i.message.includes("持ち家ではありませんが"))).toBe(true);
  });

  it("シンプル: 買った値段の範囲は真ん中の推定（確かさ概算）。土地の割合も推定として記録する", () => {
    const def = simple();
    const r = run(def, { "hs.housing.rent": "notApplicable", "hs.housing.purchaseMonth": "2017-09", "hs.housing.purchasePriceRange": "40000000-50000000", "hs.housing.purchaseLand": 18_000_000 });
    const v = home(r)!.valuation!;
    expect(v.value).toMatchObject({ value: 45_000_000, state: "estimated", certainty: "rough" });
    expect(v.asOf).toBe("2017-09");
    expect(landOfShare(45_000_000, v.landShare!)).toBe(18_000_000);
    expect(fieldsOf(r).find((f) => f.path === "/valuation/value")).toMatchObject({ key: "hs.housing.purchasePriceRange", state: "estimated", range: "4,000〜5,000万円" });
    expect(fieldsOf(r).find((f) => f.path === "/valuation/landShare")?.state).toBe("estimated");
    // シンプルの版2 までは住み始めを聞かなかった（仮の値）。版3 から家を買った年月が住み始めになる
    expect(home(r)?.from).toEqual({ at: "2017-09" });
  });

  it("土地の割合の読み替えは、入れた土地の値段がそのまま出る（計算エンジンの切り捨て）", () => {
    for (const [land, total] of [[15_000_000, 40_000_000], [12_340_000, 34_560_000], [1, 99_999_999], [33_333_333, 99_999_999]] as const) expect(landOfShare(total, shareOfLand(land, total))).toBe(land);
  });
});

describe("書き出し（見直しの前回の値）", () => {
  const req = (valuation: Residence["valuation"], rows?: Record<string, unknown>): EngineRequest => {
    const r = structuredClone(modelHousehold("salariedCoupleTwoKids"));
    const res = r.input.household.residences![0]!;
    res.valuation = valuation;
    if (rows !== undefined) (res as unknown as { valueStates?: unknown }).valueStates = rows;
    return r;
  };
  const got = (r: EngineRequest) => Object.fromEntries(exportAnswers(full5(), r).answers.filter((a) => KEYS.includes(a.key) && a.status !== "blank").map((a) => [a.key, a.status === "value" ? `${a.raw?.kind === "bool" ? "" : a.raw?.text}${a.raw2 !== undefined && a.raw2.kind !== "bool" ? ` ${a.raw2.text}` : ""}` : a.status]));
  const box = (value: number) => ({ value, state: "confirmed" as const, origin: { kind: "manual" } });

  it("買った値段で入れた家: 買った年月（住み始め）・買った値段・うち土地の値段を書く", () => {
    expect(got(req({ value: box(38_000_000), asOf: "2016-04", landShare: shareOfLand(14_000_000, 38_000_000), basis: "purchase" }))).toEqual({ "hs.housing.purchaseMonth": "2016年（平成28年） 4月", "hs.housing.purchasePrice": "3800", "hs.housing.purchaseLand": "1400" });
  });

  it("入れ方を書いていない前の版の世帯で、時点が前の月なら買った値段として書く。今の時価で入れた評価額は書かない", () => {
    expect(got(req({ value: box(38_000_000), asOf: "2016-04" }))["hs.housing.purchasePrice"]).toBe("3800");
    expect(got(req({ value: box(38_000_000), asOf: "2026-10", basis: "market" }))["hs.housing.purchasePrice"]).toBeUndefined();
    expect(got(req({ value: box(38_000_000), asOf: "2026-10" }))["hs.housing.purchasePrice"]).toBeUndefined();
  });

  it("土地の割合が推定（建った年からの目安など）・空なら土地の値段は書かない。推定の評価額も書かない", () => {
    const est = { "residence.valuation/landShare": { state: "estimated", origin: { kind: "auto" }, estimate: { method: "derived", basis: "目安" } } };
    expect(got(req({ value: box(38_000_000), asOf: "2016-04", landShare: "0.4" }, est))["hs.housing.purchaseLand"]).toBeUndefined();
    expect(got(req({ value: box(38_000_000), asOf: "2016-04" }))["hs.housing.purchaseLand"]).toBeUndefined();
    expect(got(req({ value: { value: 38_000_000, state: "estimated", origin: { kind: "auto" } } as never, asOf: "2016-04" }))["hs.housing.purchasePrice"]).toBeUndefined();
  });

  it("Excel: 書き出し → 記入 → 取り込み → 書き出しで、同じ答え。計算エンジンで計算できる", async () => {
    const r0 = req({ value: box(38_000_000), asOf: "2016-04", landShare: shareOfLand(14_000_000, 38_000_000), basis: "purchase" });
    const s = await createHearingSheet({ definition: full5(), household: { request: r0 }, requestId: "R-7K3P9Q", customerNo: "A0042", office: OFFICE, appVersion: "0.1.0", exportedOn: "2026-11-09" });
    const back = await importHearingSheet(s.bytes, { baseMonth: "2026-10", requests: [s.request], newId: idSeq("again") });
    if (!back.ok) throw new Error(JSON.stringify(back.issues));
    const res = back.request.input.household.residences![0]!;
    expect(res.valuation).toMatchObject({ value: { value: 38_000_000, state: "confirmed" }, asOf: "2016-04", landShare: shareOfLand(14_000_000, 38_000_000) });
    expect(exportAnswers(full5(), back.request, { assumed: back.assumed }).answers).toEqual(s.filled.answers);
    if (engineAvailable()) expect(preview(approveAll(back, "2026-11-09T10:00:00+09:00")).error).toBeUndefined();
  });
});

describe("見本のシート full-5・basic-3", () => {
  for (const [name, check] of [
    ["full-5-sample", (v: NonNullable<Residence["valuation"]>, res: Residence) => {
      expect(res.from).toEqual({ at: "2020-03" });
      expect(v).toMatchObject({ value: { value: 45_800_000, state: "confirmed" }, asOf: "2020-03" });
      expect(landOfShare(45_800_000, v.landShare!)).toBe(18_300_000);
    }],
    ["basic-3-sample", (v: NonNullable<Residence["valuation"]>, res: Residence) => {
      expect(res.from).toEqual({ at: "2017-09" });
      expect(v).toMatchObject({ value: { value: 45_000_000, state: "estimated", certainty: "rough" }, asOf: "2017-09" });
      expect(v.landShare).toBeUndefined();
    }],
  ] as const) {
    it(`${name}: .xlsx は JSON から作り直したものと同じ。取り込むと持ち家の評価が入り、計算できる`, async () => {
      const json = JSON.parse(readFileSync(join(HEARING_DIR, "samples", `${name}.json`), "utf8")) as SampleFile;
      const xlsx = new Uint8Array(readFileSync(join(HEARING_DIR, "samples", `${name}.xlsx`)));
      expect(Buffer.compare(Buffer.from(await sampleBytes(`${name}.json`, json)), Buffer.from(xlsx))).toBe(0);
      const r = await importHearingSheet(xlsx, { baseMonth: "2026-10", newId: idSeq(name) });
      if (!r.ok) throw new Error(JSON.stringify(r.issues));
      expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
      const res = r.request.input.household.residences![0]!;
      check(res.valuation!, res);
      if (engineAvailable()) expect(preview(approveAll(r, "2026-11-09T10:00:00+09:00")).error).toBeUndefined();
    });
  }
});

describe("Web: 持ち家の方だけに聞く", () => {
  async function packetOf(def: SheetDefinition): Promise<QuestionsPacket> {
    const store = memoryStore();
    const t: RelayTransport = async (r) => {
      const headers: Record<string, string> = {};
      if (r.token !== undefined) headers.authorization = `Bearer ${r.token}`;
      const res = await handleApi(new Request(`https://relay.test${API_PREFIX}${r.path}`, { method: r.method, headers, ...(r.body !== undefined ? { body: r.body } : {}) }), { store, now: () => new Date("2026-11-05T09:00:00Z") });
      return { status: res.status, body: await res.text() };
    };
    const issued = await issueRequest({ definition: def, selection: selectionFromSheet(def), requestId: "R-7K3P9Q", customerNo: "A0042", office: { name: "【架空】みらいFP事務所", color: "#2f6f5e", purpose: "", privacyContact: "" }, now: new Date("2026-11-05T09:00:00Z"), pageUrl: "https://relay.test/h/", transport: t });
    return (await openRequest(new URL(issued.record.url).hash, t)).packet;
  }
  const v = (text: string): DraftAnswer => ({ status: "value", raw: { kind: "text", text } });
  const keysOf = (list: Screen[]) => list.flatMap((s) => (s.kind === "item" ? s.fields.flatMap((f) => [f.key, ...f.alt]) : []));

  it("家を買った年月・値段・うち土地は1画面。持ち家の方だけに出し、詳細では住み始めた年月の代わりに聞く", async () => {
    for (const def of [simple(), full5()]) {
      const p = await packetOf(def);
      const own = screens(p, { ...initialDraft(p), answers: { [draftKey("hs.housing.type")]: v("own") }, gates: { spouse: 0, child: 0, loan: 1, policy: 0, parent: 0 } });
      const at = own.find((s) => screenId(s) === "item:hs.housing.purchaseMonth#0");
      expect(at, def.sheetId).toBeDefined();
      expect(at?.kind === "item" ? at.fields.map((f) => f.key) : []).toEqual(KEYS);
      expect(keysOf(own)).not.toContain("hs.housing.since");
      const rent = screens(p, { ...initialDraft(p), answers: { [draftKey("hs.housing.type")]: v("rent") }, gates: { spouse: 0, child: 0, loan: 0, policy: 0, parent: 0 } });
      expect(keysOf(rent).filter((k) => k.startsWith("hs.housing.purchase"))).toEqual([]);
      if (def.sheetId === "full") expect(keysOf(rent)).toContain("hs.housing.since");
    }
  });

  it("お客さまの画面の言葉は短い日本語（専門用語を出さない）。シンプルは買った値段を範囲でも答えられる", async () => {
    const p = await packetOf(simple());
    const by = new Map(p.items.map((i) => [i.key, i]));
    expect(by.get("hs.housing.purchaseMonth")?.label).toBe("家を買ったのはいつですか");
    expect(by.get("hs.housing.purchasePrice")?.label).toBe("買ったときの値段（土地と建物の合計）");
    expect(by.get("hs.housing.purchaseLand")?.label).toBe("そのうち土地の値段（分からなければ空のままで大丈夫です）");
    expect(by.get("hs.housing.purchasePrice")?.guide).toBe("売買契約書の値段（土地と建物の合計）。仲介手数料などの諸費用や、後からのリフォームの費用は含めません。だいたいの額でかまいません。");
    const own = screens(p, { ...initialDraft(p), answers: { [draftKey("hs.housing.type")]: v("own") }, gates: { spouse: 0, child: 0, parent: 0 } });
    const at = own.find((s) => screenId(s) === "item:hs.housing.purchaseMonth#0");
    expect(at?.kind === "item" ? at.fields.find((f) => f.key === "hs.housing.purchasePrice")?.alt : []).toEqual(["hs.housing.purchasePriceRange"]);
    // 答えて送ると、答えた3つだけが届く
    const d = { ...initialDraft(p), answers: { [draftKey("hs.housing.type")]: v("own"), [draftKey("hs.housing.purchaseMonth")]: { status: "value" as const, raw: { kind: "text" as const, text: "2015" }, raw2: { kind: "number" as const, text: "4" } }, [draftKey("hs.housing.purchasePrice")]: { status: "value" as const, raw: { kind: "number" as const, text: "4000" } } }, gates: { spouse: 0, child: 0, parent: 0 } };
    expect(answersOf(p, d, new Date("2026-11-06T00:00:00Z")).answers.filter((a) => a.key.startsWith("hs.housing.purchase")).map((a) => a.key)).toEqual(["hs.housing.purchaseMonth", "hs.housing.purchasePrice"]);
  });
});
