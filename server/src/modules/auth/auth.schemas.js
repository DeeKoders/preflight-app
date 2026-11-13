'use strict';

const { z } = require('zod');

const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);
const password = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((p) => /[a-zA-Z]/.test(p) && /[0-9]/.test(p), 'Password must contain letters and numbers');

const registerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  email,
  password,
});

const loginSchema = z.object({ email, password: z.string().min(1, 'Password is required').max(128) });

const updateProfileSchema = z.object({ name: z.string().trim().min(1).max(120) });

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: password,
});

module.exports = { registerSchema, loginSchema, updateProfileSchema, changePasswordSchema };
