import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT || 3080);
const demo = process.env.DEMO_MODE !== 'false';
const html = fileURLToPath(new URL('../frontend/index.html', import.meta.url));
const tonies = [
  { id: 'demo-dragon', name: 'Dragon Tonie', chapters: 3 },
  { id: 'demo-bear', name: 'Bedtime Bear', chapters: 2 },
  { id: 'demo-hero', name: 'Hero Tonie', chapters: 0 }
];
const reply = (res, code, data) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
};
async function body(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 10000) throw new Error('Request too large');
  }
  return JSON.parse(text);
}
export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(await readFile(html));
      }
      if (req.method === 'GET' && url.pathname === '/api/status')
        return reply(res, 200, { demo, phase: 'foundation', liveIntegration: false });
      if (req.method === 'GET' && url.pathname === '/api/tonies')
        return reply(res, 200, { tonies: demo ? tonies : [], integrationPending: !demo });
      if (req.method === 'POST' && url.pathname === '/api/story') {
        const input = await body(req);
        const minutes = Number(input.minutes);
        const idea = String(input.idea ?? '').trim().slice(0, 500);
        if (!idea || !Number.isInteger(minutes) || minutes < 5 || minutes > 10)
          return reply(res, 400, { error: 'Provide a story idea and duration between 5 and 10 minutes.' });
        if (!demo) return reply(res, 501, { error: 'Gemini story generation is not implemented yet.' });
        return reply(res, 200, { demo: true, title: 'The ' + idea.slice(0, 50), story: 'Once upon a time, an adventure began: ' + idea + '.\n\nThis is a demo placeholder, not a full-length story.' });
      }
      if (req.method === 'POST' && url.pathname === '/api/upload')
        return reply(res, 501, { error: 'Tonies uploads are disabled until the integration is tested.' });
      return reply(res, 404, { error: 'Not found' });
    } catch (error) {
      return reply(res, 400, { error: error.message });
    }
  });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL('file://' + process.argv[1]))) {
  createServer().listen(port, '127.0.0.1', () => console.log('StoryBot demo: http://localhost:' + port));
}
