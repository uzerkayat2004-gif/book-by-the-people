export type Prices = {
  transcribePerHour: number;
  inputPerMtok: number;
  cachedInputPerMtok: number;
  outputPerMtok: number;
};

export type AppConfig = {
  aiMode: "mock" | "live";
  appUrl: string;
  exposeMagicLinks: boolean;
  metaApiKey: string;
  metaBaseUrl: string;
  transcribeModel: string;
  transcribeMode: "PUSH_TO_TALK" | "ENDPOINTING" | "DIARIZATION";
  writerBaseUrl: string;
  writerApiKey: string;
  writerModel: string;
  writerReasoningEffort: string;
  fallbackBaseUrl: string;
  fallbackApiKey: string;
  fallbackModel: string;
  spendCapUsd: number | null;
  prices: Prices;
  storageDriver: "local" | "s3" | "blob";
  localStorageDir: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
  };
  googleClientId: string;
  googleClientSecret: string;
  resendApiKey: string;
  smtpUrl: string;
  emailFrom: string;
};

function read(name: string, fallback = ""): string {
  const value = process.env[name];
  return value === undefined ? fallback : value;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/** STORAGE_DRIVER wins. Without it, a Vercel Blob token (added by Vercel when you connect a Blob store) picks Blob. */
function storageDriver(): "local" | "s3" | "blob" {
  const chosen = read("STORAGE_DRIVER").toLowerCase();
  if (chosen === "s3" || chosen === "blob" || chosen === "local") return chosen;
  return read("BLOB_READ_WRITE_TOKEN") ? "blob" : "local";
}

export function getConfig(): AppConfig {
  const metaApiKey = read("META_API_KEY") || read("MODEL_API_KEY");
  const requested = read("AI_MODE").toLowerCase();
  const aiMode: "mock" | "live" =
    requested === "live" ? "live" : requested === "mock" ? "mock" : metaApiKey ? "live" : "mock";

  // Optional operator cap for every book on this server. The old AI_SPEND_CAP_USD ($20 default) is
  // ignored on purpose: limits are now set per book in Book settings → AI for this book.
  const capRaw = process.env.AI_SERVER_CAP_USD;
  const spendCapUsd =
    capRaw === undefined || capRaw.trim() === "" ? null : Number(capRaw);

  const mode = read("META_TRANSCRIBE_MODE", "ENDPOINTING").toUpperCase();
  const transcribeMode =
    mode === "PUSH_TO_TALK" || mode === "DIARIZATION" || mode === "ENDPOINTING"
      ? mode
      : "ENDPOINTING";

  // Showing a sign-in link on screen is for local testing only. On a hosted site (any Vercel
  // deployment, production above all) links only ever go by email, whatever the env says.
  const exposeFlag = process.env.AUTH_DEV_EXPOSE_LINKS;
  const hosted = Boolean(process.env.VERCEL) || Boolean(process.env.VERCEL_ENV);
  const exposeMagicLinks = hosted
    ? false
    : exposeFlag === undefined
      ? process.env.NODE_ENV !== "production"
      : exposeFlag === "true";

  const writerKey = read("META_WRITER_API_KEY") || metaApiKey;
  const writerBase = read("META_WRITER_BASE_URL") || read("META_API_BASE_URL", "https://api.meta.ai/v1");

  return {
    aiMode,
    appUrl: read("APP_URL", "http://127.0.0.1:43123").replace(/\/$/, ""),
    exposeMagicLinks,
    metaApiKey,
    metaBaseUrl: read("META_API_BASE_URL", "https://api.meta.ai/v1").replace(/\/$/, ""),
    transcribeModel: read("META_TRANSCRIBE_MODEL", "muse-voice-transcribe-1.0"),
    transcribeMode,
    writerBaseUrl: writerBase.replace(/\/$/, ""),
    writerApiKey: writerKey,
    writerModel: read("META_WRITER_MODEL", "muse-spark-1.3"),
    writerReasoningEffort: read("META_WRITER_REASONING_EFFORT", "low"),
    fallbackBaseUrl: read("WRITER_FALLBACK_BASE_URL").replace(/\/$/, ""),
    fallbackApiKey: read("WRITER_FALLBACK_API_KEY"),
    fallbackModel: read(
      "WRITER_FALLBACK_MODEL",
      "meta-models/Muse-Spark-Open-816B-A42B",
    ),
    spendCapUsd: spendCapUsd !== null && Number.isFinite(spendCapUsd) ? spendCapUsd : null,
    prices: {
      transcribePerHour: num("AI_PRICE_TRANSCRIBE_PER_HOUR", 0.18),
      inputPerMtok: num("AI_PRICE_INPUT_PER_MTOK", 1.25),
      cachedInputPerMtok: num("AI_PRICE_CACHED_INPUT_PER_MTOK", 0.15),
      outputPerMtok: num("AI_PRICE_OUTPUT_PER_MTOK", 4.25),
    },
    storageDriver: storageDriver(),
    localStorageDir: read("LOCAL_STORAGE_DIR", "./data/audio"),
    s3: {
      endpoint: read("S3_ENDPOINT"),
      region: read("S3_REGION", "auto"),
      bucket: read("S3_BUCKET"),
      accessKeyId: read("S3_ACCESS_KEY_ID"),
      secretAccessKey: read("S3_SECRET_ACCESS_KEY"),
      forcePathStyle: read("S3_FORCE_PATH_STYLE", "true") !== "false",
    },
    googleClientId: read("GOOGLE_CLIENT_ID"),
    googleClientSecret: read("GOOGLE_CLIENT_SECRET"),
    resendApiKey: read("RESEND_API_KEY"),
    smtpUrl: read("SMTP_URL"),
    emailFrom: read("EMAIL_FROM"),
  };
}
