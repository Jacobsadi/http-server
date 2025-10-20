import { rejects } from 'assert';
import { Socket } from 'dgram';
import * as net from 'net'
import { resolve } from 'path';
type TCPConn =  {
    socket: net.Socket,
    end: boolean,
    err: Error | null,
    

    reader: null | {
        resolve: (value: Buffer) => void,
        reject: (value: Error) => void,
    }
}

function soInit(socket: net.Socket): TCPConn {
    const conn: TCPConn = {
        socket: socket, reader: null, end: false, err: null
    }
    socket.on('data', (data: Buffer) => {
        console.assert(conn.reader);
        socket.pause();

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
    while(true) {
        const data = await soRead(conn);
        if(data.length === 0 ){
            console.log('end connection')
            break;
        }
        console.log('data: ', data)
        await soWrite(conn, data)
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