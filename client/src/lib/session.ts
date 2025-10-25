const STORAGE_KEY = 'tossr:token'

export function getSessionToken() {
  return localStorage.getItem(STORAGE_KEY) ?? ''
}

export function setSessionToken(token: string) {
  localStorage.setItem(STORAGE_KEY, token)
}

export function clearSessionToken() {
  localStorage.removeItem(STORAGE_KEY)
}
