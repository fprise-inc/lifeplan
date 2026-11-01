// 世帯を離れる前の確かめ（中央のパネル）: 自動保存に失敗したまま、世帯を切り替える・アプリを閉じようとしたとき。
// 黙って捨てずに、保存し直す・変更を捨てて離れる・やめる（この世帯を開いたまま）を選ばせる。
// 分岐（ほかの PC・ほかの人が先に保存していた）のときは、保存し直しても同じなので、分岐を選ぶ画面へ案内する
import { ChoicePanel, type Choice } from "../ChoicePanel.tsx";

/** 選んだもの（fork は分岐を選ぶ画面を開く。離れるのはやめる） */
export type LeaveDialogChoice = "retry" | "discard" | "cancel" | "fork";

export interface LeaveDialogProps {
  customerNo: string;
  /** 保存の失敗の符号 */
  code: string;
  /** 世帯を切り替える・アプリを閉じる */
  action: "switch" | "close";
  /** 保存し直している間 */
  busy: boolean;
  /** 保存し直しても保存できなかったときの一文 */
  error: string | null;
  /** 失敗の符号 → 理由の文 */
  message: (code: string) => string;
  onChoose: (c: LeaveDialogChoice) => void;
}

export function LeaveDialog(p: LeaveDialogProps) {
  const verb = p.action === "close" ? "閉じる" : "切り替える";
  const stem = p.action === "close" ? "閉じ" : "切り替え";
  const keep: Choice<LeaveDialogChoice> =
    p.code === "E_STORE_CONFLICT"
      ? { key: "fork", label: "分岐を選ぶ", note: `どちらの内容を残すかを選びます（${verb}のはやめます）`, primary: true }
      : { key: "retry", label: "保存し直す", note: `もう一度保存して、保存できたら${stem}ます`, primary: true };
  const choices: Choice<LeaveDialogChoice>[] = [
    keep,
    { key: "discard", label: `変更を捨てて${verb}`, note: "最後に保存できたところまでの内容が残ります" },
    { key: "cancel", label: "やめる", note: "この世帯を開いたままにします（あとで保存し直せます）" },
  ];
  return (
    <ChoicePanel name="leave" title={`世帯 ${p.customerNo} の変更を保存できていません`} choices={choices} cancel="cancel" busy={p.busy} busyLabel={{ retry: "保存しています…" }} onChoose={p.onChoose}>
      <p data-leave-dialog={p.action}>
        {p.message(p.code)}。このまま{verb}と、保存できていない変更はなくなります。
      </p>
      {p.error !== null ? (
        <p class="fatal" role="status">
          {p.error}
        </p>
      ) : null}
    </ChoicePanel>
  );
}
