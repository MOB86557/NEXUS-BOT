// server.js
const http = require('http');

const botStatus = {
  running: false,
  loginTime: null,
  lastEvent: null,
  restartCount: 0,
  lastError: null,
};

function startServer() {
  const PORT = process.env.PORT || 3000;
  
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/health' || req.url === '/') {
      const uptime = botStatus.loginTime
        ? Math.floor((Date.now() - botStatus.loginTime) / 1000)
        : 0;
      const status = botStatus.running ? 200 : 503;
      res.writeHead(status);
      res.end(JSON.stringify({
        status: botStatus.running ? 'online' : 'offline',
        uptime_seconds: uptime,
        last_event: botStatus.lastEvent,
        restart_count: botStatus.restartCount,
        last_error: botStatus.lastError,
      }, null, 2));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'not found' }));
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[  OK  ] خادم الصحة يعمل على البورت ${PORT} — /health`);
  });

  return server;
}

module.exports = { startServer, botStatus };