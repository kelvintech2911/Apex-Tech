/* ============================================================================
   Apex Tech — consent, tracking and attribution
   ----------------------------------------------------------------------------
   One file, loaded by every page. It does four things:

     1. Shows a cookie consent banner on the first visit.
     2. Loads the Meta Pixel / GA4 ONLY after consent is given.
     3. Captures campaign parameters (utm_*, fbclid, …) so a lead can be
        traced back to the ad that paid for it.
     4. Exposes window.FT.track() for Lead / Contact events.

   TO GO LIVE WITH ADS: fill in FT_CONFIG below. Nothing tracking-related
   loads while the IDs are empty, so the site is safe to deploy before the
   Pixel exists.
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ config */
  var CONFIG = window.FT_CONFIG || {};
  CONFIG.metaPixelId = CONFIG.metaPixelId || '';        // e.g. '123456789012345'
  CONFIG.ga4Id = CONFIG.ga4Id || '';                    // e.g. 'G-XXXXXXXXXX'
  CONFIG.turnstileSiteKey = CONFIG.turnstileSiteKey || '';
  CONFIG.minFormSeconds = CONFIG.minFormSeconds || 3;
  CONFIG.privacyUrl = CONFIG.privacyUrl || 'privacy.html';
  // Show the banner only where consent is legally required (EU/EEA/UK).
  // Set to false to show it to everyone.
  CONFIG.euOnlyBanner = CONFIG.euOnlyBanner !== false;
  window.FT_CONFIG = CONFIG;

  var STORE_KEY = 'ft_consent';
  var loaded = false;
  var denied = false;

  /* Rough EU/EEA/UK check from the browser's own timezone -- no network call,
     no IP lookup. It is approximate: a VPN or a traveller can fool it. If
     detection fails for any reason we show the banner, which is the safe
     side to err on. For a stronger guarantee, use the country header your
     host provides (Netlify/Vercel/Cloudflare all expose one) and set
     FT_CONFIG.euOnlyBanner = false where consent is required. */
  var EU_TZ = /^(Europe\/|Atlantic\/(Canary|Azores|Madeira|Faroe|Reykjavik)|Arctic\/Longyearbyen)/;

  function consentRequired() {
    if (!CONFIG.euOnlyBanner) return true;
    try {
      var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      if (!tz) return true;
      return EU_TZ.test(tz);
    } catch (e) {
      return true;
    }
  }

  function stored() {
    try { return localStorage.getItem(STORE_KEY); } catch (e) { return null; }
  }
  function remember(v) {
    try { localStorage.setItem(STORE_KEY, v); } catch (e) {}
  }

  /* --------------------------------------------------- attribution (first-party)
     Session-scoped, no cookies, and needed to answer the enquiry the visitor
     is choosing to send us -- so this runs regardless of the banner. */
  var KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content',
              'utm_term', 'fbclid', 'gclid', 'ttclid', 'msclkid'];
  var store = {};
  try { store = JSON.parse(sessionStorage.getItem('ft_attr') || '{}'); } catch (e) { store = {}; }
  (function () {
    var qs = new URLSearchParams(window.location.search), touched = false;
    KEYS.forEach(function (k) {
      var v = qs.get(k);
      if (v) { store[k] = v.slice(0, 200); touched = true; }
    });
    if (!store.landing_page) { store.landing_page = location.pathname + location.search; touched = true; }
    if (!store.referrer) { store.referrer = document.referrer || 'direct'; touched = true; }
    if (touched) { try { sessionStorage.setItem('ft_attr', JSON.stringify(store)); } catch (e) {} }
  })();

  function cookie(name) {
    var m = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
    return m ? m.pop() : '';
  }

  /* ----------------------------------------------------------- marketing tags */
  function loadMarketing() {
    if (loaded) return;
    loaded = true;

    if (CONFIG.metaPixelId) {
      !function (f, b, e, v, n, t, s) {
        if (f.fbq) return;
        n = f.fbq = function () {
          n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
        };
        if (!f._fbq) f._fbq = n;
        n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
        t = b.createElement(e); t.async = !0; t.src = v;
        s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
      }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
      window.fbq('init', CONFIG.metaPixelId);
      window.fbq('track', 'PageView');
    }

    if (CONFIG.ga4Id) {
      var g = document.createElement('script');
      g.async = true;
      g.src = 'https://www.googletagmanager.com/gtag/js?id=' + CONFIG.ga4Id;
      document.head.appendChild(g);
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag('js', new Date());
      window.gtag('config', CONFIG.ga4Id);
    }

    // Anything queued before consent (e.g. a Lead on the thank-you page)
    (window.FT._pending || []).forEach(function (a) { window.FT.track(a[0], a[1], a[2]); });
    window.FT._pending = [];
  }

  /* ------------------------------------------------------------- public API */
  window.FT = {
    _pending: [],

    consent: function () { return stored() || 'unset'; },

    attribution: function () {
      var out = {};
      Object.keys(store).forEach(function (k) { out[k] = store[k]; });
      out.fbp = cookie('_fbp');   // empty unless the Pixel has consent
      out.fbc = cookie('_fbc');
      return out;
    },

    // Shared id so the Pixel and the Conversions API can be de-duplicated
    newRef: function () {
      return 'FT-' + Date.now().toString(36).toUpperCase() +
             '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    },

    track: function (event, params, eventId) {
      if (denied) return;                  // consent refused -- drop it entirely
      if (!loaded) {                       // hold it until consent is decided
        window.FT._pending.push([event, params, eventId]);
        return;
      }
      if (typeof window.fbq === 'function') {
        window.fbq('track', event, params || {}, eventId ? { eventID: eventId } : undefined);
      }
      if (typeof window.gtag === 'function') {
        window.gtag('event', event, params || {});
      }
    },

    openConsent: function () { showBanner(true); }
  };

  /* --------------------------------------------------------------- the banner */
  var CSS = [
    '.ft-cc{position:fixed;left:16px;right:16px;bottom:16px;z-index:400;',
    'max-width:560px;margin:0 auto;padding:20px 22px;border-radius:14px;',
    'background:rgba(10,15,28,.97);border:1px solid rgba(255,255,255,.14);',
    'box-shadow:0 24px 60px -20px rgba(0,0,0,.7);color:#fff;',
    'font-family:"DM Sans","Figtree",system-ui,sans-serif;',
    'transform:translateY(140%);visibility:hidden;pointer-events:none;',
    'transition:transform .45s cubic-bezier(.16,1,.3,1),visibility 0s linear .45s}',
    '.ft-cc.is-open{transform:translateY(0);visibility:visible;pointer-events:auto;',
    'transition:transform .45s cubic-bezier(.16,1,.3,1),visibility 0s}',
    '.ft-cc h2{font-family:"Figtree","DM Sans",system-ui,sans-serif;font-size:1rem;',
    'font-weight:700;margin:0 0 8px}',
    '.ft-cc p{font-size:.85rem;line-height:1.6;color:rgba(255,255,255,.66);margin:0 0 16px}',
    '.ft-cc a{color:#3b82f6;text-decoration:underline}',
    '.ft-cc-row{display:flex;flex-wrap:wrap;gap:10px}',
    '.ft-cc button{font:inherit;font-size:.84rem;font-weight:600;cursor:pointer;',
    'padding:10px 18px;border-radius:9999px;border:1px solid transparent;',
    'transition:background .2s ease,border-color .2s ease,transform .2s ease}',
    '.ft-cc button:hover{transform:translateY(-1px)}',
    '.ft-cc-accept{background:#2563EB;color:#fff}',
    '.ft-cc-accept:hover{background:#1D4ED8}',
    '.ft-cc-reject{background:transparent;color:#fff;border-color:rgba(255,255,255,.28)}',
    '.ft-cc-reject:hover{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.5)}',
    '.ft-cc button:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(59,130,246,.5)}',
    '.ft-cc-link{background:none;border:none;padding:0;font:inherit;font-size:.82rem;',
    'color:rgba(255,255,255,.55);cursor:pointer;text-decoration:underline}',
    '.ft-cc-link:hover{color:#fff}',
    '@media (max-width:560px){',
    '.ft-cc{left:8px;right:8px;bottom:8px;padding:14px 16px;border-radius:12px}',
    '.ft-cc h2{font-size:.92rem;margin-bottom:5px}',
    '.ft-cc p{font-size:.78rem;line-height:1.5;margin-bottom:12px}',
    '.ft-cc-row{gap:8px}',
    '.ft-cc-row button{flex:1 1 0;padding:9px 12px;font-size:.8rem;white-space:nowrap}}',
    '@media (prefers-reduced-motion:reduce){.ft-cc{transition:none}}'
  ].join('');

  var banner = null;

  function showBanner(force) {
    if (!force && stored()) return;
    if (banner) { requestAnimationFrame(function () { banner.classList.add('is-open'); }); return; }

    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    banner = document.createElement('div');
    banner.className = 'ft-cc';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-live', 'polite');
    banner.setAttribute('aria-label', 'Cookie choices');
    banner.innerHTML =
      '<h2>We use cookies</h2>' +
      '<p>We use cookies to run this site and, with your permission, to measure how our ads ' +
      'perform. <a href="' + CONFIG.privacyUrl + '">Privacy Policy</a>.</p>' +
      '<div class="ft-cc-row">' +
      '<button type="button" class="ft-cc-accept">Accept all</button>' +
      '<button type="button" class="ft-cc-reject">Essential only</button>' +
      '</div>';

    document.body.appendChild(banner);
    requestAnimationFrame(function () { banner.classList.add('is-open'); });

    banner.querySelector('.ft-cc-accept').addEventListener('click', function () {
      remember('granted');
      denied = false;
      hideBanner();
      loadMarketing();
    });
    banner.querySelector('.ft-cc-reject').addEventListener('click', function () {
      remember('denied');
      denied = true;
      hideBanner();
      window.FT._pending = [];     // drop anything queued; nothing will be sent
    });

    banner.querySelector('.ft-cc-accept').focus();
  }

  function hideBanner() {
    if (!banner) return;
    banner.classList.remove('is-open');   // CSS also flips visibility/pointer-events
  }

  /* --------------------------------------------- "Cookie settings" footer link */
  function addFooterLink() {
    if (document.querySelector('.ft-cc-link')) return;
    var host = document.querySelector('.footer-bottom') ||
               document.querySelector('.footer-inner');
    if (!host) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'ft-cc-link';
    b.textContent = 'Cookie settings';
    b.addEventListener('click', function () { window.FT.openConsent(); });
    host.appendChild(b);
  }

  /* ------------------------------------------------------------------- start */
  function boot() {
    addFooterLink();

    var choice = stored();
    if (choice === 'granted') {
      loadMarketing();
    } else if (choice === 'denied') {
      denied = true;
      window.FT._pending = [];
    } else if (consentRequired()) {
      // Consent needed here: nothing third-party loads until it is given.
      showBanner(false);
    } else {
      // Outside the EU/EEA/UK. No banner in the way of the ad landing page;
      // the footer's "Cookie settings" link still lets people opt out.
      loadMarketing();
    }

    // Contact-method clicks are conversions too
    document.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-contact]') : null;
      if (!el) return;
      window.FT.track('Contact', { contact_method: el.getAttribute('data-contact') });
    }, true);

    // Optional spam filtering on the forms
    if (CONFIG.turnstileSiteKey) {
      var t = document.createElement('script');
      t.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      t.async = true; t.defer = true;
      document.head.appendChild(t);
      document.querySelectorAll('.ft-turnstile').forEach(function (slot) {
        slot.className = 'ft-turnstile cf-turnstile';
        slot.setAttribute('data-sitekey', CONFIG.turnstileSiteKey);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
