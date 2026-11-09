// Web のヒアリングの書類の頼み方（0190）: FP の画面（書類の持ち主・書類で分かる問いの言い方・書類待ちから頼む）と、お客さまの画面（1通1画面・
// 「手元にない」でその場で聞く・最初の画面の一言）。発行 → お客さまが「手元にない」で答える → FP が受け取る、の一周
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { handleApi } from "../../hearing/relay/handler.ts";
import { memoryStore } from "../../hearing/relay/store.ts";
import { answersOf, draftKey, initialDraft, openRequest, screens, submitAnswers, type Draft, type RelayTransport } from "../../hearing/src/web/index.ts";
import { API_PREFIX } from "../../hearing/src/web/protocol.ts";
import { HearingForm } from "../src/hearingForm/Form.tsx";
import { coverageHelp, coverageOf, defaultOwner, documentFromCheck, documentFromTemplate, invitationText, issueWeb, officeFace, previewPacket, receiveWeb, sheetOf, templateSelection, withOwner } from "../src/workspace/hearing/web.ts";
import type { DocRequest } from "../src/workspace/input/docRequests.ts";
import { blankHousehold, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";

const OFFICE = officeFace({ name: "【架空】みらいFP事務所", color: "#2f6f5e", purpose: "ライフプランの作成のため", privacyContact: "" });
const NOW = new Date("2026-11-05T09:00:00Z");
let n = 0;
const blank = (): WorkingHousehold => withRefreshedEstimates(blankHousehold("2026-11", () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`));
const v = (text: string) => ({ status: "value" as const, raw: { kind: "text" as const, text } });

function relayFor() {
  const store = memoryStore();
  const t: RelayTransport = async (r) => {
    const headers: Record<string, string> = {};
    if (r.token !== undefined) headers.authorization = `Bearer ${r.token}`;
    const res = await handleApi(new Request(`https://relay.test${API_PREFIX}${r.path}`, { method: r.method, headers, ...(r.body !== undefined ? { body: r.body } : {}) }), { store, now: () => NOW });
    return { status: res.status, body: await res.text() };
  };
  return { t };
}

/** 簡易の票に源泉徴収票（ご本人）とねんきん定期便（ご本人）、詳細の票なら年金の問いも */
function selection(kind: "simple" | "detail" = "simple") {
  const wh = blank();
  const s0 = templateSelection(kind, wh);
  const d1 = documentFromTemplate(s0, "withholding", defaultOwner(s0, "withholding"));
  const s1 = { ...s0, documents: [d1] };
  return { wh, sel: { ...s1, documents: [d1, documentFromTemplate(s1, "pensionNotice", defaultOwner(s1, "pensionNotice"))] } };
}

describe("FP の画面: 書類の持ち主と、書類で分かる問いの言い方", () => {
  it("人の書類はご本人から（同じ書類をもう一度足すと配偶者の方）。持ち主を変えると見出しの括弧も変わる", () => {
    const s0 = templateSelection("simple", blank());
    expect(defaultOwner(s0, "withholding")).toBe("self");
    expect(defaultOwner(s0, "deposits")).toBeUndefined();
    expect(defaultOwner(s0, "insurancePolicy")).toBeUndefined();
    const d1 = documentFromTemplate(s0, "withholding", "self");
    expect(d1).toMatchObject({ title: "源泉徴収票（ご本人）", owner: "self" });
    const s1 = { ...s0, documents: [d1] };
    expect(defaultOwner(s1, "withholding")).toBe("spouse");
    expect(withOwner(d1, "spouse")).toMatchObject({ title: "源泉徴収票（配偶者の方）", owner: "spouse" });
    const off = withOwner(d1, undefined);
    expect(off.title).toBe("源泉徴収票");
    expect("owner" in off).toBe(false);
  });

  it("項目の行の言い方: 「源泉徴収票（ご本人）の数字を使います」と「？」の説明", () => {
    const { sel } = selection("detail");
    const def = sheetOf(sel)!;
    const c = coverageOf(def, sel);
    expect(c.get("hs.income.salary")).toEqual({ docs: ["源泉徴収票（ご本人）"], who: ["ご本人"] });
    expect(c.get("hs.pension.months.total")).toEqual({ docs: ["ねんきん定期便（ご本人）"], who: ["ご本人"] });
    expect(c.has("hs.work.type")).toBe(false);
    expect(coverageHelp(c.get("hs.income.salary")!)).toBe("源泉徴収票（ご本人）を頼んでいるので、お客さまの画面にはこの問い（ご本人の分）を出しません。お客さまが「手元にない」を選んだときだけ、この問いを出します。");
    const loan = { ...sel, documents: [documentFromTemplate(sel, "loanSchedule")] };
    expect(coverageHelp(coverageOf(def, loan).get("hs.loan.rate")!)).toBe("住宅ローンの返済予定表を頼んでいるので、お客さまの画面にはこの問いを出しません。お客さまが「手元にない」を選んだときだけ、この問いを出します。");
  });

  it("書類待ちの1通から頼むと、人の書類は持ち主も入る（見出しは「ねんきん定期便（配偶者の方）」）", () => {
    const s0 = templateSelection("detail", blank());
    const r: DocRequest = { id: "ねんきん定期便|m2", doc: "ねんきん定期便", whose: "配偶者", title: "ねんきん定期便（配偶者）", values: [], holder: "m2", object: null };
    expect(documentFromCheck(s0, r)).toMatchObject({ kind: "pensionNotice", title: "ねんきん定期便（配偶者の方）", owner: "spouse", docRequest: r.id });
    const loan: DocRequest = { id: "住宅ローンの返済予定表|l1", doc: "住宅ローンの返済予定表", whose: null, title: "住宅ローンの返済予定表", values: [], holder: null, object: "l1" };
    const d = documentFromCheck(s0, loan);
    expect(d.kind).toBe("loanSchedule");
    expect(d.owner).toBeUndefined();
  });

  it("案内文の番号の注意は、お客さまの画面と同じ言い方", async () => {
    const { t } = relayFor();
    const { wh, sel } = selection();
    const r = await issueWeb(wh, { selection: sel, customerNo: "A0001", office: OFFICE, pageUrl: "https://relay.test/h/", transport: t, now: NOW });
    expect(invitationText(r.entry, OFFICE.name)).toContain("マイナンバー・基礎年金番号・証券番号・口座番号は、写さないか隠してください。");
  });
});

describe("お客さまの画面: 1通1画面・書類で分かる問いを出さない・「手元にない」でその場で聞く", () => {
  it("最初の画面に「お給料と年金の額は…」。年収の問いは出ない（配偶者の方がいれば、配偶者の方の年収は出る）", async () => {
    const { wh, sel } = selection("detail");
    const p = await previewPacket(wh, sel, OFFICE, NOW);
    const html = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: initialDraft(p), now: () => NOW }));
    expect(html).toContain("お給料と年金の額は、お送りいただく源泉徴収票・ねんきん定期便の数字を使います。そのぶん、お答えいただく問いが少なくなっています。");
    const d: Draft = { ...initialDraft(p), gates: { spouse: 1 }, answers: { [draftKey("hs.work.type", 1)]: v("regular"), [draftKey("hs.work.type", 2)]: v("regular") } };
    const keys = screens(p, d).flatMap((s) => (s.kind === "item" ? s.fields.map((f) => draftKey(f.key, f.index)) : []));
    expect(keys).not.toContain(draftKey("hs.income.salary", 1));
    expect(keys).toContain(draftKey("hs.income.salary", 2));
    expect(keys.some((k) => k.startsWith("hs.pension.") && k.endsWith("#1"))).toBe(false);
  });

  it("書類の画面: 「ご本人さまの源泉徴収票」・お給料の額は、この書類の数字を使います・どこが写っていればよいか・撮る前の注意（隠してよい番号）・何通目か", async () => {
    const { wh, sel } = selection();
    const p = await previewPacket(wh, sel, OFFICE, NOW);
    const html = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: initialDraft(p), startAt: "doc:d1", now: () => NOW }));
    for (const t of ["送っていただきたい書類（1/2）", "ご本人さまの源泉徴収票", "お給料の額は、この書類の数字を使います。", "どこが写っていればよいか", "「支払金額」と「社会保険料等の金額」の欄", "撮る前に", "マイナンバー（個人番号）は、写さないか隠してかまいません。", "明るい所で、書類の全体が入るように", "撮る", "ファイルを選ぶ", "手元にない", "あとで送る"]) expect(html).toContain(t);
    expect(html).not.toContain("聞きません");
    // 2通目はねんきん定期便（簡易の票には年金の問いが無いので、数字を使う一言は出さない）
    const second = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: initialDraft(p), startAt: "doc:d2", now: () => NOW }));
    for (const t of ["送っていただきたい書類（2/2）", "ご本人さまのねんきん定期便", "基礎年金番号・照会番号は、写さないか隠してかまいません。"]) expect(second).toContain(t);
    expect(second).not.toContain("この書類の数字を使います");
  });

  it("「手元にない」を選ぶと、その画面で「大丈夫です。かわりに、お給料のだいたいの額をうかがいます（1問）。」と年収の問い", async () => {
    const { wh, sel } = selection();
    const p = await previewPacket(wh, sel, OFFICE, NOW);
    const d: Draft = { ...initialDraft(p), gates: { spouse: 0, child: 0 }, answers: { [draftKey("hs.work.type", 1)]: v("regular") }, documents: { d1: { status: "notAvailable", files: [] } } };
    const html = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: d, startAt: "doc:d1", now: () => NOW }));
    for (const t of ["大丈夫です。かわりに、お給料のだいたいの額をうかがいます（1問）。", "年収", "だいたいの範囲を選んでください", "くわしい額を入れる"]) expect(html).toContain(t);
    // 確かめの画面にも出る
    const rv = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: d, startAt: "review", now: () => NOW }));
    expect(rv).toContain("書類のかわりにうかがったこと");
    expect(rv).toContain("ご本人さまの源泉徴収票");
    // 「あとで送る」は問いを出さず、送れる時期を言う
    const later = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: { ...d, documents: { d1: { status: "later", files: [] } } }, startAt: "doc:d1", now: () => NOW }));
    expect(later).not.toContain("かわりに");
    expect(later).toContain("お答えを送った後でも");
  });
});

describe("発行 → お客さまが「手元にない」でかわりに答える → FP が受け取る", () => {
  it("書類の状態と、かわりに答えた年収が FP に届く。書類を頼んだご本人の年収は、書類が届くまで答えに入らない", async () => {
    const { t } = relayFor();
    const { wh, sel } = selection();
    const r = await issueWeb(wh, { selection: sel, customerNo: "A0001", office: OFFICE, pageUrl: "https://relay.test/h/", transport: t, now: NOW });
    const o = await openRequest(new URL(r.entry.record.url).hash, t);
    expect(o.packet.documents.map((x) => [x.id, x.owner, x.covers])).toEqual([
      ["d1", "self", ["hs.income.annual#1", "hs.income.annualRange#1"]],
      ["d2", "self", undefined],
    ]);
    const base: Draft = { ...initialDraft(o.packet), gates: { spouse: 0, child: 0 }, answers: { [draftKey("hs.consent.purpose")]: v("given"), [draftKey("hs.work.type", 1)]: v("regular"), [draftKey("hs.income.annualRange", 1)]: v("500〜600万円") } };
    // 書類を「まだ」のまま送ると、年収は送らない
    expect(answersOf(o.packet, base, NOW).answers.some((a) => a.key === "hs.income.annualRange")).toBe(false);
    const d: Draft = { ...base, documents: { d1: { status: "notAvailable", files: [] }, d2: { status: "later", files: [] } } };
    await submitAnswers(o, answersOf(o.packet, d, new Date("2026-11-06T09:00:00Z")), t);
    const got = await receiveWeb(r.wh, r.entry, t, NOW);
    expect(got).not.toBeNull();
    expect(got!.entry.received?.documents).toEqual([
      { id: "d1", status: "notAvailable" },
      { id: "d2", status: "later" },
    ]);
    expect(got!.entry.received?.answers).toContainEqual({ key: "hs.income.annualRange", index: 1, status: "value", raw: { kind: "text", text: "500〜600万円" } });
    // 依頼の記録に持ち主が残る（世帯ファイルの形式 0.71）
    expect(got!.entry.record.selection.documents.map((x) => x.owner)).toEqual(["self", "self"]);
  });
});
