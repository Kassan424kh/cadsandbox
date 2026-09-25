// URL-safe random ids (same alphabet as nanoid) from WebCrypto.
const ALPHABET = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict'

export function randomId(size = 16): string {
  const bytes = crypto.getRandomValues(new Uint8Array(size))
  let id = ''
  for (let i = 0; i < size; i++) id += ALPHABET[bytes[i]! & 63]
  return id
}
