/**
 * Minimal ambient types for the bits of Google Identity Services we use.
 *
 * Hand-written rather than pulling in `@types/google.accounts`: the repo takes
 * no runtime or type dependencies for this, and we touch exactly three
 * functions. Mirrors
 * https://developers.google.com/identity/oauth2/web/reference/js-reference
 */

export interface GisTokenResponse {
  access_token?: string;
  /** Lifetime in seconds, as a string in practice. */
  expires_in?: number | string;
  scope?: string;
  token_type?: string;
  /** Present only on failure. */
  error?: string;
  error_description?: string;
}

export interface GisTokenClientConfig {
  client_id: string;
  scope: string;
  callback: (response: GisTokenResponse) => void;
  /** Fires for popup-level failures (blocked, dismissed) that never reach `callback`. */
  error_callback?: (error: { type?: string; message?: string }) => void;
  /** '' requests a token silently, reusing an existing Google session. */
  prompt?: '' | 'none' | 'consent' | 'select_account';
}

export interface GisTokenClient {
  requestAccessToken: (overrides?: { prompt?: string }) => void;
}

export interface GisOAuth2 {
  initTokenClient: (config: GisTokenClientConfig) => GisTokenClient;
  revoke: (token: string, done?: () => void) => void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: GisOAuth2;
      };
    };
  }
}
