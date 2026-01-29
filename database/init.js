const Database = require('better-sqlite3');
const { createHash } = require('crypto');
const bcrypt = require('bcrypt');
const path = require('path');

const dbPath = process.env.DATABASE_PATH || './database/db.sqlite';
const db = new Database(dbPath);

// Включваме foreign keys
db.pragma('foreign_keys = ON');

// Функция за инициализация на базата
function initializeDatabase() {
  try {
    // Създаване на таблица за потребители
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        identifier TEXT UNIQUE NOT NULL,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT UNIQUE,
        role TEXT NOT NULL CHECK(role IN ('student', 'teacher', 'admin')),
        course_number TEXT,
        teacher_id TEXT,
        subject TEXT,
        average_grade REAL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT,
        updated_by TEXT,
        is_active BOOLEAN DEFAULT 1,
        
        CONSTRAINT chk_identifier CHECK(
          (role = 'student' AND course_number IS NOT NULL AND teacher_id IS NULL) OR
          (role = 'teacher' AND teacher_id IS NOT NULL AND course_number IS NULL) OR
          (role = 'admin' AND course_number IS NOT NULL AND teacher_id IS NULL)
        ),
        
        CONSTRAINT chk_grade CHECK(
          (role IN ('student', 'admin') AND average_grade IS NOT NULL AND average_grade >= 2.0 AND average_grade <= 6.0) OR
          (role = 'teacher' AND average_grade IS NULL)
        )
      )
    `);

    // Създаване на таблица за администраторите от .env
    db.exec(`
      CREATE TABLE IF NOT EXISTS system_admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'system_admin',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Създаване на таблица за сесии/токени
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        token TEXT UNIQUE NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Създаване на индекси за бързо търсене
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
      CREATE INDEX IF NOT EXISTS idx_users_course_number ON users(course_number);
      CREATE INDEX IF NOT EXISTS idx_users_teacher_id ON users(teacher_id);
      CREATE INDEX IF NOT EXISTS idx_users_identifier ON users(identifier);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    `);

    // Вмъкване на системни администратори от .env
    const insertSystemAdmin = db.prepare(`
      INSERT OR IGNORE INTO system_admins (username, password_hash, role)
      VALUES (?, ?, ?)
    `);

    const systemAdmins = [
      {
        username: process.env.ADMIN_USERNAME || 'admin',
        password: process.env.ADMIN_PASSWORD || 'admin123',
        role: 'system_admin'
      },
      {
        username: process.env.ADMIN2_USERNAME || 'superadmin',
        password: process.env.ADMIN2_PASSWORD || 'superadmin123',
        role: 'system_admin'
      }
    ];

    systemAdmins.forEach(admin => {
      const passwordHash = createHash('sha256').update(admin.password).digest('hex');
      insertSystemAdmin.run(admin.username, passwordHash, admin.role);
    });

    // Вмъкване на тестови данни (ако таблицата е празна)
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
    
    if (userCount.count === 0) {
      console.log('Вмъкване на тестови данни...');
      
      const insertUser = db.prepare(`
        INSERT INTO users (
          identifier, first_name, last_name, role, course_number, 
          teacher_id, subject, average_grade, password_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // Тестови ученици
      const testStudents = [
        ['21101', 'Иван', 'Иванов', 'admin', '21101', null, null, 5.25, bcrypt.hashSync('admin123', 10)],
        ['21103', 'Георги', 'Димитров', 'student', '21103', null, null, 4.8, bcrypt.hashSync('student21103', 10)],
        ['21104', 'Анна', 'Стоянова', 'student', '21104', null, null, 5.5, bcrypt.hashSync('student21104', 10)],
        ['21105', 'Димитър', 'Георгиев', 'student', '21105', null, null, 4.95, bcrypt.hashSync('student21105', 10)],
        ['21106', 'Елена', 'Николова', 'student', '21106', null, null, 5.1, bcrypt.hashSync('student21106', 10)]
      ];

      // Тестови учители
      const testTeachers = [
        ['T001', 'Мария', 'Петрова', 'teacher', null, 'T001', 'Математика', null, bcrypt.hashSync('teacherT001', 10)],
        ['T002', 'Никола', 'Желев', 'teacher', null, 'T002', 'Физика', null, bcrypt.hashSync('teacherT002', 10)],
        ['T003', 'Елисавета', 'Дончева', 'teacher', null, 'T003', 'Български език', null, bcrypt.hashSync('teacherT003', 10)]
      ];

      // Изпълнение на вмъкванията в транзакция
      const insertMany = db.transaction((users) => {
        for (const user of users) {
          insertUser.run(...user);
        }
      });

      insertMany([...testStudents, ...testTeachers]);
      
      console.log('Тестовите данни са добавени успешно.');
    }

    console.log('Базата данни е инициализирана успешно.');
    return db;
    
  } catch (error) {
    console.error('Грешка при инициализация на базата данни:', error);
    throw error;
  }
}

module.exports = { db: initializeDatabase(), initializeDatabase };