// 0006 の3: 差し込み口。設計として8つを固定し、正式公開の時に3つを開く
import { isUnder } from "../ids/cfTree.ts";

export interface SlotDefinition {
  readonly id: string;
  /** 外のカスタム部品に開いているか */
  readonly open: boolean;
  readonly contract: string;
  /** 出力してよい行の枝（行を出さない差し込み口は null） */
  readonly branch: string | null;
  /** 入出力の約束の JSON Schema のキー（原型があるものだけ） */
  readonly input: string | null;
  readonly output: string | null;
}

const def = (id: string, open: boolean, branch: string | null, input: string | null = null, output: string | null = null): SlotDefinition =>
  Object.freeze({ id, open, contract: "1.0", branch, input, output });

// open は「正式公開の時に開く」3つ。カスタム部品の読み込み（0016）はまだ無いので、今は公式とテストからだけ使う
export const SLOTS: ReadonlyMap<string, SlotDefinition> = new Map(
  [
    def("slot.expense.flow", true, "cf.expense", "slot.expense.flow.input", "flows.output"),
    def("slot.protection.method", true, null),
    def("slot.retirement.rules", true, null),
    def("slot.income.flow", false, "cf.income"),
    def("slot.lumpSum", false, null),
    def("slot.account", false, "cf.balance.account"),
    def("slot.insurance.table", false, null),
    def("slot.withdrawal.order", false, null),
  ].map((s) => [s.id, s]),
);

/** 差し込み口の枝の下の行か（枝の下の ext.<作成者>.<キー> を含む） */
export function rowAllowedInSlot(slot: SlotDefinition, row: string): boolean {
  return slot.branch !== null && isUnder(row, slot.branch);
}
