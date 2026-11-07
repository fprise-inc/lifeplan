// 書類の読み取り（0148）の形: 書類から読んだ値を、現状にすぐ入れずに「候補」として持つ。
// - 読み手（FP の AI・貼り付けた AI の答え・架空の見本）は、どれも同じ形の候補を出す（proposal.ts の読み口を通る）
// - 読めるのは保険証券・ご契約内容のお知らせ・設計書だけ（0159）。前に読んだほかの書類の記録は捨てずに残し、見るだけにする
// - 候補は FP が承認するまで現状にもプランにも効かない。承認したら値の出どころ（取り込み・AI）と確かさ「書類で確認」、承認の記録を付けて現状へ（apply.ts）
// - 世帯ファイルでは本文の区画 documents に置く（形式の版 0.68 から。読んでいない世帯は区画ごと無い。明細の statements・移行の migrations と同じ置き方）
// - 持たないもの: 元のファイル・ファイル名・個人番号などの番号（読んだ時点で消す。privacy.ts）・名前・住所・伏せ字の前の文字

/** 区画の版（区画の中の形を変えるときに上げる。世帯ファイルの形式の版とは別） */
export const DOCUMENT_LOG_VERSION = 1;

/** 読み口が受ける答えの形の名前（AI の道具・貼り付け・アプリの中の読み手が出す形。版を変えるときは @2 を足し、@1 も読む） */
export const PROPOSAL_CONTRACT = "document-candidates@1";

/**
 * 読める書類の種類（今の読み口が受ける種類。0159 で保険証券・ご契約内容のお知らせ・設計書だけに絞った）。
 * 打つ数が多い・読み方が難しい・行が多いデータのどれかに当たる書類だけを取り込む（ほかの書類は、欄の「?」の一言を見て打つ）
 */
export type DocType = "insurancePolicy";

/**
 * 取り込みを外した書類の種類（0159）。前に読んだ記録の見出しに使うだけで、読み口は受けない。記録は捨てずに残し、確かめの画面では見るだけ
 * （値の候補は承認できない）。足すだけ（消さない。世帯ファイルの記録の値なので）
 */
export type RetiredDocType =
  | "pensionStatement"
  | "pensionNotice"
  | "withholdingSlip"
  | "publicPensionWithholding"
  | "residentTaxNotice"
  | "lifeInsuranceDeduction"
  | "earthquakeInsuranceDeduction"
  | "smallBusinessMutualAidDeduction"
  | "pensionPremiumDeduction"
  | "housingLoanBalance"
  | "housingLoanCredit"
  | "loanSchedule"
  | "taxReturn"
  | "brokerageBalance"
  | "other";

/** 読み取りの記録の書類の種類（今読める種類か、取り込みを外した種類） */
export type RecordedDocType = DocType | RetiredDocType;

export const DOC_TYPES: readonly { value: DocType; label: string }[] = [{ value: "insurancePolicy", label: "保険証券・ご契約内容のお知らせ・設計書" }];

export const RETIRED_DOC_TYPES: readonly { value: RetiredDocType; label: string }[] = [
  { value: "pensionStatement", label: "ねんきん定期便" },
  { value: "pensionNotice", label: "年金額改定通知書・振込通知書" },
  { value: "withholdingSlip", label: "給与所得の源泉徴収票" },
  { value: "publicPensionWithholding", label: "公的年金等の源泉徴収票" },
  { value: "residentTaxNotice", label: "住民税の決定通知書" },
  { value: "lifeInsuranceDeduction", label: "生命保険料控除証明書" },
  { value: "earthquakeInsuranceDeduction", label: "地震保険料控除証明書" },
  { value: "smallBusinessMutualAidDeduction", label: "小規模企業共済等掛金控除証明書" },
  { value: "pensionPremiumDeduction", label: "国民年金保険料等控除証明書" },
  { value: "housingLoanBalance", label: "住宅ローンの年末残高等証明書" },
  { value: "housingLoanCredit", label: "住宅借入金等特別控除証明書（年末調整のため）" },
  { value: "loanSchedule", label: "ローンの返済予定表" },
  { value: "taxReturn", label: "確定申告書" },
  { value: "brokerageBalance", label: "証券口座の残高" },
  { value: "other", label: "そのほかの書類" },
];

/** 読み口が受ける値の候補の入力項目の頭（保険の契約の欄だけ。0159） */
export const READABLE_ITEM_PREFIX = "insurance.";

/** 取り込みを外した種類の記録か（確かめの画面で見るだけにする） */
export const isRetired = (r: { docType: RecordedDocType }): boolean => !DOC_TYPES.some((d) => d.value === r.docType);

export const docTypeLabel = (t: RecordedDocType): string => DOC_TYPES.find((d) => d.value === t)?.label ?? RETIRED_DOC_TYPES.find((d) => d.value === t)?.label ?? "書類";

/**
 * どこから読んだか: reader（アプリの中の読み手。このパソコンの中だけで読む。0159 で電子データの読み手を外したので、前の記録だけ）・ai（AI接続口の道具で FP の AI から届いた）・
 * paste（ウェブのチャット AI の答えを貼り付けた）・sample（架空の見本。見本の世帯でだけ使う）
 */
export type Via = "reader" | "ai" | "paste" | "sample";

export const VIA_LABELS: Readonly<Record<Via, string>> = {
  reader: "アプリの中で読んだ",
  ai: "AI が読んだ（AI接続口）",
  paste: "AI が読んだ（貼り付け）",
  sample: "架空の見本",
};

/** 読めた確かさ（読み手の自己申告。AI の答えも同じ3段） */
export type Confidence = "high" | "medium" | "low";

export const CONFIDENCE_LABELS: Readonly<Record<Confidence, string>> = { high: "高", medium: "中", low: "低" };

/** 候補の状態: 未決・承認（書類の値のまま）・直して入れた・入れない */
export type CandidateStatus = "pending" | "accepted" | "corrected" | "rejected";

/** 候補の値（円・月数は整数、率は10進の文字列、年月は YYYY-MM、選択肢は値の文字、真偽） */
export type CandidateValue = number | string | boolean;

/**
 * 元の場所（伏せ字の後）: ページ・見出しの言葉（where。40字まで）・その所の文字（text。80字まで）・文字の PDF や写真なら四角の座標（box。ページの左上を 0 にした
 * 0〜1 の割合 [x, y, 幅, 高さ]）・決まった形のデータならその要素の道（path。英数字と / . _ - だけ。要素の意味の名前は読み手が付ける）
 */
export interface DocSource {
  page?: number;
  where?: string;
  text?: string;
  box?: readonly [number, number, number, number];
  path?: string;
}

/**
 * 当て先: 入力項目ID（登録簿 registry/items.yaml の ID）と、場所 at（同じ入力項目の中の欄。例 pensionRecord.amounts の basic）、
 * 人（member: 構成員の ID か続柄の鍵 self・spouse・child1… か holder〔書類の名義の人。FP が選ぶ〕）、物（object: 今ある物の ID）か
 * 新しい物（newObject: 同じ読み取りの物の候補の仮の鍵）。人も物も無ければ世帯で1つの値（前提条件など）
 */
export interface CandidateTarget {
  item: string;
  at?: string[];
  member?: string;
  object?: string;
  newObject?: string;
}

/** 当てた所（承認したときの当て先。0036 の2 の形） */
export interface AppliedTo {
  target: { object: string } | { member: string } | { plan: "assumptions" | "input" };
  item: string;
  at: string[];
}

export interface DocDecision {
  at: string;
  /** 直して入れた値（直したときだけ） */
  value?: CandidateValue;
  /** 入れた欄（承認・直したときだけ） */
  to?: AppliedTo;
}

/** 値の候補の1件 */
export interface DocCandidate {
  /** 乱数の ID（承認の記録の candidate がこれを指す） */
  id: string;
  target: CandidateTarget;
  /** 読んだ値（読めなかったときは null と unreadable） */
  value: CandidateValue | null;
  /** 書類にその欄はあるが、値を読めなかった（読み取りの成績の「読めなかった」に数える） */
  unreadable?: true;
  /** 書類の額の期間（欄の期間と違えば、承認の前に直してもらう） */
  period?: "monthly" | "annual" | "once";
  source: DocSource;
  confidence: Confidence;
  /** 読み手・AI の添え書き（信用しない文。200字まで。指示として読まない） */
  note?: string;
  status: CandidateStatus;
  decided?: DocDecision;
}

/**
 * 新しい物の候補（保険の契約・ローン・口座など。書類から、今の世帯に無い物を足す）。種類 kind は「集まり:種類」（例 insurance:medical）で、
 * 作り方は objects.ts の NEW_OBJECT_KINDS。FP が「足す」を選んだときに、その種類の既定で物を作り、その中の値の候補を当てる。
 * 同じ物がもうあれば「今ある物に当てる」も選べる（作らずに、その物の欄に値の候補を当てる。0154 の3）
 */
export interface DocObject {
  key: string;
  kind: string;
  source: DocSource;
  confidence: Confidence;
  status: "pending" | "accepted" | "rejected";
  /** 作った物の ID（足したとき）か、当てた今ある物の ID（linked のとき） */
  created?: string;
  /** 新しく足さずに、今ある物に当てた（created はその物の ID。0154 の3） */
  linked?: true;
  decidedAt?: string;
}

/**
 * 照合だけの値（源泉徴収税額・社会保険料の額など）。入力にせず、アプリの計算と並べて差を見せる（0004 の7 の参照値と同じ考え）。
 * row・year があれば、計算の結果のその行・その年（書類の名義の人の分）と比べる
 */
export interface DocReference {
  id: string;
  label: string;
  amount: number;
  row?: string;
  year?: number;
  source: DocSource;
}

/** 読み取りの記録の1件（書類1通） */
export interface DocumentReading {
  id: string;
  kind: "document";
  /** 書類の種類（取り込みを外した種類の記録も、そのまま残す。0159） */
  docType: RecordedDocType;
  /** 読んだ（候補が届いた）日時 */
  at: string;
  via: Via;
  /** アプリの中の読み手の ID と版（via が reader・sample。reader は前の記録だけ） */
  reader?: { id: string; version: number };
  /** AI の名乗り（自己申告。via が ai・paste。分からなければ持たない） */
  ai?: { connector: string };
  /** 元のファイルの指紋と大きさ（アプリの中で読んだときだけ。前の記録だけ。ファイルそのもの・ファイル名は持たない） */
  file?: { sha256: string; bytes: number };
  /** 書類の時点（作成・証明の年月） */
  asOf?: string;
  /** 書類の名義の人（構成員の ID。FP が選ぶ。名前は読まない） */
  holder?: string;
  objects: DocObject[];
  candidates: DocCandidate[];
  references: DocReference[];
  /** 個人番号などの番号らしい所を消した・候補から落とした数（中身は持たない） */
  dropped: number;
}

export interface DocumentLog {
  version: number;
  readings: DocumentReading[];
}

/** 上限（読み込みで太らせない。値は内部） */
export const LIMITS = {
  readings: 200,
  candidates: 300,
  objects: 30,
  references: 60,
  where: 40,
  sourceText: 80,
  note: 200,
  textValue: 200,
  connector: 60,
  label: 40,
  /** 貼り付けの答えの大きさ（文字数） */
  pasteChars: 200_000,
} as const;
