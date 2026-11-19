# PolicyHub with Supabase

PolicyHub uses Supabase Auth for sign-in, Postgres for profiles/documents/assignments, and a private Storage bucket for document files. The browser uses the project's publishable key in `supabase-client.js`; access is controlled by Row Level Security in `supabase/schema.sql`.

## Supabase project setup

1. In the Supabase SQL Editor for project `iktuopjqnlkecntenrwj`, run `supabase/schema.sql`. This creates the profiles, document, assignment, and timer tables; RLS policies; reading/acknowledgment RPCs; and the private `policyhub-documents` bucket.
2. In **Authentication → Users**, create the first administrator account. Then run the final bootstrap statement from `supabase/schema.sql` with that account's email to promote its profile to `admin`.
3. In **Edge Function Secrets**, set `POLICYHUB_SITE_URL` to the deployed PolicyHub origin. From a terminal with the Supabase CLI installed, run `supabase link --project-ref iktuopjqnlkecntenrwj` and `supabase functions deploy invite-user`. The function uses Supabase's server-side secret context and checks the caller's admin role before sending invitations. Never put a secret/service-role key in the browser.
4. In **Authentication → URL Configuration**, set the Site URL to the deployed PolicyHub origin and add the origin plus `/reset-password.html` to the redirect allow list.
5. Deploy the static files. Sign in as the promoted admin, invite user accounts, and upload documents. Each published document is assigned to all active user accounts.

## App behavior

- Administrator and User sign-ins use Supabase email/password authentication.
- Uploaded files are saved in a private Storage bucket. Users can read only assigned files; Administrators can read and manage all documents.
- The Administrator can set the required reading time from 1 to 120 minutes. The database records reading start time and refuses early acknowledgments.
- User invitations are sent by the `invite-user` Edge Function. The browser client cannot create or delete Auth accounts directly.
- Deactivating a user disables their PolicyHub access while preserving their profile and acknowledgment history.
- PDF files open in the reader; Word and Excel files open in a separate document viewer/download.

The frontend uses the Supabase JavaScript CDN build. The Supabase publishable key is public by design; do not use a `sb_secret_...` or `service_role` key in any browser file. Keep RLS enabled and apply the SQL setup before deployment.
