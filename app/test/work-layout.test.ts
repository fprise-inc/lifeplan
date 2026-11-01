// 働き方と収入の入力項目（0047 の追記 2026-10-29）: 詳細の並び（働き方 1・2… → ＋ 働き方を足す → 定年後の予定）、
// 標準報酬月額の空欄の目安と2つの箱の形、辞め方の「自動」の言い方と定年の期間の知らせ
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import type { EmploymentPeriod } from "../src/engine/types.ts";
import { checkList } from "../src/workspace/input/checkRows.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { fieldDomId } from "../src/workspace/input/FieldViews.tsx";
import { allFields, groupShown, inSimpleOnlyGroup, type FieldDef, type StageDef } from "../src/workspace/input/form.ts";
import { fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { InputPanel } from "../src/workspace/input/InputPanel.tsx";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { SMR_BLANK_BASIS } from "../src/workspace/input/stages/work.ts";
import { applyStateOp, availableOps, fieldStatus } from "../src/workspace/input/valueState.ts";
import { modelHousehold, preview } from "./helpers.ts";

const noop = () => undefined;
const open = (m: string): WorkingHousehold => fromRequest(modelHousehold(m), {});
const panel = (wh: WorkingHousehold, level: "simple" | "detail") => renderToString(h(InputPanel, { wh, itemId: "work", level, onLevel: noop, onSave: noop, onClose: noop }));
const stage = (wh: WorkingHousehold): StageDef => buildStage("work", wh);
const fieldOf = (wh: WorkingHousehold, key: string): FieldDef => {
  const f = allFields(stage(wh)).find((x) => x.key === key);
  if (f === undefined) throw new Error(`欄が無い: ${key}`);
  return f;
};
const edit = (wh: WorkingHousehold, key: string, v: number | string | null) => withRefreshedEstimates(fieldOf(wh, key).set(wh, v));

const wh = open("salariedCoupleTwoKids");
const hh = wh.request.input.household;
const self = hh.members.find((m) => m.kind === "self")!;
const spouse = hh.members.find((m) => m.kind === "spouse")!;
const mine = (w: WorkingHousehold, id = self.id): EmploymentPeriod[] => (w.request.input.household.employmentPeriods ?? []).filter((p) => p.member === id);
const main = mine(wh)[0]!;

describe("詳細の並び: 働き方 1・2… → ＋ 働き方を足す → 定年後の予定（今の働き方のまとまりは標準だけ）", () => {
  const sec = stage(wh).sections.find((s) => s.key === `work/${self.id}`)!;
  const keys = (level: "simple" | "detail") => sec.groups.filter((g) => groupShown(level, g)).map((g) => g.key);

  it("詳しい区画「働き方の期間（詳しく）」は無く、人ごとの区画の中に期間のまとまりがある", () => {
    expect(stage(wh).sections.some((s) => s.key === "work/periods")).toBe(false);
    const d = keys("detail");
    expect(d[0]).toBe(`work/period/${main.id}`);
    expect(d).not.toContain(`work/${self.id}/now`);
    expect(d.indexOf(`work/${self.id}/periods`)).toBeLessThan(d.indexOf(`work/${self.id}/retirement`));
    expect(d.indexOf(`work/period/${main.id}`)).toBeLessThan(d.indexOf(`work/${self.id}/periods`));
  });

  it("標準は今の働き方 → 定年後の予定（期間のまとまり・足すボタンは出さない）", () => {
    const s = keys("simple");
    expect(s[0]).toBe(`work/${self.id}/now`);
    expect(s).not.toContain(`work/period/${main.id}`);
    expect(s).not.toContain(`work/${self.id}/periods`);
  });

  it("画面: 詳細では「働き方 1（今の働き方）」が定年後の予定より上、今の働き方の見出しは出さない。足すボタンは「＋ （人の呼び名）の働き方 2」の形", () => {
    const html = panel(wh, "detail");
    const who = stage(wh).sections.find((s) => s.key === `work/${self.id}`)!.title;
    expect(html).toContain(`${who}の働き方 1（今の働き方）`);
    expect(html).not.toContain(`${who}の今の働き方<`);
    expect(html.indexOf(`${who}の働き方 1（今の働き方）`)).toBeLessThan(html.indexOf(`${who}の定年後の予定`));
    expect(html).toContain(`＋ ${who}の働き方 ${mine(wh).length + 1}`);
    expect(html).not.toContain("働き方の期間（詳しく）");
    // 同じ欄を2か所に出さない
    const growth = `id="${fieldDomId(`work/period/${main.id}/salaryGrowth`)}"`;
    expect(html.split(growth).length - 1).toBe(1);
  });

  it("住民税は詳細では今の働き方の期間のまとまり、標準では今の働き方の「▸ 詳しく」（欄の一覧には1回）", () => {
    const g = stage(wh).sections.flatMap((s) => s.groups).find((x) => x.key === `work/period/${main.id}`)!;
    expect(g.fields.some((f) => f.key === `work/${self.id}/residentTax`)).toBe(true);
    const now = stage(wh).sections.flatMap((s) => s.groups).find((x) => x.key === `work/${self.id}/now`)!;
    expect(now.fields.some((f) => f.key === `work/${self.id}/residentTax`)).toBe(false);
    expect(now.openFields?.some((f) => f.key === `work/${self.id}/residentTax`)).toBe(true);
    const all = allFields(stage(wh)).map((f) => f.key);
    expect(new Set(all).size).toBe(all.length);
  });

  it("標準⇔詳細で値は消えず、二重にならない: 詳細で賞与を直すと、標準の年収（賞与込み）に出る。働き方を足しても期間は1件ずつ", () => {
    const before = fieldOf(wh, `work/${self.id}/now/total`).get(wh).value as number;
    const bonus = main.salary?.bonus?.value ?? 0;
    const w1 = edit(wh, `work/period/${main.id}/bonus`, bonus + 100000);
    expect(fieldOf(w1, `work/${self.id}/now/total`).get(w1).value).toBe(before + 100000);
    const add = stage(w1).sections.flatMap((s) => s.groups.flatMap((g) => g.actions)).find((a) => a.key === `work/${self.id}/addPeriod`)!;
    const w2 = add.run(w1);
    expect(mine(w2).length).toBe(mine(w1).length + 1);
    expect(new Set(mine(w2).map((p) => p.id)).size).toBe(mine(w2).length);
    // 見せ方を変えても世帯は変わらない
    const req = JSON.stringify(w2.request);
    panel(w2, "simple");
    panel(w2, "detail");
    expect(JSON.stringify(w2.request)).toBe(req);
  });

  it("確かめの一覧の行は標準の欄を当て先にする（標準だけのまとまりの欄なら、詳細から開くと標準にして移る）", () => {
    const rows = checkList(wh).filter((r) => r.card === "work" && r.fieldKey !== null);
    for (const r of rows) {
      const f = allFields(stage(wh)).find((x) => x.key === r.fieldKey)!;
      // 年収は今の働き方（標準）の欄で1行
      if (f.item === "employment.salary.annual") expect(r.fieldKey?.includes("/period/") === true && rows.some((x) => x.fieldKey === `work/${self.id}/now/total`)).toBe(false);
    }
    expect(inSimpleOnlyGroup(stage(wh), `work/${self.id}/now/total`)).toBe(true);
    expect(inSimpleOnlyGroup(stage(wh), `work/period/${main.id}/annual`)).toBe(false);
  });
});

describe("標準報酬月額: 空欄は給与から計算（目安を推定の印で見せる）。片方だけ入れても2つの箱がそろう", () => {
  // 置き換え口の無い期間（給与からエンジンが毎年決め直す）
  const blank = mutate(wh, (h) => {
    for (const p of h.employmentPeriods ?? []) delete p.standardMonthlyRemuneration;
  });
  const p0 = mine(blank)[0]!;
  const smrH = `work/period/${p0.id}/smrH`;
  const smrP = `work/period/${p0.id}/smrP`;

  it("空欄は値を書かずに、今の年収の等級を推定の印で見せる（「この値にする」で書ける）", () => {
    const s = fieldOf(blank, smrP).get(blank);
    expect(s.value).toBeNull();
    expect(s.estimated).toBe(SMR_BLANK_BASIS);
    expect(s.hint).toMatch(/^今の年収なら月 [\d,]+円（推定）$/);
    expect(fieldStatus(fieldOf(blank, smrP), blank).status).toBe("estimated");
    expect(mine(blank)[0]!.standardMonthlyRemuneration).toBeUndefined();
    const w = applyStateOp(blank, fieldOf(blank, smrP), "confirm");
    const smr = mine(w)[0]!.standardMonthlyRemuneration!;
    expect(smr.pension.state).toBe("confirmed");
    expect(smr.pension.value).toBe(Number(/([\d,]+)円/.exec(s.hint ?? "")![1]!.replace(/,/g, "")));
    expect(smr.health.state).toBe("estimated");
    expect(() => preview(w.request)).not.toThrow();
  });

  it("「わからない」「該当なし」は出さない（分からなければ空欄のまま給与から計算する）", () => {
    expect(availableOps(fieldOf(blank, smrP), blank)).toEqual(["confirm"]);
    const w = edit(blank, smrP, 410000);
    expect(availableOps(fieldOf(w, smrP), w)).not.toContain("unknown");
    expect(availableOps(fieldOf(w, smrP), w)).not.toContain("notApplicable");
  });

  it("厚生年金だけ入れる: 健康保険はその額を健康保険の等級表に当てた推定。計算できる（スキーマは2つとも必須）", () => {
    const w = edit(blank, smrP, 410000);
    const smr = mine(w)[0]!.standardMonthlyRemuneration!;
    expect(smr.pension).toMatchObject({ value: 410000, state: "confirmed" });
    expect(smr.health).toMatchObject({ value: 410000, state: "estimated", origin: { kind: "auto" } });
    expect(() => preview(w.request)).not.toThrow();
    // 空にすると、もう片方は推定のままなので置き換え口ごと外す（給与から計算に戻る）
    const back = edit(w, smrP, null);
    expect(mine(back)[0]!.standardMonthlyRemuneration).toBeUndefined();
  });

  it("両方を入れてから片方を空にすると、もう片方の額から推定した箱になる", () => {
    // 同じ額を入れ直しても確定にしない（推定の値と同じ値は書き換えない）ので、厚生年金は別の額にする
    const w = edit(edit(blank, smrH, 500000), smrP, 470000);
    const back = edit(w, smrH, null);
    const smr = mine(back)[0]!.standardMonthlyRemuneration!;
    expect(smr.pension).toMatchObject({ value: 470000, state: "confirmed" });
    expect(smr.health).toMatchObject({ value: 470000, state: "estimated" });
  });

  it("前の形式の「わからない（代わりの値）」の箱が片方にある世帯: もう片方を空にしても、その箱（代わりの値）は消さない", () => {
    const manual = { kind: "manual" } as const;
    const legacy = (other: Record<string, unknown>) =>
      mutate(blank, (h) => {
        const p = h.employmentPeriods!.find((x) => x.id === p0.id)!;
        p.standardMonthlyRemuneration = { health: other, pension: { value: 410000, state: "confirmed", origin: manual } } as unknown as NonNullable<typeof p.standardMonthlyRemuneration>;
      });
    const unknown = { state: "unknown", origin: manual, substitute: { value: 380000, state: "estimated", origin: manual, estimate: { method: "standard", basis: "FP の前の値" } } };
    const w = legacy(unknown);
    expect(fieldOf(w, smrH).get(w).value).toBe(380000);
    const back = edit(w, smrP, null);
    const smr = mine(back)[0]!.standardMonthlyRemuneration!;
    // 触っていない健康保険の箱はそのまま
    expect(smr.health).toEqual(unknown);
    expect(fieldOf(back, smrH).get(back).value).toBe(380000);
    // 空にした厚生年金は、代わりの値を厚生年金の等級表に当てた推定
    expect(smr.pension).toMatchObject({ value: 380000, state: "estimated", estimate: { method: "derived" } });
    expect(() => preview(back.request)).not.toThrow();
    // 額の無い箱（該当なし）なら、空にした側は今の給与から
    const na = { state: "notApplicable", origin: manual };
    const back2 = edit(legacy(na), smrP, null);
    const smr2 = mine(back2)[0]!.standardMonthlyRemuneration!;
    expect(smr2.health).toEqual(na);
    expect(smr2.pension.state).toBe("estimated");
    expect(typeof smr2.pension.value).toBe("number");
  });

  it("勤め先の健康保険・厚生年金に入らない期間（扶養のパートなど）には目安を出さない", () => {
    const part = mine(blank, spouse.id).find((p) => p.pensionCategory === "none" || p.healthInsurance?.kind === "dependent");
    expect(part).toBeDefined();
    if (part === undefined) return;
    const s = fieldOf(blank, `work/period/${part.id}/smrP`).get(blank);
    expect(s.estimated ?? null).toBeNull();
  });
});

describe("辞め方の「自動」: 何で決まるかを選択肢に書く。定年後の予定の定年で終わる期間が自己都合になるときは知らせる", () => {
  const f = (w: WorkingHousehold) => fieldOf(w, `work/period/${main.id}/endsWith`);
  it("60歳になる前の月に終わる期間は「自動: 自己都合（60歳前に辞めるので）」", () => {
    const x = f(wh);
    expect(x.kind === "select" && x.options[0]!.label).toBe("自動: 自己都合（60歳前に辞めるので）");
  });
  it("定年後の予定があり、自動のままなら知らせと「辞め方を定年にする」。押すと定年を書く", () => {
    expect(wh.postRetirement[self.id]).toBeDefined();
    const s = f(wh).get(wh);
    expect(s.warn).toContain("自己都合で計算します");
    const fixed = s.warnFix!.run(wh);
    expect(mine(fixed)[0]!.endsWith).toBe("retirement");
    expect(f(fixed).get(fixed).warn ?? null).toBeNull();
    expect(checkList(wh).some((r) => r.fieldKey === `work/period/${main.id}/endsWith` && r.kind === "notice")).toBe(true);
  });
});
