import * as net from 'net';

/** Step 1: TCPConn type-like object **/
function soInit(socket) {
  const conn = { socket, reader: null };

  socket.on('data', (data) => {
    console.log('[socket.on(data)] got:', data.toString());
    if (conn.reader) {
      console.log('[socket.on(data)] resolving promise...');
      conn.reader.resolve(data);
      conn.reader = null;
    }
  });

  socket.on('end', () => console.log('[socket] end'));
  socket.on('error', (err) => console.error('[socket error]', err));

  return conn;
}

/** Step 2: read function returns a Promise and stores resolve/reject */
function soRead(conn) {
  console.log('[soRead] creating promise...');
  return new Promise((resolve, reject) => {
    conn.reader = { resolve, reject };
    console.log('[soRead] stored resolve/reject inside conn.reader');
    conn.socket.resume();
  });
}

/** Step 3: write wrapper **/
function soWrite(conn, data) {
  console.log('[soWrite] writing:', data.toString());
  return new Promise((resolve, reject) => {
    conn.socket.write(data, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/** Step 4: server side logic **/
async function handleClient(socket) {
  const conn = soInit(socket);
  console.log('[handleClient] waiting for data...');
  const data = await soRead(conn); // <-- paused here until conn.reader.resolve is called
  console.log('[handleClient] got from client:', data.toString());
  await soWrite(conn, Buffer.from('Echo: ' + data.toString()));
  socket.end();
}

/** Step 5: server setup **/
const server = net.createServer({ pauseOnConnect: true });
server.on('connection', (socket) => {
  console.log('\n=== New connection ===');
  handleClient(socket);
});
server.listen(1234, '127.0.0.1', () => {
  console.log('Server listening on 127.0.0.1:1234');
});

/** Step 6: simple client **/
// const client = net.createConnection({ port: 1234 }, () => {
//   console.log('[client] connected to server');
//   client.write('Hello Server\n');
// });

// client.on('data', (data) => {
//   console.log('[client] got:', data.toString());
//   client.end();
// });
