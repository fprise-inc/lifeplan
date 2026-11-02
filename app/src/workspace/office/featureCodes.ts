// 機能を有効にするコード（0110）: 提供元がコードを渡した FP だけが使える機能（今は合算BS。0107）。
// - 本物か・期限内かは本体（Rust）が確かめ、画面は返った状態（FeatureStatus）を出すだけ。画面は自分で確かめない・コードの文字列を持たない
// - コードを入れていない FP には、その機能の設定の区画も画面も出さない（このファイルの文も出さない）
// - 期限が切れたら、設定の区画と画面は出さない。世帯に入れたデータ（会社の数字など）は消さない（見られなくなった旨と、入れ直せば戻ることを知らせる）
// - 期限の30日前から、区画に更新の知らせを出す（期限なしのコードは出さない）
// - 提供元が止めたコード（配信元の止めた一覧に載っている）は、期限切れと同じ扱い（区画と画面は出さない・データは消さない）。
//   一覧から外れたら、次に確かめたときに自動で戻る（入れ直しは要らない）
// - 切れた・止めたの知らせ（事務所の既定値の画面と資産と負債のタブの一文）は、分かった日から7日だけ出す。FP が閉じたら、その前でも出さない。
//   出すかは本体が決め（FeatureCodeView.notice）、画面はそれに従うだけ。知らせが消えてもコードは残り、データも消さない
import type { FeatureCandidateView, FeatureCheckView, FeatureCodeView, FeatureStatus } from "../../engine/host.ts";

export type { FeatureCandidateView, FeatureCheckView, FeatureCodeView, FeatureStatus } from "../../engine/host.ts";

/** コードで有効にできる機能（本体の crates/feature-code の FEATURES と同じ名前） */
export type FeatureId = "combinedBs";

export const FEATURE_LABELS: Readonly<Record<FeatureId, string>> = {
  combinedBs: "合算BS（経営者個人と会社のバランスシート）",
};

/** 読めないとき・まだ読んでいないとき（どの機能も使えない） */
export const NO_FEATURES: FeatureStatus = { today: "", active: [], codes: [], invalid: [] };

/** その機能が今使えるか（期限内のコードのどれかに入っている） */
export const featureOn = (st: FeatureStatus, f: FeatureId): boolean => st.active.includes(f);

/** 使えるコードか（期限内。止めていない） */
const usable = (c: FeatureCodeView): boolean => c.state === "active" || c.state === "expiring";
/** 期限の遅い順（期限なしがいちばん遅い） */
const laterFirst = (a: FeatureCodeView, b: FeatureCodeView): number => (a.expires === b.expires ? 0 : a.expires === null ? -1 : b.expires === null ? 1 : a.expires < b.expires ? 1 : -1);

/** その機能を有効にしている期限内のコード（期限のいちばん遅いもの） */
export function codeFor(st: FeatureStatus, f: FeatureId): FeatureCodeView | null {
  return st.codes.filter((c) => usable(c) && c.features.includes(f)).sort(laterFirst)[0] ?? null;
}

/**
 * その機能が使えなくなった（期限の切れた・止めたコードだけがある）ときの、知らせを出すいちばん新しいコード（止めたものを先に）。
 * 知らせを出さなくなったコード（分かった日から7日たった・閉じた）は除く（資産と負債のタブの一文も、事務所の既定値の知らせと一緒に消える）
 */
export function expiredFor(st: FeatureStatus, f: FeatureId): FeatureCodeView | null {
  if (featureOn(st, f)) return null;
  const gone = st.codes.filter((c) => !usable(c) && c.notice && c.features.includes(f));
  return gone.filter((c) => c.state === "revoked").sort(laterFirst)[0] ?? gone.sort(laterFirst)[0] ?? null;
}

/** 期限の書き方（「期限 2027-05-31」「期限なし」） */
export const expiresLabel = (expires: string | null): string => (expires === null ? "期限なし" : `期限 ${expires}`);

/** 区画に出す1行（「○○さん向けに有効（期限 2027-05-31）」「○○さん向けに有効（期限なし）」） */
export const enabledLine = (c: FeatureCodeView): string => `${c.name}さん向けに有効（${expiresLabel(c.expires)}）`;

/** 期限の30日前からの更新の知らせ */
export function renewText(c: FeatureCodeView): string | null {
  if (c.state !== "expiring" || c.daysLeft === null) return null;
  const when = c.daysLeft <= 0 ? `期限は今日（${c.expires}）までです。` : `期限まであと${c.daysLeft}日です（${c.expires} まで）。`;
  return `${when}続けて使うときは、提供元から新しいコードを受け取り、この画面のいちばん下の「機能を有効にするコードを入れる」から入れてください（入れ直すまでは今のまま使えます）。`;
}

const featureNames = (c: { features: readonly string[] }): string => c.features.map((f) => FEATURE_LABELS[f as FeatureId] ?? f).join("・");

/** 期限の切れた・提供元が止めたコードの知らせ（事務所の既定値の画面） */
export const expiredText = (c: FeatureCodeView): string =>
  c.state === "revoked"
    ? `${featureNames(c)}のコード（${c.name}さん向け）は、提供元が止めました。設定の区画と画面には出なくなりましたが、世帯に入れた会社の数字などのデータは消していません。提供元が止めるのをやめると、次に確かめたときに自動で戻ります（コードを入れ直す必要はありません）。分からないときは、コードを受け取った所に問い合わせてください。`
    : `${featureNames(c)}のコード（${c.name}さん向け）は ${c.expires} で期限が切れました。設定の区画と画面には出なくなりましたが、世帯に入れた会社の数字などのデータは消していません。新しいコードを入れると、また見られます。`;

/** 事務所の既定値の画面で、切れた・止めたの知らせに添える一言 */
export const NOTICE_FADE_TEXT = "この知らせは7日たつと消えます。";

/** 事務所の既定値の画面に知らせを出すコード（切れた・止めたもので、同じ機能を使えるほかのコードが無く、本体が出すとしたもの） */
export const noticeCodes = (st: FeatureStatus): FeatureCodeView[] => st.codes.filter((c) => !usable(c) && c.notice && !c.features.some((f) => featureOn(st, f as FeatureId)));

/** 資産と負債のタブ: 合算BS の会社の数字が入っている世帯で、コードの期限が切れた・提供元が止めたとき */
export const combinedHiddenText = (c: FeatureCodeView): string =>
  c.state === "revoked"
    ? "この世帯には会社の数字（合算BS）が入っています。合算BS のコードを提供元が止めたため、今は見られません。データは消していません。提供元が止めるのをやめると、自動で戻ります（世帯の一覧の「事務所の既定値」のいちばん下に知らせが出ています）。"
    : `この世帯には会社の数字（合算BS）が入っています。合算BS のコードの期限（${c.expires}）が切れたため、今は見られません。データは消していません。新しいコードを入れると、また見られます（世帯の一覧の「事務所の既定値」のいちばん下から）。`;

/** 日時（UTC の ISO）を日本の日付にする */
const jstDate = (iso: string): string => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso.slice(0, 10) : new Date(t + 9 * 3600_000).toISOString().slice(0, 10);
};

/**
 * 止めた一覧の確かめの様子（事務所の既定値のいちばん下。コードを入れている FP にだけ出す）。
 * 例: 「提供元が止めたコードの一覧は 2026-11-01 に確かめました。」「…つながらなかったので、2026-10-30 に取れた一覧で判断しています。」
 */
export function checkText(ch: FeatureCheckView | undefined): string | null {
  if (ch === undefined) return null;
  if (ch.checkedAt === null) return "提供元が止めたコードの一覧は、まだ確かめていません（起動したときと、1日1回確かめます）。";
  const at = jstDate(ch.checkedAt);
  if (ch.result === "ok") return `提供元が止めたコードの一覧は ${at} に確かめました。`;
  const basis = ch.okAt === null ? "まだ一度も一覧を取れていないので、どのコードも止めていません（今のまま使えます）。" : `${jstDate(ch.okAt)} に取れた一覧で判断しています（次に取れるまで、今の状態のままです）。`;
  return ch.result === "offline" ? `提供元が止めたコードの一覧を ${at} に確かめに行きましたが、つながりませんでした。${basis}` : `${at} に取れた一覧は、正しい形・署名ではなかったので使っていません。${basis}`;
}

/** AIからの候補の、入れる前と後の1行（「合算BS: 使えない → 使える」） */
export function candidateChange(c: FeatureCandidateView): { feature: string; before: boolean; after: boolean }[] {
  const ids = [...new Set([...c.features, ...c.before, ...c.after])].filter((f): f is FeatureId => f in FEATURE_LABELS);
  return ids.map((f) => ({ feature: FEATURE_LABELS[f], before: c.before.includes(f), after: c.after.includes(f) }));
}

/** 入れられなかったときの文（本体の符号から） */
export function featureErrorText(e: unknown): string {
  const code = typeof e === "string" ? e : e instanceof Error ? e.message : "";
  switch (code) {
    case "E_FEATURE_CODE_FORMAT":
      return "コードの形が違います。途中で切れていないか、ほかの文字が混ざっていないかを確かめて、もう一度貼り付けてください。";
    case "E_FEATURE_CODE_KEY":
      return "このアプリでは確かめられないコードです（発行した鍵が違います）。アプリを新しくするか、コードを受け取った所に問い合わせてください。";
    case "E_FEATURE_CODE_SIGNATURE":
      return "コードが正しくありません。写し間違いがないかを確かめてください（一部を書き換えたコードは使えません）。";
    case "E_FEATURE_CODE_EXPIRED":
      return "このコードは期限が切れています。新しいコードを受け取ってください。";
    case "E_FEATURE_CODE_REVOKED":
      return "このコードは提供元が止めています。コードを受け取った所に問い合わせてください。";
    case "E_FEATURE_CODE_CANDIDATE_UNKNOWN":
      return "この候補はもうありません（アプリを閉じた・AI接続口をオフにした、など）。";
    case "E_FEATURE_CODE_NO_FEATURE":
      return "この版のアプリで使える機能が入っていないコードです。アプリを新しくしてから入れてください。";
    case "E_FEATURE_CODE_LIMIT":
      return "入れておけるコードの数（16）を超えます。使わないコードを外してから入れてください。";
    default:
      return `入れられませんでした（${code || "E_FEATURE_CODE"}）`;
  }
}
