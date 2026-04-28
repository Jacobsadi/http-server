import { FileHandle } from 'fs/promises'
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
    body: BodyReader

}
export type BufferGenerator = AsyncGenerator<Buffer, void, void>
export type BodyReader = {
    // the Content-Length it returns -1 if unkown 
    length: number,
    // reads data it returns empty Buffer if empty 
    read: () => Promise<Buffer>  
    close?: () => Promise<void>
}

function open(path: string, offset: number): Promise<FileHandle>

export interface FileReadResult {
    readBytes: number;
    buffer: Buffer
}

export interface FileReadOptions {
    buffer?: Buffer;
    offset?: number | null;
    length?: number | null;
    position?: number | null
}
export interface Stats {
    isFile(): boolean;
    isDirectory(): boolean;
    size: number;
}

export interface FileHandle {
    read(options?: FileReadOptions): Promise<FileReadResult>;
    close(): Promise<void>;
    stat(): Promise<Stats>;
}

