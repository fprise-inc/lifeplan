//! 世帯ごとの「同意とAIの記録」の帳面（アプリ本体が、開いている世帯ごとに1つ持つ）。
//!
//! 世帯ファイルの本文のうち、次の区画はアプリ本体（Rust）だけが書く。画面（WebView）が送ってきた本文に
//! これらの区画が入っていても使わず、帳面の中身で置き換える（画面から記録を書き換える経路を作らない。0014 の「守るべき決まり」）。
//!
//! | 区画 | 中身 |
//! |---|---|
//! | `consents` | 同意の記録（0014 の2。追記だけ） |
//! | `consentExplanations` | 同意を得るときに見せた説明文（指紋 → 文面。0014 の4。1回だけ写す） |
//! | `aiShares` | AIに渡した記録（0014 の3。追記だけ。中身は共有の台帳が作る） |
//! | `candidates` | 外から来た候補（0008 の5・0011 の2）。この版ではAIのプランの候補だけ。FPが承認するまで世帯に効かない |
//!
//! 画面に返す本文からは、これらの区画を外す（画面は `view` で見る）。

use crate::basis::{ai_documents_use, ai_use, AiUse};
use crate::consent::{
    self, current_external_ai, explanation_for, explanation_ref, verify_consents_append_only,
    Author, ConsentRecord, ExternalAiConsentInput, EXTERNAL_AI_EXPLANATION,
    EXTERNAL_AI_EXPLANATION_VERSION, HEARING_SHEET_EXTERNAL_AI_TEXT,
};
use crate::display_proposals::HouseholdDisplayCandidate;
use crate::documents::PendingDocumentProposal;
use crate::proposal::{PendingProposal, ProposalOrigin, ProposedDiff};
use crate::record::{for_screen, only_read_counts_changed, verify_append_only, AiShareRecord};
use crate::reduce::{allowlist, reduced_items};
use crate::registry::ShareStatus;
use crate::source::{ConsentDecision, ConsentRef, SharedHouseholdSource};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;

pub const SECTION_CONSENTS: &str = "consents";
pub const SECTION_EXPLANATIONS: &str = "consentExplanations";
pub const SECTION_AI_SHARES: &str = "aiShares";
pub const SECTION_CANDIDATES: &str = "candidates";
/// アプリ本体だけが書く区画
pub const OWNED_SECTIONS: [&str; 4] = [
    SECTION_CONSENTS,
    SECTION_EXPLANATIONS,
    SECTION_AI_SHARES,
    SECTION_CANDIDATES,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CandidateStatus {
    /// 承認待ち
    Pending,
    /// FPがプランとして保存した
    Accepted,
    /// FPが捨てた
    Rejected,
}

/// 外から来た候補（AIのプランの候補）。中身は届いたときのまま変えず、FPの判断（状態・日時・保存したプラン）を1回だけ埋める
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCandidate {
    /// 候補の ID（AIに渡した記録の `proposals` の `candidateId` と同じ）
    pub id: String,
    /// 出どころ（この版では `ai` だけ）
    pub source: String,
    pub share_id: String,
    pub received_at: String,
    /// AIが書いた題名・説明（人の指示ではない。画面では信用しない文章として文字のまま出す。0016）
    pub title: String,
    pub summary: String,
    pub diffs: Vec<ProposedDiff>,
    pub origin: ProposalOrigin,
    pub status: CandidateStatus,
    #[serde(default)]
    pub decided_at: Option<String>,
    /// 判断した人（いつも `fp`。AIは承認できない。0008 の2）
    #[serde(default)]
    pub decided_by: Option<String>,
    /// プランとして保存したときの、プランの ID
    #[serde(default)]
    pub plan_id: Option<String>,
    /// 判断したメンバー（事務所で共有しているとき。0023 の6。`decided_by` は今までどおり `fp`）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decided_by_member: Option<Author>,
}

/// 候補の中身が書き換えられていないか・判断が1回だけか
pub fn verify_candidates(before: &[AiCandidate], after: &[AiCandidate]) -> Result<(), String> {
    if after.len() < before.len() {
        return Err("候補が減っています".into());
    }
    for (i, (b, a)) in before.iter().zip(after.iter()).enumerate() {
        let fixed = |c: &AiCandidate| {
            (
                c.id.clone(),
                c.source.clone(),
                c.share_id.clone(),
                c.received_at.clone(),
                c.title.clone(),
                c.summary.clone(),
                serde_json::to_string(&c.diffs).unwrap_or_default(),
                c.origin.clone(),
            )
        };
        if fixed(b) != fixed(a) {
            return Err(format!("{i} 件目の候補の中身が書き換えられています"));
        }
        if b.status != CandidateStatus::Pending && b != a {
            return Err(format!("{i} 件目の候補の判断が書き換えられています"));
        }
    }
    Ok(())
}

/// 画面に返す「同意とAIの記録」（パス・鍵・世帯の中身は入れない）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HouseholdAiView {
    /// 外部AIへの提供の同意の今の状態: `none`／`given`／`refused`／`withdrawn`
    pub consent_state: String,
    /// 今の同意が、書類を AI に渡すことを含む説明（版2〜）でのものか（`given` のときだけ true。0157）。
    /// `given` で false の世帯は、書類を AI に渡す前に同意を取り直す（計算の項目は渡せる）
    pub consent_documents: bool,
    pub consents: Vec<ConsentRecord>,
    /// 同意を得るときに見せる説明文と、その指紋・版
    pub explanation: String,
    pub explanation_ref: String,
    pub explanation_version: u32,
    /// ヒアリングシートの同意欄の文（取り方が「ヒアリングシートの同意欄」の同意は、この文で記録する。書類を含まない。0172）
    pub hearing_sheet_explanation: String,
    /// 共有中なら、その共有（期限内のもの）
    pub share: Option<ShareStatus>,
    /// AIに渡した記録（新しい順ではなく、記録の順。呼び出し元の実行ファイルはファイル名だけ）
    pub records: Vec<AiShareRecord>,
    pub candidates: Vec<AiCandidate>,
    /// 届いた、書類から読んだ値の候補（承認待ち。世帯ファイルには書かない。画面が読み口を通して読み取りの記録にする。0151）
    pub document_proposals: Vec<PendingDocumentProposal>,
    /// 届いた、この世帯の表示の設定の案（承認待ち。世帯ファイルには書かない。画面が確かめ直して「今 → 案」を出し、FPが設定ごとに反映するか捨てる）
    pub display_proposals: Vec<HouseholdDisplayCandidate>,
    /// 渡す項目（縮約版の許可リストの版と項目）
    pub allowlist_version: String,
    pub fields: Vec<String>,
    /// 保存した世帯か（保存していない見本は渡せない）
    pub saved: bool,
    /// 架空の世帯（AIの候補から「架空」として作った世帯）か。架空の世帯は同意の記録が無くても渡せる
    pub fictional: bool,
    /// この世帯を AI に渡せるか・その理由（0226。判定は `basis::ai_use` の1か所。画面はこれを見せるだけ）
    pub ai_use: AiUse,
    /// 書類（お名前・番号を伏せたもの）を AI に渡せるか・その理由（0157・0226。`basis::ai_documents_use`）
    pub ai_documents_use: AiUse,
}

/// 画面の入力の進み具合（保存した入力項目と足した入力項目の数・仮の値を入れた欄のキー。0222 の追記 2026-11-19）。文は写さない
fn entered_of(body: &Map<String, Value>) -> Value {
    let h = body.get("household");
    let count = |k: &str| {
        h.and_then(|h| h.get(k))
            .and_then(Value::as_array)
            .map_or(0, Vec::len)
    };
    let assumed: Vec<Value> = h
        .and_then(|h| h.get("assumed"))
        .and_then(Value::as_object)
        .map(|m| m.keys().map(|k| Value::String(k.clone())).collect())
        .unwrap_or_default();
    serde_json::json!({ "confirmed": count("confirmed"), "addedItems": count("addedItems"), "assumed": assumed })
}

/// 年月日の形（YYYY-MM-DD。月の日数も見る。面談の履歴・「次回確かめる」の印の日の確かめ。画面の meetings.ts の isMeetingDate と同じ）
fn is_date(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return false;
    }
    let num = |r: std::ops::Range<usize>| -> Option<u32> {
        let t = &s[r];
        t.bytes()
            .all(|c| c.is_ascii_digit())
            .then(|| t.parse().ok())
            .flatten()
    };
    let (Some(y), Some(m), Some(d)) = (num(0..4), num(5..7), num(8..10)) else {
        return false;
    };
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let days = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    (1..=days).contains(&d)
}

/// 顧客のフォローの要約の材料（0248）: 日付・数・区分の記号だけ。文（面談の中身・メモ・印の見出し）は読まない。
/// 読み方は画面と同じ（面談の履歴は meetings/meetings.ts の readMeetings、印は input/recheck.ts の readRecheck、控えは snapshots の createdAt）。
/// 形の合わない記録は数えない
pub fn followup_of(
    body: &Map<String, Value>,
    category: Option<&str>,
) -> crate::source::FollowupFacts {
    const MAX_MEETINGS: usize = 500;
    let str_of = |v: &Value, k: &str| v.get(k).and_then(Value::as_str).map(str::to_owned);
    // 面談の履歴（0182）: 日の形の合う記録（同じ ID は先の1件だけ）
    let mut seen = std::collections::BTreeSet::new();
    let meetings: Vec<String> = body
        .get("meetings")
        .and_then(|m| m.get("records"))
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .take(MAX_MEETINGS)
                .filter_map(|r| {
                    let id = str_of(r, "id").filter(|i| !i.is_empty() && i.len() <= 64)?;
                    let on = str_of(r, "on").filter(|d| is_date(d))?;
                    seen.insert(id).then_some(on)
                })
                .collect()
        })
        .unwrap_or_default();
    // 「次回確かめる」の印（0072）: 形の合う印（同じ行の ID は1つ）
    let mut ids = std::collections::BTreeSet::new();
    let recheck = body
        .get("household")
        .and_then(|h| h.get("recheck"))
        .and_then(Value::as_array)
        .map_or(0, |a| {
            a.iter()
                .filter(|x| {
                    let ok = ["card", "cardLabel", "label"]
                        .iter()
                        .all(|k| x.get(*k).is_some_and(Value::is_string))
                        && str_of(x, "on").is_some_and(|d| is_date(&d));
                    match str_of(x, "id").filter(|i| !i.is_empty()) {
                        Some(id) if ok => ids.insert(id),
                        _ => false,
                    }
                })
                .count()
        });
    // 控え（0009）: 作った年月（いちばん新しいもの）
    let last_snapshot_month = body
        .get("snapshots")
        .and_then(Value::as_array)
        .and_then(|a| {
            a.iter()
                .filter_map(|x| str_of(x, "createdAt"))
                .filter_map(|c| {
                    let ym = c.get(0..7)?;
                    is_date(&format!("{ym}-01")).then(|| ym.to_owned())
                })
                .max()
        });
    crate::source::FollowupFacts {
        category: category
            .filter(|c| (1..=2).contains(&c.len()) && c.bytes().all(|b| b.is_ascii_uppercase()))
            .map(str::to_owned),
        last_meeting_on: meetings.iter().max().cloned(),
        meetings: meetings.len(),
        last_snapshot_month,
        recheck_marks: recheck,
    }
}

/// 開いている世帯の帳面
#[derive(Debug, Clone)]
pub struct HouseholdBook {
    pub household_id: String,
    pub customer_no: Option<String>,
    pub generation: u64,
    /// 架空の世帯か（世帯の一覧の札の印。アプリ本体が世帯を開いたときに札から入れる。本文には書かない）
    pub fictional: bool,
    /// 区分の記号（世帯の一覧の札から。アプリ本体が世帯を開いたとき・区分を変えたときに入れる。顧客のフォローの要約だけに使う。0248）
    pub category: Option<String>,
    /// 画面から届いた最後の本文（アプリ本体だけが書く区画は外したもの）
    body: Map<String, Value>,
    pub consents: Vec<ConsentRecord>,
    pub explanations: BTreeMap<String, String>,
    pub candidates: Vec<AiCandidate>,
    /// 世帯ファイルから読んだ `aiShares`（共有の台帳に1回だけ読み込ませる）
    pub file_ai_shares: Vec<AiShareRecord>,
    saved_consents: Vec<ConsentRecord>,
    saved_candidates: Vec<AiCandidate>,
    saved_ai_shares: Vec<AiShareRecord>,
}

fn take_array<T: for<'de> Deserialize<'de>>(
    body: &mut Map<String, Value>,
    key: &str,
) -> Result<Vec<T>, &'static str> {
    match body.remove(key) {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(v) => serde_json::from_value(v).map_err(|_| "E_AI_BODY_SECTION"),
    }
}

fn strip_owned(body: &mut Map<String, Value>) {
    for k in OWNED_SECTIONS {
        body.remove(k);
    }
}

/// 画面から届いた本文から、アプリ本体だけが書く区画を外す（新しい世帯を作るとき。保存は `replace_body` が外す）。
/// 本文が JSON の物でなければ `E_AI_BODY`
pub fn without_owned_sections(body_json: &str) -> Result<String, &'static str> {
    let mut body = parse_object(body_json)?;
    strip_owned(&mut body);
    Ok(Value::Object(body).to_string())
}

fn parse_object(json: &str) -> Result<Map<String, Value>, &'static str> {
    match serde_json::from_str::<Value>(json) {
        Ok(Value::Object(m)) => Ok(m),
        _ => Err("E_AI_BODY"),
    }
}

impl HouseholdBook {
    /// 開いた（または作った）世帯の本文から帳面を作る。戻り値の2つめは、画面に返す本文（アプリ本体だけが書く区画を外したもの）
    pub fn from_opened(
        household_id: &str,
        customer_no: Option<String>,
        generation: u64,
        body_json: &str,
    ) -> Result<(HouseholdBook, String), &'static str> {
        let mut body = parse_object(body_json)?;
        let consents: Vec<ConsentRecord> = take_array(&mut body, SECTION_CONSENTS)?;
        let explanations: BTreeMap<String, String> = match body.remove(SECTION_EXPLANATIONS) {
            None | Some(Value::Null) => BTreeMap::new(),
            Some(v) => serde_json::from_value(v).map_err(|_| "E_AI_BODY_SECTION")?,
        };
        let ai_shares: Vec<AiShareRecord> = take_array(&mut body, SECTION_AI_SHARES)?;
        let candidates: Vec<AiCandidate> = take_array(&mut body, SECTION_CANDIDATES)?;
        let screen = Value::Object(body.clone()).to_string();
        Ok((
            HouseholdBook {
                household_id: household_id.to_owned(),
                customer_no,
                generation,
                fictional: false,
                category: None,
                body,
                saved_consents: consents.clone(),
                consents,
                explanations,
                saved_candidates: candidates.clone(),
                candidates,
                saved_ai_shares: ai_shares.clone(),
                file_ai_shares: ai_shares,
            },
            screen,
        ))
    }

    /// 画面から届いた本文に置き換える（アプリ本体だけが書く区画は、入っていても使わない）
    pub fn replace_body(&mut self, body_json: &str) -> Result<(), &'static str> {
        let mut body = parse_object(body_json)?;
        strip_owned(&mut body);
        self.body = body;
        Ok(())
    }

    /// 画面から届いた最後の本文（アプリ本体だけが書く区画は外したもの）の JSON。AI 接続口から渡された世帯の Web のヒアリングを発行するとき、
    /// その世帯を開いていない画面が、見直しの前回の値を世帯の値から作るためにだけ使う（0222。AI には渡さない）
    pub fn screen_body(&self) -> String {
        Value::Object(self.body.clone()).to_string()
    }

    /// 世帯ファイルに書く本文を作る（前に保存した記録から追記だけかを確かめる。外れたら書かない）
    pub fn compose(&self, ai_shares: &[AiShareRecord]) -> Result<String, String> {
        verify_consents_append_only(&self.saved_consents, &self.consents)?;
        verify_candidates(&self.saved_candidates, &self.candidates)?;
        verify_append_only(&self.saved_ai_shares, ai_shares)?;
        let mut body = self.body.clone();
        if !self.consents.is_empty() {
            body.insert(SECTION_CONSENTS.into(), to_value(&self.consents));
        }
        if !self.explanations.is_empty() {
            body.insert(SECTION_EXPLANATIONS.into(), to_value(&self.explanations));
        }
        if !ai_shares.is_empty() {
            body.insert(SECTION_AI_SHARES.into(), to_value(&ai_shares));
        }
        if !self.candidates.is_empty() {
            body.insert(SECTION_CANDIDATES.into(), to_value(&self.candidates));
        }
        Ok(Value::Object(body).to_string())
    }

    /// 保存できたとき: 今の記録を「保存した記録」にする（`ai_shares` は `compose` に渡したものと同じもの。
    /// 同意の記録と候補は、呼ぶ側が compose から mark_saved までの間に変えないこと）
    pub fn mark_saved(&mut self, ai_shares: &[AiShareRecord], generation: u64) {
        self.saved_consents = self.consents.clone();
        self.saved_candidates = self.candidates.clone();
        self.saved_ai_shares = ai_shares.to_vec();
        self.generation = generation;
    }

    /// 保存していない記録があるか
    pub fn is_dirty(&self, ai_shares: &[AiShareRecord]) -> bool {
        self.saved_consents != self.consents
            || self.saved_candidates != self.candidates
            || self.saved_ai_shares != ai_shares
    }

    /// 保存していない変化が、読まれた記録の回数と最後の日時だけか（同じ中身の読み取りが続いた。書き戻しを間引いてよい）
    pub fn only_read_counts_moved(&self, ai_shares: &[AiShareRecord]) -> bool {
        self.saved_consents == self.consents
            && self.saved_candidates == self.candidates
            && only_read_counts_changed(&self.saved_ai_shares, ai_shares)
    }

    /// 保存していない変化が、共有の台帳の記録と新しく届いた AI の候補だけか（同意の記録・候補の判断は書いた後）。
    /// そうなら、世帯ファイルの今の中身で帳面を作り直してから書いても、帳面だけの変化を落とさない（0248 の追記）
    pub fn only_additions_pending(&self) -> bool {
        self.saved_consents == self.consents
            && self
                .saved_candidates
                .iter()
                .all(|c| self.candidates.contains(c))
    }

    /// 同じ起動の中で前に持っていた帳面から、世帯ファイルに無い AI の候補を引き継ぐ（開き直したとき。
    /// 世帯ファイルに書けないまま開き直した候補・分岐で相手の版を選んだときのこちらの候補を落とさない）
    pub fn carry_candidates_from(&mut self, earlier: &HouseholdBook) {
        for c in &earlier.candidates {
            if !self.candidates.iter().any(|x| x.id == c.id) {
                self.candidates.push(c.clone());
            }
        }
    }

    /// 外部AIへの提供の同意の今の状態
    pub fn consent(&self) -> Option<ConsentRef> {
        current_external_ai(&self.consents)
    }

    /// 共有の元（復号した後の世帯。AIに渡すのは、ここから縮約の部品が作ったものだけ）。
    /// 画面の側の文章（FPのメモなど）は入れない（この版では縮約版だけを渡すため。0015 の6 の「足せる項目」は使わない）
    pub fn source(&self) -> Option<SharedHouseholdSource> {
        let input = self
            .body
            .get("household")?
            .get("request")?
            .get("input")?
            .clone();
        if !input.is_object() {
            return None;
        }
        Some(SharedHouseholdSource {
            household_id: self.household_id.clone(),
            customer_number: self.customer_no.clone(),
            revision: format!("generation-{}", self.generation),
            input,
            texts: Vec::new(),
            labels_by_member: None,
            // 画面は保存した条件をそのまま使う（無ければ条件なし）。縮約の部品が数と選択肢だけを確かめて渡す（0195）
            post_retirement: Some(
                self.body
                    .get("household")
                    .and_then(|h| h.get("postRetirement"))
                    .cloned()
                    .unwrap_or_else(|| Value::Object(serde_json::Map::new())),
            ),
            // 表示の設定（get_display_settings。0213）: 見せ方の区画だけ（数・真偽・短い英数字の値だけ）
            display: Some(crate::display::household_display_of(&self.body)),
            external_ai_consent: self.consent(),
            fictional: self.fictional,
            entered: Some(entered_of(&self.body)),
            followup: Some(followup_of(&self.body, self.category.as_deref())),
        })
    }

    /// 外部AIへの提供の同意（撤回・同意しなかった）を記録する。`author` は書いた人（事務所で共有しているとき）
    pub fn record_consent(
        &mut self,
        input: &ExternalAiConsentInput,
        today: &str,
        now: &str,
        author: Option<Author>,
    ) -> Result<ConsentRecord, &'static str> {
        let mut r = consent::new_external_ai_record(&self.consents, input, today, now)?;
        r.recorded_by = author;
        // 見せた文（シートの同意欄の文か、アプリの今の説明文）を1回だけ写す（0014 の4・0172）
        let shown = explanation_for(r.method);
        self.explanations
            .entry(explanation_ref(shown))
            .or_insert_with(|| shown.to_owned());
        self.consents.push(r.clone());
        Ok(r)
    }

    /// 共有の台帳から届いた候補を入れる（承認待ち）。同じ候補は2回入れない
    pub fn add_candidate(&mut self, p: PendingProposal) {
        if self.candidates.iter().any(|c| c.id == p.candidate_id) {
            return;
        }
        self.candidates.push(AiCandidate {
            id: p.candidate_id,
            source: "ai".into(),
            share_id: p.share_id,
            received_at: p.received_at,
            title: p.title,
            summary: p.summary,
            diffs: p.diffs,
            origin: p.origin,
            status: CandidateStatus::Pending,
            decided_at: None,
            decided_by: None,
            plan_id: None,
            decided_by_member: None,
        });
    }

    /// FPの判断を記録する（承認待ちの候補だけ。1回だけ）。`author` は判断したメンバー（事務所で共有しているとき）
    pub fn decide(
        &mut self,
        candidate_id: &str,
        accept: bool,
        plan_id: Option<String>,
        now: &str,
        author: Option<Author>,
    ) -> Result<(), &'static str> {
        let c = self
            .candidates
            .iter_mut()
            .find(|c| c.id == candidate_id)
            .ok_or("E_AI_CANDIDATE_UNKNOWN")?;
        if c.status != CandidateStatus::Pending {
            return Err("E_AI_CANDIDATE_DECIDED");
        }
        if accept
            && plan_id
                .as_deref()
                .is_none_or(|p| p.trim().is_empty() || p.len() > 64)
        {
            return Err("E_AI_CANDIDATE_PLAN");
        }
        c.status = if accept {
            CandidateStatus::Accepted
        } else {
            CandidateStatus::Rejected
        };
        c.decided_at = Some(now.to_owned());
        c.decided_by = Some("fp".into());
        c.decided_by_member = author;
        c.plan_id = if accept { plan_id } else { None };
        Ok(())
    }

    /// 画面に返す形。`office_policy` は、事務所の設定で FP が「事務所のプライバシーポリシーに AI の利用を書いている」ことを確かめているか（0226）
    pub fn view(
        &self,
        records: &[AiShareRecord],
        share: Option<ShareStatus>,
        office_policy: bool,
    ) -> HouseholdAiView {
        let consent = self.consent();
        let ai_use = ai_use(consent.as_ref(), office_policy, self.fictional);
        let ai_documents_use = ai_documents_use(consent.as_ref(), office_policy, self.fictional);
        let consent_state = match consent.as_ref().map(|c| c.decision) {
            None => "none",
            Some(ConsentDecision::Given) => "given",
            Some(ConsentDecision::Refused) => "refused",
            Some(ConsentDecision::Withdrawn) => "withdrawn",
        };
        HouseholdAiView {
            consent_state: consent_state.into(),
            consent_documents: consent.is_some_and(|c| c.documents),
            consents: self.consents.clone(),
            explanation: EXTERNAL_AI_EXPLANATION.into(),
            explanation_ref: explanation_ref(EXTERNAL_AI_EXPLANATION),
            explanation_version: EXTERNAL_AI_EXPLANATION_VERSION,
            hearing_sheet_explanation: HEARING_SHEET_EXTERNAL_AI_TEXT.into(),
            share,
            records: for_screen(records),
            candidates: self.candidates.clone(),
            document_proposals: Vec::new(),
            display_proposals: Vec::new(),
            allowlist_version: allowlist().version.clone(),
            fields: reduced_items(),
            saved: self.generation > 0,
            fictional: self.fictional,
            ai_use,
            ai_documents_use,
        }
    }
}

fn to_value<T: Serialize + ?Sized>(v: &T) -> Value {
    serde_json::to_value(v).unwrap_or(Value::Null)
}
