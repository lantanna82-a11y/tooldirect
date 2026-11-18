# ToolDirect — база знаний

Статическое Telegram Mini App по деревообработке.

- Готовый сайт: `knowledge-mini-app/dist`
- Локальный сборщик: `knowledge-mini-app/scripts/build.mjs`
- Проверка: `cd knowledge-mini-app && npm run validate`
- Публикация: GitHub Pages через workflow в `.github/workflows/pages.yml`

Исходные заметки обрабатываются только локально и в репозиторий не загружаются. После ручной пересборки коммитится очищенный каталог `dist`.

Для обновления положите локальную папку `1` рядом с `knowledge-mini-app`, выполните `npm run check` внутри `knowledge-mini-app`, а затем зафиксируйте обновлённый `dist`. Папка `1` исключена из Git.
