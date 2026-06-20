/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const baseUrl = 'https://arcova.bio';
const routes = ['/', '/contact-us', '/docs', '/docs/credits', '/privacy', '/terms'];
const today = new Date().toISOString();

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes
  .map(
    (route) => `  <url>
    <loc>${baseUrl}${route}</loc>
    <lastmod>${today}</lastmod>
  </url>`,
  )
  .join('\n')}
</urlset>
`;

fs.writeFileSync(path.join(__dirname, 'public', 'sitemap.xml'), sitemap);
console.log(`Generated sitemap with ${routes.length} public routes.`);
