// 0111 の追記 2026-11-03（世帯ファイルの形式 0.54）: 推定の元の印。事務所の推定の値から作った推定を、値の箱の estimate.source に持つ
import { afterEach, describe, expect, it } from "vitest";
import { forEngine } from "../src/engine/moneyRows.ts";
import { changedOfficeValues, officeFingerprint, officialMasterValue, type BracketStep } from "../../hearing/src/statistics.ts";
import { EMPTY_ESTIMATES, publishOfficeEstimates, withOfficeValue, withoutOfficeValue, type OfficeEstimates } from "../src/workspace/office/estimates.ts";
import { blankHousehold, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { officeSourceView, withOfficeSources } from "../src/workspace/input/officeSource.ts";
import { checkList } from "../src/workspace/input/checkRows.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { applyStateOp, fieldStatus } from "../src/workspace/input/valueState.ts";
import { preview } from "./helpers.ts";

afterEach(() => publishOfficeEstimates(undefined));

const LIVING = "living.statistics.basicMonthly";
const ON = "2026-11-03";
const living = (): readonly BracketStep[] => officialMasterValue(LIVING)?.value as readonly BracketStep[];
/** 1人の段だけを変えた基本生活費の表（空の世帯は本人1人） */
const single = (amount: number) => living().map((s) => (s.upTo === 1 ? { upTo: 1, amount } : s));
const office = (amount: number, text: string | null = "当事務所の単身のお客さまの平均"): OfficeEstimates => withOfficeValue(EMPTY_ESTIMATES, LIVING, single(amount), text, ON);

type Est = { method: string; basis: string; source?: { kind: string; values: Record<string, string> } };
const monthlyOf = (wh: WorkingHousehold) => wh.request.input.household.livingExpenses?.[0]?.monthly as unknown as { value: number; state: string; estimate?: Est };
const livingField = (wh: WorkingHousehold): FieldDef => allFields(buildStage("living", wh)).find((f) => f.item === "livingExpense.monthly")!;

/** 新しい世帯（画面の新しい世帯と同じ順: 推定を入れてから印を付ける） */
const newHousehold = (): WorkingHousehold => withOfficeSources(withRefreshedEstimates(blankHousehold("2026-10")), null);
/** 世帯を直したとき（画面の現状の置き換えと同じ順: 推定を入れ直してから、直す前と比べて印を付ける） */
const edited = (next: WorkingHousehold, prev: WorkingHousehold): WorkingHousehold => withOfficeSources(withRefreshedEstimates(next), prev);
/** 推定と関係の無い所を直す（表の最後の年） */
const touch = (wh: WorkingHousehold): WorkingHousehold => ({ ...wh, request: { ...wh.request, input: { ...wh.request.input, endYear: wh.request.input.endYear + 1 } } });

describe("印を付ける", () => {
  it("事務所の推定の値から作った推定に印を付け、公式の目安から作った推定には付けない", () => {
    expect(monthlyOf(newHousehold()).estimate?.source).toBeUndefined();
    publishOfficeEstimates(office(150000));
    const wh = newHousehold();
    expect(monthlyOf(wh)).toMatchObject({ value: 150000, state: "estimated", estimate: { basis: "当事務所の単身のお客さまの平均" } });
    expect(monthlyOf(wh).estimate?.source).toEqual({ kind: "office", values: { [LIVING]: officeFingerprint(single(150000)) } });
    expect(fieldStatus(livingField(wh), wh).office).toEqual({ ids: [LIVING], changed: [] });
  });

  it("指紋は値だけで決まる（根拠の文・変えた日は入れない）", () => {
    expect(officeFingerprint(single(150000))).toMatch(/^[0-9a-f]{8}$/);
    expect(officeFingerprint(single(150000))).toBe(officeFingerprint(structuredClone(single(150000))));
    expect(officeFingerprint(single(150000))).not.toBe(officeFingerprint(single(150001)));
  });

  it("同じ根拠の文の事務所の値が2つあれば、両方を印に入れる（どちらかが変われば、前の値から作ったと見る）", () => {
    const BONUS = "wageStats.annualBonus.regular.all";
    const both = withOfficeValue(office(150000, null), BONUS, 500000, null, ON);
    publishOfficeEstimates(both);
    const wh = newHousehold();
    expect(Object.keys(monthlyOf(wh).estimate?.source?.values ?? {}).sort()).toEqual([LIVING, BONUS].sort());
    publishOfficeEstimates(withOfficeValue(both, BONUS, 600000, null, ON));
    expect(changedOfficeValues(monthlyOf(wh).estimate!.source as never)).toEqual([BONUS]);
  });

  it("計算の要求のスキーマが印を受け、計算には使わない", () => {
    publishOfficeEstimates(office(150000));
    const wh = newHousehold();
    const plain = structuredClone(wh.request);
    delete (plain.input.household.livingExpenses![0]!.monthly as unknown as { estimate: Est }).estimate.source;
    expect(preview(forEngine(wh.request)).table).toEqual(preview(forEngine(plain)).table);
  });
});

describe("事務所の値を変えた後", () => {
  it("直していない推定は前の印のまま（前の値から作ったと分かる）。根拠の文を書き換えても印は残る", () => {
    publishOfficeEstimates(office(150000));
    const wh = newHousehold();
    // 文も値も変える（前の推定の文は前の文のまま）
    publishOfficeEstimates(office(160000, "当事務所の平均（改訂）"));
    const field = livingField(wh);
    expect(fieldStatus(field, wh).office).toEqual({ ids: [LIVING], changed: [LIVING] });
    // 推定を入れ直さない直し方（推定の元の入力が同じ）でも、印は前のまま（同じ推定として引き継ぐ）
    const same = withOfficeSources(structuredClone(wh), wh);
    expect(monthlyOf(same).estimate?.source).toEqual(monthlyOf(wh).estimate?.source);
    // 確かめの一覧に「前の値から作った推定」の注意（今の事務所の値で入れ直す・この値にする）
    const row = checkList(wh).find((r) => r.fieldKey === field.key);
    expect(row).toMatchObject({ kind: "notice" });
    expect(row?.detail).toContain("この推定を作った後に変えています");
    expect(row?.actions.map((a) => a.key)).toEqual(["office-redo", "confirm"]);
    // 入れ直す: 今の事務所の値と根拠の文・新しい指紋
    const redone = withOfficeSources(row!.actions[0]!.run(wh), wh);
    expect(monthlyOf(redone)).toMatchObject({ value: 160000, estimate: { basis: "当事務所の平均（改訂）", source: { kind: "office", values: { [LIVING]: officeFingerprint(single(160000)) } } } });
    expect(fieldStatus(field, redone).office?.changed).toEqual([]);
    expect(checkList(redone).find((r) => r.fieldKey === field.key)?.kind).toBe("estimated");
    // この値にする: 前の値のまま確定（推定でなくなり、注意も消える）
    const kept = withOfficeSources(row!.actions[1]!.run(wh), wh);
    expect(monthlyOf(kept)).toMatchObject({ value: 150000, state: "confirmed" });
    expect(checkList(kept).some((r) => r.fieldKey === field.key && r.kind === "notice")).toBe(false);
  });

  it("推定の入れ直し: 世帯を直すと推定のままの値は今の事務所の値で入れ直し、印も新しくなる", () => {
    publishOfficeEstimates(office(150000));
    const wh = newHousehold();
    publishOfficeEstimates(office(170000));
    const next = edited(touch(wh), wh);
    expect(monthlyOf(next)).toMatchObject({ value: 170000, estimate: { source: { values: { [LIVING]: officeFingerprint(single(170000)) } } } });
    expect(fieldStatus(livingField(next), next).office?.changed).toEqual([]);
  });

  it("公式に戻すと、前の推定は「前の値から作った」になり、入れ直すと公式の目安の推定（印なし）になる", () => {
    const e = office(150000);
    publishOfficeEstimates(e);
    const wh = newHousehold();
    publishOfficeEstimates(withoutOfficeValue(e, LIVING));
    expect(fieldStatus(livingField(wh), wh).office?.changed).toEqual([LIVING]);
    const next = edited(touch(wh), wh);
    expect(monthlyOf(next).value).not.toBe(150000);
    expect(monthlyOf(next).estimate?.source).toBeUndefined();
    expect(fieldStatus(livingField(next), next).office).toBeUndefined();
  });

  it("FP が入れた値・確定にした値は、事務所の値を変えても変わらず、注意も出さない", () => {
    publishOfficeEstimates(office(150000));
    const wh = newHousehold();
    const confirmed = withOfficeSources(applyStateOp(wh, livingField(wh), "confirm"), wh);
    publishOfficeEstimates(office(170000));
    const next = edited(touch(confirmed), confirmed);
    expect(monthlyOf(next)).toMatchObject({ value: 150000, state: "confirmed" });
    expect(checkList(next).some((r) => r.fieldKey === livingField(next).key && r.kind === "notice")).toBe(false);
  });
});

describe("前の版の世帯（印の無い推定）", () => {
  it("印の無い推定は公式の目安から作ったと読む（根拠の文が今の事務所の文と同じでも、直すまで印を付けない）", () => {
    publishOfficeEstimates(office(150000));
    const wh = newHousehold();
    // 0.53 までの形: 印を持たない推定（根拠の文は事務所の文）
    const old = structuredClone(wh);
    delete (old.request.input.household.livingExpenses![0]!.monthly as unknown as { estimate: Est }).estimate.source;
    expect(fieldStatus(livingField(old), old).office).toBeUndefined();
    expect(officeSourceView(monthlyOf(old).estimate)).toBeNull();
    // 推定を変えない直し方では、印を付けない（前の版の推定のまま）
    const same = withOfficeSources(structuredClone(old), old);
    expect(monthlyOf(same).estimate?.source).toBeUndefined();
    // 推定を作り直すと（事務所の値が変わり、入れ直しで値が変わる）、今の事務所の値の印が付く
    publishOfficeEstimates(office(155000));
    const next = edited(touch(old), old);
    expect(monthlyOf(next)).toMatchObject({ value: 155000, estimate: { source: { kind: "office" } } });
  });
});
