// 架空の書類の見本（0148 の6）: 確かめの画面を、見本の世帯で試すための答え（読み口 proposal.ts が受ける形）。
// 会社名・金額・番号はどれも架空。見本の世帯でだけ出す（実在の世帯に架空の値の候補を入れない）。
// 個人番号の入った所（番号の欄・元の場所の文字）を1つずつ混ぜ、読み口で落ちること・消えることを画面で見られるようにしている
import { PROPOSAL_CONTRACT } from "./types.ts";

export interface SampleDocument {
  id: string;
  label: string;
  raw: unknown;
}

export const SAMPLE_DOCUMENTS: readonly SampleDocument[] = [
  {
    id: "residentTax",
    label: "住民税の決定通知書（架空・ご本人）",
    raw: {
      contract: PROPOSAL_CONTRACT,
      docType: "residentTaxNotice",
      asOf: "2026-05",
      holder: "self",
      values: [
        { item: "residentTaxAssessment.amount", member: "holder", value: 318000, period: "annual", source: { page: 1, where: "特別徴収税額（年額）", text: "特別徴収税額 318,000円" }, confidence: "high" },
        // 番号の欄（候補ごと落ちる）
        { item: "residentTaxAssessment.amount", member: "holder", value: "1234 5678 9012", source: { page: 1, where: "個人番号" }, confidence: "high" },
      ],
      references: [{ label: "給与収入（通知書の記載）", amount: 6400000, source: { page: 1, where: "給与収入", text: "給与収入 6,400,000 個人番号 1234 5678 9012" } }],
    },
  },
  {
    id: "withholding",
    label: "給与所得の源泉徴収票（架空・ご本人）",
    raw: {
      contract: PROPOSAL_CONTRACT,
      docType: "withholdingSlip",
      asOf: "2026-01",
      holder: "self",
      values: [
        { item: "employment.salary.annual", member: "holder", value: 5200000, period: "annual", source: { page: 1, where: "支払金額（賞与を除く分）", text: "支払金額 6,400,000（うち賞与 1,200,000）" }, confidence: "medium", note: "支払金額から、明細の賞与の合計を引いた額です" },
        { item: "employment.salary.bonus", member: "holder", value: 1200000, period: "annual", source: { page: 1, where: "賞与の合計", text: "賞与 1,200,000" }, confidence: "low" },
      ],
      references: [
        { label: "源泉徴収税額", amount: 152300, row: "cf.taxSi.incomeTax", year: 2025, source: { page: 1, where: "源泉徴収税額", text: "源泉徴収税額 152,300" } },
        { label: "社会保険料等の金額", amount: 948000, source: { page: 1, where: "社会保険料等の金額", text: "社会保険料等の金額 948,000" } },
      ],
    },
  },
  {
    id: "lifeInsurance",
    label: "生命保険料控除証明書（架空・医療保険1件）",
    raw: {
      contract: PROPOSAL_CONTRACT,
      docType: "lifeInsuranceDeduction",
      asOf: "2026-10",
      holder: "self",
      objects: [{ key: "c1", kind: "insurance:medical", source: { where: "保険種類", text: "医療保険（無配当）" }, confidence: "high" }],
      values: [
        { item: "insurance.label", newObject: "c1", value: "架空のあおば生命 医療保険", source: { where: "保険会社名・保険種類" }, confidence: "high" },
        { item: "insurance.insured", newObject: "c1", value: "holder", source: { where: "被保険者" }, confidence: "medium", note: "名前は読んでいません。書類の名義の人にしています" },
        { item: "insurance.contractDate", newObject: "c1", value: "2018-04", source: { where: "契約日", text: "契約日 2018年4月1日" }, confidence: "high" },
        { item: "insurance.premium", at: ["amount"], newObject: "c1", value: 3240, period: "once", source: { where: "証明額（月払）", text: "月払保険料 3,240円" }, confidence: "high" },
        { item: "insurance.deductionCategory", at: ["type"], newObject: "c1", value: "careMedical", source: { where: "新制度・介護医療" }, confidence: "high" },
        // 証券番号の欄（候補ごと落ちる）
        { item: "insurance.label", newObject: "c1", value: "AB-0012345678", source: { where: "証券番号" }, confidence: "high" },
      ],
      references: [{ label: "介護医療保険料（年間・新制度）", amount: 38880, source: { where: "証明額（12月期想定）", text: "38,880円" } }],
    },
  },
];

/**
 * 架空の控除証明書の電子データ（0153 の4）: 公的な仕様の形（生命保険料控除証明書2通・地震保険料控除証明書1通を1つのファイルに）に合わせた、
 * 架空の値の XML。会社名・氏名・番号・金額はどれも架空で、名前空間も架空の名前にしている（読み手は名前空間を見ない）。
 * 氏名・証券番号・被保険者番号の欄も入れてあり、読み手が読まない（木に入れない）ことを確かめに使う。見本の世帯でだけ読む
 */
export const SAMPLE_DEDUCTION_XML = `<?xml version="1.0" encoding="UTF-8"?>
<DATA xmlns="urn:example:kyotsu" xmlns:gen="urn:example:general">
  <TEG800 VR="1.0" id="TEG800">
    <WCA00000>架空のみどり生命</WCA00000>
    <WCB00000>9999999999999</WCB00000>
    <WCC00000><gen:yyyy>2026</gen:yyyy><gen:mm>10</gen:mm><gen:dd>20</gen:dd></WCC00000>
    <WCD00000>架空 太郎</WCD00000>
    <WCE00000>
      <WCE00010><gen:yyyy>2026</gen:yyyy></WCE00010>
      <WCE00020>生命保険料控除証明書</WCE00020>
      <WCE00040>AB-0012345678</WCE00040>
      <WCE00050>終身医療保険</WCE00050>
      <WCE00060><gen:yyyy>2019</gen:yyyy><gen:mm>6</gen:mm><gen:dd>1</gen:dd></WCE00060>
      <WCE00080>架空 太郎</WCE00080>
      <WCE00090>0000000001</WCE00090>
      <WCE00100>月払</WCE00100>
      <WCE00110>架空 花子</WCE00110>
      <WCE00120>0</WCE00120>
      <WCE00190>
        <WCE00200><gen:yyyy>2026</gen:yyyy><gen:mm>1</gen:mm></WCE00200>
        <WCE00210><gen:yyyy>2026</gen:yyyy><gen:mm>10</gen:mm></WCE00210>
        <WCE00310><WCE00360><WCE00370>32400</WCE00370><WCE00380>0</WCE00380><WCE00390>32400</WCE00390></WCE00360></WCE00310>
      </WCE00190>
      <WCE00440>
        <WCE00550><WCE00600><WCE00610>38880</WCE00610><WCE00620>0</WCE00620><WCE00630>38880</WCE00630></WCE00600></WCE00550>
      </WCE00440>
      <WCE00720>証券番号 AB-0012345678 のご契約</WCE00720>
    </WCE00000>
    <WCE00000>
      <WCE00010><gen:yyyy>2026</gen:yyyy></WCE00010>
      <WCE00040>AB-0012345679</WCE00040>
      <WCE00050>個人年金保険</WCE00050>
      <WCE00060><gen:yyyy>2010</gen:yyyy><gen:mm>4</gen:mm><gen:dd>1</gen:dd></WCE00060>
      <WCE00080>架空 太郎</WCE00080>
      <WCE00100>年払</WCE00100>
      <WCE00130>
        <WCE00140><gen:yyyy>1985</gen:yyyy><gen:mm>5</gen:mm><gen:dd>5</gen:dd></WCE00140>
        <WCE00150>25</WCE00150>
        <WCE00160>確定年金</WCE00160>
        <WCE00170>10</WCE00170>
      </WCE00130>
      <WCE00190>
        <WCE00220><WCE00270><WCE00280>120000</WCE00280><WCE00290>3000</WCE00290><WCE00300>117000</WCE00300></WCE00270></WCE00220>
      </WCE00190>
      <WCE00440>
        <WCE00460><WCE00510><WCE00520>120000</WCE00520><WCE00530>3000</WCE00530><WCE00540>117000</WCE00540></WCE00510></WCE00460>
      </WCE00440>
    </WCE00000>
    <WCE00000>
      <WCE00010><gen:yyyy>2026</gen:yyyy></WCE00010>
      <WCE00040>AB-0012345680</WCE00040>
      <WCE00050>収入保障保険</WCE00050>
      <WCE00060><gen:yyyy>2021</gen:yyyy><gen:mm>9</gen:mm><gen:dd>1</gen:dd></WCE00060>
      <WCE00070>K-123</WCE00070>
      <WCE00080>架空 太郎</WCE00080>
      <WCE00100>月払</WCE00100>
      <WCE00190>
        <WCE00310><WCE00320><WCE00330>42000</WCE00330><WCE00340>0</WCE00340><WCE00350>42000</WCE00350></WCE00320></WCE00310>
      </WCE00190>
      <WCE00440>
        <WCE00550><WCE00560><WCE00570>50400</WCE00570><WCE00580>0</WCE00580><WCE00590>50400</WCE00590></WCE00560></WCE00550>
      </WCE00440>
    </WCE00000>
  </TEG800>
  <TEG800 VR="1.0" id="TEG800">
    <WCA00000>架空のそら生命</WCA00000>
    <WCC00000><gen:yyyy>2026</gen:yyyy><gen:mm>10</gen:mm><gen:dd>15</gen:dd></WCC00000>
    <WCD00000>架空 太郎</WCD00000>
    <WCE00000>
      <WCE00010><gen:yyyy>2026</gen:yyyy></WCE00010>
      <WCE00040>SK-77777</WCE00040>
      <WCE00050>がん保険</WCE00050>
      <WCE00060><gen:yyyy>2022</gen:yyyy><gen:mm>2</gen:mm><gen:dd>1</gen:dd></WCE00060>
      <WCE00080>架空 太郎</WCE00080>
      <WCE00100>月払</WCE00100>
      <WCE00190>
        <WCE00310><WCE00360><WCE00370>25000</WCE00370><WCE00380>0</WCE00380><WCE00390>25000</WCE00390></WCE00360></WCE00310>
      </WCE00190>
      <WCE00440>
        <WCE00550><WCE00600><WCE00610>30000</WCE00610><WCE00620>0</WCE00620><WCE00630>30000</WCE00630></WCE00600></WCE00550>
      </WCE00440>
    </WCE00000>
  </TEG800>
  <TEG810 VR="1.0" id="TEG810">
    <WDA00000>架空のうみ損保</WDA00000>
    <WDC00000><gen:yyyy>2026</gen:yyyy><gen:mm>10</gen:mm><gen:dd>10</gen:dd></WDC00000>
    <WDD00000>架空 太郎</WDD00000>
    <WDE00000>
      <WDE00010><gen:yyyy>2026</gen:yyyy></WDE00010>
      <WDE00020><kubun_CD>1</kubun_CD><kubun_NM>地震保険料</kubun_NM></WDE00020>
      <WDE00030><WDE00040>F-5555-01</WDE00040><WDE00050>01</WDE00050></WDE00030>
      <WDE00060>架空 太郎</WDE00060>
      <WDE00070><kubun_CD>1</kubun_CD><kubun_NM>建物</kubun_NM></WDE00070>
      <WDE00120>
        <WDE00130><gen:yyyy>2024</gen:yyyy><gen:mm>3</gen:mm><gen:dd>1</gen:dd></WDE00130>
        <WDE00140>5</WDE00140>
      </WDE00120>
      <WDE00150><kubun_CD>1</kubun_CD><kubun_NM>年払</kubun_NM></WDE00150>
      <WDE00160><WDE00170>21600</WDE00170><WDE00180>21600</WDE00180></WDE00160>
    </WDE00000>
  </TEG810>
</DATA>
`;
