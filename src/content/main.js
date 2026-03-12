if (!window.__LAI__) {
  window.__LAI__ = true;

  const wait = ms => new Promise(r => setTimeout(r, ms));
  const emit = text => chrome.runtime.sendMessage({ type: 'log_line', text }).catch(() => {});

  function findInput() {
    // Любое активное поле ввода комментария
    const all = [...document.querySelectorAll('div[contenteditable="true"]')];
    // Предпочитаем то что в фокусе или внутри comment-box
    return all.find(el => el === document.activeElement)
      || all.find(el => el.closest('[class*="comment"]'))
      || all[0]
      || null;
  }

  function findPostText(input) {
    // Стратегия: идём вверх по DOM и собираем весь текст
    // до тех пор пока не найдём достаточно контента поста
    let node = input.parentElement;

    for (let depth = 0; depth < 30; depth++) {
      if (!node || node === document.body) break;

      // Пробуем взять весь innerText этого контейнера
      // и убрать из него UI-мусор
      const clone = node.cloneNode(true);

      // Удаляем поле ввода и кнопки из клона
      clone.querySelectorAll(
        '[contenteditable], button, .artdeco-button, ' +
        '[class*="action-bar"], [class*="social-action"], ' +
        '[class*="reaction"], [class*="social-count"], ' +
        'svg, img, form, footer, nav, aside'
      ).forEach(n => n.remove());

      const text = clone.innerText
        ?.replace(/\n{3,}/g, '\n\n')
        ?.replace(/\t/g, ' ')
        ?.trim();

      // Если текст достаточно длинный и содержательный — это наш пост
      if (text && text.length > 80) {
        // Дополнительно убираем строки которые явно являются UI
        const lines = text.split('\n').filter(line => {
          const l = line.trim().toLowerCase();
          if (!l) return false;
          if (l.length < 2) return false;
          // Фильтруем кнопки и счётчики
          if (/^(like|comment|repost|send|подобається|коментувати|репост|надіслати|відповісти|reply|follow|connect|\d+\s*(like|comment|reaction|repost))/.test(l)) return false;
          return true;
        });

        const clean = lines.join('\n').trim();
        if (clean.length > 60) return clean.slice(0, 1500);
      }

      node = node.parentElement;
    }

    return '';
  }

  function findSubmitBtn() {
    // Ищем кнопку submit рядом с полем ввода
    const btns = [...document.querySelectorAll('button')];
    return btns.find(b => {
      if (b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
      const t = b.innerText?.trim().toLowerCase();
      const label = (b.getAttribute('aria-label') || '').toLowerCase();
      return ['post', 'submit', 'опублікувати', 'відповісти', 'add comment']
        .some(k => t === k || label.includes(k));
    }) || null;
  }

  async function insertText(input, text) {
    input.focus();
    await wait(300);
    // Клик чтобы активировать редактор LinkedIn
    input.click();
    await wait(200);
    document.execCommand('selectAll', false, null);
    await wait(100);
    document.execCommand('delete', false, null);
    await wait(100);
    document.execCommand('insertText', false, text);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
    await wait(500);
  }

  async function run() {
    emit('🔍 Ищу поле комментария...');

    const input = findInput();
    if (!input) {
      emit('❌ Поле не найдено. Нажми «Коментувати» под постом.');
      chrome.runtime.sendMessage({ type: 'finished', count: 0 }).catch(() => {});
      return;
    }
    emit('✅ Поле найдено');

    emit('📖 Читаю текст поста...');
    const postText = findPostText(input);

    if (!postText) {
      emit('⚠️ Текст не найден — прокрути страницу чтобы пост был виден.');
      chrome.runtime.sendMessage({ type: 'finished', count: 0 }).catch(() => {});
      return;
    }

    emit('📝 Пост: «' + postText.slice(0, 120) + (postText.length > 120 ? '…' : '') + '»');

    emit('💬 Генерирую ответ...');
    const r = await chrome.runtime.sendMessage({ type: 'generate', text: postText });

    if (!r?.ok) {
      const hint = r?.retryAfter ? ' (жду ' + r.retryAfter + 'с)' : '';
      emit('❌ ' + (r?.error || 'Ошибка').slice(0, 120) + hint);
      chrome.runtime.sendMessage({ type: 'finished', count: 0 }).catch(() => {});
      return;
    }

    emit('✍️ «' + r.comment + '»');
    await insertText(input, r.comment);

    await wait(600);
    const btn = findSubmitBtn();
    if (btn) {
      emit('📤 Публикую...');
      btn.click();
      await wait(1500);
      emit('✅ Опубликовано!');
      chrome.runtime.sendMessage({ type: 'inc_daily' }).catch(() => {});
      chrome.runtime.sendMessage({ type: 'count', count: 1 }).catch(() => {});
    } else {
      emit('✅ Вставлено — нажми кнопку публикации сам.');
    }

    chrome.runtime.sendMessage({ type: 'finished', count: 1 }).catch(() => {});
  }

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg.type === 'ping')  reply({ ok: true });
    if (msg.type === 'start') { run(); reply({ ok: true }); }
    return true;
  });

  console.log('[LinkedInAI] ready');
}
