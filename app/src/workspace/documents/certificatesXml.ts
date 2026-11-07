// 保険料のほかの控除証明書の電子データ（マイナポータル連携の XML）の読み手（0154 の1）。deductionXml.ts の読み手から、証明書の種類ごとに呼ばれる。
// このパソコンの中だけで読み、外へ送らない。公的な仕様（年末調整のソフトが取り込む形）に合わせて、次の証明書を読む:
// - 国民年金保険料等控除証明書: 国民年金保険料（アプリが計算するので照合だけの値）・国民年金基金の掛金（今の国民年金基金の掛金の欄へ）
// - 小規模企業共済等掛金控除証明書: 小規模企業共済・iDeCo の口座（新しい物の候補。今ある口座にも当てられる）と毎月の掛金
// - 住宅取得資金に係る借入金の年末残高等証明書（金融機関の証明書）: 住宅ローン（新しい物の候補。今あるローンにも当てられる）の残高・時点・借入額・借りた年月・完済の年月・名義
// - 年末調整のための住宅借入金等特別控除証明書（税務署の証明書。居住の年ごとの版）: 住宅ローンの入居の年月・住宅の種類・新築か中古か・年末残高（調書の方式の版だけ）
// 読まない（木に入れずに捨てる）: 氏名・住所・郵便番号・基礎年金番号・共済契約者番号・整理番号・お問い合わせ番号・ユニークコード・法人番号・事業免許番号・
// 債権者の所在地と連絡先・借入の番号・連帯債務者の名前・備考・その他の文。出す形は書類の候補の答え（document-candidates@1）で、読み口 readProposal を通す
import { PROPOSAL_CONTRACT, type DocType } from "./types.ts";
import { childOf, findFirst, textOf, type XmlElement } from "./xml.ts";
import { amountOf, countOf, dateOf, dateText, kubunOf, shortIn, yearOf, ym, type Count, type Ymd } from "./xmlValues.ts";

type Raw = Record<string, unknown>;

/** 証明書1通の答え（読み口が受ける形）と、読み手が番号らしい所を消した数 */
export interface CertificateAnswer {
  docType: DocType;
  raw: Raw;
  /** 新しい物の候補の数（ローン・口座。契約の数として画面に出す） */
  contracts: number;
  masked: number;
}

export const PENSION_PREMIUM = "TEG840";
export const MUTUAL_AID = "TEG850";
export const LOAN_BALANCE = "TEG900";

/** 年末調整のための住宅借入金等特別控除証明書の版ごとの札（接頭辞・居住開始年月日〔新築等・増改築等〕・住宅の区分等・年末残高・備考・適用種別） */
interface CreditForm {
  p: string;
  moveIn: readonly [string, string];
  kubun: readonly string[];
  balance: readonly string[];
  remarks: string | null;
  app: string;
}
export const LOAN_CREDIT_FORMS: Readonly<Record<string, CreditForm>> = {
  // 平成31年〜令和3年の居住（特定増改築等を含む）
  TEG910: { p: "WK", moveIn: ["WKI00270", "WKI00420"], kubun: [], balance: [], remarks: null, app: "WKI00210" },
  TEG916: { p: "WU", moveIn: ["WUI00270", "WUI00420"], kubun: [], balance: [], remarks: null, app: "WUI00210" },
  // 令和4年以降の居住
  TEG911: { p: "WR", moveIn: ["WRI00270", "WRI00420"], kubun: ["WRI00480", "WRI00490", "WRI00500"], balance: [], remarks: null, app: "WRI00210" },
  TEG917: { p: "WW", moveIn: ["WWI00270", "WWI00420"], kubun: ["WWI00480", "WWI00490", "WWI00500"], balance: [], remarks: null, app: "WWI00210" },
  // 令和5年以降の居住（年末残高の情報がある）
  TEG912: { p: "WT", moveIn: ["WTI00300", "WTI00450"], kubun: ["WTI00500"], balance: ["WTI00520", "WTI00530", "WTI00540"], remarks: "WTI00550", app: "WTI00240" },
  TEG918: { p: "WX", moveIn: ["WXI00300", "WXI00450"], kubun: ["WXI00500"], balance: ["WXI00520", "WXI00530", "WXI00540"], remarks: "WXI00550", app: "WXI00240" },
  // 令和6年以降の居住（年末残高の情報がある）
  TEG913: { p: "WV", moveIn: ["WVI00300", "WVI00450"], kubun: ["WVI00510", "WVI00520"], balance: ["WVI00540", "WVI00550", "WVI00560"], remarks: "WVI00570", app: "WVI00240" },
  TEG919: { p: "WY", moveIn: ["WYI00300", "WYI00450"], kubun: ["WYI00510", "WYI00520"], balance: ["WYI00540", "WYI00550", "WYI00560"], remarks: "WYI00570", app: "WYI00240" },
};

/**
 * 読まない要素（parseXml の skip。中身を木に入れない）。
 * 国民年金保険料等: 基礎年金番号等・被保険者氏名・被保険者住所・その他特記事項・発行団体・ユニークコード。
 * 小規模企業共済等: 氏名・住所・共済契約者番号／基礎年金番号・備考（全体と月ごと）・ユニークコード。
 * 年末残高等: 借入れ等をしている者（住所・氏名）・連帯債務者名・債権者の所在地・事業免許番号等・参考事項（法人番号・支店名・連絡先・番号・発行回数・その他）。
 * 住宅借入金等特別控除: あて名（郵便番号・住所・氏名）・税務署長名・整理番号／お問い合わせ番号・備考
 */
export const CERTIFICATE_SKIPPED: readonly string[] = [
  "WOD00000",
  "WOE00000",
  "WOF00000",
  "WOP00000",
  "WOS00000",
  "WOT00000",
  "WPC00000",
  "WPD00000",
  "WPE00000",
  "WPM00000",
  "WPP00000",
  ...Array.from({ length: 12 }, (_, i) => `WPL${String(30 + i * 30).padStart(5, "0")}`),
  "WIA00010",
  "WIA00190",
  "WIA00200",
  "WIA00210",
  "WIA00220",
  "WIA00230",
  "WIB00010",
  "WIB00030",
  "WIC00000",
  ...Object.values(LOAN_CREDIT_FORMS).flatMap((f) => [`${f.p}D00010`, `${f.p}D00090`, `${f.p}D00130`, `${f.p}D00160`, `${f.p}D00170`, `${f.p}G00000`, ...(f.remarks !== null ? [f.remarks] : [])]),
];

const sum = (xs: readonly (number | null)[]): number | null => (xs.some((x) => x !== null) ? xs.reduce<number>((n, x) => n + (x ?? 0), 0) : null);

// ---- 国民年金保険料等控除証明書 ----

/**
 * 種別1（国民年金保険料）はアプリが加入の状態から計算するので照合だけの値（その年の社会保険料の国民年金の行と比べる）。
 * 種別2（国民年金基金の掛金）は今の国民年金基金の掛金の欄（月額）の候補と、照合だけの値。前納は1年分と限らないので照合だけ
 */
export function pensionPremiumAnswer(cert: XmlElement): CertificateAnswer {
  const count: Count = { masked: 0 };
  const short = shortIn(count);
  const kind = kubunOf(childOf(cert, "WOA00000"));
  const prepaid = kubunOf(childOf(cert, "WOB00000")).code === "2";
  const year = yearOf(childOf(cert, "WOC00000"));
  const total = amountOf(childOf(cert, "WOM00000")) ?? sum([amountOf(childOf(cert, "WOK00000")), amountOf(childOf(cert, "WOL00000"))]);
  const issuer = short(textOf(childOf(cert, "WOR00000")), 40);
  const certDate = dateOf(childOf(cert, "WOQ00000"));
  const fund = kind.code === "2" || (kind.code === null && /基金/u.test(kind.name));
  const pension = kind.code === "1" || (kind.code === null && /国民年金保険料/u.test(kind.name));
  const values: Raw[] = [];
  const references: Raw[] = [];
  const yearText = year !== null ? `${year}年` : "証明の年";
  const where = "社会保険料の納付済額・見込額の合計";
  if (total !== null) {
    if (pension)
      references.push({ label: prepaid ? "国民年金保険料（前納の額を含む）" : `国民年金保険料（${yearText}の納付額）`, amount: total, ...(!prepaid && year !== null ? { row: "cf.taxSi.pension", year } : {}), source: { where, path: `${PENSION_PREMIUM}/WOM00000` } });
    else if (fund)
      references.push({ label: prepaid ? "国民年金基金の掛金（前納の額を含む）" : `国民年金基金の掛金（${yearText}の納付額）`, amount: total, ...(!prepaid && year !== null ? { row: "cf.taxSi.pension.fund", year } : {}), source: { where, path: `${PENSION_PREMIUM}/WOM00000` } });
    else references.push({ label: `社会保険料（${short(kind.name, 20) || "その他"}・${yearText}）`, amount: total, source: { where, path: `${PENSION_PREMIUM}/WOM00000` } });
  }
  if (fund && !prepaid && total !== null && total > 0) {
    const even = total % 12 === 0;
    values.push({
      item: "retirementBenefit.contributions",
      at: ["monthly"],
      member: "holder",
      value: even ? total / 12 : total,
      period: even ? "monthly" : "annual",
      source: { where, ...(issuer !== "" ? { text: issuer } : {}), path: `${PENSION_PREMIUM}/WOM00000` },
      confidence: "medium",
      note: even ? `${yearText}の納付済額と見込額の合計を12で割った月額です（加入の口数を変えた年は月ごとに違います）` : `${yearText}の納付済額と見込額の合計（年額）です。12で割り切れないので、月額に直して入れてください`,
    });
  }
  const raw: Raw = { contract: PROPOSAL_CONTRACT, docType: "pensionPremiumDeduction", values, references };
  if (certDate !== null) raw.asOf = ym(certDate);
  return { docType: "pensionPremiumDeduction", raw, contracts: 0, masked: count.masked };
}

// ---- 小規模企業共済等掛金控除証明書 ----

/** 月ごとの掛金の札（iDeCo。1月〜12月の金額） */
const IDECO_MONTHS = Array.from({ length: 12 }, (_, i) => `WPL${String(20 + i * 30).padStart(5, "0")}`);

/**
 * 掛金の種別1（小規模企業共済）・2（iDeCo）ごとに、新しい口座の候補（今ある口座に当ててもよい）と、名義・毎月の掛金・加入の年月。
 * 控除の合計額は照合だけの値
 */
export function mutualAidAnswer(cert: XmlElement, issues: string[]): CertificateAnswer | null {
  const count: Count = { masked: 0 };
  const short = shortIn(count);
  const kind = kubunOf(childOf(cert, "WPB00000"));
  const ideco = kind.code === "2" || (kind.code === null && /確定拠出|iDeCo|ｉＤｅＣｏ/iu.test(kind.name));
  const mutual = kind.code === "1" || (kind.code === null && /小規模企業共済/u.test(kind.name));
  if (!ideco && !mutual) {
    issues.push("小規模企業共済等掛金控除証明書の掛金の種別が読めません");
    return null;
  }
  const year = yearOf(childOf(cert, "WPF00000")) ?? yearOf(childOf(cert, "WPA00000"));
  const total = amountOf(childOf(cert, "WPI00000"));
  const issuer = short(textOf(childOf(cert, "WPO00000")), 40);
  const certDate = dateOf(childOf(cert, "WPN00000"));
  const key = "a1";
  const kindName = ideco ? "iDeCo（個人型確定拠出年金）" : "小規模企業共済";
  const objects: Raw[] = [{ key, kind: ideco ? "account:ideco" : "account:smallBusinessMutualAid", source: { where: "掛金種別", text: [kindName, issuer].filter((x) => x !== "").join("・"), path: `${MUTUAL_AID}/WPB00000` }, confidence: "high" }];
  const values: Raw[] = [{ item: "account.owner", newObject: key, value: "holder", source: { where: "氏名" }, confidence: "medium", note: "氏名は読んでいません。書類の名義の人（控除を受ける人）にしています" }];
  let monthly: { value: number; confidence: "high" | "medium"; where: string; path: string; note?: string } | null = null;
  if (mutual) {
    const m = amountOf(findFirst(cert, "WPK00020"));
    if (m !== null && m > 0) monthly = { value: m, confidence: "high", where: "小規模企業共済掛金に関する事項・掛金月額", path: `${MUTUAL_AID}/WPK00000/WPK00020` };
    const since = dateOf(findFirst(cert, "WPK00010"));
    if (since !== null) values.push({ item: "account.enrolledSince", newObject: key, value: ym(since), source: { where: "契約年月日", text: `契約年月日 ${dateText(since)}`, path: `${MUTUAL_AID}/WPK00000/WPK00010` }, confidence: "high" });
  } else {
    // 月ごとの掛金: いちばん後の月の額（月ごとに違えば確からしさは中）
    const amounts = IDECO_MONTHS.map((t) => amountOf(findFirst(cert, t)));
    const paid = amounts.flatMap((a, i) => (a !== null && a > 0 ? [{ a, i }] : []));
    const last = paid.at(-1);
    if (last !== undefined) {
      const same = paid.every((x) => x.a === last.a);
      monthly = {
        value: last.a,
        confidence: same ? "high" : "medium",
        where: `個人型確定拠出年金に関する事項・${last.i + 1}月`,
        path: `${MUTUAL_AID}/WPL00000/${IDECO_MONTHS[last.i] as string}`,
        ...(same ? {} : { note: `月ごとの掛金が違います（いちばん後の${last.i + 1}月の額にしています）。年単位の拠出なら、毎月の積立の額を直してください` }),
      };
    }
  }
  if (monthly === null && total !== null && total > 0 && total % 12 === 0)
    monthly = { value: total / 12, confidence: "medium", where: "控除合計額", path: `${MUTUAL_AID}/WPI00000`, note: "控除の合計額を12で割った月額です（1年分の掛金かを確かめてください）" };
  values.push(
    monthly !== null
      ? { item: "account.contributions", newObject: key, value: monthly.value, period: "monthly", source: { where: monthly.where, path: monthly.path }, confidence: monthly.confidence, ...(monthly.note !== undefined ? { note: monthly.note } : {}) }
      : { item: "account.contributions", newObject: key, value: null, unreadable: true, period: "monthly", source: { where: "掛金月額" }, confidence: "low" },
  );
  const references: Raw[] = total !== null ? [{ label: `${ideco ? "iDeCo" : "小規模企業共済"}の掛金の控除の額（${year !== null ? `${year}年` : "証明の年"}）`, amount: total, source: { where: "控除合計額", path: `${MUTUAL_AID}/WPI00000` } }] : [];
  const raw: Raw = { contract: PROPOSAL_CONTRACT, docType: "smallBusinessMutualAidDeduction", objects, values, references };
  if (certDate !== null) raw.asOf = ym(certDate);
  return { docType: "smallBusinessMutualAidDeduction", raw, contracts: 1, masked: count.masked };
}

// ---- 住宅取得資金に係る借入金の年末残高等証明書（金融機関） ----

const LOAN_PARTS: Readonly<Record<string, string>> = { "1": "住宅のみ", "2": "土地等のみ", "3": "住宅及び土地等" };

/** 年数と月数 → 完済の年月（借りた年月から）。読めなければ null */
const addYm = (from: Ymd, months: number): string => {
  const n = from.y * 12 + (from.m - 1) + months;
  return ym({ y: Math.floor(n / 12), m: (n % 12) + 1 });
};

/**
 * 明細ごとに、新しい住宅ローンの候補（今あるローンに当ててもよい）と、残高・残高の時点・借入額・借りた年月・完済の年月（返済期間の欄）・名義。
 * 家屋の取得の対価の額は照合だけの値（控除の取得対価の欄は、控除を受けるときだけ出る）
 */
export function loanBalanceAnswer(cert: XmlElement, issues: string[]): CertificateAnswer | null {
  const count: Count = { masked: 0 };
  const short = shortIn(count);
  const body = childOf(cert, "WIA00000") ?? cert;
  const details = body.children.filter((c) => c.name === "WIA00040");
  if (details.length === 0) {
    issues.push("住宅取得資金に係る借入金の年末残高等証明書に、借入の明細がありません");
    return null;
  }
  const creditor = short(textOf(findFirst(cert, "WIB00020")), 40);
  const objects: Raw[] = [];
  const values: Raw[] = [];
  const references: Raw[] = [];
  let certDate: Ymd | null = null;
  details.slice(0, 10).forEach((d, i) => {
    const key = `l${i + 1}`;
    const p = `${LOAN_BALANCE}/WIA00040.${i + 1}`;
    const part = kubunOf(childOf(d, "WIA00050"));
    const partText = LOAN_PARTS[part.code ?? ""] ?? short(part.name, 20);
    certDate ??= dateOf(childOf(d, "WIA00300"));
    objects.push({ key, kind: "debt:mortgage", source: { where: "住宅借入金等の内訳", text: [creditor !== "" ? `${creditor} 住宅ローン` : "住宅ローン", partText !== "" ? `（${partText}）` : ""].join(""), path: `${p}/WIA00050` }, confidence: "high" });
    const balance = amountOf(findFirst(d, "WIA00070"));
    values.push(
      balance !== null
        ? { item: "debt.balance", newObject: key, value: balance, period: "once", source: { where: "住宅借入金等の金額・年末残高", path: `${p}/WIA00060/WIA00070` }, confidence: "high" }
        : { item: "debt.balance", newObject: key, value: null, unreadable: true, period: "once", source: { where: "年末残高", path: `${p}/WIA00060/WIA00070` }, confidence: "low" },
    );
    const asOf = dateOf(childOf(d, "WIA00290"));
    const asOfYear = asOf === null ? (yearOf(childOf(d, "WIA00300")) ?? null) : null;
    if (asOf !== null) values.push({ item: "debt.balanceAsOf", newObject: key, value: ym(asOf), source: { where: "残高基準日", text: `残高基準日 ${dateText(asOf)}`, path: `${p}/WIA00290` }, confidence: "high" });
    else if (asOfYear !== null) values.push({ item: "debt.balanceAsOf", newObject: key, value: `${asOfYear - 1}-12`, source: { where: "証明年月日" }, confidence: "medium", note: "残高基準日が無いので、証明の前の年の12月末にしています" });
    const principal = amountOf(findFirst(d, "WIA00100"));
    const started = dateOf(findFirst(d, "WIA00090"));
    if (principal !== null) values.push({ item: "debt.principal", newObject: key, value: principal, period: "once", source: { where: "当初金額", path: `${p}/WIA00080/WIA00100` }, confidence: "high" });
    if (started !== null) values.push({ item: "debt.start", newObject: key, value: ym(started), source: { where: "当初借入年月日", text: `当初借入年月日 ${dateText(started)}`, path: `${p}/WIA00080/WIA00090` }, confidence: "high" });
    // 返済期間の欄: 今の残高から入れるローン（書類から足したローン）は「完済の年月」の欄。償還期間（至）の年月で入れる。無ければ借りた年月＋年数・月数
    const to = dateOf(findFirst(d, "WIA00130"));
    const years = countOf(findFirst(d, "WIA00140"));
    const months = countOf(findFirst(d, "WIA00150")) ?? 0;
    const termText = years !== null ? `償還期間 ${years}年${months}か月` : null;
    if (to !== null) values.push({ item: "debt.repayment", at: ["termMonths"], newObject: key, value: ym(to), source: { where: "償還期間又は賦払期間（至）", text: [`至 ${to.y}年${to.m}月`, termText].filter((x) => x !== null).join("・"), path: `${p}/WIA00110/WIA00130` }, confidence: "high", note: "完済の年月です（返済期間を年で入れる欄なら、償還期間の年数で直してください）" });
    else if (years !== null && started !== null) values.push({ item: "debt.repayment", at: ["termMonths"], newObject: key, value: addYm(started, years * 12 + months), source: { where: "償還期間又は賦払期間", text: termText ?? undefined, path: `${p}/WIA00110/WIA00140` }, confidence: "medium", note: "当初借入年月日に償還期間を足した、完済の年月です" });
    else if (years !== null) issues.push("償還期間の年数はありますが、借りた年月が無いので完済の年月にできません（返済期間の欄で入れてください）");
    const joint = kubunOf(findFirst(d, "WIA00180")).code === "1";
    values.push(
      joint
        ? { item: "debt.debtors", newObject: key, value: "joint", source: { where: "連帯債務者", text: "連帯債務者 有" }, confidence: "medium", note: "連帯債務の記載があります。夫婦で連帯債務にしています（負担の割合は欄で確かめてください）" }
        : { item: "debt.debtors", newObject: key, value: "holder", source: { where: "住宅取得資金の借入れ等をしている者" }, confidence: "medium", note: "氏名は読んでいません。書類の名義の人の名義にしています" },
    );
    const cost = amountOf(childOf(d, "WIA00160"));
    if (cost !== null) references.push({ label: "家屋の取得の対価等の額", amount: cost, source: { where: "居住用家屋の取得の対価等の額", path: `${p}/WIA00160` } });
  });
  if (details.length > 10) issues.push("借入の明細が多すぎるので、先の10件だけ読みました");
  const raw: Raw = { contract: PROPOSAL_CONTRACT, docType: "housingLoanBalance", objects, values, references };
  const cd = certDate as Ymd | null;
  if (cd !== null) raw.asOf = ym(cd);
  return { docType: "housingLoanBalance", raw, contracts: objects.length, masked: count.masked };
}

// ---- 年末調整のための住宅借入金等特別控除証明書（税務署） ----

/** 住宅の区分等・適用種別の言葉 → 住宅の種類（控除）。当たらなければ null */
function propertyTypeOf(kubun: string, app: string): { value: string; confidence: "high" | "medium" } | null {
  const k = kubun.normalize("NFKC");
  if (/認定住宅/u.test(k)) return { value: "certified", confidence: "high" };
  if (/ZEH/iu.test(k)) return { value: "zeh", confidence: "high" };
  if (/省エネ基準適合/u.test(k)) return { value: "energySaving", confidence: "high" };
  const a = app.normalize("NFKC");
  if (k === "" && /認定住宅用/u.test(a) && !/認定住宅等/u.test(a)) return { value: "certified", confidence: "medium" };
  if (k === "" && /中居住者用/u.test(a) && !/認定|特例|震災/u.test(a)) return { value: "other", confidence: "medium" };
  return null;
}

/**
 * 明細ごとに、住宅ローンの候補（ふつうは今あるローンに当てる）と、入居の年月（控除）・住宅の種類・新築か中古か・年末残高（調書の方式の版だけ）
 */
export function loanCreditAnswer(cert: XmlElement, form: CreditForm, issues: string[]): CertificateAnswer | null {
  const count: Count = { masked: 0 };
  const short = shortIn(count);
  const p0 = cert.name;
  const details = cert.children.filter((c) => c.name === `${form.p}I00000`);
  if (details.length === 0) {
    issues.push("住宅借入金等特別控除証明書に、明細がありません");
    return null;
  }
  const issued = dateOf(findFirst(cert, `${form.p}D00150`)) ?? dateOf(findFirst(cert, `${form.p}D00140`));
  const yearEnd = yearOf(childOf(cert, `${form.p}H00000`)) ?? yearOf(childOf(cert, `${form.p}B00000`));
  const objects: Raw[] = [];
  const values: Raw[] = [];
  details.slice(0, 4).forEach((d, i) => {
    const key = `l${i + 1}`;
    const p = `${p0}/${form.p}I00000.${i + 1}`;
    const app = short(textOf(findFirst(d, form.app)), 40);
    const kubun = form.kubun.map((t) => textOf(findFirst(d, t))).join("");
    objects.push({ key, kind: "debt:mortgage", source: { where: "適用種別", ...(app !== "" ? { text: app } : {}), path: `${p}/${form.app}` }, confidence: "medium" });
    const moveIn = dateOf(findFirst(d, form.moveIn[0])) ?? dateOf(findFirst(d, form.moveIn[1]));
    values.push(
      moveIn !== null
        ? { item: "debt.housing", newObject: key, value: ym(moveIn), source: { where: "居住開始年月日", text: `居住開始年月日 ${dateText(moveIn)}`, path: `${p}/${form.moveIn[0]}` }, confidence: "high" }
        : { item: "debt.housing", newObject: key, value: null, unreadable: true, source: { where: "居住開始年月日" }, confidence: "low" },
    );
    const kubunText = short(kubun, 40);
    const pt = propertyTypeOf(kubun, app);
    if (pt !== null) values.push({ item: "debt.housing", at: ["propertyType"], newObject: key, value: pt.value, source: { where: kubun !== "" ? "住宅の区分等" : "適用種別", text: kubun !== "" ? kubunText : app, path: `${p}/${form.kubun[0] ?? form.app}` }, confidence: pt.confidence });
    const k = kubun.normalize("NFKC");
    const build = /中古住宅/u.test(k) ? "used" : /新築|買取再販/u.test(k) ? "new" : null;
    if (build !== null) values.push({ item: "debt.housing", at: ["newBuild"], newObject: key, value: build, source: { where: "住宅の区分等", text: kubunText, path: `${p}/${form.kubun[0] as string}` }, confidence: "high" });
    const balance = sum(form.balance.map((t) => amountOf(findFirst(d, t))));
    if (balance !== null && balance > 0) {
      values.push({ item: "debt.balance", newObject: key, value: balance, period: "once", source: { where: "住宅借入金等の年末残高に関する事項", path: `${p}/${form.balance[0] as string}` }, confidence: "medium", note: "金融機関から税務署に届いた年末残高（見込み）の合計です。住宅のみ・土地等のみ・住宅及び土地等の分を足しています" });
      if (yearEnd !== null) values.push({ item: "debt.balanceAsOf", newObject: key, value: `${yearEnd}-12`, source: { where: "年末調整年分" }, confidence: "medium", note: "年末調整の年の12月末の残高としています" });
    }
  });
  if (details.length > 4) issues.push("明細が多すぎるので、先の4件だけ読みました");
  const raw: Raw = { contract: PROPOSAL_CONTRACT, docType: "housingLoanCredit", objects, values, references: [] };
  if (issued !== null) raw.asOf = ym(issued);
  return { docType: "housingLoanCredit", raw, contracts: objects.length, masked: count.masked };
}
