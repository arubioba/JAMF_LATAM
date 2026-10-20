const $ = (selector) => document.querySelector(selector);
const loginView = $('#login-view'), appView = $('#app-view'), industry = $('#industry'), list = $('#company-list'), detail = $('#detail');
async function api(url, options = {}) { const response = await fetch(url, options); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || 'Ocurrió un error.'); return data; }
function showApp(authenticated) { loginView.classList.toggle('hidden', authenticated); appView.classList.toggle('hidden', !authenticated); if (authenticated) loadIndustries(); }
async function loadIndustries() { try { let industries = await api('/api/industries'); if (!industries.length) { const fallback = await fetch('/industries.json'); industries = await fallback.json(); } industry.innerHTML = '<option value="">Selecciona una industria</option>' + industries.map(value => `<option>${escapeHtml(value)}</option>`).join(''); } catch (e) { try { const fallback = await fetch('/industries.json'); const industries = await fallback.json(); industry.innerHTML = '<option value="">Selecciona una industria</option>' + industries.map(value => `<option>${escapeHtml(value)}</option>`).join(''); } catch { showError(e.message); } } }
async function searchCompanies() {
  list.innerHTML = '';
  detail.className = 'detail-card empty';
  detail.innerHTML = '<div><span class="empty-icon">⌕</span><h2>Selecciona una empresa</h2><p>Elige una empresa de la lista para consultar sus datos completos.</p></div>';
  if (!industry.value) { $('#result-count').textContent = 'Selecciona una industria para comenzar.'; return; }
  try {
    const companies = await api(`/api/companies?industry=${encodeURIComponent(industry.value)}`);
    $('#result-count').textContent = `${companies.length} empresa${companies.length === 1 ? '' : 's'} encontrada${companies.length === 1 ? '' : 's'}.`;
    list.innerHTML = companies.map(company => `<button class="company-link" data-id="${company.id}">${escapeHtml(company.name)}<span class="company-meta">${escapeHtml([company.city, company.country].filter(Boolean).join(', '))}</span></button>`).join('');
    list.querySelectorAll('.company-link').forEach(button => button.addEventListener('click', () => selectCompany(button.dataset.id, button)));
  } catch (e) { $('#result-count').textContent = e.message; }
}
industry.addEventListener('change', () => { if (industry.value) searchCompanies(); });
$('#search-companies').addEventListener('click', searchCompanies);
async function selectCompany(id, button) { list.querySelectorAll('.company-link').forEach(item => item.classList.remove('active')); button.classList.add('active'); const row = await api(`/api/companies/${id}`); detail.className = 'detail-card'; const entries = Object.entries(row).filter(([key]) => key !== 'Technologies'); const technologies = row.Technologies; detail.innerHTML = `<div class="detail-header"><div><p>Empresa seleccionada</p><h2>${escapeHtml(row['Company Name'] || 'Empresa sin nombre')}</h2><p>${escapeHtml(row.Industry || '')}</p></div><a class="download" href="/api/companies/${id}/csv">Descargar CSV</a></div><div class="fields">${entries.map(([key, value]) => `<div class="field"><span class="field-name">${escapeHtml(key)}</span><span class="field-value">${escapeHtml(value || '—')}</span></div>`).join('')}<div class="field field-wide"><span class="field-name">Technologies</span><span class="field-value">${escapeHtml(technologies || '—')}</span></div></div>`; }
$('#login-form').addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; $('#login-error').textContent = ''; const body = Object.fromEntries(new FormData(form)); try { await api('/api/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) }); form.reset(); showApp(true); } catch (e) { $('#login-error').textContent = e.message; } });
$('#logout').addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); showApp(false); });
function showError(message) { $('#login-error').textContent = message; }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[character])); }
api('/api/session').then(({ authenticated }) => showApp(authenticated)).catch(() => showApp(false));

