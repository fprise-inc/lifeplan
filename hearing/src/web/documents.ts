// Web のヒアリング（0125・0190）で、お客さまに送ってもらう書類の一覧（公式のひな形）と、受け付ける形・大きさの上限。
// - 書類ごとに、何のためか（purpose）・どこが写っていればよいか（where）の短い説明を持つ。説明は FP が依頼ごとに直せる（直した文が問いと一緒に届く）
// - 番号類（マイナンバー・基礎年金番号・証券番号・口座番号）は写さない・隠してもらう（0012）。撮る前の注意に必ず出す（言い方は HIDE_NUMBERS にそろえる）
// - 書類の持ち主（0190）: 人の書類（源泉徴収票など）は FP が「ご本人」「配偶者の方」を選ぶ。預貯金などは選んでも選ばなくてもよい（選ばなければご家族まとめて）
// - 書類で分かる問い（covers。0190）: その書類を頼むと、お客さまの画面にはその問いを出さない（「手元にない」を選んだときだけ、書類の画面で出す）。
//   書類から FP が見て打てる数字だけを挙げる（書類に載っていない数字・計算しないと出ない数字は挙げない）
// - 入力の画面の「書類待ち」の書類の名前（app の checkDocuments.ts）から、どのひな形に当たるかを docForCheck で引く

/** 公式の書類のひな形の ID */
export type DocumentKind =
  | "withholding"
  | "payslip"
  | "bonusSlip"
  | "taxReturn"
  | "companyAccounts"
  | "residentTaxNotice"
  | "retirementRules"
  | "pensionNotice"
  | "pensionAmountNotice"
  | "dcNotice"
  | "deposits"
  | "securities"
  | "investStatement"
  | "insurancePolicy"
  | "insuranceDeduction"
  | "loanSchedule"
  | "otherLoanSchedule"
  | "propertyTax"
  | "rentalContract"
  | "householdBook"
  | "other";

/** 書類の持ち主（ヒアリングの大人の繰り返しの番号: ご本人 1・配偶者の方 2） */
export type DocumentOwner = "self" | "spouse";
export const DOCUMENT_OWNERS: readonly DocumentOwner[] = ["self", "spouse"];
export const OWNER_INDEX: Readonly<Record<DocumentOwner, number>> = { self: 1, spouse: 2 };
/** FP の画面の呼び方（見出しの括弧の中） */
export const OWNER_LABEL: Readonly<Record<DocumentOwner, string>> = { self: "ご本人", spouse: "配偶者の方" };
/** お客さまの画面の呼び方（「ご本人さまの源泉徴収票」） */
export const OWNER_CUSTOMER: Readonly<Record<DocumentOwner, string>> = { self: "ご本人さま", spouse: "配偶者の方" };

/**
 * 誰の書類か: person は持ち主を選ぶ（選ばないと、人ごとの問いを書類で分かるものにしない）、
 * either は選んでも選ばなくてもよい（選ばなければご家族まとめての書類）、household は選ばない（住まい・保険・家計の書類）
 */
export type DocumentWhose = "person" | "either" | "household";

export interface DocumentTemplate {
  readonly kind: DocumentKind;
  readonly title: string;
  readonly purpose: string;
  /** どこが写っていればよいか */
  readonly where: string;
  readonly whose: DocumentWhose;
  /** この書類で隠してよい番号（撮る前の注意。無ければ番号の一般の注意） */
  readonly hide?: string;
  /** この書類で分かる問い（項目キー。簡易の票・詳細の票の両方。選んだ項目だけに効く。範囲の項目は元の金額の項目に付いてくる） */
  readonly covers: readonly string[];
  /** お客さまの画面の言葉（「お給料の額は、この書類の数字を使います」）: 何の（noun）・何を（aspect） */
  readonly topic?: { readonly noun: string; readonly aspect: "額" | "内容" };
}

const PENSION_KEYS = ["hs.pension.notice.type", "hs.pension.notice.asOf", "hs.pension.amount.basic", "hs.pension.amount.employee"];
const POLICY_KEYS = ["hs.insurance.type", "hs.insurance.policyholder", "hs.insurance.insured", "hs.insurance.contractDate", "hs.insurance.premium", "hs.insurance.frequency", "hs.insurance.payUntilAge", "hs.insurance.deathBenefit", "hs.insurance.monthlyBenefit"];

/** 公式の書類のひな形（並びは FP の画面の一覧の順: 収入・年金・貯蓄・保険・住まい・家計・その他） */
export const DOCUMENT_TEMPLATES: readonly DocumentTemplate[] = [
  { kind: "withholding", title: "源泉徴収票", purpose: "年収と、給与から引かれている税・社会保険料を正しく計算するため", where: "「支払金額」と「社会保険料等の金額」の欄", whose: "person", hide: "マイナンバー（個人番号）", covers: ["hs.income.annual", "hs.income.salary"], topic: { noun: "お給料", aspect: "額" } },
  { kind: "payslip", title: "給与明細（最近の1か月分）", purpose: "毎月の手取りと、引かれているものを確かめるため", where: "総支給額・健康保険・厚生年金・住民税の欄", whose: "person", covers: [] },
  { kind: "bonusSlip", title: "賞与の明細（この1年分）", purpose: "賞与（ボーナス）の額を確かめるため", where: "総支給額（額面）の欄。夏と冬など、1年分すべて", whose: "person", covers: ["hs.income.bonus"], topic: { noun: "賞与", aspect: "額" } },
  { kind: "taxReturn", title: "確定申告書と決算書の控え", purpose: "事業の所得と、申告の仕方（青色・白色）を確かめるため", where: "確定申告書の1枚目の所得金額の欄と、青色申告決算書（または収支内訳書）の1枚目", whose: "person", hide: "マイナンバー（個人番号）", covers: ["hs.income.annual", "hs.income.business", "hs.income.taxReturn"], topic: { noun: "事業の所得", aspect: "額" } },
  { kind: "companyAccounts", title: "会社の決算書（会社役員の方）", purpose: "会社とのお金の貸し借りを確かめるため", where: "貸借対照表（役員への貸付金・役員からの借入金の行）", whose: "person", covers: ["hs.company.loanToCompany", "hs.company.loanFromCompany"], topic: { noun: "会社とのお金の貸し借り", aspect: "額" } },
  { kind: "residentTaxNotice", title: "住民税の決定通知書", purpose: "住民税の額を確かめるため", where: "年税額の欄", whose: "person", hide: "マイナンバー（個人番号）", covers: ["hs.income.residentTax"], topic: { noun: "住民税", aspect: "額" } },
  { kind: "retirementRules", title: "退職金規程・制度の資料", purpose: "退職金の見込みを計算するため", where: "退職金の計算の仕方か、見込み額の分かる所", whose: "person", covers: ["hs.retirement.lumpSum"], topic: { noun: "退職金", aspect: "額" } },
  { kind: "pensionNotice", title: "ねんきん定期便", purpose: "将来の年金の見込みを計算するため", where: "加入期間の合計と、年金の額（50歳以上の方は見込額）の欄", whose: "person", hide: "基礎年金番号・照会番号", covers: [...PENSION_KEYS, "hs.pension.months.total", "hs.pension.months.employee"], topic: { noun: "年金", aspect: "額" } },
  { kind: "pensionAmountNotice", title: "年金額改定通知書", purpose: "いま受け取っている年金の額を確かめるため（年金を受け取っている方）", where: "基礎年金と厚生年金の年金額の欄", whose: "person", hide: "基礎年金番号", covers: PENSION_KEYS, topic: { noun: "年金", aspect: "額" } },
  { kind: "dcNotice", title: "企業型DC（確定拠出年金）のお知らせ", purpose: "企業型DC の残高を確かめるため", where: "資産の評価額（残高）と掛金の欄（画面の写しでもかまいません）", whose: "person", covers: ["hs.assets.corporateDc"], topic: { noun: "企業型DC", aspect: "額" } },
  { kind: "deposits", title: "預貯金の残高の分かるもの（通帳・ネットバンクの画面）", purpose: "いまの預貯金の額を確かめるため", where: "最近の残高の欄（画面の写しでもかまいません）", whose: "either", hide: "口座番号", covers: ["hs.assets.depositTotal", "hs.assets.deposit"], topic: { noun: "預貯金", aspect: "額" } },
  { kind: "securities", title: "証券口座の残高の分かるもの", purpose: "株・投資信託のいまの額を確かめるため", where: "口座の評価額（時価）の合計の欄（画面の写しでもかまいません）", whose: "either", hide: "口座番号", covers: ["hs.assets.taxable"], topic: { noun: "株・投資信託", aspect: "額" } },
  { kind: "investStatement", title: "iDeCo・NISA の残高の分かるもの", purpose: "いまの残高と毎月の積立額を確かめるため", where: "評価額（時価）と毎月の積立額（掛金）の欄（画面の写しでもかまいません）", whose: "either", hide: "口座番号", covers: ["hs.assets.nisa", "hs.assets.nisaMonthly", "hs.assets.ideco", "hs.assets.idecoMonthly"], topic: { noun: "NISA・iDeCo", aspect: "額" } },
  { kind: "insurancePolicy", title: "保険証券（加入している保険のすべて）", purpose: "いまの保障の額と保険料を確かめるため", where: "保険の種類・保険金額・保険料・払込の期間の欄", whose: "household", hide: "証券番号", covers: ["hs.insurance.premiumTotal", ...POLICY_KEYS], topic: { noun: "保険", aspect: "内容" } },
  { kind: "insuranceDeduction", title: "生命保険料控除証明書", purpose: "保険証券が手元に無いときに、入っている保険と保険料を確かめるため", where: "保険の種類と、1年間の保険料の欄", whose: "either", hide: "証券番号", covers: [] },
  { kind: "loanSchedule", title: "住宅ローンの返済予定表", purpose: "いまの残高と金利、これからの返済を計算するため", where: "いまの残高・金利・毎月の返済額・最後の返済の年月の欄", whose: "household", covers: ["hs.loan.monthlyTotal", "hs.loan.balanceTotal", "hs.loan.principal", "hs.loan.start", "hs.loan.termYears", "hs.loan.rate", "hs.loan.method", "hs.loan.balance"], topic: { noun: "住宅ローン", aspect: "額" } },
  { kind: "otherLoanSchedule", title: "ほかのローンの返済予定表（自動車ローン・教育ローンなど）", purpose: "住宅ローンのほかの借入の残高と返済を確かめるため", where: "いまの残高・毎月の返済額・最後の返済の年月の欄", whose: "household", covers: [] },
  { kind: "propertyTax", title: "固定資産税の納税通知書（課税明細書）", purpose: "住まいにかかる税を計算するため", where: "年税額（固定資産税と都市計画税）の欄", whose: "household", covers: ["hs.housing.propertyTax"], topic: { noun: "固定資産税", aspect: "額" } },
  { kind: "rentalContract", title: "賃貸の契約書（家賃の分かるもの）", purpose: "家賃と更新の費用を確かめるため（社宅の方は自己負担の分かるもの）", where: "賃料・管理費（共益費）・更新料の欄", whose: "household", covers: ["hs.housing.rent"], topic: { noun: "家賃", aspect: "額" } },
  { kind: "householdBook", title: "家計簿かカードの明細（最近の数か月分）", purpose: "毎月の生活費の目安を確かめるため（任意）", where: "月ごとの支出の合計が分かる所", whose: "household", hide: "カード番号", covers: [] },
  { kind: "other", title: "", purpose: "", where: "", whose: "either", covers: [] },
];

export const templateOf = (kind: string | null): DocumentTemplate | undefined => (kind === null ? undefined : DOCUMENT_TEMPLATES.find((t) => t.kind === kind));

/** 入力の画面の「書類待ち」の書類の名前（checkDocuments.ts の値。ローンは「住宅ローンの返済予定表」などの言い分けも）→ ひな形 */
export function docForCheck(name: string): DocumentKind | null {
  if (name.includes("ねんきん定期便")) return "pensionNotice";
  if (name.includes("住宅ローン") && name.includes("返済予定表")) return "loanSchedule";
  if (name.includes("返済予定表")) return "otherLoanSchedule";
  if (name.includes("保険証券")) return "insurancePolicy";
  if (name.includes("住民税")) return "residentTaxNotice";
  if (name.includes("退職金")) return "retirementRules";
  return null;
}

/** 番号の注意（お客さまの最初の画面・書類の画面・FP の案内文で同じ言い方にする） */
export const HIDE_NUMBERS = "マイナンバー・基礎年金番号・証券番号・口座番号は、写さないか隠してください。";

/** 撮る前の注意（お客さまのページの書類の画面に出す）。番号の注意は書類ごと（hideTip） */
export const PHOTO_TIPS: readonly string[] = [
  "明るい所で、書類の全体が入るように、まっすぐ上から撮ってください。",
  "1枚に入りきらないときは、何枚かに分けてかまいません。",
  "書類のほかのもの（ご家族の写真など）が写らないようにしてください。",
];

/** その書類の番号の注意（隠してよい番号が決まっている書類はその番号、ほかは番号の一般の注意） */
export function hideTip(kind: string | null): string {
  const h = templateOf(kind)?.hide;
  return h === undefined ? HIDE_NUMBERS : `${h}は、写さないか隠してかまいません。`;
}

/** 受け付ける形（見出しのバイトで確かめる。名前・ブラウザの申告は信用しない）。SVG・HTML などは受け付けない */
export type DocumentMime = "image/jpeg" | "image/png" | "image/heic" | "application/pdf";

export const DOCUMENT_LIMITS = {
  /** 1つのファイル（縮めた後・暗号化する前） */
  fileBytes: 10 * 1024 * 1024,
  /** 1つの依頼の合計 */
  totalBytes: 40 * 1024 * 1024,
  /** 1つの依頼のファイルの数 */
  files: 20,
  /** 1通の書類に付けられるファイルの数 */
  filesPerDocument: 6,
  /** 写真を縮めるときの長い辺の画素 */
  photoMaxSide: 2000,
  /** 頼める書類の数 */
  documents: 15,
} as const;

/** ファイルの見出しのバイトから形を決める（受け付けない形は null） */
export function sniffMime(b: Uint8Array): DocumentMime | null {
  const at = (i: number) => b[i] ?? -1;
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 && at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a) return "image/png";
  if (at(0) === 0x25 && at(1) === 0x50 && at(2) === 0x44 && at(3) === 0x46 && at(4) === 0x2d) return "application/pdf";
  // HEIC・HEIF（ISO の箱 ftyp の銘柄）
  if (at(4) === 0x66 && at(5) === 0x74 && at(6) === 0x79 && at(7) === 0x70) {
    const brand = String.fromCharCode(at(8), at(9), at(10), at(11));
    if (["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"].includes(brand)) return "image/heic";
  }
  return null;
}

export const MIME_EXT: Readonly<Record<DocumentMime, string>> = { "image/jpeg": "jpg", "image/png": "png", "image/heic": "heic", "application/pdf": "pdf" };
