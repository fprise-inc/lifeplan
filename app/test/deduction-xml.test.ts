// 控除証明書の電子データ（XML）の読み手と、保険の入れ漏れの一覧（0153）: 安全な XML の読み手・生命保険料と地震保険料の控除証明書から
// 保険の契約の候補・読まない欄（氏名・証券番号など）・壊れた XML と別の種類の XML・承認して契約を足す・入れ漏れの一覧・画面
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { roles } from "../src/workspace/roles.ts";
import { bodyObject, fromBody, type BodyState } from "../src/workspace/store/body.ts";
import { decodeXml, parseXml, textOf } from "../src/workspace/documents/xml.ts";
import { DEDUCTION_XML_READER, deductionProposals, readDeductionFile, SKIPPED } from "../src/workspace/documents/deductionXml.ts";
import { insuranceGaps } from "../src/workspace/documents/insuranceGaps.ts";
import { withDocumentLog } from "../src/workspace/documents/log.ts";
import { acceptCandidates, acceptObject, docReview, rejectObject, withHolder } from "../src/workspace/documents/review.ts";
import { createObject } from "../src/workspace/documents/apply.ts";
import { DocumentEntry, DocumentReview, xmlSampleReadings } from "../src/workspace/documents/DocumentReview.tsx";
import { SAMPLE_DEDUCTION_XML } from "../src/workspace/documents/samples.ts";
import type { DocCandidate, DocumentReading } from "../src/workspace/documents/types.ts";
import { DEFAULT_DISPLAY_SETTINGS } from "../src/workspace/settings.ts";
import { modelHousehold, preview } from "./helpers.ts";

const AT = "2026-11-07T10:00:00+09:00";
let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const open = (id = "salariedCoupleTwoKids"): WorkingHousehold => fromRequest(modelHousehold(id));
const members = (wh: WorkingHousehold) => roles(wh.request).map((r) => ({ key: r.key, id: r.member.id }));
const selfId = (wh: WorkingHousehold) => roles(wh.request).find((r) => r.key === "self")!.member.id;
const bytes = (s: string) => new TextEncoder().encode(s);
const readFile = (wh: WorkingHousehold, xml: string | Uint8Array) => readDeductionFile(typeof xml === "string" ? bytes(xml) : xml, { at: AT, newId, members: members(wh) });
const body = (wh: WorkingHousehold): BodyState => ({ wh, workspace: { template: null, band: [], base: "current", selected: "current", shownItems: [] }, display: { result: DEFAULT_DISPLAY_SETTINGS, balance: fromBody(JSON.stringify({ household: { request: wh.request } })).display.balance }, carry: { extDefinitions: {}, ext: {} } });

/** 架空の値の控除証明書（生命保険料）を、明細の XML から作る */
const life = (details: string, head = "<WCA00000>架空のほし生命</WCA00000>") => `<?xml version="1.0" encoding="UTF-8"?><TEG800 xmlns="urn:example:kyotsu" xmlns:gen="urn:example:general">${head}${details}</TEG800>`;
const detail = (inner: string) => `<WCE00000><WCE00010><gen:yyyy>2026</gen:yyyy></WCE00010>${inner}</WCE00000>`;
const ymd = (tag: string, y: number, m: number, d?: number) => `<${tag}><gen:yyyy>${y}</gen:yyyy><gen:mm>${m}</gen:mm>${d !== undefined ? `<gen:dd>${d}</gen:dd>` : ""}</${tag}>`;

/** 乱数の ID（UUID）を外した文字（ID の中の数字を、番号と取り違えないため） */
const noIds = (s: string): string => s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gu, "");
const valueOf = (r: DocumentReading, key: string, item: string, at?: string): DocCandidate | undefined => r.candidates.find((c) => c.target.newObject === key && c.target.item === item && (at === undefined || c.target.at?.[0] === at));

/** 架空の氏名・番号（読まない欄に入れたもの。読み取りの記録・世帯ファイル・画面のどこにも出ないこと） */
const NEVER = ["架空 太郎", "架空 花子", "太郎", "花子", "AB-0012345678", "AB-0012345679", "AB-0012345680", "SK-77777", "F-5555-01", "0000000001", "K-123", "9999999999999", "1985"];

describe("安全な XML の読み手", () => {
  it("名前空間の接頭辞を外し、決まった実体・数字の参照・CDATA・注釈・属性を読む", () => {
    const r = parseXml(`<?xml version="1.0"?><!-- 注釈 --><a:Root xmlns:a="urn:x" v='1'><a:b>A&amp;B&#x41;&#66;</a:b><c><![CDATA[<そのまま>]]></c><d/></a:Root>`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.root.name).toBe("Root");
    expect(r.root.children.map((c) => c.name)).toEqual(["b", "c", "d"]);
    expect(textOf(r.root.children[0])).toBe("A&BAB");
    expect(textOf(r.root.children[1])).toBe("<そのまま>");
  });

  it("文書型の宣言・実体の宣言（実体の膨らみ・外の参照）のある XML は読まない", () => {
    const bomb = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]><lolz>&lol2;</lolz>`;
    expect(parseXml(bomb)).toEqual({ ok: false, reason: "文書型の宣言（DOCTYPE）や実体の宣言のある XML は読みません" });
    const external = `<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><r>&x;</r>`;
    expect(parseXml(external).ok).toBe(false);
    expect(parseXml(`<r>&x;</r>`)).toMatchObject({ ok: false, reason: expect.stringContaining("知らない実体の参照") });
  });

  it("壊れた XML（閉じていない・開きと閉じが違う・一番外が2つ・外に文字・深すぎる）は理由を出して読まない", () => {
    expect(parseXml("<a><b></a>")).toMatchObject({ ok: false, reason: "要素の開きと閉じが合っていません" });
    expect(parseXml("<a><b>")).toMatchObject({ ok: false, reason: expect.stringContaining("途中で切れた") });
    expect(parseXml("<a/><b/>")).toMatchObject({ ok: false, reason: "一番外の要素が2つ以上あります" });
    expect(parseXml("x<a/>")).toMatchObject({ ok: false, reason: "要素の外に文字があります" });
    expect(parseXml(`${"<a>".repeat(50)}${"</a>".repeat(50)}`)).toMatchObject({ ok: false, reason: "入れ子が深すぎます" });
    expect(parseXml("")).toMatchObject({ ok: false });
    expect(parseXml("<a b=1/>")).toMatchObject({ ok: false, reason: "属性の値の形が違います" });
  });

  it("読まない要素は、中身ごと木に入れない（中の形は確かめる）", () => {
    const r = parseXml("<r><name>架空 太郎<x>秘密</x></name><keep>ok</keep></r>", { skip: new Set(["name"]) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.stringify(r.root)).not.toMatch(/太郎|秘密/u);
    expect(parseXml("<r><name><x></name></r>", { skip: new Set(["name"]) }).ok).toBe(false);
  });

  it("ファイルの文字コード: 先頭の印・宣言の Shift_JIS を読む。ZIP・PDF・空・合わない文字コードは理由を出す", () => {
    expect(decodeXml(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes("<a>あ</a>")]))).toEqual({ ok: true, text: "<a>あ</a>" });
    // 「あ」の Shift_JIS は 0x82 0xA0
    const sjis = new Uint8Array([...bytes('<?xml version="1.0" encoding="Shift_JIS"?><a>'), 0x82, 0xa0, ...bytes("</a>")]);
    expect(decodeXml(sjis)).toMatchObject({ ok: true, text: expect.stringContaining("<a>あ</a>") });
    expect(decodeXml(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0]))).toMatchObject({ ok: false, reason: expect.stringContaining("ZIP") });
    expect(decodeXml(bytes("%PDF-1.7"))).toMatchObject({ ok: false, reason: expect.stringContaining("PDF") });
    expect(decodeXml(new Uint8Array())).toMatchObject({ ok: false });
    expect(decodeXml(new Uint8Array([0x3c, 0x61, 0x3e, 0xff, 0xfe, 0x3c]))).toMatchObject({ ok: false, reason: expect.stringContaining("文字を読めません") });
    expect(decodeXml(bytes('<?xml version="1.0" encoding="EBCDIC-X"?><a/>'))).toMatchObject({ ok: false, reason: "この文字コードの XML は読めません" });
  });
});

describe("控除証明書の電子データ → 保険の契約の候補", () => {
  it("1つのファイルの証明書ごとに読み取りの記録を作る（生命保険料2通・地震保険料1通）。読み手の ID・版・ファイルの指紋と大きさだけを持つ", async () => {
    const wh = open();
    const res = await readFile(wh, SAMPLE_DEDUCTION_XML);
    expect(res.issues).toEqual([]);
    expect(res.readings.map((r) => [r.docType, r.objects.length])).toEqual([
      ["lifeInsuranceDeduction", 3],
      ["lifeInsuranceDeduction", 1],
      ["earthquakeInsuranceDeduction", 1],
    ]);
    for (const r of res.readings) {
      expect(r).toMatchObject({ via: "reader", reader: DEDUCTION_XML_READER, asOf: "2026-10", file: { sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u), bytes: bytes(SAMPLE_DEDUCTION_XML).length } });
      expect(r.holder).toBeUndefined();
    }
  });

  it("契約ごとに種類・名前・契約年月・契約者（書類の名義）・払い方と保険料・控除の区分と新旧を出す", async () => {
    const wh = open();
    const [a, b] = (await readFile(wh, SAMPLE_DEDUCTION_XML)).readings as [DocumentReading, DocumentReading];
    expect(a.objects.map((o) => o.kind)).toEqual(["insurance:medical", "insurance:privateAnnuity", "insurance:incomeProtection"]);
    expect(b.objects.map((o) => o.kind)).toEqual(["insurance:cancer"]);
    const v = (r: DocumentReading, key: string, item: string, at?: string) => valueOf(r, key, item, at)?.value;
    // 医療保険: 月払い・年間の見込み 38,880円 → 月額 3,240円（12で割り切れる）。新制度・介護医療
    expect([v(a, "c1", "insurance.label"), v(a, "c1", "insurance.contractDate"), v(a, "c1", "insurance.policyholder")]).toEqual(["架空のみどり生命 終身医療保険", "2019-06", "holder"]);
    expect([v(a, "c1", "insurance.premium", "frequency"), v(a, "c1", "insurance.premium", "amount"), v(a, "c1", "insurance.deductionCategory", "type"), v(a, "c1", "insurance.deductionCategory", "regime")]).toEqual(["monthly", 3240, "careMedical", "new"]);
    // 個人年金: 年払い 120,000円（配当金を引く前）・旧制度・個人年金
    expect([v(a, "c2", "insurance.premium", "frequency"), v(a, "c2", "insurance.premium", "amount"), v(a, "c2", "insurance.deductionCategory", "type"), v(a, "c2", "insurance.deductionCategory", "regime")]).toEqual(["annual", 120000, "pension", "old"]);
    // 収入保障: 月払い 50,400円 → 4,200円・新制度・一般
    expect([v(a, "c3", "insurance.premium", "amount"), v(a, "c3", "insurance.deductionCategory", "type")]).toEqual([4200, "general"]);
    expect(valueOf(a, "c1", "insurance.policyholder")).toMatchObject({ confidence: "medium", note: expect.stringContaining("名前は読んでいません") });
    // 照合だけの値: 区分ごとの申告額の合計（入力にはしない）
    expect(a.references.map((r) => [r.label, r.amount])).toEqual([
      ["個人年金保険料・旧制度の申告額の合計", 117000],
      ["一般の生命保険料・新制度の申告額の合計", 50400],
      ["介護医療保険料・新制度の申告額の合計", 38880],
    ]);
    // 元の場所はデータの要素の道で持つ
    expect(valueOf(a, "c2", "insurance.contractDate")?.source).toMatchObject({ where: "契約日", text: "契約日 2010年4月1日", path: "TEG800/WCE00000.2/WCE00060" });
  });

  it("氏名・証券番号・被保険者番号・法人番号・団体のコード・受取人の生年月日・その他の欄は読まない（記録・世帯ファイルに残らない）", async () => {
    const wh = open();
    const res = await readFile(wh, SAMPLE_DEDUCTION_XML);
    const json = noIds(JSON.stringify(res.readings));
    for (const s of NEVER) expect(json).not.toContain(s);
    const stored = noIds(JSON.stringify(bodyObject(body(withDocumentLog(wh, res.readings.reduce((log, r) => ({ version: 1, readings: [...log.readings, r] }), { version: 1, readings: [] as DocumentReading[] }))))));
    for (const s of NEVER) expect(stored).not.toContain(s);
    expect(SKIPPED.has("WCD00000") && SKIPPED.has("WCE00040") && SKIPPED.has("WDD00000") && SKIPPED.has("WDE00060")).toBe(true);
  });

  it("保険の種類の欄に紛れた個人番号らしい数は消す（読み口の決まりを通る）", async () => {
    const wh = open();
    const res = await readFile(wh, life(detail(`<WCE00050>医療保険 1234 5678 9012</WCE00050>${ymd("WCE00060", 2020, 1, 1)}<WCE00100>年払</WCE00100><WCE00440><WCE00550><WCE00600><WCE00610>36000</WCE00610><WCE00630>36000</WCE00630></WCE00600></WCE00550></WCE00440>`)));
    const r = res.readings[0]!;
    expect(JSON.stringify(r)).not.toMatch(/1234.?5678.?9012/u);
    expect(r.dropped).toBeGreaterThan(0);
  });

  it("12月までの見込みが無ければ証明額を使う（1年分でなければ確からしさ低・年額）。12で割り切れない月払い・一時払い・払込方法の無いとき", async () => {
    const wh = open();
    const partial = (await readFile(wh, life(detail(`<WCE00050>定期保険</WCE00050><WCE00100>月払</WCE00100><WCE00190>${ymd("WCE00200", 2026, 1)}${ymd("WCE00210", 2026, 10)}<WCE00310><WCE00320><WCE00330>30000</WCE00330><WCE00350>30000</WCE00350></WCE00320></WCE00310></WCE00190>`)))).readings[0]!;
    expect(valueOf(partial, "c1", "insurance.premium", "amount")).toMatchObject({ value: 30000, confidence: "low", note: expect.stringContaining("10か月") });
    expect(valueOf(partial, "c1", "insurance.premium", "frequency")?.value).toBe("annual");
    // 契約日の無い明細は、契約年月を「読めなかった」にする
    expect(valueOf(partial, "c1", "insurance.contractDate")).toMatchObject({ value: null, unreadable: true });
    const odd = (await readFile(wh, life(detail(`<WCE00050>定期保険</WCE00050><WCE00100>月払</WCE00100><WCE00440><WCE00550><WCE00560><WCE00570>50001</WCE00570></WCE00560></WCE00550></WCE00440>`)))).readings[0]!;
    expect(valueOf(odd, "c1", "insurance.premium", "amount")).toMatchObject({ value: 50001, confidence: "medium" });
    expect(valueOf(odd, "c1", "insurance.premium", "frequency")?.value).toBe("annual");
    const single = (await readFile(wh, life(detail(`<WCE00050>終身保険</WCE00050><WCE00100>一時払</WCE00100><WCE00440><WCE00550><WCE00560><WCE00570>1000000</WCE00570></WCE00560></WCE00550></WCE00440>`)))).readings[0]!;
    expect(valueOf(single, "c1", "insurance.premium", "frequency")?.value).toBe("single");
    expect(single.objects[0]?.kind).toBe("insurance:wholeLife");
    // 種類の言葉が無ければ、控除の区分から（確からしさ低）
    const none = (await readFile(wh, life(detail(`<WCE00440><WCE00550><WCE00600><WCE00610>24000</WCE00610></WCE00600></WCE00550></WCE00440>`)))).readings[0]!;
    expect(none.objects[0]).toMatchObject({ kind: "insurance:medical", confidence: "low" });
    expect(valueOf(none, "c1", "insurance.premium", "amount")).toMatchObject({ value: 24000, confidence: "medium" });
  });

  it("区分が2つに分かれている契約は、額の大きい区分にし、確からしさを中にして添え書きを付ける", async () => {
    const wh = open();
    const r = (await readFile(wh, life(detail(`<WCE00050>終身保険</WCE00050><WCE00100>年払</WCE00100><WCE00440><WCE00550><WCE00560><WCE00570>60000</WCE00570><WCE00590>60000</WCE00590></WCE00560><WCE00600><WCE00610>20000</WCE00610><WCE00630>20000</WCE00630></WCE00600></WCE00550></WCE00440>`)))).readings[0]!;
    expect(valueOf(r, "c1", "insurance.deductionCategory", "type")).toMatchObject({ value: "general", confidence: "medium", note: expect.stringContaining("分かれています") });
    expect(valueOf(r, "c1", "insurance.premium", "amount")?.value).toBe(80000);
  });

  it("地震保険料控除証明書: 損害保険の契約・地震保険料の区分・保険期間の始まり。保険料は地震保険の分だけなので確からしさ低（まとめての承認に入れない）", async () => {
    const wh = open();
    const q = (await readFile(wh, SAMPLE_DEDUCTION_XML)).readings[2]!;
    expect(q.objects).toEqual([expect.objectContaining({ key: "e1", kind: "insurance:nonLife" })]);
    expect(valueOf(q, "e1", "insurance.label")?.value).toBe("架空のうみ損保 地震保険(建物)");
    expect(valueOf(q, "e1", "insurance.deductionCategory", "type")?.value).toBe("earthquake");
    expect(valueOf(q, "e1", "insurance.contractDate")).toMatchObject({ value: "2024-03", confidence: "medium" });
    expect(valueOf(q, "e1", "insurance.premium", "amount")).toMatchObject({ value: 21600, confidence: "low", note: expect.stringContaining("火災保険の分") });
    expect(q.references.map((r) => [r.label, r.amount])).toEqual([["地震保険料の控除の対象額の合計", 21600]]);
    // 旧長期損害保険だけの明細
    const long = `<TEG810><WDA00000>架空のかわ損保</WDA00000><WDE00000><WDE00020><kubun_CD>2</kubun_CD><kubun_NM>旧長期損害保険料</kubun_NM></WDE00020><WDE00190><WDE00200>5000</WDE00200><WDE00210>5000</WDE00210></WDE00190></WDE00000></TEG810>`;
    const l = (await readFile(wh, long)).readings[0]!;
    expect(valueOf(l, "e1", "insurance.deductionCategory", "type")?.value).toBe("longTermNonLife");
    expect(valueOf(l, "e1", "insurance.label")?.value).toBe("架空のかわ損保 長期損害保険");
  });
});

describe("読めないファイルは理由を出して読まない", () => {
  it("壊れた XML・別の種類の XML・控除証明書でない XML・ZIP・文書型の宣言", async () => {
    const wh = open();
    const cut = await readFile(wh, SAMPLE_DEDUCTION_XML.slice(0, 600));
    expect(cut.readings).toEqual([]);
    expect(cut.issues[0]).toMatch(/^XML として読めません: /u);
    const other = await readFile(wh, "<TEG840><WKA00000>架空</WKA00000></TEG840>");
    expect(other).toEqual({ readings: [], issues: [expect.stringContaining("国民年金保険料等控除証明書の電子データは、まだ読めません")] });
    expect((await readFile(wh, "<NTAAPP001><x/></NTAAPP001>")).issues).toEqual(["生命保険料・地震保険料の控除証明書の電子データではありません"]);
    expect((await readFile(wh, new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2]))).issues[0]).toContain("ZIP");
    expect((await readFile(wh, `<!DOCTYPE x><TEG800/>`)).issues[0]).toContain("文書型の宣言");
    expect((await readFile(wh, "<TEG800><WCA00000>架空</WCA00000></TEG800>")).issues).toEqual(["生命保険料控除証明書に、契約の明細がありません"]);
  });

  it("生命保険料の証明書と、まだ読めない証明書が一緒のファイルでは、読める分だけ読んで残りの理由を出す", async () => {
    const wh = open();
    const xml = `<DATA>${life(detail("<WCE00050>医療保険</WCE00050>")).replace(/^<\?xml[^>]*\?>/u, "")}<TEG850><x/></TEG850></DATA>`;
    const res = await readFile(wh, xml);
    expect(res.readings).toHaveLength(1);
    expect(res.issues).toEqual([expect.stringContaining("小規模企業共済等掛金控除証明書")]);
  });
});

describe("承認して契約を足す", () => {
  it("名義を選び、契約を足して、まとめて承認する（契約者・地震の保険料など確からしさが中・低の行は1つずつ）。計算できる", async () => {
    const wh = open();
    const before = wh.request.input.household.insuranceContracts?.length ?? 0;
    let r = withHolder(wh, (await readFile(wh, SAMPLE_DEDUCTION_XML)).readings[0]!, selfId(wh));
    let w = wh;
    for (const key of ["c1", "c2", "c3"]) {
      const res = acceptObject(w, r, key, AT)!;
      w = res.wh;
      r = res.reading;
    }
    const v = docReview(w, r);
    // まとめての承認に入らない行: 契約者（確からしさ中）の3行と、足したときの既定（月払い・新制度）と違う個人年金の払い方・新旧の制度
    const rows = v.groups.flatMap((g) => g.rows);
    expect(rows.filter((x) => !v.bulk.includes(x.id)).map((x) => [x.label.replace(/^.*: /u, ""), x.compare])).toEqual([
      ["契約者", "fill"],
      ["契約者", "fill"],
      ["払い方", "conflict"],
      ["新旧の制度", "conflict"],
      ["契約者", "fill"],
    ]);
    const done = acceptCandidates(w, r, v.bulk, {}, AT);
    expect(done.failed).toEqual([]);
    const list = done.wh.request.input.household.insuranceContracts!;
    expect(list).toHaveLength(before + 3);
    const byId = (key: string) => list.find((x) => x.id === r.objects.find((o) => o.key === key)!.created)!;
    expect(byId("c1")).toMatchObject({ subtype: "medical", label: "架空のみどり生命 終身医療保険", contractDate: "2019-06", premium: { amount: 3240, frequency: "monthly" }, deductionCategory: { type: "careMedical", regime: "new" } });
    expect(byId("c2")).toMatchObject({ subtype: "privateAnnuity", contractDate: "2010-04", premium: { amount: 120000 }, deductionCategory: { type: "pension" } });
    expect(byId("c3")).toMatchObject({ subtype: "incomeProtection", premium: { amount: 4200, frequency: "monthly" }, deductionCategory: { type: "general", regime: "new" } });
    // 承認した値は出どころ「取り込み」・確かさ「書類で確認」
    expect((byId("c1") as unknown as { valueStates: Record<string, unknown> }).valueStates["insurance.premium/amount"]).toMatchObject({ state: "confirmed", origin: { kind: "import", ref: r.id }, certainty: "document" });
    // 足したときの既定と同じ払い方（月払い）は、値はそのままで確かさだけを書類で確認にする
    expect((byId("c1") as unknown as { valueStates: Record<string, unknown> }).valueStates["insurance.premium/frequency"]).toMatchObject({ state: "confirmed", certainty: "document" });
    // 残りは1つずつ承認する（契約者は名義の人になる）
    const one = acceptCandidates(done.wh, done.reading, rows.filter((x) => !v.bulk.includes(x.id)).map((x) => x.id), {}, AT);
    expect(one).toMatchObject({ count: 5, failed: [] });
    expect(one.wh.request.input.household.insuranceContracts!.find((x) => x.id === r.objects[1]!.created)).toMatchObject({ premium: { frequency: "annual" }, deductionCategory: { regime: "old" } });
    expect(() => preview(one.wh.request)).not.toThrow();
  });

  it("地震保険の契約: 保険料（確からしさ低）はまとめての承認に入らない", async () => {
    const wh = open();
    const q = withHolder(wh, (await readFile(wh, SAMPLE_DEDUCTION_XML)).readings[2]!, selfId(wh));
    const added = acceptObject(wh, q, "e1", AT)!;
    const v = docReview(added.wh, added.reading);
    const premium = valueOf(added.reading, "e1", "insurance.premium", "amount")!;
    expect(v.bulk).not.toContain(premium.id);
    const done = acceptCandidates(added.wh, added.reading, v.bulk, {}, AT);
    const c = done.wh.request.input.household.insuranceContracts!.find((x) => x.id === added.reading.objects[0]!.created)!;
    expect(c).toMatchObject({ template: "insurance.nonLife", deductionCategory: { type: "earthquake" } });
    expect(c.premium.amount).toBe(0);
  });
});

describe("保険の入れ漏れの一覧", () => {
  it("今の入力に無い契約は「無さそう」。保険会社・種類・契約年月・保険料の2つ以上が合う契約は「同じ契約かも」と知らせ、まとめない", async () => {
    const wh = open();
    const r = (await readFile(wh, SAMPLE_DEDUCTION_XML)).readings[0]!;
    const g0 = insuranceGaps(wh, r)!;
    expect(g0.rows.map((x) => [x.key, x.status, x.annual, x.contractDate, x.deduction])).toEqual([
      ["c1", "missing", 38880, "2019-06", "介護医療保険料"],
      ["c2", "missing", 120000, "2010-04", "個人年金保険料"],
      ["c3", "missing", 50400, "2021-09", "一般生命保険料"],
    ]);
    // 今の入力に、同じ会社の医療保険（契約年月も同じ）を足しておく
    const made = createObject(wh, "insurance:medical")!;
    const w: WorkingHousehold = structuredClone(made.wh);
    const c = w.request.input.household.insuranceContracts!.find((x) => x.id === made.id)!;
    c.label = "みどり生命の医療保険";
    c.contractDate = "2019-06";
    c.premium.amount = 3240;
    const g1 = insuranceGaps(w, r)!;
    expect(g1.rows[0]).toMatchObject({ status: "maybe", matches: [{ label: "みどり生命の医療保険", reasons: ["種類", "契約年月", "保険料"] }] });
    expect(g1).toMatchObject({ missing: 2, maybe: 1 });
    // 確かめの画面の知らせにも出す（まとめない: 契約の数は変わらない）
    const v = docReview(w, r);
    expect(v.notices.some((x) => x.includes("同じ契約が、もうあるかもしれません（みどり生命の医療保険）"))).toBe(true);
    expect(w.request.input.household.insuranceContracts).toHaveLength(made.wh.request.input.household.insuranceContracts!.length);
  });

  it("保険会社の名前と種類が合えば「同じ契約かも」。種類だけが同じ契約は手がかりとして名前だけ添える", async () => {
    const wh = open();
    const r = (await readFile(wh, SAMPLE_DEDUCTION_XML)).readings[1]!;
    const made = createObject(wh, "insurance:cancer")!;
    const w: WorkingHousehold = structuredClone(made.wh);
    const c = w.request.input.household.insuranceContracts!.find((x) => x.id === made.id)!;
    c.label = "がんの保険（そら）";
    expect(insuranceGaps(w, r)!.rows[0]).toMatchObject({ status: "missing", sameKind: ["がんの保険（そら）"] });
    c.label = "架空のそら生命 がん";
    expect(insuranceGaps(w, r)!.rows[0]).toMatchObject({ status: "maybe", matches: [{ reasons: ["保険会社", "種類"] }] });
  });

  it("足した契約は「足しました」（その契約とは比べない）、足さないにした契約は「足さないことにしました」", async () => {
    const wh = open();
    const r = (await readFile(wh, SAMPLE_DEDUCTION_XML)).readings[0]!;
    const added = acceptObject(wh, r, "c1", AT)!;
    const g = insuranceGaps(added.wh, rejectObject(added.reading, "c2", AT))!;
    expect(g.rows.map((x) => x.status)).toEqual(["added", "rejected", "missing"]);
  });

  it("保険の契約の候補が無い書類には一覧を作らない", () => {
    const wh = open();
    const r: DocumentReading = { id: newId(), kind: "document", docType: "residentTaxNotice", at: AT, via: "reader", objects: [], candidates: [], references: [], dropped: 0 };
    expect(insuranceGaps(wh, r)).toBeNull();
  });
});

describe("画面", () => {
  it("確かめの画面に入れ漏れの一覧を出す。氏名・番号は出ない。同じファイルの別の種類の証明書は「前にも読んだ」と知らせない", async () => {
    const wh = open();
    const rs = (await readFile(wh, SAMPLE_DEDUCTION_XML)).readings;
    const w = withDocumentLog(wh, { version: 1, readings: rs });
    const html = renderToString(h(DocumentReview, { wh: w, calc: null, onChange: () => undefined, onClose: () => undefined, initial: rs[0]!.id }));
    expect(html).toContain("保険の入れ漏れの一覧");
    expect(html).toContain("この書類の契約 3件のうち、今の保険の入力に無さそうな契約 3件・同じ契約かもしれない契約 0件");
    expect((html.match(/data-documents-gap-status="missing"/gu) ?? []).length).toBe(3);
    expect(html).toContain("38,880円");
    expect(html).not.toContain("同じファイルを前にも読んでいます");
    expect(html).toContain("このパソコンの中だけで読みました（外へ送っていません）");
    // 名義を選ぶ前の契約者の値は「書類の名義の人」と見せる
    expect(html).toContain("書類の名義の人");
    for (const s of NEVER) expect(noIds(html)).not.toContain(s);
    // 同じファイルの同じ種類の証明書をもう一度読んだときは知らせる
    const again = { ...(await readFile(wh, SAMPLE_DEDUCTION_XML)).readings[0]!, at: "2026-11-08T09:00:00+09:00" };
    expect(docReview(w, again, {}, null, [...rs, again]).notices).toContain(`同じファイルを前にも読んでいます（${AT.slice(0, 10)}）。`);
  });

  it("入口: 読み手の口があれば XML を読むボタンと説明（このパソコンの中だけで読む）。見本の世帯では架空の電子データのボタン", () => {
    const wh = open();
    const base = { wh, onOpen: () => undefined, onSamples: () => undefined };
    expect(renderToString(h(DocumentEntry, { ...base, sample: false }))).not.toContain("data-documents-xml");
    const html = renderToString(h(DocumentEntry, { ...base, sample: false, onReadings: () => undefined }));
    expect(html).toContain("控除証明書の電子データ（XML）を読む");
    expect(html).toContain("このパソコンの中だけで読みます");
    expect(html).not.toContain("data-documents-xml-sample");
    expect(renderToString(h(DocumentEntry, { ...base, sample: true, onReadings: () => undefined }))).toContain("架空の控除証明書の電子データで試す");
  });

  it("架空の電子データの見本は、XML の読み手を通して見本の記録になる", () => {
    const wh = open();
    const rs = xmlSampleReadings(wh, AT, newId);
    expect(rs.map((r) => [r.via, r.reader?.id, r.docType])).toEqual([
      ["sample", "sample.deductionXml", "lifeInsuranceDeduction"],
      ["sample", "sample.deductionXml", "lifeInsuranceDeduction"],
      ["sample", "sample.deductionXml", "earthquakeInsuranceDeduction"],
    ]);
    expect(deductionProposals(SAMPLE_DEDUCTION_XML).proposals.map((p) => p.contracts)).toEqual([3, 1, 1]);
  });
});
