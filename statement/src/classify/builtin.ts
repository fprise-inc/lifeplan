// アプリ同梱の最初の辞書（0034 の4 の (a)）。よくある全国チェーン・公共料金・通信会社・一般の言葉で、店の鍵（merchantKey）→項目。
// - 社名・店の名前は一般に知られた名前だけを使う（明細の実物は写さない）。言葉はそろえる前の自然な書き方で書き、読み込むときにそろえる
// - 一致の仕方: prefix（店の鍵がこの言葉で始まる。既定）・contains（どこかに含む）・exact
// - 印: cardPayment（銀行の明細のカード会社への引き落とし）・annual（年1回の候補）・engineTax（税・社会保険料のうち計算で出すもの＝除外）
import type { StatementCategory } from "./categories.ts";

export type BuiltinFlag = "cardPayment" | "annual" | "engineTax";
export type BuiltinEntry = readonly [pattern: string, category: StatementCategory, match?: "prefix" | "contains" | "exact", flags?: readonly BuiltinFlag[]];

/**
 * カード会社（銀行の明細の引き落としの名前で見分ける。0034 の6）。id は口座の issuer に入れる短い名前。
 * 名前は銀行の明細に出る形の例（漢字・カナ・英字）。明細の実物は写していない
 */
export const CARD_ISSUERS: readonly { readonly id: string; readonly label: string; readonly patterns: readonly string[] }[] = [
  { id: "smbc", label: "三井住友カード", patterns: ["三井住友カード", "ミツイスミトモカード", "SMBCカード"] },
  { id: "rakuten", label: "楽天カード", patterns: ["楽天カード", "ラクテンカード"] },
  { id: "jcb", label: "JCB", patterns: ["JCB", "ジェーシービー"] },
  { id: "saison", label: "クレディセゾン", patterns: ["クレディセゾン", "セゾン"] },
  { id: "aeon", label: "イオンカード", patterns: ["イオンクレジット", "イオンカード"] },
  { id: "uc", label: "UCカード", patterns: ["UCカード", "ユーシーカード"] },
  { id: "nicos", label: "三菱UFJニコス", patterns: ["三菱UFJニコス", "ニコス", "MUFGカード"] },
  { id: "orico", label: "オリコ", patterns: ["オリコ", "オリエントコーポレーション"] },
  { id: "epos", label: "エポスカード", patterns: ["エポス"] },
  { id: "view", label: "ビューカード", patterns: ["ビューカード"] },
  { id: "amex", label: "アメリカン・エキスプレス", patterns: ["アメリカンエキスプレス", "アメックス", "AMEX"] },
  { id: "diners", label: "ダイナースクラブ", patterns: ["ダイナース"] },
  { id: "pocket", label: "ポケットカード", patterns: ["ポケットカード"] },
  { id: "life", label: "ライフカード", patterns: ["ライフカード"] },
  { id: "jaccs", label: "ジャックス", patterns: ["ジャックス", "JACCS"] },
  { id: "aplus", label: "アプラス", patterns: ["アプラス"] },
  { id: "cedyna", label: "セディナ", patterns: ["セディナ"] },
  { id: "paypay", label: "PayPayカード", patterns: ["PAYPAYカード", "ペイペイカード"] },
  { id: "dcard", label: "dカード", patterns: ["Dカード", "ディーカード"] },
  { id: "aupay", label: "au PAY カード", patterns: ["AUペイカード", "AU PAYカード"] },
  { id: "mi", label: "エムアイカード", patterns: ["エムアイカード"] },
  { id: "toyota", label: "トヨタファイナンス", patterns: ["トヨタファイナンス"] },
];

/** どのカード会社か分からない引き落としの言葉（銀行の明細だけで見る） */
export const GENERIC_CARD_PAYMENT: readonly string[] = ["カード", "クレジット"];

/**
 * 辞書の版（中身を変えたら上げる。取り込みの記録の自動の仕分けの根拠に残す）。この辞書と、家計簿アプリの分類の言葉（dictionary.ts の
 * 大項目と中項目の組・大項目だけの言葉）と、項目から基本生活費の内訳への対応（categories.ts）を合わせた版。
 * 2: 基本生活費の新しい内訳（0100）への対応、家計簿アプリの書き出しの中項目を読む（0034 の 2026-10-31 の追記）
 */
export const BUILTIN_VERSION = 2;

export const BUILTIN: readonly BuiltinEntry[] = [
  // 食費（スーパー・コンビニ・外食・宅配）
  ["セブン-イレブン", "food"], ["セブンイレブン", "food"], ["SEVEN-ELEVEN", "food"], ["7-ELEVEN", "food"], ["ファミリーマート", "food"], ["FAMILYMART", "food"], ["ローソン", "food"], ["LAWSON", "food"], ["ミニストップ", "food"], ["デイリーヤマザキ", "food"], ["セイコーマート", "food"], ["ニューデイズ", "food"], ["NEWDAYS", "food"],
  ["イオン", "food"], ["AEON", "food"], ["マックスバリュ", "food"], ["イトーヨーカドー", "food"], ["ヨーカドー", "food"], ["西友", "food"], ["SEIYU", "food"], ["ライフ", "food", "exact"], ["サミット", "food"], ["マルエツ", "food"], ["いなげや", "food"], ["ヤオコー", "food"], ["オーケー", "food", "exact"], ["業務スーパー", "food"], ["コープ", "food"], ["生協", "food"], ["COOP", "food"], ["成城石井", "food"], ["まいばすけっと", "food"], ["ベルク", "food"], ["カスミ", "food"], ["平和堂", "food"], ["イズミ", "food"], ["ゆめタウン", "food"], ["コストコ", "food"], ["COSTCO", "food"],
  ["スーパー", "food", "contains"], ["マート", "food", "contains"], ["食品", "food", "contains"], ["青果", "food", "contains"], ["精肉", "food", "contains"], ["鮮魚", "food", "contains"], ["ベーカリー", "food", "contains"], ["パン", "food", "exact"],
  ["マクドナルド", "food"], ["MCDONALD", "food"], ["モスバーガー", "food"], ["ケンタッキー", "food"], ["スターバックス", "food"], ["STARBUCKS", "food"], ["ドトール", "food"], ["タリーズ", "food"], ["コメダ", "food"], ["すき家", "food"], ["吉野家", "food"], ["松屋", "food"], ["なか卯", "food"], ["ガスト", "food"], ["サイゼリヤ", "food"], ["デニーズ", "food"], ["ジョナサン", "food"], ["ココス", "food"], ["バーミヤン", "food"], ["丸亀製麺", "food"], ["はなまるうどん", "food"], ["スシロー", "food"], ["くら寿司", "food"], ["はま寿司", "food"], ["かっぱ寿司", "food"], ["ミスタードーナツ", "food"], ["日高屋", "food"], ["大戸屋", "food"], ["CoCo壱番屋", "food"], ["ココイチ", "food"], ["餃子の王将", "food"], ["ほっともっと", "food"], ["オリジン弁当", "food"],
  ["ウーバーイーツ", "food"], ["UBER EATS", "food"], ["UBEREATS", "food"], ["出前館", "food"],
  ["レストラン", "food", "contains"], ["食堂", "food", "contains"], ["カフェ", "food", "contains"], ["CAFE", "food", "contains"], ["弁当", "food", "contains"], ["寿司", "food", "contains"], ["ラーメン", "food", "contains"], ["居酒屋", "social", "contains"],
  // 日用品（ドラッグストア・100円ショップ・ホームセンター）
  ["マツモトキヨシ", "dailyGoods"], ["マツキヨ", "dailyGoods"], ["ウエルシア", "dailyGoods"], ["スギ薬局", "dailyGoods"], ["ツルハ", "dailyGoods"], ["サンドラッグ", "dailyGoods"], ["ココカラファイン", "dailyGoods"], ["コスモス薬品", "dailyGoods"], ["ドラッグコスモス", "dailyGoods"], ["クリエイト", "dailyGoods"], ["カワチ薬品", "dailyGoods"], ["ドラッグ", "dailyGoods", "contains"],
  ["ダイソー", "dailyGoods"], ["DAISO", "dailyGoods"], ["セリア", "dailyGoods"], ["キャンドゥ", "dailyGoods"], ["カインズ", "dailyGoods"], ["コーナン", "dailyGoods"], ["DCM", "dailyGoods"], ["コメリ", "dailyGoods"], ["ビバホーム", "dailyGoods"], ["ロフト", "dailyGoods"], ["東急ハンズ", "dailyGoods"], ["ハンズ", "dailyGoods", "exact"], ["ホームセンター", "dailyGoods", "contains"],
  // 家具・家電
  ["ニトリ", "furniture"], ["イケア", "furniture"], ["IKEA", "furniture"], ["無印良品", "furniture"], ["ヤマダデンキ", "furniture"], ["ヤマダ電機", "furniture"], ["ビックカメラ", "furniture"], ["ヨドバシ", "furniture"], ["ケーズデンキ", "furniture"], ["エディオン", "furniture"], ["ジョーシン", "furniture"], ["ノジマ", "furniture"], ["コジマ", "furniture"],
  // 被服・美容
  ["ユニクロ", "clothing"], ["UNIQLO", "clothing"], ["ジーユー", "clothing"], ["GU", "clothing", "exact"], ["しまむら", "clothing"], ["ワークマン", "clothing"], ["ZARA", "clothing"], ["H&M", "clothing"], ["ABCマート", "clothing"], ["美容室", "clothing", "contains"], ["ヘアサロン", "clothing", "contains"], ["理容", "clothing", "contains"], ["クリーニング", "clothing", "contains"],
  // 水道・光熱
  ["東京電力", "utilities"], ["関西電力", "utilities"], ["中部電力", "utilities"], ["東北電力", "utilities"], ["九州電力", "utilities"], ["北海道電力", "utilities"], ["中国電力", "utilities"], ["四国電力", "utilities"], ["北陸電力", "utilities"], ["沖縄電力", "utilities"], ["電力", "utilities", "contains"], ["電気料金", "utilities", "contains"],
  ["東京ガス", "utilities"], ["大阪ガス", "utilities"], ["東邦ガス", "utilities"], ["西部ガス", "utilities"], ["ガス料金", "utilities", "contains"], ["ガス", "utilities", "exact"], ["水道", "utilities", "contains"], ["下水道", "utilities", "contains"],
  // 通信
  ["NTTドコモ", "communication"], ["ドコモ", "communication"], ["DOCOMO", "communication"], ["KDDI", "communication"], ["AU", "communication", "exact"], ["ソフトバンク", "communication"], ["SOFTBANK", "communication"], ["ワイモバイル", "communication"], ["Y!MOBILE", "communication"], ["楽天モバイル", "communication"], ["UQモバイル", "communication"], ["UQ", "communication", "exact"], ["IIJ", "communication"], ["マイネオ", "communication"], ["MINEO", "communication"], ["ahamo", "communication"], ["povo", "communication"], ["LINEMO", "communication"], ["NTT東日本", "communication"], ["NTT西日本", "communication"], ["フレッツ", "communication"], ["NURO", "communication"], ["ジェイコム", "communication"], ["J:COM", "communication"], ["JCOM", "communication"], ["光回線", "communication", "contains"], ["プロバイダ", "communication", "contains"], ["携帯", "communication", "contains"], ["通信料", "communication", "contains"], ["電話料", "communication", "contains"],
  // 交通
  ["JR東日本", "transport"], ["JR西日本", "transport"], ["JR東海", "transport"], ["JR九州", "transport"], ["JR北海道", "transport"], ["JR四国", "transport"], ["JR", "transport", "exact"], ["東京メトロ", "transport"], ["都営", "transport"], ["ANA", "lumpSum", "exact"], ["JAL", "lumpSum", "exact"], ["日本航空", "lumpSum"], ["全日空", "lumpSum"], ["タクシー", "transport", "contains"], ["TAXI", "transport", "contains"], ["GO", "transport", "exact"], ["バス", "transport", "contains"], ["鉄道", "transport", "contains"], ["電鉄", "transport", "contains"], ["定期券", "transport", "contains"], ["SUICAチャージ", "transport"], ["モバイルSUICA", "transport"], ["PASMOチャージ", "transport"], ["きっぷ", "transport", "contains"], ["乗車券", "transport", "contains"], ["新幹線", "transport", "contains"],
  // 車
  ["ENEOS", "car"], ["エネオス", "car"], ["出光", "car"], ["IDEMITSU", "car"], ["アポロステーション", "car"], ["コスモ石油", "car"], ["シェル", "car", "exact"], ["ガソリン", "car", "contains"], ["石油", "car", "contains"], ["駐車場", "car", "contains"], ["パーキング", "car", "contains"], ["PARKING", "car", "contains"], ["タイムズ", "car"], ["TIMES", "car"], ["三井のリパーク", "car"], ["NEXCO", "car"], ["ETC", "car"], ["高速道路", "car", "contains"], ["オートバックス", "car"], ["イエローハット", "car"], ["車検", "car", "contains", ["annual"]], ["自動車税", "car", "contains", ["annual"]], ["軽自動車税", "car", "contains", ["annual"]], ["自動車保険", "insurance", "contains", ["annual"]],
  // 医療
  ["病院", "medical", "contains"], ["医院", "medical", "contains"], ["クリニック", "medical", "contains"], ["CLINIC", "medical", "contains"], ["歯科", "medical", "contains"], ["眼科", "medical", "contains"], ["皮膚科", "medical", "contains"], ["小児科", "medical", "contains"], ["内科", "medical", "contains"], ["整形外科", "medical", "contains"], ["調剤", "medical", "contains"], ["薬局", "medical", "contains"], ["整骨院", "medical", "contains"], ["接骨院", "medical", "contains"], ["メガネ", "medical", "contains"], ["コンタクト", "medical", "contains"],
  // 教養娯楽（書籍・定額の配信・レジャー）
  ["NETFLIX", "recreation"], ["ネットフリックス", "recreation"], ["SPOTIFY", "recreation"], ["スポティファイ", "recreation"], ["DISNEY+", "recreation"], ["DAZN", "recreation"], ["U-NEXT", "recreation"], ["HULU", "recreation"], ["YOUTUBE", "recreation"], ["ニンテンドー", "recreation"], ["NINTENDO", "recreation"], ["プレイステーション", "recreation"], ["PLAYSTATION", "recreation"], ["蔦屋", "recreation"], ["TSUTAYA", "recreation"], ["紀伊國屋書店", "recreation"], ["紀伊国屋書店", "recreation"], ["ブックオフ", "recreation"], ["書店", "recreation", "contains"], ["映画", "recreation", "contains"], ["シネマ", "recreation", "contains"], ["カラオケ", "recreation", "contains"], ["スポーツクラブ", "recreation", "contains"], ["ジム", "recreation", "contains"], ["フィットネス", "recreation", "contains"], ["NHK", "recreation", "prefix"], ["放送受信料", "recreation", "contains"], ["新聞", "recreation", "contains"],
  // 一時的な支出（旅行・宿泊）
  ["ホテル", "lumpSum", "contains"], ["HOTEL", "lumpSum", "contains"], ["旅館", "lumpSum", "contains"], ["旅行", "lumpSum", "contains"], ["トラベル", "lumpSum", "contains"], ["TRAVEL", "lumpSum", "contains"], ["航空", "lumpSum", "contains"], ["エアライン", "lumpSum", "contains"], ["結婚式", "lumpSum", "contains"], ["葬儀", "lumpSum", "contains"], ["引越", "lumpSum", "contains"],
  // カードの年会費
  ["年会費", "cardFee", "contains", ["annual"]],
  // 住居関連
  ["家賃", "housing", "contains"], ["賃料", "housing", "contains"], ["管理費", "housing", "contains"], ["共益費", "housing", "contains"], ["修繕積立", "housing", "contains"], ["固定資産税", "housing", "contains", ["annual"]], ["都市計画税", "housing", "contains", ["annual"]], ["火災保険", "insurance", "contains", ["annual"]], ["地震保険", "insurance", "contains", ["annual"]], ["住宅ローン", "housing", "contains"], ["不動産", "housing", "contains"],
  // 教育
  ["学習塾", "education", "contains"], ["塾", "education", "exact"], ["幼稚園", "education", "contains"], ["保育園", "education", "contains"], ["保育料", "education", "contains"], ["学校", "education", "contains"], ["学園", "education", "contains"], ["大学", "education", "contains"], ["給食費", "education", "contains"], ["授業料", "education", "contains"], ["教材", "education", "contains"], ["公文", "education"], ["くもん", "education"], ["ベネッセ", "education"], ["進研ゼミ", "education"], ["スイミング", "education", "contains"], ["ピアノ教室", "education", "contains"], ["英会話", "education", "contains"],
  // 保険
  ["生命保険", "insurance", "contains"], ["生命", "insurance", "contains"], ["損害保険", "insurance", "contains"], ["損保", "insurance", "contains"], ["共済", "insurance", "contains"], ["保険料", "insurance", "contains"], ["かんぽ", "insurance"], ["県民共済", "insurance"], ["都民共済", "insurance"],
  // 税・社会保険料（所得税・住民税・社会保険料は計算で出すので除外。固定資産税・自動車税は上で住居・車へ）
  ["住民税", "tax", "contains", ["engineTax"]], ["市民税", "tax", "contains", ["engineTax"]], ["県民税", "tax", "contains", ["engineTax"]], ["都民税", "tax", "contains", ["engineTax"]], ["所得税", "tax", "contains", ["engineTax"]], ["国民年金", "tax", "contains", ["engineTax"]], ["国民健康保険", "tax", "contains", ["engineTax"]], ["国保", "tax", "contains", ["engineTax"]], ["介護保険料", "tax", "contains", ["engineTax"]], ["後期高齢者医療", "tax", "contains", ["engineTax"]], ["国税", "tax", "contains", ["engineTax"]], ["税務署", "tax", "contains", ["engineTax"]], ["ふるさと納税", "social", "contains"],
  // 現金・振替・収入
  ["ATM", "cash", "contains"], ["現金引出", "cash", "contains"], ["カード引出", "cash", "contains"], ["引出", "cash", "exact"], ["セブン銀行", "cash"], ["イーネット", "cash"], ["ゆうちょATM", "cash"],
  ["給与", "income", "contains"], ["給料", "income", "contains"], ["賞与", "income", "contains"], ["利息", "income", "contains"], ["配当", "income", "contains"], ["年金", "income", "exact"], ["児童手当", "income", "contains"],
  ["振替", "transfer", "prefix"], ["定期預金", "transfer", "contains"], ["積立", "transfer", "contains"], ["証券", "transfer", "contains"], ["チャージ", "cash", "contains"],
];
