/**
 * Demo inventory for the screenshot sets: a small mixed stack plus American Silver Eagles
 * that fill some Slots in both Series Templates. Every value is fixed so two runs match.
 */

const BASE = {
  qty: 1,
  marketValue: 0,
  purchaseLocation: "Local coin shop",
  storageLocation: "Home safe",
  serialNumber: "",
  notes: "",
  grade: "",
  gradingAuthority: "",
  certNumber: "",
  pcgsNumber: "",
  pcgsVerified: false,
  spotPriceAtPurchase: 0,
  premiumPerOz: 0,
  totalPremium: 0,
  numistaId: "",
  weightUnit: "oz",
};

/**
 * Builds one inventory item with the fields every saved item carries.
 * @param {number} serial - Inventory serial, also used in the UUID.
 * @param {object} fields - Item fields that differ from the defaults.
 * @returns {object}
 */
const item = (serial, fields) => ({
  ...BASE,
  composition: fields.metal,
  purity: 0.999,
  weight: 1,
  ...fields,
  serial,
  uuid: `demo-${String(serial).padStart(4, "0")}`,
});

const TYPE1_YEARS = [1986, 1987, 1990, 1993, 1995, 1999, 2001, 2004, 2008, 2011, 2015, 2019];
const TYPE2_YEARS = [2021, 2022, 2024];

const eagles = [...TYPE1_YEARS, ...TYPE2_YEARS].map((year, index) =>
  item(index + 1, {
    metal: "Silver",
    type: "Coin",
    name: "American Silver Eagle",
    year: String(year),
    price: year < 2021 ? 24 + (index % 4) : 36 + (index % 3),
    date: `${year < 2021 ? 2016 + (index % 5) : year}-0${1 + (index % 9)}-15`,
    numistaId: year < 2021 ? "" : "298883",
  })
);

const stack = [
  {
    metal: "Gold",
    type: "Coin",
    name: "Canadian Gold Maple Leaf",
    year: "2023",
    price: 2050,
    date: "2023-05-02",
    purity: 0.9999,
    grade: "MS-69",
    gradingAuthority: "PCGS",
  },
  {
    metal: "Gold",
    type: "Coin",
    name: "Canadian Gold Maple Leaf",
    year: "2024",
    price: 2410,
    date: "2024-04-18",
    purity: 0.9999,
  },
  {
    metal: "Gold",
    type: "Coin",
    name: "American Gold Eagle 1/10 oz",
    year: "2022",
    weight: 0.1,
    price: 215,
    date: "2022-11-09",
    purity: 0.9167,
  },
  {
    metal: "Platinum",
    type: "Coin",
    name: "American Platinum Eagle",
    year: "2021",
    price: 1180,
    date: "2021-03-22",
    purity: 0.9995,
  },
  {
    metal: "Palladium",
    type: "Bar",
    name: "Valcambi Palladium Bar",
    price: 1240,
    date: "2022-08-30",
    purity: 0.9995,
    storageLocation: "Bank box",
  },
  {
    metal: "Silver",
    type: "Bar",
    name: "PAMP Suisse Silver Bar 10 oz",
    weight: 10,
    price: 265,
    date: "2020-06-12",
    storageLocation: "Bank box",
  },
  {
    metal: "Copper",
    type: "Round",
    name: "Copper Buffalo Round",
    qty: 20,
    price: 2.1,
    date: "2023-01-20",
  },
].map((fields, index) => item(eagles.length + index + 1, fields));

/** Inventory written to localStorage before the app boots. */
export const DEMO_INVENTORY = [...eagles, ...stack];

/** Settings written with the inventory: Copper is off by default and the demo stack holds some. */
export const DEMO_SETTINGS = {
  metalOrderConfig: ["all", "silver", "gold", "platinum", "palladium", "copper"].map((id) => ({
    id,
    label: id === "all" ? "All Metals" : id[0].toUpperCase() + id.slice(1),
    enabled: true,
  })),
};

/** Slot links written through collectionsStore after boot: [collection, Slot, item UUID]. */
export const DEMO_LINKS = eagles.map((eagle) => [
  Number(eagle.year) < 2021 ? "ase-type1" : "ase-type2",
  eagle.year,
  eagle.uuid,
]);
