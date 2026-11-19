(() => {
  const supabase = window.policyHubSupabase;
  const form = document.getElementById('reset-form');
  const result = document.getElementById('reset-result');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = document.getElementById('new-password').value;
    const confirmation = document.getElementById('confirm-password').value;
    if (password !== confirmation) {
      result.dataset.state = 'error';
      result.textContent = 'The passwords do not match.';
      return;
    }
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      result.dataset.state = 'success';
      result.textContent = 'Password updated. You can now sign in.';
      await supabase.auth.signOut();
    } catch (error) {
      result.dataset.state = 'error';
      result.textContent = error.message || 'Could not update the password.';
    } finally {
      button.disabled = false;
    }
  });
})();
