/**
 * Serializes JSON for a TEXT column read back through getDB. Its HtmlDecodePlugin
 * decodes entities such as `&quot;` in every string it reads, which would alter or
 * break stored JSON, so `&` is written as `&`; JSON.parse restores it.
 */
export function toStoredJson(value: unknown): string {
  return JSON.stringify(value).replace(/&/g, "\\u0026");
}
