# AI Gateway

Один backend для Make Custom Apps и временного хранилища файлов.

## Провайдеры

- OpenAI: `/api/openai/validate-key`, `/api/openai/universal`
- Gemini: `/api/gemini/validate-key`, `/api/gemini/universal`

Оба провайдера используют одну публичную папку:

```text
/files/...
```

Файлы удаляются автоматически по `FILE_TTL_HOURS`, по умолчанию через 24 часа.

## Coolify

Для одного приложения используйте корень репозитория:

```text
Base Directory: /
Dockerfile Location: /Dockerfile
Port: 3000
```

Environment variables:

```env
PORT=3000
PUBLIC_BASE_URL=https://ai.uraltrackpro.ru
FILES_DIR=/app/public/files
FILE_TTL_HOURS=25
MAX_DOWNLOAD_MB=25
OPENAI_BASE_URL=https://api.openai.com/v1
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
```

API keys в Coolify не хранятся. Make передает ключ нужного провайдера в `Authorization: Bearer ...`.
