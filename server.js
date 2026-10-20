import express from 'express';
import cookieSession from 'cookie-session';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 3000;
const adminUser = process.env.ADMIN_USER || 'admin';
const adminPassword = process.env.ADMIN_PASSWORD;
const sessionSecret = process.env.SESSION_SECRET || 'change-this-session-secret';
const leads = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'leads.json'), 'utf8'));
const columns = leads.length ? Object.keys(leads[0]) : [];
const industryColumn = columns.find(column => column.trim().toLowerCase() === 'industry') || 'Industry';

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cookieSession({ name: 'jamf_session', keys: [sessionSecret], httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 }));

function isAuthenticated(req) { return Boolean(req.session?.authenticated); }
function requireAuth(req, res, next) { if (!isAuthenticated(req)) return res.status(401).json({ error: 'No autorizado' }); next(); }
function csvEscape(value) { const text = String(value ?? ''); return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }

app.post('/api/login', (req, res) => {
  if (!adminPassword) return res.status(500).json({ error: 'Falta configurar ADMIN_PASSWORD en Railway.' });
  if (req.body.username === adminUser && req.body.password === adminPassword) { req.session = { authenticated: true }; return res.json({ ok: true }); }
  return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
});
app.post('/api/logout', (req, res) => { req.session = null; res.json({ ok: true }); });
app.get('/api/session', (req, res) => res.json({ authenticated: isAuthenticated(req) }));
app.get('/api/industries', requireAuth, (req, res) => {
  const industries = [...new Set(leads.map(row => row[industryColumn]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  res.json(industries);
});
app.get('/api/companies', requireAuth, (req, res) => {
  const industry = String(req.query.industry || '');
  if (!industry) return res.json([]);
  res.json(leads.filter(row => row[industryColumn] === industry).map((row, index) => ({ id: leads.indexOf(row), name: row['Company Name'] || 'Empresa sin nombre', city: row['Company City'] || row.City || '', country: row['Company Country'] || row.Country || '' })));
});
app.get('/api/companies/:id', requireAuth, (req, res) => {
  const row = leads[Number(req.params.id)];
  if (!row) return res.status(404).json({ error: 'Empresa no encontrada.' });
  const normalizedRow = Object.fromEntries(columns.map(column => [column, row[column] ?? '']));
  res.json(normalizedRow);
});
app.get('/api/companies/:id/csv', requireAuth, (req, res) => {
  const row = leads[Number(req.params.id)];
  if (!row) return res.status(404).send('Empresa no encontrada');
  const csv = `${columns.map(csvEscape).join(',')}\r\n${columns.map(column => csvEscape(row[column])).join(',')}\r\n`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="jamf-lead-${Number(req.params.id) + 1}.csv"`);
  res.send('\ufeff' + csv);
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(port, () => console.log(`JAMF Lead Gen System listening on ${port}`));

