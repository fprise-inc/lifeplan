//! 期限の切れた・提供元が止めたコードの知らせを、いつまで出すか（0110 の追記 2026-11-02）。
//!
//! - 知らせは、その状態を初めて見た日（[`Record::since`]。日本の日付）から [`NOTICE_DAYS`] 日の間だけ出す。
//!   FP が「閉じる」を押したら（[`Record::dismissed`]）、その日数の内でも出さない。
//! - 記録はコードの印（`ref`）と状態（切れた・止めた）ごと。使える状態に戻ったら記録を消すので、
//!   再び止められたら新しい日付で、閉じた印も無しで出直す。切れた ↔ 止めた が入れ替わったときも出直す（知らせの文とすることが違うため）。
//!   外したコード・確かめられなくなったコードの記録も消す。
//! - 知らせを出さなくなっても、コードは外さない（止めるのをやめたら、次の確かめで自動で戻る）。世帯のデータも消さない。
//! - 記録はこの PC のアプリのデータに置く（PC をまたいで同期しない）。置き場所はアプリ本体が決める。

use serde::{Deserialize, Serialize};

use crate::{parse_date, CodeState, Error, Status};

/// 切れた・止めたと分かった日から、知らせを出す日数（分かった日を1日目として7日目まで）
pub const NOTICE_DAYS: i64 = 7;

/// 知らせの記録1つ（コード1つ・状態1つ）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    /// コードの印（[`crate::reference`]）
    #[serde(rename = "ref")]
    pub reference: String,
    /// 切れた（expired）か止めた（revoked）か
    pub state: CodeState,
    /// その状態を初めて見た日（日本の日付 YYYY-MM-DD）
    pub since: String,
    /// FP が知らせを閉じた
    #[serde(default)]
    pub dismissed: bool,
}

/// 知らせを出すか（閉じていなくて、分かった日から [`NOTICE_DAYS`] 日の内。日付が読めなければ出す）
pub fn shown(r: &Record, today: &str) -> bool {
    if r.dismissed {
        return false;
    }
    match (parse_date(&r.since), parse_date(today)) {
        (Some(since), Some(t)) => t - since < NOTICE_DAYS,
        _ => true,
    }
}

/// 今の状態に記録を当てる。新しい記録の並びを返し、`status` のコードごとに知らせを出すか（`notice`）と分かった日（`notice_since`）を入れる。
///
/// - 切れた・止めたコードで、同じ印と状態の記録があればそれを使い、無ければ今日を分かった日として足す
/// - 使えるコード・外したコード・確かめられないコードの記録は残さない
/// - 分かった日が今日より後（PC の時計を戻した後など）なら、今日に直す
pub fn apply(status: &mut Status, records: &[Record]) -> Vec<Record> {
    let today = status.today.clone();
    let t = parse_date(&today);
    let mut next = Vec::new();
    for c in &mut status.codes {
        if c.state.usable() {
            c.notice = false;
            c.notice_since = None;
            continue;
        }
        let mut r = records
            .iter()
            .find(|r| r.reference == c.reference && r.state == c.state)
            .cloned()
            .unwrap_or_else(|| Record {
                reference: c.reference.clone(),
                state: c.state,
                since: today.clone(),
                dismissed: false,
            });
        let fix = match (parse_date(&r.since), t) {
            (None, _) => true,
            (Some(s), Some(t)) => s > t,
            (Some(_), None) => false,
        };
        if fix {
            r.since = today.clone();
        }
        c.notice = shown(&r, &today);
        c.notice_since = Some(r.since.clone());
        next.push(r);
    }
    next
}

/// 印で指したコードの知らせを閉じた記録の並び（そのコードの記録が無い＝切れた・止めたの知らせが無いときは NOT_FOUND）
pub fn dismiss(records: &[Record], reference: &str) -> Result<Vec<Record>, Error> {
    if !records.iter().any(|r| r.reference == reference) {
        return Err(Error::NOT_FOUND);
    }
    Ok(records
        .iter()
        .map(|r| Record {
            dismissed: r.dismissed || r.reference == reference,
            ..r.clone()
        })
        .collect())
}
