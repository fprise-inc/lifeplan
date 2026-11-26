// 見本のセットの定義（0247 の3）。アプリに入っている見本は、どれかのセットに入る（すべて架空。data/modelHouseholds の世帯に、
// 打ち手の目盛り・最初の提案・プランを添えたもの）。見本の棚は セット（定義の順）→ 自分で作った見本 の順に並べ、
// 出ている種類が2つ以上のときだけ見出しを出す（0247 の2。store/numbering.ts の shelfSections）。
// - セットの ID は「作成者.名前」（作成者 official は提供元だけ）。見本の ID はセットの中で重ならず、アプリのセットではモデル世帯の名前
// - 見本は番号を持たない。家族の形・本人の年代は family・age に持つ（絞り込み・AI接続口の目印に使う）。rev は見本の中身の版（中身を直したら上げる）
// - feature のあるセット（法人経営者の見本）は、その機能の公式の拡張（合算BS）が出るのと同じ条件のときだけ出す（sampleSetShown。0247 の7）。
//   出さないときは、見出し・行・数・名前を画面のどこにも出さない（見本の棚・開く・起動のときの最初の見本が、この1つの関数で決める）
// - ファイナンシアの見本は12件（0247 の9）。棚から外した見本の設定は OFF_SHELF_DEMOS に残す（保存した世帯の出発点の見本・開発用の入口・テストが使う）
import type { DemoHousehold } from "../catalog.ts";
import { featureOn, type FeatureId, type FeatureStatus } from "../office/featureCodes.ts";
import type { OfficeFeatures } from "../office/settings.ts";

export interface SampleSet {
  /** セットの ID（例 official.basic） */
  id: string;
  /** 見本の棚の見出し（「ファイナンシアの見本」など） */
  name: string;
  /** 機能を有効にするコードの機能の名前（0110）。無ければ全員に出す */
  feature?: FeatureId;
  /** 見本（この順に並べる） */
  samples: readonly DemoHousehold[];
}

/** ファイナンシアの見本（全員に入っている。並びは棚の順。0247 の9 の12件。名前は相談の場面が分かる短い名前で、家族の形・年代・項目は family・age・traits で持つ） */
const BASIC: readonly DemoHousehold[] = [
  {
    id: "sampleDualAssetsInvest",
    family: 3,
    age: 4,
    rev: 1,
    title: "共働き・子2人・40代（資産運用）",
    traits: ["会社員", "共働き", "持ち家", "住宅ローン", "教育費", "資産運用", "収益不動産"],
    targetAge: 95,
    steps: { retireAge: [60, 62, 65, 68, 70], pensionAge: [60, 65, 68, 70, 75], nisaMonthly: [0, 30000, 50000, 80000, 100000], livingMonthly: [420000, 450000, 480000, 520000] },
    firstProposal: { nisaMonthly: 80000 },
    reemployment: { fromAge: 60, type: "contract", annualSalary: 6000000, standardMonthlyRemuneration: 500000 },
    notes: { retireAge: "60歳から再雇用（年収600万円）", nisaMonthly: "つみたて投資枠の最初の期間（50歳から月8万円、55歳から月10万円に増やす）" },
    memo: [
      "NISA のつみたて投資枠を年齢で増やす（49歳まで月5万円、50〜54歳は月8万円、55歳から月10万円。架空の例）",
      "賃貸に出しているマンション1室は月9.5万円で貸している（空室5%・管理費などは年36万円＋家賃の5%。架空の例）",
      "65歳から毎月35万円を取り崩す前提（架空の例）",
      "次回: 繰上返済と資産配分の見直しのどちらを先にするか相談",
    ],
    plans: [
      { name: "プランB 住宅ローンを500万円繰上返済", tags: ["住宅"], values: { "loan:f219eceb-c600-449c-9f42-de1997fe7037:prepay": 5000000 } },
      {
        name: "プランC 資産配分の見直し（課税口座・iDeCo）",
        tags: ["運用"],
        values: {
          "mix:74c8181f-16e4-41df-8248-c16e264f012f": [
            { assetClass: "equity.global", share: "0.5" },
            { assetClass: "equity.domestic", share: "0.2" },
            { assetClass: "bond.global", share: "0.3" },
          ],
          "mix:18b3d3e9-3088-41de-95c3-20a9e6bf3246": [
            { assetClass: "equity.global", share: "0.7" },
            { assetClass: "bond.global", share: "0.3" },
          ],
        },
      },
      { name: "プランD 65歳まで働く（60歳から再雇用）", tags: ["老後"], values: { "lever:retireAge": 65 } },
      { name: "プランE 黒字の6割が貯まる", tags: ["老後"], values: { "surplus:ratio": "0.6" } },
    ],
    snapshots: [
      {
        id: "5fc9ba2f-07e7-48b8-9867-a28ee9837839",
        createdAt: "2024-10-12T10:00:00+09:00",
        trigger: "manual",
        memo: "初回の面談（架空の例）",
        balances: {
          "94960b89-c82c-4914-a2db-cd18a3123861": 6100000, "a43b25ff-395d-4d3e-8c6e-03a422854c73": 2700000, "2f831eca-84c4-41ea-8e88-c90b6992daeb": 4300000, "63c9944b-afae-45e0-bf54-d4ac335d8d64": 2000000,
          "18b3d3e9-3088-41de-95c3-20a9e6bf3246": 2000000, "b3623d8b-c500-439c-8e37-e6684a259bb7": 1150000, "67c9ae0d-6fe9-4c08-93b0-3f91646891c0": 4000000, "74c8181f-16e4-41df-8248-c16e264f012f": 3500000,
          "fb07252d-b687-4416-bb18-fa26c8666608": 1900000, "db61701e-5604-46a3-81e0-22cf3cdce3e8": 1700000, "9e5663d4-61e9-4d8e-b655-df0221cdf111": 1300000, "203ed3d8-74df-450b-8ba0-346f86d70963": 18600000,
          "f219eceb-c600-449c-9f42-de1997fe7037": 24600000, "9f29a302-6059-4f50-bb21-b05379a27a5c": 1700000,
        },
      },
      {
        id: "d03f494e-9324-46b7-978c-8f46b4fe2f02",
        createdAt: "2025-10-18T14:00:00+09:00",
        trigger: "pdf",
        memo: "提案書（架空の例）",
        balances: {
          "94960b89-c82c-4914-a2db-cd18a3123861": 5000000, "a43b25ff-395d-4d3e-8c6e-03a422854c73": 2400000, "2f831eca-84c4-41ea-8e88-c90b6992daeb": 4600000, "63c9944b-afae-45e0-bf54-d4ac335d8d64": 2200000,
          "18b3d3e9-3088-41de-95c3-20a9e6bf3246": 2250000, "b3623d8b-c500-439c-8e37-e6684a259bb7": 1350000, "67c9ae0d-6fe9-4c08-93b0-3f91646891c0": 4500000, "74c8181f-16e4-41df-8248-c16e264f012f": 3600000,
          "fb07252d-b687-4416-bb18-fa26c8666608": 2150000, "db61701e-5604-46a3-81e0-22cf3cdce3e8": 1800000, "9e5663d4-61e9-4d8e-b655-df0221cdf111": 1550000, "203ed3d8-74df-450b-8ba0-346f86d70963": 18300000,
          "f219eceb-c600-449c-9f42-de1997fe7037": 23900000, "9f29a302-6059-4f50-bb21-b05379a27a5c": 1500000,
        },
      },
    ],
  },
  {
    id: "sampleCoupleNoKids",
    family: 2,
    age: 3,
    rev: 1,
    title: "住宅を買う前の共働き・30代（子なし）",
    traits: ["会社員", "共働き", "賃貸"],
    targetAge: 95,
    steps: { retireAge: [60, 62, 65, 68, 70], pensionAge: [60, 65, 68, 70, 75], nisaMonthly: [0, 30000, 50000, 80000], livingMonthly: [290000, 310000, 330000, 350000] },
    firstProposal: { retireAge: 65, pensionAge: 65, nisaMonthly: 50000, livingMonthly: 310000 },
    notes: { retireAge: "妻は60歳まで働く想定", nisaMonthly: "夫の分（妻も月2万円を積み立てている）", livingMonthly: "家賃（月14万円）は別。退職後は85%、80歳から75%" },
    memo: ["5年以内に住宅の購入を考えている（架空の例）", "妻は60歳で退職する意向（架空の例）", "次回: 購入の予算と頭金を相談"],
  },
  {
    id: "lifetime100Plan",
    family: 3,
    age: 3,
    rev: 1,
    title: "共働き・子1人・30代",
    traits: ["会社員", "共働き", "賃貸", "住宅ローン", "教育費", "資産運用"],
    targetAge: 95,
    steps: {
      retireAge: [60, 62, 65, 68, 70],
      pensionAge: [60, 65, 68, 70, 75],
      nisaMonthly: [0, 10000, 30000, 50000],
      livingMonthly: [220000, 240000, 260000, 280000],
    },
    firstProposal: { nisaMonthly: 50000, livingMonthly: 240000 },
    notes: { retireAge: "夫婦とも65歳まで正社員で働く想定", nisaMonthly: "夫の分（妻も月2万円を積み立てている）", livingMonthly: "家賃・住宅の費用は別。子の独立後は85%、退職後は75%、80歳から65%" },
    memo: [
      "今は賃貸（家賃 月11万円）。2029年4月に新築の戸建て（4,200万円）を買い、住宅ローン3,800万円を夫婦の連帯債務・変動金利で借りる予定（架空の例）",
      "長女（0歳）は保育園から、私立高校・私立大学の理科系（自宅外）まで見込む（架空の例）",
      "次回: 購入の予算と頭金、2041年に予定している繰上返済（200万円）の考え方を相談",
    ],
    plans: [
      { name: "プランB NISA を月5万円に増やす", tags: ["運用"], values: { "lever:nisaMonthly": 50000 } },
      { name: "プランC 生活費を月24万円に", tags: ["老後"], values: { "lever:livingMonthly": 240000 } },
    ],
  },
  {
    id: "sampleCoupleTwoKidsPeak",
    family: 3,
    age: 4,
    rev: 1,
    title: "会社員の夫婦と子2人・40代（教育費のピーク）",
    traits: ["会社員", "片働き", "持ち家", "住宅ローン", "教育費"],
    targetAge: 95,
    steps: { retireAge: [60, 62, 65, 68, 70], pensionAge: [60, 65, 68, 70, 75], nisaMonthly: [0, 10000, 30000, 50000], livingMonthly: [260000, 280000, 300000, 320000] },
    firstProposal: { retireAge: 65, pensionAge: 65, nisaMonthly: 30000, livingMonthly: 280000 },
    reemployment: { fromAge: 60, type: "contract", annualSalary: 4200000, standardMonthlyRemuneration: 360000 },
    notes: { retireAge: "60歳から再雇用（年収420万円）", nisaMonthly: "働いている間、毎月積み立てる", livingMonthly: "子の独立後は85%、退職後は80%、80歳から70%" },
    memo: [
      "退職金1,800万円は規程の確認待ち（架空の例）",
      "配偶者は扶養内のパートを60歳まで続ける意向（架空の例）",
      "夢は7件を聞き取った。家族で海外旅行・キャンプは最初から計算に入れ、車の買い替え・リフォーム・長女の結婚の援助・退職後のゴルフ・二拠点の暮らしは「最初から計算に入れない」で置いた（架空の例）",
      "次回: 長男の進路の希望を確認",
    ],
    plans: [
      { name: "プランB 65歳まで働く（60歳から再雇用）", tags: ["老後"], values: { "lever:retireAge": 65 } },
      { name: "プランC NISA を月3万円に増やす", tags: ["運用"], values: { "lever:nisaMonthly": 30000 } },
    ],
  },
  {
    id: "sampleSelfEmployedFamily",
    family: 3,
    age: 4,
    rev: 1,
    title: "自営業の夫婦と子2人・40代",
    traits: ["自営業", "片働き", "持ち家", "住宅ローン", "教育費"],
    targetAge: 95,
    steps: { retireAge: [65, 68, 70, 72, 75], pensionAge: [60, 65, 68, 70, 75], nisaMonthly: [0, 30000, 50000, 70000], livingMonthly: [240000, 250000, 270000, 290000] },
    firstProposal: { retireAge: 70, pensionAge: 68, nisaMonthly: 50000, livingMonthly: 250000 },
    notes: { retireAge: "定年は無い。働く最後の年齢まで事業の所得が続く想定", pensionAge: "夫婦とも国民年金（老齢基礎年金）が中心", livingMonthly: "子の独立後は80%、仕事をやめた後は85%、80歳から80%" },
    memo: ["事業の所得は年850万円の想定（架空の例）", "付加年金・小規模企業共済にはまだ入っていない（架空の例）", "次回: 長女の私立高校と自宅外の大学の費用を確認"],
  },
  {
    id: "sampleSingleParent",
    family: 4,
    age: 3,
    rev: 1,
    title: "ひとり親と子2人・30代",
    traits: ["会社員", "賃貸", "教育費"],
    targetAge: 95,
    steps: { retireAge: [60, 62, 65, 68, 70], pensionAge: [60, 65, 68, 70, 75], nisaMonthly: [0, 10000, 20000, 30000], livingMonthly: [145000, 155000, 165000, 175000] },
    firstProposal: { retireAge: 65, pensionAge: 65, nisaMonthly: 20000, livingMonthly: 155000 },
    notes: { nisaMonthly: "働いている間、毎月積み立てる", livingMonthly: "家賃（月7.2万円）は別。子の独立後は70%、退職後は95%、80歳から85%" },
    memo: ["ひとり親の手当（児童扶養手当など）は計算に入れていない。児童手当は入る（架空の例）", "長女は国立大学（自宅）、長男は専門学校を希望。専門学校の学費は学校の案内の額（年110万円・入学金20万円。架空の例）"],
  },
  {
    id: "sampleSingle50sRenter",
    family: 1,
    age: 5,
    rev: 1,
    title: "おひとり様・50代（賃貸）",
    traits: ["会社員", "賃貸"],
    targetAge: 95,
    steps: { retireAge: [60, 62, 65, 68, 70], pensionAge: [60, 65, 68, 70, 75], nisaMonthly: [0, 10000, 30000, 50000], livingMonthly: [140000, 150000, 160000, 180000] },
    firstProposal: { retireAge: 65, nisaMonthly: 50000 },
    reemployment: { fromAge: 60, type: "contract", annualSalary: 4000000, standardMonthlyRemuneration: 340000 },
    notes: { retireAge: "60歳で定年、その後は再雇用（年収400万円）", nisaMonthly: "働いている間、毎月積み立てる", livingMonthly: "家賃（月5.8万円）は別。退職後は90%、80歳から80%" },
    memo: ["家賃は月5.8万円。退職した後も同じ賃貸に住み続ける前提（架空の例）", "退職金1,900万円は勤め先の規程からの見込み（架空の例）", "次回: 60歳からの働き方（再雇用の条件）と、老後の住まいの希望を確認"],
    plans: [
      { name: "プランB 65歳まで働く（60歳から再雇用）", tags: ["老後"], values: { "lever:retireAge": 65 } },
      { name: "プランC 生活費を月15万円に", tags: ["老後"], values: { "lever:livingMonthly": 150000 } },
    ],
  },
  {
    id: "rentalSample",
    family: 3,
    age: 4,
    rev: 1,
    title: "収益不動産を持つ会社員の夫婦",
    traits: ["会社員", "共働き", "持ち家", "住宅ローン", "教育費", "収益不動産"],
    targetAge: 95,
    steps: { retireAge: [60, 62, 65, 68, 70], pensionAge: [60, 65, 68, 70, 75], nisaMonthly: [0, 30000, 50000, 80000], livingMonthly: [300000, 320000, 340000] },
    firstProposal: {},
    reemployment: { fromAge: 60, type: "contract", annualSalary: 4800000, standardMonthlyRemuneration: 400000 },
    notes: { retireAge: "60歳から再雇用（年収480万円）" },
    memo: ["木造アパート1棟8戸（2016年に中古で取得）と区分マンション1室を貸している（架空の例）", "アパートは2041年10月（60歳）に売る予定。2029年に外壁・屋根の修繕（架空の例）"],
    plans: [
      { name: "プランB 65歳まで働く（60歳から再雇用）", tags: ["老後"], values: { "lever:retireAge": 65 } },
      { name: "プランC 住宅ローンを300万円繰上返済", tags: ["住宅"], values: { "loan:1a4ab6d6-d333-45e9-97c8-193f070433a8:prepay": 3000000 } },
    ],
  },
  {
    id: "sampleParentsCare",
    family: 3,
    age: 5,
    rev: 1,
    title: "親の介護と相続を控える夫婦・50代",
    traits: ["会社員", "共働き", "持ち家", "資産運用", "親の介護・相続"],
    targetAge: 95,
    steps: { retireAge: [60, 62, 65, 68, 70], pensionAge: [60, 65, 68, 70, 75], nisaMonthly: [0, 30000, 50000, 80000], livingMonthly: [180000, 200000, 209000, 230000, 250000] },
    firstProposal: { pensionAge: 68, nisaMonthly: 50000 },
    notes: { retireAge: "ご本人は正社員（年収800万円）。配偶者はパート（年収120万円）", livingMonthly: "生活費は世帯の人数の統計の推定（2人）" },
    memo: ["ご本人の父（82歳）は施設で介護（父のお金から払い、足りない分は世帯）。毎月3万円を仕送りしている（架空の例）", "ご本人の母（79歳）は同居で扶養している（架空の例）", "父からの相続（2,000万円）の見込み、孫への贈与（毎年50万円・5年）、FP顧問料の提案（単発30万円＋月1万円）（架空の例）"],
  },
  {
    id: "sampleSeniorRental",
    family: 3,
    age: 6,
    rev: 1,
    title: "退職前後の夫婦・60代",
    traits: ["会社員", "共働き", "持ち家", "資産運用", "収益不動産", "親の介護・相続"],
    targetAge: 95,
    steps: { retireAge: [65, 66, 68, 70], pensionAge: [65, 68, 70, 75], nisaMonthly: [0, 10000, 30000, 50000], livingMonthly: [180000, 200000, 209000, 230000, 250000] },
    firstProposal: { retireAge: 68, nisaMonthly: 30000 },
    notes: { retireAge: "60歳で定年、今は再雇用（年収350万円）。配偶者はパート（年収100万円）" },
    memo: ["確定給付企業年金を65歳から年60万円・10年で受け取る（架空の例）", "持ち家は完済（1995年築）。区分マンション1室を月7万円で貸している（2010年に1,800万円で取得。架空の例）", "預金2,500万円・課税口座800万円・NISA（月1万円）（架空の例）", "母（89歳）の在宅の介護を月8万円で払う。母からの相続（1,500万円）の見込み（架空の例）"],
  },
  {
    id: "samplePensionerCouple",
    family: 5,
    age: 6,
    rev: 1,
    title: "年金生活の夫婦",
    traits: ["年金生活", "持ち家", "資産運用"],
    targetAge: 95,
    // 働いていないので「働く最後の年齢」は出ない。年金はもう受け取っているので、受け取り開始は動かせない（画面は今の年齢で止める）
    steps: { retireAge: [], pensionAge: [], nisaMonthly: [0, 10000, 20000, 30000], livingMonthly: [220000, 230000, 246000, 260000] },
    firstProposal: { nisaMonthly: 30000, livingMonthly: 230000 },
    notes: { nisaMonthly: "75歳まで、預金から毎月積み立てる", livingMonthly: "住まいの修繕（月1.5万円）・固定資産税は別。80歳から87%" },
    memo: [
      "夫68歳・妻66歳。2人とも年金を受け取っている（夫は会社員の期間が中心、妻は国民年金が中心。架空の例）",
      "持ち家は住宅ローンを返し終えている。修繕に月1.5万円を見込む（架空の例）",
      "次回: 預金のうち、使う予定の無いお金の置き場所を相談",
    ],
    plans: [{ name: "プランB 生活費を月23万円に", tags: ["老後"], values: { "lever:livingMonthly": 230000 } }],
  },
  {
    id: "sampleExecutive",
    family: 3,
    age: 5,
    rev: 1,
    title: "会社を経営する夫婦・50代",
    traits: ["役員", "片働き", "持ち家", "教育費", "資産運用"],
    targetAge: 95,
    steps: { retireAge: [65, 68, 70, 72, 75], pensionAge: [65, 68, 70, 72, 75], nisaMonthly: [0, 30000, 50000, 100000], livingMonthly: [420000, 450000, 500000, 550000] },
    firstProposal: { retireAge: 70, pensionAge: 70, nisaMonthly: 100000, livingMonthly: 480000 },
    notes: { retireAge: "役員を退く年齢（退くときに役員退職慰労金）", pensionAge: "役員報酬が高い間は、在職老齢年金で止まる分がある", livingMonthly: "子の独立後は85%、退任後は85%、80歳から75%" },
    memo: ["役員退職慰労金は最終報酬月額120万円×在任年数×1.5倍の見込み（架空の例）", "小規模企業共済は70歳で半分を一時金、残りを10年の分割で受け取る想定（架空の例）", "長女は私立大学の理系・自宅外（架空の例）"],
    plans: [
      { name: "プランB 年金を70歳から受け取る", tags: ["老後"], values: { "lever:pensionAge": 70 } },
      { name: "プランC 65歳で役員を退く", tags: ["老後"], values: { "lever:retireAge": 65 } },
    ],
  },
];

/**
 * 棚に出さない見本の設定（0247 の3・9）。前の版の棚にあった見本で、顔ぶれを12件に入れ替えたときに外した物。モデル世帯のファイルは残る。
 * 保存した世帯の workspace.template（出発点にした見本の ID）がこれらを指していても、打ち手の目盛り・既定の値が読めるよう残す（demoHousehold が両方から探す）。
 * 開発用の入口（#household=<id>）・テスト・見張りもこれを使う。名前は棚に出ないので、見本の名前の重なりの確かめ（reservedSampleNames）には入れない
 */
export const OFF_SHELF_DEMOS: readonly DemoHousehold[] = [
  {
    id: "salariedCoupleTwoKids",
    family: 3,
    age: 4,
    rev: 1,
    title: "会社員の夫婦と子2人",
    traits: ["会社員", "片働き", "持ち家", "住宅ローン", "教育費"],
    targetAge: 95,
    steps: {
      retireAge: [60, 62, 65, 68, 70],
      pensionAge: [60, 65, 68, 70, 75],
      nisaMonthly: [0, 10000, 30000, 50000],
      livingMonthly: [260000, 280000, 300000, 320000],
    },
    firstProposal: { retireAge: 65, pensionAge: 65, nisaMonthly: 30000, livingMonthly: 280000 },
    reemployment: { fromAge: 60, type: "contract", annualSalary: 4200000, standardMonthlyRemuneration: 360000 },
    notes: {
      retireAge: "60歳から再雇用（年収420万円）",
      nisaMonthly: "働いている間、毎月積み立てる",
      livingMonthly: "子の独立後は85%、退職後は80%、80歳から70%",
    },
    memo: ["退職金1,800万円は規程の確認待ち（架空の例）", "配偶者は扶養内のパートを60歳まで続ける意向（架空の例）", "次回: 長男の進路の希望を確認"],
  },
  {
    id: "investmentCouple",
    family: 3,
    age: 4,
    rev: 1,
    title: "資産運用の見本（会社員の夫婦と子2人）",
    traits: ["会社員", "片働き", "持ち家", "住宅ローン", "教育費", "資産運用"],
    targetAge: 95,
    steps: {
      retireAge: [60, 62, 65, 68, 70],
      pensionAge: [60, 65, 68, 70, 75],
      nisaMonthly: [0, 30000, 50000, 70000, 100000],
      livingMonthly: [260000, 280000, 300000, 320000],
    },
    firstProposal: {},
    reemployment: { fromAge: 60, type: "contract", annualSalary: 4200000, standardMonthlyRemuneration: 360000 },
    memo: ["NISA のつみたて投資枠を年齢で増やす（架空の例）", "65歳から毎月17万円を取り崩す前提（架空の例）"],
  },
  {
    id: "dualAssetsTwoKids",
    family: 3,
    age: 4,
    rev: 1,
    title: "共働きの夫婦と子2人（資産が多め）",
    traits: ["会社員", "共働き", "持ち家", "住宅ローン", "教育費", "資産運用", "収益不動産"],
    targetAge: 95,
    steps: {
      retireAge: [60, 62, 65, 68, 70],
      pensionAge: [60, 65, 68, 70, 75],
      nisaMonthly: [0, 30000, 50000, 80000, 100000],
      livingMonthly: [420000, 450000, 480000, 520000],
    },
    firstProposal: {},
    reemployment: { fromAge: 60, type: "contract", annualSalary: 6000000, standardMonthlyRemuneration: 500000 },
    notes: { retireAge: "60歳から再雇用（年収600万円）" },
    memo: ["賃貸に出しているマンション1室は月9.5万円で貸している（空室5%・管理費などは年36万円＋家賃の5%。架空の例）", "65歳から毎月35万円を取り崩す前提（架空の例）", "次回: 繰上返済と資産配分の見直しのどちらを先にするか相談"],
    plans: [
      { name: "プランB 住宅ローンを500万円繰上返済", tags: ["住宅"], values: { "loan:32ca6364-8bb4-4b27-a1af-55a261a6d310:prepay": 5000000 } },
      {
        name: "プランC 資産配分の見直し（課税口座・iDeCo）",
        tags: ["運用"],
        values: {
          "mix:7fc64cf7-e50e-46f3-89f3-839d360b0667": [
            { assetClass: "equity.global", share: "0.5" },
            { assetClass: "equity.domestic", share: "0.2" },
            { assetClass: "bond.global", share: "0.3" },
          ],
          "mix:e4491ce1-3307-48dd-a3f5-4a6acda508df": [
            { assetClass: "equity.global", share: "0.7" },
            { assetClass: "bond.global", share: "0.3" },
          ],
        },
      },
      { name: "プランD 65歳まで働く（60歳から再雇用）", tags: ["老後"], values: { "lever:retireAge": 65 } },
      // 現場の FP の声から: 黒字は全部は貯まらない（6割。0031）
      { name: "プランE 黒字の6割が貯まる", tags: ["老後"], values: { "surplus:ratio": "0.6" } },
    ],
    snapshots: [
      {
        id: "6f1d2c3b-8a4e-4d5f-9b6a-2c7e1f0a9d01",
        createdAt: "2024-10-12T10:00:00+09:00",
        trigger: "manual",
        memo: "初回の面談（架空の例）",
        balances: {
          "b6088c23-3c27-45c8-99a5-ce3b42939948": 6100000, "8adae3ca-5be4-478a-9b9a-b41a7e84cae5": 2700000, "03c2def7-bbb4-4402-a039-abdb08cc570d": 4300000, "752e0859-a3aa-49f6-b023-992334633510": 2000000,
          "e4491ce1-3307-48dd-a3f5-4a6acda508df": 2000000, "87aa3bd4-0c70-48eb-96f0-1fe494baf74c": 1150000, "c7cb05a2-b26f-4c6a-aade-c7f62d13f41d": 4000000, "7fc64cf7-e50e-46f3-89f3-839d360b0667": 3500000,
          "1defd43d-2f75-4ba9-924c-8ab160d19f67": 1900000, "f36b05c7-0ada-457c-aaac-91c9fb8d4db6": 1700000, "8dbb796f-ef87-47f5-a95d-79ac9bb7bfed": 1300000, "97fdbe51-70e9-42c2-bf8f-eaa164206781": 18600000,
          "32ca6364-8bb4-4b27-a1af-55a261a6d310": 24600000, "ac6422fc-59f9-43c8-ad29-816e55d83de0": 1700000,
        },
      },
      {
        // 1年前の控え: 預金・NISA・課税口座・持株会が今より少ない（控えから見た実際の貯まり方が出る。0031）
        id: "6f1d2c3b-8a4e-4d5f-9b6a-2c7e1f0a9d02",
        createdAt: "2025-10-18T14:00:00+09:00",
        trigger: "pdf",
        memo: "提案書（架空の例）",
        balances: {
          "b6088c23-3c27-45c8-99a5-ce3b42939948": 5000000, "8adae3ca-5be4-478a-9b9a-b41a7e84cae5": 2400000, "03c2def7-bbb4-4402-a039-abdb08cc570d": 4600000, "752e0859-a3aa-49f6-b023-992334633510": 2200000,
          "e4491ce1-3307-48dd-a3f5-4a6acda508df": 2250000, "87aa3bd4-0c70-48eb-96f0-1fe494baf74c": 1350000, "c7cb05a2-b26f-4c6a-aade-c7f62d13f41d": 4500000, "7fc64cf7-e50e-46f3-89f3-839d360b0667": 3600000,
          "1defd43d-2f75-4ba9-924c-8ab160d19f67": 2150000, "f36b05c7-0ada-457c-aaac-91c9fb8d4db6": 1800000, "8dbb796f-ef87-47f5-a95d-79ac9bb7bfed": 1550000, "97fdbe51-70e9-42c2-bf8f-eaa164206781": 18300000,
          "32ca6364-8bb4-4b27-a1af-55a261a6d310": 23900000, "ac6422fc-59f9-43c8-ad29-816e55d83de0": 1500000,
        },
      },
    ],
  },
  {
    id: "sampleSingle20s",
    family: 1,
    age: 2,
    rev: 1,
    title: "単身・20代の会社員",
    traits: ["会社員", "賃貸"],
    targetAge: 95,
    steps: { retireAge: [60, 62, 65, 68, 70], pensionAge: [60, 65, 68, 70, 75], nisaMonthly: [0, 10000, 20000, 30000, 50000], livingMonthly: [150000, 160000, 170000, 180000] },
    firstProposal: { retireAge: 65, pensionAge: 65, nisaMonthly: 30000, livingMonthly: 160000 },
    notes: { retireAge: "65歳まで正社員で働く想定", nisaMonthly: "働いている間、毎月積み立てる", livingMonthly: "家賃（月8.5万円）は別。退職後は90%、80歳から80%" },
    memo: ["NISA は全世界株の積立（架空の例）", "次回: 勤め先の退職金の制度を確認"],
  },
  {
    id: "sampleSingle40s",
    family: 1,
    age: 4,
    rev: 1,
    title: "単身・40代の会社員（持ち家）",
    traits: ["会社員", "持ち家", "住宅ローン"],
    targetAge: 95,
    steps: { retireAge: [60, 62, 65, 68, 70], pensionAge: [60, 65, 68, 70, 75], nisaMonthly: [0, 10000, 30000, 50000], livingMonthly: [160000, 170000, 180000, 200000] },
    firstProposal: { retireAge: 65, pensionAge: 65, nisaMonthly: 50000, livingMonthly: 170000 },
    reemployment: { fromAge: 60, type: "contract", annualSalary: 3600000, standardMonthlyRemuneration: 300000 },
    notes: { retireAge: "60歳から再雇用（年収360万円）", nisaMonthly: "60歳の定年まで毎月積み立てる", livingMonthly: "住宅ローン・管理費は別。退職後は85%、80歳から80%" },
    memo: ["退職金1,200万円は勤め先の規程からの見込み（架空の例）", "住宅ローンは変動金利。金利の上昇を気にしている（架空の例）"],
    plans: [
      { name: "プランB 生活費とNISAの見直し", tags: ["老後"], values: { "lever:livingMonthly": 170000, "lever:nisaMonthly": 50000 } },
      { name: "プランC 65歳まで働く（60歳から再雇用）", tags: ["老後"], values: { "lever:retireAge": 65 } },
    ],
  },
  {
    id: "sampleSeniorCouple",
    family: 5,
    age: 6,
    rev: 1,
    title: "シニア夫婦・60代（年金の繰下げ）",
    traits: ["年金生活", "持ち家", "資産運用"],
    targetAge: 95,
    steps: { retireAge: [67, 68, 70, 72], pensionAge: [67, 68, 70, 72, 75], nisaMonthly: [0, 10000, 30000, 50000], livingMonthly: [260000, 280000, 300000, 320000] },
    firstProposal: { retireAge: 70, pensionAge: 70, nisaMonthly: 30000, livingMonthly: 280000 },
    notes: { retireAge: "嘱託（週30時間・年収240万円）で働き続ける", pensionAge: "夫の年金は68歳まで繰り下げる予定（妻は65歳から）", nisaMonthly: "働いている間、毎月積み立てる", livingMonthly: "仕事をやめた後は90%、80歳から80%" },
    memo: ["夫は70歳まで嘱託で働く意向（架空の例）", "持ち家の住宅ローンは完済している（架空の例）"],
  },
  {
    id: "sampleFamilyDreams",
    family: 3,
    age: 4,
    rev: 1,
    title: "共働きの夫婦と子2人・40代（夢プランの見本）",
    traits: ["会社員", "共働き", "持ち家", "住宅ローン", "教育費"],
    targetAge: 95,
    steps: { retireAge: [60, 62, 65, 68, 70], pensionAge: [65, 68, 70, 72, 75], nisaMonthly: [0, 30000, 50000, 70000], livingMonthly: [300000, 320000, 340000, 360000] },
    firstProposal: { nisaMonthly: 50000, livingMonthly: 320000 },
    notes: { retireAge: "ご本人は65歳まで正社員（配偶者は60歳まで）", nisaMonthly: "働いている間、毎月積み立てる", livingMonthly: "子の独立後は85%、退職後は80%、80歳から70%" },
    memo: [
      "夢は7件を聞き取った。家族旅行・車の買い替え・リフォーム・キャンプは最初から計算に入れ、長女の結婚の援助・退職後のゴルフ・二拠点の暮らしは「最初から計算に入れない」で置いた（架空の例）",
      "キャンプと二拠点の暮らしは額が未入力（次回に聞く）。長女の結婚の援助は、本人たちが望めば（架空の例）",
      "下の子の私立高校・自宅外の大学（2036〜2039年）と、リフォーム（2040年）の間が金融資産のいちばん少ない時期（架空の例）",
    ],
    plans: [
      { name: "プランB NISA を月5万円に増やす", tags: ["運用"], values: { "lever:nisaMonthly": 50000 } },
      { name: "プランC 68歳まで働く", tags: ["老後"], values: { "lever:retireAge": 68 } },
    ],
  },
];

/**
 * 法人経営者の見本（合算BS と同じコードで出す。0247 の7）。会社の数字は見本の定義の extValues に置く（モデル世帯のファイルには入れない。0197 の1）
 */
const CORPORATE_OWNER: readonly DemoHousehold[] = [
  // 2026-11-11 に足した見本（架空）: 合算BS（会社と合わせたバランスシート）を見せる世帯。会社の数字も入れておく（0197 の1）。
  // 会社の名前は出さない（数字だけ）。2026-11-26 に「平均的な中小企業の経営者」の数字に直した（rev 2。0247 の10）。
  // 会社の試算表は中小企業庁「中小企業実態基本調査」令和7年確報（令和6年度決算）の売上高1億円超〜5億円の法人の1社あたりの額を丸めた値。
  // 根拠の一覧は data/modelHouseholds/README.md
  {
    id: "sampleOwnerCompany",
    family: 3,
    age: 5,
    rev: 2,
    title: "社員15人の会社を経営する夫婦と子1人・50代",
    traits: ["役員", "片働き", "持ち家", "教育費", "資産運用"],
    targetAge: 95,
    steps: { retireAge: [65, 68, 70, 72, 75], pensionAge: [65, 68, 70, 72, 75], nisaMonthly: [0, 30000, 50000, 100000], livingMonthly: [360000, 380000, 400000, 440000] },
    firstProposal: { retireAge: 72, pensionAge: 70, nisaMonthly: 100000, livingMonthly: 380000 },
    notes: { retireAge: "代表を退く年齢（退くときに役員退職慰労金）", pensionAge: "代表を続けて役員報酬を受け取る間は、在職老齢年金で一部が止まる", livingMonthly: "子の独立後は85%、退任後は85%、80歳から75%" },
    memo: [
      "2010年に自分で作った会社（社員15人ほど・売上高は年2億2,000万円ほど）の代表。役員報酬は年780万円（月65万円）、自社株は出資額1,000万円で全部を持つ（架空の例）",
      "会社に500万円を貸している。会社の試算表では「役員からの借入金」が600万円（家計の側の書き漏れの見本。合算BS のお知らせに出る。架空の例）",
      "会社の長期借入金6,600万円の全額を連帯保証。役員退職慰労金（最終報酬月額65万円×在任年数×3.0倍）は、会社の保険積立金などで準備している（架空の例）",
    ],
    plans: [
      { name: "プランB 年金を70歳から受け取る", tags: ["老後"], values: { "lever:pensionAge": 70 } },
      { name: "プランC 72歳まで代表を続ける", tags: ["老後"], values: { "lever:retireAge": 72 } },
    ],
    extValues: {
      "ext.official.combinedBs": {
        asOf: "2026-09",
        // 借入の返済（monthlyLoanPay）は、統計に返済の額が無いので入れていない
        amounts: {
          cash: 67_000_000,
          receivables: 24_000_000,
          inventory: 15_000_000,
          otherCurrent: 16_000_000,
          land: 41_000_000,
          buildings: 43_000_000,
          investments: 30_000_000,
          otherFixed: 2_000_000,
          shortDebt: 11_000_000,
          longDebt: 66_000_000,
          loanFromOwner: 6_000_000,
          otherLiabilities: 52_000_000,
          capital: 10_000_000,
          retained: 93_000_000,
          monthlyFixed: 6_000_000,
        },
        stage: "mature",
        // 実力に直す点検: 統計は無い。前の版と同じ割合（在庫75%・建物など67%・土地140%）を丸めた見本の設定
        restated: { inventory: 11_000_000, buildings: 29_000_000, land: 57_000_000 },
      },
    },
  },
];

/** アプリに入っている見本のセット（この順に並べる） */
export const SAMPLE_SETS: readonly SampleSet[] = [
  { id: "official.basic", name: "ファイナンシアの見本", samples: BASIC },
  { id: "official.corporateOwner", name: "法人経営者の見本", feature: "combinedBs", samples: CORPORATE_OWNER },
];

/**
 * セットを今出すか（0247 の7）。feature の無いセットはいつも出す。feature のあるセットは、その機能のコード（0110）が今使えて、
 * 事務所の既定値の印（defaults.features）が付いているときだけ。公式の拡張が出る条件（extensions/run.ts の activeExtensions）と同じ
 * （世帯の条件 activation.households は見本のセットには使わない。0114 の追記）
 */
export function sampleSetShown(set: Pick<SampleSet, "feature">, features: FeatureStatus, office: OfficeFeatures): boolean {
  const f = set.feature;
  return f === undefined || (featureOn(features, f) && office[f] === true);
}

/** 今出すセット（定義の順） */
export const shownSampleSets = (sets: readonly SampleSet[], features: FeatureStatus, office: OfficeFeatures): SampleSet[] => sets.filter((set) => sampleSetShown(set, features, office));

/** はじめて起動したとき（前回の世帯が無いとき）に開く見本の ID（並びの1「共働き・子2人・40代（資産運用）」。FP が扱う世帯として一般的なため。0247 の9 の追記） */
export const FIRST_SAMPLE_ID = "sampleDualAssetsInvest";

/** 起動のときに開く見本: FIRST_SAMPLE_ID が出せる見本の中にあればそれ、無ければ並びの先頭（出せる見本が無ければ undefined） */
export function firstSampleId(available: readonly { id: string }[]): string | undefined {
  return available.some((d) => d.id === FIRST_SAMPLE_ID) ? FIRST_SAMPLE_ID : available[0]?.id;
}
