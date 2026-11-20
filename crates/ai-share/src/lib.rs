//! AIに世帯を渡す（共有）ための、アプリ本体の側の部品（0014・0015）。
//!
//! - 共有の台帳（`ShareRegistry`）: FPが「この世帯をAIに渡す」を操作したときだけ共有を作る。期限つき（既定60分・最長8時間）・即時の取り消し・
//!   同意の撤回による自動の取り消し・アプリの終了で全部閉じる。有効かどうかはメモリの中のこの台帳だけで決める
//! - 縮約版と文章の包み方（`reduce`・`wrap`）: AIに世帯を渡す経路は、必ずこの1か所を通る
//! - AIに渡した記録（`record`）: 共有の開始・読まれた記録・プランの候補・終わりを、追記だけで残す（世帯ファイルの `aiShares`）
//! - AI接続を使えるかの判定（`basis`。0226）: 同意・事務所のプライバシーポリシーの確かめ・架空の世帯から決める1か所。画面と接続口の両方がこれを使う
//! - 同意の記録（`consent`）と、世帯ごとの「同意とAIの記録」の帳面（`book`）: 世帯ファイルの `consents`・`aiShares`・`candidates` はアプリ本体だけが書く
//! - 書類から読んだ値の候補（`documents`。0151）: AIの答えをメモリの中に承認待ちで置くだけ。確かめと番号を落とす決まりは画面の読み口
//! - 新しい世帯の候補（`households`）: AIが組み立てた世帯をメモリの中に承認待ちで置くだけ。世帯を作るのは FP が画面で押したときのアプリ本体
//! - 表示の設定の切り出し（`display`。0213）: 事務所の既定値と渡された世帯の、見せ方だけの設定を読む依頼に答える所（読むだけ）
//! - 表示の設定の案（`display_proposals`。0215）: AIが出した事務所の既定値の見せ方の案をメモリの中に承認待ちで置くだけ。反映するのは FP が画面で押したとき
//! - Web のヒアリング（`hearing`。0222）: AIが決めた選び方で URL の発行を画面に頼む所（鍵は画面だけが作る）と、事務所のひな形の案をメモリの中に承認待ちで置く所
//! - 受け口（`AppEndpoint`）: 接続口（`lifeplan mcp`）からの依頼を受ける。復号はアプリ本体だけが行い、接続口は鍵も世帯ファイルも扱わない
//!
//! このクレートはアプリ本体に組み込む。接続口（crates/lifeplan）は依存しない（テストを除く）。

pub mod basis;
pub mod book;
pub mod clock;
pub mod consent;
pub mod display;
pub mod display_proposals;
pub mod documents;
pub mod endpoint;
pub mod hearing;
pub mod households;
pub mod proposal;
pub mod record;
pub mod reduce;
pub mod registry;
mod schema;
pub mod source;
pub mod wrap;

pub use basis::{ai_documents_use, ai_use, AiUse};
pub use book::{AiCandidate, CandidateStatus, HouseholdAiView, HouseholdBook};
pub use consent::{Author, ConsentRecord, ExternalAiConsentInput};
pub use display_proposals::{
    DisplayCandidate, DisplayChange, HouseholdDisplayCandidate, HouseholdDisplayPending,
};
pub use documents::PendingDocumentProposal;
pub use endpoint::AppEndpoint;
pub use hearing::{
    HearingIssuer, HearingJob, HearingTemplateCandidate, JobHousehold, OfficeHearingSource,
};
pub use households::HouseholdCandidate;
pub use proposal::PendingProposal;
pub use record::{verify_append_only, AiShareRecord, EndReason};
pub use reduce::Scope;
pub use registry::{
    ErrorLogSource, FeatureCodeCandidate, GrantError, GrantOptions, Granted, HouseholdCheck,
    OfficeDisplaySource, OfficeEstimatesSource, ShareRegistry, ShareStatus,
};
pub use source::{ConsentDecision, ConsentRef, SharedHouseholdSource, SourceText};
