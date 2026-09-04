// Polytek of Redding lead pipeline — Google Apps Script web app.
// Ported from Elite's Code.gs. Deployed under the Powrful Google account.
// Receives leads from the site's Vercel function (api/lead.js), writes the
// Powrful-owned Sheet, emails the dealer instantly, confirms to the customer,
// and sends a daily digest. The Larsons only ever see the emails.
//
// TESTING vs LIVE: dealerEmail is the single line to flip.
//   Testing: a Powrful inbox. Live: Josh Larson's inbox.

const CONFIG = Object.freeze({
  spreadsheetId: '__REDDING_SPREADSHEET_ID__',   // new Sheet, Powrful-owned, Redding only
  sheetName: 'Sheet1',
  dealerEmail: 'media@powrful.com',              // ← THE ONE LINE: flip to Josh at launch
  dealerName: 'Polytek of Redding',
  sitePhone: '(530) 338-6085',
  reportEmails: ['info@powrful.com', 'jay@powrful.com'],
  timeZone: 'America/Los_Angeles',               // Redding is Pacific (Elite was Central)
  webhookSecret: '__WEBHOOK_SECRET__',           // 32+ chars, must match Vercel env
});

const HEADER = Object.freeze([
  'Received', 'Request ID', 'Page', 'Name', 'Email', 'Phone',
  'ZIP', 'Service Interest', 'Project Description',
]);

function doGet() {
  return jsonResponse_({ ok: true, service: 'redding-lead-pipeline' });
}

function doPost(event) {
  try {
    const payload = JSON.parse(event?.postData?.contents || '{}');
    if (!safeEqual_(String(payload.token || ''), CONFIG.webhookSecret)) {
      return jsonResponse_({ ok: false, error: 'unauthorized' });
    }
    const lead = payload.lead || {};
    if (!lead.name || !lead.email || !lead.phone || !lead.service) {
      return jsonResponse_({ ok: false, error: 'invalid_lead' });
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const sheet = SpreadsheetApp.openById(CONFIG.spreadsheetId).getSheetByName(CONFIG.sheetName);
      if (!sheet) throw new Error('Lead sheet not found.');
      if (sheet.getLastRow() === 0) sheet.appendRow([...HEADER]);
      sheet.appendRow([
        new Date(), String(payload.request_id || ''), String(lead.page || ''),
        String(lead.name || ''), String(lead.email || ''), String(lead.phone || ''),
        String(lead.zip || ''), String(lead.service || ''), String(lead.details || ''),
      ]);
      SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }

    emailDealer_(lead);
    emailCustomer_(lead);
    return jsonResponse_({ ok: true });
  } catch (error) {
    console.error('Lead pipeline failure', error?.name || 'Error');
    return jsonResponse_({ ok: false, error: 'delivery_failed' });
  }
}

function emailDealer_(lead) {
  const body = [
    `New ${CONFIG.dealerName} quote request`, '',
    `Name: ${lead.name}`,
    `Email: ${lead.email}`,
    `Phone: ${lead.phone}`,
    `ZIP: ${lead.zip || 'Not provided'}`,
    `Project type: ${lead.service}`,
    `Submitted from: ${lead.page || 'Not recorded'}`, '',
    'Project description:',
    lead.details || 'Not provided',
  ].join('\n');
  MailApp.sendEmail({
    to: CONFIG.dealerEmail,
    replyTo: lead.email,
    name: `${CONFIG.dealerName} Website`,
    subject: `New quote request from ${lead.name} — ${lead.service}`,
    body,
  });
}

function emailCustomer_(lead) {
  MailApp.sendEmail({
    to: lead.email,
    name: CONFIG.dealerName,
    subject: 'We received your quote request',
    body: `Thanks for contacting ${CONFIG.dealerName}, ${lead.name}. Your quote request was received. Expect a call, text, or email from our team within one business day. If you need help sooner, call ${CONFIG.sitePhone}.`,
  });
}

function sendDailyLeadReport() {
  const sheet = SpreadsheetApp.openById(CONFIG.spreadsheetId).getSheetByName(CONFIG.sheetName);
  const values = sheet.getDataRange().getValues();
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const leads = values.slice(1).filter((row) => row[0] instanceof Date && row[0].getTime() >= cutoff);
  const subject = `Redding website lead report — ${leads.length} lead${leads.length === 1 ? '' : 's'}`;
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${CONFIG.spreadsheetId}/edit`;
  const rows = leads.map((row) => `<tr>${[row[0], row[2], row[3], row[5], row[6], row[7]].map((cell, index) => `<td style="padding:6px 10px;border:1px solid #ddd">${escapeHtml_(index === 0 ? Utilities.formatDate(cell, CONFIG.timeZone, 'MMM d, h:mm a') : cell)}</td>`).join('')}</tr>`).join('');
  const htmlBody = `<p>${leads.length ? `The Redding website received <strong>${leads.length}</strong> lead${leads.length === 1 ? '' : 's'} in the last 24 hours.` : 'The Redding website received no leads in the last 24 hours.'}</p>${leads.length ? `<table style="border-collapse:collapse"><thead><tr>${['Received','Page','Name','Phone','ZIP','Service'].map((label) => `<th style="padding:6px 10px;border:1px solid #ddd;text-align:left">${label}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>` : ''}<p><a href="${sheetUrl}">Open the complete lead sheet</a></p>`;
  MailApp.sendEmail({
    to: CONFIG.reportEmails.join(','),
    name: 'Redding Website Lead Reports',
    subject,
    body: `${leads.length} website lead${leads.length === 1 ? '' : 's'} received in the last 24 hours. Open the complete sheet: ${sheetUrl}`,
    htmlBody,
  });
}

function installDailyReportTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === 'sendDailyLeadReport')
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('sendDailyLeadReport')
    .timeBased()
    .atHour(7)
    .everyDays(1)
    .inTimezone(CONFIG.timeZone)
    .create();
}

// One-time readability pass on the lead sheet. Run manually from the Apps
// Script editor (Run > formatLeadSheet). Safe to re-run; formats whole
// columns so future appended rows inherit everything. No redeploy needed —
// doPost is unchanged.
function formatLeadSheet() {
  const sheet = SpreadsheetApp.openById(CONFIG.spreadsheetId).getSheetByName(CONFIG.sheetName);
  if (!sheet) throw new Error('Lead sheet not found.');
  const maxRows = sheet.getMaxRows();
  const cols = HEADER.length;

  // Header: frozen, bold white on dark, slightly taller.
  const header = sheet.getRange(1, 1, 1, cols);
  header.setBackground('#1f3a5f').setFontColor('#ffffff').setFontWeight('bold').setFontSize(11);
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 32);

  // Column widths tuned to content.
  const widths = [150, 110, 170, 160, 220, 130, 60, 180, 420];
  widths.forEach((width, index) => sheet.setColumnWidth(index + 1, width));

  // Whole-column formats so new rows pick them up automatically.
  const body = sheet.getRange(2, 1, maxRows - 1, cols);
  body.setVerticalAlignment('top').setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  sheet.getRange(2, 1, maxRows - 1, 1).setNumberFormat('mmm d, yyyy h:mm am/pm');
  sheet.getRange(2, 9, maxRows - 1, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP); // Project Description
  sheet.getRange(2, 7, maxRows - 1, 1).setNumberFormat('@'); // ZIP as text, keeps leading zeros

  // Alternating row shading (banding auto-extends as rows append).
  sheet.getBandings().forEach((banding) => banding.remove());
  sheet.getRange(2, 1, maxRows - 1, cols)
    .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);

  // Filter buttons on the header for sorting/searching.
  if (sheet.getFilter()) sheet.getFilter().remove();
  sheet.getRange(1, 1, maxRows, cols).createFilter();
}

function jsonResponse_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function safeEqual_(left, right) {
  if (!left || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function escapeHtml_(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}
