/**
 * Script to check and seed the admin user
 */

import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DB_PATH = process.env.DB_PATH || join(__dirname, 'cline.db');

async function seedAdmin() {
  console.log('Connecting to database:', DB_PATH);
  const db = new Database(DB_PATH);

  // Check if users table exists
  const tableInfo = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();

  if (!tableInfo) {
    console.log('❌ Users table does not exist. Database may not be initialized.');
    db.close();
    process.exit(1);
  }

  console.log('✅ Users table exists');

  // Check existing users
  const users = db.prepare('SELECT id, email, role, created_at FROM users').all();
  console.log('\nCurrent users in database:');
  console.log('========================');
  if (users.length === 0) {
    console.log('No users found');
  } else {
    users.forEach(u => {
      console.log(`ID: ${u.id}`);
      console.log(`Email: ${u.email}`);
      console.log(`Role: ${u.role}`);
      console.log(`Created: ${u.created_at}`);
      console.log('------------------------');
    });
  }

  // Check for admin user
  const adminEmail = 'admin@mail.com';
  const existingAdmin = db.prepare('SELECT * FROM users WHERE email = ?').get(adminEmail);

  if (existingAdmin) {
    console.log(`\n✅ Admin user already exists: ${adminEmail}`);
    console.log('Admin ID:', existingAdmin.id);
    console.log('Admin Role:', existingAdmin.role);
  } else {
    console.log(`\n⚠️ Admin user not found. Creating default admin...`);

    const adminPassword = 'admin123';
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    const userId = randomUUID();

    try {
      db.prepare(`
        INSERT INTO users (id, email, password_hash, role)
        VALUES (?, ?, ?, 'admin')
      `).run(userId, adminEmail, hashedPassword);

      console.log('✅ Default admin user created successfully!');
      console.log('Email: admin@mail.com');
      console.log('Password: admin123');
      console.log('User ID:', userId);
    } catch (err) {
      console.error('❌ Error creating admin user:', err.message);
    }
  }

  // Verify the admin user was created
  const verifyAdmin = db.prepare('SELECT id, email, role FROM users WHERE email = ?').get(adminEmail);
  if (verifyAdmin) {
    console.log('\n✅ Admin user verified in database');
  } else {
    console.log('\n❌ Admin user NOT found after creation attempt');
  }

  db.close();
  console.log('\nDatabase connection closed');
}

seedAdmin().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
