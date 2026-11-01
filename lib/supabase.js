import { createClient } from "@supabase/supabase-js";

// Create the browser client only when a page actually uses it.
// Client Components are also evaluated during Next.js prerendering, so
// creating the Supabase client at module load time can break builds when
// public environment variables are not available to the build worker.
let client;

function getSupabaseClient() {
  if (client) return client;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in the Vercel project environment variables, then redeploy."
    );
  }

  client = createClient(supabaseUrl, supabaseKey);
  return client;
}

export const supabase = new Proxy(
  {},
  {
    get(_target, property) {
      const instance = getSupabaseClient();
      const value = Reflect.get(instance, property, instance);
      return typeof value === "function" ? value.bind(instance) : value;
    },
  }
);
