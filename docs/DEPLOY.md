# Публикация игры на Heroku

Один Heroku-приложение раздаёт **и саму игру** (как устанавливаемое PWA), **и сервер снежков**
(Colyseus по WebSocket). Один адрес, один дино, никакого CORS.

## Что уже готово в репозитории

- `Procfile` → `web: node server/src/index.js`
- корневой `package.json` → `start`, зависимости сервера, `engines.node = 20.x`
- `server/src/index.js` раздаёт папку `www` и слушает `process.env.PORT`
- клиент сам подключается к мультиплееру по адресу текущего сайта (порт не нужен)
- PWA: `www/manifest.webmanifest`, `www/sw.js`, иконки в `www/assets/icons`

## Первая публикация

```bash
# 1. Войти (откроется браузер)
heroku login

# 2. Создать приложение (имя станет частью адреса) и привязать его к репозиторию
heroku create mousie-pi          # → https://mousie-pi-<hash>.herokuapp.com

# 3. Никогда не засыпать: Basic-дино (иначе первый заход ждёт пробуждения ~10-30 c)
heroku ps:type web=basic

# 4. Выложить текущую ветку
git push heroku network_mode:main

# 5. Открыть
heroku open
```

## Обновление после правок

```bash
git push heroku network_mode:main
```

Если менялись файлы в `www/`, поднимите версию кеша в `www/sw.js`
(`CACHE_VERSION = 'mousiepi-v2'`), иначе у уже установивших игру останется старая версия.

## Проверка

```bash
curl -s https://<адрес>/health                       # {"ok":true,...}
curl -s -X POST https://<адрес>/matchmake/joinOrCreate/snowball   # выдаст комнату
heroku logs --tail
```

## Заметки

- Исходники **не публикуются** — Heroku хранит их у себя, наружу видна только игра.
- Игру может открыть любой, кто знает адрес. Если нужно ограничить круг — добавьте код
  приглашения на первом экране или базовую HTTP-авторизацию в `server/src/index.js`.
- Дино раздаёт статику сам: первый заход ~15 МБ, дальше всё берётся из кеша service worker.
- Панель Colyseus для отладки: `https://<адрес>/colyseus`.
