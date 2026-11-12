// Selection describes the archive, never a candidate's merit or public support.
export const REVIEW_DIMENSIONS = Object.freeze([
  {id:'policy',name:'政策與取捨',question:'要解決什麼問題？預期誰受益、誰承擔成本？有沒有替代方案？'},
  {id:'record',name:'施政與成效',question:'當時職權與任期是什麼？投入、完工與實際成效是否有不同證據？'},
  {id:'budget',name:'預算與可行性',question:'財源、法定權限、執行期程與維護成本是否交代清楚？'},
  {id:'oversight',name:'質疑與監督',question:'誰提出什麼質疑？依據是原始文件、報導、意見還是推測？有沒有查核或裁判結果？'},
  {id:'response',name:'回應與佐證',question:'原來源有沒有記載回應？回應回答了哪些問題？有沒有可再核對的文件？'},
]);
export const REVIEW_TOPICS = Object.freeze([
  ['transport','交通與道路',/交通|道路|公車|鐵路|高鐵|捷運|停車/],
  ['education','教育與青年',/教育|學校|幼教|課後|青年/],
  ['housing','住宅',/住宅|住房|社宅|都更|房價/],
  ['industry','產業與就業',/產業|園區|竹科|就業|經濟|招商/],
  ['medical','醫療與長照',/醫療|長照|醫院|衛生/],
  ['environment','環境與水利',/環境|空汙|水利|淹水|環保/],
  ['fiscal','財政與預算',/預算|經費|財政|債|支出|補助|財源|採購/],
  ['hakka_indigenous','客家與原鄉',/客家|原鄉|原住民/],
  ['safety','治安與防災',/治安|警察|防詐|消防|防災/],
]);
export function reviewHref(row) {
  try { const url=new URL(row.source_url || row.url); return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password ? url.href : null; } catch { return null; }
}
export function responseLabel(row) {
  return row.responded === true ? '既有欄位記載有回應；內容仍請核對原文' : row.responded === false ? '此條目未記載回應；不能推論當事人未回應' : '回應記載未標示；不能推論當事人未回應';
}
export function reviewRows(rows,{personId,dimension='policy',topic='',origin='',asOf='9999-12-31'}={}) {
  const topicRule=REVIEW_TOPICS.find(([id])=>id===topic);
  const matches=rows.filter(row=>{
    if(row.person_id!==personId || !reviewHref(row) || row.counts_in_stats===false || (row.review_status && row.review_status!=='ok')) return false;
    if(row.published_at && String(row.published_at).slice(0,10)>asOf) return false;
    const text=`${row.title||''} ${row.summary||''}`;
    if(topicRule && !(row.issues||[]).includes(topic) && !topicRule[2].test(text)) return false;
    const group=row.claim_origin==='self_claimed'?'self':row.claim_origin==='independently_reported'?'reported':'unknown';
    if(origin && origin!==group) return false;
    const record=['record','政績'].includes(row.kind || row.type);
    if(dimension==='oversight'||dimension==='response') return row.controversy===true;
    if(row.controversy) return false;
    if(dimension==='policy') return ['policy','政見'].includes(row.kind || row.type);
    if(dimension==='record') return record;
    if(dimension==='budget') return (row.issues||[]).includes('fiscal') || REVIEW_TOPICS.find(([id])=>id==='fiscal')[2].test(text);
    return false;
  }).sort((a,b)=>String(b.published_at||'').localeCompare(String(a.published_at||'')) || String(a.title||'').localeCompare(String(b.title||''),'zh-Hant') || reviewHref(a).localeCompare(reviewHref(b)));
  const seen=new Set();
  return matches.filter(row=>{const url=new URL(reviewHref(row));for(const key of [...url.searchParams.keys()])if(/^utm_/i.test(key)||['fbclid','gclid'].includes(key))url.searchParams.delete(key);url.hash='';const key=url.href;if(seen.has(key))return false;seen.add(key);return true;});
}
