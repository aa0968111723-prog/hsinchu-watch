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
  const pattern = /href="(\/hccg\/app\/data\/view\?module=municipalnews[^"]+)"[^>]*title="([^"]*)"[^>]*>\s*<span class="date">([^<]*)<\/span>/gi;
  const seen = new Set();
  const rows = [];
  for (const match of String(html || "").matchAll(pattern)) {
    const sourceUrl = `https://www.hccg.gov.tw${decode(match[1])}`;
    if (seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);
    const date = match[3].trim().match(/^(\d{2,3})-(\d{2})-(\d{2})$/);
    rows.push({
      original_title: decode(match[2]).replace(/\s+/g, " ").trim(),
      source_url: sourceUrl,
      publisher_timestamp: date ? `${Number(date[1]) + 1911}-${date[2]}-${date[3]}` : "",
      summary: "",
      source_name: "新竹市政府",
      source_type: "official_html",
      source_id: "hsinchu-city-news",
    });
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
