const BASE_URL = 'https://leetcode.com';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

/**
 * `code` is one of: network, timeout, blocked, auth, not_found, changed, http.
 */
export class LeetCodeError extends Error {
  constructor(code, message, { status, cause } = {}) {
    super(message, { cause });
    this.name = 'LeetCodeError';
    this.code = code;
    this.status = status;
  }
}

/**
 * @param {{ fetch?: typeof fetch, session?: string, csrftoken?: string, timeoutMs?: number }} [options]
 */
export function createClient({ fetch = globalThis.fetch, session, csrftoken, timeoutMs = 15_000 } = {}) {
  async function request(path, init = {}) {
    const headers = { 'user-agent': USER_AGENT, referer: `${BASE_URL}/`, origin: BASE_URL, accept: 'application/json', ...init.headers };
    const cookies = [];
    if (session) cookies.push(`LEETCODE_SESSION=${session}`);
    if (csrftoken) {
      cookies.push(`csrftoken=${csrftoken}`);
      headers['x-csrftoken'] = csrftoken;
    }
    if (cookies.length) headers.cookie = cookies.join('; ');

    let response;
    try {
      response = await fetch(BASE_URL + path, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      if (error.name === 'TimeoutError') {
        throw new LeetCodeError('timeout', `LeetCode didn't answer within ${timeoutMs / 1000} seconds.`, { cause: error });
      }
      throw new LeetCodeError('network', "Couldn't reach LeetCode. Check your internet connection.", { cause: error });
    }

    const { status } = response;
    if (status === 429 || response.headers.get('cf-mitigated')) {
      throw new LeetCodeError('blocked', 'LeetCode is limiting requests right now. Try again in a few minutes.', { status });
    }
    if (status === 401 || (status === 403 && session)) {
      throw new LeetCodeError('auth', 'Your LeetCode login has expired. Log in again with /login.', { status });
    }
    if (status === 403) {
      throw new LeetCodeError('blocked', "LeetCode's bot protection blocked the request. Try again in a few minutes.", { status });
    }
    if (status === 404) throw new LeetCodeError('not_found', `LeetCode has nothing at ${path}.`, { status });

    let body;
    try {
      body = await response.json();
    } catch (error) {
      throw changed(`${path} didn't return JSON`, { status, cause: error });
    }
    // GraphQL validation errors (a field LeetCode removed) come back as 400 with a JSON body.
    if (!response.ok && !body?.errors) throw new LeetCodeError('http', `LeetCode answered ${status} for ${path}.`, { status });
    return body;
  }

  return {
    async graphql(operationName, query, variables = {}) {
      const body = await request('/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operationName, query, variables }),
      });
      if (body.errors?.length) throw changed(`the ${operationName} query failed: ${body.errors[0].message}`);
      if (!body.data) throw changed(`the ${operationName} query returned no data`);
      return body.data;
    },

    getJson: (path) => request(path),
  };
}

/** For responses that don't look the way they used to: LeetCode's API is unofficial. */
export function changed(detail, options) {
  return new LeetCodeError('changed', `LeetCode changed something, so bokken needs an update (${detail}).`, options);
}
