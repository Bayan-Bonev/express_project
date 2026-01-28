const express = require('express');
const fs = require('fs');
const app = express();
const PORT = 3000;

// Middleware за работа с JSON
app.use(express.json());

// Зареждане на данните от students.json
let students = [];
try {
  const data = fs.readFileSync('students.json', 'utf8');
  students = JSON.parse(data);
} catch (err) {
  console.error('Грешка при зареждане на файла:', err);
  students = [];
}

// Запазва данните в students.json
const saveToFile = () => {
  fs.writeFileSync('students.json', JSON.stringify(students, null, 2));
};

// 1. GET /students - връща всички ученици
app.get('/students', (req, res) => {
  res.json({
    count: students.length,
    students: students
  });
});

// 2. GET /students/:courseNumber - турси по курсов номер
app.get('/students/:courseNumber', (req, res) => {
  const courseNumber = req.params.courseNumber;
  const student = students.find(s => s.courseNumber === courseNumber);
  
  if (student) {
    res.json(student);
  } else {
    res.status(404).json({
      error: 'Ученик с този курсов номер не е намерен',
      courseNumber: courseNumber
    });
  }
});

// 3. POST /students - добавя на нов ученик
app.post('/students', (req, res) => {
  const newStudent = req.body;
  
  // Валидация
  if (!newStudent.firstName || !newStudent.lastName || !newStudent.courseNumber || !newStudent.averageGrade) {
    return res.status(400).json({
      error: 'Липсват задължителни полета (firstName, lastName, courseNumber, averageGrade)'
    });
  }
  
  const existingStudent = students.find(s => s.courseNumber === newStudent.courseNumber);
  if (existingStudent) {
    return res.status(409).json({
      error: 'Ученик с този курсов номер вече съществува',
      courseNumber: newStudent.courseNumber
    });
  }
  
  students.push(newStudent);
  saveToFile(); // Запазване във файл
  
  res.status(201).json({
    message: 'Ученикът е добавен успешно',
    student: newStudent,
    totalStudents: students.length
  });
});

// 4. DELETE /students/:courseNumber - премахва на ученик по курсов номер
app.delete('/students/:courseNumber', (req, res) => {
  const courseNumber = req.params.courseNumber;
  const initialLength = students.length;
  
  students = students.filter(s => s.courseNumber !== courseNumber);
  
  if (students.length < initialLength) {
    saveToFile();
    res.json({
      message: 'Ученикът е премахнат успешно',
      removedCourseNumber: courseNumber,
      remainingStudents: students.length
    });
  } else {
    res.status(404).json({
      error: 'Ученик с този курсов номер не е намерен',
      courseNumber: courseNumber
    });
  }
});

// 5. PUT /students/:courseNumber - обновяване на ученик
app.put('/students/:courseNumber', (req, res) => {
  const courseNumber = req.params.courseNumber;
  const updatedData = req.body;
  
  const index = students.findIndex(s => s.courseNumber === courseNumber);
  
  if (index === -1) {
    return res.status(404).json({
      error: 'Ученик с този курсов номер не е намерен',
      courseNumber: courseNumber
    });
  }
  
  // Запазваме стария курсов номер, не позволяваме промяна
  updatedData.courseNumber = courseNumber;
  
  // Обновяваме данните
  students[index] = { ...students[index], ...updatedData };
  saveToFile(); // Запазване във файл
  
  res.json({
    message: 'Данните на ученика са обновени успешно',
    student: students[index]
  });
});

app.listen(PORT, () => {
  console.log(`Сървърът работи на http://localhost:${PORT}`);
  console.log('Достъпни endpoints:');
  console.log('  GET    /students                    - Всички ученици');
  console.log('  GET    /students/:courseNumber     - Ученик по курсов номер');
  console.log('  GET    /students/search?firstName=Иван&minGrade=5.0 - Търсене');
  console.log('  POST   /students                    - Добавяне на нов ученик');
  console.log('  PUT    /students/:courseNumber     - Обновяване на ученик');
  console.log('  DELETE /students/:courseNumber     - Премахване на ученик');
});