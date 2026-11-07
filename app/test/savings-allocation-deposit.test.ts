// 資産配分を計算に渡す・預金の利回り・取得価額の0円・収益不動産の取得の年月（0137）:
// - 資産配分に切り替えたら、画面に出している割合・信託報酬・期待リターンが計算に入る（切り替えただけで結果が同じ、を戻さない）。戻したら前と同じ
// - 預金・外貨預金は前提条件の預金の利回り（既定の値 0.1%）で増え、運用利回りを上げても預金は増えない
// - NISA・課税口座を足しても取得価額を0円で書かない。前の版の0円は知らせと「時価と同じにする」
// - 収益不動産の取得の年月を空にしても取得価額は消えず、取得の年月を先に入れても残る
// - 前提条件の例外の年の足すボタン（年金の調整率の基礎年金・厚生年金）と、資産の種類ごとの利回りの足すボタン（全部）
import { describe, expect, it } from "vitest";
import type { EngineRequest, PreviewResult } from "../src/engine/types.ts";
import { allFields, type FieldDef, type StageDef } from "../src/workspace/input/form.ts";
import { blankHousehold, DEFAULT_ASSUMPTIONS, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { exceptionWhat } from "../src/workspace/input/stages/assumptions.ts";
import { ZERO_COST_NOTICE } from "../src/workspace/input/stages/savings.ts";
import { addRentalProperty, rentalProperties } from "../src/workspace/input/stages/rental.ts";
import { allocationGaps, classReturnKey, classRows, DEFAULT_MIX, defaultFee, fillAllocation, portfolioOf, rateOf, setClassReturn, switchMethod } from "../src/workspace/input/savings/model.ts";
import { checkList } from "../src/workspace/input/checkRows.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { OFFICE_ASSUMPTIONS } from "../src/workspace/office/settings.ts";
import { ASSET_CLASSES } from "../src/workspace/input/labels.ts";
import { modelHousehold, preview } from "./helpers.ts";

const seq = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
const open = (id: string): WorkingHousehold => fromRequest(modelHousehold(id));
const fieldIn = (st: StageDef, key: string): FieldDef => {
  const f = allFields(st).find((x) => x.key === key);
  if (f === undefined) throw new Error(`欄が無い: ${key}`);
  return f;
};
const put = (wh: WorkingHousehold, stage: Parameters<typeof buildStage>[0], key: string, v: Parameters<FieldDef["set"]>[1]): WorkingHousehold => fieldIn(buildStage(stage, wh), key).set(wh, v);
const financial = (r: PreviewResult, year: number) => r.table.filter((c) => c.row === "cf.balance.financial" && c.year === year).reduce((s, c) => s + c.amount, 0);
const balance = (r: PreviewResult, kind: string, year: number) => r.table.filter((c) => c.row === `cf.balance.account.${kind}` && c.year === year).reduce((s, c) => s + c.amount, 0);
const last = (req: EngineRequest) => req.input.endYear;

describe("資産配分を計算に渡す（0137）", () => {
  it("資産配分に切り替えたら、出している割合・信託報酬が計算の入れ物に入り、期待リターンは目安を推定の印で書く（預金の種類は預金の利回りに任せる）", () => {
    const before = open("investmentCouple");
    expect(before.request.input.assumptions?.investment?.method).toBeUndefined();
    const wh = switchMethod(before, "allocation");
    const inv = wh.request.input.assumptions?.investment;
    expect(inv?.allocation).toEqual({ mix: [...DEFAULT_MIX], fee: defaultFee() });
    expect(allocationGaps(wh.request)).toEqual([]);
    // 見本はもう期待リターンを持っている種類がある（FP が入れた値は推定にしない）
    for (const c of ["equity.domestic", "equity.global", "bond.global", "reit.global"]) expect(wh.request.input.assumptions?.assetReturns?.[c]).toBeDefined();
    // 表の組み合わせた期待リターン−信託報酬が、運用する口座の計算の利回り（rateOf は資産配分の当て方の前の値なので、表の値で比べる）
    const port = portfolioOf(wh.request);
    expect(port.fee).toBeCloseTo(Number(defaultFee()), 10);
    // 計算の結果が変わる（切り替えただけで同じ、を戻さない）
    expect(financial(preview(wh.request), last(wh.request))).not.toBe(financial(preview(before.request), last(before.request)));
  });

  it("期待リターンの無い世帯（新しい顧客）: 切り替えると目安を推定で書き、計算は表の値で打ったのと同じ。口座の入れ方に戻すと前と同じ", () => {
    let wh = blankHousehold("2026-10", seq());
    wh = mutate(wh, (h) => {
      (h.accounts ??= []).push({ id: "00000000-0000-4000-8000-0000000000a1", kind: "nisa", owner: h.members[0]!.id, marketValue: { value: 5_000_000, state: "confirmed", origin: { kind: "manual" } }, asOf: "2026-10", contributions: [], assetMix: [{ assetClass: "equity.global", share: "1" }] });
    });
    const accounts = preview(wh.request);
    const alloc = switchMethod(wh, "allocation");
    const ar = alloc.request.input.assumptions?.assetReturns ?? {};
    for (const m of DEFAULT_MIX) {
      if (m.assetClass.startsWith("cash.")) {
        expect(ar[m.assetClass], m.assetClass).toBeUndefined();
        continue;
      }
      const row = classRows(alloc.request).find((r) => r.key === m.assetClass)!;
      expect(ar[m.assetClass]?.default).toBe(row.mu);
      expect(alloc.assumed[classReturnKey(m.assetClass)]).toMatch(/^既定の値（.*期待リターンの目安/);
    }
    // 前提条件の資産の種類ごとの利回りの欄も推定（確かめの一覧の前提条件の標準の値に出る）
    const f = fieldIn(buildStage("assumptions", alloc), classReturnKey("equity.global"));
    expect(fieldStatus(f, alloc).status).toBe("estimated");
    expect(checkList(alloc).some((r) => r.fieldKey === classReturnKey("equity.global") && r.kind === "premise")).toBe(true);
    // 表の値を全部打ったのと同じ結果
    let typed = switchMethod(wh, "allocation");
    for (const m of DEFAULT_MIX) if (!m.assetClass.startsWith("cash.")) typed = setClassReturn(typed, m.assetClass, classRows(typed.request).find((r) => r.key === m.assetClass)!.mu);
    expect(Object.keys(typed.assumed).some((k) => k.startsWith("assume/assetReturns/"))).toBe(false);
    const allocResult = preview(alloc.request);
    expect(financial(allocResult, 2050)).toBe(financial(preview(typed.request), 2050));
    expect(financial(allocResult, 2050)).not.toBe(financial(accounts, 2050));
    // 口座の入れ方に戻すと、推定のまま書いた期待リターンを外し、前と同じ結果（口座の資産の配分の利回りが変わらない）
    const back = switchMethod(alloc, "accounts");
    expect(back.request.input.assumptions?.assetReturns).toBeUndefined();
    expect(financial(preview(back.request), 2050)).toBe(financial(accounts, 2050));
    // 打った値（確定）は戻しても残す
    const backTyped = switchMethod(typed, "accounts");
    expect(backTyped.request.input.assumptions?.assetReturns?.["equity.global"]).toBeDefined();
  });

  it("表の期待リターンを空にすると目安の推定に戻す（計算と表を食い違わせない）。預金の種類は預金の利回りに戻す", () => {
    let wh = switchMethod(blankHousehold("2026-10", seq()), "allocation");
    wh = setClassReturn(wh, "equity.global", "0.07");
    expect(wh.assumed[classReturnKey("equity.global")]).toBeUndefined();
    wh = setClassReturn(wh, "equity.global", null);
    const preset = classRows(switchMethod(blankHousehold("2026-10", seq()), "allocation").request).find((r) => r.key === "equity.global")!.mu;
    expect(wh.request.input.assumptions?.assetReturns?.["equity.global"]?.default).toBe(preset);
    expect(wh.assumed[classReturnKey("equity.global")]).toBeDefined();
    wh = setClassReturn(wh, "cash.deposit", "0.002");
    wh = setClassReturn(wh, "cash.deposit", null);
    expect(wh.request.input.assumptions?.assetReturns?.["cash.deposit"]).toBeUndefined();
    expect(classRows(wh.request).find((r) => r.key === "cash.deposit")?.mu).toBe(DEFAULT_ASSUMPTIONS.depositReturn.default);
  });

  it("前の版で資産配分にした世帯（配分が計算に無い）は、まだ入っていないことを知らせ、押すと表の値で計算する", () => {
    const old = mutate(blankHousehold("2026-10", seq()), (_h, req) => {
      req.input.assumptions = { ...req.input.assumptions!, investment: { method: "allocation" } };
    });
    expect(allocationGaps(old.request)).toContain("割合と信託報酬");
    // 表の信託報酬は、配分の無い世帯だけ目安を見せる（配分を書いた世帯は書いた値。無ければ引かない）
    expect(portfolioOf(old.request).fee).toBeCloseTo(Number(defaultFee()), 10);
    const fixed = fillAllocation(old);
    expect(allocationGaps(fixed.request)).toEqual([]);
    expect(fixed.request.input.assumptions?.investment?.allocation?.fee).toBe(defaultFee());
    const noFee = mutate(fixed, (_h, req) => {
      delete req.input.assumptions!.investment!.allocation!.fee;
    });
    expect(portfolioOf(noFee.request).fee).toBe(0);
  });
});

describe("預金の利回り（0137）", () => {
  it("新しい世帯の預金の利回りは既定の値 0.1%（推定）。運用利回りを3%にしても預金は0.1%で増える", () => {
    let wh = blankHousehold("2026-10", seq());
    expect(wh.request.input.assumptions?.depositReturn).toEqual({ default: "0.001" });
    const f = fieldIn(buildStage("assumptions", wh), "assume/depositReturn");
    expect(f.level).toBe("detail");
    expect(f.label).toBe("預金の利回り（年）");
    expect(fieldStatus(f, wh).status).toBe("estimated");
    wh = mutate(wh, (h) => {
      (h.accounts ??= []).push({ id: "00000000-0000-4000-8000-0000000000d1", kind: "deposit", owner: h.members[0]!.id, marketValue: { value: 10_000_000, state: "confirmed", origin: { kind: "manual" } }, asOf: "2026-10", contributions: [] });
      (h.accounts ??= []).push({ id: "00000000-0000-4000-8000-0000000000d2", kind: "fxDeposit", owner: h.members[0]!.id, marketValue: { value: 1_000_000, state: "confirmed", origin: { kind: "manual" } }, asOf: "2026-10", contributions: [] });
    });
    wh = put(wh, "assumptions", "assume/investmentReturn", "0.03");
    const dep = (wh.request.input.household.accounts ?? []).find((a) => a.kind === "deposit")!;
    const fx = (wh.request.input.household.accounts ?? []).find((a) => a.kind === "fxDeposit")!;
    expect(rateOf(wh.request, dep)).toBe("0.001");
    expect(rateOf(wh.request, fx)).toBe("0.001");
    const r = preview(wh.request);
    // 外貨預金は入金・取り崩しが無いので、1年分の0.1%（2027年の年末）
    expect(balance(r, "fxDeposit", 2027)).toBe(balance(r, "fxDeposit", 2026) + Math.floor(balance(r, "fxDeposit", 2026) * 0.001));
    // 預金の利回りを直すと預金の利回りが変わる。空にすると既定の値に戻る
    wh = put(wh, "assumptions", "assume/depositReturn", "0.002");
    expect(rateOf(wh.request, dep)).toBe("0.002");
    wh = put(wh, "assumptions", "assume/depositReturn", null);
    expect(wh.request.input.assumptions?.depositReturn?.default).toBe("0.001");
  });

  it("預金の利回りの無い前の要求は空欄で、計算は運用利回りと同じと添える。資産の種類ごとの利回りに預金があれば、そちらで計算すると添える", () => {
    const req = structuredClone(modelHousehold("single45"));
    delete (req.input.assumptions as { depositReturn?: unknown }).depositReturn;
    const wh = fromRequest(req);
    const f = fieldIn(buildStage("assumptions", wh), "assume/depositReturn");
    expect(f.get(wh)).toMatchObject({ value: null, hint: "空欄（運用利回りと同じ 1%で計算しています）" });
    const sample = mutate(open("salariedCoupleTwoKids"), (_h, r) => {
      r.input.assumptions = { ...r.input.assumptions!, assetReturns: { ...(r.input.assumptions!.assetReturns ?? {}), "cash.deposit": { default: "0.001" } } };
    });
    const g = fieldIn(buildStage("assumptions", sample), "assume/depositReturn").get(sample);
    expect(g.value).toBe("0.001");
    expect(g.hint).toBe("預金は「資産の種類ごとの利回り」の預金（0.1%）で計算しています");
  });

  it("事務所の既定値の前提条件の標準値の系列（前提条件の欄のキーと同じ名前。0073 の追記 2026-11-07 で足した）", () => {
    expect(OFFICE_ASSUMPTIONS).toContain("depositReturn");
    expect(Object.keys(DEFAULT_ASSUMPTIONS)).toContain("depositReturn");
  });
});

describe("前提条件の足すボタン（0137）", () => {
  it("例外の年の足すボタンは、年金の調整率の基礎年金・厚生年金を見分けられる。ほかは「（年）」だけ外す", () => {
    expect(exceptionWhat("年金の調整率（基礎年金・年）")).toBe("年金の調整率・基礎年金");
    expect(exceptionWhat("年金の調整率（厚生年金・年）")).toBe("年金の調整率・厚生年金");
    expect(exceptionWhat("物価上昇率（年）")).toBe("物価上昇率");
    const st = buildStage("assumptions", blankHousehold("2026-10", seq()));
    const labels = st.sections.find((s) => s.key === "assume/exceptions")!.actions.map((a) => a.label);
    expect(labels).toContain("＋ 例外の年（年金の調整率・基礎年金）");
    expect(labels).toContain("＋ 例外の年（年金の調整率・厚生年金）");
    expect(labels).toContain("＋ 例外の年（預金の利回り）");
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("資産の種類ごとの利回りの足すボタンは、まだ足していない種類を全部出す（国内REIT・不動産なども最初から押せる）", () => {
    const st = buildStage("assumptions", blankHousehold("2026-10", seq()));
    const acts = st.sections.find((s) => s.key === "assume/assetReturns")!.actions;
    expect(acts).toHaveLength(ASSET_CLASSES.length);
    expect(acts.map((a) => a.label)).toEqual(expect.arrayContaining(["＋ 国内REIT", "＋ 不動産", "＋ その他"]));
    // 預金を足すと今の預金の利回りから始める
    let wh = blankHousehold("2026-10", seq());
    wh = put(wh, "assumptions", "assume/depositReturn", "0.003");
    wh = acts.find((a) => a.key === "assume/addReturn/cash.deposit")!.run(wh);
    expect(wh.request.input.assumptions?.assetReturns?.["cash.deposit"]?.default).toBe("0.003");
  });

  it("運用利回りの説明は費用を引いた後（税は計算で引く）", () => {
    const wh = blankHousehold("2026-10", seq());
    expect(fieldIn(buildStage("assumptions", wh), "assume/investmentReturn").help).toMatch(/預金以外で、資産の配分を入れていない口座の利回りです（運用の費用を引いた後。税は計算で引きます）/);
  });
});

describe("取得価額の0円（0137）", () => {
  it("NISA・課税口座・こどもNISA を足しても取得価額を書かない（空欄＝時価と同じ）", () => {
    let wh = open("salariedCoupleTwoKids");
    const st = buildStage("savings", wh);
    for (const kind of ["nisa", "taxable", "childNisa"]) {
      const before = new Set((wh.request.input.household.accounts ?? []).map((a) => a.id));
      wh = st.sections.flatMap((s) => s.actions).find((a) => a.key === `sav/add/${kind}`)!.run(wh);
      const added = (wh.request.input.household.accounts ?? []).find((a) => !before.has(a.id))!;
      expect(added.costBasis, kind).toBeUndefined();
    }
  });

  it("前の版で残高があるのに取得価額が0円の口座は、欄と確かめの一覧に知らせ、押したときだけ時価と同じにする", () => {
    const wh = mutate(open("salariedCoupleTwoKids"), (h) => {
      (h.accounts ??= []).push({ id: "00000000-0000-4000-8000-0000000000c1", kind: "taxable", owner: h.members[0]!.id, marketValue: { value: 3_000_000, state: "confirmed", origin: { kind: "manual" } }, costBasis: { value: 0, state: "confirmed", origin: { kind: "manual" } }, asOf: "2026-10", contributions: [] });
    });
    const f = fieldIn(buildStage("savings", wh), "sav/00000000-0000-4000-8000-0000000000c1/cost");
    const st = f.get(wh);
    expect(st.warn).toBe(ZERO_COST_NOTICE);
    const row = checkList(wh).find((r) => r.fieldKey === f.key && r.kind === "notice");
    expect(row?.detail).toBe(ZERO_COST_NOTICE);
    // 値は黙って変えない
    expect((wh.request.input.household.accounts ?? []).find((a) => a.kind === "taxable" && a.id.endsWith("c1"))?.costBasis?.value).toBe(0);
    const fixed = row!.actions.find((a) => a.label === "時価と同じにする")!.run(wh);
    expect((fixed.request.input.household.accounts ?? []).find((a) => a.id.endsWith("c1"))?.costBasis).toBeUndefined();
    expect(fieldIn(buildStage("savings", fixed), f.key).get(fixed).warn ?? null).toBeNull();
    // 課税口座の取り崩しの税が減る（残高の全部を利益とみなさない）
    const tax = (r: PreviewResult) => r.table.filter((c) => c.row.startsWith("cf.taxSi.") && c.row.includes("investment")).reduce((s, c) => s + c.amount, 0);
    expect(tax(preview(fixed.request))).toBeLessThanOrEqual(tax(preview(wh.request)));
  });
});

describe("収益不動産の取得の年月（0137）", () => {
  const setup = () => {
    const wh = addRentalProperty(blankHousehold("2026-10", seq()));
    const a = rentalProperties(wh.request.input.household)[0]!;
    return { wh, id: a.id, k: `sav/${a.id}/property` };
  };
  const acqOf = (wh: WorkingHousehold, id: string) => (wh.request.input.household.accounts ?? []).find((a) => a.id === id)?.property?.acquisition;

  it("取得価額を先に入れると、取得の年月は評価額の時点で補い推定の印。取得の年月を空にしても取得価額は消えない", () => {
    const s0 = setup();
    const { id, k } = s0;
    let wh = s0.wh;
    wh = put(wh, "rental", `${k}/acqPrice`, 25_000_000);
    expect(acqOf(wh, id)).toEqual({ price: 25_000_000, at: "2026-10" });
    const at = fieldIn(buildStage("rental", wh), `${k}/acqAt`);
    expect(fieldStatus(at, wh).status).toBe("estimated");
    wh = put(wh, "rental", `${k}/acqAt`, "2019-04");
    expect(acqOf(wh, id)).toEqual({ price: 25_000_000, at: "2019-04" });
    expect(fieldStatus(fieldIn(buildStage("rental", wh), `${k}/acqAt`), wh).status).not.toBe("estimated");
    // 取得の年月を空にする（Backspace で消す）: 取得価額は残り、年月は評価額の時点で補う（推定の印）
    wh = put(wh, "rental", `${k}/acqAt`, null);
    expect(acqOf(wh, id)).toEqual({ price: 25_000_000, at: "2026-10" });
    expect(fieldStatus(fieldIn(buildStage("rental", wh), `${k}/acqAt`), wh).status).toBe("estimated");
    // 打ち直せる
    wh = put(wh, "rental", `${k}/acqAt`, "2018-10");
    expect(acqOf(wh, id)).toEqual({ price: 25_000_000, at: "2018-10" });
    expect(() => preview(wh.request)).not.toThrow();
  });

  it("取得の年月を先に入れても残り（取得価額が未入力の取得）、計算できる。後から取得価額を入れると年月はそのまま", () => {
    const s0 = setup();
    const { id, k } = s0;
    let wh = s0.wh;
    wh = put(wh, "rental", `${k}/acqAt`, "2015-04");
    expect(acqOf(wh, id)).toEqual({ at: "2015-04" });
    expect(fieldIn(buildStage("rental", wh), `${k}/acqAt`).get(wh).value).toBe("2015-04");
    expect(() => preview(wh.request)).not.toThrow();
    wh = put(wh, "rental", `${k}/acqPrice`, 18_000_000);
    expect(acqOf(wh, id)).toEqual({ price: 18_000_000, at: "2015-04" });
    // 取得価額を空にしても、入れた年月は残る
    wh = put(wh, "rental", `${k}/acqPrice`, null);
    expect(acqOf(wh, id)).toEqual({ at: "2015-04" });
  });

  it("補った年月のまま取得価額を空にしたら、補った年月も外す（年月だけの取得を黙って残さない）", () => {
    const s0 = setup();
    const { id, k } = s0;
    let wh = s0.wh;
    wh = put(wh, "rental", `${k}/acqPrice`, 25_000_000);
    wh = put(wh, "rental", `${k}/acqPrice`, null);
    expect(acqOf(wh, id)).toBeUndefined();
    expect(wh.assumed[`${k}/acqAt`]).toBeUndefined();
  });
});
