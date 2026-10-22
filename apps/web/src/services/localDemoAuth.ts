export type LocalUser = {
  email: string
  name: string
}

type StoredAccount = LocalUser & {
  salt: string
  passwordHash: string
}

const accountStorageKey = 'commitment-radar-local-accounts'
const sessionStorageKey = 'commitment-radar-local-session'
const passwordIterations = 210_000
const demoUser: LocalUser = {
  email: 'demo@commitmentradar.app',
  name: 'Demo User',
}
const demoSalt = 'commitment-radar-demo-v1'
const demoPasswordHash = 'Bjd6NtKOPb1M66z/MH8RIi5Dt/pJAgJnD2mdItm8xSU='

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function readAccounts(): StoredAccount[] {
  const stored = window.localStorage.getItem(accountStorageKey)
  if (!stored) return []

  const value: unknown = JSON.parse(stored)
  if (!Array.isArray(value)) throw new Error('Saved local accounts could not be read.')

  return value.map((entry): StoredAccount => {
    if (!isRecord(entry) ||
      typeof entry.email !== 'string' ||
      typeof entry.name !== 'string' ||
      typeof entry.salt !== 'string' ||
      typeof entry.passwordHash !== 'string') {
      throw new Error('Saved local account data is invalid. Clear this browser’s local app data and try again.')
    }
    return {
      email: entry.email,
      name: entry.name,
      salt: entry.salt,
      passwordHash: entry.passwordHash,
    }
  })
}

async function hashPassword(password: string, salt: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Secure password hashing is unavailable in this browser context. Use localhost or HTTPS.')
  }
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(salt),
      iterations: passwordIterations,
    },
    key,
    256,
  )
  return encodeBase64(new Uint8Array(bits))
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function readLocalSession(): LocalUser | null {
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(sessionStorageKey) ?? 'null')
    if (!isRecord(value) || typeof value.email !== 'string' || typeof value.name !== 'string') return null
    return { email: value.email, name: value.name }
  } catch {
    return null
  }
}

export async function signInLocal(email: string, password: string): Promise<LocalUser> {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail || !password) throw new Error('Enter your email and password.')

  if (normalizedEmail === demoUser.email) {
    const suppliedHash = await hashPassword(password, demoSalt)
    if (suppliedHash !== demoPasswordHash) throw new Error('Email or password is incorrect.')
    window.sessionStorage.setItem(sessionStorageKey, JSON.stringify(demoUser))
    return demoUser
  }

  const account = readAccounts().find((candidate) => candidate.email === normalizedEmail)
  if (!account) throw new Error('Email or password is incorrect.')
  const suppliedHash = await hashPassword(password, account.salt)
  if (suppliedHash !== account.passwordHash) throw new Error('Email or password is incorrect.')

  const user = { email: account.email, name: account.name }
  window.sessionStorage.setItem(sessionStorageKey, JSON.stringify(user))
  return user
}

export async function signUpLocal(name: string, email: string, password: string): Promise<LocalUser> {
  const normalizedName = name.trim()
  const normalizedEmail = normalizeEmail(email)
  if (normalizedName.length < 2) throw new Error('Enter a name with at least 2 characters.')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error('Enter a valid email address.')
  }
  if (normalizedEmail === demoUser.email || readAccounts().some((account) => account.email === normalizedEmail)) {
    throw new Error('An account with this email already exists.')
  }
  if (password.length < 8) throw new Error('Use a password with at least 8 characters.')

  const salt = encodeBase64(crypto.getRandomValues(new Uint8Array(16)))
  const account: StoredAccount = {
    email: normalizedEmail,
    name: normalizedName,
    salt,
    passwordHash: await hashPassword(password, salt),
  }
  try {
    window.localStorage.setItem(accountStorageKey, JSON.stringify([...readAccounts(), account]))
    const user = { email: account.email, name: account.name }
    window.sessionStorage.setItem(sessionStorageKey, JSON.stringify(user))
    return user
  } catch (error) {
    throw new Error(error instanceof Error
      ? `Could not save this local demo account: ${error.message}`
      : 'Could not save this local demo account.')
  }
}

export function signOutLocal(): void {
  window.sessionStorage.removeItem(sessionStorageKey)
}

export const demoCredentials = {
  email: demoUser.email,
  password: 'RadarDemo2026!',
}
