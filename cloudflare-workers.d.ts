declare module "cloudflare:workers" {
  export const env: {
    DB?: D1Database;
    WCL_CLIENT_ID?: string;
    WCL_CLIENT_SECRET?: string;
    [key: string]: unknown;
  };
}
