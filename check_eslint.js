const { execSync } = require('child_process');
const fs = require('fs');

try {
  const output = execSync('npx eslint "d:\\pp\\app\\(protected)\\inventory\\comparison\\page.tsx"', { encoding: 'utf8' });
  console.log(output);
} catch (err) {
  console.log(err.stdout);
}
