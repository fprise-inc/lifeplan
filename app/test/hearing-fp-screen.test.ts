// Web のヒアリングの FP の画面のまとまり（0192）: ひな形の名前（シンプル・詳細・見直し・カスタム）・シンプルはご両親を外す・数え方を1つに・
// ご相談したいことの話題・独自の質問の答えの形・事務所のひな形に世帯の結びつきを入れない・届いた知らせ・送られた内容・書類待ちの言い分け・0件の承認・案内文
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { handleApi } from "../../hearing/relay/handler.ts";
import { memoryStore } from "../../hearing/relay/store.ts";
import { answersOf, checkSelection, draftKey, estimate, initialDraft, openRequest, packetBody, screens, sendDocuments, submitAnswers, unsentFiles, uploadFile, type Draft, type RelayTransport } from "../../hearing/src/web/index.ts";
import { API_PREFIX } from "../../hearing/src/web/protocol.ts";
import { SHEET_KINDS, applyImport, approvalTime, logOf, sheetFor } from "../src/workspace/hearing/sheet.ts";
import {
  answeredScreens,
  arrivalOf,
  checkArrivals,
  consultNotes,
  documentFromCheck,
  documentFromTemplate,
  estimateOf,
  importWeb,
  invitationText,
  issueWeb,
  listSummary,
  noteArrival,
  officeFace,
  packetOf,
  pageHead,
  pendingCount,
  pendingMark,
  receivedDraft,
  receiveWeb,
  selectedCount,
  selectionName,
  splitSummary,
  templateForSave,
  templateSelection,
  TEMPLATE_OFF_ITEMS,
  HIDDEN_ITEMS,
  WEB_TEMPLATES,
  waitingDocs,
  webLog,
  withCustom,
  withCustomEdit,
} from "../src/workspace/hearing/web.ts";
import { WebBuilder } from "../src/workspace/hearing/WebBuilder.tsx";
import { HearingForm } from "../src/hearingForm/Form.tsx";
import { blankHousehold, fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { DEFAULT_OFFICE_SETTINGS, isDefaultSettings, readOfficeSettings, withHearingTopics } from "../src/workspace/office/settings.ts";
import { selectionFromSheet } from "../../hearing/src/web/packet.ts";
import type { HearingWebHost } from "../src/engine/host.ts";
import { modelHousehold } from "./helpers.ts";

const OFFICE = officeFace({ name: "【架空】みらいFP事務所", color: "#2f6f5e", purpose: "ライフプランの作成のため", privacyContact: "" });
const NOW = new Date("2026-11-05T09:00:00Z");
let n = 0;
const seq = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const blank = (): WorkingHousehold => withRefreshedEstimates(blankHousehold("2026-11", seq));
const filled = (): WorkingHousehold => fromRequest(modelHousehold("salariedCoupleTwoKids"));
const v = (text: string) => ({ status: "value" as const, raw: { kind: "text" as const, text } });
const ym = (y: number, m: number) => ({ status: "value" as const, raw: { kind: "text" as const, text: String(y) }, raw2: { kind: "number" as const, text: String(m) } });
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 2000 }, (_, i) => i % 200)]) as Uint8Array<ArrayBuffer>;

function relayFor() {
  const store = memoryStore();
  const t: RelayTransport = async (r) => {
    const headers: Record<string, string> = {};
    if (r.token !== undefined) headers.authorization = `Bearer ${r.token}`;
    const res = await handleApi(new Request(`https://relay.test${API_PREFIX}${r.path}`, { method: r.method, headers, ...(r.body !== undefined ? { body: r.body } : {}) }), { store, now: () => NOW });
    return { status: res.status, body: await res.text() };
  };
  return { store, t };
}

describe("ひな形の名前と中身（0192）", () => {
  it("URL のひな形はシンプル・詳細・見直し。Excel の種類もシンプルにそろえた", () => {
    expect(WEB_TEMPLATES.map((t) => [t.value, t.label])).toEqual([
      ["simple", "シンプル"],
      ["detail", "詳細"],
      ["review", "見直し"],
    ]);
    expect(SHEET_KINDS.map((k) => k.label)).toEqual(["シンプル", "詳細", "見直し（前回の値つき）"]);
    expect(JSON.stringify([WEB_TEMPLATES, SHEET_KINDS])).not.toMatch(/初回の前|通常/);
  });

  it("シンプルはご両親を既定で外す（詳細は外さない）。名前を選び方に持つ。話題は持たない。これからの予定・ご相談したいことは、どのひな形も既定で外す（0192 の追記）", () => {
    const s = templateSelection("simple", blank());
    expect(s.sections.map((x) => x.id)).not.toContain("parents");
    expect(s.topics).toBeUndefined();
    expect(s.name).toBe("シンプル");
    expect(templateSelection("detail", blank()).sections.map((x) => x.id)).toContain("parents");
    for (const k of ["simple", "detail", "review"] as const) {
      for (const wh of [blank(), filled()]) {
        const keys = templateSelection(k, wh).sections.flatMap((x) => x.items.map((i) => i.key));
        expect(keys).not.toContain("hs.plan.events");
        expect(keys).not.toContain("hs.consult.topics");
        expect(keys.length).toBeGreaterThan(10);
      }
    }
    // シンプルの「これからのこと」は2問とも外したので、区画ごと聞かない
    expect(s.sections.map((x) => x.id)).not.toContain("other");
    // カスタムで選べば聞ける（選べる項目には残る。ご相談したいことは FP の画面の一覧に出さない）
    expect(TEMPLATE_OFF_ITEMS.has("hs.plan.events")).toBe(true);
    expect(HIDDEN_ITEMS.has("hs.plan.events")).toBe(false);
    expect(HIDDEN_ITEMS.has("hs.consult.topics")).toBe(true);
  });

  it("聞く項目の数は、金額の「だいたいの範囲」を数えない。名前の無い前の依頼は元のシートと聞き方から", () => {
    const s = templateSelection("simple", blank());
    const all = s.sections.reduce((k, x) => k + x.items.length, 0);
    expect(selectedCount(s)).toBeLessThan(all);
    expect(selectedCount(s)).toBe(all - s.sections.flatMap((x) => x.items).filter((i) => i.key.endsWith("Range")).length);
    const { name: _n, ...old } = s;
    void _n;
    expect(selectionName(old)).toBe("シンプル");
    expect(selectionName({ ...templateSelection("detail", blank()), name: "" })).toBe("詳細");
  });
});

describe("数え方を1つに（0192。H-106）", () => {
  it("ひな形の時間は、どれも夫婦と子2人で数える（詳細と見直しは同じ項目なら同じ時間）。この世帯の数は別に（0192 の追記）", () => {
    const wh = filled();
    const d = estimateOf(wh, templateSelection("detail", wh))!;
    const r = estimateOf(wh, templateSelection("review", wh))!;
    expect(selectedCount(templateSelection("detail", wh))).toBe(selectedCount(templateSelection("review", wh)));
    expect(r.std).toEqual(d.std);
    // 見直しは前回の値に合わせて問いを飛ばすので、この世帯の数（お客さまの最初の画面・案内文に出る数）は少ない
    expect(r.own).not.toBeNull();
    expect(r.shown.screens).toBeLessThan(r.std.screens);
    expect(r.shown).toEqual(r.own);
    // 見直しでない選び方は、お客さまの画面の数＝基準の数
    expect(d.shown).toEqual(d.std);
  });

  it("FP の画面の数は、お客さまの最初の画面と同じ数え方（夫婦と子2人）。この世帯の人数でも数えて添える", async () => {
    const wh = filled();
    const s = templateSelection("simple", wh);
    const e = estimateOf(wh, s)!;
    const p = packetBody(sheetFor("simple"), s, { requestId: "R-AAAAAA", expiresAt: NOW.toISOString(), office: OFFICE });
    expect(e.std).toEqual(estimate(p));
    expect(e.own).toEqual(estimate(p, { spouse: 1, child: 2, loan: 1, policy: 0, parent: 1 }));
    // 本人だけの新しい世帯は、世帯の人数では数えない
    expect(estimateOf(blank(), s)?.own).toBeNull();
  });
});

describe("ご相談したいことの話題（0192。2026-11-17 にやめた）", () => {
  it("前に発行した依頼（選び方に話題がある）の答えの話題は、今まで通り確かめて取り込みのメモに入り、面談の準備で読める", async () => {
    const { t } = relayFor();
    const wh = blank();
    const def = sheetFor("simple");
    const sel = { ...selectionFromSheet(def), topics: ["教育費", "老後のお金・年金", "相続のこと"], name: "シンプル" };
    const r = await issueWeb(wh, { selection: sel, customerNo: "A1", office: OFFICE, pageUrl: "https://relay.test/h/", transport: t, now: NOW });
    const o = await openRequest(new URL(r.entry.record.url).hash, t);
    // 問いには話題を載せない
    expect(o.packet.items.find((i) => i.key === "hs.consult.topics")?.topics).toBeUndefined();
    const d: Draft = { ...initialDraft(o.packet), gates: { spouse: 0, child: 0 }, answers: { [draftKey("hs.consent.purpose")]: v("given"), [draftKey("hs.consult.topics")]: v("子どもの大学の費用が心配です") } };
    // 前のページから届いた答え（話題つき）
    const ans = { ...answersOf(o.packet, d, NOW), topics: ["相続のこと", "教育費"] };
    await submitAnswers(o, ans, t);
    const got = (await receiveWeb(r.wh, r.entry, t, NOW))!;
    expect(got.entry.received?.topics).toEqual(["教育費", "相続のこと"]);
    const view = importWeb(got.wh, got.entry, "0.1.0", seq);
    expect(view.memo.some((m) => m.includes("選んだ話題: 教育費、相続のこと。子どもの大学の費用が心配です"))).toBe(true);
    expect(consultNotes(got.wh)).toMatchObject({ topics: ["教育費", "相続のこと"], text: "子どもの大学の費用が心配です" });
  });

  it("お客さまの画面: ご相談したいこと（話題・自由記述）は出さない。問いに話題が載っていても、入力内容の確認にも出さない（0138 の追記 2026-11-17）", async () => {
    const def = sheetFor("simple");
    const s = templateSelection("simple", blank());
    const p = { ...packetBody(def, s, { requestId: "R-AAAAAA", expiresAt: NOW.toISOString(), office: OFFICE }), digest: "x" };
    expect(screens(p, initialDraft(p)).some((x) => x.kind === "item" && x.key === "hs.consult.topics")).toBe(false);
    const d = { ...initialDraft(p), topics: ["教育費", "親のこと"] };
    const review = renderToString(h(HearingForm, { packet: p, mode: "preview", initial: d, startAt: "review" }));
    for (const t of ["data-hf-topic", "ご相談したいこと", "教育費、親のこと"]) expect(review).not.toContain(t);
  });

  it("前に保存した事務所の既定の話題は読んで書き戻せる（画面からは使わない）", () => {
    const a = withHearingTopics(DEFAULT_OFFICE_SETTINGS, [" 教育費 ", "教育費", "相続のこと"]);
    expect(readOfficeSettings(JSON.parse(JSON.stringify(a))).hearingTopics).toEqual(["教育費", "相続のこと"]);
    expect(isDefaultSettings(withHearingTopics(a, null))).toBe(true);
  });
});

describe("独自の質問の答えの形（0192。H-109）", () => {
  it("はい・いいえ・選択肢の質問は選ぶ問いになり、答えは言葉のままメモに入る。直しても項目キーは変わらない", async () => {
    const { t } = relayFor();
    const wh = blank();
    let sel = withCustom(templateSelection("simple", wh), "前に FP に相談したことはありますか", "", "ext.office.qaaaa1111", { answer: "yesNo" });
    sel = withCustom(sel, "面談の場所の希望", "", "ext.office.qbbbb2222", { answer: "choice", choices: ["事務所", "オンライン", "ご自宅"] });
    sel = withCustomEdit(sel, "ext.office.qbbbb2222", { label: "面談の場所のご希望", answer: "choice", choices: ["事務所", "オンライン", "ご自宅"] });
    expect(sel.custom.map((c) => c.key)).toEqual(["ext.office.qaaaa1111", "ext.office.qbbbb2222"]);
    expect(sel.custom[1]?.label).toBe("面談の場所のご希望");
    // 選択肢が1つ・空は発行の前に知らせる
    expect(checkSelection(sheetFor("simple"), withCustomEdit(sel, "ext.office.qbbbb2222", { label: "x", answer: "choice", choices: ["事務所", ""] })).join()).toContain("選択肢");
    const r = await issueWeb(wh, { selection: sel, customerNo: "A1", office: OFFICE, pageUrl: "https://relay.test/h/", transport: t, now: NOW });
    const o = await openRequest(new URL(r.entry.record.url).hash, t);
    expect(o.packet.items.find((i) => i.key === "ext.office.qaaaa1111")).toMatchObject({ type: "choice", choices: [{ value: "はい" }, { value: "いいえ" }] });
    expect(o.packet.items.find((i) => i.key === "ext.office.qbbbb2222")?.choices?.map((c) => c.label)).toEqual(["事務所", "オンライン", "ご自宅"]);
    const d: Draft = { ...initialDraft(o.packet), gates: { spouse: 0, child: 0 }, answers: { [draftKey("hs.consent.purpose")]: v("given"), [draftKey("ext.office.qaaaa1111")]: v("いいえ"), [draftKey("ext.office.qbbbb2222")]: v("オンライン") } };
    await submitAnswers(o, answersOf(o.packet, d, NOW), t);
    const got = (await receiveWeb(r.wh, r.entry, t, NOW))!;
    const view = importWeb(got.wh, got.entry, "0.1.0", seq);
    expect(view.memo).toEqual(expect.arrayContaining(["【前に FP に相談したことはありますか】いいえ", "【面談の場所のご希望】オンライン"]));
  });
});

describe("事務所のひな形（カスタム）に、その世帯の結びつきを入れない（H-115）", () => {
  it("書類待ちの結びつき・持ち主を外し、書類の種類だけを残す", () => {
    const wh = blank();
    const s0 = templateSelection("simple", wh);
    const d1 = documentFromTemplate(s0, "withholding", "self");
    const d2 = documentFromCheck({ ...s0, documents: [d1] }, { id: "loan:x", doc: "住宅ローンの返済予定表", title: "住宅ローンの返済予定表（ご本人）", whose: "ご本人", values: [{ field: "残高" }] } as never);
    const saved = templateForSave({ ...s0, documents: [d1, d2] }, "子育て世帯");
    expect(saved.name).toBe("カスタム: 子育て世帯");
    expect(saved.documents.every((d) => d.docRequest === undefined && d.owner === undefined)).toBe(true);
    expect(saved.documents.map((d) => d.title)).toEqual(["源泉徴収票", "住宅ローンの返済予定表"]);
  });
});

describe("届いた知らせ・送られた内容・書類待ち・0件の承認・案内文（0192）", () => {
  async function issued(wh: WorkingHousehold, withDoc = false) {
    const { t } = relayFor();
    const s0 = templateSelection("simple", wh);
    const sel = withDoc ? { ...s0, documents: [documentFromTemplate(s0, "withholding", "self")] } : s0;
    const r = await issueWeb(wh, { selection: sel, customerNo: "A0001", office: OFFICE, pageUrl: "https://relay.test/h/", transport: t, now: NOW });
    return { t, r };
  }

  it("確かめると届いた知らせを覚え、世帯の一覧の印と FP のメニューの数に出る。受け取ると取り込み待ち", async () => {
    const { t, r } = await issued(blank());
    await checkArrivals(r.wh, t, NOW);
    expect(arrivalOf(r.entry.record.requestId)).toMatchObject({ answers: false, submitted: false });
    expect(pendingMark(r.wh, NOW)).toBeNull();
    const o = await openRequest(new URL(r.entry.record.url).hash, t);
    await submitAnswers(o, answersOf(o.packet, { ...initialDraft(o.packet), gates: { spouse: 0, child: 0 }, answers: { [draftKey("hs.consent.purpose")]: v("given"), [draftKey("hs.family.adult.birthYearMonth", 1)]: ym(1985, 6) } }, NOW), t);
    await checkArrivals(r.wh, t, NOW);
    expect(pendingCount(r.wh, NOW)).toEqual({ arrived: 1, toImport: 0 });
    expect(listSummary("本人", r.wh, NOW)).toBe("本人｜回答が届いています");
    expect(splitSummary("本人｜回答が届いています")).toEqual({ family: "本人", mark: "回答が届いています" });
    expect(splitSummary("本人・配偶者")).toEqual({ family: "本人・配偶者", mark: null });
    const got = (await receiveWeb(r.wh, r.entry, t, NOW))!;
    noteArrival(r.entry.record.requestId, { answers: false, batches: 0, submitted: true, at: NOW.toISOString() });
    expect(pendingMark(got.wh, NOW)).toBe("取り込み待ち");
    // 送られた内容: お客さまが見たのと同じ並びで数える（同意・分岐・問いの画面）
    const p = packetOf(got.entry)!;
    const d = receivedDraft(got.entry)!;
    expect(p.requestId).toBe(r.entry.record.requestId);
    expect(d.answers[draftKey("hs.family.adult.birthYearMonth", 1)]).toMatchObject({ status: "value" });
    const c = answeredScreens(got.entry)!;
    expect(c.answered).toBeGreaterThan(0);
    expect(c.answered).toBeLessThan(c.total);
  });

  it("頼んだ書類で分かる問いのお答えなしは「書類を待っています」（届いていれば「届いています」）。「手元にない」なら言い分けない", async () => {
    const wh = filled();
    const { t, r } = await issued(wh, true);
    const o = await openRequest(new URL(r.entry.record.url).hash, t);
    const d: Draft = { ...initialDraft(o.packet), gates: { spouse: 1, child: 2 }, documents: { d1: { status: "later", files: [] } }, answers: { [draftKey("hs.consent.purpose")]: v("given"), [draftKey("hs.work.type", 1)]: v("regular") } };
    await submitAnswers(o, answersOf(o.packet, d, NOW), t);
    const got = (await receiveWeb(r.wh, r.entry, t, NOW))!;
    expect(waitingDocs(got.entry).get("hs.income.annual#1")).toBe("源泉徴収票（ご本人）を待っています");
    const view = importWeb(got.wh, got.entry, "0.1.0", seq);
    const diffs = view.candidates.flatMap((x) => x.fields.flatMap((f) => f.diffs));
    expect(diffs.some((x) => x.waiting === "源泉徴収票（ご本人）を待っています")).toBe(true);
    // 届いた書類があれば「届いています」
    const withFile = { ...got.entry, files: [{ docId: "d1", fileId: "f".repeat(16), mime: "image/jpeg" as const, data: "", bytes: 1, sha256: "0".repeat(64) }] };
    expect(waitingDocs(withFile).get("hs.income.annual#1")).toBe("源泉徴収票（ご本人）が届いています（見て入れてください）");
    // 「手元にない」は待たない
    const na = { ...got.entry, received: { ...got.entry.received!, documents: [{ id: "d1", status: "notAvailable" as const }] } };
    expect(waitingDocs(na).size).toBe(0);
  });

  it("入れる値が無くても（全部お答えなし・同じ）、0件で承認して取り込み済みにできる", async () => {
    const wh = filled();
    const { t, r } = await issued(wh);
    const o = await openRequest(new URL(r.entry.record.url).hash, t);
    await submitAnswers(o, answersOf(o.packet, { ...initialDraft(o.packet), gates: { spouse: 1, child: 2 }, answers: { [draftKey("hs.consent.purpose")]: v("given") } }, NOW), t);
    const got = (await receiveWeb(r.wh, r.entry, t, NOW))!;
    const view = importWeb(got.wh, got.entry, "0.1.0", seq);
    const out = applyImport(got.wh, view, new Set(), approvalTime(NOW));
    expect(out.added + out.replaced).toBe(0);
    expect(logOf(out.wh).imports.some((i) => i.requestId === r.entry.record.requestId)).toBe(true);
  });

  it("案内文: 所要時間は問いの数から・URL の頭・聞かないこと・送れるのは1回だけ。段落ごとに空行。お客さまに見える言葉は「回答」（0192 の追記）", async () => {
    const { r } = await issued(blank());
    const text = invitationText(r.entry, "【架空】みらいFP事務所");
    const est = estimateOf(null, r.entry.record.selection)!;
    expect(text).toContain(`（${est.std.minutes}分ほどです）`);
    expect(text).toContain("いつもお世話になっております。【架空】みらいFP事務所です。\n\nライフプランの面談の前に、いくつかご質問させてください。\n\n次のリンクを開くと、スマートフォンでも画面に沿ってご回答いただけます");
    expect(text).not.toContain("お答え");
    // 書類を頼まない依頼には、撮影の一言を出さない
    expect(text).not.toContain("書類の撮影があるので");
    expect(pageHead(r.entry.record.url)).toBe("https://relay.test/h/");
    expect(text).toContain("リンクは「https://relay.test/h/」で始まります。違うときは開かずに、ご連絡ください。");
    expect(text).toContain("お名前・口座番号・暗証番号・カード番号・マイナンバーはお聞きしません。ログインもありません。");
    expect(text).toContain("回答を送れるのは1回だけです");
    expect(text).not.toContain("10〜15分");
  });

  it("案内文: 書類を1通以上頼む依頼には「書類の撮影があるので、スマートフォンで開くのがおすすめです。」の段落を足す（0192 の追記）", async () => {
    const { r } = await issued(blank(), true);
    const text = invitationText(r.entry, "試しの事務所");
    expect(text).toContain("\n\n書類の撮影があるので、スマートフォンで開くのがおすすめです。\n\n");
    expect(text.indexOf("書類の撮影があるので")).toBeLessThan(text.indexOf(r.entry.record.url));
  });

  it("書類の送りのある依頼でも、届いた書類の数を知らせる", async () => {
    const { t, r } = await issued(blank(), true);
    const o = await openRequest(new URL(r.entry.record.url).hash, t);
    const up = await uploadFile(o, jpeg, t);
    await sendDocuments(o, unsentFiles({ documents: { d1: { status: "attached", files: [{ fileId: up.fileId, mime: "image/jpeg", bytes: jpeg.length, sha256: up.sha256, label: "写真 1" }] } } }), t);
    await checkArrivals(r.wh, t, NOW);
    expect(arrivalOf(r.entry.record.requestId)).toMatchObject({ batches: 1, submitted: false });
    expect(webLog(r.wh)).toHaveLength(1);
  });
});

describe("FP の画面（WebBuilder の描画）", () => {
  const host = { config: async () => ({ pageUrl: "https://relay.test/h/" }), call: async () => ({ status: 500, body: "" }) } as unknown as HearingWebHost;
  it("ひな形・カスタム・聞く／聞かないの要約・範囲は別の項目にしない・顧客番号は世帯の番号・事務所名が空の注意。話題の欄は無い・「？」の説明・外部 AI の同意を聞くか（0192 の追記）", () => {
    const html = renderToString(h(WebBuilder, { wh: filled(), web: host, office: { name: "", color: null }, templates: [], onTemplates: async () => undefined, customerNo: "B0007", persisted: true, onSave: () => undefined, saveNow: async () => true, onClose: () => undefined }));
    expect(html).toContain("シンプル");
    expect(html).toContain("カスタム（自分で選んだ・保存した組み合わせ）");
    expect(html).toMatch(/聞かない:<\/b> ご両親/);
    expect(html).not.toContain('data-web-item="hs.income.annualRange"');
    expect(html).toContain('data-web-range="hs.income.annual"');
    expect(html).toContain('value="B0007"');
    expect(html).toContain("data-web-no-office");
    expect(html).not.toContain("data-web-topics");
    expect(html).not.toContain("ご相談したいことの話題");
    expect(html).not.toContain('data-web-item="hs.consult.topics"');
    expect(html).toContain('data-web-item="hs.plan.events"');
    expect(html).toContain("URL生成");
    for (const id of ["customerNo", "officeName", "privacyContact", "aiConsent"]) expect(html).toContain(`data-web-help="${id}"`);
    expect(html).toContain("個人情報のお問い合わせ: ");
    expect(html).toMatch(/data-web-ai-consent-check[^>]*checked|checked[^>]*data-web-ai-consent-check/);
    expect(html).toContain("AI接続口が使えません");
    expect(html).not.toContain("何のための問いか");
    // ひな形の時間は夫婦と子2人で数え、この世帯の数を添える
    expect(html).toMatch(/\d+項目・\d+分ほど（夫婦と子2人）・この世帯では\d+分ほど/);
    expect(html).toContain("data-web-has-values");
    expect(html).toContain("夫婦と子2人で数えた目安");
    expect(html).toMatch(/URL を発行する（聞く項目 \d+・書類 0）/);
    expect(html).not.toMatch(/初回の前/);
  });
});
