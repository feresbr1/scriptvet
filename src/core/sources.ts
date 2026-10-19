export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const NPM_REGISTRY = 'https://registry.npmjs.org';
export const CDN = 'https://cdn.jsdelivr.net/npm';

export interface Manifest {
  scripts?: Record<string, string>;
  gypfile?: boolean;
  os?: string[];
}

async function request(fetchFn: FetchLike, url: string): Promise<Response> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchFn(url);
      if (res.status !== 429 && res.status < 500) return res;
      last = new Error(`HTTP ${res.status}`);
    } catch (error) {
      last = error;
    }
    await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/** One version's manifest from the npm registry (undefined if the version does not exist). */
export async function fetchManifest(
  fetchFn: FetchLike,
  name: string,
  version: string,
): Promise<Manifest | undefined> {
  const res = await request(
    fetchFn,
    `${NPM_REGISTRY}/${name.replace('/', '%2f')}/${encodeURIComponent(version)}`,
  );
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`npm registry: HTTP ${res.status} for ${name}@${version}`);
  return (await res.json()) as Manifest;
}

/** A file from the published package, via jsDelivr. Undefined if it is not there. */
export async function fetchPackageFile(
  fetchFn: FetchLike,
  name: string,
  version: string,
  path: string,
): Promise<string | undefined> {
  const res = await request(fetchFn, `${CDN}/${name}@${version}/${path.replace(/^\.?\//, '')}`);
  if (res.status === 404 || res.status === 403) return undefined;
  if (!res.ok) throw new Error(`jsDelivr: HTTP ${res.status} for ${name}@${version}/${path}`);
  return res.text();
}

export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await task(items[index]!);
      }
    }),
  );
  return results;
}
