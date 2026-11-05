// Web のヒアリング（0125）で、お客さまに送ってもらう書類の一覧（公式のひな形）と、受け付ける形・大きさの上限。
// - 書類ごとに、何のためか（purpose）・どこを写せばよいか（where）の短い説明を持つ。説明は FP が依頼ごとに直せる（直した文が問いと一緒に届く）
// - 番号類（マイナンバー・基礎年金番号・証券番号・口座番号）は写さない・隠してもらう（0012）。撮る前の注意に必ず出す
// - 入力の画面の「書類待ち」の書類の名前（app の checkDocuments.ts）から、どのひな形に当たるかを docForCheck で引く

/** 公式の書類のひな形の ID */
export type DocumentKind = "withholding" | "pensionNotice" | "insurancePolicy" | "loanSchedule" | "propertyTax" | "payslip" | "taxReturn" | "investStatement" | "residentTaxNotice" | "retirementRules";

export interface DocumentTemplate {
  readonly kind: DocumentKind;
  readonly title: string;
  readonly purpose: string;
  readonly where: string;
}

export const DOCUMENT_TEMPLATES: readonly DocumentTemplate[] = [
  { kind: "withholding", title: "源泉徴収票", purpose: "年収と、給与から引かれている税・社会保険料を正しく計算するため", where: "「支払金額」「社会保険料等の金額」の欄が写るように" },
  { kind: "pensionNotice", title: "ねんきん定期便", purpose: "将来の年金の見込みを計算するため", where: "加入期間の合計と、年金の額（50歳以上の方は見込額）の欄が写るように" },
  { kind: "insurancePolicy", title: "保険証券", purpose: "いまの保障の額と保険料を確かめるため", where: "保険の種類・保険金額・保険料・払込の期間が写るように（証券番号は隠してかまいません）" },
  { kind: "loanSchedule", title: "住宅ローンの返済予定表", purpose: "いまの残高と金利、これからの返済を計算するため", where: "いまの残高・金利・毎月の返済額・最後の返済の年月が写るように" },
  { kind: "propertyTax", title: "固定資産税の通知書（課税明細書）", purpose: "住まいにかかる税を計算するため", where: "年税額（固定資産税と都市計画税）の欄が写るように" },
  { kind: "payslip", title: "給与明細（最近の1か月分）", purpose: "毎月の手取りと、引かれているものを確かめるため", where: "総支給額・健康保険・厚生年金・住民税の欄が写るように" },
  { kind: "taxReturn", title: "確定申告書の控え", purpose: "事業の所得を計算するため", where: "1枚目の所得金額の欄が写るように" },
  { kind: "investStatement", title: "iDeCo・NISA の残高の分かる物", purpose: "いまの残高と毎月の積立額を確かめるため", where: "評価額（時価）と毎月の積立額（掛金）が写るように（画面の写しでもかまいません）" },
  { kind: "residentTaxNotice", title: "住民税の決定通知書", purpose: "住民税の額を確かめるため", where: "年税額の欄が写るように" },
  { kind: "retirementRules", title: "会社の退職金規程・制度の資料", purpose: "退職金の見込みを計算するため", where: "退職金の計算の仕方か、見込み額の分かる所が写るように" },
];

export const templateOf = (kind: string): DocumentTemplate | undefined => DOCUMENT_TEMPLATES.find((t) => t.kind === kind);

/** 入力の画面の「書類待ち」の書類の名前（checkDocuments.ts の値。ローンは「住宅ローンの返済予定表」などの言い分けも）→ ひな形 */
export function docForCheck(name: string): DocumentKind | null {
  if (name.includes("ねんきん定期便")) return "pensionNotice";
  if (name.includes("返済予定表")) return "loanSchedule";
  if (name.includes("保険証券")) return "insurancePolicy";
  if (name.includes("住民税")) return "residentTaxNotice";
  if (name.includes("退職金")) return "retirementRules";
  return null;
}

/** 撮る前の注意（お客さまのページに出す） */
export const PHOTO_TIPS: readonly string[] = [
  "書類の全体が写るように、明るい所で、まっすぐ上から撮ってください。",
  "マイナンバー（個人番号）・基礎年金番号・証券番号・口座番号は、写さないか、紙やふせんで隠してください。",
  "1枚に写りきらないときは、何枚かに分けてかまいません。",
  "書類のほかのもの（ご家族の写真など）が写らないようにしてください。",
];

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
