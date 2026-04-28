# BodyReader Concept: Complete Explanation with Tracing

## What is BodyReader?

**BodyReader** is an **abstraction** (interface) that provides a **uniform way to read HTTP body data** from different sources. Think of it as a "reader" that you can call multiple times to get chunks of data until the body is completely read.

### The Interface

```typescript
type BodyReader = {
    length: number,        // Total bytes to read (-1 if unknown)
    read: () => Promise<Buffer>  // Read next chunk (returns empty when done)
}
```

### Key Concepts

1. **Streaming**: Read body in chunks, not all at once
2. **Stateful**: Remembers how much has been read
3. **Multiple calls**: Call `read()` multiple times until it returns empty
4. **Source-agnostic**: Same interface whether reading from network, memory, or file

---

## Why Do We Need BodyReader?

### Problem: Different Sources, Same Interface

HTTP bodies can come from:
- **Network connection** (TCP socket) - arrives in chunks over time
- **Memory** (already have the data) - instant access
- **File** (not implemented, but could be) - read from disk

Without BodyReader, you'd need different code for each source. With BodyReader, you use the same code:

```typescript
// Works the same way regardless of source!
while(true) {
    const chunk = await bodyReader.read();
    if(chunk.length === 0) break;  // Done reading
    // Process chunk...
}
```

---

## How BodyReader Works: The Pattern

### The Reading Pattern

```typescript
const bodyReader = readerFromReq(conn, buf, req);

// Read all chunks
while(true) {
    const chunk = await bodyReader.read();
    if(chunk.length === 0) {
        break;  // No more data
    }
    console.log('Got chunk:', chunk.toString());
    // Process chunk...
}
```

**Key Points:**
- Call `read()` repeatedly
- Each call returns the **next chunk** of data
- When `read()` returns **empty Buffer**, you're done
- `length` tells you total size (if known)

---

## Implementation 1: `readerFromConnLength` (Network Source)

This reads from a TCP connection, handling partial reads efficiently.

### Code

```typescript
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
                    throw new HTTPError('Unexpected EOF from HTTP body')
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
```

### How It Works: Closure Magic

**Critical Understanding:** The `read` function uses **closure** to access and modify `remain` and `buf`.

```typescript
// When readerFromConnLength is called:
function readerFromConnLength(conn, buf, remain) {
    // remain = 100 (example)
    // buf = { data: Buffer(...), length: 0 }
    
    return {
        length: 100,
        read: async () => {
            // This function "closes over" (remembers):
            // - conn (the connection)
            // - buf (the buffer - can modify it!)
            // - remain (remaining bytes - can modify it!)
            
            // Each time read() is called, it uses the SAME remain and buf
            // But remain decreases each call!
        }
    }
}
```

**Important:** Each `read()` call shares the same `remain` and `buf` variables. When `read()` modifies `remain`, it affects the next call!

---

## Complete Tracing Example: Reading 100 Bytes in Multiple Chunks

### Initial Setup

```typescript
// HTTP Request:
req = {
    method: "POST",
    headers: [Buffer("Content-Length: 100")],
    // ...
}

// Connection and buffer
conn = <TCPConn object>
buf = { data: Buffer.alloc(200), length: 0 }  // Empty buffer

// Create BodyReader
const bodyReader = readerFromReq(conn, buf, req);
```

### Step 1: Create BodyReader

**Call:** `readerFromReq(conn, buf, req)`

**Execution:**
```typescript
// Inside readerFromReq:
const contentLen = fieldGet(req.headers, 'Content-Length');
// Returns: Buffer("100")

bodyLen = parseInt("100")  // = 100

return readerFromConnLength(conn, buf, 100);
```

**Inside `readerFromConnLength`:**
```typescript
// Parameters:
// conn = <TCPConn>
// buf = { data: Buffer(...), length: 0 }
// remain = 100

return {
    length: 100,  // Total size
    read: async () => {
        // Closure captures: conn, buf, remain (initially 100)
        // ...
    }
}
```

**Result:**
```typescript
bodyReader = {
    length: 100,
    read: <async function>
}
```

**State:**
- `remain = 100` (inside closure)
- `buf.length = 0` (empty)

---

### Step 2: First Read - `await bodyReader.read()`

**Call:** `const chunk1 = await bodyReader.read();`

**Execution Trace:**

#### Line 216: Check if done
```typescript
if(remain === 0){  // 100 === 0 → false
    // Skip
}
```

#### Line 219: Check if buffer empty
```typescript
if(buf.length === 0){  // true, buffer is empty
    const data = await soRead(conn);
    // ⏸️ PAUSES HERE - waits for socket data
    // ...
    // [Time passes... socket receives data]
    // ...
    // Receives: Buffer("Hello World! This is a test message. Here is more data to fill up space.")
    // data = Buffer("Hello World! This is a test message. Here is more data to fill up space.")
    // Length: 70 bytes
}
```

**State after `soRead`:**
- `data = Buffer("Hello World! This is a test message. Here is more data to fill up space.")`
- `data.length = 70`

#### Line 221: Push data to buffer
```typescript
bufPush(buf, data);
```

**What `bufPush` does:**
- Copies 70 bytes into `buf.data`
- Sets `buf.length = 70`

**State after `bufPush`:**
- `buf = { data: Buffer("Hello World!..."), length: 70 }`

#### Line 222: Check for EOF
```typescript
if(data.length === 0){  // 70 === 0 → false
    // Skip
}
```

#### Line 226: Calculate how much to consume
```typescript
const consume = Math.min(buf.length, remain);
// consume = Math.min(70, 100) = 70
// Take all 70 bytes from buffer
```

#### Line 227: Update remaining bytes
```typescript
remain -= consume;
// remain = 100 - 70 = 30
// ⚠️ IMPORTANT: This modifies the closure variable!
// Next read() call will see remain = 30
```

**State:**
- `remain = 30` (updated in closure)
- `buf.length = 70` (still has 70 bytes)

#### Line 228: Extract data to return
```typescript
const data = Buffer.from(buf.data.subarray(0, consume));
// data = Buffer.from(buf.data[0..69])
// data = Buffer("Hello World! This is a test message. Here is more data to fill up space.")
// Length: 70 bytes
```

#### Line 229: Remove consumed bytes from buffer
```typescript
bufPop(buf, consume);
```

**What `bufPop` does:**
- Moves remaining bytes to start of buffer
- Updates `buf.length`

**State after `bufPop`:**
- `buf = { data: Buffer(...), length: 0 }` (all consumed)

#### Line 230: Return data
```typescript
return data;  // Returns 70-byte Buffer
```

**Result:**
```typescript
chunk1 = Buffer("Hello World! This is a test message. Here is more data to fill up space.")
chunk1.length = 70
```

**State After First Read:**
- `remain = 30` (30 bytes still needed)
- `buf.length = 0` (buffer empty)

---

### Step 3: Second Read - `await bodyReader.read()`

**Call:** `const chunk2 = await bodyReader.read();`

**Execution Trace:**

#### Line 216: Check if done
```typescript
if(remain === 0){  // 30 === 0 → false
    // Continue
}
```

#### Line 219: Check if buffer empty
```typescript
if(buf.length === 0){  // true, buffer is empty
    const data = await soRead(conn);
    // ⏸️ PAUSES - waits for more socket data
    // ...
    // Receives: Buffer("The rest of the body data here.")
    // data = Buffer("The rest of the body data here.")
    // Length: 35 bytes
}
```

**State:**
- `data = Buffer("The rest of the body data here.")`
- `data.length = 35`

#### Line 221: Push to buffer
```typescript
bufPush(buf, data);
// buf.length = 35
```

#### Line 226: Calculate consume
```typescript
const consume = Math.min(buf.length, remain);
// consume = Math.min(35, 30) = 30
// Only take 30 bytes (what we need), leave 5 in buffer
```

#### Line 227: Update remain
```typescript
remain -= consume;
// remain = 30 - 30 = 0
// ⚠️ All bytes read!
```

**State:**
- `remain = 0` (done!)
- `buf.length = 35` (but we only need 30)

#### Line 228: Extract data
```typescript
const data = Buffer.from(buf.data.subarray(0, 30));
// data = Buffer("The rest of the body data ")
// Length: 30 bytes (exactly what we need)
```

#### Line 229: Pop consumed bytes
```typescript
bufPop(buf, 30);
// buf.length = 5 (5 bytes leftover: "here.")
```

**State:**
- `buf = { data: Buffer("here."), length: 5 }` (leftover for next request)

#### Line 230: Return
```typescript
return data;  // Returns 30-byte Buffer
```

**Result:**
```typescript
chunk2 = Buffer("The rest of the body data ")
chunk2.length = 30
```

**State After Second Read:**
- `remain = 0` (all done!)
- `buf.length = 5` (leftover bytes)

---

### Step 4: Third Read - `await bodyReader.read()`

**Call:** `const chunk3 = await bodyReader.read();`

**Execution Trace:**

#### Line 216: Check if done
```typescript
if(remain === 0){  // 0 === 0 → true!
    return Buffer.from('');  // Return empty immediately
}
```

**Result:**
```typescript
chunk3 = Buffer.from('')
chunk3.length = 0
```

**This signals: "No more data to read!"**

---

## Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│ Create BodyReader                                        │
│ readerFromConnLength(conn, buf, 100)                    │
└─────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────┐
│ Closure Created:                                         │
│ - conn (connection)                                      │
│ - buf (shared buffer)                                    │
│ - remain = 100 (shared counter)                         │
└─────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────┐
│ Call 1: await bodyReader.read()                          │
│ ├─ remain = 100                                         │
│ ├─ buf.length = 0 → Read from socket (70 bytes)         │
│ ├─ consume = min(70, 100) = 70                         │
│ ├─ remain = 100 - 70 = 30                              │
│ └─ Return 70 bytes                                      │
└─────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────┐
│ Call 2: await bodyReader.read()                          │
│ ├─ remain = 30 (from closure!)                         │
│ ├─ buf.length = 0 → Read from socket (35 bytes)         │
│ ├─ consume = min(35, 30) = 30                          │
│ ├─ remain = 30 - 30 = 0                                │
│ └─ Return 30 bytes                                      │
└─────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────┐
│ Call 3: await bodyReader.read()                          │
│ ├─ remain = 0 → Return empty Buffer                    │
│ └─ DONE!                                                │
└─────────────────────────────────────────────────────────┘
```

---

## Implementation 2: `readFromMemory` (Memory Source)

This reads from data already in memory (for responses).

### Code

```typescript
function readFromMemory(data: Buffer): BodyReader {
    let done = false;  // Closure variable
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
```

### Tracing Example: Reading from Memory

#### Setup
```typescript
const data = Buffer.from("Hello World");
const bodyReader = readFromMemory(data);
```

**State:**
- `done = false` (in closure)
- `data = Buffer("Hello World")` (in closure)

#### First Call: `await bodyReader.read()`

```typescript
if(done){  // false
    // Skip
} else {
    done = true;  // Mark as done
    return data;  // Return all data at once
}
```

**Result:**
```typescript
chunk = Buffer("Hello World")
chunk.length = 11
```

**State:**
- `done = true` (updated in closure)

#### Second Call: `await bodyReader.read()`

```typescript
if(done){  // true!
    return Buffer.from('');  // Empty - done
}
```

**Result:**
```typescript
chunk = Buffer.from('')
chunk.length = 0  // Signals end
```

---

## Real-World Usage Example

### Reading Request Body

```typescript
// In your HTTP server handler:
async function handleRequest(req: HTTPReq, bodyReader: BodyReader) {
    // Read entire body
    const chunks: Buffer[] = [];
    
    while(true) {
        const chunk = await bodyReader.read();
        if(chunk.length === 0) {
            break;  // Done reading
        }
        chunks.push(chunk);
        console.log(`Read ${chunk.length} bytes`);
    }
    
    // Combine all chunks
    const fullBody = Buffer.concat(chunks);
    console.log('Total body:', fullBody.toString());
    
    return fullBody;
}
```

### Tracing This Usage

**Input:**
- `bodyReader` with `length: 100`
- Body arrives in chunks: 70 bytes, then 30 bytes

**Execution:**

```typescript
// Loop iteration 1:
const chunk = await bodyReader.read();
// Returns 70 bytes
chunks.push(chunk);  // chunks = [Buffer(70 bytes)]
console.log('Read 70 bytes');

// Loop iteration 2:
const chunk = await bodyReader.read();
// Returns 30 bytes
chunks.push(chunk);  // chunks = [Buffer(70), Buffer(30)]
console.log('Read 30 bytes');

// Loop iteration 3:
const chunk = await bodyReader.read();
// Returns empty Buffer
if(chunk.length === 0) {  // true
    break;  // Exit loop
}

// After loop:
const fullBody = Buffer.concat(chunks);
// fullBody = Buffer(100 bytes) - all data combined
```

---

## Key Concepts Summary

### 1. **Closure (State Management)**

```typescript
function readerFromConnLength(conn, buf, remain) {
    // These variables are "captured" by the closure
    return {
        read: async () => {
            // Can access and modify: conn, buf, remain
            // Each read() call shares the SAME variables
            remain -= consume;  // Modifies shared state!
        }
    }
}
```

**Why this matters:**
- First `read()` call: `remain = 100`
- Second `read()` call: `remain = 30` (remembered from first call!)
- Third `read()` call: `remain = 0` (remembered from second call!)

### 2. **Streaming Pattern**

```typescript
// Don't read all at once:
const allData = await readEverything();  // ❌ Blocks until all arrives

// Read in chunks:
while(true) {
    const chunk = await bodyReader.read();  // ✅ Can process as it arrives
    if(chunk.length === 0) break;
    process(chunk);
}
```

### 3. **Empty Buffer = End Signal**

```typescript
const chunk = await bodyReader.read();
if(chunk.length === 0) {
    // No more data - we're done!
}
```

### 4. **Buffer Management**

The `buf` parameter is shared and reused:
- Leftover data from header parsing can contain body data
- Partial reads are buffered efficiently
- Leftover bytes stay for next request

---

## Common Patterns

### Pattern 1: Read Entire Body

```typescript
async function readAll(bodyReader: BodyReader): Promise<Buffer> {
    const chunks: Buffer[] = [];
    while(true) {
        const chunk = await bodyReader.read();
        if(chunk.length === 0) break;
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}
```

### Pattern 2: Process as You Read

```typescript
async function processStream(bodyReader: BodyReader) {
    while(true) {
        const chunk = await bodyReader.read();
        if(chunk.length === 0) break;
        
        // Process chunk immediately (don't wait for all data)
        await processChunk(chunk);
    }
}
```

### Pattern 3: Check Length First

```typescript
if(bodyReader.length > 0) {
    // Has body, read it
    while(true) {
        const chunk = await bodyReader.read();
        if(chunk.length === 0) break;
        // ...
    }
} else {
    // No body (GET/HEAD request)
}
```

---

## Why This Design is Powerful

1. **Uniform Interface**: Same code works for network, memory, files
2. **Efficient**: Can process data as it arrives (streaming)
3. **Flexible**: Handles partial reads, buffering automatically
4. **Simple**: Just call `read()` until empty

The BodyReader abstraction makes HTTP body handling **simple and consistent**, regardless of where the data comes from!

