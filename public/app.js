const $ = (selector) => document.querySelector(selector);
const loginView = $('#login-view'), appView = $('#app-view'), industry = $('#industry'), list = $('#company-list'), detail = $('#detail');
async function api(url, options = {}) { const response = await fetch(url, options); const data = await response.json().catch(() => ({})); if (!response.ok) { if (response.status === 401) { showApp(false); throw new Error('Tu sesión expiró. Ingresa nuevamente.'); } throw new Error(data.error || 'Ocurrió un error.'); } return data; }
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
    list.innerHTML = companies.map(company => `<button class="company-link" data-id="${company.id}">${escapeHtml(company.name)}<span class="company-meta">${escapeHtml([company.city, company.country].filter(Boolean).join(', '))}</span><span class="company-count">${company.contactCount} contacto${company.contactCount === 1 ? '' : 's'}</span></button>`).join('');
    list.querySelectorAll('.company-link').forEach(button => button.addEventListener('click', () => selectCompany(button.dataset.id, button)));
  } catch (e) { $('#result-count').textContent = e.message; }
}
industry.addEventListener('change', () => { if (industry.value) searchCompanies(); });
$('#search-companies').addEventListener('click', searchCompanies);
async function selectCompany(id, button) {
  list.querySelectorAll('.company-link').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  const [row, contacts] = await Promise.all([api(`/api/companies/${id}`), api(`/api/companies/${id}/contacts`)]);
  detail.className = 'detail-card';
  const contactFields = new Set(['First Name','Last Name','Title','Email','Work Direct Phone','Home Phone','Mobile Phone','Corporate Phone','Person Linkedin Url','Secondary Email']);
  const entries = Object.entries(row).filter(([key]) => key !== 'Technologies' && !contactFields.has(key));
  const technologies = row.Technologies;
  const contactRows = contacts.map(contact => {
    const name = [contact['First Name'], contact['Last Name']].filter(Boolean).join(' ') || 'Contacto sin nombre';
    const links = [contact.Email && `<a class="contact-link" href="mailto:${escapeHtml(contact.Email)}">${escapeHtml(contact.Email)}</a>`, contact['Person Linkedin Url'] && renderFieldValue('Person Linkedin Url', contact['Person Linkedin Url'])].filter(Boolean).join(' · ');
    return `<div class="contact-row"><div><strong>${escapeHtml(name)}</strong><span>${escapeHtml(contact.Title || 'Cargo no disponible')}</span></div><div class="contact-links">${links || '—'}</div></div>`;
  }).join('');
  detail.innerHTML = `<div class="detail-header"><div><p>Empresa seleccionada</p><h2>${escapeHtml(row['Company Name'] || 'Empresa sin nombre')}</h2><p>${escapeHtml(row.Industry || '')}</p></div><div class="detail-actions"><a class="download" href="/api/companies/${id}/csv">Descargar CSV (${contacts.length} contactos)</a><button class="playbook-button" id="generate-playbook" type="button">🧭 Playbook</button></div></div><div class="fields">${entries.map(([key, value]) => `<div class="field"><span class="field-name">${escapeHtml(key)}</span><span class="field-value">${renderFieldValue(key, value)}</span></div>`).join('')}<div class="field field-wide"><span class="field-name">Technologies</span><span class="field-value">${escapeHtml(technologies || '—')}</span></div></div><section class="contacts-section"><h3>👥 Contactos de la empresa <span>${contacts.length}</span></h3><div class="contacts-list">${contactRows}</div></section><div id="playbook-output"></div>`;
  $('#generate-playbook').addEventListener('click', () => generatePlaybook(id));
}
$('#login-form').addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; $('#login-error').textContent = ''; const body = Object.fromEntries(new FormData(form)); try { await api('/api/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) }); form.reset(); showApp(true); } catch (e) { $('#login-error').textContent = e.message; } });
$('#logout').addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); showApp(false); });
function showError(message) { $('#login-error').textContent = message; }
function renderFieldValue(key, value) { const text = String(value || '').trim(); if (!text) return '—'; const linkFields = ['Website', 'Person Linkedin Url', 'Company Linkedin Url']; if (linkFields.includes(key) && /^https?:\/\//i.test(text)) return `<a class="field-link" href="${escapeHtml(text)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`; return escapeHtml(text); }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[character])); }
api('/api/session').then(({ authenticated }) => showApp(authenticated)).catch(() => showApp(false));


async function generatePlaybook(id, regenerate = false) {
  const button = $('#generate-playbook');
  const output = $('#playbook-output');
  button.disabled = true; button.textContent = 'Generando…';
  output.innerHTML = '<div class="playbook-loading">Preparando playbook personalizado…</div>';
  try {
    const playbook = await api(`/api/companies/${id}/playbook${regenerate ? '?regenerate=1' : ''}`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}' });
    const render = (items) => items.map(item => `<div class="playbook-item"><span class="playbook-item-icon">${escapeHtml(item.icon)}</span><div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.text)}</p></div></div>`).join('');
    const origin = playbook.source === 'cache' ? 'Playbook guardado para esta cuenta' : 'Playbook generado y guardado';
    output.innerHTML = `<section class="playbook-section"><article class="playbook-card"><h3>🗣️ Key Talking Points</h3>${render(playbook.talking_points)}</article><article class="playbook-card"><h3>🎯 Preguntas clave de calificación</h3>${render(playbook.qualifying_questions)}</article><p class="playbook-origin">${origin}</p></section>`;
    button.disabled = false; button.textContent = '↻ Regenerar Playbook'; button.onclick = () => generatePlaybook(id, true);
  } catch (error) {
    output.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
    button.disabled = false; button.textContent = '🧭 Playbook';
  }
}