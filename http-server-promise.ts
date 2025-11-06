import { rejects } from 'assert';
import { Socket } from 'dgram';
import * as net from 'net'
import { resolve } from 'path';
export type TCPConn =  {
    socket: net.Socket,
    end: boolean,
    err: Error | null,
    

    reader: null | {
        resolve: (value: Buffer) => void,
        reject: (value: Error) => void,
    }
}

export type DynBuf = {
    data: Buffer,
    length: number
}
export function cutMessage(buf: DynBuf): null | Buffer {
    const idx = buf.data.subarray(0, buf.length).indexOf('\\n')
    console.log('idx', idx);
    if(idx < 0 ) {
        return null
    }
    const msg = Buffer.from(buf.data.subarray(0, idx+2))
    console.log('msg', msg.toString());
    bufPop(buf, idx+2)
    return msg;
    
}
export function bufPop(buf: DynBuf, len: number): void {
    buf.data.copyWithin(0, len, buf.length);
    buf.length -= len;
}
export function bufPush(buf: DynBuf, data: Buffer): void {
    const newLen = buf.length + data.length;
    if(buf.data.length < newLen){
        let cap = Math.max(buf.data.length, 32)
        while(cap < newLen){
            cap *= 2
        }
        const grown = Buffer.alloc(cap)
        buf.data.copy(grown, 0, 0);
        buf.data = grown;
    }
    data.copy(buf.data, buf.length, 0)
    buf.length = newLen
}

function soInit(socket: net.Socket): TCPConn {
    const conn: TCPConn = {
        socket: socket, reader: null, end: false, err: null
    }
    socket.on('data', (data: Buffer) => {
        console.assert(conn.reader);
        socket.pause();
        console.log('data received', data.toString());
        conn.reader!.resolve(data);
        conn.reader = null;
    });
    socket.on('end', () => {
        conn.end = true;
        if(conn.reader){
            conn.reader.resolve(Buffer.from(''))
            conn.reader = null;
        }
    })
    socket.on('error', (err: Error) => {
        conn.err = err
        if(conn.reader){
            conn.reader?.reject(err)
            conn.reader = null;
            
        }
    })
    return conn;

}

function soRead(conn: TCPConn): Promise<Buffer> {
    console.assert(!conn.reader);
    return new Promise((resolve, reject) => {
        if(conn.err){
            reject(conn.err)
            return
        }
        if(conn.end){
            resolve(Buffer.from(''))                                                                                              
            return;
        }
        conn.reader = {resolve: resolve, reject: reject}
        conn.socket.resume();
    })
}

function soWrite(conn: TCPConn, data: Buffer): Promise<void> {
    console.assert(data.length > 0);
    return new Promise((resolve,reject ) => {
        if(conn.err){
            reject(conn.err)
            return
        }
        conn.socket.write(data, (err?: Error | null) => {
            if(err){
                reject(err)
            } else {
                resolve();
            }
        });
    })
} 


async function serverClient(socket: net.Socket): Promise<void> {
    const conn: TCPConn = soInit(socket);
    const buf: DynBuf = {data: Buffer.alloc(0), length: 0};
    while(true) {
        
        const msg: null | Buffer = cutMessage(buf);
        if(!msg){
            const data = await soRead(conn);
            bufPush(buf, data)

            if(data.length === 0 ){
                console.log('end connection')
                break;
            }
            continue
        }
        if(msg.equals(Buffer.from('quit\n'))){
            await soWrite(conn, Buffer.from('Bye.\n'))
            socket.destroy;
            return
        } else {
            const reply = Buffer.concat([Buffer.from('Echo: '), msg])
            await soWrite(conn, reply)
        }
    }
}

async function newConn(socket: net.Socket): Promise<void> {
 console.log('New Connection', socket.remoteAddress, socket.remotePort);
 try {
    await serverClient(socket)
 } catch (e) {
    console.error(e)
 } finally {
    socket.destroy()
 }
}


const server = net.createServer({pauseOnConnect: true});
server.on('error', (err: Error) => { throw err; });
server.on('connection', newConn);
server.listen({host: '127.0.0.1', port: 1234});