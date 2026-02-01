# 🐭 Мышонок Пи - Игра для Android

Платформер про мышонка Пи, который убегает от совы и летит на Луну!

## 📱 Быстрый старт (сборка APK)

### Требования
- Node.js 18+ (https://nodejs.org)
- Android Studio (https://developer.android.com/studio)
- Java JDK 17+ (установится с Android Studio)

### Шаги сборки

```bash
# 1. Перейди в папку проекта
cd mousie-pi-game

# 2. Установи зависимости
npm install

# 3. Добавь платформу Android
npx cap add android

# 4. Синхронизируй проект
npx cap sync

# 5. Открой в Android Studio
npx cap open android
```

### В Android Studio:
1. Дождись окончания синхронизации Gradle (внизу будет прогресс)
2. Меню **Build → Build Bundle(s) / APK(s) → Build APK(s)**
3. APK будет в `android/app/build/outputs/apk/debug/app-debug.apk`

### Альтернатива (без Android Studio):
```bash
cd android
./gradlew assembleDebug
```

APK: `android/app/build/outputs/apk/debug/app-debug.apk`

---

## 🎮 Управление

### На телефоне:
- **◀ ▶** — движение влево/вправо
- **ПРЫГ** — прыжок (в платформере)
- В космосе: только влево/вправо для уклонения

### На компьютере:
- **← →** или **A D** — движение
- **↑**, **W** или **Пробел** — прыжок

---

## 🌍 Зоны игры

1. 🌲 **Лес** — зелёный, деревья, пауки в ямах
2. 🏜️ **Пустыня** — песок, кактусы, песчаные черви
3. 🌋 **Вулкан** — лава, огненные монстры
4. ❄️ **Ледник** — снег, ледяные горы
5. 🌊 **Океан** — волны, осьминоги
6. 🚀 **Космос** — уклоняйся от астероидов!

---

## 📁 Структура проекта

```
mousie-pi-game/
├── www/
│   └── index.html      # Игра (HTML5 Canvas)
├── android/            # Android проект (после cap add android)
├── package.json        # Зависимости npm
├── capacitor.config.json # Настройки Capacitor
└── README.md           # Этот файл
```

---

## 🔧 Продолжение разработки в Claude Code

```bash
# Открой проект в Claude Code
claude code mousie-pi-game/

# Или укажи файл
claude code mousie-pi-game/www/index.html
```

### Полезные команды:
```bash
# Тест в браузере
npm start
# Откроется http://localhost:3000

# После изменений - синхронизация с Android
npx cap sync

# Пересобрать APK
cd android && ./gradlew assembleDebug
```

---

## 🎨 Кастомизация

### Изменить иконку приложения:
1. Создай иконку 1024x1024 px
2. Положи в `android/app/src/main/res/`
3. Или используй Android Studio: **File → New → Image Asset**

### Изменить splash screen:
Редактируй `capacitor.config.json`:
```json
"SplashScreen": {
  "backgroundColor": "#1a1a2e",
  "launchShowDuration": 2000
}
```

### Изменить название:
В `capacitor.config.json`:
```json
"appName": "Мышонок Пи"
```

---

## 📦 Релизная сборка (для Google Play)

```bash
cd android

# Создай keystore (один раз)
keytool -genkey -v -keystore mousie-pi.keystore -alias mousie -keyalg RSA -keysize 2048 -validity 10000

# Собери релизный APK
./gradlew assembleRelease
```

APK: `android/app/build/outputs/apk/release/app-release-unsigned.apk`

Подпиши APK:
```bash
jarsigner -verbose -sigalg SHA256withRSA -digestalg SHA-256 -keystore mousie-pi.keystore app-release-unsigned.apk mousie
```

---

## 🐛 Решение проблем

### "SDK location not found"
Создай файл `android/local.properties`:
```
sdk.dir=/path/to/Android/Sdk
```

### Gradle не скачивается
Проверь интернет и попробуй:
```bash
cd android
./gradlew --refresh-dependencies
```

### Игра не запускается
- Проверь что `www/index.html` существует
- Запусти `npx cap sync`

---

## 📄 Лицензия

MIT — делай что хочешь! 🎉

---

Создано с ❤️ для дочки
