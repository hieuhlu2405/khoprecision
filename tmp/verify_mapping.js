
const xlsx = require('xlsx');
const path = require('path');

async function inspect() {
  const filePath = path.join('d:', 'pp', 'public', 'templates', 'maupgh.xlsx');
  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  
  const cells = ['A2', 'A3', 'B9', 'B10', 'B11', 'B12', 'H8', 'H9', 'H11', 'A16'];
  cells.forEach(c => {
    const cell = sheet[c];
    console.log(`${c}: ${cell ? cell.v : 'EMPTY'}`);
  });
}

inspect().catch(console.error);
