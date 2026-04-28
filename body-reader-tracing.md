# Detailed Explanation and Tracing: `readerFromReq` and `readerFromConnLength`

## Overview

These functions work together to create a `BodyReader` that reads HTTP request body data from a TCP connection. The body can be:
- **Content-Length based**: Fixed size body (most common)
- **Chunked transfer**: Not yet supported
- **No body**: GET/HEAD requests

---

## Function 1: `readerFromReq`

### Purpose
Creates a `BodyReader` from an HTTP request by:
1. Determining if the request should have a body
2. Extracting body length from `Content-Length` header
3. Validating that GET/HEAD requests don't have bodies
4. Creating the appropriate reader

### Code Structure
```typescript
export function readerFromReq(conn: TCPConn, buf: DynBuf, req: HTTPReq)
```

**Parameters:**
- `conn`: TCP connection object
- `buf`: Dynamic buffer that may already contain some data (leftover from header parsing)
- `req`: Parsed HTTP request object

**Returns:** `BodyReader` object

---

## Tracing Example 1: POST Request with Content-Length

### Input
```typescript
req = {
    method: "POST",
    uri: Buffer("/api/users"),
    version: "HTTP/1.1",
    headers: [
        Buffer("Content-Length: 25"),
        Buffer("Content-Type: application/json")
    ]
}
buf = { data: Buffer.alloc(100), length: 0 }  // Empty buffer
conn = <TCPConn object>
```

### Step-by-Step Execution

#### Step 1: Initialize bodyLen
```typescript
let bodyLen = -1;  // -1 means "unknown/not set"
```

#### Step 2: Get Content-Length header
```typescript
const contentLen = fieldGet(req.headers, 'Content-Length');
```

**Tracing `fieldGet`:**
- Searches headers for "Content-Length"
- Finds at index 0: `Buffer("Content-Length: 25")`
- Extracts value: `Buffer("25")`
- Returns: `Buffer("25")`

**Result:** `contentLen = Buffer("25")` (truthy)

#### Step 3: Parse Content-Length value
```typescript
if(contentLen){
    bodyLen = parseDec(contentLen.toString('latin1'))
    // Assuming parseDec is parseInt:
    bodyLen = parseInt("25", 10)  // = 25
    if(isNaN(bodyLen)){  // false, 25 is valid
        // Skip
    }
}
```

**Result:** `bodyLen = 25`

#### Step 4: Check if body is allowed
```typescript
const bodyAllowed = !(req.method === 'GET' || req.method === 'HEAD');
// bodyAllowed = !(false || false) = !false = true
```

**Result:** `bodyAllowed = true` (POST allows body)

#### Step 5: Check for chunked encoding
```typescript
const chunked = fieldGet(req.headers, 'Transfer-Encoding')?.equals(Buffer.from('chunked')) || false;
```

**Tracing:**
- `fieldGet(req.headers, 'Transfer-Encoding')` → searches headers
- No "Transfer-Encoding" header found → returns `null`
- `null?.equals(...)` → short-circuits to `undefined`
- `undefined || false` → `false`

**Result:** `chunked = false`

#### Step 6: Validate body not present for GET/HEAD
```typescript
if(!bodyAllowed && (bodyLen > 0 || chunked)){
    // bodyAllowed = true, so condition is false
    // Skip this check
}
```

**Result:** Check passes (body is allowed)

#### Step 7: Handle GET/HEAD case
```typescript
if(!bodyAllowed){
    // bodyAllowed = true, so skip
}
```

**Result:** `bodyLen` remains `25`

#### Step 8: Create appropriate reader
```typescript
if(bodyLen > 0){  // 25 > 0 → true
    return readerFromConnLength(conn, buf, bodyLen);
    // Calls readerFromConnLength(conn, buf, 25)
}
```

**Result:** Returns `BodyReader` from `readerFromConnLength`

---

## Tracing Example 2: GET Request (No Body)

### Input
```typescript
req = {
    method: "GET",
    uri: Buffer("/api/users"),
    version: "HTTP/1.1",
    headers: [Buffer("Host: example.com")]
}
buf = { data: Buffer.alloc(100), length: 0 }
conn = <TCPConn object>
```

### Step-by-Step Execution

#### Step 1-2: Check Content-Length
```typescript
let bodyLen = -1;
const contentLen = fieldGet(req.headers, 'Content-Length');
// No Content-Length header → returns null
```

**Result:** `contentLen = null` (falsy)

#### Step 3: Skip Content-Length parsing
```typescript
if(contentLen){  // null is falsy, skip
}
```

**Result:** `bodyLen` remains `-1`

#### Step 4: Check if body is allowed
```typescript
const bodyAllowed = !(req.method === 'GET' || req.method === 'HEAD');
// bodyAllowed = !(true || false) = !true = false
```

**Result:** `bodyAllowed = false`

#### Step 5: Check chunked
```typescript
const chunked = fieldGet(req.headers, 'Transfer-Encoding')?.equals(...) || false;
// No Transfer-Encoding header → false
```

**Result:** `chunked = false`

#### Step 6: Validate no body for GET
```typescript
if(!bodyAllowed && (bodyLen > 0 || chunked)){
    // !false && (-1 > 0 || false)
    // true && (false || false)
    // true && false = false
    // Skip
}
```

**Result:** Check passes (no body present)

#### Step 7: Set bodyLen to 0 for GET/HEAD
```typescript
if(!bodyAllowed){  // !false = true
    bodyLen = 0;  // Set to 0
}
```

**Result:** `bodyLen = 0`

#### Step 8: Create reader
```typescript
if(bodyLen > 0){  // 0 > 0 → false, skip
} else if(chunked){  // false, skip
} else {
    throw new HTTPError(500, 'do not support old approach')
}
```

**Result:** Throws error (this seems like a bug - GET requests should return empty reader)

---

## Tracing Example 3: POST with Invalid Content-Length

### Input
```typescript
req = {
    method: "POST",
    headers: [Buffer("Content-Length: abc")]
}
```

### Execution
```typescript
const contentLen = fieldGet(req.headers, 'Content-Length');
// Returns Buffer("abc")

bodyLen = parseInt("abc", 10);  // = NaN

if(isNaN(bodyLen)){  // true
    throw new HTTPError(400, 'bad Content-Length')
}
```

**Result:** Throws `HTTPError(400, 'bad Content-Length')`

---

## Function 2: `readerFromConnLength`

### Purpose
Creates a `BodyReader` that reads exactly `remain` bytes from the connection, using a buffer to handle partial reads efficiently.

### Code Structure
```typescript
function readerFromConnLength(conn: TCPConn, buf: DynBuf, remain: number): BodyReader
```

**Key Features:**
- Uses closure to track remaining bytes (`remain`)
- Buffers data from connection when needed
- Returns empty buffer when all bytes read
- Handles partial reads efficiently

---

## Tracing Example: Reading 25-byte Body in Multiple Reads

### Initial State
```typescript
conn = <TCPConn>
buf = { data: Buffer.alloc(100), length: 0 }  // Empty
remain = 25  // Need to read 25 bytes
```

### Call to readerFromConnLength
```typescript
return {
    length: 25,
    read: async (): Promise<Buffer> => {
        // Closure captures: conn, buf, remain (initially 25)
    }
}
```

**Result:** Returns `BodyReader` with `length: 25` and `read` function

---

## First Call: `await bodyReader.read()`

### State Before Call
- `remain = 25`
- `buf.length = 0` (empty)

### Execution Trace

#### Step 1: Check if done
```typescript
if(remain === 0){  // 25 === 0 → false
    // Skip
}
```

#### Step 2: Check if buffer is empty
```typescript
if(buf.length === 0){  // true, buffer is empty
    const data = await soRead(conn);
    // Waits for data from socket...
    // Assume we receive: Buffer("Hello World! This is a test")
    // data = Buffer("Hello World! This is a test")  // 28 bytes
}
```

**Tracing `soRead`:**
- Creates promise
- Resumes socket
- Waits for data event
- Receives 28 bytes
- Returns: `Buffer("Hello World! This is a test")`

#### Step 3: Push data to buffer
```typescript
bufPush(buf, data);
```

**Tracing `bufPush`:**
- `newLen = 0 + 28 = 28`
- `buf.data.length (100) >= 28` → no resize needed
- `data.copy(buf.data, 0, 0)` → copies 28 bytes to `buf.data[0..27]`
- `buf.length = 28`

**Result:** `buf = { data: Buffer("Hello World! This is a test..."), length: 28 }`

#### Step 4: Check for EOF
```typescript
if(data.length === 0){  // 28 === 0 → false
    // Skip
}
```

#### Step 5: Calculate how much to consume
```typescript
const consume = Math.min(buf.length, remain);
// consume = Math.min(28, 25) = 25
```

**Result:** `consume = 25` (read 25 bytes, leave 3 in buffer)

#### Step 6: Update remaining bytes
```typescript
remain -= consume;
// remain = 25 - 25 = 0
```

**Result:** `remain = 0` (all bytes read)

#### Step 7: Extract data to return
```typescript
const data = Buffer.from(buf.data.subarray(0, consume));
// data = Buffer.from(buf.data[0..24])
// data = Buffer("Hello World! This is a")
```

**Result:** `data = Buffer("Hello World! This is a")` (25 bytes)

#### Step 8: Remove consumed bytes from buffer
```typescript
bufPop(buf, consume);
```

**Tracing `bufPop`:**
- `buf.data.copyWithin(0, 25, 28)` → moves bytes 25-27 to positions 0-2
- `buf.length = 28 - 25 = 3`

**Result:** `buf = { data: Buffer("test..."), length: 3 }` (3 bytes remaining)

#### Step 9: Return data
```typescript
return data;  // Returns Buffer("Hello World! This is a")
```

**Final State:**
- `remain = 0`
- `buf.length = 3` (contains "test")
- Returned: 25 bytes

---

## Second Call: `await bodyReader.read()`

### State Before Call
- `remain = 0` (from closure)
- `buf.length = 3` (contains leftover "test")

### Execution Trace

#### Step 1: Check if done
```typescript
if(remain === 0){  // true
    return Buffer.from('');  // Return empty buffer immediately
}
```

**Result:** Returns `Buffer.from('')` immediately (no more data to read)

**Note:** The 3 bytes in buffer are leftover and will be ignored (or used for next request)

---

## Alternative Scenario: Partial Read (Need More Data)

### Initial State
```typescript
remain = 100  // Need 100 bytes
buf.length = 0
```

### First Call: `await bodyReader.read()`

#### Step 1-2: Buffer is empty, read from connection
```typescript
if(buf.length === 0){
    const data = await soRead(conn);
    // Receives only 50 bytes: Buffer("..." 50 bytes)
    bufPush(buf, data);
    // buf.length = 50
}
```

#### Step 3: Calculate consume
```typescript
const consume = Math.min(buf.length, remain);
// consume = Math.min(50, 100) = 50
```

#### Step 4: Update remain
```typescript
remain -= consume;
// remain = 100 - 50 = 50
```

#### Step 5: Return and pop
```typescript
const data = Buffer.from(buf.data.subarray(0, 50));
bufPop(buf, 50);
// buf.length = 0 (all consumed)
return data;  // Returns 50 bytes
```

**Result:** Returns 50 bytes, `remain = 50`, `buf.length = 0`

---

### Second Call: `await bodyReader.read()`

#### Step 1: Check remain
```typescript
if(remain === 0){  // 50 === 0 → false
    // Continue
}
```

#### Step 2: Buffer is empty again, read more
```typescript
if(buf.length === 0){  // true
    const data = await soRead(conn);
    // Receives 30 bytes: Buffer("..." 30 bytes)
    bufPush(buf, data);
    // buf.length = 30
}
```

#### Step 3: Calculate consume
```typescript
const consume = Math.min(buf.length, remain);
// consume = Math.min(30, 50) = 30
```

#### Step 4: Update remain
```typescript
remain -= consume;
// remain = 50 - 30 = 20
```

#### Step 5: Return and pop
```typescript
return Buffer.from(buf.data.subarray(0, 30));
bufPop(buf, 30);
// buf.length = 0
```

**Result:** Returns 30 bytes, `remain = 20`, `buf.length = 0`

---

### Third Call: `await bodyReader.read()`

#### Step 1-2: Read more data
```typescript
if(buf.length === 0){
    const data = await soRead(conn);
    // Receives 25 bytes: Buffer("..." 25 bytes)
    bufPush(buf, data);
    // buf.length = 25
}
```

#### Step 3: Calculate consume
```typescript
const consume = Math.min(buf.length, remain);
// consume = Math.min(25, 20) = 20  // Only take what we need!
```

#### Step 4: Update remain
```typescript
remain -= consume;
// remain = 20 - 20 = 0
```

#### Step 5: Return and pop
```typescript
return Buffer.from(buf.data.subarray(0, 20));
bufPop(buf, 20);
// buf.length = 5  // 5 bytes leftover in buffer!
```

**Result:** Returns 20 bytes, `remain = 0`, `buf.length = 5` (5 bytes leftover for next request)

---

### Fourth Call: `await bodyReader.read()`

```typescript
if(remain === 0){  // true
    return Buffer.from('');  // Empty - done reading
}
```

---

## Edge Case: Unexpected EOF

### Scenario
Reading 100 bytes, but connection closes after 50 bytes

### Execution
```typescript
if(buf.length === 0){
    const data = await soRead(conn);
    // Connection closed → returns Buffer.from('') (empty)
    bufPush(buf, data);
    // buf.length = 0 (still empty)
    
    if(data.length === 0){  // true!
        throw new HTTPError('Unexpected EOF from HTTP body')
    }
}
```

**Result:** Throws `HTTPError('Unexpected EOF from HTTP body')`

---

## Summary: How It Works

### `readerFromReq` Flow
1. **Extract Content-Length** from headers
2. **Parse** the length value
3. **Validate** method allows body (not GET/HEAD)
4. **Check** for chunked encoding (not supported)
5. **Create** appropriate reader based on body length

### `readerFromConnLength` Flow
1. **Closure** captures `remain` (remaining bytes to read)
2. **On each read() call:**
   - If `remain === 0` → return empty buffer
   - If buffer empty → read from connection
   - Calculate how much to consume: `min(buf.length, remain)`
   - Update `remain -= consume`
   - Extract and return data
   - Remove consumed bytes from buffer
3. **Handles partial reads** efficiently by buffering
4. **Leftover bytes** stay in buffer for next request

### Key Design Points
- **Buffer reuse**: Leftover data from header parsing can contain body data
- **Efficient reads**: Only reads from socket when buffer is empty
- **Exact length**: Reads exactly `remain` bytes, no more, no less
- **Closure state**: `remain` is modified in closure, tracking progress across multiple `read()` calls

