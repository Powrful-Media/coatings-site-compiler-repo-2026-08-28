# Redding lead pipeline — setup and test

The site's 7 forms now post JSON to `/api/lead` (a Vercel function in `api/lead.js`),
which forwards to a Google Apps Script that writes the Powrful lead Sheet and sends
all emails via Gmail. Same design as Elite's current pipeline. The Web3Forms markup
is still in every form as the no-JS fallback and to keep the audit green — it only
fires if JavaScript is disabled.

## One-time setup (Cortney, ~15 minutes, all in the Powrful Google account)

1. **Sheet.** Create a new Google Sheet named `Polytek Redding — Website Leads`.
   Do not reuse Elite's. Copy its ID from the URL (`/d/<ID>/edit`). The script
   writes its own header row on first lead.
2. **Script.** In the Sheet: Extensions → Apps Script. Paste the contents of
   `redding-lead-pipeline.gs`. Replace `__REDDING_SPREADSHEET_ID__` with the Sheet ID
   and `__WEBHOOK_SECRET__` with a random 32+ character string (keep it; you need it
   again in step 4). `dealerEmail` starts as `media@powrful.com` for testing.
3. **Deploy.** Deploy → New deployment → Web app. Execute as **Me**; access:
   **Anyone**. Copy the `/exec` URL. Then run `installDailyReportTrigger` once from
   the editor (authorize when prompted) to arm the 7 AM Pacific daily digest.
4. **Vercel env vars.** Project settings → Environment Variables, add to **both
   Preview and Production**: `LEAD_WEBHOOK_URL` = the `/exec` URL,
   `LEAD_WEBHOOK_SECRET` = the secret from step 2. Redeploy after saving —
   existing deployments do not pick up new vars.

## Test plan (after the api/lead changes are pushed and env vars set)

1. Submit the homepage hero form and the `/get-an-estimate/` form with obviously
   fake test data (name "TEST DELETE ME").
2. Confirm each shows the inline thank-you message.
3. Confirm two rows in the Sheet, with the Page column distinguishing them.
4. Confirm the dealer email arrived at `media@powrful.com` with reply-to set to
   the test email address.
5. Confirm the customer confirmation arrived at the test email address.
6. Next morning, confirm the daily digest hit info@ and jay@.
7. Delete the test rows.

## Flip to live (launch day)

Edit one line in the Apps Script CONFIG: `dealerEmail` → Josh Larson's address
(`contactus@polytekofredding.com` unless the Larsons say otherwise). Save. A new
deployment is NOT needed for CONFIG edits if you use "Deploy → Manage deployments →
Edit → Version: New" — do that, since web apps serve the code of their deployed
version. Then send one more synthetic lead and have Josh confirm receipt.

## Notes

- No DNS dependency anywhere: emails send from the Powrful Google account, so this
  works on the preview URL today and is unchanged by cutover.
- Vercel BotID is deliberately not used: this repo deploys with no build step and
  no package.json. Honeypot + form-age timing + per-IP rate limit remain.
- MailApp quota is 1,500 recipients/day on Workspace (100/day on a free gmail
  account — the script owner must be the Workspace account). Each lead uses 2
  recipients; the digest uses 2/day. Nowhere near the limit.
- DONE 2026-09-04: Web3Forms fully removed (hidden inputs + form action) from
  all 7 form pages, replaced with a `<noscript>` phone fallback. audit.py's
  form checks now require the /api/lead/ fetch and fail on any
  web3forms/access_key residue.
