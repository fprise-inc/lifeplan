// カスタム層の説明の文（0016 の追記 2026-11-02）の、お知らせの一覧（0087）の事務所の知らせ。今の状態の知らせなので、決めると一覧から消える
import type { CustomTextsStatus } from "../../engine/host.ts";
import type { CenterItem } from "../notices/center.ts";
import { officialUpdates, type OfficeEstimates } from "./estimates.ts";

export type CustomCenterNotice = Omit<CenterItem, "action" | "read">;

const base = { category: "office" as const, urgency: "normal" as const, date: null, household: null, receipts: [] as string[] };

export function customCenterNotice(st: CustomTextsStatus | null): CustomCenterNotice[] {
  if (st === null) return [];
  if (st.kind !== undefined && st.kind !== "texts") return otherKindNotice(st);
  const out: CustomCenterNotice[] = [];
  if (st.ledgerReset) {
    out.push({ ...base, key: "office:customTexts:ledger", title: "カスタム層の承認の記録を確かめられませんでした", body: "承認の記録が書き換えられたか、事務所の鍵が変わったため、前の承認を無効にしました。画面には公式の文を出しています。事務所の既定値の画面で中身を確かめ、承認し直してください。" });
  }
  if (st.state === "pending") {
    out.push({ ...base, key: `office:customTexts:pending:${st.fingerprint}`, title: "カスタム層の説明の文が変わりました（承認待ち）", body: "事務所の既定値の画面の「説明の文（カスタム層）」で中身を確かめ、使ってよいときだけ承認してください。承認するまでは今の文のまま出します。" });
  }
  if (st.updates.length > 0) {
    out.push({ ...base, key: `office:customTexts:updates:${st.approved?.fingerprint ?? ""}:${st.updates.length}`, title: `アプリの更新で、事務所の文を使っている公式の説明が${st.updates.length}か所変わりました`, body: "事務所の既定値の画面で、前の公式の文・新しい公式の文・事務所の文を並べて確かめられます。ふつうは事務所の文をそのまま使い続け、意味が変わった所だけは確かめるまで公式の文を出します。" });
  }
  return out;
}

/** 名前・欄の見せ方の知らせ（承認待ち・公式の名前が変わった所。台帳の知らせは説明の文の側で1回だけ出す） */
function otherKindNotice(st: CustomTextsStatus): CustomCenterNotice[] {
  const k = st.kind === "terms" ? { key: "customTerms", what: "名前", file: "settings/terms.json", where: "名前（カスタム層）" } : { key: "customFields", what: "入力の欄の見せ方", file: "settings/fields.json", where: "入力の欄の見せ方（カスタム層）" };
  const out: CustomCenterNotice[] = [];
  if (st.state === "pending") {
    out.push({ ...base, key: `office:${k.key}:pending:${st.fingerprint}`, title: `カスタム層の${k.what}が変わりました（承認待ち）`, body: `事務所の既定値の画面の「${k.where}」で中身（${k.file}）を確かめ、使ってよいときだけ承認してください。承認するまでは今のまま出します。` });
  }
  if (st.updates.length > 0) {
    out.push({ ...base, key: `office:${k.key}:updates:${st.approved?.fingerprint ?? ""}:${st.updates.length}`, title: `アプリの更新で、事務所の${k.what}を使っている公式の名前が${st.updates.length}か所変わりました`, body: "事務所の既定値の画面で、前の公式の名前・新しい公式の名前・事務所の名前を並べて確かめられます。ふつうは事務所の名前をそのまま使い続けます。" });
  }
  return out;
}

/**
 * 事務所の推定の値（0111）のうち、公式の値が新しくなった物の知らせ（今の状態の知らせ。「このまま」か「公式に戻す」を選ぶと一覧から消える）。
 * 鍵に今の公式の値の版を入れる（もう一度新しくなったら、また未読で出る）
 */
export function estimateCenterNotice(e: OfficeEstimates | undefined): CustomCenterNotice[] {
  return officialUpdates(e).map((u) => ({
    ...base,
    key: `office:estimates:update:${u.id}:${String(u.rev)}`,
    title: u.broken ? `公式の統計の表が変わり、事務所の値を使えなくなりました（${u.name}）` : `公式の統計の値が新しくなりました（${u.name}）`,
    body: `前 ${u.change}。${u.broken ? "今は公式の値で計算しています。" : "今は事務所の値を使い続けています。"}事務所の既定値の画面の「推定の値（統計）」で、${u.broken ? "公式に戻すか値を入れ直してください" : "「このまま」か「公式に戻す」を選んでください"}。`,
  }));
}
