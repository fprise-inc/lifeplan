//! 提案書の PDF を作る（0009 の5〜9）。
//!
//! - Typst をライブラリとして組み込む（外部のコマンドは呼ばない。0009 の8）。読めるのは、同梱の公式の帳票の部品
//!   （`@lifeplan/report-core`）と、渡された帳票の入力（JSON）だけ。OS のフォントは探さず、同梱の BIZ UDゴシックだけを使う。
//!   帳票が同梱以外のフォントを指定したらエラーにする。時計は渡さない（同じ入力から同じ PDF）。
//! - 刻印（制度データの版・計算基準日）と「β版・試算」の透かしは、帳票を組んだ後に、アプリが各ページの下端の帯へ重ねる
//!   （帳票の外側。帳票からは消せない。0009 の5）。
//! - 必須の記載（試算である旨など）は、公式の帳票では「前提条件と注意書き」の決まった欄に入る。帳票に無ければ、
//!   アプリが「注意書き」のページを最後に足す（0009 の6）。
//! - 出力の後に PDF から文字を抜き出し、刻印と必須の記載が入っていることを確かめる。入っていなければ出力しない（0009 の6）。
//! - 作成ソフトの欄（Creator・Producer）は空にし、印刷されない内部情報（XMP）に控えの ID・データの組・計算基準日・
//!   カスタムの有無と指紋を入れる（0009 の7）。名前空間は製品名・社名を含まない。
//!
//! - 宛名は保存しない（0012・0009 の3）。出力するときだけ、表紙の部品が宣言した宛名欄の位置に、帳票を組んだ後に重ねる
//!   （`render_proposal_output`）。帳票の入力・内部情報（XMP）には入れない。
//! - 画面の中の見本は、PDF と同じ組版の結果をページごとに SVG（`render_page_svg`。拡大してもぼやけない）か PNG
//!   （`render_page_png`。縮小一覧）にしたもの。画面は PDF を直接表示できない（CSP の object-src・frame-src が none。0016 の1）。
//!
//! 金額の計算はしない（0005 の1）。帳票の入力の金額は、計算エンジンの出力から組み立てたもの（report/src/build.ts）。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use typst::diag::{FileError, FileResult, Severity, SourceDiagnostic};
use typst::foundations::{Bytes, Datetime, Duration, Label, Smart, Value};
use typst::introspection::{Introspector, MetadataElem};
use typst::layout::{Frame, FrameItem, Point};
use typst::model::Document;
use typst::syntax::package::{PackageSpec, PackageVersion};
use typst::syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook};
use typst::utils::{LazyHash, PicoStr};
use typst::{Library, LibraryExt, World};
use typst_layout::{Page, PagedDocument};
use typst_pdf::PdfOptions;

mod pdf;
pub use pdf::extract_text;

/// 組み込んだ Typst の版（控えの `report.typst` に写す。0009 の2）
pub const TYPST_VERSION: &str = "0.15.1";
/// 公式の帳票の部品（0009 の9）
pub const PACKAGE_NAMESPACE: &str = "lifeplan";
pub const PACKAGE_NAME: &str = "report-core";
pub const PACKAGE_VERSION: (u32, u32, u32) = (0, 1, 0);
/// 帳票の入力の形式と版（report/schema/proposal-input.schema.json）
pub const INPUT_FORMAT: &str = "lifeplan.proposalInput";
pub const INPUT_VERSION: &str = "0.1.0";
/// 内部情報（XMP）の名前空間（製品名・社名を含まない。0009 の7）
pub const XMP_NAMESPACE: &str = "urn:x-lifeplan:proposal:1";
/// 刻印の帯の高さ（pt）。帳票はこの帯の内側に描かない
pub const BAND_PT: f64 = 22.0;
/// 「β版・試算」の透かし
pub const WATERMARK: &str = "β版・試算";
/// 宛名欄を宣言する内部の印（表紙の部品が置く）
const ADDRESSEE_LABEL: &str = "lifeplan-addressee";
/// 宛名の長さの上限（文字数）
pub const ADDRESSEE_MAX_CHARS: usize = 40;

/// 公式の帳票の部品のファイル（パッケージの中のパスと中身）
const PACKAGE_FILES: &[(&str, &str)] = &[
    (
        "typst.toml",
        include_str!("../../../report/typst/report-core/typst.toml"),
    ),
    (
        "lib.typ",
        include_str!("../../../report/typst/report-core/lib.typ"),
    ),
    (
        "parts/format.typ",
        include_str!("../../../report/typst/report-core/parts/format.typ"),
    ),
    (
        "parts/layout.typ",
        include_str!("../../../report/typst/report-core/parts/layout.typ"),
    ),
    (
        "pages/front.typ",
        include_str!("../../../report/typst/report-core/pages/front.typ"),
    ),
    (
        "pages/household.typ",
        include_str!("../../../report/typst/report-core/pages/household.typ"),
    ),
    (
        "pages/cashflow.typ",
        include_str!("../../../report/typst/report-core/pages/cashflow.typ"),
    ),
    (
        "pages/topics.typ",
        include_str!("../../../report/typst/report-core/pages/topics.typ"),
    ),
    (
        "pages/risk.typ",
        include_str!("../../../report/typst/report-core/pages/risk.typ"),
    ),
    (
        "pages/changes.typ",
        include_str!("../../../report/typst/report-core/pages/changes.typ"),
    ),
    (
        "pages/compare.typ",
        include_str!("../../../report/typst/report-core/pages/compare.typ"),
    ),
    (
        "pages/invest.typ",
        include_str!("../../../report/typst/report-core/pages/invest.typ"),
    ),
    (
        "pages/money3.typ",
        include_str!("../../../report/typst/report-core/pages/money3.typ"),
    ),
    (
        "pages/rental.typ",
        include_str!("../../../report/typst/report-core/pages/rental.typ"),
    ),
];

/// 同梱フォント（BIZ UDゴシック。SIL OFL 1.1。ライセンス文は report/fonts/OFL.txt）
const FONTS: &[(&str, &[u8])] = &[
    (
        "BIZUDGothic-Regular.ttf",
        include_bytes!("../../../report/fonts/BIZUDGothic-Regular.ttf"),
    ),
    (
        "BIZUDGothic-Bold.ttf",
        include_bytes!("../../../report/fonts/BIZUDGothic-Bold.ttf"),
    ),
];
/// 同梱フォントのライセンス文（配布物に同梱する）
pub const FONT_LICENSE: &str = include_str!("../../../report/fonts/OFL.txt");

/// 同梱の公式の拡張の、提案書の拡張の章（0114 の6）: 章の id・プロジェクトの中のパス・中身。
/// 束の reports/ の Typst は、関数 `ext-chapter(ext-data, data)` を出す。外枠の文書が読み込んで、公式の帳票の `proposal` に `ext` で渡す
/// （公式の帳票は、選ばれて材料〔帳票の入力の `extensions`〕のある章だけを呼ぶ）
pub const EXTENSION_CHAPTERS: &[(&str, &str, &str)] = &[(
    "ext.official.combinedBs",
    "/ext/official.combinedBs/reports/chapter.typ",
    include_str!("../../../sdk/examples/extensions/combined-bs/reports/chapter.typ"),
)];

/// アプリの外枠の文書（帳票と、同梱の拡張の章を読み込んで呼ぶだけ）
fn main_typ() -> &'static str {
    static MAIN: OnceLock<String> = OnceLock::new();
    MAIN.get_or_init(|| {
        let mut s = String::from("#import \"@lifeplan/report-core:0.1.0\": proposal\n");
        let mut ext = Vec::new();
        for (i, (id, path, _)) in EXTENSION_CHAPTERS.iter().enumerate() {
            s.push_str(&format!("#import \"{path}\": ext-chapter as ext-chapter-{i}\n"));
            ext.push(format!("\"{id}\": ext-chapter-{i}"));
        }
        s.push_str(&format!(
            "#proposal(json(\"/input.json\"), json(\"/frame.json\"), ext: ({}{}))\n",
            ext.join(", "),
            if ext.is_empty() { ":" } else { "," }
        ));
        s
    })
}

/// 刻印の帯と透かし（アプリが組む。ページごとの大きさと文字は /stamp.json から読む）
const STAMP_TYP: &str = r##"#let s = json("/stamp.json")
#set text(font: "BIZ UDGothic", size: 7pt, fill: rgb("#3e4c59"), lang: "ja")
#for (i, p) in s.pages.enumerate() {
  page(width: p.width * 1pt, height: p.height * 1pt, margin: 0pt, {
    if s.beta {
      place(center + horizon, rotate(-30deg, text(size: 54pt, weight: "bold", fill: rgb(160, 168, 180, 38), s.watermark)))
    }
    place(top + left, dy: (p.height - s.band) * 1pt, rect(width: 100%, height: s.band * 1pt, fill: white, stroke: none))
    place(top + left, dy: (p.height - s.band) * 1pt, box(width: 100%, height: s.band * 1pt, inset: (x: 16mm), align(horizon, grid(
      columns: (1fr, auto, 1fr),
      align(left, s.stamp),
      if s.beta { text(weight: "bold", s.watermark) } else { [] },
      align(right, str(i + 1) + " / " + str(s.pages.len())),
    ))))
  })
}
"##;

/// 宛名（出力するときだけ。宛名欄の位置に重ねる。文字は JSON の値として渡し、Typst の記法として読まない）
const ADDRESSEE_TYP: &str = r##"#let s = json("/addressee.json")
#set text(font: "BIZ UDGothic", lang: "ja", fill: rgb("#1f2933"))
#for (i, p) in s.pages.enumerate() {
  page(width: p.width * 1pt, height: p.height * 1pt, margin: 0pt, {
    if i + 1 == s.field.page {
      place(top + left, dx: s.field.x * 1pt, dy: s.field.y * 1pt,
        box(width: s.field.width * 1pt, height: s.field.height * 1pt, inset: (x: 2pt, bottom: 3pt),
          align(left + bottom, text(size: 16pt, s.name))))
    }
  })
}
"##;

/// 必須の記載が帳票に無いときにアプリが足す「注意書き」のページ（0009 の6）
const NOTICES_TYP: &str = r##"#let s = json("/notices.json")
#set text(font: "BIZ UDGothic", size: 9.5pt, lang: "ja")
#set page(paper: "a4", margin: (top: 20mm, x: 18mm, bottom: 18mm + s.band * 1pt))
#text(size: 15pt, weight: "bold", "注意書き")
#v(8pt)
#for n in s.notices { block(below: 6pt, "・" + n) }
"##;

/// 刻印（各ページのフッター。製品名・提供元の名前は入れない。0009 の5）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Stamp {
    /// 制度データの版（データの組の版を表す短い文字列。書式は未確定。0009 の未確定）
    pub data_set_label: String,
    /// 計算基準日（YYYY-MM。0003 の baseMonth）
    pub base_month: String,
}

impl Stamp {
    /// 刻印の文字列: `制度データ 2026.10-a ／ 計算基準日 2026-10`
    pub fn text(&self) -> String {
        format!(
            "制度データ {} ／ 計算基準日 {}",
            self.data_set_label, self.base_month
        )
    }
}

/// 印刷されない内部情報（XMP。0009 の7）。顧客の情報・世帯の内部 ID・FP のメモは入れない
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Internal {
    /// 控えの ID（控えを作るとき）
    pub snapshot_id: Option<String>,
    /// データの組の版（dataSet の id）
    pub data_set_id: Option<String>,
    /// カスタムの計算部品・帳票の指紋（使っていなければ空）
    #[serde(default)]
    pub custom_digests: Vec<String>,
}

/// アプリが帳票の外側で決めるもの（刻印・透かし・必須の記載・内部情報）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReportFrame {
    pub stamp: Stamp,
    /// β版の期間は「β版・試算」の透かしを付ける（0009 の5）
    pub beta: bool,
    /// 必須の記載（試算である旨・公的データの出典名・担当FPが設定している旨・該当する場合の制度の見直し前の計算である旨など）
    pub notices: Vec<String>,
    #[serde(default)]
    pub internal: Internal,
}

/// 宛名欄の位置（ページ番号は1から、座標は左上からの pt）。控えに記録し、再印刷で宛名を重ねるのに使う（0009 の3）
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct AddresseeField {
    pub page: u64,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// 控えの `report` 欄に写す情報（0009 の2）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReportInfo {
    pub packages: Vec<PackageRef>,
    pub typst: String,
    pub fonts: Vec<FontRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PackageRef {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FontRef {
    pub file: String,
    pub digest: String,
}

/// できた PDF と、控えに記録するもの
#[derive(Debug, Clone)]
pub struct Rendered {
    pub pdf: Vec<u8>,
    /// PDF にした組版の結果（刻印・透かし・宛名を重ねた後）。画面の中の見本に使う（`render_page_png`）
    pub layout: PagedDocument,
    pub pages: usize,
    pub addressee: Option<AddresseeField>,
    /// アプリが「注意書き」のページを足したか（帳票に必須の記載の欄が無かった）
    pub notices_page_added: bool,
    pub report: ReportInfo,
}

/// エラー（外に出してよい符号と、開発用の中身）
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReportError {
    /// 帳票の入力が JSON でない・形式や版が違う
    Input(String),
    /// 帳票の組版の失敗（Typst のエラー）
    Typst(Vec<String>),
    /// 帳票が同梱以外のフォントを指定した
    Font(Vec<String>),
    /// PDF への書き出しの失敗
    Pdf(String),
    /// 出力した PDF に刻印・必須の記載が見つからない（出力しない）
    Missing(Vec<String>),
}

impl ReportError {
    pub fn code(&self) -> &'static str {
        match self {
            ReportError::Input(_) => "E_REPORT_INPUT",
            ReportError::Typst(_) => "E_REPORT_TYPST",
            ReportError::Font(_) => "E_REPORT_FONT",
            ReportError::Pdf(_) => "E_REPORT_PDF",
            ReportError::Missing(_) => "E_REPORT_REQUIRED_MISSING",
        }
    }
}

impl std::fmt::Display for ReportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {:?}", self.code(), self)
    }
}

impl std::error::Error for ReportError {}

// ---- Typst の World（読めるものを限る）----

struct Fonts {
    book: LazyHash<FontBook>,
    fonts: Vec<Font>,
    refs: Vec<FontRef>,
}

fn fonts() -> &'static Fonts {
    static FONTS_CELL: OnceLock<Fonts> = OnceLock::new();
    FONTS_CELL.get_or_init(|| {
        let mut fonts = Vec::new();
        let mut refs = Vec::new();
        for (file, data) in FONTS {
            fonts.extend(Font::iter(Bytes::new(*data)));
            refs.push(FontRef {
                file: (*file).to_owned(),
                digest: format!("sha256:{:x}", Sha256::digest(data)),
            });
        }
        Fonts {
            book: LazyHash::new(FontBook::from_fonts(&fonts)),
            fonts,
            refs,
        }
    })
}

fn library() -> &'static LazyHash<Library> {
    static LIB: OnceLock<LazyHash<Library>> = OnceLock::new();
    LIB.get_or_init(|| LazyHash::new(Library::default()))
}

fn package_spec() -> PackageSpec {
    PackageSpec {
        namespace: PACKAGE_NAMESPACE.into(),
        name: PACKAGE_NAME.into(),
        version: PackageVersion {
            major: PACKAGE_VERSION.0,
            minor: PACKAGE_VERSION.1,
            patch: PACKAGE_VERSION.2,
        },
    }
}

fn file_id(root: VirtualRoot, path: &str) -> FileId {
    let vpath = VirtualPath::new(path).expect("固定のパス");
    RootedPath::new(root, vpath).intern()
}

struct ReportWorld {
    main: FileId,
    sources: HashMap<FileId, Source>,
    files: HashMap<FileId, Bytes>,
}

impl ReportWorld {
    /// main: 外枠の文書の中身。data: プロジェクトの直下に置く JSON（名前と中身）
    fn new(main: &str, data: &[(&str, String)], with_package: bool) -> ReportWorld {
        let mut sources = HashMap::new();
        let mut files = HashMap::new();
        let main_id = file_id(VirtualRoot::Project, "/main.typ");
        sources.insert(main_id, Source::new(main_id, main.to_owned()));
        if with_package {
            let spec = package_spec();
            for (path, text) in PACKAGE_FILES {
                let id = file_id(VirtualRoot::Package(spec.clone()), &format!("/{path}"));
                if path.ends_with(".typ") {
                    sources.insert(id, Source::new(id, (*text).to_owned()));
                } else {
                    files.insert(id, Bytes::from_string(*text));
                }
            }
        }
        if with_package {
            // 同梱の拡張の章（プロジェクトの直下の /ext/<束の id>/reports/。外枠の文書だけが読み込む）
            for (_, path, text) in EXTENSION_CHAPTERS {
                let id = file_id(VirtualRoot::Project, path);
                sources.insert(id, Source::new(id, (*text).to_owned()));
            }
        }
        for (name, json) in data {
            let id = file_id(VirtualRoot::Project, &format!("/{name}"));
            files.insert(id, Bytes::from_string(json.clone()));
        }
        ReportWorld {
            main: main_id,
            sources,
            files,
        }
    }

    fn not_found(id: FileId) -> FileError {
        FileError::NotFound(PathBuf::from(id.get().vpath().get_with_slash()))
    }
}

impl World for ReportWorld {
    fn library(&self) -> &LazyHash<Library> {
        library()
    }

    fn book(&self) -> &LazyHash<FontBook> {
        &fonts().book
    }

    fn main(&self) -> FileId {
        self.main
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        self.sources.get(&id).cloned().ok_or_else(|| {
            if self.files.contains_key(&id) {
                FileError::NotSource
            } else {
                Self::not_found(id)
            }
        })
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        if let Some(b) = self.files.get(&id) {
            return Ok(b.clone());
        }
        if let Some(s) = self.sources.get(&id) {
            return Ok(Bytes::from_string(s.text().to_owned()));
        }
        Err(Self::not_found(id))
    }

    fn font(&self, index: usize) -> Option<Font> {
        fonts().fonts.get(index).cloned()
    }

    /// 時計は渡さない（同じ入力から同じ PDF。datetime.today() はエラーになる）
    fn today(&self, _offset: Option<Duration>) -> Option<Datetime> {
        None
    }
}

fn messages(diags: &[SourceDiagnostic]) -> Vec<String> {
    diags.iter().map(|d| d.message.to_string()).collect()
}

/// 組版する。同梱以外のフォントの指定（unknown font family の警告）はエラーにする
fn compile(world: &ReportWorld) -> Result<PagedDocument, ReportError> {
    let warned = typst::compile::<PagedDocument>(world);
    let fonts: Vec<String> = warned
        .warnings
        .iter()
        .filter(|w| w.severity == Severity::Warning && w.message.contains("unknown font family"))
        .map(|w| w.message.to_string())
        .collect();
    let doc = warned
        .output
        .map_err(|errs| ReportError::Typst(messages(&errs)))?;
    if !fonts.is_empty() {
        return Err(ReportError::Font(fonts));
    }
    Ok(doc)
}

// ---- 組んだページの文字（必須の記載の確かめ）----

fn frame_text(frame: &Frame, out: &mut String) {
    for (_, item) in frame.items() {
        match item {
            FrameItem::Text(t) => out.push_str(&t.text),
            FrameItem::Group(g) => frame_text(&g.frame, out),
            _ => {}
        }
    }
}

/// 文字の比べ方（空白・改行を除いて比べる。PDF から抜き出した文字は改行の位置が変わるため）
pub fn normalize(s: &str) -> String {
    s.chars().filter(|c| !c.is_whitespace()).collect()
}

fn missing_notices(text: &str, notices: &[String]) -> Vec<String> {
    let t = normalize(text);
    notices
        .iter()
        .filter(|n| !t.contains(&normalize(n)))
        .cloned()
        .collect()
}

fn addressee(doc: &PagedDocument) -> Option<AddresseeField> {
    let label = Label::new(PicoStr::intern(ADDRESSEE_LABEL))?;
    let content = doc.introspector().query_label(label).ok()?;
    let meta = content.to_packed::<MetadataElem>()?;
    let Value::Dict(d) = &meta.value else {
        return None;
    };
    let num = |k: &str| -> Option<f64> {
        match d.get(k).ok()? {
            Value::Int(i) => Some(*i as f64),
            Value::Float(f) => Some(*f),
            _ => None,
        }
    };
    Some(AddresseeField {
        page: num("page")? as u64,
        x: num("x")?,
        y: num("y")?,
        width: num("width")?,
        height: num("height")?,
    })
}

/// 刻印の帯と透かしを、各ページの上に重ねる（帳票を組んだ後。帳票からは消せない）
fn overlay_stamp(doc: &PagedDocument, frame: &ReportFrame) -> Result<PagedDocument, ReportError> {
    let pages: Vec<serde_json::Value> = doc
        .pages()
        .iter()
        .map(|p| {
            let s = p.frame.size();
            serde_json::json!({ "width": s.x.to_pt(), "height": s.y.to_pt() })
        })
        .collect();
    let stamp = serde_json::json!({
        "pages": pages,
        "band": BAND_PT,
        "stamp": frame.stamp.text(),
        "beta": frame.beta,
        "watermark": WATERMARK,
    });
    let world = ReportWorld::new(STAMP_TYP, &[("stamp.json", stamp.to_string())], false);
    let overlay = compile(&world)?;
    if overlay.pages().len() != doc.pages().len() {
        return Err(ReportError::Typst(vec!["刻印のページ数が合わない".into()]));
    }
    let out: Vec<Page> = doc
        .pages()
        .iter()
        .zip(overlay.pages())
        .map(|(p, o)| {
            let mut page = p.clone();
            page.frame.push_frame(Point::zero(), o.frame.clone());
            page
        })
        .collect();
    Ok(PagedDocument::new(
        out.into_iter().collect(),
        doc.info().clone(),
    ))
}

/// 宛名を確かめる（空・長すぎる・制御文字は受けない）
fn check_addressee(name: &str) -> Result<String, ReportError> {
    let t = name.trim();
    if t.is_empty() {
        return Err(ReportError::Input("宛名が空".into()));
    }
    if t.chars().count() > ADDRESSEE_MAX_CHARS {
        return Err(ReportError::Input("宛名が長すぎる".into()));
    }
    if t.chars().any(char::is_control) {
        return Err(ReportError::Input("宛名に使えない文字".into()));
    }
    Ok(t.to_owned())
}

/// 宛名を、表紙の部品が宣言した宛名欄の位置に重ねる（帳票を組んだ後。0009 の3）
fn overlay_addressee(
    doc: &PagedDocument,
    field: &AddresseeField,
    name: &str,
) -> Result<PagedDocument, ReportError> {
    let pages: Vec<serde_json::Value> = doc
        .pages()
        .iter()
        .map(|p| {
            let s = p.frame.size();
            serde_json::json!({ "width": s.x.to_pt(), "height": s.y.to_pt() })
        })
        .collect();
    let data = serde_json::json!({ "pages": pages, "field": field, "name": name });
    let world = ReportWorld::new(
        ADDRESSEE_TYP,
        &[("addressee.json", data.to_string())],
        false,
    );
    let overlay = compile(&world)?;
    if overlay.pages().len() != doc.pages().len() {
        return Err(ReportError::Typst(vec!["宛名のページ数が合わない".into()]));
    }
    let out: Vec<Page> = doc
        .pages()
        .iter()
        .zip(overlay.pages())
        .map(|(p, o)| {
            let mut page = p.clone();
            page.frame.push_frame(Point::zero(), o.frame.clone());
            page
        })
        .collect();
    Ok(PagedDocument::new(
        out.into_iter().collect(),
        doc.info().clone(),
    ))
}

fn append_notices_page(
    doc: &PagedDocument,
    notices: &[String],
) -> Result<PagedDocument, ReportError> {
    let data = serde_json::json!({ "notices": notices, "band": BAND_PT });
    let world = ReportWorld::new(NOTICES_TYP, &[("notices.json", data.to_string())], false);
    let extra = compile(&world)?;
    let pages: Vec<Page> = doc
        .pages()
        .iter()
        .chain(extra.pages().iter())
        .cloned()
        .collect();
    Ok(PagedDocument::new(
        pages.into_iter().collect(),
        doc.info().clone(),
    ))
}

fn check_input(input_json: &str) -> Result<(), ReportError> {
    let v: serde_json::Value =
        serde_json::from_str(input_json).map_err(|e| ReportError::Input(e.to_string()))?;
    let format = v.get("format").and_then(|x| x.as_str());
    let version = v.get("version").and_then(|x| x.as_str());
    if format != Some(INPUT_FORMAT) || version != Some(INPUT_VERSION) {
        return Err(ReportError::Input(format!(
            "形式・版が違う: {format:?} {version:?}"
        )));
    }
    Ok(())
}

/// 帳票（外枠の文書の中身）を指定して PDF を作る。公式の帳票なら `render_proposal` を使う。
/// 独自帳票の試験と、刻印・必須の記載の守りの試験のために公開する
pub fn render_with_main(
    main_typ: &str,
    input_json: &str,
    frame: &ReportFrame,
) -> Result<Rendered, ReportError> {
    render_inner(main_typ, input_json, frame, None)
}

fn render_inner(
    main_typ: &str,
    input_json: &str,
    frame: &ReportFrame,
    addressee_name: Option<&str>,
) -> Result<Rendered, ReportError> {
    check_input(input_json)?;
    let addressee_name = addressee_name.map(check_addressee).transpose()?;
    let frame_json = serde_json::json!({ "band": BAND_PT, "notices": frame.notices }).to_string();
    let world = ReportWorld::new(
        main_typ,
        &[
            ("input.json", input_json.to_owned()),
            ("frame.json", frame_json),
        ],
        true,
    );
    let mut doc = compile(&world)?;
    let addressee = addressee(&doc);

    // 必須の記載が帳票に無ければ、アプリが「注意書き」のページを足す
    let mut laid = String::new();
    for p in doc.pages() {
        frame_text(&p.frame, &mut laid);
    }
    let notices_page_added = !missing_notices(&laid, &frame.notices).is_empty();
    if notices_page_added {
        doc = append_notices_page(&doc, &frame.notices)?;
    }
    let mut doc = overlay_stamp(&doc, frame)?;
    // 宛名は出力の PDF にだけ重ねる（帳票の入力・内部情報・控えには入れない）
    if let Some(name) = &addressee_name {
        let Some(field) = &addressee else {
            return Err(ReportError::Input("帳票に宛名欄が無い".into()));
        };
        doc = overlay_addressee(&doc, field, name)?;
    }

    let options = PdfOptions {
        ident: match &frame.internal.snapshot_id {
            Some(id) => Smart::Custom(id.clone()),
            None => Smart::Auto,
        },
        // 作成ソフトの欄は空にする（0009 の7）
        creator: Smart::Custom(None),
        timestamp: None,
        ..PdfOptions::default()
    };
    let pdf =
        typst_pdf::pdf(&doc, &options).map_err(|e| ReportError::Pdf(messages(&e).join("; ")))?;
    let pdf =
        pdf::add_internal_xmp(&pdf, &frame.stamp, &frame.internal).map_err(ReportError::Pdf)?;

    // 出力の後の確かめ: 各ページに刻印、どこかのページに必須の記載
    let pages = extract_text(&pdf).map_err(ReportError::Pdf)?;
    let stamp = normalize(&frame.stamp.text());
    let mut problems: Vec<String> = pages
        .iter()
        .enumerate()
        .filter(|(_, t)| !normalize(t).contains(&stamp))
        .map(|(i, _)| format!("刻印が無いページ: {}", i + 1))
        .collect();
    problems.extend(
        missing_notices(&pages.join("\n"), &frame.notices)
            .into_iter()
            .map(|n| format!("必須の記載が無い: {n}")),
    );
    if !problems.is_empty() {
        return Err(ReportError::Missing(problems));
    }

    Ok(Rendered {
        pages: pages.len(),
        pdf,
        layout: doc,
        addressee,
        notices_page_added,
        report: report_info(),
    })
}

/// 帳票の入力（JSON の文字列）から、公式の帳票で提案書の PDF を作る（アプリの本体から呼ぶ呼び出し口）。
/// できた PDF は平文なので、ファイルに書くのは平文の書き出しの出口（0020 の5）を通す
pub fn render_proposal(input_json: &str, frame: &ReportFrame) -> Result<Rendered, ReportError> {
    render_with_main(main_typ(), input_json, frame)
}

/// 出力用: 公式の帳票で PDF を作り、宛名（あれば）を宛名欄に重ねる。宛名は保存しない（呼ぶ側も残さない。0009 の3・0012）。
/// 控えの PDF（宛名なし）は `render_proposal` で作る
pub fn render_proposal_output(
    input_json: &str,
    frame: &ReportFrame,
    addressee: Option<&str>,
) -> Result<Rendered, ReportError> {
    render_inner(main_typ(), input_json, frame, addressee)
}

/// 画面の中の見本: 組版の結果の1ページ（0 から）を PNG にする。pixel_per_pt は 1pt あたりの画素（0.5〜4）
pub fn render_page_png(rendered: &Rendered, page: usize, pixel_per_pt: f64) -> Option<Vec<u8>> {
    let p = rendered.layout.pages().get(page)?;
    let opts = typst_render::RenderOptions {
        pixel_per_pt: typst::utils::Scalar::new(pixel_per_pt.clamp(0.5, 4.0)),
        render_bleed: false,
    };
    typst_render::render(p, &opts).encode_png().ok()
}

/// 画面の中の見本: 組版の結果の1ページ（0 から）を SVG にする。文字はフォントの輪郭の図形（`<path>`・`<use>`）になり、
/// 文字列・スクリプト・外部の参照は入らない（帳票に画像は無い。リンクは同じ文書の中の位置だけで、外への URL は出さない）
pub fn render_page_svg(rendered: &Rendered, page: usize) -> Option<String> {
    let p = rendered.layout.pages().get(page)?;
    let opts = typst_svg::SvgOptions {
        render_bleed: false,
        pretty: false,
    };
    Some(typst_svg::svg(p, &opts))
}

/// 控えの `report` 欄（使った帳票の部品・Typst の版・フォントの指紋）
pub fn report_info() -> ReportInfo {
    ReportInfo {
        packages: vec![PackageRef {
            name: format!("@{PACKAGE_NAMESPACE}/{PACKAGE_NAME}"),
            version: format!(
                "{}.{}.{}",
                PACKAGE_VERSION.0, PACKAGE_VERSION.1, PACKAGE_VERSION.2
            ),
        }],
        typst: TYPST_VERSION.to_owned(),
        fonts: fonts().refs.clone(),
    }
}
