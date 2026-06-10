# Gemini backend

Отдельное приложение внутри общего репозитория `ai-gateway` для Make Custom App Gemini.

## Coolify

Создайте новое Application из этого же репозитория и укажите:

```text
Base Directory: /gemini
Dockerfile Location: /Dockerfile
Port: 3000
```

Environment variables:

```env
PORT=3000
PUBLIC_BASE_URL=https://gemini.uraltrackpro.ru
FILES_DIR=/app/public/files
FILE_TTL_HOURS=24
MAX_DOWNLOAD_MB=25
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
```

Persistent Storage:

```text
/app/public/files
```

Gemini API key не хранится в Coolify. Make передает его в `Authorization: Bearer ...`.

## Endpoints

```text
GET  /health
GET  /api/gemini/validate-key
POST /api/gemini/universal
GET  /files/...
```

## Notes

- TTS сохраняется как WAV, потому что Gemini возвращает PCM-аудио.
- TTS subtitles делаются вторым шагом через Gemini audio understanding.
- Временные файлы удаляются через 24 часа.
