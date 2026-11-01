// 貯蓄・運用のカードの中身（0050）: お金の行き先（取り崩す順番を口座ごとに・取り崩さない・決済口座・預金に残しておく額と目安のボタン）、
// 足した口座の未入力の印、口座ごとの詳細の欄（運用の費用・引き出せない期間・受け取りの年数と割合・加入の始まり・旧NISA の内訳）、
// 小規模企業共済の受け取り、貸していない不動産（貸している物件は収益不動産へ。0079）、合計の入れ方の平均の利回り（率をそのまま入れる）、専用の部品の欄の値の状態の操作、プランでの編集
import { describe, expect, it } from "vitest";
import type { Account, EngineRequest, PreviewResult } from "../src/engine/types.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { applyStateOp, availableOps, fieldStatus } from "../src/workspace/input/valueState.ts";
import { accountName, editTotal, livingMonthlyOf, reservePreset, resetWithdrawOrder, setSettlement, settlementOf, setWithdrawOrder, STANDARD_ORDER_KINDS, switchMethod, totalViewOf, UNENTERED_BALANCE, withdrawViewOf } from "../src/workspace/input/savings/model.ts";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { readPct, SavingsPanel } from "../src/workspace/input/savings/SavingsPanel.tsx";
import { checkList } from "../src/workspace/input/checkRows.ts";
import { RETURN_RANGE } from "../src/workspace/input/rateRanges.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { planView, recordPlanEdit } from "../src/workspace/plans/planEdit.ts";
import type { Proposal } from "../src/workspace/plans/plans.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold, preview } from "./helpers.ts";

const open = (): WorkingHousehold => fromRequest(modelHousehold("investmentCouple"));
const fieldsOf = (wh: WorkingHousehold): Map<string, FieldDef> => new Map(allFields(buildStage("savings", wh)).map((f) => [f.key, f]));
const fieldOf = (wh: WorkingHousehold, key: string): FieldDef => {
  const f = fieldsOf(wh).get(key);
  if (f === undefined) throw new Error(`欄が無い: ${key}`);
  return f;
};
const acc = (wh: WorkingHousehold, kind: string): Account => (wh.request.input.household.accounts ?? []).find((a) => a.kind === kind) as Account;
const balance = (r: PreviewResult, kind: string, year: number) => r.table.filter((c) => c.row === `cf.balance.account.${kind}` && c.year === year).reduce((s, c) => s + c.amount, 0);
const action = (wh: WorkingHousehold, key: string) => {
  const st = buildStage("savings", wh);
  const a = st.sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)]).find((x) => x.key === key);
  if (a === undefined) throw new Error(`操作が無い: ${key}`);
  return a;
};

describe("取り崩す順番（口座ごと・取り崩さない）", () => {
  it("順番を入れていなければ標準の順番（決済口座の後に課税口座→NISA。iDeCo・企業型DC は並べない）", () => {
    const v = withdrawViewOf(open().request);
    expect(v.standard).toBe(true);
    expect(v.settlement?.kind).toBe("deposit");
    expect(v.included.map((a) => a.kind)).toEqual(["taxable", "nisa"]);
    expect(v.excluded).toEqual([]);
  });

  it("口座を動かすと物の ID の順番になり、その後に取り崩さない口座の無い器の種類を標準の順で足す。標準と同じ並びに戻すと順番を消す", () => {
    const wh = open();
    const nisa = acc(wh, "nisa").id;
    const tax = acc(wh, "taxable").id;
    const w1 = mutate(wh, (_h, r) => setWithdrawOrder(r, [nisa, tax]));
    const order = w1.request.input.assumptions?.withdrawal?.order;
    expect(order?.slice(0, 2)).toEqual([{ object: nisa }, { object: tax }]);
    expect(order?.slice(2)).toEqual(STANDARD_ORDER_KINDS.map((kind) => ({ kind })));
    expect(withdrawViewOf(w1.request).included.map((a) => a.id)).toEqual([nisa, tax]);
    expect(withdrawViewOf(w1.request).byAccount).toBe(true);
    const w2 = mutate(w1, (_h, r) => setWithdrawOrder(r, [tax, nisa]));
    expect(w2.request.input.assumptions?.withdrawal).toBeUndefined();
  });

  it("「取り崩さない」にした口座の種類は後ろの器の種類に入れない（エンジンも取り崩さない）。標準の順番に戻せる", () => {
    const wh = open();
    const tax = acc(wh, "taxable").id;
    const w1 = mutate(wh, (_h, r) => setWithdrawOrder(r, [tax]));
    const v = withdrawViewOf(w1.request);
    expect(v.excluded.map((a) => a.kind)).toEqual(["nisa"]);
    expect(w1.request.input.assumptions?.withdrawal?.order?.some((o) => "kind" in o && o.kind === "nisa")).toBe(false);
    const w2 = mutate(w1, (_h, r) => resetWithdrawOrder(r));
    expect(withdrawViewOf(w2.request).standard).toBe(true);
  });

  it("取り崩しで足りない年に、取り崩さない NISA は残高が残り、足りない分は資金不足になる（エンジンの読み方のまま）", () => {
    const wh = mutate(open(), (h, r) => {
      // 取り崩しが起きるように、毎月の取り崩しを大きくする
      r.input.assumptions!.investment = { ...(r.input.assumptions?.investment ?? {}), drawdown: { start: { at: "2027-01" }, method: "fixed", monthly: 400000 } };
      void h;
    });
    const tax = acc(wh, "taxable").id;
    const keep = mutate(wh, (_h, r) => setWithdrawOrder(r, [tax]));
    const a = preview(wh.request);
    const b = preview(keep.request);
    expect(balance(b, "nisa", 2040)).toBeGreaterThan(balance(a, "nisa", 2040));
  });

  it("決済口座は預金から選ぶ（最初の預金を選ぶと印を外す）", () => {
    const req = structuredClone(open().request);
    const h = req.input.household;
    const second: Account = { id: "5d1c7a20-4f3e-4b8a-9c11-0a7e3b2c4d99", kind: "deposit", owner: h.members[0]!.id, marketValue: { value: 1000000, state: "confirmed", origin: { kind: "manual" } }, asOf: req.input.baseMonth, contributions: [] };
    h.accounts!.push(second);
    setSettlement(h, second.id);
    expect(settlementOf(h)?.id).toBe(second.id);
    expect(withdrawViewOf(req).included.map((a) => a.kind)).toEqual(["deposit", "taxable", "nisa"]);
    const first = acc({ request: req } as WorkingHousehold, "deposit").id;
    setSettlement(h, first);
    expect(settlementOf(h)?.id).toBe(first);
    expect(h.accounts!.filter((a) => a.settlement === true).map((a) => a.id)).toEqual([first]);
  });

  it("口座の呼び名は種類と名義（括弧の説明は外す）", () => {
    const wh = open();
    expect(accountName(acc(wh, "taxable"), "ご本人")).toBe("課税口座（ご本人）");
  });
});

describe("預金に残しておく額（1欄・詳細）と目安のボタン", () => {
  it("欄は省略で0円。打つと assumptions.withdrawal.minimumDeposit に入り、0円で消える。同じ値なら世帯を変えない", () => {
    const wh = open();
    const f = fieldOf(wh, "sav/withdraw/min");
    expect(f.level).toBe("detail");
    expect(f.get(wh).value).toBe(0);
    expect(f.set(wh, 0)).toBe(wh);
    const w1 = f.set(wh, 2_000_000);
    expect(w1.request.input.assumptions?.withdrawal?.minimumDeposit).toBe(2_000_000);
    expect(fieldStatus(f, w1).status).toBe("confirmed");
    const w2 = fieldOf(w1, "sav/withdraw/min").set(w1, 0);
    expect(w2.request.input.assumptions?.withdrawal).toBeUndefined();
  });

  it("目安のボタンは押した時の基本生活費の6か月分・1年分を、根拠つきの推定で入れる。生活費を後で変えても追いかけない", () => {
    const wh = open();
    const living = livingMonthlyOf(wh.request.input.household) as number;
    expect(reservePreset(wh.request.input.household, 6)?.value).toBe(living * 6);
    const w1 = action(wh, "sav/withdraw/min/preset6").run(wh);
    expect(w1.request.input.assumptions?.withdrawal?.minimumDeposit).toBe(living * 6);
    const f = fieldOf(w1, "sav/withdraw/min");
    const st = fieldStatus(f, w1);
    expect(st.status).toBe("estimated");
    expect(st.basis).toContain("6か月分");
    // 生活費を変えても額は変わらない
    const w2 = mutate(w1, (h) => {
      const l = h.livingExpenses![0]!;
      l.monthly = { value: 500000, state: "confirmed", origin: { kind: "manual" } };
    });
    expect(w2.request.input.assumptions?.withdrawal?.minimumDeposit).toBe(living * 6);
    // この値にする: 値のまま、根拠を残した確定
    const w3 = applyStateOp(w1, f, "confirm");
    expect(w3.request.input.assumptions?.withdrawal?.minimumDeposit).toBe(living * 6);
    expect(fieldStatus(f, w3)).toMatchObject({ status: "confirmed", explicit: true });
    // 打つと推定の行は外れる
    const w4 = fieldOf(w1, "sav/withdraw/min").set(w1, 1_000_000);
    expect(fieldStatus(fieldOf(w4, "sav/withdraw/min"), w4).status).toBe("confirmed");
    expect(JSON.stringify(w4.request.input)).not.toContain("6か月分");
  });

  it("残しておく額を入れると、決済口座の年末の残高がその額を下回らないようにほかの口座から取り崩す", () => {
    const base = open();
    const a = preview(base.request);
    const y = 2028;
    const min = Math.round(balance(a, "deposit", y) + 300_000);
    const b = preview(fieldOf(base, "sav/withdraw/min").set(base, min).request);
    expect(balance(b, "deposit", y)).toBeGreaterThanOrEqual(min - 1);
    expect(balance(b, "taxable", y)).toBeLessThan(balance(a, "taxable", y));
  });

  it("合計の入れ方では、お金の行き先の区画は出さない（効かないため）", () => {
    const t = switchMethod(open(), "total");
    expect(buildStage("savings", t).sections.some((s) => s.key === "sav/flow")).toBe(false);
  });
});

describe("足した口座・入れていない合計は「未入力（0円で計算中）」", () => {
  it("＋で足した口座の残高は未入力の印。打つと確定になる", () => {
    const wh = open();
    const w1 = action(wh, "sav/add/fxDeposit").run(wh);
    const fx = acc(w1, "fxDeposit");
    expect(fx.marketValue).toMatchObject({ value: 0, state: "estimated", estimate: { basis: UNENTERED_BALANCE } });
    const f = fieldOf(w1, `sav/${fx.id}/value`);
    expect(fieldStatus(f, w1).status).toBe("missing");
    const w2 = f.set(w1, 500000);
    expect(fieldStatus(fieldOf(w2, `sav/${fx.id}/value`), w2).status).toBe("confirmed");
  });

  it("こどもNISA・ジュニアNISA は子の名義で作る", () => {
    const wh = fromRequest(modelHousehold("educationTwoKids"));
    const child = wh.request.input.household.members.find((m) => m.kind === "child");
    const w1 = action(wh, "sav/add/childNisa").run(wh);
    expect(acc(w1, "childNisa").owner).toBe(child?.id);
  });

  it("口座の無い世帯を合計の入れ方にすると、金融資産の合計は未入力の印で始まる", () => {
    const wh = mutate(open(), (h) => void (h.accounts = []));
    const t = switchMethod(wh, "total");
    const p = (t.request.input.household.accounts ?? []).find((a) => a.kind === "pooled");
    expect(p?.marketValue).toMatchObject({ value: 0, state: "estimated" });
    const v = editTotal(t, { value: 8_000_000 });
    expect((v.request.input.household.accounts ?? []).find((a) => a.kind === "pooled")?.marketValue).toMatchObject({ value: 8_000_000, state: "confirmed" });
  });
});

describe("口座ごとの詳細の欄", () => {
  it("運用の費用は口座の入れ方の運用する口座だけ（資産配分の入れ方は配分の信託報酬）。入れると器の fee", () => {
    const wh = open();
    const nisa = acc(wh, "nisa");
    const f = fieldOf(wh, `sav/${nisa.id}/fee`);
    const w1 = f.set(wh, "0.002");
    expect(acc(w1, "nisa").fee).toBe("0.002");
    expect(fieldsOf(switchMethod(wh, "allocation")).has(`sav/${nisa.id}/fee`)).toBe(false);
    expect(fieldsOf(wh).has(`sav/${acc(wh, "deposit").id}/fee`)).toBe(false);
  });

  it("引き出せない期間の終わりは時点で入れ、iDeCo・企業型DC には出さない", () => {
    const wh = open();
    const tax = acc(wh, "taxable");
    const f = fieldOf(wh, `sav/${tax.id}/lock`);
    const w1 = f.set(wh, "2030-03");
    expect(acc(w1, "taxable").withdrawalLockedUntil).toEqual({ at: "2030-03" });
    expect(fieldsOf(wh).has(`sav/${acc(wh, "ideco").id}/lock`)).toBe(false);
  });

  it("受け取り方を年金・併用にすると、年数と一時金の割合の欄が出る（空欄は10年・半分）", () => {
    const wh = open();
    const ideco = acc(wh, "ideco");
    expect(fieldsOf(wh).has(`sav/${ideco.id}/payoutYears`)).toBe(false);
    const w1 = fieldOf(wh, `sav/${ideco.id}/payout`).set(wh, "mixed");
    const years = fieldOf(w1, `sav/${ideco.id}/payoutYears`);
    const share = fieldOf(w1, `sav/${ideco.id}/lumpShare`);
    expect(years.get(w1).value).toBe(10);
    expect(share.get(w1).value).toBe("0.5");
    const w2 = share.set(years.set(w1, 15), "0.3");
    expect(acc(w2, "ideco").payout).toMatchObject({ method: "mixed", annuityYears: 15, lumpShare: "0.3" });
    // 併用のまま年金に変えても、年数は残る
    const w3 = fieldOf(w2, `sav/${ideco.id}/payout`).set(w2, "annuity");
    expect(acc(w3, "ideco").payout).toMatchObject({ method: "annuity", annuityYears: 15 });
    expect(acc(w3, "ideco").payout?.lumpShare).toBeUndefined();
    preview(w3.request);
  });

  it("加入者期間の始まり（年月）を入れられる", () => {
    const wh = open();
    const ideco = acc(wh, "ideco");
    const w1 = fieldOf(wh, `sav/${ideco.id}/enrolled`).set(wh, "2016-04");
    expect(acc(w1, "ideco").enrolledSince).toBe("2016-04");
  });

  it("旧NISA は買付の年ごとの内訳を足して直せる", () => {
    let wh = action(open(), "sav/add/legacyNisa").run(open());
    const legacy = acc(wh, "legacyNisa");
    wh = action(wh, `sav/${legacy.id}/addLotRow`).run(wh);
    expect(acc(wh, "legacyNisa").lots).toEqual([{ vintageYear: 2023, regime: "general", costBasis: 0, marketValue: 0 }]);
    wh = fieldOf(wh, `sav/${legacy.id}/lot/0/value`).set(wh, 1_200_000);
    wh = fieldOf(wh, `sav/${legacy.id}/lot/0/cost`).set(wh, 1_000_000);
    wh = fieldOf(wh, `sav/${legacy.id}/value`).set(wh, 1_200_000);
    expect((acc(wh, "legacyNisa").lots as unknown[] | undefined)?.[0]).toMatchObject({ marketValue: 1_200_000, costBasis: 1_000_000 });
    preview(wh.request);
    wh = action(wh, `sav/${legacy.id}/lot/0/remove`).run(wh);
    expect(acc(wh, "legacyNisa").lots).toBeUndefined();
  });

  it("小規模企業共済は受け取り方と受け取りの始まり（空欄は受け取らない）・分割の年数（10年か15年）", () => {
    let wh = action(open(), "sav/add/smallBusinessMutualAid").run(open());
    const aid = acc(wh, "smallBusinessMutualAid");
    expect(fieldsOf(wh).has(`sav/${aid.id}/payoutAt`)).toBe(false);
    wh = fieldOf(wh, `sav/${aid.id}/value`).set(wh, 3_000_000);
    wh = fieldOf(wh, `sav/${aid.id}/payout`).set(wh, "annuity");
    wh = fieldOf(wh, `sav/${aid.id}/payoutAt`).set(wh, "2040-04");
    wh = fieldOf(wh, `sav/${aid.id}/payoutYears`).set(wh, "15");
    expect(acc(wh, "smallBusinessMutualAid").payout).toMatchObject({ method: "annuity", start: { at: "2040-04" }, annuityYears: 15 });
    expect(withdrawViewOf(wh.request).included.some((a) => a.kind === "smallBusinessMutualAid")).toBe(false);
    preview(wh.request);
  });
});

describe("貸していない不動産（評価額だけ。貸している物件は収益不動産へ。0079）", () => {
  it("「＋ 貸していない不動産」は中身の無い不動産の器を作り、貯蓄・運用のその他の資産に出る。「収益不動産へ移す」で中身を持たせると、収益不動産の項目に移る", () => {
    let wh = action(open(), "sav/add/realEstate").run(open());
    const re = acc(wh, "realEstate");
    expect(re.property).toBeUndefined();
    expect(fieldsOf(wh).has(`sav/${re.id}/split`)).toBe(false);
    expect(fieldsOf(wh).has(`sav/${re.id}/property/structure`)).toBe(false);
    const sec = buildStage("savings", wh).sections.find((s) => s.key === "sav/others")!;
    expect(sec.title).toBe("その他の資産");
    expect(sec.groups.find((g) => g.key === `sav/${re.id}`)?.note).toContain("収益不動産");
    wh = fieldOf(wh, `sav/${re.id}/value`).set(wh, 20_000_000);
    wh = action(wh, `sav/${re.id}/toRental`).run(wh);
    expect(acc(wh, "realEstate").property?.rental?.monthly).toMatchObject({ value: 0, state: "estimated" });
    expect(acc(wh, "realEstate").marketValue?.value).toBe(20_000_000);
    expect(fieldsOf(wh).has(`sav/${re.id}/value`)).toBe(false);
    expect(allFields(buildStage("rental", wh)).some((f) => f.key === `sav/${re.id}/value`)).toBe(true);
  });

  it("不動産の一時の経費（出るお金の行）は収益不動産の項目の区画（貯蓄・運用には出さない）", () => {
    expect(buildStage("savings", open()).sections.some((s) => s.key.startsWith("money/"))).toBe(false);
    const sec = buildStage("rental", open()).sections.find((s) => s.key === "money/rental/out");
    expect(sec?.actions.map((a) => a.key)).toEqual(["money/rental/out/add/realEstateCost"]);
    expect(sec?.title).toBe("不動産の一時の経費（出るお金）");
  });
});

describe("合計の入れ方の平均の利回り（名前の付いた選び方を置かない。0050 の 2026-10-31 の追記）", () => {
  const total = () => {
    const t = switchMethod(open(), "total");
    return { t, p: (t.request.input.household.accounts ?? []).find((a) => a.kind === "pooled") as Account };
  };
  const html = (wh: WorkingHousehold, level: "simple" | "detail") => renderToString(h(SavingsPanel, { wh, level, onEdit: () => undefined }));

  it("標準でも詳細でも、平均の利回りの欄をそのまま出す。選び方のボタンは出さない", () => {
    const { t } = total();
    for (const level of ["simple", "detail"] as const) {
      const out = html(t, level);
      expect(out).toContain('data-sv="total-rate"');
      expect(out).not.toContain("data-rate-preset");
      expect(out).not.toContain("利回りの選び方");
      expect(out).not.toMatch(/控えめ（|積極的|ふつう（/);
      expect(out).toContain("-10%〜15%の範囲で入れます");
    }
  });

  it("入れた率がそのまま平均の利回りに入る", () => {
    const { t, p } = total();
    const w = fieldOf(t, `sav/${p.id}/rate`).set(t, "0.03");
    expect((w.request.input.household.accounts ?? []).find((a) => a.kind === "pooled")?.expectedReturn).toBe("0.03");
  });

  it("空欄にすると前提条件の運用利回りで計算し、その率を欄の薄い字と説明に出す（2% と決めて見せない）", () => {
    const { t, p } = total();
    let w = fieldOf(t, `sav/${p.id}/rate`).set(t, null);
    w = mutate(w, (_h, req) => void (req.input.assumptions = { ...req.input.assumptions, investmentReturn: { default: "0.035" } }));
    expect((w.request.input.household.accounts ?? []).find((a) => a.kind === "pooled")?.expectedReturn).toBeUndefined();
    expect(totalViewOf(w.request).rate).toBe("0.035");
    const out = html(w, "simple");
    expect(out).toContain('placeholder="3.5"');
    expect(out).toContain("入れていないので、前提条件の運用利回り（年3.5%）で計算しています。");
  });
});

describe("貯蓄・運用の利回りの欄の範囲（-10%〜15%。0098）", () => {
  const html = (wh: WorkingHousehold) => renderToString(h(SavingsPanel, { wh, level: "simple", onEdit: () => undefined }));

  it("口座の表の利回り・合計の入れ方の平均の利回りの欄: 範囲の外の値は書かず、越えた側の端を出す（範囲の端は入る）", () => {
    expect(readPct("16", RETURN_RANGE)).toEqual({ rate: undefined, problem: "15%より大きい値は設定できません。" });
    expect(readPct("-11", RETURN_RANGE)).toEqual({ rate: undefined, problem: "-10%より小さい値は設定できません。" });
    expect(readPct("15", RETURN_RANGE)).toEqual({ rate: "0.15", problem: null });
    expect(readPct("-10", RETURN_RANGE)).toEqual({ rate: "-0.1", problem: null });
    expect(readPct("abc", RETURN_RANGE)).toEqual({ rate: undefined, problem: null });
    // 範囲を渡さない欄（取り崩し率など）は今までどおり
    expect(readPct("40")).toEqual({ rate: "0.4", problem: null });
    // 口座の利回りの欄の定義も同じ範囲
    const nisa = acc(open(), "nisa");
    const f = fieldOf(open(), `sav/${nisa.id}/rate`);
    expect(f.kind === "pct" ? [f.min, f.max] : null).toEqual([-10, 15]);
  });

  it("古い世帯の口座に範囲の外の利回り（25%）: 値は変えずに計算し、表の欄の下と確かめの一覧に知らせ、押したときだけ 15% にする", () => {
    const wh = mutate(open(), (h) => void ((h.accounts ?? []).find((a) => a.kind === "nisa")!.expectedReturn = "0.25"));
    const nisa = acc(wh, "nisa");
    expect(nisa.expectedReturn).toBe("0.25");
    const out = html(wh);
    expect(out).toContain(`data-field-warn="sav/${nisa.id}/rate"`);
    expect(out).toContain("範囲（-10%〜15%）の外の値（25%）が入っています");
    const row = checkList(wh).find((r) => r.id === `field:sav/${nisa.id}/rate`);
    expect(row?.actions.map((x) => x.label)).toEqual(["15%にする"]);
    const fixed = row!.actions[0]!.run(wh);
    expect(acc(fixed, "nisa").expectedReturn).toBe("0.15");
    expect(html(fixed)).not.toContain(`data-field-warn="sav/${nisa.id}/rate"`);
  });

  it("古い世帯の合計の入れ方に範囲の外の平均の利回り（-20%）: 値は変えずに知らせ、確かめの一覧で -10% にできる", () => {
    const t = switchMethod(open(), "total");
    const wh = mutate(t, (h) => void ((h.accounts ?? []).find((a) => a.kind === "pooled")!.expectedReturn = "-0.2"));
    const p = acc(wh, "pooled");
    expect(html(wh)).toContain("範囲（-10%〜15%）の外の値（-20%）が入っています");
    const row = checkList(wh).find((r) => r.id === `field:sav/${p.id}/rate`);
    expect(row?.actions.map((x) => x.label)).toEqual(["-10%にする"]);
    expect(acc(row!.actions[0]!.run(wh), "pooled").expectedReturn).toBe("-0.1");
  });
});

describe("専用の部品の欄の値の状態（0041）", () => {
  it("口座の残高は推定を持たないので「わからない」「該当なし」を出さない（0041 の 2026-10-29 の追記）。前に入れた「わからない」は読めて、計算でき、「この値にする」で戻せる", () => {
    const wh = open();
    const nisa = acc(wh, "nisa");
    const f = fieldOf(wh, `sav/${nisa.id}/value`);
    expect(availableOps(f, wh)).toEqual([]);
    expect(applyStateOp(wh, f, "unknown")).toBe(wh);
    const w1 = f.boxed!.write(wh, { state: "unknown", origin: { kind: "manual" }, substitute: { value: 2_000_000, state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis: "前に入っていた値を代わりに使う" } } });
    expect(fieldStatus(f, w1).status).toBe("unknown");
    expect(availableOps(f, w1)).toEqual(["confirm"]);
    preview(w1.request);
    expect(fieldStatus(f, applyStateOp(w1, f, "confirm")).status).toBe("confirmed");
  });

  it("欄の書き方は同じ値なら世帯を変えない（入って離れるだけで確定にしない）", () => {
    let wh = action(open(), "sav/add/deposit").run(open());
    const dep = (wh.request.input.household.accounts ?? []).at(-1) as Account;
    const f = fieldOf(wh, `sav/${dep.id}/value`);
    // 同じ値の書き戻しでは確定にしない。口座の表の数の欄は、0を打ったときは write で書く（打った操作なので確定）
    expect(f.set(wh, 0)).toBe(wh);
    expect(fieldStatus(f, f.write!(wh, 0)).status).toBe("confirmed");
    wh = f.set(wh, 300000);
    expect(fieldOf(wh, `sav/${dep.id}/value`).set(wh, 300000)).toBe(wh);
  });
});

describe("プランで直す（0043）", () => {
  const plan = (id: string): Proposal => ({ id, name: `プラン${id}`, createdAt: "2026-10-26T00:00:00Z", updatedAt: "2026-10-26T00:00:00Z", base: null, tags: [], diffs: [] });
  it("取り崩す順番・残しておく額をプランで直すと、そのプランの差分になり現状は変わらない", () => {
    const req = modelHousehold("investmentCouple");
    const self = roles(req).find((r) => r.key === "self")!.member;
    const wh = { ...fromRequest(req, {}), proposals: [plan("B")] };
    const cat = buildCatalog(wh, self.id, null);
    const view = planView(wh, cat, "B");
    const tax = acc(view, "taxable").id;
    const edited = fieldOf(view, "sav/withdraw/min").set(
      mutate(view, (_h, r) => setWithdrawOrder(r, [tax])),
      1_500_000,
    );
    const w = recordPlanEdit(wh, cat, "B", view, edited);
    expect(w.request.input.assumptions?.withdrawal).toBeUndefined();
    const v2 = planView(w, cat, "B");
    expect(v2.request.input.assumptions?.withdrawal?.minimumDeposit).toBe(1_500_000);
    expect(withdrawViewOf(v2.request as EngineRequest).excluded.map((a) => a.kind)).toEqual(["nisa"]);
    expect(w.proposals[0]?.diffs.length).toBeGreaterThan(0);
  });
});
