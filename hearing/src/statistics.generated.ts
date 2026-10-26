// 自動生成（hearing/scripts/statistics.ts。npm run statistics）。手で書き換えない。
// 正本は data/master（wageStats・retirementBenefit）と data/regulation の YAML（0007）。推定の目安の数の写し
import type { DatedValue, MasterValue } from "./statistics.ts";

export const MASTER_VALUES: Readonly<Record<string, MasterValue>> = {
 "wageStats.business.operatingProfit": {
  "title": "個人企業経済調査（総務省）2025年調査 1企業当たりの年間営業利益（2024年の実績・産業計）",
  "value": 2180000,
  "rev": 1,
  "reviewed": false,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.partTimeHourly.female": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 短時間労働者の1時間当たり賃金（女・年齢計・企業規模計）",
  "value": 1418,
  "rev": 1,
  "reviewed": false,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.partTimeHourly.male": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 短時間労働者の1時間当たり賃金（男・年齢計・企業規模計）",
  "value": 1769,
  "rev": 1,
  "reviewed": false,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.scheduledMonthly.nonRegular.female": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の所定内給与額の月額（正社員・正職員以外・女・年齢計・企業規模計）",
  "value": 218400,
  "rev": 1,
  "reviewed": false,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.scheduledMonthly.nonRegular.male": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の所定内給与額の月額（正社員・正職員以外・男・年齢計・企業規模計）",
  "value": 268100,
  "rev": 1,
  "reviewed": false,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.scheduledMonthly.regular.female": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の所定内給与額の月額（正社員・正職員・女・年齢計・企業規模計）",
  "value": 304900,
  "rev": 1,
  "reviewed": false,
  "retrievedAt": "2026-10-26"
 },
 "wageStats.scheduledMonthly.regular.male": {
  "title": "賃金構造基本統計調査（厚生労働省）令和7年 一般労働者の所定内給与額の月額（正社員・正職員・男・年齢計・企業規模計）",
  "value": 387400,
  "rev": 1,
  "reviewed": false,
  "retrievedAt": "2026-10-26"
 },
 "retirementBenefit.mandatory.highSchoolManual": {
  "title": "就労条件総合調査（厚生労働省）令和5年 定年退職者1人平均退職給付額（勤続20年以上かつ45歳以上・高校卒（現業職）。一時金と年金の現価の計）",
  "value": 11830000,
  "rev": 1,
  "reviewed": false,
  "retrievedAt": "2026-10-26"
 },
 "retirementBenefit.mandatory.highSchoolOffice": {
  "title": "就労条件総合調査（厚生労働省）令和5年 定年退職者1人平均退職給付額（勤続20年以上かつ45歳以上・高校卒（管理・事務・技術職）。一時金と年金の現価の計）",
  "value": 16820000,
  "rev": 1,
  "reviewed": false,
  "retrievedAt": "2026-10-26"
 },
 "retirementBenefit.mandatory.university": {
  "title": "就労条件総合調査（厚生労働省）令和5年 定年退職者1人平均退職給付額（勤続20年以上かつ45歳以上・大学・大学院卒（管理・事務・技術職）。一時金と年金の現価の計）",
  "value": 18960000,
  "rev": 1,
  "reviewed": false,
  "retrievedAt": "2026-10-26"
 },
 "retirementBenefit.prevalence.bySize": {
  "title": "就労条件総合調査（厚生労働省）令和5年 退職給付（一時金・年金）制度がある企業の割合（企業規模別。upTo は常用労働者数の上限、rate が割合）",
  "value": [
   {
    "upTo": 99
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
  "rev": 1,
  "reviewed": false,
  "retrievedAt": "2026-10-26"
 },
 "retirementBenefit.prevalence": {
  "title": "就労条件総合調査（厚生労働省）令和5年 退職給付（一時金・年金）制度がある企業の割合（企業規模計）",
  "value": "0.749",
  "rev": 1,
  "reviewed": false,
  "retrievedAt": "2026-10-26"
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
 ]
};
