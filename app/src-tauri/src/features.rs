//! 機能を有効にするコードの命令（0110）。中身は feature-code（確かめる部品）と household-store（事務所データに暗号化して持つ）。
//!
//! - 本物か・期限内か・提供元が止めたかは本体だけが確かめる（公開鍵は config/distribution.toml の [keys] の feature_code・
//!   feature_code_revocation を build.rs が埋め込む）。画面は返した状態（使える機能・名前・期限・止めたか）を出すだけで、自分では確かめない。
//! - 提供元が止めたかは、配信元の「止めた一覧」の最後に取れたもので判断する（取りに行くのは revocations.rs。つながらなければ今の状態のまま）。
//! - 画面にはコードの文字列を返さない（外すときは短い印 `ref`、AIからの候補は候補の ID で指す）。
//! - 期限は日本の日付で、PC の時計で判定する。開発用のビルド（debug）だけ、環境変数 `FINANCIA_DEV_TODAY`（YYYY-MM-DD）で今日を変えられる
//!   （期限が近い・切れたの見え方を確かめるため）。
//! - AIからは、コードを入れる「候補」を出せるだけ（0015 の追記の2段目: 接続口の propose_feature_code）。候補は画面に承認待ちで出て、
//!   FP が入れる前と後を確かめて押したときだけ入る（feature_code_candidate_decide）。候補はメモリの中だけに置き、アプリを閉じると消える。

use feature_code::{PublicKey, Status};
use household_store::{Store, StoreError};
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::ai::AiState;
use crate::revocations::{CheckView, RevocationState};
use crate::store::StoreState;

include!(concat!(env!("OUT_DIR"), "/feature_keys.rs"));

fn keys() -> Vec<PublicKey> {
    // build.rs が形を確かめているので、読めない鍵は無い（あれば捨てる＝その鍵のコードは使えない）
    FEATURE_CODE_KEYS
        .iter()
        .filter_map(|l| PublicKey::parse(l).ok())
        .collect()
}

fn today() -> String {
    if cfg!(debug_assertions) {
        if let Some(d) = std::env::var("FINANCIA_DEV_TODAY")
            .ok()
            .filter(|d| feature_code::parse_date(d).is_some())
        {
            return d;
        }
    }
    feature_code::today_now()
}

fn store_code(e: StoreError) -> String {
    e.code().to_owned()
}

/// AIから届いた、コードを入れる候補（入れる前と後。コードの文字列は返さない）
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CandidateView {
    id: String,
    received_at: String,
    /// AIのアプリが名乗った名前（自己申告。認証ではない）
    connector: Option<String>,
    /// 入れられるか（本物で、使える機能が入っていて、期限内で、止めた一覧に載っていない）
    ok: bool,
    /// 入れられないときの符号
    error: Option<&'static str>,
    /// コードの中身（確かめられたときだけ）
    name: Option<String>,
    features: Vec<String>,
    expires: Option<String>,
    /// 入れる前に使える機能
    before: Vec<String>,
    /// 入れた後に使える機能
    after: Vec<String>,
    /// 入れると外れる、今のコード（更新の前のコード）の数
    replaces: usize,
}

/// 画面に返す状態（入れたコードの状態・止めた一覧の確かめの様子・AIからの候補）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureStatusView {
    #[serde(flatten)]
    status: Status,
    check: CheckView,
    candidates: Vec<CandidateView>,
}

fn candidate_view(
    c: &ai_share::FeatureCodeCandidate,
    codes: &[String],
    keys: &[PublicKey],
    today: &str,
    revoked: &[String],
    before: &Status,
) -> CandidateView {
    let claims = feature_code::verify(&c.code, keys).ok();
    let (ok, error, after, replaces) = match feature_code::add(codes, &c.code, keys, today, revoked)
    {
        Ok(next) => {
            let kept = codes.iter().filter(|x| next.contains(x)).count();
            let after = feature_code::status(&next, keys, today, revoked);
            (true, None, after.active, codes.len() - kept)
        }
        Err(e) => (false, Some(e.code()), before.active.clone(), 0),
    };
    CandidateView {
        id: c.candidate_id.clone(),
        received_at: c.received_at.clone(),
        connector: c.connector.clone(),
        ok,
        error,
        name: claims.as_ref().map(|x| x.name.clone()),
        features: claims
            .as_ref()
            .map(|x| x.features.clone())
            .unwrap_or_default(),
        expires: claims.and_then(|x| x.expires),
        before: before.active.clone(),
        after,
        replaces,
    }
}

fn status_of(s: &Store, rs: &RevocationState, ai: &AiState) -> Result<FeatureStatusView, String> {
    let codes = s.feature_codes().map_err(store_code)?;
    let keys = keys();
    let today = today();
    let revoked = rs.revoked();
    let status = feature_code::status(&codes, &keys, &today, &revoked);
    let candidates = ai
        .registry()
        .feature_code_candidates()
        .iter()
        .map(|c| candidate_view(c, &codes, &keys, &today, &revoked, &status))
        .collect();
    Ok(FeatureStatusView {
        status,
        check: rs.view(),
        candidates,
    })
}

async fn blocking<T: Send + 'static>(
    app: AppHandle,
    f: impl FnOnce(&Store, &RevocationState, &AiState) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<StoreState>();
        let rs = app.state::<RevocationState>();
        let ai = app.state::<AiState>();
        f(&store.store, &rs, &ai)
    })
    .await
    .map_err(|_| "E_HOST_THREAD".to_owned())?
}

fn add_code(s: &Store, rs: &RevocationState, code: &str) -> Result<(), String> {
    let codes = s.feature_codes().map_err(store_code)?;
    let next = feature_code::add(&codes, code, &keys(), &today(), &rs.revoked())
        .map_err(|e| e.code().to_owned())?;
    s.set_feature_codes(next).map_err(store_code)?;
    // 入れたコードが止められていないかを、配信元の一覧でも確かめ直す（裏で。つながらなければ今の状態のまま）
    rs.request();
    Ok(())
}

/// 入れたコードの状態（使える機能・名前・期限・期限が近いか切れたか・止めたか）と、止めた一覧の確かめの様子・AIからの候補
#[tauri::command]
pub async fn feature_codes_status(app: AppHandle) -> Result<FeatureStatusView, String> {
    blocking(app, status_of).await
}

/// コードを入れる（本物で、この版で使える機能が入っていて、期限内で、止めた一覧に載っていないものだけ）。同じ機能の古いコードは外す
#[tauri::command]
pub async fn feature_code_add(app: AppHandle, code: String) -> Result<FeatureStatusView, String> {
    blocking(app, move |s, rs, ai| {
        add_code(s, rs, &code)?;
        status_of(s, rs, ai)
    })
    .await
}

/// コードを外す（code_ref は状態の `ref`）
#[tauri::command]
pub async fn feature_code_remove(
    app: AppHandle,
    code_ref: String,
) -> Result<FeatureStatusView, String> {
    blocking(app, move |s, rs, ai| {
        let codes = s.feature_codes().map_err(store_code)?;
        let next = feature_code::remove(&codes, &code_ref).map_err(|e| e.code().to_owned())?;
        s.set_feature_codes(next).map_err(store_code)?;
        status_of(s, rs, ai)
    })
    .await
}

/// 止めた一覧を今すぐ確かめる（裏の見回りを起こす。結果は少し後の状態に出る）
#[tauri::command]
pub async fn feature_codes_check(app: AppHandle) -> Result<FeatureStatusView, String> {
    blocking(app, |s, rs, ai| {
        rs.request();
        status_of(s, rs, ai)
    })
    .await
}

/// AIから届いた、コードを入れる候補を判断する（accept なら入れる。どちらでも承認待ちから外す）。
/// 入れられないコード（偽物・期限切れ・止めたもの）は入れずに符号を返し、候補は承認待ちに残す（捨てるのは FP）
#[tauri::command]
pub async fn feature_code_candidate_decide(
    app: AppHandle,
    candidate: String,
    accept: bool,
) -> Result<FeatureStatusView, String> {
    blocking(app, move |s, rs, ai| {
        let reg = ai.registry();
        let Some(c) = reg
            .feature_code_candidates()
            .into_iter()
            .find(|c| c.candidate_id == candidate)
        else {
            return Err("E_FEATURE_CODE_CANDIDATE_UNKNOWN".to_owned());
        };
        if accept {
            add_code(s, rs, &c.code)?;
        }
        reg.take_feature_code_candidate(&c.candidate_id);
        status_of(s, rs, ai)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_keys_are_readable() {
        // 配布元の設定の公開鍵が、すべて鍵として読める（読めない鍵があると、その鍵のコードが黙って使えなくなる）
        assert_eq!(keys().len(), FEATURE_CODE_KEYS.len());
        assert!(!FEATURE_CODE_KEYS.is_empty());
    }

    #[test]
    fn candidate_shows_before_and_after() {
        let k = feature_code::SecretKey::generate("test-1").unwrap();
        let keys = [k.public()];
        let issue_with = |key: &feature_code::SecretKey, id: &str, expires: Option<&str>| {
            feature_code::issue(
                key,
                &feature_code::Request {
                    id: id.into(),
                    name: "見本 花子".into(),
                    features: vec!["combinedBs".into()],
                    issued: "2026-11-01".into(),
                    expires: expires.map(str::to_owned),
                },
            )
            .unwrap()
        };
        let cand = |code: String| ai_share::FeatureCodeCandidate {
            candidate_id: "c1".into(),
            received_at: "2026-11-01T00:00:00Z".into(),
            code,
            connector: Some("test-ai 1".into()),
        };
        let today = "2026-11-01";
        let none = feature_code::status(&[], &keys, today, &[]);
        // 入れる前は使えない → 入れた後は使える
        let v = candidate_view(
            &cand(issue_with(&k, "0001", None)),
            &[],
            &keys,
            today,
            &[],
            &none,
        );
        assert!(v.ok);
        assert_eq!(v.before, Vec::<String>::new());
        assert_eq!(v.after, vec!["combinedBs"]);
        assert_eq!(v.name.as_deref(), Some("見本 花子"));
        assert_eq!(v.expires, None);
        // 更新のコードは、今のコードを外す
        let old = issue_with(&k, "0002", Some("2027-05-31"));
        let cur = feature_code::status(std::slice::from_ref(&old), &keys, today, &[]);
        let v = candidate_view(
            &cand(issue_with(&k, "0003", None)),
            &[old],
            &keys,
            today,
            &[],
            &cur,
        );
        assert_eq!((v.ok, v.replaces), (true, 1));
        // 止めた一覧に載っているコード・偽物は入れられない
        let v = candidate_view(
            &cand(issue_with(&k, "0004", None)),
            &[],
            &keys,
            today,
            &["0004".into()],
            &none,
        );
        assert_eq!((v.ok, v.error), (false, Some("E_FEATURE_CODE_REVOKED")));
        let other = feature_code::SecretKey::generate("test-1").unwrap();
        let v = candidate_view(
            &cand(issue_with(&other, "9", None)),
            &[],
            &keys,
            today,
            &[],
            &none,
        );
        assert_eq!(
            (v.ok, v.error, v.name),
            (false, Some("E_FEATURE_CODE_SIGNATURE"), None)
        );
        assert_eq!(v.after, Vec::<String>::new());
    }
}
