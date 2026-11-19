(() => {
  const projectUrl = 'https://iktuopjqnlkecntenrwj.supabase.co';
  const publishableKey = 'sb_publishable_SrtiT5EjVmHwAqH8JIM2sQ_-BVYiV7m';

  if (!window.supabase?.createClient) {
    throw new Error('Supabase client library did not load. Check your internet connection and reload.');
  }

  window.policyHubSupabase = window.supabase.createClient(projectUrl, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
})();
