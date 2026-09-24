import createClient, { type Client, type ClientOptions, type Middleware } from 'openapi-fetch';

export type BearerAuthentication = {
  readonly kind: 'bearer';
  readonly accessToken: () => string | undefined | Promise<string | undefined>;
};

export type SessionAuthentication = {
  readonly kind: 'session';
  readonly csrfHeader?: string;
  readonly csrfToken: () => string | undefined | Promise<string | undefined>;
};

export type BrowserAuthentication = BearerAuthentication | SessionAuthentication;

export type LensoWebClientOptions = Omit<ClientOptions, 'baseUrl'> & {
  readonly baseUrl: string;
  readonly authentication?: BrowserAuthentication;
};

export type ProblemDetails = {
  readonly type?: string;
  readonly title?: string;
  readonly status?: number;
  readonly detail?: string;
  readonly instance?: string;
  readonly code?: string;
  readonly [key: string]: unknown;
};

export class LensoApiError extends Error {
  readonly problem: ProblemDetails;
  readonly response: Response;

  constructor(response: Response, problem: ProblemDetails) {
    super(problem.detail ?? problem.title ?? `Lenso Web request failed with HTTP ${response.status}`);
    this.name = 'LensoApiError';
    this.problem = problem;
    this.response = response;
  }
}

export class LensoTransportError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'Lenso Web transport failed');
    this.name = 'LensoTransportError';
    this.cause = cause;
  }
}

export type LensoResult<Data, ErrorBody = unknown> =
  | { readonly data: Data; readonly error?: never; readonly response: Response }
  | { readonly data?: never; readonly error: ErrorBody; readonly response: Response };

export const browserSupport = Object.freeze({
  requestResponse: true,
  responseStream: true,
  webSocket: false,
  workersHost: false,
});

export function createLensoWebClient<Paths extends {}>(options: LensoWebClientOptions): Client<Paths> {
  const { authentication, fetch: configuredFetch, ...clientOptions } = options;
  const authenticatedOrigin = authentication === undefined ? undefined : configuredOrigin(options.baseUrl);
  const client = createClient<Paths>(authentication?.kind === 'session'
    ? { ...clientOptions, credentials: 'include' }
    : clientOptions);
  client.use(transportErrorMiddleware);
  return secureClientMethods(client, configuredFetch, authentication, authenticatedOrigin);
}

// Infer from the required success field, not the error branch's optional data?: never.
export function unwrap<Result extends LensoResult<unknown>>(result: Result): Extract<Result, { readonly data: unknown }>['data'];
export function unwrap<Data>(result: LensoResult<Data>): Data;
export function unwrap(result: LensoResult<unknown>): unknown {
  if ('error' in result) throw new LensoApiError(result.response, asProblem(result.error, result.response.status));
  return result.data;
}

export function unwrapStream(result: LensoResult<ReadableStream<Uint8Array> | null>): ReadableStream<Uint8Array> {
  const stream = unwrap(result);
  if (stream === null) throw new LensoTransportError(new Error('The response did not include a readable body stream'));
  return stream;
}

function securedFetch(
  configuredFetch: ClientOptions['fetch'],
  authentication: BrowserAuthentication | undefined,
  authenticatedOrigin: string | undefined,
): NonNullable<ClientOptions['fetch']> {
  const transport = configuredFetch ?? globalThis.fetch;
  return async (request) => {
    if (authenticatedOrigin !== undefined && new URL(request.url).origin !== authenticatedOrigin) {
      throw new Error('Authenticated Lenso Web requests cannot override the configured origin');
    }
    if (authentication?.kind === 'bearer') {
      const token = await authentication.accessToken();
      if (token !== undefined) request.headers.set('authorization', `Bearer ${token}`);
    } else if (authentication?.kind === 'session' && isUnsafeMethod(request.method)) {
      const token = await authentication.csrfToken();
      if (token === undefined || token.length === 0) {
        throw new Error('Session-authenticated mutation requires a CSRF token');
      }
      request.headers.set(authentication.csrfHeader ?? 'x-csrf-token', token);
    }
    // Automatic redirects can forward an authenticated mutation's body to a
    // different origin before the final response is observable. Require the
    // caller to handle redirects explicitly instead.
    const guardedRequest = authentication !== undefined && request.redirect === 'follow'
      ? new Request(request, { redirect: 'error' })
      : request;
    return transport(guardedRequest);
  };
}

type MethodOptions = { readonly fetch?: ClientOptions['fetch']; readonly [key: string]: unknown };
type UntypedMethod = (...args: unknown[]) => Promise<unknown>;
const REQUEST_METHODS = ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS', 'HEAD', 'PATCH', 'TRACE'] as const;

function secureClientMethods<Paths extends {}>(
  client: Client<Paths>,
  configuredFetch: ClientOptions['fetch'],
  authentication: BrowserAuthentication | undefined,
  authenticatedOrigin: string | undefined,
): Client<Paths> {
  // openapi-fetch allows a request-level fetch override. Guard that transport
  // too, or it bypasses both token/CSRF injection and the final origin check.
  const methods = client as unknown as Record<string, UntypedMethod>;
  const guardedOptions = (options?: MethodOptions): MethodOptions => ({
    ...options,
    fetch: securedFetch(options?.fetch ?? configuredFetch, authentication, authenticatedOrigin),
  });
  for (const method of REQUEST_METHODS) {
    const invoke = methods[method]!;
    methods[method] = (...args: unknown[]) => {
      const [path, options] = args;
      return invoke(path, guardedOptions(options as MethodOptions | undefined));
    };
  }
  const invokeRequest = methods.request!;
  methods.request = (...args: unknown[]) => {
    const [method, path, options] = args;
    return invokeRequest(method, path, guardedOptions(options as MethodOptions | undefined));
  };
  return client;
}

function configuredOrigin(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Authenticated Lenso Web baseUrl must be an HTTP(S) origin without credentials');
  }
  return url.origin;
}

const transportErrorMiddleware: Middleware = {
  onError({ error }) {
    return new LensoTransportError(error);
  },
};

function isUnsafeMethod(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

function asProblem(value: unknown, status: number): ProblemDetails {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const problem = value as Record<string, unknown>;
    return { ...problem, status: typeof problem.status === 'number' ? problem.status : status };
  }
  return typeof value === 'string'
    ? { status, title: `HTTP ${status}`, detail: value }
    : { status, title: `HTTP ${status}` };
}
