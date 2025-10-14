/* eslint-disable no-console */
/**
 * Dynamic sitemap generator for Next.js App Router projects.
 * Scans the `app/` directory for static page files and writes an XML sitemap
 * to `public/sitemap.xml`. Dynamic routes (e.g. [slug]) and API routes are ignored.
 *
 * Usage: `npm run gen-sitemap`
 */

const fs = require('fs');
const path = require('path');

// Primary domain and additional subdomains to include in sitemap
const baseUrls = ['https://arcova.app'];
const appDir = path.join(__dirname, 'app');
const publicDir = path.join(__dirname, 'public');

// Ensure public/ exists
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir);
}

// Directories or files to ignore when crawling for pages
const IGNORED_DIRS = new Set(['api']); // add more if needed
const PAGE_FILENAMES = new Set(['page.tsx', 'page.jsx', 'page.js']);

/**
 * Recursively gather all static routes in the app directory.
 * @param {string} dirPath - Current relative path being scanned.
 * @param {Array} routes - Accumulator for discovered routes.
 * @returns {Array<{loc:string,lastmod:string}>}
 */
function getAllStaticRoutes(dirPath = '', routes = []) {
  const fullPath = path.join(appDir, dirPath);
  const entries = fs.readdirSync(fullPath, { withFileTypes: true });

  for (const entry of entries) {
    // Skip ignored directories and special route groups (e.g., (marketing))
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('(')) continue;
      getAllStaticRoutes(path.join(dirPath, entry.name), routes);
      continue;
    }

    // If it's a page.* file, create a route
    if (PAGE_FILENAMES.has(entry.name)) {
      // Build the route path from the directory path
      let routePath = dirPath === '' ? '/' : `/${dirPath}`;

      // Skip dynamic routes like /[slug]
      if (routePath.includes('[')) continue;

      const filePath = path.join(appDir, dirPath, entry.name);
      const lastmod = fs.statSync(filePath).mtime.toISOString();

      // Add an entry for each configured base URL
      for (const domain of baseUrls) {
        routes.push({ loc: `${domain}${routePath}`, lastmod });
      }
    }
  }

  return routes;
}

const routes = getAllStaticRoutes();

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  routes
    .map(({ loc, lastmod }) =>
      `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`
    )
    .join('\n') +
  '\n</urlset>';

const outputPath = path.join(publicDir, 'sitemap.xml');
fs.writeFileSync(outputPath, sitemap);
console.log(`✅ Dynamic sitemap generated with ${routes.length} routes (including subdomains) → ${outputPath}`);