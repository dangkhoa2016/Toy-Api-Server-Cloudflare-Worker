export function errorPayload(statusCode, message, details) {
  const payload = {
    error: {
      statusCode,
      message,
    },
  };

  if (typeof details !== 'undefined') payload.error.details = details;

  return payload;
}
