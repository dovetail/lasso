export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    super(`HTTP ${status} for ${redact(url)}: ${body.slice(0, 500)}`);
  }
}

function redact(url: string) {
  return url.replace(/(key|token|secret)=[^&]+/gi, "$1=***");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RequestOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  retries?: number;
}

/**
 * Spaces requests to stay under a per-connector rate limit, and retries 429/5xx
 * with exponential backoff (honouring Retry-After).
 */
export class HttpClient {
  private nextSlot = 0;

  constructor(
    private readonly baseUrl: string,
    private readonly defaultHeaders: Record<string, string>,
    private readonly minIntervalMs: number,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async json<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    const retries = opts.retries ?? 5;
    for (let attempt = 0; ; attempt++) {
      await this.waitForSlot();
      const res = await this.fetchImpl(url, {
        method: opts.method ?? "GET",
        headers: {
          accept: "application/json",
          ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
          ...this.defaultHeaders,
          ...opts.headers,
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
      if (res.ok) return (await res.json()) as T;

      const body = await res.text();
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= retries) throw new HttpError(res.status, url, body);

      const retryAfter = Number(res.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
      await sleep(Math.min(delay, 60_000));
    }
  }

  private async waitForSlot() {
    const now = Date.now();
    const wait = this.nextSlot - now;
    this.nextSlot = Math.max(now, this.nextSlot) + this.minIntervalMs;
    if (wait > 0) await sleep(wait);
  }
}
