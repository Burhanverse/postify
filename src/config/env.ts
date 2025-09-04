import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const EnvSchema = z.object({
  BOT_TOKEN: z.string().min(10),
  MONGODB_URI: z.string().url(),
  DB_NAME: z.string().min(1).default("postify"),
  APP_BASE_URL: z.string().url().optional(),
  LOG_LEVEL: z.string().default("info"),
  ENCRYPTION_KEY: z.string().min(32).optional(),
  OWNER_ID: z
    .string()
    .regex(/^[0-9]+$/)
    .transform((v) => parseInt(v, 10))
    .optional(),
  RATE_LIMIT_MAX_REQUESTS: z
    .string()
    .regex(/^[0-9]+$/)
    .transform((v) => parseInt(v, 10))
    .optional(),
  RATE_LIMIT_WINDOW_MS: z
    .string()
    .regex(/^[0-9]+$/)
    .transform((v) => parseInt(v, 10))
    .optional(),
  RATE_LIMIT_EXEMPT_ACTIONS: z.string().optional(),
});

type Env = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error(
    "Invalid environment variables",
    parsed.error.flatten().fieldErrors,
  );
  process.exit(1);
}

export const env: Env = parsed.data;
