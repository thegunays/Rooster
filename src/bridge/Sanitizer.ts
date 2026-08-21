import { normalizeDeclarationList, normalizeStylesheet } from "./cssPolicy";
import { canonicalizeHtml, type CanonicalCssPolicy } from "./htmlCanonicalizer";

export interface HtmlNormalizer {
  normalizeHtml(value: string | null | undefined): string;
}

const CSS_POLICY: CanonicalCssPolicy = {
  normalizeDeclarationList,
  normalizeStylesheet
};

export class Sanitizer implements HtmlNormalizer {
  normalizeHtml(value: string | null | undefined): string {
    return canonicalizeHtml(value, CSS_POLICY);
  }
}
