const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'scrapers');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));

files.forEach(file => {
  const filePath = path.join(dir, file);
  let content = fs.readFileSync(filePath, 'utf8');

  content = content.replace(/async\s+\(query\)\s+=>\s+\{/g, "async (query, sharedBrowser) => {");
  content = content.replace(/let browser;/g, "let browser = sharedBrowser;\n  let closeBrowser = false;");
  
  // replace browser = await puppeteer.launch(...)
  content = content.replace(/browser\s*=\s*await\s+puppeteer\.launch\([\s\S]*?\);/g, `if (!browser) {
      browser = await puppeteer.launch({
        headless: 'new',
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-blink-features=AutomationControlled']
      });
      closeBrowser = true;
    }`);

  content = content.replace(/await browser\.close\(\);/g, "if (closeBrowser) { await browser.close(); }");
  
  fs.writeFileSync(filePath, content);
  console.log(`Patched ${file}`);
});
