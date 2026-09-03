// Polytek of Redding lead pipeline — Vercel function.
// Ported from Elite (Powrful-Media/elite-protective-website-rebuild api/contact.js),
// current Aug-17+ design: validate here, then POST to a Google Apps Script web app
// that writes the Powrful-owned Sheet and sends all emails via Gmail.
// Differences from Elite, on purpose:
//   - Field set matches Redding's 7 forms (First/Last Name, Phone, Email, ZIP,
//     Service Interest, Project Description) plus a page identifier.
//   - No Vercel BotID: this repo is static with no package.json, and adding a
//     build step violates the repo's "no build" deploy contract. Honeypot,
//     form-age timing, and rate limiting are kept.
// Env vars (Vercel project settings, Preview AND Production):
//   LEAD_WEBHOOK_URL    — the Apps Script /exec URL
//   LEAD_WEBHOOK_SECRET — shared secret, 32+ chars, must match the script CONFIG

const MAX_BODY_BYTES = 12_000;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const MIN_FORM_AGE_MS = 2_000;
const MAX_FORM_AGE_MS = 24 * 60 * 60 * 1000;
const requestBuckets = new Map();

const SERVICES = new Set(['Garage', 'Patio', 'Pool Deck', 'Driveway', 'Commercial', 'Something else']);
const FIELDS = Object.freeze({
  firstName: { max: 90, required: true, format: /^[\p{L}\p{M}\d .,''()-]+$/u },
  lastName: { max: 90, format: /^[\p{L}\p{M}\d .,''()-]*$/u },
  email: { max: 254, required: true },
  phone: { max: 30, required: true },
  zip: { max: 12, format: /^[\d -]*$/ },
  service: { max: 20, required: true },
  details: { max: 2000, multiline: true },
  page: { max: 120 },
});

const clean = (value, max = 200) =>
  String(value ?? '').normalize('NFKC').replace(/[<>\u0000-\u001f\u007f]/g, '').trim().slice(0, max);

const normalizeField = (value, rule) => {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') return null;
  let out = value.normalize('NFKC').replace(/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  out = rule.multiline
    ? out.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim()
    : out.replace(/\s+/g, ' ').trim();
  return out;
};

const emailPattern = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;
const validEmail = (v) => {
  if (!v || v.length > 254 || !emailPattern.test(v)) return false;
  const [local, domain] = v.split('@');
  return local.length <= 64 && domain.length <= 253 && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..');
};
const validPhone = (v) => {
  const digits = v.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15 && /^[0-9+().\-\s]+$/.test(v);
};

const clientIp = (req) =>
  clean(String(req.headers?.['x-forwarded-for'] || '').split(',')[0] || req.socket?.remoteAddress || 'unknown', 100);

const rateLimited = (ip, now = Date.now()) => {
  if (requestBuckets.size > 10_000) requestBuckets.clear();
  const entries = (requestBuckets.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (entries.length >= RATE_LIMIT_MAX) return true;
  entries.push(now);
  requestBuckets.set(ip, entries);
  return false;
};

const fail = (req, stage, details = {}) =>
  console.error(JSON.stringify({ service: 'redding-lead', stage, requestId: clean(req.headers?.['x-vercel-id'] || 'n/a', 180), ...details, timestamp: new Date().toISOString() }));

const SORRY = 'We could not send your request. Please call (530) 338-6085 and we’ll take care of you.';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).setHeader('Allow', 'POST').json({ error: 'Method not allowed.' });
  if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json')) {
    return res.status(415).json({ error: 'Please submit the form from our website.' });
  }
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'Invalid submission.' });
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_BODY_BYTES) return res.status(413).json({ error: 'Submission is too large.' });

  // Honeypot: accept silently, deliver nothing.
  if (body.website) return res.status(200).json({ ok: true });

  const startedAt = Number(body.formStartedAt);
  const age = Date.now() - startedAt;
  if (!Number.isFinite(startedAt) || age < MIN_FORM_AGE_MS || age > MAX_FORM_AGE_MS) {
    return res.status(400).json({ error: 'Please take a moment to complete the form and try again.' });
  }
  if (rateLimited(clientIp(req))) {
    return res.status(429).setHeader('Retry-After', '900').json({ error: 'Too many requests. Please wait a few minutes and try again.' });
  }

  const lead = {};
  for (const [field, rule] of Object.entries(FIELDS)) {
    const value = normalizeField(body[field], rule);
    if (value === null || (rule.required && !value) || value.length > rule.max || (value && rule.format && !rule.format.test(value))) {
      return res.status(400).json({ error: 'Please check the form fields and try again.' });
    }
    lead[field] = value;
  }
  lead.email = lead.email.toLowerCase();
  if (!validEmail(lead.email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (!validPhone(lead.phone)) return res.status(400).json({ error: 'Please enter a valid phone number.' });
  if (!SERVICES.has(lead.service)) return res.status(400).json({ error: 'Please choose a project type from the list.' });
  lead.name = lead.lastName ? `${lead.firstName} ${lead.lastName}` : lead.firstName;

  const webhookUrl = String(process.env.LEAD_WEBHOOK_URL || '').trim();
  const webhookSecret = String(process.env.LEAD_WEBHOOK_SECRET || '').trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(webhookUrl) || webhookSecret.length < 32) {
    fail(req, 'configuration', { hasUrl: Boolean(webhookUrl), hasSecret: Boolean(webhookSecret) });
    return res.status(503).json({ error: SORRY });
  }

  try {
    const delivery = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      redirect: 'follow',
      body: JSON.stringify({
        token: webhookSecret,
        request_id: clean(req.headers?.['x-vercel-id'] || 'n/a', 180),
        lead,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const result = await delivery.json().catch(() => null);
    if (!delivery.ok || result?.ok !== true) {
      fail(req, 'lead_webhook', { providerStatus: delivery.status, providerError: clean(result?.error || 'invalid_response', 80) });
      return res.status(502).json({ error: SORRY });
    }
    return res.status(200).json({ ok: true });
  } catch (error) {
    fail(req, 'lead_webhook_request', { errorName: clean(error?.name || 'Error', 80) });
    return res.status(502).json({ error: SORRY });
  }
}
