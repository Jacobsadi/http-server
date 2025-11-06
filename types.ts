import * as net from 'net'

export type TCPConn = {
    socket: net.Socket,
    end: boolean,
    err: Error | null,

    reader: null | {
        resolve: (value: Buffer) => void,
        reject: (value: Error) => void,
    }
}

export type HTTPReq = {
    method: string,
    uri: Buffer,
    version: string,
    headers: Buffer[]
}

export type HTTPRes = {
    code: number,
    headers: Buffer[]
    Body: BodyReader
}

export type BodyReader = {
    // the Content-Length it returns -1 if unkown 
    length: number,
    // reads data it returns empty Buffer if empty 
    read: () => Promise<Buffer>
}

