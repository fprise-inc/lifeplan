//! AIに世帯を渡す（共有）ための、アプリ本体の側の部品（0014・0015）。
//!
//! - 共有の台帳（`ShareRegistry`）: FPが「この世帯をAIに渡す」を操作したときだけ共有を作る。期限つき（既定60分・最長8時間）・即時の取り消し・
//!   同意の撤回による自動の取り消し・アプリの終了で全部閉じる。有効かどうかはメモリの中のこの台帳だけで決める
//! - 縮約版と文章の包み方（`reduce`・`wrap`）: AIに世帯を渡す経路は、必ずこの1か所を通る
//! - AIに渡した記録（`record`）: 共有の開始・読まれた記録・プランの候補・終わりを、追記だけで残す（世帯ファイルの `aiShares`）
//! - 同意の記録（`consent`）と、世帯ごとの「同意とAIの記録」の帳面（`book`）: 世帯ファイルの `consents`・`aiShares`・`candidates` はアプリ本体だけが書く
//! - 受け口（`AppEndpoint`）: 接続口（`lifeplan mcp`）からの依頼を受ける。復号はアプリ本体だけが行い、接続口は鍵も世帯ファイルも扱わない
//!
//! このクレートはアプリ本体に組み込む。接続口（crates/lifeplan）は依存しない（テストを除く）。

pub mod book;
pub mod clock;
pub mod consent;
pub mod endpoint;
pub mod proposal;
pub mod record;
pub mod reduce;
pub mod registry;
mod schema;
pub mod source;
pub mod wrap;

pub use book::{AiCandidate, CandidateStatus, HouseholdAiView, HouseholdBook};
pub use consent::{Author, ConsentRecord, ExternalAiConsentInput};
pub use endpoint::AppEndpoint;
pub use proposal::PendingProposal;
pub use record::{verify_append_only, AiShareRecord, EndReason};
pub use reduce::Scope;
pub use registry::{GrantError, GrantOptions, Granted, ShareRegistry, ShareStatus};
pub use source::{ConsentDecision, ConsentRef, SharedHouseholdSource, SourceText};
