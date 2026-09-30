// GENERATED FILE — do not edit by hand.
// Source: data/collections/index.json + data/collections/<slug>/collection.json
// Rebuild: npm run build:collections   (drift is caught by tests/unit/collections-bundle.test.js)
window.__COLLECTIONS_BUNDLE = {
  "schema": 1,
  "basePath": "data/collections/",
  "index": {
    "schema": 1,
    "updated": "2026-09-19",
    "description": "StakTrakr Series Templates — first-party catalog data for the Collections module. Each entry points at a collection.json with slots, mintages, specifications and stock images.",
    "attribution": "Bullion mintage figures: United States Mint sales data, republished with the Mint cited as the source.",
    "collections": [
      {
        "slug": "ase-type2",
        "path": "ase-type2/collection.json"
      },
      {
        "slug": "ase-type1",
        "path": "ase-type1/collection.json"
      }
    ]
  },
  "templates": {
    "ase-type2": {
      "schema": 1,
      "slug": "ase-type2",
      "version": 1,
      "updated": "2026-09-19",
      "name": "American Silver Eagle",
      "variant": "Type 2",
      "subtitle": "Landing Eagle reverse",
      "issuer": "United States Mint",
      "country": "US",
      "kind": "date-run",
      "run": {
        "start": 2021,
        "end": null
      },
      "metal": "Silver",
      "itemType": "Coin",
      "weight": 1,
      "weightUnit": "oz",
      "purity": 0.999,
      "specs": {
        "fineness": ".999 fine silver",
        "grossWeightGrams": 31.103,
        "diameterMm": 40.6,
        "edge": "Reeded, with a notch in the reeding",
        "faceValue": "$1",
        "mintMark": "None on bullion strikes",
        "authorization": "Liberty Coin Act, Public Law 99-61 (1985)"
      },
      "retailSlug": "ase",
      "catalogRefs": {
        "numistaId": "298883"
      },
      "about": "The second-generation Silver Eagle. In June 2021 the Mint replaced the heraldic-eagle reverse with a landing eagle carrying an oak branch, refreshed the Walking Liberty obverse and added Weinman's AW artist mark, and cut a notch into the edge reeding as an anti-counterfeit feature. The notch moves to a different position each year.",
      "design": {
        "obverse": "Walking Liberty by Adolph A. Weinman (1916), refreshed for Type 2 with his AW artist mark added. Inscriptions: LIBERTY, IN GOD WE TRUST, and the year.",
        "reverse": "An eagle coming in to land with an oak branch, designed by Emily Damstra and sculpted by Michael Gaudioso. Inscriptions: UNITED STATES OF AMERICA, E PLURIBUS UNUM, 1 OZ. FINE SILVER, ONE DOLLAR."
      },
      "mintageBasis": "United States Mint bullion sales to Authorized Purchasers. The Mint reports these as bullion mintage.",
      "images": {
        "obverse": "obverse.png",
        "reverse": "reverse.png",
        "credit": "United States Mint images, via Wikimedia Commons",
        "note": "The obverse shown is the 2022 bullion coin. The reverse shows a proof strike; bullion strikes carry no mint mark.",
        "license": "pending-review",
        "licenseNote": "Both files are tagged public domain on Wikimedia Commons. The obverse is a United States Mint work. The reverse design is by Emily Damstra, an Artistic Infusion Program artist rather than a Mint employee, so its public-domain status is less certain; beta placeholder, to be replaced with first-party photography.",
        "origin": {
          "obverse": "https://commons.wikimedia.org/wiki/File:2022-american-eagle-silver-one-ounce-bullion-coin-obverse.png",
          "reverse": "https://commons.wikimedia.org/wiki/File:$1_Silver_Eagle_Type_2_Reverse.png"
        }
      },
      "match": {
        "names": [
          "American Silver Eagle"
        ],
        "abbreviations": [
          "ase"
        ],
        "keywords": [
          "silver eagle",
          "eagle"
        ]
      },
      "itemDefaults": {
        "name": "{year} American Silver Eagle",
        "metal": "Silver",
        "type": "Coin",
        "weight": 1,
        "weightUnit": "oz",
        "purity": 0.999,
        "numistaId": "298883"
      },
      "slots": [
        {
          "id": "2021-t2",
          "year": 2021,
          "label": "2021",
          "tag": "T2",
          "itemName": "2021 American Silver Eagle Type 2",
          "mintage": 14968500,
          "mintageStatus": "final",
          "note": "First year of the Type 2 reverse. Sales to dealers began in June 2021, so the year is split with the last Type 1 coins (13,306,500). Edge notch near 6 o'clock.",
          "hints": {
            "prefer": [
              "type 2",
              "type ii",
              "t2",
              "t-2",
              "new reverse",
              "landing eagle"
            ],
            "reject": [
              "type 1",
              "type i",
              "t1",
              "t-1",
              "heraldic"
            ]
          }
        },
        {
          "id": "2022",
          "year": 2022,
          "label": "2022",
          "mintage": 16000000,
          "mintageStatus": "final",
          "note": "Lowest annual sales since 2019. Edge notch near 7 o'clock."
        },
        {
          "id": "2023",
          "year": 2023,
          "label": "2023",
          "mintage": 24750000,
          "mintageStatus": "final",
          "note": "Edge notch at 3 o'clock."
        },
        {
          "id": "2024",
          "year": 2024,
          "label": "2024",
          "mintage": 24862000,
          "mintageStatus": "final",
          "note": "Edge notch at 9 o'clock. A separate Star-privy bullion issue (500,000) also exists."
        },
        {
          "id": "2025",
          "year": 2025,
          "label": "2025",
          "mintage": 11568000,
          "mintageStatus": "reported",
          "note": "Lowest annual sales of the Type 2 era. A separate Eagle-privy bullion issue (500,000) also exists."
        },
        {
          "id": "2026",
          "year": 2026,
          "label": "2026",
          "mintage": null,
          "mintageStatus": "in-production",
          "mintageYtd": 9245500,
          "mintageAsOf": "2026-07",
          "note": "Semiquincentennial year. The bullion coin keeps the standard design and a single 2026 date; the dual date and privy mark appear only on collector versions."
        }
      ],
      "sources": [
        {
          "label": "United States Mint — American Eagle silver bullion sales data",
          "url": "https://www.usmint.gov/content/dam/usmint/data/tidy/bullion-american-eagle-silver.csv"
        },
        {
          "label": "United States Mint — production and sales figures",
          "url": "https://www.usmint.gov/about/production-sales-figures"
        },
        {
          "label": "United States Mint — new American Eagle reverse designs (press release)",
          "url": "https://www.usmint.gov/news/press-releases/united-states-mint-unveils-new-american-eagle-gold-and-silver-coin-reverse-designs"
        },
        {
          "label": "Coin World — 2021 bullion coin mintages by type",
          "url": "https://www.coinworld.com/news/precious-metals/u-s-mint-releases-2021-bullion-coin-mintages"
        },
        {
          "label": "Coin World — edge notch positions on American Eagles",
          "url": "https://www.coinworld.com/news/precious-metals/edge-notches-on-american-eagles-moved-in-2022-2023"
        },
        {
          "label": "31 U.S.C. 5112 — silver bullion coin specifications",
          "url": "https://uscode.house.gov/view.xhtml?path=%2Fprelim%40title31%2Fsubtitle4%2Fchapter51%2Fsubchapter2&edition=prelim"
        }
      ],
      "basePath": "data/collections/ase-type2/"
    },
    "ase-type1": {
      "schema": 1,
      "slug": "ase-type1",
      "version": 1,
      "updated": "2026-09-19",
      "name": "American Silver Eagle",
      "variant": "Type 1",
      "subtitle": "Heraldic Eagle reverse",
      "issuer": "United States Mint",
      "country": "US",
      "kind": "date-run",
      "run": {
        "start": 1986,
        "end": 2021
      },
      "metal": "Silver",
      "itemType": "Coin",
      "weight": 1,
      "weightUnit": "oz",
      "purity": 0.999,
      "specs": {
        "fineness": ".999 fine silver",
        "grossWeightGrams": 31.103,
        "diameterMm": 40.6,
        "edge": "Reeded",
        "faceValue": "$1",
        "mintMark": "None on bullion strikes",
        "authorization": "Liberty Coin Act, Public Law 99-61 (1985)"
      },
      "retailSlug": "ase",
      "about": "The original Silver Eagle, sold from late 1986 until the Type 2 redesign took over in mid-2021. It pairs Weinman's Walking Liberty with a heraldic eagle behind a shield, and unlike its successor it has plain edge reeding with no anti-counterfeit notch. Thirty-six dates make this the long run of the series; the ledger view is the comfortable way to work through it.",
      "design": {
        "obverse": "Walking Liberty by Adolph A. Weinman (1916), adapted from the half dollar of 1916 to 1947. Inscriptions: LIBERTY, IN GOD WE TRUST, and the year.",
        "reverse": "A heraldic eagle behind a shield, holding an olive branch and arrows beneath thirteen stars, by John Mercanti. Inscriptions: UNITED STATES OF AMERICA, E PLURIBUS UNUM, 1 OZ. FINE SILVER, ONE DOLLAR."
      },
      "mintageBasis": "United States Mint bullion sales to Authorized Purchasers, summed by calendar year. The Mint reports these as bullion mintage. Calendar-year sales can differ slightly from date-stamped production figures quoted elsewhere, because coins of one date are sometimes sold in the following year.",
      "images": {
        "obverse": "obverse.png",
        "reverse": "reverse.png",
        "credit": "United States Mint images, via Wikimedia Commons",
        "note": "The obverse shown is the 2022 bullion coin, which carries the AW artist mark added with Type 2; Type 1 obverses do not have it. The reverse shows a proof strike with a W mint mark; bullion strikes carry no mint mark.",
        "license": "public-domain",
        "licenseNote": "Both files are tagged public domain on Wikimedia Commons as works of the United States Mint. The reverse is by John Mercanti, a Mint employee.",
        "origin": {
          "obverse": "https://commons.wikimedia.org/wiki/File:2022-american-eagle-silver-one-ounce-bullion-coin-obverse.png",
          "reverse": "https://commons.wikimedia.org/wiki/File:Liberty_$1_Reverse.png"
        }
      },
      "match": {
        "names": [
          "American Silver Eagle"
        ],
        "abbreviations": [
          "ase"
        ],
        "keywords": [
          "silver eagle",
          "eagle"
        ]
      },
      "itemDefaults": {
        "name": "{year} American Silver Eagle",
        "metal": "Silver",
        "type": "Coin",
        "weight": 1,
        "weightUnit": "oz",
        "purity": 0.999
      },
      "slots": [
        {
          "id": "1986",
          "year": 1986,
          "label": "1986",
          "mintage": 5096000,
          "mintageStatus": "final",
          "note": "First year of issue. Sales to Authorized Purchasers opened in late November 1986, so this figure covers only the closing weeks of the year."
        },
        {
          "id": "1987",
          "year": 1987,
          "label": "1987",
          "mintage": 9420000,
          "mintageStatus": "final"
        },
        {
          "id": "1988",
          "year": 1988,
          "label": "1988",
          "mintage": 5869000,
          "mintageStatus": "final"
        },
        {
          "id": "1989",
          "year": 1989,
          "label": "1989",
          "mintage": 6166000,
          "mintageStatus": "final"
        },
        {
          "id": "1990",
          "year": 1990,
          "label": "1990",
          "mintage": 7247000,
          "mintageStatus": "final"
        },
        {
          "id": "1991",
          "year": 1991,
          "label": "1991",
          "mintage": 6952000,
          "mintageStatus": "final"
        },
        {
          "id": "1992",
          "year": 1992,
          "label": "1992",
          "mintage": 5544000,
          "mintageStatus": "final"
        },
        {
          "id": "1993",
          "year": 1993,
          "label": "1993",
          "mintage": 5890000,
          "mintageStatus": "final"
        },
        {
          "id": "1994",
          "year": 1994,
          "label": "1994",
          "mintage": 5540500,
          "mintageStatus": "final"
        },
        {
          "id": "1995",
          "year": 1995,
          "label": "1995",
          "mintage": 4590000,
          "mintageStatus": "final"
        },
        {
          "id": "1996",
          "year": 1996,
          "label": "1996",
          "mintage": 3466000,
          "mintageStatus": "final",
          "note": "Lowest annual sales of the Type 1 run."
        },
        {
          "id": "1997",
          "year": 1997,
          "label": "1997",
          "mintage": 3636000,
          "mintageStatus": "final"
        },
        {
          "id": "1998",
          "year": 1998,
          "label": "1998",
          "mintage": 4320000,
          "mintageStatus": "final"
        },
        {
          "id": "1999",
          "year": 1999,
          "label": "1999",
          "mintage": 9008500,
          "mintageStatus": "final"
        },
        {
          "id": "2000",
          "year": 2000,
          "label": "2000",
          "mintage": 9133000,
          "mintageStatus": "final"
        },
        {
          "id": "2001",
          "year": 2001,
          "label": "2001",
          "mintage": 8827500,
          "mintageStatus": "final"
        },
        {
          "id": "2002",
          "year": 2002,
          "label": "2002",
          "mintage": 10475500,
          "mintageStatus": "final"
        },
        {
          "id": "2003",
          "year": 2003,
          "label": "2003",
          "mintage": 9153500,
          "mintageStatus": "final"
        },
        {
          "id": "2004",
          "year": 2004,
          "label": "2004",
          "mintage": 9617000,
          "mintageStatus": "final"
        },
        {
          "id": "2005",
          "year": 2005,
          "label": "2005",
          "mintage": 8405000,
          "mintageStatus": "final"
        },
        {
          "id": "2006",
          "year": 2006,
          "label": "2006",
          "mintage": 10021000,
          "mintageStatus": "final"
        },
        {
          "id": "2007",
          "year": 2007,
          "label": "2007",
          "mintage": 9887000,
          "mintageStatus": "final"
        },
        {
          "id": "2008",
          "year": 2008,
          "label": "2008",
          "mintage": 19583500,
          "mintageStatus": "final"
        },
        {
          "id": "2009",
          "year": 2009,
          "label": "2009",
          "mintage": 28766500,
          "mintageStatus": "final"
        },
        {
          "id": "2010",
          "year": 2010,
          "label": "2010",
          "mintage": 34662500,
          "mintageStatus": "final"
        },
        {
          "id": "2011",
          "year": 2011,
          "label": "2011",
          "mintage": 39868500,
          "mintageStatus": "final"
        },
        {
          "id": "2012",
          "year": 2012,
          "label": "2012",
          "mintage": 33742500,
          "mintageStatus": "final"
        },
        {
          "id": "2013",
          "year": 2013,
          "label": "2013",
          "mintage": 42675000,
          "mintageStatus": "final"
        },
        {
          "id": "2014",
          "year": 2014,
          "label": "2014",
          "mintage": 44006000,
          "mintageStatus": "final"
        },
        {
          "id": "2015",
          "year": 2015,
          "label": "2015",
          "mintage": 47000000,
          "mintageStatus": "final",
          "note": "Highest annual sales of the Type 1 run."
        },
        {
          "id": "2016",
          "year": 2016,
          "label": "2016",
          "mintage": 37701500,
          "mintageStatus": "final"
        },
        {
          "id": "2017",
          "year": 2017,
          "label": "2017",
          "mintage": 18065500,
          "mintageStatus": "final"
        },
        {
          "id": "2018",
          "year": 2018,
          "label": "2018",
          "mintage": 15700000,
          "mintageStatus": "final"
        },
        {
          "id": "2019",
          "year": 2019,
          "label": "2019",
          "mintage": 14863500,
          "mintageStatus": "final"
        },
        {
          "id": "2020",
          "year": 2020,
          "label": "2020",
          "mintage": 30089500,
          "mintageStatus": "final"
        },
        {
          "id": "2021-t1",
          "year": 2021,
          "label": "2021",
          "tag": "T1",
          "itemName": "2021 American Silver Eagle Type 1",
          "mintage": 13306500,
          "mintageStatus": "final",
          "note": "Last year of the heraldic-eagle reverse. The year is split with the first Type 2 coins (14,968,500), which went on sale in June 2021. Struck at West Point (11,811,000), San Francisco (1,000,000) and Philadelphia (495,500); bullion strikes carry no mint mark, so the three are not distinguishable on the coin.",
          "hints": {
            "prefer": [
              "type 1",
              "type i",
              "t1",
              "t-1",
              "heraldic",
              "old reverse"
            ],
            "reject": [
              "type 2",
              "type ii",
              "t2",
              "t-2",
              "new reverse",
              "landing eagle"
            ]
          }
        }
      ],
      "sources": [
        {
          "label": "United States Mint — American Eagle silver bullion sales data",
          "url": "https://www.usmint.gov/content/dam/usmint/data/tidy/bullion-american-eagle-silver.csv"
        },
        {
          "label": "United States Mint — production and sales figures",
          "url": "https://www.usmint.gov/about/production-sales-figures"
        },
        {
          "label": "Coin World — 2021 bullion coin mintages by type",
          "url": "https://www.coinworld.com/news/precious-metals/u-s-mint-releases-2021-bullion-coin-mintages"
        },
        {
          "label": "31 U.S.C. 5112 — silver bullion coin specifications",
          "url": "https://uscode.house.gov/view.xhtml?path=%2Fprelim%40title31%2Fsubtitle4%2Fchapter51%2Fsubchapter2&edition=prelim"
        }
      ],
      "basePath": "data/collections/ase-type1/"
    }
  }
};
