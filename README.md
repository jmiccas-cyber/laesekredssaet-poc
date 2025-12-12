# laesekredssaet-poc
POC web app for Laesekredssaet (Gentofte case)

## Supabase setup
1. Copy `supabase.config.example.js` to `supabase.config.js` and fill in your project `url` and `anonKey` (keep it out of git).
2. Apply `supabase-policies.sql` in Supabase and adjust claim/column names so admin users get full access and bookers only read their own data.
3. Ensure JWTs include `role`, `bibliotek_id`, and `central_id` claims to align with UI role checks and RLS.
