// 見本を直せるようにしたときの中央のパネル（0247 の5・6）:
// - 見本を最初の状態に戻す確認画面（セットの見本を直した版は、直した版を消す。取り消せない。自分で作った見本は、中身を最初の状態に置き換える。
//   戻す前の中身は直前の世代に1つだけ残る）
// - 自分で作った見本の「今の状態を最初の状態にする」確認画面（中身は変えない。前の最初の状態には戻せなくなる）
// - ほかの人が先にこの見本を直していたときに選ぶ画面（先にある版を開く・今の中身を複製する・あとで選ぶ。今の変更は黙って捨てない）
import { ChoicePanel, type Choice } from "../ChoicePanel.tsx";

/**
 * 見本を開いているときの帯の文（見本「名前」〔家族の形・年代・架空〕を開いています。の後。2026-11-25 の利用者の判断）。直していない見本でも同じ文
 * （変えた時に保存が始まる）。自分で作った見本も同じ
 */
export const SAMPLE_BAND_TEXT = "数字を変えると、変えた内容はこの見本に残ります。元の内容に戻したいときは「最初の状態に戻す」を押してください。";

/** セットの見本を直した版の、元の見本（アプリの中の見本）の中身の版が新しくなったとき（0247 の5） */
export const SAMPLE_STALE_TEXT = "元の見本が新しくなっています（最初の状態に戻すと新しい中身になります）";

/** 見本の一覧の、セットの見本を直した版の行の印 */
export const SAMPLE_CHANGED_MARK = "変えた内容あり";

/** 前の版を使っていた人に1回だけ出す知らせ（世帯の一覧の見本の所。0247 の4） */
export const SAMPLE_EDITABLE_NOTICE = "見本は直せるようになりました。元に戻すときは「最初の状態に戻す」";

export type SampleResetChoice = "reset" | "cancel";

/** 見本を最初の状態に戻す確認画面の文（セットの見本を直した版。0247 の6） */
export const SAMPLE_RESET_TEXT = "この見本を最初の状態に戻します。直した中身（プラン・控え・面談の履歴・メモ・読み取った書類）は消えます。取り消せません。残したいときは、先に「複製する」で自分の見本にしてください。";

/**
 * 見本を最初の状態に戻す確認画面の文（自分で作った見本。0247 の6）。「取り消せません」の代わりに、戻す前の中身が直前の世代に1つだけ残ること
 * （次に保存すると入れ替わる）を書く
 */
export const OWN_SAMPLE_RESET_TEXT = "この見本を最初の状態（見本に登録・複製したとき、または「今の状態を最初の状態にする」を押したときの中身）に戻します。直した中身（プラン・控え・面談の履歴・メモ・読み取った書類）は消えます。戻す前の中身は、直前の世代として1つだけ残ります（次に保存すると入れ替わります）。残したいときは、先に「複製する」で別の見本にしてください。";

export function SampleResetDialog(p: { name: string; own?: boolean; busy: boolean; error: string | null; onChoose: (c: SampleResetChoice) => void }) {
  const choices: Choice<SampleResetChoice>[] = [
    { key: "reset", label: "最初の状態に戻す", note: p.own === true ? "直した中身を、この見本の最初の状態の中身に置き換えます" : "直した中身を消し、アプリに入っている見本の中身に戻します" },
    { key: "cancel", label: "やめる", note: "直した中身のまま残します" },
  ];
  return (
    <ChoicePanel name="sample-reset" title={`見本「${p.name}」を最初の状態に戻す`} choices={choices} cancel="cancel" busy={p.busy} busyLabel={{ reset: "戻しています…" }} onChoose={p.onChoose}>
      <p data-sample-reset-text>{p.own === true ? OWN_SAMPLE_RESET_TEXT : SAMPLE_RESET_TEXT}</p>
      {p.error !== null ? (
        <p class="fatal" role="status">
          {p.error}
        </p>
      ) : null}
    </ChoicePanel>
  );
}

export type SampleSetInitialChoice = "set" | "cancel";

/** 「今の状態を最初の状態にする」確認画面の文（自分で作った見本。0247 の6） */
export const SAMPLE_SET_INITIAL_TEXT = "この見本の今の中身を、最初の状態にします。これからは「最初の状態に戻す」を押すと、今の中身に戻ります。今までの最初の状態には戻せなくなります。";

export function SampleSetInitialDialog(p: { name: string; busy: boolean; error: string | null; onChoose: (c: SampleSetInitialChoice) => void }) {
  const choices: Choice<SampleSetInitialChoice>[] = [
    { key: "set", label: "今の状態を最初の状態にする", note: "見本の中身は変えません" },
    { key: "cancel", label: "やめる", note: "最初の状態はそのままです" },
  ];
  return (
    <ChoicePanel name="sample-set-initial" title={`見本「${p.name}」の今の状態を最初の状態にする`} choices={choices} cancel="cancel" busy={p.busy} busyLabel={{ set: "書いています…" }} onChoose={p.onChoose}>
      <p data-sample-set-initial-text>{SAMPLE_SET_INITIAL_TEXT}</p>
      {p.error !== null ? (
        <p class="fatal" role="status">
          {p.error}
        </p>
      ) : null}
    </ChoicePanel>
  );
}

export type SampleExistsChoice = "open" | "copy" | "later";

export function SampleExistsDialog(p: { name: string; by: string | null; busy: boolean; error: string | null; onChoose: (c: SampleExistsChoice) => void }) {
  const choices: Choice<SampleExistsChoice>[] = [
    { key: "open", label: "先にある版を開く", note: "この画面で変えた内容は残りません" },
    { key: "copy", label: "今の中身を複製する", note: "この画面の中身を、自分で作った見本として保存します（先にある版はそのまま）" },
    { key: "later", label: "あとで選ぶ", note: "このまま開いておきます（変えた内容は、まだ保存していません）" },
  ];
  return (
    <ChoicePanel name="sample-exists" title={`見本「${p.name}」は、ほかの人が先に直していました`} choices={choices} cancel="later" busy={p.busy} onChoose={p.onChoose}>
      <p data-sample-exists-text>
        {p.by !== null ? `${p.by}さん` : "ほかの人（ほかの PC）"}が先にこの見本を直して保存していたため、この画面で変えた内容は、この見本に保存できませんでした。先にある版を開くか、今の中身を複製して自分の見本にするかを選んでください。
      </p>
      {p.error !== null ? (
        <p class="fatal" role="status">
          {p.error}
        </p>
      ) : null}
    </ChoicePanel>
  );
}
