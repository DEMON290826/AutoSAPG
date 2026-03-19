const fs = require('fs');
let lines = fs.readFileSync('src/views/StoryBlueprintView.tsx', 'utf8').split('\n');
for (let i = 0; i < 546; i++) {
  lines[i] = lines[i].replace(/\\`/g, '`').replace(/\\\$/g, '$').replace(/\\"/g, '"');
}
fs.writeFileSync('src/views/StoryBlueprintView.tsx', lines.join('\n'));
console.log('Unescaped lines using JS file.');
