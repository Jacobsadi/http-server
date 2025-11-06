import * as net from 'net'
import { bufPop, bufPush, DynBuf } from './http-server-promise'
import { validateHeaderName } from 'http'
import { TCPConn, HTTPReq, HTTPRes, BodyReader } from './types'
import { cutMessage } from './helper'

function soInit(socket: net.Socket): TCPConn {
    const conn: TCPConn = { socket: socket, err: null, end: false, reader: null }
    socket.on('data', (data: Buffer) => {
        console.assert(conn.reader)
        socket.pause()
        conn.reader?.resolve(data)
        conn.reader = null
    })
    socket.on('end', () => {
        conn.end = true
        if (conn.reader) {
            conn.reader?.resolve(Buffer.from(''))
            conn.reader = null
        }
    })
    socket.on('error', (err: Error) => {
        conn.err = err
        if (conn.reader) {
            conn.reader?.reject(err)
            conn.reader = null;
        }
    })
    return conn;
}
async function soRead(conn: TCPConn): Promise<Buffer> {
    console.assert(!conn.reader)
    return new Promise((res, rej) => {
        if (conn.end) {
            res(Buffer.from(''))
            return
        }
        if (conn.err) {
            rej(conn.err)
        }
        conn.reader = { resolve: res, reject: rej }
        conn.socket.resume()
    })
}

async function soWrite(conn: TCPConn, data: Buffer): Promise<void> {
    console.assert(data.length > 0)
    return new Promise((res, rej) => {
        if (conn.err) {
            rej(conn.err)
            return
        }
        conn.socket.write(data, (err?: Error | null) => {
            if (err) {
                rej(err)
            } else {
                res()
            }

        })
    })
}


async function serverClient(conn: TCPConn): Promise<void> {
    const buf: DynBuf = { data: Buffer.alloc(0), length: 0 };
    while (true) {

        const msg: null | HTTPReq = cutMessage(buf);
        if (!msg) {
            const data = await soRead(conn);
            bufPush(buf, data)
            // EOF? 
            if (data.length === 0 && buf.length === 0) {
                console.log('end connection')
                break;
            }
            if (data.length === 0) {
                throw new HTTPError(400, 'Unexpected EOF.');
            }

            continue
        }
        const reqBody: BodyReader = readerFromReq(conn, buf, msg);
        const res: HTTPRes = await handleReq(msg, reqBody);
        await writeHTTPResp(conn, res);

        if (msg.version === '1.0') {
            return;
        }
        while ((await reqBody.read()).length > 0) { /* empty */ }
    }
}


async function newConn(socket: net.Socket): Promise<void> {
    const conn: TCPConn = soInit(socket);
    try {
        await serverClient(conn);
    } catch (exc) {
        console.error('exception:', exc);
        if (exc instanceof HTTPError) {
            // intended to send an error response
            const resp: HTTPRes = {
                code: exc.code,
                headers: [],
                body: readerFromMemory(Buffer.from(exc.message + '\n')),
            };
            try {
                await writeHTTPResp(conn, resp);
            } catch (exc) { /* ignore */ }
        }
    } finally {
        socket.destroy();
    }
}


const server = net.createServer({ pauseOnConnect: true });
server.on('error', (err: Error) => { throw err; });
server.on('connection', newConn);
server.listen({ host: '127.0.0.1', port: 1234 });

