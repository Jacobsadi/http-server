import * as net from "net";
import * as readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const client = net.createConnection({ host: "127.0.0.1", port: 1234 }, () => {
  console.log("Connected to server. Type messages (type 'quit' to exit):");
});

client.on("data", (data) => {
  console.log("Server:", data.toString().trim());
});

client.on("end", () => {
  console.log("Disconnected from server.");
  process.exit(0);
});

rl.on("line", (input) => {
  client.write(input + "\n");
  if (input === "quit") {
    rl.close();
  }
});
