import express from 'express';
import cookieSession from 'cookie-session';
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';
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
const portalColumns = columns.includes('# Devices IOS') ? columns : [...columns, '# Devices IOS'];
if (!portalColumns.includes('Apple Customer')) portalColumns.push('Apple Customer');
const { Pool } = pg;
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes('railway') ? { rejectUnauthorized: false } : undefined }) : null;
let databaseReady = null;
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
async function ensureDatabase() {
  if (!pool) return false;
  if (!databaseReady) databaseReady = pool.query(`CREATE TABLE IF NOT EXISTS jamf_playbooks (company_key TEXT PRIMARY KEY, context_hash TEXT NOT NULL, playbook_json JSONB NOT NULL, model TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`).then(() => true).catch(error => { console.error('Playbook database unavailable:', error.message); return false; });
  return databaseReady;
}
const PLAYBOOK_PROMPT_VERSION = 'security-insights-v2';
function contextHash(value) { return crypto.createHash('sha256').update(JSON.stringify({ promptVersion: PLAYBOOK_PROMPT_VERSION, ...value })).digest('hex'); }
function isAppleCustomer(row) { return /\b(apple|ios|iphone|ipad|macos|jamf)\b/i.test(String(row.Technologies || '')) ? 'Yes' : 'No'; }
function rowValue(row, column) { return column === 'Apple Customer' ? isAppleCustomer(row) : (row[column] ?? ''); }
function csvEscape(value) { const text = String(value ?? ''); return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }

function playbookContext(row) {
  const allowed = ['Company Name', 'Industry', '# Employees', '# Devices IOS', 'Apple Customer', 'Technologies', 'Solución JAMF Recomendada', 'Approach Comercial Recomendado', 'Title', 'Company City', 'Company Country', 'Website'];
  const context = Object.fromEntries(allowed.filter(key => portalColumns.includes(key)).map(key => [key, row[key] ?? '']));
  context['Account contact count'] = leads.filter(candidate => companyKey(candidate) === companyKey(row)).length;
  return context;
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
      system: 'Eres un estratega senior de ciberseguridad y ventas de Jamf para LATAM. Tu trabajo no es describir productos ni repetir la columna Technologies. Debes producir insights específicos y accionables para la cuenta. Analiza el sector, tamaño, país, cargo del contacto, Apple Customer, tecnologías detectadas y número de dispositivos iOS si existe. Si # Devices IOS está vacío o es bajo, asume explícitamente que cada dispositivo sigue siendo un punto potencial de vulnerabilidad, pero no inventes un número. En talking_points, genera exactamente cinco bullet points de seguridad informática, cada uno con: una hipótesis de exposición o riesgo concreta para esta cuenta, por qué esa hipótesis es relevante para su sector o tamaño, y cómo Jamf podría reducir ese riesgo en dispositivos iOS. No listes productos de forma aislada. Conecta cada insight con una consecuencia de negocio o cumplimiento. En qualifying_questions, genera exactamente cinco preguntas de descubrimiento distintas entre sí, adaptadas al rol del contacto y a los riesgos inferidos. Cada pregunta debe servir para validar o refutar una hipótesis concreta del análisis, no preguntar genéricamente cómo administran dispositivos. Evita frases intercambiables, preguntas repetidas, claims no soportados y texto promocional. Si faltan datos, conviértelos en una pregunta de validación. Devuelve únicamente JSON válido sin markdown, con exactamente cinco objetos con icon, title y text en talking_points y qualifying_questions. Playbook base:\\n' + playbookSource content: 'Contexto de la empresa:\n' + JSON.stringify(playbookContext(row), null, 2) }]
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
  try { return new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw).hostname.replace(/^www\./, ''); }
  catch { return raw.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, ''); }
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
  const normalizedRow = Object.fromEntries(portalColumns.map(column => [column, rowValue(row, column)]));
  res.json(normalizedRow);
});
app.post('/api/companies/:id/playbook', requireAuth, async (req, res) => {
  const row = leads[Number(req.params.id)];
  if (!row) return res.status(404).json({ error: 'Empresa no encontrada.' });
  const context = playbookContext(row);
  const key = companyKey(row);
  const hash = contextHash(context);
  const forceRegenerate = req.query.regenerate === '1';
  try {
    if (!forceRegenerate && await ensureDatabase()) {
      const cached = await pool.query('SELECT playbook_json, model, created_at FROM jamf_playbooks WHERE company_key = $1 AND context_hash = $2', [key, hash]);
      if (cached.rows[0]) return res.json({ ...cached.rows[0].playbook_json, source: 'cache', model: cached.rows[0].model, created_at: cached.rows[0].created_at });
    }
    const playbook = await generateClaudePlaybook(row);
    if (await ensureDatabase()) {
      await pool.query('INSERT INTO jamf_playbooks (company_key, context_hash, playbook_json, model) VALUES ($1, $2, $3, $4) ON CONFLICT (company_key) DO UPDATE SET context_hash = EXCLUDED.context_hash, playbook_json = EXCLUDED.playbook_json, model = EXCLUDED.model, created_at = NOW()', [key, hash, JSON.stringify(playbook), process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001']);
    }
    res.json({ ...playbook, source: 'generated', model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001' });
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
  const csv = portalColumns.map(csvEscape).join(',') + '\r\n' + matchingRows.map(candidate => portalColumns.map(column => csvEscape(rowValue(candidate, column))).join(',')).join('\r\n') + '\r\n';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="jamf-lead-${Number(req.params.id) + 1}-empresa.csv"`);
  res.send('\ufeff' + csv);
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(port, () => console.log(`JAMF Lead Gen System listening on ${port}`));

