//! 段階配信と一時停止（0022 の4）。
//!
//! - 各アプリは、インストールのときに0〜99の数（配信の組 [`Cohort`]）を1つ作り、手元にだけ持つ（送らない）。
//! - 目録の `rollout.percent`（0〜100）より組が小さいアプリだけが当てる。割合を上げると広がる。100 なら全員、0 なら誰も当てない。
//! - `paused` が付いた目録は、まだ当てていないアプリは当てずに待つ（当てたアプリは戻さない。戻すのは巻き戻しの版を配ってから）。

use serde::{Deserialize, Serialize};

use crate::Reject;

/// 配信の組（0〜99。手元にだけ持つ）
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Cohort(u8);

impl Cohort {
    pub fn new(n: u8) -> Option<Cohort> {
        (n < 100).then_some(Cohort(n))
    }

    /// OS の乱数から作る（インストールのとき1回だけ。作った数は保存して使い続ける）。乱数は呼ぶ側が渡す
    pub fn from_random(r: u64) -> Cohort {
        Cohort((r % 100) as u8)
    }

    pub fn get(&self) -> u8 {
        self.0
    }
}

/// 目録の段階の欄
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Rollout {
    /// 段階の番号（0 から。表示と記録のためで、判断には使わない）
    pub stage: u32,
    /// 当ててよい割合（0〜100）
    pub percent: u8,
}

impl Rollout {
    pub(crate) fn check(&self) -> Result<(), Reject> {
        if self.percent > 100 || self.stage > 1000 {
            return Err(Reject::FORMAT);
        }
        Ok(())
    }

    /// この組のアプリが、この段階で当ててよいか
    pub fn includes(&self, cohort: Cohort) -> bool {
        cohort.0 < self.percent
    }
}

/// 待つ理由
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Wait {
    /// 一時停止の印が付いている
    Paused,
    /// まだこの組の番ではない（段階配信の途中）
    NotYourTurn,
    /// 自動配信の確認期間が終わっていない
    ReviewWindow,
}
