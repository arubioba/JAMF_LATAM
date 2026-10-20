import express from 'express';
import cookieSession from 'cookie-session';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1);
const port = process.env.PORT || 3000;
const adminUser = process.env.ADMIN_USER || 'admin';
const adminPassword = process.env.ADMIN_PASSWORD;
const sessionSecret = process.env.SESSION_SECRET || 'change-this-session-secret';
const leads = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'leads.json'), 'utf8'));
const columns = leads.length ? Object.keys(leads[0]) : [];
const industryColumn = columns.find(column => column.trim().toLowerCase() === 'industry') || 'Industry';
const industries = [...new Set(leads.map(row => String(row[industryColumn] ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
const playbookSource = fs.existsSync(path.join(__dirname, 'data', 'playbook_comercial_jamf.md'))
  ? fs.readFileSync(path.join(__dirname, 'data', 'playbook_comercial_jamf.md'), 'utf8')
  : '';

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cookieSession({ name: 'jamf_session', keys: [sessionSecret], httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', proxy: true, maxAge: 8 * 60 * 60 * 1000 }));

function isAuthenticated(req) { return Boolean(req.session?.authenticated); }
function requireAuth(req, res, next) { if (!isAuthenticated(req)) return res.status(401).json({ error: 'No autorizado' }); next(); }
function csvEscape(value) { const text = String(value ?? ''); return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }

function playbookContext(row) {
  const allowed = ['Company Name', 'Industry', '# Employees', 'Technologies', 'Solución JAMF Recomendada', 'Approach Comercial Recomendado', 'Title', 'Company City', 'Company Country', 'Website'];
  return Object.fromEntries(allowed.filter(key => columns.includes(key)).map(key => [key, row[key] ?? '']));
}
function fallbackPlaybook(row) {
  const company = row['Company Name'] || 'esta empresa';
  const industry = row['Industry'] || 'su industria';
  const tech = row['Technologies'] || 'su entorno tecnológico actual';
  const topics = [
    ['🚀', 'Productividad de primera línea', company + ' puede conectar a sus equipos de ' + industry + ' con las aplicaciones y datos que necesitan en dispositivos Apple, mejorando la experiencia del cliente.'],
    ['🛡️', 'Seguridad y Zero Trust', 'Explore cómo proteger el entorno de ' + company + ' con controles de acceso, bloqueo remoto y defensa contra amenazas, especialmente junto a ' + tech + '.'],
    ['✅', 'Cumplimiento automatizado', 'Conecte las políticas de Jamf con los requisitos de ' + industry + ': configuraciones seguras, actualizaciones y verificaciones remotas.'],
    ['⚡', 'Despliegue Zero-Touch', 'Posicione la suite Jamf como una forma de entregar equipos listos para trabajar, automatizar aplicaciones y escalar sin cargar al equipo de TI.'],
    ['📱', 'Dispositivos compartidos', 'Jamf Setup y Jamf Reset permiten adaptar el equipo por rol, usar SSO y limpiar los datos al finalizar cada jornada.']
  ].map(([icon, title, text]) => ({ icon, title, text }));
  const questions = [
    ['🔎', 'Visibilidad y control', '¿Cómo administra y monitorea hoy los dispositivos Apple distribuidos en ' + company + '?'],
    ['🛡️', 'Riesgo y cumplimiento', '¿Qué controles utilizan para demostrar cumplimiento y evitar fugas de información en ' + industry + '?'],
    ['💬', 'Fricción operativa', '¿Qué impacto tiene para sus clientes y colaboradores que un equipo falle o no tenga la aplicación correcta?'],
    ['👥', 'Equipos compartidos', '¿Cómo aseguran que cada turno acceda solo a las herramientas de su rol y deje el equipo limpio?'],
    ['📈', 'Carga de TI y escala', '¿Cuánto trabajo manual requeriría desplegar cientos de dispositivos Apple en ' + company + '?']
  ].map(([icon, title, text]) => ({ icon, title, text }));
  return { talking_points: topics, qualifying_questions: questions, source: 'fallback' };
}
function normalizePlaybook(value, row) {
  const fallback = fallbackPlaybook(row);
  const clean = (items, fallbackItems) => Array.isArray(items) && items.length >= 5
    ? items.slice(0, 5).map((item, index) => ({ icon: String(item.icon || fallbackItems[index].icon), title: String(item.title || fallbackItems[index].title), text: String(item.text || fallbackItems[index].text) }))
    : fallbackItems;
  return { talking_points: clean(value?.talking_points, fallback.talking_points), qualifying_questions: clean(value?.qualifying_questions, fallback.qualifying_questions), source: value?.source || 'claude' };
}
async function generateClaudePlaybook(row) {
  if (!process.env.ANTHROPIC_API_KEY) return fallbackPlaybook(row);
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
      max_tokens: 1800,
      system: 'Eres un especialista senior de ventas de Jamf para LATAM. Personaliza un playbook comercial práctico en español usando exclusivamente el contexto de la empresa y el playbook base. No inventes datos, no menciones que eres IA. Devuelve únicamente JSON válido sin markdown, con exactamente cinco objetos con icon, title y text en talking_points y qualifying_questions. Playbook base:\n' + playbookSource,
      messages: [{ role: 'user', content: 'Contexto de la empresa:\n' + JSON.stringify(playbookContext(row), null, 2) }]
    })
  });
  if (!response.ok) throw new Error('Claude playbook request failed');
  const payload = await response.json();
  const text = payload.content?.find(item => item.type === 'text')?.text;
  if (!text) throw new Error('Claude returned no playbook');
  const cleanText = text.replace(/^\s*\`\`\`json\s*/i, '').replace(/\s*\`\`\`\s*$/i, '').trim();
  return normalizePlaybook(JSON.parse(cleanText), row);
}

app.post('/api/login', (req, res) => {
  if (!adminPassword) return res.status(500).json({ error: 'Falta configurar ADMIN_PASSWORD en Railway.' });
  if (req.body.username === adminUser && req.body.password === adminPassword) { req.session = { authenticated: true }; return res.json({ ok: true }); }
  return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
});
app.post('/api/logout', (req, res) => { req.session = null; res.json({ ok: true }); });
app.get('/api/session', (req, res) => res.json({ authenticated: isAuthenticated(req) }));
app.get('/api/industries', requireAuth, (req, res) => {
  const industries = [...new Set(leads.map(row => String(row[industryColumn] ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  res.json(industries);
});
function normalizeDomain(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  try { return new URL(/^https?:\\/\\//i.test(raw) ? raw : 'https://' + raw).hostname.replace(/^www\\./, ''); }
  catch { return raw.replace(/^https?:\\/\\//, '').split('/')[0].replace(/^www\\./, ''); }
}
function companyKey(row) {
  return normalizeDomain(row.Website) || String(row['Company Name'] || '').trim().toLowerCase() || 'company-' + leads.indexOf(row);
}
function companyGroups(industry) {
  const groups = new Map();
  leads.forEach((row, index) => {
    if (row[industryColumn] !== industry) return;
    const key = companyKey(row);
    if (!groups.has(key)) groups.set(key, { id: index, key, rows: [] });
    groups.get(key).rows.push(row);
  });
  return [...groups.values()];
}
app.get('/api/companies', requireAuth, (req, res) => {
  const industry = String(req.query.industry || '');
  if (!industry) return res.json([]);
  res.json(companyGroups(industry).map(group => {
    const row = group.rows[0];
    return { id: group.id, name: row['Company Name'] || 'Empresa sin nombre', city: row['Company City'] || row.City || '', country: row['Company Country'] || row.Country || '', domain: group.key, contactCount: group.rows.length };
  }));
});
app.get('/api/companies/:id', requireAuth, (req, res) => {
  const row = leads[Number(req.params.id)];
  if (!row) return res.status(404).json({ error: 'Empresa no encontrada.' });
  const normalizedRow = Object.fromEntries(columns.map(column => [column, row[column] ?? '']));
  res.json(normalizedRow);
});
app.post('/api/companies/:id/playbook', requireAuth, async (req, res) => {
  const row = leads[Number(req.params.id)];
  if (!row) return res.status(404).json({ error: 'Empresa no encontrada.' });
  try {
    res.json(await generateClaudePlaybook(row));
  } catch (error) {
    console.error('Playbook generation fallback:', error.message);
    res.json(fallbackPlaybook(row));
  }
});
app.get('/api/companies/:id/contacts', requireAuth, (req, res) => {
  const row = leads[Number(req.params.id)];
  if (!row) return res.status(404).json({ error: 'Empresa no encontrada.' });
  const key = companyKey(row);
  res.json(leads.filter(candidate => companyKey(candidate) === key).map(candidate => Object.fromEntries(columns.map(column => [column, candidate[column] ?? '']))));
});
app.get('/api/companies/:id/csv', requireAuth, (req, res) => {
  const row = leads[Number(req.params.id)];
  if (!row) return res.status(404).send('Empresa no encontrada');
  const key = companyKey(row);
  const matchingRows = leads.filter(candidate => companyKey(candidate) === key);
  const csv = columns.map(csvEscape).join(',') + '\\r\\n' + matchingRows.map(candidate => columns.map(column => csvEscape(candidate[column])).join(',')).join('\\r\\n') + '\\r\\n';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="jamf-lead-${Number(req.params.id) + 1}-empresa.csv"`);
  res.send('\\ufeff' + csv);
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(port, () => console.log(`JAMF Lead Gen System listening on ${port}`));

