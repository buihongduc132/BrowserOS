export const FILTER_LIST_URLS = [
  'https://easylist.to/easylist/easylist.txt',
  'https://easylist.to/easylist/easyprivacy.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt',
  'https://easylist.to/easylist/fanboy-annoyance.txt',
];

export async function fetchFilterList(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  return response.text();
}

export async function loadLists(): Promise<string[]> {
  const results = await Promise.allSettled(FILTER_LIST_URLS.map(fetchFilterList));
  return results
    .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
    .map(r => r.value);
}
