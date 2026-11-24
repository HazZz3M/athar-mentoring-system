/* Builds the GitHub Pages site from the same UI the Apps Script uses: src/Index.html + the API address.
   Usage: node tools/build_pages.js [outDir]   (default: _site) */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(root, '_site'));
const { apiUrl } = JSON.parse(fs.readFileSync(path.join(root, 'pages.config.json'), 'utf8'));
if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(apiUrl)) throw new Error('pages.config.json: apiUrl must be the Apps Script /exec URL');
let html = fs.readFileSync(path.join(root, 'src', 'Index.html'), 'utf8');
const cfg = '<script>window.ATHAR_API = ' + JSON.stringify(apiUrl) + ';</script>\n';
const i = html.indexOf('<script>');
if (i < 0) throw new Error('src/Index.html: no <script> found');
html = html.slice(0, i) + cfg + html.slice(i);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log('built', path.join(out, 'index.html'), html.length, 'bytes');
