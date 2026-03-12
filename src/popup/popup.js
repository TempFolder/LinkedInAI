const $ = id => document.getElementById(id);

document.addEventListener('DOMContentLoaded', async () => {
  const r = await chrome.runtime.sendMessage({ type: 'get_settings' });
  fill(r?.settings || {});
  const dc = await chrome.runtime.sendMessage({ type: 'get_daily_count' });
  $('cDay').textContent = dc?.count || 0;

  $('btnS').onclick   = () => $('ov').classList.add('open');
  $('btnX').onclick   = () => $('ov').classList.remove('open');
  $('btnSv').onclick  = save;
  $('btnA').onclick   = run;
  $('fProv').onchange = e => switchProv(e.target.value);
  $('fSt').onchange   = e => $('sCust').classList.toggle('hidden', e.target.value !== 'custom');
});

function fill(s) {
  $('fProv').value  = s.aiProvider  || 'gemini';
  $('fGK').value    = s.geminiKey   || '';
  $('fGM').value    = s.geminiModel || 'gemini-2.0-flash';
  $('fOK').value    = s.openaiKey   || '';
  $('fOM').value    = s.gptModel    || 'gpt-4o-mini';
  $('fSt').value    = s.style       || 'insightful';
  $('fCP').value    = s.customPrompt|| '';
  $('fLimit').value = s.dailyLimit  || 30;
  $('fDn').value    = s.delayMin    || 45;
  $('fDx').value    = s.delayMax    || 90;
  switchProv(s.aiProvider || 'gemini');
  $('sCust').classList.toggle('hidden', (s.style || 'insightful') !== 'custom');
}

function switchProv(p) {
  $('sGEM').classList.toggle('hidden',  p !== 'gemini');
  $('sGEMM').classList.toggle('hidden', p !== 'gemini');
  $('sOAI').classList.toggle('hidden',  p !== 'openai');
  $('sOAIM').classList.toggle('hidden', p !== 'openai');
}

async function save() {
  const s = {
    aiProvider:   $('fProv').value,
    geminiKey:    $('fGK').value.trim(),
    geminiModel:  $('fGM').value,
    openaiKey:    $('fOK').value.trim(),
    gptModel:     $('fOM').value,
    style:        $('fSt').value,
    customPrompt: $('fCP').value.trim(),
    dailyLimit:   parseInt($('fLimit').value) || 30,
    delayMin:     parseInt($('fDn').value) || 45,
    delayMax:     parseInt($('fDx').value) || 90,
  };
  await chrome.runtime.sendMessage({ type: 'save_settings', settings: s });
  log('✅ Сохранено');
  $('ov').classList.remove('open');
}

async function run() {
  const r = await chrome.runtime.sendMessage({ type: 'get_settings' });
  const s = r?.settings || {};
  const key = s.aiProvider === 'gemini' ? s.geminiKey : s.openaiKey;
  if (!key) { log('❌ Укажите API Key ⚙️'); $('ov').classList.add('open'); return; }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { log('❌ Откройте LinkedIn'); return; }
  if (!tab.url?.includes('linkedin.com')) { log('❌ Перейдите на linkedin.com'); return; }

  try { await chrome.tabs.sendMessage(tab.id, { type: 'ping' }); }
  catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content/main.js'] });
    await new Promise(r => setTimeout(r, 500));
  }

  setBtn(true);
  log('▶️ Запуск...');
  chrome.tabs.sendMessage(tab.id, { type: 'start', settings: s });
}

function setBtn(busy) {
  const b = $('btnA');
  b.textContent = busy ? '⏳ Генерирую...' : 'Ответить на пост';
  b.className   = 'main-btn ' + (busy ? 'btn-stop' : 'btn-go');
  b.disabled    = busy;
}

function log(txt) {
  const box = $('log');
  const ts  = new Date().toLocaleTimeString('ru', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  const el  = document.createElement('div');
  el.className = 'll';
  el.textContent = '[' + ts + '] ' + txt;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'log_line') log(msg.text);
  if (msg.type === 'finished') {
    setBtn(false);
    chrome.runtime.sendMessage({ type: 'get_daily_count' }).then(r => {
      if (r?.count !== undefined) $('cDay').textContent = r.count;
    });
  }
});
