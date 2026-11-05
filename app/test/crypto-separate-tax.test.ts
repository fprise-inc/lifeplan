// 暗号資産の申告分離課税（0124）: 取り崩しの順番に課税口座の次で並ぶ、売ったときの税の扱い（雑所得の物は順番に並べない・引き出せない期間を出さない）、
// 取得価額の欄、開いたときの知らせ
import { describe, expect, it } from "vitest";
import type { Account } from "../src/engine/types.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { setWithdrawOrder, STANDARD_ORDER_KINDS, withdrawViewOf } from "../src/workspace/input/savings/model.ts";
import { householdNoticeText } from "../src/workspace/header/status.ts";
import { modelHousehold, preview } from "./helpers.ts";

const open = (): WorkingHousehold => fromRequest(modelHousehold("investmentCouple"));
const fieldsOf = (wh: WorkingHousehold): Map<string, FieldDef> => new Map(allFields(buildStage("savings", wh)).map((f) => [f.key, f]));
const fieldOf = (wh: WorkingHousehold, key: string): FieldDef => {
  const f = fieldsOf(wh).get(key);
  if (f === undefined) throw new Error(`欄が無い: ${key}`);
  return f;
};
const addCrypto = (wh: WorkingHousehold): { wh: WorkingHousehold; a: Account } => {
  const sec = buildStage("savings", wh).sections.find((s) => s.key === "sav/accounts")!;
  const next = sec.actions.find((x) => x.key === "sav/add/cryptoAsset")!.run(wh);
  const a = (next.request.input.household.accounts ?? []).filter((x) => x.kind === "cryptoAsset").at(-1) as Account;
  return { wh: next, a };
};
const accOf = (wh: WorkingHousehold, id: string) => (wh.request.input.household.accounts ?? []).find((x) => x.id === id) as Account;

describe("取り崩しの順番（0124）", () => {
  it("標準の順番は課税口座の次に暗号資産（エンジンの既定と同じ）", () => {
    expect(STANDARD_ORDER_KINDS).toEqual(["deposit", "fxDeposit", "zaikei", "taxable", "cryptoAsset", "esop", "legacyNisa", "nisa"]);
    const { wh, a } = addCrypto(open());
    const v = withdrawViewOf(wh.request);
    const kinds = v.included.map((x) => x.kind);
    expect(v.included.some((x) => x.id === a.id)).toBe(true);
    if (kinds.includes("taxable")) expect(kinds.indexOf("cryptoAsset")).toBeGreaterThan(kinds.lastIndexOf("taxable"));
  });

  it("口座ごとの順番を書くと暗号資産の種類も書き、「取り崩さない」にもできる", () => {
    const { wh, a } = addCrypto(open());
    const req = structuredClone(wh.request);
    const ids = withdrawViewOf(req).included.map((x) => x.id);
    setWithdrawOrder(req, ids.filter((x) => x !== a.id));
    const order = req.input.assumptions?.withdrawal?.order ?? [];
    expect(order.some((o) => "kind" in o && o.kind === "cryptoAsset")).toBe(false);
    expect(withdrawViewOf(req).excluded.some((x) => x.id === a.id)).toBe(true);
    setWithdrawOrder(req, [...ids.filter((x) => x !== a.id), a.id]);
    expect(withdrawViewOf(req).included.at(-1)?.id).toBe(a.id);
  });

  it("売ったときの税を「雑所得」にすると、取り崩しの順番に並べず、引き出せない期間の欄を出さない", () => {
    const added = addCrypto(open());
    const a = added.a;
    let wh = added.wh;
    const tax = fieldOf(wh, `sav/${a.id}/cryptoTax`);
    expect(tax.label).toBe("売ったときの税");
    expect(tax.help).toContain("2028年1月");
    expect(tax.help).toContain("3年");
    expect(fieldsOf(wh).has(`sav/${a.id}/lock`)).toBe(true);
    wh = tax.set(wh, "miscellaneous");
    expect(accOf(wh, a.id).cryptoTaxation).toBe("miscellaneous");
    const v = withdrawViewOf(wh.request);
    expect([...v.included, ...v.excluded].some((x) => x.id === a.id)).toBe(false);
    expect(fieldsOf(wh).has(`sav/${a.id}/lock`)).toBe(false);
  });

  it("取得価額の欄（暗号資産の言葉）を入れると、器の取得価額になる", () => {
    const added = addCrypto(open());
    const a = added.a;
    let wh = added.wh;
    const cost = fieldOf(wh, `sav/${a.id}/cost`);
    expect(cost.label).toBe("取得価額（買った額の合計）");
    expect(cost.help).toContain("2028年からの取り崩し");
    wh = cost.set(wh, 300_000);
    expect(accOf(wh, a.id).costBasis?.value).toBe(300_000);
    // 計算は通る（2028年からの税の行は、取り崩した年だけに出る）
    expect(preview(wh.request).table.length).toBeGreaterThan(0);
  });
});

describe("開いたときの知らせ（0124）", () => {
  it("暗号資産の数と、順番に足した数", () => {
    const t = householdNoticeText({ kind: "cryptoSeparateTax", count: 2, plans: 1 })!;
    expect(t.title).toBe("暗号資産を2028年から取り崩すようにしました");
    expect(t.text).toContain("暗号資産（2件）");
    expect(t.text).toContain("（1か所）");
    expect(householdNoticeText({ kind: "cryptoSeparateTax", count: 1, plans: 0 })!.text).not.toContain("か所");
  });
});
