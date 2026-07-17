/**
 * Minimal ambient types for the bits of Google Identity Services we use.
 *
 * Hand-written rather than pulling in `@types/google.accounts`: the repo takes
 * no runtime or type dependencies for this, and we touch exactly one
 * function — the popup code client used during interactive connect. Mirrors
 * https://developers.google.com/identity/oauth2/web/reference/js-reference
 */

export interface GisCodeResponse {
  /** The authorization code to exchange server-side. */
  code?: string;
  scope?: string;
  /** Present only on failure (e.g. access_denied). */
  error?: string;
  error_description?: string;
}

export interface GisCodeClientConfig {
  client_id: string;
  scope: string;
  ux_mode?: 'popup' | 'redirect';
  callback: (response: GisCodeResponse) => void;
  /** Fires for popup-level failures (blocked, dismissed) that never reach `callback`. */
  error_callback?: (error: { type?: string; message?: string }) => void;
}

export interface GisCodeClient {
  requestCode: () => void;
}

export interface GisOAuth2 {
  initCodeClient: (config: GisCodeClientConfig) => GisCodeClient;
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
