// 開ける世帯の一覧（当面は、リポジトリの架空のモデル世帯だけ。入力画面・保存・暗号化は次の回）
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
  title: string;
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
}

export const DEMO_HOUSEHOLDS: readonly DemoHousehold[] = [
  {
    id: "salariedCoupleTwoKids",
    title: "会社員の夫婦と子2人",
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
    memo: ["退職金1,800万円は規程の確認待ち（架空の例）", "奥様は扶養内のパートを60歳まで続ける意向（架空の例）", "次回: 長男の進路の希望を確認"],
  },
  {
    id: "investmentCouple",
    title: "資産運用の見本（会社員の夫婦と子2人）",
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
    title: "共働きの夫婦と子2人（資産が多め）",
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
    memo: ["賃貸に出しているマンション1室の家賃収入は、まだ入れられない（架空の例）", "65歳から毎月35万円を取り崩す前提（架空の例）", "次回: 繰上返済と資産配分の見直しのどちらを先にするか相談"],
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
        id: "6f1d2c3b-8a4e-4d5f-9b6a-2c7e1f0a9d02",
        createdAt: "2025-10-18T14:00:00+09:00",
        trigger: "pdf",
        memo: "提案書（架空の例）",
        balances: {
          "b6088c23-3c27-45c8-99a5-ce3b42939948": 6800000, "8adae3ca-5be4-478a-9b9a-b41a7e84cae5": 3000000, "03c2def7-bbb4-4402-a039-abdb08cc570d": 5600000, "752e0859-a3aa-49f6-b023-992334633510": 2500000,
          "e4491ce1-3307-48dd-a3f5-4a6acda508df": 2250000, "87aa3bd4-0c70-48eb-96f0-1fe494baf74c": 1350000, "c7cb05a2-b26f-4c6a-aade-c7f62d13f41d": 4500000, "7fc64cf7-e50e-46f3-89f3-839d360b0667": 4300000,
          "1defd43d-2f75-4ba9-924c-8ab160d19f67": 2150000, "f36b05c7-0ada-457c-aaac-91c9fb8d4db6": 2200000, "8dbb796f-ef87-47f5-a95d-79ac9bb7bfed": 1550000, "97fdbe51-70e9-42c2-bf8f-eaa164206781": 18300000,
          "32ca6364-8bb4-4b27-a1af-55a261a6d310": 23900000, "ac6422fc-59f9-43c8-ad29-816e55d83de0": 1500000,
        },
      },
    ],
  },
  {
    id: "lifetime100Plan",
    title: "共働きの夫婦と子1人（100年分）",
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
];

export function demoHousehold(id: string): DemoHousehold | undefined {
  return DEMO_HOUSEHOLDS.find((d) => d.id === id);
}
