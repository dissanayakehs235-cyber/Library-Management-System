let BOOKS = [], CATS = [], USERS = [];
let editingId = null;
let coverDataUrl = '';

async function initAdmin() {
  const user = await guard('admin');
  if (!user) return;
  navbar('Admin Panel', user);
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.addEventListener('click', () => switchTab(b.dataset.tab)));
  document.getElementById('book-search').addEventListener('input', renderBookTable);
  document.getElementById('book-cat-filter').addEventListener('change', renderBookTable);
  document.getElementById('book-form').addEventListener('submit', saveBook);
  document.getElementById('cat-form').addEventListener('submit', addCategory);
  await refreshAll();
}

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
}

async function refreshAll() {
  const [books, cats, stats, users] = await Promise.all([
    api('/api/books'), api('/api/categories'), api('/api/stats'), api('/api/admin/users'),
  ]);
  BOOKS = books.books || []; CATS = cats.categories || []; USERS = users.users || [];
  renderBookTable(); renderCategories(); renderStats(stats); renderUsers();
  const sel = document.getElementById('book-cat-filter');
  sel.innerHTML = '<option value="">All Categories</option>' + CATS.map(c => `<option>${escapeHtml(c.category_name)}</option>`).join('');
  fillBookCategorySelect();
}

/* ---------- Stats ---------- */
function renderStats(s) {
  document.getElementById('stat-total').textContent = s.total_books;
  document.getElementById('stat-copies').textContent = s.total_copies;
  document.getElementById('stat-users').textContent = USERS.length;
  document.getElementById('stat-erf').textContent = USERS.filter(u => u.erf_member_status).length;
  document.getElementById('cat-chips').innerHTML = s.categories.map(c =>
    `<span class="cat-chip">${escapeHtml(c.category_name)}<span class="cnt">${s.by_category[c.category_name] || 0}</span></span>`).join('');
}

/* ---------- Books table ---------- */
function renderBookTable() {
  const q = document.getElementById('book-search').value.toLowerCase().trim();
  const cat = document.getElementById('book-cat-filter').value;
  let list = BOOKS;
  if (cat) list = list.filter(b => b.category === cat);
  if (q) list = list.filter(b =>
    [b.title, b.author, b.isbn].some(f => String(f || '').toLowerCase().includes(q)));
  document.getElementById('book-count').textContent = `${list.length} record${list.length === 1 ? '' : 's'}`;
  document.getElementById('book-rows').innerHTML = list.map(b => `
    <tr>
      <td>${b.book_id}</td>
      <td><strong>${escapeHtml(b.title)}</strong><br><small style="color:var(--muted)">${escapeHtml(b.author)}</small></td>
      <td>${escapeHtml(b.category)}</td>
      <td>${escapeHtml(b.year ?? '—')}</td>
      <td>${escapeHtml(b.isbn || '—')}</td>
      <td>${b.copies}</td>
      <td>${escapeHtml(b.shelf_location || '—')}</td>
      <td class="row-actions">
        <button class="btn btn-primary btn-sm" onclick="editBook(${b.book_id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteBook(${b.book_id})">Delete</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--muted)">No books found.</td></tr>';
}

/* ---------- Book form (create / update) ---------- */
function fillBookCategorySelect() {
  document.getElementById('b-category').innerHTML = CATS.map(c => `<option>${escapeHtml(c.category_name)}</option>`).join('');
}

function openBookModal(book) {
  editingId = book ? book.book_id : null;
  coverDataUrl = '';
  document.getElementById('modal-title').textContent = book ? 'Edit Book' : 'Add New Book';
  document.getElementById('b-title').value = book?.title || '';
  document.getElementById('b-author').value = book?.author || '';
  document.getElementById('b-publisher').value = book?.publisher || '';
  document.getElementById('b-year').value = book?.year ?? '';
  document.getElementById('b-isbn').value = book?.isbn || '';
  document.getElementById('b-language').value = book?.language || '';
  document.getElementById('b-copies').value = book?.copies ?? 1;
  document.getElementById('b-shelf').value = book?.shelf_location || '';
  document.getElementById('b-desc').value = book?.description || '';
  if (book) fillBookCategorySelect();
  document.getElementById('b-category').value = book?.category || CATS[0]?.category_name || '';
  document.getElementById('b-image').value = '';
  document.getElementById('form-error').classList.remove('show');
  document.getElementById('book-modal').classList.add('open');
}

function editBook(id) { openBookModal(BOOKS.find(b => b.book_id === id)); }
function closeBookModal() { document.getElementById('book-modal').classList.remove('open'); }

document.getElementById('b-image').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) { coverDataUrl = ''; return; }
  const reader = new FileReader();
  reader.onload = () => { coverDataUrl = reader.result; };
  reader.readAsDataURL(file);
});

async function saveBook(e) {
  e.preventDefault();
  const err = document.getElementById('form-error');
  err.classList.remove('show');
  const body = {
    title: document.getElementById('b-title').value,
    author: document.getElementById('b-author').value,
    publisher: document.getElementById('b-publisher').value,
    year: document.getElementById('b-year').value,
    isbn: document.getElementById('b-isbn').value,
    category: document.getElementById('b-category').value,
    language: document.getElementById('b-language').value,
    copies: document.getElementById('b-copies').value,
    shelf_location: document.getElementById('b-shelf').value,
    description: document.getElementById('b-desc').value,
    image_data: coverDataUrl,
  };
  const res = await api(editingId ? '/api/books/' + editingId : '/api/books', {
    method: editingId ? 'PUT' : 'POST', body: JSON.stringify(body),
  });
  if (res.error) { err.textContent = res.error; err.classList.add('show'); return; }
  closeBookModal();
  await refreshAll();
}

async function deleteBook(id) {
  if (!confirm('Delete this book record permanently?')) return;
  await api('/api/books/' + id, { method: 'DELETE' });
  await refreshAll();
}

/* ---------- Categories ---------- */
function renderCategories() {
  document.getElementById('cat-list').innerHTML = CATS.map(c => {
    const n = BOOKS.filter(b => b.category === c.category_name).length;
    return `<span class="cat-chip">${escapeHtml(c.category_name)}<span class="cnt">${n} book${n === 1 ? '' : 's'}</span>
      <a href="#" onclick="deleteCategory(${c.category_id});return false;" title="Delete category" style="margin-left:6px;color:var(--red)">✕</a></span>`;
  }).join('');
}

async function addCategory(e) {
  e.preventDefault();
  const err = document.getElementById('cat-error');
  err.classList.remove('show');
  const res = await api('/api/categories', {
    method: 'POST',
    body: JSON.stringify({ category_name: document.getElementById('new-cat').value }),
  });
  if (res.error) { err.textContent = res.error; err.classList.add('show'); return; }
  document.getElementById('new-cat').value = '';
  await refreshAll();
}

async function deleteCategory(id) {
  if (!confirm('Delete this category? (Only allowed if it has no books)')) return;
  const res = await api('/api/categories/' + id, { method: 'DELETE' });
  if (res.error) { alert(res.error); return; }
  await refreshAll();
}

/* ---------- ERF members ---------- */
function renderUsers() {
  document.getElementById('user-rows').innerHTML = USERS.map(u => `
    <tr>
      <td>${u.user_id}</td>
      <td>${escapeHtml(u.username)}</td>
      <td><span class="pill pill-${u.role}">${u.role}</span></td>
      <td><span class="pill ${u.erf_member_status ? 'pill-erf' : 'pill-no'}">${u.erf_member_status ? 'ERF Member' : 'No Access'}</span></td>
      <td>${u.role === 'admin' ? '—' :
        u.erf_member_status
          ? `<button class="btn btn-danger btn-sm" onclick="setErf(${u.user_id},'revoked')">Remove Access</button>`
          : `<button class="btn btn-primary btn-sm" onclick="setErf(${u.user_id},'approved')">Grant Access</button>`}</td>
    </tr>`).join('');
}

async function setErf(userId, status) {
  await api(`/api/admin/users/${userId}/erf`, { method: 'POST', body: JSON.stringify({ status }) });
  await refreshAll();
}

/* ---------- CSV export ---------- */
async function exportCsv() {
  const res = await fetch('/api/export/csv', { credentials: 'same-origin' });
  if (!res.ok) { alert('Export failed. Please log in again.'); return; }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'Department_Geography_Library_Data.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

initAdmin();
