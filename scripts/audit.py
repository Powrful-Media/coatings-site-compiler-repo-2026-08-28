#!/usr/bin/env python3
"""
COATINGS SITE COMPILER — RELEASE VALIDATOR
==========================================

Run this against a built dist/ directory before ANY deployment.
Exit code 0 = safe to deploy. Non-zero = do not deploy.

    python3 audit.py /path/to/dist

Every gate in this file exists because a real defect shipped or nearly shipped.
The comment above each gate says which one. Do not remove a gate without
understanding what it caught — several were found by outside reviewers only
after they reached a live preview.

Origin: Polytek of Redding v1.0 pre-launch, August 6 2026.
Designed to be reused unchanged across all ~40 Powrful dealer sites.
"""

import os, re, sys, json, glob

# ─────────────────────────────────────────────────────────────────────
# PER-DEALER CONFIG — the only section that changes between sites.
# Long term this should be read from a DealerSiteConfig manifest rather
# than edited here (see docs/PLATFORM_SPEC.md).
# ─────────────────────────────────────────────────────────────────────
CONFIG = {
    "domain":        "https://polytekofredding.com",
    "review_count":  "146",          # verified against live GBP 2026-08-06
    "review_rating": "4.9",
    "city_pages":    ["anderson", "red-bluff", "shasta-lake"],
    "legacy_domains": ["protekconcretecoatings.com"],   # former brand — must not appear
    "image_host":    "penncatalog-kxk5ekn4.manus.space",
}

MIN_CITY_WORDS = 300
MIN_DESC_CHARS = 50

# ─────────────────────────────────────────────────────────────────────
# CLAIM LINT
# Semantic categories, NOT literal strings. Learned the hard way: banning
# "never yellows" left "won't chalk, yellow, or peel" — the same absolute
# wearing different clothes. A panelist caught it on the live site.
# These ship to ~40 dealers, so every false claim multiplies by 40.
# ─────────────────────────────────────────────────────────────────────
BANNED_CLAIMS = [
    (r'\bnever\s+(?:yellow|fade|peel|chip|crack|fail)',        'absolute outcome'),
    (r"\bwon['\u2019]?t\s+(?:chalk|yellow|peel|fade|crack|chip|stain)", 'absolute outcome'),
    (r'\b100\s*%',                                              'absolute percentage'),
    (r'\bindestructible\b|\bbulletproof\b|\bmaintenance[- ]free\b|\bzero maintenance\b', 'absolute'),
    (r'\blasts? forever\b',                                     'absolute'),
    (r"\bcan['\u2019]?t kill\b",                                'absolute'),
    (r'\bsafer\b|\bslip[- ]proof\b',                            'safety outcome claim'),
    (r'\bbacteria\b|\bgerm|\bsanitiz|\bantimicrobial\b|\bsterile\b', 'hygiene/health claim'),
    (r'\bwaterproof\b|\bchemical[- ]proof\b|\bstain[- ]proof\b', 'proof-suffix absolute'),
    (r'\b\d+\s*[×xX]\s*(?:stronger|tougher|harder)',            'quantified multiplier'),
    (r'\bstronger than epoxy\b',                                'unqualified comparative'),
    (r'\bUV[- ]stable\b',                                       'absolute-leaning (use UV-resistant)'),
    (r'\blifetime\b',                                           'lifetime claim — needs warranty doc on file'),
    (r'intake pending|photo-todo|TODO|LOREM|placeholder',       'internal production note'),
    (r'real [A-Z][a-z]+-area homes',                            'unverified local-work claim'),
]


def audit(dist):
    fails, pages, forms = [], [], 0
    D = CONFIG["domain"]

    for root, _, files in os.walk(dist):
        if 'index.html' in files:
            pages.append(os.path.join(root, 'index.html'))

    for p in sorted(pages):
        rel = os.path.relpath(os.path.dirname(p), dist).replace('.', '').strip('/')
        url = "/" if not rel else f"/{rel}/"
        s = open(p, encoding='utf-8', errors='replace').read()
        visible = re.sub(r'<(script|style)[^>]*>.*?</\1>', ' ', s, flags=re.S)

        # ── Claim lint ────────────────────────────────────────────────
        for pat, label in BANNED_CLAIMS:
            for m in re.finditer(pat, visible, re.I):
                ctx = ' '.join(visible[max(0, m.start()-40):m.end()+40].split())
                fails.append((url, f'CLAIM[{label}]', ctx[:110]))

        # ── Review count: check the FACT, not one markup pattern.
        #    Shipped stale twice — once in a stat tile, once in the meta
        #    description after the tile was "fixed". ──────────────────
        for m in re.finditer(r'(\d{2,4})\s*(?:Google\s*)?reviews?\b', s, re.I):
            if m.group(1) != CONFIG["review_count"]:
                fails.append((url, 'STALE REVIEW COUNT', m.group(0)))

        # ── SEO fundamentals ─────────────────────────────────────────
        if not re.search(r'<title>.{10,}</title>', s, re.S):
            fails.append((url, 'SEO', 'missing/short title'))
        d = re.search(r'<meta name="description" content="([^"]*)"', s)
        if not d or len(d.group(1)) < MIN_DESC_CHARS:
            fails.append((url, 'SEO', f'description under {MIN_DESC_CHARS} chars'))
        c = re.search(r'<link rel="canonical" href="([^"]*)"', s)
        if not c or c.group(1) != D + url:
            fails.append((url, 'SEO', f'canonical mismatch: {c.group(1) if c else "absent"}'))
        if len(re.findall(r'<h1[\s>]', s)) != 1:
            fails.append((url, 'SEO', 'H1 count != 1'))

        # ── Structured data must parse ───────────────────────────────
        for m in re.finditer(r'<script type="application/ld\+json">(.*?)</script>', s, re.S):
            try:
                json.loads(m.group(1))
            except Exception as e:
                fails.append((url, 'JSON-LD', str(e)[:60]))

        # ── Accessibility: axe found <dd> nested inside <a>, which breaks
        #    screen-reader interpretation of the proof rail. ───────────
        if '<dd ' in s or '<dd>' in s:
            fails.append((url, 'A11Y', 'invalid <dd> semantics — use ul/li'))

        # ── Leftovers that must never ship ───────────────────────────
        for bad, label in ([(dom, 'legacy brand domain') for dom in CONFIG["legacy_domains"]] +
                           [('/api/leads', 'unwired form action'),
                            ('company_website', 'dead honeypot field'),
                            ('vercel.app', 'preview host URL leaked'),
                            ('web3forms', 'retired form service (removed 2026-09-04)'),
                            ('name="access_key"', 'retired form key')]):
            if bad in s:
                fails.append((url, 'LEFTOVER', f'{label}: {bad}'))

        # ── Image weight: hotlinked originals measured 23–43MB each and a
        #    198MB homepage. Every external image must go through the
        #    optimizer with responsive sources. ─────────────────────────
        for m in re.finditer(rf'<img[^>]+src="(https://{re.escape(CONFIG["image_host"])}[^"]+)"', s):
            fails.append((url, 'MEDIA', 'unoptimized external image'))
        for m in re.finditer(r'<img[^>]+src="/_vercel/image[^"]*"[^>]*>', s):
            if 'srcset=' not in m.group(0):
                fails.append((url, 'MEDIA', 'optimized image missing srcset'))

        # ── Lead capture. A site can hold every ranking and silently lose
        #    every lead; this was the failure mode the whole panel missed
        #    in round one. ─────────────────────────────────────────────
        if 'id="lead-form"' in s:
            forms += 1
            for need, label in [
                ("fetch('/api/lead/'",            'pipeline endpoint'),  # JSON post to the Vercel function
                ('<noscript>',                    'no-JS phone fallback'),
                ('name="Email"',                  'EMAIL FIELD'),   # shipped missing once
                ('name="Phone"',                  'phone field'),
                ('botcheck',                      'spam bot check'),
                ('Privacy Policy</a>',            'consent line'),
            ]:
                if need not in s:
                    fails.append((url, 'LEAD FORM', f'missing {label}'))

        # ── City pages: two independent reviewers ruled 149-word city pages
        #    thin doorway pages. Substance bar + page-correct schema. ───
        if rel in CONFIG["city_pages"]:
            mm = re.search(r'<main id="main">(.*?)</main>', s, re.S)
            wc = len(' '.join(re.sub(r'<[^>]+>', ' ', mm.group(1)).split()).split()) if mm else 0
            if wc < MIN_CITY_WORDS:
                fails.append((url, 'CITY PAGE', f'thin: {wc} words (min {MIN_CITY_WORDS})'))
            if 'FAQPage' not in s:
                fails.append((url, 'CITY PAGE', 'missing local FAQ schema'))
            for j in re.findall(r'<script type="application/ld\+json">(.*?)</script>', s, re.S):
                try:
                    o = json.loads(j)
                except Exception:
                    continue
                if o.get('@type') == 'Service':
                    a = o.get('areaServed')
                    if not isinstance(a, dict) or a.get('@type') != 'City':
                        fails.append((url, 'CITY PAGE', 'areaServed must be a City object for this page'))

    # ── Site-level gates ─────────────────────────────────────────────
    vj_path = os.path.join(dist, 'vercel.json')
    if not os.path.exists(vj_path):
        fails.append(('config', 'HOSTING', 'vercel.json absent'))
    else:
        vj = json.load(open(vj_path))
        # Live indexed URLs carry trailing slashes. Without this, Vercel
        # 308-redirects EVERY preserved URL — defeating the entire
        # URL-preservation migration strategy. Caught by a panelist.
        if vj.get('trailingSlash') is not True:
            fails.append(('config', 'HOSTING', 'trailingSlash must be true (URL preservation)'))
        if 'images' not in vj:
            fails.append(('config', 'HOSTING', 'image optimization not configured'))

    if not os.path.exists(os.path.join(dist, 'privacy', 'index.html')):
        fails.append(('site', 'LEGAL', 'no privacy policy (required for consent + A2P 10DLC)'))
    if not os.path.exists(os.path.join(dist, 'robots.txt')):
        fails.append(('site', 'SEO', 'no robots.txt'))
    for sm in ('sitemap-index.xml', 'sitemap-0.xml'):
        if not os.path.exists(os.path.join(dist, sm)):
            fails.append(('site', 'SEO', f'{sm} missing — robots.txt declares it'))

    return pages, forms, fails


if __name__ == '__main__':
    dist = sys.argv[1] if len(sys.argv) > 1 else 'dist'
    if not os.path.isdir(dist):
        print(f"ERROR: {dist} is not a directory"); sys.exit(2)

    pages, forms, fails = audit(dist)
    print(f"\n  {dist}")
    print(f"  pages: {len(pages)}   lead forms: {forms}   failures: {len(fails)}\n")
    if fails:
        for url, cat, detail in fails:
            print(f"  FAIL  {url:32} [{cat}] {detail}")
        print(f"\n  ✗ DO NOT DEPLOY — {len(fails)} gate failure(s)\n")
        sys.exit(1)
    print("  ✓ ALL GATES PASS — safe to deploy\n")
    sys.exit(0)
