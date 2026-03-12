const DEFAULTS = {
  aiProvider:   'gemini',
  openaiKey:    '',
  geminiKey:    '',
  gptModel:     'gpt-4o-mini',
  geminiModel:  'gemini-2.0-flash',
  style:        'insightful',
  customPrompt: '',
  dailyLimit:   30,
  delayMin:     45,
  delayMax:     90,
};

// Все стили — язык автоматически по тексту поста
const STYLES = {
  insightful: `You are writing a LinkedIn comment. The post text will follow after "POST:".
Write 2-3 complete sentences that add a genuine insight referencing something specific from the post.
Detect the post language automatically and reply in that exact language.
No emojis. Never start with "Great post!", "Totally agree!", or any filler phrase.
Output ONLY the comment text, nothing else.`,

  question: `You are writing a LinkedIn comment. The post text will follow after "POST:".
Write 1-2 sentences asking one specific thoughtful question based on the post content.
Detect the post language automatically and reply in that exact language.
No emojis. No filler openers.
Output ONLY the comment text, nothing else.`,

  agree: `You are writing a LinkedIn comment. The post text will follow after "POST:".
Write 2-3 sentences agreeing with a specific point and adding your own perspective.
Detect the post language automatically and reply in that exact language.
No emojis. No "Great post!" openers.
Output ONLY the comment text, nothing else.`,

  devil: `You are writing a LinkedIn comment. The post text will follow after "POST:".
Write 2-3 sentences respectfully challenging one specific claim or adding nuance.
Detect the post language automatically and reply in that exact language.
No emojis. No "With all due respect..." filler.
Output ONLY the comment text, nothing else.`,
};

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  handle(msg).then(reply).catch(e => reply({ ok: false, error: e.message }));
  return true;
});

async function handle(msg) {
  switch (msg.type) {
    case 'get_settings':
      return { ok: true, settings: await chrome.storage.sync.get(DEFAULTS) };

    case 'save_settings':
      await chrome.storage.sync.set(msg.settings);
      return { ok: true };

    case 'get_daily_count': {
      const d = await chrome.storage.local.get('lai_daily');
      const rec = d.lai_daily || {};
      const today = new Date().toDateString();
      return { ok: true, count: rec.date === today ? (rec.count || 0) : 0 };
    }

    case 'inc_daily': {
      const d = await chrome.storage.local.get('lai_daily');
      const rec = d.lai_daily || {};
      const today = new Date().toDateString();
      const count = (rec.date === today ? (rec.count || 0) : 0) + 1;
      await chrome.storage.local.set({ lai_daily: { date: today, count } });
      return { ok: true, count };
    }

    case 'generate': {
      const s = await chrome.storage.sync.get(DEFAULTS);
      const prompt = s.style === 'custom'
        ? (s.customPrompt || STYLES.insightful)
        : (STYLES[s.style] || STYLES.insightful);
      try {
        const comment = s.aiProvider === 'gemini'
          ? await callGemini(msg.text, prompt, s)
          : await callOpenAI(msg.text, prompt, s);
        return { ok: true, comment };
      } catch (e) {
        return { ok: false, error: e.message, retryAfter: e.retryAfter || 0 };
      }
    }

    default:
      return { ok: false, error: 'unknown' };
  }
}

async function callOpenAI(postText, prompt, s) {
  if (!s.openaiKey) throw new Error('No OpenAI API Key in settings');
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.openaiKey },
    body: JSON.stringify({
      model: s.gptModel || 'gpt-4o-mini',
      max_tokens: 300,
      temperature: 0.85,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user',   content: 'POST:\n\n' + postText },
      ],
    }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e?.error?.message || 'OpenAI ' + r.status);
  }
  const d = await r.json();
  const c = d.choices?.[0]?.message?.content?.trim();
  if (!c) throw new Error('OpenAI returned empty response');
  return c;
}

async function callGemini(postText, prompt, s) {
  if (!s.geminiKey) throw new Error('No Gemini API Key in settings');
  const preferred = s.geminiModel || 'gemini-2.0-flash';
  const models = [preferred, 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro']
    .filter((m, i, a) => a.indexOf(m) === i);

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt + '\n\nPOST:\n\n' + postText }] }],
    generationConfig: { maxOutputTokens: 300, temperature: 0.85 },
  });

  for (const model of models) {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/'
      + model + ':generateContent?key=' + s.geminiKey;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (r.status === 429) {
      const e = await r.json().catch(() => ({}));
      console.log('[LinkedInAI] ' + model + ' quota, trying next...');
      continue;
    }
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      const msg = e?.error?.message || 'Gemini ' + r.status;
      const sec = msg.match(/retry in ([\d.]+)s/i);
      const err = new Error(msg);
      err.retryAfter = sec ? Math.ceil(parseFloat(sec[1])) + 1 : 0;
      throw err;
    }

    const d = await r.json();
    const c = d.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!c) throw new Error('Gemini returned empty response');
    return c;
  }

  const err = new Error('All Gemini models hit quota. Please wait.');
  err.retryAfter = 60;
  throw err;
}
