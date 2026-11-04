// 保存先（このPCの中・同期フォルダ）と同期の通知の画面の側の小さな部品（0024）: 文言・通知の文。
// 同期フォルダの場所と鍵は本体だけが持ち、画面には来ない。通知（StorageNotice）は、世帯の一覧・保存先・事務所の設定のパネルに出し、
// 画面の上の帯の「通知」にもまとめられるよう、文を作る関数をここに置く
import type { StorageNotice } from "../../engine/host.ts";
import { OFFICE_MESSAGES } from "./office.ts";

export const SYNC_MESSAGES: Record<string, string> = {
  E_SYNC_RECOVERY_REQUIRED: "先に復元キーを保管してください。2台目のPCで同期フォルダを開くときに要ります",
  E_SYNC_IS_OFFICE: "このフォルダは、事務所での共有（複数のFP）に使われています。「事務所の共有」の「参加する」から申請してください",
  E_SYNC_PERSONAL: "1人で使う同期フォルダでは、参加の申請を承認できません",
  E_SYNC_OTHER_PC_OPEN: "もう1台のPCで世帯を開いています。そのPCでファイナンシアを閉じ、同期が終わってからもう一度操作してください",
  E_OFFICE_NAME: "PCの呼び名は1〜20文字で入れてください（例: 事務所のPC・自宅のノート）",
  E_OFFICE_EXISTS: "そのフォルダには、既にファイナンシアの保存先があります。2台目のPCなら「すでに使っている同期フォルダを開く」を使ってください",
  E_OFFICE_NOT_FOUND: "そのフォルダにファイナンシアの保存先が見つかりません。1台目のPCで選んだ同期フォルダと同じフォルダを選んでください（同期が終わっているかも確かめてください）",
  E_OFFICE_FORMAT_TOO_NEW: "同期フォルダのファイルが、新しい版のアプリで書かれています。このPCのアプリも更新してください",
  E_OFFICE_UNAVAILABLE: "同期フォルダが見つかりません（同期サービスの停止・フォルダの移動・外付けのドライブを確かめてください）",
  E_OFFICE_CLOSED: "この同期フォルダは使われなくなりました（もう1台のPCで、保存先をそのPCの中へ戻しました）",
  E_OFFICE_REMOVED: "このPCは、同期フォルダから外されました",
  E_OFFICE_KEY_MISSING: "このPCの鍵が見つかりません。このPCの中に戻ってから、「すでに使っている同期フォルダを開く」で開き直してください",
  E_OFFICE_CONFIRM: "確認のPCの呼び名が違います",
  E_OFFICE_SELF: "このPC自身は外せません",
  E_OFFICE_RECOVERY_REQUIRED: "新しい復元キーがまだ保管されていません。保管するまで、PCを外す操作は止めています",
  E_RECOVERY_MISMATCH: "この同期フォルダの今の復元キーではありません（PCを外すと復元キーは新しくなり、古い控えでは開けません）",
};

/** 1人で複数の PC の同期フォルダの操作の失敗の文（同期フォルダ向けの文が無ければ、事務所の共有の文） */
export const syncMessage = (code: string) => SYNC_MESSAGES[code] ?? OFFICE_MESSAGES[code] ?? `保存先の操作に失敗しました（${code}）`;

/** 通知の文（世帯の一覧・保存先のパネル・画面の上の帯で同じ文を使う） */
export function storageNoticeText(n: StorageNotice): string {
  const personal = n.scope === "personal";
  const where = personal ? "同期フォルダ" : "事務所の共有フォルダ";
  switch (n.kind) {
    case "needsRecovery":
      return "このPCの保管庫に事務所の鍵が見つかりません。復元キーを入れてください";
    case "recoveryNotKept":
      return n.scope === "local" ? "復元キーをまだ保管していません" : personal ? "同期フォルダの復元キーをまだ保管していません（PCを外したときは新しくなります）" : "事務所の復元キーをまだ保管していません";
    case "unavailable":
      return personal ? (n.code !== null ? (SYNC_MESSAGES[n.code] ?? `同期フォルダを使えません（${n.code}）`) : "同期フォルダを使えません") : (OFFICE_MESSAGES[n.code ?? ""] ?? "共有フォルダを使えません");
    case "closed":
      return personal ? (SYNC_MESSAGES.E_OFFICE_CLOSED as string) : (OFFICE_MESSAGES.E_OFFICE_CLOSED as string);
    case "removed":
      return personal ? "このPCは同期フォルダから外されました" : "この事務所の共有から外されました";
    case "pending":
      return "事務所の共有への参加の承認を待っています";
    case "recoveryJoin":
      return personal ? `復元キーで「${n.name ?? ""}」が同期フォルダを開きました。心当たりが無ければ、すぐにそのPCを外してください` : `復元キーで${n.name ?? ""}さんが加わりました`;
    case "joinRequest":
      return personal ? `1人で使う同期フォルダに、参加の申請が${n.count ?? 0}件置かれています（承認はできません。心当たりが無ければ断ってください）` : `参加の申請が${n.count ?? 0}件あります`;
    case "localHouseholds":
      return `このPCの中に、まだ${where}へ移していない世帯が${n.count ?? 0}件あります`;
    case "syncCopies":
      return `同期サービスの衝突の写しがある世帯が${n.count ?? 0}件あります`;
    default:
      return `保存先の通知（${n.kind}）`;
  }
}

/** 開いている PC の文（1人で複数の PC のとき。「○○さん」ではなく PC の呼び名で） */
export const pcName = (name: string) => `「${name}」`;
