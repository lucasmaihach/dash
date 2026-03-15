import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const ENCODING = 'hex'

function getKey(): Buffer {
  const raw = process.env.ENCRYPT_KEY
  if (!raw || raw.length < 16) {
    throw new Error('ENCRYPT_KEY não definida ou muito curta (mínimo 16 caracteres)')
  }
  // Deriva 32 bytes a partir da chave fornecida usando scrypt com salt fixo e público
  return scryptSync(raw, 'meta-dashboard-salt', 32)
}

/**
 * Criptografa um texto plano.
 * Retorna uma string no formato: iv:authTag:ciphertext (tudo em hex)
 */
export function encrypt(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(12) // 96 bits recomendado para GCM
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return [iv.toString(ENCODING), authTag.toString(ENCODING), encrypted.toString(ENCODING)].join(':')
}

/**
 * Descriptografa uma string gerada por `encrypt`.
 */
export function decrypt(ciphertext: string): string {
  const key = getKey()
  const parts = ciphertext.split(':')

  if (parts.length !== 3) {
    throw new Error('Formato de ciphertext inválido')
  }

  const [ivHex, authTagHex, dataHex] = parts
  const iv = Buffer.from(ivHex, ENCODING)
  const authTag = Buffer.from(authTagHex, ENCODING)
  const encrypted = Buffer.from(dataHex, ENCODING)

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8')
}

/**
 * Verifica se um valor já está no formato criptografado (iv:authTag:ciphertext).
 * Útil para evitar double-encrypt em migrações.
 */
export function isEncrypted(value: string): boolean {
  const parts = value.split(':')
  return parts.length === 3 && parts.every((p) => /^[0-9a-f]+$/i.test(p))
}
