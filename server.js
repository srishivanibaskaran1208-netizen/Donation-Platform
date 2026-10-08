// Donation & Reuse Platform - Express API + static frontend. Storage: db.json (swap for MongoDB/PostgreSQL later).
const express = require('express'), fs = require('fs'), path = require('path');
const bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me', FILE = path.join(__dirname, 'db.json');
let db = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE)) : {
  users: [], donations: [], complaints: [], notes: [],
  categories: ['Clothes', 'Household items', 'Kitchenware', 'Bedding', 'Books & toys']
};
const save = () => fs.writeFileSync(FILE, JSON.stringify(db, null, 1));
const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();
if (!db.users.some(u => u.role === 'admin')) {
  db.users.push({ id: uid(), role: 'admin', name: 'Admin', email: 'admin@donate.local', hash: bcrypt.hashSync('admin123', 10), verified: true });
  save();
}
const strip = ({ hash, ...u }) => u;
const notify = (userId, text) => db.notes.push({ id: uid(), userId, text, at: now(), read: false });
const fail = (res, code, error) => res.status(code).json({ error });

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const auth = (...roles) => (req, res, next) => {
  try {
    const t = jwt.verify((req.headers.authorization || '').slice(7), SECRET);
    req.user = db.users.find(u => u.id === t.id);
    if (!req.user || (roles.length && !roles.includes(req.user.role))) throw 0;
    next();
  } catch { fail(res, 401, 'Please sign in with the right account.'); }
};
const token = u => jwt.sign({ id: u.id }, SECRET, { expiresIn: '7d' });

// ---- Auth ----
app.post('/api/register', (req, res) => {
  const { name, email, password, role, phone, address, city, orgType, description } = req.body;
  if (!name || !email || !password || !city) return fail(res, 400, 'Name, email, password and city are required.');
  if (password.length < 6) return fail(res, 400, 'Password must be at least 6 characters.');
  if (!['donor', 'ngo'].includes(role)) return fail(res, 400, 'Choose donor or NGO / beneficiary.');
  if (db.users.some(u => u.email === email.toLowerCase())) return fail(res, 409, 'That email is already registered.');
  const u = { id: uid(), role, name, email: email.toLowerCase(), hash: bcrypt.hashSync(password, 10), phone, address, city: city.trim(),
    orgType: role === 'ngo' ? orgType || 'NGO' : undefined, description: role === 'ngo' ? description : undefined,
    verified: role === 'donor', createdAt: now() };
  db.users.push(u);
  if (role === 'ngo') db.users.filter(a => a.role === 'admin').forEach(a => notify(a.id, `${name} is waiting for verification.`));
  save(); res.json({ token: token(u), user: strip(u) });
});
app.post('/api/login', (req, res) => {
  const u = db.users.find(x => x.email === (req.body.email || '').toLowerCase());
  if (!u || !bcrypt.compareSync(req.body.password || '', u.hash)) return fail(res, 401, 'Email or password is incorrect.');
  res.json({ token: token(u), user: strip(u) });
});
app.get('/api/me', auth(), (req, res) => res.json(strip(req.user)));
app.put('/api/me', auth(), (req, res) => {
  ['name', 'phone', 'address', 'city', 'description'].forEach(k => { if (req.body[k] !== undefined) req.user[k] = req.body[k]; });
  save(); res.json(strip(req.user));
});

// ---- Directory & categories ----
app.get('/api/categories', (req, res) => res.json(db.categories));
app.post('/api/categories', auth('admin'), (req, res) => {
  const c = (req.body.name || '').trim();
  if (c && !db.categories.includes(c)) { db.categories.push(c); save(); }
  res.json(db.categories);
});
app.get('/api/ngos', auth(), (req, res) => {
  const city = (req.query.city || '').toLowerCase();
  res.json(db.users.filter(u => u.role === 'ngo' && (req.user.role === 'admin' || u.verified) && (!city || u.city.toLowerCase().includes(city))).map(strip));
});

// ---- Donations ----
const view = d => ({ ...d, donor: db.users.find(u => u.id === d.donorId)?.name, ngo: db.users.find(u => u.id === d.ngoId)?.name });
app.post('/api/donations', auth('donor'), (req, res) => {
  const { ngoId, items, address, city, scheduledAt } = req.body;
  const ngo = db.users.find(u => u.id === ngoId && u.role === 'ngo' && u.verified);
  if (!ngo) return fail(res, 400, 'Choose a verified NGO or beneficiary.');
  const clean = (items || []).filter(i => i.category && i.description && i.quantity > 0).map(i => ({ category: i.category, description: String(i.description).slice(0, 200), quantity: Math.floor(i.quantity) }));
  if (!clean.length) return fail(res, 400, 'Add at least one item with a quantity.');
  if (!address || !scheduledAt || isNaN(new Date(scheduledAt))) return fail(res, 400, 'Pickup address and time are required.');
  if (new Date(scheduledAt) < new Date()) return fail(res, 400, 'Pickup time must be in the future.');
  const d = { id: uid(), donorId: req.user.id, ngoId, items: clean, address, city: city || req.user.city, scheduledAt, status: 'Requested', createdAt: now(), history: [{ status: 'Requested', at: now() }] };
  db.donations.push(d);
  notify(ngoId, `New donation request from ${req.user.name} (${clean.reduce((n, i) => n + i.quantity, 0)} items).`);
  save(); res.json(view(d));
});
app.get('/api/donations', auth(), (req, res) => {
  const r = req.user.role;
  res.json(db.donations.filter(d => r === 'admin' || (r === 'donor' ? d.donorId : d.ngoId) === req.user.id).map(view).reverse());
});
const NEXT = { ngo: { Requested: ['Accepted', 'Declined'], Accepted: ['Collected'], Collected: ['Distributed'] }, donor: { Requested: ['Cancelled'], Accepted: ['Cancelled'] } };
app.patch('/api/donations/:id/status', auth('donor', 'ngo'), (req, res) => {
  const d = db.donations.find(x => x.id === req.params.id && (req.user.role === 'donor' ? x.donorId : x.ngoId) === req.user.id);
  if (!d) return fail(res, 404, 'Donation not found.');
  const { status } = req.body;
  if (!(NEXT[req.user.role][d.status] || []).includes(status)) return fail(res, 400, `Cannot move from ${d.status} to ${status}.`);
  d.status = status; d.history.push({ status, at: now() });
  const other = req.user.role === 'ngo' ? d.donorId : d.ngoId;
  notify(other, `Donation ${d.id} is now ${status.toLowerCase()}.`);
  save(); res.json(view(d));
});
app.post('/api/donations/:id/rate', auth('donor'), (req, res) => {
  const d = db.donations.find(x => x.id === req.params.id && x.donorId === req.user.id);
  const n = Number(req.body.rating);
  if (!d || !['Collected', 'Distributed'].includes(d.status) || !(n >= 1 && n <= 5)) return fail(res, 400, 'You can rate 1 to 5 once an item is collected.');
  d.rating = n; save(); res.json(view(d));
});

// ---- Notifications, complaints ----
app.get('/api/notifications', auth(), (req, res) => res.json(db.notes.filter(n => n.userId === req.user.id).reverse().slice(0, 20)));
app.post('/api/complaints', auth('donor', 'ngo'), (req, res) => {
  if (!req.body.text) return fail(res, 400, 'Describe the problem.');
  db.complaints.push({ id: uid(), userId: req.user.id, from: req.user.name, donationId: req.body.donationId, text: String(req.body.text).slice(0, 1000), status: 'Open', at: now() });
  save(); res.json({ ok: true });
});

// ---- Admin ----
app.get('/api/admin/complaints', auth('admin'), (req, res) => res.json([...db.complaints].reverse()));
app.patch('/api/admin/complaints/:id', auth('admin'), (req, res) => {
  const c = db.complaints.find(x => x.id === req.params.id);
  if (!c) return fail(res, 404, 'Not found.');
  c.status = 'Resolved'; notify(c.userId, 'Your complaint has been resolved by the admin team.'); save(); res.json(c);
});
app.put('/api/admin/ngos/:id/verify', auth('admin'), (req, res) => {
  const n = db.users.find(u => u.id === req.params.id && u.role === 'ngo');
  if (!n) return fail(res, 404, 'Not found.');
  n.verified = req.body.verified !== false;
  notify(n.id, n.verified ? 'Your organisation is verified. You can now receive donations.' : 'Your verification was removed.');
  save(); res.json(strip(n));
});
app.get('/api/admin/stats', auth('admin'), (req, res) => {
  const D = db.donations, count = s => D.filter(d => d.status === s).length;
  const donors = db.users.filter(u => u.role === 'donor'), per = {};
  D.forEach(d => per[d.donorId] = (per[d.donorId] || 0) + 1);
  const givers = Object.values(per), repeat = givers.filter(n => n > 1).length;
  const hrs = D.filter(d => d.status === 'Collected' || d.status === 'Distributed').map(d => (new Date(d.history.find(h => h.status === 'Collected').at) - new Date(d.createdAt)) / 36e5);
  const rated = D.filter(d => d.rating);
  res.json({ donors: donors.length, ngos: db.users.filter(u => u.role === 'ngo').length, pendingNgos: db.users.filter(u => u.role === 'ngo' && !u.verified).length,
    donations: D.length, collected: count('Collected') + count('Distributed'), distributed: count('Distributed'),
    repeatRate: givers.length ? Math.round(100 * repeat / givers.length) : 0,
    avgCollectionHours: hrs.length ? +(hrs.reduce((a, b) => a + b, 0) / hrs.length).toFixed(1) : 0,
    avgRating: rated.length ? +(rated.reduce((a, d) => a + d.rating, 0) / rated.length).toFixed(1) : 0 });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Donation platform running at http://localhost:${PORT}  (admin: admin@donate.local / admin123)`));
