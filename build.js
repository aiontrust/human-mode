// Inlines src/engine.js into src/ui.html and writes the single-file page to dist/human-mode.html.
const fs = require('fs');
const path = require('path');

const engine = fs.readFileSync(path.join(__dirname, 'src', 'engine.js'), 'utf8');
const ui = fs.readFileSync(path.join(__dirname, 'src', 'ui.html'), 'utf8');
if (!ui.includes('/*__ENGINE__*/')) throw new Error('src/ui.html is missing the /*__ENGINE__*/ marker');

fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'human-mode.html'), ui.replace('/*__ENGINE__*/', () => engine));
console.log('wrote dist/human-mode.html');
