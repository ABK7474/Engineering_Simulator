// LLM API anahtarı ve model ayarı. Anahtar YALNIZ bu tarayıcının localStorage'ında durur:
// koda, repoya, log'a, dışa aktarılan yedeğe girmez. Depolama kapalıysa oturumla sınırlı kalır.

const KEY = 'derin-muhendis.llm.apiKey';
const MODEL = 'derin-muhendis.llm.model';
const memory = new Map<string, string>();

function read(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return memory.get(k) ?? null;
  }
}

function write(k: string, v: string | null): void {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    if (v === null) memory.delete(k);
    else memory.set(k, v);
  }
}

export const getApiKey = (): string | null => read(KEY) || null;
export const setApiKey = (key: string): void => write(KEY, key.trim() || null);
export const clearApiKey = (): void => write(KEY, null);
export const getModel = (fallback: string): string => read(MODEL) || fallback;
export const setModel = (model: string): void => write(MODEL, model.trim() || null);

/** Ekranda göstermek için: yalnız son 4 karakter. */
export function maskKey(key: string | null): string {
  return key ? `••••${key.slice(-4)}` : 'kayıtlı değil';
}
