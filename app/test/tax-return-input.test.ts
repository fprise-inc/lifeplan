// 事業所得のある人の確定申告（申告の仕方・青色申告特別控除。0155）: 働き方と収入の入力項目に、収益不動産の「申告」と同じ値（members[].taxReturn）の欄を出す。
// どちらから入れても同じ値・入れないと白色の推定（55万円・65万円を使える人）・標準の欄・計算に効く・ヒアリングシートから入る
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Member } from "../src/engine/types.ts";
import { fieldPlaces } from "../src/workspace/documents/resolve.ts";
import { applyImport, approvalTime, importSheet } from "../src/workspace/hearing/sheet.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { allFields, type FieldDef, type StageId } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { addRentalProperty } from "../src/workspace/input/stages/rental.ts";
import { BLUE_DEDUCTION_BLANK, TAX_RETURN_BLANK } from "../src/workspace/input/taxReturn.ts";
import { applyStateOp, fieldStatus } from "../src/workspace/input/valueState.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { modelHousehold, preview } from "./helpers.ts";

const open = (id: string): WorkingHousehold => fromRequest(modelHousehold(id));
const fieldsOf = (wh: WorkingHousehold, stage: StageId): FieldDef[] => allFields(buildStage(stage, wh));
const fieldOf = (wh: WorkingHousehold, stage: StageId, key: string): FieldDef => {
  const f = fieldsOf(wh, stage).find((x) => x.key === key);
  if (f === undefined) throw new Error(`欄が無い: ${key}`);
  return f;
};
const selfOf = (wh: WorkingHousehold): Member => wh.request.input.household.members.find((m) => m.kind === "self")!;
const sumRow = (wh: WorkingHousehold, row: string, year: number) =>
  preview(wh.request)
    .table.filter((c) => (c.row === row || c.row.startsWith(`${row}.`)) && c.year === year)
    .reduce((s, c) => s + c.amount, 0);

describe("働き方と収入の「確定申告」", () => {
  it("事業所得のある人にだけ出る。標準の欄で、入れないと白色（青色申告特別控除なし）の推定", () => {
    const wh = open("sampleSelfEmployedFamily");
    const id = selfOf(wh).id;
    const g = buildStage("work", wh).sections.flatMap((s) => s.groups).find((x) => x.key === `work/${id}/taxReturn`);
    expect(g).toMatchObject({ level: "simple", title: "ご本人の確定申告" });
    const method = fieldOf(wh, "work", `work/${id}/taxReturn/method`);
    expect(method.level).toBe("simple");
    expect(method.get(wh)).toMatchObject({ value: "white", estimated: TAX_RETURN_BLANK });
    expect(fieldStatus(method, wh)).toMatchObject({ status: "estimated", basis: TAX_RETURN_BLANK });
    expect(fieldsOf(wh, "work").some((f) => f.key.endsWith("/taxReturn/blueDeduction"))).toBe(false);
    // 会社員だけの世帯には出さない
    const salaried = open("salariedCoupleTwoKids");
    expect(fieldsOf(salaried, "work").some((f) => f.key.includes("/taxReturn/"))).toBe(false);
  });

  it("青色にすると青色申告特別控除が標準に出て、入れないと10万円の推定。白色に戻すと白色と書き（推定でなく確定）、区分は外す", () => {
    let wh = open("sampleSelfEmployedFamily");
    const id = selfOf(wh).id;
    const k = `work/${id}/taxReturn`;
    wh = fieldOf(wh, "work", `${k}/method`).set(wh, "blue");
    expect(selfOf(wh).taxReturn).toEqual({ method: "blue" });
    const ded = fieldOf(wh, "work", `${k}/blueDeduction`);
    expect(ded.level).toBe("simple");
    expect(ded.get(wh)).toMatchObject({ value: "simple", estimated: BLUE_DEDUCTION_BLANK });
    // 事業所得があるので55万円・65万円も使える（10万円で計算している知らせは出さない）
    wh = ded.set(wh, "electronic");
    expect(selfOf(wh).taxReturn).toEqual({ method: "blue", blueDeduction: "electronic" });
    expect(fieldOf(wh, "work", `${k}/blueDeduction`).get(wh).warn ?? null).toBeNull();
    wh = fieldOf(wh, "work", `${k}/method`).set(wh, "white");
    expect(selfOf(wh).taxReturn).toEqual({ method: "white" });
    expect(fieldStatus(fieldOf(wh, "work", `${k}/method`), wh).status).toBe("confirmed");
  });

  it("推定の白色は「この値にする」で確定にでき（白色と書く）、推定に戻すと欄ごと外れる。見せている値を書き戻しても世帯は変えない", () => {
    const wh = open("sampleSelfEmployedFamily");
    const f = fieldOf(wh, "work", `work/${selfOf(wh).id}/taxReturn/method`);
    expect(f.set(wh, "white")).toBe(wh);
    const ok = applyStateOp(wh, f, "confirm");
    expect(selfOf(ok).taxReturn).toEqual({ method: "white" });
    expect(fieldStatus(f, ok).status).toBe("confirmed");
    const back = applyStateOp(ok, f, "revert");
    expect(selfOf(back).taxReturn).toBeUndefined();
    expect(fieldStatus(f, back).status).toBe("estimated");
  });

  it("収益不動産の「申告」と同じ値: どちらから入れても、もう片方に同じ値が出る。書類の当て先は1つ", () => {
    let wh = addRentalProperty(open("sampleSelfEmployedFamily"));
    const id = selfOf(wh).id;
    const work = (w: WorkingHousehold, at: string) => fieldOf(w, "work", `work/${id}/taxReturn/${at}`);
    const rental = (w: WorkingHousehold, at: string) => fieldOf(w, "rental", `rental/taxReturn/${id}/${at}`);
    // 事業所得がある人は、収益不動産の側でも推定の印（同じ欄の定義）
    expect(rental(wh, "method").get(wh)).toMatchObject({ value: "white", estimated: TAX_RETURN_BLANK });
    wh = work(wh, "method").set(wh, "blue");
    expect(rental(wh, "method").get(wh).value).toBe("blue");
    wh = rental(wh, "blueDeduction").set(wh, "doubleEntry");
    expect(work(wh, "blueDeduction").get(wh).value).toBe("doubleEntry");
    expect(selfOf(wh).taxReturn).toEqual({ method: "blue", blueDeduction: "doubleEntry" });
    const places = fieldPlaces(wh).filter((p) => p.address?.item === "member.taxReturn" && JSON.stringify(p.address.target) === JSON.stringify({ object: id }));
    expect(places.map((p) => JSON.stringify(p.address?.at)).sort()).toEqual(['["blueDeduction"]', '["method"]']);
  });

  it("物件だけの人（事業所得が無く事業的規模でもない）は、今までどおり推定の印を付けない（10万円までしか効かない）", () => {
    const wh = open("dualAssetsTwoKids");
    const f = fieldsOf(wh, "rental").find((x) => x.key.startsWith("rental/taxReturn/") && x.key.endsWith("/method"))!;
    expect(f.get(wh)).toMatchObject({ value: "white", implicit: true });
    expect(fieldStatus(f, wh).status).toBe("confirmed");
  });

  it("会社員の副業の事業所得（入るお金の行）の人にも出る", () => {
    const wh0 = open("salariedCoupleTwoKids");
    const id = selfOf(wh0).id;
    const wh = mutate(wh0, (h) => {
      (h.incomeFlows ??= []).push({ id: "00000000-0000-4000-8000-0000000000f1", kind: "sideJob", taxTreatment: "business", from: { at: "2026-10" }, to: null, everyYears: 1, monthly: true, amount: { value: 100000, state: "confirmed", origin: { kind: "manual" } }, recipient: id });
    });
    expect(fieldsOf(wh, "work").some((f) => f.key === `work/${id}/taxReturn/method`)).toBe(true);
  });

  it("計算に効く: 青色65万円にすると、翌々年の所得税・住民税が下がる（事業所得 年850万円の見本）", () => {
    const wh = open("sampleSelfEmployedFamily");
    const id = selfOf(wh).id;
    let blue = fieldOf(wh, "work", `work/${id}/taxReturn/method`).set(wh, "blue");
    blue = fieldOf(blue, "work", `work/${id}/taxReturn/blueDeduction`).set(blue, "electronic");
    expect(sumRow(wh, "cf.taxSi.incomeTax", 2028) - sumRow(blue, "cf.taxSi.incomeTax", 2028)).toBe(132_500);
    expect(sumRow(wh, "cf.taxSi.residentTax", 2028) - sumRow(blue, "cf.taxSi.residentTax", 2028)).toBe(65_000);
  });

  it("標準の欄の数: 自営業の人の働き方と収入に1つ（申告の仕方）、青色なら2つ増える", () => {
    const simpleCount = (w: WorkingHousehold) => fieldsOf(w, "work").filter((f) => f.level === "simple" && f.key.includes("/taxReturn/")).length;
    const wh = open("sampleSelfEmployedFamily");
    expect(simpleCount(wh)).toBe(1);
    expect(simpleCount(fieldOf(wh, "work", `work/${selfOf(wh).id}/taxReturn/method`).set(wh, "blue"))).toBe(2);
  });
});

describe("詳細版のヒアリングシート（full 版4）の確定申告の仕方", () => {
  it("取り込むと配偶者の方の申告の仕方・青色申告特別控除が確定で入り、働き方と収入の「確定申告」に出る", async () => {
    let n = 0;
    const seq = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    const wh = withRefreshedEstimates(blankHousehold("2026-10", seq));
    const xlsx = new Uint8Array(readFileSync(join(REPO_DIR, "hearing", "samples", "full-4-sample.xlsx")));
    const r = await importSheet(xlsx, wh, seq);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const out = applyImport(wh, r.view, new Set(r.view.candidates.map((c) => c.id)), approvalTime(new Date(2026, 10, 7, 10, 0, 0)));
    const spouse = out.wh.request.input.household.members.find((m) => m.kind === "spouse")!;
    expect(spouse.taxReturn).toEqual({ method: "blue", blueDeduction: "electronic" });
    const f = fieldOf(out.wh, "work", `work/${spouse.id}/taxReturn/blueDeduction`);
    expect(f.get(out.wh).value).toBe("electronic");
    expect(fieldStatus(f, out.wh).status).toBe("confirmed");
  });
});
