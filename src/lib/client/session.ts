export interface Creds {
  playerId: string;
  token: string;
}

const key = (code: string) => `strip-party:${code}`;

// sessionStorage = one identity per browser tab, so you can test with two tabs
export function loadCreds(code: string): Creds | null {
  try {
    const raw = sessionStorage.getItem(key(code));
    return raw ? (JSON.parse(raw) as Creds) : null;
  } catch {
    return null;
  }
}

export function saveCreds(code: string, creds: Creds) {
  try {
    sessionStorage.setItem(key(code), JSON.stringify(creds));
  } catch {
    /* storage blocked: the player will need to rejoin after a refresh */
  }
}

export function clearCreds(code: string) {
  try {
    sessionStorage.removeItem(key(code));
  } catch {
    /* ignore */
  }
}
