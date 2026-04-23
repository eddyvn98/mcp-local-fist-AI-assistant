const url = "http://localhost:3000/api/mcp/query";
const data = { task: "hello", projectContext: "", currentCode: "" };

fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data)
})
  .then(r => r.text())
  .then(console.log)
  .catch(console.error);
