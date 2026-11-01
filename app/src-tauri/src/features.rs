//! 機能を有効にするコードの命令（0110）。中身は feature-code（確かめる部品）と household-store（事務所データに暗号化して持つ）。
//!
//! - 本物か・期限内かは本体だけが確かめる（公開鍵は config/distribution.toml の [keys] の feature_code を build.rs が埋め込む）。
//!   画面は返した状態（使える機能・名前・期限）を出すだけで、自分では確かめない。ネットにはつながない。
//! - 画面にはコードの文字列を返さない（外すときは短い印 `ref` で指す）。
//! - 期限は日本の日付で、PC の時計で判定する。開発用のビルド（debug）だけ、環境変数 `FINANCIA_DEV_TODAY`（YYYY-MM-DD）で今日を変えられる
//!   （期限が近い・切れたの見え方を確かめるため）。
//! - AI接続口からは入れられない（0015 の2: 設定を変える・機能を有効にする道具は作らない）。

use feature_code::{PublicKey, Status};
use household_store::{Store, StoreError};
use tauri::{AppHandle, Manager};

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

async fn blocking<T: Send + 'static>(
    app: AppHandle,
    f: impl FnOnce(&Store) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<StoreState>();
        f(&store.store)
    })
    .await
    .map_err(|_| "E_HOST_THREAD".to_owned())?
}

fn status_of(s: &Store) -> Result<Status, String> {
    let codes = s.feature_codes().map_err(store_code)?;
    Ok(feature_code::status(&codes, &keys(), &today()))
}

/// 入れたコードの状態（使える機能・名前・期限・期限が近いか切れたか）
#[tauri::command]
pub async fn feature_codes_status(app: AppHandle) -> Result<Status, String> {
    blocking(app, status_of).await
}

/// コードを入れる（本物で、この版で使える機能が入っていて、期限内のものだけ）。同じ機能の古いコードは外す
#[tauri::command]
pub async fn feature_code_add(app: AppHandle, code: String) -> Result<Status, String> {
    blocking(app, move |s| {
        let codes = s.feature_codes().map_err(store_code)?;
        let next = feature_code::add(&codes, &code, &keys(), &today())
            .map_err(|e| e.code().to_owned())?;
        s.set_feature_codes(next).map_err(store_code)?;
        status_of(s)
    })
    .await
}

/// コードを外す（code_ref は状態の `ref`）
#[tauri::command]
pub async fn feature_code_remove(app: AppHandle, code_ref: String) -> Result<Status, String> {
    blocking(app, move |s| {
        let codes = s.feature_codes().map_err(store_code)?;
        let next = feature_code::remove(&codes, &code_ref).map_err(|e| e.code().to_owned())?;
        s.set_feature_codes(next).map_err(store_code)?;
        status_of(s)
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
}
