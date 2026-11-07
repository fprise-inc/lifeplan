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

/**
 * 架空の控除証明書の電子データの残り（0154 の5）: 公的な仕様の形に合わせた、国民年金保険料等控除証明書1通・小規模企業共済等掛金控除証明書（iDeCo）1通・
 * 住宅取得資金に係る借入金の年末残高等証明書1通・年末調整のための住宅借入金等特別控除証明書（令和6年以降居住開始用）1通を1つのファイルに入れた、架空の値の XML。
 * 氏名・住所・基礎年金番号・共済契約者番号・整理番号・借入の番号・連帯債務者名・備考の欄も入れてあり、読み手が読まない（木に入れない）ことを確かめに使う。
 * 日付は和暦の子の要素（元号の番号・元号の文字の両方）。見本の世帯でだけ読む
 */
export const SAMPLE_MORE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<DATA xmlns="urn:example:kyotsu" xmlns:gen="urn:example:general">
  <TEG840 VR="2.0" id="TEG840">
    <WOA00000><kubun_CD>1</kubun_CD><kubun_NM>国民年金保険料</kubun_NM></WOA00000>
    <WOB00000><kubun_CD>1</kubun_CD></WOB00000>
    <WOC00000><gen:era>5</gen:era><gen:yy>8</gen:yy></WOC00000>
    <WOD00000>1234-567890</WOD00000>
    <WOE00000>架空 太郎</WOE00000>
    <WOF00000>架空県架空市1-2-3</WOF00000>
    <WOK00000>176400</WOK00000>
    <WOL00000>35280</WOL00000>
    <WOM00000>211680</WOM00000>
    <WOP00000><WOP00010>期間外の納付があります</WOP00010></WOP00000>
    <WOQ00000><gen:era>5</gen:era><gen:yy>8</gen:yy><gen:mm>10</gen:mm><gen:dd>30</gen:dd></WOQ00000>
    <WOR00000>架空年金機構</WOR00000>
    <WOT00000>UQ20261030000001</WOT00000>
  </TEG840>
  <TEG850 VR="1.0" id="TEG850">
    <WPA00000><gen:era>5</gen:era><gen:yy>8</gen:yy></WPA00000>
    <WPB00000><kubun_CD>2</kubun_CD><kubun_NM>個人型確定拠出年金（iDeCo）</kubun_NM></WPB00000>
    <WPC00000>架空 太郎</WPC00000>
    <WPD00000>架空県架空市1-2-3</WPD00000>
    <WPE00000>1234-567890</WPE00000>
    <WPF00000><gen:era>5</gen:era><gen:yy>8</gen:yy></WPF00000>
    <WPG00000><WPG00010><gen:mm>9</gen:mm></WPG00010><WPG00020>207000</WPG00020></WPG00000>
    <WPH00000><WPH00010><gen:mm>10</gen:mm></WPH00010><WPH00020><gen:mm>12</gen:mm></WPH00020><WPH00030>69000</WPH00030></WPH00000>
    <WPI00000>276000</WPI00000>
    <WPL00000>
      <WPL00010><WPL00020>23000</WPL00020><WPL00030>架空の備考</WPL00030></WPL00010>
      <WPL00040><WPL00050>23000</WPL00050></WPL00040>
      <WPL00070><WPL00080>23000</WPL00080></WPL00070>
      <WPL00100><WPL00110>23000</WPL00110></WPL00100>
      <WPL00130><WPL00140>23000</WPL00140></WPL00130>
      <WPL00160><WPL00170>23000</WPL00170></WPL00160>
      <WPL00190><WPL00200>23000</WPL00200></WPL00190>
      <WPL00220><WPL00230>23000</WPL00230></WPL00220>
      <WPL00250><WPL00260>23000</WPL00260></WPL00250>
      <WPL00280><WPL00290>23000</WPL00290></WPL00280>
      <WPL00310><WPL00320>23000</WPL00320></WPL00310>
      <WPL00340><WPL00350>23000</WPL00350></WPL00340>
    </WPL00000>
    <WPM00000>架空 太郎様の備考</WPM00000>
    <WPN00000><gen:era>5</gen:era><gen:yy>8</gen:yy><gen:mm>10</gen:mm><gen:dd>15</gen:dd></WPN00000>
    <WPO00000>架空の年金連合会</WPO00000>
    <WPP00000>UQ20261015000002</WPP00000>
  </TEG850>
  <TEG900 VR="1.0" id="TEG900">
    <WIA00000>
      <WIA00010><WIA00020>架空県架空市1-2-3</WIA00020><WIA00030>架空 太郎</WIA00030></WIA00010>
      <WIA00040>
        <WIA00050><kubun_CD>3</kubun_CD></WIA00050>
        <WIA00060>
          <WIA00070>28450000</WIA00070>
          <WIA00080>
            <WIA00090><gen:era>4</gen:era><gen:yy>30</gen:yy><gen:mm>4</gen:mm><gen:dd>25</gen:dd></WIA00090>
            <WIA00100>35000000</WIA00100>
          </WIA00080>
        </WIA00060>
        <WIA00110>
          <WIA00120><gen:era>4</gen:era><gen:yy>30</gen:yy><gen:mm>5</gen:mm></WIA00120>
          <WIA00130><gen:era>5</gen:era><gen:yy>35</gen:yy><gen:mm>4</gen:mm></WIA00130>
          <WIA00140>35</WIA00140>
          <WIA00150>0</WIA00150>
        </WIA00110>
        <WIA00160>42000000</WIA00160>
        <WIA00170>
          <WIA00180><kubun_CD>2</kubun_CD></WIA00180>
          <WIA00190>架空 花子</WIA00190>
        </WIA00170>
        <WIA00290><gen:era>5</gen:era><gen:yy>7</gen:yy><gen:mm>12</gen:mm><gen:dd>31</gen:dd></WIA00290>
        <WIA00300><gen:era>5</gen:era><gen:yy>8</gen:yy><gen:mm>1</gen:mm><gen:dd>20</gen:dd></WIA00300>
      </WIA00040>
    </WIA00000>
    <WIB00000><WIB00010>架空県架空市4-5-6</WIB00010><WIB00020>架空のさくら銀行</WIB00020><WIB00030>架空第999号</WIB00030></WIB00000>
    <WIC00000><WIC00010>9999999999999</WIC00010><WIC00020>架空支店</WIC00020><WIC00030>000-0000-0000</WIC00030><WIC00040>LN-1234567</WIC00040><WIC00060>架空 太郎様</WIC00060></WIC00000>
  </TEG900>
  <TEG913 VR="1.0" id="TEG913">
    <WVA00000><gen:era>5</gen:era><gen:yy>8</gen:yy></WVA00000>
    <WVB00000><gen:era>5</gen:era><gen:yy>8</gen:yy></WVB00000>
    <WVD00000>
      <WVD00010><WVD00020>1</WVD00020><WVD00030>2</WVD00030><WVD00040>3</WVD00040></WVD00010>
      <WVD00090><WVD00100>架空県架空市</WVD00100><WVD00110>7-8-9</WVD00110></WVD00090>
      <WVD00130>架空\u3000次郎</WVD00130>
      <WVD00140><gen:era>5</gen:era><gen:yy>8</gen:yy><gen:mm>10</gen:mm><gen:dd>1</gen:dd></WVD00140>
      <WVD00150>架空</WVD00150>
      <WVD00160>架空 署長</WVD00160>
    </WVD00000>
    <WVG00000>12345678</WVG00000>
    <WVH00000><gen:era>5</gen:era><gen:yy>8</gen:yy></WVH00000>
    <WVI00000>
      <WVI00230>
        <WVI00240>（令和\u3000６年中居住者・認定住宅等用）</WVI00240>
        <WVI00250>
          <WVI00260><WVI00300><gen:era>5</gen:era><gen:yy>6</gen:yy><gen:mm>8</gen:mm><gen:dd>4</gen:dd></WVI00300></WVI00260>
          <WVI00500><WVI00510>ＺＥＨ水準省エネ住宅・新築</WVI00510></WVI00500>
          <WVI00530><WVI00560>39200000</WVI00560></WVI00530>
          <WVI00570><WVI00580>架空 次郎様</WVI00580></WVI00570>
        </WVI00250>
      </WVI00230>
    </WVI00000>
  </TEG913>
</DATA>
`;

/**
 * 架空の公的年金等の源泉徴収票の電子データ（0154 の追記）: 源泉徴収票等のオンライン化の仕様の形（様式 TEG408〔令和5年以降用〕が一番外の要素で、
 * 電子署名を中に持つ）に合わせた、架空の値の XML。支払を受ける者の住所・氏名・生年月日、扶養親族の氏名、摘要（基礎年金番号・年金コードの例）、
 * 支払者の法人番号・所在地・電話番号も入れてあり、読み手が読まない（木に入れない）ことを確かめに使う。見本の世帯でだけ読む
 */
export const SAMPLE_PENSION_SLIP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="https://example.invalid/sample.xsl"?>
<TEG408 xmlns="urn:example:kyotsu" xmlns:gen="urn:example:general" VR="1.0" id="TEG40820260101000000000001" page="1">
  <ZQA00000>公的年金等の源泉徴収票</ZQA00000>
  <ZQB00000><gen:era>5</gen:era><gen:yy>7</gen:yy></ZQB00000>
  <ZQC00000>
    <ZQC00010>架空県架空市1-2-3</ZQC00010>
    <ZQC00020>カクウ タロウ</ZQC00020>
    <ZQC00030>架空 太郎</ZQC00030>
    <ZQC00040><gen:era>3</gen:era><gen:yy>35</gen:yy><gen:mm>5</gen:mm><gen:dd>5</gen:dd></ZQC00040>
  </ZQC00000>
  <ZQD00000>
    <ZQD00010>
      <ZQD00020><ZQD00030>0</ZQD00030><ZQD00040>1980000</ZQD00040></ZQD00020>
      <ZQD00050><ZQD00060>0</ZQD00060><ZQD00070>12400</ZQD00070></ZQD00050>
    </ZQD00010>
  </ZQD00000>
  <ZQF00000><ZQF00020><kubun_CD>1</kubun_CD></ZQF00020></ZQF00000>
  <ZQK00000>168000</ZQK00000>
  <ZQL00000><ZQL00010>カクウ ハナコ</ZQL00010><ZQL00020>架空 花子</ZQL00020></ZQL00000>
  <ZQO00000><ZQO00010>基礎年金番号 1234-567890 年金コード 1150 介護保険料 72,000円</ZQO00010><ZQO00020>電子交付</ZQO00020></ZQO00000>
  <ZQP00000>
    <ZQP00010>9999999999999</ZQP00010>
    <ZQP00020>架空県架空市4-5-6</ZQP00020>
    <ZQP00030>架空年金機構</ZQP00030>
    <ZQP00040>000-0000-0000</ZQP00040>
  </ZQP00000>
  <dsig:Signature xmlns:dsig="http://www.w3.org/2000/09/xmldsig#"><dsig:SignedInfo><dsig:Reference URI="#TEG40820260101000000000001"/></dsig:SignedInfo><dsig:SignatureValue>QUJDREVGRw==</dsig:SignatureValue><dsig:KeyInfo><dsig:X509Data><dsig:X509Certificate>Q049S2FrdXUgVGFybw==</dsig:X509Certificate></dsig:X509Data></dsig:KeyInfo></dsig:Signature>
</TEG408>
`;
