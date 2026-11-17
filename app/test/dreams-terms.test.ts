// 「夢と予定」の区画の名前（名前の一覧の result:dreamsAndPlans/…）と、見込みの「?」・見込みが「不確実」の行の注記（説明の一覧）。0212 の追記 2026-11-17
// - 名前: まとまりの名前・列の名前・確実／不確実・「ほか○件を見る」。公式の名前のままなら画面の文字は今までと同じで、承認した事務所の名前はその所だけを変える
// - 見込みの「?」: 5通り（支払い・援助・受け取るお金・相続と贈与・受け継ぐ借金）すべてが一覧に載り、見本の世帯に出ない欄にも当たる
// - 見込みが「不確実」の行の注記: まとまりの説明（section:money.uncertainNote）。注の中のその部分だけを事務所の文にする
import { createHash } from "node:crypto";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { BigMoneyCard } from "../src/workspace/BigMoneyCard.tsx";
import type { BigMoneyModel, BigMoneyRow } from "../src/workspace/bigMoney.ts";
import { Field, Group } from "../src/workspace/input/FieldViews.tsx";
import type { FieldDef, GroupDef } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { addIncome, addInheritedDebt, LIKELIHOOD_HELP, likelihoodHelp, NOTE_PARTS, UNCERTAIN_NOTE, UNCERTAIN_NOTE_ID } from "../src/workspace/input/moneyRows.ts";
import { buildStage, STAGE_ORDER } from "../src/workspace/input/stages/index.ts";
import { fieldTextId, helpTextId } from "../src/workspace/input/textIds.ts";
import { officeTextsFrom, type OfficeTextEntry } from "../src/workspace/office/customTexts.ts";
import { OfficeNamesContext, OfficeTextsContext } from "../src/workspace/office/customTextsContext.ts";
import { OFFICIAL_NAMES, RESULT_TERMS, resultNamesOf } from "../src/workspace/resultTerms.ts";
import { buildTermsCatalog, buildTextsCatalog } from "../scripts/textsCatalog.ts";
import { modelHousehold } from "./helpers.ts";

const sha = (s: string) => `sha256:${createHash("sha256").update(s, "utf8").digest("hex")}`;
const entry = (id: string, text: string, official: string, op: OfficeTextEntry["do"] = "replace"): OfficeTextEntry => ({ id, do: op, text, official, officialChanged: false });
const marks = (s: string) => [...s.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((m) => m[1] as string);
const noop = () => undefined;

// ---- 名前 ----

const row = (n: number, tag: BigMoneyRow["tag"]): BigMoneyRow => ({ key: `out:${String(n)}`, name: `支払い${String(n)}`, when: `${String(2030 + n)}年`, amount: "100万円", tag, included: tag === "確実", pick: { key: `out:${String(n)}` } });
/** まとまり2つ（支払いの予定は12件で「ほか4件を見る」が出る）と、夢 */
const model: BigMoneyModel = {
  line: null,
  groups: [
    { key: "dreams", title: "ご家族の夢", rows: [{ key: "out:d", name: "世界一周", when: "2040年", amount: "300万円", tag: null, included: true, pick: { key: "out:d" } }], included: 1, count: 1 },
    { key: "pay", title: "支払いの予定", rows: Array.from({ length: 12 }, (_, i) => row(i, i % 2 === 0 ? "確実" : "不確実")), included: 6, count: 12 },
    { key: "receive", title: "受け取りの予定", rows: [{ ...row(20, "不確実"), removed: true, pick: null, tag: null }], included: 0, count: 0 },
  ],
};
const card = (names: OfficeTextEntry[] = [], texts: OfficeTextEntry[] = []) =>
  renderToString(h(OfficeTextsContext.Provider, { value: officeTextsFrom(texts) }, h(OfficeNamesContext.Provider, { value: officeTextsFrom(names) }, h(BigMoneyCard, { model, notes: [] }))));
const term = (id: string) => RESULT_TERMS.find((d) => d.id === id)!;

describe("「夢と予定」の区画の名前（名前の一覧の result:dreamsAndPlans/…）", () => {
  const terms = buildTermsCatalog();
  const results = terms.entries.filter((e) => e.kind === "result");

  it("表の名前がすべて名前の一覧に載る（お客さまと一緒に見る名前。書き換えるだけ。数は {count}）", () => {
    expect(results.map((e) => e.id).sort()).toEqual(RESULT_TERMS.map((d) => d.id).sort());
    expect(terms.summary["results"]).toBe(RESULT_TERMS.length);
    expect(results.map((e) => e.text).sort()).toEqual(["ご家族の夢", "ほか{count}を見る", "不確実", "受け取りの予定", "支払いの予定", "時期", "確実", "金額"].sort());
    for (const e of results) {
      expect(e.id).toMatch(/^result:dreamsAndPlans\/[a-zA-Z]+$/);
      expect(e.audience).toBe("customer");
      expect(e.ops).toEqual(["replace"]);
      expect(e.hash).toBe(sha(e.text));
      expect(new Set(marks(e.text)), e.id).toEqual(new Set(e.vars));
      for (const w of ["比べ", "カード", "札", "見通し"]) expect(`${e.text}${e.where}`, e.id).not.toContain(w);
    }
    const more = results.find((e) => e.id === "result:dreamsAndPlans/more")!;
    expect(more.vars).toEqual(["count"]);
    expect(more.numberVars).toEqual(["count"]);
    expect(more.varsHelp?.["count"]).toContain("3件");
    // 名前の一覧の id は説明の一覧の id と重ならない
    const texts = new Set(buildTextsCatalog().entries.map((e) => e.id));
    for (const e of results) expect(texts.has(e.id), e.id).toBe(false);
  });

  it("公式の名前のままなら、画面の文字は今までと同じ（まとまり・列の名前・見込み・「ほか○件を見る」）", () => {
    const html = card();
    for (const s of ["ご家族の夢", "支払いの予定", "受け取りの予定", "時期", "金額", ">確実<", ">不確実<", "ほか4件を見る ▾", "このプランでは外しています"]) expect(html).toContain(s);
    expect(OFFICIAL_NAMES("result:dreamsAndPlans/more", { count: "4件" })).toBe("ほか4件を見る");
    expect(card([entry("result:dreamsAndPlans/groupPay", "これからの支払い", "支払いの予定の前の名前")])).toBe(html);
  });

  it("承認した事務所の名前を当てると、その所だけが変わる（数は同じ値。字のまま出す）", () => {
    const names = [
      entry("result:dreamsAndPlans/groupPay", "これからの支払い", term("result:dreamsAndPlans/groupPay").official),
      entry("result:dreamsAndPlans/columnWhen", "いつ", "時期"),
      entry("result:dreamsAndPlans/tagUncertain", "<b>検討中</b>", "不確実"),
      entry("result:dreamsAndPlans/more", "残り{count}を表示", "ほか{count}を見る"),
    ];
    const html = card(names, [entry("result:dreamsAndPlans/removedNote", "このプランには入れていません", "このプランでは外しています")]);
    for (const s of ["これからの支払い", ">いつ<", "&lt;b>検討中&lt;/b>", "残り4件を表示 ▾", "このプランには入れていません", "aria-label=\"これからの支払い\""]) expect(html).toContain(s);
    for (const s of ["支払いの予定", ">時期<", ">不確実<", "ほか4件を見る", "このプランでは外しています"]) expect(html).not.toContain(s);
    // 変えていない名前は公式のまま
    for (const s of ["ご家族の夢", "受け取りの予定", ">金額<", ">確実<"]) expect(html).toContain(s);
    // 読み上げの見込みも事務所の名前
    expect(html).toContain("支払い1（&lt;b>検討中&lt;/b>）を計算に入れる");
    // 区画の値（数・行の名前・時期・金額）は変わらない
    expect(html.match(/data-bm-row=/g)?.length).toBe(card().match(/data-bm-row=/g)?.length);
    expect(resultNamesOf(officeTextsFrom(names))("result:dreamsAndPlans/more", { count: "4件" })).toBe("残り4件を表示");
  });

  it("当てないもの: 承認したときの公式の名前が違う・消す・空の名前", () => {
    const nm = resultNamesOf(
      officeTextsFrom([
        entry("result:dreamsAndPlans/groupDreams", "夢", "ご家族の夢（前）"),
        entry("result:dreamsAndPlans/columnAmount", "", "金額"),
        { id: "result:dreamsAndPlans/tagCertain", do: "hide", text: null, official: "確実", officialChanged: false },
      ]),
    );
    expect(nm("result:dreamsAndPlans/groupDreams")).toBe("ご家族の夢");
    expect(nm("result:dreamsAndPlans/columnAmount")).toBe("金額");
    expect(nm("result:dreamsAndPlans/tagCertain")).toBe("確実");
  });
});

// ---- 見込みの「?」と、見込みが「不確実」の行の注記 ----

/** 見本の世帯に、受け取るお金（相続・贈与でない）・受け取る相続・相続で受け継ぐ借金を足し、見込みをどれも「不確実」にした世帯 */
function withAll(id: string): WorkingHousehold {
  let w = addInheritedDebt(addIncome(addIncome(fromRequest(modelHousehold(id), {}), "sideJob"), "inheritance"));
  const r = structuredClone(w.request);
  for (const f of r.input.household.incomeFlows ?? []) f.likelihood = "uncertain";
  for (const d of r.input.household.debts ?? []) if (d.inheritedFrom !== undefined) d.likelihood = "uncertain";
  w = fromRequest(r, {});
  return w;
}
const STAGES = [...STAGE_ORDER, { id: "fee" as const, label: "FP顧問料" }];
function* groupsOf(wh: WorkingHousehold): Generator<GroupDef> {
  for (const st of STAGES) for (const sec of buildStage(st.id as never, wh).sections) yield* sec.groups;
}
const likelihoodFields = (wh: WorkingHousehold): FieldDef[] => [...groupsOf(wh)].flatMap((g) => [...g.fields, ...(g.openFields ?? [])]).filter((f) => f.label === "見込み");

describe("見込みの「?」（入力の欄の説明 field:…）", () => {
  const cat = buildTextsCatalog();
  const byId = new Map(cat.entries.map((e) => [e.id, e]));

  it("5通りすべてが一覧に載る（見本の世帯に出ない欄も。入るお金の行は相続・贈与とそれ以外で id を分ける）", () => {
    expect(Object.values(LIKELIHOOD_HELP).map((d) => d.id).sort()).toEqual([
      "field:debt.likelihood",
      "field:goal.education/gifts/*/priority",
      "field:incomeFlow.likelihood",
      "field:incomeFlow.likelihood#receive",
      "field:periodicExpense.priority",
    ]);
    for (const [of, d] of Object.entries(LIKELIHOOD_HELP)) {
      const e = byId.get(d.id);
      expect(e, d.id).toBeDefined();
      expect(e?.text).toBe(likelihoodHelp(of as keyof typeof LIKELIHOOD_HELP));
      expect(e?.kind).toBe("field");
      expect(e?.audience).toBe("fp");
      expect(e?.ops).toEqual(["replace", "append", "hide"]);
    }
    expect(cat.entries.filter((e) => e.text.includes("「不確実」にした")).length).toBe(5);
  });

  it("画面の欄は一覧の id と文で出る（当て先のある欄は、当て先から作る id と同じ。名前・隠す・並べ替えの id は今までのまま）", () => {
    const seen = new Set<string>();
    // 子への援助は educationTwoKids、相続で受け継ぐ借金は親のいる parentMoney に出る
    for (const id of ["educationTwoKids", "parentMoney", "salariedCoupleTwoKids"]) {
      const wh = withAll(id);
      for (const f of likelihoodFields(wh)) {
        const hid = helpTextId(f, wh);
        expect(hid, f.key).not.toBeNull();
        expect(byId.get(hid!)?.text, f.key).toBe(f.help);
        seen.add(hid!);
        const fid = fieldTextId(f, wh);
        if (hid === "field:incomeFlow.likelihood#receive") expect(fid).toBe("field:incomeFlow.likelihood");
        else if (hid === "field:goal.education/gifts/*/priority") expect(fid).toBeNull();
        else expect(fid).toBe(hid);
      }
    }
    expect([...seen].sort()).toEqual(Object.values(LIKELIHOOD_HELP).map((d) => d.id).sort());
  });

  it("見本の世帯に出ない欄（受け取るお金・受け継ぐ借金・子への援助）にも、承認した事務所の文が当たる", () => {
    for (const [of, hh] of [["receive", "educationTwoKids"], ["debt", "parentMoney"], ["gift", "educationTwoKids"]] as const) {
      const wh = withAll(hh);
      const d = LIKELIHOOD_HELP[of];
      const f = likelihoodFields(wh).find((x) => helpTextId(x, wh) === d.id);
      expect(f, of).toBeDefined();
      const html = renderToString(h(OfficeTextsContext.Provider, { value: officeTextsFrom([entry(d.id, `事務所の文（${of}）`, likelihoodHelp(of))]) }, h(Field, { f: f!, wh, onEdit: noop })));
      expect(html, of).toContain(`事務所の文（${of}）`);
      expect(html, of).toContain("事務所の文・公式の文を見る");
    }
    // 相続・贈与の受け取りの方には、受け取るお金の事務所の文は当たらない（id が違う）
    const wh = withAll("educationTwoKids");
    const inherit = likelihoodFields(wh).find((x) => helpTextId(x, wh) === LIKELIHOOD_HELP.inherit.id)!;
    const html = renderToString(h(OfficeTextsContext.Provider, { value: officeTextsFrom([entry(LIKELIHOOD_HELP.receive.id, "事務所の文（receive）", likelihoodHelp("receive"))]) }, h(Field, { f: inherit, wh, onEdit: noop })));
    expect(html).not.toContain("事務所の文（receive）");
  });
});

describe("見込みが「不確実」の行の注記（まとまりの説明 section:money.uncertainNote）", () => {
  const cat = buildTextsCatalog();

  it("一覧に1件。書き換えるだけ（計算に入れていないことを言う注なので消せない）", () => {
    const e = cat.entries.find((x) => x.id === UNCERTAIN_NOTE_ID);
    expect(NOTE_PARTS.map((p) => p.id)).toEqual([UNCERTAIN_NOTE_ID]);
    expect(e).toMatchObject({ kind: "section", audience: "fp", text: UNCERTAIN_NOTE, ops: ["replace"], hash: sha(UNCERTAIN_NOTE) });
    expect(cat.summary.sections).toBe(1);
    expect(cat.entries.filter((x) => x.kind === "section").length).toBe(1);
  });

  it("注の中のその部分だけを事務所の文にする（ほかの部分は公式の文のまま。公式の文が違えば当てない）", () => {
    const wh = withAll("parentMoney");
    const gs = [...groupsOf(wh)].filter((g) => g.note?.includes(UNCERTAIN_NOTE) === true);
    // 入るお金の行・相続で受け継ぐ借金の行（注に別の文が続く）
    expect(gs.length).toBeGreaterThanOrEqual(3);
    const debt = gs.find((g) => g.note !== UNCERTAIN_NOTE && g.note?.startsWith(UNCERTAIN_NOTE) === true)!;
    expect(debt).toBeDefined();
    const render = (g: GroupDef, list: OfficeTextEntry[]) => renderToString(h(OfficeTextsContext.Provider, { value: officeTextsFrom(list) }, h(Group, { group: g, wh, level: "detail", onEdit: noop })));
    const official = render(debt, []);
    expect(official).toContain(UNCERTAIN_NOTE);
    const mine = render(debt, [entry(UNCERTAIN_NOTE_ID, "まだ決まっていないので、計算には入れていません", UNCERTAIN_NOTE)]);
    expect(mine).toContain("まだ決まっていないので、計算には入れていません。借入額・金利・返済は");
    // 公式の文は「事務所の文・公式の文を見る」の中だけ（FP の入力の画面。欄の「?」と同じ）
    expect(mine.split("data-help-office")[0]).not.toContain(UNCERTAIN_NOTE);
    expect(mine).toContain("事務所の文・公式の文を見る");
    expect(render(debt, [entry(UNCERTAIN_NOTE_ID, "前の文", "見込みが「不確実」なので（前の文）")])).toBe(official);
    // 注記の無いまとまりは変わらない
    const plain = [...groupsOf(wh)].find((g) => g.note !== undefined && !g.note.includes(UNCERTAIN_NOTE) && g.fields.length > 0)!;
    expect(render(plain, [entry(UNCERTAIN_NOTE_ID, "まだ決まっていない", UNCERTAIN_NOTE)])).toBe(render(plain, []));
  });
});
