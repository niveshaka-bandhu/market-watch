// Paste your Apps Script web app URL here:
const SHEETS_API = 'https://script.google.com/macros/s/AKfycbwyno4ZTdWUDp46qBQfIC4Pe4iD9xc8-Q3-v_0PCrZyFwc-SzFay2sidBnVeojibPcV/exec';

let equityIndex = []; // {symbol, name}

function sheetsJsonp(params) {
  return new Promise((resolve, reject) => {
    const cb = 'cb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    const q = Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&');
    const s = document.createElement('script');
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Sheets timeout'));
    }, 25000);
    function cleanup() {
      clearTimeout(timer);
      delete window[cb];
      s.remove();
    }
    window[cb] = (data) => {
      cleanup();
      resolve(data);
    };
    s.onerror = () => {
      cleanup();
      reject(new Error('Sheets network error'));
    };
    s.src = SHEETS_API + '?' + q + '&callback=' + cb;
    document.body.appendChild(s);
  });
}

async function loadEquityList() {
  try {
    const res = await sheetsJsonp({ action: 'equity' });
    if (!res.ok) throw new Error(res.error);
    equityIndex = res.data || [];
  } catch (e) {
    console.warn('Equity list failed', e);
    equityIndex = [];
  }
}

function setupSearch() {
  const input = document.getElementById('ticker-input');
  let box = document.getElementById('search-suggest');
  if (!box) {
    box = document.createElement('div');
    box.id = 'search-suggest';
    box.style.cssText = 'position:absolute;z-index:50;background:#1a222d;border:1px solid #2a3441;border-radius:8px;max-height:240px;overflow:auto;display:none;width:min(360px,90vw)';
    input.parentElement.style.position = 'relative';
    input.parentElement.appendChild(box);
  }

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 1) {
      box.style.display = 'none';
      return;
    }
    const hits = equityIndex.filter(x =>
      x.symbol.toLowerCase().includes(q) || (x.name || '').toLowerCase().includes(q)
    ).slice(0, 12);
    if (!hits.length) {
      box.style.display = 'none';
      return;
    }
    box.innerHTML = hits.map(h =>
      `<div data-sym="${h.symbol}" style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #2a3441">
        <b>${h.symbol}</b> <span style="color:#8b9aab">${h.name || ''}</span>
      </div>`
    ).join('');
    box.style.display = 'block';
    box.querySelectorAll('[data-sym]').forEach(el => {
      el.onclick = () => {
        input.value = el.getAttribute('data-sym');
        box.style.display = 'none';
      };
    });
  });
}
