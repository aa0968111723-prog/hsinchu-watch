const COUNTY_FEED = "https://www.hsinchu.gov.tw/OpenData.aspx?SN=92F93E5891B49161";
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

export function normalizeCnaAtom(xml) {
  return items(xml, "entry").map((block) => {
    const link = block.match(/<link[^>]+href="([^"]+)"/i)?.[1] || "";
    return {
      original_title: textOf(block, "title"),
      source_url: decode(link),
      publisher_timestamp: textOf(block, "published") || textOf(block, "updated"),
      summary: textOf(block, "summary").slice(0, 180),
      source_name: "中央社",
      source_type: "news_rss",
      source_id: "cna-atom",
    };
  }).filter((row) => row.original_title && row.source_url);
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
