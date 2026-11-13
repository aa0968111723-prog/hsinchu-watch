const COUNTY_FEED = "https://www.hsinchu.gov.tw/OpenData.aspx?SN=92F93E5891B49161";
const CITY_HOME = "https://www.hccg.gov.tw/";
const COUNCIL_HOME = "https://www.hcc.gov.tw/";
const FINAL_ACCOUNT_URL = "https://ws.hsinchu.gov.tw/001/Upload/1/opendata/8774/181/3a4b5634-9141-414a-a0f6-422e45ccab19.json";
const FINAL_ACCOUNT_LIST = "https://www.hsinchu.gov.tw/OpenDataDetail.aspx?n=902&s=181";
const CNA_FEED = "https://www.cna.com.tw/atomfeed_cfp.xml";

function decode(value) {
  return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"");
}

function textOf(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, "i"));
  return match ? decode(match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()) : "";
}

function items(xml, tag) {
  return [...String(xml || "").matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi"))].map((match) => match[1]);
}

export function normalizeCountyRss(xml) {
  return items(xml, "item").map((block) => ({
    original_title: textOf(block, "title"),
    source_url: textOf(block, "link"),
    publisher_timestamp: textOf(block, "pubDate"),
    summary: textOf(block, "description").slice(0, 180),
    source_name: "新竹縣政府",
    source_type: "official_rss",
    source_id: "hsinchu-county-news",
  })).filter((row) => row.original_title && row.source_url);
}

export function normalizeCityHtml(html) {
  const seen = new Set();
  const rows = [];
  const add = (href, title, dateText) => {
    const sourceUrl = `https://www.hccg.gov.tw${decode(href)}`;
    if (seen.has(sourceUrl)) return;
    seen.add(sourceUrl);
    const date = String(dateText || "").trim().match(/^(\d{2,3})-(\d{2})-(\d{2})$/);
    rows.push({
      original_title: decode(title).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      source_url: sourceUrl,
      publisher_timestamp: date ? `${Number(date[1]) + 1911}-${date[2]}-${date[3]}` : "",
      summary: "",
      source_name: "新竹市政府",
      source_type: "official_html",
      source_id: "hsinchu-city-news",
    });
  };
  const source = String(html || "");
  for (const match of source.matchAll(/href="(\/hccg\/app\/data\/view\?module=municipalnews[^"]+)"[^>]*title="([^"]*)"[^>]*>\s*<span class="date">([^<]*)<\/span>/gi)) {
    add(match[1], match[2], match[3]);
  }
  for (const match of source.matchAll(/href="(\/hccg\/app\/data\/view\?module=municipalnews[^"]+)"[\s\S]*?<h3>\s*([\s\S]*?)\s*<\/h3>\s*<div class="griddate">\s*([^<]+?)\s*<\/div>/gi)) {
    add(match[1], match[2], match[3]);
  }
  return rows.filter((row) => row.original_title && row.publisher_timestamp);
}

export function normalizeCouncilHtml(html) {
  const main = String(html || "").match(/<main class="new"[\s\S]*?<\/main>/i)?.[0] || "";
  const rows = [];
  const seen = new Set();
  for (const section of main.match(/<section class="new_list[\s\S]*?<\/section>/gi) || []) {
    const href = decode(section.match(/<a href="([^"]+)"/i)?.[1] || "").trim();
    if (!href || href.startsWith("javascript:")) continue;
    const sourceUrl = new URL(href, COUNCIL_HOME).toString();
    if (seen.has(sourceUrl)) continue;
    const date = (section.match(/<p class="new-box__date">([^<]*)<\/p>/i)?.[1] || "").trim().match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
    const title = decode(section.match(/<h4 class="new-box__title">([\s\S]*?)<\/h4>/i)?.[1] || "").replace(/\s+/g, " ").trim();
    if (!date || !title) continue;
    seen.add(sourceUrl);
    rows.push({
      original_title: title,
      source_url: sourceUrl,
      publisher_timestamp: `${date[1]}-${date[2]}-${date[3]}`,
      summary: "",
      source_name: "新竹縣議會",
      source_type: "official_html",
      source_id: "hsinchu-county-council",
      region_id: "hsinchu-county",
    });
  }
  return rows;
}

export function normalizeFinalAccounts(payload) {
  const rows = JSON.parse(payload).filter((row) => row && String(row["年度"] || "").trim());
  rows.sort((left, right) => Number(left["年度"]) - Number(right["年度"]));
  return rows.slice(-4).map((row) => {
    const roc = Number(String(row["年度"]).trim());
    const year = roc < 1911 ? roc + 1911 : roc;
    const raw = row["歲出決算數"];
    const spent = raw === null || raw === undefined || String(raw).trim() === "" ? null : String(raw).trim();
    return {
      original_title: `新竹縣${year}年度歲出決算`,
      source_url: FINAL_ACCOUNT_LIST,
      publisher_timestamp: String(year),
      source_name: "新竹縣政府",
      source_type: "official_json",
      source_id: "hsc-expenditure-final",
      region_id: "hsinchu-county",
      year,
      spent_amount: spent,
      dataset_url: FINAL_ACCOUNT_URL,
    };
  });
}

export function normalizeCnaAtom(xml) {
  return items(xml, "entry").map((block) => {
    const link = block.match(/<link[^>]+href="([^"]+)"/i)?.[1] || "";
    const published = textOf(block, "published");
    const updated = textOf(block, "updated");
    return {
      original_title: textOf(block, "title"),
      source_url: decode(link),
      publisher_timestamp: published || updated,
      feed_time_kind: published ? "published" : updated ? "updated" : "",
      summary: textOf(block, "summary").slice(0, 180),
      source_name: "中央社",
      source_type: "news_rss",
      source_id: "cna-atom",
    };
  }).filter((row) => row.original_title && row.source_url);
}

export const CITY_CATALOG_URL = "https://opendata.hccg.gov.tw/OpenDataCSV.aspx";
export const CITY_CATALOG_LIST = "https://opendata.hccg.gov.tw/OpenDataList.aspx?n=1&sms=9059";
export const COUNTY_POPULATION_URL = "https://ws.hsinchu.gov.tw/001/Upload/1/opendata/8774/339/a3138432-c1c2-475a-8552-7e201bfdb0af.json";
export const COUNTY_POPULATION_PAGE = "https://www.hsinchu.gov.tw/OpenDataDetail.aspx?n=902&s=339";
export const COUNTY_PARKING_URL = "https://ws.hsinchu.gov.tw/001/Upload/1/opendata/8774/271/18b31a65-54c3-4fb6-93c4-63bf021e1bb6.json";
export const COUNTY_PARKING_PAGE = "https://www.hsinchu.gov.tw/OpenDataDetail.aspx?n=902&s=271";
export const COUNTY_SCHOOL_URL = "https://ws.hsinchu.gov.tw/001/Upload/1/opendata/8774/350/4e47a693-21da-4c61-b537-19e4b1c2617e.json";
export const COUNTY_SCHOOL_PAGE = "https://www.hsinchu.gov.tw/OpenDataDetail.aspx?n=902&s=350";
export const COUNTY_JUNIOR_URL = "https://ws.hsinchu.gov.tw/001/Upload/1/opendata/8774/325/6c9c875f-2296-4742-b187-6401c883e57c.json";
export const COUNTY_JUNIOR_PAGE = "https://www.hsinchu.gov.tw/OpenDataDetail.aspx?n=902&s=325";
export const COUNTY_KINDERGARTEN_URL = "https://ws.hsinchu.gov.tw/001/Upload/1/opendata/8774/348/b36fa839-e361-4d3a-b06d-99ae6c78f122.json";
export const COUNTY_KINDERGARTEN_PAGE = "https://www.hsinchu.gov.tw/OpenDataDetail.aspx?n=902&s=348";
export const COUNTY_CAMERA_URL = "https://ws.hsinchu.gov.tw/001/Upload/1/opendata/8774/297/f65385d7-f178-4cee-8ccc-053c14aadfdb.json";
export const COUNTY_CAMERA_PAGE = "https://www.hsinchu.gov.tw/OpenDataDetail.aspx?n=902&s=297";
export const COUNTY_SPECIAL_URL = "https://ws.hsinchu.gov.tw/001/Upload/1/opendata/8774/11/675f2bb0-640a-4171-a380-85f84decdaf0.json";
export const COUNTY_SPECIAL_PAGE = "https://www.hsinchu.gov.tw/OpenDataDetail.aspx?n=902&s=11";
export const COUNTY_PERMIT_URL = "https://ws.hsinchu.gov.tw/001/Upload/1/opendata/8774/261/bb6d6bbe-692e-4489-89dc-502cb87e183f.json";
export const COUNTY_PERMIT_PAGE = "https://www.hsinchu.gov.tw/OpenDataDetail.aspx?n=902&s=261";
export const COUNTY_HYDRANT_URL = "https://ws.hsinchu.gov.tw/001/Upload/1/opendata/8774/222/2e4cbf1c-337b-4660-94b9-c0af33d61fbe.json";
export const COUNTY_HYDRANT_PAGE = "https://www.hsinchu.gov.tw/OpenDataDetail.aspx?n=902&s=222";
export const COUNTY_SHELTER_URL = "https://ws.hsinchu.gov.tw/001/Upload/1/opendata/8774/312/0fa9ce89-b525-4a66-9d35-cc4a12d7d35f.json";
export const COUNTY_SHELTER_PAGE = "https://www.hsinchu.gov.tw/OpenDataDetail.aspx?n=902&s=312";
export const COUNTY_TOILET_URL = "https://ws.hsinchu.gov.tw/001/Upload/1/opendata/8774/533/fa516b6e-25d4-4ebc-9a18-4996026786f8.json";
export const COUNTY_TOILET_PAGE = "https://www.hsinchu.gov.tw/OpenDataDetail.aspx?n=902&s=533";
export const COUNTY_HERITAGE_URL = "https://ws.hsinchu.gov.tw/001/Upload/1/opendata/8774/267/26aab9a2-ca06-4aa6-a878-979c9d32c59b.json";
export const COUNTY_HERITAGE_PAGE = "https://www.hsinchu.gov.tw/OpenDataDetail.aspx?n=902&s=267";
export const COUNTY_CHARGER_URL = "https://ws.hsinchu.gov.tw/001/Upload/1/opendata/8774/248/2103dcb9-95bb-44f9-b997-921ace6407bc.json";
export const COUNTY_CHARGER_PAGE = "https://www.hsinchu.gov.tw/OpenDataDetail.aspx?n=902&s=248";
export const COUNTY_GAS_URL = "https://ws.hsinchu.gov.tw/001/Upload/1/opendata/8774/347/1bfd655b-da64-4d5c-9530-3b085d4ea427.json";
export const COUNTY_GAS_PAGE = "https://www.hsinchu.gov.tw/OpenDataDetail.aspx?n=902&s=347";
export const COUNTY_EBUS_URL = "https://ws.hsinchu.gov.tw/001/Upload/1/opendata/8774/313/1e32f0e4-e3ea-4c01-b650-3757a08fae07.json";
export const COUNTY_EBUS_PAGE = "https://www.hsinchu.gov.tw/OpenDataDetail.aspx?n=902&s=313";
export const COUNTY_FARM_URL = "https://ws.hsinchu.gov.tw/001/Upload/1/opendata/8774/349/3850959e-7d70-4bd9-9225-e0be5e0821ec.json";
export const COUNTY_FARM_PAGE = "https://www.hsinchu.gov.tw/OpenDataDetail.aspx?n=902&s=349";
export const COUNTY_RESCUE_URL = "https://ws.hsinchu.gov.tw/001/Upload/1/opendata/8774/218/bc8484ef-bd7c-4d4e-ada3-09927e301cb5.json";
export const COUNTY_RESCUE_PAGE = "https://www.hsinchu.gov.tw/OpenDataDetail.aspx?n=902&s=218";
export const COUNTY_BRIDGE_URL = "https://ws.hsinchu.gov.tw/001/Upload/1/opendata/8774/262/46c9c65a-6261-45a6-ab64-1d8f3ef350ed.json";
export const COUNTY_BRIDGE_PAGE = "https://www.hsinchu.gov.tw/OpenDataDetail.aspx?n=902&s=262";
export const COUNTY_RIVER_URL = "https://ws.hsinchu.gov.tw/001/Upload/1/opendata/8774/1725/1bd9c2cc-6fda-4f36-907b-1b6cb8212435.json";
export const COUNTY_RIVER_PAGE = "https://www.hsinchu.gov.tw/OpenDataDetail.aspx?n=902&s=1725";
export const COUNTY_CRASH_URL = "https://ws.hsinchu.gov.tw/001/Upload/1/opendata/8774/310/286c395c-e268-41c5-853b-edb20b9cd575.json";
export const COUNTY_CRASH_PAGE = "https://www.hsinchu.gov.tw/OpenDataDetail.aspx?n=902&s=310";
export const COUNTY_VISITOR_URL = "https://ws.hsinchu.gov.tw/001/Upload/1/opendata/8774/1546/7ae1ed04-7a39-435f-b9e6-8d0d99c90199.json";
export const COUNTY_VISITOR_PAGE = "https://www.hsinchu.gov.tw/OpenDataDetail.aspx?n=902&s=1546";
export const COUNTY_BED_URL = "https://ws.hsinchu.gov.tw/001/Upload/1/opendata/8774/238/92b948fd-e0ef-4e82-b2fb-bec53cf84a04.json";
export const COUNTY_BED_PAGE = "https://www.hsinchu.gov.tw/OpenDataDetail.aspx?n=902&s=238";
export const COUNTY_ELECTION_PAGE = "https://web.cec.gov.tw/hccec/article/65398";
export const COUNTY_DEBT_URL = "https://ws.hsinchu.gov.tw/001/Upload/1/opendata/8774/5/519f61d1-d792-4f7e-8873-46a6f41898ed.json";
export const COUNTY_DEBT_PAGE = "https://www.hsinchu.gov.tw/OpenDataDetail.aspx?n=902&s=5";
export const COUNTY_AIR_URL = "https://ws.hsinchu.gov.tw/001/Upload/1/opendata/8774/257/649793d9-60fe-483f-939e-5ccc9caedf3d.json";
export const COUNTY_AIR_PAGE = "https://www.hsinchu.gov.tw/OpenDataDetail.aspx?n=902&s=257";
export const MOENV_AIR_URL = "https://data.moenv.gov.tw/api/v2/aqx_p_432";

export function populationPeriod(html) {
  const text = String(html || "").replace(/<[^>]+>/g, " ");
  const match = text.match(/資料集描述[:：]\s*(\d{2,3})年(\d{1,2})月/);
  if (!match) return { period: null, period_text: null };
  const roc = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(roc) || !Number.isInteger(month) || roc < 1 || month < 1 || month > 12) return { period: null, period_text: null };
  const year = roc < 1911 ? roc + 1911 : roc;
  return { period: `${year}-${String(month).padStart(2, "0")}`, period_text: `${match[1]}年${match[2]}月` };
}

export function schoolZonePeriod(html) {
  const text = String(html || "").replace(/<[^>]+>/g, " ");
  const match = text.match(/資料集描述[:：]\s*(\d{2,3})年/);
  if (!match) return { period: null, period_text: null };
  const roc = Number(match[1]);
  if (!Number.isInteger(roc) || roc < 1 || roc > 300) return { period: null, period_text: null };
  const year = roc < 1911 ? roc + 1911 : roc;
  return { period: String(year), period_text: `${match[1]}年` };
}

export function kindergartenPeriod(html) {
  const text = String(html || "").replace(/<[^>]+>/g, " ");
  const match = text.match(/資料集描述[:：]\s*(\d{2,3})學年度/);
  if (!match) return { period: null, period_text: null };
  const roc = Number(match[1]);
  if (!Number.isInteger(roc) || roc < 1 || roc > 300) return { period: null, period_text: null };
  return { period: null, period_text: `${match[1]}學年度` };
}

export function cameraListPeriod(html) {
  const text = String(html || "").replace(/<[^>]+>/g, " ");
  const block = text.match(/資料集描述[:：]\s*(.{0,80})/)?.[1] || "";
  const match = block.match(/(\d{4})(\d{2})/);
  if (!match) return { period: null, period_text: null };
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return { period: null, period_text: null };
  return { period: `${match[1]}-${match[2]}`, period_text: `${match[1]}${match[2]}` };
}

function originalNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  return String(value).trim();
}

export function normalizeCountyVisitors(payload) {
  const rows = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const name = String(row?.["觀光遊憩區別"] || "").trim();
    if (!name) return [];
    const rocYear = String(row["民國年"] ?? "").trim();
    const month = String(row["月份"] ?? "").trim();
    return [{
      name,
      roc_year: rocYear || null,
      month: month || null,
      visits: originalNumber(row["遊客人次"]),
      previous_visits: originalNumber(row["上年同月份遊客人次"]),
      change: originalNumber(row["增減數"]),
      rate: originalNumber(row["成長率"]),
    }];
  });
}

export function visitorPeriod(rows) {
  const periods = (rows || []).map((row) => {
    const roc = Number(row?.roc_year);
    const month = Number(row?.month);
    if (!Number.isInteger(roc) || !Number.isInteger(month) || roc < 1 || month < 1 || month > 12) return null;
    const year = roc < 1911 ? roc + 1911 : roc;
    return { period: `${year}-${String(month).padStart(2, "0")}`, period_text: `${row.roc_year}年${row.month}月` };
  });
  if (!periods.length || periods.some((item) => !item)) return { period: null, period_text: null };
  const first = periods[0];
  if (periods.some((item) => item.period !== first.period)) return { period: null, period_text: null };
  return first;
}

export function normalizeCountyBeds(payload) {
  const rows = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const name = String(row?.["機構名稱"] || "").trim();
    if (!name) return [];
    return [{
      name,
      acute_general_permitted: originalNumber(row["急性-一般病床-許可數"]),
      acute_general_open: originalNumber(row["急性-一般病床-開放數"]),
    }];
  });
}

export function normalizeCountyDebt(payload) {
  const rows = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!Array.isArray(rows)) return null;
  let best = null;
  let bestKey = "";
  for (const row of rows) {
    const label = String(row?.["項目"] || "").trim();
    const match = label.match(/截至(\d{2,3})年(\d{1,2})月底止/);
    if (!match) continue;
    const roc = Number(match[1]);
    const month = Number(match[2]);
    if (!Number.isInteger(roc) || !Number.isInteger(month) || month < 1 || month > 12) continue;
    const year = roc < 1911 ? roc + 1911 : roc;
    const key = `${year}-${String(month).padStart(2, "0")}`;
    if (key < bestKey) continue;
    bestKey = key;
    best = {
      period: key,
      period_text: label,
      unit: "新臺幣元",
      long_term: originalNumber(row["一年以上債務未償餘額-新臺幣元"]),
      short_term: originalNumber(row["短期債務未償餘額-新臺幣元"]),
      per_person: originalNumber(row["平均每人負擔債務-新臺幣元"]),
      self_liquidating: originalNumber(row["自償性債務未償餘額-含非營業特種基金-新臺幣元"]),
    };
  }
  return best;
}

function airValue(value) {
  const text = String(value ?? "").trim();
  if (!text || text === "—") return null;
  return text;
}

export function normalizeCountyAir(payload) {
  const rows = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!Array.isArray(rows)) return null;
  let bestKey = "";
  for (const row of rows) {
    const stamp = String(row?.["民國年月"] || "").trim();
    const match = stamp.match(/^(\d{3})(\d{2})$/);
    if (!match) continue;
    const month = Number(match[2]);
    if (month < 1 || month > 12) continue;
    const year = Number(match[1]) + 1911;
    const key = `${year}-${String(month).padStart(2, "0")}|${stamp}`;
    if (key > bestKey) bestKey = key;
  }
  if (!bestKey) return null;
  const [period, periodText] = bestKey.split("|");
  const readings = rows.flatMap((row) => {
    if (String(row?.["民國年月"] || "").trim() !== periodText) return [];
    const station = String(row["測站名稱"] || "").trim();
    if (!station) return [];
    return [{
      station,
      tsp: airValue(row["懸浮微粒_TSP"]),
      pm10: airValue(row["懸浮微粒_PM10"]),
      pm25: airValue(row["懸浮微粒_PM2.5"]),
      dust: airValue(row["落塵量"]),
    }];
  });
  if (!readings.length) return null;
  return { period, period_text: periodText, unit: null, rows: readings };
}

export function normalizeElectionNotice(html) {
  const title = String(html || "").match(/<title>([^<]+)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() || "";
  if (!title) return null;
  const seen = new Set();
  const files = [];
  for (const match of String(html).matchAll(/<a[^>]+href="(https:\/\/web\.cec\.gov\.tw\/api\/file\/[^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = match[1];
    if (seen.has(url)) continue;
    seen.add(url);
    const label = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    files.push({ label: label || "附件", url });
  }
  return { title, published_at: null, files };
}

const PARKING_DISTRICTS = {
  "竹北市": "zhubei",
  "竹東鎮": "zhudong",
  "湖口鄉": "hukou",
  "新豐鄉": "xinfeng",
  "新埔鎮": "xinpu",
  "關西鎮": "guanxi",
  "芎林鄉": "qionglin",
  "寶山鄉": "baoshan",
  "北埔鄉": "beipu",
  "峨眉鄉": "emei",
  "橫山鄉": "hengshan",
  "尖石鄉": "jianshi",
  "五峰鄉": "wufeng",
};

export function normalizeCountyParking(payload) {
  const rows = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const name = String(row?.["停車場名稱"] || "").trim();
    if (!name) return [];
    const district = String(row["行政區"] || "").trim();
    const spaces = row["停車格數量"];
    const fee = row["收費方式"];
    return [{
      name,
      district,
      region_id: PARKING_DISTRICTS[district] || null,
      address: String(row["停車場地址-地號"] || "").trim(),
      kind: String(row["型式"] || "").trim(),
      spaces: spaces === null || spaces === undefined || String(spaces).trim() === "" ? null : String(spaces).trim(),
      fee: fee === null || fee === undefined || String(fee).trim() === "" ? null : String(fee).trim(),
    }];
  });
}

export function normalizeCountySchools(payload) {
  const rows = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const name = String(row?.["學校名稱"] || "").trim();
    const township = String(row?.["鄉鎮市"] || "").trim();
    if (!name || !township) return [];
    const zone = row["所屬學區"];
    const code = row["鄉鎮市區代碼"];
    return [{
      name,
      township,
      township_code: code === null || code === undefined || String(code).trim() === "" ? null : String(code).trim(),
      region_id: PARKING_DISTRICTS[township] || null,
      zone: zone === null || zone === undefined || String(zone).trim() === "" ? null : String(zone).trim(),
    }];
  });
}

export function normalizeCountyKindergartens(payload) {
  const rows = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const name = String(row?.["名稱"] || "").trim();
    if (!name) return [];
    const address = String(row["住址"] || "").trim();
    const township = Object.keys(PARKING_DISTRICTS).find((label) => address.includes(label)) || "";
    const category = String(row["主題分類"] || "").trim();
    const postal = String(row["郵遞區號"] ?? "").trim();
    return [{
      name,
      category: category || null,
      postal_code: postal || null,
      address,
      township: township || null,
      region_id: PARKING_DISTRICTS[township] || null,
    }];
  });
}

export function normalizeCountyCameras(payload) {
  const rows = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const place = String(row?.["設置地點"] || "").trim();
    const district = String(row?.["行政區"] || "").trim();
    if (!place || !district) return [];
    return [{
      code: originalNumber(row["編號"]),
      county: String(row["縣市"] || "").trim() || null,
      district,
      region_id: PARKING_DISTRICTS[district] || null,
      kind: String(row["種類"] || "").trim() || null,
      offense: String(row["取締項目"] || "").trim() || null,
      place,
      latitude: originalNumber(row["緯度"]),
      longitude: originalNumber(row["經度"]),
      direction: String(row["拍攝方向"] || "").trim() || null,
      speed_limit: originalNumber(row["速限"]),
      station: String(row["轄區分局"] || "").trim() || null,
    }];
  });
}

export function splitKindergartens(kindergartens) {
  if (!kindergartens?.count) return { summary: null, download: null };
  const summary = {
    source_url: kindergartens.source_url,
    dataset_url: kindergartens.dataset_url,
    period: null,
    period_text: kindergartens.period_text || null,
    count: kindergartens.count,
    download_url: "/data/news-intel/kindergartens.json",
    note: kindergartens.note || "只留名稱、主題分類、郵遞區號和住址。不含電話。學年度維持資料集描述，不換成西元年。",
  };
  const download = Array.isArray(kindergartens.kindergartens) ? { ...summary, kindergartens: kindergartens.kindergartens } : null;
  return { summary, download };
}

export function specialClassPeriod(payload) {
  const rows = typeof payload === "string" ? JSON.parse(payload) : payload;
  const label = Array.isArray(rows) ? Object.keys(rows[0] || {}).find((key) => key.startsWith("班級類型")) || "" : "";
  const match = label.match(/^班級類型(\d{3})(\d{2})(\d{2})$/);
  if (!match) return { period: null, period_text: null };
  const roc = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (roc < 1 || roc > 300 || month < 1 || month > 12 || day < 1 || day > 31) return { period: null, period_text: null };
  const year = roc < 1911 ? roc + 1911 : roc;
  return { period: `${year}-${match[2]}-${match[3]}`, period_text: `${match[1]}${match[2]}${match[3]}` };
}

export function summarizeUsePermits(payload) {
  let rows;
  try {
    rows = typeof payload === "string" ? JSON.parse(payload) : payload;
  } catch {
    return null;
  }
  if (!Array.isArray(rows) || !rows.length) return null;
  let earliest = null;
  let latest = null;
  let dated = 0;
  let outside = 0;
  for (const row of rows) {
    const text = String(row?.["發照日期"] ?? "").trim();
    const match = text.match(/^(\d{2,3})\/(\d{2})\/(\d{2})$/);
    if (!match) continue;
    const roc = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!Number.isInteger(roc) || month < 1 || month > 12 || day < 1 || day > 31) continue;
    if (roc < 68 || roc > 107) {
      outside += 1;
      continue;
    }
    dated += 1;
    const key = roc * 10000 + month * 100 + day;
    if (!earliest || key < earliest.key) earliest = { key, text };
    if (!latest || key > latest.key) latest = { key, text };
  }
  return {
    count: rows.length,
    dated,
    outside,
    earliest_issue_date: earliest?.text || null,
    latest_issue_date: latest?.text || null,
    unreadable: rows.length - dated - outside,
  };
}

export function normalizeCountyHydrants(payload) {
  const rows = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const place = String(row?.["設置地點"] || "").trim();
    if (!place) return [];
    const township = Object.keys(PARKING_DISTRICTS).find((label) => place.includes(label)) || "";
    return [{
      code: originalNumber(row["編號"]),
      water_code: originalNumber(row["水源編號"]),
      place,
      kind: String(row["型式"] || "").trim() || null,
      pressure: originalNumber(row["壓力-每平方公分公斤"]),
      township: township || null,
      region_id: PARKING_DISTRICTS[township] || null,
    }];
  });
}

export function splitHydrants(hydrants) {
  if (!hydrants?.count) return { summary: null, download: null };
  const summary = {
    source_url: hydrants.source_url,
    dataset_url: hydrants.dataset_url,
    count: hydrants.count,
    download_url: "/data/news-intel/hydrants.json",
    note: hydrants.note || "只留編號、水源編號、設置地點、型式和壓力原文。沒有設置地點的列不收入。壓力單位沿用欄名。檔案沒有日期欄，不拿抓取時間充當。",
  };
  const download = Array.isArray(hydrants.hydrants) ? { ...summary, hydrants: hydrants.hydrants } : null;
  return { summary, download };
}

export function normalizeCountyBusShelters(payload) {
  const rows = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const name = String(row?.["站名"] || "").trim();
    if (!name) return [];
    const road = String(row["設置路段"] || "").trim();
    const township = Object.keys(PARKING_DISTRICTS).find((label) => `${road} ${name}`.includes(label)) || "";
    const year = String(row["年度"] ?? "").trim();
    const opened = String(row["是否已完工啟用"] ?? "").trim();
    const integrated = String(row["是否已整合行經當地之公路客運設站"] ?? "").trim();
    return [{
      code: originalNumber(row["編號"]),
      year: year || null,
      kind: String(row["設施種類"] || "").trim() || null,
      road: road || null,
      name,
      direction: String(row["方向"] || "").trim() || null,
      routes: String(row["行經之公車路線"] || "").trim() || null,
      agency: String(row["完工後管理機關"] || "").trim() || null,
      opened: opened || null,
      integrated: integrated || null,
      township: township || null,
      region_id: PARKING_DISTRICTS[township] || null,
    }];
  });
}

export function splitBusShelters(shelters) {
  if (!shelters?.count) return { summary: null, download: null };
  const summary = {
    source_url: shelters.source_url,
    dataset_url: shelters.dataset_url,
    count: shelters.count,
    download_url: "/data/news-intel/bus-shelters.json",
    note: shelters.note || "只留站名、路段、年度原文、方向、路線和管理機關。年度不換成西元年。完工與否沿用「是」或「否」。",
  };
  const download = Array.isArray(shelters.shelters) ? { ...summary, shelters: shelters.shelters } : null;
  return { summary, download };
}

export function toiletUpdatePeriod(payload) {
  const rows = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!Array.isArray(rows) || !rows.length) return { period: null, period_text: null };
  const dates = rows.map((row) => String(row?.["最後更新時間"] ?? "").trim()).filter(Boolean);
  if (!dates.length || dates.some((date) => date !== dates[0])) return { period: null, period_text: null };
  const match = dates[0].match(/^(\d{2,3})\/(\d{2})\/(\d{2})$/);
  if (!match) return { period: null, period_text: dates[0] };
  const roc = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (roc < 1 || roc > 200 || month < 1 || month > 12 || day < 1 || day > 31) return { period: null, period_text: dates[0] };
  const year = roc < 1911 ? roc + 1911 : roc;
  return { period: `${year}-${match[2]}-${match[3]}`, period_text: dates[0] };
}

export function normalizeCountyToilets(payload) {
  const rows = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const name = String(row?.["無障礙廁所名稱"] || "").trim();
    if (!name) return [];
    const township = String(row["鄉鎮市區"] || "").trim();
    const address = String(row["地址"] || "").trim();
    const village = String(row["地址-村里"] || "").trim();
    const kind = String(row["公廁類型"] || "").trim();
    const note = String(row["備註"] || "").trim();
    return [{
      code: originalNumber(row["編號"]),
      name,
      township: township || null,
      region_id: PARKING_DISTRICTS[township] || null,
      village: village || null,
      address: address || null,
      kind: kind || null,
      note: note || null,
    }];
  });
}

export function splitToilets(toilets) {
  if (!toilets?.count) return { summary: null, download: null };
  const summary = {
    source_url: toilets.source_url,
    dataset_url: toilets.dataset_url,
    period: toilets.period || null,
    period_text: toilets.period_text || null,
    count: toilets.count,
    download_url: "/data/news-intel/accessible-toilets.json",
    note: toilets.note || "只留名稱、鄉鎮、村里、地址、類型和備註。最後更新時間沿用資料檔，不是抓取時間。",
  };
  const download = Array.isArray(toilets.toilets) ? { ...summary, toilets: toilets.toilets } : null;
  return { summary, download };
}

const HERITAGE_TOWNS = {
  "竹北": "zhubei",
  "竹東": "zhudong",
  "湖口": "hukou",
  "新豐": "xinfeng",
  "新埔": "xinpu",
  "關西": "guanxi",
  "芎林": "qionglin",
  "寶山": "baoshan",
  "北埔": "beipu",
  "峨眉": "emei",
  "橫山": "hengshan",
  "尖石": "jianshi",
  "五峰": "wufeng",
};

export function normalizeCountyHeritage(payload) {
  const rows = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const name = String(row?.["指定名稱"] || "").trim();
    if (!name) return [];
    const township = String(row["鄉鎮"] || "").trim();
    const address = String(row["地址或位置"] || "").trim();
    const postal = String(row["郵遞區號"] ?? "").trim();
    return [{
      code: originalNumber(row["編號"]),
      name,
      heritage_kind: String(row["古蹟類別"] || "").trim() || null,
      designation: String(row["指定類別"] || "").trim() || null,
      township: township || null,
      region_id: HERITAGE_TOWNS[township] || null,
      postal_code: postal || null,
      address: address || null,
      ownership: String(row["權屬"] || "").trim() || null,
    }];
  });
}

export function splitHeritage(heritage) {
  if (!heritage?.count) return { summary: null, download: null };
  const summary = {
    source_url: heritage.source_url,
    dataset_url: heritage.dataset_url,
    count: heritage.count,
    download_url: "/data/news-intel/heritage-sites.json",
    note: heritage.note || "只留名稱、類別、指定別、鄉鎮簡稱、地址和權屬原文。鄉鎮沒有寫市鎮鄉就不補字。檔案沒有日期欄，不拿抓取時間充當。",
  };
  const download = Array.isArray(heritage.sites) ? { ...summary, sites: heritage.sites } : null;
  return { summary, download };
}

export function normalizeCountyChargers(payload) {
  const rows = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const name = String(row?.["設置單位名稱"] || "").trim();
    if (!name) return [];
    const address = String(row["地址"] || "").trim();
    const township = Object.keys(PARKING_DISTRICTS).find((label) => address.includes(label)) || "";
    const postal = String(row["郵遞區號"] ?? "").trim();
    const note = String(row["備註"] || "").trim();
    return [{
      code: originalNumber(row["編號"]),
      name,
      postal_code: postal || null,
      address: address || null,
      note: note || null,
      township: township || null,
      region_id: PARKING_DISTRICTS[township] || null,
    }];
  });
}

export function splitChargers(chargers) {
  if (!chargers?.count) return { summary: null, download: null };
  const summary = {
    source_url: chargers.source_url,
    dataset_url: chargers.dataset_url,
    count: chargers.count,
    download_url: "/data/news-intel/chargers.json",
    note: chargers.note || "只留設置單位、地址、郵遞區號和備註。設置單位是店名或公司名。檔案沒有日期欄，不拿抓取時間充當。",
  };
  const download = Array.isArray(chargers.chargers) ? { ...summary, chargers: chargers.chargers } : null;
  return { summary, download };
}

export function normalizeCountyGasStations(payload) {
  const rows = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const name = String(row?.["站名"] || "").trim();
    if (!name) return [];
    const address = String(row["聯絡地址"] || "").trim();
    const township = Object.keys(PARKING_DISTRICTS).find((label) => address.includes(label)) || "";
    const opened = String(row["營業日期"] ?? "").trim();
    const note = String(row["備註"] || "").trim();
    return [{
      code: originalNumber(row["編號"]),
      operator: String(row["營業主體"] || "").trim() || null,
      name,
      opened_on: opened || null,
      address: address || null,
      supplier: String(row["供油廠商"] || "").trim() || null,
      note: note || null,
      township: township || null,
      region_id: PARKING_DISTRICTS[township] || null,
    }];
  });
}

export function splitGasStations(stations) {
  if (!stations?.count) return { summary: null, download: null };
  const summary = {
    source_url: stations.source_url,
    dataset_url: stations.dataset_url,
    count: stations.count,
    download_url: "/data/news-intel/gas-stations.json",
    note: stations.note || "只留站名、營業主體、營業日期原文、地址、供油廠商和備註。不含負責人和電話。營業日期不換成西元年。",
  };
  const download = Array.isArray(stations.stations) ? { ...summary, stations: stations.stations } : null;
  return { summary, download };
}

export function normalizeCountyElectricBuses(payload) {
  const rows = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const route = String(row?.["運營路線"] || "").trim();
    if (!route) return [];
    return [{
      code: originalNumber(row["編號"]),
      county: String(row["運營縣市"] || "").trim() || null,
      route,
      route_number: originalNumber(row["運營路線號"]),
      vehicles: originalNumber(row["運營車輛數"]),
      brand: String(row["車輛廠牌"] || "").trim() || null,
      model: String(row["車輛型號"] || "").trim() || null,
    }];
  });
}

export function normalizeCountyFarms(payload) {
  const rows = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const name = String(row?.["農產品經營業者名稱"] || "").trim();
    if (!name) return [];
    const address = String(row["通訊地址"] || "").trim();
    const township = Object.keys(PARKING_DISTRICTS).find((label) => address.includes(label)) || "";
    const postal = String(row["郵遞區號"] ?? "").trim();
    const expiry = String(row["驗證效期"] ?? "").trim();
    const status = String(row["驗證狀態"] ?? "").trim();
    const products = String(row["產品品項"] || "").trim();
    return [{
      code: originalNumber(row["編號"]),
      name,
      postal_code: postal || null,
      address: address || null,
      township: township || null,
      region_id: PARKING_DISTRICTS[township] || null,
      certifier: String(row["驗證機構名稱"] || "").trim() || null,
      transition_cert: String(row["證書字號-轉型"] || "").trim() || null,
      organic_cert: String(row["證書字號-有機"] || "").trim() || null,
      valid_until: expiry || null,
      status: status || null,
      area: originalNumber(row.LandPublicArea),
      products: products || null,
    }];
  });
}

export function splitFarms(farms) {
  if (!farms?.count) return { summary: null, download: null };
  const summary = {
    source_url: farms.source_url,
    dataset_url: farms.dataset_url,
    count: farms.count,
    download_url: "/data/news-intel/organic-farms.json",
    note: farms.note || "只留經營者名稱、地址、驗證機構、證書字號、效期、狀態、面積原文和產品品項。效期不另判今天是否仍有效。面積不加總。",
  };
  const download = Array.isArray(farms.farms) ? { ...summary, farms: farms.farms } : null;
  return { summary, download };
}

const RESCUE_CASES = [
  ["急病", "急救送醫人次_急病"],
  ["疑似毒藥物中毒", "急救送醫人次_疑似毒藥物中毒"],
  ["疑似一氧化碳中毒", "急救送醫人次_疑似一氧化碳中毒"],
  ["癲癇或抽搐", "急救送醫人次_癲癇或抽搐"],
  ["路倒", "急救送醫人次_路倒"],
  ["行為急症或精神異常", "急救送醫人次_行為急症或精神異常"],
  ["孕婦急產", "急救送醫人次_孕婦急產"],
  ["溺水", "急救送醫人次_溺水"],
  ["非創傷心肺停止", "急救送醫人次_非創傷類到院前心肺功能停止"],
  ["非創傷其他", "急救送醫人次_非創傷類其他"],
  ["一般外傷", "急救送醫人次_一般外傷"],
  ["車禍受傷", "急救送醫人次_車禍受傷"],
  ["墜落傷", "急救送醫人次_墜落傷"],
  ["穿刺傷", "急救送醫人次_穿刺傷"],
  ["燒燙傷", "急救送醫人次_燒燙傷"],
  ["電擊傷", "急救送醫人次_電擊傷"],
  ["生物咬螫傷", "急救送醫人次_生物咬螫傷"],
  ["創傷心肺停止", "急救送醫人次_創傷類到院前心肺功能停止"],
  ["創傷其他", "急救送醫人次_創傷類其他"],
];

function rescueField(row, prefix) {
  const key = Object.keys(row || {}).find((name) => name.startsWith(prefix));
  return key ? originalNumber(row[key]) : null;
}

export function normalizeCountyRescue(payload) {
  const rows = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const region = String(row?.["區域別"] || "").trim();
    if (!region) return [];
    const cases = {};
    for (const [label, prefix] of RESCUE_CASES) cases[label] = rescueField(row, prefix);
    return [{
      region,
      region_id: PARKING_DISTRICTS[region] || null,
      general_ambulances: rescueField(row, "月底救護車輛數_一般救護車"),
      intensive_ambulances: rescueField(row, "月底救護車輛數_加護救護車"),
      transports: rescueField(row, "救護出勤次數_送醫次數"),
      not_transported: rescueField(row, "救護出勤次數_未運送次數"),
      cases,
    }];
  });
}

export function splitRescue(rescue) {
  if (!rescue?.count) return { summary: null, download: null };
  const shortRows = (rescue.rows || []).map(({ cases, ...row }) => row);
  const summary = {
    source_url: rescue.source_url,
    dataset_url: rescue.dataset_url,
    count: rescue.count,
    rows: shortRows,
    download_url: "/data/news-intel/rescue-stats.json",
    note: rescue.note || "車輛數、送醫次數和各類人次沿用原文，不加總。沒有資料期間，不拿抓取時間充當。聯絡人沒有入檔。",
  };
  const download = Array.isArray(rescue.rows) ? { ...summary, rows: rescue.rows } : null;
  return { summary, download };
}

export function normalizeCountyBridges(payload) {
  const rows = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const name = String(row?.["橋梁名稱"] || "").trim();
    const code = String(row?.["編號"] ?? "").trim();
    if (!name || !code) return [];
    const township = String(row["所在區鄉"] || "").trim();
    return [{
      code,
      name,
      township: township || null,
      region_id: HERITAGE_TOWNS[township] || null,
      road_class: String(row["道路等級"] || "").trim() || null,
      length_m: originalNumber(row["橋梁總長度-公尺"]),
      longitude: originalNumber(row["橋頭GPS經度"]),
      latitude: originalNumber(row["橋頭GPS緯度"]),
      structure: String(row["結構型式"] || "").trim() || null,
    }];
  });
}

export function splitBridges(bridges) {
  if (!bridges?.count) return { summary: null, download: null };
  const summary = {
    source_url: bridges.source_url,
    dataset_url: bridges.dataset_url,
    count: bridges.count,
    download_url: "/data/news-intel/bridges.json",
    note: bridges.note || "鄉鎮沿用資料檔簡稱，不補鎮市鄉。長度和座標沿用原文，長度不加總。檔案沒有日期欄，不拿抓取時間充當。聯絡人沒有入檔。",
  };
  const download = Array.isArray(bridges.bridges) ? { ...summary, bridges: bridges.bridges } : null;
  return { summary, download };
}

const RIVER_SKIP = new Set(["河川名稱", "監測站", "採樣日期", "編號"]);

export function normalizeCountyRiver(payload) {
  const rows = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const river = String(row?.["河川名稱"] || "").trim();
    const station = String(row?.["監測站"] || "").trim();
    if (!river || !station) return [];
    const measures = {};
    for (const [key, value] of Object.entries(row || {})) {
      if (RIVER_SKIP.has(key)) continue;
      measures[key] = originalNumber(value);
    }
    return [{
      river,
      station,
      sample_date: originalNumber(row["採樣日期"]),
      measures,
    }];
  });
}

export function splitRiver(river) {
  if (!river?.count) return { summary: null, download: null };
  const summary = {
    source_url: river.source_url,
    dataset_url: river.dataset_url,
    count: river.count,
    rows: (river.rows || []).map(({ measures, ...row }) => row),
    download_url: "/data/news-intel/river-quality.json",
    note: river.note || "採樣日期沿用原文。這不是今天的水質。測值、ND 和小於號沿用原文，不加總，單位不另加。聯絡人沒有入檔。",
  };
  const download = Array.isArray(river.rows) ? { ...summary, rows: river.rows } : null;
  return { summary, download };
}

export function crashPeriod(label) {
  const text = String(label || "").trim();
  const match = text.match(/^(\d{2,3})年(\d{1,2})月$/);
  if (!match) return { period: null, period_text: text || null };
  const roc = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(roc) || !Number.isInteger(month) || roc < 1 || roc > 300 || month < 1 || month > 12) {
    return { period: null, period_text: text };
  }
  const year = roc < 1911 ? roc + 1911 : roc;
  return { period: `${year}-${String(month).padStart(2, "0")}`, period_text: text };
}

export function normalizeCountyCrashes(payload) {
  const rows = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const period = crashPeriod(row?.["年月份"]);
    if (!period.period_text) return [];
    return [{
      period_text: period.period_text,
      period: period.period,
      a1: originalNumber(row["A1件數"]),
      a2: originalNumber(row["A2件數"]),
      a3: originalNumber(row["A3件數"]),
    }];
  });
}

export function normalizeSpecialClasses(payload) {
  const rows = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const name = String(row?.["校名"] || "").trim();
    if (!name) return [];
    const classKey = Object.keys(row).find((key) => key.startsWith("班級類型"));
    const address = String(row["地址"] || "").trim();
    const township = Object.keys(PARKING_DISTRICTS).find((label) => address.includes(label)) || "";
    const classType = classKey ? String(row[classKey] ?? "").trim() : "";
    return [{
      code: originalNumber(row["編號"]),
      name,
      class_type: classType || null,
      address,
      township: township || null,
      region_id: PARKING_DISTRICTS[township] || null,
    }];
  });
}

export function splitSpecialClasses(specialClasses) {
  if (!specialClasses?.count) return { summary: null, download: null };
  const summary = {
    source_url: specialClasses.source_url,
    dataset_url: specialClasses.dataset_url,
    period: specialClasses.period || null,
    period_text: specialClasses.period_text || null,
    count: specialClasses.count,
    download_url: "/data/news-intel/special-classes.json",
    note: specialClasses.note || "只留校名、班級類型和地址。不含電話。日期沿用班級類型欄名，不是抓取時間。",
  };
  const download = Array.isArray(specialClasses.classes) ? { ...summary, classes: specialClasses.classes } : null;
  return { summary, download };
}

export function splitSchools(schools) {
  if (!schools?.count) return { summary: null, download: null };
  const summary = {
    source_url: schools.source_url,
    dataset_url: schools.dataset_url,
    period: schools.period || null,
    period_text: schools.period_text || null,
    count: schools.count,
    download_url: "/data/news-intel/school-zones.json",
    note: schools.note || "只留學校名稱、鄉鎮市和學區原文。",
  };
  const download = Array.isArray(schools.schools) ? { ...summary, schools: schools.schools } : null;
  return { summary, download };
}

export function splitJuniorHigh(junior) {
  if (!junior?.count) return { summary: null, download: null };
  const summary = {
    source_url: junior.source_url,
    dataset_url: junior.dataset_url,
    period: junior.period || null,
    period_text: junior.period_text || null,
    count: junior.count,
    download_url: "/data/news-intel/junior-high-zones.json",
    note: junior.note || "只留學校名稱、鄉鎮市和學區原文。年度沿用資料集描述，沒有月份就不補月。聯絡人沒有入檔。",
  };
  const download = Array.isArray(junior.schools) ? { ...summary, schools: junior.schools } : null;
  return { summary, download };
}

export function splitParking(parking) {
  if (!parking?.count) return { summary: null, download: null };
  const summary = {
    source_url: parking.source_url,
    dataset_url: parking.dataset_url,
    count: parking.count,
    download_url: "/data/news-intel/parking.json",
    note: parking.note || "只留名稱、行政區、地址、型式、格數原文和收費方式。不含電話、分機、公司名稱或證號。",
  };
  const download = Array.isArray(parking.lots) ? { ...summary, lots: parking.lots } : null;
  return { summary, download };
}

export function normalizeCountyPopulation(payload) {
  const rows = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (String(row?.["性別"] || "").trim() !== "計") return [];
    const areaCode = String(row["行政區域代碼"] || "").trim();
    const areaLabel = String(row["區域別"] || "").trim();
    if (!areaCode || !areaLabel) return [];
    const raw = row["總計"];
    const total = raw === null || raw === undefined || String(raw).trim() === "" ? null : String(raw).trim();
    return [{ area_code: areaCode, area_label: areaLabel, total }];
  });
}

export function catalogForPublish(download, summary, previousCatalog, write) {
  if (!download) return { summary, written: false };
  try {
    write(download);
    return { summary, written: true };
  } catch (error) {
    return { summary: previousCatalog || null, written: false, error: String(error.message || error).slice(0, 180) };
  }
}

export function splitCityCatalog(catalog) {
  if (!catalog?.count) return { summary: null, download: null };
  const summary = {
    source_url: catalog.source_url,
    list_url: catalog.list_url,
    count: catalog.count,
    download_url: "/data/news-intel/city-catalog.json",
  };
  const download = Array.isArray(catalog.datasets) ? { ...summary, datasets: catalog.datasets } : null;
  return { summary, download };
}

export function normalizeCityCatalog(text) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const headerIndex = lines.findIndex((line) => line.split(",").some((column) => column.trim() === "資料集名稱"));
  if (headerIndex < 0) return [];
  const header = lines[headerIndex].split(",").map((column) => column.trim());
  const nameIndex = header.indexOf("資料集名稱");
  const agencyIndex = header.indexOf("資料來源");
  const formatIndex = header.indexOf("提供格式");
  const datasets = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const fields = line.split(",");
    const name = fields[nameIndex]?.trim() || "";
    if (!name) continue;
    datasets.push({
      name,
      agency: agencyIndex >= 0 ? fields[agencyIndex]?.trim() || "" : "",
      formats: formatIndex >= 0 ? fields[formatIndex]?.trim() || "" : "",
    });
  }
  return datasets;
}

export const ADAPTERS = [
  {
    id: "hsinchu-county-news",
    kind: "official",
    discover() {
      return { url: COUNTY_FEED, docs: "https://www.hsinchu.gov.tw/", license: "政府網站公開 RSS", free: true, needs_key: false };
    },
    async fetch(fetcher) {
      const response = await fetcher(COUNTY_FEED);
      if (!response.ok) throw new Error(`county_rss_${response.status}`);
      return response.text();
    },
    normalize: normalizeCountyRss,
  },
  {
    id: "hsinchu-city-news",
    kind: "official",
    discover() {
      return { url: CITY_HOME, docs: "https://www.hccg.gov.tw/", license: "政府網站公開列表", free: true, needs_key: false };
    },
    async fetch(fetcher) {
      const response = await fetcher(CITY_HOME);
      if (!response.ok) throw new Error(`city_html_${response.status}`);
      return response.text();
    },
    normalize: normalizeCityHtml,
  },
  {
    id: "hsinchu-county-council",
    kind: "official",
    discover() {
      return { url: COUNCIL_HOME, docs: "https://www.hcc.gov.tw/", license: "議會網站公開最新消息，只存標題、日期與連結", free: true, needs_key: false };
    },
    async fetch(fetcher) {
      const response = await fetcher(COUNCIL_HOME);
      if (!response.ok) throw new Error(`council_html_${response.status}`);
      return response.text();
    },
    normalize: normalizeCouncilHtml,
  },
  {
    id: "hsc-expenditure-final",
    kind: "final_account",
    discover() {
      return { url: FINAL_ACCOUNT_URL, docs: FINAL_ACCOUNT_LIST, license: "政府資料開放授權條款", free: true, needs_key: false };
    },
    async fetch(fetcher) {
      const response = await fetcher(FINAL_ACCOUNT_URL);
      if (!response.ok) throw new Error(`final_account_${response.status}`);
      return response.text();
    },
    normalize: normalizeFinalAccounts,
  },
  {
    id: "cna-atom",
    kind: "news",
    discover() {
      return { url: CNA_FEED, docs: "https://www.cna.com.tw/", license: "來源網站授權，只存標題連結與短摘錄", free: true, needs_key: false };
    },
    async fetch(fetcher) {
      const response = await fetcher(CNA_FEED);
      if (!response.ok) throw new Error(`cna_atom_${response.status}`);
      return response.text();
    },
    normalize: normalizeCnaAtom,
  },
];

export async function collectAdapters(fetcher, adapters = ADAPTERS) {
  const candidates = [];
  const failures = [];
  for (const adapter of adapters) {
    try {
      const raw = await adapter.fetch(fetcher);
      const rows = adapter.normalize(raw);
      if (!rows.length) failures.push({ id: adapter.id, error: "empty_parse" });
      candidates.push(...rows);
    } catch (error) {
      failures.push({ id: adapter.id, error: String(error.message || error).slice(0, 180) });
    }
  }
  return { candidates, failures };
}
