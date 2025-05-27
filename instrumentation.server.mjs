import * as Sentry from "@sentry/remix";

// Function to determine environment for instrumentation
function getInstrumentationEnvironment() {
  // Check Cloudflare environment variable first (passed during build/runtime)
  if (process.env.ENVIRONMENT) {
    return process.env.ENVIRONMENT;
  }
  // Fallback to NODE_ENV or default
  return process.env.NODE_ENV || 'development';
}

Sentry.init({
    dsn: "https://73b48c35d2dc3946041ac5ebefafbbda@o4509392494723072.ingest.us.sentry.io/4509392495902720",
    tracesSampleRate: 1,
    environment: getInstrumentationEnvironment(), // Add environment tag
})