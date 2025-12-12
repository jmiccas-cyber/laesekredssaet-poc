# laesekredssaet-poc
POC web app for Laesekredssaet (Gentofte case)

## Supabase setup
1. Fill `supabase.config.js` with your project `url` and `anonKey` before running. This file is tracked, so avoid committing real production secrets (use deployment-time replacement instead).
2. Apply `supabase-policies.sql` in Supabase and adjust claim/column names so admin users get full access and bookers only read their own data.
3. Ensure JWTs include `role`, `bibliotek_id`, and `central_id` claims to align with UI role checks and RLS.
