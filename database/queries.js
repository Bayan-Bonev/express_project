const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DATABASE_PATH || './database/db.sqlite';
const db = new Database(dbPath);

// Утилити функции
const handleDatabaseError = (error, operation) => {
  console.error(`Database error during ${operation}:`, error);
  
  if (error.code === 'SQLITE_CONSTRAINT') {
    if (error.message.includes('UNIQUE')) {
      throw { 
        status: 409, 
        message: 'Запис с тези данни вече съществува' 
      };
    }
    if (error.message.includes('FOREIGN KEY')) {
      throw { 
        status: 400, 
        message: 'Невалидна референция към друг запис' 
      };
    }
  }
  
  throw { 
    status: 500, 
    message: 'Грешка в базата данни', 
    details: process.env.NODE_ENV === 'development' ? error.message : undefined 
  };
};

// User queries
const userQueries = {
  // CREATE
  createUser: (userData) => {
    try {
      const stmt = db.prepare(`
        INSERT INTO users (
          identifier, first_name, last_name, email, role, 
          course_number, teacher_id, subject, average_grade, 
          password_hash, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const result = stmt.run(
        userData.identifier,
        userData.first_name,
        userData.last_name,
        userData.email || null,
        userData.role,
        userData.course_number || null,
        userData.teacher_id || null,
        userData.subject || null,
        userData.average_grade || null,
        userData.password_hash,
        userData.created_by || null
      );
      
      return { id: result.lastInsertRowid, ...userData };
    } catch (error) {
      handleDatabaseError(error, 'createUser');
    }
  },

  // READ
  getUserByIdentifier: (identifier) => {
    try {
      const stmt = db.prepare(`
        SELECT id, identifier, first_name, last_name, email, role, 
               course_number, teacher_id, subject, average_grade,
               password_hash, created_at, updated_at, is_active
        FROM users 
        WHERE identifier = ? AND is_active = 1
      `);
      
      return stmt.get(identifier);
    } catch (error) {
      handleDatabaseError(error, 'getUserByIdentifier');
    }
  },

  getUserById: (id) => {
    try {
      const stmt = db.prepare(`
        SELECT id, identifier, first_name, last_name, email, role, 
               course_number, teacher_id, subject, average_grade,
               created_at, updated_at, is_active
        FROM users 
        WHERE id = ? AND is_active = 1
      `);
      
      return stmt.get(id);
    } catch (error) {
      handleDatabaseError(error, 'getUserById');
    }
  },

  getAllUsers: (filters = {}) => {
    try {
      let query = `
        SELECT id, identifier, first_name, last_name, email, role, 
               course_number, teacher_id, subject, average_grade,
               created_at, updated_at, is_active
        FROM users 
        WHERE is_active = 1
      `;
      
      const params = [];
      const conditions = [];
      
      if (filters.role) {
        conditions.push('role = ?');
        params.push(filters.role);
      }
      
      if (filters.search) {
        conditions.push('(first_name LIKE ? OR last_name LIKE ? OR identifier LIKE ?)');
        const searchTerm = `%${filters.search}%`;
        params.push(searchTerm, searchTerm, searchTerm);
      }
      
      if (filters.min_grade) {
        conditions.push('average_grade >= ?');
        params.push(parseFloat(filters.min_grade));
      }
      
      if (filters.subject) {
        conditions.push('subject = ?');
        params.push(filters.subject);
      }
      
      if (conditions.length > 0) {
        query += ' AND ' + conditions.join(' AND ');
      }
      
      query += ' ORDER BY last_name, first_name';
      
      if (filters.limit) {
        query += ' LIMIT ?';
        params.push(parseInt(filters.limit));
      }
      
      if (filters.offset) {
        query += ' OFFSET ?';
        params.push(parseInt(filters.offset));
      }
      
      const stmt = db.prepare(query);
      return stmt.all(...params);
    } catch (error) {
      handleDatabaseError(error, 'getAllUsers');
    }
  },

  getStudents: () => {
    try {
      const stmt = db.prepare(`
        SELECT id, identifier, first_name, last_name, email, 
               course_number, average_grade, created_at, updated_at
        FROM users 
        WHERE role = 'student' AND is_active = 1
        ORDER BY course_number
      `);
      
      return stmt.all();
    } catch (error) {
      handleDatabaseError(error, 'getStudents');
    }
  },

  getTeachers: () => {
    try {
      const stmt = db.prepare(`
        SELECT id, identifier, first_name, last_name, email, 
               teacher_id, subject, created_at, updated_at
        FROM users 
        WHERE role = 'teacher' AND is_active = 1
        ORDER BY last_name, first_name
      `);
      
      return stmt.all();
    } catch (error) {
      handleDatabaseError(error, 'getTeachers');
    }
  },

  // UPDATE
  updateUser: (identifier, updateData) => {
    try {
      const fields = [];
      const values = [];
      
      Object.keys(updateData).forEach(key => {
        if (key !== 'identifier' && key !== 'password_hash') {
          fields.push(`${key} = ?`);
          values.push(updateData[key]);
        }
      });
      
      if (fields.length === 0) {
        throw { status: 400, message: 'Няма данни за обновяване' };
      }
      
      fields.push('updated_at = CURRENT_TIMESTAMP');
      if (updateData.updated_by) {
        fields.push('updated_by = ?');
        values.push(updateData.updated_by);
      }
      
      values.push(identifier);
      
      const stmt = db.prepare(`
        UPDATE users 
        SET ${fields.join(', ')}
        WHERE identifier = ? AND is_active = 1
      `);
      
      const result = stmt.run(...values);
      
      if (result.changes === 0) {
        throw { status: 404, message: 'Потребителят не е намерен' };
      }
      
      return { success: true, changes: result.changes };
    } catch (error) {
      handleDatabaseError(error, 'updateUser');
    }
  },

  updatePassword: (identifier, newPasswordHash) => {
    try {
      const stmt = db.prepare(`
        UPDATE users 
        SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
        WHERE identifier = ? AND is_active = 1
      `);
      
      const result = stmt.run(newPasswordHash, identifier);
      
      if (result.changes === 0) {
        throw { status: 404, message: 'Потребителят не е намерен' };
      }
      
      return { success: true };
    } catch (error) {
      handleDatabaseError(error, 'updatePassword');
    }
  },

  // DELETE (soft delete)
  deleteUser: (identifier, deletedBy) => {
    try {
      const stmt = db.prepare(`
        UPDATE users 
        SET is_active = 0, updated_at = CURRENT_TIMESTAMP, updated_by = ?
        WHERE identifier = ? AND is_active = 1
      `);
      
      const result = stmt.run(deletedBy, identifier);
      
      if (result.changes === 0) {
        throw { status: 404, message: 'Потребителят не е намерен или вече е изтрит' };
      }
      
      return { success: true, changes: result.changes };
    } catch (error) {
      handleDatabaseError(error, 'deleteUser');
    }
  },

  // VALIDATION
  checkIdentifierExists: (identifier) => {
    try {
      const stmt = db.prepare(`
        SELECT COUNT(*) as count 
        FROM users 
        WHERE identifier = ? AND is_active = 1
      `);
      
      const result = stmt.get(identifier);
      return result.count > 0;
    } catch (error) {
      handleDatabaseError(error, 'checkIdentifierExists');
    }
  },

  checkEmailExists: (email) => {
    try {
      if (!email) return false;
      
      const stmt = db.prepare(`
        SELECT COUNT(*) as count 
        FROM users 
        WHERE email = ? AND is_active = 1
      `);
      
      const result = stmt.get(email);
      return result.count > 0;
    } catch (error) {
      handleDatabaseError(error, 'checkEmailExists');
    }
  }
};

// System admin queries
const adminQueries = {
  getSystemAdminByUsername: (username) => {
    try {
      const stmt = db.prepare(`
        SELECT id, username, password_hash, role, created_at
        FROM system_admins 
        WHERE username = ?
      `);
      
      return stmt.get(username);
    } catch (error) {
      handleDatabaseError(error, 'getSystemAdminByUsername');
    }
  },

  getAllSystemAdmins: () => {
    try {
      const stmt = db.prepare(`
        SELECT id, username, role, created_at
        FROM system_admins 
        ORDER BY username
      `);
      
      return stmt.all();
    } catch (error) {
      handleDatabaseError(error, 'getAllSystemAdmins');
    }
  }
};

// Session queries
const sessionQueries = {
  createSession: (userId, token, expiresAt) => {
    try {
      const stmt = db.prepare(`
        INSERT INTO user_sessions (user_id, token, expires_at)
        VALUES (?, ?, ?)
      `);
      
      const result = stmt.run(userId, token, expiresAt);
      return { id: result.lastInsertRowid };
    } catch (error) {
      handleDatabaseError(error, 'createSession');
    }
  },

  getSessionByToken: (token) => {
    try {
      const stmt = db.prepare(`
        SELECT s.*, u.identifier, u.role, u.first_name, u.last_name
        FROM user_sessions s
        LEFT JOIN users u ON s.user_id = u.id
        WHERE s.token = ? AND s.expires_at > CURRENT_TIMESTAMP
      `);
      
      return stmt.get(token);
    } catch (error) {
      handleDatabaseError(error, 'getSessionByToken');
    }
  },

  deleteSession: (token) => {
    try {
      const stmt = db.prepare(`
        DELETE FROM user_sessions 
        WHERE token = ?
      `);
      
      stmt.run(token);
      return { success: true };
    } catch (error) {
      handleDatabaseError(error, 'deleteSession');
    }
  },

  cleanupExpiredSessions: () => {
    try {
      const stmt = db.prepare(`
        DELETE FROM user_sessions 
        WHERE expires_at <= CURRENT_TIMESTAMP
      `);
      
      const result = stmt.run();
      return { deleted: result.changes };
    } catch (error) {
      handleDatabaseError(error, 'cleanupExpiredSessions');
    }
  }
};

// Statistics queries
const statsQueries = {
  getUserStats: () => {
    try {
      const stmt = db.prepare(`
        SELECT 
          role,
          COUNT(*) as count,
          AVG(CASE WHEN role IN ('student', 'admin') THEN average_grade ELSE NULL END) as avg_grade
        FROM users 
        WHERE is_active = 1
        GROUP BY role
      `);
      
      return stmt.all();
    } catch (error) {
      handleDatabaseError(error, 'getUserStats');
    }
  },

  getGradeDistribution: () => {
    try {
      const stmt = db.prepare(`
        SELECT 
          CASE 
            WHEN average_grade >= 5.50 THEN 'Отличен (5.50-6.00)'
            WHEN average_grade >= 4.50 THEN 'Много добър (4.50-5.49)'
            WHEN average_grade >= 3.50 THEN 'Добър (3.50-4.49)'
            WHEN average_grade >= 3.00 THEN 'Среден (3.00-3.49)'
            ELSE 'Слаб (2.00-2.99)'
          END as grade_range,
          COUNT(*) as student_count
        FROM users 
        WHERE role = 'student' AND is_active = 1 AND average_grade IS NOT NULL
        GROUP BY grade_range
        ORDER BY MIN(average_grade) DESC
      `);
      
      return stmt.all();
    } catch (error) {
      handleDatabaseError(error, 'getGradeDistribution');
    }
  }
};

module.exports = {
  ...userQueries,
  ...adminQueries,
  ...sessionQueries,
  ...statsQueries,
  db
};