require('dotenv').config();
const express = require('express');
const Database = require('better-sqlite3');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const db = new Database('./database/db.sqlite');

// Инициализация на базата данни
function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      course_number TEXT UNIQUE NOT NULL,
      average_grade REAL CHECK(average_grade >= 2.0 AND average_grade <= 6.0),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Добавяне на тестови данни
  const count = db.prepare('SELECT COUNT(*) as count FROM students').get();
  if (count.count === 0) {
    const insert = db.prepare(`
      INSERT INTO students (first_name, last_name, course_number, average_grade)
      VALUES (?, ?, ?, ?)
    `);
    
    const students = [
      ['Иван', 'Иванов', '21101', 5.25],
      ['Мария', 'Петрова', '21102', 5.75],
      ['Георги', 'Димитров', '21103', 4.80]
    ];
    
    const insertMany = db.transaction((students) => {
      for (const student of students) {
        insert.run(...student);
      }
    });
    
    insertMany(students);
    console.log('Тестови данни добавени');
  }
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    error: 'Вътрешна грешка в сървъра'
  });
});

// Routes
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Сървърът работи',
    timestamp: new Date().toISOString()
  });
});

app.get('/students', (req, res) => {
  try {
    const students = db.prepare('SELECT * FROM students').all();
    res.json({
      success: true,
      count: students.length,
      students
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Грешка при извличане на данни'
    });
  }
});

app.get('/students/:courseNumber', (req, res) => {
  try {
    const { courseNumber } = req.params;
    const student = db.prepare('SELECT * FROM students WHERE course_number = ?').get(courseNumber);
    
    if (!student) {
      return res.status(404).json({
        success: false,
        error: 'Ученикът не е намерен'
      });
    }
    
    res.json({
      success: true,
      student
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Грешка при търсене'
    });
  }
});

app.post('/students', (req, res) => {
  try {
    const { first_name, last_name, course_number, average_grade } = req.body;
    
    if (!first_name || !last_name || !course_number || !average_grade) {
      return res.status(400).json({
        success: false,
        error: 'Липсват задължителни полета'
      });
    }
    
    const stmt = db.prepare(`
      INSERT INTO students (first_name, last_name, course_number, average_grade)
      VALUES (?, ?, ?, ?)
    `);
    
    const result = stmt.run(first_name, last_name, course_number, average_grade);
    
    res.status(201).json({
      success: true,
      message: 'Ученикът е добавен',
      id: result.lastInsertRowid
    });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT') {
      return res.status(409).json({
        success: false,
        error: 'Ученик с този курсов номер вече съществува'
      });
    }
    res.status(500).json({
      success: false,
      error: 'Грешка при добавяне'
    });
  }
});

app.delete('/students/:courseNumber', (req, res) => {
  try {
    const { courseNumber } = req.params;
    const stmt = db.prepare('DELETE FROM students WHERE course_number = ?');
    const result = stmt.run(courseNumber);
    
    if (result.changes === 0) {
      return res.status(404).json({
        success: false,
        error: 'Ученикът не е намерен'
      });
    }
    
    res.json({
      success: true,
      message: 'Ученикът е изтрит'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Грешка при изтриване'
    });
  }
});

// Стартиране на сървъра
app.listen(PORT, () => {
  initDatabase();
  console.log(`Сървърът работи на http://localhost:${PORT}`);
  console.log('Достъпни endpoints:');
  console.log('  GET    /health');
  console.log('  GET    /students');
  console.log('  GET    /students/:courseNumber');
  console.log('  POST   /students');
  console.log('  DELETE /students/:courseNumber');
});