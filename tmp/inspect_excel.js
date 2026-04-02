
const xlsx = require('xlsx');
const path = require('path');

async function inspect() {
  const filePath = path.join('d:', 'pp', 'public', 'templates', 'maupgh.xlsx');
  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  
  const range = xlsx.utils.decode_range(sheet['!ref'] || 'A1:J100');
  
  for (let r = range.s.r; r <= range.e.r; r++) {
    let rowStr = '';
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cellAddress = xlsx.utils.encode_cell({ r, c });
      const cell = sheet[cellAddress];
      if (cell && cell.v) {
        rowStr += `[${cellAddress}: ${cell.v}] `;
      }
    }
    if (rowStr) console.log(rowStr);
  }
}

inspect().catch(console.error);
