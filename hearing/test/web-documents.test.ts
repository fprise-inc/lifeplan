// Web のヒアリングの書類の頼み方（0190）: 書類で分かる問いを出さない・「手元にない」でその場で聞く・「あとで送る」は聞かない・1通1画面・
// 書類の持ち主・書類の一覧・選び方の指紋
import { describe, expect, it } from "vitest";
import { answersOf, baseDocTitle, buildPacket, checkSelection, coverLine, coverSummary, customerDocTitle, documentCovers, DOCUMENT_TEMPLATES, draftKey, estimate, gateAnswersOf, hideTip, HIDE_NUMBERS, initialDraft, insteadLine, screenOf, screens, selectionDigest, selectionFromSheet, WEB_NOTES, type Draft, type DraftAnswer, type QuestionsPacket, type RequestedDocument, type Screen, type WebSelection } from "../src/web/index.ts";
import type { SheetDefinition } from "../src/definition.ts";
import { full4, simple } from "./helpers.ts";

const OFFICE = { name: "【架空】みらいFP事務所", color: null, purpose: "ライフプランの作成のため", privacyContact: "" };
const v = (text: string, kind: "text" | "number" = "text"): DraftAnswer => ({ status: "value", raw: { kind, text } });
const tpl = (kind: string) => DOCUMENT_TEMPLATES.find((t) => t.kind === kind)!;
const doc = (id: string, kind: string, owner?: "self" | "spouse"): RequestedDocument => ({ id, kind, title: owner === undefined ? tpl(kind).title : `${tpl(kind).title}（${owner === "self" ? "ご本人" : "配偶者の方"}）`, purpose: tpl(kind).purpose, where: tpl(kind).where, ...(owner !== undefined ? { owner } : {}) });
const pack = (def: SheetDefinition, documents: RequestedDocument[]): Promise<QuestionsPacket> => buildPacket(def, { ...selectionFromSheet(def), documents }, { requestId: "R-7K3P9Q", expiresAt: "2026-12-05T09:00:00Z", office: OFFICE });
/** 問いの画面に出る問い（画面にまとめた問いも1つずつ） */
const asked = (list: Screen[]) => list.flatMap((s) => (s.kind === "item" ? s.fields.map((f) => draftKey(f.key, f.index)) : []));
const docScreen = (list: Screen[], id: string) => list.find((s): s is Extract<Screen, { kind: "document" }> => s.kind === "document" && s.id === id)!;
const withDoc = (d: Draft, id: string, status: "notAvailable" | "later" | "attached" | "blank"): Draft => ({ ...d, documents: { ...d.documents, [id]: { status, files: [] } } });
/** 夫婦と子2人・会社員と会社員・賃貸（簡易の票）／持ち家・住宅ローン1本・保険2件（詳細の票） */
const family = (p: QuestionsPacket): Draft => ({ ...initialDraft(p), gates: { spouse: 1, child: 2, loan: 1, policy: 2, parent: 0 }, answers: { [draftKey("hs.work.type", 1)]: v("regular"), [draftKey("hs.work.type", 2)]: v("regular"), [draftKey("hs.housing.type")]: v("own") } });
const count = (list: Screen[]) => ({ screens: list.filter((s) => s.kind === "consent" || s.kind === "gate" || s.kind === "item" || s.kind === "document").length, questions: asked(list).length });

describe("書類と問いの対応（documentCovers）", () => {
  it("人の書類は持ち主の分だけ・持ち主を選ばない人の書類は挙げない・預貯金などは選ばなければ全員の分とご家族の合計・範囲の項目は付いてくる", () => {
    const def = simple();
    const s = selectionFromSheet(def);
    expect(documentCovers(def, s, doc("d1", "withholding", "self"))).toEqual(["hs.income.annual#1", "hs.income.annualRange#1"]);
    expect(documentCovers(def, s, doc("d1", "withholding", "spouse"))).toEqual(["hs.income.annual#2", "hs.income.annualRange#2"]);
    expect(documentCovers(def, s, doc("d1", "withholding"))).toEqual([]);
    expect(documentCovers(def, s, doc("d1", "deposits"))).toEqual(["hs.assets.depositTotal", "hs.assets.depositTotalRange"]);
    // 1人の預貯金の書類では、ご家族の合計は分からない
    expect(documentCovers(def, s, doc("d1", "deposits", "self"))).toEqual([]);
    expect(documentCovers(def, s, doc("d1", "loanSchedule"))).toEqual(["hs.loan.monthlyTotal", "hs.loan.monthlyTotalRange", "hs.loan.balanceTotal", "hs.loan.balanceTotalRange"]);
    // 簡易の票に年金の問いは無い
    expect(documentCovers(def, s, doc("d1", "pensionNotice", "self"))).toEqual([]);
    // 選んでいない項目は挙げない
    const fewer: WebSelection = { ...s, sections: s.sections.map((x) => ({ ...x, items: x.items.filter((i) => !i.key.startsWith("hs.income.")) })) };
    expect(documentCovers(def, fewer, doc("d1", "withholding", "self"))).toEqual([]);
  });

  it("詳細の票: 源泉徴収票は給与の年収・ねんきん定期便は年金の6問・返済予定表はローンの6問（全部のローン）・保険証券は保険の9問（全部の保険）", () => {
    const def = full4();
    const s = selectionFromSheet(def);
    expect(documentCovers(def, s, doc("d1", "withholding", "self"))).toEqual(["hs.income.salary#1"]);
    expect(documentCovers(def, s, doc("d1", "pensionNotice", "self"))).toEqual(["hs.pension.notice.type#1", "hs.pension.notice.asOf#1", "hs.pension.months.total#1", "hs.pension.months.employee#1", "hs.pension.amount.basic#1", "hs.pension.amount.employee#1"]);
    expect(documentCovers(def, s, doc("d1", "pensionAmountNotice", "spouse"))).toEqual(["hs.pension.notice.type#2", "hs.pension.notice.asOf#2", "hs.pension.amount.basic#2", "hs.pension.amount.employee#2"]);
    expect(documentCovers(def, s, doc("d1", "loanSchedule"))).toEqual(["hs.loan.principal", "hs.loan.start", "hs.loan.termYears", "hs.loan.rate", "hs.loan.method", "hs.loan.balance"]);
    expect(documentCovers(def, s, doc("d1", "insurancePolicy"))).toHaveLength(9);
    expect(documentCovers(def, s, doc("d1", "deposits"))).toEqual(["hs.assets.deposit"]);
    expect(documentCovers(def, s, doc("d1", "deposits", "spouse"))).toEqual(["hs.assets.deposit#2"]);
    expect(documentCovers(def, s, doc("d1", "taxReturn", "self"))).toEqual(["hs.income.business#1", "hs.income.taxReturn#1"]);
    // 書類で分かる問いの無い書類
    for (const k of ["payslip", "insuranceDeduction", "otherLoanSchedule", "householdBook", "other"]) expect(documentCovers(def, s, doc("d1", k, k === "payslip" ? "self" : undefined))).toEqual([]);
  });

  it("問いに書類で分かる問いを載せる（PacketDocument.covers）。無ければ載せない", async () => {
    const p = await pack(simple(), [doc("d1", "withholding", "self"), doc("d2", "payslip", "self")]);
    expect(p.documents[0]!.covers).toEqual(["hs.income.annual#1", "hs.income.annualRange#1"]);
    expect(p.documents[1]!.covers).toBeUndefined();
  });
});

describe("頼んだ書類で分かる問いは、お客さまの画面に出さない", () => {
  it("簡易の票: 源泉徴収票（ご本人）を頼むと、ご本人の年収を聞かない（配偶者の方の年収は聞く）。働き方の画面は残る", async () => {
    const def = simple();
    const before = await pack(def, []);
    const after = await pack(def, [doc("d1", "withholding", "self")]);
    const a = screens(after, family(after));
    expect(asked(screens(before, family(before)))).toContain(draftKey("hs.income.annual", 1));
    expect(asked(a)).not.toContain(draftKey("hs.income.annual", 1));
    expect(asked(a)).toContain(draftKey("hs.income.annual", 2));
    expect(asked(a)).toContain(draftKey("hs.work.type", 1));
    // 書類の画面は1通1画面
    expect(a.filter((s) => s.kind === "document").map((s) => s.kind === "document" && s.id)).toEqual(["d1"]);
  });

  it("「手元にない」を選ぶと、その書類の画面で年収を聞く（範囲が先の1問）。答えは届く。「あとで送る」「まだ」は聞かない", async () => {
    const p = await pack(simple(), [doc("d1", "withholding", "self")]);
    const none = withDoc(family(p), "d1", "notAvailable");
    const s = docScreen(screens(p, none), "d1");
    expect(s.fields.map((f) => [draftKey(f.key, f.index), f.alt])).toEqual([[draftKey("hs.income.annual", 1), ["hs.income.annualRange"]]]);
    expect(insteadLine(p.documents[0]!, s, p)).toBe("大丈夫です。かわりに、お給料のだいたいの額をうかがいます（1問）。");
    expect(asked(screens(p, none))).not.toContain(draftKey("hs.income.annual", 1));
    const answered = { ...none, answers: { ...none.answers, [draftKey("hs.income.annualRange", 1)]: v("500〜600万円") } };
    expect(answersOf(p, answered, new Date("2026-11-06T00:00:00Z")).answers).toContainEqual({ key: "hs.income.annualRange", index: 1, status: "value", raw: { kind: "text", text: "500〜600万円" } });
    // 「手元にない」をやめたら、答えは送らない（下書きには残る）
    const back = withDoc(answered, "d1", "blank");
    expect(answersOf(p, back, new Date("2026-11-06T00:00:00Z")).answers.some((a) => a.key === "hs.income.annualRange")).toBe(false);
    for (const st of ["later", "blank", "attached"] as const) {
      const d = withDoc(family(p), "d1", st);
      expect(docScreen(screens(p, d), "d1").fields).toEqual([]);
      expect(asked(screens(p, d))).not.toContain(draftKey("hs.income.annual", 1));
    }
    // 働いていない方には、「手元にない」でも年収を聞かない
    const idle = withDoc({ ...family(p), answers: { ...family(p).answers, [draftKey("hs.work.type", 1)]: v("unemployed") } }, "d1", "notAvailable");
    expect(docScreen(screens(p, idle), "d1").fields).toEqual([]);
    expect(insteadLine(p.documents[0]!, docScreen(screens(p, idle), "d1"), p)).toBe("大丈夫です。担当の FP にお伝えします。");
  });

  it("同じ問いを2通の書類で分かるとき（源泉徴収票と確定申告書）、両方が「手元にない」のときだけ、前の書類の画面で1回聞く", async () => {
    const p = await pack(simple(), [doc("d1", "withholding", "self"), doc("d2", "taxReturn", "self")]);
    const one = withDoc(family(p), "d1", "notAvailable");
    expect(docScreen(screens(p, one), "d1").fields).toEqual([]);
    const both = withDoc(one, "d2", "notAvailable");
    expect(docScreen(screens(p, both), "d1").fields.map((f) => draftKey(f.key, f.index))).toEqual([draftKey("hs.income.annual", 1)]);
    expect(docScreen(screens(p, both), "d2").fields).toEqual([]);
  });

  it("詳細の票: 保険証券を頼むと、保険の件数も保険の問いも出さない。「手元にない」なら書類の画面で件数を聞き、件数の分だけ聞く", async () => {
    const def = full4();
    const p = await pack(def, [doc("d1", "insurancePolicy")]);
    const d = family(p);
    const list = screens(p, d);
    expect(list.some((s) => s.kind === "gate" && s.gates.includes("policy"))).toBe(false);
    expect(asked(list).some((k) => k.startsWith("hs.insurance."))).toBe(false);
    const none = withDoc({ ...d, gates: { ...d.gates, policy: undefined } as Draft["gates"] }, "d1", "notAvailable");
    const s0 = docScreen(screens(p, none), "d1");
    expect(s0.gates).toEqual(["policy"]);
    expect(s0.fields).toEqual([]);
    const two = { ...none, gates: { ...none.gates, policy: 2 } };
    const s2 = docScreen(screens(p, two), "d1");
    expect(new Set(s2.fields.map((f) => f.index))).toEqual(new Set([1, 2]));
    expect(gateAnswersOf(p, two).policy).toBe(2);
    // 書類を頼んでいても「手元にない」でないなら、保険の件数は届かない（聞いていない）
    expect(gateAnswersOf(p, { ...d, gates: { ...d.gates, policy: 2 } }).policy).toBeUndefined();
  });

  it("配偶者の方の書類は、配偶者の方が「いらっしゃらない」なら出さない", async () => {
    const p = await pack(simple(), [doc("d1", "withholding", "self"), doc("d2", "withholding", "spouse")]);
    const single = { ...family(p), gates: { ...family(p).gates, spouse: 0 } };
    expect(screens(p, single).filter((s) => s.kind === "document").map((s) => s.kind === "document" && s.id)).toEqual(["d1"]);
    expect(screens(p, family(p)).filter((s) => s.kind === "document")).toHaveLength(2);
  });

  it("見本の「見る」: 書類で分かる問いは、その書類の画面を開く", async () => {
    const p = await pack(simple(), [doc("d1", "withholding", "self")]);
    expect(screenOf(screens(p, initialDraft(p)), "hs.income.annual")?.kind).toBe("document");
    // 配偶者の方がいれば、配偶者の方の年収は問いの画面にあるので、そちらが先
    expect(screenOf(screens(p, family(p)), "hs.income.annual")?.kind).toBe("item");
    const q = await pack(full4(), [doc("d1", "pensionNotice")]);
    // 持ち主を選ばない人の書類は、問いを出さないことにしない
    expect(screenOf(screens(q, initialDraft(q)), "hs.pension.months.total")?.kind).toBe("item");
    const r = await pack(full4(), [doc("d1", "insurancePolicy")]);
    expect(screenOf(screens(r, initialDraft(r)), "hs.insurance.premium")?.kind).toBe("document");
  });
});

describe("画面の数と問いの数（夫婦と子2人・会社員の夫婦・持ち家）", () => {
  it("簡易の票で源泉徴収票（ご本人）とねんきん定期便（ご本人）を頼む: 頼まないときより問いは1つ減り、書類の画面が2つ増える（1通1画面）", async () => {
    const def = simple();
    const none = await pack(def, []);
    const two = await pack(def, [doc("d1", "withholding", "self"), doc("d2", "pensionNotice", "self")]);
    const a = count(screens(none, family(none)));
    const b = count(screens(two, family(two)));
    expect(b.questions).toBe(a.questions - 1);
    expect(b.screens).toBe(a.screens + 2);
    expect(estimate(two).screens).toBe(estimate(none).screens);
  });

  it("詳細の票で源泉徴収票（ご本人）・ねんきん定期便（ご本人）・保険証券・返済予定表を頼むと、問いの画面が大きく減る", async () => {
    const def = full4();
    const none = await pack(def, []);
    const four = await pack(def, [doc("d1", "withholding", "self"), doc("d2", "pensionNotice", "self"), doc("d3", "insurancePolicy"), doc("d4", "loanSchedule")]);
    const a = count(screens(none, family(none)));
    const b = count(screens(four, family(four)));
    // 給与の年収1・年金6・保険9×2件・ローン6×1本、保険の件数の分岐1
    expect(a.questions - b.questions).toBe(1 + 6 + 18 + 6);
    expect(b.screens).toBeLessThan(a.screens);
  });
});

describe("お客さまの画面の言葉", () => {
  it("最初の画面の一言・書類の画面の一言・見出しの持ち主", async () => {
    const p = await pack(full4(), [doc("d1", "withholding", "self"), doc("d2", "pensionNotice", "self"), doc("d3", "payslip", "self")]);
    expect(coverSummary(p, initialDraft(p))).toBe("お給料と年金の額は、お送りいただく源泉徴収票・ねんきん定期便の数字を使います。そのぶん、お答えいただく問いが少なくなっています。");
    expect(coverLine(p.documents[0]!)).toBe("お給料の額は、この書類の数字を使います。");
    expect(coverLine(p.documents[2]!)).toBeNull();
    expect(customerDocTitle(p.documents[0]!)).toBe("ご本人さまの源泉徴収票");
    expect(baseDocTitle(p.documents[0]!)).toBe("源泉徴収票");
    expect(customerDocTitle({ title: "源泉徴収票（配偶者の方）", owner: "spouse" })).toBe("配偶者の方の源泉徴収票");
    expect(customerDocTitle({ title: "保険証券（加入している保険のすべて）" })).toBe("保険証券（加入している保険のすべて）");
    const q = await pack(full4(), [doc("d1", "payslip", "self")]);
    expect(coverSummary(q, initialDraft(q))).toBeNull();
    // 「聞きません」とは言わない
    expect(coverSummary(p, initialDraft(p))).not.toContain("聞きません");
  });

  it("番号の注意を3か所でそろえる（最初の画面・書類の画面・案内文）。書類ごとに隠してよい番号", () => {
    expect(WEB_NOTES.join("")).toContain("マイナンバー・基礎年金番号・証券番号・口座番号");
    expect(HIDE_NUMBERS).toBe("マイナンバー・基礎年金番号・証券番号・口座番号は、写さないか隠してください。");
    expect(hideTip("withholding")).toBe("マイナンバー（個人番号）は、写さないか隠してかまいません。");
    expect(hideTip("insurancePolicy")).toBe("証券番号は、写さないか隠してかまいません。");
    expect(hideTip("payslip")).toBe(HIDE_NUMBERS);
    expect(hideTip(null)).toBe(HIDE_NUMBERS);
  });
});

describe("書類の一覧・持ち主・選び方の指紋", () => {
  it("一覧に足した書類（預貯金・証券口座・企業型DC・年金額改定通知書・確定申告書と決算書・ほかのローン・控除証明書・賞与の明細・家計簿・賃貸の契約書・その他）", () => {
    const kinds = DOCUMENT_TEMPLATES.map((t) => t.kind);
    for (const k of ["deposits", "securities", "dcNotice", "pensionAmountNotice", "taxReturn", "companyAccounts", "otherLoanSchedule", "insuranceDeduction", "bonusSlip", "householdBook", "rentalContract", "other"]) expect(kinds).toContain(k);
    expect(new Set(kinds).size).toBe(kinds.length);
    // 言い方をそろえる（「分かる物」ではなく「分かるもの」）
    expect(DOCUMENT_TEMPLATES.some((t) => t.title.includes("分かる物"))).toBe(false);
    // どこが写っていればよいか: 「〜が写るように」は付けない（画面の見出しが言う）
    expect(DOCUMENT_TEMPLATES.some((t) => t.where.includes("写るように"))).toBe(false);
    // 書類で分かる問いのある書類には、お客さまの画面の言葉がある
    for (const t of DOCUMENT_TEMPLATES) if (t.covers.length > 0) expect(t.topic, t.kind).toBeDefined();
  });

  it("持ち主の形を確かめる。その他の書類は名前が要る", () => {
    const def = simple();
    const s = selectionFromSheet(def);
    expect(checkSelection(def, { ...s, documents: [doc("d1", "withholding", "spouse")] })).toEqual([]);
    expect(checkSelection(def, { ...s, documents: [{ ...doc("d1", "withholding"), owner: "child" as never }] })).toContain("書類の持ち主が違う: d1");
    expect(checkSelection(def, { ...s, documents: [{ id: "d1", kind: "other", title: "", purpose: "", where: "" }] })).toContain("書類の文が空か長すぎる: d1");
  });

  it("選び方の指紋: 持ち主の無い書類は前と同じ指紋・持ち主を変えると指紋が変わる", async () => {
    const s = selectionFromSheet(simple());
    const plain = await selectionDigest({ ...s, documents: [doc("d1", "withholding")] });
    const title = await selectionDigest({ ...s, documents: [{ ...doc("d1", "withholding"), title: "源泉徴収票（ご本人）" }] });
    expect(title).toBe(plain);
    const self = await selectionDigest({ ...s, documents: [doc("d1", "withholding", "self")] });
    const spouse = await selectionDigest({ ...s, documents: [doc("d1", "withholding", "spouse")] });
    expect(new Set([plain, self, spouse]).size).toBe(3);
  });
});
