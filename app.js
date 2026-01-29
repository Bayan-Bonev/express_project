require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { createHash } = require('crypto');

// Database initialization
const { initializeDatabase } = require('./database/init');
const db = initializeDatabase();

// Import queries
const {
  getUserByIdentifier,
  getAllUsers,
  getStudents,
  getTeachers,
  createUser,
  updateUser,
  updatePassword,
  deleteUser,
  checkIdentifierExists,
  checkEmailExists,
  getSystemAdminByUsername,
  getAllSystemAdmins,
  createSession,
  deleteSession,
  cleanupExpiredSessions,
  getUserStats,
  getGradeDistribution
} = require('./database/queries');

// Import middlewares
const {
  authenticateToken,
  requireRole,
  isAdminOrOwner,
  validateUserInput
} = require('./middlewares/auth');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const BCRYPT_SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10;
const SESSION_TIMEOUT_HOURS = parseInt(process.env.SESSION_TIMEOUT_HOURS) || 24;

// Middleware
app.use(express.json());

// Clean up expired sessions on startup
cleanupExpiredSessions();

// Helper function for consistent JSON responses
const sendResponse = (res, statusCode, data = null, message = '') => {
  const response = {
    success: statusCode >= 200 && statusCode < 300,
    timestamp: new Date().toISOString()
  };

  if (data !== null) {
    response.data = data;
  }

  if (message) {
    response.message = message;
  }

  res.status(statusCode).json(response);
};

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);

  if (err.status) {
    return sendResponse(res, err.status, null, err.message);
  }

  sendResponse(res, 500, null, 'Вътрешна грешка в сървъра');
});

// ========== PUBLIC ENDPOINTS ==========

// 1. Health check
app.get('/health', (req, res) => {
  try {
    // Check database connection
    db.prepare('SELECT 1 as status').get();
    
    sendResponse(res, 200, {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected'
    }, 'Сървърът работи нормално');
  } catch (error) {
    sendResponse(res, 503, {
      status: 'unhealthy',
      database: 'disconnected'
    }, 'Проблем с връзката към базата данни');
  }
});

// 2. Login endpoint
app.post('/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;

    // Validation
    if (!identifier || !password) {
      return sendResponse(res, 400, null, 'Моля, въведете идентификатор и парола');
    }

    let user = null;
    let isSystemAdmin = false;

    // First check if it's a system admin
    const systemAdmin = getSystemAdminByUsername(identifier);
    if (systemAdmin) {
      const passwordHash = createHash('sha256').update(password).digest('hex');
      if (passwordHash === systemAdmin.password_hash) {
        user = {
          id: systemAdmin.id,
          identifier: systemAdmin.username,
          role: 'system_admin',
          isSystemAdmin: true
        };
        isSystemAdmin = true;
      }
    }

    // If not a system admin, check regular users
    if (!user) {
      const dbUser = getUserByIdentifier(identifier);
      if (!dbUser) {
        return sendResponse(res, 401, null, 'Грешен идентификатор или парола');
      }

      const passwordMatch = await bcrypt.compare(password, dbUser.password_hash);
      if (!passwordMatch) {
        return sendResponse(res, 401, null, 'Грешен идентификатор или парола');
      }

      user = {
        id: dbUser.id,
        identifier: dbUser.identifier,
        firstName: dbUser.first_name,
        lastName: dbUser.last_name,
        email: dbUser.email,
        role: dbUser.role,
        courseNumber: dbUser.course_number,
        teacherId: dbUser.teacher_id,
        subject: dbUser.subject,
        averageGrade: dbUser.average_grade,
        isSystemAdmin: false
      };
    }

    // Create JWT token
    const tokenData = {
      id: user.id,
      identifier: user.identifier,
      role: user.role,
      isSystemAdmin: user.isSystemAdmin
    };

    if (!user.isSystemAdmin) {
      tokenData.firstName = user.firstName;
      tokenData.lastName = user.lastName;
      if (user.courseNumber) tokenData.courseNumber = user.courseNumber;
      if (user.teacherId) tokenData.teacherId = user.teacherId;
      if (user.averageGrade) tokenData.averageGrade = user.averageGrade;
    }

    const token = jwt.sign(tokenData, JWT_SECRET, {
      expiresIn: `${SESSION_TIMEOUT_HOURS}h`
    });

    // Store session in database (for regular users only)
    if (!user.isSystemAdmin) {
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + SESSION_TIMEOUT_HOURS);
      
      createSession(user.id, token, expiresAt.toISOString());
    }

    // Prepare user response without sensitive data
    const userResponse = { ...user };
    delete userResponse.password_hash;

    sendResponse(res, 200, {
      token,
      user: userResponse,
      expiresIn: `${SESSION_TIMEOUT_HOURS} часа`
    }, 'Успешен вход');

  } catch (error) {
    console.error('Login error:', error);
    sendResponse(res, 500, null, 'Грешка при вход в системата');
  }
});

// 3. Logout endpoint
app.post('/logout', authenticateToken, (req, res) => {
  try {
    const token = req.headers.authorization.split(' ')[1];
    
    // Delete session from database
    if (!req.user.isSystemAdmin) {
      deleteSession(token);
    }

    sendResponse(res, 200, null, 'Успешно излизане от системата');
  } catch (error) {
    console.error('Logout error:', error);
    sendResponse(res, 500, null, 'Грешка при изход от системата');
  }
});

// 4. Get all users (public, but filtered)
app.get('/users', (req, res) => {
  try {
    const filters = {};
    
    if (req.query.role) filters.role = req.query.role;
    if (req.query.search) filters.search = req.query.search;
    if (req.query.min_grade) filters.min_grade = req.query.min_grade;
    if (req.query.subject) filters.subject = req.query.subject;
    if (req.query.limit) filters.limit = req.query.limit;
    if (req.query.offset) filters.offset = req.query.offset;
    
    const users = getAllUsers(filters);
    
    sendResponse(res, 200, {
      count: users.length,
      users: users,
      filters: filters
    });
  } catch (error) {
    console.error('Get users error:', error);
    sendResponse(res, 500, null, 'Грешка при извличане на потребители');
  }
});

// 5. Get specific user by identifier
app.get('/users/:identifier', (req, res) => {
  try {
    const { identifier } = req.params;
    const user = getUserByIdentifier(identifier);
    
    if (!user) {
      return sendResponse(res, 404, null, 'Потребителят не е намерен');
    }
    
    // Remove password hash from response
    const { password_hash, ...userData } = user;
    
    sendResponse(res, 200, userData);
  } catch (error) {
    console.error('Get user error:', error);
    sendResponse(res, 500, null, 'Грешка при извличане на потребителя');
  }
});

// 6. Get all students
app.get('/students', (req, res) => {
  try {
    const students = getStudents();
    
    sendResponse(res, 200, {
      count: students
    })

/*Тестване:
# 1. Вход като администратор (от .env файла)
curl -X POST http://localhost:3000/login \
  -H "Content-Type: application/json" \
  -d '{"identifier": "admin", "password": "admin123"}'

# 2. Вход като втори администратор
curl -X POST http://localhost:3000/login \
  -H "Content-Type: application/json" \
  -d '{"identifier": "superadmin", "password": "superadmin123"}'

# 3. Добавяне на нов потребител (само администратори)
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "firstName": "Нов",
    "lastName": "Студент",
    "courseNumber": "21127",
    "averageGrade": 5.75,
    "role": "student"
  }'

# 4. Промяна на собствена парола
curl -X PUT http://localhost:3000/profile/password \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "currentPassword": "student21103",
    "newPassword": "новаСигурнаПарола123!"
  }'
*/