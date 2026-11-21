// 入力画面の部品の見た目をそろえる（0236）: 区切りボタン（欄ごとの指定）・チェックで出てきた欄のまとまり・オン／オフのチェック。
// 見せ方だけの変更なので、どの部品でも書かれる値は選択肢の値のままで、欄の読み書き（get・set）は変えていないことを確かめる
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { fieldDomId, fieldUnits, Group, isSegmented, onOffOf, type GroupOpenState } from "../src/workspace/input/FieldViews.tsx";
import { allFields, type FieldDef, type GroupDef } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { InputPanel } from "../src/workspace/input/InputPanel.tsx";
import { buildStage, buildStages } from "../src/workspace/input/stages/index.ts";
import { fieldTextId } from "../src/workspace/input/textIds.ts";
import { hasFieldValue } from "../src/workspace/input/valueState.ts";
import { officeFieldsFrom, type OfficeTextEntry } from "../src/workspace/office/customTexts.ts";
import { OfficeFieldsContext } from "../src/workspace/office/customTextsContext.ts";
import { modelHousehold } from "./helpers.ts";

const noop = () => undefined;
const open = (m: string): WorkingHousehold => fromRequest(modelHousehold(m), {});
const allOpen: GroupOpenState = { isOpen: () => true, toggle: noop };
const panel = (wh: WorkingHousehold, card: string) => renderToString(h(InputPanel, { wh, itemId: card, level: "detail", onLevel: noop, onSave: noop, onClose: noop, groupOpen: allOpen }));

const MODEL_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "modelHouseholds");
const MODELS = readdirSync(MODEL_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""))
  .sort();

type SelectField = Extract<FieldDef, { kind: "select" }>;
const isSelect = (f: FieldDef): f is SelectField => f.kind === "select";

/** 見本の世帯すべての、全部の段階の欄（世帯ごとに1回だけ組み立てる） */
const everything: { model: string; wh: WorkingHousehold; stage: string; fields: FieldDef[]; groups: FieldDef[][] }[] = MODELS.flatMap((model) => {
  const wh = open(model);
  return buildStages(wh).map((s) => ({ model, wh, stage: s.id, fields: allFields(s), groups: s.sections.flatMap((sec) => sec.groups.map((g) => g.fields)) }));
});
const everyField = everything.flatMap((e) => e.fields.map((f) => ({ ...e, f })));
const everySelect = everyField.filter((e): e is typeof e & { f: SelectField } => isSelect(e.f));
const segmentedOnes = everySelect.filter((e) => e.f.segmented === true);

/** 区切りボタンの見た目の幅の見積もり（全角の字数。ボタンごとの余白を2字ぶんと数える）。詰めた形の欄（260px）に1行で収まる目安は22字 */
const segWidth = (f: SelectField): number => f.options.reduce((n, o) => n + [...o.label].length + 2, 0);

describe("区切りボタンは、欄ごとの指定で決める", () => {
  it("見本の世帯に、区切りボタンの欄がある（指定が外れていない）", () => {
    expect(MODELS.length).toBeGreaterThan(30);
    const labels = new Set(segmentedOnes.map((e) => e.f.label));
    for (const l of ["性別", "入れ方", "払い方", "返済方法", "見込み", "回数", "建て方", "買い方"]) expect(labels, l).toContain(l);
  });

  it("指定した欄は、選択肢が2〜3個・見出しなし・言葉が短い", () => {
    for (const { model, f } of segmentedOnes) {
      const at = `${model} ${f.key}（${f.label}）`;
      expect(f.options.length, at).toBeGreaterThanOrEqual(2);
      expect(f.options.length, at).toBeLessThanOrEqual(3);
      expect(f.options.every((o) => o.group === undefined), at).toBe(true);
      expect(f.search, at).toBeUndefined();
      expect(segWidth(f), `${at}: ${f.options.map((o) => o.label).join("｜")}`).toBeLessThanOrEqual(22);
    }
  });

  it("人を選ぶ欄（ご本人・配偶者・子・親など）には付けない", () => {
    for (const { model, wh, f } of segmentedOnes) {
      const people = new Set(["ご本人", "配偶者", "夫婦", ...(wh.request.input.household.members ?? []).map((m) => (m as { name?: string }).name ?? "").filter((n) => n !== "")]);
      for (const o of f.options) expect(people.has(o.label), `${model} ${f.key}（${f.label}）: ${o.label}`).toBe(false);
    }
  });

  it("同じ名前・同じ選択肢の欄は、入力項目をまたいで同じ形（全部が区切りボタンか、全部が選ぶ欄）", () => {
    const shapes = new Map<string, Set<string>>();
    for (const { stage, f } of everySelect) {
      if (f.readOnly !== undefined || f.search !== undefined) continue;
      const sig = `${f.label}［${f.options.map((o) => o.label).join("｜")}］`;
      const set = shapes.get(sig) ?? new Set<string>();
      set.add(`${isSegmented(f) ? "区切りボタン" : "選ぶ欄"}（${stage}）`);
      shapes.set(sig, set);
    }
    const mixed = [...shapes].filter(([, s]) => new Set([...s].map((x) => x.replace(/（.*$/, ""))).size > 1).map(([sig, s]) => `${sig}: ${[...s].join("・")}`);
    expect(mixed).toEqual([]);
  });

  it("選択肢の数では切り替えない: 指定の無い2〜3択は選ぶ欄のまま", () => {
    const plainTwo = everySelect.filter((e) => e.f.segmented !== true && e.f.options.length <= 3 && e.f.options.length >= 2);
    expect(plainTwo.length).toBeGreaterThan(0);
    for (const { f } of plainTwo) expect(isSegmented(f)).toBe(false);
  });

  it("読むだけの欄・見出しのある選択肢・選択肢が1つの欄は、指定があっても選ぶ欄のまま", () => {
    const f = segmentedOnes[0]?.f as SelectField;
    expect(isSegmented(f)).toBe(true);
    expect(isSegmented({ ...f, readOnly: "見せるだけ" })).toBe(false);
    expect(isSegmented({ ...f, options: f.options.slice(0, 1) })).toBe(false);
    expect(isSegmented({ ...f, options: f.options.map((o) => ({ ...o, group: "見出し" })) })).toBe(false);
    expect(isSegmented({ ...f, segmented: false })).toBe(false);
  });
});

describe("区切りボタンでも、書かれる値は選択肢の値のまま", () => {
  const wh = open("salariedCoupleTwoKids");
  const family = buildStage("family", wh);
  const sex = allFields(family).find((f): f is SelectField => isSelect(f) && f.label === "性別");

  it("画面: 選択肢ごとのボタン（data-value が選択肢の値）で、今の値だけが選ばれている", () => {
    expect(sex).toBeDefined();
    if (sex === undefined) return;
    const html = panel(wh, "family");
    const at = html.indexOf(`id="${fieldDomId(sex.key)}"`);
    expect(at).toBeGreaterThan(0);
    const start = html.lastIndexOf('role="radiogroup"', at);
    const group = html.slice(start, html.indexOf("</span>", at));
    expect(group).toContain("data-seg");
    const cur = sex.get(wh).value;
    for (const o of sex.options) {
      const m = new RegExp(`<button[^>]*data-value="${o.value}"[^>]*>`).exec(group);
      expect(m, o.label).not.toBeNull();
      expect(m?.[0]).toContain('role="radio"');
      expect(m?.[0]).toContain(`aria-checked="${String(o.value === cur)}"`);
    }
    // 選ぶ欄（プルダウン）は出さない
    expect(group).not.toContain("<select");
  });

  it("どの区切りボタンの欄も、選択肢の値を書けば同じ値が読める（選ぶ欄のときと同じ読み書き）", () => {
    let checked = 0;
    for (const { model, wh: w, stage, f } of segmentedOnes) {
      if (f.readOnly !== undefined || f.structural === true) continue;
      for (const o of f.options) {
        if (f.refuse?.(w, o.value) != null) continue;
        const next = f.set(w, o.value);
        const again = allFields(buildStage(stage as Parameters<typeof buildStage>[0], next)).find((x) => x.key === f.key);
        // 選ぶと欄そのものが無くなる（形が変わる）選択は、ここでは見ない
        if (again === undefined) continue;
        expect(again.get(next).value, `${model} ${f.key}（${f.label}）← ${o.label}`).toBe(o.value);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe("オン・オフだけの2択は、チェックと同じ見た目（値は選択肢の値のまま）", () => {
  const wh = open("salariedCoupleTwoKids");
  const curve = allFields(buildStage("work", wh)).find((f): f is SelectField => isSelect(f) && f.onOff !== undefined);

  it("統計の年齢カーブ: 選択肢の値（オン・オフ）のどちらかならチェックで描く", () => {
    expect(curve).toBeDefined();
    if (curve === undefined) return;
    const { on, off } = curve.onOff as { on: string; off: string };
    for (const v of [on, off]) {
      const next = curve.set(wh, v);
      const f = allFields(buildStage("work", next)).find((x) => x.key === curve.key) as SelectField;
      expect(f.get(next).value).toBe(v);
      const pair = onOffOf(f, v);
      expect(pair?.on.value).toBe(on);
      expect(pair?.off.value).toBe(off);
      const html = panel(next, "work");
      const m = new RegExp(`<input[^>]*id="${fieldDomId(curve.key)}"[^>]*>`).exec(html);
      expect(m?.[0]).toContain('type="checkbox"');
      expect(m?.[0]).toContain("data-on-off");
      expect(/\schecked/.test(m?.[0] ?? "")).toBe(v === on);
    }
  });

  it("ほかの値が残っている間・選択肢が3つある間は、選ぶ欄のまま", () => {
    if (curve === undefined) return;
    expect(onOffOf(curve, "ほかの値")).toBeNull();
    expect(onOffOf(curve, null)).toBeNull();
    expect(onOffOf({ ...curve, options: [...curve.options, { value: "x", label: "3つ目" }] }, curve.onOff?.on ?? "")).toBeNull();
    expect(onOffOf({ ...curve, readOnly: "見せるだけ" }, curve.onOff?.on ?? "")).toBeNull();
  });

  it("住宅ローン控除: 「受ける」のチェックで切り替える（押したときの処理はボタンのときのまま）", () => {
    // 今の持ち家に、今の残高から入れる住宅ローンを足す（控除の条件をまだ持たないローン）
    const actions = (w: WorkingHousehold) => buildStage("housing", w).sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)]);
    const run = (w: WorkingHousehold, suffix: string): WorkingHousehold => {
      const a = actions(w).find((x) => x.key.endsWith(suffix));
      if (a === undefined) throw new Error(`no action ${suffix}`);
      return a.run(w);
    };
    const start = run(run(open("sampleCoupleNoKids"), "housing/addOwn"), "housing/addMortgage");
    const check = (w: WorkingHousehold) => actions(w).find((a) => a.key.endsWith("/creditNa"));
    const a = check(start);
    expect(a?.check).toEqual({ label: "住宅ローン控除を受ける", on: true });
    if (a === undefined) return;
    const shown = (w: WorkingHousehold) => new RegExp(`<input type="checkbox"[^>]*data-action="${a.key}"[^>]*/?>\\s*住宅ローン控除を受ける`).exec(panel(w, "housing"))?.[0];
    expect(shown(start)).toMatch(/\schecked/);
    // 外す＝「該当なし」にする。もう一度入れると元の世帯に戻る
    const off = a.run(start);
    expect(check(off)?.check).toEqual({ label: "住宅ローン控除を受ける", on: false });
    expect(shown(off)).toBeDefined();
    expect(shown(off)).not.toMatch(/\schecked/);
    const back = check(off)?.run(off);
    expect(JSON.stringify(back?.request)).toBe(JSON.stringify(start.request));
  });
});

describe("チェックで出てきた欄は、チェックのすぐ下にひとまとまり", () => {
  it("出てくる欄をキーで書いたチェック: その欄は、同じ並びでチェックのすぐ後ろに続く", () => {
    let seen = 0;
    for (const { model, wh, groups } of everything) {
      for (const fields of groups) {
        fields.forEach((f, i) => {
          if (f.opens === undefined) return;
          expect(f.kind, `${model} ${f.key}`).toBe("bool");
          if (f.opens === "rest") return;
          seen += 1;
          const here = f.opens.filter((k) => fields.some((x) => x.key === k));
          // 外している間は出てくる欄が無い（欄の定義が出さない）。入れている間は、すぐ後ろに順に続く
          if (f.get(wh).value !== true) return;
          expect(fields.slice(i + 1, i + 1 + here.length).map((x) => x.key), `${model} ${f.key}`).toEqual(here);
        });
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("入れているチェックは出てきた欄を抱え、外しているチェックは中身なしのまとまり（置き場が変わらない）", () => {
    const wh = open("salariedCoupleTwoKids");
    const find = (w: WorkingHousehold) => {
      for (const sec of buildStage("work", w).sections) for (const g of sec.groups) for (const f of g.fields) if (f.kind === "bool" && Array.isArray(f.opens)) return { f, fields: g.fields };
      return null;
    };
    const first = find(wh);
    expect(first).not.toBeNull();
    if (first === null) return;
    for (const v of [true, false]) {
      const next = first.f.set(wh, v);
      const now = find(next);
      expect(now?.f.key).toBe(first.f.key);
      if (now === null) continue;
      const unit = fieldUnits(now.fields, next).find((u) => u.kind === "opened" && u.head.key === first.f.key);
      expect(unit?.kind).toBe("opened");
      if (unit?.kind !== "opened") continue;
      const opens = now.f.opens as readonly string[];
      expect(unit.body.map((x) => x.key)).toEqual(v ? opens.filter((k) => now.fields.some((x) => x.key === k)) : []);
      if (v) expect(unit.body.length).toBeGreaterThan(0);
      // まとまりに分けても、欄は1つも増えず・減らず・並びも変わらない
      expect(fieldUnits(now.fields, next).flatMap((u) => (u.kind === "one" ? [u.f.key] : [u.head.key, ...u.body.map((x) => x.key)]))).toEqual(now.fields.map((x) => x.key));
      const html = panel(next, "work");
      expect(html).toContain(`data-opened-by="${first.f.key}"`);
      expect(html.includes(`aria-label="${first.f.label}で出てきた欄"`)).toBe(v);
    }
  });

  it("どの世帯のどの並びでも、まとまりに分けて欄が増えも減りもしない", () => {
    for (const { model, wh, groups } of everything) {
      for (const fields of groups) {
        const flat = fieldUnits(fields, wh).flatMap((u) => (u.kind === "one" ? [u.f.key] : [u.head.key, ...u.body.map((x) => x.key)]));
        expect(flat, model).toEqual(fields.map((x) => x.key));
      }
    }
  });

  it("後ろの欄すべてが出てくるチェック（賃貸の「貸している」）: 入れると、左の線のまとまりの中に後ろの欄が入る", () => {
    const wh = open("rentalSample");
    const rental = buildStage("rental", wh);
    const rented = allFields(rental).find((f) => f.kind === "bool" && f.opens === "rest" && f.get(wh).value === true);
    expect(rented).toBeDefined();
    if (rented === undefined) return;
    const html = panel(wh, "rental");
    const at = html.indexOf(`data-opened-by="${rented.key}"`);
    expect(at).toBeGreaterThan(0);
    expect(html.slice(at, at + 4000)).toContain("fld-opened-body");
    // 外すと、チェックだけのまとまりになる（出てきた欄の枠を持たない）
    const off = rented.set(wh, false);
    const offHtml = panel(off, "rental");
    const offAt = offHtml.indexOf(`data-opened-by="${rented.key}"`);
    expect(offAt).toBeGreaterThan(0);
    const count = (html: string) => html.split(`aria-label="${rented.label}で出てきた欄"`).length - 1;
    expect(count(offHtml)).toBe(count(html) - 1);
  });
});

describe("開いて保存し直しても、世帯の中身は変わらない（見せ方だけの変更）", () => {
  it("見本の世帯すべて: 全部の入力項目を描いても、世帯のデータは1字も変わらない", () => {
    for (const model of MODELS) {
      const wh = open(model);
      const before = JSON.stringify(wh.request);
      for (const s of buildStages(wh)) {
        const html = panel(wh, s.id);
        expect(html.length, `${model} ${s.id}`).toBeGreaterThan(0);
      }
      expect(JSON.stringify(wh.request), model).toBe(before);
    }
  });

  it("今の値をそのまま書き直しても変わらない（区切りボタン・オン／オフ・出てくる欄を持つチェック）", () => {
    let n = 0;
    for (const { model, wh, f } of everyField) {
      const touched = (isSelect(f) && (f.segmented === true || f.onOff !== undefined)) || (f.kind === "bool" && f.opens !== undefined);
      if (!touched || f.readOnly !== undefined) continue;
      const state = f.get(wh);
      // 空欄のまま推定で計算している欄は、書くと確定になる（値の状態が変わる）ので、入っている値だけを見る
      if (state.value === null || state.value === "" || state.estimated != null || state.assumed != null) continue;
      const next = f.set(wh, state.value);
      expect(JSON.stringify(next.request.input.household), `${model} ${f.key}（${f.label}）`).toBe(JSON.stringify(wh.request.input.household));
      n += 1;
    }
    expect(n).toBeGreaterThan(100);
  });
});

describe("基準月が1〜3月・誕生月の前後でも、部品の形は同じ", () => {
  // 基準月が年の初め（1〜3月。年度をまたぐ）と、ご本人の誕生月の前の月・その月・次の月
  const shifted = (model: string): { at: string; wh: WorkingHousehold }[] => {
    const req = modelHousehold(model);
    const self = req.input.household.members.find((m) => m.kind === "self");
    const birthMonth = Number((self?.birth?.birthYearMonth ?? "1980-06").slice(5));
    const around = [birthMonth - 1, birthMonth, birthMonth + 1].map((m) => ((m + 11) % 12) + 1);
    const months = [...new Set([1, 2, 3, ...around])];
    return months.map((m) => {
      const baseMonth = `2027-${String(m).padStart(2, "0")}`;
      return { at: `${model} 基準月 ${baseMonth}`, wh: fromRequest({ ...req, input: { ...req.input, baseMonth } }, {}) };
    });
  };
  const SOME = ["salariedCoupleTwoKids", "sampleSelfEmployedFamily", "rentalSample", "sampleSeniorCouple", "sampleSingle20s", "parentCare", "housingPurchase", "sampleOwnerCompany"];

  it("どの入力項目も描けて、区切りボタン・まとまりの形と世帯のデータは変わらない", () => {
    let seg = 0;
    let opened = 0;
    for (const model of SOME) {
      const original = new Set(
        buildStages(open(model))
          .flatMap((s) => allFields(s))
          .filter((f) => isSelect(f) && isSegmented(f))
          .map((f) => f.key),
      );
      for (const { at, wh } of shifted(model)) {
        const before = JSON.stringify(wh.request);
        for (const s of buildStages(wh)) {
          expect(panel(wh, s.id).length, `${at} ${s.id}`).toBeGreaterThan(0);
          for (const g of s.sections.flatMap((sec) => sec.groups)) {
            const units = fieldUnits(g.fields, wh);
            expect(units.flatMap((u) => (u.kind === "one" ? [u.f.key] : [u.head.key, ...u.body.map((x) => x.key)])), at).toEqual(g.fields.map((x) => x.key));
            opened += units.filter((u) => u.kind === "opened").length;
          }
          // 基準月を動かす前から区切りボタンだった欄は、動かした後も区切りボタンのまま（基準月で形が変わらない）
          for (const f of allFields(s)) {
            if (!original.has(f.key)) continue;
            expect(isSelect(f) && isSegmented(f), `${at} ${f.key}（${f.label}）`).toBe(true);
            seg += 1;
          }
        }
        expect(JSON.stringify(wh.request), at).toBe(before);
      }
    }
    expect(seg).toBeGreaterThan(100);
    expect(opened).toBeGreaterThan(0);
  });
});

describe("事務所のカスタマイズ（欄を隠す・並べ替える）は、今までどおり効く", () => {
  const entry = (id: string, op: OfficeTextEntry["do"], order?: number): OfficeTextEntry => ({ id, do: op, text: null, official: "", officialChanged: false, ...(order !== undefined ? { order } : {}) });
  const render = (g: GroupDef, wh: WorkingHousehold, list: OfficeTextEntry[]) => renderToString(h(OfficeFieldsContext.Provider, { value: officeFieldsFrom(list) }, h(Group, { group: g, wh, level: "detail", onEdit: noop })));
  const order = (html: string) => [...html.matchAll(/data-field="([^"]+)"/g)].map((m) => m[1]);
  /** 条件に合う欄を持つまとまりを、見本の世帯から探す */
  const groupWith = (wh: WorkingHousehold, stage: Parameters<typeof buildStage>[0], pred: (f: FieldDef) => boolean): { g: GroupDef; f: FieldDef } => {
    for (const sec of buildStage(stage, wh).sections)
      for (const g of sec.groups) {
        const f = g.fields.find((x) => pred(x) && fieldTextId(x, wh) !== null);
        if (f !== undefined && g.info === undefined && g.chips !== true) return { g, f };
      }
    throw new Error("まとまりが見つかりません");
  };

  it("区切りボタンの欄: 並べ替えても区切りボタンのまま先頭に出る。隠す決まりは選ぶ欄のときと同じ", () => {
    const wh = open("salariedCoupleTwoKids");
    const { g, f } = groupWith(wh, "housing", (x) => isSegmented(x) && x.level === "detail");
    const plainOrder = order(render(g, wh, []));
    expect(plainOrder).toContain(f.key);
    const id = fieldTextId(f, wh) as string;
    const moved = render(g, wh, [entry(id, "order", 1)]);
    expect(order(moved)[0]).toBe(f.key);
    expect([...order(moved)].sort()).toEqual([...plainOrder].sort());
    expect(moved.slice(moved.indexOf(`data-field="${f.key}"`)).slice(0, 3000)).toContain("data-seg");
    // 隠す: 値の無い欄は隠れ、値が入っている欄は隠す設定でも出す（選ぶ欄のときと同じ決まり）
    expect(order(render(g, wh, [entry(id, "hide")])).includes(f.key)).toBe(hasFieldValue(f, wh));
  });

  it("出てくる欄を持つチェック: 出てきた欄を別の所へ並べ替えても、欄は1つも増えず・減らない（まとまりの外にふつうの欄として出る）", () => {
    const base = open("salariedCoupleTwoKids");
    const first = groupWith(base, "work", (x) => x.kind === "bool" && Array.isArray(x.opens));
    const wh = first.f.set(base, true);
    const { g, f: head } = groupWith(wh, "work", (x) => x.key === first.f.key);
    const body = g.fields.find((x) => (head.opens as readonly string[]).includes(x.key));
    expect(body).toBeDefined();
    if (body === undefined) return;
    const plainHtml = render(g, wh, []);
    const plainOrder = order(plainHtml);
    expect(plainOrder.indexOf(body.key)).toBe(plainOrder.indexOf(head.key) + 1);
    expect(plainHtml).toContain(`aria-label="${head.label}で出てきた欄"`);
    // 出てきた欄を先頭へ: チェックのすぐ後ろでなくなるので、左の線のまとまりには入れず、ふつうの欄として先頭に出す
    const moved = render(g, wh, [entry(fieldTextId(body, wh) as string, "order", 1)]);
    expect(order(moved)[0]).toBe(body.key);
    expect([...order(moved)].sort()).toEqual([...plainOrder].sort());
    expect(moved).not.toContain(`aria-label="${head.label}で出てきた欄"`);
    expect(moved).toContain(`data-opened-by="${head.key}"`);
    // チェックを外した世帯では、チェックを隠せる（値の無い欄だけ隠す決まりのまま）
    const off = head.set(wh, false);
    const offGroup = groupWith(off, "work", (x) => x.key === head.key);
    const offPlain = order(render(offGroup.g, off, []));
    const shown = order(render(offGroup.g, off, [entry(fieldTextId(offGroup.f, off) as string, "hide")]));
    expect(shown).toEqual(hasFieldValue(offGroup.f, off) ? offPlain : offPlain.filter((k) => k !== head.key));
  });
});
