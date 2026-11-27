//! Web のヒアリング（0125・0192）を AI が使う道具（0222）: get_hearing_options（聞ける項目の一覧。読むだけ）・issue_hearing_url（URL の発行）・
//! propose_hearing_template（事務所のひな形の案）。
//!
//! - 一覧と選び方の確かめは、FP の画面と同じ関数（app/src/workspace/hearing/aiSelection.ts。plan.js に同梱した app/src/connector/hearing.ts）で行う。
//!   接続口の側に項目・票・上限の決まりを書かない
//! - 発行はアプリ本体に頼み、アプリの画面が FP の画面と同じ部品で鍵を作って受け付けのサーバーに問いを置く。接続口は鍵も世帯ファイルも事務所データも
//!   扱わない。見直し（今の値を見せる項目）を含む依頼の URL と案内文は、アプリが AI に返さない（URL の # の後ろが問いの鍵で、今の値を読めるため）
//! - 答えに顧客番号・世帯の内部 ID・呼び名は入らない（アプリ本体も返さない）

use crate::engine;
use serde_json::Value;

/// 聞ける項目の一覧（重いので、呼ぶ側は spawn_blocking の中で）。args は `{ sheet? }`、shared は渡された世帯の計算の入力（無ければ ""）、
/// office はアプリ本体の事務所のひな形の答え（アプリが起動していなければ ""）
pub fn options(args: &Value, shared: &str, office: &str) -> Result<Value, String> {
    let out = engine::plan("hearingOptions", &args.to_string(), shared, office)?;
    serde_json::from_str(&out).map_err(|e| e.to_string())
}

/// 選び方を FP の画面と同じ関数で確かめる（重いので、呼ぶ側は spawn_blocking の中で）。答えは
/// `{ selection, problems, counts, review, summary? }`（問題があれば selection は null）
pub fn check(args: &Value, shared: &str, office: &str) -> Result<Value, String> {
    let out = engine::plan("hearingCheck", &args.to_string(), shared, office)?;
    serde_json::from_str(&out).map_err(|e| e.to_string())
}

/// 本番の受け付けのサーバーが無いときなどの、アプリの断りの文はアプリが作る。ここでは接続口の側の案内だけ
pub const NOT_RUNNING_ISSUE: &str = "アプリが起動していないか、アプリの「AI接続口」がオフなので、URL を発行できません（何も発行していません）。アプリを起動して AI接続口をオンにしてから、もう一度呼んでください。preview: true なら、アプリが起動していなくても数を確認できます（事務所のひな形は使えません）。";

/// 一覧の答えに添える使い方
pub const HOW_TO: &str = "issue_hearing_url に template（simple・detail・review・missing か事務所のひな形の名前）と、要るときだけ items（[{ key, mode?, range? }]。書くとひな形の項目を置き換える）・custom（独自の質問）・documents（頼む書類 [{ kind, owner? }]）・name を書いて URL を発行します。preview: true にすると発行せずに数（聞く項目の数・お客さまの画面の数・所要時間）と要約だけを返します。シンプルと詳細の項目は1つの依頼に混ぜられません。review（見直し）・missing（足りない所だけ）・mode: confirm は share_id（FPが渡した世帯）があるときだけで、見直しを含む依頼の URL は返しません（FP がアプリでコピーします）。よく使う組み合わせは propose_hearing_template で事務所のひな形の案を出せます（FP が承認したときだけ入ります）。";

/// 一覧の答えに添える、アプリが起動していないときの案内
pub const NOT_RUNNING_OPTIONS: &str = "アプリが起動していないか AI接続口がオフなので、事務所のひな形は返せません。発行（issue_hearing_url）も、アプリが起動していて AI接続口がオンのときだけです。";

/// preview の答えの文（見直しを含まない・含む）
pub const PREVIEW: &str = "発行していません（preview）。この選び方で発行するには、preview を外してもう一度呼んでください。";
pub const PREVIEW_REVIEW: &str = "発行していません（preview）。見直し（今の値を見せる項目）を含むので、発行しても URL と案内文は返しません（FP がアプリの依頼の一覧でコピーします）。お客さまの画面の数は前回の値を載せない目安で、発行するときにアプリが数え直します。";
