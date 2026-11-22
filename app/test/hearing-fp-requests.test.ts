// Web のヒアリングの FP の画面の手直し（0192 の追記 2026-11-17）: 名前・依頼の行の段階（届いたら「受け取る」「取り消す」だけ・取り消しは1回確かめる・
// 取り込み済みはたたむ・書類待ちは期限まで残す）・外部 AI の同意を聞かない依頼・取り込みの画面（聞いていない欄をまとめる・人数の違いの分け方）
// 0192 の追記（2026-11-18）: Excel のシートを画面から外す（excelSwitch.ts）・取り込み済みの依頼は一覧から外す（送られた内容は取り込み済みの回答から）・
// 聞かなかった外部 AI の同意を送られた内容に出さない
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { handleApi } from "../../hearing/relay/handler.ts";
import { memoryStore } from "../../hearing/relay/store.ts";
import { answersOf, draftKey, initialDraft, openRequest, sendDocuments, submitAnswers, unsentFiles, uploadFile, type Draft, type RelayTransport } from "../../hearing/src/web/index.ts";
import { API_PREFIX } from "../../hearing/src/web/protocol.ts";
import { applyImport, approvalTime } from "../src/workspace/hearing/sheet.ts";
import { documentFromTemplate, importedEntries, importWeb, issueWeb, listed, markImported, noteArrival, officeFace, packetOf, receivedDraft, receiveWeb, rowMode, templateSelection, waitingDocuments, webLog, type WebLogEntry } from "../src/workspace/hearing/web.ts";
import { ImportedAnswers, WebRequests } from "../src/workspace/hearing/WebRequests.tsx";
import { SentAnswers } from "../src/hearingForm/Form.tsx";
import { HEARING_EXCEL_SHOWN } from "../src/workspace/hearing/excelSwitch.ts";
import { HearingTools, ReviewPanel, splitFields } from "../src/workspace/hearing/HearingTools.tsx";
import { blankHousehold, fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import type { HearingWebHost, SheetHost } from "../src/engine/host.ts";
import { modelHousehold } from "./helpers.ts";
import { buttonTexts, renderPressing, within } from "./pressing.ts";

const OFFICE = officeFace({ name: "試しの事務所", color: null, purpose: "", privacyContact: "03-0000-0000" });
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
  return { t };
}

const host = { config: async () => ({ pageUrl: "https://relay.test/h/" }), call: async () => ({ status: 500, body: "" }), saveDocument: async () => ({ saved: false }) } as unknown as HearingWebHost;
const rows = (wh: WorkingHousehold) => renderToString(h(WebRequests, { wh, web: host, officeName: "試しの事務所", appVersion: "0.1.0", onSave: () => undefined, saveNow: async () => true, onImport: () => undefined }));

/** 発行して答えを送る（withDoc なら源泉徴収票を頼み、お客さまは「あとで送る」） */
async function answered(wh: WorkingHousehold, o: { withDoc?: boolean; aiConsent?: boolean; ai?: "given" | "refused" } = {}) {
  const { t } = relayFor();
  const s0 = templateSelection("simple", wh);
  const sel = o.withDoc === true ? { ...s0, documents: [documentFromTemplate(s0, "withholding", "self")] } : s0;
  const r = await issueWeb(wh, { selection: sel, customerNo: "0001", office: OFFICE, pageUrl: "https://relay.test/h/", transport: t, now: NOW, ...(o.aiConsent === false ? { aiConsent: false } : {}) });
  const op = await openRequest(new URL(r.entry.record.url).hash, t);
  const d: Draft = {
    ...initialDraft(op.packet),
    gates: { spouse: 1, child: 1 },
    ...(o.withDoc === true ? { documents: { d1: { status: "later" as const, files: [] } } } : {}),
    answers: { [draftKey("hs.consent.purpose")]: v("given"), ...(o.ai !== undefined ? { [draftKey("hs.consent.externalAi")]: v(o.ai) } : {}), [draftKey("hs.family.adult.birthYearMonth", 1)]: ym(1985, 6), [draftKey("hs.family.adult.birthYearMonth", 2)]: ym(1987, 3), [draftKey("hs.work.type", 1)]: v("regular") },
  };
  await submitAnswers(op, answersOf(op.packet, d, NOW), t);
  return { t, r, op };
}

const sheets = { save: async () => ({ saved: false }), open: async () => null } as unknown as SheetHost;
const webProps = { web: host, office: { name: "", color: null }, templates: [], onTemplates: async () => undefined, persisted: true, saveNow: async () => true };

describe("名前（0192 の追記）", () => {
  it("Excel のシートを出すとき: 事前ヒアリング内容を作る（Excel を書き出す・URL生成）／事前ヒアリングを取り込む（記入済みの Excel を取り込む）", () => {
    const html = renderToString(h(HearingTools, { wh: blank(), sheets, onSave: () => undefined, webProps, excel: true }));
    for (const t of ["事前ヒアリング内容を作る", "Excel を書き出す", "URL生成", "事前ヒアリングを取り込む", "記入済みの Excel を取り込む"]) expect(html).toContain(t);
    expect(html).not.toContain("URL で聞く");
    expect(html).not.toMatch(/>ヒアリングで聞く</);
  });

  it("既定は Excel のシートを外す（2026-11-18）: URL生成と URL の回答の取り込みだけ。Excel に触れる言葉を出さない", () => {
    expect(HEARING_EXCEL_SHOWN).toBe(false);
    const html = renderToString(h(HearingTools, { wh: blank(), sheets, onSave: () => undefined, webProps }));
    for (const t of ["事前ヒアリング内容を作る", "URL生成"]) expect(html).toContain(t);
    // 「事前ヒアリングを取り込む」の段は、記入済みの Excel を取り込む（Excel を出すとき）と届いた件数の知らせだけ。どちらも無ければ段ごと出さない（0222 の追記 2026-11-20）。
    // URL が0件なら「発行した URL」の枠も出さない
    for (const t of ["事前ヒアリングを取り込む", "data-hearing-take", "data-web-requests", "URL の依頼"]) expect(html).not.toContain(t);
    for (const t of ["Excel", "記入済み", "ヒアリングシート", "data-hearing-export", "data-hearing-import"]) expect(html).not.toContain(t);
    // 本体に受け付けの命令が無い画面（Web も Excel も無い）では、入口の段を出さない
    expect(renderToString(h(HearingTools, { wh: blank(), sheets, onSave: () => undefined }))).not.toContain("data-hearing-ask");
  });
});

describe("依頼の行の段階（0192 の追記）", () => {
  it("届く前: 届いたかを確かめる・延長・案内文をコピー・取り消す。取り消しの確かめは押すまで出さない", async () => {
    const { t } = relayFor();
    const wh = blank();
    const r = await issueWeb(wh, { selection: templateSelection("simple", wh), customerNo: "0001", office: OFFICE, pageUrl: "https://relay.test/h/", transport: t, now: NOW });
    noteArrival(r.entry.record.requestId, { answers: false, batches: 0, submitted: false, at: NOW.toISOString() });
    expect(rowMode(r.entry, NOW, undefined, r.wh)).toBe("waiting");
    const html = rows(r.wh);
    for (const a of ["data-web-check", "data-web-extend", "data-web-copy", "data-web-cancel"]) expect(html).toContain(a);
    expect(html).not.toContain("data-web-receive");
    // ワンクリックで取り消さない: 「はい、取り消す」は確かめの段にだけある（押す前は出ない）
    expect(html).not.toContain("data-web-cancel-yes");
    expect(html).not.toContain("data-web-cancel-ask");
  });

  it("取り消すの確かめ（0243）: 進むボタン「はい、取り消す」（危ない色）が左・「やめる」が右。やめるで確かめが消える", async () => {
    const { t } = relayFor();
    const wh = blank();
    const r = await issueWeb(wh, { selection: templateSelection("simple", wh), customerNo: "0001", office: OFFICE, pageUrl: "https://relay.test/h/", transport: t, now: NOW });
    noteArrival(r.entry.record.requestId, { answers: false, batches: 0, submitted: false, at: NOW.toISOString() });
    const node = h(WebRequests, { wh: r.wh, web: host, officeName: "試しの事務所", appVersion: "0.1.0", onSave: () => undefined, saveNow: async () => true, onImport: () => undefined });
    const ask = within(renderPressing(node, "data-web-cancel"), "data-web-cancel-ask");
    expect(ask).toContain("お客さまはこの URL を開けなくなります。取り消しますか。");
    expect(buttonTexts(ask)).toEqual(["はい、取り消す", "やめる"]);
    expect(ask).toMatch(/class="btn danger"[^>]*>はい、取り消す/);
    expect(renderPressing(node, "data-web-cancel", "data-web-cancel-no")).not.toContain("data-web-cancel-ask");
  });

  it("回答が届いたら: 受け取る・取り消すだけ（届いたかを確かめる・延長・案内文をコピーは出さない）", async () => {
    const { r } = await answered(blank());
    noteArrival(r.entry.record.requestId, { answers: true, batches: 0, submitted: true, at: NOW.toISOString() });
    expect(rowMode(r.entry, NOW, { answers: true, batches: 0, submitted: true, at: "" }, r.wh)).toBe("arrived");
    const html = rows(r.wh);
    expect(html).toContain("data-web-receive");
    expect(html).toContain("data-web-cancel");
    for (const a of ["data-web-check", "data-web-extend", "data-web-copy", "data-web-import"]) expect(html).not.toContain(a);
  });

  it("「受け取る」から取り込みの候補の画面へ直に行ける（受け取った答えで候補を作れる）。取り込み済みは一覧から外し（枠ごと出さない）、送られた内容は取り込み済みの回答から開ける", async () => {
    const { t, r } = await answered(blank());
    const got = (await receiveWeb(r.wh, r.entry, t, NOW))!;
    expect(rowMode(got.entry, NOW, undefined, got.wh)).toBe("toImport");
    // 受け取って取り込んでいない: 「事前ヒアリングを取り込む」の段に取り込み待ちの数だけ（0222 の追記 2026-11-20）
    const waitingTools = renderToString(h(HearingTools, { wh: got.wh, sheets, onSave: () => undefined, webProps }));
    const take = waitingTools.slice(waitingTools.indexOf("data-hearing-take"), waitingTools.indexOf("data-web-requests"));
    expect(take).toContain("取り込み待ち（1件）");
    expect(take).toContain("下の「発行した URL」の「取り込む」から取り込みます");
    expect(waitingTools).toContain("data-web-import");
    const view = importWeb(got.wh, got.entry, "0.1.0", seq);
    const out = applyImport(got.wh, view, new Set(view.candidates.map((c) => c.id)), approvalTime(NOW));
    const done = markImported(out.wh, r.entry.record.requestId, approvalTime(NOW));
    const e = webLog(done).find((x) => x.record.requestId === r.entry.record.requestId) as WebLogEntry;
    expect(rowMode(e, NOW, undefined, done)).toBe("done");
    // 表の行から外す（記録は世帯に残す）。送られた内容は、「発行した URL」の表の下の「取り込み済みの URL の回答」から（0222 の追記 2026-11-20）
    expect(listed(e, NOW, done)).toBe(false);
    expect(webLog(done)).toHaveLength(1);
    expect(rows(done)).not.toContain("data-web-request=");
    expect(rows(done)).toContain("発行した URL（1）");
    expect(rows(done)).toContain("data-web-imported");
    expect(importedEntries(done, NOW).map((x) => x.record.requestId)).toEqual([r.entry.record.requestId]);
    const imp = renderToString(h(ImportedAnswers, { wh: done }));
    expect(imp).toContain("取り込み済みの URL の回答（1）");
    expect(imp).toContain("data-web-answers-open");
    // 届いた知らせも取り込み待ちも無いので、「事前ヒアリングを取り込む」の段は出さない
    const tools = renderToString(h(HearingTools, { wh: done, sheets, onSave: () => undefined, webProps }));
    expect(tools).toContain("data-web-imported");
    expect(tools).not.toContain("data-hearing-take");
    // 取り込みを元に戻した（世帯の取り込みの記録から消えた）依頼は、また一覧に出す（もう一度取り込める）
    const undone = markImported(got.wh, r.entry.record.requestId, approvalTime(NOW));
    const ue = webLog(undone)[0] as WebLogEntry;
    expect(rowMode(ue, NOW, undefined, undone)).toBe("toImport");
    expect(listed(ue, NOW, undone)).toBe(true);
    expect(rows(undone)).toContain("data-web-import");
    expect(importedEntries(undone, NOW)).toEqual([]);
  });

  it("書類を「あとで送る」の依頼は、取り込んだ後も期限まで書類待ちの段を残す。書類が届けば受け取れ、届いた後は書類待ちが消える", async () => {
    const { t, r, op } = await answered(filled(), { withDoc: true });
    const got = (await receiveWeb(r.wh, r.entry, t, NOW))!;
    const view = importWeb(got.wh, got.entry, "0.1.0", seq);
    const done = markImported(applyImport(got.wh, view, new Set(), approvalTime(NOW)).wh, r.entry.record.requestId, approvalTime(NOW));
    const e = webLog(done)[0] as WebLogEntry;
    expect(waitingDocuments(e, NOW).map((d) => d.title)).toEqual(["源泉徴収票（ご本人）"]);
    expect(rows(done)).toContain("data-web-docs-waiting");
    // 期限が過ぎれば書類待ちの段は出さない
    expect(waitingDocuments(e, new Date(Date.parse(e.record.expiresAt) + 1000))).toEqual([]);
    // 書類が届いた知らせ: たたんだ行に「届いた書類を受け取る」
    const up = await uploadFile(op, jpeg, t);
    await sendDocuments(op, unsentFiles({ documents: { d1: { status: "attached", files: [{ fileId: up.fileId, mime: "image/jpeg", bytes: jpeg.length, sha256: up.sha256, label: "写真 1" }] } } }), t);
    noteArrival(e.record.requestId, { answers: false, batches: 1, submitted: true, at: NOW.toISOString() });
    const html = rows(done);
    expect(html).toContain("data-web-receive");
    expect(html).toContain("届いた書類を受け取る");
    const more = (await receiveWeb(done, e, t, NOW))!;
    noteArrival(e.record.requestId, { answers: false, batches: 0, submitted: true, at: NOW.toISOString() });
    expect(waitingDocuments(more.entry, NOW)).toEqual([]);
    // 書類を受け取り終えたら一覧から外す（2026-11-18）
    expect(listed(more.entry, NOW, more.wh)).toBe(false);
    expect(rows(more.wh)).not.toContain("data-web-request=");
    const imp = renderToString(h(ImportedAnswers, { wh: more.wh }));
    expect(imp).toContain("data-web-imported");
    expect(imp).toContain("受け取った書類");
  });
});

describe("外部 AI の同意を聞かない依頼（0192 の追記・0138）", () => {
  it("同意の問いを出さず、取り込んでも外部 AI の同意は記録しない（聞いていないまま）。聞く依頼で同意すれば記録する", async () => {
    const off = await answered(blank(), { aiConsent: false, ai: "given" });
    const op = await openRequest(new URL(off.r.entry.record.url).hash, off.t);
    expect(op.packet.consent.items.some((i) => i.key === "hs.consent.externalAi")).toBe(false);
    const got = (await receiveWeb(off.r.wh, off.r.entry, off.t, NOW))!;
    const view = importWeb(got.wh, got.entry, "0.1.0", seq);
    expect(view.consents.map((c) => c.kind)).toEqual(["purpose"]);
    const html = renderToString(h(ReviewPanel, { wh: got.wh, view, onSave: () => undefined, onClose: () => undefined }));
    expect(html).toContain("外部AIへの提供は回答なし");
    expect(html).not.toContain("接続口");
    // 送られた内容（FP の側の控え・お客さまの側の控え）に、答えの無い外部 AI の同意の行を出さない（聞かなかったことは記録しない。2026-11-18）
    const aiText = "AI を使って回答を整理";
    const fpSent = renderToString(h(SentAnswers, { packet: packetOf(got.entry)!, draft: receivedDraft(got.entry)! }));
    expect(fpSent).toContain("data-hf-sent-list");
    expect(fpSent).not.toContain(aiText);
    expect(fpSent).not.toContain("同意");
    expect(Object.keys(got.entry.record.selection)).not.toContain("aiConsent");
    const custSent = renderToString(h(SentAnswers, { packet: op.packet, draft: receivedDraft(got.entry)! }));
    expect(custSent).not.toContain(aiText);
    expect(custSent).not.toContain("同意");
    const on = await answered(blank(), { ai: "given" });
    const got2 = (await receiveWeb(on.r.wh, on.r.entry, on.t, NOW))!;
    expect(importWeb(got2.wh, got2.entry, "0.1.0", seq).consents.find((c) => c.kind === "externalAi")?.decision).toBe("given");
  });
});

describe("取り込みの画面の整理（0192 の追記）", () => {
  it("空の世帯: 聞いていない欄は1行にまとめ、人数が増えた違いは「新規の候補で足せる」に分ける（直す要るものと混ぜない）", async () => {
    const { t, r } = await answered(blank());
    const got = (await receiveWeb(r.wh, r.entry, t, NOW))!;
    const view = importWeb(got.wh, got.entry, "0.1.0", seq);
    // 配偶者の方は生年月の回答があるので新規の候補で足せる。お子さま1人は生年月の回答が無く候補にならないので、入力の画面で足す要確認にする（0192 の追記 2026-11-18）
    expect(view.gates.find((g) => g.gate === "spouse")?.more).toBe(true);
    const child = view.gates.find((g) => g.gate === "child")!;
    expect(child.more).toBeUndefined();
    expect(child.text).toBe("お子さまは1人とのお答え（今の世帯は0人）。回答に生年月などが無い分は候補にしていません。入力の画面で足してください");
    const html = renderToString(h(ReviewPanel, { wh: got.wh, view, onSave: () => undefined, onClose: () => undefined, heading: "事前ヒアリングの取り込み（URL の回答・R-TEST01）", received: "受け取りました" }));
    expect(html).toContain("data-hearing-gates-more");
    expect(html).toContain("data-hearing-gates=");
    expect(html).toContain("data-hearing-quiet");
    expect(html).toContain("data-hearing-received");
    expect(html).toContain("事前ヒアリングの取り込み（URL の回答・R-TEST01）");
    // 聞いていない欄は、1つずつの行にしない
    const work = view.candidates.find((c) => c.fields.some((f) => f.answer === "（このシートでは聞いていない）"))!;
    const s = splitFields(work.fields);
    expect(s.shown.every((f) => f.answer !== "（このシートでは聞いていない）")).toBe(true);
    expect(s.quiet.length).toBeGreaterThan(0);
  });

  it("値のある世帯: お答えの方が少ない人数の違いは要確認（承認しても消さない）として出す", async () => {
    const { t } = relayFor();
    const wh = filled();
    const r = await issueWeb(wh, { selection: templateSelection("simple", wh), customerNo: "0001", office: OFFICE, pageUrl: "https://relay.test/h/", transport: t, now: NOW });
    const op = await openRequest(new URL(r.entry.record.url).hash, t);
    await submitAnswers(op, answersOf(op.packet, { ...initialDraft(op.packet), gates: { spouse: 1, child: 0 }, answers: { [draftKey("hs.consent.purpose")]: v("given") } }, NOW), t);
    const got = (await receiveWeb(r.wh, r.entry, t, NOW))!;
    const view = importWeb(got.wh, got.entry, "0.1.0", seq);
    expect(view.gates.find((g) => g.gate === "child")?.more).toBeUndefined();
    const html = renderToString(h(ReviewPanel, { wh: got.wh, view, onSave: () => undefined, onClose: () => undefined }));
    expect(html).toContain("data-hearing-gates");
    expect(html).toContain("お子さまは0人とのお答え（今の世帯は2人）");
  });
});
