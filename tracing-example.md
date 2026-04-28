# Tracing Example for parseHTTReq Method

## Example HTTP Request Data

```
Input Buffer (as string representation):
"GET /api/users?id=123 HTTP/1.1\r\n
Host: example.com\r\n
Content-Type: application/json\r\n
\r\n"
```

## Step-by-Step Trace

### 1. Initial Call to parseHTTReq()

```typescript
parseHTTReq(data: Buffer)
```
- **Input**: Buffer containing the entire HTTP request header
- **Input length**: 73 bytes
- **Input (hex)**: `47 45 54 20 2F 61 70 69 2F 75 73 65 72 73 3F 69 64 3D 31 32 33 20 48 54 54 50 2F 31 2E 31 0D 0A 48 6F 73 74 3A 20 65 78 61 6D 70 6C 65 2E 63 6F 6D 0D 0A 43 6F 6E 74 65 6E 74 2D 54 79 70 65 3A 20 61 70 70 6C 69 63 61 74 69 6F 6E 2F 6A 73 6F 6E 0D 0A 0D 0A`

---

### 2. Call to splitLines(data)

```typescript
const lines: Buffer[] = splitLines(data);
```

#### Execution Trace:

**Initial State:**
- `lines = []`
- `start = 0`
- `crlf = Buffer.from('\r\n')` (bytes: `0D 0A`)

**Iteration 1:**
- `start = 0`
- `end = data.indexOf('\r\n', 0)` → Found at position 30
- **Line found**: `data.subarray(0, 30)` = `"GET /api/users?id=123 HTTP/1.1"`
- `lines.push(...)` → `lines[0] = "GET /api/users?id=123 HTTP/1.1"`
- `start = 30 + 2 = 32` (skip CRLF)

**Iteration 2:**
- `start = 32`
- `end = data.indexOf('\r\n', 32)` → Found at position 48
- **Line found**: `data.subarray(32, 48)` = `"Host: example.com"`
- `lines.push(...)` → `lines[1] = "Host: example.com"`
- `start = 48 + 2 = 50`

**Iteration 3:**
- `start = 50`
- `end = data.indexOf('\r\n', 50)` → Found at position 73
- **Line found**: `data.subarray(50, 73)` = `"Content-Type: application/json"`
- `lines.push(...)` → `lines[2] = "Content-Type: application/json"`
- `start = 73 + 2 = 75`

**Iteration 4:**
- `start = 75`
- `end = data.indexOf('\r\n', 75)` → Found at position 75
- **Line found**: `data.subarray(75, 75)` = `""` (empty line)
- `lines.push(...)` → `lines[3] = ""`
- `start = 75 + 2 = 77`

**Iteration 5:**
- `start = 77`
- `end = data.indexOf('\r\n', 77)` → Returns -1 (not found)
- **Last line**: `data.subarray(77)` → empty (already at end)
- `break`

#### Result:
```typescript
lines = [
  Buffer("GET /api/users?id=123 HTTP/1.1"),  // index 0
  Buffer("Host: example.com"),                 // index 1
  Buffer("Content-Type: application/json"),     // index 2
  Buffer("")                                    // index 3 (empty line)
]
```

---

### 3. Call to parseRequestLine(lines[0])

```typescript
const [method, uri, version] = parseRequestLine(lines[0])
```

#### Execution Trace:

**Input**: `Buffer("GET /api/users?id=123 HTTP/1.1")`

**Initial State:**
- `firstSpace = -1`
- `secondSpace = -1`
- `space = 0x20` (ASCII code for ' ')

**Loop through bytes:**

| Index | Byte (hex) | Character | Action |
|-------|-----------|-----------|--------|
| 0 | 0x47 | 'G' | Continue |
| 1 | 0x45 | 'E' | Continue |
| 2 | 0x54 | 'T' | Continue |
| 3 | 0x20 | ' ' | **SPACE found!** `firstSpace = 3` |
| 4 | 0x2F | '/' | Continue |
| 5-29 | ... | ... | Continue (scanning URI) |
| 30 | 0x20 | ' ' | **SPACE found!** `secondSpace = 30`, break |

**After loop:**
- `firstSpace = 3`
- `secondSpace = 30`

**Extract components:**
- `method = line.subarray(0, 3).toString('ascii')` → `"GET"`
- `uri = line.subarray(4, 30)` → `Buffer("/api/users?id=123")`
- `version = line.subarray(31).toString('ascii')` → `"HTTP/1.1"`

#### Result:
```typescript
method = "GET"
uri = Buffer("/api/users?id=123")
version = "HTTP/1.1"
```

---

### 4. Header Validation Loop

```typescript
for (let i=1; i < lines.length - 1; i++) {
    const h = Buffer.from(lines[i]) // copy
    if(!validateHeader(h)){
        throw new HTTPError(400, 'bad field');
    }
    headers.push(h)
}
```

#### Iteration 1: i = 1, Header = "Host: example.com"

**Call to validateHeader():**

**Input**: `Buffer("Host: example.com")`

**Step 1: Find colon**
- Loop through bytes:
  - Index 0-3: 'H', 'o', 's', 't'
  - Index 4: `0x3A` = ':' → **Found!** `colonIndex = 4`
  - Break

**Step 2: Validate colon position**
- `colonIndex = 4` (valid: > 0 and < length-1) ✓

**Step 3: Extract and validate field-name**
- `fieldName = h.subarray(0, 4)` → `Buffer("Host")`
- `fieldName.length = 4` (non-empty) ✓

**Step 4: Validate field-name characters**
- Check each byte in "Host":
  - 'H' (0x48): 0x41-0x5A range → ✓ (A-Z)
  - 'o' (0x6F): 0x61-0x7A range → ✓ (a-z)
  - 's' (0x73): 0x61-0x7A range → ✓ (a-z)
  - 't' (0x74): 0x61-0x7A range → ✓ (a-z)
- All characters valid ✓

**Step 5: Validate field-value**
- `valueStart = colonIndex + 1 = 5`
- Check byte at index 5: `0x20` = SP (space)
- Skip whitespace: `valueStart = 6`
- Check byte at index 6: `0x65` = 'e' (not whitespace)
- `valueStart (6) < length (17)` → Value exists ✓

**Result**: `validateHeader("Host: example.com")` → `true` ✓

**Action**: `headers.push(Buffer("Host: example.com"))`

---

#### Iteration 2: i = 2, Header = "Content-Type: application/json"

**Call to validateHeader():**

**Input**: `Buffer("Content-Type: application/json")`

**Step 1: Find colon**
- Loop finds colon at index 12
- `colonIndex = 12`

**Step 2: Validate colon position**
- `colonIndex = 12` (valid) ✓

**Step 3: Extract and validate field-name**
- `fieldName = h.subarray(0, 12)` → `Buffer("Content-Type")`
- Contains valid characters:
  - 'C' (0x43): A-Z ✓
  - 'o', 'n', 't', 'e', 'n', 't': a-z ✓
  - '-' (0x2D): Special char allowed ✓
  - 'T' (0x54): A-Z ✓
  - 'y', 'p', 'e': a-z ✓

**Step 4: Validate field-value**
- `valueStart = 13` (after colon)
- Byte at 13: `0x20` (SP) → Skip to 14
- Byte at 14: `0x61` ('a') → Value exists ✓

**Result**: `validateHeader("Content-Type: application/json")` → `true` ✓

**Action**: `headers.push(Buffer("Content-Type: application/json"))`

---

### 5. Final Assertion and Return

```typescript
console.assert(lines[lines.length - 1].length === 0);  // lines[3] = ""
```

**Assertion**: Last line is empty ✓

**Return value:**
```typescript
{
    method: "GET",
    uri: Buffer("/api/users?id=123"),
    version: "HTTP/1.1",
    headers: [
        Buffer("Host: example.com"),
        Buffer("Content-Type: application/json")
    ]
}
```

---

## Summary of Function Calls

```
parseHTTReq(data)
  ├── splitLines(data)
  │   └── Returns: [Buffer("GET ..."), Buffer("Host..."), Buffer("Content-Type..."), Buffer("")]
  │
  ├── parseRequestLine(lines[0])
  │   └── Returns: ["GET", Buffer("/api/users?id=123"), "HTTP/1.1"]
  │
  └── Loop: for each header line
      ├── validateHeader("Host: example.com")
      │   ├── Find colon (index 4)
      │   ├── Validate field-name "Host" ✓
      │   └── Validate field-value exists ✓
      │   └── Returns: true
      │
      └── validateHeader("Content-Type: application/json")
          ├── Find colon (index 12)
          ├── Validate field-name "Content-Type" ✓
          └── Validate field-value exists ✓
          └── Returns: true
  │
  └── Returns: HTTPReq object
```

---

## Edge Case Example: Invalid Header

If we had an invalid header like `"Bad Header!"`, the trace would be:

```
validateHeader(Buffer("Bad Header!"))
  ├── Find colon: NOT FOUND → colonIndex = -1
  ├── Check: colonIndex (-1) <= 0 → FALSE
  └── Returns: false
  
→ Throws HTTPError(400, 'bad field')
```

---

## Another Example: Header with Tab

```
Input: Buffer("User-Agent:\tMozilla/5.0")
validateHeader(Buffer("User-Agent:\tMozilla/5.0"))
  ├── Find colon: index 10
  ├── Validate field-name "User-Agent" ✓
  ├── valueStart = 11 (after colon)
  ├── Byte at 11: 0x09 (HTAB/tab) → Skip
  ├── Byte at 12: 0x4D ('M') → Value exists ✓
  └── Returns: true
```

