// 打ちかけの値（欄に入ったまま、まだ決めていない文字）を、画面を変える操作の前に決める（0131）。
// 欄を離れずに起きる操作（閉じる・Esc・保存・明細を開く・タブやプランの切り替え・世帯の切り替え・アプリを閉じる・ページの読み直し）で、
// 打ちかけの値が黙って消えないこと。読めない打ち方なら決めずに止め、その欄に戻すこと
import { h, options, type VNode } from "preact";
import { renderToString } from "preact-render-to-string";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { allFields, plain, type FieldDef } from "../src/workspace/input/form.ts";
import { Field, fieldDomId } from "../src/workspace/input/FieldViews.tsx";
import { blankHousehold, fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { InputPanel } from "../src/workspace/input/InputPanel.tsx";
import { enterInput, guardPanel, noteRejected, resetPendingInput, settleBeforeLeave, settleInput } from "../src/workspace/input/pendingInput.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { modelHousehold } from "./helpers.ts";

afterEach(() => resetPendingInput());
// 元に戻すの記録が操作の場所を DOM の要素で見る（Node には無いので、空の型を置く）
const g = globalThis as { Element?: unknown };
const hadElement = "Element" in g;
beforeAll(() => {
  if (!hadElement) g.Element = class {};
});
afterAll(() => {
  if (!hadElement) delete g.Element;
});

type Props = Record<string, unknown>;
/** 描いた木の中の要素（props を持つ）を、条件に合う順に集める（画面を描かずに、部品の操作を呼ぶため） */
function capture(node: VNode<any>): VNode<Props>[] { // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: VNode<Props>[] = [];
  const prev = options.vnode;
  options.vnode = (v) => {
    if (typeof v.type === "string") out.push(v as VNode<Props>);
    prev?.(v);
  };
  try {
    renderToString(node);
  } finally {
    options.vnode = prev;
  }
  return out;
}
/** 欄の input に、打ちかけの文字を持つ要素の代わりを当てる（ref に入れる）。focus が呼ばれた回数を返す */
function typeInto(input: VNode<Props>, text: string): { focused: () => number } {
  let n = 0;
  // preact は ref を props から vnode に移す
  const ref = (input as unknown as { ref?: { current: unknown } }).ref;
  if (ref !== undefined) ref.current = { value: text, focus: () => n++ };
  (input.props.onFocus as () => void)();
  (input.props.onInput as (e: unknown) => void)({ currentTarget: { value: text } });
  return { focused: () => n };
}
const noop = () => undefined;

describe("打ちかけの値の登録（pendingInput）", () => {
  it("入っている欄があれば、操作の前にその欄の値を決める。読めなければ止めて欄に戻す", () => {
    let committed = 0;
    let focused = 0;
    const leave = enterInput({ settle: () => (committed++, "committed"), focus: () => focused++ });
    expect(settleInput()).toEqual({ ok: true, committed: true });
    expect(committed).toBe(1);
    leave();
    expect(settleInput()).toEqual({ ok: true, committed: false });
    enterInput({ settle: () => "rejected", focus: () => focused++ });
    expect(settleInput()).toEqual({ ok: false, committed: false });
    expect(focused).toBe(1);
  });
  it("欄を離れたときに読めずに前の値に戻した直後の操作は、1回だけ止めて欄に戻す（押したボタンの操作で知らせが消えないように）", () => {
    let focused = 0;
    noteRejected(() => focused++);
    expect(settleInput().ok).toBe(false);
    expect(focused).toBe(1);
    expect(settleInput().ok).toBe(true);
  });
  it("世帯を離れる・アプリを閉じる・読み直す前: 入力のパネルに保存していない変更があれば、知らせを出して止める", () => {
    let unsaved = false;
    let warned = 0;
    const off = guardPanel({ unsaved: () => unsaved, warn: () => warned++ });
    expect(settleBeforeLeave()).toEqual({ go: true, committed: false });
    unsaved = true;
    expect(settleBeforeLeave()).toEqual({ go: false, committed: false });
    expect(warned).toBe(1);
    off();
    expect(settleBeforeLeave().go).toBe(true);
    // 打ちかけの値も先に決める（読めなければパネルの知らせより先に止める）
    enterInput({ settle: () => "rejected", focus: noop });
    expect(settleBeforeLeave().go).toBe(false);
  });
});

/** 円の欄（ご本人の構成員の中に書く。テスト用） */
const yenField = plain({ key: "t/yen", item: null, label: "年金月額", level: "simple", kind: "yen", basis: "monthly", unit: "yen", find: (hh) => hh.members[0] as unknown as Record<string, unknown>, path: ["testYen"], optional: true });
const yenOf = (w: WorkingHousehold) => (w.request.input.household.members[0] as unknown as { testYen?: number }).testYen;

describe("欄の部品: 入ったまま操作が起きたら、打ちかけの値を決める", () => {
  it("円の欄に「15万」と打ったまま → 150,000円を書く。そのあと離れても二重に書かない", () => {
    const wh = blankHousehold("2026-11");
    const edits: WorkingHousehold[] = [];
    const input = capture(h(Field, { f: yenField, wh, onEdit: (w: WorkingHousehold) => edits.push(w) })).find((v) => v.type === "input")!;
    typeInto(input, "15万");
    expect(edits).toHaveLength(0);
    expect(settleInput().ok).toBe(true);
    expect(edits.map(yenOf)).toEqual([150_000]);
    // 決めた後に欄を離れても、同じ文字なので書かない
    (input.props.onBlur as (e: unknown) => void)({ currentTarget: { value: "15万" } });
    expect(edits).toHaveLength(1);
  });
  it("読めない打ち方（「1億2000」）なら書かずに止め、その欄に戻す", () => {
    const wh = blankHousehold("2026-11");
    const edits: WorkingHousehold[] = [];
    const input = capture(h(Field, { f: yenField, wh, onEdit: (w: WorkingHousehold) => edits.push(w) })).find((v) => v.type === "input")!;
    const t = typeInto(input, "1億2000");
    expect(settleInput().ok).toBe(false);
    expect(edits).toHaveLength(0);
    expect(t.focused()).toBe(1);
  });
  it("時点の欄も同じ（「70歳」と打ったまま → 決める）", () => {
    const wh = fromRequest(modelHousehold("salariedCoupleTwoKids"));
    const f = allFields(buildStage("work", wh)).find((x) => x.time !== undefined && x.kind === "when") ?? allFields(buildStage("work", wh)).find((x) => x.time !== undefined)!;
    const edits: WorkingHousehold[] = [];
    const input = capture(h(Field, { f, wh, onEdit: (w: WorkingHousehold) => edits.push(w) })).find((v) => v.type === "input" && v.props.class !== undefined && String(v.props.class).includes("when-in"))!;
    typeInto(input, "62歳");
    expect(settleInput().ok).toBe(true);
    expect(edits.length).toBeGreaterThan(0);
    expect(edits.at(-1)).not.toBe(wh);
  });
});

/** 保険の入力項目のパネルを描き、保険料（円の欄）の input と、閉じる・保存のボタンを取り出す */
function insurancePanel(onSave: (w: WorkingHousehold) => void, onClose: () => void) {
  const wh = fromRequest(modelHousehold("salariedCoupleTwoKids"));
  const premium = allFields(buildStage("insurance", wh)).find((f): f is FieldDef & { kind: "yen" } => f.kind === "yen" && f.unit === "yen" && f.get(wh).value !== null)!;
  const nodes = capture(h(InputPanel, { wh, itemId: "insurance", level: "simple", onLevel: noop, onSave: (w: WorkingHousehold) => onSave(w), onClose }));
  const input = nodes.find((v) => v.type === "input" && v.props.id === fieldDomId(premium.key))!;
  const closeBtn = nodes.find((v) => v.type === "button" && v.props["aria-label"] === "閉じる（Esc）")!;
  const saveBtn = nodes.find((v) => v.type === "button" && v.props["data-save"] !== undefined)!;
  const scrim = nodes.find((v) => v.type === "div" && v.props.class === "scrim")!;
  return { wh, premium, input, closeBtn, saveBtn, scrim };
}

describe("入力のパネル: 欄に入ったまま閉じる・保存しても、打ちかけの値は黙って消えない", () => {
  it("保存: 打ちかけの「2万」を決めてから保存する（保存する世帯に 20,000円が入る）", () => {
    const saved: WorkingHousehold[] = [];
    const p = insurancePanel((w) => saved.push(w), noop);
    typeInto(p.input, "2万");
    (p.saveBtn.props.onClick as () => void)();
    expect(saved).toHaveLength(1);
    expect(p.premium.get(saved[0]!).value).toBe(20_000);
  });
  it("保存: 読めない打ち方なら保存しない（欄に戻す）", () => {
    const saved: WorkingHousehold[] = [];
    const p = insurancePanel((w) => saved.push(w), noop);
    const t = typeInto(p.input, "2万x");
    (p.saveBtn.props.onClick as () => void)();
    expect(saved).toHaveLength(0);
    expect(t.focused()).toBe(1);
  });
  it("閉じるボタン・外側を押す・Esc（同じ閉じる処理）: 打ちかけの値を決め、変わったなら「保存していない変更があります」で止める（すぐ閉じない）", () => {
    for (const which of ["closeBtn", "scrim"] as const) {
      let closed = 0;
      const p = insurancePanel(noop, () => closed++);
      typeInto(p.input, "2万");
      (p[which].props.onClick as () => void)();
      expect(closed, which).toBe(0);
      resetPendingInput();
    }
  });
  it("閉じるボタン: 読めない打ち方なら閉じずに欄に戻す", () => {
    let closed = 0;
    const p = insurancePanel(noop, () => closed++);
    const t = typeInto(p.input, "abc");
    (p.closeBtn.props.onClick as () => void)();
    expect(closed).toBe(0);
    expect(t.focused()).toBe(1);
  });
  it("閉じるボタン: 何も打っていなければ、そのまま閉じる", () => {
    let closed = 0;
    const p = insurancePanel(noop, () => closed++);
    (p.closeBtn.props.onClick as () => void)();
    expect(closed).toBe(1);
  });
});
