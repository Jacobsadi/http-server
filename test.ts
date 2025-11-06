// // server.js
// import net from 'net'
// const server = net.createServer((socket) => {
//   console.log('Client connected')

//   // send data twice, 1 second apart
//   setTimeout(() => socket.write('hello\n'), 500)
//   setTimeout(() => socket.write('world\n'), 3000)
// })

// server.listen(8080, () => console.log('Server running on port 8080'))
const b = Buffer.from('hello\nworld');
const part = b.subarray(0, 10).indexOf('o'); // 'hello'
const idx = part 
const newBuf = Buffer.from(b.subarray(0, idx+1))
// part[0] = 72; // modify first byte
console.log(idx); // 'Hello\nworld'  ← same memory changed!
console.log(b.toString()); // 'Hello\nworld'  ← same memory changed!
console.log(newBuf.toString()); // 'Hello\nworld'  ← same memory changed!
