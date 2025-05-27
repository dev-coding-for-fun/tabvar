import * as Sentry from "@sentry/cloudflare";

export const onRequest = [
  // Make sure Sentry is the first middleware
  Sentry.sentryPagesPlugin((context) => ({
    dsn: "https://73b48c35d2dc3946041ac5ebefafbbda@o4509392494723072.ingest.us.sentry.io/4509392495902720",
    // Set tracesSampleRate to 1.0 to capture 100% of spans for tracing.
    tracesSampleRate: 1.0,
  })),
  // Add more middlewares here
];