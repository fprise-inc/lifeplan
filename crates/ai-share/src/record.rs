//! AIに渡した記録（世帯ファイルの区画 `aiShares`。0014 の3）。
//!
//! 記録は追記だけ。1件（1つの共有）の中で後から変わってよいのは、次のものだけ:
//! - `endedAt`・`endReason` を空から1回だけ埋める
//! - `reads`・`proposals` の後ろに足す
//! - 最後の `reads` の行の回数と最後の日時を増やす（同じ道具・同じ指紋の読み取りが続いたとき）
//!
//! アプリ本体が世帯ファイルに書き戻すときは `verify_append_only` で前の記録と比べ、既存の行の書き換えを止める。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiShareRecord {
    pub id: String,
    /// `household`（世帯の情報を渡した）／`headings`（移行の見出しだけ。今は作らない）
    pub kind: String,
    pub share_id: String,
    pub granted_at: String,
    pub expires_at: String,
    pub ended_at: Option<String>,
    pub end_reason: Option<EndReason>,
    /// `reduced`／`custom`
    pub scope: String,
    /// 縮約版の許可リストの版
    pub allowlist_version: String,
    /// 渡した項目の一覧（入力項目IDと文章の項目）
    pub fields: Vec<String>,
    pub household_revision: String,
    /// FPが申告した接続先（確かめられない。認証ではない）
    pub destination_declared: String,
    pub consent_at_grant: ConsentAtGrant,
    pub reads: Vec<ReadEntry>,
    pub proposals: Vec<ProposalEntry>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EndReason {
    Revoked,
    Expired,
    AppClosed,
    ConsentWithdrawn,
}

/// 渡した時点の外部AIへの提供の同意の状態（0014 の3）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsentAtGrant {
    /// `given`／`refused`／`withdrawn`／`none`
    pub state: String,
    /// 参照した同意の記録の `id`
    pub record_id: Option<String>,
    /// 同意が無いまま渡し、警告を見せたこと
    pub warned: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadEntry {
    pub first_at: String,
    pub last_at: String,
    pub count: u64,
    /// 道具（MCP のツール）の名前
    pub tool: String,
    /// 返した項目の一覧
    pub fields: Vec<String>,
    /// 返した中身の指紋（`sha256:` ＋16進）
    pub digest: String,
    /// 観測できた呼び出し元（参考情報。認証ではない）
    pub caller: Caller,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Caller {
    /// 接続口のプロセスの pid（OS から）
    pub connector_pid: Option<u32>,
    /// 接続口の実行ファイルのパス（OS から）
    pub connector_exe: Option<String>,
    /// 接続口を起動した親のプロセス（AIのアプリ）の実行ファイルのパス（OS から）
    pub parent_exe: Option<String>,
    /// MCP のあいさつでAIのアプリが名乗った名前（自己申告）
    pub mcp_client_declared: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalEntry {
    pub candidate_id: String,
    pub at: String,
}

impl AiShareRecord {
    /// 共有を閉じる（1回だけ。2回目以降は何もしない）
    pub(crate) fn end(&mut self, at: String, reason: EndReason) {
        if self.ended_at.is_none() {
            self.ended_at = Some(at);
            self.end_reason = Some(reason);
        }
    }

    /// 読まれた記録を足す（同じ道具・同じ指紋・同じ呼び出し元が続いたら、最後の行の回数を増やす）
    pub(crate) fn add_read(
        &mut self,
        at: String,
        tool: &str,
        fields: &[String],
        digest: &str,
        caller: &Caller,
    ) {
        if let Some(last) = self.reads.last_mut() {
            if last.tool == tool && last.digest == digest && &last.caller == caller {
                last.count += 1;
                last.last_at = at;
                return;
            }
        }
        self.reads.push(ReadEntry {
            first_at: at.clone(),
            last_at: at,
            count: 1,
            tool: tool.to_owned(),
            fields: fields.to_vec(),
            digest: digest.to_owned(),
            caller: caller.clone(),
        });
    }
}

/// 追記だけかどうかを確かめる（`after` が `before` に足しただけなら Ok）
pub fn verify_append_only(before: &[AiShareRecord], after: &[AiShareRecord]) -> Result<(), String> {
    if after.len() < before.len() {
        return Err("記録の行が減っています".into());
    }
    for (i, (b, a)) in before.iter().zip(after.iter()).enumerate() {
        let fixed = |r: &AiShareRecord| {
            (
                r.id.clone(),
                r.kind.clone(),
                r.share_id.clone(),
                r.granted_at.clone(),
                r.expires_at.clone(),
                r.scope.clone(),
                r.allowlist_version.clone(),
                r.fields.clone(),
                r.household_revision.clone(),
                r.destination_declared.clone(),
                r.consent_at_grant.clone(),
            )
        };
        if fixed(b) != fixed(a) {
            return Err(format!("{i} 行目の記録が書き換えられています"));
        }
        if b.ended_at.is_some() && (b.ended_at != a.ended_at || b.end_reason != a.end_reason) {
            return Err(format!(
                "{i} 行目の終わりの日時・理由が書き換えられています"
            ));
        }
        if a.reads.len() < b.reads.len() || a.proposals.len() < b.proposals.len() {
            return Err(format!("{i} 行目の読まれた記録か案の記録が減っています"));
        }
        if b.proposals[..] != a.proposals[..b.proposals.len()] {
            return Err(format!("{i} 行目の案の記録が書き換えられています"));
        }
        let n = b.reads.len();
        if n > 0 {
            if b.reads[..n - 1] != a.reads[..n - 1] {
                return Err(format!("{i} 行目の読まれた記録が書き換えられています"));
            }
            let (lb, la) = (&b.reads[n - 1], &a.reads[n - 1]);
            let same = lb.first_at == la.first_at
                && lb.tool == la.tool
                && lb.fields == la.fields
                && lb.digest == la.digest
                && lb.caller == la.caller
                && la.count >= lb.count
                && la.last_at >= lb.last_at;
            if !same {
                return Err(format!(
                    "{i} 行目の最後の読まれた記録が書き換えられています"
                ));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record() -> AiShareRecord {
        AiShareRecord {
            id: "r1".into(),
            kind: "household".into(),
            share_id: "s-1".into(),
            granted_at: "2026-10-17T00:00:00Z".into(),
            expires_at: "2026-10-17T01:00:00Z".into(),
            ended_at: None,
            end_reason: None,
            scope: "reduced".into(),
            allowlist_version: "reduced@1".into(),
            fields: vec!["member.birth".into()],
            household_revision: "rev1".into(),
            destination_declared: "Claude Desktop".into(),
            consent_at_grant: ConsentAtGrant {
                state: "given".into(),
                record_id: Some("c1".into()),
                warned: false,
            },
            reads: vec![],
            proposals: vec![],
        }
    }

    #[test]
    fn appending_is_allowed() {
        let before = vec![record()];
        let mut after = before.clone();
        let caller = Caller::default();
        after[0].add_read(
            "2026-10-17T00:01:00Z".into(),
            "get_shared_household",
            &[],
            "sha256:aa",
            &caller,
        );
        assert!(verify_append_only(&before, &after).is_ok());
        let before = after.clone();
        // 同じ読み取りが続いたら回数を増やす
        after[0].add_read(
            "2026-10-17T00:02:00Z".into(),
            "get_shared_household",
            &[],
            "sha256:aa",
            &caller,
        );
        assert_eq!(after[0].reads.len(), 1);
        assert_eq!(after[0].reads[0].count, 2);
        assert!(verify_append_only(&before, &after).is_ok());
        after[0].end("2026-10-17T00:30:00Z".into(), EndReason::Revoked);
        after[0].end("2026-10-17T00:40:00Z".into(), EndReason::Expired);
        assert_eq!(after[0].end_reason, Some(EndReason::Revoked));
        after.push(record());
        assert!(verify_append_only(&before, &after).is_ok());
    }

    #[test]
    fn rewriting_is_refused() {
        let mut base = record();
        base.add_read(
            "2026-10-17T00:01:00Z".into(),
            "t",
            &[],
            "sha256:aa",
            &Caller::default(),
        );
        base.add_read(
            "2026-10-17T00:02:00Z".into(),
            "t",
            &[],
            "sha256:bb",
            &Caller::default(),
        );
        base.end("2026-10-17T00:30:00Z".into(), EndReason::Revoked);
        let before = vec![base];

        let mut a = before.clone();
        a[0].fields.push("note.fp".into());
        assert!(
            verify_append_only(&before, &a).is_err(),
            "渡した項目の書き換え"
        );

        let mut a = before.clone();
        a[0].end_reason = Some(EndReason::Expired);
        assert!(
            verify_append_only(&before, &a).is_err(),
            "終わりの理由の書き換え"
        );

        let mut a = before.clone();
        a[0].reads[0].digest = "sha256:cc".into();
        assert!(
            verify_append_only(&before, &a).is_err(),
            "前の読まれた記録の書き換え"
        );

        let mut a = before.clone();
        a[0].reads.pop();
        assert!(
            verify_append_only(&before, &a).is_err(),
            "読まれた記録を消す"
        );

        assert!(verify_append_only(&before, &[]).is_err(), "行を消す");

        let mut a = before.clone();
        a[0].consent_at_grant.state = "none".into();
        assert!(
            verify_append_only(&before, &a).is_err(),
            "同意の状態の書き換え"
        );
    }
}
