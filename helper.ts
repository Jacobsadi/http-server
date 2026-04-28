import { version } from "os";
import { bufPop, bufPush, DynBuf, TCPConn } from "./http-server-promise";
import { BodyReader, BufferGenerator, HTTPReq, HTTPRes } from "./types";
import { soRead, soWrite } from "./http";
import * as fs from 'fs/promises'
import * as path from 'path'

export class HTTPError extends Error {
    code: number;
    
    constructor(codeOrMessage: number | string, message?: string) {
        if (typeof codeOrMessage === 'number') {
            super(message || '');
            this.code = codeOrMessage;
        } else {
            super(codeOrMessage);
            this.code = 500;
        }
        this.name = 'HTTPError';
    }
}

export function splitLines(data: Buffer): Buffer[] {
    const lines: Buffer[] = [];
    let start = 0;
    const crlf = Buffer.from('\r\n');
    
    while (start < data.length) {
        const end = data.indexOf(crlf, start);
        if (end < 0) {
            // Last line (might not have CRLF)
            lines.push(data.subarray(start));
            break;
        }
        // Include the line without CRLF
        lines.push(data.subarray(start, end));
        start = end + 2; // Skip CRLF
    }
    
    return lines;
}

export function parseRequestLine(line: Buffer): [string, Buffer, string] {
    const space = 0x20; // SP character
    let firstSpace = -1;
    let secondSpace = -1;
    
    // Find the two spaces
    for (let i = 0; i < line.length; i++) {
        if (line[i] === space) {
            if (firstSpace < 0) {
                firstSpace = i;
            } else if (secondSpace < 0) {
                secondSpace = i;
                break;
            }
        }
    }
    
    if (firstSpace < 0 || secondSpace < 0) {
        throw new Error('Invalid request line format');
    }
    
    const method = line.subarray(0, firstSpace).toString('ascii');
    const uri = Buffer.from(line.subarray(firstSpace + 1, secondSpace));
    const version = line.subarray(secondSpace + 1).toString('ascii');
    
    return [method, uri, version];
}

export function validateHeader(h: Buffer): boolean {
    const colon = 0x3A; // ':'
    const space = 0x20; // SP
    const tab = 0x09; // HTAB
    
    // Find the colon
    let colonIndex = -1;
    for (let i = 0; i < h.length; i++) {
        if (h[i] === colon) {
            colonIndex = i;
            break;
        }
    }
    
    if (colonIndex <= 0 || colonIndex >= h.length - 1) {
        return false; // No colon or colon at invalid position
    }
    
    // Validate field-name (before colon)
    const fieldName = h.subarray(0, colonIndex);
    if (fieldName.length === 0) {
        return false;
    }
    
    for (let i = 0; i < fieldName.length; i++) {
        const byte = fieldName[i];
        if (!(
            (byte >= 0x30 && byte <= 0x39) || // DIGIT: 0-9
            (byte >= 0x41 && byte <= 0x5A) || // ALPHA: A-Z
            (byte >= 0x61 && byte <= 0x7A) || // ALPHA: a-z
            byte === 0x21 || // !
            byte === 0x23 || // #
            byte === 0x24 || // $
            byte === 0x25 || // %
            byte === 0x26 || // &
            byte === 0x27 || // '
            byte === 0x2A || // *
            byte === 0x2B || // +
            byte === 0x2D || // -
            byte === 0x2E || // .
            byte === 0x5E || // ^
            byte === 0x5F || // _
            byte === 0x60 || // `
            byte === 0x7C || // |
            byte === 0x7E    // ~
        )) {
            return false;
        }
    }
    
    // Validate field-value (after colon)
    // OWS (optional whitespace) can be SP or HTAB
    let valueStart = colonIndex + 1;
    
    // Skip OWS at start
    while (valueStart < h.length && (h[valueStart] === space || h[valueStart] === tab)) {
        valueStart++;
    }
    
    if (valueStart >= h.length) {
        return false; // No field-value
    }
    return true;
}

const kMaxHeaderLen = 1024 * 8;
export function cutMessage(buf: DynBuf): null | HTTPReq {
    // the end of the header is \r\n\r\n
	const idx = buf.data.subarray(0, buf.length).indexOf('\r\n\r\n');
    if(idx < 0){
        if(buf.length >= kMaxHeaderLen){
            throw new HTTPError(413, 'header is too large')
        }
        return null 
    }
    // parse and remove header 
    const msgBuf = buf.data.subarray(0, idx + 4);
    const msg = parseHTTReq(msgBuf)
    bufPop(buf, idx+4)
    return msg
}

function parseHTTReq(data: Buffer): HTTPReq {
    // split the header into lines 
    const lines: Buffer[] = splitLines(data);
    // get the first line URI METHOD VERSION 
    const [method, uri, version] = parseRequestLine(lines[0])

    // header fields in format NAME : VALUE
    const headers: Buffer[] = []
    for (let i=1; i < lines.length - 1; i++){
        const h = Buffer.from(lines[i]) // copy 
        if(!validateHeader(h)){
            throw new HTTPError(400, 'bad field');
        }
        headers.push(h)
    }
    // the header ends by an empty line
    console.assert(lines[lines.length - 1].length === 0);
    return {
		method: method, uri: uri, version: version, headers: headers,
    };
}

function fieldGet(headers: Buffer[], key: string): null | Buffer {
    const keyLower = key.toLocaleLowerCase();
    for(let i = 0; i < headers.length; i++){
        // find :
        const colonIndex = headers[i].indexOf(':');
        if(colonIndex <= 0){
            continue;
        }
        // make the value lower case
        const nameLower = headers[i].subarray(0, colonIndex).toString('ascii').toLocaleLowerCase();
        if(nameLower !== keyLower){
            continue
        }
        let valueStart = colonIndex + 1
        while(valueStart < headers[i].length) {
            const b = headers[i][valueStart]
            if(b === 0x20 || b === 0x09){
                valueStart++ 
            }else {
                break
            }
        }
        return headers[i].subarray(valueStart);

    }
    return null
}

// BodyReader from an HTTP request
export function readerFromReq(conn: TCPConn, buf: DynBuf, req: HTTPReq) {
    let bodyLen = -1; 
    const contentLen = fieldGet(req.headers, 'Content-Length');
    if(contentLen){
        bodyLen = parseInt(contentLen.toString('latin1'))
        if(isNaN(bodyLen)){
            throw new HTTPError(400, 'bad Content-Length')
        }

    }
    const bodyAllowed = !(req.method === 'GET' || req.method === 'HEAD');
    const chunked = fieldGet(req.headers, 'Transfer-Encoding')?.equals(Buffer.from('chunked')) || false;
    if(!bodyAllowed && (bodyLen > 0 || chunked)){
        throw new HTTPError(400, 'body not allowed ')
    }
    if(!bodyAllowed){
        bodyLen = 0;
    }
    if(bodyLen > 0){
        return readerFromConnLength(conn, buf, bodyLen);
    } else if(chunked){
        throw new HTTPError(500, 'DO not support chunked for now ')
    } else {
        // No body (GET, HEAD, or requests without Content-Length)
        return readFromMemory(Buffer.from('Hi'));
    }
}

function readerFromConnLength(conn: TCPConn, buf: DynBuf, remain: number): BodyReader {
    return {
        length: remain,
        read: async (): Promise<Buffer> => {
            if(remain === 0){
                return Buffer.from('');
            }
            if(buf.length === 0){
                const data = await soRead(conn);
                bufPush(buf, data);
                if(data.length === 0){
                    throw new HTTPError(400, 'Unexpected EOF from HTTP body')
                }
            }
            const consume = Math.min(buf.length, remain);
            remain -= consume;
            const data = Buffer.from(buf.data.subarray(0, consume));
            bufPop(buf, consume)
            return data;
        }

    }
}

export async function handleReq(req: HTTPReq, body: BodyReader): Promise<HTTPRes> {
    const uri = req.uri.toString('latin1');
    
    // Handle /files requests
    if (uri.startsWith('/files')) {
        return await serveStaticFile(uri);
    }
    
    let resp: BodyReader;
    switch(uri){
        case '/echo':
            resp = body;
            break;
        case '/sleep':
            resp = readerFromGenerator(countSheep())
            break;
        default:
            resp = readFromMemory(Buffer.from('hello zebi, how are you?'));
            break;
    }
    return {
        code: 200,
        headers: [Buffer.from('Server: My First HTTP server')],
        body: resp

    }
}

async function serveStaticFile(uri: string): Promise<HTTPRes> {
    // Remove /files prefix and get the file path
    const filePath = uri.substring('/files'.length) || '/';
    // Remove leading slash and resolve relative to current directory
    const relativePath = filePath.startsWith('/') ? filePath.substring(1) : filePath;
    const fullPath = path.join(process.cwd(), relativePath);
    
    // Normalize to prevent directory traversal attacks
    const normalizedPath = path.normalize(fullPath);
    const cwd = process.cwd();
    if (!normalizedPath.startsWith(cwd)) {
        throw new HTTPError(403, 'Forbidden: Invalid path');
    }
    
    let fp: fs.FileHandle | null = null;
    try {
        fp = await fs.open(normalizedPath, 'r');
        const stat = await fp.stat();
        if (!stat.isFile()) {
            throw new HTTPError(404, 'Not Found: Not a file');
        }
        const size = stat.size;
        const reader: BodyReader = readerFromStaticFile(fp, size);
        fp = null; // Don't close here, reader will handle it
        
        return {
            code: 200,
            headers: [Buffer.from('Server: My First HTTP server')],
            body: reader
        };
    } catch (exc) {
        if (exc instanceof HTTPError) {
            throw exc;
        }
        throw new HTTPError(404, 'Not Found');
    } finally {
        if (fp) {
            await fp.close();
        }
    }
}
async function *countSheep(): BufferGenerator {
    for (let i = 0; i < 100; i++) {
    // sleep 1s, then output the counter
    await new Promise((resolve) => setTimeout(resolve, 1000));
    yield Buffer.from(`${i}\n`);
    }
}
    
export function readerFromGenerator(gen: BufferGenerator): BodyReader {
    return {
        length: -1,
        read: async (): Promise<Buffer> => {
            const r = await gen.next();
            if(r.done){
                return Buffer.from('')
            } else {
                console.assert(r.value.length > 0)
                return r.value;
            }


        }
        
    }
}

export function readFromMemory(data: Buffer): BodyReader {
    let done = false;
    return {
        length: data.length,
        read: async (): Promise<Buffer> => {
            if(done){
                return Buffer.from('')
            } else {
                done = true 
                return data;
            }

        }
    }

}

export const readerFromMemory = readFromMemory;

function encodeHTTPResp(resp: HTTPRes): Buffer {
    const statusText: { [key: number]: string } = {
        200: 'OK',
        400: 'Bad Request',
        413: 'Payload Too Large',
        500: 'Internal Server Error',
    };
    const text = statusText[resp.code] || 'OK';
    const parts: Buffer[] = [];
    parts.push(Buffer.from(`HTTP/1.1 ${resp.code} ${text}\r\n`));
    for (const header of resp.headers) {
        parts.push(header);
        parts.push(Buffer.from('\r\n'));
    }
    parts.push(Buffer.from('\r\n'));
    return Buffer.concat(parts);
}

export async function writeHTTPResp (conn: TCPConn, resp: HTTPRes): Promise<void> {
    console.assert(!fieldGet(resp.headers, 'Content-Length'));
    if(resp.body.length < 0){
        resp.headers.push(Buffer.from(`Transfer-Encoding: chunked`))
    } else {
        resp.headers.push(Buffer.from(`Content-Length: ${resp.body.length}`))
    }
    const headerBuf = encodeHTTPResp(resp);
    await soWrite(conn, headerBuf);
    if(resp.body.length < 0){
        await writeBodyChunked(conn, resp)
    } else {
        await writeBodyWithContentLength(conn, resp)
    }
}

async function writeBodyWithContentLength(conn: TCPConn, resp: HTTPRes): Promise<void>{
    while(true){
        const data = await resp.body.read()
        if(data.length === 0) break;
        await soWrite(conn, data)
    }
}

async function writeBodyChunked(conn: TCPConn, resp: HTTPRes): Promise<void> {
    const crlf = Buffer.from('\r\n');
    while(true){
        const data = await resp.body.read() 
        if(data.length === 0){
            await soWrite(conn, Buffer.from('0\r\n\r\n'));
            break;
        }
        const chunk = Buffer.concat([
            Buffer.from(data.length.toString(16)), 
            crlf, 
            data, 
            crlf
        ]);
        await soWrite(conn, chunk);
        
    }
}

export function readerFromStaticFile(fp: fs.FileHandle, size: number): BodyReader {
    let position = 0;
    const chunkSize = 64 * 1024; // 64KB chunks
    return {
        length: size,
        read: async (): Promise<Buffer> => {
            if (position >= size) {
                return Buffer.from('');
            }
            const remaining = size - position;
            const readSize = Math.min(chunkSize, remaining);
            const buffer = Buffer.alloc(readSize);
            const r = await fp.read({ buffer, position, length: readSize });
            position += r.bytesRead;
            if (r.bytesRead === 0 && position < size) {
                throw new HTTPError(500, 'File Changed');
            }
            return buffer.subarray(0, r.bytesRead);
        },
        close: async () => fp.close(),
    }
}

