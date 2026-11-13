const { app, request, registerUser } = require('../helpers/app');
const { resetDb, db } = require('../helpers/db');

beforeEach(resetDb);
afterAll(() => db.sequelize.close());

describe('authentication', () => {
  it('registers, hashes the password and sets an httpOnly cookie', async () => {
    const res = await request(app).post('/api/auth/register').send({ name: 'Ada', email: 'ADA@Example.com', password: 'CorrectHorse42' });
    expect(res.status).toBe(201);
    expect(res.body.data.user).toEqual(expect.objectContaining({ name: 'Ada', email: 'ada@example.com' }));
    expect(res.body.data.user.passwordHash).toBeUndefined();
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(/pf_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    const row = await db.User.findOne({ where: { email: 'ada@example.com' } });
    expect(row.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(row.passwordHash).not.toContain('CorrectHorse42');
  });

  it('validates input', async () => {
    const res = await request(app).post('/api/auth/register').send({ name: '', email: 'nope', password: 'short' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d) => d.path)).toEqual(expect.arrayContaining(['name', 'email', 'password']));
  });

  it('rejects duplicate emails (case-insensitive)', async () => {
    await registerUser({ email: 'dup@example.com' });
    const res = await request(app).post('/api/auth/register').send({ name: 'X', email: 'DUP@example.com', password: 'CorrectHorse42' });
    expect(res.status).toBe(409);
  });

  it('logs in with valid credentials only', async () => {
    await registerUser({ email: 'login@example.com', password: 'CorrectHorse42' });
    const bad = await request(app).post('/api/auth/login').send({ email: 'login@example.com', password: 'WrongHorse42' });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('INVALID_CREDENTIALS');
    const unknown = await request(app).post('/api/auth/login').send({ email: 'ghost@example.com', password: 'WrongHorse42' });
    expect(unknown.status).toBe(401);
    const ok = await request(app).post('/api/auth/login').send({ email: 'LOGIN@example.com', password: 'CorrectHorse42' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.token).toBeTruthy();
  });

  it('protects routes and supports cookie or bearer auth', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Authorization', 'Bearer garbage')).status).toBe(401);
    const u = await registerUser();
    expect((await u.get('/api/auth/me')).body.data.user.id).toBe(u.user.id);
    const cookieRes = await request(app).get('/api/auth/me').set('Cookie', `pf_session=${u.token}`);
    expect(cookieRes.status).toBe(200);
  });

  it('revokes the token on logout', async () => {
    const u = await registerUser();
    expect((await u.post('/api/auth/logout')).status).toBe(204);
    expect((await u.get('/api/auth/me')).status).toBe(401);
  });

  it('updates profile and changes password', async () => {
    const u = await registerUser({ password: 'CorrectHorse42' });
    expect((await u.patch('/api/profile', { name: 'Renamed' })).body.data.user.name).toBe('Renamed');
    expect((await u.post('/api/profile/password', { currentPassword: 'Wrong', newPassword: 'NewPassword99' })).status).toBe(401);
    expect((await u.post('/api/profile/password', { currentPassword: 'CorrectHorse42', newPassword: 'NewPassword99' })).status).toBe(204);
    const login = await request(app).post('/api/auth/login').send({ email: u.user.email, password: 'NewPassword99' });
    expect(login.status).toBe(200);
  });

  it('ignores client-supplied user ids', async () => {
    const a = await registerUser();
    const b = await registerUser();
    const res = await a.patch('/api/profile', { name: 'Hijack', id: b.user.id, userId: b.user.id });
    expect(res.body.data.user.id).toBe(a.user.id);
    expect((await db.User.findByPk(b.user.id)).name).not.toBe('Hijack');
  });
});
