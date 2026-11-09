// Web のヒアリング（0125・0158）: 暗号化して開くまでの一周、書類の送り（何回でも・答えの後も）、期限の延長、期限切れ・消したもの・改ざんした暗号文を断ること、
// 分岐の答えを届けること、問いを飛ばす決まり、取り込みの候補
import { describe, expect, it } from "vitest";
import { handleApi, PAGE_HEADERS, sweepExpired } from "../relay/handler.ts";
import { memoryStore } from "../relay/store.ts";
import { importAnswers } from "../src/index.ts";
import { exportAnswers } from "../src/export.ts";
import { answersOf, answerText, b64u, buildPacket, checkAnswers, checkDocuments, estimate, extendRequest, extendTarget, gateText, markSent, progress, removeReceived, screenId, sendDocuments, unsentFiles, webPrefill, yearChoices, DOCUMENT_TEMPLATES, draftKey, filledOf, fromB64u, importDefinition, initialDraft, issueRequest, openRequest, receive, relay, removeFile, screens, selectionFromSheet, sniffMime, submitAnswers, uploadFile, utf8, type Draft, type DraftAnswer, type DraftFile, type Opened, type QuestionsPacket, type RelayTransport, type Screen, type WebSelection } from "../src/web/index.ts";
import { API_PREFIX } from "../src/web/protocol.ts";
import { full2, full3, full5, idSeq, modelHousehold, simple } from "./helpers.ts";

const OFFICE = { name: "【架空】みらいFP事務所", color: "#2f6f5e", purpose: "ライフプランの作成のため", privacyContact: "" };

function relayFor(now: { t: Date } = { t: new Date("2026-11-05T09:00:00Z") }) {
  const store = memoryStore();
  const env = { store, now: () => now.t };
  const transport: RelayTransport = async (r) => {
    const headers: Record<string, string> = {};
    if (r.token !== undefined) headers.authorization = `Bearer ${r.token}`;
    const res = await handleApi(new Request(`https://relay.test${API_PREFIX}${r.path}`, { method: r.method, headers, ...(r.body !== undefined ? { body: r.body } : {}) }), env);
    return { status: res.status, body: await res.text() };
  };
  return { store, transport, now };
}

const v = (text: string, kind: "text" | "number" = "text"): DraftAnswer => ({ status: "value", raw: { kind, text } });
const ym = (y: number, m: number): DraftAnswer => ({ status: "value", raw: { kind: "text", text: String(y) }, raw2: { kind: "number", text: String(m) } });
const withAnswers = (d: Draft, a: Record<string, DraftAnswer>, gates: Draft["gates"] = {}): Draft => ({ ...d, gates: { ...d.gates, ...gates }, answers: { ...d.answers, ...a } });
/** 画面に出る問いの一覧（画面にまとめた問いも1つずつ。別の答え方の欄〔範囲・年齢〕は入れない） */
const itemScreens = (list: Screen[]) => list.flatMap((s) => (s.kind === "item" ? s.fields.map((f) => draftKey(f.key, f.index)) : []));
const itemOnly = (list: Screen[]) => list.filter((s): s is Extract<Screen, { kind: "item" }> => s.kind === "item");
const jpeg = (n: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: n }, (_, i) => i % 251)]) as Uint8Array<ArrayBuffer>;
/** ファイルを置いて、下書きの1ファイルにする */
async function put(o: Opened, t: RelayTransport, bytes: Uint8Array<ArrayBuffer>, label = "写真1"): Promise<DraftFile> {
  const up = await uploadFile(o, bytes, t);
  return { fileId: up.fileId, mime: "image/jpeg", bytes: bytes.length, sha256: up.sha256, label };
}
const DAY = 86400_000;

async function issueSimple(t: RelayTransport, sel?: WebSelection, def = simple()) {
  const selection = sel ?? { ...selectionFromSheet(def), custom: [{ key: "ext.office.qabcd", label: "ご相談のきっかけは何ですか" }], documents: [{ id: "d1", kind: "withholding", title: "源泉徴収票（ご本人）", purpose: DOCUMENT_TEMPLATES[0]!.purpose, where: DOCUMENT_TEMPLATES[0]!.where }] };
  const withCustom: WebSelection = sel ?? { ...selection, sections: [...selection.sections, { id: "fp", items: [{ key: "ext.office.qabcd", mode: "ask" }] }] };
  const issued = await issueRequest({ definition: def, selection: withCustom, requestId: "R-7K3P9Q", customerNo: "A0042", office: OFFICE, now: new Date("2026-11-05T09:00:00Z"), pageUrl: "https://relay.test/h/", transport: t });
  return { def, issued };
}

describe("暗号化して開くまでの一周", () => {
  it("FP が作った依頼を、お客さまが開いて答え・書類を送り、FP だけが開ける。取り込みは Excel と同じ候補になる", async () => {
    const { transport, store } = relayFor();
    const { def, issued } = await issueSimple(transport);
    const url = issued.record.url;
    expect(url.startsWith("https://relay.test/h/#1.")).toBe(true);
    // サーバーには暗号文とハッシュだけ（問いの言葉・事務所の名前・合言葉そのものは無い）
    const everything = [...store.dump().values()].join("\n");
    expect(everything).not.toContain("みらいFP事務所");
    expect(everything).not.toContain("ご相談のきっかけ");
    expect(everything).not.toContain(issued.record.secrets.pickupToken);
    expect(everything).not.toContain(issued.record.secrets.secret);

    const opened = await openRequest(new URL(url).hash, transport);
    expect(opened.packet.office.name).toBe(OFFICE.name);
    expect(opened.submitted).toBe(false);
    let d = initialDraft(opened.packet);
    d = withAnswers(
      d,
      {
        [draftKey("hs.consent.purpose")]: v("given"),
        [draftKey("hs.consent.familyInfo")]: v("given"),
        [draftKey("hs.consent.externalAi")]: v("refused"),
        [draftKey("hs.family.adult.birthYearMonth", 1)]: ym(1986, 4),
        [draftKey("hs.family.adult.sex", 1)]: v("female"),
        [draftKey("hs.family.adult.birthYearMonth", 2)]: ym(1984, 9),
        [draftKey("hs.family.adult.sex", 2)]: v("male"),
        [draftKey("hs.family.child.birthYearMonth", 1)]: ym(2018, 6),
        [draftKey("hs.work.type", 1)]: v("regular"),
        [draftKey("hs.income.annual", 1)]: v("520", "number"),
        [draftKey("hs.work.type", 2)]: v("partTime"),
        [draftKey("hs.income.annualRange", 2)]: v("100〜200万円"),
        [draftKey("hs.housing.type")]: v("rent"),
        [draftKey("hs.housing.rent")]: v("98000", "number"),
        [draftKey("hs.expense.living")]: { status: "unknown" },
        [draftKey("ext.office.qabcd")]: v("友人の紹介です"),
      },
      { spouse: 1, child: 1 },
    );
    const photo = jpeg(3000);
    const f1 = await put(opened, transport, photo);
    d = { ...d, documents: { d1: { status: "attached", files: [f1] } } };
    // 書類の送り（答えと別に）→ 答え
    expect(await sendDocuments(opened, unsentFiles(d), transport)).toEqual([f1.fileId]);
    const packet = answersOf(opened.packet, d, new Date("2026-11-06T10:00:00+09:00"));
    expect(packet.gates).toEqual({ spouse: 1, child: 1 });
    expect(packet.documents).toEqual([{ id: "d1", status: "attached" }]);
    await submitAnswers(opened, packet, transport);
    const again = await openRequest(new URL(url).hash, transport);
    expect(again.submitted).toBe(true);
    expect(again.submittedAt).toBe("2026-11-05T09:00:00Z");
    // 答えの暗号文にも、言葉は平文で載らない
    expect([...store.dump().values()].join("\n")).not.toContain("友人の紹介");

    const got = await receive(issued.record, def, transport);
    expect(got).not.toBeNull();
    expect(got!.batches).toHaveLength(1);
    expect(got!.batches[0]!.files).toHaveLength(1);
    expect(got!.batches[0]!.files[0]!.bytes).toEqual(photo);
    expect(got!.batches[0]!.missingFiles).toBe(0);
    expect(got!.answers!.dropped).toBe(0);
    expect(got!.answers!.gates).toEqual({ spouse: 1, child: 1 });
    expect(got!.answers!.documents[0]).toEqual({ id: "d1", status: "attached" });
    const filled = filledOf(issued.record, got!.answers!, "0.1.0");
    expect(filled.management).toMatchObject({ sheetId: "basic", sheetVersion: 3, requestId: "R-7K3P9Q", layoutDigest: issued.record.digest });
    const r = importAnswers(importDefinition(def, issued.record.selection), filled, { baseMonth: "2026-11", newId: idSeq("web") });
    const members = r.candidates.filter((c) => c.collection === "members");
    expect(members.length).toBe(3);
    expect(r.consents.map((c) => `${c.kind}:${c.decision}`).sort()).toEqual(["externalAi:refused", "familyInfo:given", "purpose:given"]);
    // FP の独自の質問はメモに入る（計算に使わない）
    expect(r.memo.some((m) => m.includes("ご相談のきっかけは何ですか") && m.includes("友人の紹介です"))).toBe(true);
    // 範囲の答え（配偶者の方の年収）は推定（範囲の真ん中）
    const spouseWork = r.candidates.find((c) => c.collection === "employmentPeriods" && c.fields.some((f) => f.range !== undefined));
    expect(spouseWork).toBeDefined();
    // 記入の年月は送った月
    expect(filled.answers.find((a) => a.key === "hs.meta.filledOn")).toMatchObject({ raw: { text: "2026" }, raw2: { text: "11" } });

    // 受け取ったら、受け取った答えと送りだけを消す（依頼と問いは期限まで残り、お客さまは書類を足せる）
    await removeReceived(issued.record, transport, { answers: true, batches: got!.batches.map((b) => b.batchId) });
    expect([...store.dump().keys()].filter((k) => !k.startsWith("m/") && !k.endsWith("/q"))).toEqual([]);
    expect(await receive(issued.record, def, transport)).toBeNull();
    // FP が依頼を消すと全部消える
    await relay.remove(transport, issued.record.serverId, issued.record.secrets.pickupToken);
    expect(store.size()).toBe(0);
    await expect(openRequest(new URL(url).hash, transport)).rejects.toThrow("E_RELAY_GONE");
  });

  it("書類は答えと別に動く: 答えの前に書類だけ送れる・答えの後も何回でも送れる。答えは2回は送れない。送り状に載せたファイルは外せない", async () => {
    const { transport, store } = relayFor();
    const { def, issued } = await issueSimple(transport);
    const o = await openRequest(new URL(issued.record.url).hash, transport);
    // 付けて外す（送り状に載せる前は外せる）
    const a = await uploadFile(o, jpeg(10), transport);
    await removeFile(o, a.fileId, transport);
    expect([...store.dump().keys()].some((k) => k.includes("/f/"))).toBe(false);
    // 答えの前に書類だけ送る
    const f1 = await put(o, transport, jpeg(100));
    let d: Draft = { ...initialDraft(o.packet), documents: { d1: { status: "attached", files: [f1] } } };
    const sent1 = await sendDocuments(o, unsentFiles(d), transport);
    d = markSent(d, sent1, "2026-11-05T09:00:00Z");
    expect(unsentFiles(d)).toEqual([]);
    // 同じ送りをもう一度送るのは受ける（つながりが切れたときの送り直し）。送り状に載せたファイルは外せない
    await sendDocuments(o, [{ id: "d1", files: [f1] }], transport);
    await expect(removeFile(o, f1.fileId, transport)).rejects.toThrow("E_RELAY_SEALED");
    // 別の送りに同じファイルを載せられない・置いていないファイルを載せられない
    const f2 = await put(o, transport, jpeg(200), "写真2");
    await expect(sendDocuments(o, [{ id: "d1", files: [f1, f2] }], transport)).rejects.toThrow("E_RELAY_SEALED");
    await expect(sendDocuments(o, [{ id: "d1", files: [{ ...f2, fileId: "AAAAAAAAAAAAAAAA" }] }], transport)).rejects.toThrow("E_RELAY_BAD");
    // 答え（1回だけ）
    await submitAnswers(o, answersOf(o.packet, d, new Date()), transport);
    await expect(submitAnswers(o, answersOf(o.packet, d, new Date()), transport)).rejects.toThrow("E_RELAY_SUBMITTED");
    // 答えの後も、書類を2回に分けて送れる
    await sendDocuments(o, [{ id: "d1", files: [f2] }], transport);
    const f3 = await put(o, transport, jpeg(300), "写真3");
    await sendDocuments(o, [{ id: "d1", files: [f3] }], transport);
    const st = await relay.status(transport, issued.record.serverId, issued.record.secrets.pickupToken);
    expect(st.submitted).toBe(true);
    expect(st.answers).toBe(true);
    expect(st.batches.map((b) => b.files.length)).toEqual([1, 1, 1]);
    // FP が答えと書類を受け取って消した後も、お客さまは書類を足せる。FP は次に新しい送りだけを受け取る
    const got = await receive(issued.record, def, transport);
    expect(got!.answers).not.toBeNull();
    expect(got!.batches.flatMap((b) => b.files.map((f) => f.fileId)).sort()).toEqual([f1.fileId, f2.fileId, f3.fileId].sort());
    await removeReceived(issued.record, transport, { answers: true, batches: got!.batches.map((b) => b.batchId) });
    const f4 = await put(o, transport, jpeg(400), "写真4");
    await sendDocuments(o, [{ id: "d1", files: [f4] }], transport);
    const next = await receive(issued.record, def, transport, { answers: false });
    expect(next!.answers).toBeNull();
    expect(next!.batches).toHaveLength(1);
    expect(next!.batches[0]!.files[0]!.fileId).toBe(f4.fileId);
    // もう受け取った送りは読まない（消し損ねたとき）
    expect(await receive(issued.record, def, transport, { answers: false, knownBatches: [next!.batches[0]!.batchId] })).toBeNull();
    // 送りの数の上限
    expect(st.batches.length).toBeLessThan(30);
  });

  it("書類の送り状を信用しない: 頼んでいない書類・送りに載っていないファイル・重なり・形の違いを捨てる", () => {
    const sel: WebSelection = { ...selectionFromSheet(simple()), documents: [{ id: "d1", kind: "withholding", title: "源泉徴収票", purpose: "", where: "" }] };
    const f = (fileId: string) => ({ fileId, mime: "image/jpeg", bytes: 10, sha256: "a".repeat(64) });
    const ok = "A".repeat(16);
    const r = checkDocuments({ format: "fprise-lifeplan-hearing-web-documents", version: "0.2", requestId: "R-7K3P9Q", batchId: "B".repeat(16), sentAt: "2026-11-06T00:00:00Z", documents: [{ id: "d1", files: [f(ok), f(ok), f("C".repeat(16)), { ...f("D".repeat(16)), mime: "image/svg+xml" }] }, { id: "d9", files: [f(ok)] }] }, sel, "R-7K3P9Q", "B".repeat(16), [ok, "D".repeat(16)]);
    expect(r.documents).toEqual([{ id: "d1", files: [f(ok)] }]);
    expect(r.dropped).toBe(4);
    expect(() => checkDocuments({ format: "fprise-lifeplan-hearing-web-documents", version: "0.2", requestId: "R-7K3P9Q", batchId: "X".repeat(16), sentAt: "", documents: [] }, sel, "R-7K3P9Q", "B".repeat(16), [])).toThrow("E_WEB_DOCUMENTS_REQUEST");
    expect(() => checkDocuments({ format: "fprise-lifeplan-hearing-web-documents", version: "0.1", requestId: "R-7K3P9Q", batchId: "B".repeat(16), sentAt: "", documents: [] }, sel, "R-7K3P9Q", "B".repeat(16), [])).toThrow("E_WEB_DOCUMENTS_SHAPE");
  });
});

describe("期限: 30日の決め打ちと延長（押した日から30日・作った日から90日まで）", () => {
  it("作った日から30日。延長は押した日から30日に延び、作った日から90日を超えない。上限では断る", async () => {
    const now = { t: new Date("2026-11-05T09:00:00Z") };
    const { transport } = relayFor(now);
    const { issued } = await issueSimple(transport);
    const rec = issued.record;
    expect(rec.expiresAt).toBe("2026-12-05T09:00:00Z");
    expect(rec.limitAt).toBe("2027-02-03T09:00:00Z");
    // 作った日に押しても延びない（もう30日先まである）
    expect(extendTarget(rec, now.t)).toBeNull();
    expect((await extendRequest(rec, transport)).expiresAt).toBe("2026-12-05T09:00:00Z");
    // 25日目に押す → その日から30日
    now.t = new Date(now.t.getTime() + 25 * DAY);
    expect(extendTarget(rec, now.t)).toEqual({ to: "2026-12-30T09:00:00Z", capped: false });
    const e1 = await extendRequest(rec, transport);
    expect(e1.expiresAt).toBe("2026-12-30T09:00:00Z");
    // お客さまの画面の期限も延びる
    const o = await openRequest(new URL(rec.url).hash, transport);
    expect(o.packet.expiresAt).toBe("2026-12-30T09:00:00Z");
    // 50日目に押す → その日から30日。70日目に押す → 90日で止まる
    now.t = new Date(new Date("2026-11-05T09:00:00Z").getTime() + 50 * DAY);
    expect((await extendRequest(rec, transport)).expiresAt).toBe("2027-01-24T09:00:00Z");
    now.t = new Date(new Date("2026-11-05T09:00:00Z").getTime() + 70 * DAY);
    expect(extendTarget({ ...rec, expiresAt: "2027-01-24T09:00:00Z" }, now.t)).toEqual({ to: "2027-02-03T09:00:00Z", capped: true });
    const e2 = await extendRequest({ ...rec, ...e1 }, transport);
    expect(e2.expiresAt).toBe("2027-02-03T09:00:00Z");
    expect(extendTarget({ ...rec, ...e2 }, now.t)).toBeNull();
    await expect(extendRequest(rec, transport)).rejects.toThrow("E_RELAY_EXTEND_LIMIT");
    // 90日を過ぎると断り、消す
    now.t = new Date("2027-02-03T09:00:01Z");
    await expect(openRequest(new URL(rec.url).hash, transport)).rejects.toThrow("E_RELAY_EXPIRED");
    await expect(extendRequest(rec, transport)).rejects.toThrow("E_RELAY_GONE");
  });

  it("延長は受け取りの合言葉だけ（お客さまの送るときの合言葉・ほかの依頼の合言葉では延ばせない）", async () => {
    const { transport } = relayFor();
    const { issued } = await issueSimple(transport);
    const other = await issueSimple(transport);
    const o = await openRequest(new URL(issued.record.url).hash, transport);
    await expect(extendRequest({ ...issued.record, secrets: { ...issued.record.secrets, pickupToken: o.keys.submitToken } }, transport)).rejects.toThrow("E_RELAY_DENIED");
    await expect(extendRequest({ ...issued.record, secrets: { ...issued.record.secrets, pickupToken: other.issued.record.secrets.pickupToken } }, transport)).rejects.toThrow("E_RELAY_DENIED");
    await expect(relay.removeAnswers(transport, issued.record.serverId, o.keys.submitToken)).rejects.toThrow("E_RELAY_DENIED");
  });

  it("毎日の掃除: 期限を過ぎた依頼を中身ごと消し、期限の中のもの（延長したものを含む）は残す", async () => {
    const now = { t: new Date("2026-11-05T09:00:00Z") };
    const { transport, store } = relayFor(now);
    const a = await issueSimple(transport);
    const b = await issueSimple(transport);
    const o = await openRequest(new URL(a.issued.record.url).hash, transport);
    const f = await put(o, transport, jpeg(50));
    await sendDocuments(o, [{ id: "d1", files: [f] }], transport);
    now.t = new Date("2026-11-30T09:00:00Z");
    await extendRequest(b.issued.record, transport);
    now.t = new Date("2026-12-06T09:00:00Z");
    expect(await sweepExpired({ store, now: () => now.t })).toBe(1);
    expect([...store.dump().keys()].some((k) => k.includes(a.issued.record.serverId))).toBe(false);
    expect([...store.dump().keys()].filter((k) => k.includes(b.issued.record.serverId))).toHaveLength(2);
  });
});

describe("断ること", () => {
  it("期限を過ぎた依頼は断り、そのとき消す", async () => {
    const now = { t: new Date("2026-11-05T09:00:00Z") };
    const { transport, store } = relayFor(now);
    const { issued } = await issueSimple(transport);
    now.t = new Date("2026-12-06T09:00:00Z");
    await expect(openRequest(new URL(issued.record.url).hash, transport)).rejects.toThrow("E_RELAY_EXPIRED");
    expect(store.size()).toBe(0);
  });

  it("合言葉の違う受け取り・消すことを断る。送るときの合言葉で受け取れない", async () => {
    const { transport } = relayFor();
    const { issued } = await issueSimple(transport);
    const wrong = b64u(new Uint8Array(32).fill(7));
    await expect(relay.status(transport, issued.record.serverId, wrong)).rejects.toThrow("E_RELAY_DENIED");
    await expect(relay.remove(transport, issued.record.serverId, wrong)).rejects.toThrow("E_RELAY_DENIED");
    const o = await openRequest(new URL(issued.record.url).hash, transport);
    await expect(relay.status(transport, issued.record.serverId, o.keys.submitToken)).rejects.toThrow("E_RELAY_DENIED");
    await expect(relay.submit(transport, issued.record.serverId, "1.abc", issued.record.secrets.pickupToken)).rejects.toThrow("E_RELAY_DENIED");
  });

  it("改ざんした答えの暗号文・別の書類の暗号文への付け替え・別の送り状への付け替えを開かない", async () => {
    const { transport, store } = relayFor();
    const { def, issued } = await issueSimple(transport);
    const o = await openRequest(new URL(issued.record.url).hash, transport);
    const a = await put(o, transport, jpeg(100));
    const b = await put(o, transport, jpeg(200), "写真2");
    await sendDocuments(o, [{ id: "d1", files: [a, b] }], transport);
    await submitAnswers(o, answersOf(o.packet, initialDraft(o.packet), new Date()), transport);
    const m = store.dump() as Map<string, string>;
    const id = issued.record.serverId;
    // 書類 a の置き場に書類 b の暗号文を入れる（サーバーが付け替えた）→ 開かない
    m.set(`r/${id}/f/${a.fileId}`, m.get(`r/${id}/f/${b.fileId}`) as string);
    const got = await receive(issued.record, def, transport);
    expect(got!.batches[0]!.files.map((f) => f.fileId)).toEqual([b.fileId]);
    expect(got!.batches[0]!.missingFiles).toBe(1);
    // 送り状を別の送りの番号の所に移す → 開かない（受け取らずに数える）
    const c = await put(o, transport, jpeg(300), "写真3");
    await sendDocuments(o, [{ id: "d1", files: [c] }], transport);
    const keys = [...m.keys()].filter((k) => k.includes("/b/"));
    const [k1, k2] = keys as [string, string];
    const v1 = JSON.parse(m.get(k1) as string) as { data: string };
    const v2 = JSON.parse(m.get(k2) as string) as { data: string; files: string[]; at: string };
    m.set(k2, JSON.stringify({ ...v2, data: v1.data }));
    const got2 = await receive(issued.record, def, transport, { answers: false });
    expect(got2!.badBatches).toBe(1);
    // 答えの暗号文の1字を変える → 開かない
    const env = m.get(`r/${id}/a`) as string;
    const last = env.at(-2) === "A" ? "B" : "A";
    m.set(`r/${id}/a`, `${env.slice(0, -2)}${last}${env.slice(-1)}`);
    await expect(receive(issued.record, def, transport)).rejects.toThrow("E_WEB_DECRYPT");
  });

  it("問いの暗号文を別の公開鍵のフラグメントで開かない（公開鍵の差し替え）", async () => {
    const { transport } = relayFor();
    const { issued } = await issueSimple(transport);
    const other = await issueSimple(transport);
    const [, secret] = new URL(issued.record.url).hash.slice(1).split(".");
    const [, , pub] = new URL(other.issued.record.url).hash.slice(1).split(".");
    await expect(openRequest(`#1.${secret}.${pub}`, transport)).rejects.toThrow("E_WEB_DECRYPT");
    await expect(openRequest("#1.short.key", transport)).rejects.toThrow("E_WEB_LINK");
  });

  it("サーバーは大きすぎる・形の違う依頼を断る（期限はサーバーが決める）", async () => {
    const { transport } = relayFor();
    const id = b64u(new Uint8Array(16).fill(1));
    const hash = "a".repeat(64);
    const base = { id, submitHash: hash, pickupHash: "b".repeat(64), questions: "1.aaaa.bbbb" };
    await expect(relay.create(transport, { ...base, questions: `1.${"a".repeat(500 * 1024)}` })).rejects.toThrow("E_RELAY_TOO_LARGE");
    await expect(relay.create(transport, { ...base, submitHash: base.pickupHash })).rejects.toThrow("E_RELAY_BAD");
    await expect(relay.create(transport, { ...base, questions: "<script>" })).rejects.toThrow("E_RELAY_BAD");
    expect(await relay.create(transport, base)).toEqual({ expiresAt: "2026-12-05T09:00:00Z", limitAt: "2027-02-03T09:00:00Z" });
    await expect(relay.create(transport, base)).rejects.toThrow("E_RELAY_SUBMITTED");
  });

  it("別の所（Origin）からの呼び出しを断り、答えには守りの見出しを付けない値を入れない", async () => {
    const store = memoryStore();
    const res = await handleApi(new Request(`https://relay.test${API_PREFIX}/requests`, { method: "POST", headers: { origin: "https://evil.example" }, body: "{}" }), { store, now: () => new Date() });
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(PAGE_HEADERS["content-security-policy"]).toContain("script-src 'self'");
    expect(PAGE_HEADERS["content-security-policy"]).not.toContain("unsafe");
  });
});

describe("届いた答えを信用しない", () => {
  it("選んでいない項目・繰り返しの範囲の外・選べない状態・重なりを捨てる", () => {
    const def = simple();
    const sel = selectionFromSheet(def);
    const sel2: WebSelection = { ...sel, sections: sel.sections.map((s) => ({ ...s, items: s.items.filter((i) => !i.key.startsWith("hs.family.parent")) })) };
    const r = checkAnswers(
      {
        format: "fprise-lifeplan-hearing-web-answers",
        version: "0.2",
        requestId: "R-7K3P9Q",
        submittedAt: "2026-11-06T01:00:00.000Z",
        // 分岐の答え: 知らない問い・選んでいない項目の問い（ご両親）・範囲の外（お子さま9人）・形の違う値は捨てる
        gates: { spouse: 0, child: 9, parent: 1, pets: 2, loan: "1" },
        answers: [
          { key: "hs.family.adult.sex", index: 1, status: "value", raw: { kind: "text", text: "female" } },
          { key: "hs.family.adult.sex", index: 1, status: "value", raw: { kind: "text", text: "male" } },
          { key: "hs.family.adult.sex", index: 3, status: "value", raw: { kind: "text", text: "male" } },
          { key: "hs.family.parent.age", index: 1, status: "value", raw: { kind: "number", text: "70" } },
          { key: "hs.housing.type", status: "unknown" },
          { key: "hs.secret.injected", status: "value", raw: { kind: "text", text: "x" } },
          { key: "hs.consult.topics", status: "value", raw: { kind: "text", text: "a".repeat(5000) } },
        ],
        documents: [],
      },
      def,
      sel2,
      "R-7K3P9Q",
    );
    expect(r.answers).toHaveLength(1);
    expect(r.gates).toEqual({ spouse: 0 });
    expect(r.dropped).toBe(6 + 4);
    expect(() => checkAnswers({ format: "x" }, def, sel, "R-7K3P9Q")).toThrow("E_WEB_ANSWERS_SHAPE");
    expect(() => checkAnswers({ format: "fprise-lifeplan-hearing-web-answers", version: "0.2", requestId: "R-AAAAAA", submittedAt: "", answers: [], gates: {}, documents: [] }, def, sel, "R-7K3P9Q")).toThrow("E_WEB_ANSWERS_REQUEST");
    // 前の形（0.1。分岐の答えが無い）は受けない
    expect(() => checkAnswers({ format: "fprise-lifeplan-hearing-web-answers", version: "0.1", requestId: "R-7K3P9Q", submittedAt: "", answers: [], documents: [] }, def, sel, "R-7K3P9Q")).toThrow("E_WEB_ANSWERS_SHAPE");
  });

  it("書類の形は見出しのバイトで決める（SVG・HTML は受け付けない）", () => {
    expect(sniffMime(jpeg(1))).toBe("image/jpeg");
    expect(sniffMime(utf8("%PDF-1.7"))).toBe("application/pdf");
    expect(sniffMime(utf8("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffMime(utf8("<html>"))).toBeNull();
    expect(sniffMime(new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]))).toBe("image/heic");
  });
});

describe("問いを飛ばす決まり", () => {
  async function packetOf(def = simple()): Promise<QuestionsPacket> {
    const { transport } = relayFor();
    const sel = selectionFromSheet(def);
    const { issued } = await issueSimple(transport, sel, def);
    const o = await openRequest(new URL(issued.record.url).hash, transport);
    return o.packet;
  }

  it("分岐の答え（お子さま0人・ご両親のことは答えない など）を答えに入れて届ける。出なかった分岐の問いの答えは送らない", async () => {
    const p = await packetOf();
    const d = withAnswers(initialDraft(p), { [draftKey("hs.housing.type")]: v("rent") }, { spouse: 0, child: 0, parent: 0, loan: 2 });
    const a = answersOf(p, d, new Date("2026-11-06T00:00:00Z"));
    // 賃貸なので住宅ローンの本数は聞いていない（下書きに残っていても送らない）
    expect(a.gates).toEqual({ spouse: 0, child: 0, parent: 0 });
    expect(a.version).toBe("0.2");
  });

  it("配偶者の方がいなければ配偶者の方の問いと、配偶者の方のご両親の問いを出さず、生年月を「該当なし」で送る", async () => {
    const p = await packetOf();
    const d = withAnswers(initialDraft(p), {}, { spouse: 0, child: 0 });
    const keys = itemScreens(screens(p, d));
    expect(keys.some((k) => k.endsWith("#2") && k.startsWith("hs.family.adult"))).toBe(false);
    expect(keys.some((k) => k.startsWith("hs.family.parent") && (k.endsWith("#3") || k.endsWith("#4")))).toBe(false);
    expect(keys).toContain("hs.family.parent.alive#1");
    const a = answersOf(p, d, new Date());
    expect(a.answers.find((x) => x.key === "hs.family.adult.birthYearMonth" && x.index === 2)?.status).toBe("notApplicable");
    // 分岐の問いは配偶者の方の問いの前に1回だけ（ご家族の区画では、お子さまの人数と同じ画面）
    const list = screens(p, d);
    expect(list.filter((s) => s.kind === "gate" && s.gates.includes("spouse"))).toHaveLength(1);
    expect(list.find((s) => s.kind === "gate")).toMatchObject({ gates: ["spouse", "child"] });
  });

  it("お子さまの生年月は全員を1画面に。人ごとに生年月（年齢）と性別・働き方と年収を1画面に。金額と範囲は同じ問い", async () => {
    const p = await packetOf();
    const d = withAnswers(initialDraft(p), {}, { spouse: 1, child: 2 });
    const list = screens(p, d);
    const keys = itemScreens(list);
    expect(keys.filter((k) => k.startsWith("hs.family.child.birthYearMonth"))).toEqual(["hs.family.child.birthYearMonth#1", "hs.family.child.birthYearMonth#2"]);
    const kids = itemOnly(list).filter((s) => s.fields.some((f) => f.key === "hs.family.child.birthYearMonth"));
    expect(kids).toHaveLength(1);
    const birth = itemOnly(list).find((s) => s.key === "hs.family.adult.birthYearMonth" && s.index === 1);
    expect(birth?.fields).toEqual([
      { key: "hs.family.adult.birthYearMonth", index: 1, alt: ["hs.family.adult.age"] },
      { key: "hs.family.adult.sex", index: 1, alt: [] },
    ]);
    expect(keys).not.toContain("hs.income.annualRange#1");
    const work = itemOnly(list).find((s) => s.key === "hs.work.type" && s.index === 1);
    expect(work?.fields).toEqual([
      { key: "hs.work.type", index: 1, alt: [] },
      { key: "hs.income.annual", index: 1, alt: ["hs.income.annualRange"] },
    ]);
    // お住まい（住まいの形・家賃かローン）・お金（預貯金と投資）・毎月のお金（生活費と保険料）は1画面
    expect(itemOnly(list).find((s) => s.key === "hs.housing.type")?.fields.map((f) => f.key)).toEqual(["hs.housing.type", "hs.housing.rent", "hs.loan.monthlyTotal", "hs.loan.balanceTotal"]);
    expect(itemOnly(list).find((s) => s.key === "hs.assets.depositTotal")?.fields.map((f) => f.key)).toEqual(["hs.assets.depositTotal", "hs.assets.investTotal"]);
    expect(itemOnly(list).find((s) => s.key === "hs.expense.living")?.fields.map((f) => f.key)).toEqual(["hs.expense.living", "hs.insurance.premiumTotal"]);
  });

  it("シンプルの票: 夫婦と子2人・持ち家・ご両親は聞かないで、問いの画面は13（同意・ご相談・ご家族の分岐・ご本人・配偶者の方・お子さま・働き方2・お住まい・家を買った年月と値段・お金・毎月のお金・これからの予定）", async () => {
    const p = await packetOf();
    const d = withAnswers(initialDraft(p), { [draftKey("hs.housing.type")]: v("own") }, { spouse: 1, child: 2, parent: 0 });
    const list = screens(p, d);
    const questions = list.filter((s) => s.kind === "consent" || s.kind === "gate" || s.kind === "item");
    // ご両親を聞かないと答えると、ご両親の画面は出ない（分岐の問いの1画面だけ）
    expect(questions.map((s) => screenId(s))).toEqual([
      "consent",
      "item:hs.consult.topics#0",
      "gate:spouse+child",
      "item:hs.family.adult.birthYearMonth#1",
      "item:hs.family.adult.birthYearMonth#2",
      "item:hs.family.child.birthYearMonth#1",
      "item:hs.work.type#1",
      "item:hs.work.type#2",
      "item:hs.housing.type#0",
      "item:hs.housing.purchaseMonth#0",
      "item:hs.assets.depositTotal#0",
      "item:hs.expense.living#0",
      "gate:parent",
      "item:hs.plan.events#0",
    ]);
    expect(questions.filter((s) => s.kind !== "gate" || !s.gates.includes("parent"))).toHaveLength(13);
    expect(answersOf(p, withAnswers(d, { [draftKey("hs.family.parent.alive", 1)]: v("alive") }), new Date()).answers.some((a) => a.key.startsWith("hs.family.parent"))).toBe(false);
    // 最初の画面の目安（ご両親も聞く前提で数える。1画面15秒）
    const e = estimate(p);
    expect(e.screens).toBe(18);
    expect(e.minutes).toBe(5);
  });

  it("ご両親は1人1画面（ご健在か・お年・同居）。最初に「うかがってよいですか」", async () => {
    const p = await packetOf();
    const d = withAnswers(initialDraft(p), {}, { spouse: 1, child: 0, parent: 1 });
    const list = screens(p, d);
    const at = list.findIndex((s) => s.kind === "gate" && s.gates.includes("parent"));
    expect(at).toBeGreaterThan(0);
    const parents = itemOnly(list).filter((s) => s.key === "hs.family.parent.alive");
    expect(parents.map((s) => s.index)).toEqual([1, 2, 3, 4]);
    expect(parents[0]?.fields.map((f) => f.key)).toEqual(["hs.family.parent.alive", "hs.family.parent.age", "hs.family.parent.cohabiting"]);
    // 亡くなっていれば、お年・同居は出さない
    const d2 = withAnswers(d, { [draftKey("hs.family.parent.alive", 1)]: v("deceased") });
    expect(itemOnly(screens(p, d2)).find((s) => s.key === "hs.family.parent.alive" && s.index === 1)?.fields.map((f) => f.key)).toEqual(["hs.family.parent.alive"]);
    // 問いの言葉はお客さまに向けた言い方
    expect(p.items.find((i) => i.key === "hs.family.parent.alive")?.label).toBe("ご健在ですか");
    expect(p.items.find((i) => i.key === "hs.family.parent.age")?.label).toBe("お年はおいくつですか");
  });

  it("「ご相談したいこと」は同意の直後", async () => {
    const p = await packetOf();
    const list = screens(p, initialDraft(p));
    expect(list.slice(0, 3).map((s) => screenId(s))).toEqual(["intro", "consent", "item:hs.consult.topics#0"]);
    expect(list.filter((s) => s.kind === "item" && s.key === "hs.consult.topics")).toHaveLength(1);
  });

  it("働き方・住まい・ご健在かで問いを飛ばす。見えない問いの答えは送らない", async () => {
    const p = await packetOf();
    let d = withAnswers(initialDraft(p), { [draftKey("hs.housing.type")]: v("rent"), [draftKey("hs.housing.rent")]: v("90000", "number"), [draftKey("hs.work.type", 1)]: v("unemployed"), [draftKey("hs.income.annual", 1)]: v("500", "number"), [draftKey("hs.family.parent.alive", 1)]: v("deceased") }, { spouse: 0 });
    let keys = itemScreens(screens(p, d));
    expect(keys).not.toContain("hs.loan.monthlyTotal#0");
    expect(keys).toContain("hs.housing.rent#0");
    expect(keys).not.toContain("hs.income.annual#1");
    expect(keys).not.toContain("hs.family.parent.age#1");
    expect(answersOf(p, d, new Date()).answers.some((a) => a.key === "hs.income.annual")).toBe(false);
    // 持ち家に変えると、家賃の問いが消え、ローンの問いが出る（家賃の答えは送らない）
    d = withAnswers(d, { [draftKey("hs.housing.type")]: v("own") });
    keys = itemScreens(screens(p, d));
    expect(keys).toContain("hs.loan.monthlyTotal#0");
    expect(keys).not.toContain("hs.housing.rent#0");
    expect(answersOf(p, d, new Date()).answers.some((a) => a.key === "hs.housing.rent")).toBe(false);
  });

  it("詳細の票: 自営業なら事業の所得と確定申告の仕方を聞き給与を聞かない。会社役員だけ会社とのお金を聞く。ローン・保険は本数で繰り返す", async () => {
    const p = await packetOf(full5());
    const d = withAnswers(initialDraft(p), { [draftKey("hs.work.type", 1)]: v("selfEmployed"), [draftKey("hs.work.type", 2)]: v("executive"), [draftKey("hs.housing.type")]: v("own") }, { spouse: 1, child: 0, loan: 1, policy: 2 });
    const keys = itemScreens(screens(p, d));
    expect(keys).toContain("hs.income.business#1");
    expect(keys).toContain("hs.income.taxReturn#1");
    expect(keys).not.toContain("hs.income.taxReturn#2");
    // 確定申告の仕方は事業の所得と同じ画面（働き方・年収の画面のまとめ。0138）。自営業の方にだけ出るので「当てはまらない」は出さない
    const biz = screens(p, d).find((s): s is Extract<Screen, { kind: "item" }> => s.kind === "item" && s.key === "hs.income.business" && s.index === 1);
    expect(biz?.fields.map((f) => f.key)).toEqual(["hs.income.business", "hs.income.taxReturn"]);
    expect(p.items.find((i) => i.key === "hs.income.taxReturn")?.naLabel).toBeNull();
    expect(keys).not.toContain("hs.income.salary#1");
    expect(keys).toContain("hs.company.shares#2");
    expect(keys).not.toContain("hs.company.shares#1");
    expect(keys.filter((k) => k.startsWith("hs.loan.principal"))).toEqual(["hs.loan.principal#1"]);
    expect(keys.filter((k) => k.startsWith("hs.insurance.type"))).toEqual(["hs.insurance.type#1", "hs.insurance.type#2"]);
    expect(keys.some((k) => k.startsWith("hs.education"))).toBe(false);
  });

  it("詳細の票（版4）のご両親: 1人に2画面（暮らしと介護・お金）、亡くなった方・答えない方には聞かない。相続の時期と額は「ある」のときだけ", async () => {
    const p = await packetOf(full5());
    const base = withAnswers(initialDraft(p), {}, { spouse: 1, child: 0, loan: 0, policy: 0, parent: 1 });
    const parentScreens = (d: Draft) => screens(p, d).filter((s): s is Extract<Screen, { kind: "item" }> => s.kind === "item" && s.section === "parents");
    const shape = (d: Draft) => parentScreens(d).map((s) => s.fields.map((f) => draftKey(f.key, f.index)).join(","));
    // 答える前: ご両親4人 × 2画面と、相続の1画面
    expect(shape(base)).toEqual([
      ...[1, 2, 3, 4].flatMap((n) => [
        `hs.family.parent.alive#${n},hs.family.parent.age#${n},hs.family.parent.cohabiting#${n},hs.family.parent.care#${n}`,
        `hs.family.parent.allowance#${n},hs.family.parent.support#${n},hs.family.parent.careMonthly#${n}`,
      ]),
      "hs.inherit.expected#0,hs.inherit.year#0,hs.inherit.amount#0",
    ]);
    // お父さまは亡くなった・お母さまは介護が始まっていない・相続は「ない」
    const d = withAnswers(base, {
      [draftKey("hs.family.parent.alive", 1)]: v("deceased"),
      [draftKey("hs.family.parent.alive", 2)]: v("alive"),
      [draftKey("hs.family.parent.care", 2)]: v("none"),
      [draftKey("hs.inherit.expected")]: v("no"),
    });
    const s = shape(d);
    expect(s[0]).toBe("hs.family.parent.alive#1");
    expect(s.some((x) => x.startsWith("hs.family.parent.allowance#1"))).toBe(false);
    expect(s).toContain("hs.family.parent.allowance#2,hs.family.parent.support#2");
    expect(s.at(-1)).toBe("hs.inherit.expected#0");
    // 送る答えに、見えない問いの答えを入れない
    const sent = answersOf(p, withAnswers(d, { [draftKey("hs.family.parent.allowance", 1)]: v("30000"), [draftKey("hs.inherit.amount")]: v("1000") }), new Date()).answers;
    expect(sent.some((a) => a.key === "hs.family.parent.allowance" && a.index === 1)).toBe(false);
    expect(sent.some((a) => a.key === "hs.inherit.amount")).toBe(false);
    // ご両親のことを「答えない」: ご両親の問いも相続の問いも出さない
    expect(parentScreens(withAnswers(base, {}, { parent: 0 }))).toEqual([]);
    // お客さまの画面の言葉と、当てはまらないのボタンの言葉
    const item = (k: string) => p.items.find((i) => i.key === k);
    expect(item("hs.family.parent.allowance")?.naLabel).toBe("仕送りはしていない");
    expect(item("hs.family.parent.allowance")?.guide).toContain("「仕送りはしていない」");
    expect(item("hs.inherit.expected")?.label).toBe("これから受け取る予定の相続・贈与はありますか");
  });

  it("見直し: 確かめてもらう項目は前回の値から始め、分岐の答えも前回の値から決める", async () => {
    const def = full5();
    const req = modelHousehold("dualHighTwoKids");
    const prefill = exportAnswers(def, req).answers;
    const sel = selectionFromSheet(def, () => "confirm");
    const { transport } = relayFor();
    const issued = await issueRequest({ definition: def, selection: sel, requestId: "R-7K3P9Q", customerNo: "A1", office: OFFICE, now: new Date("2026-11-05T09:00:00Z"), pageUrl: "https://relay.test/h/", prefill, transport });
    const o = await openRequest(new URL(issued.record.url).hash, transport);
    const d = initialDraft(o.packet);
    expect(d.gates.spouse).toBe(1);
    expect(d.gates.child).toBeGreaterThanOrEqual(1);
    expect(d.answers[draftKey("hs.family.adult.birthYearMonth", 1)]?.status).toBe("value");
  });
});

describe("見直し: 前回の値で問いを飛ばす（見本の世帯 会社員の夫婦と子2人・持ち家・住宅ローン・配偶者の方はパート）", () => {
  async function reviewPacket(): Promise<QuestionsPacket> {
    const def = full5();
    const prefill = exportAnswers(def, modelHousehold("salariedCoupleTwoKids")).answers;
    return buildPacket(def, selectionFromSheet(def, () => "confirm"), { requestId: "R-7K3P9Q", expiresAt: "2026-12-05T09:00:00Z", office: OFFICE, prefill });
  }

  it("前回の値は、選択肢は値・年月の月は数で載る（Excel の言葉のままにしない）", async () => {
    const p = await reviewPacket();
    const pre = (key: string, n = 0) => p.items.find((i) => i.key === key)?.prefill?.[String(n)];
    expect(pre("hs.housing.type")).toEqual({ status: "value", raw: { kind: "text", text: "own" } });
    expect(pre("hs.work.type", 2)).toEqual({ status: "value", raw: { kind: "text", text: "partTime" } });
    expect(pre("hs.family.adult.birthYearMonth", 1)).toEqual({ status: "value", raw: { kind: "text", text: "1981" }, raw2: { kind: "number", text: "7" } });
    // 変えられた答えは Excel と同じ取り込みで読める（言葉でも値でも読める）
    expect(webPrefill({ key: "x", label: "x", type: "choice", choices: [{ value: "own", label: "持ち家" }], states: [], inputItems: [], destination: "memo", addedIn: 1, retiredIn: null }, { status: "value", raw: { kind: "text", text: "持ち家" } })).toEqual({ status: "value", raw: { kind: "text", text: "own" } });
  });

  // 出るべき問い・出ないべき問いの表（前回の値だけで、お客さまが何も変えないとき）
  const SHOWN: readonly [string, boolean, string][] = [
    ["hs.housing.propertyTax#0", true, "持ち家なので固定資産税を聞く"],
    ["hs.housing.maintenance#0", true, "持ち家なので管理費を聞く"],
    ["hs.housing.rent#0", false, "持ち家なので家賃は聞かない"],
    ["hs.loan.debtor#1", true, "持ち家・ローン1本なのでローンの名義を聞く"],
    ["hs.loan.principal#1", true, "借入額"],
    ["hs.loan.start#1", true, "借りた年月"],
    ["hs.loan.termYears#1", true, "返済期間"],
    ["hs.loan.rate#1", true, "金利"],
    ["hs.loan.rateType#1", true, "金利のタイプ"],
    ["hs.loan.method#1", true, "返済の方法"],
    ["hs.loan.balance#1", true, "いまの残高"],
    ["hs.loan.creditLife#1", true, "団信"],
    ["hs.loan.principal#2", false, "ローンは1本"],
    ["hs.work.weeklyHours#2", true, "配偶者の方はパートなので勤務時間を聞く"],
    ["hs.work.weeklyHours#1", false, "ご本人は正社員なので勤務時間は聞かない"],
    ["hs.work.prefecture#1", true, "ご本人は協会けんぽなので都道府県を聞く"],
    ["hs.work.prefecture#2", false, "配偶者の方は扶養なので都道府県は聞かない"],
    ["hs.income.business#1", false, "自営業ではない"],
    ["hs.company.shares#1", false, "会社役員ではない"],
    ["hs.company.shares#2", false, "会社役員ではない"],
    ["hs.family.child.birthYearMonth#2", true, "お子さまは2人"],
    ["hs.family.child.birthYearMonth#3", false, "お子さまは2人"],
    ["hs.family.adult.birthYearMonth#2", true, "配偶者の方がいる"],
    ["hs.insurance.type#1", true, "保険は1件"],
    ["hs.insurance.type#2", false, "保険は1件"],
  ];

  it.each(SHOWN)("%s が出る: %s（%s）", async (key, shown) => {
    const p = await reviewPacket();
    const keys = itemScreens(screens(p, initialDraft(p)));
    expect(keys.includes(key)).toBe(shown);
  });

  it("出た問いの前回の値は、そのまま送る答えに入る（勤務時間・ローンの残高）", async () => {
    const p = await reviewPacket();
    const a = answersOf(p, initialDraft(p), new Date("2026-11-06T10:00:00+09:00")).answers;
    expect(a.find((x) => x.key === "hs.work.weeklyHours" && x.index === 2)).toMatchObject({ status: "value", raw: { text: "25" } });
    expect(a.find((x) => x.key === "hs.loan.balance" && x.index === 1)).toMatchObject({ status: "value", raw: { text: "2240" } });
    expect(a.find((x) => x.key === "hs.family.adult.birthYearMonth" && x.index === 1)).toMatchObject({ raw: { text: "1981" }, raw2: { text: "7" } });
  });
});

describe("お客さまの画面の言葉と入れやすさ", () => {
  async function basicPacket(): Promise<QuestionsPacket> {
    const def = simple();
    return buildPacket(def, selectionFromSheet(def), { requestId: "R-7K3P9Q", expiresAt: "2026-12-05T09:00:00Z", office: OFFICE });
  }

  it("働き方: 「働いていない」は選択肢の1つだけ（小さなボタンは出さない）。選ぶと年収を聞かない。休業中は聞く", async () => {
    const p = await basicPacket();
    const wt = p.items.find((i) => i.key === "hs.work.type")!;
    expect(wt.naLabel).toBeNull();
    expect(wt.guide ?? "").not.toContain("該当なし");
    const at = (type: string) => itemScreens(screens(p, withAnswers(initialDraft(p), { [draftKey("hs.work.type", 1)]: v(type) }, { spouse: 0 })));
    expect(at("unemployed")).not.toContain("hs.income.annual#1");
    expect(at("leave")).toContain("hs.income.annual#1");
    expect(at("regular")).toContain("hs.income.annual#1");
  });

  it("確かめの画面の金額: 全角・桁区切りでも単位つき（年 850万円・月 98,000円）", async () => {
    const p = await basicPacket();
    const item = (k: string) => p.items.find((i) => i.key === k)!;
    expect(answerText(item("hs.income.annual"), v("８５０", "number"))).toBe("年 850万円");
    expect(answerText(item("hs.housing.rent"), v("98,000", "number"))).toBe("月 98,000円");
    expect(answerText(item("hs.housing.rent"), v("９８，０００円", "number"))).toBe("月 98,000円");
    expect(answerText(item("hs.family.adult.age"), v("４２", "number"))).toBe("42歳");
    expect(answerText(item("hs.housing.rentRange"), v("9〜11万円"))).toBe("月 9〜11万円");
  });

  it("進み具合: 段の数は答えで変わらない（配偶者の方・お子さまの人数・持ち家で増えない）", async () => {
    const p = await basicPacket();
    const at = (d: Draft) => {
      const list = screens(p, d);
      return progress(p, list, list.findIndex((s) => s.kind === "item" && s.key === "hs.work.type"));
    };
    const a = at(withAnswers(initialDraft(p), {}, { spouse: 0, child: 0 }));
    const b = at(withAnswers(initialDraft(p), { [draftKey("hs.housing.type")]: v("own") }, { spouse: 1, child: 3 }));
    expect(a.stages).toEqual(b.stages);
    expect(a.stages.map((x) => x.title)).toEqual(["はじめに", "ご家族", "お仕事と収入", "お住まい", "貯蓄・投資", "毎月のお金", "ご両親", "これからのこと", "確かめ"]);
    expect(a.current).toBe(2);
    expect(b.current).toBe(2);
  });

  it("分岐の問いの言葉: いない／1人／2人／3人／4人以上", async () => {
    const p = await basicPacket();
    expect(gateText(p, "child").options.map((o) => o.label)).toEqual(["いない", "1人", "2人", "3人", "4人以上"]);
    expect(gateText(p, "child").lead).toContain("5人以上");
  });

  it("生年の選択: 大人は15年前から・お子さまは3年後から（新しい年から並べる）", async () => {
    const p = await basicPacket();
    const now = new Date("2026-11-06T10:00:00+09:00");
    const adult = yearChoices(p.items.find((i) => i.key === "hs.family.adult.birthYearMonth")!, p.years, now);
    const child = yearChoices(p.items.find((i) => i.key === "hs.family.child.birthYearMonth")!, p.years, now);
    expect(adult[0]).toBe(2011);
    expect(adult.indexOf(1981)).toBe(30);
    expect(child[0]).toBe(2029);
    expect(adult.at(-1)).toBe(p.years.from);
  });

  it("生年月の月が「わからない」: 年だけの生年月は送らず（取り込めない）、年齢で答える", async () => {
    const p = await basicPacket();
    const d = withAnswers(initialDraft(p), { [draftKey("hs.family.adult.birthYearMonth", 1)]: { status: "value", raw: { kind: "text", text: "1981" }, raw2: { kind: "text", text: "unknown" } }, [draftKey("hs.family.adult.age", 1)]: v("45", "number") }, { spouse: 0 });
    const a = answersOf(p, d, new Date()).answers;
    expect(a.some((x) => x.key === "hs.family.adult.birthYearMonth" && x.index === 1)).toBe(false);
    expect(a.find((x) => x.key === "hs.family.adult.age" && x.index === 1)).toMatchObject({ status: "value" });
    expect(answerText(p.items.find((i) => i.key === "hs.family.adult.birthYearMonth")!, d.answers[draftKey("hs.family.adult.birthYearMonth", 1)])).toBe("1981年（昭和56年）（月はわからない）");
  });

  it("当てはまらない: 飛ばした後にしか出ない問い（年収・家賃・預貯金）には出さない。ローン・投資・保険は言葉を変える", async () => {
    const p = await basicPacket();
    const na = (k: string) => p.items.find((i) => i.key === k)?.naLabel;
    expect(na("hs.income.annual")).toBeNull();
    expect(na("hs.housing.rent")).toBeNull();
    expect(na("hs.assets.depositTotal")).toBeNull();
    expect(na("hs.loan.monthlyTotal")).toBe("住宅ローンはない");
    expect(na("hs.assets.investTotal")).toBe("持っていない");
    expect(na("hs.insurance.premiumTotal")).toBe("保険に入っていない");
    // ボタンを出さない項目は、手引きの「該当なし」の文も外す
    expect(p.items.find((i) => i.key === "hs.housing.rent")?.guide ?? "").not.toContain("該当なし");
    // 住宅ローンはない → 残高は聞かない
    const d = withAnswers(initialDraft(p), { [draftKey("hs.housing.type")]: v("own"), [draftKey("hs.loan.monthlyTotal")]: { status: "notApplicable" } });
    expect(itemScreens(screens(p, d))).not.toContain("hs.loan.balanceTotal#0");
  });

  it("同意の文: 担当の FP が AI でお答えを整理すること（お名前は渡さない）。Excel のシートも同じ文", async () => {
    const p = await basicPacket();
    const label = p.consent.items.find((i) => i.key === "hs.consent.externalAi")?.label ?? "";
    expect(label).toContain("担当の FP が、AI を使ってお答えを整理することがあります（お名前は渡しません）");
    expect(label).not.toContain("外部のAIサービス");
    for (const def of [simple(), full2(), full3(), full5()]) expect(def.items.find((i) => i.key === "hs.consent.externalAi")?.label).toBe(label);
  });
});

describe("フラグメントの形", () => {
  it("鍵の元は32バイト、公開鍵は圧縮しない65バイト", async () => {
    const { transport } = relayFor();
    const { issued } = await issueSimple(transport);
    const [ver, secret, pub] = new URL(issued.record.url).hash.slice(1).split(".");
    expect(ver).toBe("1");
    expect(fromB64u(secret as string)).toHaveLength(32);
    expect(fromB64u(pub as string)).toHaveLength(65);
  });
});
