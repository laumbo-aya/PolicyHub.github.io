# PolicyHub

Static HTML/CSS PolicyHub demo with a Vercel Node Function for private test document uploads.

## Deploy to Vercel

1. Push this project to a Git repository you control, then import that repository from the Vercel dashboard.
2. In the Vercel project, create a **private Vercel Blob** store and connect it to the project’s production environment. Vercel Functions use the connected store credentials at runtime.
3. In **Project Settings → Environment Variables**, add `POLICYHUB_UPLOAD_KEY` with a unique random value at least 32 characters long. Do not commit the key to Git.
4. Deploy or redeploy the project after connecting Blob and setting the key.
5. Open **Upload Document** in the admin page. Enter the same upload key and select a PDF, DOC, DOCX, XLS, or XLSX file up to 4 MB.

Uploaded files are stored privately under `policyhub-test-documents/` in Vercel Blob. After a successful upload, the document appears in the Administrator Document Library and is assigned to the sample user, Jordan Davis, in the User Portal. The demo document list and acknowledgment state use browser local storage, so they sync between pages in the same browser but are not shared across browsers or devices. Review or delete stored test files from the Blob store in Vercel. The login screens are demo navigation only and do not authenticate users; the upload endpoint separately checks the test key.

## Local preview

The HTML pages can be opened directly for UI preview. The upload endpoint requires Vercel Functions and a connected Vercel Blob store, so actual file uploads work after deployment or under the Vercel development environment with Blob credentials configured.
