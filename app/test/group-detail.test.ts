// まとまりごとの「▸ 詳しく」（0078 の追記）: 標準のまま、物1件・1組の欄の詳細だけを開く。開け閉めは見せ方だけで、値は消さない
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { fieldDomId, groupUnits, headsWithMore, type GroupOpenState } from "../src/workspace/input/FieldViews.tsx";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { InputPanel } from "../src/workspace/input/InputPanel.tsx";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { modelHousehold } from "./helpers.ts";

const noop = () => undefined;
const open = (m: string): WorkingHousehold => fromRequest(modelHousehold(m), {});
const opened = (keys: readonly string[]): GroupOpenState => ({ isOpen: (k) => keys.includes(k), toggle: noop });
const panel = (wh: WorkingHousehold, card: string, level: "simple" | "detail", keys: readonly string[] = []) =>
  renderToString(h(InputPanel, { wh, itemId: card, level, onLevel: noop, onSave: noop, onClose: noop, groupOpen: opened(keys) }));
const idOf = (key: string) => `id="${fieldDomId(key)}"`;

const wh = open("salariedCoupleTwoKids");
const debt = wh.request.input.household.debts?.find((d) => d.kind === "mortgage");
const loanKey = `housing/debt/${debt?.id ?? ""}`;
const housing = buildStage("housing", wh);
const loanSec = housing.sections.find((s) => s.key === "housing/loans");
// 住宅ローン1件の欄は、1件の枠の中の中枠（借入の内容・金利・返済…。band）に分けて並べる（0077 の追記）
const loanBands = (loanSec?.groups ?? []).filter((g) => g.band === true && g.key.startsWith(`${loanKey}/band/`));
const detailOfLoan = loanBands.flatMap((g) => g.fields).filter((f) => f.level === "detail");

describe("物1件ごとの単位", () => {
  it("住宅ローン1件: 金利の段階・ボタンのまとまりは、そのローンに属する", () => {
    const units = groupUnits(loanSec?.groups ?? []);
    expect(units.get(loanKey)).toBe(loanKey);
    expect(units.get(`${loanKey}/rate/1`)).toBe(loanKey);
    expect(units.get(`${loanKey}/band/rate`)).toBe(loanKey);
    expect(units.get(`${loanKey}/band/prepay`)).toBe(loanKey);
    expect(headsWithMore(loanSec?.groups ?? []).has(loanKey)).toBe(true);
    expect(detailOfLoan.length).toBeGreaterThan(0);
  });
});

describe("標準のときだけ「▸ 詳しく」", () => {
  it("標準: ローン1件の下に「▸ 詳しく」。閉じている間は詳細の欄と金利の段階を出さない", () => {
    const html = panel(wh, "housing", "simple");
    expect(html).toContain(`data-group-more="${loanKey}"`);
    expect(html).toContain("▸ 詳しく");
    for (const f of detailOfLoan) expect(html).not.toContain(idOf(f.key));
    expect(html).not.toContain("金利の段階 2");
  });
  it("開くと、そのローンの詳細の欄・金利の段階・ボタンだけが出る（ほかのまとまりは標準のまま）", () => {
    const html = panel(wh, "housing", "simple", [loanKey]);
    expect(html).toContain("▾ 詳しく（閉じる）");
    expect(html).toContain('aria-expanded="true"');
    for (const f of detailOfLoan) expect(html).toContain(idOf(f.key));
    expect(html).toContain("金利の段階 2");
    expect(html).toContain('data-action="' + `${loanKey}/addPrepay` + '"');
    // 住まいの詳細（持ち家の評価）は開いていない（標準／詳細の「?」の中の「詳細で増える主な欄」の名前は除いて見る）
    expect(html.replace(/<span class="help" data-help="level">[\s\S]*?<\/span><\/span>/, "")).not.toContain("持ち家の評価");
  });
  it("詳細: 「▸ 詳しく」は出さず、今のまま全部出す", () => {
    const html = panel(wh, "housing", "detail");
    expect(html).not.toContain("data-group-more");
    for (const f of detailOfLoan) expect(html).toContain(idOf(f.key));
  });
  it("保険1契約・家族1人・生活費にも出る", () => {
    const ins = wh.request.input.household.insuranceContracts?.[0];
    expect(panel(wh, "insurance", "simple")).toContain(`data-group-more="ins/${ins?.id ?? ""}"`);
    const self = wh.request.input.household.members.find((m) => m.kind === "self");
    expect(panel(wh, "family", "simple")).toContain(`data-group-more="family/${self?.id ?? ""}"`);
    expect(panel(wh, "living", "simple")).toContain("data-group-more=");
  });
});

describe("口座1つ（貯蓄・運用）", () => {
  const acc = wh.request.input.household.accounts?.find((a) => a.kind === "nisa");
  const key = `sav/${acc?.id ?? ""}`;
  it("標準: 口座の行に「▸ 詳しく」。開くと表の下の行にその口座の詳細と資産の配分", () => {
    const closed = panel(wh, "savings", "simple");
    expect(closed).toContain(`data-group-more="${key}"`);
    expect(closed).not.toContain("sv-more-row");
    const html = panel(wh, "savings", "simple", [key]);
    expect(html).toContain(`<tr class="sv-more-row" data-more-of="${key}">`);
    expect(html).toContain("資産の配分 1");
    // 口座ごとの詳細の区画（全部の口座）は出さない
    expect(html).not.toContain('aria-label="口座ごとの詳細"');
  });
  it("詳細: 口座の「▸ 詳しく」は出さない", () => {
    expect(panel(wh, "savings", "detail", [key])).not.toContain("data-group-more");
  });
});

describe("働き方の期間（今の働き方）", () => {
  const self = wh.request.input.household.members.find((m) => m.kind === "self");
  const now = buildStage("work", wh).sections.flatMap((s) => s.groups).find((g) => g.key === `work/${self?.id ?? ""}/now`);
  const extra = now?.openFields ?? [];
  it("今の働き方の「▸ 詳しく」は、その期間の詳しい欄（期間の形・年収の分け方は出さない）", () => {
    expect(extra.length).toBeGreaterThan(3);
    const items = extra.map((f) => f.item);
    for (const x of ["employment.type", "employment.salary.annual", "employment.salary.bonus", "employment.from", "employment.to"]) expect(items).not.toContain(x);
    expect(items).toContain("employment.salary.growth");
  });
  it("開くと出る。詳細では期間の欄に1回だけ出す（同じ欄を2か所に出さない）", () => {
    const growth = extra.find((f) => f.item === "employment.salary.growth") as FieldDef;
    expect(panel(wh, "work", "simple")).not.toContain(idOf(growth.key));
    expect(panel(wh, "work", "simple", [now?.key ?? ""])).toContain(idOf(growth.key));
    expect(panel(wh, "work", "detail", [now?.key ?? ""]).split(idOf(growth.key)).length - 1).toBe(1);
  });
  it("欄の一覧（確かめの一覧・推定の一覧の元）に、開いたときだけの欄を重ねない", () => {
    const keys = allFields(buildStage("work", wh)).map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("値は消さない", () => {
  it("開いて入れた詳細の値は、閉じても・標準のままでも世帯に残る（見せ方だけで、世帯は変えない）", () => {
    const f = detailOfLoan.find((x) => x.kind === "pct" && x.label.includes("ボーナス")) as FieldDef;
    const edited = f.set(wh, "0.3");
    const back = buildStage("housing", edited).sections.flatMap((s) => s.groups).flatMap((g) => g.fields).find((x) => x.key === f.key) as FieldDef;
    expect(back.get(edited).value).toBe("0.3");
    const before = JSON.stringify(edited.request);
    panel(edited, "housing", "simple", [loanKey]);
    panel(edited, "housing", "simple");
    panel(edited, "housing", "detail");
    expect(JSON.stringify(edited.request)).toBe(before);
    expect(debtOf(edited)?.repayment.bonusShare).toBe("0.3");
  });
});

const debtOf = (w: WorkingHousehold) => w.request.input.household.debts?.find((d) => d.id === debt?.id);
