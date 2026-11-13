const crypto = require('node:crypto');
const { encryptSecret, decryptSecret, maskSecret, parseKey, stableStringify } = require('../../src/lib/crypto');

describe('credential encryption (AES-256-GCM)', () => {
  it('round-trips a secret and never contains the plaintext', () => {
    const secret = 'sk-ant-api03-very-secret-value-1234';
    const enc = encryptSecret(secret, 'ai-key:user-1:anthropic');
    expect(enc).toMatch(/^v1\./);
    expect(enc).not.toContain(secret);
    expect(decryptSecret(enc, 'ai-key:user-1:anthropic')).toBe(secret);
  });

  it('uses a random IV so identical secrets encrypt differently', () => {
    expect(encryptSecret('same-secret-value', 'ctx')).not.toBe(encryptSecret('same-secret-value', 'ctx'));
  });

  it('fails to decrypt with a different context (ciphertext bound to user/purpose)', () => {
    const enc = encryptSecret('token-value-abc', 'jira-token:user-a');
    expect(() => decryptSecret(enc, 'jira-token:user-b')).toThrow();
  });

  it('detects tampering', () => {
    const enc = encryptSecret('token-value-abc', 'ctx');
    const parts = enc.split('.');
    const data = Buffer.from(parts[3], 'base64url');
    data[0] ^= 1;
    parts[3] = data.toString('base64url');
    expect(() => decryptSecret(parts.join('.'), 'ctx')).toThrow();
  });

  it('fails with the wrong master key', () => {
    const enc = encryptSecret('token-value-abc', 'ctx');
    expect(() => decryptSecret(enc, 'ctx', crypto.randomBytes(32))).toThrow();
  });

  it('validates master key length', () => {
    expect(() => parseKey(Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
    expect(parseKey('a'.repeat(64))).toHaveLength(32);
  });

  it('masks secrets revealing at most 4 trailing characters', () => {
    expect(maskSecret('sk-ant-api03-abcdefghijklmnop')).toBe('sk-ant-••••mnop');
    expect(maskSecret('short')).toBe('••••');
  });

  it('stableStringify is key-order independent', () => {
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(stableStringify({ a: [2, { c: 2, d: 1 }], b: 1 }));
  });
});
