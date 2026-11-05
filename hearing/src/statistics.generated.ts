// 自動生成（hearing/scripts/statistics.ts。npm run statistics）。手で書き換えない。
// 正本は data/master（wageStats・retirementBenefit・living.statistics・education.statistics・care.statistics・housing.statistics・loanRates・lifeTable）と data/regulation の YAML（0007）。推定の目安の数の写し
import type { DatedValue, MasterValue } from "./statistics.ts";

export const MASTER_VALUES: Readonly<Record<string, MasterValue>> = {
 "wageStats.annualBonus.nonRegular.all": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年間賞与その他特別給与額（正社員・正職員以外・男女計・年齢計・企業規模計。民営事業所）",
  "value": 254800,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.annualBonus.regular.all": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年間賞与その他特別給与額（正社員・正職員・男女計・年齢計・企業規模計。民営事業所）",
  "value": 1148800,
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
 "wageStats.byAge.annualBonus.nonRegular.all.all": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別の年間賞与その他特別給与額（正社員・正職員以外・男女計・企業規模計（10人以上）。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 16300
   },
   {
    "upTo": 24,
    "amount": 57400
   },
   {
    "upTo": 29,
    "amount": 92000
   },
   {
    "upTo": 34,
    "amount": 122300
   },
   {
    "upTo": 39,
    "amount": 128500
   },
   {
    "upTo": 44,
    "amount": 151700
   },
   {
    "upTo": 49,
    "amount": 170000
   },
   {
    "upTo": 54,
    "amount": 156900
   },
   {
    "upTo": 59,
    "amount": 160300
   },
   {
    "upTo": 64,
    "amount": 615200
   },
   {
    "upTo": 69,
    "amount": 290300
   },
   {
    "upTo": null,
    "amount": 141800
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.annualBonus.nonRegular.all.large": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別の年間賞与その他特別給与額（正社員・正職員以外・男女計・1,000人以上。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 11200
   },
   {
    "upTo": 24,
    "amount": 58300
   },
   {
    "upTo": 29,
    "amount": 92700
   },
   {
    "upTo": 34,
    "amount": 117600
   },
   {
    "upTo": 39,
    "amount": 125500
   },
   {
    "upTo": 44,
    "amount": 149400
   },
   {
    "upTo": 49,
    "amount": 172100
   },
   {
    "upTo": 54,
    "amount": 162600
   },
   {
    "upTo": 59,
    "amount": 164700
   },
   {
    "upTo": 64,
    "amount": 750600
   },
   {
    "upTo": 69,
    "amount": 308400
   },
   {
    "upTo": null,
    "amount": 139400
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.annualBonus.nonRegular.all.medium": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別の年間賞与その他特別給与額（正社員・正職員以外・男女計・100～999人。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 21600
   },
   {
    "upTo": 24,
    "amount": 51300
   },
   {
    "upTo": 29,
    "amount": 93600
   },
   {
    "upTo": 34,
    "amount": 120000
   },
   {
    "upTo": 39,
    "amount": 123600
   },
   {
    "upTo": 44,
    "amount": 147200
   },
   {
    "upTo": 49,
    "amount": 157400
   },
   {
    "upTo": 54,
    "amount": 146600
   },
   {
    "upTo": 59,
    "amount": 160100
   },
   {
    "upTo": 64,
    "amount": 581300
   },
   {
    "upTo": 69,
    "amount": 282900
   },
   {
    "upTo": null,
    "amount": 134600
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.annualBonus.nonRegular.all.small": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別の年間賞与その他特別給与額（正社員・正職員以外・男女計・10～99人。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 13200
   },
   {
    "upTo": 24,
    "amount": 67400
   },
   {
    "upTo": 29,
    "amount": 86900
   },
   {
    "upTo": 34,
    "amount": 138700
   },
   {
    "upTo": 39,
    "amount": 146100
   },
   {
    "upTo": 44,
    "amount": 166100
   },
   {
    "upTo": 49,
    "amount": 189700
   },
   {
    "upTo": 54,
    "amount": 162500
   },
   {
    "upTo": 59,
    "amount": 151000
   },
   {
    "upTo": 64,
    "amount": 402300
   },
   {
    "upTo": 69,
    "amount": 280900
   },
   {
    "upTo": null,
    "amount": 153700
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.annualBonus.regular.all.all": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別の年間賞与その他特別給与額（正社員・正職員・男女計・企業規模計（10人以上）。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 164700
   },
   {
    "upTo": 24,
    "amount": 454500
   },
   {
    "upTo": 29,
    "amount": 795400
   },
   {
    "upTo": 34,
    "amount": 980700
   },
   {
    "upTo": 39,
    "amount": 1146600
   },
   {
    "upTo": 44,
    "amount": 1278700
   },
   {
    "upTo": 49,
    "amount": 1352900
   },
   {
    "upTo": 54,
    "amount": 1490600
   },
   {
    "upTo": 59,
    "amount": 1530700
   },
   {
    "upTo": 64,
    "amount": 1045400
   },
   {
    "upTo": 69,
    "amount": 559600
   },
   {
    "upTo": null,
    "amount": 399700
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.annualBonus.regular.all.large": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別の年間賞与その他特別給与額（正社員・正職員・男女計・1,000人以上。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 215800
   },
   {
    "upTo": 24,
    "amount": 534100
   },
   {
    "upTo": 29,
    "amount": 1014200
   },
   {
    "upTo": 34,
    "amount": 1296200
   },
   {
    "upTo": 39,
    "amount": 1568100
   },
   {
    "upTo": 44,
    "amount": 1854700
   },
   {
    "upTo": 49,
    "amount": 1988300
   },
   {
    "upTo": 54,
    "amount": 2245900
   },
   {
    "upTo": 59,
    "amount": 2366200
   },
   {
    "upTo": 64,
    "amount": 1712900
   },
   {
    "upTo": 69,
    "amount": 1053500
   },
   {
    "upTo": null,
    "amount": 769700
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.annualBonus.regular.all.medium": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別の年間賞与その他特別給与額（正社員・正職員・男女計・100～999人。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 145000
   },
   {
    "upTo": 24,
    "amount": 447900
   },
   {
    "upTo": 29,
    "amount": 747700
   },
   {
    "upTo": 34,
    "amount": 926800
   },
   {
    "upTo": 39,
    "amount": 1050500
   },
   {
    "upTo": 44,
    "amount": 1148100
   },
   {
    "upTo": 49,
    "amount": 1246500
   },
   {
    "upTo": 54,
    "amount": 1364300
   },
   {
    "upTo": 59,
    "amount": 1357600
   },
   {
    "upTo": 64,
    "amount": 994900
   },
   {
    "upTo": 69,
    "amount": 606700
   },
   {
    "upTo": null,
    "amount": 363400
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.annualBonus.regular.all.small": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別の年間賞与その他特別給与額（正社員・正職員・男女計・10～99人。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 114300
   },
   {
    "upTo": 24,
    "amount": 338000
   },
   {
    "upTo": 29,
    "amount": 537600
   },
   {
    "upTo": 34,
    "amount": 648800
   },
   {
    "upTo": 39,
    "amount": 745400
   },
   {
    "upTo": 44,
    "amount": 794600
   },
   {
    "upTo": 49,
    "amount": 837000
   },
   {
    "upTo": 54,
    "amount": 846700
   },
   {
    "upTo": 59,
    "amount": 802900
   },
   {
    "upTo": 64,
    "amount": 674400
   },
   {
    "upTo": 69,
    "amount": 447700
   },
   {
    "upTo": null,
    "amount": 373800
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.contractualMonthly.nonRegular.all.all": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別のきまって支給する現金給与額（月額）（正社員・正職員以外・男女計・企業規模計（10人以上）。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 206900
   },
   {
    "upTo": 24,
    "amount": 225500
   },
   {
    "upTo": 29,
    "amount": 254700
   },
   {
    "upTo": 34,
    "amount": 256900
   },
   {
    "upTo": 39,
    "amount": 248500
   },
   {
    "upTo": 44,
    "amount": 247100
   },
   {
    "upTo": 49,
    "amount": 250000
   },
   {
    "upTo": 54,
    "amount": 245500
   },
   {
    "upTo": 59,
    "amount": 248000
   },
   {
    "upTo": 64,
    "amount": 298600
   },
   {
    "upTo": 69,
    "amount": 263900
   },
   {
    "upTo": null,
    "amount": 239200
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.contractualMonthly.nonRegular.all.large": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別のきまって支給する現金給与額（月額）（正社員・正職員以外・男女計・1,000人以上。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 214800
   },
   {
    "upTo": 24,
    "amount": 236500
   },
   {
    "upTo": 29,
    "amount": 276400
   },
   {
    "upTo": 34,
    "amount": 272000
   },
   {
    "upTo": 39,
    "amount": 262600
   },
   {
    "upTo": 44,
    "amount": 260900
   },
   {
    "upTo": 49,
    "amount": 260100
   },
   {
    "upTo": 54,
    "amount": 252900
   },
   {
    "upTo": 59,
    "amount": 258700
   },
   {
    "upTo": 64,
    "amount": 315600
   },
   {
    "upTo": 69,
    "amount": 273100
   },
   {
    "upTo": null,
    "amount": 266300
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.contractualMonthly.nonRegular.all.medium": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別のきまって支給する現金給与額（月額）（正社員・正職員以外・男女計・100～999人。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 209400
   },
   {
    "upTo": 24,
    "amount": 225900
   },
   {
    "upTo": 29,
    "amount": 245500
   },
   {
    "upTo": 34,
    "amount": 249100
   },
   {
    "upTo": 39,
    "amount": 243000
   },
   {
    "upTo": 44,
    "amount": 239700
   },
   {
    "upTo": 49,
    "amount": 245900
   },
   {
    "upTo": 54,
    "amount": 240800
   },
   {
    "upTo": 59,
    "amount": 241400
   },
   {
    "upTo": 64,
    "amount": 294700
   },
   {
    "upTo": 69,
    "amount": 265500
   },
   {
    "upTo": null,
    "amount": 239200
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.contractualMonthly.nonRegular.all.small": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別のきまって支給する現金給与額（月額）（正社員・正職員以外・男女計・10～99人。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 192700
   },
   {
    "upTo": 24,
    "amount": 207300
   },
   {
    "upTo": 29,
    "amount": 224800
   },
   {
    "upTo": 34,
    "amount": 238100
   },
   {
    "upTo": 39,
    "amount": 228700
   },
   {
    "upTo": 44,
    "amount": 231200
   },
   {
    "upTo": 49,
    "amount": 234700
   },
   {
    "upTo": 54,
    "amount": 237000
   },
   {
    "upTo": 59,
    "amount": 237000
   },
   {
    "upTo": 64,
    "amount": 271000
   },
   {
    "upTo": 69,
    "amount": 250100
   },
   {
    "upTo": null,
    "amount": 220000
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.contractualMonthly.regular.all.all": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別のきまって支給する現金給与額（月額）（正社員・正職員・男女計・企業規模計（10人以上）。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 227300
   },
   {
    "upTo": 24,
    "amount": 271800
   },
   {
    "upTo": 29,
    "amount": 319100
   },
   {
    "upTo": 34,
    "amount": 358400
   },
   {
    "upTo": 39,
    "amount": 390700
   },
   {
    "upTo": 44,
    "amount": 414900
   },
   {
    "upTo": 49,
    "amount": 428900
   },
   {
    "upTo": 54,
    "amount": 444500
   },
   {
    "upTo": 59,
    "amount": 453700
   },
   {
    "upTo": 64,
    "amount": 388500
   },
   {
    "upTo": 69,
    "amount": 343300
   },
   {
    "upTo": null,
    "amount": 310900
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.contractualMonthly.regular.all.large": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別のきまって支給する現金給与額（月額）（正社員・正職員・男女計・1,000人以上。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 242800
   },
   {
    "upTo": 24,
    "amount": 295700
   },
   {
    "upTo": 29,
    "amount": 355700
   },
   {
    "upTo": 34,
    "amount": 409800
   },
   {
    "upTo": 39,
    "amount": 457100
   },
   {
    "upTo": 44,
    "amount": 494300
   },
   {
    "upTo": 49,
    "amount": 516700
   },
   {
    "upTo": 54,
    "amount": 532300
   },
   {
    "upTo": 59,
    "amount": 549500
   },
   {
    "upTo": 64,
    "amount": 455700
   },
   {
    "upTo": 69,
    "amount": 432300
   },
   {
    "upTo": null,
    "amount": 465900
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.contractualMonthly.regular.all.medium": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別のきまって支給する現金給与額（月額）（正社員・正職員・男女計・100～999人。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 219700
   },
   {
    "upTo": 24,
    "amount": 264500
   },
   {
    "upTo": 29,
    "amount": 306800
   },
   {
    "upTo": 34,
    "amount": 343800
   },
   {
    "upTo": 39,
    "amount": 369900
   },
   {
    "upTo": 44,
    "amount": 395500
   },
   {
    "upTo": 49,
    "amount": 411500
   },
   {
    "upTo": 54,
    "amount": 429800
   },
   {
    "upTo": 59,
    "amount": 434900
   },
   {
    "upTo": 64,
    "amount": 383600
   },
   {
    "upTo": 69,
    "amount": 371300
   },
   {
    "upTo": null,
    "amount": 330300
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.byAge.contractualMonthly.regular.all.small": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の年齢階級別のきまって支給する現金給与額（月額）（正社員・正職員・男女計・10～99人。民営事業所。upTo は年齢階級の上限の年齢）",
  "value": [
   {
    "upTo": 19,
    "amount": 215100
   },
   {
    "upTo": 24,
    "amount": 245000
   },
   {
    "upTo": 29,
    "amount": 282300
   },
   {
    "upTo": 34,
    "amount": 312100
   },
   {
    "upTo": 39,
    "amount": 334700
   },
   {
    "upTo": 44,
    "amount": 349800
   },
   {
    "upTo": 49,
    "amount": 361000
   },
   {
    "upTo": 54,
    "amount": 369700
   },
   {
    "upTo": 59,
    "amount": 369100
   },
   {
    "upTo": 64,
    "amount": 351200
   },
   {
    "upTo": 69,
    "amount": 315100
   },
   {
    "upTo": null,
    "amount": 291400
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
 "wageStats.contractualMonthly.nonRegular.all": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者のきまって支給する現金給与額（月額）（正社員・正職員以外・男女計・年齢計・企業規模計。民営事業所）",
  "value": 259500,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.contractualMonthly.regular.all": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者のきまって支給する現金給与額（月額）（正社員・正職員・男女計・年齢計・企業規模計。民営事業所）",
  "value": 390900,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.curve.nonRegular.all.all.all": {
  "title": "昇給カーブの係数（賃金構造基本統計調査 令和7年。正社員・正職員以外・男女計・学歴計・企業規模計（10人以上）の年齢階級ごとの年収〔きまって支給する現金給与額×12＋年間賞与その他特別給与額〕を、～19歳を1とした比。60歳以後は55～59歳の係数のまま。upTo が年齢、rate が係数）",
  "value": [
   {
    "upTo": 19,
    "rate": "1.0000"
   },
   {
    "upTo": 24,
    "rate": "1.1058"
   },
   {
    "upTo": 29,
    "rate": "1.2598"
   },
   {
    "upTo": 34,
    "rate": "1.2825"
   },
   {
    "upTo": 39,
    "rate": "1.2446"
   },
   {
    "upTo": 44,
    "rate": "1.2472"
   },
   {
    "upTo": 49,
    "rate": "1.2685"
   },
   {
    "upTo": 54,
    "rate": "1.2416"
   },
   {
    "upTo": 59,
    "rate": "1.2550"
   },
   {
    "upTo": 64,
    "rate": "1.2550"
   },
   {
    "upTo": 69,
    "rate": "1.2550"
   },
   {
    "upTo": null,
    "rate": "1.2550"
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.curve.nonRegular.all.all.large": {
  "title": "昇給カーブの係数（賃金構造基本統計調査 令和7年。正社員・正職員以外・男女計・学歴計・1,000人以上の年齢階級ごとの年収〔きまって支給する現金給与額×12＋年間賞与その他特別給与額〕を、～19歳を1とした比。60歳以後は55～59歳の係数のまま。upTo が年齢、rate が係数）",
  "value": [
   {
    "upTo": 19,
    "rate": "1.0000"
   },
   {
    "upTo": 24,
    "rate": "1.1188"
   },
   {
    "upTo": 29,
    "rate": "1.3170"
   },
   {
    "upTo": 34,
    "rate": "1.3062"
   },
   {
    "upTo": 39,
    "rate": "1.2657"
   },
   {
    "upTo": 44,
    "rate": "1.2671"
   },
   {
    "upTo": 49,
    "rate": "1.2721"
   },
   {
    "upTo": 54,
    "rate": "1.2351"
   },
   {
    "upTo": 59,
    "rate": "1.2628"
   },
   {
    "upTo": 64,
    "rate": "1.2628"
   },
   {
    "upTo": 69,
    "rate": "1.2628"
   },
   {
    "upTo": null,
    "rate": "1.2628"
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.curve.nonRegular.all.all.medium": {
  "title": "昇給カーブの係数（賃金構造基本統計調査 令和7年。正社員・正職員以外・男女計・学歴計・100～999人の年齢階級ごとの年収〔きまって支給する現金給与額×12＋年間賞与その他特別給与額〕を、～19歳を1とした比。60歳以後は55～59歳の係数のまま。upTo が年齢、rate が係数）",
  "value": [
   {
    "upTo": 19,
    "rate": "1.0000"
   },
   {
    "upTo": 24,
    "rate": "1.0898"
   },
   {
    "upTo": 29,
    "rate": "1.1993"
   },
   {
    "upTo": 34,
    "rate": "1.2268"
   },
   {
    "upTo": 39,
    "rate": "1.1993"
   },
   {
    "upTo": 44,
    "rate": "1.1930"
   },
   {
    "upTo": 49,
    "rate": "1.2264"
   },
   {
    "upTo": 54,
    "rate": "1.1980"
   },
   {
    "upTo": 59,
    "rate": "1.2062"
   },
   {
    "upTo": 64,
    "rate": "1.2062"
   },
   {
    "upTo": 69,
    "rate": "1.2062"
   },
   {
    "upTo": null,
    "rate": "1.2062"
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.curve.nonRegular.all.all.small": {
  "title": "昇給カーブの係数（賃金構造基本統計調査 令和7年。正社員・正職員以外・男女計・学歴計・10～99人の年齢階級ごとの年収〔きまって支給する現金給与額×12＋年間賞与その他特別給与額〕を、～19歳を1とした比。60歳以後は55～59歳の係数のまま。upTo が年齢、rate が係数）",
  "value": [
   {
    "upTo": 19,
    "rate": "1.0000"
   },
   {
    "upTo": 24,
    "rate": "1.0986"
   },
   {
    "upTo": 29,
    "rate": "1.1973"
   },
   {
    "upTo": 34,
    "rate": "1.2882"
   },
   {
    "upTo": 39,
    "rate": "1.2429"
   },
   {
    "upTo": 44,
    "rate": "1.2644"
   },
   {
    "upTo": 49,
    "rate": "1.2926"
   },
   {
    "upTo": 54,
    "rate": "1.2928"
   },
   {
    "upTo": 59,
    "rate": "1.2878"
   },
   {
    "upTo": 64,
    "rate": "1.2878"
   },
   {
    "upTo": 69,
    "rate": "1.2878"
   },
   {
    "upTo": null,
    "rate": "1.2878"
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.curve.regular.all.all.all": {
  "title": "昇給カーブの係数（賃金構造基本統計調査 令和7年。正社員・正職員・男女計・学歴計・企業規模計（10人以上）の年齢階級ごとの年収〔きまって支給する現金給与額×12＋年間賞与その他特別給与額〕を、～19歳を1とした比。60歳以後は55～59歳の係数のまま。upTo が年齢、rate が係数）",
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
    "rate": "2.4116"
   },
   {
    "upTo": 69,
    "rate": "2.4116"
   },
   {
    "upTo": null,
    "rate": "2.4116"
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.curve.regular.all.all.large": {
  "title": "昇給カーブの係数（賃金構造基本統計調査 令和7年。正社員・正職員・男女計・学歴計・1,000人以上の年齢階級ごとの年収〔きまって支給する現金給与額×12＋年間賞与その他特別給与額〕を、～19歳を1とした比。60歳以後は55～59歳の係数のまま。upTo が年齢、rate が係数）",
  "value": [
   {
    "upTo": 19,
    "rate": "1.0000"
   },
   {
    "upTo": 24,
    "rate": "1.3046"
   },
   {
    "upTo": 29,
    "rate": "1.6881"
   },
   {
    "upTo": 34,
    "rate": "1.9856"
   },
   {
    "upTo": 39,
    "rate": "2.2539"
   },
   {
    "upTo": 44,
    "rate": "2.4881"
   },
   {
    "upTo": 49,
    "rate": "2.6167"
   },
   {
    "upTo": 54,
    "rate": "2.7588"
   },
   {
    "upTo": 59,
    "rate": "2.8632"
   },
   {
    "upTo": 64,
    "rate": "2.8632"
   },
   {
    "upTo": 69,
    "rate": "2.8632"
   },
   {
    "upTo": null,
    "rate": "2.8632"
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.curve.regular.all.all.medium": {
  "title": "昇給カーブの係数（賃金構造基本統計調査 令和7年。正社員・正職員・男女計・学歴計・100～999人の年齢階級ごとの年収〔きまって支給する現金給与額×12＋年間賞与その他特別給与額〕を、～19歳を1とした比。60歳以後は55～59歳の係数のまま。upTo が年齢、rate が係数）",
  "value": [
   {
    "upTo": 19,
    "rate": "1.0000"
   },
   {
    "upTo": 24,
    "rate": "1.3022"
   },
   {
    "upTo": 29,
    "rate": "1.5925"
   },
   {
    "upTo": 34,
    "rate": "1.8165"
   },
   {
    "upTo": 39,
    "rate": "1.9736"
   },
   {
    "upTo": 44,
    "rate": "2.1191"
   },
   {
    "upTo": 49,
    "rate": "2.2235"
   },
   {
    "upTo": 54,
    "rate": "2.3448"
   },
   {
    "upTo": 59,
    "rate": "2.3644"
   },
   {
    "upTo": 64,
    "rate": "2.3644"
   },
   {
    "upTo": 69,
    "rate": "2.3644"
   },
   {
    "upTo": null,
    "rate": "2.3644"
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.curve.regular.all.all.small": {
  "title": "昇給カーブの係数（賃金構造基本統計調査 令和7年。正社員・正職員・男女計・学歴計・10～99人の年齢階級ごとの年収〔きまって支給する現金給与額×12＋年間賞与その他特別給与額〕を、～19歳を1とした比。60歳以後は55～59歳の係数のまま。upTo が年齢、rate が係数）",
  "value": [
   {
    "upTo": 19,
    "rate": "1.0000"
   },
   {
    "upTo": 24,
    "rate": "1.2161"
   },
   {
    "upTo": 29,
    "rate": "1.4562"
   },
   {
    "upTo": 34,
    "rate": "1.6301"
   },
   {
    "upTo": 39,
    "rate": "1.7666"
   },
   {
    "upTo": 44,
    "rate": "1.8520"
   },
   {
    "upTo": 49,
    "rate": "1.9176"
   },
   {
    "upTo": 54,
    "rate": "1.9600"
   },
   {
    "upTo": 59,
    "rate": "1.9410"
   },
   {
    "upTo": 64,
    "rate": "1.9410"
   },
   {
    "upTo": 69,
    "rate": "1.9410"
   },
   {
    "upTo": null,
    "rate": "1.9410"
   }
  ],
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
 "wageStats.partTimeHourly.all": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 短時間労働者の1時間当たり所定内給与額（男女計・年齢計・企業規模計。常用労働者計）",
  "value": 1518,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.scheduledMonthly.nonRegular.all": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の所定内給与額（月額）（正社員・正職員以外・男女計・年齢計・企業規模計。民営事業所）",
  "value": 241700,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.scheduledMonthly.regular.all": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の所定内給与額（月額）（正社員・正職員・男女計・年齢計・企業規模計。民営事業所）",
  "value": 358800,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "retirementBenefit.company.all": {
  "title": "就労条件総合調査（厚生労働省）令和5年 会社都合退職者1人平均退職給付額（勤続20年以上かつ45歳以上・学歴を分けない値〔公表の3つの区分の単純な平均〕。一時金と年金の現価の計）",
  "value": 12870000,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "retirementBenefit.earlyIncentive.all": {
  "title": "就労条件総合調査（厚生労働省）令和5年 早期優遇退職者1人平均退職給付額（勤続20年以上かつ45歳以上・学歴を分けない値〔公表の3つの区分の単純な平均〕。一時金と年金の現価の計）",
  "value": 22810000,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "retirementBenefit.mandatory.all.byService": {
  "title": "就労条件総合調査（厚生労働省）令和5年 定年退職者1人平均退職給付額の勤続年数階級別（勤続20年以上かつ45歳以上・学歴を分けない値〔公表の3つの区分の単純な平均〕・退職給付制度計。upTo は勤続年数の上限。20年未満の段は値なし）",
  "value": [
   {
    "upTo": 19
   },
   {
    "upTo": 24,
    "amount": 6610000
   },
   {
    "upTo": 29,
    "amount": 9110000
   },
   {
    "upTo": 34,
    "amount": 12620000
   },
   {
    "upTo": null,
    "amount": 18060000
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "retirementBenefit.mandatory.all": {
  "title": "就労条件総合調査（厚生労働省）令和5年 定年退職者1人平均退職給付額（勤続20年以上かつ45歳以上・学歴を分けない値〔公表の3つの区分の単純な平均〕。一時金と年金の現価の計）",
  "value": 15870000,
  "rev": 1,
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
 "retirementBenefit.smallFirm.company.all": {
  "title": "中小企業の賃金・退職金事情（東京都産業労働局）令和6年版 第8表 モデル退職金の会社都合退職の退職金支給額（学歴を分けない値〔公表の3つの区分を記入企業数で重み付けした平均〕・調査産業計。従業員10〜299人の都内の中小企業。upTo は勤続年数の上限。各段は表の勤続年数〔1・3・5・10・15・20・25・30年と55歳の時点〕の額を次の勤続年数の前の年まで当てる）",
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
    "amount": 285000
   },
   {
    "upTo": 9,
    "amount": 537000
   },
   {
    "upTo": 14,
    "amount": 1410000
   },
   {
    "upTo": 19,
    "amount": 2412000
   },
   {
    "upTo": 24,
    "amount": 3718000
   },
   {
    "upTo": 29,
    "amount": 5495000
   },
   {
    "upTo": 32,
    "amount": 7035000
   },
   {
    "upTo": null,
    "amount": 8519000
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "retirementBenefit.smallFirm.voluntary.all": {
  "title": "中小企業の賃金・退職金事情（東京都産業労働局）令和6年版 第8表 モデル退職金の自己都合退職の退職金支給額（学歴を分けない値〔公表の3つの区分を記入企業数で重み付けした平均〕・調査産業計。従業員10〜299人の都内の中小企業。upTo は勤続年数の上限。各段は表の勤続年数〔1・3・5・10・15・20・25・30年と55歳の時点〕の額を次の勤続年数の前の年まで当てる）",
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
    "amount": 207000
   },
   {
    "upTo": 9,
    "amount": 413000
   },
   {
    "upTo": 14,
    "amount": 1048000
   },
   {
    "upTo": 19,
    "amount": 1961000
   },
   {
    "upTo": 24,
    "amount": 3146000
   },
   {
    "upTo": 29,
    "amount": 4624000
   },
   {
    "upTo": 32,
    "amount": 6433000
   },
   {
    "upTo": null,
    "amount": 7558000
   }
  ],
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "retirementBenefit.voluntary.all": {
  "title": "就労条件総合調査（厚生労働省）令和5年 自己都合退職者1人平均退職給付額（勤続20年以上かつ45歳以上・学歴を分けない値〔公表の3つの区分の単純な平均〕。一時金と年金の現価の計）",
  "value": 12140000,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "living.statistics.basicMonthly": {
  "title": "家計調査（総務省）2025年 二人以上の世帯の世帯人員別の1か月の消費支出から、住居・教育・自動車等関係費と、ほかの入力項目で入れる物（家庭用耐久財・仕送り金・学校給食・掛け捨ての保険料・月謝・共益費など）を除いた額（upTo は世帯人員。1人の段は値なし〔単身世帯はこの表に無い〕、最後の段は6人以上）",
  "value": [
   {
    "upTo": 1
   },
   {
    "upTo": 2,
    "amount": 208847
   },
   {
    "upTo": 3,
    "amount": 231261
   },
   {
    "upTo": 4,
    "amount": 245354
   },
   {
    "upTo": 5,
    "amount": 250637
   },
   {
    "upTo": null,
    "amount": 272579
   }
  ],
  "rev": 4,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "living.statistics.categoryMonthly.clothing": {
  "title": "家計調査（総務省）2025年 二人以上の世帯の世帯人員別の1か月の被服及び履物と理美容サービス・理美容用品の合計（基本生活費の費目の割合の目安。upTo は世帯人員。1人の段は値なし〔単身世帯はこの表に無い〕、最後の段は6人以上）",
  "value": [
   {
    "upTo": 1
   },
   {
    "upTo": 2,
    "amount": 15125
   },
   {
    "upTo": 3,
    "amount": 19004
   },
   {
    "upTo": 4,
    "amount": 23591
   },
   {
    "upTo": 5,
    "amount": 24639
   },
   {
    "upTo": null,
    "amount": 24955
   }
  ],
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "living.statistics.categoryMonthly.communication": {
  "title": "家計調査（総務省）2025年 二人以上の世帯の世帯人員別の1か月の通信と、インターネット接続料（品目分類の全国の月平均）の合計から、携帯電話機（品目分類の全国の月平均）を除いた額（基本生活費の費目の割合の目安。スマホ本体の買い替えは年払い・数年おきの暮らしの支出で入れる。upTo は世帯人員。1人の段は値なし〔単身世帯はこの表に無い〕、最後の段は6人以上）",
  "value": [
   {
    "upTo": 1
   },
   {
    "upTo": 2,
    "amount": 12311
   },
   {
    "upTo": 3,
    "amount": 14648
   },
   {
    "upTo": 4,
    "amount": 15538
   },
   {
    "upTo": 5,
    "amount": 16532
   },
   {
    "upTo": null,
    "amount": 19273
   }
  ],
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "living.statistics.categoryMonthly.food": {
  "title": "家計調査（総務省）2025年 二人以上の世帯の世帯人員別の1か月の食料から、学校給食を除いた額（基本生活費の費目の割合の目安。学校給食は子ども・教育の入力項目の推定に入る。upTo は世帯人員。1人の段は値なし〔単身世帯はこの表に無い〕、最後の段は6人以上）",
  "value": [
   {
    "upTo": 1
   },
   {
    "upTo": 2,
    "amount": 79331
   },
   {
    "upTo": 3,
    "amount": 91878
   },
   {
    "upTo": 4,
    "amount": 101729
   },
   {
    "upTo": 5,
    "amount": 109481
   },
   {
    "upTo": null,
    "amount": 120518
   }
  ],
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "living.statistics.categoryMonthly.furniture": {
  "title": "家計調査（総務省）2025年 二人以上の世帯の世帯人員別の1か月の家具・家事用品から家庭用耐久財を除いた額（基本生活費の費目の割合の目安。upTo は世帯人員。1人の段は値なし〔単身世帯はこの表に無い〕、最後の段は6人以上）",
  "value": [
   {
    "upTo": 1
   },
   {
    "upTo": 2,
    "amount": 7503
   },
   {
    "upTo": 3,
    "amount": 8891
   },
   {
    "upTo": 4,
    "amount": 9760
   },
   {
    "upTo": 5,
    "amount": 10641
   },
   {
    "upTo": null,
    "amount": 10652
   }
  ],
  "rev": 2,
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
 "living.statistics.categoryMonthly.other": {
  "title": "家計調査（総務省）2025年 二人以上の世帯の世帯人員別の1か月のその他の消費支出から、理美容サービス・理美容用品・こづかい（使途不明）・交際費・仕送り金と、医療保険料・他の非貯蓄型保険料・保育費用・介護サービス・婚礼関係費・葬儀関係費・祭具・墓石（品目分類の全国の月平均）を除いた額（基本生活費の費目の割合の目安。保険料・保育料・介護の費用・結婚と葬儀とお墓は、それぞれの入力項目で入れる。upTo は世帯人員。1人の段は値なし〔単身世帯はこの表に無い〕、最後の段は6人以上）",
  "value": [
   {
    "upTo": 1
   },
   {
    "upTo": 2,
    "amount": 5565
   },
   {
    "upTo": 3,
    "amount": 7934
   },
   {
    "upTo": 4,
    "amount": 6944
   },
   {
    "upTo": 5,
    "amount": 5269
   },
   {
    "upTo": null,
    "amount": 6007
   }
  ],
  "rev": 2,
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
 "living.statistics.categoryMonthly.pocketAndSocial": {
  "title": "家計調査（総務省）2025年 二人以上の世帯の世帯人員別の1か月のこづかい（使途不明）と交際費の合計から、住宅関係負担費（品目分類の全国の月平均。共益費・住宅組合費など）を除いた額（基本生活費の費目の割合の目安。集合住宅の共益費・管理費は住まい・ローンの入力項目で入れる。upTo は世帯人員。1人の段は値なし〔単身世帯はこの表に無い〕、最後の段は6人以上）",
  "value": [
   {
    "upTo": 1
   },
   {
    "upTo": 2,
    "amount": 24303
   },
   {
    "upTo": 3,
    "amount": 19581
   },
   {
    "upTo": 4,
    "amount": 15841
   },
   {
    "upTo": 5,
    "amount": 13354
   },
   {
    "upTo": null,
    "amount": 16532
   }
  ],
  "rev": 2,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "living.statistics.categoryMonthly.recreation": {
  "title": "家計調査（総務省）2025年 二人以上の世帯の世帯人員別の1か月の教養娯楽から、インターネット接続料・テレビ・ビデオレコーダー・パソコン・動物病院代（品目分類の全国の月平均）と月謝類を除いた額（基本生活費の費目の割合の目安。子の習い事は子ども・教育、テレビ・パソコンの買い替えとペットの医療は年払い・数年おきの暮らしの支出で入れる。upTo は世帯人員。1人の段は値なし〔単身世帯はこの表に無い〕、最後の段は6人以上）",
  "value": [
   {
    "upTo": 1
   },
   {
    "upTo": 2,
    "amount": 21688
   },
   {
    "upTo": 3,
    "amount": 21746
   },
   {
    "upTo": 4,
    "amount": 25250
   },
   {
    "upTo": 5,
    "amount": 24248
   },
   {
    "upTo": null,
    "amount": 24958
   }
  ],
  "rev": 3,
  "reviewed": true,
  "retrievedAt": "2026-10-26"
 },
 "living.statistics.categoryMonthly.transit": {
  "title": "家計調査（総務省）2025年 二人以上の世帯の世帯人員別の1か月の交通（自動車等関係費・通信を除く）から、有料道路料（品目分類の全国の月平均）を除いた額（基本生活費の費目の割合の目安。高速代は車の入力項目で入れる。upTo は世帯人員。1人の段は値なし〔単身世帯はこの表に無い〕、最後の段は6人以上）",
  "value": [
   {
    "upTo": 1
   },
   {
    "upTo": 2,
    "amount": 4049
   },
   {
    "upTo": 3,
    "amount": 5507
   },
   {
    "upTo": 4,
    "amount": 6367
   },
   {
    "upTo": 5,
    "amount": 4195
   },
   {
    "upTo": null,
    "amount": 3275
   }
  ],
  "rev": 2,
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
 "education.statistics.elementary.private.extracurricular": {
  "title": "教科外活動費の年額（私立小学校。子供の学習費調査。学校教育費のうち。クラブ活動・部活動など）",
  "value": 13032,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-30"
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
 "education.statistics.elementary.public.extracurricular": {
  "title": "教科外活動費の年額（公立小学校。子供の学習費調査。学校教育費のうち。クラブ活動・部活動など）",
  "value": 3154,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-30"
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
 "education.statistics.graduate.national.admission": {
  "title": "国立大学の大学院の入学料の標準額",
  "value": 282000,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.graduate.national.law.admission": {
  "title": "国立大学の法科大学院の入学料の標準額",
  "value": 282000,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.graduate.national.law.tuition": {
  "title": "国立大学の法科大学院の授業料の標準額（年額）",
  "value": 804000,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.graduate.national.tuition": {
  "title": "国立大学の大学院の授業料の標準額（年額）",
  "value": 535800,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-09"
 },
 "education.statistics.graduate.private.doctor.admission": {
  "title": "私立大学の大学院の入学料の平均（博士後期課程（博士課程を含む）。令和7年度入学者）",
  "value": 191055,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-30"
 },
 "education.statistics.graduate.private.doctor.facility": {
  "title": "私立大学の大学院の施設設備費の平均（博士後期課程（博士課程を含む）。令和7年度入学者）",
  "value": 53125,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-30"
 },
 "education.statistics.graduate.private.doctor.tuition": {
  "title": "私立大学の大学院の授業料の平均（博士後期課程（博士課程を含む）。令和7年度入学者）",
  "value": 610798,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-30"
 },
 "education.statistics.graduate.private.law.admission": {
  "title": "私立大学の大学院の入学料の平均（法科大学院。令和7年度入学者）",
  "value": 203311,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-30"
 },
 "education.statistics.graduate.private.law.facility": {
  "title": "私立大学の大学院の施設設備費の平均（法科大学院。令和7年度入学者）",
  "value": 134172,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-30"
 },
 "education.statistics.graduate.private.law.tuition": {
  "title": "私立大学の大学院の授業料の平均（法科大学院。令和7年度入学者）",
  "value": 1194241,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-30"
 },
 "education.statistics.graduate.private.master.admission": {
  "title": "私立大学の大学院の入学料の平均（博士前期課程（修士課程を含む）。令和7年度入学者）",
  "value": 208987,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-30"
 },
 "education.statistics.graduate.private.master.facility": {
  "title": "私立大学の大学院の施設設備費の平均（博士前期課程（修士課程を含む）。令和7年度入学者）",
  "value": 70721,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-30"
 },
 "education.statistics.graduate.private.master.tuition": {
  "title": "私立大学の大学院の授業料の平均（博士前期課程（修士課程を含む）。令和7年度入学者）",
  "value": 811006,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-30"
 },
 "education.statistics.graduate.private.professional.admission": {
  "title": "私立大学の大学院の入学料の平均（専門職学位課程（法科大学院以外）。令和7年度入学者）",
  "value": 209723,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-30"
 },
 "education.statistics.graduate.private.professional.facility": {
  "title": "私立大学の大学院の施設設備費の平均（専門職学位課程（法科大学院以外）。令和7年度入学者）",
  "value": 31500,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-30"
 },
 "education.statistics.graduate.private.professional.tuition": {
  "title": "私立大学の大学院の授業料の平均（専門職学位課程（法科大学院以外）。令和7年度入学者）",
  "value": 1035086,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-30"
 },
 "education.statistics.graduate.public.admission": {
  "title": "公立大学の大学院の入学料の平均（地域外。2025年度）",
  "value": 358249,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-30"
 },
 "education.statistics.graduate.public.tuition": {
  "title": "公立大学の大学院の授業料の平均（年額。2025年度）",
  "value": 537134,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-30"
 },
 "education.statistics.highSchool.private.extracurricular": {
  "title": "教科外活動費の年額（私立高校。子供の学習費調査。学校教育費のうち。クラブ活動・部活動など）",
  "value": 63440,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-30"
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
 "education.statistics.highSchool.public.extracurricular": {
  "title": "教科外活動費の年額（公立高校。子供の学習費調査。学校教育費のうち。クラブ活動・部活動など）",
  "value": 49499,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-30"
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
 "education.statistics.juniorHigh.private.extracurricular": {
  "title": "教科外活動費の年額（私立中学校。子供の学習費調査。学校教育費のうち。クラブ活動・部活動など）",
  "value": 65131,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-30"
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
 "education.statistics.juniorHigh.public.extracurricular": {
  "title": "教科外活動費の年額（公立中学校。子供の学習費調査。学校教育費のうち。クラブ活動・部活動など）",
  "value": 27316,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-30"
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
 "education.statistics.kindergarten.private.extracurricular": {
  "title": "教科外活動費の年額（私立幼稚園。子供の学習費調査。学校教育費のうち。クラブ活動・部活動など）",
  "value": 3727,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-30"
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
 "education.statistics.kindergarten.public.extracurricular": {
  "title": "教科外活動費の年額（公立幼稚園。子供の学習費調査。学校教育費のうち。クラブ活動・部活動など）",
  "value": 907,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-30"
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
 "education.statistics.kosen.national.admission": {
  "title": "国立高等専門学校の入学料",
  "value": 84600,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-30"
 },
 "education.statistics.kosen.national.tuition": {
  "title": "国立高等専門学校の授業料（年額）",
  "value": 234600,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-30"
 },
 "education.statistics.nursery.extra": {
  "title": "保育所の保育料とは別にかかるお金の年額の目安（実費徴収。3歳以上児の主食費を除く）",
  "value": 8843,
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-30"
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
 "housing.statistics.mortgageRate.current": {
  "title": "住宅ローン利用者の借入金利の中央値〔住宅金融支援機構「住宅ローン利用者の実態調査」2026年1月調査〕（2025年4〜9月に住宅ローンを借りた人。借入金利の区分ごとの割合から比例で求めた中央値。今返している住宅ローンの金利の目安）",
  "value": "0.0085",
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-11-01"
 },
 "housing.statistics.mortgageRate.fixed": {
  "title": "住宅金融支援機構【フラット３５】2026年10月の最も多い借入金利（借入期間21年以上35年以下・融資率9割以下・新機構団信付き。取扱金融機関が提供する金利の中で最も多い金利。全期間固定の住宅ローンの当初の金利の目安）",
  "value": "0.0383",
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-31"
 },
 "housing.statistics.mortgageRate.fixedPeriod10": {
  "title": "主要な銀行が公表する当初10年の固定期間選択型の最も低い適用金利の平均（新規の住宅ローン。2026年11月の借入〔1行は10月〕の4行の平均。固定期間選択型の住宅ローンの当初の金利の目安）",
  "value": "0.0380",
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-31"
 },
 "housing.statistics.mortgageRate.variable": {
  "title": "主要な銀行が公表する変動金利の最も低い適用金利の平均（新規の住宅ローン。2026年11月の借入〔1行は10月〕の4行の平均。変動金利の住宅ローンの当初の金利の目安）",
  "value": "0.0131",
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-31"
 },
 "housing.statistics.rentGrowth": {
  "title": "総務省 消費者物価指数の民営家賃 全国の2015〜2025年の年平均の変化（2025年基準 品目別価格指数 年平均の2015年と2025年から。家賃の変動率の目安）",
  "value": "-0.0001",
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-31"
 },
 "loanRates.carLoan": {
  "title": "主要な銀行が公表する自動車ローンの最も低い金利の平均（2026年10月。2行の平均。自動車ローンの金利の目安）",
  "value": "0.0214",
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-31"
 },
 "loanRates.scholarship.repaying": {
  "title": "今返している人の第二種奨学金の利率の平均〔日本学生支援機構 第二種奨学金の貸与利率〕（平成24年3月〜令和8年3月の15年の各年3月に貸与を終えた人の、基本月額・利率固定方式の利率の平均。今返している奨学金の利率の目安）",
  "value": "0.0075",
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-11-01"
 },
 "loanRates.scholarship": {
  "title": "日本学生支援機構 第二種奨学金の貸与利率（令和8年9月に貸与を終えた人。基本月額・利率固定方式。貸与の奨学金の利率の目安）",
  "value": "0.03",
  "rev": 1,
  "reviewed": true,
  "retrievedAt": "2026-10-31"
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
 "giftTax.housingFunds.exemption.energySaving": [
  {
   "from": "2024-01-01",
   "to": "2026-12-31",
   "rev": 3,
   "value": 10000000
  },
  {
   "from": "2027-01-01",
   "to": null,
   "rev": 4,
   "value": "notApplicable"
  }
 ],
 "giftTax.housingFunds.exemption.other": [
  {
   "from": "2024-01-01",
   "to": "2026-12-31",
   "rev": 3,
   "value": 5000000
  },
  {
   "from": "2027-01-01",
   "to": null,
   "rev": 4,
   "value": "notApplicable"
  }
 ],
 "incomeTax.housingLoanCredit.limit.new.energySaving": [
  {
   "from": "2014-01-01",
   "to": "2021-12-31",
   "rev": 11,
   "value": 40000000
  },
  {
   "from": "2022-01-01",
   "to": "2023-12-31",
   "rev": 6,
   "value": 40000000
  },
  {
   "from": "2024-01-01",
   "to": "2025-12-31",
   "rev": 7,
   "value": 30000000
  },
  {
   "from": "2026-01-01",
   "to": "2027-12-31",
   "rev": 8,
   "value": 20000000
  },
  {
   "from": "2028-01-01",
   "to": "2030-12-31",
   "rev": 9,
   "value": 0
  },
  {
   "from": "2031-01-01",
   "to": null,
   "rev": 10,
   "value": "notApplicable"
  }
 ],
 "incomeTax.housingLoanCredit.limit.new.zeh": [
  {
   "from": "2014-01-01",
   "to": "2021-12-31",
   "rev": 11,
   "value": 40000000
  },
  {
   "from": "2022-01-01",
   "to": "2023-12-31",
   "rev": 6,
   "value": 45000000
  },
  {
   "from": "2024-01-01",
   "to": "2025-12-31",
   "rev": 7,
   "value": 35000000
  },
  {
   "from": "2026-01-01",
   "to": "2027-12-31",
   "rev": 8,
   "value": 35000000
  },
  {
   "from": "2028-01-01",
   "to": "2030-12-31",
   "rev": 9,
   "value": 35000000
  },
  {
   "from": "2031-01-01",
   "to": null,
   "rev": 10,
   "value": "notApplicable"
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
