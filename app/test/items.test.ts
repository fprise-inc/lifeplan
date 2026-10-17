// 入力のホーム: カードの状態（入力済み・推定あり・未入力）・進み具合の数・要約の数字・見出しの区切り・FP が足した項目
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { REPO_DIR } from "../scripts/lib.ts";
import { allFields, type FieldDef, type StageDef } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { InputView } from "../src/workspace/input/InputView.tsx";
import { ADD_OPTIONS, addItem, GROUP_HEADINGS_FROM, groupedItems, inputItems, itemStage, progressOf, saveItem, statusOf, type InputItem } from "../src/workspace/input/items.ts";
import { STAGE_ORDER } from "../src/workspace/input/stages/index.ts";
import { modelHousehold, preview } from "./helpers.ts";

const MODELS = readdirSync(join(REPO_DIR, "data", "modelHouseholds"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""))
  .sort();

const seq = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
const open = (id: string, memo: string[] = []) => fromRequest(modelHousehold(id), { memo });
const byId = (items: InputItem[], id: string) => items.find((i) => i.id === id) as InputItem;
const sumText = (i: InputItem) => (i.summary === null ? null : `${i.summary.pre ?? ""}${i.summary.main}${i.summary.unit ?? ""}`);
const fieldOf = (stage: StageDef | null, suffix: string): FieldDef => allFields(stage as StageDef).find((f) => f.key.endsWith(suffix)) as FieldDef;

/** 足した項目をまとめて足す（保存まで） */
function withAdded(wh: WorkingHousehold, keys: string[], id = seq()): WorkingHousehold {
  let w = wh;
  for (const k of keys) {
    const r = addItem(w, k, id);
    if (r === null) throw new Error(k);
    w = saveItem(r.wh, r.itemId);
  }
  return w;
}

describe("カードの状態", () => {
  it("推定の欄が残る間は（保存しても）推定あり。物があるか保存していれば入力済み。どちらでもなければ未入力", () => {
    expect(statusOf(2, true, true)).toBe("est");
    expect(statusOf(1, false, false)).toBe("est");
    expect(statusOf(0, true, false)).toBe("done");
    expect(statusOf(0, false, true)).toBe("done");
    expect(statusOf(0, false, false)).toBe("none");
  });

  it("モデル世帯: 物がある項目は入力済み、車・FP顧問料は未入力（12項目中10項目）", () => {
    const items = inputItems(open("salariedCoupleTwoKids"));
    expect(items.map((i) => i.label)).toEqual(STAGE_ORDER.map((s) => s.label));
    expect(items.filter((i) => i.status === "none").map((i) => i.id)).toEqual(["car", "fee"]);
    expect(progressOf(items)).toEqual({ total: 12, done: 10, est: 0, none: 2 });
  });

  it("空の世帯: 家族（仮の生年月・性別）と基本生活費（統計の目安）は推定あり。前提条件は入力済み。ほかは未入力", () => {
    const wh = blankHousehold("2026-10", seq());
    const items = inputItems(wh);
    expect(byId(items, "family")).toMatchObject({ status: "est", estimated: 2 });
    expect(byId(items, "living")).toMatchObject({ status: "est", estimated: 1 });
    expect(byId(items, "assumptions").status).toBe("done");
    expect(progressOf(items)).toEqual({ total: 12, done: 1, est: 2, none: 9 });
  });

  it("保存しても推定の欄が残る間は推定あり。推定の欄を入れ直すと入力済みになる", () => {
    const wh = blankHousehold("2026-10", seq());
    const saved = saveItem(wh, "family");
    expect(saved.confirmed).toEqual(["family"]);
    expect(byId(inputItems(saved), "family")).toMatchObject({ status: "est", estimated: 2 });
    const stage = itemStage(saved, "family");
    const w1 = fieldOf(stage, "/birth").set(saved, "1985-06");
    expect(byId(inputItems(w1), "family")).toMatchObject({ status: "est", estimated: 1 });
    const w2 = fieldOf(itemStage(w1, "family"), "/sex").set(w1, "female");
    expect(byId(inputItems(w2), "family")).toMatchObject({ status: "done", estimated: 0 });
    expect(progressOf(inputItems(w2))).toMatchObject({ done: 2, est: 1 });
  });

  it("物が無い項目も、保存すると入力済み（なし）になる", () => {
    const wh = blankHousehold("2026-10", seq());
    expect(byId(inputItems(wh), "insurance")).toMatchObject({ status: "none", summary: null });
    const saved = saveItem(wh, "insurance");
    expect(byId(inputItems(saved), "insurance")).toMatchObject({ status: "done", summary: null });
    expect(progressOf(inputItems(saved))).toEqual({ total: 12, done: 2, est: 2, none: 8 });
  });

  it("状態の数は、どのモデル世帯でも合計がカードの数になる", () => {
    for (const id of MODELS) {
      const p = progressOf(inputItems(open(id)));
      expect(p.done + p.est + p.none, id).toBe(p.total);
      expect(p.total, id).toBe(12);
    }
  });
});

describe("要約の数字1つ", () => {
  it("会社員の夫婦と子2人", () => {
    const items = inputItems(open("salariedCoupleTwoKids"));
    expect(sumText(byId(items, "family"))).toBe("4人");
    expect(sumText(byId(items, "work"))).toMatch(/^年収 [\d,]+万円$/);
    expect(sumText(byId(items, "living"))).toBe("月30万円");
    expect(sumText(byId(items, "education"))).toBe("2人・私立あり");
    expect(sumText(byId(items, "housing"))).toBe("残高 2,240万円");
    expect(sumText(byId(items, "assumptions"))).toBe("物価 1.0%");
  });
  it("車・FP顧問料・ほかの型", () => {
    expect(sumText(byId(inputItems(open("unexplainedSpending")), "car"))).toBe("1台");
    expect(sumText(byId(inputItems(open("lifetime100Plan")), "fee"))).toBe("年12万円");
    expect(sumText(byId(inputItems(open("marketDropAtRetirement")), "housing"))).toBe("家賃 月24万円");
    expect(sumText(byId(inputItems(open("deferral")), "pension"))).toMatch(/^月[\d.]+万円（70歳から）$/);
  });
});

describe("＋ 項目を追加", () => {
  it("今ある型の物を1件作り、「FPが追加」の同じ形のカードにする。保存するまでは下書き", () => {
    const wh = open("salariedCoupleTwoKids");
    const r = addItem(wh, "pet", seq())!;
    expect(wh.addedItems).toEqual([]);
    const card = byId(inputItems(r.wh), r.itemId);
    expect(card).toMatchObject({ label: "ペット", art: "pet", group: "flows", status: "est", estimated: 1 });
    expect(card.added).not.toBeNull();
    expect(sumText(card)).toBe("年18万円");
    expect(() => preview(r.wh.request)).not.toThrow();
    // 額を入れると確定（入力済み）
    const saved = saveItem(r.wh, r.itemId);
    const amount = fieldOf(itemStage(saved, r.itemId), "/amount");
    const w = amount.set(saved, 240000);
    expect(byId(inputItems(w), r.itemId)).toMatchObject({ status: "done", estimated: 0 });
    expect(progressOf(inputItems(w)).total).toBe(13);
  });

  it("足した物は、元の項目のカードには出さない（どの物も、どれか1つのカードにだけ出る）", () => {
    for (const id of ["salariedCoupleTwoKids", "unexplainedSpending", "lifetime100Plan", "parentCare"]) {
      const wh = withAdded(open(id), ADD_OPTIONS.map((o) => o.key));
      const items = inputItems(wh);
      expect(items).toHaveLength(12 + ADD_OPTIONS.length);
      const keys = items.flatMap((i) => (itemStage(wh, i.id) as StageDef).sections.flatMap((s) => s.groups.map((g) => g.key)));
      expect(new Set(keys).size, id).toBe(keys.length);
      expect(() => preview(wh.request)).not.toThrow();
    }
  });

  it("足した項目のカードの物を外して保存すると、カードがなくなる", () => {
    const wh = withAdded(open("salariedCoupleTwoKids"), ["car"]);
    const card = inputItems(wh).find((i) => i.added !== null)!;
    const stage = itemStage(wh, card.id) as StageDef;
    const remove = stage.sections[0]!.groups[0]!.actions.find((a) => a.danger === true)!;
    const removed = remove.run(wh);
    expect(byId(inputItems(removed), card.id).summary).toBeNull();
    const saved = saveItem(removed, card.id);
    expect(saved.addedItems).toEqual([]);
    expect(saved.confirmed).not.toContain(card.id);
    expect(inputItems(saved)).toHaveLength(12);
  });

  it("足した項目の欄も、世帯データ → 入力の表示 → 世帯データ の往復で変わらない", () => {
    const wh = withAdded(open("salariedCoupleTwoKids"), ADD_OPTIONS.map((o) => o.key));
    for (const item of inputItems(wh).filter((i) => i.added !== null)) {
      const stage = itemStage(wh, item.id) as StageDef;
      const fields = allFields(stage);
      expect(fields.length, item.label).toBeGreaterThan(2);
      for (const f of fields) {
        const st = f.get(wh);
        // 推定・仮の値を同じ値で入れ直すと「確定」になる（往復の対象の外。input.test.ts と同じ）
        if (st.estimated != null || st.assumed != null) {
          const w = f.set(wh, st.value);
          expect(f.get(w).estimated ?? f.get(w).assumed ?? null, f.key).toBeNull();
          continue;
        }
        expect(JSON.stringify(f.set(wh, st.value)), f.key).toBe(JSON.stringify(wh));
      }
    }
  });
});

describe("まとまりの見出し", () => {
  it("12項目のときは見出しを出さない。項目が増えたら、家族と収入／お金の出入り／資産と備え／前提で区切る", () => {
    const wh = open("salariedCoupleTwoKids");
    expect(groupedItems(inputItems(wh)).map((g) => g.group)).toEqual([null]);
    const more = withAdded(wh, ["pet", "abroad", "car", "fee"]);
    const items = inputItems(more);
    expect(items.length).toBeGreaterThanOrEqual(GROUP_HEADINGS_FROM);
    const groups = groupedItems(items);
    expect(groups.map((g) => g.group?.label)).toEqual(["家族と収入", "お金の出入り", "資産と備え", "前提"]);
    expect(groups[1]!.items.map((i) => i.label)).toEqual(["基本生活費", "子ども・教育", "住まい・ローン", "ライフイベント", "車", "FP顧問料", "ペット", "留学", expect.stringMatching(/^車（/), expect.stringMatching(/^FP顧問料（/)]);
    expect(groups.flatMap((g) => g.items)).toHaveLength(items.length);
  });
});

describe("入力のホームの描画", () => {
  it("カード・進み具合・状態の文字を出し、FP用のメモは画面に出さない", () => {
    const wh = open("salariedCoupleTwoKids", ["MEMO-MARK-home"]);
    const html = renderToString(h(InputView, { wh, onSave: () => undefined, level: "simple", onLevel: () => undefined }));
    expect(html).toContain("12項目中 <span class=\"n\">10</span>項目 入力済み");
    expect(html).toContain("入力済み");
    expect(html).toContain("まだ入っていません");
    expect(html).toContain("項目を追加");
    expect(html).not.toContain("MEMO-MARK-home");
    expect((html.match(/data-card=/g) ?? []).length).toBe(12);
  });
  it("パネルを開いた状態（中央のパネル・背景を暗くする・保存のボタン）", () => {
    const wh = blankHousehold("2026-10", seq());
    const html = renderToString(h(InputView, { wh, onSave: () => undefined, level: "simple", onLevel: () => undefined, initialOpen: "family" }));
    expect(html).toContain('class="scrim"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("推定・仮の値のままの欄が 2つ あります。保存しても、推定の欄が残る間はカードは「推定あり」のままです。");
    expect(html).toContain("data-save");
  });
});
