# Dealer lead pipeline — the guidebook

How Polytek of Redding's lead pipeline was built on 2026-09-03, written so the next
dealer site takes an hour, not an afternoon. This is the third build of this design
(Elite Aug 2026, Redding Sep 2026); Shoreline used Resend instead and its form was
blocked for weeks on a DNS-verified sender. That is why this design exists.

## The design, one paragraph

Static site forms post JSON to a Vercel function (`api/lead.js`). The function
validates and forwards to a Google Apps Script web app with a shared secret. The
script appends a row to a Powrful-owned Google Sheet, emails the dealer instantly
via Gmail with reply-to set to the customer, emails the customer a confirmation,
and sends a daily digest to the internal list. No Resend, no verified sending
domain, **no DNS dependency**: it works identically on the vercel.app preview and
the live domain, so it can be built and tested before cutover and needs zero
changes after.

## Port to a new dealer (about an hour)

1. **Copy two files** from this repo: `api/lead.js` and
   `scripts/google-apps-script/redding-lead-pipeline.gs`.
2. **Match the field names.** `api/lead.js` FIELDS and the client script's
   `val('...')` calls must match the new site's actual `<input name="...">`
   attributes, and SERVICES must match the select options exactly. This is the
   Jon-bug class of failure (his form once shipped with no email field); check
   every form, not just one.
3. **Edit the .gs CONFIG**: dealer name, phone, timezone, dealerEmail (start with
   a Powrful inbox for testing), reportEmails. Sheet header/columns if fields differ.
4. **Sheet + deploy** (dealer's pipeline gets its OWN Sheet and script, never
   reuse another dealer's): new Sheet under the Powrful account, Extensions →
   Apps Script, paste, fill spreadsheetId + a 32+ char secret, Deploy → Web app,
   Execute as Me, access Anyone, run `installDailyReportTrigger` once.
5. **Vercel env vars** on the site's project: `LEAD_WEBHOOK_URL` (the /exec URL)
   and `LEAD_WEBHOOK_SECRET`, all environments, then redeploy.
6. **Client script** in each form page: post JSON to `/api/lead/`, include
   `formStartedAt` captured at page load and a `page` identifier; on success
   redirect to `/thank-you/` (noindex), on failure show an inline call-us message.
7. **Test before launch** (see test plan below), **flip at launch**: dealerEmail →
   the dealer's inbox, publish a new script version, one synthetic lead through
   the live domain, dealer confirms receipt.

## Gotchas that cost us hours — check these first when it breaks

- **Honeypot: read `.checked`, never `.value`.** A checkbox's value defaults to
  `"on"`, so `val('botcheck')` is always truthy and every lead — including real
  customers — gets silently swallowed as a bot. The symptom is cruel: the form
  says thank you, the Sheet stays empty, and no error exists anywhere.
- **trailingSlash sites 308 `/api/lead` → `/api/lead/`.** Point fetch at the
  slashed URL directly.
- **Apps Script serves the DEPLOYED VERSION, not the editor.** Every code edit
  needs Deploy → Manage deployments → pencil → New version. Editing and saving
  without this runs old code at the live URL while the editor shows new code.
- **spreadsheetId is only the ID**, the string between `/d/` and `/edit`. Not the
  path, not the URL.
- **Vercel env vars display blank** when treated as sensitive — blank does not
  mean empty. And a deployment only picks up env changes on redeploy.
- **Gmail hides self-sent mail from the inbox.** Testing with dealerEmail set to
  the same account that owns the script makes emails "disappear" into Sent/All
  Mail. Deploy the script under one account, test-deliver to another.
- **The script's response leg is flaky even when delivery succeeds.** Roughly 1 in
  3 test submissions got a failure response although the row was written and the
  emails sent. `api/lead.js` therefore retries once; accepted tradeoff is a rare
  duplicate row/email, because a duplicate lead beats a lost lead. Do not "fix"
  the retry away.
- **Diagnose by splitting the chain.** GET the /exec URL (should return the JSON
  service banner); POST to it directly with the real secret (bypasses Vercel);
  run the handler locally with the real env against the real script. Each test
  cuts the search space in half. Apps Script → Executions shows every doPost and
  its error.
- **BotID needs a build step.** On a no-build static repo, skip it; honeypot +
  form-age timing + per-IP rate limit is the spam floor.

## Test plan (from the preview URL, before the dealer ever sees it)

Submit through the real forms in a browser, not curl — the honeypot bug was
invisible to every direct-API test. Use name "TEST DELETE ME". Verify: thank-you
redirect, Sheet row per submission with the page column set, dealer email with
reply-to = customer, customer confirmation, and next morning the digest to the
internal list. Then delete the test rows. Never send a test to the dealer's real
inbox before the site is approved and live — the flip is the launch-day step.

## Boundaries that held (keep them)

- The Sheet and digest are internal to Powrful. The dealer gets instant emails
  only; adding them to reportEmails leaks the Sheet link.
- Web3Forms markup (where a site had it) can stay as the no-JS fallback until a
  deliberate cleanup pass, along with the audit rules that check it. Redding's
  cleanup pass ran 2026-09-04: markup stripped, `<noscript>` phone fallback
  added, audit flipped to require the pipeline and forbid residue.
- DNS, domains, and merges are Jay's seat. Mail (MX) must survive any nameserver
  move — the dealer's inbox IS the lead destination.
