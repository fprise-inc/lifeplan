// ほかのローンの完済の年月の欄と、種類の選択肢（0052 の追記 2026-11-08）
// - 毎月の返済額が入っていない間の完済の年月は「仮に5年」の推定（「この値にする」で確定できる）。欄の下は根拠の1行（「今から5年後」だけの文にしない）
// - 毎月の返済額を残高より先に入れても、残高を入れたときに完済の年月を逆算する（前は返済額が断られ、5年のまま残った）
// - 「＋」のボタンはカードローン・リボ、奨学金の返済、リフォームローン、そのほかのローン（選んで足す）。種類の欄はボタンの組の中だけ
import { describe, expect, it } from "vitest";
import type { Debt } from "../src/engine/types.ts";
import { allFields, type ActionDef, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { withProvisionalHousing } from "../src/workspace/input/housingCredit.ts";
import { putRow } from "../src/workspace/input/rows.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { applyStateOp, availableOps, fieldStatus } from "../src/workspace/input/valueState.ts";

const BASE = "2026-10";
const stage = (wh: WorkingHousehold) => buildStage("housing", wh);
const actions = (wh: WorkingHousehold): ActionDef[] => stage(wh).sections.flatMap((x) => [...x.actions, ...x.groups.flatMap((g) => g.actions)]);
function action(wh: WorkingHousehold, key: string): WorkingHousehold {
  const a = actions(wh).find((x) => x.key === key);
  if (a === undefined) throw new Error(`no action ${key}`);
  return withProvisionalHousing(a.run(wh));
}
const findField = (wh: WorkingHousehold, suffix: string): FieldDef | undefined => allFields(stage(wh)).find((x) => x.key.endsWith(suffix));
function fieldOf(wh: WorkingHousehold, suffix: string): FieldDef {
  const f = findField(wh, suffix);
  if (f === undefined) throw new Error(`no field ${suffix}`);
  return f;
}
const set = (wh: WorkingHousehold, suffix: string, v: Parameters<FieldDef["set"]>[1]) => withProvisionalHousing(fieldOf(wh, suffix).set(wh, v));
const debt = (wh: WorkingHousehold): Debt => wh.request.input.household.debts!.at(-1)!;
const hint = (wh: WorkingHousehold, id: string): string => String(fieldOf(wh, `${id}/payoff`).get(wh).hint ?? "");
const status = (wh: WorkingHousehold, suffix: string) => fieldStatus(fieldOf(wh, suffix), wh).status;
const options = (f: FieldDef): string[] => (f.kind === "select" ? f.options.map((o) => o.label) : []);

function salaried(): WorkingHousehold {
  let wh = blankHousehold(BASE);
  const start = buildStage("work", wh).sections[0]!.groups[0]!.actions.find((a) => a.key.endsWith("/start"))!;
  wh = start.run(wh);
  return allFields(buildStage("work", wh)).find((f) => f.key.endsWith("/annual"))!.set(wh, 6000000);
}
const card = () => action(salaried(), "housing/add/cardLoan");

describe("ほかのローンの完済の年月", () => {
  it("返済額を入れていない間は「仮に5年」の推定で、欄の下は根拠の1行（「今から5年後（…）」だけにしない）", () => {
    let wh = card();
    const id = debt(wh).id;
    wh = set(wh, `${id}/balance`, 500000);
    expect(debt(wh).repayment.termMonths).toBe(60);
    expect(status(wh, `${id}/payoff`)).toBe("estimated");
    expect(availableOps(fieldOf(wh, `${id}/payoff`), wh)).toContain("confirm");
    expect(hint(wh, id)).toBe("返済期間が分からないので仮に5年（毎月の返済額を入れると逆算します）");
    expect(hint(wh, id)).not.toContain("今から5年後");
    // 毎月の返済額の欄は未入力のまま（入れてもらう値）
    expect(status(wh, `${id}/payment`)).toBe("missing");
  });

  it("仮の5年を「この値にする」で確定すると、毎月の返済額の未入力の印も外れる", () => {
    let wh = card();
    const id = debt(wh).id;
    wh = set(wh, `${id}/balance`, 500000);
    wh = applyStateOp(wh, fieldOf(wh, `${id}/payoff`), "confirm");
    expect(status(wh, `${id}/payoff`)).toBe("confirmed");
    expect(status(wh, `${id}/payment`)).toBe("confirmed");
    expect(hint(wh, id)).toBe("あと5年で完済（令和13年）");
  });

  it("残高の後に返済額を入れると、逆算した完済の年月の根拠を欄の下に書く", () => {
    let wh = card();
    const id = debt(wh).id;
    wh = set(wh, `${id}/balance`, 500000);
    wh = set(wh, `${id}/payment`, 10000);
    expect(debt(wh).repayment.termMonths).toBe(79);
    expect(status(wh, `${id}/payoff`)).toBe("estimated");
    expect(hint(wh, id)).toBe("毎月の返済額 10,000円と金利から逆算（あと6年7か月で完済）");
  });

  it("返済額を残高より先に入れても、残高を入れたときに完済の年月を逆算する", () => {
    let wh = card();
    const id = debt(wh).id;
    // 残高が未入力の間は返済額を断らずに持つ（前は「利息にも足りず」と断られた）
    expect(fieldOf(wh, `${id}/payment`).refuse?.(wh, 10000) ?? null).toBeNull();
    wh = set(wh, `${id}/payment`, 10000);
    expect(fieldOf(wh, `${id}/payment`).get(wh).value).toBe(10000);
    expect(status(wh, `${id}/payment`)).toBe("confirmed");
    expect(hint(wh, id)).toBe("返済期間が分からないので仮に5年（今の残高を入れると、毎月の返済額から逆算します）");
    wh = set(wh, `${id}/balance`, 500000);
    expect(debt(wh).repayment.termMonths).toBe(79);
    expect(hint(wh, id)).toBe("毎月の返済額 10,000円と金利から逆算（あと6年7か月で完済）");
  });

  it("入れた完済の年月は、同じ年月を言い直さずに残りの期間を読む", () => {
    let wh = card();
    const id = debt(wh).id;
    wh = set(wh, `${id}/balance`, 500000);
    wh = set(wh, `${id}/payoff`, "2029-04");
    expect(status(wh, `${id}/payoff`)).toBe("confirmed");
    expect(hint(wh, id)).toBe("あと2年6か月で完済（令和11年）");
    expect(hint(wh, id)).not.toContain("2029年4月");
  });

  it("前の版の「未入力（…5年で返す…）」の行も、仮の5年として読む", () => {
    let wh = card();
    const d = debt(wh);
    wh = mutate(wh, (_h, req) =>
      void putRow(req.input as unknown as Record<string, unknown>, { target: { object: d.id }, item: "debt.repayment", at: ["termMonths"] }, { state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis: "未入力（毎月の返済額を入れてください。今は5年で返すとみなしています）" } }),
    );
    wh = set(wh, `${d.id}/balance`, 500000);
    expect(status(wh, `${d.id}/payment`)).toBe("missing");
    expect(hint(wh, d.id)).toBe("返済期間が分からないので仮に5年（毎月の返済額を入れると逆算します）");
    wh = set(wh, `${d.id}/payment`, 10000);
    expect(debt(wh).repayment.termMonths).toBe(79);
  });
});

describe("ほかのローンの「＋」のボタンと種類の選択肢", () => {
  const otherActions = (wh: WorkingHousehold) => stage(wh).sections.find((s) => s.key === "housing/otherDebts")!.actions;

  it("ボタンはカードローン・リボ、奨学金の返済、リフォームローン（持ち家のある世帯）、そのほかのローン（選んで足す）", () => {
    const own = action(salaried(), "housing/addOwn");
    const list = otherActions(own);
    expect(list.filter((a) => a.choice === undefined).map((a) => a.label)).toEqual(["＋ カードローン・リボ", "＋ 奨学金の返済", "＋ リフォームローン"]);
    const misc = list.filter((a) => a.choice !== undefined);
    expect(new Set(misc.map((a) => a.choice!.label))).toEqual(new Set(["＋ そのほかのローン"]));
    expect(misc.map((a) => a.label)).toEqual(["契約者貸付（保険）", "親・知人からの借入", "上のどれにも当たらないローン"]);
  });

  it("奨学金の返済で足したローンの種類は、第二種・第一種の2つだけ", () => {
    const wh = action(salaried(), "housing/add/scholarship");
    expect(options(fieldOf(wh, `${debt(wh).id}/subtype`))).toEqual(["奨学金の返済（第二種・有利子）", "奨学金の返済（第一種・無利子）"]);
  });

  it("カードローン・リボ、リフォームローンには種類の欄を出さない（選べる種類が1つ）", () => {
    expect(findField(card(), `${debt(card()).id}/subtype`)).toBeUndefined();
    const own = action(action(salaried(), "housing/addOwn"), "housing/add/renovation");
    expect(debt(own).subtype).toBe("renovation");
    expect(findField(own, `${debt(own).id}/subtype`)).toBeUndefined();
  });

  it("そのほかのローンで足したローンは、契約者貸付・親・知人・その他から選べる。選んだ種類で足す", () => {
    const wh = action(salaried(), "housing/add/personal");
    expect(debt(wh)).toMatchObject({ kind: "other", subtype: "personal" });
    const f = fieldOf(wh, `${debt(wh).id}/subtype`);
    expect(options(f)).toEqual(["契約者貸付（保険）", "親・知人からの借入", "上のどれにも当たらないローン"]);
    const next = set(wh, `${debt(wh).id}/subtype`, "policyLoan");
    expect(debt(next).subtype).toBe("policyLoan");
  });

  it("前の世帯の種類は、組の外へ動かさずにそのまま見せる（種類の細目の無いほかのローン・奨学金も）", () => {
    let wh = card();
    const id = debt(wh).id;
    wh = mutate(wh, (h) => {
      const d = h.debts!.find((x) => x.id === id)!;
      delete d.subtype;
    });
    expect(fieldOf(wh, `${id}/subtype`).get(wh).value).toBe("other");
    expect(options(fieldOf(wh, `${id}/subtype`))).toContain("上のどれにも当たらないローン");
    wh = mutate(wh, (h) => {
      const d = h.debts!.find((x) => x.id === id)!;
      d.kind = "scholarship";
    });
    expect(fieldOf(wh, `${id}/subtype`).get(wh).value).toBe("scholarship");
    expect(options(fieldOf(wh, `${id}/subtype`))).toEqual(["奨学金の返済（第二種・有利子）", "奨学金の返済（第一種・無利子）"]);
  });
});
