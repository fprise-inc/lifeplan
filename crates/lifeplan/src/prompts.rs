//! 使い方の例（MCP のプロンプト。0199）: Claude Desktop などの AI のアプリで、FP が一覧から選んで使う頼み方の型。
//!
//! - 中身は FP から AI への頼み方の文（利用者の役の1通）で、引数（世帯・場面など）をその場で埋める。道具は今ある物だけを名前で書く
//! - 世帯の中身・顧客の情報は入れない（引数は FP がその場で書く文だけ）。プロンプトを選んでも道具は呼ばれず、AI が文を読んで道具を使う
//! - 引数は MCP の決まりで文字だけ。空の文字は書かなかったものとして扱う（アプリによっては空で送ってくる）

use crate::server::LifeplanMcp;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{GetPromptResult, PromptMessage, Role};
use rmcp::{prompt, prompt_router, schemars};
use serde::Deserialize;

/// 何通りも比較するときの道具の使い方（比較の道具。0198）
const COMPARE_HOW: &str = "calculate を何度も呼ばず、compare で基本と各通り（8通りまで）を1回で計算する（返るのは通りごとの主な数字・基本との差・選んだ数字の年ごとの系列）";

/// 相場が下がった場合の型（比較の道具の market_stress。画面の資産運用のタブと同じ。0200）
const MARKET_STRESS_HOW: &str = "相場が下がった場合は、通りに market_stress（drop＝退職の直後に株などが下がる・low＝取り崩しの初めにしばらく利回りが低いまま・minus1＝利回りがずっと想定より1%低い）を書いた通りを足す（stress_test とは1つの通りにどちらか1つ）";

/// 世帯の引数の読み方
fn household(h: &str) -> String {
    format!("世帯「{h}」（見本の世帯の id なら sample_household_id、FP が渡した世帯の share_id なら share_id として使う。どちらか分からなければ list_sample_households・list_shared_households で確かめる）")
}

/// 空の文字は書かなかったものとして扱う
fn given(v: &Option<String>) -> Option<&str> {
    v.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

fn result(description: &str, text: String) -> GetPromptResult {
    GetPromptResult::new(vec![PromptMessage::new_text(Role::User, text)])
        .with_description(description)
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct CompareHouseholdsArgs {
    /// 1つ目の世帯（見本の世帯の id か、FP が渡した世帯の share_id。例 sampleSingle20s）
    pub household_a: String,
    /// 2つ目の世帯（同じく。例 sampleCoupleNoKids）
    pub household_b: String,
    /// 比較したいこと（例「65歳・90歳の時点の資産と、資産が尽きる年」）。省くと主な数字をひととおり
    pub focus: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct CompareMeasuresArgs {
    /// 世帯（見本の世帯の id か、FP が渡した世帯の share_id。例 salariedCoupleTwoKids）
    pub household: String,
    /// 並べたい対策（例「65歳まで働く・生活費を月27万円・NISA 月3万円・年金を70歳から」）。省くと AI が3〜5つ選ぶ
    pub measures: Option<String>,
    /// 主な数字を見る本人の年齢（例「65・90」）。省くと 65歳と90歳
    pub at_ages: Option<String>,
    /// 相場が下がった場合も並べるか（例「退職の直後に下がる」「全部」）。省くと AI が要るか決める
    pub market_stress: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SeminarHouseholdArgs {
    /// 世帯の形（例「38歳の会社員と扶養のパートの妻・賃貸・預金500万円」）
    pub profile: String,
    /// 起きること（例「来年8月に子が生まれ、2028年4月に4,000万円の家を買う」）。省くと今のまま
    pub events: Option<String>,
    /// 欲しい表（例「5年ごとの金融資産とローン残高を、家族の年齢つきで」）。省くと5年ごとの金融資産
    pub output: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct HouseholdToAppArgs {
    /// 世帯の形（例「38歳の会社員と扶養のパートの妻・賃貸・預金500万円」）
    pub profile: String,
    /// 使う先（例「来月のセミナー」「新人研修」）。省くとセミナー
    pub purpose: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct QuestionsArgs {
    /// 世帯（FP が渡した世帯の share_id か、見本の世帯の id）。省くと、渡されている世帯を確かめる
    pub household: Option<String>,
    /// 面談のテーマ（例「住宅購入」「老後資金」「保険の見直し」）。省くと全体
    pub topic: Option<String>,
    /// 確かめたいプラン（例「65歳まで働く」「2028年に4,000万円の家を買う」）。省くと今の入力（現状）
    pub plan: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct MeetingPrepArgs {
    /// 世帯（FP が渡した世帯の share_id か、見本の世帯の id）。省くと、渡されている世帯を確かめる
    pub household: Option<String>,
    /// 面談のテーマ（例「老後資金」「住宅購入」「保険の見直し」「教育費」）。省くと全体の見通し
    pub topic: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ExplainForClientArgs {
    /// 世帯（見本の世帯の id か、FP が渡した世帯の share_id）
    pub household: String,
    /// 説明したい数字（例「2030年の税・社会保険料」「2045年の年金」）
    pub number: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct RatePathChartArgs {
    /// 世帯（見本の世帯の id か、FP が渡した世帯の share_id。変動金利の住宅ローンのある世帯。例 salariedCoupleTwoKids）
    pub household: String,
    /// 比較する金利の上がり方（例「今のまま・10年で+1%・10年で+2%」「5年ごとに+0.25%」）。省くと、今のまま・10年で+1%・10年で+2% の3通り
    pub paths: Option<String>,
    /// 使う先（例「セミナーのスライド」「ブログ」）。省くとセミナーの資料
    pub purpose: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct PatternsChartArgs {
    /// 世帯（見本の世帯の id か、FP が渡した世帯の share_id。例 salariedCoupleTwoKids）
    pub household: String,
    /// 比較したいこと（動かす項目と3つの値。例「退職の年齢 60・65・70歳」「子の進路 今のまま・すべて公立・中学から私立」「物価上昇率 0%・1%・2%」）。
    /// 省くと、AI がこの世帯で効きそうな項目を1つ選ぶ
    pub lever: Option<String>,
    /// グラフにする数字（例「金融資産と年間収支」「教育費」「支出の内訳」）。省くと、動かす項目に合う数字を AI が選ぶ
    pub show: Option<String>,
    /// 使う先（例「セミナーのスライド」「ブログ」）。省くとセミナーの資料
    pub purpose: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct FindBoundaryArgs {
    /// 世帯（見本の世帯の id か、FP が渡した世帯の share_id。例 salariedCoupleTwoKids）
    pub household: String,
    /// 探したい境目（例「最後まで資産が尽きない、いちばん早い退職の年齢」「90歳の時点で資産がマイナスにならない、毎月の生活費の上限」
    /// 「積立をやめる年齢を、いつまで早めても足りるか」）。省くと、最後まで資産が尽きない、いちばん早い退職の年齢
    pub question: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct MakeTableArgs {
    /// 世帯（見本の世帯の id か、FP が渡した世帯の share_id。例 salariedCoupleTwoKids）
    pub household: String,
    /// 表にしたい数字と年（例「5年ごとの収入・支出・年間収支・金融資産残高を、夫婦の年齢つきで」「60〜90歳を5年ごとに、収入の内訳と NISA の残高も」）。省くと、5年ごとの収入・税と社会保険料・支出・年間収支・金融資産残高を家族の年齢つきで
    pub what: Option<String>,
    /// 並べたい通り（例「退職60・65・70歳」「NISA 月3万円を足す」）。省くと今のままだけ
    pub variants: Option<String>,
    /// 使い方（例「Excel で開く」「資料に貼る」「受け取った数字で自分でグラフにする」）。省くと会話に表で見せる
    pub purpose: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct OfficeWordingArgs {
    /// 直したい文や名前（例「資産運用の結論の1文と取り崩しの条件」「結果のタブのポイント」「キャッシュフロー表の行の名前」）。省くと結果の画面の文
    pub target: Option<String>,
    /// 事務所の言い方（例「お客さまに『です・ます』でやわらかく」「専門用語を避ける」「いつも使っている言い方: 資金計画」）。省くと、今の文を見て AI が案を出す
    pub style: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct CheckCoverageArgs {
    /// 調べたい制度や計算（例「高額療養費」「ふるさと納税」「iDeCo の受け取り方」）
    pub topic: String,
}

#[prompt_router(vis = "pub(crate)")]
impl LifeplanMcp {
    #[prompt(
        name = "what_can_you_do",
        title = "この接続口でできること",
        description = "ファイナンシアの AI接続口でできることを、見本の世帯で試しながら紹介してもらう"
    )]
    async fn what_can_you_do(&self) -> GetPromptResult {
        result(
            "この接続口でできること",
            "ファイナンシアの AI接続口で何ができるかを、FP 向けに短く紹介してください。\n\
             - できることを場面ごとに（計算・対策を並べて比較する・境目探し〔何歳まで働けば足りる？〕・数字の根拠の説明・制度の値と出典・計算に入っているかの確認・セミナー用の架空の世帯・作った世帯をアプリに入れる・面談の準備・面談でお客さまに聞くことのまとめ・プランの候補・保険の書類からの入力の候補）、頼み方の例を1つずつ添えて。\n\
             - アプリが起動していなくても見本の世帯（架空）で試せること、お客さまの世帯は FP がアプリで渡したときだけ読めることを一言。\n\
             - 最後に、list_sample_households で見本を1つ選び、calculate（omit に [\"years\"]）で主な数字を1つ見せて、試し方の例にしてください。"
                .to_owned(),
        )
    }

    #[prompt(
        name = "compare_households",
        title = "2つの世帯を比較",
        description = "2つの世帯（見本の世帯か FP が渡した世帯）の主な数字を並べて比較する"
    )]
    async fn compare_households(
        &self,
        Parameters(a): Parameters<CompareHouseholdsArgs>,
    ) -> GetPromptResult {
        let focus = given(&a.focus).unwrap_or("65歳・90歳の時点の金融資産・資産が尽きる年・金融資産がいちばん少ない年と額・生涯の手取りと支出・住宅ローンの返済の合計・65歳からの年金の月額");
        result(
            "2つの世帯を比較",
            format!(
                "ファイナンシアの接続口で、次の2つの世帯を比較してください。\n\
                 - A: {}\n- B: {}\n- 比較したいこと: {focus}\n\n\
                 進め方:\n\
                 1. A を基本の世帯に、B を variants の1通り（label と、B の sample_household_id か share_id）にする。{COMPARE_HOW}。年齢の時点は at_ages で渡す。\n\
                 2. 主な数字（年金の月額は keyFigures.pension の monthly。今の水準の額）を1つの表（行が数字、列が A・B）に並べ、違いの大きい所を2〜3行で。家族の形・年齢・計算の期間が違うときは、そのことも書く。\n\
                 3. 推移は compare の系列（既定は金融資産を5年ごと・年齢つき）を使う。ほかの数字は series（例 [\"financialAssets\", \"debt\"]）で選ぶ。\n\
                 4. 違いの理由は推測で断定しない。気になる数字は explain_value で根拠を確かめてから書く。",
                household(&a.household_a),
                household(&a.household_b),
            ),
        )
    }

    #[prompt(
        name = "compare_measures",
        title = "対策をいくつか並べて比較",
        description = "1つの世帯で、働く期間・生活費・NISA・年金の受け取り開始などの対策を並べて、どれが効くかを比較する"
    )]
    async fn compare_measures(
        &self,
        Parameters(a): Parameters<CompareMeasuresArgs>,
    ) -> GetPromptResult {
        let measures = given(&a.measures).map_or_else(
            || "（指定なし。動かせる項目から、この世帯で効きそうな物を3〜5つ選ぶ）".to_owned(),
            str::to_owned,
        );
        let ages = given(&a.at_ages).unwrap_or("65・90");
        let stress = given(&a.market_stress)
            .unwrap_or("（指定なし。資産運用の多い世帯や、相場に左右される対策なら1つ足す）");
        result(
            "対策をいくつか並べて比較",
            format!(
                "ファイナンシアの接続口で、{} に対策をいくつか当てて並べてください。\n\
                 - 対策: {measures}\n- 主な数字を見る本人の年齢: {ages}\n- 相場が下がった場合: {stress}\n\n\
                 進め方:\n\
                 1. list_plan_items で、この世帯で動かせる項目（対象・入力項目ID・今の値・動かせる範囲）を確かめる。\n\
                 2. 対策ごとに、variants の1通り（label と plan_changes。plan_changes は target・item・value〔一覧が at か lever を添えた項目は、それもそのまま〕で、画面のプランと同じ書き方）を作る。changes で欄を1つだけ書き換えない（画面と数字がずれる）。\n\
                 3. 基本（今のまま）に、各対策と効きそうな組み合わせ1つを重ねて並べる。{COMPARE_HOW}。年齢の時点は at_ages で渡す。\n\
                 4. {MARKET_STRESS_HOW}。効きそうな対策に重ねると、相場が下がっても足りるかが分かる。\n\
                 5. 表にする（行が通り、列が年齢の時点の金融資産・資産が尽きる年・金融資産がいちばん少ない年。年金の受け取り開始を動かした通りがあれば、65歳からの年金の月額と受け取り開始からの月額〔diff の pensionMonthly・pensionClaimedMonthly〕も）。範囲の外などで計算されなかった通りは、返ってきた理由をそのまま書く。\n\
                 6. どれが効くかを2〜3行で。前提（物価・利回りなど）しだいで変わることを一言添える。\n\
                 7. FP が渡した世帯なら、FP に頼まれたときだけ、選んだ対策を同じ書き方で propose_scenario に渡してプランの候補にできると伝える。",
                household(&a.household),
            ),
        )
    }

    #[prompt(
        name = "make_seminar_household",
        title = "セミナー用の架空の世帯を作る",
        description = "セミナー・ブログ用に、架空の世帯を組み立てて計算し、スライドに使える表にする"
    )]
    async fn make_seminar_household(
        &self,
        Parameters(a): Parameters<SeminarHouseholdArgs>,
    ) -> GetPromptResult {
        let events = given(&a.events).unwrap_or("（なし。今のまま）");
        let output = given(&a.output).unwrap_or("5年ごとの金融資産を、家族の年齢つきで");
        result(
            "セミナー用の架空の世帯を作る",
            format!(
                "ファイナンシアの接続口で、セミナー用の架空の世帯を作って計算してください（実在のお客さまの数字は使わない）。\n\
                 - 世帯の形: {}\n- 起きること: {events}\n- 欲しい表: {output}\n\n\
                 進め方:\n\
                 1. 近い見本があれば list_sample_households の tags（例 [\"子育て\"]・[\"賃貸\"]）で探して get_sample_household の input を土台にする。無ければ get_input_guide の計算できる最小の例（skeleton）から組み立てる。\n\
                 2. 家を買う・子が生まれる・退職・繰上返済・NISA と iDeCo を始める・もしもの時は、get_input_recipe の手本（buyHome・newChild・retire・prepayment・startNisaIdeco・contingency）を使う。重ねるときは apply: true で返る input を次の手本に渡す。書かなかった物（頭金・諸費用・教育費など）は計算に入らない。\n\
                 3. calculate で計算する。表は every_years（例 5）と fields（例 [\"financialAssets\", \"debt\"]）で絞り、年ごとの家族の年齢を添える（表は画面の表と同じ年から始まる。計算基準月が年の途中なら翌年から）。計算できなかったときは、答えの「直し方」で直してもう一度。\n\
                 4. 表と、見どころを2〜3行で。表の下に「架空の世帯です」と、主な前提（物価・利回り・年収など）を書く。",
                a.profile.trim(),
            ),
        )
    }

    #[prompt(
        name = "make_household_in_app",
        title = "セミナー用の架空の世帯を作ってアプリに入れる",
        description = "セミナー・研修用の架空の世帯を組み立てて確かめ、アプリに「新しい世帯の候補」として出す（FP がアプリで確かめて作る）"
    )]
    async fn make_household_in_app(
        &self,
        Parameters(a): Parameters<HouseholdToAppArgs>,
    ) -> GetPromptResult {
        let purpose = given(&a.purpose).unwrap_or("セミナー");
        result(
            "セミナー用の架空の世帯を作ってアプリに入れる",
            format!(
                "ファイナンシアの接続口で、{purpose}に使う架空の世帯を作って、アプリに入れてください（実在のお客さまの数字は使わない）。\n\
                 - 世帯の形: {}\n\n\
                 進め方:\n\
                 1. 近い見本があれば list_sample_households の tags（例 [\"賃貸\"]・[\"片働き\"]）で探して get_sample_household の input を土台にする。無ければ get_input_guide の計算できる最小の例（skeleton）から組み立てる。家を買う・子が生まれるなどは get_input_recipe の手本を使う。\n\
                 2. 書いていないこと（年収・生活費・家賃・預金の内訳など）は、世帯の形に合う目安で置き、何を推定したかを控えておく。\n\
                 3. calculate（omit に [\"years\"]）で計算できることと主な数字を確かめる。計算できなかったときは、答えの「直し方」で直してもう一度。\n\
                 4. propose_household で、kind に fictional、title に短い題（60文字まで。例「{purpose}用 38歳の会社員と扶養のパートの妻」）、note に推定したこと、input に確かめた入力を渡す。アプリが起動していない・AI接続口がオフのときは、そう伝えて終える。\n\
                 5. FP に、アプリの上の帯の「AIから新しい世帯の候補が届いています」から中身（家族・収入・資産・住まいとローン・推定したこと）を確かめて「世帯として作る」を押すよう伝える。作った世帯には「架空」の印が付き、同意の記録が無くても AI に渡せることも一言。\n\
                 お客さまの名前・番号は、題・推定したこと・入力の名前の欄のどこにも書かない。",
                a.profile.trim(),
            ),
        )
    }

    #[prompt(
        name = "prepare_meeting",
        title = "面談の準備",
        description = "面談の前に、世帯の見通し・話すとよい対策・お客さまに確かめることを1枚にまとめる"
    )]
    async fn prepare_meeting(&self, Parameters(a): Parameters<MeetingPrepArgs>) -> GetPromptResult {
        let who = given(&a.household).map_or_else(
            || "FP が渡した世帯（list_shared_households で確かめる。渡されていなければ、アプリで「この世帯をAIに渡す」をしてもらうよう伝える）".to_owned(),
            household,
        );
        let topic = given(&a.topic).unwrap_or("全体の見通し（老後資金を中心に）");
        result(
            "面談の準備",
            format!(
                "ファイナンシアの接続口で、次の面談の準備をしてください。\n\
                 - 世帯: {who}\n- テーマ: {topic}\n\n\
                 進め方:\n\
                 1. calculate で、omit に [\"years\"]、at_ages に [65, 90] を入れて主な数字を取る。65歳からの年金の月額（keyFigures.pension。今の水準の額）、preparation（計算の前に外した物・事務所の推定の値）と notices も見る。\n\
                 2. 推移は every_years に 5、fields に [\"financialAssets\"] を入れて取る。\n\
                 3. list_plan_items で動かせる項目を見て、テーマに合う対策を2〜3つ選び、variants の通り（label と plan_changes）にして並べる。{COMPARE_HOW}。\n\
                 4. テーマが老後資金・資産運用なら、{MARKET_STRESS_HOW}（基本に重ねて、相場が下がっても足りるかを見る）。\n\
                 5. テーマが保険なら、必要保障額（get_input_recipe の contingency、入力の /protection）を、相続なら相続税の目安（/inheritanceTax）を足して計算する。\n\
                 6. お客さまに確かめることは、check_inputs（入力の確かめ。推定や既定の値で計算している所・入っていなさそうな物・範囲の外の値を、聞く文の案 question つきで返す）で取る。\n\
                 7. 1枚にまとめる: 見通しを一言・主な数字の表・話すとよい対策・お客さまに確かめること（check_inputs の行から、テーマに合う物を5つほど）。\n\
                 お名前・番号は扱わない。数字は計算の前提しだいで変わることを添える。"
            ),
        )
    }

    #[prompt(
        name = "prepare_questions",
        title = "面談の前に、お客さまに聞くことをまとめる",
        description = "入力の確かめ（check_inputs）で、推定や既定の値で埋めた所・入っていなさそうな所・範囲の外の値を見て、面談でお客さまに聞くことを1枚にまとめる"
    )]
    async fn prepare_questions(&self, Parameters(a): Parameters<QuestionsArgs>) -> GetPromptResult {
        let who = given(&a.household).map_or_else(
            || "FP が渡した世帯（list_shared_households で確かめる。渡されていなければ、アプリで「この世帯をAIに渡す」をしてもらうよう伝える）".to_owned(),
            household,
        );
        let topic = given(&a.topic).unwrap_or("全体");
        let plan = given(&a.plan).unwrap_or("今の入力（現状）");
        result(
            "面談の前に、お客さまに聞くことをまとめる",
            format!(
                "ファイナンシアの接続口で、次の面談の前に「お客さまに聞くこと」をまとめてください。\n\
                 - 世帯: {who}\n- 面談のテーマ: {topic}\n- 確かめるプラン: {plan}\n\n\
                 進め方:\n\
                 1. check_inputs を呼ぶ。プランを確かめるなら、list_plan_items で動かす項目の target・item を確かめて plan_changes に入れる（家を買う・子が生まれるなどの場面は get_input_recipe の changes）。truncated が true なら、max_items を増やすか kinds で種類を絞って呼び直す。\n\
                 2. 返った行（groups の items）を、テーマに関係の深い順に並べ直し、多くても10問ほどに絞る。同じことを聞く行（同じ人のねんきん定期便と年金の額など）は1問にまとめる。\n\
                 3. 「お客さまに聞くこと」として、1問ごとに: 聞く文（question をもとに、お客さまに分かる丁寧な言葉で）・なぜ聞くか（reason を一言で）・持ってきてもらうとよい書類（ねんきん定期便・源泉徴収票・保険証券・住宅ローンの返済予定表など、行から分かる物だけ）。\n\
                 4. 入力項目が「前提条件」の行（物価上昇率・表の最後の年など）は、お客さまに聞かず FP が決める物なので、「FP が確かめること」として分けて書く。\n\
                 5. 今の値（value）・推定の値は答えのまま書き、推測で数字を足さない。お名前・番号は扱わない。question は案なので、FP が面談の前に確かめて直すよう添える。"
            ),
        )
    }

    #[prompt(
        name = "explain_to_client",
        title = "数字の根拠をお客さまに分かる言葉で説明する",
        description = "キャッシュフロー表の1つの数字がどう計算されたかを、根拠を取り出してお客さま向けの言葉にする"
    )]
    async fn explain_to_client(
        &self,
        Parameters(a): Parameters<ExplainForClientArgs>,
    ) -> GetPromptResult {
        result(
            "数字の根拠をお客さまに分かる言葉で説明する",
            format!(
                "ファイナンシアの接続口で、{} の「{}」がどう計算されたかを、お客さまに分かる言葉で説明してください。\n\n\
                 進め方:\n\
                 1. explain_value でその数字（キャッシュフロー表の行と年）の根拠を取り出す。行が分からなければ row を省いて行の一覧を見る。合計の行は内訳の行ごとに聞く。\n\
                 2. 使った制度の値の出典は get_regulation_value で確かめる。近似している所は search_coverage・get_coverage で、どう近似しているかを確かめる。\n\
                 3. お客さま向けの文にする: 結論（いくらか）→ 内訳（大きい順に2〜4つ）→ 前提（どんな決まり・仮定で計算したか）の順で、専門の言葉は言い換え、300字ほどで。\n\
                 4. 根拠に無いことを推測で足さない。将来の額を約束する書き方をしない（制度や前提が変われば変わると添える）。",
                household(&a.household),
                a.number.trim(),
            ),
        )
    }

    #[prompt(
        name = "chart_rate_paths",
        title = "金利の上がり方を3通り比較してグラフにする",
        description = "変動金利の住宅ローンのある世帯で、金利の上がり方を何通りか（今のまま・10年で+1%・10年で+2% など）にして比較し、資料にそのまま使えるグラフにする"
    )]
    async fn chart_rate_paths(
        &self,
        Parameters(a): Parameters<RatePathChartArgs>,
    ) -> GetPromptResult {
        let paths = given(&a.paths).unwrap_or("今のまま・10年で+1%・10年で+2%");
        let purpose = given(&a.purpose).unwrap_or("セミナーの資料");
        result(
            "金利の上がり方を3通り比較してグラフにする",
            format!(
                "ファイナンシアの接続口で、{} の変動金利の上がり方を比較して、{purpose}に使うグラフにしてください。\n\
                 - 比較する上がり方: {paths}\n\n\
                 進め方:\n\
                 1. list_plan_items で、住宅ローンの「金利の見込み（変動金利）」の項目（kind が rateOutlook）を探す。ローンが2本以上あれば、ローンごとの項目を同じ値にする。項目が無ければ、変動金利の住宅ローンが無いと伝えて終える。\n\
                 2. 上がり方ごとに通り（label と plan_changes）を作る。plan_changes は一覧の target・item・lever と value で、value は型の名前（flat＝今の金利のまま・up1＝10年で1%上がる・up2＝10年で2%上がる）か、5年ごとの上乗せ（例 {{\"adds\": [\"0.0025\", \"0.005\"]}}）。いちばん初めの通りを基本にする。stress_test の rateRise は上げ幅を選べないので使わない。\n\
                 3. chart で、charts に assets・repayment・rate・keyFigures、figures に assetsAtAge・minimum・loanRepayment・loanInterest を入れてグラフにする（数字を自分で描かない。rate はその年の金利の推移。format は both にすると SVG も返る）。label には上がり方だけを書き、お客さまの名前を書かない。\n\
                 4. グラフの下に、見どころを2〜3行で（返済の合計の差・利息の合計の差〔keyFigures.loanInterest と diff.loanInterest〕・金融資産がいちばん少ない額・資産が尽きる年の差など。答えの results の数字だけを使う）。変動金利の5年ルール・125%ルールで返済額の上がり方がゆるやかなことにも触れる。\n\
                 5. 実在のお客さまの世帯なら、使う前に金額を丸める・珍しい組み合わせを変える・お客さまに一言ことわる、のどれかが要ると伝える（見本の世帯は架空）。",
                household(&a.household),
            ),
        )
    }

    #[prompt(
        name = "chart_three_patterns",
        title = "3パターンを比較してグラフに",
        description = "1つの項目（退職の年齢・子の進路・家の値段・物価・運用の利回り・年金の受け取り開始・NISA の積立など）を3通りにして比較し、金融資産・年間収支・教育費などの推移を、資料にそのまま使えるグラフにする"
    )]
    async fn chart_three_patterns(
        &self,
        Parameters(a): Parameters<PatternsChartArgs>,
    ) -> GetPromptResult {
        let lever = given(&a.lever)
            .unwrap_or("（指定なし。この世帯で結果が大きく変わりそうな項目を1つ選ぶ）");
        let show = given(&a.show)
            .unwrap_or("（指定なし。動かす項目に合う数字を選ぶ。迷えば金融資産と年間収支）");
        let purpose = given(&a.purpose).unwrap_or("セミナーの資料");
        result(
            "3パターンを比較してグラフに",
            format!(
                "ファイナンシアの接続口で、{} の「{lever}」を3通りにして比較し、{purpose}に使うグラフにしてください。\n\
                 - グラフにする数字: {show}\n\n\
                 進め方:\n\
                 1. list_plan_items で、動かす項目の target・item（一覧が at か lever を添えた項目は、それもそのまま）と、今の値・範囲を確かめる。ID は推測せず、必ず一覧の物を使う。\n\
                 2. 1つ目の値を基本（label と plan_changes）、残りの2つ（多くても3つ）を variants の通りにする。label には値だけを書き、お客さまの名前を書かない。{COMPARE_HOW}。\n\
                 3. 先に compare で計算して、3通りとも status が ok か、値が範囲の中かを確かめる（series に、グラフにしたい数字を入れておくと、年ごとの数字も見られる）。\n\
                 4. chart に同じ基本と通りを渡し、series にグラフにする数字を入れる（compare の series と同じ名前。1つにつき1枚の折れ線）。支出の内訳を並べるなら charts に expenseBreakdown。数字を自分で描かない。\n\
                 5. グラフの下に、見どころを2〜3行で（答えの results の keyFigures・diff の数字だけを使う）。前提（物価・利回り）しだいで変わることを一言。\n\
                 6. 実在のお客さまの世帯なら、使う前に金額を丸める・珍しい組み合わせを変える・お客さまに一言ことわる、のどれかが要ると伝える（見本の世帯は架空）。グラフに「ファイナンシアで試算」と入れたいときだけ credit: true。\n\n\
                 項目と数字の例（項目の ID は list_plan_items の物）:\n\
                 - 退職の年齢（例 60・65・70歳）: 「ご本人が働く最後の年齢」（item が employment.to）。series は financialAssets・net・takeHome\n\
                 - 子の進路（例 今のまま・すべて公立・中学から私立）: 子ごとの「第1子の進路の型」（lever が educationCourse・kind が choice）。value は options の型の名前（allPublic＝すべて公立・juniorPrivate＝中学から私立など）。子が2人以上なら、通りごとに子の数だけ plan_changes に入れる。「今のまま」は基本にして plan_changes を書かない。changes で教育の段を書き換えない（グラフの注に進路の違いが出なくなる）。series は expenseEducation・financialAssets、charts に expenseBreakdown\n\
                 - 家の値段（例 3,500万・4,500万・5,500万円）: get_input_recipe の buyHome を値段ごとに作り、返った changes を通りの changes に入れる。series は financialAssets・loanBalance・expenseHousing\n\
                 - 物価上昇率（例 0%・1%・2%）: 「経済の前提: 物価上昇率（年）」（item が assumptions.inflation。group に 前提条件）。series は financialAssets・expense\n\
                 - 運用の利回り（例 2%・4%・6%）: 「運用の利回り（預金を除く）」（item が assumptions.returnShifts）。series は financialAssets\n\
                 - 年金の受け取り開始（例 65・70・75歳）: 「ご本人の年金の受け取り開始」（item が pensionRecord.claim）。series は pension・financialAssets\n\
                 - NISA の毎月の積立（例 1万・3万・5万円）: 「NISAの積立額（月）」（item が account.contributions）。series は financialAssets・net",
                household(&a.household),
            ),
        )
    }

    #[prompt(
        name = "find_boundary",
        title = "境目を探す（何歳まで働けば足りる？など）",
        description = "「最後まで足りる、いちばん早い退職の年齢」「90歳の時点で資産が残る、生活費の上限」のような境目を、接続口の中で探して、境目とその1つ外側の数字を見せる"
    )]
    async fn find_boundary(&self, Parameters(a): Parameters<FindBoundaryArgs>) -> GetPromptResult {
        let question =
            given(&a.question).unwrap_or("最後まで資産が尽きない、いちばん早い退職の年齢");
        result(
            "境目を探す",
            format!(
                "ファイナンシアの接続口で、{} の境目を探してください。\n\
                 - 探したい境目: {question}\n\n\
                 進め方:\n\
                 1. list_plan_items で、動かす項目（働く最後の年齢・毎月の生活費・運用の利回り・積立をやめる年齢など）の target・item と、今の値・範囲を確かめる。一覧が at か lever を添えた項目は、それもそのまま使う。\n\
                 2. calculate を何度も呼ばず、find_threshold で探す。vary に一覧の書き方、from・to・step に探す範囲と答えの細かさ、condition に条件（noDepletion＝資産が最後まで尽きない・assetsAtAge＝○歳の時点で○円以上・minimumAtLeast＝いちばん少ない年でも○円以上）、want に max（いちばん大きい値。例: 生活費の上限）か min（いちばん小さい値。例: いちばん早い退職の年齢）を書く。\n\
                 3. status が edge なら範囲を広げて探し直す。notFound なら、範囲の中に満たす値が無いと伝える。\n\
                 4. 答えの message と rows（境目の値と、その1つ外側の値の主な数字）で、境目を一言と小さな表にする。境目の前後を見たいときは、sweep でその近くを振って表にする。\n\
                 5. 境目は前提（物価・利回り・年収など）しだいで動くことを添える。",
                household(&a.household),
            ),
        )
    }

    #[prompt(
        name = "make_table",
        title = "表にする（CSV・Markdown。自分でグラフにするときも）",
        description = "世帯の年ごとの数字（キャッシュフロー表）を、画面と同じ数字のまま CSV か Markdown の表にする。受け取った数字で AI が自分でグラフを描くときの決まりも添える"
    )]
    async fn make_table(&self, Parameters(a): Parameters<MakeTableArgs>) -> GetPromptResult {
        let what = given(&a.what).unwrap_or(
            "5年ごとの収入・税と社会保険料・支出・年間収支・金融資産残高を、家族の年齢つきで",
        );
        let variants = given(&a.variants).unwrap_or("（なし。今のままだけ）");
        let purpose = given(&a.purpose).unwrap_or("この会話で表として見せる");
        result(
            "表にする",
            format!(
                "ファイナンシアの接続口で、{} の年ごとの数字を表にしてください。\n\
                 - 表にしたい数字と年: {what}\n- 並べたい通り: {variants}\n- 使い方: {purpose}\n\n\
                 進め方:\n\
                 1. 通りがあれば、list_plan_items で動かす項目（働く最後の年齢・生活費・NISA など）の target・item を確かめ、通り（label と plan_changes）にする。label には通りの違いだけを書き、お客さまの名前を書かない。\n\
                 2. table を呼ぶ（calculate・compare の JSON から自分で表を組み立てない）。rows（compare の series と同じ名前: income・takeHome・taxSi・expense・net・financialAssets・debt・loanRepayment・loanBalance・loanInterest・loanRate・pension・shortfall と、支出の内訳 expenseLiving・expenseHousing・expenseEducation など、収入の内訳 incomeSalary・incomePension・incomeOther など、NISA の nisaContribution〔積立〕・nisaBalance〔残高〕。内訳をまとめて選ぶなら expenseBreakdown・incomeBreakdown）・every_years・年（from_year・to_year。「60〜90歳」のように本人の年齢で選ぶなら from_age・to_age。両方は書けない）・members（self・spouse・child1…）・unit（man＝万円か yen）を選ぶ。画面のキャッシュフロー表と同じく年を列にしたいときは orientation: yearsAcross。会話や資料に貼るなら format は markdown、Excel やプログラムで読むなら csv（日本語の Windows の Excel で開くなら bom: true）。通りが2つ以上なら、数字ごとに通りを並べる layout: byRow か、通りごとに分ける byVariant。\n\
                 3. 返った表の文を、数字を変えずにそのまま出す。表の下の「※」の注（前提・相場などの想定・単位・試算の時点と、将来の結果を約束するものではない旨）も必ず一緒に出す。「ファイナンシアで試算」の旨は、FP が望んだときだけ credit: true で入れる。\n\
                 4. 受け取った数字で自分でグラフを描くときは: 数字を足し引き・丸め直し・なめらかにする・間を埋める・先へ延ばすなどで変えない（表に無い年は描かない）。単位（万円）と年・年齢の軸を書き、表の下の注を図に添える。画面と同じ見た目のグラフや、資料にそのまま使うグラフが要るなら、自分で描かず chart を使う。\n\
                 5. 実在のお客さまの世帯をブログ・セミナーなどに使うなら、金額を丸める・珍しい組み合わせを変える・お客さまに一言ことわる、のどれかが要ると伝える（見本の世帯は架空）。",
                household(&a.household),
            ),
        )
    }

    #[prompt(
        name = "office_wording",
        title = "事務所の言い方に文言を直す",
        description = "結果の画面の結論の1文・取り崩しの条件・ポイント・説明の文や、欄・表の行の名前を、事務所の言い方に直す下書き（カスタム層の settings/texts.json・settings/terms.json）を作る。FP がアプリで承認したときだけ画面に出る"
    )]
    async fn office_wording(
        &self,
        Parameters(a): Parameters<OfficeWordingArgs>,
    ) -> GetPromptResult {
        let target = given(&a.target).unwrap_or("結果の画面の文（結論の1文・取り崩しの条件・グラフの注・ポイント・夢と予定・万一のときの結論の1文）");
        let style = given(&a.style).unwrap_or(
            "（指定なし。今の公式の文を読んで、お客さまに伝わりやすい言い方の案を出す）",
        );
        result(
            "事務所の言い方に文言を直す",
            format!(
                "ファイナンシアの画面の文言を、事務所の言い方に直す下書きを作ってください。\n\
                 - 直したい文や名前: {target}\n- 事務所の言い方: {style}\n\n\
                 進め方:\n\
                 1. list_custom_texts で差し替えられる文を引く（結果の画面の文は kind に result、名前は file に terms。prefix・query でも絞れる）。1件ごとに id・画面のどこに出るか（where）・公式の文・使える差し込みの印（vars）・できる操作（ops）・指紋（hash）が返る。\n\
                 2. 直す文ごとに、公式の文と直した案を並べて FP に見せ、どれを直すか確かめる。年齢・年・額・率・プランの名前は、差し込みの印（例 {{age}}・{{plan}}）のまま残す（数字を文に書き込まない。差し込む値は単位まで入るので、{{age}}歳 のように単位を重ねない）。vars に無い印は使わない。お客さまに見える文（audience が customer）は、お客さまに断定しすぎない言い方にする。\n\
                 3. FP が決めた分だけ、答えの howTo の形で settings/texts.json（文）・settings/terms.json（名前）の下書きを作る。basedOn には一覧の hash をそのまま写す。すでにファイルがあれば、ほかの行を消さずに足す・直す。\n\
                 4. 下書きは、カスタム層のフォルダ（アプリの事務所の既定値の画面に場所が出る）の settings/ に置く。この接続口はファイルを書かないので、あなたがそのフォルダに書けなければ、中身を FP に渡して置いてもらう。\n\
                 5. 置いたら、アプリの事務所の既定値の画面の「説明の文（カスタム層）」「名前（カスタム層）」で中身を確かめて承認するよう FP に伝える。承認するまで画面は公式の文のままで、計算の結果はどの文でも変わらない。注意（数字の入る印が無い など）が出たら、その行を直す。",
            ),
        )
    }

    #[prompt(
        name = "check_coverage",
        title = "制度や計算に入っているかを調べる",
        description = "ある制度や計算がファイナンシアに入っているか（入っている・近似している・まだ入っていない）を、対応範囲の一覧で調べる"
    )]
    async fn check_coverage(
        &self,
        Parameters(a): Parameters<CheckCoverageArgs>,
    ) -> GetPromptResult {
        result(
            "制度や計算に入っているかを調べる",
            format!(
                "ファイナンシアの計算に「{}」が入っているかを調べてください。\n\n\
                 進め方:\n\
                 1. search_coverage で対応範囲の一覧を探し、当たった項目を get_coverage で読む。\n\
                 2. 「入っている（どう計算するか）」「近似している（どう近似するか・理由）」「まだ入っていない」のどれかで答える。制度の値（額・率）が要るときは get_regulation_value で値・適用期間・出典を添える。\n\
                 3. 一覧に見当たらないときは、入っていると推測せず「一覧に見当たらない」と答える。まだ入っていない物は、アプリの「要望・不具合を送る」から送れると伝える（この接続口からは送らない）。\n\
                 4. ほかのソフトとの違いを聞かれても、ほかのソフトのことは推測で断定しない（ファイナンシアの側は一覧で確かめた事実だけを書く）。",
                a.topic.trim(),
            ),
        )
    }
}
