const { redactSecrets } = require('../../src/lib/redact');

describe('redactSecrets', () => {
  it.each([
    ['ANTHROPIC=sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'sk-ant-api03-AAAA'],
    ['token ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'ghp_abcdef'],
    ['AKIAABCDEFGHIJKLMNOP', 'AKIAABCDEFGHIJKLMNOP'],
    ['DATABASE_URL=postgres://admin:hunter2secret@db:5432/app', 'hunter2secret'],
    ['password: "SuperSecret123!"', 'SuperSecret123'],
    ['-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----', 'MIIabc'],
  ])('redacts %s', (input, leaked) => {
    expect(redactSecrets(input)).not.toContain(leaked);
  });

  it('leaves normal text alone', () => {
    expect(redactSecrets('Add CSV export for invoices')).toBe('Add CSV export for invoices');
  });
});
