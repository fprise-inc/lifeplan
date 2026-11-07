// Web のヒアリング（0125）: 暗号化して開くまでの一周、期限切れ・消したもの・改ざんした暗号文を断ること、問いを飛ばす決まり、取り込みの候補
import { describe, expect, it } from "vitest";
import { handleApi, PAGE_HEADERS } from "../relay/handler.ts";
import { memoryStore } from "../relay/store.ts";
import { importAnswers } from "../src/index.ts";
import { exportAnswers } from "../src/export.ts";
import { answersOf, b64u, checkAnswers, DOCUMENT_TEMPLATES, draftKey, filledOf, fromB64u, importDefinition, initialDraft, issueRequest, openRequest, receive, relay, removeFile, screens, selectionFromSheet, sniffMime, submitAnswers, uploadFile, utf8, type Draft, type DraftAnswer, type QuestionsPacket, type RelayTransport, type Screen, type WebSelection } from "../src/web/index.ts";
import { API_PREFIX } from "../src/web/protocol.ts";
import { full4, idSeq, modelHousehold, simple } from "./helpers.ts";

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
const itemScreens = (list: Screen[]) => list.filter((s): s is Extract<Screen, { kind: "item" }> => s.kind === "item").map((s) => draftKey(s.key, s.index));
const jpeg = (n: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: n }, (_, i) => i % 251)]) as Uint8Array<ArrayBuffer>;

async function issueSimple(t: RelayTransport, sel?: WebSelection, def = simple()) {
  const selection = sel ?? { ...selectionFromSheet(def), custom: [{ key: "ext.office.qabcd", label: "ご相談のきっかけは何ですか" }], documents: [{ id: "d1", kind: "withholding", title: "源泉徴収票（ご本人）", purpose: DOCUMENT_TEMPLATES[0]!.purpose, where: DOCUMENT_TEMPLATES[0]!.where }] };
  const withCustom: WebSelection = sel ?? { ...selection, sections: [...selection.sections, { id: "fp", items: [{ key: "ext.office.qabcd", mode: "ask" }] }] };
  const issued = await issueRequest({ definition: def, selection: withCustom, requestId: "R-7K3P9Q", customerNo: "A0042", office: OFFICE, days: 30, now: new Date("2026-11-05T09:00:00Z"), pageUrl: "https://relay.test/h/", transport: t });
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
    const up = await uploadFile(opened, photo, transport);
    d = { ...d, documents: { d1: { status: "attached", files: [{ fileId: up.fileId, mime: "image/jpeg", bytes: photo.length, sha256: up.sha256, label: "写真1" }] } } };
    const packet = answersOf(opened.packet, d, new Date("2026-11-06T10:00:00+09:00"));
    await submitAnswers(opened, packet, transport);
    expect((await openRequest(new URL(url).hash, transport)).submitted).toBe(true);
    // 答えの暗号文にも、言葉は平文で載らない
    expect([...store.dump().values()].join("\n")).not.toContain("友人の紹介");

    const got = await receive(issued.record, def, transport);
    expect(got).not.toBeNull();
    expect(got!.files).toHaveLength(1);
    expect(got!.files[0]!.bytes).toEqual(photo);
    expect(got!.missingFiles).toBe(0);
    expect(got!.checked.dropped).toBe(0);
    expect(got!.checked.documents[0]).toMatchObject({ id: "d1", status: "attached" });
    const filled = filledOf(issued.record, got!.checked, "0.1.0");
    expect(filled.management).toMatchObject({ sheetId: "basic", sheetVersion: 2, requestId: "R-7K3P9Q", layoutDigest: issued.record.digest });
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

    // 受け取ったら消す
    await relay.remove(transport, issued.record.serverId, issued.record.secrets.pickupToken);
    expect(store.size()).toBe(0);
    await expect(openRequest(new URL(url).hash, transport)).rejects.toThrow("E_RELAY_GONE");
  });

  it("書類は外せる（送る前だけ）。送った後は書類を足せず、答えも2回は送れない", async () => {
    const { transport } = relayFor();
    const { issued } = await issueSimple(transport);
    const o = await openRequest(new URL(issued.record.url).hash, transport);
    const a = await uploadFile(o, jpeg(10), transport);
    await removeFile(o, a.fileId, transport);
    const st = await relay.status(transport, issued.record.serverId, issued.record.secrets.pickupToken);
    expect(st.files).toHaveLength(0);
    await submitAnswers(o, answersOf(o.packet, initialDraft(o.packet), new Date()), transport);
    await expect(submitAnswers(o, answersOf(o.packet, initialDraft(o.packet), new Date()), transport)).rejects.toThrow("E_RELAY_SUBMITTED");
    await expect(uploadFile(o, jpeg(10), transport)).rejects.toThrow("E_RELAY_SUBMITTED");
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

  it("改ざんした答えの暗号文・別の書類の暗号文への付け替えを開かない", async () => {
    const { transport, store } = relayFor();
    const { def, issued } = await issueSimple(transport);
    const o = await openRequest(new URL(issued.record.url).hash, transport);
    const a = await uploadFile(o, jpeg(100), transport);
    const b = await uploadFile(o, jpeg(200), transport);
    let d = initialDraft(o.packet);
    d = { ...d, documents: { d1: { status: "attached", files: [{ fileId: a.fileId, mime: "image/jpeg", bytes: 104, sha256: a.sha256, label: "写真1" }, { fileId: b.fileId, mime: "image/jpeg", bytes: 204, sha256: b.sha256, label: "写真2" }] } } };
    await submitAnswers(o, answersOf(o.packet, d, new Date()), transport);
    const m = store.dump() as Map<string, string>;
    const id = issued.record.serverId;
    // 書類 a の置き場に書類 b の暗号文を入れる（サーバーが付け替えた）→ 開かない
    m.set(`r/${id}/f/${a.fileId}`, m.get(`r/${id}/f/${b.fileId}`) as string);
    const got = await receive(issued.record, def, transport);
    expect(got!.files.map((f) => f.fileId)).toEqual([b.fileId]);
    expect(got!.missingFiles).toBe(1);
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

  it("サーバーは大きすぎる・形の違う・期限の長すぎる依頼を断る", async () => {
    const { transport } = relayFor();
    const id = b64u(new Uint8Array(16).fill(1));
    const hash = "a".repeat(64);
    const base = { id, submitHash: hash, pickupHash: "b".repeat(64), questions: "1.aaaa.bbbb" };
    await expect(relay.create(transport, { ...base, expiresAt: "2027-03-01T00:00:00Z" })).rejects.toThrow("E_RELAY_BAD");
    await expect(relay.create(transport, { ...base, questions: `1.${"a".repeat(500 * 1024)}`, expiresAt: "2026-11-20T00:00:00Z" })).rejects.toThrow("E_RELAY_TOO_LARGE");
    await expect(relay.create(transport, { ...base, submitHash: base.pickupHash, expiresAt: "2026-11-20T00:00:00Z" })).rejects.toThrow("E_RELAY_BAD");
    await relay.create(transport, { ...base, expiresAt: "2026-11-20T00:00:00Z" });
    await expect(relay.create(transport, { ...base, expiresAt: "2026-11-20T00:00:00Z" })).rejects.toThrow("E_RELAY_SUBMITTED");
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
        version: "0.1",
        requestId: "R-7K3P9Q",
        submittedAt: "2026-11-06T01:00:00.000Z",
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
    expect(r.dropped).toBe(6);
    expect(() => checkAnswers({ format: "x" }, def, sel, "R-7K3P9Q")).toThrow("E_WEB_ANSWERS_SHAPE");
    expect(() => checkAnswers({ format: "fprise-lifeplan-hearing-web-answers", version: "0.1", requestId: "R-AAAAAA", submittedAt: "", answers: [], documents: [] }, def, sel, "R-7K3P9Q")).toThrow("E_WEB_ANSWERS_REQUEST");
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

  it("配偶者の方がいなければ配偶者の方の問いと、配偶者の方のご両親の問いを出さず、生年月を「該当なし」で送る", async () => {
    const p = await packetOf();
    const d = withAnswers(initialDraft(p), {}, { spouse: 0, child: 0 });
    const keys = itemScreens(screens(p, d));
    expect(keys.some((k) => k.endsWith("#2") && k.startsWith("hs.family.adult"))).toBe(false);
    expect(keys.some((k) => k.startsWith("hs.family.parent") && (k.endsWith("#3") || k.endsWith("#4")))).toBe(false);
    expect(keys).toContain("hs.family.parent.alive#1");
    const a = answersOf(p, d, new Date());
    expect(a.answers.find((x) => x.key === "hs.family.adult.birthYearMonth" && x.index === 2)?.status).toBe("notApplicable");
    // 分岐の問いは配偶者の方の問いの前に1回だけ
    const list = screens(p, d);
    expect(list.filter((s) => s.kind === "gate" && s.gate === "spouse")).toHaveLength(1);
  });

  it("お子さまの人数で繰り返す。生年月と年齢・金額と範囲は同じ画面", async () => {
    const p = await packetOf();
    const d = withAnswers(initialDraft(p), {}, { spouse: 1, child: 2 });
    const list = screens(p, d);
    const keys = itemScreens(list);
    expect(keys.filter((k) => k.startsWith("hs.family.child.birthYearMonth"))).toEqual(["hs.family.child.birthYearMonth#1", "hs.family.child.birthYearMonth#2"]);
    const birth = list.find((s) => s.kind === "item" && s.key === "hs.family.adult.birthYearMonth" && s.index === 1);
    expect(birth).toMatchObject({ also: ["hs.family.adult.age"] });
    expect(keys).not.toContain("hs.income.annualRange#1");
    expect(list.find((s) => s.kind === "item" && s.key === "hs.income.annual" && s.index === 1)).toMatchObject({ also: ["hs.income.annualRange"] });
  });

  it("働き方・住まい・ご健在かで問いを飛ばす。見えない問いの答えは送らない", async () => {
    const p = await packetOf();
    let d = withAnswers(initialDraft(p), { [draftKey("hs.housing.type")]: v("rent"), [draftKey("hs.housing.rent")]: v("90000", "number"), [draftKey("hs.work.type", 1)]: { status: "notApplicable" }, [draftKey("hs.income.annual", 1)]: v("500", "number"), [draftKey("hs.family.parent.alive", 1)]: v("deceased") }, { spouse: 0 });
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
    const p = await packetOf(full4());
    const d = withAnswers(initialDraft(p), { [draftKey("hs.work.type", 1)]: v("selfEmployed"), [draftKey("hs.work.type", 2)]: v("executive"), [draftKey("hs.housing.type")]: v("own") }, { spouse: 1, child: 0, loan: 1, policy: 2 });
    const keys = itemScreens(screens(p, d));
    expect(keys).toContain("hs.income.business#1");
    expect(keys).toContain("hs.income.taxReturn#1");
    expect(keys).not.toContain("hs.income.taxReturn#2");
    expect(keys).not.toContain("hs.income.salary#1");
    expect(keys).toContain("hs.company.shares#2");
    expect(keys).not.toContain("hs.company.shares#1");
    expect(keys.filter((k) => k.startsWith("hs.loan.principal"))).toEqual(["hs.loan.principal#1"]);
    expect(keys.filter((k) => k.startsWith("hs.insurance.type"))).toEqual(["hs.insurance.type#1", "hs.insurance.type#2"]);
    expect(keys.some((k) => k.startsWith("hs.education"))).toBe(false);
  });

  it("見直し: 確かめてもらう項目は前回の値から始め、分岐の答えも前回の値から決める", async () => {
    const def = full4();
    const req = modelHousehold("dualHighTwoKids");
    const prefill = exportAnswers(def, req).answers;
    const sel = selectionFromSheet(def, () => "confirm");
    const { transport } = relayFor();
    const issued = await issueRequest({ definition: def, selection: sel, requestId: "R-7K3P9Q", customerNo: "A1", office: OFFICE, days: 14, now: new Date("2026-11-05T09:00:00Z"), pageUrl: "https://relay.test/h/", prefill, transport });
    const o = await openRequest(new URL(issued.record.url).hash, transport);
    const d = initialDraft(o.packet);
    expect(d.gates.spouse).toBe(1);
    expect(d.gates.child).toBeGreaterThanOrEqual(1);
    expect(d.answers[draftKey("hs.family.adult.birthYearMonth", 1)]?.status).toBe("value");
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
