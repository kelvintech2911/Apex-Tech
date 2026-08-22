#!/usr/bin/env python3
"""
Stamp the site's real URL into every place that needs an absolute address.

The site is written to work without a domain, but link previews (Facebook,
Instagram, WhatsApp, Twitter/X, LinkedIn) need an ABSOLUTE og:image URL, and
sitemaps need absolute <loc> values. Run this once you know where the site
lives -- a hosting subdomain is fine.

    python set-site-url.py https://apex-tech.onrender.com
    python set-site-url.py https://apextech.org

Re-run it any time the URL changes; it replaces previous values rather than
stacking them up. Run with no argument to see the current state.
"""
import io
import os
import re
import sys

# Site files live in ./public (Render's publish directory); this script
# sits outside it so it is never served to visitors.
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'public')

# page -> (path on site, changefreq, priority) ; None = keep out of the sitemap
PAGES = {
    'index.html':     ('/',             'monthly', '1.0'),
    'privacy.html':   ('/privacy.html', 'yearly',  '0.3'),
    'terms.html':     ('/terms.html',   'yearly',  '0.3'),
    '404.html':       (None, None, None),
    'thank-you.html': (None, None, None),
}

MARKER = ('  <!-- FT-SITE-URL: og:image should be an ABSOLUTE url for reliable link previews.\n'
          '       Run set-site-url.py with your hosting URL to stamp it everywhere. -->\n')


def read(f):
    return io.open(os.path.join(ROOT, f), encoding='utf-8').read()


def write(f, s):
    io.open(os.path.join(ROOT, f), 'w', encoding='utf-8', newline='').write(s)


def show_state():
    print("Current state:\n")
    for f in PAGES:
        if not os.path.exists(os.path.join(ROOT, f)):
            continue
        s = read(f)
        img = re.search(r'<meta property="og:image" content="([^"]*)"', s)
        can = re.search(r'<link rel="canonical" href="([^"]*)"', s)
        url = re.search(r'<meta property="og:url" content="([^"]*)"', s)
        print("  %-15s canonical=%-18s og:url=%-34s og:image=%s" % (
            f,
            can.group(1) if can else '-',
            url.group(1) if url else '(none)',
            img.group(1) if img else '-'))
    print("\nPass a URL to stamp, e.g.:\n  python set-site-url.py https://your-site.netlify.app")


def stamp(base):
    base = base.rstrip('/')
    if not re.match(r'^https?://[^/\s]+$', base):
        print("!! Expected a bare origin like https://example.com  (no path)")
        sys.exit(1)
    if base.startswith('http://'):
        print("   WARNING: Meta requires https for ad destinations. Continuing anyway.")

    for f, (path, _cf, _pr) in PAGES.items():
        fp = os.path.join(ROOT, f)
        if not os.path.exists(fp):
            continue
        s = read(f)
        before = s

        # --- og:image / twitter:image -> absolute ---
        s = re.sub(r'(<meta property="og:image" content=")[^"]*(")',
                   r'\g<1>%s/og-image.jpg\g<2>' % base, s)
        s = re.sub(r'(<meta name="twitter:image" content=")[^"]*(")',
                   r'\g<1>%s/og-image.jpg\g<2>' % base, s)

        # --- canonical -> absolute (only for indexable pages) ---
        if path:
            s = re.sub(r'(<link rel="canonical" href=")[^"]*(")',
                       r'\g<1>%s\g<2>' % (base + path), s)

            # --- og:url / twitter:url : replace if present, else insert ---
            full = base + path
            if '<meta property="og:url"' in s:
                s = re.sub(r'(<meta property="og:url" content=")[^"]*(")',
                           r'\g<1>%s\g<2>' % full, s)
            else:
                s = s.replace('  <meta property="og:type" content="website">',
                              '  <meta property="og:type" content="website">\n'
                              '  <meta property="og:url" content="%s">' % full, 1)
            if '<meta name="twitter:url"' in s:
                s = re.sub(r'(<meta name="twitter:url" content=")[^"]*(")',
                           r'\g<1>%s\g<2>' % full, s)
            else:
                s = s.replace('  <meta name="twitter:card"',
                              '  <meta name="twitter:url" content="%s">\n'
                              '  <meta name="twitter:card"' % full, 1)

        # --- drop the reminder comment, it's done its job ---
        s = s.replace(MARKER, '')

        # --- JSON-LD: restore url + @id on the homepage ---
        if f == 'index.html' and '"@type": ["LocalBusiness", "ProfessionalService"],' in s:
            s = re.sub(r'\n    "@id": "[^"]*",', '', s)
            s = re.sub(r'\n    "url": "[^"]*",', '', s)
            s = s.replace('    "@type": ["LocalBusiness", "ProfessionalService"],',
                          '    "@type": ["LocalBusiness", "ProfessionalService"],\n'
                          '    "@id": "%s/#business",\n'
                          '    "url": "%s/",' % (base, base))

        if s != before:
            write(f, s)
            print("   stamped %s" % f)

    # ------------------------------------------------ sitemap.xml
    rows = []
    for f, (path, cf, pr) in PAGES.items():
        if not path or not os.path.exists(os.path.join(ROOT, f)):
            continue
        rows.append("  <url>\n    <loc>%s%s</loc>\n    <changefreq>%s</changefreq>\n"
                    "    <priority>%s</priority>\n  </url>" % (base, path, cf, pr))
    sitemap = ('<?xml version="1.0" encoding="UTF-8"?>\n'
               '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
               + "\n".join(rows) + "\n</urlset>\n")
    io.open(os.path.join(ROOT, 'sitemap.xml'), 'w', encoding='utf-8', newline='').write(sitemap)
    print("   wrote sitemap.xml (%d urls)" % len(rows))

    # ------------------------------------------------ robots.txt
    robots = ("User-agent: *\n"
              "Allow: /\n\n"
              "# No value in indexing these\n"
              "Disallow: /404.html\n"
              "Disallow: /thank-you.html\n\n"
              "Sitemap: %s/sitemap.xml\n" % base)
    io.open(os.path.join(ROOT, 'robots.txt'), 'w', encoding='utf-8', newline='').write(robots)
    print("   wrote robots.txt")

    print("\nDone. Site URL set to: %s" % base)
    print("\nNext:")
    print("  1. Re-run Facebook's Sharing Debugger to clear the cached preview:")
    print("     https://developers.facebook.com/tools/debug/?q=%s" % base)
    print("  2. The domain still needs verifying in Meta Business Manager")
    print("     before Aggregated Event Measurement will report iOS conversions.")


if __name__ == '__main__':
    if len(sys.argv) < 2:
        show_state()
    else:
        stamp(sys.argv[1])
