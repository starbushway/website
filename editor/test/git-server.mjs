// A tiny local stand-in for GitHub: serves bare repositories over smart HTTP with
// `git http-backend`, pushes included. Used by the tests and for trying the app safely.
//   node test/git-server.mjs <folder-with-bare-repos> [port]
import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

export function startGitServer(root, port = 0) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const cgi = spawn('git', ['http-backend'], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: '1',
        REMOTE_USER: 'test', // enables receive-pack (push)
        PATH_INFO: decodeURIComponent(url.pathname),
        REQUEST_METHOD: req.method,
        QUERY_STRING: url.search.slice(1),
        CONTENT_TYPE: req.headers['content-type'] ?? '',
        HTTP_CONTENT_ENCODING: req.headers['content-encoding'] ?? '',
      },
    });
    req.pipe(cgi.stdin);
    let head = Buffer.alloc(0);
    let headerDone = false;
    cgi.stdout.on('data', (chunk) => {
      if (headerDone) return void res.write(chunk);
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n\r\n');
      if (end < 0) return;
      headerDone = true;
      let status = 200;
      for (const line of head.subarray(0, end).toString().split('\r\n')) {
        const i = line.indexOf(':');
        const key = line.slice(0, i).trim();
        const value = line.slice(i + 1).trim();
        if (key.toLowerCase() === 'status') status = parseInt(value, 10);
        else res.setHeader(key, value);
      }
      res.writeHead(status);
      res.write(head.subarray(end + 4));
    });
    cgi.stdout.on('end', () => res.end());
    cgi.stderr.on('data', (d) => process.stderr.write(`[git-server] ${d}`));
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await startGitServer(process.argv[2], Number(process.argv[3] ?? 8174));
  console.log(`git server on http://127.0.0.1:${server.address().port}/`);
}
