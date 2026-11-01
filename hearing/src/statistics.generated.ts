// 自動生成（hearing/scripts/statistics.ts。npm run statistics）。手で書き換えない。
// 正本は data/master（wageStats・retirementBenefit・living.statistics・education.statistics・care.statistics・lifeTable）と data/regulation の YAML（0007）。推定の目安の数の写し
import type { DatedValue, MasterValue } from "./statistics.ts";

export const MASTER_VALUES: Readonly<Record<string, MasterValue>> = {
 "wageStats.annualBonus.nonRegular.female": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年間賞与その他特別給与額（正社員・正職員以外・女・年齢計・企業規模計。民営事業所）",
  "value": 170400,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.annualBonus.nonRegular.male": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年間賞与その他特別給与額（正社員・正職員以外・男・年齢計・企業規模計。民営事業所）",
  "value": 350100,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.annualBonus.regular.female": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年間賞与その他特別給与額（正社員・正職員・女・年齢計・企業規模計。民営事業所）",
  "value": 867900,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.annualBonus.regular.male": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年間賞与その他特別給与額（正社員・正職員・男・年齢計・企業規模計。民営事業所）",
  "value": 1297900,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.business.operatingProfit": {
  "title": "個人企業経済調査（総務省）2025年調査 1企業当たりの年間営業利益（2024年の実績・産業計）",
  "value": 2180000,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.annualBonus.nonRegular.female.all": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別の年間賞与その他特別給与額（正社員・正職員以外・女・企業規模計（10人以上）。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 10400
   },
   {
    "upTo": 24,
    "amount": 60900
   },
   {
    "upTo": 29,
    "amount": 90000
   },
   {
    "upTo": 34,
    "amount": 121700
   },
   {
    "upTo": 39,
    "amount": 133500
   },
   {
    "upTo": 44,
    "amount": 165800
   },
   {
    "upTo": 49,
    "amount": 173400
   },
   {
    "upTo": 54,
    "amount": 163800
   },
   {
    "upTo": 59,
    "amount": 156700
   },
   {
    "upTo": 64,
    "amount": 315200
   },
   {
    "upTo": 69,
    "amount": 181800
   },
   {
    "upTo": null,
    "amount": 100400
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.annualBonus.nonRegular.female.large": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別の年間賞与その他特別給与額（正社員・正職員以外・女・1,000人以上。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 8100
   },
   {
    "upTo": 24,
    "amount": 51000
   },
   {
    "upTo": 29,
    "amount": 78300
   },
   {
    "upTo": 34,
    "amount": 110200
   },
   {
    "upTo": 39,
    "amount": 114900
   },
   {
    "upTo": 44,
    "amount": 158500
   },
   {
    "upTo": 49,
    "amount": 155400
   },
   {
    "upTo": 54,
    "amount": 165000
   },
   {
    "upTo": 59,
    "amount": 137600
   },
   {
    "upTo": 64,
    "amount": 294700
   },
   {
    "upTo": 69,
    "amount": 127300
   },
   {
    "upTo": null,
    "amount": 61600
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.annualBonus.nonRegular.female.medium": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別の年間賞与その他特別給与額（正社員・正職員以外・女・100～999人。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 14100
   },
   {
    "upTo": 24,
    "amount": 55200
   },
   {
    "upTo": 29,
    "amount": 94400
   },
   {
    "upTo": 34,
    "amount": 116700
   },
   {
    "upTo": 39,
    "amount": 138300
   },
   {
    "upTo": 44,
    "amount": 161300
   },
   {
    "upTo": 49,
    "amount": 172000
   },
   {
    "upTo": 54,
    "amount": 149300
   },
   {
    "upTo": 59,
    "amount": 175300
   },
   {
    "upTo": 64,
    "amount": 338400
   },
   {
    "upTo": 69,
    "amount": 190500
   },
   {
    "upTo": null,
    "amount": 121200
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.annualBonus.nonRegular.female.small": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別の年間賞与その他特別給与額（正社員・正職員以外・女・10～99人。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 7500
   },
   {
    "upTo": 24,
    "amount": 85200
   },
   {
    "upTo": 29,
    "amount": 109600
   },
   {
    "upTo": 34,
    "amount": 157100
   },
   {
    "upTo": 39,
    "amount": 163000
   },
   {
    "upTo": 44,
    "amount": 188900
   },
   {
    "upTo": 49,
    "amount": 214600
   },
   {
    "upTo": 54,
    "amount": 186900
   },
   {
    "upTo": 59,
    "amount": 169700
   },
   {
    "upTo": 64,
    "amount": 305900
   },
   {
    "upTo": 69,
    "amount": 232600
   },
   {
    "upTo": null,
    "amount": 101200
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.annualBonus.nonRegular.male.all": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別の年間賞与その他特別給与額（正社員・正職員以外・男・企業規模計（10人以上）。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 21900
   },
   {
    "upTo": 24,
    "amount": 53400
   },
   {
    "upTo": 29,
    "amount": 94500
   },
   {
    "upTo": 34,
    "amount": 123000
   },
   {
    "upTo": 39,
    "amount": 121600
   },
   {
    "upTo": 44,
    "amount": 124500
   },
   {
    "upTo": 49,
    "amount": 162300
   },
   {
    "upTo": 54,
    "amount": 140200
   },
   {
    "upTo": 59,
    "amount": 167500
   },
   {
    "upTo": 64,
    "amount": 792900
   },
   {
    "upTo": 69,
    "amount": 344400
   },
   {
    "upTo": null,
    "amount": 161600
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.annualBonus.nonRegular.male.large": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別の年間賞与その他特別給与額（正社員・正職員以外・男・1,000人以上。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 14500
   },
   {
    "upTo": 24,
    "amount": 66800
   },
   {
    "upTo": 29,
    "amount": 112500
   },
   {
    "upTo": 34,
    "amount": 126400
   },
   {
    "upTo": 39,
    "amount": 140800
   },
   {
    "upTo": 44,
    "amount": 132300
   },
   {
    "upTo": 49,
    "amount": 211500
   },
   {
    "upTo": 54,
    "amount": 156100
   },
   {
    "upTo": 59,
    "amount": 231700
   },
   {
    "upTo": 64,
    "amount": 1005500
   },
   {
    "upTo": 69,
    "amount": 404000
   },
   {
    "upTo": null,
    "amount": 178400
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.annualBonus.nonRegular.male.medium": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別の年間賞与その他特別給与額（正社員・正職員以外・男・100～999人。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 27900
   },
   {
    "upTo": 24,
    "amount": 47200
   },
   {
    "upTo": 29,
    "amount": 92500
   },
   {
    "upTo": 34,
    "amount": 123700
   },
   {
    "upTo": 39,
    "amount": 106400
   },
   {
    "upTo": 44,
    "amount": 121600
   },
   {
    "upTo": 49,
    "amount": 131100
   },
   {
    "upTo": 54,
    "amount": 140500
   },
   {
    "upTo": 59,
    "amount": 136300
   },
   {
    "upTo": 64,
    "amount": 717700
   },
   {
    "upTo": 69,
    "amount": 324800
   },
   {
    "upTo": null,
    "amount": 140400
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.annualBonus.nonRegular.male.small": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別の年間賞与その他特別給与額（正社員・正職員以外・男・10～99人。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 19300
   },
   {
    "upTo": 24,
    "amount": 43600
   },
   {
    "upTo": 29,
    "amount": 62200
   },
   {
    "upTo": 34,
    "amount": 111500
   },
   {
    "upTo": 39,
    "amount": 113900
   },
   {
    "upTo": 44,
    "amount": 110900
   },
   {
    "upTo": 49,
    "amount": 115800
   },
   {
    "upTo": 54,
    "amount": 107000
   },
   {
    "upTo": 59,
    "amount": 114800
   },
   {
    "upTo": 64,
    "amount": 475000
   },
   {
    "upTo": 69,
    "amount": 307400
   },
   {
    "upTo": null,
    "amount": 181600
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.annualBonus.regular.female.all": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別の年間賞与その他特別給与額（正社員・正職員・女・企業規模計（10人以上）。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 137800
   },
   {
    "upTo": 24,
    "amount": 413000
   },
   {
    "upTo": 29,
    "amount": 722800
   },
   {
    "upTo": 34,
    "amount": 800400
   },
   {
    "upTo": 39,
    "amount": 879800
   },
   {
    "upTo": 44,
    "amount": 968800
   },
   {
    "upTo": 49,
    "amount": 996400
   },
   {
    "upTo": 54,
    "amount": 1098300
   },
   {
    "upTo": 59,
    "amount": 1120300
   },
   {
    "upTo": 64,
    "amount": 857900
   },
   {
    "upTo": 69,
    "amount": 559700
   },
   {
    "upTo": null,
    "amount": 520300
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.annualBonus.regular.female.large": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別の年間賞与その他特別給与額（正社員・正職員・女・1,000人以上。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 167500
   },
   {
    "upTo": 24,
    "amount": 465300
   },
   {
    "upTo": 29,
    "amount": 913800
   },
   {
    "upTo": 34,
    "amount": 1042400
   },
   {
    "upTo": 39,
    "amount": 1190900
   },
   {
    "upTo": 44,
    "amount": 1332300
   },
   {
    "upTo": 49,
    "amount": 1383700
   },
   {
    "upTo": 54,
    "amount": 1573300
   },
   {
    "upTo": 59,
    "amount": 1680900
   },
   {
    "upTo": 64,
    "amount": 1271400
   },
   {
    "upTo": 69,
    "amount": 835300
   },
   {
    "upTo": null,
    "amount": 790600
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.annualBonus.regular.female.medium": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別の年間賞与その他特別給与額（正社員・正職員・女・100～999人。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 126500
   },
   {
    "upTo": 24,
    "amount": 401000
   },
   {
    "upTo": 29,
    "amount": 673900
   },
   {
    "upTo": 34,
    "amount": 738500
   },
   {
    "upTo": 39,
    "amount": 819300
   },
   {
    "upTo": 44,
    "amount": 915100
   },
   {
    "upTo": 49,
    "amount": 965700
   },
   {
    "upTo": 54,
    "amount": 1059000
   },
   {
    "upTo": 59,
    "amount": 1014900
   },
   {
    "upTo": 64,
    "amount": 829700
   },
   {
    "upTo": 69,
    "amount": 529800
   },
   {
    "upTo": null,
    "amount": 438100
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.annualBonus.regular.female.small": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別の年間賞与その他特別給与額（正社員・正職員・女・10～99人。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 118100
   },
   {
    "upTo": 24,
    "amount": 349900
   },
   {
    "upTo": 29,
    "amount": 531300
   },
   {
    "upTo": 34,
    "amount": 598600
   },
   {
    "upTo": 39,
    "amount": 614100
   },
   {
    "upTo": 44,
    "amount": 673400
   },
   {
    "upTo": 49,
    "amount": 686000
   },
   {
    "upTo": 54,
    "amount": 732700
   },
   {
    "upTo": 59,
    "amount": 731200
   },
   {
    "upTo": 64,
    "amount": 615200
   },
   {
    "upTo": 69,
    "amount": 483200
   },
   {
    "upTo": null,
    "amount": 469300
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.annualBonus.regular.male.all": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別の年間賞与その他特別給与額（正社員・正職員・男・企業規模計（10人以上）。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 180000
   },
   {
    "upTo": 24,
    "amount": 491300
   },
   {
    "upTo": 29,
    "amount": 851300
   },
   {
    "upTo": 34,
    "amount": 1084400
   },
   {
    "upTo": 39,
    "amount": 1273000
   },
   {
    "upTo": 44,
    "amount": 1427600
   },
   {
    "upTo": 49,
    "amount": 1531000
   },
   {
    "upTo": 54,
    "amount": 1672800
   },
   {
    "upTo": 59,
    "amount": 1706700
   },
   {
    "upTo": 64,
    "amount": 1127000
   },
   {
    "upTo": 69,
    "amount": 559600
   },
   {
    "upTo": null,
    "amount": 360900
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.annualBonus.regular.male.large": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別の年間賞与その他特別給与額（正社員・正職員・男・1,000人以上。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 237600
   },
   {
    "upTo": 24,
    "amount": 592600
   },
   {
    "upTo": 29,
    "amount": 1083400
   },
   {
    "upTo": 34,
    "amount": 1427700
   },
   {
    "upTo": 39,
    "amount": 1724400
   },
   {
    "upTo": 44,
    "amount": 2076900
   },
   {
    "upTo": 49,
    "amount": 2249600
   },
   {
    "upTo": 54,
    "amount": 2505100
   },
   {
    "upTo": 59,
    "amount": 2607600
   },
   {
    "upTo": 64,
    "amount": 1900200
   },
   {
    "upTo": 69,
    "amount": 1197600
   },
   {
    "upTo": null,
    "amount": 736800
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.annualBonus.regular.male.medium": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別の年間賞与その他特別給与額（正社員・正職員・男・100～999人。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 158000
   },
   {
    "upTo": 24,
    "amount": 492500
   },
   {
    "upTo": 29,
    "amount": 811200
   },
   {
    "upTo": 34,
    "amount": 1045300
   },
   {
    "upTo": 39,
    "amount": 1172500
   },
   {
    "upTo": 44,
    "amount": 1268500
   },
   {
    "upTo": 49,
    "amount": 1400600
   },
   {
    "upTo": 54,
    "amount": 1519500
   },
   {
    "upTo": 59,
    "amount": 1523100
   },
   {
    "upTo": 64,
    "amount": 1081100
   },
   {
    "upTo": 69,
    "amount": 636100
   },
   {
    "upTo": null,
    "amount": 339600
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.annualBonus.regular.male.small": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別の年間賞与その他特別給与額（正社員・正職員・男・10～99人。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 112100
   },
   {
    "upTo": 24,
    "amount": 327700
   },
   {
    "upTo": 29,
    "amount": 542400
   },
   {
    "upTo": 34,
    "amount": 677900
   },
   {
    "upTo": 39,
    "amount": 808900
   },
   {
    "upTo": 44,
    "amount": 855400
   },
   {
    "upTo": 49,
    "amount": 914600
   },
   {
    "upTo": 54,
    "amount": 904300
   },
   {
    "upTo": 59,
    "amount": 836000
   },
   {
    "upTo": 64,
    "amount": 697500
   },
   {
    "upTo": 69,
    "amount": 437400
   },
   {
    "upTo": null,
    "amount": 348500
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.contractualMonthly.nonRegular.female.all": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別のきまって支給する現金給与額（月額）（正社員・正職員以外・女・企業規模計（10人以上）。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 201200
   },
   {
    "upTo": 24,
    "amount": 220500
   },
   {
    "upTo": 29,
    "amount": 240700
   },
   {
    "upTo": 34,
    "amount": 237300
   },
   {
    "upTo": 39,
    "amount": 228800
   },
   {
    "upTo": 44,
    "amount": 230600
   },
   {
    "upTo": 49,
    "amount": 231400
   },
   {
    "upTo": 54,
    "amount": 230400
   },
   {
    "upTo": 59,
    "amount": 228000
   },
   {
    "upTo": 64,
    "amount": 239600
   },
   {
    "upTo": 69,
    "amount": 220000
   },
   {
    "upTo": null,
    "amount": 204800
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.contractualMonthly.nonRegular.female.large": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別のきまって支給する現金給与額（月額）（正社員・正職員以外・女・1,000人以上。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 209500
   },
   {
    "upTo": 24,
    "amount": 229600
   },
   {
    "upTo": 29,
    "amount": 255700
   },
   {
    "upTo": 34,
    "amount": 247500
   },
   {
    "upTo": 39,
    "amount": 240300
   },
   {
    "upTo": 44,
    "amount": 244100
   },
   {
    "upTo": 49,
    "amount": 239400
   },
   {
    "upTo": 54,
    "amount": 239900
   },
   {
    "upTo": 59,
    "amount": 235400
   },
   {
    "upTo": 64,
    "amount": 244900
   },
   {
    "upTo": 69,
    "amount": 227300
   },
   {
    "upTo": null,
    "amount": 215200
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.contractualMonthly.nonRegular.female.medium": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別のきまって支給する現金給与額（月額）（正社員・正職員以外・女・100～999人。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 202800
   },
   {
    "upTo": 24,
    "amount": 222800
   },
   {
    "upTo": 29,
    "amount": 233800
   },
   {
    "upTo": 34,
    "amount": 234900
   },
   {
    "upTo": 39,
    "amount": 226000
   },
   {
    "upTo": 44,
    "amount": 223900
   },
   {
    "upTo": 49,
    "amount": 227500
   },
   {
    "upTo": 54,
    "amount": 226400
   },
   {
    "upTo": 59,
    "amount": 224200
   },
   {
    "upTo": 64,
    "amount": 242100
   },
   {
    "upTo": 69,
    "amount": 220500
   },
   {
    "upTo": null,
    "amount": 208300
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.contractualMonthly.nonRegular.female.small": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別のきまって支給する現金給与額（月額）（正社員・正職員以外・女・10～99人。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 188200
   },
   {
    "upTo": 24,
    "amount": 203100
   },
   {
    "upTo": 29,
    "amount": 218100
   },
   {
    "upTo": 34,
    "amount": 219700
   },
   {
    "upTo": 39,
    "amount": 210100
   },
   {
    "upTo": 44,
    "amount": 214700
   },
   {
    "upTo": 49,
    "amount": 221000
   },
   {
    "upTo": 54,
    "amount": 214700
   },
   {
    "upTo": 59,
    "amount": 217200
   },
   {
    "upTo": 64,
    "amount": 225100
   },
   {
    "upTo": 69,
    "amount": 210800
   },
   {
    "upTo": null,
    "amount": 193300
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.contractualMonthly.nonRegular.male.all": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別のきまって支給する現金給与額（月額）（正社員・正職員以外・男・企業規模計（10人以上）。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 212400
   },
   {
    "upTo": 24,
    "amount": 231300
   },
   {
    "upTo": 29,
    "amount": 271700
   },
   {
    "upTo": 34,
    "amount": 280200
   },
   {
    "upTo": 39,
    "amount": 276100
   },
   {
    "upTo": 44,
    "amount": 279200
   },
   {
    "upTo": 49,
    "amount": 291000
   },
   {
    "upTo": 54,
    "amount": 282200
   },
   {
    "upTo": 59,
    "amount": 287500
   },
   {
    "upTo": 64,
    "amount": 333600
   },
   {
    "upTo": 69,
    "amount": 285800
   },
   {
    "upTo": null,
    "amount": 255700
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.contractualMonthly.nonRegular.male.large": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別のきまって支給する現金給与額（月額）（正社員・正職員以外・男・1,000人以上。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 220400
   },
   {
    "upTo": 24,
    "amount": 244700
   },
   {
    "upTo": 29,
    "amount": 304900
   },
   {
    "upTo": 34,
    "amount": 300900
   },
   {
    "upTo": 39,
    "amount": 294800
   },
   {
    "upTo": 44,
    "amount": 292300
   },
   {
    "upTo": 49,
    "amount": 308800
   },
   {
    "upTo": 54,
    "amount": 287900
   },
   {
    "upTo": 59,
    "amount": 316100
   },
   {
    "upTo": 64,
    "amount": 355200
   },
   {
    "upTo": 69,
    "amount": 297300
   },
   {
    "upTo": null,
    "amount": 292000
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.contractualMonthly.nonRegular.male.medium": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別のきまって支給する現金給与額（月額）（正社員・正職員以外・男・100～999人。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 214800
   },
   {
    "upTo": 24,
    "amount": 229200
   },
   {
    "upTo": 29,
    "amount": 258900
   },
   {
    "upTo": 34,
    "amount": 264600
   },
   {
    "upTo": 39,
    "amount": 262900
   },
   {
    "upTo": 44,
    "amount": 268300
   },
   {
    "upTo": 49,
    "amount": 279200
   },
   {
    "upTo": 54,
    "amount": 272900
   },
   {
    "upTo": 59,
    "amount": 268200
   },
   {
    "upTo": 64,
    "amount": 324200
   },
   {
    "upTo": 69,
    "amount": 285900
   },
   {
    "upTo": null,
    "amount": 252500
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.contractualMonthly.nonRegular.male.small": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別のきまって支給する現金給与額（月額）（正社員・正職員以外・男・10～99人。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 197500
   },
   {
    "upTo": 24,
    "amount": 213000
   },
   {
    "upTo": 29,
    "amount": 232100
   },
   {
    "upTo": 34,
    "amount": 265300
   },
   {
    "upTo": 39,
    "amount": 264000
   },
   {
    "upTo": 44,
    "amount": 271100
   },
   {
    "upTo": 49,
    "amount": 275300
   },
   {
    "upTo": 54,
    "amount": 287700
   },
   {
    "upTo": 59,
    "amount": 275500
   },
   {
    "upTo": 64,
    "amount": 305700
   },
   {
    "upTo": 69,
    "amount": 271600
   },
   {
    "upTo": null,
    "amount": 234200
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.contractualMonthly.regular.female.all": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別のきまって支給する現金給与額（月額）（正社員・正職員・女・企業規模計（10人以上）。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 215200
   },
   {
    "upTo": 24,
    "amount": 263400
   },
   {
    "upTo": 29,
    "amount": 300000
   },
   {
    "upTo": 34,
    "amount": 316100
   },
   {
    "upTo": 39,
    "amount": 326800
   },
   {
    "upTo": 44,
    "amount": 343400
   },
   {
    "upTo": 49,
    "amount": 348700
   },
   {
    "upTo": 54,
    "amount": 355500
   },
   {
    "upTo": 59,
    "amount": 359000
   },
   {
    "upTo": 64,
    "amount": 323700
   },
   {
    "upTo": 69,
    "amount": 296200
   },
   {
    "upTo": null,
    "amount": 275700
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.contractualMonthly.regular.female.large": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別のきまって支給する現金給与額（月額）（正社員・正職員・女・1,000人以上。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 230400
   },
   {
    "upTo": 24,
    "amount": 287400
   },
   {
    "upTo": 29,
    "amount": 332500
   },
   {
    "upTo": 34,
    "amount": 356200
   },
   {
    "upTo": 39,
    "amount": 366000
   },
   {
    "upTo": 44,
    "amount": 402900
   },
   {
    "upTo": 49,
    "amount": 414800
   },
   {
    "upTo": 54,
    "amount": 419300
   },
   {
    "upTo": 59,
    "amount": 427900
   },
   {
    "upTo": 64,
    "amount": 384800
   },
   {
    "upTo": 69,
    "amount": 368200
   },
   {
    "upTo": null,
    "amount": 327700
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.contractualMonthly.regular.female.medium": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別のきまって支給する現金給与額（月額）（正社員・正職員・女・100～999人。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 210800
   },
   {
    "upTo": 24,
    "amount": 255900
   },
   {
    "upTo": 29,
    "amount": 291000
   },
   {
    "upTo": 34,
    "amount": 305900
   },
   {
    "upTo": 39,
    "amount": 321200
   },
   {
    "upTo": 44,
    "amount": 332600
   },
   {
    "upTo": 49,
    "amount": 341400
   },
   {
    "upTo": 54,
    "amount": 351500
   },
   {
    "upTo": 59,
    "amount": 350000
   },
   {
    "upTo": 64,
    "amount": 319500
   },
   {
    "upTo": 69,
    "amount": 291300
   },
   {
    "upTo": null,
    "amount": 261200
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.contractualMonthly.regular.female.small": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別のきまって支給する現金給与額（月額）（正社員・正職員・女・10～99人。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 202500
   },
   {
    "upTo": 24,
    "amount": 237900
   },
   {
    "upTo": 29,
    "amount": 268600
   },
   {
    "upTo": 34,
    "amount": 282700
   },
   {
    "upTo": 39,
    "amount": 290500
   },
   {
    "upTo": 44,
    "amount": 297500
   },
   {
    "upTo": 49,
    "amount": 298300
   },
   {
    "upTo": 54,
    "amount": 304800
   },
   {
    "upTo": 59,
    "amount": 306600
   },
   {
    "upTo": 64,
    "amount": 287800
   },
   {
    "upTo": 69,
    "amount": 274700
   },
   {
    "upTo": null,
    "amount": 265500
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.contractualMonthly.regular.male.all": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別のきまって支給する現金給与額（月額）（正社員・正職員・男・企業規模計（10人以上）。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 234300
   },
   {
    "upTo": 24,
    "amount": 279200
   },
   {
    "upTo": 29,
    "amount": 333900
   },
   {
    "upTo": 34,
    "amount": 382700
   },
   {
    "upTo": 39,
    "amount": 420900
   },
   {
    "upTo": 44,
    "amount": 449200
   },
   {
    "upTo": 49,
    "amount": 469000
   },
   {
    "upTo": 54,
    "amount": 485800
   },
   {
    "upTo": 59,
    "amount": 494300
   },
   {
    "upTo": 64,
    "amount": 416800
   },
   {
    "upTo": 69,
    "amount": 359700
   },
   {
    "upTo": null,
    "amount": 322300
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.contractualMonthly.regular.male.large": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別のきまって支給する現金給与額（月額）（正社員・正職員・男・1,000人以上。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 248400
   },
   {
    "upTo": 24,
    "amount": 302800
   },
   {
    "upTo": 29,
    "amount": 371700
   },
   {
    "upTo": 34,
    "amount": 437600
   },
   {
    "upTo": 39,
    "amount": 494800
   },
   {
    "upTo": 44,
    "amount": 533200
   },
   {
    "upTo": 49,
    "amount": 560800
   },
   {
    "upTo": 54,
    "amount": 575800
   },
   {
    "upTo": 59,
    "amount": 592300
   },
   {
    "upTo": 64,
    "amount": 485700
   },
   {
    "upTo": 69,
    "amount": 474600
   },
   {
    "upTo": null,
    "amount": 683500
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.contractualMonthly.regular.male.medium": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別のきまって支給する現金給与額（月額）（正社員・正職員・男・100～999人。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 225900
   },
   {
    "upTo": 24,
    "amount": 272700
   },
   {
    "upTo": 29,
    "amount": 320400
   },
   {
    "upTo": 34,
    "amount": 367700
   },
   {
    "upTo": 39,
    "amount": 395600
   },
   {
    "upTo": 44,
    "amount": 428000
   },
   {
    "upTo": 49,
    "amount": 449900
   },
   {
    "upTo": 54,
    "amount": 469500
   },
   {
    "upTo": 59,
    "amount": 475900
   },
   {
    "upTo": 64,
    "amount": 417000
   },
   {
    "upTo": 69,
    "amount": 401900
   },
   {
    "upTo": null,
    "amount": 352300
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.contractualMonthly.regular.male.small": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別のきまって支給する現金給与額（月額）（正社員・正職員・男・10～99人。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 222400
   },
   {
    "upTo": 24,
    "amount": 251000
   },
   {
    "upTo": 29,
    "amount": 292900
   },
   {
    "upTo": 34,
    "amount": 329100
   },
   {
    "upTo": 39,
    "amount": 356100
   },
   {
    "upTo": 44,
    "amount": 376100
   },
   {
    "upTo": 49,
    "amount": 393300
   },
   {
    "upTo": 54,
    "amount": 402400
   },
   {
    "upTo": 59,
    "amount": 397900
   },
   {
    "upTo": 64,
    "amount": 375900
   },
   {
    "upTo": 69,
    "amount": 326700
   },
   {
    "upTo": null,
    "amount": 298300
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.civilServant.monthly": {
  "title": "国家公務員給与等実態調査（人事院）令和7年 行政職俸給表（一）の平均給与月額（年齢計・学歴計）",
  "value": 414480,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.civilServant.monthlyByAge": {
  "title": "国家公務員給与等実態調査（人事院）令和7年 行政職俸給表（一）の年齢階層別の平均給与月額（学歴計。upTo は年齢階層の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 207416
   },
   {
    "upTo": 23,
    "amount": 246965
   },
   {
    "upTo": 27,
    "amount": 283879
   },
   {
    "upTo": 31,
    "amount": 319910
   },
   {
    "upTo": 35,
    "amount": 356730
   },
   {
    "upTo": 39,
    "amount": 395132
   },
   {
    "upTo": 43,
    "amount": 435728
   },
   {
    "upTo": 47,
    "amount": 467753
   },
   {
    "upTo": 51,
    "amount": 487877
   },
   {
    "upTo": 55,
    "amount": 503995
   },
   {
    "upTo": 59,
    "amount": 513459
   },
   {
    "upTo": null,
    "amount": 501150
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.contractualMonthly.nonRegular.female": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者のきまって支給する現金給与額（月額）（正社員・正職員以外・女・年齢計・企業規模計。民営事業所）",
  "value": 230600,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.contractualMonthly.nonRegular.male": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者のきまって支給する現金給与額（月額）（正社員・正職員以外・男・年齢計・企業規模計。民営事業所）",
  "value": 292300,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.contractualMonthly.regular.female": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者のきまって支給する現金給与額（月額）（正社員・正職員・女・年齢計・企業規模計。民営事業所）",
  "value": 325600,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.contractualMonthly.regular.male": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者のきまって支給する現金給与額（月額）（正社員・正職員・男・年齢計・企業規模計。民営事業所）",
  "value": 425600,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.default": {
  "title": "昇給カーブの係数（賃金構造基本統計調査 令和7年。正社員・正職員・男女計・企業規模計の年齢階級ごとの年収〔きまって支給する現金給与額×12＋年間賞与その他特別給与額〕を、～19歳を1とした比。upTo が年齢、rate が係数）",
  "value": [
   {
    "upTo": 19,
    "rate": "1.0000"
   },
   {
    "upTo": 24,
    "rate": "1.2848"
   },
   {
    "upTo": 29,
    "rate": "1.5989"
   },
   {
    "upTo": 34,
    "rate": "1.8261"
   },
   {
    "upTo": 39,
    "rate": "2.0174"
   },
   {
    "upTo": 44,
    "rate": "2.1635"
   },
   {
    "upTo": 49,
    "rate": "2.2472"
   },
   {
    "upTo": 54,
    "rate": "2.3596"
   },
   {
    "upTo": 59,
    "rate": "2.4116"
   },
   {
    "upTo": 64,
    "rate": "1.9733"
   },
   {
    "upTo": 69,
    "rate": "1.6178"
   },
   {
    "upTo": null,
    "rate": "1.4281"
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.partTimeHourly.female": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 短時間労働者の1時間当たり所定内給与額（女・年齢計・企業規模計。常用労働者計）",
  "value": 1418,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.partTimeHourly.male": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 短時間労働者の1時間当たり所定内給与額（男・年齢計・企業規模計。常用労働者計）",
  "value": 1769,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.scheduledMonthly.nonRegular.female": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の所定内給与額（月額）（正社員・正職員以外・女・年齢計・企業規模計。民営事業所）",
  "value": 218400,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.scheduledMonthly.nonRegular.male": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の所定内給与額（月額）（正社員・正職員以外・男・年齢計・企業規模計。民営事業所）",
  "value": 268100,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.scheduledMonthly.regular.female": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の所定内給与額（月額）（正社員・正職員・女・年齢計・企業規模計。民営事業所）",
  "value": 304900,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.scheduledMonthly.regular.male": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の所定内給与額（月額）（正社員・正職員・男・年齢計・企業規模計。民営事業所）",
  "value": 387400,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "retirementBenefit.company.highSchoolManual": {
  "title": "就労条件総合調査（厚生労働省）令和5年 会社都合退職者1人平均退職給付額（勤続20年以上かつ45歳以上・高校卒（現業職）。一時金と年金の現価の計）",
  "value": 7370000,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "retirementBenefit.company.highSchoolOffice": {
  "title": "就労条件総合調査（厚生労働省）令和5年 会社都合退職者1人平均退職給付額（勤続20年以上かつ45歳以上・高校卒（管理・事務・技術職）。一時金と年金の現価の計）",
  "value": 13850000,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "retirementBenefit.company.university": {
  "title": "就労条件総合調査（厚生労働省）令和5年 会社都合退職者1人平均退職給付額（勤続20年以上かつ45歳以上・大学・大学院卒（管理・事務・技術職）。一時金と年金の現価の計）",
  "value": 17380000,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "retirementBenefit.earlyIncentive.highSchoolManual": {
  "title": "就労条件総合調査（厚生労働省）令和5年 早期優遇退職者1人平均退職給付額（勤続20年以上かつ45歳以上・高校卒（現業職）。一時金と年金の現価の計）",
  "value": 21460000,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "retirementBenefit.earlyIncentive.highSchoolOffice": {
  "title": "就労条件総合調査（厚生労働省）令和5年 早期優遇退職者1人平均退職給付額（勤続20年以上かつ45歳以上・高校卒（管理・事務・技術職）。一時金と年金の現価の計）",
  "value": 24320000,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "retirementBenefit.earlyIncentive.university": {
  "title": "就労条件総合調査（厚生労働省）令和5年 早期優遇退職者1人平均退職給付額（勤続20年以上かつ45歳以上・大学・大学院卒（管理・事務・技術職）。一時金と年金の現価の計）",
  "value": 22660000,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "retirementBenefit.mandatory.highSchoolManual.byService": {
  "title": "就労条件総合調査（厚生労働省）令和5年 定年退職者1人平均退職給付額の勤続年数階級別（勤続20年以上かつ45歳以上・高校卒（現業職）・退職給付制度計。upTo は勤続年数の上限。20年未満の段は値なし）",
  "value": [
   {
    "upTo": 19
   },
   {
    "upTo": 24,
    "amount": 4060000
   },
   {
    "upTo": 29,
    "amount": 5550000
   },
   {
    "upTo": 34,
    "amount": 8000000
   },
   {
    "upTo": null,
    "amount": 14710000
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "retirementBenefit.mandatory.highSchoolManual": {
  "title": "就労条件総合調査（厚生労働省）令和5年 定年退職者1人平均退職給付額（勤続20年以上かつ45歳以上・高校卒（現業職）。一時金と年金の現価の計）",
  "value": 11830000,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "retirementBenefit.mandatory.highSchoolOffice.byService": {
  "title": "就労条件総合調査（厚生労働省）令和5年 定年退職者1人平均退職給付額の勤続年数階級別（勤続20年以上かつ45歳以上・高校卒（管理・事務・技術職）・退職給付制度計。upTo は勤続年数の上限。20年未満の段は値なし）",
  "value": [
   {
    "upTo": 19
   },
   {
    "upTo": 24,
    "amount": 5570000
   },
   {
    "upTo": 29,
    "amount": 6180000
   },
   {
    "upTo": 34,
    "amount": 10940000
   },
   {
    "upTo": null,
    "amount": 19090000
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "retirementBenefit.mandatory.highSchoolOffice": {
  "title": "就労条件総合調査（厚生労働省）令和5年 定年退職者1人平均退職給付額（勤続20年以上かつ45歳以上・高校卒（管理・事務・技術職）。一時金と年金の現価の計）",
  "value": 16820000,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "retirementBenefit.mandatory.university.byService": {
  "title": "就労条件総合調査（厚生労働省）令和5年 定年退職者1人平均退職給付額の勤続年数階級別（勤続20年以上かつ45歳以上・大学・大学院卒（管理・事務・技術職）・退職給付制度計。upTo は勤続年数の上限。20年未満の段は値なし）",
  "value": [
   {
    "upTo": 19
   },
   {
    "upTo": 24,
    "amount": 10210000
   },
   {
    "upTo": 29,
    "amount": 15590000
   },
   {
    "upTo": 34,
    "amount": 18910000
   },
   {
    "upTo": null,
    "amount": 20370000
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "retirementBenefit.mandatory.university": {
  "title": "就労条件総合調査（厚生労働省）令和5年 定年退職者1人平均退職給付額（勤続20年以上かつ45歳以上・大学・大学院卒（管理・事務・技術職）。一時金と年金の現価の計）",
  "value": 18960000,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "retirementBenefit.prevalence.bySize": {
  "title": "就労条件総合調査（厚生労働省）令和5年 退職給付（一時金・年金）制度がある企業の割合（企業規模別。upTo は常用労働者数の上限、rate が割合）",
  "value": [
   {
    "upTo": 99,
    "rate": "0.701"
   },
   {
    "upTo": 299,
    "rate": "0.847"
   },
   {
    "upTo": 999,
    "rate": "0.888"
   },
   {
    "upTo": null,
    "rate": "0.901"
   }
  ],
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "retirementBenefit.prevalence": {
  "title": "就労条件総合調査（厚生労働省）令和5年 退職給付（一時金・年金）制度がある企業の割合（企業規模計。常用労働者30人以上の民営企業）",
  "value": "0.749",
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "retirementBenefit.smallFirm.company.highSchool": {
  "title": "中小企業の賃金・退職金事情（東京都産業労働局）令和6年版 第8表 モデル退職金の会社都合退職の退職金支給額（高校卒・調査産業計。従業員10〜299人の都内の中小企業。upTo は勤続年数の上限。各段は表の勤続年数〔1・3・5・10・15・20…年〕の額を次の勤続年数の前の年まで当てる）",
  "value": [
   {
    "upTo": 0
   },
   {
    "upTo": 2,
    "amount": 97000
   },
   {
    "upTo": 4,
    "amount": 266000
   },
   {
    "upTo": 9,
    "amount": 513000
   },
   {
    "upTo": 14,
    "amount": 1264000
   },
   {
    "upTo": 19,
    "amount": 2373000
   },
   {
    "upTo": 24,
    "amount": 3428000
   },
   {
    "upTo": 29,
    "amount": 5100000
   },
   {
    "upTo": 34,
    "amount": 6570000
   },
   {
    "upTo": 36,
    "amount": 7905000
   },
   {
    "upTo": null,
    "amount": 8419000
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "retirementBenefit.smallFirm.company.juniorCollege": {
  "title": "中小企業の賃金・退職金事情（東京都産業労働局）令和6年版 第8表 モデル退職金の会社都合退職の退職金支給額（高専・短大卒・調査産業計。従業員10〜299人の都内の中小企業。upTo は勤続年数の上限。各段は表の勤続年数〔1・3・5・10・15・20…年〕の額を次の勤続年数の前の年まで当てる）",
  "value": [
   {
    "upTo": 0
   },
   {
    "upTo": 2,
    "amount": 97000
   },
   {
    "upTo": 4,
    "amount": 282000
   },
   {
    "upTo": 9,
    "amount": 516000
   },
   {
    "upTo": 14,
    "amount": 1528000
   },
   {
    "upTo": 19,
    "amount": 2270000
   },
   {
    "upTo": 24,
    "amount": 3578000
   },
   {
    "upTo": 29,
    "amount": 5099000
   },
   {
    "upTo": 34,
    "amount": 6635000
   },
   {
    "upTo": null,
    "amount": 8153000
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "retirementBenefit.smallFirm.company.university": {
  "title": "中小企業の賃金・退職金事情（東京都産業労働局）令和6年版 第8表 モデル退職金の会社都合退職の退職金支給額（大学卒・調査産業計。従業員10〜299人の都内の中小企業。upTo は勤続年数の上限。各段は表の勤続年数〔1・3・5・10・15・20…年〕の額を次の勤続年数の前の年まで当てる）",
  "value": [
   {
    "upTo": 0
   },
   {
    "upTo": 2,
    "amount": 96000
   },
   {
    "upTo": 4,
    "amount": 304000
   },
   {
    "upTo": 9,
    "amount": 574000
   },
   {
    "upTo": 14,
    "amount": 1448000
   },
   {
    "upTo": 19,
    "amount": 2559000
   },
   {
    "upTo": 24,
    "amount": 4081000
   },
   {
    "upTo": 29,
    "amount": 6156000
   },
   {
    "upTo": 32,
    "amount": 7762000
   },
   {
    "upTo": null,
    "amount": 8897000
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "retirementBenefit.smallFirm.voluntary.highSchool": {
  "title": "中小企業の賃金・退職金事情（東京都産業労働局）令和6年版 第8表 モデル退職金の自己都合退職の退職金支給額（高校卒・調査産業計。従業員10〜299人の都内の中小企業。upTo は勤続年数の上限。各段は表の勤続年数〔1・3・5・10・15・20…年〕の額を次の勤続年数の前の年まで当てる）",
  "value": [
   {
    "upTo": 0
   },
   {
    "upTo": 2,
    "amount": 63000
   },
   {
    "upTo": 4,
    "amount": 196000
   },
   {
    "upTo": 9,
    "amount": 397000
   },
   {
    "upTo": 14,
    "amount": 985000
   },
   {
    "upTo": 19,
    "amount": 1903000
   },
   {
    "upTo": 24,
    "amount": 2881000
   },
   {
    "upTo": 29,
    "amount": 4342000
   },
   {
    "upTo": 34,
    "amount": 5757000
   },
   {
    "upTo": 36,
    "amount": 7008000
   },
   {
    "upTo": null,
    "amount": 7398000
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "retirementBenefit.smallFirm.voluntary.juniorCollege": {
  "title": "中小企業の賃金・退職金事情（東京都産業労働局）令和6年版 第8表 モデル退職金の自己都合退職の退職金支給額（高専・短大卒・調査産業計。従業員10〜299人の都内の中小企業。upTo は勤続年数の上限。各段は表の勤続年数〔1・3・5・10・15・20…年〕の額を次の勤続年数の前の年まで当てる）",
  "value": [
   {
    "upTo": 0
   },
   {
    "upTo": 2,
    "amount": 59000
   },
   {
    "upTo": 4,
    "amount": 209000
   },
   {
    "upTo": 9,
    "amount": 406000
   },
   {
    "upTo": 14,
    "amount": 1021000
   },
   {
    "upTo": 19,
    "amount": 1856000
   },
   {
    "upTo": 24,
    "amount": 3035000
   },
   {
    "upTo": 29,
    "amount": 4373000
   },
   {
    "upTo": 34,
    "amount": 5822000
   },
   {
    "upTo": null,
    "amount": 7217000
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "retirementBenefit.smallFirm.voluntary.university": {
  "title": "中小企業の賃金・退職金事情（東京都産業労働局）令和6年版 第8表 モデル退職金の自己都合退職の退職金支給額（大学卒・調査産業計。従業員10〜299人の都内の中小企業。upTo は勤続年数の上限。各段は表の勤続年数〔1・3・5・10・15・20…年〕の額を次の勤続年数の前の年まで当てる）",
  "value": [
   {
    "upTo": 0
   },
   {
    "upTo": 2,
    "amount": 55000
   },
   {
    "upTo": 4,
    "amount": 215000
   },
   {
    "upTo": 9,
    "amount": 432000
   },
   {
    "upTo": 14,
    "amount": 1125000
   },
   {
    "upTo": 19,
    "amount": 2093000
   },
   {
    "upTo": 24,
    "amount": 3468000
   },
   {
    "upTo": 29,
    "amount": 5073000
   },
   {
    "upTo": 32,
    "amount": 7507000
   },
   {
    "upTo": null,
    "amount": 7968000
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "retirementBenefit.voluntary.highSchoolManual": {
  "title": "就労条件総合調査（厚生労働省）令和5年 自己都合退職者1人平均退職給付額（勤続20年以上かつ45歳以上・高校卒（現業職）。一時金と年金の現価の計）",
  "value": 9210000,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "retirementBenefit.voluntary.highSchoolOffice": {
  "title": "就労条件総合調査（厚生労働省）令和5年 自己都合退職者1人平均退職給付額（勤続20年以上かつ45歳以上・高校卒（管理・事務・技術職）。一時金と年金の現価の計）",
  "value": 12800000,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "retirementBenefit.voluntary.university": {
  "title": "就労条件総合調査（厚生労働省）令和5年 自己都合退職者1人平均退職給付額（勤続20年以上かつ45歳以上・大学・大学院卒（管理・事務・技術職）。一時金と年金の現価の計）",
  "value": 14410000,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "living.statistics.basicMonthly": {
  "title": "家計調査（総務省）2025年 二人以上の世帯の世帯人員別の1か月の消費支出から、住居・教育・自動車等関係費を除いた額（upTo は世帯人員。1人の段は値なし〔単身世帯はこの表に無い〕、最後の段は6人以上）",
  "value": [
   {
    "upTo": 1
   },
   {
    "upTo": 2,
    "amount": 235225
   },
   {
    "upTo": 3,
    "amount": 264456
   },
   {
    "upTo": 4,
    "amount": 279695
   },
   {
    "upTo": 5,
    "amount": 285353
   },
   {
    "upTo": null,
    "amount": 303204
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "living.statistics.categoryMonthly.clothing": {
  "title": "家計調査（総務省）2025年 二人以上の世帯の世帯人員別の1か月の被服及び履物（基本生活費の費目の割合の目安。upTo は世帯人員。1人の段は値なし〔単身世帯はこの表に無い〕、最後の段は6人以上）",
  "value": [
   {
    "upTo": 1
   },
   {
    "upTo": 2,
    "amount": 7257
   },
   {
    "upTo": 3,
    "amount": 10034
   },
   {
    "upTo": 4,
    "amount": 13523
   },
   {
    "upTo": 5,
    "amount": 14629
   },
   {
    "upTo": null,
    "amount": 15115
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "living.statistics.categoryMonthly.food": {
  "title": "家計調査（総務省）2025年 二人以上の世帯の世帯人員別の1か月の食料（基本生活費の費目の割合の目安。upTo は世帯人員。1人の段は値なし〔単身世帯はこの表に無い〕、最後の段は6人以上）",
  "value": [
   {
    "upTo": 1
   },
   {
    "upTo": 2,
    "amount": 79340
   },
   {
    "upTo": 3,
    "amount": 92240
   },
   {
    "upTo": 4,
    "amount": 103384
   },
   {
    "upTo": 5,
    "amount": 112019
   },
   {
    "upTo": null,
    "amount": 123241
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "living.statistics.categoryMonthly.furniture": {
  "title": "家計調査（総務省）2025年 二人以上の世帯の世帯人員別の1か月の家具・家事用品（基本生活費の費目の割合の目安。upTo は世帯人員。1人の段は値なし〔単身世帯はこの表に無い〕、最後の段は6人以上）",
  "value": [
   {
    "upTo": 1
   },
   {
    "upTo": 2,
    "amount": 11564
   },
   {
    "upTo": 3,
    "amount": 13475
   },
   {
    "upTo": 4,
    "amount": 14292
   },
   {
    "upTo": 5,
    "amount": 16021
   },
   {
    "upTo": null,
    "amount": 14003
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "living.statistics.categoryMonthly.health": {
  "title": "家計調査（総務省）2025年 二人以上の世帯の世帯人員別の1か月の保健医療（基本生活費の費目の割合の目安。upTo は世帯人員。1人の段は値なし〔単身世帯はこの表に無い〕、最後の段は6人以上）",
  "value": [
   {
    "upTo": 1
   },
   {
    "upTo": 2,
    "amount": 16280
   },
   {
    "upTo": 3,
    "amount": 16445
   },
   {
    "upTo": 4,
    "amount": 14392
   },
   {
    "upTo": 5,
    "amount": 14007
   },
   {
    "upTo": null,
    "amount": 12876
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "living.statistics.categoryMonthly.otherConsumption": {
  "title": "家計調査（総務省）2025年 二人以上の世帯の世帯人員別の1か月のその他の消費支出（仕送り金を含む）（基本生活費の費目の割合の目安。upTo は世帯人員。1人の段は値なし〔単身世帯はこの表に無い〕、最後の段は6人以上）",
  "value": [
   {
    "upTo": 1
   },
   {
    "upTo": 2,
    "amount": 54799
   },
   {
    "upTo": 3,
    "amount": 58525
   },
   {
    "upTo": 4,
    "amount": 51025
   },
   {
    "upTo": 5,
    "amount": 45298
   },
   {
    "upTo": null,
    "amount": 46976
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "living.statistics.categoryMonthly.recreation": {
  "title": "家計調査（総務省）2025年 二人以上の世帯の世帯人員別の1か月の教養娯楽（基本生活費の費目の割合の目安。upTo は世帯人員。1人の段は値なし〔単身世帯はこの表に無い〕、最後の段は6人以上）",
  "value": [
   {
    "upTo": 1
   },
   {
    "upTo": 2,
    "amount": 28411
   },
   {
    "upTo": 3,
    "amount": 29433
   },
   {
    "upTo": 4,
    "amount": 36710
   },
   {
    "upTo": 5,
    "amount": 35859
   },
   {
    "upTo": null,
    "amount": 36390
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "living.statistics.categoryMonthly.transport": {
  "title": "家計調査（総務省）2025年 二人以上の世帯の世帯人員別の1か月の交通・通信から自動車等関係費を除いた額（基本生活費の費目の割合の目安。upTo は世帯人員。1人の段は値なし〔単身世帯はこの表に無い〕、最後の段は6人以上）",
  "value": [
   {
    "upTo": 1
   },
   {
    "upTo": 2,
    "amount": 14883
   },
   {
    "upTo": 3,
    "amount": 18677
   },
   {
    "upTo": 4,
    "amount": 20428
   },
   {
    "upTo": 5,
    "amount": 19250
   },
   {
    "upTo": null,
    "amount": 21069
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "living.statistics.categoryMonthly.utilities": {
  "title": "家計調査（総務省）2025年 二人以上の世帯の世帯人員別の1か月の光熱・水道（基本生活費の費目の割合の目安。upTo は世帯人員。1人の段は値なし〔単身世帯はこの表に無い〕、最後の段は6人以上）",
  "value": [
   {
    "upTo": 1
   },
   {
    "upTo": 2,
    "amount": 22691
   },
   {
    "upTo": 3,
    "amount": 25626
   },
   {
    "upTo": 4,
    "amount": 25942
   },
   {
    "upTo": 5,
    "amount": 28271
   },
   {
    "upTo": null,
    "amount": 33534
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "education.statistics.boarding.annual": {
  "title": "自宅外通学の仕送りの年額（教育費負担の実態調査）",
  "value": 958000,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.boarding.initial": {
  "title": "自宅外通学を始めるための費用（教育費負担の実態調査）",
  "value": 387000,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.elementary.private.outOfSchool": {
  "title": "学校外活動費の年額（私立小学校）",
  "value": 709667,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.elementary.private.total": {
  "title": "学習費総額の年額（私立小学校。子供の学習費調査）",
  "value": 1741516,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.elementary.public.outOfSchool": {
  "title": "学校外活動費の年額（公立小学校）",
  "value": 256489,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.elementary.public.schoolLunch": {
  "title": "学校給食費の年額（公立小学校。子供の学習費調査。学習費総額のうち）",
  "value": 35774,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-20"
 },
 "education.statistics.elementary.public.total": {
  "title": "学習費総額の年額（公立小学校。子供の学習費調査）",
  "value": 366599,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.highSchool.private.outOfSchool": {
  "title": "学校外活動費の年額（私立高校）",
  "value": 346611,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.highSchool.private.total": {
  "title": "学習費総額の年額（私立高等学校（全日制）。子供の学習費調査）",
  "value": 1179261,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.highSchool.public.outOfSchool": {
  "title": "学校外活動費の年額（公立高校）",
  "value": 245431,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.highSchool.public.total": {
  "title": "学習費総額の年額（公立高等学校（全日制）。子供の学習費調査）",
  "value": 596954,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.juniorCollege.private.admission": {
  "title": "私立短期大学の入学料の平均（令和7年度入学者）",
  "value": 236054,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.juniorCollege.private.facility": {
  "title": "私立短期大学の施設設備費の平均（令和7年度入学者）",
  "value": 170132,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.juniorCollege.private.tuition": {
  "title": "私立短期大学の授業料の平均（令和7年度入学者）",
  "value": 734328,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.juniorHigh.private.outOfSchool": {
  "title": "学校外活動費の年額（私立中学校）",
  "value": 422981,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.juniorHigh.private.total": {
  "title": "学習費総額の年額（私立中学校。子供の学習費調査）",
  "value": 1560359,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.juniorHigh.public.outOfSchool": {
  "title": "学校外活動費の年額（公立中学校）",
  "value": 356018,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.juniorHigh.public.schoolLunch": {
  "title": "学校給食費の年額（公立中学校。子供の学習費調査。学習費総額のうち）",
  "value": 35671,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-20"
 },
 "education.statistics.juniorHigh.public.total": {
  "title": "学習費総額の年額（公立中学校。子供の学習費調査）",
  "value": 542450,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.kindergarten.private.outOfSchool": {
  "title": "学校外活動費の年額（私立幼稚園）",
  "value": 157535,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.kindergarten.private.total": {
  "title": "学習費総額の年額（私立幼稚園。子供の学習費調査）",
  "value": 347338,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.kindergarten.public.outOfSchool": {
  "title": "学校外活動費の年額（公立幼稚園）",
  "value": 100049,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.kindergarten.public.total": {
  "title": "学習費総額の年額（公立幼稚園。子供の学習費調査）",
  "value": 184646,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.university.national.admission": {
  "title": "国立大学の入学料の標準額",
  "value": 282000,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.university.national.tuition": {
  "title": "国立大学の授業料の標準額（年額）",
  "value": 535800,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.university.private.all.admission": {
  "title": "私立大学の入学料の平均（全体。令和7年度入学者）",
  "value": 240365,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.university.private.all.facility": {
  "title": "私立大学の施設設備費の平均（全体。令和7年度入学者）",
  "value": 172550,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.university.private.all.tuition": {
  "title": "私立大学の授業料の平均（全体。令和7年度入学者）",
  "value": 968069,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.university.private.humanities.admission": {
  "title": "私立大学の入学料の平均（文科系。令和7年度入学者）",
  "value": 219951,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.university.private.humanities.facility": {
  "title": "私立大学の施設設備費の平均（文科系。令和7年度入学者）",
  "value": 141892,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.university.private.humanities.tuition": {
  "title": "私立大学の授業料の平均（文科系。令和7年度入学者）",
  "value": 850392,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.university.private.medical.admission": {
  "title": "私立大学の入学料の平均（医歯系。令和7年度入学者）",
  "value": 1088248,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.university.private.medical.facility": {
  "title": "私立大学の施設設備費の平均（医歯系。令和7年度入学者）",
  "value": 865535,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.university.private.medical.tuition": {
  "title": "私立大学の授業料の平均（医歯系。令和7年度入学者）",
  "value": 2825359,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.university.private.science.admission": {
  "title": "私立大学の入学料の平均（理科系。令和7年度入学者）",
  "value": 245362,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.university.private.science.facility": {
  "title": "私立大学の施設設備費の平均（理科系。令和7年度入学者）",
  "value": 161378,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.university.private.science.tuition": {
  "title": "私立大学の授業料の平均（理科系。令和7年度入学者）",
  "value": 1195313,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.university.public.admission": {
  "title": "公立大学の入学料の平均（地域外。令和5年度）",
  "value": 374371,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.university.public.tuition": {
  "title": "公立大学の授業料の平均（年額。令和5年度）",
  "value": 536191,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "care.statistics.initial": {
  "title": "介護の一時的な費用の平均",
  "value": 472000,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "care.statistics.monthly": {
  "title": "介護の月々の費用の平均（自己負担。在宅・施設の全体）",
  "value": 90000,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "care.statistics.monthlyFacility": {
  "title": "介護の月々の費用の平均（施設）",
  "value": 138000,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "care.statistics.monthlyHome": {
  "title": "介護の月々の費用の平均（在宅）",
  "value": 52000,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "care.statistics.months": {
  "title": "介護の期間の平均（月数）",
  "value": 55,
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "lifeTable.lifeExpectancy.female": {
  "title": "主な年齢の平均余命（簡易生命表。upTo は年齢、rate は平均余命の年数。最後の段は90歳の値）",
  "value": [
   {
    "upTo": 0,
    "rate": "87.33"
   },
   {
    "upTo": 20,
    "rate": "67.67"
   },
   {
    "upTo": 30,
    "rate": "57.85"
   },
   {
    "upTo": 40,
    "rate": "48.05"
   },
   {
    "upTo": 50,
    "rate": "38.41"
   },
   {
    "upTo": 60,
    "rate": "29.07"
   },
   {
    "upTo": 65,
    "rate": "24.52"
   },
   {
    "upTo": 70,
    "rate": "20.10"
   },
   {
    "upTo": 75,
    "rate": "15.88"
   },
   {
    "upTo": 80,
    "rate": "11.95"
   },
   {
    "upTo": 85,
    "rate": "8.47"
   },
   {
    "upTo": 90,
    "rate": "5.66"
   },
   {
    "upTo": null,
    "rate": "5.66"
   }
  ],
  "rev": 4,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "lifeTable.lifeExpectancy.male": {
  "title": "主な年齢の平均余命（簡易生命表。upTo は年齢、rate は平均余命の年数。最後の段は90歳の値）",
  "value": [
   {
    "upTo": 0,
    "rate": "81.35"
   },
   {
    "upTo": 20,
    "rate": "61.72"
   },
   {
    "upTo": 30,
    "rate": "51.98"
   },
   {
    "upTo": 40,
    "rate": "42.29"
   },
   {
    "upTo": 50,
    "rate": "32.82"
   },
   {
    "upTo": 60,
    "rate": "23.86"
   },
   {
    "upTo": 65,
    "rate": "19.68"
   },
   {
    "upTo": 70,
    "rate": "15.78"
   },
   {
    "upTo": 75,
    "rate": "12.24"
   },
   {
    "upTo": 80,
    "rate": "9.10"
   },
   {
    "upTo": 85,
    "rate": "6.44"
   },
   {
    "upTo": 90,
    "rate": "4.38"
   },
   {
    "upTo": null,
    "rate": "4.38"
   }
  ],
  "rev": 3,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 }
};

export const REGULATION_VALUES: Readonly<Record<string, readonly DatedValue[]>> = {
 "incomeTax.employmentIncomeDeduction": [
  {
   "from": "2025-01-01",
   "to": null,
   "rev": 1,
   "value": [
    {
     "upTo": 1900000,
     "amount": 650000
    },
    {
     "upTo": 3600000,
     "rate": "0.3",
     "amount": 80000
    },
    {
     "upTo": 6600000,
     "rate": "0.2",
     "amount": 440000
    },
    {
     "upTo": 8500000,
     "rate": "0.1",
     "amount": 1100000
    },
    {
     "upTo": null,
     "amount": 1950000
    }
   ]
  },
  {
   "from": "2026-01-01",
   "to": "2027-12-31",
   "rev": 2,
   "value": [
    {
     "upTo": 2200000,
     "amount": 740000
    },
    {
     "upTo": 3600000,
     "rate": "0.3",
     "amount": 80000
    },
    {
     "upTo": 6600000,
     "rate": "0.2",
     "amount": 440000
    },
    {
     "upTo": 8500000,
     "rate": "0.1",
     "amount": 1100000
    },
    {
     "upTo": null,
     "amount": 1950000
    }
   ]
  },
  {
   "from": "2028-01-01",
   "to": null,
   "rev": 3,
   "value": [
    {
     "upTo": 2033333,
     "amount": 690000
    },
    {
     "upTo": 3600000,
     "rate": "0.3",
     "amount": 80000
    },
    {
     "upTo": 6600000,
     "rate": "0.2",
     "amount": 440000
    },
    {
     "upTo": 8500000,
     "rate": "0.1",
     "amount": 1100000
    },
    {
     "upTo": null,
     "amount": 1950000
    }
   ]
  }
 ],
 "residentTax.basicDeduction": [
  {
   "from": "2025-06-01",
   "to": null,
   "rev": 1,
   "value": [
    {
     "upTo": 24000000,
     "amount": 430000
    },
    {
     "upTo": 24500000,
     "amount": 290000
    },
    {
     "upTo": 25000000,
     "amount": 150000
    },
    {
     "upTo": null,
     "amount": 0
    }
   ]
  }
 ],
 "incomeTax.retirementIncome.overlap.lookbackYears": [
  {
   "from": "2013-01-01",
   "to": null,
   "rev": 2,
   "value": 4
  }
 ],
 "incomeTax.retirementIncome.overlap.lookbackYearsAfterDc": [
  {
   "from": "2013-01-01",
   "to": "2025-12-31",
   "rev": 3,
   "value": 4
  },
  {
   "from": "2026-01-01",
   "to": null,
   "rev": 4,
   "value": 9
  }
 ],
 "incomeTax.retirementIncome.overlap.lookbackYearsForDc": [
  {
   "from": "2013-01-01",
   "to": "2022-03-31",
   "rev": 3,
   "value": 14
  },
  {
   "from": "2022-04-01",
   "to": null,
   "rev": 4,
   "value": 19
  }
 ],
 "inheritanceTax.retirementAllowance.exemptionPerHeir": [
  {
   "from": "2015-01-01",
   "to": null,
   "rev": 1,
   "value": 5000000
  }
 ],
 "residentTax.perCapita.municipal": [
  {
   "from": "2025-06-01",
   "to": null,
   "rev": 1,
   "value": 3000
  }
 ],
 "residentTax.perCapita.prefectural": [
  {
   "from": "2025-06-01",
   "to": null,
   "rev": 1,
   "value": 1000
  }
 ],
 "forestEnvironmentTax.amount": [
  {
   "from": "2025-06-01",
   "to": null,
   "rev": 1,
   "value": 1000
  }
 ],
 "socialInsurance.health.standardMonthlyRemuneration": [
  {
   "from": "2023-04-01",
   "to": "2024-12-31",
   "rev": 2,
   "value": [
    {
     "grade": 1,
     "amount": 58000,
     "from": 0,
     "below": 63000
    },
    {
     "grade": 2,
     "amount": 68000,
     "from": 63000,
     "below": 73000
    },
    {
     "grade": 3,
     "amount": 78000,
     "from": 73000,
     "below": 83000
    },
    {
     "grade": 4,
     "amount": 88000,
     "from": 83000,
     "below": 93000
    },
    {
     "grade": 5,
     "amount": 98000,
     "from": 93000,
     "below": 101000
    },
    {
     "grade": 6,
     "amount": 104000,
     "from": 101000,
     "below": 107000
    },
    {
     "grade": 7,
     "amount": 110000,
     "from": 107000,
     "below": 114000
    },
    {
     "grade": 8,
     "amount": 118000,
     "from": 114000,
     "below": 122000
    },
    {
     "grade": 9,
     "amount": 126000,
     "from": 122000,
     "below": 130000
    },
    {
     "grade": 10,
     "amount": 134000,
     "from": 130000,
     "below": 138000
    },
    {
     "grade": 11,
     "amount": 142000,
     "from": 138000,
     "below": 146000
    },
    {
     "grade": 12,
     "amount": 150000,
     "from": 146000,
     "below": 155000
    },
    {
     "grade": 13,
     "amount": 160000,
     "from": 155000,
     "below": 165000
    },
    {
     "grade": 14,
     "amount": 170000,
     "from": 165000,
     "below": 175000
    },
    {
     "grade": 15,
     "amount": 180000,
     "from": 175000,
     "below": 185000
    },
    {
     "grade": 16,
     "amount": 190000,
     "from": 185000,
     "below": 195000
    },
    {
     "grade": 17,
     "amount": 200000,
     "from": 195000,
     "below": 210000
    },
    {
     "grade": 18,
     "amount": 220000,
     "from": 210000,
     "below": 230000
    },
    {
     "grade": 19,
     "amount": 240000,
     "from": 230000,
     "below": 250000
    },
    {
     "grade": 20,
     "amount": 260000,
     "from": 250000,
     "below": 270000
    },
    {
     "grade": 21,
     "amount": 280000,
     "from": 270000,
     "below": 290000
    },
    {
     "grade": 22,
     "amount": 300000,
     "from": 290000,
     "below": 310000
    },
    {
     "grade": 23,
     "amount": 320000,
     "from": 310000,
     "below": 330000
    },
    {
     "grade": 24,
     "amount": 340000,
     "from": 330000,
     "below": 350000
    },
    {
     "grade": 25,
     "amount": 360000,
     "from": 350000,
     "below": 370000
    },
    {
     "grade": 26,
     "amount": 380000,
     "from": 370000,
     "below": 395000
    },
    {
     "grade": 27,
     "amount": 410000,
     "from": 395000,
     "below": 425000
    },
    {
     "grade": 28,
     "amount": 440000,
     "from": 425000,
     "below": 455000
    },
    {
     "grade": 29,
     "amount": 470000,
     "from": 455000,
     "below": 485000
    },
    {
     "grade": 30,
     "amount": 500000,
     "from": 485000,
     "below": 515000
    },
    {
     "grade": 31,
     "amount": 530000,
     "from": 515000,
     "below": 545000
    },
    {
     "grade": 32,
     "amount": 560000,
     "from": 545000,
     "below": 575000
    },
    {
     "grade": 33,
     "amount": 590000,
     "from": 575000,
     "below": 605000
    },
    {
     "grade": 34,
     "amount": 620000,
     "from": 605000,
     "below": 635000
    },
    {
     "grade": 35,
     "amount": 650000,
     "from": 635000,
     "below": 665000
    },
    {
     "grade": 36,
     "amount": 680000,
     "from": 665000,
     "below": 695000
    },
    {
     "grade": 37,
     "amount": 710000,
     "from": 695000,
     "below": 730000
    },
    {
     "grade": 38,
     "amount": 750000,
     "from": 730000,
     "below": 770000
    },
    {
     "grade": 39,
     "amount": 790000,
     "from": 770000,
     "below": 810000
    },
    {
     "grade": 40,
     "amount": 830000,
     "from": 810000,
     "below": 855000
    },
    {
     "grade": 41,
     "amount": 880000,
     "from": 855000,
     "below": 905000
    },
    {
     "grade": 42,
     "amount": 930000,
     "from": 905000,
     "below": 955000
    },
    {
     "grade": 43,
     "amount": 980000,
     "from": 955000,
     "below": 1005000
    },
    {
     "grade": 44,
     "amount": 1030000,
     "from": 1005000,
     "below": 1055000
    },
    {
     "grade": 45,
     "amount": 1090000,
     "from": 1055000,
     "below": 1115000
    },
    {
     "grade": 46,
     "amount": 1150000,
     "from": 1115000,
     "below": 1175000
    },
    {
     "grade": 47,
     "amount": 1210000,
     "from": 1175000,
     "below": 1235000
    },
    {
     "grade": 48,
     "amount": 1270000,
     "from": 1235000,
     "below": 1295000
    },
    {
     "grade": 49,
     "amount": 1330000,
     "from": 1295000,
     "below": 1355000
    },
    {
     "grade": 50,
     "amount": 1390000,
     "from": 1355000,
     "below": null
    }
   ]
  },
  {
   "from": "2025-01-01",
   "to": null,
   "rev": 1,
   "value": [
    {
     "grade": 1,
     "amount": 58000,
     "from": 0,
     "below": 63000
    },
    {
     "grade": 2,
     "amount": 68000,
     "from": 63000,
     "below": 73000
    },
    {
     "grade": 3,
     "amount": 78000,
     "from": 73000,
     "below": 83000
    },
    {
     "grade": 4,
     "amount": 88000,
     "from": 83000,
     "below": 93000
    },
    {
     "grade": 5,
     "amount": 98000,
     "from": 93000,
     "below": 101000
    },
    {
     "grade": 6,
     "amount": 104000,
     "from": 101000,
     "below": 107000
    },
    {
     "grade": 7,
     "amount": 110000,
     "from": 107000,
     "below": 114000
    },
    {
     "grade": 8,
     "amount": 118000,
     "from": 114000,
     "below": 122000
    },
    {
     "grade": 9,
     "amount": 126000,
     "from": 122000,
     "below": 130000
    },
    {
     "grade": 10,
     "amount": 134000,
     "from": 130000,
     "below": 138000
    },
    {
     "grade": 11,
     "amount": 142000,
     "from": 138000,
     "below": 146000
    },
    {
     "grade": 12,
     "amount": 150000,
     "from": 146000,
     "below": 155000
    },
    {
     "grade": 13,
     "amount": 160000,
     "from": 155000,
     "below": 165000
    },
    {
     "grade": 14,
     "amount": 170000,
     "from": 165000,
     "below": 175000
    },
    {
     "grade": 15,
     "amount": 180000,
     "from": 175000,
     "below": 185000
    },
    {
     "grade": 16,
     "amount": 190000,
     "from": 185000,
     "below": 195000
    },
    {
     "grade": 17,
     "amount": 200000,
     "from": 195000,
     "below": 210000
    },
    {
     "grade": 18,
     "amount": 220000,
     "from": 210000,
     "below": 230000
    },
    {
     "grade": 19,
     "amount": 240000,
     "from": 230000,
     "below": 250000
    },
    {
     "grade": 20,
     "amount": 260000,
     "from": 250000,
     "below": 270000
    },
    {
     "grade": 21,
     "amount": 280000,
     "from": 270000,
     "below": 290000
    },
    {
     "grade": 22,
     "amount": 300000,
     "from": 290000,
     "below": 310000
    },
    {
     "grade": 23,
     "amount": 320000,
     "from": 310000,
     "below": 330000
    },
    {
     "grade": 24,
     "amount": 340000,
     "from": 330000,
     "below": 350000
    },
    {
     "grade": 25,
     "amount": 360000,
     "from": 350000,
     "below": 370000
    },
    {
     "grade": 26,
     "amount": 380000,
     "from": 370000,
     "below": 395000
    },
    {
     "grade": 27,
     "amount": 410000,
     "from": 395000,
     "below": 425000
    },
    {
     "grade": 28,
     "amount": 440000,
     "from": 425000,
     "below": 455000
    },
    {
     "grade": 29,
     "amount": 470000,
     "from": 455000,
     "below": 485000
    },
    {
     "grade": 30,
     "amount": 500000,
     "from": 485000,
     "below": 515000
    },
    {
     "grade": 31,
     "amount": 530000,
     "from": 515000,
     "below": 545000
    },
    {
     "grade": 32,
     "amount": 560000,
     "from": 545000,
     "below": 575000
    },
    {
     "grade": 33,
     "amount": 590000,
     "from": 575000,
     "below": 605000
    },
    {
     "grade": 34,
     "amount": 620000,
     "from": 605000,
     "below": 635000
    },
    {
     "grade": 35,
     "amount": 650000,
     "from": 635000,
     "below": 665000
    },
    {
     "grade": 36,
     "amount": 680000,
     "from": 665000,
     "below": 695000
    },
    {
     "grade": 37,
     "amount": 710000,
     "from": 695000,
     "below": 730000
    },
    {
     "grade": 38,
     "amount": 750000,
     "from": 730000,
     "below": 770000
    },
    {
     "grade": 39,
     "amount": 790000,
     "from": 770000,
     "below": 810000
    },
    {
     "grade": 40,
     "amount": 830000,
     "from": 810000,
     "below": 855000
    },
    {
     "grade": 41,
     "amount": 880000,
     "from": 855000,
     "below": 905000
    },
    {
     "grade": 42,
     "amount": 930000,
     "from": 905000,
     "below": 955000
    },
    {
     "grade": 43,
     "amount": 980000,
     "from": 955000,
     "below": 1005000
    },
    {
     "grade": 44,
     "amount": 1030000,
     "from": 1005000,
     "below": 1055000
    },
    {
     "grade": 45,
     "amount": 1090000,
     "from": 1055000,
     "below": 1115000
    },
    {
     "grade": 46,
     "amount": 1150000,
     "from": 1115000,
     "below": 1175000
    },
    {
     "grade": 47,
     "amount": 1210000,
     "from": 1175000,
     "below": 1235000
    },
    {
     "grade": 48,
     "amount": 1270000,
     "from": 1235000,
     "below": 1295000
    },
    {
     "grade": 49,
     "amount": 1330000,
     "from": 1295000,
     "below": 1355000
    },
    {
     "grade": 50,
     "amount": 1390000,
     "from": 1355000,
     "below": null
    }
   ]
  }
 ],
 "socialInsurance.pension.standardMonthlyRemuneration": [
  {
   "from": "2023-04-01",
   "to": "2024-12-31",
   "rev": 5,
   "value": [
    {
     "grade": 1,
     "amount": 88000,
     "from": 0,
     "below": 93000
    },
    {
     "grade": 2,
     "amount": 98000,
     "from": 93000,
     "below": 101000
    },
    {
     "grade": 3,
     "amount": 104000,
     "from": 101000,
     "below": 107000
    },
    {
     "grade": 4,
     "amount": 110000,
     "from": 107000,
     "below": 114000
    },
    {
     "grade": 5,
     "amount": 118000,
     "from": 114000,
     "below": 122000
    },
    {
     "grade": 6,
     "amount": 126000,
     "from": 122000,
     "below": 130000
    },
    {
     "grade": 7,
     "amount": 134000,
     "from": 130000,
     "below": 138000
    },
    {
     "grade": 8,
     "amount": 142000,
     "from": 138000,
     "below": 146000
    },
    {
     "grade": 9,
     "amount": 150000,
     "from": 146000,
     "below": 155000
    },
    {
     "grade": 10,
     "amount": 160000,
     "from": 155000,
     "below": 165000
    },
    {
     "grade": 11,
     "amount": 170000,
     "from": 165000,
     "below": 175000
    },
    {
     "grade": 12,
     "amount": 180000,
     "from": 175000,
     "below": 185000
    },
    {
     "grade": 13,
     "amount": 190000,
     "from": 185000,
     "below": 195000
    },
    {
     "grade": 14,
     "amount": 200000,
     "from": 195000,
     "below": 210000
    },
    {
     "grade": 15,
     "amount": 220000,
     "from": 210000,
     "below": 230000
    },
    {
     "grade": 16,
     "amount": 240000,
     "from": 230000,
     "below": 250000
    },
    {
     "grade": 17,
     "amount": 260000,
     "from": 250000,
     "below": 270000
    },
    {
     "grade": 18,
     "amount": 280000,
     "from": 270000,
     "below": 290000
    },
    {
     "grade": 19,
     "amount": 300000,
     "from": 290000,
     "below": 310000
    },
    {
     "grade": 20,
     "amount": 320000,
     "from": 310000,
     "below": 330000
    },
    {
     "grade": 21,
     "amount": 340000,
     "from": 330000,
     "below": 350000
    },
    {
     "grade": 22,
     "amount": 360000,
     "from": 350000,
     "below": 370000
    },
    {
     "grade": 23,
     "amount": 380000,
     "from": 370000,
     "below": 395000
    },
    {
     "grade": 24,
     "amount": 410000,
     "from": 395000,
     "below": 425000
    },
    {
     "grade": 25,
     "amount": 440000,
     "from": 425000,
     "below": 455000
    },
    {
     "grade": 26,
     "amount": 470000,
     "from": 455000,
     "below": 485000
    },
    {
     "grade": 27,
     "amount": 500000,
     "from": 485000,
     "below": 515000
    },
    {
     "grade": 28,
     "amount": 530000,
     "from": 515000,
     "below": 545000
    },
    {
     "grade": 29,
     "amount": 560000,
     "from": 545000,
     "below": 575000
    },
    {
     "grade": 30,
     "amount": 590000,
     "from": 575000,
     "below": 605000
    },
    {
     "grade": 31,
     "amount": 620000,
     "from": 605000,
     "below": 635000
    },
    {
     "grade": 32,
     "amount": 650000,
     "from": 635000,
     "below": null
    }
   ]
  },
  {
   "from": "2025-01-01",
   "to": null,
   "rev": 1,
   "value": [
    {
     "grade": 1,
     "amount": 88000,
     "from": 0,
     "below": 93000
    },
    {
     "grade": 2,
     "amount": 98000,
     "from": 93000,
     "below": 101000
    },
    {
     "grade": 3,
     "amount": 104000,
     "from": 101000,
     "below": 107000
    },
    {
     "grade": 4,
     "amount": 110000,
     "from": 107000,
     "below": 114000
    },
    {
     "grade": 5,
     "amount": 118000,
     "from": 114000,
     "below": 122000
    },
    {
     "grade": 6,
     "amount": 126000,
     "from": 122000,
     "below": 130000
    },
    {
     "grade": 7,
     "amount": 134000,
     "from": 130000,
     "below": 138000
    },
    {
     "grade": 8,
     "amount": 142000,
     "from": 138000,
     "below": 146000
    },
    {
     "grade": 9,
     "amount": 150000,
     "from": 146000,
     "below": 155000
    },
    {
     "grade": 10,
     "amount": 160000,
     "from": 155000,
     "below": 165000
    },
    {
     "grade": 11,
     "amount": 170000,
     "from": 165000,
     "below": 175000
    },
    {
     "grade": 12,
     "amount": 180000,
     "from": 175000,
     "below": 185000
    },
    {
     "grade": 13,
     "amount": 190000,
     "from": 185000,
     "below": 195000
    },
    {
     "grade": 14,
     "amount": 200000,
     "from": 195000,
     "below": 210000
    },
    {
     "grade": 15,
     "amount": 220000,
     "from": 210000,
     "below": 230000
    },
    {
     "grade": 16,
     "amount": 240000,
     "from": 230000,
     "below": 250000
    },
    {
     "grade": 17,
     "amount": 260000,
     "from": 250000,
     "below": 270000
    },
    {
     "grade": 18,
     "amount": 280000,
     "from": 270000,
     "below": 290000
    },
    {
     "grade": 19,
     "amount": 300000,
     "from": 290000,
     "below": 310000
    },
    {
     "grade": 20,
     "amount": 320000,
     "from": 310000,
     "below": 330000
    },
    {
     "grade": 21,
     "amount": 340000,
     "from": 330000,
     "below": 350000
    },
    {
     "grade": 22,
     "amount": 360000,
     "from": 350000,
     "below": 370000
    },
    {
     "grade": 23,
     "amount": 380000,
     "from": 370000,
     "below": 395000
    },
    {
     "grade": 24,
     "amount": 410000,
     "from": 395000,
     "below": 425000
    },
    {
     "grade": 25,
     "amount": 440000,
     "from": 425000,
     "below": 455000
    },
    {
     "grade": 26,
     "amount": 470000,
     "from": 455000,
     "below": 485000
    },
    {
     "grade": 27,
     "amount": 500000,
     "from": 485000,
     "below": 515000
    },
    {
     "grade": 28,
     "amount": 530000,
     "from": 515000,
     "below": 545000
    },
    {
     "grade": 29,
     "amount": 560000,
     "from": 545000,
     "below": 575000
    },
    {
     "grade": 30,
     "amount": 590000,
     "from": 575000,
     "below": 605000
    },
    {
     "grade": 31,
     "amount": 620000,
     "from": 605000,
     "below": 635000
    },
    {
     "grade": 32,
     "amount": 650000,
     "from": 635000,
     "below": null
    }
   ]
  },
  {
   "from": "2027-09-01",
   "to": null,
   "rev": 2,
   "value": [
    {
     "grade": 1,
     "amount": 88000,
     "from": 0,
     "below": 93000
    },
    {
     "grade": 2,
     "amount": 98000,
     "from": 93000,
     "below": 101000
    },
    {
     "grade": 3,
     "amount": 104000,
     "from": 101000,
     "below": 107000
    },
    {
     "grade": 4,
     "amount": 110000,
     "from": 107000,
     "below": 114000
    },
    {
     "grade": 5,
     "amount": 118000,
     "from": 114000,
     "below": 122000
    },
    {
     "grade": 6,
     "amount": 126000,
     "from": 122000,
     "below": 130000
    },
    {
     "grade": 7,
     "amount": 134000,
     "from": 130000,
     "below": 138000
    },
    {
     "grade": 8,
     "amount": 142000,
     "from": 138000,
     "below": 146000
    },
    {
     "grade": 9,
     "amount": 150000,
     "from": 146000,
     "below": 155000
    },
    {
     "grade": 10,
     "amount": 160000,
     "from": 155000,
     "below": 165000
    },
    {
     "grade": 11,
     "amount": 170000,
     "from": 165000,
     "below": 175000
    },
    {
     "grade": 12,
     "amount": 180000,
     "from": 175000,
     "below": 185000
    },
    {
     "grade": 13,
     "amount": 190000,
     "from": 185000,
     "below": 195000
    },
    {
     "grade": 14,
     "amount": 200000,
     "from": 195000,
     "below": 210000
    },
    {
     "grade": 15,
     "amount": 220000,
     "from": 210000,
     "below": 230000
    },
    {
     "grade": 16,
     "amount": 240000,
     "from": 230000,
     "below": 250000
    },
    {
     "grade": 17,
     "amount": 260000,
     "from": 250000,
     "below": 270000
    },
    {
     "grade": 18,
     "amount": 280000,
     "from": 270000,
     "below": 290000
    },
    {
     "grade": 19,
     "amount": 300000,
     "from": 290000,
     "below": 310000
    },
    {
     "grade": 20,
     "amount": 320000,
     "from": 310000,
     "below": 330000
    },
    {
     "grade": 21,
     "amount": 340000,
     "from": 330000,
     "below": 350000
    },
    {
     "grade": 22,
     "amount": 360000,
     "from": 350000,
     "below": 370000
    },
    {
     "grade": 23,
     "amount": 380000,
     "from": 370000,
     "below": 395000
    },
    {
     "grade": 24,
     "amount": 410000,
     "from": 395000,
     "below": 425000
    },
    {
     "grade": 25,
     "amount": 440000,
     "from": 425000,
     "below": 455000
    },
    {
     "grade": 26,
     "amount": 470000,
     "from": 455000,
     "below": 485000
    },
    {
     "grade": 27,
     "amount": 500000,
     "from": 485000,
     "below": 515000
    },
    {
     "grade": 28,
     "amount": 530000,
     "from": 515000,
     "below": 545000
    },
    {
     "grade": 29,
     "amount": 560000,
     "from": 545000,
     "below": 575000
    },
    {
     "grade": 30,
     "amount": 590000,
     "from": 575000,
     "below": 605000
    },
    {
     "grade": 31,
     "amount": 620000,
     "from": 605000,
     "below": 635000
    },
    {
     "grade": 32,
     "amount": 650000,
     "from": 635000,
     "below": 665000
    },
    {
     "grade": 33,
     "amount": 680000,
     "from": 665000,
     "below": null
    }
   ]
  },
  {
   "from": "2028-09-01",
   "to": null,
   "rev": 3,
   "value": [
    {
     "grade": 1,
     "amount": 88000,
     "from": 0,
     "below": 93000
    },
    {
     "grade": 2,
     "amount": 98000,
     "from": 93000,
     "below": 101000
    },
    {
     "grade": 3,
     "amount": 104000,
     "from": 101000,
     "below": 107000
    },
    {
     "grade": 4,
     "amount": 110000,
     "from": 107000,
     "below": 114000
    },
    {
     "grade": 5,
     "amount": 118000,
     "from": 114000,
     "below": 122000
    },
    {
     "grade": 6,
     "amount": 126000,
     "from": 122000,
     "below": 130000
    },
    {
     "grade": 7,
     "amount": 134000,
     "from": 130000,
     "below": 138000
    },
    {
     "grade": 8,
     "amount": 142000,
     "from": 138000,
     "below": 146000
    },
    {
     "grade": 9,
     "amount": 150000,
     "from": 146000,
     "below": 155000
    },
    {
     "grade": 10,
     "amount": 160000,
     "from": 155000,
     "below": 165000
    },
    {
     "grade": 11,
     "amount": 170000,
     "from": 165000,
     "below": 175000
    },
    {
     "grade": 12,
     "amount": 180000,
     "from": 175000,
     "below": 185000
    },
    {
     "grade": 13,
     "amount": 190000,
     "from": 185000,
     "below": 195000
    },
    {
     "grade": 14,
     "amount": 200000,
     "from": 195000,
     "below": 210000
    },
    {
     "grade": 15,
     "amount": 220000,
     "from": 210000,
     "below": 230000
    },
    {
     "grade": 16,
     "amount": 240000,
     "from": 230000,
     "below": 250000
    },
    {
     "grade": 17,
     "amount": 260000,
     "from": 250000,
     "below": 270000
    },
    {
     "grade": 18,
     "amount": 280000,
     "from": 270000,
     "below": 290000
    },
    {
     "grade": 19,
     "amount": 300000,
     "from": 290000,
     "below": 310000
    },
    {
     "grade": 20,
     "amount": 320000,
     "from": 310000,
     "below": 330000
    },
    {
     "grade": 21,
     "amount": 340000,
     "from": 330000,
     "below": 350000
    },
    {
     "grade": 22,
     "amount": 360000,
     "from": 350000,
     "below": 370000
    },
    {
     "grade": 23,
     "amount": 380000,
     "from": 370000,
     "below": 395000
    },
    {
     "grade": 24,
     "amount": 410000,
     "from": 395000,
     "below": 425000
    },
    {
     "grade": 25,
     "amount": 440000,
     "from": 425000,
     "below": 455000
    },
    {
     "grade": 26,
     "amount": 470000,
     "from": 455000,
     "below": 485000
    },
    {
     "grade": 27,
     "amount": 500000,
     "from": 485000,
     "below": 515000
    },
    {
     "grade": 28,
     "amount": 530000,
     "from": 515000,
     "below": 545000
    },
    {
     "grade": 29,
     "amount": 560000,
     "from": 545000,
     "below": 575000
    },
    {
     "grade": 30,
     "amount": 590000,
     "from": 575000,
     "below": 605000
    },
    {
     "grade": 31,
     "amount": 620000,
     "from": 605000,
     "below": 635000
    },
    {
     "grade": 32,
     "amount": 650000,
     "from": 635000,
     "below": 665000
    },
    {
     "grade": 33,
     "amount": 680000,
     "from": 665000,
     "below": 695000
    },
    {
     "grade": 34,
     "amount": 710000,
     "from": 695000,
     "below": null
    }
   ]
  },
  {
   "from": "2029-09-01",
   "to": null,
   "rev": 4,
   "value": [
    {
     "grade": 1,
     "amount": 88000,
     "from": 0,
     "below": 93000
    },
    {
     "grade": 2,
     "amount": 98000,
     "from": 93000,
     "below": 101000
    },
    {
     "grade": 3,
     "amount": 104000,
     "from": 101000,
     "below": 107000
    },
    {
     "grade": 4,
     "amount": 110000,
     "from": 107000,
     "below": 114000
    },
    {
     "grade": 5,
     "amount": 118000,
     "from": 114000,
     "below": 122000
    },
    {
     "grade": 6,
     "amount": 126000,
     "from": 122000,
     "below": 130000
    },
    {
     "grade": 7,
     "amount": 134000,
     "from": 130000,
     "below": 138000
    },
    {
     "grade": 8,
     "amount": 142000,
     "from": 138000,
     "below": 146000
    },
    {
     "grade": 9,
     "amount": 150000,
     "from": 146000,
     "below": 155000
    },
    {
     "grade": 10,
     "amount": 160000,
     "from": 155000,
     "below": 165000
    },
    {
     "grade": 11,
     "amount": 170000,
     "from": 165000,
     "below": 175000
    },
    {
     "grade": 12,
     "amount": 180000,
     "from": 175000,
     "below": 185000
    },
    {
     "grade": 13,
     "amount": 190000,
     "from": 185000,
     "below": 195000
    },
    {
     "grade": 14,
     "amount": 200000,
     "from": 195000,
     "below": 210000
    },
    {
     "grade": 15,
     "amount": 220000,
     "from": 210000,
     "below": 230000
    },
    {
     "grade": 16,
     "amount": 240000,
     "from": 230000,
     "below": 250000
    },
    {
     "grade": 17,
     "amount": 260000,
     "from": 250000,
     "below": 270000
    },
    {
     "grade": 18,
     "amount": 280000,
     "from": 270000,
     "below": 290000
    },
    {
     "grade": 19,
     "amount": 300000,
     "from": 290000,
     "below": 310000
    },
    {
     "grade": 20,
     "amount": 320000,
     "from": 310000,
     "below": 330000
    },
    {
     "grade": 21,
     "amount": 340000,
     "from": 330000,
     "below": 350000
    },
    {
     "grade": 22,
     "amount": 360000,
     "from": 350000,
     "below": 370000
    },
    {
     "grade": 23,
     "amount": 380000,
     "from": 370000,
     "below": 395000
    },
    {
     "grade": 24,
     "amount": 410000,
     "from": 395000,
     "below": 425000
    },
    {
     "grade": 25,
     "amount": 440000,
     "from": 425000,
     "below": 455000
    },
    {
     "grade": 26,
     "amount": 470000,
     "from": 455000,
     "below": 485000
    },
    {
     "grade": 27,
     "amount": 500000,
     "from": 485000,
     "below": 515000
    },
    {
     "grade": 28,
     "amount": 530000,
     "from": 515000,
     "below": 545000
    },
    {
     "grade": 29,
     "amount": 560000,
     "from": 545000,
     "below": 575000
    },
    {
     "grade": 30,
     "amount": 590000,
     "from": 575000,
     "below": 605000
    },
    {
     "grade": 31,
     "amount": 620000,
     "from": 605000,
     "below": 635000
    },
    {
     "grade": 32,
     "amount": 650000,
     "from": 635000,
     "below": 665000
    },
    {
     "grade": 33,
     "amount": 680000,
     "from": 665000,
     "below": 695000
    },
    {
     "grade": 34,
     "amount": 710000,
     "from": 695000,
     "below": 730000
    },
    {
     "grade": 35,
     "amount": 750000,
     "from": 730000,
     "below": null
    }
   ]
  }
 ],
 "socialInsurance.dependent.incomeLimit": [
  {
   "from": "2025-04-01",
   "to": null,
   "rev": 1,
   "value": 1300000
  }
 ],
 "socialInsurance.dependent.incomeLimitElderly": [
  {
   "from": "2025-04-01",
   "to": null,
   "rev": 1,
   "value": 1800000
  }
 ],
 "socialInsurance.dependent.elderlyAge": [
  {
   "from": "2025-04-01",
   "to": null,
   "rev": 1,
   "value": 60
  }
 ],
 "socialInsurance.health.lateElderlyAge": [
  {
   "from": "2023-04-01",
   "to": "2024-12-31",
   "rev": 2,
   "value": 75
  },
  {
   "from": "2025-01-01",
   "to": null,
   "rev": 1,
   "value": 75
  }
 ],
 "incomeTax.dependentIncomeLimit": [
  {
   "from": "2025-01-01",
   "to": null,
   "rev": 1,
   "value": 580000
  },
  {
   "from": "2026-01-01",
   "to": null,
   "rev": 2,
   "value": 620000
  }
 ],
 "incomeTax.publicPensionDeduction.over65.tier1": [
  {
   "from": "2020-01-01",
   "to": null,
   "rev": 1,
   "value": [
    {
     "upTo": 3300000,
     "amount": 1100000
    },
    {
     "upTo": 4100000,
     "rate": "0.25",
     "amount": 275000
    },
    {
     "upTo": 7700000,
     "rate": "0.15",
     "amount": 685000
    },
    {
     "upTo": 10000000,
     "rate": "0.05",
     "amount": 1455000
    },
    {
     "upTo": null,
     "amount": 1955000
    }
   ]
  }
 ],
 "incomeTax.publicPensionDeduction.under65.tier1": [
  {
   "from": "2020-01-01",
   "to": null,
   "rev": 1,
   "value": [
    {
     "upTo": 1300000,
     "amount": 600000
    },
    {
     "upTo": 4100000,
     "rate": "0.25",
     "amount": 275000
    },
    {
     "upTo": 7700000,
     "rate": "0.15",
     "amount": 685000
    },
    {
     "upTo": 10000000,
     "rate": "0.05",
     "amount": 1455000
    },
    {
     "upTo": null,
     "amount": 1955000
    }
   ]
  }
 ],
 "incomeTax.publicPensionDeduction.elderlyAge": [
  {
   "from": "2020-01-01",
   "to": null,
   "rev": 1,
   "value": 65
  }
 ],
 "educationSupport.schoolLunch.elementary.public.monthly": [
  {
   "from": "2026-04-01",
   "to": null,
   "rev": 1,
   "value": 5200
  }
 ],
 "educationSupport.schoolLunch.months": [
  {
   "from": "2026-04-01",
   "to": null,
   "rev": 1,
   "value": 11
  }
 ],
 "educationSupport.nursery.fee.standard": [
  {
   "from": "2019-10-01",
   "to": null,
   "rev": 1,
   "value": [
    {
     "upTo": 48599,
     "amount": 19500
    },
    {
     "upTo": 96999,
     "amount": 30000
    },
    {
     "upTo": 168999,
     "amount": 44500
    },
    {
     "upTo": 300999,
     "amount": 61000
    },
    {
     "upTo": 396999,
     "amount": 80000
    },
    {
     "upTo": null,
     "amount": 104000
    }
   ]
  }
 ],
 "educationSupport.nursery.fee.short": [
  {
   "from": "2019-10-01",
   "to": null,
   "rev": 1,
   "value": [
    {
     "upTo": 48599,
     "amount": 19300
    },
    {
     "upTo": 96999,
     "amount": 29600
    },
    {
     "upTo": 168999,
     "amount": 43900
    },
    {
     "upTo": 300999,
     "amount": 60100
    },
    {
     "upTo": 396999,
     "amount": 78800
    },
    {
     "upTo": null,
     "amount": 102400
    }
   ]
  }
 ],
 "socialInsurance.health.kyokaikenpo.rate": [
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 95,
   "insurer": "kyokaikenpo.01",
   "value": "0.1021"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 96,
   "insurer": "kyokaikenpo.02",
   "value": "0.0949"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 97,
   "insurer": "kyokaikenpo.03",
   "value": "0.0963"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 98,
   "insurer": "kyokaikenpo.04",
   "value": "0.1001"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 99,
   "insurer": "kyokaikenpo.05",
   "value": "0.0985"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 100,
   "insurer": "kyokaikenpo.06",
   "value": "0.0984"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 101,
   "insurer": "kyokaikenpo.07",
   "value": "0.0959"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 102,
   "insurer": "kyokaikenpo.08",
   "value": "0.0966"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 103,
   "insurer": "kyokaikenpo.09",
   "value": "0.0979"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 104,
   "insurer": "kyokaikenpo.10",
   "value": "0.0981"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 105,
   "insurer": "kyokaikenpo.11",
   "value": "0.0978"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 106,
   "insurer": "kyokaikenpo.12",
   "value": "0.0977"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 107,
   "insurer": "kyokaikenpo.13",
   "value": "0.0998"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 108,
   "insurer": "kyokaikenpo.14",
   "value": "0.1002"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 109,
   "insurer": "kyokaikenpo.15",
   "value": "0.0935"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 110,
   "insurer": "kyokaikenpo.16",
   "value": "0.0962"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 111,
   "insurer": "kyokaikenpo.17",
   "value": "0.0994"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 112,
   "insurer": "kyokaikenpo.18",
   "value": "0.1007"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 113,
   "insurer": "kyokaikenpo.19",
   "value": "0.0994"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 114,
   "insurer": "kyokaikenpo.20",
   "value": "0.0955"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 115,
   "insurer": "kyokaikenpo.21",
   "value": "0.0991"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 116,
   "insurer": "kyokaikenpo.22",
   "value": "0.0985"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 117,
   "insurer": "kyokaikenpo.23",
   "value": "0.1002"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 118,
   "insurer": "kyokaikenpo.24",
   "value": "0.0994"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 119,
   "insurer": "kyokaikenpo.25",
   "value": "0.0989"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 120,
   "insurer": "kyokaikenpo.26",
   "value": "0.1013"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 121,
   "insurer": "kyokaikenpo.27",
   "value": "0.1034"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 122,
   "insurer": "kyokaikenpo.28",
   "value": "0.1018"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 123,
   "insurer": "kyokaikenpo.29",
   "value": "0.1022"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 124,
   "insurer": "kyokaikenpo.30",
   "value": "0.1000"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 125,
   "insurer": "kyokaikenpo.31",
   "value": "0.0968"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 126,
   "insurer": "kyokaikenpo.32",
   "value": "0.0992"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 127,
   "insurer": "kyokaikenpo.33",
   "value": "0.1002"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 128,
   "insurer": "kyokaikenpo.34",
   "value": "0.0995"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 129,
   "insurer": "kyokaikenpo.35",
   "value": "0.1020"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 130,
   "insurer": "kyokaikenpo.36",
   "value": "0.1019"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 131,
   "insurer": "kyokaikenpo.37",
   "value": "0.1033"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 132,
   "insurer": "kyokaikenpo.38",
   "value": "0.1003"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 133,
   "insurer": "kyokaikenpo.39",
   "value": "0.0989"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 134,
   "insurer": "kyokaikenpo.40",
   "value": "0.1035"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 135,
   "insurer": "kyokaikenpo.41",
   "value": "0.1042"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 136,
   "insurer": "kyokaikenpo.42",
   "value": "0.1017"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 137,
   "insurer": "kyokaikenpo.43",
   "value": "0.1030"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 138,
   "insurer": "kyokaikenpo.44",
   "value": "0.1025"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 139,
   "insurer": "kyokaikenpo.45",
   "value": "0.0985"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 140,
   "insurer": "kyokaikenpo.46",
   "value": "0.1013"
  },
  {
   "from": "2024-03-01",
   "to": null,
   "rev": 141,
   "insurer": "kyokaikenpo.47",
   "value": "0.0952"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 1,
   "insurer": "kyokaikenpo.01",
   "value": "0.1031"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 2,
   "insurer": "kyokaikenpo.02",
   "value": "0.0985"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 3,
   "insurer": "kyokaikenpo.03",
   "value": "0.0962"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 4,
   "insurer": "kyokaikenpo.04",
   "value": "0.1011"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 5,
   "insurer": "kyokaikenpo.05",
   "value": "0.1001"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 6,
   "insurer": "kyokaikenpo.06",
   "value": "0.0975"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 7,
   "insurer": "kyokaikenpo.07",
   "value": "0.0962"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 8,
   "insurer": "kyokaikenpo.08",
   "value": "0.0967"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 9,
   "insurer": "kyokaikenpo.09",
   "value": "0.0982"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 10,
   "insurer": "kyokaikenpo.10",
   "value": "0.0977"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 11,
   "insurer": "kyokaikenpo.11",
   "value": "0.0976"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 12,
   "insurer": "kyokaikenpo.12",
   "value": "0.0979"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 13,
   "insurer": "kyokaikenpo.13",
   "value": "0.0991"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 14,
   "insurer": "kyokaikenpo.14",
   "value": "0.0992"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 15,
   "insurer": "kyokaikenpo.15",
   "value": "0.0955"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 16,
   "insurer": "kyokaikenpo.16",
   "value": "0.0965"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 17,
   "insurer": "kyokaikenpo.17",
   "value": "0.0988"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 18,
   "insurer": "kyokaikenpo.18",
   "value": "0.0994"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 19,
   "insurer": "kyokaikenpo.19",
   "value": "0.0989"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 20,
   "insurer": "kyokaikenpo.20",
   "value": "0.0969"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 21,
   "insurer": "kyokaikenpo.21",
   "value": "0.0993"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 22,
   "insurer": "kyokaikenpo.22",
   "value": "0.098"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 23,
   "insurer": "kyokaikenpo.23",
   "value": "0.1003"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 24,
   "insurer": "kyokaikenpo.24",
   "value": "0.0999"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 25,
   "insurer": "kyokaikenpo.25",
   "value": "0.0997"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 26,
   "insurer": "kyokaikenpo.26",
   "value": "0.1003"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 27,
   "insurer": "kyokaikenpo.27",
   "value": "0.1024"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 28,
   "insurer": "kyokaikenpo.28",
   "value": "0.1016"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 29,
   "insurer": "kyokaikenpo.29",
   "value": "0.1002"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 30,
   "insurer": "kyokaikenpo.30",
   "value": "0.1019"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 31,
   "insurer": "kyokaikenpo.31",
   "value": "0.0993"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 32,
   "insurer": "kyokaikenpo.32",
   "value": "0.0994"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 33,
   "insurer": "kyokaikenpo.33",
   "value": "0.1017"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 34,
   "insurer": "kyokaikenpo.34",
   "value": "0.0997"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 35,
   "insurer": "kyokaikenpo.35",
   "value": "0.1036"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 36,
   "insurer": "kyokaikenpo.36",
   "value": "0.1047"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 37,
   "insurer": "kyokaikenpo.37",
   "value": "0.1021"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 38,
   "insurer": "kyokaikenpo.38",
   "value": "0.1018"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 39,
   "insurer": "kyokaikenpo.39",
   "value": "0.1013"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 40,
   "insurer": "kyokaikenpo.40",
   "value": "0.1031"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 41,
   "insurer": "kyokaikenpo.41",
   "value": "0.1078"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 42,
   "insurer": "kyokaikenpo.42",
   "value": "0.1041"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 43,
   "insurer": "kyokaikenpo.43",
   "value": "0.1012"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 44,
   "insurer": "kyokaikenpo.44",
   "value": "0.1025"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 45,
   "insurer": "kyokaikenpo.45",
   "value": "0.1009"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 46,
   "insurer": "kyokaikenpo.46",
   "value": "0.1031"
  },
  {
   "from": "2025-03-01",
   "to": null,
   "rev": 47,
   "insurer": "kyokaikenpo.47",
   "value": "0.0944"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 48,
   "insurer": "kyokaikenpo.01",
   "value": "0.1028"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 49,
   "insurer": "kyokaikenpo.02",
   "value": "0.0985"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 50,
   "insurer": "kyokaikenpo.03",
   "value": "0.0951"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 51,
   "insurer": "kyokaikenpo.04",
   "value": "0.101"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 52,
   "insurer": "kyokaikenpo.05",
   "value": "0.1001"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 53,
   "insurer": "kyokaikenpo.06",
   "value": "0.0975"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 54,
   "insurer": "kyokaikenpo.07",
   "value": "0.095"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 55,
   "insurer": "kyokaikenpo.08",
   "value": "0.0952"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 56,
   "insurer": "kyokaikenpo.09",
   "value": "0.0982"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 57,
   "insurer": "kyokaikenpo.10",
   "value": "0.0968"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 58,
   "insurer": "kyokaikenpo.11",
   "value": "0.0967"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 59,
   "insurer": "kyokaikenpo.12",
   "value": "0.0973"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 60,
   "insurer": "kyokaikenpo.13",
   "value": "0.0985"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 61,
   "insurer": "kyokaikenpo.14",
   "value": "0.0992"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 62,
   "insurer": "kyokaikenpo.15",
   "value": "0.0921"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 63,
   "insurer": "kyokaikenpo.16",
   "value": "0.0959"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 64,
   "insurer": "kyokaikenpo.17",
   "value": "0.097"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 65,
   "insurer": "kyokaikenpo.18",
   "value": "0.0971"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 66,
   "insurer": "kyokaikenpo.19",
   "value": "0.0955"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 67,
   "insurer": "kyokaikenpo.20",
   "value": "0.0963"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 68,
   "insurer": "kyokaikenpo.21",
   "value": "0.098"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 69,
   "insurer": "kyokaikenpo.22",
   "value": "0.0961"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 70,
   "insurer": "kyokaikenpo.23",
   "value": "0.0993"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 71,
   "insurer": "kyokaikenpo.24",
   "value": "0.0977"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 72,
   "insurer": "kyokaikenpo.25",
   "value": "0.0988"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 73,
   "insurer": "kyokaikenpo.26",
   "value": "0.0989"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 74,
   "insurer": "kyokaikenpo.27",
   "value": "0.1013"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 75,
   "insurer": "kyokaikenpo.28",
   "value": "0.1012"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 76,
   "insurer": "kyokaikenpo.29",
   "value": "0.0991"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 77,
   "insurer": "kyokaikenpo.30",
   "value": "0.1006"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 78,
   "insurer": "kyokaikenpo.31",
   "value": "0.0986"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 79,
   "insurer": "kyokaikenpo.32",
   "value": "0.0994"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 80,
   "insurer": "kyokaikenpo.33",
   "value": "0.1005"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 81,
   "insurer": "kyokaikenpo.34",
   "value": "0.0978"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 82,
   "insurer": "kyokaikenpo.35",
   "value": "0.1015"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 83,
   "insurer": "kyokaikenpo.36",
   "value": "0.1024"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 84,
   "insurer": "kyokaikenpo.37",
   "value": "0.1002"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 85,
   "insurer": "kyokaikenpo.38",
   "value": "0.0998"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 86,
   "insurer": "kyokaikenpo.39",
   "value": "0.1005"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 87,
   "insurer": "kyokaikenpo.40",
   "value": "0.1011"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 88,
   "insurer": "kyokaikenpo.41",
   "value": "0.1055"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 89,
   "insurer": "kyokaikenpo.42",
   "value": "0.1006"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 90,
   "insurer": "kyokaikenpo.43",
   "value": "0.1008"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 91,
   "insurer": "kyokaikenpo.44",
   "value": "0.1008"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 92,
   "insurer": "kyokaikenpo.45",
   "value": "0.0977"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 93,
   "insurer": "kyokaikenpo.46",
   "value": "0.1013"
  },
  {
   "from": "2026-03-01",
   "to": null,
   "rev": 94,
   "insurer": "kyokaikenpo.47",
   "value": "0.0944"
  }
 ]
};
