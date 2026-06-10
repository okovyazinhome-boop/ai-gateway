export class HttpError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }
}

export function assertRequired(value, message) {
  if (value === undefined || value === null || value === "") {
    throw new HttpError(400, message);
  }
}

export function toPublicError(error) {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      message: error.message,
      details: error.details
    };
  }

  return {
    status: 500,
    message: "Внутренняя ошибка backend.",
    details: process.env.NODE_ENV === "production" ? null : String(error?.stack || error)
  };
}
