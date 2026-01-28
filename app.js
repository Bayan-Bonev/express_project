const express = require('express');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { createHash } = require('crypto');
const app = express();

// Зареждане на environment variables
require('dotenv').config();

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key-change-in-production';
const BCRYPT_SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10;
const SESSION_TIMEOUT_HOURS = parseInt(process.env.SESSION_TIMEOUT_HOURS) || 24;

// Администратори от environment variables
const administrators = [
  {
    username: process.env.ADMIN_USERNAME || 'admin',
    passwordHash: createHash('sha256').update(process.env.ADMIN_PASSWORD || 'admin123').digest('hex'),
    role: 'admin'
  },
  {
    username: process.env.ADMIN2_USERNAME || 'superadmin',
    passwordHash: createHash('sha256').update(process.env.ADMIN2_PASSWORD || 'superadmin123').digest('hex'),
    role: 'admin'
  }
];

// Middleware за работа с JSON
app.use(express.json());

// Зареждане на данните от JSON файл
let users = [];

try {
  const data = fs.readFileSync('students.json', 'utf8');
  users = JSON.parse(data);
  
  // Ако нямаме пароли, добавяме по подразбиране
  if (!users[0]?.password) {
    users = users.map(user => {
      const baseUser = { ...user };
      
      // Добавяне на парола по подразбиране според ролята
      if (user.role === 'admin' && user.courseNumber === '21101') {
        baseUser.password = bcrypt.hashSync('admin123', BCRYPT_SALT_ROUNDS);
      } else if (user.role === 'teacher') {
        baseUser.password = bcrypt.hashSync(`teacher${user.teacherId}`, BCRYPT_SALT_ROUNDS);
      } else if (user.role === 'student' && user.courseNumber) {
        baseUser.password = bcrypt.hashSync(`student${user.courseNumber}`, BCRYPT_SALT_ROUNDS);
      }
      
      return baseUser;
    });
    
    saveToFile();
  }
} catch (err) {
  console.error('Грешка при зареждане на файла:', err);
  users = [];
}

// Функция за запазване на промените във файл
const saveToFile = () => {
  fs.writeFileSync('students.json', JSON.stringify(users, null, 2));
};

// ========== MIDDLEWARES ==========

// Middleware за проверка на автентикация (JWT)
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      error: 'Токен за достъп липсва. Моля, влезте в системата.'
    });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({
        error: 'Невалиден или изтекъл токен'
      });
    }
    req.user = user;
    next();
  });
};

// Middleware за проверка дали потребителят е authenticated
const isAuthenticated = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'Не сте влезли в системата или сесията ви е изтекла'
    });
  }
  next();
};

// Middleware за проверка на роля
const requireRole = (role) => {
  return (req, res, next) => {
    if (req.user.role !== role) {
      return res.status(403).json({
        error: `Нямате необходимите права. Изисква се роля: ${role}`
      });
    }
    next();
  };
};

// Middleware за проверка дали е администратор или собственик на ресурса
const isAdminOrOwner = (req, res, next) => {
  const identifier = req.params.identifier || req.body.identifier;
  
  if (req.user.role === 'admin' || req.user.id === identifier) {
    next();
  } else {
    return res.status(403).json({
      error: 'Нямате права за тази операция'
    });
  }
};

// ========== PUBLIC ENDPOINTS (не изискват автентикация) ==========

// 1. POST /login - Вход в системата (поддържа администратори, ученици и учители)
app.post('/login', async (req, res) => {
  const { identifier, password } = req.body;

  if (!identifier || !password) {
    return res.status(400).json({
      error: 'Моля, въведете идентификатор и парола'
    });
  }

  // Първо проверяваме дали е администратор
  const admin = administrators.find(a => a.username === identifier);
  if (admin) {
    const passwordHash = createHash('sha256').update(password).digest('hex');
    
    if (passwordHash === admin.passwordHash) {
      // Създаване на JWT токен за администратор
      const tokenData = {
        id: identifier,
        username: identifier,
        role: 'admin',
        isAdmin: true
      };

      const token = jwt.sign(tokenData, JWT_SECRET, { 
        expiresIn: `${SESSION_TIMEOUT_HOURS}h` 
      });

      return res.json({
        message: 'Успешен вход като администратор',
        token: token,
        user: {
          id: identifier,
          username: identifier,
          role: 'admin',
          isAdmin: true
        }
      });
    }
  }

  // Ако не е администратор, проверяваме за обикновен потребител
  const user = users.find(u => 
    (u.courseNumber === identifier) || (u.teacherId === identifier)
  );
  
  if (!user) {
    return res.status(401).json({
      error: 'Грешен идентификатор или парола'
    });
  }

  try {
    const passwordMatch = await bcrypt.compare(password, user.password);
    
    if (!passwordMatch) {
      return res.status(401).json({
        error: 'Грешен идентификатор или парола'
      });
    }

    // Подготовка на данни за токена
    const tokenData = {
      id: user.courseNumber || user.teacherId,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role || 'student',
      isAdmin: false
    };

    if (user.role === 'student') {
      tokenData.courseNumber = user.courseNumber;
      tokenData.averageGrade = user.averageGrade;
    } else if (user.role === 'teacher') {
      tokenData.teacherId = user.teacherId;
      tokenData.subject = user.subject;
    } else if (user.role === 'admin') {
      tokenData.courseNumber = user.courseNumber;
      tokenData.averageGrade = user.averageGrade;
      tokenData.isAdmin = true;
    }

    const token = jwt.sign(tokenData, JWT_SECRET, { 
      expiresIn: `${SESSION_TIMEOUT_HOURS}h` 
    });

    const userResponse = {
      id: user.courseNumber || user.teacherId,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role || 'student',
      isAdmin: user.role === 'admin'
    };

    if (user.role === 'student' || user.role === 'admin') {
      userResponse.courseNumber = user.courseNumber;
      userResponse.averageGrade = user.averageGrade;
    } else if (user.role === 'teacher') {
      userResponse.teacherId = user.teacherId;
      userResponse.subject = user.subject;
    }

    res.json({
      message: 'Успешен вход',
      token: token,
      user: userResponse
    });
  } catch (error) {
    console.error('Грешка при вход:', error);
    res.status(500).json({
      error: 'Грешка при обработка на заявката'
    });
  }
});

// 2. POST /logout - Изход от системата
app.post('/logout', (req, res) => {
  res.json({
    message: 'Успешно излизане. Моля, изтрийте токена от клиента.'
  });
});

// 3. GET /users - Връща всички потребители (публичен достъп)
app.get('/users', (req, res) => {
  const { role } = req.query;
  let filteredUsers = [...users];
  
  if (role) {
    filteredUsers = filteredUsers.filter(u => u.role === role);
  }
  
  const usersWithoutPasswords = filteredUsers.map(({ password, ...rest }) => rest);
  
  res.json({
    count: filteredUsers.length,
    users: usersWithoutPasswords
  });
});

// 4. GET /students - Връща само учениците
app.get('/students', (req, res) => {
  const students = users.filter(u => u.role === 'student');
  const studentsWithoutPasswords = students.map(({ password, ...rest }) => rest);
  
  res.json({
    count: students.length,
    students: studentsWithoutPasswords
  });
});

// 5. GET /teachers - Връща само учителите
app.get('/teachers', (req, res) => {
  const teachers = users.filter(u => u.role === 'teacher');
  const teachersWithoutPasswords = teachers.map(({ password, ...rest }) => rest);
  
  res.json({
    count: teachers.length,
    teachers: teachersWithoutPasswords
  });
});

// 6. GET /users/:identifier - Търсене по courseNumber или teacherId
app.get('/users/:identifier', (req, res) => {
  const identifier = req.params.identifier;
  const user = users.find(u => 
    u.courseNumber === identifier || u.teacherId === identifier
  );
  
  if (user) {
    const { password, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  } else {
    res.status(404).json({
      error: 'Потребител с този идентификатор не е намерен',
      identifier: identifier
    });
  }
});

// 7. GET /users/search - Търсене с филтри
app.get('/users/search', (req, res) => {
  const { firstName, lastName, role, minGrade, subject } = req.query;
  let results = [...users];
  
  if (firstName) {
    results = results.filter(u => 
      u.firstName.toLowerCase().includes(firstName.toLowerCase())
    );
  }
  
  if (lastName) {
    results = results.filter(u => 
      u.lastName.toLowerCase().includes(lastName.toLowerCase())
    );
  }
  
  if (role) {
    results = results.filter(u => u.role === role);
  }
  
  if (minGrade && (role === 'student' || role === 'admin')) {
    const grade = parseFloat(minGrade);
    results = results.filter(u => u.averageGrade >= grade);
  }
  
  if (subject && role === 'teacher') {
    results = results.filter(u => u.subject === subject);
  }
  
  const resultsWithoutPasswords = results.map(({ password, ...rest }) => rest);
  
  res.json({
    count: results.length,
    users: resultsWithoutPasswords
  });
});

// ========== PROTECTED ENDPOINTS (изискват автентикация) ==========

// 8. GET /profile - Връща информация за текущия потребител
app.get('/profile', authenticateToken, isAuthenticated, (req, res) => {
  // Ако е администратор от .env файла
  if (req.user.isAdmin && req.user.username) {
    const admin = administrators.find(a => a.username === req.user.username);
    if (admin) {
      return res.json({
        user: {
          id: req.user.username,
          username: req.user.username,
          role: 'admin',
          isAdmin: true
        }
      });
    }
  }
  
  // Ако е обикновен потребител
  const identifier = req.user.id;
  const user = users.find(u => 
    u.courseNumber === identifier || u.teacherId === identifier
  );
  
  if (user) {
    const { password, ...userWithoutPassword } = user;
    res.json({
      user: userWithoutPassword
    });
  } else {
    res.status(404).json({
      error: 'Потребителят не е намерен'
    });
  }
});

// 9. PUT /profile/password - Промяна на собствена парола
app.put('/profile/password', authenticateToken, isAuthenticated, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  
  if (!currentPassword || !newPassword) {
    return res.status(400).json({
      error: 'Моля, въведете текущата и новата парола'
    });
  }
  
  // Ако е администратор от .env файла
  if (req.user.isAdmin && req.user.username) {
    const admin = administrators.find(a => a.username === req.user.username);
    if (admin) {
      const currentPasswordHash = createHash('sha256').update(currentPassword).digest('hex');
      
      if (currentPasswordHash !== admin.passwordHash) {
        return res.status(401).json({
          error: 'Грешна текуща парола'
        });
      }
      
      // В реално приложение бихме запазили новата парола
      // Тук само връщаме съобщение
      return res.json({
        message: 'За промяна на администраторска парола се свържете със системния администратор'
      });
    }
  }
  
  // Ако е обикновен потребител
  const identifier = req.user.id;
  const user = users.find(u => 
    u.courseNumber === identifier || u.teacherId === identifier
  );
  
  if (!user) {
    return res.status(404).json({
      error: 'Потребителят не е намерен'
    });
  }
  
  const passwordMatch = await bcrypt.compare(currentPassword, user.password);
  
  if (!passwordMatch) {
    return res.status(401).json({
      error: 'Грешна текуща парола'
    });
  }
  
  const hashedNewPassword = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
  user.password = hashedNewPassword;
  user.updatedAt = new Date().toISOString();
  
  saveToFile();
  
  res.json({
    message: 'Паролата е променена успешно'
  });
});

// 10. POST /users - Добавяне на нов потребител (изисква автентикация и роля admin)
app.post('/users', authenticateToken, isAuthenticated, requireRole('admin'), (req, res) => {
  const newUser = req.body;
  
  if (!newUser.role || !['student', 'teacher'].includes(newUser.role)) {
    return res.status(400).json({
      error: 'Невалидна роля. Възможни стойности: student, teacher'
    });
  }
  
  if (newUser.role === 'student') {
    const requiredFields = ['firstName', 'lastName', 'courseNumber', 'averageGrade'];
    const missingFields = requiredFields.filter(field => !newUser[field]);
    
    if (missingFields.length > 0) {
      return res.status(400).json({
        error: `За ученик липсват задължителни полета: ${missingFields.join(', ')}`
      });
    }
    
    const courseNumberRegex = /^21[1-5]\d{2}$/;
    if (!courseNumberRegex.test(newUser.courseNumber)) {
      return res.status(400).json({
        error: 'Невалиден формат на курсов номер. Очакван формат: 21XYZ, където X=1-5 (паралелка), YZ=01-99 (номер)'
      });
    }
    
    if (users.find(u => u.courseNumber === newUser.courseNumber)) {
      return res.status(409).json({
        error: 'Ученик с този курсов номер вече съществува'
      });
    }
    
  } else if (newUser.role === 'teacher') {
    const requiredFields = ['firstName', 'lastName', 'teacherId', 'subject'];
    const missingFields = requiredFields.filter(field => !newUser[field]);
    
    if (missingFields.length > 0) {
      return res.status(400).json({
        error: `За учител липсват задължителни полета: ${missingFields.join(', ')}`
      });
    }
    
    if (users.find(u => u.teacherId === newUser.teacherId)) {
      return res.status(409).json({
        error: 'Учител с този teacherId вече съществува'
      });
    }
  }
  
  let defaultPassword = '';
  if (newUser.role === 'student') {
    defaultPassword = `student${newUser.courseNumber}`;
  } else if (newUser.role === 'teacher') {
    defaultPassword = `teacher${newUser.teacherId}`;
  }
  
  const userWithPassword = {
    ...newUser,
    password: bcrypt.hashSync(defaultPassword, BCRYPT_SALT_ROUNDS),
    createdAt: new Date().toISOString(),
    createdBy: req.user.id
  };
  
  users.push(userWithPassword);
  saveToFile();
  
  const { password, ...userResponse } = userWithPassword;
  
  res.status(201).json({
    message: 'Потребителят е добавен успешно',
    user: userResponse,
    defaultPassword: defaultPassword,
    addedBy: req.user.id,
    totalUsers: users.length
  });
});

// 11. PUT /users/:identifier - Обновяване на потребител (изисква автентикация)
app.put('/users/:identifier', authenticateToken, isAuthenticated, (req, res) => {
  const identifier = req.params.identifier;
  const updatedData = req.body;
  
  const index = users.findIndex(u => 
    u.courseNumber === identifier || u.teacherId === identifier
  );
  
  if (index === -1) {
    return res.status(404).json({
      error: 'Потребител с този идентификатор не е намерен'
    });
  }
  
  const user = users[index];
  
  // Проверка на правата
  if (req.user.role !== 'admin' && req.user.id !== identifier) {
    return res.status(403).json({
      error: 'Можете да редактирате само собствения си профил'
    });
  }
  
  if (req.user.role !== 'admin' && updatedData.role && updatedData.role !== user.role) {
    return res.status(403).json({
      error: 'Само администраторите могат да променят ролята'
    });
  }
  
  delete updatedData.courseNumber;
  delete updatedData.teacherId;
  delete updatedData.password;
  
  users[index] = { 
    ...user, 
    ...updatedData,
    updatedBy: req.user.id,
    updatedAt: new Date().toISOString()
  };
  
  saveToFile();
  
  const { password, ...userResponse } = users[index];
  
  res.json({
    message: 'Данните на потребителя са обновени успешно',
    user: userResponse,
    updatedBy: req.user.id
  });
});

// 12. DELETE /users/:identifier - Премахване на потребител (изисква автентикация и роля admin)
app.delete('/users/:identifier', authenticateToken, isAuthenticated, requireRole('admin'), (req, res) => {
  const identifier = req.params.identifier;
  
  const userToDelete = users.find(u => 
    u.courseNumber === identifier || u.teacherId === identifier
  );
  
  if (!userToDelete) {
    return res.status(404).json({
      error: 'Потребител с този идентификатор не е намерен'
    });
  }
  
  if (userToDelete.role === 'admin') {
    return res.status(403).json({
      error: 'Не можете да премахвате администратори'
    });
  }
  
  users = users.filter(u => 
    !(u.courseNumber === identifier || u.teacherId === identifier)
  );
  
  saveToFile();
  
  const { password, ...userWithoutPassword } = userToDelete;
  
  res.json({
    message: 'Потребителят е премахнат успешно',
    removedUser: userWithoutPassword,
    removedBy: req.user.id,
    remainingUsers: users.length
  });
});

// 13. GET /admins - Връща информация за администраторите (само за администратори)
app.get('/admins', authenticateToken, isAuthenticated, requireRole('admin'), (req, res) => {
  const adminsInfo = administrators.map(admin => ({
    username: admin.username,
    role: admin.role
  }));
  
  res.json({
    count: adminsInfo.length,
    admins: adminsInfo
  });
});

// Стартиране на сървъра
app.listen(PORT, () => {
  console.log(`Сървърът работи на http://localhost:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Session timeout: ${SESSION_TIMEOUT_HOURS} часа`);
  console.log('\n=== ПУБЛИЧНИ ENDPOINTS ===');
  console.log('POST   /login                         - Вход с идентификатор и парола');
  console.log('POST   /logout                        - Изход от системата');
  console.log('GET    /users                         - Всички потребители');
  console.log('GET    /students                      - Само ученици');
  console.log('GET    /teachers                      - Само учители');
  console.log('GET    /users/:identifier            - Потребител по идентификатор');
  console.log('GET    /users/search                 - Търсене с филтри');
  
  console.log('\n=== ЗАЩИТЕНИ ENDPOINTS (изискват автентикация) ===');
  console.log('GET    /profile                       - Собствен профил');
  console.log('PUT    /profile/password              - Промяна на собствена парола');
  console.log('PUT    /users/:identifier            - Обновяване на потребител');
  
  console.log('\n=== АДМИН ENDPOINTS (изискват роля admin) ===');
  console.log('POST   /users                         - Добавяне на нов потребител');
  console.log('DELETE /users/:identifier            - Премахване на потребител');
  console.log('GET    /admins                        - Списък на администраторите');
  
  console.log('\n=== ТЕСТОВИ АКАУНТИ ===');
  console.log('Администратор 1: username=admin, password=admin123');
  console.log('Администратор 2: username=superadmin, password=superadmin123');
  console.log('Ученик: identifier=21103, password=student21103');
  console.log('Учител: identifier=T001, password=teacherT001');
});

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