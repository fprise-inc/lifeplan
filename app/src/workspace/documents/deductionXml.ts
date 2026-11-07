// 控除証明書の電子データ（マイナポータル連携の XML）の読み手（0153 の2・0154 の1）。このパソコンの中だけで読み、外へ送らない。
// 公的な仕様（年末調整のソフトが取り込む形）に合わせて、生命保険料・地震保険料の控除証明書をこのファイルで読み、
// 国民年金保険料等・小規模企業共済等掛金の控除証明書と住宅ローンの証明書（年末残高等証明書・住宅借入金等特別控除証明書）は certificatesXml.ts で読む。
// 1つのファイルに証明書が何通・契約の明細が何件あってもよい。証明書1通を読み取りの記録1件にし、明細1件を新しい物（保険の契約・ローン・口座）の候補1件にする。
// - 読む: 保険会社名・保険の種類（年金の種類）・契約日・払込方法・区分（一般・介護医療・個人年金、新・旧）ごとの保険料と申告額・証明日。
//   地震保険は区分（地震・旧長期損害）・保険の対象（建物・家財）・保険期間の始まり・保険料と控除の対象額
// - 読まない（木に入れずに捨てる）: 契約者・被保険者・受取人の氏名、証券番号（枝番号）・被保険者番号、法人番号、事業所（団体）のコード、
//   受取人の生年月日、その他の欄（自由な文）。ほかの証明書の読まない欄は certificatesXml.ts の CERTIFICATE_SKIPPED
// - 出す形は書類の候補の答え（document-candidates@1）で、読み口 readProposal を通す（番号を落とす決まり・上限も同じ）
// 要素の名前は仕様の札の名前（要素の意味の名前は、この読み手が付ける）
import { readProposal, type ProposalContext } from "./proposal.ts";
import { CERTIFICATE_SKIPPED, LOAN_BALANCE, LOAN_CREDIT_FORMS, loanBalanceAnswer, loanCreditAnswer, MUTUAL_AID, mutualAidAnswer, PENSION_PREMIUM, pensionPremiumAnswer, type CertificateAnswer } from "./certificatesXml.ts";
import { PROPOSAL_CONTRACT, type DocumentReading } from "./types.ts";
import { childOf, decodeXml, findAll, findFirst, parseXml, textOf, type XmlElement } from "./xml.ts";
import { amountOf, dateOf, dateText, kubunOf, shortIn, ym, type Count } from "./xmlValues.ts";

/** 読み手の ID と版（読み取りの記録と成績に残る。読み方を変えたら版を上げる） */
export const DEDUCTION_XML_READER = { id: "xml.deductionCertificate", version: 2 } as const;

const LIFE = "TEG800";
const QUAKE = "TEG810";
/** 読む証明書の要素の名前（生命保険・地震保険・国民年金保険料等・小規模企業共済等・年末残高等・住宅借入金等特別控除の版ごと） */
const CERTIFICATES = new Set([LIFE, QUAKE, PENSION_PREMIUM, MUTUAL_AID, LOAN_BALANCE, ...Object.keys(LOAN_CREDIT_FORMS)]);

/**
 * 読まない要素（氏名・番号・自由な文）。parseXml の skip に渡し、中身を木に入れない。
 * 生命保険: 法人番号・契約者・証券番号・事業所（団体）コード・被保険者・被保険者番号・受取人・受取人生年月日・その他。
 * 地震保険: 法人番号・契約者名・証券番号（と枝番号）・被保険者名・適用条文・その他
 */
export const SKIPPED = new Set([
  "WCB00000",
  "WCD00000",
  "WCE00040",
  "WCE00070",
  "WCE00080",
  "WCE00090",
  "WCE00110",
  "WCE00140",
  "WCE00720",
  "WDB00000",
  "WDD00000",
  "WDE00030",
  "WDE00040",
  "WDE00050",
  "WDE00060",
  "WDE00215",
  "WDE00220",
  ...CERTIFICATE_SKIPPED,
]);

type Raw = Record<string, unknown>;

/** 証明書1通の答え（読み口が受ける document-candidates@1）・新しい物の候補の数・読み手が番号らしい所を消した数（読み口の数に足す） */
export type CertificateProposal = CertificateAnswer;

export interface DeductionRead {
  proposals: CertificateProposal[];
  /** 読まなかった理由（値・文字は入れない） */
  issues: string[];
}

// ---- 保険料と払い方 ----

/**
 * 年間の保険料と払い方の候補。12月までの見込みの年間の保険料があればそれを、無ければ証明額（証明の対象の月分の保険料）を使う。
 * 月払いで12で割り切れれば月額にし、ほかは年額で入れる（払い方の候補も出す）
 */
function premiumOf(annual: number | null, paid: number | null, months: number | null, payment: string): { amount: number | null; frequency: "monthly" | "annual" | "single"; confidence: "high" | "medium" | "low"; note: string } {
  const p = payment.normalize("NFKC");
  const year = annual ?? paid;
  const partial = annual === null && paid !== null && months !== null && months < 12;
  if (year === null) return { amount: null, frequency: "annual", confidence: "low", note: "保険料の額が証明書にありません" };
  const base = annual !== null ? "12月までの見込みの年間の保険料" : partial ? `証明の対象の月分（${months}か月）の保険料で、1年分ではありません` : "証明額の保険料";
  if (/一時/u.test(p)) return { amount: year, frequency: "single", confidence: "medium", note: `一時払いの保険料です（${base}）` };
  if (partial) return { amount: year, frequency: "annual", confidence: "low", note: `${base}。1年分の額に直して入れてください` };
  if (/月/u.test(p) && !/[0-9]\s*[かヶケ]?月/u.test(p)) {
    if (year % 12 === 0) return { amount: year / 12, frequency: "monthly", confidence: "high", note: `${base}を12で割った月額です（配当金を引く前の額）` };
    return { amount: year, frequency: "annual", confidence: "medium", note: `月払いですが、${base}が12で割り切れないので年額で入れます` };
  }
  if (/半年/u.test(p)) return { amount: year, frequency: "annual", confidence: "medium", note: `半年払いを年額にしています（${base}）` };
  if (/年/u.test(p)) return { amount: year, frequency: "annual", confidence: "high", note: `${base}です（配当金を引く前の額）` };
  return { amount: year, frequency: "annual", confidence: "medium", note: `払込方法が読めないので年額で入れます（${base}）` };
}

const monthsBetween = (from: { y: number; m: number } | null, to: { y: number; m: number } | null): number | null => (from === null || to === null ? null : (to.y - from.y) * 12 + (to.m - from.m) + 1);

// ---- 生命保険料控除証明書 ----

type DeductionType = "general" | "careMedical" | "pension";

/** 区分ごとの札: 証明額（保険料・差引の額）と、12月までの見込み（年間の保険料・申告額） */
const LIFE_CATS: readonly { regime: "old" | "new"; type: DeductionType; paid: string; net: string; annual: string; declared: string }[] = [
  { regime: "old", type: "general", paid: "WCE00240", net: "WCE00260", annual: "WCE00480", declared: "WCE00500" },
  { regime: "old", type: "pension", paid: "WCE00280", net: "WCE00300", annual: "WCE00520", declared: "WCE00540" },
  { regime: "new", type: "general", paid: "WCE00330", net: "WCE00350", annual: "WCE00570", declared: "WCE00590" },
  { regime: "new", type: "careMedical", paid: "WCE00370", net: "WCE00390", annual: "WCE00610", declared: "WCE00630" },
  { regime: "new", type: "pension", paid: "WCE00410", net: "WCE00430", annual: "WCE00650", declared: "WCE00670" },
];

const TYPE_WORDS: Readonly<Record<DeductionType, string>> = { general: "一般の生命保険料", careMedical: "介護医療保険料", pension: "個人年金保険料" };
const REGIME_WORDS = { old: "旧制度", new: "新制度" } as const;

/** 保険の種類の言葉 → 種類の細目（言葉が無い・当たらなければ控除の区分から。確からしさは低） */
const KIND_WORDS: readonly [RegExp, string][] = [
  [/個人年金|年金保険/u, "privateAnnuity"],
  [/がん|癌|ガン/u, "cancer"],
  [/三大疾病|3大疾病|特定疾病|特定疾患/u, "threeMajor"],
  [/介護/u, "care"],
  [/就業不能|就労不能|所得補償/u, "incapacity"],
  [/医療/u, "medical"],
  [/収入保障|家族収入/u, "incomeProtection"],
  [/学資|こども|子ども|子供/u, "education"],
  [/低解約/u, "lowSurrender"],
  [/変額/u, "variable"],
  [/外貨|米ドル|ドル建|豪ドル|ユーロ/u, "foreignCurrency"],
  [/利率変動型積立|アカウント/u, "account"],
  [/養老/u, "endowment"],
  [/逓減/u, "decreasingTerm"],
  [/共済/u, "mutualAid"],
  [/終身/u, "wholeLife"],
  [/定期/u, "term"],
];

function lifeKind(typeText: string, annuityText: string, main: DeductionType | null): { kind: string; confidence: "high" | "low" } {
  const s = `${typeText} ${annuityText}`.normalize("NFKC");
  for (const [re, kind] of KIND_WORDS) if (re.test(s)) return { kind, confidence: "high" };
  if (annuityText !== "" || main === "pension") return { kind: "privateAnnuity", confidence: "high" };
  return { kind: main === "careMedical" ? "medical" : "term", confidence: "low" };
}

function lifeProposal(cert: XmlElement, issues: string[]): CertificateProposal | null {
  const count: Count = { masked: 0 };
  const short = shortIn(count);
  const company = short(textOf(childOf(cert, "WCA00000")));
  const certDate = dateOf(childOf(cert, "WCC00000"));
  const details = cert.children.filter((c) => c.name === "WCE00000");
  if (details.length === 0) {
    issues.push("生命保険料控除証明書に、契約の明細がありません");
    return null;
  }
  const objects: Raw[] = [];
  const values: Raw[] = [];
  const totals = new Map<string, number>();
  details.slice(0, 30).forEach((d, i) => {
    const key = `c${i + 1}`;
    const p = `${LIFE}/WCE00000.${i + 1}`;
    const typeText = short(textOf(findFirst(d, "WCE00050")));
    const annuityText = short(textOf(findFirst(d, "WCE00160")));
    const payment = short(textOf(findFirst(d, "WCE00100")), 15);
    const contract = dateOf(findFirst(d, "WCE00060"));
    const from = dateOf(findFirst(d, "WCE00200"));
    const to = dateOf(findFirst(d, "WCE00210"));
    // 区分ごとの額
    const cats = LIFE_CATS.map((c) => ({ ...c, paidAmt: amountOf(findFirst(d, c.paid)), netAmt: amountOf(findFirst(d, c.net)), annualAmt: amountOf(findFirst(d, c.annual)), declaredAmt: amountOf(findFirst(d, c.declared)) })).filter(
      (c) => c.paidAmt !== null || c.netAmt !== null || c.annualAmt !== null || c.declaredAmt !== null,
    );
    const weight = (c: (typeof cats)[number]) => c.declaredAmt ?? c.annualAmt ?? c.netAmt ?? c.paidAmt ?? 0;
    const used = cats.filter((c) => weight(c) > 0);
    const main = [...used].sort((a, b) => weight(b) - weight(a))[0] ?? null;
    for (const c of used) {
      const k = `${c.regime}/${c.type}`;
      totals.set(k, (totals.get(k) ?? 0) + (c.declaredAmt ?? c.netAmt ?? 0));
    }
    const sum = (f: "annualAmt" | "paidAmt"): number | null => (used.some((c) => c[f] !== null) ? used.reduce((n, c) => n + (c[f] ?? 0), 0) : null);
    const kind = lifeKind(typeText, annuityText, main?.type ?? null);
    const name = [company, typeText !== "" ? typeText : annuityText].filter((x) => x !== "").join(" ");
    objects.push({ key, kind: `insurance:${kind.kind}`, source: { where: "保険種類", ...(typeText !== "" ? { text: typeText } : {}), path: `${p}/WCE00050` }, confidence: kind.confidence });
    values.push({ item: "insurance.label", newObject: key, value: name !== "" ? name : null, ...(name === "" ? { unreadable: true } : {}), source: { where: "保険会社名・保険種類", path: `${p}/WCE00050` }, confidence: "high" });
    values.push(
      contract !== null
        ? { item: "insurance.contractDate", newObject: key, value: ym(contract), source: { where: "契約日", text: `契約日 ${dateText(contract)}`, path: `${p}/WCE00060` }, confidence: "high" }
        : { item: "insurance.contractDate", newObject: key, value: null, unreadable: true, source: { where: "契約日", path: `${p}/WCE00060` }, confidence: "low" },
    );
    values.push({
      item: "insurance.policyholder",
      newObject: key,
      value: "holder",
      source: { where: "契約者" },
      confidence: "medium",
      note: "契約者の名前は読んでいません。書類の名義の人（控除を受ける人）にしています。被保険者は証券で確かめてください",
    });
    const pr = premiumOf(sum("annualAmt"), sum("paidAmt"), monthsBetween(from, to), payment);
    if (pr.amount !== null) values.push({ item: "insurance.premium", at: ["frequency"], newObject: key, value: pr.frequency, source: { where: "払込方法", ...(payment !== "" ? { text: payment } : {}), path: `${p}/WCE00100` }, confidence: pr.confidence });
    values.push({
      item: "insurance.premium",
      at: ["amount"],
      newObject: key,
      value: pr.amount,
      ...(pr.amount === null ? { unreadable: true } : {}),
      period: "once",
      source: { where: sum("annualAmt") !== null ? "証明額（12月期想定）・年間払込保険料" : "証明額・保険料", ...(payment !== "" ? { text: `払込方法 ${payment}` } : {}), path: `${p}/WCE00440` },
      confidence: pr.confidence,
      note: pr.note,
    });
    if (main !== null) {
      const several = used.length > 1;
      values.push({
        item: "insurance.deductionCategory",
        at: ["type"],
        newObject: key,
        value: main.type,
        source: { where: `証明額・${REGIME_WORDS[main.regime]}・${TYPE_WORDS[main.type]}` },
        confidence: several ? "medium" : "high",
        ...(several ? { note: `証明書では${used.map((c) => `${REGIME_WORDS[c.regime]}の${TYPE_WORDS[c.type]}`).join("と")}に分かれています。額のいちばん大きい区分にしています` } : {}),
      });
      values.push({ item: "insurance.deductionCategory", at: ["regime"], newObject: key, value: main.regime, source: { where: `証明額・${REGIME_WORDS[main.regime]}` }, confidence: several ? "medium" : "high" });
    }
  });
  if (details.length > 30) issues.push("契約の明細が多すぎるので、先の30件だけ読みました");
  const references = LIFE_CATS.flatMap((c) => {
    const amount = totals.get(`${c.regime}/${c.type}`);
    return amount === undefined ? [] : [{ label: `${TYPE_WORDS[c.type]}・${REGIME_WORDS[c.regime]}の申告額の合計`, amount, source: { where: "証明額（12月期想定）・申告額" } }];
  });
  const raw: Raw = { contract: PROPOSAL_CONTRACT, docType: "lifeInsuranceDeduction", objects, values, references };
  if (certDate !== null) raw.asOf = ym(certDate);
  return { docType: "lifeInsuranceDeduction", raw, contracts: objects.length, masked: count.masked };
}

// ---- 地震保険料控除証明書 ----

function quakeProposal(cert: XmlElement, issues: string[]): CertificateProposal | null {
  const count: Count = { masked: 0 };
  const short = shortIn(count);
  const company = short(textOf(childOf(cert, "WDA00000")));
  const certDate = dateOf(childOf(cert, "WDC00000"));
  const details = cert.children.filter((c) => c.name === "WDE00000");
  if (details.length === 0) {
    issues.push("地震保険料控除証明書に、契約の明細がありません");
    return null;
  }
  const objects: Raw[] = [];
  const values: Raw[] = [];
  let quakeTotal: number | null = null;
  let longTotal: number | null = null;
  details.slice(0, 30).forEach((d, i) => {
    const key = `e${i + 1}`;
    const p = `${QUAKE}/WDE00000.${i + 1}`;
    const kubun = kubunOf(findFirst(d, "WDE00020"));
    const target = short(kubunOf(findFirst(d, "WDE00070")).name, 20);
    const payment = short(kubunOf(findFirst(d, "WDE00150")).name, 15);
    const start = dateOf(findFirst(d, "WDE00130")) ?? dateOf(findFirst(d, "WDE00090"));
    const quake = amountOf(findFirst(d, "WDE00170"));
    const long = amountOf(findFirst(d, "WDE00200"));
    const quakeDed = amountOf(findFirst(d, "WDE00180"));
    const longDed = amountOf(findFirst(d, "WDE00210"));
    if (quakeDed !== null) quakeTotal = (quakeTotal ?? 0) + quakeDed;
    if (longDed !== null) longTotal = (longTotal ?? 0) + longDed;
    const isLong = kubun.code === "2" || (kubun.code === null && /長期/u.test(kubun.name) && !/地震/u.test(kubun.name)) || (quake === null && quakeDed === null && (long !== null || longDed !== null));
    const both = kubun.code === "3";
    const kindWord = isLong ? "長期損害保険" : "地震保険";
    const name = [company, `${kindWord}${target !== "" ? `（${target}）` : ""}`].filter((x) => x !== "").join(" ");
    objects.push({ key, kind: "insurance:nonLife", source: { where: "保険料控除の対象となる保険料", ...(kubun.name !== "" ? { text: short(kubun.name, 30) } : {}), path: `${p}/WDE00020` }, confidence: "high" });
    values.push({ item: "insurance.label", newObject: key, value: name, source: { where: "保険会社名・保険の対象", path: `${p}/WDE00070` }, confidence: "high" });
    values.push(
      start !== null
        ? { item: "insurance.contractDate", newObject: key, value: ym(start), source: { where: "保険期間の開始日", text: `開始日 ${dateText(start)}`, path: `${p}/WDE00130` }, confidence: "medium", note: "保険期間の始まりの日です（契約の日と違うことがあります）" }
        : { item: "insurance.contractDate", newObject: key, value: null, unreadable: true, source: { where: "保険期間の開始日", path: `${p}/WDE00130` }, confidence: "low" },
    );
    values.push({ item: "insurance.policyholder", newObject: key, value: "holder", source: { where: "契約者" }, confidence: "medium", note: "契約者の名前は読んでいません。書類の名義の人（控除を受ける人）にしています" });
    const premium = quake !== null || long !== null ? (quake ?? 0) + (long ?? 0) : null;
    const pr = premiumOf(premium, null, null, payment);
    if (pr.amount !== null) values.push({ item: "insurance.premium", at: ["frequency"], newObject: key, value: pr.frequency, source: { where: "払込方法", ...(payment !== "" ? { text: payment } : {}), path: `${p}/WDE00150` }, confidence: pr.confidence });
    values.push({
      item: "insurance.premium",
      at: ["amount"],
      newObject: key,
      value: pr.amount,
      ...(pr.amount === null ? { unreadable: true } : {}),
      period: "once",
      source: { where: isLong ? "旧長期損害保険料" : "地震保険料", ...(payment !== "" ? { text: `払込方法 ${payment}` } : {}), path: `${p}/${isLong ? "WDE00200" : "WDE00170"}` },
      // 火災保険の分は証明書に無いので、まとめての承認に入れない
      confidence: "low",
      note: `${isLong ? "旧長期損害保険" : "地震保険"}の分の保険料だけです。火災保険の分を合わせた保険料は、証券で確かめてください`,
    });
    values.push({
      item: "insurance.deductionCategory",
      at: ["type"],
      newObject: key,
      value: isLong ? "longTermNonLife" : "earthquake",
      source: { where: "保険料控除の対象となる保険料", ...(kubun.name !== "" ? { text: short(kubun.name, 30) } : {}), path: `${p}/WDE00020` },
      confidence: both ? "medium" : "high",
      ...(both ? { note: "地震保険料と旧長期損害保険料の両方があります。どちらで控除を受けるかは年末調整で選びます。ここでは地震保険料にしています" } : {}),
    });
  });
  if (details.length > 30) issues.push("契約の明細が多すぎるので、先の30件だけ読みました");
  const references: Raw[] = [];
  if (quakeTotal !== null) references.push({ label: "地震保険料の控除の対象額の合計", amount: quakeTotal, source: { where: "控除対象保険料・地震保険" } });
  if (longTotal !== null) references.push({ label: "旧長期損害保険料の控除の対象額の合計", amount: longTotal, source: { where: "控除対象保険料・旧長期損害保険" } });
  const raw: Raw = { contract: PROPOSAL_CONTRACT, docType: "earthquakeInsuranceDeduction", objects, values, references };
  if (certDate !== null) raw.asOf = ym(certDate);
  return { docType: "earthquakeInsuranceDeduction", raw, contracts: objects.length, masked: count.masked };
}

// ---- 入口 ----

/**
 * XML の文字から、証明書ごとの答えを作る（世帯は変えない）。読めなければ理由だけを返す
 */
export function deductionProposals(text: string): DeductionRead {
  const parsed = parseXml(text, { skip: SKIPPED });
  if (!parsed.ok) return { proposals: [], issues: [`XML として読めません: ${parsed.reason}`] };
  const certs = findAll(parsed.root, CERTIFICATES);
  const issues: string[] = [];
  const proposals: CertificateProposal[] = [];
  for (const c of certs.slice(0, 50)) {
    const form = LOAN_CREDIT_FORMS[c.name];
    const p =
      c.name === LIFE
        ? lifeProposal(c, issues)
        : c.name === QUAKE
          ? quakeProposal(c, issues)
          : c.name === PENSION_PREMIUM
            ? pensionPremiumAnswer(c)
            : c.name === MUTUAL_AID
              ? mutualAidAnswer(c, issues)
              : c.name === LOAN_BALANCE
                ? loanBalanceAnswer(c, issues)
                : form !== undefined
                  ? loanCreditAnswer(c, form, issues)
                  : null;
    if (p === null) continue;
    // 値の候補も照合の値も無い証明書（額の無い証明書）は、読めなかったことにする
    const raw = p.raw as { values?: unknown[]; references?: unknown[] };
    if ((raw.values?.length ?? 0) === 0 && (raw.references?.length ?? 0) === 0) issues.push("額の書かれていない証明書がありました（読める値がありません）");
    else proposals.push(p);
  }
  if (certs.length > 50) issues.push("証明書が多すぎるので、先の50通だけ読みました");
  if (certs.length === 0) issues.push("控除証明書の電子データではありません（生命保険料・地震保険料・国民年金保険料等・小規模企業共済等掛金の控除証明書と、住宅ローンの年末残高等証明書・住宅借入金等特別控除証明書を読めます）");
  return { proposals, issues: [...new Set(issues)] };
}

/** ファイルの指紋（sha256:<16進>） */
export async function fileDigest(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return `sha256:${[...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export interface DeductionFileRead {
  readings: DocumentReading[];
  issues: string[];
}

/**
 * ファイルの中身（バイト）を読んで、証明書ごとの読み取りの記録にする（世帯は変えない。読み口 readProposal を通す）。
 * 元のファイル・ファイル名は持たず、指紋と大きさだけを記録に残す
 */
export async function readDeductionFile(bytes: Uint8Array, ctx: Omit<ProposalContext, "via" | "reader" | "file">): Promise<DeductionFileRead> {
  const dec = decodeXml(bytes);
  if (!dec.ok) return { readings: [], issues: [dec.reason] };
  const res = deductionProposals(dec.text);
  if (res.proposals.length === 0) return { readings: [], issues: res.issues };
  const file = { sha256: await fileDigest(bytes), bytes: bytes.length };
  const readings: DocumentReading[] = [];
  const issues = [...res.issues];
  for (const p of res.proposals) {
    const r = readProposal(p.raw, { ...ctx, via: "reader", reader: { ...DEDUCTION_XML_READER }, file });
    issues.push(...r.issues.filter((x) => x !== "読める候補がありませんでした"));
    if (r.reading !== null) readings.push({ ...r.reading, dropped: r.reading.dropped + p.masked });
  }
  return { readings, issues: [...new Set(issues)] };
}
