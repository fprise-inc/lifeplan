// カスタム層の説明の文（0016 の追記 2026-11-02）の、お知らせの一覧（0087）の事務所の知らせ。今の状態の知らせなので、決めると一覧から消える
import type { CustomTextsStatus } from "../../engine/host.ts";
import type { CenterItem } from "../notices/center.ts";

export type CustomCenterNotice = Omit<CenterItem, "action" | "read">;

const base = { category: "office" as const, urgency: "normal" as const, date: null, household: null, receipts: [] as string[] };

export function customCenterNotice(st: CustomTextsStatus | null): CustomCenterNotice[] {
  if (st === null) return [];
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
