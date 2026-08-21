const MAX_PUBLIC_ERROR_LENGTH = 200;
const NON_DISPLAYABLE_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

function sanitizeText(value: string): string {
  const displayableText = value.replace(NON_DISPLAYABLE_CHARACTERS, "");
  return Array.from(displayableText).slice(0, MAX_PUBLIC_ERROR_LENGTH).join("");
}

export function formatPublicError(error: unknown, fallback: string): string {
  const safeFallback = sanitizeText(fallback);

  try {
    if (!(error instanceof Error) || typeof error.message !== "string") {
      return safeFallback;
    }

    return sanitizeText(error.message) || safeFallback;
  } catch {
    return safeFallback;
  }
}
