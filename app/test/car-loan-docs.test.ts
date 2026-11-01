// これから買う車のローンの「書類で確かめる」を、読むときに推定にする（0041 の追記 2026-11-01。世帯ファイルの形は変えない）:
// 現状の車の値の状態の行・プランの差分（値を変える差分と車を足す差分）・開いたときの知らせ・今返している自動車ローンの書類待ちは残す
import { describe, expect, it } from "vitest";
import type { EngineRequest } from "../src/engine/types.ts";
import { withoutFutureCarLoanDocs } from "../src/workspace/input/carLoanDocs.ts";
import { checkList } from "../src/workspace/input/checkRows.ts";
import { allFields } from "../src/workspace/input/form.ts";
import { fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { addCar } from "../src/workspace/input/stages/cars.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { applyStateOp, fieldStatus } from "../src/workspace/input/valueState.ts";
import type { Proposal } from "../src/workspace/plans/plans.ts";
import { barNotices, type BarInputs } from "../src/workspace/header/status.ts";
import { bodyObject, EMPTY_CARRY, fromBody, type BodyState } from "../src/workspace/store/body.ts";
import { migrationId } from "../src/workspace/store/readings.ts";
import { modelHousehold, preview } from "./helpers.ts";

type Obj = Record<string, unknown>;
let n = 0;
const ids = () => () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const state = (wh: WorkingHousehold): BodyState => ({ wh, workspace: { template: null, band: [], base: "current", selected: "current", shownItems: [] }, display: { result: {}, balance: {} } as unknown as BodyState["display"], carry: EMPTY_CARRY });
const read = (wh: WorkingHousehold): WorkingHousehold => fromBody(JSON.stringify(bodyObject(state(wh)))).wh;
const PREVIOUS = "前に入っていた値を代わりに使う";
const unknownRow = (basis: string) => ({ state: "unknown", origin: { kind: "manual" }, estimate: { method: "standard", basis } });

/** 前の画面で、これから買う車のローンの金利と年数を「書類で確かめる」にした世帯（プランの差分にも1件ずつ） */
function oldHousehold(): WorkingHousehold {
  let wh = addCar(fromRequest(modelHousehold("salariedCoupleTwoKids")), ids());
  wh = allFields(buildStage("car", wh)).find((f) => f.key.endsWith("/pay"))!.set(wh, "loan");
  // 前の画面の「書類で確かめる」は、仮の印を外して向き先の車の行に書いていた
  const keys = allFields(buildStage("car", wh)).filter((f) => f.item === "car.loan" && /\/(rate|term)$/.test(f.key)).map((f) => f.key);
  expect(keys).toHaveLength(2);
  wh = mutate({ ...wh, assumed: Object.fromEntries(Object.entries(wh.assumed).filter(([k]) => !keys.includes(k))) }, (h) => {
    const car = h.cars!.at(-1)! as unknown as Obj;
    car.valueStates = { ...(car.valueStates as Obj | undefined), "car.loan/rate": unknownRow(PREVIOUS), "car.loan/termMonths": unknownRow("自動車ローンの年数の目安 5年") };
  });
  const car = wh.request.input.household.cars!.at(-1)!;
  const added = { ...structuredClone(car), id: "00000000-0000-4000-8000-0000000c0a01", valueStates: { "car.loan/share": unknownRow(PREVIOUS) } };
  const plan: Proposal = {
    id: "P",
    name: "プランB",
    createdAt: "x",
    updatedAt: "x",
    base: null,
    tags: [],
    diffs: [
      {
        id: "d1",
        op: "set",
        target: { object: car.id },
        item: "car.loan",
        at: ["rate"],
        value: { state: "unknown", origin: { kind: "manual" }, substitute: { value: "0.031", state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis: PREVIOUS } } },
        before: { value: "0.031", state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis: "自動車ローンの金利の目安" } },
        enabled: true,
        origin: { kind: "manual" },
        note: null,
      },
      { id: "d2", op: "add", target: { collection: "car" }, item: null, at: [], value: added, before: null, enabled: true, origin: { kind: "manual" }, note: null },
    ],
  } as Proposal;
  return { ...wh, proposals: [plan] };
}

describe("これから買う車のローンの「書類で確かめる」は、読むときに推定にする", () => {
  it("現状の行は値のまま推定に（前の値を代わりにした印は代わりの値の文に）。計算は変わらない", () => {
    const old = oldHousehold();
    const back = read(old);
    const car = back.request.input.household.cars!.at(-1)! as unknown as { valueStates: Obj; loan: unknown };
    expect(car.valueStates["car.loan/rate"]).toEqual({ state: "estimated", origin: { kind: "manual" }, estimate: { method: "standard", basis: "「書類で確かめる」の代わりに使っていた値（前に入っていた値）" } });
    expect(car.valueStates["car.loan/termMonths"]).toEqual({ state: "estimated", origin: { kind: "manual" }, estimate: { method: "standard", basis: "自動車ローンの年数の目安 5年" } });
    expect(car.loan).toEqual(old.request.input.household.cars!.at(-1)!.loan);
    // 欄は推定に見え、確かめの一覧の書類待ちに出ない
    const rate = allFields(buildStage("car", back)).find((f) => f.item === "car.loan" && f.key.endsWith("/rate"))!;
    expect(fieldStatus(rate, back).status).toBe("estimated");
    expect(checkList(back).some((r) => r.kind === "unknown" && r.card === "car")).toBe(false);
    expect(preview(back.request as EngineRequest).table).toEqual(preview(old.request as EngineRequest).table);
  });

  it("プランの差分: 値を変える差分（car.loan）と、車を足す差分の物の中も推定に", () => {
    const back = read(oldHousehold());
    const [set, add] = back.proposals[0]!.diffs;
    expect(set!.value).toEqual({ value: "0.031", state: "estimated", origin: { kind: "manual" }, estimate: { method: "standard", basis: "「書類で確かめる」の代わりに使っていた値（前に入っていた値）" } });
    expect(set!.before).toMatchObject({ state: "estimated", estimate: { basis: "自動車ローンの金利の目安" } });
    expect(((add!.value as Obj).valueStates as Obj)["car.loan/share"]).toMatchObject({ state: "estimated" });
  });

  it("推定にした数の知らせを1つ足す（保存して読み直しても増えない）。知らせの文は短く、押すと入力の画面を開く", () => {
    const back = read(oldHousehold());
    const notices = (back.notices ?? []).filter((x) => x.kind === "carLoanEstimated");
    expect(notices).toEqual([{ id: migrationId("notices/carLoanEstimated/2/2"), kind: "carLoanEstimated", count: 2, plans: 2 }]);
    const again = read(back);
    expect(again.notices).toEqual(back.notices);
    expect(again.request).toEqual(back.request);
    expect(again.proposals).toEqual(back.proposals);
    const i: BarInputs = { opened: true, stored: true, save: { kind: "idle" } as never, paused: false, aiSharing: false, storage: [], showing: { recovery: false, office: false, storage: false }, presence: null, message: (c) => c, household: notices };
    const [bar] = barNotices(i);
    expect(bar).toMatchObject({ target: "input", action: "入力" });
    expect(bar?.text).toContain("2か所とプランの変更 2件");
    expect(bar?.text).toContain("今返している自動車ローン");
    expect(bar?.text).toContain("結果は変わりません");
    expect(bar!.text.length).toBeLessThanOrEqual(120);
  });

  it("今返している自動車ローンの書類待ちは残す。変える物が無い世帯はそのまま（同じ世帯を返す）", () => {
    let wh = fromRequest(modelHousehold("dualAssetsTwoKids"));
    const debt = wh.request.input.household.debts!.find((d) => d.kind === "car")!;
    const rate = allFields(buildStage("car", wh)).find((f) => f.key === `housing/debt/${debt.id}/rate`)!;
    expect(rate.docCheck).toBe("返済予定表");
    wh = applyStateOp(wh, rate, "unknown");
    expect(fieldStatus(rate, wh).status).toBe("unknown");
    expect(withoutFutureCarLoanDocs(wh)).toBe(wh);
    const back = read(wh);
    expect(fieldStatus(rate, back).status).toBe("unknown");
    expect((back.notices ?? []).some((x) => x.kind === "carLoanEstimated")).toBe(false);
    expect(checkList(back).find((r) => r.kind === "unknown" && r.fieldKey === rate.key)?.detail).toContain("返済予定表で確かめる");
  });
});
