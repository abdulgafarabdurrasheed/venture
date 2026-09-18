const isProd = process.env.NODE_ENV === "production";

export function errorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function logError(tag, error) {
  if (isProd) {
    console.error(tag, errorMessage(error));
    return;
  }

  console.error(tag, {
    message: errorMessage(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
}

export function logInfo(tag, details) {
  if (isProd) {
    console.log(tag);
    return;
  }

  console.log(tag, details);
}
