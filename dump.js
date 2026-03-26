const fs = require('fs');
const files = [
  'd:/pp/app/(protected)/inventory/value-report/page.tsx',
  'd:/pp/app/(protected)/inventory/aging/page.tsx',
  'd:/pp/app/(protected)/inventory/comparison/page.tsx'
];
files.forEach(f => {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((l, i) => {
    if (l.includes('toFixed') || l.includes('round') || l.includes('slice(') || l.includes('substring')) {
      console.log(f.split('/').pop(), i + 1, l.trim());
    }
  });
});
