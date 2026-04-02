
const xlsx = require('xlsx');
const path = require('path');

async function inspect() {
  const filePath = path.join('d:', 'pp', 'public', 'templates', 'maupgh.xlsx');
  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  
  console.log('Merged Cells:', sheet['!merges']);
}

inspect().catch(console.error);
