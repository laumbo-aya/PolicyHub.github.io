const supabase = window.policyHubSupabase;
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const uploadedBucket = 'policyhub-documents';
let currentUser;
let currentProfile;
let profiles = [];
let documents = [];
let readingMinutes = 1;
let editingProfileId = null;
let readerUrl = null;
let readerTimer = null;

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('show'), 3200);
}

function fail(error) {
  console.error(error);
  toast(error?.message || 'PolicyHub could not complete that request.');
}

function navigate(view) {
  document.querySelectorAll('.nav button').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  document.querySelectorAll('.section-view').forEach((section) => section.classList.toggle('active', section.id === `view-${view}`));
  $('#crumb-current').textContent = ({ dashboard: 'Overview', users: 'User Management', upload: 'Upload Document', library: 'Document Library', reports: 'Report Generation', queue: 'Pending Acknowledgments', reader: 'Document Reader' })[view] || 'Overview';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function formatDate(value) {
  if (!value) return 'No due date';
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
}

function profileName(profile) { return profile?.user_name || profile?.email || 'PolicyHub user'; }
function assignmentsOf(documentRecord) { return documentRecord.document_assignments || []; }
function pendingAssignments() { return documents.flatMap((doc) => assignmentsOf(doc).filter((assignment) => !assignment.acknowledged_at).map((assignment) => ({ doc, assignment }))); }

function renderUsers() {
  const tbody = $('#user-rows');
  tbody.replaceChildren();
  const query = $('#user-search').value.trim().toLowerCase();
  const matches = profiles.filter((profile) => [profile.user_code, profile.user_name, profile.email, profile.department].some((value) => String(value || '').toLowerCase().includes(query)));
  $('#user-count').textContent = `${matches.length} ${matches.length === 1 ? 'user' : 'users'}`;
  if (!matches.length) {
    tbody.innerHTML = '<tr><td class="empty" colspan="5">No matching users found.</td></tr>';
    return;
  }
  matches.forEach((profile) => {
    const row = document.createElement('tr');
    [profile.user_code, profile.user_name, profile.email, profile.department].forEach((value, index) => {
      const cell = document.createElement('td');
      cell.textContent = value || '—';
      if (index === 1) cell.className = 'doc';
      row.append(cell);
    });
    const actions = document.createElement('td');
    const group = document.createElement('div');
    group.className = 'actions';
    const edit = document.createElement('button');
    edit.className = 'secondary';
    edit.type = 'button';
    edit.textContent = 'Edit';
    edit.addEventListener('click', () => openUser(profile));
    const deactivate = document.createElement('button');
    deactivate.className = 'secondary danger';
    deactivate.type = 'button';
    deactivate.textContent = profile.is_active ? 'Deactivate' : 'Reactivate';
    deactivate.disabled = profile.id === currentUser.id;
    deactivate.addEventListener('click', () => setUserActive(profile, !profile.is_active));
    group.append(edit, deactivate);
    actions.append(group);
    row.append(actions);
    tbody.append(row);
  });
}

async function loadUsers() {
  const { data, error } = await supabase.from('profiles').select('id,user_code,user_name,email,department,role,is_active,created_at').order('created_at', { ascending: false });
  if (error) throw error;
  profiles = data || [];
  renderUsers();
}

function openUser(profile = null) {
  editingProfileId = profile?.id || null;
  $('#user-form').reset();
  $('#user-modal-title').textContent = profile ? 'Edit user' : 'Invite user';
  $('#save-user').textContent = profile ? 'Save changes' : 'Send invitation';
  $('#user-id').readOnly = !!profile;
  $('#user-email').readOnly = !!profile;
  if (profile) {
    $('#user-id').value = profile.user_code;
    $('#user-name').value = profile.user_name;
    $('#user-email').value = profile.email;
    $('#user-department').value = profile.department;
  }
  $('#user-modal').classList.add('open');
}

function closeUser() {
  $('#user-modal').classList.remove('open');
  $('#user-form').reset();
  editingProfileId = null;
}

async function setUserActive(profile, active) {
  const verb = active ? 'reactivate' : 'deactivate';
  if (!confirm(`${verb[0].toUpperCase()}${verb.slice(1)} ${profile.user_name || profile.email}?`)) return;
  const { error } = await supabase.from('profiles').update({ is_active: active }).eq('id', profile.id);
  if (error) return fail(error);
  await loadUsers();
  toast(`User ${active ? 'reactivated' : 'deactivated'}.`);
}

async function saveUser(event) {
  event.preventDefault();
  const data = {
    user_code: $('#user-id').value.trim(),
    user_name: $('#user-name').value.trim(),
    email: $('#user-email').value.trim().toLowerCase(),
    department: $('#user-department').value.trim(),
  };
  const button = $('#save-user');
  button.disabled = true;
  try {
    if (editingProfileId) {
      const { error } = await supabase.from('profiles').update({ user_code: data.user_code, user_name: data.user_name, department: data.department }).eq('id', editingProfileId);
      if (error) throw error;
      toast('User details updated.');
    } else {
      const { error } = await supabase.functions.invoke('invite-user', { body: data });
      if (error) throw error;
      toast('Invitation sent. The user appears after the invitation is created.');
    }
    closeUser();
    await loadUsers();
  } catch (error) {
    fail(error);
  } finally {
    button.disabled = false;
  }
}

function renderDocuments() {
  const library = $('#library-rows');
  const recent = $('#recent-document-rows');
  library.replaceChildren();
  recent.replaceChildren();
  documents.forEach((doc) => {
    const assignments = assignmentsOf(doc);
    const acknowledged = assignments.filter((assignment) => assignment.acknowledged_at).length;
    const percent = assignments.length ? Math.round((acknowledged / assignments.length) * 100) : 0;
    const status = assignments.length ? (acknowledged === assignments.length ? '<span class="badge published">Complete</span>' : '<span class="badge review">In progress</span>') : '<span class="badge review">No users assigned</span>';
    const row = document.createElement('tr');
    row.className = 'uploaded-row';
    row.innerHTML = `<td><span class="doc">${escapeHtml(doc.title)}</span><span class="sub">${escapeHtml(doc.id.slice(0, 8))} · ${escapeHtml(doc.filename)}</span></td><td>${escapeHtml(doc.category)}</td><td>${escapeHtml(doc.version)}</td><td>${escapeHtml(formatDate(doc.created_at?.slice(0, 10)))}</td><td>${percent}% (${acknowledged}/${assignments.length})</td><td>${status}</td>`;
    library.append(row);
    const recentRow = document.createElement('tr');
    recentRow.className = 'uploaded-row';
    recentRow.innerHTML = `<td><span class="doc">${escapeHtml(doc.title)}</span><span class="sub">${escapeHtml(doc.id.slice(0, 8))} · Version ${escapeHtml(doc.version)}</span></td><td>${escapeHtml(formatDate(doc.created_at?.slice(0, 10)))}</td><td>${percent}%</td><td>${status}</td>`;
    recent.append(recentRow);
  });
  if (!documents.length) {
    library.innerHTML = '<tr><td class="empty" colspan="6">No published documents yet.</td></tr>';
    recent.innerHTML = '<tr><td class="empty" colspan="4">No published documents yet.</td></tr>';
  }
  renderPending();
  updateMetrics();
}

function renderPending() {
  const pending = pendingAssignments();
  $('#pending-doc-count').textContent = `${pending.length} pending acknowledgment${pending.length === 1 ? '' : 's'}`;
  const tbody = $('#pending-doc-rows');
  tbody.replaceChildren();
  if (!pending.length) {
    tbody.innerHTML = '<tr><td class="empty" colspan="5">No documents are waiting for acknowledgment.</td></tr>';
    return;
  }
  pending.forEach(({ doc, assignment }) => {
    const row = document.createElement('tr');
    row.innerHTML = `<td><span class="doc">${escapeHtml(doc.title)}</span><span class="sub">${escapeHtml(doc.filename)}</span></td><td>${escapeHtml(profileName(assignment.profiles))} · ${escapeHtml(assignment.profiles?.user_code || '')}</td><td>${escapeHtml(formatDate(doc.due_date))}</td><td><span class="badge review">Pending</span></td><td><button class="secondary" type="button" data-read-doc="${escapeHtml(doc.id)}">Read preview</button></td>`;
    row.querySelector('[data-read-doc]').addEventListener('click', () => openAdminReader(doc));
    tbody.append(row);
  });
}

function updateMetrics() {
  const allAssignments = documents.flatMap(assignmentsOf);
  const acknowledged = allAssignments.filter((assignment) => assignment.acknowledged_at).length;
  const pending = allAssignments.length - acknowledged;
  const percent = allAssignments.length ? ((acknowledged / allAssignments.length) * 100).toFixed(1) : '0.0';
  const values = document.querySelectorAll('#view-dashboard .metric .value');
  if (values[0]) values[0].textContent = profiles.filter((profile) => profile.role === 'user' && profile.is_active).length.toLocaleString();
  if (values[1]) values[1].textContent = documents.length.toLocaleString();
  if (values[2]) values[2].textContent = acknowledged.toLocaleString();
  if (values[3]) values[3].textContent = pending.toLocaleString();
  if (values[4]) values[4].textContent = `${percent}%`;
}

async function loadDocuments() {
  const { data, error } = await supabase.from('documents')
    .select('id,title,category,owner,version,due_date,filename,content_type,storage_path,created_at,document_assignments(id,user_id,assigned_at,read_started_at,required_read_minutes,acknowledged_at,profiles(user_code,user_name,email))')
    .order('created_at', { ascending: false });
  if (error) throw error;
  documents = data || [];
  renderDocuments();
}

async function loadReadingSettings() {
  const { data, error } = await supabase.from('reading_settings').select('reading_minutes').eq('id', 1).single();
  if (error) throw error;
  readingMinutes = data.reading_minutes;
  $('#reading-minutes').value = readingMinutes;
}

async function saveReadingSettings(event) {
  event.preventDefault();
  const input = $('#reading-minutes');
  if (!input.reportValidity()) return;
  const minutes = Number(input.value);
  const { error } = await supabase.from('reading_settings').update({ reading_minutes: minutes, updated_by: currentUser.id, updated_at: new Date().toISOString() }).eq('id', 1);
  if (error) return fail(error);
  readingMinutes = minutes;
  $('#reading-settings-result').textContent = `Saved. New reading sessions require ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

async function openAdminReader(doc) {
  clearInterval(readerTimer);
  if (readerUrl) URL.revokeObjectURL(readerUrl);
  readerUrl = null;
  navigate('reader');
  $('#reader-title').textContent = doc.title;
  $('#reader-subtitle').textContent = `${doc.category} · Version ${doc.version} · ${doc.filename}`;
  $('#reader-status').textContent = 'Administrator preview. User acknowledgment is recorded from the User Portal.';
  $('#reader-acknowledge').hidden = true;
  $('#reader-file').replaceChildren();
  const timer = $('#reader-timer');
  const deadline = Date.now() + readingMinutes * 60 * 1000;
  const tick = () => {
    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    const minutes = String(Math.floor(remaining / 60)).padStart(2, '0');
    const seconds = String(remaining % 60).padStart(2, '0');
    timer.textContent = remaining ? `Reading timer preview: ${minutes}:${seconds}` : 'Reading timer preview complete';
    if (!remaining) clearInterval(readerTimer);
  };
  tick();
  readerTimer = setInterval(tick, 1000);
  try {
    const { data, error } = await supabase.storage.from(uploadedBucket).createSignedUrl(doc.storage_path, 900);
    if (error) throw error;
    readerUrl = data.signedUrl;
    if (doc.content_type === 'application/pdf') {
      const frame = document.createElement('iframe');
      frame.className = 'document-frame';
      frame.src = readerUrl;
      frame.title = `Preview of ${doc.title}`;
      $('#reader-file').append(frame);
    } else {
      const link = document.createElement('a');
      link.href = readerUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = `Open ${doc.filename}`;
      $('#reader-file').append(link);
    }
  } catch (error) {
    $('#reader-file').textContent = `The stored file could not be opened: ${error.message}`;
  }
}

function safeFileName(name) {
  return name.split(/[\\/]/).pop().replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/\s+/g, '-').slice(-120) || 'document';
}

function fileContentType(file) {
  const extension = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
  const byExtension = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  return byExtension[extension] || file.type || 'application/octet-stream';
}

async function uploadDocument(event) {
  event.preventDefault();
  const file = $('#file-upload').files[0];
  const title = $('#doc-title').value.trim();
  const button = $('#upload-button');
  if (!title || !file) return toast('Enter a title and choose a document file.');
  if (file.size > 4 * 1024 * 1024) return toast('The document must be 4 MB or smaller.');
  button.disabled = true;
  button.textContent = 'Publishing…';
  try {
    const id = crypto.randomUUID();
    const storagePath = `${id}/${safeFileName(file.name)}`;
    const contentType = fileContentType(file);
    const { error: fileError } = await supabase.storage.from(uploadedBucket).upload(storagePath, file, { contentType, upsert: false });
    if (fileError) throw fileError;
    const { data: documentRecord, error: documentError } = await supabase.from('documents').insert({
      id,
      title,
      category: $('#doc-category').value,
      owner: $('#doc-owner').value.trim(),
      due_date: $('#doc-due').value || null,
      filename: file.name,
      content_type: contentType,
      storage_path: storagePath,
      created_by: currentUser.id,
    }).select().single();
    if (documentError) {
      await supabase.storage.from(uploadedBucket).remove([storagePath]);
      throw documentError;
    }
    const activeUsers = profiles.filter((profile) => profile.role === 'user' && profile.is_active);
    if (activeUsers.length) {
      const { error: assignmentError } = await supabase.from('document_assignments').insert(activeUsers.map((profile) => ({ document_id: documentRecord.id, user_id: profile.id })));
      if (assignmentError) {
        await supabase.storage.from(uploadedBucket).remove([storagePath]);
        await supabase.from('documents').delete().eq('id', documentRecord.id);
        throw assignmentError;
      }
    }
    $('#upload-form').reset();
    $('#upload-result').dataset.state = 'success';
    $('#upload-result').textContent = activeUsers.length ? `Published and assigned to ${activeUsers.length} active user${activeUsers.length === 1 ? '' : 's'}.` : 'Published. No active user accounts were available to assign it.';
    toast('Document published.');
    await loadDocuments();
    navigate('library');
  } catch (error) {
    $('#upload-result').dataset.state = 'error';
    $('#upload-result').textContent = error.message || 'Could not publish this document.';
    fail(error);
  } finally {
    button.disabled = false;
    button.textContent = 'Add document';
  }
}

function downloadReport(event) {
  event.preventDefault();
  const rows = [['Document', 'User', 'Email', 'Status', 'Acknowledged at']];
  documents.forEach((doc) => assignmentsOf(doc).forEach((assignment) => rows.push([
    doc.title,
    profileName(assignment.profiles),
    assignment.profiles?.email || '',
    assignment.acknowledged_at ? 'Acknowledged' : 'Pending',
    assignment.acknowledged_at || '',
  ])));
  const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: 'policyhub-acknowledgments.csv' });
  link.click();
  URL.revokeObjectURL(url);
}

async function boot() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return window.location.replace('index.html');
  currentUser = user;
  const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  if (error || !profile?.is_active) {
    await supabase.auth.signOut();
    return window.location.replace('index.html');
  }
  if (profile.role !== 'admin') return window.location.replace('user.html');
  currentProfile = profile;
  $('.profile-name').textContent = profileName(profile);
  $('.profile-role').textContent = 'Workspace admin';
  $('#today').textContent = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date());
  document.querySelectorAll('.nav button').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.view)));
  document.querySelectorAll('[data-go]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.go)));
  document.querySelectorAll('[data-toast]').forEach((button) => button.addEventListener('click', () => toast(button.dataset.toast)));
  $('#sign-out').addEventListener('click', async (event) => { event.preventDefault(); await supabase.auth.signOut(); window.location.replace('index.html'); });
  $('#add-user').addEventListener('click', () => openUser());
  $('#user-search').addEventListener('input', renderUsers);
  $('#user-form').addEventListener('submit', saveUser);
  $('#close-user-modal').addEventListener('click', closeUser);
  $('#cancel-user').addEventListener('click', closeUser);
  $('#user-modal').addEventListener('click', (event) => { if (event.target === $('#user-modal')) closeUser(); });
  $('#upload-form').addEventListener('submit', uploadDocument);
  $('#reading-settings-form').addEventListener('submit', saveReadingSettings);
  $('#reader-back').addEventListener('click', () => { clearInterval(readerTimer); if (readerUrl) URL.revokeObjectURL(readerUrl); readerUrl = null; navigate('queue'); });
  $('#report-form').addEventListener('submit', downloadReport);
  $('#notify').addEventListener('click', () => { navigate('queue'); toast(`${pendingAssignments().length} pending acknowledgment${pendingAssignments().length === 1 ? '' : 's'}.`); });
  document.querySelectorAll('[data-search]').forEach((input) => input.addEventListener('input', () => {
    const target = document.getElementById(input.dataset.search), term = input.value.toLowerCase();
    target.querySelectorAll('tbody tr').forEach((row) => { row.hidden = !row.innerText.toLowerCase().includes(term); });
  }));
  try {
    await Promise.all([loadUsers(), loadDocuments(), loadReadingSettings()]);
    updateMetrics();
    window.addEventListener('focus', () => Promise.all([loadUsers(), loadDocuments()]).catch(fail));
  } catch (error) {
    fail(error);
  }
}

boot().catch(fail);
