// 相続・贈与の「税理士などが出した相続税の額」（0039 の追記 2026-11-10）: 計算の前提（相続税の目安の設定）から分けた別の区画で、ふだんは閉じておく。
// 閉じている間は説明と「＋ 税理士などが出した額を入れる」だけ。額が入っている世帯は初めから開く。万一のタブの死亡の想定の欄は、その想定があるときだけ
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { fieldDomId, type GroupOpenState } from "../src/workspace/input/FieldViews.tsx";
import { allFields, type FieldDef, type StageDef } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { InputPanel } from "../src/workspace/input/InputPanel.tsx";
import { addMember } from "../src/workspace/input/stages/family.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { TAX_OVERRIDE_GROUP, TAX_OVERRIDE_OPEN, TAX_OVERRIDE_TITLE } from "../src/workspace/input/stages/inheritance.ts";
import { modelHousehold } from "./helpers.ts";

const BASE = "2026-10";
const seq = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
const noop = () => undefined;
const stage = (wh: WorkingHousehold): StageDef => buildStage("inheritance", wh);
const section = (wh: WorkingHousehold, key: string) => stage(wh).sections.find((s) => s.key === key);
const fieldOf = (wh: WorkingHousehold, key: string): FieldDef => {
  const f = allFields(stage(wh)).find((x) => x.key === key);
  if (f === undefined) throw new Error(`no field ${key}`);
  return f;
};
const opened = (keys: readonly string[]): GroupOpenState => ({ isOpen: (k) => keys.includes(k), toggle: noop });
const panel = (wh: WorkingHousehold, keys: readonly string[] = []) => renderToString(h(InputPanel, { wh, itemId: "inheritance", level: "detail", onLevel: noop, onSave: noop, onClose: noop, groupOpen: opened(keys) }));
const overrideKeys = (wh: WorkingHousehold) => (section(wh, TAX_OVERRIDE_GROUP)?.groups.flatMap((g) => g.fields.map((f) => f.key)) ?? []).sort();

const couple = fromRequest(modelHousehold("housingPurchase"));
const self = couple.request.input.household.members.find((m) => m.kind === "self")!;
const spouse = couple.request.input.household.members.find((m) => m.kind === "spouse")!;

describe("税理士などが出した相続税の額: 別の区画に分ける", () => {
  it("5つの欄は「税理士などが出した相続税の額」の区画に移り、「相続税の目安の設定」には計算の前提の欄だけが残る", () => {
    const set = section(couple, "inherit/tax")!;
    expect(set.title).toBe("相続税の目安の設定");
    expect(set.groups.flatMap((g) => g.fields.map((f) => f.key)).some((k) => k.startsWith("inherit/tax/override/"))).toBe(false);
    const sec = section(couple, TAX_OVERRIDE_GROUP)!;
    expect(sec.title).toBe(TAX_OVERRIDE_TITLE);
    expect(sec.level).toBe("detail");
    // 並びは「相続税の目安の設定」のすぐ後
    const keys = stage(couple).sections.map((s) => s.key);
    expect(keys.indexOf(TAX_OVERRIDE_GROUP)).toBe(keys.indexOf("inherit/tax") + 1);
    expect(overrideKeys(couple)).toEqual(
      [`inherit/tax/override/now/${self.id}`, `inherit/tax/override/now/${spouse.id}`, "inherit/tax/override/bothAfter", `inherit/tax/override/contingency/${self.id}`, `inherit/tax/override/contingency/${spouse.id}`].sort(),
    );
    // 名前は区画の名前にそろえる（「税理士などが出した額（…）」）。説明は5つで同じ文で、キャッシュフロー表が変わらないことを書く
    const fs = sec.groups.flatMap((g) => g.fields);
    for (const f of fs) {
      expect(f.label).toMatch(/^税理士などが出した額（.+）$/);
      expect(f.help).toContain("キャッシュフロー表・金融資産の推移・必要保障額は変わりません");
      expect(f.help).toContain("「相続税: ○万円（FP が入れた額）」");
    }
    expect(new Set(fs.map((f) => f.help)).size).toBe(1);
  });

  it("欄の値の入れ方は前のまま（要求の入力の inheritanceTax.overrides）", () => {
    const wh = fieldOf(couple, "inherit/tax/override/bothAfter").set(couple, 5000000);
    expect(wh.request.input.inheritanceTax).toEqual({ overrides: [{ point: "bothAfter", amount: 5000000 }] });
    expect(fieldOf(wh, "inherit/tax/override/bothAfter").set(wh, null).request.input.inheritanceTax).toBeUndefined();
  });
});

describe("税理士などが出した相続税の額: ふだんは閉じておく", () => {
  it("閉じている: 説明（試算をもらっているとき・どこにどう出るか・キャッシュフロー表は変わらない）と「＋ 税理士などが出した額を入れる」だけで、欄は出さない", () => {
    const g = section(couple, TAX_OVERRIDE_GROUP)!.groups[0]!;
    expect(g.folded).toMatchObject({ open: TAX_OVERRIDE_OPEN, startOpen: false });
    const lead = g.folded!.lead.join("");
    expect(lead).toContain("税理士などから相続税の額の試算をもらっているときは、ここに入れてください");
    expect(lead).toContain("「いまご本人が亡くなったら: 1,000万円（FP が入れた額）」");
    expect(lead).toContain("万一のときのタブの死亡の想定: そのタブの相続税の欄に「相続税: 1,000万円（FP が入れた額）」");
    expect(lead).toContain("ソフトの目安と内訳は");
    expect(lead).toContain("キャッシュフロー表・金融資産の推移は変わりません（相続税はお金の流れに入れていないため）");
    const html = panel(couple);
    expect(html).toContain(`data-folded="${TAX_OVERRIDE_GROUP}"`);
    expect(html).toContain(`data-fold-open="${TAX_OVERRIDE_GROUP}"`);
    expect(html).toContain(TAX_OVERRIDE_OPEN);
    expect(html).toContain("税理士などから相続税の額の試算をもらっているときは");
    // 「・」の行は箇条書き
    expect(html).toMatch(/<ul class="in-note in-folded-list"><li>いま亡くなったら・二人とも亡くなった後: /);
    expect(html).not.toContain(`id="${fieldDomId("inherit/tax/override/bothAfter")}"`);
    expect(html).not.toContain("data-fold-close");
    // 計算の前提の欄はそのまま出る
    expect(html).toContain(`id="${fieldDomId("inherit/tax/funeral")}"`);
  });

  it("開く: 欄が出て、説明は「?」に移り、値が無ければ「▾ 閉じる」を出す", () => {
    const html = panel(couple, [TAX_OVERRIDE_GROUP]);
    expect(html).not.toContain(`data-folded="${TAX_OVERRIDE_GROUP}"`);
    for (const k of overrideKeys(couple)) expect(html).toContain(`id="${fieldDomId(k)}"`);
    expect(html).toContain(`data-fold-close="${TAX_OVERRIDE_GROUP}"`);
    expect(html).toContain("閉じる（税理士などが出した相続税の額）");
  });

  it("額が入っている世帯は初めから開いている（閉じるリンクは出さない。入れた額を隠さない）", () => {
    const wh = fieldOf(couple, `inherit/tax/override/now/${self.id}`).set(couple, 8000000);
    expect(section(wh, TAX_OVERRIDE_GROUP)!.groups[0]!.folded?.startOpen).toBe(true);
    const html = panel(wh);
    expect(html).not.toContain("data-folded=");
    expect(html).not.toContain("data-fold-close");
    for (const k of overrideKeys(wh)) expect(html).toContain(`id="${fieldDomId(k)}"`);
  });

  it("「詳細」だけに出す（標準では区画ごと出さない）", () => {
    const html = renderToString(h(InputPanel, { wh: couple, itemId: "inheritance", level: "simple", onLevel: noop, onSave: noop, onClose: noop, groupOpen: opened([]) }));
    expect(html).not.toContain(TAX_OVERRIDE_OPEN);
  });
});

describe("税理士などが出した相続税の額: 万一のタブの死亡の想定の欄", () => {
  it("想定が無い（一人で子もいない＝遺族がいない）世帯では、万一のタブの欄を出さず、説明にも万一のタブのことを書かない", () => {
    const one = blankHousehold(BASE, seq());
    const me = one.request.input.household.members[0]!;
    expect(overrideKeys(one)).toEqual([`inherit/tax/override/now/${me.id}`, "inherit/tax/override/bothAfter"].sort());
    expect(allFields(stage(one)).find((f) => f.key === "inherit/tax/override/bothAfter")?.label).toBe("税理士などが出した額（表の最後の年）");
    const lead = section(one, TAX_OVERRIDE_GROUP)!.groups[0]!.folded!.lead.join("");
    expect(lead).not.toContain("万一のときのタブ");
    // 配偶者を足すと、二人それぞれの死亡の想定ができるので、欄が出る
    const two = addMember(one, "spouse");
    expect(overrideKeys(two).filter((k) => k.includes("/contingency/"))).toHaveLength(2);
  });

  it("想定が無くなったのに額が残っている世帯は、欄を出したまま、使っていないことを知らせ、1押しで消せる（黙って消さない）", () => {
    const one = blankHousehold(BASE, seq());
    const me = one.request.input.household.members[0]!;
    const left = mutate(one, (_h, req) => {
      req.input.inheritanceTax = { overrides: [{ point: "contingency", decedent: me.id, amount: 3000000 }] };
    });
    const key = `inherit/tax/override/contingency/${me.id}`;
    expect(overrideKeys(left)).toContain(key);
    // 額があるので初めから開く
    expect(section(left, TAX_OVERRIDE_GROUP)!.groups[0]!.folded?.startOpen).toBe(true);
    const st = fieldOf(left, key).get(left);
    expect(st.value).toBe(3000000);
    expect(st.warn).toContain("死亡の想定が今はありません");
    const cleared = st.warnFix!.run(left);
    expect(cleared.request.input.inheritanceTax).toBeUndefined();
    expect(overrideKeys(cleared)).not.toContain(key);
    // 想定がある世帯の欄には知らせを出さない
    expect(fieldOf(couple, `inherit/tax/override/contingency/${self.id}`).get(couple).warn ?? null).toBeNull();
  });
});
