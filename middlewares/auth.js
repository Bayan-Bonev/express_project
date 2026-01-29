const jwt = require('jsonwebtoken');
const { getSessionByToken } = require('../database/queries');

const JWT_SECRET = process.env.JWT_SECRET;

// Authentication middleware
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'NO_TOKEN',
          message: 'Токен за достъп липсва. Моля, влезте в системата.'
        }
      });
    }

    // Проверка в базата данни за валидност на токена
    const session = getSessionByToken(token);
    
    if (!session) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_SESSION',
          message: 'Сесията е изтекла или е невалидна'
        }
      });
    }

    // Верификация на JWT токена
    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'INVALID_TOKEN',
            message: 'Невалиден или изтекъл токен'
          }
        });
      }
      
      req.user = user;
      req.session = session;
      next();
    });
    
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'AUTH_ERROR',
        message: 'Грешка при автентикация'
      }
    });
  }
};

// Role-based authorization middleware
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Не сте влезли в системата'
        }
      });
    }

    if (!Array.isArray(roles)) {
      roles = [roles];
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: `Нямате необходимите права. Изисква се една от следните роли: ${roles.join(', ')}`
        }
      });
    }

    next();
  };
};

// Check if user is admin or owner of resource
const isAdminOrOwner = (req, res, next) => {
  const requestedIdentifier = req.params.identifier || req.body.identifier;
  
  if (req.user.role === 'admin' || req.user.identifier === requestedIdentifier) {
    next();
  } else {
    return res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Нямате права за достъп до този ресурс'
      }
    });
  }
};

// Validation middleware
const validateUserInput = (req, res, next) => {
  const { role, course_number, teacher_id, average_grade, email } = req.body;
  
  const errors = [];
  
  // Валидация на ролята
  if (role && !['student', 'teacher', 'admin'].includes(role)) {
    errors.push('Невалидна роля. Възможни стойности: student, teacher, admin');
  }
  
  // Валидация на курсов номер за ученици/администратори
  if (role === 'student' || role === 'admin') {
    if (!course_number) {
      errors.push('Курсов номер е задължителен за ученици и администратори');
    } else if (!/^21[1-5]\d{2}$/.test(course_number)) {
      errors.push('Невалиден формат на курсов номер. Очакван формат: 21XYZ, където X=1-5 (паралелка), YZ=01-99 (номер)');
    }
  }
  
  // Валидация на teacher_id за учители
  if (role === 'teacher' && !teacher_id) {
    errors.push('Teacher ID е задължителен за учители');
  }
  
  // Валидация на среден успех
  if (average_grade !== undefined) {
    const grade = parseFloat(average_grade);
    if (isNaN(grade) || grade < 2.0 || grade > 6.0) {
      errors.push('Средният успех трябва да е между 2.00 и 6.00');
    }
  }
  
  // Валидация на email
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push('Невалиден email формат');
  }
  
  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Грешки при валидация на данните',
        details: errors
      }
    });
  }
  
  next();
};

module.exports = {
  authenticateToken,
  requireRole,
  isAdminOrOwner,
  validateUserInput
};