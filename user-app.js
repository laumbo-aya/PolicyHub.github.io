const supabase = window.policyHubSupabase;
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
let currentUser;
let profile;
let assignments = [];
let activeAssignment = null;
let eligibleAt = null;
let readerTimer = null;
let signedUrl = null;
let previousView = 'status';

function notify(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove('show'), 3000);
}

function navigate(name) {
  document.querySelectorAll('.nav button').forEach((button) => button.classList.toggle('active', button.dataset.view === name));
  document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.id === `view-${name}`));
  $('#crumb-current').textContent = ({ dashboard: 'Dashboard', status: 'Document Status', library: 'Document Library', reader: 'Reading Document' })[name] || 'Dashboard';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function formatDate(value) {
  if (!value) return 'No due date';
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
}

function pendingItems() { return assignments.filter((item) => !item.acknowledged_at); }
function getDocument(item) { return item.documents; }
function statusBadge(item) { return item.acknowledged_at ? '<span class="badge acknowledged">Acknowledged</span>' : '<span class="badge pending">Pending</span>'; }

function renderRows(items) {
  if (!items.length) return '<tr><td colspan="5" class="empty">No assigned documents match this view.</td></tr>';
  return items.map((item) => {
    const doc = getDocument(item);
    const action = item.acknowledged_at ? '' : `<button class="ack-button" type="button" data-read="${escapeHtml(item.id)}">Read &amp; acknowledge</button>`;
    return `<tr><td><span class="doc-title">${escapeHtml(doc.title)}</span><span class="sub">${escapeHtml(doc.id.slice(0, 8))} · Version ${escapeHtml(doc.version)}</span></td><td>${escapeHtml(doc.category)}</td><td>${escapeHtml(formatDate(doc.due_date))}</td><td>${statusBadge(item)}</td><td>${action}</td></tr>`;
  }).join('');
}

function render() {
  const pending = pendingItems();
  const acknowledged = assignments.length - pending.length;
  $('#ack-count').textContent = acknowledged;
  $('#pending-count').textContent = pending.length;
  $('#dashboard-docs').innerHTML = renderRows(assignments.slice(0, 4));
  const filter = document.querySelector('[data-filter].active')?.dataset.filter || 'all';
  const filtered = filter === 'pending' ? pending : filter === 'acknowledged' ? assignments.filter((item) => !!item.acknowledged_at) : assignments;
  $('#status-docs').innerHTML = renderRows(filtered);
  const search = $('#library-search').value.trim().toLowerCase();
  const matches = assignments.filter((item) => {
    const doc = getDocument(item);
    return `${doc.title} ${doc.category} ${doc.id}`.toLowerCase().includes(search);
  });
  $('#library-count').textContent = `${matches.length} assigned ${matches.length === 1 ? 'document' : 'documents'}`;
  $('#library-cards').innerHTML = matches.map((item) => {
    const doc = getDocument(item);
    const action = item.acknowledged_at ? '<span class="done">✓ Confirmed</span>' : `<button class="ack-button" type="button" data-read="${escapeHtml(item.id)}">Read &amp; acknowledge</button>`;
    return `<article class="library-card"><div class="card-top"><span class="file-icon">▤</span>${statusBadge(item)}</div><h3>${escapeHtml(doc.title)}</h3><p>${escapeHtml(doc.category)} · Version ${escapeHtml(doc.version)}</p><div class="card-bottom"><span>Due ${escapeHtml(formatDate(doc.due_date))}</span>${action}</div></article>`;
  }).join('') || '<p class="empty">No assigned documents found.</p>';
  document.querySelectorAll('[data-read]').forEach((button) => button.addEventListener('click', () => openReader(button.dataset.read)));
}

async function loadAssignments() {
  const { data, error } = await supabase.from('document_assignments')
    .select('id,document_id,assigned_at,read_started_at,required_read_minutes,acknowledged_at,documents!inner(id,title,category,version,due_date,filename,content_type,storage_path,owner)')
    .eq('user_id', currentUser.id)
    .order('assigned_at', { ascending: false });
  if (error) throw error;
  assignments = data || [];
  render();
}

function formatRemaining(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function updateTimer() {
  if (!activeAssignment || !eligibleAt) return;
  const remaining = Math.max(0, Math.ceil((eligibleAt - Date.now()) / 1000));
  $('#reader-timer').textContent = remaining ? `Time remaining: ${formatRemaining(remaining)}` : 'Reading time complete';
  $('#reader-acknowledge').disabled = remaining > 0;
  if (!remaining) clearInterval(readerTimer);
}

async function showDocumentFile(doc) {
  $('#reader-file').replaceChildren();
  const { data, error } = await supabase.storage.from('policyhub-documents').createSignedUrl(doc.storage_path, 14400);
  if (error) throw error;
  signedUrl = data.signedUrl;
  if (doc.content_type === 'application/pdf' || doc.filename.toLowerCase().endsWith('.pdf')) {
    const frame = document.createElement('iframe');
    frame.className = 'document-frame';
    frame.src = signedUrl;
    frame.title = `Reading ${doc.title}`;
    $('#reader-file').append(frame);
  } else {
    const note = document.createElement('p');
    note.textContent = 'Open the document in a separate viewer and return here to acknowledge after the timer ends.';
    const link = document.createElement('a');
    link.href = signedUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = `Open ${doc.filename}`;
    $('#reader-file').append(note, link);
  }
}

async function openReader(assignmentId) {
  const assignment = assignments.find((item) => item.id === assignmentId);
  if (!assignment) return;
  clearInterval(readerTimer);
  signedUrl = null;
  activeAssignment = assignment;
  eligibleAt = null;
  previousView = document.querySelector('.view.active')?.id.replace('view-', '') || 'status';
  const doc = getDocument(assignment);
  $('#reader-title').textContent = doc.title;
  $('#reader-subtitle').textContent = `${doc.category} · Version ${doc.version} · ${doc.filename}`;
  $('#reader-status').textContent = assignment.acknowledged_at ? 'This document has already been acknowledged.' : 'Keep this page open until the timer ends to acknowledge this document.';
  $('#reader-timer').textContent = assignment.acknowledged_at ? 'Acknowledged' : 'Opening document…';
  $('#reader-acknowledge').hidden = !!assignment.acknowledged_at;
  $('#reader-acknowledge').disabled = true;
  $('#reader-acknowledge').onclick = () => acknowledge(assignment);
  navigate('reader');

  try {
    await showDocumentFile(doc);
    if (!assignment.acknowledged_at) {
      const { data, error } = await supabase.rpc('start_document_reading', { p_assignment_id: assignment.id });
      if (error) throw error;
      const reading = Array.isArray(data) ? data[0] : data;
      eligibleAt = Date.parse(reading.eligible_at);
      readerTimer = setInterval(updateTimer, 1000);
      updateTimer();
    }
  } catch (error) {
    clearInterval(readerTimer);
    $('#reader-acknowledge').disabled = true;
    $('#reader-status').textContent = error.message || 'Could not open the document or start the reading session.';
  }
}
async function acknowledge(assignment) {
  if (!eligibleAt || Date.now() < eligibleAt) return notify('Please finish the reading timer before acknowledging.');
  const button = $('#reader-acknowledge');
  button.disabled = true;
  try {
    const { error } = await supabase.rpc('acknowledge_document', { p_assignment_id: assignment.id });
    if (error) throw error;
    notify('Document acknowledged.');
    await loadAssignments();
    navigate('status');
  } catch (error) {
    button.disabled = false;
    $('#reader-status').textContent = error.message || 'Could not record the acknowledgment.';
  }
}

async function boot() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return window.location.replace('user-login.html');
  currentUser = user;
  const { data: userProfile, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  if (error || !userProfile?.is_active) {
    await supabase.auth.signOut();
    return window.location.replace('user-login.html');
  }
  if (userProfile.role !== 'user') return window.location.replace('admin.html');
  profile = userProfile;
  $('.profile-name').textContent = profile.user_name || profile.email;
  $('.profile-role').textContent = profile.department || 'PolicyHub user';
  $('#today').textContent = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date());
  document.querySelectorAll('.nav button').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.view)));
  document.querySelectorAll('[data-go]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.go)));
  $('#sign-out').addEventListener('click', async (event) => { event.preventDefault(); await supabase.auth.signOut(); window.location.replace('user-login.html'); });
  $('#reader-back').addEventListener('click', () => { clearInterval(readerTimer); navigate(previousView); });
  document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
    document.querySelectorAll('[data-filter]').forEach((item) => item.classList.toggle('active', item === button));
    render();
  }));
  $('#library-search').addEventListener('input', render);
  await loadAssignments();
  window.addEventListener('focus', () => { if ($('#view-reader').classList.contains('active')) updateTimer(); else loadAssignments().catch((error) => notify(error.message)); });
}

boot().catch((error) => {
  console.error(error);
  notify(error.message || 'Could not load your PolicyHub workspace.');
});
