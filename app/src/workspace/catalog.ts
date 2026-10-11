// 開ける世帯の一覧（当面は、リポジトリの架空のモデル世帯だけ。入力画面・保存・暗号化は次の回）
import type { LeverValues, Reemployment } from "./levers.ts";

export interface LeverSteps {
  retireAge: number[];
  pensionAge: number[];
  nisaMonthly: number[];
  livingMonthly: number[];
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
