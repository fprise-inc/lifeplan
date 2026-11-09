// Web のヒアリング（0125・0158）の FP の側（workspace/hearing/web.ts）: 発行 → お客さまが答えて書類を送る → 受け取る → 受け取った分をサーバーから消す →
// Excel と同じ候補にして承認 → 現状に入る。答えの後の書類を何回分でも受け取る。延長。分岐の答え。元に戻すで依頼の記録を戻さない。事務所のひな形。書類待ちとのつながり
import { describe, expect, it } from "vitest";
import { handleApi } from "../../hearing/relay/handler.ts";
import { memoryStore } from "../../hearing/relay/store.ts";
import { answersOf, draftKey, initialDraft, openRequest, sendDocuments, submitAnswers, unsentFiles, uploadFile, type Draft, type RelayTransport } from "../../hearing/src/web/index.ts";
import { API_PREFIX } from "../../hearing/src/web/protocol.ts";
import { applyImport, approvalTime, defaultSelection, gateNotices, sheetFor } from "../src/workspace/hearing/sheet.ts";
import { accepting, checkAnswered, cleanupOnServer, docRequestStatus, documentFromTemplate, extendState, extendWeb, gateLines, gateNotes, importWeb, invitationText, issueWeb, keepWebLog, markImported, officeFace, previewPacket, readHearingTemplates, receiveWeb, receivedDocuments, removeOnServer, sentAtText, STATUS_TEXT, statusOf, templateSelection, webLog, withCustom, withoutFile, type WebTemplateKind } from "../src/workspace/hearing/web.ts";
import type { DraftAnswer } from "../../hearing/src/web/flow.ts";
import { blankHousehold, fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { readOfficeSettings, withHearingTemplates, DEFAULT_OFFICE_SETTINGS } from "../src/workspace/office/settings.ts";
import { modelHousehold } from "./helpers.ts";
import { selectionFromSheet, type WebSelection } from "../../hearing/src/web/packet.ts";

/** シンプルにご両親を足した選び方（シンプルはご両親を既定で外す。FP が足せば聞ける。0192） */
function withParents(sel: WebSelection): WebSelection {
  const parents = selectionFromSheet(sheetFor("simple")).sections.find((s) => s.id === "parents")!;
  const i = sel.sections.findIndex((s) => s.id === "other");
  const sections = [...sel.sections];
  sections.splice(i < 0 ? sections.length : i, 0, parents);
  return { ...sel, sections };
}

const OFFICE = officeFace({ name: "【架空】みらいFP事務所", color: "#2f6f5e", purpose: "ライフプランの作成のため", privacyContact: "" });
const NOW = new Date("2026-11-05T09:00:00Z");

let n = 0;
const seq = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const blank = (): WorkingHousehold => withRefreshedEstimates(blankHousehold("2026-11", seq));

function relayFor(clock: { t: Date } = { t: NOW }) {
  const store = memoryStore();
  const t: RelayTransport = async (r) => {
    const headers: Record<string, string> = {};
    if (r.token !== undefined) headers.authorization = `Bearer ${r.token}`;
    const res = await handleApi(new Request(`https://relay.test${API_PREFIX}${r.path}`, { method: r.method, headers, ...(r.body !== undefined ? { body: r.body } : {}) }), { store, now: () => clock.t });
    return { status: res.status, body: await res.text() };
  };
  return { store, t, clock };
}

const v = (text: string) => ({ status: "value" as const, raw: { kind: "text" as const, text } });
const ym = (y: number, m: number) => ({ status: "value" as const, raw: { kind: "text" as const, text: String(y) }, raw2: { kind: "number" as const, text: String(m) } });
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 2000 }, (_, i) => i % 200)]) as Uint8Array<ArrayBuffer>;

async function customerAnswers(url: string, t: RelayTransport, withPhoto = true) {
  const o = await openRequest(new URL(url).hash, t);
  let d: Draft = initialDraft(o.packet);
  d = { ...d, gates: { spouse: 0, child: 1 }, answers: { [draftKey("hs.consent.purpose")]: v("given"), [draftKey("hs.family.adult.birthYearMonth", 1)]: ym(1985, 6), [draftKey("hs.family.adult.sex", 1)]: v("male"), [draftKey("hs.family.child.birthYearMonth", 1)]: ym(2019, 2), [draftKey("hs.work.type", 1)]: v("regular"), [draftKey("hs.income.annual", 1)]: { status: "value", raw: { kind: "number", text: "600" } }, [draftKey("hs.housing.type")]: v("rent"), [draftKey("hs.housing.rent")]: { status: "value", raw: { kind: "number", text: "110000" } } } };
  if (withPhoto) {
    const up = await uploadFile(o, jpeg, t);
    d = { ...d, documents: { d1: { status: "attached", files: [{ fileId: up.fileId, mime: "image/jpeg", bytes: jpeg.length, sha256: up.sha256, label: "写真 1" }] } } };
    await sendDocuments(o, unsentFiles(d), t);
  }
  await submitAnswers(o, answersOf(o.packet, d, new Date("2026-11-06T09:00:00Z")), t);
  return o;
}

/** お客さまが答えの後に書類を1枚送る */
async function customerMore(o: Awaited<ReturnType<typeof openRequest>>, t: RelayTransport, n: number) {
  const bytes = new Uint8Array([...jpeg, n]) as Uint8Array<ArrayBuffer>;
  const up = await uploadFile(o, bytes, t);
  await sendDocuments(o, [{ id: "d1", files: [{ fileId: up.fileId, mime: "image/jpeg", bytes: bytes.length, sha256: up.sha256, label: `写真 ${n}` }] }], t);
}

describe("Web のヒアリング（FP の側）", () => {
  it("発行した依頼の記録は世帯に入り、受け取ると答えと書類が世帯に入る。消すとサーバーから消え、取り込みは承認したものだけ現状に入る", async () => {
    const { t, store } = relayFor();
    const sel0 = withCustom(templateSelection("simple", blank()), "ご相談のきっかけは", "");
    const sel = { ...sel0, documents: [documentFromTemplate(sel0, "withholding", "ご本人")] };
    const r = await issueWeb(blank(), { selection: sel, customerNo: "A0042", office: OFFICE, pageUrl: "https://relay.test/h/", transport: t, now: NOW, random: new Uint8Array([1, 2, 3, 4, 5, 6]) });
    let wh = r.wh;
    expect(webLog(wh)).toHaveLength(1);
    expect(statusOf(r.entry, NOW)).toBe("issued");
    // 期限は30日の決め打ち（延長の上限は90日）
    expect(r.entry.record.expiresAt).toBe("2026-12-05T09:00:00Z");
    expect(r.entry.record.limitAt).toBe("2027-02-03T09:00:00Z");
    expect(statusOf(r.entry, new Date("2026-12-06T09:00:00Z"))).toBe("expired");
    // 案内文: URL・期限・名前を書かない・転送しない（顧客番号・金額は入れない）
    const msg = invitationText(r.entry, "【架空】みらいFP事務所");
    expect(msg).toContain(r.entry.record.url);
    expect(msg).toContain("転送しないでください");
    expect(msg).not.toContain("A0042");

    // まだ答えが無ければ受け取らない
    expect(await receiveWeb(wh, r.entry, t, NOW)).toBeNull();
    await customerAnswers(r.entry.record.url, t);
    const got = await receiveWeb(wh, r.entry, t, NOW);
    expect(got).not.toBeNull();
    wh = got!.wh;
    const e = webLog(wh)[0]!;
    expect(e.state).toBe("received");
    expect(e.files).toHaveLength(1);
    expect(e.batches).toHaveLength(1);
    expect(e.received?.gates).toEqual({ spouse: 0, child: 1 });
    expect(receivedDocuments(wh)[0]?.files).toHaveLength(1);
    // 受け取った分（答えと書類の送り）だけ消す。依頼と問いは期限まで残る
    await cleanupOnServer(e, got!.taken, t);
    expect([...store.dump().keys()].filter((k) => !k.startsWith("m/") && !k.endsWith("/q"))).toEqual([]);
    expect(await receiveWeb(wh, e, t, NOW)).toBeNull();

    // 取り込み: Excel と同じ候補の画面。承認すると現状に入り、取り込み済みの印が付く
    const view = importWeb(wh, e, "0.1.0", seq);
    const members = view.candidates.filter((c) => c.group === "家族");
    expect(members.length).toBe(2);
    expect(view.memo.some((m) => m.includes("ご相談のきっかけは"))).toBe(false);
    const applied = applyImport(wh, view, defaultSelection(view), approvalTime(new Date(2026, 10, 6, 10, 0, 0)));
    const done = markImported(applied.wh, e.record.requestId, "2026-11-06T10:00:00+09:00");
    expect(done.request.input.household.members.filter((m) => m.kind === "self" || m.kind === "child")).toHaveLength(2);
    expect(webLog(done)[0]?.state).toBe("imported");
    expect(done.hearing?.imports.at(-1)?.requestId).toBe(e.record.requestId);
    // 写し終えた書類を消す
    expect(webLog(withoutFile(done, e.record.requestId, e.files![0]!.fileId))[0]?.files).toHaveLength(0);
    // 受け付けを終える（サーバーから全部消す）
    await removeOnServer(e, t);
    expect(store.size()).toBe(0);
  });

  it("答えの後に届いた書類を、何回分でも受け取れる。送りごとに何をいつ受け取ったかが残る。取り込み済みでも受け取れる", async () => {
    const { t, store } = relayFor();
    const sel0 = templateSelection("simple", blank());
    const sel = { ...sel0, documents: [documentFromTemplate(sel0, "withholding", "ご本人")] };
    const r = await issueWeb(blank(), { selection: sel, customerNo: "A0042", office: OFFICE, pageUrl: "https://relay.test/h/", transport: t, now: NOW });
    const o = await customerAnswers(r.entry.record.url, t, false);
    // 答えだけ受け取る（書類はまだ）
    const g1 = await receiveWeb(r.wh, r.entry, t, new Date("2026-11-06T10:00:00Z"));
    expect(g1!.taken).toMatchObject({ answers: true, batches: [], files: 0 });
    await cleanupOnServer(g1!.entry, g1!.taken, t);
    let wh = markImported(g1!.wh, r.entry.record.requestId, "2026-11-06T11:00:00Z");
    // 答えの後に、書類を2回に分けて送る
    await customerMore(o, t, 1);
    await customerMore(o, t, 2);
    let e = webLog(wh)[0]!;
    expect(await checkAnswered(e, t)).toMatchObject({ answered: true, newAnswers: false, batches: 2 });
    const g2 = await receiveWeb(wh, e, t, new Date("2026-11-08T10:00:00Z"));
    expect(g2!.taken).toMatchObject({ answers: false, files: 2 });
    expect(g2!.taken.batches).toHaveLength(2);
    wh = g2!.wh;
    await cleanupOnServer(g2!.entry, g2!.taken, t);
    // もう1回（3回目）
    await customerMore(o, t, 3);
    e = webLog(wh)[0]!;
    const g3 = await receiveWeb(wh, e, t, new Date("2026-11-09T10:00:00Z"));
    wh = g3!.wh;
    await cleanupOnServer(g3!.entry, g3!.taken, t);
    e = webLog(wh)[0]!;
    expect(e.state).toBe("imported");
    expect(e.files).toHaveLength(3);
    expect(e.batches?.map((b) => b.receivedAt)).toEqual(["2026-11-08T10:00:00Z", "2026-11-08T10:00:00Z", "2026-11-09T10:00:00Z"]);
    expect(e.batches?.every((b) => b.documents[0]?.id === "d1" && b.documents[0]?.files === 1)).toBe(true);
    expect(e.files?.every((f) => e.batches?.some((b) => b.batchId === f.batchId))).toBe(true);
    expect(receivedDocuments(wh)[0]?.files).toHaveLength(3);
    // サーバーには依頼の記録と問いだけ
    expect([...store.dump().keys()].filter((k) => !k.startsWith("m/") && !k.endsWith("/q"))).toEqual([]);
    expect(accepting(e, NOW)).toBe(true);
  });

  it("延長: 押した日から30日（発行した日から90日まで）。上限では押せず、理由が分かる。お客さまの画面の期限も延びる", async () => {
    const { t, clock } = relayFor();
    const r = await issueWeb(blank(), { selection: templateSelection("simple", blank()), customerNo: "A1", office: OFFICE, pageUrl: "https://relay.test/h/", transport: t, now: NOW });
    let wh = r.wh;
    let e = r.entry;
    // 作った日に押しても延びない（目安は null。押すと今の期限のまま）
    expect(extendState(e, NOW)).toEqual({ ok: true, to: null, capped: false });
    expect((await extendWeb(wh, e, t)).changed).toBe(false);
    clock.t = new Date("2026-11-25T09:00:00Z");
    expect(extendState(e, clock.t)).toEqual({ ok: true, to: "2026-12-25T09:00:00Z", capped: false });
    const x1 = await extendWeb(wh, e, t);
    expect(x1.changed).toBe(true);
    wh = x1.wh;
    e = webLog(wh)[0]!;
    expect(e.record.expiresAt).toBe("2026-12-25T09:00:00Z");
    expect((await openRequest(new URL(e.record.url).hash, t)).packet.expiresAt).toBe("2026-12-25T09:00:00Z");
    clock.t = new Date("2026-12-20T09:00:00Z");
    wh = (await extendWeb(wh, e, t)).wh;
    e = webLog(wh)[0]!;
    clock.t = new Date("2027-01-15T09:00:00Z");
    expect(extendState(e, clock.t)).toEqual({ ok: true, to: "2027-02-03T09:00:00Z", capped: true });
    wh = (await extendWeb(wh, e, t)).wh;
    e = webLog(wh)[0]!;
    expect(e.record.expiresAt).toBe("2027-02-03T09:00:00Z");
    expect(extendState(e, clock.t)).toEqual({ ok: false, reason: "limit" });
    await expect(extendWeb(wh, e, t)).rejects.toThrow("E_RELAY_EXTEND_LIMIT");
    // 取り消した依頼は延ばせない
    expect(extendState({ ...e, state: "cancelled" }, clock.t)).toEqual({ ok: false, reason: "closed" });
  });

  it("分岐の答え（お子さま0人など）が届き、依頼の行と面談の準備で、今の世帯との違いが分かる", async () => {
    const { t } = relayFor();
    const base = fromRequest(modelHousehold("salariedCoupleTwoKids"));
    const r = await issueWeb(base, { selection: withParents(templateSelection("simple", base)), customerNo: "A1", office: OFFICE, pageUrl: "https://relay.test/h/", transport: t, now: NOW });
    const o = await openRequest(new URL(r.entry.record.url).hash, t);
    const d: Draft = { ...initialDraft(o.packet), gates: { spouse: 1, child: 0, parent: 0 }, answers: { [draftKey("hs.consent.purpose")]: v("given") } };
    await submitAnswers(o, answersOf(o.packet, d, NOW), t);
    const got = await receiveWeb(r.wh, r.entry, t, NOW);
    const e = webLog(got!.wh)[0]!;
    expect(e.received?.gates).toEqual({ spouse: 1, child: 0, parent: 0 });
    expect(gateLines(e).map((l) => `${l.label} ${l.text}`)).toEqual(["配偶者の方 いらっしゃる", "お子さま いない", "ご両親のこと いいえ（今回は答えない）"]);
    const notes = gateNotes(got!.wh);
    expect(notes?.lines).toEqual([
      { label: "配偶者の方", text: "いらっしゃる", now: null },
      { label: "お子さま", text: "いない", now: "2人" },
      { label: "ご両親のこと", text: "いいえ（今回は答えない）", now: null },
    ]);
    expect(gateNotes(base)).toBeNull();
  });

  it("元に戻す・やり直すで、依頼の記録（鍵・受け取った答え）を前の状態に戻さない", async () => {
    const { t } = relayFor();
    const before = blank();
    const r = await issueWeb(before, { selection: templateSelection("simple", before), customerNo: "A1", office: OFFICE, pageUrl: "https://relay.test/h/", transport: t, now: NOW });
    const restored = keepWebLog(before, r.wh);
    expect(webLog(restored)).toHaveLength(1);
    expect(keepWebLog(r.wh, before).hearing?.web).toBeUndefined();
  });

  it("見直し: 今の世帯に値のある項目は「確かめてもらう」から始まり、見本の問いに今の値が入る", async () => {
    const wh = fromRequest(modelHousehold("salariedCoupleTwoKids"));
    const sel = templateSelection("review", wh);
    const confirm = sel.sections.flatMap((s) => s.items).filter((i) => i.mode === "confirm");
    expect(confirm.length).toBeGreaterThan(5);
    const p = await previewPacket(wh, sel, OFFICE, NOW);
    const birth = p.items.find((i) => i.key === "hs.family.adult.birthYearMonth");
    expect(birth?.confirm).toBe(true);
    expect(Object.keys(birth?.prefill ?? {})).toContain("1");
    expect(initialDraft(p).gates.spouse).toBe(1);
  });

  it("書類待ちの1通と結びつけた書類は、頼んだ・届いたが書類のお願いの一覧で分かる", async () => {
    const { t } = relayFor();
    const sel0 = templateSelection("simple", blank());
    const doc = { ...documentFromTemplate(sel0, "pensionNotice", "ご本人"), docRequest: "ねんきん定期便|m1" };
    const r = await issueWeb(blank(), { selection: { ...sel0, documents: [doc] }, customerNo: "A1", office: OFFICE, pageUrl: "https://relay.test/h/", transport: t, now: NOW });
    expect(docRequestStatus(r.wh, NOW).get("ねんきん定期便|m1")).toEqual({ requested: true, files: 0, answer: null });
    await customerAnswers(r.entry.record.url, t);
    const got = await receiveWeb(r.wh, r.entry, t, NOW);
    expect(docRequestStatus(got!.wh, NOW).get("ねんきん定期便|m1")?.files).toBe(1);
  });

  it("事務所のひな形は事務所の既定値に入り、読み直しても残る（形の違うものは捨てる）", () => {
    const sel = templateSelection("detail", blank());
    const s = withHearingTemplates(DEFAULT_OFFICE_SETTINGS, [{ name: "詳細・子育て世帯", selection: sel }]);
    const back = readOfficeSettings(JSON.parse(JSON.stringify(s)));
    expect(back.hearingTemplates?.[0]?.name).toBe("詳細・子育て世帯");
    expect(readHearingTemplates([{ name: "x", selection: { base: { sheetId: "nope", version: 9 }, sections: [], custom: [], documents: [] } }, { name: "" }])).toEqual([]);
    expect(withHearingTemplates(s, []).hearingTemplates).toBeUndefined();
  });
});

// ---- 取り込みで今の値を壊さない（値の入った世帯に「シンプル」で聞いて取り込む） ----

const num = (text: string) => ({ status: "value" as const, raw: { kind: "number" as const, text } });

/** 値の入った世帯（夫婦と子2人。預貯金 800万円・住宅ローン 残高 2,240万円・生活費 月30万円） */
const filled = (): WorkingHousehold => fromRequest(modelHousehold("salariedCoupleTwoKids"));

/** 「シンプル」の URL を発行し、お客さまが答えて送り、FP が受け取ったところまで */
async function answeredWeb(wh: WorkingHousehold, answers: Record<string, DraftAnswer>, gates: Record<string, number> = { spouse: 1, child: 2 }, submittedAt = new Date("2026-11-06T13:15:00Z"), kind: WebTemplateKind = "simple") {
  const { t } = relayFor();
  // シンプルはご両親を既定で外すので、ご両親の取り込みを確かめるため足す（FP が足したときと同じ）
  const sel = kind === "simple" ? withParents(templateSelection(kind, wh)) : templateSelection(kind, wh);
  const r = await issueWeb(wh, { selection: sel, customerNo: "A1", office: OFFICE, pageUrl: "https://relay.test/h/", transport: t, now: NOW });
  const o = await openRequest(new URL(r.entry.record.url).hash, t);
  const d0 = initialDraft(o.packet);
  const d: Draft = { ...d0, gates: { ...d0.gates, ...gates }, answers: { [draftKey("hs.consent.purpose")]: v("given"), ...answers } };
  await submitAnswers(o, answersOf(o.packet, d, submittedAt), t);
  const got = await receiveWeb(r.wh, r.entry, t, NOW);
  if (got === null) throw new Error("受け取れない");
  return got;
}

describe("取り込みで今の値を壊さない", () => {
  it("「あとで」・空欄の項目は、今の値を空欄・0円・目安で上書きしない（候補にせず「お答えなし」。知らせの「0円として計算します」も出さない）", async () => {
    const wh = filled();
    const got = await answeredWeb(wh, { [draftKey("hs.family.adult.birthYearMonth", 1)]: ym(1981, 7), [draftKey("hs.assets.depositTotal")]: { status: "later" } });
    const view = importWeb(got.wh, got.entry, "0.1.0", seq);
    const deposit = view.candidates.find((c) => c.group === "貯蓄・投資");
    expect(deposit?.kind).toBe("noAnswer");
    expect(deposit?.fields[0]?.diffs[0]).toMatchObject({ current: "8,000,000円", kept: true });
    // 生活費（空欄・目安）も今の値のまま
    expect(view.candidates.find((c) => c.group === "生活費")?.kind).toBe("noAnswer");
    const sel = defaultSelection(view);
    expect(view.candidates.filter((c) => c.kind === "noAnswer").some((c) => sel.has(c.id))).toBe(false);
    expect([...view.issues.map((i) => i.message), ...view.checklist.map((c) => c.message)].some((m) => m.includes("0円として計算します"))).toBe(false);
    // FP が全部にチェックを入れても、お答えなしの物は入れない
    const all = new Set(view.candidates.map((c) => c.id));
    const h = applyImport(got.wh, view, all, AT_WEB).wh.request.input.household;
    expect((h.accounts ?? []).find((a) => a.kind === "deposit")?.marketValue).toMatchObject({ value: 8000000, state: "confirmed" });
    expect(h.livingExpenses?.[0]?.monthly).toMatchObject({ value: 300000, state: "confirmed" });
    expect(h.members.find((m) => m.kind === "spouse")?.birth.birthYearMonth).toBe("1983-10");
  });

  it("粗い答え（毎月の返済額だけ・残高は「わからない」）で置いた仮のローンは、詳しく入れてあったローンを既定で残す。候補には「今 → 届いた値」が並ぶ", async () => {
    const wh = filled();
    const got = await answeredWeb(wh, { [draftKey("hs.housing.type")]: v("own"), [draftKey("hs.loan.monthlyTotal")]: num("98000"), [draftKey("hs.loan.balanceTotal")]: { status: "unknown" } });
    const view = importWeb(got.wh, got.entry, "0.1.0", seq);
    const loan = view.candidates.find((c) => c.group === "住宅ローン");
    expect(loan?.kind).toBe("changed");
    expect(loan?.keep).toContain("今の値の方が詳しいので残します");
    expect(defaultSelection(view).has(loan?.id ?? "")).toBe(false);
    const diffs = loan?.fields.flatMap((f) => f.diffs) ?? [];
    expect(diffs.find((d) => d.label === "残高")).toMatchObject({ current: "22,400,000円", next: "わからない", rough: true });
    expect(diffs.find((d) => d.label === "借入額")).toMatchObject({ current: "32,000,000円", rough: true });
    const out = applyImport(got.wh, view, defaultSelection(view), AT_WEB).wh.request.input.household;
    expect(out.debts?.[0]).toMatchObject({ principal: 32000000, balance: { value: 22400000, state: "confirmed" }, start: { at: "2016-04" } });
  });

  it("範囲の答えも、確定の今の値を既定で残す（Excel と同じ候補の画面）", async () => {
    const wh = filled();
    const got = await answeredWeb(wh, { [draftKey("hs.work.type", 1)]: v("regular"), [draftKey("hs.income.annualRange", 1)]: v("600〜700万円") });
    const view = importWeb(got.wh, got.entry, "0.1.0", seq);
    const work = view.candidates.find((c) => c.title === "ご本人の仕事と収入");
    expect(work?.keep).not.toBeNull();
    expect(work?.fields.flatMap((f) => f.diffs).find((d) => d.label === "給与")).toMatchObject({ current: "6,200,000円", rough: true });
    expect(defaultSelection(view).has(work?.id ?? "")).toBe(false);
  });

  it("答えた欄だけが変わる: 答えの無い欄（性別・仕事を始めた年月など）は、承認しても今の値と今の仮の印のまま", async () => {
    const base = filled();
    // ご本人を女性にしておく（性別を答えないと、取り込みの初めの値は男性）
    const wh: WorkingHousehold = { ...base, request: { ...base.request, input: { ...base.request.input, household: { ...base.request.input.household, members: base.request.input.household.members.map((m) => (m.kind === "self" ? { ...m, sex: "female" as const } : m)) } } } };
    // 配偶者の方は年収だけ答える（生年月は答えない → 仮の値〔ご本人と同じ年月〕で補うが、今の生年月を残す）
    const got = await answeredWeb(wh, { [draftKey("hs.family.adult.birthYearMonth", 1)]: ym(1980, 1), [draftKey("hs.work.type", 1)]: v("regular"), [draftKey("hs.income.annual", 1)]: num("900"), [draftKey("hs.income.annual", 2)]: num("120") });
    const view = importWeb(got.wh, got.entry, "0.1.0", seq);
    const self = view.candidates.find((c) => c.title === "ご本人");
    expect(self?.kind).toBe("changed");
    const work = view.candidates.find((c) => c.title === "ご本人の仕事と収入");
    expect(work?.kind).toBe("changed");
    expect(work?.keep).toBeNull();
    expect(work?.fields.flatMap((f) => f.diffs).find((d) => d.label === "仕事を始めた年月")).toMatchObject({ current: "2004年4月", kept: true });
    const sel = defaultSelection(view);
    expect(sel.has(self?.id ?? "")).toBe(true);
    expect(sel.has(work?.id ?? "")).toBe(true);
    const out = applyImport(got.wh, view, sel, AT_WEB).wh;
    const h = out.request.input.household;
    const me = h.members.find((m) => m.kind === "self");
    expect(me).toMatchObject({ sex: "female", birth: { birthYearMonth: "1980-01" } });
    const p = (h.employmentPeriods ?? []).find((x) => x.member === me?.id);
    expect(p?.salary?.annual).toMatchObject({ value: expect.any(Number) as number });
    expect(p?.from).toEqual({ at: "2004-04" });
    expect(view.candidates.find((c) => c.title === "配偶者")?.kind).toBe("noAnswer");
    expect(h.members.find((m) => m.kind === "spouse")?.birth.birthYearMonth).toBe("1983-10");
    expect(out.assumed[`work/period/${p?.id ?? ""}/from`]).toBeUndefined();
  });

  it("Web の答えでは「記入の年月が計算基準月より後」を出さない（送った月はお客さまが選んだ年月でない）。1年を超えて離れたときだけ出す", async () => {
    const wh = filled();
    expect(wh.request.input.baseMonth).toBe("2026-10");
    const got = await answeredWeb(wh, { [draftKey("hs.family.adult.birthYearMonth", 1)]: ym(1981, 7) });
    const view = importWeb(got.wh, got.entry, "0.1.0", seq);
    const later = (vw: typeof view) => [...vw.issues.map((i) => i.message), ...vw.checklist.map((c) => c.message)].filter((m) => m.includes("計算基準月") && m.includes("後です"));
    expect(later(view)).toEqual([]);
    const far = await answeredWeb(wh, { [draftKey("hs.family.adult.birthYearMonth", 1)]: ym(1981, 7) }, { spouse: 1, child: 2 }, new Date("2027-12-01T09:00:00Z"));
    expect(later(importWeb(far.wh, far.entry, "0.1.0", seq)).some((m) => m.includes("1年を超えて"))).toBe(true);
  });

  it("送った日時は受け取りの記録にあり、画面の言葉にできる", async () => {
    const got = await answeredWeb(filled(), {});
    expect(got.entry.received?.submittedAt).toBe("2026-11-06T13:15:00.000Z");
    expect(sentAtText(got.entry.received?.submittedAt ?? "")).toMatch(/11月[67]日/);
    expect(sentAtText("x")).toBe("不明");
  });

  it("元に戻すと、依頼の記録は「取り込み済み」のままだが、世帯の取り込みの記録と照らして「取り込みを元に戻しました」と出す。やり直すと取り込み済みに戻る", async () => {
    const got = await answeredWeb(blank(), { [draftKey("hs.family.adult.birthYearMonth", 1)]: ym(1985, 6) }, { spouse: 0, child: 0 });
    const before = got.wh;
    const view = importWeb(before, got.entry, "0.1.0", seq);
    const done = markImported(applyImport(before, view, defaultSelection(view), AT_WEB).wh, got.entry.record.requestId, AT_WEB);
    const e = () => webLog(done)[0]!;
    expect(statusOf(e(), NOW, false, done)).toBe("imported");
    // 元に戻す: 世帯は前の状態、依頼の記録は今のもの（keepWebLog）
    const undone = keepWebLog(before, done);
    expect(webLog(undone)[0]?.state).toBe("imported");
    expect(statusOf(webLog(undone)[0]!, NOW, false, undone)).toBe("undone");
    expect(STATUS_TEXT.undone).toContain("元に戻しました");
    // やり直す
    const redone = keepWebLog(done, undone);
    expect(statusOf(webLog(redone)[0]!, NOW, false, redone)).toBe("imported");
  });

  it("取り込んだ親には、画面で足した親と同じく、亡くなる見込みを平均余命の推定（仮の印）で入れる", async () => {
    const got = await answeredWeb(blank(), { [draftKey("hs.family.adult.birthYearMonth", 1)]: ym(1985, 6), [draftKey("hs.family.parent.alive", 1)]: v("alive"), [draftKey("hs.family.parent.age", 1)]: { status: "value", raw: { kind: "number", text: "70" } } }, { spouse: 0, child: 0 });
    const view = importWeb(got.wh, got.entry, "0.1.0", seq);
    const father = view.candidates.find((c) => c.kind === "new" && c.title === "父");
    expect(father?.note).toContain("平均余命の推定");
    const out = applyImport(got.wh, view, defaultSelection(view), AT_WEB).wh;
    const p = out.request.input.household.members.find((m) => m.kind === "parent");
    expect(p?.leaves).not.toBeNull();
    expect(p?.leaves).toBeDefined();
    expect(out.assumed[`family/${p?.id ?? ""}/leaves`]).toContain("平均余命");
  });

  it("定年を聞いていない・答えの無い働き方は、今の終わりを残し、働く最後の年齢の推定で置きかえない（終わりの無い取り込んだ働き方だけ推定を入れる）", async () => {
    const wh = filled();
    const before = wh.request.input.household.employmentPeriods ?? [];
    const got = await answeredWeb(wh, { [draftKey("hs.family.adult.birthYearMonth", 1)]: ym(1981, 7), [draftKey("hs.work.type", 1)]: v("regular"), [draftKey("hs.income.annual", 1)]: num("900") });
    const view = importWeb(got.wh, got.entry, "0.1.0", seq);
    const work = view.candidates.find((c) => c.title === "ご本人の仕事と収入");
    expect(work?.fields.flatMap((f) => f.diffs).find((d) => d.label === "仕事を終える年月")).toMatchObject({ current: "2041年6月", kept: true });
    const out = applyImport(got.wh, view, defaultSelection(view), AT_WEB).wh;
    const h = out.request.input.household;
    const me = h.members.find((m) => m.kind === "self")!;
    // 期間は増えず（推定の定年後の再雇用を足さない）、終わりは今の 2041年6月のまま。推定の印も付けない
    expect((h.employmentPeriods ?? []).filter((p) => p.member === me.id)).toHaveLength(before.filter((p) => p.member === me.id).length);
    expect((h.employmentPeriods ?? []).find((p) => p.member === me.id && p.type === "regular")?.to).toEqual({ at: "2041-06" });
    expect(Object.keys(out.assumed).filter((k) => k.startsWith(`work/${me.id}/`))).toEqual([]);
    // 今の世帯で終わりを入れていなかった期間も、答えが無ければ今のまま（推定を入れない）
    const open = structuredClone(wh.request);
    for (const p of open.input.household.employmentPeriods ?? []) if (p.member === me.id) p.to = null;
    const w2 = { ...wh, request: open };
    const got2 = await answeredWeb(w2, { [draftKey("hs.family.adult.birthYearMonth", 1)]: ym(1981, 7), [draftKey("hs.work.type", 1)]: v("regular"), [draftKey("hs.income.annual", 1)]: num("900") });
    const view2 = importWeb(got2.wh, got2.entry, "0.1.0", seq);
    const out2 = applyImport(got2.wh, view2, defaultSelection(view2), AT_WEB).wh;
    expect((out2.request.input.household.employmentPeriods ?? []).find((p) => p.member === me.id && p.type === "regular")?.to).toBeNull();
    // 空の世帯に取り込んだ働き方（終わりが無い）には、推定を入れる
    const got3 = await answeredWeb(blank(), { [draftKey("hs.family.adult.birthYearMonth", 1)]: ym(1981, 7), [draftKey("hs.work.type", 1)]: v("regular"), [draftKey("hs.income.annual", 1)]: num("900") }, { spouse: 0, child: 0 });
    const view3 = importWeb(got3.wh, got3.entry, "0.1.0", seq);
    const out3 = applyImport(got3.wh, view3, defaultSelection(view3), AT_WEB).wh;
    const me3 = out3.request.input.household.members.find((m) => m.kind === "self")!;
    expect((out3.request.input.household.employmentPeriods ?? []).find((p) => p.member === me3.id && p.type === "regular")?.to).not.toBeNull();
    expect(out3.assumed[`work/${me3.id}/mainEnd`]).toBeDefined();
  });

  it("推定の印（働く最後の年齢・親の亡くなる見込み）と子の独立の時期は、構成員の候補を承認しても今のまま。元に戻すと推定の分も前に戻る", async () => {
    // 1回目: 空の世帯に取り込む（働き方の終わりと親の亡くなる見込みは推定）
    const first = await answeredWeb(blank(), { [draftKey("hs.family.adult.birthYearMonth", 1)]: ym(1981, 7), [draftKey("hs.work.type", 1)]: v("regular"), [draftKey("hs.income.annual", 1)]: num("900"), [draftKey("hs.family.parent.alive", 1)]: v("alive"), [draftKey("hs.family.parent.age", 1)]: num("70") }, { spouse: 0, child: 0 });
    const v1 = importWeb(first.wh, first.entry, "0.1.0", seq);
    const w1 = markImported(applyImport(first.wh, v1, defaultSelection(v1), AT_WEB).wh, first.entry.record.requestId, AT_WEB);
    const me = w1.request.input.household.members.find((m) => m.kind === "self")!;
    const father = w1.request.input.household.members.find((m) => m.kind === "parent")!;
    const marks = (w: WorkingHousehold) => Object.keys(w.assumed).filter((k) => k.startsWith(`work/${me.id}/`) || k === `family/${father.id}/leaves`).sort();
    expect(marks(w1)).toEqual(expect.arrayContaining([`family/${father.id}/leaves`, `work/${me.id}/mainEnd`]));
    // 元に戻すと、取り込みの前の世帯（推定も無い）に戻る
    const undone = keepWebLog(first.wh, w1);
    expect(marks(undone)).toEqual([]);
    expect(undone.request.input.household.employmentPeriods ?? []).toEqual(first.wh.request.input.household.employmentPeriods ?? []);
    // 2回目: 生年月と親の年齢を答え直す（定年は聞いていない）。ご本人・父の候補を承認しても、推定の印は残る
    const second = await answeredWeb(w1, { [draftKey("hs.family.adult.birthYearMonth", 1)]: ym(1981, 9), [draftKey("hs.work.type", 1)]: v("regular"), [draftKey("hs.income.annual", 1)]: num("900"), [draftKey("hs.family.parent.alive", 1)]: v("alive"), [draftKey("hs.family.parent.age", 1)]: num("72") }, { spouse: 0, child: 0 });
    const v2 = importWeb(second.wh, second.entry, "0.1.0", seq);
    expect(v2.candidates.find((c) => c.title === "ご本人")?.kind).toBe("changed");
    const w2 = applyImport(second.wh, v2, defaultSelection(v2), AT_WEB).wh;
    expect(marks(w2)).toEqual(marks(w1));
    expect(w2.request.input.household.members.find((m) => m.id === father.id)?.leaves).toEqual(father.leaves);
    // 子の独立の時期（シートで聞かない）は、子の生年月を答えても今のまま
    const wh = filled();
    const kids = wh.request.input.household.members.filter((m) => m.kind === "child");
    const got = await answeredWeb(wh, { [draftKey("hs.family.child.birthYearMonth", 1)]: ym(2012, 6) });
    const view = importWeb(got.wh, got.entry, "0.1.0", seq);
    const out = applyImport(got.wh, view, new Set(view.candidates.map((c) => c.id)), AT_WEB).wh.request.input.household;
    for (const k of kids) expect(out.members.find((m) => m.id === k.id)?.leaves).toEqual(k.leaves);
  });
});

// ---- 分岐の答えを取り込みにつなぐ（0139・0158 の追記 2026-11-08） ----

describe("分岐の答え（お子さまの人数など）を取り込みの候補の画面に出す", () => {
  const texts = (view: ReturnType<typeof importWeb>) => view.gates.map((g) => g.text);

  it("「お子さま いない」と答えても、今の世帯の子2人と教育の行は消さない。候補の画面に要確認の知らせを出す", async () => {
    const wh = filled();
    const kids = wh.request.input.household.members.filter((m) => m.kind === "child");
    expect(kids).toHaveLength(2);
    const goals = wh.request.input.household.goals ?? [];
    const got = await answeredWeb(wh, { [draftKey("hs.family.adult.birthYearMonth", 1)]: ym(1981, 7) }, { spouse: 1, child: 0 });
    const view = importWeb(got.wh, got.entry, "0.1.0", seq);
    expect(view.result.gates).toEqual({ spouse: 1, child: 0 });
    expect(texts(view)).toEqual(["お子さまは0人とのお答え（今の世帯は2人）"]);
    // 子を消す候補は作らない（子の候補そのものが無い）
    expect(view.candidates.filter((c) => c.group === "家族").map((c) => c.title)).not.toContain("第1子");
    // FP が全部にチェックを入れて承認しても、子と教育の行は今のまま
    const out = applyImport(got.wh, view, new Set(view.candidates.map((c) => c.id)), AT_WEB).wh.request.input.household;
    expect(out.members.filter((m) => m.kind === "child").map((m) => m.id)).toEqual(kids.map((m) => m.id));
    expect(out.goals ?? []).toEqual(goals);
  });

  it("配偶者の方「いらっしゃらない」: 今の配偶者の方は消さずに知らせる。ご両親のことを「答えない」: ご両親の問いはお答えの無い所（今の値のまま）", async () => {
    const wh = filled();
    const got = await answeredWeb(wh, { [draftKey("hs.family.adult.birthYearMonth", 1)]: ym(1981, 7) }, { spouse: 0, child: 2 });
    const view = importWeb(got.wh, got.entry, "0.1.0", seq);
    expect(texts(view)).toEqual(["配偶者はいないとのお答え（今の世帯にはいます）"]);
    const out = applyImport(got.wh, view, new Set(view.candidates.map((c) => c.id)), AT_WEB).wh.request.input.household;
    expect(out.members.filter((m) => m.kind === "spouse")).toHaveLength(1);
    expect((out.employmentPeriods ?? []).filter((p) => p.member === out.members.find((m) => m.kind === "spouse")?.id).length).toBeGreaterThan(0);

    // ご両親と仕送りの行がある世帯
    const pm = fromRequest(modelHousehold("parentMoney"));
    const before = pm.request.input.household;
    const parents = before.members.filter((m) => m.kind === "parent");
    expect(parents.length).toBeGreaterThan(0);
    const got2 = await answeredWeb(pm, { [draftKey("hs.family.adult.birthYearMonth", 1)]: ym(1962, 3) }, { spouse: 0, child: 0, parent: 0 });
    const view2 = importWeb(got2.wh, got2.entry, "0.1.0", seq);
    expect(texts(view2)).toEqual([`ご両親のことは答えないとのお答え（今の世帯のご両親 ${parents.length}人と、仕送り・援助・介護・受け取る予定の相続の値は今のまま）`]);
    // ご両親の候補は作らず、承認しても今の値のまま
    expect(view2.candidates.some((c) => c.group === "家族" && c.title !== "ご本人")).toBe(false);
    const out2 = applyImport(got2.wh, view2, new Set(view2.candidates.map((c) => c.id)), AT_WEB).wh.request.input.household;
    expect(out2.members.filter((m) => m.kind === "parent")).toEqual(parents);
    expect(out2.periodicExpenses ?? []).toEqual(before.periodicExpenses ?? []);
    expect(out2.incomeFlows ?? []).toEqual(before.incomeFlows ?? []);
    expect(out2.careExpenses ?? []).toEqual(before.careExpenses ?? []);
  });

  it("分岐の答えが今の世帯と同じなら何も出さない（子2人の世帯に2人・子のいない世帯に0人・ご両親のいない世帯に「答えない」）", async () => {
    const same = await answeredWeb(filled(), { [draftKey("hs.family.adult.birthYearMonth", 1)]: ym(1981, 7) }, { spouse: 1, child: 2, parent: 1 });
    expect(importWeb(same.wh, same.entry, "0.1.0", seq).gates).toEqual([]);
    const none = await answeredWeb(blank(), { [draftKey("hs.family.adult.birthYearMonth", 1)]: ym(1985, 6) }, { spouse: 0, child: 0, parent: 0 });
    const view = importWeb(none.wh, none.entry, "0.1.0", seq);
    expect(view.result.gates).toEqual({ spouse: 0, child: 0, parent: 0 });
    expect(view.gates).toEqual([]);
  });

  it("詳細の問い: 住宅ローンの本数・保険の件数も今の世帯と照らす。人数の最後の段（4人以上）は今の世帯がそれ以上なら同じとみる", async () => {
    const wh = filled();
    const got = await answeredWeb(wh, { [draftKey("hs.family.adult.birthYearMonth", 1)]: ym(1981, 7), [draftKey("hs.housing.type")]: v("own") }, { spouse: 1, child: 2, loan: 0, policy: 0 }, undefined, "detail");
    const view = importWeb(got.wh, got.entry, "0.1.0", seq);
    expect(view.result.gates).toMatchObject({ loan: 0, policy: 0 });
    expect(texts(view)).toEqual(["住宅ローンは0本とのお答え（今の世帯は1本）", "保険は0件とのお答え（今の世帯は1件）"]);
    const out = applyImport(got.wh, view, new Set(view.candidates.map((c) => c.id)), AT_WEB).wh.request.input.household;
    expect(out.debts).toHaveLength(1);
    expect(out.insuranceContracts).toHaveLength(1);
    // 4人以上
    const full = sheetFor("detail");
    const h = wh.request.input.household;
    const child = h.members.find((m) => m.kind === "child")!;
    const withKids = (n: number) => ({ ...h, members: [...h.members.filter((m) => m.kind !== "child"), ...Array.from({ length: n }, (_, i) => ({ ...child, id: `kid-${i}` }))] });
    expect(gateNotices({ child: 4 }, full, withKids(5))).toEqual([]);
    expect(gateNotices({ child: 4 }, full, withKids(3)).map((g) => g.text)).toEqual(["お子さまは4人以上とのお答え（今の世帯は3人）"]);
    expect(gateNotices({ spouse: 1 }, full, { ...h, members: h.members.filter((m) => m.kind !== "spouse") }).map((g) => g.text)).toEqual(["配偶者がいるとのお答え（今の世帯にはいません）"]);
    expect(gateNotices(undefined, full, h)).toEqual([]);
  });
});

const AT_WEB = approvalTime(new Date(2026, 10, 7, 10, 0, 0));
