/* UrlShort app logic. Pure helpers are exported for headless tests. */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.UrlShort = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  var API_BASE = 'https://clck.ru/--?url=';

  // Normalize user input into a valid http(s) URL string. Throws on invalid.
  function normalizeUrl(input) {
    var s = String(input || '').trim();
    if (!s) throw new Error('Please paste a URL first.');
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) s = 'https://' + s;
    var u;
    try { u = new URL(s); }
    catch (e) { throw new Error('That does not look like a valid URL.'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:')
      throw new Error('Only http and https links can be shortened.');
    return u.toString();
  }

  function apiUrl(longUrl) {
    return API_BASE + encodeURIComponent(longUrl);
  }

  // Validate the plain-text API response. Returns the short URL or throws.
  function parseResponse(text) {
    var s = String(text || '').trim();
    if (/^https?:\/\/[^\s]+$/.test(s)) return s;
    throw new Error('Shortener service error: ' + (s.slice(0, 120) || 'empty response'));
  }

  function shorten(longUrl) {
    return fetch(apiUrl(longUrl)).then(function (r) {
      if (!r.ok) throw new Error('Shortener service unavailable (HTTP ' + r.status + ').');
      return r.text();
    }).then(parseResponse);
  }

  var LS_KEY = 'urlshort_history';

  function loadHistory(storage) {
    storage = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!storage) return [];
    try {
      var raw = storage.getItem(LS_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function saveHistory(list, storage) {
    storage = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!storage) return;
    try { storage.setItem(LS_KEY, JSON.stringify(list.slice(0, 50))); } catch (e) {}
  }

  function addEntry(list, entry) {
    var next = [{ long: entry.long, short: entry.short, ts: entry.ts || Date.now() }]
      .concat(list.filter(function (e) { return e.short !== entry.short; }));
    return next.slice(0, 50);
  }

  function removeEntry(list, short) {
    return list.filter(function (e) { return e.short !== short; });
  }

  function countToday(list) {
    var start = new Date(); start.setHours(0, 0, 0, 0);
    return list.filter(function (e) { return e.ts >= start.getTime(); }).length;
  }

  function qrUrl(shortUrl) {
    return 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&data='
      + encodeURIComponent(shortUrl);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText)
      return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try {
        if (document.execCommand('copy')) resolve();
        else reject(new Error('copy failed'));
      } catch (e) { reject(e); }
      document.body.removeChild(ta);
    });
  }

  // ---- DOM wiring (browser only) ----
  function init() {
    var $ = function (id) { return document.getElementById(id); };
    var urlInput = $('urlInput'), shortenBtn = $('shortenBtn'), errorBox = $('errorBox');
    var resultCard = $('resultCard'), shortUrl = $('shortUrl'), origUrl = $('origUrl');
    var copyBtn = $('copyBtn'), qrBtn = $('qrBtn'), qrWrap = $('qrWrap'), qrImg = $('qrImg');
    var historyList = $('historyList'), emptyHist = $('emptyHist'), clearHist = $('clearHist');
    var statTotal = $('statTotal'), statToday = $('statToday'), themeBtn = $('themeBtn');

    var history = loadHistory();

    function showError(msg) {
      errorBox.textContent = msg; errorBox.classList.add('show');
    }
    function hideError() { errorBox.classList.remove('show'); }

    function esc(s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    function renderStats() {
      statTotal.textContent = history.length;
      statToday.textContent = countToday(history);
    }

    function renderHistory() {
      historyList.innerHTML = '';
      emptyHist.style.display = history.length ? 'none' : 'block';
      history.forEach(function (e) {
        var li = document.createElement('li');
        var d = new Date(e.ts);
        li.innerHTML =
          '<a class="s" href="' + esc(e.short) + '" target="_blank" rel="noopener">' + esc(e.short) + '</a>' +
          '<div class="l">' + esc(e.long) + '</div>' +
          '<div class="meta">' + esc(d.toLocaleDateString()) + ' ' + esc(d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})) + '</div>' +
          '<div class="actions">' +
            '<button class="btn btn-small btn-ghost" data-act="copy">Copy</button>' +
            '<button class="btn btn-small btn-ghost" data-act="open">Open</button>' +
            '<button class="btn btn-small btn-ghost" data-act="del" style="color:var(--danger)">Delete</button>' +
          '</div>';
        li.querySelector('[data-act="copy"]').onclick = function () {
          copyText(e.short).then(function () { flash(this, 'Copied'); }.bind(this));
        };
        li.querySelector('[data-act="open"]').onclick = function () { window.open(e.short, '_blank', 'noopener'); };
        li.querySelector('[data-act="del"]').onclick = function () {
          history = removeEntry(history, e.short);
          saveHistory(history); renderHistory(); renderStats();
        };
        historyList.appendChild(li);
      });
    }

    function flash(btn, label) {
      var old = btn.textContent; btn.textContent = label;
      setTimeout(function () { btn.textContent = old; }, 1400);
    }

    shortenBtn.addEventListener('click', function () {
      hideError();
      var longUrl;
      try { longUrl = normalizeUrl(urlInput.value); }
      catch (e) { showError(e.message); return; }
      shortenBtn.disabled = true; shortenBtn.classList.add('loading');
      shorten(longUrl).then(function (short) {
        shortUrl.textContent = short; shortUrl.href = short;
        origUrl.textContent = longUrl;
        qrWrap.classList.remove('show'); qrImg.removeAttribute('src');
        resultCard.classList.add('show');
        history = addEntry(history, { long: longUrl, short: short });
        saveHistory(history); renderHistory(); renderStats();
        resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }).catch(function (e) {
        showError(e.message || 'Something went wrong. Check your connection and try again.');
      }).finally(function () {
        shortenBtn.disabled = false; shortenBtn.classList.remove('loading');
      });
    });
    urlInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') shortenBtn.click();
    });

    copyBtn.addEventListener('click', function () {
      copyText(shortUrl.textContent).then(
        function () { flash(copyBtn, 'Copied ✓'); },
        function () { showError('Copy failed. Long-press the link to copy it manually.'); });
    });
    qrBtn.addEventListener('click', function () {
      if (qrWrap.classList.contains('show')) { qrWrap.classList.remove('show'); return; }
      qrImg.src = qrUrl(shortUrl.textContent);
      qrWrap.classList.add('show');
    });
    clearHist.addEventListener('click', function () {
      if (!history.length) return;
      if (confirm('Delete all recent links?')) {
        history = []; saveHistory(history); renderHistory(); renderStats();
      }
    });

    // Theme
    function applyTheme(t) {
      document.documentElement.setAttribute('data-theme', t);
      themeBtn.textContent = t === 'dark' ? '☀️' : '🌙';
      try { localStorage.setItem('urlshort_theme', t); } catch (e) {}
    }
    var savedTheme = 'light';
    try { savedTheme = localStorage.getItem('urlshort_theme') || 'light'; } catch (e) {}
    applyTheme(savedTheme);
    themeBtn.addEventListener('click', function () {
      applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });

    renderHistory(); renderStats();
  }

  if (typeof document !== 'undefined' && document.getElementById) {
    if (document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  return {
    normalizeUrl: normalizeUrl, apiUrl: apiUrl, parseResponse: parseResponse,
    loadHistory: loadHistory, saveHistory: saveHistory,
    addEntry: addEntry, removeEntry: removeEntry, countToday: countToday, qrUrl: qrUrl
  };
});
