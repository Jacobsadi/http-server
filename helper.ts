import { bufPop, DynBuf, TCPConn } from "./http-server-promise";
import { HTTPReq } from "./types";

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
    const uri = line.subarray(firstSpace + 1, secondSpace);
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
    const idx = buf.data.subarray(0, buf.data.length).indexOf('\r\n\r\n');
    if(idx < 0){
        if(buf.length >= kMaxHeaderLen){
            throw new HTTPError(413, 'header is too large')
        }
        return null 
    }
    // parse and remove header 
    const msg = parseHTTReq(buf.data.subarray(0, idx + 4))
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
function readerFromReq(conn: TCPConn, buf: DynBuf, req: HTTPReq) {
    let bodyLen = -1; 
    const contentLen = fieldGet(req.headers, 'Content-Length');

}