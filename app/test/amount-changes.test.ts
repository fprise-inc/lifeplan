// 額の変化（0040 の 2026-10-29 の追記）: 段階と例外の年を、画面では1つの「＋ ○○の変化」から足す。押すと「この年だけ」（例外の年）か
// 「この月から先」（段。年ごとの物は「この年から先」）を選ぶ。世帯ファイルの形は変えない。足した変化は時期の順に、行の額の近く（見込みの欄の前）に並べる
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import type { EngineRequest } from "../src/engine/types.ts";
import { actionUnits, fieldDomId, type GroupOpenState } from "../src/workspace/input/FieldViews.tsx";
import type { ActionDef, GroupDef, StageDef } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { InputPanel } from "../src/workspace/input/InputPanel.tsx";
import { addIncome } from "../src/workspace/input/moneyRows.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { full, modelHousehold } from "./helpers.ts";
import { maintenanceLabels } from "../src/workspace/input/stages/housing.ts";

const noop = () => undefined;
const open = (m: string): WorkingHousehold => fromRequest(modelHousehold(m), {});
const groupsOf = (st: StageDef): GroupDef[] => st.sections.flatMap((s) => s.groups);
const actionsOf = (st: StageDef): ActionDef[] => st.sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)]);
const act = (wh: WorkingHousehold, stage: Parameters<typeof buildStage>[0], key: string): WorkingHousehold => {
  const a = actionsOf(buildStage(stage, wh)).find((x) => x.key === key);
  if (a === undefined) throw new Error(`ボタンが無い: ${key}`);
  return a.run(wh);
};
const panel = (wh: WorkingHousehold, card: string, level: "simple" | "detail", keys: readonly string[] = []) => {
  const groupOpen: GroupOpenState = { isOpen: (k) => keys.includes(k), toggle: noop };
  return renderToString(h(InputPanel, { wh, itemId: card, level, onLevel: noop, onSave: noop, onClose: noop, groupOpen }));
};
const sideJob = (): { wh: WorkingHousehold; id: string } => {
  const wh = addIncome(open("salariedCoupleTwoKids"), "sideJob", "00000000-0000-4000-8000-000000000041");
  return { wh, id: "00000000-0000-4000-8000-000000000041" };
};

describe("1つのボタン「＋ ○○の変化」と2つの選択肢", () => {
  it("入るお金の行: 「＋ 年額の変化」の中に「この年だけ」「この月から先」。「?」は1つで、2つの違いを書く", () => {
    const { wh, id } = sideJob();
    const acts = actionsOf(buildStage("work", wh)).filter((a) => a.choice?.key === `in/${id}/addChange`);
    expect(acts.map((a) => [a.key, a.label])).toEqual([
      [`in/${id}/addException`, "この年だけ"],
      [`in/${id}/addStage`, "この月から先"],
    ]);
    const units = actionUnits(acts);
    expect(units).toHaveLength(1);
    const u = units[0]!;
    expect(u.kind).toBe("choice");
    if (u.kind !== "choice") return;
    expect(u.head.label).toBe("＋ 年額の変化");
    expect(u.head.help).toContain("「この年だけ」は、その年（1〜12月）だけ別の額にします（0円ならその年は受け取りません）");
    expect(u.head.help).toContain("「この月から先」は、その月から後ずっと別の額にします");
    expect(u.head.help).toContain("次の変化まで何年かけて移すか");
    // 段階・例外の年の2つのボタンはもう無い
    expect(actionsOf(buildStage("work", wh)).some((a) => a.label.includes("の段階") || a.label.includes("の例外の年"))).toBe(false);
  });

  it("呼び方は行の額に合わせる: 毎月は「＋ 月額の変化」、数年ごとは「＋ 3年ごとの額の変化」、出るお金の行も同じ", () => {
    const w1 = open("dualAssetsTwoKids");
    const p = w1.request.input.household.periodicExpenses![0]!;
    const head = (wh: WorkingHousehold, stage: Parameters<typeof buildStage>[0], key: string) => actionsOf(buildStage(stage, wh)).find((a) => a.choice?.key === key)?.choice?.label;
    expect(head(w1, "events", `ev/${p.id}/addChange`)).toBe(p.everyYears > 1 ? `＋ ${p.everyYears}年ごとの額の変化` : "＋ 年額の変化");
    expect(actionsOf(buildStage("events", w1)).find((a) => a.choice?.key === `ev/${p.id}/addChange`)?.choice?.help).toContain("0円ならその年は払いません");
    const { wh, id } = sideJob();
    const cadence = groupsOf(buildStage("work", wh)).flatMap((g) => g.fields).find((f) => f.key === `in/${id}/cadence`)!;
    expect(head(cadence.set(wh, "monthly"), "work", `in/${id}/addChange`)).toBe("＋ 月額の変化");
    const every = groupsOf(buildStage("work", wh)).flatMap((g) => g.fields).find((f) => f.key === `in/${id}/every`)!;
    expect(head(every.set(wh, 3), "work", `in/${id}/addChange`)).toBe("＋ 3年ごとの額の変化");
  });

  it("1回だけの入るお金の行には出さない（出るお金の1回だけの行と同じ）", () => {
    const { wh, id } = sideJob();
    const cadence = groupsOf(buildStage("work", wh)).flatMap((g) => g.fields).find((f) => f.key === `in/${id}/cadence`)!;
    const once = cadence.set(wh, "once");
    expect(actionsOf(buildStage("work", once)).some((a) => a.choice?.key === `in/${id}/addChange`)).toBe(false);
  });

  it("年ごとの物（固定資産税・経費の年額・利回り）は「この年から先」", () => {
    const wh = open("dualAssetsTwoKids");
    const res = wh.request.input.household.residences!.find((r) => r.kind === "own")!;
    const tax = actionsOf(buildStage("housing", wh)).filter((a) => a.choice?.key === `housing/res/${res.id}/propertyTax/addChange`);
    expect(tax.map((a) => a.label)).toEqual(["この年だけ", "この年から先"]);
    expect(tax[0]?.choice?.label).toBe("＋ 固定資産税の変化");
    expect(tax[0]?.choice?.help).toContain("0円ならその年は払いません");
    const maint = actionsOf(buildStage("housing", wh)).filter((a) => a.choice?.key === `housing/res/${res.id}/maintenance/addChange`);
    expect(maint.map((a) => a.label)).toEqual(["この年だけ", "この月から先"]);
    const ret = actionsOf(buildStage("savings", wh)).filter((a) => a.choice?.key.endsWith("/addReturnChange"));
    expect(ret.length).toBeGreaterThan(0);
    expect(ret[0]?.choice?.label).toMatch(/^＋ .+の利回りの変化$/);
    expect(ret.slice(0, 2).map((a) => a.label)).toEqual(["この年だけ", "この年から先"]);
  });

  it("選んだ後は今までの段・例外の年の形のまま（世帯ファイルの形は変えない）", () => {
    const { wh, id } = sideJob();
    let w = act(wh, "work", `in/${id}/addException`);
    w = act(w, "work", `in/${id}/addStage`);
    const f = w.request.input.household.incomeFlows!.find((x) => x.id === id)!;
    expect(f.exceptions).toHaveLength(1);
    expect(Object.keys(f.exceptions![0]!).sort()).toEqual(["amount", "id", "year"]);
    expect(f.stages).toHaveLength(1);
    expect(Object.keys(f.stages![0]!).sort()).toEqual(["amount", "at", "id"]);
    expect(() => full(w.request as EngineRequest)).not.toThrow();
  });
});

describe("足した変化の並びと置き場所", () => {
  it("時期の順に並べる（例外の年はその年の1月、段は「いつから」の年月。同じ月なら段が先）", () => {
    const { wh, id } = sideJob();
    const base = Number(wh.request.input.baseMonth.slice(0, 4));
    // 例外の年（基準の年の翌年）と、段（基準の月の1年後）・その後の段（2年後）
    let w = act(wh, "work", `in/${id}/addStage`);
    w = act(w, "work", `in/${id}/addStage`);
    w = act(w, "work", `in/${id}/addException`);
    const titles = groupsOf(buildStage("work", w))
      .filter((g) => g.key.startsWith(`in/${id}/stage/`) || g.key.startsWith(`in/${id}/except/`))
      .map((g) => g.title);
    const m = Number(wh.request.input.baseMonth.slice(5, 7));
    const after = m === 1 ? [`年額の変化（${base + 1}年${m}月から先）`, `年額の変化（${base + 1}年だけ）`] : [`年額の変化（${base + 1}年だけ）`, `年額の変化（${base + 1}年${m}月から先）`];
    expect(titles).toEqual([...after, `年額の変化（${base + 2}年${m}月から先）`]);
    // 次の段まで何年かけて移すかは、段の中で次の段がある段だけ（今のまま）
    const ramps = groupsOf(buildStage("work", w)).flatMap((g) => g.fields).filter((f) => f.key.startsWith(`in/${id}/stage/`) && f.key.endsWith("/ramp"));
    expect(ramps).toHaveLength(1);
    expect(ramps[0]?.label).toBe("ここから次の段まで何年かけて移すか");
  });

  it("行のまとまりの中、見込みの欄の前に描く（詳細）", () => {
    const { wh, id } = sideJob();
    const w = act(act(wh, "work", `in/${id}/addException`), "work", `in/${id}/addStage`);
    const g = groupsOf(buildStage("work", w)).find((x) => x.key.startsWith(`in/${id}/except/`))!;
    expect(g.placeIn).toEqual({ group: `in/${id}`, before: `in/${id}/likelihood` });
    const html = panel(w, "work", "detail");
    const amount = html.indexOf(`id="${fieldDomId(`in/${id}/amount`)}"`);
    const change = html.indexOf("年額の変化（");
    const button = html.indexOf(`data-choice="in/${id}/addChange"`);
    const likely = html.indexOf(`id="${fieldDomId(`in/${id}/likelihood`)}"`);
    const tax = html.indexOf(`id="${fieldDomId(`in/${id}/tax`)}"`);
    const cost = html.indexOf(`id="${fieldDomId(`in/${id}/cost`)}"`);
    expect(amount).toBeGreaterThan(0);
    expect(amount).toBeLessThan(change);
    expect(change).toBeLessThan(button);
    expect(button).toBeLessThan(likely);
    // 副業の所得の区分は行のまとまりの中（0086）。必要経費などの詳細のまとまりは、その後のまま
    expect(tax).toBeGreaterThan(0);
    expect(tax).toBeLessThan(likely);
    expect(likely).toBeLessThan(cost);
  });

  it("標準: 閉じている間は出さず、「▸ 続きを見る」を開くと行のまとまりの中に出る（開いた物の印 data-more-of つき）", () => {
    const { wh, id } = sideJob();
    const w = act(wh, "work", `in/${id}/addException`);
    expect(panel(w, "work", "simple")).not.toContain("年額の変化（");
    const html = panel(w, "work", "simple", [`in/${id}`]);
    expect(html).toContain("年額の変化（");
    expect(html).toMatch(new RegExp(`<div class="in-group in-sub" data-group="[^"]+" data-more-of="in/${id}"><div class="in-group-h"><h4>年額の変化（`));
    expect(html).toContain(`data-choice="in/${id}/addChange"`);
    // 押す前は選択肢を出さない
    expect(html).not.toContain(`data-action="in/${id}/addStage"`);
  });

  it("住まい: 額の変化は、その額の変動率の欄のすぐ後に描く", () => {
    const wh = open("dualAssetsTwoKids");
    const res = wh.request.input.household.residences!.find((r) => r.kind === "own")!;
    const k = `housing/res/${res.id}`;
    const w = act(wh, "housing", `${k}/maintenance/addStage`);
    const html = panel(w, "housing", "detail");
    // 呼び方は建て方で変わる（マンションは管理費・修繕積立金、戸建ては修繕の積み立て）
    const what = maintenanceLabels(res).what;
    const growth = html.indexOf(`id="${fieldDomId(`${k}/maintGrowth`)}"`);
    const change = html.indexOf(`${what}の変化（`);
    expect(growth).toBeGreaterThan(0);
    expect(growth).toBeLessThan(change);
    expect(groupsOf(buildStage("housing", w)).find((g) => g.key === k)?.note).toContain(`${what}の変化 1件`);
    // 標準で「▸ 続きを見る」を開いたとき: 変動率の欄は開いた中身の中にあるので、変化もその中（変動率の欄の後）に描く
    const opened = panel(w, "housing", "simple", [k]);
    const body = opened.indexOf(`<div class="grp-more-body" data-more-of="${k}">`);
    const g2 = opened.indexOf(`id="${fieldDomId(`${k}/maintGrowth`)}"`);
    const c2 = opened.indexOf(`${what}の変化（`);
    expect(body).toBeGreaterThan(0);
    expect(body).toBeLessThan(g2);
    expect(g2).toBeLessThan(c2);
  });
});
