// アプリに入っている見本の世帯（すべて架空。data/modelHouseholds の世帯に、打ち手の目盛り・最初の提案・プランを添えたもの）。
// 見本は顧客番号を持たず、見本番号（家族の形-本人の年代-順番。順番 01〜09 はアプリの見本、10〜 は FP が作った見本）で並べる（0033）
import type { LeverValues, Reemployment } from "./levers.ts";
import type { Values } from "./plans/plans.ts";
import type { SnapshotTrigger } from "./snapshots/snapshots.ts";

export interface LeverSteps {
  retireAge: number[];
  pensionAge: number[];
  nisaMonthly: number[];
  livingMonthly: number[];
}

/** 見本の世帯に入れておくプラン（開いたときに保存したプランとして帯に並べる） */
export interface DemoPlan {
  /** 「プランB …」の形（帯の文字は名前の頭から決まる） */
  name: string;
  tags?: string[];
  /** 動かす項目の鍵（plans/items.ts）→ 値 */
  values: Values;
}

/**
 * 見本の世帯に入れておく控え（「前回と比べる」の見本）。その時点の世帯は、今の世帯の残高・評価額を balances で置き換えたもの。
 * 計算の基準の月は今の世帯と同じにする（制度データが持つ月より前の基準の月では計算できないため。中身は架空）
 */
export interface DemoSnapshot {
  /** 控えの ID（決まった値。UUID 第4版の形） */
  id: string;
  /** 作った日時（ISO 8601。端末の時差によらない固定の値） */
  createdAt: string;
  trigger: SnapshotTrigger;
  memo: string;
  /** 物の ID（口座・負債）→ その時点の残高（口座は時価、負債は残高） */
  balances: Record<string, number>;
}

export interface DemoHousehold {
  /** data/modelHouseholds/<id>.json */
  id: string;
  /** 見本番号（家族の形 1 単身・2 夫婦のみ・3 夫婦と子・4 ひとり親・5 シニア - 本人の年代 2〜7 - 順番 01〜09） */
  sampleNo: string;
  /** 見本の名前（共働き/片働き・会社員/自営業などは番号に入れず、名前と絞り込みの項目で見分ける） */
  title: string;
  /** 絞り込みの項目（store/numbering.ts の SAMPLE_TRAITS） */
  traits: readonly string[];
  /** 主役の数字を出す年齢（世帯の「本人」の年齢） */
  targetAge: number;
  steps: LeverSteps;
  /** 最初の提案（開いたときの打ち手） */
  firstProposal: Partial<LeverValues>;
  reemployment?: Reemployment;
  /** 打ち手の補足（スライダーの下の一文） */
  notes?: Partial<Record<keyof LeverValues, string>>;
  /** FP用のメモ（作業の層だけで持つ。提示層には渡さない。0016 の2） */
  memo: string[];
  /** 開いたときに帯に並べておくプラン（あれば firstProposal の代わりに使う） */
  plans?: readonly DemoPlan[];
  /** 開いたときに入れておく控え */
  snapshots?: readonly DemoSnapshot[];
  /**
   * 開いたときに入れておく拡張の束の入力欄の値（入力欄の値の置き場所 → 値。0114 の4）。合算BS の会社の数字など（0197）。
   * 世帯ファイルの拡張領域と同じ形で、開くときに束の宣言で確かめて読む（宣言に合わない値は捨てる）
   */
  extValues?: Readonly<Record<string, Record<string, unknown>>>;
}

export const DEMO_HOUSEHOLDS: readonly DemoHousehold[] = [
  {
    id: "salariedCoupleTwoKids",
    sampleNo: "3-4-01",
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
    sampleNo: "3-4-02",
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
    sampleNo: "3-4-03",
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
    id: "lifetime100Plan",
    sampleNo: "3-3-01",
    title: "共働きの夫婦と子1人（100年分）",
    traits: ["会社員", "共働き", "持ち家", "住宅ローン", "教育費"],
    targetAge: 95,
    steps: {
      retireAge: [60, 62, 65, 68, 70],
      pensionAge: [60, 65, 68, 70, 75],
      nisaMonthly: [0, 10000, 30000, 50000],
      livingMonthly: [220000, 240000, 260000, 280000],
    },
    firstProposal: {},
    memo: ["速さの計測に使う100年分の世帯（架空）"],
  },

  // ここから下は 2026-10-21 に足した見本（すべて架空。data/modelHouseholds/sample*.json。0033）
  {
    id: "sampleSingle20s",
    sampleNo: "1-2-01",
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
    sampleNo: "1-4-01",
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
    id: "sampleCoupleNoKids",
    sampleNo: "2-3-01",
    title: "共働きの夫婦・30代（子なし）",
    traits: ["会社員", "共働き", "賃貸"],
    targetAge: 95,
    steps: { retireAge: [60, 62, 65, 68, 70], pensionAge: [60, 65, 68, 70, 75], nisaMonthly: [0, 30000, 50000, 80000], livingMonthly: [290000, 310000, 330000, 350000] },
    firstProposal: { retireAge: 65, pensionAge: 65, nisaMonthly: 50000, livingMonthly: 310000 },
    notes: { retireAge: "妻は60歳まで働く想定", nisaMonthly: "夫の分（妻も月2万円を積み立てている）", livingMonthly: "家賃（月14万円）は別。退職後は85%、80歳から75%" },
    memo: ["5年以内に住宅の購入を考えている（架空の例）", "妻は60歳で退職する意向（架空の例）", "次回: 購入の予算と頭金を相談"],
  },
  {
    id: "sampleSingleParent",
    sampleNo: "4-3-01",
    title: "ひとり親と子2人・30代",
    traits: ["会社員", "賃貸", "教育費"],
    targetAge: 95,
    steps: { retireAge: [60, 62, 65, 68, 70], pensionAge: [60, 65, 68, 70, 75], nisaMonthly: [0, 10000, 20000, 30000], livingMonthly: [145000, 155000, 165000, 175000] },
    firstProposal: { retireAge: 65, pensionAge: 65, nisaMonthly: 20000, livingMonthly: 155000 },
    notes: { nisaMonthly: "働いている間、毎月積み立てる", livingMonthly: "家賃（月7.2万円）は別。子の独立後は70%、退職後は95%、80歳から85%" },
    memo: ["ひとり親の手当（児童扶養手当など）は計算に入れていない。児童手当は入る（架空の例）", "長女は国立大学（自宅）、長男は専門学校を希望。専門学校の学費は学校の案内の額（年110万円・入学金20万円。架空の例）"],
  },
  {
    id: "sampleSelfEmployedFamily",
    sampleNo: "3-4-04",
    title: "自営業の夫婦と子2人・40代",
    traits: ["自営業", "片働き", "持ち家", "住宅ローン", "教育費"],
    targetAge: 95,
    steps: { retireAge: [65, 68, 70, 72, 75], pensionAge: [60, 65, 68, 70, 75], nisaMonthly: [0, 30000, 50000, 70000], livingMonthly: [240000, 250000, 270000, 290000] },
    firstProposal: { retireAge: 70, pensionAge: 68, nisaMonthly: 50000, livingMonthly: 250000 },
    notes: { retireAge: "定年は無い。働く最後の年齢まで事業の所得が続く想定", pensionAge: "夫婦とも国民年金（老齢基礎年金）が中心", livingMonthly: "子の独立後は80%、仕事をやめた後は85%、80歳から80%" },
    memo: ["事業の所得は年850万円の想定（架空の例）", "付加年金・小規模企業共済にはまだ入っていない（架空の例）", "次回: 長女の私立高校と自宅外の大学の費用を確認"],
  },
  {
    id: "sampleSeniorCouple",
    sampleNo: "5-6-01",
    title: "シニア夫婦・60代（年金の繰下げ）",
    traits: ["年金生活", "持ち家", "資産運用"],
    targetAge: 95,
    steps: { retireAge: [67, 68, 70, 72], pensionAge: [67, 68, 70, 72, 75], nisaMonthly: [0, 10000, 30000, 50000], livingMonthly: [260000, 280000, 300000, 320000] },
    firstProposal: { retireAge: 70, pensionAge: 70, nisaMonthly: 30000, livingMonthly: 280000 },
    notes: { retireAge: "嘱託（週30時間・年収240万円）で働き続ける", pensionAge: "夫の年金は68歳まで繰り下げる予定（妻は65歳から）", nisaMonthly: "働いている間、毎月積み立てる", livingMonthly: "仕事をやめた後は90%、80歳から80%" },
    memo: ["夫は70歳まで嘱託で働く意向（架空の例）", "持ち家の住宅ローンは完済している（架空の例）"],
  },
  {
    id: "sampleExecutive",
    sampleNo: "3-5-01",
    title: "会社の役員の夫婦と子1人・50代",
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
  {
    id: "rentalSample",
    sampleNo: "3-4-05",
    title: "収益不動産を持つ会社員の夫婦と子1人",
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
  // 2026-11-07 に足した見本（すべて架空）: 親の介護と相続の画面を見せる2世帯。どちらも入力の画面の操作と同じ欄・ボタンで入れた世帯
  {
    id: "sampleParentsCare",
    sampleNo: "3-5-02",
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
    sampleNo: "3-6-01",
    title: "退職前後の夫婦・60代（企業年金・収益不動産・親の介護と相続）",
    traits: ["会社員", "共働き", "持ち家", "資産運用", "収益不動産", "親の介護・相続"],
    targetAge: 95,
    steps: { retireAge: [65, 66, 68, 70], pensionAge: [65, 68, 70, 75], nisaMonthly: [0, 10000, 30000, 50000], livingMonthly: [180000, 200000, 209000, 230000, 250000] },
    firstProposal: { retireAge: 68, nisaMonthly: 30000 },
    notes: { retireAge: "60歳で定年、今は再雇用（年収350万円）。配偶者はパート（年収100万円）" },
    memo: ["確定給付企業年金を65歳から年60万円・10年で受け取る（架空の例）", "持ち家は完済（1995年築）。区分マンション1室を月7万円で貸している（2010年に1,800万円で取得。架空の例）", "預金2,500万円・課税口座800万円・NISA（月1万円）（架空の例）", "母（89歳）の在宅の介護を月8万円で払う。母からの相続（1,500万円）の見込み（架空の例）"],
  },
  // 2026-11-11 に足した見本（架空）: 合算BS（会社と合わせたバランスシート）を見せる世帯。会社の数字も入れておく。
  // 見本の世帯は、機能を有効にするコードが無くても合算BS を見られる（0197）。会社の名前は出さない（数字だけ）
  {
    id: "sampleOwnerCompany",
    sampleNo: "3-5-03",
    title: "会社を経営する夫婦と子1人・50代（合算BS の見本）",
    traits: ["役員", "片働き", "持ち家", "教育費", "資産運用"],
    targetAge: 95,
    steps: { retireAge: [65, 68, 70, 72, 75], pensionAge: [65, 68, 70, 72, 75], nisaMonthly: [0, 50000, 100000, 200000], livingMonthly: [480000, 520000, 550000, 600000] },
    firstProposal: { retireAge: 72, pensionAge: 70, nisaMonthly: 100000, livingMonthly: 520000 },
    notes: { retireAge: "代表を退く年齢（退くときに役員退職慰労金）", pensionAge: "役員報酬が高い間は、在職老齢年金で止まる分がある", livingMonthly: "子の独立後は85%、退任後は85%、80歳から75%" },
    memo: [
      "2010年に自分で作った会社（社員40人ほど）の代表。役員報酬は年1,800万円、自社株は出資額1,000万円で全部を持つ（架空の例）",
      "会社に500万円を貸している。会社の試算表では「役員からの借入金」が600万円（家計の側の書き漏れの見本。合算BS のお知らせに出る。架空の例）",
      "会社の長期借入金6,000万円のうち5,000万円を連帯保証。役員退職慰労金（最終報酬月額150万円×在任年数×1.5倍）は、会社の保険積立金などで準備している（架空の例）",
    ],
    plans: [
      { name: "プランB 年金を70歳から受け取る", tags: ["老後"], values: { "lever:pensionAge": 70 } },
      { name: "プランC 72歳まで代表を続ける", tags: ["老後"], values: { "lever:retireAge": 72 } },
    ],
    extValues: {
      "ext.official.combinedBs": {
        asOf: "2026-09",
        amounts: {
          cash: 40_000_000,
          receivables: 25_000_000,
          inventory: 6_000_000,
          otherCurrent: 4_000_000,
          land: 25_000_000,
          buildings: 18_000_000,
          investments: 30_000_000,
          otherFixed: 7_000_000,
          shortDebt: 15_000_000,
          longDebt: 60_000_000,
          loanFromOwner: 6_000_000,
          otherLiabilities: 24_000_000,
          capital: 10_000_000,
          retained: 40_000_000,
          monthlyFixed: 8_000_000,
          monthlyLoanPay: 1_200_000,
        },
        stage: "mature",
        restated: { inventory: 4_500_000, buildings: 12_000_000, land: 35_000_000 },
      },
    },
  },
];

/** アプリの見本を見本番号の順に */
export const DEMO_BY_NUMBER: readonly DemoHousehold[] = [...DEMO_HOUSEHOLDS].sort((a, b) => (a.sampleNo < b.sampleNo ? -1 : a.sampleNo > b.sampleNo ? 1 : 0));

export function demoHousehold(id: string): DemoHousehold | undefined {
  return DEMO_HOUSEHOLDS.find((d) => d.id === id);
}
