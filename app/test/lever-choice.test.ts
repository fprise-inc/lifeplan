// 対策に最初から出す項目（事務所の既定値。0084）: 既定は4つ（働く最後の年齢・年金の受け取り開始・生活費・配偶者の働き方と年収）。FP顧問料は既定では出さない・
// 選ぶと出る／外すと消える・ローンと口座ごとの項目は種類で選ぶ・外しても値が入っていれば出す（FP顧問料は除く）・FP顧問料を出さなくても計算は変わらない・
// 「外す」は現状の値に戻し、土台のプランが動かした項目も必ず消える（保存しても戻らない）・
// 古い事務所データは既定のまま・既定の組み合わせは1か所で差し替えられる・配偶者の働き方と年収の項目（当てる・保存して読み戻す）
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { advisoryFeeSummary } from "../src/engine/types.ts";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { addAdvisoryFee } from "../src/workspace/input/stages/fees.ts";
import { LeverCard } from "../src/workspace/LeverPanel.tsx";
import { OfficeSettingsPanel } from "../src/workspace/office/OfficeSettingsPanel.tsx";
import { DEFAULT_OFFICE_SETTINGS, isDefaultSettings, readOfficeSettings } from "../src/workspace/office/settings.ts";
import { ItemMenu, ItemRow } from "../src/workspace/plans/ItemControls.tsx";
import { buildCatalog, type Catalog } from "../src/workspace/plans/items.ts";
import {
  DEFAULT_LEVER_KINDS,
  isEmptyLeverChoice,
  LEVER_KINDS,
  leverKindOf,
  leverView,
  readLeverChoice,
  startKeys,
  startKinds,
  startsWith,
  visibleKeys,
  withStart,
  type LeverChoice,
} from "../src/workspace/plans/leverChoice.ts";
import { applyValues, effectiveValues, savePlan } from "../src/workspace/plans/plans.ts";
import { keyOf, resolveKey } from "../src/workspace/store/readings.ts";
import { bodyOf, EMPTY_CARRY, fromBody } from "../src/workspace/store/body.ts";
import { roles } from "../src/workspace/roles.ts";
import { financialOf } from "../src/workspace/present.ts";
import { modelHousehold, preview } from "./helpers.ts";

const ids = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
const noop = () => undefined;
const open = (id: string): WorkingHousehold => fromRequest(modelHousehold(id));
const catOf = (wh: WorkingHousehold, demo: string | null = null): Catalog => buildCatalog(wh, roles(wh.request).find((r) => r.key === "self")!.member.id, demo === null ? null : (demoHousehold(demo) ?? null));
const keys = (xs: { key: string }[]) => xs.map((x) => x.key);
const spouseKey = (wh: WorkingHousehold) => `spouse:${wh.request.input.household.members.find((m) => m.kind === "spouse")!.id}:work`;
const MODELS = ["singleEarnerTwoKids", "salariedCoupleTwoKids", "pairLoan", "investmentCouple", "lifetime100Plan", "advisoryFeeProposal", "dualAssetsTwoKids", "surplusSaving", "single25"];

describe("既定（事務所が何も選んでいないとき）", () => {
  it("働く最後の年齢・年金の受け取り開始・毎月の生活費・配偶者の働き方と年収の4つ。NISA と FP顧問料（契約がある世帯でも）は出さず、追加の一覧に出る", () => {
    expect(DEFAULT_LEVER_KINDS).toEqual(["lever:retireAge", "lever:pensionAge", "lever:livingMonthly", "spouse:work"]);
    expect(startKinds({})).toEqual(DEFAULT_LEVER_KINDS);
    for (const id of MODELS) {
      const wh = addAdvisoryFee(open(id), ids());
      const cat = catOf(wh);
      const v = leverView(cat, {}, [], {});
      // 前の5つ（builtin）から NISA と FP顧問料を除き、配偶者がいれば配偶者の働き方と年収を足した物
      const want = keys(cat.items.filter((it) => (it.builtin && it.key !== "lever:nisaMonthly" && it.key !== "lever:fee") || it.key.startsWith("spouse:")));
      expect(keys(v.top), id).toEqual(want);
      expect(v.added, id).toEqual([]);
      expect(cat.byKey.has("lever:fee"), id).toBe(true);
      expect(v.top.some((it) => it.key === "lever:fee"), id).toBe(false);
      // 見本の最初のプランのように顧問料を「入れる」にしていても、既定では出さない（入れているかは結論の下の一文で分かる）
      expect(leverView(cat, {}, [], { "lever:fee": true }).top.some((it) => it.key === "lever:fee"), id).toBe(false);
      const feeMenu = renderToString(h(ItemMenu, { catalog: cat, shown: visibleKeys(v), fixed: v.fixed, onPick: noop, onClose: noop }));
      expect(feeMenu, id).toContain('data-pick="lever:fee"');
      expect(v.top.some((it) => it.key.startsWith("spouse:")), id).toBe(id !== "single25");
      if (cat.byKey.has("lever:nisaMonthly")) {
        const menu = renderToString(h(ItemMenu, { catalog: cat, shown: visibleKeys(v), fixed: v.fixed, onPick: noop, onClose: noop }));
        expect(menu, id).toContain('data-pick="lever:nisaMonthly"');
      }
    }
  });

  it("見本の世帯のプランで NISA を動かしているものは、既定から外しても NISA が出る（見本のプランは崩れない）", () => {
    const demo = demoHousehold("salariedCoupleTwoKids")!;
    const wh = open("salariedCoupleTwoKids");
    const cat = catOf(wh, "salariedCoupleTwoKids");
    const plans = (demo.plans ?? []).filter((p) => Object.hasOwn(p.values, "lever:nisaMonthly"));
    for (const p of plans) expect(keys(leverView(cat, {}, [], p.values as never).top), p.name).toContain("lever:nisaMonthly");
    // 最初のプラン（見本の既定の値）で NISA が現状と違えば出る
    const nisaNow = cat.byKey.get("lever:nisaMonthly")!.read(wh);
    const first = demo.firstProposal.nisaMonthly ?? null;
    expect(keys(leverView(cat, {}, [], first !== nisaNow && first !== null ? { "lever:nisaMonthly": first } : {}).top).includes("lever:nisaMonthly")).toBe(first !== nisaNow && first !== null);
  });

  it("どの動かす項目も、入力の欄（field:）でなければ種類を持つ（項目を足したら種類も足す）", () => {
    for (const id of MODELS) {
      const cat = catOf(addAdvisoryFee(open(id), ids()));
      for (const it of cat.items) {
        if (it.key.startsWith("field:")) expect(leverKindOf(it.key)).toBeNull();
        else expect(leverKindOf(it.key), it.key).not.toBeNull();
      }
    }
    // 種類の一覧の見出しは、追加の一覧の見出しと同じ並び（対策 → 資産運用 → 貯まり方 → よく使う）
    expect([...new Set(LEVER_KINDS.map((k) => k.group))]).toEqual(["対策", "資産運用", "貯まり方", "よく使う"]);
  });
});

describe("選ぶと出る・外すと消える", () => {
  const wh = open("salariedCoupleTwoKids");
  const cat = catOf(wh, "salariedCoupleTwoKids");

  it("足した種類は最初から出し（外せない）、外した種類は出さず「＋ 動かす項目を追加」の一覧に出る", () => {
    let c: LeverChoice = withStart({}, "inv:rate", true);
    c = withStart(c, "surplus:ratio", true);
    c = withStart(c, "spouse:work", false);
    // 既定に無い NISA を外しても何も持たない
    c = withStart(c, "lever:nisaMonthly", false);
    expect(c).toEqual({ shown: ["inv:rate", "surplus:ratio"], hidden: ["spouse:work"] });
    const v = leverView(cat, c, [], {});
    expect(keys(v.top)).toEqual(["lever:retireAge", "lever:pensionAge", "lever:livingMonthly", "inv:rate", "surplus:ratio"]);
    expect(v.fixed.has(spouseKey(wh))).toBe(false);
    // 追加の一覧: 最初から出す項目は載せず、外した対策の固定の項目は見出し「対策」で載る
    const menu = renderToString(h(ItemMenu, { catalog: cat, shown: visibleKeys(v), fixed: v.fixed, onPick: noop, onClose: noop }));
    expect(menu).toContain('data-pick="lever:nisaMonthly"');
    expect(menu).toContain(`data-pick="${spouseKey(wh)}"`);
    expect(menu).toContain("<h4>対策</h4>");
    expect(menu).not.toContain('data-pick="inv:rate"');
    expect(menu).not.toContain('data-pick="lever:retireAge"');
    // 最初から出す項目の行には「外す」が無い。足した項目の行にはある
    const fixedRow = renderToString(h(ItemRow, { item: cat.byKey.get("inv:rate")!, value: "0.03", base: "0.03", wh, onSlide: noop, onRelease: noop, onRemove: null }));
    expect(fixedRow).not.toContain("外す");
    const addedRow = renderToString(h(ItemRow, { item: cat.byKey.get("inv:rate")!, value: "0.03", base: "0.03", wh, onSlide: noop, onRelease: noop, onRemove: noop }));
    expect(addedRow).toContain("外す");
    // 元に戻すと、既定と同じなので何も持たない
    expect(isEmptyLeverChoice(withStart(withStart(withStart(c, "inv:rate", false), "surplus:ratio", false), "spouse:work", true))).toBe(true);
    // NISA を事務所の設定で戻せる
    expect(keys(leverView(cat, withStart({}, "lever:nisaMonthly", true), [], {}).top)).toEqual(["lever:retireAge", "lever:pensionAge", "lever:nisaMonthly", "lever:livingMonthly", spouseKey(wh)]);
  });

  it("外した対策の固定の項目も、足せば対策の上に固定の形で出て、外せる", () => {
    const c: LeverChoice = {};
    const v = leverView(cat, c, ["lever:nisaMonthly", "inv:monthly"], {});
    expect(keys(v.top)).toEqual(["lever:retireAge", "lever:pensionAge", "lever:nisaMonthly", "lever:livingMonthly", spouseKey(wh)]);
    expect(keys(v.added)).toEqual(["inv:monthly"]);
    expect(v.fixed.has("lever:nisaMonthly")).toBe(false);
    const row = { key: "nisaMonthly" as const, label: "NISAの積立額（月）", slider: { kind: "amount" as const, min: 0, max: 50_000, step: 10_000, value: 10_000, base: 10_000, per: "月" as const, tick: String }, valueText: "月1万円", baseText: "月1万円", note: null };
    const card = (removable: boolean) =>
      renderToString(
        h(LeverCard, { selected: "プランB", baseLetter: "A", locked: null, modified: false, levers: [{ ...row, removable }], fee: null, onSlide: noop, onRemove: noop, onRelease: noop, onReset: noop, onOverwrite: null, onSaveNew: noop, suggested: "", changes: [], onAck: null, onDrop: null }),
      );
    expect(card(true)).toContain('data-lever-remove="nisaMonthly"');
    expect(card(false)).not.toContain("data-lever-remove");
  });
});

describe("ローン・口座ごとの項目は種類で選ぶ", () => {
  it("「住宅ローンの金利」を選ぶと、その世帯のローンすべての金利が出る。ローンの無い世帯には出ない", () => {
    const wh = open("pairLoan");
    const cat = catOf(wh);
    const loans = (wh.request.input.household.debts ?? []).filter((d) => d.kind === "mortgage");
    expect(loans).toHaveLength(2);
    const c = withStart({}, "loan:rate", true);
    const v = leverView(cat, c, [], {});
    expect(keys(v.top).filter((k) => k.startsWith("loan:"))).toEqual(loans.map((d) => `loan:${d.id}:rate`));
    for (const d of loans) expect(leverKindOf(`loan:${d.id}:rate`)).toBe("loan:rate");
    // 借入額か繰上返済かは、借入が始まっているかでローンごとに決まる（選んだ種類のほうだけ出る）
    const amount = leverView(cat, withStart(withStart({}, "loan:principal", true), "loan:prepay", true), [], {});
    const amt = keys(amount.top).filter((k) => k.startsWith("loan:"));
    expect(amt).toHaveLength(2);
    expect(amt.every((k) => /:(principal|prepay)$/.test(k))).toBe(true);
    const single = catOf(open("single25"));
    expect(keys(leverView(single, c, [], {}).top).some((k) => k.startsWith("loan:"))).toBe(false);
    expect(startKeys(single, c)).toEqual(startKeys(single, {}));
  });

  it("「資産運用の配分」を選ぶと、配分を動かせる口座すべてに出る", () => {
    const cat = catOf(open("investmentCouple"));
    const mixes = keys(cat.items.filter((it) => it.key.startsWith("mix:")));
    expect(mixes.length).toBeGreaterThan(1);
    const v = leverView(cat, withStart({}, "mix", true), [], {});
    expect(keys(v.top).filter((k) => k.startsWith("mix:"))).toEqual(mixes);
  });
});

describe("値が入っていれば、外しても出す", () => {
  it("選んだプランで値が入っている項目は、最初から出さない項目でも出す（外せる）。値が無ければ出さない", () => {
    const wh = addAdvisoryFee(open("salariedCoupleTwoKids"), ids());
    const cat = catOf(wh);
    const c: LeverChoice = { hidden: ["spouse:work"] };
    const none = leverView(cat, c, [], {});
    expect(keys(none.top)).toEqual(["lever:retireAge", "lever:pensionAge", "lever:livingMonthly"]);
    // FP顧問料だけは、値が入っていても出さない（最初から出すか、足したときだけ）
    const v = leverView(cat, c, [], { "lever:nisaMonthly": 50_000, "lever:fee": true, "inv:rate": "0.04" });
    expect(keys(v.top)).toEqual(["lever:retireAge", "lever:pensionAge", "lever:nisaMonthly", "lever:livingMonthly"]);
    expect(keys(leverView(cat, c, ["lever:fee"], { "lever:fee": true }).top)).toEqual(["lever:retireAge", "lever:pensionAge", "lever:livingMonthly", "lever:fee"]);
    // 外した配偶者の働き方と年収も、値が入っていれば足した項目として出す（外せる）
    expect(keys(leverView(cat, c, [], { [spouseKey(wh)]: { type: "regular", annual: 3_000_000 } }).added)).toEqual([spouseKey(wh)]);
    expect(v.fixed.has("lever:nisaMonthly")).toBe(false);
    // 対策の固定の項目でない項目は、足した項目の後ろに一覧の並びで出す
    expect(keys(v.added)).toEqual(["inv:rate"]);
    // 足した項目と値の入った項目が重なっても1回だけ
    expect(keys(leverView(cat, c, ["inv:rate"], { "inv:rate": "0.04" }).added)).toEqual(["inv:rate"]);
  });
});

describe("FP顧問料（既定では出さない。事務所の既定値で足せる）", () => {
  it("事務所の既定値で足すと、契約がある世帯に今までどおり出る。外すと出さない", () => {
    const wh = addAdvisoryFee(open("salariedCoupleTwoKids"), ids());
    const cat = catOf(wh);
    const c = withStart({}, "lever:fee", true);
    expect(c).toEqual({ shown: ["lever:fee"] });
    const v = leverView(cat, c, [], {});
    expect(keys(v.top)).toEqual(["lever:retireAge", "lever:pensionAge", "lever:livingMonthly", spouseKey(wh), "lever:fee"]);
    // 最初から出すので外せない（「外す」を付けない）
    expect(v.fixed.has("lever:fee")).toBe(true);
    // 既定に無いので、外しても何も持たない（前の事務所データの hidden は読めば残るが、出さないのは同じ）
    expect(isEmptyLeverChoice(withStart(c, "lever:fee", false))).toBe(true);
    expect(leverView(cat, readLeverChoice({ hidden: ["lever:fee"] }), [], {}).top.some((it) => it.key === "lever:fee")).toBe(false);
    // 契約の無い世帯は、足しても出ない
    const plain = catOf(open("salariedCoupleTwoKids"));
    expect(keys(leverView(plain, c, [], {}).top)).toEqual(keys(leverView(plain, {}, [], {}).top));
  });

  it("対策に出さないだけで、計算は変わらない（現状に入れていない契約は顧問料0のまま。プランで入れたものは入る）", () => {
    const wh = addAdvisoryFee(open("salariedCoupleTwoKids"), ids());
    const cat = catOf(wh);
    const c: LeverChoice = {};
    expect(leverView(cat, c, [], {}).top.some((it) => it.key === "lever:fee")).toBe(false);
    // 選び方は計算の要求に入らない: 値の無いプランの要求は、契約を現状のまま持つ
    const req = applyValues(wh, {}, cat);
    expect(req.input.household.advisoryFees).toEqual(wh.request.input.household.advisoryFees);
    expect(advisoryFeeSummary(preview(req))).toBeNull();
    // プランで入れた（値が入っている）なら、対策に出していなくても計算に入る。「＋ 動かす項目を追加」で足せば切り替えが出る
    const on = { "lever:fee": true };
    expect(leverView(cat, c, [], on).top.some((it) => it.key === "lever:fee")).toBe(false);
    expect(leverView(cat, c, ["lever:fee"], on).top.some((it) => it.key === "lever:fee")).toBe(true);
    expect(advisoryFeeSummary(preview(applyValues(wh, on, cat)))?.total).toBeGreaterThan(0);
    // 契約の無い世帯は、そもそも FP顧問料の項目が無い
    const plain = catOf(open("salariedCoupleTwoKids"));
    expect(plain.byKey.has("lever:fee")).toBe(false);
    expect(keys(leverView(plain, c, [], {}).top)).toEqual(keys(leverView(plain, {}, [], {}).top));
  });
});

describe("事務所データ（readOfficeSettings）", () => {
  it("欄の無い古い事務所データは既定のまま（今と同じ）。読めない値・知らない種類は捨てる", () => {
    const old = { version: 1, layout: null, items: {}, care: { selfAndSpouse: "warn" }, inheritLikelihood: "likely", assumptions: {}, realEstateRatio: null, changedOn: "2026-10-27" };
    const r = readOfficeSettings(old);
    expect(r.levers).toEqual({});
    expect(startKinds(r.levers)).toEqual(DEFAULT_LEVER_KINDS);
    expect(readOfficeSettings({ ...old, levers: "abc" }).levers).toEqual({});
    expect(readOfficeSettings({ ...old, levers: { shown: ["inv:rate", "field:x", 3, "inv:rate", "mix"], hidden: ["lever:fee", "nope"], extra: true } }).levers).toEqual({ shown: ["inv:rate", "mix"], hidden: ["lever:fee"] });
    // 両方にある種類は「出さない」
    expect(readLeverChoice({ shown: ["inv:rate"], hidden: ["inv:rate"] })).toEqual({ hidden: ["inv:rate"] });
    expect(DEFAULT_OFFICE_SETTINGS.levers).toEqual({});
    expect(isDefaultSettings({ ...DEFAULT_OFFICE_SETTINGS, levers: { hidden: ["lever:fee"] } })).toBe(false);
    const saved = { ...DEFAULT_OFFICE_SETTINGS, levers: withStart({}, "loan:rate", true) };
    expect(readOfficeSettings(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  });
});

describe("既定の組み合わせを差し替える", () => {
  it("差し替えると、事務所が足した・外した種類はそのままで、触っていない種類は新しい既定に従う", () => {
    const c: LeverChoice = { shown: ["inv:rate"], hidden: ["lever:fee"] };
    const next = ["lever:retireAge", "lever:pensionAge", "lever:livingMonthly", "lever:fee", "inv:monthly"] as const;
    expect(startKinds(c, next)).toEqual(["lever:retireAge", "lever:pensionAge", "lever:livingMonthly", "inv:monthly", "inv:rate"]);
    expect(startsWith({}, "lever:nisaMonthly", next)).toBe(false);
    expect(startKinds({}, next)).toEqual([...next.slice(0, 3), "lever:fee", "inv:monthly"]);
  });
});

describe("事務所の既定値の画面", () => {
  it("区画「対策に最初から出す項目」: 見出しごとに種類のチェック。既定の組み合わせにチェック", () => {
    const html = renderToString(h(OfficeSettingsPanel, { value: DEFAULT_OFFICE_SETTINGS, onSave: async () => undefined, shared: false, onClose: noop }));
    expect(html).toContain("対策に最初から出す項目");
    const checked = [...html.matchAll(/<input type="checkbox"([^>]*)data-office-lever-show="([^"]+)"/g)].filter((m) => /checked/.test(m[1] ?? "")).map((m) => m[2]);
    expect(checked).toEqual([...DEFAULT_LEVER_KINDS]);
    for (const k of LEVER_KINDS) expect(html).toContain(`data-office-lever-show="${k.kind}"`);
    expect(html).not.toContain("data-office-lever-show=\"field:");
    const html2 = renderToString(h(OfficeSettingsPanel, { value: { ...DEFAULT_OFFICE_SETTINGS, levers: { shown: ["loan:rate"], hidden: ["lever:fee"] } }, onSave: async () => undefined, shared: false, onClose: noop }));
    const checked2 = [...html2.matchAll(/<input type="checkbox"([^>]*)data-office-lever-show="([^"]+)"/g)].filter((m) => /checked/.test(m[1] ?? "")).map((m) => m[2]);
    expect(checked2).toEqual(["lever:retireAge", "lever:pensionAge", "lever:livingMonthly", "spouse:work", "loan:rate"]);
    // FP顧問料は既定ではチェックが無く、説明の文で既定では出さないこと・足せることを書く
    expect(checked).not.toContain("lever:fee");
    expect(html).toContain("FP顧問料は、既定では出しません");
  });
});

describe("配偶者の働き方と年収（0084）", () => {
  it("配偶者がいない世帯・65歳を過ぎて働いていない配偶者には出さない", () => {
    expect(catOf(open("single25")).items.some((it) => it.key.startsWith("spouse:"))).toBe(false);
    // 73歳で働いていない配偶者は出さない。64歳（65歳になる前の月まで働ける）なら出す
    expect(catOf(open("pensionCouple")).byKey.has(spouseKey(open("pensionCouple")))).toBe(false);
    expect(catOf(open("sampleSeniorCouple")).byKey.has(spouseKey(open("sampleSeniorCouple")))).toBe(true);
  });

  it("働いていない配偶者をパートにする: 今から65歳になる前の月までの期間を足し、年収を入れる。計算でき、手取りが増える。現状は変わらない", () => {
    const wh = open("singleEarnerTwoKids");
    const cat = catOf(wh);
    const it = cat.byKey.get(spouseKey(wh))!;
    expect(it.read(wh)).toEqual({ type: "unemployed", annual: 0 });
    expect(it.text(it.read(wh))).toBe("働いていない");
    const v = { type: "partTime", annual: 1_000_000 };
    expect(it.text(v)).toBe("パート・アルバイト・年収100万円");
    const req = applyValues(wh, { [it.key]: v }, cat);
    const sp = wh.request.input.household.members.find((m) => m.kind === "spouse")!;
    const ps = (req.input.household.employmentPeriods ?? []).filter((p) => p.member === sp.id);
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ type: "partTime", from: { at: wh.request.input.baseMonth } });
    expect((ps[0]!.salary!.annual.value ?? 0) + (ps[0]!.salary!.bonus?.value ?? 0)).toBe(1_000_000);
    expect((wh.request.input.household.employmentPeriods ?? []).some((p) => p.member === sp.id)).toBe(false);
    // パートの収入の分、金融資産が増える
    const fin = (r: typeof req) => [...financialOf(preview(r).table).values()].reduce((a, x) => a + x, 0);
    expect(fin(req)).toBeGreaterThan(fin(wh.request));
    // 当てた世帯で読み直すと、同じ値
    expect(it.read({ ...wh, request: req })).toEqual(v);
  });

  it("働いている配偶者の種類と年収を変える: 種類は入力で選び直したのと同じ形（要る欄・要らない欄）、年収は今の賞与の割合で分ける", () => {
    const wh = open("dualNoKids");
    const cat = catOf(wh);
    const it = cat.byKey.get(spouseKey(wh))!;
    const now = it.read(wh) as { type: string; annual: number };
    expect(now.type).toBe("regular");
    expect(now.annual).toBeGreaterThan(0);
    const toPart = applyValues(wh, { [it.key]: { type: "partTime", annual: 1_200_000 } }, cat);
    const sp = wh.request.input.household.members.find((m) => m.kind === "spouse")!;
    const p = (toPart.input.household.employmentPeriods ?? []).find((x) => x.member === sp.id)!;
    expect(p.type).toBe("partTime");
    expect(p.pensionCategory).toBeDefined();
    expect((p.salary!.annual.value ?? 0) + (p.salary!.bonus?.value ?? 0)).toBe(1_200_000);
    expect(() => preview(toPart)).not.toThrow();
    // 働かないにすると収入は無い（期間は「働いていない」の期間になる）
    const none = applyValues(wh, { [it.key]: { type: "unemployed", annual: 0 } }, cat);
    expect((none.input.household.employmentPeriods ?? []).find((x) => x.member === sp.id)!.type).toBe("unemployed");
    expect(() => preview(none)).not.toThrow();
    // 自営業は事業所得
    const self = applyValues(wh, { [it.key]: { type: "selfEmployed", annual: 3_000_000 } }, cat);
    expect((self.input.household.employmentPeriods ?? []).find((x) => x.member === sp.id)!.business?.income.value).toBe(3_000_000);
  });

  it("プランに保存すると合成の対策（spouseWork・構成員を持つ）の差分になり、読み戻すと同じ項目の値になる", () => {
    const wh = open("singleEarnerTwoKids");
    const cat = catOf(wh);
    const key = spouseKey(wh);
    const v = { type: "partTime", annual: 1_000_000 };
    const r = savePlan(wh, cat, { name: "B", base: null, values: { [key]: v }, now: "2026-10-29T00:00:00+09:00" });
    const plan = r.wh.proposals.find((p) => p.id === r.id)!;
    const sp = wh.request.input.household.members.find((m) => m.kind === "spouse")!;
    expect(plan.diffs).toHaveLength(1);
    expect(plan.diffs[0]!.target).toEqual({ lever: "spouseWork", member: sp.id });
    expect(effectiveValues(r.wh, r.id)).toEqual({ [key]: v });
    expect(resolveKey(key, wh.request.input as never)).toEqual({ kind: "lever", lever: "spouseWork", member: sp.id });
    expect(keyOf({ kind: "lever", lever: "spouseWork", member: sp.id }, wh.request.input as never)).toBe(key);
    // 世帯ファイルに書いて読み直しても同じ
    const back = fromBody(bodyOf({ wh: r.wh, workspace: { template: null, band: [r.id], base: "current", selected: r.id, shownItems: [] }, display: { result: {}, balance: {} } as never, carry: EMPTY_CARRY }));
    expect(effectiveValues(back.wh, r.id)).toEqual({ [key]: v });
  });
});
