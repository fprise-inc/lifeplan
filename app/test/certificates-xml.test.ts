// 控除証明書の電子データの残りの読み手（0154）: 国民年金保険料等・小規模企業共済等掛金（iDeCo・小規模企業共済）の控除証明書と、住宅ローンの
// 年末残高等証明書・住宅借入金等特別控除証明書。和暦の日付・読まない欄（氏名・住所・基礎年金番号など）・新しいローン・口座を足す・今ある物に当てる・
// 時点の欄（借りた年月）・名義の人の続柄の選択肢
import { describe, expect, it } from "vitest";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { roles } from "../src/workspace/roles.ts";
import { bodyObject, fromBody, type BodyState } from "../src/workspace/store/body.ts";
import { parseXml } from "../src/workspace/documents/xml.ts";
import { dateOf, yearOf } from "../src/workspace/documents/xmlValues.ts";
import { DEDUCTION_XML_READER, deductionProposals, readDeductionFile, SKIPPED } from "../src/workspace/documents/deductionXml.ts";
import { withDocumentLog, readDocumentLog } from "../src/workspace/documents/log.ts";
import { acceptCandidates, acceptObject, docReview, linkObject, linkTargets, withHolder } from "../src/workspace/documents/review.ts";
import { NEW_OBJECT_KINDS } from "../src/workspace/documents/objects.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { SAMPLE_MORE_XML, SAMPLE_PENSION_SLIP_XML } from "../src/workspace/documents/samples.ts";
import type { DocumentReading } from "../src/workspace/documents/types.ts";
import { DEFAULT_DISPLAY_SETTINGS } from "../src/workspace/settings.ts";
import { modelHousehold, preview } from "./helpers.ts";

const AT = "2026-11-07T10:00:00+09:00";
let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const open = (id = "salariedCoupleTwoKids"): WorkingHousehold => fromRequest(modelHousehold(id));
const members = (wh: WorkingHousehold) => roles(wh.request).map((r) => ({ key: r.key, id: r.member.id }));
const idOf = (wh: WorkingHousehold, key: string) => roles(wh.request).find((r) => r.key === key)!.member.id;
const bytes = (s: string) => new TextEncoder().encode(s);
const readFile = (wh: WorkingHousehold, xml: string) => readDeductionFile(bytes(xml), { at: AT, newId, members: members(wh) });
const body = (wh: WorkingHousehold): BodyState => ({ wh, workspace: { template: null, band: [], base: "current", selected: "current", shownItems: [] }, display: { result: DEFAULT_DISPLAY_SETTINGS, balance: fromBody(JSON.stringify({ household: { request: wh.request } })).display.balance }, carry: { extDefinitions: {}, ext: {} } });
const noIds = (s: string): string => s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gu, "");
const xml = (inner: string) => `<?xml version="1.0" encoding="UTF-8"?><DATA xmlns="urn:example:kyotsu" xmlns:gen="urn:example:general">${inner}</DATA>`;
const era = (tag: string, e: string, y: number, m?: number, d?: number) => `<${tag}><gen:era>${e}</gen:era><gen:yy>${y}</gen:yy>${m !== undefined ? `<gen:mm>${m}</gen:mm>` : ""}${d !== undefined ? `<gen:dd>${d}</gen:dd>` : ""}</${tag}>`;

/** 架空の氏名・住所・番号（読まない欄に入れたもの。読み取りの記録・世帯ファイルのどこにも出ないこと） */
const NEVER = ["架空 太郎", "架空 花子", "架空　次郎", "架空 次郎", "太郎", "花子", "次郎", "架空県", "1234-567890", "12345678", "LN-1234567", "UQ2026", "9999999999999", "000-0000-0000", "架空第999号", "備考", "署長", "期間外"];

/** 読んだ記録を世帯に入れ、名義の人を選ぶ */
async function readAll(wh: WorkingHousehold): Promise<DocumentReading[]> {
  const res = await readFile(wh, SAMPLE_MORE_XML);
  expect(res.issues).toEqual([]);
  return res.readings;
}

/** 物を足して（か今ある物に当てて）、その物の値の候補を全部1つずつ承認する */
function acceptAll(wh: WorkingHousehold, r0: DocumentReading, link?: string): { wh: WorkingHousehold; reading: DocumentReading; failed: string[] } {
  let r = r0;
  let w = wh;
  for (const o of r.objects) {
    if (link !== undefined) r = linkObject(w, r, o.key, link, AT)!;
    else {
      const res = acceptObject(w, r, o.key, AT)!;
      w = res.wh;
      r = res.reading;
    }
  }
  // 値を入れると出てくる欄（入居の年月を入れた後の住宅の種類など）があるので、画面で開き直すのと同じに、残りをもう一度承認する
  let failed: string[] = [];
  for (let i = 0; i < 3; i++) {
    const res = acceptCandidates(w, r, r.candidates.filter((c) => c.status === "pending").map((c) => c.id), {}, AT);
    w = res.wh;
    r = res.reading;
    failed = res.failed;
    if (failed.length === 0) break;
  }
  return { wh: w, reading: r, failed };
}

describe("和暦の日付", () => {
  it("元号の番号・元号の文字・元年・文字の和暦を西暦に直す。年だけ・月の無い形は日付にしない", () => {
    const el = (s: string) => {
      const r = parseXml(s);
      if (!r.ok) throw new Error(r.reason);
      return r.root;
    };
    expect(dateOf(el(`<d xmlns:gen="x"><gen:era>5</gen:era><gen:yy>6</gen:yy><gen:mm>8</gen:mm><gen:dd>4</gen:dd></d>`))).toEqual({ y: 2024, m: 8, d: 4 });
    expect(dateOf(el(`<d xmlns:gen="x"><gen:era>平成</gen:era><gen:yy>30</gen:yy><gen:mm>8</gen:mm></d>`))).toEqual({ y: 2018, m: 8, d: null });
    expect(dateOf(el(`<d xmlns:gen="x"><gen:era>令和</gen:era><gen:yy>元</gen:yy><gen:mm>10</gen:mm><gen:dd>1</gen:dd></d>`))).toEqual({ y: 2019, m: 10, d: 1 });
    expect(dateOf(el(`<d>令和6年8月4日</d>`))).toEqual({ y: 2024, m: 8, d: 4 });
    expect(dateOf(el(`<d>20180401</d>`))).toEqual({ y: 2018, m: 4, d: 1 });
    expect(dateOf(el(`<d xmlns:gen="x"><gen:era>5</gen:era><gen:yy>8</gen:yy></d>`))).toBeNull();
    expect(yearOf(el(`<d xmlns:gen="x"><gen:era>5</gen:era><gen:yy>8</gen:yy></d>`))).toBe(2026);
    expect(yearOf(el(`<d xmlns:gen="x"><gen:era>9</gen:era><gen:yy>8</gen:yy></d>`))).toBeNull();
  });
});

describe("架空の見本の読み取り", () => {
  it("4通の証明書を読み、氏名・住所・基礎年金番号・整理番号などは読み取りの記録にも世帯ファイルにも残らない", async () => {
    const wh = open();
    const rs = await readAll(wh);
    expect(rs.map((r) => r.docType)).toEqual(["pensionPremiumDeduction", "smallBusinessMutualAidDeduction", "housingLoanBalance", "housingLoanCredit"]);
    expect(rs.every((r) => r.via === "reader" && r.reader?.id === DEDUCTION_XML_READER.id && r.reader.version === 3)).toBe(true);
    const saved = noIds(JSON.stringify(bodyObject(body(withDocumentLog(wh, { version: 1, readings: rs })))));
    for (const w of NEVER) expect(saved, w).not.toContain(w);
    // 読まない要素は木に入れない（小規模企業共済等の住所・基礎年金番号の欄も）
    for (const t of ["WPC00000", "WPD00000", "WPE00000", "WOD00000", "WOE00000", "WOF00000", "WIA00010", "WIC00000"]) expect(SKIPPED.has(t), t).toBe(true);
    const parsed = parseXml(SAMPLE_MORE_XML, { skip: SKIPPED });
    expect(parsed.ok && JSON.stringify(parsed.root)).not.toMatch(/架空県|1234-567890|架空 太郎|LN-1234567/u);
  });

  it("国民年金保険料はアプリが計算するので、照合だけの値（その年の国民年金の行）。前納の証明書は行と比べない", async () => {
    const wh = open();
    const r = (await readAll(wh))[0]!;
    expect(r.candidates).toEqual([]);
    expect(r.references).toMatchObject([{ label: "国民年金保険料(2026年の納付額)", amount: 211680, row: "cf.taxSi.pension", year: 2026 }]);
    expect(r.asOf).toBe("2026-10");
    const pre = deductionProposals(xml(`<TEG840><WOA00000><kubun_CD>1</kubun_CD></WOA00000><WOB00000><kubun_CD>2</kubun_CD></WOB00000>${era("WOC00000", "5", 8)}<WOM00000>400000</WOM00000></TEG840>`)).proposals[0]!;
    expect((pre.raw.references as unknown[])[0]).toEqual({ label: "国民年金保険料（前納の額を含む）", amount: 400000, source: expect.anything() });
  });

  it("国民年金基金の掛金は、今の国民年金基金の掛金（月額）に入る（書類で確認）", async () => {
    // 見本の自営の世帯で、国民年金基金を足すボタンがあるのは配偶者
    const se = open("selfEmployed");
    const self = idOf(se, "spouse");
    const w = buildStage("retirement", se).sections.flatMap((x) => [...x.actions, ...x.groups.flatMap((g) => g.actions)]).find((a) => a.key === `retirement/${self}/add/nationalPensionFund`)!.run(se);
    const cert = xml(`<TEG840><WOA00000><kubun_CD>2</kubun_CD></WOA00000><WOB00000><kubun_CD>1</kubun_CD></WOB00000>${era("WOC00000", "5", 8)}<WOM00000>360000</WOM00000></TEG840>`);
    const r = withHolder(w, (await readFile(w, cert)).readings[0]!, self);
    const done = acceptCandidates(w, r, r.candidates.map((c) => c.id), {}, AT);
    expect(done.failed).toEqual([]);
    const fund = done.wh.request.input.household.retirementBenefits!.find((b) => b.kind === "nationalPensionFund")!;
    expect(JSON.stringify(fund.contributions)).toContain("30000");
  });

  it("国民年金基金の掛金は、今の国民年金基金の掛金（月額）の候補にする", () => {
    const p = deductionProposals(xml(`<TEG840><WOA00000><kubun_CD>2</kubun_CD><kubun_NM>国民年金基金掛金</kubun_NM></WOA00000><WOB00000><kubun_CD>1</kubun_CD></WOB00000>${era("WOC00000", "5", 8)}<WOM00000>360000</WOM00000></TEG840>`)).proposals[0]!;
    expect(p.raw.values).toMatchObject([{ item: "retirementBenefit.contributions", at: ["monthly"], member: "holder", value: 30000, period: "monthly", confidence: "medium" }]);
    expect(p.raw.references).toMatchObject([{ row: "cf.taxSi.pension.fund", year: 2026, amount: 360000 }]);
  });
});

describe("iDeCo・小規模企業共済の口座", () => {
  it("iDeCo の証明書から新しい iDeCo を足し、名義の人・毎月の掛金を入れる（書類で確認）。計算できる", async () => {
    const wh = open();
    const spouse = idOf(wh, "spouse");
    const r = withHolder(wh, (await readAll(wh))[1]!, spouse);
    expect(r.objects).toMatchObject([{ kind: "account:ideco", status: "pending" }]);
    const before = (wh.request.input.household.accounts ?? []).length;
    const done = acceptAll(wh, r);
    expect(done.failed).toEqual([]);
    const accounts = done.wh.request.input.household.accounts!;
    expect(accounts).toHaveLength(before + 1);
    const a = accounts.find((x) => x.id === done.reading.objects[0]!.created)!;
    expect(a).toMatchObject({ kind: "ideco", owner: spouse });
    expect(a.contributions?.[0]?.monthly).toBe(23000);
    expect(done.reading.references).toMatchObject([{ label: "iDeCoの掛金の控除の額(2026年)", amount: 276000 }]);
    expect(() => preview(done.wh.request)).not.toThrow();
  });

  it("同じ種類の口座がもうあれば「今の iDeCo に当てる」を選べ、口座を増やさずに掛金が入る", async () => {
    const wh = open();
    const self = idOf(wh, "self");
    const first = acceptAll(wh, withHolder(wh, (await readAll(wh))[1]!, self));
    const existing = first.reading.objects[0]!.created!;
    const r2 = withHolder(first.wh, (await readAll(first.wh))[1]!, self);
    const targets = linkTargets(first.wh, r2, r2.objects[0]!);
    expect(targets.map((t) => t.id)).toEqual([existing]);
    expect(docReview(first.wh, r2).groups[0]!.object).toMatchObject({ links: [{ id: existing }], noun: "iDeCo" });
    expect(docReview(first.wh, r2).notices.some((x) => x.includes("「今のiDeCoに当てる」"))).toBe(true);
    const done = acceptAll(first.wh, r2, existing);
    expect(done.failed).toEqual([]);
    expect(done.wh.request.input.household.accounts).toHaveLength(first.wh.request.input.household.accounts!.length);
    expect(done.reading.objects[0]).toMatchObject({ status: "accepted", created: existing, linked: true });
    // 当てた印は読み直しても残る
    expect(readDocumentLog({ version: 1, readings: [done.reading] })?.readings[0]?.objects[0]).toMatchObject({ linked: true, created: existing });
    // 同じ種類でない物には当てられない
    expect(linkObject(first.wh, r2, "a1", (first.wh.request.input.household.debts ?? [])[0]!.id, AT)).toBeNull();
  });

  it("小規模企業共済の証明書: 掛金月額と契約年月日（加入した年月）を読む。足せる人のいない世帯では足せない理由を出す", async () => {
    const mutual = xml(`<TEG850>${era("WPA00000", "5", 8)}<WPB00000><kubun_CD>1</kubun_CD><kubun_NM>小規模企業共済掛金</kubun_NM></WPB00000><WPC00000>架空 太郎</WPC00000><WPE00000>1234-567890</WPE00000><WPI00000>840000</WPI00000><WPK00000>${era("WPK00010", "4", 28, 4, 1)}<WPK00020>70000</WPK00020><WPK00030>月払</WPK00030></WPK00000></TEG850>`);
    const p = deductionProposals(mutual).proposals[0]!;
    expect(p.raw.objects).toMatchObject([{ kind: "account:smallBusinessMutualAid" }]);
    expect(p.raw.values).toMatchObject([{ item: "account.owner" }, { item: "account.enrolledSince", value: "2016-04" }, { item: "account.contributions", value: 70000, period: "monthly", confidence: "high" }]);
    expect(JSON.stringify(p.raw)).not.toMatch(/太郎|1234-567890/u);
    // 会社員の世帯には「＋ 小規模企業共済」のボタンが無いので、足せない
    const wh = open("salariedCoupleTwoKids");
    const r = (await readFile(wh, mutual)).readings[0]!;
    expect(acceptObject(wh, r, "a1", AT)).toBeNull();
    // 事業所得のある世帯では足せる
    const se = open("selfEmployed");
    const rs = withHolder(se, (await readFile(se, mutual)).readings[0]!, idOf(se, "self"));
    const done = acceptAll(se, rs);
    expect(done.failed).toEqual([]);
    expect(done.wh.request.input.household.accounts!.find((x) => x.id === done.reading.objects[0]!.created)).toMatchObject({ kind: "smallBusinessMutualAid", contributions: [{ monthly: 70000 }] });
  });
});

describe("住宅ローン", () => {
  it("年末残高等証明書から新しい住宅ローンを足し、残高・時点・借入額・借りた年月・完済の年月・名義が入る（書類で確認）。計算できる", async () => {
    const wh = open("single45");
    const self = idOf(wh, "self");
    const r = withHolder(wh, (await readAll(wh))[2]!, self);
    expect(r.objects).toMatchObject([{ kind: "debt:mortgage" }]);
    expect(docReview(wh, r).groups[0]!.label).toBe("新しい住宅ローン: 架空のさくら銀行 住宅ローン(住宅及び土地等)");
    const before = (wh.request.input.household.debts ?? []).length;
    const done = acceptAll(wh, r);
    expect(done.failed).toEqual([]);
    const d = done.wh.request.input.household.debts!.find((x) => x.id === done.reading.objects[0]!.created)!;
    expect(done.wh.request.input.household.debts).toHaveLength(before + 1);
    expect(d).toMatchObject({ kind: "mortgage", debtors: [{ member: self, role: "primary" }], start: { at: "2018-04" }, repayment: { termMonths: 420 } });
    expect(JSON.stringify(d)).toContain("28450000");
    expect(JSON.stringify(d)).toContain("35000000");
    expect(d.balanceAsOf).toBe("2025-12");
    // 家屋の取得の対価の額は照合だけの値
    expect(done.reading.references).toMatchObject([{ label: "家屋の取得の対価等の額", amount: 42000000 }]);
    expect(() => preview(done.wh.request)).not.toThrow();
  });

  it("連帯債務の記載があれば、ローンの名義を「夫婦で連帯債務」の候補にする（種類を決める欄なので1つずつ）", async () => {
    const wh = open("salariedCoupleTwoKids");
    const joint = SAMPLE_MORE_XML.replace("<WIA00180><kubun_CD>2</kubun_CD></WIA00180>", "<WIA00180><kubun_CD>1</kubun_CD></WIA00180>");
    const r = withHolder(wh, (await readFile(wh, joint)).readings[2]!, idOf(wh, "self"));
    const added = acceptObject(wh, r, "l1", AT)!;
    const v = docReview(added.wh, added.reading);
    const debtor = v.groups[0]!.rows.find((x) => x.label.endsWith("ローンの名義"))!;
    expect(debtor.incoming.text).toBe("夫婦で連帯債務（1本を2人で）");
    expect(v.bulk).not.toContain(debtor.id);
  });

  it("今の住宅ローンに当てると、ローンを増やさずに同じローンの欄に入る（名義の人の続柄の選択肢にも当たる）", async () => {
    const wh = open("salariedCoupleTwoKids");
    const loan = (wh.request.input.household.debts ?? []).find((x) => x.kind === "mortgage")!;
    const r = withHolder(wh, (await readAll(wh))[2]!, idOf(wh, "self"));
    expect(linkTargets(wh, r, r.objects[0]!).map((t) => t.id)).toContain(loan.id);
    const linked = linkObject(wh, r, "l1", loan.id, AT)!;
    const v = docReview(wh, linked);
    expect(v.groups[0]!.object).toMatchObject({ status: "accepted", linkedTo: expect.any(String) });
    const ids = linked.candidates.map((c) => c.id);
    const done = acceptCandidates(wh, linked, ids, {}, AT);
    // 借入額から入れたローンの返済期間は年数の欄なので、完済の年月の候補はそのままでは入らない（添え書きを見て直して入れる）
    expect(done.failed).toEqual(["年月の値です。この欄は年数で入れるので、書類を見て直して入れてください"]);
    expect(done.wh.request.input.household.debts).toHaveLength(wh.request.input.household.debts!.length);
    const d = done.wh.request.input.household.debts!.find((x) => x.id === loan.id)!;
    expect(JSON.stringify(d)).toContain("28450000");
    expect(d.balanceAsOf).toBe("2025-12");
  });

  it("住宅借入金等特別控除証明書（令和6年以降居住開始用）: 入居の年月・住宅の種類・新築・年末残高（年末調整の年の12月）", async () => {
    const wh = open("single45");
    const r = withHolder(wh, (await readAll(wh))[3]!, idOf(wh, "self"));
    expect(r.asOf).toBe("2026-10");
    const values = Object.fromEntries(r.candidates.map((c) => [`${c.target.item}${c.target.at !== undefined ? `/${c.target.at.join("/")}` : ""}`, c.value]));
    expect(values).toEqual({ "debt.housing": "2024-08", "debt.housing/propertyType": "zeh", "debt.housing/newBuild": "new", "debt.balance": 39200000, "debt.balanceAsOf": "2026-12" });
    const done = acceptAll(wh, r);
    expect(done.failed).toEqual([]);
    const h = done.wh.request.input.household;
    const d = h.debts!.find((x) => x.id === done.reading.objects[0]!.created)!;
    // 入居の年月は出来事（入居）の年月に入る
    expect(h.events?.find((e) => e.id === d.housing?.moveIn)?.at).toEqual({ at: "2024-08" });
    expect(d.housing).toMatchObject({ propertyType: "zeh", newBuild: true });
    expect(() => preview(done.wh.request)).not.toThrow();
  });

  it("平成の居住（元号の文字の版）と、令和5年以降の版の年末残高を読む。あて名・整理番号は読まない", () => {
    const old = deductionProposals(
      xml(`<TEG910><WKD00000><WKD00130>架空 太郎</WKD00130>${era("WKD00150", "令和", 8, 10, 1)}</WKD00000><WKG00000>12345678</WKG00000><WKI00000><WKI00200><WKI00210>（平成３１年中居住者・認定住宅用）</WKI00210><WKI00220><WKI00230>${era("WKI00270", "平成", 31, 3, 20)}</WKI00230></WKI00220></WKI00200></WKI00000></TEG910>`),
    ).proposals[0]!;
    expect(old.raw.values).toMatchObject([
      { item: "debt.housing", value: "2019-03" },
      { item: "debt.housing", at: ["propertyType"], value: "certified", confidence: "medium" },
    ]);
    expect(old.raw.asOf).toBe("2026-10");
    expect(JSON.stringify(old.raw)).not.toMatch(/太郎|12345678/u);
    const r5 = deductionProposals(xml(`<TEG918>${era("WXH00000", "5", 8)}<WXI00000><WXI00010/><WXI00230><WXI00240>（令和\u3000５年中居住者用）</WXI00240><WXI00250><WXI00260>${era("WXI00300", "5", 5, 6, 1)}</WXI00260><WXI00500>中古住宅</WXI00500><WXI00510><WXI00520>18000000</WXI00520><WXI00530>7000000</WXI00530></WXI00510></WXI00250></WXI00230></WXI00000></TEG918>`)).proposals[0]!;
    expect(r5.raw.values).toMatchObject([
      { item: "debt.housing", value: "2023-06" },
      { item: "debt.housing", at: ["newBuild"], value: "used" },
      { item: "debt.balance", value: 25000000 },
      { item: "debt.balanceAsOf", value: "2026-12" },
    ]);
  });
});

describe("物の種類の一覧", () => {
  it("住宅ローン・iDeCo・小規模企業共済を足すボタンが、入力の画面にある（足せる世帯で）", () => {
    for (const kind of ["debt:mortgage", "account:ideco"]) expect(NEW_OBJECT_KINDS[kind], kind).toBeDefined();
    const wh = open("selfEmployed");
    for (const kind of ["debt:mortgage", "account:ideco", "account:smallBusinessMutualAid"]) {
      const r: DocumentReading = { id: newId(), kind: "document", docType: "other", at: AT, via: "reader", objects: [{ key: "x1", kind, source: {}, confidence: "high", status: "pending" }], candidates: [], references: [], dropped: 0 };
      expect(acceptObject(wh, r, "x1", AT), kind).not.toBeNull();
    }
  });
});

describe("公的年金等の源泉徴収票", () => {
  it("支払金額・源泉徴収税額・社会保険料の額を照合だけの値にする（年分の12月）。住所・氏名・生年月日・扶養親族・摘要・法人番号・電話番号・電子署名は残らない", async () => {
    const wh = open("sampleSeniorCouple");
    const res = await readFile(wh, SAMPLE_PENSION_SLIP_XML);
    expect(res.issues).toEqual([]);
    const r = res.readings[0]!;
    expect(r).toMatchObject({ docType: "publicPensionWithholding", asOf: "2025-12", via: "reader", reader: { version: 3 }, candidates: [], objects: [] });
    expect(r.references.map((x) => [x.label, x.amount, x.row ?? null, x.year ?? null])).toEqual([
      ["公的年金の支払金額(架空年金機構)", 1980000, "cf.income.pension", 2025],
      ["源泉徴収税額(公的年金・架空年金機構)", 12400, "cf.taxSi.incomeTax", 2025],
      ["年金から天引きされた社会保険料", 168000, null, null],
    ]);
    const saved = noIds(JSON.stringify(bodyObject(body(withDocumentLog(wh, { version: 1, readings: [r] })))));
    for (const w of ["架空 太郎", "架空 花子", "カクウ", "架空県", "1234-567890", "1150", "9999999999999", "000-0000-0000", "QUJD", "摘要", "介護保険料"]) expect(saved, w).not.toContain(w);
    // 確かめの画面では、アプリの計算と並べる（行と年のある値）
    const v = docReview(wh, r, {}, (row, year) => (row === "cf.income.pension" && year === 2025 ? 1950000 : null));
    expect(v.references.map((x) => x.calc)).toEqual([1950000, null, null]);
  });

  it("古い版（平成28年以降用）は社会保険料の金額と支払者の札が違う。区分の号ごとの額を足す。額が無ければ理由を出す", () => {
    const old = deductionProposals(
      xml(`<TEG404>${era("ZHB00000", "4", 30)}<ZHC00000><ZHC00020>架空 太郎</ZHC00020></ZHC00000><ZHD00000><ZHD00010><ZHD00020><ZHD00040>1200000</ZHD00040></ZHD00020><ZHD00050><ZHD00070>3000</ZHD00070></ZHD00050></ZHD00010><ZHD00080><ZHD00090><ZHD00110>300000</ZHD00110></ZHD00090></ZHD00080></ZHD00000><ZHI00000>90000</ZHI00000><ZHJ00000><ZHJ00010>基礎年金番号 1234-567890</ZHJ00010></ZHJ00000><ZHK00000><ZHK00005>9999999999999</ZHK00005><ZHK00020>架空の基金</ZHK00020><ZHK00030>000-0000-0000</ZHK00030></ZHK00000></TEG404>`),
    ).proposals[0]!;
    expect(old.raw.asOf).toBe("2018-12");
    expect(old.raw.references).toMatchObject([
      { label: "公的年金の支払金額（架空の基金）", amount: 1500000, year: 2018 },
      { amount: 3000, row: "cf.taxSi.incomeTax" },
      { label: "年金から天引きされた社会保険料", amount: 90000 },
    ]);
    expect(JSON.stringify(old.raw)).not.toMatch(/太郎|1234-567890|9999999999999|000-0000/u);
    const empty = deductionProposals(xml(`<TEG408>${era("ZQB00000", "5", 7)}</TEG408>`));
    expect(empty).toEqual({ proposals: [], issues: ["公的年金等の源泉徴収票に、支払金額・源泉徴収税額・社会保険料の額がありません"] });
    for (const t of ["ZQC00000", "ZQL00000", "ZQM00000", "ZQN00000", "ZQO00000", "ZQP00010", "ZQP00020", "ZQP00040", "ZHC00000", "ZHJ00000", "ZHK00005", "Signature"]) expect(SKIPPED.has(t), t).toBe(true);
  });
});
