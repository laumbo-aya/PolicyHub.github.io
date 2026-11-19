(() => {
  const supabase = window.policyHubSupabase;
  const form = document.querySelector('#login-form, #user-login-form');
  const result = document.getElementById('login-result');
  const isAdminPage = form?.id === 'login-form';

  function message(text, error = false) {
    result.textContent = text;
    result.dataset.state = error ? 'error' : 'success';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Signing in…';
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: document.getElementById('email').value.trim().toLowerCase(),
        password: document.getElementById('password').value,
      });
      if (error) throw error;
      const { data: profile, error: profileError } = await supabase.from('profiles').select('role,is_active').eq('id', data.user.id).single();
      if (profileError) throw profileError;
      if (!profile.is_active) throw new Error('This PolicyHub account is inactive. Contact an administrator.');
      if ((profile.role === 'admin') !== isAdminPage) {
        await supabase.auth.signOut();
        throw new Error(isAdminPage ? 'This account is not an Administrator account.' : 'This account is not a User account.');
      }
      window.location.replace(isAdminPage ? 'admin.html' : 'user.html');
    } catch (error) {
      message(error.message || 'Could not sign in.', true);
      if (supabase.auth.getSession) {
        const { data } = await supabase.auth.getSession();
        if (data.session) await supabase.auth.signOut();
      }
    } finally {
      button.disabled = false;
      button.textContent = 'Sign in';
    }
  });

  document.querySelectorAll('.forgot').forEach((link) => link.addEventListener('click', async (event) => {
    event.preventDefault();
    const email = document.getElementById('email').value.trim().toLowerCase();
    if (!email) return message('Enter your email address first, then choose Forgot password.', true);
    try {
      const redirectTo = new URL('reset-password.html', window.location.href).href;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      message('If the account exists, a password reset link has been sent.');
    } catch (error) {
      message(error.message || 'Could not send the password reset link.', true);
    }
  }));
})();
