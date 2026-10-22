import {
  createEmailRpc,
  makeEmailWorker,
} from "../_shared/demo-email/worker.ts";
const env = (name: string) => Deno.env.get(name) ?? "";
Deno.serve(
  makeEmailWorker(
    {
      enabled: env("DEMO_EMAIL_ENABLED") === "true",
      mode: env("DEMO_EMAIL_MODE"),
      token: env("RESEND_API_KEY"),
      from: env("RESEND_FROM_EMAIL"),
      workerSecret: env("DEMO_EMAIL_WORKER_SECRET"),
      allowed: env("DEMO_EMAIL_ALLOWED_RECIPIENTS"),
      encryption: env("DEMO_EMAIL_ENCRYPTION_KEY"),
    },
    createEmailRpc(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY")),
    fetch,
    (value) => console.info(JSON.stringify(value)),
  ),
);
