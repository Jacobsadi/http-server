// server.js
import net from 'net'
const server = net.createServer((socket) => {
  console.log('Client connected')

  // send data twice, 1 second apart
  setTimeout(() => socket.write('hello\n'), 500)
  setTimeout(() => socket.write('world\n'), 3000)
})

server.listen(8080, () => console.log('Server running on port 8080'))
