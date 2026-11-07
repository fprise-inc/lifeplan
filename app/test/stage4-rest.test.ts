// 入力項目を通しで入れ直した確かめで見つかった物のうち、住まい・ローン以外の直し（0150）:
// 推定と同じ値を打っても確定・年齢で入れた生年月は確定（年齢から）、教育の段が過ぎた子、企業年金の受け取る時期と既定の勤め先、
// 介護の期間と見出し、年金の見込みの内訳、対策の働く最後の説明と基準の額、カードの推定の1行、内訳の推定の札とパネルの頭の数、
// iDeCo の積立の最後、あげる贈与の既定の相手、数えない推定（標準報酬月額・失業給付のおまかせ）、時点の欄の人の選択、「外す」の言葉
import { describe, expect, it } from "vitest";
import type { EngineRequest, Member } from "../src/engine/types.ts";
import { checkList } from "../src/workspace/input/checkRows.ts";
import { h, options, type VNode } from "preact";
import { renderToString } from "preact-render-to-string";
import { Field, readField } from "../src/workspace/input/FieldViews.tsx";
import { allFields, resolveTimepoint, type FieldDef, type StageDef } from "../src/workspace/input/form.ts";
import { shiftMonth } from "../src/workspace/timepoint.ts";
import { blankHousehold, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { inputItems } from "../src/workspace/input/items.ts";
import { estimateView } from "../src/workspace/input/pensionEstimate.ts";
import { idecoStop } from "../src/workspace/input/savings/model.ts";
import { careSpan } from "../src/workspace/input/stages/care.ts";
import { careDeathCut } from "../src/workspace/input/stages/events.ts";
import { educationFinished } from "../src/workspace/input/stages/education.ts";
import { benefitPeriod } from "../src/workspace/input/stages/retirement.ts";
import { buildStage, buildStages } from "../src/workspace/input/stages/index.ts";
import { statusText } from "../src/workspace/input/StatusBadge.tsx";
import { confirmTyped, fieldStatus, fromAgeBasis, typeFromAge, typeValue } from "../src/workspace/input/valueState.ts";
import { dropStaleRows } from "../src/workspace/input/rows.ts";
import { bodyObject, EMPTY_CARRY, fromBody } from "../src/workspace/store/body.ts";
import { buildCatalog, leverValueText } from "../src/workspace/plans/items.ts";
import { itemMan } from "../src/presentation/MoneyThree.tsx";
import { modelHousehold, preview } from "./helpers.ts";

type StageId = Parameters<typeof buildStage>[0];
const BASE = "2026-11";
let n = 0;
const ids = () => () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const open = (id: string) => fromRequest(modelHousehold(id));
const hh = (wh: WorkingHousehold) => wh.request.input.household;
const stage = (id: StageId, wh: WorkingHousehold): StageDef => buildStage(id, wh);
const fieldOf = (id: StageId, wh: WorkingHousehold, pred: (f: FieldDef) => boolean): FieldDef => {
  const f = allFields(stage(id, wh)).find(pred);
  if (f === undefined) throw new Error("no field");
  return f;
};
const actionsOf = (id: StageId, wh: WorkingHousehold) => stage(id, wh).sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)]);
const runAction = (id: StageId, wh: WorkingHousehold, key: (k: string) => boolean): WorkingHousehold => {
  const a = actionsOf(id, wh).find((x) => key(x.key));
  if (a === undefined) throw new Error("no action");
  return a.run(wh);
};
const computes = (wh: WorkingHousehold) => expect(preview(wh.request as EngineRequest).table.length).toBeGreaterThan(0);

/** 本人（生年月）と、働き方の期間を入れた世帯 */
function withMember(birth: string, extra: (h: ReturnType<typeof hh>, self: Member) => void = () => undefined): WorkingHousehold {
  const wh = blankHousehold(BASE, ids());
  return {
    ...mutate(wh, (h) => {
      const self = h.members[0] as Member;
      self.birth = { birthYearMonth: birth, bornOnFirst: false };
      extra(h, self);
    }),
    assumed: {},
  };
}

describe("推定と同じ値を打っても確定にする（0150。打つのは明示の操作）", () => {
  it.each(["selfEmployed", "salariedCoupleTwoKids", "elderCare", "housingPurchase"])("%s: 値のある推定の欄は、同じ値を打つと根拠の無い確定になり、計算できる", (id) => {
    const wh = open(id);
    let count = 0;
    for (const st of buildStages(wh))
      for (const f of allFields(st)) {
        const s = fieldStatus(f, wh);
        const v = f.get(wh).value;
        if (s.status !== "estimated" || f.readOnly !== undefined || f.kind === "when" || v === null) continue;
        const w = typeValue(f, wh, v);
        expect(fieldStatus(f, w), f.key).toMatchObject({ status: "confirmed", explicit: false });
        expect(f.get(w).value, f.key).toEqual(v);
        count++;
      }
    expect(count).toBeGreaterThan(0);
  });

  it("時点の欄（働く最後の年齢など）も、同じ時点の文字を打って離れると確定になる。推定でない欄・値の無い推定は変えない", () => {
    let count = 0;
    let timeCount = 0;
    // 空の世帯で「働き方を入れる → 自営業」（働く最後の年齢が推定 70歳の時点の欄）と、見本の世帯
    const fresh = blankHousehold(BASE, ids());
    const selfEmployed = actionsOf("work", fresh).find((a) => a.label === "自営業")!.run(fresh);
    const last = allFields(stage("work", selfEmployed)).find((f) => f.label === "働く最後の年齢" && f.time !== undefined)!;
    expect(fieldStatus(last, selfEmployed).status).toBe("estimated");
    for (const [id, wh] of [["selfEmployedFresh", selfEmployed], ["selfEmployed", open("selfEmployed")], ["salariedCoupleTwoKids", open("salariedCoupleTwoKids")]] as const) {
      void id;
      for (const st of buildStages(wh))
        for (const f of allFields(st)) {
          const s = fieldStatus(f, wh);
          if (f.readOnly !== undefined) continue;
          if (s.status !== "estimated") {
            expect(confirmTyped(f, wh), f.key).toBe(wh);
            continue;
          }
          const w = confirmTyped(f, wh);
          if (f.get(wh).value === null && f.time === undefined) {
            expect(w, f.key).toBe(wh);
            continue;
          }
          if (f.time !== undefined) timeCount++;
          expect(fieldStatus(f, w), f.key).toMatchObject({ status: "confirmed", explicit: false });
          computes(w);
          count++;
        }
    }
    expect(count).toBeGreaterThan(0);
    expect(timeCount).toBeGreaterThan(0);
  });

  it("推定の欄に今と違う値を打つのは今までどおり。欄の書き方（set）で同じ値を書き戻すのは今までどおり何も変えない（0041）", () => {
    const wh = blankHousehold(BASE, ids());
    const f = fieldOf("living", wh, (x) => x.key.endsWith("/monthly"));
    expect(fieldStatus(f, wh).status).toBe("estimated");
    expect(f.set(wh, f.get(wh).value)).toBe(wh);
    const typed = typeValue(f, wh, f.get(wh).value);
    expect(fieldStatus(f, typed)).toMatchObject({ status: "confirmed", explicit: false });
    expect(typeValue(f, wh, 300000)).toEqual(f.set(wh, 300000));
  });

  it("仮の値の生年月に同じ年月を打つと、仮の印が外れて確定になる", () => {
    const wh = blankHousehold(BASE, ids());
    const f = fieldOf("family", wh, (x) => x.key.endsWith("/birth"));
    expect(fieldStatus(f, wh).provisional).toBe(true);
    const w = typeValue(f, wh, f.get(wh).value);
    expect(fieldStatus(f, w).status).toBe("confirmed");
    expect(w.assumed[f.key]).toBeUndefined();
  });

  it("「38歳」と打った生年月は確定（根拠は年齢から）。欄の読みに「年齢から」を添え、確かめの一覧の未入力に出ない", () => {
    const wh = blankHousehold(BASE, ids());
    const f = fieldOf("family", wh, (x) => x.key.endsWith("/birth"));
    const r = readField(f, "38歳", { unit: "man", period: "monthly", baseMonth: BASE })!;
    expect(r.v).toBe("1988-05");
    expect(r.fromAge).toMatch(/^年齢から/);
    const w = typeFromAge(f, wh, r.v, r.fromAge!);
    expect(fieldStatus(f, w).status).toBe("confirmed");
    expect(fromAgeBasis(f, w)).toMatch(/^年齢から/);
    expect(w.assumed[f.key]).toBeUndefined();
    expect(f.get(w).hint).toMatch(/38歳.*・年齢から$/);
    expect(checkList(w).filter((x) => x.fieldKey === f.key)).toEqual([]);
    computes(w);
    // 保存して読み直しても年齢からの確定のまま
    const back = fromBody(JSON.stringify(bodyObject({ wh: w, workspace: { template: null, band: [], base: "current", selected: "current", shownItems: [] }, display: { result: {}, balance: {} } as never, carry: EMPTY_CARRY }))).wh;
    expect(fieldStatus(f, back).status).toBe("confirmed");
    expect(fromAgeBasis(f, back)).toMatch(/^年齢から/);
    // 月まで打ち直すと（入力のパネルの書き方: 値が変わった所の前からの行を外す）、年齢からの印は外れる
    const fixed = dropStaleRows(w, typeValue(f, w, "1988-02"));
    expect(fromAgeBasis(f, fixed)).toBeNull();
    expect(f.get(fixed).hint ?? "").not.toMatch(/年齢から/);
  });
});

/** 欄を描いて、input の操作（onFocus・onInput・onBlur）を取り出す（field-input-reading.test.ts と同じ形） */
function renderInput(f: FieldDef, wh: WorkingHousehold, onEdit: (w: WorkingHousehold) => void): VNode<Record<string, unknown>> {
  const inputs: VNode<Record<string, unknown>>[] = [];
  const prev = options.vnode;
  options.vnode = (v) => {
    if (v.type === "input") inputs.push(v as VNode<Record<string, unknown>>);
    prev?.(v);
  };
  try {
    renderToString(h(Field, { f, wh, onEdit }));
    return inputs[0]!;
  } finally {
    options.vnode = prev;
  }
}
const ev = (value: string) => ({ currentTarget: { value } });
const call = (v: VNode<Record<string, unknown>>, name: string, arg?: unknown) => (v.props[name] as (e: unknown) => void)(arg);

describe("欄の部品: 打ったら同じ文字でも確定、入って離れるだけなら書かない（0150）", () => {
  it("数の欄: 推定の値と同じ文字を打って離れると確定。打たずに離れると何も書かない", () => {
    const wh = blankHousehold(BASE, ids());
    const f = fieldOf("living", wh, (x) => x.key.endsWith("/monthly"));
    const edits: WorkingHousehold[] = [];
    const input = renderInput(f, wh, (w) => edits.push(w));
    const shown = String(input.props.value);
    expect(shown).not.toBe("");
    call(input, "onFocus");
    call(input, "onBlur", ev(shown));
    expect(edits).toHaveLength(0);
    call(input, "onFocus");
    call(input, "onInput", ev(shown));
    call(input, "onBlur", ev(shown));
    expect(edits).toHaveLength(1);
    expect(fieldStatus(f, edits[0]!)).toMatchObject({ status: "confirmed", explicit: false });
  });

  it("時点の欄（自営業の働く最後の年齢 推定70歳）: 「70」と打って離れると確定", () => {
    const fresh = blankHousehold(BASE, ids());
    const wh = actionsOf("work", fresh).find((a) => a.label === "自営業")!.run(fresh);
    const f = allFields(stage("work", wh)).find((x) => x.label === "働く最後の年齢" && x.time !== undefined)!;
    expect(fieldStatus(f, wh).status).toBe("estimated");
    const edits: WorkingHousehold[] = [];
    const input = renderInput(f, wh, (w) => edits.push(w));
    call(input, "onFocus");
    call(input, "onInput", ev("70"));
    call(input, "onBlur", ev("70"));
    expect(edits).toHaveLength(1);
    expect(fieldStatus(f, edits[0]!).status).toBe("confirmed");
    computes(edits[0]!);
  });
});

describe("教育の段が全部過ぎた子（0150）", () => {
  const kids = () =>
    withMember("1963-01", (h) => {
      h.members.push({ id: "11111111-1111-4111-8111-111111111111", kind: "child", birth: { birthYearMonth: "1992-04", bornOnFirst: false }, sex: "male", joins: null, leaves: null, expected: false });
      h.members.push({ id: "22222222-2222-4222-8222-222222222222", kind: "child", birth: { birthYearMonth: "1995-06", bornOnFirst: false }, sex: "female", joins: null, leaves: null, expected: false });
      // 前に推定の進路が入り、生年月を直して段が全部外れた子（段の無い進路と推定の行）
      (h.goals ??= []).push({ id: "33333333-3333-4333-8333-333333333333", kind: "education", owner: "11111111-1111-4111-8111-111111111111", education: { stages: [] } });
    });

  it("進路の型・推定の欄を出さず、見出しの横に「34歳・教育は終わっています」。推定に数えず、ホームは「教育は終わっています」で該当なし", () => {
    const wh = kids();
    const st = stage("education", wh);
    const sec = st.sections.find((s) => s.key === "edu/11111111-1111-4111-8111-111111111111")!;
    expect(sec.summary).toBe("34歳・教育は終わっています");
    expect(allFields(st).filter((f) => f.label === "進路の型")).toEqual([]);
    expect(allFields(st).filter((f) => fieldStatus(f, wh).status === "estimated")).toEqual([]);
    const card = inputItems(wh).find((c) => c.id === "education")!;
    expect(card.summary).toEqual({ main: "教育は終わっています" });
    expect(card.status).toBe("na");
    expect(card.estimated).toBe(0);
  });

  it("これからの段がある子・奨学金などの物がある子は今までどおり", () => {
    const young: Member = { id: "x", kind: "child", birth: { birthYearMonth: "2015-04", bornOnFirst: false }, sex: "male", joins: null, leaves: null, expected: false };
    expect(educationFinished(young, undefined, BASE)).toBe(false);
    const old: Member = { ...young, birth: { birthYearMonth: "1995-04", bornOnFirst: false } };
    expect(educationFinished(old, undefined, BASE)).toBe(true);
    expect(educationFinished(old, { id: "g", kind: "education", owner: "x", education: { stages: [], loans: [{ at: { at: "2015-04" }, amount: 1000000, rate: "0.02", termMonths: 180, borrower: "x" }] } } as never, BASE)).toBe(false);
  });
});

describe("企業年金を年金で受け取るときの時点と既定の勤め先（0150）", () => {
  // 再雇用の見本（正社員 1990-04〜2027-03、その後は再雇用）を、再雇用の期間の中の月で開く
  const senior = (): WorkingHousehold => {
    const req = modelHousehold("reemployment");
    req.input.baseMonth = "2027-06";
    return fromRequest(req);
  };

  it("今が再雇用でも、足した企業年金の勤め先は正社員の期間。年金だけで受け取ると「受け取る時期」を出さず、年金の始まりの空欄は辞めた翌月", () => {
    const wh = senior();
    const self = hh(wh).members.find((m) => m.kind === "self")!;
    expect(benefitPeriod(hh(wh), self, "2027-06", "db")?.type).toBe("regular");
    const acts = actionsOf("retirement", wh);
    const add = acts.find((a) => a.key === `retirement/${self.id}/add/db`) ?? acts.find((a) => a.key === `retirement/${self.id}/add` && a.label === "確定給付企業年金");
    expect(add).toBeDefined();
    const added = add!.run(wh);
    const db = (hh(added).retirementBenefits ?? []).find((b) => b.kind === "db");
    expect(db).toBeDefined();
    if (db === undefined) return;
    expect(db.employment).toBe("334ee36a-7a18-45da-8347-c66078d61a5a");
    const method = fieldOf("retirement", added, (f) => f.key.endsWith(`${db.id}/method`) || (f.label === "受け取り方" && f.key.includes(db.id)));
    const annuity = method.set(added, "annuity");
    const keys = allFields(stage("retirement", annuity)).filter((f) => f.key.includes(db.id)).map((f) => f.label);
    expect(keys).not.toContain("受け取る時期");
    const start = fieldOf("retirement", annuity, (f) => f.label === "年金の始まり" && f.key.includes(db.id));
    expect(start.time?.when.nullText).toBe("勤め先を辞めた翌月（2027年4月）");
    computes(annuity);
  });

  it("国民年金基金・今が正社員の人は、今の期間のまま", () => {
    const wh = withMember("1980-05", (h, self) => {
      h.employmentPeriods = [{ id: "bbbbbbbb-0000-4000-8000-000000000001", member: self.id, type: "regular", from: { at: "2003-04" }, to: null, salary: { annual: { value: 6000000, state: "confirmed", origin: { kind: "manual" } } } }] as never;
    });
    const self = hh(wh).members[0] as Member;
    expect(benefitPeriod(hh(wh), self, BASE, "db")?.id).toBe("bbbbbbbb-0000-4000-8000-000000000001");
  });
});

describe("介護の期間と見出し（0150）", () => {
  it("亡くなる見込みが期間の途中なら、期間の欄の下に「亡くなる見込みで止まり、…まで（費用は○か月分）」。見出しは在宅・施設を入れず、要約の頭に", () => {
    const wh0 = open("sampleParentsCare");
    const c0 = (hh(wh0).careExpenses ?? [])[0]!;
    const from = resolveTimepoint(hh(wh0), c0.from)!;
    // 介護を受ける人の亡くなる見込みを、介護が始まって10か月後にする
    const wh = mutate(wh0, (h) => void (h.members.find((m) => m.id === c0.member)!.leaves = { at: shiftMonth(from, 10) }));
    const c = (hh(wh).careExpenses ?? [])[0]!;
    expect(careDeathCut(wh, c)).toEqual({ last: shiftMonth(from, 9), months: 10 });
    const f = fieldOf("care", wh, (x) => x.key === `ev/care/${c.id}/months`);
    expect(f.get(wh).hint).toMatch(/亡くなる見込みで止まり、\d{4}年\d{1,2}月まで（費用は\d+か月分）/);
    const g = stage("care", wh).sections.flatMap((s) => s.groups).find((x) => x.key === `ev/care/${c.id}` || x.fields.some((y) => y.key === `ev/care/${c.id}/months`))!;
    expect(g.title).not.toMatch(/（在宅）|（施設）/);
    expect(careSpan(wh, c)).toMatch(/^(在宅|施設)・/);
  });
});

describe("年金の見込みの内訳は見込みの行のすぐ下（0150）", () => {
  it("書類の額と見込みが違えば、内訳の1行（?の中ではない）", () => {
    const wh = open("pensionCouple");
    const recs = hh(wh).pensionRecords ?? [];
    expect(recs.some((r) => r.kind === "statementOver50" || r.kind === "projection" || r.kind === "receiving")).toBe(true);
    const r = preview(wh.request as EngineRequest);
    const v = estimateView(wh, { std: r, claimed: null });
    expect(v).not.toBeNull();
    for (const p of v!.people) expect(p.sub.some((s) => s.startsWith("内訳:"))).toBe(false);
    expect(v!.people.some((p) => p.breakdown !== null && p.breakdown.startsWith("内訳: 書類の額"))).toBe(true);
  });
});

describe("対策の基準の額と、働く最後の年齢の説明（0150）", () => {
  const senior2 = (): WorkingHousehold => {
    const req = modelHousehold("reemployment");
    req.input.baseMonth = "2027-06";
    return fromRequest(req);
  };
  it("生活費・NISA の額は万円の小数1桁（「月20.9万円」）", () => {
    expect(leverValueText("livingMonthly", 209000)).toBe("月20.9万円");
    expect(leverValueText("livingMonthly", 300000)).toBe("月30万円");
    expect(leverValueText("nisaMonthly", 0)).toBe("なし");
    expect(leverValueText("nisaMonthly", 33000)).toBe("月3.3万円");
  });

  it("もう定年の後の働き方にいる人には、過去の定年の文でなく「今の働き方（再雇用・年収350万円）のまま」", () => {
    const wh0 = senior2();
    const self = hh(wh0).members.find((m) => m.kind === "self")!;
    const wh: WorkingHousehold = { ...wh0, postRetirement: { [self.id]: { ...(wh0.postRetirement[self.id] ?? {}), fromAge: 60, type: "contract", annualSalary: 3990000 } as never } };
    const cat = buildCatalog(wh, self.id, null);
    const it = cat.byKey.get("lever:retireAge");
    expect(it).toBeDefined();
    expect(it!.note?.(65)).toBe("今の働き方（再雇用・年収360万円）のまま");
  });
});

describe("カードの推定の1行・内訳の推定・パネルの頭の数（0150）", () => {
  it("推定で計算中のカードの1行は、推定のまま残っている欄の名前（決まった文は、欄の名前の無い推定のときだけ）", () => {
    const wh = open("salariedCoupleTwoKids");
    for (const c of inputItems(wh)) {
      if (c.status !== "est" || c.hint === null) continue;
      if ((c.estimatedNames ?? []).length > 0 && !(c.id === "pension" && c.hint === "働き方の期間から推計して計算中です")) expect(c.hint, c.id).toMatch(/^推定のまま: /);
    }
  });

  it("パネルの頭: 見えている推定が全部より少なければ2つの数", () => {
    expect(statusText({ status: "est", estimated: 34 }, 8)).toBe("推定で計算中（見えている 8か所・詳細を含め 34か所）");
    expect(statusText({ status: "est", estimated: 8 }, 8)).toBe("推定で計算中（8か所）");
    expect(statusText({ status: "est", estimated: 8 })).toBe("推定で計算中（8か所）");
  });
});

describe("iDeCo の積立の最後（0150）", () => {
  it("受け取りを始める年齢と加入できる年齢の上限の早いほう。受け取りが先なら「65歳で受け取りを始める前の月まで」", () => {
    const wh = open("salariedCoupleTwoKids");
    const self = hh(wh).members.find((m) => m.kind === "self")!;
    const w = mutate(wh, (h) => void (h.accounts ??= []).push({ id: "dddddddd-0000-4000-8000-000000000001", kind: "ideco", owner: self.id, value: { value: 800000, state: "confirmed", origin: { kind: "manual" } } } as never));
    const a = (hh(w).accounts ?? []).find((x) => x.kind === "ideco")!;
    const s = idecoStop(w.request, a)!;
    expect(s.stopAge).toBeLessThanOrEqual(70);
    expect(s.endNote).toMatch(/歳で受け取りを始める前の月まで$|歳になる前の月まで・加入できる年齢の上限$/);
  });
});

describe("あげる贈与の既定の相手（0150）", () => {
  it("子が1人ならその子（印なし）。2人以上なら第1子に推定の印", () => {
    const one = withMember("1970-01", (h) => h.members.push({ id: "eeeeeeee-0000-4000-8000-000000000001", kind: "child", birth: { birthYearMonth: "2000-04", bornOnFirst: false }, sex: "male", joins: null, leaves: null, expected: false }));
    const a1 = runAction("inheritance", one, (k) => k.endsWith("/add/gift"));
    const g1 = (hh(a1).periodicExpenses ?? []).find((p) => p.kind === "gift")!;
    expect(g1.counterparty).toBe("eeeeeeee-0000-4000-8000-000000000001");
    const f1 = fieldOf("inheritance", a1, (f) => f.key === `ev/${g1.id}/counterparty`);
    expect(fieldStatus(f1, a1).status).toBe("confirmed");
    const two = withMember("1970-01", (h) => {
      h.members.push({ id: "eeeeeeee-0000-4000-8000-000000000002", kind: "child", birth: { birthYearMonth: "2003-04", bornOnFirst: false }, sex: "male", joins: null, leaves: null, expected: false });
      h.members.push({ id: "eeeeeeee-0000-4000-8000-000000000001", kind: "child", birth: { birthYearMonth: "2000-04", bornOnFirst: false }, sex: "female", joins: null, leaves: null, expected: false });
    });
    const a2 = runAction("inheritance", two, (k) => k.endsWith("/add/gift"));
    const g2 = (hh(a2).periodicExpenses ?? []).find((p) => p.kind === "gift")!;
    expect(g2.counterparty).toBe("eeeeeeee-0000-4000-8000-000000000001");
    const f2 = fieldOf("inheritance", a2, (f) => f.key === `ev/${g2.id}/counterparty`);
    expect(fieldStatus(f2, a2).status).toBe("estimated");
    // 選び直すと推定の印は外れる
    const chosen = f2.set(a2, "eeeeeeee-0000-4000-8000-000000000002");
    expect(fieldStatus(f2, chosen).status).toBe("confirmed");
    computes(a2);
    computes(chosen);
    // 保存して読み直しても推定の印のまま
    const back = fromBody(JSON.stringify(bodyObject({ wh: a2, workspace: { template: null, band: [], base: "current", selected: "current", shownItems: [] }, display: { result: {}, balance: {} } as never, carry: EMPTY_CARRY }))).wh;
    expect(fieldStatus(f2, back).status).toBe("estimated");
  });
});

describe("数えない推定・時点の欄の人・「外す」の言葉（入力項目をまたいだそろえ）", () => {
  it("標準報酬月額の空欄の目安・失業給付のおまかせは、確かめの一覧の推定に並ばない（欄の推定の印は今のまま）", () => {
    const wh = open("salariedCoupleTwoKids");
    const rows = checkList(wh).filter((r) => r.kind === "estimated");
    expect(rows.filter((r) => /標準報酬月額|失業給付/.test(r.label))).toEqual([]);
    const smr = allFields(stage("work", wh)).find((f) => f.label.startsWith("標準報酬月額"));
    if (smr !== undefined && fieldStatus(smr, wh).status === "estimated") expect(smr.quietEstimate).toBeDefined();
  });

  it("確かめの一覧の推定の行は、空欄のまま推定で計算する欄でも値を出す", () => {
    const wh = open("salariedCoupleTwoKids");
    for (const r of checkList(wh).filter((x) => x.kind === "estimated")) expect(r.value ?? null, r.label).not.toBeNull();
  });

  it("年金の受け取り開始は本人の年齢だけ、保険の保障の終わり・預金の引き出せない期間の終わりの人の候補に子を出さない", () => {
    const wh = open("salariedCoupleTwoKids");
    const kids = new Set(hh(wh).members.filter((m) => m.kind === "child").map((m) => m.id));
    for (const st of buildStages(wh))
      for (const f of allFields(st)) {
        const t = f.time;
        if (t === undefined) continue;
        if (!/受け取り開始|保障の終わり|引き出せない期間の終わり|手放す時期|買い替える年齢/.test(f.label)) continue;
        const ctx = t.state(wh).ctx;
        const keep = ctx.person;
        expect(ctx.people.filter((p) => kids.has(p.id) && p.id !== keep).map((p) => p.id), f.key).toEqual([]);
      }
  });

  it("「外す」はどこも「外す」（この家族を・この期間を・この契約を・進路を・この変化を、を付けない）。FP顧問料の契約だけは見出しの「この契約を外す」", () => {
    const wh = open("salariedCoupleTwoKids");
    const labels = buildStages(wh).flatMap((st) => st.sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)])).map((a) => a.label);
    for (const l of labels) expect(l, l).not.toMatch(/^(この家族|この期間|進路|この変化|推定の変化)を外す$/);
    const ins = actionsOf("insurance", wh).map((a) => a.label);
    expect(ins).not.toContain("この契約を外す");
  });
});

describe("お金の3つの分け方の一覧の小さな月額（入力項目をまたいだそろえ）", () => {
  it("10万円未満の月額は小数1桁（「保険料 月0.5万円」。月0万円にしない）。大きな額・1回の額は今までどおり", () => {
    expect(itemMan({ per: "月", amount: 4500 })).toBe("0.5");
    expect(itemMan({ per: "月", amount: 30000 })).toBe("3");
    expect(itemMan({ per: "月", amount: 0 })).toBe("0");
    expect(itemMan({ per: "月", amount: 330000 })).toBe("33");
    expect(itemMan({ per: "", amount: 4500 })).toBe("0");
  });
});
