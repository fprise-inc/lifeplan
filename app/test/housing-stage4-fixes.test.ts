// 段4の確かめで見つかった住まい・ローンの直し（0136・0144 の追記 2026-11-07）のテスト:
// - 時点の欄の2つの書き方（欄の set と、画面の時点の部品が使う time.setWhen）が同じ世帯になる（全部の入力項目・見本の棚の世帯と住まいの組み立て）
// - 購入の時期を画面の書き方で直しても、前の賃貸の住み終わり・購入した家の住み始め・住宅ローンの借入の年月と控除の入居がついてくる
// - 今の残高から入れた住宅ローンで借りた年月を入れても、入れた毎月の返済額・完済の年月を変えない
// - 借りた年月が仮の間の控除0円の知らせ・完済の年月が推定のときの逆算の金利・住み替えの「住み終わりの後」の仮の印と初めの値の切り替え
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Debt, Residence } from "../src/engine/types.ts";
import { allFields, type FieldDef, type StageId } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { withProvisionalHousing } from "../src/workspace/input/housingCredit.ts";
import { dropStaleRows } from "../src/workspace/input/rows.ts";
import { applyMoveOutAfter, moveOutAfterMark, MOVE_OUT_AFTER } from "../src/workspace/input/housingFollow.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { PAYOFF_FOR_RATE, START_UNENTERED_CREDIT } from "../src/workspace/input/stages/housingLoans.ts";
import { SALE_NO_VALUE } from "../src/workspace/input/stages/housing.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { addMonths } from "../src/workspace/levers.ts";
import { modelHousehold, preview } from "./helpers.ts";

const BASE = "2026-10";
const settle = (wh: WorkingHousehold) => withProvisionalHousing(withRefreshedEstimates(wh));
const stage = (wh: WorkingHousehold, card: StageId = "housing") => buildStage(card, wh);
const actions = (wh: WorkingHousehold, card: StageId = "housing") => stage(wh, card).sections.flatMap((x) => [...x.actions, ...x.groups.flatMap((g) => g.actions)]);
function action(wh: WorkingHousehold, key: string, card: StageId = "housing"): WorkingHousehold {
  const a = actions(wh, card).find((x) => x.key === key || x.key.endsWith(key));
  if (a === undefined) throw new Error(`no action ${key}`);
  return settle(a.run(wh));
}
function fieldOf(wh: WorkingHousehold, suffix: string, card: StageId = "housing"): FieldDef {
  const f = allFields(stage(wh, card)).find((x) => x.key.endsWith(suffix));
  if (f === undefined) throw new Error(`no field ${suffix}`);
  return f;
}
const set = (wh: WorkingHousehold, suffix: string, v: Parameters<FieldDef["set"]>[1]): WorkingHousehold => settle(fieldOf(wh, suffix).set(wh, v));
/** 入力のパネルが書いた世帯を受け取るときの始末（InputPanel.tsx の edit: 値が変わった所の行を外し、推定を入れ直す） */
const panel = (before: WorkingHousehold, next: WorkingHousehold) => (next === before ? next : withProvisionalHousing(withRefreshedEstimates(dropStaleRows(before, next))));
/** 画面の時点の部品と同じ書き方（time.setWhen。欄を離れたときに決めた時点を書く）と、パネルの始末 */
function typeWhen(wh: WorkingHousehold, suffix: string, ym: string): WorkingHousehold {
  const f = fieldOf(wh, suffix);
  if (f.time === undefined) throw new Error(`not a when field ${suffix}`);
  return panel(wh, f.time.setWhen(wh, { at: ym }, "auto"));
}
function salaried(): WorkingHousehold {
  let wh = blankHousehold(BASE);
  const start = buildStage("work", wh).sections[0]!.groups[0]!.actions.find((a) => a.key.endsWith("/start"))!;
  wh = start.run(wh);
  const annual = allFields(buildStage("work", wh)).find((f) => f.key.endsWith("/annual"))!;
  return annual.set(wh, 6000000);
}
const couple = () => {
  const wh = salaried();
  return actions(wh, "family").find((a) => a.key === "family/add/spouse")!.run(wh);
};
const hh = (wh: WorkingHousehold) => wh.request.input.household;
const residences = (wh: WorkingHousehold): Residence[] => hh(wh).residences ?? [];
const bought = (wh: WorkingHousehold): Residence => residences(wh).find((r) => r.purchase !== undefined)!;
const loans = (wh: WorkingHousehold): Debt[] => (hh(wh).debts ?? []).filter((d) => d.kind === "mortgage");
const eventAt = (wh: WorkingHousehold, id: string | undefined) => hh(wh).events?.find((e) => e.id === id)?.at.at;
const notes = (wh: WorkingHousehold) => stage(wh).sections.flatMap((s) => [s.note ?? "", ...s.groups.map((g) => g.note ?? "")]).join("\n");

/** 賃貸から購入（ペアローン）。購入の時期は足したときの既定 */
const buying = () => {
  const wh = action(action(action(couple(), "housing/addRent"), "housing/addPurchase"), "housing/addMortgage");
  return action(wh, `housing/debt/${loans(wh)[0]!.id}/addPair`);
};
/** 今の持ち家と、今の残高から入れた住宅ローン（残高 2,800万円・毎月 90,000円・完済 2058年3月） */
const balanceLoan = () => {
  let wh = action(action(salaried(), "housing/addOwn"), "housing/addMortgage");
  const d = loans(wh)[0]!;
  wh = set(wh, `${d.id}/balance`, 28_000_000);
  wh = set(wh, `${d.id}/payment`, 90_000);
  return set(wh, `${d.id}/payoff`, "2058-03");
};

describe("時点の欄は、欄の set と画面の書き方（time.setWhen）で同じ世帯になる", () => {
  const STAGES: StageId[] = ["family", "work", "retirement", "pension", "living", "education", "housing", "insurance", "savings", "rental", "events", "car", "care", "inheritance", "fee", "assumptions"];
  // 足すたびに作る ID は、出てきた順の番号に置き換えて比較する
  const norm = (wh: WorkingHousehold): string => {
    const seen = new Map<string, number>();
    return JSON.stringify([wh.request.input.household, wh.assumed]).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (u) => `#${seen.get(u) ?? (seen.set(u, seen.size), seen.size - 1)}`);
  };
  const samples = (): [string, WorkingHousehold][] => {
    const files = readdirSync(new URL("../../data/modelHouseholds", import.meta.url)).filter((f) => f.endsWith(".json"));
    const models = files.map((f): [string, WorkingHousehold] => [f, settle(fromRequest(modelHousehold(f.replace(/\.json$/, ""))))]);
    const moveOut = action(fromRequest(modelHousehold("dualAssetsTwoKids")), "housing/addPurchase");
    let vacant = settle(fromRequest(modelHousehold("salariedCoupleTwoKids")));
    vacant = set(vacant, `housing/res/${residences(vacant)[0]!.id}/to`, "2050-03");
    vacant = action(vacant, `housing/res/${residences(vacant)[0]!.id}/keepVacant`);
    return [...models, ["賃貸から購入（ペアローン）", buying()], ["今の残高から入れた住宅ローン", balanceLoan()], ["住み替え", moveOut], ["空き家として持ち続ける", vacant]];
  };

  it("全部の入力項目の時点の欄で、13か月ずらして書いた世帯が同じ（set だけ上書きして連動させると、画面のキー入力で連動が抜ける）", () => {
    const bad: string[] = [];
    for (const [name, wh] of samples())
      for (const s of STAGES)
        for (const f of allFields(buildStage(s, wh))) {
          if (f.kind !== "when" || f.time === undefined || f.readOnly !== undefined) continue;
          const cur = f.get(wh).value;
          const tp = { at: addMonths(typeof cur === "string" ? cur : wh.request.input.baseMonth, 13) };
          if (f.time.when.check?.(wh, tp) != null) continue;
          if (norm(panel(wh, f.set(wh, tp))) !== norm(panel(wh, f.time.setWhen(wh, tp, "auto")))) bad.push(`${name}: ${f.key}`);
        }
    expect(bad).toEqual([]);
  });
});

describe("購入の時期を画面の書き方で直すと、ほかの日付がついてくる（G3-001）", () => {
  it("住宅ローンを足した後に直しても、前の賃貸の住み終わり・購入した家の住み始め・2本のローンの借入の年月と金利の段・控除の入居が動く", () => {
    const wh = typeWhen(buying(), "/purchase/at", "2031-10");
    expect(bought(wh).from).toEqual({ at: "2031-10" });
    expect(residences(wh).find((r) => r.kind === "rent")!.to).toEqual({ at: "2031-09" });
    for (const d of loans(wh)) {
      expect(d.start).toEqual({ at: "2031-10" });
      expect(d.rateSchedule[0]!.from).toEqual({ at: "2031-10" });
      expect(eventAt(wh, d.housing?.moveIn)).toBe("2031-10");
    }
    // 買う前の年に住宅ローンの返済が無い
    expect(preview(wh.request).table.filter((c) => c.year === 2030 && c.row === "cf.expense.housing.loan").reduce((s, c) => s + c.amount, 0)).toBe(0);
  });

  it("住宅ローンを足す前に直しても、前の賃貸の住み終わりがついてくる", () => {
    const wh = typeWhen(action(action(couple(), "housing/addRent"), "housing/addPurchase"), "/purchase/at", "2030-04");
    expect(residences(wh).find((r) => r.kind === "rent")!.to).toEqual({ at: "2030-03" });
  });

  it("住み替えで住み終わりにした今の持ち家の住み終わりを画面の書き方で直すと、「住み替え」の仮の印が外れる", () => {
    let wh = action(fromRequest(modelHousehold("dualAssetsTwoKids")), "housing/addPurchase");
    const own = residences(wh).find((r) => r.kind === "own" && r.purchase === undefined)!;
    expect(fieldStatus(fieldOf(wh, `housing/res/${own.id}/to`), wh).basis).toContain("住み替え");
    wh = typeWhen(wh, `housing/res/${own.id}/to`, "2028-03");
    expect(fieldStatus(fieldOf(wh, `housing/res/${own.id}/to`), wh).status).toBe("confirmed");
  });

  it("借り換えの年月を画面の書き方で直すと、新しいローンの金利の始まりもついてくる", () => {
    let wh = settle(fromRequest(modelHousehold("pairLoan")));
    const d = loans(wh).find((x) => (x.refinance ?? []).length > 0)!;
    wh = typeWhen(wh, `housing/debt/${d.id}/refinance/0/at`, "2036-04");
    const r = loans(wh).find((x) => x.id === d.id)!.refinance![0]!;
    expect(r.at).toEqual({ at: "2036-04" });
    expect(r.rateSchedule[0]!.from).toEqual({ at: "2036-04" });
  });
});

describe("今の残高から入れた住宅ローンの借りた年月（S4-001・S4-003）", () => {
  it("画面の書き方で借りた年月を入れても、入れた毎月の返済額と完済の年月は変わらない。持ち家の住み始め・控除の入居は借りた年月", () => {
    const wh0 = balanceLoan();
    const d = loans(wh0)[0]!;
    expect(fieldOf(wh0, `${d.id}/payment`).get(wh0).value).toBe(90_000);
    const wh = typeWhen(wh0, `${d.id}/start`, "2023-04");
    expect(loans(wh)[0]!.start).toEqual({ at: "2023-04" });
    expect(fieldOf(wh, `${d.id}/payment`).get(wh).value).toBe(90_000);
    expect(fieldOf(wh, `${d.id}/payoff`).get(wh).value).toBe("2058-03");
    expect(residences(wh).find((r) => r.kind === "own")!.from).toEqual({ at: "2023-04" });
    expect(eventAt(wh, loans(wh)[0]!.housing?.moveIn)).toBe("2023-04");
    // 金利は前の逆算のまま（返済額と完済の年月を保つ）
    expect(loans(wh)[0]!.rateSchedule[0]!.rate).toBe(loans(wh0)[0]!.rateSchedule[0]!.rate);
  });

  it("借りた年月が仮の間は、借りた年月の欄の下に控除を0円で計算していると出し、入れたら消える", () => {
    const wh0 = balanceLoan();
    const d = loans(wh0)[0]!;
    expect(fieldOf(wh0, `${d.id}/start`).get(wh0).warn).toBe(START_UNENTERED_CREDIT);
    const wh = typeWhen(wh0, `${d.id}/start`, "2023-04");
    expect(fieldOf(wh, `${d.id}/start`).get(wh).warn ?? null).toBeNull();
  });
});

describe("完済の年月が推定のときの逆算の金利（S4-015）", () => {
  it("今の残高と毎月の返済額だけなら、推定の完済から逆算した金利を出さず、完済の年月を入れるように書く。入れたら逆算の金利", () => {
    let wh = action(action(salaried(), "housing/addOwn"), "housing/addMortgage");
    const d = loans(wh)[0]!;
    wh = set(wh, `${d.id}/balance`, 20_000_000);
    wh = set(wh, `${d.id}/payment`, 100_000);
    expect(String(fieldOf(wh, `${d.id}/payoff`).get(wh).hint)).toContain(PAYOFF_FOR_RATE);
    expect(String(fieldOf(wh, `${d.id}/payoff`).get(wh).hint)).not.toContain("（逆算）");
    wh = set(wh, `${d.id}/payoff`, "2050-03");
    expect(String(fieldOf(wh, `${d.id}/payoff`).get(wh).hint)).toMatch(/＝金利 年[\d.]+%（逆算）/);
  });
});

describe("住み替えの「住み終わりの後」（S4-005: 利用者の判断で初めの値は「住み終わりの月に売る」）", () => {
  it("住宅購入の予定を足すと、今の持ち家を住み終わりの月に売るとみなし（売却価格は空欄＝評価額）、仮の印と区画の文を「売る」の向きで出す", () => {
    const wh = action(fromRequest(modelHousehold("dualAssetsTwoKids")), "housing/addPurchase");
    const own = residences(wh).find((r) => r.kind === "own" && r.purchase === undefined)!;
    expect(MOVE_OUT_AFTER).toBe("sell");
    expect(own.sale).toEqual({});
    const after = fieldOf(wh, `housing/res/${own.id}/after`);
    expect(after.get(wh).value).toBe("sell");
    expect(fieldStatus(after, wh)).toMatchObject({ status: "estimated", basis: moveOutAfterMark("sell") });
    expect(moveOutAfterMark("sell")).toContain("売るとみなしています");
    expect(moveOutAfterMark("sell")).toContain("空き家として持ち続ける");
    expect(notes(wh)).toContain("住み終わりの月");
    expect(notes(wh)).toContain("売るとみなしています");
    expect(notes(wh)).not.toContain("家の価値も売った代金も入りません");
    // 選び直すと仮の印が外れ、売らないときの文と「空き家として持ち続ける」になる
    const kept = set(wh, `housing/res/${own.id}/after`, "keep");
    expect(fieldStatus(fieldOf(kept, `housing/res/${own.id}/after`), kept).status).toBe("confirmed");
    expect(residences(kept).find((r) => r.id === own.id)!.sale).toBeUndefined();
    expect(notes(kept)).toContain("家の価値も売った代金も入りません");
  });

  it("評価額の入っていない家を売るとみなしたときは、売却価格の欄に0円で売ることになると知らせ、評価額か売却価格を入れると消える", () => {
    const wh = action(fromRequest(modelHousehold("pairLoan")), "housing/addPurchase");
    const own = residences(wh).find((r) => r.kind === "own" && r.purchase === undefined)!;
    expect(own.valuation?.value).toBeUndefined();
    expect(fieldOf(wh, `housing/res/${own.id}/sale/price`).get(wh).warn).toBe(SALE_NO_VALUE);
    const priced = set(wh, `housing/res/${own.id}/sale/price`, 45_000_000);
    expect(fieldOf(priced, `housing/res/${own.id}/sale/price`).get(priced).warn ?? null).toBeNull();
    const valued = set(wh, `housing/res/${own.id}/valuation/value`, 45_000_000);
    expect(fieldOf(valued, `housing/res/${own.id}/sale/price`).get(valued).warn ?? null).toBeNull();
    // 評価額の入っている家には出さない
    const w2 = action(fromRequest(modelHousehold("dualAssetsTwoKids")), "housing/addPurchase");
    const o2 = residences(w2).find((r) => r.kind === "own" && r.purchase === undefined)!;
    expect(fieldOf(w2, `housing/res/${o2.id}/sale/price`).get(w2).warn ?? null).toBeNull();
  });

  it("今ある世帯（足す前から住み終わりの決まった持ち家）は書き換えない", () => {
    const wh = fromRequest(modelHousehold("dualAssetsTwoKids"));
    const before = residences(wh).map((r) => structuredClone(r.sale));
    const after = action(wh, "housing/addPurchase");
    const ids = new Set(residences(wh).map((r) => r.id));
    // 足す前の住まいのうち、今回の住み替えで住み終わりにした物（住み終わりが空だった持ち家）だけが変わる
    residences(wh).forEach((r, i) => {
      const x = residences(after).find((y) => y.id === r.id)!;
      if (r.kind === "own" && r.to === null) expect(x.sale).toEqual({});
      else expect(x.sale).toEqual(before[i]);
    });
    expect(residences(after).filter((r) => !ids.has(r.id))).toHaveLength(1);
  });

  it("切り替えを「売る」にすると、住み終わりにした家を住み終わりの月に売る（売却価格は空欄＝評価額）", () => {
    const wh = fromRequest(modelHousehold("dualAssetsTwoKids"));
    const id = residences(wh).find((r) => r.kind === "own")!.id;
    let marks: Record<string, string> = {};
    const next = mutate(wh, (h) => void (marks = applyMoveOutAfter(h, [id], "sell")));
    expect(residences(next).find((r) => r.id === id)!.sale).toEqual({});
    expect(marks[`housing/res/${id}/after`]).toBe(moveOutAfterMark("sell"));
  });
});
