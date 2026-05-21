import * as Sentry from "@sentry/cloudflare";

const SENTRY_DSN = "https://73b48c35d2dc3946041ac5ebefafbbda@o4509392494723072.ingest.us.sentry.io/4509392495902720";

type PagesEnv = {
  CF_PAGES_BRANCH?: string;
};

export const onRequest = [
  // Make sure Sentry is the first middleware
  Sentry.sentryPagesPlugin<PagesEnv>((context) => ({
    dsn: SENTRY_DSN,
    environment: context.env.CF_PAGES_BRANCH === "main" ? "production" : "preview",
    // Set tracesSampleRate to 1.0 to capture 100% of spans for tracing.
    tracesSampleRate: 1.0,
  })),
  // Add more middlewares here
];
